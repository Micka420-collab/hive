// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CARTE D'UNE OUVRIÈRE — sa charge, ses sous-agents, son dernier signe de vie.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties) :
//
//     es-agent-chip · es-agents-none · es-node-load · activeAgentsOf   (rien)
//     « aucun sous-agent en vol » · es-node-name                        (rien)
//
// `essaim-castes` tient le polyéthisme et le badge ⚔ ; `essaim-pheromones`
// tient la carte des phéromones. La carte d'ouvrière elle-même n'avait aucun
// cas. Les seuls « jamais vu » du dépôt sont ceux de la TUI, pas celui-ci.
//
// Le recensement ne conclut rien tout seul : les cinq mutants ci-dessous ont
// été posés ensemble, chacun vérifié posé, et la suite ENTIÈRE est restée
// verte — 288 fichiers, 4 180 tests. C'est la mesure qui prononce la nudité.
//
// ─── LE PLAFOND À SIX, ET POURQUOI IL A DEUX BORNES ──────────────────────────
//
//     agents.slice(0, 6).map(…)
//     {agents.length > 6 && <span>+{agents.length - 6}</span>}
//
// Deux lignes, deux seuils, et le même chiffre écrit dans les deux. Un cas « de
// sens » ne les départage pas : à 2 comme à 20 sous-agents, `slice(0, 6)` et
// `slice(0, 7)` rendent la même chose, et `> 6` comme `>= 6` disent la même
// chose. SEULES les valeurs égales aux bornes les séparent (§ 9 tertrigicenties) :
//
//     6 sous-agents PILE  →  six pastilles, et AUCUN « +N »
//     7 sous-agents       →  six pastilles, et « +1 »
//
// Sans la première, `>= 6` passe et une carte pleine affiche « +0 » : un
// compteur de débordement là où rien ne déborde. Sans la seconde, `slice(0, 7)`
// passe et la carte s'allonge d'un cran de plus que ce que son compteur annonce.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
//     agents.slice(0, 6)                    →  slice(0, 7)   (borne)
//     agents.length > 6                     →  >= 6          (borne)
//     if (a.status === 'running')           →  !==
//     if (t.assignedNodeId !== nodeId)      →  ===
//     node.lastSeen === null ? 'jamais vu'  →  !== null
//
// ─── LARGE RAYON N'EST PAS PLANTAGE — LE COMPTE A ÉTÉ LU ─────────────────────
//
// Deux de ces mutants — le filtre du vol, et l'imputation au nœud — font tomber
// QUATRE cas sur cinq. Le § 9 quintrigicenties demande de s'en méfier : un
// mutant qui abat tout un fichier tue peut-être par `TypeError` au montage, et
// ne prouve alors que la capacité du banc à monter la vue.
//
// Vérifié en lisant les verdicts : `AssertionError`, avec la sortie fautive
// citée (`expected [] to have a length of 2`). Ces deux gardes vident
// réellement TOUTES les cartes de leurs pastilles — quatre cas en dépendent,
// et c'est le sujet qui est large, pas le mutant qui triche.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveNode, StateSnapshot, SubAgent, Task } from '../src/shared/types';

// Les QUATRE sondes de la vue sont bouchées, pas seulement celles qu'on met en
// scène : un bouchon partiel laisse partir au réseau tout ce qu'on n'a pas
// nommé (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
}));

import { fetchPheromones, fetchPolyethisme, fetchRaces, fetchWaggle } from '../dashboard/src/api';
import Essaim from '../dashboard/src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Le plafond de pastilles, tel que le produit le pose. */
const PLAFOND = 6;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchWaggle)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchRaces)
    .mockReset()
    .mockResolvedValue({ races: [] } as never);
  vi.mocked(fetchPheromones)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchPolyethisme)
    .mockReset()
    .mockResolvedValue(null as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const noeud = (over: Partial<HiveNode> = {}): HiveNode =>
  ({
    id: 'n-1',
    name: 'ruche-nord',
    ownerName: 'apicultrice',
    agentType: 'shell',
    maxConcurrency: 4,
    running: 1,
    status: 'online',
    lastSeen: null,
    ...over,
  }) as HiveNode;

const tache = (id: string, assignedNodeId: string | null): Task =>
  ({
    id,
    projectId: 'p-1',
    title: `Tâche ${id}`,
    prompt: 'p',
    status: 'running',
    dependsOn: [],
    assignedNodeId,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  }) as unknown as Task;

const sousAgent = (id: string, status: SubAgent['status'] = 'running'): SubAgent => ({
  id,
  name: `agent-${id}`,
  status,
});

async function monter(
  nodes: HiveNode[],
  tasks: Task[] = [],
  agentsByTask: Record<string, SubAgent[]> = {},
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: { projects: [], nodes, tasks, tasksTotal: tasks.length } as unknown as StateSnapshot,
    events: [],
    agentsByTask,
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Essaim {...props} />));
  await act(async () => {});
  return conteneur;
}

