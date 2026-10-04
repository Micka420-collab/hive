// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE JOURNAL : CE QUE CHAQUE LIGNE DIT, DANS LES DEUX LANGUES.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// § 9 sexquinquagicenties, mesuré sur la Mémoire : une décision écrite DANS une
// chaîne traduite est autant de gardes qu'il y a de langues. Le recensement côté
// source avait nommé cinq appels `t(fr, en)` portant une décision ; deux sont
// fermés (Memoire). Deux des trois restants vivent ici.
//
// Mesuré AVANT d'écrire une ligne de banc — les six membres, un mutant à la
// fois, contre la suite entière :
//
//     NU · J1-FR  conflit  : String(p.severity ?? '')  →  String(p.severity)
//     NU · J1-EN  conflict : String(p.severity ?? '')  →  String(p.severity)
//     NU · J2-FR  course   : Array.isArray(p.drones)   →  !Array.isArray(…)
//     NU · J2-EN  race     : Array.isArray(p.drones)   →  !Array.isArray(…)
//
// Quatre sur quatre nues. Le Journal n'avait AUCUN banc à lui : il est monté
// par `vues-sentinelles` et `modales-echap`, qui regardent la coquille et pas le
// TEXTE des lignes.
//
// ─── CE QUE CHAQUE MUTATION COÛTE ────────────────────────────────────────────
//
// · `String(p.severity ?? '')` — sans le repli, un conflit dont la gravité n'est
//   pas remontée affiche « conflit undefined : … ». Le mot anglais du défaut
//   JavaScript, en plein milieu d'une phrase française, sur la ligne qui doit
//   avertir d'un conflit de fichiers.
//
// · `Array.isArray(p.drones) ? p.drones.length : p.factor` — le journal compte
//   les drones RÉELLEMENT enrôlés quand la liste est là, et retombe sur le
//   nombre DEMANDÉ quand elle ne l'est pas. Inversé, une course de trois drones
//   annoncerait le facteur brut : on lit un chiffre qui n'est pas ce qui vole.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Journal } from '../dashboard/src/Journal';
import { setLang } from '../dashboard/src/i18n';
import type { HiveEvent } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

/**
 * Un événement du journal, dans la forme RÉELLE de `HiveEvent`.
 *
 * L'annotation est la garde : un décor non typé peut décrire un monde que le
 * code ne produit jamais, et le banc meurt alors sur son décor au lieu de
 * rougir sur ce qu'il vise (§ 9 terquinquagicenties).
 */
const evenement = (type: string, payload: Record<string, unknown>): HiveEvent => ({
  id: 1,
  ts: 1_700_000_000_000,
  type,
  payload,
});

/** Le TEXTE de la ligne, pas le texte du panneau : l'icône et l'heure sont à côté. */
function ligne(dom: HTMLElement): string {
  const t = dom.querySelector('.journal .jrow .jtext');
  if (!t) throw new Error('aucune ligne de journal rendue');
  return t.textContent ?? '';
}

async function monter(ev: HiveEvent): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Journal events={[ev]} />));
  return conteneur;
}

