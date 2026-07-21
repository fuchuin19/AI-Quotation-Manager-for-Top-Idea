// Merges duplicate-SKU rows into one catalog entry per SKU.
//
// Price and images are merged independently per field rather than picking one
// "winning" row wholesale. That matters because a strict single-winner
// comparator (price-present > has-image > higher-price, in that order) would
// let an image-bearing low price beat an image-less higher price — silently
// contradicting the safety rule that conflicting real prices must resolve to
// the HIGHER one. Splitting the merge per field means the price rule always
// wins on price, independent of which row happened to have a photo.
//
// Zero environment-specific code — shared as-is between the Node CLI import
// script and the browser admin catalogue-update worker.
function dedupe(products) {
  const groups = new Map();
  for (const p of products) {
    if (!groups.has(p.skuKey)) groups.set(p.skuKey, []);
    groups.get(p.skuKey).push(p);
  }

  const merged = [];
  const conflicts = [];
  const packagesOnlyNoPrice = [];

  for (const [skuKey, entries] of groups) {
    const realPriced = entries.filter((e) => e.price !== null);
    const distinctPrices = [...new Set(realPriced.map((e) => e.price))];

    let finalPrice = null;
    let winningEntry = entries[0];
    if (distinctPrices.length > 0) {
      finalPrice = Math.max(...distinctPrices);
      winningEntry = realPriced.find((e) => e.price === finalPrice) || entries[0];
    }

    if (distinctPrices.length > 1) {
      const sorted = [...realPriced].sort((a, b) => a.price - b.price);
      const lowest = sorted[0];
      const highest = sorted[sorted.length - 1];
      conflicts.push({
        sku: winningEntry.sku,
        sheet_a: lowest.sourceSheet,
        price_a: lowest.price,
        sheet_b: highest.sourceSheet,
        price_b: highest.price,
        price_used: finalPrice,
        distinctPriceCount: distinctPrices.length,
      });
    }

    const images = [];
    const dimensions = [];
    const seenImg = new Set();
    const seenDim = new Set();
    for (const e of entries) {
      for (const mp of e.imageMediaPaths) {
        if (!seenImg.has(mp)) {
          seenImg.add(mp);
          images.push(mp);
        }
      }
      for (const mp of e.dimensionMediaPaths) {
        if (!seenDim.has(mp)) {
          seenDim.add(mp);
          dimensions.push(mp);
        }
      }
    }

    const sourceSheets = new Set(entries.map((e) => e.sourceSheet));
    if (finalPrice === null && sourceSheets.size === 1 && sourceSheets.has('GROHE PACKAGES')) {
      packagesOnlyNoPrice.push(winningEntry.sku);
    }

    merged.push({
      sku: winningEntry.sku,
      skuKey,
      brand: winningEntry.brand,
      desc: winningEntry.desc,
      price: finalPrice,
      priceMissing: finalPrice === null,
      imageMediaPaths: images,
      dimensionMediaPaths: dimensions,
      sourceSheets: [...sourceSheets],
      duplicateCount: entries.length,
    });
  }

  return { merged, conflicts, packagesOnlyNoPrice };
}

module.exports = { dedupe };
