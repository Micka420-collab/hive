// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// UN SONDAGE EN ÉCHEC SE RATTRAPE D'UN CLIC — et le clic se voit.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// `useApiPoll` rendait déjà un `refresh()`. Aucun écran ne l'offrait : un
// relevé en échec s'affichait en une phrase rouge, puis il fallait attendre
// l'intervalle suivant — trente secondes, deux minutes pour certaines listes —
// sans aucun moyen de dire « maintenant », même après avoir relancé
// l'orchestrateur à la main.
//
// ─── ET POURQUOI UN BOUTON NE SUFFIT PAS ─────────────────────────────────────
//
// Un orchestrateur arrêté refuse la connexion en quelques millisecondes. Le
// clic, l'échec et le retour du bouton tiennent dans une image : l'écran ne
// change pas, et rien ne dit que le clic a eu lieu. D'où l'heure du dernier
// essai, qui BOUGE à chaque échec.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonTableau: vi.fn(),
}));

import { fetchMonTableau } from '../dashboard/src/api';
import MonEspace from '../dashboard/src/views/MonEspace';
import { EchecSondage, timeShort, useApiPoll } from '../dashboard/src/views/shared';
import type { ViewProps } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function monter(ui: React.ReactNode): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

/** Un écran minimal : un sondage LENT (une heure), et son échec. */
function Sonde({ lire }: { lire: () => Promise<string> }) {
  const s = useApiPoll(lire, 3_600_000);
  return (
    <div>
      <EchecSondage sondage={s} avant="Plan indisponible :" />
      {s.data !== null && <p className="releve">{s.data}</p>}
    </div>
  );
}

/** Une promesse qu'on tient à la main : pour voir l'écran PENDANT la lecture. */
function enAttente<T>() {
  let tenir: (v: T) => void = () => {};
  let rompre: (e: unknown) => void = () => {};
  const promesse = new Promise<T>((ok, ko) => {
    tenir = ok;
    rompre = ko;
  });
  return { promesse, tenir, rompre };
}

const relancer = (dom: HTMLElement): HTMLButtonElement => {
  const b = dom.querySelector<HTMLButtonElement>('.echec-sondage-relance');
  expect(b, 'aucun geste pour relire tout de suite').not.toBeNull();
  return b as HTMLButtonElement;
};

describe('le sondage en échec', () => {
  it('OFFRE DE RÉESSAYER — et relit sur-le-champ, sans attendre l’intervalle', async () => {
    // `TypeError` : ce que `fetch` jette quand personne ne répond.
    const lire = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce('trois tâches intégrables');
    const dom = await monter(<Sonde lire={lire} />);

    const bande = dom.querySelector('.panel-error');
    expect(bande?.textContent).toContain('Plan indisponible : La ruche n’a pas répondu');
    expect(relancer(dom).textContent).toBe('Réessayer');
    expect(lire).toHaveBeenCalledTimes(1);

    await act(async () => relancer(dom).click());
    // L'intervalle est d'une HEURE : seul le bouton a pu relire.
    expect(lire, 'le clic n’a rien relu').toHaveBeenCalledTimes(2);
    expect(dom.querySelector('.panel-error'), 'la panne guérie reste affichée').toBeNull();
    expect(dom.querySelector('.releve')?.textContent).toBe('trois tâches intégrables');
  });

  it('PENDANT LE NOUVEL ESSAI, LE BOUTON LE DIT ET NE SE LAISSE PAS REPRESSER', async () => {
    const second = enAttente<string>();
    const lire = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockReturnValueOnce(second.promesse);
    const dom = await monter(<Sonde lire={lire} />);

    await act(async () => relancer(dom).click());
    expect(relancer(dom).textContent).toBe('Nouvel essai…');
    expect(relancer(dom).disabled, 'on peut relancer une lecture déjà en vol').toBe(true);

    await act(async () => second.rompre(new Error('HTTP 503')));
    expect(relancer(dom).textContent, 'le bouton reste bloqué après la réponse').toBe('Réessayer');
    expect(relancer(dom).disabled).toBe(false);
  });

  it('UN ÉCHEC RÉPÉTÉ CHANGE L’HEURE DU DERNIER ESSAI — le clic laisse une trace', async () => {
    // Seule l'horloge est simulée : les minuteries restent réelles.
    vi.useFakeTimers({ toFake: ['Date'] });
    const t1 = new Date(2026, 8, 27, 14, 2, 31).getTime();
    const t2 = new Date(2026, 8, 27, 14, 7, 5).getTime();
    vi.setSystemTime(t1);
    const lire = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('HTTP 503'));
    const dom = await monter(<Sonde lire={lire} />);

    const quand = () => dom.querySelector('.echec-sondage-quand')?.textContent ?? '';
    expect(quand()).toBe(`dernier essai à ${timeShort(t1)}`);

    vi.setSystemTime(t2);
    await act(async () => relancer(dom).click());
    expect(lire).toHaveBeenCalledTimes(2);
    expect(quand(), 'le même échec, à la même heure : le clic est invisible').toBe(
      `dernier essai à ${timeShort(t2)}`,
    );
  });

  it('AU REPOS, NI BANDE NI BOUTON', async () => {
    const dom = await monter(<Sonde lire={() => Promise.resolve('tout va bien')} />);
    expect(dom.querySelector('.panel-error')).toBeNull();
    expect(dom.querySelector('.echec-sondage-relance')).toBeNull();
  });
});

describe('dans une vraie vue', () => {
  it('MON ESPACE EN ÉCHEC SE RELIT D’UN CLIC — c’est tout son écran', async () => {
    // L'échec de ce sondage REMPLACE la vue entière : sans geste, la personne
    // n'a devant elle qu'une phrase rouge, pour trente secondes.
    vi.mocked(fetchMonTableau)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({
        version: 1,
        projets: [],
        alertes: [],
        graviteMax: null,
        totaux: { projets: 0, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 },
        balanceAJour: true,
        balanceMode: 'off',
      } as never);
    const props = {
      snapshot: { projects: [], nodes: [], tasks: [], tasksTotal: 0 } as unknown as StateSnapshot,
      events: [],
      agentsByTask: {},
      deferred: new Set(),
      onOpenTask: () => {},
      onNavigate: () => {},
      refreshTick: 0,
      user: { displayName: 'apicultrice' },
    } as unknown as ViewProps;
    const dom = await monter(<MonEspace {...props} />);
    expect(dom.querySelector('.panel-error')?.textContent).toContain('La ruche n’a pas répondu');

    await act(async () => relancer(dom).click());
    await act(async () => {});
    expect(vi.mocked(fetchMonTableau)).toHaveBeenCalledTimes(2);
    expect(
      dom.querySelector('.panel-error'),
      'Mon espace reste en panne après relecture',
    ).toBeNull();
  });
});
