// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES FAUTES DE SAISIE SOUS LEUR CHAMP — la modale « Nouveau projet », le
// compte, l'invitation.
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Ces trois formulaires disaient leurs fautes dans un bandeau en tête de la
// modale, relié à AUCUN champ : un nom manquant, un JSON cassé, une adresse de
// ruche en `http://` s'affichaient loin du champ fautif, et le lecteur d'écran
// n'annonçait rien sur le champ lui-même. Le compte, lui, éteignait « Créer le
// compte » sans jamais dire pourquoi.
//
// ─── CE QU'ON MESURE ─────────────────────────────────────────────────────────
//
// Le CONTRAT du champ fautif, lu comme le lit une technologie d'assistance :
// `aria-invalid="true"`, et une `aria-describedby` qui mène au texte de la
// faute. Et le geste qui NE part PAS : une saisie fausse n'atteint pas l'API.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createProject: vi.fn(() => Promise.resolve({ id: 'p-1' })),
  addTasks: vi.fn(() => Promise.resolve([])),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  fetchInvite: vi.fn(() =>
    Promise.resolve({
      invite: 'hive2_abc',
      url: 'ws://192.168.1.20:7777/ws',
      label: 'x',
      joinCommand: 'npm run join -- hive2_abc',
      note: '',
    }),
  ),
  authMe: vi.fn(() => Promise.resolve(null)),
  authRegister: vi.fn(() => Promise.resolve({ token: 't', user: null })),
}));

import { addTasks, authRegister, createProject, fetchInvite } from '../dashboard/src/api';
import { AccountPanel } from '../dashboard/src/AccountPanel';
import { setLang } from '../dashboard/src/i18n';
import { InvitePanel } from '../dashboard/src/InvitePanel';
import { NewProjectModal } from '../dashboard/src/NewProjectModal';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(el: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(el));
  await act(async () => {});
  // Les modales se montent par PORTAIL, hors du conteneur.
  return document.body;
}

/** Le contrôle dont le `<label for>` contient ce texte. */
function champ<T extends HTMLElement = HTMLInputElement>(dom: HTMLElement, libelle: string): T {
  const l = [...dom.querySelectorAll('label')].find((e) => (e.textContent ?? '').includes(libelle));
  const c = l ? dom.querySelector<T>(`#${CSS.escape(l.htmlFor)}`) : null;
  if (!c) throw new Error(`champ « ${libelle} » introuvable`);
  return c;
}

