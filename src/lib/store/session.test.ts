import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { SessionStore } from './session';
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

describe('SessionStore — nada del usuario se borra solo', () => {
  it('guardar muchas NO borra las viejas: ni cabecera, ni tramos, ni audio', async () => {
    // Este test decia lo CONTRARIO hasta el paso 4: afirmaba que la sexta borraba la
    // primera, y pasaba. Dado vuelta, es el guardian de que eso no vuelva.
    //
    // El tope de 5 nunca defendio de nada. Medido el 28/08/2026 en el equipo del usuario:
    // la cuota del origen es de 6,08 GB y **todas las transcripciones juntas ocupan
    // 45 KB**. Borraba con el 99,99 % de la cuota libre, y contaba sesiones donde la
    // restriccion son bytes.
    const s = await SessionStore.open(factory);
    const total = 12;
    for (let i = 0; i < total; i++) {
      await s.save(
        { ...META, id: `ses-${i}`, createdAt: 1_000 + i },
        tramos(`texto ${i}`),
        new Blob([`audio ${i}`]),
      );
    }

    expect(await s.list()).toHaveLength(total);

    // La primera, la que el tope viejo borraba primero, tiene que estar entera.
    const primera = await s.load('ses-0');
    expect(primera).not.toBeNull();
    expect(primera!.segments.map((x) => x.text)).toEqual(['texto 0']);
    expect(await primera!.audio!.text()).toBe('audio 0');
    s.close();
  });

  it('borrar sigue funcionando cuando lo pide el usuario', async () => {
    // Control del test de arriba: si `remove` tambien hubiera dejado de borrar, aquel
    // pasaria por la razon equivocada y no probaria nada.
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), new Blob(['audio']));
    await s.remove('ses-1');
    expect(await s.list()).toHaveLength(0);
    expect(await s.load('ses-1')).toBeNull();
    s.close();
  });
});

