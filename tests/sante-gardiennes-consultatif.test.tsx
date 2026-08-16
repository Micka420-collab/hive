// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES GARDIENNES EN CONSULTATIF — l'écart entre « creuses » et « refusées ».
//
// ─── CE QUE CET AVERTISSEMENT DIT ────────────────────────────────────────────
//
// Les Gardiennes inspectent les productions avant qu'elles entrent dans le
// miel. En mode STRICT, une production creuse est refusée. En mode CONSULTATIF,
// elles annotent et laissent passer — c'est le mode par défaut, et c'est celui
// où l'écart compte :
//
//     {v.mode === 'consultatif' && v.verdicts.hollow > v.refusees && (
//       <p className="ga-avertissement">
//         {v.verdicts.hollow} production(s) creuse(s) sont entrées dans le miel…
//
// Le commentaire du code le dit : « en consultatif, l'écart entre "creuses" et
// "refusées" EST l'information : ces productions-là sont entrées dans le miel ».
//
// C'est la seule ligne de l'écran qui annonce que du travail non conforme a été
// LIVRÉ. Sans elle, les tuiles affichent bien « 4 creuses », mais rien ne dit
// que ces quatre-là sont passées — on lit un compteur, pas une conséquence.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Trois gardes, chaque mutant vérifié posé, suite entière verte à chaque fois —
// 277 fichiers, 4 125 tests. `gardiennes-vue` défend le NOM du nœud accusé et
// ses griefs ; l'avertissement lui-même n'était joué nulle part.
//
//     v.mode === 'consultatif' && …   →  (le mode n'est plus regardé)
//     v.verdicts.hollow > v.refusees  →  >= v.refusees
//     v.inspections === 0             →  (l'état vide ne sort plus jamais)
//
// ─── LA BORNE, ÉCRITE DÈS LE DÉPART (§ 9 trigicenties) ───────────────────────
//
// `hollow > refusees` avec `>=` n'est pas une nuance : au repos, une ruche
// neuve a `hollow = 0` et `refusees = 0`. `0 >= 0` est vrai — l'écran
// annoncerait « 0 production(s) creuse(s) sont entrées dans le miel » en
// PERMANENCE, dès la première inspection et pour toujours.
//
// C'est exactement la panne du seuil de ventilation du même écran : une alarme
// toujours allumée n'est pas une alarme de plus, c'est la fin de l'alarme.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { VueGardiennes } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGardiennes: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
}));

