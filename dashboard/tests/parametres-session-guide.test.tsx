// @vitest-environment happy-dom
//
// DEUX FAITS QUE L'ÉCRAN PARAMÈTRES AFFICHE OU REMET, TENUS À LEUR SOURCE.
//
//   · Les échéances de session lues dans le JWT : une date lue ou « inconnue »,
//     jamais une date inventée à partir d'un jeton illisible.
//   · Le guide « Chemin vers le premier cycle » : « Masquer » TIENT d'une visite
//     à l'autre (il ne vivait que dans l'état du composant), et
//     `reafficherGuides` le rend — sinon l'entrée des Paramètres ne ferait rien.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lireEcheancesSession } from '../src/echeances-session';
import { OnboardingEssaim, reafficherGuides } from '../src/OnboardingEssaim';
import { setLang } from '../src/i18n';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (charge: unknown) => `${b64({ alg: 'HS256' })}.${b64(charge)}.sig`;

describe('les échéances de session lues dans le JWT', () => {
  it('LIT `iat` ET `exp` (secondes) — en millisecondes', () => {
    expect(lireEcheancesSession(jwt({ sub: 'u', iat: 1_000, exp: 1_000 + 604_800 }))).toEqual({
      ouverteA: 1_000_000,
      expireA: 605_800_000,
    });
  });

  it('UN JETON ILLISIBLE N’A PAS D’ÉCHÉANCE — il n’en reçoit pas une plausible', () => {
    for (const brut of [
      null,
      '',
      'pas-un-jwt',
      'a.b',
      'a.!!!.c',
      `${b64({})}.${Buffer.from('pas du json').toString('base64url')}.s`,
      jwt(null),
      jwt({ iat: 10 }),
      jwt({ iat: '10', exp: 20 }),
      jwt({ iat: 20, exp: 10 }),
    ]) {
      expect(lireEcheancesSession(brut), String(brut)).toBeNull();
    }
  });
});

// ─── Le guide du premier cycle ──────────────────────────────────────────────

const ESSAIM = {
  niveau: 'off',
  niveaux: ['off', 'propose', 'gouverne', 'plein'],
  pret: {
    runner: false,
    gouvernantes: false,
    noeudsEnLigne: true,
    agentsReels: false,
    depot: false,
    derive: true,
    plafond: true,
    repo: false,
  },
};

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  globalThis.fetch = ((url: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(String(url).includes('/cycles') ? { cycles: [] } : ESSAIM),
      text: () => Promise.resolve(''),
      headers: new Headers(),
    })) as typeof fetch;
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
});

async function monterGuide(): Promise<HTMLElement> {
  act(() => racine?.unmount());
  conteneur?.remove();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<OnboardingEssaim projectId="p1" />));
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

describe('le guide du premier cycle — masqué, il le reste ; réaffiché, il revient', () => {
  it('« MASQUER » TIENT AU RETOUR SUR LE PROJET, ET `reafficherGuides` LE REND', async () => {
    let dom = await monterGuide();
    const masquer = [...dom.querySelectorAll('button')].find((b) => b.textContent === 'Masquer');
    expect(masquer, 'le guide s’affiche sur un projet incomplet').toBeTruthy();
    await act(async () => masquer!.click());
    expect(dom.querySelector('.onboarding-essaim')).toBeNull();

    // Retour sur Projets : le composant est remonté.
    dom = await monterGuide();
    expect(dom.querySelector('.onboarding-essaim'), 'le guide masqué est revenu seul').toBeNull();

    reafficherGuides();
    dom = await monterGuide();
    expect(dom.querySelector('.onboarding-essaim'), 'réaffiché, il revient').toBeTruthy();
  });
});
