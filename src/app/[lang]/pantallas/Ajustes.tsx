import type { Selection } from '@/lib/asr/capabilities';
import type { ModelProfile } from '@/lib/asr/models';
import { Boton } from '@/components/ui';
import type { dict } from '@/lib/i18n';

/**
 * Con qué va a trabajar el equipo. **Plegado**, salvo lo que no se puede plegar.
 *
 * ── Qué cambió y por qué ──
 *
 * Hasta el paso 3, esto era una tarjeta siempre abierta y era **lo primero** bajo el
 * título: «Calidad alta · Se va a usar turbo-webgpu · 850 MB de descarga». Tres problemas
 * en una línea: `turbo-webgpu` es la clave interna de `models.ts` y no significa nada
 * afuera del código; la descarga es un dato de la primera visita que se repetía en todas;
 * y ocupaba el lugar de la única acción que la pantalla tiene que ofrecer.
 *
 * Ahora el resumen cabe en el disparador —«Calidad alta, listo para usar»— y el detalle
 * está a un clic.
 *
 * ── La regla que hace que plegar sea honesto ──
 *
 * **Una advertencia no se pliega.** Si la detección avisa que este equipo no tiene GPU y
 * va a usar un modelo que comete bastantes más errores, eso tiene que estar a la vista
 * antes de transcribir, no detrás de un triángulo. Esconder una advertencia adentro de un
 * panel cerrado es el modo elegante de no darla.
 *
 * Se usa `<details>` del navegador y no un estado propio: viene con el teclado, con el
 * anuncio para lectores de pantalla y con el estado abierto/cerrado, gratis y bien.
 */
export function Ajustes({
  t,
  comprobando,
  selection,
  profile,
  busy,
  onElegirAlternativa,
}: {
  t: ReturnType<typeof dict>;
  comprobando: boolean;
  selection: Selection | null;
  profile: ModelProfile | null;
  busy: boolean;
  onElegirAlternativa: (p: ModelProfile) => void;
}) {
  if (comprobando) {
    return <p className="text-sm text-apagado">{t.device.checking}</p>;
  }
  if (!selection || !profile) return null;

  const advertencia = selection.notice?.level === 'warn' ? selection.notice.text : null;
  const nota = selection.notice && !advertencia ? selection.notice.text : null;

  return (
    <div className="space-y-3">
      {/* Afuera del panel, a propósito: ver el comentario de arriba. */}
      {advertencia && (
        <p className="rounded-detalle bg-advertencia-fondo p-3 text-sm text-advertencia-titulo">
          {advertencia}
        </p>
      )}

      <details className="group rounded-caja border border-borde">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4 text-sm">
          <span
            aria-hidden
            className="text-apagado transition-transform group-open:rotate-90"
          >
            ▸
          </span>
          <span className="font-medium">{t.paneles.ajustes}</span>
          <span className="text-apagado">
            {t.paneles.ajustesResumen(t.device.quality[profile.quality])}
          </span>
        </summary>
        <div className="space-y-2 border-t border-borde p-4 text-sm">
          <p className="text-tinta-2">
            {t.device.engine(profile.backend === 'webgpu', profile.downloadMB)}
          </p>
          {nota && <p className="text-apagado">{nota}</p>}
          {selection.alternative && !busy && (
            <Boton
              variante="sutil"
              tamano="ninguno"
              onClick={() => onElegirAlternativa(selection.alternative!)}
              className="underline underline-offset-2"
              disabled={profile.key === selection.alternative.key}
            >
              {profile.key === selection.alternative.key
                ? `✓ ${selection.alternative.key}`
                : t.device.switchTo(selection.alternative.key)}
            </Boton>
          )}
        </div>
      </details>
    </div>
  );
}
