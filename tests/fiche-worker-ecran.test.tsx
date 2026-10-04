// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA FICHE D'UN WORKER, À L'ÉCRAN — et son avatar.
//
// Ce que ce fichier défend : l'inconnu reste inconnu (un genre jamais jugé
// n'est pas 0 %, la mémoire non attribuée est dite), la fiche se lit au
// clavier et au lecteur d'écran (titre, onglets, tableaux légendés), et
// l'avatar est un repère STABLE, jamais vide, peint par les seuls jetons.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { FicheWorker as Fiche } from '../dashboard/src/api';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchFicheWorker: vi.fn(),
}));

import { fetchFicheWorker } from '../dashboard/src/api';
import { AvatarWorker, motifAvatar } from '../dashboard/src/composants';
import { FicheWorker } from '../dashboard/src/views/FicheWorker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

function fiche(over: Partial<Fiche> = {}): Fiche {
  const reputationVide = {
    essais: 0,
    appliquer: 0,
    ameliorer: 0,
    refaire: 0,
    moyenne: null,
    score: null,
    attribution: 'absente' as const,
  };
  return {
    worker: {
      id: 'node-capucine',
      name: 'poste-1',
      ownerName: 'micka',
      agentType: 'claude-code',
      identite: { bapteme: { nom: 'Capucine', baptiseA: 1 }, metier: null },
      status: 'online',
      running: 1,
      maxConcurrency: 2,
      slotsLibres: 1,
      currentTasks: [
        {
          id: 't-en-cours',
          title: 'Écrire le parseur',
          status: 'running',
          attempts: 1,
          branch: null,
          updatedAt: 1,
        },
      ],
      reputation: {
        essais: 4,
        appliquer: 3,
        ameliorer: 1,
        refaire: 0,
        moyenne: 0.875,
        score: 0.9,
        attribution: 'exacte',
      },
      reputationParCategorie: {
        code: {
          essais: 4,
          appliquer: 3,
          ameliorer: 1,
          refaire: 0,
          moyenne: 0.875,
          score: 0.9,
          attribution: 'exacte',
        },
      },
      modeles: [
        {
          modele: 'claude-sonnet',
          categories: {} as never,
          reputation: reputationVide,
        },
      ],
      autonomie: {
        delegation: {
          maxDepth: 3,
          maxChildrenPerParent: 4,
          maxDescendantsPerRoot: 16,
          maxDurationMs: 1_800_000,
          maxCostMicros: 5_000_000,
          maxResourceUnits: 4,
          maxTitleChars: 160,
          maxPromptChars: 16_000,
        },
      },
      plateforme: 'linux',
      outils: [{ agent: 'claude-code', binaire: true, cle: 'presente' }],
    },
    modelesCourants: [{ taskId: 't-en-cours', modele: 'claude-sonnet' }],
    missions: [
      {
        resultId: 2,
        taskId: 't2',
        titre: 'Réparer le test',
        succes: false,
        dureeMs: 65_000,
        createdAt: 2,
        ressources: {
          portee: 'arbre',
          releves: 12,
          cpuMs: 2_500,
          picOctets: 300 * 1024 * 1024,
          memoire: 'pss',
        },
      },
      {
        resultId: 1,
        taskId: 't1',
        titre: 'Avant la mesure de l’agent',
        succes: true,
        dureeMs: 1_000,
        createdAt: 1,
        ressources: { portee: 'aucune', raison: 'noeud_ancien' },
      },
    ],
    lecons: [
      {
        resultId: 2,
        taskId: 't2',
        titre: 'Réparer le test',
        createdAt: 2,
        extrait: 'Error: expected 2 got 3',
      },
    ],
    debats: [
      {
        role: 'relecteur',
        entree: {
          id: 9,
          ts: 3,
          genre: 'contre_verdict',
          taskId: 't9',
          resultId: 1,
          relecteur: 'claude-code',
          conteste: true,
          objections: ['test manquant'],
          criteres: [],
          marqueurIllisible: false,
        },
      },
    ],
    taches: { t9: { titre: 'Production relue', projectId: 'p' } },
    journalElague: false,
    memoire: 'non_attribuee',
    ...over,
  };
}

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchFicheWorker).mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(onOpenTask = vi.fn(), onNavigate = vi.fn()): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(
      <FicheWorker
        nodeId="node-capucine"
        node={undefined}
        refreshTick={0}
        onOpenTask={onOpenTask}
        onNavigate={onNavigate}
        nomNoeud={(id) => id}
      />,
    ),
  );
  await act(async () => {});
  return conteneur;
}

const onglet = (dom: HTMLElement, debut: string) =>
  [...dom.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) =>
    b.textContent?.startsWith(debut),
  )!;

