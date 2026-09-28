// LA CONFIGURATION DE LA RUCHE, EN UN ENCART — et le geste qui relance
// l'assistant de première arrivée.
//
// Monté dans la Santé (visible de tout porteur du jeton : sur une ruche sans
// compte, l'Intendance n'existe pas encore) et dans l'Intendance. Il ne
// s'affiche QUE pour qui peut écrire la configuration (`ecriture: 'permis'`) :
// proposer « Relancer l'assistant » à un membre, c'est lui promettre un geste
// que la Reine refusera.

import './premiere-arrivee.css';
import { useCallback, useEffect } from 'react';
import { fetchConfigurationInitiale } from './api';
import { useLang, useT } from './i18n';
import {
  EVENT_CONFIGURATION_CHANGEE,
  EVENT_PREMIERE_ARRIVEE,
  libelleGit,
  libelleMode,
  libelleSecrets,
} from './premiere-arrivee';
import { useApiPoll } from './views/shared';

export function EncartConfiguration({ refreshTick }: { refreshTick: number }) {
  const t = useT();
  const lang = useLang();
  const lire = useCallback(() => fetchConfigurationInitiale(), []);
  const { data, refresh } = useApiPoll(lire, 60_000, refreshTick);

  useEffect(() => {
    window.addEventListener(EVENT_CONFIGURATION_CHANGEE, refresh);
    return () => window.removeEventListener(EVENT_CONFIGURATION_CHANGEE, refresh);
  }, [refresh]);

  if (!data || data.ecriture !== 'permis') return null;
  const c = data.configuration;
  const ecarts = data.coherence.filter((d) => d.gravite !== 'ok');
  return (
    <section className="card encart-configuration" data-testid="encart-configuration">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" />{' '}
          {t('Configuration de la ruche', 'Hive configuration')}
        </h2>
      </header>
      <div className="encart-configuration-corps">
        <p className="muted-text">
          {c?.termineeA
            ? `${t('Arrêtée le', 'Set on')} ${new Date(c.termineeA).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR')} · ${[
                c.mode ? libelleMode(c.mode, t).titre : null,
                c.secrets ? libelleSecrets(c.secrets, t).titre : null,
                c.git ? libelleGit(c.git, t).titre : null,
              ]
                .filter((x): x is string => x !== null)
                .join(' · ')}`
            : t(
                'L’assistant de première arrivée n’a pas encore été mené au bout.',
                'The first-arrival assistant has not been completed yet.',
              )}
        </p>
        {ecarts.length > 0 && (
          <ul className="encart-configuration-ecarts">
            {ecarts.map((d) => (
              <li key={d.cle}>
                <span aria-hidden="true">⚠ </span>
                {d.constat}
                {d.reparation && (
                  <>
                    {' '}
                    <code>{d.reparation}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => window.dispatchEvent(new Event(EVENT_PREMIERE_ARRIVEE))}
        >
          {c?.termineeA
            ? t('Relancer l’assistant de première arrivée', 'Run the first-arrival assistant again')
            : t('Reprendre l’assistant de première arrivée', 'Resume the first-arrival assistant')}
        </button>
      </div>
    </section>
  );
}
