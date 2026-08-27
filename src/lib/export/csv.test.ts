import { describe, expect, it } from 'vitest';
import { CSV_BOM, CSV_HEADER, escapeField, toCsv } from './csv';
import type { TimedText } from '../vad/align';

/**
 * El CSV, comprobado con un analizador escrito a la especificación.
 *
 * Igual que con el SRT: serializar y volver a leer con **el mismo** código no probaría
 * nada. Este analizador implementa RFC 4180 —comillas dobles adentro, campos
 * entrecomillados que pueden traer comas y saltos de línea— y no comparte una línea con el
 * exportador.
 */

/** Analizador de CSV según RFC 4180. Escrito para probar, no para usar. */
function parseCsv(texto: string): string[][] {
  const sinBom = texto.startsWith(CSV_BOM) ? texto.slice(1) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < sinBom.length; i++) {
    const c = sinBom[i];
    if (enComillas) {
      if (c === '"') {
        if (sinBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') enComillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\r' && sinBom[i + 1] === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      throw new Error('salto de línea suelto fuera de comillas: no es CRLF');
    } else campo += c;
  }
  if (campo || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

const TRAMOS: TimedText[] = [
  { startSec: 0.5, endSec: 2.25, text: 'Hola, ¿qué tal?' },
  { startSec: 3, endSec: 4.5, text: 'Dijo «hola» y se fue' },
  { startSec: 5, endSec: 6, text: '' },
  { startSec: 3661.004, endSec: 3663, text: 'Pasada la hora' },
];

describe('toCsv', () => {
  it('produce una cabecera estable y una fila por tramo con texto', () => {
    const filas = parseCsv(toCsv(TRAMOS));
    expect(filas[0]).toEqual([...CSV_HEADER]);
    // El tramo vacío no genera fila: una fila en blanco en una planilla es ruido.
    expect(filas).toHaveLength(4);
    expect(filas.map((f) => f[5]).slice(1)).toEqual([
      'Hola, ¿qué tal?',
      'Dijo «hola» y se fue',
      'Pasada la hora',
    ]);
  });

  it('el texto con coma sobrevive al viaje de ida y vuelta', () => {
    // Es el caso normal, no el raro: una transcripción trae comas casi siempre. Sin
    // entrecomillar, esa fila tendría una columna de más y el archivo entero se corre.
    const [, primera] = parseCsv(toCsv(TRAMOS));
    expect(primera).toHaveLength(CSV_HEADER.length);
    expect(primera[5]).toBe('Hola, ¿qué tal?');
  });

  it('los segundos son número y el tiempo legible es texto', () => {
    const [, primera] = parseCsv(toCsv(TRAMOS));
    expect(Number(primera[0])).toBeCloseTo(0.5, 3);
    expect(Number(primera[1])).toBeCloseTo(2.25, 3);
    expect(primera[2]).toBe('00:00:00.500');
    expect(primera[3]).toBe('00:00:02.250');
  });

  it('el tiempo legible no lleva comas', () => {
    // Con la coma del SRT, cada fila tendría dos campos que hay que entrecomillar por una
    // razón evitable. Es la clase de detalle que un analizador flojo no perdona.
    const csv = toCsv(TRAMOS);
    for (const fila of parseCsv(csv).slice(1)) {
      expect(fila[2]).not.toContain(',');
      expect(fila[3]).not.toContain(',');
    }
  });

  it('pasada la hora el formato no se rompe', () => {
    const filas = parseCsv(toCsv(TRAMOS));
    expect(filas[3][2]).toBe('01:01:01.004');
  });

  it('arranca con la marca de orden de bytes', () => {
    // Sin ella Excel en Windows muestra «configuraciÃ³n» en vez de «configuración».
    expect(toCsv(TRAMOS).startsWith(CSV_BOM)).toBe(true);
  });

  it('separa filas con CRLF', () => {
    // El analizador de arriba tira si encuentra un salto suelto, así que esto se comprueba
    // solo — pero conviene que falle con un nombre que lo diga.
    expect(() => parseCsv(toCsv(TRAMOS))).not.toThrow();
    expect(toCsv(TRAMOS)).toContain('\r\n');
  });

  it('el hablante va en columna propia, no pegado al texto', () => {
    // En una tabla el hablante es un campo por el que se filtra y se agrupa. Como prefijo
    // del texto habría que volver a separarlo con una expresión regular en cada uso.
    const conHablante: TimedText[] = [
      { startSec: 0, endSec: 1, text: 'Buenas', speaker: 'Martín' },
      { startSec: 1, endSec: 2, text: 'Hola', speaker: 'Ana' },
    ];
    const filas = parseCsv(toCsv(conHablante));
    expect(filas[0][4]).toBe('speaker');
    expect(filas.slice(1).map((f) => [f[4], f[5]])).toEqual([
      ['Martín', 'Buenas'],
      ['Ana', 'Hola'],
    ]);
  });

  it('sin hablante la columna queda vacía y el resto no se corre', () => {
    // La diarización es opcional: sin ella el archivo tiene que seguir siendo válido y con
    // la misma cantidad de columnas.
    const filas = parseCsv(toCsv(TRAMOS));
    for (const f of filas) expect(f).toHaveLength(CSV_HEADER.length);
    expect(filas[1][4]).toBe('');
  });

  it('un nombre con coma también se escapa', () => {
    const filas = parseCsv(toCsv([{ startSec: 0, endSec: 1, text: 'Hola', speaker: 'Pérez, Ana' }]));
    expect(filas[1][4]).toBe('Pérez, Ana');
    expect(filas[1]).toHaveLength(CSV_HEADER.length);
  });

  it('sin tramos con texto queda sólo la cabecera', () => {
    const filas = parseCsv(toCsv([{ startSec: 0, endSec: 1, text: '   ' }]));
    expect(filas).toEqual([[...CSV_HEADER]]);
  });
});

describe('escapeField', () => {
  it('deja en paz lo que no lo necesita', () => {
    expect(escapeField('hola')).toBe('hola');
    expect(escapeField('con acentos: ñ á')).toBe('con acentos: ñ á');
  });

  it('entrecomilla comas, comillas y saltos de línea', () => {
    expect(escapeField('a,b')).toBe('"a,b"');
    expect(escapeField('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(escapeField('dos\nlíneas')).toBe('"dos\nlíneas"');
  });

  it('CONTROL: sin escapar, el analizador vería columnas de más', () => {
    // El control que hace que el test de arriba signifique algo: demuestra que el problema
    // es real y que el analizador lo nota.
    const filas = parseCsv(`a,b\r\nuno,dos,tres\r\n`);
    expect(filas[1]).toHaveLength(3);
    expect(filas[0]).toHaveLength(2);
  });
});
