// @vitest-environment happy-dom
//
// SUPPRIMER UN PROJET, VU DE L'ÉCRAN.
//
// La Reine refuse la suppression d'un projet dont des tâches tournent (409, la
// liste à l'appui) et accepte `force=true`, qui les annule d'abord. Ce banc
// tient ce que l'écran doit en faire :
//
//   · le premier geste ne force RIEN — c'est à l'humain de voir ce qui tourne ;
//   · le refus NOMME les tâches, puis le même geste — réarmé, nom retapé —
//     part avec `force=true` ;
//   · un refus qu'on ne lève pas en forçant (un abonnement actif, un merge en
//     vol) se dit avec sa marche à suivre, et ne propose PAS de forcer ;
//   · une suppression réussie remonte à la page, qui la dit.
//
// Le geste lui-même (deux temps, nom à retaper) est éprouvé dans
// geste-irreversible.test.tsx ; ici, c'est le dialogue avec la Reine.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SuppressionProjet } from '../src/views/Projets';
import { setLang } from '../src/i18n';
import type { AuthUser, ProjetSupprime } from '../src/api';
import type { Project } from '../../src/shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Le réseau : une réponse par appel, et la trace de chaque appel ─────────

let reponses: { statut: number; corps: unknown }[] = [];
let appels: string[] = [];

beforeEach(() => {
  reponses = [];
  appels = [];
  globalThis.fetch = ((entree: unknown, init?: RequestInit) => {
    appels.push(`${init?.method ?? 'GET'} ${String(entree)}`);
    const rep = reponses.shift() ?? { statut: 500, corps: { error: 'appel imprévu' } };
    return Promise.resolve({
      ok: rep.statut >= 200 && rep.statut < 300,
      status: rep.statut,
      json: async () => rep.corps,
    } as Response);
  }) as typeof fetch;
});

// ─── Montage ────────────────────────────────────────────────────────────────

let conteneur: HTMLElement | undefined;
let racine: Root | undefined;

async function monter(element: React.ReactElement): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const neuve = createRoot(conteneur);
  racine = neuve;
  await act(async () => {
    neuve.render(element);
  });
}

afterEach(async () => {
  const r = racine;
  racine = undefined;
  if (r) {
    await act(async () => {
      r.unmount();
    });
  }
  conteneur?.remove();
  conteneur = undefined;
});

const vue = (): HTMLElement => {
  expect(conteneur, 'rien de monté').toBeDefined();
  return conteneur!;
};
const boutons = (): HTMLButtonElement[] => [...vue().querySelectorAll('button')];
const texte = (): string => (vue().textContent ?? '').replace(/\s+/g, ' ');

async function cliquer(libelle: string): Promise<void> {
  const cible = boutons().find((b) => b.textContent?.trim() === libelle);
  expect(
    cible,
    `bouton « ${libelle} » introuvable — présents : ${boutons()
      .map((b) => b.textContent?.trim())
      .join(' | ')}`,
  ).toBeTruthy();
  await act(async () => {
    (cible as HTMLButtonElement).click();
    // La réponse du réseau, puis le rendu qui la suit.
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function retaper(nom: string): Promise<void> {
  const champ = vue().querySelector('input') as HTMLInputElement | null;
  expect(champ, 'la confirmation doit demander le nom').toBeTruthy();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(champ) as object,
      'value',
    )?.set;
    setter?.call(champ, nom);
    champ!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ─── Les données ────────────────────────────────────────────────────────────

const LEA: AuthUser = { id: 'u-lea', email: 'lea@ruche.test', displayName: 'Léa' };
const projet = (ownerId: string | null): Project => ({
  id: 'p-site',
  name: 'Site vitrine',
  repoUrl: null,
  description: null,
  visibility: 'private',
  ownerId,
  createdAt: 0,
});
const FAIT: ProjetSupprime = {
  supprime: true,
  projectId: 'p-site',
  name: 'Site vitrine',
  annulees: 1,
  effaces: { projects: 1, tasks: 3 },
  lignes: 12,
  miroir: 'absent',
};

beforeAll(() => {
  setLang('fr');
});

describe('le dialogue avec la Reine', () => {
  it('LE REFUS NOMME LES TÂCHES, PUIS LE MÊME GESTE LES ANNULE — jamais au premier coup', async () => {
    const faits: ProjetSupprime[] = [];
    await monter(
      <SuppressionProjet project={projet(LEA.id)} user={LEA} onSupprime={(f) => faits.push(f)} />,
    );
    reponses.push(
      {
        statut: 409,
        corps: {
          code: 'taches_en_vol',
          error: '1 tâche(s) tournent encore sur ce projet',
          taches: [{ id: 't-1', title: 'Écrire la page d’accueil', status: 'running' }],
        },
      },
      { statut: 200, corps: FAIT },
    );

    await cliquer('Supprimer…');
    await retaper('Site vitrine');
    await cliquer('Supprimer');

    expect(appels, 'le premier geste a forcé').toEqual(['DELETE /api/projects/p-site']);
    expect(faits, 'un refus a été pris pour une suppression').toEqual([]);
    expect(texte()).toContain('Écrire la page d’accueil');
    expect(texte()).toContain('la suppression les annulera d’abord');

    await cliquer('Annuler et supprimer…');
    await retaper('Site vitrine');
    await cliquer('Annuler et supprimer');

    expect(appels[1]).toBe('DELETE /api/projects/p-site?force=true');
    expect(faits).toEqual([FAIT]);
  });

  it('UN REFUS QU’ON NE LÈVE PAS EN FORÇANT se dit — et ne propose pas de forcer', async () => {
    await monter(
      <SuppressionProjet project={projet(null)} user={null} onSupprime={() => undefined} />,
    );
    reponses.push({
      statut: 409,
      corps: {
        code: 'hebergement_actif',
        error: 'ce projet a un abonnement ou une machine encore en service',
        conseil: 'Résiliez l’abonnement et faites supprimer ses machines.',
      },
    });

    await cliquer('Supprimer…');
    await retaper('Site vitrine');
    await cliquer('Supprimer');

    expect(texte()).toContain('abonnement ou une machine encore en service');
    expect(texte(), 'la marche à suivre a été perdue').toContain('Résiliez l’abonnement');
    expect(
      boutons().map((b) => b.textContent?.trim()),
      'forcer serait promettre ce que la Reine refusera',
    ).not.toContain('Annuler et supprimer…');
  });

  it('ce que la Reine refusera n’est pas proposé : ni au membre, ni au passant', async () => {
    // Cosmétique — la garde est à la Reine — mais un bouton qui rend 403 à
    // chaque clic apprend à ignorer les boutons.
    const autre: Project = projet('u-proprio');
    await monter(<SuppressionProjet project={autre} user={LEA} onSupprime={() => undefined} />);
    expect(texte()).not.toContain('Supprimer le projet');
    await act(async () => racine?.unmount());
    racine = undefined;
    conteneur?.remove();
    // Le jeton de ruche, lui, répond d'un orphelin (ADR 0007) : sans compte, le
    // geste y est proposé.
    await monter(
      <SuppressionProjet project={projet(null)} user={null} onSupprime={() => undefined} />,
    );
    expect(texte()).toContain('Supprimer le projet');
  });
});
