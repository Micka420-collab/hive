// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA MODALE N'EST LA DESCENDANTE DE RIEN.
//
// ─── LA PANNE QUE CE FICHIER INTERDIT DE FAIRE REVENIR ───────────────────────
//
// « Inviter un ami » ouvrait une popup hors de l'écran. La cause n'était pas
// dans le panneau : `.topbar` porte un `backdrop-filter`, et un filtre fait de
// l'élément le BLOC CONTENEUR de ses descendants en `position: fixed`. Le
// voile `inset: 0` ne couvrait donc plus la fenêtre mais la BARRE — mesuré
// dans Chrome : voile 1057×78 px, modale à y = −129 px. La commande à copier
// était inatteignable, donc inviter quelqu'un était impossible.
//
// C'est une panne de PARENTÉ, pas de style : aucune règle CSS écrite dans la
// modale ne pouvait la corriger, et un test qui vérifierait des propriétés CSS
// ne la verrait pas non plus (happy-dom ne fait pas de mise en page). Ce qui se
// vérifie, et ce qui suffit, c'est OÙ la surface est montée.
//
// La garde vaut pour toutes les surfaces modales : la barre du haut n'est
// qu'un ancêtre parmi d'autres — un `transform`, un `filter` ou un `contain`
// posé demain sur n'importe quel parent produirait exactement le même effet.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInvite: vi.fn(() =>
    Promise.resolve({
      invite: 'hive1_xxx',
      url: 'ws://192.168.1.10:7777/ws',
      label: 'Ruche',
      joinCommand: 'npm run join -- hive1_xxx',
      note: '',
    }),
  ),
}));

import { InvitePanel } from '../dashboard/src/InvitePanel';
import { AccountPanel } from '../dashboard/src/AccountPanel';
import { OpenAlexPanel } from '../dashboard/src/OpenAlexPanel';
import { setLang } from '../dashboard/src/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let barre: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  barre?.remove();
  racine = null;
  barre = null;
});

/** Monte le panneau LÀ OÙ IL VIT VRAIMENT : dans la barre du haut. */
async function monterDansLaBarre(ui: React.ReactElement): Promise<HTMLElement> {
  barre = document.createElement('header');
  barre.className = 'topbar';
  document.body.appendChild(barre);
  racine = createRoot(barre);
  await act(async () => racine?.render(ui));
  return barre;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function boutonParTexte(racineDom: HTMLElement, texte: string): HTMLElement {
  const b = [...racineDom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(texte),
  );
  if (!b) throw new Error(`aucun bouton « ${texte} » dans :\n${racineDom.innerHTML}`);
  return b;
}

describe('les surfaces modales sortent de la barre du haut', () => {
  it('INVITATION : le voile est monté sur le corps, pas dans la barre', async () => {
    const barreDom = await monterDansLaBarre(<InvitePanel />);
    cliquer(boutonParTexte(barreDom, 'Inviter'));

    const voile = document.querySelector('.modal-backdrop');
    expect(voile, 'la modale s’ouvre').toBeTruthy();
    expect(voile?.parentElement, 'le voile est un enfant direct du corps').toBe(document.body);
    expect(
      barreDom.querySelector('.modal-backdrop'),
      'et rien n’en reste dans la barre',
    ).toBeNull();
  });

  it('INVITATION : la commande à copier existe, hors de la barre', async () => {
    const barreDom = await monterDansLaBarre(<InvitePanel />);
    cliquer(boutonParTexte(barreDom, 'Inviter'));
    await act(async () => {});

    const cmd = document.querySelector('.invite-cmd code')?.textContent ?? '';
    expect(cmd, 'la commande de l’ami est affichée').toContain('npm run join --');
  });

  it('COMPTE : même sortie, même garde', async () => {
    const barreDom = await monterDansLaBarre(<AccountPanel user={null} onUser={() => {}} />);
    cliquer(boutonParTexte(barreDom, 'Se connecter'));

    expect(document.querySelector('.modal-backdrop')?.parentElement).toBe(document.body);
    expect(
      barreDom.querySelector('[role="dialog"]'),
      'la barre ne contient aucun dialogue',
    ).toBeNull();
  });

  it('LE VOILE SE REFERME AU CLIC HORS DE LA MODALE — et le clic dedans ne ferme pas', async () => {
    const barreDom = await monterDansLaBarre(<InvitePanel />);
    cliquer(boutonParTexte(barreDom, 'Inviter'));

    cliquer(document.querySelector('.modal') as Element);
    expect(
      document.querySelector('.modal-backdrop'),
      'un clic DANS la modale la garde',
    ).toBeTruthy();

    cliquer(document.querySelector('.modal-backdrop') as Element);
    expect(document.querySelector('.modal-backdrop'), 'un clic sur le voile ferme').toBeNull();
  });

  // OpenAlex se fermait à la croix et au voile, mais restait sourd à Échap :
  // seul des cinq overlays, il obligeait à viser. Une seule modale qui répond
  // autrement suffit à faire douter de la touche partout.
  it('OPENALEX : Échap ferme, comme partout ailleurs', async () => {
    const fermer = vi.fn();
    await monterDansLaBarre(<OpenAlexPanel onClose={fermer} />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(fermer).toHaveBeenCalledTimes(1);
  });

  it('OPENALEX : le champ de recherche prend le focus, pas la croix', async () => {
    await monterDansLaBarre(<OpenAlexPanel onClose={() => {}} />);
    expect(document.activeElement).toBe(document.querySelector('.openalex-input'));
  });
});
