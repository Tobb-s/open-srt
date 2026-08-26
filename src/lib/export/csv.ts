import type { TimedText } from '../vad/align';
import { formatTime } from './subtitles';

/**
 * La transcripción como tabla, para quien quiera procesarla.
 *
 * ── Dos columnas de tiempo, no una ──
 *
 * `start_sec` y `end_sec` son números en segundos: es lo que sirve para filtrar, sumar y
 * graficar. `start` y `end` son `HH:MM:SS.mmm`: es lo que sirve para leer y para pegar en
 * un mensaje. Poner sólo una de las dos formas obliga a la mitad de los usos a convertir.
 *
 * El tiempo legible va con **punto** y no con la coma del SRT. Adentro de un CSV una coma
 * obliga a entrecomillar el campo por algo que no lo necesita, y basta un analizador flojo
 * para que la fila se parta al medio.
 *
 * ── Una advertencia sobre Excel en español ──
 *
 * `start_sec` sale como `12.500`, con punto decimal, que es lo correcto para cualquier
 * script. Excel configurado en español lee el punto como separador de miles y muestra
 * **12500**. Las columnas `start` y `end` no tienen ese problema porque son texto: para
 * mirar la tabla a ojo hay que usar ésas.
 *
 * ── Los nombres de columna no se traducen ──
 *
 * El resto de la herramienta es bilingüe, pero un CSV lo consume un script, y un script que
 * busca `text` no puede romperse porque alguien lo exportó desde `/es`. La cabecera es
 * estable a propósito.
 *
 * ── La marca de orden de bytes ──
 *
 * El archivo sale con BOM. No es un capricho: sin ella, Excel en Windows abre el CSV en la
 * codificación del sistema y `configuración` aparece como `configuraciÃ³n`. Con la BOM lo
 * detecta como UTF-8. Los analizadores estrictos la toleran; Excel sin ella, no.
 */

export const CSV_BOM = '﻿';

export const CSV_HEADER = ['start_sec', 'end_sec', 'start', 'end', 'text'] as const;

/**
 * Escapa un campo según RFC 4180.
 *
 * Se entrecomilla si trae coma, comilla o un salto de línea, y las comillas de adentro se
 * duplican. Un texto transcrito trae comas casi siempre, así que esto no es un caso raro:
 * es el caso normal.
 */
export function escapeField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Serializa los tramos como CSV.
 *
 * Se descartan los tramos sin texto, igual que en los subtítulos: una fila vacía en una
 * planilla es ruido. Que existan es información —el modelo omitió algo— pero eso lo reporta
 * `checkCoverage`, no este archivo.
 *
 * Salta de línea con CRLF porque es lo que dice el RFC y lo que Excel espera.
 */
export function toCsv(timed: readonly TimedText[]): string {
  const filas = [CSV_HEADER.join(',')];

  for (const t of timed) {
    const texto = t.text.trim();
    if (!texto) continue;
    filas.push(
      [
        t.startSec.toFixed(3),
        t.endSec.toFixed(3),
        formatTime(t.startSec, '.'),
        formatTime(t.endSec, '.'),
        escapeField(texto),
      ].join(','),
    );
  }

  return CSV_BOM + filas.join('\r\n') + '\r\n';
}
