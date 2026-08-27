// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'HORLOGE DANS LE TIROIR — l'annonce affichée, et surtout le VERDICT.
//
// ─── CE QUE CE FICHIER DÉFEND, ET POURQUOI C'EST LE CŒUR ─────────────────────
//
// Une annonce qu'on n'oppose jamais à ce qui est arrivé ne coûte rien à faire
// et ne vaut rien : personne ne peut dire si elle valait quelque chose. Tant
// que le verdict n'est pas à l'écran, l'horloge est un chiffre qu'on croit sur
// parole — exactement ce que le module refusait de produire.
//
// Trois gardes d'affichage vivent ici, et chacune ment d'une manière propre si
// on l'inverse :
//
//   · le verdict sur socle « aucun » — noterait comme un échec un refus de
//     chiffrer, l'incitation qu'il ne faut surtout pas créer ;
//   · l'alerte hors domaine — se tairait sur les tâches les plus longues ;
//   · l'absence d'annonce — afficherait « — », qui se lit « la ruche n'avait
//     rien annoncé » alors que le journal l'a seulement oubliée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode, Task } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { VueHorloge } from '../dashboard/src/horloge-vue';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchRace: vi.fn(() => Promise.resolve({ race: null, victory: null })),
  cancelTask: vi.fn(() => Promise.resolve()),
  raceTask: vi.fn(() => Promise.resolve({ drones: [] })),
}));
vi.mock('../dashboard/src/CodeEditor', () => ({ default: () => null }));

import { TaskDrawer } from '../dashboard/src/TaskDrawer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const NOEUDS: HiveNode[] = [
  {
    id: 'noeud-1',
    name: 'ruche-alpha',
    status: 'idle',
    agentType: 'shell',
    maxConcurrency: 1,
    tasksDone: 0,
    connectedAt: 0,
  } as unknown as HiveNode,
];

/** 25 min de plafond annoncé, 7 min de médiane, 12 observations. */
const ANNONCE: VueHorloge = {
  annonce: { socle: 'caste', n: 12, p50Ms: 420_000, p80Ms: 1_500_000 },
};

function tache(sur: Partial<Task> = {}): Task {
  return {
    id: 'tache-horloge',
    projectId: 'p1',
    title: 'poser les alvéoles',
    prompt: 'faire le rayon',
    status: 'done',
    dependsOn: [],
    assignedNodeId: 'noeud-1',
    result: { success: true, nodeId: 'noeud-1', durationMs: 900_000 },
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    ...sur,
  } as Task;
}

async function monter(task: Task, horloge?: VueHorloge): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(<TaskDrawer task={task} nodes={NOEUDS} horloge={horloge} onClose={() => {}} />),
  );
  return conteneur;
}

describe('le tiroir — l’annonce affichée', () => {
  it('L’INTERVALLE ET SON `n`, jamais un chiffre seul', () => {
    // Le `n` n'est pas décoratif : « 7 min à 25 min » sur 5 observations et sur
    // 400 ne se planifient pas pareil, et sans lui on accorde à l'intervalle
    // une confiance qu'il n'a pas méritée.
    return monter(tache({ status: 'running', result: null }), ANNONCE).then((dom) => {
      expect(dom.textContent).toContain('Annoncé');
      expect(dom.textContent).toContain('7 min à 25 min');
      expect(dom.textContent).toContain('8 fois sur 10');
      expect(dom.textContent).toContain('12 obs.');
    });
  });

  it('SANS ANNONCE DANS LA FENÊTRE : pas de ligne du tout, et surtout pas un « — »', async () => {
    // La moitié qui tue la garde `horloge?.annonce &&`. Un « — » se lit « la
    // ruche n'avait rien annoncé » ; la vérité est « le journal ne s'en
    // souvient plus ». Deux faits opposés qu'un tiret confondrait.
    const dom = await monter(tache(), undefined);
    expect(dom.textContent).not.toContain('Annoncé');
  });
});

