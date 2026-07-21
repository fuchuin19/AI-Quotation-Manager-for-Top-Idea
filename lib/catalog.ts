// Fetches catalog/products.json from R2 (public bucket URL — no credentials
// needed for a read) and caches it in memory so a scan never re-downloads it.
// The TTL matches /api/products' revalidate window so a catalogue update
// (re-running the import script) becomes visible everywhere within about a
// minute, without hammering R2 on every single scan.
export interface Product {
  sku: string;
  brand: string;
  desc: string;
  price: number | null;
  priceMissing: boolean;
  images: string[];
  dimensions: string[];
}

const TTL_MS = 60 * 1000;

interface CatalogCache {
  products: Product[];
  exactIndex: Map<string, Product>;
  looseIndex: Map<string, Product>;
  fetchedAt: number;
}

let cache: CatalogCache | null = null;
let inflight: Promise<CatalogCache> | null = null;

function normExact(sku: string): string {
  return sku.toUpperCase().replace(/\s+/g, '');
}

function normLoose(sku: string): string {
  return normExact(sku).replace(/[-._]/g, '');
}

function buildCache(products: Product[]): CatalogCache {
  const exactIndex = new Map<string, Product>();
  const looseIndex = new Map<string, Product>();
  for (const p of products) {
    const exact = normExact(p.sku);
    if (!exactIndex.has(exact)) exactIndex.set(exact, p);
    const loose = normLoose(p.sku);
    if (!looseIndex.has(loose)) looseIndex.set(loose, p);
  }
  return { products, exactIndex, looseIndex, fetchedAt: Date.now() };
}

async function fetchCatalog(): Promise<Product[]> {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) throw new Error('R2_PUBLIC_URL is not configured.');
  const res = await fetch(`${base.replace(/\/+$/, '')}/catalog/products.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Catalog fetch failed with status ${res.status}`);
  return res.json();
}

/** Ensures the in-memory catalogue is loaded and reasonably fresh. */
export async function getCatalog(): Promise<Product[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.products;

  if (!inflight) {
    inflight = (async () => {
      try {
        const products = await fetchCatalog();
        cache = buildCache(products);
        return cache;
      } catch (err) {
        if (cache) {
          // Serve the stale copy rather than fail every scan because of one
          // transient R2 hiccup.
          console.error('Catalog refresh failed, serving stale copy:', err);
          return cache;
        }
        throw err;
      } finally {
        inflight = null;
      }
    })();
  }
  const result = await inflight;
  return result.products;
}

/** Must be called after getCatalog() has resolved at least once. */
export function findProduct(rawSku: string): Product | null {
  if (!cache) return null;
  const exact = normExact(rawSku);
  const exactMatch = cache.exactIndex.get(exact);
  if (exactMatch) return exactMatch;
  const loose = normLoose(rawSku);
  return cache.looseIndex.get(loose) ?? null;
}
