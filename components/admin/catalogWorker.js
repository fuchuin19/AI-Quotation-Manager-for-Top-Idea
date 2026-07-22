// Runs entirely off the main thread so dropping a 237MB file never freezes
// the page. Everything up to (and including) hashing/compressing the
// images that actually need uploading happens here; the main thread only
// does the network upload + save-catalog steps, so cancelling before that
// point never makes a single network call.
//
// Message in:  { type: "start", file: File, baseline: Product[], publicUrlBase: string }
// Messages out:
//   { type: "phase", phase: "reading" | "parsing" | "comparing" | "images", total? }
//   { type: "progress", current, total, sheetName }        -- per sheet, while parsing
//   { type: "progress-images", done, total }                -- per image, while resolving
//   { type: "summary", ... }                                 -- final result, see below
//   { type: "error", message }
const { parseWorkbook } = require("../../lib/catalog-import/xlsx-parse");
const { dedupe } = require("../../lib/catalog-import/dedupe");
const { diffCatalog, collectNeededImagePairs, cropKey } = require("../../lib/catalog-import/diff");
const { openXlsxFromBuffer } = require("../../lib/catalog-import/zip-browser");
const { processImage, contentHash, keyInfoFor } = require("../../lib/catalog-import/image-browser");

function buildRecord(m, urlByPair) {
  const images = [];
  const imageCrops = m.imageCrops || [];
  m.imageMediaPaths.forEach((mp, i) => {
    const url = urlByPair.get(`${mp}:photo:${cropKey(imageCrops[i] || null)}`);
    if (url) images.push(url);
  });
  const dimensions = [];
  const dimensionCrops = m.dimensionCrops || [];
  m.dimensionMediaPaths.forEach((mp, i) => {
    const url = urlByPair.get(`${mp}:dim:${cropKey(dimensionCrops[i] || null)}`);
    if (url) dimensions.push(url);
  });
  // descImageSizes stays parallel to descImages (same index = same image).
  const descImagePaths = m.descImageMediaPaths || [];
  const descImageSizesRaw = m.descImageSizes || [];
  const descImageCrops = m.descImageCrops || [];
  const descImages = [];
  const descImageSizes = [];
  descImagePaths.forEach((mp, i) => {
    const url = urlByPair.get(`${mp}:photo:${cropKey(descImageCrops[i] || null)}`);
    if (url) {
      descImages.push(url);
      descImageSizes.push(descImageSizesRaw[i] || null);
    }
  });
  return { sku: m.sku, brand: m.brand, desc: m.desc, price: m.price, priceMissing: m.priceMissing, images, dimensions, descImages, descImageSizes };
}

self.onmessage = async (e) => {
  const { file, baseline, publicUrlBase } = e.data;
  const base = String(publicUrlBase || "").replace(/\/+$/, "");

  try {
    self.postMessage({ type: "phase", phase: "reading" });
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    self.postMessage({ type: "phase", phase: "parsing" });
    const zip = openXlsxFromBuffer(buffer);
    const { products, skippedSheets, sheetsProcessed, sheetsWithMultiplePriceColumns } = await parseWorkbook(zip, {
      onProgress: (p) => self.postMessage({ type: "progress", current: p.current, total: p.total, sheetName: p.sheetName }),
    });

    const { merged, conflicts, packagesOnlyNoPrice } = dedupe(products);

    self.postMessage({ type: "phase", phase: "comparing" });
    const diff = diffCatalog(merged, baseline || []);

    const needProcessing = [...diff.newSkus, ...diff.changedSkus.map((c) => c.merged)];
    const neededPairs = collectNeededImagePairs(needProcessing);

    self.postMessage({ type: "phase", phase: "images", total: neededPairs.length });

    const urlByPair = new Map();
    const imagesToUpload = [];
    const unsupportedFormats = [];
    let bytesToUpload = 0;
    let done = 0;

    for (const { mediaPath, role, crop } of neededPairs) {
      const raw = await zip.readBuffer(mediaPath);
      const pairKey = `${mediaPath}:${role}:${cropKey(crop)}`;
      if (!raw) {
        // Referenced by a drawing anchor but missing from the archive —
        // skip it rather than fail the whole import, same as the CLI script.
        done++;
        self.postMessage({ type: "progress-images", done, total: neededPairs.length });
        continue;
      }

      const hash = await contentHash(raw, crop);
      const { key, contentType } = keyInfoFor(hash, mediaPath, role);

      let existsResult;
      try {
        const res = await fetch("/api/admin/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, contentType }),
        });
        existsResult = await res.json();
        if (!res.ok) throw new Error(existsResult.error || `server said ${res.status}`);
      } catch (err) {
        self.postMessage({ type: "error", message: `Couldn't check whether ${mediaPath} already exists: ${err.message}` });
        return;
      }

      if (existsResult.exists) {
        urlByPair.set(pairKey, `${base}/${key}`);
      } else {
        const result = await processImage(raw, mediaPath, role, hash, crop);
        if (result.unsupportedFormat) unsupportedFormats.push(mediaPath);
        imagesToUpload.push({ key: result.key, contentType: result.contentType, buffer: result.buffer, uploadUrl: existsResult.uploadUrl });
        bytesToUpload += result.finalBytes;
        urlByPair.set(pairKey, `${base}/${result.key}`);
      }

      done++;
      self.postMessage({ type: "progress-images", done, total: neededPairs.length });
    }

    const finalNew = diff.newSkus.map((m) => buildRecord(m, urlByPair));
    const finalChanged = diff.changedSkus.map((c) => buildRecord(c.merged, urlByPair));
    const finalProducts = [...finalNew, ...finalChanged, ...diff.unchangedSkus, ...diff.removedSkus];

    const transferList = imagesToUpload.map((img) => img.buffer.buffer);
    self.postMessage(
      {
        type: "summary",
        counts: diff.counts,
        conflicts,
        packagesOnlyNoPrice,
        missingPriceCount: merged.filter((m) => m.priceMissing).length,
        sheetsProcessedCount: sheetsProcessed.length,
        skippedSheets,
        sheetsWithMultiplePriceColumns,
        imagesToUploadCount: imagesToUpload.length,
        imagesToUploadBytes: bytesToUpload,
        unsupportedFormats,
        imagesToUpload,
        finalProducts,
      },
      transferList
    );
  } catch (err) {
    self.postMessage({ type: "error", message: (err && err.message) || String(err) });
  }
};
