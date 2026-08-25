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
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
});
