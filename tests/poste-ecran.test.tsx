// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE POSTE, À L'ÉCRAN — la machine de chaque ouvrière se lit sur sa carte.
//
// La moitié écran du fil « poste-machine » : une ouvrière qui a déclaré sa
// machine porte sa puce (🪟 windows — la question d'origine était « quelles
// ouvrières tournent sous Windows ? ») ; une ouvrière d'une version
// antérieure n'en porte AUCUNE — rien, plutôt qu'une plateforme inventée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode, Task } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() =>
    Promise.resolve({ nodes: [], totalTasksDone: 0, totalTasksFailed: 0, topNodeId: null }),
  ),
  fetchChambre: vi.fn(() =>
    Promise.resolve({
      nodeId: 'x',
      bapteme: null,
      metier: null,
      caste: 'nourrice',
      node: {
        id: 'x',
        status: 'online',
        plateforme: null,
        agentType: 'shell',
        ownerName: 't',
        running: 0,
        maxConcurrency: 1,
        lastSeen: 1,
        nameTechnique: 'x',
      },
      presences: [],
      tasks: [],
      atelier: { mode: 'off', actif: false, ecran: '', cdp: '', outil: '' },
    }),
  ),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { fetchBaptemes, fetchChambre, fetchWaggle } from '../dashboard/src/api';
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchWaggle)
    .mockReset()
    .mockResolvedValue({
      nodes: [],
      totalTasksDone: 0,
      totalTasksFailed: 0,
      topNodeId: null,
    } as never);
  vi.mocked(fetchChambre)
    .mockReset()
    .mockImplementation(async (nodeId: string) => ({
      nodeId,
      bapteme: null,
      metier: null,
      caste: 'nourrice',
      node: {
        id: nodeId,
        status: 'online',
        plateforme: null,
        agentType: 'shell',
        ownerName: 't',
        running: 0,
        maxConcurrency: 1,
        lastSeen: 1,
        nameTechnique: nodeId.replace(/^n-/, ''),
      },
      presences: [],
      tasks: [],
      atelier: { mode: 'off', actif: false, ecran: '', cdp: '', outil: '' },
    }));
  vi.mocked(fetchBaptemes).mockReset().mockResolvedValue({ baptemes: [] });
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function ouvriere(name: string, plateforme?: HiveNode['plateforme']): HiveNode {
  return {
    id: `n-${name}`,
    name,
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
    running: 0,
    status: 'online',
    lastSeen: 1,
    ...(plateforme !== undefined ? { plateforme } : {}),
  };
}

async function monter(nodes: HiveNode[]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<NodesPanel nodes={nodes} />));
  await act(async () => {});
  // Le corps entier, pas le seul conteneur : une modale se monte par PORTAIL à
  // la racine du document (voir `Voile`), donc hors de cet arbre-ci.
  return document.body;
}

function mission(id: string, titre: string, nodeId: string, statut: Task['status']): Task {
  return {
    id,
    projectId: 'p1',
    title: titre,
    prompt: 'p',
    status: statut,
    dependsOn: [],
    assignedNodeId: statut === 'done' || statut === 'failed' ? null : nodeId,
    result:
      statut === 'done' || statut === 'failed'
        ? { success: statut === 'done', nodeId, durationMs: 5 }
        : null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
  };
}

async function monterAvecFiche(
  nodes: HiveNode[],
  tasks: Task[],
  onOpenTask: (id: string) => void,
  onOuvrirPoste?: (nodeId: string) => void,
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(
      <NodesPanel
        nodes={nodes}
        tasks={tasks}
        onOpenTask={onOpenTask}
        onOuvrirPoste={onOuvrirPoste}
      />,
    ),
  );
  await act(async () => {});
  // Le corps entier, pas le seul conteneur : une modale se monte par PORTAIL à
  // la racine du document (voir `Voile`), donc hors de cet arbre-ci.
  return document.body;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Clic + flush des effets (fetchChambre / fetchWaggle / baptêmes). */
async function cliquerEtAttendre(el: Element): Promise<void> {
  cliquer(el);
  await act(async () => {});
}

