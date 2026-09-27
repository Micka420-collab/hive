// « Pourquoi ce Worker ? Pourquoi ce modèle ? » — la réponse, dans le tiroir
// d'une tâche.
//
// Tout vient du journal (`/api/tasks/:id/routage`) : le classement qui a
// décidé, figé à l'instant du choix, jamais recalculé à l'affichage. Un modèle
// jamais jugé est dit « à explorer », jamais noté 0 — y compris quand des
// élections en vol pèsent déjà sur son score, et ces élections sont comptées à
// part ; une absence de modèle déclaré est dite telle quelle, sans
// justification inventée.

import { useEffect, useState } from 'react';
import { fetchRoutage } from './api';
import { useT } from './i18n';
import type { HiveNode } from '../../src/shared/types';
import type { AffectationVue, LigneRaison } from '../../src/shared/routage-vue';

interface Props {
  taskId: string;
  /** Change quand la tâche est (ré)affectée : le panneau se relit. */
  cle: string;
  nodes: readonly HiveNode[];
}

const deux = (n: number): string => n.toFixed(2);

export function RoutageTache({ taskId, cle, nodes }: Props) {
  const t = useT();
  const [affectations, setAffectations] = useState<AffectationVue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setErreur(null);
    fetchRoutage(taskId)
      .then((r) => vivant && setAffectations(r.affectations))
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [taskId, cle]);

  const derniere = affectations && affectations.length > 0 ? affectations.at(-1)! : null;
  const nomNoeud = (id: string): string => nodes.find((n) => n.id === id)?.name ?? id.slice(0, 8);

  const critere = (a: AffectationVue): string => {
    if (a.critereNoeud === 'pheromones' && a.pheromone) {
      return t(
        `départagé par les phéromones (domaine « ${a.pheromone.domaine} », score ${deux(a.pheromone.score)})`,
        `tie broken by pheromones (domain “${a.pheromone.domaine}”, score ${deux(a.pheromone.score)})`,
      );
    }
    if (a.critereNoeud === 'porteur_du_modele') {
      return t(
        'porte le modèle élu — le moins chargé de ses porteurs',
        'runs the chosen model — the least loaded of its carriers',
      );
    }
    return t('le moins chargé des nœuds éligibles', 'the least loaded eligible node');
  };

  // `enVol` null (raison d'avant la v2) : inconnu, on n'affiche rien plutôt
  // qu'un « 0 en vol » qui affirmerait ce que la raison ne dit pas.
  const enVol = (l: LigneRaison): number => l.enVol ?? 0;
  const score = (l: LigneRaison): string => {
    if (!l.aExplorer) return l.score === null ? '—' : deux(l.score);
    return enVol(l) > 0
      ? t(`à explorer (${enVol(l)} en vol)`, `to explore (${enVol(l)} in flight)`)
      : t('à explorer', 'to explore');
  };
  const essais = (l: LigneRaison): string =>
    !l.aExplorer && enVol(l) > 0
      ? t(`${l.essais} + ${enVol(l)} en vol`, `${l.essais} + ${enVol(l)} in flight`)
      : String(l.essais);

  return (
    <section className="routage-panel" aria-labelledby="routage-title" data-testid="routage-tache">
      <h3 id="routage-title">
        {t('Pourquoi ce Worker, ce modèle', 'Why this Worker, this model')}
      </h3>
      {erreur && (
        <p className="modal-error">
          {t('Raison indisponible :', 'Reason unavailable:')} {erreur}
        </p>
      )}
      {!erreur && affectations === null && <p className="muted">{t('Lecture…', 'Loading…')}</p>}
      {!erreur && affectations !== null && derniere === null && (
        <p className="muted">{t('Pas encore affectée.', 'Not assigned yet.')}</p>
      )}
      {derniere && (
        <>
          <p data-testid="routage-worker">
            <strong>{nomNoeud(derniere.nodeId)}</strong> — {critere(derniere)}
          </p>
          {derniere.modele ? (
            <>
              <p data-testid="routage-modele">
                {t('Modèle', 'Model')} <strong>{derniere.modele}</strong>
                {derniere.categorie && (
                  <>
                    {' '}
                    — {t(`catégorie « ${derniere.categorie} »`, `category “${derniere.categorie}”`)}
                  </>
                )}
                {derniere.versionAiguillage !== null && (
                  <span className="muted" data-testid="routage-version">
                    {' '}
                    · Aiguillage v{derniere.versionAiguillage}
                  </span>
                )}
              </p>
              {derniere.raisonModele.length > 0 && (
                <table
                  className="routage-rang"
                  aria-label={t('Classement de l’Aiguillage', 'Routing ranking')}
                >
                  <thead>
                    <tr>
                      <th>{t('Modèle', 'Model')}</th>
                      <th>{t('Essais', 'Trials')}</th>
                      <th>{t('Moyenne', 'Mean')}</th>
                      <th>{t('Score', 'Score')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derniere.raisonModele.map((l) => (
                      <tr
                        key={l.modele}
                        className={l.modele === derniere.modele ? 'elu' : undefined}
                      >
                        <td>{l.modele}</td>
                        <td>{essais(l)}</td>
                        <td>{l.moyenne === null ? '—' : deux(l.moyenne)}</td>
                        <td>{score(l)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="muted" data-testid="routage-sans-modele">
              {t(
                'Aucun modèle déclaré par les nœuds éligibles : l’ouvrière choisit elle-même.',
                'No model declared by eligible nodes: the worker picks its own.',
              )}
            </p>
          )}
          {affectations && affectations.length > 1 && (
            <p className="muted">
              {t(
                `Affectée ${affectations.length} fois (réaffectations comprises).`,
                `Assigned ${affectations.length} times (reassignments included).`,
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
