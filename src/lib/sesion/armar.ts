import type { TimedText } from '../vad/align';
import type { LoadedSession } from '../store/session';
import { defaultSpeakerName } from '../diar/diarize';

/**
 * Armar la sesión que ve el usuario, desde donde venga.
 *
 * ── Por qué esto vive acá y no en el componente ──
 *
 * Hasta el paso 2 del rediseño, este armado estaba escrito **tres veces** dentro de
 * `Transcribe.tsx`: al terminar de transcribir, al restaurar la sesión de una visita
 * anterior y al reabrir un archivo de la cola. Las tres copias mapeaban los mismos campos
 * y las tres podían divergir sin que nada fallara — la transcripción saldría igual, con un
 * campo distinto. Es el modo de fallo que este proyecto persigue desde E1.
 *
 * Y hay una razón más fuerte que la duplicación: **dentro del componente esto no se podía
 * probar**. `vitest.config.ts` recolecta `src/**` en entorno `node`, la suite entera vive
 * en `src/lib`, y los 88 mutantes también. Un refactor del componente daba los mismos 88
 * sobrevivientes aunque rompiera todo, porque ningún instrumento miraba ahí. Sacar la
 * lógica a `src/lib` no es prolijidad: es ponerla donde el instrumento la alcanza. Es lo
 * mismo que hizo E1 al extraer `transcribeBlocks` de la clase.
 */

/** Lo que se muestra en el editor, venga de transcribir recién o de la base local. */
export interface Sesion {
  id: string;
  fileName: string;
  segments: TimedText[];
  suspicious: boolean;
  audioUrl: string | null;
  /** Se decide por el tipo del archivo, no por su extensión: la extensión miente. */
  mediaKind: 'audio' | 'video';
  editedInitially: ReadonlySet<number>;
  inferMs: number;
}

/**
 * Si un `Blob` es video.
 *
 * Por el tipo declarado y no por la extensión: un `.mp4` renombrado a `.audio` sigue
 * trayendo su pista de imagen, y al revés. `null` —una sesión cuyo audio no entró en la
 * cuota— cuenta como audio: no hay imagen que mostrar de algo que no está.
 */
export function esVideo(blob: Blob | null | undefined): boolean {
  return blob?.type.startsWith('video/') ?? false;
}

/**
 * La sesión de una transcripción **recién terminada**.
 *
 * El renombre de hablantes pasa acá y no en el modelo: el modelo devuelve `0`, `1`, `2`, y
 * numerar desde 1 con un nombre legible es cosa de la interfaz. Un hablante que no sea un
 * número —ya renombrado a mano— se deja como está.
 */
export function sesionDeCorrida(opts: {
  id: string;
  fileName: string;
  segments: readonly TimedText[];
  suspicious: boolean;
  inferMs: number;
  blob: Blob;
  audioUrl: string | null;
  /** La plantilla del nombre, del diccionario del idioma en pantalla. */
  nombreHablante: (n: number) => string;
}): Sesion {
  return {
    id: opts.id,
    fileName: opts.fileName,
    segments: opts.segments.map((x) => ({
      ...x,
      speaker:
        x.speaker === undefined ? undefined : defaultSpeakerName(x.speaker, opts.nombreHablante),
    })),
    suspicious: opts.suspicious,
    audioUrl: opts.audioUrl,
    mediaKind: esVideo(opts.blob) ? 'video' : 'audio',
    // Recién transcripto: nada viene corregido a mano todavía.
    editedInitially: new Set(),
    inferMs: opts.inferMs,
  };
}

/**
 * La sesión de una transcripción **guardada**.
 *
 * Los tramos se copian campo por campo y no con `...x`: `StoredSegment` trae `sessionId`,
 * `index` y `edited`, que son de la base y no del editor. Arrastrarlos haría que el
 * editor exporte campos internos en el CSV y el JSON.
 */
export function sesionDeGuardada(cargada: LoadedSession, audioUrl: string | null): Sesion {
  return {
    id: cargada.session.id,
    fileName: cargada.session.fileName,
    segments: cargada.segments.map((x) => ({
      startSec: x.startSec,
      endSec: x.endSec,
      text: x.text,
      speaker: x.speaker,
    })),
    suspicious: cargada.session.suspicious,
    audioUrl,
    // El tipo viaja con el Blob dentro de IndexedDB, así que una sesión recuperada sigue
    // sabiendo que era un video.
    mediaKind: esVideo(cargada.audio) ? 'video' : 'audio',
    editedInitially: new Set(cargada.segments.filter((x) => x.edited).map((x) => x.index)),
    inferMs: cargada.session.inferMs,
  };
}

/**
 * Qué decirle al usuario sobre lo que quedó guardado.
 *
 * **Tres estados, no dos**, y la diferencia importa: guardado con audio, guardado sin audio
 * —no entró en la cuota, el texto sí quedó— y **no guardado**. Decir «el audio no entró»
 * cuando en realidad no se guardó nada sería mentir sobre lo que pasó.
 */
export function avisoDeGuardado(
  guardada: { audioStored: boolean } | undefined | null,
  textos: { conAudio: string; sinAudio: string },
): string | null {
  if (!guardada) return null;
  return guardada.audioStored ? textos.conAudio : textos.sinAudio;
}

/**
 * Si vale la pena guardar esta transcripción.
 *
 * Una sin una sola palabra no se guarda: la próxima visita ofrecería recuperar una pantalla
 * vacía, que es peor que no ofrecer nada.
 */
export function valeGuardar(segments: readonly TimedText[]): boolean {
  return segments.some((s) => s.text.trim());
}
