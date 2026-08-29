import { modoDe, vecesMasLento, type Modo } from '@/lib/asr/modos';
import type { ModelProfile } from '@/lib/asr/models';
import type { dict } from '@/lib/i18n';

/**
 * Elegir entre rapidez y precisión, a la vista.
 *
 * ── Qué resuelve ──
 *
 * Los tres modelos existían desde E0 y el usuario no los veía: la detección elegía uno y la
 * alternativa vivía dentro de un panel plegado, nombrada por su clave interna
 * (`small-wasm`). Ese es un ajuste del programa; **elegir entre esperar y acertar es una
 * decisión de quien transcribe**.
 *
 * ── Por qué las tarjetas dicen números ──
 *
 * «Más preciso» no ayuda a decidir: ¿más que qué, y a cambio de cuánto? Cada tarjeta trae
 * lo que este proyecto ya midió — el modelo que hay debajo, lo que pesa, cuántas veces más
 * lento que el rápido, y el error medido — con la advertencia de que ese error sale del
 * corpus de referencia y no de una reunión de verdad.
 *
 * ── Por qué una puede estar apagada ──
 *
 * Esto corre en el navegador de quien lo usa, no en un servidor. El modo preciso necesita
 * WebGPU; sin ella E0 midió **RTF 4,74 con un ítem cortado**, o sea una hora de audio en
 * casi cinco y con el final faltando. Se muestra apagada **con el motivo** en vez de
 * esconderla: escondida, el usuario se pregunta por qué su máquina ofrece menos.
 */
export function ModosDeTranscripcion({
  t,
  modos,
  activo,
  onElegir,
}: {
  t: ReturnType<typeof dict>;
  modos: Modo[];
  /** El perfil en uso, para marcar cuál tarjeta está elegida. */
  activo: ModelProfile | null;
  onElegir: (p: ModelProfile) => void;
}) {
  const claveActiva = modoDe(activo);
  const referencia = modos[0];

  return (
    <fieldset className="pt-1">
      <legend className="text-sm font-medium">{t.modes.title}</legend>
      <p className="mt-0.5 text-xs text-apagado">{t.modes.hint}</p>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {modos.map((m) => {
          const elegido = m.clave === claveActiva;
          const disponible = m.profile !== null;
          const lento = vecesMasLento(m, referencia);
          const textos = t.modes[m.clave];

          return (
            <button
              key={m.clave}
              type="button"
              // `aria-pressed` y no `aria-selected`: son botones de alternancia, no
              // pestañas. Sin esto el lector de pantalla lee tres botones iguales sin
              // decir cuál está puesto.
              aria-pressed={elegido}
              disabled={!disponible}
              onClick={() => m.profile && onElegir(m.profile)}
              className={`rounded-caja-chica border p-3 text-left transition-colors ${
                elegido
                  ? 'border-acento bg-acento-fondo'
                  : disponible
                    ? 'border-borde hover:bg-superficie-2'
                    : 'border-borde opacity-60'
              }`}
            >
              <span className="block text-sm font-medium">{textos.name}</span>
              <span className="mt-0.5 block text-xs text-apagado">
                {disponible ? textos.tag : t.modes.unavailable}
              </span>

              {disponible && m.profile && (
                <span className="mt-2 block space-y-0.5 text-xs text-apagado">
                  <span className="block font-mono">
                    {t.modes.model(nombreDelModelo(m.profile))}
                  </span>
                  <span className="block">{t.modes.download(m.profile.downloadMB)}</span>
                  {/* La comparación se omite en el modo de referencia: «1× más lento que el
                      rápido» es ruido, y en el preciso no hay comparación posible porque
                      corre en otro procesador. */}
                  {lento !== null && lento > 1.05 && (
                    <span className="block">{t.modes.slower(lento.toFixed(1))}</span>
                  )}
                  <span className="block">
                    {t.modes.errors(`${(m.profile.measuredWer * 100).toFixed(1)} %`)}
                  </span>
                </span>
              )}

              {/* El motivo va **dentro** de la tarjeta apagada: en un pie común se leería
                  como si aplicara a las tres. */}
              {!disponible && m.motivo && (
                <span className="mt-2 block text-xs text-apagado">{m.motivo}</span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-apagado">{t.modes.errorsCaveat}</p>
    </fieldset>
  );
}

/**
 * El nombre del modelo, tal como lo publica quien lo entrena.
 *
 * Sale del `hfId` y no de una tabla escrita a mano: una tabla se desincroniza del modelo
 * que de verdad se descarga, y entonces la pantalla dice una cosa y el disco baja otra.
 */
function nombreDelModelo(p: ModelProfile): string {
  return p.hfId.split('/')[1].replace(/^whisper-/, '');
}
