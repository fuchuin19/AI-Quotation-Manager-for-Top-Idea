import { pruneQuotations, type Quotation } from "./quote-types";

// Every read/write wrapped in try/catch — his phone can lock mid-quotation,
// storage can be full or disabled, and none of that should ever crash the app.
export const STORAGE_KEYS = {
  quotations: "qb:quotations",
  activeId: "qb:activeId",
  location: "qb:location",
  locationLog: "qb:locationLog",
  catalog: "qb:catalog",
  missingSkus: "qb:missingSkus",
} as const;

/**
 * `isValid` guards against the case JSON.parse can't catch: syntactically
 * valid JSON in the wrong shape — an object where an array was expected, a
 * stray `null`, a string, a number. That happens from a corrupted write, a
 * browser storage bug, or a future version of the app changing what it
 * stores under this key. Without this check the caller gets back
 * malformed data typed as if it were fine, and the first `.map()` or
 * `.find()` throws — which previously left the whole app on a permanent
 * blank screen with zero recovery path for someone who won't open dev tools.
 */
export function loadJSON<T>(key: string, fallback: T, isValid?: (value: unknown) => boolean): T {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (isValid && !isValid(parsed)) {
      console.error(`Ignoring corrupted localStorage value for ${key} (wrong shape).`);
      return fallback;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Failed to save ${key} to localStorage`, err);
  }
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
}

/**
 * Saves the quotations list, pruning to the 50-quotation cap first. If
 * localStorage is still full (a big catalogue cache can eat most of Safari's
 * ~5MB), progressively drops the oldest non-today quotations and retries.
 * Returns whatever list actually ended up persisted, and reports how many
 * were dropped so the caller can tell him plainly what happened.
 */
export function saveQuotationsWithRetry(
  quotations: Quotation[],
  onDropped?: (droppedCount: number) => void
): Quotation[] {
  let list = pruneQuotations(quotations);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (typeof window === "undefined") return list;
      window.localStorage.setItem(STORAGE_KEYS.quotations, JSON.stringify(list));
      return list;
    } catch (err) {
      if (!isQuotaError(err)) {
        console.error("Failed to save quotations to localStorage", err);
        return list;
      }
      const todayKey = new Date().toDateString();
      const withItems = list.filter((q) => q.items.length > 0);
      const removable = withItems
        .filter((q) => new Date(q.createdAt).toDateString() !== todayKey)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      if (removable.length === 0) {
        console.error("Storage is full and there is nothing safe left to drop.");
        return list;
      }
      const dropCount = Math.min(5, removable.length);
      const idsToRemove = new Set(removable.slice(0, dropCount).map((q) => q.id));
      list = list.filter((q) => !idsToRemove.has(q.id));
      onDropped?.(dropCount);
    }
  }
  return list;
}
