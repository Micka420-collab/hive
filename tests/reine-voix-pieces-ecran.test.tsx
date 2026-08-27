// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE MICRO ET LES PIÈCES JOINTES, À L'ÉCRAN.
//
// ─── LE PARTAGE DU TRAVAIL ───────────────────────────────────────────────────
//
// `reine-voix` et `reine-extraire` ont chacun leurs bancs — 53 cas, décor Web
// Speech posé à la main, `pdfjs` et `mammoth` doublés. Ils tiennent la RÈGLE.
// Ce fichier-ci ne les rejoue pas : il tient le CÂBLAGE, c'est-à-dire tout ce
// que `Reine.tsx` décide entre le clic et l'appel. Les deux modules sont donc
// doublés ici, et c'est délibéré : un banc d'écran qui rejouerait l'extraction
// d'un PDF mesurerait pdfjs, pas la vue.
//
// La vue est arrivée avec 211 lignes neuves — micro, voix, pièces — et pas un
// banc les touchait. Le cliquet de couverture l'a dit avant moi.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { PieceJointeTexte } from '../src/shared/reine-pieces';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

/** Ce que le faux module vocal a reçu — l'ordre compte. */
let ecouteDispo = true;
let paroleDispo = true;
let dictees: Array<{
  lang: string;
  onTexte: (t: string, f: boolean) => void;
  onEtat: (e: string) => void;
  onErreur?: (m: string) => void;
}> = [];
let arrets = 0;
let dits: Array<{ texte: string; lang: string }> = [];

vi.mock('../dashboard/src/reine-voix', () => ({
  voixEcouteDisponible: () => ecouteDispo,
  voixParoleDisponible: () => paroleDispo,
  demarrerEcoute: (opts: (typeof dictees)[number]) => {
    dictees.push(opts);
    // Le navigateur annonce l'écoute AVANT de rendre la session.
    opts.onEtat('ecoute');
    return {
      stop() {
        arrets++;
        opts.onEtat('inactif');
      },
    };
  },
  parlerTexte: (texte: string, lang: string) => dits.push({ texte, lang }),
  couperParole: () => {},
}));

/** Ce que l'extraction rendra — un banc le pose avant de joindre. */
let extraits: PieceJointeTexte[] = [];
let extractionJette = false;

vi.mock('../dashboard/src/reine-extraire', () => ({
  extrairePiece: (f: File) => {
    if (extractionJette) return Promise.reject(new Error('lecture impossible'));
    const trouve = extraits.find((p) => p.nom === f.name);
    return Promise.resolve(
      trouve ?? { nom: f.name, genre: 'texte', octets: f.size, texte: 'contenu' },
    );
  },
}));

import Reine from '../dashboard/src/views/Reine';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const INSTANTANE = {
  projects: [{ id: 'p1', name: 'Rucher' }],
  nodes: [],
  tasks: [],
  tasksTotal: 0,
} as unknown as StateSnapshot;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
  ecouteDispo = true;
  paroleDispo = true;
  dictees = [];
  arrets = 0;
  dits = [];
  extraits = [];
  extractionJette = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ mode: 'off', actif: false }),
      } as Response),
    ),
  );
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.unstubAllGlobals();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: INSTANTANE,
    events: [],
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Reine {...props} />));
  await act(async () => {});
  return conteneur;
}

