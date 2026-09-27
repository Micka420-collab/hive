// Les mots du banc d'ombre, dans la langue de l'écran.
//
// Le serveur ne range que des CODES (`shadow_bench_skipped.motif`, le verdict
// et la confiance d'une comparaison) : un journal de dix ans ne garde pas de
// phrases. Le Journal, le panneau du projet et le registre Genome les disent
// ici, une seule fois — trois copies auraient fini par dire trois choses.
//
// Un code inconnu (une Reine plus récente) est rendu TEL QUEL : mieux vaut un
// code brut qu'une phrase inventée qui dirait autre chose.

import type { Translate } from './i18n';
import type { ConfianceOmbre, IssueCote, VerdictOmbre } from '../../src/orchestrator/shadow-bench';

/** Pourquoi une tâche tirée au sort n'a pas eu d'ombre (`MOTIFS_REFUS_OMBRE`). */
export function direMotifOmbre(motif: unknown, t: Translate): string {
  switch (motif) {
    case 'non_testable':
      return t(
        'aucun verdict de tests sur la production : rien ne départagerait les deux modèles',
        'no test verdict on the production: nothing would tell the two models apart',
      );
    case 'trop_grande':
      return t('tâche trop grande pour être rejouée', 'task too large to replay');
    case 'action_externe':
      return t(
        'la tâche demande un geste externe ou irréversible',
        'the task asks for an external or irreversible action',
      );
    case 'delegation':
      return t('tâche déléguée ou qui délègue', 'delegated or delegating task');
    case 'modele_inconnu':
      return t(
        'aucun modèle commandé à la production : rien à comparer',
        'no model was commanded for the production: nothing to compare',
      );
    case 'ombre_en_vol':
      return t(
        'une autre ombre du projet est en vol',
        'another shadow of the project is in flight',
      );
    case 'budget_executions':
      return t(
        'budget atteint : exécutions des dernières 24 h',
        'budget reached: runs over the last 24 h',
      );
    case 'budget_cout':
      return t(
        'budget atteint : coût déclaré des dernières 24 h',
        'budget reached: declared cost over the last 24 h',
      );
    case 'aucun_second_modele':
      return t(
        'aucun autre modèle offert par une ouvrière en ligne',
        'no other model offered by an online worker',
      );
    default:
      return typeof motif === 'string' && motif.length > 0 ? motif : '?';
  }
}

/** Le verdict d'une comparaison — rendu par les tests seuls. */
export function direVerdictOmbre(verdict: VerdictOmbre, t: Translate): string {
  switch (verdict) {
    case 'ombre_meilleure':
      return t('l’ombre fait mieux', 'the shadow does better');
    case 'originale_meilleure':
      return t('l’originale fait mieux', 'the original does better');
    case 'egalite':
      return t('égalité', 'tie');
    case 'indecis':
      return t(
        'indécis — un côté sans verdict de tests',
        'undecided — one side has no test verdict',
      );
  }
}

export function direConfianceOmbre(confiance: ConfianceOmbre, t: Translate): string {
  switch (confiance) {
    case 'haute':
      return t('confiance haute', 'high confidence');
    case 'moyenne':
      return t('confiance moyenne', 'medium confidence');
    case 'faible':
      return t('confiance faible', 'low confidence');
  }
}

/** Ce qu'a donné un côté. */
export function direIssueCote(issue: IssueCote, t: Translate): string {
  switch (issue) {
    case 'echec':
      return t('échec', 'failed');
    case 'tests_rouges':
      return t('tests rouges', 'tests red');
    case 'tests_verts':
      return t('tests verts', 'tests green');
    case 'sans_preuve':
      return t('sans verdict de tests', 'no test verdict');
  }
}
