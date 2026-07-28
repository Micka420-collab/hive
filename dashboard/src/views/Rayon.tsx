// Le Rayon — le code du projet, ouvert aux abeilles.
//
// ─── CE QUE CETTE VUE CHANGE ─────────────────────────────────────────────────
//
// Un membre voyait des TÂCHES : des titres, des états, des diffs. Jamais le
// code. On travaillait sur un projet sans pouvoir l'ouvrir. Ici, le dépôt est
// là, entier, à côté des tâches qui le transforment.
//
// ─── TROIS DÉCISIONS D'INTERFACE, ET POURQUOI ────────────────────────────────
//
// 1. L'ARBRE SE CHARGE DOSSIER PAR DOSSIER. Un dépôt réel a des dizaines de
//    milliers de fichiers ; les demander d'un coup ferait attendre plusieurs
//    secondes pour afficher une racine de douze lignes. On ne demande que ce
//    qu'on déplie, et ce qui a été déplié reste en mémoire.
//
// 2. LE REFUS S'AFFICHE, IL NE DISPARAÎT PAS. Cliquer sur un fichier binaire
//    ou trop gros doit DIRE pourquoi il ne s'ouvre pas. Une vue qui ne réagit
//    pas au clic laisse croire à une panne, et on recharge la page pour rien.
//
// 3. LA LECTURE EST LE DÉFAUT, POUR TOUT LE MONDE. L'éditeur s'ouvre en
//    lecture même pour la Reine : ce qu'on voit ici est le MIROIR du dépôt, pas
//    une copie de travail. Laisser modifier un texte qui ne sera jamais
//    enregistré nulle part est le pire des mensonges d'interface — on croit
//    avoir corrigé quelque chose, et rien n'est parti.

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { fetchFichierRayon, fetchRayon } from '../api';
import type { EntreeRayon, FichierRayon } from '../api';
import type { ViewProps } from './shared';
import { sansIdentifiants } from '../../../src/shared/projet-public';
import { useT } from '../i18n';
import './rayon.css';

const CodeEditor = lazy(() => import('../CodeEditor'));
import type { CodeLang } from '../CodeEditor';

/** Le contenu connu d'un dossier, et son état de chargement. */
interface Noeud {
  entrees: EntreeRayon[];
  ouvert: boolean;
}

