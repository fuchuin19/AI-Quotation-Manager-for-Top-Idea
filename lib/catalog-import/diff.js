// Compares freshly parsed+deduped products (from dedupe.js's `merged`
// array — SKUs not yet resolved to R2 image URLs) against the live
// catalog (Product[] from /api/products) to categorize every SKU as
// new/changed/unchanged/removed before anything gets uploaded. Mirrors the
// same "unchanged" heuristic scripts/import-catalog.js's incremental mode
// uses (price/priceMissing match AND image/dimension counts match) rather
// than a byte-for-byte comparison, so a genuinely unchanged product never
// needs its images re-hashed just to confirm nothing moved.
function normalizeSkuKey(sku) {
  return String(sku || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function diffCatalog(merged, baseline) {
  const baselineByKey = new Map((baseline || []).map((b) => [normalizeSkuKey(b.sku), b]));
  const mergedKeys = new Set(merged.map((m) => m.skuKey));

  const newSkus = [];
  const changedSkus = [];
  const unchangedSkus = [];

  for (const m of merged) {
    const existing = baselineByKey.get(m.skuKey);
    if (!existing) {
      newSkus.push(m);
      continue;
    }
    const unchanged =
      existing.price === m.price &&
      existing.priceMissing === m.priceMissing &&
      (existing.images || []).length === m.imageMediaPaths.length &&
      (existing.dimensions || []).length === m.dimensionMediaPaths.length;
    if (unchanged) {
      unchangedSkus.push(existing);
    } else {
      changedSkus.push({ merged: m, existing });
    }
  }

  // Kept, never deleted — matches the CLI's default incremental mode: a SKU
  // dropping out of one export of the spreadsheet isn't good evidence it
  // should vanish from real customer-facing quotations.
  const removedSkus = (baseline || []).filter((b) => !mergedKeys.has(normalizeSkuKey(b.sku)));

  return {
    newSkus,
    changedSkus,
    unchangedSkus,
    removedSkus,
    counts: {
      new: newSkus.length,
      changed: changedSkus.length,
      unchanged: unchangedSkus.length,
      removed: removedSkus.length,
      total: merged.length,
    },
  };
}

// Every distinct (mediaPath, role) actually needed by the products that
// aren't in the "unchanged" bucket — so identical images referenced by many
// SKUs are only hashed/checked/uploaded once, and genuinely untouched
// products never need their images looked at at all.
function collectNeededImagePairs(newAndChangedMerged) {
  const pairs = new Map();
  for (const m of newAndChangedMerged) {
    for (const mp of m.imageMediaPaths) pairs.set(`${mp}:photo`, { mediaPath: mp, role: "photo" });
    for (const mp of m.dimensionMediaPaths) pairs.set(`${mp}:dim`, { mediaPath: mp, role: "dim" });
  }
  return [...pairs.values()];
}

module.exports = { diffCatalog, collectNeededImagePairs, normalizeSkuKey };
