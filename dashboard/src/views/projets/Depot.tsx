// LES ISSUES ET LES LIVRAISONS D'UN PROJET — d'où vient le travail, et ce
// qu'il devient chez GitHub. Sortis de `Projets.tsx` tels quels ; exportés pour
// être rendus en test (`dashboard/tests/panneaux-depot.test.tsx`).

import { useState } from 'react';
import { nomDeLivraison } from '../projets-rendu';
import { fetchIssues, fetchLivraisons, prendreIssue, reprendreLivraison } from '../../api';
import type { IssueVue, LivraisonVue } from '../../api';
import { useT } from '../../i18n';
import { LivraisonMission } from '../LivraisonMission';
import type { Project } from '../../../../src/shared/types';
import { errMsg } from './commun';
import '../projets.css';

/**
 * Les issues du dépôt, et le geste de les prendre.
 *
 * ─── POURQUOI CE PANNEAU NE SE RAFRAÎCHIT PAS TOUT SEUL ─────────────────────
 *
 * Chaque lecture consomme le QUOTA GITHUB DE L'HÔTE. Un `useApiPoll` sur cinq
 * cartes de projet épuiserait le quota horaire du jeton en une après-midi
 * d'écran ouvert, et la ruche perdrait alors sa capacité à LIVRER — pour avoir
 * affiché une liste que personne ne regardait.
 *
 * Les issues se demandent donc, elles ne se surveillent pas.
 *
 * EXPORTÉ POUR ÊTRE RENDU EN TEST — pas pour être réutilisé ailleurs. Ce
 * panneau porte une machine à états (`enCours`) qu'aucune lecture du source ne
 * peut exercer : seul un rendu réel dit si le bouton se verrouille pendant que
 * la ruche travaille. Voir `dashboard/tests/panneaux-depot.test.tsx`.
 */
