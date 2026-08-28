'use client';

import { useRef, useState } from 'react';
import { Boton } from '@/components/ui';
import type { dict } from '@/lib/i18n';

/**
 * Elegir o soltar el archivo.
 *
 * El estado de «arrastrando encima» vive acá y no en el hook: no lo necesita nadie más, y
 * subirlo obligaría a redibujar toda la pantalla en cada `dragover`.
 */
export function ZonaDeArchivo({
  t,
  onFiles,
}: {
  t: ReturnType<typeof dict>;
  onFiles: (fs: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
      className={`rounded-caja border-2 border-dashed px-5 py-9 text-center transition-colors sm:p-12 ${
        dragging ? 'border-foco bg-acento-fondo' : 'border-borde-fuerte'
      }`}
    >
      <p className="text-lg font-medium">{t.drop.idle}</p>
      <p className="mt-1 text-apagado">{t.drop.hint}</p>
      <Boton
        variante="contraste"
        tamano="grande"
        className="mt-4"
        onClick={() => inputRef.current?.click()}
      >
        {t.drop.button}
      </Boton>
      <p className="mt-3 text-xs text-apagado">{t.drop.formats}</p>
      <input
        ref={inputRef}
        type="file"
        // El video entra por el mismo camino que el audio: `decodeAudioData` saca la
        // pista de audio de un mp4 o un webm sin ninguna dependencia extra. Medido en
        // `/bench/video`; el detalle está en `docs/E3-ESTADO.md`.
        multiple
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => onFiles([...(e.target.files ?? [])])}
      />
    </section>
  );
}
