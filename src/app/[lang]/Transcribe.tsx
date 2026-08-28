'use client';

import { Boton } from '@/components/ui';
import { dict, type Lang } from '@/lib/i18n';
import { useTranscripcion } from './useTranscripcion';
import { Encabezado, Pie, type Momento } from './pantallas/Marco';
import { Ajustes } from './pantallas/Ajustes';
import { AvisoDeSesion } from './pantallas/AvisoDeSesion';
import { ListaDeCola } from './pantallas/ListaDeCola';
import { ZonaDeArchivo } from './pantallas/ZonaDeArchivo';
import { ArchivoListo } from './pantallas/ArchivoListo';
import { Progreso } from './pantallas/Progreso';
import { Resultado } from './pantallas/Resultado';

/**
 * La pantalla: **un momento por vez**.
 *
 * ── Qué cambió en el paso 3 ──
 *
 * Antes, la página mostraba a la vez todo lo que podía llegar a pasar: seis secciones
 * apiladas con el mismo peso visual —panel del equipo, sesión anterior, cola, zona de
 * soltar, privacidad, pie— y el usuario tenía que decidir dónde mirar. Medido: 1264 px de
 * página en un teléfono cuyo único trabajo, en ese instante, es elegir un archivo.
 *
 * Ahora hay **cuatro momentos** y en cada uno manda una sola cosa:
 *
 * | Momento | Manda | Qué se calla |
 * |---|---|---|
 * | `soltar` | la zona de soltar | ajustes y privacidad, plegados |
 * | `preparar` | el archivo elegido y su costo | la zona de soltar, ya cumplió |
 * | `trabajando` | el avance | todo lo demás |
 * | `leer` | la transcripción | encabezado encogido, sin panel ni privacidad |
 *
 * ── Por qué el encabezado y el pie viven acá ──
 *
 * Porque también son parte del momento. `page.tsx` los dibujaba siempre iguales, así que
 * en la pantalla de resultado había doscientos píxeles de promesa de marketing entre el
 * usuario y su transcripción. Para que puedan encogerse tienen que ver el estado, y el
 * estado vive en este árbol.
 */
export default function Transcribe({ lang }: { lang: Lang }) {
  const t = dict(lang);
  const v = useTranscripcion(lang);

  const momento: Momento =
    v.phase === 'done' && v.sesion
      ? 'leer'
      : v.busy
        ? 'trabajando'
        : (v.file && v.phase === 'ready') || v.phase === 'decoding'
          ? 'preparar'
          : 'soltar';

  const tituloFase =
    v.phase === 'downloading'
      ? t.run.downloading(v.downloadPct)
      : v.phase === 'loading'
        ? t.run.loading
        : v.phase === 'detector'
          ? t.detect.loading
          : v.phase === 'detecting'
            ? t.detect.running
            : v.phase === 'embedder'
              ? t.speakers.loading
              : v.phase === 'diarizing'
                ? t.speakers.running(v.avanceHablantes?.done ?? 0, v.avanceHablantes?.total ?? 0)
                : t.run.transcribing;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6 sm:gap-8 sm:px-6 sm:py-12">
      <Encabezado t={t} lang={lang} momento={momento} />

      {/* Una transcripción de una visita anterior. Se ofrece, no se impone. */}
      {v.pendiente && !v.sesion && !v.busy && (
        <AvisoDeSesion
          t={t}
          pendiente={v.pendiente}
          onAbrir={() => void v.restaurar()}
          onDescartar={() => void v.borrarTodo()}
        />
      )}

      {/* Con un solo archivo la lista sería de un elemento, que es ruido. */}
      {v.cola.length > 1 && (
        <ListaDeCola t={t} cola={v.cola} onAbrir={(id) => void v.abrirDeLaCola(id)} />
      )}

      {momento === 'soltar' && (
        <>
          <ZonaDeArchivo t={t} onFiles={(fs) => void v.onFiles(fs)} />
          <Ajustes
            t={t}
            comprobando={v.phase === 'checking'}
            selection={v.selection}
            profile={v.profile}
            busy={v.busy}
            onElegirAlternativa={v.setProfile}
          />
        </>
      )}

      {/*
        Decodificar un mp4 de dos horas tarda unos segundos y hasta el paso 5 la pantalla
        decía sólo «…». Un punto suspensivo no informa: ahora dice qué está pasando, y lo
        anuncia también para quien no ve la pantalla.
      */}
      {v.phase === 'decoding' && (
        <p className="text-apagado" role="status" aria-live="polite">
          {t.editor.decoding}
        </p>
      )}

      {momento === 'preparar' && v.file && v.phase === 'ready' && v.profile && (
        <ArchivoListo
          t={t}
          lang={lang}
          nombre={v.file.name}
          durationSec={v.file.durationSec}
          fileKey={v.file.key}
          profile={v.profile}
          audioLang={v.audioLang}
          onAudioLang={v.setAudioLang}
          separarHablantes={v.separarHablantes}
          onSepararHablantes={v.setSepararHablantes}
          corrida={v.corrida}
          onEmpezar={() => v.file && void v.procesarCola(v.file, null)}
          onRetomar={() => v.file && void v.procesarCola(v.file, v.corrida)}
          onDescartarCorrida={v.descartarCorrida}
          onOtroArchivo={v.reset}
        />
      )}

      {momento === 'trabajando' && v.file && (
        <Progreso
          t={t}
          lang={lang}
          phase={v.phase}
          tituloFase={tituloFase}
          pct={v.pct}
          processedSec={v.processedSec}
          durationSec={v.file.durationSec}
          blockInfo={v.blockInfo}
          remainingText={v.remainingText}
          elapsedSec={v.elapsedSec}
          downloadPct={v.downloadPct}
          partial={v.partial}
        />
      )}

      {v.degraded && (
        <p className="rounded-detalle bg-advertencia-fondo p-3 text-sm text-advertencia-titulo">
          {v.degraded.replace(/\*\*/g, '')}
        </p>
      )}

      {momento === 'leer' && v.sesion && (
        <Resultado
          t={t}
          lang={lang}
          sesion={v.sesion}
          traduccion={v.traduccion}
          traduciendo={v.traduciendo}
          puedeTraducir={
            // Sólo cuando se sabe de qué idioma viene: con «Detectar» no se sabe, y
            // elegir un par al azar traduciría desde un idioma equivocado sin avisar.
            v.audioLang === 'auto'
              ? null
              : {
                  destino: v.audioLang === 'es' ? 'en' : 'es',
                  etiqueta: v.audioLang === 'es' ? t.file.audioLangEn : t.file.audioLangEs,
                }
          }
          aviso={v.aviso}
          onTraducir={() => void v.traducir()}
          onEdit={v.onEdit}
          onRenameSpeaker={v.onRenameSpeaker}
          onOtroArchivo={v.reset}
          onBorrarTodo={() => void v.borrarTodo()}
        />
      )}

      {/*
        El error es lo único que interrumpe: `role="alert"` lo anuncia de inmediato, sin
        esperar a que el lector de pantalla termine lo que estaba leyendo. Es la excepción
        al `polite` del resto — un fallo que nadie escucha es un fallo que nadie atiende.
      */}
      {v.error && (
        <section className="space-y-3" role="alert">
          <p className="rounded-detalle bg-error-fondo p-4 text-error-texto">{v.error}</p>
          <Boton
            variante="sutil"
            tamano="ninguno"
            onClick={v.reset}
            className="text-sm underline underline-offset-2"
          >
            {t.result.newFile}
          </Boton>
        </section>
      )}

      <Pie t={t} momento={momento} />
    </main>
  );
}
