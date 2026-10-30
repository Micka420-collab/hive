// Compte utilisateur (topbar) : connexion/inscription par JWT et affichage de
// la session. Le dashboard fonctionne entièrement sans compte — la session
// n'ajoute que l'identité (projets personnels, rôles à venir).

import { useEffect, useState } from 'react';
import { authLogin, authMe, authRegister, clearJwt, saveJwt } from './api';
import type { AuthUser } from './api';
import { Input } from './composants';
import { useT } from './i18n';
import { useDialog, Voile } from './ui';
import type { LONGUEUR_MIN } from '../../src/orchestrator/comptes';

/**
 * Longueur minimale d'un mot de passe à l'inscription.
 *
 * Elle DOIT valoir `LONGUEUR_MIN` côté serveur, et la ligne suivante le
 * vérifie à la compilation : le type de la constante serveur est son littéral,
 * donc un désaccord casse `typecheck:dashboard` au lieu de se manifester par
 * un formulaire qui s'active puis se fait refuser en 400 — le pire des deux
 * mondes, où l'écran promet ce que le serveur va rejeter.
 *
 * `import type` : aucune ligne de code serveur n'entre dans le bundle.
 */
const MDP_MIN = 12;
const _accordServeur: typeof LONGUEUR_MIN = MDP_MIN;
void _accordServeur;

/** Ouverture du modal depuis un autre écran (ex. connecteur GitHub). */
export const EVENT_OUVRIR_COMPTE = 'hive:ouvrir-compte';

interface Props {
  user: AuthUser | null;
  onUser: (user: AuthUser | null) => void;
  /**
   * La session vient d'expirer (`surSessionExpiree`) : la fenêtre s'ouvre
   * d'elle-même et dit pourquoi. Sans ça, la personne ne découvrait qu'elle
   * était déconnectée qu'en voyant ses gestes échouer un à un.
   */
  sessionExpiree?: boolean;
}

export function AccountPanel({ user, onUser, sessionExpiree = false }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionExpiree) setOpen(true);
  }, [sessionExpiree]);

  // Une session revenue par un AUTRE chemin (reconnexion dans un autre onglet)
  // referme la fenêtre ouverte par l'expiration : sans ça, `open` restait vrai
  // sous la branche « connecté », et la fenêtre « Connexion » surgissait
  // d'elle-même au clic suivant sur « Déconnexion ».
  useEffect(() => {
    if (user) setOpen(false);
  }, [user]);

  useEffect(() => {
    if (user) return;
    const ouvrir = () => setOpen(true);
    window.addEventListener(EVENT_OUVRIR_COMPTE, ouvrir);
    return () => window.removeEventListener(EVENT_OUVRIR_COMPTE, ouvrir);
  }, [user]);

  if (user) {
    return (
      <span className="mc-account">
        <span className="mc-account-name" title={user.email}>
          {user.displayName}
        </span>
        <button
          className="btn ghost"
          onClick={() => {
            clearJwt();
            onUser(null);
          }}
          title={t(
            'Se déconnecter du compte (la ruche reste accessible)',
            'Sign out (the hive stays reachable)',
          )}
        >
          {t('Déconnexion', 'Sign out')}
        </button>
      </span>
    );
  }

  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)}>
        {t('Se connecter', 'Sign in')}
      </button>
      {open && (
        <AccountModal
          onClose={() => setOpen(false)}
          onUser={onUser}
          sessionExpiree={sessionExpiree}
        />
      )}
    </>
  );
}

function AccountModal({
  onClose,
  onUser,
  sessionExpiree,
}: {
  onClose: () => void;
  onUser: (user: AuthUser) => void;
  sessionExpiree: boolean;
}) {
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Les champs QUITTÉS au moins une fois. Une faute ne se dit qu'après : la
  // crier à la première lettre (« courriel invalide » en tapant « m ») apprend
  // surtout à ignorer les messages rouges.
  const [quittes, setQuittes] = useState<ReadonlySet<string>>(() => new Set());
  const quitter = (champ: string) => setQuittes((q) => new Set(q).add(champ));
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token } =
        mode === 'login'
          ? await authLogin(email, password)
          : await authRegister(email, password, displayName);
      saveJwt(token);
      onUser(await authMe());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // À la CONNEXION, aucune longueur minimale n'est exigée : un compte créé
  // avant que la règle n'existe doit pouvoir se connecter, et bloquer le bouton
  // lui dirait seulement « votre mot de passe est trop court » sans issue.
  const canSubmit =
    email.includes('@') &&
    (mode === 'login'
      ? password.length > 0
      : password.length >= MDP_MIN && displayName.length >= 2);

  // ─── POURQUOI LE BOUTON RESTE ÉTEINT, DIT SOUS LE CHAMP FAUTIF ─────────────
  //
  // Le bouton s'éteint tant que le formulaire ne peut pas aboutir — c'était
  // déjà le cas, mais sans dire POURQUOI : un « Créer le compte » grisé face à
  // un mot de passe de onze caractères est une énigme. Les mêmes règles que
  // `canSubmit`, champ par champ, une fois le champ quitté.
  const erreurEmail =
    quittes.has('email') && !email.includes('@')
      ? t('Une adresse e-mail contient un « @ ».', 'An email address contains an “@”.')
      : undefined;
  const erreurNom =
    mode === 'register' && quittes.has('nom') && displayName.length < 2
      ? t('Deux caractères au moins.', 'At least two characters.')
      : undefined;
  const erreurMdp =
    mode === 'register' && quittes.has('mdp') && password.length < MDP_MIN
      ? t(
          `Encore ${MDP_MIN - password.length} caractère(s) : ${MDP_MIN} au minimum.`,
          `${MDP_MIN - password.length} more character(s): ${MDP_MIN} minimum.`,
        )
      : undefined;

  return (
    <Voile onClose={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="account-title">
            <span className="marque" aria-hidden="true" />{' '}
            {mode === 'login'
              ? t('Connexion', 'Sign in')
              : t('Créer un compte', 'Create an account')}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>

        <div className="drawer-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            {t('Connexion', 'Sign in')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            {t('Inscription', 'Register')}
          </button>
        </div>

        {sessionExpiree && !error && (
          <p className="modal-note" role="status">
            {t(
              'Session expirée — reconnectez-vous pour reprendre là où vous en étiez.',
              'Session expired — sign in again to pick up where you left off.',
            )}
          </p>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !busy) void submit();
          }}
        >
          {mode === 'register' && (
            <Input
              type="text"
              libelle={t('Nom affiché', 'Display name')}
              requis
              erreur={erreurNom}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => quitter('nom')}
              placeholder={t('Abeille', 'Worker bee')}
              autoComplete="name"
            />
          )}

          <Input
            type="email"
            libelle={t('Email', 'Email')}
            requis
            erreur={erreurEmail}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => quitter('email')}
            placeholder="vous@exemple.fr"
            autoComplete="email"
            autoFocus
          />

          <Input
            type="password"
            libelle={t('Mot de passe', 'Password')}
            requis
            aide={
              mode === 'register'
                ? t(`${MDP_MIN} caractères minimum.`, `${MDP_MIN} characters minimum.`)
                : undefined
            }
            erreur={erreurMdp}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => quitter('mdp')}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
              {t('Annuler', 'Cancel')}
            </button>
            <button type="submit" className="btn primary" disabled={busy || !canSubmit}>
              {busy
                ? t('Un instant…', 'One moment…')
                : mode === 'login'
                  ? t('Se connecter', 'Sign in')
                  : t('Créer le compte', 'Create the account')}
            </button>
          </div>
        </form>
      </div>
    </Voile>
  );
}
