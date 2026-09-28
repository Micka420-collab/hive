// LA BOUCLE HIVE → HIVE (V3) — pilotée par une ruche de laboratoire.
//
// La séquence doit : ne RIEN créer sans `--oui` ; dire avant de dépenser ce
// qui rendrait la mission impossible ; confier architecture → implémentation
// → QA dans cet ordre, chacune lisant la précédente comme DONNÉE ; attendre
// la relecture croisée ; s'arrêter à la porte — AVANT que la QA n'exécute la
// production — quand elle touche une surface sensible ou que personne d'une
// autre famille ne l'a relue, et ne livrer qu'après une validation humaine
// lue au journal ; ne livrer que la production que la QA a rejouée ; livrer
// et commenter dans le dépôt DU PROJET, même repris sans `--depot` ; ne jamais contourner un refus humain ni un refus de l'Evaluator ;
// refuser de continuer sur un projet dont l'autonomie livrerait hors de la
// porte ; livrer la production EXACTE jugée, puis joindre le rapport.
//
// Et le coureur ne doit pas POUVOIR faire plus : un banc relit sa source.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEPOT_HIVE,
  argumentsDeLaBoucle,
  idPhase,
  idQa,
  menerLaBoucle,
} from '../src/boucle-v3/boucle.js';
import type { OptionsBoucle, Reponse, RucheBoucle, TacheACreer } from '../src/boucle-v3/boucle.js';
import { MISSION_MAX, noteDe } from '../src/boucle-v3/prompts.js';
import { creerCaviardeur } from '../src/shared/caviardage.js';
import { FERMETURE_DONNEES, OUVERTURE_DONNEES } from '../src/shared/donnees-non-fiables.js';

const GRAINE = 'abcdef12';
const MISSION = 'Ajouter une ligne d’aide à la commande hive doctor';
const ARCHI = idPhase(GRAINE, 'architecture');
const IMPL = idPhase(GRAINE, 'implementation');
/** La QA de la première production de l'implémentation (#101). */
const QA = idQa(GRAINE, 101);

const creation = (chemin: string, lignes: string[]): string =>
  [
    `diff --git a/${chemin} b/${chemin}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${chemin}`,
    `@@ -0,0 +1,${lignes.length} @@`,
    ...lignes.map((l) => `+${l}`),
    '',
  ].join('\n');

const modification = (chemin: string): string =>
  [
    `diff --git a/${chemin} b/${chemin}`,
    `--- a/${chemin}`,
    `+++ b/${chemin}`,
    '@@ -1 +1 @@',
    '-avant',
    '+après',
    '',
  ].join('\n');

const DIFF_ANODIN = modification('src/shared/doctor.ts');
const DIFF_SENSIBLE =
  modification('src/shared/doctor.ts') + modification('.github/workflows/ci.yml');

const ok = (corps: unknown, status = 200): Reponse => ({
  status,
  corps,
  texte: JSON.stringify(corps),
});

interface Tache {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: string;
}

/**
 * Une ruche de laboratoire : chaque phase confiée est `running` au relevé
 * suivant, puis `done` avec sa production ; la relecture de l'implémentation
 * reste en vol un relevé de plus.
 */
