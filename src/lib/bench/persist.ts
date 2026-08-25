import type { BenchRun, DeviceInfo, RunResult } from './types';

/**
 * Persistencia de los resultados del banco.
 *
 * Existe por una razón concreta y no hipotética: la GPU de este equipo ya tumbó la
 * aplicación entera una vez hoy, y una corrida completa de la matriz son horas. Si un
 * resultado sólo vive en memoria hasta el final, una caída a mitad de camino se lleva
 * todo el trabajo.
 *
 * Por eso cada resultado se escribe **apenas termina**, en su propia transacción corta.
 * Una caída puede perder como mucho la medición en vuelo; nunca las anteriores.
 *
 * Se usa IndexedDB y no localStorage por tamaño: las transcripciones de los ítems largos
 * son de decenas o cientos de KB cada una y la matriz entera excede con comodidad el
 * límite de localStorage.
 */

const DB_NAME = 'bench-e0';
const DB_VERSION = 1;
const STORE_RUNS = 'runs';
const STORE_RESULTS = 'results';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'runId' });
      }
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        const s = db.createObjectStore(STORE_RESULTS, { autoIncrement: true });
        s.createIndex('runId', 'runId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  // IDBRequest sin parametrizar: los métodos de IDBObjectStore devuelven tipos distintos
  // (`any`, `undefined`, `IDBValidKey`) y forzarlos al genérico produce incompatibilidades
  // que no dicen nada. El resultado se afirma una sola vez, acá.
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result as T);
    r.onerror = () => reject(r.error);
    t.onabort = () => reject(t.error);
  });
}

/** Registra una corrida nueva. Se llama una vez, antes de la primera medición. */
export async function startRun(runId: string, device: DeviceInfo): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, STORE_RUNS, 'readwrite', (s) =>
      s.put({ runId, device, startedAt: new Date().toISOString() }),
    );
  } finally {
    db.close();
  }
}

/**
 * Guarda un resultado. Se llama tras **cada** combinación, no al final.
 *
 * Devuelve una promesa que conviene esperar antes de arrancar la medición siguiente: si
 * la próxima combinación es la que tumba la GPU, ésta ya tiene que estar en disco.
 */
export async function saveResult(runId: string, result: RunResult): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, STORE_RESULTS, 'readwrite', (s) => s.add({ runId, ...result }));
  } finally {
    db.close();
  }
}

export async function loadRun(runId: string): Promise<BenchRun | undefined> {
  const db = await openDb();
  try {
    const meta = await tx<{ runId: string; device: DeviceInfo; startedAt: string }>(
      db,
      STORE_RUNS,
      'readonly',
      (s) => s.get(runId),
    );
    if (!meta) return undefined;

    const results = await new Promise<RunResult[]>((resolve, reject) => {
      const t = db.transaction(STORE_RESULTS, 'readonly');
      const idx = t.objectStore(STORE_RESULTS).index('runId');
      const r = idx.getAll(runId);
      r.onsuccess = () => resolve(r.result as RunResult[]);
      r.onerror = () => reject(r.error);
    });

    return { runId: meta.runId, device: meta.device, startedAt: meta.startedAt, results };
  } finally {
    db.close();
  }
}

export async function listRuns(): Promise<
  Array<{ runId: string; device: DeviceInfo; startedAt: string }>
> {
  const db = await openDb();
  try {
    return await tx(db, STORE_RUNS, 'readonly', (s) => s.getAll());
  } finally {
    db.close();
  }
}

/**
 * Qué combinaciones ya están medidas en esta corrida.
 *
 * Permite retomar después de una caída sin repetir lo que ya costó horas. La clave
 * incluye el estado: una combinación que quedó en `timeout` **sí** se vuelve a intentar,
 * porque un timeout puede haber sido la caída de la GPU y no una propiedad del modelo.
 */
export async function completedKeys(runId: string): Promise<Set<string>> {
  const run = await loadRun(runId);
  const done = new Set<string>();
  for (const r of run?.results ?? []) {
    if (r.status === 'ok' || r.status === 'skipped') {
      done.add(`${r.modelKey}|${r.backend}|${r.itemId}`);
    }
  }
  return done;
}

export async function deleteRun(runId: string): Promise<void> {
  const db = await openDb();
  try {
    await tx(db, STORE_RUNS, 'readwrite', (s) => s.delete(runId));
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE_RESULTS, 'readwrite');
      const store = t.objectStore(STORE_RESULTS);
      const idx = store.index('runId');
      const r = idx.openCursor(IDBKeyRange.only(runId));
      r.onsuccess = () => {
        const c = r.result;
        if (c) {
          c.delete();
          c.continue();
        } else resolve();
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