describe('le panneau des nœuds — la machine se lit sur la carte', () => {
  it('LA CARTE AFFICHE LE BAPTÊME CONSTATÉ quand l’API le fournit', async () => {
    vi.mocked(fetchBaptemes).mockResolvedValue({
      baptemes: [{ nodeId: 'n-ruche-fenetre', nom: 'Capucine', baptiseA: 1 }],
    });
    const dom = await monter([ouvriere('ruche-fenetre', 'windows')]);
    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('Capucine'),
    );
    expect(carte).toBeTruthy();
    expect(carte?.textContent).toContain('Technique');
    expect(carte?.textContent).toContain('ruche-fenetre');
  });

  it('SI L’API BAPTÊMES ÉCHOUE : nom technique, pas « Pas encore baptisée »', async () => {
    vi.mocked(fetchBaptemes).mockRejectedValue(new Error('401'));
    const dom = await monter([ouvriere('ruche-fenetre', 'windows')]);
    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('ruche-fenetre'),
    );
    expect(carte).toBeTruthy();
    expect(carte?.textContent).not.toContain('Pas encore baptisée');
    expect(carte?.textContent).not.toContain('Technique');
  });

  it('LISTE VIDE CONSTATÉE : « Pas encore baptisée », pas un prénom inventé', async () => {
    vi.mocked(fetchBaptemes).mockResolvedValue({ baptemes: [] });
    const dom = await monter([ouvriere('ruche-fenetre', 'windows')]);
    const carte = [...dom.querySelectorAll('.node-card')][0];
    expect(carte?.textContent).toContain('Pas encore baptisée');
    expect(carte?.textContent).toContain('Technique');
    expect(carte?.textContent).toContain('ruche-fenetre');
    expect(carte?.textContent).not.toMatch(/Adrien|Capucine/);
  });

  it('L’OUVRIÈRE WINDOWS PORTE SA PUCE 🪟 — c’était la question d’origine', async () => {
    const dom = await monter([
      ouvriere('ruche-fenetre', 'windows'),
      ouvriere('ruche-manchot', 'linux'),
    ]);
    const cartes = [...dom.querySelectorAll('.node-card')];
    const fenetre = cartes.find((c) => (c.textContent ?? '').includes('ruche-fenetre'));
    const manchot = cartes.find((c) => (c.textContent ?? '').includes('ruche-manchot'));
    expect(fenetre?.textContent).toContain('🪟 windows');
    expect(fenetre?.textContent).not.toContain('🐧');
    expect(manchot?.textContent).toContain('🐧 linux');
    expect(manchot?.textContent).not.toContain('🪟');
  });

  it('UNE OUVRIÈRE D’AVANT NE PORTE RIEN — pas de plateforme inventée', async () => {
    const dom = await monter([ouvriere('ruche-ancienne')]);
    expect(dom.querySelector('.node-plateforme')).toBeNull();
    expect(dom.textContent).not.toContain('🪟');
    expect(dom.textContent).not.toContain('❔');
  });
});

