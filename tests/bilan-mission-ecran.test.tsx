// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA FICHE D'UNE OUVRIÈRE ET LE RAPPORT DE MISSION — ce que le travail a
// donné, et ce qu'il a coûté.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · la qualité d'un Worker se dit en DEUX mesures, avec leurs comptes, et
//     « inconnue » sous trois productions jugées — jamais « 100 % » sur une ;
//   · un coût déclaré ne s'affiche qu'avec sa couverture, sur la fiche, la
//     carte de l'Essaim et le rapport de mission ;
//   · le rapport de mission dit la décision de l'Evaluator et la contre-revue
//     de chaque tâche, ses reprises PAR SOURCE, et se tait pour un lien de
//     partage plutôt que d'afficher un rapport vide.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type {
  BilanEconomique,
  BilanWorker as Bilan,
  LigneMission,
  ProjectReport,
  RapportMission as Rapport,
} from '../dashboard/src/api';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchBilanWorker = vi.fn<(nodeId: string) => Promise<Bilan>>();
const fetchRapportMission =
  vi.fn<(projectId: string) => Promise<ProjectReport & { mission?: Rapport }>>();

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBilanWorker: (id: string) => fetchBilanWorker(id),
  fetchRapportMission: (id: string) => fetchRapportMission(id),
}));

const { BilanWorker } = await import('../dashboard/src/BilanWorker');
const { RapportMission } = await import('../dashboard/src/RapportMission');

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  fetchBilanWorker.mockReset();
  fetchRapportMission.mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

async function monter(el: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(el);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return conteneur;
}

const bilanEco = (patch: Partial<BilanEconomique> = {}): BilanEconomique => ({
  tentatives: 3,
  reussies: 2,
  coutFournisseur: { total: 0.75, declarees: 2, tentatives: 3 },
  dureeModele: 'inconnu',
  dureeWorker: { totalMs: 90_000, mesurees: 3 },
  dureeMedianeMs: 30_000,
  ...patch,
});

describe('le bilan d’une ouvrière', () => {
  const bilan = (qualite: Partial<Bilan['qualite']> = {}): Bilan => ({
    nodeId: 'n1',
    economie: { total: bilanEco(), parModele: [{ modele: 'opus', ...bilanEco() }] },
    qualite: {
      productions: 4,
      jugees: 3,
      acceptees: 2,
      partAcceptee: 2 / 3,
      corrigees: 1,
      tauxCorrection: 0.25,
      ...qualite,
    },
    fenetre: { evenements: 12, depuis: 1, tronquee: false },
  });

  it('dit la part acceptée et le taux de correction, côte à côte, avec leurs comptes', async () => {
    fetchBilanWorker.mockResolvedValue(bilan());
    const dom = await monter(<BilanWorker nodeId="n1" />);
    expect(fetchBilanWorker).toHaveBeenCalledWith('n1');
    expect(dom.querySelector('[data-testid="bilan-acceptation"] dd')?.textContent).toBe(
      '67 % — 2/3 production(s) tranchée(s)',
    );
    expect(dom.querySelector('[data-testid="bilan-correction"] dd')?.textContent).toBe(
      '25 % — 1 renvoi(s) sur 4 production(s)',
    );
    const lignes = [...dom.querySelectorAll('[data-testid="bilan-economie"] tbody tr')];
    expect(lignes.map((l) => l.querySelector('th')?.textContent)).toEqual(['Tous', 'opus']);
    expect(lignes[0]?.textContent).toContain('≥ 0,75');
    expect(lignes[0]?.textContent).toContain('2/3 tentative(s) déclarée(s)');
    expect(lignes[0]?.textContent).toContain('inconnu');
  });

  it('sous trois productions jugées, la part est INCONNUE — pas « 100 % »', async () => {
    fetchBilanWorker.mockResolvedValue(
      bilan({
        jugees: 1,
        acceptees: 1,
        partAcceptee: 'inconnu',
        productions: 1,
        tauxCorrection: 'inconnu',
      }),
    );
    const dom = await monter(<BilanWorker nodeId="n1" />);
    const acceptation = dom.querySelector('[data-testid="bilan-acceptation"] dd')?.textContent;
    expect(acceptation).toContain('inconnue');
    expect(acceptation).not.toContain('%');
    expect(dom.querySelector('[data-testid="bilan-correction"] dd')?.textContent).toContain(
      'inconnu',
    );
  });
});

