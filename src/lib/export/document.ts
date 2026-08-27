import type { TimedText } from '../vad/align';
import { formatTime } from './subtitles';

/**
 * La transcripción como **documento para leer**, no como volcado de datos.
 *
 * ── Por qué hay un modelo intermedio ──
 *
 * DOCX y PDF se construyen con bibliotecas que no se parecen en nada: una arma un árbol de
 * párrafos y deja que Word decida dónde cortar las líneas; la otra dibuja texto en
 * coordenadas y hay que calcular todo a mano. Si cada exportador armara el documento por su
 * cuenta, las dos salidas se irían separando —una con la hora en el margen, la otra no; una
 * paginando bien, la otra cortando un tramo al medio— y nadie lo notaría hasta abrir los dos
 * archivos al lado.
 *
 * Acá se decide **qué dice el documento**; cada adaptador decide sólo cómo se dibuja.
 *
 * ── Lo que `textLayout.ts` de OpenPDF no resuelve ──
 *
 * El plan de E3 anotaba reutilizarlo «para el flujo de texto». **No aplica**: ese módulo
 * reconstruye párrafos a partir de las corridas de glifos que devuelve pdf.js, o sea que va
 * en la dirección contraria —de PDF a texto—. Para escribir un PDF hay que partir líneas
 * midiéndolas con la fuente, que es lo que hace `wrapByMeasure`.
 */

export interface DocRow {
  /** `HH:MM:SS` — sin milisegundos: en un documento para leer son ruido. */
  time: string;
  text: string;
  /**
   * Quien habla, **solo cuando cambia**.
   *
   * Repetirlo en cada fila llenaria la columna de «Martin» cuando Martin habla cinco tramos
   * seguidos, y el ojo dejaria de verlo. Vacio significa «sigue el anterior».
   */
  speaker?: string;
}

export interface DocModel {
  title: string;
  /** Nombre del archivo, duración y cuántos tramos. Va bajo el título. */
  subtitle: string;
  rows: DocRow[];
}

export interface DocLabels {
  /** Encabezado del documento, ya traducido. */
  title: string;
  /** Cómo se arma la línea de contexto. Recibe archivo, duración y tramos. */
  subtitle: (file: string, duration: string, rows: number) => string;
}

/**
 * Arma el modelo del documento.
 *
 * Los tramos sin texto se descartan, igual que en los subtítulos y en el CSV: una fila vacía
 * con una hora al lado parece un error del documento y no lo es.
 */
export function layoutTranscript(
  segments: readonly TimedText[],
  opts: { fileName: string; durationHuman: string; labels: DocLabels },
): DocModel {
  const rows: DocRow[] = [];
  let ultimo: string | undefined;
  for (const s of segments) {
    const texto = s.text.trim();
    if (!texto) continue;
    // Sin milisegundos, y sin la coma del SRT: acá el tiempo es una referencia para el ojo,
    // no una marca que tenga que consumir un reproductor.
    rows.push({
      time: formatTime(s.startSec, '.').slice(0, 8),
      text: texto,
      speaker: s.speaker && s.speaker !== ultimo ? s.speaker : undefined,
    });
    ultimo = s.speaker;
  }

  return {
    title: opts.labels.title,
    subtitle: opts.labels.subtitle(opts.fileName, opts.durationHuman, rows.length),
    rows,
  };
}

/**
 * Parte un texto en líneas que entren en `maxWidth`, midiéndolas de verdad.
 *
 * `measure` viene de afuera —en el PDF es `font.widthOfTextAtSize`— para que esta función se
 * pueda probar sin cargar una fuente ni una biblioteca de PDF. Es la misma razón por la que
 * el bucle de bloques salió de la clase `Transcriber` en E2.
 *
 * Una palabra más ancha que el renglón se deja entera y se pasa: partir
 * «anticonstitucionalmente» a la mitad es peor que un renglón que sobresale. Es la misma
 * decisión que toma `wrapText` para los subtítulos, y por la misma razón.
 */
export function wrapByMeasure(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const palabras = text.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];

  const lineas: string[] = [];
  let actual = '';
  for (const w of palabras) {
    const candidata = actual ? `${actual} ${w}` : w;
    if (!actual || measure(candidata) <= maxWidth) actual = candidata;
    else {
      lineas.push(actual);
      actual = w;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/**
 * Reparte las filas en páginas.
 *
 * Devuelve índices de corte, no páginas armadas: quién dibuja decide qué hacer con ellos, y
 * así esto se prueba con números en vez de con un PDF.
 *
 * **Un tramo no se parte entre páginas si entra entero en una.** Un tramo cortado al medio
 * obliga a dar vuelta la hoja para terminar una frase, que es exactamente lo que un
 * documento para leer no tiene que hacer.
 *
 * La primera página tiene menos lugar porque lleva el encabezado. Con un solo alto para
 * todas, el hueco del encabezado se reservaba también en las siguientes y quedaban cuatro
 * centímetros de blanco arriba de cada una — visible al abrir el PDF, y por eso está medido
 * y no supuesto.
 */
export function paginate(
  rowHeights: readonly number[],
  usableHeight: number,
  firstPageHeight: number = usableHeight,
): number[][] {
  const paginas: number[][] = [];
  let actual: number[] = [];
  let alto = 0;
  let disponible = firstPageHeight;

  for (const [i, h] of rowHeights.entries()) {
    // Si no entra y la página ya tiene algo, se cierra y empieza otra. Si no entra y la
    // página está vacía, es un tramo más alto que la página entera: va igual y se desborda,
    // porque la alternativa es perderlo.
    if (alto + h > disponible && actual.length > 0) {
      paginas.push(actual);
      actual = [];
      alto = 0;
      disponible = usableHeight;
    }
    actual.push(i);
    alto += h;
  }
  if (actual.length > 0) paginas.push(actual);
  return paginas;
}
