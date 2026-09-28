// Ce qui arrête la ruche — UN bloc sur l'accueil.
//
// Avant lui, chaque arrêt vivait dans sa vue, ou nulle part : un plafond de
// dépense qui fermait la porte d'un projet se lisait dans la Balance, une
// relecture impossible attendait un humain dans le tiroir d'une tâche, une
// ouvrière tombée laissait la file pleine sous un compteur « 0/1 » qu'il
// fallait savoir lire. On arrivait sur l'accueil et rien ne disait que la
// ruche ne faisait plus rien.
//
// Le bloc ne DÉCIDE rien : les alertes, leur genre et leur ordre viennent du
// serveur (`src/orchestrator/cockpit.ts`), confrontées à l'état courant — un
// fait réglé n'y figure plus. L'écran ne fait que les dire et mener au geste
// qui les lève. Un échec de lecture se dit « état inconnu », jamais « rien » :
// zéro alerte et « je n'ai pas pu lire » sont deux situations opposées.

import type { AlerteCockpit, Cockpit } from './api';
import { useLang, useT } from './i18n';
import type { Translate } from './i18n';
import { direDuree } from '../../src/shared/horloge-chantier';
import { formatDuree } from './ui';
import { EchecSondage, timeShort } from './views/shared';
import type { Poll, ViewId } from './views/shared';

interface Props {
  cockpit: Poll<Cockpit>;
  nomsDeNoeuds: ReadonlyMap<string, string>;
  onOpenTask: (taskId: string) => void;
  onNavigate: (view: ViewId, id?: string) => void;
}

const ICONES: Record<AlerteCockpit['genre'], string> = {
  blocage: '⏸',
  budget: '■',
  relecture_impossible: '✋',
  refus: '⇄',
};

const titreOu = (titre: string | null, id: string): string => titre ?? id.slice(0, 8);

function texteAlerte(
  a: AlerteCockpit,
  t: Translate,
  lang: 'fr' | 'en',
  nomsDeNoeuds: ReadonlyMap<string, string>,
): string {
  switch (a.genre) {
    case 'blocage':
      if (a.cause === 'aucune_ouvriere') {
        return t(
          `${a.taches} tâche(s) prête(s) et aucune ouvrière en ligne — rien ne partira tant qu’un nœud ne revient pas`,
          `${a.taches} task(s) ready and no worker online — nothing will start until a node comes back`,
        );
      }
      return t(
        `relecture de « ${titreOu(a.titre, a.taskId)} » en attente : aucun nœud ${a.relecteur} en ligne` +
          (a.delaiMs === null ? '' : ` (échec dit après ${direDuree(a.delaiMs, lang)})`),
        `review of “${titreOu(a.titre, a.taskId)}” waiting: no ${a.relecteur} node online` +
          (a.delaiMs === null ? '' : ` (failure reported after ${direDuree(a.delaiMs, lang)})`),
      );
    case 'budget': {
      const projet = a.projet ?? a.projectId.slice(0, 8);
      const plafond = a.plafondMs === null ? '?' : formatDuree(a.plafondMs);
      return t(
        `projet « ${projet} » arrêté par son plafond de dépense (${formatDuree(a.depenseMs)} / ${plafond})`,
        `project “${projet}” stopped by its spending cap (${formatDuree(a.depenseMs)} / ${plafond})`,
      );
    }
    case 'relecture_impossible':
      // La cause est rangée en français (c'est aussi le motif de l'Evaluator) :
      // la ligne anglaise ne la mêle pas à sa phrase.
      return t(
        `« ${titreOu(a.titre, a.taskId)} » : relecture impossible — ${a.cause}. Un humain doit trancher.`,
        `“${titreOu(a.titre, a.taskId)}”: review impossible — a human must decide.`,
      );
    case 'refus': {
      const titre = titreOu(a.titre, a.taskId);
      // Le dernier refus a pu sortir du journal : le nœud reste inconnu, dit tel.
      const noeud = a.nodeId === null ? '?' : (nomsDeNoeuds.get(a.nodeId) ?? a.nodeId.slice(0, 8));
      if (a.definitif) {
        return t(
          `« ${titre} » a échoué : aucun agent qui fonctionne (dernier refus, ${noeud} : ${a.raison}) — réparez l’agent puis relancez-la`,
          `“${titre}” failed: no working agent (last refusal, ${noeud}: ${a.raison}) — fix the agent, then retry it`,
        );
      }
      return t(
        `« ${titre} » refusée par ${noeud} : ${a.raison} — personne ne l’a reprise`,
        `“${titre}” declined by ${noeud}: ${a.raison} — nobody has taken it since`,
      );
    }
  }
}

export function AlertesRuche({ cockpit, nomsDeNoeuds, onOpenTask, onNavigate }: Props) {
  const t = useT();
  const lang = useLang();
  // L'ERREUR fait foi : `useApiPoll` garde la dernière réponse quand une
  // lecture échoue, et une liste vide d'il y a dix minutes se lirait encore
  // « rien n'arrête la ruche » alors qu'on ne sait plus rien.
  const donnees = cockpit.error ? null : cockpit.data;
  const agir = (a: AlerteCockpit): (() => void) => {
    switch (a.genre) {
      case 'blocage':
        return a.cause === 'aucune_ouvriere'
          ? () => onNavigate('essaim')
          : () => onOpenTask(a.taskId);
      case 'budget':
        return () => onNavigate('projets', a.projectId);
      case 'relecture_impossible':
      case 'refus':
        return () => onOpenTask(a.taskId);
    }
  };

  return (
    <section
      className="alertes-ruche"
      aria-labelledby="alertes-ruche-titre"
      data-testid="alertes-ruche"
    >
      <header className="autonomie-pulse-tete">
        <h3 id="alertes-ruche-titre">
          {t('Ce qui arrête la ruche', 'What is stopping the hive')}
          {donnees && donnees.total > 0 && (
            <span className="alertes-ruche-compte" data-testid="alertes-ruche-total">
              {donnees.total}
            </span>
          )}
        </h3>
      </header>
      <EchecSondage sondage={cockpit} avant={t('État inconnu :', 'State unknown:')} />
      {!cockpit.error && !donnees && <p className="alertes-ruche-vide">…</p>}
      {donnees && donnees.alertes.length === 0 && (
        <p className="alertes-ruche-vide" data-testid="alertes-ruche-aucune">
          {t('Rien n’arrête la ruche.', 'Nothing is stopping the hive.')}
        </p>
      )}
      {donnees && donnees.alertes.length > 0 && (
        <ul className="alertes-ruche-liste">
          {donnees.alertes.map((a, i) => (
            <li key={`${a.genre}-${i}`}>
              <button
                type="button"
                className={`alertes-ruche-item alertes-ruche-item--${a.genre}`}
                data-genre={a.genre}
                onClick={agir(a)}
              >
                <span className="alertes-ruche-icone" aria-hidden="true">
                  {ICONES[a.genre]}
                </span>
                <span className="alertes-ruche-texte">{texteAlerte(a, t, lang, nomsDeNoeuds)}</span>
                {a.depuis !== null && (
                  <time className="alertes-ruche-quand" dateTime={new Date(a.depuis).toISOString()}>
                    {timeShort(a.depuis)}
                  </time>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {donnees && donnees.total > donnees.alertes.length && (
        <p className="alertes-ruche-vide">
          {t(
            `+${donnees.total - donnees.alertes.length} autre(s) — les plus anciennes d’abord ci-dessus`,
            `+${donnees.total - donnees.alertes.length} more — oldest first above`,
          )}
        </p>
      )}
    </section>
  );
}
