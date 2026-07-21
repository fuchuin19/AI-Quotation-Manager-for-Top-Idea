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
  dimensions?: string[];
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const COL = { NO: 1, ITEM_CODE: 2, IMAGE: 3, DESC: 4, DIMENSION: 5, QTY: 6, UNIT_PRICE: 7, TOTAL: 8 } as const;
const COL_WIDTHS = [6, 20, 22, 45, 22, 6, 14, 14];
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

/** Places one or more images, centred as a group, within a single cell. */
function placeImagesInCell(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  imageIdCache: Map<string, number>,
  urls: string[],
  fetchedCache: Map<string, FetchedImage | null>,
  colIndex0: number,
  rowIndex0: number,
  colWidthChars: number,
  rowHeightPts: number
) {
  const available = urls
    .map((url) => ({ url, img: fetchedCache.get(url) }))
    .filter((x): x is { url: string; img: FetchedImage } => !!x.img);
  if (available.length === 0) return;

  const cellWidthPx = colWidthToPixels(colWidthChars);
  const cellWidthEmu = cellWidthPx * EMU_PER_PIXEL;
  const rowHeightEmu = rowHeightPts * EMU_PER_POINT;

  const padPx = 4; // breathing room from the cell's borders
  const padEmu = padPx * EMU_PER_PIXEL;
  const gapEmu = available.length > 1 ? 3 * EMU_PER_PIXEL : 0; // keeps stacked images from touching
  const usableHeightEmu = rowHeightEmu - padEmu * 2;
  const slotHeightEmu = usableHeightEmu / available.length;
  const maxWidthPx = cellWidthPx - padPx * 2;
  const maxHeightPx = (slotHeightEmu - gapEmu) / EMU_PER_PIXEL;

  available.forEach(({ url, img }, i) => {
    let imageId = imageIdCache.get(url);
    if (imageId === undefined) {
      // exceljs's own .d.ts declares a conflicting ambient `Buffer` shim
      // (`interface Buffer extends ArrayBuffer {}`) that clashes with
      // @types/node's real Buffer under the esnext lib — a type-only
      // mismatch (the value is a genuine Buffer at runtime), so the object
      // literal is cast wholesale rather than fighting the merged global type.
      imageId = workbook.addImage({ buffer: img.buffer, extension: img.extension } as unknown as ExcelJS.Image);
      imageIdCache.set(url, imageId);
    }

    const { width, height } = fitWithin(img.width, img.height, maxWidthPx, maxHeightPx);
    const widthEmu = width * EMU_PER_PIXEL;
    const heightEmu = height * EMU_PER_PIXEL;

    // Centre horizontally within the whole cell.
    const colOffEmu = Math.max(0, Math.round((cellWidthEmu - widthEmu) / 2));
    // Centre vertically within this image's slot (the cell split evenly
    // across however many images are stacked in it).
    const slotTopEmu = padEmu + i * slotHeightEmu;
    const rowOffEmu = Math.max(0, Math.round(slotTopEmu + (slotHeightEmu - heightEmu) / 2));

    worksheet.addImage(imageId, {
      tl: {
        nativeCol: colIndex0,
        nativeColOff: colOffEmu,
        nativeRow: rowIndex0,
        nativeRowOff: rowOffEmu,
      },
      ext: { width, height },
    } as unknown as ExcelJS.ImagePosition);
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
        row.height = ITEM_ROW_HEIGHT;

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

        row.getCell(COL.NO).value = ri + 1;
        row.getCell(COL.ITEM_CODE).value = it.sku;
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
        row.getCell(COL.ITEM_CODE).alignment = { horizontal: 'left', vertical: 'middle' };
        row.getCell(COL.IMAGE).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.DESC).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        row.getCell(COL.DIMENSION).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.QTY).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.UNIT_PRICE).numFmt = MONEY_FMT;
        row.getCell(COL.UNIT_PRICE).alignment = { horizontal: 'center', vertical: 'middle' };
        row.getCell(COL.TOTAL).numFmt = MONEY_FMT;
        row.getCell(COL.TOTAL).alignment = { horizontal: 'center', vertical: 'middle' };

        applyThinBorders(row, 1, 8);

        const resolvedImages = (it.images || []).map((u) => resolveImageUrl(u, publicBase));
        const resolvedDims = (it.dimensions || []).map((u) => resolveImageUrl(u, publicBase));
        placeImagesInCell(workbook, worksheet, imageIdCache, resolvedImages, imageCache, COL.IMAGE - 1, rowNumber - 1, COL_WIDTHS[COL.IMAGE - 1], ITEM_ROW_HEIGHT);
        placeImagesInCell(workbook, worksheet, imageIdCache, resolvedDims, imageCache, COL.DIMENSION - 1, rowNumber - 1, COL_WIDTHS[COL.DIMENSION - 1], ITEM_ROW_HEIGHT);

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
