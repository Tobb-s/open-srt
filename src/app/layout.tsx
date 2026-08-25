import type { Metadata } from 'next';
import './globals.css';
import { APP_NAME, DEFAULT_LANG } from '@/lib/i18n';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Transcripción de audio en el navegador, sin subir nada.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  // `lang` acá es el idioma por defecto; cada ruta `/[lang]` marca el suyo en su propio
  // contenedor. El atributo importa para lectores de pantalla y para la separación
  // silábica del navegador.
  return (
    <html lang={DEFAULT_LANG} className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
