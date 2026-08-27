import type { TimedText } from '../vad/align';

/**
 * Persistencia local de una sesión de transcripción.
 *
 * ── Por qué IndexedDB y no otra cosa ──
 *
 * Hace falta guardar **audio** —decenas o cientos de megabytes— y texto que cambia palabra
 * por palabra. `localStorage` no sirve: guarda strings, tiene un límite de unos 5 MB y
 * escribe sincrónicamente, así que un archivo grande congelaría la pestaña. IndexedDB
 * guarda `Blob` sin convertirlo a texto y escribe en transacciones asincrónicas.
 *
 * ── Qué se guarda y con qué costo ──
 *
 * El audio se escribe **una sola vez**, cuando termina la transcripción. Cada corrección
 * del usuario escribe **un solo registro** de la tabla de tramos. Si audio y texto
 * vivieran en el mismo registro, corregir una coma reescribiría el archivo entero: en un
 * audio de una hora eso son ~100 MB por tecla.
 *
 * ── Privacidad ──
 *
 * Esto deja el audio del usuario guardado en el disco de su máquina. No sale del navegador
 * —el resto del producto ya garantiza eso— pero sobrevive a cerrar la pestaña, que es
 * justamente para lo que está. Por eso hay tope de sesiones y un borrado explícito: la
 * interfaz tiene que decir que quedó guardado y ofrecer sacarlo.
 */

export const DB_NAME = 'opensrt';
export const DB_VERSION = 3;
//                          ^ 2 salió desplegada con la tabla `runs`. Agregar `runChunks`
//                            exige subir otra vez: un navegador que ya abrió la 2 no vuelve
//                            a entrar en `onupgradeneeded` con el mismo número, y la tabla
//                            nueva no existiría nunca. La subida sigue siendo aditiva.

/**
 * Cuántas corridas a medio hacer se conservan.
 *
 * Menos que sesiones terminadas: una corrida interrumpida sólo sirve para retomarla, y si
 * quedaron cinco tiradas es que ninguna importaba.
 */
export const MAX_RUNS = 3;

/**
 * Cuántas sesiones se conservan. Cada una arrastra su audio, así que el tope no es
 * estético: sin él, diez reuniones de una hora llenan la cuota del navegador y la
 * siguiente escritura falla.
 */
export const MAX_SESSIONS = 5;

export interface StoredSession {
  id: string;
  fileName: string;
  durationSec: number;
  createdAt: number;
  speechSec: number;
  inferMs: number;
  /** Copia de `coverage.suspicious`: el aviso de omisión tiene que sobrevivir al recargar. */
  suspicious: boolean;
  segmentCount: number;
  /**
   * `false` si el audio no entró en la cuota. El texto se guarda igual; lo que se pierde
   * es poder escucharlo, no la transcripción.
   */
  audioStored: boolean;
}

export interface StoredSegment {
  sessionId: string;
  index: number;
  startSec: number;
  endSec: number;
  text: string;
  /**
   * Quien habla, si se separaron los hablantes.
   *
   * Se guarda **el nombre que ve el usuario**, no la etiqueta del modelo: si renombro a
   * «Martin», al volver tiene que decir «Martin» y no «Hablante 1».
   */
  speaker?: string;
  /** Si el usuario lo corrigió a mano. Se marca para no pisarlo y para poder mostrarlo. */
  edited: boolean;
}

/**
 * Una transcripción a medio hacer.
 *
 * ── Por qué existe ──
 *
 * Hasta E5 sólo se guardaba el resultado **terminado**. En un archivo de dos horas eso
 * significa que cerrar la pestaña sin querer a los 100 minutos tira todo, y eso es
 * inaceptable — es el trabajo de una hora y media del equipo de alguien.
 *
 * ── Por qué se guardan los bloques ──
 *
 * Reanudar exige que los bloques sean **los mismos** de la vez anterior: si se recalcularan
 * con el detector, un cambio de umbral o de versión daría otros bordes y los tramos ya hechos
 * no encajarían con los nuevos. Se guardan y se vuelven a pasar tal cual.
 *
 * ── La clave ──
 *
 * Es del **archivo**, no de la sesión: nombre, tamaño y fecha de modificación. Alcanza para
 * reconocer «este es el mismo archivo que dejaste a medias» sin leer dos horas de audio para
 * calcular un hash.
 */
