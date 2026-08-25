import { redirect } from 'next/navigation';
import { DEFAULT_LANG } from '@/lib/i18n';

/**
 * La raíz redirige al idioma por defecto.
 *
 * No se detecta el idioma del navegador: cada idioma tiene su URL estable, que se puede
 * compartir e indexar. Quien quiera inglés entra a `/en`.
 */
export default function Root() {
  redirect(`/${DEFAULT_LANG}`);
}
