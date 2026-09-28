// CE QUE LA WAR ROOM DIT — chaque fait du fil, en une ligne.
//
// Décidé ici, affiché dans `WarRoom.tsx` : comme `projets-rendu.ts`, ces choix
// d'affichage vivent hors du JSX pour qu'un banc les éprouve sans monter la
// vue. Le texte est RECONSTRUIT depuis les champs typés de l'entrée — jamais
// une phrase rangée par la Reine, qui ne parlerait qu'une langue.
//
// Le TON d'une ligne n'est pas décoratif : une objection (`conteste`) ne doit
// pas se lire comme une validation, ni un renvoi refusé comme un simple
// renvoi. C'est précisément ce qui distingue un débat d'un journal.

import type {
  EntreeWarRoom,
  FamilleWarRoom,
  IssueConseil,
  RaisonRefusRenvoi,
  SourceCritique,
} from '../../../src/shared/war-room';
import { direComptesCriteres } from './critique-rendu';
import { auteurDeDecision } from './projets-rendu';
import type { Traduire } from './projets-rendu';

/** Le ton d'une ligne : ce qu'elle demande au regard. */
export type TonEntree = 'info' | 'accord' | 'objection' | 'decision' | 'discret';

export interface LigneFil {
  icone: string;
  ton: TonEntree;
  texte: string;
}

/** L'issue d'un conseil clos, en mots — la même grille que le panneau du Conseil. */
export function direIssue(issue: IssueConseil, t: Traduire): string {
  switch (issue) {
    case 'quorum':
      return t('une piste a convergé', 'one path converged');
    case 'depart':
      return t('égalité au quorum — à vous de trancher', 'tie at quorum — yours to settle');
    case 'sans_quorum':
      return t('du débat, rien de convergé', 'debate, nothing converged');
    case 'epuise':
      return t('arrêté sans converger', 'stopped without converging');
    case 'vide':
      return t('personne n’a rien trouvé', 'nobody found anything');
  }
}

/**
 * Chaque refus de `retryFromEvaluator`, en mots — la SEULE table : la War Room
 * et la Chronique (`Journal.tsx`) la partagent. Deux tables disaient la même
 * raison autrement (« déjà livrée » ici, « une livraison est déjà ouverte »
 * là), et la copie de la War Room avait perdu une correction de la Chronique.
 * EXHAUSTIVE par construction : un refus ajouté au scheduler sans phrase ici ne
 * compile pas — trois d'entre eux (`ancestor_failed`, `invalid_result_id`,
 * `unknown_task`) s'affichaient en code brut faute d'avoir été listés.
 */
const RAISONS_REFUS: Record<RaisonRefusRenvoi, readonly [fr: string, en: string]> = {
  attempts_exhausted: ['essais épuisés', 'attempts exhausted'],
  delivery_exists: ['une livraison est déjà ouverte', 'a delivery is already open'],
  dependent_progressed: [
    'une tâche dépendante a déjà avancé',
    'a dependent task has already moved on',
  ],
  // Même fait que le tiroir d'une tâche annulée avec son sous-arbre : un
  // enfant délégué n'a qu'un destinataire, et une annulation compte comme un
  // échec (`ancetreEchoue`).
  ancestor_failed: [
    'un ancêtre délégué a échoué (ou a été annulé) : plus personne n’attend cette correction',
    'a delegated ancestor failed (or was cancelled): nobody is waiting for this correction any more',
  ],
  stale_result: ['une production plus récente existe', 'a newer production exists'],
  // Une tâche ÉCHOUÉE est terminée, mais pas `done` : c'est le retry ordinaire
  // qui la relance, jamais la correction de l'Evaluator — et un humain peut
  // rejeter une tâche en échec. Dire « pas terminée » d'une tâche en échec
  // contredirait son propre statut.
  task_not_done: [
    'la tâche n’est pas « terminée avec succès » (échouée : relancez-la par le retry ordinaire)',
    'the task is not “completed successfully” (failed: relaunch it with the ordinary retry)',
  ],
  invalid_result_id: [
    'cette production n’appartient pas à la tâche',
    'this production does not belong to the task',
  ],
  unknown_task: ['la tâche n’existe plus', 'the task no longer exists'],
  // Une correction est une dépense neuve : sous une racine dont la dépense
  // déclarée a atteint l'enveloppe, plus rien ne repart (#496).
  root_cost_budget_exhausted: [
    'le budget coût de la racine déléguée est épuisé',
    'the delegated root’s cost budget is exhausted',
  ],
};

/**
 * Pourquoi l'Evaluator n'a pas pu renvoyer en correction. Un code inconnu
 * (une Reine plus récente) est rendu TEL QUEL : mieux vaut un code brut qu'une
 * phrase inventée qui dirait autre chose.
 */
