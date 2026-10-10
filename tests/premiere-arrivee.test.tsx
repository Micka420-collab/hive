// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ASSISTANT DE PREMIÈRE ARRIVÉE — ouvert seul sur une ruche jamais
// configurée, repris où on l'a laissé, relançable, et fermé à qui ne peut pas
// écrire.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { EtatConfigurationInitiale } from '../dashboard/src/api';
import type { SanteInitiale } from '../src/shared/configuration-initiale';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {}, reconnecter: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
  fetchConfigurationInitiale: vi.fn(),
  rangerConfigurationInitiale: vi.fn(),
  terminerConfigurationInitiale: vi.fn(),
  fetchSanteInitiale: vi.fn(),
}));

import {
  connectFeed,
  fetchConfigurationInitiale,
  fetchSanteInitiale,
  rangerConfigurationInitiale,
  terminerConfigurationInitiale,
} from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { PremiereArrivee } from '../dashboard/src/PremiereArrivee';
import {
  doitOuvrirSeul,
  EVENT_PREMIERE_ARRIVEE,
  etapePrecedente,
  etapeSuivante,
} from '../dashboard/src/premiere-arrivee';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let poignees: FeedHandlers | null = null;

const VIERGE: EtatConfigurationInitiale = {
  configuration: null,
  ecriture: 'permis',
  coherence: [],
};

const SANTE: SanteInitiale = {
  verdict: 'risque',
  diagnostics: [
    { cle: 'node', gravite: 'ok', constat: 'Node 24', reparation: null },
    {
      cle: 'isolement',
      gravite: 'risque',
      constat: 'aucun moteur de bac à sable',
      reparation: 'sudo apt install bubblewrap',
    },
  ],
  agents: [
    { agent: 'claude-code', session: 'connectee', travaille: true, remede: null },
    { agent: 'codex', session: 'non_connectee', travaille: false, remede: 'codex login' },
  ],
  isolement: null,
  stockage: {
    chemin: '/srv/hive/data/hive.db',
    integre: true,
    inscriptible: true,
    octetsLibres: 5e9,
  },
  noeuds: { inscrits: 1, enLigne: 1 },
  coherence: [],
  releveA: 1,
};

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  sessionStorage.clear();
  location.hash = '';
  poignees = null;
  vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
    poignees = h;
    return { close: () => {}, reconnecter: () => {} };
  });
  vi.mocked(fetchConfigurationInitiale).mockReset();
  vi.mocked(rangerConfigurationInitiale).mockReset();
  vi.mocked(terminerConfigurationInitiale).mockReset();
  vi.mocked(fetchSanteInitiale).mockReset();
  vi.mocked(fetchSanteInitiale).mockResolvedValue(SANTE);
  vi.mocked(rangerConfigurationInitiale).mockImplementation((modif) =>
    Promise.resolve({
      ...VIERGE,
      configuration: {
        mode: null,
        secrets: null,
        git: null,
        connecteurs: [],
        etape: modif.etape ?? 'accueil',
        termineeA: null,
        majA: 1,
        majPar: { genre: 'jeton_de_ruche' },
      },
    }),
  );
});

