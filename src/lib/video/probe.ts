/**
 * La prueba que decide cómo se saca el audio de un video.
 *
 * ── Qué hay que decidir ──
 *
 * El plan de E3 planteaba dos caminos: **ffmpeg.wasm**, que cubre todo pero exige las
 * cabeceras COOP/COEP —y esas cabeceras bloquean recursos de otro origen, con lo que
 * romperían la descarga del modelo desde Hugging Face que E1 dejó andando—, o **WebCodecs
 * más un demultiplexor** como mp4box.js, que evita las cabeceras pero cubre lo que cubra
 * cada navegador.
 *
 * Antes de traer ninguna de las dos hay una hipótesis más barata que probar: que
 * `decodeAudioData` —lo que el producto ya usa para audio— abra directamente la pista de
 * audio de un contenedor de video. Si es así, E3 no necesita ninguna dependencia nueva ni
 * ninguna cabecera, y el riesgo que el plan quería evitar desaparece solo.
 *
 * ── Cómo se prueba sin depender de archivos ajenos ──
 *
 * El navegador **graba su propio material**: un lienzo animado más un tono con ráfagas en
 * segundos conocidos, pasados por `MediaRecorder`, dan un mp4 y un webm de verdad. Que sean
 * generados acá tiene una ventaja sobre traer un archivo cualquiera: **se sabe qué tiene
 * que sonar y cuándo**, así que se puede comprobar que el audio extraído es el correcto y
 * no ruido con la duración correcta.
 *
 * Tiene también una limitación que hay que declarar: `MediaRecorder` produce lo que ese
 * navegador sabe producir. No genera `.mkv`, así que ese contenedor queda sin probar y
 * necesita un archivo real.
 *
 * ── Las muestras compartidas ──
 *
 * Los archivos de `public/muestras/` **se versionan y se despliegan**. Son 350 KB y hacen
 * que la prueba se pueda correr en cualquier navegador y en cualquier máquina, contra los
 * mismos bytes. Sin eso, cada navegador medía lo que él mismo sabía grabar — y Firefox, que
 * no graba mp4, quedaba sin poder responder la pregunta que más importaba.
 *
 * Entre ellos hay un `.mov` que es **byte por byte el mismo mp4, renombrado**. No prueba los
 * átomos propios de QuickTime; prueba otra cosa concreta y útil: si el navegador decide por
 * el contenido o por la extensión. Un `.mov` de teléfono es ISOBMFF igual que un mp4, así
 * que si el navegador mira el contenido, ese caso queda cubierto.
 */

/** Las ráfagas de tono, en segundos. Es la verdad contra la que se compara. */
export const BURSTS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [3, 4],
  [5, 5.5],
];

export const PROBE_SECONDS = 6;

export interface CodecCheck {
  codec: string;
  supported: boolean;
  note?: string;
}

export interface ContainerCheck {
  mime: string;
  /** El archivo grabado. Sólo vive en memoria: `JSON.stringify` lo ignora. */
  blob?: Blob;
  /** `false` si este navegador no sabe grabar ese contenedor. */
  generated: boolean;
  bytes?: number;
  decode: 'ok' | 'no-generado' | string;
  durationSec?: number;
  sampleRate?: number;
  channels?: number;
  /** Energía RMS por segundo. Se guarda entera para poder discutir el veredicto. */
  energyPerSec?: number[];
  /** Si la señal apareció donde se la puso. Es lo que distingue audio de ruido. */
  signalOk?: boolean;
}

/** Un archivo que grabó otro navegador y que éste intenta leer. */
export interface SampleCheck {
  file: string;
  bytes?: number;
  decode: 'ok' | string;
  durationSec?: number;
  sampleRate?: number;
  channels?: number;
  energyPerSec?: number[];
  signalOk?: boolean;
}

export interface VideoProbeResult {
  userAgent: string;
  webCodecs: { audioDecoder: boolean; videoDecoder: boolean };
  codecs: CodecCheck[];
  containers: ContainerCheck[];
  /**
   * Los mismos archivos en todos los navegadores.
   *
   * Es la parte que responde la pregunta de la etapa. `containers` mide **qué sabe grabar**
   * cada navegador, que es una limitación del método y no de lo que se quiere saber:
   * Firefox no graba mp4, así que por ese camino su capacidad de *leerlo* quedaba sin
   * medir. Acá todos leen el mismo archivo.
   */
  samples: SampleCheck[];
  /** Duraciones que el motor de audio aceptó sostener en memoria, en minutos. */
  memoryCeiling: Array<{ minutes: number; allocated: boolean; resampled: boolean; ms?: number }>;
}

/**
 * ¿La energía cayó donde estaban las ráfagas?
 *
 * Compara segundo a segundo contra el patrón conocido. **No alcanza con que haya energía**:
 * un archivo de ruido tendría energía en todos lados y pasaría. Por eso se exige las dos
 * cosas —que suene donde debe y que calle donde debe—, que es la misma forma de control
 * que hizo falta en el test de alucinación.
 *
 * Está afuera del código que toca el navegador para poder probarla con series inventadas.
 */
export function signalMatchesPattern(
  energyPerSec: readonly number[],
  bursts: ReadonlyArray<readonly [number, number]> = BURSTS,
  ratio = 4,
): boolean {
  if (energyPerSec.length === 0) return false;

  const conTono: number[] = [];
  const sinTono: number[] = [];
  for (const [i, e] of energyPerSec.entries()) {
    // Un segundo cuenta como «con tono» si una ráfaga lo cubre entero; los segundos donde
    // la ráfaga entra o sale quedan fuera de las dos listas, porque su energía es mixta.
    const dentro = bursts.some(([a, b]) => a <= i && b >= i + 1);
    const solapa = bursts.some(([a, b]) => b > i && a < i + 1);
    if (dentro) conTono.push(e);
    else if (!solapa) sinTono.push(e);
  }
  if (conTono.length === 0 || sinTono.length === 0) return false;

  const minConTono = Math.min(...conTono);
  const maxSinTono = Math.max(...sinTono);
  // Silencio absoluto no se exige: un códec con pérdida deja algo de energía residual.
  return minConTono > 0 && minConTono > maxSinTono * ratio;
}

/** Energía RMS por segundo de un canal. */
export function energyPerSecond(data: Float32Array, sampleRate: number): number[] {
  const out: number[] = [];
  for (let s = 0; s * sampleRate < data.length; s++) {
    const desde = s * sampleRate;
    const hasta = Math.min(data.length, desde + sampleRate);
    let acc = 0;
    for (let i = desde; i < hasta; i++) acc += data[i] * data[i];
    out.push(Math.sqrt(acc / Math.max(1, hasta - desde)));
  }
  return out;
}
