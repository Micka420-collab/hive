// LE REGISTRE DES ANNONCES — ce sans quoi l'horloge ne peut pas se noter.
//
// `src/shared/horloge-chantier.ts` JUGE ; il ne se souvient de rien. Tant que
// personne n'écrit ce qui a été ANNONCÉ, `calibrer()` n'a rien à comparer : on
// sait combien de temps les tâches ont pris, jamais ce qu'on avait promis.
// Une horloge qui ne peut pas se noter est une horloge qu'il faut croire sur
// parole — c'est-à-dire l'inverse de ce qu'on voulait construire.
//
// Les bancs de ce fichier défendent surtout les façons SILENCIEUSES de fausser
// la note : compter deux fois une tâche ré-assignée, compter un échec comme un
// dépassement, ou jeter tout le passé de la ruche le jour de la mise en service.

import { describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import { calibrer, estimerDuree } from '../src/shared/horloge-chantier.js';

const min = (n: number) => n * 60_000;

function ruche() {
  const store = new HiveStore(':memory:');
  const projet = store.createProject({ name: 'Ruche' });
  return { store, projet };
}

/** Une tâche menée à son terme, annonce comprise. */
function menerATerme(
  store: HiveStore,
  projectId: string,
  o: { p80Ms: number; reelMs: number; caste?: string; reussie?: boolean; faiteA?: number },
) {
  const t = store.createTask({ projectId, title: 'T', prompt: 'p', dependsOn: [] });
  store.enregistrerAnnonce(
    t.id,
    'noeud-1',
    o.caste ?? 'nourrice',
    { socle: 'exact', n: 10, p50Ms: Math.round(o.p80Ms / 2), p80Ms: o.p80Ms },
    o.faiteA ?? 1000,
  );
  store.insertResult({
    taskId: t.id,
    nodeId: 'noeud-1',
    diff: '',
    logs: '',
    success: o.reussie ?? true,
    durationMs: o.reelMs,
    subAgents: [],
  });
  return t.id;
}

describe('le registre garde ce qu’on a ANNONCÉ, pas seulement ce qui est arrivé', () => {
  it('une annonce suivie d’un résultat devient jugeable', () => {
    const { store, projet } = ruche();
    menerATerme(store, projet.id, { p80Ms: min(10), reelMs: min(6) });
    const jugees = store.annoncesJugees();
    expect(jugees).toHaveLength(1);
    expect(jugees[0]).toEqual({ p80Ms: min(10), reelMs: min(6) });
  });

  it('une annonce SANS résultat n’est pas jugeable — la tâche court encore', () => {
    const { store, projet } = ruche();
    const t = store.createTask({ projectId: projet.id, title: 'T', prompt: 'p', dependsOn: [] });
    store.enregistrerAnnonce(t.id, 'n1', 'nourrice', { socle: 'exact', n: 9, p50Ms: 1, p80Ms: 2 });
    expect(store.annoncesJugees(), 'une tâche en cours n’a rien infirmé').toEqual([]);
  });

  // ─── LA PREMIÈRE FAÇON SILENCIEUSE DE FAUSSER LA NOTE ─────────────────────
  //
  // Une tâche ré-assignée après échec reçoit une annonce NEUVE. Garder les deux
  // ferait compter la même tâche deux fois — et c'est la seconde annonce que
  // l'humain a lue.
  it('ré-annoncer une tâche REMPLACE, ça ne s’empile pas', () => {
    const { store, projet } = ruche();
    const t = store.createTask({ projectId: projet.id, title: 'T', prompt: 'p', dependsOn: [] });
    store.enregistrerAnnonce(t.id, 'n1', 'nourrice', { socle: 'caste', n: 5, p50Ms: 1, p80Ms: 2 });
    store.enregistrerAnnonce(t.id, 'n2', 'butineuse', { socle: 'exact', n: 8, p50Ms: 3, p80Ms: 9 });
    store.insertResult({
      taskId: t.id,
      nodeId: 'n2',
      diff: '',
      logs: '',
      success: true,
      durationMs: 4,
      subAgents: [],
    });
    const jugees = store.annoncesJugees();
    expect(jugees, 'deux annonces pour une tâche = une tâche comptée deux fois').toHaveLength(1);
    expect(jugees[0]?.p80Ms, 'c’est la DERNIÈRE annonce qui compte').toBe(9);
  });

  // ─── LA DEUXIÈME ────────────────────────────────────────────────────────────
  //
  // Une tâche abandonnée n'a pas INFIRMÉ l'annonce : elle l'a rendue sans
  // objet. La compter comme un dépassement salirait la note avec des cas qui
  // ne la concernent pas — et l'horloge se croirait optimiste sans l'être.
  it('un ÉCHEC ne compte pas comme un dépassement', () => {
    const { store, projet } = ruche();
    menerATerme(store, projet.id, { p80Ms: min(10), reelMs: min(6) });
    menerATerme(store, projet.id, { p80Ms: min(10), reelMs: min(90), reussie: false });
    const jugees = store.annoncesJugees();
    expect(jugees).toHaveLength(1);
    expect(jugees[0]?.reelMs).toBe(min(6));
  });
});

describe('l’historique de prédiction', () => {
  // ─── LA TROISIÈME FAÇON DE SE TIRER UNE BALLE DANS LE PIED ────────────────
  //
  // Le jour de la mise en service, AUCUNE tâche passée n'a d'annonce. Un
  // `INNER JOIN` jetterait tout le passé de la ruche et l'horloge repartirait
  // muette — alors que la donnée de durée est là depuis toujours.
  it('les tâches d’AVANT l’horloge comptent encore, sans caste', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 6; i += 1) {
      const t = store.createTask({ projectId: projet.id, title: 'V', prompt: 'p', dependsOn: [] });
      store.insertResult({
        taskId: t.id,
        nodeId: 'n0',
        diff: '',
        logs: '',
        success: true,
        durationMs: min(i + 1),
        subAgents: [],
      });
    }
    const hist = store.historiqueDurees();
    expect(hist).toHaveLength(6);
    expect(
      hist.every((o) => o.caste === undefined),
      'sans annonce, pas de caste figée',
    ).toBe(true);
    // Et l'horloge sait quand même parler : socle global.
    expect(estimerDuree(hist, { caste: 'nourrice' }).socle).toBe('global');
  });

  it('avec annonce, la caste FIGÉE remonte — pas celle d’aujourd’hui', () => {
    const { store, projet } = ruche();
    menerATerme(store, projet.id, { p80Ms: min(9), reelMs: min(5), caste: 'batisseuse' });
    const hist = store.historiqueDurees();
    expect(hist[0]?.caste).toBe('batisseuse');
    expect(hist[0]?.dureeMs).toBe(min(5));
  });

  it('l’échec est rendu tel quel — c’est l’horloge qui décide de l’écarter', () => {
    const { store, projet } = ruche();
    menerATerme(store, projet.id, { p80Ms: min(9), reelMs: min(80), reussie: false });
    const hist = store.historiqueDurees();
    expect(hist[0]?.reussie, 'le magasin RAPPORTE, il ne juge pas').toBe(false);
  });

  it('la lecture est BORNÉE — cette table grossit à chaque tâche', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 8; i += 1) {
      const t = store.createTask({ projectId: projet.id, title: 'V', prompt: 'p', dependsOn: [] });
      store.insertResult({
        taskId: t.id,
        nodeId: 'n0',
        diff: '',
        logs: '',
        success: true,
        durationMs: min(i + 1),
        subAgents: [],
      });
    }
    expect(store.historiqueDurees(3)).toHaveLength(3);
    // Une limite absurde est ramenée dans les clous, pas propagée à SQLite.
    expect(store.historiqueDurees(0)).toHaveLength(1);
    expect(store.annoncesJugees(0)).toHaveLength(0);
  });
});

