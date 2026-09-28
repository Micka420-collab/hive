// Hive Mission Control : shell de l'application — sidebar alvéolaire (7 vues,
// navigation par hash sans router), topbar compacte, pouls de la ruche (ECG),
// tiroir de tâche et modales globales. L'état temps réel (snapshot + journal)
// vit ici et descend dans les vues en props (contrat ViewProps).

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import { agentsConnectes, etatBandeau } from '../../src/shared/agents-connectes';
import {
  authMe,
  connectFeed,
  estAdmin,
  fetchPulse,
  fetchMonTableau,
  fetchReviews,
  getJwt,
  getToken,
  oublierSessionExpiree,
  saveToken,
  sessionEstExpiree,
  surJwtAilleurs,
  surSessionExpiree,
} from './api';
import type { AuthUser } from './api';
import { AccountPanel, EVENT_OUVRIR_COMPTE } from './AccountPanel';
import { ChoixDuTheme } from './ChoixDuTheme';
import { setLang, useLang, useT } from './i18n';
import { InvitePanel } from './InvitePanel';
import { NewProjectModal } from './NewProjectModal';
import { TaskDrawer } from './TaskDrawer';
import {
  creerMagasinSorties,
  FINS_D_EXECUTION,
  garderVivantes,
  oublierTache,
} from './sorties-directes';
import { transitionDifferees } from './differees';
import { annoncesDepuisEvenements } from './horloge-vue';
import {
  compteAffiche,
  doitSonder,
  pastilleDesAlertes,
  phraseAlertes,
  porteLaPastille,
} from './views/pastille-alertes';
import { FiletDeSecurite, modalOpen } from './ui';
import Ruche from './views/Ruche';
import {
  applyReviewEvent,
  beginReviewHydration,
  countPendingReviews,
  countUnsyncedReviews,
  hydrateReviews,
  Sparkline,
  useApiPoll,
  useReviewTick,
} from './views/shared';
import type { ReviewState } from './views/shared';
import type { ViewId, ViewProps } from './views/shared';

