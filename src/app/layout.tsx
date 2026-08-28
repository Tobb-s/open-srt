import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';
import './globals.css';
import { APP_NAME, DEFAULT_LANG } from '@/lib/i18n';

/**
 * La tipografía, elegida por fin (paso 1 del rediseño).
 *
 * Hasta acá el producto entero se veía en Arial: la plantilla de create-next-app declaraba
 * `--font-geist-sans` pero nunca cargó la fuente, y su `font-family: Arial` de respaldo
 * quedó como la letra real durante cinco etapas.
 *
 * Tres roles, tres familias:
 * - **Bricolage Grotesque** para títulos: con carácter, sin ser un logo.
 * - **Instrument Sans** para la interfaz: neutra y legible en cuerpos chicos.
 * - **IBM Plex Mono** para los tiempos: `00:04:12` con cifras del mismo ancho.
 *
 * `next/font` descarga la fuente EN EL BUILD y la sirve desde el propio origen: en
 * ejecución no se le pide nada a Google, que es lo que la CSP (`font-src 'self'`) exige y
 * la promesa de privacidad espera. Las variables `--fuente-*` las consume `globals.css`.
 */
const fuenteTitulo = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--fuente-titulo',
  display: 'swap',
});

const fuenteUi = Instrument_Sans({
  subsets: ['latin'],
  variable: '--fuente-ui',
  display: 'swap',
});

// Sólo el peso que la interfaz usa: todos los contextos `font-mono` (tiempos del editor,
// números de la cola, botones de formato) van a peso normal. Cargar 500/600 «por si
// acaso» precargaría dos archivos que nadie pinta; si un paso futuro los usa, se agregan
// junto con ese uso.
const fuenteMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--fuente-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Transcripción de audio en el navegador, sin subir nada.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // `lang` acá es el idioma por defecto; cada ruta `/[lang]` marca el suyo en su propio
  // contenedor. El atributo importa para lectores de pantalla y para la separación
  // silábica del navegador.
  //
  // El fondo y la tinta del body viven en `globals.css` junto con el resto de los
  // tokens, no acá: el modo oscuro se decide en UN lugar.
  return (
    <html
      lang={DEFAULT_LANG}
      className={`h-full antialiased ${fuenteTitulo.variable} ${fuenteUi.variable} ${fuenteMono.variable}`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
