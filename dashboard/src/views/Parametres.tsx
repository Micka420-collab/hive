// Vue Paramètres — les réglages de LA PERSONNE devant l'écran, distincts de
// l'Intendance (la salle des machines, réservée aux administrateurs).
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Ces réglages existaient, éparpillés dans la barre du haut : un champ « Jeton »
// de 88 px sans libellé, un bouton « EN », un glyphe ◐, un nom et un bouton
// « Déconnexion ». Sur un téléphone, cette barre montait sur cinq lignes avant
// la première donnée ; et rien ne disait ce que le jeton était, ni quand la
// session expirait. Cet écran les rassemble, chacun avec son libellé et sa
// phrase d'aide — la barre garde les raccourcis sur grand écran.
//
// ─── CE QUE CET ÉCRAN NE FAIT PAS ────────────────────────────────────────────
//
// Il ne décide rien pour la ruche : le jeton, le thème, la langue et les
// guides masqués vivent dans CE navigateur (localStorage). Il ne montre aucun
// lien vers un écran qui n'existe pas : chaque entrée mène à une vue montée
// par `App.tsx`, ou n'est pas rendue. Et il ne réaffiche jamais le jeton en
// clair — c'est le secret qui ouvre l'orchestrateur.

import { clearJwt, estAdmin, getJwt } from '../api';
import type { AuthUser } from '../api';
import { EVENT_OUVRIR_COMPTE } from '../AccountPanel';
import { Fieldset, Input, Select } from '../composants';
import { lireEcheancesSession } from '../echeances-session';
import { setLang, useLang, useT } from '../i18n';
import type { UiLang } from '../i18n';
import { reafficherGuides } from '../OnboardingEssaim';
import { CHOIX_THEMES, changerTheme, useChoixTheme } from '../theme';
import type { ChoixTheme } from '../theme';
import type { ViewProps } from './shared';
import './parametres.css';

/**
 * Le jeton de ruche tel que la coquille le tient : UNE valeur, partagée avec
 * le champ de la barre du haut, et UNE façon de l'appliquer (celle qui ne
 * reconnecte le flux que si le jeton a changé — `applyToken` dans App.tsx).
 */
export interface JetonCoquille {
  valeur: string;
  changer: (valeur: string) => void;
  appliquer: () => void;
  /**
   * Le champ porte le jeton ENREGISTRÉ (`getToken()`), celui qu'utilise le
   * flux. Faux dès la première frappe : `valeur` suit chaque touche, alors que
   * `refuse` et `connecte` parlent encore de l'ancien jeton — sans ce drapeau,
   * l'écran dirait « la Reine accepte ce jeton » d'une valeur jamais essayée.
   */
  enregistre: boolean;
  /** La Reine a refusé le jeton enregistré (fermeture 4401 du flux). */
  refuse: boolean;
  /** Le flux est ouvert — la Reine a donc accepté le jeton enregistré. */
  connecte: boolean;
}

export interface ProprietesParametres extends ViewProps {
  jeton: JetonCoquille;
  /** Rapporte une déconnexion à la coquille (la barre cesse d'afficher le nom). */
  onCompte: (user: AuthUser | null) => void;
}

