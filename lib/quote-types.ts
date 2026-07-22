import type { Product } from "./catalog";

export type { Product };

/* ============================ quotation model ============================
 * A Quotation is the persisted, always-saved record (see local-storage.ts).
 * Its editable identity fields (customer/project/attn/ref/date/defaultDiscount)
 * are kept separately in memory as QuotationMeta while it's being actively
 * edited, and merged with `items` at the autosave boundary — see QuoteApp.
 * Sticky area/sub (where the NEXT scan lands) is deliberately NOT part of
 * this record; it's a scanning-session concept, not a quotation property.
 * ========================================================================= */

export interface QuotationMeta {
  id: string;
  ref: string;
  customer: string;
  project: string;
  attn: string;
  date: string;
  defaultDiscount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Quotation extends QuotationMeta {
  items: StoredItem[];
}

/**
 * Persisted form of a line item. Catalogue-backed items are stored compactly
 * (sku/qty/discount/netPrice/area/sub only) to stay well inside localStorage's
 * ~5MB cap — desc/images/dimensions are rehydrated from the catalogue by SKU
 * when a quotation is loaded. `netPrice` is the actual price that was charged,
 * locked in at save time, so reopening an old quotation never silently
 * reprices a line just because the catalogue changed since. From-tag and
 * blank/manual lines aren't in the catalogue at all, so they carry a `full`
 * companion with everything a catalogue lookup would otherwise have supplied.
 */
export interface StoredItem {
  id: string;
  sku: string;
  qty: number;
  discount: number;
  netPrice: number | null;
  area: string;
  sub: string;
  full?: {
    desc: string;
    price: number | null;
    images: string[];
    dimensions: string[];
    fromTag?: boolean;
  };
}

export interface QuoteItem {
  id: string;
  sku: string;
  desc: string;
  /** null only for a deliberate blank line — genuinely no price, ever. */
  price: number | null;
  qty: number;
  discount: number;
  /** Set when he's negotiated the net price directly (e.g. "make it 350") —
   *  authoritative over `discount` when present. See netUnitPrice(). */
  netPriceOverride: number | null;
  area: string;
  sub: string;
  images: string[];
  dimensions: string[];
  /** True when the price came from reading the showroom tag directly rather
   *  than the catalogue — the SKU isn't in the price list yet. */
  fromTag?: boolean;
}

/** The confirmation-card draft before an item is committed to the quotation. */
export interface PendingItem {
  sku: string;
  desc: string;
  /** The currently ACTIVE unit price — whichever of tagPrice/catalogPrice is
   *  selected. This is what the rest of the confirm-sheet math (discount,
   *  net price, total) runs on, same as before this field had two candidates. */
  price: number | null;
  priceMissing: boolean;
  qty: number;
  discount: number;
  netPriceOverride: number | null;
  images: string[];
  dimensions: string[];
  /** Raw text of the price the user types in when priceMissing is true. */
  enteredPrice: string;
  /** True when this draft was built from "Use details from the tag" rather
   *  than a catalogue match — sku/desc become editable and the resulting
   *  item is flagged and logged to the missing-SKU list on commit. Distinct
   *  from priceSource below: this means the SKU itself isn't in the
   *  catalogue, not just that the tag's price was picked over a catalogue one. */
  fromTag?: boolean;
  /** Price read off the showroom tag by Gemini, only set when the SKU WAS
   *  matched in the catalogue and a valid tag price was also read — i.e.
   *  exactly when there are two candidate prices to choose between. */
  tagPrice?: number | null;
  /** The catalogue's own price, kept alongside tagPrice so the confirm sheet
   *  can offer switching back after the tag price was picked by default. */
  catalogPrice?: number | null;
  /** Which of tagPrice/catalogPrice is currently backing `price`. Only
   *  meaningful when both tagPrice and catalogPrice are non-null. */
  priceSource?: "tag" | "catalog";
}

export interface NotFoundState {
  sku: string;
  guessName: string;
  guessPrice: string;
  /** Opened via "Enter code / search" rather than a failed scan. */
  manual?: boolean;
}

/** One row in the running "add this to the price list" to-do log. Deduped by
 *  SKU — repeated sightings update price/date and bump the counter rather
 *  than adding a new row. */
export interface MissingSkuEntry {
  sku: string;
  desc: string;
  price: number;
  date: string;
  count: number;
}

/** /api/scan could not be reached or failed server-side — the photo is kept. */
export interface ScanErrorState {
  file: File;
  message: string;
}

export interface LastDeleted {
  item: QuoteItem;
  index: number;
}

export type ToastTone = "ok" | "warn" | "err";
export interface ToastState {
  msg: string;
  tone: ToastTone;
}

export type ScreenKey = "capture" | "items" | "setup";

export interface ScanFoundResponse {
  found: true;
  product: Product;
  rawSku: string;
  guessPrice: string;
}
export interface ScanNotFoundResponse {
  found: false;
  rawSku: string;
  guessName: string;
  guessPrice: string;
}
export interface ScanApiErrorResponse {
  error: string;
}
export type ScanResponse = ScanFoundResponse | ScanNotFoundResponse | ScanApiErrorResponse;

export const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Whole ringgit only, everywhere — standard rounding (.5 and above rounds
// up). Math.round already does this for the non-negative amounts a
// quotation deals in.
export function roundRM(n: number): number {
  return Math.round(n);
}

// Tags print prices as "RM850", "RM2,100", "RM 2,100", "RM2,100.00", or bare
// "2100". Strip the currency prefix and thousands separators, then round the
// same way every other price in the app is rounded. Anything that doesn't
// come out as a positive number (blank, garbled OCR, "N/A") is treated as no
// price read at all — callers should fall back to the catalogue price.
export function parseTagPrice(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const stripped = String(raw).replace(/RM/gi, "").replace(/,/g, "").trim();
  if (!stripped) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundRM(n);
}

// The OCR safety net: tag and catalogue prices differing by more than 20% is
// worth a quiet flag (glare/angle misread the digits, or the tag really is
// for a different promo) without blocking him from proceeding either way.
export function pricesDiffer(tagPrice: number, catalogPrice: number): boolean {
  if (catalogPrice <= 0) return false;
  return Math.abs(tagPrice - catalogPrice) / catalogPrice > 0.2;
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "RM" + roundRM(n).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// SKUs differ by dashes (LS-5500-BN vs LS-5500TZ) so keep them; only kill case + spaces.
export function normSku(s: string): string {
  return String(s || "").toUpperCase().replace(/\s+/g, "").trim();
}
export function looseSku(s: string): string {
  return normSku(s).replace(/[-_.]/g, "");
}

// Rounding order matters: round the net unit price itself, then multiply by
// the (integer) quantity — never round after multiplying. That's the only
// way the customer can multiply the displayed unit price by quantity in
// their head and land on the exact total.
//
// A manual netPriceOverride (he typed "make it 350") is authoritative and
// bypasses the discount formula entirely — recomputing it from a rounded
// discount% would not reliably reproduce the exact number he negotiated
// (e.g. unit 540, override 350 → discount rounds to 35%, but 540*0.65 = 351,
// not 350).
export function netUnitPrice(price: number | null, discount: number, override?: number | null): number | null {
  if (price === null) return null;
  if (override !== null && override !== undefined) return roundRM(override);
  return roundRM(price * (1 - (Number(discount) || 0) / 100));
}

// null (not 0) for a blank line — callers displaying a single item must let
// that reach money(), which renders "—". Callers summing totals across many
// items must coalesce with `?? 0` themselves (a blank line contributes
// nothing to a subtotal, but must never silently become a priced RM0.00 row).
export function lineTotal(it: Pick<QuoteItem, "price" | "qty" | "discount" | "netPriceOverride">): number | null {
  const net = netUnitPrice(it.price, it.discount, it.netPriceOverride);
  if (net === null) return null;
  return net * (Number(it.qty) || 0);
}

// Discount % implied by an overridden net price, rounded to a whole percent
// for display — e.g. unit 540, net typed as 350 → 35%.
export function impliedDiscount(price: number, net: number): number {
  if (price <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((price - net) / price) * 100)));
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function todayRef(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `PJAQ${yy}${mm}${dd}`;
}

export function todayStr(): string {
  const d = new Date();
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")}-${m[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function missingSkusToCsv(entries: MissingSkuEntry[]): string {
  const header = "sku,description,price,count,date";
  const rows = entries.map((e) => [e.sku, e.desc, e.price, e.count, e.date].map(csvCell).join(","));
  return [header, ...rows].join("\n") + "\n";
}

// Collapses any duplicate-SKU rows into one, summing their counts (treating
// legacy rows saved before the `count` field existed as a count of 1 each)
// and keeping the most recent row's desc/price/date. Run this once at load
// so old data — logged before dedup-on-commit was added — gets cleaned up
// instead of crashing the list on a duplicate React key.
export function dedupeMissingSkus(entries: MissingSkuEntry[]): MissingSkuEntry[] {
  const groups = new Map<string, MissingSkuEntry[]>();
  const noSku: MissingSkuEntry[] = [];
  for (const e of entries) {
    const key = normSku(e.sku);
    if (!key) {
      noSku.push(e);
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const countOf = (e: MissingSkuEntry) => (Number(e.count) > 0 ? Number(e.count) : 1);
  const merged = [...groups.values()].map((list) => {
    const latest = list.reduce((a, b) => (new Date(b.date).getTime() >= new Date(a.date).getTime() ? b : a));
    return { ...latest, count: list.reduce((s, e) => s + countOf(e), 0) };
  });
  return [...noSku.map((e) => ({ ...e, count: countOf(e) })), ...merged];
}

/* ============================ quotation helpers ============================ */

// Ref numbers auto-generate as PJAQ+YYMMDD; a second quotation the same day
// gets -2, -3, and so on. Stays editable afterwards — this only picks the
// starting value.
export function generateUniqueRef(quotations: Quotation[]): string {
  const base = todayRef();
  const existing = new Set(quotations.map((q) => q.ref));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function newQuotationMeta(quotations: Quotation[]): QuotationMeta {
  const now = new Date().toISOString();
  return {
    id: uid(),
    ref: generateUniqueRef(quotations),
    customer: "",
    project: "",
    attn: "",
    date: todayStr(),
    defaultDiscount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// The final charged price per unit is stored directly (see StoredItem),
// so a quotation's total never depends on the catalogue at all — useful for
// the History list, which shouldn't need a catalogue lookup just to show a
// grand total.
export function quotationTotal(q: Pick<Quotation, "items">): number {
  return q.items.reduce((s, it) => s + (it.netPrice ?? 0) * (Number(it.qty) || 0), 0);
}

export function toStoredItem(it: QuoteItem): StoredItem {
  const base: StoredItem = {
    id: it.id,
    sku: it.sku,
    qty: it.qty,
    discount: it.discount,
    netPrice: netUnitPrice(it.price, it.discount, it.netPriceOverride),
    area: it.area,
    sub: it.sub,
  };
  if (it.fromTag || !it.sku) {
    return {
      ...base,
      full: { desc: it.desc, price: it.price, images: it.images, dimensions: it.dimensions, fromTag: it.fromTag },
    };
  }
  return base;
}

// Rehydrates a compact item back into the rich shape the UI/export need.
// For catalogue-backed items, desc/images/dimensions always come fresh from
// the current catalogue (cosmetic, safe to refresh); the price is only
// force-locked via netPriceOverride when it no longer matches a plain
// discount% off the current catalogue price — i.e. it was either manually
// negotiated at save time, or the catalogue price has since moved. That
// keeps a normal app resume (catalogue unchanged) from showing a false
// "Price adjusted" badge on items that were never touched.
export function fromStoredItem(stored: StoredItem, catalog: Product[]): QuoteItem {
  if (stored.full) {
    return {
      id: stored.id,
      sku: stored.sku,
      desc: stored.full.desc,
      price: stored.full.price,
      qty: stored.qty,
      discount: stored.discount,
      netPriceOverride: stored.netPrice,
      area: stored.area,
      sub: stored.sub,
      images: stored.full.images,
      dimensions: stored.full.dimensions,
      fromTag: stored.full.fromTag,
    };
  }
  const product = catalog.find((p) => normSku(p.sku) === normSku(stored.sku)) ?? null;
  const catalogPrice = product && product.price !== null ? roundRM(product.price) : null;
  const naturalNet = catalogPrice !== null ? netUnitPrice(catalogPrice, stored.discount, null) : null;
  const needsOverride = naturalNet === null || naturalNet !== stored.netPrice;
  return {
    id: stored.id,
    sku: stored.sku,
    desc: product?.desc ?? "(catalogue details unavailable)",
    price: catalogPrice,
    qty: stored.qty,
    discount: stored.discount,
    netPriceOverride: needsOverride ? stored.netPrice : null,
    area: stored.area,
    sub: stored.sub,
    images: product?.images ?? [],
    dimensions: product?.dimensions ?? [],
  };
}

// Defends against corrupted or older-schema localStorage data: drops entries
// that aren't recognizable at all, and fills in safe defaults for any
// expected field that's missing or the wrong type — so one malformed
// quotation (or item within one) can't crash the whole app on load. Pairs
// with local-storage.ts's loadJSON, which catches the array itself being
// the wrong shape; this catches individual entries inside a valid array
// being wrong.
function sanitizeStoredItem(raw: unknown): StoredItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.sku !== "string") return null;
  const full =
    o.full && typeof o.full === "object"
      ? (() => {
          const f = o.full as Record<string, unknown>;
          return {
            desc: typeof f.desc === "string" ? f.desc : "",
            price: typeof f.price === "number" && Number.isFinite(f.price) ? f.price : null,
            images: Array.isArray(f.images) ? f.images.filter((s): s is string => typeof s === "string") : [],
            dimensions: Array.isArray(f.dimensions) ? f.dimensions.filter((s): s is string => typeof s === "string") : [],
            fromTag: f.fromTag === true,
          };
        })()
      : undefined;
  return {
    id: o.id,
    sku: o.sku,
    qty: typeof o.qty === "number" && Number.isFinite(o.qty) && o.qty > 0 ? o.qty : 1,
    discount: typeof o.discount === "number" && Number.isFinite(o.discount) ? o.discount : 0,
    netPrice: typeof o.netPrice === "number" && Number.isFinite(o.netPrice) ? o.netPrice : null,
    area: typeof o.area === "string" ? o.area : "",
    sub: typeof o.sub === "string" ? o.sub : "",
    full,
  };
}

export function sanitizeQuotations(raw: unknown[]): Quotation[] {
  const now = new Date().toISOString();
  const out: Quotation[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.id !== "string") continue;
    const items = Array.isArray(o.items)
      ? o.items.map(sanitizeStoredItem).filter((x): x is StoredItem => x !== null)
      : [];
    out.push({
      id: o.id,
      ref: typeof o.ref === "string" ? o.ref : "",
      customer: typeof o.customer === "string" ? o.customer : "",
      project: typeof o.project === "string" ? o.project : "",
      attn: typeof o.attn === "string" ? o.attn : "",
      date: typeof o.date === "string" ? o.date : "",
      defaultDiscount: typeof o.defaultDiscount === "number" && Number.isFinite(o.defaultDiscount) ? o.defaultDiscount : 0,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
      items,
    });
  }
  return out;
}

// Never evict a quotation created today, even over the cap — losing today's
// in-progress work to a cap is worse than a temporary overshoot. Only
// quotations with at least one item count toward the cap; an empty draft
// (not yet "joined the list") is harmless clutter, not a slot.
export function pruneQuotations(quotations: Quotation[], max = 50): Quotation[] {
  const withItems = quotations.filter((q) => q.items.length > 0);
  if (withItems.length <= max) return quotations;
  const todayKey = new Date().toDateString();
  const removable = withItems
    .filter((q) => new Date(q.createdAt).toDateString() !== todayKey)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const overBy = withItems.length - max;
  const idsToRemove = new Set(removable.slice(0, overBy).map((q) => q.id));
  return quotations.filter((q) => !idsToRemove.has(q.id));
}
