// Journal d'événements : flux temps réel, coloré et à icônes.

import type { HiveEvent } from '../../src/shared/types';
import { useT } from './i18n';
import type { Translate } from './i18n';
import { bandeText, formatDuree } from './ui';

interface Meta {
  icon: string;
  cls: string;
  // `t` injecté au rendu : pas de hook au niveau module.
  text: (p: Record<string, unknown>, t: Translate) => string;
}

const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8) : '?');

/**
 * La Balance au journal. PESER et PRÉVOIR n'ont introduit aucun type
 * d'événement : ils ont rendu ÉCONOMIQUEMENT LISIBLES ceux qui existaient déjà,
 * en ajoutant `durationMs` aux payloads de `task_retry` et `task_failed` —
 * jusque-là, un échec ne disait pas ce qu'il avait coûté, et cette histoire
 * était perdue chaque jour un peu plus. Seul BORNER en a trois (`balance_*`,
 * plus bas) : eux ne décrivent pas un coût, ils décrivent une décision.
 *
 * Le champ est donc facultatif à l'affichage : absent des événements
 * journalisés AVANT ce lot (et de `no_working_agent` / `dependency_failed`, qui
 * n'ont aucune durée en main), il rend `null` et la ligne se lit exactement
 * comme avant — jamais un « 0 ms » inventé. Le texte reste reconstruit ici
 * depuis les champs typés du payload, comme tout le reste du journal.
 *
 * ─── LES DEUX MOITIÉS NE PROTÈGENT PAS DU MÊME ACCIDENT ──────────────────────
 *
 * `typeof v === 'number'` écarte ce qui n'est pas un nombre ; `Number.isFinite`
 * écarte `NaN` et l'infini. La seconde est celle qu'on oublie d'éprouver, parce
 * qu'un champ ABSENT est déjà recalé par la première : il faut une charge utile
 * qui porte un `NaN` — une soustraction de dates dont l'une manque en produit
 * un, pas un `undefined` — pour que la moitié droite serve.
 *
 * ─── UN MUTANT ÉQUIVALENT, CONSTATÉ PAR ÉCRIT ────────────────────────────────
 *
 * Retirer `typeof v === 'number'` SURVIT au banc, et ce n'est pas un trou :
 * `Number.isFinite` est la forme STRICTE, sans coercition — elle rend déjà
 * `false` sur `'12'`, `null` ou `undefined`. Les deux versions sont donc
 * indiscernables pour tout appelant.
 *
 * On garde quand même le `typeof`, et pour une raison qui n'est pas la
 * redondance : il dit l'INTENTION, et il protège du jour où quelqu'un
 * remplacerait `Number.isFinite` par le `isFinite` global — celui-là COERCE, et
 * `isFinite('12')` vaut `true`. La ceinture seule suffirait ; les bretelles
 * disent pourquoi elle est là.
 */
const cout = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? formatDuree(v) : null;

/**
 * Pourquoi une correction demandée par l'Evaluator n'est pas repartie.
 *
 * Les codes sont ceux du planificateur (`retryFromEvaluator`). Sans cette
 * ligne, le journal affichait le type brut — ou rien du tout quand un rejet
 * humain restait sans suite : l'opérateur croyait une correction en route. Un
 * code inconnu reste affiché tel quel plutôt que traduit de travers.
 */
function raisonRetrySaute(code: unknown, t: Translate): string {
  switch (code) {
    case 'attempts_exhausted':
      return t('essais épuisés', 'attempts exhausted');
    case 'delivery_exists':
      return t('une livraison est déjà ouverte', 'a delivery is already open');
    case 'dependent_progressed':
      return t('une tâche dépendante a déjà avancé', 'a dependent task has already moved on');
    // Même fait que le tiroir d'une tâche annulée avec son sous-arbre : un
    // enfant délégué n'a qu'un destinataire, et une annulation compte comme
    // un échec (`ancetreEchoue`).
    case 'ancestor_failed':
      return t(
        'un ancêtre délégué a échoué (ou a été annulé) : plus personne n’attend cette correction',
        'a delegated ancestor failed (or was cancelled): nobody is waiting for this correction any more',
      );
    case 'stale_result':
      return t('une production plus récente existe', 'a newer production exists');
    // Une tâche ÉCHOUÉE est terminée, mais pas `done` : c'est le retry
    // ordinaire qui la relance, jamais la correction de l'Evaluator. Dire
    // « pas terminée » d'une tâche en échec contredirait son propre statut.
    case 'task_not_done':
      return t(
        'la tâche n’est pas « terminée avec succès » (échouée : relancez-la par le retry ordinaire)',
        'the task is not “completed successfully” (failed: relaunch it with the ordinary retry)',
      );
    case 'unknown_task':
      return t('tâche inconnue', 'unknown task');
    case 'invalid_result_id':
      return t('résultat invalide', 'invalid result');
    default:
      return typeof code === 'string' && code.length > 0 ? code : '?';
  }
}

