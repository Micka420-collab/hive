// Les workflows GitHub — la ruche lance ce que l'API DÉCLARE.
//
// ─── L'ASSERTION QUI PORTE LE FICHIER ────────────────────────────────────────
//
// L'API GitHub tend un piège précis :
//
//   POST /repos/{o}/{r}/actions/workflows/{id_OU_nom_de_fichier}/dispatches
//
// **Ce segment accepte les deux.** Accepter le nom de fichier laisserait un
// appelant écrire un morceau d'URL de l'API GitHub — avec le jeton de l'hôte,
// qui ouvre TOUS ses dépôts en lecture et souvent en écriture. C'est le secret
// le plus puissant qui approche une ruche.
//
// La ruche n'y met donc qu'un ENTIER, et un entier vérifié présent dans la
// liste que l'API vient de rendre. Même frontière que `chantier.ts` (« la ruche
// choisit dans ce que le dépôt déclare ») et `preparation.ts` — toutes deux
// écrites en fermant de vraies failles.

import { describe, expect, it } from 'vitest';
import {
  ErreurGithub,
  lancerWorkflow,
  listerWorkflows,
  lireRuns,
  type Fetcheur,
} from '../src/orchestrator/github.js';
import {
  estIdWorkflow,
  estRefPlausible,
  jugerWorkflow,
  lireRun,
  lireWorkflow,
  pourAfficher,
  pourChoisir,
  type Workflow,
} from '../src/shared/workflow.js';

const JETON = 'ghp_' + 'x'.repeat(36);

/** Un workflow tel que l'API le rend. */
const brut = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 161_335,
  name: 'CI',
  path: '.github/workflows/ci.yml',
  state: 'active',
  html_url: 'https://github.com/o/r/blob/main/.github/workflows/ci.yml',
  ...o,
});

const wf = (o: Partial<Workflow> = {}): Workflow => ({
  id: 161_335,
  nom: 'CI',
  chemin: '.github/workflows/ci.yml',
  etat: 'actif',
  htmlUrl: 'https://github.com/o/r',
  ...o,
});

/** Un faux GitHub : il retient ce qu'on lui demande et répond ce qu'on veut. */
function faux(reponses: Array<{ statut?: number; corps?: unknown }>): {
  f: Fetcheur;
  appels: Array<{ url: string; methode: string; corps: string | null }>;
} {
  const appels: Array<{ url: string; methode: string; corps: string | null }> = [];
  let i = 0;
  const f: Fetcheur = async (url, init) => {
    appels.push({
      url,
      methode: init?.method ?? 'GET',
      corps: typeof init?.body === 'string' ? init.body : null,
    });
    const r = reponses[Math.min(i++, reponses.length - 1)] ?? {};
    const statut = r.statut ?? 200;
    return {
      ok: statut >= 200 && statut < 300,
      status: statut,
      headers: { get: () => null },
      json: async () => r.corps ?? {},
    } as unknown as Response;
  };
  return { f, appels };
}

