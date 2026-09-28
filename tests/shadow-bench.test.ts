// Le banc d'ombre — la politique, prise au mot.
//
// Ce fichier tient les décisions PURES de `shadow-bench.ts` et leur repli dans
// le registre Genome :
//
//   · l'ÉCHANTILLON est déterministe et tient son taux ;
//   · l'ADMISSION refuse chaque cas pour SA raison, dans un ordre qui dit ce
//     qui bloquerait encore demain — une matrice, pas trois exemples ;
//   · le BUDGET arrête le banc (en vol, exécutions, coût déclaré), et une
//     exécution qui n'a rien déclaré ne passe jamais pour gratuite ;
//   · la COMPARAISON est rendue par les tests seuls, la contre-revue ne
//     touche qu'à la confiance ;
//   · le GENOME range ces faits à part, de provenance `shadow`, sans jamais
//     compter l'ombre dans les lignes de production.

import { describe, expect, it } from 'vitest';
import { antecedentsDuVecu, cle } from '../src/orchestrator/aiguillage.js';
import {
  BORNES_PETITE_TACHE,
  OMBRES_EN_VOL_MAX,
  actionExterne,
  arretBudget,
  choisirModeleOmbre,
  comparerOmbre,
  echantillonnee,
  issueDeCote,
  jugerAdmissionOmbre,
} from '../src/orchestrator/shadow-bench.js';
import type {
  CoteComparee,
  FaitsAdmission,
  MotifRefusOmbre,
  UsageBancOmbre,
} from '../src/orchestrator/shadow-bench.js';
import { registreGenomeDepuisEvenements } from '../src/shared/registre-genome.js';
import type { FaitOmbre } from '../src/shared/registre-genome.js';
import type { HiveEvent } from '../src/shared/types.js';

const sansUsage: UsageBancOmbre = {
  executions: 0,
  enVol: 0,
  coutDeclareUsd: 0,
  executionsMuettes: 0,
};

/** Une tâche que le banc ADMET : chaque cas de la matrice en change UN fait. */
const admissible = (over: Partial<FaitsAdmission> = {}): FaitsAdmission => ({
  titre: 'Ajouter une fonction de somme',
  prompt: 'écris somme(a, b) dans src/somme.ts',
  categorie: 'code',
  tests: 'passed',
  lignesModifiees: 12,
  fichiersTouches: 2,
  dureeMs: 60_000,
  delegation: false,
  modeleOriginal: 'opus',
  reglage: { actif: true, tauxPourMille: 1000, executionsParJour: 3, plafondCoutUsd: 1 },
  usage: sansUsage,
  modelesOfferts: ['opus', 'fable', 'fable'],
  modelesHorsBac: [],
  antecedents: { bras: new Map(), modeles: new Map() },
  ...over,
});

describe('l’échantillon — un hachage, pas un tirage', () => {
  it('rend toujours la même réponse pour la même tâche', () => {
    for (const id of ['t-1', 'a3f0c2d1-9e4b-4c55-8d2e-0b7f1a6c3e99', 'x']) {
      expect(echantillonnee(id, 50)).toBe(echantillonnee(id, 50));
    }
  });

  it('tient son taux : ~5 % de 20 000 identifiants à 50 ‰, tout à 1000 ‰', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `tache-${i}-${(i * 2654435761) >>> 0}`);
    const part = ids.filter((id) => echantillonnee(id, 50)).length / ids.length;
    expect(part).toBeGreaterThan(0.04);
    expect(part).toBeLessThan(0.06);
    expect(ids.every((id) => echantillonnee(id, 1000))).toBe(true);
  });

  it('un taux plus haut garde toutes les tâches d’un taux plus bas — on élargit, on ne rebat pas', () => {
    const ids = Array.from({ length: 2_000 }, (_, i) => `t${i}`);
    for (const id of ids.filter((i) => echantillonnee(i, 50))) {
      expect(echantillonnee(id, 200), id).toBe(true);
    }
  });
});

