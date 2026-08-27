import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { SessionStore, MAX_SESSIONS, type StoredSegment } from './session';
import type { TimedText } from '../vad/align';

/**
 * Pruebas de la persistencia.
 *
 * La afirmación que hay que sostener es «editar un tramo, cerrar la pestaña y volver
 * conserva el cambio». Cerrar la pestaña no se puede simular con la misma conexión abierta:
 * lo que se hace acá es **cerrar la base y abrirla de nuevo** contra la misma
 * implementación, que es lo que hace el navegador al recargar. Si el dato sólo viviera en
 * memoria, esa segunda apertura lo mostraría vacío.
 *
 * `fake-indexeddb` implementa la especificación de IndexedDB en memoria: transacciones,
 * claves compuestas y orden incluidos. No prueba la cuota real del navegador ni que el
 * disco sobreviva a un cierre forzado — eso queda para la verificación en Chrome.
 */

function tramos(...textos: string[]): TimedText[] {
  return textos.map((text, i) => ({ startSec: i * 2, endSec: i * 2 + 1.5, text }));
}

const META = {
  id: 'ses-1',
  fileName: 'reunion.mp3',
  durationSec: 120,
  createdAt: 1_000,
  speechSec: 90,
  inferMs: 45_000,
  suspicious: false,
};

/** Espía sobre las escrituras: registra en qué almacén cae cada `put`. */
function spyPuts(): { names: string[]; restore: () => void } {
  const proto = (globalThis as unknown as { IDBObjectStore: typeof IDBObjectStore })
    .IDBObjectStore.prototype;
  const original = proto.put;
  const names: string[] = [];
  proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    names.push(this.name);
    return original.apply(this, args);
  };
  return { names, restore: () => { proto.put = original; } };
}

let factory: IDBFactory;

beforeEach(() => {
  // Base nueva por prueba: sin esto, una prueba vería las sesiones de la anterior y el
  // recorte por tope pasaría o fallaría según el orden en que corran.
  factory = new IDBFactory();
});

describe('SessionStore — ida y vuelta', () => {
  it('conserva tramos y audio después de cerrar y volver a abrir', async () => {
    const a = await SessionStore.open(factory);
    await a.save(META, tramos('hola', 'qué tal'), new Blob(['audio-falso'], { type: 'audio/mp3' }));
    a.close();

    const b = await SessionStore.open(factory);
    const cargado = await b.load('ses-1');
    expect(cargado).not.toBeNull();
    expect(cargado!.segments.map((s) => s.text)).toEqual(['hola', 'qué tal']);
    expect(cargado!.session.audioStored).toBe(true);
    expect(await cargado!.audio!.text()).toBe('audio-falso');
    b.close();
  });

  it('conserva una corrección después de cerrar y volver a abrir', async () => {
    const a = await SessionStore.open(factory);
    await a.save(META, tramos('hola', 'qué tal'), null);
    await a.updateSegment('ses-1', 1, 'cómo va');
    a.close();

    const b = await SessionStore.open(factory);
    const { segments } = (await b.load('ses-1'))!;
    expect(segments.map((s) => s.text)).toEqual(['hola', 'cómo va']);
    expect(segments[1].edited).toBe(true);
    // El tramo no tocado no se marca: `edited` distingue lo corregido de lo automático.
    expect(segments[0].edited).toBe(false);
    b.close();
  });

  it('el hablante sobrevive a cerrar y volver a abrir', async () => {
    const a = await SessionStore.open(factory);
    await a.save(
      META,
      [
        { startSec: 0, endSec: 2, text: 'hola', speaker: 'Martín' },
        { startSec: 2, endSec: 4, text: 'qué tal', speaker: 'Ana' },
      ],
      null,
    );
    a.close();

    const b = await SessionStore.open(factory);
    const { segments } = (await b.load('ses-1'))!;
    expect(segments.map((s) => s.speaker)).toEqual(['Martín', 'Ana']);
    b.close();
  });

  it('renombrar persiste, y corregir el texto no borra el hablante', async () => {
    // Son dos operaciones distintas sobre el mismo registro. Si corregir el texto pasara
    // `undefined` como hablante y eso borrara el nombre, el usuario perdería el renombrado
    // al arreglar una coma — y no habría error que lo delatara.
    const s = await SessionStore.open(factory);
    await s.save(META, [{ startSec: 0, endSec: 2, text: 'hola', speaker: 'Hablante 1' }], null);

    await s.updateSegment('ses-1', 0, 'hola', 'Martín');
    expect((await s.load('ses-1'))!.segments[0].speaker).toBe('Martín');

    await s.updateSegment('ses-1', 0, 'hola corregido');
    const tras = (await s.load('ses-1'))!.segments[0];
    expect(tras.text).toBe('hola corregido');
    expect(tras.speaker, 'corregir el texto no puede borrar el hablante').toBe('Martín');
    s.close();
  });

  it('devuelve null para una sesión que no existe', async () => {
    const s = await SessionStore.open(factory);
    expect(await s.load('no-existe')).toBeNull();
    s.close();
  });

  it('mantiene el orden con más de nueve tramos', async () => {
    // Con índices numéricos el orden es 9 < 10. Si alguien los pasara a texto, sería
    // "10" < "9" y los subtítulos saldrían barajados: el audio y el texto dejarían de
    // corresponderse sin que nada falle de forma visible.
    const s = await SessionStore.open(factory);
    const doce = tramos(...Array.from({ length: 12 }, (_, i) => `t${i}`));
    await s.save(META, doce, null);
    const { segments } = (await s.load('ses-1'))!;
    expect(segments.map((x) => x.text)).toEqual(doce.map((x) => x.text));
    s.close();
  });
});

