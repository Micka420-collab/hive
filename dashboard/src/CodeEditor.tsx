// Éditeur de code intégré (CodeMirror 6) — complément à Hive : le diff et le
// résultat d'une tâche s'affichent dans un vrai éditeur (coloration syntaxique,
// numéros de ligne, recherche, pliage), éditable localement pour explorer.
//
// Chargé à la demande (React.lazy) : CodeMirror ne pèse sur le bundle que si
// l'utilisateur ouvre le tiroir d'une tâche.

import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

/** Éditabilité groupée (editable + readOnly cohérents) pour un compartiment. */
function editableExt(on: boolean): Extension {
  return [EditorView.editable.of(on), EditorState.readOnly.of(!on)];
}

export type CodeLang = 'diff' | 'javascript' | 'text';

interface Props {
  value: string;
  lang: CodeLang;
  editable?: boolean;
  onChange?: (value: string) => void;
}

function langExtension(lang: CodeLang): Extension {
  if (lang === 'diff') return StreamLanguage.define(diff);
  if (lang === 'javascript') return javascript({ typescript: true });
  return [];
}

export default function CodeEditor({ value, lang, editable = false, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const editComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Création unique de l'éditeur.
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          oneDark,
          EditorView.lineWrapping,
          langComp.current.of(langExtension(lang)),
          editComp.current.of(editableExt(editable)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line
  }, []);

  // Mise à jour du contenu quand la valeur externe change (sans recréer l'éditeur).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  // Reconfiguration du langage / de l'éditabilité via compartiments.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: langComp.current.reconfigure(langExtension(lang)) });
  }, [lang]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editComp.current.reconfigure(editableExt(editable)) });
  }, [editable]);

  return <div className="code-editor" ref={host} />;
}
