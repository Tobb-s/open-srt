import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Mide el contraste de cada par texto/fondo declarado en los tokens, contra 4,5:1.
 *
 * «Medido, no estimado» es la exigencia del paso 1 del rediseño, y este script es la
 * medición: lee los tokens de `globals.css` —no una copia que pueda desviarse—, convierte
 * oklch a sRGB con la matemática de OKLab, compone los fondos con transparencia igual que
 * el navegador (mezcla en sRGB, que es lo que hace CSS), y calcula la luminancia relativa
 * de WCAG. Falla con código 1 si un par baja de 4,5:1.
 *
 * ── El control del instrumento ──
 *
 * Antes de medir nada, el script verifica que su conversión reproduzca un valor conocido:
 * `oklch(55.6% 0 0)` es el neutral-500 de Tailwind 4, que en v3 era `#737373`. Si eso no
 * da `#737373` (±2 por canal), el instrumento está roto y medir con él no prueba nada —
 * la misma regla que la comprobación previa de patrones en `mutation-check.py`.
 *
 * ── Lo que NO se mide acá ──
 *
 * Bordes y rellenos no textuales (el 3:1 de WCAG 1.4.11) se informan pero no cortan: el
 * borde de control actual (neutral-300 sobre blanco, 1,66:1) viene del diseño anterior y
 * corregirlo es una decisión visible que pertenece al paso 3, no a este.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');

/* ── Extraer los dos bloques de tokens ── */

function bloque(desde) {
  // Del `{` que sigue a `desde` hasta su cierre, contando llaves.
  const i = css.indexOf(desde);
  if (i < 0) throw new Error(`No encuentro ${desde} en globals.css`);
  const a = css.indexOf('{', i);
  let nivel = 0;
  for (let j = a; j < css.length; j++) {
    if (css[j] === '{') nivel++;
    if (css[j] === '}' && --nivel === 0) return css.slice(a + 1, j);
  }
  throw new Error('llaves desbalanceadas');
}

function tokensDe(texto) {
  const out = {};
  for (const m of texto.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const claro = tokensDe(bloque(':root'));
const oscuroSolo = tokensDe(bloque('@media (prefers-color-scheme: dark)'));
// El bloque oscuro sólo redefine; lo que no toca, hereda del claro.
const oscuro = { ...claro, ...oscuroSolo };

/* ── oklch → sRGB (por OKLab; matrices de Björn Ottosson) ── */

function oklchAsrgb(str) {
  const m = str.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)\s*(?:\/\s*([\d.]+)(%?)\s*)?\)$/);
  if (m) {
    const L = parseFloat(m[1]) / (m[2] ? 100 : 1);
    const C = parseFloat(m[3]);
    const H = m[4] === 'none' ? 0 : parseFloat(m[4]);
    const alfa = m[5] === undefined ? 1 : parseFloat(m[5]) / (m[6] ? 100 : 1);
    const a = C * Math.cos((H * Math.PI) / 180);
    const b = C * Math.sin((H * Math.PI) / 180);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const mm = m_ ** 3;
    const s = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
    ];
    const gamma = (c) => {
      const x = Math.min(1, Math.max(0, c));
      return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    };
    return { rgb: lin.map(gamma), alfa };
  }
  const hex = str.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = hex[1];
    return {
      rgb: [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255),
      alfa: 1,
    };
  }
  throw new Error(`No sé leer el color: ${str}`);
}

/* ── El control: neutral-500 tiene que dar #737373 ── */

const control = oklchAsrgb('oklch(55.6% 0 0)').rgb.map((c) => Math.round(c * 255));
for (const c of control) {
  if (Math.abs(c - 0x73) > 2) {
    console.error(`INSTRUMENTO ROTO: oklch(55.6% 0 0) dio rgb(${control}) y no #737373`);
    process.exit(1);
  }
}

/* ── Composición y contraste, como los define CSS y WCAG ── */

function componer(fg, bg) {
  // CSS mezcla en sRGB codificado, no en luz lineal.
  return fg.rgb.map((c, i) => fg.alfa * c + (1 - fg.alfa) * bg.rgb[i]);
}