describe('l’admission — chaque refus pour SA raison', () => {
  it('admet une petite tâche testable, et choisit un AUTRE modèle que l’originale', () => {
    expect(jugerAdmissionOmbre(admissible())).toEqual({
      admise: true,
      modeleOriginal: 'opus',
      modeleOmbre: 'fable',
    });
  });

  const matrice: Array<[string, Partial<FaitsAdmission>, MotifRefusOmbre]> = [
    ['aucune validation rangée', { tests: null }, 'non_testable'],
    ['tests manquants (pas de bac)', { tests: 'missing' }, 'non_testable'],
    ['aucun test déclaré par le projet', { tests: 'not_applicable' }, 'non_testable'],
    ['prompt trop long', { prompt: 'x'.repeat(BORNES_PETITE_TACHE.promptMax + 1) }, 'trop_grande'],
    ['diff trop long', { lignesModifiees: BORNES_PETITE_TACHE.lignesMax + 1 }, 'trop_grande'],
    ['trop de fichiers', { fichiersTouches: BORNES_PETITE_TACHE.fichiersMax + 1 }, 'trop_grande'],
    ['trop longue', { dureeMs: BORNES_PETITE_TACHE.dureeMaxMs + 1 }, 'trop_grande'],
    ['déploiement', { prompt: 'déploie le site en production' }, 'action_externe'],
    ['poussée git', { titre: 'Faire un git push de la branche' }, 'action_externe'],
    ['connecteur', { prompt: 'poste le résumé sur Slack' }, 'action_externe'],
    ['publication', { prompt: 'publish the package to npm' }, 'action_externe'],
    // Les trous de la première version (sous-chaînes nues) : chacun passait.
    ['« push » en fin de titre', { titre: 'Fix the typo, commit and push' }, 'action_externe'],
    ['une pull request', { prompt: 'Open a pull request with the fix' }, 'action_externe'],
    ['gh pr create', { prompt: 'gh pr create for this change' }, 'action_externe'],
    [
      'une API en écriture',
      { prompt: 'curl -X POST https://api.example.com/items' },
      'action_externe',
    ],
    ['un téléversement', { prompt: 'Upload the build to S3' }, 'action_externe'],
    ['kubectl apply', { prompt: 'kubectl apply -f deploy.yaml' }, 'action_externe'],
    ['terraform apply', { prompt: 'run terraform apply on staging' }, 'action_externe'],
    ['une copie distante', { prompt: 'scp the report to the build server' }, 'action_externe'],
    // Les tournures relevées par la relecture indépendante, une par famille.
    [
      'PR puis gh pr create',
      { prompt: 'Corrige le bug puis ouvre une pull request avec gh pr create' },
      'action_externe',
    ],
    ['open a PR', { prompt: 'Fix the parser and open a PR' }, 'action_externe'],
    ['ouvre une PR', { prompt: 'Corrige le parseur et ouvre une PR' }, 'action_externe'],
    ['créer une issue', { prompt: 'Crée une issue GitHub pour le bug restant' }, 'action_externe'],
    ['create an issue', { prompt: 'Create an issue for the remaining bug' }, 'action_externe'],
    ['commenter l’issue', { prompt: 'Commente sur l’issue avec le correctif' }, 'action_externe'],
    [
      'un webhook par curl',
      { prompt: 'Appelle curl -X POST https://api.example.com/hooks pour notifier' },
      'action_externe',
    ],
    ['aws s3 cp', { prompt: 'Copy the build with aws s3 cp' }, 'action_externe'],
    ['gh release', { prompt: 'Then gh release the binaries' }, 'action_externe'],
    ['git tag', { prompt: 'Bump the version and git tag it' }, 'action_externe'],
    ['un tweet', { prompt: 'Tweet the changelog' }, 'action_externe'],
    ['un SMS', { prompt: 'Envoie le code par SMS' }, 'action_externe'],
    ['twine upload', { prompt: 'twine upload dist/*' }, 'action_externe'],
    ['« push » tout seul en fin de texte', { prompt: 'fix the typo then push' }, 'action_externe'],
    ['délégation', { delegation: true }, 'delegation'],
    ['aucun modèle commandé', { modeleOriginal: null }, 'modele_inconnu'],
    ['une ombre en vol', { usage: { ...sansUsage, enVol: OMBRES_EN_VOL_MAX } }, 'ombre_en_vol'],
    ['exécutions épuisées', { usage: { ...sansUsage, executions: 3 } }, 'budget_executions'],
    ['coût au plafond', { usage: { ...sansUsage, coutDeclareUsd: 1 } }, 'budget_cout'],
    ['seul le modèle original est offert', { modelesOfferts: ['opus'] }, 'aucun_second_modele'],
    ['aucune ouvrière en ligne', { modelesOfferts: [] }, 'aucun_second_modele'],
    [
      'l’autre modèle n’est offert que hors bac isolé',
      { modelesOfferts: ['opus'], modelesHorsBac: ['fable'] },
      'aucun_bac_isole',
    ],
    [
      'hors bac, seulement le modèle original : rien à dire du bac',
      { modelesOfferts: [], modelesHorsBac: ['opus'] },
      'aucun_second_modele',
    ],
  ];
  it.each(matrice)('%s → %s', (_cas, over, motif) => {
    expect(jugerAdmissionOmbre(admissible(over))).toEqual({ admise: false, motif });
  });

  it('les tests rouges de l’originale restent testables — le banc compare, il ne juge pas l’originale', () => {
    expect(jugerAdmissionOmbre(admissible({ tests: 'failed' })).admise).toBe(true);
  });

  it('l’ordre dit ce qui bloquerait encore demain : le structurel avant le budget', () => {
    const tout = admissible({
      tests: null,
      prompt: 'déploie en production',
      delegation: true,
      usage: { ...sansUsage, executions: 99, enVol: 1 },
    });
    expect(jugerAdmissionOmbre(tout)).toEqual({ admise: false, motif: 'non_testable' });
    expect(jugerAdmissionOmbre({ ...tout, tests: 'passed' })).toEqual({
      admise: false,
      motif: 'action_externe',
    });
  });

  it('le filtre externe ne mord pas sur le français courant', () => {
    expect(actionExterne('ajoute la notion de priorité aux tâches')).toBeNull();
    expect(actionExterne('améliore la production du rapport hebdomadaire')).toBeNull();
    // `\b` borne les mots courts : un prompt n'est pas une PR, un `curl` qui
    // LIT n'écrit chez personne.
    expect(actionExterne('améliore le prompt du résumé')).toBeNull();
    expect(actionExterne('ajoute un test qui fait curl https://example.com/health')).toBeNull();
    expect(actionExterne('mets le correctif en production')).toBe('en production');
    expect(actionExterne('envoie un email de bienvenue')).not.toBeNull();
  });
});

