// Navigation globale de Mission Control.
//
// Le produit possède beaucoup d'outils, mais l'utilisateur ne pense pas en
// liste de treize écrans : il pilote, produit, observe, puis administre. Cette
// navigation rend cette hiérarchie explicite et partage le même composant entre
// le rail desktop et le tiroir mobile.

import { useEffect, useRef } from 'react';
import type { Translate, UiLang } from './i18n';
import type { ViewId } from './views/shared';
import { Sparkline } from './views/shared';
import {
  compteAffiche,
  phraseAlertes,
  porteLaPastille,
  type Pastille,
} from './views/pastille-alertes';

export type NavSection = 'piloter' | 'produire' | 'observer' | 'espace' | 'admin';

export interface NavItem {
  id: ViewId;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  key: string;
  section: NavSection;
  admin?: true;
}

const SECTIONS: ReadonlyArray<{
  id: NavSection;
  label: string;
  labelEn: string;
}> = [
  { id: 'piloter', label: 'Piloter', labelEn: 'Control' },
  { id: 'produire', label: 'Produire', labelEn: 'Build' },
  { id: 'observer', label: 'Observer', labelEn: 'Observe' },
  { id: 'espace', label: 'Votre espace', labelEn: 'Your space' },
  { id: 'admin', label: 'Administration', labelEn: 'Administration' },
];

/** Traits fins façon produit : lisibles à 22 px, sans emoji. */
function NavGlyph({ id }: { id: ViewId }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (id) {
    case 'ruche':
      return (
        <svg {...common}>
          <path d="M12 3.2 19.5 7.5v9L12 20.8 4.5 16.5v-9L12 3.2Z" />
        </svg>
      );
    case 'reine':
      return (
        <svg {...common}>
          <path d="M5 18h14l-1.2-8.2L14 12l-2-5-2 5-3.8-2.2L5 18Z" />
          <path d="M7 18h10v1.5H7V18Z" />
        </svg>
      );
    case 'miellerie':
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20H4V10.5Z" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case 'projets':
      return (
        <svg {...common}>
          <path d="M4 7.5h6l1.5 1.8H20V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V7.5Z" />
        </svg>
      );
    case 'essaim':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="2.2" />
          <circle cx="16" cy="9" r="2.2" />
          <circle cx="12" cy="16" r="2.2" />
          <path d="M9.7 10.4 11 14.2M14.3 10.4 13 14.2" />
        </svg>
      );
    case 'sante':
      return (
        <svg {...common}>
          <path d="M4 12h3.2l1.6-3.5 2.4 7 2-4.2H20" />
        </svg>
      );
    case 'chronique':
      return (
        <svg {...common}>
          <path d="M7 5h12v14H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="M9 9h7M9 12.5h7M9 16h4" />
        </svg>
      );
    case 'memoire':
      return (
        <svg {...common}>
          <path d="M6 5.5h9.5A2.5 2.5 0 0 1 18 8v11H8.5A2.5 2.5 0 0 1 6 16.5v-11Z" />
          <path d="M6 16.5h9.5" />
        </svg>
      );
    case 'rayon':
      return (
        <svg {...common}>
          <path d="M8 4.5h8v5H8zM4.5 11h6.5v8.5H4.5zM13 11h6.5v8.5H13z" />
        </svg>
      );
    case 'monespace':
      return (
        <svg {...common}>
          <circle cx="12" cy="9" r="3.2" />
          <path d="M5.5 19c1.6-3.2 4-4.8 6.5-4.8S16.9 15.8 18.5 19" />
        </svg>
      );
    case 'chantiers':
      return (
        <svg {...common}>
          <path d="M14.5 5.5 18.5 9.5 10 18H6v-4L14.5 5.5Z" />
          <path d="M12.8 7.2 16.8 11.2" />
        </svg>
      );
    case 'intendance':
      return (
        <svg {...common}>
          <path d="M12 3.5 19 6.5v5.2c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6.5L12 3.5Z" />
        </svg>
      );
    case 'cerveau':
      return (
        <svg {...common}>
          <path d="M9 7.2a3 3 0 0 1 6 0c1.6.4 2.7 1.8 2.7 3.5 0 1.4-.8 2.6-2 3.2v3.6H8.3v-3.6c-1.2-.6-2-1.8-2-3.2 0-1.7 1.1-3.1 2.7-3.5Z" />
          <path d="M10 17.5h4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
  }
}