// Chaque vue est un chunk séparé — la Ruche (première peinture) reste inline.
const Miellerie = lazy(() => import('./views/Miellerie'));
const Projets = lazy(() => import('./views/Projets'));
const Essaim = lazy(() => import('./views/Essaim'));
const Sante = lazy(() => import('./views/Sante'));
const Chronique = lazy(() => import('./views/Chronique'));
const Memoire = lazy(() => import('./views/Memoire'));
const Reine = lazy(() => import('./views/Reine'));
const MonEspace = lazy(() => import('./views/MonEspace'));
const Rayon = lazy(() => import('./views/Rayon'));
const Intendance = lazy(() => import('./views/Intendance'));
const Cerveau = lazy(() => import('./views/Cerveau'));
const Chantiers = lazy(() => import('./views/Chantiers'));
const Chambre = lazy(() => import('./views/Chambre'));
const WarRoom = lazy(() => import('./views/WarRoom'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

interface NavItem {
  id: ViewId;
  label: string;
  labelEn: string;
  key: string;
  /** Vue d'administration : la case n'est montrée qu'aux admins. */
  admin?: true;
}

const NAV: NavItem[] = [
  { id: 'ruche', label: 'Ruche', labelEn: 'Hive', key: '1' },
  { id: 'reine', label: 'Reine', labelEn: 'Queen', key: '2' },
  { id: 'miellerie', label: 'Miellerie', labelEn: 'Honey House', key: '3' },
  { id: 'projets', label: 'Projets', labelEn: 'Projects', key: '4' },
  { id: 'essaim', label: 'Essaim', labelEn: 'Swarm', key: '5' },
  { id: 'sante', label: 'Santé', labelEn: 'Health', key: '6' },
  { id: 'chronique', label: 'Chronique', labelEn: 'Chronicle', key: '7' },
  { id: 'memoire', label: 'Mémoire', labelEn: 'Memory', key: '8' },
  { id: 'rayon', label: 'Rayon', labelEn: 'Comb', key: '9' },
  { id: 'monespace', label: 'Mon espace', labelEn: 'My space', key: '0' },
  { id: 'chantiers', label: 'Chantiers', labelEn: 'Works', key: 'h' },
  { id: 'warroom', label: 'War Room', labelEn: 'War Room', key: 'w' },
  {
    id: 'intendance',
    label: 'Intendance',
    labelEn: 'Stewardship',
    key: 'i',
    admin: true,
  },
  {
    id: 'cerveau',
    label: 'Cerveau',
    labelEn: 'Brain',
    key: 'c',
    admin: true,
  },
];

/** Traits fins façon produit : lisibles à 22 px, sans emoji. */
function NavGlyph({ id }: { id: ViewId }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (id) {
    case 'ruche':
      return (
        <svg {...common}>
          <path d="M12 3.2 19.5 7.5v9L12 20.8 4.5 16.5v-9L12 3.2Z" />
        </svg>
      );
    case 'reine':
      return (
        <svg {...common}>
          <path d="M5 18h14l-1.2-8.2L14 12l-2-5-2 5-3.8-2.2L5 18Z" />
          <path d="M7 18h10v1.5H7V18Z" />
        </svg>
      );
    case 'miellerie':
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20H4V10.5Z" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case 'projets':
      return (
        <svg {...common}>
          <path d="M4 7.5h6l1.5 1.8H20V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5Z" />
        </svg>
      );
    case 'essaim':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="2.2" />
          <circle cx="16" cy="9" r="2.2" />
          <circle cx="12" cy="16" r="2.2" />
          <path d="M9.7 10.4 11 14.2M14.3 10.4 13 14.2" />
        </svg>
      );
    case 'sante':
      return (
        <svg {...common}>
          <path d="M4 12h3.2l1.6-3.5 2.4 7 2-4.2H20" />
        </svg>
      );
    case 'chronique':
      return (
        <svg {...common}>
          <path d="M7 5h12v14H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M9 9h7M9 12.5h7M9 16h4" />
        </svg>
      );
    case 'memoire':
      return (
        <svg {...common}>
          <path d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v11H8.5A2.5 2.5 0 0 1 6 16.5v-11Z" />
          <path d="M6 16.5h9.5" />
        </svg>
      );
    case 'rayon':
      return (
        <svg {...common}>
          <path d="M8 4.5h8v5H8zM4.5 11h6.5v8.5H4.5zM13 11h6.5v8.5H13z" />
        </svg>
      );
    case 'monespace':
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="3.2" />
          <path d="M5.5 19c1.6-3.2 4-4.8 6.5-4.8S16.9 15.8 18.5 19" />
        </svg>
      );
    case 'chantiers':
      return (
        <svg {...common}>
          <path d="M14.5 5.5 18.5 9.5 10 18H6v-4L14.5 5.5Z" />
          <path d="M12.8 7.2 16.8 11.2" />
        </svg>
      );
    case 'warroom':
      // Deux bulles qui se font face : un débat, pas une alerte.
      return (
        <svg {...common}>
          <path d="M4 6.5h9.5v6.2H8.2L5.5 15v-2.3H4V6.5Z" />
          <path d="M15.5 9.5H20v6.2h-1.5V18l-2.7-2.3h-5.3v-3" />
        </svg>
      );
    case 'intendance':
      return (
        <svg {...common}>
          <path d="M12 3.5 19 6.5v5.2c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6.5L12 3.5Z" />
        </svg>
      );
    case 'cerveau':
      return (
        <svg {...common}>
          <path d="M9 7.2a3 3 0 0 1 6 0c1.6.4 2.7 1.8 2.7 3.5 0 1.4-.8 2.6-2 3.2v3.6H8.3v-3.6c-1.2-.6-2-1.8-2-3.2 0-1.7 1.1-3.1 2.7-3.5Z" />
          <path d="M10 17.5h4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
  }
}

/**
 * TOUS les identifiants de vue, y compris ceux qui ne sont pas dans la barre.
 *
 * `parseHash` doit reconnaître `#/intendance` même quand la case est masquée :
 * un administrateur qui ouvre son signet arrive AVANT que `/api/auth/me` ait
 * répondu, et le renvoyer sur la Ruche à cet instant-là serait un bug qu'on
 * ne saurait pas reproduire.
 *
 * `chambre` n'a volontairement PAS de case nav (ADR 0010) : entrée depuis la
 * fiche nœud uniquement (`#/chambre/<nodeId>`).
 */
const VIEW_IDS = new Set<string>([...NAV.map((n) => n.id), 'chambre']);

/** #/vue/id → { view, selectedId } (fallback ruche sur hash inconnu). */
function parseHash(): { view: ViewId; selectedId: string | null } {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEW_IDS.has(parts[0] ?? '') ? (parts[0] as ViewId) : 'ruche';
  // ─── ÉQUIVALENCE CONSIGNÉE (§ 2.16 ter) — `decodeURIComponent` ─────────────
  //
  // Le mutant qui retire le décodage SURVIT, et c'est mesuré. Il n'y a
  // aujourd'hui AUCUNE entrée qui le départage : les trois consommateurs de
  // `selectedId` — Projets, Chantiers, Miellerie — n'y mettent que des
  // identifiants de projet ou de tâche, c'est-à-dire des UUID. Or
  // `encodeURIComponent` d'un UUID est l'UUID.
  //
  // C'est une équivalence CONDITIONNELLE, et la condition est ailleurs : elle
  // tient tant que les identifiants restent alphanumériques. Le jour où une
  // route portera un chemin — un fichier du Rayon, un nom de branche — le
  // mutant cessera d'être équivalent, et cette ligne redeviendra une garde.
  //
  // On la garde pour cette raison, et parce qu'elle est la moitié d'une paire :
  // `navigate` écrit `encodeURIComponent`. Retirer un seul côté d'un
  // aller-retour est le genre de dette qui se paie loin de l'endroit où on l'a
  // contractée.
  return { view, selectedId: parts[1] ? decodeURIComponent(parts[1]) : null };
}

/** Le focus est-il dans un champ de saisie ? (neutralise les raccourcis) */
function inInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<StateSnapshot>(EMPTY);
  const [events, setEvents] = useState<HiveEvent[]>([]);
  const [agentsByTask, setAgentsByTask] = useState<Record<string, SubAgent[]>>({});
  // Hors de l'état React : un morceau ne re-rend que la console qui l'affiche.
  const [magasinSorties] = useState(creerMagasinSorties);
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [tokenAuthError, setTokenAuthError] = useState(false);
  /** Coupé pour lenteur (`CODE_TABLEAU_TROP_LENT`) : le voyant dit pourquoi. */
  const [tropLent, setTropLent] = useState(false);
  /** Événements perdus à l'élagage pendant une coupure — dit, jamais comblé. */
  const [journalElague, setJournalElague] = useState(0);
  const [token, setTokenState] = useState(getToken());
  const [feedKey, setFeedKey] = useState(0);
  const [route, setRoute] = useState(parseHash);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  // La vue (`#/…`) où la session est morte ; `null` tant qu'elle vit. Voir
  // « LA SESSION QUI EXPIRE, DITE À L'ÉCRAN » plus bas. Une marque restée d'un
  // chargement précédent s'affiche dès le montage : sans bandeau, « + Projet »
  // refuserait sans que rien à l'écran ne dise pourquoi ni quoi faire.
  const [retourSession, setRetourSession] = useState<string | null>(() =>
    sessionEstExpiree() ? location.hash || '#/ruche' : null,
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const reviewTick = useReviewTick();
  const lang = useLang();
  const t = useT();
  // Le gestionnaire de raccourcis est installé UNE fois : il lit la session
  // par référence, sinon il resterait sur celle du premier rendu (null).
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // Session utilisateur (JWT) : demandée à la Reine quand un JWT est rangé.
  // Un JWT refusé est purgé par `api()` et annoncé (« LA SESSION QUI EXPIRE,
  // DITE À L'ÉCRAN »). Une Reine injoignable, elle, ne dit RIEN de la session :
  // on garde le JWT (le purger déconnectait quiconque ouvrait l'écran pendant
  // un redémarrage de la Reine) et on REDEMANDE à chaque reconnexion du flux —
  // sinon la barre offrait « Se connecter » pour la durée de l'onglet, alors
  // que chaque appel partait avec le compte.
  const demanderSession = useCallback((memeSiConnue: boolean) => {
    if (!getJwt() || (userRef.current && !memeSiConnue)) return;
    authMe()
      .then((u) => {
        setUser(u);
        setRetourSession(null);
      })
      .catch(() => {
        /* refus : déjà traité par `api()` ; panne : inconnu, rien à purger */
      });
  }, []);
  // Coalescence des invalidations : une rafale d'événements → 1 re-fetch/s max.
  const refreshTimer = useRef<number | undefined>(undefined);
  // La cible du lien d'évitement (voir plus bas).
  const principal = useRef<HTMLElement>(null);

  // ─── Flux temps réel ────────────────────────────────────────────────────────
  useEffect(() => {
    const feed = connectFeed({
      onState: (snap) => {
        setSnapshot(snap);
        // Un `task_done` manqué pendant une coupure ne viderait jamais ces
        // états : l'instantané, lui, dit toujours quelles tâches vivent.
        magasinSorties.garderVivantes(snap.tasks);
        setAgentsByTask((prev) => garderVivantes(prev, snap.tasks));
      },
      onSortie: (taskId, nodeId, sortie, niveaux) =>
        magasinSorties.ajouter(taskId, nodeId, sortie, niveaux),
      onEvent: (ev) => {
        setEvents((prev) => [...prev.slice(-499), ev]);
        // Tout événement de fin de tâche / merge / conflit invalide les vues qui fetchent.
        if (
          [
            'task_done',
            'task_failed',
            'task_cancelled',
            'merge_started',
            'merge_completed',
            'merge_failed',
            'conflict_detected',
            'delegation_created',
            'delegation_replayed',
            'delegation_rejected',
            'delegation_result',
            'delegation_cancelled',
            'task_requeued',
            'task_retry',
            // Verdict humain persisté (émis APRÈS l'écriture) : la raison jointe
            // se relit alors dans le volet verdict de la Miellerie — relire
            // plus tôt, au clic, lirait l'état d'avant le POST.
            'task_reviewed',
            'node_online',
            'node_offline',
            // Changement de régime thermique : la jauge de Santé doit refléter
            // la nouvelle bande appliquée sans attendre le prochain poll.
            'thermo_shift',
            // Le Conseil et la War Room : un conseil réuni, clos ou tranché par
            // un AUTRE opérateur, un renvoi refusé qui laisse une contestation
            // en suspens, la revue humaine qui la lève — les panneaux qui le
            // montrent se relisent.
            'council_opened',
            'council_closed',
            'council_decided',
            'evaluator_retry_skipped',
            'task_reviewed',
          ].includes(ev.type)
        ) {
          if (refreshTimer.current === undefined) {
            refreshTimer.current = window.setTimeout(() => {
              refreshTimer.current = undefined;
              setRefreshTick((t) => t + 1);
            }, 1_000);
          }
        }
        const taskId = typeof ev.payload.taskId === 'string' ? ev.payload.taskId : null;
        if (!taskId) return;
        // Revue posée par un autre opérateur : synchro immédiate du cache.
        if (ev.type === 'task_reviewed') {
          const state = ev.payload.state;
          applyReviewEvent(
            taskId,
            state === 'approved' || state === 'rejected' ? (state as ReviewState) : null,
            typeof ev.payload.clientId === 'string' ? ev.payload.clientId : undefined,
          );
        }
        if (ev.type === 'task_progress' && Array.isArray(ev.payload.subAgents)) {
          const subAgents = ev.payload.subAgents as SubAgent[];
          setAgentsByTask((prev) => ({ ...prev, [taskId]: subAgents }));
        } else if (FINS_D_EXECUTION.includes(ev.type)) {
          setAgentsByTask((prev) => oublierTache(prev, taskId));
          magasinSorties.oublier(taskId);
        }
        // La transition vit dans `differees.ts`, PUR — la loupe l'avait rendue
        // SANS TEST tant qu'elle était enfouie ici. Rendre `prev` lui-même
        // quand rien ne change est le contrat : même référence, pas de rendu.
        setDeferred((prev) => transitionDifferees(prev, ev.type, taskId) as Set<string>);
      },
      onJournalIncomplet: (manquants) => setJournalElague((n) => n + manquants),
      onStatus: (up, meta) => {
        setConnected(up);
        setTropLent(!up && meta?.tropLent === true);
        if (up) setTokenAuthError(false);
        else if (meta?.authError) setTokenAuthError(true);
        // À CHAQUE (re)connexion : ré-hydrater les revues. Le flux rejoue les
        // task_reviewed manqués (`connectFeed`), mais seulement dans la limite
        // de ce que le journal a gardé — la table des revues n'oublie rien.
        if (up) {
          demanderSession(false);
          // Les événements rattrapés passent par `onEvent` comme le direct,
          // mais toutes les vues qui lisent une API n'écoutent pas un type
          // d'événement : elles repartent d'une lecture à chaque reconnexion.
          setRefreshTick((t) => t + 1);
          const seq = beginReviewHydration();
          fetchReviews()
            .then((r) => hydrateReviews(r.reviews, seq))
            .catch(() => {
              // Serveur ancien ou injoignable : getReview retombe sur localStorage.
            });
        }
      },
    });
    return () => {
      if (refreshTimer.current !== undefined) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = undefined;
      }
      feed.close();
    };
  }, [feedKey, demanderSession, magasinSorties]);

  // ─── Navigation par hash ────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (view: ViewId, selectedId?: string, opts?: { replace?: boolean }) => {
    const hash = selectedId ? `#/${view}/${encodeURIComponent(selectedId)}` : `#/${view}`;
    if (opts?.replace) {
      // Sélection intra-vue : pas d'entrée d'historique (replaceState ne
      // déclenche pas hashchange → setRoute manuel).
      history.replaceState(null, '', hash);
      setRoute(parseHash());
    } else {
      location.hash = hash;
    }
  };

  // Raccourcis de vue sans souris (hors saisie et dialogues) : 1-9 et 0 pour
  // les cases ordinaires, « i » pour l'Intendance — les chiffres étaient pris.
  //
  // ─── `e.code === Digit…` RATTRAPE L'AZERTY, ET C'EST INDISPENSABLE ─────────
  //
  // Sur un clavier français, la rangée du haut ne rend pas de chiffres sans
  // Maj : la touche de « 7 » rend « è ». Sans ce repli, la navigation au
  // clavier serait muette EN FRANÇAIS — c'est-à-dire pour le public premier de
  // ce produit. `e.code` désigne la position PHYSIQUE de la touche.
  //
  // ─── `Numpad…` A ÉTÉ RETIRÉ, ET VOICI POURQUOI ────────────────────────────
  //
  // La loupe l'a laissé SURVIVRE, et en cherchant l'entrée qui le départage on
  // ne trouve pas un test manquant : on trouve que la branche n'a aucun cas où
  // elle sert. Ce que la spécification UI Events impose :
  //
  //     NumLock ALLUMÉ   Numpad7 → key: '7'     code: 'Numpad7'
  //     NumLock ÉTEINT   Numpad7 → key: 'Home'  code: 'Numpad7'
  //
  //   · allumé  — `n.key === e.key` matche déjà : la branche est REDONDANTE ;
  //   · éteint  — l'utilisateur a tapé « Origine », et la branche le faisait
  //               NAVIGUER : elle était NUISIBLE.
  //
  // Contrairement à `Digit`, le pavé numérique n'a aucune disposition à
  // rattraper : il est le même partout. Une branche redondante d'un côté et
  // nuisible de l'autre n'a pas de cas où elle sert.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || inInput() || modalOpen()) return;
      const item = NAV.find((n) => n.key === e.key || e.code === `Digit${n.key}`);
      // Une case masquée n'a pas non plus de raccourci : sinon « 9 » emmènerait
      // un membre sur un écran qui ne sait que lui dire non.
      if (item && (!item.admin || estAdmin(userRef.current))) navigate(item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Pouls de la ruche (ECG sidebar) ───────────────────────────────────────
  const pulse = useApiPoll(fetchPulse, 20_000, refreshTick);
  const beatValues = useMemo(() => {
    const buckets = pulse.data?.throughput ?? [];
    return buckets.slice(-24).map((b) => b.done + b.failed);
  }, [pulse.data]);

  // ─── Les alertes de la personne, annoncées depuis N'IMPORTE QUEL écran ─────
  //
  // Une alerte `effacement_imminent` ne se rattrape pas après coup, et elle
  // dormait invisible tant qu'on n'ouvrait pas « Mon espace ». Le sondage est
  // BORNÉ à la session : sans elle, la route rend 401, et boucler dessus
  // fabriquerait un cliquetis de refus pour un visiteur anonyme.
  //
  // `useApiPoll` suspend déjà de lui-même quand l'onglet est caché ; le tic de
  // session le réveille à la connexion, sans quoi la pastille attendrait le
  // prochain intervalle pour apparaître.
  const sonde = doitSonder(user);
  const lireTableau = useCallback(
    () => (doitSonder(user) ? fetchMonTableau() : Promise.resolve(null)),
    [user],
  );
  const monTableau = useApiPoll(lireTableau, 30_000, refreshTick + (sonde ? 1 : 0));
  const pastille = useMemo(() => pastilleDesAlertes(monTableau.data), [monTableau.data]);

  const pendingReviews = useMemo(
    () => countPendingReviews(snapshot.tasks),
    [snapshot.tasks, reviewTick],
  );
  // Verdicts locaux que le serveur n'a pas (encore) confirmés : visibles,
  // jamais silencieux — ils sont re-postés automatiquement à la reconnexion.
  const unsyncedReviews = useMemo(() => countUnsyncedReviews(), [reviewTick]);

  const applyToken = () => {
    // Ne reconnecter que si le token a réellement changé : une reconnexion
    // gratuite perd les événements émis pendant la fenêtre de coupure.
    if (token === getToken()) return;
    saveToken(token);
    setTokenAuthError(false);
    setFeedKey((k) => k + 1);
  };

  // ─── LA SESSION QUI EXPIRE, DITE À L'ÉCRAN ─────────────────────────────────
  //
  // `api()` reconnaît une session morte à n'importe quel appel (voir « LA
  // SESSION QUI EXPIRE » dans `api.ts`) et purge le JWT. Ici, on en tire les
  // conséquences VISIBLES : la barre cesse d'afficher un nom qui n'est plus
  // connecté, un bandeau dit pourquoi les gestes échouent, et la fenêtre de
  // connexion s'ouvre. On retient la vue où c'est arrivé : la reconnexion y
  // ramène, au lieu de laisser la personne chercher où elle en était.
  //
  // Abonné AVANT la restauration ci-dessous : c'est son `authMe` qui découvre
  // un JWT expiré depuis la dernière visite, et il doit trouver quelqu'un à
  // prévenir.
  useEffect(
    () =>
      surSessionExpiree(
        () => {
          setUser(null);
          setRetourSession(location.hash || '#/ruche');
        },
        // Levée ailleurs : le bandeau tombe avec la garde qu'il annonçait.
        () => setRetourSession(null),
      ),
    [],
  );

  // Restaurée au montage (voir `demanderSession`).
  useEffect(() => demanderSession(false), [demanderSession]);

  // Un AUTRE onglet a changé le JWT. Déconnecté là-bas : plus de nom ici, sans
  // quoi « + Projet » partirait sans compte sous un nom affiché. Connecté
  // là-bas : on redemande qui, même si un nom est déjà affiché.
  useEffect(
    () =>
      surJwtAilleurs(() => {
        if (getJwt()) demanderSession(true);
        else setUser(null);
      }),
    [demanderSession],
  );

  /** Ce que rapporte le panneau de compte : connexion, déconnexion, reconnexion. */
  const changerDeCompte = (u: AuthUser | null) => {
    setUser(u);
    if (!u || retourSession === null) return;
    // Reconnecté après une expiration : retour à la vue où elle a surpris.
    if (location.hash !== retourSession) location.hash = retourSession;
    setRetourSession(null);
  };

  /** « Continuer sans compte » — un choix explicite, qui rend la porte du jeton. */
  const continuerSansCompte = () => {
    oublierSessionExpiree();
    setRetourSession(null);
  };

  const viewProps: ViewProps = {
    snapshot,
    events,
    agentsByTask,
    deferred,
    onOpenTask: setOpenTaskId,
    onNewProject: () => setShowNewProject(true),
    onNavigate: navigate,
    selectedId: route.selectedId,
    refreshTick,
    user,
  };

  const openTask = openTaskId ? (snapshot.tasks.find((t) => t.id === openTaskId) ?? null) : null;

  // L'horloge du chantier, repliée depuis le journal déjà reçu. Calculée ici et
  // non dans le tiroir : le repli parcourt tout le flux, et le refaire à chaque
  // ouverture du tiroir le referait à chaque événement pendant qu'il est ouvert.
  const annonces = useMemo(() => annoncesDepuisEvenements(events), [events]);
  const current = NAV.find((n) => n.id === route.view) ?? NAV[0]!;

  return (
    <div className="app mc-app">
      {/* ─── LE LIEN D'ÉVITEMENT, ET POURQUOI IL NE SUIT PAS SON `href` ──────
          La navigation de ce tableau de bord VIT dans le fragment (`#/vue`).
          Laisser le lien suivre `#mc-contenu` réécrirait le fragment :
          `parseHash` ne reconnaîtrait aucune vue et renverrait sur la Ruche —
          « aller au contenu » ferait QUITTER le contenu. Le `href` reste pour
          que ce soit un vrai lien (tabulable, annoncé comme tel) ; le clic
          pose le focus lui-même. */}
      <a
        className="mc-evitement"
        href="#mc-contenu"
        onClick={(e) => {
          e.preventDefault();
          principal.current?.focus();
        }}
      >
        {t('Aller au contenu', 'Skip to content')}
      </a>
      <nav className="mc-sidebar" aria-label={t('Navigation principale', 'Main navigation')}>
        <div className="mc-sidebar-brand" title="Hive — Mission Control">
          <span className="brand-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7L12 2.2Z"
                fill="#F6C445"
                fillOpacity="0.92"
              />
              <path
                d="M12 6.2 16.8 9v6L12 17.8 7.2 15V9L12 6.2Z"
                fill="#141210"
                fillOpacity="0.88"
              />
            </svg>
          </span>
          {/* Le nom écrit, et pas seulement la marque : sur la barre large du
              design, le logo seul laissait un vide que rien n'expliquait. */}
          <span className="mc-sidebar-nom">
            <span className="mc-sidebar-word">Hive</span>
            <span className="mc-sidebar-product">Mission Control</span>
          </span>
        </div>
        <ul className="mc-nav">
          {NAV.filter((item) => !item.admin || estAdmin(user)).map((item) => (
            <li key={item.id}>
              <button
                className={`mc-nav-cell${route.view === item.id ? ' active' : ''}`}
                // L'identifiant de la vue, lisible sans dépendre de la langue :
                // `npm run captures` nomme ses images d'après lui.
                data-vue={item.id}
                onClick={() => navigate(item.id)}
                title={`${lang === 'fr' ? item.label : item.labelEn} (${t('touche', 'key')} ${item.key})`}
                aria-current={route.view === item.id ? 'page' : undefined}
              >
                <span className="mc-nav-icon" aria-hidden="true">
                  <NavGlyph id={item.id} />
                </span>
                <span className="mc-nav-label">{lang === 'fr' ? item.label : item.labelEn}</span>
                {porteLaPastille(item.id, pastille) && (
                  <span
                    className={`mc-nav-badge mc-nav-badge--${pastille.gravite}`}
                    data-gravite={pastille.gravite}
                    aria-label={phraseAlertes(pastille, lang)}
                    title={phraseAlertes(pastille, lang)}
                  >
                    {compteAffiche(pastille.total)}
                  </span>
                )}
                {item.id === 'miellerie' && pendingReviews > 0 && (
                  <span
                    className="mc-nav-badge"
                    title={`${pendingReviews} ${t('production(s) à revoir', 'production(s) to review')}`}
                  >
                    {pendingReviews > 99 ? '99+' : pendingReviews}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div
          className="mc-sidebar-pulse"
          title={t('Pouls de la ruche (débit/h)', 'Hive pulse (throughput/h)')}
        >
          <Sparkline values={beatValues} width={64} height={22} beat />
          <span className="mc-pulse-rate">
            {pulse.data ? `${Math.round(pulse.data.successRate * 100)}%` : '—'}
          </span>
        </div>
      </nav>

      <div className="mc-body">
        <header className="topbar mc-topbar">
          <div className="brand">
            <div>
              <h1>{lang === 'fr' ? current.label : current.labelEn}</h1>
              <span className="brand-sub">
                {snapshot.projects.length === 0
                  ? t('Prête — un projet, ce nœud', 'Ready — one project, this node')
                  : `${snapshot.projects.length} ${t('projet(s)', 'project(s)')} · ${snapshot.nodes.length} ${t('nœud(s)', 'node(s)')}`}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            {/* « + Projet » n'a de sens que LÀ OÙ on gère les projets. Posé dans
                l'en-tête commun, il suivait les treize vues et proposait de
                créer un projet depuis la Santé ou le Rayon — une action sans
                rapport avec ce qu'on regarde. */}
            {route.view === 'projets' && (
              <button className="btn primary" onClick={() => setShowNewProject(true)}>
                {t('+ Projet', '+ Project')}
              </button>
            )}
            <button
              className="btn ghost mc-lang"
              data-testid="mc-lang"
              onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
              title={t('Basculer l’interface en anglais', 'Switch interface to French')}
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
            <ChoixDuTheme />
            <AccountPanel
              user={user}
              onUser={changerDeCompte}
              sessionExpiree={retourSession !== null}
            />
            <InvitePanel />
            <input
              type="password"
              className={`token-input${tokenAuthError ? ' token-input-err' : ''}`}
              placeholder={t('Jeton', 'Token')}
              title={t('Token de la ruche (x-hive-token)', 'Hive token (x-hive-token)')}
              value={token}
              onChange={(e) => setTokenState(e.target.value)}
              onBlur={applyToken}
              onKeyDown={(e) => e.key === 'Enter' && applyToken()}
              aria-invalid={tokenAuthError || undefined}
            />
            {unsyncedReviews > 0 && (
              <span
                className="mc-unsynced"
                title={t(
                  "Verdicts posés hors connexion — renvoyés automatiquement dès que l'orchestrateur répond",
                  'Verdicts made while offline — resent automatically once the orchestrator responds',
                )}
              >
                {unsyncedReviews} {t('revue(s) non synchronisée(s)', 'unsynced review(s)')}
              </span>
            )}
            {/* Le voyant d'à côté dit si le NAVIGATEUR parle au hub. Il était
                vert pendant que « 0 nœud(s) actif(s) » travaillait sur rien :
                deux questions distinctes, donc deux voyants distincts. */}
            {(() => {
              const agents = agentsConnectes(snapshot.nodes);
              const etat = etatBandeau(agents);
              const reels = agents.filter((a) => a.enLigne > 0 && !a.simule);
              const titre =
                etat === 'reelle'
                  ? t(
                      'Les IA qui codent réellement en ce moment',
                      'The AIs actually coding right now',
                    )
                  : etat === 'simulee'
                    ? t(
                        'Seul un agent SIMULÉ répond : les diffs produits ne viennent d’aucune IA',
                        'Only a SIMULATED agent answers: the diffs produced come from no AI',
                      )
                    : etat === 'aucune_ia'
                      ? t(
                          'Des ouvrières sont inscrites, aucune ne répond',
                          'Workers are registered, none answers',
                        )
                      : t(
                          'Aucune ouvrière inscrite — lancez « npm run node » sur votre poste',
                          'No worker registered — run « npm run node » on your machine',
                        );
              return (
                <span className={`mc-ia mc-ia-${etat}`} data-testid="mc-ia" title={titre}>
                  <span className="conn-dot" />
                  <span data-testid="mc-ia-mot">
                    {etat === 'reelle'
                      ? reels.map((a) => a.libelle).join(' · ')
                      : etat === 'simulee'
                        ? t('simulé — aucune IA', 'simulated — no AI')
                        : etat === 'aucune_ia'
                          ? t('aucune ouvrière en ligne', 'no worker online')
                          : t('aucune ouvrière', 'no worker')}
                  </span>
                </span>
              );
            })()}
            <span
              className={connected ? 'conn online' : 'conn offline'}
              title={
                tropLent
                  ? t(
                      'Cet écran lisait moins vite que la Reine n’écrivait : elle l’a coupé pour borner sa mémoire. Il se reconnecte seul, puis rattrape le journal.',
                      'This screen read slower than the Queen wrote: she cut it to bound her memory. It reconnects on its own, then catches up the journal.',
                    )
                  : undefined
              }
            >
              <span className="conn-dot" />
              {connected
                ? t('connecté', 'connected')
                : tropLent
                  ? t('hors ligne — écran trop lent', 'offline — screen too slow')
                  : t('hors ligne', 'offline')}
            </span>
          </div>
        </header>

        {tokenAuthError && (
          <div className="mc-token-banner" role="alert">
            <p>
              {t(
                'Jeton de ruche refusé — collez dans le champ « Jeton » (en haut à droite) la valeur exacte de HIVE_TOKEN depuis le fichier .env de l’orchestrateur. Ce n’est pas le jeton GitHub.',
                'Hive token rejected — paste the exact HIVE_TOKEN from the orchestrator’s .env into the Token field (top right). This is not the GitHub token.',
              )}
            </p>
          </div>
        )}

        {journalElague > 0 && (
          <div className="mc-token-banner" role="status">
            <p>
              {t(
                `Journal incomplet : ${journalElague} événement(s) émis pendant une coupure étaient déjà élagués par la Reine — le Journal ne les montrera pas. L’état affiché, lui, est à jour.`,
                `Incomplete journal: ${journalElague} event(s) emitted during a disconnection had already been pruned by the Queen — the Journal will not show them. The displayed state is up to date.`,
              )}{' '}
              <button className="btn ghost" onClick={() => setJournalElague(0)}>
                {t('Compris', 'Got it')}
              </button>
            </p>
          </div>
        )}

        {retourSession !== null && (
          <div className="mc-token-banner mc-session-banner" role="alert">
            <p>
              <strong>
                {t('Session expirée — reconnectez-vous.', 'Session expired — sign in again.')}
              </strong>{' '}
              {t(
                'Les gestes sur les projets de votre compte échouent tant que vous ne vous êtes pas reconnecté·e ; aucun n’est rejoué sans compte.',
                'Actions on your account’s projects fail until you sign in again; none is replayed without an account.',
              )}
            </p>
            <button
              className="btn primary"
              onClick={() => window.dispatchEvent(new Event(EVENT_OUVRIR_COMPTE))}
            >
              {t('Se reconnecter', 'Sign in again')}
            </button>
            <button className="btn ghost" onClick={continuerSansCompte}>
              {t('Continuer sans compte', 'Continue without an account')}
            </button>
          </div>
        )}

        {/* Un seul `main`, autour de la vue courante : chaque vue y entre, et
            le lecteur d'écran trouve le contenu sans traverser la barre. La
            Ruche portait le sien, seule des quatorze — il est devenu un `div`.

            Le filet est RÉARMÉ à chaque adresse — vue ET fiche : une panne de
            la Miellerie ne doit pas suivre l'opérateur jusqu'aux Projets, ni
            celle d'un projet jusqu'au projet suivant. */}
        <main id="mc-contenu" ref={principal} className="mc-main" tabIndex={-1}>
          <FiletDeSecurite adresse={`${route.view}/${route.selectedId ?? ''}`} portee="vue">
            <Suspense
              fallback={
                <div className="mc-view-loading">{t('Chargement de la vue…', 'Loading view…')}</div>
              }
            >
              {route.view === 'ruche' && <Ruche {...viewProps} />}
              {route.view === 'miellerie' && <Miellerie {...viewProps} />}
              {route.view === 'projets' && <Projets {...viewProps} />}
              {route.view === 'essaim' && <Essaim {...viewProps} />}
              {route.view === 'sante' && <Sante {...viewProps} />}
              {route.view === 'chronique' && <Chronique {...viewProps} />}
              {route.view === 'memoire' && <Memoire {...viewProps} />}
              {route.view === 'reine' && <Reine {...viewProps} />}
              {route.view === 'rayon' && <Rayon {...viewProps} />}
              {route.view === 'monespace' && <MonEspace {...viewProps} />}
              {route.view === 'intendance' && <Intendance {...viewProps} />}
              {route.view === 'cerveau' && <Cerveau {...viewProps} />}
              {route.view === 'chantiers' && <Chantiers {...viewProps} />}
              {route.view === 'chambre' && <Chambre {...viewProps} />}
              {route.view === 'warroom' && <WarRoom {...viewProps} />}
            </Suspense>
          </FiletDeSecurite>
        </main>
      </div>

      {openTask && (
        <TaskDrawer
          task={openTask}
          nodes={snapshot.nodes}
          horloge={annonces.get(openTask.id)}
          refreshTick={refreshTick}
          magasinSorties={magasinSorties}
          onClose={() => setOpenTaskId(null)}
        />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}