/** Ce que le lecteur d'écran lit APRÈS le libellé : aide et faute reliées. */
const description = (c: HTMLElement): string =>
  (c.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

function bouton(dom: HTMLElement, texte: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((e) => (e.textContent ?? '').includes(texte));
  if (!b) throw new Error(`bouton « ${texte} » introuvable`);
  return b;
}

async function cliquer(b: HTMLElement): Promise<void> {
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Écrit dans un champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`. */
async function ecrire(c: HTMLInputElement | HTMLTextAreaElement, texte: string): Promise<void> {
  const proto =
    c instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const poser = Object.getOwnPropertyDescriptor(proto, 'value')?.set as (v: string) => void;
  await act(async () => {
    poser.call(c, texte);
    c.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function quitter(c: HTMLElement): Promise<void> {
  await act(async () => {
    c.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('Nouveau projet : chaque faute sous SON champ', () => {
  it('un nom manquant se dit sous le nom, et rien ne part', async () => {
    const dom = await monter(<NewProjectModal onClose={() => {}} />);
    const nom = champ(dom, 'Nom du projet');
    expect(
      nom.getAttribute('aria-invalid'),
      'le champ se dit en faute avant tout geste',
    ).toBeNull();

    await cliquer(bouton(dom, 'Lancer le butinage'));

    expect(nom.getAttribute('aria-invalid')).toBe('true');
    expect(description(nom)).toContain('Le nom du projet est requis.');
    expect(createProject, 'un projet sans nom est parti').not.toHaveBeenCalled();

    // Corriger efface la faute — sans attendre un nouvel envoi.
    await ecrire(nom, 'Rucher');
    expect(nom.getAttribute('aria-invalid')).toBeNull();
  });

  it('un JSON cassé se dit sous le champ des tâches, pas sous le nom', async () => {
    const dom = await monter(<NewProjectModal onClose={() => {}} />);
    await ecrire(champ(dom, 'Nom du projet'), 'Rucher');
    const taches = champ<HTMLTextAreaElement>(dom, 'Tâches (JSON)');
    await ecrire(taches, '[{ "title": ');

    await cliquer(bouton(dom, 'Lancer le butinage'));

    expect(taches.getAttribute('aria-invalid')).toBe('true');
    expect(description(taches)).toContain('Tâches invalides');
    expect(champ(dom, 'Nom du projet').getAttribute('aria-invalid')).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
  });
});

describe('Nouveau projet : un seul geste lance de vrais agents', () => {
  it('Entrée dans le nom (envoi implicite du formulaire) ne crée rien, ne dispatche rien', async () => {
    const dom = await monter(<NewProjectModal onClose={() => {}} />);
    const nom = champ(dom, 'Nom du projet');
    await ecrire(nom, 'Mon projet');
    // `requestSubmit()` est ce que fait l'envoi implicite d'Entrée dans un champ.
    await act(async () => nom.form?.requestSubmit());
    await act(async () => {});
    expect(createProject, 'Entrée a créé un projet jamais relu').not.toHaveBeenCalled();
    expect(addTasks, 'Entrée a lancé le modèle pré-rempli').not.toHaveBeenCalled();

    await cliquer(bouton(dom, 'Lancer le butinage'));
    expect(createProject).toHaveBeenCalledWith({ name: 'Mon projet' });
  });
});

describe('Compte : pourquoi « Créer le compte » reste éteint', () => {
  it('un mot de passe trop court le dit sous le champ, une fois quitté', async () => {
    const dom = await monter(<AccountPanel user={null} onUser={() => {}} />);
    await cliquer(bouton(dom, 'Se connecter'));
    await cliquer(bouton(dom, 'Inscription'));

    await ecrire(champ(dom, 'Nom affiché'), 'Camille');
    await ecrire(champ(dom, 'Email'), 'camille@exemple.fr');
    const mdp = champ(dom, 'Mot de passe');
    await ecrire(mdp, 'court');
    // Pas de faute criée à la frappe : seulement une fois le champ quitté.
    expect(mdp.getAttribute('aria-invalid')).toBeNull();
    await quitter(mdp);

    expect(mdp.getAttribute('aria-invalid')).toBe('true');
    expect(description(mdp)).toMatch(/minimum/);
    expect(bouton(dom, 'Créer le compte').disabled).toBe(true);
    expect(authRegister).not.toHaveBeenCalled();
  });
});

describe('Invitation : une adresse de ruche est une URL WebSocket', () => {
  it('une adresse http:// est refusée sous le champ, sans aller-retour', async () => {
    const dom = await monter(<InvitePanel />);
    await cliquer(bouton(dom, 'nviter'));
    vi.mocked(fetchInvite).mockClear();

    const url = champ(dom, 'Adresse WebSocket de la ruche');
    await ecrire(url, 'http://192.168.1.20:7777');
    await cliquer(bouton(dom, 'Régénérer'));

    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(description(url)).toContain('ws://');
    expect(fetchInvite, 'une adresse fausse est partie vers la ruche').not.toHaveBeenCalled();

    await ecrire(url, 'wss://ruche.exemple:7777/ws');
    await cliquer(bouton(dom, 'Régénérer'));
    expect(fetchInvite).toHaveBeenCalledWith('wss://ruche.exemple:7777/ws');

    // La règle est celle de la Reine (`isWsUrl`) : un schéma en capitales,
    // qu'elle accepte, n'est pas refusé par le tableau de bord.
    await ecrire(url, 'WSS://ruche.exemple:7777/ws');
    await cliquer(bouton(dom, 'Régénérer'));
    expect(url.getAttribute('aria-invalid')).toBeNull();
    expect(fetchInvite).toHaveBeenLastCalledWith('WSS://ruche.exemple:7777/ws');
  });
});