export function direRaisonRefus(raison: string, t: Traduire): string {
  const phrase = Object.hasOwn(RAISONS_REFUS, raison)
    ? RAISONS_REFUS[raison as RaisonRefusRenvoi]
    : null;
  return phrase ? t(...phrase) : raison;
}

/** Qui a demandé une correction — la `source` de la critique qu'elle emporte (#488). */
export function direDemandeur(source: SourceCritique, t: Traduire): string {
  switch (source) {
    case 'contre_revue':
      return t('à la demande de la contre-expertise', 'requested by the counter-review');
    case 'revue_humaine':
      return t('à la demande d’un rejet humain', 'requested by a human rejection');
    case 'evaluator':
      return t('à la demande de l’Evaluator', 'requested by the Evaluator');
  }
}

/** Le nom d'une famille du fil, pour les filtres de la vue. */
export function direFamille(famille: FamilleWarRoom, t: Traduire): string {
  switch (famille) {
    case 'conseil':
      return t('Conseil', 'Council');
    case 'relecture':
      return t('Contre-expertise', 'Counter-review');
    case 'evaluator':
      return t('Evaluator', 'Evaluator');
    case 'humain':
      return t('Décisions humaines', 'Human decisions');
  }
}

/** Le geste qui est passé outre l'Evaluator (`evaluator_overridden.geste`). */
function direGesteForce(geste: string, t: Traduire): string {
  switch (geste) {
    case 'livraison':
      return t('livraison', 'delivery');
    case 'fusion':
      return t('fusion', 'merge');
    case 'livraison_locale':
      return t('livraison locale', 'local delivery');
    default:
      return geste;
  }
}