function laboratoire(
  reglages: {
    familles?: string[];
    githubReine?: boolean;
    diffImpl?: string;
    decisionImpl?: string;
    niveau?: string;
    livraison?: Reponse;
    /** Les relecteurs de l'implémentation (défaut : codex relit claude-code). */
    relecteurs?: Record<string, unknown>[];
    /** Pendant la QA, un humain refuse l'implémentation et son retry produit à nouveau. */
    retryPendantQa?: boolean;
  } = {},
) {
  const appels: string[] = [];
  const taches = new Map<string, Tache>();
  const releves = new Map<string, number>();
  const resultats = new Map<string, { resultId: number; diff: string; success: boolean }[]>();
  const revues = new Map<string, 'approved' | 'rejected'>();
  const evenements: { id: number; type: string; payload: Record<string, unknown> }[] = [];
  const creees: TacheACreer[] = [];
  let prochainResultat = 100;
  let niveau = reglages.niveau ?? 'off';
  let repoUrl = DEPOT_HIVE;
  let retryFait = false;
  const familles = reglages.familles ?? ['claude-code', 'codex'];
  const emettre = (type: string, payload: Record<string, unknown>) =>
    evenements.push({ id: evenements.length + 1, type, payload });

  const produire = (t: Tache) => {
    const role = t.id.includes('-qa-') ? 'qa' : t.id.split('-').at(-1);
    const diff =
      role === 'architecture'
        ? creation(noteDe(GRAINE, 'architecture'), [
            '# Conception',
            'Toucher src/shared/doctor.ts.',
          ])
        : role === 'qa'
          ? creation(noteDe(GRAINE, 'qa'), ['npm run typecheck → 0'])
          : (reglages.diffImpl ?? DIFF_ANODIN);
    const liste = resultats.get(t.id) ?? [];
    liste.push({ resultId: prochainResultat++, diff, success: true });
    resultats.set(t.id, liste);
    t.status = 'done';
    emettre('task_done', { taskId: t.id, nodeId: 'n-claude' });
    const impl = taches.get(IMPL);
    if (role === 'qa' && reglages.retryPendantQa && !retryFait && impl) {
      // Le geste de la Miellerie, puis `retryFromEvaluator` : la revue est
      // effacée, et une nouvelle production arrive.
      retryFait = true;
      emettre('task_reviewed', { taskId: IMPL, state: 'rejected' });
      produire(impl);
    }
  };

  const ruche: RucheBoucle = {
    async instantane() {
      appels.push('instantane');
      for (const t of taches.values()) {
        const vus = (releves.get(t.id) ?? 0) + 1;
        releves.set(t.id, vus);
        if (t.status === 'running' && vus >= 2) produire(t);
        if (t.status === 'ready') t.status = 'running';
      }
      return ok({
        projects: [{ id: 'p1', name: 'Boucle V3', repoUrl }],
        nodes: familles.map((f, i) => ({
          id: `n-${i}`,
          name: `poste-${f}`,
          agentType: f,
          status: 'online',
        })),
        tasks: [...taches.values()],
      });
    },
    async lire(chemin) {
      appels.push(`GET ${chemin}`);
      if (chemin === '/api/github/status') return ok({ configure: reglages.githubReine ?? true });
      if (chemin === '/api/projects/p1/essaim') return ok({ niveau, depotInscrit: false });
      const evenementsDemandes = /^\/api\/events\?since=(\d+)&limit=(\d+)$/.exec(chemin);
      if (evenementsDemandes) {
        const depuis = Number(evenementsDemandes[1]);
        return ok(evenements.filter((e) => e.id > depuis).slice(0, Number(evenementsDemandes[2])));
      }
      const m = /^\/api\/tasks\/([^/]+)\/(evaluation|results)$/.exec(chemin);
      const id = decodeURIComponent(m?.[1] ?? '');
      if (m?.[2] === 'results') return ok(resultats.get(id) ?? []);
      if (m?.[2] === 'evaluation') {
        const impl = id === IMPL;
        return ok({
          decision: impl ? (reglages.decisionImpl ?? 'human_review_required') : 'accepted',
          reasons: ['revue humaine attendue'],
          evidence: {
            tests: 'passed',
            typecheck: 'passed',
            build: 'missing',
            lint: 'passed',
            validationProvenance: { source: 'hive_sandbox', nodeId: 'n-claude' },
            crossReview: {
              reviewers: impl
                ? (reglages.relecteurs ?? [
                    {
                      reviewerAgent: 'codex',
                      producerAgent: 'claude-code',
                      decision: 'appliquer',
                      reason: 'propre',
                    },
                  ])
                : [],
            },
            ...(impl && reglages.relecteurs?.length === 0
              ? { crossReviewImpossible: 'aucune autre famille en ligne' }
              : {}),
            // La relecture de l'implémentation rend un relevé après son `done`.
            crossReviewPending: impl && (releves.get(id) ?? 0) < 4 ? 1 : 0,
            humanReview: revues.get(id) ?? 'missing',
          },
        });
      }
      return ok({ error: 'inconnu' }, 404);
    },
    async creerProjet(corps) {
      appels.push(`POST projet ${corps.repoUrl}`);
      repoUrl = corps.repoUrl;
      return ok({ id: 'p1', name: corps.name }, 201);
    },
    async creerTache(projetId, tache) {
      appels.push(`POST tâche ${tache.id}`);
      creees.push(tache);
      taches.set(tache.id, {
        id: tache.id,
        projectId: projetId,
        title: tache.title,
        prompt: tache.prompt,
        status: 'ready',
      });
      return ok([{ id: tache.id }], 201);
    },
    async livrer(taskId, resultId) {
      appels.push(`POST livraison ${taskId} #${resultId}`);
      return (
        reglages.livraison ??
        ok(
          {
            pr: 42,
            urlPr: 'https://github.com/Micka420-collab/hive/pull/42',
            branche: `hive/${taskId}`,
            commitSha: 'c0ffee1234567890',
            fichiers: [],
          },
          201,
        )
      );
    },
    async patienter() {},
  };
  const commentaires: { depot: string; pr: number; corps: string }[] = [];
  const github = {
    async commenter(depot: string, pr: number, corps: string) {
      commentaires.push({ depot, pr, corps });
      return { status: 201 };
    },
  };
  return {
    ruche,
    github,
    appels,
    creees,
    commentaires,
    ecritures: () => appels.filter((a) => a.startsWith('POST')),
    /** Le geste humain de la Miellerie : l'état rangé ET le fait au journal. */
    revue(taskId: string, state: 'approved' | 'rejected') {
      revues.set(taskId, state);
      emettre('task_reviewed', { taskId, state });
    },
    /** Une nouvelle production de la tâche, arrivée après coup. */
    reproduire(taskId: string) {
      const t = taches.get(taskId);
      if (t) produire(t);
    },
    regler(n: string) {
      niveau = n;
    },
  };
}

