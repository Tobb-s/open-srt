import { Boton, Tarjeta } from '@/components/ui';
import type { StoredSession } from '@/lib/store/session';
import type { dict } from '@/lib/i18n';

/**
 * Una transcripción de una visita anterior. **Se ofrece, no se impone.**
 *
 * Abrirla sola pisaría la pantalla de alguien que vino a transcribir otra cosa.
 */
export function AvisoDeSesion({
  t,
  pendiente,
  onAbrir,
  onDescartar,
}: {
  t: ReturnType<typeof dict>;
  pendiente: StoredSession;
  onAbrir: () => void;
  onDescartar: () => void;
}) {
  return (
    <Tarjeta tono="aviso" relleno="compacto" className="flex flex-wrap items-center gap-3 text-sm">
      <p className="flex-1">{t.store.restored(pendiente.fileName)}</p>
      <Boton variante="primario" tamano="chico" onClick={onAbrir}>
        {t.store.open}
      </Boton>
      <Boton
        variante="sutil"
        tamano="ninguno"
        onClick={onDescartar}
        className="px-3 py-1.5 text-tinta-2 underline underline-offset-2"
      >
        {t.store.discard}
      </Boton>
    </Tarjeta>
  );
}
