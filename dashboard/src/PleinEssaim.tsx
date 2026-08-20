// Le bouton du Plein Essaim — allumer l'autonomie d'un projet.
//
// PARTI PRIS D'INTERFACE : ce panneau ne montre pas un interrupteur, il montre
// CE QUE LA RUCHE FERAIT MAINTENANT. Un bouton qui allume une gouvernance
// autonome sans dire son prochain geste demande une confiance qu'on n'a pas à
// demander — et il rend l'autonomie effrayante alors qu'elle est explicable.
//
// Deux commandes distinctes, et la séparation est le sujet :
//   · le NIVEAU, qui dit jusqu'où la ruche va toute seule ;
//   · l'INSCRIPTION DU DÉPÔT, qui est l'autorisation de fusionner, donnée une
//     fois. Les deux sont exigées ensemble pour qu'une fusion parte.
//
// Une case qui coche les deux d'un geste aurait fait passer l'autorisation
// d'écriture pour un détail du réglage. C'est exactement ce qu'il ne faut pas.

import { useCallback, useEffect, useState } from 'react';
import { fetchEssaim, setEssaim } from './api';
import type { EtatEssaimUi, NiveauEssaim, PasEssaim } from './api';
import { useT } from './i18n';

/** Rafraîchissement : la décision change quand l'état de la ruche change. */
const PERIODE_MS = 5_000;

function libellePas(pas: PasEssaim, t: ReturnType<typeof useT>): string {
  switch (pas) {
    case 'inerte':
      return t('En sommeil', 'Dormant');
    case 'halte':
      return t('Halte — la ruche se dégrade', 'Halt — the hive is degrading');
    case 'plafond':
      return t('Plafond atteint', 'Cap reached');
    case 'deliberer':
      return t('Délibérer', 'Deliberate');
    case 'planifier':
      return t('Planifier', 'Plan');
    case 'butiner':
      return t('Butiner', 'Forage');
    case 'corriger':
      return t('Corriger', 'Fix');
    case 'livrer':
      return t('Livrer', 'Deliver');
    case 'fusionner':
      return t('Fusionner', 'Merge');
    default:
      // Le dashboard est servi en fichiers statiques : ce navigateur peut
      // parler à un orchestrateur plus récent, qui connaît un pas de plus.
      // On rend alors son NOM BRUT — inélégant, mais vrai. Inventer un
      // libellé (« Repos ») afficherait une décision que la ruche n'a pas
      // prise, et c'est le pire mensonge possible sur cet écran.
      return pas;
  }
}

function iconePas(pas: PasEssaim): string {
  const icones: Record<PasEssaim, string> = {
    inerte: '○',
    halte: '■',
    plafond: '▣',
    deliberer: '◇',
    planifier: '▤',
    butiner: '⬡',
    corriger: '↺',
    livrer: '↑',
    fusionner: '⇄',
  };
  // `??` et pas un accès nu : un pas inconnu d'un serveur plus récent rendrait
  // `undefined`, donc une puce vide à côté d'un libellé bien présent.
  return icones[pas] ?? '•';
}

function libelleIndicateur(
  cle: 'qualite' | 'entropie' | 'repetition' | 'solitude',
  t: ReturnType<typeof useT>,
): string {
  switch (cle) {
    case 'qualite':
      return t('Qualité', 'Quality');
    case 'entropie':
      return t('Complexité', 'Complexity');
    case 'repetition':
      return t('Répétition', 'Repetition');
    default:
      return t('Solitude', 'Solitude');
  }
}

function descriptionNiveau(n: NiveauEssaim, t: ReturnType<typeof useT>): string {
  switch (n) {
    case 'off':
      return t('La ruche attend vos consignes.', 'The hive waits for your instructions.');
    case 'propose':
      return t(
        'Elle décide seule quoi faire et crée les tâches. Elle ne livre rien.',
        'It decides what to do and creates tasks on its own. It delivers nothing.',
      );
    case 'gouverne':
      return t(
        'Elle décide, produit, se critique et ouvre les pull requests. Rien n’est fusionné.',
        'It decides, produces, critiques itself and opens pull requests. Nothing is merged.',
      );
    default:
      return t(
        'Tout ce qui précède, et elle fusionne — sur les dépôts que vous avez inscrits.',
        'All of the above, and it merges — on the repositories you enrolled.',
      );
  }
}

