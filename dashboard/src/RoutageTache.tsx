// « Pourquoi ce Worker ? Pourquoi ce modèle ? » — la réponse, dans le tiroir
// d'une tâche.
//
// Tout vient du journal (`/api/tasks/:id/routage`) : le classement qui a
// décidé, figé à l'instant du choix, jamais recalculé à l'affichage. Un modèle
// jamais jugé est dit « à explorer », jamais noté 0 — y compris quand des
// élections en vol pèsent déjà sur son score, et ces élections sont comptées à
// part ; une absence de modèle déclaré est dite telle quelle, sans
// justification inventée. Dans une course de drones, c'est le drone VAINQUEUR
// qui répond — son nœud, son modèle, son classement —, pas le primaire que
// nomme l'affectation ; et un modèle écarté après un échec sur la tâche est
// dit, comme celui qui y est re-tenté faute d'alternative. Une affectation
// contrainte par la consigne de l'opérateur se lit « forcée par l'opérateur » ;
// la préférence d'une tâche parente est dite avec ce qu'elle a réellement
// départagé — souvent rien, et c'est à dire aussi.
//
// Depuis la v3, chaque ligne est un BRAS (modèle · harness · effort) avec son
// intervalle à 95 %, et la décision dit si l'élu l'emporte à δ = 5 % sur tous
// ses rivaux jugés (« décidé ») ou non (« explore encore ») — un affichage,
// jamais un arrêt de l'exploration. Le coût déclaré n'a sa colonne que quand
// il est entré dans les scores, c'est-à-dire quand TOUS les bras en avaient un.

import { useEffect, useState } from 'react';
import { fetchRoutage } from './api';
import { ExperienceTache } from './ExperienceTache';
import { useT } from './i18n';
import type { HiveNode } from '../../src/shared/types';
import type { AffectationVue, DecisionVue, LigneRaison } from '../../src/shared/routage-vue';
import { Skeleton } from './composants';

interface Props {
  taskId: string;
  /** Change quand la tâche est (ré)affectée : le panneau se relit. */
  cle: string;
  nodes: readonly HiveNode[];
}

