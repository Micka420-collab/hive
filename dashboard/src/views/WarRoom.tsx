// La War Room — là où les IA se contredisent, et où vous tranchez.
//
// ─── CE QUE CETTE VUE EST ────────────────────────────────────────────────────
//
// Le débat existait déjà, dispersé : les propositions et signaux d'arrêt du
// Conseil sous une carte de projet, les objections de la contre-expertise dans
// le tiroir d'une tâche, les renvois de l'Evaluator dans le Journal, la revue
// humaine dans la Miellerie. Personne ne lisait ces quatre écrans ensemble, et
// un désaccord que personne ne lit est un désaccord que personne ne tranche.
//
// La vue les MET BOUT À BOUT, par projet et par tâche, relus dans le journal
// (`GET /api/war-room`, cf. `src/shared/war-room.ts`). Elle n'invente rien :
// pas de score, pas de second arbitre. En tête, ce qui ATTEND quelqu'un — un
// Conseil qui a débattu sans converger, une contestation dont le renvoi en
// correction n'a pas pu avoir lieu.
//
// ─── SA SEULE ÉCRITURE ───────────────────────────────────────────────────────
//
// Trancher un Conseil. Et elle ne le fait pas elle-même : elle monte le
// panneau du Conseil de la carte projet (`ConseilProjet`), tel quel. Deux
// écrans du même Conseil finiraient par ne plus dire la même chose.
//
// ─── CE QU'ELLE AVOUE ────────────────────────────────────────────────────────
//
// Le journal est élagué. Quand il a déjà perdu des lignes, le fil le DIT :
// un fil court qui aurait l'air complet est le mensonge le plus facile ici.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchWarRoom } from '../api';
import type { Desaccord, FamilleWarRoom } from '../api';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { ConseilProjet } from './Projets';
import { useApiPoll } from './shared';
import type { ViewProps } from './shared';
import { direEntree, direFamille, direIssue, direRaisonRefus } from './warroom-rendu';
import { FAMILLES_WAR_ROOM, sujetDe } from '../../../src/shared/war-room';
import './warroom.css';

const court = (id: string): string => id.slice(0, 8);

export default function WarRoom({
  snapshot,
  onOpenTask,
  onNavigate,
  selectedId,
  refreshTick,
}: ViewProps) {
  const t = useT();
  // Le projet vient du hash (#/warroom/<projectId>) : un lien vers la War Room
  // d'un projet se partage et survit au rechargement.
  const projetId = selectedId;
  const [tacheId, setTacheId] = useState<string | null>(null);
  // La voix montrée par le fil. Elle SURVIT au changement de projet : qui
  // relit les décisions humaines de la ruche veut relire celles d'un projet
  // de la même façon.
  const [famille, setFamille] = useState<FamilleWarRoom | null>(null);
  // Le conseil à déplier : tenu ICI, au-dessus du fil, pour survivre au
  // changement de projet qu'un clic depuis la vue de la ruche provoque. Un
  // objet neuf à chaque clic : recliquer le même conseil le redéplie. Il porte
  // SON projet, et n'est remis qu'au panneau de ce projet-là : un conseil
  // déplié sous le projet d'à côté, formulaire de décision compris, ferait
  // trancher le conseil de A en croyant trancher celui de B.
  const [focus, setFocus] = useState<{ sessionId: string; projectId: string } | null>(null);
  const focusIci = focus && focus.projectId === projetId ? focus : null;
  const [reunion, setReunion] = useState(false);
  const conseilRef = useRef<HTMLElement | null>(null);

  // Trancher se fait dans le panneau du Conseil : on y amène le regard.
  useEffect(() => {
    if (focusIci) conseilRef.current?.scrollIntoView?.({ block: 'start' });
  }, [focusIci]);

  const projets = useMemo(
    () => [...snapshot.projects].sort((a, b) => b.createdAt - a.createdAt),
    [snapshot.projects],
  );
  const nomsNoeuds = useMemo(
    () => new Map(snapshot.nodes.map((n) => [n.id, n.name])),
    [snapshot.nodes],
  );
  const tachesVivantes = useMemo(
    () => new Set(snapshot.tasks.map((task) => task.id)),
    [snapshot.tasks],
  );

  const choisirProjet = (id: string | null): void => {
    setTacheId(null);
    setReunion(false);
    setFocus(null);
    onNavigate('warroom', id ?? undefined, { replace: true });
  };

  // La clé est le PROJET : changer de projet remonte un panneau neuf. Sans
  // elle, React garde l'état du panneau à la même place — le conseil déplié,
  // le choix coché, la raison tapée — sous la liste d'un autre projet.
  const panneauConseil = projetId ? (
    <section className="card wr-conseil" ref={conseilRef}>
      <div className="wr-conseil-actions">
        <button className="btn ghost" aria-expanded={reunion} onClick={() => setReunion((v) => !v)}>
          {t('🔭 Réunir le Conseil', '🔭 Convene the Council')}
        </button>
      </div>
      <ConseilProjet
        key={projetId}
        projectId={projetId}
        refreshTick={refreshTick}
        reunion={reunion}
        onReunionFin={() => setReunion(false)}
        focus={focusIci}
      />
    </section>
  ) : null;

  return (
    <div className="mc-view wr-view">
      <section className="card wr-tete">
        <div className="wr-tete-texte">
          <h2>War Room</h2>
          <p>
            {t(
              'Là où les IA se contredisent — Conseil, contre-expertise, Evaluator — et où vous tranchez. Tout ici est relu dans le journal ; la seule écriture est votre décision sur un Conseil.',
              'Where the AIs contradict each other — Council, counter-review, Evaluator — and where you settle. Everything here is read back from the journal; the only write is your decision on a Council.',
            )}
          </p>
        </div>
        <label className="wr-filtre">
          <span>{t('Projet', 'Project')}</span>
          <select
            value={projetId ?? ''}
            onChange={(e) => choisirProjet(e.target.value || null)}
            aria-label={t('Projet de la War Room', 'War Room project')}
          >
            <option value="">{t('Toute la ruche', 'The whole hive')}</option>
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <FilWarRoom
        projetId={projetId}
        tacheId={tacheId}
        famille={famille}
        onFamille={setFamille}
        refreshTick={refreshTick}
        nomNoeud={(id) => nomsNoeuds.get(id) ?? court(id)}
        tacheVivante={(id) => tachesVivantes.has(id)}
        onTache={setTacheId}
        onConseil={(sessionId, projectId) => {
          if (projectId !== projetId) choisirProjet(projectId);
          setFocus({ sessionId, projectId });
        }}
        milieu={panneauConseil}
        onOpenTask={onOpenTask}
        onRevoir={(taskId) => onNavigate('miellerie', taskId)}
      />
    </div>
  );
}

