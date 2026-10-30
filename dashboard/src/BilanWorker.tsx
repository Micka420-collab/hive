// Le bilan d'une ouvrière, sur sa fiche : ce qu'elle a coûté, et ce que
// l'Evaluator a fait de son travail.
//
// La fiche disait qui elle est, ce qu'elle fait et ce qu'elle a fait — pas ce
// que ça a donné. Le coût, le temps et le jugement existaient tâche par tâche
// (chronologie, tiroir) ; ici ils sont REPLIÉS par Worker, côté serveur
// (`GET /api/workers/:nodeId/bilan`).
//
// ─── DEUX MESURES DE QUALITÉ, JAMAIS UNE NOTE ────────────────────────────────
//
// La part de ses productions ACCEPTÉES par l'Evaluator, parmi celles qu'il a
// tranchées, et son taux de correction. Côte à côte, avec leurs comptes :
// les fondre en un score demanderait de décider combien vaut une correction
// face à une acceptation — une décision produit, pas une lecture. Sous trois
// productions jugées, la part est « inconnue » : 1/1 n'est pas « 100 % ».
//
// Le coût reste ce que les CLI DÉCLARENT, avec sa couverture ; la fenêtre est
// celle du journal retenu, et le bilan dit quand elle a pu perdre des faits.

import { fetchBilanWorker } from './api';
import type { BilanEconomique, QualiteWorker } from './api';
import { useLang, useT } from './i18n';
import type { Translate } from './i18n';
import { direDuree } from '../../src/shared/horloge-chantier';
import { direSommeDeclaree, direUsd, NOTE_COUT_DECLARE } from './ui';
import { EchecSondage, useApiPoll } from './views/shared';

const pourcent = (part: number): string => `${Math.round(part * 100)} %`;

function phraseAcceptation(q: QualiteWorker, t: Translate): string {
  if (q.partAcceptee === 'inconnu') {
    return t(
      `inconnue — ${q.jugees} production(s) tranchée(s) par l’Evaluator, il en faut 3`,
      `unknown — ${q.jugees} production(s) decided by the Evaluator, 3 are needed`,
    );
  }
  return t(
    `${pourcent(q.partAcceptee)} — ${q.acceptees}/${q.jugees} production(s) tranchée(s)`,
    `${pourcent(q.partAcceptee)} — ${q.acceptees}/${q.jugees} decided production(s)`,
  );
}

// Le dénominateur est dit : les productions dont le sort est CONNU, pas
// toutes — une production remplacée sans renvoi constaté n'a pas de sort lu.
function phraseCorrection(q: QualiteWorker, t: Translate): string {
  if (q.tauxCorrection === 'inconnu') {
    return t(
      `inconnu — ${q.sortConnu} production(s) au sort connu, il en faut 3`,
      `unknown — ${q.sortConnu} production(s) with a known fate, 3 are needed`,
    );
  }
  return t(
    `${pourcent(q.tauxCorrection)} — ${q.corrigees} renvoi(s) sur ${q.sortConnu} production(s) au sort connu`,
    `${pourcent(q.tauxCorrection)} — ${q.corrigees} sent back out of ${q.sortConnu} production(s) with a known fate`,
  );
}

function LigneEconomie({ bilan, libelle }: { bilan: BilanEconomique; libelle: string }) {
  const t = useT();
  const lang = useLang();
  const cout = direSommeDeclaree(bilan.coutFournisseur, (v) => direUsd(v, lang), t);
  const modele = direSommeDeclaree(bilan.dureeModele, (v) => direDuree(v, lang), t);
  return (
    <tr>
      <th scope="row">{libelle}</th>
      <td>{bilan.tentatives}</td>
      <td title={cout.couverture ?? undefined}>
        {cout.valeur}
        {cout.couverture && <span className="bilan-couverture"> · {cout.couverture}</span>}
      </td>
      <td title={modele.couverture ?? undefined}>
        {modele.valeur}
        {modele.couverture && <span className="bilan-couverture"> · {modele.couverture}</span>}
      </td>
      <td>
        {bilan.dureeMedianeMs === null
          ? t('inconnue', 'unknown')
          : direDuree(bilan.dureeMedianeMs, lang)}
      </td>
    </tr>
  );
}

export function BilanWorker({ nodeId }: { nodeId: string }) {
  const t = useT();
  // Une minute : juger les productions relit l'Evaluator tâche par tâche, et
  // un bilan ne bouge qu'au rythme des productions — pas des battements.
  const bilan = useApiPoll(() => fetchBilanWorker(nodeId), 60_000);
  const b = bilan.error ? null : bilan.data;
  return (
    <section className="ch-bilan" aria-labelledby="ch-bilan-titre" data-testid="bilan-worker">
      <h4 id="ch-bilan-titre">{t('Bilan', 'Record')}</h4>
      <EchecSondage sondage={bilan} avant={t('Bilan indisponible :', 'Record unavailable:')} />
      {!bilan.error && !b && <p className="muted-text">{t('Lecture…', 'Loading…')}</p>}
      {b && (
        <>
          <dl className="ch-bilan-qualite">
            <div data-testid="bilan-acceptation">
              <dt>{t('Acceptées par l’Evaluator', 'Accepted by the Evaluator')}</dt>
              <dd>{phraseAcceptation(b.qualite, t)}</dd>
            </div>
            <div data-testid="bilan-correction">
              <dt>{t('Renvoyées en correction', 'Sent back for correction')}</dt>
              <dd>{phraseCorrection(b.qualite, t)}</dd>
            </div>
          </dl>
          <table className="ch-bilan-economie" data-testid="bilan-economie">
            <thead>
              <tr>
                <th scope="col">{t('Modèle', 'Model')}</th>
                <th scope="col">{t('Tentatives', 'Attempts')}</th>
                <th scope="col">{t('Coût déclaré', 'Declared cost')}</th>
                <th scope="col">{t('Temps modèle', 'Model time')}</th>
                <th scope="col">{t('Durée médiane', 'Median duration')}</th>
              </tr>
            </thead>
            <tbody>
              <LigneEconomie bilan={b.economie.total} libelle={t('Tous', 'All')} />
              {b.economie.parModele.map((m) => (
                <LigneEconomie key={m.modele} bilan={m} libelle={m.modele} />
              ))}
            </tbody>
          </table>
          <p className="muted-text ch-bilan-fenetre" data-testid="bilan-fenetre">
            {b.fenetre.depuis === null
              ? t('Aucun fait retenu au journal.', 'No fact retained in the journal.')
              : t(
                  `Lu sur ${b.fenetre.evenements} fait(s) retenu(s) depuis le ${new Date(b.fenetre.depuis).toLocaleString('fr-FR')}.`,
                  `Read from ${b.fenetre.evenements} retained fact(s) since ${new Date(b.fenetre.depuis).toLocaleString('en-US')}.`,
                )}{' '}
            {b.fenetre.tronquee &&
              t(
                'Le journal a été élagué : des tentatives plus anciennes ont pu manquer, et seules les productions dont le sort est encore lisible sont jugées.',
                'The journal was pruned: older attempts may be missing, and only productions whose fate is still readable are judged.',
              )}{' '}
            {b.qualite.bornee !== null &&
              t(
                `Qualité lue sur les ${b.qualite.bornee} résultats les plus récents.`,
                `Quality read from the ${b.qualite.bornee} most recent results.`,
              )}{' '}
            {t(NOTE_COUT_DECLARE.fr, NOTE_COUT_DECLARE.en)}
          </p>
        </>
      )}
    </section>
  );
}