async function cliquer(el: Element | null): Promise<void> {
  expect(el, 'la commande cliquée doit exister').toBeTruthy();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

const micro = (d: HTMLElement) => d.querySelector<HTMLButtonElement>('button.rn-mic');
const joindre = (d: HTMLElement) => d.querySelector<HTMLButtonElement>('button.rn-attach');
const champFichier = (d: HTMLElement) => d.querySelector<HTMLInputElement>('input.rn-file');
const erreur = (d: HTMLElement) => d.querySelector('.rn-piece-err')?.textContent ?? '';
const noms = (d: HTMLElement) =>
  [...d.querySelectorAll('.rn-piece-nom')].map((e) => e.textContent ?? '');

/** Pose des fichiers dans le champ caché et déclenche le `change` de React. */
async function deposer(dom: HTMLElement, fichiers: File[]): Promise<void> {
  const champ = champFichier(dom)!;
  Object.defineProperty(champ, 'files', { configurable: true, value: fichiers });
  await act(async () => {
    champ.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {});
}

describe('le bouton Joindre', () => {
  it('ouvre le sélecteur de fichiers — c’est tout ce qu’il fait', async () => {
    const dom = await monter();
    const champ = champFichier(dom)!;
    const ouvertures = vi.fn();
    champ.click = ouvertures;
    await cliquer(joindre(dom));
    expect(ouvertures).toHaveBeenCalledTimes(1);
  });

  it('un fichier lisible devient une pièce nommée', async () => {
    const dom = await monter();
    await deposer(dom, [new File(['bonjour'], 'notes.txt', { type: 'text/plain' })]);
    expect(noms(dom)).toEqual(['notes.txt']);
  });

  it('une vidéo est affichée AVEC son refus — jamais comme un document lu', async () => {
    extraits = [
      { nom: 'demo.mp4', genre: 'video', octets: 10, refus: 'La vidéo n’est pas transcrite.' },
    ];
    const dom = await monter();
    await deposer(dom, [new File(['x'], 'demo.mp4', { type: 'video/mp4' })]);
    expect(noms(dom)[0]).toContain('demo.mp4');
    expect(noms(dom)[0]).toContain('pas transcrite');
    // La classe distingue la pièce lue de la pièce refusée : sans elle, les deux
    // se ressemblent et l'on croit avoir joint un contenu qu'on n'a pas.
    expect(dom.querySelector('.rn-piece-warn'), 'la pièce refusée est marquée').toBeTruthy();
    expect(dom.querySelector('.rn-piece-ok')).toBeNull();
  });

  it('la croix retire LA pièce visée, et elle seule', async () => {
    const dom = await monter();
    await deposer(dom, [
      new File(['a'], 'un.txt', { type: 'text/plain' }),
      new File(['b'], 'deux.txt', { type: 'text/plain' }),
    ]);
    expect(noms(dom)).toEqual(['un.txt', 'deux.txt']);
    await cliquer(dom.querySelectorAll('button.rn-piece-x')[0]!);
    expect(noms(dom)).toEqual(['deux.txt']);
  });

  it('au-delà de six pièces, les suivantes ne s’empilent pas', async () => {
    const dom = await monter();
    await deposer(
      dom,
      Array.from({ length: 8 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' })),
    );
    expect(noms(dom)).toHaveLength(6);
  });

  it('une extraction qui jette laisse un message, pas un écran muet', async () => {
    extractionJette = true;
    const dom = await monter();
    await deposer(dom, [new File(['x'], 'casse.txt', { type: 'text/plain' })]);
    expect(erreur(dom)).toContain('Impossible de lire');
    expect(noms(dom)).toEqual([]);
  });
});

describe('le micro', () => {
  it('sans dictée dans ce navigateur, le clic DIT pourquoi', async () => {
    ecouteDispo = false;
    const dom = await monter();
    await cliquer(micro(dom));
    expect(erreur(dom)).toContain('Chrome');
    expect(dictees, 'aucune écoute ne doit démarrer').toHaveLength(0);
  });

  it('le premier clic démarre l’écoute, dans la langue de l’écran', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    expect(dictees).toHaveLength(1);
    expect(dictees[0]!.lang).toBe('fr-FR');
    expect(micro(dom)!.getAttribute('aria-pressed')).toBe('true');
  });

  it('en anglais, l’écoute est demandée en en-US', async () => {
    setLang('en');
    const dom = await monter();
    await cliquer(micro(dom));
    expect(dictees[0]!.lang).toBe('en-US');
  });

  it('le second clic ARRÊTE l’écoute — le bouton est une bascule', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    await cliquer(micro(dom));
    expect(arrets).toBe(1);
    expect(micro(dom)!.getAttribute('aria-pressed')).toBe('false');
  });

  it('le texte PARTIEL s’affiche à part, sans entrer dans le brouillon', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    await act(async () => dictees[0]!.onTexte('bonjour la ru', false));
    expect(dom.querySelector('.rn-interim')?.textContent).toBe('bonjour la ru');
    expect(dom.querySelector<HTMLTextAreaElement>('textarea.rn-input')!.value).toBe('');
  });

  it('le texte FINAL entre dans le brouillon et efface le partiel', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    await act(async () => dictees[0]!.onTexte('bonjour la ruche', true));
    expect(dom.querySelector<HTMLTextAreaElement>('textarea.rn-input')!.value).toBe(
      'bonjour la ruche',
    );
    expect(dom.querySelector('.rn-interim')).toBeNull();
  });

  it('deux passages finaux se recollent au lieu de s’écraser', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    await act(async () => dictees[0]!.onTexte('bonjour', true));
    await act(async () => dictees[0]!.onTexte('la ruche', true));
    expect(dom.querySelector<HTMLTextAreaElement>('textarea.rn-input')!.value).toBe(
      'bonjour la ruche',
    );
  });

  it('un micro refusé remonte un message à l’écran', async () => {
    const dom = await monter();
    await cliquer(micro(dom));
    await act(async () => dictees[0]!.onErreur?.('not-allowed'));
    expect(erreur(dom)).toContain('Micro refusé');
  });
});
