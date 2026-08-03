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
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode, Task } from '../src/shared/types';

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
  return conteneur;
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
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(<NodesPanel nodes={nodes} tasks={tasks} onOpenTask={onOpenTask} />),
  );
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('le panneau des nœuds — la machine se lit sur la carte', () => {
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
    cliquer(carte as Element);
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

  it('CLIQUER UNE MISSION OUVRE LE TIROIR — et referme la fiche', async () => {
    const ouvrir = vi.fn();
    const dom = await monterAvecFiche(NOEUDS, MISSIONS, ouvrir);
    cliquer(
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
    cliquer(
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
});
