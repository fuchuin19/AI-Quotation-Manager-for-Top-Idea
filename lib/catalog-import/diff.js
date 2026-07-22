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

// Baseline entries were never cropped-aware (products.json only stores
// resolved URLs, not the crop that produced them), so there's no way to
// compare "did the crop change" against an existing entry — the only safe
// thing is to always reprocess a product that has ANY srcRect crop, so a
// stale uncropped URL never gets silently trusted as "unchanged".
function hasAnyCrop(m) {
  return [m.imageCrops, m.dimensionCrops, m.descImageCrops].some((arr) => (arr || []).some((c) => c !== null));
}

// A baseline entry saved before descImageSizes existed has descImages but no
// (or a shorter) descImageSizes array — the count-only check above can't see
// that gap since descImages.length itself hasn't changed. Force a reprocess
// so it isn't permanently stuck without a size (falls back to a worse,
// stretched-to-fit-column render forever otherwise).
function missingDescImageSizes(existing, m) {
  const need = (m.descImageMediaPaths || []).length;
  if (need === 0) return false;
  return (existing.descImageSizes || []).length !== need;
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
      (existing.dimensions || []).length === m.dimensionMediaPaths.length &&
      (existing.descImages || []).length === (m.descImageMediaPaths || []).length &&
      !hasAnyCrop(m) &&
      !missingDescImageSizes(existing, m);
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

// A stable string for a crop rect (or 'nocrop') so the SAME source media
// path used both cropped and uncropped (or with two different crops) is
// treated as two distinct things to process, not collapsed into one.
function cropKey(crop) {
  return crop ? `${crop.left},${crop.top},${crop.right},${crop.bottom}` : "nocrop";
}

// Every distinct (mediaPath, role, crop) actually needed by the products
// that aren't in the "unchanged" bucket — so identical images referenced by
// many SKUs are only hashed/checked/uploaded once, and genuinely untouched
// products never need their images looked at at all.
function collectNeededImagePairs(newAndChangedMerged) {
  const pairs = new Map();
  for (const m of newAndChangedMerged) {
    const imageCrops = m.imageCrops || [];
    m.imageMediaPaths.forEach((mp, i) => {
      const crop = imageCrops[i] || null;
      pairs.set(`${mp}:photo:${cropKey(crop)}`, { mediaPath: mp, role: "photo", crop });
    });
    const dimensionCrops = m.dimensionCrops || [];
    m.dimensionMediaPaths.forEach((mp, i) => {
      const crop = dimensionCrops[i] || null;
      pairs.set(`${mp}:dim:${cropKey(crop)}`, { mediaPath: mp, role: "dim", crop });
    });
    // Description-column images are ordinary photos (JPEG, longest-side-800),
    // not technical line-art like dimensions — same role as imageMediaPaths,
    // which is also why an UNCROPPED image reclassified out of images[] into
    // here already exists on R2 under this exact hash+role and won't
    // re-upload (a cropped one gets its own distinct key, see cropKey above).
    const descImageCrops = m.descImageCrops || [];
    (m.descImageMediaPaths || []).forEach((mp, i) => {
      const crop = descImageCrops[i] || null;
      pairs.set(`${mp}:photo:${cropKey(crop)}`, { mediaPath: mp, role: "photo", crop });
    });
  }
  return [...pairs.values()];
}

module.exports = { diffCatalog, collectNeededImagePairs, normalizeSkuKey, cropKey, hasAnyCrop, missingDescImageSizes };
