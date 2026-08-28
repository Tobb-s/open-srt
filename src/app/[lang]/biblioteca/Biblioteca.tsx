'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boton, Chip, Tarjeta } from '@/components/ui';
import { APP_NAME, dict, humanBytes, humanDuration, type Lang } from '@/lib/i18n';
import { useBiblioteca } from './useBiblioteca';

/**
 * Todo lo que quedó guardado en este equipo.
 *
 * ── Qué resuelve ──
 *
 * Los datos existían desde E2 y no había pantalla: con diez archivos en cola, nueve
 * transcripciones quedaban invisibles y sólo se ofrecía «restaurar la última». Acá están
 * todas, con lo que ocupan, y se pueden abrir, renombrar, borrar y bajar juntas.
 *
 * ── Por qué se ve cuánto ocupa cada una ──
 *
 * Porque el audio es lo único grande —el texto son 175 bytes por tramo, medido— y porque el
 * usuario no puede decidir qué borrar si no sabe qué pesa. El número sale de `blob.size`,
 * que es exacto, y no de `navigator.storage.estimate()`, que en este equipo sube al escribir
 * pero **no baja al borrar** ni a los veinte segundos.
 */
export default function Biblioteca({ lang }: { lang: Lang }) {
  const t = dict(lang);
  const b = useBiblioteca();
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState('');

  const fecha = (ms: number) =>
    new Date(ms).toLocaleDateString(lang === 'es' ? 'es-AR' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6 sm:gap-8 sm:px-6 sm:py-12">
      <header className="flex items-start justify-between gap-6">
        <div>
          <Link href={`/${lang}`} className="text-sm font-medium tracking-tight text-apagado">
            {APP_NAME}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {t.library.title}
          </h1>
          {b.filas !== null && b.filas.length > 0 && (
            <p className="mt-2 text-sm text-apagado">
              {t.library.summary(b.filas.length, humanBytes(b.bytesGuardados, lang))}
            </p>
          )}
        </div>
        <Link
          href={`/${lang}`}
          className="shrink-0 pt-1 text-sm underline underline-offset-4"
        >
          {t.drop.button}
        </Link>
      </header>

      {/* Nada todavía. Se dice dónde queda lo que se transcriba, no sólo que está vacío. */}
      {b.filas !== null && b.filas.length === 0 && b.corridas.length === 0 && (
        <Tarjeta className="space-y-1">
          <p className="font-medium">{t.library.empty}</p>
          <p className="text-sm text-apagado">{t.library.emptyHint}</p>
        </Tarjeta>
      )}

      {/*
        Las transcripciones a medias. Existían en la tabla `runs` desde E5 y sólo aparecían
        si el usuario volvía a elegir exactamente el mismo archivo: acá se ven siempre.
      */}
      {b.corridas.length > 0 && (
        <Tarjeta relleno="compacto" className="space-y-2">
          <h2 className="font-medium">{t.library.unfinished}</h2>
          <ol className="divide-y divide-borde text-sm">
            {b.corridas.map((c) => (
              <li key={c.fileKey} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1 truncate">{c.fileName}</span>
                <Chip tono="apagado">
                  {t.library.unfinishedAt(
                    Math.round((c.doneBlocks / Math.max(1, c.blocks.length)) * 100),
                  )}
                </Chip>
                <Boton
                  variante="sutil"
                  tamano="ninguno"
                  onClick={() => void b.descartarCorrida(c.fileKey)}
                  className="px-2 py-1 text-apagado underline underline-offset-2"
                >
                  {t.resume.discard}
                </Boton>
              </li>
            ))}
          </ol>
        </Tarjeta>
      )}

      {b.filas !== null && b.filas.length > 0 && (
        <>
          <Tarjeta as="ol" relleno="ninguno" className="divide-y divide-borde overflow-hidden">
            {b.filas.map(({ session, audioBytes }) => (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  {renombrando === session.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void b.renombrar(session.id, borrador);
                        setRenombrando(null);
                      }}
                    >
                      <label className="sr-only" htmlFor={`n-${session.id}`}>
                        {t.library.renamePrompt}
                      </label>
                      <input
                        id={`n-${session.id}`}
                        autoFocus
                        value={borrador}
                        onChange={(e) => setBorrador(e.target.value)}
                        onBlur={() => setRenombrando(null)}
                        className="w-full rounded-detalle border border-borde-fuerte bg-campo px-2 py-1"
                      />
                    </form>
                  ) : (
                    <p className="truncate font-medium">{session.fileName}</p>
                  )}
                  <p className="mt-0.5 text-xs text-apagado">
                    {fecha(session.createdAt)}
                    {' · '}
                    {humanDuration(session.durationSec, lang)}
                    {' · '}
                    {t.library.segments(session.segmentCount)}
                    {' · '}
                    {audioBytes === undefined
                      ? session.audioMotivo === 'liberado'
                        ? t.library.freedAudio
                        : t.library.noAudio
                      : t.library.size(humanBytes(audioBytes, lang))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/${lang}?abrir=${encodeURIComponent(session.id)}`}
                    className="rounded-full border border-borde-fuerte px-4 py-1.5 text-sm hover:bg-superficie-2"
                  >
                    {t.library.open}
                  </Link>
                  <Boton
                    variante="sutil"
                    tamano="ninguno"
                    onClick={() => {
                      setBorrador(session.fileName);
                      setRenombrando(session.id);
                    }}
                    className="px-2 py-1 text-sm text-apagado underline underline-offset-2"
                  >
                    {t.library.rename}
                  </Boton>
                  {audioBytes !== undefined && (
                    <Boton
                      variante="sutil"
                      tamano="ninguno"
                      onClick={() => {
                        if (
                          confirm(
                            t.library.freeAudioConfirm(
                              session.fileName,
                              humanBytes(audioBytes, lang),
                            ),
                          )
                        ) {
                          void b.soltarAudio(session.id);
                        }
                      }}
                      className="px-2 py-1 text-sm text-apagado underline underline-offset-2"
                    >
                      {t.library.freeAudio}
                    </Boton>
                  )}
                  <Boton
                    variante="sutil"
                    tamano="ninguno"
                    onClick={() => {
                      // Borrar el audio de una reunión no se deshace y no hay papelera:
                      // preguntar es lo mínimo.
                      if (confirm(t.library.removeConfirm(session.fileName))) {
                        void b.borrar(session.id);
                      }
                    }}
                    className="px-2 py-1 text-sm text-error underline underline-offset-2"
                  >
                    {t.library.remove}
                  </Boton>
                </div>
              </li>
            ))}
          </Tarjeta>

          <div className="flex flex-wrap items-center gap-3">
            <Boton onClick={() => void b.descargarTodas()} disabled={!!b.empaquetando}>
              {b.empaquetando
                ? t.library.exporting(b.empaquetando.hechos, b.empaquetando.total)
                : t.library.exportAll}
            </Boton>
            <span className="text-sm text-apagado">{t.library.exportAllHint}</span>
          </div>
        </>
      )}

      {/*
        Cuánto queda. Se dice **antes** de que se llene, no después: el aviso de que el audio
        no entró llega cuando ya pasó, y para entonces el usuario no puede hacer nada.
      */}
      {b.cuota && b.cuota.total > 0 && (
        <p className="text-xs text-apagado">
          {t.library.quota(humanBytes(b.cuota.usado, lang), humanBytes(b.cuota.total, lang))}
          {b.cuota.usado / b.cuota.total > 0.8 && ` · ${t.library.quotaTight}`}
        </p>
      )}
    </main>
  );
}
