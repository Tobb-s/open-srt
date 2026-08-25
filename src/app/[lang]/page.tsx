import Link from 'next/link';
import { notFound } from 'next/navigation';
import Transcribe from './Transcribe';
import { dict, isLang, LANGS, APP_NAME } from '@/lib/i18n';

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = dict(lang);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
      <header className="mb-10 flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-medium tracking-tight text-neutral-500">{APP_NAME}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t.hero.title}
          </h1>
          <p className="mt-3 max-w-xl text-neutral-600 dark:text-neutral-400">
            {t.hero.subtitle}
          </p>
        </div>
        <nav className="flex shrink-0 gap-2 pt-1 text-sm">
          {LANGS.map((l) => (
            <Link
              key={l}
              href={`/${l}`}
              className={
                l === lang
                  ? 'font-medium underline underline-offset-4'
                  : 'text-neutral-500 hover:underline hover:underline-offset-4'
              }
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </header>

      <Transcribe lang={lang} />

      {/*
        La nota de privacidad dice la verdad COMPLETA, incluida la parte incómoda: el audio
        no sale, pero se descarga un modelo desde un tercero. Prometer «nada sale de tu
        equipo» a secas sería falso, y es justo la clase de medias verdades que esta
        herramienta no quiere contar.
      */}
      <section className="mt-12 rounded-2xl border border-neutral-200 p-5 text-sm dark:border-neutral-800">
        <h2 className="font-medium">{t.privacy.title}</h2>
        <ul className="mt-3 space-y-1.5 text-neutral-600 dark:text-neutral-400">
          <li>✓ {t.privacy.audioStays.replace(/\*\*/g, '')}</li>
          <li>↓ {t.privacy.modelComes.replace(/\*\*/g, '')}</li>
        </ul>
        <p className="mt-3 text-neutral-500">{t.privacy.detail}</p>
      </section>

      <footer className="mt-10 text-sm text-neutral-500">
        <p>{t.footer.stage}</p>
      </footer>
    </main>
  );
}