/** La carte d'une ouvrière, désignée par SON nom — jamais par son rang. */
function carte(dom: HTMLElement, nom: string): HTMLElement {
  const c = [...dom.querySelectorAll<HTMLElement>('article.es-node')].find((e) =>
    (e.querySelector('.es-node-name')?.textContent ?? '').includes(nom),
  );
  if (!c) throw new Error(`la carte de « ${nom} » est introuvable`);
  return c;
}

const pastilles = (c: HTMLElement): HTMLElement[] => [
  ...c.querySelectorAll<HTMLElement>('.es-agent-chip'),
];

/** Le « +N » du débordement, ou `null` s'il n'y en a pas. */
function debordement(c: HTMLElement): string | null {
  const t = [...c.querySelectorAll<HTMLElement>('.es-agents-none')]
    .map((e) => e.textContent ?? '')
    .find((s) => s.startsWith('+'));
  return t ?? null;
}

/** Une tâche assignée au nœud, portant `n` sous-agents en vol. */
function enVol(n: number, prefixe = 'a'): { tasks: Task[]; agents: Record<string, SubAgent[]> } {
  return {
    tasks: [tache('t-1', 'n-1')],
    agents: {
      't-1': Array.from({ length: n }, (_, i) => sousAgent(`${prefixe}${i + 1}`)),
    },
  };
}

