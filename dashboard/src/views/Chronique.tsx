// Vue Chronique : le journal complet de la ruche, filtrable par famille
// d'événement, et le mode Time-Lapse — rejouer le passé image par image
// à partir de la frise renvoyée par /api/replay.

import { useEffect, useMemo, useState } from 'react';
import { fetchReplay } from '../api';
import type { ReplayResult } from '../api';
import { useT, useLang } from '../i18n';
import { modalOpen, STATUS_ICON, statusLabel } from '../ui';
import { timeShort } from './shared';
import type { ViewProps } from './shared';
import type { TaskStatus } from '../../../src/shared/types';
import './chronique.css';

// ─── Familles d'événements (chips de filtre) ────────────────────────────────

type Family =
  | 'taches'
  | 'noeuds'
  | 'courses'
  | 'merge'
  | 'conflits'
  | 'memoire'
  | 'instinct'
  | 'essaim'
  | 'balance'
  | 'autres';

// Double libellé fr/en (constante de module) — résolu via t au rendu.
const FAMILIES: { id: Family; fr: string; en: string }[] = [
  { id: 'taches', fr: 'Tâches', en: 'Tasks' },
  { id: 'noeuds', fr: 'Nœuds', en: 'Nodes' },
  { id: 'courses', fr: 'Courses', en: 'Races' },
  { id: 'merge', fr: 'Merge', en: 'Merge' },
  { id: 'conflits', fr: 'Conflits', en: 'Conflicts' },
  { id: 'memoire', fr: 'Mémoire', en: 'Memory' },
  { id: 'instinct', fr: 'Instinct', en: 'Instinct' },
  { id: 'essaim', fr: 'Essaim', en: 'Swarm' },
  { id: 'balance', fr: 'Balance', en: 'Balance' },
  { id: 'autres', fr: 'Autres', en: 'Other' },
];

/**
 * Instinct de ruche : les trois comportements adaptatifs de l'essaim
 * (phéromones de routage, thermorégulation, couveuse). Ils ne relèvent ni du
 * cycle de vie d'une tâche ni de celui d'un nœud — ils méritent leur filtre.
 * Testé AVANT les préfixes : `thermo_shift` n'est pas un événement de tâche.
 */
const INSTINCT = new Set(['pheromone_route', 'thermo_shift', 'brood_context']);

/**
 * La Balance, geste « borner » : alerte de seuil, plafond atteint, plafond posé
 * ou retiré. Famille à part et non « instinct » : l'instinct est ce que la ruche
 * fait d'elle-même, un plafond est une INTENTION HUMAINE et ses conséquences.
 * C'est le filtre qu'on isole quand on cherche pourquoi un projet ne part plus.
 */
const BALANCE = new Set(['balance_alert', 'balance_cap_reached', 'balance_cap_set']);

const ESSAIM = new Set([
  'essaim_cycle',
  'swarm_level_set',
  'swarm_task_created',
  'bapteme_pose',
  'bapteme_retire',
  'metier_assigne',
]);

function familyOf(type: string): Family {
  if (INSTINCT.has(type)) return 'instinct';
  if (ESSAIM.has(type)) return 'essaim';
  if (BALANCE.has(type)) return 'balance';
  if (type === 'conflict_detected' || type === 'task_conflict_deferred') return 'conflits';
  if (type.startsWith('drone')) return 'courses';
  if (type.startsWith('merge')) return 'merge';
  if (type.startsWith('memory')) return 'memoire';
  if (type.startsWith('task')) return 'taches';
  if (type.startsWith('node')) return 'noeuds';
  return 'autres';
}

const STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

/**
 * Le focus est-il dans un champ de saisie ou un élément interactif ?
 * (raccourcis neutralisés — Espace doit activer un bouton focalisé, pas la
 * lecture du replay, et le range garde ses flèches natives)
 */
function isTyping(): boolean {
  const el = document.activeElement;
  // loupe : équivalent — instanceof HTMLElement → instanceof Object.
  //
  // Le mutant ne se distingue que sur un élément dont le `tagName` vaut
  // exactement « INPUT » (ou l'un des autres) SANS être un HTMLElement. Seul
  // `createElementNS` d'un espace de noms étranger le produit :
  // `document.createElementNS('urn:x', 'INPUT')` rend bien `tagName === 'INPUT'`
  // — la première version de cette note prétendait le contraire, et une sonde
  // l'a démentie (§ 9 duosexagicenties : la PRÉMISSE aussi se mesure).
  //
  // Le verdict tient pour une autre raison, celle-là vérifiable : un tel
  // élément n'a pas de méthode `focus()`, donc il ne peut jamais devenir
  // `document.activeElement`. La branche est inatteignable, et un test qui ne
  // peut pas rougir n'est pas de la couverture.
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    el.isContentEditable
  );
}

