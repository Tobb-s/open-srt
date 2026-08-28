import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/**
 * Las cuatro primitivas de la interfaz: botón, campo, tarjeta y chip. Nada más.
 *
 * ── Por qué exactamente cuatro ──
 *
 * Antes del paso 1 del rediseño, cada botón del JSX escribía sus clases a mano y había
 * cinco maneras distintas de decir «botón discreto», ninguna elegida: eran accidentes
 * acumulados. Estas cuatro piezas son las únicas formas que la interfaz repite; lo que no
 * es una de ellas (la zona de soltar, la barra de avance, la lista de tramos) es único y
 * se escribe donde vive.
 *
 * Los colores salen de los tokens de `globals.css` — acá no hay ningún `dark:` porque el
 * tema se resuelve en la variable, no en la clase.
 *
 * `className` existe como escape: el paso 1 replica la pantalla actual al píxel, y las
 * diferencias que hoy existen entre botones hermanos (un `px-4` contra un `px-3`) se
 * conservan ahí hasta que el paso 3 decida cuáles eran intención y cuáles accidente.
 */

/* ────────────────────────────── Botón ────────────────────────────── */

type VarianteBoton =
  /** La acción principal: fondo de acento. */
  | 'primario'
  /** La llamada fuerte sin acento: tinta invertida («Elegir archivo»). */
  | 'contraste'
  /** Acción secundaria: borde, sin fondo. */
  | 'secundario'
  /** Acción discreta: sólo texto. */
  | 'sutil';

type TamanoBoton = 'grande' | 'normal' | 'chico' | 'mini' | 'ninguno';

const FORMA_BOTON: Record<TamanoBoton, string> = {
  grande: 'px-6 py-2.5',
  normal: 'px-5 py-2',
  chico: 'px-4 py-1.5',
  mini: 'px-3 py-0.5 text-xs',
  /**
   * Sin relleno propio: lo pone el `className` del que llama. Es la paridad del paso 1
   * hecha mecanismo — la revisión adversarial encontró que mapear los botones existentes
   * a la escala los corría hasta 4 px por lado, el doble de lo declarado. Los que hoy
   * usan `ninguno` conservan su relleno original a la vista; el paso 3 decide cuáles de
   * esas diferencias eran intención y los sube a la escala.
   */
  ninguno: '',
};

const PIEL_BOTON: Record<VarianteBoton, string> = {
  primario: 'bg-acento font-medium text-acento-contraste',
  contraste: 'bg-inverso-fondo font-medium text-inverso-tinta',
  secundario: 'border border-borde-fuerte hover:bg-superficie-2 disabled:opacity-40',
  // Sin subrayado en la piel: hoy conviven sutiles con y sin subrayado y esa distinción
  // (descartar subraya, «otro archivo» no) se conserva vía `className` hasta el paso 3.
  sutil: 'disabled:opacity-50',
};

interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
}

export function Boton({
  variante = 'secundario',
  tamano = 'normal',
  className = '',
  ...resto
}: PropsBoton) {
  return (
    <button
      className={`rounded-full ${FORMA_BOTON[tamano]} ${PIEL_BOTON[variante]} ${className}`.trim()}
      {...resto}
    />
  );
}

/* ────────────────────────────── Campo ────────────────────────────── */

interface PropsCampo {
  /** El texto de la etiqueta; el control va como hijo, dentro del `<label>`. */
  etiqueta: ReactNode;
  /** La línea de ayuda debajo. Cambia con el valor cuando hace falta avisar algo. */
  ayuda?: ReactNode;
  children: ReactNode;
}

/** Etiqueta + control + ayuda. El control (un `Selector`, un checkbox) va adentro. */
export function Campo({ etiqueta, ayuda, children }: PropsCampo) {
  return (
    <div className="pt-1">
      <label className="text-sm text-tinta-2">
        {etiqueta} {children}
      </label>
      {ayuda && <p className="mt-1.5 text-xs text-apagado">{ayuda}</p>}
    </div>
  );
}

/** El `<select>` de la casa: borde de control, fondo opaco de campo. */
export function Selector({ className = '', ...resto }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`ml-1 rounded-detalle border border-borde-fuerte bg-campo px-2 py-1 ${className}`.trim()}
      {...resto}
    />
  );
}

/* ────────────────────────────── Tarjeta ───────────────────────────── */

type TonoTarjeta =
  /** Borde neutro, sin fondo. */
  | 'neutra'
  /** Borde neutro sobre superficie: el panel de capacidades. */
  | 'panel'
  /** Aviso de acento: restaurar sesión, retomar corrida. */
  | 'aviso'
  /** Advertencia: omisión posible, archivo largo. */
  | 'advertencia'
  /** Advertencia que no se puede pasar por alto: borde doble (la traducción). */
  | 'advertencia-fuerte';

const PIEL_TARJETA: Record<TonoTarjeta, string> = {
  neutra: 'border border-borde',
  panel: 'border border-borde bg-superficie',
  aviso: 'border border-acento-borde bg-acento-fondo',
  advertencia: 'border border-advertencia-borde bg-advertencia-fondo',
  'advertencia-fuerte': 'border-2 border-advertencia-borde-fuerte bg-advertencia-fondo',
};

const RELLENO_TARJETA = {
  normal: 'p-5',
  compacto: 'p-4',
  chico: 'p-3',
  /** Para listas que llegan hasta el borde (la lista de tramos del editor). */
  ninguno: '',
} as const;

interface PropsTarjeta {
  tono?: TonoTarjeta;
  relleno?: keyof typeof RELLENO_TARJETA;
  /** Radio chico para cajas anidadas dentro de otra tarjeta. */
  radio?: 'normal' | 'chico';
  as?: 'section' | 'div' | 'ol';
  className?: string;
  children: ReactNode;
}

export function Tarjeta({
  tono = 'neutra',
  relleno = 'normal',
  radio = 'normal',
  as: Elemento = 'section',
  className = '',
  children,
}: PropsTarjeta) {
  const clases = [
    radio === 'normal' ? 'rounded-caja' : 'rounded-caja-chica',
    PIEL_TARJETA[tono],
    RELLENO_TARJETA[relleno],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <Elemento className={clases}>{children}</Elemento>;
}

/* ─────────────────────────────── Chip ─────────────────────────────── */

type TonoChip = 'ok' | 'error' | 'acento' | 'apagado';

const TEXTO_CHIP: Record<TonoChip, string> = {
  ok: 'text-ok',
  error: 'text-error',
  acento: 'text-acento-tinta',
  apagado: 'text-apagado',
};

interface PropsChip {
  /**
   * `texto`: sólo color, sin caja — el estado de cada archivo en la cola.
   * `pastilla`: la etiqueta con fondo — los hablantes, cuyo color viene de su propia
   * paleta (`diar/colores.ts`) vía `className`, porque ese sistema es aparte a propósito.
   */
  forma?: 'texto' | 'pastilla';
  tono?: TonoChip;
  className?: string;
  children: ReactNode;
}

export function Chip({ forma = 'texto', tono, className = '', children }: PropsChip) {
  const color = tono ? TEXTO_CHIP[tono] : '';
  const base =
    forma === 'pastilla' ? 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm' : '';
  return <span className={`${base} ${color} ${className}`.trim()}>{children}</span>;
}
