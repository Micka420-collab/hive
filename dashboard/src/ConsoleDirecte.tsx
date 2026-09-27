// La console EN DIRECT d'une tâche : ce que l'agent écrit, pendant qu'il l'écrit.
//
// ─── CE QU'ELLE MONTRE, ET CE QU'ELLE NE PRÉTEND PAS ────────────────────────
//
// La sortie standard de l'agent, caviardée par le nœud avant tout envoi
// (`src/shared/caviardage.ts`), cadencée à quatre morceaux de 4 Kio par seconde
// au plus (`src/adapters/sortie-directe.ts`) et gardée ici sur 256 Kio
// (`sorties-directes.ts`). C'est un APERÇU : sous une rafale, le nœud omet et
// le dit (« […] octets omis ») ; au-delà du plafond, l'écran évince le début
// et le dit aussi. Le log complet arrive avec le résultat, onglet « Logs ».
//
// ─── LES QUATRE GESTES D'UN TERMINAL ────────────────────────────────────────
//
//   · SUIVRE : la console colle au bas tant qu'on n'est pas remonté lire ;
//     remonter la détache (sinon chaque morceau arracherait la ligne qu'on
//     lit), revenir en bas — ou cocher « suivre » — la raccroche ;
//   · CHERCHER : ne garder que les lignes qui contiennent le texte, et dire
//     combien ;
//   · COPIER : tout le tampon, par le module commun (repli http compris) ;
//   · REPLIER : couper les lignes longues ou défiler de côté.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { copierTexte } from './copier';
import { useT } from './i18n';
import type { SortieTache } from './sorties-directes';

/** Distance au bas (px) sous laquelle on considère la console « en bas ». */
const SEUIL_BAS_PX = 24;

/**
 * Le texte de la console. Une course de drones fait écrire plusieurs nœuds
 * dans la même tâche : un bandeau `── nœud … ──` sépare leurs sorties, sans
 * quoi leurs lignes s'entremêleraient sans qu'on sache qui dit quoi.
 */
export function texteDeConsole(sortie: SortieTache): string {
  const plusieurs = new Set(sortie.morceaux.map((m) => m.nodeId)).size > 1;
  let precedent: string | null = null;
  let texte = '';
  for (const m of sortie.morceaux) {
    if (plusieurs && m.nodeId !== precedent) texte += `── nœud ${m.nodeId.slice(0, 8)} ──\n`;
    precedent = m.nodeId;
    texte += m.texte.endsWith('\n') ? m.texte : `${m.texte}\n`;
  }
  return texte;
}

interface Props {
  sortie: SortieTache | undefined;
}

export function ConsoleDirecte({ sortie }: Props) {
  const t = useT();
  const [suivre, setSuivre] = useState(true);
  const [replier, setReplier] = useState(true);
  const [recherche, setRecherche] = useState('');
  const [copie, setCopie] = useState<'ok' | 'echec' | null>(null);
  const zone = useRef<HTMLPreElement>(null);

  const texte = useMemo(() => (sortie ? texteDeConsole(sortie) : ''), [sortie]);
  const filtre = recherche.trim().toLowerCase();
  const lignes = useMemo(() => {
    const toutes = texte.split('\n');
    if (toutes[toutes.length - 1] === '') toutes.pop();
    return filtre ? toutes.filter((l) => l.toLowerCase().includes(filtre)) : toutes;
  }, [texte, filtre]);

  // Après le rendu, AVANT la peinture : sinon chaque morceau clignoterait en
  // haut puis sauterait en bas.
  useLayoutEffect(() => {
    const el = zone.current;
    if (el && suivre) el.scrollTop = el.scrollHeight;
  }, [lignes, suivre]);

  useEffect(() => {
    if (copie === null) return;
    const minuteur = window.setTimeout(() => setCopie(null), 1500);
    return () => window.clearTimeout(minuteur);
  }, [copie]);

  const auDefilement = () => {
    const el = zone.current;
    if (!el) return;
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight <= SEUIL_BAS_PX;
    if (enBas !== suivre) setSuivre(enBas);
  };

  const copier = async () => setCopie((await copierTexte(texte)) ? 'ok' : 'echec');

  return (
    <section className="console-directe" aria-labelledby="console-directe-titre">
      <div className="editor-bar">
        <h3 id="console-directe-titre" className="console-directe-titre">
          {t('Sortie en direct', 'Live output')}
        </h3>
        <div className="editor-actions">
          <input
            type="search"
            className="console-directe-recherche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder={t('chercher…', 'search…')}
            aria-label={t('Chercher dans la sortie', 'Search the output')}
          />
          <label className="toggle">
            <input type="checkbox" checked={suivre} onChange={(e) => setSuivre(e.target.checked)} />
            {t('suivre', 'follow')}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={replier}
              onChange={(e) => setReplier(e.target.checked)}
            />
            {t('replier', 'wrap')}
          </label>
          <button className="chip" onClick={copier} disabled={texte === ''}>
            {copie === 'ok'
              ? t('✔ copié', '✔ copied')
              : copie === 'echec'
                ? t('copie impossible', 'copy failed')
                : t('copier', 'copy')}
          </button>
        </div>
      </div>
      {sortie?.tronquee && (
        <p className="muted-text" data-testid="console-directe-tronquee">
          {t(
            'Début évincé : l’écran garde les 256 derniers Kio. Le log complet arrive avec le résultat.',
            'Beginning dropped: the screen keeps the last 256 KiB. The full log arrives with the result.',
          )}
        </p>
      )}
      {filtre && (
        <p className="muted-text" role="status">
          {t(`${lignes.length} ligne(s) trouvée(s)`, `${lignes.length} matching line(s)`)}
        </p>
      )}
      <pre
        ref={zone}
        className={`code-block scroll console-directe-zone${replier ? ' replie' : ''}`}
        data-testid="console-directe"
        onScroll={auDefilement}
        tabIndex={0}
        aria-live="off"
      >
        {texte === ''
          ? t('En attente de la sortie de l’agent…', 'Waiting for the agent’s output…')
          : lignes.join('\n')}
      </pre>
    </section>
  );
}
