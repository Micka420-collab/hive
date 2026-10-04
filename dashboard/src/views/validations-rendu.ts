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
// des phrases : ce module les dit dans la langue de l'écran. Pur : du module
// partagé, il ne tire que des types et les mots des pannes (`DIRE_PANNE`, que
// l'Evaluator dit aussi) — rien ne le tire vers le DOM.

import type { ValidationProvenance } from '../../../src/orchestrator/evaluator';
import { DIRE_RAISON_PORTE, type PorteSecurite } from '../../../src/shared/porte-securite';
import {
  DIRE_PANNE,
  type ComparaisonBase,
  type DetailControle,
  type TestsNommes,
} from '../../../src/shared/validations-bac';
import { formatDuree } from '../ui';

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

/**
 * La porte de sécurité, volet par volet : son état, sa raison, l'outil qui a
 * tourné. Une Reine antérieure à la porte n'en rend pas — la ligne le dit,
 * plutôt que de laisser croire à un « rien trouvé ».
 */
export function resumePorte(porte: PorteSecurite | undefined, t: Traduire): string {
  if (!porte) return t('non rapportée par cette Reine', 'not reported by this Queen');
  const volet = (nom: string, v: PorteSecurite['secrets'] | PorteSecurite['dependances']) => {
    const [fr, en] = DIRE_RAISON_PORTE[v.raison];
    const combien = v.etat === 'constat' ? ` ×${v.total}` : '';
    const outil = v.outil ? ` · ${v.outil.nom} ${v.outil.version}` : '';
    return `${nom} ${v.etat}${combien} (${t(fr, en)}${outil})`;
  };
  return [
    volet(t('secrets', 'secrets'), porte.secrets),
    volet(t('dépendances', 'dependencies'), porte.dependances),
  ].join(' · ');
}

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

/** Des tests nommés : les noms rapportés, et ce que la borne a laissé tomber. */
function noms(tests: TestsNommes, t: Traduire): string {
  const reste = tests.total - tests.noms.length;
  return (
    tests.noms.join(' ; ') +
    (reste > 0 ? t(` ; … et ${reste} autre(s)`, ` ; … and ${reste} more`) : '')
  );
}

/**
 * La comparaison à la base (G11b), en une phrase : ce qui bloque d'abord, puis
 * ce qui reste rouge sans bloquer, puis ce que la production a réparé — et ce
 * que la comparaison a coûté, puisqu'elle double l'exécution.
 */
function texteComparaison(c: ComparaisonBase, t: Traduire): string {
  const morceaux: string[] = [];
  if (c.regressions.total > 0) {
    morceaux.push(
      t(
        `régression : ${noms(c.regressions, t)} — rouge à chaque exécution, jamais à la base`,
        `regression: ${noms(c.regressions, t)} — red on every run, never at the base`,
      ),
    );
  }
  if (c.instables.total > 0) {
    morceaux.push(
      t(
        `instable : ${noms(c.instables, t)} — rouge puis vert d’une exécution à l’autre : ni régression ni vert, verdict inconnu`,
        `flaky: ${noms(c.instables, t)} — red then green from one run to the next: neither a regression nor green, verdict unknown`,
      ),
    );
  }
  if (c.dejaRouges.total > 0) {
    morceaux.push(
      t(
        `déjà rouge à la base, non bloquant : ${noms(c.dejaRouges, t)}`,
        `already red at the base, not blocking: ${noms(c.dejaRouges, t)}`,
      ),
    );
  }
  if (c.ciblesPassees.total > 0) {
    morceaux.push(
      t(
        `cibles passées : ${noms(c.ciblesPassees, t)}`,
        `targets passed: ${noms(c.ciblesPassees, t)}`,
      ),
    );
  }
  const cout = c.memoire
    ? t('base déjà rejouée sur ce nœud', 'base already replayed on this node')
    : t(
        `base rejouée à part, ${formatDuree(c.surcoutMs)} de plus`,
        `base replayed apart, ${formatDuree(c.surcoutMs)} extra`,
      );
  return t(
    `comparé test par test à la base (${c.executions.tete} exécution(s) de la production, ${c.executions.base} de la base ; ${cout}) — ${morceaux.join(' · ')}`,
    `compared test by test with the base (${c.executions.tete} run(s) of the production, ${c.executions.base} of the base; ${cout}) — ${morceaux.join(' · ')}`,
  );
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
      // `controleDepuis` exige la panne avec cette raison : l'absence n'est
      // que le repli du typage, dit sans remède plutôt qu'avec un faux.
      if (!detail.panne) {
        return t(
          `${commande} → ${code} : le bac est tombé en panne pendant l’exécution, verdict inconnu`,
          `${commande} → ${code}: the sandbox failed while it ran, verdict unknown`,
        );
      }
      const { nom, remede } = DIRE_PANNE[detail.panne];
      return t(
        `${commande} → ${code} : le bac est tombé en panne pendant l’exécution (${nom[0]}), verdict inconnu — ${remede[0]}`,
        `${commande} → ${code}: the sandbox failed while it ran (${nom[1]}), verdict unknown — ${remede[1]}`,
      );
    }
    case 'interrompue':
      return t(
        'les validations ont été interrompues par une erreur du nœud',
        'validations were interrupted by a node error',
      );
    case 'comparee':
    case 'instable': {
      // `controleDepuis` exige la comparaison avec ces raisons : l'absence
      // n'est que le repli du typage, dit sans rien inventer.
      const sortie = `${commande} → ${code}`;
      return detail.comparaison
        ? `${sortie} · ${texteComparaison(detail.comparaison, t)}`
        : t(
            `${sortie} : comparé à la base, détail absent`,
            `${sortie}: compared with the base, detail missing`,
          );
    }
  }
}
