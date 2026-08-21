// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES PHÉROMONES — l'affinité apprise, et sa polarité.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties). `essaim-castes`
// tient six cas, TOUS sur le polyéthisme et le badge ⚔ : le manque chiffré
// d'une nourrice, l'absence de conseil pour une butineuse, l'autre branche du
// conseil, la ruche sans ouvrière, le drone qui vole contre celui qui est
// tombé, le mode demandé mais éteint. Non rejoués ici.
//
// La carte des phéromones, elle, n'avait aucun cas — sur aucune des deux
// racines. Ni `es-phero`, ni « Lecture des pistes », ni le score signé.
//
// ─── CE QUE LA CARTE PROMET, ET QUE PERSONNE NE TENAIT ───────────────────────
//
// Le fichier énonce sa propre règle, deux fois plutôt qu'une :
//
//     « L'axe de chaque barre est CENTRÉ : attirance à droite (vert),
//       répulsion à gauche (rouge) — la phéromone répulsive est un vrai
//       signal, pas une absence. Le score signé est écrit en toutes lettres à
//       côté : LA COULEUR NE PORTE JAMAIS L'INFORMATION SEULE. »
//
// Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties). Les
// deux moitiés de cette phrase — la polarité, et le fait qu'elle soit écrite —
// en ont une maintenant, BORNE COMPRISE.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Six mutants posés ensemble, chacun vérifié posé, suite entière verte —
// 287 fichiers, 4 174 tests :
//
//     trace.score >= 0                 →  > 0    (la borne à zéro)
//     {positif ? `+${score}` : score}  →  {score}
//     traces === null ? … : …          →  les deux MESSAGES échangés
//     {!jamaisRienRecu(pheromones) &&} →  {jamaisRienRecu(pheromones) &&}
//     parNoeud.get / push / set        →  set seul (le regroupement s'écrase)
//     Math.max(1, …abs(score))         →  Math.max(0, …)  (division par zéro)
//
// ─── UN MUTANT QUI PLANTE NE PROUVE PAS LA DISTINCTION ───────────────────────
//
// Premier jet du mutant des deux vides : déplacer la CONDITION
// (`traces === null` → `traces !== null && traces.length === 0`). Les six cas
// sont passés au rouge — mais par `TypeError` sur `null.length`, dès le premier
// rendu, avant toute réponse. Un banc qui « tue » un mutant en le faisant
// planter n'a montré qu'une chose : que la vue se monte. La distinction entre
// les deux vides, elle, restait non mesurée.
//
// Le mutant final n'échange que les DEUX MESSAGES, structure intacte : il ne
// casse que le SENS, et un seul cas tombe — celui qui parle des deux vides.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { TraceePheromone } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveNode, StateSnapshot } from '../src/shared/types';

// Les QUATRE sondes de la vue sont bouchées, pas seulement celle qu'on met en
// scène : un bouchon partiel laisse partir au réseau tout ce qu'on n'a pas
// nommé (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { fetchPheromones, fetchPolyethisme, fetchRaces, fetchWaggle } from '../dashboard/src/api';
import Essaim from '../dashboard/src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchWaggle)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchRaces)
    .mockReset()
    .mockResolvedValue({ races: [] } as never);
  vi.mocked(fetchPolyethisme)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchPheromones).mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const noeud = (id: string, name: string): HiveNode =>
  ({
    id,
    name,
    ownerName: 'apicultrice',
    agentType: 'shell',
    maxConcurrency: 2,
    running: 0,
    status: 'online',
    lastSeen: null,
  }) as HiveNode;

const trace = (over: Partial<TraceePheromone> = {}): TraceePheromone => ({
  nodeId: 'n-1',
  domaine: 'api',
  score: 12,
  reussites: 3,
  echecs: 0,
  ...over,
});

/**
 * Monte l'Essaim sur la réponse de `/api/pheromones` donnée.
 *
 * `reponse` est ce que la sonde REND : un objet de traces, ou `null` (rien
 * n'est encore arrivé). Pour la route ABSENTE, voir `monterSurRouteAbsente`.
 */
async function monter(reponse: { traces: TraceePheromone[] } | null): Promise<HTMLElement> {
  vi.mocked(fetchPheromones).mockResolvedValue(reponse as never);
  return rendre();
}

/** La route n'existe pas sur cette ruche : la sonde rejette, et rien n'arrive. */
async function monterSurRouteAbsente(): Promise<HTMLElement> {
  vi.mocked(fetchPheromones).mockRejectedValue(new Error('404 introuvable'));
  return rendre();
}

