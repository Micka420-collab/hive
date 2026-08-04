// Le panneau de l'Agent Garde-Fous — le réglage APPRIS du trou de vol d'un projet.
//
// PARTI PRIS D'INTERFACE, comme le Plein Essaim : ce panneau ne montre pas un
// simple interrupteur, il montre CE QUE LA RUCHE A APPRIS — le classement des
// échelons, échelon par échelon, avec la note et le nombre d'essais. L'humain ne
// pose pas un réglage à l'aveugle : il voit POURQUOI tel échelon gouverne, et il
// borne l'échelle dans laquelle la ruche a le droit de choisir (elle n'élargit
// jamais sa propre latitude — le méta garde-fou).
//
// Deux commandes distinctes : l'OPT-IN (la ruche apprend-elle pour ce projet ?)
// et les BORNES {min, max} de l'échelle. Séparées à dessein — activer n'est pas
// choisir la sévérité.

import { useCallback, useEffect, useState } from 'react';
import { fetchGardeFou, reglerGardeFou } from './api';
import type { EchelonUi, EtatGardeFouUi } from './api';
import { useT } from './i18n';

/** Rafraîchissement : le classement bouge quand le vécu de la ruche bouge. */
const PERIODE_MS = 5_000;

/**
 * Le SCORE UCB d'un échelon jamais essayé vaut `+∞` (l'exploration obligatoire).
 * `toFixed` en ferait « Infinity » ; on rend « ∞ », qui dit la vérité — cet
 * échelon N'A PAS ENCORE été éprouvé — sans mentir sur une valeur numérique.
 */
export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(2) : '∞';
}

/** Une moyenne dans [0, 1] rendue en pourcentage entier. */
export function formatMoyenne(moyenne: number): string {
  return `${Math.round(moyenne * 100)} %`;
}

/** Ce que chaque échelon COMMANDE, en une phrase — pour ne pas le deviner. */
export function descriptionEchelon(e: EchelonUi, t: ReturnType<typeof useT>): string {
  switch (e) {
    case 'leger':
      return t(
        'On annote et on cadre ; rien n’est jamais retenu.',
        'Annotate and frame; nothing is ever held back.',
      );
    case 'standard':
      return t(
        'Le trou de vol refuse le nectar creux, mais aucune contre-visite ne retient.',
        'The gate refuses hollow nectar, but no counter-review holds anything back.',
      );
    default:
      return t(
        'Le paquet complet : refus du creux ET contre-visite avant d’appliquer.',
        'The full package: hollow refused AND a counter-review before applying.',
      );
  }
}

/** Le nom affichable d'un échelon (l'identité, pas une traduction — c'est un terme). */
function nomEchelon(e: EchelonUi, t: ReturnType<typeof useT>): string {
  switch (e) {
    case 'leger':
      return t('léger', 'light');
    case 'standard':
      return t('standard', 'standard');
    default:
      return t('strict', 'strict');
  }
}

export function GardeFous({ projectId }: { projectId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<EtatGardeFouUi | null>(null);
  const [erreur, setErreur] = useState<string>('');
  const [occupe, setOccupe] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setEtat(await fetchGardeFou(projectId));
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

  const appliquer = async (r: {
    actif: boolean;
    borneMin: EchelonUi;
    borneMax: EchelonUi;
  }): Promise<void> => {
    setOccupe(true);
    try {
      await reglerGardeFou(projectId, r);
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
      <section className="garde-fou-panneau" aria-busy="true">
        {t('Chargement du Garde-Fous…', 'Loading the Guardrails…')}
      </section>
    );
  }

  const bornes = etat.bornes ?? { min: 'leger' as EchelonUi, max: 'strict' as EchelonUi };

  return (
    <section className="garde-fou-panneau">
      <h3>{t('Agent Garde-Fous', 'Guardrails Agent')}</h3>
      <p className="garde-fou-explication">
        {t(
          'La ruche apprend, pour ce projet, le meilleur réglage du trou de vol — le meilleur compromis, pas le plus strict.',
          'The hive learns, for this project, the best gate setting — the best trade-off, not the strictest.',
        )}
      </p>

      <label className="garde-fou-optin">
        <input
          type="checkbox"
          checked={etat.actif}
          disabled={occupe}
          onChange={() =>
            void appliquer({ actif: !etat.actif, borneMin: bornes.min, borneMax: bornes.max })
          }
        />
        {etat.actif
          ? t(
              'Actif — la ruche apprend et gouverne ce projet.',
              'Active — the hive learns and governs this project.',
            )
          : t('Inactif — réglage global, comme avant.', 'Inactive — global setting, as before.')}
      </label>

      <div className="garde-fou-bornes">
        <fieldset>
          <legend>{t('Borne basse', 'Lower bound')}</legend>
          {etat.echelons.map((e) => (
            <button
              key={`min-${e}`}
              type="button"
              disabled={occupe}
              aria-pressed={bornes.min === e}
              onClick={() =>
                void appliquer({ actif: etat.actif, borneMin: e, borneMax: bornes.max })
              }
            >
              {nomEchelon(e, t)}
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>{t('Borne haute', 'Upper bound')}</legend>
          {etat.echelons.map((e) => (
            <button
              key={`max-${e}`}
              type="button"
              disabled={occupe}
              aria-pressed={bornes.max === e}
              onClick={() =>
                void appliquer({ actif: etat.actif, borneMin: bornes.min, borneMax: e })
              }
            >
              {nomEchelon(e, t)}
            </button>
          ))}
        </fieldset>
      </div>

      {etat.actif && etat.echelonElu ? (
        <p className="garde-fou-elu">
          {t('Échelon élu : ', 'Elected echelon: ')}
          <strong>{nomEchelon(etat.echelonElu, t)}</strong>
          {' — '}
          {descriptionEchelon(etat.echelonElu, t)}
        </p>
      ) : (
        <p className="garde-fou-elu-vide">
          {t(
            'Aucun échelon élu — activez l’agent pour ce projet.',
            'No echelon elected — enable the agent for this project.',
          )}
        </p>
      )}

      {etat.classement.length > 0 && (
        <table className="garde-fou-classement">
          <thead>
            <tr>
              <th>{t('Échelon', 'Echelon')}</th>
              <th>{t('Moyenne', 'Average')}</th>
              <th>{t('Essais', 'Trials')}</th>
              <th>{t('Score', 'Score')}</th>
            </tr>
          </thead>
          <tbody>
            {etat.classement.map((r) => (
              <tr key={r.echelon} aria-current={r.echelon === etat.echelonElu ? 'true' : undefined}>
                <td>{nomEchelon(r.echelon, t)}</td>
                <td>{formatMoyenne(r.moyenne)}</td>
                <td>{r.essais}</td>
                <td>{formatScore(r.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {erreur && <p className="garde-fou-erreur">{erreur}</p>}
    </section>
  );
}
