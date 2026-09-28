// LES MISSIONS D'UN PROJET, LEUR REJEU, ET LA COMPARAISON — le Time Travel.
//
// Une mission est un épisode d'activité du projet : la Reine en garde deux
// instantanés (début, fin). Cet écran les liste, propose de REJOUER une
// mission dans un projet neuf — autre modèle, autre routage, autre autonomie —
// et, sur un projet de rejeu, met la mission source et le rejeu côte à côte.
//
// Trois choses que l'écran doit dire, parce qu'elles se perdraient sans bruit :
//
//   · un rejeu n'ÉCRIT RIEN chez personne de lui-même : ses pull requests,
//     fusions, commits, poussées et workflows sont simulés et rangés. Le
//     formulaire le dit AVANT le clic, le bandeau du rejeu le redit, avec la
//     liste de ce qui a été simulé ;
//   · une comparaison ne vaut que ce que valent ses données : « inconnu »
//     s'écrit « inconnu », une couverture partielle « au moins », une mission
//     en vol « provisoire », un journal élagué « incomplet » ;
//   · rien ne part au montage : la lecture se demande (même règle que les
//     livraisons), et rejouer est un geste, jamais un effet de rafraîchissement.

import { useState } from 'react';
import { fetchComparaisonRejeu, fetchMissions, rejouerMission } from '../api';
import type { ComparaisonMissions, MissionVue, RejeuVue, SurchargesRejeu } from '../api';
import { useT } from '../i18n';
import type { Project } from '../../../src/shared/types';
import {
  direDuree,
  direEcart,
  direEcartCompte,
  direGenre,
  direPolitique,
  direSomme,
} from './missions-rendu';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const POLITIQUES = ['apprise', 'figee', 'neutre'] as const;
const NIVEAUX = ['off', 'propose', 'gouverne', 'plein'] as const;

/**
 * Mission source contre rejeu — c'est ici que « inconnu » risquerait de
 * devenir « 0 » (éprouvé par tests/missions-rejeu-ecran.test.tsx, à travers
 * `MissionsProjet`).
 */
