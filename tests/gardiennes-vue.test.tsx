// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES GARDIENNES, RENDUES — sur QUI elles hésitent à compter.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage de nuit : `snapshot.nodes.find((n) => n.id ===
// nodeId)` dans la vue Santé, mutée en `!==`, ne faisait rougir personne. Trois
// fichiers portent pourtant « gardiennes » dans leur nom — mais ils éprouvent
// l'inspection elle-même, son endpoint et son câblage, jamais ce que l'écran
// en RACONTE.
//
// ─── CE QUE CETTE LIGNE PORTE ────────────────────────────────────────────────
//
// Le code le dit déjà lui-même, à l'endroit exact :
//
//     Le NOM du nœud, pas son identifiant : « 3f2a-… » ne dit à
//     personne sur qui il hésite à compter.
//
// C'est donc une ACCUSATION affichée à un humain : cette machine-là a rendu du
// travail creux. Mutée, `find` rend le premier nœud qui N'EST PAS celui-là —
// et la ruche accuse la mauvaise machine, nommément, dans un écran fait pour
// décider à qui l'on confie du travail. La faute est d'autant plus difficile à
// repérer que l'écran reste parfaitement cohérent : un nom réel, un verdict
// réel, un grief réel. Seul le lien entre eux est faux.
//
// Le repli `?? nodeId` compte aussi : un nœud parti de la ruche doit rendre
// son identifiant brut plutôt que d'emprunter le nom du voisin.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // TOUTES les sondes de cet écran, pas seulement celle qu'on juge : une
  // sonde oubliée part vraiment sur le réseau (ECONNREFUSED dans la sortie),
  // ce qui rend le banc lent et dépendant de la machine qui l'exécute.
  fetchGardiennes: vi.fn(),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
}));

import { fetchGardiennes } from '../dashboard/src/api';
import Sante from '../dashboard/src/views/Sante';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const INSPECTION = {
  id: 1,
  taskId: 't-1',
  nodeId: 'noeud-coupable',
  verdict: 'hollow' as const,
  score: 0.1,
  applique: false,
  griefs: [{ code: 'diff_vide' }],
  createdAt: 1,
};

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchGardiennes)
    .mockReset()
    .mockResolvedValue({
      version: 1,
      inspections: 1,
      verdicts: { clean: 0, suspect: 0, hollow: 1 },
      refusees: 0,
      griefs: [{ code: 'diff_vide', occurrences: 1 }],
      recentes: [INSPECTION],
      mode: 'consultatif',
    } as never);
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function instantane(noeuds: Array<{ id: string; name: string }>): StateSnapshot {
  return {
    projects: [],
    // L'ORDRE compte : le nœud accusé est mis en SECOND exprès. Mutée, la
    // recherche rend le premier nœud qui n'est pas lui — donc l'innocent, qui
    // doit donc exister et être distinct.
    nodes: noeuds.map((n) => ({ ...n, status: 'online', lastSeen: 0 })),
    tasks: [],
    tasksTotal: 0,
  } as unknown as StateSnapshot;
}

async function monter(snapshot: StateSnapshot): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Sante {...props} />));
  await act(async () => {});
  return conteneur;
}

describe('les Gardiennes — l’écran nomme LA machine qu’il met en cause', () => {
  it('LE NŒUD ACCUSÉ EST CELUI DE L’INSPECTION — jamais son voisin', async () => {
    const dom = await monter(
      instantane([
        { id: 'noeud-innocent', name: 'Le portable de Camille' },
        { id: 'noeud-coupable', name: 'Le serveur du grenier' },
      ]),
    );
    const nomme = dom.querySelector('.ga-noeud');
    expect(nomme, 'la ligne d’inspection doit nommer un nœud').toBeTruthy();

    expect(nomme?.textContent, 'la machine mise en cause est la bonne').toBe(
      'Le serveur du grenier',
    );
    // LA garde. Mutée, c'est cet innocent-là qui serait affiché — avec le bon
    // verdict et le bon grief à côté, donc sans rien qui cloche à l'écran.
    expect(nomme?.textContent, 'et surtout pas l’autre').not.toBe('Le portable de Camille');
  });

  it('UN NŒUD PARTI DE LA RUCHE REND SON IDENTIFIANT — pas le nom du voisin', async () => {
    // Le repli `?? nodeId`. Un nœud qui a quitté la ruche n'est plus dans
    // l'instantané : afficher « 3f2a-… » n'apprend rien, mais afficher le nom
    // d'une autre machine accuse quelqu'un à sa place. Le silence est le
    // moindre mal ; l'erreur nommée, le pire.
    const dom = await monter(
      instantane([{ id: 'noeud-innocent', name: 'Le portable de Camille' }]),
    );
    const nomme = dom.querySelector('.ga-noeud');
    expect(nomme?.textContent, 'faute de mieux, l’identifiant brut').toBe('noeud-coupable');
    expect(nomme?.textContent, 'jamais le nom d’un nœud qui n’a rien fait').not.toBe(
      'Le portable de Camille',
    );
  });

  it('LE GRIEF ACCOMPAGNE LE NOM — accuser sans dire de quoi ne sert à rien', async () => {
    const dom = await monter(instantane([{ id: 'noeud-coupable', name: 'Le serveur du grenier' }]));
    const ligne = dom.querySelector('.ga-liste li');
    expect(ligne?.textContent, 'le nom').toContain('Le serveur du grenier');
    expect(ligne?.textContent, 'et le reproche, dans la même phrase').not.toBe(
      'Le serveur du grenier',
    );
  });
});
