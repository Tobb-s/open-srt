'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SessionStore,
  type StoredRun,
  type StoredSession,
} from '@/lib/store/session';
import { empaquetar } from '@/lib/export/paquete';

/**
 * Lo que la biblioteca necesita saber y poder hacer.
 *
 * ── Por qué la biblioteca es su propia ruta y su propio hook ──
 *
 * Los datos ya estaban guardados desde E2: sesiones, tramos, audio y corridas a medias. Lo
 * que no había era ninguna pantalla que los mostrara — sólo un aviso de «restaurar la
 * última». Con diez archivos en cola eso deja nueve transcripciones invisibles.
 *
 * El hook es aparte del de transcribir a propósito: la biblioteca **no carga el motor**. No
 * hay razón para bajar 850 MB de modelo para mirar una lista, y mezclarlos haría justamente
 * eso.
 */

export interface FilaBiblioteca {
  session: StoredSession;
  /** Bytes que ocupa su audio. `undefined` cuando el audio no está guardado. */
  audioBytes?: number;
}

export function useBiblioteca() {
  const [filas, setFilas] = useState<FilaBiblioteca[] | null>(null);
  const [corridas, setCorridas] = useState<StoredRun[]>([]);
  const [cuota, setCuota] = useState<{ usado: number; total: number } | null>(null);
  const [empaquetando, setEmpaquetando] = useState<{ hechos: number; total: number } | null>(null);
  const storeRef = useRef<SessionStore | null>(null);

  const refrescar = useCallback(async () => {
    const s = storeRef.current;
    if (!s) return;
    const [sesiones, pesos, runs] = await Promise.all([s.list(), s.pesos(), s.listRuns()]);
    setFilas(sesiones.map((session) => ({ session, audioBytes: pesos.get(session.id) })));
    setCorridas(runs);
  }, []);

  useEffect(() => {
    let vivo = true;
    void SessionStore.open()
      .then(async (s) => {
        if (!vivo) {
          s.close();
          return;
        }
        storeRef.current = s;
        const [sesiones, pesos, runs] = await Promise.all([s.list(), s.pesos(), s.listRuns()]);
        if (!vivo) return;
        setFilas(sesiones.map((session) => ({ session, audioBytes: pesos.get(session.id) })));
        setCorridas(runs);
      })
      // Sin IndexedDB —modo privado, permisos— la biblioteca queda vacía en vez de rota.
      .catch(() => setFilas([]));

    // La cuota se consulta una vez, al abrir: es para orientar, no para decidir. Medido en
    // este equipo, `estimate()` sube al escribir pero **no baja al borrar** ni a los 20 s,
    // así que volver a consultarla después de borrar mostraría un número viejo. Lo que se
    // muestra tras borrar sale de nuestra propia contabilidad (`pesos()`).
    void navigator.storage
      ?.estimate?.()
      .then((e) => vivo && setCuota({ usado: e.usage ?? 0, total: e.quota ?? 0 }))
      .catch(() => {});

    return () => {
      vivo = false;
      storeRef.current?.close();
    };
  }, []);

  const renombrar = useCallback(
    async (id: string, nombre: string) => {
      if (!(await storeRef.current?.rename(id, nombre))) return;
      await refrescar();
    },
    [refrescar],
  );

  const borrar = useCallback(
    async (id: string) => {
      await storeRef.current?.remove(id);
      await refrescar();
    },
    [refrescar],
  );

  /**
   * Suelta el audio y conserva el texto.
   *
   * Es la única forma de recuperar espacio sin perder nada escrito: el audio de una reunión
   * son decenas de MB y el texto, ciento y pico de KB.
   */
  const soltarAudio = useCallback(
    async (id: string) => {
      await storeRef.current?.liberarAudio(id);
      await refrescar();
    },
    [refrescar],
  );

  const descartarCorrida = useCallback(
    async (fileKey: string) => {
      await storeRef.current?.deleteRun(fileKey);
      await refrescar();
    },
    [refrescar],
  );

  /**
   * Descargar todas, en un zip.
   *
   * Los tramos se leen **de la base, de a una sesión por vez**. Tenerlas todas en memoria a
   * la vez es lo mismo que la cola evita al decodificar de a uno, y acá el zip ya obliga a
   * juntar el resultado: no hace falta juntar además la entrada.
   */
  const descargarTodas = useCallback(async () => {
    const s = storeRef.current;
    if (!s || !filas?.length) return;
    setEmpaquetando({ hechos: 0, total: filas.length });
    try {
      const items = [];
      for (const [i, f] of filas.entries()) {
        const cargada = await s.load(f.session.id);
        if (cargada) {
          items.push({
            nombre: f.session.fileName,
            segments: cargada.segments.map((x) => ({
              startSec: x.startSec,
              endSec: x.endSec,
              text: x.text,
              speaker: x.speaker,
            })),
          });
        }
        setEmpaquetando({ hechos: i + 1, total: filas.length });
      }
      const blob = await empaquetar(items);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'transcripciones.zip';
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setEmpaquetando(null);
    }
  }, [filas]);

  const bytesGuardados = (filas ?? []).reduce((a, f) => a + (f.audioBytes ?? 0), 0);

  return {
    filas,
    corridas,
    cuota,
    empaquetando,
    bytesGuardados,
    renombrar,
    borrar,
    soltarAudio,
    descartarCorrida,
    descargarTodas,
  };
}
