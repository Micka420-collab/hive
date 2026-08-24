// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA RUCHE COMPTE-T-ELLE LE TRAVAIL FINI, OU SON CONTRAIRE ?
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage COMPLET de la loupe sur `dashboard/src/views/Ruche.tsx`, base
// épinglée dans l'atelier (`LOUPE_BASE=e93b252`, 183 ajoutées / 0 retirée) :
//
//     16 mutation(s) possible(s), 16 examinée(s) — 9 défendues, 7 SANS TEST
//
// Et c'est le balayage COMPLET qui vaut d'être noté : un premier tirage de 8
// candidates sur 16 n'en avait trouvé que DEUX. La moitié du fichier regardée
// avait rendu moins du tiers de ses nues. Un échantillon dit ce qu'il a vu, il
// ne dit rien de ce qu'il a laissé — et il ne se multiplie pas par deux.
//
// ─── LES SEPT, ET CE QUE CHACUNE COÛTE ───────────────────────────────────────
//
// 1. `e.type === 'task_done'` → la tuile « Débit » additionne alors tout ce qui
//    n'est PAS une fin de tâche : connexions, affectations, erreurs. Comme la
//    plupart des événements sont de ceux-là, le compteur ne retombe jamais à
//    zéro : la ruche a l'air la plus productive au moment précis où elle ne
//    termine plus rien.
//
// 2. `t >= cutoff` → la fenêtre de 60 s se ferme un instant trop tôt. Seule une
//    tâche finie EXACTEMENT à la seconde de coupure distingue les deux
//    versions ; c'est le cas à la borne, et il n'y en a pas d'autre.
//
// 3. `t.status === 'done'` → `done` compte les tâches NON finies. La barre
//    annonce « 2/3 tâches butinées » quand une seule l'est.
//
// 4. `{mode === '3d' ? (` → l'écran rend le moteur 3D quand on a choisi la 2D,
//    et le plan 2D quand on a choisi la 3D. DEUX SITES, UN MÊME SYMBOLE : le
//    `className` des deux boutons est défendu depuis longtemps, et ne dit rien
//    de celui-ci (§ 9 unquinquagicenties, la deuxième fois cette nuit après le
//    Cerveau). L'interrupteur montre donc le bon mode allumé pendant que
//    l'écran rend l'autre.
//
// 5. `deferred.has(task.id) && task.status === 'ready'` → la pastille ⏸ passe
//    sur les différées qui TRAVAILLENT et disparaît de celles qui attendent.
//    Elle existe pour dire « celle-ci est bloquée par un conflit de fichier » :
//    posée sur une tâche en cours, elle ment sur qui attend quoi.
//
// 6. `total > 0 && done === total` → la borne : sur une ruche VIDE (zéro tâche),
//    `0 === 0` est vrai, et « 🍯 Tout est butiné ! » s'affiche à côté de
//    « Aucune tâche en attente ». Deux fins de file contradictoires dans le
//    même `<ul>`.
//
// 7. `done === total` → le bandeau s'allume quand RIEN n'est fini, posé dans le
//    même `<ul>` que la file qui liste les tâches en attente.
//
// Aucune de ces mutations ne casse quoi que ce soit : la vue continue de se
// rendre, aucun banc ne rougit, l'écran affiche simplement des chiffres qui
// disent l'inverse de ce que leur étiquette promet.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ruche from '../dashboard/src/views/Ruche';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveEvent, StateSnapshot, Task } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

// AutonomiePulse sonde `/api/projects/:id/essaim` au montage dès qu'il y a un
// projet. Sans bouchon, happy-dom tape :3000 (ECONNREFUSED) — mesuré sous le
// tamis des ordres après le pouls Ruche.
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchEssaim: vi.fn(() =>
    Promise.resolve({
      niveau: 'off',
      niveaux: ['off', 'propose', 'gouverne', 'plein'],
      runner: { mode: 'off', enPause: false, echecs: 0, dernierTourA: 0 },
      derive: { etat: 'saine', echantillon: 0, indicateurs: [], solitudeJours: 0, motif: '' },
      decision: { pas: 'inerte', motif: '', gouvernantes: [] },
      gouvernantes: [],
      gouvernantesRequises: 1,
      depotInscrit: false,
      plafond: 'passe',
      lecons: [],
    }),
  ),
}));

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  localStorage.clear();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
  vi.useRealTimers();
});

/**
 * Une tâche, dans la forme RÉELLE de `Task`.
 *
 * L'annotation n'est pas décorative : c'est la seule garde contre un décor qui
 * décrit un monde que le code ne peut pas produire. Deux bancs de cette nuit
 * sont morts en `TypeError` faute de l'avoir (§ 9 terquinquagicenties).
 */
