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

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/**
 * @param {Buffer} buffer raw bytes from xl/media/*
 * @param {string} mediaPath e.g. "xl/media/image42.png" (for its extension)
 * @param {'photo'|'dim'} role
 */
async function processImage(buffer, mediaPath, role) {
  const ext = extOf(mediaPath);
  const hash = contentHash(buffer);

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

  if (role === 'photo') {
    const out = await sharp(buffer)
      .rotate()
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

  // Dimension drawing: keep as PNG. If it's already PNG, pass the bytes
  // through untouched (re-encoding a lossless format only risks quality/size
  // regressions for no benefit). Non-PNG rasters are converted to PNG so the
  // catalog only ever links to jpg/png.
  if (ext === 'png') {
    return {
      key: `products/${hash}-dim.png`,
      buffer,
      contentType: 'image/png',
      compressed: false,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    };
  }
  const out = await sharp(buffer).png().toBuffer();
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
