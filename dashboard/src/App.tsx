// Hive Mission Control : shell de l'application — sidebar alvéolaire (7 vues,
// navigation par hash sans router), topbar compacte, pouls de la ruche (ECG),
// tiroir de tâche et modales globales. L'état temps réel (snapshot + journal)
// vit ici et descend dans les vues en props (contrat ViewProps).

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
  saveToken,
} from './api';
import type { AuthUser } from './api';
import { AccountPanel } from './AccountPanel';
import { setLang, useLang, useT } from './i18n';
import { InvitePanel } from './InvitePanel';
import { NewProjectModal } from './NewProjectModal';
import { ShellNavigation, type NavItem } from './ShellNavigation';
import { TaskDrawer } from './TaskDrawer';
import { transitionDifferees } from './differees';
import { doitSonder, pastilleDesAlertes } from './views/pastille-alertes';
import { modalOpen } from './ui';
import Ruche from './views/Ruche';
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

const EMPTY: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

const NAV: NavItem[] = [
  {
    id: 'ruche',
    label: 'Ruche',
    labelEn: 'Hive',
    description: 'Vue d’ensemble',
    descriptionEn: 'Overview',
    key: '1',
    section: 'piloter',
  },
  {
    id: 'reine',
    label: 'Reine',
    labelEn: 'Queen',
    description: 'Assistant & décisions',
    descriptionEn: 'Assistant & decisions',
    key: '2',
    section: 'piloter',
  },
  {
    id: 'projets',
    label: 'Projets',
    labelEn: 'Projects',
    description: 'Créer & organiser',
    descriptionEn: 'Create & organize',
    key: '4',
    section: 'produire',
  },
  {
    id: 'miellerie',
    label: 'Miellerie',
    labelEn: 'Honey House',
    description: 'Revoir & fusionner',
    descriptionEn: 'Review & merge',
    key: '3',
    section: 'produire',
  },
  {
    id: 'rayon',
    label: 'Rayon',
    labelEn: 'Comb',
    description: 'Code & sauvegardes',
    descriptionEn: 'Code & backups',
    key: '9',
    section: 'produire',
  },
  {
    id: 'chantiers',
    label: 'Chantiers',
    labelEn: 'Works',
    description: 'Scripts & automatisations',
    descriptionEn: 'Scripts & automation',
    key: 'h',
    section: 'produire',
  },
  {
    id: 'essaim',
    label: 'Essaim',
    labelEn: 'Swarm',
    description: 'Agents & capacité',
    descriptionEn: 'Agents & capacity',
    key: '5',
    section: 'observer',
  },
  {
    id: 'sante',
    label: 'Santé',
    labelEn: 'Health',
    description: 'État & alertes',
    descriptionEn: 'Status & alerts',
    key: '6',
    section: 'observer',
  },
  {
    id: 'chronique',
    label: 'Chronique',
    labelEn: 'Chronicle',
    description: 'Historique d’activité',
    descriptionEn: 'Activity history',
    key: '7',
    section: 'observer',
  },
  {
    id: 'memoire',
    label: 'Mémoire',
    labelEn: 'Memory',
    description: 'Connaissances apprises',
    descriptionEn: 'Learned knowledge',
    key: '8',
    section: 'observer',
  },
  {
    id: 'monespace',
    label: 'Mon espace',
    labelEn: 'My space',
    description: 'Compte & préférences',
    descriptionEn: 'Account & preferences',
    key: '0',
    section: 'espace',
  },
  {
    id: 'intendance',
    label: 'Intendance',
    labelEn: 'Stewardship',
    description: 'Membres & machines',
    descriptionEn: 'Members & machines',
    key: 'i',
    section: 'admin',
    admin: true,
  },
  {
    id: 'cerveau',
    label: 'Cerveau',
    labelEn: 'Brain',
    description: 'Graphe de connaissances',
    descriptionEn: 'Knowledge graph',
    key: 'c',
    section: 'admin',
    admin: true,
  },
];

/**
 * TOUS les identifiants de vue, y compris ceux qui ne sont pas dans la barre.
 *
 * `parseHash` doit reconnaître `#/intendance` même quand la case est masquée :
 * un administrateur qui ouvre son signet arrive AVANT que `/api/auth/me` ait
 * répondu, et le renvoyer sur la Ruche à cet instant-là serait un bug qu'on
 * ne saurait pas reproduire.
 */
