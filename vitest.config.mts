import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // El pool por defecto ('forks') no arranca sus workers en este Windows: la suite
    // muere con "Timeout waiting for worker to respond" sin ejecutar un solo test.
    // Con 'threads' corre en medio segundo. Es un problema del corredor, no del código.
    pool: 'threads',
    // Los tests de integración cargan onnxruntime-node, que es un módulo nativo. Con dos
    // archivos corriéndolo en hilos distintos a la vez, V8 se cae con un error fatal
    // (`Check failed: !IsFreelistEntry()`) antes de ejecutar nada: el addon no está
    // preparado para vivir en varios isolates. De a un archivo por vez, los 16 pasan.
    //
    // Cuesta unos 40 s de reloj sobre los 9 que tardaba la suite pura. Es el precio de que
    // el detector de voz y el modelo se prueben de verdad, contra audio real.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
});