export function PleinEssaim({ projectId }: { projectId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<EtatEssaimUi | null>(null);
  const [erreur, setErreur] = useState<string>('');
  const [occupe, setOccupe] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setEtat(await fetchEssaim(projectId));
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void recharger();
    const id = setInterval(() => void recharger(), PERIODE_MS);
    return () => clearInterval(id);
  }, [recharger]);

  const regler = async (niveau: NiveauEssaim, depotInscrit: boolean): Promise<void> => {
    setOccupe(true);
    try {
      await setEssaim(projectId, niveau, depotInscrit);
      await recharger();
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  if (!etat) {
    return (
      <section className="essaim-panneau">
        <h3>
          <span className="marque" aria-hidden="true" /> {t('Plein Essaim', 'Full Swarm')}
        </h3>
        <p className="essaim-vide">{erreur || t('Chargement…', 'Loading…')}</p>
      </section>
    );
  }

  const gouvernable = etat.gouvernantes.length >= etat.gouvernantesRequises;
  const systemiques = etat.lecons.filter((l) => l.portee === 'systemique');

  return (
    <section className="essaim-panneau">
      <h3>
        <span className="marque" aria-hidden="true" /> {t('Plein Essaim', 'Full Swarm')}
      </h3>
      <p className="essaim-intro">
        {t(
          'La ruche décide, produit, se critique et apprend — sans vous demander à chaque tour.',
          'The hive decides, produces, critiques itself and learns — without asking you each round.',
        )}
      </p>

      {/* Ce que la ruche ferait MAINTENANT. Le cœur du panneau. */}
      <div className={`essaim-pas essaim-pas--${etat.decision.pas}`}>
        <span className="essaim-pas-icone" aria-hidden="true">
          {iconePas(etat.decision.pas)}
        </span>
        <div>
          <strong>{libellePas(etat.decision.pas, t)}</strong>
          <span className="essaim-motif">{etat.decision.motif}</span>
        </div>
      </div>

      {/* CE QUE LA RUCHE FAIT DE CETTE DÉCISION — distinct du verdict, et
          affiché juste dessous parce que c'est là qu'on le cherche. Sans ces
          deux lignes, l'écran annoncerait « délibérer » sans que rien ne se
          passe, et personne ne saurait s'il faut attendre ou s'inquiéter. */}
      {etat.runner && etat.runner.mode !== 'on' && (
        <p className="essaim-runner essaim-runner--eteint">
          {t(
            'L’autonomie réelle est éteinte sur cette ruche : la décision ci-dessus est calculée, mais rien ne s’exécute. L’hôte l’allume avec HIVE_RUNNER=on.',
            'Real autonomy is switched off on this hive: the decision above is computed, but nothing runs. The host turns it on with HIVE_RUNNER=on.',
          )}
        </p>
      )}
      {etat.runner?.enPause && (
        <p className="essaim-runner essaim-runner--pause">
          {t(
            `La ruche a renoncé à ce projet après ${etat.runner.echecs} échecs de suite. Réglez à nouveau l’autonomie ci-dessous pour la faire repartir.`,
            `The hive gave up on this project after ${etat.runner.echecs} consecutive failures. Set the autonomy level again below to restart it.`,
          )}
        </p>
      )}

      {/* La Dérive : ce qui rend une autonomie de plusieurs semaines
          défendable — la ruche sait reconnaître qu'elle se dégrade. Affichée
          AVANT les réglages : on ne propose pas de monter le niveau
          d'autonomie d'une ruche qui est en train de pourrir le projet. */}
      <div className={`essaim-derive essaim-derive--${etat.derive.etat}`}>
        <span className="essaim-etiquette">
          {t('Santé du projet', 'Project health')}
          {etat.derive.echantillon > 0 && (
            <span className="essaim-echantillon">
              {t(
                ` · ${etat.derive.echantillon} production(s) observée(s)`,
                ` · ${etat.derive.echantillon} production(s) observed`,
              )}
            </span>
          )}
        </span>
        <ul>
          {etat.derive.indicateurs.map((i) => (
            <li key={i.cle} className={`essaim-ind essaim-ind--${i.etat}`}>
              <span className="essaim-ind-cle">{libelleIndicateur(i.cle, t)}</span>
              <span className="essaim-ind-constat">{i.constat}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Qui gouverne. Une caste se gagne : ce n'est pas configurable. */}
      <div className="essaim-gouv">
        <span className="essaim-etiquette">{t('Gouvernantes', 'Governing workers')}</span>
        {gouvernable ? (
          <span className="essaim-gouv-liste">
            {etat.gouvernantes.map((g) => g.nom).join(' · ')}
          </span>
        ) : (
          <span className="essaim-gouv-manque">
            {t(
              `${etat.gouvernantes.length} / ${etat.gouvernantesRequises} — aucune ouvrière n’a encore fait ses preuves. La ruche ne peut pas se gouverner.`,
              `${etat.gouvernantes.length} / ${etat.gouvernantesRequises} — no worker has proven itself yet. The hive cannot govern itself.`,
            )}
          </span>
        )}
      </div>

      {/* Les quatre niveaux. */}
      <div className="essaim-niveaux" role="group" aria-label={t('Niveau', 'Level')}>
        {etat.niveaux.map((n) => (
          <button
            key={n}
            type="button"
            disabled={occupe}
            aria-pressed={etat.niveau === n}
            className={etat.niveau === n ? 'essaim-niveau actif' : 'essaim-niveau'}
            onClick={() => void regler(n, etat.depotInscrit)}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="essaim-desc">{descriptionNiveau(etat.niveau, t)}</p>

      {/* L'autorisation de fusionner : SÉPARÉE du niveau, et donnée une fois. */}
      <label className="essaim-inscription">
        <input
          type="checkbox"
          checked={etat.depotInscrit}
          disabled={occupe}
          onChange={(e) => void regler(etat.niveau, e.target.checked)}
        />
        <span>
          {t(
            'J’autorise la ruche à fusionner sur ce dépôt, sans me redemander à chaque fois.',
            'I authorise the hive to merge into this repository, without asking me each time.',
          )}
        </span>
      </label>
      {etat.niveau === 'plein' && !etat.depotInscrit && (
        <p className="essaim-avert">
          {t(
            'Niveau « plein » sans dépôt autorisé : la ruche ouvrira les pull requests et les laissera vous attendre.',
            'Level "plein" without an authorised repository: the hive will open pull requests and leave them waiting for you.',
          )}
        </p>
      )}

      {/* Ce que la ruche a appris des erreurs de ses membres. */}
      {etat.lecons.length > 0 && (
        <div className="essaim-lecons">
          <span className="essaim-etiquette">
            {t('Ce que la ruche a appris', 'What the hive has learned')}
          </span>
          {systemiques.length > 0 && (
            <p className="essaim-avert">
              {t(
                `${systemiques.length} erreur(s) vue(s) sur plusieurs machines : elles viennent du code, pas d’une machine.`,
                `${systemiques.length} error(s) seen on several machines: they come from the code, not from one machine.`,
              )}
            </p>
          )}
          <ul>
            {etat.lecons.slice(0, 5).map((l) => (
              <li key={l.signature} className={`essaim-lecon essaim-lecon--${l.portee}`}>
                <span className="essaim-lecon-portee">
                  {l.portee === 'systemique'
                    ? t(`⚠ ${l.noeuds} machines`, `⚠ ${l.noeuds} machines`)
                    : l.portee === 'confirmee'
                      ? t(`${l.noeuds} machines`, `${l.noeuds} machines`)
                      : t('1 machine', '1 machine')}
                </span>
                <span className="essaim-lecon-extrait">{l.extrait}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {erreur && <p className="essaim-erreur">{erreur}</p>}
    </section>
  );
}
