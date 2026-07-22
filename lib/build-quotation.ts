// Builds the quotation .xlsx workbook — the whole reason this app exists
// instead of a spreadsheet. Runs server-side (Node runtime only: uses sharp).
import ExcelJS from 'exceljs';
import sharp from 'sharp';

export interface SessionInfo {
  customer: string;
  project: string;
  attn: string;
  ref: string;
  date: string;
}

export interface QuoteItem {
  sku: string;
  desc: string;
  // null = a deliberate blank line (no SKU typed, price genuinely unknown).
  // Its unit price / total cells are left empty rather than showing RM0,
  // which would read as an error on a customer-facing quotation.
  price: number | null;
  qty: number;
  discount: number;
  // Set when he's negotiated the net price directly ("make it 350") —
  // authoritative over `discount` when present. See netUnitPrice() below.
  netPriceOverride?: number | null;
  area: string;
  sub: string;
  images?: string[];
  // Parallel to images (same index = same image): the pixel size that image
  // was drawn at in the source spreadsheet. When present, the export
  // reproduces that original size (shrinking only if it wouldn't otherwise
  // fit) instead of stretching/shrinking it to fill the cell.
  imageSizes?: ({ width: number; height: number } | null)[];
  dimensions?: string[];
  // Parallel to dimensions.
  dimensionSizes?: ({ width: number; height: number } | null)[];
  // Images anchored over ITEM DESCRIPTIONS in the source spreadsheet — placed
  // inside the description cell itself (stacked below the text) rather than
  // the IMAGE column. See placeStackedImagesBelow() below.
  descImages?: string[];
  // Parallel to descImages.
  descImageSizes?: ({ width: number; height: number } | null)[];
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const COL = { NO: 1, ITEM_CODE: 2, IMAGE: 3, DESC: 4, DIMENSION: 5, QTY: 6, UNIT_PRICE: 7, TOTAL: 8 } as const;
// ITEM_CODE is 26 (not 20): the median real SKU is ~8 chars and wraps fine
// either way, but the ~19-22 char range (real examples: "FFAS4956-601440BF0")
// was breaking into 4 choppy lines at 20 — 26 gives those room to wrap
// cleanly into 1-2 lines instead. Genuinely long outliers (up to ~42 chars)
// still wrap into several lines regardless of width; that's expected.
const COL_WIDTHS = [6, 26, 22, 45, 22, 6, 14, 14];
const ITEM_ROW_HEIGHT = 95; // points — within the 90-110 range that fits images legibly
const MONEY_FMT = '#,##0'; // whole ringgit only — no cents anywhere
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

// Whole ringgit only, standard rounding (.5 and above rounds up). Math.round
// already does this for the non-negative amounts a quotation deals in.
function roundRM(n: number): number {
  return Math.round(n);
}

function money(n: number): string {
  return 'RM' + roundRM(Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Rounding order matters: round the net unit price itself, then multiply by
// the (integer) quantity for the line total — never round after multiplying.
// That's the only way the customer can multiply the displayed unit price by
// quantity in their head and land on the exact total.
//
// A manual netPriceOverride is authoritative and bypasses the discount
// formula entirely: recomputing it from a rounded discount% would not
// reliably reproduce the exact number he negotiated (unit 540, override 350
// → discount rounds to 35%, but 540*0.65 = 351, not 350).
function netUnitPrice(it: QuoteItem): number {
  if (it.netPriceOverride !== null && it.netPriceOverride !== undefined) return roundRM(it.netPriceOverride);
  return roundRM((Number(it.price) || 0) * (1 - (Number(it.discount) || 0) / 100));
}

function lineTotal(it: QuoteItem): number {
  return netUnitPrice(it) * (Number(it.qty) || 0);
}

// Some catalogue SKUs carry stray line breaks from the source spreadsheet
// (a cell whose text wrapped across multiple lines in the original workbook,
// e.g. "AS-6090-D1\n&\nWVK-2ER"). The ITEM CODE column has no wrapText, so a
// literal line break still forces multi-line rendering (Excel always honours
// manual line breaks regardless of the Wrap Text setting) — collapsing it
// to a single line here is what actually fixes that, independent of
// whatever the catalogue happens to contain.
function normalizeSku(sku: string): string {
  return sku.replace(/\s+/g, ' ').trim();
}

// Some catalogue descriptions already carry a hardcoded "List Price: RM..."
// line from the source spreadsheet — strip it before (maybe) appending a
// fresh one, so the exported cell never shows two.
function stripListPriceLine(desc: string): string {
  return desc
    .split('\n')
    .filter((line) => !line.trim().toUpperCase().startsWith('LIST PRICE:'))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

interface GroupedSub {
  name: string;
  rows: QuoteItem[];
}
interface GroupedArea {
  name: string;
  subs: GroupedSub[];
}

function groupItems(items: QuoteItem[]): GroupedArea[] {
  const areas: GroupedArea[] = [];
  const areaByName = new Map<string, GroupedArea>();
  for (const it of items) {
    const areaName = it.area || 'UNSPECIFIED AREA';
    let area = areaByName.get(areaName);
    if (!area) {
      area = { name: areaName, subs: [] };
      areaByName.set(areaName, area);
      areas.push(area);
    }
    const subName = it.sub || '';
    let sub = area.subs.find((s) => s.name === subName);
    if (!sub) {
      sub = { name: subName, rows: [] };
      area.subs.push(sub);
    }
    sub.rows.push(it);
  }
  return areas;
}

// ---------------------------------------------------------------------------
// Image fetching
// ---------------------------------------------------------------------------

interface FetchedImage {
  buffer: Buffer;
  width: number;
  height: number;
  extension: 'jpeg' | 'png';
}

function resolveImageUrl(url: string, publicBase: string | undefined): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (publicBase || '').replace(/\/+$/, '');
  return `${base}/${url.replace(/^\/+/, '')}`;
}

async function fetchImage(url: string): Promise<FetchedImage | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return null;

    // exceljs only embeds jpeg/png/gif. Normalize anything else (webp, or the
    // handful of raw-passthrough .emf/.wdp files a sheet might reference) to
    // PNG. If sharp can't decode it at all, the catch below treats it as a
    // failed fetch and the cell is simply left blank.
    if (meta.format === 'jpeg') return { buffer, width: meta.width, height: meta.height, extension: 'jpeg' };
    if (meta.format === 'png') return { buffer, width: meta.width, height: meta.height, extension: 'png' };
    const png = await sharp(buffer).png().toBuffer();
    const pngMeta = await sharp(png).metadata();
    return { buffer: png, width: pngMeta.width || meta.width, height: pngMeta.height || meta.height, extension: 'png' };
  } catch {
    return null; // network error, timeout, or undecodable image — never crash the export over one file
  }
}

async function buildImageCache(items: QuoteItem[], publicBase: string | undefined): Promise<Map<string, FetchedImage | null>> {
  const urls = new Set<string>();
  for (const it of items) {
    for (const u of it.images || []) urls.add(resolveImageUrl(u, publicBase));
    for (const u of it.dimensions || []) urls.add(resolveImageUrl(u, publicBase));
    for (const u of it.descImages || []) urls.add(resolveImageUrl(u, publicBase));
  }
  const cache = new Map<string, FetchedImage | null>();
  // Fetched in parallel and cached by URL, so a SKU reused across several
  // bathrooms is only downloaded once regardless of how many rows need it.
  await Promise.all(
    [...urls].map(async (url) => {
      cache.set(url, await fetchImage(url));
    })
  );
  return cache;
}

// Excel's own approximate character-width-to-pixel conversion — good enough
// for sizing embedded images, not pixel-perfect.
function colWidthToPixels(chars: number): number {
  return Math.round(chars * 7 + 5);
}

function fitWithin(naturalW: number, naturalH: number, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(maxW / naturalW, maxH / naturalH, 4); // cap upscale so tiny icons don't pixelate
  return { width: Math.max(1, Math.round(naturalW * scale)), height: Math.max(1, Math.round(naturalH * scale)) };
}

// True EMU conversions (1 point = 12700 EMU, 1 px at 96dpi = 9525 EMU).
// This matters: exceljs's fractional `tl: {col, row}` anchor API computes its
// row offset as `points * 10000` and writes that number straight into the
// XML as if it were already EMU — but real EMU-per-point is 12700, not
// 10000. That ~21% shortfall silently drags every fractional row position
// toward the top of the cell, which is exactly what turned an intended gap
// between two stacked images into a ~5pt overlap. Passing nativeRow/
// nativeRowOff (and nativeCol/nativeColOff) directly bypasses that
// conversion entirely and gives pixel-accurate placement on both axes.
const EMU_PER_POINT = 12700;
const EMU_PER_PIXEL = 9525;

// exceljs's own .d.ts declares a conflicting ambient `Buffer` shim
// (`interface Buffer extends ArrayBuffer {}`) that clashes with @types/node's
// real Buffer under the esnext lib — a type-only mismatch (the value is a
// genuine Buffer at runtime), so callers cast the object literal wholesale
// rather than fighting the merged global type.
function getOrAddImage(workbook: ExcelJS.Workbook, imageIdCache: Map<string, number>, url: string, img: FetchedImage): number {
  let imageId = imageIdCache.get(url);
  if (imageId === undefined) {
    imageId = workbook.addImage({ buffer: img.buffer, extension: img.extension } as unknown as ExcelJS.Image);
    imageIdCache.set(url, imageId);
  }
  return imageId;
}

/** Places a pre-measured stack of images, centred as a group both
 *  horizontally and vertically, within a single cell spanning rowHeightPts. */
function placeStackedImagesCentered(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imageIdCache: Map<string, number>,
  available: { url: string; img: FetchedImage }[],
  sizes: { width: number; height: number }[],
  colIndex0: number,
  rowIndex0: number,
  colWidthChars: number,
  rowHeightPts: number
) {
  if (available.length === 0) return;

  const cellWidthPx = colWidthToPixels(colWidthChars);
  const cellWidthEmu = cellWidthPx * EMU_PER_PIXEL;
  const rowHeightEmu = rowHeightPts * EMU_PER_POINT;
  const gapEmu = IMAGE_STACK_GAP_PX * EMU_PER_PIXEL;

  const totalContentHeightEmu =
    sizes.reduce((s, sz) => s + sz.height * EMU_PER_PIXEL, 0) + Math.max(0, sizes.length - 1) * gapEmu;
  let cursorEmu = Math.max(0, Math.round((rowHeightEmu - totalContentHeightEmu) / 2));

  available.forEach(({ url, img }, i) => {
    const imageId = getOrAddImage(workbook, imageIdCache, url, img);
    const { width, height } = sizes[i];
    const widthEmu = width * EMU_PER_PIXEL;
    const heightEmu = height * EMU_PER_PIXEL;
    const colOffEmu = Math.max(0, Math.round((cellWidthEmu - widthEmu) / 2));

    worksheet.addImage(imageId, {
      tl: {
        nativeCol: colIndex0,
        nativeColOff: colOffEmu,
        nativeRow: rowIndex0,
        nativeRowOff: Math.round(cursorEmu),
      },
      ext: { width, height },
    } as unknown as ExcelJS.ImagePosition);

    cursorEmu += heightEmu + gapEmu;
  });
}

// ---------------------------------------------------------------------------
// Image sizing — shared by the IMAGE, DIMENSION, and ITEM DESCRIPTIONS
// columns: every one of them now reproduces the image at the size it was
// actually drawn at in the source spreadsheet (only shrinking, never
// stretching), instead of fitting/stretching to whatever the cell's fixed
// size happens to be. Row height then grows to whatever the tallest column
// (text, images, dimensions, or descImages) actually needs.
// ---------------------------------------------------------------------------
const IMAGE_STACK_GAP_PX = 3; // gap between stacked images in any column
const CELL_PAD_PX = 4; // breathing room from a cell's borders

// Fallback cap used only when an image's original source-sheet size isn't
// known (older catalogue data, or a re-import that hasn't run yet).
const IMAGE_FALLBACK_MAX_HEIGHT_PX = 120; // roughly the old fixed-row-derived size for the IMAGE/DIMENSION columns
const DESC_IMAGE_FALLBACK_MAX_HEIGHT_PX = 100; // smaller: descImages are supporting illustrations, not the main photo

// When the original size IS known, it's used as-is (never upscaled) and only
// shrunk if it wouldn't otherwise fit — these are generous safety nets
// against a pathological outlier, not the normal constraint.
const IMAGE_SAFETY_MAX_HEIGHT_PX = 400; // the IMAGE/DIMENSION columns' own product photo can legitimately be tall
const DESC_IMAGE_SAFETY_MAX_HEIGHT_PX = 260; // descImages seen in the real catalogue are well under 230px

/** Fits an image at its own natural size, only shrinking (never enlarging)
 *  to stay within the given bounds — reproduces "how big it was originally
 *  drawn" rather than stretching to fill the available space. */
function fitOriginalSize(naturalW: number, naturalH: number, maxW: number, maxH: number): { width: number; height: number } {
  const scale = Math.min(1, maxW / naturalW, maxH / naturalH);
  return { width: Math.max(1, Math.round(naturalW * scale)), height: Math.max(1, Math.round(naturalH * scale)) };
}

/** Scaled (aspect-preserved) heights for a stack of images, plus which URLs
 *  actually resolved — shared between the row-height calculation and the
 *  actual placement so the two never drift apart.
 *
 *  When originalSizes[i] is known (the pixel size that image was drawn at
 *  in the source spreadsheet), it's reproduced as-is, only shrunk if it
 *  wouldn't otherwise fit — never stretched up to fill the cell. Falls back
 *  to fitting the fetched image's raw resolution under fallbackMaxHeightPx
 *  for the (older-data) case where the original size wasn't captured. */
function measureStackedImages(
  urls: string[],
  fetchedCache: Map<string, FetchedImage | null>,
  colWidthChars: number,
  originalSizes: ({ width: number; height: number } | null)[] | undefined,
  fallbackMaxHeightPx: number,
  safetyMaxHeightPx: number
): { available: { url: string; img: FetchedImage }[]; sizes: { width: number; height: number }[]; totalHeightPx: number } {
  const available = urls
    .map((url, i) => ({ url, img: fetchedCache.get(url), originalSize: originalSizes?.[i] ?? null }))
    .filter((x): x is { url: string; img: FetchedImage; originalSize: { width: number; height: number } | null } => !!x.img);

  const cellWidthPx = colWidthToPixels(colWidthChars);
  const maxWidthPx = cellWidthPx - CELL_PAD_PX * 2;

  const sizes = available.map(({ img, originalSize }) =>
    originalSize
      ? fitOriginalSize(originalSize.width, originalSize.height, maxWidthPx, safetyMaxHeightPx)
      : fitWithin(img.width, img.height, maxWidthPx, fallbackMaxHeightPx)
  );
  const totalHeightPx =
    sizes.reduce((s, sz) => s + sz.height, 0) +
    Math.max(0, sizes.length - 1) * IMAGE_STACK_GAP_PX +
    (sizes.length > 0 ? CELL_PAD_PX * 2 : 0);

  return { available, sizes, totalHeightPx };
}

// ---------------------------------------------------------------------------
// Description-column images
// ---------------------------------------------------------------------------
// Text and images can't interleave inside one Excel cell: the description
// cell's text always renders as one block, so descImages are stacked BELOW
// it within the same cell, and the row is made tall enough to fit both.
// There's no real text-layout API available here (ExcelJS doesn't measure
// rendered text), so the text block height is an estimate from character
// count and the column's character width — good enough to avoid clipping in
// the common case, not a pixel-exact reproduction of Excel's own wrapping.
const DESC_FONT_SIZE_PT = 11; // matches the worksheet's default font (Calibri 11)
const LINE_HEIGHT_FACTOR = 1.2; // standard single-spacing approximation
const DESC_TEXT_TOP_PAD_PT = 4;
const DESC_TEXT_BOTTOM_PAD_PT = 4;
const DESC_IMAGE_GAP_PT = 6; // gap between the text block and the first image

function estimateTextHeightPt(text: string, colWidthChars: number, fontSizePt = DESC_FONT_SIZE_PT): number {
  if (!text) return 0;
  // colWidthChars is already Excel's own "chars of the default font" unit,
  // so it doubles directly as an estimate of characters-per-wrapped-line.
  const charsPerLine = Math.max(10, colWidthChars - 3); // small deduction for cell padding
  const lines = text.split('\n');
  let totalWrappedLines = 0;
  for (const line of lines) totalWrappedLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  return totalWrappedLines * fontSizePt * LINE_HEIGHT_FACTOR;
}

/** Places a pre-measured stack of images centred horizontally in a column,
 *  starting at a given vertical offset (below the description text). */
function placeStackedImagesBelow(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imageIdCache: Map<string, number>,
  available: { url: string; img: FetchedImage }[],
  sizes: { width: number; height: number }[],
  colIndex0: number,
  rowIndex0: number,
  colWidthChars: number,
  topOffsetPt: number
) {
  if (available.length === 0) return;

  const cellWidthPx = colWidthToPixels(colWidthChars);
  const cellWidthEmu = cellWidthPx * EMU_PER_PIXEL;
  const padEmu = CELL_PAD_PX * EMU_PER_PIXEL;
  const gapEmu = IMAGE_STACK_GAP_PX * EMU_PER_PIXEL;

  let cursorEmu = topOffsetPt * EMU_PER_POINT + padEmu;

  available.forEach(({ url, img }, i) => {
    const imageId = getOrAddImage(workbook, imageIdCache, url, img);
    const { width, height } = sizes[i];
    const widthEmu = width * EMU_PER_PIXEL;
    const heightEmu = height * EMU_PER_PIXEL;
    const colOffEmu = Math.max(0, Math.round((cellWidthEmu - widthEmu) / 2));

    worksheet.addImage(imageId, {
      tl: {
        nativeCol: colIndex0,
        nativeColOff: colOffEmu,
        nativeRow: rowIndex0,
        nativeRowOff: Math.round(cursorEmu),
      },
      ext: { width, height },
    } as unknown as ExcelJS.ImagePosition);

    cursorEmu += heightEmu + gapEmu;
  });
}

// ---------------------------------------------------------------------------
// Styling helpers
// ---------------------------------------------------------------------------

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function applyThinBorders(row: ExcelJS.Row, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) row.getCell(c).border = THIN;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildQuotationWorkbook(session: SessionInfo, items: QuoteItem[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Quotation App';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Quotation');

  worksheet.columns = COL_WIDTHS.map((width) => ({ width }));

  // --- header block (rows 1-5) ---
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = 'QUOTATION';
  titleCell.font = { bold: true, size: 16 };

  worksheet.getCell(2, 1).value = `To: ${session.customer || ''}`;
  worksheet.getCell(2, COL.DESC).value = `Our Ref: ${session.ref || ''}`;
  worksheet.getCell(3, 1).value = session.project || '';
  worksheet.getCell(3, COL.DESC).value = `Date: ${session.date || ''}`;
  worksheet.getCell(4, 1).value = `Attn: ${session.attn || ''}`;
  // row 5 intentionally blank as a spacer

  // --- table header (row 6) ---
  const headerRowNumber = 6;
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.values = ['NO', 'ITEM CODE', 'IMAGE', 'ITEM DESCRIPTIONS', 'DIMENSION', 'QTY', 'UNIT PRICE', 'TOTAL (RM)'];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  applyThinBorders(headerRow, 1, 8);

  const publicBase = process.env.R2_PUBLIC_URL;
  const imageCache = await buildImageCache(items, publicBase);
  const imageIdCache = new Map<string, number>();

  const grouped = groupItems(items);
  let rowNumber = headerRowNumber + 1;
  let grandTotal = 0;

  for (let ai = 0; ai < grouped.length; ai++) {
    const area = grouped[ai];
    const areaTotal = area.subs.flatMap((s) => s.rows).reduce((s, it) => s + lineTotal(it), 0);

    const areaRow = worksheet.getRow(rowNumber);
    areaRow.getCell(1).value = `${LETTERS[ai] || '?'}) ${String(area.name).toUpperCase()}`;
    areaRow.getCell(COL.QTY).value = `Subtotal: ${money(areaTotal)}`;
    worksheet.mergeCells(rowNumber, 1, rowNumber, COL.DIMENSION);
    worksheet.mergeCells(rowNumber, COL.QTY, rowNumber, COL.TOTAL);
    areaRow.font = { bold: true };
    areaRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAEAEA' } };
      cell.alignment = { vertical: 'middle' };
    });
    // Set explicitly on the two merge-master cells last: eachCell appears to
    // revisit the same master Cell object for every column spanned by a
    // merge, so a per-column conditional inside that loop gets clobbered by
    // its own later iterations — this must run after the loop to stick.
    areaRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    areaRow.getCell(COL.QTY).alignment = { horizontal: 'right', vertical: 'middle' };
    applyThinBorders(areaRow, 1, 8);
    rowNumber++;

