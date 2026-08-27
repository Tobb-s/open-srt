import { env } from '@huggingface/transformers';
import { pinTransformersRuntime } from '../asr/runtime';
import type { TimedText } from '../vad/align';

/**
 * Traducción local, con Opus-MT.
 *
 * ── Qué modelo y por qué ese ──
 *
 * `onnx-community/opus-mt-{par}`, **CC-BY-4.0 y sin gate**. El plan anotaba que Opus-MT es
 * Apache 2.0: es cierto del original de Helsinki-NLP, **que no publica ONNX**. El puerto más
 * descargado —el de Xenova— **no declara licencia**, y una licencia sin declarar no es
 * permisiva por omisión, así que queda descartado por la misma regla que descartó NLLB.
 *
 * La atribución que pide CC-BY está en el pie del sitio y en el README.
 *
 * ── El costo ──
 *
 * **235 MB por dirección** con `q8`, que es el dtype con el que se midió la calidad. En fp16
 * serían 213 MB, pero cambiar el dtype sin volver a medir es lo que la regla de E0 prohíbe.
 *
 * Dato contraintuitivo que conviene no redescubrir: **`int8` pesa más que `fp16`** en estos
 * modelos, porque la tabla de embeddings no se cuantiza.
 *
 * ── Lo que la medición encontró, y que decide cómo se presenta ──
 *
 * Sobre 30 frases del corpus: ida y vuelta 26,9 % de media, y **al menos 4 con el sentido
 * destruido**, todas fluidas. «los más grandes éxitos» salió como «the biggest "Sterntos"»
 * —una palabra inventada— y «quiero que me reserves el mejor asiento» como «I want to be the
 * best seat».
 *
 * Es el mismo modo de fallo que E1 encontró en Whisper, con una diferencia que manda sobre el
 * diseño: **una transcripción mala se puede verificar contra el audio; una traducción mala
 * no la puede detectar quien no habla el idioma de destino** — que es exactamente quien la va
 * a usar. Por eso el producto la presenta como borrador, con el original siempre al lado, y
 * no como un resultado más.
 */

/** Los pares que hay, con su modelo. Cada dirección es un modelo aparte. */
export const PARES = {
  'es-en': 'onnx-community/opus-mt-es-en',
  'en-es': 'onnx-community/opus-mt-en-es',
} as const;

export type Par = keyof typeof PARES;

/** El dtype con el que se midió la calidad. Cambiarlo exige volver a medir. */
const DTYPE = 'q8';

/** 235 MB, para poder decirlo antes de que el usuario acepte. */
export const DESCARGA_MB = 235;

type Pipe = (texto: string) => Promise<Array<{ translation_text: string }>>;

export interface TranslateProgress {
  done: number;
  total: number;
}

export class Translator {
  private pipe: Pipe | null = null;
  private cargado: Par | null = null;

  get par(): Par | null {
    return this.cargado;
  }

  async load(
    par: Par,
    onDownload?: (p: { file: string; loaded: number; total: number }) => void,
  ): Promise<void> {
    if (this.cargado === par && this.pipe) return;

    // El runtime lo servimos nosotros, no un CDN: lo mismo que hacen `Transcriber` y
    // `SpeakerEmbedder`, y por la misma razón — la CSP bloquea jsdelivr, con razón.
    pinTransformersRuntime(env.backends?.onnx);

    const { pipeline } = await import('@huggingface/transformers');
    this.pipe = (await pipeline('translation', PARES[par], {
      dtype: DTYPE,
      progress_callback: (p: unknown) => {
        const x = p as { status?: string; file?: string; loaded?: number; total?: number };
        if (x.status === 'progress' && x.total) {
          onDownload?.({ file: x.file ?? par, loaded: x.loaded ?? 0, total: x.total });
        }
      },
    })) as unknown as Pipe;
    this.cargado = par;
  }

  /**
   * Traduce **tramo por tramo**, conservando los tiempos.
   *
   * Tramo por tramo y no el texto entero: los tiempos vienen del detector de voz y son lo que
   * hace que esto sirva para subtítulos. Traducir todo junto daría mejor contexto y dejaría
   * el resultado sin forma de repartirlo de nuevo entre los tramos — que es el problema que
   * `alignBlockText` ya tiene que resolver aproximadamente en E2, y no hay razón para
   * volver a pagarlo.
   *
   * Un tramo vacío se deja vacío: pedirle al modelo que traduzca la nada es una invitación a
   * que invente.
   */
  async translate(
    segments: readonly TimedText[],
    onProgress?: (p: TranslateProgress) => void,
  ): Promise<TimedText[]> {
    if (!this.pipe) throw new Error('El traductor no está cargado');
    const salida: TimedText[] = [];

    for (const [i, s] of segments.entries()) {
      const texto = s.text.trim();
      salida.push({
        ...s,
        text: texto ? (await this.pipe(texto))[0].translation_text : '',
      });
      onProgress?.({ done: i + 1, total: segments.length });
    }
    return salida;
  }

  async dispose(): Promise<void> {
    const p = this.pipe as unknown as { dispose?: () => Promise<void> } | null;
    await p?.dispose?.();
    this.pipe = null;
    this.cargado = null;
  }
}

/**
 * Qué dirección corresponde, si es que corresponde alguna.
 *
 * Devuelve `null` cuando no hay par —el audio y el destino son el mismo idioma, o el idioma
 * del audio no se sabe—. Está afuera de la clase para poder probarlo sin cargar 235 MB.
 */
export function parPara(desde: string | undefined, hasta: string): Par | null {
  // La guarda de `!desde` es **redundante** —sin ella, `undefined` arma la clave
  // «undefined-en», que tampoco está en `PARES`— y se deja porque dice la intención. La
  // prueba de mutación lo confirmó: quitarla no cambia nada observable.
  if (!desde || desde === hasta) return null;
  const clave = `${desde}-${hasta}`;
  return clave in PARES ? (clave as Par) : null;
}