function HiveLogo() {
  return (
    <span className="brand-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7L12 2.2Z" fill="currentColor" />
        <path d="M12 6.2 16.8 9v6L12 17.8 7.2 15V9L12 6.2Z" fill="var(--encre)" fillOpacity="0.9" />
      </svg>
    </span>
  );
}

interface Props {
  items: readonly NavItem[];
  current: ViewId;
  lang: UiLang;
  t: Translate;
  onNavigate: (id: ViewId) => void;
  pendingReviews: number;
  pastille: Pastille | null;
  beatValues: number[];
  successRate: number | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function ShellNavigation({
  items,
  current,
  lang,
  t,
  onNavigate,
  pendingReviews,
  pastille,
  beatValues,
  successRate,
  mobileOpen,
  onMobileClose,
}: Props) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, [mobileOpen]);

  const aller = (id: ViewId) => {
    onNavigate(id);
    onMobileClose();
  };

  return (
    <>
      <button
        type="button"
        className={`mc-nav-scrim${mobileOpen ? ' open' : ''}`}
        aria-label={t('Fermer la navigation', 'Close navigation')}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={onMobileClose}
      />
      <nav
        ref={navRef}
        id="mc-primary-navigation"
        className={`mc-sidebar${mobileOpen ? ' mobile-open' : ''}`}
        aria-label={t('Navigation principale', 'Main navigation')}
      >
        <div className="mc-sidebar-head">
          <div className="mc-sidebar-brand" title="Hive — Mission Control">
            <HiveLogo />
            <span className="mc-sidebar-brand-copy">
              <span className="mc-sidebar-word">Hive</span>
              <span className="mc-sidebar-product">Mission Control</span>
            </span>
          </div>
          <button
            type="button"
            className="mc-sidebar-close"
            onClick={onMobileClose}
            aria-label={t('Fermer la navigation', 'Close navigation')}
          >
            ×
          </button>
        </div>

        <div className="mc-nav-scroll">
          {SECTIONS.map((section) => {
            const sectionItems = items.filter((item) => item.section === section.id);
            if (sectionItems.length === 0) return null;
            const titreId = `mc-nav-${section.id}`;
            return (
              <section className="mc-nav-section" key={section.id} aria-labelledby={titreId}>
                <h2 className="mc-nav-section-title" id={titreId}>
                  {lang === 'fr' ? section.label : section.labelEn}
                </h2>
                <ul className="mc-nav">
                  {sectionItems.map((item) => {
                    const label = lang === 'fr' ? item.label : item.labelEn;
                    const description = lang === 'fr' ? item.description : item.descriptionEn;
                    const aide = `${label} — ${description} (${t('touche', 'key')} ${item.key})`;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`mc-nav-cell${current === item.id ? ' active' : ''}`}
                          onClick={() => aller(item.id)}
                          title={`${label} (${t('touche', 'key')} ${item.key})`}
                          aria-label={aide}
                          aria-current={current === item.id ? 'page' : undefined}
                        >
                          <span className="mc-nav-icon" aria-hidden="true">
                            <NavGlyph id={item.id} />
                          </span>
                          <span className="mc-nav-copy">
                            <span className="mc-nav-label">{label}</span>
                            <span className="mc-nav-description">{description}</span>
                          </span>
                          {porteLaPastille(item.id, pastille) && (
                            <span
                              className={`mc-nav-badge mc-nav-badge--${pastille.gravite}`}
                              data-gravite={pastille.gravite}
                              aria-label={phraseAlertes(pastille, lang)}
                              title={phraseAlertes(pastille, lang)}
                            >
                              {compteAffiche(pastille.total)}
                            </span>
                          )}
                          {item.id === 'miellerie' && pendingReviews > 0 && (
                            <span
                              className="mc-nav-badge"
                              aria-label={`${pendingReviews} ${t(
                                'production(s) à revoir',
                                'production(s) to review',
                              )}`}
                              title={`${pendingReviews} ${t(
                                'production(s) à revoir',
                                'production(s) to review',
                              )}`}
                            >
                              {pendingReviews > 99 ? '99+' : pendingReviews}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>

        <div
          className="mc-sidebar-pulse"
          title={t('Pouls de la ruche (débit/h)', 'Hive pulse (throughput/h)')}
        >
          <span className="mc-sidebar-pulse-label">{t('Santé de la ruche', 'Hive health')}</span>
          <span className="mc-sidebar-pulse-value">
            <Sparkline values={beatValues} width={64} height={22} beat />
            <span className="mc-pulse-rate">
              {successRate === null ? '—' : `${Math.round(successRate * 100)}%`}
            </span>
          </span>
        </div>
      </nav>
    </>
  );
}