function FilWarRoom({
  projetId,
  tacheId,
  famille,
  onFamille,
  refreshTick,
  nomNoeud,
  tacheVivante,
  onTache,
  onConseil,
  onOpenTask,
  onRevoir,
  milieu,
}: {
  projetId: string | null;
  tacheId: string | null;
  /** La voix montrée par le fil, `null` pour toutes. */
  famille: FamilleWarRoom | null;
  onFamille: (famille: FamilleWarRoom | null) => void;
  refreshTick: number;
  nomNoeud: (nodeId: string) => string;
  tacheVivante: (taskId: string) => boolean;
  onTache: (taskId: string | null) => void;
  /** Ouvre un conseil sous SON projet — seul un conseil encore rangé en a un. */
  onConseil: (sessionId: string, projectId: string) => void;
  onOpenTask: (taskId: string) => void;
  onRevoir: (taskId: string) => void;
  /** Le panneau du Conseil : entre ce qui attend quelqu'un et le fil. */
  milieu: ReactNode;
}) {
  const t = useT();
  const poll = useApiPoll(
    () => fetchWarRoom({ projectId: projetId, taskId: tacheId, famille }),
    30_000,
    refreshTick,
  );
  // Un filtre qui change relit aussitôt — sans remonter le composant, qui
  // porte aussi le panneau du Conseil (un conseil déplié ne se replie pas
  // parce qu'on a choisi une tâche). Le premier passage est déjà une lecture.
  const { refresh } = poll;
  const monte = useRef(false);
  useEffect(() => {
    if (monte.current) refresh();
    monte.current = true;
  }, [projetId, tacheId, famille, refresh]);
  // Une réponse n'est montrée que sous SON filtre : celle du filtre précédent,
  // encore en place le temps de la relecture, aurait l'air de répondre au
  // nouveau.
  const vue =
    poll.data &&
    poll.data.projectId === projetId &&
    poll.data.taskId === tacheId &&
    poll.data.famille === famille
      ? poll.data
      : null;

  if (!vue) {
    return (
      <>
        <section className="card wr-fil-carte">
          {poll.error ? (
            <p className="panel-error">
              {t('War Room indisponible :', 'War Room unavailable:')} {poll.error}
            </p>
          ) : (
            <p className="muted-text">{t('Lecture du journal…', 'Reading the journal…')}</p>
          )}
          {/* Le filtre reste retirable ICI aussi : une tâche que la Reine ne
              connaît plus rend 404, et sans ce bouton la vue resterait
              coincée sur son erreur jusqu'à un changement de projet. */}
          {tacheId && (
            <button className="btn ghost wr-puce" onClick={() => onTache(null)}>
              {t('Retirer le filtre de tâche', 'Clear the task filter')} ✕
            </button>
          )}
        </section>
        {milieu}
      </>
    );
  }

  const titreTache = (id: string): string => vue.taches[id]?.titre ?? court(id);
  const question = (id: string): string => vue.conseils[id]?.question ?? court(id);
  // Le fil se lit du plus récent au plus ancien : ce qui vient d'arriver en tête.
  const lignes = [...vue.entrees].reverse();

  return (
    <>
      <section className="card wr-desaccords" aria-label={t('Désaccords', 'Disagreements')}>
        <header className="panel-head">
          <h2>{t('Désaccords non résolus', 'Unresolved disagreements')}</h2>
          <span className="wr-compte">{vue.desaccords.length}</span>
        </header>
        {vue.desaccords.length === 0 ? (
          <p className="muted-text">
            {t(
              'Aucun désaccord en suspens : chaque Conseil sans consensus a été tranché, et aucune contestation n’attend.',
              'No pending disagreement: every Council without consensus has been settled, and no contest is waiting.',
            )}
          </p>
        ) : (
          <ul className="wr-desaccords-liste">
            {vue.desaccords.map((d) => (
              <DesaccordLigne
                key={d.genre === 'conseil' ? `c-${d.sessionId}` : `t-${d.taskId}`}
                d={d}
                t={t}
                question={question}
                titreTache={titreTache}
                projetDuConseil={(id) => vue.conseils[id]?.projectId ?? null}
                tacheVivante={tacheVivante}
                onConseil={onConseil}
                onOpenTask={onOpenTask}
                onRevoir={onRevoir}
              />
            ))}
          </ul>
        )}
      </section>

      {milieu}

      <section className="card wr-fil-carte" aria-label={t('Fil', 'Thread')}>
        <header className="panel-head">
          <h2>{t('Le fil du débat', 'The debate thread')}</h2>
          {tacheId && (
            <button className="btn ghost wr-puce" onClick={() => onTache(null)}>
              {t('Tâche', 'Task')} : {titreTache(tacheId)} ✕
            </button>
          )}
        </header>
        {/* Les voix du débat, une à la fois. Le filtre ne touche que le fil :
            les désaccords, au-dessus, restent TOUS affichés — un filtre qui
            cacherait ce qui attend quelqu'un serait le pire endroit où
            l'oublier. */}
        <div className="wr-familles" role="group" aria-label={t('Voix du fil', 'Thread voices')}>
          {[null, ...FAMILLES_WAR_ROOM].map((f) => (
            <button
              key={f ?? 'toutes'}
              className={`btn ghost wr-puce${famille === f ? ' actif' : ''}`}
              aria-pressed={famille === f}
              onClick={() => onFamille(f)}
            >
              {f === null ? t('Toutes les voix', 'All voices') : direFamille(f, t)}
            </button>
          ))}
        </div>
        {vue.journalElague && (
          <p className="wr-aveu">
            {t(
              'Le journal a déjà été élagué : les faits les plus anciens n’y sont plus, et ce fil n’est pas toute l’histoire. Les décisions de Conseil, elles, sont conservées tant que leur Conseil l’est.',
              'The journal has already been pruned: the oldest facts are gone, and this thread is not the whole story. Council decisions are kept as long as their Council is.',
            )}
          </p>
        )}
        {lignes.length === 0 ? (
          <p className="muted-text">
            {famille
              ? t(
                  `Rien de la voix « ${direFamille(famille, t)} » dans le journal retenu.`,
                  `Nothing from the “${direFamille(famille, t)}” voice in the retained journal.`,
                )
              : t(
                  'Rien encore : aucun Conseil, aucune contre-expertise, aucun renvoi ni revue dans le journal retenu.',
                  'Nothing yet: no Council, counter-review, retry or review in the retained journal.',
                )}
          </p>
        ) : (
          <ol className="wr-fil">
            {lignes.map((e) => {
              const ligne = direEntree(e, t, nomNoeud);
              const sujet = sujetDe(e);
              return (
                <li key={e.id} className={`wr-entree wr-ton-${ligne.ton}`}>
                  <span className="wr-icone" aria-hidden="true">
                    {ligne.icone}
                  </span>
                  <time className="wr-heure" dateTime={new Date(e.ts).toISOString()}>
                    {new Date(e.ts).toLocaleString()}
                  </time>
                  {/* Un sujet que la Reine ne connaît plus (tâche ou conseil
                      élagué : le serveur ne l'a pas joint) reste LU mais ne se
                      clique pas — filtrer dessus rendrait 404, l'ouvrir ne
                      montrerait rien. Un bouton qui ne fait rien ment. */}
                  {sujet.genre === 'tache' ? (
                    <button
                      className="wr-sujet"
                      title={
                        vue.taches[sujet.taskId]
                          ? t('Voir tout le débat de cette tâche', 'See this task’s whole debate')
                          : t('Cette tâche n’existe plus', 'This task no longer exists')
                      }
                      onClick={() => onTache(sujet.taskId)}
                      disabled={tacheId === sujet.taskId || !vue.taches[sujet.taskId]}
                    >
                      {titreTache(sujet.taskId)}
                    </button>
                  ) : (
                    <button
                      className="wr-sujet wr-sujet-conseil"
                      title={
                        vue.conseils[sujet.sessionId]
                          ? t('Ouvrir ce Conseil', 'Open this Council')
                          : t('Ce Conseil n’est plus conservé', 'This Council is no longer kept')
                      }
                      disabled={!vue.conseils[sujet.sessionId]?.projectId}
                      onClick={() => {
                        const projet = vue.conseils[sujet.sessionId]?.projectId;
                        if (projet) onConseil(sujet.sessionId, projet);
                      }}
                    >
                      {question(sujet.sessionId)}
                    </button>
                  )}
                  <span className="wr-texte">{ligne.texte}</span>
                </li>
              );
            })}
          </ol>
        )}
        {vue.tronque && (
          <p className="muted-text wr-tronque">
            {t(
              'Seules les lignes les plus récentes sont affichées. Choisissez une tâche pour voir tout son débat.',
              'Only the most recent lines are shown. Pick a task to see its whole debate.',
            )}
          </p>
        )}
      </section>
    </>
  );
}