const CAVIARDEUR = creerCaviardeur([]);
const OPTIONS: OptionsBoucle = { creer: true, mission: MISSION, graine: GRAINE };
/** La reprise telle que l'arrêt la dicte : `--oui --reprendre p1`, sans `--depot`. */
const REPRISE: OptionsBoucle = { creer: true, reprendre: 'p1' };

describe('la boucle V3 — ce qu’elle fait sans --oui', () => {
  it('SANS --oui RIEN N’EST CRÉÉ : elle lit la ruche, dit ce qu’elle ferait, et s’arrête', async () => {
    const labo = laboratoire();
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, {
      ...OPTIONS,
      creer: false,
    });
    expect(issue.issue).toBe('plan');
    expect(issue.issue === 'plan' && issue.message).toMatch(/Relancez avec --oui/);
    expect(issue.issue === 'plan' && issue.message).toMatch(/ne fusionne jamais/);
    expect(labo.ecritures()).toEqual([]);
    expect(labo.commentaires).toEqual([]);
  });

  it.each([
    [
      'une seule famille : pas de relecture croisée',
      { familles: ['claude-code', 'claude-code'] },
      /2 familles/,
    ],
    ['aucune ouvrière réelle', { familles: ['shell'] }, /2 familles/],
    ['la Reine sans jeton GitHub', { githubReine: false }, /HIVE_GITHUB_TOKEN/],
  ])('IMPOSSIBLE, DIT AVANT DE DÉPENSER — %s', async (_nom, reglages, motif) => {
    const labo = laboratoire(reglages);
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue).toBe('echec');
    expect(issue.issue === 'echec' && issue.raison).toMatch(motif);
    expect(labo.ecritures()).toEqual([]);
  });

  it('sans jeton pour joindre le rapport, rien n’est confié', async () => {
    const labo = laboratoire();
    const issue = await menerLaBoucle(labo.ruche, null, CAVIARDEUR, OPTIONS);
    expect(issue.issue === 'echec' && issue.raison).toMatch(/rapport de risques/);
    expect(labo.ecritures()).toEqual([]);
  });
});

