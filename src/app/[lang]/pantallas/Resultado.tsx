import { Boton } from '@/components/ui';
import type { TimedText } from '@/lib/vad/align';
import type { Sesion } from '@/lib/sesion/armar';
import type { dict, Lang } from '@/lib/i18n';
import Editor from '../Editor';

/**
 * La transcripción terminada, con el editor y lo que se puede hacer después.
 *
 * Una transcripción **sin una sola palabra** no muestra el editor: una lista de tramos
 * vacíos parece un error del programa, y decir que no se encontró habla es la verdad.
 */
export function Resultado({
  t,
  lang,
  sesion,
  traduccion,
  traduciendo,
  puedeTraducir,
  aviso,
  onTraducir,
  onEdit,
  onRenameSpeaker,
  onOtroArchivo,
  onBorrarTodo,
}: {
  t: ReturnType<typeof dict>;
  lang: Lang;
  sesion: Sesion;
  traduccion: TimedText[] | null;
  traduciendo: { done: number; total: number } | null;
  puedeTraducir: { destino: string; etiqueta: string } | null;
  aviso: string | null;
  onTraducir: () => void;
  onEdit: (index: number, text: string) => void;
  onRenameSpeaker: (anterior: string, nuevo: string) => void;
  onOtroArchivo: () => void;
  onBorrarTodo: () => void;
}) {
  return (
    <div className="space-y-4">
      {sesion.segments.some((s) => s.text.trim()) ? (
        <Editor
          key={sesion.id}
          lang={lang}
          segments={sesion.segments}
          suspicious={sesion.suspicious}
          audioUrl={sesion.audioUrl}
          mediaKind={sesion.mediaKind}
          fileName={sesion.fileName}
          editedInitially={sesion.editedInitially}
          traduccion={traduccion}
          traduciendo={traduciendo}
          puedeTraducir={puedeTraducir}
          onTraducir={onTraducir}
          onEdit={onEdit}
          onRenameSpeaker={onRenameSpeaker}
        />
      ) : (
        <p className="text-apagado">{t.result.empty}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-borde pt-4">
        <Boton
          variante="sutil"
          tamano="ninguno"
          onClick={onOtroArchivo}
          className="px-4 py-2 text-apagado"
        >
          {t.result.newFile}
        </Boton>
        <Boton
          variante="sutil"
          tamano="ninguno"
          onClick={onBorrarTodo}
          className="px-4 py-2 text-sm text-apagado underline underline-offset-2"
        >
          {t.store.clear}
        </Boton>
      </div>
      {aviso && <p className="text-xs text-apagado">{aviso}</p>}
    </div>
  );
}
