import type { TimedText } from '../vad/align';

/**
 * De tramos con texto a subtítulos legibles.
 *
 * Serializar los tramos tal cual daría un archivo válido que se lee mal: líneas que no
 * entran en pantalla, subtítulos que desaparecen antes de poder leerlos y otros que se
 * quedan diez segundos. Las reglas de acá son las convenciones del subtitulado, y cada una
 * responde a un problema concreto de lectura.
 */

export interface SubtitleRules {
  /** Caracteres por línea. Más ancho no entra en pantalla ni se lee de un vistazo. */
  maxCharsPerLine: number;
  /** Líneas por subtítulo. Tres o más tapan la imagen y obligan a leer en vez de mirar. */
  maxLines: number;
  /** Menos que esto parpadea: aparece y se va antes de que el ojo lo agarre. */
  minDurationSec: number;
  /** Más que esto se queda quieto en pantalla mucho después de que se leyó. */
  maxDurationSec: number;
  /**
   * Caracteres por segundo que una persona alcanza a leer.
   *
   * Es la regla que decide si un texto **entra** en su tiempo: si no entra, hay que
   * partirlo en dos subtítulos, no encogerle la letra.
   */
  readingCharsPerSec: number;
}

export const DEFAULT_RULES: SubtitleRules = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDurationSec: 1.0,
  maxDurationSec: 7.0,
  readingCharsPerSec: 17,
};

export interface Cue {
  index: number;
  startSec: number;
  endSec: number;
  /** Ya partido en líneas. */
  lines: string[];
  /** Quien habla, si se sabe. Cada formato decide como escribirlo. */
  speaker?: string;
}

/**
 * Parte un texto en líneas de a lo sumo `maxChars`, **sin cortar palabras**.
 *
 * Una palabra más larga que el límite se deja entera y se pasa: partir
 * «anticonstitucionalmente» a la mitad es peor que una línea un poco larga.
 */
