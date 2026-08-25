import { MODELS, BACKENDS, shouldRun } from './models';
import { fetchAndDecode, sha256Hex } from '../audio/decode';
import { startPeakSampler, sampleMemoryPrecise } from './memory';
import { normalizeToWords } from './normalize';
import { wer } from './wer';
import { completedKeys, saveResult, startRun } from './persist';
import { MAX_RTF, LOAD_TIMEOUT_MS } from './policy';
import type {
  Backend,
  CorpusItem,
  DtypeSpec,
  Level,
  DeviceInfo,
  ModelSpec,
  RunResult,
  WorkerRequest,
  WorkerResponse,
} from './types';

/**
 * El orquestador de la matriz de E0.
 *
 * Tres decisiones de diseño que vienen de riesgos concretos, no de gusto:
 *
 * 1. **El modelo se carga una vez por (modelo, backend)**, no por ítem. Cargar el turbo
 *    son 1,2 GB y decenas de segundos; repetirlo por cada ítem multiplicaría la corrida
 *    por el tamaño del corpus sin medir nada nuevo. El `loadMs` se registra en el primer
 *    ítem de cada par y los demás lo dejan vacío.
 * 2. **Watchdog en cada operación.** Si la GPU se cae, el worker deja de contestar sin
 *    emitir ningún error. Sin un plazo, la corrida se cuelga para siempre.
 * 3. **Cada resultado se guarda antes de empezar el siguiente.** Ver `persist.ts`.
 */

export interface ProgressEvent {
  phase: 'device' | 'load' | 'transcribe' | 'done' | 'skip';
  modelKey?: string;
  backend?: Backend;
  itemId?: string;
  message: string;
  completed: number;
  total: number;
}

export interface RunnerOptions {
  runId: string;
  corpus: CorpusItem[];
  models?: readonly ModelSpec[];
  backends?: readonly Backend[];
  onProgress?: (e: ProgressEvent) => void;
  /** Niveles a correr. Por defecto sólo 'A': la matriz completa sobre los ítems largos
   *  son decenas de horas, y el nivel B se corre después, sobre los que pasen el corte. */
  levels?: readonly Level[];
  signal?: AbortSignal;
  /**
   * Fuerza la precisión en vez de usar la que corresponde a cada backend.
   *
   * Es lo que permite la corrida de control: medir WASM con el mismo dtype que WebGPU
   * separa «cuánto pesa el backend» de «cuánto pesa la cuantización», que en la primera
   * corrida se confundieron en 46 puntos de WER.
   */
  dtypeOverride?: DtypeSpec;
  /**
   * Pedir timestamps al modelo.
   *
   * El producto los necesita para mostrar progreso real —audio efectivamente procesado y
   * no una barra que avanza sola—, pero generan tokens extra. Esta opción existe para
   * medir ese costo en RTF y en WER, en vez de suponerlo.
   */
  returnTimestamps?: boolean;
  /** Verificar el SHA-256 de cada audio contra el manifiesto. Encarece poco y evita
   *  comparar resultados sobre archivos que cambiaron sin que nadie se diera cuenta. */
  verifyHashes?: boolean;
}

export async function detectDevice(label?: string): Promise<DeviceInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };

  let webgpuAvailable = false;
  let gpuAdapter: string | undefined;
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } })
      .gpu;
    if (gpu) {
      const adapter = (await gpu.requestAdapter()) as
        | { info?: { vendor?: string; architecture?: string; description?: string } }
        | null;
      webgpuAvailable = adapter !== null;
      if (adapter?.info) {
        const i = adapter.info;
        gpuAdapter = [i.vendor, i.architecture, i.description].filter(Boolean).join(' ');
      }
    }
  } catch {
    webgpuAvailable = false;
  }

  return {
    userAgent: navigator.userAgent,
    deviceMemoryGB: nav.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    webgpuAvailable,
    gpuAdapter,
    crossOriginIsolated: globalThis.crossOriginIsolated ?? false,
    label,
  };
}

/** Un worker con plazo. Si vence, se lo mata: casi siempre significa GPU caída. */
class WorkerSession {
  private worker: Worker;
  private dead = false;

