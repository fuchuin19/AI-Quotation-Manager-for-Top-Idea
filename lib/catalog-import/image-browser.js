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

async function contentHash(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

async function decodeToBitmap(buffer, mimeType) {
  const blob = new Blob([buffer], { type: mimeType });
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

async function encodeCanvas(bitmap, width, height, type, quality) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob(quality !== undefined ? { type, quality } : { type });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {Uint8Array} buffer raw bytes from xl/media/*
 * @param {string} mediaPath e.g. "xl/media/image42.png" (for its extension)
 * @param {'photo'|'dim'} role
 */
async function processImage(buffer, mediaPath, role, precomputedHash) {
  const ext = extOf(mediaPath);
  const hash = precomputedHash || (await contentHash(buffer));
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
      const scale = Math.min(800 / bitmap.width, 800 / bitmap.height, 1); // never upscale
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const out = await encodeCanvas(bitmap, w, h, "image/jpeg", 0.8);
      return { key, buffer: out, contentType, compressed: true, originalBytes: buffer.length, finalBytes: out.length };
    }

    // Dimension drawing: keep as PNG. If it's already PNG, pass the bytes
    // through untouched (re-encoding a lossless format only risks
    // quality/size regressions for no benefit). Non-PNG rasters are
    // converted to PNG so the catalog only ever links to jpg/png.
    if (ext === "png") {
      return { key, buffer, contentType, compressed: false, originalBytes: buffer.length, finalBytes: buffer.length };
    }
    const bitmap = await decodeToBitmap(buffer, CONTENT_TYPES[ext] || "image/png");
    const out = await encodeCanvas(bitmap, bitmap.width, bitmap.height, "image/png");
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
