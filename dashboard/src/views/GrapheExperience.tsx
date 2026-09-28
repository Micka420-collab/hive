// Le graphe d'expérience, lu — une LISTE et un VOISINAGE, pas un canevas.
//
// ─── POURQUOI PAS UN DESSIN ──────────────────────────────────────────────────
//
// Le Cerveau a son canevas, et il a dû écrire une vue liste à côté pour qu'un
// lecteur d'écran et le clavier y aient accès (`Cerveau.tsx`, décision 1). Ici
// la question est plus simple — « à quoi ce fait est-il relié, et d'où le
// sait-on ? » — et une liste y répond mieux qu'une pelote : on choisit un
// nœud, on lit ses liens, chacun avec sa NATURE (fait, corrélation, leçon
// validée) et sa PROVENANCE (l'événement du journal ou la note, datés). Un
// voisin se suit d'un clic.
//
// ─── CE QUE L'ÉCRAN NE DÉCIDE PAS ────────────────────────────────────────────
//
// La portée. Le graphe d'un projet est isolé à ce projet par le SERVEUR, quel
// que soit le réglage ; « toute la ruche » n'est proposée qu'à un compte
// administrateur, et le serveur la refuse aux autres de toute façon. L'écran
// dit aussi le réglage de l'hôte — ce que reçoivent les ouvrières — et comment
// le changer : une fédération qu'on ne sait pas ouvrir n'existe pas.

import { useEffect, useState } from 'react';
import { fetchExperience } from '../api';
import type { AuthUser, VueExperience } from '../api';
import { useT } from '../i18n';
import { GENRES_NOEUD } from '../../../src/shared/graphe-experience';
import type { GenreNoeud, NoeudExperience } from '../../../src/shared/graphe-experience';
import type { Project } from '../../../src/shared/types';
import {
  libelleGenre,
  libelleNature,
  libelleNoeud,
  libellePreuve,
  libelleProvenance,
  libelleRelation,
} from './experience-rendu';
import './experience.css';

/** La valeur du sélecteur pour « toute la ruche » — jamais un id de projet (UUID). */
const RUCHE = '*ruche*';

interface Props {
  projects: readonly Project[];
  user: AuthUser | null;
  refreshTick: number;
  onOpenTask: (taskId: string) => void;
}

const date = (ms: number): string => new Date(ms).toLocaleString();

/** Ce que la route attend, depuis la valeur du sélecteur. */
const cibleDe = (portee: string): { projectId: string } | 'ruche' =>
  portee === RUCHE ? 'ruche' : { projectId: portee };

