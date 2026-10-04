// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCRAN DES MISSIONS ET DU REJEU — ce qu'une personne lit avant de rejouer,
// et ce qu'elle lit en comparant.
//
//   · rien ne part au montage : la lecture se demande, rejouer est un geste ;
//   · le formulaire DIT, avant le clic, que les effets irréversibles seront
//     simulés — et envoie exactement les surcharges choisies ;
//   · la comparaison écrit « inconnu » quand un côté n'a rien déclaré, et
//     « au moins » quand la couverture est partielle — jamais « 0 $ ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { ComparaisonMissions, ResumeMission } from '../src/shared/mission-rejouable';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMissions: vi.fn(),
  fetchComparaisonRejeu: vi.fn(),
  rejouerMission: vi.fn(),
}));

import { fetchComparaisonRejeu, fetchMissions, rejouerMission } from '../dashboard/src/api';
import { MissionsProjet } from '../dashboard/src/views/MissionsRejeu';
import { direEcart, direSomme } from '../dashboard/src/views/missions-rendu';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJET: Project = {
  id: 'p1',
  name: 'Site',
  repoUrl: 'https://github.com/moi/site.git',
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

const fr = (a: string): string => a;

function resume(patch: Partial<ResumeMission> = {}): ResumeMission {
  const zero = { passed: 0, failed: 0, missing: 0, not_applicable: 0 };
  return {
    missionId: 'm',
    provisoire: false,
    taches: {
      pending: 0,
      ready: 0,
      assigned: 0,
      running: 0,
      done: 2,
      failed: 0,
      cancelled: 1,
    },
    reussie: false,
    cout: 'inconnu',
    dureeApiMs: 'inconnu',
    dureeOuvrieresMs: { total: 4_000, declarees: 2, tentatives: 2 },
    dureeMurMs: 60_000,
    tentatives: 2,
    validations: { tests: zero, typecheck: zero, build: zero, lint: zero },
    relectures: { contestees: 0, validees: 1 },
    revuesHumaines: { approuvees: 1, rejetees: 0 },
    decisions: { task_reviewed: 1 },
    actionsRejeu: { simulees: 0, validees: 0 },
    modeles: { commandes: [], declares: [], offerts: [] },
    journalComplet: true,
    faitsTronques: [],
    ...patch,
  };
}

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  vi.mocked(fetchMissions).mockReset();
  vi.mocked(fetchComparaisonRejeu).mockReset();
  vi.mocked(rejouerMission).mockReset();
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(element: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine?.render(element);
  });
  return conteneur;
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('les mots de la comparaison', () => {
  it('« inconnu » reste inconnu, une couverture partielle se lit « au moins »', () => {
    expect(direSomme('inconnu', 'usd', fr)).toBe('inconnu');
    expect(direSomme({ total: 1.5, declarees: 1, tentatives: 3 }, 'usd', fr)).toBe(
      'au moins 1.50 $ (1/3 déclarées)',
    );
    expect(direSomme({ total: 1.5, declarees: 3, tentatives: 3 }, 'usd', fr)).toBe('1.50 $');
    expect(direEcart({ ecart: 'inconnu', couvertureComplete: false }, 'usd', fr)).toBe('inconnu');
    expect(direEcart({ ecart: -0.25, couvertureComplete: true }, 'usd', fr)).toBe('−0.25 $');
    expect(direEcart({ ecart: 1_500, couvertureComplete: false }, 'ms', fr)).toBe(
      '+1.5 s (couverture partielle)',
    );
  });

  it('le tableau n’écrit jamais « 0 $ » pour un coût que personne n’a déclaré', async () => {
    const c: ComparaisonMissions = {
      original: resume(),
      rejeu: resume({ provisoire: true, cout: { total: 0.4, declarees: 1, tentatives: 2 } }),
      ecarts: {
        cout: { ecart: 'inconnu', couvertureComplete: false },
        dureeApiMs: { ecart: 'inconnu', couvertureComplete: false },
        dureeOuvrieresMs: { ecart: 0, couvertureComplete: true },
        dureeMurMs: 'inconnu',
        tentatives: 0,
        tachesReussies: 0,
        testsPasses: 0,
        testsEchoues: 0,
        relecturesContestees: 0,
      },
      journauxComplets: false,
    };
    vi.mocked(fetchMissions).mockResolvedValue({
      missions: [],
      rejeu: { missionSource: 'm1', projetSource: null, surcharges: {}, creeA: 1, actions: [] },
    });
    vi.mocked(fetchComparaisonRejeu).mockResolvedValue(c);
    const dom = await monter(<MissionsProjet project={PROJET} />);
    await cliquer(bouton(dom, 'voir les missions'));
    await act(async () => {});
    const ligne = [...dom.querySelectorAll('tr')].find((tr) =>
      (tr.textContent ?? '').includes('Coût déclaré'),
    );
    expect(ligne?.textContent).toContain('inconnu');
    expect(ligne?.textContent).toContain('au moins 0.40 $');
    expect(ligne?.textContent).not.toContain('0.00 $');
    expect(dom.textContent).toContain('(provisoire)');
    expect(dom.textContent).toContain('les faits sont incomplets');
  });
});

