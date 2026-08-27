import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { SessionStore, MAX_RUNS, fileKeyOf, type StoredRun } from './session';
import { transcribeBlocks, type ModelCall } from '../asr/transcriber';
import type { Block } from '../vad/segments';

/**
 * Retomar una transcripción interrumpida.
 *
 * ── Qué se está evitando ──
 *
 * Hasta acá sólo se guardaba el resultado **terminado**. En un archivo de dos horas eso
 * significa que cerrar la pestaña sin querer a los cien minutos tira todo: hora y media del
 * equipo de alguien, perdida por un clic.
 *
 * ── Lo que hay que probar de verdad ──
 *
 * No alcanza con «reanudó». Lo que importa es que el resultado de **reanudar sea el mismo**
 * que el de haber corrido de una sola vez. Si al retomar se perdiera un bloque, se repitiera
 * uno, o los tiempos quedaran corridos, nada fallaría: saldría una transcripción con un
 * agujero, que es exactamente el modo de fallo que este proyecto viene persiguiendo desde E1.
 *
 * Por eso el test central compara las dos corridas tramo por tramo, y hay un control que
 * demuestra que esa comparación **sabe ver** una diferencia.
 */

const RATE = 16000;

/** Bloques de juguete, con la forma que da el detector. */
function bloques(n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    startSec: i * 10,
    endSec: i * 10 + 8,
    segments: [{ startSec: i * 10, endSec: i * 10 + 8 }],
    speechSec: 8,
  }));
}

/** Modelo falso: devuelve un texto distinto por bloque, deducible de su posición. */
function modeloFalso(): { call: ModelCall; llamadas: number[] } {
  const llamadas: number[] = [];
  const call: ModelCall = async (audio) => {
    // El primer valor del trozo dice de qué bloque vino: así se puede afirmar **qué** bloques
    // se pidieron, no sólo cuántos.
    const marca = Math.round(audio[0] ?? -1);
    llamadas.push(marca);
    return { text: `texto del bloque ${marca}` };
  };
  return { call, llamadas };
}

/** Audio donde cada bloque lleva su número, para poder rastrearlo. */
function audioMarcado(n: number): Float32Array {
  const a = new Float32Array(n * 10 * RATE);
  for (let i = 0; i < n; i++) a.fill(i, i * 10 * RATE, (i * 10 + 8) * RATE);
  return a;
}

const N = 6;