describe('la ligne de conflit nomme sa gravité — et se tait quand elle l’ignore', () => {
  it('UNE GRAVITÉ CONNUE EST DITE', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER ──────────────────────────────────
    //
    // Sans lui, le cas suivant serait vert sur un journal qui n'affiche rien.
    // Les chemins sont tronqués à 8 signes par `short` : on les choisit donc
    // distincts DANS ces huit signes, sinon la ligne dirait deux fois la même
    // chose et l'assertion passerait sur une confusion.
    const dom = await monter(
      evenement('conflict_detected', { severity: 'haute', a: 'ruche.ts', b: 'rayon.ts' }),
    );
    expect(ligne(dom), 'la gravité n’est pas dite').toContain('conflit haute');
    expect(ligne(dom), 'le premier chemin en conflit n’est pas nommé').toContain('ruche.ts');
    expect(ligne(dom), 'le second chemin en conflit n’est pas nommé').toContain('rayon.ts');
  });

  it('UNE GRAVITÉ ABSENTE NE DEVIENT PAS « undefined »', async () => {
    // ─── LA BORNE DU REPLI : la clé MANQUE, ce qui est le seul cas ──────────
    //
    // `?? ''` ne se distingue de son absence QUE là. Avec une gravité présente,
    // les deux versions rendent le même texte et le cas ne prouverait rien.
    const dom = await monter(evenement('conflict_detected', { a: 'ruche.ts', b: 'rayon.ts' }));
    expect(ligne(dom), 'le défaut JavaScript s’affiche à l’hôte').not.toContain('undefined');
    expect(ligne(dom), 'la ligne de conflit ne se rend plus du tout').toContain('conflit');
  });

  it('EN ANGLAIS AUSSI : « conflict », sans « undefined »', async () => {
    // ─── L'AUTRE SITE DE LA MÊME DÉCISION ──────────────────────────────────
    //
    // Le repli est écrit DEUX FOIS, une par langue. Défendre le membre français
    // ne dit rien de l'anglais : ce sont deux gardes, sur la même ligne.
    setLang('en');
    const dom = await monter(evenement('conflict_detected', { a: 'ruche.ts', b: 'rayon.ts' }));
    expect(ligne(dom), 'le défaut JavaScript s’affiche en anglais').not.toContain('undefined');
    expect(ligne(dom), 'la ligne anglaise ne se rend plus').toContain('conflict');
  });
});

describe('la course annonce les drones QUI VOLENT, pas le facteur demandé', () => {
  it('TROIS DRONES ENRÔLÉS, FACTEUR SEPT : la ligne dit trois', async () => {
    // ─── LE CAS QUI DÉPARTAGE SANS RIEN CASSER ─────────────────────────────
    //
    // Les deux nombres sont DIFFÉRENTS exprès : muté, la ligne dirait « 7 ». Un
    // décor où la liste manque ferait planter le mutant plutôt que le faire
    // mentir — et un mutant qui plante ne prouve pas la distinction
    // (§ 9 quintrigicenties). C'est donc CE cas qui porte la garde.
    const dom = await monter(
      evenement('drone_race_started', {
        drones: ['n-1', 'n-2', 'n-3'],
        factor: 7,
        taskId: 'tache-critique',
      }),
    );
    expect(ligne(dom), 'la ligne n’annonce pas les drones enrôlés').toContain('3 drone(s)');
    expect(ligne(dom), 'la ligne annonce le facteur au lieu des drones').not.toContain(
      '7 drone(s)',
    );
  });

  it('SANS LISTE, LE FACTEUR SERT DE REPLI — l’autre branche', async () => {
    // Une course d'avant l'enrôlement n'a pas encore sa liste : le journal dit
    // alors ce qui a été DEMANDÉ, plutôt que de ne rien dire.
    const dom = await monter(
      evenement('drone_race_started', { factor: 2, taskId: 'tache-critique' }),
    );
    expect(ligne(dom), 'le repli sur le facteur ne se fait pas').toContain('2 drone(s)');
  });

  it('EN ANGLAIS AUSSI : « 3 drone(s) », pas le facteur', async () => {
    setLang('en');
    const dom = await monter(
      evenement('drone_race_started', {
        drones: ['n-1', 'n-2', 'n-3'],
        factor: 7,
        taskId: 'tache-critique',
      }),
    );
    expect(ligne(dom), 'la ligne anglaise n’annonce pas les drones enrôlés').toContain(
      '3 drone(s)',
    );
    expect(ligne(dom), 'la ligne anglaise annonce le facteur').not.toContain('7 drone(s)');
  });
});

