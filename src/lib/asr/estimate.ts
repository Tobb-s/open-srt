import { TARGET_SAMPLE_RATE } from '../audio/decode';
import { rtfMedian, type ModelProfile } from './models';

/**
 * Cuánto va a tardar, dicho con honestidad.
 *
 * Es el rasgo que separa esta herramienta de una que te deja mirando una barra cuarenta
 * minutos sin saber si avanza. Y no se puede resolver con un número de tabla: el RTF de
 * E0 se midió en **un** equipo, y el de quien la use puede ser muy distinto.
 *
 * La estimación pasa por tres estados, y cada uno dice de dónde salió:
 *
 * 1. **`tabla`** — el RTF medido en E0, en otro equipo. Sólo la primera vez.
 * 2. **`aprendido`** — la mediana de lo que este equipo tardó en transcripciones
 *    anteriores. Es lo habitual a partir del segundo archivo.
 * 3. **`calibrado`** — medido con la primera ventana real de este archivo.
 * 4. **`refinado`** — recalculado sobre todo lo procesado hasta el momento.
 *
 * Los dos últimos **sólo se alcanzan con los timestamps activados**, que están apagados por
 * defecto porque degradan el WER en audio difícil (ver
 * `benchmarks/resultados-timestamps.md`). En la configuración normal el estado que importa
 * es `aprendido`, y por eso existe `learned.ts`.
 *
 * ── Por qué la ventana de calibración es de 30 segundos ──
 *
 * Whisper **siempre** procesa ventanas de 30 s: si le das 5 s, rellena con silencio hasta
 * completarlas y cobra lo mismo. Calibrar con un fragmento más corto mediría «lo que
 * cuesta una ventana» dividido por menos audio del que en realidad procesó, y el RTF
 * saldría inflado varias veces. Una ventana exacta es la unidad de trabajo real.
 */

export type EstimateSource = 'tabla' | 'aprendido' | 'calibrado' | 'refinado';

export interface Estimate {
  /** Segundos que falta esperar. */
  remainingSec: number;
  /** Segundos totales que va a llevar el archivo entero. */
  totalSec: number;
  rtf: number;
  source: EstimateSource;
}

/** Una ventana de Whisper. Es la unidad de trabajo, no un parámetro ajustable. */
export const WINDOW_SEC = 30;

/**
 * La primera ventana paga el calentamiento —compilar los shaders de WebGPU, reservar los
 * buffers—, así que su RTF sale más alto que el de régimen. Se usa igual, porque
 * sobrestimar es el error benigno: es preferible decir «cinco minutos» y tardar cuatro
 * que al revés. El estado `refinado` la corrige apenas hay datos de régimen.
 */
export class Estimator {
  private rtf: number;
  private source: EstimateSource = 'tabla';
  private startedAt = 0;
  private firstWindowMs?: number;

  /**
   * @param learnedRtf RTF que este equipo demostró en corridas anteriores, si lo hay.
   *   Reemplaza al de tabla desde el arranque: un número medido acá vale más que uno
   *   medido en otra máquina, aunque sea de otro archivo.
   */
  constructor(profile: ModelProfile, learnedRtf?: number) {
    if (learnedRtf !== undefined && learnedRtf > 0) {
      this.rtf = learnedRtf;
      this.source = 'aprendido';
    } else {
      this.rtf = rtfMedian(profile);
    }
  }

  /** Marca el arranque de la transcripción. */
  start(): void {
    this.startedAt = performance.now();
  }

  /**
   * Informa cuánto tardó la primera ventana completa.
   *
   * Sólo se acepta si de verdad cubrió una ventana entera: con menos audio el número no
   * es comparable, por el relleno hasta 30 s.
   */
  calibrate(elapsedMs: number, audioSec: number): void {
    if (audioSec < WINDOW_SEC * 0.9) return;
    this.firstWindowMs = elapsedMs;
    this.rtf = elapsedMs / 1000 / audioSec;
    this.source = 'calibrado';
  }

  /**
   * Recalcula con todo lo procesado hasta ahora.
   *
   * Se exige más de una ventana para que el calentamiento no siga dominando el promedio.
   */
  refine(processedSec: number): void {
    if (processedSec <= WINDOW_SEC) return;
    const elapsedSec = (performance.now() - this.startedAt) / 1000;
    if (elapsedSec <= 0) return;
    this.rtf = elapsedSec / processedSec;
    this.source = 'refinado';
  }

  estimate(durationSec: number, processedSec = 0): Estimate {
    const remaining = Math.max(0, durationSec - processedSec);
    return {
      remainingSec: remaining * this.rtf,
      totalSec: durationSec * this.rtf,
      rtf: this.rtf,
      source: this.source,
    };
  }

  /** Cuánto pesó el calentamiento. Se muestra sólo en diagnóstico. */
  get warmupRatio(): number | undefined {
    if (this.firstWindowMs === undefined || this.source !== 'refinado') return undefined;
    const steady = this.rtf * WINDOW_SEC * 1000;
    return steady > 0 ? this.firstWindowMs / steady : undefined;
  }
}

/** Los primeros `seconds` de audio, para calibrar sin procesar el archivo entero. */
export function firstSeconds(audio: Float32Array, seconds: number): Float32Array {
  const n = Math.min(audio.length, Math.round(seconds * TARGET_SAMPLE_RATE));
  return audio.subarray(0, n);
}

/**
 * Redacta la espera en lenguaje llano.
 *
 * Con `source: 'tabla'` **dice que es aproximado**, porque ese número viene de otro
 * equipo. Presentar una estimación prestada como si fuera medida acá sería justamente la
 * clase de mentira cómoda que esta herramienta no quiere contar.
 */
export function describeEstimate(e: Estimate): string {
  const s = Math.round(e.remainingSec);
  let tiempo: string;
  if (s < 45) tiempo = 'menos de un minuto';
  else if (s < 90) tiempo = 'alrededor de un minuto';
  else if (s < 3600) tiempo = `alrededor de ${Math.round(s / 60)} minutos`;
  else {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    tiempo = m === 0 ? `alrededor de ${h} h` : `alrededor de ${h} h ${m} min`;
  }
  // Sólo se marca como aproximada la que viene de otro equipo. Una estimación aprendida
  // acá ya no necesita disculpa, aunque tampoco es exacta.
  return e.source === 'tabla' ? `${tiempo} (estimación aproximada)` : tiempo;
}
