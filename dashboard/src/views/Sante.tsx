// Vue Santé — signes vitaux de la ruche (Hive Pulse) et anomalies détectées
// dans le journal (Ghost in the Hive). Tout est lu via REST, poll léger.

import { useEffect, useState } from 'react';
import { fetchBalance, fetchGhosts, fetchGuet, fetchPulse, fetchThermo } from '../api';
import type { NiveauGuet } from '../api';
import type { Ghost, HivePulse, ThermoState } from '../api';
import { useT } from '../i18n';
import { activateProps, BANDE_LABEL, BANDES, formatMs } from '../ui';
import { CarteBalance } from './Balance';
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

/**
 * Thermorégulation : la jauge de température de la ruche et la ventilation
 * qu'elle applique. Deux états y cohabitent volontairement :
 *  - la LECTURE instantanée (`lecture.temperature` / `lecture.bande`), qui
 *    donne la position du curseur sur l'échelle ;
 *  - l'état APPLIQUÉ (`applique.bande` / `applique.facteur`), hystérésé : il ne
 *    suit la lecture qu'après un second relevé concordant. Leur divergence est
 *    la chose la plus utile à montrer — elle explique pourquoi la concurrence
 *    n'a pas encore bougé alors que le thermomètre, lui, a déjà grimpé.
 */
