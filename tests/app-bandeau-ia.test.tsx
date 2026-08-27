// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE BANDEAU « SUR QUELLE IA » — rendu, pas seulement calculé.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Une capture d'écran de l'utilisateur : la Reine répond « 0 nœud(s) actif(s) ·
// taux de succès global 100 % », le voyant de l'en-tête est VERT, et rien ne
// travaille. Le voyant vert disait vrai — le navigateur parlait bien au hub.
// Il ne disait simplement pas la chose qu'on lui demandait.
//
// `agents-connectes.ts` tient la RÈGLE (module pur, ses propres bancs). Ce
// fichier-ci tient l'AFFICHAGE : que l'état calculé arrive vraiment à l'écran,
// et qu'il change quand l'essaim change.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode, StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
  fetchSauvegardes: vi.fn(() => Promise.resolve({ sauvegardes: [] })),
  fetchCerveau: vi.fn(() => Promise.resolve(null)),
  fetchResults: vi.fn(() => Promise.resolve({ results: [] })),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => Promise.resolve(null)),
  fetchMergeResult: vi.fn(() => Promise.resolve(null)),
  fetchEssaim: vi.fn(() => Promise.reject(new Error('hors sujet pour ce banc'))),
  fetchAtelier: vi.fn(() => Promise.resolve({ mode: 'off', actif: false })),
}));

import { connectFeed } from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let poignees: FeedHandlers | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  location.hash = '';
  poignees = null;
  vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
    poignees = h;
    return { close: () => {} };
  });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  location.hash = '';
});

function noeud(agentType: string, status: string, id: string): HiveNode {
  return {
    id,
    name: id,
    ownerName: 'moi',
    agentType,
    maxConcurrency: 1,
    running: 0,
    status: status as HiveNode['status'],
    lastSeen: 1,
  };
}

/** Monte l'App, puis pousse l'essaim voulu par le flux — comme le hub le fait. */
async function monterAvec(noeuds: HiveNode[]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<App />));
  await act(async () => {});
  const on = poignees;
  expect(on, 'le flux doit être branché au montage').toBeTruthy();
  await act(async () => {
    on!.onState({
      projects: [],
      nodes: noeuds,
      tasks: [],
      events: [],
    } as unknown as StateSnapshot);
  });
  await act(async () => {});
  return conteneur!;
}

/** Le MOT du bandeau, ancré sur son propre repère — pas sur le texte de l'en-tête. */
function mot(dom: HTMLElement): string {
  const el = dom.querySelector('[data-testid="mc-ia-mot"]');
  expect(el, 'le bandeau doit être rendu').toBeTruthy();
  return el!.textContent ?? '';
}

function classe(dom: HTMLElement): string {
  return dom.querySelector('[data-testid="mc-ia"]')!.className;
}

describe('le bandeau dit sur quelle IA la ruche est branchée', () => {
  it('aucune ouvrière inscrite : le bandeau le DIT, en rouge', async () => {
    const dom = await monterAvec([]);
    expect(mot(dom)).toBe('aucune ouvrière');
    expect(classe(dom)).toContain('mc-ia-aucun_noeud');
  });

  it('une ouvrière inscrite mais muette : distincte de « aucune ouvrière »', async () => {
    const dom = await monterAvec([noeud('claude-code', 'offline', 'n1')]);
    expect(mot(dom)).toBe('aucune ouvrière en ligne');
    expect(classe(dom)).toContain('mc-ia-aucune_ia');
  });

  it('un shell en ligne : la ruche répond, et le bandeau prévient que rien n’est réel', async () => {
    const dom = await monterAvec([noeud('shell', 'online', 'n1')]);
    expect(mot(dom)).toBe('simulé — aucune IA');
    expect(classe(dom)).toContain('mc-ia-simulee');
  });

  it('Claude Code en ligne : son NOM s’affiche, pas la clé de protocole', async () => {
    const dom = await monterAvec([noeud('claude-code', 'online', 'n1')]);
    expect(mot(dom)).toBe('Claude Code');
    expect(classe(dom)).toContain('mc-ia-reelle');
  });

  it('plusieurs IA réelles : toutes nommées', async () => {
    const dom = await monterAvec([
      noeud('claude-code', 'online', 'n1'),
      noeud('codex', 'online', 'n2'),
    ]);
    expect(mot(dom)).toBe('Claude Code · Codex');
  });

  it('un shell À CÔTÉ d’une vraie IA ne se glisse pas dans les noms', async () => {
    const dom = await monterAvec([
      noeud('shell', 'online', 'n1'),
      noeud('claude-code', 'online', 'n2'),
    ]);
    expect(mot(dom)).toBe('Claude Code');
    expect(classe(dom)).toContain('mc-ia-reelle');
  });

  it('une IA dont tous les nœuds sont MUETS n’est pas nommée parmi celles qui travaillent', async () => {
    // La nue du balayage : `a.enLigne > 0` muté en `>= 0`. L'état reste
    // « reelle » — Claude Code est bien en ligne — mais Codex, dont pas un
    // nœud ne répond, se glisserait dans le bandeau VERT. Le bandeau dirait
    // alors qu'une IA travaille alors qu'elle est éteinte : exactement le
    // mensonge que ce voyant existe pour empêcher.
    const dom = await monterAvec([
      noeud('claude-code', 'online', 'n1'),
      noeud('codex', 'offline', 'n2'),
    ]);
    expect(classe(dom)).toContain('mc-ia-reelle');
    expect(mot(dom)).toBe('Claude Code');
    expect(mot(dom)).not.toContain('Codex');
  });

  it('l’info-bulle du cas rouge NOMME la commande à taper', async () => {
    const dom = await monterAvec([]);
    const el = dom.querySelector('[data-testid="mc-ia"]') as HTMLElement;
    expect(el.title).toContain('npm run node');
  });

  it('le bandeau SUIT l’essaim : une ouvrière qui arrive le fait passer au vert', async () => {
    const dom = await monterAvec([]);
    expect(classe(dom)).toContain('mc-ia-aucun_noeud');
    const on = poignees!;
    await act(async () => {
      on.onState({
        projects: [],
        nodes: [noeud('claude-code', 'online', 'n1')],
        tasks: [],
        events: [],
      } as unknown as StateSnapshot);
    });
    expect(mot(dom)).toBe('Claude Code');
    expect(classe(dom)).toContain('mc-ia-reelle');
  });

  it('en anglais, le cas rouge parle anglais', async () => {
    setLang('en');
    const dom = await monterAvec([]);
    expect(mot(dom)).toBe('no worker');
  });
});