/** Une entrée du fil, en une ligne. `nomNoeud` nomme les éclaireuses. */
export function direEntree(
  e: EntreeWarRoom,
  t: Traduire,
  nomNoeud: (nodeId: string) => string,
): LigneFil {
  switch (e.genre) {
    case 'conseil_ouvert':
      return { icone: '🔭', ton: 'info', texte: t('Conseil réuni', 'Council convened') };
    case 'conseil_proposition':
      return {
        icone: '✦',
        ton: 'info',
        texte: t(
          `Tour ${e.tour} — une piste rapportée par ${nomNoeud(e.nodeId)}`,
          `Round ${e.tour} — a path brought back by ${nomNoeud(e.nodeId)}`,
        ),
      };
    case 'conseil_avis':
      return e.avis === 'arret'
        ? {
            icone: '✋',
            ton: 'objection',
            texte: t(
              `Tour ${e.tour} — signal d’arrêt de ${nomNoeud(e.nodeId)}`,
              `Round ${e.tour} — stop signal from ${nomNoeud(e.nodeId)}`,
            ),
          }
        : {
            icone: '↑',
            ton: 'accord',
            texte: t(
              `Tour ${e.tour} — soutien de ${nomNoeud(e.nodeId)}`,
              `Round ${e.tour} — support from ${nomNoeud(e.nodeId)}`,
            ),
          };
    case 'conseil_tour':
      return {
        icone: '↻',
        ton: 'discret',
        texte: t(
          `Tour ${e.tour} — ${e.taches} vérification(s) lancée(s)`,
          `Round ${e.tour} — ${e.taches} check(s) launched`,
        ),
      };
    case 'conseil_clos':
      return {
        icone: '■',
        ton: e.issue === 'quorum' ? 'accord' : e.issue === 'vide' ? 'discret' : 'objection',
        texte: `${t('Conseil clos', 'Council closed')} — ${direIssue(e.issue, t)}`,
      };
    case 'conseil_decide': {
      const choix =
        e.propositionId === null
          ? t('aucune piste retenue', 'no path retained')
          : `${t('piste retenue', 'path retained')} : ${e.titre ?? e.propositionId}`;
      const revision =
        e.remplace !== null ? t(' (revient sur une décision)', ' (revises a decision)') : '';
      return {
        icone: '⚖',
        ton: 'decision',
        texte: `${t('Tranché par', 'Settled by')} ${auteurDeDecision(e.par, t)}${revision} — ${choix} — « ${e.justification} »`,
      };
    }
    case 'contre_expertise':
      return e.possible
        ? {
            icone: '⇄',
            ton: 'info',
            texte: t(
              `Contre-expertise lancée — relue par ${e.relecteurs.join(', ') || '?'}`,
              `Counter-review launched — read by ${e.relecteurs.join(', ') || '?'}`,
            ),
          }
        : {
            // « Aucun second modèle » est une information : tue, elle se
            // confondrait avec « on a relu et rien trouvé ».
            icone: '∅',
            ton: 'discret',
            texte: `${t('Contre-expertise impossible', 'Counter-review impossible')}${e.motif ? ` — ${e.motif}` : ''}`,
          };
    case 'contre_verdict': {
      // Les comptes par critère SUIVENT l'avis : sous un « conteste », ils
      // disent sur quoi ; sous un « valide », que des remarques ont été
      // faites sans rien bloquer — tues, le feu vert se lirait « rien à
      // signaler ». Un marqueur illisible se dit : l'avis a été lu en texte
      // libre, et ses constats, s'il en avait, sont perdus.
      const comptes = direComptesCriteres(e.criteres, t);
      const constats = comptes ? ` — ${t('constats', 'findings')} : ${comptes}` : '';
      const illisible = e.marqueurIllisible
        ? t(
            ' (marqueur HIVE_CRITIQUE illisible — lu en texte libre)',
            ' (unreadable HIVE_CRITIQUE marker — read as free text)',
          )
        : '';
      return e.conteste
        ? {
            icone: '✘',
            ton: 'objection',
            texte: `${t(`${e.relecteur} conteste`, `${e.relecteur} contests`)}${e.objections.length ? ` : ${e.objections.join(' · ')}` : ''}${constats}${illisible}`,
          }
        : {
            icone: '✔',
            ton: 'accord',
            texte: `${t(
              `${e.relecteur} valide la production`,
              `${e.relecteur} approves the production`,
            )}${constats}${illisible}`,
          };
    }
    case 'contre_echec':
      return {
        icone: '…',
        ton: 'discret',
        texte: e.terminal
          ? t(
              `La relecture de ${e.relecteur} a échoué — cet avis ne viendra pas`,
              `${e.relecteur}’s review failed — this opinion will not come`,
            )
          : t(
              `La relecture de ${e.relecteur} a échoué — elle repart en file`,
              `${e.relecteur}’s review failed — it goes back to the queue`,
            ),
      };
    case 'contre_impossible':
      // L'arbitre qui manque n'est pas un avis favorable : le ton le dit. La
      // ligne dit le FAIT journalisé, jamais un verdict de l'Evaluator — la
      // War Room ne le lit pas, et une règle antérieure (une CI rouge…) peut
      // répondre autre chose que « revue humaine requise ».
      return {
        icone: '⊘',
        ton: 'objection',
        texte: `${t('Relecture impossible, secours compris — aucun avis indépendant ne viendra', 'Review impossible, fallback included — no independent opinion will come')} : ${e.cause}`,
      };
    case 'renvoi_evaluator': {
      const essai =
        e.tentative !== null && e.maxTentatives !== null
          ? ` (${t('essai', 'attempt')} ${e.tentative}/${e.maxTentatives})`
          : '';
      const demande = e.demandePar ? `, ${direDemandeur(e.demandePar, t)}` : '';
      return {
        icone: '↩',
        ton: 'info',
        texte:
          e.decision === 'rejected'
            ? `${t('L’Evaluator rejette et relance', 'The Evaluator rejects and reruns')}${essai}${demande}`
            : `${t('L’Evaluator renvoie en correction', 'The Evaluator sends back for correction')}${essai}${demande}`,
      };
    }
    case 'renvoi_refuse':
      // Après un rejet HUMAIN, la décision est prise : c'est sa suite qui
      // manque, et l'humain doit le lire — Mission Control ne lit pas la
      // réponse de la route de revue.
      return e.source === 'revue_humaine'
        ? {
            icone: '⛔',
            ton: 'objection',
            texte: `${t('Rejet humain sans correction', 'Human rejection without correction')} — ${direRaisonRefus(e.raison, t)} ${t('(la production reste rejetée)', '(the production stays rejected)')}`,
          }
        : {
            icone: '⛔',
            ton: 'objection',
            texte: `${t('Renvoi en correction refusé', 'Correction retry refused')} — ${direRaisonRefus(e.raison, t)}`,
          };
    case 'evaluator_force': {
      const contre = e.decision
        ? t(`contre « ${e.decision} »`, `against “${e.decision}”`)
        : t('sans verdict de l’Evaluator', 'without an Evaluator verdict');
      return {
        icone: '⚠',
        ton: 'decision',
        texte: `${t('Evaluator forcé par', 'Evaluator overridden by')} ${auteurDeDecision(e.par, t)} — ${direGesteForce(e.geste, t)} ${contre} — « ${e.raison} »`,
      };
    }
    case 'revue_humaine': {
      const raison = e.raison ? ` — « ${e.raison} »` : '';
      return e.etat === 'approved'
        ? {
            icone: '✔',
            ton: 'decision',
            texte: `${t('Revue humaine : approuvée', 'Human review: approved')}${raison}`,
          }
        : e.etat === 'rejected'
          ? {
              icone: '✘',
              ton: 'decision',
              texte: `${t('Revue humaine : rejetée', 'Human review: rejected')}${raison}`,
            }
          : {
              icone: '○',
              ton: 'discret',
              texte: t('Revue humaine effacée', 'Human review cleared'),
            };
    }
  }
}
