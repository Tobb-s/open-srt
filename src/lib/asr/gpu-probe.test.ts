import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GPU_PROBE_TIMEOUT_MS,
  detectCapabilities,
  requestAdapterWithTimeout,
} from './capabilities';

/**
 * El plazo para preguntarle a WebGPU si está.
 *
 * ── El defecto que esto cuida ──
 *
 * `gpu.requestAdapter()` normalmente responde en menos de una décima. Pero **puede no
 * responder nunca**: visto en una pestaña en segundo plano, la promesa quedó colgada, la
 * detección de capacidades no terminó y la interfaz quedó **en blanco** — con un archivo ya
 * elegido y sin un solo mensaje que explicara qué estaba pasando.
 *
 * No es un `catch` lo que faltaba: no había excepción. Faltaba un plazo.
 *
 * Una promesa que nunca resuelve no se puede provocar con el WebGPU real, así que la prueba
 * inyecta un `gpu` de mentira. Es la razón por la que la función salió afuera de
 * `detectCapabilities`.
 */

/** Un `GPU` que se comporta como se le pida. */
function gpuFalso(comportamiento: 'cuelga' | 'sin-adaptador' | 'ok' | 'tira'): GPU {
  return {
    requestAdapter: () => {
      if (comportamiento === 'cuelga') return new Promise(() => {});
      if (comportamiento === 'sin-adaptador') return Promise.resolve(null);
      if (comportamiento === 'tira') return Promise.reject(new Error('sin driver'));
      return Promise.resolve({ limits: { maxBufferSize: 2 ** 31 } } as unknown as GPUAdapter);
    },
  } as unknown as GPU;
}

describe('requestAdapterWithTimeout', () => {
  it('devuelve el adaptador cuando contesta', async () => {
    const a = await requestAdapterWithTimeout(gpuFalso('ok'), 50);
    expect(a).not.toBe('timeout');
    expect(a).not.toBeNull();
  });

  it('devuelve null cuando no hay adaptador', async () => {
    // Distinto de vencerse: acá el navegador **contestó** que no hay. Confundir los dos
    // casos daría un mensaje equivocado.
    expect(await requestAdapterWithTimeout(gpuFalso('sin-adaptador'), 50)).toBeNull();
  });

  it('devuelve «timeout» cuando la promesa no resuelve nunca', async () => {
    // El caso que motivó todo esto. Sin el plazo, este test no terminaría.
    const t0 = Date.now();
    expect(await requestAdapterWithTimeout(gpuFalso('cuelga'), 60)).toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('deja pasar la excepción, que ya estaba contemplada', async () => {
    // El `catch` de `detectCapabilities` cubre este caso desde antes: no hay que tragárselo
    // acá y convertirlo en «timeout», que diría otra cosa.
    await expect(requestAdapterWithTimeout(gpuFalso('tira'), 50)).rejects.toThrow('sin driver');
  });

  it('no deja temporizadores colgados', async () => {
    // Sin `clearTimeout`, cada llamada deja un temporizador de ocho segundos vivo. En el
    // navegador es prolijidad; en Node retrasa la salida de la suite.
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    await requestAdapterWithTimeout(gpuFalso('ok'), 50);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('el plazo por defecto es holgado pero finito', () => {
    // Holgado porque una máquina cargada puede tardar; finito porque el punto es que
    // siempre haya respuesta.
    expect(GPU_PROBE_TIMEOUT_MS).toBeGreaterThan(2000);
    expect(GPU_PROBE_TIMEOUT_MS).toBeLessThan(30_000);
  });
});

describe('detectCapabilities con un WebGPU que no contesta', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'gpu');
  const ponerGpu = (gpu: GPU | undefined) =>
    Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis.navigator, 'gpu', original);
    else ponerGpu(undefined);
  });

  it('lo declara como plazo vencido, no como «no hay adaptador»', async () => {
    // Los dos casos terminan sin WebGPU, pero **no son lo mismo** y el usuario ve el motivo.
    // «No hay adaptador» dice que el navegador contestó que no; un plazo vencido dice que no
    // contestó. Este test lo encontró la prueba de mutación: los de arriba comprobaban la
    // función que consulta, no cómo se interpreta lo que devuelve.
    ponerGpu(gpuFalso('cuelga'));
    const caps = await detectCapabilities(40);
    expect(caps.webgpu).toBe(false);
    expect(caps.webgpuReason).toMatch(/no contest/i);
    expect(caps.webgpuReason).not.toMatch(/adaptador disponible/i);
  });

  it('con un adaptador de verdad, dice que sí', async () => {
    // El control: si el camino feliz también terminara sin WebGPU, el test de arriba no
    // distinguiría un plazo bien puesto de una detección rota.
    ponerGpu(gpuFalso('ok'));
    const caps = await detectCapabilities(1000);
    expect(caps.webgpu).toBe(true);
    expect(caps.webgpuReason).toBeUndefined();
  });

  it('cuando el navegador contesta que no hay adaptador, lo dice así', async () => {
    ponerGpu(gpuFalso('sin-adaptador'));
    const caps = await detectCapabilities(1000);
    expect(caps.webgpu).toBe(false);
    expect(caps.webgpuReason).toMatch(/adaptador/i);
    expect(caps.webgpuReason).not.toMatch(/no contest/i);
  });
});
