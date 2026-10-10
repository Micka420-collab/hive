// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU DES ROUTINES — ce qu'une personne lit avant de laisser la ruche
// travailler sans elle, et ce qu'elle lit ensuite.
//
//   · rien ne part au montage : la lecture se demande ;
//   · chaque déclenchement a une issue ÉCRITE, même quand rien n'est lancé
//     (rejoint, refusé avec son motif) ;
//   · le formulaire dit, avant le clic, que créer autorise la dépense, et
//     envoie exactement la définition choisie — les défauts du propriétaire
//     compris ;
//   · la clé d'un webhook s'affiche UNE fois, puis disparaît.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { RoutineVue } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRoutines: vi.fn(),
  creerRoutine: vi.fn(),
}));

import { creerRoutine, fetchRoutines } from '../dashboard/src/api';
import { RoutinesProjet } from '../dashboard/src/views/RoutinesProjet';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJET: Project = {
  id: 'p1',
  name: 'Site',
  repoUrl: null,
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

const ROUTINE: RoutineVue = {
  id: 'r1',
  nom: 'Dette nocturne',
  consigne: 'Réduire la dette.',
  declencheur: 'cron',
  expression: '0 9 * * 1-5',
  fuseau: 'Europe/Paris',
  branche: null,
  plage: null,
  concurrence: 'coalesce_if_active',
  rattrapage: 'skip_missed',
  actif: true,
  autorite: 'compte',
  auteur: 'Micka',
  prochaineA: Date.parse('2026-10-05T07:00:00Z'),
  derniereErreur: null,
  webhook: null,
  creeA: 1,
  runs: [
    {
      id: 'x2',
      source: 'cron',
      statut: 'fusionnee',
      motif: 'rejoint le travail encore en vol',
      taches: [],
      fusionneDans: 'x1',
      creeA: 3,
    },
    {
      id: 'x1',
      source: 'manuel',
      statut: 'refusee',
      motif: 'le compte ne répond plus du projet',
      taches: [],
      fusionneDans: null,
      creeA: 2,
    },
  ],
};

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  vi.mocked(fetchRoutines).mockReset();
  vi.mocked(creerRoutine).mockReset();
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
  await act(async () => {
    racine?.render(<RoutinesProjet project={PROJET} />);
  });
  return conteneur;
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Écrit dans un champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`. */
async function ecrire(champ: HTMLInputElement | HTMLTextAreaElement, texte: string) {
  const proto =
    champ instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(champ, texte);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('le panneau des Routines', () => {
  it('RIEN AU MONTAGE ; puis chaque déclenchement se lit en mots, motif compris', async () => {
    vi.mocked(fetchRoutines).mockResolvedValue({ routines: [ROUTINE], ciDisponible: false });
    const dom = await monter();
    expect(vi.mocked(fetchRoutines)).not.toHaveBeenCalled();
    await cliquer(bouton(dom, 'voir les routines'));
    const texte = dom.textContent ?? '';
    expect(texte).toContain('Dette nocturne');
    expect(texte).toContain('0 9 * * 1-5 · Europe/Paris');
    expect(texte).toContain('au nom de Micka');
    expect(texte).toContain('rejoint le travail en cours');
    expect(texte).toContain('refusée — le compte ne répond plus du projet');
  });

  it('CRÉER : l’avertissement avant le clic, la définition exacte, la clé UNE fois', async () => {
    vi.mocked(fetchRoutines).mockResolvedValue({ routines: [], ciDisponible: false });
    const cree: RoutineVue = {
      ...ROUTINE,
      id: 'r2',
      nom: 'Tri',
      declencheur: 'webhook',
      expression: null,
      webhook: '/api/projects/p1/routines/r2/webhook',
      runs: [],
    };
    vi.mocked(creerRoutine).mockResolvedValue({ routine: cree, secret: 'rtn_la-cle-secrete' });
    const dom = await monter();
    await cliquer(bouton(dom, 'voir les routines'));
    expect(dom.textContent).toContain('ne travaille que quand on le lui demande');
    await cliquer(bouton(dom, 'Nouvelle routine…'));
    expect(dom.textContent).toContain('autorise la dépense à l’avance');
    // Sans dépôt, « CI rouge » est proposé mais désactivé, et dit pourquoi.
    const ci = dom.querySelector<HTMLOptionElement>('option[value="ci_rouge"]');
    expect(ci?.disabled).toBe(true);
    expect(ci?.textContent).toContain('dépôt GitHub');

    const [nom] = [...dom.querySelectorAll<HTMLInputElement>('.pj-rejeu-form input')];
    await ecrire(nom!, 'Tri');
    await ecrire(dom.querySelector('textarea')!, 'Trier l’issue.');
    const declencheur = dom.querySelector<HTMLSelectElement>('.pj-rejeu-form select')!;
    await act(async () => {
      declencheur.value = 'webhook';
      declencheur.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const fuseau = [...dom.querySelectorAll<HTMLInputElement>('.pj-rejeu-form input')].find(
      (i) => i.value === Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    await ecrire(fuseau!, 'Europe/Paris');
    await cliquer(bouton(dom, 'Créer la routine'));
    expect(vi.mocked(creerRoutine)).toHaveBeenCalledWith('p1', {
      nom: 'Tri',
      consigne: 'Trier l’issue.',
      declencheur: 'webhook',
      fuseau: 'Europe/Paris',
      concurrence: 'coalesce_if_active',
    });
    expect(dom.textContent).toContain('rtn_la-cle-secrete');
    expect(dom.textContent).toContain('POST /api/projects/p1/routines/r2/webhook');
    await cliquer(bouton(dom, 'j’ai copié la clé'));
    expect(dom.textContent).not.toContain('rtn_la-cle-secrete');
  });
});
