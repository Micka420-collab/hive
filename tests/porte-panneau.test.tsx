// @vitest-environment happy-dom
//
// LE PANNEAU « INVITER » REMET UN LIEN — et montre l'invité arriver.
//
// Ce qu'on prouve : le lien de porte est la première chose remise (un champ,
// un bouton « Copier le lien »), la commande reste derrière un pli, le
// panneau ne réclame plus l'ancienne invitation au jeton maître, et l'état de
// l'invité se lit dans le journal — rien, lien ouvert, machine entrée — sans
// que l'hôte ait rien à demander.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInvite: vi.fn(),
  fetchDecouverte: vi.fn(() =>
    Promise.resolve({ active: false, empreinte: 'abcd-efgh-jkmn', decouverts: [] }),
  ),
}));

import { fetchInvite } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import { InvitePanel, arriveeDuBillet } from '../dashboard/src/InvitePanel';
import type { HiveEvent } from '../src/shared/types';

const LIEN = 'http://192.168.1.20:7777/r/bil-1#hive2_abc';
const REPONSE = {
  billet: 'hive2_abc',
  id: 'bil-1',
  lien: LIEN,
  url: 'ws://192.168.1.20:7777/ws',
  label: 'Ruche de Micka',
  joinCommand: 'npm run join -- hive2_abc',
  entree: { posix: 'curl … | sh -s -- hive2_abc', windows: 'irm … -Billet hive2_abc' },
  note: 'Billet à usage UNIQUE.',
  expiresAt: Date.now() + 86_400_000,
  uses: 1,
};

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
let copies: string[] = [];

beforeEach(() => {
  setLang('fr');
  copies = [];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (t: string) => {
        copies.push(t);
        return Promise.resolve();
      },
    },
    configurable: true,
  });
  vi.mocked(fetchInvite).mockResolvedValue(REPONSE as never);
});

afterEach(() => {
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function ouvrir(events: HiveEvent[] = []): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<InvitePanel events={events} />));
  await act(async () => {});
  const ouvreur = [...document.body.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').toLowerCase().includes('invit'),
  );
  if (!ouvreur) throw new Error('le bouton qui ouvre le panneau est introuvable');
  await act(async () => {
    ouvreur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  return document.body;
}

/** Remonte le panneau ouvert avec un autre journal, sans le refermer. */
async function rendre(events: HiveEvent[]): Promise<HTMLElement> {
  await act(async () => racine?.render(<InvitePanel events={events} />));
  await act(async () => {});
  return document.body;
}

const evenement = (type: string, payload: Record<string, unknown>, ts: number): HiveEvent => ({
  id: ts,
  ts,
  type,
  payload,
});

describe('le panneau remet UN lien', () => {
  it('demande un BILLET (jamais l’ancienne invitation) et montre son lien en premier', async () => {
    const dom = await ouvrir();
    expect(vi.mocked(fetchInvite)).toHaveBeenCalledTimes(1);
    const champ = dom.querySelector<HTMLInputElement>('.porte-lien-champ');
    expect(champ?.value).toBe(LIEN);
    expect(champ?.readOnly).toBe(true);
    // La commande est toujours là — repliée.
    const pli = dom.querySelector<HTMLDetailsElement>('details.invite-commande');
    expect(pli?.open).toBe(false);
    expect(dom.querySelector('.invite-cmd code')?.textContent).toBe(REPONSE.entree.posix);
    // Plus un mot sur « le token de la ruche » : le lien n'en porte pas.
    expect(dom.textContent).not.toMatch(/contient le token/);
    expect(dom.textContent).toMatch(/Une seule machine/);
  });

  it('« Copier le lien » copie LE LIEN, et le dit', async () => {
    const dom = await ouvrir();
    const b = dom.querySelector<HTMLButtonElement>('[data-testid="porte-copier"]')!;
    await act(async () => {
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(copies).toEqual([LIEN]);
    expect(b.textContent).toMatch(/Copié/);
  });

  it('une ruche ANTÉRIEURE, sans lien : la commande est ouverte, en premier', async () => {
    vi.mocked(fetchInvite).mockResolvedValue({
      invite: 'hive1_xxx',
      url: 'ws://x:7777/ws',
      label: 'Ruche',
      joinCommand: 'npm run join -- hive1_xxx',
      note: '',
    } as never);
    const dom = await ouvrir();
    expect(dom.querySelector('.porte-lien-champ')).toBeNull();
    expect(dom.querySelector<HTMLDetailsElement>('details.invite-commande')?.open).toBe(true);
    expect(dom.querySelector('.invite-cmd code')?.textContent).toBe('npm run join -- hive1_xxx');
    expect(dom.textContent).toMatch(/ancienne invitation/);
  });
});

describe('l’hôte voit l’invité arriver', () => {
  it('rien encore → lien ouvert → machine entrée, lus dans le journal de CE billet', async () => {
    const dom = await ouvrir([]);
    const statut = () => dom.querySelector('[data-testid="porte-arrivee"]')!;
    expect(statut().className).toBe('porte-arrivee');
    expect(statut().textContent).toMatch(/Dès que le lien est ouvert/);

    await rendre([
      evenement(
        'porte_ouverte',
        { ticketId: 'bil-1', ouvertures: 1 },
        Date.UTC(2026, 9, 30, 13, 2),
      ),
      // Un autre billet : ne compte pas ici.
      evenement(
        'porte_ouverte',
        { ticketId: 'bil-autre', ouvertures: 1 },
        Date.UTC(2026, 9, 30, 13, 3),
      ),
    ]);
    expect(statut().className).toBe('porte-arrivee ouvert');
    expect(statut().textContent).toMatch(
      /Lien ouvert à \d{2}:\d{2} — la machine n’est pas encore entrée/,
    );

    await rendre([
      evenement(
        'porte_ouverte',
        { ticketId: 'bil-1', ouvertures: 1 },
        Date.UTC(2026, 9, 30, 13, 2),
      ),
      evenement(
        'node_joined',
        { ticketId: 'bil-1', nodeId: 'n-1', label: 'PC-Léa' },
        Date.UTC(2026, 9, 30, 13, 5),
      ),
    ]);
    expect(statut().className).toBe('porte-arrivee entree');
    expect(statut().textContent).toMatch(/PC-Léa est entrée dans la ruche à \d{2}:\d{2}/);
  });

  it('arriveeDuBillet : compte les ouvertures, garde la dernière, nomme la machine', () => {
    const r = arriveeDuBillet(
      [
        evenement('porte_ouverte', { ticketId: 'b' }, 10),
        evenement('porte_ouverte', { ticketId: 'b' }, 30),
        evenement('porte_ouverte', { ticketId: 'c' }, 40),
        evenement('node_joined', { ticketId: 'b', nodeId: 'n-9' }, 50),
      ],
      'b',
    );
    expect(r).toEqual({
      ouvertures: 2,
      derniereOuverture: 30,
      entrees: [{ label: 'n-9', ts: 50 }],
    });
    expect(arriveeDuBillet(undefined, 'b').ouvertures).toBe(0);
    expect(arriveeDuBillet([], undefined).entrees).toEqual([]);
  });
});
