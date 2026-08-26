import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ORT_PATH, pinTransformersRuntime } from './runtime';

/**
 * Que el runtime de ONNX lo sirvamos nosotros, y que sea el que corresponde.
 *
 * El bug que estas pruebas cuidan apareció en el navegador y **ningún test lo veía**:
 * transformers.js apuntaba sus `.wasm` a jsdelivr, la CSP lo bloqueaba y el modelo no
 * cargaba. Los tests de Node no lo notan porque ahí el backend es `onnxruntime-node`, que
 * no descarga nada.
 *
 * No se puede probar la CSP desde acá. Lo que sí se puede probar es lo que la hace
 * innecesaria: que las rutas apunten a casa y que los archivos servidos sean exactamente
 * los del paquete instalado.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const VENDOR = path.join(ROOT, 'public/ort');
const ORIGEN = path.join(ROOT, 'node_modules/onnxruntime-web/dist');

function sha256(archivo: string): string {
  return createHash('sha256').update(readFileSync(archivo)).digest('hex');
}

describe('rutas del runtime', () => {
  it('apunta a un camino propio y termina en barra', () => {
    // La barra final no es cosmética: onnxruntime concatena el nombre del archivo sin
    // agregarla, así que sin ella pediría `/ortort-wasm-...`.
    expect(ORT_PATH.startsWith('/')).toBe(true);
    expect(ORT_PATH.endsWith('/')).toBe(true);
    expect(ORT_PATH).not.toMatch(/^https?:/);
  });

  it('fija la ruta en el env de transformers', () => {
    const env = { wasm: { wasmPaths: undefined as string | undefined } };
    pinTransformersRuntime(env);
    expect(env.wasm.wasmPaths).toBe(ORT_PATH);
  });

  it('pisa la ruta al CDN si ya venía puesta', () => {
    // Es el caso real: transformers pone jsdelivr en cuanto se importa el módulo.
    const env = { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/' } };
    pinTransformersRuntime(env);
    expect(env.wasm.wasmPaths).toBe(ORT_PATH);
  });

  it('no inventa propiedades si el paquete cambia de forma', () => {
    // Escribir `wasmPaths` en un objeto que nadie lee daría la falsa sensación de que está
    // resuelto. Es preferible no tocar nada y que falle ruidosamente al descargar.
    const env = { algoDistinto: true };
    expect(() => pinTransformersRuntime(env)).not.toThrow();
    expect(env).toEqual({ algoDistinto: true });
    expect(() => pinTransformersRuntime(undefined)).not.toThrow();
  });
});

describe('el runtime servido es el del paquete instalado', () => {
  it('están los cuatro archivos del backend WASM', () => {
    expect(
      existsSync(VENDOR),
      'falta public/ort/ — correr `npm run ort:vendor`',
    ).toBe(true);
    const servidos = readdirSync(VENDOR).filter((f) => f.startsWith('ort-wasm'));
    expect(servidos.sort()).toEqual([
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
    ]);
  });

  it('coinciden byte por byte con node_modules', () => {
    // Sin esto, subir la versión de onnxruntime dejaría `public/ort/` con los archivos
    // viejos y el runtime cargaría un WASM que no corresponde a su cargador. Ese fallo es
    // de los peores: no es un error de compilación, es un modelo que devuelve basura.
    for (const f of readdirSync(VENDOR).filter((x) => x.startsWith('ort-wasm'))) {
      expect(sha256(path.join(VENDOR, f)), `${f} no coincide — correr \`npm run ort:vendor\``)
        .toBe(sha256(path.join(ORIGEN, f)));
    }
  });

  it('CONTROL: la comparación distingue un archivo alterado', () => {
    // Si el hash se calculara sobre lo mismo dos veces, la prueba de arriba pasaría siempre.
    const f = path.join(VENDOR, 'ort-wasm-simd-threaded.mjs');
    const original = readFileSync(f);
    const alterado = Buffer.concat([original, Buffer.from('\n// una coma de más\n')]);
    expect(createHash('sha256').update(alterado).digest('hex')).not.toBe(sha256(f));
  });
});
