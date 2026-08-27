// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE NOM DE L'AGENT SUIT LA LANGUE DE L'INTERFACE — dans les trois vues qui
// l'affichent.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage loupe du 13 août sur `dashboard/src` (base épinglée `74fc316`,
// 72 candidates, 72 examinées, aucun échantillonnage). Cinq survivants sur dix
// portaient la MÊME ligne, recopiée dans trois fichiers :
//
//     libelleAgent(n.agentType, lang === 'en')
//                               ^^^^^^^^^^^^^ muté en `!==`, suite VERTE
//
// `libelleAgent` lui-même est bien défendu (`invitation-joignable.test.ts`
// éprouve les deux langues). Ce que rien ne tenait, c'est le CÂBLAGE : le
// drapeau que les vues lui passent. Inversé, une ouvrière de repli s'annonce
// « Shell (simulated) » à un francophone et « Shell (simulé) » à un
// anglophone — dans les deux cas, la seule ligne de l'écran qui prévient que
// les diffs produits sont SIMULÉS devient du bruit dans une langue étrangère.
//
// ─── POURQUOI `shell` ET PAS `claude-code` ───────────────────────────────────
//
// C'est l'entrée qui TRANCHE. Les noms de marque (`Claude Code`, `Codex`,
// `Grok Build`) sont identiques dans les deux langues : un banc écrit avec eux
// resterait vert sous la mutation — du décor. Seuls `shell` et `custom` ont
// deux libellés distincts, et `shell` est le repli, donc celui qui compte.
//
// ─── UN SEUL FICHIER POUR TROIS VUES ─────────────────────────────────────────
//
// Le défaut est UN, recopié trois fois. Dispersé dans trois bancs, il se
// re-perdrait à la quatrième copie ; réuni ici, la vue suivante qui affiche un
// agent trouve l'endroit où s'ajouter.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode, StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
}));

import { NodesPanel } from '../dashboard/src/NodesPanel';
import { SwarmView } from '../dashboard/src/SwarmView';
import Essaim from '../dashboard/src/views/Essaim';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Les deux libellés que `shell` prend, et qui ne se ressemblent pas. */
const FR = 'Shell (simulé)';
const EN = 'Shell (simulated)';

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  // La langue est un état de MODULE : sans cette remise à zéro, un test qui
  // bascule en anglais laisserait le suivant démarrer en anglais. C'est la
  // dépendance d'ordre intra-fichier, et elle se coupe ici.
  setLang('fr');
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  setLang('fr');
});

function ouvriere(): HiveNode {
  return {
    id: 'n-repli',
    name: 'ruche-de-repli',
    ownerName: 'Micka',
    agentType: 'shell',
    maxConcurrency: 2,
    running: 1,
    status: 'online',
    lastSeen: 1,
  };
}

async function monter(noeud: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(noeud));
  // Le corps entier : une fiche se monte par PORTAIL à la racine du document.
  return document.body;
}

const INSTANTANE = (nodes: HiveNode[]): StateSnapshot => ({
  projects: [],
  nodes,
  tasks: [],
  tasksTotal: 0,
});