export function GrapheExperience({ projects, user, refreshTick, onOpenTask }: Props) {
  const t = useT();
  const admin = user?.role === 'admin';
  const [choix, setChoix] = useState<string | null>(null);
  const [genre, setGenre] = useState<GenreNoeud | null>(null);
  const [noeud, setNoeud] = useState<string | null>(null);
  const [liste, setListe] = useState<VueExperience | null>(null);
  const [voisinage, setVoisinage] = useState<VueExperience | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Un projet disparu, ou « la ruche » sans être admin : retour au premier projet.
  const portee =
    (choix === RUCHE && admin) || projects.some((p) => p.id === choix)
      ? choix
      : (projects[0]?.id ?? null);
  useEffect(() => {
    if (portee === null) return;
    let vivant = true;
    fetchExperience(cibleDe(portee), genre === null ? {} : { genre })
      .then((v) => {
        if (!vivant) return;
        setListe(v);
        setErreur(null);
      })
      .catch((e: unknown) => {
        if (!vivant) return;
        // Pas d'ancienne liste à côté de l'erreur : elle passerait pour la réponse.
        setListe(null);
        setErreur(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivant = false;
    };
  }, [portee, genre, refreshTick]);

  useEffect(() => {
    if (portee === null || noeud === null) {
      setVoisinage(null);
      return;
    }
    let vivant = true;
    fetchExperience(cibleDe(portee), { noeud })
      .then((v) => vivant && setVoisinage(v))
      // Le nœud n'est plus dans ce graphe (autre portée, journal élagué) : on
      // revient à la liste plutôt que d'afficher un voisinage fantôme.
      .catch(() => vivant && setNoeud(null));
    return () => {
      vivant = false;
    };
  }, [portee, noeud, refreshTick]);

  // L'ancienne portée ne reste pas affichée sous la nouvelle le temps de la
  // lecture : un graphe de A lu comme celui de la ruche serait un mensonge.
  const choisirPortee = (valeur: string) => {
    setChoix(valeur);
    setNoeud(null);
    setGenre(null);
    setListe(null);
    setErreur(null);
  };

  const total = liste ? Object.values(liste.comptes.parGenre).reduce((s, n) => s + n, 0) : 0;
  const liens = liste ? Object.values(liste.comptes.parRelation).reduce((s, n) => s + n, 0) : 0;
  const v = voisinage?.voisinage ?? null;
  const parId = new Map<string, NoeudExperience>(
    v ? [v.centre, ...v.voisins].map((n) => [n.id, n]) : [],
  );
  const nom = (id: string): string => {
    const n = parId.get(id);
    return n ? libelleNoeud(n, t) : id;
  };

  return (
    <section
      className="card panel exp-panel"
      aria-labelledby="exp-titre"
      data-testid="graphe-experience"
    >
      <header className="panel-head">
        <h2 id="exp-titre">
          <span className="marque" aria-hidden="true" />{' '}
          {t('Graphe d’expérience', 'Experience graph')}
        </h2>
        {liste && (
          <span className="panel-count">
            {t(`${total} nœuds · ${liens} liens`, `${total} nodes · ${liens} links`)}
          </span>
        )}
      </header>

      {portee === null ? (
        <p className="empty pad">
          <span className="marque" aria-hidden="true" />{' '}
          {t(
            'Aucun projet : l’expérience naît du travail d’un projet.',
            'No project yet: experience comes from a project’s work.',
          )}
        </p>
      ) : (
        <>
          <div className="exp-barre">
            <label className="exp-portee-choix">
              {t('Portée', 'Scope')}{' '}
              <select value={portee} onChange={(e) => choisirPortee(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {admin && <option value={RUCHE}>{t('Toute la ruche', 'The whole hive')}</option>}
              </select>
            </label>
          </div>
          {liste && (
            <p className="ch-mem-note muted-text exp-reglage" data-testid="exp-reglage">
              {liste.portee === 'ruche'
                ? t(
                    'Vue fédérée : tous les projets, réservée à qui les voit tous.',
                    'Federated view: every project, reserved to whoever sees them all.',
                  )
                : t(
                    'Ce projet seulement — son graphe ne montre rien des autres.',
                    'This project only — its graph shows nothing of the others.',
                  )}{' '}
              {liste.reglage === 'ruche'
                ? t(
                    'Les ouvrières reçoivent aussi l’expérience des projets PUBLICS de la ruche : l’hôte a ouvert la fédération (HIVE_EXPERIENCE_PORTEE=ruche). Un projet privé ne sert la sienne qu’à ses tâches.',
                    'Workers also receive the experience of the hive’s PUBLIC projects: the host opened federation (HIVE_EXPERIENCE_PORTEE=ruche). A private project serves its own only to its tasks.',
                  )
                : t(
                    'Les ouvrières ne reçoivent que l’expérience de leur projet. Fédérer est un réglage de l’hôte : HIVE_EXPERIENCE_PORTEE=ruche dans le .env de la Reine.',
                    'Workers only receive their own project’s experience. Federation is a host setting: HIVE_EXPERIENCE_PORTEE=ruche in the Queen’s .env.',
                  )}
            </p>
          )}
          {erreur && <p className="panel-error ch-mem-note">{erreur}</p>}
          {liste && (
            <div className="filters exp-genres" role="group" aria-label={t('Genres', 'Kinds')}>
              <button
                type="button"
                className={`chip${genre === null ? ' active' : ''}`}
                aria-pressed={genre === null}
                onClick={() => setGenre(null)}
              >
                {t('Tout', 'All')} <span className="chip-count">{total}</span>
              </button>
              {GENRES_NOEUD.filter((g) => liste.comptes.parGenre[g] > 0).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`chip${genre === g ? ' active' : ''}`}
                  aria-pressed={genre === g}
                  onClick={() => setGenre(g)}
                >
                  {libelleGenre(g, t)}{' '}
                  <span className="chip-count">{liste.comptes.parGenre[g]}</span>
                </button>
              ))}
            </div>
          )}

          <div className="exp-colonnes">
            <ul className="exp-liste" aria-label={t('Nœuds récents', 'Recent nodes')}>
              {(liste?.noeuds ?? []).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`exp-noeud${n.id === noeud ? ' actif' : ''}`}
                    aria-pressed={n.id === noeud}
                    onClick={() => setNoeud(n.id)}
                  >
                    <span className={`exp-genre exp-genre-${n.genre}`}>
                      {libelleGenre(n.genre, t)}
                    </span>
                    <span className="exp-nom">{libelleNoeud(n, t)}</span>
                    {n.nature === 'lecon_validee' && (
                      <span className="exp-nature exp-nature-lecon_validee">
                        {libelleNature(n.nature, t)}
                      </span>
                    )}
                    <time className="jtime">{date(n.provenance.date)}</time>
                  </button>
                </li>
              ))}
              {liste && (liste.noeuds ?? []).length === 0 && (
                <li className="empty pad">
                  <span className="marque" aria-hidden="true" />{' '}
                  {t(
                    'Rien encore : ce projet n’a pas de travail journalisé.',
                    'Nothing yet: this project has no journaled work.',
                  )}
                </li>
              )}
            </ul>

            <div className="exp-voisinage" aria-live="polite" data-testid="exp-voisinage">
              {v === null ? (
                <p className="muted-text exp-invite">
                  {t(
                    'Choisissez un nœud : ses liens, leur nature et d’où ils viennent.',
                    'Pick a node: its links, their nature and where they come from.',
                  )}
                </p>
              ) : (
                <>
                  <h3 className="exp-centre">
                    <span className={`exp-genre exp-genre-${v.centre.genre}`}>
                      {libelleGenre(v.centre.genre, t)}
                    </span>{' '}
                    {libelleNoeud(v.centre, t)}
                  </h3>
                  <p className="muted-text exp-provenance">
                    {t('Entré au graphe par', 'Entered the graph through')}{' '}
                    {libelleProvenance(v.centre.provenance, date)}
                    {v.centre.genre === 'task' && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="ch-linklike"
                          onClick={() => onOpenTask(v.centre.id.slice('task:'.length))}
                        >
                          {t('ouvrir la tâche', 'open the task')}
                        </button>
                      </>
                    )}
                  </p>
                  <ul className="exp-aretes">
                    {v.aretes.map((a) => {
                      const preuve = libellePreuve(a, t);
                      // Lu de `de` vers `vers`, toujours : le centre en gras, l'autre
                      // bout se suit d'un clic — quel que soit le sens de l'arête.
                      const bout = (id: string) =>
                        id === v.centre.id ? (
                          <span className="exp-soi">{nom(id)}</span>
                        ) : (
                          <button
                            type="button"
                            className="ch-linklike"
                            onClick={() => setNoeud(id)}
                            title={t('Suivre ce lien', 'Follow this link')}
                          >
                            {nom(id)}
                          </button>
                        );
                      return (
                        <li key={`${a.de}|${a.relation}|${a.vers}`} className="exp-arete">
                          <span className={`exp-nature exp-nature-${a.nature}`}>
                            {libelleNature(a.nature, t)}
                          </span>{' '}
                          {bout(a.de)} <em>{libelleRelation(a.relation, t)}</em> {bout(a.vers)}
                          {preuve && <span className="muted-text"> ({preuve})</span>}
                          <span className="exp-sources muted-text">
                            {a.provenances.map((p) => libelleProvenance(p, date)).join(' · ')}
                            {a.occurrences > a.provenances.length &&
                              t(
                                ` · ${a.occurrences} faits en tout`,
                                ` · ${a.occurrences} facts in all`,
                              )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {v.total > v.aretes.length && (
                    <p className="muted-text">
                      {t(
                        `${v.aretes.length} liens les plus récents sur ${v.total}.`,
                        `${v.aretes.length} most recent links of ${v.total}.`,
                      )}
                    </p>
                  )}
                  {(voisinage?.similaires ?? []).length > 0 && (
                    <div className="exp-similaires" data-testid="exp-similaires">
                      <h4>
                        {t('Contextes similaires', 'Similar contexts')}{' '}
                        <span className="exp-nature exp-nature-correlation">
                          {t('corrélations, pas des règles', 'correlations, not rules')}
                        </span>
                      </h4>
                      <ul>
                        {(voisinage?.similaires ?? []).map((s) => (
                          <li key={s.taskId}>
                            <button
                              type="button"
                              className="ch-linklike"
                              onClick={() => setNoeud(`task:${s.taskId}`)}
                            >
                              {s.titre || s.taskId.slice(0, 8)}
                            </button>{' '}
                            <span className="muted-text">
                              {[
                                s.communs.erreurs.length > 0 &&
                                  t(
                                    `${s.communs.erreurs.length} signature(s) d’erreur en commun`,
                                    `${s.communs.erreurs.length} shared error signature(s)`,
                                  ),
                                s.communs.fichiers.length > 0 &&
                                  t(
                                    `fichiers en commun : ${s.communs.fichiers.join(', ')}`,
                                    `shared files: ${s.communs.fichiers.join(', ')}`,
                                  ),
                                s.communs.categorie && t('même catégorie', 'same category'),
                                s.issue.rendue
                                  ? t('rendue', 'delivered')
                                  : t('jamais rendue', 'never delivered'),
                                s.issue.validee && t('validée', 'validated'),
                                s.issue.contestee && t('contestée', 'contested'),
                                s.issue.tentativesEchouees > 0 &&
                                  t(
                                    `${s.issue.tentativesEchouees} tentative(s) échouée(s)`,
                                    `${s.issue.tentativesEchouees} failed attempt(s)`,
                                  ),
                                s.modeles.length > 0 && s.modeles.join(', '),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          {liste?.lecture.tronquee && (
            <p className="ch-mem-note muted-text">
              {t(
                'Le journal a été élagué : des faits plus anciens ONT PU sortir du graphe.',
                'The journal has been pruned: older facts MAY have left the graph.',
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
