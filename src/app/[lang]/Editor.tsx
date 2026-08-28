'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimedText } from '@/lib/vad/align';
import { toCues, toSrt, toVtt, toPlainText } from '@/lib/export/subtitles';
import { toCsv } from '@/lib/export/csv';
import { DESCARGA_MB as TRADUCCION_MB } from '@/lib/translate/translator';
import { layoutTranscript } from '@/lib/export/document';
import { colorDeHablante, ordenDeAparicion } from '@/lib/diar/colores';
import { Boton, Chip, Tarjeta } from '@/components/ui';
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
  /** La traducción, si se pidió. `null` mientras no exista. */
  traduccion: TimedText[] | null;
  /** En qué estado está: `null` si no se está traduciendo. */
  traduciendo: { done: number; total: number } | null;
  /** `null` si el idioma del audio no se sabe o coincide con el destino. */
  puedeTraducir: { destino: string; etiqueta: string } | null;
  onTraducir: () => void;
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
  traduccion,
  traduciendo,
  puedeTraducir,
  onTraducir,
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
  /**
   * Qué se está mirando.
   *
   * El original **nunca se pisa**: se alterna. Si la traducción reemplazara al original no
   * habría con qué comparar, y comparar es lo único que puede salvar a alguien de publicar
   * una frase que dice otra cosa.
   */
  const [viendoTraduccion, setViendoTraduccion] = useState(false);
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

  // Lo que se ve y lo que se descarga son lo mismo: exportar algo distinto de lo que está en
  // pantalla es la forma más rápida de que alguien publique una traducción creyendo que
  // bajó el original.
  const mostrados = viendoTraduccion && traduccion ? traduccion : segments;

  /** El modelo del documento, compartido por DOCX y PDF para que no se separen. */
  const modelo = useCallback(
    () =>
      layoutTranscript(mostrados, {
        fileName,
        durationHuman: humanDuration(segments.at(-1)?.endSec ?? 0, lang),
        labels: { title: t.editor.docTitle, subtitle: t.editor.docSubtitle },
      }),
    // `mostrados` va en las dependencias: sin él, el DOCX y el PDF exportarían el original
    // con la traducción a la vista, que es exactamente lo que el resto del diseño evita.
    [mostrados, segments, fileName, lang, t],
  );

  // Los hablantes, en orden de aparicion: a quien habla primero le toca siempre el primer
  // color, asi la pantalla se lee igual entre archivos.
  const hablantes = ordenDeAparicion(segments.map((s) => s.speaker));
  const colorDe = (nombre: string | undefined) =>
    nombre === undefined ? null : colorDeHablante(hablantes.indexOf(nombre));

  const conTexto = mostrados.filter((s) => s.text.trim());
  const palabras = conTexto.reduce((a, s) => a + s.text.trim().split(/\s+/).length, 0);
  const hablaSec = mostrados.reduce((a, s) => a + Math.max(0, s.endSec - s.startSec), 0);

  return (
    <section className="space-y-4">
      {/*
        El aviso de omisión. Es la razón de fondo por la que E2 incorporó el detector de
        voz: el modelo puede saltarse un tramo entero y devolver algo fluido, y sin
        comparar contra el habla detectada nadie lo notaría.
      */}
      {suspicious && (
        <Tarjeta as="div" tono="advertencia" relleno="compacto" className="text-sm">
          <p className="font-medium text-advertencia-titulo">{t.omission.title}</p>
          <p className="mt-1 text-advertencia-texto">{t.omission.body}</p>
        </Tarjeta>
      )}

      {/*
        El control de traducción y su advertencia. La advertencia tiene el mismo peso visual
        que el aviso de omisión, y por la misma razón: es lo que separa una herramienta que
        avisa de una que deja publicar algo falso sin decir nada.
      */}
      {puedeTraducir && (
        <div className="space-y-2">
          {!traduccion && !traduciendo && (
            <Boton onClick={onTraducir} className="text-sm">
              {t.translate.label} {t.translate.to(puedeTraducir.etiqueta)} ·{' '}
              {t.translate.button(TRADUCCION_MB)}
            </Boton>
          )}
          {traduciendo && (
            <p className="text-sm text-apagado">
              {t.translate.running(traduciendo.done, traduciendo.total)}
            </p>
          )}
          {traduccion && (
            <>
              <Tarjeta as="div" tono="advertencia-fuerte" relleno="compacto" className="text-sm">
                <p className="font-medium text-advertencia-titulo">
                  {t.translate.warningTitle}
                </p>
                <p className="mt-1 text-advertencia-texto">
                  {t.translate.warningBody}
                </p>
              </Tarjeta>
              <Boton
                tamano="chico"
                onClick={() => setViendoTraduccion((v) => !v)}
                className="text-sm"
              >
                {viendoTraduccion ? t.translate.showOriginal : t.translate.showTranslation}
              </Boton>
            </>
          )}
        </div>
      )}

      {audioUrl &&
        (mediaKind === 'video' ? (
          <video
            ref={audioRef as React.RefObject<HTMLVideoElement>}
            src={audioUrl}
            controls
            preload="metadata"
            className="max-h-80 w-full rounded-caja-chica bg-black"
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
        <span className="text-sm text-apagado">
          {t.result.words(palabras)}
          {' · '}
          {t.detect.found(mostrados.length, humanDuration(hablaSec, lang))}
        </span>
      </div>
      {audioUrl ? (
        <p className="text-sm text-apagado">{t.editor.hint}</p>
      ) : (
        <p className="text-sm text-apagado">{t.store.audioTooBig}</p>
      )}

      {hablantes.length > 0 && (
        <Tarjeta as="div" relleno="compacto" className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t.speakers.found(hablantes.length)}</span>
            {hablantes.map((h, i) => (
              <Chip
                key={h}
                forma="pastilla"
                className={`${colorDeHablante(i).fondo} ${colorDeHablante(i).texto}`}
              >
                <span className={`h-2 w-2 rounded-full ${colorDeHablante(i).barra}`} />
                {h}
              </Chip>
            ))}
          </div>
          {onRenameSpeaker && <p className="text-xs text-apagado">{t.speakers.rename}</p>}
          {/* Lo que la separacion NO hace, dicho donde se ve el resultado y no escondido en
              la documentacion. */}
          <p className="text-xs text-apagado">{t.speakers.caveat}</p>
        </Tarjeta>
      )}

      <Tarjeta as="ol" relleno="ninguno" className="divide-y divide-borde overflow-hidden">
        {mostrados.map((s, i) => (
          <li
            key={`${i}-${s.startSec}`}
            className={`flex gap-3 p-3 transition-colors ${
              i === activo ? 'bg-acento-fondo' : ''
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
              className="shrink-0 pt-0.5 font-mono text-xs text-acento-tinta hover:underline disabled:text-deshabilitado disabled:no-underline"
            >
              {formatClock(s.startSec)}
            </button>
            <div className="flex-1">
              {/* El nombre solo cuando cambia: repetirlo en cada tramo llenaria la columna
                  y el ojo dejaria de verlo. */}
              {s.speaker !== undefined && s.speaker !== segments[i - 1]?.speaker && (
                <span
                  contentEditable={!!onRenameSpeaker}
                  role={onRenameSpeaker ? 'textbox' : undefined}
                  aria-label={onRenameSpeaker ? t.speakers.rename : undefined}
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const nuevo = (e.currentTarget.textContent ?? '').trim();
                    if (nuevo && nuevo !== s.speaker) onRenameSpeaker?.(s.speaker!, nuevo);
                    else e.currentTarget.textContent = s.speaker!;
                  }}
                  className={`mb-0.5 block text-sm font-medium outline-none focus:rounded focus:ring-2 focus:ring-foco ${colorDe(s.speaker)?.texto ?? ''}`}
                >
                  {s.speaker}
                </span>
              )}
              <span
                // No se edita con la traducción a la vista: se confundiría qué se está
                // corrigiendo, y el editor guarda sobre el original.
                contentEditable={!viendoTraduccion}
                // Sin nombre, el lector de pantalla anuncia «editable» y nada más: ni de
                // qué tramo se trata ni a qué minuto del audio corresponde. Con el tiempo
                // adentro del nombre, quien no ve la pantalla puede ubicarse igual que
                // quien la ve.
                role={viendoTraduccion ? undefined : 'textbox'}
                aria-label={viendoTraduccion ? undefined : t.editor.segmentLabel(formatClock(s.startSec))}
                suppressContentEditableWarning
                onBlur={(e) => {
                  const nuevo = e.currentTarget.textContent ?? '';
                  if (nuevo !== s.text) {
                    onEdit(i, nuevo);
                    setEditados((prev) => new Set(prev).add(i));
                  }
                }}
                className="block outline-none focus:rounded focus:bg-campo focus:ring-2 focus:ring-foco"
              >
                {s.text}
              </span>
            </div>
            {/*
              Con la traducción a la vista, el original va debajo. No es un adorno: es lo
              único que le permite a alguien notar que una frase dice otra cosa.
            */}
            {viendoTraduccion && segments[i] && (
              <span className="w-full shrink-0 pl-14 text-xs text-apagado">
                {t.translate.originalLabel}: {segments[i].text}
              </span>
            )}
            {editados.has(i) && (
              <span className="shrink-0 self-start text-xs text-apagado">
                {t.editor.edited}
              </span>
            )}
          </li>
        ))}
      </Tarjeta>

      {/*
        Los formatos van como grupo y no como una fila de botones sueltos: con cuatro ya
        competían entre sí por la atención, y en E3 se suman más. La acción es una sola
        —descargar— y el formato es el parámetro.
      */}
      {/*
        La barra de exportación queda **pegada al borde inferior**.
        Antes vivía al final del documento: con una reunión de una hora son cientos de
        tramos, así que descargar el SRT obligaba a recorrer toda la transcripción hasta
        el fondo. La acción no depende de dónde esté leyendo el usuario, así que no tiene
        por qué esperarlo ahí abajo.

        El fondo es opaco (`bg-fondo`) a propósito: translúcido, el texto de los tramos se
        vería pasar por detrás de los botones.
      */}
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-borde bg-fondo px-1 py-3">
        <Boton
          onClick={() => void navigator.clipboard.writeText(toPlainText(mostrados))}
          className="mr-2"
        >
          {t.result.copy}
        </Boton>
        <span className="text-sm text-apagado">{t.editor.downloadLabel}</span>
        {(
          [
            ['TXT', () => toPlainText(mostrados), 'txt', 'text/plain'],
            ['SRT', () => toSrt(toCues(mostrados)), 'srt', 'application/x-subrip'],
            ['VTT', () => toVtt(toCues(mostrados)), 'vtt', 'text/vtt'],
            ['CSV', () => toCsv(mostrados), 'csv', 'text/csv'],
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
          <Boton
            key={ext}
            tamano="ninguno"
            disabled={armando !== null}
            onClick={() => void descargar(generar, ext, mime)}
            className="px-3.5 py-1.5 font-mono text-sm"
          >
            {armando === ext ? '…' : nombre}
          </Boton>
        ))}
      </div>
      {armando && <p className="text-xs text-apagado">{t.editor.building}</p>}
      <p className="text-xs text-apagado">{t.editor.csvHint}</p>
    </section>
  );
}
