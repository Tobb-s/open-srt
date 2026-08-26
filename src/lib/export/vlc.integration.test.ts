import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { toCues, toSrt, toVtt } from './subtitles';
import type { TimedText } from '../vad/align';
import { writeWav } from '../../../scripts/lib/wav.mjs';

/**
 * Los subtítulos abiertos por un reproductor de verdad.
 *
 * ── Por qué hace falta, teniendo ya `srt-format.test.ts` ──
 *
 * Ese test compara la salida contra un analizador estricto que escribí yo leyendo la
 * especificación. Si entendí mal la especificación, el analizador y el exportador comparten
 * el error y los dos tests pasan felices. **VLC es un oráculo independiente**: no lo
 * escribí yo y no comparte mis suposiciones.
 *
 * ── Lo que VLC comprueba y lo que no ──
 *
 * Medido acá, con VLC 3.0.20: acepta un SRT con **puntos** en vez de comas y carga sus tres
 * subtítulos igual. Así que «abre en VLC» **no** verifica esa convención — la sostiene
 * `srt-format.test.ts`, que sí la exige. Conviene tenerlo escrito para no confundir una
 * comprobación laxa con una estricta.
 *
 * Lo que sí distingue, y por eso los controles de abajo existen:
 * - basura sin estructura: ningún demultiplexor la reconoce;
 * - subtítulos sin línea en blanco entre ellos: los junta y carga **menos** de los que hay;
 * - marcas de tiempo sin horas: detecta otro formato y carga **cero**;
 * - VTT sin la cabecera `WEBVTT`: lo trata como SubRIP, no como WebVTT.
 *
 * Sin esos controles, «VLC lo cargó» no distinguiría un archivo correcto de uno que VLC
 * interpreta como puede.
 *
 * ── YouTube ──
 *
 * El otro reproductor que menciona el plan **no se verifica acá**: no hay forma de subirle
 * un archivo sin publicar contenido. Queda declarado como no comprobado.
 */

function encontrarVlc(): string | null {
  const candidatos = [
    path.join(process.env['ProgramFiles'] ?? 'C:/Program Files', 'VideoLAN/VLC/vlc.exe'),
    path.join(
      process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
      'VideoLAN/VLC/vlc.exe',
    ),
    '/Applications/VLC.app/Contents/MacOS/VLC',
    '/usr/bin/vlc',
  ];
  return candidatos.find((c) => existsSync(c)) ?? null;
}

const VLC = encontrarVlc();
const TMP = path.resolve(import.meta.dirname, '../../../.vad-tmp');
const ejecutar = promisify(execFile);

/**
 * Un fixture con los casos que rompen un exportador flojo: acentos y ñ, apertura de
 * interrogación, un texto que no entra y hay que partir, un tramo que dura menos del mínimo
 * y hay que estirar, y una marca **pasada la hora** — el lugar clásico donde un formateo
 * con minutos y segundos se cae.
 */
const TRAMOS: TimedText[] = [
  { startSec: 1, endSec: 3.5, text: '¿Qué tal? Este año el niño cumplió cinco.' },
  { startSec: 4, endSec: 4.2, text: 'Corto.' },
  {
    startSec: 5,
    endSec: 12,
    text:
      'Una frase deliberadamente larga que no entra en dos líneas de cuarenta y dos ' +
      'caracteres y por lo tanto el exportador tiene que partirla en varios subtítulos ' +
      'repartiendo el tiempo entre ellos.',
  },
  { startSec: 3723.456, endSec: 3725, text: 'Una después de la hora.' },
];

const CUES = toCues(TRAMOS);

