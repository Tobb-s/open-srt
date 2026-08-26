import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Recibe el resultado de la prueba de video y lo deja en `benchmarks/`.
 *
 * Existe por una razón concreta: la prueba hay que correrla **en cada navegador**, y desde
 * Firefox no se puede leer el resultado sin sacarle una foto a la pantalla. Con esto, cada
 * navegador deja su archivo y la comparación se hace sobre datos, no sobre capturas.
 *
 * **Sólo en desarrollo.** En producción no tiene sentido —el sistema de archivos de Vercel
 * es de sólo lectura— y una ruta que escribe archivos no es algo que convenga desplegar
 * aunque no funcione.
 */

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Sólo disponible en desarrollo', { status: 404 });
  }

  const cuerpo = (await req.json()) as { userAgent?: string };
  const ua = cuerpo.userAgent ?? '';
  // El orden importa: Edge también dice «Chrome» en su cadena.
  const navegador = /Firefox/.test(ua)
    ? 'firefox'
    : /Edg\//.test(ua)
      ? 'edge'
      : /Chrome/.test(ua)
        ? 'chrome'
        : /Safari/.test(ua)
          ? 'safari'
          : 'otro';

  const dir = path.resolve(process.cwd(), 'benchmarks');
  await mkdir(dir, { recursive: true });
  const archivo = path.join(dir, `E3-video-${navegador}.json`);
  await writeFile(archivo, JSON.stringify(cuerpo, null, 2), 'utf8');

  return NextResponse.json({ guardado: `benchmarks/E3-video-${navegador}.json` });
}
