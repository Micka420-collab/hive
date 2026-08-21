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
// 3. LA LECTURE EST LE DÉFAUT, ET L'ÉCRITURE N'EN EST PAS UNE. L'éditeur
//    s'ouvre en lecture ; « Proposer une retouche » le rend modifiable. Mais ce
//    qu'on voit est le MIROIR du dépôt — un clone jetable — et rien ne s'y
//    écrit jamais. La retouche part comme TÂCHE : une ouvrière l'applique chez
//    elle, la teste, et son diff passe par la revue comme tout le reste.
//
//    D'où le libellé du bouton : « Proposer », jamais « Enregistrer ». Un
//    bouton « enregistrer » promettrait une écriture qui n'arrive pas, et on
//    ne s'en apercevrait qu'au rafraîchissement suivant, en cherchant pourquoi
//    le correctif a disparu. C'est le pire mensonge qu'une interface puisse
//    faire.

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  fetchApercu,
  fetchFichierRayon,
  fetchPresences,
  fetchRayon,
  getPartage,
  proposerRetouche,
} from '../api';
import type { ApercuProjet, EntreeRayon, FichierRayon, PresenceCurseur } from '../api';
import { SauvegardesTimeline } from '../SauvegardesTimeline';
import {
  cheminDepuisFocus,
  consommerFocus,
  FOCUS_SAUVEGARDES,
  parentsDuChemin,
} from '../focus-vue';
import { icone, taille } from './rayon-affichage';
import type { ViewProps } from './shared';
import { sansIdentifiants } from '../../../src/shared/projet-public';
import { presenceCorrespondAuRayon } from '../../../src/shared/presence.js';
import { useT } from '../i18n';
import './rayon.css';

const CodeEditor = lazy(() => import('../CodeEditor'));
import type { CodeLang } from '../CodeEditor';

/** Le contenu connu d'un dossier, et son état de chargement. */
interface Noeud {
  entrees: EntreeRayon[];
  ouvert: boolean;
}

