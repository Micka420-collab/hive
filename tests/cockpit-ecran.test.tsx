// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ACCUEIL DE MISSION CONTROL — la dépense, ce qui arrête la ruche, les
// décisions récentes.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · la dépense n'est un chiffre de tête qu'AVEC sa couverture : « ≥ » et
//     « 1/2 tentative(s) déclarée(s) » dès qu'une tentative s'est tue, et pas
//     de tuile du tout tant que le cockpit n'a pas répondu (un « 0 $ » de
//     chargement se lirait « rien dépensé ») ;
//   · un échec de lecture se dit « état inconnu », jamais « rien n'arrête la
//     ruche » : les deux phrases sont opposées ;
//   · chaque alerte mène au geste qui la lève — la tâche, le projet, l'Essaim ;
//   · une décision se lit comme le Journal la dit, avec le titre de sa tâche.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertesRuche } from '../dashboard/src/AlertesRuche';
import { DecisionsRecentes } from '../dashboard/src/DecisionsRecentes';
import { StatTiles } from '../dashboard/src/StatTiles';
import { setLang } from '../dashboard/src/i18n';
import type { Cockpit, DepenseRuche } from '../dashboard/src/api';
import type { Poll } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  // Les composants reçoivent leur sondage tout fait : aucun n'appelle l'API.
  // Le filet reste posé — un composant qui se mettrait à sonder ne partirait
  // pas au réseau en silence (sans-vraie-connexion.test.ts).
  couperLeReseau();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

function monter(el: React.ReactElement): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine?.render(el));
  return conteneur;
}

const depense = (patch: Partial<DepenseRuche> = {}): DepenseRuche => ({
  depuis: 0,
  tronquee: false,
  tentatives: 2,
  reussies: 2,
  coutFournisseur: { total: 1.5, declarees: 1, tentatives: 2 },
  dureeModele: { total: 60_000, declarees: 2, tentatives: 2 },
  dureeWorker: { totalMs: 180_000, mesurees: 2 },
  dureeMedianeMs: 90_000,
  ...patch,
});

const cockpit = (patch: Partial<Cockpit> = {}): Cockpit => ({
  decisions: [],
  depense: depense(),
  alertes: [],
  total: 0,
  ...patch,
});

const sondage = (data: Cockpit | null, error: string | null = null): Poll<Cockpit> => ({
  data,
  error,
  refresh: () => {},
  relance: false,
  echecA: error ? 1 : null,
});

const instantane = {
  projects: [],
  nodes: [],
  tasks: [],
  tasksTotal: 0,
} as unknown as StateSnapshot;

describe('la tuile de dépense', () => {
  it('ne dit jamais un coût sans sa couverture', () => {
    const dom = monter(<StatTiles snapshot={instantane} throughput={0} depense={depense()} />);
    const tuile = dom.querySelector('[data-testid="tuile-depense"]')!;
    expect(tuile.querySelector('.tile-value')?.textContent).toMatch(/^≥ 1,50/);
    expect(dom.querySelector('[data-testid="depense-couverture"]')?.textContent).toBe(
      '1/2 tentative(s) déclarée(s)',
    );
    expect(dom.querySelector('[data-testid="depense-temps"]')?.textContent).toContain(
      '2/2 tentative(s) déclarée(s)',
    );
    expect(dom.querySelector('[data-testid="depense-tronquee"]')).toBeNull();
  });

  it('sans déclaration : « inconnu » et pourquoi — jamais « 0 $ »', () => {
    const dom = monter(
      <StatTiles
        snapshot={instantane}
        throughput={0}
        depense={depense({ coutFournisseur: 'inconnu', tronquee: true })}
      />,
    );
    expect(dom.querySelector('[data-testid="tuile-depense"] .tile-value')?.textContent).toBe(
      'inconnu',
    );
    expect(dom.querySelector('[data-testid="depense-couverture"]')?.textContent).toContain(
      'aucune des 2 tentative(s) ne déclare son coût',
    );
    expect(dom.querySelector('[data-testid="depense-tronquee"]')).not.toBeNull();
  });

  it('pas de tuile tant que le cockpit n’a pas répondu', () => {
    const dom = monter(<StatTiles snapshot={instantane} throughput={0} />);
    expect(dom.querySelector('[data-testid="tuile-depense"]')).toBeNull();
  });
});

