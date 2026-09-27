// Journal d'événements : flux temps réel, coloré et à icônes.

import type { HiveEvent } from '../../src/shared/types';
import { VALIDATION_KEYS } from '../../src/shared/validations-bac';
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

/** `—` : non applicable (le projet ne le déclare pas) — surtout pas un vert. */
const SYMBOLE_VALIDATION: Record<string, string> = {
  passed: '✔',
  failed: '✘',
  missing: '?',
  not_applicable: '—',
};

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

/**
 * Ce qu'un `task_progress` APPORTE, et non le mot « progrès ».
 *
 * La ligne affichait « progrès (id) » quel que soit le payload : le jalon que
 * le nœud avait écrit (« ⏸ Réquisition ouverte — en attente de décision
 * humaine ») était reçu, puis jeté à l'affichage. Le journal dit maintenant le
 * jalon, sinon les sous-agents, sinon les fichiers ouverts. La sortie brute de
 * l'agent, elle, n'est pas un événement : elle vit dans la console du tiroir.
 */
function progres(p: Record<string, unknown>, t: Translate): string {
  const id = short(p.taskId);
  if (typeof p.log === 'string' && p.log.trim() !== '') {
    const ligne = p.log.replace(/\s+/g, ' ').trim();
    return `${id} · ${ligne.length > 120 ? `${ligne.slice(0, 119)}…` : ligne}`;
  }
  if (Array.isArray(p.subAgents) && p.subAgents.length > 0) {
    const n = p.subAgents.length;
    return t(`${id} · ${n} sous-agent(s)`, `${id} · ${n} sub-agent(s)`);
  }
  if (Array.isArray(p.presences) && p.presences.length > 0) {
    const n = p.presences.length;
    return t(`${id} · ${n} fichier(s) ouvert(s)`, `${id} · ${n} open file(s)`);
  }
  return t(`progrès (${id})`, `progress (${id})`);
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
    // Le modèle COMMANDÉ, quand l'Aiguillage en a choisi un : c'est la
    // décision que la ligne rapporte. Sa raison complète (le classement figé)
    // se lit dans le tiroir de la tâche — trop longue pour une ligne.
    text: (p, t) => {
      const base = t(
        `${short(p.taskId)} → nœud ${short(p.nodeId)}`,
        `${short(p.taskId)} → node ${short(p.nodeId)}`,
      );
      if (typeof p.modele !== 'string' || p.modele === '') return base;
      const categorie = typeof p.categorie === 'string' ? ` (${p.categorie})` : '';
      return `${base} · ${t('modèle', 'model')} ${p.modele}${categorie}`;
    },
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
    text: (p, t) => progres(p, t),
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
  // Le verdict HUMAIN de la Miellerie. `state: null` efface une revue : un
  // geste aussi, dit comme tel plutôt que par le type brut.
  task_reviewed: {
    icon: '✍',
    cls: 'info',
    text: (p, t) =>
      p.state === 'approved'
        ? t(
            `revue humaine : approuvée (${short(p.taskId)})`,
            `human review: approved (${short(p.taskId)})`,
          )
        : p.state === 'rejected'
          ? t(
              `revue humaine : rejetée (${short(p.taskId)})`,
              `human review: rejected (${short(p.taskId)})`,
            )
          : t(
              `revue humaine effacée (${short(p.taskId)})`,
              `human review cleared (${short(p.taskId)})`,
            ),
  },
  // Un humain passe outre l'Evaluator pour livrer ou fusionner. La raison vit
  // dans le payload ; la ligne dit le geste et le verdict contourné.
  evaluator_overridden: {
    icon: '⚑',
    cls: 'warn',
    text: (p, t) =>
      t(
        `verdict de l’Evaluator (${String(p.decision ?? '?')}) passé outre pour ${String(p.geste ?? '?')} (${short(p.taskId)})`,
        `Evaluator verdict (${String(p.decision ?? '?')}) overridden to ${String(p.geste ?? '?')} (${short(p.taskId)})`,
      ),
  },
  council_decided: {
    icon: '⚔',
    cls: 'info',
    text: (p, t) =>
      typeof p.titre === 'string' && p.titre !== ''
        ? t(`Conseil tranché : « ${p.titre} »`, `Council settled: “${p.titre}”`)
        : t('Conseil tranché : aucune piste retenue', 'Council settled: no path kept'),
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
    // Un refus d'INFRASTRUCTURE dit sa cause (agent en panne, clone
    // impossible) : c'est la seule trace d'une tâche qui finit sans qu'aucun
    // agent n'ait tourné — ni production, ni logs à relire.
    text: (p, t) => {
      const base = t(`refusée (${short(p.taskId)})`, `declined (${short(p.taskId)})`);
      return p.infra === true && typeof p.reason === 'string' ? `${base} — ${p.reason}` : base;
    },
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
  // Les validations d'une production, avec LEUR source : un vert du bac Hive
  // n'est pas un vert de la CI GitHub, et la ligne le dit avant les états.
  validation_recorded: {
    icon: '✓',
    cls: 'info',
    text: (p, t) => {
      const source =
        p.source === 'hive_sandbox'
          ? t('bac Hive', 'Hive sandbox')
          : p.source === 'github_pull_request'
            ? t('CI GitHub', 'GitHub CI')
            : '?';
      const etats =
        typeof p.validation === 'object' && p.validation !== null
          ? (p.validation as Record<string, unknown>)
          : {};
      const ligne = VALIDATION_KEYS.map(
        (cle) => `${cle} ${SYMBOLE_VALIDATION[String(etats[cle])] ?? '?'}`,
      ).join(' · ');
      return t(
        `validations ${short(p.taskId)} (${source}) : ${ligne}`,
        `validations ${short(p.taskId)} (${source}): ${ligne}`,
      );
    },
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
  // ─── La contre-expertise ─────────────────────────────────────────────────
  // Une relecture qui tombe ne doit pas se lire comme un silence : la ligne
  // dit qui relit, qui a échoué, qui relaie, et quand plus personne ne le
  // peut. La cause d'une relecture impossible est rangée en français (c'est
  // aussi le motif de l'Evaluator) : la ligne anglaise nomme le dernier
  // relecteur plutôt que de mêler les deux langues.
  contre_expertise: {
    icon: '⚖',
    cls: 'info',
    text: (p, t) => {
      const modeles = Array.isArray(p.modeles) ? p.modeles.map(String).join(', ') : '?';
      if (p.possible === false) {
        return t(
          `aucun second modèle en ligne pour relire ${short(p.taskId)}`,
          `no second model online to review ${short(p.taskId)}`,
        );
      }
      return p.secours === true
        ? t(
            `relecture de secours de ${short(p.taskId)} confiée à ${modeles}`,
            `fallback review of ${short(p.taskId)} handed to ${modeles}`,
          )
        : t(
            `contre-expertise de ${short(p.taskId)} par ${modeles}`,
            `cross-review of ${short(p.taskId)} by ${modeles}`,
          );
    },
  },
  contre_expertise_review_waiting: {
    icon: '⏸',
    cls: 'warn',
    text: (p, t) =>
      t(
        `relecture de ${short(p.taskId)} en attente : aucun nœud ${String(p.relecteur ?? '?')} en ligne`,
        `review of ${short(p.taskId)} waiting: no ${String(p.relecteur ?? '?')} node online`,
      ),
  },
  contre_expertise_review_failed: {
    icon: '▽',
    cls: 'warn',
    text: (p, t) =>
      p.terminal === true
        ? t(
            `relecture de ${short(p.taskId)} par ${String(p.relecteur ?? '?')} close sans avis`,
            `review of ${short(p.taskId)} by ${String(p.relecteur ?? '?')} closed without a verdict`,
          )
        : t(
            `relecture de ${short(p.taskId)} par ${String(p.relecteur ?? '?')} : échec, nouvel essai`,
            `review of ${short(p.taskId)} by ${String(p.relecteur ?? '?')}: failed, retrying`,
          ),
  },
  contre_expertise_impossible: {
    icon: '✋',
    cls: 'fail',
    text: (p, t) =>
      t(
        `relecture impossible (${short(p.taskId)}) : ${String(p.cause ?? '?')} — revue humaine requise`,
        `review impossible (${short(p.taskId)}), last reviewer ${String(p.relecteur ?? '?')} — human review required`,
      ),
  },
  contre_expertise_verdict: {
    icon: '⚖',
    cls: 'info',
    text: (p, t) =>
      p.conteste === true
        ? t(
            `${String(p.relecteur ?? '?')} conteste ${short(p.taskId)}`,
            `${String(p.relecteur ?? '?')} contests ${short(p.taskId)}`,
          )
        : t(
            `${String(p.relecteur ?? '?')} valide ${short(p.taskId)}`,
            `${String(p.relecteur ?? '?')} approves ${short(p.taskId)}`,
          ),
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
  // ─── Chantiers et poses : le journal EST leur réponse ─────────────────────
  //
  // L'écran d'une pose promet « la machine répondra dans le journal », et
  // celui des chantiers relit son verdict quand le journal annonce une issue.
  // Affichées en type brut, ces issues étaient là sans se lire — la perte de
  // contact comprise, qui n'est PAS un échec constaté : sa cause le dit.
  chantier_started: {
    icon: '▶',
    cls: 'run',
    text: (p, t) =>
      t(
        `chantier « ${String(p.nom)} » lancé → nœud ${short(p.nodeId)}`,
        `chantier “${String(p.nom)}” started → node ${short(p.nodeId)}`,
      ),
  },
  chantier_completed: {
    icon: '●',
    cls: 'done',
    text: (p, t) => t(`chantier « ${String(p.nom)} » réussi`, `chantier “${String(p.nom)}” passed`),
  },
  chantier_failed: {
    icon: '✘',
    cls: 'fail',
    text: (p, t) => {
      const nom = String(p.nom);
      if (typeof p.reason === 'string') {
        return t(
          `chantier « ${nom} » sans résultat : ${p.reason}`,
          `chantier “${nom}” without result: ${p.reason}`,
        );
      }
      if (typeof p.refused === 'string') {
        return t(
          `chantier « ${nom} » refusé : ${p.refused}`,
          `chantier “${nom}” refused: ${p.refused}`,
        );
      }
      return t(
        `chantier « ${nom} » en échec (code ${String(p.code)})`,
        `chantier “${nom}” failed (code ${String(p.code)})`,
      );
    },
  },
  outil_pose_demandee: {
    icon: '⇣',
    cls: 'info',
    text: (p, t) =>
      t(
        `pose de ${String(p.outilId)} demandée → nœud ${short(p.nodeId)}`,
        `install of ${String(p.outilId)} requested → node ${short(p.nodeId)}`,
      ),
  },
  outil_pose_rendue: {
    icon: '⇣',
    cls: 'info',
    text: (p, t) => {
      const outil = String(p.outilId);
      if (p.ok === true) {
        return t(
          `${outil} posé sur le nœud ${short(p.nodeId)}`,
          `${outil} installed on node ${short(p.nodeId)}`,
        );
      }
      const pourquoi = typeof p.refuse === 'string' ? p.refuse : `code ${String(p.code)}`;
      return t(
        `pose de ${outil} en échec : ${pourquoi}`,
        `install of ${outil} failed: ${pourquoi}`,
      );
    },
  },
  outil_pose_sans_reponse: {
    icon: '⊘',
    cls: 'warn',
    text: (p, t) =>
      t(
        `pose de ${String(p.outilId)} sans réponse du nœud ${short(p.nodeId)} : ${String(p.reason)}`,
        `install of ${String(p.outilId)}: no answer from node ${short(p.nodeId)}: ${String(p.reason)}`,
      ),
  },
};

/**
 * La ligne d'un événement, telle que le Journal la dit — icône, classe et
 * texte bilingue reconstruit depuis les champs typés du payload. Exportée
 * pour que le fil des décisions de l'accueil parle EXACTEMENT comme le
 * Journal : deux traductions d'un même fait finiraient par se contredire.
 */
export function ligneDuJournal(
  ev: HiveEvent,
  t: Translate,
): { icon: string; cls: string; text: string } {
  const meta = EVENTS[ev.type];
  if (!meta) return { icon: '•', cls: 'muted', text: ev.type };
  return { icon: meta.icon, cls: meta.cls, text: meta.text(ev.payload, t) };
}

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
            const ligne = ligneDuJournal(ev, t);
            return (
              <li key={ev.id} className={`jrow ${ligne.cls}`}>
                <span className="jicon" aria-hidden="true">
                  {ligne.icon}
                </span>
                <span className="jtext">{ligne.text}</span>
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
