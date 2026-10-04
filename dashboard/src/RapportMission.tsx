// Le rapport de MISSION d'un projet, dans sa carte : ce que chaque tâche a
// donné, et ce que la mission a coûté.
//
// L'avancement dit « 5/5 terminées ». Il ne disait pas ce que la ruche avait
// DÉCIDÉ de chacune — acceptée, renvoyée, en attente d'un humain —, ni ce que
// la contre-revue en pensait, ni combien de fois il avait fallu recommencer et
// pourquoi, ni ce que ça avait coûté. Tout existait, dispersé entre le tiroir
// de chaque tâche, la War Room et le Genome : lire une mission terminée
// demandait d'ouvrir chaque tâche.
//
// Tout vient de `GET /api/projects/:id/report?detail=mission`
// (`rapportDeMission`, project-report.ts) ; l'écran ne juge rien :
//
//   · la décision de l'Evaluator est celle de son tiroir ;
//   · la dépense est DÉCLARÉE par les CLI des agents, et ne se montre qu'avec
//     sa couverture (« 3/5 tentatives déclarées ») — jamais un total nu qu'on
//     lirait comme une facture, jamais extrapolée à la tentative muette ;
//   · les reprises sont dites par SOURCE : un Worker qui tombe et une
//     correction demandée par la contre-revue ne racontent pas la même chose.
//
// Sondé seulement tant que le panneau est ouvert : il relit le journal et
// juge chaque production — la carte n'a pas à payer ce prix toutes les
// trente secondes.

import { fetchRapportMission } from './api';
import type { IssueRelecture, LigneMission, RapportMission as Rapport, SourceReprise } from './api';
import type { EvaluationDecision } from '../../src/orchestrator/evaluator';
import { useLang, useT } from './i18n';
import type { Translate } from './i18n';
import { direDuree } from '../../src/shared/horloge-chantier';
import { RegistreGenome } from './RegistreGenome';
import { direSommeDeclaree, direUsd, NOTE_COUT_DECLARE, statusLabel } from './ui';
import { EchecSondage, useApiPoll } from './views/shared';

const libelleDecision = (d: EvaluationDecision, t: Translate): string => {
  switch (d) {
    case 'accepted':
      return t('acceptée', 'accepted');
    case 'correction_required':
      return t('à corriger', 'correction required');
    case 'rejected':
      return t('rejetée', 'rejected');
    case 'additional_test_required':
      return t('preuves manquantes', 'evidence missing');
    case 'human_review_required':
      return t('revue humaine requise', 'human review required');
  }
};

const libelleRelecture = (issue: IssueRelecture, t: Translate): string => {
  switch (issue) {
    case 'contestee':
      return t('contestée', 'contested');
    case 'en_cours':
      return t('en cours', 'in progress');
    case 'favorable':
      return t('favorable', 'approved');
    case 'impossible':
      return t('impossible', 'impossible');
    case 'absente':
      return t('aucune', 'none');
  }
};

const libelleSource = (s: SourceReprise, t: Translate): string => {
  switch (s) {
    case 'worker':
      return t('échec du Worker', 'Worker failure');
    case 'remise_en_file':
      return t('remise en file', 'requeued');
    case 'contre_revue':
      return t('contre-revue', 'cross-review');
    case 'revue_humaine':
      return t('revue humaine', 'human review');
    case 'evaluator':
      return t('Evaluator', 'Evaluator');
    case 'inconnue':
      return t('correction, source inconnue', 'correction, unknown source');
  }
};

/** Les sources non nulles, dans l'ordre fixe du serveur. */
function direReprises(r: Record<SourceReprise, number>, t: Translate): string | null {
  const parties = (Object.entries(r) as [SourceReprise, number][])
    .filter(([, n]) => n > 0)
    .map(([source, n]) => `${libelleSource(source, t)} ${n}`);
  return parties.length > 0 ? parties.join(' · ') : null;
}

const DECISIONS_ORDRE: readonly EvaluationDecision[] = [
  'accepted',
  'correction_required',
  'rejected',
  'additional_test_required',
  'human_review_required',
];

function EnTete({ mission }: { mission: Rapport }) {
  const t = useT();
  const lang = useLang();
  const { totaux } = mission;
  const cout = direSommeDeclaree(totaux.coutFournisseur, (v) => direUsd(v, lang), t);
  const modele = direSommeDeclaree(totaux.dureeModele, (v) => direDuree(v, lang), t);
  const decisions = DECISIONS_ORDRE.filter((d) => totaux.decisions[d] > 0)
    .map((d) => `${libelleDecision(d, t)} ${totaux.decisions[d]}`)
    .join(' · ');
  const reprises = direReprises(totaux.reprises, t);
  return (
    <dl className="mission-kpi" data-testid="mission-kpi">
      <div>
        <dt>{t('Evaluator', 'Evaluator')}</dt>
        <dd data-testid="mission-decisions">
          {decisions || t('aucune production terminée', 'no finished production')}
        </dd>
      </div>
      <div>
        <dt>{t('Dépense déclarée', 'Declared spend')}</dt>
        <dd data-testid="mission-cout">
          <strong>{totaux.tentatives === 0 ? '—' : cout.valeur}</strong>{' '}
          <span className="mission-couverture">
            {totaux.tentatives === 0
              ? t('aucune tentative', 'no attempt')
              : (cout.couverture ??
                t(
                  `aucune des ${totaux.tentatives} tentative(s) ne déclare son coût`,
                  `none of the ${totaux.tentatives} attempt(s) declares its cost`,
                ))}
          </span>
        </dd>
      </div>
      <div>
        <dt>{t('Temps', 'Time')}</dt>
        <dd>
          {t('Worker', 'Worker')}{' '}
          {totaux.dureeWorkerTotaleMs === null
            ? t('non mesuré', 'not measured')
            : direDuree(totaux.dureeWorkerTotaleMs, lang)}{' '}
          · {t('modèle', 'model')} {modele.valeur}
          {modele.couverture && <span className="mission-couverture"> ({modele.couverture})</span>}
        </dd>
      </div>
      <div>
        <dt>{t('Reprises', 'Retries')}</dt>
        <dd data-testid="mission-reprises">{reprises ?? t('aucune', 'none')}</dd>
      </div>
    </dl>
  );
}