describe('les missions d’un projet, à l’écran', () => {
  it('RIEN NE PART AU MONTAGE ; le formulaire dit que les effets seront simulés, et envoie les surcharges choisies', async () => {
    vi.mocked(fetchMissions).mockResolvedValue({
      missions: [
        {
          id: 'm1',
          ouverteA: 1_700_000_000_000,
          closeA: 1_700_000_060_000,
          tachesPlan: 2,
          rejouable: true,
          manques: [],
          resume: resume(),
          rejeux: [],
        },
      ],
      rejeu: null,
    });
    vi.mocked(rejouerMission).mockResolvedValue({
      projet: { ...PROJET, id: 'p2', name: 'Rejeu — Site' },
      taches: [],
    });
    const dom = await monter(<MissionsProjet project={PROJET} />);
    expect(vi.mocked(fetchMissions)).not.toHaveBeenCalled();

    await cliquer(bouton(dom, 'voir les missions'));
    expect(vi.mocked(fetchMissions)).toHaveBeenCalledWith('p1');
    // Un projet ordinaire : pas de comparaison demandée.
    expect(vi.mocked(fetchComparaisonRejeu)).not.toHaveBeenCalled();
    expect(dom.textContent).toContain('2 tâche(s) au plan');
    expect(dom.textContent).toContain('⊘ 1');

    await cliquer(bouton(dom, 'Rejouer…'));
    expect(dom.textContent).toContain('SIMULÉS');
    const champ = dom.querySelector<HTMLInputElement>('.pj-rejeu-form input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(champ, 'codex-5');
      champ?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const [politique] = [...dom.querySelectorAll<HTMLSelectElement>('.pj-rejeu-form select')];
    await act(async () => {
      if (politique) {
        politique.value = 'figee';
        politique.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await cliquer(bouton(dom, 'Lancer le rejeu'));
    expect(vi.mocked(rejouerMission)).toHaveBeenCalledWith('p1', 'm1', {
      modele: 'codex-5',
      politiqueRoutage: 'figee',
    });
    expect(dom.textContent).toContain('✔ Rejeu — Site');
  });

  it('UN PROJET DE REJEU le dit avant tout, avec ce qu’il a simulé, puis compare', async () => {
    vi.mocked(fetchMissions).mockResolvedValue({
      missions: [],
      rejeu: {
        missionSource: 'm1',
        projetSource: 'p0',
        surcharges: { modele: 'codex-5', politiqueRoutage: 'neutre' },
        creeA: 1,
        actions: [
          { genre: 'livraison_pr', cible: 'moi/site:hive/rj-1', issue: 'simulee', creeA: 2 },
        ],
      },
    });
    vi.mocked(fetchComparaisonRejeu).mockResolvedValue({
      original: resume(),
      rejeu: resume({ provisoire: true }),
      ecarts: {
        cout: { ecart: 'inconnu', couvertureComplete: false },
        dureeApiMs: { ecart: 'inconnu', couvertureComplete: false },
        dureeOuvrieresMs: { ecart: 0, couvertureComplete: true },
        dureeMurMs: 'inconnu',
        tentatives: 0,
        tachesReussies: 0,
        testsPasses: 0,
        testsEchoues: 0,
        relecturesContestees: 0,
      },
      journauxComplets: true,
    });
    const dom = await monter(<MissionsProjet project={PROJET} />);
    await cliquer(bouton(dom, 'voir les missions'));
    await act(async () => {});
    expect(dom.textContent).toContain('actions irréversibles simulées');
    expect(dom.textContent).toContain('modèle : codex-5');
    expect(dom.textContent).toContain('simulée');
    expect(dom.textContent).toContain('pull request');
    expect(vi.mocked(fetchComparaisonRejeu)).toHaveBeenCalledWith('p1');
    expect(dom.querySelector('.pj-rejeu-cmp table')).not.toBeNull();
  });
});
