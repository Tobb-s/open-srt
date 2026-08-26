import { describe, it, expect } from 'vitest';
import {
  toSegments, toBlocks, totalSpeechSec, DEFAULT_OPTIONS, WINDOW_MS, MAX_BLOCK_SEC,
  type Segment,
} from './segments';

/**
 * La lógica de segmentación, probada sin cargar el modelo.
 *
 * Se construyen series de probabilidades a mano porque así se sabe **exactamente** dónde
 * está el habla y dónde el silencio. Con audio real habría que confiar en el detector para
 * juzgar al propio código que interpreta al detector.
 */

/** Construye una serie de probabilidades a partir de tramos declarados en milisegundos. */
function serie(tramos: Array<{ ms: number; habla: boolean }>): number[] {
  const out: number[] = [];
  for (const t of tramos) {
    const n = Math.round(t.ms / WINDOW_MS);
    for (let i = 0; i < n; i++) out.push(t.habla ? 0.95 : 0.02);
  }
  return out;
}
const dur = (probs: number[]) => (probs.length * WINDOW_MS) / 1000;

describe('toSegments — detección básica', () => {
  it('encuentra un tramo de habla entre silencios', () => {
    const p = serie([
      { ms: 1000, habla: false },
      { ms: 2000, habla: true },
      { ms: 1000, habla: false },
    ]);
    const segs = toSegments(p, dur(p));
    expect(segs).toHaveLength(1);
    // Con 100 ms de aire a cada lado.
    expect(segs[0].startSec).toBeCloseTo(0.9, 1);
    expect(segs[0].endSec).toBeCloseTo(3.1, 1);
  });

  it('audio sin habla no produce segmentos', () => {
    const p = serie([{ ms: 5000, habla: false }]);
    expect(toSegments(p, dur(p))).toHaveLength(0);
  });

  it('cierra el último segmento si el audio termina hablando', () => {
    // Sin este caso, el habla del final se perdería entera.
    const p = serie([{ ms: 500, habla: false }, { ms: 2000, habla: true }]);
    const segs = toSegments(p, dur(p));
    expect(segs).toHaveLength(1);
    expect(segs[0].endSec).toBeCloseTo(dur(p), 1);
  });
});

describe('toSegments — las decisiones que evitan subtítulos picados', () => {
  it('NO corta en las pausas cortas dentro de una frase', () => {
    // 120 ms es una pausa normal entre palabras. Cortar ahí daría dos subtítulos donde
    // hay una sola frase.
    const p = serie([
      { ms: 1000, habla: true },
      { ms: 120, habla: false },
      { ms: 1000, habla: true },
    ]);
    expect(toSegments(p, dur(p))).toHaveLength(1);
  });

  it('SÍ corta cuando el silencio es largo', () => {
    const p = serie([
      { ms: 1000, habla: true },
      { ms: 600, habla: false },
      { ms: 1000, habla: true },
    ]);
    expect(toSegments(p, dur(p))).toHaveLength(2);
  });

  it('descarta los chasquidos demasiado breves para ser habla', () => {
    const p = serie([
      { ms: 500, habla: false },
      { ms: 100, habla: true }, // por debajo de minSpeechMs
      { ms: 500, habla: false },
    ]);
    expect(toSegments(p, dur(p))).toHaveLength(0);
  });

  it('fusiona ANTES de descartar, no al revés', () => {
    // Tres tramos de 150 ms separados por pausas de 100 ms: cada uno por separado es
    // demasiado corto, pero juntos son habla de sobra. Descartando primero, se perderían
    // los tres.
    const p = serie([
      { ms: 300, habla: false },
      { ms: 150, habla: true }, { ms: 100, habla: false },
      { ms: 150, habla: true }, { ms: 100, habla: false },
      { ms: 150, habla: true },
      { ms: 300, habla: false },
    ]);
    expect(toSegments(p, dur(p))).toHaveLength(1);
  });

  it('el aire no hace que dos segmentos se pisen', () => {
    // Con 100 ms de padding a cada lado y 250 ms de silencio, los bordes se tocarían.
    const p = serie([
      { ms: 1000, habla: true },
      { ms: 250, habla: false },
      { ms: 1000, habla: true },
    ]);
    const segs = toSegments(p, dur(p));
    expect(segs).toHaveLength(2);
    expect(segs[0].endSec).toBeLessThanOrEqual(segs[1].startSec);
  });

  it('el aire nunca se sale del archivo', () => {
    // Un tiempo negativo o posterior al final produciría subtítulos inválidos.
    const p = serie([{ ms: 2000, habla: true }]);
    const segs = toSegments(p, dur(p));
    expect(segs[0].startSec).toBeGreaterThanOrEqual(0);
    expect(segs[0].endSec).toBeLessThanOrEqual(dur(p));
  });

  it('un umbral más alto detecta menos habla', () => {
    const p = [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6];
    expect(toSegments(p, dur(p), { ...DEFAULT_OPTIONS, threshold: 0.5 }).length).toBe(1);
    expect(toSegments(p, dur(p), { ...DEFAULT_OPTIONS, threshold: 0.8 }).length).toBe(0);
  });
});

