// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PLEIN ESSAIM, À L'ÉCRAN — une seule liste « Prêt pour l'autonomie », qui
// dit ce qui manque et le geste qui le lève.
//
// Ce que ce banc tient (il remplace celui du « Chemin vers le premier cycle »,
// la seconde liste qui contredisait la première — 1/5 contre 4/8) :
//
//   · les conditions sont lues dans `pret`, dans l'ordre du chemin, et la
//     PREMIÈRE qui manque arrive ouverte, avec son aide ;
//   · le chemin des gouvernantes dit le VRAI : une caste se gagne sur
//     antécédents (les seuils viennent du serveur), elle ne se nomme pas ;
//   · la fusion n'est une condition qu'au niveau Plein — ailleurs, une coche
//     verte « dépôt autorisé » sur un projet sans dépôt mentait ;
//   · tout prêt, la liste se replie ;
//   · les niveaux disent des mots, et un second clic pendant l'envoi est ignoré ;
//   · « Inviter une machine » ouvre l'invitation du Studio.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtatEssaimUi, PretEssaimUi } from '../dashboard/src/api';

const banc = vi.hoisted(() => ({
  etat: null as unknown as EtatEssaimUi,
  reglages: [] as Array<[string, string, boolean]>,
  liberer: null as null | (() => void),
}));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchEssaim: vi.fn(() => Promise.resolve(banc.etat)),
  fetchEssaimCycles: vi.fn(() => Promise.resolve({ cycles: [] })),
  setEssaim: vi.fn((projectId: string, niveau: string, depot: boolean) => {
    banc.reglages.push([projectId, niveau, depot]);
    // L'envoi reste en vol jusqu'à `liberer()` : le second clic tombe pendant.
    return new Promise<void>((r) => {
      banc.liberer = r;
    });
  }),
}));

import { setLang } from '../dashboard/src/i18n';
import { PleinEssaim } from '../dashboard/src/PleinEssaim';
import { ContexteStudio, type GestesStudio } from '../dashboard/src/studio/gestes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRET_DEMO: PretEssaimUi = {
  runner: false,
  gouvernantes: false,
  noeudsEnLigne: true,
  agentsReels: false,
  depot: true,
  derive: false,
  plafond: true,
  repo: true,
};

function etatDe(p: Partial<EtatEssaimUi> = {}): EtatEssaimUi {
  return {
    niveau: 'off',
    runner: { mode: 'off', enPause: false, echecs: 0, dernierTourA: 0 },
    pret: PRET_DEMO,
    derive: {
      etat: 'degradee',
      indicateurs: [
        {
          cle: 'repetition',
          etat: 'degradee',
          valeur: 0.09,
          unite: 'part',
          seuil: 0.3,
          constat: '1 cause(s) distincte(s) pour 11 échec(s).',
        },
      ],
      echantillon: 27,
      solitudeJours: 0.1,
      motif: 'm',
    },
    decision: { pas: 'inerte', motif: 'autonomie désactivée', gouvernantes: [] },
    gouvernantes: [],
    gouvernantesRequises: 2,
    seuilsGouvernante: { productions: 30, fiabilite: 0.95 },
    depotInscrit: false,
    plafond: 'passe',
    lecons: [],
    niveaux: ['off', 'propose', 'gouverne', 'plein'],
    ...p,
  } as EtatEssaimUi;
}

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
const invitations: Array<string | undefined> = [];

const gestes: GestesStudio = {
  ouvrirPalette: () => undefined,
  ouvrirInvitation: (genre) => {
    invitations.push(genre);
  },
  ouvrirReglages: () => undefined,
  ouvrirRaccourcis: () => undefined,
  basculerColonne: () => undefined,
  nouveauProjet: () => undefined,
  revoirGuide: () => undefined,
};

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(
      <ContexteStudio.Provider value={gestes}>
        <PleinEssaim projectId="p1" />
      </ContexteStudio.Provider>,
    ),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return conteneur;
}

const etape = (dom: HTMLElement, id: string): HTMLElement | null =>
  dom.querySelector<HTMLElement>(`[data-etape="${id}"]`);