function luminancia(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(texto, fondo) {
  const [a, b] = [luminancia(texto), luminancia(fondo)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * Los pares que la interfaz usa de verdad. Un token de texto sobre cada superficie en la
 * que aparece; las superficies con transparencia se componen sobre --fondo, que es lo que
 * el ojo ve. El tercer elemento, si está, es una superficie intermedia: el aviso de
 * advertencia del panel de capacidades se pinta sobre --superficie, que a su vez es
 * translúcida sobre --fondo — medir ese par contra --fondo a secas mediría otra cosa.
 *
 * El par apagado/acento-fondo no estaba en la primera versión y la revisión adversarial
 * lo encontró: el marcador «editado» y el original bajo la traducción se renderizan
 * dentro del tramo activo del editor, que tiene fondo de acento.
 */
const PARES = [
  ['tinta', 'fondo'],
  ['tinta', 'superficie'], // texto normal dentro del panel de capacidades
  ['tinta', 'acento-fondo'], // el texto del aviso de sesión anterior y del tramo activo
  ['tinta', 'campo'], // el texto en foco del editor
  ['tinta-2', 'fondo'],
  ['tinta-2', 'superficie'], // el texto parcial durante la transcripción
  ['apagado', 'fondo'],
  ['apagado', 'superficie'], // «comprobando este equipo…» en el panel
  ['apagado', 'acento-fondo'], // «editado» y el original, dentro del tramo activo
  ['tinta-2', 'acento-fondo'], // «descartar» dentro del aviso de sesión anterior
  ['acento-tinta', 'fondo'], // tiempos del editor, estado «procesando» de la cola
  ['acento-tinta', 'acento-fondo'], // el tiempo dentro del tramo activo
  ['acento-contraste', 'acento'], // el botón principal
  ['inverso-tinta', 'inverso-fondo'], // «Elegir archivo»
  ['ok', 'fondo'],
  ['error', 'fondo'],
  ['error-texto', 'error-fondo'],
  ['advertencia-titulo', 'advertencia-fondo'],
  ['advertencia-texto', 'advertencia-fondo'],
  ['advertencia-titulo', 'advertencia-fondo', 'superficie'], // el aviso DENTRO del panel
  ['advertencia-texto', 'advertencia-fondo', 'superficie'],
];

/** No textual: se informa contra 3:1 pero no corta (decisión del paso 3). */
const INFORMATIVOS = [
  ['borde-fuerte', 'fondo'],
  ['foco', 'fondo'],
  ['acento', 'pista'], // la barra de avance sobre su riel
];

let fallo = false;

for (const [nombre, tokens] of [
  ['CLARO', claro],
  ['OSCURO', oscuro],
]) {
  console.log(`\n─── Tema ${nombre} ───`);
  const fondoBase = oklchAsrgb(tokens['fondo']);

  const resolver = (token, base = fondoBase) => {
    const c = oklchAsrgb(tokens[token]);
    // Una superficie con transparencia se ve compuesta sobre lo que tenga debajo.
    return c.alfa < 1 ? { rgb: componer(c, base), alfa: 1 } : c;
  };

  for (const [texto, fondo, intermedia] of PARES) {
    const base = intermedia ? resolver(intermedia) : fondoBase;
    const r = contraste(resolver(texto).rgb, resolver(fondo, base).rgb);
    const ok = r >= 4.5;
    if (!ok) fallo = true;
    const nombre = texto + ' / ' + fondo + (intermedia ? ` (en ${intermedia})` : '');
    console.log(`${ok ? '  ok ' : 'FALLA'}  ${nombre.padEnd(38)} ${r.toFixed(2)}:1`);
  }

  for (const [fg, bg] of INFORMATIVOS) {
    const r = contraste(resolver(fg).rgb, resolver(bg).rgb);
    console.log(
      `  ${r >= 3 ? '·   ' : '· <3'}  ${(fg + ' / ' + bg).padEnd(38)} ${r.toFixed(2)}:1  (no textual, informativo)`,
    );
  }
}

console.log(
  `\n(--deshabilitado queda exento a propósito: WCAG no exige contraste en controles deshabilitados.)`,
);

if (fallo) {
  console.error('\nHay pares por debajo de 4,5:1.');
  process.exit(1);
}
console.log('\nTodos los pares de texto declarados llegan a 4,5:1.');