describe('la borne d’élagage — la doctrine, et le motif qui la règle', () => {
  it('les vieilles annonces partent, les récentes restent', () => {
    const { store, projet } = ruche();
    menerATerme(store, projet.id, { p80Ms: 1, reelMs: 1, faiteA: 1_000 });
    menerATerme(store, projet.id, { p80Ms: 2, reelMs: 2, faiteA: 900_000 });
    const partis = store.pruneAnnonces(500_000, 1_000_000);
    expect(partis).toBe(1);
    const restantes = store.annoncesJugees();
    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.p80Ms, 'c’est la récente qui survit').toBe(2);
  });

  // ─── L'INVARIANT SUR LEQUEL TOUTE LA CONCEPTION REPOSE ────────────────────
  //
  // Mon premier banc ici comparait `ANNONCES_RETENTION_MS` (une DURÉE) à
  // `RESULT_RETENTION` (un NOMBRE DE LIGNES). Comparer 180 jours à 5 000 lignes
  // est vrai quoi qu'il arrive : le rejeu l'a montré en ramenant la rétention à
  // UN jour sans faire rougir quoi que ce soit. C'était du décor, et le
  // commentaire qu'il défendait était faux.
  //
  // L'invariant qui compte vraiment est celui-ci : `pruneResults` ne SUPPRIME
  // pas les lignes, il vide leurs colonnes lourdes. `durationMs` survit donc,
  // et l'annonce est la moitié PÉRISSABLE du couple. Si un jour quelqu'un fait
  // de `pruneResults` un vrai DELETE, l'horloge perdra son réel sans que rien
  // ne le signale — c'est ici que ça doit rougir.
  it('élaguer les résultats n’efface PAS les durées — seulement le poids', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 6; i += 1) {
      const t = store.createTask({ projectId: projet.id, title: 'V', prompt: 'p', dependsOn: [] });
      store.insertResult({
        taskId: t.id,
        nodeId: 'n0',
        diff: 'x'.repeat(2000),
        logs: 'y'.repeat(2000),
        success: true,
        durationMs: min(i + 1),
        subAgents: [],
      });
    }
    // On n'en garde qu'un intact : les cinq autres passent à l'allègement.
    store.pruneResults(1);
    store.pruneResults(1);
    const hist = store.historiqueDurees();
    expect(hist, 'les LIGNES doivent survivre à l’allègement').toHaveLength(6);
    expect(
      hist.every((o) => o.dureeMs > 0),
      'une durée effacée priverait l’horloge de son réel',
    ).toBe(true);
  });
});