describe('la fiche coéquipière — l’ouvrière se présente, missions comprises', () => {
  const NOEUDS = [ouvriere('ruche-fenetre', 'windows'), ouvriere('ruche-manchot', 'linux')];
  const MISSIONS = [
    mission('m-1', 'Construire le rayon', 'n-ruche-fenetre', 'done'),
    mission('m-2', 'Peindre la vitrine', 'n-ruche-fenetre', 'failed'),
    mission('m-3', 'Butiner en cours', 'n-ruche-fenetre', 'running'),
    mission('m-autre', 'La mission du manchot', 'n-ruche-manchot', 'done'),
  ];

  it('CLIQUER LA CARTE OUVRE LA FICHE — et SES missions seulement', async () => {
    // La garde qui compte : `assignedNodeId === id || result.nodeId === id`.
    // Mutée, la fiche listerait les missions DES AUTRES sous ce nom-là.
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {});
    expect(dom.querySelector('[role="dialog"]'), 'aucune fiche avant le clic').toBeNull();

    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('ruche-fenetre'),
    );
    await cliquerEtAttendre(carte as Element);
    const fiche = dom.querySelector('[role="dialog"]');
    expect(fiche, 'la fiche s’ouvre').toBeTruthy();
    expect(fiche?.textContent).toContain('ruche-fenetre');
    expect(fiche?.textContent).toContain('🪟 windows');
    expect(fiche?.textContent).toContain('Construire le rayon');
    expect(fiche?.textContent).toContain('Peindre la vitrine');
    expect(fiche?.textContent).toContain('Butiner en cours');
    expect(
      fiche?.textContent,
      'les missions des autres ne se rangent pas sous ce nom',
    ).not.toContain('La mission du manchot');
    // Le compte dit le vrai : une butinée, une échouée.
    expect(fiche?.textContent).toContain('✔ 1 · ✘ 1');
  });

  it('LA FICHE TITRE AU BAPTÊME CONSTATÉ — le name technique reste secondaire', async () => {
    vi.mocked(fetchChambre).mockImplementation(async (nodeId: string) => ({
      nodeId,
      bapteme: { nom: 'Capucine', baptiseA: 1 },
      metier: null,
      caste: 'nourrice',
      node: {
        id: nodeId,
        status: 'online',
        plateforme: 'windows',
        agentType: 'shell',
        ownerName: 't',
        running: 0,
        maxConcurrency: 1,
        lastSeen: 1,
        nameTechnique: 'ruche-fenetre',
      },
      presences: [],
      tasks: [],
      atelier: { mode: 'off', actif: false, ecran: '', cdp: '', outil: '' },
    }));
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {});
    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('ruche-fenetre'),
    );
    await cliquerEtAttendre(carte as Element);
    const fiche = dom.querySelector('[role="dialog"]');
    expect(fiche?.textContent).toContain('Capucine');
    expect(fiche?.textContent).toContain('Technique');
    expect(fiche?.textContent).toContain('ruche-fenetre');
    expect(fiche?.querySelector('#fiche-ouvriere-titre')?.textContent).toContain('Capucine');
    expect(fiche?.querySelector('#fiche-ouvriere-titre')?.textContent).not.toContain(
      'ruche-fenetre',
    );
  });

  it('Ouvrir le poste nomme le baptême constaté et navigue vers la Chambre', async () => {
    vi.mocked(fetchChambre).mockImplementation(async (nodeId: string) => ({
      nodeId,
      bapteme: { nom: 'Capucine', baptiseA: 1 },
      metier: null,
      caste: 'nourrice',
      node: {
        id: nodeId,
        status: 'online',
        plateforme: 'windows',
        agentType: 'shell',
        ownerName: 't',
        running: 0,
        maxConcurrency: 1,
        lastSeen: 1,
        nameTechnique: 'ruche-fenetre',
      },
      presences: [],
      tasks: [],
      atelier: { mode: 'off', actif: false, ecran: '', cdp: '', outil: '' },
    }));
    const onPoste = vi.fn();
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {}, onPoste);
    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('ruche-fenetre'),
    );
    await cliquerEtAttendre(carte as Element);
    const btn = dom.querySelector('[data-testid="fiche-ouvrir-chambre"]') as HTMLButtonElement;
    expect(btn?.textContent).toContain('Capucine');
    await cliquerEtAttendre(btn);
    expect(onPoste).toHaveBeenCalledWith('n-ruche-fenetre');
    expect(dom.querySelector('[role="dialog"]')).toBeNull();
  });

  it('SI fetchChambre ÉCHOUE SUR LA FICHE : nom technique, pas « Pas encore baptisée »', async () => {
    vi.mocked(fetchChambre).mockRejectedValue(new Error('503'));
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {});
    const carte = [...dom.querySelectorAll('.node-card')].find((c) =>
      (c.textContent ?? '').includes('ruche-fenetre'),
    );
    await cliquerEtAttendre(carte as Element);
    const titre = dom.querySelector('#fiche-ouvriere-titre')?.textContent ?? '';
    expect(titre).toContain('ruche-fenetre');
    expect(titre).not.toContain('Pas encore baptisée');
  });

  it('LA FICHE DIT L’ÉTAT DE LA MACHINE — « en ligne » pour la vive, « hors ligne » pour la muette', async () => {
    // Le panneau d'admin sert à DÉCIDER : couper une ouvrière, en relancer une.
    // Sans la garde `status === 'online'`, une machine EN LIGNE s'annoncerait
    // « hors ligne » et l'inverse — on couperait la vivante, on croirait la
    // morte encore là. La garde vit dans la fiche : on l'ouvre pour la lire.
    const vive = ouvriere('ruche-vive'); // status: 'online'
    const muette = { ...ouvriere('ruche-muette'), status: 'offline' as const };
    const dom = await monterAvecFiche([vive, muette], [], () => {});

    const carte = (nom: string) =>
      [...dom.querySelectorAll('.node-card')].find((c) =>
        (c.textContent ?? '').includes(nom),
      ) as Element;

    await cliquerEtAttendre(carte('ruche-vive'));
    const ficheVive = dom.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(ficheVive, 'la machine en ligne s’annonce en ligne').toContain('en ligne');
    expect(ficheVive, 'et jamais hors ligne').not.toContain('hors ligne');
    cliquer(dom.querySelector('.modal-close') as Element);

    await cliquerEtAttendre(carte('ruche-muette'));
    const ficheMuette = dom.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(ficheMuette, 'la machine hors ligne s’annonce hors ligne').toContain('hors ligne');
    expect(ficheMuette, 'et jamais en ligne').not.toContain('en ligne');
  });

  it('CLIQUER UNE MISSION OUVRE LE TIROIR — et referme la fiche', async () => {
    const ouvrir = vi.fn();
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, ouvrir);
    await cliquerEtAttendre(
      [...dom.querySelectorAll('.node-card')].find((c) =>
        (c.textContent ?? '').includes('ruche-fenetre'),
      ) as Element,
    );
    const ligne = [...dom.querySelectorAll('.fo-mission')].find((l) =>
      (l.textContent ?? '').includes('Construire le rayon'),
    );
    cliquer(ligne as Element);
    expect(ouvrir).toHaveBeenCalledWith('m-1');
    expect(
      dom.querySelector('[role="dialog"]'),
      'deux surfaces modales ne s’empilent pas',
    ).toBeNull();
  });

  it('SANS MISSIONS : la fiche le dit, sans inventer de liste', async () => {
    const dom = await monterAvecFiche(NOEUDS, [], () => {});
    await cliquerEtAttendre(
      [...dom.querySelectorAll('.node-card')].find((c) =>
        (c.textContent ?? '').includes('ruche-manchot'),
      ) as Element,
    );
    expect(dom.querySelector('[role="dialog"]')?.textContent).toContain('Aucune mission encore');
  });

  it('SANS LES TÂCHES, le panneau reste celui d’avant : le clic n’ouvre rien', async () => {
    const dom = await monter(NOEUDS);
    cliquer(dom.querySelector('.node-card') as Element);
    expect(dom.querySelector('[role="dialog"]')).toBeNull();
  });

  it('LE NECTAR DE LA FICHE EST CELUI DE CETTE OUVRIÈRE — pas celui de la voisine', async () => {
    // Deux lignes au classement, des chiffres différents : muté en `!==`, la
    // fiche porterait le nectar de l'AUTRE sous ce nom-là.
    const ligne = (nodeId: string, score: number, successRate: number, raceWins: number) => ({
      nodeId,
      name: nodeId,
      agentType: 'shell',
      tasksDone: 5,
      tasksFailed: 1,
      totalDurationMs: 6_000,
      avgDurationMs: 1_200,
      successRate,
      raceWins,
      score,
    });
    vi.mocked(fetchWaggle).mockResolvedValue({
      nodes: [ligne('n-ruche-manchot', 99, 1, 7), ligne('n-ruche-fenetre', 24, 5 / 6, 2)],
      totalTasksDone: 10,
      totalTasksFailed: 2,
      topNodeId: 'n-ruche-manchot',
    } as never);
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {});
    await cliquerEtAttendre(
      [...dom.querySelectorAll('.node-card')].find((c) =>
        (c.textContent ?? '').includes('ruche-fenetre'),
      ) as Element,
    );
    const nectar = dom.querySelector('.fo-nectar');
    expect(nectar, 'la ligne de nectar se montre').toBeTruthy();
    expect(nectar?.textContent).toContain('24 nectar');
    expect(nectar?.textContent).toContain('83 % de réussite');
    expect(nectar?.textContent).toContain('◇ 2');
    expect(nectar?.textContent, 'pas le nectar de la voisine').not.toContain('99');
  });

  it('SANS VICTOIRE DE COURSE, pas de ◇ — et sans ligne au classement, pas de nectar', async () => {
    vi.mocked(fetchWaggle).mockResolvedValue({
      nodes: [
        {
          nodeId: 'n-ruche-fenetre',
          name: 'ruche-fenetre',
          agentType: 'shell',
          tasksDone: 2,
          tasksFailed: 0,
          totalDurationMs: 100,
          avgDurationMs: 50,
          successRate: 1,
          raceWins: 0,
          score: 8,
        },
      ],
      totalTasksDone: 2,
      totalTasksFailed: 0,
      topNodeId: 'n-ruche-fenetre',
    } as never);
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, () => {});
    const carte = (nom: string) =>
      [...dom.querySelectorAll('.node-card')].find((c) =>
        (c.textContent ?? '').includes(nom),
      ) as Element;

    await cliquerEtAttendre(carte('ruche-fenetre'));
    expect(dom.querySelector('.fo-nectar')?.textContent).toContain('8 nectar');
    expect(
      dom.querySelector('.fo-nectar')?.textContent,
      'zéro victoire ne se décore pas',
    ).not.toContain('◇');

    // Ferme, puis ouvre la voisine — absente du classement : le nectar se tait.
    cliquer(dom.querySelector('.modal-close') as Element);
    await cliquerEtAttendre(carte('ruche-manchot'));
    expect(dom.querySelector('[role="dialog"]')?.textContent).toContain('ruche-manchot');
    expect(
      dom.querySelector('.fo-nectar'),
      'pas de ligne au classement, pas de nectar inventé',
    ).toBeNull();
  });
});