async function rendre(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [],
      nodes: [noeud('n-1', 'ruche-nord'), noeud('n-2', 'ruche-sud')],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Essaim {...props} />));
  await act(async () => {});
  return conteneur;
}

/** La carte des phéromones, ou `null` si elle a disparu de l'écran. */
const carte = (dom: HTMLElement): HTMLElement | null => {
  const sections = [...dom.querySelectorAll<HTMLElement>('section.card')];
  return sections.find((s) => (s.textContent ?? '').includes('Phéromones')) ?? null;
};

/** Les lignes de domaine, dans l'ordre du rendu. */
const lignes = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.es-phero-row'),
];

describe('les phéromones : ce qu’une ouvrière sait faire, et ce qu’elle rate', () => {
  it('UNE TRACE S’AFFICHE AVEC SON NŒUD, SON DOMAINE ET SON COMPTE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await monter({ traces: [trace({ reussites: 3, echecs: 1 })] });
    const c = carte(dom);

    expect(c, 'la carte des phéromones n’est pas rendue').not.toBeNull();
    expect(c!.textContent, 'le nom du nœud manque').toContain('ruche-nord');
    expect(c!.textContent, 'le libellé du domaine manque').toContain('API');
    expect(c!.textContent, 'le compte des réussites et des échecs manque').toContain('✔ 3 ✘ 1');
    expect(lignes(dom), 'aucune ligne de domaine rendue').toHaveLength(1);
  });

  it('ZÉRO PILE EST UNE ATTIRANCE — et le score s’écrit avec son signe', async () => {
    // ─── LA BORNE, ET LA MOITIÉ DE RÈGLE QU’ELLE PORTE (§ 9 trigicenties) ──
    //
    // `score >= 0` contre `score > 0` ne diffèrent QU'À ZÉRO : à +12 comme à
    // −4, les deux versions rendent la même couleur. Seule la valeur ÉGALE les
    // sépare — et zéro n'est pas un cas de laboratoire : un nœud qui réussit
    // autant qu'il échoue, ou dont le signal s'est évaporé, y tombe.
    //
    // Ce que le mutant produit : « ce nœud se plante sur ce domaine », en
    // rouge, alors que la mesure ne dit rien du tout.
    //
    // Et la seconde moitié dans le même montage : le score est ÉCRIT, signe
    // compris. Sans lui, la polarité ne repose plus que sur la couleur — ce
    // que le fichier s'interdit à voix haute, et que personne ne tenait.
    const dom = await monter({
      traces: [
        trace({ nodeId: 'n-1', domaine: 'api', score: 0, reussites: 2, echecs: 2 }),
        trace({ nodeId: 'n-2', domaine: 'db', score: -4, reussites: 0, echecs: 1 }),
      ],
    });

    const [pile, negative] = lignes(dom);
    const scoreDe = (l: HTMLElement) => l.querySelector<HTMLElement>('.es-phero-score');

    expect(
      scoreDe(pile!)?.className,
      'zéro pile se lit « répulsion » : la carte accuse un nœud que la mesure n’accuse pas',
    ).toContain('pos');
    expect(
      scoreDe(pile!)?.textContent,
      'le score positif perd son signe — seule la couleur porte alors la polarité',
    ).toBe('+0');

    expect(
      scoreDe(negative!)?.className,
      'une répulsion se lit « attirance » — le signal négatif est effacé',
    ).toContain('neg');
    expect(scoreDe(negative!)?.textContent, 'le score négatif n’est pas écrit').toBe('-4');
  });

  it('« JE LIS ENCORE » ET « JE N’AI RIEN MESURÉ » NE SONT PAS LE MÊME VIDE', async () => {
    // ─── DEUX MONDES OPPOSÉS ───────────────────────────────────────────────
    //
    // « Lecture des pistes… » : la réponse n'est pas encore là, patiente.
    // « Pas encore d'affinité mesurée » : la réponse EST là, et elle est vide
    // — la ruche n'a simplement pas encore produit de résultats.
    //
    // Échangés, une ruche neuve reste en chargement perpétuel devant quelqu'un
    // qui attend un écran qui ne viendra jamais — et une ruche qui charge
    // annonce une absence d'affinité qu'elle n'a pas mesurée.
    const enLecture = await monter(null);
    expect(carte(enLecture)!.textContent, 'la lecture en cours ne se dit pas').toContain(
      'Lecture des pistes',
    );

    act(() => racine?.unmount());
    conteneur?.remove();

    const mesureVide = await monter({ traces: [] });
    expect(
      carte(mesureVide)!.textContent,
      'une mesure vide se déclare « en lecture » — l’écran n’arrivera jamais',
    ).toContain('pas encore d’affinité mesurée');
    expect(carte(mesureVide)!.textContent, 'la mesure vide se dit encore en lecture').not.toContain(
      'Lecture des pistes',
    );
  });

  it('UNE RUCHE SANS LA ROUTE PERD LA CARTE, PAS LA VUE — et en silence', async () => {
    // ─── LA DÉGRADATION PROPRE ─────────────────────────────────────────────
    //
    // Une ruche auto-hébergée peut tourner une version D'AVANT /api/pheromones.
    // La carte disparaît alors sans crier : une fonctionnalité absente n'est
    // pas une panne. Mais le reste de l'Essaim doit rester entier — c'est la
    // moitié qu'on oublie, et celle qui se voit le plus si elle casse.
    const absente = await monterSurRouteAbsente();
    expect(carte(absente), 'la carte reste alors que la route n’a jamais répondu').toBeNull();
    expect(absente.textContent, 'la disparition de la carte emporte la vue Essaim').toContain(
      'Waggle Board',
    );
    expect(absente.textContent, 'la carte absente crie son erreur').not.toContain('404');

    act(() => racine?.unmount());
    conteneur?.remove();

    // Le contre-monde : la route répond, la carte est là.
    const presente = await monter({ traces: [trace()] });
    expect(carte(presente), 'la carte manque alors que la route a répondu').not.toBeNull();
  });

  it('UN NŒUD QUI A TRAVAILLÉ TROIS DOMAINES LES MONTRE TOUS LES TROIS', async () => {
    // ─── LE REGROUPEMENT PAR NŒUD ──────────────────────────────────────────
    //
    // La carte répond à « sur quoi cette ouvrière est-elle douée, sur quoi se
    // plante-t-elle ? ». Un regroupement qui écrase ne garde que la DERNIÈRE
    // trace de chaque nœud : la réponse devient « sur ce domaine-ci », choisi
    // par l'ordre d'arrivée, et les forces comme les faiblesses disparaissent
    // sans que rien ne signale la perte.
    const dom = await monter({
      traces: [
        trace({ nodeId: 'n-1', domaine: 'api', score: 12 }),
        trace({ nodeId: 'n-1', domaine: 'ui', score: 5 }),
        trace({ nodeId: 'n-1', domaine: 'tests', score: -3 }),
        trace({ nodeId: 'n-2', domaine: 'db', score: 7 }),
      ],
    });

    const noeuds = [...dom.querySelectorAll<HTMLElement>('.es-phero-node')];
    expect(noeuds, 'les traces ne sont pas regroupées par nœud').toHaveLength(2);
    expect(
      noeuds[0]!.querySelectorAll('.es-phero-row'),
      'un nœud à trois domaines n’en montre pas trois — le regroupement écrase',
    ).toHaveLength(3);
    expect(lignes(dom), 'des lignes de domaine ont disparu').toHaveLength(4);
  });

  it('UNE RUCHE TOUTE À ZÉRO GARDE DES BARRES LISIBLES — elle ne divise pas par zéro', async () => {
    // ─── LE PLANCHER DE L’ÉCHELLE ──────────────────────────────────────────
    //
    // `Math.max(1, …)` n'est pas une coquetterie : l'échelle est le
    // DÉNOMINATEUR de la largeur de chaque barre. Une ruche dont toutes les
    // traces valent 0 — cas réel : le signal s'évapore avec une demi-vie de
    // sept jours — le rendrait nul, et la largeur devient `NaN%`.
    //
    // Seule une ruche ENTIÈREMENT à zéro sépare les deux versions : dès qu'une
    // trace vaut autre chose, le plancher ne sert plus à rien.
    const dom = await monter({
      traces: [
        trace({ nodeId: 'n-1', domaine: 'api', score: 0 }),
        trace({ nodeId: 'n-2', domaine: 'db', score: 0 }),
      ],
    });

    const barres = [...dom.querySelectorAll<HTMLElement>('.es-phero-bar')];
    expect(barres, 'les barres ne sont pas rendues').toHaveLength(2);
    for (const b of barres) {
      expect(b.style.width, 'la largeur d’une barre n’est plus un pourcentage lisible').toBe('0%');
    }
  });
});