describe('une correction de l’Evaluator ne se lit pas comme un échec', () => {
  // ─── LE MÊME TYPE, DEUX HISTOIRES OPPOSÉES ─────────────────────────────
  //
  // `task_retry` sans source : le Worker a échoué. Avec `source: 'evaluator'` :
  // sa production a RÉUSSI, et l'Evaluator (contre-revue, revue humaine) en
  // demande une meilleure. Le journal écrivait « échec » dans les deux cas.
  const correction = evenement('task_retry', {
    taskId: 'tache-relue',
    source: 'evaluator',
    resultId: 4,
    decision: 'correction_required',
    attempt: 2,
    maxAttempts: 3,
  });

  it('LA CORRECTION EST DITE COMME TELLE', async () => {
    const dom = await monter(correction);
    expect(ligne(dom), 'la correction n’est pas attribuée à l’Evaluator').toContain(
      'correction demandée par l’Evaluator',
    );
    expect(ligne(dom), 'l’essai n’est pas compté').toContain('2/3');
    expect(ligne(dom), 'une production réussie est dite en échec').not.toContain('échec');
  });

  it('EN ANGLAIS AUSSI : « correction requested », pas « failed »', async () => {
    setLang('en');
    const dom = await monter(correction);
    expect(ligne(dom)).toContain('correction requested by the Evaluator');
    expect(ligne(dom), 'a successful production reads as failed').not.toContain('failed');
  });

  it('UN VRAI ÉCHEC DU WORKER RESTE UN ÉCHEC — l’autre branche', async () => {
    const dom = await monter(
      evenement('task_retry', { taskId: 'tache-ratee', attempt: 2, maxAttempts: 3 }),
    );
    expect(ligne(dom)).toContain('échec, essai 2/3');
  });

  it('UNE CORRECTION NON RELANCÉE DIT POURQUOI', async () => {
    // Sans rendu dédié, la ligne affichait le type brut — et un rejet humain
    // resté sans suite passait pour une correction en route.
    const dom = await monter(
      evenement('evaluator_retry_skipped', {
        taskId: 'tache-relue',
        resultId: 4,
        reason: 'attempts_exhausted',
      }),
    );
    expect(ligne(dom), 'la ligne montre le type brut').not.toContain('evaluator_retry_skipped');
    expect(ligne(dom)).toContain('correction Evaluator non relancée');
    expect(ligne(dom), 'la raison n’est pas dite').toContain('essais épuisés');
  });

  it('EN ANGLAIS, LA RAISON AUSSI', async () => {
    setLang('en');
    const dom = await monter(
      evenement('evaluator_retry_skipped', { taskId: 'tache-relue', reason: 'delivery_exists' }),
    );
    expect(ligne(dom)).toContain('Evaluator correction not retried');
    expect(ligne(dom)).toContain('a delivery is already open');
  });

  it('SOUS UNE ENVELOPPE COÛT ÉPUISÉE, LA LIGNE DIT LE BUDGET — pas le code brut', async () => {
    // #496 : la correction est une dépense neuve, refusée sous une racine dont
    // la dépense déclarée a atteint l'enveloppe. La raison vient de la table
    // que la War Room partage (`direRaisonRefus`).
    const dom = await monter(
      evenement('evaluator_retry_skipped', {
        taskId: 'tache-deleguee',
        resultId: 5,
        reason: 'root_cost_budget_exhausted',
      }),
    );
    expect(ligne(dom)).toContain('le budget coût de la racine déléguée est épuisé');
    expect(ligne(dom), 'le code brut est affiché').not.toContain('root_cost_budget_exhausted');
  });

  it('UN REJET SUR UNE TÂCHE ÉCHOUÉE NE LA DIT PAS « PAS TERMINÉE »', async () => {
    // Un humain rejette une tâche en échec : la correction de l'Evaluator ne
    // part pas (`task_not_done`), parce que c'est le retry ordinaire qui la
    // relance. La ligne doit le dire, pas nier un statut terminal.
    const dom = await monter(
      evenement('evaluator_retry_skipped', { taskId: 'tache-ratee', reason: 'task_not_done' }),
    );
    expect(ligne(dom)).not.toContain('pas (ou plus) terminée');
    expect(ligne(dom)).toContain('retry ordinaire');
  });

  // Sans cas dédié, le repli affichait le code brut `ancestor_failed` : un
  // identifiant technique là où l'opérateur attend la raison.
  for (const [lang, attendu] of [
    ['fr', 'un ancêtre délégué a échoué (ou a été annulé) : plus personne n’attend'],
    ['en', 'a delegated ancestor failed (or was cancelled): nobody is waiting'],
  ] as const) {
    it(`SOUS UN ANCÊTRE DÉLÉGUÉ ÉCHOUÉ, PERSONNE N’ATTEND LA CORRECTION (${lang})`, async () => {
      setLang(lang);
      const dom = await monter(
        evenement('evaluator_retry_skipped', { taskId: 'enfant', reason: 'ancestor_failed' }),
      );
      expect(ligne(dom)).toContain(attendu);
      expect(ligne(dom), 'le code brut est affiché').not.toContain('ancestor_failed');
    });
  }
});

