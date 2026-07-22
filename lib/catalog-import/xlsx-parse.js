// Parses a PRODUCTS_LIBRARY-style workbook directly from its zip/XML
// internals (no full in-memory workbook load — see CLAUDE.md). Header row
// and column positions are detected per sheet, never hardcoded, so new
// brand tabs added later don't need code changes.
//
// Environment-agnostic on purpose: takes an already-opened zip reader
// ({readText(path), readBuffer(path)}) rather than a file path, so the SAME
// file runs both in the Node CLI import script (scripts/import-catalog.js,
// backed by scripts/lib/zip.js + unzipper) and in the browser admin
// catalogue-update Web Worker (backed by lib/catalog-import/zip-browser.js
// + fflate) without any risk of the two drifting apart — there is only one
// copy of this parsing logic.
const HEADER_LABELS = ['IMAGE', 'ITEM DESCRIPTIONS', 'DIMENSION', 'QTY', 'TOTAL'];

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function basename(p) {
  return p.split('/').pop();
}

function colLetterToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function normalizeHeader(s) {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

// Matches which of the 6 header-signal categories a single header cell hits.
function headerSignals(headerText) {
  const norm = normalizeHeader(headerText);
  const hits = new Set();
  for (const label of HEADER_LABELS) {
    if (norm.includes(label)) hits.add(label);
  }
  if (norm.includes('PRICE')) hits.add('PRICE');
  return hits;
}

function cellValue(sharedStrings, cellInnerXml, type) {
  if (type === 'inlineStr') {
    const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cellInnerXml);
    return tm ? xmlUnescape(tm[1]) : '';
  }
  const vm = /<v>([\s\S]*?)<\/v>/.exec(cellInnerXml);
  if (!vm) return '';
  if (type === 's') return sharedStrings[parseInt(vm[1], 10)] ?? '';
  return xmlUnescape(vm[1]);
}

function parseSheetRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRe = /<row r="(\d+)"[^>]*?(\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(sheetXml))) {
    const rowNum = parseInt(rm[1], 10);
    const inner = rm[3] || '';
    const cells = [];
    // Attrs group MUST be non-greedy: a greedy `[^>]*` swallows the trailing
    // "/" of a self-closing "<c .../>" cell (since "/" isn't excluded by
    // [^>]), which shifts every subsequent cell in the row by one column.
    const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(inner))) {
      const col = colLetterToIndex(cm[1]);
      const attrs = cm[2];
      const cellInner = cm[4] || '';
      const tMatch = /t="([^"]+)"/.exec(attrs);
      const type = tMatch ? tMatch[1] : undefined;
      const val = cellInner ? cellValue(sharedStrings, cellInner, type) : '';
      cells.push({ col, val });
    }
    rows.push({ rowNum, cells });
  }
  return rows;
}

function rowToArray(row, width) {
  const arr = new Array(width).fill('');
  for (const c of row.cells) if (c.col < width) arr[c.col] = c.val;
  return arr;
}

function detectHeader(rows) {
  for (const row of rows.slice(0, 3)) {
    const signalsHit = new Set();
    for (const c of row.cells) {
      if (!c.val) continue;
      for (const s of headerSignals(c.val)) signalsHit.add(s);
    }
    if (signalsHit.size >= 2) return row;
  }
  return null;
}

function buildColumnMap(headerArr) {
  const norm = headerArr.map(normalizeHeader);
  const find = (pred) => norm.findIndex(pred);

  const imageCol = find((h) => h.includes('IMAGE'));
  const dimCol = find((h) => h.includes('DIMENSION'));
  const descCol = find((h) => h.includes('ITEM DESCRIPTIONS'));

  let skuCol = find((h) => h.includes('ITEM CODE'));
  if (skuCol === -1 && imageCol > 0) skuCol = imageCol - 1;

  const priceCols = [];
  norm.forEach((h, i) => {
    if (h.includes('PRICE') && !h.includes('TOTAL')) priceCols.push(i);
  });
  let priceCol = -1;
  if (priceCols.length === 1) priceCol = priceCols[0];
  else if (priceCols.length > 1) {
    priceCol = priceCols.find((i) => norm[i].includes('PACKAGE')) ?? priceCols[0];
  }

  return {
    skuCol,
    imageCol,
    dimCol,
    descCol,
    priceCol,
    priceColHeader: priceCol >= 0 ? headerArr[priceCol] : null,
    multiplePriceColumns: priceCols.length > 1,
    dimIsMergedWithDesc: dimCol !== -1 && dimCol === descCol,
  };
}

