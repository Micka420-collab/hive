// Compte utilisateur (topbar) : connexion/inscription par JWT et affichage de
// la session. Le dashboard fonctionne entièrement sans compte — la session
// n'ajoute que l'identité (projets personnels, rôles à venir).

import { useState } from 'react';
import { authLogin, authMe, authRegister, clearJwt, saveJwt } from './api';
import type { AuthUser } from './api';
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

interface Props {
  user: AuthUser | null;
  onUser: (user: AuthUser | null) => void;
}

export function AccountPanel({ user, onUser }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (user) {
    return (
      <span className="mc-account">
        <span className="mc-account-name" title={user.email}>
          👤 {user.displayName}
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
      {open && <AccountModal onClose={() => setOpen(false)} onUser={onUser} />}
    </>
  );
}

function AccountModal({
  onClose,
  onUser,
}: {
  onClose: () => void;
  onUser: (user: AuthUser) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            {t('Connexion', 'Sign in')}
          </button>
          <button
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            {t('Inscription', 'Register')}
          </button>
        </div>

        {error && <p className="modal-error">{error}</p>}

        {mode === 'register' && (
          <label className="field">
            <span>{t('Nom affiché', 'Display name')}</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('Abeille', 'Worker bee')}
              autoComplete="name"
            />
          </label>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@exemple.fr"
            autoComplete="email"
            autoFocus
          />
        </label>

        <label className="field">
          <span>
            {t('Mot de passe', 'Password')}{' '}
            {mode === 'register' && (
              <small>
                {t(
                  `(${MDP_MIN} caractères minimum — une phrase de trois mots fait un très bon mot de passe)`,
                  `(${MDP_MIN} characters minimum — a three-word phrase makes an excellent password)`,
                )}
              </small>
            )}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && !busy && void submit()}
          />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {t('Annuler', 'Cancel')}
          </button>
          <button
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy || !canSubmit}
          >
            {busy
              ? t('Un instant…', 'One moment…')
              : mode === 'login'
                ? t('Se connecter', 'Sign in')
                : t('Créer le compte', 'Create the account')}
          </button>
        </div>
      </div>
    </Voile>
  );
}
