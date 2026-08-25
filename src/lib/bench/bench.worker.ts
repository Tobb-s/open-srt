/// <reference lib="webworker" />
import {
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type ProgressCallback,
} from '@huggingface/transformers';
import type { Backend, DtypeSpec, WorkerRequest, WorkerResponse } from './types';

/**
 * El worker del banco. Acá adentro vive transformers.js.
 *
 * Está en un worker por dos motivos, y el segundo es el que importa en E0:
 *
 * 1. La inferencia congelaría el hilo principal durante minutos.
 * 2. **Aísla las caídas.** Si el proceso de GPU se cae —cosa que en este equipo ya pasó
 *    una vez hoy—, lo que muere es el worker, y el hilo principal puede registrar el
 *    fallo y seguir con la combinación siguiente en vez de perder la corrida entera.
 */

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let currentAcceptsLanguage = true;

/**
 * Precisión numérica de los pesos, por backend. **Medido, no razonado.**
 *
 * Los valores de acá salen de `benchmarks/resultados-controles.md`. La versión anterior
 * de este comentario decía que el encoder iba en `fp32` "porque cuantizarlo degrada", y
 * era un error caro: con `fp32` el encoder de large-v3-turbo no entra en el
 * `maxBufferSize` de 2 GB del adaptador y la carga se va a timeout — el modelo bueno
 * quedaba fuera del navegador por una elección de dtype.
 *
 * Lo que dio la medición:
 *
 *   Encoder:  fp32 no entra · **fp16 ✓** · q8 ✗ roto (100 % WER) · q4 ✓
 *   Decoder:  fp16 ✗ roto (580 % WER) · q8 ✓ · **q4 ✓**
 *
 * No sigue ningún orden de precisión: `fp16` sirve en el encoder y destruye el decoder,
 * `q8` al revés. Son fallos de caminos concretos de onnxruntime-web. **Antes de tocar
 * estos valores hay que volver a medir**: las combinaciones rotas cargan sin error y
 * devuelven texto de aspecto normal.
 */
function dtypeFor(backend: Backend, family: 'whisper' | 'moonshine') {
  if (family === 'moonshine') {
    return backend === 'webgpu' ? 'fp32' : 'q8';
  }
  return backend === 'webgpu'
    ? ({ encoder_model: 'fp16', decoder_model_merged: 'q4' } as const)
    // En WASM el encoder en q8 es lo que destrozó a `tiny` (87,7 % de WER, 1079
    // inserciones). q4 en ambos es la combinación que aguantó las dos posiciones.
    : ({ encoder_model: 'q4', decoder_model_merged: 'q8' } as const);
}

export function dtypeLabel(d: DtypeSpec): string {
  return typeof d === 'string' ? d : `enc:${d.encoder_model}/dec:${d.decoder_model_merged}`;
}

function post(msg: WorkerResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    if (req.type === 'load') {
      const t0 = performance.now();
      currentAcceptsLanguage = req.acceptsLanguage !== false;

      const onProgress: ProgressCallback = (p) => {
        const any = p as { status?: string; file?: string; loaded?: number; total?: number };
        post({
          type: 'progress',
          stage: any.status ?? 'unknown',
          file: any.file,
          loaded: any.loaded,
          total: any.total,
        });
      };

      // `pipeline` en transformers.js 3.x tiene una sobrecarga por cada tarea, y con
      // `dtype` como objeto por componente la unión se vuelve irrepresentable para
      // TypeScript (TS2590). Se invoca a través de una firma mínima; lo que importa
      // —el nombre de la tarea y las opciones— está fijado arriba y verificado en la
      // prueba de humo, no deducido del tipo.
      const load = pipeline as unknown as (
        task: string,
        model: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;

      // El dtype forzado gana sobre el que corresponde al backend: así se puede correr
      // un control que aísle el efecto de la cuantización del efecto del backend.
      const dtype = req.dtype ?? dtypeFor(req.backend, req.family);

      asr = (await load('automatic-speech-recognition', req.hfId, {
        device: req.backend,
        dtype,
        progress_callback: onProgress,
      })) as AutomaticSpeechRecognitionPipeline;

      post({ type: 'loaded', loadMs: performance.now() - t0, dtype: dtypeLabel(dtype) });
      return;
    }

    if (req.type === 'transcribe') {
      if (!asr) throw new Error('Se pidió transcribir sin modelo cargado');

      // Fragmentar SIEMPRE, también con Moonshine.
      //
      // El comentario anterior decía que Moonshine acepta longitud variable y no
      // necesitaba estos parámetros. Es cierto que acepta longitud variable, pero no
      // ilimitada: sin fragmentar, los ítems de 3 y 5 minutos reventaron —en WebGPU con
      // `[MatMul] /layers.0/self_attn/MatMul failed`, en WASM con un fallo de memoria—.
      // Sólo sobrevivió el de 1 minuto. La atención crece con el cuadrado de la entrada,
      // así que el audio largo hay que partirlo igual.
      const opts: Record<string, unknown> = {
        chunk_length_s: 30,
        stride_length_s: 5,
        // El producto los necesita para el progreso real; el banco los mide para saber
        // cuánto cuestan. Por defecto false, que es como se midió toda la matriz de E0.
        return_timestamps: req.returnTimestamps ?? false,
      };
      // `language` sólo si el modelo lo admite: ver `acceptsLanguage` en types.ts.
      if (currentAcceptsLanguage) opts.language = req.lang;

      const t0 = performance.now();
      // El tipo de la llamada al pipeline en transformers.js 3.x produce una unión que
      // TypeScript no puede representar (TS2590), así que se invoca a través de una
      // firma mínima. Lo que devuelve se valida abajo antes de usarlo.
      const call = asr as unknown as (
        audio: Float32Array,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
      const out = await call(req.audio, opts);
      const inferMs = performance.now() - t0;

      const text = Array.isArray(out)
        ? out.map((o) => (o as { text?: string }).text ?? '').join(' ')
        : ((out as { text?: string }).text ?? '');

      post({ type: 'result', text, inferMs });
      return;
    }

    if (req.type === 'dispose') {
      await asr?.dispose?.();
      asr = null;
      return;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