describe('LA RUCHE NE PEUT PAS INVENTER UN WORKFLOW', () => {
  it('UN NOM DE FICHIER EST REFUSÉ — c’est un morceau d’URL', () => {
    // L'assertion centrale. Si elle tombe, l'appelant écrit dans l'URL de
    // l'API GitHub, et un `../..` suffit à atteindre n'importe quel endpoint
    // avec le jeton de l'hôte.
    for (const faux of ['ci.yml', '../../user/repos', '161335', '']) {
      const v = jugerWorkflow([wf()], faux);
      expect(v.ok, JSON.stringify(faux)).toBe(false);
      if (!v.ok) expect(v.motif).toMatch(/identifiant numérique/);
    }
  });

  it('UN ID NON DÉCLARÉ EST REFUSÉ, et le refus dit ce qui existe', () => {
    const v = jugerWorkflow([wf()], 999);
    expect(v.ok).toBe(false);
    // Sinon l'appelant devine — et deviner sur cette frontière-là est
    // exactement ce qu'on refuse.
    if (!v.ok) expect(v.motif).toMatch(/CI \(161335\)/);
  });

  it('un dépôt sans aucun workflow le dit clairement', () => {
    const v = jugerWorkflow([], 1);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toMatch(/n’en déclare aucun/);
  });

  it('LES ENTIERS QUI N’EN SONT PAS SONT REFUSÉS', () => {
    // `Number.isSafeInteger` fait le travail : au-delà de 2⁵³, deux ids
    // distincts peuvent devenir ÉGAUX — et l'appartenance à la liste
    // vaudrait alors pour un autre workflow que celui qu'on croit.
    for (const v of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(estIdWorkflow(v), String(v)).toBe(false);
    }
    expect(estIdWorkflow(161_335)).toBe(true);
  });

  it('un workflow DÉSACTIVÉ est refusé ICI, pas par un 403 illisible', () => {
    // Personne ne déduit « désactivé pour inactivité depuis soixante jours »
    // d'un 403. Le dire localement est la seule façon que ce soit utile.
    const v = jugerWorkflow([wf({ etat: 'desactive_inactivite' })], 161_335);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motif).toMatch(/inactivité/);
      expect(v.motif).toMatch(/onglet Actions/);
    }
  });

  it('un workflow actif et déclaré passe', () => {
    const v = jugerWorkflow([wf()], 161_335);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.workflow.nom).toBe('CI');
  });
});

describe('CE QUI VIENT DE GITHUB EST UNE DONNÉE', () => {
  it('un nom de workflow ne peut pas fabriquer une fausse ligne', () => {
    // Le nom est écrit dans le dépôt, par quiconque peut y pousser. Il
    // traverse ensuite un événement, un écran et un journal.
    const w = lireWorkflow(brut({ name: 'CI\nrm -rf /' }));
    expect(w?.nom).toBe('CI rm -rf /');
  });

  it('un objet sans id utilisable n’est pas un workflow', () => {
    for (const mauvais of [null, 42, {}, brut({ id: 'ci.yml' }), brut({ name: '' })]) {
      expect(lireWorkflow(mauvais), JSON.stringify(mauvais)).toBeNull();
    }
  });

  it('une html_url qui n’est pas https est écartée', () => {
    expect(lireWorkflow(brut({ html_url: 'javascript:alert(1)' }))?.htmlUrl).toBe('');
  });

  it('L’ORDRE EST TOTAL — deux ruches proposent la même liste', () => {
    // Deux workflows peuvent porter le MÊME `name:` (deux fichiers distincts).
    // Sans l'id pour départager, leur ordre suivrait celui de la réponse HTTP.
    const a = pourChoisir([
      wf({ id: 3, nom: 'CI' }),
      wf({ id: 2, nom: 'CI' }),
      wf({ id: 9, nom: 'A' }),
    ]);
    expect(a.map((x) => x.id)).toEqual([9, 2, 3]);
  });
});

describe('LA RÉFÉRENCE GIT', () => {
  it('accepte ce qu’on écrit vraiment', () => {
    for (const r of ['main', 'v1.2.0', 'release/2026-07', 'feat_x-1', 'a.b.c']) {
      expect(estRefPlausible(r), r).toBe(true);
    }
  });

  it('REFUSE ce qui casserait une ligne ou une commande git', () => {
    for (const r of [
      '',
      ' ',
      'a b',
      'a\nb',
      '--upload-pack=sh',
      'a..b',
      'x.lock',
      '/a',
      'a/',
      '.a',
      'a.',
    ]) {
      expect(estRefPlausible(r), JSON.stringify(r)).toBe(false);
    }
  });
});