describe('le budget — il arrête, et il ne devine rien', () => {
  const reglage = { executionsParJour: 2, plafondCoutUsd: 0.5 };

  it('s’arrête à la cause la plus immédiate', () => {
    expect(arretBudget(reglage, sansUsage)).toBeNull();
    expect(arretBudget(reglage, { ...sansUsage, enVol: 1, executions: 5 })).toBe('ombre_en_vol');
    expect(arretBudget(reglage, { ...sansUsage, executions: 2 })).toBe('budget_executions');
    expect(arretBudget(reglage, { ...sansUsage, coutDeclareUsd: 0.5 })).toBe('budget_cout');
    expect(arretBudget(reglage, { ...sansUsage, coutDeclareUsd: 0.49 })).toBeNull();
  });

  it('une exécution MUETTE n’est pas comptée gratuite : le nombre d’ombres la borne', () => {
    // Codex ne déclare pas son coût : le plafond ne la voit pas, c'est dit,
    // et c'est `executionsParJour` qui arrête le banc.
    const muettes = { ...sansUsage, executions: 1, executionsMuettes: 1 };
    expect(arretBudget(reglage, muettes)).toBeNull();
    expect(arretBudget(reglage, { ...muettes, executions: 2 })).toBe('budget_executions');
  });
});

describe('le second modèle — emprunté à l’Aiguillage, jamais écrit', () => {
  // Aiguillage v3 (#519) : plus de `+∞`. Un modèle jamais jugé part d'un a
  // priori fini — il passe devant un modèle connu qui déçoit, pas devant un
  // modèle connu et bon.
  const verdicts = (sonnet: 'appliquer' | 'refaire') =>
    antecedentsDuVecu(
      [
        { title: 'Ajouter', prompt: 'implémente', modele: 'opus', suite: 'appliquer' as const },
        ...Array.from({ length: 3 }, () => ({
          title: 'Ajouter',
          prompt: 'implémente',
          modele: 'sonnet',
          suite: sonnet,
        })),
      ],
      [],
    );

  it('explore un modèle jamais jugé quand le connu déçoit, jamais l’original', () => {
    const vecu = verdicts('refaire');
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'sonnet', 'haiku'], vecu)).toBe('haiku');
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'sonnet'], vecu)).toBe('sonnet');
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'opus'], vecu)).toBeNull();
    // Le classement est LU : le vécu sort intact.
    expect(vecu.modeles.get(cle('code', 'opus'))).toEqual({ essais: 1, recompenseTotale: 1 });
  });

  it('un modèle connu et bon n’est plus déplacé d’office par un inconnu', () => {
    expect(
      choisirModeleOmbre('code', 'opus', ['opus', 'sonnet', 'haiku'], verdicts('appliquer')),
    ).toBe('sonnet');
  });
});