describe('la fiche', () => {
  it('se présente : visage, nom, fournisseur, modèle en cours, réputation', async () => {
    vi.mocked(fetchFicheWorker).mockResolvedValue(fiche());
    const dom = await monter();
    const section = dom.querySelector('[data-testid="fiche-worker"]')!;
    expect(section.getAttribute('aria-labelledby')).toBe('fw-titre');
    expect(dom.querySelector('#fw-titre')?.textContent).toBe('Capucine');
    expect(section.querySelector('svg.ds-avatar')?.getAttribute('aria-hidden')).toBe('true');
    expect(section.textContent).toContain('Claude Code');
    expect(dom.querySelector('[data-testid="fiche-modele-courant"]')?.textContent).toBe(
      'claude-sonnet',
    );
    expect(section.textContent).toContain('88 % · 4 avis');
  });

  it('UN GENRE JAMAIS JUGÉ EST INCONNU, PAS 0 %', async () => {
    vi.mocked(fetchFicheWorker).mockResolvedValue(fiche());
    const dom = await monter();
    const table = dom.querySelector('.fw-table')!;
    expect(table.querySelector('caption')?.textContent).toContain('Réputation par genre');
    expect(table.querySelector('[data-categorie="code"]')?.textContent).toContain('88 %');
    const securite = table.querySelector('[data-categorie="test"]')!;
    expect(securite.textContent).toContain('jamais jugé');
    expect(securite.textContent).not.toContain('0 %');
  });

  it('les erreurs apprises, les débats et les missions — chacun ouvre sa tâche', async () => {
    vi.mocked(fetchFicheWorker).mockResolvedValue(fiche());
    const ouvrir = vi.fn();
    const aller = vi.fn();
    const dom = await monter(ouvrir, aller);

    await act(async () => onglet(dom, 'Erreurs apprises').click());
    expect(dom.textContent).toContain('Error: expected 2 got 3');
    expect(dom.querySelector('[data-testid="fiche-memoire"]')?.textContent).toContain(
      'ne dit pas encore',
    );
    await act(async () => dom.querySelector<HTMLButtonElement>('.fw-lecon .fw-lien')!.click());
    expect(ouvrir).toHaveBeenLastCalledWith('t2');

    await act(async () => onglet(dom, 'Débats').click());
    expect(dom.querySelector('.fw-role')?.textContent).toBe('relectrice');
    expect(dom.textContent).toContain('Production relue');
    const warroom = [...dom.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('War Room'),
    )!;
    await act(async () => warroom.click());
    expect(aller).toHaveBeenCalledWith('warroom');

    await act(async () => onglet(dom, 'Missions').click());
    const [ligne, ancienne] = [...dom.querySelectorAll('.fw-table tbody tr')];
    expect(ligne!.textContent).toContain('échec');
    // Les ressources de l'AGENT (#558), dites comme dans le tiroir de la tâche
    // — jamais les compteurs du processus du nœud.
    expect(ligne!.querySelector('.fw-ressources')?.textContent).toBe(
      'arbre de processus de l’agent : au moins 2.5 s CPU · pic mémoire échantillonné 300 Mio ' +
        '(Pss — pages partagées réparties) · 12 relevés toutes les 5 s',
    );
    expect(ancienne!.querySelector('.fw-ressources')?.textContent).toBe(
      'ressources de l’agent non mesurées — nœud d’une version antérieure, qui ne mesurait ' +
        'que lui-même',
    );
    expect(dom.textContent).toContain('aucune moyenne');
  });

  it('les onglets se parcourent au clavier (← →), un seul arrêt de tabulation', async () => {
    vi.mocked(fetchFicheWorker).mockResolvedValue(fiche());
    const dom = await monter();
    const tabs = [...dom.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    tabs[0]!.focus();
    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toMatch(/^Erreurs apprises/);
  });

  it('les vides sont nommés ; une lecture ratée propose « Réessayer »', async () => {
    vi.mocked(fetchFicheWorker).mockRejectedValueOnce(new Error('Reine injoignable'));
    const dom = await monter();
    const alerte = dom.querySelector('[role="alert"]')!;
    expect(alerte.textContent).toContain('pas pu être lue');
    vi.mocked(fetchFicheWorker).mockResolvedValue(
      fiche({ lecons: [], debats: [], missions: [], modelesCourants: [] }),
    );
    const reessayer = [...alerte.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Réessayer'),
    )!;
    await act(async () => reessayer.click());
    await act(async () => {});
    expect(dom.querySelector('[data-testid="fiche-modele-courant"]')?.textContent).toBe(
      'aucune mission en cours',
    );
    await act(async () => onglet(dom, 'Débats').click());
    expect(dom.textContent).toContain('Aucun débat pour ce Worker');
  });
});

describe('l’avatar', () => {
  it('DÉTERMINISTE : le même identifiant, le même visage', () => {
    expect(motifAvatar('node-capucine')).toEqual(motifAvatar('node-capucine'));
    expect(renderToStaticMarkup(<AvatarWorker id="n-1" />)).toBe(
      renderToStaticMarkup(<AvatarWorker id="n-1" />),
    );
  });

  it('JAMAIS VIDE, symétrique, et des visages qui se distinguent', () => {
    const motifs = Array.from({ length: 400 }, (_, i) => motifAvatar(`noeud-${i}`));
    for (const m of motifs) {
      expect(m.cellules.filter((c) => c !== 'vide').length).toBeGreaterThanOrEqual(2);
      // Gauche-droite : haut-droite = haut-gauche, bas-droite = bas-gauche.
      expect(m.cellules[1]).toBe(m.cellules[5]);
      expect(m.cellules[2]).toBe(m.cellules[4]);
      expect(m.teinte).not.toBe(5); // le rouge des statuts n'est jamais un visage
    }
    const distincts = new Set(motifs.map((m) => JSON.stringify(m)));
    expect(distincts.size).toBeGreaterThan(100);
  });

  it('PEINT PAR LES JETONS : aucune couleur écrite, les deux thèmes suivent', () => {
    const svg = renderToStaticMarkup(<AvatarWorker id="node-capucine" taille={48} />);
    expect(svg).toMatch(/var\(--graphe-[12346]\)/);
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
    expect(svg).toContain('aria-hidden="true"');
  });
});