describe('le rapport de mission', () => {
  const chronologie = (): LigneMission['chronologie'] => ({
    attenteDependancesMs: null,
    attenteWorkerMs: 1_000,
    demarrageMs: 500,
    tentatives: [],
    dureeWorkerTotaleMs: 60_000,
    reprises: 1,
    corrections: 1,
    revueMs: 30_000,
    totalMs: 120_000,
    terminee: true,
    dureeModele: 'inconnu',
    coutFournisseur: { total: 0.5, declarees: 1, tentatives: 2 },
    jetonsEntree: 'inconnu',
    jetonsSortie: 'inconnu',
  });
  const reprises = (): LigneMission['reprises'] => ({
    worker: 1,
    remise_en_file: 0,
    contre_revue: 1,
    revue_humaine: 0,
    evaluator: 0,
    inconnue: 0,
  });
  const rapport = (mission?: Rapport): ProjectReport & { mission?: Rapport } => ({
    projectId: 'p1',
    name: 'Mission',
    total: 1,
    byStatus: { pending: 0, ready: 0, assigned: 0, running: 0, done: 1, failed: 0 },
    done: 1,
    failed: 0,
    progressPct: 100,
    complete: true,
    contributingNodes: [],
    totalAttempts: 2,
    ...(mission ? { mission } : {}),
  });
  const mission = (): Rapport => ({
    taches: [
      {
        taskId: 't1',
        titre: 'Écrire l’API',
        statut: 'done',
        role: 'production',
        categorie: 'code',
        modeles: ['opus'],
        evaluator: { decision: 'accepted', raison: null, canMerge: false },
        relecture: { issue: 'favorable', favorables: 1, contestataires: 0, enVol: 0, cause: null },
        reprises: reprises(),
        chronologie: chronologie(),
      },
    ],
    totaux: {
      decisions: {
        accepted: 1,
        correction_required: 0,
        rejected: 0,
        additional_test_required: 0,
        human_review_required: 0,
      },
      reprises: reprises(),
      tentatives: 2,
      coutFournisseur: { total: 0.5, declarees: 1, tentatives: 2 },
      dureeModele: 'inconnu',
      dureeWorkerTotaleMs: 60_000,
    },
    genome: {
      lignes: [],
      sansModele: {
        affectations: 0,
        rendus: 0,
        reprises: 0,
        echecs: 0,
        refus: 0,
        interrompues: 0,
        corrections: 0,
        avis: { valides: 0, contestes: 0, modeleProuve: 0 },
        humain: { approuvees: 0, rejetees: 0 },
        dureeMedianeMs: null,
        coutFournisseur: 'inconnu',
        dureeModele: 'inconnu',
        jetonsEntree: 'inconnu',
        jetonsSortie: 'inconnu',
        modelesExacts: [],
      },
      fenetre: { evenements: 0, depuis: null, tronquee: false },
    },
    fenetre: { evenements: 8, depuis: 1, tronquee: true },
  });

  it('dit, par tâche, l’Evaluator, la contre-revue, les reprises par source et le coût avec sa couverture', async () => {
    fetchRapportMission.mockResolvedValue(rapport(mission()));
    const onOpenTask = vi.fn();
    const dom = await monter(
      <RapportMission projectId="p1" refreshTick={0} onOpenTask={onOpenTask} />,
    );
    expect(fetchRapportMission).toHaveBeenCalledWith('p1');
    expect(dom.querySelector('[data-testid="mission-decisions"]')?.textContent).toBe('acceptée 1');
    expect(dom.querySelector('[data-testid="mission-cout"]')?.textContent).toContain(
      '1/2 tentative(s) déclarée(s)',
    );
    expect(dom.querySelector('[data-testid="mission-reprises"]')?.textContent).toBe(
      'échec du Worker 1 · contre-revue 1',
    );
    const ligne = dom.querySelector('[data-testid="mission-ligne"]')!;
    expect(ligne.querySelector('[data-testid="mission-evaluator"]')?.textContent).toBe('acceptée');
    expect(ligne.querySelector('[data-testid="mission-relecture"]')?.textContent).toBe(
      'favorable (1✔ 0✘)',
    );
    expect(ligne.textContent).toContain('≥ 0,50');
    expect(dom.querySelector('[data-testid="mission-fenetre"]')?.textContent).toContain(
      'ont pu manquer',
    );
    act(() => ligne.querySelector<HTMLButtonElement>('button')?.click());
    expect(onOpenTask).toHaveBeenCalledWith('t1');
  });

  it('se tait pour un lien de partage plutôt que d’afficher un rapport vide', async () => {
    fetchRapportMission.mockResolvedValue(rapport());
    const dom = await monter(
      <RapportMission projectId="p1" refreshTick={0} onOpenTask={() => {}} />,
    );
    expect(dom.querySelector('[data-testid="mission-absente"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="mission-kpi"]')).toBeNull();
  });
});