describe('SessionStore — la edición es incremental', () => {
  let spy: ReturnType<typeof spyPuts>;
  afterEach(() => spy?.restore());

  it('una corrección escribe un solo registro y nunca el audio', async () => {
    const s = await SessionStore.open(factory);
    const audio = new Blob(['x'.repeat(1024)], { type: 'audio/wav' });

    spy = spyPuts();
    await s.save(META, tramos('uno', 'dos', 'tres'), audio);

    // CONTROL: el espía sí ve escrituras de audio cuando las hay. Sin esto, que no
    // aparezca "audio" en la edición no probaría nada — podría ser un espía roto.
    expect(spy.names).toContain('audio');
    expect(spy.names.filter((n) => n === 'segments')).toHaveLength(3);

    spy.names.length = 0;
    await s.updateSegment('ses-1', 1, 'DOS corregido');

    expect(spy.names).toEqual(['segments']);
    expect(spy.names).not.toContain('audio');
    expect(spy.names).not.toContain('sessions');

    // Y lo que no se tocó sigue igual, incluido el audio.
    const { segments, audio: guardado } = (await s.load('ses-1'))!;
    expect(segments.map((x) => x.text)).toEqual(['uno', 'DOS corregido', 'tres']);
    expect(guardado!.size).toBe(1024);
    s.close();
  });

  it('corregir un tramo inexistente falla sin dejar basura', async () => {
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), null);
    await expect(s.updateSegment('ses-1', 7, 'fantasma')).rejects.toThrow(/tramo 7/);
    const { segments } = (await s.load('ses-1'))!;
    expect(segments).toHaveLength(1);
    s.close();
  });
});

describe('SessionStore — tope de sesiones', () => {
  it('conserva las más nuevas y borra por completo las viejas', async () => {
    const s = await SessionStore.open(factory);
    const total = MAX_SESSIONS + 2;
    for (let i = 0; i < total; i++) {
      await s.save(
        { ...META, id: `ses-${i}`, createdAt: 1_000 + i },
        tramos(`texto ${i}`),
        new Blob([`audio ${i}`]),
      );
    }

    const quedan = await s.list();
    expect(quedan).toHaveLength(MAX_SESSIONS);
    expect(quedan[0].id).toBe(`ses-${total - 1}`);
    expect(quedan.map((x) => x.id)).not.toContain('ses-0');

    // Borrar la fila de la sesión no alcanza: si los tramos y el audio quedaran, el tope
    // no liberaría nada y la cuota se llenaría igual, que es justo lo que evita.
    expect(await s.load('ses-0')).toBeNull();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open('opensrt');
      req.onsuccess = () => resolve(req.result);
    });
    const huerfanos = await new Promise<StoredSegment[]>((resolve) => {
      const req = db
        .transaction('segments', 'readonly')
        .objectStore('segments')
        .getAll(IDBKeyRange.bound(['ses-0', -Infinity], ['ses-0', Infinity]));
      req.onsuccess = () => resolve(req.result as StoredSegment[]);
    });
    expect(huerfanos).toHaveLength(0);
    const audioHuerfano = await new Promise<unknown>((resolve) => {
      const req = db.transaction('audio', 'readonly').objectStore('audio').get('ses-0');
      req.onsuccess = () => resolve(req.result);
    });
    expect(audioHuerfano).toBeUndefined();
    db.close();
    s.close();
  });
});

describe('SessionStore — cuando el audio no entra', () => {
  it('guarda igual la transcripción y lo declara', async () => {
    const s = await SessionStore.open(factory);

    // Simula el fallo de cuota: sólo revienta el almacén de audio, que es el caso real
    // (el texto pesa kilobytes, el audio megabytes).
    const proto = (globalThis as unknown as { IDBObjectStore: typeof IDBObjectStore })
      .IDBObjectStore.prototype;
    const original = proto.put;
    proto.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'audio') throw new DOMException('lleno', 'QuotaExceededError');
      return original.apply(this, args);
    };

    try {
      const guardada = await s.save(META, tramos('sobrevive', 'esto'), new Blob(['grande']));
      expect(guardada.audioStored).toBe(false);
    } finally {
      proto.put = original;
    }

    const cargado = (await s.load('ses-1'))!;
    expect(cargado.segments.map((x) => x.text)).toEqual(['sobrevive', 'esto']);
    expect(cargado.audio).toBeNull();
    s.close();
  });
});

describe('SessionStore — borrado', () => {
  it('clear deja la base vacía', async () => {
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('algo'), new Blob(['audio']));
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(await s.load('ses-1')).toBeNull();
    s.close();
  });
});
