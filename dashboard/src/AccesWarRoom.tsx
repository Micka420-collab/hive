// L'accès à la War Room depuis la Ruche — et ce qui y attend quelqu'un.
//
// Une ligne sur le cockpit, dans la forme du pouls d'autonomie qu'elle suit :
// le NOMBRE de désaccords non résolus (un Conseil sans consensus que personne
// n'a tranché, une contestation dont le renvoi n'a pas eu lieu), et un clic
// pour y aller. Un désaccord qu'on ne voit qu'en ouvrant la bonne vue est un
// désaccord qu'on ne tranche pas.
//
// La lecture demande `limite: 0` : le compte seul, sans le fil — le cockpit
// n'a pas à relire tout le débat toutes les minutes. Un échec se dit
// « inconnu », jamais « aucun » : zéro désaccord et « je n'ai pas pu lire »
// sont deux situations opposées derrière le même chiffre.

import { fetchWarRoom } from './api';
import { useT } from './i18n';
import { useApiPoll } from './views/shared';
import type { ViewId } from './views/shared';

export function AccesWarRoom({
  refreshTick,
  onNavigate,
}: {
  refreshTick: number;
  onNavigate: (view: ViewId) => void;
}) {
  const t = useT();
  const poll = useApiPoll(() => fetchWarRoom({ limite: 0 }), 60_000, refreshTick);
  // L'ERREUR fait foi : `useApiPoll` garde la dernière réponse quand une
  // lecture échoue, et un compte d'il y a dix minutes relu sous un jeton
  // révoqué se lirait encore « aucun » alors que l'on ne sait plus rien.
  const n = poll.error ? null : (poll.data?.desaccords.length ?? null);

  const etat =
    n === null
      ? poll.error
        ? t('état inconnu', 'state unknown')
        : '…'
      : n === 0
        ? t('aucun désaccord en suspens', 'no pending disagreement')
        : t(`${n} désaccord(s) à trancher`, `${n} disagreement(s) to settle`);

  return (
    <section className="autonomie-pulse" aria-label="War Room">
      <header className="autonomie-pulse-tete">
        <h3>War Room</h3>
        <p>
          {t(
            'Là où les IA se contredisent — et où vous tranchez.',
            'Where the AIs contradict each other — and where you settle.',
          )}
        </p>
      </header>
      <button
        type="button"
        className="autonomie-pulse-item"
        data-testid="acces-war-room"
        onClick={() => onNavigate('warroom')}
      >
        <strong className="autonomie-pulse-nom">{t('Ouvrir', 'Open')}</strong>
        <span className="autonomie-pulse-niv">{etat}</span>
        {n !== null && n > 0 && (
          <span className="autonomie-pulse-flag autonomie-pulse-flag--halte">
            {t('à trancher', 'to settle')}
          </span>
        )}
      </button>
    </section>
  );
}
