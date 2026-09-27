// Ce que l'ouvrière a LU de l'expérience voisine — sous « Pourquoi ce Worker,
// ce modèle », dans le tiroir d'une tâche.
//
// Relu du journal (`experience_context`, cf. `src/shared/routage-vue.ts`) :
// les contextes similaires joints au prompt, figés à l'affectation. Le panneau
// dit ce qu'ils SONT — des corrélations, pas la raison du choix : l'Aiguillage
// ne les lit pas, et l'écran ne doit pas laisser croire le contraire. Perdus au
// budget, ils sont dits perdus ; un panneau muet ferait croire que rien ne
// ressemblait à la tâche.

import { useT } from './i18n';
import type { ExperienceVue, SimilaireVue } from '../../src/shared/routage-vue';

export function ExperienceTache({ experience }: { experience: ExperienceVue }) {
  const t = useT();
  const n = experience.similaires.length;

  const traits = (s: SimilaireVue): string =>
    [
      s.memeProjet === false && t('un autre projet', 'another project'),
      s.erreurs > 0 &&
        t(`${s.erreurs} signature(s) d’erreur en commun`, `${s.erreurs} shared error signature(s)`),
      s.fichiers.length > 0 &&
        t(
          `fichiers en commun : ${s.fichiers.join(', ')}`,
          `shared files: ${s.fichiers.join(', ')}`,
        ),
      s.categorie && t('même catégorie', 'same category'),
      s.rendue ? t('rendue', 'delivered') : t('jamais rendue', 'never delivered'),
      s.validee && t('validée', 'validated'),
      s.contestee && t('contestée', 'contested'),
      s.tentativesEchouees > 0 &&
        t(
          `${s.tentativesEchouees} tentative(s) échouée(s)`,
          `${s.tentativesEchouees} failed attempt(s)`,
        ),
      s.modeles.length > 0 &&
        t(`modèles : ${s.modeles.join(', ')}`, `models: ${s.modeles.join(', ')}`),
      s.lecons > 0 && t(`${s.lecons} leçon(s) validée(s)`, `${s.lecons} validated lesson(s)`),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="routage-experience" data-testid="routage-experience">
      <p>
        <strong>{t('Expérience voisine', 'Neighbouring experience')}</strong>{' '}
        <span className="muted">
          {t(
            '— des corrélations, pas la raison du choix : l’Aiguillage ne les lit pas.',
            '— correlations, not the reason for the choice: the router does not read them.',
          )}
          {experience.portee === 'ruche' &&
            t(' Fédérée par l’hôte : toute la ruche.', ' Federated by the host: the whole hive.')}
        </span>
      </p>
      {experience.etat === 'perdue' ? (
        <p className="muted" data-testid="routage-experience-perdue">
          {t(
            `${n} contexte(s) similaire(s) trouvé(s), NON transmis : le budget du prompt était déjà pris.`,
            `${n} similar context(s) found, NOT sent: the prompt budget was already used.`,
          )}
        </p>
      ) : (
        <ul className="routage-similaires">
          {experience.similaires.map((s) => (
            <li key={s.taskId}>
              <span>{s.titre ?? s.taskId.slice(0, 8)}</span>{' '}
              <span className="muted">{traits(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
