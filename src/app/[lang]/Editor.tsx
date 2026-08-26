'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimedText } from '@/lib/vad/align';
import { toCues, toSrt, toVtt, toPlainText } from '@/lib/export/subtitles';
import { toCsv } from '@/lib/export/csv';
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
}: Props) {
  const t = dict(lang);
  // `HTMLMediaElement` y no `HTMLAudioElement`: `currentTime`, `play()` y `timeupdate` son
  // de la clase base, así que el resto del componente no distingue audio de video.
  const audioRef = useRef<HTMLMediaElement>(null);
  const [activo, setActivo] = useState<number>(-1);
  const [editados, setEditados] = useState<ReadonlySet<number>>(editedInitially ?? new Set());

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
    (contenido: string, extension: string, mime: string) => {
      const blob = new Blob([contenido], { type: `${mime};charset=utf-8` });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName.replace(/\.[^.]+$/, '')}.${extension}`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    [fileName],
  );

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

      <ol className="divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {segments.map((s, i) => (
          <li
            key={`${i}-${s.startSec}`}
            className={`flex gap-3 p-3 transition-colors ${
              i === activo ? 'bg-blue-50 dark:bg-blue-950/40' : ''
            }`}
          >
            <button
              onClick={() => saltarA(s.startSec)}
              disabled={!audioUrl}
              // El tiempo es un botón, no un adorno: es el atajo para verificar la línea.
              title={`${formatClock(s.startSec)} → ${formatClock(s.endSec)}`}
              className="shrink-0 pt-0.5 font-mono text-xs text-blue-700 hover:underline disabled:text-neutral-400 disabled:no-underline dark:text-blue-400"
            >
              {formatClock(s.startSec)}
            </button>
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
              className="flex-1 outline-none focus:rounded focus:bg-white focus:ring-2 focus:ring-blue-500 dark:focus:bg-neutral-900"
            >
              {s.text}
            </span>
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
          ] as const
        ).map(([nombre, generar, ext, mime]) => (
          <button
            key={ext}
            onClick={() => descargar(generar(), ext, mime)}
            className="rounded-full border border-neutral-300 px-3.5 py-1.5 font-mono text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {nombre}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-400">{t.editor.csvHint}</p>
    </section>
  );
}