export function wrapText(text: string, maxChars: number): string[] {
  const palabras = text.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];

  const lineas: string[] = [];
  let actual = '';
  for (const w of palabras) {
    if (!actual) actual = w;
    else if (actual.length + 1 + w.length <= maxChars) actual += ` ${w}`;
    else {
      lineas.push(actual);
      actual = w;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Cuántos caracteres entran en un subtítulo, según sus reglas. */
function capacidad(rules: SubtitleRules): number {
  return rules.maxCharsPerLine * rules.maxLines;
}

/**
 * Convierte tramos en subtítulos.
 *
 * Tres transformaciones, en este orden:
 *
 * 1. **Partir lo que no entra.** Un tramo con más texto del que cabe —o del que se puede
 *    leer en su tiempo, o que dura más de lo tolerable— se divide en varios subtítulos y
 *    el tiempo se reparte en proporción al texto.
 * 2. **Estirar lo que parpadea**, sin pisar el subtítulo siguiente.
 * 3. **Numerar** desde 1.
 *
 * Los tramos sin texto se descartan: un subtítulo vacío en pantalla es un error visible.
 * Que existan es información —el modelo omitió algo— pero eso lo reporta `checkCoverage`,
 * no el archivo de subtítulos.
 */
export function toCues(
  timed: readonly TimedText[],
  rules: SubtitleRules = DEFAULT_RULES,
): Cue[] {
  const cap = capacidad(rules);
  const partidos: Array<{
    startSec: number;
    endSec: number;
    text: string;
    speaker?: string;
  }> = [];

  for (const t of timed) {
    const texto = t.text.trim();
    if (!texto) continue;

    const dur = Math.max(0, t.endSec - t.startSec);
    // ¿En cuántos subtítulos hay que partirlo? El máximo de las tres razones posibles.
    const porTamaño = Math.ceil(texto.length / cap);
    const porLectura = Math.ceil(texto.length / (rules.readingCharsPerSec * Math.max(dur, 0.1)));
    const porDuracion = Math.ceil(dur / rules.maxDurationSec);
    const partes = Math.max(1, porTamaño, porLectura, porDuracion);

    if (partes === 1) {
      partidos.push({ startSec: t.startSec, endSec: t.endSec, text: texto, speaker: t.speaker });
      continue;
    }

    // Repartir por palabras, en trozos parejos, y el tiempo en proporción a lo que le tocó
    // a cada uno: un trozo con más texto se queda más rato.
    const palabras = texto.split(/\s+/);
    const porParte = Math.ceil(palabras.length / partes);
    const trozos: string[] = [];
    for (let i = 0; i < palabras.length; i += porParte) {
      trozos.push(palabras.slice(i, i + porParte).join(' '));
    }

    const totalChars = trozos.reduce((a, x) => a + x.length, 0) || 1;
    let cursor = t.startSec;
    for (const [i, trozo] of trozos.entries()) {
      const esUltimo = i === trozos.length - 1;
      const fin = esUltimo ? t.endSec : cursor + (dur * trozo.length) / totalChars;
      partidos.push({ startSec: cursor, endSec: fin, text: trozo, speaker: t.speaker });
      cursor = fin;
    }
  }

  // Estirar los que parpadean, sin invadir al siguiente.
  for (const [i, c] of partidos.entries()) {
    if (c.endSec - c.startSec >= rules.minDurationSec) continue;
    const siguiente = partidos[i + 1];
    const tope = siguiente ? siguiente.startSec : Infinity;
    c.endSec = Math.min(c.startSec + rules.minDurationSec, tope);
  }

  return partidos.map((c, i) => ({
    index: i + 1,
    startSec: c.startSec,
    endSec: c.endSec,
    lines: wrapText(c.text, rules.maxCharsPerLine).slice(0, rules.maxLines),
    speaker: c.speaker,
  }));
}

/**
 * Formatea un tiempo.
 *
 * SRT usa **coma** para los milisegundos y VTT usa **punto**. No es un detalle estético:
 * un SRT con puntos falla en varios reproductores.
 */
export function formatTime(sec: number, separator: ',' | '.'): string {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  // Redondear los milisegundos puede llevarlos a 1000; hay que arrastrar el segundo.
  const [sFinal, msFinal] = ms === 1000 ? [s + 1, 0] : [s, ms];
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(sFinal)}${separator}${pad(msFinal, 3)}`;
}

/**
 * SubRip.
 *
 * Numeración desde 1, tiempos con coma y **saltos de línea CRLF**: es lo que espera el
 * formato y lo que evita problemas en reproductores viejos de Windows.
 */
export function toSrt(cues: readonly Cue[]): string {
  return (
    cues
      .map((c) =>
        [
          String(c.index),
          `${formatTime(c.startSec, ',')} --> ${formatTime(c.endSec, ',')}`,
          // SubRip **no tiene** campo de hablante. La convencion de la industria es
          // escribirlo en el texto, asi que va como prefijo de la primera linea. Poner una
          // linea aparte gastaria una de las dos que caben en pantalla.
          ...(c.speaker ? conPrefijo(c.lines, `${c.speaker}: `) : c.lines),
        ].join('\r\n'),
      )
      .join('\r\n\r\n') + '\r\n'
  );
}

/** Antepone el nombre a la primera linea, sin tocar las demas. */
function conPrefijo(lineas: readonly string[], prefijo: string): string[] {
  if (lineas.length === 0) return [prefijo.trimEnd()];
  return [prefijo + lineas[0], ...lineas.slice(1)];
}

/**
 * Escapa lo que romperia el marcado de WebVTT.
 *
 * `<` y `&` tienen significado dentro de una etiqueta `<v>`; un texto transcrito puede
 * traerlos y el navegador dejaria de mostrar la linea o la mostraria cortada.
 */
function escaparVtt(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * WebVTT.
 *
 * Cabecera obligatoria `WEBVTT`, tiempos con punto y saltos LF. Sin la cabecera el
 * navegador rechaza el archivo entero sin decir por qué.
 */
export function toVtt(cues: readonly Cue[]): string {
  const cuerpo = cues
    .map((c) => {
      // WebVTT **si** tiene campo de hablante: `<v Nombre>`. Es la unica de las cuatro
      // salidas donde el reproductor sabe que eso es una persona y no texto, asi que puede
      // darle estilo o mostrarlo aparte.
      const lineas = c.speaker
        ? [`<v ${escaparVtt(c.speaker)}>${escaparVtt(c.lines[0] ?? '')}`, ...c.lines.slice(1).map(escaparVtt)]
        : c.lines.map(escaparVtt);
      return [`${formatTime(c.startSec, '.')} --> ${formatTime(c.endSec, '.')}`, ...lineas].join('\n');
    })
    .join('\n\n');
  return `WEBVTT\n\n${cuerpo}\n`;
}

/** Texto plano, un tramo por línea. */
export function toPlainText(timed: readonly TimedText[]): string {
  const lineas: string[] = [];
  let ultimo: string | undefined;

  for (const t of timed) {
    const texto = t.text.trim();
    if (!texto) continue;
    // El nombre se escribe cuando **cambia** el hablante. Repetirlo en cada tramo llenaria
    // la pagina de «Martin:» cuando Martin habla cinco tramos seguidos.
    if (t.speaker && t.speaker !== ultimo) lineas.push(`${t.speaker}: ${texto}`);
    else lineas.push(texto);
    ultimo = t.speaker;
  }
  return lineas.join('\n');
}