describe('une perte de contact se lit comme telle — ni échec constaté, ni type brut', () => {
  // ─── POURQUOI CES LIGNES ONT UN BANC ─────────────────────────────────────
  //
  // Quand un nœud perd le contact, la Reine publie une issue PROVISOIRE : elle
  // ne sait pas comment le travail a fini, et le dit. Avant ces lignes, le
  // Journal affichait `chantier_failed` ou le type brut de la pose — l'écran
  // des chantiers relisait bien son verdict, mais l'humain qui regardait le
  // journal lisait un identifiant, ou un échec qu'on n'avait pas vu.
  it('UN CHANTIER SANS RÉSULTAT DIT SA CAUSE — pas « en échec (code null) »', async () => {
    const dom = await monter(
      evenement('chantier_failed', {
        projectId: 'p1',
        chantierId: 'c1',
        nom: 'test',
        code: null,
        reason: 'nœud déconnecté — issue inconnue',
      }),
    );
    expect(ligne(dom)).toContain('chantier « test » sans résultat');
    expect(ligne(dom), 'la cause — l’issue inconnue — n’est pas dite').toContain('issue inconnue');
    expect(ligne(dom), 'une perte de contact se lit comme un échec').not.toContain('en échec');
  });

  it('UNE POSE SANS RÉPONSE NOMME L’OUTIL ET LE NŒUD — pas son type brut', async () => {
    const dom = await monter(
      evenement('outil_pose_sans_reponse', {
        poseId: 'pos-1',
        nodeId: 'noeud-poseur',
        outilId: 'codex',
        reason: 'délai dépassé',
      }),
    );
    expect(ligne(dom), 'la pose s’affiche en type brut').not.toContain('outil_pose_sans_reponse');
    expect(ligne(dom)).toContain('pose de codex sans réponse du nœud noeud-po');
    expect(ligne(dom)).toContain('délai dépassé');
  });
});

describe('un refus d’infrastructure dit sa cause — un refus ordinaire, non', () => {
  it('LE CLONE IMPOSSIBLE SE LIT AU JOURNAL, seule trace d’une tâche où aucun agent n’a tourné', async () => {
    const dom = await monter(
      evenement('task_rejected', {
        taskId: 'tache-clone',
        nodeId: 'n1',
        reason: 'clone impossible : fatal: terminal prompts disabled',
        infra: true,
      }),
    );
    expect(ligne(dom)).toContain('refusée (tache-cl)');
    expect(ligne(dom), 'la cause du refus n’est pas dite').toContain('terminal prompts disabled');
  });

  it('UN REFUS DE SATURATION RESTE MUET SUR SON CODE', async () => {
    const dom = await monter(
      evenement('task_rejected', { taskId: 'tache-sat', nodeId: 'n1', reason: 'noeud_sature' }),
    );
    expect(ligne(dom)).not.toContain('noeud_sature');
  });
});