describe('le tiroir — le verdict, la pièce qui rend l’horloge réfutable', () => {
  it('TENUE : le réel sous le plafond annoncé', async () => {
    const dom = await monter(
      tache({ result: { success: true, nodeId: 'noeud-1', durationMs: 900_000 } }),
      ANNONCE,
    );
    expect(dom.textContent).toContain('Annonce tenue');
    expect(dom.textContent).toContain('15 min');
    expect(dom.textContent, 'un verdict tenu n’accuse pas').not.toContain('Annonce débordée');
    expect(dom.querySelector('.horloge-verdict.tenue')).not.toBeNull();
  });

  it('DÉBORDÉE : le réel au-dessus — et la phrase refuse d’en faire une panne', async () => {
    const dom = await monter(
      tache({ result: { success: true, nodeId: 'noeud-1', durationMs: 2_400_000 } }),
      ANNONCE,
    );
    expect(dom.textContent).toContain('Annonce débordée');
    expect(dom.textContent).toContain('40 min');
    // La phrase porte sa propre statistique : une annonce à 80 % est CENSÉE
    // déborder une fois sur cinq. Sans cette précision, la première débordée
    // ferait condamner une horloge parfaitement calibrée.
    expect(dom.textContent).toContain('Une annonce sur cinq est censée déborder');
    expect(dom.querySelector('.horloge-verdict.debordee')).not.toBeNull();
  });

  it('SOCLE « AUCUN » : AUCUN verdict — refuser de chiffrer n’est pas se tromper', async () => {
    // ─── LA GARDE LA PLUS COÛTEUSE À PERDRE ────────────────────────────────
    //
    // `p80Ms` vaut 0 sur ce socle. Sans la garde, toute durée réelle le dépasse
    // et l'écran écrirait « débordée » sur chaque tâche que la ruche a eu
    // l'honnêteté de ne pas chiffrer. L'effet à trois semaines est mécanique :
    // on annonce n'importe quoi plutôt que de porter un rouge imérité.
    const dom = await monter(tache(), {
      annonce: { socle: 'aucun', n: 2, p50Ms: 0, p80Ms: 0 },
    });
    expect(dom.textContent).toContain('pas encore d’estimation');
    expect(dom.textContent).not.toContain('Annonce débordée');
    expect(dom.textContent).not.toContain('Annonce tenue');
  });

  it('TÂCHE EN VOL : pas de verdict — il n’y a rien à confronter', async () => {
    const dom = await monter(tache({ status: 'running', result: null }), ANNONCE);
    expect(dom.textContent).not.toContain('Annonce tenue');
    expect(dom.textContent).not.toContain('Annonce débordée');
  });
});

describe('le tiroir — l’alerte hors domaine', () => {
  it('DIT LE RECORD, pas un compte à rebours', async () => {
    const dom = await monter(tache({ status: 'running', result: null }), {
      ...ANNONCE,
      horsDomaine: { ecouleMs: 7_200_000, recordMs: 3_600_000 },
    });
    expect(dom.textContent).toContain('Sortie du domaine connu');
    expect(dom.textContent).toContain('2 h');
    // Le record se dit « 60 min », pas « 1 h » : `direDuree` n'ouvre le palier
    // horaire qu'à 90 minutes, pour ne pas écrire « 1 h 00 ». Ce banc l'a
    // d'abord démenti — c'était l'attente qui était fausse, pas le rendu.
    expect(dom.textContent).toContain('60 min');
    expect(dom.querySelector('.horloge-alerte')).not.toBeNull();
  });

  it('SANS ALERTE, RIEN — la garde n’est pas décorative', async () => {
    const dom = await monter(tache({ status: 'running', result: null }), ANNONCE);
    expect(dom.textContent).not.toContain('Sortie du domaine connu');
    expect(dom.querySelector('.horloge-alerte')).toBeNull();
  });

  it('ELLE TIENT SANS ANNONCE : le journal peut avoir oublié l’une et pas l’autre', async () => {
    // La moitié qui tue « n'afficher l'alerte que si l'annonce est là ». La
    // tâche la plus longue est celle dont l'annonce a eu le plus de temps pour
    // sortir de la fenêtre — et la seule pour qui l'alerte compte.
    const dom = await monter(tache({ status: 'running', result: null }), {
      horsDomaine: { ecouleMs: 7_200_000, recordMs: 3_600_000 },
    });
    expect(dom.textContent).toContain('Sortie du domaine connu');
    expect(dom.textContent).not.toContain('Annoncé');
  });
});

describe('le tiroir — la langue', () => {
  it('EN ANGLAIS, le verdict ne laisse pas passer de français', async () => {
    setLang('en');
    const dom = await monter(
      tache({ result: { success: true, nodeId: 'noeud-1', durationMs: 2_400_000 } }),
      ANNONCE,
    );
    expect(dom.textContent).toContain('Announcement overrun');
    expect(dom.textContent).not.toContain('Annonce débordée');
    expect(dom.textContent).toContain('Announced');
    expect(dom.textContent).toContain('8 times out of 10');
    expect(dom.textContent).not.toContain('8 fois sur 10');
  });
});