const tache = (id: string, status: Task['status']): Task => ({
  id,
  projectId: 'p1',
  title: `tâche ${id}`,
  prompt: '…',
  status,
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
});

/** Un événement du journal, dans la forme réelle de `HiveEvent`. */
const evenement = (id: number, type: string, ts = Date.now()): HiveEvent => ({
  id,
  ts,
  type,
  payload: {},
});

function instantane(taches: Task[]): StateSnapshot {
  return {
    projects: [{ id: 'p1', name: 'Rucher' }],
    nodes: [],
    tasks: taches,
    tasksTotal: taches.length,
  } as unknown as StateSnapshot;
}

function monter(
  snapshot: StateSnapshot,
  events: HiveEvent[] = [],
  differees: string[] = [],
): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
    events,
    agentsByTask: {},
    deferred: new Set<string>(differees),
    onOpenTask: () => {},
    onNewProject: () => {},
    onNavigate: () => {},
    selectedId: null,
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  act(() => racine?.render(<Ruche {...props} />));
  return conteneur;
}

/**
 * La tuile DU DÉBIT, pas la première venue.
 *
 * `StatTiles` en pose cinq, toutes en `.tile` avec la même structure : chercher
 * `.tile-value` dans le document rendrait le total des tâches. On cadre sur
 * l'étiquette, seul repère qui distingue une tuile d'une autre.
 */
function tuileDebit(dom: HTMLElement): string {
  const tuile = [...dom.querySelectorAll('.tile')].find((t) =>
    (t.querySelector('.tile-label')?.textContent ?? '').includes('Débit'),
  );
  const valeur = tuile?.querySelector('.tile-value');
  if (!valeur) throw new Error('la tuile du débit est introuvable');
  return valeur.textContent ?? '';
}

const barre = (dom: HTMLElement): string =>
  dom.querySelector('.hero-progress span')?.textContent ?? '';

const bandeauTermine = (dom: HTMLElement): Element | null =>
  [...dom.querySelectorAll('.queue li')].find((li) =>
    (li.textContent ?? '').includes('Tout est butiné'),
  ) ?? null;

describe('le débit compte les tâches TERMINÉES, pas le reste du journal', () => {
  it('DEUX FINS SUR CINQ ÉVÉNEMENTS : le débit dit deux', () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER ──────────────────────────────────
    //
    // Les comptes sont choisis pour se DISTINGUER : 2 fins, 3 autres. Muté, le
    // débit dirait « 3 ». Avec autant de fins que d'autres, les deux versions
    // rendraient le même chiffre et le cas ne prouverait rien.
    const dom = monter(instantane([tache('t1', 'done')]), [
      evenement(1, 'task_done'),
      evenement(2, 'task_done'),
      evenement(3, 'node_connected'),
      evenement(4, 'task_assigned'),
      evenement(5, 'task_failed'),
    ]);

    expect(tuileDebit(dom), 'le débit ne compte pas les fins de tâches').toContain('2');
  });

  it('AUCUNE FIN, UN JOURNAL BAVARD : le débit reste à zéro', () => {
    // ─── LA BORNE : EXACTEMENT ZÉRO TÂCHE TERMINÉE ─────────────────────────
    //
    // Le cas que le mutant rend le plus visible : trois événements au journal,
    // aucune fin, et le débit afficherait « 3 » alors que la ruche n'a rien
    // terminé. Une ruche en panne se lirait comme une ruche qui butine.
    const dom = monter(instantane([tache('t1', 'running')]), [
      evenement(1, 'node_connected'),
      evenement(2, 'task_assigned'),
      evenement(3, 'task_failed'),
    ]);

    expect(tuileDebit(dom), 'un journal sans aucune fin affiche pourtant un débit').toContain('0');
  });

  it('UNE FIN EXACTEMENT À LA SECONDE DE COUPURE COMPTE ENCORE', () => {
    // ─── LA BORNE DE LA FENÊTRE, VALEUR ÉGALE AU SEUIL ─────────────────────
    //
    // `t >= cutoff` muté en `>` ne se distingue QUE là : une tâche finie une
    // milliseconde avant compte dans les deux versions, une finie une
    // milliseconde après dans aucune. Il faut donc l'horloge sous la main.
    const maintenant = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(maintenant);

    const dom = monter(instantane([tache('t1', 'done')]), [
      evenement(1, 'task_done', maintenant - 60_000), // EXACTEMENT la coupure
    ]);

    expect(tuileDebit(dom), 'la fenêtre de 60 s se referme un instant trop tôt').toContain('1');
  });

  it('UNE FIN D’IL Y A DEUX MINUTES NE COMPTE PLUS — l’autre côté', () => {
    // Sans ce cas, « la borne compte » se satisferait d'une fenêtre infinie.
    const maintenant = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(maintenant);

    const dom = monter(instantane([tache('t1', 'done')]), [
      evenement(1, 'task_done', maintenant - 120_000),
    ]);

    expect(tuileDebit(dom), 'une fin vieille de deux minutes compte encore au débit').toContain(
      '0',
    );
  });
});

