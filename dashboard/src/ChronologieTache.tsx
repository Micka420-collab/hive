// « Où est passé le temps » d'une tâche — phases relues dans le journal.
//
// Une phase dont un bord manque n'est pas affichée comme zéro : elle est tue
// (pas encore arrivée) ou dite « en cours ». La latence du modèle distant et le
// coût fournisseur viennent de ce que le CLI de l'agent DÉCLARE : le panneau
// les dit tels quels, avec « ≥ » et leur couverture quand une tentative s'est
// tue, et INCONNUS sans aucune déclaration — jamais déduits du temps Worker.

import { useEffect, useState } from 'react';
import { fetchChronologie } from './api';
import { useLang, useT } from './i18n';
import { direDuree } from '../../src/shared/horloge-chantier';
import type {
  ChronologieTache as Chronologie,
  SommeDeclaree,
} from '../../src/shared/chronologie-tache';
import { direUsd } from './ui';

interface Props {
  taskId: string;
  /** Change avec le statut de la tâche : le panneau se relit. */
  cle: string;
}

export function ChronologieTache({ taskId, cle }: Props) {
  const t = useT();
  const lang = useLang();
  const [c, setC] = useState<Chronologie | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setErreur(null);
    fetchChronologie(taskId)
      .then((r) => vivant && setC(r.chronologie))
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [taskId, cle]);

  const duree = (ms: number | null): string | null => (ms === null ? null : direDuree(ms, lang));
  const issue = (i: Chronologie['tentatives'][number]['issue']): string =>
    i === 'reussie'
      ? t('réussie', 'succeeded')
      : i === 'reprise'
        ? t('reprise', 'retried')
        : t('échec', 'failed');

  const declare = (s: SommeDeclaree, rendu: string): string =>
    s.declarees === s.tentatives
      ? t(`${rendu} — déclaré par le CLI de l’agent`, `${rendu} — declared by the agent CLI`)
      : t(
          `≥ ${rendu} — ${s.declarees}/${s.tentatives} tentative(s) déclarée(s)`,
          `≥ ${rendu} — ${s.declarees}/${s.tentatives} attempt(s) declared`,
        );

  const lignes: [string, string, string][] = [];
  if (c) {
    const ajouter = (id: string, libelle: string, valeur: string | null) => {
      if (valeur !== null) lignes.push([id, libelle, valeur]);
    };
    ajouter(
      'dependances',
      t('Attente des dépendances', 'Waiting for dependencies'),
      duree(c.attenteDependancesMs),
    );
    ajouter('worker', t('Attente d’un Worker', 'Waiting for a Worker'), duree(c.attenteWorkerMs));
    ajouter('demarrage', t('Démarrage', 'Start-up'), duree(c.demarrageMs));
    if (c.tentatives.length > 0) {
      const detail = c.tentatives
        .map(
          (x) =>
            `${issue(x.issue)}${x.dureeWorkerMs === null ? '' : ` ${direDuree(x.dureeWorkerMs, lang)}`}`,
        )
        .join(' · ');
      const total = duree(c.dureeWorkerTotaleMs);
      ajouter(
        'execution',
        t('Exécution (Worker)', 'Execution (Worker)'),
        total ? `${total} — ${detail}` : detail,
      );
    }
    if (c.reprises > 0) ajouter('reprises', t('Reprises', 'Retries'), String(c.reprises));
    if (c.corrections > 0) {
      ajouter(
        'corrections',
        t('Corrections demandées par l’Evaluator', 'Corrections requested by the Evaluator'),
        String(c.corrections),
      );
    }
    ajouter('revue', t('Revue croisée', 'Cross review'), duree(c.revueMs));
    ajouter(
      'total',
      t('Total', 'Total'),
      c.terminee ? duree(c.totalMs) : t('en cours', 'in progress'),
    );
  }

  return (
    <section
      className="chronologie-panel"
      aria-labelledby="chronologie-title"
      data-testid="chronologie-tache"
    >
      <h3 id="chronologie-title">{t('Où est passé le temps', 'Where the time went')}</h3>
      {erreur && (
        <p className="modal-error">
          {t('Chronologie indisponible :', 'Timeline unavailable:')} {erreur}
        </p>
      )}
      {!erreur && c === null && <p className="muted">{t('Lecture…', 'Loading…')}</p>}
      {c && (
        <dl className="chronologie">
          {lignes.map(([id, libelle, valeur]) => (
            <div key={id} data-phase={id}>
              <dt>{libelle}</dt>
              <dd>{valeur}</dd>
            </div>
          ))}
          <div data-phase="modele">
            <dt>{t('Durée côté modèle', 'Model-side duration')}</dt>
            {c.dureeModele === 'inconnu' ? (
              <dd className="muted">
                {t(
                  'inconnue — l’agent ne la déclare pas',
                  'unknown — the agent does not declare it',
                )}
              </dd>
            ) : (
              <dd>{declare(c.dureeModele, direDuree(c.dureeModele.total, lang))}</dd>
            )}
          </div>
          <div data-phase="cout">
            <dt>{t('Coût fournisseur', 'Provider cost')}</dt>
            {c.coutFournisseur === 'inconnu' ? (
              <dd className="muted">
                {t(
                  'inconnu — jamais estimé depuis le temps',
                  'unknown — never estimated from time',
                )}
              </dd>
            ) : (
              <dd>{declare(c.coutFournisseur, direUsd(c.coutFournisseur.total, lang))}</dd>
            )}
          </div>
        </dl>
      )}
    </section>
  );
}