    for (let si = 0; si < area.subs.length; si++) {
      const sub = area.subs[si];
      if (sub.name) {
        const subRow = worksheet.getRow(rowNumber);
        subRow.getCell(1).value = `${ROMAN[si] || si + 1}) ${sub.name}`;
        subRow.getCell(1).font = { italic: true };
        subRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
        rowNumber++;
      }

      sub.rows.forEach((it, ri) => {
        const row = worksheet.getRow(rowNumber);

        // The discount % itself never appears on the exported quotation —
        // instead, when the price paid differs from the catalogue price, the
        // original list price is shown so the discount is implicit rather
        // than stated as a percentage.
        const baseDesc = stripListPriceLine(it.desc);
        const net = it.price !== null ? netUnitPrice(it) : null;
        const listPrice = it.price !== null ? roundRM(it.price) : null;
        const desc =
          listPrice !== null && net !== null && net !== listPrice
            ? `${baseDesc}\nList Price: ${money(listPrice)}`
            : baseDesc;

        const resolvedImages = (it.images || []).map((u) => resolveImageUrl(u, publicBase));
        const resolvedDims = (it.dimensions || []).map((u) => resolveImageUrl(u, publicBase));
        const resolvedDescImages = (it.descImages || []).map((u) => resolveImageUrl(u, publicBase));

        const imageStack = measureStackedImages(
          resolvedImages,
          imageCache,
          COL_WIDTHS[COL.IMAGE - 1],
          it.imageSizes,
          IMAGE_FALLBACK_MAX_HEIGHT_PX,
          IMAGE_SAFETY_MAX_HEIGHT_PX
        );
        const dimStack = measureStackedImages(
          resolvedDims,
          imageCache,
          COL_WIDTHS[COL.DIMENSION - 1],
          it.dimensionSizes,
          IMAGE_FALLBACK_MAX_HEIGHT_PX,
          IMAGE_SAFETY_MAX_HEIGHT_PX
        );
        const descImageStack = measureStackedImages(
          resolvedDescImages,
          imageCache,
          COL_WIDTHS[COL.DESC - 1],
          it.descImageSizes,
          DESC_IMAGE_FALLBACK_MAX_HEIGHT_PX,
          DESC_IMAGE_SAFETY_MAX_HEIGHT_PX
        );
        const hasDescImages = descImageStack.available.length > 0;

        // Row height is whichever column actually needs the most room: the
        // fixed default, the IMAGE column's own stack, the DIMENSION
        // column's stack, or the description text + its stacked images.
        const pxToPt = EMU_PER_PIXEL / EMU_PER_POINT;
        let textTopOffsetPt = DESC_TEXT_TOP_PAD_PT;
        let descNeededHeightPt = 0;
        if (hasDescImages) {
          const textHeightPt = estimateTextHeightPt(desc, COL_WIDTHS[COL.DESC - 1]);
          descNeededHeightPt =
            DESC_TEXT_TOP_PAD_PT + textHeightPt + DESC_IMAGE_GAP_PT + descImageStack.totalHeightPx * pxToPt + DESC_TEXT_BOTTOM_PAD_PT;
          textTopOffsetPt = DESC_TEXT_TOP_PAD_PT + textHeightPt + DESC_IMAGE_GAP_PT;
        }
        row.height = Math.max(
          ITEM_ROW_HEIGHT,
          descNeededHeightPt,
          imageStack.totalHeightPx * pxToPt,
          dimStack.totalHeightPx * pxToPt
        );

        row.getCell(COL.NO).value = ri + 1;
        row.getCell(COL.ITEM_CODE).value = normalizeSku(it.sku);
        row.getCell(COL.DESC).value = desc;
        row.getCell(COL.QTY).value = Number(it.qty) || 0;
        // A blank line (price === null) leaves these cells genuinely empty —
        // RM0 on a customer-facing quotation reads as a pricing error.
        if (it.price !== null) {
          row.getCell(COL.UNIT_PRICE).value = net;
          row.getCell(COL.TOTAL).value = lineTotal(it);
        }

        // Every column in an item row is vertically centred — the tall row
        // exists to fit the images, and text sitting at the top of that
        // extra height while the images sit centred looked misaligned.
        row.getCell(COL.NO).alignment = { horizontal: 'center', vertical: 'middle' };
        // wrapText so a long SKU wraps onto more lines within its own column
        // instead of visually overflowing past the column boundary into the
        // IMAGE column next to it.
        row.getCell(COL.ITEM_CODE).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        row.getCell(COL.IMAGE).alignment = { horizontal: 'center', vertical: 'middle' };
        // Text sits at the top of the cell when descImages are stacked below
        // it — vertical-centring the text would push it down into the space
        // reserved for the images. Rows with no descImages keep the original
        // vertical-centred look.
        row.getCell(COL.DESC).alignment = {
          horizontal: 'left',
          vertical: hasDescImages ? 'top' : 'middle',
          wrapText: true,
        };
        row.getCell(COL.DIMENSION).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.QTY).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.UNIT_PRICE).numFmt = MONEY_FMT;
        row.getCell(COL.UNIT_PRICE).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.TOTAL).numFmt = MONEY_FMT;
        row.getCell(COL.TOTAL).alignment = { horizontal: 'center', vertical: 'middle' };

