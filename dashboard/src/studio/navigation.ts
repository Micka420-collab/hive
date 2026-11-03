// Le rail de Hive Studio : SEPT entrées, et chaque vue existante y a sa place.
//
// ─── LA RÈGLE QUE CE MODULE PORTE ────────────────────────────────────────────
//
// Une seule navigation (issue #579). Les quatorze vues de Mission Control ne
// disparaissent pas : elles se RANGENT sous sept sections, et la section
// courante les offre en onglets, dans la page — une sous-navigation de
// contexte, pas une seconde barre globale. Chaque adresse (`#/miellerie`…) et
// chaque touche (`3`…) continuent de mener au même écran.
//
// Module PUR : aucune lecture du DOM, aucun état. `App.tsx` reste la source de
// vérité des vues et de leurs touches (la garde `vues-documentees` la lit).

import type { ViewId } from '../views/shared';

export type SectionId =
  'accueil' | 'projets' | 'missions' | 'agents' | 'equipe' | 'automatisations' | 'marketplace';

export interface Section {
  readonly id: SectionId;
  readonly label: string;
  readonly labelEn: string;
  /** Première vue = celle qu'ouvre un clic sur la section. */
  readonly vues: readonly ViewId[];
}

export const SECTIONS: readonly Section[] = [
  { id: 'accueil', label: 'Accueil', labelEn: 'Home', vues: ['studio'] },
  { id: 'projets', label: 'Projets', labelEn: 'Projects', vues: ['projets', 'rayon'] },
  {
    id: 'missions',
    label: 'Missions',
    labelEn: 'Missions',
    vues: ['ruche', 'miellerie', 'chronique', 'warroom'],
  },
  {
    id: 'agents',
    label: 'Agents',
    labelEn: 'Agents',
    vues: ['essaim', 'reine', 'sante', 'memoire', 'cerveau', 'chambre'],
  },
  { id: 'equipe', label: 'Équipe', labelEn: 'Team', vues: ['monespace', 'intendance'] },
  {
    id: 'automatisations',
    label: 'Automatisations',
    labelEn: 'Automations',
    vues: ['chantiers'],
  },
  { id: 'marketplace', label: 'Marketplace', labelEn: 'Marketplace', vues: ['marketplace'] },
];

/** Vues d'administration : l'onglet n'est offert qu'aux admins (le serveur refuse de toute façon). */
export const VUES_ADMIN: ReadonlySet<ViewId> = new Set<ViewId>(['intendance', 'cerveau']);

/**
 * Vues sans onglet propre : on y ENTRE depuis un autre écran (la Chambre,
 * depuis la fiche d'un nœud — ADR 0010). L'onglet n'apparaît que lorsqu'on y est.
 */
export const VUES_SANS_ONGLET: ReadonlySet<ViewId> = new Set<ViewId>(['chambre']);

const PAR_VUE = new Map<ViewId, SectionId>();
for (const s of SECTIONS) for (const v of s.vues) PAR_VUE.set(v, s.id);

export function sectionDeVue(vue: ViewId): SectionId {
  return PAR_VUE.get(vue) ?? 'accueil';
}

export function section(id: SectionId): Section {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!;
}

/** Les onglets à offrir pour la vue courante — la vue courante y est toujours. */
export function ongletsDe(vue: ViewId, admin: boolean): ViewId[] {
  const s = section(sectionDeVue(vue));
  return s.vues.filter(
    (v) => v === vue || ((!VUES_ADMIN.has(v) || admin) && !VUES_SANS_ONGLET.has(v)),
  );
}

/** La vue qu'ouvre un clic sur une section. */
export function vueDeSection(id: SectionId): ViewId {
  return section(id).vues[0]!;
}

/**
 * Le nom d'un onglet dans la nouvelle navigation. L'ancien nom n'est pas
 * perdu : il reste dans l'infobulle et dans la palette (Ctrl/Cmd+K), où
 * « Miellerie » trouve toujours la validation.
 */
export const NOM_ONGLET: Readonly<Record<ViewId, { fr: string; en: string }>> = {
  studio: { fr: 'Accueil', en: 'Home' },
  projets: { fr: 'Projets', en: 'Projects' },
  rayon: { fr: 'Code', en: 'Code' },
  ruche: { fr: 'Vue d’ensemble', en: 'Overview' },
  miellerie: { fr: 'Validation', en: 'Review' },
  chronique: { fr: 'Historique', en: 'History' },
  warroom: { fr: 'Débats', en: 'Debates' },
  essaim: { fr: 'Ouvrières', en: 'Workers' },
  reine: { fr: 'Reine', en: 'Queen' },
  sante: { fr: 'Santé', en: 'Health' },
  memoire: { fr: 'Mémoire', en: 'Memory' },
  cerveau: { fr: 'Cerveau', en: 'Brain' },
  chambre: { fr: 'Chambre', en: 'Room' },
  monespace: { fr: 'Mon espace', en: 'My space' },
  intendance: { fr: 'Intendance', en: 'Stewardship' },
  chantiers: { fr: 'Chantiers', en: 'Works' },
  marketplace: { fr: 'Projets publics', en: 'Public projects' },
};
