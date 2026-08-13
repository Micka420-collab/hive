// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// AU CLAVIER, UNE MODALE N'A PAS DE DEHORS.
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Les surfaces modales annonçaient `aria-modal="true"`, ce qui ne dit qu'aux
// lecteurs d'écran d'ignorer le reste de la page : la TABULATION, elle,
// continuait de sortir. Deux ou trois « Tab » depuis « Inviter un ami » et le
// focus se posait derrière le voile, sur des boutons recouverts que rien ne
// montrait — la seule sortie était de tabuler à l'aveugle jusqu'au bout du
// document. À la souris, cliquer dehors ferme ; au clavier, le dehors ne doit
// donc pas être atteignable du tout.
//
// Deux modales n'appelaient même pas `useDialog` : l'invitation (qui ne gérait
// qu'Échap, à la main) et la fiche d'une ouvrière. Elles ouvraient sans
// déplacer le focus — la première tabulation repartait du bouton déclencheur,
// c'est-à-dire de la page — et ne le rendaient pas en se fermant.
//
// Ce fichier mesure les trois gestes qui font qu'une modale se tient au
// clavier : le focus ENTRE, il TOURNE, il REVIENT.

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
  fetchWaggle: vi.fn(() => Promise.resolve({ nodes: [] })),
}));

import { InvitePanel } from '../dashboard/src/InvitePanel';
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let hote: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  hote?.remove();
  racine = null;
  hote = null;
});

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  hote = document.createElement('header');
  hote.className = 'topbar';
  document.body.appendChild(hote);
  racine = createRoot(hote);
  await act(async () => racine?.render(ui));
  return hote;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function tab(shift = false): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift }));
  });
}

function boutonParTexte(racineDom: HTMLElement, texte: string): HTMLElement {
  const b = [...racineDom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(texte),
  );
  if (!b) throw new Error(`aucun bouton « ${texte} » dans :\n${racineDom.innerHTML}`);
  return b;
}

/** Les focusables de la modale ouverte, dans l'ordre où le clavier les visite. */
function focusablesDeLaModale(): HTMLElement[] {
  const modale = document.querySelector('[role="dialog"]');
  if (!modale) throw new Error('aucune modale ouverte');
  return [
    ...modale.querySelectorAll<HTMLElement>(
      'a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
        'button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

const OUVRIERE: HiveNode = {
  id: 'n1',
  name: 'devin-box',
  ownerName: 'Micka',
  agentType: 'claude-code',
  status: 'online',
  running: 0,
  maxConcurrency: 2,
  lastSeen: Date.now(),
  plateforme: 'linux',
} as HiveNode;

describe('le focus entre dans la modale, y tourne, puis revient', () => {
  it('INVITATION : le focus ENTRE — il ne reste pas sur le bouton de la barre', async () => {
    const barre = await monter(<InvitePanel />);
    const declencheur = boutonParTexte(barre, 'Inviter un ami');
    declencheur.focus();
    cliquer(declencheur);
    await act(async () => {});

    const modale = document.querySelector('[role="dialog"]');
    expect(modale?.contains(document.activeElement), 'le focus est passé dans la modale').toBe(
      true,
    );
  });

  it('INVITATION : « Tab » depuis le DERNIER focusable revient au premier', async () => {
    const barre = await monter(<InvitePanel />);
    cliquer(boutonParTexte(barre, 'Inviter un ami'));
    await act(async () => {});

    const cibles = focusablesDeLaModale();
    expect(cibles.length, 'la modale a de quoi tabuler').toBeGreaterThan(1);
    cibles[cibles.length - 1]!.focus();

    tab();
    expect(document.activeElement, 'la tabulation boucle au lieu de sortir').toBe(cibles[0]);
  });

  it('INVITATION : « Maj+Tab » depuis le PREMIER va au dernier, pas dans la page', async () => {
    const barre = await monter(<InvitePanel />);
    cliquer(boutonParTexte(barre, 'Inviter un ami'));
    await act(async () => {});

    const cibles = focusablesDeLaModale();
    cibles[0]!.focus();

    tab(true);
    expect(document.activeElement).toBe(cibles[cibles.length - 1]);
  });

  it('INVITATION : un focus ÉGARÉ hors de la modale est rattrapé au « Tab » suivant', async () => {
    const barre = await monter(<InvitePanel />);
    const declencheur = boutonParTexte(barre, 'Inviter un ami');
    cliquer(declencheur);
    await act(async () => {});

    // Le focus a fui derrière le voile (clic sur un élément recouvert, ou
    // un composant qui appelle focus() de son côté).
    declencheur.focus();
    tab();
    expect(
      document.querySelector('[role="dialog"]')?.contains(document.activeElement),
      'le « Tab » ramène dans la modale',
    ).toBe(true);
  });

  it('INVITATION : Échap ferme, et le focus REVIENT au bouton qui a ouvert', async () => {
    const barre = await monter(<InvitePanel />);
    const declencheur = boutonParTexte(barre, 'Inviter un ami');
    declencheur.focus();
    cliquer(declencheur);
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('[role="dialog"]'), 'Échap ferme').toBeNull();
    expect(document.activeElement, 'le focus est rendu au déclencheur').toBe(declencheur);
  });

  it('FICHE D’UNE OUVRIÈRE : elle aussi prend le focus et retient la tabulation', async () => {
    const hoteDom = await monter(
      <NodesPanel nodes={[OUVRIERE]} tasks={[]} onOpenTask={() => {}} />,
    );
    cliquer(hoteDom.querySelector('.node-card') as Element);
    await act(async () => {});

    const modale = document.querySelector('[role="dialog"]');
    expect(modale, 'la fiche est ouverte').toBeTruthy();
    expect(modale?.contains(document.activeElement), 'le focus entre dans la fiche').toBe(true);

    const cibles = focusablesDeLaModale();
    cibles[cibles.length - 1]!.focus();
    tab();
    expect(document.activeElement, 'la fiche retient la tabulation').toBe(cibles[0]);
  });
});