function DesaccordLigne({
  d,
  t,
  question,
  titreTache,
  projetDuConseil,
  tacheVivante,
  onConseil,
  onOpenTask,
  onRevoir,
}: {
  d: Desaccord;
  t: Translate;
  question: (sessionId: string) => string;
  titreTache: (taskId: string) => string;
  projetDuConseil: (sessionId: string) => string | null;
  tacheVivante: (taskId: string) => boolean;
  onConseil: (sessionId: string, projectId: string) => void;
  onOpenTask: (taskId: string) => void;
  onRevoir: (taskId: string) => void;
}) {
  const depuis = new Date(d.depuis).toLocaleString();
  if (d.genre === 'conseil') {
    const projet = projetDuConseil(d.sessionId);
    return (
      <li className="wr-desaccord wr-desaccord-conseil">
        <p className="wr-desaccord-titre">
          <span aria-hidden="true">⚖</span> {t('Conseil', 'Council')} « {question(d.sessionId)} »
        </p>
        <p className="wr-desaccord-pourquoi">
          {direIssue(d.issue, t)} — {t('personne n’a tranché depuis', 'nobody has settled since')}{' '}
          {depuis}.
        </p>
        <div className="wr-desaccord-actions">
          <button
            className="btn"
            disabled={!projet}
            onClick={() => projet && onConseil(d.sessionId, projet)}
          >
            {t('Trancher', 'Settle')}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="wr-desaccord wr-desaccord-tache">
      <p className="wr-desaccord-titre">
        <span aria-hidden="true">{d.genre === 'tache' ? '⚔' : '⊘'}</span> « {titreTache(d.taskId)} »
      </p>
      {d.genre === 'tache' ? (
        <>
          <p className="wr-desaccord-pourquoi">
            {t(
              'La contre-expertise conteste cette production, et le renvoi en correction n’a pas eu lieu :',
              'The counter-review contests this production, and the correction retry did not happen:',
            )}{' '}
            {direRaisonRefus(d.raison, t)} ({depuis}).
          </p>
          {d.objections.length > 0 && (
            <ul className="wr-objections">
              {d.objections.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="wr-desaccord-pourquoi">
          {t(
            'Personne n’a pu relire cette production, secours compris : l’Evaluator demande une revue humaine —',
            'Nobody could review this production, fallback included: the Evaluator asks for a human review —',
          )}{' '}
          {d.cause} ({depuis}).
        </p>
      )}
      {/* La Miellerie et le tiroir ne travaillent que sur les tâches que
          l'instantané du tableau de bord connaît (les plus récentes, bornées).
          Hors de lui, la Miellerie sélectionnerait EN SILENCE une autre tâche
          — et l'on revoirait la mauvaise production. Mieux vaut le dire. */}
      {tacheVivante(d.taskId) ? (
        <div className="wr-desaccord-actions">
          <button className="btn" onClick={() => onRevoir(d.taskId)}>
            {t('Revoir en Miellerie', 'Review in the Honey House')}
          </button>
          <button className="btn ghost" onClick={() => onOpenTask(d.taskId)}>
            {t('Ouvrir la tâche', 'Open the task')}
          </button>
        </div>
      ) : (
        <p className="muted-text">
          {t(
            'Tâche hors de l’instantané du tableau de bord (seules les plus récentes y sont) : la Miellerie ne peut pas l’ouvrir d’ici.',
            'Task outside the dashboard snapshot (only the most recent are in it): the Honey House cannot open it from here.',
          )}
        </p>
      )}
    </li>
  );
}
