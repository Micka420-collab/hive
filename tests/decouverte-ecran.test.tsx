// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCRAN « SUR VOTRE RÉSEAU LOCAL » — ce que l'administrateur voit, et le geste.
//
// ─── CE QUE CE BANC PROTÈGE ──────────────────────────────────────────────────
//
// La route est éprouvée de bout en bout ailleurs (`decouverte-rejoindre.test
// .ts`). Ici, l'écran : qu'il dise comment ALLUMER la découverte quand elle est
// éteinte (le défaut — une liste vide et muette se lirait « personne sur le
// réseau »), qu'il n'offre « Rejoindre » qu'aux machines LIBRES, que le geste
// exige le code et l'envoie tel que saisi, et qu'un refus se lise sur place
// sans perdre la saisie.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchDecouverte: vi.fn(),
  rejoindreDecouvert: vi.fn(),
}));

import { ApiError, fetchDecouverte, rejoindreDecouvert } from '../dashboard/src/api';
import type { DecouverteReseau } from '../dashboard/src/api';
import { DecouvertsReseau } from '../dashboard/src/DecouvertsReseau';
import { setLang } from '../dashboard/src/i18n';

const CAMILLE = {
  id: 'hive-0a1b2c3d',
  nom: 'Le portable de Camille',
  os: 'linux' as const,
  agents: ['claude-code' as const, 'codex' as const],
  places: 2,
  etat: 'libre' as const,
  ruche: null,
  adresse: '192.168.1.23',
  port: 41234,
  vuA: 0,
};

const ACTIVE: DecouverteReseau = {
  active: true,
  empreinte: 'abcd-efgh-jkmn',
  decouverts: [
    CAMILLE,
    {
      ...CAMILLE,
      id: 'hive-11111111',
      nom: 'Poste du salon',
      etat: 'membre',
      ruche: 'cette_ruche',
      port: 0,
    },
    {
      ...CAMILLE,
      id: 'hive-22222222',
      nom: 'Chez la voisine',
      etat: 'membre',
      ruche: 'autre_ruche',
      port: 0,
    },
  ],
};

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;

beforeEach(() => setLang('fr'));

afterEach(() => {
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(reponse: DecouverteReseau): Promise<HTMLElement> {
  vi.mocked(fetchDecouverte).mockResolvedValue(reponse);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<DecouvertsReseau />));
  await act(async () => {});
  return conteneur;
}

const boutons = (dom: HTMLElement, texte: string) =>
  [...dom.querySelectorAll('button')].filter((b) => (b.textContent ?? '').includes(texte));

async function cliquer(el: Element | undefined): Promise<void> {
  if (!el) throw new Error('élément absent');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

async function saisir(input: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, valeur);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function soumettre(dom: HTMLElement): Promise<void> {
  const form = dom.querySelector('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe('la section « Sur votre réseau local »', () => {
  it('ÉTEINTE : elle dit comment l’allumer, et n’offre rien à cliquer', async () => {
    const dom = await monter({
      active: false,
      empreinte: 'abcd-efgh-jkmn',
      decouverts: [],
      conseil: 'Pour lister les machines… HIVE_DECOUVERTE=1 … hive join --decouvrable',
    });
    expect(dom.textContent).toContain('HIVE_DECOUVERTE=1');
    expect(boutons(dom, 'Rejoindre')).toHaveLength(0);
  });

  it('ALLUMÉE mais vide : elle dit quoi lancer sur la machine à ajouter', async () => {
    const dom = await monter({ active: true, empreinte: 'abcd-efgh-jkmn', decouverts: [] });
    expect(dom.textContent).toContain('hive join --decouvrable');
  });

  it('ALLUMÉE mais injoignable : l’avertissement est là AVANT le clic', async () => {
    const dom = await monter({ ...ACTIVE, injoignable: 'Relancez-la avec HIVE_HOST=0.0.0.0' });
    expect(dom.querySelector('.modal-error')?.textContent).toContain('HIVE_HOST=0.0.0.0');
  });

  it('« Rejoindre » pour la seule machine LIBRE ; les membres sont nommés, pas proposés', async () => {
    const dom = await monter(ACTIVE);
    expect(boutons(dom, 'Rejoindre'), 'un bouton, pour Camille seule').toHaveLength(1);
    const ligne = dom.querySelector('.decouverte-machine')!.textContent!;
    expect(ligne).toContain('Le portable de Camille');
    expect(ligne).toContain('Claude Code, Codex');
    expect(ligne).toContain('2 places');
    expect(ligne).toContain('192.168.1.23');
    expect(dom.textContent).toContain('Déjà dans cette ruche : Poste du salon.');
    expect(dom.textContent).toContain('Membres d’une autre ruche : 1.');
    // L'empreinte, pour que l'humain compare avec ce que la machine affiche.
    expect(dom.textContent).toContain('abcd-efgh-jkmn');
  });

  it('LE GESTE : le code est exigé, envoyé tel que saisi, et l’accueil est dit', async () => {
    vi.mocked(rejoindreDecouvert).mockResolvedValue({
      ok: true,
      billetId: 'bil-1',
      nom: CAMILLE.nom,
      detail: '« Le portable de Camille » a accepté l’offre.',
    });
    const dom = await monter(ACTIVE);
    await cliquer(boutons(dom, 'Rejoindre')[0]);
    const input = dom.querySelector('input')!;
    const accueillir = boutons(dom, 'Accueillir')[0]!;
    expect(accueillir.hasAttribute('disabled'), 'pas d’envoi sans code').toBe(true);

    // Accueillie, la machine se dit membre de CETTE ruche à la relecture suivante.
    vi.mocked(fetchDecouverte).mockResolvedValue({
      ...ACTIVE,
      decouverts: [{ ...CAMILLE, etat: 'membre', ruche: 'cette_ruche', port: 0 }],
    });
    await saisir(input, 'k7q2-9xmp');
    await soumettre(dom);
    await act(async () => {});
    expect(rejoindreDecouvert).toHaveBeenCalledWith('hive-0a1b2c3d', 'k7q2-9xmp');
    expect(dom.querySelector('[role="status"]')?.textContent).toContain('a accepté l’offre');
    expect(dom.querySelector('form'), 'le formulaire se referme sur un accueil').toBeNull();
    expect(dom.textContent).toContain('Déjà dans cette ruche : Le portable de Camille.');
    // La liste vidée par l'accueil ne se lit pas « aucune machine en attente ».
    expect(dom.textContent).not.toContain('Aucune machine en attente');
  });

  it('UN REFUS se lit sur place — et la saisie reste, pour corriger le code', async () => {
    vi.mocked(rejoindreDecouvert).mockRejectedValue(
      new ApiError('code refusé par la machine — Relisez le code affiché sur la machine.', 422),
    );
    const dom = await monter(ACTIVE);
    await cliquer(boutons(dom, 'Rejoindre')[0]);
    await saisir(dom.querySelector('input')!, 'AAAA-AAAA');
    await soumettre(dom);
    expect(dom.querySelector('[role="status"]')?.textContent).toContain('code refusé');
    expect(dom.querySelector('input')?.value, 'la saisie n’est pas perdue').toBe('AAAA-AAAA');
  });
});
