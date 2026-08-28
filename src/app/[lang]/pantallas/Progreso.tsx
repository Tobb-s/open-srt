import { Tarjeta } from '@/components/ui';
import { humanDuration, type dict, type Lang } from '@/lib/i18n';
import type { Phase } from '../useTranscripcion';

/**
 * El avance real de una transcripción en curso.
 *
 * **Sólo hay barra si hay un avance medido.** Sin eso se muestra el reloj de pared: fingir
 * una medición es exactamente lo que esta herramienta no hace.
 */
export function Progreso({
  t,
  lang,
  phase,
  tituloFase,
  pct,
  processedSec,
  durationSec,
  blockInfo,
  remainingText,
  elapsedSec,
  downloadPct,
  partial,
}: {
  t: ReturnType<typeof dict>;
  lang: Lang;
  phase: Phase;
  tituloFase: string;
  pct: number | undefined;
  processedSec: number | undefined;
  durationSec: number;
  blockInfo: { done: number; total: number } | null;
  remainingText: string;
  elapsedSec: number;
  downloadPct: number;
  partial: string;
}) {
  return (
    <Tarjeta className="space-y-3">
      {/*
        `role="status"` con `aria-live="polite"` hace que el lector de pantalla anuncie cada
        cambio de fase —«Preparando el modelo», «Buscando dónde hay voz», «Transcribiendo»—
        sin interrumpir lo que esté leyendo. Sin esto, quien no ve la pantalla no se entera
        de que algo avanza; sólo sabe que hizo clic y no pasó nada.

        `aria-atomic` para que lea la frase entera y no sólo la palabra que cambió.
      */}
      <p className="font-medium" role="status" aria-live="polite" aria-atomic="true">
        {tituloFase}
      </p>

      {(phase === 'detecting' || phase === 'transcribing') && (
        <>
          {pct !== undefined ? (
            <>
              <div
                className="h-2 overflow-hidden rounded-full bg-pista"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={tituloFase}
              >
                <div
                  className="h-full bg-acento transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-sm text-apagado">
                {t.run.processed(
                  humanDuration(processedSec!, lang),
                  humanDuration(durationSec, lang),
                )}
                {/* Con bloques el avance no se estima: se cuenta. */}
                {blockInfo && ` · ${t.run.blocks(blockInfo.done, blockInfo.total)}`}
                {remainingText && ` · ${t.run.remaining(remainingText)}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-apagado">
              {t.run.elapsed(humanDuration(elapsedSec, lang))}
            </p>
          )}
        </>
      )}

      {(phase === 'downloading' || phase === 'detector' || phase === 'embedder') && (
        <div
          className="h-2 overflow-hidden rounded-full bg-pista"
          role="progressbar"
          aria-valuenow={Math.round(downloadPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={tituloFase}
        >
          <div
            className="h-full bg-apagado transition-[width]"
            style={{ width: `${downloadPct}%` }}
          />
        </div>
      )}

      {partial && (
        <p className="max-h-40 overflow-y-auto rounded-detalle bg-superficie p-3 text-sm text-tinta-2">
          {partial}
        </p>
      )}
      {phase === 'transcribing' && <p className="text-xs text-apagado">{t.resume.saving}</p>}
    </Tarjeta>
  );
}