import { fetchGardiennes } from '../dashboard/src/api';
import Sante from '../dashboard/src/views/Sante';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchGardiennes).mockResolvedValue(null as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

/**
 * Un relevé des Gardiennes. `inspections` suit les verdicts par défaut : un
 * relevé qui compte des creuses sans avoir rien inspecté serait incohérent, et
 * le banc mesurerait un état que le serveur ne produit jamais.
 */
function gardiennes(
  mode: VueGardiennes['mode'],
  hollow: number,
  refusees: number,
  inspections = hollow + refusees + 1,
): VueGardiennes {
  return {
    version: 1,
    inspections,
    verdicts: { clean: 1, suspect: 0, hollow },
    refusees,
    griefs: [],
    recentes: [],
    mode,
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

/** L'avertissement, désigné par SA classe — le texte varie avec le compte. */
const avertissement = (dom: HTMLElement): HTMLElement | null =>
  dom.querySelector<HTMLElement>('.ga-avertissement');

/** Remonte un écran neuf sur un autre relevé, sans laisser le précédent. */
async function remonterAvec(v: VueGardiennes | null): Promise<HTMLElement> {
  act(() => racine?.unmount());
  conteneur?.remove();
  vi.mocked(fetchGardiennes).mockResolvedValue(v as never);
  return monter();
}

describe('l’écart que seul le mode consultatif rend visible', () => {
  it('LE PANNEAU REND SES COMPTES — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Tout ce fichier cherche — ou refuse — un paragraphe dans ce panneau. Si
    // le panneau ne se rendait pas du tout, les trois cas de silence seraient
    // verts en constatant une absence qui n'a rien à voir avec la garde.
    vi.mocked(fetchGardiennes).mockResolvedValue(gardiennes('consultatif', 4, 0) as never);
    const dom = await monter();

    expect(dom.textContent, 'le panneau des Gardiennes ne se rend pas').toContain('Les Gardiennes');
    expect(dom.querySelector('.ga-tuiles'), 'les tuiles de verdicts manquent').not.toBeNull();
  });

  it('EN CONSULTATIF, LES CREUSES PASSÉES SONT ANNONCÉES', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Quatre creuses, aucune refusée : ces quatre productions sont ENTRÉES
    // dans le miel. Les tuiles le comptent, mais compter n'est pas alerter —
    // cette ligne est la seule qui dise la conséquence, et qui nomme le
    // réglage à changer.
    vi.mocked(fetchGardiennes).mockResolvedValue(gardiennes('consultatif', 4, 0) as never);
    const dom = await monter();

    const p = avertissement(dom);
    expect(
      p,
      'des productions creuses sont entrées dans le miel sans que rien le dise',
    ).not.toBeNull();
    expect(p?.textContent, 'l’avertissement ne dit pas COMBIEN').toContain('4');
    expect(p?.textContent, 'l’avertissement ne dit pas quoi changer').toContain('strict');
  });

  it('EN STRICT, PAS D’AVERTISSEMENT — les creuses ont été refusées', async () => {
    // ─── LE MODE EST LA MOITIÉ DE LA GARDE ─────────────────────────────────
    //
    // Mêmes chiffres exactement — 4 creuses, 0 refusée — mais en mode strict.
    // L'entrée est choisie pour cela : seul le MODE change entre ce cas et le
    // précédent, donc seul le test du mode peut les départager.
    //
    // (Un tel relevé est celui d'une ruche qui vient de passer en strict : les
    // creuses comptées l'ont été avant la bascule.)
    const dom = await remonterAvec(gardiennes('strict', 4, 0));

    expect(
      avertissement(dom),
      'l’écran accuse les Gardiennes de laisser passer alors qu’elles refusent',
    ).toBeNull();
  });

  it('QUAND TOUT CE QUI EST CREUX A ÉTÉ REFUSÉ, RIEN N’EST ANNONCÉ', async () => {
    // L'autre monde du même chiffre : `hollow` n'est pas nul, mais `refusees`
    // l'égale — rien n'est passé, il n'y a rien à signaler.
    const dom = await remonterAvec(gardiennes('consultatif', 3, 3));

    expect(
      avertissement(dom),
      'l’écran annonce des creuses entrées dans le miel alors que toutes ont été refusées',
    ).toBeNull();
  });

  it('UNE RUCHE AU REPOS NE S’ALARME PAS — 0 creuse, 0 refusée', async () => {
    // ─── LA BORNE (§ 9 trigicenties) ───────────────────────────────────────
    //
    // C'est le cas qui tue `>=`. Au repos, `hollow` et `refusees` valent tous
    // deux 0 : avec `>=`, l'écran annoncerait « 0 production(s) creuse(s) sont
    // entrées dans le miel » en PERMANENCE, sur toute ruche, pour toujours.
    //
    // Les cas de sens ne le voient pas : `4 > 0` et `4 >= 0` sont vrais tous
    // les deux. Seule la borne départage.
    const dom = await remonterAvec(gardiennes('consultatif', 0, 0));

    expect(
      avertissement(dom),
      'une ruche au repos annonce des creuses : l’alarme est allumée en permanence, donc morte',
    ).toBeNull();
  });

  it('RIEN D’INSPECTÉ SE DIT — plutôt qu’un panneau de zéros muet', async () => {
    // L'état vide a son propre message. Sans lui, une ruche neuve afficherait
    // quatre tuiles à zéro : l'utilisateur ne peut pas distinguer « les
    // Gardiennes n'ont rien vu » de « les Gardiennes ne fonctionnent pas ».
    const dom = await remonterAvec(gardiennes('consultatif', 0, 0, 0));

    expect(dom.textContent, 'l’écran ne dit pas qu’il n’a rien inspecté').toContain(
      'Rien d’inspecté',
    );
    expect(
      dom.querySelector('.ga-tuiles'),
      'des tuiles de zéros s’affichent alors que rien n’a été inspecté',
    ).toBeNull();
  });
});
