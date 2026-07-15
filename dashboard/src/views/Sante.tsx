// Vue Santé — signes vitaux de la ruche (Hive Pulse) et anomalies détectées
// dans le journal (Ghost in the Hive). Tout est lu via REST, poll léger.

import { useEffect, useState } from 'react';
import { fetchGhosts, fetchPulse } from '../api';
import type { Ghost, HivePulse } from '../api';
import { useT } from '../i18n';
import { activateProps, formatMs } from '../ui';
import { Sparkline, timeShort, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { StateSnapshot } from '../../../src/shared/types';
import './essaim.css';

const SEV_ICON: Record<Ghost['severity'], string> = { high: '🔴', medium: '🟠', low: '🟡' };

// Double record fr/en (constante de module) — résolu via t au rendu.
const KIND_LABEL: Record<Ghost['kind'], { fr: string; en: string }> = {
  flaky_node: { fr: 'nœud instable', en: 'flaky node' },
  silent_node: { fr: 'nœud silencieux', en: 'silent node' },
  looping_task: { fr: 'tâche en boucle', en: 'looping task' },
  rejecting_node: { fr: 'nœud récalcitrant', en: 'rejecting node' },
  infra_node: { fr: 'panne d’infrastructure', en: 'infrastructure failure' },
};

/** Résout la cible d'une anomalie en nom lisible (nœud ou tâche) via le snapshot. */
function resolveTarget(
  ghost: Ghost,
  snapshot: StateSnapshot,
): { label: string; taskId: string | null } {
  if (ghost.kind === 'looping_task') {
    const task = snapshot.tasks.find((t) => t.id === ghost.target);
    return { label: task ? task.title : ghost.target, taskId: ghost.target };
  }
  const node = snapshot.nodes.find((n) => n.id === ghost.target);
  return { label: node ? node.name : ghost.target, taskId: null };
}

/** Tuiles de signes vitaux : débit, latences, succès, nœuds actifs. */
function PulseTiles({ pulse }: { pulse: HivePulse }) {
  const t = useT();
  const buckets = pulse.throughput.slice(-24);
  const spark = buckets.map((b) => b.done + b.failed);
  const last = buckets[buckets.length - 1];
  const perHour = last ? last.done + last.failed : 0;
  const successPct = Math.round(pulse.successRate * 100);

  return (
    <div className="es-tiles">
      <div className="tile">
        <div className="tile-value">
          {perHour} <span className="tile-unit">{t('tâches/h', 'tasks/h')}</span>
        </div>
        <div className="tile-label">{t('Débit', 'Throughput')}</div>
        <Sparkline values={spark} width={140} height={26} />
        <div className="tile-sub">
          {t('24 dernières tranches horaires', 'last 24 hourly buckets')}
        </div>
      </div>
      <div className="tile">
        <div className="tile-value">{formatMs(pulse.latency.p50)}</div>
        <div className="tile-label">{t('Latence p50', 'p50 latency')}</div>
        <div className="tile-sub">
          p95 {formatMs(pulse.latency.p95)} · max {formatMs(pulse.latency.max)} · n=
          {pulse.latency.count}
        </div>
      </div>
      <div className={successPct < 50 ? 'tile danger' : 'tile'}>
        <div className="tile-value">
          {successPct} <span className="tile-unit">%</span>
        </div>
        <div className="tile-label">{t('Taux de succès', 'Success rate')}</div>
        <div className="tile-sub">
          ✔ {pulse.totalDone} · ✘ {pulse.totalFailed}
        </div>
      </div>
      <div className="tile accent">
        <div className="tile-value">{pulse.activeNodes}</div>
        <div className="tile-label">{t('Nœuds actifs', 'Active nodes')}</div>
      </div>
    </div>
  );
}

export default function Sante({ snapshot, refreshTick, onOpenTask }: ViewProps) {
  const t = useT();
  const pulse = useApiPoll(fetchPulse, 20_000, refreshTick);
  const ghost = useApiPoll(fetchGhosts, 30_000, refreshTick);

  // Heure locale du dernier relevé effectivement reçu.
  const [lastReading, setLastReading] = useState<number | null>(null);
  useEffect(() => {
    if (pulse.data) setLastReading(Date.now());
  }, [pulse.data]);

  const report = ghost.data;

  return (
    <div className="mc-view es-view">
      <section className="card">
        <header className="panel-head">
          <h2>{t('Signes vitaux', 'Vital signs')}</h2>
          <span className="panel-count">
            {lastReading === null
              ? t('prise de pouls…', 'taking the pulse…')
              : `${t('dernier relevé à', 'last reading at')} ${timeShort(lastReading)}`}
          </span>
        </header>
        {pulse.error && <p className="panel-error">{pulse.error}</p>}
        {pulse.data ? (
          <PulseTiles pulse={pulse.data} />
        ) : (
          !pulse.error && (
            <p className="empty pad">{t('Auscultation de la ruche…', 'Listening to the hive…')}</p>
          )
        )}
      </section>

      <section className="card">
        <header className="panel-head">
          <h2>{t('Fantômes de la ruche', 'Ghosts in the hive')}</h2>
          {report && (
            <span className={report.ghosts.length > 0 ? 'panel-count warn' : 'panel-count'}>
              {report.ghosts.length}{' '}
              {report.ghosts.length > 1 ? t('anomalies', 'anomalies') : t('anomalie', 'anomaly')}
            </span>
          )}
        </header>
        {ghost.error && <p className="panel-error">{ghost.error}</p>}
        {!report && !ghost.error && (
          <p className="empty pad">
            {t('Chasse aux fantômes en cours…', 'Ghost hunt in progress…')}
          </p>
        )}

        {report && report.ghosts.length === 0 && (
          <div className="es-calm">
            <div className="es-calm-hex" aria-hidden="true">
              🐝
            </div>
            <p className="es-calm-text">
              {t('La ruche bourdonne paisiblement', 'The hive is humming peacefully')}
            </p>
            <p className="es-scanned">
              {report.scanned.events} {t('événements', 'events')} · {report.scanned.nodes}{' '}
              {t('nœuds', 'nodes')} · {report.scanned.tasks}{' '}
              {t('tâches passés au crible', 'tasks sifted through')}
            </p>
          </div>
        )}

        {report && report.ghosts.length > 0 && (
          <>
            <ul className="es-ghost-list">
              {report.ghosts.map((g) => {
                const { label, taskId } = resolveTarget(g, snapshot);
                const extra = taskId === null ? {} : activateProps(() => onOpenTask(taskId));
                return (
                  <li
                    key={`${g.kind}:${g.target}`}
                    className={`es-ghost ${g.severity}${taskId === null ? '' : ' clickable'}`}
                    {...extra}
                  >
                    <span className="es-ghost-icon" aria-hidden="true">
                      {SEV_ICON[g.severity]}
                    </span>
                    <div className="es-ghost-body">
                      <span
                        className="es-ghost-kind"
                        title={t(KIND_LABEL[g.kind].fr, KIND_LABEL[g.kind].en)}
                      >
                        [{g.kind}]
                      </span>
                      <span className="es-ghost-target">{label}</span>
                      <p className="es-ghost-detail">{g.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="es-scanned">
              {report.scanned.events} {t('événements', 'events')} · {report.scanned.nodes}{' '}
              {t('nœuds', 'nodes')} · {report.scanned.tasks}{' '}
              {t('tâches passés au crible', 'tasks sifted through')}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
