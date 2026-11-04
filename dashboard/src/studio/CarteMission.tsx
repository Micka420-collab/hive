// La carte « Mission en cours » de l'accueil — l'état RÉEL de la mission du projet actif.
//
// ─── CE QU'ELLE AFFICHE, ET CE QU'ELLE REFUSE D'AFFICHER ─────────────────────
//
// La maquette montre « 72 % », « ETA : 18 min », un bouton Pause. Ici :
//   · la progression est un COMPTE — tâches terminées sur tâches du plan —, lu
//     dans le résumé que la Reine tient elle-même quand il existe ;
//   · pas d'ETA : rien dans la ruche ne prédit l'heure de fin d'une mission. Le
//     temps ÉCOULÉ, lui, est un fait (ouverture → maintenant) ;
//   · pas de Pause : le moteur ne sait pas suspendre une tâche. « Arrêter »
//     existe (`POST /api/tasks/:id/cancel`) et demande confirmation.

import { useState } from 'react';
import { cancelTask } from '../api';
import { getReview } from '../views/shared';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { formatDuree, GesteIrreversible } from '../ui';
import { Icone } from './Icone';
import type { NomIcone } from './Icone';
import { enVol, pourcentage } from './mission-courante';
import type { MissionAffichee, StatutMissionAffiche } from './mission-courante';

export function libelleStatut(s: StatutMissionAffiche, t: Translate): string {
  switch (s) {
    case 'execution':
      return t('En exécution', 'Running');
    case 'attente_agent':
      return t('En attente d’un agent', 'Waiting for an agent');
    case 'attente':
      return t('En attente', 'Queued');
    case 'a_valider':
      return t('À valider', 'Needs review');
    case 'reussie':
      return t('Terminée', 'Completed');
    case 'echouee':
      return t('Avec des échecs', 'With failures');
  }
}

export const TON_STATUT: Record<StatutMissionAffiche, 'ok' | 'encours' | 'attention' | 'echec'> = {
  execution: 'encours',
  attente_agent: 'attention',
  attente: 'encours',
  a_valider: 'attention',
  reussie: 'ok',
  echouee: 'echec',
};

interface Props {
  mission: MissionAffichee;
  titre: string | null;
  maintenant: number;
  /** La liste des missions a échoué (refus, Reine injoignable) : on le dit. */
  erreur: string | null;
  onVoirPlan: () => void;
  onVoirValidation: () => void;
  /** Le full auto du projet est allumé : les agents tranchent, la carte le dit. */
  fullAuto?: boolean;
  onVoirAutomatisations?: () => void;
}

