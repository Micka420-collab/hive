// Le rail de gauche — LA navigation de Hive Studio, et la seule.
//
// Sept sections (`navigation.ts`), les projets favoris, l'état de la ruche et
// la personne connectée. Repliable en icônes (le choix se retient), tiroir sur
// mobile. Les compteurs ne s'affichent que s'ils disent quelque chose : les
// productions à valider sur « Missions », les alertes de la personne sur
// « Équipe » — jamais un chiffre décoratif.

import type { ReactNode } from 'react';
import type { AuthUser } from '../api';
import { estAdmin } from '../api';
import { useLang, useT } from '../i18n';
import { compteAffiche, phraseAlertes, porteLaPastille } from '../views/pastille-alertes';
import type { Pastille } from '../views/pastille-alertes';
import { Sparkline } from '../views/shared';
import type { ViewId } from '../views/shared';
import type { HiveNode, Project, Task } from '../../../src/shared/types';
import { initiales } from './agents-vue';
import { useGestes } from './gestes';
import { Icone, MarqueHive } from './Icone';
import type { NomIcone } from './Icone';
import { SECTIONS, sectionDeVue, vueDeSection } from './navigation';
import type { SectionId } from './navigation';
import { CLES, ecrire, lireListe, usePreference } from './preferences';

const ICONE_SECTION: Record<SectionId, NomIcone> = {
  accueil: 'accueil',
  projets: 'projets',
  missions: 'missions',
  agents: 'agents',
  equipe: 'equipe',
  automatisations: 'automatisations',
  marketplace: 'marketplace',
};

interface Props {
  vue: ViewId;
  onNavigate: (vue: ViewId, id?: string) => void;
  projets: readonly Project[];
  taches: readonly Task[];
  noeuds: readonly HiveNode[];
  projetActif: Project | null;
  onChoisirProjet: (id: string) => void;
  user: AuthUser | null;
  /**
   * Se déconnecter depuis la carte du compte. Le bouton n'apparaît que sur
   * téléphone : ailleurs, la barre du haut porte déjà « Déconnexion », et le
   * rail n'en ferait qu'un doublon.
   */
  onDeconnexion?: () => void;
  aValider: number;
  /** Les alertes de la personne : la section qui porte « Mon espace » les montre. */
  pastille: Pastille | null;
  pouls: { valeurs: number[]; reussite: number | null };
  /** Le compagnon de la ruche (`Compagnon.tsx`) — il habite le rail, pas un calque. */
  compagnon?: ReactNode;
  version: string | null;
  compact: boolean;
  onBasculerCompact: () => void;
  /** Mobile : le rail est un tiroir ; un choix le referme. */
  onChoix?: () => void;
}