describe('transcribeBlocks retomando', () => {
  it('reanudar da exactamente lo mismo que correr de una sola vez', async () => {
    const audio = audioMarcado(N);
    const bs = bloques(N);

    const entera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs },
      modeloFalso().call,
    );

    // Ahora en dos tandas, como si la pestaña se hubiera cerrado después del bloque 3.
    const primera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs.slice(0, 3) },
      modeloFalso().call,
    );
    const { call, llamadas } = modeloFalso();
    const segunda = await transcribeBlocks(
      {
        audio,
        durationSec: N * 10,
        blocks: bs,
        resumeFrom: { doneBlocks: 3, segments: primera.segments, speechSec: 3 * 8 },
      },
      call,
    );

    // 1. El texto y los tramos coinciden, uno a uno.
    expect(segunda.segments).toEqual(entera.segments);
    expect(segunda.text).toBe(entera.text);

    // 2. Y no se volvió a pedir lo que ya estaba: sólo los bloques 3, 4 y 5.
    expect(llamadas).toEqual([3, 4, 5]);
  });

  it('la cobertura sigue siendo válida al reanudar', async () => {
    // `checkCoverage` divide palabras por segundos de habla. Si al retomar el habla ya
    // contabilizada se perdiera, el cociente se dispararía y saldría un aviso de omisión
    // falso — o al revés, se taparía uno verdadero.
    const audio = audioMarcado(N);
    const bs = bloques(N);
    const entera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs },
      modeloFalso().call,
    );
    const primera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs.slice(0, 3) },
      modeloFalso().call,
    );
    const segunda = await transcribeBlocks(
      {
        audio,
        durationSec: N * 10,
        blocks: bs,
        resumeFrom: { doneBlocks: 3, segments: primera.segments, speechSec: 3 * 8 },
      },
      modeloFalso().call,
    );
    expect(segunda.coverage.wordsPerSpeechSec).toBeCloseTo(entera.coverage.wordsPerSpeechSec, 6);
    expect(segunda.coverage.suspicious).toBe(entera.coverage.suspicious);
  });

  it('CONTROL: la comparación sabe ver un bloque perdido', async () => {
    // Sin esto, «reanudar da lo mismo» no distinguiría una reanudación correcta de una
    // comparación que aprueba cualquier cosa.
    const audio = audioMarcado(N);
    const bs = bloques(N);
    const entera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs },
      modeloFalso().call,
    );
    // Se retoma diciendo que hay un bloque más hecho del que hay: el bloque 3 se pierde.
    const primera = await transcribeBlocks(
      { audio, durationSec: N * 10, blocks: bs.slice(0, 3) },
      modeloFalso().call,
    );
    const rota = await transcribeBlocks(
      {
        audio,
        durationSec: N * 10,
        blocks: bs,
        resumeFrom: { doneBlocks: 4, segments: primera.segments, speechSec: 3 * 8 },
      },
      modeloFalso().call,
    );
    expect(rota.segments).not.toEqual(entera.segments);
    expect(rota.segments.length).toBeLessThan(entera.segments.length);
  });

  it('avisa de cada bloque terminado, en orden, con lo que ese bloque produjo', async () => {
    const audio = audioMarcado(N);
    const avisos: Array<{ index: number; textos: string[] }> = [];
    await transcribeBlocks(
      {
        audio,
        durationSec: N * 10,
        blocks: bloques(N),
        onBlockDone: (p) => {
          avisos.push({ index: p.index, textos: p.segments.map((s) => s.text) });
        },
      },
      modeloFalso().call,
    );
    expect(avisos.map((a) => a.index)).toEqual([0, 1, 2, 3, 4, 5]);
    // Cada aviso trae **lo suyo**, no el acumulado: mandar la lista entera en cada bloque
    // serían megabytes de mensajes en un archivo largo.
    for (const a of avisos) expect(a.textos).toHaveLength(1);
    expect(avisos[2].textos[0]).toBe('texto del bloque 2');
  });

  it('el aviso se espera antes de decir que el bloque avanzó', async () => {
    // Si el progreso se anunciara antes de guardar, una falla al guardar dejaría la barra
    // diciendo que ese bloque está listo cuando no quedó registrado en ningún lado.
    const orden: string[] = [];
    await transcribeBlocks(
      {
        audio: audioMarcado(2),
        durationSec: 20,
        blocks: bloques(2),
        onBlockDone: async () => {
          await new Promise((r) => setTimeout(r, 5));
          orden.push('guardado');
        },
        onProgress: () => orden.push('progreso'),
      },
      modeloFalso().call,
    );
    expect(orden).toEqual(['guardado', 'progreso', 'guardado', 'progreso']);
  });
});

