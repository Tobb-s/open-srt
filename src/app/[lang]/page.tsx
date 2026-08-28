import { notFound } from 'next/navigation';
import Transcribe from './Transcribe';
import { isLang } from '@/lib/i18n';

/**
 * La ruta. Valida el idioma y se corre.
 *
 * Antes del paso 3 esta página dibujaba también el encabezado, la nota de privacidad y el
 * pie, siempre iguales. Eso los dejaba ciegos al estado: en la pantalla de resultado
 * seguían ocupando el mismo lugar que al llegar, con el usuario ya decidido y su
 * transcripción doscientos píxeles más abajo. Ahora los dibuja `Transcribe`, que sí sabe
 * en qué momento está.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <Transcribe lang={lang} />;
}
