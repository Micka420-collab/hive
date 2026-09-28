// Le registre Genome, dans l'Essaim : ce que chaque modèle a réellement fait,
// par catégorie de tâche.
//
// Tout vient de `/api/genome`, un repli du journal retenu. L'écran ne note ni
// ne classe : les lignes sortent par nom de modèle, chaque fait dans sa
// colonne. Une affectation sans modèle déclaré n'est rangée sous aucun modèle.
// Coût, temps modèle et jetons sont ce que DÉCLARE le CLI de l'agent : « ≥ »
// quand une tentative s'est tue, « inconnu » sans aucune déclaration — jamais
// estimés, et le coût jamais tiré des jetons.

import { direJetons, direUsd, formatMs } from './ui';
import { useLang, useT } from './i18n';
import { EmptyState, Skeleton } from './composants';
import type { SommeDeclaree } from '../../src/shared/declaration-fournisseur';
import type { RegistreGenome as Registre } from '../../src/shared/registre-genome';

interface Props {
  registre: Registre | null;
  erreur: string | null;
}

export function RegistreGenome({ registre, erreur }: Props) {
  const t = useT();
  const lang = useLang();
  const declaree = (s: SommeDeclaree | 'inconnu', rendu: (v: number) => string) =>
    s === 'inconnu' ? (
      <td className="muted-text">{t('inconnu', 'unknown')}</td>
    ) : (
      <td
        title={t(
          `${s.declarees}/${s.tentatives} tentative(s) déclarée(s) par le CLI de l’agent`,
          `${s.declarees}/${s.tentatives} attempt(s) declared by the agent CLI`,
        )}
      >
        {s.declarees < s.tentatives ? '≥ ' : ''}
        {rendu(s.total)}
      </td>
    );
  return (
    <section className="card genome-panel" data-testid="registre-genome">
      <header className="panel-head">
        <h2>{t('Genome · faits par modèle', 'Genome · facts per model')}</h2>
        {registre && (
          <span className="panel-count">
            {registre.lignes.length} {t('ligne(s)', 'row(s)')}
          </span>
        )}
      </header>
      {erreur && <p className="panel-error">{erreur}</p>}
      {!registre && !erreur && (
        <Skeleton lignes={3} libelle={t('Lecture du registre…', 'Reading the register…')} />
      )}
      {registre && registre.lignes.length === 0 && (
        <div data-testid="genome-vide">
          <EmptyState
            titre={t('Aucun fait encore', 'No facts yet')}
            texte={t(
              'Le registre se remplit dès qu’une tâche part vers un modèle déclaré.',
              'The register fills as soon as a task goes to a declared model.',
            )}
          />
        </div>
      )}
      {registre && registre.lignes.length > 0 && (
        <div className="genome-defile">
          <table
            className="genome-table"
            aria-label={t(
              'Faits observés par modèle et catégorie, sans classement',
              'Observed facts per model and category, unranked',
            )}
          >
            <thead>
              <tr>
                <th scope="col">{t('Modèle', 'Model')}</th>
                <th scope="col">{t('Catégorie', 'Category')}</th>
                <th scope="col" title={t('rendus / affectations', 'delivered / assigned')}>
                  Worker
                </th>
                <th
                  scope="col"
                  title={t(
                    'reprises · échecs · refus · interruptions',
                    'retries · failures · refusals · interruptions',
                  )}
                >
                  {t('Incidents', 'Incidents')}
                </th>
                <th scope="col">{t('Corrections', 'Corrections')}</th>
                <th scope="col">{t('Relectures', 'Reviews')}</th>
                <th scope="col">{t('Humain', 'Human')}</th>
                <th scope="col">{t('Durée méd.', 'Median time')}</th>
                <th scope="col">{t('Temps modèle', 'Model time')}</th>
                <th scope="col">{t('Coût déclaré', 'Declared cost')}</th>
                <th scope="col">{t('Jetons entrée', 'Input tokens')}</th>
                <th scope="col">{t('Jetons sortie', 'Output tokens')}</th>
              </tr>
            </thead>
            <tbody>
              {registre.lignes.map((l) => (
                <tr key={`${l.modele}/${l.categorie}`} data-testid="genome-ligne">
                  <td className="genome-modele">
                    {l.modele}
                    {l.modelesExacts.length > 0 && (
                      <span
                        className="genome-exacts"
                        title={t(
                          'modèles exacts déclarés par le CLI',
                          'exact models declared by the CLI',
                        )}
                      >
                        {l.modelesExacts.join(', ')}
                      </span>
                    )}
                  </td>
                  <td>{l.categorie}</td>
                  <td>
                    {l.rendus}/{l.affectations}
                  </td>
                  <td>
                    {l.reprises} · {l.echecs} · {l.refus} · {l.interrompues}
                  </td>
                  <td>{l.corrections}</td>
                  <td
                    title={
                      l.avis.modeleProuve > 0
                        ? t(
                            `${l.avis.modeleProuve} avis avec modèle prouvé`,
                            `${l.avis.modeleProuve} review(s) with proven model`,
                          )
                        : undefined
                    }
                  >
                    ✓ {l.avis.valides} · ✗ {l.avis.contestes}
                  </td>
                  <td>
                    ✓ {l.humain.approuvees} · ✗ {l.humain.rejetees}
                  </td>
                  <td>{l.dureeMedianeMs === null ? '—' : formatMs(l.dureeMedianeMs)}</td>
                  {declaree(l.dureeModele, formatMs)}
                  {declaree(l.coutFournisseur, (v) => direUsd(v, lang))}
                  {declaree(l.jetonsEntree, (v) => direJetons(v, lang))}
                  {declaree(l.jetonsSortie, (v) => direJetons(v, lang))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {registre && (
        <p className="genome-pied">
          {registre.sansModele.affectations > 0 && (
            <span data-testid="genome-sans-modele">
              {t(
                `${registre.sansModele.affectations} affectation(s) sans modèle déclaré — rangées sous aucun modèle. `,
                `${registre.sansModele.affectations} assignment(s) with no declared model — filed under none. `,
              )}
            </span>
          )}
          {t(
            `Lu sur ${registre.fenetre.evenements} événement(s) du journal retenu. Aucun classement : le routing apprend des seules contre-visites. Coût, temps modèle et jetons : ce que déclare le CLI de l’agent, jamais estimés — « ≥ » quand une tentative n’a rien déclaré ; aucun coût n’est tiré des jetons.`,
            `Read from ${registre.fenetre.evenements} retained journal event(s). No ranking: routing learns from counter-reviews only. Cost, model time and tokens: what the agent CLI declares, never estimated — “≥” when an attempt declared nothing; no cost is derived from tokens.`,
          )}
          {registre.fenetre.tronquee && (
            <span data-testid="genome-tronque">
              {t(
                ' Fenêtre tronquée : des faits plus anciens ont pu sortir du journal retenu — ceux-là ne sont plus comptés.',
                ' Truncated window: older facts may have left the retained journal — those are no longer counted.',
              )}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