describe('la carte d’une ouvrière : ce qu’elle porte en vol', () => {
  it('UNE OUVRIÈRE MONTRE SON NOM, SA CHARGE ET SES SOUS-AGENTS — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const { tasks, agents } = enVol(2);
    const dom = await monter([noeud({ running: 2, maxConcurrency: 4 })], tasks, agents);
    const c = carte(dom, 'ruche-nord');

    expect(c.textContent, 'la charge de l’ouvrière n’est pas affichée').toContain('2/4');
    expect(pastilles(c), 'les sous-agents en vol ne sont pas rendus').toHaveLength(2);
    expect(c.textContent, 'le nom d’un sous-agent manque').toContain('agent-a1');
  });

  it('SIX PILE : SIX PASTILLES ET AUCUN « +N » — sept : six et « +1 »', async () => {
    // ─── LES DEUX BORNES DU PLAFOND (§ 9 tertrigicenties) ──────────────────
    //
    // Deux lignes portent le même chiffre, et chacune a sa borne. Un cas de
    // sens ne départage ni `slice(0, 6)` de `slice(0, 7)`, ni `> 6` de `>= 6` :
    // à 2 comme à 20 sous-agents, les deux versions rendent la même carte.
    // Seules les valeurs ÉGALES aux seuils les séparent.
    const { tasks, agents } = enVol(PLAFOND);
    const plein = await monter([noeud()], tasks, agents);
    const cPlein = carte(plein, 'ruche-nord');

    expect(pastilles(cPlein), 'la carte pleine ne montre pas ses six sous-agents').toHaveLength(
      PLAFOND,
    );
    expect(
      debordement(cPlein),
      'une carte qui montre TOUT LE MONDE annonce quand même un débordement — « +0 »',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();

    const trop = await monter([noeud()], [tache('t-1', 'n-1')], {
      't-1': Array.from({ length: PLAFOND + 1 }, (_, i) => sousAgent(`a${i + 1}`)),
    });
    const cTrop = carte(trop, 'ruche-nord');

    expect(
      pastilles(cTrop),
      'le plafond laisse passer une pastille de trop — la carte dépasse ce que son compteur annonce',
    ).toHaveLength(PLAFOND);
    expect(debordement(cTrop), 'le débordement d’un cran n’est pas compté').toBe('+1');
  });

  it('SEUL CE QUI VOLE EST EN VOL — un sous-agent terminé n’encombre pas la carte', async () => {
    // Le libellé dit « en vol », et c'est ce que l'opérateur lit pour savoir
    // ce qui tourne EN CE MOMENT sur cette machine. Inversé, la carte annonce
    // en vol tout ce qui a fini et cache ce qui tourne : une ouvrière au repos
    // paraît saturée, et une ouvrière saturée paraît libre.
    //
    // Les deux mondes dans le même montage : muté, ils s'échangent exactement.
    const dom = await monter([noeud()], [tache('t-1', 'n-1')], {
      't-1': [sousAgent('vif', 'running'), sousAgent('fini', 'done'), sousAgent('mort', 'failed')],
    });
    const c = carte(dom, 'ruche-nord');

    expect(pastilles(c), 'la carte compte autre chose que les sous-agents en vol').toHaveLength(1);
    expect(c.textContent, 'le sous-agent qui vole n’est pas montré').toContain('agent-vif');
    expect(c.textContent, 'un sous-agent terminé est annoncé en vol').not.toContain('agent-fini');
    expect(c.textContent, 'un sous-agent tombé est annoncé en vol').not.toContain('agent-mort');
  });

  it('CHAQUE OUVRIÈRE NE PORTE QUE LES SIENS — pas ceux de sa voisine', async () => {
    // `activeAgentsOf` impute par `assignedNodeId`. Inversée, la condition
    // donne à chaque carte les sous-agents de TOUTES LES AUTRES : la ruche
    // paraît deux fois plus chargée qu'elle ne l'est, et l'on ne peut plus
    // dire quelle machine fait quoi — ce qui est la seule raison d'être de
    // ces cartes.
    const dom = await monter(
      [noeud({ id: 'n-1', name: 'ruche-nord' }), noeud({ id: 'n-2', name: 'ruche-sud' })],
      [tache('t-nord', 'n-1'), tache('t-sud', 'n-2')],
      {
        't-nord': [sousAgent('du-nord')],
        't-sud': [sousAgent('du-sud')],
      },
    );

    const nord = carte(dom, 'ruche-nord');
    const sud = carte(dom, 'ruche-sud');

    expect(nord.textContent, 'l’ouvrière du nord ne porte pas son sous-agent').toContain(
      'agent-du-nord',
    );
    expect(nord.textContent, 'l’ouvrière du nord porte le sous-agent de sa voisine').not.toContain(
      'agent-du-sud',
    );
    expect(sud.textContent, 'l’ouvrière du sud ne porte pas son sous-agent').toContain(
      'agent-du-sud',
    );
    expect(sud.textContent, 'l’ouvrière du sud porte le sous-agent de sa voisine').not.toContain(
      'agent-du-nord',
    );
  });

  it('UNE OUVRIÈRE QUI N’A JAMAIS RÉPONDU LE DIT — et celle qui a répondu donne son heure', async () => {
    // Le pied de carte est le seul endroit où se lit « cette machine a-t-elle
    // jamais parlé à la ruche ? ». Échangé, une ouvrière inscrite mais jamais
    // jointe affiche une heure de dernier contact — inventée à partir de
    // `null` — et celle qui répond depuis des heures se déclare jamais vue.
    const dom = await monter([
      noeud({ id: 'n-1', name: 'ruche-muette', lastSeen: null }),
      noeud({ id: 'n-2', name: 'ruche-vive', lastSeen: 1_700_000_000_000 }),
    ]);

    const muette = carte(dom, 'ruche-muette').querySelector('.es-node-foot')?.textContent ?? '';
    const vive = carte(dom, 'ruche-vive').querySelector('.es-node-foot')?.textContent ?? '';

    expect(muette, 'une ouvrière jamais jointe ne le dit pas').toContain('jamais vu');
    expect(vive, 'une ouvrière qui répond se déclare jamais vue').not.toContain('jamais vu');
    expect(vive, 'l’heure du dernier contact n’est pas donnée').toContain('vu à');
  });
});
