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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';

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