function dateLisible(ms: number, lang: UiLang): string {
  return new Date(ms).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function Parametres({
  user,
  snapshot,
  onNavigate,
  onNewProject,
  jeton,
  onCompte,
}: ProprietesParametres) {
  const t = useT();
  const lang = useLang();
  const theme = useChoixTheme();

  const nomTheme: Record<ChoixTheme, string> = {
    systeme: t('Système — suit le réglage de l’appareil', 'System — follows the device setting'),
    sombre: t('Sombre', 'Dark'),
    clair: t('Clair', 'Light'),
  };

  // Lu au rendu : la session change par la coquille (`user`), qui re-rend.
  const echeances = user ? lireEcheancesSession(getJwt()) : null;

  // Chaque phrase ne parle que du jeton ENREGISTRÉ, le seul que la Reine ait
  // pu juger : une valeur en cours de frappe reste « pas encore essayée »
  // (inconnu reste inconnu), et un flux ouvert SANS jeton dit que la Reine
  // n'en demande pas — pas qu'elle « accepte » un champ vide.
  const refuse = jeton.refuse && jeton.enregistre;
  const etatJeton = !jeton.enregistre
    ? t(
        'Pas encore enregistré : « Enregistrer le jeton » le fera essayer par la Reine.',
        'Not saved yet: “Save the token” will have the Queen try it.',
      )
    : refuse
      ? undefined
      : jeton.connecte
        ? jeton.valeur
          ? t('La Reine accepte ce jeton.', 'The Queen accepts this token.')
          : t(
              'Aucun jeton : la Reine n’en demande pas.',
              'No token: the Queen does not require one.',
            )
        : t(
            'Reine injoignable pour l’instant : le jeton n’a pas encore pu être vérifié.',
            'Queen unreachable for now: the token could not be checked yet.',
          );

  return (
    <div className="mc-view pa-view">
      <section className="card pa-carte" aria-labelledby="pa-compte">
        <h2 id="pa-compte">{t('Compte', 'Account')}</h2>
        {user ? (
          <>
            <dl className="pa-faits">
              <dt>{t('Nom', 'Name')}</dt>
              <dd data-testid="pa-nom">{user.displayName}</dd>
              <dt>{t('Courriel', 'Email')}</dt>
              <dd>{user.email}</dd>
              <dt>{t('Rôle', 'Role')}</dt>
              {/* `role` absent = membre (le défaut sûr, cf. `AuthUser`). */}
              <dd>
                {estAdmin(user) ? t('Administrateur', 'Administrator') : t('Membre', 'Member')}
              </dd>
              <dt>{t('Session', 'Session')}</dt>
              <dd data-testid="pa-session">
                {echeances
                  ? t(
                      `ouverte le ${dateLisible(echeances.ouverteA, lang)} · expire le ${dateLisible(echeances.expireA, lang)}`,
                      `opened ${dateLisible(echeances.ouverteA, lang)} · expires ${dateLisible(echeances.expireA, lang)}`,
                    )
                  : t('échéance inconnue', 'expiry unknown')}
              </dd>
            </dl>
            <div className="pa-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  clearJwt();
                  onCompte(null);
                }}
              >
                {t('Se déconnecter', 'Sign out')}
              </button>
              <p className="pa-note">
                {t(
                  'La ruche reste accessible avec son jeton ; seule votre identité part.',
                  'The hive stays reachable with its token; only your identity leaves.',
                )}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="pa-note">
              {t(
                'Aucun compte connecté. Le tableau de bord reste utilisable ; un compte ajoute votre identité (vos projets, votre rôle).',
                'No account signed in. The dashboard stays usable; an account adds your identity (your projects, your role).',
              )}
            </p>
            <div className="pa-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => window.dispatchEvent(new Event(EVENT_OUVRIR_COMPTE))}
              >
                {t('Se connecter ou créer un compte', 'Sign in or create an account')}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card pa-carte" aria-labelledby="pa-apparence">
        <h2 id="pa-apparence">{t('Apparence', 'Appearance')}</h2>
        <Fieldset legende={t('Thème', 'Theme')}>
          {CHOIX_THEMES.map((c) => (
            <label key={c} className="pa-option">
              <input
                type="radio"
                name="pa-theme"
                value={c}
                checked={theme === c}
                onChange={() => changerTheme(c)}
              />
              {nomTheme[c]}
            </label>
          ))}
        </Fieldset>
        <Select
          libelle={t('Langue de l’interface', 'Interface language')}
          value={lang}
          onChange={(e) => setLang(e.target.value === 'en' ? 'en' : 'fr')}
          options={[
            { valeur: 'fr', libelle: 'Français' },
            { valeur: 'en', libelle: 'English' },
          ]}
        />
      </section>

      <section className="card pa-carte" aria-labelledby="pa-jeton">
        <h2 id="pa-jeton">{t('Jeton de la ruche', 'Hive token')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            jeton.appliquer();
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            libelle="HIVE_TOKEN"
            aide={
              <>
                {t(
                  'La valeur exacte de HIVE_TOKEN dans le fichier .env de l’orchestrateur. Ce n’est pas le jeton GitHub. Elle reste dans ce navigateur.',
                  'The exact HIVE_TOKEN from the orchestrator’s .env file. This is not the GitHub token. It stays in this browser.',
                )}
                {etatJeton && (
                  <>
                    {' '}
                    <span data-testid="pa-etat-jeton">{etatJeton}</span>
                  </>
                )}
              </>
            }
            erreur={
              refuse
                ? t(
                    'La Reine a refusé ce jeton — collez la valeur exacte de HIVE_TOKEN.',
                    'The Queen rejected this token — paste the exact HIVE_TOKEN value.',
                  )
                : undefined
            }
            value={jeton.valeur}
            onChange={(e) => jeton.changer(e.target.value)}
            // Comme le champ de la barre : quitter le champ enregistre. Sur
            // téléphone, ce champ-ci est le seul — une valeur tapée puis
            // laissée pour une autre vue semblait posée et ne l'était pas.
            onBlur={jeton.appliquer}
          />
          <button type="submit" className="btn primary">
            {t('Enregistrer le jeton', 'Save the token')}
          </button>
        </form>
      </section>

      <section className="card pa-carte" aria-labelledby="pa-premiers-pas">
        <h2 id="pa-premiers-pas">{t('Premiers pas', 'Getting started')}</h2>
        {snapshot.projects.length > 0 ? (
          <>
            <p className="pa-note">
              {t(
                'Le guide « Chemin vers le premier cycle » s’affiche sur chaque projet tant que sa checklist n’est pas complète. Un guide masqué peut revenir ici.',
                'The “Path to the first cycle” guide shows on each project until its checklist is complete. A hidden guide can come back from here.',
              )}
            </p>
            <div className="pa-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  reafficherGuides();
                  onNavigate('projets');
                }}
              >
                {t('Réafficher le guide du premier cycle', 'Show the first-cycle guide again')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="pa-note">
              {t(
                'Aucun projet encore : tout commence par un projet, sur ce nœud.',
                'No project yet: everything starts with a project, on this node.',
              )}
            </p>
            <div className="pa-actions">
              <button type="button" className="btn primary" onClick={onNewProject}>
                {t('Démarrer un projet', 'Start a project')}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card pa-carte" aria-labelledby="pa-connecteurs">
        <h2 id="pa-connecteurs">{t('Connecteurs', 'Connectors')}</h2>
        <p className="pa-note">
          {t(
            'GitHub — connecter un dépôt existant. Le connecteur est en tête de Projets ; le jeton GitHub reste dans l’environnement de l’orchestrateur, jamais dans ce navigateur.',
            'GitHub — connect an existing repository. The connector sits at the top of Projects; the GitHub token stays in the orchestrator’s environment, never in this browser.',
          )}
        </p>
        <div className="pa-actions">
          <button type="button" className="btn" onClick={() => onNavigate('projets')}>
            {t('Ouvrir le connecteur GitHub', 'Open the GitHub connector')}
          </button>
        </div>
      </section>

      {/* L'Intendance a sa case pour les administrateurs ; le rappel ici dit
          seulement où vivent les réglages de la RUCHE, pour qui y a droit. */}
      {estAdmin(user) && (
        <section className="card pa-carte" aria-labelledby="pa-ruche">
          <h2 id="pa-ruche">{t('Réglages de la ruche', 'Hive settings')}</h2>
          <p className="pa-note">
            {t(
              'Serveurs, membres, clés de nœud : ce qui engage toute la ruche vit dans l’Intendance.',
              'Servers, members, node keys: what commits the whole hive lives in Stewardship.',
            )}
          </p>
          <div className="pa-actions">
            <button type="button" className="btn" onClick={() => onNavigate('intendance')}>
              {t('Ouvrir l’Intendance', 'Open Stewardship')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
