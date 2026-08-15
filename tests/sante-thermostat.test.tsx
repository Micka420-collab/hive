// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE THERMOSTAT DE LA RUCHE — deux vérités à l'écran, et l'écart entre elles.
//
// ─── CE QUE LE PANNEAU DIT, ET POURQUOI IL EXISTE ────────────────────────────
//
// La Thermorégulation affiche VOLONTAIREMENT deux états qui peuvent se
// contredire, et le commentaire du code dit pourquoi :
//
//   · la LECTURE instantanée (`instantane.bande`) — où en est le thermomètre ;
//   · l'état APPLIQUÉ (`applique.bande` / `applique.facteur`), HYSTÉRÉSÉ : il
//     ne suit la lecture qu'après un second relevé concordant.
//
//     « Leur divergence est la chose la plus utile à montrer — elle explique
//       pourquoi la concurrence n'a pas encore bougé alors que le thermomètre,
//       lui, a déjà grimpé. »
//
// C'est donc le seul écran du produit où AFFICHER LA MAUVAISE DES DEUX est une
// panne complète : l'opérateur lit « normale », voit la concurrence à plein
// régime, et conclut que tout va bien pendant que la ruche surchauffe.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// Quatre gardes, mutées ENSEMBLE, chaque mutant vérifié posé, suite entière
// verte — 276 fichiers, 4 120 tests. Aucune n'était défendue :
//
//     const diverge = lecture.bande !== regime.bande;   →  = false;
//     b === lecture.bande ? 'on' : undefined            →  b === regime.bande
//     applique.facteur < 1 ? 'panel-count warn' : …     →  'panel-count'
//     successPct < 50 ? 'tile danger' : 'tile'          →  'tile'
//
// Les deux dernières sont des SEUILS : ce banc épingle aussi leur borne, pas
// seulement leur sens — `< 1` n'est pas `<= 1`, et `< 50` n'est pas `<= 50`.
// Une garde de seuil dont on ne mesure que la direction laisse passer le mutant
// qui décale la borne d'un cran, et c'est celui qui se produit vraiment.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import type { BandeThermo } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGardiennes: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
}));

import { fetchPulse, fetchThermo } from '../dashboard/src/api';
import Sante from '../dashboard/src/views/Sante';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchPulse).mockResolvedValue(null as never);
  vi.mocked(fetchThermo).mockResolvedValue(null as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

/** Un relevé du thermostat : la lecture d'un côté, le régime appliqué de l'autre. */
function thermo(
  lue: BandeThermo,
  appliquee: BandeThermo,
  facteur = 1,
  temperature = 50,
): Record<string, unknown> {
  return {
    instantane: {
      temperature,
      bande: lue,
      facteur,
      signaux: { echecs: 0, retries: 0, refusInfra: 0, succes: 0, total: 0 },
    },
    applique: { bande: appliquee, facteur },
  };
}

/** Un pouls dont seul le taux de succès nous intéresse ici. */
function pouls(successRate: number): Record<string, unknown> {
  return {
    totalDone: 1,
    totalFailed: 1,
    successRate,
    activeNodes: 1,
    latency: { count: 1, p50: 10, p95: 20, avg: 12, max: 30 },
    throughput: [{ hourStart: 1_700_000_000_000, done: 1, failed: 1 }],
    spanMs: 3_600_000,
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

/** La bande ALLUMÉE sur l'échelle — c'est là que l'œil se pose. */
const bandeAllumee = (dom: HTMLElement): string =>
  dom.querySelector('.es-thermo-scale .on')?.textContent?.trim() ?? '';

/**
 * Le compteur du panneau Thermorégulation, désigné par SON titre.
 * `.panel-count` n'est pas unique dans la vue (les Signes vitaux en portent un) :
 * un repère non unique jugerait le mauvais élément (§ 2 duodecies).
 */
function compteurThermo(dom: HTMLElement): HTMLElement | null {
  const carte = [...dom.querySelectorAll('section.card')].find((s) =>
    s.querySelector('h2')?.textContent?.includes('Thermorégulation'),
  );
  return carte?.querySelector<HTMLElement>('.panel-count') ?? null;
}

/** La tuile du taux de succès, désignée par son libellé — pas par son rang. */
function tuileSucces(dom: HTMLElement): HTMLElement {
  const tuile = [...dom.querySelectorAll('.tile')].find((e) =>
    e.textContent?.includes('Taux de succès'),
  );
  if (!tuile) throw new Error('la tuile du taux de succès est introuvable');
  return tuile as HTMLElement;
}

describe('le thermostat montre la LECTURE, pas le régime appliqué', () => {
  it('LA JAUGE REND LE RELEVÉ — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    //
    // Tout ce fichier lit la bande allumée et le bandeau de divergence. Si le
    // panneau ne se rendait pas du tout, « la divergence est annoncée » serait
    // vert en comparant deux absences.
    vi.mocked(fetchThermo).mockResolvedValue(thermo('chaude', 'chaude', 1, 72) as never);
    const dom = await monter();

    expect(dom.textContent, 'le panneau Thermorégulation ne se rend pas').toContain(
      'Thermorégulation',
    );
    expect(dom.textContent, 'la température n’est pas affichée').toContain('72°');
    expect(bandeAllumee(dom), 'aucune bande n’est allumée sur l’échelle').toBe('chaude');
  });

  it('L’ÉCHELLE MARQUE LA LECTURE, JAMAIS LE RÉGIME APPLIQUÉ', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // L'entrée qui départage : les deux bandes DIFFÈRENT. Sur un relevé où
    // lecture et régime concordent, les deux versions allument la même case et
    // le banc bénirait la mutation.
    //
    // Le curseur de l'échelle dit « où en est la ruche MAINTENANT ». S'il
    // affichait le régime appliqué, il montrerait « normale » sur une ruche en
    // surchauffe — exactement l'instant que l'hystérésis crée, et exactement
    // celui où l'opérateur a besoin de savoir.
    vi.mocked(fetchThermo).mockResolvedValue(thermo('surchauffe', 'normale', 0.5, 91) as never);
    const dom = await monter();

    expect(
      bandeAllumee(dom),
      'l’échelle allume le régime APPLIQUÉ : la ruche surchauffe et l’écran dit « normale »',
    ).toBe('surchauffe');
  });

  it('LA DIVERGENCE EST ANNONCÉE — et elle se tait quand les deux concordent', async () => {
    // ─── LES DEUX MONDES, DANS LES DEUX SENS (§ 9 octovicicenties) ─────────
    //
    // Un banc qui vérifierait seulement « le bandeau apparaît » resterait vert
    // sur un bandeau affiché EN PERMANENCE — qui ne dirait plus rien du tout.
    // On mesure donc aussi le silence.
    vi.mocked(fetchThermo).mockResolvedValue(thermo('surchauffe', 'normale', 0.5, 91) as never);
    let dom = await monter();

    expect(
      dom.querySelector('.es-thermo-pending'),
      'la confirmation en cours n’est pas signalée : la concurrence semble figée sans raison',
    ).not.toBeNull();
    expect(
      dom.querySelector('.es-thermo-note')?.textContent,
      'la note n’explique pas l’écart',
    ).toContain('hystérésis');

    // Et l'autre monde : lecture et régime d'accord, plus rien à signaler.
    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchThermo).mockResolvedValue(thermo('normale', 'normale', 1, 40) as never);
    dom = await monter();

    expect(
      dom.querySelector('.es-thermo-pending'),
      'le bandeau s’affiche alors que les deux états concordent — il ne veut plus rien dire',
    ).toBeNull();
  });
});