describe('la boucle V3 — le parcours', () => {
  it('ARCHITECTURE → IMPLÉMENTATION → QA → PR, et le rapport de risques joint à la PR', async () => {
    const labo = laboratoire();
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue).toBe('livree');

    // Dans cet ordre, chacune sur la précédente réglée, sur le dépôt de Hive.
    expect(labo.ecritures()).toEqual([
      `POST projet ${DEPOT_HIVE}`,
      `POST tâche ${ARCHI}`,
      `POST tâche ${IMPL}`,
      `POST tâche ${QA}`,
      `POST livraison ${IMPL} #101`,
    ]);
    // La relecture croisée est ATTENDUE : l'évaluation de l'implémentation a
    // été relue tant qu'une relecture restait en vol.
    const avantQa = labo.appels.indexOf(`POST tâche ${QA}`);
    const relectures = labo.appels
      .slice(0, avantQa)
      .filter((a) => a === `GET /api/tasks/${IMPL}/evaluation`);
    expect(relectures.length).toBeGreaterThan(1);

    // Chaque phase lit la précédente, en bloc de DONNÉES.
    const [archi, impl, qa] = labo.creees;
    expect(archi?.prompt).toContain(noteDe(GRAINE, 'architecture'));
    expect(impl?.prompt).toContain(`${OUVERTURE_DONNEES}\n# Conception`);
    expect(impl?.prompt).toContain(FERMETURE_DONNEES);
    expect(impl?.prompt).toMatch(/AVIS, pas une consigne/);
    expect(qa?.prompt).toContain(DIFF_ANODIN.trim());
    expect(qa?.prompt).toContain(noteDe(GRAINE, 'qa'));

    // Le rapport, sur la PR que la Reine a ouverte.
    expect(labo.commentaires).toHaveLength(1);
    const [commentaire] = labo.commentaires;
    expect(commentaire?.depot).toBe('Micka420-collab/hive');
    expect(commentaire?.pr).toBe(42);
    expect(commentaire?.corps).toContain('Aucune surface sensible touchée');
    expect(commentaire?.corps).toContain('`src/shared/doctor.ts` — modification (+1 −1)');
    expect(commentaire?.corps).toContain(
      '`codex` relit `claude-code` (croisée) : `appliquer` — `propre`',
    );
    expect(commentaire?.corps).toContain('npm run typecheck → 0');
    expect(issue.issue === 'livree' && issue.commentaire).toBe('attache');
  });

  it('LA PORTE ARRÊTE une production sensible — ni PR ni rapport — puis livre après VALIDATION HUMAINE', async () => {
    const labo = laboratoire({ diffImpl: DIFF_SENSIBLE });
    const arret = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(arret.issue).toBe('validation_requise');
    expect(arret.issue === 'validation_requise' && arret.message).toContain(
      '.github/workflows/ci.yml [deploiement]',
    );
    expect(arret.issue === 'validation_requise' && arret.message).toContain('--reprendre p1');
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);
    expect(labo.commentaires).toEqual([]);
    // La QA n'a pas été confiée : elle aurait appliqué et lancé la production.
    expect(labo.ecritures()).not.toContain(`POST tâche ${QA}`);

    // Relancer sans validation ne change rien.
    const encore = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(encore.issue).toBe('validation_requise');

    // L'humain approuve dans la Miellerie ; la reprise ne recrée rien, confie
    // la QA de la production approuvée, rejuge, et livre.
    labo.revue(IMPL, 'approved');
    const avant = labo.ecritures().length;
    const reprise = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(reprise.issue).toBe('livree');
    expect(labo.ecritures().slice(avant)).toEqual([
      `POST tâche ${QA}`,
      `POST livraison ${IMPL} #101`,
    ]);
    const corps = labo.commentaires[0]?.corps ?? '';
    expect(corps).toContain('validées par un humain');
    expect(corps).toContain('| `.github/workflows/ci.yml` | deploiement |');
    expect(corps).toContain(`Mission : ${MISSION}`);
  });

  it('LA PORTE PASSE AVANT LA QA : un script npm modifié ne s’exécute sur aucune machine', async () => {
    const labo = laboratoire({ diffImpl: modification('package.json') });
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue).toBe('validation_requise');
    expect(issue.issue === 'validation_requise' && issue.garde.touches[0]?.categorie).toBe(
      'auto-execution',
    );
    expect(labo.ecritures()).toEqual([
      `POST projet ${DEPOT_HIVE}`,
      `POST tâche ${ARCHI}`,
      `POST tâche ${IMPL}`,
    ]);
  });

  it('SANS RELECTURE D’UNE AUTRE FAMILLE, même libre, elle attend un humain', async () => {
    const labo = laboratoire({ relecteurs: [] });
    const arret = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(arret.issue).toBe('validation_requise');
    expect(arret.issue === 'validation_requise' && arret.message).toMatch(
      /aucune relecture d’une autre famille \(aucune autre famille en ligne\)/,
    );
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);

    labo.revue(IMPL, 'approved');
    const livree = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(livree.issue).toBe('livree');
    expect(labo.commentaires[0]?.corps).toContain(
      '⚠ Aucune relecture d’une autre famille — **validées par un humain**',
    );
  });

  it('LA QA PORTE SUR LA PRODUCTION LIVRÉE : une nouvelle production appelle sa propre QA', async () => {
    const labo = laboratoire({ retryPendantQa: true });
    const premier = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    // La QA a rejoué #101 ; l'implémentation a produit #103 entre-temps.
    expect(premier.issue).toBe('echec');
    expect(premier.issue === 'echec' && premier.raison).toMatch(
      /#103 a remplacé la #101 pendant la QA.*--reprendre p1/,
    );
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);

    const avant = labo.ecritures().length;
    const reprise = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(reprise.issue).toBe('livree');
    expect(labo.ecritures().slice(avant)).toEqual([
      `POST tâche ${idQa(GRAINE, 103)}`,
      `POST livraison ${IMPL} #103`,
    ]);
    expect(labo.commentaires[0]?.corps).toContain(`QA (tâche ${idQa(GRAINE, 103)}, done)`);
  });

  it('UNE REPRISE LIVRE ET COMMENTE DANS LE DÉPÔT DU PROJET — jamais dans un autre', async () => {
    const FORK = 'https://github.com/un-membre/hive';
    const labo = laboratoire({ diffImpl: DIFF_SENSIBLE });
    await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, { ...OPTIONS, depot: FORK });
    labo.revue(IMPL, 'approved');

    // Un `--depot` qui contredit le projet est refusé, sans rien écrire.
    const avant = labo.ecritures().length;
    const contredit = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, {
      ...REPRISE,
      depot: DEPOT_HIVE,
    });
    expect(contredit.issue === 'echec' && contredit.raison).toMatch(
      /--depot contredit le dépôt du projet p1 \(un-membre\/hive\)/,
    );
    expect(labo.ecritures().slice(avant)).toEqual([]);

    // La reprise que l'arrêt dicte (sans --depot) commente là où la Reine livre.
    expect((await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE)).issue).toBe(
      'livree',
    );
    expect(labo.commentaires.map((c) => c.depot)).toEqual(['un-membre/hive']);
  });

  it('UNE PRODUCTION QUI TOUCHE LA PORTE ELLE-MÊME attend un humain', async () => {
    const labo = laboratoire({ diffImpl: modification('src/boucle-v3/garde.ts') });
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue).toBe('validation_requise');
    expect(issue.issue === 'validation_requise' && issue.garde.touches[0]?.categorie).toBe('porte');
  });

  it('UNE APPROBATION D’AVANT LA DERNIÈRE PRODUCTION ne la couvre pas', async () => {
    const labo = laboratoire({ diffImpl: DIFF_SENSIBLE });
    await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    labo.revue(IMPL, 'approved');
    // Une nouvelle production arrive APRÈS l'approbation (sans effacer l'état
    // rangé — le pire cas) : la porte lit le journal, pas seulement l'état.
    labo.reproduire(IMPL);
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(issue.issue).toBe('validation_requise');
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);
  });

  it('UN REFUS HUMAIN n’est jamais contourné — même sur une production anodine', async () => {
    const labo = laboratoire({ diffImpl: DIFF_SENSIBLE });
    await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    labo.revue(IMPL, 'rejected');
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(issue.issue).toBe('refus_humain');
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);

    // Anodine et déjà livrée, puis refusée : une reprise ne la relivre pas.
    const anodin = laboratoire();
    expect((await menerLaBoucle(anodin.ruche, anodin.github, CAVIARDEUR, OPTIONS)).issue).toBe(
      'livree',
    );
    anodin.revue(IMPL, 'rejected');
    const refus = await menerLaBoucle(anodin.ruche, anodin.github, CAVIARDEUR, REPRISE);
    expect(refus.issue).toBe('refus_humain');
  });

  it('UNE AUTONOMIE ÉLARGIE arrête la boucle : la Reine livrerait hors de la porte', async () => {
    const labo = laboratoire({ diffImpl: DIFF_SENSIBLE });
    await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    labo.revue(IMPL, 'approved');
    labo.regler('gouverne');
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, REPRISE);
    expect(issue.issue).toBe('echec');
    expect(issue.issue === 'echec' && issue.raison).toMatch(/« gouverne ».*ne règle jamais/);
    expect(labo.ecritures().some((a) => a.startsWith('POST livraison'))).toBe(false);
  });

  it('LE REFUS DE L’EVALUATOR n’est jamais forcé', async () => {
    const labo = laboratoire({
      livraison: ok({ code: 'evaluator_blocks', error: 'l’Evaluator a rendu « rejected »' }, 409),
    });
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue).toBe('echec');
    expect(issue.issue === 'echec' && issue.raison).toMatch(/evaluator_blocks.*ne force jamais/);
    expect(labo.ecritures().filter((a) => a.startsWith('POST livraison'))).toHaveLength(1);
    expect(labo.commentaires).toEqual([]);
  });

  it('une implémentation que l’Evaluator arrête ne dépense pas de QA', async () => {
    const labo = laboratoire({ decisionImpl: 'correction_required' });
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, OPTIONS);
    expect(issue.issue === 'echec' && issue.raison).toMatch(/correction_required/);
    expect(labo.ecritures()).not.toContain(`POST tâche ${QA}`);
  });

  it('la reprise SANS --oui ne crée ni ne livre rien', async () => {
    const labo = laboratoire();
    await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, { ...OPTIONS, creer: false });
    // Un projet repris dont seule l'architecture existe…
    await labo.ruche.creerTache('p1', { id: ARCHI, title: 't', prompt: `Mission : ${MISSION}` });
    const avant = labo.ecritures().length;
    const issue = await menerLaBoucle(labo.ruche, labo.github, CAVIARDEUR, {
      ...REPRISE,
      creer: false,
    });
    expect(issue.issue).toBe('plan');
    expect(labo.ecritures().slice(avant)).toEqual([]);
  });
});

