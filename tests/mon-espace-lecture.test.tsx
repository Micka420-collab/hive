// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// MON ESPACE — la lecture d'un chiffre, et l'état d'un projet.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties) :
// `vues-sentinelles` tient trois cas — le compte à rebours des alertes, sa
// borne à zéro, et le motif d'arrêt. Non rejoués ici.
//
// ─── LA PRÉCISION QUI SE PERD À DIX HEURES ───────────────────────────────────
//
// Le fichier énonce sa propre règle, et personne ne la tenait :
//
//     « Une décimale sous dix heures, entier au-delà : au-dessus, le dixième
//       d'heure n'informe plus personne et donne une fausse impression de
//       précision. »
//
//     return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
//
// C'est le chiffre que la personne lit pour savoir ce qu'elle a dépensé. Sous
// dix heures, le dixième compte : « 0,4 h » et « 0 h » ne disent pas la même
// chose à qui surveille un forfait. Au-delà, il ment sur sa propre exactitude.
//
// Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties). Celui-ci
// en a une maintenant — bornes comprises.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Mutants posés ensemble, chacun vérifié posé, suite entière verte —
// 286 fichiers, 4 168 tests :
//
//     h < 10 ? toFixed(1) : round      →  round toujours  /  h <= 10
//     Math.max(0, ms)                  →  ms   (un solde négatif s'affiche)
//     p.actif ? '' : ' inactive'       →  inversé
//     {!d.balanceAJour && …}           →  {d.balanceAJour && …}
//     {p.plan !== 'libre' && …}        →  {p.plan === 'libre' && …}

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

const HEURE_MS = 3_600_000;

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

/** Un projet du tableau, à la forme que la vue attend. */
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

/** Le tableau complet. `depenseMs` est le chiffre que l'écran met en heures. */
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
    // Sans session, la vue s'arrête à l'invitation.
    user: { displayName: 'apicultrice' },
  } as unknown as ViewProps;
  await act(async () => racine?.render(<MonEspace {...props} />));
  await act(async () => {});
  return conteneur;
}

/** La tuile de dépense, désignée par SON libellé — jamais par son rang. */
function tuileDepense(dom: HTMLElement): string {
  const t = [...dom.querySelectorAll<HTMLElement>('.me-tuile, .tile')].find((e) =>
    (e.textContent ?? '').includes('temps-ouvrière'),
  );
  if (!t) throw new Error('la tuile de dépense est introuvable');
  return t.textContent ?? '';
}

const carte = (dom: HTMLElement): HTMLElement => {
  const c = dom.querySelector<HTMLElement>('.me-carte');
  if (!c) throw new Error('la carte de projet est introuvable');
  return c;
};

describe('Mon Espace : le chiffre qu’on lit', () => {
  it('LA DÉPENSE S’AFFICHE EN HEURES — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await monter(
      tableau({
        totaux: { projets: 1, serveursActifs: 0, heuresIncluses: 0, depenseMs: 2.4 * HEURE_MS },
        projets: [projet()],
      }),
    );

    expect(tuileDepense(dom), 'la dépense n’est pas rendue en heures').toContain('h');
  });

  it('SOUS DIX HEURES LE DIXIÈME COMPTE — à dix PILE, il ne compte plus', async () => {
    // ─── LA RÈGLE DU FICHIER, ET SA BORNE (§ 9 trigicenties) ───────────────
    //
    // « Une décimale sous dix heures, entier au-delà : au-dessus, le dixième
    // d'heure n'informe plus personne et donne une fausse impression de
    // précision. »
    //
    // Les deux montages sont nécessaires ET suffisants : sous la borne, la
    // décimale doit être là ; À la borne, elle ne doit plus y être. `<` et
    // `<=` ne diffèrent QU'À DIX — à 2,4 h comme à 42 h, les deux versions
    // affichent la même chose.
    const petit = await monter(
      tableau({
        totaux: { projets: 1, serveursActifs: 0, heuresIncluses: 0, depenseMs: 2.4 * HEURE_MS },
      }),
    );
    expect(
      tuileDepense(petit),
      'sous dix heures, le dixième a disparu : « 0,4 h » se lirait « 0 h »',
    ).toContain('2.4');

    act(() => racine?.unmount());
    conteneur?.remove();

    const borne = await monter(
      tableau({
        totaux: { projets: 1, serveursActifs: 0, heuresIncluses: 0, depenseMs: 10 * HEURE_MS },
      }),
    );
    expect(
      tuileDepense(borne),
      'à dix heures pile, une décimale s’affiche encore — fausse précision',
    ).not.toContain('10.0');
    expect(tuileDepense(borne), 'la valeur à la borne n’est pas rendue').toContain('10 h');
  });

  it('UNE DÉPENSE NÉGATIVE NE S’AFFICHE PAS EN NÉGATIF', async () => {
    // `Math.max(0, ms)` : un grand livre qui rattrape peut rendre un delta
    // négatif. « −0,3 h dépensée » n'a aucun sens pour qui lit son forfait ;
    // le plancher le ramène à zéro plutôt que d'afficher une absurdité.
    const dom = await monter(
      tableau({
        totaux: { projets: 1, serveursActifs: 0, heuresIncluses: 0, depenseMs: -0.3 * HEURE_MS },
      }),
    );

    // On vise la VALEUR, pas la tuile entière : le libellé « temps-ouvrière »
    // porte lui-même un tiret, et un `not.toContain('-')` sur tout le texte
    // rougissait sur le mot, pas sur le chiffre. Un repère trop large juge
    // autre chose que ce qu'on croit (§ 2 duodecies).
    expect(tuileDepense(dom), 'une dépense négative s’affiche telle quelle').not.toContain('-0');
    expect(tuileDepense(dom), 'le plancher ne ramène pas à zéro').toContain('0.0 h');
  });
});

