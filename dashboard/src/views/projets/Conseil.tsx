// LE CONSEIL DES ÉCLAIREUSES — lire une délibération, la réunir, la trancher.
// Sorti de `Projets.tsx` tel quel. La War Room le monte directement d'ici :
// l'importer depuis la vue Projets lui faisait charger toute la vue.

import { useEffect, useState } from 'react';
import { auteurDeDecision, marqueDeDecision, suffixeEnVol } from '../projets-rendu';
import { fetchConseil, fetchConseils, reunirConseil, trancherConseil } from '../../api';
import { ApiError } from '../../api';
import type { IssueConseil, SessionConseil } from '../../api';
import { useT } from '../../i18n';
import { useApiPoll } from '../shared';
import { ISSUES_A_TRANCHER, JUSTIFICATION_MAX } from '../../../../src/shared/war-room';
import { LENTILLES, QUESTION_DEFAUT, TOURS_MAX } from '../../../../src/orchestrator/conseil';
import { errMsg } from './commun';
import '../projets.css';

/**
 * Le Conseil des Éclaireuses — ce que la ruche PROPOSE, et qui l'a contredite.
 *
 * ─── POURQUOI CET ÉCRAN EST LE PLUS MANQUANT DE TOUS ─────────────────────────
 *
 * Le Conseil ne change rien : son verdict est une PROPOSITION À UN HUMAIN,
 * exactement comme la Miellerie propose un merge sans jamais le faire. Un
 * mécanisme dont la sortie EST une proposition à un humain, et que cet humain
 * ne peut lire qu'en ligne de commande, ne sert à personne. C'est plus net
 * encore que Les Guetteuses, dont la sortie était au moins une alerte.
 *
 * ─── CE QU'ON MONTRE, ET POURQUOI PAS SEULEMENT LA GAGNANTE ──────────────────
 *
 * Le protocole est fait pour éviter quatre pièges de délibération, et trois
 * d'entre eux ne se voient QUE dans les perdantes :
 *
 *   • Les SIGNAUX D'ARRÊT. Une éclaireuse convaincue qu'une piste est mauvaise
 *     l'inhibe activement. N'afficher que la retenue effacerait l'objection —
 *     c'est-à-dire l'information la plus chère du conseil.
 *   • La DIVERSITÉ des familles. Dix instances du même modèle qui s'accordent,
 *     ce n'est pas dix avis : c'est un avis répété dix fois. On montre donc les
 *     familles distinctes, pas seulement le nombre de soutiens.
 *   • L'ÉGALITÉ (`depart`). Plusieurs propositions au quorum, c'est à l'humain
 *     de trancher — et il ne peut trancher que s'il les voit toutes.
 *
 * Une issue sans recommandation (`vide`, `sans_quorum`, `epuise`) se DIT. Un
 * écran qui n'afficherait rien dans ces cas-là laisserait croire à une panne,
 * alors que « personne n'a rien trouvé » est un résultat.
 *
 * ─── LES DEUX GESTES QUI MANQUAIENT ──────────────────────────────────────────
 *
 * Le panneau disait « vous tranchez » sans rien pour trancher, et le Conseil ne
 * se réunissait qu'en ligne de commande. Il porte désormais les deux gestes :
 * RÉUNIR (le 409 « déjà en cours » est dit, et le conseil qui délibère est
 * déplié) et TRANCHER un conseil clos (`council_decided`, avec qui et
 * pourquoi). Exporté : la War Room le monte tel quel plutôt qu'un second écran
 * du même Conseil, qui finirait par dire autre chose que celui-ci.
 */
