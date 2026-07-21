// Browser counterpart to scripts/lib/zip.js — same {readText, readBuffer}
// interface xlsx-parse.js expects, but backed by fflate over an in-memory
// buffer instead of unzipper over a file path (there's no filesystem in a
// Web Worker). Deliberately NOT using fflate's whole-archive unzip() —
// that decompresses every entry (including all ~3,800 embedded images)
// into memory at once, which is the exact JSZip-style failure mode this
// project avoids using fflate for in the first place. Filtering to one
// entry per call keeps memory bounded to whatever's actually being read,
// matching the Node version's lazy per-entry reads. Benchmarked at ~350ms
// for the ~270 small reads a full 67-sheet parse needs, and ~1.5ms per
// individual image — plenty fast for a one-shot "drop and wait" flow.
const { strFromU8, unzipSync } = require("fflate");

function openXlsxFromBuffer(buffer) {
  return {
    async readText(p) {
      const out = unzipSync(buffer, { filter: (file) => file.name === p });
      const bytes = out[p];
      return bytes ? strFromU8(bytes) : null;
    },
    async readBuffer(p) {
      const out = unzipSync(buffer, { filter: (file) => file.name === p });
      return out[p] || null;
    },
  };
}

module.exports = { openXlsxFromBuffer };