        applyThinBorders(row, 1, 8);

        const itemRowHeight = row.height || ITEM_ROW_HEIGHT;
        placeStackedImagesCentered(workbook, worksheet, imageIdCache, imageStack.available, imageStack.sizes, COL.IMAGE - 1, rowNumber - 1, COL_WIDTHS[COL.IMAGE - 1], itemRowHeight);
        placeStackedImagesCentered(workbook, worksheet, imageIdCache, dimStack.available, dimStack.sizes, COL.DIMENSION - 1, rowNumber - 1, COL_WIDTHS[COL.DIMENSION - 1], itemRowHeight);
        if (hasDescImages) {
          placeStackedImagesBelow(
            workbook,
            worksheet,
            imageIdCache,
            descImageStack.available,
            descImageStack.sizes,
            COL.DESC - 1,
            rowNumber - 1,
            COL_WIDTHS[COL.DESC - 1],
            textTopOffsetPt
          );
        }

        grandTotal += lineTotal(it);
        rowNumber++;
      });
    }
  }

  // --- grand total row ---
  rowNumber++; // blank spacer row, matching the reference layout
  const totalRow = worksheet.getRow(rowNumber);
  const labelCell = totalRow.getCell(7);
  const totalCell = totalRow.getCell(8);
  labelCell.value = 'TOTAL (RM):';
  labelCell.font = { bold: true };
  labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
  labelCell.border = { top: { style: 'thin' } };
  totalCell.value = grandTotal; // already whole — sum of already-rounded line totals
  totalCell.numFmt = MONEY_FMT;
  totalCell.font = { bold: true };
  totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
  totalCell.border = { top: { style: 'thin' } };

  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowNumber }];

  return workbook;
}

export function suggestedFilename(session: SessionInfo): string {
  const clean = (s: string) =>
    (s || '')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_') || 'quote';
  return `${clean(session.ref)}_${clean(session.customer)}.xlsx`;
}
