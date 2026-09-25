// Le registre Genome, dans l'Essaim : ce que chaque modèle a réellement fait,
// par catégorie de tâche.
//
// Tout vient de `/api/genome`, un repli du journal retenu. L'écran ne note ni
// ne classe : les lignes sortent par nom de modèle, chaque fait dans sa
// colonne. Une affectation sans modèle déclaré n'est rangée sous aucun modèle.
// Coût et temps modèle sont ce que DÉCLARE le CLI de l'agent : « ≥ » quand une
// tentative s'est tue, « inconnu » sans aucune déclaration — jamais estimés.

import { direUsd, formatMs } from './ui';
import { useLang, useT } from './i18n';
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
      {!registre && !erreur && <p className="empty pad">{t('Lecture…', 'Reading…')}</p>}
      {registre && registre.lignes.length === 0 && (
        <p className="empty pad" data-testid="genome-vide">
          {t(
            'Aucun fait encore — le registre se remplit dès qu’une tâche part vers un modèle déclaré.',
            'No facts yet — the register fills as soon as a task goes to a declared model.',
          )}
        </p>
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
            `Lu sur ${registre.fenetre.evenements} événement(s) du journal retenu. Aucun classement : le routing apprend des seules contre-visites. Coût et temps modèle : ce que déclare le CLI de l’agent, jamais estimés — « ≥ » quand une tentative n’a rien déclaré.`,
            `Read from ${registre.fenetre.evenements} retained journal event(s). No ranking: routing learns from counter-reviews only. Cost and model time: what the agent CLI declares, never estimated — “≥” when an attempt declared nothing.`,
          )}
          {registre.fenetre.tronquee && (
            <span data-testid="genome-tronque">
              {t(
                ' Fenêtre pleine : les faits plus anciens sont sortis du journal.',
                ' Window full: older facts have left the journal.',
              )}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