describe('la comparaison — les tests décident, la contre-revue pèse la confiance', () => {
  const cote = (over: Partial<CoteComparee> = {}): CoteComparee => ({
    modele: 'm',
    issue: 'tests_verts',
    revue: 'validee',
    baseSha: 'a'.repeat(40),
    ...over,
  });

  it('issueDeCote : l’échec d’abord, puis le verdict des tests, sinon « sans preuve »', () => {
    expect(issueDeCote(false, 'passed')).toBe('echec');
    expect(issueDeCote(true, 'passed')).toBe('tests_verts');
    expect(issueDeCote(true, 'failed')).toBe('tests_rouges');
    expect(issueDeCote(true, 'missing')).toBe('sans_preuve');
    expect(issueDeCote(true, 'not_applicable')).toBe('sans_preuve');
    expect(issueDeCote(true, null)).toBe('sans_preuve');
  });

  it('deux productions vertes font une égalité — même contestée, mais la confiance tombe', () => {
    // Le verdict reste celui des tests (pas de préférence de modèle) ; une
    // relectrice qui dit « ce diff ne fait pas la tâche » retire aux tests
    // verts ce qu'ils prouvaient : jamais « haute » sur un côté contesté.
    expect(comparerOmbre(cote(), cote({ revue: 'contestee' }))).toEqual({
      verdict: 'egalite',
      confiance: 'faible',
    });
    expect(comparerOmbre(cote({ revue: 'contestee' }), cote({ issue: 'tests_rouges' }))).toEqual({
      verdict: 'originale_meilleure',
      confiance: 'faible',
    });
  });

  it('les tests rangent : échec < rouges < verts', () => {
    expect(comparerOmbre(cote({ issue: 'tests_rouges' }), cote()).verdict).toBe('ombre_meilleure');
    expect(comparerOmbre(cote(), cote({ issue: 'tests_rouges' })).verdict).toBe(
      'originale_meilleure',
    );
    expect(comparerOmbre(cote({ issue: 'tests_rouges' }), cote({ issue: 'echec' }))).toEqual({
      verdict: 'originale_meilleure',
      confiance: 'faible',
    });
  });

  it('un côté sans verdict de tests : indécis, confiance faible — rien n’est inventé', () => {
    expect(comparerOmbre(cote(), cote({ issue: 'sans_preuve' }))).toEqual({
      verdict: 'indecis',
      confiance: 'faible',
    });
  });

  it('deux bases CONNUES et différentes : indécis — l’ombre a pu trouver la solution déjà fusionnée', () => {
    expect(comparerOmbre(cote(), cote({ baseSha: 'b'.repeat(40) }))).toEqual({
      verdict: 'indecis',
      confiance: 'faible',
    });
    expect(
      comparerOmbre(cote({ issue: 'tests_rouges' }), cote({ baseSha: 'b'.repeat(40) })),
    ).toEqual({ verdict: 'indecis', confiance: 'faible' });
  });

  it('haute exige la même base connue ET une relecture qui VALIDE chaque côté', () => {
    expect(comparerOmbre(cote(), cote({ baseSha: null })).confiance).toBe('moyenne');
    expect(comparerOmbre(cote({ baseSha: null }), cote({ baseSha: null })).confiance).toBe(
      'moyenne',
    );
    expect(comparerOmbre(cote(), cote({ revue: 'absente' })).confiance).toBe('moyenne');
  });
});