describe('une relecture impossible se lit comme un appel à l’humain', () => {
  const impossible = evenement('contre_expertise_impossible', {
    taskId: 'prod-1234abcd',
    resultId: 3,
    relecture: 'relu-5678',
    relecteur: 'codex',
    producteur: 'claude-code',
    cause: 'codex a échoué (3 tentative(s))',
  });

  it('LA CAUSE ET LA REVUE HUMAINE SONT DITES', async () => {
    const dom = await monter(impossible);
    expect(ligne(dom)).toBe(
      'relecture impossible (prod-123) : codex a échoué (3 tentative(s)) — revue humaine requise',
    );
  });

  it('EN ANGLAIS, SANS PHRASE FRANÇAISE : le dernier relecteur est nommé', async () => {
    setLang('en');
    const dom = await monter(impossible);
    expect(ligne(dom)).toBe(
      'review impossible (prod-123), last reviewer codex — human review required',
    );
  });

  it('LE RELAIS D’UNE FAMILLE NEUVE SE DISTINGUE D’UN LANCEMENT', async () => {
    const dom = await monter(
      evenement('contre_expertise', {
        taskId: 'prod-1234abcd',
        possible: true,
        secours: true,
        modeles: ['hermes-agent'],
      }),
    );
    expect(ligne(dom)).toBe('relecture de secours de prod-123 confiée à hermes-agent');
  });
});

// Les lignes qu'un opérateur lit pour distinguer un NOUVEL ESSAI d'une clôture
// sans avis, une attente de famille d'un verdict : sans banc, inverser la
// branche `terminal` ferait lire « nouvel essai » sur une relecture close pour
// de bon — exactement le silence que la contre-revue ne doit plus laisser.
describe('les lignes de la contre-revue disent où elle en est', () => {
  const cas: ReadonlyArray<
    readonly [string, string, Record<string, unknown>, 'fr' | 'en', string]
  > = [
    [
      'attente de famille',
      'contre_expertise_review_waiting',
      { taskId: 'prod-1234abcd', relecteur: 'codex' },
      'fr',
      'relecture de prod-123 en attente : aucun nœud codex en ligne',
    ],
    [
      'attente de famille',
      'contre_expertise_review_waiting',
      { taskId: 'prod-1234abcd', relecteur: 'codex' },
      'en',
      'review of prod-123 waiting: no codex node online',
    ],
    [
      'échec terminal',
      'contre_expertise_review_failed',
      { taskId: 'prod-1234abcd', relecteur: 'codex', terminal: true },
      'fr',
      'relecture de prod-123 par codex close sans avis',
    ],
    [
      'échec terminal',
      'contre_expertise_review_failed',
      { taskId: 'prod-1234abcd', relecteur: 'codex', terminal: true },
      'en',
      'review of prod-123 by codex closed without a verdict',
    ],
    [
      'échec suivi d’un essai',
      'contre_expertise_review_failed',
      { taskId: 'prod-1234abcd', relecteur: 'codex', terminal: false },
      'fr',
      'relecture de prod-123 par codex : échec, nouvel essai',
    ],
    [
      'échec suivi d’un essai',
      'contre_expertise_review_failed',
      { taskId: 'prod-1234abcd', relecteur: 'codex', terminal: false },
      'en',
      'review of prod-123 by codex: failed, retrying',
    ],
    [
      'avis contestataire',
      'contre_expertise_verdict',
      { taskId: 'prod-1234abcd', relecteur: 'codex', conteste: true },
      'fr',
      'codex conteste prod-123',
    ],
    [
      'avis contestataire',
      'contre_expertise_verdict',
      { taskId: 'prod-1234abcd', relecteur: 'codex', conteste: true },
      'en',
      'codex contests prod-123',
    ],
    [
      'avis favorable',
      'contre_expertise_verdict',
      { taskId: 'prod-1234abcd', relecteur: 'codex', conteste: false },
      'fr',
      'codex valide prod-123',
    ],
    [
      'avis favorable',
      'contre_expertise_verdict',
      { taskId: 'prod-1234abcd', relecteur: 'codex', conteste: false },
      'en',
      'codex approves prod-123',
    ],
  ];
  for (const [nom, type, payload, lang, attendu] of cas) {
    it(`${nom.toUpperCase()} (${lang})`, async () => {
      setLang(lang);
      const dom = await monter(evenement(type, payload));
      expect(ligne(dom)).toBe(attendu);
    });
  }
});

