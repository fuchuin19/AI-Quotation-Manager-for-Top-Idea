// Thin wrapper around unzipper for reading an .xlsx as a zip archive.
// Never reads xl/media/* into memory unless explicitly asked for a specific
// entry — the 237MB source file must never be loaded whole.
const unzipper = require('unzipper');

async function openXlsx(xlsxPath) {
  const directory = await unzipper.Open.file(xlsxPath);
  const byPath = new Map(directory.files.map((f) => [f.path, f]));

  return {
    has(p) {
      return byPath.has(p);
    },
    async readText(p) {
      const f = byPath.get(p);
      if (!f) return null;
      return (await f.buffer()).toString('utf8');
    },
    async readBuffer(p) {
      const f = byPath.get(p);
      if (!f) return null;
      return f.buffer();
    },
  };
}

module.exports = { openXlsx };
