/**
 * Copia el runtime de ONNX a `public/ort/` para servirlo desde nuestro propio dominio.
 *
 * ── Por qué ──
 *
 * transformers.js, si nadie le dice lo contrario, apunta las rutas de sus archivos WASM a
 * **jsdelivr**:
 *
 *     ONNX_ENV.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${version}/dist/`
 *
 * Eso significa bajar y **ejecutar código de un tercero** en tiempo de carga. La CSP del
 * sitio no lo permite —`script-src 'self'`— así que el modelo directamente no cargaba:
 *
 *     Loading the script 'https://cdn.jsdelivr.net/npm/…/ort-wasm-simd-threaded.jsep.mjs'
 *     violates the following Content Security Policy directive: "script-src 'self' …"
 *
 * La CSP hizo su trabajo. El arreglo no es abrirla: es **servir el runtime nosotros**.
 *
 * ── Qué se copia ──
 *
 * Las dos variantes del backend WASM, con sus cargadores:
 *
 * - `ort-wasm-simd-threaded.jsep.*` — la que usan WebGPU y el camino con hilos.
 * - `ort-wasm-simd-threaded.*` — la variante sin JSEP.
 *
 * Salen de `onnxruntime-web`, que es el mismo paquete que transformers.js trae adentro: los
 * `.wasm` de los dos son **byte por byte idénticos** (comprobado por md5). Se copian de un
 * solo lugar para que no haya dos versiones circulando.
 *
 * Uso:  node scripts/vendor-ort.mjs   (corre solo antes de `build` y de `dev`)
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'node_modules/onnxruntime-web/dist');
const OUT = path.join(ROOT, 'public/ort');

/** Sólo el backend WASM. Los `ort.*.mjs` los trae el bundle de la aplicación. */
const PATRON = /^ort-wasm-simd-threaded(\.jsep)?\.(mjs|wasm)$/;

async function main() {
  if (!existsSync(SRC)) {
    console.error(`Falta ${SRC}. ¿Corriste npm install?`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const archivos = (await readdir(SRC)).filter((f) => PATRON.test(f));
  if (archivos.length === 0) {
    console.error('No se encontró ningún archivo del runtime: cambió el empaquetado.');
    process.exit(1);
  }

  let total = 0;
  for (const f of archivos) {
    await copyFile(path.join(SRC, f), path.join(OUT, f));
    total += (await stat(path.join(SRC, f))).size;
  }

  console.log(
    `runtime de ONNX en public/ort/ — ${archivos.length} archivos, ` +
      `${(total / 1024 / 1024).toFixed(1)} MB`,
  );
}

await main();
