import { describe, it, expect } from 'vitest';
import { PROFILES, SLOW_ACCURATE, assertCombinationSafe, dtypeLabel, profileByKey, rtfMedian, rtfRange } from './models';
import { checkCombination, lookup, MEASUREMENTS, BrokenCombinationError, type Measurement } from './evidence';
import { selectProfile, roughEstimateSec, roughEstimateRange, type DeviceCapabilities } from './capabilities';
import { Estimator, describeEstimate, firstSeconds, WINDOW_SEC } from './estimate';
import { createProgressTracker, windowCount, resolveTimestamps, CHUNK_SEC, STRIDE_SEC, JUMP_SEC } from './transcriber';
import { humanRange } from '../i18n';

const GB = 1024 ** 3;
const caps = (over: Partial<DeviceCapabilities> = {}): DeviceCapabilities => ({
  webgpu: true,
  maxBufferBytes: 2 * GB,
  ...over,
});

describe('evidence — la guarda se apoya en lo medido, no en reglas', () => {
  const TURBO = 'onnx-community/whisper-large-v3-turbo';
  const SMALL = 'onnx-community/whisper-small';
  const BASE = 'onnx-community/whisper-base';
  const TINY = 'onnx-community/whisper-tiny';

  it('rechaza turbo con encoder q8 en WebGPU — medido en 100 % de WER', () => {
    expect(() =>
      checkCombination(TURBO, 'webgpu', { encoder_model: 'q8', decoder_model_merged: 'q4' }),
    ).toThrow(BrokenCombinationError);
  });

  it('PERO acepta q8 donde sí funciona: base sobre WASM, 29,6 %', () => {
    // El caso que tumbó la regla general. Si esto vuelve a fallar, alguien reintrodujo
    // una prohibición de q8 que la evidencia no sostiene.
    expect(() =>
      checkCombination(BASE, 'wasm', { encoder_model: 'q8', decoder_model_merged: 'q8' }),
    ).not.toThrow();
  });

  it('rechaza el decoder en fp16 — medido en 580 % de WER', () => {
    expect(() =>
      checkCombination(SMALL, 'webgpu', { encoder_model: 'fp16', decoder_model_merged: 'fp16' }),
    ).toThrow(/580|fp16/);
  });

  it('rechaza turbo en fp32, que ni siquiera carga', () => {
    expect(() =>
      checkCombination(TURBO, 'webgpu', { encoder_model: 'fp32', decoder_model_merged: 'q4' }),
    ).toThrow(/maxBufferSize|2 GB/);
  });

  it('PERO acepta fp32 en small, donde sí entra', () => {
    // fp32 no es «demasiado grande» en abstracto: era específico de large-v3.
    expect(() =>
      checkCombination(SMALL, 'webgpu', { encoder_model: 'fp32', decoder_model_merged: 'q4' }),
    ).not.toThrow();
  });

  it('rechaza tiny con q8, que alucina masivamente', () => {
    expect(() =>
      checkCombination(TINY, 'wasm', { encoder_model: 'q8', decoder_model_merged: 'q8' }),
    ).toThrow(/1079|alucina/);
  });

  it('rechaza lo inservible por lento, no sólo lo incorrecto', () => {
    // turbo en WASM transcribe bien (1,8 %) pero a RTF 4,74: no sirve como producto.
    expect(() =>
      checkCombination(TURBO, 'wasm', { encoder_model: 'q8', decoder_model_merged: 'q8' }),
    ).toThrow(/4,74|espera/);
  });

  it('sobre una combinación no medida NO afirma nada: la marca sin verificar', () => {
    // Ni la bloquea (impediría probar cosas nuevas) ni la declara segura (sería mentir).
    const r = checkCombination(TURBO, 'webgpu', { encoder_model: 'q4', decoder_model_merged: 'q8' });
    expect(r.status).toBe('unverified');
  });

  it('acepta el perfil ganador y lo reporta como medido', () => {
    const r = checkCombination(TURBO, 'webgpu', { encoder_model: 'fp16', decoder_model_merged: 'q4' });
    expect(r.status).toBe('measured-ok');
    expect(r.measurement!.wer).toBeCloseTo(0.030);
  });

  it('CADA perfil del catálogo tiene una medición que lo respalda', () => {
    // El control de fondo: ningún perfil puede entrar al producto sin evidencia. Atrapa
    // tanto un perfil roto como uno inventado sin medir.
    for (const p of [...PROFILES, SLOW_ACCURATE]) {
      const m = lookup(p.hfId, p.backend, p.dtype);
      expect(m, `${p.key} no tiene medición en evidence.ts`).toBeDefined();
      expect(m!.verdict, p.key).toBe('ok');
      expect(() => assertCombinationSafe(p.hfId, p.backend, p.dtype), p.key).not.toThrow();
    }
  });

  it('el WER declarado en el catálogo coincide con el medido', () => {
    // Evita que alguien "mejore" el número del catálogo sin volver a medir. Ya atrapó un
    // caso real: el perfil q4 declaraba el WER del perfil fp16, copiado en vez de medido.
    for (const p of [...PROFILES, SLOW_ACCURATE]) {
      const m = lookup(p.hfId, p.backend, p.dtype)!;
      if (m.wer === null) continue;
      expect(p.measuredWer, p.key).toBeCloseTo(m.wer, 3);
    }
  });

  it('cada perfil declara sobre cuántos ítems se midió su WER', () => {
    // Un 1,8 % sobre un ítem y un 3,0 % sobre ocho no son comparables. Sin esto, el
    // perfil menos medido parecía el mejor.
    for (const p of [...PROFILES, SLOW_ACCURATE]) {
      expect(p.werSamples, p.key).toBeGreaterThan(0);
    }
    expect(profileByKey('turbo-webgpu')!.werSamples).toBe(8);
    expect(profileByKey('turbo-webgpu-q4')!.werSamples).toBe(1);
  });

  it('el perfil por defecto es el MEJOR MEDIDO, no el de WER más bajo', () => {
    // turbo-webgpu-q4 tiene un WER nominal más bajo (1,8 % vs 3,0 %) pero con un octavo
    // del respaldo. El defecto es el que tiene la medición sólida.
    const def = PROFILES[0];
    expect(def.key).toBe('turbo-webgpu');
    expect(def.werSamples).toBeGreaterThanOrEqual(8);
  });

  it('el backend distingue dos mediciones del mismo modelo y dtype', () => {
    // Hoy ninguna combinación está medida en los dos backends, así que con la tabla real
    // este filtro no se ejercita —lo destapó una prueba de mutación: quitarlo no rompía
    // nada—. Se prueba con una tabla construida, porque la propiedad importa: `q8` está
    // roto en WebGPU y bien en WASM.
    const tabla: Measurement[] = [
      { model: 'x', backend: 'webgpu', encoder: 'q8', decoder: 'q4', wer: 1.0,
        verdict: 'broken', note: 'roto en GPU' },
      { model: 'x', backend: 'wasm', encoder: 'q8', decoder: 'q4', wer: 0.05,
        verdict: 'ok', note: 'bien en CPU' },
    ];
    const dtype = { encoder_model: 'q8', decoder_model_merged: 'q4' } as const;

    expect(lookup('org/x', 'webgpu', dtype, tabla)!.verdict).toBe('broken');
    expect(lookup('org/x', 'wasm', dtype, tabla)!.verdict).toBe('ok');
    expect(() => checkCombination('org/x', 'webgpu', dtype, tabla)).toThrow();
    expect(() => checkCombination('org/x', 'wasm', dtype, tabla)).not.toThrow();
  });

  it('la tabla de evidencia no tiene entradas duplicadas', () => {
    const keys = MEASUREMENTS.map((m) => `${m.model}|${m.backend}|${m.encoder}|${m.decoder}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('dtypeLabel identifica la configuración', () => {
    expect(dtypeLabel({ encoder_model: 'fp16', decoder_model_merged: 'q4' })).toBe('enc:fp16/dec:q4');
  });
});

describe('selectProfile — elige lo que el equipo aguanta de verdad', () => {
  it('con WebGPU y buffer holgado elige turbo en fp16', () => {
    const s = selectProfile(caps());
    expect(s.profile.key).toBe('turbo-webgpu');
    expect(s.profile.dtype.encoder_model).toBe('fp16');
    expect(s.notice).toBeUndefined();
  });

  it('NO elige un perfil que no entra en el buffer del adaptador', () => {
    // El fallo que E0 pagó con 900 s de timeout: el encoder no entraba y no había ningún
    // error que lo dijera. Con 1 GB de límite, el perfil fp16 (1,3 GB) no puede salir.
    const s = selectProfile(caps({ maxBufferBytes: 1 * GB }));
    expect(s.profile.key).not.toBe('turbo-webgpu');
    expect(s.profile.peakBufferBytes).toBeLessThanOrEqual(1 * GB);
  });

  it('con buffer chico cae al turbo en q4, que sí entra', () => {
    const s = selectProfile(caps({ maxBufferBytes: 1 * GB }));
    expect(s.profile.key).toBe('turbo-webgpu-q4');
    expect(s.notice?.level).toBe('info'); // misma calidad, sólo más lento
  });

  it('sin WebGPU cae a WASM y AVISA que la calidad baja', () => {
    const s = selectProfile(caps({ webgpu: false, maxBufferBytes: undefined }));
    expect(s.profile.backend).toBe('wasm');
    expect(s.notice?.level).toBe('warn');
    // La diferencia es de 3 % a 30 % de WER: callarlo sería engañoso.
    expect(s.notice?.text).toMatch(/errores/i);
  });

  it('sin WebGPU ofrece la alternativa lenta pero más precisa', () => {
    const s = selectProfile(caps({ webgpu: false }));
    expect(s.alternative?.key).toBe('small-wasm');
    expect(s.alternative!.measuredWer).toBeLessThan(s.profile.measuredWer);
    expect(rtfMedian(s.alternative!)).toBeGreaterThan(rtfMedian(s.profile));
  });

  it('con WebGPU pero sin memoria para ningún perfil, cae a WASM y avisa', () => {
    const s = selectProfile(caps({ maxBufferBytes: 64 * 1024 * 1024 }));
    expect(s.profile.backend).toBe('wasm');
    expect(s.notice?.level).toBe('warn');
  });

  it('incluye el motivo cuando WebGPU no está', () => {
    const s = selectProfile(caps({ webgpu: false, webgpuReason: 'El navegador no expone WebGPU.' }));
    expect(s.notice?.text).toContain('no expone WebGPU');
  });
});

describe('el catálogo refleja lo que E0 midió', () => {
  it('turbo domina a small: más rápido Y más preciso', () => {
    // Es la razón por la que la decisión de E0 no aplicó la lectura literal del criterio.
    const turbo = profileByKey('turbo-webgpu')!;
    expect(rtfMedian(turbo)).toBeLessThan(0.636); // small en webgpu
    expect(turbo.measuredWer).toBeLessThan(0.205);
  });

  it('el perfil por defecto corre más rápido que tiempo real', () => {
    expect(rtfMedian(PROFILES[0])).toBeLessThan(1);
  });

  it('roughEstimateSec escala con la duración', () => {
    const p = PROFILES[0];
    expect(roughEstimateSec(p, 600)).toBeCloseTo(600 * rtfMedian(p));
  });
});

describe('el RTF sale de mediciones, no de un número escrito a mano', () => {
  it('todo perfil declara al menos una medición', () => {
    for (const p of [...PROFILES, SLOW_ACCURATE]) {
      expect(p.rtfSamples.length, p.key).toBeGreaterThan(0);
      for (const x of p.rtfSamples) expect(x, p.key).toBeGreaterThan(0);
    }
  });

  it('la mediana se deriva de las muestras', () => {
    const turbo = profileByKey('turbo-webgpu')!;
    // 24 muestras por archivo del conjunto principal.
    expect(rtfMedian(turbo)).toBeCloseTo(0.462, 3);
  });

  it('el rango cubre 8 de 10 archivos de VALIDACIÓN, medidos aparte', () => {
    // Los RTF de los 10 archivos del conjunto de validación, que NO participaron en
    // definir el rango. Es la única comprobación que no es circular.
    const validacion = [0.422, 0.473, 0.483, 0.517, 0.529, 0.537, 0.544, 0.563, 0.566, 0.685];
    const r = rtfRange(profileByKey('turbo-webgpu')!);
    const dentro = validacion.filter((x) => x >= r.min && x <= r.max).length;
    expect(dentro).toBeGreaterThanOrEqual(8);
  });

  it('hacen falta MUCHAS muestras: con pocas el rango sale falsamente estrecho', () => {
    // Medido: con las 8 muestras de una sola corrida el rango daba [0,435, 0,488] y
    // cubría 2 de 10. Un rango estrecho no es preciso, es mal medido.
    expect(profileByKey('turbo-webgpu')!.rtfSamples.length).toBeGreaterThanOrEqual(24);
  });

  it('el rango usa percentiles, no el mínimo y el máximo', () => {
    // Con min/max un solo archivo raro ensancharía el rango para siempre. Los percentiles
    // describen dónde cae la mayoría.
    const turbo = profileByKey('turbo-webgpu')!;
    const r = rtfRange(turbo);
    const xs = [...turbo.rtfSamples].sort((a, b) => a - b);

    expect(r.min).toBeGreaterThan(xs[0]);          // más alto que el mínimo
    expect(r.max).toBeLessThan(xs[xs.length - 1]); // más bajo que el máximo
    expect(r.single).toBe(false);
  });

  it('el rango cubre a la gran mayoría de los archivos medidos', () => {
    // Es la métrica que reemplaza al «±25 %» del plan, que la variabilidad del equipo
    // hacía inalcanzable. Lo que importa es que el rango MOSTRADO contenga el tiempo real.
    const turbo = profileByKey('turbo-webgpu')!;
    const r = rtfRange(turbo);
    const dentro = turbo.rtfSamples.filter((x) => x >= r.min && x <= r.max).length;
    expect(dentro / turbo.rtfSamples.length).toBeGreaterThanOrEqual(0.7);
  });

  it('las muestras son por ARCHIVO, no promedios de corrida', () => {
    // La corrección que costó descubrir: con los agregados el rango salía [0,451, 0,565]
    // y sólo 8 de 16 archivos caían dentro. Un promedio de ocho archivos se dispersa mucho
    // menos que un archivo suelto, así que predecía con la variabilidad equivocada.
    const turbo = profileByKey('turbo-webgpu')!;
    expect(turbo.rtfSamples.length).toBeGreaterThanOrEqual(16);
    const xs = [...turbo.rtfSamples].sort((a, b) => a - b);
    // Dispersión propia de archivos sueltos, no de promedios.
    expect(xs[xs.length - 1] / xs[0]).toBeGreaterThan(1.5);
  });

  it('marca como `single` los perfiles medidos una sola vez', () => {
    // No es que sean consistentes: es que se midieron una vez. La interfaz no debe
    // mostrar un rango degenerado como si fuera información.
    expect(rtfRange(profileByKey('base-wasm')!).single).toBe(true);
    expect(rtfRange(profileByKey('turbo-webgpu-q4')!).single).toBe(true);
  });

  it('roughEstimateRange escala el rango con la duración', () => {
    const turbo = profileByKey('turbo-webgpu')!;
    const r = rtfRange(turbo);
    const e = roughEstimateRange(turbo, 600);
    expect(e.minSec).toBeCloseTo(600 * r.min);
    expect(e.maxSec).toBeCloseTo(600 * r.max);
    expect(e.single).toBe(false);
  });
});

describe('Estimator — la estimación honesta', () => {
  const profile = PROFILES[0];

  it('arranca declarando que el número es de tabla, no de este equipo', () => {
    const e = new Estimator(profile);
    const r = e.estimate(600);
    expect(r.source).toBe('tabla');
    expect(describeEstimate(r)).toMatch(/aproximada/);
  });

  it('NO calibra con menos de una ventana completa', () => {
    // Whisper rellena hasta 30 s: medir con 5 s daría el costo de una ventana entera
    // dividido por 5, y el RTF saldría ~6 veces inflado.
    const e = new Estimator(profile);
    e.start();
    e.calibrate(10_000, 5);
    expect(e.estimate(600).source).toBe('tabla'); // la ignoró
  });

  it('calibra con una ventana completa y usa ESE rtf', () => {
    const e = new Estimator(profile);
    e.start();
    e.calibrate(15_000, WINDOW_SEC); // 15 s para 30 s de audio → rtf 0,5
    const r = e.estimate(600);
    expect(r.source).toBe('calibrado');
    expect(r.rtf).toBeCloseTo(0.5);
    expect(r.totalSec).toBeCloseTo(300);
  });

  it('la estimación calibrada ya no se anuncia como aproximada', () => {
    const e = new Estimator(profile);
    e.start();
    e.calibrate(15_000, WINDOW_SEC);
    expect(describeEstimate(e.estimate(600))).not.toMatch(/aproximada/);
  });

  it('NO refina con una sola ventana, donde el calentamiento aún domina', () => {
    const e = new Estimator(profile);
    e.start();
    e.calibrate(15_000, WINDOW_SEC);
    e.refine(WINDOW_SEC);
    expect(e.estimate(600).source).toBe('calibrado'); // no pasó a refinado
  });

  it('refina con más de una ventana', () => {
    const e = new Estimator(profile);
    e.start();
    e.refine(WINDOW_SEC * 4);
    expect(e.estimate(600).source).toBe('refinado');
  });

  it('descuenta lo ya procesado del tiempo que falta', () => {
    const e = new Estimator(profile);
    e.start();
    e.calibrate(15_000, WINDOW_SEC);
    const r = e.estimate(600, 300);
    expect(r.remainingSec).toBeCloseTo(150); // la mitad, a rtf 0,5
    expect(r.totalSec).toBeCloseTo(300);
  });

  it('nunca devuelve tiempo restante negativo', () => {
    const e = new Estimator(profile);
    e.start();
    expect(e.estimate(600, 900).remainingSec).toBe(0);
  });
});

describe('describeEstimate — lenguaje llano', () => {
  const mk = (remainingSec: number, source: 'tabla' | 'calibrado' | 'refinado' = 'calibrado') =>
    ({ remainingSec, totalSec: remainingSec, rtf: 0.5, source }) as const;

  it('usa tramos legibles y no segundos exactos', () => {
    expect(describeEstimate(mk(20))).toBe('menos de un minuto');
    expect(describeEstimate(mk(60))).toBe('alrededor de un minuto');
    expect(describeEstimate(mk(600))).toBe('alrededor de 10 minutos');
  });

  it('pasa a horas cuando corresponde', () => {
    expect(describeEstimate(mk(7200))).toBe('alrededor de 2 h');
    expect(describeEstimate(mk(5400))).toBe('alrededor de 1 h 30 min');
  });
});

describe('firstSeconds', () => {
  it('recorta a la cantidad de muestras pedida', () => {
    const audio = new Float32Array(16000 * 60);
    expect(firstSeconds(audio, 30).length).toBe(16000 * 30);
  });

  it('no se pasa del largo disponible', () => {
    const audio = new Float32Array(16000 * 5);
    expect(firstSeconds(audio, 30).length).toBe(16000 * 5);
  });
});

describe('timestamps — apagados por defecto', () => {
  it('el default es false, y eso es una decisión medida', () => {
    // Encenderlos sube el WER de 3,03 % a 4,52 % en audio difícil. El default no puede
    // cambiar sin volver a medir.
    expect(resolveTimestamps(undefined)).toBe(false);
    expect(resolveTimestamps()).toBe(false);
  });

  it('se pueden pedir explícitamente', () => {
    expect(resolveTimestamps(true)).toBe(true);
    expect(resolveTimestamps(false)).toBe(false);
  });
});

describe('progreso — el bug del retroceso', () => {
  it('JUMP_SEC es 20: el avance descuenta el solapamiento de LOS DOS lados', () => {
    // transformers.js calcula `jump = window - 2 * stride`. Suponer 30 (la ventana) o 25
    // (un solo lado) desplaza el progreso de forma creciente a lo largo del archivo.
    expect(CHUNK_SEC).toBe(30);
    expect(STRIDE_SEC).toBe(5);
    expect(JUMP_SEC).toBe(20);
  });

  it('cuenta bien las ventanas', () => {
    expect(windowCount(10)).toBe(1);
    expect(windowCount(30)).toBe(1);
    expect(windowCount(50)).toBe(2);
    expect(windowCount(303)).toBe(15);
  });

  it('NUNCA retrocede, aunque el streamer reinicie los tiempos', () => {
    // El bug real: `on_chunk_start` da el tiempo DENTRO de la ventana, así que vuelve a
    // ~0 en cada una. Sin acumular, el usuario veía el progreso ir de 28 s a 6 s.
    const tr = createProgressTracker(303);
    const emitidos = [0, 5, 12, 28, 2, 9, 21, 3, 14]; // dos reinicios
    const vistos = emitidos.map((t) => tr.absolute(t));
    for (let i = 1; i < vistos.length; i++) {
      expect(vistos[i], `retrocedió en el paso ${i}: ${vistos.join(' → ')}`)
        .toBeGreaterThanOrEqual(vistos[i - 1]);
    }
  });

  it('convierte a segundos absolutos usando el salto de ventana', () => {
    const tr = createProgressTracker(303);
    expect(tr.absolute(10)).toBe(10);   // ventana 0
    expect(tr.absolute(25)).toBe(25);
    expect(tr.absolute(3)).toBe(25);    // ventana 1 daría 23, pero no se retrocede
    expect(tr.window).toBe(1);
    expect(tr.absolute(12)).toBe(32);   // 20 + 12
    expect(tr.absolute(1)).toBe(41);    // ventana 2: 40 + 1
  });

  it('no se pasa de la duración real del archivo', () => {
    // Un timestamp del modelo puede caer más allá del final; la barra no debe superar 100 %.
    const tr = createProgressTracker(50);
    expect(tr.absolute(29)).toBe(29);
    tr.absolute(1);
    expect(tr.absolute(35)).toBe(50);   // 20 + 35 = 55, acotado
  });
});

describe('humanRange — un rango legible, sin falsa precisión', () => {
  it('redondea a minutos en vez de encadenar dos "y"', () => {
    // Componer dos humanDuration daba «entre 2 minutos y 17 s y 2 minutos y 51 s».
    const r = humanRange(137, 171, 'es');
    expect(r).toBe('entre 2 y 3 minutos');
    expect(r).not.toMatch(/y.*y.*y/);
  });

  it('si los extremos coinciden al redondear, dice uno solo', () => {
    expect(humanRange(125, 130, 'es')).toBe('alrededor de 2 minutos');
  });

  it('segundos para esperas cortas', () => {
    expect(humanRange(20, 40, 'es')).toBe('entre 20 y 40 segundos');
  });

  it('horas para esperas largas', () => {
    expect(humanRange(3700, 7000, 'es')).toBe('entre 1 y 2 horas');
  });

  it('funciona en inglés', () => {
    expect(humanRange(137, 171, 'en')).toBe('between 2 and 3 minutes');
  });

  it('nunca da un mínimo de cero', () => {
    // «entre 0 y 2 minutos» no informa nada.
    expect(humanRange(95, 100, 'es')).not.toMatch(/0/);
    expect(humanRange(91, 95, 'es')).not.toMatch(/0/);
  });

  it('concuerda el singular', () => {
    // «alrededor de 1 minutos» delata que nadie leyó la salida.
    expect(humanRange(60, 62, 'es')).toBe('alrededor de 1 minuto');
    expect(humanRange(3500, 3700, 'es')).toBe('alrededor de 1 hora');
    expect(humanRange(60, 62, 'en')).toBe('about 1 minute');
  });

  it('NO ensancha un rango estrecho', () => {
    // 125 y 130 s son ambos «dos minutos y pico»: decir «entre 2 y 3» sería inventar
    // una incertidumbre que la medición no tiene.
    expect(humanRange(125, 130, 'es')).toBe('alrededor de 2 minutos');
    // Este caso es el que de verdad distingue redondear de truncar: 170 y 175 s redondean
    // los dos a 3 min, pero truncando darían 2 y 3 y saldría un rango inventado. El caso
    // anterior no lo distinguía, y una prueba de mutación lo demostró.
    expect(humanRange(170, 175, 'es')).toBe('alrededor de 3 minutos');
  });
});
