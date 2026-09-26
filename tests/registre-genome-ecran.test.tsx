// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE REGISTRE GENOME, À L'ÉCRAN — des faits, pas une note.
//
// Chaque fait est lu dans sa colonne ; le coût fournisseur est dit inconnu ;
// une affectation sans modèle déclaré est signalée sans être rangée sous un
// modèle ; une fenêtre pleine le dit.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { RegistreGenome } from '../dashboard/src/RegistreGenome';
import { couperLeReseau, type ReseauCoupe } from './aide/sans-reseau';
import type { FaitsGenome, RegistreGenome as Registre } from '../src/shared/registre-genome';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let reseau: ReseauCoupe | null = null;

beforeEach(() => {
  setLang('fr');
  // Le panneau reçoit le registre en props : il ne doit appeler personne.
  reseau = couperLeReseau();
});
afterEach(() => {
  expect(reseau?.appels).toEqual([]);
  reseau?.rendre();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const faits = (over: Partial<FaitsGenome> = {}): FaitsGenome => ({
  affectations: 0,
  rendus: 0,
  reprises: 0,
  echecs: 0,
  refus: 0,
  interrompues: 0,
  corrections: 0,
  avis: { valides: 0, contestes: 0, modeleProuve: 0 },
  humain: { approuvees: 0, rejetees: 0 },
  dureeMedianeMs: null,
  coutFournisseur: 'inconnu',
  dureeModele: 'inconnu',
  modelesExacts: [],
  ...over,
});

function monter(registre: Registre | null, erreur: string | null = null): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine?.render(<RegistreGenome registre={registre} erreur={erreur} />));
  return conteneur;
}

describe('registre Genome — écran', () => {
  it('rend chaque fait dans sa colonne, et le coût reste inconnu', () => {
    const c = monter({
      lignes: [
        {
          modele: 'alpha',
          categorie: 'code',
          ...faits({
            affectations: 3,
            rendus: 2,
            reprises: 1,
            corrections: 1,
            avis: { valides: 2, contestes: 1, modeleProuve: 1 },
            humain: { approuvees: 1, rejetees: 0 },
            dureeMedianeMs: 1_500,
          }),
        },
      ],
      sansModele: faits(),
      fenetre: { evenements: 12, depuis: 1, tronquee: false },
    });
    const cellules = [...c.querySelectorAll('[data-testid="genome-ligne"] td')].map(
      (td) => td.textContent,
    );

    expect(cellules).toEqual([
      'alpha',
      'code',
      '2/3',
      '1 · 0 · 0 · 0',
      '1',
      '✓ 2 · ✗ 1',
      '✓ 1 · ✗ 0',
      '1.5 s',
      'inconnu',
      'inconnu',
    ]);
    expect(c.querySelector('[data-testid="genome-sans-modele"]')).toBeNull();
    expect(c.querySelector('[data-testid="genome-tronque"]')).toBeNull();
    expect(c.textContent).toContain('Lu sur 12 événement(s)');
  });

  it('dit ce que le CLI déclare — « ≥ » quand une tentative s’est tue — et les modèles exacts', () => {
    const c = monter({
      lignes: [
        {
          modele: 'sonnet',
          categorie: 'code',
          ...faits({
            affectations: 3,
            rendus: 1,
            dureeModele: { total: 4_000, declarees: 3, tentatives: 3 },
            coutFournisseur: { total: 0.07, declarees: 2, tentatives: 3 },
            modelesExacts: ['claude-sonnet-4-5-20250929'],
          }),
        },
      ],
      sansModele: faits(),
      fenetre: { evenements: 9, depuis: 1, tronquee: false },
    });
    const cellules = [...c.querySelectorAll('[data-testid="genome-ligne"] td')];

    expect(cellules[0]?.textContent).toBe('sonnetclaude-sonnet-4-5-20250929');
    expect(cellules[0]?.querySelector('.genome-exacts')?.textContent).toBe(
      'claude-sonnet-4-5-20250929',
    );
    expect(cellules[8]?.textContent).toBe('4.0 s');
    expect(cellules[9]?.textContent).toMatch(/^≥ 0,07\s\$US$/);
    expect(cellules[9]?.getAttribute('title')).toBe(
      '2/3 tentative(s) déclarée(s) par le CLI de l’agent',
    );
  });

  it('signale l’absence de modèle et la fenêtre pleine, sans inventer de ligne', () => {
    const c = monter({
      lignes: [],
      sansModele: faits({ affectations: 4, rendus: 4 }),
      fenetre: { evenements: 5_000, depuis: 1, tronquee: true },
    });

    expect(c.querySelector('[data-testid="genome-vide"]')).not.toBeNull();
    expect(c.querySelectorAll('[data-testid="genome-ligne"]')).toHaveLength(0);
    expect(c.querySelector('[data-testid="genome-sans-modele"]')?.textContent).toContain(
      '4 affectation(s) sans modèle déclaré',
    );
    expect(c.querySelector('[data-testid="genome-tronque"]')).not.toBeNull();
  });

  it('dit l’erreur de lecture au lieu d’un registre vide', () => {
    const c = monter(null, 'HTTP 500');

    expect(c.querySelector('.panel-error')?.textContent).toBe('HTTP 500');
    expect(c.querySelector('[data-testid="genome-vide"]')).toBeNull();
  });
});
