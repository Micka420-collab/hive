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
import { antecedentsDuVecu } from '../src/orchestrator/aiguillage.js';
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
  antecedents: new Map(),
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
    ['délégation', { delegation: true }, 'delegation'],
    ['aucun modèle commandé', { modeleOriginal: null }, 'modele_inconnu'],
    ['une ombre en vol', { usage: { ...sansUsage, enVol: OMBRES_EN_VOL_MAX } }, 'ombre_en_vol'],
    ['exécutions épuisées', { usage: { ...sansUsage, executions: 3 } }, 'budget_executions'],
    ['coût au plafond', { usage: { ...sansUsage, coutDeclareUsd: 1 } }, 'budget_cout'],
    ['seul le modèle original est offert', { modelesOfferts: ['opus'] }, 'aucun_second_modele'],
    ['aucune ouvrière en ligne', { modelesOfferts: [] }, 'aucun_second_modele'],
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
  it('essaie d’abord un modèle jamais jugé sur ce genre (+∞), jamais l’original', () => {
    const antecedents = antecedentsDuVecu(
      [
        { title: 'Ajouter', prompt: 'implémente', modele: 'sonnet', suite: 'appliquer' },
        { title: 'Ajouter', prompt: 'implémente', modele: 'opus', suite: 'appliquer' },
      ],
      [],
    );
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'sonnet', 'haiku'], antecedents)).toBe(
      'haiku',
    );
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'sonnet'], antecedents)).toBe('sonnet');
    expect(choisirModeleOmbre('code', 'opus', ['opus', 'opus'], antecedents)).toBeNull();
    // Le classement est LU : les antécédents sortent intacts.
    expect(antecedents.get('code|opus')).toEqual({ essais: 1, recompenseTotale: 1 });
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

  it('deux productions vertes font une égalité — même si une relectrice en conteste une', () => {
    expect(comparerOmbre(cote(), cote({ revue: 'contestee' }))).toEqual({
      verdict: 'egalite',
      confiance: 'haute',
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

  it('haute exige la même base connue ET une relecture de chaque côté', () => {
    expect(comparerOmbre(cote(), cote({ baseSha: 'b'.repeat(40) })).confiance).toBe('moyenne');
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
  const annonce = (tacheOmbre: string, tacheOriginale: string, over = {}): HiveEvent =>
    ev('shadow_bench_started', {
      taskId: tacheOmbre,
      tacheOriginale,
      projectId: 'p',
      provenance: 'shadow',
      categorie: 'code',
      modeleOmbre: 'fable',
      original: {
        resultId: 7,
        modele: 'opus',
        succes: true,
        tests: 'passed',
        baseSha: 'a'.repeat(40),
      },
      ...over,
    });
  const validation = (taskId: string, resultId: number, tests: string): HiveEvent =>
    ev('validation_recorded', {
      source: 'hive_sandbox',
      taskId,
      resultId,
      baseSha: 'a'.repeat(40),
      validation: { tests, typecheck: 'not_applicable', build: 'not_applicable', lint: 'passed' },
    });
  const avis = (taskId: string, resultId: number, conteste: boolean): HiveEvent =>
    ev('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId,
      resultId,
      conteste,
    });

  it('compare, attribue à chaque modèle de SON point de vue, et ne compte pas l’ombre en production', () => {
    const ombres = new Set(['o1', 'o2', 'o3']);
    const registre = registreGenomeDepuisEvenements(
      [
        ev('task_assigned', { taskId: 'orig', nodeId: 'n1', modele: 'opus' }),
        ev('task_done', { taskId: 'orig', nodeId: 'n1', durationMs: 10 }),
        avis('orig', 7, false),
        annonce('o1', 'orig'),
        ev('task_assigned', { taskId: 'o1', nodeId: 'n2', modele: 'fable', ombre: true }),
        validation('o1', 9, 'failed'),
        ev('task_done', { taskId: 'o1', nodeId: 'n2', durationMs: 10 }),
        avis('o1', 9, false),
        // Une ombre abandonnée, une encore en vol.
        annonce('o2', 'orig2'),
        ev('task_failed', { taskId: 'o2', reason: 'modele_ombre_absent' }),
        annonce('o3', 'orig3'),
        ev('task_assigned', { taskId: 'o3', nodeId: 'n2', modele: 'fable', ombre: true }),
      ],
      (taskId) => (ombres.has(taskId) ? 'code' : taskId.startsWith('orig') ? 'code' : null),
      Number.POSITIVE_INFINITY,
      false,
      (taskId) => ombres.has(taskId),
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

  it('un avis sur une AUTRE production de l’originale ne pèse pas sur la confiance', () => {
    const registre = registreGenomeDepuisEvenements(
      [
        avis('orig', 6, true),
        annonce('o1', 'orig'),
        validation('o1', 9, 'passed'),
        ev('task_done', { taskId: 'o1', nodeId: 'n2' }),
        avis('o1', 9, false),
      ],
      () => 'code',
      Number.POSITIVE_INFINITY,
      false,
      (taskId) => taskId === 'o1',
    );
    expect(registre.ombre.comparaisons[0]).toMatchObject({
      verdict: 'egalite',
      confiance: 'moyenne',
      original: { revue: 'absente' },
    });
  });

  it('une ombre dont l’annonce est sortie de la fenêtre reste HORS des lignes de production', () => {
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