export function IssuesProjet({ project }: { project: Project }) {
  const t = useT();
  const [issues, setIssues] = useState<IssueVue[] | null>(null);
  const [depot, setDepot] = useState('');
  const [tronque, setTronque] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pris, setPris] = useState<Record<number, string>>({});
  const [enCours, setEnCours] = useState<number | null>(null);

  // Sans dépôt, il n'y a rien à demander : on se tait plutôt que d'offrir un
  // bouton qui ne peut que refuser.
  if (!project.repoUrl) return null;

  const charger = () => {
    setChargement(true);
    setErreur(null);
    fetchIssues(project.id)
      .then((r) => {
        setIssues(r.issues);
        setDepot(r.depot);
        setTronque(r.tronque);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const prendre = (numero: number) => {
    setEnCours(numero);
    setErreur(null);
    prendreIssue(project.id, numero)
      .then((r) =>
        setPris((p) => ({
          ...p,
          [numero]: t(`${r.taches.length} tâche(s) créée(s)`, `${r.taches.length} task(s) created`),
        })),
      )
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(null));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Issues du dépôt', 'Repository issues')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : issues
              ? t('relire', 'reload')
              : t('voir les issues', 'show issues')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {issues && issues.length === 0 && (
        <p className="pj-sub-vide">
          {t('Aucune issue ouverte sur ', 'No open issue on ')}
          {depot}.
        </p>
      )}

      {issues && issues.length > 0 && (
        <ul className="pj-iss-liste">
          {issues.map((i) => (
            <li key={i.numero}>
              <a
                className="pj-iss-titre"
                href={i.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{i.numero} {i.titre}
              </a>
              {i.etiquettes.length > 0 && (
                <span className="pj-iss-etiq">{i.etiquettes.join(' · ')}</span>
              )}
              {pris[i.numero] ? (
                <span className="pj-iss-pris">✔ {pris[i.numero]}</span>
              ) : (
                <button
                  className="btn ghost sm"
                  onClick={() => prendre(i.numero)}
                  disabled={enCours !== null}
                  title={t(
                    'La ruche découpe cette demande en tâches',
                    'The hive splits this request into tasks',
                  )}
                >
                  {enCours === i.numero ? '…' : t('prendre', 'take')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {tronque && (
        <p className="pj-sub-note">
          {t(
            'Liste tronquée : le dépôt a plus d’issues que la ruche n’en lit d’un coup.',
            'Truncated: the repository has more issues than the hive reads at once.',
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Ce que deviennent les pull requests ouvertes par la ruche.
 *
 * Même règle que les issues : la lecture coûte le quota de l'hôte, donc elle se
 * demande. Et REPRENDRE fait travailler l'essaim — c'est un geste, jamais un
 * effet de bord d'un rafraîchissement.
 *
 * EXPORTÉ POUR ÊTRE RENDU EN TEST — même raison que `IssuesProjet`.
 */
export function LivraisonsProjet({
  project,
  taskTitles,
}: {
  project: Project;
  taskTitles?: Map<string, string>;
}) {
  const t = useT();
  const [livraisons, setLivraisons] = useState<LivraisonVue[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [repris, setRepris] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);

  if (!project.repoUrl) return null;

  const charger = () => {
    setChargement(true);
    setErreur(null);
    fetchLivraisons(project.id)
      .then((r) => setLivraisons(r.livraisons))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const reprendre = (taskId: string) => {
    setEnCours(taskId);
    setErreur(null);
    reprendreLivraison(project.id, taskId)
      .then((r) => {
        setRepris((p) => ({ ...p, [taskId]: r.tache.title }));
        charger();
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(null));
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Ce que devient le travail livré', 'What the delivered work becomes')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : livraisons
              ? t('relire', 'reload')
              : t('voir les livraisons', 'show deliveries')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {livraisons && livraisons.length === 0 && (
        <p className="pj-sub-vide">
          {t('Aucune pull request ouverte par la ruche.', 'No pull request opened by the hive.')}
        </p>
      )}

      {livraisons && livraisons.length > 0 && (
        <ul className="pj-liv-liste">
          {livraisons.map((l) => (
            <li key={l.taskId} className={`pj-liv-${l.etat ?? 'inconnu'}`}>
              <a
                className="pj-liv-pr"
                href={`https://github.com/${l.depot}/pull/${l.pr}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{l.pr}
              </a>
              <span className="pj-liv-titre">{nomDeLivraison(l)}</span>
              {/* Une PR illisible le DIT. Une ligne muette laisserait croire
                  qu'il ne se passe rien, alors qu'on n'a pas pu regarder. */}
              <span className="pj-liv-etat">{l.illisible ? l.illisible : l.dit}</span>
              {repris[l.taskId] ? (
                <span className="pj-liv-repris">✔ {repris[l.taskId]}</span>
              ) : (
                l.reprenable && (
                  <button
                    className="btn ghost sm"
                    onClick={() => reprendre(l.taskId)}
                    disabled={enCours !== null}
                    title={t(
                      'Fabrique une tâche qui reprend ce qui est signalé',
                      'Creates a task that picks up what was reported',
                    )}
                  >
                    {enCours === l.taskId ? '…' : t('reprendre', 'pick up')}
                  </button>
                )
              )}
              {/* Pas de bouton que la Reine refuserait — mais pas de silence non
                  plus : la raison (reprise en vol, plafond) se lit ici. */}
              {!repris[l.taskId] && !l.reprenable && l.nonReprenable && (
                <span className="pj-liv-repris">{l.nonReprenable}</span>
              )}
              {/* Le garde de PR : ce qu'il a fait sans qu'on clique, et où en
                  est le compteur. Éteint, il le dit — un garde muet se lirait
                  comme un garde qui veille. */}
              {l.garde && (
                <span className="pj-liv-repris pj-liv-garde">
                  {l.garde.actif
                    ? `${t('garde', 'guard')} · ${l.garde.dit || t('en veille', 'watching')} · ${t('reprises', 'retries')} ${l.garde.tentatives}/${l.garde.plafond}`
                    : t('garde éteint', 'guard off')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Sans GitHub : la mission ENTIÈRE, commitée sur une branche du dépôt.
          Un composant à part — il suit son merge en scrutant la Reine, et ce
          panneau-ci ne sonde jamais (quota GitHub de l'hôte). */}
      <LivraisonMission project={project} taskTitles={taskTitles} />
    </div>
  );
}