/** Une taille lisible : « 1,2 ko » vaut mieux que « 1234 ». */
function taille(octets: number, t: (fr: string, en: string) => string): string {
  if (octets < 1024) return `${octets} ${t('o', 'B')}`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} ${t('ko', 'kB')}`;
  return `${(octets / (1024 * 1024)).toFixed(1)} ${t('Mo', 'MB')}`;
}

/** L'icône d'un fichier, d'après son extension. Purement indicatif. */
function icone(e: EntreeRayon, ouvert: boolean): string {
  if (e.type === 'dossier') return ouvert ? '📂' : '📁';
  const n = e.nom.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(n)) return '📜';
  if (/\.(json|ya?ml|toml)$/.test(n)) return '⚙️';
  if (/\.(md|txt)$/.test(n)) return '📝';
  if (/\.(css|scss|html?)$/.test(n)) return '🎨';
  if (/\.(png|jpe?g|gif|svg|ico|webp)$/.test(n)) return '🖼';
  return '📄';
}

export default function Rayon({ snapshot, selectedId, onNavigate }: ViewProps) {
  const t = useT();
  const projets = snapshot.projects;
  // Le projet du hash s'il existe encore, sinon le premier — jamais `undefined`
  // silencieusement : un lien partagé vers un projet supprimé doit retomber sur
  // quelque chose plutôt que sur un écran vide.
  const projet = projets.find((p) => p.id === selectedId) ?? projets[0] ?? null;

  const [dossiers, setDossiers] = useState<Record<string, Noeud>>({});
  const [fichier, setFichier] = useState<FichierRayon | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  const charger = useCallback(async (projectId: string, chemin: string) => {
    try {
      const r = await fetchRayon(projectId, chemin);
      setDossiers((d) => ({ ...d, [chemin]: { entrees: r.entrees, ouvert: true } }));
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Changer de projet remet tout à zéro : garder l'arbre du précédent
  // afficherait les fichiers d'un dépôt sous le nom d'un autre.
  useEffect(() => {
    setDossiers({});
    setFichier(null);
    setOuvert(null);
    setErreur(null);
    if (!projet) return;
    setChargement(true);
    void charger(projet.id, '').finally(() => setChargement(false));
  }, [projet?.id, charger]);

  const basculer = (chemin: string) => {
    const connu = dossiers[chemin];
    if (connu) {
      setDossiers((d) => ({ ...d, [chemin]: { ...connu, ouvert: !connu.ouvert } }));
      return;
    }
    if (projet) void charger(projet.id, chemin);
  };

  const ouvrir = async (chemin: string) => {
    if (!projet) return;
    setOuvert(chemin);
    setFichier(null);
    setErreur(null);
    try {
      setFichier(await fetchFichierRayon(projet.id, chemin));
    } catch (e) {
      // Le refus s'AFFICHE. Un clic sans réaction laisse croire à une panne.
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  /** Rend un dossier et, s'il est déplié, ses enfants — récursivement. */
  const rendre = (chemin: string, profondeur: number): React.ReactNode => {
    const noeud = dossiers[chemin];
    if (!noeud?.ouvert) return null;
    return noeud.entrees.map((e) => {
      const estDossier = e.type === 'dossier';
      const deplie = dossiers[e.chemin]?.ouvert ?? false;
      return (
        <div key={e.chemin}>
          <button
            className={`ry-entree${ouvert === e.chemin ? ' active' : ''}`}
            style={{ paddingLeft: `${8 + profondeur * 14}px` }}
            onClick={() => (estDossier ? basculer(e.chemin) : void ouvrir(e.chemin))}
            title={e.chemin}
          >
            <span className="ry-icone" aria-hidden="true">
              {icone(e, deplie)}
            </span>
            <span className="ry-nom">{e.nom}</span>
            {!estDossier && <span className="ry-taille">{taille(e.taille, t)}</span>}
          </button>
          {estDossier && rendre(e.chemin, profondeur + 1)}
        </div>
      );
    });
  };

  if (projets.length === 0) {
    return (
      <div className="ry-vide">
        <p>{t('Aucun projet dans la ruche.', 'No project in the hive.')}</p>
        <button className="btn" onClick={() => onNavigate('projets')}>
          {t('Aller aux projets', 'Go to projects')}
        </button>
      </div>
    );
  }

  return (
    <div className="ry">
      <header className="ry-tete">
        <label className="ry-choix">
          <span>{t('Projet', 'Project')}</span>
          <select
            value={projet?.id ?? ''}
            onChange={(ev) => onNavigate('rayon', ev.target.value, { replace: true })}
          >
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {/* LAVÉ DE SES IDENTIFIANTS. Un `repoUrl` peut porter un jeton
            (`https://user:ghp_…@github.com/…`) : l'afficher tel quel le mettrait
            sous les yeux de tout membre du projet, et bientôt de quiconque
            reçoit un partage en lecture. */}
        {projet?.repoUrl && (
          <code className="ry-depot">{sansIdentifiants(projet.repoUrl) ?? '—'}</code>
        )}
      </header>

      <div className="ry-corps">
        <nav className="ry-arbre" aria-label={t('Fichiers du projet', 'Project files')}>
          {chargement && <p className="muted-text">{t('Copie du dépôt…', 'Copying repo…')}</p>}
          {!chargement && !dossiers[''] && !erreur && (
            <p className="muted-text">{t('Rien à afficher.', 'Nothing to show.')}</p>
          )}
          {rendre('', 0)}
        </nav>

        <section className="ry-lecture">
          {erreur && <p className="ry-erreur">⚠ {erreur}</p>}
          {!erreur && !ouvert && (
            <p className="muted-text ry-invite">
              {t(
                'Choisissez un fichier à gauche pour le lire.',
                'Pick a file on the left to read it.',
              )}
            </p>
          )}
          {ouvert && fichier && (
            <>
              <div className="ry-barre">
                <code>{fichier.chemin}</code>
                <span className="muted-text">
                  {fichier.langage} · {taille(fichier.taille, t)}
                </span>
              </div>
              <Suspense fallback={<p className="muted-text">{t('Éditeur…', 'Editor…')}</p>}>
                {/* Lecture seule, y compris pour la Reine : ce qu'on voit est le
                    MIROIR du dépôt. Laisser modifier un texte qui ne sera
                    enregistré nulle part ferait croire à une correction qui
                    n'est jamais partie. */}
                <CodeEditor value={fichier.contenu} lang={fichier.langage as CodeLang} />
              </Suspense>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
