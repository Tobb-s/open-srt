import { env } from '@huggingface/transformers';
import { pinTransformersRuntime } from '../asr/runtime';

/**
 * El modelo de embeddings de hablante, cargado en el navegador.
 *
 * ── Qué modelo y por qué ──
 *
 * `onnx-community/wespeaker-voxceleb-resnet34-LM`: **CC-BY-4.0, sin gate**, con ONNX
 * publicado. Es uno de los dos modelos de la tubería de pyannote 3.1, y transformers.js trae
 * su extractor de características —`WeSpeakerFeatureExtractor`— así que no hay que escribir a
 * mano el banco de filtros de mel, que es donde se esconderían los errores silenciosos.
 *
 * La alternativa que el plan proponía, ECAPA-TDNN de SpeechBrain, es Apache 2.0 pero **no
 * publica ONNX**: habría que exportarlo con PyTorch. El inventario completo de licencias está
 * en `docs/E4-ESTADO.md`.
 *
 * ── El costo ──
 *
 * 25 MB de descarga la primera vez, contra los ~800 MB del modelo de transcripción. Y una
 * inferencia por tramo de voz: en un archivo de un minuto son unas cuarenta.
 */

const MODELO = 'onnx-community/wespeaker-voxceleb-resnet34-LM';

/**
 * `q8` y no `fp32`.
 *
 * El de embeddings es un modelo chico y su salida es un vector que después sólo se compara
 * por ángulo, no una probabilidad que haya que calibrar. La cuantización mueve el coseno en
 * la tercera decimal, y la meseta del umbral medido en la fase A —de 0,35 a 0,50— es mucho
 * más ancha que eso.
 *
 * Aun así **es una combinación distinta de la que se midió**, así que la calidad con `q8`
 * está por comprobar y anotada como pendiente. El dtype no se cambia sin volver a medir, que
 * es la regla que E0 dejó escrita.
 */
const DTYPE = 'q8';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Procesador = (audio: Float32Array) => Promise<any>;
type Modelo = (entrada: any) => Promise<{ last_hidden_state: { data: Float32Array } }>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface EmbedderLoadOptions {
  onDownload?: (p: { file: string; loaded: number; total: number }) => void;
}

export class SpeakerEmbedder {
  private proc: Procesador | null = null;
  private modelo: Modelo | null = null;

  get loaded(): boolean {
    return this.modelo !== null;
  }

  async load(opts: EmbedderLoadOptions = {}): Promise<void> {
    if (this.modelo) return;

    // Antes de cargar nada: el runtime lo servimos nosotros, no un CDN. Lo mismo que hace
    // `Transcriber`, y por la misma razón — la CSP bloquea jsdelivr, con razón.
    pinTransformersRuntime(env.backends?.onnx);

    const { AutoModel, AutoProcessor } = await import('@huggingface/transformers');
    const progreso = (p: unknown) => {
      const x = p as { status?: string; file?: string; loaded?: number; total?: number };
      if (x.status === 'progress' && x.total) {
        opts.onDownload?.({ file: x.file ?? 'hablantes', loaded: x.loaded ?? 0, total: x.total });
      }
    };

    this.proc = (await AutoProcessor.from_pretrained(MODELO, {
      progress_callback: progreso,
    })) as unknown as Procesador;
    this.modelo = (await AutoModel.from_pretrained(MODELO, {
      dtype: DTYPE,
      progress_callback: progreso,
    })) as unknown as Modelo;
  }

  /** Un vector por trozo de audio. Devuelve una copia: el original vive en el modelo. */
  async embed(audio: Float32Array): Promise<Float32Array> {
    if (!this.proc || !this.modelo) throw new Error('El modelo de hablantes no está cargado');
    const salida = await this.modelo(await this.proc(audio));
    return Float32Array.from(salida.last_hidden_state.data);
  }

  async dispose(): Promise<void> {
    const m = this.modelo as unknown as { dispose?: () => Promise<void> } | null;
    await m?.dispose?.();
    this.modelo = null;
    this.proc = null;
  }
}
