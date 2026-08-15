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
  setProjectPlafond: vi.fn(() => Promise.resolve({ definiPar: null, updatedAt: null })),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchMemories: vi.fn(() => Promise.resolve({ total: 0, memories: [] })),
  fetchServeurs: vi.fn(() => Promise.resolve(null)),
  fetchCles: vi.fn(() => Promise.resolve({ noeuds: [], billets: [] })),
  setMembreRole: vi.fn(() => Promise.resolve({ userId: 'u', role: 'admin' })),
  fetchMembres: vi.fn(() =>
    Promise.resolve({
      membres: [],
      admins: 0,
      inscription: { mode: 'ouverte', avertissement: '' },
    }),
  ),
}));

import {
  fetchApercu,
  fetchChantiers,
  fetchEssaim,
  fetchCles,
  fetchProjectBalance,
  setProjectPlafond,
  fetchWorkflows,
  fetchGhosts,
  fetchGuet,
  fetchMemories,
  fetchMonTableau,
  fetchRayon,
  fetchMembres,
  fetchRuns,
  fetchServeurs,
  setMembreRole,
  fetchVerdictChantier,
} from '../dashboard/src/api';
import { PleinEssaim } from '../dashboard/src/PleinEssaim';
import { BalanceProjet, CarteBalance, CarteDevis } from '../dashboard/src/views/Balance';
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
  // ─── ON DÉMONTE LE PRÉCÉDENT, ET C'EST UN DÉFAUT MESURÉ ────────────────────
  //
  // `monter` rend `document.body` (les modales se montent par PORTAIL, hors du
  // conteneur). Sans ce nettoyage, deux appels dans un MÊME banc laissaient
  // deux arbres empilés dans le corps : le second cherchait ses éléments et
  // trouvait aussi ceux du premier.
  //
  // Le premier banc à monter trois états d'affilée l'a payé — il accusait la
  // vue de montrer « ARRÊTÉE » sur un projet qui ne l'était pas, alors que le
  // bandeau venait du montage PRÉCÉDENT. L'`afterEach` ne rattrapait rien : il
  // ne connaît que le DERNIER conteneur, les autres fuyaient jusqu'à la fin du
  // fichier.
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  // Le corps entier, pas le seul conteneur : une modale se monte par PORTAIL à
  // la racine du document (voir `Voile`), donc hors de cet arbre-ci.
  return document.body;
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

  it('BALANCE : la dépense est attribuée au BON nœud, pas au premier venu', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     snapshot.nodes.find((n) => n.id === nodeId)?.name ?? `${nodeId…}…`
    //
    // Mutée en `!==`, `find` rend le PREMIER nœud dont l'identifiant DIFFÈRE —
    // c'est-à-dire, presque toujours, le voisin. Le tableau des dépenses
    // attribuerait alors le temps d'une ouvrière à une autre, sur l'écran qui
    // sert à décider qui coûte cher.
    //
    // Le repli `nodeId.slice(0, 8)…` compte autant : un nœud inconnu du
    // relevé doit se reconnaître à son identifiant, pas emprunter un nom.
    const balance = {
      pesee: {
        global: { totalMs: 300, tentatives: 3 },
        parNoeud: [
          { nodeId: 'abeille-deux', totalMs: 200, tentatives: 2 },
          { nodeId: 'inconnue-au-releve-xyz', totalMs: 100, tentatives: 1 },
        ],
        corpus: { retenues: 3, ignorees: 0 },
        // `CarteBalance` lit `reprises` au-dessus du tableau par nœud (l. 319).
        // L'omettre faisait tomber le montage sur un `TypeError` AVANT que la
        // garde ne regarde quoi que ce soit : un banc rouge pour une raison
        // qui n'est pas la sienne ne mesure rien.
        reprises: { taches: 1, tentatives: 1 },
      },
    } as never;
    const vue = {
      ...instantane(),
      nodes: [
        { id: 'abeille-une', name: 'Abeille UNE' },
        { id: 'abeille-deux', name: 'Abeille DEUX' },
      ],
    } as never;

    const dom = await monter(<CarteBalance balance={balance} erreur={null} snapshot={vue} />);
    const lignes = [...dom.querySelectorAll('.bal-noeuds tbody tr, .bal-noeuds tr')]
      .map((tr) => tr.querySelector('th')?.textContent?.trim() ?? '')
      .filter((n) => n !== '');

    expect(lignes, 'aucune ligne par nœud').not.toEqual([]);
    // Le nœud CONNU porte SON nom — pas celui du voisin.
    expect(lignes, 'la dépense est attribuée au mauvais nœud').toContain('Abeille DEUX');
    expect(lignes, 'un nom voisin s’est glissé dans le tableau').not.toContain('Abeille UNE');
    // Et l'inconnu se reconnaît à son identifiant tronqué, sans emprunter de nom.
    expect(lignes.join(' | '), 'le nœud inconnu n’est pas identifiable').toContain('inconnue');
  });

  it('BALANCE : un plafond de ZÉRO heure est un geste VALIDE, pas une saisie refusée', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     const valide = saisie.trim() !== '' && Number.isFinite(heures) && heures >= 0;
    //
    // Mutée en `>`, une saisie de « 0 » devient invalide et le geste ne s'arme
    // plus. Or plafonner à zéro est le geste le PLUS fort de cet écran : il
    // arrête l'assignation du projet. Le refuser en silence retire à
    // l'utilisateur le seul frein immédiat dont il dispose.
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
        mode="strict"
        aJour={true}
      />,
    );
    const bouton = (libelle: string) =>
      [...dom.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(libelle));

    act(() => {
      bouton('Poser un plafond')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const champ = dom.querySelector('.bal-plafond-input') as HTMLInputElement;
    expect(champ, 'le champ de plafond n’est pas offert').toBeTruthy();

    // ─── VISER LE BON BOUTON ───────────────────────────────────────────────
    //
    // Il y en a DEUX qui disent « Poser » : l'ouvre-formulaire (« Poser un
    // plafond »), qui n'est jamais désarmé, et le bouton d'envoi (« Poser le
    // plafond »), qui est le seul que `cible === null` verrouille. Chercher par
    // libellé attrapait le premier — le banc voyait donc un bouton actif quoi
    // qu'on saisisse, et aurait été vert même sur un produit cassé.
    const envoi = () =>
      dom.querySelector('.bal-plafond-form .bal-plafond-actions button.btn.primary');
    expect(envoi(), 'le bouton d’envoi du plafond est introuvable').toBeTruthy();

    // ─── ET LA SAISIE DOIT VRAIMENT ARRIVER ────────────────────────────────
    //
    // React pose un « traceur » sur la propriété `value` du nœud : une
    // affectation directe met à jour le traceur EN MÊME TEMPS que la valeur, si
    // bien que React compare deux fois la même chose et conclut que rien n'a
    // bougé — l'`onChange` ne part pas. Le banc voyait alors une saisie vide
    // quoi qu'on écrive. On passe donc par le mutateur du PROTOTYPE, qui écrit
    // la valeur sans toucher au traceur (même idiome que `compte-porte`).
    const ecrire = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    expect(ecrire, 'le mutateur natif de `value` est introuvable').toBeTypeOf('function');

    const poser = (valeur: string) => {
      act(() => {
        ecrire?.call(champ, valeur);
        champ.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const b = envoi();
      return b !== null && !(b as HTMLButtonElement).disabled;
    };

    expect(poser('0'), 'un plafond de 0 heure devrait être posable').toBe(true);
    expect(poser('2'), 'un plafond de 2 heures devrait être posable').toBe(true);
    // Et le refus garde son sens : une saisie vide ou négative ne s'arme pas.
    expect(poser('-1'), 'un plafond négatif ne devrait PAS être posable').toBe(false);
  });

  it('BALANCE : la phrase des IGNORÉES ne se dit que s’il y en a', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {pesee.corpus.ignorees > 0 && ` ${t('… ignorée(s) : leur tâche a
    //                                          disparu du corpus …')}`}
    //
    // Le commentaire au-dessus dit l'intention : « un chiffre qui ne dit pas ce
    // qu'il n'a pas vu ment ». La borne porte les DEUX moitiés de cette phrase.
    //
    // Mutée en `>=`, l'écran annonce « 0 ignorée(s) : leur tâche a disparu du
    // corpus » sur un relevé complet — il invente une perte. Mutée en `<`, il
    // se tait quand des tentatives ont VRAIMENT été écartées — il cache la
    // perte. Les deux sens abîment la même promesse.
    const avec = (ignorees: number) =>
      ({
        pesee: {
          global: { totalMs: 300, tentatives: 3 },
          parNoeud: [],
          corpus: { taches: 2, tentatives: 3, ignorees },
          reprises: { taches: 0, tentatives: 0 },
        },
        fenetre: 200,
        mode: 'strict',
      }) as never;
    const vue = { ...instantane(), nodes: [] } as never;

    const texte = async (ignorees: number): Promise<string> => {
      const dom = await monter(
        <CarteBalance balance={avec(ignorees)} erreur={null} snapshot={vue} />,
      );
      return dom.querySelector('.bal-corpus')?.textContent ?? '';
    };

    const muet = await texte(0);
    expect(muet, 'le relevé du corpus est introuvable').toContain('Lu :');
    expect(muet, 'l’écran invente une perte qui n’a pas eu lieu').not.toContain('ignorée');

    const parlant = await texte(4);
    expect(parlant, 'l’écran cache des tentatives réellement écartées').toContain('4 ignorée');
  });

  it('BALANCE : un plafond refusé dit POURQUOI, quelle que soit la forme du refus', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
    //
    // C'est le seul endroit où l'opérateur apprend que son geste a échoué. Deux
    // formes de refus arrivent ici : une `Error` (le cas courant), et tout le
    // reste — un rejet nu que rien n'oblige à être une `Error`.
    //
    // Mutée en `true`, `e.message` vaut `undefined` sur un rejet nu : le
    // bandeau s'affiche VIDE, et l'opérateur voit « Plafond refusé : » suivi de
    // rien. Mutée en `false`, une `Error` passe par `String(e)` et l'utilisateur
    // lit « Error: … » — le bruit de la plomberie au lieu du motif.
    const solde = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs: null } as never;

    const refusPar = async (jete: unknown): Promise<string> => {
      vi.mocked(setProjectPlafond).mockRejectedValueOnce(jete);
      const dom = await monter(
        <BalanceProjet
          projectId="p1"
          projectName="Rucher"
          compte={null}
          solde={solde}
          mode="strict"
          aJour={true}
        />,
      );
      const clic = (b: Element | null | undefined) =>
        act(() => {
          b?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
      clic(
        [...dom.querySelectorAll('button')].find((b) =>
          (b.textContent ?? '').includes('Poser un plafond'),
        ),
      );
      const champ = dom.querySelector('.bal-plafond-input') as HTMLInputElement;
      const ecrire = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      act(() => {
        ecrire?.call(champ, '2');
        champ.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const envoi = () =>
        dom.querySelector('.bal-plafond-form .bal-plafond-actions button.btn.primary');
      // Le geste demande une CONFIRMATION : un premier clic arme, le second pose.
      clic(envoi());
      clic(envoi());
      await act(async () => {});
      return dom.querySelector('.bal-plafond-form .panel-error')?.textContent ?? '';
    };

    const surErreur = await refusPar(new Error('quota de ruche dépassé'));
    expect(surErreur, 'le refus ne dit pas son motif').toContain('quota de ruche dépassé');
    // Le motif SEUL : pas la classe de l'objet qui l'a transporté.
    expect(surErreur, 'la plomberie remonte jusqu’à l’écran').not.toContain('Error:');

    // Un rejet nu — ce que rend un `reject('…')` ou une couche qui jette une
    // chaîne. Le bandeau doit rester PARLANT.
    const surChaine = await refusPar('la ruche a coupé');
    expect(surChaine, 'un rejet nu laisse le bandeau muet').toContain('la ruche a coupé');

    // ─── LA TROISIÈME FORME, QUE LE BALAYAGE COMPLET A RÉCLAMÉE ────────────
    //
    // `instanceof Error` mutée en `instanceof Object` survivait aux deux cas
    // ci-dessus : une `Error` EST un objet, une chaîne n'en est PAS un, donc
    // les deux mondes s'y comportent pareil. Ce n'était pas une équivalence —
    // c'était une ENTRÉE QUI MANQUAIT.
    //
    // Un objet nu les départage : `String(e)` rend « [object Object] », laid
    // mais présent, là où `e.message` rendrait `undefined` et laisserait le
    // bandeau réduit à son étiquette.
    //
    // On n'épingle PAS « [object Object] » : ce serait sanctifier une verrue.
    // Ce qu'on exige, c'est qu'il reste un MOTIF derrière l'étiquette — un
    // bandeau qui n'annonce que « Plafond refusé : » ne refuse rien, il fait
    // douter de l'écran.
    const surObjet = await refusPar({ code: 418 });
    const motif = surObjet.replace('Plafond refusé :', '').trim();
    expect(motif, 'le bandeau se réduit à son étiquette : aucun motif').not.toBe('');
  });

  it('BALANCE : « Retirer le plafond » ne s’offre QUE là où il y a un plafond', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {plafondMs !== null && ( <button …>Retirer le plafond</button> )}
    //
    // Mutée en `===`, la porte s'inverse : le bouton apparaît sur un projet qui
    // n'a PAS de plafond — où il ne peut qu'appeler `appliquer(null)` pour
    // retirer ce qui n'existe pas — et DISPARAÎT sur celui qui en a un. Or
    // c'est le seul geste qui relâche un projet bloqué : sans lui, l'opérateur
    // n'a plus de frein à desserrer. Mutée en `||`, il s'offre toujours.
    const carte = async (plafondMs: number | null): Promise<HTMLElement> => {
      const solde = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs } as never;
      return monter(
        <BalanceProjet
          projectId="p1"
          projectName="Rucher"
          compte={null}
          solde={solde}
          mode="strict"
          aJour={true}
        />,
      );
    };
    const retirer = (dom: HTMLElement): Element | undefined =>
      [...dom.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('Retirer le plafond'),
      );

    const avec = await carte(7_200_000);
    expect(retirer(avec), 'un projet plafonné ne peut plus être relâché').toBeTruthy();

    const sans = await carte(null);
    expect(retirer(sans), 'on propose de retirer un plafond qui n’existe pas').toBeUndefined();
  });

  it('BALANCE : l’aperçu du plafond CONVERTIT la saisie, il ne la répète pas', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {cible === null ? t('Un nombre d’heures — « 0 » est licite…')
    //                     : t(`soit ${formatDuree(cible)} de temps machine prêté`)}
    //
    // Le commentaire de la vue dit l'enjeu : « un opérateur ne doit jamais
    // découvrir après coup qu'il a posé 30 h en croyant poser 30 min ».
    // L'aperçu est la seule chose qui l'en empêche.
    //
    // Mutée en `!==`, les deux moitiés s'échangent : une saisie valide n'est
    // plus convertie (on retombe sur la consigne générale), et un champ VIDE
    // passe dans `formatDuree(null)`.
    const solde = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs: null } as never;
    const dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={solde}
        mode="strict"
        aJour={true}
      />,
    );
    act(() => {
      [...dom.querySelectorAll('button')]
        .find((b) => (b.textContent ?? '').includes('Poser un plafond'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const champ = dom.querySelector('.bal-plafond-input') as HTMLInputElement;
    const apercu = (): string => dom.querySelector('.bal-plafond-apercu')?.textContent ?? '';

    // Champ vide : la consigne, et surtout PAS une durée fabriquée à partir de rien.
    expect(apercu(), 'le champ vide n’explique pas ce qu’on attend').toContain('0');
    expect(apercu(), 'une durée sort d’un champ vide').not.toContain('temps machine prêté');

    // Une demi-heure saisie en HEURES doit se lire en minutes.
    const ecrire = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      ecrire?.call(champ, '0.5');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(apercu(), 'la saisie n’est pas convertie dans l’unité de la Balance').toContain(
      '30 min',
    );
  });

  it('BALANCE : la trace du plafond n’invente pas une date qu’elle n’a pas', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {trace.updatedAt !== null && ` · ${new Date(trace.updatedAt).toLocaleString()}`}
    //
    // La trace répond à « qui a posé ce plafond, et quand ». Le « quand » peut
    // manquer : le commentaire de la vue l'admet — « mieux vaut “qui ?” manquant
    // que le plafond caché ».
    //
    // Mutée en `===`, le « quand » s'affiche PRÉCISÉMENT quand il n'existe pas :
    // `new Date(null)` vaut le 1ᵉʳ janvier 1970, et l'écran daterait d'il y a
    // cinquante-six ans un plafond posé ce matin. Mutée dans l'autre sens, la
    // date réelle disparaît.
    const solde = {
      projectId: 'p1',
      depenseMs: 0,
      tentatives: 0,
      plafondMs: 7_200_000,
    } as never;

    const trace = async (updatedAt: number | null): Promise<string> => {
      vi.mocked(fetchProjectBalance).mockResolvedValueOnce({
        definiPar: 'abcdef1234567890',
        updatedAt,
      } as never);
      const dom = await monter(
        <BalanceProjet
          projectId="p1"
          projectName="Rucher"
          compte={null}
          solde={solde}
          mode="strict"
          aJour={true}
        />,
      );
      await act(async () => {});
      return dom.querySelector('.bal-plafond-trace')?.textContent ?? '';
    };

    const datee = await trace(Date.UTC(2026, 0, 15, 12));
    expect(datee, 'la trace du plafond est introuvable').toContain('abcdef12');
    expect(datee, 'la date réelle de pose a disparu').toContain('2026');

    const sansDate = await trace(null);
    expect(sansDate, 'la trace a disparu quand la date manque').toContain('abcdef12');
    // Ni 1970, ni « Invalid Date », ni séparateur orphelin : RIEN.
    expect(sansDate, 'l’écran a inventé une date de pose').not.toContain('1970');
    expect(sansDate, 'un séparateur pend sans rien derrière').not.toContain(' · ');
  });

  // ─── LES TROIS PORTES QUI DÉCIDENT QU'ON VOIT LA BALANCE D'UN PROJET ───────
  //
  //     const aPesee   = compte !== null && compte.totalMs > 0;
  //     const aSolde   = mode !== 'off' && solde !== null;
  //     const aPlafond = (solde?.plafondMs ?? null) !== null;
  //     if (!aPesee && !aSolde && !aPlafond) return null;
  //
  // Le commentaire au-dessus porte l'intention entière : « ni pesée
  // exploitable, ni solde tenu, ni plafond posé ⇒ rien à dire sur ce projet, et
  // surtout pas un bloc vide qui laisserait croire à une panne. Un plafond, lui,
  // se montre TOUJOURS dès qu'il existe […] c'est précisément le projet (bloqué
  // à zéro dépense) qu'il ne faut pas rendre invisible. »
  //
  // Le balayage COMPLET du fichier — pas seulement ses lignes ajoutées — a
  // trouvé ces trois-là nues, chacune survivant à la suite ENTIÈRE. Elles
  // décident de la VISIBILITÉ d'un bloc : rien de plus silencieux qu'une
  // information qui ne s'affiche pas.
  const projet = (
    compte: unknown,
    solde: unknown,
    mode: 'strict' | 'observation' | 'off',
    aJour = true,
  ): React.ReactElement => (
    <BalanceProjet
      projectId="p1"
      projectName="Rucher"
      compte={compte as never}
      solde={solde as never}
      mode={mode}
      aJour={aJour}
    />
  );

  it('BALANCE : un projet SANS RIEN À DIRE se tait — pas de bloc vide', async () => {
    // `compte.totalMs > 0` mutée en `>=` : une pesée à zéro devient « une
    // pesée », et la carte s'ouvre sur « 0 % de rendement · 0 s prêtées ». Ce
    // n'est pas une information, c'est un bloc qui occupe la place et laisse
    // croire qu'on regarde quelque chose.
    const dom = await monter(projet({ totalMs: 0, tentatives: 0, parPoste: {} }, null, 'off'));
    expect(
      dom.querySelector('.bal-projet'),
      'un projet sans dépense, sans solde et sans plafond affiche quand même un bloc',
    ).toBeNull();
  });

  it('BALANCE : un projet PLAFONNÉ se voit, même s’il n’a jamais rien dépensé', async () => {
    // ─── LE CAS QUE LE COMMENTAIRE NOMME EXPRESSÉMENT ──────────────────────
    //
    // `(solde?.plafondMs ?? null) !== null` mutée en `===` inverse la porte :
    // le projet SANS plafond s'affiche, et celui QUI EN A UN disparaît. Or
    // c'est exactement le projet bloqué à zéro dépense — celui qu'un opérateur
    // cherche quand il se demande pourquoi rien n'avance.
    const plafonne = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs: 7_200_000 };
    const avec = await monter(projet(null, plafonne, 'off'));
    expect(
      avec.querySelector('.bal-projet'),
      'un projet plafonné à zéro dépense est devenu invisible',
    ).toBeTruthy();

    // Et la porte garde son sens dans l'autre sens : sans plafond, sans pesée
    // et sans grand livre, il n'y a rien à montrer.
    const sans = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs: null };
    const sansRien = await monter(projet(null, sans, 'off'));
    expect(
      sansRien.querySelector('.bal-projet'),
      'un projet sans plafond ni dépense affiche un bloc',
    ).toBeNull();
  });

  it('BALANCE : le GRAND LIVRE se tait en mode « off », où il n’existe pas', async () => {
    // `mode !== 'off' && solde !== null` mutée en `||` : le grand livre
    // s'affiche alors que le serveur ne le tient pas. Il montrerait « 0 s sur 0
    // tentative(s), depuis toujours » — un zéro qui se lit « ce projet n'a rien
    // coûté » alors qu'il veut dire « personne ne compte ».
    const solde = { projectId: 'p1', depenseMs: 0, tentatives: 0, plafondMs: 7_200_000 };
    const off = await monter(projet(null, solde, 'off'));
    expect(off.querySelector('.bal-projet'), 'le plafond doit rester visible').toBeTruthy();
    expect(
      off.querySelector('.bal-projet-solde'),
      'le grand livre parle alors que le mode « off » ne le tient pas',
    ).toBeNull();

    // En mode tenu, il parle — sinon la garde ci-dessus serait vraie pour la
    // mauvaise raison (un grand livre qui ne s'affiche JAMAIS).
    const tenu = await monter(projet(null, solde, 'strict'));
    expect(tenu.querySelector('.bal-projet-solde'), 'le grand livre ne dit rien').toBeTruthy();
  });

  it('BALANCE : « rattrapage en cours » ne se dit QUE pendant le rattrapage', async () => {
    // `{!aJour && ' ⏳ rattrapage en cours'}` mutée en `||` : le sablier ne
    // s'éteint plus jamais. Un chiffre éternellement marqué « incomplet » ne se
    // lit plus du tout — et le jour où il l'est vraiment, rien ne le distingue.
    const solde = { projectId: 'p1', depenseMs: 60_000, tentatives: 2, plafondMs: null };
    const aJour = await monter(projet(null, solde, 'strict', true));
    expect(
      aJour.querySelector('.bal-projet-solde')?.textContent ?? '',
      'le grand livre à jour s’annonce en rattrapage',
    ).not.toContain('rattrapage');

    const enRetard = await monter(projet(null, solde, 'strict', false));
    expect(
      enRetard.querySelector('.bal-projet-solde')?.textContent ?? '',
      'le grand livre en retard ne l’avoue pas',
    ).toContain('rattrapage');
  });

  // ─── LE DEVIS : DEUX LIGNES QUI DISENT CE QU'IL NE SAIT PAS ────────────────
  const devis = (echantillons: readonly number[]): unknown => ({
    totalMedianeMs: 3_600_000,
    totalP90Ms: 7_200_000,
    parTache: echantillons.map((n, i) => ({
      title: `Tâche ${i + 1}`,
      // `DOMAINE_LABEL` n'a pas de clé « code » : un domaine inventé fait
      // tomber le rendu AVANT la garde (§ 9 quinnonagies, troisième fois).
      domaine: 'api',
      medianeMs: 600_000,
      p90Ms: 900_000,
      echantillon: n,
    })),
  });

  it('DEVIS : la PLAGE d’échantillon dit un seul chiffre quand il n’y en a qu’un', async () => {
    // `min === max ? \`${min}\` : \`${min}–${max}\`` mutée en `!==` échange les
    // deux : un échantillon homogène s'annonce « 4–4 », et un échantillon qui
    // va de 2 à 90 s'annonce « 2 ». Le second est le vrai dégât — il cache
    // l'écart, c'est-à-dire la seule chose que ce chiffre existe pour dire.
    const egal = await monter(<CarteDevis devis={devis([4, 4]) as never} nbTaches={2} />);
    expect(
      egal.querySelector('.bal-devis-sample')?.textContent ?? '',
      'un échantillon homogène s’annonce comme une plage',
    ).toContain('4 tâche');

    const etendu = await monter(<CarteDevis devis={devis([2, 90]) as never} nbTaches={2} />);
    const texte = etendu.querySelector('.bal-devis-sample')?.textContent ?? '';
    expect(texte, 'l’écart de l’échantillon est caché').toContain('2–90');
  });

  it('DEVIS : « chiffrées sur N » ne s’affiche que s’il MANQUE des tâches', async () => {
    // `chiffrees < nbTaches` mutée en `<=` : la note « 3 tâche(s) chiffrée(s)
    // sur 3 : les autres n'ont pas encore assez de tâches comparables » se
    // contredit à l'écran. Mutée en `||`, elle ne s'éteint jamais.
    const notes = (dom: HTMLElement): string =>
      [...dom.querySelectorAll('.bal-note')].map((n) => n.textContent ?? '').join(' | ');

    const complet = await monter(<CarteDevis devis={devis([5, 5]) as never} nbTaches={2} />);
    expect(notes(complet), 'un devis complet se dit incomplet').not.toContain('chiffrée(s) sur');

    const partiel = await monter(<CarteDevis devis={devis([5, 5]) as never} nbTaches={7} />);
    expect(notes(partiel), 'un devis partiel ne dit pas ce qu’il ignore').toContain(
      '2 tâche(s) chiffrée(s) sur 7',
    );
  });

  it('BALANCE : LE CAS ZÉRO ne rend jamais NaN sur l’écran de l’argent', async () => {
    // ─── TROIS BORNES NUES, UN SEUL CAS ────────────────────────────────────
    //
    //     plafondMs > 0 ? Math.floor((depenseMs * 100) / plafondMs) : 100   > → >=
    //     total > 0 ? `${Math.round((n.totalMs / total) * 100)} %` : '—'    > → >=
    //
    // Les deux gardes protègent la MÊME chose : une division par zéro. Mutées
    // en `>=`, le zéro passe dans la formule et l'écran affiche « NaN % » —
    // sur la page qui parle de plafonds et de dépense.
    //
    // `partPlafond` porte même son intention en commentaire : « un plafond de
    // zéro est atteint par définition, pas une division par zéro ». L'intention
    // était écrite ; rien ne la vérifiait.

    // 1. PLAFOND DE ZÉRO — atteint par définition : 100 %, pas NaN.
    const soldeZero = {
      projectId: 'p1',
      depenseMs: 0,
      tentatives: 0,
      plafondMs: 0,
      etat: 'bloque',
      bloque: true,
    } as never;
    const dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={soldeZero}
        mode="observation"
        aJour={true}
      />,
    );
    const jauge = dom.querySelector('.bal-plafond-chiffres')?.textContent ?? '';
    expect(jauge, 'un plafond de zéro rend NaN').not.toContain('NaN');
    expect(jauge, 'un plafond de zéro vaut 100 % par définition').toContain('100');

    // ─── LE SECOND MUTANT EST ÉQUIVALENT, ET C'EST CONSIGNÉ SUR PLACE ──────
    //
    // `total > 0 ? … : '—'` dans `TableauNoeuds` ne peut PAS être éprouvé :
    // `CarteBalance` court-circuite sur `global.totalMs === 0` et n'affiche
    // jamais le tableau dans ce cas. Aucune entrée ne distingue `>` de `>=`.
    //
    // La consignation est dans `Balance.tsx`, à la ligne même (§ 2.16 ter) —
    // pas ici, parce qu'un lecteur du code doit la trouver sans chercher le
    // banc qui l'a établie.
  });

  it('BALANCE : « ARRÊTÉE » ne se dit QUE si l’assignation est vraiment arrêtée', async () => {
    // ─── TROIS GARDES NUES SUR L'ÉCRAN DE L'ARGENT ─────────────────────────
    //
    //     const bloque = solde.bloque === true;      ===  →  !==
    //     {bloque && (…)}                            &&   →  ||
    //     {!bloque && etat === 'bloque' && (…)}      ===  →  !==
    //
    // Les deux bandeaux ne disent PAS la même chose :
    //
    //   « ARRÊTÉE »  l'assignation est stoppée pour de bon — la ruche tourne en
    //                « strict » et le plafond est atteint ;
    //   « atteint »  le plafond est atteint mais RIEN n'est arrêté.
    //
    // Les confondre, c'est annoncer à quelqu'un que son projet est à l'arrêt
    // quand il tourne — ou se taire quand il est vraiment stoppé. Sur l'écran
    // qui parle de plafonds et de dépense, c'est la pire des deux erreurs
    // possibles, dans les deux sens.
    const soldeAvec = (bloque: boolean, etat: string) =>
      ({
        projectId: 'p1',
        depenseMs: 90_000,
        tentatives: 0,
        plafondMs: 100_000,
        etat,
        bloque,
      }) as never;

    const bandeaux = (dom: HTMLElement) => ({
      arretee: dom.querySelector('.bal-plafond-badge.bloque') !== null,
      atteint: dom.querySelector('.bal-plafond-badge.atteint') !== null,
    });

    // 1. VRAIMENT arrêtée : le bandeau « ARRÊTÉE », et lui seul.
    let dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={soldeAvec(true, 'bloque')}
        mode="observation"
        aJour={true}
      />,
    );
    expect(bandeaux(dom), 'arrêtée : « ARRÊTÉE » seul').toEqual({ arretee: true, atteint: false });

    // 2. Plafond atteint mais RIEN d'arrêté : l'autre bandeau, et lui seul.
    dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={soldeAvec(false, 'bloque')}
        mode="observation"
        aJour={true}
      />,
    );
    expect(bandeaux(dom), 'atteint sans arrêt : « atteint » seul').toEqual({
      arretee: false,
      atteint: true,
    });

    // 3. Rien d'atteint : aucun bandeau. Sans ce cas, un mutant qui montrerait
    //    TOUJOURS un bandeau passerait les deux premiers.
    dom = await monter(
      <BalanceProjet
        projectId="p1"
        projectName="Rucher"
        compte={null}
        solde={soldeAvec(false, 'passe')}
        mode="observation"
        aJour={true}
      />,
    );
    expect(bandeaux(dom), 'sous le plafond : aucun bandeau').toEqual({
      arretee: false,
      atteint: false,
    });
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
  // ─── LES SURVIVANTES DU BALAYAGE DE `dashboard/src/views` ──────────────────
  //
  // Base épinglée `f0fc005`. Trois de plus, choisies sur un critère : le mutant
  // fait DIRE quelque chose de faux à l'écran, pas seulement quelque chose de
  // laid. Une section vide qui s'affiche est disgracieuse ; une file d'attente
  // qui montre l'inverse de son titre est un mensonge.

  it('RUCHE : la file d’attente montre ce qui ATTEND, pas ce qui est fini', async () => {
    // `task.status !== 'done'` mutée en `===` retourne l'écran principal d'un
    // arrivant : le panneau s'appelle « File d'attente », et il n'y montrerait
    // QUE les tâches terminées, en cachant tout ce qui reste à faire.
    //
    // Rien ne casse, rien n'avertit. Sur une ruche neuve où tout est en attente,
    // la file paraîtrait VIDE — donc « il n'y a rien à faire », alors que tout
    // est à faire. C'est le contresens le plus cher que cet écran puisse dire.
    const dom = await monter(
      <Ruche
        {...props(
          instantane({
            tasks: [
              tache('t-attente', 'Fermer la faille du jeton', 'pending'),
              tache('t-finie', 'Butinée hier', 'done'),
            ],
            tasksTotal: 2,
          }),
        )}
      />,
    );
    const file = dom.querySelector('.queue');
    expect(file, 'la file existe').toBeTruthy();
    const texte = file?.textContent ?? '';
    expect(texte, 'ce qui ATTEND s’y trouve').toContain('Fermer la faille du jeton');
    expect(texte, 'ce qui est FINI n’y est pas').not.toContain('Butinée hier');
  });

  it('MON ESPACE : le motif d’arrêt ne s’affiche que là où il EXISTE', async () => {
    // `p.etatAbonnement !== 'aucun'` mutée en `===` inverse exactement les deux
    // cartes : le projet ARRÊTÉ perd la phrase qui dit POURQUOI il l'est, et le
    // projet sans abonnement gagne un paragraphe stylé au contenu vide.
    //
    // La phrase perdue est celle qu'on cherche quand plus rien ne butine. Sans
    // elle, l'écran montre un projet inactif sans un mot d'explication —
    // exactement l'état où l'on croit à une panne alors que c'est un impayé.
    const projet = (id: string, actif: boolean, etat: string, motif: string) =>
      ({
        projectId: id,
        nom: id,
        role: 'owner',
        plan: 'essaim',
        etatAbonnement: etat,
        finPeriode: null,
        actif,
        motifDroits: motif,
        heures: 0,
        plafondMs: null,
        depenseMs: 0,
        partConsommee: null,
        serveurs: [],
        autonomie: 'off',
      }) as never;
    vi.mocked(fetchMonTableau).mockResolvedValue({
      version: 1,
      projets: [
        projet('rucher-arrete', false, 'echu', 'période échue'),
        projet('rucher-sans-abo', false, 'aucun', ''),
      ],
      alertes: [],
      totaux: { projets: 2, serveursActifs: 0, heuresIncluses: 0, depenseMs: 0 },
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
    const cartes = [...dom.querySelectorAll('article')];
    const arrete = cartes.find((c) => (c.textContent ?? '').includes('rucher-arrete'));
    const sansAbo = cartes.find((c) => (c.textContent ?? '').includes('rucher-sans-abo'));
    expect(arrete, 'la carte du projet arrêté est rendue').toBeTruthy();
    expect(sansAbo, 'la carte du projet sans abonnement est rendue').toBeTruthy();
    expect(
      arrete?.querySelector('.me-motif')?.textContent ?? '',
      'le projet ARRÊTÉ dit pourquoi',
    ).toContain('période échue');
    expect(
      sansAbo?.querySelector('.me-motif'),
      'le projet SANS abonnement n’a aucun motif à afficher',
    ).toBeNull();
  });

  it('CHANTIERS : les deux refus ne se confondent pas — ils appellent des gestes différents', async () => {
    // `c.nature === 'sortant'` mutée en `!==` échange les deux phrases. Elles
    // ne disent pas la même chose et n'appellent pas le même geste :
    //
    //   « Sort de la machine — demande un humain »  se contourne, quelqu'un le fait
    //   « Nature inconnue — non automatisable »     se corrige, on renomme le script
    //
    // Échangées, on cherche à renommer un script qu'aucun renommage ne rendra
    // automatisable, et on attend un humain pour un chantier que personne n'a
    // su classer. Deux impasses, et l'écran a l'air sûr de lui dans les deux.
    vi.mocked(fetchChantiers).mockResolvedValue({
      chantiers: [
        {
          nom: 'deployer',
          commande: 'npm run deploy',
          nature: 'sortant',
          automatisable: false,
        },
        {
          nom: 'mystere',
          commande: './fait-quelque-chose',
          nature: 'inconnu',
          automatisable: false,
        },
      ],
    } as never);
    const dom = await monter(
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
    const items = [...dom.querySelectorAll('.ch-item')];
    const sortant = items.find((l) => (l.textContent ?? '').includes('deployer'));
    const inconnu = items.find((l) => (l.textContent ?? '').includes('mystere'));
    expect(sortant, 'le chantier sortant est rendu').toBeTruthy();
    expect(inconnu, 'le chantier de nature inconnue est rendu').toBeTruthy();
    expect(
      sortant?.querySelector('.ch-refus')?.textContent ?? '',
      'ce qui sort de la machine demande un humain',
    ).toContain('demande un humain');
    expect(
      inconnu?.querySelector('.ch-refus')?.textContent ?? '',
      'ce qu’on n’a pas su classer se corrige en renommant',
    ).toContain('Nature inconnue');
  });
  // ─── LA FAMILLE « SECTION VIDE », ET UNE QUI N'EN EST PAS UNE ──────────────
  //
  // Les quatre derniers survivants nommés du balayage. Trois sont des sections
  // qui s'afficheraient à vide ; la première n'est PAS cosmétique du tout, et
  // je l'avais rangée là par erreur dans la PR précédente.

  it('INTENDANCE : pas de fausse alerte d’effacement DÉFINITIF', async () => {
    // `vue.bientotSupprimes.length > 0` mutée en `>= 0` rend le paragraphe même
    // quand la liste est VIDE. Ce n'est pas une section disgracieuse : c'est un
    // `role="status"` — donc ANNONCÉ À VOIX HAUTE par un lecteur d'écran — qui
    // dit « Effacement définitif imminent — le travail de ces machines part
    // avec elles : » et ne nomme AUCUNE machine.
    //
    // Une fausse alerte sur un effacement irréversible est le pire message que
    // cet écran puisse produire : elle appelle un geste de panique (payer,
    // sauvegarder en urgence) pour un danger qui n'existe pas.
    const sansMachine = {
      total: 0,
      facturables: 0,
      parEtat: { demande: 0, provisionnement: 0, pret: 0, arrete: 0, supprime: 0, echoue: 0 },
    };
    vi.mocked(fetchServeurs).mockResolvedValue({
      vue: { ...sansMachine, bientotSupprimes: [] },
      serveurs: [],
      fournisseur: 'manuel',
      retentionJours: 30,
      serveursMax: 8,
    } as never);
    const calme = await monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
    // Sur la CLASSE seule, ce banc rougirait le jour où l'avertissement
    // d'inscription — qui porte le même `.in-alerte` dans la section des
    // comptes — devient non vide. On vise donc la PHRASE.
    const alertes = (dom: HTMLElement) =>
      [...dom.querySelectorAll('.in-alerte')].filter((e) =>
        (e.textContent ?? '').includes('Effacement définitif'),
      );
    expect(alertes(calme), 'aucune machine en sursis ⇒ AUCUNE alerte annoncée').toHaveLength(0);

    act(() => racine?.unmount());
    vi.mocked(fetchServeurs).mockResolvedValue({
      vue: { ...sansMachine, bientotSupprimes: [{ id: 'srv-condamne', jours: 2 }] },
      serveurs: [],
      fournisseur: 'manuel',
      retentionJours: 30,
      serveursMax: 8,
    } as never);
    const alarme = await monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
    const texte = alertes(alarme)[0]?.textContent ?? '';
    expect(texte, 'une vraie alerte NOMME la machine').toContain('srv-condamne');
    expect(texte, 'et son délai').toContain('2');
  });

  it('CHANTIERS : aucune exécution ⇒ pas de liste vide', async () => {
    // `runs.length > 0` mutée en `>= 0` rend un `<ul className="ch-runs">` vide.
    // Un projet neuf n'a jamais rien lancé : c'est l'état de départ de tout le
    // monde, et l'écran y montrerait une liste d'exécutions sans exécution.
    vi.mocked(fetchRuns).mockResolvedValue({ runs: [] } as never);
    const dom = await monter(
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
    expect(dom.querySelector('.ch-runs'), 'rien lancé ⇒ aucune liste').toBeNull();
  });

  it('RAYON : au repos, AUCUN avertissement — et une vraie erreur garde son habit', async () => {
    // `{apercuErreur && …}` mutée en `||` casse les deux sens :
    //   · au repos (`null`), le court-circuit rend le `<p>` : un « ⚠ » nu
    //     s'affiche en permanence, sans rien dire ;
    //   · avec une VRAIE erreur, l'expression rend la CHAÎNE seule — le
    //     paragraphe, sa classe et le pictogramme disparaissent, et le message
    //     tombe cru dans la page.
    vi.mocked(fetchApercu).mockRejectedValue(new Error('Aucun index.html à la racine'));
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
    expect(
      dom.querySelector('.ry-erreur'),
      'personne n’a demandé d’aperçu : rien à avertir',
    ).toBeNull();

    const btn = dom.querySelector('.ry-apercu-btn');
    expect(btn, 'le bouton d’aperçu existe').toBeTruthy();
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    const erreur = dom.querySelector('.ry-erreur');
    expect(erreur, 'le refus s’affiche DANS son paragraphe').toBeTruthy();
    expect(erreur?.textContent ?? '', 'avec le pictogramme et le motif').toContain('⚠');
    expect(erreur?.textContent ?? '').toContain('index.html');
  });

  it('BALANCE : un poste à ZÉRO ne pose pas de segment invisible', async () => {
    // `s.pct > 0` mutée en `>= 0` pose un `<span style="width: 0%">` pour chaque
    // poste vide. Invisible à l'œil, mais il porte un `title` — donc une cible
    // de survol de largeur nulle — et la légende en dessous liste DÉJÀ les
    // quatre postes avec leurs millisecondes. Le segment nul n'ajoute rien et
    // encombre la barre de trois éléments morts.
    //
    // C'est le survivant le moins grave des dix, et il se dit comme tel : la
    // conséquence est du DOM inutile, pas un mensonge à l'écran.
    const peseeUnPoste = {
      version: 1,
      mode: 'strict',
      aJour: true,
      fenetre: 100,
      pesee: {
        version: 1,
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
    } as never;
    const dom = await monter(
      <CarteBalance balance={peseeUnPoste} erreur={null} snapshot={instantane()} />,
    );
    const segments = [...dom.querySelectorAll('.bal-seg')];
    expect(segments, 'un seul poste porte du miel ⇒ un seul segment').toHaveLength(1);
    expect(
      [...dom.querySelectorAll('.bal-legend-item')].length,
      'la légende, elle, nomme bien les QUATRE postes',
    ).toBe(4);
  });
  // ─── L'ÉCRAN QUI DISTRIBUE L'AUTORITÉ ──────────────────────────────────────
  //
  // Le balayage COMPLET d'`Intendance.tsx` (38 mutations candidates, toutes
  // jouées) a laissé six lignes nues, mesurées survivantes de la suite ENTIÈRE.
  // Quatre d'entre elles vivent dans le tableau des membres — celui où l'on
  // donne et retire le droit de démarrer, éteindre et effacer des machines.
  const intendance = async (
    membres: readonly { id: string; displayName: string; email: string; role: string }[],
    moiId = 'u-moi',
  ): Promise<HTMLElement> => {
    vi.mocked(fetchMembres).mockResolvedValue({
      membres,
      admins: membres.filter((m) => m.role === 'admin').length,
      inscription: { mode: 'ouverte', avertissement: '' },
    } as never);
    return monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { id: moiId, displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
  };
  const ligneDeNom = (dom: HTMLElement, nom: string): Element | undefined =>
    [...dom.querySelectorAll('.in-table tbody tr')].find((l) =>
      (l.textContent ?? '').includes(nom),
    );

  it('INTENDANCE : le BADGE de rôle dit le rôle qu’on a, pas l’autre', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {role === 'admin' ? t('administrateur') : t('membre')}
    //
    // Mutée en `!==`, les deux libellés s'échangent : chaque administrateur est
    // annoncé « membre » et chaque membre « administrateur ». Sur l'écran qui
    // sert précisément à savoir QUI détient l'autorité, la colonne qui le dit
    // ment sur toutes les lignes à la fois — et rien ne le trahit, puisque
    // l'écran reste parfaitement cohérent avec lui-même.
    const dom = await intendance([
      { id: 'u-alice', displayName: 'Alice', email: 'a@x', role: 'admin' },
      { id: 'u-bob', displayName: 'Bob', email: 'b@x', role: 'membre' },
    ]);
    const badge = (nom: string): string =>
      ligneDeNom(dom, nom)?.querySelector('.in-role')?.textContent ?? '';

    expect(badge('Alice'), 'une administratrice n’est pas annoncée comme telle').toBe(
      'administrateur',
    );
    expect(badge('Bob'), 'un membre est annoncé administrateur').toBe('membre');
  });

  it('INTENDANCE : « vous » se pose sur VOTRE ligne, jamais sur celle des autres', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     const moi = m.id === moiId;
    //
    // Mutée en `!==`, le repère « vous » se pose sur TOUTES les autres lignes
    // et disparaît de la sienne. C'est le repère qu'on cherche avant de cliquer
    // sur un geste qui retire un droit : se tromper de ligne ici, c'est se
    // retirer soi-même l'intendance en croyant la retirer à quelqu'un d'autre.
    const dom = await intendance(
      [
        { id: 'u-moi', displayName: 'Gardienne', email: 'g@x', role: 'admin' },
        { id: 'u-bob', displayName: 'Bob', email: 'b@x', role: 'membre' },
      ],
      'u-moi',
    );
    expect(
      ligneDeNom(dom, 'Gardienne')?.querySelector('.in-moi'),
      'ma propre ligne ne porte pas « vous »',
    ).toBeTruthy();
    expect(
      ligneDeNom(dom, 'Bob')?.querySelector('.in-moi'),
      'la ligne d’un autre porte « vous »',
    ).toBeNull();
  });

  it('INTENDANCE : le bouton ANNONCE ce qu’il va faire, pas le contraire', async () => {
    // ─── LA GARDE NUE, ET LA PLUS LOURDE DU FICHIER ────────────────────────
    //
    //     const cible: Role = role === 'admin' ? 'membre' : 'admin';   (défendue)
    //     …
    //     {busy === m.id ? '…' : cible === 'admin' ? t('Nommer administrateur')
    //                                              : t('Rendre membre')}
    //
    // `cible` décide de l'action ET du libellé. La première moitié est déjà
    // défendue ; la SECONDE était nue. Mutée en `!==`, le calcul de `cible` ne
    // bouge pas — le geste fait toujours la bonne chose — mais le bouton et son
    // infobulle annoncent l'INVERSE : sur un membre, il propose « Rendre
    // membre » et promeut ; sur un administrateur, il propose « Nommer
    // administrateur » et rétrograde.
    //
    // C'est le pire des deux mondes : un écran qui fait ce qu'il faut en
    // disant le contraire apprend à ne plus lire les boutons.
    const dom = await intendance([
      { id: 'u-alice', displayName: 'Alice', email: 'a@x', role: 'admin' },
      { id: 'u-bob', displayName: 'Bob', email: 'b@x', role: 'membre' },
    ]);
    const geste = (nom: string): Element | null | undefined =>
      ligneDeNom(dom, nom)?.querySelector('.in-geste');

    // Sur un MEMBRE, le geste disponible est la promotion.
    expect(geste('Bob')?.textContent, 'le geste offert à un membre n’est pas la promotion').toBe(
      'Nommer administrateur',
    );
    expect(
      geste('Bob')?.getAttribute('title') ?? '',
      'l’infobulle d’une promotion ne décrit pas ce qu’elle donne',
    ).toContain('Donner le droit');

    // Sur une ADMINISTRATRICE, c'est le retrait.
    expect(
      geste('Alice')?.textContent,
      'le geste offert à une administratrice n’est pas le retrait',
    ).toBe('Rendre membre');
    expect(
      geste('Alice')?.getAttribute('title') ?? '',
      'l’infobulle d’un retrait ne dit pas ce qu’elle retire',
    ).toContain('Retirer l’accès');
  });

  it('INTENDANCE : le compte à rebours d’effacement s’affiche JUSQU’AU DERNIER JOUR', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     {s.joursAvantSuppression >= 0 && ( ⏳ … j avant effacement )}
    //
    // `-1` veut dire « cette machine n'est pas concernée » (api.ts l. 1233) ;
    // `0` veut dire « elle part aujourd'hui ». Mutée en `>`, le zéro disparaît :
    // le DERNIER avertissement avant un effacement définitif est justement celui
    // qu'on n'affiche plus. Mutée en `||`, le sablier se colle aux machines qui
    // ne risquent rien, et un avertissement permanent ne s'avertit plus.
    const avec = (jours: number): Promise<HTMLElement> => {
      vi.mocked(fetchServeurs).mockResolvedValue({
        vue: { total: 1, parEtat: {}, facturables: 0, bientotSupprimes: [] },
        serveurs: [
          {
            id: 'srv-1',
            projet: 'Rucher',
            etat: 'arrete',
            gabarit: 'petit',
            refMachine: null,
            motif: null,
            transitions: [],
            joursAvantSuppression: jours,
          },
        ],
        fournisseur: 'manuel',
        retentionJours: 30,
        serveursMax: 8,
      } as never);
      return monter(
        <Intendance
          {...({
            snapshot: instantane(),
            refreshTick: 0,
            user: { id: 'u-moi', displayName: 'gardienne', role: 'admin' },
          } as unknown as ViewProps)}
        />,
      );
    };
    const sablier = (dom: HTMLElement): string =>
      dom.querySelector('.in-retention')?.textContent ?? '';

    expect(sablier(await avec(3)), 'un sursis de 3 jours ne s’annonce pas').toContain('3');
    expect(sablier(await avec(0)), 'le DERNIER jour avant effacement ne s’annonce plus').toContain(
      '0',
    );
    expect(sablier(await avec(-1)), 'une machine hors sursis porte un compte à rebours').toBe('');
  });

  it('INTENDANCE : un billet MORT se voit comme mort, pas comme vivant', async () => {
    // ─── LA GARDE NUE ──────────────────────────────────────────────────────
    //
    //     <li className={b.etat === 'vivant' ? '' : 'in-cle-morte'}>
    //
    // Mutée en `!==`, l'habit s'inverse : les billets vivants sont barrés, les
    // révoqués ont l'air valides. Un billet est une clé d'entrée dans la ruche —
    // croire morte celle qui ouvre encore, c'est laisser une porte qu'on pense
    // fermée.
    vi.mocked(fetchCles).mockResolvedValue({
      noeuds: [],
      billets: [
        { id: 'b-vivant', label: 'Le vivant', etat: 'vivant', usesLeft: 2, usesTotal: 3 },
        { id: 'b-mort', label: 'Le révoqué', etat: 'revoque', usesLeft: 0, usesTotal: 3 },
      ],
    } as never);
    const dom = await monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { id: 'u-moi', displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
    const billet = (nom: string): Element | undefined =>
      [...dom.querySelectorAll('.in-cles li')].find((l) => (l.textContent ?? '').includes(nom));

    expect(billet('Le vivant'), 'le billet vivant est absent de la liste').toBeTruthy();
    expect(
      billet('Le vivant')?.className,
      'un billet qui ouvre encore est montré comme mort',
    ).not.toContain('in-cle-morte');
    expect(billet('Le révoqué')?.className, 'un billet révoqué est montré comme vivant').toContain(
      'in-cle-morte',
    );
  });

  it('INTENDANCE : le « … » ne se pose que sur la ligne qu’on vient de toucher', async () => {
    // `busy === m.id` mutée en `!==` retourne l'écran : la ligne qu'on vient de
    // cliquer retrouve son libellé, et TOUTES LES AUTRES affichent « … ».
    //
    // On croit alors avoir manqué son clic — donc on reclique —, ou que la
    // ruche s'occupe de comptes qu'on n'a jamais touchés. Les boutons sont
    // désactivés pendant l'envoi (`disabled={busy !== null}`), donc le geste ne
    // part pas deux fois ; ce qui est cassé, c'est ce que l'écran RACONTE.
    //
    // Le monde « pendant l'envoi » se fabrique sans réseau : une promesse qui
    // ne se résout jamais laisse `busy` posé.
    vi.mocked(fetchMembres).mockResolvedValue({
      membres: [
        { id: 'u-alice', displayName: 'Alice', email: 'a@x', role: 'membre' },
        { id: 'u-bob', displayName: 'Bob', email: 'b@x', role: 'membre' },
      ],
      admins: 1,
      inscription: { mode: 'ouverte', avertissement: '' },
    } as never);
    vi.mocked(setMembreRole).mockImplementation(() => new Promise(() => {}) as never);
    const dom = await monter(
      <Intendance
        {...({
          snapshot: instantane(),
          refreshTick: 0,
          user: { id: 'u-moi', displayName: 'gardienne', role: 'admin' },
        } as unknown as ViewProps)}
      />,
    );
    const lignes = [...dom.querySelectorAll('.in-table tbody tr')];
    const ligneDe = (nom: string) => lignes.find((l) => (l.textContent ?? '').includes(nom));
    const gesteDe = (nom: string) => ligneDe(nom)?.querySelector('.in-geste');
    expect(gesteDe('Alice'), 'le geste d’Alice existe').toBeTruthy();
    expect(gesteDe('Bob'), 'le geste de Bob existe').toBeTruthy();

    await act(async () => {
      gesteDe('Alice')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(gesteDe('Alice')?.textContent, 'la ligne TOUCHÉE attend').toBe('…');
    expect(
      gesteDe('Bob')?.textContent,
      'la ligne qu’on n’a pas touchée garde son libellé',
    ).not.toBe('…');
    expect(gesteDe('Bob')?.textContent ?? '').toContain('administrateur');
  });
});