// ─── UNE CARTE N'A L'AIR CLIQUABLE QUE SI ELLE L'EST ─────────────────────────
//
// `{...(tasks && onOpenTask ? activateProps(…) : {})}` — survivant du balayage
// de nuit, `&&` muté en `||` ne faisait rougir personne.
//
// Ce que la mutation produit n'est pas une carte cassée, c'est PIRE : une
// carte qui porte `role="button"`, `tabIndex=0`, le curseur main et la réponse
// au clavier — et qui n'ouvre RIEN. La fiche exige les deux propriétés
// (`tasks && onOpenTask && ouverte`), donc `setOuverte` réussit et l'écran ne
// bouge pas.
//
// Pour quelqu'un qui navigue au clavier, c'est un arrêt de tabulation qui ne
// mène nulle part, annoncé « bouton » par un lecteur d'écran. Une affordance
// qui ment coûte plus cher qu'une absence d'affordance : on réessaie.

describe('la carte d’une ouvrière n’est activable que si elle mène quelque part', () => {
  it('LES DEUX PROPRIÉTÉS FOURNIES : la carte est un bouton', async () => {
    const racineDom = await monterAvecFiche(
      [ouvriere('Maya')],
      [mission('t1', 'Butiner', 'n-Maya', 'done')],
      () => {},
    );
    const carte = racineDom.querySelector('.node-card');
    expect(carte?.getAttribute('role'), 'elle mène à la fiche, elle le dit').toBe('button');
    expect(carte?.getAttribute('tabindex'), 'et le clavier peut l’atteindre').toBe('0');
  });

  it('AUCUNE DES DEUX : la carte n’est PAS un bouton', async () => {
    // `monter` ne passe ni `tasks` ni `onOpenTask` — le cas du panneau
    // d'accueil, où les cartes ne sont que de l'affichage.
    const racineDom = await monter([ouvriere('Maya')]);
    const carte = racineDom.querySelector('.node-card');
    expect(carte?.getAttribute('role'), 'rien à ouvrir, donc pas un bouton').toBeNull();
    expect(carte?.getAttribute('tabindex'), 'et pas un arrêt de tabulation').toBeNull();
  });

  it('UNE SEULE DES DEUX NE SUFFIT PAS — c’est CE cas que le `&&` protège', async () => {
    // LA garde. Sous `||`, ces deux montages rendraient une carte « bouton »
    // qui n'ouvre rien. Les deux sens sont éprouvés : il ne suffit pas que
    // l'un des deux manque, il faut que CHACUN, seul, soit insuffisant.
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);

    // `tasks` seule, sans `onOpenTask`.
    await act(async () =>
      racine?.render(
        <NodesPanel nodes={[ouvriere('Maya')]} tasks={[mission('t1', 'B', 'n-Maya', 'done')]} />,
      ),
    );
    expect(
      conteneur.querySelector('.node-card')?.getAttribute('role'),
      'des missions mais personne pour les ouvrir',
    ).toBeNull();

    // `onOpenTask` seule, sans `tasks`.
    await act(async () =>
      racine?.render(<NodesPanel nodes={[ouvriere('Maya')]} onOpenTask={() => {}} />),
    );
    expect(
      conteneur.querySelector('.node-card')?.getAttribute('role'),
      'de quoi ouvrir, mais rien à montrer',
    ).toBeNull();
  });
});
