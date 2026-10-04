// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// « POURQUOI CE WORKER, CE MODÈLE » — rendu dans le tiroir d'une tâche.
//
// Le panneau montre la raison relue dans le journal : l'élu, le classement qui
// a décidé, le critère du nœud. Un modèle jamais essayé est dit « à explorer »,
// jamais noté 0 ; sans modèle déclaré, le panneau le DIT au lieu d'inventer une
// justification.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';
import type { AffectationVue } from '../src/shared/routage-vue';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRoutage: vi.fn(),
}));

import { fetchRoutage } from '../dashboard/src/api';
import { RoutageTache } from '../dashboard/src/RoutageTache';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const noeuds = [{ id: 'n-zzz', name: 'zzz' }] as unknown as HiveNode[];

/** Ce qu'une raison d'avant la v3 ne dit pas : ni harness, ni effort, ni intervalle, ni coût. */
const AVANT_V3 = { harness: null, effort: null, intervalle: null, cout: null } as const;

async function monter(affectations: AffectationVue[]): Promise<HTMLElement> {
  vi.mocked(fetchRoutage).mockResolvedValue({ taskId: 't', affectations });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<RoutageTache taskId="t" cle="k" nodes={noeuds} />));
  await act(async () => {});
  return conteneur;
}

describe('le panneau « Pourquoi ce Worker, ce modèle »', () => {
  it('MONTRE L’ÉLU, LE CLASSEMENT ET LE CRITÈRE DU NŒUD', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: 'opus',
        effort: null,
        decision: null,
        categorie: 'code',
        versionAiguillage: 2,
        raisonModele: [
          {
            modele: 'opus',
            essais: 3,
            enVol: 0,
            moyenne: 1,
            score: 1.9,
            aExplorer: false,
            ...AVANT_V3,
          },
          {
            modele: 'grok',
            essais: 0,
            enVol: 0,
            moyenne: null,
            score: null,
            aExplorer: true,
            ...AVANT_V3,
          },
        ],
        modelesEcartes: [],
        modelesReadmis: [],
        pheromone: null,
        course: null,
        critereNoeud: 'porteur_du_modele',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain('zzz');
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain(
      'porte le modèle élu',
    );
    expect(dom.querySelector('[data-testid="routage-modele"]')?.textContent).toContain('opus');
    const lignes = [...dom.querySelectorAll('.routage-rang tbody tr')];
    expect(lignes).toHaveLength(2);
    expect(lignes[0]?.classList.contains('elu'), 'l’élu est marqué').toBe(true);
    // Le modèle jamais essayé : « à explorer », et aucune moyenne affichée.
    expect(lignes[1]?.textContent).toContain('à explorer');
    expect(lignes[1]?.textContent).not.toMatch(/0\.00/);
  });

  it('UN MODÈLE RE-TENTÉ FAUTE D’ALTERNATIVE : LE PANNEAU LE DIT — son « à explorer » ne tait pas le plantage', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: 'fable',
        effort: null,
        decision: null,
        categorie: 'code',
        versionAiguillage: 2,
        raisonModele: [
          {
            modele: 'fable',
            essais: 0,
            enVol: 0,
            moyenne: null,
            score: null,
            aExplorer: true,
            ...AVANT_V3,
          },
        ],
        modelesEcartes: [],
        modelesReadmis: ['fable'],
        pheromone: null,
        course: null,
        critereNoeud: 'porteur_du_modele',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-readmis"]')?.textContent).toContain(
      'Déjà échoué sur cette tâche, re-tenté faute d’alternative dans la ruche : fable',
    );
    expect(dom.querySelector('[data-testid="routage-ecartes"]')).toBeNull();
  });

  it('UN MODÈLE JAMAIS JUGÉ MAIS EN VOL EST « À EXPLORER (n EN VOL) » — jamais « n essais, moyenne 0 »', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: 'opus',
        effort: null,
        decision: null,
        categorie: 'code',
        versionAiguillage: 2,
        raisonModele: [
          {
            modele: 'opus',
            essais: 4,
            enVol: 1,
            moyenne: 1,
            score: 1.7,
            aExplorer: false,
            ...AVANT_V3,
          },
          {
            modele: 'grok',
            essais: 0,
            enVol: 5,
            moyenne: null,
            score: 0.8,
            aExplorer: true,
            ...AVANT_V3,
          },
        ],
        modelesEcartes: [],
        modelesReadmis: [],
        pheromone: null,
        course: null,
        critereNoeud: 'porteur_du_modele',
      },
    ]);
    const [opus, grok] = [...dom.querySelectorAll('.routage-rang tbody tr')];
    expect(grok?.textContent).toContain('à explorer (5 en vol)');
    expect(grok?.textContent, 'aucune moyenne pour un modèle jamais jugé').not.toMatch(/0\.00/);
    // Le jugé et l'en-vol côte à côte : la moyenne est celle des verdicts.
    expect(opus?.textContent).toContain('4 + 1 en vol');
    expect(opus?.textContent).toContain('1.00');
    expect(dom.querySelector('[data-testid="routage-version"]')?.textContent).toContain(
      'Aiguillage v2',
    );
  });

  it('SANS MODÈLE DÉCLARÉ, LE PANNEAU LE DIT — pas de justification inventée', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: null,
        effort: null,
        decision: null,
        categorie: null,
        versionAiguillage: null,
        raisonModele: [],
        modelesEcartes: [],
        modelesReadmis: [],
        pheromone: null,
        course: null,
        critereNoeud: 'moins_charge',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-sans-modele"]')).toBeTruthy();
    expect(dom.querySelector('.routage-rang')).toBeNull();
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain(
      'le moins chargé',
    );
  });

  it('UNE COURSE GAGNÉE PAR UN AUTRE DRONE QUE LE PRIMAIRE : LE PANNEAU NOMME LE VAINQUEUR, SON MODÈLE, SA RAISON', async () => {
    // L'affectation ne nomme que le primaire (n-aaa, fable). Le panneau
    // montrait donc fable pour une production faite par zzz avec opus.
    const dom = await monter([
      {
        eventId: 2,
        ts: 2,
        nodeId: 'n-aaa',
        modele: 'fable',
        effort: null,
        decision: null,
        categorie: 'code',
        versionAiguillage: 2,
        raisonModele: [
          {
            modele: 'fable',
            essais: 0,
            enVol: 0,
            moyenne: null,
            score: null,
            aExplorer: true,
            ...AVANT_V3,
          },
        ],
        modelesEcartes: ['grok'],
        modelesReadmis: [],
        pheromone: null,
        course: {
          drones: [
            {
              nodeId: 'n-aaa',
              modele: 'fable',
              effort: null,
              decision: null,
              raisonModele: [
                {
                  modele: 'fable',
                  essais: 0,
                  enVol: 0,
                  moyenne: null,
                  score: null,
                  aExplorer: true,
                  ...AVANT_V3,
                },
              ],
            },
            {
              nodeId: 'n-zzz',
              modele: 'opus',
              effort: null,
              decision: null,
              raisonModele: [
                {
                  modele: 'opus',
                  essais: 3,
                  enVol: 0,
                  moyenne: 1,
                  score: 1.9,
                  aExplorer: false,
                  ...AVANT_V3,
                },
              ],
            },
          ],
          vainqueur: { nodeId: 'n-zzz', modele: 'opus' },
        },
        critereNoeud: 'course_de_drones',
      },
    ]);
    const worker = dom.querySelector('[data-testid="routage-worker"]')?.textContent;
    expect(worker).toContain('zzz');
    expect(worker).toContain('vainqueur d’une course de 2 drones');
    expect(dom.querySelector('[data-testid="routage-modele"]')?.textContent).toContain('opus');
    const lignes = [...dom.querySelectorAll('.routage-rang tbody tr')];
    expect(
      lignes.map((l) => l.querySelector('td')?.textContent),
      'le classement du vainqueur',
    ).toEqual(['opus']);
    expect(dom.querySelector('[data-testid="routage-course"]')?.textContent).toContain(
      'n-aaa (fable) · zzz (opus)',
    );
    expect(dom.querySelector('[data-testid="routage-ecartes"]')?.textContent).toContain(
      'Écarté pour cette tâche après un échec : grok',
    );
  });

  it('UN VAINQUEUR SANS MODÈLE DÉCLARÉ N’HÉRITE PAS DE CELUI DU PRIMAIRE', async () => {
    const dom = await monter([
      {
        eventId: 2,
        ts: 2,
        nodeId: 'n-aaa',
        modele: 'fable',
        effort: null,
        decision: null,
        categorie: 'code',
        versionAiguillage: 2,
        raisonModele: [],
        modelesEcartes: [],
        modelesReadmis: [],
        pheromone: null,
        course: {
          drones: [
            { nodeId: 'n-aaa', modele: 'fable', effort: null, raisonModele: [], decision: null },
            { nodeId: 'n-zzz', modele: null, effort: null, raisonModele: [], decision: null },
          ],
          vainqueur: { nodeId: 'n-zzz', modele: null },
        },
        critereNoeud: 'course_de_drones',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain('zzz');
    expect(dom.querySelector('[data-testid="routage-modele"]')).toBeNull();
    expect(dom.querySelector('[data-testid="routage-sans-modele"]')).toBeTruthy();
  });

  it('V3 : L’EFFORT, L’INTERVALLE ET « DÉCIDÉ À δ » S’AFFICHENT — le coût seulement s’il a pesé', async () => {
    const ligne = (modele: string, effort: string | null, bas: number, haut: number) => ({
      modele,
      harness: 'claude-code',
      effort,
      essais: 40,
      enVol: 0,
      moyenne: (bas + haut) / 2,
      score: haut,
      aExplorer: false,
      intervalle: { bas, haut },
      cout: 0.25,
    });
    const affectation = (coutPondere: boolean): AffectationVue => ({
      eventId: 1,
      ts: 1,
      nodeId: 'n-zzz',
      modele: 'opus',
      effort: 'high',
      categorie: 'code',
      versionAiguillage: 3,
      raisonModele: [ligne('opus', 'high', 0.84, 0.99), ligne('opus', null, 0.1, 0.4)],
      decision: { etat: 'decide', coutPondere },
      modelesEcartes: [],
      modelesReadmis: [],
      pheromone: null,
      course: null,
      critereNoeud: 'porteur_du_modele',
    });
    const dom = await monter([affectation(false)]);
    expect(dom.querySelector('[data-testid="routage-effort"]')?.textContent).toContain('high');
    expect(
      [...dom.querySelectorAll('[data-testid="routage-intervalle"]')].map((c) => c.textContent),
    ).toEqual(['0.84–0.99', '0.10–0.40']);
    expect(dom.querySelector('[data-testid="routage-decision"]')?.textContent).toContain(
      'décidé à δ = 5 %',
    );
    const cellules = [...dom.querySelectorAll('.routage-rang tbody tr')].map(
      (l) => l.querySelector('td')?.textContent,
    );
    expect(cellules, 'deux bras du même modèle, distingués').toEqual([
      'opus · claude-code · high',
      'opus · claude-code · effort par défaut',
    ]);
    expect(dom.textContent, 'coût non pondéré : pas de colonne').not.toContain('Coût déclaré');

    act(() => racine?.unmount());
    conteneur?.remove();
    const pondere = await monter([affectation(true)]);
    expect(pondere.textContent).toContain('Coût déclaré');
    expect(pondere.textContent).toContain('$0.250');
  });

  it('PAS ENCORE AFFECTÉE : LE PANNEAU LE DIT', async () => {
    const dom = await monter([]);
    expect(dom.querySelector('[data-testid="routage-tache"]')?.textContent).toContain(
      'Pas encore affectée',
    );
  });
});
