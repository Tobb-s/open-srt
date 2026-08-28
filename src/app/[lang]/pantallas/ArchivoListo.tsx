import { Boton, Campo, Selector, Tarjeta } from '@/components/ui';
import { learnedRtf, sampleCount } from '@/lib/asr/learned';
import { rtfMedian, type ModelProfile } from '@/lib/asr/models';
import { roughEstimateRange } from '@/lib/asr/capabilities';
import type { StoredRun } from '@/lib/store/session';
import { humanDuration, humanRange, type dict, type Lang } from '@/lib/i18n';

/**
 * El archivo elegido, antes de arrancar: cuánto dura, cuánto va a tardar y con qué opciones.
 *
 * La estimación es **un techo, no una predicción**. Sin esa línea el número parece una
 * promesa, y con un audio con pausas se equivoca por casi el doble — medido con un video de
 * 30 minutos que terminó en 7 min 40 s contra los 13 que decía.
 */
export function ArchivoListo({
  t,
  lang,
  nombre,
  durationSec,
  fileKey,
  profile,
  audioLang,
  onAudioLang,
  separarHablantes,
  onSepararHablantes,
  corrida,
  onEmpezar,
  onRetomar,
  onDescartarCorrida,
  onOtroArchivo,
}: {
  t: ReturnType<typeof dict>;
  lang: Lang;
  nombre: string;
  durationSec: number;
  fileKey: string;
  profile: ModelProfile;
  audioLang: 'auto' | 'es' | 'en';
  onAudioLang: (v: 'auto' | 'es' | 'en') => void;
  separarHablantes: boolean;
  onSepararHablantes: (v: boolean) => void;
  corrida: StoredRun | null;
  onEmpezar: () => void;
  onRetomar: () => void;
  onDescartarCorrida: (fileKey: string) => void;
  onOtroArchivo: () => void;
}) {
  return (
    <Tarjeta className="space-y-3">
      <p className="font-medium">{nombre}</p>
      <p className="text-sm text-apagado">{t.file.duration(humanDuration(durationSec, lang))}</p>
      <p className="text-sm">
        {t.file.estimateBefore}{' '}
        <strong>
          {(() => {
            const aprendido = learnedRtf(profile.key);
            // Con RTF aprendido de este equipo, un número. Sin él, un RANGO: las
            // mediciones varían un 25 % y un valor único fingiría precisión.
            if (aprendido !== undefined) {
              return humanDuration(durationSec * aprendido, lang);
            }
            const r = roughEstimateRange(profile, durationSec);
            return r.single
              ? humanDuration(durationSec * rtfMedian(profile), lang)
              : humanRange(r.minSec, r.maxSec, lang);
          })()}
        </strong>
        <span className="text-apagado">
          {' — '}
          {/* De dónde sale el número. Presentar una estimación prestada de otro
              equipo como si fuera medida acá sería la mentira cómoda de siempre. */}
          {sampleCount(profile.key) > 0
            ? t.file.estimateLearned(sampleCount(profile.key))
            : t.file.estimateApprox}
        </span>
      </p>
      <p className="text-xs text-apagado">{t.file.estimateCeiling}</p>
      {durationSec > 1800 && (
        <p className="rounded-detalle bg-advertencia-fondo p-3 text-sm text-advertencia-titulo">
          {t.file.tooLong}
        </p>
      )}

      <Campo
        etiqueta={t.file.audioLang}
        ayuda={audioLang === 'auto' ? t.file.audioLangAutoWarn : t.file.audioLangHint}
      >
        <Selector
          value={audioLang}
          onChange={(e) => onAudioLang(e.target.value as 'auto' | 'es' | 'en')}
        >
          <option value="auto">{t.file.audioLangAuto}</option>
          <option value="es">{t.file.audioLangEs}</option>
          <option value="en">{t.file.audioLangEn}</option>
        </Selector>
      </Campo>

      <div className="pt-1">
        <label className="flex items-start gap-2 text-sm text-tinta-2">
          <input
            type="checkbox"
            checked={separarHablantes}
            onChange={(e) => onSepararHablantes(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-tinta">{t.speakers.label}</span>
            {/* El costo se dice ANTES de aceptar, no despues de esperar. */}
            <span className="mt-0.5 block text-xs text-apagado">{t.speakers.hint}</span>
          </span>
        </label>
      </div>

      {corrida && (
        <Tarjeta
          as="div"
          tono="aviso"
          relleno="chico"
          radio="chico"
          className="flex flex-wrap items-center gap-3 text-sm"
        >
          <p className="flex-1">
            {t.resume.offer(
              Math.round((corrida.doneBlocks / Math.max(1, corrida.blocks.length)) * 100),
            )}
          </p>
          <Boton variante="primario" tamano="chico" onClick={onRetomar}>
            {t.resume.button}
          </Boton>
          <Boton
            variante="sutil"
            tamano="ninguno"
            onClick={() => onDescartarCorrida(fileKey)}
            className="px-3 py-1.5 underline underline-offset-2"
          >
            {t.resume.discard}
          </Boton>
        </Tarjeta>
      )}

      <div className="flex gap-3 pt-1">
        <Boton variante="primario" tamano="grande" onClick={onEmpezar}>
          {t.run.start}
        </Boton>
        <Boton
          variante="sutil"
          tamano="ninguno"
          onClick={onOtroArchivo}
          className="px-4 py-2.5 text-apagado"
        >
          {t.result.newFile}
        </Boton>
      </div>
    </Tarjeta>
  );
}
