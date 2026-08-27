/**
 * Un color por hablante.
 *
 * ── Por qué una paleta fija y no un color calculado ──
 *
 * Generar un tono a partir del índice —`hsl(i * 137, …)`— da colores bonitos y algunos
 * ilegibles: el amarillo puro sobre blanco no se lee, y dos tonos vecinos no se distinguen si
 * caen juntos. Cinco colores elegidos a mano, con su versión clara y oscura, son menos
 * flexibles y siempre legibles.
 *
 * ── Por qué el color no es la única señal ──
 *
 * Alrededor del 8 % de los varones no distingue rojo de verde. El nombre del hablante va
 * **escrito** al lado del color en todos lados; el color acompaña, no informa solo. Es la
 * razón por la que la paleta puede permitirse ser corta.
 *
 * Con más hablantes que colores, se repiten. Es mejor que inventar tonos ilegibles: el nombre
 * sigue distinguiéndolos.
 */

export interface ColorHablante {
  /** Clase de Tailwind para el texto del nombre. */
  texto: string;
  /** Clase para el fondo de la etiqueta. */
  fondo: string;
  /** Clase para la barra vertical que marca el tramo. */
  barra: string;
}

const PALETA: readonly ColorHablante[] = [
  {
    texto: 'text-sky-700 dark:text-sky-300',
    fondo: 'bg-sky-50 dark:bg-sky-950/50',
    barra: 'bg-sky-500',
  },
  {
    texto: 'text-amber-700 dark:text-amber-300',
    fondo: 'bg-amber-50 dark:bg-amber-950/50',
    barra: 'bg-amber-500',
  },
  {
    texto: 'text-emerald-700 dark:text-emerald-300',
    fondo: 'bg-emerald-50 dark:bg-emerald-950/50',
    barra: 'bg-emerald-500',
  },
  {
    texto: 'text-violet-700 dark:text-violet-300',
    fondo: 'bg-violet-50 dark:bg-violet-950/50',
    barra: 'bg-violet-500',
  },
  {
    texto: 'text-rose-700 dark:text-rose-300',
    fondo: 'bg-rose-50 dark:bg-rose-950/50',
    barra: 'bg-rose-500',
  },
];

export const CANTIDAD_COLORES = PALETA.length;

/**
 * El color de un hablante, por su posición en el orden de aparición.
 *
 * Se pasa la posición y no la etiqueta para que dos personas renombradas con el mismo nombre
 * —la forma de unir un hablante partido en dos— compartan color además de nombre.
 */
export function colorDeHablante(posicion: number): ColorHablante {
  const i = ((posicion % PALETA.length) + PALETA.length) % PALETA.length;
  return PALETA[i];
}

/**
 * Ordena los hablantes por cuándo aparecen por primera vez.
 *
 * Por orden de aparición y no alfabético: en una entrevista, quien pregunta habla primero, y
 * que le toque siempre el primer color hace que la pantalla se lea igual entre archivos.
 */
export function ordenDeAparicion(speakers: ReadonlyArray<string | undefined>): string[] {
  const vistos: string[] = [];
  for (const s of speakers) {
    if (s !== undefined && !vistos.includes(s)) vistos.push(s);
  }
  return vistos;
}