describe('les drapeaux', () => {
  it('lit la mission, et refuse ce qu’il ne connaît pas', () => {
    // Sans --depot, rien n'est fixé ici : une mission neuve vise DEPOT_HIVE,
    // une reprise le dépôt de son projet.
    expect(argumentsDeLaBoucle(['--racine', '.', '--mission', MISSION])).toEqual({
      racine: '.',
      creer: false,
      mission: MISSION,
    });
    expect(argumentsDeLaBoucle(['--racine', '.', '--mission', MISSION, '--ouii'])).toEqual({
      erreur: 'argument inconnu : --ouii',
    });
    expect(argumentsDeLaBoucle(['--racine', '.'])).toHaveProperty('erreur');
    expect(argumentsDeLaBoucle(['--racine', '.', '--mission', 'court'])).toHaveProperty('erreur');
    expect(
      argumentsDeLaBoucle(['--racine', '.', '--mission', 'x'.repeat(MISSION_MAX + 1)]),
    ).toHaveProperty('erreur');
    expect(
      argumentsDeLaBoucle(['--racine', '.', '--mission', MISSION, '--reprendre', 'p1']),
    ).toHaveProperty('erreur');
    // Hors GitHub, ou un jeton dans l'URL : refusé, et l'URL n'est pas recopiée.
    const ssh = argumentsDeLaBoucle([
      '--racine',
      '.',
      '--mission',
      MISSION,
      '--depot',
      'git@github.com:moi/hive.git',
    ]);
    expect(ssh).toHaveProperty('erreur');
    expect(JSON.stringify(ssh)).not.toContain('git@github.com');
  });

  it('une mission sur plusieurs lignes est aplatie : la reprise la relit sur une ligne', () => {
    const lue = argumentsDeLaBoucle(['--racine', '.', '--mission', `${MISSION}\net ensuite ceci`]);
    expect(lue).toHaveProperty('mission', `${MISSION} et ensuite ceci`);
  });
});