const VIEW_IDS = new Set<string>(NAV.map((n) => n.id));

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
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [connected, setConnected] = useState(false);
  const [token, setTokenState] = useState(getToken());
  const [feedKey, setFeedKey] = useState(0);
  const [route, setRoute] = useState(parseHash);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reviewSyncError, setReviewSyncError] = useState<{
    definitive: boolean;
    taskId: string;
  } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const reviewTick = useReviewTick();
  const lang = useLang();
  const t = useT();
  // Le gestionnaire de raccourcis est installé UNE fois : il lit la session
  // par référence, sinon il resterait sur celle du premier rendu (null).
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;
  // Coalescence des invalidations : une rafale d'événements → 1 re-fetch/s max.
  const refreshTimer = useRef<number | undefined>(undefined);

  // ─── Flux temps réel ────────────────────────────────────────────────────────
  useEffect(() => {
    const feed = connectFeed({
      onState: setSnapshot,
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
            'node_online',
            'node_offline',
            // Changement de régime thermique : la jauge de Santé doit refléter
            // la nouvelle bande appliquée sans attendre le prochain poll.
            'thermo_shift',
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
        } else if (
          ['task_done', 'task_failed', 'task_cancelled', 'task_requeued', 'task_retry'].includes(
            ev.type,
          )
        ) {
          setAgentsByTask((prev) => {
            if (!(taskId in prev)) return prev;
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
        }
        // La transition vit dans `differees.ts`, PUR — la loupe l'avait rendue
        // SANS TEST tant qu'elle était enfouie ici. Rendre `prev` lui-même
        // quand rien ne change est le contrat : même référence, pas de rendu.
        setDeferred((prev) => transitionDifferees(prev, ev.type, taskId) as Set<string>);
      },
      onStatus: (up) => {
        setConnected(up);
        // À CHAQUE (re)connexion : ré-hydrater les revues — les task_reviewed
        // émis pendant une coupure ne sont jamais rejoués par le serveur.
        if (up) {
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
  }, [feedKey]);

  // ─── Navigation par hash ────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      setMobileNavOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.body.classList.add('mc-nav-open');
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('mc-nav-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const value = detail as { definitive?: unknown; taskId?: unknown };
      if (typeof value.taskId !== 'string') return;
      setReviewSyncError({
        definitive: value.definitive === true,
        taskId: value.taskId,
      });
    };
    window.addEventListener('hive:review-sync-error', onError);
    return () => window.removeEventListener('hive:review-sync-error', onError);
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
    setFeedKey((k) => k + 1);
  };

  // Session utilisateur (JWT) : restaurée au montage si un jeton est présent.
  // Un jeton périmé est simplement purgé — le dashboard vit très bien sans
  // compte (le token de ruche suffit pour tout le reste).
  useEffect(() => {
    if (!getJwt()) return;
    let alive = true;
    authMe()
      .then((u) => alive && setUser(u))
      .catch(() => {
        clearJwt();
        if (alive) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

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
  const current = NAV.find((n) => n.id === route.view) ?? NAV[0]!;

  return (
    <div className="app mc-app">
      <a className="mc-skip-link" href="#main-content">
        {t('Aller au contenu', 'Skip to content')}
      </a>
      <ShellNavigation
        items={NAV.filter((item) => !item.admin || estAdmin(user))}
        current={route.view}
        lang={lang}
        t={t}
        onNavigate={navigate}
        pendingReviews={pendingReviews}
        pastille={pastille}
        beatValues={beatValues}
        successRate={pulse.data?.successRate ?? null}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="mc-body">
        <header className="topbar mc-topbar">
          <div className="brand">
            <button
              type="button"
              className="mc-mobile-menu-btn"
              aria-label={t('Ouvrir la navigation', 'Open navigation')}
              aria-controls="mc-primary-navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
            <div>
              <h1>{lang === 'fr' ? current.label : current.labelEn}</h1>
              <span className="brand-sub">
                {lang === 'fr' ? current.description : current.descriptionEn}
                {' · '}
                {snapshot.projects.length} {t('projet(s)', 'project(s)')}
                {' · '}
                {snapshot.nodes.length} {t('nœud(s)', 'node(s)')}
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
            <details className="mc-utility">
              <summary
                className={`mc-utility-trigger ${connected ? 'online' : 'offline'}`}
                aria-label={t('Ouvrir les réglages et le compte', 'Open settings and account')}
              >
                <span className="conn-dot" aria-hidden="true" />
                <span className="mc-utility-status">
                  {connected ? t('Connecté', 'Connected') : t('Hors ligne', 'Offline')}
                </span>
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 7h14M8 12h8M10 17h4" />
                </svg>
              </summary>
              <div className="mc-utility-popover">
                <div className="mc-utility-heading">
                  <span className={`conn ${connected ? 'online' : 'offline'}`}>
                    <span className="conn-dot" aria-hidden="true" />
                    {connected
                      ? t('Ruche connectée', 'Hive connected')
                      : t('Ruche hors ligne', 'Hive offline')}
                  </span>
                  <p>
                    {t(
                      'Compte, invitation, langue et connexion au même endroit.',
                      'Account, invitation, language and connection in one place.',
                    )}
                  </p>
                </div>

                {connected && (
                  <label className="mc-token-field" htmlFor="hive-token-menu">
                    <span>{t('Jeton de la ruche', 'Hive token')}</span>
                    <input
                      id="hive-token-menu"
                      type="password"
                      className="token-input"
                      placeholder={t('Jeton', 'Token')}
                      value={token}
                      onChange={(e) => setTokenState(e.target.value)}
                      onBlur={applyToken}
                      onKeyDown={(e) => e.key === 'Enter' && applyToken()}
                      autoComplete="off"
                    />
                  </label>
                )}

                <div className="mc-utility-actions">
                  <AccountPanel user={user} onUser={setUser} />
                  <InvitePanel />
                  <button
                    type="button"
                    className="btn ghost mc-lang"
                    onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
                  >
                    {t('Interface en anglais', 'Interface in French')} ·{' '}
                    <strong>{lang === 'fr' ? 'EN' : 'FR'}</strong>
                  </button>
                </div>
              </div>
            </details>
          </div>
        </header>

        {!connected && (
          <section className="mc-connection-guide" aria-labelledby="mc-connection-title">
            <span className="mc-connection-mark" aria-hidden="true" />
            <div className="mc-connection-copy">
              <strong id="mc-connection-title">
                {t(
                  'Connectez Mission Control à votre ruche',
                  'Connect Mission Control to your hive',
                )}
              </strong>
              <span>
                {t(
                  'Collez HIVE_TOKEN depuis votre fichier .env. Il reste dans ce navigateur.',
                  'Paste HIVE_TOKEN from your .env file. It stays in this browser.',
                )}
              </span>
            </div>
            <label className="mc-connection-token" htmlFor="hive-token-guide">
              <span className="sr-only">{t('Jeton de la ruche', 'Hive token')}</span>
              <input
                id="hive-token-guide"
                type="password"
                className="token-input"
                placeholder={t('Votre jeton HIVE_TOKEN', 'Your HIVE_TOKEN')}
                value={token}
                onChange={(e) => setTokenState(e.target.value)}
                onBlur={applyToken}
                onKeyDown={(e) => e.key === 'Enter' && applyToken()}
                autoComplete="off"
              />
            </label>
            <button type="button" className="btn primary" onClick={applyToken}>
              {t('Connecter', 'Connect')}
            </button>
          </section>
        )}

        <main id="main-content" className="mc-main" tabIndex={-1}>
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
          </Suspense>
        </main>
      </div>

      {reviewSyncError && (
        <aside className="mc-toast mc-toast-error" role="alert">
          <span className="mc-toast-mark" aria-hidden="true">
            !
          </span>
          <div>
            <strong>
              {reviewSyncError.definitive
                ? t('Revue non enregistrée', 'Review not saved')
                : t('Revue en attente de synchronisation', 'Review awaiting sync')}
            </strong>
            <p>
              {reviewSyncError.definitive
                ? t(
                    'La ruche a refusé ce verdict ; la décision précédente a été restaurée.',
                    'The hive rejected this verdict; the previous decision was restored.',
                  )
                : t(
                    'La connexion a échoué. Votre verdict sera renvoyé automatiquement.',
                    'Connection failed. Your verdict will be sent again automatically.',
                  )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setReviewSyncError(null)}
            aria-label={t('Fermer le message', 'Dismiss message')}
          >
            ×
          </button>
        </aside>
      )}

      {openTask && (
        <TaskDrawer task={openTask} nodes={snapshot.nodes} onClose={() => setOpenTaskId(null)} />
      )}
      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} />}
    </div>
  );
}
