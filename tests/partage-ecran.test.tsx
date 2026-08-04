// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PARTAGE, À L'ÉCRAN — ce que voit un INVITÉ qui ouvre un lien de partage.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage : `rapport === null ? (…) : (…)` — nudité confirmée
// contre la suite entière. C'est le PREMIER écran d'un invité : il colle le
// lien qu'on lui a envoyé, la page s'ouvre, et tant que le rapport n'est pas
// arrivé, il faut lui dire « ça charge » plutôt que le laisser devant un vide —
// ou, pire, tenter de rendre un rapport qui n'existe pas encore.
//
// Mutée en `!==`, les deux branches s'échangent : à l'ouverture (rapport
// `null`), la vue tenterait de lire `rapport.name` sur `null` — un plantage à
// l'accueil, pour quelqu'un qui découvre le produit. Le contraste ci-dessous
// épingle les deux sens : `null` dit « ça charge », un rapport reçu montre son
// nom et NE dit plus « ça charge ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ProjectReport } from '../dashboard/src/api';

// On simule la lecture du rapport et celle du Rayon (chargé en différé dans la
// branche « chargé ») pour qu'aucun vrai appel réseau ne parte.
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReport: vi.fn(),
  clearPartage: vi.fn(),
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
  fetchFichierRayon: vi.fn(() => Promise.resolve(null)),
}));

import { fetchReport } from '../dashboard/src/api';
import Partage from '../dashboard/src/views/Partage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchReport).mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Partage projectId="p-invite" />));
  await act(async () => {});
  return conteneur;
}

const RAPPORT = {
  projectId: 'p-invite',
  name: 'Rucher partagé',
  done: 2,
  total: 5,
  progressPct: 40,
} as unknown as ProjectReport;

describe('l’écran de partage vu par un invité', () => {
  it('À L’OUVERTURE, tant que le rapport n’est pas là, on DIT que ça charge', async () => {
    // Le rapport ne revient jamais dans ce test : la vue reste en attente. Sans
    // le message, l'invité fait face à un vide et croit le lien cassé.
    vi.mocked(fetchReport).mockReturnValue(new Promise<ProjectReport>(() => {}));
    const dom = await monter();
    expect(dom.textContent, 'l’attente se nomme').toContain('Ouverture du rayon');
    expect(dom.textContent, 'et le rapport absent ne s’affiche pas').not.toContain(
      'Rucher partagé',
    );
  });

  it('UNE FOIS LE RAPPORT REÇU, on montre son nom et on NE dit plus « ça charge »', async () => {
    // L'autre sens du contraste. Mutée, cette branche-ci s'afficherait à
    // l'ouverture (sur `null`) et planterait ; ici on vérifie qu'elle ne sort
    // QUE quand le rapport existe.
    vi.mocked(fetchReport).mockResolvedValue(RAPPORT);
    const dom = await monter();
    expect(dom.textContent, 'le rapport reçu se montre').toContain('Rucher partagé');
    expect(dom.textContent, 'et l’attente a disparu').not.toContain('Ouverture du rayon');
    // Le contraste explicite : le nom et l'avancement sont là.
    expect(dom.textContent, 'l’avancement se lit').toContain('2/5');
  });
});