export interface StoredRun {
  /** `nombre|tamaño|modificado`. Ver arriba por qué no es un hash del contenido. */
  fileKey: string;
  fileName: string;
  durationSec: number;
  updatedAt: number;
  /** Los bordes de cada bloque, tal como los dio el detector la primera vez. */
  blocks: Array<{ startSec: number; endSec: number; segments: Array<{ startSec: number; endSec: number }>; speechSec: number }>;
  /** Cuántos bloques del principio están hechos. */
  doneBlocks: number;
  speechSec: number;
  language?: string;
}

/**
 * Lo que produjo **un** bloque.
 *
 * Vive aparte del registro de la corrida a propósito. La primera versión guardaba la lista
 * entera de tramos adentro del registro y la reescribía en cada bloque: con los 65 de media
 * hora no se nota, pero un archivo de dos horas tiene unos 1300, y reescribir una lista que
 * crece en cada paso es cuadrático — cerca de un millón de escrituras de tramo para guardar
 * mil seiscientos.
 *
 * Es exactamente el error que E2 evitó con el audio, cometido de nuevo en el código nuevo.
 */
export interface StoredRunChunk {
  fileKey: string;
  blockIndex: number;
  segments: Array<{ startSec: number; endSec: number; text: string }>;
}

export interface LoadedSession {
  session: StoredSession;
  segments: StoredSegment[];
  audio: Blob | null;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Fallo de IndexedDB'));
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transacción fallida'));
    tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'));
  });
}

/** Rango que cubre todos los bloques guardados de una corrida. */
function chunkRange(fileKey: string): IDBKeyRange {
  return IDBKeyRange.bound([fileKey, -Infinity], [fileKey, Infinity]);
}

/** Rango que cubre todos los tramos de una sesión, con la clave compuesta [id, índice]. */
function segmentRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
}

/**
 * Identifica un archivo entre visitas, sin leerlo entero.
 *
 * Nombre, tamaño y fecha de modificación. Un hash del contenido sería más exacto pero exige
 * leer dos horas de audio antes de poder decir «esto ya lo empezaste», que es justo lo que se
 * quiere evitar. La colisión posible —otro archivo con el mismo nombre, el mismo tamaño al
 * byte y la misma fecha al milisegundo— se paga con una oferta de reanudar que no corresponde,
 * y el usuario puede decir que no.
 */