const EVENTS: Record<string, Meta> = {
  project_created: {
    icon: '▦',
    cls: 'info',
    text: (p, t) => t(`projet « ${String(p.name ?? '')} »`, `project “${String(p.name ?? '')}”`),
  },
  task_created: {
    icon: '+',
    cls: 'muted',
    text: (p, t) =>
      t(
        `tâche : ${String(p.title ?? short(p.taskId))}`,
        `task: ${String(p.title ?? short(p.taskId))}`,
      ),
  },
  task_ready: {
    icon: '◇',
    cls: 'muted',
    text: (p, t) => t(`tâche prête (${short(p.taskId)})`, `task ready (${short(p.taskId)})`),
  },
  task_assigned: {
    icon: '◈',
    cls: 'info',
    text: (p, t) =>
      t(
        `${short(p.taskId)} → nœud ${short(p.nodeId)}`,
        `${short(p.taskId)} → node ${short(p.nodeId)}`,
      ),
  },
  task_started: {
    icon: '▶',
    cls: 'run',
    text: (p, t) =>
      t(`butinage démarré (${short(p.taskId)})`, `foraging started (${short(p.taskId)})`),
  },
  task_progress: {
    icon: '⋯',
    cls: 'run',
    text: (p, t) => t(`progrès (${short(p.taskId)})`, `progress (${short(p.taskId)})`),
  },
  task_readopted: {
    icon: '↺',
    cls: 'info',
    text: (p, t) => t(`ré-adoptée (${short(p.taskId)})`, `re-adopted (${short(p.taskId)})`),
  },
  task_done: {
    icon: '●',
    cls: 'done',
    text: (p, t) => {
      const ms = cout(p.durationMs);
      return ms === null
        ? t(`terminée (${short(p.taskId)})`, `done (${short(p.taskId)})`)
        : t(`terminée (${short(p.taskId)}) en ${ms}`, `done (${short(p.taskId)}) in ${ms}`);
    },
  },
  task_retry: {
    icon: '↻',
    cls: 'warn',
    text: (p, t) => {
      const essai = `${String(p.attempt)}/${String(p.maxAttempts)}`;
      // Le même type porte deux histoires opposées. Sans `source`, c'est le
      // Worker qui a échoué ; avec `source: 'evaluator'`, sa production a
      // RÉUSSI et l'Evaluator en demande une meilleure (contre-revue, revue
      // humaine). L'écrire « échec » accusait un travail qui n'avait pas raté.
      if (p.source === 'evaluator') {
        return p.decision === 'rejected'
          ? t(
              `production rejetée par l’Evaluator, nouvel essai ${essai} (${short(p.taskId)})`,
              `production rejected by the Evaluator, new attempt ${essai} (${short(p.taskId)})`,
            )
          : t(
              `correction demandée par l’Evaluator, essai ${essai} (${short(p.taskId)})`,
              `correction requested by the Evaluator, attempt ${essai} (${short(p.taskId)})`,
            );
      }
      const ms = cout(p.durationMs);
      const base = t(
        `échec, essai ${essai} (${short(p.taskId)})`,
        `failed, attempt ${essai} (${short(p.taskId)})`,
      );
      // Le temps que cette tentative a coûté : imputé en « reprise » par la
      // Balance dès que la tâche aboutit.
      return ms === null ? base : `${base} — ${t(`${ms} en reprise`, `${ms} of rework`)}`;
    },
  },
  evaluator_retry_skipped: {
    icon: '⊘',
    cls: 'warn',
    text: (p, t) => {
      const raison = raisonRetrySaute(p.reason, t);
      return t(
        `correction Evaluator non relancée (${short(p.taskId)}) : ${raison}`,
        `Evaluator correction not retried (${short(p.taskId)}): ${raison}`,
      );
    },
  },
  task_failed: {
    icon: '✘',
    cls: 'fail',
    text: (p, t) => {
      const ms = cout(p.durationMs);
      const base = t(`échouée (${short(p.taskId)})`, `failed (${short(p.taskId)})`);
      // « coût : X » plutôt qu'un participe accordé : la durée est formatée
      // (« 1 h », « 4 h 12 min », « 340 ms ») et aucun accord français ne tient
      // sur toutes ces formes.
      return ms === null ? base : `${base} — ${t(`coût : ${ms}`, `cost: ${ms}`)}`;
    },
  },
  task_cancelled: {
    icon: '⊘',
    cls: 'warn',
    text: (p, t) => t(`annulée (${short(p.taskId)})`, `cancelled (${short(p.taskId)})`),
  },
  task_requeued: {
    icon: '↩',
    cls: 'warn',
    text: (p, t) => t(`réaffectée (${short(p.taskId)})`, `requeued (${short(p.taskId)})`),
  },
  task_rejected: {
    icon: '⇄',
    cls: 'muted',
    text: (p, t) => t(`refusée (${short(p.taskId)})`, `declined (${short(p.taskId)})`),
  },
  node_registered: {
    icon: '⬡',
    cls: 'info',
    text: (p, t) =>
      t(`nouveau nœud : ${String(p.name ?? '')}`, `new node: ${String(p.name ?? '')}`),
  },
  node_online: {
    icon: '●',
    cls: 'done',
    text: (p, t) =>
      t(`nœud en ligne : ${String(p.name ?? '')}`, `node online: ${String(p.name ?? '')}`),
  },
  node_offline: {
    icon: '○',
    cls: 'fail',
    text: (p, t) =>
      t(`nœud hors ligne : ${String(p.name ?? '')}`, `node offline: ${String(p.name ?? '')}`),
  },
  node_reconciled: {
    icon: '↺',
    cls: 'muted',
    text: (_p, t) => t('réconciliation', 'reconciliation'),
  },
  memory_recorded: {
    icon: '※',
    cls: 'muted',
    text: (p, t) =>
      t(`souvenir consigné (${short(p.taskId)})`, `memory recorded (${short(p.taskId)})`),
  },
  conflict_detected: {
    icon: '△',
    cls: 'warn',
    text: (p, t) =>
      t(
        `conflit ${String(p.severity ?? '')} : ${short(p.a)} ↔ ${short(p.b)}`,
        `conflict ${String(p.severity ?? '')}: ${short(p.a)} ↔ ${short(p.b)}`,
      ),
  },
  task_conflict_deferred: {
    icon: '⏸',
    cls: 'warn',
    text: (p, t) =>
      t(
        `différée (conflit avec ${short(p.conflictsWith)})`,
        `deferred (conflicts with ${short(p.conflictsWith)})`,
      ),
  },
  result_ignored: {
    icon: '⊘',
    cls: 'muted',
    text: (p, t) => t(`résultat périmé (${short(p.taskId)})`, `stale result (${short(p.taskId)})`),
  },
  drone_race_started: {
    icon: '◇',
    cls: 'info',
    text: (p, t) =>
      t(
        `course lancée : ${String(Array.isArray(p.drones) ? p.drones.length : p.factor)} drone(s) sur ${short(p.taskId)}`,
        `race started: ${String(Array.isArray(p.drones) ? p.drones.length : p.factor)} drone(s) on ${short(p.taskId)}`,
      ),
  },
  drone_won: {
    icon: '◆',
    cls: 'done',
    text: (p, t) =>
      t(
        `course gagnée par ${short(p.nodeId)} (${short(p.taskId)})`,
        `race won by ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_cancelled: {
    icon: '⊘',
    cls: 'muted',
    text: (p, t) =>
      t(
        `drone annulé : ${short(p.nodeId)} (course tranchée)`,
        `drone cancelled: ${short(p.nodeId)} (race decided)`,
      ),
  },
  drone_failed: {
    icon: '▽',
    cls: 'warn',
    text: (p, t) =>
      t(
        `drone tombé : ${short(p.nodeId)}, la course continue`,
        `drone down: ${short(p.nodeId)}, race goes on`,
      ),
  },
  drone_promoted: {
    icon: '↑',
    cls: 'info',
    text: (p, t) =>
      t(
        `drone promu primaire : ${short(p.nodeId)} (${short(p.taskId)})`,
        `drone promoted to primary: ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_rejected: {
    icon: '⇄',
    cls: 'muted',
    text: (p, t) =>
      t(
        `drone a décliné : ${short(p.nodeId)} (${short(p.taskId)})`,
        `drone declined: ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_all_failed: {
    icon: '✘',
    cls: 'fail',
    text: (p, t) =>
      t(
        `course perdue : tous les drones ont échoué (${short(p.taskId)})`,
        `race lost: every drone failed (${short(p.taskId)})`,
      ),
  },
  // Instinct de ruche : phéromones, thermorégulation, couveuse. Leur payload ne
  // porte QUE des faits typés — le texte bilingue est reconstruit ici, comme
  // pour tout le reste du journal (aucune phrase figée en base).
  pheromone_route: {
    icon: '·',
    cls: 'info',
    text: (p, t) => {
      // Le nom du nœud est joint au payload ; repli sur l'id abrégé pour les
      // événements journalisés avant son ajout.
      const noeud = typeof p.nodeName === 'string' ? p.nodeName : short(p.nodeId);
      return t(
        `phéromones : ${short(p.taskId)} → nœud ${noeud} (domaine ${String(p.domaine ?? '')})`,
        `pheromones: ${short(p.taskId)} → node ${noeud} (domain ${String(p.domaine ?? '')})`,
      );
    },
  },
  thermo_shift: {
    icon: '~',
    cls: 'warn',
    text: (p, t) =>
      t(
        `thermorégulation : la ruche passe en ${bandeText(p.bande, t)} (${String(p.temperature ?? '?')}°) — concurrence ×${String(p.facteur ?? '?')}`,
        `thermoregulation: the hive shifts to ${bandeText(p.bande, t)} (${String(p.temperature ?? '?')}°) — concurrency ×${String(p.facteur ?? '?')}`,
      ),
  },
  brood_context: {
    icon: '◦',
    cls: 'info',
    text: (p, t) =>
      t(
        `couveuse : ${short(p.taskId)} repart avec les leçons de ${String(p.echecs ?? '?')} échec(s)`,
        `brood chamber: ${short(p.taskId)} restarts with the lessons of ${String(p.echecs ?? '?')} failure(s)`,
      ),
  },
  // Les leçons que le budget a évincées (cadre, Cerveau et critique ont tout
  // pris) : la tentative repart sans savoir comment les précédentes ont
  // échoué. Un avertissement, comme `critique_refus`.
  brood_refus: {
    icon: '⚠',
    cls: 'warn',
    text: (p, t) =>
      t(
        `couveuse muette : ${short(p.taskId)} repart (essai ${String(p.attempt ?? '?')}) sans les leçons de ${String(p.echecs ?? '?')} échec(s) — budget de contexte épuisé`,
        `brood chamber silenced: ${short(p.taskId)} restarts (attempt ${String(p.attempt ?? '?')}) without the lessons of ${String(p.echecs ?? '?')} failure(s) — context budget exhausted`,
      ),
  },
  // La critique jointe à une correction. Le payload ne porte que des faits
  // comptés : le TEXTE des objections vit dans `task_retry`, et la Miellerie
  // le montre sous la tâche (`/api/tasks/:taskId/critique`).
  critique_context: {
    icon: '◦',
    cls: 'info',
    text: (p, t) => {
      const qui =
        p.source === 'revue_humaine'
          ? t('le rejet humain', 'the human rejection')
          : p.source === 'contre_revue'
            ? t('la contre-revue', 'the counter-review')
            : t('l’Evaluator', 'the Evaluator');
      const note =
        p.noteHumaine === true
          ? t(', avec la raison de l’humain', ', with the human’s reason')
          : '';
      // `objections` = ce que l'ouvrière a LU ; `objectionsFigees` = ce que
      // la correction avait relevé. L'écart, c'est la queue tombée au budget.
      const figees = typeof p.objectionsFigees === 'number' ? p.objectionsFigees : null;
      const tronquee = figees !== null && figees > Number(p.objections ?? 0);
      const sur = tronquee
        ? { fr: ` (sur ${String(figees)} relevées)`, en: ` (of ${String(figees)} raised)` }
        : { fr: '', en: '' };
      return t(
        `critique : ${short(p.taskId)} repart (essai ${String(p.attempt ?? '?')}) avec ${qui} — ${String(p.objections ?? 0)} objection(s)${sur.fr}${note}`,
        `critique: ${short(p.taskId)} restarts (attempt ${String(p.attempt ?? '?')}) with ${qui} — ${String(p.objections ?? 0)} objection(s)${sur.en}${note}`,
      );
    },
  },
  // La critique que le budget a évincée : la tentative repart SANS savoir ce
  // qu'on reprochait à la précédente. Un avertissement, comme un refus du
  // Cerveau — c'est précisément la reprise aveugle que la critique existe à
  // empêcher.
  critique_refus: {
    icon: '⚠',
    cls: 'warn',
    text: (p, t) =>
      t(
        `critique perdue : ${short(p.taskId)} repart (essai ${String(p.attempt ?? '?')}) sans les ${String(p.objectionsFigees ?? '?')} objection(s) de la correction — budget de contexte épuisé`,
        `critique dropped: ${short(p.taskId)} restarts (attempt ${String(p.attempt ?? '?')}) without the correction’s ${String(p.objectionsFigees ?? '?')} objection(s) — context budget exhausted`,
      ),
  },
  // La Balance, geste « borner ». Trois faits typés — `projectId`, des entiers,
  // un booléen — et AUCUNE phrase persistée : le bilingue est reconstruit ici
  // depuis les champs, exactement comme `thermo_shift`. `formatDuree` est
  // réutilisé via `cout` : les durées du journal se lisent partout pareil.
  balance_alert: {
    icon: '⚖',
    cls: 'warn',
    text: (p, t) =>
      t(
        `Balance : le projet ${short(p.projectId)} a consommé ${String(p.part ?? '?')} % de son plafond (${cout(p.depenseMs) ?? '?'} sur ${cout(p.plafondMs) ?? '?'}) — la ruche prévient, elle ne bloque pas`,
        `Balance: project ${short(p.projectId)} has spent ${String(p.part ?? '?')}% of its cap (${cout(p.depenseMs) ?? '?'} of ${cout(p.plafondMs) ?? '?'}) — the hive warns, it does not block`,
      ),
  },
  balance_cap_reached: {
    icon: '■',
    cls: 'fail',
    text: (p, t) => {
      const chiffres = `${cout(p.depenseMs) ?? '?'} / ${cout(p.plafondMs) ?? '?'}`;
      // `applique` distingue les deux modes, et c'est TOUTE la ligne : en
      // `strict` la porte s'est fermée, en `observation` le fait est constaté
      // et la ruche butine toujours. Les confondre inventerait un blocage.
      return p.applique === true
        ? t(
            `Balance : plafond atteint sur ${short(p.projectId)} (${chiffres}) — assignation arrêtée`,
            `Balance: cap reached on ${short(p.projectId)} (${chiffres}) — assignment stopped`,
          )
        : t(
            `Balance : plafond atteint sur ${short(p.projectId)} (${chiffres}) — observation, rien n’est arrêté`,
            `Balance: cap reached on ${short(p.projectId)} (${chiffres}) — observation, nothing is stopped`,
          );
    },
  },
  balance_cap_set: {
    icon: '⚖',
    cls: 'info',
    text: (p, t) => {
      // `definiPar` est une TRACE (qui a serré la vis), jamais une
      // autorisation : absente quand le geste est venu du seul jeton de ruche.
      const par = typeof p.definiPar === 'string' ? ` ${t('par', 'by')} ${short(p.definiPar)}` : '';
      const ms = cout(p.plafondMs);
      // `plafondMs: null` = plafond RETIRÉ : le projet redevient indiscernable
      // d'un projet d'avant la Balance. Un « 0 ms » se lirait comme l'inverse.
      return ms === null
        ? t(
            `Balance : plafond retiré sur ${short(p.projectId)}${par}`,
            `Balance: cap removed on ${short(p.projectId)}${par}`,
          )
        : t(
            `Balance : plafond posé à ${ms} sur ${short(p.projectId)}${par}`,
            `Balance: cap set to ${ms} on ${short(p.projectId)}${par}`,
          );
    },
  },
  boot_recovery: {
    icon: '⟲',
    cls: 'info',
    text: (p, t) =>
      t(
        `reprise : ${String(p.requeued)} tâche(s) requalifiée(s)`,
        `recovery: ${String(p.requeued)} task(s) requeued`,
      ),
  },
};

export function Journal({ events }: { events: HiveEvent[] }) {
  const t = useT();
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" /> {t('Journal', 'Journal')}
        </h2>
        <span className="panel-count">{events.length}</span>
      </header>
      <ul className="journal">
        {[...events]
          .slice(-40)
          .reverse()
          .map((ev) => {
            const meta = EVENTS[ev.type] ?? {
              icon: '•',
              cls: 'muted',
              text: () => ev.type,
            };
            return (
              <li key={ev.id} className={`jrow ${meta.cls}`}>
                <span className="jicon" aria-hidden="true">
                  {meta.icon}
                </span>
                <span className="jtext">{meta.text(ev.payload, t)}</span>
                <time className="jtime">{new Date(ev.ts).toLocaleTimeString()}</time>
              </li>
            );
          })}
        {events.length === 0 && (
          <li className="empty">{t('Rien pour l’instant.', 'Nothing yet.')}</li>
        )}
      </ul>
    </section>
  );
}
