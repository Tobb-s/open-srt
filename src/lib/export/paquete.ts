import type { TimedText } from '../vad/align';
import { toCues, toSrt, toPlainText } from './subtitles';

/**
 * Descargar varias transcripciones de una vez, en un zip.
 *
 * ── Por qué un zip y no varias descargas ──
 *
 * Bajar diez archivos sueltos dispara diez descargas, y los navegadores lo tratan como
 * comportamiento sospechoso: Chrome pide permiso para «descargar varios archivos» y a
 * partir de ahí las bloquea. Un zip es una descarga, que es lo que el usuario pidió.
 *
 * ── Por qué TXT y SRT y no los seis formatos ──
 *
 * DOCX y PDF cargan cerca de un mega y medio de biblioteca **cada uno** y tardan; hacerlo
 * diez veces dentro de un zip convierte «descargar todas» en una espera larga sin aviso.
 * TXT y SRT son texto puro e instantáneos, y cubren los dos usos reales: leer y subtitular.
 * Quien necesita un DOCX de una transcripción puntual la abre y lo baja.
 *
 * ── Los nombres adentro del zip ──
 *
 * Dos transcripciones se pueden llamar igual —el mismo `grabacion.m4a` de dos días
 * distintos, o dos renombradas a mano—. Sin desambiguar, la segunda pisaría a la primera
 * **dentro del zip** y el usuario se llevaría nueve archivos creyendo que tiene diez.
 */

export interface ParaEmpaquetar {
  nombre: string;
  segments: readonly TimedText[];
}

/** Los nueve caracteres que Windows no acepta en un nombre de archivo. */
const PROHIBIDOS = /[\\/:*?"<>|]+/g;

/**
 * Saca lo que un sistema de archivos no acepta, sin dejar el nombre vacío.
 *
 * **Los espacios se conservan**: Windows, macOS y Linux los aceptan desde hace décadas, y
 * «Reunión de equipo» se lee mejor que «Reunión-de-equipo». Los acentos y la ñ también:
 * sacarlos convertiría «grabación» en «grabacin».
 *
 * Dos casos que los tests encontraron y que la primera versión hacía mal:
 *
 * - «reunión: equipo/ventas*.mp3» quedaba como «reunión- equipo-ventas-», con un guión
 *   suelto al final y otro pegado a un espacio.
 * - «///.mp3» quedaba en «---», que **no es vacío**, así que el respaldo no se activaba y
 *   salía un archivo llamado `---.txt`.
 */
export function nombreSeguro(nombre: string): string {
  const limpio = nombre
    .replace(/\.[^.]+$/, '')
    .replace(PROHIBIDOS, '-')
    .replace(/\s+/g, ' ')
    // Un guión rodeado de espacios o de otros guiones es un solo guión.
    .replace(/[-\s]*-[-\s]*/g, '-')
    // Y ni guiones ni espacios en los bordes: `-reunion-.txt` no lo escribiría nadie.
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return limpio || 'transcripcion';
}

/**
 * Los nombres finales, ya desambiguados.
 *
 * El sufijo es ` (2)`, ` (3)`… como el del explorador de archivos, y se compara **sin
 * distinguir mayúsculas**: en Windows y en macOS `Reunion.txt` y `reunion.txt` son el
 * mismo archivo, así que dejar los dos igual perdería uno al descomprimir.
 */
export function nombresUnicos(nombres: readonly string[]): string[] {
  const vistos = new Map<string, number>();
  return nombres.map((n) => {
    const base = nombreSeguro(n);
    const clave = base.toLowerCase();
    const veces = vistos.get(clave) ?? 0;
    vistos.set(clave, veces + 1);
    return veces === 0 ? base : `${base} (${veces + 1})`;
  });
}

/**
 * Arma el zip. Devuelve un `Blob` listo para descargar.
 *
 * `onAvance` se llama por transcripción para poder decir «3 de 10»: con diez reuniones de
 * una hora esto tarda lo suficiente como para que un botón mudo parezca colgado.
 */
export async function empaquetar(
  items: readonly ParaEmpaquetar[],
  onAvance?: (hechos: number, total: number) => void,
): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const nombres = nombresUnicos(items.map((i) => i.nombre));
  const archivos: Record<string, Uint8Array> = {};

  for (const [i, item] of items.entries()) {
    archivos[`${nombres[i]}.txt`] = strToU8(toPlainText(item.segments));
    archivos[`${nombres[i]}.srt`] = strToU8(toSrt(toCues(item.segments)));
    onAvance?.(i + 1, items.length);
  }

  // `level: 0` —sin comprimir— sería más rápido, pero una transcripción es texto y
  // comprime cerca de 4:1: diez reuniones pasan de unos megas a menos de uno.
  return new Blob([zipSync(archivos, { level: 6 })], { type: 'application/zip' });
}
