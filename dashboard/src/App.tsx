// Hive Studio : la coquille de l'application — le rail (sept sections), la
// barre du haut, la zone centrale et la colonne des agents ; navigation par
// hash sans routeur, tiroir de tâche et dialogues globaux. L'état temps réel
// (instantané + journal) vit ici et descend dans les vues en props (contrat
// ViewProps).
//
// ─── CE QUE HIVE STUDIO (#579) A CHANGÉ, ET CE QUI N'A PAS BOUGÉ ─────────────
//
// Changé : une seule navigation (le rail, `studio/Rail.tsx`), une barre du
// haut qui dit le CONTEXTE (projet actif, liaison, IA, recherche — `Topbar`),
// un accueil où l'on décrit une mission et la suit (`views/Studio.tsx`), une
// colonne des agents (`ColonneDroite`), une palette Ctrl/Cmd+K, un thème
// sombre par défaut.
//
// Pas bougé : chaque page existante, son adresse (`#/miellerie/<id>`), sa
// touche (`3`), le flux temps réel, la session, les revues, le filet sous les
// vues. `NAV` ci-dessous reste la SOURCE DE VÉRITÉ des pages et de leurs
// touches : les gardes `vues-documentees`, `rien-de-mort` et `site-fraicheur`
// la lisent dans ce fichier. Les sept sections du rail RANGENT ces pages
// (`studio/navigation.ts`) ; elles ne les remplacent pas.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HiveEvent, StateSnapshot, SubAgent } from '../../src/shared/types';
import {
  authMe,
  clearJwt,
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
import { Compagnon } from './Compagnon';
import { setLang, useLang, useT } from './i18n';
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
import { doitSonder, pastilleDesAlertes, phraseAlertes } from './views/pastille-alertes';
import { FiletDeSecurite, modalOpen } from './ui';
import Studio from './views/Studio';
import {
  applyReviewEvent,
  beginReviewHydration,
  countPendingReviews,
  countUnsyncedReviews,
  hydrateReviews,
  useApiPoll,
  useReviewTick,
} from './views/shared';
import type { ReviewState } from './views/shared';
import type { ViewId, ViewProps } from './views/shared';
import { ColonneDroite } from './studio/ColonneDroite';
import { Raccourcis, Reglages } from './studio/Dialogues';
import { EnteteSection } from './studio/EnteteSection';
import { Icone } from './studio/Icone';
import { ContexteStudio } from './studio/gestes';
import type { GenreInvitation, GestesStudio } from './studio/gestes';
import { Invitation } from './studio/Invitation';
import { ongletsDe } from './studio/navigation';
import { Palette } from './studio/Palette';
import type { CommandePalette, VuePalette } from './studio/Palette';
import {
  appliquerTheme,
  choisirTheme,
  CLES,
  ecrire,
  lireBooleen,
  lireTheme,
  usePreference,
} from './studio/preferences';
import { useProjetActif } from './studio/projet-actif';
import { Rail } from './studio/Rail';
import { Topbar } from './studio/Topbar';
import type { Attention } from './studio/Topbar';

// Chaque vue est un chunk séparé — l'Accueil (première peinture) reste inline.
const Ruche = lazy(() => import('./views/Ruche'));
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
const Marketplace = lazy(() => import('./views/Marketplace'));

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

interface NavItem {
  id: ViewId;
  label: string;
  labelEn: string;
  /**
   * L'ANCIEN nom de la page, quand Hive Studio l'a renommée : il reste dans
   * l'infobulle de l'onglet et dans la palette, où « Miellerie » trouve
   * toujours la validation.
   */
  ancien?: string;
  ancienEn?: string;
  key: string;
  /** Vue d'administration : l'onglet n'est montré qu'aux admins. */
  admin?: true;
}

const NAV: NavItem[] = [
  { id: 'studio', label: 'Accueil', labelEn: 'Home', key: 's' },
  {
    id: 'ruche',
    label: 'Vue d’ensemble',
    labelEn: 'Overview',
    ancien: 'Ruche',
    ancienEn: 'Hive',
    key: '1',
  },
  { id: 'reine', label: 'Reine', labelEn: 'Queen', key: '2' },
  {
    id: 'miellerie',
    label: 'Validation',
    labelEn: 'Review',
    ancien: 'Miellerie',
    ancienEn: 'Honey House',
    key: '3',
  },
  { id: 'projets', label: 'Projets', labelEn: 'Projects', key: '4' },
  {
    id: 'essaim',
    label: 'Machines',
    labelEn: 'Machines',
    ancien: 'Essaim',
    ancienEn: 'Swarm',
    key: '5',
  },
  { id: 'sante', label: 'Santé', labelEn: 'Health', key: '6' },
  {
    id: 'chronique',
    label: 'Historique',
    labelEn: 'History',
    ancien: 'Chronique',
    ancienEn: 'Chronicle',
    key: '7',
  },
  { id: 'memoire', label: 'Mémoire', labelEn: 'Memory', key: '8' },
  { id: 'rayon', label: 'Code', labelEn: 'Code', ancien: 'Rayon', ancienEn: 'Comb', key: '9' },
  { id: 'monespace', label: 'Mon espace', labelEn: 'My space', key: '0' },
  { id: 'chantiers', label: 'Chantiers', labelEn: 'Works', key: 'h' },
  {
    id: 'warroom',
    label: 'Débats',
    labelEn: 'Debates',
    ancien: 'War Room',
    ancienEn: 'War Room',
    key: 'w',
  },
  { id: 'marketplace', label: 'Projets ouverts', labelEn: 'Open projects', key: 'm' },
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

/** La Chambre n'a pas d'onglet à elle (ADR 0010) : on y ENTRE depuis une machine. */
const CHAMBRE: VuePalette = { id: 'chambre', label: 'Chambre', labelEn: 'Room', key: '' };

/**
 * TOUS les identifiants de vue, y compris ceux qui ne sont pas dans la barre.
 *
 * `parseHash` doit reconnaître `#/intendance` même quand l'onglet est masqué :
 * un administrateur qui ouvre son signet arrive AVANT que `/api/auth/me` ait
 * répondu, et le renvoyer à l'accueil à cet instant-là serait un bug qu'on
 * ne saurait pas reproduire.
 *
 * `chambre` n'a volontairement PAS d'onglet (ADR 0010) : entrée depuis la
 * fiche nœud uniquement (`#/chambre/<nodeId>`).
 */
const VIEW_IDS = new Set<string>([...NAV.map((n) => n.id), 'chambre']);

/** #/vue/id → { view, selectedId } (repli sur l'accueil pour un hash inconnu). */
function parseHash(): { view: ViewId; selectedId: string | null } {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const view = VIEW_IDS.has(parts[0] ?? '') ? (parts[0] as ViewId) : 'studio';
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

/** L'écran est-il au moins aussi large que `min` ? Suit le redimensionnement. */
function useLargeur(min: number): boolean {
  const requete = `(min-width: ${min}px)`;
  const lire = () => typeof window.matchMedia === 'function' && window.matchMedia(requete).matches;
  const [large, setLarge] = useState(lire);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(requete);
    const suivre = () => setLarge(mq.matches);
    suivre();
    mq.addEventListener?.('change', suivre);
    return () => mq.removeEventListener?.('change', suivre);
  }, [requete]);
  return large;
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
    sessionEstExpiree() ? location.hash || '#/studio' : null,
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const reviewTick = useReviewTick();
  const lang = useLang();
  const t = useT();
  // Le gestionnaire de raccourcis est installé UNE fois : il lit la session
  // par référence, sinon il resterait sur celle du premier rendu (null).
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // ─── La coquille du studio : dialogues, tiroirs, préférences d'affichage ──
  const [palette, setPalette] = useState<null | 'tout' | 'commandes'>(null);
  const [invitation, setInvitation] = useState<{ ouvert: boolean; genre: GenreInvitation }>({
    ouvert: false,
    genre: 'machine',
  });
  const [reglages, setReglages] = useState(false);
  const [raccourcis, setRaccourcis] = useState(false);
  const [railMobile, setRailMobile] = useState(false);
  const [colonneTiroir, setColonneTiroir] = useState(false);
  const [focus, setFocus] = useState(false);
  const compact = usePreference(CLES.rail, (v) => lireBooleen(v, false));
  const colonneOuverte = usePreference(CLES.colonne, (v) => lireBooleen(v, true));
  const theme = usePreference(CLES.theme, lireTheme);
  const large = useLargeur(1280);
  const [projetActif, choisirProjet] = useProjetActif(snapshot.projects, snapshot.tasks);

  // Le thème : posé avant React par `public/theme-init.js`, tenu ici ensuite —
  // et, en « automatique », il suit le système quand celui-ci bascule.
  useEffect(() => {
    appliquerTheme(theme);
    if (theme !== 'auto' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const suivre = () => appliquerTheme('auto');
    mq.addEventListener?.('change', suivre);
    return () => mq.removeEventListener?.('change', suivre);
  }, [theme]);

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
      onSortie: (taskId, nodeId, sortie) => magasinSorties.ajouter(taskId, nodeId, sortie),
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
            'delegation_budget_exhausted',
            'routage_consigne',
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
            // un AUTRE opérateur, ce qui laisse une production en attente d'un
            // humain (un renvoi refusé, une relecture impossible), et ce qui
            // la lève (la revue humaine, un forçage de l'Evaluator, le renvoi
            // `task_retry` listé plus haut) — les panneaux qui le montrent se
            // relisent, sans attendre le prochain poll.
            'council_opened',
            'council_closed',
            'council_decided',
            'evaluator_retry_skipped',
            'contre_expertise_impossible',
            'evaluator_overridden',
            'task_reviewed',
            // Une mission ouverte ou close par la Reine : la carte « Mission
            // en cours » de l'accueil relit son résumé.
            'mission_ouverte',
            'mission_close',
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

  // ─── LE FOCUS NE TOMBE PAS AU FOND DE LA PAGE ───────────────────────────────
  //
  // Une vue qui change démonte ce qui avait le focus : l'entrée de la palette
  // qu'on vient de choisir, la tâche qu'on a suivie. Le focus tombait sur
  // <body> — au clavier, on repartait du tout début de la page, et le lecteur
  // d'écran ne disait rien de la page nouvelle. Il va au contenu principal,
  // sans défilement ; un focus encore vivant (un bouton du rail) reste où il est.
  const vuePrecedente = useRef(route.view);
  useEffect(() => {
    if (vuePrecedente.current === route.view) return;
    vuePrecedente.current = route.view;
    const id = window.setTimeout(() => {
      const actif = document.activeElement;
      if (!actif || actif === document.body) principal.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(id);
  }, [route.view]);

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

  // Un changement de page referme le tiroir de navigation (téléphone).
  useEffect(() => setRailMobile(false), [route.view]);

  // Raccourcis de vue sans souris (hors saisie et dialogues) : 1-9 et 0 pour
  // les pages historiques, une lettre pour les autres (`s` l'accueil, `m` les
  // projets ouverts, `h`, `w`, `i`, `c`), `?` pour l'aide.
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
      if (e.key === '?') {
        e.preventDefault();
        setRaccourcis(true);
        return;
      }
      const item = NAV.find((n) => n.key === e.key || e.code === `Digit${n.key}`);
      // Une page masquée n'a pas non plus de raccourci : sinon « i » emmènerait
      // un membre sur un écran qui ne sait que lui dire non.
      if (item && (!item.admin || estAdmin(userRef.current))) navigate(item.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl/Cmd + K : la palette, depuis n'importe où — y compris d'un champ, où
  // ce raccourci ne veut rien dire d'autre. Pas par-dessus un AUTRE dialogue.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      e.preventDefault();
      setPalette((p) => (p !== null ? null : modalOpen() ? null : 'tout'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Échap referme les tiroirs (navigation sur téléphone, colonne des agents).
  useEffect(() => {
    if (!railMobile && !colonneTiroir) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalOpen()) return;
      setRailMobile(false);
      setColonneTiroir(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [railMobile, colonneTiroir]);

  // ─── Pouls de la ruche (rail) ──────────────────────────────────────────────
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
          setRetourSession(location.hash || '#/studio');
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

  // ─── La colonne des agents : posée sur l'accueil large, en tiroir ailleurs ─
  //
  // Sur l'accueil d'un écran large, elle est À DEMEURE (repliable, et le choix
  // se retient). Partout ailleurs — une page dense, un écran étroit — elle
  // s'ouvre en tiroir, à la demande : elle ne prend jamais la place du travail.
  const colonneDockee = route.view === 'studio' && large && colonneOuverte && !focus;
  const colonneVisible = colonneDockee || colonneTiroir;

  const admin = estAdmin(user);
  const vuesOffertes = NAV.filter((n) => !n.admin || admin);

  const gestes = useMemo<GestesStudio>(
    () => ({
      ouvrirPalette: (mode = 'tout') => setPalette(mode),
      ouvrirInvitation: (genre) =>
        setInvitation((i) => ({ ouvert: true, genre: genre ?? i.genre })),
      ouvrirReglages: () => setReglages(true),
      ouvrirRaccourcis: () => setRaccourcis(true),
      basculerColonne: () => {
        if (route.view === 'studio' && large && !focus) {
          ecrire(CLES.colonne, colonneOuverte ? '0' : '1');
          setColonneTiroir(false);
        } else setColonneTiroir((o) => !o);
      },
      nouveauProjet: () => setShowNewProject(true),
      revoirGuide: () => {
        ecrire(CLES.guide, null);
        location.hash = '#/studio';
        if (!(large && colonneOuverte)) setColonneTiroir(true);
      },
    }),
    [route.view, large, focus, colonneOuverte],
  );

  // ─── Ce qui demande l'attention : la cloche de la barre ────────────────────
  const echecsRecents = useMemo(() => {
    const depuis = Date.now() - 24 * 3_600_000;
    return snapshot.tasks.filter((x) => x.status === 'failed' && !x.ombre && x.updatedAt >= depuis)
      .length;
  }, [snapshot.tasks]);
  const attentions = useMemo<Attention[]>(() => {
    const a: Attention[] = [];
    if (tokenAuthError) {
      a.push({
        id: 'jeton',
        gravite: 'critique',
        aller: null,
        texte: t(
          'Jeton de ruche refusé : cet écran ne reçoit plus rien.',
          'Hive token rejected: this screen receives nothing.',
        ),
      });
    }
    if (pendingReviews > 0) {
      a.push({
        id: 'revues',
        gravite: 'attention',
        aller: { vue: 'miellerie' },
        texte: t(
          `${pendingReviews} production(s) attendent ta validation`,
          `${pendingReviews} production(s) await your review`,
        ),
      });
    }
    if (echecsRecents > 0) {
      a.push({
        id: 'echecs',
        gravite: 'critique',
        aller: { vue: 'ruche' },
        texte: t(
          `${echecsRecents} tâche(s) en échec ces dernières 24 h`,
          `${echecsRecents} task(s) failed in the last 24 h`,
        ),
      });
    }
    if (pastille) {
      a.push({
        id: 'alertes',
        gravite: pastille.gravite,
        aller: { vue: 'monespace' },
        texte: phraseAlertes(pastille, lang),
      });
    }
    if (unsyncedReviews > 0) {
      a.push({
        id: 'non-synchro',
        gravite: 'info',
        aller: null,
        texte: t(
          `${unsyncedReviews} verdict(s) posés hors connexion — renvoyés dès que la Reine répond`,
          `${unsyncedReviews} verdict(s) made offline — resent once the Queen responds`,
        ),
      });
    }
    return a;
  }, [tokenAuthError, pendingReviews, echecsRecents, pastille, unsyncedReviews, lang, t]);

  // ─── La palette : les commandes du studio, déjà liées à leur effet ─────────
  const commandes = useMemo<CommandePalette[]>(() => {
    const applique = document.documentElement.dataset.theme === 'clair' ? 'clair' : 'sombre';
    const liste: CommandePalette[] = [
      {
        id: 'nouvelle-mission',
        titre: t('Nouvelle mission', 'New mission'),
        sousTitre: t(
          'Décrire ce que les agents doivent faire',
          'Describe what the agents should do',
        ),
        alias: ['brief', 'plan', 'tache', 'task', 'mission'],
        icone: 'etincelles',
        faire: () => {
          location.hash = '#/studio';
          window.setTimeout(() => document.getElementById('hs-saisie')?.focus(), 80);
        },
      },
      {
        id: 'nouveau-projet',
        titre: t('Nouveau projet', 'New project'),
        alias: ['creer', 'create', 'depot', 'repository'],
        icone: 'plus',
        faire: () => setShowNewProject(true),
      },
      {
        id: 'inviter-machine',
        titre: t('Connecter une machine', 'Connect a machine'),
        sousTitre: t(
          'Un agent de plus : Claude Code, Codex…',
          'One more agent: Claude Code, Codex…',
        ),
        alias: ['inviter', 'invite', 'agent', 'noeud', 'node', 'ouvriere'],
        icone: 'machine',
        faire: () => setInvitation({ ouvert: true, genre: 'machine' }),
      },
      {
        id: 'inviter-personne',
        titre: t('Inviter une personne', 'Invite a person'),
        sousTitre: projetActif ? projetActif.name : undefined,
        alias: ['inviter', 'invite', 'equipe', 'team', 'membre', 'member', 'partager', 'share'],
        icone: 'equipe',
        faire: () => setInvitation({ ouvert: true, genre: 'personne' }),
      },
      {
        id: 'theme',
        titre:
          applique === 'clair' ? t('Thème sombre', 'Dark theme') : t('Thème clair', 'Light theme'),
        alias: ['theme', 'sombre', 'clair', 'dark', 'light', 'apparence'],
        icone: 'reglages',
        faire: () => choisirTheme(applique === 'clair' ? 'sombre' : 'clair'),
      },
      {
        id: 'langue',
        titre: lang === 'fr' ? 'Switch to English' : 'Passer en français',
        alias: ['langue', 'language', 'english', 'francais', 'anglais'],
        icone: 'bulle',
        faire: () => setLang(lang === 'fr' ? 'en' : 'fr'),
      },
      {
        id: 'colonne',
        titre: t('Panneau des agents', 'Agents panel'),
        sousTitre: t('Afficher ou masquer', 'Show or hide'),
        alias: ['colonne', 'column', 'activite', 'activity'],
        icone: 'panneauDroit',
        faire: gestes.basculerColonne,
      },
      {
        id: 'rail',
        titre: compact
          ? t('Déplier la navigation', 'Expand navigation')
          : t('Replier la navigation', 'Collapse navigation'),
        alias: ['rail', 'menu', 'sidebar'],
        icone: 'panneauGauche',
        faire: () => ecrire(CLES.rail, compact ? '0' : '1'),
      },
      {
        id: 'focus',
        titre: focus
          ? t('Quitter le mode focus', 'Leave focus mode')
          : t('Mode focus', 'Focus mode'),
        alias: ['focus', 'plein ecran', 'fullscreen', 'zen'],
        icone: 'agrandir',
        faire: () => setFocus((f) => !f),
      },
      {
        id: 'reglages',
        titre: t('Réglages', 'Settings'),
        alias: ['preferences', 'settings', 'options'],
        icone: 'reglages',
        faire: () => setReglages(true),
      },
      {
        id: 'raccourcis',
        titre: t('Raccourcis clavier', 'Keyboard shortcuts'),
        alias: ['aide', 'help', 'clavier', 'keyboard'],
        icone: 'aide',
        raccourci: '?',
        faire: () => setRaccourcis(true),
      },
    ];
    if (!user) {
      liste.push({
        id: 'connexion',
        titre: t('Se connecter', 'Sign in'),
        alias: ['compte', 'account', 'login', 'connexion'],
        icone: 'equipe',
        faire: () => window.dispatchEvent(new Event(EVENT_OUVRIR_COMPTE)),
      });
    }
    return liste;
  }, [t, lang, projetActif, gestes, compact, focus, user]);

  const onglets: VuePalette[] =
    route.view === 'studio'
      ? []
      : ongletsDe(route.view, admin).map((id) => NAV.find((n) => n.id === id) ?? CHAMBRE);

  return (
    <ContexteStudio.Provider value={gestes}>
      <div
        className="app mc-app"
        data-studio=""
        data-focus={focus ? '' : undefined}
        data-rail-mobile={railMobile ? 'ouvert' : undefined}
      >
        {/* ─── LE LIEN D'ÉVITEMENT, ET POURQUOI IL NE SUIT PAS SON `href` ──────
            La navigation de ce tableau de bord VIT dans le fragment (`#/vue`).
            Laisser le lien suivre `#mc-contenu` réécrirait le fragment :
            `parseHash` ne reconnaîtrait aucune vue et renverrait à l'accueil —
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

        <Rail
          vue={route.view}
          onNavigate={navigate}
          projets={snapshot.projects}
          taches={snapshot.tasks}
          noeuds={snapshot.nodes}
          projetActif={projetActif}
          onChoisirProjet={choisirProjet}
          user={user}
          onDeconnexion={() => {
            clearJwt();
            changerDeCompte(null);
          }}
          aValider={pendingReviews}
          pastille={pastille}
          pouls={{ valeurs: beatValues, reussite: pulse.data ? pulse.data.successRate : null }}
          version={null}
          compact={compact}
          onBasculerCompact={() => ecrire(CLES.rail, compact ? '0' : '1')}
          onChoix={() => setRailMobile(false)}
          compagnon={
            // Le compagnon habite le rail, pas un calque sur les vues : il ne
            // couvre jamais le contenu (voir `Compagnon.tsx`). Il relit les
            // comptes que la barre affiche déjà — jamais un second calcul.
            <Compagnon
              connecte={connected}
              tasks={snapshot.tasks}
              aRevoir={pendingReviews}
              pastille={pastille}
              events={events}
              userId={user?.id ?? null}
            />
          }
        />
        {railMobile && (
          <button
            type="button"
            className="hs-voile rail"
            aria-label={t('Fermer la navigation', 'Close navigation')}
            onClick={() => setRailMobile(false)}
          />
        )}

        <div className="mc-body">
          <Topbar
            projets={snapshot.projects}
            projetActif={projetActif}
            onChoisirProjet={choisirProjet}
            connecte={connected}
            tropLent={tropLent}
            jetonRefuse={tokenAuthError}
            noeuds={snapshot.nodes}
            jeton={token}
            onJeton={setTokenState}
            onAppliquerJeton={applyToken}
            onReconnecter={() => setFeedKey((k) => k + 1)}
            attentions={attentions}
            onNavigate={navigate}
            colonneOuverte={colonneVisible}
            focus={focus}
            onFocus={() => setFocus((f) => !f)}
            onMenu={() => setRailMobile((o) => !o)}
            actions={
              <div className="topbar-actions">
                {/* « + Projet » n'a de sens que LÀ OÙ on gère les projets. Posé
                    dans l'en-tête commun, il suivait les treize vues et proposait
                    de créer un projet depuis la Santé ou le Rayon — une action
                    sans rapport avec ce qu'on regarde. Ailleurs, la palette, le
                    sélecteur de projet et le rail l'offrent. */}
                {route.view === 'projets' && (
                  <button
                    className="hs-btn primaire hs-nouveau-projet"
                    onClick={() => setShowNewProject(true)}
                  >
                    {/* Sur téléphone, l'icône seule ; le mot reste lu (studio.css). */}
                    <Icone nom="plus" taille={16} />
                    <span className="hs-nouveau-projet-mot">{t('+ Projet', '+ Project')}</span>
                  </button>
                )}
              </div>
            }
            compte={
              <AccountPanel
                user={user}
                onUser={changerDeCompte}
                sessionExpiree={retourSession !== null}
              />
            }
          />

          {tokenAuthError && (
            <div className="mc-token-banner" role="alert">
              <p>
                {t(
                  'Jeton de ruche refusé — collez la valeur exacte de HIVE_TOKEN (fichier .env de l’orchestrateur) dans le panneau « Jeton refusé », en haut. Ce n’est pas le jeton GitHub.',
                  'Hive token rejected — paste the exact HIVE_TOKEN from the orchestrator’s .env into the “Token rejected” panel at the top. This is not the GitHub token.',
                )}
              </p>
            </div>
          )}

          {journalElague > 0 && (
            <div className="mc-token-banner" role="status">
              <p>
                {t(
                  `Journal incomplet : ${journalElague} événement(s) émis pendant une coupure étaient déjà élagués par la Reine — l’Historique ne les montrera pas. L’état affiché, lui, est à jour.`,
                  `Incomplete journal: ${journalElague} event(s) emitted during a disconnection had already been pruned by the Queen — History will not show them. The displayed state is up to date.`,
                )}{' '}
                <button className="hs-btn petit" onClick={() => setJournalElague(0)}>
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

          <div className="hs-zone">
            {/* Un seul `main`, autour de la vue courante : chaque vue y entre, et
                le lecteur d'écran trouve le contenu sans traverser la barre.

                Le filet est RÉARMÉ à chaque adresse — vue ET fiche : une panne de
                la Validation ne doit pas suivre l'opérateur jusqu'aux Projets, ni
                celle d'un projet jusqu'au projet suivant. */}
            <main id="mc-contenu" ref={principal} className="mc-main" tabIndex={-1}>
              {route.view !== 'studio' && (
                <EnteteSection
                  vue={route.view}
                  onglets={onglets}
                  onNavigate={(v) => navigate(v)}
                  badges={{
                    miellerie: {
                      n: pendingReviews,
                      titre: t(
                        `${pendingReviews} production(s) à valider`,
                        `${pendingReviews} production(s) to review`,
                      ),
                    },
                  }}
                />
              )}
              <FiletDeSecurite adresse={`${route.view}/${route.selectedId ?? ''}`} portee="vue">
                <Suspense
                  fallback={
                    <div className="mc-view-loading">
                      {t('Chargement de la vue…', 'Loading view…')}
                    </div>
                  }
                >
                  {route.view === 'studio' && <Studio {...viewProps} />}
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
                  {route.view === 'marketplace' && <Marketplace {...viewProps} />}
                </Suspense>
              </FiletDeSecurite>
            </main>
            {colonneVisible && (
              <ColonneDroite
                projet={projetActif}
                projets={snapshot.projects}
                noeuds={snapshot.nodes}
                taches={snapshot.tasks}
                events={events}
                user={user}
                refreshTick={refreshTick}
                onNavigate={navigate}
                onOuvrirTache={setOpenTaskId}
                enTiroir={!colonneDockee}
                onFermer={() => setColonneTiroir(false)}
              />
            )}
          </div>
          {colonneTiroir && !colonneDockee && (
            <button
              type="button"
              className="hs-voile"
              aria-label={t('Fermer le panneau des agents', 'Close agents panel')}
              onClick={() => setColonneTiroir(false)}
            />
          )}
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
        {palette && (
          <Palette
            mode={palette}
            onFermer={() => setPalette(null)}
            commandes={commandes}
            vues={vuesOffertes}
            projets={snapshot.projects}
            taches={snapshot.tasks}
            noeuds={snapshot.nodes}
            onNavigate={navigate}
            onOuvrirTache={setOpenTaskId}
            onChoisirProjet={choisirProjet}
          />
        )}
        <Invitation
          ouvert={invitation.ouvert}
          genre={invitation.genre}
          onGenre={(genre) => setInvitation({ ouvert: true, genre })}
          onFermer={() => setInvitation((i) => ({ ...i, ouvert: false }))}
          events={events}
          projet={projetActif}
          user={user}
          refreshTick={refreshTick}
        />
        {reglages && (
          <Reglages onFermer={() => setReglages(false)} onRevoirGuide={gestes.revoirGuide} />
        )}
        {raccourcis && (
          <Raccourcis
            onFermer={() => setRaccourcis(false)}
            vues={vuesOffertes.map((n) => ({
              key: n.key,
              nom: lang === 'fr' ? n.label : n.labelEn,
            }))}
          />
        )}
      </div>
    </ContexteStudio.Provider>
  );
}
