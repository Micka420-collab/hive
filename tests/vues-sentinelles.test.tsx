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
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
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
  fetchProjectBalance,
  fetchWorkflows,
  fetchGhosts,
  fetchGuet,
  fetchMemories,
  fetchMonTableau,
  fetchRayon,
  fetchServeurs,
  fetchVerdictChantier,
} from '../dashboard/src/api';
import { PleinEssaim } from '../dashboard/src/PleinEssaim';
import { BalanceProjet, CarteBalance } from '../dashboard/src/views/Balance';
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

  it('RUCHE : une ruche VIDE dit « aucune tâche en attente » — pas un vide muet', async () => {
    // LE PREMIER ÉCRAN D'UN NOUVEL ARRIVANT. `total === 0` mutée en `!==` :
    // nudité confirmée contre la suite entière (3 348 verts avec la mutation).
    // Le sentinel voisin garde le BANDEAU de progrès (`total > 0 && …`) ; ce
    // message-ci — celui que voit quelqu'un qui vient d'installer et n'a créé
    // aucune tâche — n'était gardé nulle part.
    //
    // Mutée, la liste est simplement VIDE : pas d'erreur, pas de « 0/0 », rien.
    // Or un écran vide sans un mot est le pire accueil : on ne sait pas si la
    // ruche marche, si l'on a raté une étape, ou si c'est normal. La phrase le
    // dit — c'est normal, et il n'y a rien à faire pour l'instant.
    const vide = await monter(<Ruche {...props(instantane())} />);
    expect(vide.textContent, 'une file vide se nomme, elle ne se tait pas').toContain(
      'Aucune tâche en attente',
    );

    act(() => racine?.unmount());
    // Et dès qu'une tâche attend, le message DISPARAÎT — sinon il mentirait sur
    // une ruche occupée. Le contraste tue la mutation : mutée, ce montage-ci
    // afficherait « aucune tâche » alors qu'une tâche est là.
    const occupee = await monter(
      <Ruche
        {...props(instantane({ tasks: [tache('t1', 'À butiner', 'ready')], tasksTotal: 1 }))}
      />,
    );
    expect(occupee.textContent, 'une file qui a du travail ne se dit pas vide').not.toContain(
      'Aucune tâche en attente',
    );
    expect(occupee.textContent, 'elle montre la tâche qui attend').toContain('À butiner');
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

  it('MON ESPACE : « expire AUJOURD’HUI » (0 jour) se compte encore — la borne, pas le signe', async () => {
    // LA MOITIÉ QUE LE SENTINEL VOISIN N'ATTEIGNAIT PAS. `a.jours >= 0` mutée en
    // `> 0` : nudité confirmée contre la suite entière. Le banc ci-dessus
    // éprouve 5 (à venir) et -1 (passé) — jamais **0**, et c'est précisément
    // `>= 0` vs `> 0` qui ne diffèrent QU'À ZÉRO.
    //
    // Or zéro jour, c'est « expire aujourd'hui » : le moment où le compte à
    // rebours est le PLUS utile. Muté, l'alerte la plus urgente perdrait son
    // « 0 j » et se tairait — l'apicultrice croirait avoir le temps. § 2
    // sexvicies : la question n'est pas « ce code est-il mort ? » mais « quel
    // cas réel mon banc n'atteint jamais ? ».
    const alerte = (projet: string, jours: number) =>
      ({
        cle: 'quota_proche',
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
      alertes: [alerte('rucher-aujourdhui', 0)],
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
          user: { displayName: 'apicultrice' },
        } as unknown as ViewProps)}
      />,
    );
    const ligne = [...dom.querySelectorAll('.me-alerte')].find((l) =>
      (l.textContent ?? '').includes('rucher-aujourdhui'),
    );
    expect(ligne, 'l’alerte du jour est rendue').toBeTruthy();
    expect(
      ligne?.querySelector('.me-jours')?.textContent ?? '',
      'zéro jour restant se compte encore — c’est « aujourd’hui », pas « jamais »',
    ).toContain('0');
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

  it('PLEIN ESSAIM : le niveau COURANT est marqué (aria-pressed + classe), pas l’inverse', async () => {
    // Survivantes loupe (§ 9 vicies, même famille que le Garde-Fous) :
    // `aria-pressed={etat.niveau === n}` et `className={etat.niveau === n ? 'actif' …}`.
    // Mutées en `!==`, la suite restait verte — un banc qui ne lit que le TEXTE
    // est aveugle à l'attribut ET à la classe. Or un lecteur d'écran (aria-pressed)
    // et le style CSS (`.actif`) les lisent : inverser marque TOUS les boutons SAUF
    // le bon comme choisis — le mauvais niveau annoncé « courant ».
    const etat = {
      niveau: 'gouverne',
      derive: { etat: 'saine', indicateurs: [], echantillon: 0, solitudeJours: 0, motif: 'm' },
      decision: { pas: 'observer', motif: 'm', gouvernantes: [] },
      gouvernantes: [],
      gouvernantesRequises: 2,
      depotInscrit: false,
      plafond: 'passe',
      lecons: [],
      niveaux: ['off', 'propose', 'gouverne', 'plein'],
    } as never;
    vi.mocked(fetchEssaim).mockResolvedValue(etat);
    const dom = await monter(<PleinEssaim projectId="p1" />);
    const boutons = [...dom.querySelectorAll('.essaim-niveau')] as HTMLButtonElement[];
    const actif = boutons.find((b) => b.textContent?.trim() === 'gouverne');
    const inactif = boutons.find((b) => b.textContent?.trim() === 'off');
    expect(actif?.getAttribute('aria-pressed'), 'le niveau courant est pressé').toBe('true');
    expect(actif?.className, 'le niveau courant porte la classe active').toContain('actif');
    expect(inactif?.getAttribute('aria-pressed'), 'un autre niveau n’est pas pressé').toBe('false');
    expect(inactif?.className, 'un autre niveau ne porte pas la classe active').not.toContain(
      'actif',
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

  it('RUCHE : le bouton du mode d’affichage COURANT porte la classe active', async () => {
    // Survivantes loupe (§ 9 vicies, la famille GardeFous / … / TaskDrawer) :
    // `className={mode === '2d' ? 'active' : ''}` et le jumeau '3d'. Mutées en
    // `!==`, la suite restait verte — aucun banc ne lisait quel bouton de mode
    // est allumé. La classe `.active` est la seule marque de « on regarde la 2D » :
    // inverser allume le bouton du mode qu'on ne voit PAS.
    localStorage.setItem('hive.view', '2d');
    const dom = await monter(<Ruche {...props(instantane())} />);
    const boutons = [...dom.querySelectorAll('.view-toggle button')] as HTMLButtonElement[];
    const d2 = boutons.find((b) => b.textContent?.trim() === '2D');
    const d3 = boutons.find((b) => b.textContent?.trim() === '3D');
    expect(d2?.className, '2D est le mode courant').toContain('active');
    expect(d3?.className, '3D ne l’est pas').not.toContain('active');
  });

  it('RAYON : l’entrée du fichier OUVERT porte la classe active — pas une autre', async () => {
    // Survivante loupe (§ 9 vicies) : `ry-entree${ouvert === e.chemin ? ' active'}`.
    // Mutée en `!==`, la suite restait verte — aucun banc ne lisait quelle entrée
    // est surlignée. La classe `.active` est la seule marque du fichier ouvert :
    // inverser surligne toutes les entrées SAUF celle qu'on lit.
    vi.mocked(fetchRayon).mockResolvedValue({
      chemin: '',
      entrees: [
        { chemin: 'miel.txt', nom: 'miel.txt', type: 'fichier', taille: 12 },
        { chemin: 'cire.txt', nom: 'cire.txt', type: 'fichier', taille: 8 },
      ],
    } as never);
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
    const entree = (nom: string): HTMLButtonElement | undefined =>
      [...dom.querySelectorAll('.ry-entree')].find((b) => (b.textContent ?? '').includes(nom)) as
        HTMLButtonElement | undefined;
    // Rien d'ouvert au départ : aucune entrée n'est active.
    expect(entree('miel.txt')?.className, 'aucune entrée active avant ouverture').not.toContain(
      'active',
    );
    await act(async () => {
      entree('miel.txt')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(entree('miel.txt')?.className, 'le fichier ouvert est actif').toContain('active');
    expect(entree('cire.txt')?.className, 'un autre fichier ne l’est pas').not.toContain('active');
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

  it('OPENALEX : le DOI ne se lie QUE s’il existe — pas de lien mort', async () => {
    // `{paper.doi && (…)}` mutée en `||` : le court-circuit rend `true` sur un
    // article QUI A un DOI (React n'affiche rien : le lien disparaît au moment
    // où il sert), et un article SANS DOI recevrait un lien vers
    // `https://doi.org/null`. Une bibliographie qui envoie sur une page morte
    // vaut moins que pas de lien du tout.
    vi.useFakeTimers();
    const article = (id: string, doi: string | null) => ({
      id,
      title: `Article ${id}`,
      doi,
      year: 2024,
      citedBy: 3,
      authors: ['Une abeille'],
      abstract: null,
      type: 'article',
      openAccess: true,
      url: null,
    });
    vi.spyOn(window, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          results: [article('avec', '10.1234/abeille'), article('sans', null)],
          total: 2,
          page: 1,
        }),
    } as unknown as Response);
    const dom = await monter(<OpenAlexPanel onClose={() => {}} />);
    const champ = dom.querySelector('.openalex-input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(champ) as object,
        'value',
      )?.set;
      setter?.call(champ, 'abeilles');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    const liens = [...dom.querySelectorAll('.oa-doi')];
    expect(liens, 'un seul des deux articles porte un DOI').toHaveLength(1);
    expect(liens[0]?.getAttribute('href'), 'le lien pointe sur le vrai DOI').toContain(
      '10.1234/abeille',
    );
    expect(dom.textContent, 'aucun « null » ne traverse l’écran').not.toContain('doi.org/null');
  });

  it('PLEIN ESSAIM : le ⚠ ne marque que les leçons SYSTÉMIQUES', async () => {
    // `l.portee === 'systemique'` mutée en `!==` : le ⚠ irait aux leçons
    // vues sur UNE machine (un incident local présenté comme un défaut du
    // code) et la vraie leçon systémique — celle qui dit « ça vient du code,
    // pas d'une machine » — perdrait sa marque. C'est l'inverse exact de ce
    // que la portée sert à distinguer.
    vi.mocked(fetchEssaim).mockResolvedValue({
      niveau: 'off',
      derive: { etat: 'saine', indicateurs: [], echantillon: 2, solitudeJours: 0, motif: 'm' },
      decision: { pas: 'observer', motif: 'm', gouvernantes: [] },
      gouvernantes: [],
      gouvernantesRequises: 2,
      depotInscrit: false,
      plafond: 'passe',
      lecons: [
        { signature: 'sig-sys', portee: 'systemique', noeuds: 3, extrait: 'panne partagée' },
        { signature: 'sig-loc', portee: 'locale', noeuds: 1, extrait: 'panne isolée' },
      ],
      niveaux: ['off', 'propose', 'gouverne', 'plein'],
    } as never);
    const dom = await monter(<PleinEssaim projectId="p1" />);
    const lignes = [...dom.querySelectorAll('.essaim-lecon')];
    const sys = lignes.find((l) => (l.textContent ?? '').includes('panne partagée'));
    const loc = lignes.find((l) => (l.textContent ?? '').includes('panne isolée'));
    expect(
      sys?.querySelector('.essaim-lecon-portee')?.textContent,
      'la systémique porte le ⚠',
    ).toContain('⚠');
    expect(
      loc?.querySelector('.essaim-lecon-portee')?.textContent,
      'la locale ne l’usurpe pas',
    ).not.toContain('⚠');
  });

  it('JOURNAL : le coût s’affiche quand il EXISTE, et se tait sinon', async () => {
    // `typeof v === 'number' && Number.isFinite(v)` mutée en `!==` : la durée
    // d'une tâche terminée disparaîtrait du journal (elle EST un nombre), et
    // un événement sans durée — ceux d'avant ce lot, ou `no_working_agent`
    // qui n'en a aucune — passerait à `formatDuree(undefined)`. L'en-tête du
    // module le promet en toutes lettres : « jamais un 0 ms inventé ».
    const ev = (id: number, type: string, payload: Record<string, unknown>): HiveEvent =>
      ({ id, ts: 1_700_000_000_000 + id, type, payload }) as HiveEvent;
    const dom = await monter(
      <Journal
        events={[
          ev(1, 'task_done', { taskId: 't-chiffree', durationMs: 1_500 }),
          ev(2, 'task_done', { taskId: 't-muette' }),
        ]}
      />,
    );
    const ligne = (marque: string) =>
      [...dom.querySelectorAll('.jrow')].find((l) => (l.textContent ?? '').includes(marque));

    expect(ligne('t-chiffr')?.textContent, 'la durée connue se dit').toContain('1.5 s');
    const muette = ligne('t-muette')?.textContent ?? '';
    expect(muette, 'la ligne sans durée existe').not.toBe('');
    expect(muette, 'aucune durée inventée').not.toContain(' en ');
    expect(dom.textContent, 'et surtout aucun NaN à l’écran').not.toContain('NaN');
  });

  it('JOURNAL : une durée NaN ou infinie NE S’AFFICHE PAS — l’autre moitié de la garde', async () => {
    // LA MOITIÉ QUE LE BANC VOISIN N'ATTEIGNAIT PAS.
    //
    // La garde est `typeof v === 'number' && Number.isFinite(v)`. Le banc
    // ci-dessus éprouve une durée ABSENTE — et `typeof undefined === 'number'`
    // est déjà faux, donc `Number.isFinite` n'y sert jamais à rien. Muter le
    // `&&` en `||` le laissait vert : nudité confirmée contre la suite ENTIÈRE
    // (3 336 verts avec la mutation en place).
    //
    // `Number.isFinite` ne porte que pour `NaN` et l'infini — et c'est
    // précisément ce qu'une charge utile malformée produit : une soustraction
    // de dates dont l'une manque rend `NaN`, pas `undefined`. L'en-tête du
    // module promet « jamais un 0 ms inventé » ; sans cette moitié-là, il
    // afficherait « terminée en NaN ».
    const ev = (id: number, type: string, payload: Record<string, unknown>): HiveEvent =>
      ({ id, ts: 1_700_000_000_000 + id, type, payload }) as HiveEvent;
    const dom = await monter(
      <Journal
        events={[
          ev(1, 'task_done', { taskId: 't-nan', durationMs: Number.NaN }),
          ev(2, 'task_done', { taskId: 't-inf', durationMs: Number.POSITIVE_INFINITY }),
          ev(3, 'task_done', { taskId: 't-vraie', durationMs: 1_500 }),
        ]}
      />,
    );
    const ligne = (marque: string) =>
      [...dom.querySelectorAll('.jrow')].find((l) => (l.textContent ?? '').includes(marque));

    // Le CONTRASTE, dans le même rendu : la vraie durée s'affiche, les deux
    // fausses se taisent. Un banc qui ne montrerait que les silences resterait
    // vert sur une garde qui ne dirait plus jamais rien.
    expect(ligne('t-vraie')?.textContent, 'la durée réelle se dit toujours').toContain('1.5 s');
    expect(ligne('t-nan')?.textContent, 'NaN ne devient pas une durée').not.toContain(' en ');
    expect(ligne('t-inf')?.textContent, 'l’infini non plus').not.toContain(' en ');
    expect(dom.textContent, 'et rien de tout cela ne fuit à l’écran').not.toMatch(/NaN|Infinity|∞/);
  });

  it('CHANTIERS : « aucun workflow déclaré » ne se dit QUE s’il n’y en a aucun', async () => {
    // Survivante du balayage de nuit : `workflows.length === 0` mutée en
    // `!==` — un dépôt QUI A des workflows s'entendrait dire qu'il n'en
    // déclare aucun (on irait en écrire un qui existe déjà), et un dépôt qui
    // n'en a pas afficherait la liste vide avec son champ de branche : une
    // commande sans rien à commander.
    const projet = instantane({
      projects: [
        {
          id: 'p1',
          name: 'Rucher',
          repoUrl: 'https://github.com/o/r',
          description: null,
          visibility: 'private',
          ownerId: null,
          createdAt: 1,
        },
      ] as never,
    });

    vi.mocked(fetchWorkflows).mockResolvedValue({ workflows: [] } as never);
    const sans = await monter(<Chantiers {...props(projet)} />);
    expect(sans.textContent, 'aucun workflow : on le dit').toContain('Aucun workflow déclaré');
    act(() => racine?.unmount());
    conteneur?.remove();

    vi.mocked(fetchWorkflows).mockResolvedValue({
      // Les champs sont FRANÇAIS (`nom`, `chemin`) : le dépôt parle sa langue
      // jusque dans ses types, et un banc en anglais rendrait des cellules
      // vides sans que rien ne proteste.
      workflows: [{ id: 1, nom: 'CI', chemin: '.github/workflows/ci.yml', etat: 'active' }],
    } as never);
    const avec = await monter(<Chantiers {...props(projet)} />);
    expect(avec.textContent, 'un workflow existe : on ne prétend pas le contraire').not.toContain(
      'Aucun workflow déclaré',
    );
    expect(avec.textContent, 'et on le nomme').toContain('CI');
  });

  it('BALANCE : « posé par… » ne s’affiche QUE si un plafond est posé', async () => {
    // `plafondMs !== null && trace` mutée en `===` : la trace du geste humain
    // s'afficherait sur un projet SANS plafond (« Posé par… » un plafond qui
    // n'existe pas) et disparaîtrait de celui qui en a un — précisément là où
    // elle sert : savoir QUI a borné un projet, et QUAND, est ce qui rend le
    // geste discutable au lieu d'être subi.
    // La trace ne vient PAS du solde : elle est lue par une sonde à part
    // (`fetchProjectBalance`), et seulement pour les projets qui ONT un
    // plafond. Un banc qui la posait dans le solde jugeait une vue qui ne la
    // lit jamais — quatrième banc trop léger de la nuit.
    vi.mocked(fetchProjectBalance).mockResolvedValue({
      projectId: 'p1',
      depenseMs: 1_000,
      tentatives: 1,
      plafondMs: 3_600_000,
      definiPar: 'utilisateur-abcdef12',
      updatedAt: 1_800_000_000_000,
    } as never);
    const solde = (plafondMs: number | null) =>
      ({ projectId: 'p1', depenseMs: 1_000, tentatives: 1, plafondMs }) as never;

    const sans = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={solde(null)}
        mode="observation"
        aJour={true}
      />,
    );
    expect(
      sans.querySelector('.bal-plafond-trace'),
      'aucun plafond posé : aucune trace à montrer',
    ).toBeNull();
    act(() => racine?.unmount());
    conteneur?.remove();

    const avec = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={solde(3_600_000)}
        mode="observation"
        aJour={true}
      />,
    );
    const trace = avec.querySelector('.bal-plafond-trace');
    expect(trace, 'un plafond posé : on dit par qui').toBeTruthy();
    // L'écran ne montre que les huit premiers caractères de l'identifiant —
    // assez pour reconnaître, trop peu pour exposer (l'entier est dans le
    // `title`). C'est ce qu'on juge, pas ce qu'on aurait aimé lire.
    expect(trace?.textContent, 'et le nom court de l’opérateur y est').toContain('utilisat');
  });

  it('BALANCE : « grand livre à l’arrêt » ne se dit QU’EN mode off', async () => {
    // `balance.mode === 'off'` mutée en `!==` : une ruche qui TIENT ses
    // comptes annoncerait que le grand livre est arrêté (on cesserait de se
    // fier à des soldes pourtant justes), et une ruche en mode « off »
    // afficherait le message de rattrapage — un rattrapage qui n'aura jamais
    // lieu, puisque rien n'est tenu.
    const etat = (mode: string) =>
      ({
        version: 1,
        mode,
        aJour: false,
        fenetre: 100,
        pesee: {
          version: 1,
          // La carte se TAIT sur une pesée vide (« rien pesé ») : le banc doit
          // porter du miel, sinon on juge une branche qu'on ne vise pas.
          global: {
            utileMs: 60_000,
            repriseMs: 0,
            echecMs: 0,
            rebuteMs: 0,
            totalMs: 60_000,
            tentatives: 4,
            rendement: 1,
          },
          parProjet: [],
          parNoeud: [],
          reprises: { taches: 0, tentatives: 0 },
          corpus: { taches: 3, tentatives: 4, ignorees: 0 },
        },
        soldes: [],
      }) as never;

    const arret = await monter(
      <CarteBalance balance={etat('off')} erreur={null} snapshot={instantane()} />,
    );
    expect(arret.textContent, 'en mode off, on le dit').toContain('Grand livre à l’arrêt');
    expect(arret.textContent, 'et on ne promet pas de rattrapage').not.toContain(
      'Rattrapage du grand livre',
    );
    act(() => racine?.unmount());
    conteneur?.remove();

    const tenu = await monter(
      <CarteBalance balance={etat('observation')} erreur={null} snapshot={instantane()} />,
    );
    expect(tenu.textContent, 'grand livre tenu mais en retard : c’est un rattrapage').toContain(
      'Rattrapage du grand livre',
    );
    expect(tenu.textContent, 'et surtout pas « à l’arrêt »').not.toContain('Grand livre à l’arrêt');
  });
});