describe('SessionStore — el audio tiene presupuesto', () => {
  /** Un estimador de mentira, para poder probar el presupuesto sin navegador. */
  const conEspacio = (quota: number, usage: number) => async () => ({ quota, usage });

  it('sin lugar, guarda el TEXTO y deja el audio afuera', async () => {
    // La degradacion de tres estados que ya existia desde E2, ahora decidida antes de
    // escribir en vez de descubierta al fallar.
    const s = await SessionStore.open(factory, conEspacio(200 * 1024 * 1024, 190 * 1024 * 1024));
    const guardada = await s.save(META, tramos('uno', 'dos'), new Blob(['x'.repeat(5_000_000)]));

    expect(guardada.audioStored).toBe(false);
    expect(guardada.audioMotivo).toBe('sin-espacio');
    const cargada = await s.load('ses-1');
    // Lo que importa: el texto esta entero.
    expect(cargada!.segments.map((x) => x.text)).toEqual(['uno', 'dos']);
    expect(cargada!.audio).toBeNull();
    s.close();
  });

  it('con lugar, guarda el audio y anota cuanto pesa', async () => {
    const s = await SessionStore.open(factory, conEspacio(6 * 1024 ** 3, 100 * 1024 * 1024));
    const guardada = await s.save(META, tramos('uno'), new Blob(['x'.repeat(1000)]));
    expect(guardada.audioStored).toBe(true);
    expect(guardada.audioBytes).toBe(1000);
    expect(guardada.audioMotivo).toBeUndefined();
    s.close();
  });

  it('sin estimador disponible, NO se niega el audio', async () => {
    // Falla abierto: un instrumento ausente no puede apagar el audio para siempre. Si de
    // verdad no entra, la escritura falla y el catch degrada.
    const s = await SessionStore.open(factory, undefined);
    expect((await s.save(META, tramos('uno'), new Blob(['x']))).audioStored).toBe(true);
    s.close();
  });

  it('un estimador que revienta tampoco niega el audio', async () => {
    const s = await SessionStore.open(factory, async () => {
      throw new Error('sin permiso');
    });
    expect((await s.save(META, tramos('uno'), new Blob(['x']))).audioStored).toBe(true);
    s.close();
  });

  it('liberar el audio deja el texto intacto', async () => {
    // Es la salida cuando la cuota se acaba: devuelve megas sin perder una palabra.
    const s = await SessionStore.open(factory, conEspacio(6 * 1024 ** 3, 0));
    await s.save(META, tramos('uno', 'dos'), new Blob(['x'.repeat(9000)]));

    await s.liberarAudio('ses-1');

    const cargada = await s.load('ses-1');
    expect(cargada!.segments.map((x) => x.text)).toEqual(['uno', 'dos']);
    expect(cargada!.audio).toBeNull();
    expect(cargada!.session.audioStored).toBe(false);
    expect(cargada!.session.audioMotivo).toBe('liberado');
    expect((await s.pesos()).has('ses-1')).toBe(false);
    s.close();
  });

  it('liberar algo que no existe no rompe ni crea nada', async () => {
    const s = await SessionStore.open(factory);
    await s.liberarAudio('no-existe');
    expect(await s.list()).toHaveLength(0);
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

describe('SessionStore — la biblioteca', () => {
  it('renombrar toca la cabecera y deja el texto y el audio intactos', async () => {
    // El nombre sale del archivo, y «grabacion_003.m4a» no distingue nada en una lista de
    // veinte. Lo que NO puede pasar es que renombrar toque la transcripción.
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno', 'dos'), new Blob(['audio'], { type: 'audio/mp3' }));

    const nueva = await s.rename('ses-1', '  Reunión con el equipo  ');
    expect(nueva?.fileName).toBe('Reunión con el equipo');

    const cargada = await s.load('ses-1');
    expect(cargada!.session.fileName).toBe('Reunión con el equipo');
    expect(cargada!.segments.map((x) => x.text)).toEqual(['uno', 'dos']);
    expect(await cargada!.audio!.text()).toBe('audio');
    s.close();
  });

  it('un nombre en blanco se rechaza en vez de guardarse', async () => {
    // Una fila sin nombre es una transcripción que el usuario no puede volver a encontrar.
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), null);
    expect(await s.rename('ses-1', '   ')).toBeNull();
    expect((await s.load('ses-1'))!.session.fileName).toBe('reunion.mp3');
    s.close();
  });

  it('renombrar algo que no existe devuelve null en vez de crear una sesión fantasma', async () => {
    const s = await SessionStore.open(factory);
    expect(await s.rename('no-existe', 'Otro nombre')).toBeNull();
    expect(await s.list()).toHaveLength(0);
    s.close();
  });

  it('pesos() da el tamaño real del audio de cada sesión', async () => {
    // Es la contabilidad con la que la biblioteca dice cuánto ocupa cada cosa. Sale de
    // `blob.size` y no de `navigator.storage.estimate()`: medido en Chrome, `estimate()`
    // sube al escribir pero **no baja al borrar** ni a los 20 s, así que no sirve para
    // saber cuánto se liberó.
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), new Blob(['x'.repeat(5000)], { type: 'audio/mp3' }));
    await s.save(
      { ...META, id: 'ses-2', createdAt: 2_000 },
      tramos('dos'),
      new Blob(['y'.repeat(900)], { type: 'audio/mp3' }),
    );

    const pesos = await s.pesos();
    expect(pesos.get('ses-1')).toBe(5000);
    expect(pesos.get('ses-2')).toBe(900);
    s.close();
  });

  it('una sesión sin audio guardado no aparece pesando nada', async () => {
    // Distinto de pesar cero: si apareciera con 0, la biblioteca diría «0 B» donde la
    // verdad es «el audio no está». Son dos cosas distintas y la interfaz las dice
    // distinto.
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), null);
    expect((await s.pesos()).has('ses-1')).toBe(false);
    s.close();
  });

  it('borrar una sesión la saca también de la contabilidad', async () => {
    const s = await SessionStore.open(factory);
    await s.save(META, tramos('uno'), new Blob(['x'.repeat(3000)]));
    await s.remove('ses-1');
    expect((await s.pesos()).size).toBe(0);
    expect(await s.list()).toHaveLength(0);
    s.close();
  });
});
