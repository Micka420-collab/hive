// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU DU BANC D'OMBRE, ET SA SECTION DANS LE REGISTRE GENOME.
//
// Ce que l'écran doit tenir :
//   · allumer le banc envoie TOUJOURS un budget explicite — celui que l'écran
//     propose, ou celui que l'humain a tapé — jamais un réglage sans borne ;
//   · un champ hors bornes se dit AVANT l'appel, avec le nom du champ ;
//   · le budget dépensé, les exécutions muettes et ce qui ARRÊTE le banc se
//     lisent sous l'interrupteur ;
//   · le registre Genome montre les comparaisons à part, avec leur provenance,
//     leur verdict et leur confiance — et dit où allumer le banc quand il n'y
//     en a aucune.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBancOmbre: vi.fn(),
  reglerBancOmbre: vi.fn(),
}));

import { fetchBancOmbre, reglerBancOmbre } from '../dashboard/src/api';
import type { EtatBancOmbreUi } from '../dashboard/src/api';
import { BancOmbre, lireBrouillon } from '../dashboard/src/BancOmbre';
import { RegistreGenome } from '../dashboard/src/RegistreGenome';
import type { FaitsGenome, RegistreGenome as Registre } from '../src/shared/registre-genome';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(reglerBancOmbre).mockReset();
});
afterEach(() => {
  void act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

const BORNES: EtatBancOmbreUi['bornes'] = {
  tauxPourMille: { min: 1, max: 1000 },
  executionsParJour: { min: 1, max: 50 },
  plafondCoutUsd: { max: 1000 },
};

const etat = (p: Partial<EtatBancOmbreUi> = {}): EtatBancOmbreUi => ({
  actif: false,
  reglage: null,
  propose: { tauxPourMille: 50, executionsParJour: 3, plafondCoutUsd: 1 },
  bornes: BORNES,
  budget: {
    fenetreMs: 86_400_000,
    executions: 0,
    enVol: 0,
    coutDeclareUsd: 0,
    executionsMuettes: 0,
    arret: null,
  },
  ombres: [],
  ...p,
});

describe('lireBrouillon — ce que le serveur refuserait, dit avant l’appel', () => {
  const b = (pourcent: string, executions: string, plafond: string) => ({
    pourcent,
    executions,
    plafond,
  });

  it('lit un pourcentage au dixième en ‰, et le budget tel quel', () => {
    expect(lireBrouillon(b('5', '3', '1.5'), BORNES)).toEqual({
      ok: true,
      tauxPourMille: 50,
      executionsParJour: 3,
      plafondCoutUsd: 1.5,
    });
    expect(lireBrouillon(b('0.1', '1', '0.01'), BORNES)).toMatchObject({ tauxPourMille: 1 });
  });

  it.each([
    ['échantillon vide', b('', '3', '1'), 'pourcent'],
    ['échantillon nul', b('0', '3', '1'), 'pourcent'],
    ['échantillon au-delà de 100 %', b('100.1', '3', '1'), 'pourcent'],
    ['exécutions fractionnaires', b('5', '2.5', '1'), 'executions'],
    ['exécutions nulles', b('5', '0', '1'), 'executions'],
    ['plafond nul — un banc éteint déguisé', b('5', '3', '0'), 'plafond'],
    ['plafond vide', b('5', '3', ''), 'plafond'],
    // Au dixième près : refusé, jamais arrondi en silence en 5,1 %.
    ['échantillon au centième', b('5.05', '3', '1'), 'pourcent'],
  ] as const)('%s → %s', (_cas, brouillon, champ) => {
    expect(lireBrouillon(brouillon, BORNES)).toEqual({ ok: false, champ });
  });
});

describe('le panneau du banc d’ombre', () => {
  it('éteint : allumer envoie le budget PROPOSÉ, explicitement', async () => {
    vi.mocked(fetchBancOmbre).mockResolvedValue(etat());
    vi.mocked(reglerBancOmbre).mockResolvedValue(etat({ actif: true }));
    const dom = await monter(<BancOmbre projectId="p1" />);
    expect(dom.textContent).toContain('Éteint');
    const interrupteur = dom.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      interrupteur.click();
    });
    expect(reglerBancOmbre).toHaveBeenCalledWith('p1', {
      actif: true,
      tauxPourMille: 50,
      executionsParJour: 3,
      plafondCoutUsd: 1,
    });
  });

  it('un champ hors bornes est refusé AVANT l’appel, et nommé', async () => {
    vi.mocked(fetchBancOmbre).mockResolvedValue(etat());
    const dom = await monter(<BancOmbre projectId="p2" />);
    const champs = dom.querySelectorAll<HTMLInputElement>('.banc-ombre-champ input');
    const plafond = champs[2]!;
    await act(async () => {
      const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      poser.call(plafond, '0');
      plafond.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const appliquer = dom.querySelector('.banc-ombre-reglage button') as HTMLButtonElement;
    await act(async () => {
      appliquer.click();
    });
    expect(reglerBancOmbre).not.toHaveBeenCalled();
    expect(dom.querySelector('.garde-fou-erreur')?.textContent).toContain('Plafond');
  });

  it('actif : ÉTEINDRE part même quand un champ de budget est faux — seul `{ actif: false }` est envoyé', async () => {
    const reglage = {
      tauxPourMille: 50,
      executionsParJour: 3,
      plafondCoutUsd: 1,
      definiPar: 'humain',
      updatedAt: 1,
    };
    vi.mocked(fetchBancOmbre).mockResolvedValue(etat({ actif: true, reglage }));
    vi.mocked(reglerBancOmbre).mockResolvedValue(etat({ actif: false, reglage }));
    const dom = await monter(<BancOmbre projectId="p4" />);
    const executions = dom.querySelectorAll<HTMLInputElement>('.banc-ombre-champ input')[1]!;
    await act(async () => {
      const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      poser.call(executions, '');
      executions.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const interrupteur = dom.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      interrupteur.click();
    });
    expect(reglerBancOmbre).toHaveBeenCalledWith('p4', { actif: false });
    expect(dom.querySelector('.garde-fou-erreur')).toBeNull();
    expect(dom.textContent).toContain('Éteint');
  });

  it('les champs portent les bornes du serveur, pas un min="0"', async () => {
    vi.mocked(fetchBancOmbre).mockResolvedValue(etat());
    const dom = await monter(<BancOmbre projectId="p5" />);
    const [pourcent, executions] =
      dom.querySelectorAll<HTMLInputElement>('.banc-ombre-champ input');
    expect([pourcent!.min, pourcent!.max]).toEqual(['0.1', '100']);
    expect([executions!.min, executions!.max]).toEqual(['1', '50']);
  });

  it('actif : le budget dépensé, les exécutions muettes et ce qui ARRÊTE le banc', async () => {
    vi.mocked(fetchBancOmbre).mockResolvedValue(
      etat({
        actif: true,
        reglage: {
          tauxPourMille: 50,
          executionsParJour: 2,
          plafondCoutUsd: 1,
          definiPar: 'humain',
          updatedAt: 1,
        },
        budget: {
          fenetreMs: 86_400_000,
          executions: 2,
          enVol: 0,
          coutDeclareUsd: 0.04,
          executionsMuettes: 1,
          arret: 'budget_executions',
        },
        ombres: [
          {
            tacheOmbre: 'o1',
            tacheOriginale: 't1',
            titre: 'Ombre — Ajouter somme',
            modeleOriginal: 'opus',
            modeleOmbre: 'fable',
            statut: 'done',
            coutDeclareUsd: 0.02,
            executionsMuettes: 1,
            creeA: 1,
          },
        ],
      }),
    );
    const dom = await monter(<BancOmbre projectId="p3" />);
    const budget = dom.querySelector('[data-testid="banc-ombre-budget"]')?.textContent ?? '';
    expect(budget).toContain('2/2 ombre(s)');
    expect(budget).toContain('1 exécution(s) sans coût déclaré');
    expect(dom.querySelector('[data-testid="banc-ombre-arret"]')?.textContent).toContain(
      'budget atteint : exécutions des dernières 24 h',
    );
    expect(dom.querySelector('.banc-ombre-liste')?.textContent).toContain('Ombre — Ajouter somme');
    expect(dom.querySelector('.banc-ombre-liste .badge')?.textContent).toContain('terminée');
  });
});

describe('le registre Genome — la section du banc d’ombre', () => {
  const faits = (): FaitsGenome => ({
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
  });
  const registre = (ombre: Registre['ombre']): Registre => ({
    lignes: [],
    ombre,
    sansModele: faits(),
    fenetre: { evenements: 3, depuis: 1, tronquee: false },
  });

  it('vide : il dit où allumer le banc, plutôt qu’un silence', async () => {
    const dom = await monter(
      <RegistreGenome
        registre={registre({ provenance: 'shadow', lignes: [], comparaisons: [], total: 0 })}
        erreur={null}
      />,
    );
    expect(dom.querySelector('[data-testid="genome-ombre-vide"]')?.textContent).toContain(
      'Projets › Banc d’ombre',
    );
  });

  it('montre chaque comparaison avec son verdict, sa confiance, et le modèle de chaque côté', async () => {
    const dom = await monter(
      <RegistreGenome
        registre={registre({
          provenance: 'shadow',
          total: 2,
          lignes: [
            {
              provenance: 'shadow',
              modele: 'fable',
              categorie: 'code',
              comparaisons: 1,
              commeOmbre: 1,
              victoires: 0,
              defaites: 1,
              egalites: 0,
              indecises: 0,
              confiance: { haute: 1, moyenne: 0, faible: 0 },
            },
          ],
          comparaisons: [
            {
              provenance: 'shadow',
              tacheOriginale: 't2',
              tacheOmbre: 'o2',
              modeleOmbre: 'haiku',
              categorie: 'code',
              depuis: 2,
              etat: 'en_vol',
              original: {
                modele: 'opus',
                issue: 'tests_verts',
                revue: 'absente',
                baseSha: null,
                resultId: 4,
                tests: 'passed',
              },
              ombre: null,
              verdict: null,
              confiance: null,
            },
            {
              provenance: 'shadow',
              tacheOriginale: 't1',
              tacheOmbre: 'o1',
              modeleOmbre: 'fable',
              categorie: 'code',
              depuis: 1,
              etat: 'comparee',
              original: {
                modele: 'opus',
                issue: 'tests_verts',
                revue: 'validee',
                baseSha: 'a',
                resultId: 3,
                tests: 'passed',
              },
              ombre: {
                modele: 'fable',
                issue: 'tests_rouges',
                revue: 'contestee',
                baseSha: 'a',
                resultId: 5,
                tests: 'failed',
              },
              verdict: 'originale_meilleure',
              confiance: 'haute',
            },
          ],
        })}
        erreur={null}
      />,
    );
    const lignes = [...dom.querySelectorAll('[data-testid="genome-ombre-comparaison"]')].map(
      (l) => l.textContent ?? '',
    );
    expect(lignes[0]).toContain('ombre haiku');
    expect(lignes[0]).toContain('en vol');
    expect(lignes[1]).toContain('l’originale fait mieux (confiance haute)');
    expect(lignes[1]).toContain('ombre : tests rouges, originale : tests verts');
    expect(dom.querySelector('[data-testid="genome-ombre-ligne"]')?.textContent).toContain(
      '(dont 1 en ombre)',
    );
    expect(dom.querySelector('[data-testid="genome-ombre"]')?.textContent).toContain(
      'provenance « shadow »',
    );
  });
});