describe('ce qui arrête la ruche', () => {
  it('un échec de lecture dit « état inconnu », jamais « rien »', () => {
    const dom = monter(
      <AlertesRuche
        cockpit={sondage(cockpit(), 'la ruche ne répond pas')}
        nomsDeNoeuds={new Map()}
        onOpenTask={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(dom.textContent).toContain('État inconnu');
    expect(dom.querySelector('[data-testid="alertes-ruche-aucune"]')).toBeNull();
  });

  it('dit « rien » quand il n’y a rien', () => {
    const dom = monter(
      <AlertesRuche
        cockpit={sondage(cockpit())}
        nomsDeNoeuds={new Map()}
        onOpenTask={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(dom.querySelector('[data-testid="alertes-ruche-aucune"]')?.textContent).toBe(
      'Rien n’arrête la ruche.',
    );
  });

  it('chaque alerte mène au geste qui la lève', () => {
    const onOpenTask = vi.fn();
    const onNavigate = vi.fn();
    const dom = monter(
      <AlertesRuche
        cockpit={sondage(
          cockpit({
            total: 5,
            alertes: [
              { genre: 'blocage', cause: 'aucune_ouvriere', taches: 2, depuis: 1 },
              {
                genre: 'budget',
                projectId: 'p1',
                projet: 'Vitrine',
                depenseMs: 60_000,
                plafondMs: 30_000,
                depuis: null,
              },
              {
                genre: 'relecture_impossible',
                taskId: 't1',
                titre: 'Page contact',
                cause: 'aucune autre famille en ligne',
                depuis: 2,
              },
              {
                genre: 'refus',
                taskId: 't2',
                titre: 'API',
                nodeId: 'n1',
                raison: 'quota épuisé',
                depuis: 3,
                definitif: false,
              },
              {
                genre: 'refus',
                taskId: 't3',
                titre: 'Schéma',
                nodeId: null,
                raison: 'non authentifié',
                depuis: 4,
                definitif: true,
              },
            ],
          }),
        )}
        nomsDeNoeuds={new Map([['n1', 'poste-1']])}
        onOpenTask={onOpenTask}
        onNavigate={onNavigate}
      />,
    );
    const items = [...dom.querySelectorAll<HTMLButtonElement>('.alertes-ruche-item')];
    expect(items.map((b) => b.dataset.genre)).toEqual([
      'blocage',
      'budget',
      'relecture_impossible',
      'refus',
      'refus',
    ]);
    expect(items[1]?.textContent).toContain('« Vitrine » arrêté par son plafond');
    expect(items[2]?.textContent).toContain('aucune autre famille en ligne');
    expect(items[3]?.textContent).toContain('refusée par poste-1 : quota épuisé');
    // Échouée faute d'agent : dite jusqu'à la relance, nœud inconnu dit « ? ».
    expect(items[4]?.textContent).toContain('« Schéma » a échoué : aucun agent qui fonctionne');
    expect(items[4]?.textContent).toContain('dernier refus, ? : non authentifié');
    expect(dom.querySelector('[data-testid="alertes-ruche-total"]')?.textContent).toBe('5');
    act(() => items.forEach((b) => b.click()));
    expect(onNavigate.mock.calls).toEqual([['essaim'], ['projets', 'p1']]);
    expect(onOpenTask.mock.calls).toEqual([['t1'], ['t2'], ['t3']]);
  });
});

describe('les décisions récentes', () => {
  it('se lisent comme le Journal, avec le titre de la tâche, et ouvrent la tâche', () => {
    const onOpenTask = vi.fn();
    const dom = monter(
      <DecisionsRecentes
        cockpit={sondage(
          cockpit({
            decisions: [
              {
                evenement: {
                  id: 9,
                  ts: 1,
                  type: 'task_assigned',
                  payload: {
                    taskId: 't9',
                    nodeId: 'noeud-12345678',
                    modele: 'opus',
                    categorie: 'code',
                  },
                },
                titre: 'Écrire l’API',
              },
              {
                evenement: {
                  id: 8,
                  ts: 1,
                  type: 'task_reviewed',
                  payload: { taskId: 't8', state: 'rejected' },
                },
                titre: null,
              },
            ],
          }),
        )}
        onOpenTask={onOpenTask}
      />,
    );
    const lignes = [...dom.querySelectorAll<HTMLElement>('.jrow')];
    expect(lignes[0]?.textContent).toContain('Écrire l’API · ');
    expect(lignes[0]?.textContent).toContain('modèle opus (code)');
    expect(lignes[1]?.textContent).toContain('revue humaine : rejetée');
    act(() => lignes[0]?.click());
    expect(onOpenTask).toHaveBeenCalledWith('t9');
  });

  it('aucune décision : le dit', () => {
    const dom = monter(<DecisionsRecentes cockpit={sondage(cockpit())} onOpenTask={() => {}} />);
    expect(dom.textContent).toContain('Aucune décision consignée');
  });
});
