import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El runtime de ONNX no es código nuestro: lo copia `scripts/vendor-ort.mjs` desde
    // node_modules y se sirve tal cual. Revisarlo con nuestras reglas no dice nada.
    "public/ort/**",
  ]),
]);

export default eslintConfig;