describe('Mon Espace : l’état d’un projet', () => {
  it('UN PROJET QUI BUTINE NE PORTE PAS L’HABIT DE L’ARRÊT — et l’arrêté le porte', async () => {
    // Les deux mondes dans le même montage : muté, ils s'échangent exactement,
    // et un banc qui n'en regarderait qu'un resterait vert.
    const dom = await monter(
      tableau({
        projets: [
          projet({ projectId: 'p-vif', nom: 'Rucher vif', actif: true }),
          projet({ projectId: 'p-mort', nom: 'Rucher arrêté', actif: false }),
        ],
      }),
    );

    const cartes = [...dom.querySelectorAll<HTMLElement>('.me-carte')];
    const vif = cartes.find((c) => (c.textContent ?? '').includes('Rucher vif'));
    const arrete = cartes.find((c) => (c.textContent ?? '').includes('Rucher arrêté'));

    expect(vif?.className, 'un projet qui butine paraît éteint').not.toContain('inactive');
    expect(arrete?.className, 'un projet arrêté ne le montre pas').toContain('inactive');
  });

  it('LE PLAN NE S’ÉTIQUETTE QUE S’IL EN EST UN — « libre » n’est pas un abonnement', async () => {
    // `p.plan !== 'libre'` : l'étiquette de plan sert à distinguer les projets
    // qui coûtent. Muté, elle apparaît sur les seuls projets gratuits — et
    // disparaît de ceux qu'on paie.
    const dom = await monter(tableau({ projets: [projet({ plan: 'libre' })] }));
    expect(
      carte(dom).querySelector('.me-plan'),
      'le plan « libre » porte une étiquette',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();

    const paye = await monter(tableau({ projets: [projet({ plan: 'rucher' })] }));
    expect(
      carte(paye).querySelector('.me-plan')?.textContent,
      'un plan payant ne s’étiquette pas',
    ).toContain('rucher');
  });

  it('LE GRAND LIVRE EN RETARD LE DIT — et se tait quand il est à jour', async () => {
    // Le champ porte sa raison dans le type : « `false` ⇒ le grand livre
    // rattrape encore : les dépenses sont incomplètes ». Sans l'avertissement,
    // on lit un total partiel comme s'il était complet — et l'on croit avoir
    // consommé moins que la vérité.
    const enRetard = await monter(tableau({ balanceAJour: false }));
    expect(enRetard.textContent, 'les dépenses sont incomplètes et rien ne le dit').toContain(
      'n’a pas fini son rattrapage',
    );

    act(() => racine?.unmount());
    conteneur?.remove();

    const aJour = await monter(tableau({ balanceAJour: true }));
    expect(
      aJour.textContent,
      'l’avertissement s’affiche sur un grand livre à jour — il ne veut plus rien dire',
    ).not.toContain('n’a pas fini son rattrapage');
  });
});
