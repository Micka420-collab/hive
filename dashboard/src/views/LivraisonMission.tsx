// LIVRER LA MISSION SUR UNE BRANCHE GIT — sans GitHub.
//
// Le geste qui manquait aux projets GitLab, Gitea, dépôt nu ou disque local :
// intégrer les tâches terminées sur une ouvrière et les COMMITER sur
// `hive/mission-<projectId>-<n>` du dépôt du projet. La chaîne est décrite en
// tête de `src/shared/livraison-locale.ts` ; cet écran en montre les trois
// portes, dans l'ordre où la Reine les tient :
//
//   · livrer est un geste de propriétaire — la Reine refuse les autres, et
//     l'écran affiche son refus tel quel ;
//   · l'Evaluator peut ARRÊTER la mission. Le forçage n'apparaît qu'APRÈS cet
//     arrêt, jamais avant, et il exige une raison : c'est un geste journalisé,
//     pas une case qu'on coche par habitude ;
//   · pousser est une case DÉCOCHÉE par défaut. Elle écrit sur le dépôt avec
//     les identifiants git de l'ouvrière, qui doit y avoir consenti.
//
// Rien ne part au montage : ni lecture, ni sondage. Le suivi ne commence
// qu'une fois la livraison lancée, et ne relit que la mémoire de la Reine.

import { useState } from 'react';
import { livrerLocalement, RefusLivraison } from '../api';
import { useT } from '../i18n';
import type { Project } from '../../../src/shared/types';
import { MergeReport } from './MergeReport';
import { phraseDeLivraison } from './projets-rendu';
import { argv, useSuiviMerge } from './suivi-merge';

/**
 * Une livraison peut préparer l'environnement puis lancer des tests : on
 * attend autant que la Reine, qui déclare le merge orphelin au bout de dix
 * minutes et rend alors un rapport d'échec qu'on lira.
 */
const DELAI_LIVRAISON_MS = 10 * 60_000 + 15_000;

