#!/usr/bin/env node
// Imports PRODUCTS_LIBRARY-style workbooks into catalog/products.json on R2.
// Run locally (never via a Vercel function — see CLAUDE.md on request-size
// limits): `node scripts/import-catalog.js [--full | --prices-only] [--file <path>]`
//
// Modes:
//   (default) incremental — fetches the existing catalog/products.json, only
//     re-processes SKUs that are new or whose price/image count changed, and
//     never removes a SKU that dropped out of the spreadsheet.
//   --full — rebuilds catalog/products.json from the spreadsheet alone,
//     ignoring the existing catalog for merge purposes (a SKU no longer in
//     the spreadsheet is dropped). Images already on R2 (same content hash)
//     are still not re-uploaded — this only affects which products.json
//     entries are kept, not whether image bytes get re-sent.
//   --prices-only — updates only the price/priceMissing fields on SKUs that
//     already exist in the current catalog. Never adds new SKUs, never
//     touches images. Requires a prior full/incremental import to exist.
const fs = require('fs');
const path = require('path');

const { loadEnv } = require('./lib/load-env');
loadEnv();

const { parseWorkbook, normalizeSku } = require('../lib/catalog-import/xlsx-parse');
const { dedupe } = require('../lib/catalog-import/dedupe');
const { processImage } = require('./lib/images');
const { openXlsx } = require('./lib/zip');
const r2 = require('./lib/r2');

const args = process.argv.slice(2);
const MODE = args.includes('--full') ? 'full' : args.includes('--prices-only') ? 'prices-only' : 'incremental';
const fileFlagIdx = args.indexOf('--file');
const XLSX_PATH =
  fileFlagIdx !== -1 && args[fileFlagIdx + 1]
    ? path.resolve(args[fileFlagIdx + 1])
    : path.join(__dirname, '..', 'Quotation items Library.xlsx');

const CONCURRENCY = 8;

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workerCount = Math.min(limit, items.length) || 0;
  const workers = new Array(workerCount).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeConflictsCsv(conflicts) {
  const outPath = path.join(__dirname, '..', 'conflicts.csv');
  const header = 'sku,sheet_a,price_a,sheet_b,price_b,price_used';
  const rows = conflicts.map((c) =>
    [c.sku, c.sheet_a, c.price_a, c.sheet_b, c.price_b, c.price_used].map(csvEscape).join(',')
  );
  fs.writeFileSync(outPath, [header, ...rows].join('\n') + '\n', 'utf8');
  return outPath;
}

