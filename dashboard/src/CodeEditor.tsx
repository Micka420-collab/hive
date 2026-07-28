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
import { css } from '@codemirror/legacy-modes/mode/css';
import { xml } from '@codemirror/legacy-modes/mode/xml';
import { python } from '@codemirror/legacy-modes/mode/python';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { go } from '@codemirror/legacy-modes/mode/go';
import { c, java } from '@codemirror/legacy-modes/mode/clike';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';

/** Éditabilité groupée (editable + readOnly cohérents) pour un compartiment. */
function editableExt(on: boolean): Extension {
  return [EditorView.editable.of(on), EditorState.readOnly.of(!on)];
}

/**
 * Les langages que l'éditeur sait colorer.
 *
 * Les noms sont ceux que `shared/rayon.ts` rend depuis le serveur, et ce n'est
 * pas un hasard : c'est le serveur qui sait déjà ce qu'il a lu, et un client
 * qui devinerait tout seul finirait par afficher un `.png` comme du texte.
 *
 * AUCUNE DÉPENDANCE AJOUTÉE : tout vient de `@codemirror/legacy-modes`, déjà
 * installé pour le mode `diff`. Ajouter un paquet par langage aurait alourdi
 * le bundle bien plus que la coloration ne vaut.
 */
export type CodeLang =
  | 'diff'
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'css'
  | 'html'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'ruby'
  | 'php'
  | 'shell'
  | 'yaml'
  | 'sql'
  | 'texte'
  | 'text';

interface Props {
  value: string;
  lang: CodeLang;
  editable?: boolean;
  onChange?: (value: string) => void;
}

function langExtension(lang: CodeLang): Extension {
  switch (lang) {
    case 'diff':
      return StreamLanguage.define(diff);
    case 'javascript':
    case 'typescript':
      return javascript({ typescript: lang === 'typescript' });
    // JSON est un sous-ensemble de JavaScript : le colorer ainsi coûte zéro
    // octet de plus et rend exactement ce qu'on attend.
    case 'json':
      return javascript();
    case 'css':
      return StreamLanguage.define(css);
    // HTML et Markdown contiennent des balises : le mode XML les colore
    // correctement sans embarquer un analyseur complet.
    case 'html':
    case 'markdown':
      return StreamLanguage.define(xml);
    case 'python':
      return StreamLanguage.define(python);
    case 'rust':
      return StreamLanguage.define(rust);
    case 'go':
      return StreamLanguage.define(go);
    case 'java':
      return StreamLanguage.define(java);
    // PHP hors balises reste du C dans sa syntaxe : mieux que rien du tout.
    case 'php':
      return StreamLanguage.define(c);
    case 'ruby':
      return StreamLanguage.define(ruby);
    case 'shell':
      return StreamLanguage.define(shell);
    case 'yaml':
      return StreamLanguage.define(yaml);
    case 'sql':
      return StreamLanguage.define(standardSQL);
    default:
      // Un langage inconnu s'affiche SANS coloration plutôt que de ne pas
      // s'afficher : un fichier qu'on ne sait pas colorer reste un fichier
      // qu'on veut lire.
      return [];
  }
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
    // Montage unique : l'éditeur est créé une fois, puis mis à jour ci-dessous.
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
