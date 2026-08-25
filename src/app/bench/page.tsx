'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MODELS, BACKENDS } from '@/lib/bench/models';
import { detectDevice, runBench, type ProgressEvent } from '@/lib/bench/runner';
import { loadCorpus, describeCorpus, type CorpusManifest } from '@/lib/bench/corpus';
import { memoryCapabilities } from '@/lib/bench/memory';
import { buildReport, reportFilename } from '@/lib/bench/report';
import { loadRun, deleteRun } from '@/lib/bench/persist';
import type { Backend, DeviceInfo, Level } from '@/lib/bench/types';

/**
 * Banco de medición de E0. No es parte del producto: es la herramienta que decide qué
 * modelo entra por defecto. Por eso vive fuera del sitio bilingüe y va con `noindex`.
 */

export default function BenchPage() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [manifest, setManifest] = useState<CorpusManifest | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [levels, setLevels] = useState<Level[]>(['A']);
  const [modelKeys, setModelKeys] = useState<string[]>(MODELS.map((m) => m.key));
  const [backends, setBackends] = useState<Backend[]>([...BACKENDS]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<ProgressEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mem = typeof window !== 'undefined' ? memoryCapabilities() : null;

  useEffect(() => {
    // El banco no es parte del producto: exponer esto permite seguir una corrida de
    // horas desde la consola, y leer los resultados aunque la interfaz se pierda.
    (window as unknown as Record<string, unknown>).__bench = {
      loadRun, deleteRun, buildReport, MODELS, runBench, loadCorpus,
    };
    void detectDevice().then(setDevice);
    void loadCorpus()
      .then(setManifest)
      .catch((e: Error) => setCorpusError(e.message));
  }, []);

  const start = useCallback(async () => {
    if (!manifest) return;
    // El id lleva la etiqueta del equipo: la matriz se corre en dos máquinas y los
    // resultados no se deben mezclar.
    const id = `${label || 'equipo'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
    setRunId(id);
    setRunning(true);
    setLog([]);
    abortRef.current = new AbortController();

    try {
      await runBench({
        runId: id,
        corpus: manifest.items,
        levels,
        models: MODELS.filter((m) => modelKeys.includes(m.key)),
        backends,
        verifyHashes: true,
        signal: abortRef.current.signal,
        onProgress: (e) => setLog((l) => [...l.slice(-200), e]),
      });
    } catch (e) {
      setLog((l) => [
        ...l,
        {
          phase: 'done',
          message: `Corrida abortada: ${e instanceof Error ? e.message : String(e)}`,
          completed: 0,
          total: 0,
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [manifest, label, levels, modelKeys, backends]);

  const download = useCallback(async () => {
    if (!runId) return;
    const run = await loadRun(runId);
    if (!run) return;
    if (label) run.device.label = label;
    const md = buildReport(run, manifest ?? undefined);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = reportFilename(run);
    a.click();
    URL.revokeObjectURL(a.href);
  }, [runId, manifest, label]);

  const last = log[log.length - 1];
  const pct = last && last.total > 0 ? Math.round((last.completed / last.total) * 100) : 0;

  return (
    <main className="mx-auto max-w-4xl p-6 font-mono text-sm">
      <h1 className="mb-1 text-2xl font-bold">Banco E0</h1>
      <p className="mb-6 text-neutral-500">
        Mide RTF, memoria y WER de {MODELS.length} modelos × {BACKENDS.length} backends.
        No es parte del producto.
      </p>

      <section className="mb-6 rounded border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-bold">Equipo</h2>
        {device ? (
          <ul className="space-y-1 text-neutral-600 dark:text-neutral-400">
            <li>
              WebGPU:{' '}
              <strong className={device.webgpuAvailable ? 'text-green-700' : 'text-red-700'}>
                {device.webgpuAvailable ? 'disponible' : 'NO disponible — sólo se mide WASM'}
              </strong>
            </li>
            {device.gpuAdapter && <li>Adaptador: {device.gpuAdapter}</li>}
            <li>Núcleos: {device.hardwareConcurrency ?? '—'}</li>
            <li>Memoria declarada: {device.deviceMemoryGB ? `${device.deviceMemoryGB} GB` : '—'}</li>
            <li>Medición de memoria: {mem?.note}</li>
          </ul>
        ) : (
          <p>Detectando…</p>
        )}
        <label className="mt-3 block">
          Etiqueta del equipo{' '}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="p. ej. principal / modesto"
            className="ml-2 rounded border border-neutral-400 px-2 py-1"
          />
        </label>
      </section>

      <section className="mb-6 rounded border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-bold">Corpus</h2>
        {manifest ? (
          <>
            <p>
              Versión <strong>{manifest.version}</strong> — {describeCorpus(manifest)}
            </p>
            <fieldset className="mt-3">
              <legend className="mb-1 text-neutral-500">Niveles a correr</legend>
              {(['A', 'B'] as const).map((lv) => {
                const items = manifest.items.filter((i) => i.level === lv);
                const min = items.reduce((a, i) => a + i.durationSec, 0) / 60;
                const hours = (min * 12) / 60;
                return (
                  <label key={lv} className="mr-5 inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={levels.includes(lv)}
                      onChange={(e) =>
                        setLevels((prev) =>
                          e.target.checked ? [...prev, lv] : prev.filter((x) => x !== lv),
                        )
                      }
                    />
                    <span>
                      {lv} — {items.length} ítems, {min.toFixed(1)} min
                      <span className="text-neutral-500">
                        {' '}(~{hours.toFixed(1)} h de matriz con RTF 1)
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </>
        ) : corpusError ? (
          <p className="whitespace-pre-wrap text-red-700">{corpusError}</p>
        ) : (
          <p>Cargando…</p>
        )}
      </section>

      <section className="mb-6 rounded border border-neutral-300 p-4 dark:border-neutral-700">
        <h2 className="mb-2 font-bold">Alcance</h2>
        <fieldset className="mb-3">
          <legend className="mb-1 text-neutral-500">Modelos</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {MODELS.map((m) => (
              <label key={m.key} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={modelKeys.includes(m.key)}
                  onChange={(e) =>
                    setModelKeys((prev) =>
                      e.target.checked ? [...prev, m.key] : prev.filter((x) => x !== m.key),
                    )
                  }
                />
                <span>
                  {m.key}
                  <span className="text-neutral-500"> ~{m.approxMB} MB</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex gap-3 text-neutral-500">
            <button type="button" className="underline" onClick={() => setModelKeys(MODELS.map((m) => m.key))}>todos</button>
            <button type="button" className="underline" onClick={() => setModelKeys(['whisper-tiny'])}>sólo tiny</button>
            <button type="button" className="underline" onClick={() => setModelKeys([])}>ninguno</button>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-neutral-500">Backends</legend>
          {BACKENDS.map((b) => (
            <label key={b} className="mr-5 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={backends.includes(b)}
                onChange={(e) =>
                  setBackends((prev) =>
                    e.target.checked ? [...prev, b] : prev.filter((x) => x !== b),
                  )
                }
              />
              <span>{b}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <div className="mb-6 flex flex-wrap gap-3">
        <button
          onClick={start}
          disabled={!manifest || running || modelKeys.length === 0 || backends.length === 0}
          className="rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40"
        >
          {running ? `Midiendo… ${pct} %` : 'Arrancar la matriz'}
        </button>
        <button
          onClick={() => abortRef.current?.abort()}
          disabled={!running}
          className="rounded border border-neutral-400 px-4 py-2 disabled:opacity-40"
        >
          Detener
        </button>
        <button
          onClick={download}
          disabled={!runId}
          className="rounded border border-neutral-400 px-4 py-2 disabled:opacity-40"
        >
          Bajar resultados.md
        </button>
        <button
          onClick={() => runId && deleteRun(runId)}
          disabled={!runId || running}
          className="rounded border border-red-400 px-4 py-2 text-red-700 disabled:opacity-40"
        >
          Borrar corrida
        </button>
      </div>

      {runId && (
        <p className="mb-3 text-neutral-500">
          Corrida <code>{runId}</code>. Cada resultado se guarda apenas termina: si la GPU
          se cae, volvé a arrancar con la misma etiqueta y retoma donde iba.
        </p>
      )}

      <section className="h-80 overflow-auto rounded border border-neutral-300 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900">
        {log.length === 0 ? (
          <p className="text-neutral-500">Sin actividad.</p>
        ) : (
          <ol className="space-y-0.5">
            {log.map((e, i) => (
              <li key={i} className="text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-400">
                  [{String(e.completed).padStart(3, '0')}/{e.total}]
                </span>{' '}
                {e.message}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