export default function Rayon({ snapshot, selectedId, onNavigate, refreshTick }: ViewProps) {
  const t = useT();
  // Lecture par lien de partage : c'est la MÊME source que celle qui décide de
  // l'en-tête HTTP, donc les deux ne peuvent pas se contredire.
  const parPartage = getPartage() !== null;
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
  // `null` = lecture. Un objet = la Reine est en train de retoucher. On garde
  // le texte ICI plutôt que dans l'éditeur : c'est lui qu'on compare à
  // `fichier.contenu` pour savoir ce qui a bougé.
  const [retouche, setRetouche] = useState<{ texte: string; note: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [propose, setPropose] = useState<string | null>(null);
  const [apercu, setApercu] = useState<ApercuProjet | null>(null);
  const [apercuErreur, setApercuErreur] = useState<string | null>(null);
  const [attirerSg, setAttirerSg] = useState(false);
  /** Curseurs — absents en partage ; [] = silence. */
  const [curseurs, setCurseurs] = useState<PresenceCurseur[]>([]);

  useEffect(() => {
    if (parPartage) {
      setCurseurs([]);
      return;
    }
    let vivant = true;
    const charger = () => {
      void fetchPresences()
        .then((r) => {
          if (vivant) setCurseurs(r.presences);
        })
        .catch(() => {
          if (vivant) setCurseurs([]);
        });
    };
    charger();
    const id = window.setInterval(charger, 4_000);
    return () => {
      vivant = false;
      window.clearInterval(id);
    };
  }, [parPartage, refreshTick]);

  const curseursPour = (cheminRayon: string): PresenceCurseur[] => {
    const out: PresenceCurseur[] = [];
    for (const c of curseurs) {
      if (presenceCorrespondAuRayon(c.chemin, cheminRayon)) out.push(c);
    }
    return out;
  };

  const voirApercu = async () => {
    if (!projet) return;
    setApercuErreur(null);
    try {
      setApercu(await fetchApercu(projet.id));
    } catch (e) {
      // Le refus dit où mettre l'index.html : c'est plus utile qu'un « échec ».
      setApercuErreur(e instanceof Error ? e.message : String(e));
    }
  };

  const envoyer = async () => {
    if (!projet || !fichier || !retouche) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await proposerRetouche(projet.id, {
        chemin: fichier.chemin,
        avant: fichier.contenu,
        apres: retouche.texte,
        ...(retouche.note.trim() ? { note: retouche.note.trim() } : {}),
      });
      setPropose(r.task.title);
      setRetouche(null);
    } catch (e) {
      // Le refus du serveur s'AFFICHE tel quel : il dit pourquoi et propose
      // une issue (« décrivez-la en mots »), ce qu'un « échec » ne ferait pas.
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnvoi(false);
    }
  };

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
    setRetouche(null);
    setPropose(null);
    setApercu(null);
    setApercuErreur(null);
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
    // Changer de fichier abandonne la retouche en cours : la garder
    // appliquerait le texte d'un fichier à un autre.
    setRetouche(null);
    setPropose(null);
    try {
      setFichier(await fetchFichierRayon(projet.id, chemin));
    } catch (e) {
      // Le refus s'AFFICHE. Un clic sans réaction laisse croire à une panne.
      setErreur(e instanceof Error ? e.message : String(e));
    }
  };

  /** Déplie les dossiers parents (lazy), puis ouvre le fichier constaté. */
  const revelerEtOuvrir = async (projectId: string, chemin: string) => {
    await charger(projectId, '');
    for (const parent of parentsDuChemin(chemin)) {
      await charger(projectId, parent);
    }
    await ouvrir(chemin);
  };

  // Après ouverture (focus Chambre ou clic), amener l’entrée active dans le
  // viewport de l’arbre — sinon un chemin profond reste hors écran.
  useEffect(() => {
    if (!ouvert) return;
    const id = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.ry-entree.active')?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [ouvert]);

  // Reine → Sauvegardes, ou Chambre → chemin constaté (déplie les parents).
  useEffect(() => {
    const focus = consommerFocus();
    if (!focus) return;
    if (focus === FOCUS_SAUVEGARDES) {
      setAttirerSg(true);
      const id = window.requestAnimationFrame(() => {
        document.getElementById('ry-sauvegardes')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
      const fin = window.setTimeout(() => setAttirerSg(false), 1800);
      return () => {
        window.cancelAnimationFrame(id);
        window.clearTimeout(fin);
      };
    }
    const chemin = cheminDepuisFocus(focus);
    if (chemin && projet) {
      void revelerEtOuvrir(projet.id, chemin);
    }
    // Intentionnellement borné à projet + tick (focus one-shot).
  }, [projet?.id, refreshTick, charger]);

  /** Rend un dossier et, s'il est déplié, ses enfants — récursivement. */
  const rendre = (chemin: string, profondeur: number): React.ReactNode => {
    const noeud = dossiers[chemin];
    if (!noeud?.ouvert) return null;
    return noeud.entrees.map((e) => {
      const estDossier = e.type === 'dossier';
      const deplie = dossiers[e.chemin]?.ouvert ?? false;
      const qui = estDossier ? [] : curseursPour(e.chemin);
      return (
        <div key={e.chemin} className="ry-ligne">
          <button
            type="button"
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
          {qui.length > 0 && (
            <span
              className="ry-curseurs"
              title={qui
                .map((q) => (q.bapteme ? `${q.bapteme} · ${q.outil}` : q.outil))
                .join(' · ')}
            >
              {qui.map((q) => (
                <button
                  key={q.toolUseId}
                  type="button"
                  className={`ry-curseur ry-curseur-${q.outil.toLowerCase()}${q.bapteme ? '' : ' ry-curseur-muet'}`}
                  title={
                    q.bapteme
                      ? t(
                          `${q.bapteme} · ${q.outil} — ouvrir le poste`,
                          `${q.bapteme} · ${q.outil} — open workstation`,
                        )
                      : t(`${q.outil} — ouvrir le poste`, `${q.outil} — open workstation`)
                  }
                  data-testid="ry-curseur-poste"
                  onClick={() => onNavigate('chambre', q.nodeId)}
                >
                  {q.bapteme ?? q.outil}
                </button>
              ))}
            </span>
          )}
          {estDossier && rendre(e.chemin, profondeur + 1)}
        </div>
      );
    });
  };

  if (projets.length === 0) {
    return (
      <div className="ry-vide">
        <span className="marque" aria-hidden="true" />
        <p>
          {t(
            'Le rayon s’ouvre avec un projet. Démarrez-en un, puis revenez ici.',
            'The comb opens with a project. Start one, then come back here.',
          )}
        </p>
        <button className="btn primary" onClick={() => onNavigate('projets')}>
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
        {parPartage ? (
          <span className="ry-partage-note" data-testid="ry-partage-identites">
            {t('Identités absentes · lecture seule', 'Identities hidden · read-only')}
          </span>
        ) : null}
        <button className="btn ghost ry-apercu-btn" onClick={() => void voirApercu()}>
          {t('Aperçu', 'Preview')}
        </button>
      </header>

      {projet && (
        <SauvegardesTimeline
          projectId={projet.id}
          refreshTick={refreshTick}
          onNavigate={onNavigate}
          attirerAttention={attirerSg}
        />
      )}

      {apercuErreur && <p className="ry-erreur">⚠ {apercuErreur}</p>}
      {apercu && (
        <section className="ry-apercu">
          <div className="ry-barre">
            <code>{apercu.entree}</code>
            <span className="muted-text">
              {apercu.inlines.length} {t('fichier(s) replié(s)', 'file(s) folded in')} ·{' '}
              {t('bac à sable, hors ligne', 'sandboxed, offline')}
            </span>
            <button className="btn ghost ry-geste" onClick={() => setApercu(null)}>
              {t('Fermer', 'Close')}
            </button>
          </div>
          {/*
            LE SANDBOX VIENT DU SERVEUR, ET IL N'A PAS `allow-same-origin`.

            C'est le seul attribut qui compte ici. Sans lui, le cadre a une
            origine unique et inaccessible : le site prévisualisé ne peut lire
            ni le `localStorage` du tableau de bord — où vit le jeton de
            session — ni ses cookies. L'ajouter, ne serait-ce que pour faire
            marcher une image, rendrait ce cadre capable de voler le compte.

            La valeur vient du serveur plutôt que d'être écrite ici : deux
            copies d'une même règle de sécurité finissent toujours par diverger,
            et c'est la copie oubliée qui décide.
          */}
          <iframe
            className="ry-cadre"
            title={t('Aperçu du projet', 'Project preview')}
            sandbox={apercu.sandbox}
            srcDoc={apercu.html}
          />
        </section>
      )}

      {!parPartage && curseurs.length > 0 && (
        <aside
          className="ry-presences-live"
          aria-label={t('Présences constatées', 'Observed presence')}
          data-testid="ry-presences-live"
        >
          <span className="ry-presences-live-titre">{t('En train de…', 'Working on…')}</span>
          <ul>
            {curseurs.map((c) => (
              <li key={c.toolUseId}>
                <button
                  type="button"
                  className={`ry-curseur ry-curseur-${c.outil.toLowerCase()}${c.bapteme ? '' : ' ry-curseur-muet'}`}
                  data-testid="ry-curseur-poste"
                  title={
                    c.bapteme
                      ? t(
                          `${c.bapteme} · ${c.outil} — ouvrir le poste`,
                          `${c.bapteme} · ${c.outil} — open workstation`,
                        )
                      : t(`${c.outil} — ouvrir le poste`, `${c.outil} — open workstation`)
                  }
                  onClick={() => onNavigate('chambre', c.nodeId)}
                >
                  {c.bapteme ?? c.outil}
                </button>
                <span className="ry-presences-outil">{c.outil}</span>
                <code className="ry-presences-chemin">{c.chemin}</code>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="ry-corps">
        <nav className="ry-arbre" aria-label={t('Fichiers du projet', 'Project files')}>
          {chargement && (
            <p className="ry-calme">
              <span className="marque" aria-hidden="true" /> {t('Copie du dépôt…', 'Copying repo…')}
            </p>
          )}
          {!chargement && !dossiers[''] && !erreur && (
            <p className="ry-calme">
              <span className="marque" aria-hidden="true" />{' '}
              {t('Rien à afficher.', 'Nothing to show.')}
            </p>
          )}
          {rendre('', 0)}
        </nav>

        <section className="ry-lecture">
          {erreur && <p className="ry-erreur">⚠ {erreur}</p>}
          {!erreur && !ouvert && (
            <p className="ry-invite">
              <span className="marque" aria-hidden="true" />{' '}
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
                {/* LE BOUTON DIT « PROPOSER », PAS « ENREGISTRER ».
                    Ce qu'on voit est le miroir du dépôt : rien ne s'écrit ici.
                    La retouche part comme TÂCHE, une ouvrière l'applique et la
                    teste, et son diff passe par la revue comme tout le reste.
                    Un bouton « enregistrer » promettrait une écriture qui
                    n'arrive jamais — le pire mensonge d'interface possible. */}
                {/* UN PORTEUR DE LIEN LIT, IL NE FABRIQUE PAS DE TRAVAIL pour
                    l'essaim de quelqu'un d'autre. Le serveur le refuse déjà —
                    la retouche exige un COMPTE — mais proposer un bouton voué
                    au 401 est une promesse qu'on ne tient pas. On lit l'état du
                    partage à la source, pas via une copie qui dériverait. */}
                {parPartage ? null : !retouche ? (
                  <button
                    className="btn ghost ry-geste"
                    onClick={() => setRetouche({ texte: fichier.contenu, note: '' })}
                  >
                    {t('Proposer une retouche', 'Propose a change')}
                  </button>
                ) : (
                  <span className="ry-mode">{t('retouche en cours', 'change in progress')}</span>
                )}
              </div>
              <Suspense fallback={<p className="muted-text">{t('Éditeur…', 'Editor…')}</p>}>
                <CodeEditor
                  value={retouche ? retouche.texte : fichier.contenu}
                  lang={fichier.langage as CodeLang}
                  editable={retouche !== null}
                  onChange={(texte) => setRetouche((r) => (r ? { ...r, texte } : r))}
                />
              </Suspense>
              {retouche && (
                <div className="ry-retouche">
                  <input
                    className="ry-note"
                    placeholder={t(
                      'Pourquoi ce changement ? (facultatif, mais ça aide l’ouvrière)',
                      'Why this change? (optional, but it helps the worker)',
                    )}
                    value={retouche.note}
                    onChange={(e) => setRetouche((r) => (r ? { ...r, note: e.target.value } : r))}
                    maxLength={400}
                  />
                  <button className="btn" disabled={envoi} onClick={() => void envoyer()}>
                    {envoi ? '…' : t('Envoyer à l’essaim', 'Send to the swarm')}
                  </button>
                  <button className="btn ghost" disabled={envoi} onClick={() => setRetouche(null)}>
                    {t('Abandonner', 'Discard')}
                  </button>
                </div>
              )}
              {propose && (
                <p className="ry-propose">
                  ✔{' '}
                  {t(
                    `Tâche créée : « ${propose} ». Une ouvrière va l’appliquer et la tester ; le résultat passera par la Miellerie comme tout le reste.`,
                    `Task created: “${propose}”. A worker will apply and test it; the result goes through the Honey House like everything else.`,
                  )}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