// La rétention du journal se raconte. Sans ligne à elle, la passe s'affichait
// en type brut ; et le plafond — le seul motif qui prive une tâche encore
// ouverte de ses preuves — ne se distinguait pas d'un élagage de routine.
describe('une passe de rétention dit ce qu’elle a retiré — et nomme le plafond à part', () => {
  const passe = (parMotif: Record<string, number>): HiveEvent =>
    evenement('journal_elagage', { supprimes: 1, restants: 1, parMotif, parType: {} });
  const routine = { trace: 500, orpheline: 3, echue: 2, plafond_close: 0, plafond_vivante: 0 };

  it('UNE PASSE DE ROUTINE : traces et preuves de tâches closes ou disparues', async () => {
    const dom = await monter(passe(routine));
    expect(ligne(dom)).toBe(
      'journal élagué : 500 trace(s), 5 preuve(s) de tâches closes ou disparues',
    );
  });

  it('LE PLAFOND EST NOMMÉ, AVEC LES PREUVES DE TÂCHES ENCORE OUVERTES', async () => {
    const dom = await monter(passe({ ...routine, plafond_close: 7, plafond_vivante: 4 }));
    expect(ligne(dom)).toBe(
      'journal élagué : 500 trace(s), 5 preuve(s) de tâches closes ou disparues — plafond atteint : 11 preuve(s) retirée(s), dont 4 de tâches encore ouvertes',
    );
  });

  it('LA COUPE D’UN DOSSIER ENCORE ACTIF SE DIT À PART', async () => {
    const dom = await monter(passe({ ...routine, plafond_vivante: 1, plafond_coupe: 3 }));
    expect(ligne(dom)).toBe(
      'journal élagué : 500 trace(s), 5 preuve(s) de tâches closes ou disparues — plafond atteint : 4 preuve(s) retirée(s), dont 1 de tâches encore ouvertes, 3 coupée(s) dans des dossiers encore actifs',
    );
  });

  it('EN ANGLAIS AUSSI, et un compte absent vaut zéro — jamais « undefined »', async () => {
    setLang('en');
    const dom = await monter(passe({ trace: 2, plafond_vivante: 1 }));
    expect(ligne(dom)).toBe(
      'journal pruned: 2 trace(s), 0 proof(s) of closed or deleted tasks — cap reached: 1 proof(s) removed, 1 of them from still-open tasks',
    );
  });
});

describe('la suppression d’un projet se lit au journal', () => {
  // C'est le SEUL fait qui reste d'un projet supprimé : son propre journal est
  // parti avec lui. Une ligne muette (le type brut) effacerait donc la dernière
  // trace lisible — le nom, et ce qui est parti.
  it('LE NOM ET LES TÂCHES EFFACÉES SONT DITS', async () => {
    setLang('fr');
    const dom = await monter(
      evenement('project_deleted', {
        projectId: 'p-1',
        name: 'Site vitrine',
        annulees: 0,
        effaces: { projects: 1, tasks: 3, events: 12 },
      }),
    );
    expect(ligne(dom)).toBe('projet « Site vitrine » supprimé (3 tâche(s) effacée(s))');
  });

  it('un bilan illisible ne fait dire AUCUN chiffre — un bilan sans tâches dit zéro', async () => {
    setLang('en');
    const sans = await monter(evenement('project_deleted', { projectId: 'p-1', name: 'Site' }));
    expect(ligne(sans)).toBe('project “Site” deleted');
    await act(async () => racine?.unmount());
    conteneur?.remove();
    // Les tables vides sont omises du bilan : `tasks` absent = aucune tâche.
    const vide = await monter(
      evenement('project_deleted', { projectId: 'p-1', name: 'Site', effaces: { projects: 1 } }),
    );
    expect(ligne(vide)).toBe('project “Site” deleted (0 task(s) erased)');
  });
});

