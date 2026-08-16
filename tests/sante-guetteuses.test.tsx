// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES GUETTEUSES — la gravité de ce qu'on a vu passer sur les leurres.
//
// ─── CE QUE LE PANNEAU PROMET, EN TOUTES LETTRES ─────────────────────────────
//
// Le fichier énonce lui-même ses deux règles d'affichage :
//
//     1. LE CALME S'AFFICHE AUSSI. Un panneau qui n'apparaît qu'en cas
//        d'alerte ne dit jamais « la surveillance fonctionne, et elle ne voit
//        rien » — et on finit par ne plus savoir si elle marche.
//     2. LE CONSEIL EST AUSSI GROS QUE L'ALERTE. Dire « on vous sonde » sans
//        dire quoi faire ne produit que de l'inquiétude, qu'on apprend à
//        ignorer.
//
// Une règle écrite dans un commentaire n'est pas une garde (§ 9 tervicicenties,
// § 9 sexvicicenties). Celles-ci en ont une maintenant.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// `vues-sentinelles` défend déjà `{v.derniers.length > 0 && …}` — la liste
// n'existe que s'il y a des passages. Le reste du panneau ne l'était pas :
//
//     NIVEAU_GUET[v?.niveau ?? 'calme']   →  NIVEAU_GUET.calme
//     v.derniers.slice(0, 8)              →  v.derniers   (plus de plafond)
//     v.derniers.slice(0, 8)              →  slice(0, 9)  (le plafond décalé)
//     v.appats.length > 0 && …            →  >= 0
//
// ─── LA GRAVITÉ EST TOUT CE QUE CE PANNEAU APPORTE ───────────────────────────
//
// `GET /api/guet` existait avant l'écran, et le commentaire du code dit ce que
// l'écran ajoute : « un mécanisme de détection sans écran est pire qu'une
// absence de détection : on croit surveillé ce qui ne l'est pas ». Ce que
// l'écran ajoute au journal brut, c'est le NIVEAU — trois mots, trois tons,
// trois icônes.
//
// Muté, tout devient « Rien à signaler 🐝 » : un balayage complet de la ruche
// par un outil automatique s'affiche avec l'habit du calme. Le panneau
// continue de fonctionner, il compte toujours ses passages — il ment
// seulement sur leur gravité, ce qui est exactement la panne qu'il existe pour
// empêcher.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { NiveauGuet } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGardiennes: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
}));

import { fetchGuet } from '../dashboard/src/api';
import Sante from '../dashboard/src/views/Sante';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchGuet).mockResolvedValue(null as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

/** Un passage sur un leurre — `i` distingue les chemins pour qu'on les compte. */
const passage = (i: number) => ({
  source: '203.0.113.7',
  chemin: `/leurre-${i}`,
  appat: 'env',
  quand: 1_700_000_000_000 + i * 1_000,
});

/** Un relevé du Guet. `passages` suit la liste : un relevé incohérent ne se produit pas. */
function guet(niveau: NiveauGuet, derniers = 0, appats: string[] = []): Record<string, unknown> {
  return {
    niveau,
    passages: derniers,
    sources: derniers > 0 ? 1 : 0,
    appats,
    conseil: 'Ne rien exposer de plus.',
    derniers: Array.from({ length: derniers }, (_, i) => passage(i)),
  };
}

async function monter(): Promise<HTMLElement> {
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
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Sante {...props} />));
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

/** Remonte un écran neuf sur un autre relevé, sans laisser le précédent. */
async function remonterAvec(v: Record<string, unknown>): Promise<HTMLElement> {
  act(() => racine?.unmount());
  conteneur?.remove();
  vi.mocked(fetchGuet).mockResolvedValue(v as never);
  return monter();
}

/** L'habit du verdict — c'est lui qui porte la gravité à l'œil. */
const verdict = (dom: HTMLElement): HTMLElement | null =>
  dom.querySelector<HTMLElement>('.gu-verdict');

