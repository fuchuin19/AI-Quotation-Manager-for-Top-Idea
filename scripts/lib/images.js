// Compresses/re-encodes a raw embedded-image buffer for upload.
// Photos -> JPEG, longest side 800px, quality 80.
// Dimension drawings -> left as PNG, untouched, so lines stay sharp.
const crypto = require('crypto');
const sharp = require('sharp');

// Formats Excel can embed that no JS image library (sharp included) can
// decode: EMF/WMF are Windows vector metafiles, WDP is JPEG XR. These also
// won't render in a browser or embed cleanly via ExcelJS later, so they're
// uploaded unchanged and flagged in the run report for manual replacement.
const UNSUPPORTED_EXT = new Set(['emf', 'wmf', 'wdp']);

const CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  wdp: 'image/vnd.ms-photo',
};

function extOf(mediaPath) {
  return mediaPath.split('.').pop().toLowerCase();
}

// Crop changes the actual pixels uploaded, so it must be part of the hash —
// otherwise a cropped and an uncropped use of the same source file would
// collide on the same R2 key. Uncropped images (the overwhelming majority)
// hash exactly as before, so nothing already on R2 is invalidated.
function contentHash(buffer, crop) {
  const h = crypto.createHash('sha256').update(buffer);
  if (crop) h.update(JSON.stringify(crop));
  return h.digest('hex').slice(0, 16);
}

/**
 * @param {Buffer} buffer raw bytes from xl/media/*
 * @param {string} mediaPath e.g. "xl/media/image42.png" (for its extension)
 * @param {'photo'|'dim'} role
 * @param {{left:number,top:number,right:number,bottom:number}|null} [crop]
 *   Fractions (0-1) of the source image to trim from each edge — from the
 *   source anchor's <a:srcRect>. Excel applies this BEFORE any EXIF-based
 *   rotation, so it's extracted from the raw stored pixel grid here too.
 */
async function processImage(buffer, mediaPath, role, crop) {
  const ext = extOf(mediaPath);
  const hash = contentHash(buffer, crop);

  if (UNSUPPORTED_EXT.has(ext)) {
    return {
      key: `products/${hash}-${role}.${ext}`,
      buffer,
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      compressed: false,
      unsupportedFormat: true,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    };
  }

  let pipeline = sharp(buffer);
  if (crop) {
    const meta = await pipeline.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const left = Math.max(0, Math.round(crop.left * w));
    const top = Math.max(0, Math.round(crop.top * h));
    const width = Math.max(1, Math.min(w - left, Math.round(w * (1 - crop.left - crop.right))));
    const height = Math.max(1, Math.min(h - top, Math.round(h * (1 - crop.top - crop.bottom))));
    pipeline = sharp(buffer).extract({ left, top, width, height });
  }

  if (role === 'photo') {
    // JPEG has no alpha channel. Many source photos are transparent-background
    // cutouts (some with an irregular, non-rectangular mask) — without an
    // explicit flatten, sharp fills transparent pixels with BLACK by default,
    // which shows up as a black silhouette/fringe around the product. Flatten
    // onto white first so transparent areas match the page background instead.
    const out = await pipeline
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return {
      key: `products/${hash}-photo.jpg`,
      buffer: out,
      contentType: 'image/jpeg',
      compressed: true,
      originalBytes: buffer.length,
      finalBytes: out.length,
    };
  }

  // Dimension drawing: keep as PNG. If it's already PNG AND uncropped, pass
  // the bytes through untouched (re-encoding a lossless format only risks
  // quality/size regressions for no benefit) — a crop always needs
  // re-encoding regardless of source format. Non-PNG rasters are converted
  // to PNG so the catalog only ever links to jpg/png.
  if (!crop && ext === 'png') {
    return {
      key: `products/${hash}-dim.png`,
      buffer,
      contentType: 'image/png',
      compressed: false,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    };
  }
  const out = await pipeline.png().toBuffer();
  return {
    key: `products/${hash}-dim.png`,
    buffer: out,
    contentType: 'image/png',
    compressed: true,
    originalBytes: buffer.length,
    finalBytes: out.length,
  };
}

module.exports = { processImage, contentHash, extOf };