export function CarteMission({
  mission,
  titre,
  maintenant,
  erreur,
  onVoirPlan,
  onVoirValidation,
  fullAuto = false,
  onVoirAutomatisations,
}: Props) {
  const t = useT();
  const [arret, setArret] = useState<string | null>(null);

  if (mission.etat === 'aucune') {
    return (
      <section className="hs-mission vide" aria-labelledby="hs-mission-titre">
        <span className="hs-mission-icone" aria-hidden="true">
          <Icone nom="missions" taille={26} />
        </span>
        <div className="hs-mission-corps">
          <p className="hs-surtitre">{t('Mission', 'Mission')}</p>
          <h2 id="hs-mission-titre">{t('Aucune mission en cours', 'No mission running')}</h2>
          <p className="hs-discret">
            {erreur
              ? t(
                  `L’historique des missions n’a pas pu être lu : ${erreur}`,
                  `Mission history could not be read: ${erreur}`,
                )
              : t(
                  'Décris ce que tu veux accomplir ci-dessus : Hive propose un plan, tu valides, les agents s’y mettent.',
                  'Describe what you want above: Hive proposes a plan, you approve, the agents get to work.',
                )}
          </p>
        </div>
      </section>
    );
  }

  const c = mission.compte;
  const pct = pourcentage(c);
  const statut = mission.statut ?? 'execution';
  const enVolIds = mission.taches.filter(enVol).map((x) => x.id);
  const depuis =
    mission.ouverteA !== null
      ? mission.closeA !== null
        ? t(
            `durée ${formatDuree(mission.closeA - mission.ouverteA)}`,
            `took ${formatDuree(mission.closeA - mission.ouverteA)}`,
          )
        : // ─── « DEPUIS 0 MS » ───────────────────────────────────────────────
          // Mesuré en E2E réel : une mission lancée APRÈS le dernier tic de
          // l'horloge s'affichait « depuis 0 ms » (écart négatif, borné à 0).
          // Les premières secondes se disent « à l'instant ».
          maintenant - mission.ouverteA < 5_000
          ? t('à l’instant', 'just now')
          : t(
              `depuis ${formatDuree(maintenant - mission.ouverteA)}`,
              `for ${formatDuree(maintenant - mission.ouverteA)}`,
            )
      : null;

  const arreter = async () => {
    setArret(null);
    const refus: string[] = [];
    for (const id of enVolIds) {
      try {
        await cancelTask(id);
      } catch (e) {
        refus.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (refus.length > 0) {
      setArret(
        t(
          `${refus.length} tâche(s) n’ont pas pu être arrêtées : ${refus[0]}`,
          `${refus.length} task(s) could not be stopped: ${refus[0]}`,
        ),
      );
    }
  };

  const aValider = mission.taches.filter(
    (x) => x.status === 'done' && getReview(x.id) === null,
  ).length;

  const icone: NomIcone =
    statut === 'reussie' ? 'coche' : statut === 'echouee' ? 'avertissement' : 'missions';

  return (
    <section className={`hs-mission ton-${TON_STATUT[statut]}`} aria-labelledby="hs-mission-titre">
      <span className="hs-mission-icone" aria-hidden="true">
        <Icone nom={icone} taille={26} />
      </span>
      <div className="hs-mission-corps">
        <div className="hs-mission-ligne">
          <div className="hs-mission-titres">
            <p className="hs-surtitre">
              {mission.etat === 'en_cours'
                ? t('Mission en cours', 'Current mission')
                : t('Dernière mission', 'Last mission')}
            </p>
            <h2 id="hs-mission-titre" title={titre ?? undefined}>
              {titre ?? t('Mission sans titre', 'Untitled mission')}
            </h2>
          </div>
          <div className="hs-mission-meta">
            <span className={`hs-pastille ton-${TON_STATUT[statut]}`}>
              <span className="hs-point" aria-hidden="true" />
              {libelleStatut(statut, t)}
            </span>
            {depuis && (
              <span className="hs-pastille neutre">
                <Icone nom="horloge" taille={14} />
                {depuis}
              </span>
            )}
            {fullAuto && (
              <button
                type="button"
                className="hs-pastille cliquable hs-pastille-full-auto"
                onClick={onVoirAutomatisations}
                title={t(
                  'Les agents valident et corrigent eux-mêmes — voir les automatisations',
                  'Agents approve and fix their own work — see automations',
                )}
              >
                <Icone nom="etincelles" taille={14} />
                {t('Full auto', 'Full auto')}
              </button>
            )}
            {/* « À valider » dit l'état ; le geste est un VRAI bouton, avec son
                compte — il ressemblait à une pastille de plus. Allumé, le full
                auto tranche : le geste n'a plus lieu d'être. */}
            {statut === 'a_valider' && !fullAuto && (
              <button type="button" className="hs-btn petit primaire" onClick={onVoirValidation}>
                {aValider > 0
                  ? t(`Valider (${aValider})`, `Review (${aValider})`)
                  : t('Valider', 'Review')}
              </button>
            )}
            {mission.etat === 'en_cours' && enVolIds.length > 0 && (
              <GesteIrreversible
                libelle={t('Arrêter', 'Stop')}
                ariaLabel={t('Arrêter la mission', 'Stop the mission')}
                question={t(
                  `Arrêter les ${enVolIds.length} tâche(s) encore en vol ? Les agents abandonnent leur travail en cours.`,
                  `Stop the ${enVolIds.length} task(s) still in flight? Agents drop their work in progress.`,
                )}
                confirmer={t('Arrêter', 'Stop')}
                onConfirmer={() => void arreter()}
              />
            )}
            <button
              type="button"
              className="hs-icone-btn"
              onClick={onVoirPlan}
              aria-label={t('Voir le plan de la mission', 'See the mission plan')}
              title={t('Voir le plan', 'See the plan')}
            >
              <Icone nom="chevronBas" />
            </button>
          </div>
        </div>
        <div className="hs-progression">
          <div
            className="hs-barre"
            role="progressbar"
            aria-label={t('Tâches terminées', 'Tasks done')}
            aria-valuemin={0}
            aria-valuemax={c.total}
            aria-valuenow={c.faites}
            aria-valuetext={t(
              `${c.faites} sur ${c.total} tâches terminées`,
              `${c.faites} of ${c.total} tasks done`,
            )}
          >
            <span style={{ width: `${pct ?? 0}%` }} />
            {c.echouees > 0 && (
              <span
                className="echec"
                style={{ width: `${(100 * c.echouees) / Math.max(1, c.total)}%` }}
              />
            )}
          </div>
          <span className="hs-progression-chiffres">
            <strong>{pct === null ? '—' : `${pct} %`}</strong>
            <span className="hs-discret">
              {t(`${c.faites}/${c.total} tâches`, `${c.faites}/${c.total} tasks`)}
              {c.enCours > 0 && t(` · ${c.enCours} en cours`, ` · ${c.enCours} running`)}
              {c.echouees > 0 && t(` · ${c.echouees} en échec`, ` · ${c.echouees} failed`)}
            </span>
          </span>
        </div>
        {arret && (
          <p className="hs-alerte erreur" role="alert">
            {arret}
          </p>
        )}
      </div>
    </section>
  );
}
