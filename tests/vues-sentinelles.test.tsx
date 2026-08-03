// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// CINQ SENTINELLES, UNE PAR VUE — les survivantes isolées du balayage.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a laissé une survivante ISOLÉE dans cinq
// endroits du dashboard, plus une dans le module partagé. Elles n'ont pas de
// famille : chacune reçoit sa sentinelle ici, avec ce que l'écran raconterait
// de faux si elle vivait :
//
//   · Ruche `{total > 0 && (…)}` — mutée en `||`, une ruche VIDE afficherait
//     « 0/0 tâches butinées » en bandeau de progrès ;
//   · Rayon `{projet?.repoUrl && (…)}` — mutée en `||`, un repoUrl présent
//     serait rendu CRU — avec le jeton qu'il peut porter — au lieu de passer
//     par `sansIdentifiants` ;
//   · Chantiers `verdict.code !== null && …` — mutée, « (code 1) » disparaît
//     des verdicts réels et « (code null) » apparaît sur les autres ;
//   · Santé `taskId === null ? '' : ' clickable'` — mutée, le fantôme qui
//     mène à une tâche perd son habit cliquable, et celui qui ne mène nulle
//     part l'endosse ;
//   · OpenAlex `{error && <p className="modal-error">…}` — mutée en `||`,
//     une erreur vide s'affiche au repos et la vraie erreur perd son habit ;
//   · shared `countPendingReviews` — mutée en `||`, le badge compterait les
//     tâches déjà revues et celles encore en vol.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveEvent, StateSnapshot, Task } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchGhosts: vi.fn(() => Promise.resolve(null)),
  fetchThermo: vi.fn(() => Promise.resolve(null)),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchGardiennes: vi.fn(() => Promise.resolve(null)),
  fetchGuet: vi.fn(() => Promise.resolve(null)),
  fetchChantiers: vi.fn(() => Promise.resolve({ chantiers: [] })),
  fetchVerdictChantier: vi.fn(() => Promise.resolve({ resultat: null })),
  fetchWorkflows: vi.fn(() => Promise.resolve({ workflows: [] })),
  fetchRuns: vi.fn(() => Promise.resolve({ runs: [] })),
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
  fetchApercu: vi.fn(() => Promise.resolve(null)),
  fetchFichierRayon: vi.fn(() => Promise.resolve(null)),
  fetchMonTableau: vi.fn(() => Promise.resolve(null)),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchMemories: vi.fn(() => Promise.resolve({ total: 0, memories: [] })),
  fetchServeurs: vi.fn(() => Promise.resolve(null)),
  fetchCles: vi.fn(() => Promise.resolve({ noeuds: [], billets: [] })),
  fetchMembres: vi.fn(() =>
    Promise.resolve({
      membres: [],
      admins: 0,
      inscription: { mode: 'ouverte', avertissement: '' },
    }),
  ),
}));

import {
  fetchEssaim,
  fetchGhosts,
  fetchGuet,
  fetchMemories,
  fetchMonTableau,
  fetchRayon,
  fetchServeurs,
  fetchVerdictChantier,
} from '../dashboard/src/api';
import { PleinEssaim } from '../dashboard/src/PleinEssaim';
import { BalanceProjet } from '../dashboard/src/views/Balance';
import Intendance from '../dashboard/src/views/Intendance';
import Memoire from '../dashboard/src/views/Memoire';
import { Journal } from '../dashboard/src/Journal';
import { OpenAlexPanel } from '../dashboard/src/OpenAlexPanel';
import MonEspace from '../dashboard/src/views/MonEspace';
import Reine from '../dashboard/src/views/Reine';
import Chantiers from '../dashboard/src/views/Chantiers';
import Rayon from '../dashboard/src/views/Rayon';
import Ruche from '../dashboard/src/views/Ruche';
import Sante from '../dashboard/src/views/Sante';
import { countPendingReviews } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  vi.mocked(fetchGhosts)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchGuet)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchVerdictChantier)
    .mockReset()
    .mockResolvedValue({ resultat: null } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function tache(id: string, titre: string, statut: Task['status']): Task {
  return {
    id,
    projectId: 'p1',
    title: titre,
    prompt: 'p',
    status: statut,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
  };
}

function instantane(over: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    projects: [],
    nodes: [],
    tasks: [],
    tasksTotal: 0,
    ...over,
  } as unknown as StateSnapshot;
}

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