// 1 EMU = 1/914400 inch; at the standard 96dpi Excel/Office assumes for
// on-screen sizing, that's 9525 EMU per pixel.
const EMU_PER_PIXEL = 9525;

function parseXfrm(xfrmInner) {
  const off = /<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(xfrmInner);
  const ext = /<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/.exec(xfrmInner);
  const chOff = /<a:chOff x="(-?\d+)" y="(-?\d+)"\s*\/>/.exec(xfrmInner);
  const chExt = /<a:chExt cx="(\d+)" cy="(\d+)"\s*\/>/.exec(xfrmInner);
  return {
    ext: ext ? { cx: parseInt(ext[1], 10), cy: parseInt(ext[2], 10) } : null,
    chExt: chExt ? { cx: parseInt(chExt[1], 10), cy: parseInt(chExt[2], 10) } : null,
  };
}

// A <xdr:pic>'s <a:blipFill> can carry an <a:srcRect l t r b/> — a crop of
// the SOURCE image (in 1000ths of a percent from each edge) that Excel
// applies before stretching the remainder into the picture's box. Ignoring
// this shows the whole source file instead of just the region the original
// sheet actually intended to display (seen for real: a full shower unit
// photo reused elsewhere, cropped down here to just its valve/mixer area).
function parseSrcRect(picXml) {
  const m = /<a:srcRect\s+([^/]*)\/>/.exec(picXml);
  if (!m) return null;
  const attrs = m[1];
  const get = (name) => {
    const am = new RegExp(`${name}="(-?\\d+)"`).exec(attrs);
    return am ? parseInt(am[1], 10) / 100000 : 0; // ST_Percentage: 100000 units = 100%
  };
  const crop = { left: get('l'), top: get('t'), right: get('r'), bottom: get('b') };
  if (crop.left === 0 && crop.top === 0 && crop.right === 0 && crop.bottom === 0) return null;
  return crop;
}

// Every <xdr:pic> carries its OWN <xdr:spPr><a:xfrm><a:ext cx cy/></a:xfrm> —
// the real display size it was drawn at in the source sheet, independent of
// the raw pixel resolution of the image file itself (which is usually much
// larger). For a pic directly under an anchor this ext IS already real EMU.
// For a pic nested inside a <xdr:grpSp>, its ext is expressed in the GROUP's
// own child coordinate space (chExt) and must be rescaled by the group's
// real-vs-child extent ratio to get the true on-sheet size.
function picsInXml(xml, embedToMedia, scale) {
  const out = [];
  const picRe = /<xdr:pic>([\s\S]*?)<\/xdr:pic>/g;
  let pm;
  while ((pm = picRe.exec(xml))) {
    const picXml = pm[1];
    const embedM = /<a:blip[^>]*r:embed="(rId\d+)"/.exec(picXml);
    if (!embedM) continue;
    const media = embedToMedia.get(embedM[1]);
    if (!media) continue;
    const xfrmM = /<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(picXml);
    const { ext } = xfrmM ? parseXfrm(xfrmM[1]) : { ext: null };
    const widthPx = ext ? Math.max(1, Math.round((ext.cx * scale.x) / EMU_PER_PIXEL)) : null;
    const heightPx = ext ? Math.max(1, Math.round((ext.cy * scale.y) / EMU_PER_PIXEL)) : null;
    const crop = parseSrcRect(picXml);
    out.push({ mediaPath: media, widthPx, heightPx, crop });
  }
  return out;
}

