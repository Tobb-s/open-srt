import { describe, expect, it } from 'vitest';
import {
  sesionDeCorrida,
  sesionDeGuardada,
  avisoDeGuardado,
  valeGuardar,
  esVideo,
} from './armar';
import type { LoadedSession } from '../store/session';
import type { TimedText } from '../vad/align';

/**
 * El armado de la sesión, que hasta el paso 2 estaba escrito tres veces en el componente
 * y no lo probaba nadie.
 *
 * Lo que estos tests cuidan es lo que **no fallaría**: un campo que se pierde al restaurar,
 * un hablante que vuelve a llamarse «0», un aviso que dice «el audio no entró» cuando en
 * realidad no se guardó nada. Todo eso deja la pantalla funcionando y mintiendo.
 */

const NOMBRE = (n: number) => `Hablante ${n}`;

const TRAMOS: TimedText[] = [
  { startSec: 0, endSec: 2, text: 'Hola', speaker: '0' },
  { startSec: 2, endSec: 4, text: 'Qué tal', speaker: '1' },
  { startSec: 4, endSec: 6, text: 'Bien' },
];

function guardada(over: Partial<LoadedSession['session']> = {}, audio: Blob | null = null): LoadedSession {
  return {
    session: {
      id: 's1',
      fileName: 'reunion.mp4',
      durationSec: 120,
      createdAt: 1,
      speechSec: 90,
      inferMs: 4000,
      suspicious: false,
      segmentCount: 2,
      audioStored: true,
      ...over,
    },
    segments: [
      { sessionId: 's1', index: 0, startSec: 0, endSec: 2, text: 'Hola', speaker: 'Ana', edited: false },
      { sessionId: 's1', index: 1, startSec: 2, endSec: 4, text: 'Corregido', edited: true },
    ],
    audio,
  };
}

describe('esVideo', () => {
  it('mira el tipo declarado, no la extensión', () => {
    // La extensión miente: un mp4 renombrado sigue trayendo su pista de imagen.
    expect(esVideo(new Blob([], { type: 'video/mp4' }))).toBe(true);
    expect(esVideo(new Blob([], { type: 'audio/wav' }))).toBe(false);
  });

  it('sin blob no hay video', () => {
    // Una sesión cuyo audio no entró en la cuota: no hay imagen que mostrar de algo que
    // no está. Poner `video` acá pondría un reproductor negro y vacío.
    expect(esVideo(null)).toBe(false);
    expect(esVideo(undefined)).toBe(false);
  });

  it('un tipo vacío no es video', () => {
    expect(esVideo(new Blob([]))).toBe(false);
  });
});

describe('sesionDeCorrida', () => {
  const base = {
    id: 'nueva',
    fileName: 'audio.wav',
    suspicious: true,
    inferMs: 1234,
    blob: new Blob([], { type: 'audio/wav' }),
    audioUrl: 'blob:x',
    nombreHablante: NOMBRE,
  };

  it('numera los hablantes desde 1, con el nombre del idioma en pantalla', () => {
    // El modelo devuelve '0','1','2'. Mostrar «Hablante 0» sería exponer el índice del
    // modelo; numerar desde 1 es cosa de la interfaz.
    const s = sesionDeCorrida({ ...base, segments: TRAMOS });
    expect(s.segments.map((x) => x.speaker)).toEqual(['Hablante 1', 'Hablante 2', undefined]);
  });

  it('no toca un hablante que ya tiene nombre propio', () => {
    const s = sesionDeCorrida({
      ...base,
      segments: [{ startSec: 0, endSec: 1, text: 'x', speaker: 'Martín' }],
    });
    expect(s.segments[0].speaker).toBe('Martín');
  });

  it('conserva los tiempos y el texto de cada tramo', () => {
    // Si los tiempos se movieran, el texto no correspondería con el audio y nadie lo
    // notaría hasta reproducirlo.
    const s = sesionDeCorrida({ ...base, segments: TRAMOS });
    expect(s.segments.map((x) => [x.startSec, x.endSec, x.text])).toEqual(
      TRAMOS.map((x) => [x.startSec, x.endSec, x.text]),
    );
  });

  it('no modifica el arreglo de entrada', () => {
    const copia = JSON.parse(JSON.stringify(TRAMOS));
    sesionDeCorrida({ ...base, segments: TRAMOS });
    expect(TRAMOS).toEqual(copia);
  });

  it('recién transcripto, nada viene corregido a mano', () => {
    const s = sesionDeCorrida({ ...base, segments: TRAMOS });
    expect(s.editedInitially.size).toBe(0);
  });

  it('un video se reconoce como video', () => {
    const s = sesionDeCorrida({
      ...base,
      segments: TRAMOS,
      blob: new Blob([], { type: 'video/mp4' }),
    });
    expect(s.mediaKind).toBe('video');
  });

  it('lleva el aviso de omisión y el tiempo de inferencia', () => {
    // `suspicious` es lo que dispara el aviso de que el modelo pudo saltarse contenido:
    // perderlo acá apagaría el aviso sin que nada más cambie.
    const s = sesionDeCorrida({ ...base, segments: TRAMOS });
    expect(s.suspicious).toBe(true);
    expect(s.inferMs).toBe(1234);
  });
});

