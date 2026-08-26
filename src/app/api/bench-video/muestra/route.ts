import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Guarda un archivo de muestra generado por el navegador, en `public/muestras/`.
 *
 * ── Por qué hace falta ──
 *
 * La prueba de E3 se apoyaba en que cada navegador **grabara** sus propios contenedores, y
 * eso tiene un agujero: **Firefox no sabe grabar mp4**. Con ese método, la pregunta que más
 * importa —¿Firefox abre el audio de un mp4?— quedaba sin responder, no porque Firefox no
 * pueda, sino porque la prueba no tenía con qué preguntarle.
 *
 * Con esto, el navegador que sí sabe grabar deja el archivo acá y **todos decodifican el
 * mismo**. Deja de medirse qué sabe grabar cada uno y pasa a medirse qué sabe leer, que es
 * lo que decide el camino de la etapa.
 *
 * Sólo en desarrollo, igual que la ruta hermana.
 */

const NOMBRE_VALIDO = /^[a-z0-9-]+\.(mp4|webm|mov|mkv|m4a|ogg)$/;

function dirMuestras(): string {
  return path.resolve(process.cwd(), 'public/muestras');
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Sólo disponible en desarrollo', { status: 404 });
  }

  const nombre = new URL(req.url).searchParams.get('nombre') ?? '';
  // El nombre viene del cliente y termina en una ruta de archivo: se acepta una lista
  // cerrada de formas, no lo que mande.
  if (!NOMBRE_VALIDO.test(nombre)) {
    return new NextResponse('Nombre de archivo no permitido', { status: 400 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.byteLength === 0) return new NextResponse('Archivo vacío', { status: 400 });

  const dir = dirMuestras();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, nombre), bytes);

  // El manifiesto es lo que el resto de los navegadores consulta para saber qué decodificar.
  const archivos = (await readdir(dir)).filter((f) => NOMBRE_VALIDO.test(f)).sort();
  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ archivos }, null, 2),
    'utf8',
  );

  return NextResponse.json({ guardado: `public/muestras/${nombre}`, archivos });
}
