// LES ONGLETS — le motif WAI-ARIA « tabs », une fois, correctement.
//
// Le tiroir d'une tâche et plusieurs vues posaient des rangées de boutons qui
// se comportaient en onglets sans le dire : Tab traversait CHAQUE onglet avant
// d'atteindre le contenu, les flèches ne faisaient rien, et le lecteur d'écran
// annonçait « bouton » sans dire lequel était ouvert.
//
// Le contrat du motif :
//   · `tablist` / `tab` / `tabpanel`, `aria-selected` sur l'onglet ouvert ;
//   · UN SEUL arrêt de tabulation pour toute la rangée (tabindex itinérant) :
//     l'onglet ouvert. Tab suivant = le contenu, pas l'onglet d'à côté ;
//   · ← → passent d'un onglet à l'autre (en bouclant, en sautant les éteints),
//     Début / Fin vont aux bords ; l'onglet atteint s'OUVRE (activation
//     automatique : les contenus ici sont déjà là, rien à charger) ;
//   · le panneau est focalisable : un panneau sans rien de tabulable dedans
//     resterait sinon hors d'atteinte du clavier.
//
// Contrôlé (`actif` + `onChange`) ou autonome (sans `actif`) — le second pour
// les usages où personne d'autre n'a besoin de savoir quel onglet est ouvert.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface Onglet {
  id: string;
  libelle: ReactNode;
  contenu: ReactNode;
  desactive?: boolean;
}

export function Tabs({
  onglets,
  actif,
  onChange,
  libelle,
}: {
  onglets: readonly Onglet[];
  /** L'onglet ouvert, si le parent le tient ; sinon le composant le tient. */
  actif?: string;
  onChange?: (id: string) => void;
  /** Le nom de la rangée — « Détails de la tâche » —, lu en y entrant. */
  libelle: string;
}) {
  const base = useId();
  const premier = onglets.find((o) => !o.desactive)?.id;
  const [interne, setInterne] = useState(premier);
  // L'onglet EFFECTIF : le demandé s'il existe et n'est pas éteint, sinon le
  // premier ouvrable. Un `actif` périmé (onglet retiré, éteint, mal nommé)
  // laissait sinon chaque onglet à `tabIndex=-1` et aucun panneau : une
  // rangée injoignable au clavier, et rien à l'écran pour le dire.
  const demande = actif ?? interne;
  const courant = onglets.some((o) => o.id === demande && !o.desactive) ? demande : premier;
  const boutons = useRef(new Map<string, HTMLButtonElement>());

  const ouvrir = (id: string) => {
    if (actif === undefined) setInterne(id);
    onChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const actifs = onglets.filter((o) => !o.desactive);
    const i = actifs.findIndex((o) => o.id === courant);
    const cible =
      e.key === 'ArrowRight'
        ? actifs[(i + 1) % actifs.length]
        : e.key === 'ArrowLeft'
          ? actifs[(i - 1 + actifs.length) % actifs.length]
          : e.key === 'Home'
            ? actifs[0]
            : e.key === 'End'
              ? actifs.at(-1)
              : undefined;
    if (cible === undefined) return;
    e.preventDefault();
    ouvrir(cible.id);
    boutons.current.get(cible.id)?.focus();
  };

  const ouvert = onglets.find((o) => o.id === courant);
  const idOnglet = (id: string) => `${base}-onglet-${id}`;
  const idPanneau = (id: string) => `${base}-panneau-${id}`;

  return (
    <div className="ds-onglets">
      <div className="ds-onglets-rangee" role="tablist" aria-label={libelle} onKeyDown={onKeyDown}>
        {onglets.map((o) => {
          const choisi = o.id === courant;
          return (
            <button
              key={o.id}
              ref={(el) => {
                if (el) boutons.current.set(o.id, el);
                else boutons.current.delete(o.id);
              }}
              type="button"
              role="tab"
              id={idOnglet(o.id)}
              className="ds-onglet"
              aria-selected={choisi}
              // Seul l'onglet ouvert pointe un panneau : les autres n'en ont
              // pas de monté, et un `aria-controls` vers un id absent est une
              // référence cassée.
              aria-controls={choisi ? idPanneau(o.id) : undefined}
              tabIndex={choisi ? 0 : -1}
              disabled={o.desactive}
              onClick={() => ouvrir(o.id)}
            >
              {o.libelle}
            </button>
          );
        })}
      </div>
      {ouvert && (
        <div
          className="ds-onglets-panneau"
          role="tabpanel"
          id={idPanneau(ouvert.id)}
          aria-labelledby={idOnglet(ouvert.id)}
          tabIndex={0}
        >
          {ouvert.contenu}
        </div>
      )}
    </div>
  );
}
