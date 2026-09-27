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

import type { EntreeWarRoom, IssueConseil } from '../../../src/shared/war-room';
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
 * Pourquoi l'Evaluator n'a pas pu renvoyer en correction. Un code inconnu
 * (une Reine plus récente) est rendu TEL QUEL : mieux vaut un code brut qu'une
 * phrase inventée qui dirait autre chose.
 */
export function direRaisonRefus(raison: string, t: Traduire): string {
  switch (raison) {
    case 'attempts_exhausted':
      return t('essais épuisés', 'attempts exhausted');
    case 'delivery_exists':
      return t('la production est déjà livrée', 'the production is already delivered');
    case 'dependent_progressed':
      return t('des tâches dépendantes ont déjà avancé', 'dependent tasks already moved on');
    case 'stale_result':
      return t('une production plus récente existe', 'a newer production exists');
    case 'task_not_done':
      return t('la tâche n’est plus terminée', 'the task is no longer done');
    default:
      return raison;
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
    case 'contre_verdict':
      return e.conteste
        ? {
            icone: '✘',
            ton: 'objection',
            texte: `${t(`${e.relecteur} conteste`, `${e.relecteur} contests`)}${e.objections.length ? ` : ${e.objections.join(' · ')}` : ''}`,
          }
        : {
            icone: '✔',
            ton: 'accord',
            texte: t(
              `${e.relecteur} valide la production`,
              `${e.relecteur} approves the production`,
            ),
          };
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
    case 'renvoi_evaluator': {
      const essai =
        e.tentative !== null && e.maxTentatives !== null
          ? ` (${t('essai', 'attempt')} ${e.tentative}/${e.maxTentatives})`
          : '';
      return {
        icone: '↩',
        ton: 'info',
        texte:
          e.decision === 'rejected'
            ? `${t('L’Evaluator rejette et relance', 'The Evaluator rejects and reruns')}${essai}`
            : `${t('L’Evaluator renvoie en correction', 'The Evaluator sends back for correction')}${essai}`,
      };
    }
    case 'renvoi_refuse':
      return {
        icone: '⛔',
        ton: 'objection',
        texte: `${t('Renvoi en correction refusé', 'Correction retry refused')} — ${direRaisonRefus(e.raison, t)}`,
      };
    case 'revue_humaine':
      return e.etat === 'approved'
        ? {
            icone: '✔',
            ton: 'decision',
            texte: t('Revue humaine : approuvée', 'Human review: approved'),
          }
        : e.etat === 'rejected'
          ? {
              icone: '✘',
              ton: 'decision',
              texte: t('Revue humaine : rejetée', 'Human review: rejected'),
            }
          : {
              icone: '○',
              ton: 'discret',
              texte: t('Revue humaine effacée', 'Human review cleared'),
            };
  }
}