describe('LISTER — l’endpoint ne rend PAS un tableau', () => {
  it('LA RÉPONSE EST ENVELOPPÉE, et la lire comme un tableau rendrait une liste VIDE', async () => {
    // ─── LE PIÈGE QUE CE TEST FERME ────────────────────────────────────────
    //
    // `/user/repos` et `/issues` rendent des TABLEAUX. Celui-ci rend
    // `{ total_count, workflows: [...] }`. Copier la boucle des dépôts sans
    // le voir donnerait une liste vide SANS ERREUR — et « ce dépôt n'a aucun
    // workflow » est un mensonge parfaitement crédible, qu'on ne remettrait
    // pas en question.
    const { f } = faux([{ corps: { total_count: 1, workflows: [brut()] } }]);
    const r = await listerWorkflows({ jeton: JETON, fetcheur: f }, 'o/r');
    expect(r.workflows).toHaveLength(1);
    expect(r.workflows[0]?.id).toBe(161_335);
  });

  it('un nom de dépôt qui n’est pas owner/repo est refusé AVANT l’appel', async () => {
    const { f, appels } = faux([{ corps: { workflows: [] } }]);
    await expect(listerWorkflows({ jeton: JETON, fetcheur: f }, '../../etc')).rejects.toThrow(
      ErreurGithub,
    );
    expect(appels, 'aucun appel ne doit partir').toHaveLength(0);
  });

  it('un statut d’erreur devient un conseil, pas un code nu', async () => {
    const { f } = faux([{ statut: 401 }]);
    await expect(listerWorkflows({ jeton: JETON, fetcheur: f }, 'o/r')).rejects.toMatchObject({
      statut: 401,
      conseil: expect.stringContaining('settings/tokens'),
    });
  });
});

describe('LANCER — par l’id, et seulement s’il est déclaré', () => {
  it('LA LISTE EST RELUE À CHAQUE APPEL, jamais fournie par l’appelant', async () => {
    // Même règle que `lireUneIssue`, qui relit l'issue plutôt que de croire un
    // objet fourni par le client : un appelant qui fournirait la liste
    // fournirait aussi l'autorisation.
    const { f, appels } = faux([{ corps: { workflows: [brut()] } }, { statut: 204 }]);
    const r = await lancerWorkflow({ jeton: JETON, fetcheur: f }, 'o/r', 161_335, 'main');

    expect(r.workflow.nom).toBe('CI');
    expect(appels[0]?.url).toMatch(/\/repos\/o\/r\/actions\/workflows\?/);
    expect(appels[1]?.methode).toBe('POST');
    // L'ID, pas le nom de fichier — l'assertion qui tient toute la frontière.
    expect(appels[1]?.url).toMatch(/\/actions\/workflows\/161335\/dispatches$/);
    expect(appels[1]?.url).not.toMatch(/ci\.yml/);
    expect(JSON.parse(appels[1]?.corps ?? '{}')).toEqual({ ref: 'main' });
  });

  it('UN ID NON DÉCLARÉ N’ATTEINT JAMAIS L’API', async () => {
    const { f, appels } = faux([{ corps: { workflows: [brut()] } }]);
    await expect(lancerWorkflow({ jeton: JETON, fetcheur: f }, 'o/r', 999, 'main')).rejects.toThrow(
      ErreurGithub,
    );
    // UN seul appel : la liste. Le dispatch n'est jamais parti.
    expect(appels).toHaveLength(1);
    expect(appels[0]?.methode).toBe('GET');
  });

  it('une référence invalide est refusée AVANT même de lister', async () => {
    const { f, appels } = faux([{ corps: { workflows: [brut()] } }]);
    await expect(
      lancerWorkflow({ jeton: JETON, fetcheur: f }, 'o/r', 161_335, 'main\nx'),
    ).rejects.toThrow(ErreurGithub);
    expect(appels).toHaveLength(0);
  });

  it('LE 422 DIT LA VRAIE CAUSE — « réessayez » serait un mauvais conseil', async () => {
    // 422 sur cet endpoint a une cause quasi unique et PERMANENTE : le
    // workflow ne déclare pas `workflow_dispatch:`. Rien dans la liste des
    // workflows ne permet de le savoir d'avance — l'API ne dit pas quels
    // déclencheurs un workflow porte.
    const { f } = faux([{ corps: { workflows: [brut()] } }, { statut: 422 }]);
    await expect(
      lancerWorkflow({ jeton: JETON, fetcheur: f }, 'o/r', 161_335, 'main'),
    ).rejects.toMatchObject({
      statut: 422,
      conseil: expect.stringContaining('workflow_dispatch'),
    });
  });

  it('un workflow désactivé n’est pas lancé', async () => {
    const { f, appels } = faux([{ corps: { workflows: [brut({ state: 'disabled_manually' })] } }]);
    await expect(
      lancerWorkflow({ jeton: JETON, fetcheur: f }, 'o/r', 161_335, 'main'),
    ).rejects.toThrow(ErreurGithub);
    expect(appels).toHaveLength(1);
  });
});

