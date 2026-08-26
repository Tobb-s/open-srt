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
export const DB_VERSION = 1;

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
  /** Si el usuario lo corrigió a mano. Se marca para no pisarlo y para poder mostrarlo. */
  edited: boolean;
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

/** Rango que cubre todos los tramos de una sesión, con la clave compuesta [id, índice]. */
function segmentRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
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

  /** Escribe una corrección. Toca **un registro**: ni el audio ni los otros tramos. */
  async updateSegment(sessionId: string, index: number, text: string): Promise<void> {
    const tx = this.db.transaction('segments', 'readwrite');
    const store = tx.objectStore('segments');
    const actual = await promisify<StoredSegment | undefined>(store.get([sessionId, index]));
    if (!actual) {
      tx.abort();
      throw new Error(`No existe el tramo ${index} de la sesión ${sessionId}`);
    }
    store.put({ ...actual, text, edited: true });
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

  /** Borra todo. Es la salida para quien no quiere dejar su audio en el disco. */
  async clear(): Promise<void> {
    const tx = this.db.transaction(['sessions', 'segments', 'audio'], 'readwrite');
    tx.objectStore('sessions').clear();
    tx.objectStore('segments').clear();
    tx.objectStore('audio').clear();
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