function props(snapshot: StateSnapshot): ViewProps {
  return {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
}

describe('les sentinelles — une par survivante isolée', () => {
  it('RUCHE : une ruche vide n’affiche PAS « 0/0 tâches butinées »', async () => {
    const vide = await monter(<Ruche {...props(instantane())} />);
    expect(vide.textContent, 'aucun bandeau de progrès sans tâche').not.toContain(
      'tâches butinées',
    );

    act(() => racine?.unmount());
    const pleine = await monter(
      <Ruche {...props(instantane({ tasks: [tache('t1', 'Butinée', 'done')], tasksTotal: 1 }))} />,
    );
    expect(pleine.textContent).toContain('1/1');
    expect(pleine.textContent).toContain('tâches butinées');
  });

  it('RAYON : le repoUrl est LAVÉ de ses identifiants — jamais rendu cru', async () => {
    // Mutée en `||`, l'expression rendrait la CHAÎNE `repoUrl` telle quelle —
    // avec le jeton dedans — au lieu de l'élément `<code>` lavé.
    const dom = await monter(
      <Rayon
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: 'https://abeille:ghp_secret123@github.com/o/r',
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(dom.textContent, 'le jeton ne traverse JAMAIS l’écran').not.toContain('ghp_secret123');
    expect(dom.querySelector('.ry-depot')?.textContent).toContain('github.com/o/r');
  });

  it('CHANTIERS : le code de sortie ne s’écrit que quand il EXISTE', async () => {
    vi.mocked(fetchVerdictChantier).mockResolvedValue({
      resultat: { nom: 'tests', code: 1, sortie: '', ok: false },
    } as never);
    const battu = await monter(
      <Chantiers
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: null,
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(battu.textContent).toContain('tests — échoué');
    expect(battu.textContent, 'un vrai code se dit').toContain('(code 1)');

    act(() => racine?.unmount());
    vi.mocked(fetchVerdictChantier).mockResolvedValue({
      resultat: { nom: 'tests', code: null, sortie: '', ok: true },
    } as never);
    const sansCode = await monter(
      <Chantiers
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: null,
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(sansCode.textContent).toContain('tests — réussi');
    expect(sansCode.textContent, '« (code null) » est un mensonge').not.toContain('(code');
  });

  it('SANTÉ : seul le fantôme qui mène à une tâche est cliquable', async () => {
    vi.mocked(fetchGhosts).mockResolvedValue({
      ghosts: [
        { kind: 'looping_task', target: 't-boucle', severity: 'high', detail: '12 tours' },
        { kind: 'silent_node', target: 'n-fantome', severity: 'low', detail: 'muet' },
      ],
      scanned: { events: 10, nodes: 1, tasks: 2 },
    } as never);
    const dom = await monter(
      <Sante
        {...props(
          instantane({
            tasks: [tache('t-boucle', 'La tâche qui boucle', 'running')],
            nodes: [{ id: 'n-fantome', name: 'ruche-fantome' }] as never,
          }),
        )}
      />,
    );
    const items = [...dom.querySelectorAll('.es-ghost')];
    const versTache = items.find((l) => (l.textContent ?? '').includes('La tâche qui boucle'));
    const versNoeud = items.find((l) => (l.textContent ?? '').includes('ruche-fantome'));
    expect(versTache, 'le fantôme de tâche doit être listé').toBeTruthy();
    expect(versNoeud, 'le fantôme de nœud doit être listé').toBeTruthy();
    expect(versTache?.classList.contains('clickable'), 'la tâche s’ouvre au clic').toBe(true);
    expect(
      versNoeud?.classList.contains('clickable'),
      'un nœud n’a pas de tiroir — le curseur mentirait',
    ).toBe(false);
  });

  it('OPENALEX : l’erreur ne s’affiche que quand il y en a une, et dans son habit', async () => {
    vi.useFakeTimers();
    const repos = await monter(<OpenAlexPanel onClose={() => {}} />);
    expect(repos.querySelector('.modal-error'), 'aucune erreur au repos').toBeNull();

    // Une recherche qui échoue : le proxy répond 503 avec sa raison.
    vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ error: 'OpenAlex en panne' }),
    } as unknown as Response);
    const champ = repos.querySelector('.openalex-input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(champ) as object,
        'value',
      )?.set;
      setter?.call(champ, 'CRISPR');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    const erreur = repos.querySelector('.modal-error');
    expect(erreur, 'l’erreur porte son habit .modal-error').toBeTruthy();
    expect(erreur?.textContent).toContain('OpenAlex en panne');
  });

  it('SHARED : le badge « à revoir » ne compte NI les revues NI les tâches en vol', () => {
    localStorage.setItem('hive.review', JSON.stringify({ 't-revue': 'approved' }));
    const tasks = [
      tache('t-neuve', 'Neuve', 'done'),
      tache('t-revue', 'Revue', 'done'),
      tache('t-en-vol', 'En vol', 'running'),
    ];
    // Mutée en `||`, la revue compterait (statut vrai court-circuite) et la
    // tâche en vol aussi (!review vrai) : 3 au lieu de 1.
    expect(countPendingReviews(tasks)).toBe(1);
  });
});