describe('les tâches ENCORE en vol — repérer celles qui sortent du domaine', () => {
  it('ne rend que les tâches assignées ou en cours', () => {
    const { store, projet } = ruche();
    const enVol = store.createTask({
      projectId: projet.id,
      title: 'A',
      prompt: 'p',
      dependsOn: [],
    });
    store.enregistrerAnnonce(
      enVol.id,
      'n1',
      'nourrice',
      { socle: 'exact', n: 9, p50Ms: 1, p80Ms: 2 },
      500,
    );
    store.patchTask(enVol.id, { status: 'running', assignedNodeId: 'n1' });
    // Une tâche TERMINÉE ne vole plus : elle n'a plus rien à dépasser.
    menerATerme(store, projet.id, { p80Ms: 1, reelMs: 1 });

    const vol = store.tachesEnVolAnnoncees();
    expect(vol).toHaveLength(1);
    expect(vol[0]).toMatchObject({
      taskId: enVol.id,
      nodeId: 'n1',
      caste: 'nourrice',
      faiteA: 500,
    });
  });

  it('une tâche en vol SANS annonce n’y figure pas — on ne saurait pas depuis quand', () => {
    const { store, projet } = ruche();
    const muette = store.createTask({
      projectId: projet.id,
      title: 'A',
      prompt: 'p',
      dependsOn: [],
    });
    store.patchTask(muette.id, { status: 'running', assignedNodeId: 'n1' });
    expect(store.tachesEnVolAnnoncees()).toEqual([]);
  });

  it('les plus ANCIENNES d’abord — ce sont elles qui inquiètent', () => {
    const { store, projet } = ruche();
    for (const [titre, quand] of [
      ['tard', 9_000],
      ['tôt', 1_000],
    ] as const) {
      const t = store.createTask({
        projectId: projet.id,
        title: titre,
        prompt: 'p',
        dependsOn: [],
      });
      store.enregistrerAnnonce(
        t.id,
        'n1',
        'nourrice',
        { socle: 'exact', n: 9, p50Ms: 1, p80Ms: 2 },
        quand,
      );
      store.patchTask(t.id, { status: 'running', assignedNodeId: 'n1' });
    }
    expect(store.tachesEnVolAnnoncees().map((v) => v.faiteA)).toEqual([1_000, 9_000]);
  });

  it('la lecture est bornée', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 5; i += 1) {
      const t = store.createTask({ projectId: projet.id, title: 'V', prompt: 'p', dependsOn: [] });
      store.enregistrerAnnonce(
        t.id,
        'n1',
        'nourrice',
        { socle: 'exact', n: 9, p50Ms: 1, p80Ms: 2 },
        i,
      );
      store.patchTask(t.id, { status: 'running', assignedNodeId: 'n1' });
    }
    expect(store.tachesEnVolAnnoncees(2)).toHaveLength(2);
    expect(store.tachesEnVolAnnoncees(0)).toHaveLength(1);
  });
});

describe('bout en bout — la ruche note son horloge', () => {
  it('huit annonces tenues sur dix ⇒ verdict « honnête »', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 10; i += 1) {
      menerATerme(store, projet.id, {
        p80Ms: min(10),
        reelMs: i < 8 ? min(5) : min(40),
        faiteA: 1000 + i,
      });
    }
    const c = calibrer(store.annoncesJugees());
    expect(c.n).toBe(10);
    expect(c.partTenue).toBeCloseTo(0.8, 5);
    expect(c.verdict).toBe('honnete');
  });

  it('quand la ruche déborde, l’horloge se déclare OPTIMISTE', () => {
    const { store, projet } = ruche();
    for (let i = 0; i < 10; i += 1) {
      menerATerme(store, projet.id, {
        p80Ms: min(10),
        reelMs: i < 3 ? min(5) : min(40),
        faiteA: 1000 + i,
      });
    }
    const c = calibrer(store.annoncesJugees());
    expect(c.verdict, 'promettre plus court que la réalité est l’écart le plus coûteux').toBe(
      'optimiste',
    );
    expect(c.ecart).toBeLessThan(0);
  });
});