  constructor() {
    this.worker = new Worker(new URL('./bench.worker.ts', import.meta.url), {
      type: 'module',
    });
    // Un worker que muere por una caída del proceso de GPU no emite 'error' de forma
    // fiable; el plazo es la red que lo atrapa igual.
    this.worker.onerror = () => {
      this.dead = true;
    };
  }

  get isDead() {
    return this.dead;
  }

  send(
    req: WorkerRequest,
    timeoutMs: number,
    onProgress?: (p: Extract<WorkerResponse, { type: 'progress' }>) => void,
    transfer?: Transferable[],
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.dead = true;
        reject(new Error(`timeout tras ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);

      const onMessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          onProgress?.(msg);
          return; // el progreso no resuelve: la operación sigue
        }
        cleanup();
        if (msg.type === 'error') reject(new Error(msg.message));
        else resolve(msg);
      };

      const onError = () => {
        cleanup();
        this.dead = true;
        reject(new Error('el worker murió (probable caída del proceso de GPU)'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
      };

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.postMessage(req, transfer ?? []);
    });
  }

  terminate() {
    this.worker.terminate();
    this.dead = true;
  }
}

export async function runBench(opts: RunnerOptions): Promise<void> {
  const models = opts.models ?? MODELS;
  const backends = opts.backends ?? BACKENDS;
  const levels = opts.levels ?? (['A'] as const);
  const corpus = opts.corpus.filter((i) => !i.level || levels.includes(i.level));
  const { runId, onProgress, signal } = opts;

  const device = await detectDevice();
  await startRun(runId, device);

  const done = await completedKeys(runId);
  const total = models.length * backends.length * corpus.length;
  let completed = done.size;

  const emit = (e: Omit<ProgressEvent, 'completed' | 'total'>) =>
    onProgress?.({ ...e, completed, total });

  emit({
    phase: 'device',
    message: device.webgpuAvailable
      ? `WebGPU disponible${device.gpuAdapter ? ` — ${device.gpuAdapter}` : ''}`
      : 'WebGPU NO disponible: sólo se mide WASM',
  });

  // Decodificar el corpus una vez y reusarlo en toda la matriz: decodificar 120 min de
  // audio por cada combinación sería tiempo puro de contabilidad.
  const decoded = new Map<string, { samples: Float32Array; durationSec: number }>();
  for (const item of corpus) {
    const a = await fetchAndDecode(item.url);
    if (opts.verifyHashes) {
      const hash = await sha256Hex(a.bytes);
      if (hash !== item.sha256) {
        throw new Error(
          `El audio de "${item.id}" no coincide con el manifiesto.\n` +
            `  esperado: ${item.sha256}\n  obtenido: ${hash}\n` +
            'Los resultados no serían comparables con corridas anteriores.',
        );
      }
    }
    decoded.set(item.id, { samples: a.samples, durationSec: a.durationSec });
  }

  for (const model of models) {
    for (const backend of backends) {
      if (signal?.aborted) return;

      // Sin WebGPU no tiene sentido intentar: se registra el motivo y se sigue.
      if (backend === 'webgpu' && !device.webgpuAvailable) {
        for (const item of corpus) {
          const key = `${model.key}|${backend}|${item.id}`;
          if (done.has(key)) continue;
          await saveResult(runId, {
            modelKey: model.key,
            backend,
            itemId: item.id,
            status: 'skipped',
            error: 'WebGPU no disponible en este equipo',
            startedAt: new Date().toISOString(),
          });
          completed++;
        }
        continue;
      }

      const pending = corpus.filter(
        (i) => !done.has(`${model.key}|${backend}|${i.id}`) && shouldRun(model, i.lang),
      );

      // Los que no aplican se registran igual: una celda vacía en la tabla no dice si
      // no se midió o si no correspondía medirla.
      for (const item of corpus) {
        const key = `${model.key}|${backend}|${item.id}`;
        if (done.has(key) || shouldRun(model, item.lang)) continue;
        await saveResult(runId, {
          modelKey: model.key,
          backend,
          itemId: item.id,
          status: 'skipped',
          error: `${model.key} sólo cubre inglés con licencia usable; el ítem es ${item.lang}`,
          startedAt: new Date().toISOString(),
        });
        completed++;
        emit({ phase: 'skip', modelKey: model.key, backend, itemId: item.id,
               message: `${model.key} no aplica a ${item.id} (${item.lang})` });
      }

      if (pending.length === 0) continue;

      const session = new WorkerSession();
      let loadMs: number | undefined;
      let usedDtype: string | undefined;
      let loadError: string | undefined;

      try {
        emit({
          phase: 'load',
          modelKey: model.key,
          backend,
          message: `Cargando ${model.key} en ${backend} (~${model.approxMB} MB)`,
        });

        const res = await session.send(
          {
            type: 'load', hfId: model.hfId, backend, family: model.family,
            dtype: opts.dtypeOverride,
            acceptsLanguage: model.acceptsLanguage,
          },
          LOAD_TIMEOUT_MS,
          (p) => {
            if (p.total) {
              const pct = Math.round(((p.loaded ?? 0) / p.total) * 100);
              emit({
                phase: 'load',
                modelKey: model.key,
                backend,
                message: `${model.key} · ${p.file ?? ''} ${pct} %`,
              });
            }
          },
        );
        if (res.type === 'loaded') { loadMs = res.loadMs; usedDtype = res.dtype; }
      } catch (err) {
        loadError = err instanceof Error ? err.message : String(err);
      }

      if (loadError) {
        for (const item of pending) {
          await saveResult(runId, {
            modelKey: model.key,
            backend,
            itemId: item.id,
            status: loadError.startsWith('timeout') ? 'timeout' : 'error',
            dtype: usedDtype,
            error: `carga: ${loadError}`,
            startedAt: new Date().toISOString(),
          });
          completed++;
        }
        session.terminate();
        continue;
      }

      let firstOfPair = true;
      for (const item of pending) {
        if (signal?.aborted) {
          session.terminate();
          return;
        }

        const audio = decoded.get(item.id);
        if (!audio) continue;

        const startedAt = new Date().toISOString();
        emit({
          phase: 'transcribe',
          modelKey: model.key,
          backend,
          itemId: item.id,
          message: `${model.key}/${backend} → ${item.id} (${Math.round(audio.durationSec)} s)`,
        });

        const memBefore = await sampleMemoryPrecise();
        const sampler = startPeakSampler();
        const timeout = Math.max(60_000, audio.durationSec * MAX_RTF * 1000);

        let result: RunResult;
        try {
          // Copia: el buffer se transfiere al worker y quedaría inutilizable acá,
          // pero el mismo audio se reusa en las combinaciones siguientes.
          const copy = new Float32Array(audio.samples);
          const res = await session.send(
            {
              type: 'transcribe', audio: copy, lang: item.lang, sampleRate: 16000,
              returnTimestamps: opts.returnTimestamps,
            },
            timeout,
            undefined,
            [copy.buffer],
          );
          const memPeak = sampler.stop();

          if (res.type !== 'result') throw new Error('respuesta inesperada del worker');

          const inferMs = res.inferMs;
          const rtf = inferMs / (audio.durationSec * 1000);
          const w = wer(
            normalizeToWords(item.reference, item.lang),
            normalizeToWords(res.text, item.lang),
          );

          result = {
            modelKey: model.key,
            backend,
            itemId: item.id,
            status: 'ok',
            dtype: usedDtype,
            returnTimestamps: opts.returnTimestamps ?? false,
            loadMs: firstOfPair ? loadMs : undefined,
            inferMs,
            rtf,
            memBefore,
            memPeak,
            wer: w,
            hypothesis: res.text,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        } catch (err) {
          sampler.stop();
          const message = err instanceof Error ? err.message : String(err);
          result = {
            modelKey: model.key,
            backend,
            itemId: item.id,
            status: message.startsWith('timeout') ? 'timeout' : 'error',
            dtype: usedDtype,
            loadMs: firstOfPair ? loadMs : undefined,
            memBefore,
            error: message,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }

        firstOfPair = false;
        await saveResult(runId, result);
        completed++;

        // Un worker muerto no revive: se corta el par y se sigue con el siguiente.
        if (session.isDead) break;
      }

      session.terminate();
    }
  }

  emit({ phase: 'done', message: `Corrida ${runId} terminada` });
}