function LigneTache({
  ligne,
  onOpenTask,
}: {
  ligne: LigneMission;
  onOpenTask: (taskId: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const c = ligne.chronologie;
  const cout = direSommeDeclaree(c.coutFournisseur, (v) => direUsd(v, lang), t);
  const reprises = direReprises(ligne.reprises, t);
  return (
    <tr data-testid="mission-ligne" data-role={ligne.role}>
      <th scope="row">
        <button type="button" className="lien-bouton" onClick={() => onOpenTask(ligne.taskId)}>
          {ligne.titre}
        </button>
        <span className="mission-meta">
          {ligne.role === 'relecture' ? t('relecture croisée', 'cross-review') : ligne.categorie}
          {ligne.modeles.length > 0 && ` · ${ligne.modeles.join(', ')}`}
        </span>
      </th>
      <td>{statusLabel(ligne.statut, lang)}</td>
      <td
        data-testid="mission-evaluator"
        data-decision={ligne.evaluator?.decision}
        title={ligne.evaluator?.raison ?? undefined}
      >
        {ligne.evaluator ? libelleDecision(ligne.evaluator.decision, t) : '—'}
      </td>
      <td data-testid="mission-relecture" title={ligne.relecture?.cause ?? undefined}>
        {ligne.relecture
          ? `${libelleRelecture(ligne.relecture.issue, t)}${
              ligne.relecture.favorables + ligne.relecture.contestataires > 0
                ? ` (${ligne.relecture.favorables}✔ ${ligne.relecture.contestataires}✘)`
                : ''
            }`
          : '—'}
      </td>
      <td>{reprises ?? '—'}</td>
      <td>
        {c.terminee && c.totalMs !== null
          ? direDuree(c.totalMs, lang)
          : t('en cours', 'in progress')}
        {c.revueMs !== null && (
          <span className="mission-meta">
            {t('revue', 'review')} {direDuree(c.revueMs, lang)}
          </span>
        )}
      </td>
      <td title={cout.couverture ?? undefined}>
        {cout.valeur}
        {cout.couverture && <span className="mission-meta">{cout.couverture}</span>}
      </td>
    </tr>
  );
}

export function RapportMission({
  projectId,
  refreshTick,
  onOpenTask,
}: {
  projectId: string;
  refreshTick: number;
  onOpenTask: (taskId: string) => void;
}) {
  const t = useT();
  const poll = useApiPoll(() => fetchRapportMission(projectId), 60_000, refreshTick);
  const rapport = poll.error ? null : poll.data;
  const mission = rapport?.mission;
  return (
    <section
      className="mission-panel"
      aria-label={t('Rapport de mission', 'Mission report')}
      data-testid="rapport-mission"
    >
      <h4>{t('Rapport de mission', 'Mission report')}</h4>
      <EchecSondage sondage={poll} avant={t('Rapport indisponible :', 'Report unavailable:')} />
      {!poll.error && !rapport && <p className="muted-text">{t('Lecture…', 'Loading…')}</p>}
      {rapport && !mission && (
        <p className="muted-text" data-testid="mission-absente">
          {t(
            'Le rapport de mission ne se lit pas par un lien de partage : il nomme les modèles et dit ce que la mission a coûté.',
            'The mission report is not readable through a share link: it names the models and states what the mission cost.',
          )}
        </p>
      )}
      {mission && (
        <>
          <EnTete mission={mission} />
          {mission.taches.length === 0 ? (
            <p className="muted-text">{t('Aucune tâche.', 'No tasks.')}</p>
          ) : (
            <div className="mission-defile">
              <table className="mission-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Tâche', 'Task')}</th>
                    <th scope="col">{t('Statut', 'Status')}</th>
                    <th scope="col">{t('Evaluator', 'Evaluator')}</th>
                    <th scope="col">{t('Contre-revue', 'Cross-review')}</th>
                    <th scope="col">{t('Reprises', 'Retries')}</th>
                    <th scope="col">{t('Temps', 'Time')}</th>
                    <th scope="col">{t('Coût déclaré', 'Declared cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {mission.taches.map((l) => (
                    <LigneTache key={l.taskId} ligne={l} onOpenTask={onOpenTask} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <RegistreGenome registre={mission.genome} erreur={null} />
          <p className="muted-text mission-fenetre" data-testid="mission-fenetre">
            {mission.fenetre.depuis === null
              ? t(
                  'Aucun fait de cette mission au journal retenu.',
                  'No fact of this mission in the retained journal.',
                )
              : t(
                  `Lu sur ${mission.fenetre.evenements} fait(s) retenu(s) depuis le ${new Date(mission.fenetre.depuis).toLocaleString('fr-FR')}.`,
                  `Read from ${mission.fenetre.evenements} retained fact(s) since ${new Date(mission.fenetre.depuis).toLocaleString('en-US')}.`,
                )}{' '}
            {mission.fenetre.tronquee &&
              t(
                'Le journal a été élagué : des faits plus anciens ont pu manquer.',
                'The journal was pruned: older facts may be missing.',
              )}{' '}
            {t(NOTE_COUT_DECLARE.fr, NOTE_COUT_DECLARE.en)}
          </p>
        </>
      )}
    </section>
  );
}
