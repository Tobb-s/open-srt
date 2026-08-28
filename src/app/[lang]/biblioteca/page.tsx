import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Biblioteca from './Biblioteca';
import { dict, isLang, LANGS } from '@/lib/i18n';

/**
 * La biblioteca vive en su propia ruta y no en una pestaña de la pantalla principal.
 *
 * Una URL se puede guardar en favoritos y compartir consigo mismo entre pestañas, y sobre
 * todo: entrar acá **no carga el motor de transcripción**. Bajar 850 MB de modelo para
 * mirar una lista sería absurdo, y es lo que pasaría si compartieran componente.
 */

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return {
    title: `${dict(lang).library.title} — OpenSRT`,
    // Es contenido privado del usuario: no hay nada que indexar acá.
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <Biblioteca lang={lang} />;
}
