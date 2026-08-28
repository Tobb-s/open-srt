import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { wer } from './wer';
import { normalizeToWords } from './normalize';
import { profileByKey } from '../asr/models';

/**
 * El control del rediseño: ¿sigue transcribiendo igual de bien después de cinco pasos?
 *
 * ── El criterio del plan no se pudo aplicar, y por qué ──
 *
 * El plan decía: «una corrida completa con el mp4 de 30 minutos, comparada tramo por tramo
 * contra E5 — 3394 palabras, 399 tramos, 94,1 % de cobertura. Si esas tres cifras se mueven,
 * el rediseño rompió el motor». Al ir a ejecutarlo aparecieron **dos problemas con el
 * criterio mismo**, y son más importantes que el resultado:
 *
 * 1. **El mp4 no existe en el repositorio.** E3 lo armó con VLC —imagen fija más los 30
 *    minutos del corpus, transcodificados a H.264 y **AAC**— y no quedó guardado. Lo que sí
 *    está es el WAV original, `public/corpus/es-clean-30min.wav`. **AAC es con pérdida**: la
 *    forma de onda que sale de decodificarlo no es la del WAV, así que el detector de voz y
 *    el modelo ven muestras distintas. Comparar 3394/399 contra una corrida sobre el WAV
 *    sería llamar «regresión» a la diferencia entre dos entradas distintas.
 *
 * 2. **La «cobertura del vocabulario» no es reproducible.** No hay ninguna función en el
 *    repositorio que la calcule: fue una cuenta improvisada durante la verificación manual
 *    de E3. Un número sin instrumento no se puede volver a medir, y rehacerlo con una
 *    normalización casera da otra cifra que no es comparable — el error exacto que este
 *    proyecto viene evitando desde E0. (Comprobado: una normalización casera dio 86,4 %
 *    sobre esta misma corrida. Ese número **no significa nada** contra el 94,1 %.)
 *
 * ── Con qué se reemplaza ──
 *
 * Con el instrumento con el que se midió E0: `normalizeToWords` + `wer`. `models.ts` declara
 * para `base-wasm` un `measuredWer` de 0,296 sobre ocho ítems del corpus. Si el rediseño no
 * rompió nada, este ítem tiene que caer en ese entorno.
 *
 * Y con un control que **no depende de la calidad del modelo**: el detector partió el audio
 * en **65 bloques**, exactamente los mismos 65 que E5 documentó al interrumpir en el bloque
 * 17 de 65. La segmentación es la parte que un refactor sí podía romper, y es idéntica.
 *
 * ── Cómo se regenera ──
 *
 * 1. `npx next build && npx next start -p 3199`
 * 2. Abrir `/es?perfil=base-wasm`, elegir `public/corpus/es-clean-30min.wav`, transcribir.
 * 3. Bajar el TXT y guardarlo en `.control/transcripcion-30min.txt`.
 * 4. `npx vitest run src/lib/bench/control-rediseno.test.ts`
 *
 * Sin ese archivo el test se saltea: es una medición de navegador, no de CI.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OBTENIDA = path.join(ROOT, '.control/transcripcion-30min.txt');
const CORPUS = path.join(ROOT, 'public/corpus/manifest.json');
const hay = existsSync(OBTENIDA) && existsSync(CORPUS);

describe.skipIf(!hay)('control del rediseño — 30 minutos con base-wasm', () => {
  const manifiesto = hay
    ? (JSON.parse(readFileSync(CORPUS, 'utf8')) as {
        items: Array<{ id: string; lang: string; reference: string }>;
      })
    : { items: [] };
  const item = manifiesto.items.find((i) => i.id === 'es-clean-30min');
  const obtenida = hay ? readFileSync(OBTENIDA, 'utf8') : '';

  it('el WER cae donde E0 lo midió para este perfil', () => {
    const ref = normalizeToWords(item!.reference, 'es');
    const hyp = normalizeToWords(obtenida, 'es');
    const r = wer(ref, hyp);

    const declarado = profileByKey('base-wasm')!.measuredWer;
    console.log(
      `\nWER de la corrida de control: ${(r.wer * 100).toFixed(1)} % ` +
        `(S ${r.sub} · D ${r.del} · I ${r.ins} sobre ${ref.length} palabras)`,
    );
    console.log(`WER declarado en models.ts para base-wasm: ${(declarado * 100).toFixed(1)} %`);

    // ── Por qué la comparación es «menor que», y no una banda alrededor de 0,296 ──
    //
    // La primera versión de este test exigía caer a ±15 puntos del 0,296 y **falló con
    // 12,4 %**. El umbral estaba mal, no la corrida: `measuredWer` es el agregado de los
    // **ocho ítems de nivel A**, que incluyen murmullo a 10 dB de SNR, tres hablantes con
    // solapamiento, y los cuatro ítems en inglés. Este ítem es nivel B, **limpio y en
    // español**: la categoría más fácil del corpus.
    //
    // Exigirle a un ítem fácil que se parezca al promedio de ítems difíciles es el mismo
    // error de comparar instrumentos distintos que este archivo le señala a la «cobertura
    // del vocabulario». Lo que sí se puede afirmar es la desigualdad: **un ítem limpio no
    // puede salir peor que el promedio que incluye los sucios**. Eso descarta un motor
    // roto, que daría 60 % o 90 %.
    expect(r.wer).toBeLessThan(declarado);

    // Y un piso: un WER cercano a cero sobre 3373 palabras no sería una buena noticia sino
    // la señal de que la referencia se filtró en la hipótesis por un error del arnés.
    expect(r.wer).toBeGreaterThan(0.02);
  });

  it('no hay alucinación: las inserciones no se disparan', () => {
    // La lección de E1: el modo de fallo de Whisper es inventar texto fluido, y eso aparece
    // como **inserciones**, no como sustituciones. Un motor que se quedó repitiendo una
    // frase da un número de inserciones enorme, aunque el WER total no lo delate.
    const ref = normalizeToWords(item!.reference, 'es');
    const r = wer(ref, normalizeToWords(obtenida, 'es'));
    console.log(`inserciones / palabras de referencia: ${(r.ins / ref.length * 100).toFixed(1)} %`);
    expect(r.ins / ref.length).toBeLessThan(0.15);
  });

  it('la transcripción tiene el largo que corresponde a media hora de habla', () => {
    // Un motor que se cortó a la mitad devolvería la mitad de las palabras y podría pasar
    // los dos tests de arriba si lo que transcribió estaba bien.
    const ref = normalizeToWords(item!.reference, 'es');
    const hyp = normalizeToWords(obtenida, 'es');
    console.log(`palabras: referencia ${ref.length} · obtenidas ${hyp.length}`);
    expect(hyp.length / ref.length).toBeGreaterThan(0.9);
    expect(hyp.length / ref.length).toBeLessThan(1.1);
  });
});
