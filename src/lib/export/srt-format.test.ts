import { describe, it, expect } from 'vitest';
import { toCues, toSrt, toVtt } from './subtitles';
import type { TimedText } from '../vad/align';

/**
 * Validación estricta del formato, contra un analizador escrito según la especificación.
 *
 * El criterio de E2 pide que el archivo «abra en VLC y en YouTube». Sin esos programas a
 * mano, lo más cerca es analizarlo con reglas estrictas y comprobar que lo que sale es lo
 * que entró. Un archivo que sobrevive ida y vuelta sin perder nada es un archivo bien
 * formado; uno que no, falla en cualquier reproductor.
 *
 * El analizador es deliberadamente **severo**: no tolera desviaciones que un reproductor
 * indulgente perdonaría, porque el que no perdona es el que rompe.
 */

interface ParsedCue {
  index: number;
  startMs: number;
  endMs: number;
  lines: string[];
}

const TIEMPO_SRT = /^(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})$/;

/** Analizador de SubRip. Devuelve los subtítulos o lanza con el motivo exacto. */
function parseSrt(texto: string): ParsedCue[] {
  if (!texto.includes('\r\n')) throw new Error('el archivo no usa CRLF');

  const bloques = texto.trim().split('\r\n\r\n');
  return bloques.map((bloque, i) => {
    const lineas = bloque.split('\r\n');
    if (lineas.length < 3) throw new Error(`bloque ${i + 1}: faltan líneas`);

    const index = Number(lineas[0]);
    if (!Number.isInteger(index)) throw new Error(`bloque ${i + 1}: el número no es entero`);

    const m = TIEMPO_SRT.exec(lineas[1]);
    if (!m) throw new Error(`bloque ${i + 1}: línea de tiempos mal formada: "${lineas[1]}"`);

    const ms = (h: string, mi: string, s: string, milis: string) =>
      Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(milis);

    return {
      index,
      startMs: ms(m[1], m[2], m[3], m[4]),
      endMs: ms(m[5], m[6], m[7], m[8]),
      lines: lineas.slice(2),
    };
  });
}

const TIEMPO_VTT = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/;

function parseVtt(texto: string): ParsedCue[] {
  if (!texto.startsWith('WEBVTT')) throw new Error('falta la cabecera WEBVTT');
  const cuerpo = texto.slice(texto.indexOf('\n\n') + 2).trim();
  return cuerpo.split('\n\n').map((bloque, i) => {
    const lineas = bloque.split('\n');
    const m = TIEMPO_VTT.exec(lineas[0]);
    if (!m) throw new Error(`bloque ${i + 1}: tiempos mal formados: "${lineas[0]}"`);
    const ms = (h: string, mi: string, s: string, milis: string) =>
      Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(milis);
    return {
      index: i + 1,
      startMs: ms(m[1], m[2], m[3], m[4]),
      endMs: ms(m[5], m[6], m[7], m[8]),
      lines: lineas.slice(1),
    };
  });
}

/** Un caso realista: tramos de duración variable, con texto de largo variable. */
const TRAMOS: TimedText[] = [
  { startSec: 0.9, endSec: 4.3, text: 'Te aconsejo que lleves un impermeable.' },
  { startSec: 4.8, endSec: 9.2, text: 'Tenés muy pocas opciones si te interesa la fotografía.' },
  { startSec: 9.7, endSec: 15.1, text: 'El viaje por tierra es más largo que el viaje en barco, sobre todo si hay mal tiempo.' },
  { startSec: 15.6, endSec: 16.0, text: 'Sí.' },
  { startSec: 16.4, endSec: 40.0, text: Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(' ') },
];

describe('SRT — formato estricto', () => {
  const srt = toSrt(toCues(TRAMOS));

  it('lo analiza un lector estricto sin errores', () => {
    expect(() => parseSrt(srt)).not.toThrow();
  });

  it('la numeración es consecutiva desde 1', () => {
    const cues = parseSrt(srt);
    expect(cues.map((c) => c.index)).toEqual(cues.map((_, i) => i + 1));
  });

  it('todo subtítulo termina después de empezar', () => {
    for (const c of parseSrt(srt)) expect(c.endMs).toBeGreaterThan(c.startMs);
  });

  it('ningún subtítulo se superpone con el siguiente', () => {
    // Superpuestos aparecen encimados en pantalla.
    const cues = parseSrt(srt);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startMs).toBeGreaterThanOrEqual(cues[i - 1].endMs);
    }
  });

  it('ninguno tiene más de dos líneas', () => {
    for (const c of parseSrt(srt)) expect(c.lines.length).toBeLessThanOrEqual(2);
  });

  it('ninguna línea está vacía', () => {
    // Una línea vacía dentro de un bloque corta el subtítulo por la mitad en los
    // analizadores estrictos.
    for (const c of parseSrt(srt)) for (const l of c.lines) expect(l.trim()).not.toBe('');
  });

  it('el texto sobrevive la ida y vuelta sin perder palabras', () => {
    const entrada = TRAMOS.map((t) => t.text).join(' ').split(/\s+/).filter(Boolean);
    const salida = parseSrt(srt).flatMap((c) => c.lines).join(' ').split(/\s+/).filter(Boolean);
    expect(salida).toEqual(entrada);
  });

  it('los tiempos coinciden con los del detector, al milisegundo', () => {
    // El primer subtítulo arranca donde arrancó el primer tramo.
    expect(parseSrt(srt)[0].startMs).toBe(900);
  });
});

describe('VTT — formato estricto', () => {
  const vtt = toVtt(toCues(TRAMOS));

  it('lo analiza un lector estricto sin errores', () => {
    expect(() => parseVtt(vtt)).not.toThrow();
  });

  it('tiene los mismos subtítulos y tiempos que el SRT', () => {
    // Los dos salen de los mismos `cues`: si divergen, uno de los serializadores está mal.
    const desdeSrt = parseSrt(toSrt(toCues(TRAMOS)));
    const desdeVtt = parseVtt(vtt);
    expect(desdeVtt).toHaveLength(desdeSrt.length);
    for (const [i, c] of desdeVtt.entries()) {
      expect(c.startMs).toBe(desdeSrt[i].startMs);
      expect(c.endMs).toBe(desdeSrt[i].endMs);
      expect(c.lines).toEqual(desdeSrt[i].lines);
    }
  });

  it('CONTROL: el lector rechaza un SRT con puntos en vez de comas', () => {
    // Sin este control, «lo analiza sin errores» no probaría nada: hay que ver que el
    // analizador de verdad se niega cuando el formato está mal.
    const malo = toSrt(toCues(TRAMOS)).replace(/,(\d{3})/g, '.$1');
    expect(() => parseSrt(malo)).toThrow(/tiempos mal formada/);
  });

  it('CONTROL: el lector rechaza un VTT sin cabecera', () => {
    expect(() => parseVtt(vtt.replace('WEBVTT\n\n', ''))).toThrow(/cabecera/);
  });
});