/** Corre VLC con un subtítulo forzado y devuelve su registro. */
async function abrirEnVlc(subtitulo: string): Promise<string> {
  // `--sub-file` sobre un medio real: VLC descarta los `.srt` de la lista de reproducción,
  // así que abrirlos solos no ejercita nada.
  const args = [
    '-I', 'dummy',
    '--no-video',
    '--aout=dummy',
    '-vvv',
    '--sub-file', subtitulo,
    '--play-and-exit',
    path.join(TMP, 'vlc-corto.wav'),
  ];
  try {
    const { stderr } = await ejecutar(VLC!, args, { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    return stderr;
  } catch (err) {
    // VLC sale con código distinto de cero en algunos casos; el registro sigue sirviendo.
    const e = err as { stderr?: string };
    return e.stderr ?? '';
  }
}

function subtitulosCargados(log: string): number | null {
  const m = log.match(/loaded (\d+) subtitles/);
  return m ? Number(m[1]) : null;
}

beforeAll(() => {
  if (!VLC) return;
  mkdirSync(TMP, { recursive: true });

  // Medio mínimo: medio segundo de silencio. VLC analiza el subtítulo al abrir la entrada,
  // así que no hace falta que suene nada.
  writeFileSync(path.join(TMP, 'vlc-corto.wav'), writeWav(new Float32Array(8000), 16000));

  writeFileSync(path.join(TMP, 'muestra.srt'), toSrt(CUES), 'utf8');
  writeFileSync(path.join(TMP, 'muestra.vtt'), toVtt(CUES), 'utf8');

  // Controles.
  writeFileSync(path.join(TMP, 'ctrl-basura.srt'), 'esto no es un subtítulo\nni de casualidad\n');
  // El mismo SRT sin las líneas en blanco que separan un subtítulo del siguiente.
  writeFileSync(
    path.join(TMP, 'ctrl-sin-blanco.srt'),
    toSrt(CUES).replace(/\r\n\r\n/g, '\r\n'),
    'utf8',
  );
  // Marcas sin la parte de horas.
  writeFileSync(
    path.join(TMP, 'ctrl-sin-horas.srt'),
    toSrt(CUES).replace(/\d\d:(\d\d:\d\d,\d\d\d)/g, '$1'),
    'utf8',
  );
  // El VTT sin su cabecera obligatoria.
  writeFileSync(
    path.join(TMP, 'ctrl-vtt-sin-cabecera.vtt'),
    toVtt(CUES).replace(/^WEBVTT\n\n/, ''),
    'utf8',
  );
});

describe.skipIf(!VLC)('los subtítulos abren en VLC', () => {
  it('el SRT se reconoce como SubRIP y carga todos sus subtítulos', async () => {
    const log = await abrirEnVlc(path.join(TMP, 'muestra.srt'));
    expect(log, 'VLC no reconoció el archivo como SubRIP').toMatch(/detected SubRIP format/);
    expect(subtitulosCargados(log), `VLC debía cargar ${CUES.length}`).toBe(CUES.length);
  }, 120_000);

  it('CONTROL: basura sin estructura no la carga nadie', async () => {
    const log = await abrirEnVlc(path.join(TMP, 'ctrl-basura.srt'));
    expect(log).not.toMatch(/detected SubRIP format/);
    expect(subtitulosCargados(log) ?? 0).toBe(0);
  }, 120_000);

  it('CONTROL: sin las líneas en blanco, VLC carga menos de los que hay', async () => {
    const log = await abrirEnVlc(path.join(TMP, 'ctrl-sin-blanco.srt'));
    const cargados = subtitulosCargados(log) ?? 0;
    expect(cargados, 'VLC no notó la diferencia: el control no discrimina').toBeLessThan(
      CUES.length,
    );
  }, 120_000);

  it('CONTROL: sin la parte de horas, VLC no carga ninguno', async () => {
    const log = await abrirEnVlc(path.join(TMP, 'ctrl-sin-horas.srt'));
    expect(subtitulosCargados(log) ?? 0).toBe(0);
  }, 120_000);

  it('el VTT lo toma el demultiplexor de WebVTT, y sin cabecera no', async () => {
    const bueno = await abrirEnVlc(path.join(TMP, 'muestra.vtt'));
    expect(bueno, 'VLC no usó el demultiplexor de WebVTT').toMatch(
      /using demux module "webvtt"/,
    );

    // CONTROL en la misma prueba: quitarle la cabecera lo saca de WebVTT. Es lo que hace
    // que la cabecera importe, y no una formalidad que se pueda omitir.
    const sinCabecera = await abrirEnVlc(path.join(TMP, 'ctrl-vtt-sin-cabecera.vtt'));
    expect(sinCabecera).not.toMatch(/using demux module "webvtt"/);
  }, 120_000);
});