function picsWithSizeInAnchor(anchorBlock, embedToMedia) {
  const items = [];
  const grpRe = /<xdr:grpSp>([\s\S]*?)<\/xdr:grpSp>/g;
  let gm;
  while ((gm = grpRe.exec(anchorBlock))) {
    const grpXml = gm[1];
    const grpSpPrM = /<xdr:grpSpPr>([\s\S]*?)<\/xdr:grpSpPr>/.exec(grpXml);
    const grpXfrmM = grpSpPrM ? /<a:xfrm[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(grpSpPrM[1]) : null;
    const { ext, chExt } = grpXfrmM ? parseXfrm(grpXfrmM[1]) : { ext: null, chExt: null };
    const scale = {
      x: ext && chExt && chExt.cx ? ext.cx / chExt.cx : 1,
      y: ext && chExt && chExt.cy ? ext.cy / chExt.cy : 1,
    };
    items.push(...picsInXml(grpXml, embedToMedia, scale));
  }
  // Strip grouped blocks before scanning for ungrouped pics so a grouped
  // child's blip isn't also picked up (and mis-sized) as an ungrouped one.
  const ungrouped = anchorBlock.replace(/<xdr:grpSp>[\s\S]*?<\/xdr:grpSp>/g, '');
  items.push(...picsInXml(ungrouped, embedToMedia, { x: 1, y: 1 }));
  return items;
}

async function parseDrawingForSheet(zip, sheetTarget) {
  const base = basename(sheetTarget);
  const relsXml = await zip.readText(`xl/worksheets/_rels/${base}.rels`);
  if (!relsXml) return { anchors: [], embedToMedia: new Map() };
  const dm = /<Relationship[^>]*Type="[^"]*\/drawing"[^>]*Target="([^"]+)"/.exec(relsXml);
  if (!dm) return { anchors: [], embedToMedia: new Map() };

  const drawingFile = basename(dm[1]);
  const drawingPath = `xl/drawings/${drawingFile}`;
  const drawXml = await zip.readText(drawingPath);
  if (!drawXml) return { anchors: [], embedToMedia: new Map() };

  const drawingRelsXml = (await zip.readText(`xl/drawings/_rels/${drawingFile}.rels`)) || '';
  const embedToMedia = new Map();
  {
    const re = /<Relationship Id="(rId\d+)"[^>]*Target="\.\.\/media\/([^"]+)"/g;
    let m;
    while ((m = re.exec(drawingRelsXml))) embedToMedia.set(m[1], `xl/media/${m[2]}`);
  }

  const anchors = [];
  const anchorRe = /<xdr:(twoCellAnchor|oneCellAnchor)[^>]*>([\s\S]*?)<\/xdr:\1>/g;
  let am;
  while ((am = anchorRe.exec(drawXml))) {
    const block = am[2];
    const fromM = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/.exec(block);
    if (!fromM) continue;
    const col = parseInt(fromM[1], 10);
    const row = parseInt(fromM[2], 10); // 0-based
    // A single anchor can wrap a <xdr:grpSp> with several <xdr:pic> children
    // (the 22 grouped shapes) — picsWithSizeInAnchor grabs every blip in the
    // block regardless of nesting, so none are dropped, each with its real
    // on-sheet display size.
    const items = picsWithSizeInAnchor(block, embedToMedia);
    if (items.length === 0) continue; // non-picture shape (textbox etc.)
    anchors.push({ col, row, items });
  }
  return { anchors };
}