describe('les Guetteuses disent la GRAVITÉ, pas seulement le compte', () => {
  it('UN RENIFLAGE S’ANNONCE, AVEC SON CONSEIL — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Il éprouve du même coup la règle 2 du fichier : le conseil est rendu.
    // Sans lui, les cas de gravité seraient verts sur un panneau absent.
    vi.mocked(fetchGuet).mockResolvedValue(guet('reniflage', 2, ['/.env']) as never);
    const dom = await monter();

    expect(dom.textContent, 'le panneau des Guetteuses ne se rend pas').toContain('Les Guetteuses');
    expect(verdict(dom)?.textContent, 'le niveau n’est pas nommé').toContain('On vous regarde');
    expect(
      dom.querySelector('.gu-conseil')?.textContent,
      'le conseil manque : on inquiète sans dire quoi faire',
    ).toContain('Ne rien exposer');
  });

  it('UN BALAYAGE NE PORTE PAS L’HABIT DU CALME', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // C'est tout ce que l'écran ajoute au journal brut : le niveau. Muté,
    // le panneau compte toujours ses passages mais les annonce tous « Rien à
    // signaler 🐝 » — un outil qui déroule sa liste sur la ruche s'affiche
    // avec l'habit du repos.
    //
    // On mesure les TROIS porteurs de la gravité, parce qu'un seul pourrait
    // survivre à la mutation par hasard : le ton, l'icône, le mot.
    const dom = await remonterAvec(guet('balayage', 3, ['/.git/config']));

    const v = verdict(dom);
    expect(v?.className, 'le ton du balayage est celui du calme').toContain('ton-brulant');
    expect(v?.className, 'le balayage porte encore le ton calme').not.toContain('ton-calme');
    expect(v?.textContent, 'l’icône d’alerte manque').toContain('🚨');
    expect(v?.textContent, 'le niveau n’est pas nommé').toContain('Un outil déroule sa liste');
  });

  it('LE CALME S’AFFICHE AUSSI — la règle 1, écrite dans le fichier', async () => {
    // ─── LE CAS QUI NE BOUGE PAS (§ 9 octovicicenties) ─────────────────────
    //
    // « Un panneau qui n'apparaît qu'en cas d'alerte ne dit jamais "la
    // surveillance fonctionne, et elle ne voit rien" — et on finit par ne plus
    // savoir si elle marche. »
    //
    // Ce cas mesure aussi que le précédent mesure quelque chose : si TOUT
    // affichait « brulant », le cas du balayage serait vert pour rien.
    const dom = await remonterAvec(guet('calme', 0));

    const v = verdict(dom);
    expect(v, 'au calme, le panneau disparaît — on ne sait plus s’il veille').not.toBeNull();
    expect(v?.className, 'le calme porte un ton d’alerte').toContain('ton-calme');
    expect(v?.textContent, 'le calme ne se dit pas').toContain('Rien à signaler');
  });

  it('LA LISTE S’ARRÊTE À HUIT — un balayage en compte des centaines', async () => {
    // ─── LE PLAFOND, ET SA BORNE (§ 9 trigicenties) ────────────────────────
    //
    // NEUF passages, pas dix ni cent : c'est la seule entrée qui départage les
    // trois versions d'un coup.
    //
    //     slice(0, 8)  → 8   (juste)
    //     slice(0, 9)  → 9   (le plafond décalé d'un cran)
    //     pas de slice → 9   (plus de plafond du tout)
    //
    // Avec huit passages, les trois rendraient huit lignes et le banc
    // bénirait les deux mutations. Le plafond compte : un balayage réel
    // déroule des centaines de chemins, et une liste sans fin pousse le
    // conseil — la seule chose actionnable — hors de l'écran.
    const dom = await remonterAvec(guet('balayage', 9));

    const lignes = dom.querySelectorAll('.gu-liste li');
    expect(lignes, 'la liste ne s’arrête pas à huit').toHaveLength(8);
    expect(
      dom.querySelector('.gu-liste')?.textContent,
      'la liste ne montre pas les passages les plus RÉCENTS d’abord',
    ).toContain('/leurre-0');
  });

  it('LES LEURRES TOUCHÉS SE NOMMENT — et rien ne se dit quand il n’y en a pas', async () => {
    // Les deux mondes. `appats.length > 0` muté en `>= 0` ajouterait un
    // séparateur « · » suivi de rien du tout, en permanence.
    const avec = await remonterAvec(guet('reniflage', 1, ['/.env', '/.git/config']));
    const chiffres = avec.querySelector('.gu-chiffres')?.textContent ?? '';
    expect(chiffres, 'les leurres touchés ne sont pas nommés').toContain('/.env');
    expect(chiffres, 'le second leurre manque').toContain('/.git/config');

    const sans = await remonterAvec(guet('calme', 0, []));
    expect(
      (sans.querySelector('.gu-chiffres')?.textContent ?? '').trimEnd().endsWith('·'),
      'un séparateur pend dans le vide, sans rien derrière',
    ).toBe(false);
  });
});