describe('RELIRE LES RUNS', () => {
  const run = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 7,
    workflow_id: 161_335,
    name: 'CI',
    run_number: 42,
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    html_url: 'https://github.com/o/r/actions/runs/7',
    run_started_at: '2026-07-29T09:00:00Z',
    ...o,
  });

  it('UN RUN EN COURS N’EST PAS UN ÉCHEC', () => {
    // `conclusion` vaut `null` tant que le run n'est pas terminé. La confondre
    // avec « inconnue » afficherait un échec pour un run qui démarre — la
    // pire des deux erreurs possibles.
    expect(lireRun(run({ status: 'in_progress', conclusion: null }))?.conclusion).toBe('en_cours');
    expect(lireRun(run({ status: 'queued', conclusion: null }))?.conclusion).toBe('en_cours');
    expect(lireRun(run())?.conclusion).toBe('succes');
    expect(lireRun(run({ conclusion: 'failure' }))?.conclusion).toBe('echec');
  });

  it('le plus récent d’abord, l’id départageant les ex æquo', () => {
    const a = lireRun(run({ id: 1, run_started_at: '2026-07-29T09:00:00Z' }))!;
    const b = lireRun(run({ id: 2, run_started_at: '2026-07-29T10:00:00Z' }))!;
    const c = lireRun(run({ id: 3, run_started_at: '2026-07-29T10:00:00Z' }))!;
    expect(pourAfficher([a, b, c]).map((x) => x.id)).toEqual([3, 2, 1]);
  });

  it('une date illisible ne devient pas NaN', () => {
    // Un NaN se propagerait dans le tri et rendrait l'ordre indéfini.
    expect(lireRun(run({ run_started_at: 'jamais', created_at: undefined }))?.demarreA).toBe(0);
  });

  it('sans workflowId, on lit les runs du DÉPÔT', async () => {
    const { f, appels } = faux([{ corps: { workflow_runs: [run()] } }]);
    const r = await lireRuns({ jeton: JETON, fetcheur: f }, 'o/r');
    expect(r).toHaveLength(1);
    expect(appels[0]?.url).toMatch(/\/actions\/runs\?per_page=20$/);
  });

  it('avec un workflowId, on lit ceux de CE workflow — et l’id est vérifié', async () => {
    const { f, appels } = faux([{ corps: { workflow_runs: [] } }]);
    await lireRuns({ jeton: JETON, fetcheur: f }, 'o/r', { workflowId: 161_335 });
    expect(appels[0]?.url).toMatch(/\/actions\/workflows\/161335\/runs\?/);

    // Et un « id » qui serait un chemin n'atteint pas l'URL.
    const { f: g, appels: b } = faux([{ corps: {} }]);
    await expect(
      lireRuns({ jeton: JETON, fetcheur: g }, 'o/r', {
        workflowId: '../../user/repos' as unknown as number,
      }),
    ).rejects.toThrow(ErreurGithub);
    expect(b).toHaveLength(0);
  });

  it('la limite est bornée des deux côtés', async () => {
    const { f, appels } = faux([{ corps: { workflow_runs: [] } }]);
    await lireRuns({ jeton: JETON, fetcheur: f }, 'o/r', { limite: 10_000 });
    expect(appels[0]?.url).toMatch(/per_page=100$/);
  });

  it('une réponse sans `workflow_runs` rend une liste vide, pas une erreur', async () => {
    const { f } = faux([{ corps: { message: 'Not Found' } }]);
    expect(await lireRuns({ jeton: JETON, fetcheur: f }, 'o/r')).toEqual([]);
  });
});