describe('« butinées » compte ce qui est FINI', () => {
  it('UNE SUR TROIS : la barre dit une sur trois', () => {
    const dom = monter(
      instantane([tache('t1', 'done'), tache('t2', 'running'), tache('t3', 'ready')]),
    );
    expect(barre(dom), 'la barre annonce autre chose que le nombre de butinées').toContain('1/3');
  });

  it('RIEN DE FINI : le bandeau « Tout est butiné » NE S’AFFICHE PAS', () => {
    // Muté, `done` vaut 3 (les trois non finies), `done === total` est vrai, et
    // « 🍯 Tout est butiné ! » se pose dans le même `<ul>` que la file qui
    // liste les trois tâches en attente.
    const dom = monter(
      instantane([tache('t1', 'ready'), tache('t2', 'ready'), tache('t3', 'running')]),
    );
    expect(bandeauTermine(dom), 'la ruche annonce tout butiné alors que rien ne l’est').toBeNull();
  });

  it('TOUT EST FINI : le bandeau s’affiche — l’autre côté de la borne', () => {
    const dom = monter(instantane([tache('t1', 'done'), tache('t2', 'done')]));
    expect(bandeauTermine(dom), 'la ruche ne dit pas qu’elle a tout butiné').not.toBeNull();
  });

  it('UNE RUCHE VIDE N’A RIEN BUTINÉ — la borne à zéro tâche', () => {
    // ─── LA BORNE, VALEUR ÉGALE AU SEUIL ───────────────────────────────────
    //
    // `total > 0` muté en `>= 0` : sur zéro tâche, `0 === 0` est vrai et le
    // bandeau de fin s'affiche à CÔTÉ de « Aucune tâche en attente ». Une ruche
    // qui n'a jamais rien reçu se félicite d'avoir tout terminé.
    const dom = monter(instantane([]));

    expect(bandeauTermine(dom), 'une ruche vide se félicite d’avoir tout butiné').toBeNull();
    expect(dom.querySelector('.queue')?.textContent, 'la file vide ne dit plus rien').toContain(
      'Aucune tâche en attente',
    );
  });
});

describe('l’écran rend le mode qu’on a choisi', () => {
  it('EN 2D, LE PLAN SE REND — et le moteur 3D reste éteint', () => {
    // ─── LE CAS NOMINAL ────────────────────────────────────────────────────
    //
    // `{mode === '3d' ? (` muté, la 2D choisie afficherait le chargement du
    // moteur 3D. Les DEUX boutons sont défendus ailleurs et n'y changeraient
    // rien : l'interrupteur montrerait « 2D » allumé au-dessus d'un rendu 3D.
    const dom = monter(instantane([tache('t1', 'ready')]));

    expect(dom.querySelector('svg.swarm'), 'le plan 2D ne se rend pas').not.toBeNull();
    expect(dom.textContent, 'le moteur 3D se charge alors qu’on est en 2D').not.toContain(
      'Chargement du moteur 3D',
    );
  });

  it('EN 3D, LE PLAN 2D S’EFFACE — l’autre côté de la bascule', () => {
    localStorage.setItem('hive.view', '3d');
    const dom = monter(instantane([tache('t1', 'ready')]));

    expect(dom.querySelector('svg.swarm'), 'le plan 2D se rend encore en mode 3D').toBeNull();
  });
});

describe('la pastille des différées dit qui ATTEND', () => {
  it('UNE DIFFÉRÉE QUI ATTEND PORTE LA PASTILLE', () => {
    // ─── LE CAS NOMINAL ────────────────────────────────────────────────────
    const dom = monter(instantane([tache('t1', 'ready')]), [], ['t1']);
    expect(
      dom.querySelector('.queue .badge-conflict'),
      'une tâche différée en attente ne porte aucune pastille',
    ).not.toBeNull();
  });

  it('UNE DIFFÉRÉE QUI TRAVAILLE N’EN PORTE PAS — sinon la pastille ment', () => {
    // Muté en `!==`, c'est ce cas-ci qui rougit : la pastille « bloquée par un
    // conflit de fichier » se poserait sur une tâche en train de tourner.
    const dom = monter(instantane([tache('t1', 'running')]), [], ['t1']);
    expect(
      dom.querySelector('.queue .badge-conflict'),
      'une tâche différée EN COURS porte la pastille d’attente',
    ).toBeNull();
  });
});
