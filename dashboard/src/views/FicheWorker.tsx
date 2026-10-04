// LA FICHE D'UN WORKER (façon Delos, adaptée à Hive) — en tête de la Chambre.
//
// La carte de l'Essaim dit qui est là ; la Chambre dit ce qu'il touche. La
// fiche dit QUI IL EST devenu : son visage (un avatar tiré de son identifiant),
// son identité, son fournisseur et le modèle qu'il fait tourner, ses
// compétences par genre de tâche, les erreurs que la ruche a retenues de lui,
// les débats de la War Room où il a pris la parole, ses ressources et ses
// limites, les missions qu'il a rendues.
//
// Tout vient de `GET /api/workers/:nodeId/fiche`, fait par fait. Trois règles :
//   · un genre jamais jugé est INCONNU — jamais 0 % ;
//   · aucune moyenne de coût, de temps ou de qualité n'est calculée ici : les
//     missions se lisent une par une, et leur coût déclaré dans leur tiroir ;
//   · ce que l'API ne sait pas encore (la mémoire attribuée) est DIT.

import { useCallback, useMemo, useState } from 'react';
import { fetchFicheWorker } from '../api';
import type { FicheWorker as Fiche } from '../api';
import { AvatarWorker, EmptyState, ErrorState, Skeleton, Tabs } from '../composants';
import { useLang, useT } from '../i18n';
import { formatMs } from '../ui';
import { libelleAgent } from '../../../src/shared/agent-libelle';
import { libelleMetier } from '../../../src/orchestrator/metier';
import { CATEGORIES } from '../../../src/orchestrator/aiguillage';
import type { Categorie } from '../../../src/orchestrator/aiguillage';
import type { RoleDebat } from '../../../src/orchestrator/fiche-worker';
import type { WorkerReputationSnapshot } from '../../../src/orchestrator/workers';
import type { HiveNode } from '../../../src/shared/types';
import { direEntree } from './warroom-rendu';
import { timeShort, useApiPoll } from './shared';
import type { ViewId } from './shared';
import './fiche-worker.css';

type Traduire = ReturnType<typeof useT>;

const LIBELLES_CATEGORIE: Record<Categorie, [string, string]> = {
  ideation: ['Idéation', 'Ideation'],
  code: ['Code', 'Code'],
  correction: ['Correction', 'Bug fixing'],
  refactorisation: ['Refactorisation', 'Refactoring'],
  test: ['Tests', 'Tests'],
  documentation: ['Documentation', 'Documentation'],
  autre: ['Autre', 'Other'],
};

/** Une réputation en mots ; `null` = jamais jugé, dit comme tel. */
function direReputation(r: WorkerReputationSnapshot | undefined, t: Traduire): string | null {
  if (!r || r.essais === 0 || r.moyenne === null) return null;
  return t(
    `${Math.round(r.moyenne * 100)} % · ${r.essais} avis`,
    `${Math.round(r.moyenne * 100)}% · ${r.essais} reviews`,
  );
}

function direRole(role: RoleDebat, t: Traduire): string {
  switch (role) {
    case 'eclaireuse':
      return t('au Conseil', 'at the Council');
    case 'relecteur':
      return t('relectrice', 'reviewer');
    case 'auteur':
      return t('sa production', 'its production');
  }
}

/** Octets en Mo, lisibles ; les ressources sont des mesures du processus, pas une facture. */
function mo(octets: number): string {
  return `${(octets / (1024 * 1024)).toFixed(0)} Mo`;
}