beforeEach(() => {
  setLang('fr');
  banc.reglages.length = 0;
  banc.liberer = null;
  invitations.length = 0;
  banc.etat = etatDe();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

describe('le Plein Essaim, une seule liste', () => {
  it('les conditions, dans l’ordre du chemin — la PREMIÈRE qui manque arrive ouverte', async () => {
    const dom = await monter();
    const ids = [...dom.querySelectorAll<HTMLElement>('[data-etape]')].map((e) => e.dataset.etape);
    expect(ids, 'au niveau Éteint, la fusion n’est pas une condition').toEqual([
      'agents',
      'runner',
      'gouvernantes',
      'sante',
      'budget',
    ]);
    expect(dom.querySelector('.essaim-section-tete .essaim-etat')?.textContent).toBe('1 sur 5');
    const jauge = dom.querySelector('[role="progressbar"]');
    expect(jauge?.getAttribute('aria-valuenow')).toBe('1');
    expect(jauge?.getAttribute('aria-valuemax')).toBe('5');

    const ouvertes = [...dom.querySelectorAll('.essaim-etape details')].filter(
      (d) => (d as HTMLDetailsElement).open,
    );
    expect(ouvertes, 'une seule condition ouverte : celle qu’on lève d’abord').toHaveLength(1);
    expect(etape(dom, 'agents')?.querySelector('details')?.open).toBe(true);
    expect(etape(dom, 'agents')?.textContent).toContain('Les machines en ligne sont simulées');
    expect(etape(dom, 'budget')?.className, 'le budget est là').toContain('ok');
    // L'état ne repose pas sur la couleur : un mot pour le lecteur d'écran.
    expect(etape(dom, 'budget')?.textContent).toContain('fait');
    expect(etape(dom, 'runner')?.textContent).toContain('à faire');
  });

  it('chaque manque porte SON geste : la commande à taper, l’invitation à ouvrir', async () => {
    const dom = await monter();
    expect(etape(dom, 'runner')?.querySelector('code')?.textContent).toBe('HIVE_RUNNER=on');
    const inviter = [...(etape(dom, 'agents')?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.includes('Inviter une machine'),
    );
    expect(inviter).toBeTruthy();
    await act(async () => inviter?.click());
    expect(invitations).toEqual(['machine']);
  });

  it('LE CHEMIN DES GOUVERNANTES DIT LE VRAI : une caste se gagne, elle ne se nomme pas', async () => {
    const dom = await monter();
    const g = etape(dom, 'gouvernantes');
    expect(g?.textContent).toContain('0 sur 2');
    expect(g?.textContent).toContain('au moins 30 productions');
    expect(g?.textContent).toContain('95 %');
    // L'ancienne aide envoyait « nommer » des gouvernantes dans la Chambre.
    expect(g?.textContent).not.toMatch(/Chambre|Nommer|baptiser/i);
  });

  it('sans les seuils (un orchestrateur plus ancien), le chemin se dit sans chiffre inventé', async () => {
    banc.etat = etatDe({ seuilsGouvernante: undefined });
    const dom = await monter();
    const g = etape(dom, 'gouvernantes')?.textContent ?? '';
    expect(g).toContain('en faisant ses preuves');
    expect(g).not.toMatch(/\d+ productions/);
  });

  it('LA FUSION N’EST UNE CONDITION QU’AU NIVEAU PLEIN', async () => {
    banc.etat = etatDe({ niveau: 'plein', pret: { ...PRET_DEMO, repo: false, depot: false } });
    const dom = await monter();
    const f = etape(dom, 'fusion');
    expect(f, 'au niveau Plein, la fusion devient une condition').toBeTruthy();
    expect(f?.className).toContain('manque');
    expect(f?.textContent).toContain('adresse du dépôt GitHub');
    expect(dom.querySelector('.essaim-section-tete .essaim-etat')?.textContent).toBe('1 sur 6');
  });

  it('TOUT EST PRÊT : la liste se replie, et dit quoi faire ensuite', async () => {
    const tout = Object.fromEntries(Object.keys(PRET_DEMO).map((k) => [k, true])) as never;
    banc.etat = etatDe({ pret: tout });
    const dom = await monter();
    const replie = dom.querySelector<HTMLDetailsElement>('.essaim-pret-replie');
    expect(replie, 'la liste complète se replie').toBeTruthy();
    expect(replie?.open).toBe(false);
    expect(replie?.querySelector('summary')?.textContent).toContain(
      'choisis un niveau d’autonomie',
    );
  });
});

describe('le Plein Essaim, la santé du projet', () => {
  it('DÉGRADÉE : les indicateurs sont là, ouverts — c’est là qu’on cherche pourquoi', async () => {
    const dom = await monter();
    expect(dom.querySelector('.essaim-replie'), 'rien de replié quand ça va mal').toBeNull();
    expect(dom.querySelectorAll('.essaim-ind')).toHaveLength(1);
    expect(dom.querySelector('.essaim-section-note')?.textContent).toBe(
      '27 production(s) observée(s)',
    );
  });

  it('SAINE : les indicateurs se replient, à un clic', async () => {
    banc.etat = etatDe({
      derive: { ...etatDe().derive, etat: 'saine', motif: 'tout va bien' },
    });
    const dom = await monter();
    const replie = dom.querySelector<HTMLDetailsElement>('.essaim-replie');
    expect(replie?.open).toBe(false);
    expect(replie?.querySelector('summary')?.textContent).toContain('Voir les 1 indicateurs');
  });

  it('PAS ENCORE MESURABLE : le motif dit pourquoi, au lieu d’un compte nu', async () => {
    banc.etat = etatDe({
      derive: {
        ...etatDe().derive,
        etat: 'indeterminee',
        motif: '11 production(s) observée(s), 20 nécessaires pour se prononcer.',
      },
    });
    const dom = await monter();
    expect(dom.querySelector('.essaim-section-note')?.textContent).toBe(
      '11 production(s) observée(s), 20 nécessaires pour se prononcer.',
    );
    expect(dom.querySelector('.essaim-section-tete .essaim-etat.ton-neutre')).toBeTruthy();
  });
});

describe('le Plein Essaim, les réglages', () => {
  it('les niveaux disent des MOTS, et le niveau courant est le seul pressé', async () => {
    banc.etat = etatDe({ niveau: 'gouverne' });
    const dom = await monter();
    const boutons = [...dom.querySelectorAll<HTMLButtonElement>('.essaim-niveau')];
    expect(boutons.map((b) => b.textContent)).toEqual(['Éteint', 'Propose', 'Gouverne', 'Plein']);
    expect(boutons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(dom.querySelector('.essaim-desc')?.textContent).toContain('Rien n’est fusionné');
  });

  it('un second clic pendant l’envoi est IGNORÉ — et le bouton garde le focus', async () => {
    const dom = await monter();
    const propose = dom.querySelector<HTMLButtonElement>('[data-niveau="propose"]')!;
    propose.focus();
    await act(async () => propose.click());
    expect(propose.getAttribute('aria-disabled')).toBe('true');
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-niveau="plein"]')!.click());
    expect(banc.reglages, 'un seul envoi en vol').toEqual([['p1', 'propose', false]]);
    expect(document.activeElement, 'pas de `disabled` qui jetterait le focus').toBe(propose);
    await act(async () => {
      banc.liberer?.();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it('l’autorisation de fusionner reste SÉPARÉE du niveau', async () => {
    const dom = await monter();
    const caseFusion = dom.querySelector<HTMLInputElement>('.essaim-inscription input')!;
    expect(dom.querySelector('.essaim-inscription')?.textContent).toContain(
      'J’autorise la ruche à fusionner sur ce dépôt',
    );
    await act(async () => caseFusion.click());
    expect(banc.reglages, 'cocher garde le niveau courant').toEqual([['p1', 'off', true]]);
  });

  it('« En sommeil » se lit comme une phrase, et la simulation est dite', async () => {
    const dom = await monter();
    const maintenant = dom.querySelector('.essaim-maintenant');
    expect(maintenant?.className).toContain('ton-neutre');
    expect(maintenant?.textContent).toContain('En sommeil');
    expect(maintenant?.textContent).toContain('Autonomie désactivée.');
    expect(dom.textContent).toContain('Simulation seulement');
    // Aucun glyphe en guise d'icône : des tracés SVG.
    expect(dom.textContent).not.toMatch(/[○■▣◇▤⬡↺⇄✓▲]/);
  });
});