describe('les décisions se lisent comme des décisions — jamais par leur type brut', () => {
  // Ces lignes nourrissent aussi le fil des décisions de l'accueil
  // (`ligneDuJournal`) : un type brut y serait une décision illisible.
  const cas: Array<[string, string, Record<string, unknown>, 'fr' | 'en', string]> = [
    [
      'le modèle commandé',
      'task_assigned',
      { taskId: 'tache-1234abcd', nodeId: 'noeud-5678efgh', modele: 'opus', categorie: 'code' },
      'fr',
      'tache-12 → nœud noeud-56 · modèle opus (code)',
    ],
    [
      'une affectation sans modèle reste courte',
      'task_assigned',
      { taskId: 'tache-1234abcd', nodeId: 'noeud-5678efgh' },
      'fr',
      'tache-12 → nœud noeud-56',
    ],
    [
      'le verdict humain',
      'task_reviewed',
      { taskId: 'tache-1234abcd', state: 'approved' },
      'fr',
      'revue humaine : approuvée (tache-12)',
    ],
    [
      'une revue effacée',
      'task_reviewed',
      { taskId: 'tache-1234abcd', state: null },
      'en',
      'human review cleared (tache-12)',
    ],
    [
      'un verdict passé outre',
      'evaluator_overridden',
      { taskId: 'tache-1234abcd', decision: 'human_review_required', geste: 'livrer' },
      'fr',
      'verdict de l’Evaluator (human_review_required) passé outre pour livrer (tache-12)',
    ],
    [
      'un Conseil tranché sans piste',
      'council_decided',
      { sessionId: 's1', propositionId: null, titre: null },
      'fr',
      'Conseil tranché : aucune piste retenue',
    ],
  ];
  for (const [nom, type, payload, lang, attendu] of cas) {
    it(`${nom.toUpperCase()} (${lang})`, async () => {
      setLang(lang);
      const dom = await monter(evenement(type, payload));
      expect(ligne(dom)).toBe(attendu);
    });
  }
});

describe('un arrêt budgétaire a SA ligne — ni le ✘ ni le mot « échouée »', () => {
  it('ARRÊTÉE SUR SON PLAFOND : la borne, et la suite à donner', async () => {
    // Le même `task_failed` sans le fait reste un échec : c'est le fait, pas
    // le type, qui change la ligne (`arreteeParSonBudget`).
    const dom = await monter(
      evenement('task_failed', {
        taskId: 'enfant-1234abcd',
        nodeId: 'n1',
        resultId: 7,
        durationMs: 1_200,
        arretBudgetaire: 'cout',
      }),
    );
    expect(dom.querySelector('.journal .jrow')?.className).toContain('warn');
    expect(dom.querySelector('.journal .jicon')?.textContent).toBe('¤');
    expect(ligne(dom)).toBe(
      'arrêtée sur son plafond de coût dans la boucle de l’agent (enfant-1) — ni échec, ni ' +
        'panne : à redéléguer sous un nouvel identifiant, avec une réservation plus large',
    );
    act(() => racine?.unmount());
    conteneur?.remove();
    const echec = await monter(
      evenement('task_failed', { taskId: 'enfant-1234abcd', nodeId: 'n1', durationMs: 1_200 }),
    );
    // Une durée n'est pas un coût : depuis que la ruche compte des dollars,
    // « coût : 1.2 s » se lisait comme une dépense.
    expect(ligne(echec)).toBe('échouée (enfant-1) — durée : 1.2 s');
  });
});