function ComparaisonRejeu({ c }: { c: ComparaisonMissions }) {
  const t = useT();
  const { original: o, rejeu: r, ecarts: e } = c;
  const lignes: Array<[string, string, string, string]> = [
    [
      t('Tâches réussies', 'Tasks done'),
      `${o.taches.done}`,
      `${r.taches.done}`,
      direEcartCompte(e.tachesReussies),
    ],
    [
      t('Échouées · annulées', 'Failed · cancelled'),
      `${o.taches.failed} · ${o.taches.cancelled}`,
      `${r.taches.failed} · ${r.taches.cancelled}`,
      '',
    ],
    [
      t('Coût déclaré', 'Declared cost'),
      direSomme(o.cout, 'usd', t),
      direSomme(r.cout, 'usd', t),
      direEcart(e.cout, 'usd', t),
    ],
    [
      t('Temps modèle déclaré', 'Declared model time'),
      direSomme(o.dureeApiMs, 'ms', t),
      direSomme(r.dureeApiMs, 'ms', t),
      direEcart(e.dureeApiMs, 'ms', t),
    ],
    [
      t('Temps des ouvrières', 'Worker time'),
      direSomme(o.dureeOuvrieresMs, 'ms', t),
      direSomme(r.dureeOuvrieresMs, 'ms', t),
      direEcart(e.dureeOuvrieresMs, 'ms', t),
    ],
    [
      t('Durée (ouverture → clôture)', 'Duration (open → close)'),
      direDuree(o.dureeMurMs, t),
      direDuree(r.dureeMurMs, t),
      e.dureeMurMs === 'inconnu'
        ? t('inconnu', 'unknown')
        : direEcart({ ecart: e.dureeMurMs, couvertureComplete: true }, 'ms', t),
    ],
    [
      t('Tentatives', 'Attempts'),
      `${o.tentatives}`,
      `${r.tentatives}`,
      direEcartCompte(e.tentatives),
    ],
    [
      t('Tests passés · échoués', 'Tests passed · failed'),
      `${o.validations.tests.passed} · ${o.validations.tests.failed}`,
      `${r.validations.tests.passed} · ${r.validations.tests.failed}`,
      `${direEcartCompte(e.testsPasses)} · ${direEcartCompte(e.testsEchoues)}`,
    ],
    [
      t('Relectures contestées · validées', 'Reviews contested · upheld'),
      `${o.relectures.contestees} · ${o.relectures.validees}`,
      `${r.relectures.contestees} · ${r.relectures.validees}`,
      direEcartCompte(e.relecturesContestees),
    ],
    [
      t('Revues humaines ✔ · ✘', 'Human reviews ✔ · ✘'),
      `${o.revuesHumaines.approuvees} · ${o.revuesHumaines.rejetees}`,
      `${r.revuesHumaines.approuvees} · ${r.revuesHumaines.rejetees}`,
      '',
    ],
    [
      t('Décisions', 'Decisions'),
      `${Object.values(o.decisions).reduce((s, n) => s + n, 0)}`,
      `${Object.values(r.decisions).reduce((s, n) => s + n, 0)}`,
      '',
    ],
  ];
  return (
    <div className="pj-rejeu-cmp">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('Fait', 'Fact')}</th>
            <th scope="col">{t('Mission source', 'Source mission')}</th>
            <th scope="col">
              {t('Rejeu', 'Replay')}
              {r.provisoire && (
                <span className="pj-rejeu-prov"> {t('(provisoire)', '(provisional)')}</span>
              )}
            </th>
            <th scope="col">{t('Écart', 'Delta')}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map(([fait, a, b, ecart]) => (
            <tr key={fait}>
              <th scope="row">{fait}</th>
              <td>{a}</td>
              <td>{b}</td>
              <td className="pj-rejeu-ecart">{ecart}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="pj-sub-note">
        {t(
          'Données déclarées par les CLI des agents et mesurées par la Reine — rien n’est estimé.',
          'Data declared by the agent CLIs and measured by the Queen — nothing is estimated.',
        )}
        {!c.journauxComplets &&
          ' ' +
            t(
              'Journal élagué pendant une des missions : les faits sont incomplets.',
              'Log pruned during one of the missions: the facts are incomplete.',
            )}
      </p>
    </div>
  );
}

/** Le bandeau d'un projet de rejeu : d'où il vient, ce qu'il impose, ce qu'il a simulé. */
function BandeauRejeu({ rejeu }: { rejeu: RejeuVue }) {
  const t = useT();
  const { modele, politiqueRoutage, autonomie } = rejeu.surcharges;
  const simulees = rejeu.actions.filter((a) => a.issue === 'simulee');
  const validees = rejeu.actions.filter((a) => a.issue === 'validee');
  return (
    <div className="pj-rejeu-bandeau" role="note">
      <strong>
        ⟲ {t('Rejeu d’une mission', 'Replay of a mission')} —{' '}
        {t('actions irréversibles simulées', 'irreversible actions simulated')}
      </strong>
      <span className="pj-rejeu-chips">
        <span className="chip">
          {t('modèle', 'model')} : {modele ?? t('celui de l’Aiguillage', 'the router’s choice')}
        </span>
        <span className="chip">
          {t('routage', 'routing')} : {direPolitique(politiqueRoutage, t)}
        </span>
        <span className="chip">
          {t('autonomie', 'autonomy')} : {autonomie ?? t('héritée', 'inherited')}
        </span>
      </span>
      {rejeu.actions.length === 0 ? (
        <span className="pj-sub-note">
          {t('Aucune action irréversible demandée.', 'No irreversible action requested.')}
        </span>
      ) : (
        <ul className="pj-liv-liste">
          {[...simulees, ...validees].map((a) => (
            <li key={`${a.genre}:${a.cible}:${a.issue}`}>
              <span className={`pj-rejeu-issue ${a.issue}`}>
                {a.issue === 'simulee'
                  ? t('simulée', 'simulated')
                  : t('validée par un humain', 'human-approved')}
              </span>
              <span>{direGenre(a.genre, t)}</span>
              <code className="mono pj-liv-titre">{a.cible}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormulaireRejeu({
  projectId,
  mission,
  onCree,
  onAnnule,
}: {
  projectId: string;
  mission: MissionVue;
  onCree: (nom: string) => void;
  onAnnule: () => void;
}) {
  const t = useT();
  const [modele, setModele] = useState('');
  const [politique, setPolitique] = useState<(typeof POLITIQUES)[number]>('apprise');
  const [autonomie, setAutonomie] = useState<'' | (typeof NIVEAUX)[number]>('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const lancer = () => {
    const surcharges: SurchargesRejeu = {
      ...(modele.trim() ? { modele: modele.trim() } : {}),
      politiqueRoutage: politique,
      ...(autonomie ? { autonomie } : {}),
    };
    setEnCours(true);
    setErreur(null);
    rejouerMission(projectId, mission.id, surcharges)
      .then((r) => onCree(r.projet.name))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(false));
  };

  const libellePolitique: Record<(typeof POLITIQUES)[number], string> = {
    apprise: t('apprise — le vécu d’aujourd’hui', 'learned — today’s history'),
    figee: t('figée — le Genome du début de la mission', 'frozen — the mission’s start Genome'),
    neutre: t('neutre — aucun vécu', 'neutral — no history'),
  };

  return (
    <div className="pj-rejeu-form">
      <label>
        {t('Modèle imposé', 'Imposed model')}
        <input
          value={modele}
          onChange={(e) => setModele(e.target.value)}
          placeholder={t('facultatif — ex. claude-opus-5', 'optional — e.g. claude-opus-5')}
          maxLength={120}
        />
      </label>
      <label>
        {t('Routage', 'Routing')}
        <select
          value={politique}
          onChange={(e) => setPolitique(e.target.value as (typeof POLITIQUES)[number])}
        >
          {POLITIQUES.map((p) => (
            <option key={p} value={p}>
              {libellePolitique[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('Autonomie', 'Autonomy')}
        <select
          value={autonomie}
          onChange={(e) => setAutonomie(e.target.value as '' | (typeof NIVEAUX)[number])}
        >
          <option value="">{t('celle de la mission', 'the mission’s')}</option>
          {NIVEAUX.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <p className="pj-sub-note">
        {t(
          'Le rejeu tourne dans un projet neuf, sur le même dépôt. Ses pull requests, fusions, commits, poussées et workflows seront SIMULÉS : rien n’est écrit sur le dépôt sans votre validation explicite.',
          'The replay runs in a new project, on the same repository. Its pull requests, merges, commits, pushes and workflows will be SIMULATED: nothing is written to the repository without your explicit approval.',
        )}
      </p>
      {erreur && <p className="panel-error">{erreur}</p>}
      <div className="pj-rejeu-actions">
        <button className="btn sm" onClick={lancer} disabled={enCours}>
          {enCours ? '…' : t('Lancer le rejeu', 'Start the replay')}
        </button>
        <button className="btn ghost sm" onClick={onAnnule} disabled={enCours}>
          {t('annuler', 'cancel')}
        </button>
      </div>
    </div>
  );
}

export function MissionsProjet({ project }: { project: Project }) {
  const t = useT();
  const [donnees, setDonnees] = useState<{ missions: MissionVue[]; rejeu: RejeuVue | null } | null>(
    null,
  );
  const [comparaison, setComparaison] = useState<ComparaisonMissions | null>(null);
  const [erreurCmp, setErreurCmp] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState<string | null>(null);
  const [crees, setCrees] = useState<Record<string, string>>({});

  const charger = () => {
    setChargement(true);
    setErreur(null);
    setErreurCmp(null);
    fetchMissions(project.id)
      .then((r) => {
        setDonnees(r);
        if (!r.rejeu) return setComparaison(null);
        return fetchComparaisonRejeu(project.id)
          .then(setComparaison)
          .catch((e: unknown) => setErreurCmp(errMsg(e)));
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  return (
    <div className="pj-sub pj-missions">
      <div className="pj-sub-head">
        <h4>{t('Missions · Time Travel', 'Missions · Time Travel')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : donnees
              ? t('relire', 'reload')
              : t('voir les missions', 'show missions')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {donnees?.rejeu && <BandeauRejeu rejeu={donnees.rejeu} />}
      {erreurCmp && <p className="pj-sub-note">{erreurCmp}</p>}
      {comparaison && <ComparaisonRejeu c={comparaison} />}

      {donnees && donnees.missions.length === 0 && (
        <p className="pj-sub-vide">
          {t(
            'Aucune mission rangée : la première s’ouvre à la naissance d’une tâche.',
            'No mission stored yet: the first one opens when a task is created.',
          )}
        </p>
      )}

      {donnees && donnees.missions.length > 0 && (
        <ul className="pj-liv-liste pj-missions-liste">
          {donnees.missions.map((m) => (
            <li key={m.id}>
              <span className={`pj-mission-etat ${m.closeA === null ? 'vol' : 'close'}`}>
                {m.closeA === null ? t('en vol', 'in flight') : t('close', 'closed')}
              </span>
              <time className="mono">{new Date(m.ouverteA).toLocaleString()}</time>
              <span className="pj-liv-titre">
                {m.tachesPlan === null
                  ? t('instantané illisible', 'unreadable snapshot')
                  : `${m.tachesPlan} ${t('tâche(s) au plan', 'planned task(s)')}`}
                {m.resume &&
                  ` · ✔ ${m.resume.taches.done} ✘ ${m.resume.taches.failed} ⊘ ${m.resume.taches.cancelled}` +
                    ` · ${t('coût déclaré', 'declared cost')} : ${direSomme(m.resume.cout, 'usd', t)}`}
                {m.rejeux.length > 0 && ` · ${m.rejeux.length} ${t('rejeu(x)', 'replay(s)')}`}
              </span>
              {crees[m.id] ? (
                <span className="pj-liv-repris">✔ {crees[m.id]}</span>
              ) : (
                <button
                  className="btn ghost sm"
                  onClick={() => setFormulaire(formulaire === m.id ? null : m.id)}
                  disabled={!m.rejouable}
                  aria-expanded={formulaire === m.id}
                  title={
                    m.rejouable
                      ? t('Rejouer cette mission', 'Replay this mission')
                      : m.manques.join(' ; ') || t('plan non rejouable', 'plan cannot be replayed')
                  }
                >
                  {t('Rejouer…', 'Replay…')}
                </button>
              )}
              {formulaire === m.id && (
                <FormulaireRejeu
                  projectId={project.id}
                  mission={m}
                  onAnnule={() => setFormulaire(null)}
                  onCree={(nom) => {
                    setCrees((c) => ({ ...c, [m.id]: nom }));
                    setFormulaire(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
