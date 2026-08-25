import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { dict, isLang, LANGS, APP_NAME, type Lang } from '@/lib/i18n';

/**
 * Layout por idioma.
 *
 * El idioma va en la URL —`/es`, `/en`— y no se detecta del navegador: una URL por idioma
 * se puede compartir, marcar como favorita e indexar. Es el mismo patrón de OpenPDF.
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
  const t = dict(lang);
  return {
    title: t.meta.title,
    description: t.meta.description,
    // Las dos versiones se declaran entre sí para que el buscador sepa que son la misma
    // página en otro idioma, en vez de contenido duplicado.
    alternates: {
      canonical: `/${lang}`,
      languages: Object.fromEntries(LANGS.map((l) => [l, `/${l}`])),
    },
    applicationName: APP_NAME,
  };
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <div data-lang={lang satisfies Lang}>{children}</div>;
}