export default function Chronique({ events }: ViewProps) {
  const t = useT();
  const lang = useLang();
  // ─── Filtres du journal ────────────────────────────────────────────────
  const [active, setActive] = useState<ReadonlySet<Family>>(
    () => new Set(FAMILIES.map((f) => f.id)),
  );

  const toggleFamily = (f: Family) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const counts = useMemo(() => {
    const c: Record<Family, number> = {
      taches: 0,
      noeuds: 0,
      courses: 0,
      merge: 0,
      conflits: 0,
      memoire: 0,
      instinct: 0,
      essaim: 0,
      balance: 0,
      autres: 0,
    };
    for (const ev of events) c[familyOf(ev.type)] += 1;
    return c;
  }, [events]);

  // Défilement inversé : le plus récent en haut. Rendu plafonné (pas de
  // virtualisation) : au-delà, un bouton « voir plus » étend par paliers.
  const PAGE = 300;
  const [visible, setVisible] = useState(PAGE);
  const allRows = useMemo(
    () => [...events].reverse().filter((ev) => active.has(familyOf(ev.type))),
    [events, active],
  );
  const rows = useMemo(() => allRows.slice(0, visible), [allRows, visible]);

  // ─── Mode Time-Lapse ───────────────────────────────────────────────────
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [inReplay, setInReplay] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const loadReplay = () => {
    setLoadingReplay(true);
    setReplayError(null);
    fetchReplay()
      .then((r) => {
        setReplay(r);
        setIdx(0);
        setPlaying(false);
        setInReplay(true);
      })
      .catch((e: unknown) => setReplayError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingReplay(false));
  };

  // Premier clic : un seul fetch ; les entrées suivantes réutilisent la frise.
  const enterReplay = () => {
    if (replay) setInReplay(true);
    else loadReplay();
  };

  const exitReplay = () => {
    setInReplay(false);
    setPlaying(false);
  };

  const frames = replay?.frames ?? [];
  const lastIdx = frames.length - 1;
  const frame = frames[idx];

  const goTo = (i: number) => {
    setPlaying(false);
    setIdx(Math.min(Math.max(i, 0), Math.max(lastIdx, 0)));
  };

  const togglePlay = () => {
    if (frames.length === 0) return;
    if (!playing && idx >= lastIdx) setIdx(0); // relire depuis le début
    setPlaying(!playing);
  };

  // Lecture : une frame toutes les 300 ms.
  useEffect(() => {
    if (!playing || !replay || replay.frames.length < 2) return;
    const last = replay.frames.length - 1;
    const id = window.setInterval(() => setIdx((i) => Math.min(i + 1, last)), 300);
    return () => window.clearInterval(id);
  }, [playing, replay]);

  // Pause automatique en fin de frise.
  useEffect(() => {
    if (playing && replay && idx >= replay.frames.length - 1) setPlaying(false);
  }, [playing, replay, idx]);

  // Raccourcis : Espace = lecture/pause, ←/→ = pas à pas (hors champ de saisie).
  useEffect(() => {
    if (!inReplay || !replay || replay.frames.length === 0) return;
    const last = replay.frames.length - 1;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || modalOpen()) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!playing && idx >= last) setIdx(0);
        setPlaying(!playing);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlaying(false);
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlaying(false);
        setIdx((i) => Math.min(i + 1, last));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inReplay, replay, playing, idx]);

  return (
    <div className="mc-view ch-view">
      {inReplay && (
        <section className="card ch-replay ch-past" aria-label="Time-Lapse">
          <div className="ch-banner">
            <span>
              <span className="ch-banner-icon marque" aria-hidden="true" />{' '}
              {t('vous regardez le passé', 'you are watching the past')}
            </span>
            <div className="ch-banner-actions">
              <button className="btn" onClick={loadReplay} disabled={loadingReplay}>
                {loadingReplay ? t('Chargement…', 'Loading…') : t('Recharger', 'Reload')}
              </button>
              <button className="btn primary" onClick={exitReplay}>
                {t('revenir au direct', 'back to live')}
              </button>
            </div>
          </div>
          <div className="ch-replay-body">
            {frames.length === 0 ? (
              <p className="empty pad">
                <span className="marque" aria-hidden="true" />{' '}
                {t('Rien à rejouer pour l’instant.', 'Nothing to replay yet.')}
              </p>
            ) : (
              <>
                <div className="ch-controls">
                  <button
                    className="btn"
                    onClick={() => goTo(0)}
                    title={t('Début', 'Start')}
                    aria-label={t('Début', 'Start')}
                  >
                    ⏮
                  </button>
                  <button
                    className="btn"
                    onClick={() => goTo(idx - 1)}
                    title={t('Frame précédente (←)', 'Previous frame (←)')}
                    aria-label={t('Frame précédente', 'Previous frame')}
                  >
                    ◀
                  </button>
                  <button
                    className="btn"
                    onClick={togglePlay}
                    title={t('Lecture / pause (Espace)', 'Play / pause (Space)')}
                    aria-label={playing ? t('Pause', 'Pause') : t('Lecture', 'Play')}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => goTo(idx + 1)}
                    title={t('Frame suivante (→)', 'Next frame (→)')}
                    aria-label={t('Frame suivante', 'Next frame')}
                  >
                    ⏭
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={lastIdx}
                    value={idx}
                    onChange={(e) => goTo(Number(e.target.value))}
                    aria-label={t('Position dans la frise', 'Position in the timeline')}
                  />
                </div>
                {frame && (
                  <>
                    <div className="ch-frame-meta">
                      <span className="ch-frame-pos mono">
                        {idx + 1}/{frames.length}
                      </span>
                      <span className="ch-type mono">{frame.type}</span>
                      <time className="jtime">{timeShort(frame.ts)}</time>
                    </div>
                    <div className="ch-counts">
                      <span className="chip">
                        {frame.projects} {t('projet', 'project')}
                        {frame.projects > 1 ? 's' : ''}
                      </span>
                      <span className="chip">
                        {frame.nodesOnline}/{frame.nodesTotal} {t('nœud', 'node')}
                        {frame.nodesTotal > 1 ? 's' : ''}
                      </span>
                      {STATUSES.map((s) => (
                        <span key={s} className={`badge ${s}`} title={statusLabel(s, lang)}>
                          <span className="badge-icon">{STATUS_ICON[s]}</span>
                          {frame.tasks[s]}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}

      <section className="card panel ch-journal-panel">
        <header className="panel-head">
          <h2>
            <span className="marque" aria-hidden="true" />{' '}
            {t('Chronique de la ruche', 'Chronicle of the hive')}
          </h2>
          <div
            className="filters ch-filters"
            role="group"
            aria-label={t('Filtres par famille', 'Filters by family')}
          >
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                className={`chip${active.has(f.id) ? ' active' : ''}`}
                onClick={() => toggleFamily(f.id)}
                aria-pressed={active.has(f.id)}
              >
                {t(f.fr, f.en)} <span className="chip-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="ch-head-actions">
            <span className="panel-count">
              {allRows.length}/{events.length}
            </span>
            {!inReplay && (
              <button className="btn" onClick={enterReplay} disabled={loadingReplay}>
                {loadingReplay ? t('Chargement…', 'Loading…') : t('Time-Lapse', 'Time-Lapse')}
              </button>
            )}
          </div>
        </header>
        {replayError && (
          <p className="panel-error">
            {t('Time-Lapse :', 'Time-Lapse:')} {replayError}
          </p>
        )}
        <ul className="ch-journal">
          {rows.map((ev) => {
            const full = JSON.stringify(ev.payload);
            const compact = full.length > 120 ? `${full.slice(0, 120)}…` : full;
            return (
              <li key={ev.id} className={`ch-row fam-${familyOf(ev.type)}`}>
                <time className="jtime">{timeShort(ev.ts)}</time>
                <span className="ch-type mono">{ev.type}</span>
                <span className="ch-payload" title={full}>
                  {compact}
                </span>
              </li>
            );
          })}
          {allRows.length > visible && (
            <li className="ch-more">
              <button className="btn" onClick={() => setVisible((v) => v + PAGE)}>
                {t('Voir', 'Show')} {Math.min(PAGE, allRows.length - visible)}{' '}
                {t('événement(s) de plus', 'more event(s)')}
              </button>
            </li>
          )}
          {events.length === 0 && (
            <li className="empty">
              <span className="marque" aria-hidden="true" />{' '}
              {t('Rien pour l’instant.', 'Nothing yet.')}
            </li>
          )}
          {events.length > 0 && allRows.length === 0 && (
            <li className="empty">
              <span className="marque" aria-hidden="true" />{' '}
              {t(
                'Aucun événement ne passe les filtres actifs.',
                'No events match the active filters.',
              )}
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
