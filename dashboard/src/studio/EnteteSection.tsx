// L'en-tête d'une section : où je suis, et les pages qu'elle regroupe.
//
// Le rail porte SEPT sections ; une section qui regroupe plusieurs pages les
// offre ici, en onglets — une sous-navigation de CONTEXTE, pas une seconde
// barre globale (#579). Chaque onglet est la page elle-même : son adresse
// (`#/miellerie`), sa touche (`3`), et son ancien nom en infobulle, pour qui
// cherchait « la Miellerie ».

import { useLang, useT } from '../i18n';
import type { ViewId } from '../views/shared';
import { section, sectionDeVue } from './navigation';
import type { VuePalette } from './Palette';

interface Props {
  vue: ViewId;
  /** Les onglets à offrir (`ongletsDe`), dans l'ordre de la section. */
  onglets: readonly VuePalette[];
  onNavigate: (vue: ViewId) => void;
  /** Une pastille par onglet, quand elle dit quelque chose (productions à valider…). */
  badges?: Partial<Record<ViewId, { n: number; titre: string }>>;
}

/** L'infobulle d'un onglet : son nom, l'ancien s'il a changé, sa touche. */
export function titreOnglet(v: VuePalette, anglais: boolean): string {
  const nom = anglais ? v.labelEn : v.label;
  const ancien = anglais ? v.ancienEn : v.ancien;
  const touche = v.key ? ` (${anglais ? 'key' : 'touche'} ${v.key})` : '';
  const avant =
    ancien && ancien !== nom ? (anglais ? ` — formerly ${ancien}` : ` — ex-${ancien}`) : '';
  return `${nom}${avant}${touche}`;
}

export function EnteteSection({ vue, onglets, onNavigate, badges = {} }: Props) {
  const t = useT();
  const lang = useLang();
  const anglais = lang === 'en';
  const s = section(sectionDeVue(vue));
  const nomSection = anglais ? s.labelEn : s.label;
  return (
    <div className="hs-entete-vue">
      <h1>{nomSection}</h1>
      {onglets.length > 1 && (
        <nav aria-label={t(`Pages de la section ${nomSection}`, `${nomSection} section pages`)}>
          <ul className="hs-onglets-vue">
            {onglets.map((o) => {
              const courant = o.id === vue;
              const badge = badges[o.id];
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    className="hs-onglet-vue"
                    data-vue={o.id}
                    aria-current={courant ? 'page' : undefined}
                    title={titreOnglet(o, anglais)}
                    onClick={() => onNavigate(o.id)}
                  >
                    {anglais ? o.labelEn : o.label}
                    {badge && badge.n > 0 && (
                      <span className="mc-nav-badge" title={badge.titre} aria-label={badge.titre}>
                        {badge.n > 99 ? '99+' : badge.n}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
