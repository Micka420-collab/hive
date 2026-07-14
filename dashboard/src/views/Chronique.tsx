// Vue Chronique : le journal complet de la ruche, filtrable par famille
// d'événement, et le mode Time-Lapse — rejouer le passé image par image
// à partir de la frise renvoyée par /api/replay.

import { useEffect, useMemo, useState } from 'react';
import { fetchReplay } from '../api';
import type { ReplayResult } from '../api';
import { STATUS_ICON, STATUS_LABEL } from '../ui';
import { timeShort } from './shared';
import type { ViewProps } from './shared';
import type { TaskStatus } from '../../../src/shared/types';
import './chronique.css';

// ─── Familles d'événements (chips de filtre) ────────────────────────────────

type Family = 'taches' | 'noeuds' | 'merge' | 'conflits' | 'memoire' | 'autres';

const FAMILIES: { id: Family; label: string }[] = [
  { id: 'taches', label: '🐝 Tâches' },
  { id: 'noeuds', label: '🖥️ Nœuds' },
  { id: 'merge', label: '🍯 Merge' },
  { id: 'conflits', label: '🛡️ Conflits' },
  { id: 'memoire', label: '🧬 Mémoire' },
  { id: 'autres', label: '• Autres' },
];

function familyOf(type: string): Family {
  if (type === 'conflict_detected' || type === 'task_conflict_deferred') return 'conflits';
  if (type.startsWith('merge')) return 'merge';
  if (type.startsWith('memory')) return 'memoire';
  if (type.startsWith('task')) return 'taches';
  if (type.startsWith('node')) return 'noeuds';
  return 'autres';
}

const STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

/** Le focus est-il dans un champ de saisie ? (raccourcis clavier neutralisés) */
function isTyping(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function Chronique({ events }: ViewProps) {
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
      merge: 0,
      conflits: 0,
      memoire: 0,
      autres: 0,
    };
    for (const ev of events) c[familyOf(ev.type)] += 1;
    return c;
  }, [events]);

  // Défilement inversé : le plus récent en haut.
  const rows = useMemo(
    () => [...events].reverse().filter((ev) => active.has(familyOf(ev.type))),
    [events, active],
  );

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
      if (isTyping()) return;
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
              <span className="ch-banner-icon" aria-hidden="true">
                ⏪
              </span>{' '}
              vous regardez le passé
            </span>
            <div className="ch-banner-actions">
              <button className="btn" onClick={loadReplay} disabled={loadingReplay}>
                {loadingReplay ? 'Chargement…' : '↻ Recharger'}
              </button>
              <button className="btn primary" onClick={exitReplay}>
                revenir au direct
              </button>
            </div>
          </div>
          <div className="ch-replay-body">
            {frames.length === 0 ? (
              <p className="empty pad">
                Aucun événement à rejouer — la ruche n’a pas encore d’histoire.
              </p>
            ) : (
              <>
                <div className="ch-controls">
                  <button className="btn" onClick={() => goTo(0)} title="Début" aria-label="Début">
                    ⏮
                  </button>
                  <button
                    className="btn"
                    onClick={() => goTo(idx - 1)}
                    title="Frame précédente (←)"
                    aria-label="Frame précédente"
                  >
                    ◀
                  </button>
                  <button
                    className="btn"
                    onClick={togglePlay}
                    title="Lecture / pause (Espace)"
                    aria-label={playing ? 'Pause' : 'Lecture'}
                  >
                    {playing ? '⏸' : '▶'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => goTo(idx + 1)}
                    title="Frame suivante (→)"
                    aria-label="Frame suivante"
                  >
                    ⏭
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={lastIdx}
                    value={idx}
                    onChange={(e) => goTo(Number(e.target.value))}
                    aria-label="Position dans la frise"
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
                        📁 {frame.projects} projet{frame.projects > 1 ? 's' : ''}
                      </span>
                      <span className="chip">
                        🐝 {frame.nodesOnline}/{frame.nodesTotal} nœud
                        {frame.nodesTotal > 1 ? 's' : ''}
                      </span>
                      {STATUSES.map((s) => (
                        <span key={s} className={`badge ${s}`} title={STATUS_LABEL[s]}>
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
          <h2>Chronique de la ruche</h2>
          <div className="filters" role="group" aria-label="Filtres par famille">
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                className={`chip${active.has(f.id) ? ' active' : ''}`}
                onClick={() => toggleFamily(f.id)}
                aria-pressed={active.has(f.id)}
              >
                {f.label} <span className="chip-count">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="ch-head-actions">
            <span className="panel-count">
              {rows.length}/{events.length}
            </span>
            {!inReplay && (
              <button className="btn" onClick={enterReplay} disabled={loadingReplay}>
                {loadingReplay ? 'Chargement…' : '⏪ Time-Lapse'}
              </button>
            )}
          </div>
        </header>
        {replayError && <p className="panel-error">Time-Lapse : {replayError}</p>}
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
          {events.length === 0 && (
            <li className="empty">La ruche n’a encore rien vécu — le journal est vide.</li>
          )}
          {events.length > 0 && rows.length === 0 && (
            <li className="empty">Aucun événement ne passe les filtres actifs.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