describe('sesionDeGuardada', () => {
  it('no arrastra los campos internos de la base a los tramos', () => {
    // `sessionId`, `index` y `edited` son de la base, no del editor. Copiarlos con `...x`
    // los metería en el CSV y el JSON que el usuario descarga.
    const s = sesionDeGuardada(guardada(), null);
    expect(Object.keys(s.segments[0]).sort()).toEqual(['endSec', 'speaker', 'startSec', 'text']);
  });

  it('recuerda qué tramos venían corregidos a mano', () => {
    // Es lo que pinta la marca «editado». Perderlo hace que una corrección parezca
    // salida del modelo.
    const s = sesionDeGuardada(guardada(), null);
    expect([...s.editedInitially]).toEqual([1]);
  });

  it('conserva el nombre del hablante tal como quedó guardado', () => {
    // Se guarda el nombre que ve el usuario, no la etiqueta del modelo: si renombré a
    // «Ana», al volver tiene que decir «Ana».
    const s = sesionDeGuardada(guardada(), null);
    expect(s.segments[0].speaker).toBe('Ana');
  });

  it('una sesión recuperada sigue sabiendo que era un video', () => {
    // El tipo viaja con el Blob dentro de IndexedDB.
    const s = sesionDeGuardada(guardada({}, new Blob([], { type: 'video/mp4' })), 'blob:x');
    expect(s.mediaKind).toBe('video');
  });

  it('sin audio guardado no promete video', () => {
    const s = sesionDeGuardada(guardada({ audioStored: false }, null), null);
    expect(s.mediaKind).toBe('audio');
    expect(s.audioUrl).toBeNull();
  });

  it('el aviso de omisión sobrevive al recargar', () => {
    const s = sesionDeGuardada(guardada({ suspicious: true }), null);
    expect(s.suspicious).toBe(true);
  });

  it('trae el id y el nombre de archivo de la sesión guardada', () => {
    // El id es con el que se escriben las correcciones: equivocarlo escribiría las
    // ediciones sobre OTRA transcripción.
    const s = sesionDeGuardada(guardada(), null);
    expect([s.id, s.fileName]).toEqual(['s1', 'reunion.mp4']);
  });
});

describe('avisoDeGuardado', () => {
  const textos = { conAudio: 'quedó con audio', sinAudio: 'el audio no entró' };

  it('distingue los TRES estados', () => {
    // Decir «el audio no entró» cuando no se guardó nada sería mentir sobre lo que pasó.
    expect(avisoDeGuardado({ audioStored: true }, textos)).toBe('quedó con audio');
    expect(avisoDeGuardado({ audioStored: false }, textos)).toBe('el audio no entró');
    expect(avisoDeGuardado(undefined, textos)).toBeNull();
    expect(avisoDeGuardado(null, textos)).toBeNull();
  });
});

describe('valeGuardar', () => {
  it('una transcripción sin una sola palabra no se guarda', () => {
    // Si se guardara, la próxima visita ofrecería recuperar una pantalla vacía.
    expect(valeGuardar([{ startSec: 0, endSec: 1, text: '   ' }])).toBe(false);
    expect(valeGuardar([])).toBe(false);
  });

  it('con una sola palabra ya vale', () => {
    expect(valeGuardar([{ startSec: 0, endSec: 1, text: '  ' }, { startSec: 1, endSec: 2, text: 'sí' }])).toBe(true);
  });
});
