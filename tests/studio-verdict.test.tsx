// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// UN VERDICT, UN ENVOI — et le focus qui ne tombe pas au fond de la page.
//
// ─── LE DOUBLE ENVOI ─────────────────────────────────────────────────────────
//
// Le Studio postait la revue lui-même, PUIS appelait `setReview` — qui la
// poste aussi (la file sérialisée de la Miellerie). Chaque « Approuver » donnait
// deux `task_reviewed` à la Reine : mesuré sur la démo, deux événements par
// clic, deux lignes « validée » dans l'activité, deux notifications aux
// connecteurs ; sur un refus, le second envoi tombait sur la tâche déjà
// relancée (409) et restait en file, rejoué plus tard contre la tentative
// suivante.
//
// ─── LE FOCUS ────────────────────────────────────────────────────────────────
//
// Le bouton cliqué disparaît avec le verdict : le focus tombait sur <body>.
// Dans la liste des résultats, il va au titre de la ligne (qui reste).
//
// ─── L'ÉCHEC ─────────────────────────────────────────────────────────────────
//
// Le verdict s'affiche avant l'envoi : quand l'envoi échoue, la carte a déjà
// disparu. L'espace de travail nomme la tâche dans une alerte qui se ferme.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Task } from '../src/shared/types';

const banc = vi.hoisted(() => ({ envois: [] as unknown[][], panne: false }));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postReview: vi.fn((...args: unknown[]) => {
    banc.envois.push(args);
    return banc.panne
      ? Promise.reject(new Error('Reine injoignable'))
      : Promise.resolve({ taskId: args[0], state: args[1] });
  }),
}));

import { setLang } from '../dashboard/src/i18n';
import type { Conversation } from '../dashboard/src/studio/conversation';
import { EspaceTravail } from '../dashboard/src/studio/EspaceTravail';
import type { MissionAffichee } from '../dashboard/src/studio/mission-courante';
import { useReviewTick } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const projet = { id: 'p1', name: 'Démo', repoUrl: null } as unknown as Project;
const conversation: Conversation = {
  messages: [],
  enCours: false,
  erreur: null,
  indisponible: false,
  envoyer: () => Promise.resolve(true),
  effacer: () => {},
};

function tacheFinie(id: string, title: string): Task {
  return {
    id,
    title,
    projectId: 'p1',
    status: 'done',
    dependsOn: [],
    attempts: 1,
    assignedNodeId: null,
    createdAt: 1,
    updatedAt: 2,
    result: { durationMs: 2_000, success: true },
  } as unknown as Task;
}

/** L'espace de travail comme l'accueil le monte : le tic des verdicts le fait relire. */
function Banc({ taches }: { taches: Task[] }) {
  const tick = useReviewTick();
  const mission = {
    etat: 'en_cours',
    missionId: 'm1',
    ouverteA: 1,
    closeA: null,
    taches,
    compte: { total: taches.length, terminees: taches.length, enCours: 0, echecs: 0 },
    statut: null,
    source: 'instantane',
  } as unknown as MissionAffichee;
  return (
    <EspaceTravail
      projet={projet}
      mission={mission}
      brief={null}
      noeuds={[]}
      conversation={conversation}
      onglet="resultats"
      onOnglet={() => {}}
      onOuvrirTache={() => {}}
      reviewTick={tick}
    />
  );
}

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

async function monter(taches: Task[]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Banc taches={taches} />));
  return conteneur;
}

const bouton = (dom: HTMLElement, mot: string): HTMLButtonElement => {
  const b = [...dom.querySelectorAll('button')].find((x) => x.textContent?.trim() === mot);
  expect(b, `bouton « ${mot} » introuvable`).toBeTruthy();
  return b!;
};

/** Clique, puis laisse partir la file sérialisée des revues (micro-tâches). */
async function cliquer(b: HTMLButtonElement): Promise<void> {
  b.focus();
  await act(async () => b.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  banc.envois.length = 0;
  banc.panne = false;
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

describe('le verdict du Studio', () => {
  it('« Approuver » envoie UNE revue — avec l’identité d’onglet — et le focus va au titre', async () => {
    const dom = await monter([tacheFinie('verdict-a', 'Socle')]);
    await cliquer(bouton(dom, 'Approuver'));

    expect(banc.envois, 'un clic, un envoi : deux task_reviewed sinon').toHaveLength(1);
    expect(banc.envois[0]!.slice(0, 2)).toEqual(['verdict-a', 'approved']);
    expect(typeof banc.envois[0]![2], 'l’identité d’onglet voyage avec le verdict').toBe('string');
    expect(dom.textContent).toContain('Validée');
    expect(document.activeElement?.textContent, 'le focus tombait sur <body>').toBe('Socle');
  });

  it('« Refuser » aussi : un envoi, jamais un second sur la tâche déjà relancée', async () => {
    const dom = await monter([tacheFinie('verdict-r', 'Parseur')]);
    await cliquer(bouton(dom, 'Refuser'));

    expect(banc.envois).toHaveLength(1);
    expect(banc.envois[0]!.slice(0, 2)).toEqual(['verdict-r', 'rejected']);
    expect(dom.textContent).toContain('Refusée');
  });

  it('un envoi qui échoue se dit, nommé, après la disparition des boutons — et se ferme', async () => {
    banc.panne = true;
    const dom = await monter([tacheFinie('verdict-e', 'Facturation')]);
    await cliquer(bouton(dom, 'Approuver'));

    const alerte = dom.querySelector('[role="alert"]');
    expect(alerte?.textContent).toContain('La Reine n’a pas enregistré ce verdict');
    expect(alerte?.textContent).toContain('« Facturation »');
    await act(async () => bouton(dom, 'Compris').click());
    expect(dom.querySelector('.hs-verdicts-perdus')).toBeNull();
  });
});
