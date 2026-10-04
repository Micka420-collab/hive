// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCRAN DES CONNECTEURS — ce que l'Intendance montre d'une autorisation, et
// ce qu'elle dit d'un test.
//
// ─── DEUX MENSONGES QUE CE BANC FERME ────────────────────────────────────────
//
//   · Le formulaire d'autorisation s'initialise depuis l'autorisation COURANTE
//     au montage. Clé sur le seul id du connecteur, il survivait au changement
//     de projet : le projet B affichait les cases cochées du projet A — et un
//     clic sur « Mettre à jour » les lui aurait accordées.
//   · Le bouton « Tester » annonçait « Test envoyé » sur toute réponse 200 de
//     la Reine, y compris `{ envoye: false }` (récepteur en 500, portée
//     manquante) : un connecteur cassé passait pour prêt.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type {
  AutorisationConnecteur,
  ConnecteurCatalogue,
  ConnecteurProjetResume,
} from '../dashboard/src/api';

const WEBHOOK_RESUME: ConnecteurProjetResume = {
  id: 'webhook',
  libelleFr: 'Webhook générique',
  libelleEn: 'Generic webhook',
  mode: 'lecture_seule',
  portees: ['notification'],
  actif: true,
};

const WEBHOOK_CATALOGUE: ConnecteurCatalogue = {
  ...WEBHOOK_RESUME,
  hintFr: 'h',
  hintEn: 'h',
  secrets: [],
};

const AUTORISATION_A: AutorisationConnecteur = {
  connecteurId: 'webhook',
  portees: ['notification'],
  canaux: [],
  usagers: [],
  actif: true,
  majA: 1,
};

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchConnecteurs: vi.fn(() => Promise.resolve({ connecteurs: [WEBHOOK_CATALOGUE] })),
  fetchConnecteursProjet: vi.fn((projectId: string) =>
    Promise.resolve({
      autorisations: projectId === 'pA' ? [AUTORISATION_A] : [],
      journal: [],
      connecteurs: [WEBHOOK_RESUME],
    }),
  ),
  testerConnecteurProjet: vi.fn(() =>
    Promise.resolve({ ok: true, envoye: false, motif: 'statut 500' }),
  ),
}));

import { SectionConnecteurs } from '../dashboard/src/views/Connecteurs';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLang('fr');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const PROJETS = [
  { id: 'pA', name: 'Projet A' },
  { id: 'pB', name: 'Projet B' },
];

async function monter(): Promise<void> {
  await act(async () => {
    root.render(<SectionConnecteurs projets={PROJETS} />);
  });
}

function caseNotification(): HTMLInputElement {
  const c = host.querySelector<HTMLInputElement>('.in-portee input[type="checkbox"]');
  if (!c) throw new Error('case de portée absente');
  return c;
}

describe('SectionConnecteurs', () => {
  it('changer de projet ne reporte pas les portées du projet précédent', async () => {
    await monter();
    expect(caseNotification().checked).toBe(true);
    const choix = host.querySelector<HTMLSelectElement>('.in-projet-choix select')!;
    await act(async () => {
      choix.value = 'pB';
      choix.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(caseNotification().checked).toBe(false);
  });

  it('un test qui n’est pas parti le dit, avec le motif', async () => {
    await monter();
    const tester = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Tester')!;
    await act(async () => {
      tester.click();
    });
    const message = host.querySelector('.in-connecteur-message')?.textContent ?? '';
    expect(message).toContain('statut 500');
    expect(message).not.toContain('Test envoyé');
  });
});