describe('toBlocks — cortar SIEMPRE en silencio', () => {
  const seg = (a: number, b: number): Segment => ({ startSec: a, endSec: b });

  it('junta segmentos cortos en un bloque', () => {
    const bloques = toBlocks([seg(0, 3), seg(4, 7), seg(8, 11)]);
    expect(bloques).toHaveLength(1);
    expect(bloques[0].segments).toHaveLength(3);
  });

  it('abre un bloque nuevo antes de pasarse del máximo', () => {
    const bloques = toBlocks([seg(0, 10), seg(11, 20), seg(21, 30)]);
    expect(bloques.length).toBeGreaterThan(1);
    for (const b of bloques) {
      // Cada bloque cabe en la ventana de Whisper.
      if (b.segments.length > 1) expect(b.endSec - b.startSec).toBeLessThanOrEqual(MAX_BLOCK_SEC);
    }
  });

  it('los cortes caen SIEMPRE entre segmentos, nunca dentro de uno', () => {
    // Es el punto de todo esto: fragmentar cada 30 s a ciegas parte una palabra al medio.
    const segs = [seg(0, 9), seg(10, 19), seg(20, 29), seg(30, 39)];
    const bloques = toBlocks(segs);
    for (const b of bloques) {
      expect(segs.some((s) => s.startSec === b.startSec)).toBe(true);
      expect(segs.some((s) => s.endSec === b.endSec)).toBe(true);
    }
  });

  it('un segmento más largo que el máximo va solo y se acepta que exceda', () => {
    // Alguien que habla 40 s sin pausa: partirlo sin silencio sería peor que un bloque largo.
    const bloques = toBlocks([seg(0, 40), seg(41, 45)]);
    expect(bloques[0].segments).toHaveLength(1);
    expect(bloques[0].endSec - bloques[0].startSec).toBeGreaterThan(MAX_BLOCK_SEC);
    expect(bloques).toHaveLength(2);
  });

  it('no pierde ningún segmento', () => {
    // El control de fondo: todo lo que entra tiene que salir en algún bloque.
    const segs = Array.from({ length: 25 }, (_, i) => seg(i * 4, i * 4 + 3));
    const bloques = toBlocks(segs);
    const total = bloques.reduce((a, b) => a + b.segments.length, 0);
    expect(total).toBe(segs.length);
  });

  it('sin segmentos no hay bloques', () => {
    expect(toBlocks([])).toHaveLength(0);
  });

  it('speechSec cuenta habla, no duración del bloque', () => {
    // La diferencia importa: el bloque incluye los silencios entre segmentos.
    const b = toBlocks([seg(0, 3), seg(10, 13)])[0];
    expect(b.endSec - b.startSec).toBeCloseTo(13);
    expect(b.speechSec).toBeCloseTo(6);
  });
});

describe('totalSpeechSec', () => {
  it('suma sólo el habla', () => {
    expect(totalSpeechSec([{ startSec: 0, endSec: 3 }, { startSec: 10, endSec: 12 }])).toBe(5);
  });

  it('sin habla da cero', () => {
    expect(totalSpeechSec([])).toBe(0);
  });
});