export function ConseilProjet({
  projectId,
  refreshTick,
  reunion = false,
  onReunionFin,
  focus = null,
}: {
  projectId: string;
  refreshTick: number;
  /** Le formulaire « Réunir le Conseil » est déplié (bouton de la carte, ou de la War Room). */
  reunion?: boolean;
  /** Le formulaire a servi, ou l'humain y renonce : l'appelant le replie. */
  onReunionFin?: () => void;
  /**
   * Session à déplier d'office — un désaccord cliqué dans la War Room. Un objet
   * NEUF par demande : recliquer le même conseil après l'avoir replié doit le
   * redéplier, ce qu'un identifiant inchangé ne déclencherait pas.
   */
  focus?: { sessionId: string } | null;
}) {
  const t = useT();
  const liste = useApiPoll(fetchConseils, 60_000, refreshTick);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [session, setSession] = useState<SessionConseil | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);

  const miens = (liste.data?.conseils ?? []).filter((c) => c.projectId === projectId);

  useEffect(() => {
    if (focus) setOuvert(focus.sessionId);
  }, [focus]);

  // Relu aussi au rythme de la ruche (`refreshTick`) : une décision posée par
  // un AUTRE opérateur doit apparaître ici sans qu'on replie le conseil.
  useEffect(() => {
    if (!ouvert) return setSession(null);
    let vivant = true;
    fetchConseil(ouvert)
      .then((s) => vivant && setSession(s))
      .catch((e: unknown) => vivant && setErreur(errMsg(e)));
    return () => {
      vivant = false;
    };
  }, [ouvert, refreshTick]);

  /**
   * Le 409 « déjà en cours » n'est pas un échec : c'est la garde qui empêche
   * deux conseils concurrents de doubler la dépense. On le DIT, et on déplie
   * le conseil qui délibère — la personne voulait un conseil, il y en a un.
   */
  const dejaEnCours = async (): Promise<void> => {
    setAvis(
      t(
        'Un conseil délibère déjà sur ce projet — le voici. Un seul à la fois : deux conseils concurrents doubleraient la dépense.',
        'A council is already deliberating on this project — here it is. One at a time: two concurrent councils would double the spend.',
      ),
    );
    const { conseils } = await fetchConseils();
    const enCours = conseils.find((c) => c.projectId === projectId && !c.closedAt);
    liste.refresh();
    if (enCours) setOuvert(enCours.id);
    onReunionFin?.();
  };

  // Aucune délibération et personne qui en demande une : on se tait plutôt que
  // d'afficher une section vide sur chaque carte.
  if (miens.length === 0 && !reunion) return null;

  const ISSUE: Record<IssueConseil, { fr: string; en: string }> = {
    quorum: { fr: '✔ une piste a convergé', en: '✔ one path converged' },
    depart: { fr: '⚖ égalité — à vous de trancher', en: '⚖ tie — yours to settle' },
    sans_quorum: { fr: '… du débat, rien de convergé', en: '… debate, nothing converged' },
    epuise: { fr: 'arrêté sans converger', en: 'stopped without converging' },
    vide: { fr: '∅ personne n’a rien trouvé', en: '∅ nobody found anything' },
  };

  return (
    <div className="pj-sub">
      <div className="pj-sub-head">
        <h4>{t('Conseil des Éclaireuses', 'Council of Scouts')}</h4>
        <span className="pj-sub-meta">{miens.length}</span>
      </div>

      {reunion && (
        <ReunirConseil
          projectId={projectId}
          onReuni={(s) => {
            setAvis(null);
            liste.refresh();
            setOuvert(s.id);
            onReunionFin?.();
          }}
          onDejaEnCours={dejaEnCours}
          onAnnuler={() => onReunionFin?.()}
        />
      )}
      {avis && (
        <p className="pj-cs-avis" role="status">
          {avis}
        </p>
      )}

      {miens.length > 0 && (
        <ul className="pj-cs-liste">
          {miens.map((c) => {
            const marque = marqueDeDecision(c, ISSUES_A_TRANCHER);
            return (
              <li key={c.id}>
                <button
                  className="pj-cs-question"
                  onClick={() => setOuvert(ouvert === c.id ? null : c.id)}
                >
                  {ouvert === c.id ? '▾' : '▸'} {c.question}
                </button>
                {/* DEUX QUESTIONS DIFFÉRENTES, et l'écran doit les distinguer.
                    La liste rend l'issue RANGÉE — celle d'un conseil clos — donc
                    `null` tant qu'il délibère. Le détail, lui, RECALCULE ce que le
                    protocole dirait à cet instant. Afficher l'un pour l'autre
                    donnerait un résumé qui contredit son propre détail. */}
                <span className="pj-cs-issue">
                  {c.issue
                    ? t(ISSUE[c.issue].fr, ISSUE[c.issue].en)
                    : t('délibère encore', 'still deliberating')}
                </span>
                {marque === 'tranche' && (
                  <span className="pj-cs-marque-decision pj-cs-tranche">
                    {t('✔ tranché', '✔ settled')}
                  </span>
                )}
                {marque === 'a_trancher' && (
                  <span className="pj-cs-marque-decision pj-cs-a-trancher">
                    {t('à trancher', 'to settle')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {erreur && <p className="panel-error">{erreur}</p>}

      {session && (
        <div className="pj-cs-detail">
          {/* Tant que le conseil n'est pas clos, ce verdict est ce que le
              protocole dirait MAINTENANT — il peut encore changer. Le taire
              ferait passer une lecture instantanée pour une conclusion. */}
          <p className="pj-cs-resume">
            {t(`Tour ${session.tour}`, `Round ${session.tour}`)} ·{' '}
            {t(ISSUE[session.issue].fr, ISSUE[session.issue].en)}
            {!session.closedAt && ` — ${t('provisoire', 'provisional')}`}
            {suffixeEnVol(session.enVol, t)}
          </p>
          {session.danses.length === 0 ? (
            <p className="muted-text">
              {t(
                'Aucune proposition : les éclaireuses n’ont rien rapporté.',
                'No proposal: the scouts brought nothing back.',
              )}
            </p>
          ) : (
            <ul className="pj-cs-danses">
              {session.danses.map((d) => (
                <li
                  key={d.id}
                  className={
                    d.id === session.retenue
                      ? 'pj-cs-retenue'
                      : d.arrets.length
                        ? 'pj-cs-contestee'
                        : ''
                  }
                >
                  <div className="pj-cs-titre">
                    {d.id === session.retenue && <span className="pj-cs-marque">★</span>}
                    <strong>{d.titre}</strong>
                    <span className="pj-cs-chiffres">
                      {/* Les FAMILLES, pas seulement les soutiens : dix clones
                          d'accord ne font pas dix avis. */}
                      ↑{d.soutiens.length} · {d.familles.length} {t('famille(s)', 'famil(y|ies)')}
                      {d.arrets.length > 0 && (
                        <span className="pj-cs-arrets"> · {d.arrets.length}</span>
                      )}
                    </span>
                  </div>
                  {d.corps && <p className="pj-cs-corps">{d.corps}</p>}
                  {/* LES OBJECTIONS EN CLAIR. C'est l'information la plus chère
                      du conseil : une piste qu'une éclaireuse a vérifiée et
                      jugée mauvaise. */}
                  {d.raisons
                    .filter((r) => r.type === 'arret' && r.raison)
                    .map((r, i) => (
                      <p key={i} className="pj-cs-objection">
                        {r.raison}
                      </p>
                    ))}
                  {/* PAS défendu, et c'est l'idiome JSX « rends si présent ».
                  Muté en `||`, le bloc s'affiche VIDE quand il n'y a aucune
                  source — une section « sources » sans source. L'entrée qui
                  tranche est un dépôt à zéro source ; l'extraire en fonction
                  pure serait de la cérémonie pour une garde d'une ligne. */}
                  {d.sources.length > 0 && (
                    <p className="pj-cs-sources">
                      {/* AFFICHÉES, jamais suivies par la ruche. */}
                      {d.sources.join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* La clé force un formulaire NEUF par session : un choix fait sur
              un conseil ne doit pas survivre au passage à un autre. */}
          <TrancherConseil key={session.id} session={session} onTranche={setSession} />
        </div>
      )}
    </div>
  );
}

/**
 * Réunir un Conseil — le geste qui n'existait qu'en ligne de commande.
 *
 * Le COÛT est dit avant le bouton, et c'est le garde-fou : un conseil crée de
 * vraies tâches d'ouvrières (une éclaireuse par lentille, puis des
 * vérificatrices, tour après tour), donc du temps-machine prêté par les
 * membres. Les chiffres viennent du protocole lui-même, pas d'une copie.
 */
function ReunirConseil({
  projectId,
  onReuni,
  onDejaEnCours,
  onAnnuler,
}: {
  projectId: string;
  onReuni: (s: SessionConseil) => void;
  onDejaEnCours: () => Promise<void>;
  onAnnuler: () => void;
}) {
  const t = useT();
  const [question, setQuestion] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const reunir = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      onReuni(await reunirConseil(projectId, question));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) await onDejaEnCours().catch(() => {});
      else setErreur(errMsg(e));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="pj-cs-reunir">
      <p className="pj-equipe-moi">
        {t(
          `${LENTILLES.length} éclaireuses explorent le projet sous des angles différents, puis se vérifient entre elles — ${TOURS_MAX} tours au plus. Ce sont de vraies tâches d’ouvrières. Le Conseil ne change rien : il propose, vous tranchez.`,
          `${LENTILLES.length} scouts explore the project from different angles, then check each other — ${TOURS_MAX} rounds at most. These are real worker tasks. The Council changes nothing: it proposes, you settle.`,
        )}
      </p>
      <div className="pj-run">
        <input
          className="pj-testcmd"
          type="text"
          maxLength={500}
          placeholder={t(
            `Question (facultative) — sinon : ${QUESTION_DEFAUT}`,
            `Question (optional) — default: ${QUESTION_DEFAUT}`,
          )}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={occupe}
          aria-label={t('Question posée au Conseil', 'Question put to the Council')}
        />
        <button className="btn" disabled={occupe} onClick={() => void reunir()}>
          {occupe ? t('Réunion…', 'Convening…') : t('Réunir', 'Convene')}
        </button>
        <button className="btn ghost" disabled={occupe} onClick={onAnnuler}>
          {t('Annuler', 'Cancel')}
        </button>
      </div>
      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}

/** Le choix de l'humain : une piste précise, ou aucune — c'est une décision aussi. */
type Choix = { genre: 'piste'; id: string } | { genre: 'aucune' };

/**
 * Trancher — le « vous tranchez » que l'écran promettait sans le permettre.
 *
 * ─── CE QUI EST DEMANDÉ, ET POURQUOI ─────────────────────────────────────────
 *
 * Une piste (ou AUCUNE, qui est une décision), et une JUSTIFICATION
 * obligatoire. Sans elle, dans trois mois, « pourquoi a-t-on écarté la piste
 * qui avait trois soutiens ? » n'aurait pas de réponse — et c'est exactement
 * la question qu'une trace de décision existe pour servir.
 *
 * Revenir sur une décision est permis, mais NOMMÉ : le formulaire retient la
 * décision qu'il remplace, et la Reine refuse (409) si quelqu'un a tranché
 * entre-temps. Deux opérateurs ne s'écrasent pas en silence — et le refus ne
 * se tait pas non plus : l'écran relit la décision de l'autre, et DIT que la
 * vôtre n'a pas été consignée. Sans cet avis, deux décisions signées « jeton
 * de ruche » se ressemblent assez pour croire la sienne rangée. Le choix et la
 * raison refusés sont gardés : « Revoir la décision » les reprend tels quels,
 * avec la bonne décision à remplacer.
 */
function TrancherConseil({
  session,
  onTranche,
}: {
  session: SessionConseil;
  onTranche: (s: SessionConseil) => void;
}) {
  const t = useT();
  const decision = session.decision ?? null;
  const [revoir, setRevoir] = useState(false);
  const [precedente, setPrecedente] = useState<number | null>(null);
  const [choix, setChoix] = useState<Choix | null>(
    session.retenue ? { genre: 'piste', id: session.retenue } : null,
  );
  const [justification, setJustification] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** La décision que la Reine a refusée (409) parce qu'une autre est passée avant. */
  const [refusee, setRefusee] = useState<{ choix: Choix; justification: string } | null>(null);

  if (!session.closedAt) {
    return (
      <p className="pj-equipe-moi">
        {t(
          'Le Conseil ne décide rien : il propose, vous tranchez — une fois clos. Il délibère encore.',
          'The Council decides nothing: it proposes, you settle — once it is closed. It is still deliberating.',
        )}
      </p>
    );
  }

  if (decision && !revoir) {
    return (
      <div className="pj-cs-decision" data-testid="pj-cs-decision">
        <p className="pj-cs-decision-tete">
          {t('✔ Tranché par', '✔ Settled by')} <strong>{auteurDeDecision(decision.par, t)}</strong>
          {' · '}
          {new Date(decision.ts).toLocaleString()}
        </p>
        <p className="pj-cs-decision-choix">
          {decision.propositionId === null
            ? t('Aucune piste retenue.', 'No path retained.')
            : `${t('Piste retenue :', 'Path retained:')} ${decision.titre ?? decision.propositionId}`}
        </p>
        <p className="pj-cs-decision-pourquoi">« {decision.justification} »</p>
        {refusee && (
          <p className="panel-error" role="alert">
            {t(
              'Votre décision n’a pas été consignée : quelqu’un a tranché entre-temps — c’est la sienne ci-dessus. Si vous maintenez la vôtre, « Revoir la décision » la reprend telle que vous l’aviez écrite.',
              'Your decision was not recorded: someone settled in the meantime — theirs is above. If you stand by yours, “Revise the decision” brings it back as you wrote it.',
            )}
          </p>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            setPrecedente(decision.id);
            setChoix(
              refusee?.choix ??
                (decision.propositionId === null
                  ? { genre: 'aucune' }
                  : { genre: 'piste', id: decision.propositionId }),
            );
            setJustification(refusee?.justification ?? '');
            setRefusee(null);
            setErreur(null);
            setRevoir(true);
          }}
        >
          {t('Revoir la décision', 'Revise the decision')}
        </button>
      </div>
    );
  }

  const trancher = async () => {
    if (!choix || !justification.trim()) return;
    setOccupe(true);
    setErreur(null);
    setRefusee(null);
    try {
      const s = await trancherConseil(session.id, {
        propositionId: choix.genre === 'piste' ? choix.id : null,
        justification: justification.trim(),
        precedente: revoir ? precedente : null,
      });
      setRevoir(false);
      onTranche(s);
    } catch (e) {
      setErreur(errMsg(e));
      // Quelqu'un a tranché entre-temps : on relit, pour que l'écran montre
      // SA décision plutôt que la nôtre — et l'on garde la nôtre, refusée,
      // pour le dire et pouvoir la reprendre.
      if (e instanceof ApiError && e.status === 409) {
        setRefusee({ choix, justification });
        fetchConseil(session.id)
          .then((s) => {
            setRevoir(false);
            onTranche(s);
          })
          .catch(() => {});
      }
    } finally {
      setOccupe(false);
    }
  };

  const nom = `trancher-${session.id}`;
  return (
    <form
      className="pj-cs-trancher"
      onSubmit={(e) => {
        e.preventDefault();
        void trancher();
      }}
    >
      {/* Ce que la décision NE FAIT PAS se dit ici, au moment du geste : elle
          est un enregistrement. Le Plein Essaim, lui, planifie depuis le
          verdict du Conseil — « Aucune » ne retire pas une piste qu'il aurait
          déjà transformée en tâches. */}
      <p className="pj-cs-trancher-tete">
        {t(
          'Le Conseil propose, vous tranchez. Votre décision est rangée avec votre nom et votre raison. Elle ne crée ni n’annule aucune tâche : si le Plein Essaim est allumé sur ce projet, il suit le verdict du Conseil, pas cette décision.',
          'The Council proposes, you settle. Your decision is recorded with your name and your reason. It creates and cancels no task: if the Full Swarm is on for this project, it follows the Council’s verdict, not this decision.',
        )}
      </p>
      <fieldset className="pj-cs-choix" disabled={occupe}>
        <legend>{t('Piste retenue', 'Path retained')}</legend>
        {session.danses.map((d) => (
          <label key={d.id}>
            <input
              type="radio"
              name={nom}
              checked={choix?.genre === 'piste' && choix.id === d.id}
              onChange={() => setChoix({ genre: 'piste', id: d.id })}
            />{' '}
            {d.titre}
          </label>
        ))}
        <label>
          <input
            type="radio"
            name={nom}
            checked={choix?.genre === 'aucune'}
            onChange={() => setChoix({ genre: 'aucune' })}
          />{' '}
          {t('Aucune — ne rien retenir', 'None — retain nothing')}
        </label>
      </fieldset>
      <textarea
        className="pj-cs-justification"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        maxLength={JUSTIFICATION_MAX}
        rows={3}
        disabled={occupe}
        required
        placeholder={t(
          'Pourquoi ? (obligatoire — c’est ce qu’on relira dans trois mois)',
          'Why? (required — this is what will be read in three months)',
        )}
        aria-label={t('Justification de la décision', 'Justification of the decision')}
      />
      <div className="pj-run">
        <button
          className="btn primary"
          type="submit"
          disabled={occupe || !choix || !justification.trim()}
        >
          {t('Consigner la décision', 'Record the decision')}
        </button>
        {revoir && (
          <button
            className="btn ghost"
            type="button"
            disabled={occupe}
            onClick={() => setRevoir(false)}
          >
            {t('Annuler', 'Cancel')}
          </button>
        )}
      </div>
      {erreur && <p className="panel-error">{erreur}</p>}
    </form>
  );
}
