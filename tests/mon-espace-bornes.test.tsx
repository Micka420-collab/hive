// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// MON ESPACE — les bornes que le décor n'a jamais franchies.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage complet de `MonEspace.tsx` (base épinglée `c9591f4`, 439 ajoutées /
// 0 retirée) : **18 candidates, 18 examinées, 9 défendues, 9 SANS TEST**.
// Cinquante pour cent — le pire ratio depuis la Reine.
//
// ─── CE QUE `mon-espace-lecture` TENAIT DÉJÀ ─────────────────────────────────
//
// Le chiffre des heures et ses bornes, l'habit d'un projet arrêté, l'étiquette
// de plan, le grand livre en retard. Toutes défendues, le balayage le confirme.
//
// ─── ET POURQUOI LES NEUF AUTRES LUI ÉCHAPPAIENT ─────────────────────────────
//
// Son décor `projet()` pose des valeurs FIXES, et ce sont exactement celles qui
// n'atteignent jamais les gardes :
//
//     role: 'member'          → la pastille « propriétaire » ne s'allume jamais
//     joursRestants: -1       → le bloc « Période » ne s'ouvre jamais
//     serveurs: []            → le bloc « Machines » ne s'ouvre jamais
//     partConsommee: null     → la jauge n'est jamais rendue
//
// Un décor n'est pas neutre : il CHOISIT, à chaque champ, un côté de chaque
// borne. Tant qu'il ne varie pas, la ligne est traversée mille fois et éprouvée
// zéro. C'est le même constat que sur la Chronique, sur un autre écran.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMonTableau: vi.fn(() => Promise.resolve(null)),
}));

import { fetchMonTableau } from '../dashboard/src/api';
import MonEspace from '../dashboard/src/views/MonEspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

/** Le même décor que `mon-espace-lecture`, aux champs qu'on fait VARIER près. */
const projet = (over: Record<string, unknown> = {}) => ({
  projectId: 'p-1',
  nom: 'Rucher',
  role: 'member',
  plan: 'libre',
  etatAbonnement: 'actif',
  finPeriode: null,
  actif: true,
  motifDroits: '',
  heures: 0,
  plafondMs: null,
  depenseMs: 0,
  serveurs: [],
  autonomie: 'off',
  partConsommee: null,
  joursRestants: -1,
  serveursFacturables: 0,
  ...over,
});

const tableau = (over: Record<string, unknown> = {}) => ({
  version: 1,
  projets: [],
  alertes: [],
  graviteMax: null,
  totaux: { projets: 0, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 },
  balanceAJour: true,
  balanceMode: 'off',
  ...over,
});

async function monter(t: Record<string, unknown>): Promise<HTMLElement> {
  vi.mocked(fetchMonTableau).mockResolvedValue(t as never);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
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
  await act(async () => racine?.render(<MonEspace {...props} />));
  await act(async () => {});
  return conteneur;
}

/** La tuile DÉSIGNÉE par son libellé — jamais par son rang. */
function tuile(dom: HTMLElement, libelle: string): HTMLElement {
  const e = [...dom.querySelectorAll<HTMLElement>('.me-tuile')].find((x) =>
    (x.querySelector('.me-tuile-libelle')?.textContent ?? '').includes(libelle),
  );
  if (!e) throw new Error(`la tuile « ${libelle} » est introuvable`);
  return e;
}

/** Le fait NOMMÉ de la carte (le <dd> sous le <dt> qui porte ce mot), ou null. */
function fait(dom: HTMLElement, nom: string): string | null {
  for (const bloc of dom.querySelectorAll('.me-carte dl > div')) {
    if ((bloc.querySelector('dt')?.textContent ?? '').includes(nom)) {
      return bloc.querySelector('dd')?.textContent ?? '';
    }
  }
  return null;
}

describe('la tuile des machines : « chaud » veut dire qu’il en tourne', () => {
  it('ZÉRO MACHINE EN MARCHE RESTE CALME — la borne, prise par en dessous', async () => {
    // `serveursActifs > 0 ? 'chaud' : 'calme'` mutée en `>=` : la tuile est
    // chaude à zéro. Le tableau de bord a l'air en activité alors que rien ne
    // tourne — même famille que la tuile du Débit de la Ruche.
    const dom = await monter(
      tableau({ totaux: { projets: 1, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 } }),
    );
    const t = tuile(dom, 'machines en marche');
    expect(t.className, 'zéro machine et pourtant la tuile est chaude').not.toContain('chaud');
    expect(t.className).toContain('calme');
  });

  it('UNE MACHINE EN MARCHE CHAUFFE — le cas positif', async () => {
    const dom = await monter(
      tableau({ totaux: { projets: 1, serveursActifs: 1, heuresIncluses: 0, depenseMs: 0 } }),
    );
    expect(tuile(dom, 'machines en marche').className).toContain('chaud');
  });
});

