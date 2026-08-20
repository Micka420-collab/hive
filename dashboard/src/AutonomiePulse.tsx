// Pouls d’autonomie — une ligne sur la Ruche pour voir si le Plein Essaim
// tourne, est en pause, ou éteint. Clique → Projets (réglage Plein Essaim).

import { useEffect, useState } from 'react';
import { fetchEssaim } from './api';
import type { EtatEssaimUi, NiveauEssaim } from './api';
import { useT } from './i18n';
import type { ViewId } from './views/shared';

function libelleNiveau(n: NiveauEssaim, t: ReturnType<typeof useT>): string {
  switch (n) {
    case 'off':
      return t('éteint', 'off');
    case 'propose':
      return t('propose', 'propose');
    case 'gouverne':
      return t('gouverne', 'govern');
    case 'plein':
      return t('plein', 'full');
    default:
      return n;
  }
}

interface Ligne {
  projectId: string;
  nom: string;
  etat: EtatEssaimUi | null;
  erreur?: string;
}

export function AutonomiePulse({
  projets,
  onNavigate,
}: {
  projets: { id: string; name: string }[];
  onNavigate: (view: ViewId, selectedId?: string, opts?: { replace?: boolean }) => void;
}) {
  const t = useT();
  const [lignes, setLignes] = useState<Ligne[] | null>(null);

  useEffect(() => {
    let annulé = false;
    const cibles = projets.slice(0, 4);
    setLignes(null);
    void Promise.all(
      cibles.map(async (p) => {
        try {
          const etat = await fetchEssaim(p.id);
          return { projectId: p.id, nom: p.name, etat } satisfies Ligne;
        } catch (e) {
          return {
            projectId: p.id,
            nom: p.name,
            etat: null,
            erreur: e instanceof Error ? e.message : String(e),
          } satisfies Ligne;
        }
      }),
    ).then((r) => {
      if (!annulé) setLignes(r);
    });
    return () => {
      annulé = true;
    };
  }, [projets]);

  if (projets.length === 0) return null;

  const affiche =
    lignes ?? projets.slice(0, 4).map((p) => ({ projectId: p.id, nom: p.name, etat: null }));

  return (
    <section className="autonomie-pulse" aria-label={t('Autonomie', 'Autonomy')}>
      <header className="autonomie-pulse-tete">
        <h3>{t('Plein Essaim', 'Full Swarm')}</h3>
        <p>
          {t('Autonomie du projet — clic pour régler.', 'Project autonomy — click to configure.')}
        </p>
      </header>
      <ul className="autonomie-pulse-liste">
        {affiche.map((l) => {
          const charge = lignes === null;
          const niv = l.etat?.niveau ?? 'off';
          const pause = l.etat?.runner?.enPause;
          const runnerOff = l.etat?.runner && l.etat.runner.mode !== 'on';
          const derive = l.etat?.derive.etat;
          return (
            <li key={l.projectId}>
              <button
                type="button"
                className={`autonomie-pulse-item autonomie-pulse-item--${niv}${charge ? ' autonomie-pulse-item--charge' : ''}`}
                onClick={() => onNavigate('projets', l.projectId)}
                disabled={charge}
              >
                <strong className="autonomie-pulse-nom">{l.nom}</strong>
                <span className="autonomie-pulse-niv">
                  {charge
                    ? t('…', '…')
                    : l.erreur
                      ? t('indispo', 'unavailable')
                      : libelleNiveau(niv, t)}
                </span>
                {l.erreur && !charge && (
                  <span className="autonomie-pulse-flag autonomie-pulse-flag--halte">
                    {t('hors ligne', 'offline')}
                  </span>
                )}
                {pause && <span className="autonomie-pulse-flag">{t('en pause', 'paused')}</span>}
                {runnerOff && !pause && (
                  <span className="autonomie-pulse-flag">{t('runner off', 'runner off')}</span>
                )}
                {derive === 'degradee' && (
                  <span className="autonomie-pulse-flag autonomie-pulse-flag--halte">
                    {t('dérive', 'drift')}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