function normalizeSku(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function parsePrice(raw) {
  const s = raw.trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{readText(path:string): Promise<string|null>, readBuffer(path:string): Promise<Uint8Array|Buffer|null>}} zip
 *   Already-opened zip reader — see scripts/lib/zip.js (Node) or
 *   lib/catalog-import/zip-browser.js (browser) for implementations.
 * @param {{ skipSheets?: string[], onProgress?: (info: {current:number,total:number,sheetName:string}) => void }} [opts]
 */
async function parseWorkbook(zip, opts = {}) {
  const skipSheetNames = new Set(opts.skipSheets || ['EMPTY', 'Sheet1']);

  const ssXml = (await zip.readText('xl/sharedStrings.xml')) || '';
  const sharedStrings = [];
  {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(ssXml))) {
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let tm,
        text = '',
        found = false;
      while ((tm = tRe.exec(m[1]))) {
        text += xmlUnescape(tm[1]);
        found = true;
      }
      sharedStrings.push(found ? text : '');
    }
  }

  const wbXml = await zip.readText('xl/workbook.xml');
  const sheetDefs = [];
  {
    const re = /<sheet name="([^"]*)" sheetId="(\d+)"[^>]*r:id="(rId\d+)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(wbXml))) sheetDefs.push({ name: xmlUnescape(m[1]), rId: m[3] });
  }
  const wbRelsXml = await zip.readText('xl/_rels/workbook.xml.rels');
  const relTarget = new Map();
  {
    const re = /<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
    let m;
    while ((m = re.exec(wbRelsXml))) relTarget.set(m[1], m[2]);
  }

  const skippedSheets = [];
  const products = [];
  const sheetsWithMultiplePriceColumns = [];
  const sheetsProcessed = [];

  let sheetIdx = 0;
  for (const def of sheetDefs) {
    sheetIdx++;
    opts.onProgress?.({ current: sheetIdx, total: sheetDefs.length, sheetName: def.name });

    if (skipSheetNames.has(def.name)) {
      skippedSheets.push({ name: def.name, reason: 'excluded by name (non-product sheet)' });
      continue;
    }

    const target = 'xl/' + relTarget.get(def.rId).replace(/^\/?xl\//, '');
    const sheetXml = await zip.readText(target);
    if (!sheetXml) {
      skippedSheets.push({ name: def.name, reason: 'worksheet part missing from archive' });
      continue;
    }

    const rows = parseSheetRows(sheetXml, sharedStrings);
    const headerRow = detectHeader(rows);
    if (!headerRow) {
      skippedSheets.push({ name: def.name, reason: 'no header row detected in first 3 rows' });
      continue;
    }

    const width = Math.max(0, ...headerRow.cells.map((c) => c.col)) + 1;
    const headerArr = rowToArray(headerRow, width);
    const colMap = buildColumnMap(headerArr);

    if (colMap.skuCol === -1) {
      skippedSheets.push({ name: def.name, reason: 'no ITEM CODE column and no IMAGE column to fall back from' });
      continue;
    }
    if (colMap.multiplePriceColumns) sheetsWithMultiplePriceColumns.push(def.name);

    const { anchors } = await parseDrawingForSheet(zip, target);
    const anchorsByRow = new Map();
    for (const a of anchors) {
      if (!anchorsByRow.has(a.row)) anchorsByRow.set(a.row, []);
      anchorsByRow.get(a.row).push(a);
    }

    let rowsWithCodeNoImage = 0;
    let rowsImported = 0;

    for (const row of rows) {
      if (row.rowNum <= headerRow.rowNum) continue;
      const arr = rowToArray(row, width);
      const rawCode = (arr[colMap.skuCol] || '').trim();
      if (!rawCode) continue; // section banners, blank rows, service-only rows

      const desc = (colMap.descCol >= 0 ? arr[colMap.descCol] : '').replace(/\r\n/g, '\n');
      const priceRaw = colMap.priceCol >= 0 ? arr[colMap.priceCol] : '';
      const price = parsePrice(priceRaw);
      const priceMissing = price === null;

      const rowAnchors = anchorsByRow.get(row.rowNum - 1) || [];
      const images = [];
      const imageCrops = []; // parallel to images: {left,top,right,bottom} fractions, or null (no crop)
      const dimensions = [];
      const dimensionCrops = []; // parallel to dimensions
      const descImages = [];
      const descImageSizes = []; // parallel to descImages: {width,height}px from the source anchor, or null
      const descImageCrops = []; // parallel to descImages
      for (const a of rowAnchors) {
        let bucket, cropBucket;
        let isDesc = false;
        if (colMap.dimIsMergedWithDesc) {
          bucket = images;
          cropBucket = imageCrops;
        } else if (a.col === colMap.imageCol) {
          bucket = images;
          cropBucket = imageCrops;
        } else if (a.col === colMap.dimCol) {
          bucket = dimensions;
          cropBucket = dimensionCrops;
        } else if (a.col === colMap.descCol) {
          bucket = descImages;
          cropBucket = descImageCrops;
          isDesc = true;
        } else {
          bucket = images; // genuinely unclassified anchor (some other column): don't drop it
          cropBucket = imageCrops;
        }
        for (const item of a.items) {
          bucket.push(item.mediaPath);
          cropBucket.push(item.crop || null);
          if (isDesc) {
            descImageSizes.push(item.widthPx && item.heightPx ? { width: item.widthPx, height: item.heightPx } : null);
          }
        }
      }
      if (rowAnchors.length === 0) rowsWithCodeNoImage++;

      products.push({
        sku: rawCode,
        skuKey: normalizeSku(rawCode),
        brand: def.name,
        desc,
        price,
        priceMissing,
        imageMediaPaths: images,
        imageCrops,
        dimensionMediaPaths: dimensions,
        dimensionCrops,
        descImageMediaPaths: descImages,
        descImageSizes,
        descImageCrops,
        sourceSheet: def.name,
        sourceRow: row.rowNum,
      });
      rowsImported++;
    }

    sheetsProcessed.push({
      name: def.name,
      rowsImported,
      rowsWithCodeNoImage,
      priceColHeader: colMap.priceColHeader,
    });
  }

  return { zip, products, skippedSheets, sheetsProcessed, sheetsWithMultiplePriceColumns };
}

module.exports = { parseWorkbook, normalizeSku, parsePrice };
