// La console EN DIRECT d'une tâche : ce que l'agent écrit, pendant qu'il l'écrit.
//
// ─── CE QU'ELLE MONTRE, ET CE QU'ELLE NE PRÉTEND PAS ────────────────────────
//
// La sortie de l'agent (stdout, stderr), caviardée par le nœud avant tout envoi
// (`src/shared/caviardage.ts`), cadencée à quatre morceaux de 4 Kio par seconde
// au plus (`src/adapters/sortie-directe.ts`) et gardée ici sur 256 Kio
// (`sorties-directes.ts`). C'est un APERÇU : sous une rafale, le nœud omet et
// le dit (« […] octets omis ») ; au-delà du plafond, l'écran évince le début
// et le dit aussi. Le log complet arrive avec le résultat, onglet « Logs ».
//
// ─── LES GESTES, ET LES NIVEAUX ─────────────────────────────────────────────
//
// Chercher, suivre, copier, replier, plein écran : ceux du `Terminal`
// commun (`composants/terminal.tsx`), les mêmes que le Journal. Le NIVEAU de
// chaque ligne est celui que le nœud a lu à la source (`shared/niveaux-sortie.ts`) :
// le flux (stdout, stderr), la gravité que le flux structuré de l'agent déclare
// (erreur, avertissement), ou une ligne de Hive. Un nœud qui ne le dit pas
// laisse ses lignes « niveau inconnu » — jamais rangées en stdout par défaut.
//
// L'heure d'une ligne est celle où CET écran a reçu son morceau : le nœud
// n'horodate pas sa sortie, et l'écran ne le prétend pas.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { NiveauSortie } from '../../src/shared/niveaux-sortie';
import { Terminal } from './composants';
import type { LigneTerminal, NiveauTerminal } from './composants';
import { useT } from './i18n';
import type { Translate } from './i18n';
import type { MagasinSorties, MorceauSortie, SortieTache } from './sorties-directes';

/** Le niveau d'une ligne à l'écran : celui du nœud, ou l'aveu qu'il ne l'a pas dit. */
type NiveauConsole = NiveauSortie | 'inconnu';

/** Les niveaux dans l'ordre des filtres ; les absents du tampon n'en montrent pas. */
function niveauxConsole(t: Translate): NiveauTerminal[] {
  const n = (cle: NiveauConsole, libelle: string, repere: string): NiveauTerminal => ({
    cle,
    libelle,
    repere,
  });
  return [
    n('stdout', 'stdout', '›'),
    n('stderr', 'stderr', '»'),
    n('avertissement', t('avertissement de l’agent', 'agent warning'), '⚠'),
    n('erreur', t('erreur de l’agent', 'agent error'), '✘'),
    n('hive', 'Hive', '⬡'),
    n('inconnu', t('niveau inconnu', 'unknown level'), '?'),
  ];
}

// Les lignes d'un morceau, calculées UNE fois : un morceau ne change jamais,
// et la console en reçoit quatre par seconde sur un tampon de 256 Kio. Des
// objets stables aussi — le Terminal y accroche ses mesures et son repère
// « nouvelles lignes ». Faiblement tenues : un morceau évincé les emporte.
const lignesParMorceau = new WeakMap<MorceauSortie, readonly LigneTerminal[]>();
const bandeauParMorceau = new WeakMap<MorceauSortie, LigneTerminal>();

function lignesDuMorceau(m: MorceauSortie): readonly LigneTerminal[] {
  const connues = lignesParMorceau.get(m);
  if (connues) return connues;
  const textes = m.texte.split('\n');
  if (textes[textes.length - 1] === '') textes.pop();
  const niveaux: NiveauConsole[] = [];
  for (const [niveau, n] of m.niveaux ?? []) for (let i = 0; i < n; i += 1) niveaux.push(niveau);
  const lignes = textes.map((texte, i): LigneTerminal => ({
    texte,
    niveau: niveaux[i] ?? 'inconnu',
    horodatage: m.recu,
  }));
  lignesParMorceau.set(m, lignes);
  return lignes;
}

/**
 * Les lignes de la console. Une course de drones fait écrire plusieurs nœuds
 * dans la même tâche : un bandeau `── nœud … ──` (une ligne de Hive) sépare
 * leurs sorties, sans quoi leurs lignes s'entremêleraient sans qu'on sache qui
 * dit quoi.
 */
export function lignesDeConsole(sortie: SortieTache): LigneTerminal[] {
  const plusieurs = new Set(sortie.morceaux.map((m) => m.nodeId)).size > 1;
  let precedent: string | null = null;
  const out: LigneTerminal[] = [];
  for (const m of sortie.morceaux) {
    if (plusieurs && m.nodeId !== precedent) {
      let bandeau = bandeauParMorceau.get(m);
      if (!bandeau) {
        bandeau = {
          texte: `── nœud ${m.nodeId.slice(0, 8)} ──`,
          niveau: 'hive',
          horodatage: m.recu,
        };
        bandeauParMorceau.set(m, bandeau);
      }
      out.push(bandeau);
    }
    precedent = m.nodeId;
    for (const l of lignesDuMorceau(m)) out.push(l);
  }
  return out;
}

/**
 * La console de la tâche `taskId`, abonnée au magasin pour CETTE tâche seule :
 * un morceau d'une autre tâche ne re-rend rien ici, et un morceau de celle-ci
 * ne re-rend que la console — pas le tiroir, pas le tableau de bord.
 */
export function ConsoleDeTache({
  magasin,
  taskId,
  enCours,
}: {
  magasin: MagasinSorties | undefined;
  taskId: string;
  /** Tâche assignée ou en cours : la console attend, même encore muette. */
  enCours: boolean;
}) {
  const abonner = useCallback(
    (prevenir: () => void) => magasin?.abonner(taskId, prevenir) ?? (() => {}),
    [magasin, taskId],
  );
  const sortie = useSyncExternalStore(abonner, () => magasin?.lire(taskId));
  // Tant qu'une sortie reste gardée, elle s'affiche : elle est vidée à la fin
  // de vie de la tâche, où l'onglet « Logs » prend le relais.
  if (!enCours && !sortie) return null;
  return <ConsoleDirecte sortie={sortie} />;
}

export function ConsoleDirecte({ sortie }: { sortie: SortieTache | undefined }) {
  const t = useT();
  const lignes = useMemo(() => (sortie ? lignesDeConsole(sortie) : []), [sortie]);
  const niveaux = useMemo(() => niveauxConsole(t), [t]);
  return (
    <div className="console-directe">
      <Terminal
        titre={t('Sortie en direct', 'Live output')}
        lignes={lignes}
        niveaux={niveaux}
        vide={t('En attente de la sortie de l’agent…', 'Waiting for the agent’s output…')}
        replierAuDepart
        libelleHeure={t('Heure de réception par cet écran', 'Time this screen received it')}
        testId="console-directe"
        avis={
          sortie?.tronquee && (
            <p className="muted-text" data-testid="console-directe-tronquee">
              {t(
                'Début évincé : l’écran garde les 256 derniers Kio. Le log complet arrive avec le résultat.',
                'Beginning dropped: the screen keeps the last 256 KiB. The full log arrives with the result.',
              )}
            </p>
          )
        }
      />
    </div>
  );
}