const deux = (n: number): string => n.toFixed(2);
/** Le risque de l'état « décidé » (`DELTA_DECISION` côté Reine), en pourcentage. */
const DELTA_POURCENT = 5;

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
  // En course, le drone qui répond : le vainqueur une fois connu, sinon le
  // primaire. Sa raison est la sienne — le classement de son propre nœud.
  const course = derniere?.course ?? null;
  const producteur = course?.drones.find(
    (d) => d.nodeId === (course.vainqueur?.nodeId ?? derniere?.nodeId),
  );
  // Un drone sans modèle reste sans modèle : jamais celui du primaire.
  const vue = producteur
    ? {
        nodeId: producteur.nodeId,
        modele: course?.vainqueur?.modele ?? producteur.modele,
        effort: producteur.effort,
        raisonModele: producteur.raisonModele,
        decision: producteur.decision,
      }
    : derniere;

  const critere = (a: AffectationVue): string => {
    if (a.critereNoeud === 'course_de_drones' && a.course) {
      const n = a.course.drones.length;
      return a.course.vainqueur
        ? t(`vainqueur d’une course de ${n} drones`, `winner of a ${n}-drone race`)
        : t(
            `primaire d’une course de ${n} drones à agents diversifiés`,
            `primary of a ${n}-drone race across diverse agents`,
          );
    }
    if (a.critereNoeud === 'pheromones' && a.pheromone) {
      return t(
        `départagé par les phéromones (domaine « ${a.pheromone.domaine} », score ${deux(a.pheromone.score)})`,
        `tie broken by pheromones (domain “${a.pheromone.domaine}”, score ${deux(a.pheromone.score)})`,
      );
    }
    if (a.critereNoeud === 'preference_parent') {
      return t(
        'départagé par la famille que préférait la tâche parente',
        'tie broken by the agent family the parent task preferred',
      );
    }
    if (a.critereNoeud === 'porteur_du_modele') {
      return t(
        'porte le modèle élu — le moins chargé de ses porteurs',
        'runs the chosen model — the least loaded of its carriers',
      );
    }
    // Une ombre du banc : son modèle n'a pas été élu par l'Aiguillage — le
    // dire « élu » ferait croire que le routing l'a choisi.
    if (a.critereNoeud === 'porteur_du_modele_ombre') {
      return t(
        'porte le modèle de cette ombre, choisi par le banc d’ombre — le moins chargé de ses porteurs',
        'runs this shadow’s model, picked by the shadow bench — the least loaded of its carriers',
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
  // Le bras : le modèle, et ce qui le distingue d'un frère (harness, effort).
  // Raison d'avant la v3 : ni l'un ni l'autre n'est connu, le modèle seul.
  const bras = (l: LigneRaison): string =>
    [l.modele, l.harness, l.effort ?? (l.harness ? t('effort par défaut', 'default effort') : null)]
      .filter((x): x is string => typeof x === 'string' && x !== '')
      .join(' · ');
  const intervalle = (l: LigneRaison): string =>
    l.intervalle ? `${deux(l.intervalle.bas)}–${deux(l.intervalle.haut)}` : '—';
  const decision = (d: DecisionVue): string => {
    if (d.etat === 'seul') return t('seul bras en lice', 'only arm in the running');
    return d.etat === 'decide'
      ? t(
          `décidé à δ = ${DELTA_POURCENT} % : son intervalle dépasse celui de chaque rival jugé — l’exploration continue quand même`,
          `decided at δ = ${DELTA_POURCENT}%: its interval clears every judged rival — exploration still goes on`,
        )
      : t(
          'explore encore : un rival n’est pas jugé, ou les intervalles se chevauchent',
          'still exploring: a rival is unjudged, or the intervals overlap',
        );
  };
  const coutPondere = vue?.decision?.coutPondere === true;

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
      {!erreur && affectations === null && <Skeleton lignes={2} />}
      {!erreur && affectations !== null && derniere === null && (
        <p className="muted">{t('Pas encore affectée.', 'Not assigned yet.')}</p>
      )}
      {derniere && vue && (
        <>
          <p data-testid="routage-worker">
            <strong>{nomNoeud(vue.nodeId)}</strong> — {critere(derniere)}
          </p>
          {course && (
            <p className="muted" data-testid="routage-course">
              {t('Drones :', 'Drones:')}{' '}
              {course.drones
                .map((d) => `${nomNoeud(d.nodeId)} (${d.modele ?? t('son défaut', 'its default')})`)
                .join(' · ')}
            </p>
          )}
          {vue.modele ? (
            <>
              <p data-testid="routage-modele">
                {t('Modèle', 'Model')} <strong>{vue.modele}</strong>
                {vue.effort && (
                  <span data-testid="routage-effort">
                    {' '}
                    {t(`à l’effort « ${vue.effort} »`, `at “${vue.effort}” effort`)}
                  </span>
                )}
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
              {vue.decision && (
                <p className="muted" data-testid="routage-decision">
                  {decision(vue.decision)}
                  {vue.decision.coutPondere &&
                    t(
                      ' · coût déclaré pris en compte (tous les bras en déclarent un)',
                      ' · declared cost weighed in (every arm declares one)',
                    )}
                </p>
              )}
              {vue.raisonModele.length > 0 && (
                <table
                  className="routage-rang"
                  aria-label={t('Classement de l’Aiguillage', 'Routing ranking')}
                >
                  <thead>
                    <tr>
                      <th>{t('Modèle', 'Model')}</th>
                      <th>{t('Essais', 'Trials')}</th>
                      <th>{t('Moyenne', 'Mean')}</th>
                      <th>{t('IC 95 %', '95% CI')}</th>
                      {coutPondere && <th>{t('Coût déclaré', 'Declared cost')}</th>}
                      <th>{t('Score', 'Score')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vue.raisonModele.map((l, i) => (
                      // Le premier est l'élu : le classement est trié (préférence
                      // du parent comprise). Plusieurs bras partagent un modèle,
                      // le nom ne suffit plus.
                      <tr key={bras(l)} className={i === 0 ? 'elu' : undefined}>
                        <td>
                          {bras(l)}
                          {l.preferee && (
                            <span className="muted">
                              {' '}
                              {t('(préféré par le parent)', '(preferred by the parent)')}
                            </span>
                          )}
                        </td>
                        <td>{essais(l)}</td>
                        <td>{l.moyenne === null ? '—' : deux(l.moyenne)}</td>
                        <td data-testid="routage-intervalle">{intervalle(l)}</td>
                        {coutPondere && <td>{l.cout === null ? '—' : `$${l.cout.toFixed(3)}`}</td>}
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
          {derniere.consigne && (
            <p className="muted" data-testid="routage-consigne">
              {t(
                'Forcé par l’opérateur : sa consigne a restreint ce choix. Le classement reste celui de l’Aiguillage.',
                'Forced by the operator: their constraint narrowed this choice. The ranking is still the router’s own.',
              )}
            </p>
          )}
          {derniere.preference && (
            <p className="muted" data-testid="routage-preference">
              {(() => {
                const p = derniere.preference;
                const voulu = [p.agent, p.modele].filter((x): x is string => x !== null).join(', ');
                return p.departage.length > 0
                  ? t(
                      `Préférence de la tâche parente (${voulu}) : a départagé des ex æquo.`,
                      `Parent task preference (${voulu}): broke a tie.`,
                    )
                  : t(
                      `Préférence de la tâche parente (${voulu}) : lue, sans effet — rien à départager.`,
                      `Parent task preference (${voulu}): read, no effect — nothing to break.`,
                    );
              })()}
            </p>
          )}
          {derniere.modelesEcartes.length > 0 && (
            <p className="muted" data-testid="routage-ecartes">
              {t(
                `Écarté pour cette tâche après un échec : ${derniere.modelesEcartes.join(', ')} — un plantage n’est pas une note, rien n’est appris.`,
                `Set aside for this task after a failure: ${derniere.modelesEcartes.join(', ')} — a crash is not a grade, nothing is learned.`,
              )}
            </p>
          )}
          {derniere.modelesReadmis.length > 0 && (
            <p className="muted" data-testid="routage-readmis">
              {t(
                `Déjà échoué sur cette tâche, re-tenté faute d’alternative dans la ruche : ${derniere.modelesReadmis.join(', ')}.`,
                `Already failed on this task, retried for lack of an alternative in the hive: ${derniere.modelesReadmis.join(', ')}.`,
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
          {derniere.experience && <ExperienceTache experience={derniere.experience} />}
        </>
      )}
    </section>
  );
}
