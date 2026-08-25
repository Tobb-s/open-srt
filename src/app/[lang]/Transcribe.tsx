'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AsrEngine } from '@/lib/asr/engine';
import type { Selection } from '@/lib/asr/capabilities';
import { rtfMedian, profileByKey, type ModelProfile } from '@/lib/asr/models';
import { roughEstimateRange } from '@/lib/asr/capabilities';
import { Estimator, describeEstimate, WINDOW_SEC } from '@/lib/asr/estimate';
import { learnedRtf, recordRtf, sampleCount } from '@/lib/asr/learned';
import { decodeToMono16k } from '@/lib/audio/decode';
import { dict, humanDuration, humanRange, type Lang } from '@/lib/i18n';

type Phase =
  | 'checking'
  | 'idle'
  | 'decoding'
  | 'ready'
  | 'downloading'
  | 'loading'
  | 'transcribing'
  | 'done'
  | 'error';

interface LoadedFile {
  name: string;
  samples: Float32Array;
  durationSec: number;
}

export default function Transcribe({ lang }: { lang: Lang }) {
  const t = dict(lang);

  const [phase, setPhase] = useState<Phase>('checking');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [profile, setProfile] = useState<ModelProfile | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [downloadPct, setDownloadPct] = useState(0);
  const [processedSec, setProcessedSec] = useState<number | undefined>(undefined);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [remainingText, setRemainingText] = useState('');
  const [partial, setPartial] = useState('');
  const [result, setResult] = useState<{ text: string; inferMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Idioma del audio, que NO es necesariamente el de la interfaz: alguien en /es puede
  // transcribir una reunión en inglés. Por eso es un control aparte.
  //
  // **El valor inicial es el idioma de la interfaz, no «Detectar».** Medido: con
  // `es-noisy-3min` y detección automática, el modelo devolvió «The theater of the
  // Flautista, a great success» — tradujo al inglés en vez de transcribir, y a mitad de
  // archivo volvió al español solo. Con el idioma fijado, el mismo audio sale perfecto,
  // voseo incluido. Forzar `task: 'transcribe'` NO lo evita.
  //
  // Un fallo silencioso que devuelve texto plausible en otro idioma es peor que pedirle
  // al usuario que confirme el idioma, así que el default es el predecible y «Detectar»
  // queda como opción advertida.
  const [audioLang, setAudioLang] = useState<'auto' | 'es' | 'en'>(lang);

  const engineRef = useRef<AsrEngine | null>(null);
  const estimatorRef = useRef<Estimator | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detectar capacidades apenas carga: el usuario tiene que saber qué va a pasar
  // *antes* de elegir un archivo, no después.
  useEffect(() => {
    let alive = true;
    void AsrEngine.inspect().then(({ selection: sel }) => {
      if (!alive) return;
      setSelection(sel);

      // `?perfil=base-wasm` fuerza un perfil concreto. Sirve para dos cosas: probar el
      // camino sin GPU en un equipo que sí la tiene —si no, ese camino no se ejercita
      // nunca hasta que le toca a un usuario real—, y para que alguien pueda elegir a
      // mano un modelo distinto del que la detección eligió.
      const pedido = new URLSearchParams(window.location.search).get('perfil');
      const forzado = pedido ? profileByKey(pedido) : undefined;
      setProfile(forzado ?? sel.profile);
      setPhase('idle');
    });
    return () => {
      alive = false;
      void engineRef.current?.dispose();
    };
  }, []);

  const onFile = useCallback(
    async (f: File) => {
      setError(null);
      setResult(null);
      setPartial('');
      setProcessedSec(undefined);
      setPhase('decoding');
      try {
        const bytes = await f.arrayBuffer();
        const audio = await decodeToMono16k(bytes);
        setFile({ name: f.name, samples: audio.samples, durationSec: audio.durationSec });
        setPhase('ready');
      } catch {
        setError(t.errors.decode);
        setPhase('error');
      }
    },
    [t],
  );

  const run = useCallback(async () => {
    if (!file || !profile) return;
    setError(null);
    setPartial('');
    setProcessedSec(undefined);
    setElapsedSec(0);

    // El RTF que este equipo ya demostró vale más que el de la tabla, aunque venga de
    // otro archivo: al menos se midió acá.
    const estimator = new Estimator(profile, learnedRtf(profile.key));
    estimatorRef.current = estimator;

    try {
      let engine = engineRef.current;
      if (!engine) {
        engine = new AsrEngine();
        engineRef.current = engine;
        setPhase('downloading');
        const status = await engine.load(profile, (p) => {
          const pct = Math.round((p.loaded / p.total) * 100);
          setDownloadPct(pct);
          // Bajar los bytes no es tenerlo listo: inicializar la sesión de ONNX y subir los
          // pesos a la GPU tardó 91 s con turbo en E0. Sin este cambio de fase, la barra
          // se queda en 100 % y parece colgada.
          if (pct >= 100) setPhase('loading');
        });
        if (status.mode === 'main-thread') setDegraded(t.errors.degraded);
      }

      setPhase('transcribing');
      // El reloj arranca acá, no en un efecto: si se leyera de una variable capturada en
      // el render, el callback usaría el valor de cuando se creó y la calibración mediría
      // contra un instante equivocado.
      const startedAt = performance.now();
      estimator.start();
      let calibrated = false;

      const out = await engine.transcribe(file.samples, file.durationSec, {
        language: audioLang === 'auto' ? undefined : audioLang,
        onProgress: (p) => {
          setPartial(p.partialText);

          // Sin timestamps —el caso por defecto— no se sabe en qué segundo va el modelo.
          // La estimación se queda con el RTF aprendido y el avance visible es el texto,
          // que es prueba real: si el modelo se traba, el texto se detiene.
          if (p.processedSec === undefined) {
            setRemainingText(describeEstimate(estimator.estimate(file.durationSec)));
            return;
          }

          setProcessedSec(p.processedSec);
          if (!calibrated && p.processedSec >= WINDOW_SEC) {
            estimator.calibrate(performance.now() - startedAt, p.processedSec);
            calibrated = true;
          } else {
            estimator.refine(p.processedSec);
          }
          setRemainingText(describeEstimate(estimator.estimate(file.durationSec, p.processedSec)));
        },
      });

      // Acá sí se sabe todo: cuánto audio era y cuánto tardó. Ese RTF alimenta la
      // estimación del próximo archivo, que ya no va a ser prestada.
      recordRtf(profile.key, out.inferMs / 1000 / file.durationSec, file.durationSec);

      setResult(out);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.generic);
      setPhase('error');
    }
  }, [file, profile, t, audioLang]);

  // Reloj de pared. Sin barra de porcentaje, es la referencia de que el tiempo corre.
  useEffect(() => {
    if (phase !== 'transcribing') return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsedSec((performance.now() - t0) / 1000), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const copy = useCallback(async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [result]);

  const download = useCallback(() => {
    if (!result || !file) return;
    const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${file.name.replace(/\.[^.]+$/, '')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setPartial('');
    setError(null);
    setPhase('idle');
  }, []);

  const busy = phase === 'downloading' || phase === 'loading' || phase === 'transcribing';
  // Sólo hay porcentaje si el modelo informó en qué segundo va. Sin eso NO se dibuja una
  // barra: fingir una medición es exactamente lo que esta herramienta no hace.
  const pct =
    processedSec !== undefined && file && file.durationSec > 0
      ? Math.min(100, (processedSec / file.durationSec) * 100)
      : undefined;

  return (
    <div className="space-y-8">
      {/* Qué va a usar este equipo, dicho antes de elegir archivo */}
      <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-800 dark:bg-neutral-900/50">
        {phase === 'checking' ? (
          <p className="text-neutral-500">{t.device.checking}</p>
        ) : selection && profile ? (
          <div className="space-y-2">
            {/*
              Muestra el perfil EFECTIVO, no el que la detección eligió. Antes usaba
              `selection.profile`, así que al cambiar de modelo —con el botón de la
              alternativa o con `?perfil=`— el panel seguía anunciando el anterior: decía
              «Calidad alta» mientras iba a usar el modelo de calidad limitada.
            */}
            <p className="text-sm">
              <span className="font-medium">{t.device.quality[profile.quality]}</span>
              <span className="text-neutral-500">
                {' · '}
                {t.device.ready(profile.key, profile.downloadMB)}
              </span>
            </p>
            {selection.notice && (
              <p
                className={
                  selection.notice.level === 'warn'
                    ? 'rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'text-sm text-neutral-500'
                }
              >
                {selection.notice.text}
              </p>
            )}
            {selection.alternative && !busy && (
              <button
                onClick={() => setProfile(selection.alternative!)}
                className="text-sm underline underline-offset-2 disabled:opacity-50"
                disabled={profile?.key === selection.alternative.key}
              >
                {profile?.key === selection.alternative.key
                  ? `✓ ${selection.alternative.key}`
                  : t.device.switchTo(selection.alternative.key)}
              </button>
            )}
          </div>
        ) : null}
      </section>

      {/* Zona de archivo */}
      {!file && phase !== 'decoding' && (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void onFile(f);
          }}
          className={`rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
            dragging
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
              : 'border-neutral-300 dark:border-neutral-700'
          }`}
        >
          <p className="text-lg font-medium">{t.drop.idle}</p>
          <p className="mt-1 text-neutral-500">{t.drop.hint}</p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-full bg-neutral-900 px-6 py-2.5 font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            {t.drop.button}
          </button>
          <p className="mt-3 text-xs text-neutral-400">{t.drop.formats}</p>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </section>
      )}

      {phase === 'decoding' && <p className="text-neutral-500">…</p>}

      {/* Archivo listo: duración y estimación ANTES de arrancar */}
      {file && phase === 'ready' && profile && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="font-medium">{file.name}</p>
          <p className="text-sm text-neutral-500">
            {t.file.duration(humanDuration(file.durationSec, lang))}
          </p>
          <p className="text-sm">
            {t.file.estimateBefore}{' '}
            <strong>
              {(() => {
                const aprendido = learnedRtf(profile.key);
                // Con RTF aprendido de este equipo, un número. Sin él, un RANGO: las
                // mediciones varían un 25 % y un valor único fingiría precisión.
                if (aprendido !== undefined) {
                  return humanDuration(file.durationSec * aprendido, lang);
                }
                const r = roughEstimateRange(profile, file.durationSec);
                return r.single
                  ? humanDuration(file.durationSec * rtfMedian(profile), lang)
                  : humanRange(r.minSec, r.maxSec, lang);
              })()}
            </strong>
            <span className="text-neutral-500">
              {' — '}
              {/* De dónde sale el número. Presentar una estimación prestada de otro
                  equipo como si fuera medida acá sería la mentira cómoda de siempre. */}
              {sampleCount(profile.key) > 0
                ? t.file.estimateLearned(sampleCount(profile.key))
                : t.file.estimateApprox}
            </span>
          </p>
          {file.durationSec > 1800 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {t.file.tooLong}
            </p>
          )}
          <div className="pt-1">
            <label className="text-sm text-neutral-600 dark:text-neutral-400">
              {t.file.audioLang}{' '}
              <select
                value={audioLang}
                onChange={(e) => setAudioLang(e.target.value as 'auto' | 'es' | 'en')}
                className="ml-1 rounded-lg border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="auto">{t.file.audioLangAuto}</option>
                <option value="es">{t.file.audioLangEs}</option>
                <option value="en">{t.file.audioLangEn}</option>
              </select>
            </label>
            <p className="mt-1.5 text-xs text-neutral-500">
              {audioLang === 'auto' ? t.file.audioLangAutoWarn : t.file.audioLangHint}
            </p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={run}
              className="rounded-full bg-blue-600 px-6 py-2.5 font-medium text-white"
            >
              {t.run.start}
            </button>
            <button onClick={reset} className="rounded-full px-4 py-2.5 text-neutral-500">
              {t.result.newFile}
            </button>
          </div>
        </section>
      )}

      {/* Progreso real */}
      {busy && file && (
        <section className="space-y-3 rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <p className="font-medium">
            {phase === 'downloading'
              ? t.run.downloading(downloadPct)
              : phase === 'loading'
                ? t.run.loading
                : t.run.transcribing}
          </p>

          {phase === 'transcribing' && (
            <>
              {pct !== undefined ? (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                    <div
                      className="h-full bg-blue-600 transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-sm text-neutral-500">
                    {t.run.processed(
                      humanDuration(processedSec!, lang),
                      humanDuration(file.durationSec, lang),
                    )}
                    {remainingText && ` · ${t.run.remaining(remainingText)}`}
                  </p>
                </>
              ) : (
                <p className="text-sm text-neutral-500">
                  {t.run.elapsed(humanDuration(elapsedSec, lang))}
                  {remainingText && ` · ${t.run.remaining(remainingText)}`}
                </p>
              )}
            </>
          )}

          {phase === 'downloading' && (
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-neutral-500 transition-[width]"
                style={{ width: `${downloadPct}%` }}
              />
            </div>
          )}

          {partial && (
            <p className="max-h-40 overflow-y-auto rounded-lg bg-neutral-50 p-3 text-sm text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
              {partial}
            </p>
          )}
        </section>
      )}

      {degraded && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {degraded.replace(/\*\*/g, '')}
        </p>
      )}

      {/* Resultado */}
      {phase === 'done' && result && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-medium">{t.result.title}</h2>
            <span className="text-sm text-neutral-500">
              {t.result.words(result.text ? result.text.trim().split(/\s+/).length : 0)}
              {' · '}
              {t.result.tookLabel(humanDuration(result.inferMs / 1000, lang))}
            </span>
          </div>

          {result.text ? (
            <>
              <p className="whitespace-pre-wrap rounded-2xl border border-neutral-200 p-5 leading-relaxed dark:border-neutral-800">
                {result.text}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={copy}
                  className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                >
                  {copied ? t.result.copied : t.result.copy}
                </button>
                <button
                  onClick={download}
                  className="rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
                >
                  {t.result.download}
                </button>
                <button onClick={reset} className="rounded-full px-4 py-2 text-neutral-500">
                  {t.result.newFile}
                </button>
              </div>
            </>
          ) : (
            <p className="text-neutral-500">{t.result.empty}</p>
          )}
        </section>
      )}

      {error && (
        <section className="space-y-3">
          <p className="rounded-lg bg-red-50 p-4 text-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
          <button onClick={reset} className="text-sm underline underline-offset-2">
            {t.result.newFile}
          </button>
        </section>
      )}
    </div>
  );
}