export function Rail(p: Props) {
  const t = useT();
  const lang = useLang();
  const gestes = useGestes();
  const favoris = usePreference(CLES.favoris, (v) => lireListe(v));
  const section = sectionDeVue(p.vue);

  const naviguer = (vue: ViewId, id?: string) => {
    p.onNavigate(vue, id);
    p.onChoix?.();
  };

  // Les favoris d'abord, puis les projets les plus actifs — cinq au plus.
  const activite = new Map<string, number>();
  for (const x of p.taches)
    activite.set(x.projectId, Math.max(activite.get(x.projectId) ?? 0, x.updatedAt));
  const enCours = new Set(
    p.taches
      .filter((x) => x.status === 'running' || x.status === 'assigned')
      .map((x) => x.projectId),
  );
  const projets = [...p.projets]
    .sort(
      (a, b) =>
        Number(favoris.includes(b.id)) - Number(favoris.includes(a.id)) ||
        (activite.get(b.id) ?? b.createdAt) - (activite.get(a.id) ?? a.createdAt),
    )
    .slice(0, 5);

  const basculerFavori = (id: string) =>
    ecrire(
      CLES.favoris,
      JSON.stringify(favoris.includes(id) ? favoris.filter((f) => f !== id) : [id, ...favoris]),
    );

  const enLigne = p.noeuds.filter((n) => n.status === 'online').length;
  const actives = p.taches.filter((x) => x.status === 'running' || x.status === 'assigned').length;

  return (
    <nav
      className={`mc-sidebar hs-rail${p.compact ? ' compact' : ''}`}
      aria-label={t('Navigation principale', 'Main navigation')}
    >
      <div className="mc-sidebar-brand hs-marque">
        <button
          type="button"
          className="hs-marque-btn"
          onClick={() => naviguer('studio')}
          title={t('Accueil', 'Home')}
        >
          <MarqueHive taille={34} />
          <span className="hs-marque-texte">
            <span className="hs-marque-nom">
              Hive Studio
              {p.version && <span className="hs-version">v{p.version}</span>}
            </span>
            <span className="hs-marque-sous">
              {t('Orchestration d’agents IA', 'AI agent orchestration')}
            </span>
          </span>
        </button>
      </div>

      <ul className="hs-sections">
        {SECTIONS.map((s) => {
          const actif = s.id === section;
          const alertes = s.vues.some((v) => porteLaPastille(v, p.pastille)) ? p.pastille : null;
          const aValider =
            s.id === 'missions' && p.aValider > 0
              ? t(`${p.aValider} production(s) à valider`, `${p.aValider} production(s) to review`)
              : null;
          const libelle = lang === 'fr' ? s.label : s.labelEn;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`hs-section${actif ? ' actif' : ''}`}
                aria-current={actif ? 'page' : undefined}
                data-section={s.id}
                // La page où la section mène : les captures et les bancs
                // énumèrent les pages depuis la navigation, sans liste à eux.
                data-vue={vueDeSection(s.id)}
                title={p.compact ? libelle : undefined}
                onClick={() => naviguer(vueDeSection(s.id))}
              >
                <Icone nom={ICONE_SECTION[s.id]} taille={20} />
                <span className="hs-section-nom">{libelle}</span>
                {alertes && (
                  <span
                    className={`mc-nav-badge mc-nav-badge--${alertes.gravite}`}
                    data-gravite={alertes.gravite}
                    aria-label={phraseAlertes(alertes, lang)}
                    title={phraseAlertes(alertes, lang)}
                  >
                    {compteAffiche(alertes.total)}
                  </span>
                )}
                {aValider && (
                  <span className="mc-nav-badge" title={aValider} aria-label={aValider}>
                    {p.aValider > 99 ? '99+' : p.aValider}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="hs-favoris">
        <div className="hs-favoris-tete">
          <Icone nom="etoile" taille={16} />
          <span>{t('Projets', 'Projects')}</span>
          <button
            type="button"
            className="hs-icone-btn petit"
            onClick={gestes.nouveauProjet}
            aria-label={t('Nouveau projet', 'New project')}
            title={t('Nouveau projet', 'New project')}
          >
            <Icone nom="plus" taille={16} />
          </button>
        </div>
        {projets.length === 0 ? (
          <p className="hs-discret hs-favoris-vide">{t('Aucun projet', 'No project')}</p>
        ) : (
          <ul>
            {projets.map((pr) => {
              const fav = favoris.includes(pr.id);
              const actif = p.projetActif?.id === pr.id;
              return (
                <li key={pr.id} className={actif ? 'actif' : undefined}>
                  <button
                    type="button"
                    className="hs-favori"
                    aria-current={actif ? 'true' : undefined}
                    title={pr.name}
                    onClick={() => {
                      p.onChoisirProjet(pr.id);
                      naviguer('studio');
                    }}
                  >
                    <span className="hs-favori-pastille" aria-hidden="true">
                      {initiales(pr.name)}
                    </span>
                    <span className="hs-favori-nom">{pr.name}</span>
                    {enCours.has(pr.id) && (
                      <span
                        className="hs-point ok"
                        title={t('Des tâches tournent', 'Tasks are running')}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`hs-icone-btn petit hs-etoile${fav ? ' pleine' : ''}`}
                    aria-pressed={fav}
                    aria-label={
                      fav
                        ? t(`Retirer ${pr.name} des favoris`, `Unpin ${pr.name}`)
                        : t(`Épingler ${pr.name}`, `Pin ${pr.name}`)
                    }
                    onClick={() => basculerFavori(pr.id)}
                  >
                    <Icone nom="etoile" taille={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="hs-rail-pied">
        {p.compagnon && <div className="hs-compagnon">{p.compagnon}</div>}
        <button
          type="button"
          className="hs-ruche-etat"
          onClick={() => naviguer('sante')}
          title={t('Santé de la ruche', 'Hive health')}
        >
          <span className="hs-ruche-etat-tete">
            <Icone nom="activite" taille={16} />
            <span>{t('Ruche', 'Hive')}</span>
            <span className="hs-ruche-taux">
              {p.pouls.reussite === null ? '—' : `${Math.round(p.pouls.reussite * 100)} %`}
            </span>
          </span>
          <span className="hs-ruche-etat-ligne">
            <span>
              {t(
                `${enLigne} agent(s) en ligne · ${actives} tâche(s) en cours`,
                `${enLigne} agent(s) online · ${actives} task(s) running`,
              )}
            </span>
          </span>
          {/* Un seul relevé ne trace rien : la courbe n'occupe sa place que
              quand elle a quelque chose à montrer (deux relevés au moins). */}
          {p.pouls.valeurs.length > 1 && (
            <Sparkline values={p.pouls.valeurs} width={160} height={22} beat />
          )}
        </button>

        <div className="hs-moi">
          <span className="hs-avatar grand" aria-hidden="true">
            {p.user ? (
              initiales(p.user.displayName || p.user.email)
            ) : (
              <Icone nom="equipe" taille={16} />
            )}
          </span>
          <span className="hs-moi-texte">
            <strong>
              {p.user ? p.user.displayName || p.user.email : t('Sans compte', 'No account')}
            </strong>
            <span className="hs-discret">
              {p.user
                ? estAdmin(p.user)
                  ? t('Administrateur', 'Administrator')
                  : t('Membre', 'Member')
                : t('Jeton de ruche', 'Hive token')}
            </span>
          </span>
          <button
            type="button"
            className="hs-icone-btn"
            onClick={gestes.ouvrirReglages}
            aria-label={t('Réglages', 'Settings')}
            title={t('Réglages', 'Settings')}
          >
            <Icone nom="reglages" />
          </button>
          {p.user && p.onDeconnexion && (
            <button
              type="button"
              className="hs-icone-btn hs-moi-sortie"
              onClick={p.onDeconnexion}
              aria-label={t('Se déconnecter', 'Sign out')}
              title={t(
                'Se déconnecter du compte (la ruche reste accessible)',
                'Sign out (the hive stays reachable)',
              )}
            >
              <Icone nom="sortir" />
            </button>
          )}
        </div>

        <button
          type="button"
          className="hs-replier"
          onClick={p.onBasculerCompact}
          aria-label={
            p.compact
              ? t('Déplier la navigation', 'Expand navigation')
              : t('Replier la navigation', 'Collapse navigation')
          }
          aria-expanded={!p.compact}
        >
          <Icone nom={p.compact ? 'chevronDroite' : 'chevronGauche'} taille={16} />
          <span>{t('Replier', 'Collapse')}</span>
        </button>
      </div>
    </nav>
  );
}
