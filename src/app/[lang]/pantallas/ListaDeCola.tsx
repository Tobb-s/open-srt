import { Boton, Chip, Tarjeta } from '@/components/ui';
import { listos, type ItemCola } from '@/lib/sesion/cola';
import type { dict } from '@/lib/i18n';

/**
 * La cola de archivos.
 *
 * Sólo aparece con más de un archivo: con uno solo sería una lista de un elemento, que es
 * ruido. Esa condición vive en quien la usa, no acá.
 */
export function ListaDeCola({
  t,
  cola,
  onAbrir,
}: {
  t: ReturnType<typeof dict>;
  cola: ItemCola[];
  onAbrir: (sessionId: string) => void;
}) {
  return (
    <Tarjeta relleno="compacto" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-medium">{t.queue.title(listos(cola), cola.length)}</h2>
        <span className="text-xs text-apagado">{t.queue.hint}</span>
      </div>
      <ol className="divide-y divide-borde text-sm">
        {cola.map((c, i) => (
          <li key={c.key} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-5 shrink-0 text-right font-mono text-xs text-apagado">{i + 1}</span>
            <span className="flex-1 truncate">{c.name}</span>
            <Chip
              tono={
                c.estado === 'listo'
                  ? 'ok'
                  : c.estado === 'error'
                    ? 'error'
                    : c.estado === 'procesando'
                      ? 'acento'
                      : 'apagado'
              }
            >
              {c.estado === 'listo'
                ? t.queue.done
                : c.estado === 'error'
                  ? t.queue.failed
                  : c.estado === 'procesando'
                    ? t.queue.running
                    : t.queue.pending}
            </Chip>
            {c.estado === 'listo' && c.sessionId && (
              <Boton tamano="mini" onClick={() => onAbrir(c.sessionId!)}>
                {t.queue.open}
              </Boton>
            )}
          </li>
        ))}
      </ol>
    </Tarjeta>
  );
}