describe('le coureur ne PEUT pas fusionner, élargir ses droits, ni forcer', () => {
  const source = (f: string) =>
    readFileSync(new URL(`../src/boucle-v3/${f}`, import.meta.url), 'utf8');
  const code = (f: string) =>
    source(f)
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

  it('la Reine n’est jointe que par cinq routes, dont trois écrivent', () => {
    const main = code('main.ts');
    const ecrites = [...main.matchAll(/poster\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1]);
    expect(ecrites.sort()).toEqual([
      '/api/livraison',
      '/api/projects',
      '/api/projects/${encodeURIComponent(projetId)}/tasks',
    ]);
    const lues = [...main.matchAll(/lire\(\s*[`'"]([^`'"]+)[`'"]/g)].map((m) => m[1]);
    expect(lues).toEqual(['/api/state']);
    // Le seul autre `fetch` : le commentaire de la PR.
    expect(main.match(/\bfetch\(/g)).toHaveLength(2);
    expect(main).toMatch(/\/repos\/\$\{depot\}\/issues\/\$\{pr\}\/comments/);
  });

  it('aucune fusion, revue, autonomie ni forçage dans le code de la boucle', () => {
    for (const f of ['main.ts', 'boucle.ts', 'garde.ts', 'rapport.ts', 'prompts.ts']) {
      const c = code(f);
      expect(c, f).not.toMatch(
        /\/fusion|\/merge|\/review|\/evaluation\/retry|forcer|depotInscrit:/,
      );
      expect(c, f).not.toMatch(/method:\s*['"](PUT|PATCH|DELETE)/);
      if (f !== 'main.ts') expect(c, f).not.toMatch(/\bfetch\(/);
    }
    // Les seules lectures d'autonomie : un GET, qui refuse au-delà de `propose`.
    expect(code('boucle.ts')).toMatch(
      /ruche\.lire\(`\/api\/projects\/\$\{encodeURIComponent\(projetId\)\}\/essaim`\)/,
    );
  });

  it('npm run boucle:v3 passe par la porte unique des points d’entrée', () => {
    const paquet = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(paquet.scripts['boucle:v3']).toBe('node scripts/lancer.mjs src/boucle-v3/main.ts');
  });
});
