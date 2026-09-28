// CE QUE L'ÉCRAN DIT D'UNE VALIDATION — d'où elle vient, et ce qui a tourné.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Les validations d'une production ont désormais DEUX producteurs : la CI
// GitHub d'une pull request, et le bac Hive du nœud qui a produit
// (`src/shared/validations-bac.ts`). Elles comptent autant l'une que l'autre
// pour l'Evaluator — c'est une décision du produit —, et c'est justement
// pourquoi l'écran doit toujours dire laquelle a parlé : un vert du bac n'est
// pas un vert de la CI, et le relecteur doit pouvoir le savoir d'un coup d'œil.
//
// La Reine range des FAITS TYPÉS (état, raison, script, code, durée), jamais
// des phrases : ce module les dit dans la langue de l'écran. Pur, et sans autre
// dépendance que les types — rien ne le tire vers le DOM.

import type { ValidationProvenance } from '../../../src/orchestrator/evaluator';
import type { DetailControle, PanneEnvironnement } from '../../../src/shared/validations-bac';
import { formatDuree } from '../ui';

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

/**
 * Chaque panne du bac, dans les deux langues. `inconnue` n'arrive pas du
 * réseau (`controleDepuis` exige la panne) : c'est le repli du typage.
 */
const PANNES: Record<PanneEnvironnement | 'inconnue', readonly [string, string]> = {
  memoire: ['mémoire épuisée', 'out of memory'],
  disque: ['disque plein', 'disk full'],
  dns: ['DNS indisponible', 'DNS unavailable'],
  demon: ['démon de conteneurs injoignable', 'container daemon unreachable'],
  affichage: ['aucun affichage', 'no display'],
  inconnue: ['panne non précisée', 'unspecified failure'],
};

/** Une ligne : quelle source, et à quoi elle est rattachée. */
export function resumeProvenance(provenance: ValidationProvenance, t: Traduire): string {
  if (provenance.source === 'github_pull_request') {
    return (
      `${t('CI GitHub', 'GitHub CI')} · ${provenance.depot} · PR #${provenance.pr} · ` +
      `${provenance.branch} · ${provenance.commitSha.slice(0, 8)}`
    );
  }
  return [
    t('bac Hive', 'Hive sandbox'),
    `${t('nœud', 'node')} ${provenance.nodeId}`,
    ...(provenance.baseSha ? [`base ${provenance.baseSha.slice(0, 8)}`] : []),
  ].join(' · ');
}

/**
 * Ce qu'un constat du bac dit, en une phrase.
 *
 * Chaque raison a SA phrase, et la table est exhaustive : TypeScript refuse une
 * raison ajoutée sans texte. Les raisons qui ne sont pas des verdicts le disent
 * — « verdict inconnu » — sans pour autant blanchir la production : une
 * installation qui échoue ou un outil introuvable peuvent venir du nœud
 * (réseau, registre) comme d'un lockfile ou d'une dépendance que la
 * production a cassés. La phrase nomme les deux, et le relecteur tranche.
 */
export function texteControle(detail: DetailControle, t: Traduire): string {
  const commande = detail.script ? `npm run ${detail.script}` : t('la commande', 'the command');
  const duree = detail.dureeMs === undefined ? null : formatDuree(detail.dureeMs);
  const code = detail.code === undefined ? '?' : String(detail.code);
  switch (detail.raison) {
    case 'termine':
      return duree === null
        ? `${commande} → ${code}`
        : t(`${commande} → ${code} en ${duree}`, `${commande} → ${code} in ${duree}`);
    case 'sans_manifeste':
      return t(
        'aucun package.json lisible à la base du dépôt : rien n’est déclaré',
        'no readable package.json at the repository base: nothing is declared',
      );
    case 'non_declare':
      return t('le projet ne déclare pas ce script', 'the project does not declare this script');
    case 'test_par_defaut':
      return t(
        '« test » est le script par défaut de npm init : aucun test déclaré',
        '“test” is npm init’s default script: no test declared',
      );
    case 'declaration_reecrite':
      return t(
        `la production a modifié ${commande} (ou ses crochets pre/post) : non lancé — une production ne se juge pas avec une commande qu’elle a réécrite`,
        `the production changed ${commande} (or its pre/post hooks): not run — a production is not judged by a command it rewrote`,
      );
    case 'npmrc_reecrit':
      return t(
        'la production a modifié .npmrc, qui règle la façon dont npm lance les scripts : non lancé',
        'the production changed .npmrc, which controls how npm runs scripts: not run',
      );
    case 'sans_bac':
      return t(
        'non lancé : ce nœud n’a pas de bac à sable, et le code d’un agent ne tourne pas sur l’hôte nu — installez podman, docker ou bubblewrap (HIVE_ISOLEMENT=auto les trouve au démarrage du nœud)',
        'not run: this node has no sandbox, and agent code does not run on the bare host — install podman, docker or bubblewrap (HIVE_ISOLEMENT=auto finds them when the node starts)',
      );
    case 'npm_indisponible':
      return t(
        'npm ne se lance pas dans le bac de ce nœud : le code de la production n’est pas en cause',
        'npm does not start in this node’s sandbox: the production’s code is not at fault',
      );
    case 'sans_lockfile':
      return t(
        'dépendances déclarées sans lockfile : le bac ne peut pas les installer à l’identique',
        'dependencies declared without a lockfile: the sandbox cannot install them reproducibly',
      );
    case 'preparation_echouee':
      return t(
        'l’installation depuis le lockfile a échoué, verdict inconnu — le nœud (réseau, registre) ou un lockfile que la production a désaccordé : voir la fin de la sortie',
        'installing from the lockfile failed, verdict unknown — the node (network, registry) or a lockfile the production put out of sync: see the end of the output',
      );
    case 'delai':
      return t(
        `${commande} arrêté : délai dépassé, verdict inconnu`,
        `${commande} stopped: time limit exceeded, verdict unknown`,
      );
    case 'annule':
      return t(
        'arrêté ou non lancé : la tâche a été annulée, ou son budget de délégation a expiré — verdict inconnu',
        'stopped or not run: the task was cancelled, or its delegation budget ran out — verdict unknown',
      );
    case 'lancement':
      return t(
        `${commande} n’a pas pu être lancé dans le bac`,
        `${commande} could not be started in the sandbox`,
      );
    case 'signal':
      return t(
        `${commande} arrêté par un signal : verdict inconnu`,
        `${commande} stopped by a signal: verdict unknown`,
      );
    case 'outil_introuvable':
      return t(
        `${commande} → ${code} : un outil du script est introuvable dans le bac, verdict inconnu — outil que ce bac n’a pas, ou dépendance que la production a retirée`,
        `${commande} → ${code}: a tool the script needs is missing from the sandbox, verdict unknown — a tool this sandbox lacks, or a dependency the production removed`,
      );
    case 'environnement': {
      const [fr, en] = PANNES[detail.panne ?? 'inconnue'];
      return t(
        `${commande} → ${code} : le bac est tombé en panne pendant l’exécution (${fr}), verdict inconnu — la production n’est pas mise en cause : libérez la ressource sur ce nœud`,
        `${commande} → ${code}: the sandbox failed while it ran (${en}), verdict unknown — the production is not blamed: free the resource on this node`,
      );
    }
    case 'interrompue':
      return t(
        'les validations ont été interrompues par une erreur du nœud',
        'validations were interrupted by a node error',
      );
  }
}
