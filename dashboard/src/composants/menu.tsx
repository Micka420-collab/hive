// LE MENU DÉROULANT — le motif WAI-ARIA « menu button ».
//
// Un bouton qui ouvre une courte liste d'actions ou de choix (le thème, un
// tri, « plus d'actions »). Le contrat :
//
//   · le bouton dit qu'il ouvre un menu (`aria-haspopup`) et s'il est ouvert
//     (`aria-expanded`) ;
//   · ouvert, le focus ENTRE dans le menu — sur le choix coché s'il y en a
//     un, sinon sur le premier ; ↑ ↓ circulent en bouclant et sautent les
//     éléments éteints, Début / Fin vont aux bords ;
//   · Entrée ou Espace choisit ; Échap ferme SANS choisir ; dans les deux cas
//     le focus REVIENT au bouton — un menu qui se ferme en laissant le focus
//     sur un élément démonté renvoie le clavier en haut de la page ;
//   · Tab, ou un clic ailleurs, ferme sans choisir ;
//   · des choix exclusifs (`coche` défini) sont des `menuitemradio`, avec
//     `aria-checked` : « Sombre, coché » plutôt qu'un « ✓ » que personne
//     n'entend.

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface ElementMenu {
  id: string;
  libelle: ReactNode;
  onChoisir: () => void;
  /** Défini = choix exclusif (radio) ; `true` = le choix courant. */
  coche?: boolean;
  desactive?: boolean;
}

export function Menu({
  declencheur,
  libelle,
  elements,
  className,
  testId,
}: {
  /** Ce que montre le bouton (texte, icône). */
  declencheur: ReactNode;
  /** Le nom accessible du bouton ET du menu — indispensable si `declencheur` est une icône. */
  libelle: string;
  elements: readonly ElementMenu[];
  className?: string;
  testId?: string;
}) {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLUListElement>(null);
  /** Où poser le focus à l'ouverture : l'indice, ou « le dernier ». */
  const departFocus = useRef<number | 'dernier'>(0);

  const items = (): HTMLElement[] =>
    [...(liste.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter(
      (el) => el.getAttribute('aria-disabled') !== 'true',
    );

  const fermer = (rendreLeFocus: boolean) => {
    setOuvert(false);
    if (rendreLeFocus) bouton.current?.focus();
  };

  const ouvrir = (depart: number | 'dernier') => {
    departFocus.current = depart;
    setOuvert(true);
  };

  // Le focus entre APRÈS le rendu : avant, la liste n'existe pas.
  useEffect(() => {
    if (!ouvert) return;
    const tous = items();
    const coche = tous.findIndex((el) => el.getAttribute('aria-checked') === 'true');
    const depart = departFocus.current;
    const cible =
      depart === 'dernier' ? tous.at(-1) : depart === 0 && coche >= 0 ? tous[coche] : tous[0];
    cible?.focus();

    // Un clic hors du bouton et du menu ferme — sans reprendre le focus : il
    // est déjà parti là où l'on a cliqué.
    const dehors = (e: PointerEvent) => {
      const cibleClic = e.target as Node | null;
      if (liste.current?.contains(cibleClic) || bouton.current?.contains(cibleClic)) return;
      setOuvert(false);
    };
    document.addEventListener('pointerdown', dehors);
    return () => document.removeEventListener('pointerdown', dehors);
  }, [ouvert]);

  const surBouton = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      ouvrir(e.key === 'ArrowUp' ? 'dernier' : 0);
    }
  };

  const surMenu = (e: KeyboardEvent<HTMLUListElement>) => {
    const tous = items();
    const i = tous.indexOf(document.activeElement as HTMLElement);
    const deplacer = (el: HTMLElement | undefined) => {
      e.preventDefault();
      el?.focus();
    };
    if (e.key === 'ArrowDown') deplacer(tous[(i + 1) % tous.length]);
    else if (e.key === 'ArrowUp') deplacer(tous[(i - 1 + tous.length) % tous.length]);
    else if (e.key === 'Home') deplacer(tous[0]);
    else if (e.key === 'End') deplacer(tous.at(-1));
    else if (e.key === 'Escape') {
      e.preventDefault();
      // Échap ne doit pas remonter : un dialogue ouvert dessous se fermerait aussi.
      e.stopPropagation();
      fermer(true);
    } else if (e.key === 'Tab') fermer(false);
  };

  const choisir = (el: ElementMenu) => {
    if (el.desactive) return;
    fermer(true);
    el.onChoisir();
  };

  const radio = elements.some((el) => el.coche !== undefined);

  return (
    <span className={`ds-menu${className ? ` ${className}` : ''}`}>
      <button
        ref={bouton}
        type="button"
        className="btn ghost ds-menu-bouton"
        aria-haspopup="menu"
        aria-expanded={ouvert}
        aria-controls={ouvert ? id : undefined}
        aria-label={libelle}
        data-testid={testId}
        onClick={() => (ouvert ? fermer(false) : ouvrir(0))}
        onKeyDown={surBouton}
      >
        {declencheur}
      </button>
      {ouvert && (
        <ul
          ref={liste}
          id={id}
          className="ds-menu-liste"
          role="menu"
          aria-label={libelle}
          onKeyDown={surMenu}
        >
          {elements.map((el) => (
            <li
              key={el.id}
              role={radio ? 'menuitemradio' : 'menuitem'}
              aria-checked={radio ? el.coche === true : undefined}
              aria-disabled={el.desactive || undefined}
              className="ds-menu-element"
              tabIndex={-1}
              onClick={() => choisir(el)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  choisir(el);
                }
              }}
            >
              {radio && (
                <span className="ds-menu-coche" aria-hidden="true">
                  {el.coche ? '●' : ''}
                </span>
              )}
              {el.libelle}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