export function FicheWorker({
  nodeId,
  node,
  refreshTick,
  onOpenTask,
  onNavigate,
  nomNoeud,
}: {
  nodeId: string;
  /** Le nœud tel que l'instantané le voit — pour le bac déclaré ; absent = inconnu. */
  node: HiveNode | undefined;
  refreshTick: number;
  onOpenTask: (taskId: string) => void;
  onNavigate: (view: ViewId, selectedId?: string) => void;
  nomNoeud: (nodeId: string) => string;
}) {
  const t = useT();
  const lang = useLang();
  const en = lang === 'en';
  const lire = useCallback(() => fetchFicheWorker(nodeId), [nodeId]);
  const { data: fiche, error, refresh } = useApiPoll<Fiche>(lire, 15_000, refreshTick);
  const [onglet, setOnglet] = useState('competences');

  const titreTache = useCallback(
    (taskId: string, titre: string | null) =>
      titre ?? fiche?.taches[taskId]?.titre ?? t('tâche élaguée', 'pruned task'),
    [fiche, t],
  );

  const onglets = useMemo(() => {
    if (!fiche) return [];
    const w = fiche.worker;
    const categories = CATEGORIES.map((c) => ({ c, r: w.reputationParCategorie?.[c] }));
    return [
      {
        id: 'competences',
        libelle: t('Compétences', 'Skills'),
        contenu: (
          <div className="fw-bloc">
            <p className="fw-note">
              {t(
                'Réputation calculée sur les seuls résultats rendus par ce Worker et jugés. Un genre jamais jugé est inconnu, pas nul.',
                'Reputation from this Worker’s judged results only. A never-judged category is unknown, not zero.',
              )}
            </p>
            <table className="fw-table">
              <caption className="ds-invisible">
                {t('Réputation par genre de tâche', 'Reputation by task category')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t('Genre', 'Category')}</th>
                  <th scope="col">{t('Réputation', 'Reputation')}</th>
                  <th scope="col">
                    {t('Appliquer · améliorer · refaire', 'Apply · improve · redo')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map(({ c, r }) => {
                  const dit = direReputation(r, t);
                  return (
                    <tr key={c} data-categorie={c}>
                      <th scope="row">
                        {en ? LIBELLES_CATEGORIE[c][1] : LIBELLES_CATEGORIE[c][0]}
                      </th>
                      <td className={dit ? undefined : 'fw-inconnu'}>
                        {dit ?? t('jamais jugé', 'never judged')}
                      </td>
                      <td className="fw-num">
                        {r && r.essais > 0 ? `${r.appliquer} · ${r.ameliorer} · ${r.refaire}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {w.modeles && w.modeles.length > 0 && (
              <ul className="fw-modeles" aria-label={t('Modèles déclarés', 'Declared models')}>
                {w.modeles.map((m) => (
                  <li key={m.modele}>
                    <span className="fw-modele">{m.modele}</span>
                    <span className="fw-muet">
                      {direReputation(m.reputation, t) ??
                        t('à explorer sur ce poste', 'to explore here')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
      },
      {
        id: 'lecons',
        libelle: t(
          `Erreurs apprises (${fiche.lecons.length})`,
          `Learned errors (${fiche.lecons.length})`,
        ),
        contenu: (
          <div className="fw-bloc">
            {fiche.lecons.length === 0 ? (
              <EmptyState
                titre={t('Aucun échec rendu par ce Worker', 'No failure returned by this Worker')}
                texte={t(
                  'Parmi ses derniers résultats, aucun échec n’a laissé de leçon à la Couveuse.',
                  'Among its latest results, no failure left a lesson for the Brood.',
                )}
              />
            ) : (
              <ol className="fw-liste">
                {fiche.lecons.map((l) => (
                  <li key={l.resultId} className="fw-lecon">
                    <button type="button" className="fw-lien" onClick={() => onOpenTask(l.taskId)}>
                      {titreTache(l.taskId, l.titre)}
                    </button>
                    <time className="fw-muet" dateTime={new Date(l.createdAt).toISOString()}>
                      {timeShort(l.createdAt)}
                    </time>
                    <code className="fw-extrait">{l.extrait}</code>
                  </li>
                ))}
              </ol>
            )}
            <p className="fw-note" data-testid="fiche-memoire">
              {t(
                'La mémoire de la ruche (Hive Mind) ne dit pas encore quelle ouvrière a produit chaque souvenir : elle n’est pas rattachée à cette fiche.',
                'The hive memory (Hive Mind) does not record yet which worker produced each memory: it is not linked to this sheet.',
              )}
            </p>
          </div>
        ),
      },
      {
        id: 'debats',
        libelle: t(`Débats (${fiche.debats.length})`, `Debates (${fiche.debats.length})`),
        contenu: (
          <div className="fw-bloc">
            {fiche.debats.length === 0 ? (
              <EmptyState
                titre={t('Aucun débat pour ce Worker', 'No debate for this Worker')}
                texte={t(
                  'Ni proposition au Conseil, ni relecture rendue, ni production contestée dans le journal retenu.',
                  'No Council proposal, no review returned, no contested production in the kept journal.',
                )}
              />
            ) : (
              <ol className="fw-liste">
                {fiche.debats.map(({ role, entree }) => {
                  const ligne = direEntree(entree, t, nomNoeud);
                  const tache = 'taskId' in entree ? entree.taskId : null;
                  return (
                    <li key={entree.id} className={`fw-debat fw-ton-${ligne.ton}`}>
                      <span className="fw-role">{direRole(role, t)}</span>
                      <span>{ligne.texte}</span>
                      {tache && (
                        <button type="button" className="fw-lien" onClick={() => onOpenTask(tache)}>
                          {titreTache(tache, null)}
                        </button>
                      )}
                      <time className="fw-muet" dateTime={new Date(entree.ts).toISOString()}>
                        {timeShort(entree.ts)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
            {fiche.journalElague && (
              <p className="fw-note">
                {t(
                  'Le journal a déjà perdu ses lignes les plus anciennes : ce fil n’est pas toute l’histoire.',
                  'The journal already dropped its oldest lines: this thread is not the whole story.',
                )}
              </p>
            )}
            <button type="button" className="btn ghost" onClick={() => onNavigate('warroom')}>
              {t('Ouvrir la War Room', 'Open the War Room')}
            </button>
          </div>
        ),
      },
      {
        id: 'missions',
        libelle: t(`Missions (${fiche.missions.length})`, `Missions (${fiche.missions.length})`),
        contenu: (
          <div className="fw-bloc">
            <p className="fw-note">
              {t(
                'Chaque tentative rendue, une par une. Le coût déclaré par le CLI se lit dans la chronologie de la tâche ; aucune moyenne n’est calculée ici.',
                'Each returned attempt, one by one. The CLI’s declared cost is in the task timeline; no average is computed here.',
              )}
            </p>
            {fiche.missions.length === 0 ? (
              <EmptyState titre={t('Aucune mission rendue', 'No mission returned')} />
            ) : (
              <table className="fw-table">
                <caption className="ds-invisible">
                  {t('Missions rendues', 'Returned missions')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Tâche', 'Task')}</th>
                    <th scope="col">{t('Issue', 'Outcome')}</th>
                    <th scope="col">{t('Durée', 'Duration')}</th>
                    <th scope="col">{t('Ressources', 'Resources')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fiche.missions.map((m) => (
                    <tr key={m.resultId}>
                      <th scope="row">
                        <button
                          type="button"
                          className="fw-lien"
                          onClick={() => onOpenTask(m.taskId)}
                        >
                          {titreTache(m.taskId, m.titre)}
                        </button>
                      </th>
                      <td className={m.succes ? 'fw-ok' : 'fw-ko'}>
                        {m.succes ? t('✓ rendue', '✓ returned') : t('✗ échec', '✗ failed')}
                      </td>
                      <td className="fw-num">{formatMs(m.dureeMs)}</td>
                      <td className="fw-num">
                        {m.usage
                          ? `${formatMs(Math.round((m.usage.userCpuMicros + m.usage.systemCpuMicros) / 1000))} CPU · ${mo(m.usage.maxRssBytes)}`
                          : t('non mesurées', 'not measured')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ),
      },
      {
        id: 'ressources',
        libelle: t('Ressources & limites', 'Resources & limits'),
        contenu: (
          <div className="fw-bloc fw-deux">
            <dl className="fw-dl">
              <dt>{t('Plateforme', 'Platform')}</dt>
              <dd>{w.plateforme ?? t('non déclarée', 'not declared')}</dd>
              <dt>{t('Bac à sable (déclaré)', 'Sandbox (declared)')}</dt>
              <dd>
                {node?.isolement
                  ? `${node.isolement.niveau}${node.isolement.fournisseur ? ` · ${node.isolement.fournisseur}` : ''}`
                  : t('non déclaré', 'not declared')}
              </dd>
              <dt>{t('Charge', 'Load')}</dt>
              <dd>
                {w.running}/{w.maxConcurrency} · {w.slotsLibres}{' '}
                {t('place(s) libre(s)', 'free slot(s)')}
              </dd>
              <dt>{t('Outils IA constatés', 'Observed AI tools')}</dt>
              <dd>
                {w.outils === undefined
                  ? t('non déclarés (nœud ancien)', 'not declared (older node)')
                  : w.outils.length === 0
                    ? t('aucun', 'none')
                    : w.outils
                        .map(
                          (o) =>
                            `${libelleAgent(o.agent, en)}${o.binaire ? '' : ` (${t('absent', 'missing')})`}`,
                        )
                        .join(' · ')}
              </dd>
            </dl>
            <dl className="fw-dl">
              <dt>{t('Délégation · profondeur', 'Delegation · depth')}</dt>
              <dd>≤ {w.autonomie?.delegation.maxDepth ?? '—'}</dd>
              <dt>{t('Enfants par tâche', 'Children per task')}</dt>
              <dd>≤ {w.autonomie?.delegation.maxChildrenPerParent ?? '—'}</dd>
              <dt>{t('Descendants par racine', 'Descendants per root')}</dt>
              <dd>≤ {w.autonomie?.delegation.maxDescendantsPerRoot ?? '—'}</dd>
              <dt>{t('Durée d’une délégation', 'Delegation duration')}</dt>
              <dd>{w.autonomie ? `≤ ${formatMs(w.autonomie.delegation.maxDurationMs)}` : '—'}</dd>
            </dl>
          </div>
        ),
      },
    ];
  }, [fiche, t, en, nomNoeud, onOpenTask, onNavigate, titreTache, node]);

  if (!fiche) {
    return (
      <section className="ch-zone fw-fiche" aria-label={t('Fiche du Worker', 'Worker sheet')}>
        {error ? (
          <ErrorState
            titre={t('La fiche n’a pas pu être lue', 'The sheet could not be read')}
            detail={error}
            onReessayer={refresh}
          />
        ) : (
          <Skeleton lignes={4} libelle={t('Lecture de la fiche…', 'Reading the sheet…')} />
        )}
      </section>
    );
  }

  const w = fiche.worker;
  const nom = w.identite?.bapteme?.nom ?? null;
  const metier = w.identite?.metier
    ? libelleMetier(w.identite.metier.metier, en ? 'en' : 'fr')
    : null;
  const enCours = fiche.modelesCourants;

  return (
    <section className="ch-zone fw-fiche" aria-labelledby="fw-titre" data-testid="fiche-worker">
      <header className="fw-tete">
        <AvatarWorker id={w.id} taille={72} />
        <div className="fw-identite">
          <p className="fw-surtitre">{t('Fiche Worker', 'Worker sheet')}</p>
          <h2 id="fw-titre" className="fw-nom">
            {nom ?? w.name}
          </h2>
          <p className="fw-muet">
            {nom ? `${t('Technique', 'Technical')} · ${w.name} · ` : ''}
            {t('Hôte', 'Host')} · {w.ownerName}
          </p>
        </div>
        <dl className="fw-faits">
          <div>
            <dt>{t('Rôle', 'Role')}</dt>
            <dd>{metier ?? t('non assigné', 'not assigned')}</dd>
          </div>
          <div>
            <dt>{t('Fournisseur', 'Provider')}</dt>
            <dd>{libelleAgent(w.agentType, en)}</dd>
          </div>
          <div>
            <dt>{t('Modèle en cours', 'Current model')}</dt>
            <dd data-testid="fiche-modele-courant">
              {enCours.length === 0
                ? t('aucune mission en cours', 'no mission running')
                : enCours
                    .map((m) => m.modele ?? t('défaut du nœud', 'node default'))
                    .filter((m, i, a) => a.indexOf(m) === i)
                    .join(' · ')}
            </dd>
          </div>
          <div>
            <dt>{t('Réputation', 'Reputation')}</dt>
            <dd>{direReputation(w.reputation, t) ?? t('pas encore jugé', 'not judged yet')}</dd>
          </div>
          <div>
            <dt>{t('Statut', 'Status')}</dt>
            <dd>
              <span className={`conn ${w.status}`}>
                <span className="conn-dot" aria-hidden="true" />
                {w.status === 'online' ? t('en ligne', 'online') : t('hors ligne', 'offline')}
              </span>
            </dd>
          </div>
        </dl>
      </header>
      <Tabs
        libelle={t('Sections de la fiche', 'Sheet sections')}
        onglets={onglets}
        actif={onglet}
        onChange={setOnglet}
      />
    </section>
  );
}
