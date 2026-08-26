/**
 * De dónde salen los archivos del runtime de ONNX.
 *
 * ── El problema que resuelve ──
 *
 * transformers.js, si nadie le dice lo contrario, apunta sus rutas de WASM a jsdelivr. Eso
 * es descargar y ejecutar código de un tercero cada vez que alguien transcribe. La CSP del
 * sitio no lo permite, así que el modelo **no cargaba**: la consola mostraba
 *
 *     Loading the script 'https://cdn.jsdelivr.net/npm/…/ort-wasm-simd-threaded.jsep.mjs'
 *     violates the following Content Security Policy directive: "script-src 'self' …"
 *
 * La CSP hizo exactamente lo que tenía que hacer. El arreglo no es aflojarla: es servir el
 * runtime desde el propio dominio, que además es lo coherente con lo que la herramienta
 * promete — sólo se baja el modelo, y de Hugging Face, que está declarado.
 *
 * `scripts/vendor-ort.mjs` deja los archivos en `public/ort/`, y `runtime.test.ts` comprueba
 * que sigan siendo los mismos que trae el paquete instalado.
 */

/** Dónde servimos el runtime. La barra final es obligatoria: onnxruntime concatena. */
export const ORT_PATH = '/ort/';

/** La parte de `ort.env` que nos interesa tocar. */
interface OrtEnv {
  wasm?: { wasmPaths?: string };
}

/**
 * Fija las rutas del runtime que usa transformers.js.
 *
 * Hay que llamarla **antes** de `pipeline(...)`: transformers sólo pone su valor por defecto
 * «si no está ya puesto», así que llegar primero es todo el mecanismo.
 */
export function pinTransformersRuntime(backendEnv: unknown): void {
  const env = backendEnv as OrtEnv | undefined;
  // Si el paquete cambia la forma de su `env`, es preferible no tocar nada y que falle
  // ruidosamente en la descarga a escribir una propiedad inventada que nadie lee.
  if (env?.wasm) env.wasm.wasmPaths = ORT_PATH;
}