export function LivraisonMission({
  project,
  taskTitles,
}: {
  project: Project;
  taskTitles?: Map<string, string> | undefined;
}) {
  const t = useT();
  const titres = taskTitles ?? new Map<string, string>();
  const [pousser, setPousser] = useState(false);
  const [prepCmd, setPrepCmd] = useState('');
  const [testCmd, setTestCmd] = useState('');
  const [raison, setRaison] = useState('');
  const [confirmer, setConfirmer] = useState(false);
  const [noeud, setNoeud] = useState('');
  const { suivi, lancer } = useSuiviMerge(project.id, DELAI_LIVRAISON_MS);
  const occupe = suivi.phase === 'starting' || suivi.phase === 'polling';
  // Le forçage ne se PROPOSE que si l'Evaluator vient d'arrêter la mission :
  // l'offrir sur « aucune ouvrière n'a consenti » ne forcerait rien.
  const arret =
    suivi.phase === 'error' &&
    suivi.erreur instanceof RefusLivraison &&
    suivi.erreur.code === 'evaluator_blocks'
      ? suivi.erreur
      : null;

  const livrer = (forcer?: string) => {
    setConfirmer(false);
    lancer(() =>
      livrerLocalement(project.id, {
        pousser,
        testCommand: argv(testCmd),
        prepareCommand: argv(prepCmd),
        ...(forcer ? { forcer: { raison: forcer } } : {}),
      }).then((depart) => {
        setNoeud(depart.noeud);
        return depart;
      }),
    );
  };

  const rapport =
    suivi.phase === 'done' ? phraseDeLivraison(suivi.result.livraison, noeud, t) : null;

  return (
    <div className="pj-mission">
      <div className="pj-sub-head">
        <h4>{t('Livrer la mission sur une branche git', 'Deliver the mission to a git branch')}</h4>
      </div>
      <p className="pj-sub-note">
        {t(
          'Intègre les tâches terminées sur une ouvrière et les commite sur hive/mission-…, dans le dépôt du projet — GitLab, Gitea, dépôt nu, sans GitHub. La branche principale n’est pas touchée.',
          'Integrates the finished tasks on a worker and commits them to hive/mission-… in the project repository — GitLab, Gitea, bare repository, no GitHub needed. The main branch is not touched.',
        )}
      </p>
      <div className="pj-run">
        <div className="pj-cmds">
          <input
            className="pj-testcmd"
            type="text"
            placeholder={t(
              'Préparer l’environnement (optionnel), ex. npm ci',
              'Prepare the environment (optional), e.g. npm ci',
            )}
            value={prepCmd}
            onChange={(e) => setPrepCmd(e.target.value)}
            disabled={occupe}
            aria-label={t('Préparation avant livraison', 'Preparation before delivery')}
          />
          <input
            className="pj-testcmd"
            type="text"
            placeholder={t(
              'Tests à passer avant de commiter (optionnel), ex. npm test',
              'Tests to pass before committing (optional), e.g. npm test',
            )}
            value={testCmd}
            onChange={(e) => setTestCmd(e.target.value)}
            disabled={occupe}
            aria-label={t('Tests avant livraison', 'Tests before delivery')}
          />
        </div>
        <label className="pj-pousser">
          <input
            type="checkbox"
            checked={pousser}
            onChange={(e) => setPousser(e.target.checked)}
            disabled={occupe}
          />{' '}
          {t(
            'Pousser vers le dépôt du projet — avec les identifiants git de l’ouvrière, qui doit y consentir',
            'Push to the project repository — with the worker’s git credentials, which it must consent to',
          )}
        </label>
        {!confirmer && !occupe && (
          <button className="btn primary" onClick={() => setConfirmer(true)}>
            {t('Livrer la mission', 'Deliver the mission')}
          </button>
        )}
        {confirmer && (
          <>
            <span className="pj-confirm">
              {pousser
                ? t(
                    `Commiter « ${project.name} » sur une branche de mission ET la pousser — confirmer ?`,
                    `Commit “${project.name}” to a mission branch AND push it — confirm?`,
                  )
                : t(
                    `Commiter « ${project.name} » sur une branche de mission — confirmer ?`,
                    `Commit “${project.name}” to a mission branch — confirm?`,
                  )}
            </span>
            <button className="btn primary" onClick={() => livrer()}>
              {t('Confirmer', 'Confirm')}
            </button>
            <button className="btn ghost" onClick={() => setConfirmer(false)}>
              {t('Annuler', 'Cancel')}
            </button>
          </>
        )}
        {occupe && (
          <span className="pj-busy" role="status">
            <span className="pj-busy-dot" aria-hidden="true">
              ⬡
            </span>{' '}
            {t('Livraison en cours sur l’ouvrière…', 'Delivery running on the worker…')}
          </span>
        )}
      </div>

      {suivi.phase === 'error' && (
        <p className="panel-error">
          {t('Livraison refusée :', 'Delivery refused:')} {suivi.message}
        </p>
      )}
      {arret && (
        <div className="pj-forcer">
          <ul className="pj-conf-list">
            {arret.bloquees.map((b) => (
              <li key={b.taskId}>
                <strong>{titres.get(b.taskId) ?? b.taskId}</strong> —{' '}
                <code className="mono">{b.decision ?? t('inconnu', 'unknown')}</code>
              </li>
            ))}
          </ul>
          <input
            className="pj-testcmd"
            type="text"
            placeholder={t(
              'Pourquoi passer outre l’Evaluator ? (journalisé)',
              'Why override the Evaluator? (logged)',
            )}
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            aria-label={t('Raison du forçage', 'Override reason')}
          />
          <button
            className="btn ghost"
            onClick={() => livrer(raison.trim())}
            disabled={raison.trim().length < 3}
          >
            {t('Passer outre et livrer', 'Override and deliver')}
          </button>
        </div>
      )}
      {suivi.phase === 'timeout' && (
        <p className="panel-error">
          {t(
            'Pas de résultat après 10 min — vérifiez l’ouvrière, puis relisez le résultat du merge.',
            'No result after 10 min — check the worker, then read the merge result again.',
          )}
        </p>
      )}
      {suivi.phase === 'done' && rapport && (
        <>
          <p className={`pj-mission-${rapport.gravite}`} role="status">
            {rapport.texte}
          </p>
          <MergeReport result={suivi.result} taskTitles={titres} />
        </>
      )}
    </div>
  );
}