describe('les deux seuils de la Santé, bornes comprises', () => {
  it('LA VENTILATION EN COURS SE SIGNALE — et ×1 n’est PAS une ventilation', async () => {
    // ─── UN SEUIL SE MESURE À SA BORNE ─────────────────────────────────────
    //
    // `facteur < 1` : le compteur du panneau s'alarme quand la ruche a BRIDÉ la
    // concurrence. `facteur = 1`, c'est le plein régime — l'état normal, qui ne
    // doit alarmer personne.
    //
    // Sans le cas de la borne, le mutant `<= 1` survivrait : le panneau
    // porterait l'alarme en permanence, y compris au repos, et l'opérateur
    // apprendrait à ne plus la voir.
    vi.mocked(fetchThermo).mockResolvedValue(thermo('chaude', 'chaude', 0.5, 72) as never);
    let dom = await monter();
    expect(
      compteurThermo(dom)?.className,
      'la ruche bride la concurrence et rien ne le signale',
    ).toContain('warn');

    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchThermo).mockResolvedValue(thermo('normale', 'normale', 1, 40) as never);
    dom = await monter();
    expect(
      compteurThermo(dom)?.className,
      '×1 est le plein régime : l’alarme portée au repos ne veut plus rien dire',
    ).not.toContain('warn');
  });

  it('UN TAUX DE SUCCÈS EFFONDRÉ ROUGIT LA TUILE — et 50 % exactement ne rougit PAS', async () => {
    // ─── L'AUTRE SEUIL, ET SA BORNE ────────────────────────────────────────
    //
    // `successPct < 50` : c'est le seul chiffre qu'un opérateur balaie pour
    // savoir si la ruche va mal. Muté en `'tile'` constant, une ruche qui
    // échoue une fois sur deux garde l'habit des tuiles saines.
    //
    // Et 50 % exactement — une réussite sur deux — est la borne EXCLUE. Sans ce
    // second cas, `<= 50` survivrait.
    vi.mocked(fetchPulse).mockResolvedValue(pouls(0.49) as never);
    let dom = await monter();
    expect(
      tuileSucces(dom).className,
      'la ruche échoue plus d’une fois sur deux et la tuile reste sereine',
    ).toContain('danger');

    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchPulse).mockResolvedValue(pouls(0.5) as never);
    dom = await monter();
    expect(
      tuileSucces(dom).className,
      '50 % est la borne EXCLUE : la faire rougir déplace l’alarme d’un cran',
    ).not.toContain('danger');
  });
});