function ThermoGauge({ thermo }: { thermo: ThermoState }) {
  const t = useT();
  const { instantane: lecture, applique: regime } = thermo;
  const { temperature, signaux } = lecture;
  const diverge = lecture.bande !== regime.bande;
  const lu = t(BANDE_LABEL[lecture.bande].fr, BANDE_LABEL[lecture.bande].en);
  const applique = t(BANDE_LABEL[regime.bande].fr, BANDE_LABEL[regime.bande].en);

  return (
    <div className={`es-thermo bande-${lecture.bande}`}>
      <div className="es-thermo-top">
        <span className="es-thermo-value">{temperature}°</span>
        <span className="es-thermo-band">{lu}</span>
        <span className="es-thermo-hint">{t('lecture instantanée', 'instant reading')}</span>
      </div>

      <div
        className="es-thermo-gauge"
        role="meter"
        aria-label={t('Température de la ruche', 'Hive temperature')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={temperature}
        aria-valuetext={t(`${temperature} sur 100 — bande ${lu}`, `${temperature} of 100 — ${lu}`)}
      >
        <div className="es-thermo-track" aria-hidden="true" />
        <div className="es-thermo-needle" style={{ left: `${temperature}%` }} aria-hidden="true" />
      </div>
      <div className="es-thermo-scale">
        {BANDES.map((b) => (
          <span key={b} className={b === lecture.bande ? 'on' : undefined}>
            {t(BANDE_LABEL[b].fr, BANDE_LABEL[b].en)}
          </span>
        ))}
      </div>

      <div className="es-thermo-applied">
        <span>
          {t('État appliqué', 'Applied state')} : <strong>{applique}</strong>
        </span>
        <span className="es-thermo-factor">
          {t('concurrence', 'concurrency')} ×{regime.facteur}
        </span>
        {diverge && (
          <span className="es-thermo-pending">
            ⏳ {t('confirmation en cours', 'awaiting confirmation')}
          </span>
        )}
      </div>

      {diverge && (
        <p className="es-thermo-note">
          {t(
            `Lecture : ${lu} · appliqué : ${applique} — l’hystérésis attend un second relevé concordant avant de changer de régime.`,
            `Reading: ${lu} · applied: ${applique} — hysteresis waits for a second matching reading before switching regime.`,
          )}
        </p>
      )}
      <p className="es-thermo-note">
        {t(
          'Quand la ruche chauffe, elle réduit la concurrence de chaque nœud pour refroidir — puis la restaure quand les issues redeviennent favorables.',
          'When the hive heats up it lowers each node’s concurrency to cool down — and restores it once outcomes improve.',
        )}
      </p>
      <p className="es-thermo-signals">
        ✔ {signaux.succes} {t('succès', 'successes')} · ✘ {signaux.echecs} {t('échecs', 'failures')}{' '}
        · 🔁 {signaux.retries} {t('re-tentatives', 'retries')} · ⇄ {signaux.refusInfra}{' '}
        {t('refus infra', 'infra declines')} — {t('fenêtre de 10 min', '10-min window')}
      </p>
    </div>
  );
}

export default function Sante({ snapshot, refreshTick, onOpenTask }: ViewProps) {
  const t = useT();
  const pulse = useApiPoll(fetchPulse, 20_000, refreshTick);
  const ghost = useApiPoll(fetchGhosts, 30_000, refreshTick);
  const thermo = useApiPoll(fetchThermo, 20_000, refreshTick);
  // La Balance bouge à l'échelle de l'heure et le serveur la mémoïse : la
  // cadence des fantômes suffit largement.
  const balance = useApiPoll(fetchBalance, 30_000, refreshTick);

  // Heure locale du dernier relevé effectivement reçu.
  const [lastReading, setLastReading] = useState<number | null>(null);
  useEffect(() => {
    if (pulse.data) setLastReading(Date.now());
  }, [pulse.data]);

  const report = ghost.data;
  // Dégradation propre : tant que /api/thermo n'a JAMAIS répondu et qu'il est
  // en erreur (orchestrateur plus ancien sans la route, ou réseau coupé au
  // premier appel), la carte est simplement masquée — pas d'erreur criarde
  // pour une fonctionnalité absente. Une panne SURVENUE ensuite garde le
  // dernier relevé à l'écran et l'annote « relevé figé ».
  const thermoHidden = thermo.data === null && thermo.error !== null;
  // Même règle pour la Balance : route absente (orchestrateur d'avant le
  // pèse-ruche) ⇒ la carte n'existe pas, la vue Santé reste entière.
  const balanceHidden = balance.data === null && balance.error !== null;

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

      {!thermoHidden && (
        <section className="card">
          <header className="panel-head">
            <h2>{t('Thermorégulation', 'Thermoregulation')}</h2>
            {thermo.data && (
              <span
                className={thermo.data.applique.facteur < 1 ? 'panel-count warn' : 'panel-count'}
                title={t('facteur de ventilation appliqué', 'applied ventilation factor')}
              >
                ×{thermo.data.applique.facteur}
              </span>
            )}
          </header>
          {thermo.data ? (
            <>
              <ThermoGauge thermo={thermo.data} />
              {thermo.error && (
                <p className="panel-error">
                  {t('relevé figé :', 'reading frozen:')} {thermo.error}
                </p>
              )}
            </>
          ) : (
            <p className="empty pad">{t('Prise de température…', 'Taking the temperature…')}</p>
          )}
        </section>
      )}

      {/* La Balance vit ici parce que c'est la vue où l'on juge LA RUCHE dans
          son ensemble — mais elle n'est pas un signe vital et ne rejoint donc
          jamais les tuiles du pouls : carte à part, vocabulaire à part (temps
          prêté, postes, fenêtre). « Combien ça a coûté » se lit à côté de
          « comment ça va », sans se confondre avec. Le détail par projet, lui,
          vit dans la vue Projets : c'est l'échelle à laquelle on juge un
          projet, et celle du futur plafond. */}
      {!balanceHidden && (
        <CarteBalance balance={balance.data} erreur={balance.error} snapshot={snapshot} />
      )}

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

      <Guetteuses refreshTick={refreshTick} />
    </div>
  );
}

/** Ce que chaque niveau veut dire, en une ligne, sans dramatiser ni minimiser. */
const NIVEAU_GUET: Record<NiveauGuet, { fr: string; en: string; ton: string; icone: string }> = {
  calme: { fr: 'Rien à signaler', en: 'Nothing to report', ton: 'calme', icone: '🐝' },
  reniflage: { fr: 'On vous regarde', en: 'Someone is looking', ton: 'chaud', icone: '👀' },
  balayage: {
    fr: 'Un outil déroule sa liste',
    en: 'A tool is running its list',
    ton: 'brulant',
    icone: '🚨',
  },
};