describe('le Genome — des faits de provenance « shadow », à part', () => {
  let id = 0;
  const ev = (type: string, payload: Record<string, unknown>, ts = 1_000): HiveEvent => ({
    id: ++id,
    ts,
    type,
    payload,
  });
  const BASE = 'a'.repeat(40);
  /** Une ombre RANGÉE (`taches_ombre`) : l'originale verte et relue, l'ombre selon `over`. */
  const fait = (tacheOmbre: string, over: Partial<FaitOmbre> = {}): FaitOmbre => ({
    tacheOmbre,
    tacheOriginale: `orig-${tacheOmbre}`,
    categorie: 'code',
    modeleOriginal: 'opus',
    modeleOmbre: 'fable',
    creeA: 1_000,
    statut: 'done',
    original: { resultId: 7, succes: true, tests: 'passed', baseSha: BASE, revue: 'validee' },
    ombre: null,
    ...over,
  });

  it('compare, attribue à chaque modèle de SON point de vue, et ne compte pas l’ombre en production', () => {
    const ombres = new Set(['o1', 'o2', 'o3']);
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 'orig', nodeId: 'n1', modele: 'opus' }),
        ev('task_done', { taskId: 'orig', nodeId: 'n1', durationMs: 10 }),
        ev('task_assigned', { taskId: 'o1', nodeId: 'n2', modele: 'fable', ombre: true }),
        ev('task_done', { taskId: 'o1', nodeId: 'n2', durationMs: 10 }),
        ev('task_assigned', { taskId: 'o3', nodeId: 'n2', modele: 'fable', ombre: true }),
      ],
      (taskId) => (ombres.has(taskId) || taskId === 'orig' ? 'code' : null),
      Number.POSITIVE_INFINITY,
      false,
      (taskId) => ombres.has(taskId),
      [
        fait('o1', {
          creeA: 1_000,
          ombre: { resultId: 9, succes: true, tests: 'failed', baseSha: BASE, revue: 'validee' },
        }),
        // Close sans rien rendre (modèle disparu), et une encore en vol.
        fait('o2', { creeA: 2_000, statut: 'failed' }),
        fait('o3', { creeA: 3_000, statut: 'running' }),
      ],
    );

    // Les lignes de PRODUCTION ne voient que l'originale.
    expect(registre.lignes).toHaveLength(1);
    expect(registre.lignes[0]).toMatchObject({ modele: 'opus', affectations: 1, rendus: 1 });

    const banc = registre.ombre;
    expect(banc.provenance).toBe('shadow');
    expect(banc.total).toBe(3);
    expect(banc.comparaisons.map((c) => [c.tacheOmbre, c.etat])).toEqual([
      ['o3', 'en_vol'],
      ['o2', 'abandonnee'],
      ['o1', 'comparee'],
    ]);
    expect(banc.comparaisons[2]).toMatchObject({
      provenance: 'shadow',
      verdict: 'originale_meilleure',
      confiance: 'haute',
      original: { modele: 'opus', issue: 'tests_verts', revue: 'validee', resultId: 7 },
      ombre: { modele: 'fable', issue: 'tests_rouges', revue: 'validee', resultId: 9 },
    });
    expect(banc.lignes).toEqual([
      {
        provenance: 'shadow',
        modele: 'fable',
        categorie: 'code',
        comparaisons: 1,
        commeOmbre: 1,
        victoires: 0,
        defaites: 1,
        egalites: 0,
        indecises: 0,
        confiance: { haute: 1, moyenne: 0, faible: 0 },
      },
      {
        provenance: 'shadow',
        modele: 'opus',
        categorie: 'code',
        comparaisons: 1,
        commeOmbre: 0,
        victoires: 1,
        defaites: 0,
        egalites: 0,
        indecises: 0,
        confiance: { haute: 1, moyenne: 0, faible: 0 },
      },
    ]);
  });

  it('une ombre ÉLAGUÉE sans avoir rien rendu est abandonnée, pas en vol', () => {
    const registre = registreGenomeDepuisEvenements(
      [],
      () => 'code',
      Number.POSITIVE_INFINITY,
      false,
      () => false,
      [fait('o1', { statut: null })],
    );
    expect(registre.ombre.comparaisons[0]?.etat).toBe('abandonnee');
  });

  it('les comparaisons ne dépendent PAS du journal : un journal vide les garde toutes', () => {
    const registre = registreGenomeDepuisEvenements(
      [],
      () => null,
      Number.POSITIVE_INFINITY,
      true,
      () => false,
      [
        fait('o1', {
          ombre: { resultId: 9, succes: true, tests: 'passed', baseSha: BASE, revue: 'absente' },
        }),
      ],
    );
    expect(registre.ombre.comparaisons[0]).toMatchObject({
      etat: 'comparee',
      verdict: 'egalite',
      confiance: 'moyenne',
    });
  });

  it('une ombre, même hors de la liste reçue, reste HORS des lignes de production', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 'o-vieille', nodeId: 'n2', modele: 'fable' }),
        ev('task_done', { taskId: 'o-vieille', nodeId: 'n2', durationMs: 5 }),
      ],
      () => 'code',
      Number.POSITIVE_INFINITY,
      false,
      (taskId) => taskId === 'o-vieille',
    );
    expect(registre.lignes).toEqual([]);
    expect(registre.ombre.total).toBe(0);
  });
});
