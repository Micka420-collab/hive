// ARRIVER DANS LA RUCHE — connecter son dépôt GitHub, ou rejoindre un projet
// ouvert. Les deux premiers gestes de quelqu'un qui n'a encore rien ici ;
// sortis de `Projets.tsx` tels quels.

import { useEffect, useState } from 'react';
import {
  fetchDepotsGithub,
  fetchStatutGithub,
  fetchProjetsOuverts,
  importerDepotGithub,
  rejoindreProjet,
} from '../../api';
import { ApiError } from '../../api';
import type { AuthUser, DepotsGithub, ProjetPublicVue, StatutGithub } from '../../api';
import { useT } from '../../i18n';
import { sansIdentifiants } from '../../../../src/shared/projet-public';
import { errMsg } from './commun';
import '../projets.css';

/**
 * LES PROJETS OUVERTS À LA RUCHE — la porte qui n'avait pas de poignée.
 *
 * ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
 *
 * `GET /api/projects/public` et `POST /api/projects/:id/join` existaient depuis
 * longtemps. Le refus de `join` est écrit avec soin — il prend la forme EXACTE
 * de l'inexistence, pour qu'une liste d'identifiants ne dessine pas la carte
 * des projets privés — et sa garde `peutRejoindre` est un module pur bien
 * testé.
 *
 * **Aucun écran ne les appelait.** Ni la ligne de commande. Sur une plateforme
 * d'orchestration COMMUNAUTAIRE, « découvrir un projet ouvert et le rejoindre »
 * est le parcours qui donne son sens à tous les autres, et il avait un serveur
 * sans porte. C'est exactement le défaut de `POST /api/projects/user` : il
 * n'était dans aucune route, il était dans ce que rien ne faisait.
 *
 * ─── CE QUE CET ÉCRAN REFUSE DE DÉDUIRE ──────────────────────────────────────
 *
 * Un refus revient en **404**, indistinguable d'un projet qui n'existe pas.
 * C'est délibéré côté serveur. L'écran NE DOIT PAS le retraduire en « vous
 * n'avez pas le droit » : ce serait reconstruire dans le navigateur
 * l'information que le serveur a tue, et rendre le refus à nouveau lisible pour
 * qui balaie des identifiants.
 *
 * Il dit donc la seule chose vraie — le projet n'est plus disponible — et relit
 * la liste, qui est la réponse honnête.
 */
