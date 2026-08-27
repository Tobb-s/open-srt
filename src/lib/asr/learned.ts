/**
 * El RTF que este equipo demostró tener, aprendido del uso.
 *
 * ── Por qué hace falta ──
 *
 * Con los timestamps apagados —la decisión de `benchmarks/resultados-timestamps.md`— el
 * modelo no informa en qué segundo del audio va, así que la estimación **no se puede
 * calibrar mientras corre**. Quedaría siempre con el RTF de tabla, medido en otro equipo.
 *
 * La salida es medir al final: cuando una transcripción termina, se sabe exactamente
 * cuánto tardó y cuánto audio era. Ese RTF se guarda y la próxima estimación ya no es
 * prestada. La primera vez es aproximada y lo dice; a partir de la segunda, es de acá.
 *
 * ── Por qué la mediana y no el promedio ──
 *
 * El RTF **varía entre corridas**: E0 midió 0,451 para una configuración y una corrida
 * posterior idéntica dio 0,565, un 25 % más, sin más cambio que el momento (estado
 * térmico, carga de fondo). Un promedio arrastra las corridas anómalas; la mediana de las
 * últimas observaciones las ignora.
 *
 * ── Por segundo de HABLA, no de archivo (v2) ──
 *
 * Hasta la v1 se guardaba `tiempo / duración del archivo`. **Estaba mal**, y se vio con un
 * video de 30 minutos: como desde E2 sólo se transcribe lo que el detector marca como voz,
 * ese archivo —44 % silencio— dio 0,255, mientras que uno sin silencio da 0,46. Los dos
 * números describían el mismo equipo y el mismo modelo; lo que cambiaba era **el archivo**.
 * Promediarlos daba un predictor que no predice nada.
 *
 * Ahora la unidad es el segundo de habla, que sí es una propiedad del equipo. Es la misma
 * lección que E1 ya había anotado —«la unidad de la medición tiene que ser la de la
 * predicción»— aplicada en otro lugar.
 *
 * **La clave cambia a `v2` a propósito.** Las observaciones viejas están en la otra unidad y
 * mezclarlas sería exactamente el error que esto corrige; se quedan huérfanas y se ignoran.
 */

const KEY = 'asr:rtf:v2';
/** Cuántas observaciones se guardan por perfil. Suficientes para una mediana estable. */
const MAX_SAMPLES = 5;

type Store = Record<string, number[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    // localStorage puede estar deshabilitado o lleno. No es motivo para romper nada:
    // sin historial, la estimación vuelve a ser la de tabla.
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Ídem: perder el historial es aceptable, romper la transcripción no.
  }
}

export function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** El RTF aprendido para un perfil, si ya hay observaciones. */
export function learnedRtf(profileKey: string): number | undefined {
  return median(read()[profileKey] ?? []);
}

/**
 * Registra el RTF de una transcripción terminada.
 *
 * Se descartan los valores absurdos: un archivo de dos segundos, o una corrida donde el
 * navegador estuvo en segundo plano y el reloj siguió corriendo, darían un RTF que no
 * describe al equipo y contaminaría las estimaciones siguientes.
 */
export function recordRtf(profileKey: string, rtf: number, speechSec: number): void {
  if (!Number.isFinite(rtf) || rtf <= 0 || rtf > 100) return;
  // Con menos de una ventana de habla, el relleno hasta 30 s domina y el RTF sale inflado.
  if (speechSec < 30) return;

  const store = read();
  const list = store[profileKey] ?? [];
  list.push(rtf);
  store[profileKey] = list.slice(-MAX_SAMPLES);
  write(store);
}

/** Cuántas observaciones hay. La interfaz lo usa para decir de dónde sale el número. */
export function sampleCount(profileKey: string): number {
  return (read()[profileKey] ?? []).length;
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // sin consecuencias
  }
}
