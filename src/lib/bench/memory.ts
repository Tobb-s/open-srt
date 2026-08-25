import type { MemorySample } from './types';
import { MEMORY_SAMPLE_MS } from './policy';

/**
 * Medición de memoria en el navegador — y, sobre todo, de qué NO se puede medir.
 *
 * El plan de E0 pedía "pico de memoria" como si fuera un número disponible. No lo es.
 * Lo que hay son dos APIs, las dos parciales:
 *
 * 1. `performance.measureUserAgentSpecificMemory()` — estándar, cubre JS, DOM y el heap
 *    de WebAssembly. Pero **exige `crossOriginIsolated`**, es decir las cabeceras
 *    COOP/COEP, que son justo las que el hallazgo 1 dice que pueden romper la descarga
 *    del modelo desde Hugging Face. Además es asíncrona y cara: no sirve para muestrear
 *    en un bucle.
 *
 * 2. `performance.memory` — sólo Chromium, no estándar, y **sólo el heap de JavaScript**.
 *    Es barata, así que sirve para muestrear.
 *
 * Y el agujero que ninguna de las dos tapa: **la memoria de la GPU**. Con el backend
 * WebGPU, los pesos del modelo viven en buffers de GPU que no aparecen en ninguna de
 * estas cuentas. Un turbo de 1,2 GB corriendo en WebGPU puede reportar un heap JS
 * modesto mientras ocupa más de un giga de VRAM.
 *
 * Consecuencia para la tabla de E0: la columna de memoria mide **el consumo del lado
 * del CPU**, y hay que leerla así. Para WebGPU, el número que de verdad importa —cuánta
 * VRAM hace falta— no se puede obtener desde la página, y la evidencia práctica va a ser
 * indirecta: si la pestaña muere o la corrida cae por `timeout`, el equipo no daba.
 * Eso también es un dato, y por eso el runner registra esos fallos en vez de descartarlos.
 */

interface PerfMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function perfMemory(): PerfMemory | undefined {
  return (performance as Performance & { memory?: PerfMemory }).memory;
}

const BYTES_PER_MB = 1024 * 1024;

/** Muestra barata, apta para muestrear en bucle. Sólo heap JS. */
export function sampleMemorySync(): MemorySample {
  const m = perfMemory();
  if (m) {
    return { mb: m.usedJSHeapSize / BYTES_PER_MB, source: 'performance.memory' };
  }
  return { mb: 0, source: 'unavailable' };
}

/**
 * Muestra precisa, cuando el aislamiento cross-origin lo permite. Cubre el heap de
 * WebAssembly, que es la diferencia importante con `performance.memory` en el backend
 * WASM. Cae a la muestra barata si no está disponible.
 */
export async function sampleMemoryPrecise(): Promise<MemorySample> {
  const fn = (
    performance as Performance & {
      measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    }
  ).measureUserAgentSpecificMemory;

  if (typeof fn === 'function' && globalThis.crossOriginIsolated) {
    try {
      const r = await fn.call(performance);
      return { mb: r.bytes / BYTES_PER_MB, source: 'measureUserAgentSpecificMemory' };
    } catch {
      // Cae a la barata: una medición aproximada vale más que ninguna.
    }
  }
  return sampleMemorySync();
}

export interface PeakSampler {
  /** Detiene el muestreo y devuelve el pico observado. */
  stop(): MemorySample;
}

/**
 * Muestrea el heap durante una operación larga para quedarse con el pico.
 *
 * No hay API de "pico" en el navegador, así que se sondea. El intervalo es un
 * compromiso: muy corto compite con la inferencia por el hilo, muy largo se pierde el
 * pico. 250 ms sobre inferencias de segundos o minutos captura bien la forma.
 *
 * Un pico muestreado puede subestimar el real —si el máximo cae entre dos muestras, no
 * se ve—. Nunca lo sobreestima. Con eso, la columna es una **cota inferior**, y la tabla
 * de resultados lo dice.
 */
export function startPeakSampler(intervalMs = MEMORY_SAMPLE_MS): PeakSampler {
  let peak = sampleMemorySync();
  const id = setInterval(() => {
    const s = sampleMemorySync();
    if (s.mb > peak.mb) peak = s;
  }, intervalMs);

  return {
    stop() {
      clearInterval(id);
      const last = sampleMemorySync();
      return last.mb > peak.mb ? last : peak;
    },
  };
}

/** Qué se puede medir en este navegador. Va al encabezado de la tabla de resultados. */
export function memoryCapabilities(): {
  precise: boolean;
  cheap: boolean;
  note: string;
} {
  const precise =
    typeof (
      performance as Performance & { measureUserAgentSpecificMemory?: unknown }
    ).measureUserAgentSpecificMemory === 'function' && !!globalThis.crossOriginIsolated;
  const cheap = perfMemory() !== undefined;

  let note: string;
  if (precise) {
    note = 'JS + DOM + heap WASM. No incluye memoria de GPU.';
  } else if (cheap) {
    note = 'Sólo heap JS. No incluye heap WASM ni memoria de GPU.';
  } else {
    note = 'Sin medición de memoria en este navegador.';
  }

  return { precise, cheap, note };
}
