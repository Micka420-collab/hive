// LES CHANTIERS — l'écran des travaux que le dépôt DÉCLARE.
//
// ─── CE QUI MANQUAIT, ET CE QUE ÇA VALAIT ────────────────────────────────────
//
// Tout le mécanisme existait : un nœud clone le dépôt et lance ce que son
// `package.json` déclare, l'API GitHub lance ce que le dépôt a marqué
// `workflow_dispatch`, et les deux frontières sont éprouvées à la loupe.
//
// Personne ne pouvait s'en servir. C'étaient des routes — utilisables à la
// main, avec un `curl` et un identifiant de projet copié depuis l'URL.
//
// **Un mécanisme sans écran n'existe pas.** C'est le constat qu'a déjà valu Le
// Partage, et avant lui Les Guetteuses et le polyéthisme. Il vaut ici autant :
// le lot était marqué complet, et il l'était — pour quelqu'un qui lit le code.
//
// ─── CE QUE CET ÉCRAN DIT, ET DANS QUEL ORDRE ────────────────────────────────
//
// 1. CE QUE LE DÉPÔT DÉCLARE, pas ce que la ruche sait faire. La liste vient du
//    `package.json` du miroir. Un dépôt sans scripts affiche une liste vide et
//    le DIT — il n'y a pas de « chargement » perpétuel.
//
// 2. CE QUI EST LANÇABLE, ET CE QUI NE L'EST PAS, avec la raison. Un bouton
//    grisé sans explication est une énigme ; ici, `publish` porte sa raison —
//    ça sort de la machine, ça demande un humain.
//
// 3. LA COMMANDE, EN CLAIR. On voit ce qu'on lance avant de le lancer. C'est la
//    même règle que le récapitulatif de l'installeur : rien n'est déclenché
//    sans être nommé d'abord.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchChantiers,
  fetchRuns,
  fetchVerdictChantier,
  fetchWorkflows,
  lancerChantier,
  lancerWorkflowGithub,
} from '../api';
import type { Chantier, RunWorkflow, VerdictChantier, Workflow } from '../api';
import { useT } from '../i18n';
import type { ViewProps } from './shared';
import './chantiers.css';

/** Ce que le bandeau d'état montre, et sa couleur. */
type Ton = 'ok' | 'echec' | 'attente' | 'neutre';

const TONS: Record<string, Ton> = {
  succes: 'ok',
  echec: 'echec',
  en_cours: 'attente',
  annule: 'neutre',
  ignore: 'neutre',
  expire: 'echec',
  action_requise: 'attente',
  neutre: 'neutre',
  inconnue: 'neutre',
};

