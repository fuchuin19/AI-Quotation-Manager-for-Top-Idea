import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "scripts/**",
      "public/**",
      // Plain CommonJS by design — shared verbatim between the Node CLI
      // import script (require()) and the browser catalogue-update worker
      // (webpack bundles require() fine); converting to ESM would break the
      // Node side. Same reasoning as scripts/** above.
      "lib/catalog-import/**",
      "components/admin/catalogWorker.js",
    ],
  },
];

export default eslintConfig;