/**
 * Les Guetteuses — ce que la ruche a vu passer sur ses leurres.
 *
 * ─── POURQUOI CE PANNEAU EXISTE ──────────────────────────────────────────────
 *
 * `GET /api/guet` était servi par l'orchestrateur et AUCUN écran ne l'appelait.
 * Un mécanisme de détection sans écran est pire qu'une absence de détection :
 * on croit surveillé ce qui ne l'est pas. Le seul signal qui sortait était une
 * ligne brute au journal — sans niveau, sans conseil, sans la liste de ce qu'on
 * avait cherché chez vous.
 *
 * ─── DEUX RÈGLES D'AFFICHAGE ─────────────────────────────────────────────────
 *
 * 1. LE CALME S'AFFICHE AUSSI. Un panneau qui n'apparaît qu'en cas d'alerte ne
 *    dit jamais « la surveillance fonctionne, et elle ne voit rien » — et on
 *    finit par ne plus savoir si elle marche.
 * 2. LE CONSEIL EST AUSSI GROS QUE L'ALERTE. Dire « on vous sonde » sans dire
 *    quoi faire ne produit que de l'inquiétude, qu'on apprend à ignorer.
 */
function Guetteuses({ refreshTick }: { refreshTick: number }) {
  const t = useT();
  const guet = useApiPoll(fetchGuet, 30_000, refreshTick);
  // Orchestrateur plus ancien, sans la route : le panneau n'existe pas, plutôt
  // qu'une erreur criarde pour une fonctionnalité absente. Même règle que la
  // thermorégulation et la Balance au-dessus.
  if (guet.data === null && guet.error !== null) return null;
  const v = guet.data;
  const n = NIVEAU_GUET[v?.niveau ?? 'calme'];

  return (
    <section className="card">
      <header className="panel-head">
        <h2>{t('Les Guetteuses', 'The Lookouts')}</h2>
        <span className="muted-text">
          {t('sondages sur la dernière heure', 'probes over the last hour')}
        </span>
      </header>
      {!v ? (
        <p className="muted-text">{t('Relevé en cours…', 'Reading…')}</p>
      ) : (
        <>
          <div className={`gu-verdict ton-${n.ton}`}>
            <span className="gu-icone" aria-hidden="true">
              {n.icone}
            </span>
            <div>
              <strong>{t(n.fr, n.en)}</strong>
              <p className="gu-chiffres">
                {v.passages} {t('passage(s)', 'probe(s)')} · {v.sources}{' '}
                {t('adresse(s) distincte(s)', 'distinct address(es)')}
                {v.appats.length > 0 && ` · ${v.appats.join(', ')}`}
              </p>
            </div>
          </div>
          {/* Le conseil compte autant que l'alerte : dire « on vous sonde »
              sans dire quoi faire ne produit que de l'inquiétude. */}
          <p className="gu-conseil">{v.conseil}</p>
          {v.derniers.length > 0 && (
            <ul className="gu-liste">
              {v.derniers.slice(0, 8).map((p, i) => (
                <li key={`${p.quand}-${i}`}>
                  <code>{p.chemin}</code>
                  <span className="muted-text">
                    {p.appat} · {new Date(p.quand).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="gu-note">
            {t(
              'Les Guetteuses ne bloquent personne : derrière un reverse proxy, toutes les requêtes viennent de la même adresse, et un blocage y couperait tout le monde sur la foi d’un seul visiteur curieux.',
              'The Lookouts block nobody: behind a reverse proxy every request comes from the same address, and blocking there would cut everyone off on the strength of a single curious visitor.',
            )}
          </p>
        </>
      )}
    </section>
  );
}
