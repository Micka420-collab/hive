// Vue Marketplace — les projets OUVERTS à la ruche, et la porte pour en rejoindre un.
//
// ─── CE QUE CETTE PAGE EST, ET CE QU'ELLE N'EST PAS ──────────────────────────
//
// La maquette validée (#579) range une entrée « Marketplace » dans le rail.
// Ce que la ruche sait faire derrière ce mot, aujourd'hui, c'est ceci : lister
// les projets que leurs propriétaires ont rendus publics
// (`GET /api/projects/public`, sans authentification, projection
// `vuePublique` — ni `repoUrl` porteur d'identifiants, ni propriétaire) et en
// rejoindre un avec son compte (`POST /api/projects/:id/join`).
//
// Pas de catalogue d'agents ni de modèles payants : rien de tel n'existe dans
// la ruche, et cette page ne fait pas semblant. La carte est celle de la page
// Projets (`ProjetsOuverts`), qui sait déjà dire un refus sans le traduire en
// « vous n'avez pas le droit » (le serveur répond 404, exprès).

import { EVENT_OUVRIR_COMPTE } from '../AccountPanel';
import { useT } from '../i18n';
import { ProjetsOuverts } from './Projets';
import type { ViewProps } from './shared';

export default function Marketplace({ snapshot, user, onNavigate }: ViewProps) {
  const t = useT();
  return (
    <div className="mc-view hs-marketplace">
      <p className="hs-discret">
        {t(
          'Les projets que leurs propriétaires ont ouverts à la ruche. Rejoignez-en un : ses tâches apparaissent dans vos projets, et vos agents peuvent y travailler.',
          'Projects their owners opened to the hive. Join one: its tasks show up in your projects, and your agents can work on it.',
        )}
      </p>
      {user ? (
        <ProjetsOuverts
          user={user}
          dejaVus={new Set(snapshot.projects.map((p) => p.id))}
          onRejoint={() => onNavigate('projets')}
        />
      ) : (
        <div className="hs-alerte info">
          <p>
            {t(
              'Rejoindre un projet demande un compte : le jeton de ruche ne dit pas qui vous êtes, et un projet inscrit des personnes, pas des jetons.',
              'Joining a project requires an account: the hive token does not say who you are, and a project enrols people, not tokens.',
            )}
          </p>
          <button
            type="button"
            className="hs-btn primaire"
            onClick={() => window.dispatchEvent(new Event(EVENT_OUVRIR_COMPTE))}
          >
            {t('Se connecter', 'Sign in')}
          </button>
        </div>
      )}
    </div>
  );
}
