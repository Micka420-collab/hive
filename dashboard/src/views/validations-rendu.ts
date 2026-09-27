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
import type { DetailControle } from '../../../src/shared/validations-bac';
import { formatDuree } from '../ui';

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

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
 * — « le code de la production n'est pas en cause » — pour que personne ne
 * parte corriger du code à cause d'un bac mal préparé.
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
        'l’installation depuis le lockfile a échoué : le code de la production n’est pas en cause',
        'installing from the lockfile failed: the production’s code is not at fault',
      );
    case 'delai':
      return t(
        `${commande} arrêté : délai dépassé, verdict inconnu`,
        `${commande} stopped: time limit exceeded, verdict unknown`,
      );
    case 'annule':
      return t('non lancé : la tâche a été annulée', 'not run: the task was cancelled');
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
        `${commande} → ${code} : un outil du script est introuvable dans le bac — ce n’est pas un verdict sur la production`,
        `${commande} → ${code}: a tool the script needs is missing from the sandbox — not a verdict on the production`,
      );
    case 'interrompue':
      return t(
        'les validations ont été interrompues par une erreur du nœud',
        'validations were interrupted by a node error',
      );
  }
}