afterEach(async () => {
  await laisserFinirLesVuesParesseuses();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(el: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(el));
  await act(async () => {});
  return conteneur;
}

async function connecter(): Promise<void> {
  await act(async () => {
    poignees!.onStatus(true);
  });
  await act(async () => {});
}

const assistant = () => document.querySelector<HTMLElement>('[data-testid="premiere-arrivee"]');
const bouton = (texte: string) =>
  [...(assistant()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent?.trim() === texte,
  );

async function cliquer(el: HTMLElement | undefined | null): Promise<void> {
  expect(el, 'élément attendu').toBeTruthy();
  await act(async () => el!.click());
  await act(async () => {});
}

describe('les décisions de l’assistant', () => {
  it('ne s’ouvre seul que sur une ruche jamais configurée, pour qui peut écrire', () => {
    expect(doitOuvrirSeul(VIERGE, false)).toBe(true);
    expect(doitOuvrirSeul(VIERGE, true)).toBe(false);
    expect(doitOuvrirSeul({ ...VIERGE, ecriture: 'reserve' }, false)).toBe(false);
    expect(doitOuvrirSeul(null, false)).toBe(false);
    const terminee = {
      ...VIERGE,
      configuration: {
        mode: 'local' as const,
        secrets: 'sessions_cli' as const,
        git: 'local' as const,
        connecteurs: [],
        etape: 'recap' as const,
        termineeA: 9,
        majA: 9,
        majPar: { genre: 'jeton_de_ruche' as const },
      },
    };
    expect(doitOuvrirSeul(terminee, false)).toBe(false);
  });

  it('les étapes se suivent dans l’ordre, bornées aux deux bouts', () => {
    expect(etapeSuivante('accueil')).toBe('mode');
    expect(etapeSuivante('recap')).toBe('recap');
    expect(etapePrecedente('accueil')).toBe('accueil');
    expect(etapePrecedente('git')).toBe('stockage');
  });
});

describe('dans l’App', () => {
  it('UNE RUCHE NEUVE : l’assistant s’ouvre seul, « Plus tard » le range pour l’onglet', async () => {
    vi.mocked(fetchConfigurationInitiale).mockResolvedValue(VIERGE);
    await monter(<App />);
    expect(assistant(), 'rien avant que la Reine ait répondu').toBeNull();
    await connecter();
    expect(assistant()).toBeTruthy();
    expect(assistant()!.getAttribute('role')).toBe('dialog');
    expect(assistant()!.getAttribute('aria-modal')).toBe('true');
    await cliquer(bouton('Plus tard'));
    expect(assistant()).toBeNull();
    // Une reconnexion du flux ne le rouvre pas dans ce même onglet.
    await connecter();
    expect(assistant()).toBeNull();
  });

  it('UN MEMBRE qui ne peut pas écrire ne voit jamais l’assistant', async () => {
    vi.mocked(fetchConfigurationInitiale).mockResolvedValue({ ...VIERGE, ecriture: 'reserve' });
    await monter(<App />);
    await connecter();
    expect(assistant()).toBeNull();
    await act(async () => window.dispatchEvent(new Event(EVENT_PREMIERE_ARRIVEE)));
    await act(async () => {});
    expect(assistant()).toBeNull();
  });

  it('UNE RUCHE CONFIGURÉE : rien ne s’ouvre seul, la relance le rouvre prérempli', async () => {
    vi.mocked(fetchConfigurationInitiale).mockResolvedValue({
      ...VIERGE,
      configuration: {
        mode: 'hybride',
        secrets: 'cles_reine',
        git: 'distant',
        connecteurs: ['github'],
        etape: 'recap',
        termineeA: 5,
        majA: 5,
        majPar: { genre: 'jeton_de_ruche' },
      },
    });
    await monter(<App />);
    await connecter();
    expect(assistant()).toBeNull();
    await act(async () => window.dispatchEvent(new Event(EVENT_PREMIERE_ARRIVEE)));
    await act(async () => {});
    expect(assistant()?.dataset.etape).toBe('recap');
    expect(assistant()!.textContent).toContain('Hybride');
    expect(assistant()!.textContent).toContain('Clés gardées par la Reine');
  });
});

describe('le parcours', () => {
  it('REPREND à l’étape rangée, avec les choix rangés', async () => {
    await monter(
      <PremiereArrivee
        etat={{
          ...VIERGE,
          configuration: {
            mode: 'local',
            secrets: null,
            git: 'local',
            connecteurs: [],
            etape: 'git',
            termineeA: null,
            majA: 1,
            majPar: { genre: 'jeton_de_ruche' },
          },
        }}
        projets={0}
        onFermer={() => {}}
        onNouveauProjet={() => {}}
        onTermine={() => {}}
      />,
    );
    expect(assistant()?.dataset.etape).toBe('git');
    const coche = assistant()!.querySelector<HTMLInputElement>('input[name="pa-git"]:checked');
    expect(coche?.value).toBe('local');
    expect(
      assistant()!.querySelector('[aria-current="step"]')?.textContent,
      'l’étape courante est annoncée',
    ).toContain('Git');
  });

  it('DE BOUT EN BOUT : chaque étape rangée, un choix exigé avant de passer, puis terminer', async () => {
    const onTermine = vi.fn();
    const onNouveauProjet = vi.fn();
    vi.mocked(terminerConfigurationInitiale).mockResolvedValue({
      ...VIERGE,
      configuration: {
        mode: 'local',
        secrets: 'sessions_cli',
        git: 'local',
        connecteurs: ['github'],
        etape: 'recap',
        termineeA: 7,
        majA: 7,
        majPar: { genre: 'jeton_de_ruche' },
      },
    });
    await monter(
      <PremiereArrivee
        etat={VIERGE}
        projets={0}
        onFermer={() => {}}
        onNouveauProjet={onNouveauProjet}
        onTermine={onTermine}
      />,
    );
    expect(assistant()?.dataset.etape).toBe('accueil');
    await cliquer(bouton('Commencer'));
    expect(vi.mocked(rangerConfigurationInitiale)).toHaveBeenLastCalledWith({ etape: 'mode' });

    // Le mode : « Suivant » éteint tant que rien n'est choisi, et il le dit.
    expect(assistant()?.dataset.etape).toBe('mode');
    expect(bouton('Suivant')!.disabled).toBe(true);
    expect(bouton('Suivant')!.getAttribute('aria-describedby')).toBe('pa-bloque');
    const local = assistant()!.querySelector<HTMLInputElement>('input[value="local"]')!;
    await act(async () => local.click());
    expect(bouton('Suivant')!.disabled).toBe(false);
    await cliquer(bouton('Suivant'));
    expect(vi.mocked(rangerConfigurationInitiale)).toHaveBeenLastCalledWith({
      mode: 'local',
      etape: 'agents',
    });

    // Les agents RÉELS, avec leur session.
    expect(assistant()?.dataset.etape).toBe('agents');
    expect(vi.mocked(fetchSanteInitiale)).toHaveBeenCalledTimes(1);
    const texte = assistant()!.textContent ?? '';
    expect(texte).toContain('connecté');
    expect(texte).toContain('non connecté');
    expect(texte).toContain('codex login');

    await cliquer(bouton('Suivant')); // stockage
    expect(assistant()!.textContent).toContain('/srv/hive/data/hive.db');
    await cliquer(bouton('Suivant')); // git
    await act(async () =>
      assistant()!.querySelector<HTMLInputElement>('input[name="pa-git"][value="local"]')!.click(),
    );
    await cliquer(bouton('Suivant')); // secrets
    await act(async () =>
      assistant()!.querySelector<HTMLInputElement>('input[value="sessions_cli"]')!.click(),
    );
    await cliquer(bouton('Suivant')); // connecteurs
    await act(async () =>
      assistant()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await cliquer(bouton('Suivant')); // projet
    expect(vi.mocked(rangerConfigurationInitiale)).toHaveBeenLastCalledWith({
      connecteurs: ['github'],
      etape: 'projet',
    });
    await cliquer(bouton('Créer mon premier projet'));
    expect(onNouveauProjet).toHaveBeenCalledTimes(1);
    await cliquer(bouton('Suivant')); // santé
    expect(assistant()!.textContent).toContain('sudo apt install bubblewrap');
    // Le bilan est relevé UNE fois pour tout le parcours, puis à la demande.
    expect(vi.mocked(fetchSanteInitiale)).toHaveBeenCalledTimes(1);
    await cliquer(bouton('Relancer le bilan'));
    expect(vi.mocked(fetchSanteInitiale)).toHaveBeenLastCalledWith(true);

    await cliquer(bouton('Suivant')); // récap
    expect(assistant()?.dataset.etape).toBe('recap');
    await cliquer(bouton('Terminer'));
    expect(vi.mocked(terminerConfigurationInitiale)).toHaveBeenCalledWith({
      mode: 'local',
      secrets: 'sessions_cli',
      git: 'local',
      connecteurs: ['github'],
    });
    expect(onTermine).toHaveBeenCalledTimes(1);
  });

  it('UNE ÉCRITURE REFUSÉE reste à l’écran, sur l’étape, avec son motif', async () => {
    vi.mocked(rangerConfigurationInitiale).mockRejectedValue(
      new Error('réservé à un administrateur de la ruche'),
    );
    await monter(
      <PremiereArrivee
        etat={VIERGE}
        projets={2}
        onFermer={() => {}}
        onNouveauProjet={() => {}}
        onTermine={() => {}}
      />,
    );
    await cliquer(bouton('Commencer'));
    expect(assistant()?.dataset.etape).toBe('accueil');
    expect(assistant()!.querySelector('[role="alert"]')?.textContent).toContain('administrateur');
  });

  it('ÉCHAP ferme sans rien perdre (le brouillon est chez la Reine)', async () => {
    const onFermer = vi.fn();
    await monter(
      <PremiereArrivee
        etat={VIERGE}
        projets={0}
        onFermer={onFermer}
        onNouveauProjet={() => {}}
        onTermine={() => {}}
      />,
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onFermer).toHaveBeenCalledTimes(1);
  });
});
