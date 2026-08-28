import Link from 'next/link';
import { APP_NAME, LANGS, type dict, type Lang } from '@/lib/i18n';

/**
 * El encabezado y el pie, que **cambian de tamaño según el momento**.
 *
 * ── Por qué el encabezado se encoge ──
 *
 * Antes del paso 3, el título y el subtítulo ocupaban lo mismo en las tres situaciones. Al
 * llegar —cuando lo único que hay que decidir es «¿le confío mi audio a esto?»— la promesa
 * merece ese espacio. Mientras transcribe o mientras se lee el resultado, ya no: el
 * usuario ya decidió, y esas líneas son doscientos píxeles entre él y su trabajo.
 *
 * El `<h1>` sigue existiendo en los tres momentos, encogido: sacarlo dejaría la página sin
 * encabezado de primer nivel a mitad de la sesión, que es un defecto de estructura para
 * quien navega con lector de pantalla.
 */

export type Momento = 'soltar' | 'preparar' | 'trabajando' | 'leer';

export function Encabezado({
  t,
  lang,
  momento,
}: {
  t: ReturnType<typeof dict>;
  lang: Lang;
  momento: Momento;
}) {
  const amplio = momento === 'soltar';

  return (
    <header className="flex flex-col gap-3">
      {/*
        La navegación va en su **propia fila**, no al lado del título.
        Medido: con «Biblioteca | ES EN» a la derecha, la nav ocupaba 139 px de los 375 de
        un teléfono y le dejaba 172 al título, que se partía en CUATRO líneas — 280 px de
        encabezado. El enlace a la biblioteca lo agregó el paso 4 y le costó 79 px al botón
        principal sin que nadie lo notara: lo encontró volver a medir en el paso 5, no la
        vista.

        En la fila de arriba el título corto acompaña al nombre; en `soltar`, el título
        grande baja y usa el ancho entero.
      */}
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="shrink-0 text-sm font-medium tracking-tight text-apagado">{APP_NAME}</p>
          {!amplio && (
            <h1 className="truncate text-sm font-medium tracking-tight text-apagado">
              {t.hero.short}
            </h1>
          )}
        </div>
        <nav className="flex shrink-0 items-center gap-3 text-sm">
          {/*
            El acceso a la biblioteca vive acá y en TODOS los momentos: es la forma de
            volver a una transcripción vieja mientras se está mirando otra.
          */}
          <Link href={`/${lang}/biblioteca`} className="underline underline-offset-4">
            {t.library.link}
          </Link>
          <span aria-hidden className="text-borde-fuerte">
            |
          </span>
          {LANGS.map((l) => (
            <Link
              key={l}
              href={`/${l}`}
              className={
                l === lang
                  ? 'font-medium underline underline-offset-4'
                  : 'text-apagado hover:underline hover:underline-offset-4'
              }
            >
              {l.toUpperCase()}
            </Link>
          ))}
        </nav>
      </div>

      {amplio && (
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            {t.hero.title}
          </h1>
          <p className="mt-3 max-w-xl text-tinta-2">{t.hero.subtitle}</p>
        </div>
      )}
    </header>
  );
}

/**
 * La nota de privacidad y el pie.
 *
 * La nota dice la verdad **completa**, incluida la parte incómoda: el audio no sale, pero
 * se descarga un modelo desde un tercero. Prometer «nada sale de tu equipo» a secas sería
 * falso, y es justo la clase de media verdad que esta herramienta no quiere contar.
 *
 * Lo que cambió en el paso 3 es **cuándo** se dice, no qué se dice: el detalle largo pasó a
 * un panel plegado, porque es la respuesta a una pregunta que se hace una vez. Las dos
 * líneas que importan siguen a la vista mientras el usuario está decidiendo, y desaparecen
 * cuando ya decidió y está trabajando.
 */
export function Pie({ t, momento }: { t: ReturnType<typeof dict>; momento: Momento }) {
  if (momento !== 'soltar') return null;

  return (
    <div className="space-y-4 text-sm">
      <details className="group rounded-caja border border-borde">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-4">
          <span aria-hidden className="text-apagado transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className="font-medium">{t.privacy.title}</span>
          <span className="text-apagado">{t.privacy.short}</span>
        </summary>
        <div className="space-y-2 border-t border-borde p-4">
          <ul className="space-y-1.5 text-tinta-2">
            <li>✓ {t.privacy.audioStays.replace(/\*\*/g, '')}</li>
            <li>↓ {t.privacy.modelComes.replace(/\*\*/g, '')}</li>
          </ul>
          <p className="text-apagado">{t.privacy.detail}</p>
        </div>
      </details>
      <p className="text-apagado">{t.footer.stage}</p>
    </div>
  );
}
