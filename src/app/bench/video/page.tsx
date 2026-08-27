'use client';

import { useCallback, useEffect, useState } from 'react';
import { runVideoProbe } from '@/lib/video/probe.browser';
import type { VideoProbeResult } from '@/lib/video/probe';

/**
 * La prueba de viabilidad de E3, con interfaz para poder correrla en cada navegador.
 *
 * No es parte del producto. Existe porque la decisión —si hace falta ffmpeg.wasm, o
 * WebCodecs con un demultiplexor, o nada— **depende del navegador**, y la única forma de
 * responderlo para Firefox y Safari es abrir esto ahí y mirar el resultado. Por eso muestra
 * el resultado como texto grande y legible: en Firefox se lee de una captura de pantalla.
 *
 * Arranca sola: si hubiera que apretar un botón, correrla en otro navegador exigiría poder
 * hacer clic, y el panel de un navegador ajeno puede ser de sólo lectura.
 *
 * Con `?guardar=1` además **descarga el resultado al terminar**, sin que nadie toque nada.
 * Es la forma de recoger la medición de un navegador que no se puede controlar: leerla de
 * una captura de pantalla no siempre se puede —una ventana ajena tapando la pantalla deja la
 * captura enmascarada— y en producción no hay ninguna ruta que escriba archivos.
 */

function Veredicto({ r }: { r: VideoProbeResult }) {
  const mp4 = r.containers.find((c) => c.mime.startsWith('video/mp4'));
  const webm = r.containers.find((c) => c.mime.startsWith('video/webm'));
  const ok = (c?: { decode: string; signalOk?: boolean }) => c?.decode === 'ok' && c.signalOk;
  const techo = r.memoryCeiling.filter((m) => m.resampled).at(-1)?.minutes ?? 0;

  return (
    <div className="space-y-1 rounded-xl border-2 border-neutral-800 p-4 text-lg">
      <p>
        <strong>mp4 por decodeAudioData:</strong>{' '}
        {ok(mp4) ? 'SÍ, y con la señal correcta' : `NO — ${mp4?.decode ?? 'no probado'}`}
      </p>
      <p>
        <strong>webm por decodeAudioData:</strong>{' '}
        {ok(webm) ? 'SÍ, y con la señal correcta' : `NO — ${webm?.decode ?? 'no probado'}`}
      </p>
      <p>
        <strong>Techo de memoria:</strong> {techo} min de audio 48 kHz estéreo
      </p>
      <p>
        <strong>WebCodecs AudioDecoder:</strong> {r.webCodecs.audioDecoder ? 'sí' : 'no'} ·{' '}
        <strong>AAC:</strong>{' '}
        {r.codecs.find((c) => c.codec === 'mp4a.40.2')?.supported ? 'sí' : 'no'}
      </p>
    </div>
  );
}

export default function VideoProbePage() {
  const [result, setResult] = useState<VideoProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // El estado inicial es el de «corriendo» porque la prueba arranca en el primer efecto:
  // ponerlo desde adentro del efecto sería un `setState` sincrónico en el montaje.
  const [fase, setFase] = useState('grabando y decodificando… (unos 25 s)');

  const descargar = useCallback((r: VideoProbeResult) => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const nombre = /Firefox/.test(r.userAgent)
      ? 'firefox'
      : /Edg\//.test(r.userAgent)
        ? 'edge'
        : /Chrome/.test(r.userAgent)
          ? 'chrome'
          : 'otro';
    a.download = `E3-video-${nombre}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  useEffect(() => {
    let vivo = true;
    void runVideoProbe((f) => {
      if (vivo) setFase(f);
    })
      .then(async (r) => {
        if (!vivo) return;
        setResult(r);
        // Se guarda en `benchmarks/` para poder comparar navegadores sobre datos y no
        // sobre capturas de pantalla. En producción la ruta devuelve 404 y no pasa nada.
        const guardado = await fetch('/api/bench-video', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(r),
        })
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null);
        if (!vivo) return;
        // En producción la ruta que escribe archivos no existe: ahí el resultado se baja.
        if (!guardado && new URLSearchParams(window.location.search).has('guardar')) {
          descargar(r);
          setFase('listo · descargado');
          return;
        }
        setFase(guardado ? `listo · guardado en ${guardado.guardado}` : 'listo');
      })
      .catch((e: Error) => {
        if (!vivo) return;
        setError(e.message);
        setFase('falló');
      });
    return () => {
      vivo = false;
    };
  }, [descargar]);


  return (
    <main className="mx-auto max-w-4xl space-y-4 p-8 font-sans">
      <h1 className="text-2xl font-medium">E3 · ¿hace falta ffmpeg.wasm?</h1>
      <p className="text-neutral-600">
        Graba un mp4 y un webm con un tono en segundos conocidos, y prueba si{' '}
        <code>decodeAudioData</code> —lo que el producto ya usa— saca el audio y lo saca
        bien.
      </p>
      <p className="font-mono text-sm">{fase}</p>

      {error && <p className="rounded-lg bg-red-50 p-4 text-red-900">{error}</p>}

      {result && (
        <>
          <Veredicto r={result} />
          <button
            onClick={() => descargar(result)}
            className="rounded-full bg-neutral-900 px-5 py-2 text-white"
          >
            Descargar JSON
          </button>
          <pre className="overflow-x-auto rounded-xl bg-neutral-100 p-4 text-xs">
            {JSON.stringify(result, null, 1)}
          </pre>
        </>
      )}
    </main>
  );
}