export default function Chantiers({ snapshot, selectedId, onNavigate }: ViewProps) {
  const t = useT();
  const projets = snapshot.projects;
  const projectId = selectedId ?? projets[0]?.id ?? null;
  const projet = projets.find((p) => p.id === projectId) ?? null;

  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [verdict, setVerdict] = useState<VerdictChantier | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<RunWorkflow[]>([]);
  /**
   * Pourquoi GitHub ne répond pas, le cas échéant.
   *
   * Séparé des chantiers locaux À DESSEIN : un dépôt local sans jeton GitHub
   * est un cas parfaitement normal, et il ne doit pas faire disparaître la
   * moitié de l'écran qui, elle, marche.
   */
  const [refusGithub, setRefusGithub] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [ref, setRef] = useState('main');

  const recharger = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setErreur(null);
    try {
      const [c, v] = await Promise.all([
        fetchChantiers(projectId),
        fetchVerdictChantier(projectId),
      ]);
      setChantiers(c.chantiers);
      setVerdict(v.resultat);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
    // GitHub À PART, et sans `Promise.all` avec ce qui précède : un dépôt sans
    // jeton ou hébergé ailleurs ferait échouer la promesse groupée, et l'écran
    // perdrait les chantiers locaux qui, eux, fonctionnent.
    try {
      const [w, r] = await Promise.all([fetchWorkflows(projectId), fetchRuns(projectId)]);
      setWorkflows(w.workflows);
      setRuns(r.runs);
      setRefusGithub(null);
    } catch (e) {
      setWorkflows([]);
      setRuns([]);
      setRefusGithub(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const lancer = async (nom: string): Promise<void> => {
    if (!projectId) return;
    setEnCours(nom);
    setErreur(null);
    try {
      await lancerChantier(projectId, nom);
      // Le verdict arrive quand le nœud a fini : on repasse le chercher plutôt
      // que de prétendre savoir combien de temps ça prend.
      setTimeout(() => void recharger(), 1500);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

  const lancerWf = async (w: Workflow): Promise<void> => {
    if (!projectId) return;
    setEnCours(`wf-${String(w.id)}`);
    setErreur(null);
    try {
      await lancerWorkflowGithub(projectId, w.id, ref.trim() || 'main');
      setTimeout(() => void recharger(), 2000);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

  if (!projet) {
    return (
      <div className="mc-chantiers">
        <div className="ch-vide">
          <span className="marque" aria-hidden="true" />
          <p>
            {t(
              'Les chantiers apparaissent avec un projet.',
              'Works appear once you have a project.',
            )}
          </p>
          <button className="btn primary" type="button" onClick={() => onNavigate('projets')}>
            {t('Aller aux projets', 'Go to projects')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-chantiers">
      <header className="ch-tete">
        <div>
          <h2>
            <span className="marque" aria-hidden="true" /> {t('Les Chantiers', 'The Works')}
          </h2>
          <p className="ch-sous">
            {t(
              'Les travaux que ce dépôt DÉCLARE. La ruche choisit dans cette liste ; elle n’invente pas de commande.',
              'The works this repository DECLARES. The hive picks from this list; it never invents a command.',
            )}
          </p>
        </div>
        {projets.length > 1 && (
          <select
            className="ch-projet"
            value={projet.id}
            onChange={(e) => onNavigate('chantiers', e.target.value)}
            aria-label={t('Projet', 'Project')}
          >
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {erreur && <p className="ch-erreur">{erreur}</p>}

      <section className="ch-bloc">
        <h3>{t('Sur un nœud', 'On a node')}</h3>
        {chantiers.length === 0 ? (
          <p className="ch-vide ch-vide-ligne">
            <span className="marque" aria-hidden="true" />{' '}
            {t(
              'Ce dépôt ne déclare aucun script. Rien à lancer — et ce n’est pas une erreur.',
              'This repository declares no script. Nothing to run — and that is not an error.',
            )}
          </p>
        ) : (
          <ul className="ch-liste">
            {chantiers.map((c) => (
              <li key={c.nom} className={`ch-item ch-${c.nature}`}>
                <div className="ch-nom">
                  <strong>{c.nom}</strong>
                  <code>{c.commande}</code>
                </div>
                {c.automatisable ? (
                  <button
                    type="button"
                    className="ch-lancer"
                    disabled={enCours === c.nom}
                    onClick={() => void lancer(c.nom)}
                  >
                    {enCours === c.nom ? t('Envoi…', 'Sending…') : t('Lancer', 'Run')}
                  </button>
                ) : (
                  // ─── LE REFUS PORTE SA RAISON ─────────────────────────────
                  //
                  // Un bouton grisé sans explication est une énigme. Les deux
                  // raisons sont différentes et appellent des gestes différents :
                  // « ça sort de la machine » se contourne par un humain,
                  // « on ne sait pas » se corrige en renommant le script.
                  <span className="ch-refus">
                    {c.nature === 'sortant'
                      ? t(
                          'Sort de la machine — demande un humain',
                          'Leaves the machine — needs a human',
                        )
                      : t(
                          'Nature inconnue — non automatisable',
                          'Unknown nature — not automatable',
                        )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {verdict && (
          <div className={`ch-verdict ch-v-${verdict.ok ? 'ok' : 'echec'}`}>
            <strong>
              {verdict.nom} — {verdict.ok ? t('réussi', 'passed') : t('échoué', 'failed')}
              {verdict.code !== null && ` (${t('code', 'exit')} ${String(verdict.code)})`}
            </strong>
            {verdict.refused && <p className="ch-refuse">{verdict.refused}</p>}
            {/* La sortie vient du dépôt : c'est une DONNÉE. React échappe le
                texte, et `pre` garde sa structure sans l'interpréter. */}
            {verdict.sortie !== '' && <pre className="ch-sortie">{verdict.sortie}</pre>}
          </div>
        )}
      </section>

      <section className="ch-bloc">
        <h3>{t('Sur GitHub', 'On GitHub')}</h3>
        {refusGithub ? (
          <p className="ch-vide ch-vide-ligne">
            <span className="marque" aria-hidden="true" /> {refusGithub}
          </p>
        ) : workflows.length === 0 ? (
          <p className="ch-vide ch-vide-ligne">
            <span className="marque" aria-hidden="true" />{' '}
            {t('Aucun workflow déclaré.', 'No workflow declared.')}
          </p>
        ) : (
          <>
            <label className="ch-ref">
              {t('Branche ou tag', 'Branch or tag')}
              <input value={ref} onChange={(e) => setRef(e.target.value)} spellCheck={false} />
            </label>
            <ul className="ch-liste">
              {workflows.map((w) => (
                <li key={w.id} className="ch-item">
                  <div className="ch-nom">
                    <strong>{w.nom}</strong>
                    <code>{w.chemin}</code>
                  </div>
                  <button
                    type="button"
                    className="ch-lancer"
                    disabled={enCours === `wf-${String(w.id)}`}
                    onClick={() => void lancerWf(w)}
                  >
                    {enCours === `wf-${String(w.id)}`
                      ? t('Envoi…', 'Sending…')
                      : t('Lancer', 'Run')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {runs.length > 0 && (
          <ul className="ch-runs">
            {runs.slice(0, 10).map((r) => (
              <li key={r.id} className={`ch-run ch-t-${TONS[r.conclusion] ?? 'neutre'}`}>
                <span className="ch-run-nom">{r.nom}</span>
                <span className="ch-run-branche">{r.branche}</span>
                <span className="ch-run-etat">{r.conclusion.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
