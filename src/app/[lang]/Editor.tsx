'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimedText } from '@/lib/vad/align';
import { toCues, toSrt, toVtt, toPlainText } from '@/lib/export/subtitles';
import { toCsv } from '@/lib/export/csv';
import { layoutTranscript } from '@/lib/export/document';
import { colorDeHablante, ordenDeAparicion } from '@/lib/diar/colores';
import { dict, humanDuration, type Lang } from '@/lib/i18n';

/**
 * El editor: la transcripción con sus tiempos, sincronizada con el audio.
 *
 * Lo que lo hace útil no es mostrar el texto sino **poder verificarlo**. Una transcripción
 * automática siempre tiene errores; lo que decide si sirve es qué tan rápido se puede
 * saltar al audio de una línea dudosa y corregirla. Por eso el tiempo es un botón que
 * lleva al audio y el texto se edita en el lugar.
 */

interface Props {
  lang: Lang;
  segments: TimedText[];
  /** Si hay motivos para sospechar que el modelo omitió contenido. */
  suspicious: boolean;
  /**
   * `null` cuando el audio no está disponible — una sesión recuperada cuyo audio no entró
   * en la cuota del navegador. El texto se edita igual; lo que falta es poder escucharlo.
   */
  audioUrl: string | null;
  /**
   * Si la fuente es un video, se muestra la imagen además de oírse.
   *
   * En una reunión grabada, ver quién habla y qué hay en pantalla es la mitad del trabajo de
   * verificar una línea dudosa. Un `<audio>` sobre un mp4 reproduce igual, pero tira a la
   * basura información que el archivo ya trae.
   */
  mediaKind: 'audio' | 'video';
  fileName: string;
  /** Qué índices ya venían corregidos a mano (de una sesión recuperada). */
  editedInitially?: ReadonlySet<number>;
  onEdit: (index: number, text: string) => void;
  /**
   * Renombrar un hablante en **todos** sus tramos a la vez.
   *
   * `undefined` cuando no se separaron hablantes. Corregir tramo por tramo seria inaceptable
   * en una reunion de una hora, y ademas es como se unen dos hablantes que el modelo partio:
   * poniendoles el mismo nombre.
   */
  onRenameSpeaker?: (anterior: string, nuevo: string) => void;
}