export function ProjetsOuverts({
  user,
  dejaVus,
  onRejoint,
}: {
  user: AuthUser | null;
  /** Les projets déjà visibles : on ne propose pas de rejoindre les siens. */
  dejaVus: Set<string>;
  onRejoint: () => void;
}) {
  const t = useT();
  const [ouverts, setOuverts] = useState<ProjetPublicVue[] | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  // Rejoindre exige un COMPTE : le jeton de ruche ne dit pas qui vous êtes, et
  // on ne peut pas inscrire « le jeton » comme membre. Sans compte, le panneau
  // se tait plutôt que d'offrir un bouton qui ne peut que refuser.
  if (!user) return null;

  // `relire` NE TOUCHE PAS au message d'erreur, et c'est nécessaire : un refus
  // déclenche une relecture, et si la relecture effaçait le message, le refus
  // serait silencieux. Le bouton, lui, veut bien repartir de zéro — d'où les
  // deux fonctions plutôt qu'un drapeau.
  const relire = () => {
    setChargement(true);
    fetchProjetsOuverts()
      .then(setOuverts)
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  const charger = () => {
    setErreur(null);
    relire();
  };

  const rejoindre = (p: ProjetPublicVue) => {
    setEnCours(p.id);
    setErreur(null);
    rejoindreProjet(p.id)
      .then(() => onRejoint())
      .catch((e: unknown) => {
        // On NE TRADUIT PAS le 404 en « interdit ». Voir l'en-tête. Et on relit :
        // si le projet a disparu ou s'est refermé, la liste le dira. Laisser la
        // ligne morte inviterait à recliquer sur ce qui ne peut plus marcher.
        setErreur(
          e instanceof ApiError && e.status === 404
            ? t(
                'Ce projet n’est plus disponible. La liste a été relue.',
                'This project is no longer available. The list has been reloaded.',
              )
            : errMsg(e),
        );
        relire();
      })
      .finally(() => setEnCours(null));
  };

  const aRejoindre = (ouverts ?? []).filter((p) => !dejaVus.has(p.id));

  return (
    <section className="card pj-ouverts">
      <div className="pj-sub-head">
        <h3>{t('Projets ouverts à la ruche', 'Projects open to the hive')}</h3>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : ouverts
              ? t('relire', 'reload')
              : t('voir les projets ouverts', 'show open projects')}
        </button>
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {ouverts && aRejoindre.length === 0 && (
        <p className="pj-sub-vide">
          {ouverts.length === 0
            ? t(
                'Aucun projet ouvert pour l’instant. Un projet devient ouvert quand son propriétaire le rend public.',
                'No open project yet. A project becomes open when its owner makes it public.',
              )
            : t(
                'Vous êtes déjà dans tous les projets ouverts.',
                'You are already in every open project.',
              )}
        </p>
      )}

      {aRejoindre.length > 0 && (
        <ul className="pj-ouverts-liste">
          {aRejoindre.map((p) => (
            <li key={p.id}>
              <span className="pj-ouv-nom">{p.name}</span>
              {p.description && <span className="pj-ouv-desc">{p.description}</span>}
              {/* ON LAVE, MÊME SI LA SOURCE LAVE DÉJÀ. `vuePublique` retire les
                  identifiants côté serveur, et c'est bien — mais « la source
                  s'en charge » est exactement le raisonnement qui a laissé
                  passer la même fuite TROIS FOIS (voir
                  `tests/repourl-affichage.test.ts`). `sansIdentifiants` est
                  idempotent : une seconde application ne peut rien casser, elle
                  ne peut qu'enlever un secret qui n'aurait pas dû être là. */}
              {p.repoUrl && <code className="pj-ouv-depot">{sansIdentifiants(p.repoUrl)}</code>}
              <button
                className="btn ghost sm"
                onClick={() => rejoindre(p)}
                disabled={enCours !== null}
              >
                {enCours === p.id ? '…' : t('Rejoindre', 'Join')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Le connecteur GitHub — connecter un dépôt existant en un clic.
 *
 * ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
 *
 * `GET /api/github/repos` et `POST /api/github/import` vivaient depuis le début
 * sans aucun écran : connecter un dépôt se faisait en ligne de commande, alors
 * que c'est le tout PREMIER geste de quelqu'un qui arrive avec du code.
 *
 * ─── CE QUE CET ÉCRAN NE FAIT PAS, ET C'EST VOULU ────────────────────────────
 *
 * Il ne demande jamais le jeton GitHub. Celui-ci vit dans l'environnement de
 * l'orchestrateur, en mémoire, le temps du processus. Un champ « collez votre
 * jeton » en ferait une valeur qui traverse le navigateur, l'historique et le
 * presse-papiers — pour un gain nul, puisque c'est l'orchestrateur qui appelle
 * GitHub, pas le navigateur.
 *
 * Quand le jeton manque, le serveur répond 501 (ou `/api/github/status`) avec
 * la marche à suivre : on l'affiche telle quelle plutôt que d'inventer un
 * message qui dériverait.
 *
 * ─── COMPTE OBLIGATOIRE ICI ──────────────────────────────────────────────────
 *
 * Sans compte, l'import crée un projet orphelin (ownerId null) — un
 * administrateur doit l'adopter avant que quiconque s'en serve. Ce n'est plus
 * le parcours proposé : on demande de se connecter d'abord, et le dépôt
 * appartient alors à la personne qui l'a connecté.
 */
export function ConnecteurGithub({
  user,
  onImporte,
}: {
  user: AuthUser | null;
  onImporte: () => void;
}) {
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  const [filtre, setFiltre] = useState('');
  const [depots, setDepots] = useState<DepotsGithub | null>(null);
  const [statut, setStatut] = useState<StatutGithub | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);

  const ouvrirCompte = () => {
    window.dispatchEvent(new CustomEvent('hive:ouvrir-compte'));
  };

  const lister = (q: string) => {
    if (!user) return;
    setCharge(true);
    setErreur(null);
    fetchDepotsGithub(q)
      .then(setDepots)
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setCharge(false));
  };

  // Compte qui arrive (modal) ou panneau qui s'ouvre : on reprend sans
  // forcer à refermer. Sans compte on n'appelle pas GitHub.
  useEffect(() => {
    if (!ouvert) return;
    if (!user) {
      setDepots(null);
      return;
    }
    setErreur(null);
    fetchStatutGithub()
      .then((s) => {
        setStatut(s);
        if (!s.configure && s.detail) setErreur(s.detail);
        else {
          setCharge(true);
          fetchDepotsGithub(filtre)
            .then(setDepots)
            .catch((e: unknown) => setErreur(errMsg(e)))
            .finally(() => setCharge(false));
        }
      })
      .catch((e: unknown) => setErreur(errMsg(e)));
  }, [user, ouvert]);

  const importer = (fullName: string) => {
    if (!user) return;
    setOccupe(fullName);
    setErreur(null);
    importerDepotGithub(fullName)
      .then(() => {
        onImporte();
        lister(filtre);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(null));
  };

  const ouvrir = () => setOuvert(true);

  if (!ouvert) {
    return (
      <section className="card pj-gh-repli">
        <button className="btn" onClick={ouvrir}>
          {t('Connecter un dépôt GitHub', 'Connect a GitHub repository')}
        </button>
        <span className="pj-gh-aide">
          {t(
            'Vos dépôts, les plus récents d’abord. Connectez-vous d’abord — le jeton GitHub reste sur l’orchestrateur.',
            'Your repositories, most recent first. Sign in first — the GitHub token stays on the orchestrator.',
          )}
        </span>
      </section>
    );
  }

  return (
    <section className="card">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" />{' '}
          {t('Connecter un dépôt GitHub', 'Connect a GitHub repository')}
        </h2>
        <button className="btn ghost" onClick={() => setOuvert(false)}>
          {t('Fermer', 'Close')}
        </button>
      </header>

      {!user ? (
        <div className="pj-gh-compte">
          <p className="pj-gh-aide">
            {t(
              'Connectez votre compte Hive pour que le dépôt vous appartienne tout de suite. Sans compte, un administrateur devrait l’adopter — ce n’est plus le parcours proposé.',
              'Sign in to your Hive account so the repository is yours right away. Without an account an administrator would have to adopt it — that is no longer the path we offer.',
            )}
          </p>
          <button className="btn primary" type="button" onClick={ouvrirCompte}>
            {t('Se connecter pour importer', 'Sign in to import')}
          </button>
        </div>
      ) : (
        <>
          {statut && !statut.configure && !erreur && statut.detail && (
            <p className="panel-error pj-gh-erreur">{statut.detail}</p>
          )}

          <div className="pj-run pj-gh-barre">
            <input
              className="pj-testcmd"
              type="text"
              placeholder={t(
                'Filtrer (nom, description, langage)',
                'Filter (name, description, language)',
              )}
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lister(filtre)}
              aria-label={t('Filtrer les dépôts', 'Filter repositories')}
              disabled={statut?.configure === false}
            />
            <button
              className="btn"
              onClick={() => lister(filtre)}
              disabled={charge || statut?.configure === false}
            >
              {charge ? t('Lecture…', 'Reading…') : t('Chercher', 'Search')}
            </button>
          </div>

          {/* Le 501 « GitHub non connecté » porte la marche à suivre complète :
              on la montre telle quelle. La reformuler ici la ferait diverger de
              celle du serveur, et c'est celle du serveur qui est juste. */}
          {erreur && <p className="panel-error pj-gh-erreur">{erreur}</p>}

          {depots && statut?.configure !== false && (
            <ul className="pj-gh-liste">
              {depots.depots.length === 0 && (
                <li className="pj-gh-vide">
                  {t('Aucun dépôt ne correspond.', 'No repository matches.')}
                </li>
              )}
              {depots.depots.map((d) => (
                <li key={d.fullName} className={d.importe ? 'pj-gh-deja' : ''}>
                  <div className="pj-gh-nom">
                    <strong>{d.fullName}</strong>
                    {d.prive && <span className="pj-vis private">{t('privé', 'private')}</span>}
                    {d.archive && <span className="pj-gh-tag">{t('archivé', 'archived')}</span>}
                    {d.langage && <span className="pj-gh-tag">{d.langage}</span>}
                  </div>
                  {/* Même famille : muté en `||`, une description absente rend un
                      `<span>` vide et stylé plutôt que rien. L'entrée qui tranche
                      est un dépôt sans description. */}
                  {d.description && <span className="pj-gh-desc">{d.description}</span>}
                  {d.importe ? (
                    <span className="pj-gh-etat">{t('déjà connecté', 'already connected')}</span>
                  ) : (
                    <button
                      className="btn"
                      disabled={occupe !== null}
                      onClick={() => importer(d.fullName)}
                    >
                      {occupe === d.fullName
                        ? t('Connexion…', 'Connecting…')
                        : t('Connecter', 'Connect')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