// ─── Les sentinelles du balayage du soir ─────────────────────────────────────
//
// Le balayage élargi (base : premier commit du dépôt) a rendu de nouvelles
// survivantes isolées. Même règle qu'au-dessus : une par garde, avec ce que
// l'écran raconterait de faux si la mutation vivait.

describe('les sentinelles du balayage du soir', () => {
  it('JOURNAL : « En attente d’événements… » ne se dit QUE devant un journal vide', async () => {
    // `{events.length === 0 && (…)}` mutée en `||` : la ligne d'attente
    // s'afficherait SOUS un journal plein (une ruche active qui prétend
    // attendre), et disparaîtrait du journal vide (le seul moment où elle
    // renseigne). Les deux mondes se testent — la mutation les inverse tous
    // les deux.
    const evenement = (id: number): HiveEvent =>
      ({ id, ts: 1_700_000_000_000 + id, type: 'task_done', payload: {} }) as HiveEvent;
    const plein = await monter(<Journal events={[evenement(1), evenement(2)]} />);
    expect(plein.textContent, 'un journal plein n’attend rien').not.toContain(
      'En attente d’événements',
    );
    act(() => racine?.unmount());
    conteneur?.remove();

    const vide = await monter(<Journal events={[]} />);
    expect(vide.textContent, 'le journal vide le dit').toContain('En attente d’événements');
  });

  it('SANTÉ : l’erreur de la chasse aux fantômes porte son habit — et seulement elle', async () => {
    // `{ghost.error && <p className="panel-error">…}` mutée en `||` : au repos
    // un paragraphe d'erreur VIDE s'afficherait en permanence, et l'erreur
    // réelle serait rendue CRUE, sans son habit rouge. `ghost.error` est
    // l'erreur de la SONDE : le mock doit rejeter, pas rendre un payload.
    vi.mocked(fetchGhosts).mockRejectedValue(new Error('la chasse est tombée'));
    const dom = await monter(
      <Sante {...({ snapshot: instantane(), refreshTick: 0 } as unknown as ViewProps)} />,
    );
    const erreurs = [...dom.querySelectorAll('.panel-error')];
    expect(
      erreurs.some((e) => (e.textContent ?? '').includes('la chasse est tombée')),
      'l’erreur réelle porte .panel-error',
    ).toBe(true);
    expect(
      erreurs.every((e) => (e.textContent ?? '').trim() !== ''),
      'aucun habit d’erreur vide à l’écran',
    ).toBe(true);
  });

  it('SANTÉ : la liste des sondages du Guet n’existe QUE s’il y a des passages', async () => {
    // `{v.derniers.length > 0 && (…)}` mutée en `||` : avec des passages, le
    // court-circuit rend `true` — React n'affiche RIEN, la liste disparaît au
    // moment exact où elle informe ; sans passage, une liste vide s'afficherait.
    vi.mocked(fetchGuet).mockResolvedValue({
      niveau: 'reniflage',
      passages: 2,
      sources: 1,
      appats: ['/.env'],
      conseil: 'Ne rien exposer de plus.',
      derniers: [
        { source: '203.0.113.7', chemin: '/.env', appat: 'env', quand: 1_700_000_000_000 },
        { source: '203.0.113.7', chemin: '/.git/config', appat: 'git', quand: 1_700_000_001_000 },
      ],
    } as never);
    const avec = await monter(
      <Sante {...({ snapshot: instantane(), refreshTick: 0 } as unknown as ViewProps)} />,
    );
    const liste = avec.querySelector('.gu-liste');
    expect(liste, 'deux passages : la liste se montre').toBeTruthy();
    expect(liste?.querySelectorAll('li')).toHaveLength(2);
    expect(liste?.textContent).toContain('/.git/config');
    act(() => racine?.unmount());
    conteneur?.remove();

    vi.mocked(fetchGuet).mockResolvedValue({
      niveau: 'calme',
      passages: 0,
      sources: 0,
      appats: [],
      conseil: 'Rien à faire.',
      derniers: [],
    } as never);
    const sans = await monter(
      <Sante {...({ snapshot: instantane(), refreshTick: 0 } as unknown as ViewProps)} />,
    );
    expect(sans.querySelector('.gu-liste'), 'aucun passage : pas de liste vide').toBeNull();
  });

  it('REINE : le badge « 📡 état réel » ne se porte QUE sur la réponse calculée', async () => {
    // `{m.source === 'live' && (…)}` mutée en `||` : la réponse du modèle
    // porterait le badge du calcul réel (on ferait passer une supposition
    // pour une lecture d'instruments), et la réponse réellement calculée le
    // perdrait. Les messages vivent en sessionStorage : on sème, on monte.
    sessionStorage.setItem(
      'hive.reine.chat',
      JSON.stringify({
        messages: [
          { id: 'm-calc', role: 'queen', text: 'Trois ouvrières en vol.', ts: 1, source: 'live' },
          { id: 'm-llm', role: 'queen', text: 'Je pense que tout va bien.', ts: 2, source: 'llm' },
        ],
        suggestions: [],
      }),
    );
    const dom = await monter(<Reine {...({ snapshot: instantane() } as unknown as ViewProps)} />);
    sessionStorage.removeItem('hive.reine.chat');
    const bulles = [...dom.querySelectorAll('.rn-msg')];
    const calc = bulles.find((b) => (b.textContent ?? '').includes('Trois ouvrières'));
    const llm = bulles.find((b) => (b.textContent ?? '').includes('Je pense'));
    // § 2 terdecies, appliqué AVANT de se faire mordre une deuxième fois : la
    // branche llm porte AUSSI un `.rn-src` (« ✨ IA ») — le sélecteur est un
    // témoin partagé, seul le TEXTE du badge distingue les deux mondes.
    expect(calc?.textContent, 'la réponse calculée porte le badge du réel').toContain('état réel');
    expect(llm?.textContent, 'la supposition porte le badge du modèle').toContain('✨ IA');
    expect(llm?.textContent, 'la supposition ne se pare pas du réel').not.toContain('état réel');
  });

  it('MON ESPACE : le compte à rebours ne s’affiche QUE quand il reste des jours', async () => {
    // `{a.jours >= 0 && (…)}` mutée en `||` : l'alerte qui A une échéance
    // perdrait son compte à rebours (le court-circuit rend `true`, React
    // n'affiche rien), et l'échéance déjà passée (`jours: -1`) afficherait
    // « -1 j » — un délai négatif présenté comme du temps restant.
    const alerte = (cle: string, projet: string, jours: number) =>
      ({
        cle,
        gravite: 'attention',
        projectId: `p-${projet}`,
        projet,
        message: `alerte ${projet}`,
        jours,
        details: {},
      }) as never;
    vi.mocked(fetchMonTableau).mockResolvedValue({
      version: 1,
      projets: [],
      alertes: [
        alerte('quota_proche', 'rucher-a-terme', 5),
        alerte('quota_proche', 'rucher-echu', -1),
      ],
      totaux: { projets: 0, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 },
      balanceAJour: true,
      balanceMode: 'off',
    } as never);
    const dom = await monter(
      <MonEspace
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          onNavigate: () => {},
          // Sans session, la vue s'arrête à l'invitation — l'espace ne se
          // monte qu'une fois la personne connue.
          user: { displayName: 'apicultrice' },
        } as unknown as ViewProps)}
      />,
    );
    const lignes = [...dom.querySelectorAll('.me-alerte')];
    const aTerme = lignes.find((l) => (l.textContent ?? '').includes('rucher-a-terme'));
    const echue = lignes.find((l) => (l.textContent ?? '').includes('rucher-echu'));
    expect(aTerme, 'l’alerte à échéance est rendue').toBeTruthy();
    expect(
      aTerme?.querySelector('.me-jours')?.textContent ?? '',
      'l’échéance à venir se compte',
    ).toContain('5');
    expect(echue?.querySelector('.me-jours'), 'l’échéance passée ne se compte pas').toBeNull();
  });

  it('PLEIN ESSAIM : le compte d’observations ne se dit QUE s’il y en a', async () => {
    // `{etat.derive.echantillon > 0 && (…)}` mutée en `||` : le verdict de
    // santé annoncerait « 0 production(s) observée(s) » — une surveillance
    // qui prétend avoir observé alors qu'elle n'a rien vu — et le VRAI compte
    // disparaîtrait dès qu'il existe (le court-circuit rend `true`, React
    // n'affiche rien).
    const essaimUi = (echantillon: number) =>
      ({
        niveau: 'off',
        derive: { etat: 'saine', indicateurs: [], echantillon, solitudeJours: 0, motif: 'm' },
        decision: { pas: 'observer', motif: 'm', gouvernantes: [] },
        gouvernantes: [],
        gouvernantesRequises: 2,
        depotInscrit: false,
        plafond: 'passe',
        lecons: [],
        niveaux: ['off', 'propose', 'gouverne', 'plein'],
      }) as never;
    vi.mocked(fetchEssaim).mockResolvedValue(essaimUi(3));
    const avec = await monter(<PleinEssaim projectId="p1" />);
    expect(avec.textContent, 'trois productions observées se disent').toContain(
      '3 production(s) observée(s)',
    );
    act(() => racine?.unmount());
    conteneur?.remove();

    vi.mocked(fetchEssaim).mockResolvedValue(essaimUi(0));
    const sans = await monter(<PleinEssaim projectId="p1" />);
    expect(sans.textContent, 'zéro observation ne se décore pas').not.toContain(
      'production(s) observée(s)',
    );
  });

  it('RAYON : ouvrir un dossier montre SES enfants', async () => {
    // `{estDossier && rendre(e.chemin, profondeur + 1)}` mutée en `||` : le
    // court-circuit rend `true` sur chaque dossier — React n'affiche RIEN, et
    // les enfants d'un dossier déplié ne se montrent jamais. L'arbre entier
    // deviendrait une liste plate de racine.
    vi.mocked(fetchRayon).mockImplementation(((_p: string, chemin = '') =>
      Promise.resolve(
        chemin === ''
          ? {
              chemin: '',
              entrees: [
                { chemin: 'alveoles', nom: 'alveoles', type: 'dossier', taille: 0 },
                { chemin: 'miel.txt', nom: 'miel.txt', type: 'fichier', taille: 12 },
              ],
            }
          : {
              chemin,
              entrees: [
                { chemin: `${chemin}/couvain.ts`, nom: 'couvain.ts', type: 'fichier', taille: 5 },
              ],
            },
      )) as never);
    const dom = await monter(
      <Rayon
        {...props(
          instantane({
            projects: [
              {
                id: 'p1',
                name: 'Rucher',
                repoUrl: null,
                description: null,
                visibility: 'private',
                ownerId: null,
                createdAt: 1,
              },
            ] as never,
          }),
        )}
      />,
    );
    expect(dom.textContent, 'la racine se montre').toContain('alveoles');
    expect(dom.textContent, 'l’enfant ne se montre pas avant le dépli').not.toContain('couvain.ts');

    const bouton = [...dom.querySelectorAll('.ry-entree')].find((b) =>
      (b.textContent ?? '').includes('alveoles'),
    );
    expect(bouton, 'l’entrée du dossier existe').toBeTruthy();
    await act(async () => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(dom.textContent, 'le dossier déplié montre ses enfants').toContain('couvain.ts');
    vi.mocked(fetchRayon)
      .mockReset()
      .mockResolvedValue({ chemin: '', entrees: [] } as never);
  });

  it('BALANCE : le geste ARMÉ dit ce qu’il va faire — sinon on confirme à l’aveugle', async () => {
    // `{arme && cible !== null && (…)}` mutée en `===` : le plafond s'armerait
    // SANS jamais annoncer ce qu'il va couper. Le second clic — celui qui
    // engage — se ferait à l'aveugle, sur le geste qui peut arrêter
    // l'assignation d'un projet entier. La phrase d'avertissement EST la
    // moitié utile de l'armement.
    const solde = {
      projectId: 'p1',
      depenseMs: 0,
      tentatives: 0,
      plafondMs: null,
    } as never;
    const dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={solde}
        mode="observation"
        aJour={true}
      />,
    );
    const bouton = (libelle: string) =>
      [...dom.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(libelle));

    const ouvrir = bouton('Poser un plafond');
    expect(ouvrir, 'le geste de plafond est offert').toBeTruthy();
    act(() => {
      ouvrir?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const champ = dom.querySelector('.bal-plafond-input') as HTMLInputElement;
    expect(champ, 'le formulaire s’ouvre').toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(champ) as object,
        'value',
      )?.set;
      setter?.call(champ, '2');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      dom.querySelector('.bal-plafond-avert'),
      'au repos, aucun avertissement d’engagement',
    ).toBeNull();

    act(() => {
      bouton('Poser le plafond')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const avert = dom.querySelector('.bal-plafond-avert');
    expect(avert, 'armé, le geste annonce ce qu’il va faire').toBeTruthy();
    expect(avert?.textContent, 'il nomme le projet').toContain('Rucher');
    expect(avert?.textContent, 'il chiffre le plafond visé').toContain('2 h');
  });

  it('MÉMOIRE : le compteur dit « se souvient », pas « fouille », quand le compte EST là', async () => {
    // `{total === null ? fouille : se souvient de N}` mutée en `!==` : la
    // ruche qui SAIT afficherait « fouille ses rayons » à jamais, et le
    // chargement dirait « se souvient de null chose ».
    vi.mocked(fetchMemories).mockResolvedValue({ total: 3, memories: [] } as never);
    const dom = await monter(
      <Memoire
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          onOpenTask: () => {},
        } as unknown as ViewProps)}
      />,
    );
    expect(dom.textContent, 'le compte connu se dit').toContain('se souvient de 3 choses');
    expect(dom.textContent, 'plus de fouille une fois le compte connu').not.toContain(
      'fouille ses rayons',
    );
  });

  it('INTENDANCE : la ligne de suite n’existe QUE si elle a quelque chose à dire', async () => {
    // `{(erreur || note || aConfirmer) && (…)}` mutée en `||` : une rangée de
    // suite VIDE s'ouvrirait sous chaque machine au repos, et la confirmation
    // demandée se rendrait crue, hors de sa rangée. Le monde « avec » se
    // fabrique SANS réseau : demander l'effacement (→ effacé) ne fait que
    // poser `aConfirmer` — le vrai geste n'arrive qu'à la confirmation.
    vi.mocked(fetchServeurs).mockResolvedValue({
      vue: {
        total: 1,
        facturables: 1,
        parEtat: { demande: 0, provisionnement: 0, pret: 1, arrete: 0, supprime: 0, echoue: 0 },
        bientotSupprimes: [],
      },
      serveurs: [
        {
          id: 'srv-1',
          projectId: 'p1',
          projet: 'Rucher',
          refAbonnement: 'ab-1',
          etat: 'pret',
          fournisseur: 'manuel',
          refMachine: 'm-1',
          gabarit: '2vcpu',
          motif: '',
          creeA: 1,
          majA: 1,
          arreteA: 0,
          joursAvantSuppression: -1,
          transitions: ['supprime'],
        },
      ],
      fournisseur: 'manuel',
      retentionJours: 30,
      serveursMax: 8,
    } as never);
    const dom = await monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
    expect(dom.textContent, 'la machine est rendue').toContain('srv-1');
    expect(
      dom.querySelector('.in-ligne-suite'),
      'au repos, pas de rangée de suite vide',
    ).toBeNull();

    const bouton = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('→ supprimé'),
    );
    expect(bouton, 'le geste d’effacement est proposé (transitions)').toBeTruthy();
    await act(async () => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const suite = dom.querySelector('.in-ligne-suite');
    expect(suite, 'la demande de confirmation ouvre la rangée de suite').toBeTruthy();
    expect(suite?.textContent).toContain('Effacer définitivement cette machine ?');
  });
});