function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export default function Editor({
  lang,
  segments,
  suspicious,
  audioUrl,
  mediaKind,
  fileName,
  editedInitially,
  onEdit,
  onRenameSpeaker,
}: Props) {
  const t = dict(lang);
  // `HTMLMediaElement` y no `HTMLAudioElement`: `currentTime`, `play()` y `timeupdate` son
  // de la clase base, así que el resto del componente no distingue audio de video.
  const audioRef = useRef<HTMLMediaElement>(null);
  const [activo, setActivo] = useState<number>(-1);
  const [editados, setEditados] = useState<ReadonlySet<number>>(editedInitially ?? new Set());
  const [armando, setArmando] = useState<string | null>(null);

  // Resaltar el tramo que suena. Se recalcula en cada `timeupdate`, que el navegador
  // dispara unas cuatro veces por segundo: suficiente para seguir el audio y poco como
  // para no castigar el hilo.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const ahora = el.currentTime;
      setActivo(segments.findIndex((s) => ahora >= s.startSec && ahora < s.endSec));
    };
    el.addEventListener('timeupdate', onTime);
    return () => el.removeEventListener('timeupdate', onTime);
  }, [segments]);

  const saltarA = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = sec;
    void el.play();
  }, []);

  const descargar = useCallback(
    async (
      generar: () => string | Promise<Blob>,
      extension: string,
      mime: string,
    ) => {
      // DOCX y PDF cargan su biblioteca al pedirla —cerca de un mega y medio entre las dos—,
      // así que tardan lo suficiente como para que haya que avisar. Los otros cuatro son
      // instantáneos y el aviso no llega a verse.
      setArmando(extension);
      try {
        const salida = await generar();
        const blob =
          typeof salida === 'string'
            ? new Blob([salida], { type: `${mime};charset=utf-8` })
            : salida;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${fileName.replace(/\.[^.]+$/, '')}.${extension}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } finally {
        setArmando(null);
      }
    },
    [fileName],
  );

  /** El modelo del documento, compartido por DOCX y PDF para que no se separen. */
  const modelo = useCallback(
    () =>
      layoutTranscript(segments, {
        fileName,
        durationHuman: humanDuration(segments.at(-1)?.endSec ?? 0, lang),
        labels: { title: t.editor.docTitle, subtitle: t.editor.docSubtitle },
      }),
    [segments, fileName, lang, t],
  );

  // Los hablantes, en orden de aparicion: a quien habla primero le toca siempre el primer
  // color, asi la pantalla se lee igual entre archivos.
  const hablantes = ordenDeAparicion(segments.map((s) => s.speaker));
  const colorDe = (nombre: string | undefined) =>
    nombre === undefined ? null : colorDeHablante(hablantes.indexOf(nombre));

  const conTexto = segments.filter((s) => s.text.trim());
  const palabras = conTexto.reduce((a, s) => a + s.text.trim().split(/\s+/).length, 0);
  const hablaSec = segments.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);

  return (
    <section className="space-y-4">
      {/*
        El aviso de omisión. Es la razón de fondo por la que E2 incorporó el detector de
        voz: el modelo puede saltarse un tramo entero y devolver algo fluido, y sin
        comparar contra el habla detectada nadie lo notaría.
      */}
      {suspicious && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">{t.omission.title}</p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">{t.omission.body}</p>
        </div>
      )}

      {audioUrl &&
        (mediaKind === 'video' ? (
          <video
            ref={audioRef as React.RefObject<HTMLVideoElement>}
            src={audioUrl}
            controls
            preload="metadata"
            className="max-h-80 w-full rounded-xl bg-black"
          />
        ) : (
          <audio
            ref={audioRef as React.RefObject<HTMLAudioElement>}
            src={audioUrl}
            controls
            preload="metadata"
            className="w-full"
          />
        ))}

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">{t.result.title}</h2>
        <span className="text-sm text-neutral-500">
          {t.result.words(palabras)}
          {' · '}
          {t.detect.found(segments.length, humanDuration(hablaSec, lang))}
        </span>
      </div>
      {audioUrl ? (
        <p className="text-sm text-neutral-500">{t.editor.hint}</p>
      ) : (
        <p className="text-sm text-neutral-500">{t.store.audioTooBig}</p>
      )}

      {hablantes.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t.speakers.found(hablantes.length)}</span>
            {hablantes.map((h, i) => (
              <span
                key={h}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${colorDeHablante(i).fondo} ${colorDeHablante(i).texto}`}
              >
                <span className={`h-2 w-2 rounded-full ${colorDeHablante(i).barra}`} />
                {h}
              </span>
            ))}
          </div>
          {onRenameSpeaker && <p className="text-xs text-neutral-500">{t.speakers.rename}</p>}
          {/* Lo que la separacion NO hace, dicho donde se ve el resultado y no escondido en
              la documentacion. */}
          <p className="text-xs text-neutral-400">{t.speakers.caveat}</p>
        </div>
      )}

      <ol className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {segments.map((s, i) => (
          <li
            key={`${i}-${s.startSec}`}
            className={`flex gap-3 p-3 transition-colors ${
              i === activo ? 'bg-blue-50 dark:bg-blue-950/40' : ''
            }`}
          >
            {/* La barra va en TODOS los tramos aunque el nombre solo aparezca al cambiar:
                es lo que permite ver de quien es una linea sin leerla. */}
            {s.speaker !== undefined && (
              <span
                aria-hidden
                className={`w-1 shrink-0 rounded-full ${colorDe(s.speaker)?.barra ?? ''}`}
              />
            )}
            <button
              onClick={() => saltarA(s.startSec)}
              disabled={!audioUrl}
              // El tiempo es un botón, no un adorno: es el atajo para verificar la línea.
              title={`${formatClock(s.startSec)} → ${formatClock(s.endSec)}`}
              className="shrink-0 pt-0.5 font-mono text-xs text-blue-700 hover:underline disabled:text-neutral-400 disabled:no-underline dark:text-blue-400"
            >
              {formatClock(s.startSec)}
            </button>
            <div className="flex-1">
              {/* El nombre solo cuando cambia: repetirlo en cada tramo llenaria la columna
                  y el ojo dejaria de verlo. */}
              {s.speaker !== undefined && s.speaker !== segments[i - 1]?.speaker && (
                <span
                  contentEditable={!!onRenameSpeaker}
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const nuevo = (e.currentTarget.textContent ?? '').trim();
                    if (nuevo && nuevo !== s.speaker) onRenameSpeaker?.(s.speaker!, nuevo);
                    else e.currentTarget.textContent = s.speaker!;
                  }}
                  className={`mb-0.5 block text-sm font-medium outline-none focus:rounded focus:ring-2 focus:ring-blue-500 ${colorDe(s.speaker)?.texto ?? ''}`}
                >
                  {s.speaker}
                </span>
              )}
              <span
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  const nuevo = e.currentTarget.textContent ?? '';
                  if (nuevo !== s.text) {
                    onEdit(i, nuevo);
                    setEditados((prev) => new Set(prev).add(i));
                  }
                }}
                className="block outline-none focus:rounded focus:bg-white focus:ring-2 focus:ring-blue-500 dark:focus:bg-neutral-900"
              >
                {s.text}
              </span>
            </div>
            {editados.has(i) && (
              <span className="shrink-0 self-start text-xs text-neutral-400">
                {t.editor.edited}
              </span>
            )}
          </li>
        ))}
      </ol>

      {/*
        Los formatos van como grupo y no como una fila de botones sueltos: con cuatro ya
        competían entre sí por la atención, y en E3 se suman más. La acción es una sola
        —descargar— y el formato es el parámetro.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void navigator.clipboard.writeText(toPlainText(segments))}
          className="mr-2 rounded-full border border-neutral-300 px-5 py-2 dark:border-neutral-700"
        >
          {t.result.copy}
        </button>
        <span className="text-sm text-neutral-500">{t.editor.downloadLabel}</span>
        {(
          [
            ['TXT', () => toPlainText(segments), 'txt', 'text/plain'],
            ['SRT', () => toSrt(toCues(segments)), 'srt', 'application/x-subrip'],
            ['VTT', () => toVtt(toCues(segments)), 'vtt', 'text/vtt'],
            ['CSV', () => toCsv(segments), 'csv', 'text/csv'],
            [
              'DOCX',
              async () => (await import('@/lib/export/docx')).toDocxBlob(modelo()),
              'docx',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
            [
              'PDF',
              async () => (await import('@/lib/export/pdf')).toPdfBlob(modelo()),
              'pdf',
              'application/pdf',
            ],
          ] as const
        ).map(([nombre, generar, ext, mime]) => (
          <button
            key={ext}
            disabled={armando !== null}
            onClick={() => void descargar(generar, ext, mime)}
            className="rounded-full border border-neutral-300 px-3.5 py-1.5 font-mono text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {armando === ext ? '…' : nombre}
          </button>
        ))}
      </div>
      {armando && <p className="text-xs text-neutral-500">{t.editor.building}</p>}
      <p className="text-xs text-neutral-400">{t.editor.csvHint}</p>
    </section>
  );
}
