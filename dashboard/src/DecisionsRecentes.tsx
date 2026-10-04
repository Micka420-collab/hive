// Les décisions récentes de la ruche, sur l'accueil.
//
// Pourquoi ce modèle, ce qu'a dit la contre-revue, ce que l'Evaluator a
// renvoyé, ce qu'un humain a tranché, où la Balance a fermé la porte : chacun
// de ces faits était consigné, mais noyé dans un journal où dominent les
// battements de cœur et les progrès — la décision de la dernière minute était
// sortie de l'écran avant qu'on la lise.
//
// Le serveur choisit les faits (`decisionsRecentes`, cockpit.ts) et joint le
// titre de la tâche ; chaque ligne est dite EXACTEMENT comme le Journal la dit
// (`ligneDuJournal`) — deux traductions d'un même fait finiraient par se
// contredire. Un clic ouvre la tâche : la raison complète (classement figé de
// l'Aiguillage, motifs de l'Evaluator) vit dans son tiroir.

import type { Cockpit } from './api';
import { useT } from './i18n';
import { ligneDuJournal } from './Journal';
import { activateProps } from './ui';
import { EchecSondage, timeShort } from './views/shared';
import type { Poll } from './views/shared';

interface Props {
  cockpit: Poll<Cockpit>;
  onOpenTask: (taskId: string) => void;
}

export function DecisionsRecentes({ cockpit, onOpenTask }: Props) {
  const t = useT();
  const donnees = cockpit.error ? null : cockpit.data;
  return (
    <section className="card panel" data-testid="decisions-recentes">
      <header className="panel-head">
        <h2>{t('Décisions récentes', 'Recent decisions')}</h2>
        {donnees && <span className="panel-count">{donnees.decisions.length}</span>}
      </header>
      <EchecSondage
        sondage={cockpit}
        avant={t('Décisions indisponibles :', 'Decisions unavailable:')}
      />
      <ul className="journal">
        {donnees?.decisions.map(({ evenement, titre }) => {
          const ligne = ligneDuJournal(evenement, t);
          const taskId = evenement.payload.taskId;
          const ouvrir = typeof taskId === 'string' ? () => onOpenTask(taskId) : null;
          return (
            <li
              key={evenement.id}
              className={`jrow ${ligne.cls}${ouvrir ? ' clickable' : ''}`}
              {...(ouvrir ? activateProps(ouvrir) : {})}
            >
              <span className="jicon" aria-hidden="true">
                {ligne.icon}
              </span>
              <span className="jtext">
                {titre && <strong className="decision-titre">{titre} · </strong>}
                {ligne.text}
              </span>
              <time className="jtime">{timeShort(evenement.ts)}</time>
            </li>
          );
        })}
        {donnees && donnees.decisions.length === 0 && (
          <li className="empty">
            {t('Aucune décision consignée pour l’instant.', 'No decision recorded yet.')}
          </li>
        )}
      </ul>
    </section>
  );
}