export function fileKeyOf(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function newSessionId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  // Sin `randomUUID` —contextos no seguros— alcanza con que no colisione en una máquina.
  return `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export class SessionStore {
  private constructor(private readonly db: IDBDatabase) {}

  /**
   * Abre la base. El `factory` se inyecta para poder probar esto contra una
   * implementación en memoria: sin eso, la persistencia sólo se podría verificar a mano en
   * un navegador, que es exactamente el tipo de comprobación que no queda registrada.
   */
  static open(factory: IDBFactory = indexedDB): Promise<SessionStore> {
    return new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('segments')) {
          // Clave compuesta: identifica el tramo y además los deja ordenados por índice
          // dentro de cada sesión, que es como se leen.
          db.createObjectStore('segments', { keyPath: ['sessionId', 'index'] });
        }
        if (!db.objectStoreNames.contains('audio')) {
          db.createObjectStore('audio');
        }
        // Versión 2. La subida es **aditiva**: no toca lo que ya había, así que una sesión
        // guardada con la versión 1 se sigue abriendo igual. Migrar datos acá sería la forma
        // más rápida de perder transcripciones ajenas por un error propio.
        if (!db.objectStoreNames.contains('runs')) {
          db.createObjectStore('runs', { keyPath: 'fileKey' });
        }
        if (!db.objectStoreNames.contains('runChunks')) {
          // Clave compuesta: identifica el bloque y además los deja ordenados por índice
          // dentro de cada corrida, que es como se leen para rearmar el avance.
          db.createObjectStore('runChunks', { keyPath: ['fileKey', 'blockIndex'] });
        }
      };
      req.onsuccess = () => resolve(new SessionStore(req.result));
      req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
    });
  }

  /**
   * Guarda una transcripción recién terminada.
   *
   * El texto y el audio van en **transacciones separadas** a propósito: el audio es lo
   * único que puede reventar la cuota, y si fuera todo junto un archivo demasiado grande
   * se llevaría puesta también la transcripción. Así, en el peor caso, queda el texto y se
   * pierde sólo la reproducción.
   */
  async save(
    meta: Omit<StoredSession, 'segmentCount' | 'audioStored'>,
    segments: readonly TimedText[],
    audio: Blob | null,
  ): Promise<StoredSession> {
    const session: StoredSession = {
      ...meta,
      segmentCount: segments.length,
      audioStored: false,
    };

    const tx = this.db.transaction(['sessions', 'segments'], 'readwrite');
    tx.objectStore('sessions').put(session);
    const store = tx.objectStore('segments');
    for (const [index, s] of segments.entries()) {
      store.put({
        sessionId: session.id,
        index,
        startSec: s.startSec,
        endSec: s.endSec,
        text: s.text,
        speaker: s.speaker,
        edited: false,
      } satisfies StoredSegment);
    }
    await finished(tx);

    if (audio) {
      try {
        const at = this.db.transaction('audio', 'readwrite');
        at.objectStore('audio').put(audio, session.id);
        await finished(at);
        session.audioStored = true;
        const st = this.db.transaction('sessions', 'readwrite');
        st.objectStore('sessions').put(session);
        await finished(st);
      } catch {
        // Cuota llena, típicamente. Queda `audioStored: false` y la interfaz lo dice.
      }
    }

    await this.prune();
    return session;
  }

  /**
   * Escribe una corrección. Toca **un registro**: ni el audio ni los otros tramos.
   *
   * `speaker` es opcional y sólo se escribe si viene: renombrar un hablante y corregir un
   * texto son dos cosas distintas, y pasar `undefined` no puede borrar el nombre que ya
   * estaba.
   */
  async updateSegment(
    sessionId: string,
    index: number,
    text: string,
    speaker?: string,
  ): Promise<void> {
    const tx = this.db.transaction('segments', 'readwrite');
    const store = tx.objectStore('segments');
    const actual = await promisify<StoredSegment | undefined>(store.get([sessionId, index]));
    if (!actual) {
      tx.abort();
      throw new Error(`No existe el tramo ${index} de la sesión ${sessionId}`);
    }
    store.put({
      ...actual,
      text,
      speaker: speaker ?? actual.speaker,
      edited: true,
    });
    await finished(tx);
  }

  async load(sessionId: string): Promise<LoadedSession | null> {
    const tx = this.db.transaction(['sessions', 'segments'], 'readonly');
    const session = await promisify<StoredSession | undefined>(
      tx.objectStore('sessions').get(sessionId),
    );
    if (!session) return null;
    const segments = await promisify<StoredSegment[]>(
      tx.objectStore('segments').getAll(segmentRange(sessionId)),
    );

    let audio: Blob | null = null;
    if (session.audioStored) {
      const at = this.db.transaction('audio', 'readonly');
      audio = (await promisify<Blob | undefined>(at.objectStore('audio').get(sessionId))) ?? null;
    }

    // `getAll` sobre la clave compuesta ya devuelve ordenado por índice, pero el orden es
    // lo que sostiene la sincronía con el audio: se ordena explícitamente para que un
    // cambio futuro en el esquema no lo rompa en silencio.
    segments.sort((a, b) => a.index - b.index);
    return { session, segments, audio };
  }

  async list(): Promise<StoredSession[]> {
    const tx = this.db.transaction('sessions', 'readonly');
    const todas = await promisify<StoredSession[]>(tx.objectStore('sessions').getAll());
    return todas.sort((a, b) => b.createdAt - a.createdAt);
  }

  async latest(): Promise<StoredSession | null> {
    return (await this.list())[0] ?? null;
  }

  async remove(sessionId: string): Promise<void> {
    const tx = this.db.transaction(['sessions', 'segments', 'audio'], 'readwrite');
    tx.objectStore('sessions').delete(sessionId);
    tx.objectStore('segments').delete(segmentRange(sessionId));
    tx.objectStore('audio').delete(sessionId);
    await finished(tx);
  }

  /* ---------------------------------------------------------------- *
   * Corridas a medio hacer
   * ---------------------------------------------------------------- */

  /**
   * Guarda el avance: la cabecera de la corrida **y sólo el bloque que acaba de terminar**.
   *
   * Las dos cosas van en la misma transacción para que no pueda quedar una cabecera que diga
   * que hay diez bloques hechos con nueve guardados. Si eso pasara, al retomar faltaría un
   * bloque y no fallaría nada: saldría una transcripción con un agujero.
   */
  async saveRunProgress(run: StoredRun, chunk: StoredRunChunk): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks'], 'readwrite');
    tx.objectStore('runs').put(run);
    tx.objectStore('runChunks').put(chunk);
    await finished(tx);
    await this.pruneRuns();
  }

  /** Sólo la cabecera. Para cuando todavía no hay ningún bloque terminado. */
  async saveRun(run: StoredRun): Promise<void> {
    const tx = this.db.transaction('runs', 'readwrite');
    tx.objectStore('runs').put(run);
    await finished(tx);
    await this.pruneRuns();
  }

  async loadRun(fileKey: string): Promise<StoredRun | null> {
    const tx = this.db.transaction('runs', 'readonly');
    return (await promisify<StoredRun | undefined>(tx.objectStore('runs').get(fileKey))) ?? null;
  }

  /**
   * Rearma lo transcrito hasta ahora, en orden.
   *
   * Se descarta lo que esté más allá de `doneBlocks`: si el navegador murió entre escribir el
   * bloque y actualizar la cabecera, sobra un bloque, y es preferible rehacerlo que meterlo
   * dos veces.
   */
  async loadRunSegments(fileKey: string, doneBlocks: number): Promise<StoredRunChunk['segments']> {
    const tx = this.db.transaction('runChunks', 'readonly');
    const trozos = await promisify<StoredRunChunk[]>(
      tx.objectStore('runChunks').getAll(chunkRange(fileKey)),
    );
    return trozos
      .filter((c) => c.blockIndex < doneBlocks)
      .sort((a, b) => a.blockIndex - b.blockIndex)
      .flatMap((c) => c.segments);
  }

  async deleteRun(fileKey: string): Promise<void> {
    const tx = this.db.transaction(['runs', 'runChunks'], 'readwrite');
    tx.objectStore('runs').delete(fileKey);
    tx.objectStore('runChunks').delete(chunkRange(fileKey));
    await finished(tx);
  }

  async listRuns(): Promise<StoredRun[]> {
    const tx = this.db.transaction('runs', 'readonly');
    const todas = await promisify<StoredRun[]>(tx.objectStore('runs').getAll());
    return todas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private async pruneRuns(): Promise<void> {
    for (const vieja of (await this.listRuns()).slice(MAX_RUNS)) {
      await this.deleteRun(vieja.fileKey);
    }
  }

  /** Borra todo. Es la salida para quien no quiere dejar su audio en el disco. */
  async clear(): Promise<void> {
    const tx = this.db.transaction(
      ['sessions', 'segments', 'audio', 'runs', 'runChunks'],
      'readwrite',
    );
    tx.objectStore('sessions').clear();
    tx.objectStore('segments').clear();
    tx.objectStore('audio').clear();
    // Las corridas a medio hacer también: «borrar lo guardado» tiene que borrar todo, y una
    // transcripción a medias es contenido del usuario igual que una terminada.
    tx.objectStore('runs').clear();
    tx.objectStore('runChunks').clear();
    await finished(tx);
  }

  private async prune(): Promise<void> {
    const todas = await this.list();
    for (const vieja of todas.slice(MAX_SESSIONS)) {
      await this.remove(vieja.id);
    }
  }

  close(): void {
    this.db.close();
  }
}
