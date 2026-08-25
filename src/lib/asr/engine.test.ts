import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PROFILES } from './models';

/**
 * La degradación worker → hilo principal.
 *
 * Es el camino que nadie ejercita hasta que falla de verdad, y justo entonces tiene que
 * andar. Si el worker no arranca —navegador viejo, política de seguridad, un proceso de
 * GPU caído— la alternativa es entre una herramienta lenta y ninguna.
 *
 * Y tiene una consecuencia que la interfaz **debe** contar: en modo hilo principal la
 * pestaña se congela mientras transcribe. Un usuario que no sabe por qué la página dejó
 * de responder asume que se rompió y la cierra.
 */

// El worker real carga transformers.js y un modelo de cientos de megas. Acá se sustituye
// por uno que sólo simula el protocolo de mensajes.
const loadCalls: string[] = [];

vi.mock('./transcriber', () => ({
  Transcriber: class {
    async load() {
      loadCalls.push('main-thread');
      return 10;
    }
    async transcribe() {
      return { text: 'texto del hilo principal', inferMs: 100 };
    }
    async dispose() {}
  },
}));

const { AsrEngine } = await import('./engine');

const profile = PROFILES[0];

/** Un Worker que responde bien al protocolo. */
class WorkerOk {
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(t: string, fn: (e: unknown) => void) {
    (this.listeners[t] ??= []).push(fn);
  }
  removeEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn);
  }
  postMessage(req: { type: string }) {
    loadCalls.push('worker');
    queueMicrotask(() => {
      const msg =
        req.type === 'load'
          ? { type: 'ready', loadMs: 5 }
          : { type: 'done', text: 'texto del worker', inferMs: 50 };
      for (const fn of this.listeners.message ?? []) fn({ data: msg });
    });
  }
  terminate() {}
  set onerror(_fn: unknown) {}
}

beforeEach(() => {
  loadCalls.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('modo normal', () => {
  it('usa el worker cuando arranca bien', async () => {
    vi.stubGlobal('Worker', WorkerOk);
    const engine = new AsrEngine();
    const status = await engine.load(profile);

    expect(status.mode).toBe('worker');
    expect(status.degradedReason).toBeUndefined();
    expect(loadCalls).toContain('worker');
    expect(loadCalls).not.toContain('main-thread');
  });

  it('transcribe a través del worker', async () => {
    vi.stubGlobal('Worker', WorkerOk);
    const engine = new AsrEngine();
    await engine.load(profile);
    const r = await engine.transcribe(new Float32Array(16000), 1);
    expect(r.text).toBe('texto del worker');
  });
});

describe('degradación a hilo principal', () => {
  it('cae al hilo principal si el Worker no se puede construir', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('bloqueado por política'); } });

    const engine = new AsrEngine();
    const status = await engine.load(profile);

    expect(status.mode).toBe('main-thread');
    expect(loadCalls).toContain('main-thread');
  });

  it('propaga POR QUÉ se degradó, para que la interfaz pueda explicarlo', async () => {
    // Sin este motivo, la página se congela y el usuario no tiene forma de saber que no
    // está trabada.
    vi.stubGlobal('Worker', class { constructor() { throw new Error('bloqueado por política'); } });
    const engine = new AsrEngine();
    const status = await engine.load(profile);
    expect(status.degradedReason).toMatch(/bloqueado por política/);
  });

  it('cae al hilo principal si el worker responde con un error', async () => {
    class WorkerQueFalla extends WorkerOk {
      postMessage() {
        queueMicrotask(() => {
          for (const fn of (this as unknown as {
            listeners: Record<string, ((e: unknown) => void)[]>;
          }).listeners.message ?? []) {
            fn({ data: { type: 'error', message: 'el modelo no cargó', fatal: true } });
          }
        });
      }
    }
    vi.stubGlobal('Worker', WorkerQueFalla);

    const engine = new AsrEngine();
    const status = await engine.load(profile);
    expect(status.mode).toBe('main-thread');
    expect(status.degradedReason).toMatch(/el modelo no cargó/);
  });

  it('cae al hilo principal si el worker muere sin decir nada', async () => {
    // Una caída del proceso de GPU no siempre emite un error: a veces el worker
    // simplemente deja de contestar.
    class WorkerMudo extends WorkerOk {
      postMessage() {
        queueMicrotask(() => {
          for (const fn of (this as unknown as {
            listeners: Record<string, ((e: unknown) => void)[]>;
          }).listeners.error ?? []) {
            fn({});
          }
        });
      }
    }
    vi.stubGlobal('Worker', WorkerMudo);

    const engine = new AsrEngine();
    const status = await engine.load(profile);
    expect(status.mode).toBe('main-thread');
  });

  it('transcribe igual, por el hilo principal', async () => {
    // El punto de todo esto: degradado se sigue pudiendo trabajar.
    vi.stubGlobal('Worker', class { constructor() { throw new Error('no hay workers'); } });
    const engine = new AsrEngine();
    await engine.load(profile);

    const r = await engine.transcribe(new Float32Array(16000), 1);
    expect(r.text).toBe('texto del hilo principal');
  });

  it('el estado queda disponible después de cargar', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('x'); } });
    const engine = new AsrEngine();
    await engine.load(profile);
    expect(engine.status?.mode).toBe('main-thread');
    expect(engine.status?.profile.key).toBe(profile.key);
  });

  it('dispose no rompe en modo degradado', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('x'); } });
    const engine = new AsrEngine();
    await engine.load(profile);
    await expect(engine.dispose()).resolves.toBeUndefined();
  });
});