function noPriceBySheet(merged) {
  const map = new Map();
  for (const m of merged) {
    if (!m.priceMissing) continue;
    for (const s of m.sourceSheets) map.set(s, (map.get(s) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function printCommonReport({ sheetsProcessed, skippedSheets, sheetsWithMultiplePriceColumns, merged, conflicts, conflictsPath, packagesOnlyNoPrice }) {
  console.log('\n================ IMPORT REPORT ================');
  console.log(`Mode: ${MODE}`);
  console.log(`\nSheets processed: ${sheetsProcessed.length}`);
  console.log(`Sheets skipped: ${skippedSheets.length}`);
  for (const s of skippedSheets) console.log(`  - ${s.name}: ${s.reason}`);

  if (sheetsWithMultiplePriceColumns.length) {
    console.log(`\nSheets with more than one PRICE column (used PACKAGE/UNIT PRICE):`);
    for (const s of sheetsWithMultiplePriceColumns) console.log(`  - ${s}`);
  }

  const missing = merged.filter((m) => m.priceMissing);
  console.log(`\nUnique SKUs imported: ${merged.length}`);
  console.log(`SKUs with no price: ${missing.length}`);
  for (const [sheet, count] of noPriceBySheet(merged)) console.log(`  - ${sheet}: ${count}`);

  if (packagesOnlyNoPrice.length) {
    console.log(`\nSKUs that exist ONLY in GROHE PACKAGES and have no price anywhere (${packagesOnlyNoPrice.length}):`);
    console.log('  ' + packagesOnlyNoPrice.join(', '));
  }

  console.log(`\nPrice conflicts written to ${conflictsPath}: ${conflicts.length}`);
  const multi = conflicts.filter((c) => c.distinctPriceCount > 2);
  if (multi.length) {
    console.log(`  (${multi.length} of these had more than 2 distinct prices — CSV shows the lowest/highest only)`);
  }
}

async function runPricesOnly(ctx) {
  const { baseline, merged, client, bucket } = ctx;
  const bySkuKey = new Map(merged.map((m) => [m.skuKey, m]));
  const baselineSkuKeys = new Set(baseline.map((b) => normalizeSku(b.sku)));

  let updated = 0;
  const updatedProducts = baseline.map((b) => {
    const key = normalizeSku(b.sku);
    const fresh = bySkuKey.get(key);
    if (!fresh) return b;
    if (fresh.price !== b.price || fresh.priceMissing !== b.priceMissing) {
      updated++;
      return { ...b, price: fresh.price, priceMissing: fresh.priceMissing };
    }
    return b;
  });

  const newSkusSkipped = [...bySkuKey.keys()].filter((k) => !baselineSkuKeys.has(k)).length;

  await r2.putProductsJson(client, bucket, updatedProducts);
  const conflictsPath = writeConflictsCsv(ctx.conflicts);
  printCommonReport({ ...ctx, conflictsPath });

  console.log(`\nCatalog entries updated with a new price: ${updated}`);
  console.log(`New SKUs found in the spreadsheet but NOT added (--prices-only never adds SKUs): ${newSkusSkipped}`);
  console.log(`Total catalog size unchanged: ${updatedProducts.length} products`);
  console.log('\nNo images were touched in this mode.');
}

async function runFullOrIncremental(ctx) {
  const { merged, baseline, zip, client, bucket } = ctx;
  const baselineByKey = new Map((baseline || []).map((b) => [normalizeSku(b.sku), b]));

  const toProcess = [];
  const finalProducts = [];
  let unchangedCount = 0;

  for (const m of merged) {
    const existing = baselineByKey.get(m.skuKey);
    const unchanged =
      MODE === 'incremental' &&
      existing &&
      existing.price === m.price &&
      existing.priceMissing === m.priceMissing &&
      (existing.images || []).length === m.imageMediaPaths.length &&
      (existing.dimensions || []).length === m.dimensionMediaPaths.length;

    if (unchanged) {
      finalProducts.push(existing);
      unchangedCount++;
    } else {
      toProcess.push({ product: m, existing });
    }
  }

  // Collect every distinct (mediaPath, role) needed by the products that
  // actually require (re)processing, so identical images referenced by many
  // SKUs are only read/compressed/uploaded once per run.
  const neededPairs = new Map(); // key -> { mediaPath, role }
  for (const { product } of toProcess) {
    for (const mp of product.imageMediaPaths) neededPairs.set(`${mp}:photo`, { mediaPath: mp, role: 'photo' });
    for (const mp of product.dimensionMediaPaths) neededPairs.set(`${mp}:dim`, { mediaPath: mp, role: 'dim' });
  }

  console.log(`\nProducts unchanged (reused from existing catalog): ${unchangedCount}`);
  console.log(`Products to (re)process: ${toProcess.length}`);
  console.log(`Distinct images to resolve: ${neededPairs.size}`);

  let imagesUploadedCount = 0;
  let imageBytesBefore = 0;
  let imageBytesAfter = 0;
  const unsupportedList = [];
  const urlCache = new Map(); // key -> url
  let done = 0;

  await mapLimit([...neededPairs.entries()], CONCURRENCY, async ([key, { mediaPath, role }]) => {
    const buffer = await zip.readBuffer(mediaPath);
    if (!buffer) {
      console.warn(`  ! ${mediaPath} referenced by a drawing anchor but missing from the archive — skipped.`);
      return;
    }
    const result = await processImage(buffer, mediaPath, role);
    const { uploaded, url } = await r2.uploadImageIfMissing(client, bucket, result.key, result.buffer, result.contentType);
    if (uploaded) {
      imagesUploadedCount++;
      imageBytesBefore += result.originalBytes;
      imageBytesAfter += result.finalBytes;
    }
    if (result.unsupportedFormat) unsupportedList.push(mediaPath);
    urlCache.set(key, url);
    done++;
    if (done % 200 === 0) console.log(`  ...resolved ${done}/${neededPairs.size} images`);
  });

  let newCount = 0;
  let updatedCount = 0;
  for (const { product: m, existing } of toProcess) {
    const images = m.imageMediaPaths.map((mp) => urlCache.get(`${mp}:photo`)).filter(Boolean);
    const dimensions = m.dimensionMediaPaths.map((mp) => urlCache.get(`${mp}:dim`)).filter(Boolean);
    finalProducts.push({
      sku: m.sku,
      brand: m.brand,
      desc: m.desc,
      price: m.price,
      priceMissing: m.priceMissing,
      images,
      dimensions,
    });
    if (existing) updatedCount++;
    else newCount++;
  }

  if (MODE === 'incremental' && baseline) {
    const mergedKeys = new Set(merged.map((m) => m.skuKey));
    for (const b of baseline) {
      if (!mergedKeys.has(normalizeSku(b.sku))) finalProducts.push(b);
    }
  }

  await r2.putProductsJson(client, bucket, finalProducts);
  const conflictsPath = writeConflictsCsv(ctx.conflicts);
  printCommonReport({ ...ctx, conflictsPath });

  console.log(`\nNew SKUs added: ${newCount}`);
  console.log(`Existing SKUs updated: ${updatedCount}`);
  console.log(`Existing SKUs left untouched (incremental fast path): ${unchangedCount}`);
  console.log(`Total catalog size: ${finalProducts.length} products`);
  console.log(`\nUnique images uploaded this run: ${imagesUploadedCount}`);
  console.log(`  before compression: ${fmtMB(imageBytesBefore)} MB`);
  console.log(`  after compression:  ${fmtMB(imageBytesAfter)} MB`);
  if (unsupportedList.length) {
    console.log(`\n${unsupportedList.length} images are in a format (.emf/.wmf/.wdp) no browser or Excel-embed library can render.`);
    console.log('  Uploaded as-is so nothing was dropped, but these need manual replacement with a real photo:');
    for (const p of unsupportedList) console.log(`    - ${p}`);
  }
}

async function main() {
  console.log(`Mode: ${MODE}`);
  console.log(`Source file: ${XLSX_PATH}`);

  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`\nCan't find the source spreadsheet at:\n  ${XLSX_PATH}\nPass --file "<path>" if it's somewhere else.`);
    process.exit(1);
  }

  let client, bucket;
  try {
    client = r2.makeClient();
    bucket = process.env.R2_BUCKET;
    if (!bucket) throw new Error('Missing R2_BUCKET in .env.local.');
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }

  console.log('Parsing workbook...');
  const zip = await openXlsx(XLSX_PATH);
  const { products, skippedSheets, sheetsProcessed, sheetsWithMultiplePriceColumns } = await parseWorkbook(zip, {
    onProgress: ({ current, total, sheetName }) => {
      if (current === total || current % 10 === 0) console.log(`  ...sheet ${current}/${total} (${sheetName})`);
    },
  });
  const { merged, conflicts, packagesOnlyNoPrice } = dedupe(products);
  console.log(`Parsed ${sheetsProcessed.length} sheets, ${products.length} raw product rows, ${merged.length} unique SKUs.`);

  let baseline = null;
  if (MODE !== 'full') {
    console.log('Fetching existing catalog/products.json from R2...');
    baseline = await r2.getProductsJson(client, bucket);
    console.log(baseline ? `  found ${baseline.length} existing products.` : '  none found (first import).');
  }

  const ctx = { merged, conflicts, packagesOnlyNoPrice, sheetsProcessed, skippedSheets, sheetsWithMultiplePriceColumns, baseline, zip, client, bucket };

  if (MODE === 'prices-only') {
    if (!baseline) {
      console.error('\nNo existing catalog/products.json on R2 — --prices-only needs a prior import to update.\nRun without flags (incremental) or with --full first.');
      process.exit(1);
    }
    await runPricesOnly(ctx);
  } else {
    await runFullOrIncremental(ctx);
  }
}

main().catch((err) => {
  console.error('\nImport failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