describe('el almacén de corridas', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  const corrida = (fileKey: string, doneBlocks = 2): StoredRun => ({
    fileKey,
    fileName: 'reunion.mp4',
    durationSec: 7200,
    updatedAt: 1000,
    blocks: bloques(5).map((b) => ({
      startSec: b.startSec,
      endSec: b.endSec,
      segments: [...b.segments],
      speechSec: b.speechSec,
    })),
    doneBlocks,
    segments: [{ startSec: 0, endSec: 8, text: 'lo que iba' }],
    speechSec: 16,
  });

  it('guarda y recupera el avance', async () => {
    const s = await SessionStore.open(factory);
    await s.saveRun(corrida('a|1|2'));
    s.close();

    // Cerrar y volver a abrir, que es lo que hace el navegador al recargar.
    const b = await SessionStore.open(factory);
    const r = await b.loadRun('a|1|2');
    expect(r?.doneBlocks).toBe(2);
    expect(r?.blocks).toHaveLength(5);
    expect(r?.segments[0].text).toBe('lo que iba');
    b.close();
  });

  it('guarda los bloques, que son lo que hace posible retomar', async () => {
    // Recalcularlos con el detector daría otros bordes si cambiara un umbral o una versión,
    // y los tramos ya hechos no encajarían con los nuevos. Sin fallar nada.
    const s = await SessionStore.open(factory);
    await s.saveRun(corrida('a|1|2'));
    const r = await s.loadRun('a|1|2');
    expect(r!.blocks.map((b) => b.startSec)).toEqual([0, 10, 20, 30, 40]);
    s.close();
  });

  it('pisa la corrida anterior del mismo archivo en vez de acumular', async () => {
    const s = await SessionStore.open(factory);
    await s.saveRun(corrida('a|1|2', 2));
    await s.saveRun({ ...corrida('a|1|2', 4), updatedAt: 2000 });
    expect(await s.listRuns()).toHaveLength(1);
    expect((await s.loadRun('a|1|2'))!.doneBlocks).toBe(4);
    s.close();
  });

  it('conserva sólo las más recientes', async () => {
    const s = await SessionStore.open(factory);
    for (let i = 0; i < MAX_RUNS + 2; i++) {
      await s.saveRun({ ...corrida(`archivo-${i}`), updatedAt: 1000 + i });
    }
    const quedan = await s.listRuns();
    expect(quedan).toHaveLength(MAX_RUNS);
    expect(quedan.map((r) => r.fileKey)).not.toContain('archivo-0');
    s.close();
  });

  it('«borrar lo guardado» también borra lo que estaba a medias', async () => {
    // Una transcripción a medias es contenido del usuario igual que una terminada. Dejarla
    // ahí después de que pidió borrar todo sería incumplir lo que dice el botón.
    const s = await SessionStore.open(factory);
    await s.saveRun(corrida('a|1|2'));
    await s.clear();
    expect(await s.listRuns()).toEqual([]);
    s.close();
  });

  it('una base de la versión 1 se sigue abriendo', async () => {
    // La subida de versión es aditiva. Migrar datos en `onupgradeneeded` sería la forma más
    // rápida de perder transcripciones ajenas por un error propio.
    const v1 = await new Promise<IDBDatabase>((res, rej) => {
      const req = factory.open('opensrt', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('sessions', { keyPath: 'id' });
        db.createObjectStore('segments', { keyPath: ['sessionId', 'index'] });
        db.createObjectStore('audio');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    await new Promise<void>((res) => {
      const tx = v1.transaction('sessions', 'readwrite');
      tx.objectStore('sessions').put({ id: 'vieja', fileName: 'de antes.mp3', segmentCount: 3 });
      tx.oncomplete = () => res();
    });
    v1.close();

    const s = await SessionStore.open(factory);
    expect((await s.list()).map((x) => x.fileName)).toContain('de antes.mp3');
    // Y la tabla nueva existe y funciona.
    await s.saveRun(corrida('nuevo|1|2'));
    expect(await s.loadRun('nuevo|1|2')).not.toBeNull();
    s.close();
  });
});

describe('fileKeyOf', () => {
  it('distingue archivos por nombre, tamaño y fecha', () => {
    const base = { name: 'a.mp4', size: 100, lastModified: 5 };
    expect(fileKeyOf(base)).toBe(fileKeyOf({ ...base }));
    expect(fileKeyOf(base)).not.toBe(fileKeyOf({ ...base, size: 101 }));
    expect(fileKeyOf(base)).not.toBe(fileKeyOf({ ...base, lastModified: 6 }));
    expect(fileKeyOf(base)).not.toBe(fileKeyOf({ ...base, name: 'b.mp4' }));
  });

  it('no lee el contenido del archivo', () => {
    // Es la razón de que sea así: un hash del contenido exigiría leer dos horas de audio
    // antes de poder decir «esto ya lo empezaste», que es justo lo que se quiere evitar.
    expect(fileKeyOf({ name: 'x', size: 1, lastModified: 1 })).toBe('x|1|1');
  });
});
