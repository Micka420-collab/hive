// LA BARRE DE FILTRE DES TRAVAUX — le même contrôle sur les Projets, la file
// de revue de la Miellerie et les Chantiers.
//
// Un seul composant pour trois écrans, pour que « chercher » s'y apprenne une
// fois : même place (en tête), mêmes libellés, même « Effacer les filtres »,
// même compte annoncé. Chaque écran ne passe que les dimensions qui ont un
// sens chez lui — les Chantiers n'ont ni famille d'agent ni ouvrière, et la
// barre ne leur offre pas un choix qui ne pourrait rien trier.
//
// La règle de tri, elle, vit dans `filtre-travaux.ts` (pure, éprouvée par la
// suite racine) ; ce composant ne fait que la saisie.
//
// Les contrôles sont ceux du design system (`Input`, `Select`) : libellés
// réels, focus visibles, deux thèmes — rien de réécrit ici.

import { useId, useMemo } from 'react';
import { libelleAgent } from '../../../src/shared/agent-libelle';
import type { HiveNode, TaskStatus } from '../../../src/shared/types';
import { Input, Select } from '../composants';
import type { OptionChoix } from '../composants';
import { useLang, useT } from '../i18n';
import { statusLabel } from '../ui';
import { FILTRE_VIDE, filtreActif } from './filtre-travaux';
import type { FiltreTravaux as Filtre } from './filtre-travaux';
import './filtre-travaux.css';

/** La valeur « toutes » d'un choix : `''` côté `<select>`, `null` côté filtre. */
const TOUS = '';

export function FiltreTravaux({
  filtre,
  onChange,
  statuts,
  familles,
  ouvrieres,
  compte,
  total,
  aideRecherche,
  libelleStatut,
}: {
  filtre: Filtre;
  onChange: (f: Filtre) => void;
  /** Absents : la dimension n'est pas offerte sur cet écran. */
  statuts?: readonly OptionChoix[];
  familles?: readonly OptionChoix[];
  ouvrieres?: readonly OptionChoix[];
  /** Ce qui reste à l'écran, et sur combien — annoncé à chaque changement. */
  compte: number;
  total: number;
  /** Ce que la recherche parcourt, dit sous le champ. */
  aideRecherche: string;
  /** Le nom du choix de statut quand ce n'en est pas un (« Nature » des chantiers). */
  libelleStatut?: string;
}) {
  const t = useT();
  const idCompte = useId();
  const idRecherche = useId();
  const actif = filtreActif(filtre);
  const choix = (options: readonly OptionChoix[], tous: string): OptionChoix[] => [
    { valeur: TOUS, libelle: tous },
    ...options,
  ];
  const valeur = (v: string | null) => v ?? TOUS;
  const lire = (v: string) => (v === TOUS ? null : v);
  return (
    <div
      className="card ft-barre"
      role="search"
      aria-label={t('Filtrer les travaux', 'Filter the work')}
    >
      <div className="ft-champs">
        <Input
          type="search"
          id={idRecherche}
          className="ft-recherche"
          libelle={t('Rechercher', 'Search')}
          aide={aideRecherche}
          value={filtre.texte}
          onChange={(e) => onChange({ ...filtre, texte: e.target.value })}
          aria-describedby={idCompte}
          spellCheck={false}
          autoComplete="off"
        />
        {statuts && (
          <Select
            libelle={libelleStatut ?? t('Statut', 'Status')}
            options={choix(statuts, t('Tous', 'All'))}
            value={valeur(filtre.statut)}
            onChange={(e) => onChange({ ...filtre, statut: lire(e.target.value) })}
          />
        )}
        {familles && (
          <Select
            libelle={t('Famille d’agent', 'Agent family')}
            options={choix(familles, t('Toutes', 'All'))}
            value={valeur(filtre.famille)}
            onChange={(e) => onChange({ ...filtre, famille: lire(e.target.value) })}
          />
        )}
        {ouvrieres && (
          <Select
            libelle={t('Ouvrière', 'Worker')}
            options={choix(ouvrieres, t('Toutes', 'All'))}
            value={valeur(filtre.ouvriere)}
            onChange={(e) => onChange({ ...filtre, ouvriere: lire(e.target.value) })}
          />
        )}
      </div>
      <p className="ft-compte">
        <span id={idCompte} aria-live="polite" data-testid="filtre-compte">
          {actif
            ? t(`${compte} sur ${total} affiché(s)`, `${compte} of ${total} shown`)
            : t(`${total} au total`, `${total} in all`)}
        </span>
        {actif && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onChange(FILTRE_VIDE);
              // Le bouton disparaît avec le filtre : sans ce renvoi, le focus
              // tombait sur <body> et le clavier repartait du haut de la page.
              document.getElementById(idRecherche)?.focus();
            }}
          >
            {t('Effacer les filtres', 'Clear filters')}
          </button>
        )}
      </p>
    </div>
  );
}

/** Les statuts d'une tâche, dans l'ordre de sa vie. */
const STATUTS_TACHE: readonly TaskStatus[] = [
  'pending',
  'ready',
  'assigned',
  'running',
  'done',
  'failed',
];

/**
 * Les choix « statut, famille, ouvrière » d'un écran de TÂCHES, tirés des
 * ouvrières inscrites. Une famille n'est offerte que si une ouvrière la porte :
 * proposer « Grok » à une ruche qui n'en a pas ne pourrait que vider l'écran.
 * `statuts` restreint la liste (la Miellerie ne revoit que done/failed).
 */
export function useOptionsTaches(
  noeuds: readonly HiveNode[],
  statuts: readonly TaskStatus[] = STATUTS_TACHE,
): { statuts: OptionChoix[]; familles: OptionChoix[]; ouvrieres: OptionChoix[] } {
  const lang = useLang();
  return useMemo(() => {
    const familles = [...new Set(noeuds.map((n) => n.agentType))].sort();
    return {
      statuts: statuts.map((s) => ({ valeur: s, libelle: statusLabel(s, lang) })),
      familles: familles.map((f) => ({ valeur: f, libelle: libelleAgent(f, lang === 'en') })),
      ouvrieres: [...noeuds]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => ({ valeur: n.id, libelle: n.name })),
    };
  }, [noeuds, statuts, lang]);
}