describe('la pastille « propriétaire » dit à qui est le projet', () => {
  it('UN PROJET DONT ON EST PROPRIÉTAIRE LA PORTE, UN AUTRE NON', async () => {
    // Deux mutations nues sur la même ligne : `&& → ||` (la pastille s'affiche
    // sur ce qu'on ne possède PAS) et `=== → !==` (elle s'inverse). Le décor
    // existant ne pose que `role: 'member'` : la garde n'était traversée que
    // par un bord.
    const dom = await monter(
      tableau({
        projets: [
          projet({ projectId: 'p-1', nom: 'Rucher', role: 'owner' }),
          projet({ projectId: 'p-2', nom: 'Verger', role: 'member' }),
        ],
      }),
    );
    const cartes = [...dom.querySelectorAll<HTMLElement>('.me-carte')];
    expect(cartes, 'les deux cartes ne sont pas rendues').toHaveLength(2);

    const mienne = cartes.find((c) => (c.textContent ?? '').includes('Rucher'));
    const autre = cartes.find((c) => (c.textContent ?? '').includes('Verger'));
    expect(mienne?.querySelector('.me-role'), 'le projet possédé n’est pas marqué').not.toBeNull();
    expect(
      autre?.querySelector('.me-role'),
      'un projet qu’on ne possède pas se dit possédé',
    ).toBeNull();
  });
});

describe('le compte à rebours de période dit le VRAI jour', () => {
  it('SANS PÉRIODE (−1 jour) LE BLOC N’EXISTE PAS', async () => {
    // `joursRestants >= 0` mutée en `||` : le bloc n'apparaît QU'APRÈS
    // l'échéance. Un avertissement qui ne se montre qu'une fois trop tard.
    const dom = await monter({ ...tableau({ projets: [projet({ joursRestants: -1 })] }) });
    expect(fait(dom, 'Période'), 'le bloc de période s’ouvre sans période').toBeNull();
  });

  it('LE DERNIER JOUR (0) LE BLOC EXISTE ENCORE — la borne est INCLUSIVE', async () => {
    // `>= 0` resserrée en `> 0` : le jour même de l'échéance — le seul que les
    // deux versions distinguent — l'écran se tait.
    const dom = await monter(tableau({ projets: [projet({ joursRestants: 0 })] }));
    const p = fait(dom, 'Période');
    expect(p, 'le dernier jour, le bloc de période a disparu').not.toBeNull();
    // …et `=== 0` inversée dirait « 0 jour(s) restant(s) » au lieu du mot du jour.
    expect(p, 'le jour de l’échéance ne se nomme pas').toContain('se termine aujourd’hui');
  });

  it('TROIS JOURS AVANT, C’EST LE COMPTE QUI S’AFFICHE, PAS « aujourd’hui »', async () => {
    const dom = await monter(tableau({ projets: [projet({ joursRestants: 3 })] }));
    const p = fait(dom, 'Période');
    expect(p, 'le compte des jours ne s’affiche pas').toContain('3');
    expect(p, '« aujourd’hui » s’affiche trois jours trop tôt').not.toContain(
      'se termine aujourd’hui',
    );
  });
});

describe('le bloc « Machines » ne s’ouvre que s’il y a des machines', () => {
  it('AUCUNE MACHINE : PAS DE BLOC', async () => {
    // `serveurs.length > 0` mutée en `||` (le bloc s'ouvre sur une liste vide)
    // ou en `>=` (idem, par la borne).
    const dom = await monter(tableau({ projets: [projet({ serveurs: [] })] }));
    expect(fait(dom, 'Machines'), 'le bloc des machines s’ouvre sur une liste vide').toBeNull();
  });

  it('DEUX MACHINES : LE BLOC LES COMPTE', async () => {
    const dom = await monter(
      tableau({
        projets: [projet({ serveurs: [{ id: 's1' }, { id: 's2' }], serveursFacturables: 1 })],
      }),
    );
    const m = fait(dom, 'Machines');
    expect(m, 'le bloc des machines manque alors qu’il y en a').not.toBeNull();
    expect(m).toContain('1');
    expect(m).toContain('2');
  });
});

describe('sans plafond, PAS de jauge — le commentaire du fichier est enfin une garde', () => {
  it('AUCUN PLAFOND : la phrase, et AUCUNE barre', async () => {
    // Le fichier écrit lui-même pourquoi :
    //   « Sans plafond, PAS de jauge : une barre à zéro dirait "rien dépensé"
    //     alors que la vérité est "rien ne vous borne". »
    // `partConsommee === null` inversée rend justement cette barre à zéro —
    // `null >= 1` et `null >= 0.9` sont faux, `Math.round(null * 100)` vaut 0.
    // Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties) ;
    // celui-ci en a une.
    const dom = await monter(tableau({ projets: [projet({ partConsommee: null })] }));
    expect(dom.querySelector('.me-sans-plafond')?.textContent ?? '').toContain(
      'Aucun plafond de dépense posé.',
    );
    expect(
      dom.querySelector('[role="progressbar"]'),
      'une jauge s’affiche alors qu’aucun plafond n’est posé',
    ).toBeNull();
  });

  it('UN PLAFOND À MOITIÉ CONSOMMÉ : la barre, et pas la phrase', async () => {
    const dom = await monter(tableau({ projets: [projet({ partConsommee: 0.5 })] }));
    const jauge = dom.querySelector('[role="progressbar"]');
    expect(jauge, 'la jauge manque alors qu’un plafond est posé').not.toBeNull();
    expect(jauge?.getAttribute('aria-valuenow')).toBe('50');
    expect(
      dom.querySelector('.me-sans-plafond'),
      '« aucun plafond » s’affiche avec un plafond',
    ).toBeNull();
  });
});
