/// <reference lib="webworker" />
import { Transcriber } from './transcriber';
import type { Dtype } from './models';

/**
 * Envoltorio de mensajería sobre `Transcriber`.
 *
 * Acá no hay lógica de transcripción: sólo traduce mensajes. Todo lo que decide cómo se
 * transcribe vive en `transcriber.ts`, que también usa el camino sin worker — así un
 * arreglo se aplica a los dos a la vez.
 */

export type WorkerRequest =
  | { type: 'load'; hfId: string; device: 'webgpu' | 'wasm'; dtype: Dtype }
  | {
      type: 'transcribe';
      audio: Float32Array;
      durationSec: number;
      language?: string;
      returnTimestamps?: boolean;
      withProgress: boolean;
    }
  | { type: 'dispose' };

export type WorkerResponse =
  | { type: 'download'; file: string; loaded: number; total: number }
  | { type: 'ready'; loadMs: number }
  | { type: 'progress'; processedSec?: number; durationSec: number; partialText: string }
  | { type: 'done'; text: string; inferMs: number }
  | { type: 'error'; message: string; fatal: boolean };

const transcriber = new Transcriber();

function post(msg: WorkerResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'load') {
      const loadMs = await transcriber.load({
        hfId: req.hfId,
        device: req.device,
        dtype: req.dtype,
        onDownload: (p) => post({ type: 'download', ...p }),
      });
      post({ type: 'ready', loadMs });
      return;
    }

    if (req.type === 'transcribe') {
      const r = await transcriber.transcribe({
        audio: req.audio,
        durationSec: req.durationSec,
        language: req.language,
        returnTimestamps: req.returnTimestamps,
        onProgress: req.withProgress
          ? (p) => post({ type: 'progress', ...p })
          : undefined,
      });
      post({ type: 'done', text: r.text, inferMs: r.inferMs });
      return;
    }

    if (req.type === 'dispose') {
      await transcriber.dispose();
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Un fallo al cargar deja el worker inservible; uno al transcribir, no.
    post({ type: 'error', message, fatal: req.type === 'load' });
  }
});
