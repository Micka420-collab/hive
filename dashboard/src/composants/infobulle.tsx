// L'INFO-BULLE — ce que `title` promettait et ne tenait pas.
//
// Le tableau de bord explique beaucoup par `title="…"`. Or `title` ne
// s'affiche ni au clavier, ni au toucher, et la plupart des lecteurs d'écran
// ne le lisent pas : l'explication n'existait que pour une souris immobile.
//
// Le contrat (WCAG 1.4.13, « contenu au survol ou au focus ») :
//   · elle s'ouvre au survol ET au focus clavier ;
//   · elle est RELIÉE à son déclencheur (`aria-describedby`) : le lecteur
//     d'écran la lit avec lui ;
//   · Échap la ferme sans déplacer le focus ;
//   · on peut la survoler elle-même sans qu'elle disparaisse (l'enveloppe
//     porte le survol, pas seulement le déclencheur) ;
//   · elle ne contient rien d'interactif — sinon ce n'est plus une info-bulle
//     mais un menu, et c'est `Menu` qu'il faut.
//
// Le délai au survol évite qu'un passage de souris ne sème des bulles ; le
// focus, lui, est une intention : pas de délai.

import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

const DELAI_SURVOL_MS = 350;

export function Tooltip({
  texte,
  cote = 'haut',
  children,
}: {
  texte: ReactNode;
  cote?: 'haut' | 'bas';
  /** UN élément focalisable (bouton, lien) — il reçoit `aria-describedby`. */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const id = useId();
  const [ouverte, setOuverte] = useState(false);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);

  const annulerMinuterie = () => {
    if (minuterie.current !== null) clearTimeout(minuterie.current);
    minuterie.current = null;
  };
  const fermer = () => {
    annulerMinuterie();
    setOuverte(false);
  };

  useEffect(() => {
    if (!ouverte) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') fermer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ouverte]);

  // Démontée en attente : la minuterie ne doit pas rouvrir une bulle disparue.
  useEffect(() => annulerMinuterie, []);

  const decrit = [children.props['aria-describedby'], id].filter(Boolean).join(' ');

  return (
    <span
      className="ds-infobulle-ancre"
      onMouseEnter={() => {
        annulerMinuterie();
        minuterie.current = setTimeout(() => setOuverte(true), DELAI_SURVOL_MS);
      }}
      onMouseLeave={fermer}
      onFocus={() => {
        annulerMinuterie();
        setOuverte(true);
      }}
      onBlur={fermer}
    >
      {cloneElement(children, { 'aria-describedby': decrit })}
      <span
        id={id}
        role="tooltip"
        className={`ds-infobulle ds-infobulle--${cote}`}
        // Toujours dans le DOM : `aria-describedby` doit viser un élément qui
        // existe, bulle visible ou non. `hidden` la retire de l'écran.
        hidden={!ouverte}
      >
        {texte}
      </span>
    </span>
  );
}