function proprietesVue(nodes: HiveNode[]): ViewProps {
  return {
    snapshot: INSTANTANE(nodes),
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
}

describe('le panneau des nœuds — trois affichages, une seule langue', () => {
  it('EN FRANÇAIS l’ouvrière de repli s’annonce « simulé »', async () => {
    const dom = await monter(<NodesPanel nodes={[ouvriere()]} />);
    expect(dom.textContent).toContain(FR);
    expect(dom.textContent).not.toContain(EN);
  });

  it('EN ANGLAIS elle s’annonce « simulated » — carte ET infobulle', async () => {
    setLang('en');
    const dom = await monter(<NodesPanel nodes={[ouvriere()]} />);
    expect(dom.textContent, 'le sous-titre de la carte').toContain(EN);
    expect(dom.textContent).not.toContain(FR);
    // L'infobulle de l'avatar porte le MÊME drapeau, et c'est un troisième
    // site : mutée seule, elle laisserait le texte visible juste.
    const avatar = dom.querySelector('.node-avatar');
    expect(avatar?.getAttribute('title'), 'l’infobulle de l’avatar').toBe(EN);
  });

  it('EN FRANÇAIS l’infobulle de l’avatar suit aussi', async () => {
    const dom = await monter(<NodesPanel nodes={[ouvriere()]} />);
    expect(dom.querySelector('.node-avatar')?.getAttribute('title')).toBe(FR);
  });

  // ─── LE TROISIÈME SITE NE SE VOIT QU'APRÈS UN CLIC ─────────────────────────
  //
  // Ce test-ci n'était PAS dans le premier jet, et le rejeu l'a démasqué : les
  // trois autres sites rougissaient sous mutation, celui de la fiche restait
  // VERT. La fiche ne se rend qu'une fois la carte cliquée — un banc qui monte
  // seulement le panneau ne l'atteint jamais, et couvrait donc deux lignes sur
  // trois en ayant l'air d'en couvrir trois.
  //
  // C'est exactement le décor que la discipline interdit : la garde manquante
  // était invisible SANS le rejeu site par site. Mesurer chaque mutant
  // séparément, et pas le fichier en bloc, est ce qui l'a trouvée.
  it('LA FICHE, APRÈS CLIC, parle la même langue — le site que le premier jet ratait', async () => {
    setLang('en');
    const dom = await monter(<NodesPanel nodes={[ouvriere()]} tasks={[]} onOpenTask={() => {}} />);
    const carte = dom.querySelector('.node-card');
    act(() => {
      carte?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const fiche = dom.querySelector('[role="dialog"]');
    expect(fiche, 'la fiche s’ouvre au clic').toBeTruthy();
    expect(fiche?.querySelector('.fo-identite')?.textContent).toContain(EN);
    expect(fiche?.querySelector('.fo-identite')?.textContent).not.toContain(FR);
  });

  it('LA FICHE EN FRANÇAIS — l’autre moitié de la bascule', async () => {
    const dom = await monter(<NodesPanel nodes={[ouvriere()]} tasks={[]} onOpenTask={() => {}} />);
    act(() => {
      dom
        .querySelector('.node-card')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const identite = dom.querySelector('[role="dialog"] .fo-identite')?.textContent;
    expect(identite).toContain(FR);
    expect(identite).not.toContain(EN);
  });
});

describe('la vue de l’essaim (SVG) — le libellé sous l’alvéole', () => {
  it('EN FRANÇAIS : « simulé »', async () => {
    const dom = await monter(<SwarmView tasks={[]} nodes={[ouvriere()]} agentsByTask={{}} />);
    expect(dom.textContent).toContain(FR);
    expect(dom.textContent).not.toContain(EN);
  });

  it('EN ANGLAIS : « simulated »', async () => {
    setLang('en');
    const dom = await monter(<SwarmView tasks={[]} nodes={[ouvriere()]} agentsByTask={{}} />);
    expect(dom.textContent).toContain(EN);
    expect(dom.textContent).not.toContain(FR);
  });
});

describe('l’écran Essaim — la puce d’agent de la carte', () => {
  it('EN FRANÇAIS : « simulé »', async () => {
    const dom = await monter(<Essaim {...proprietesVue([ouvriere()])} />);
    const puce = [...dom.querySelectorAll('.es-chip')].map((e) => e.textContent);
    expect(puce).toContain(FR);
  });

  it('EN ANGLAIS : « simulated »', async () => {
    setLang('en');
    const dom = await monter(<Essaim {...proprietesVue([ouvriere()])} />);
    const puce = [...dom.querySelectorAll('.es-chip')].map((e) => e.textContent);
    expect(puce).toContain(EN);
    expect(puce).not.toContain(FR);
  });
});
