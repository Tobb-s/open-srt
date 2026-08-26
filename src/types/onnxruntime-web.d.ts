/**
 * Declaración para `onnxruntime-web`.
 *
 * El paquete trae sus tipos en `types.d.ts`, pero su `package.json` no los expone por
 * `exports`, así que importarlo da TS7016. Se declara acá como `unknown` a propósito: la
 * superficie que este proyecto usa está tipada a mano en `src/lib/vad/silero.ts`, y
 * declararlo `any` dejaría pasar errores en ese borde.
 *
 * Si algún día el paquete arregla sus `exports`, este archivo se puede borrar.
 */
declare module 'onnxruntime-web' {
  const ort: unknown;
  export default ort;
}
