// CE QUE L'ÉCRAN DU GRAPHE D'EXPÉRIENCE DIT — décidé ici, affiché là-bas.
//
// Le serveur ne rend que des faits typés : un genre, une origine, un verdict,
// un id d'événement. Les phrases se composent ICI, dans la langue de l'écran,
// comme partout dans Mission Control (aucune phrase figée en base). Et elles
// se composent dans un module pur, parce que ce sont des DÉCISIONS : dire
// « corrélation » et jamais « cause », « modèle commandé » et jamais « modèle
// utilisé » quand le CLI n'a rien déclaré. Une décision logée dans du JSX est
// une décision qu'aucun banc ne voit.
//
// Types STRUCTURELS pour la traduction, comme `projets-rendu.ts` : ce module ne
// tire rien vers le DOM.

import type {
  AreteExperience,
  GenreNoeud,
  NatureSavoir,
  NoeudExperience,
  Provenance,
  Relation,
} from '../../../src/shared/graphe-experience';

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

/** Le nom d'un genre de nœud — au pluriel, pour les filtres et les comptes. */
export function libelleGenre(genre: GenreNoeud, t: Traduire): string {
  switch (genre) {
    case 'project':
      return t('Projets', 'Projects');
    case 'mission':
      return t('Missions', 'Missions');
    case 'task':
      return t('Tâches', 'Tasks');
    case 'worker':
      return t('Ouvrières', 'Workers');
    case 'model_version':
      return t('Modèles', 'Models');
    case 'decision':
      return t('Décisions', 'Decisions');
    case 'review':
      return t('Revues', 'Reviews');
    case 'test':
      return t('Tests', 'Tests');
    case 'error':
      return t('Erreurs', 'Errors');
    case 'lesson':
      return t('Leçons', 'Lessons');
    case 'artifact':
      return t('Productions', 'Artifacts');
  }
}

/**
 * Ce qu'un nœud s'appelle à l'écran. Un nom venu des données (titre, projet,
 * ouvrière, modèle, leçon) est rendu tel quel — React l'échappe ; un nœud sans
 * nom propre se compose de ses faits.
 */
export function libelleNoeud(n: NoeudExperience, t: Traduire): string {
  switch (n.genre) {
    case 'artifact': {
      const quoi =
        n.resultId === null
          ? t('production (résultat non nommé)', 'artifact (unnamed result)')
          : t(`production r${n.resultId}`, `artifact r${n.resultId}`);
      const issue =
        n.issue === 'rendu'
          ? t(' — rendue', ' — delivered')
          : n.issue === 'echec'
            ? t(' — échouée', ' — failed')
            : '';
      return `${quoi}${issue}`;
    }
    case 'review': {
      const qui =
        n.origine === 'humaine'
          ? t('revue humaine', 'human review')
          : n.origine === 'contre_revue'
            ? t('contre-revue', 'counter-review')
            : t('Evaluator', 'Evaluator');
      const verdict = {
        approuve: t('approuvée', 'approved'),
        rejete: t('rejetée', 'rejected'),
        valide: t('validée', 'validated'),
        conteste: t('contestée', 'contested'),
        a_corriger: t('à corriger', 'correction required'),
      }[n.verdict];
      return `${qui} : ${verdict}`;
    }
    case 'test':
      return n.origine === 'ci'
        ? t(`tests (CI) : ${n.etat === 'passed' ? 'réussis' : 'échoués'}`, `tests (CI): ${n.etat}`)
        : t(
            `tests (bac) : ${n.etat === 'passed' ? 'réussis' : 'échoués'}`,
            `tests (sandbox): ${n.etat}`,
          );
    // Le titre d'un épisode est celui de la DERNIÈRE tâche qui a rencontré
    // la panne (`enregistrerEpisode`) : « vue sur », jamais « erreur X », qui
    // ferait croire que l'erreur porte le nom d'une tâche. Dans le graphe
    // d'un projet, il n'arrive pas (`nomDeNote`) : la signature seule.
    case 'error':
      return n.libelle === null
        ? t(
            `signature d’erreur ${n.id.slice('error:'.length)}`,
            `error signature ${n.id.slice('error:'.length)}`,
          )
        : t(`erreur vue sur « ${n.libelle} »`, `error seen on “${n.libelle}”`);
    // Une note du Cerveau sans titre : le graphe d'un projet ne le porte pas
    // (le Cerveau se lit avec sa propre permission) — son id, dit comme tel.
    // « Aucune piste retenue » est le fait d'un CONSEIL, jamais d'une note.
    case 'decision':
      return (
        n.libelle ??
        (n.origine === 'cerveau'
          ? t(`décision du Cerveau ${noteDe(n)}`, `Brain decision ${noteDe(n)}`)
          : t('aucune piste retenue', 'no option retained'))
      );
    case 'lesson':
      return (
        n.libelle ??
        (n.origine === 'cerveau'
          ? t(`leçon du Cerveau ${noteDe(n)}`, `Brain lesson ${noteDe(n)}`)
          : n.id)
      );
    default:
      return n.libelle ?? n.id;
  }
}

/** L'id de la note du Cerveau qui porte un nœud (`lesson:note:<id>`). */
const noteDe = (n: NoeudExperience): string =>
  n.provenance.source === 'cerveau' ? n.provenance.noteId : n.id;

/** La relation, lue de `de` vers `vers` : « A — produite par → B ». */
export function libelleRelation(r: Relation, t: Traduire): string {
  switch (r) {
    case 'produced_by':
      return t('produit par', 'produced by');
    case 'reviewed_by':
      return t('relu par', 'reviewed by');
    case 'failed_with':
      return t('a échoué avec', 'failed with');
    // « Réussie après », jamais « réparée par » : la relation est une
    // corrélation dans le temps, et le mot ne doit pas affirmer une cause.
    case 'fixed_by':
      return t('suivie d’une réussite :', 'followed by a success:');
    case 'validated_by':
      return t('validé par', 'validated by');
    case 'similar_to':
      return t('ressemble à', 'similar to');
    case 'derived_from':
      return t('vient de', 'derived from');
    case 'supersedes':
      return t('remplace', 'supersedes');
  }
}

/** La nature d'un savoir, dite sans l'embellir. */
export function libelleNature(n: NatureSavoir, t: Traduire): string {
  switch (n) {
    case 'fait':
      return t('fait', 'fact');
    case 'correlation':
      return t('corrélation', 'correlation');
    case 'lecon_validee':
      return t('leçon validée', 'validated lesson');
  }
}

/** Le modèle d'une production : déclaré par le CLI, ou seulement commandé. */
export function libellePreuve(a: AreteExperience, t: Traduire): string | null {
  if (a.preuve === 'declare') return t('déclaré par le CLI', 'declared by the CLI');
  if (a.preuve === 'commande') return t('commandé par la Reine', 'requested by the Queen');
  return null;
}

/**
 * D'où vient un fait : l'événement du journal (son id, celui de `/api/events`)
 * ou la note du Cerveau, et sa date.
 */
export function libelleProvenance(p: Provenance, date: (ms: number) => string): string {
  return p.source === 'journal'
    ? `#${p.evenementId} ${p.type} · ${date(p.date)}`
    : `note ${p.noteId} · ${date(p.date)}`;
}
