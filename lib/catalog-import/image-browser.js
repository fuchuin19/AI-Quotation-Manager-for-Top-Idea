// Browser counterpart to scripts/lib/images.js — same role-based rules
// (photos -> JPEG longest-side-800 q80, dimension drawings -> PNG
// untouched), same object-key naming, same content-hash algorithm, just
// using OffscreenCanvas instead of sharp since there's no native binding
// in a Web Worker. The hash MUST match scripts/lib/images.js's
// sha256-hex-slice(16) exactly — it's what makes "unchanged images are
// never re-uploaded" work at all, since the object key IS the hash and an
// existing R2 object is detected by that key matching.
const UNSUPPORTED_EXT = new Set(["emf", "wmf", "wdp"]);

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
  wdp: "image/vnd.ms-photo",
};

function extOf(mediaPath) {
  return mediaPath.split(".").pop().toLowerCase();
}

// Pure — no decoding/hashing of pixel data needed, just the (already known)
// hash + path + role. Exposed so callers can compute the final key/type
// BEFORE deciding whether it's worth actually compressing (e.g. to check
// "does this already exist on R2" first) without duplicating this mapping.
function keyInfoFor(hash, mediaPath, role) {
  const ext = extOf(mediaPath);
  if (UNSUPPORTED_EXT.has(ext)) {
    return { key: `products/${hash}-${role}.${ext}`, contentType: CONTENT_TYPES[ext] || "application/octet-stream" };
  }
  if (role === "photo") return { key: `products/${hash}-photo.jpg`, contentType: "image/jpeg" };
  return { key: `products/${hash}-dim.png`, contentType: "image/png" };
}

// Crop changes the actual pixels uploaded, so it must be part of the hash —
// otherwise a cropped and an uncropped use of the same source file would
// collide on the same R2 key. Uncropped images (the overwhelming majority)
// hash exactly as before, so nothing already on R2 is invalidated. MUST
// match scripts/lib/images.js's crop-inclusion exactly (same JSON.stringify
// of the same {left,top,right,bottom} shape) for the hashes to agree.
async function contentHash(buffer, crop) {
  let input = buffer;
  if (crop) {
    const cropBytes = new TextEncoder().encode(JSON.stringify(crop));
    const combined = new Uint8Array(buffer.length + cropBytes.length);
    combined.set(buffer, 0);
    combined.set(cropBytes, buffer.length);
    input = combined;
  }
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

async function decodeToBitmap(buffer, mimeType) {
  const blob = new Blob([buffer], { type: mimeType });
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

// Draws only the cropped source rectangle (sx,sy,sw,sh) scaled to fill the
// destination canvas — the browser equivalent of sharp's .extract(). crop
// fractions are relative to the bitmap's own pixel dimensions.
function cropRectPx(bitmap, crop) {
  if (!crop) return { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height };
  const sx = Math.max(0, Math.round(crop.left * bitmap.width));
  const sy = Math.max(0, Math.round(crop.top * bitmap.height));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(bitmap.width * (1 - crop.left - crop.right))));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(bitmap.height * (1 - crop.top - crop.bottom))));
  return { sx, sy, sw, sh };
}

async function encodeCanvas(bitmap, width, height, type, quality, crop) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha channel. Many source photos are transparent-background
  // cutouts (some with an irregular, non-rectangular mask) — an uninitialized
  // canvas defaults transparent pixels to black once flattened to JPEG, which
  // shows up as a black silhouette/fringe around the product. Fill white
  // first so transparent areas match the page background instead. PNG output
  // (dimensions) keeps its own alpha channel, so this only matters for JPEG.
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  const { sx, sy, sw, sh } = cropRectPx(bitmap, crop);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await canvas.convertToBlob(quality !== undefined ? { type, quality } : { type });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {Uint8Array} buffer raw bytes from xl/media/*
 * @param {string} mediaPath e.g. "xl/media/image42.png" (for its extension)
 * @param {'photo'|'dim'} role
 * @param {string} [precomputedHash]
 * @param {{left:number,top:number,right:number,bottom:number}|null} [crop]
 *   Fractions (0-1) of the source image to trim from each edge — from the
 *   source anchor's <a:srcRect>.
 */
async function processImage(buffer, mediaPath, role, precomputedHash, crop) {
  const ext = extOf(mediaPath);
  const hash = precomputedHash || (await contentHash(buffer, crop));
  const { key, contentType } = keyInfoFor(hash, mediaPath, role);

  if (UNSUPPORTED_EXT.has(ext)) {
    return {
      key,
      buffer,
      contentType,
      compressed: false,
      unsupportedFormat: true,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    };
  }

  try {
    if (role === "photo") {
      const bitmap = await decodeToBitmap(buffer, CONTENT_TYPES[ext] || "image/jpeg");
      const { sw, sh } = cropRectPx(bitmap, crop);
      const scale = Math.min(800 / sw, 800 / sh, 1); // never upscale
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const out = await encodeCanvas(bitmap, w, h, "image/jpeg", 0.8, crop);
      return { key, buffer: out, contentType, compressed: true, originalBytes: buffer.length, finalBytes: out.length };
    }

    // Dimension drawing: keep as PNG. If it's already PNG AND uncropped, pass
    // the bytes through untouched (re-encoding a lossless format only risks
    // quality/size regressions for no benefit) — a crop always needs
    // re-encoding regardless of source format. Non-PNG rasters are converted
    // to PNG so the catalog only ever links to jpg/png.
    if (!crop && ext === "png") {
      return { key, buffer, contentType, compressed: false, originalBytes: buffer.length, finalBytes: buffer.length };
    }
    const bitmap = await decodeToBitmap(buffer, CONTENT_TYPES[ext] || "image/png");
    const { sw, sh } = cropRectPx(bitmap, crop);
    const out = await encodeCanvas(bitmap, sw, sh, "image/png", undefined, crop);
    return { key, buffer: out, contentType, compressed: true, originalBytes: buffer.length, finalBytes: out.length };
  } catch (err) {
    // A format no browser codec can decode that isn't in the known
    // UNSUPPORTED_EXT list — upload the raw bytes rather than dropping the
    // image, same fallback philosophy as the known-unsupported case.
    console.warn(`Could not decode ${mediaPath} (${err.message}) — uploading original bytes unchanged.`);
    return {
      key,
      buffer,
      contentType,
      compressed: false,
      unsupportedFormat: true,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    };
  }
}

module.exports = { processImage, contentHash, extOf, keyInfoFor };
