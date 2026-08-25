import type { NextConfig } from 'next';

/**
 * Política de seguridad de contenido.
 *
 * No es un trámite: es **la promesa del producto convertida en mecanismo**. La herramienta
 * dice que el audio no sale de tu computadora, y esta política hace que el navegador lo
 * imponga — si algún día un script intentara mandar datos a otro lado, el navegador lo
 * bloquea, sin depender de que el código se porte bien.
 *
 * Lo motivó un caso concreto: el despliegue traía inyectado el widget de comentarios de
 * Vercel (`vercel.live/_next-live/feedback`), un tercero con acceso al DOM. No subía audio,
 * pero en una herramienta cuya propuesta es la privacidad, un tercero en la página
 * contradice el mensaje. Con esta política no entra.
 *
 * `connect-src` es la línea que importa: enumera **todo** lo que la página puede contactar.
 * Hugging Face está porque de ahí baja el modelo —lo único que entra— y sus pesos se
 * sirven desde `cdn-lfs`.
 */
const csp = [
  "default-src 'self'",
  // Tres cosas acá, y la tercera es una concesión que conviene entender:
  //
  // · `wasm-unsafe-eval` lo exige onnxruntime-web para compilar el WebAssembly del
  //   modelo. No habilita `eval()` de JavaScript: es el permiso mínimo para WASM.
  // · `'unsafe-inline'` hace falta porque Next hidrata las páginas estáticas con scripts
  //   en línea (`self.__next_f.push(...)`). Sin esto la hidratación falla con el error
  //   412 de React y la aplicación no arranca —comprobado—. La alternativa correcta sería
  //   un nonce por petición, pero eso exige renderizar en el servidor y estas páginas son
  //   estáticas a propósito.
  // · La concesión es aceptable **porque no es la línea que protege la privacidad**. Lo
  //   que impide que el audio salga es `connect-src`, que sigue siendo estricto: aunque
  //   se colara un script, no tendría a dónde mandar nada. Y el sitio no renderiza
  //   entrada del usuario, así que la superficie de XSS es mínima.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  // Tailwind inyecta estilos en línea.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // El audio decodificado vive en blobs locales.
  "media-src 'self' blob:",
  // El worker se crea desde el propio origen y desde blobs (onnxruntime arma alguno).
  "worker-src 'self' blob:",
  // A dónde puede hablar la página. Sólo el propio sitio y el repositorio del modelo.
  "connect-src 'self' blob: https://huggingface.co https://*.hf.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co",
  // Nada de iframes de terceros — es lo que bloquea el widget de comentarios.
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Sin formularios: no hay nada que enviar a ningún lado.
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  // Sin esto Turbopack sube hasta el home buscando el lockfile y lo ignora.
  turbopack: { root: __dirname },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Sin cámara, micrófono ni geolocalización: la herramienta trabaja sobre un
          // archivo que ya está en el equipo.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
