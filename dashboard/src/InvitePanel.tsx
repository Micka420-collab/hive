// Panneau « Inviter un ami » : génère une invitation (URL + token encodés) et
// affiche la commande prête à copier, avec les étapes pour l'ami. L'ami colle
// la commande, son agent IA est détecté automatiquement, il rejoint la ruche.

import { useEffect, useState } from 'react';
import { fetchInvite } from './api';
import type { InviteResponse } from './api';
import { useT } from './i18n';
import { Voile } from './ui';
import { copierTexte } from './copier';

export function InvitePanel() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // ─── LE SYSTÈME DE L'INVITÉ, PAS CELUI DE L'HÔTE ───────────────────────────
  //
  // On ne devine pas : c'est la machine de QUELQU'UN D'AUTRE. Le défaut tombe
  // sur POSIX parce que c'est le cas le plus fréquent, et le choix est à un
  // clic — une commande POSIX collée dans PowerShell ne dit rien d'utile, et
  // l'invité n'a aucun moyen de le savoir avant de l'avoir collée.
  const [systeme, setSysteme] = useState<'posix' | 'windows'>('posix');

  /**
   * LA commande à remettre, ou `null` tant qu'il n'y en a pas.
   *
   * Repli sur `joinCommand` quand la ruche est d'une version antérieure : elle
   * suppose Hive déjà installé, ce que l'écran dit alors juste en dessous.
   */
  const commande = invite === null ? null : (invite.entree?.[systeme] ?? invite.joinCommand);

  const generate = async (url?: string) => {
    setError(null);
    try {
      setInvite(await fetchInvite(url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openPanel = () => {
    setOpen(true);
    if (!invite) void generate();
  };

  // Fermeture au clavier (Échap) quand la modale est ouverte.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const copy = async () => {
    if (commande === null) return;
    // Le repli pour les contextes non sécurisés (http LAN) vit dans `copier.ts`
    // — il servait ici en premier, et deux autres écrans en avaient besoin.
    if (await copierTexte(commande)) {
      setError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    }
    setError(
      t(
        'copie automatique impossible — sélectionnez la commande et copiez-la à la main.',
        'automatic copy failed — select the command and copy it by hand.',
      ),
    );
  };

  return (
    <>
      <button
        className="invite-btn"
        onClick={openPanel}
        title={t('Inviter un ami à rejoindre la ruche', 'Invite a friend to join the hive')}
      >
        {t('Inviter', 'Invite')}
      </button>

      {open && (
        <Voile onClose={() => setOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2 id="invite-title">
                <span className="marque" aria-hidden="true" />{' '}
                {t('Inviter un ami dans la ruche', 'Invite a friend into the hive')}
              </h2>
              <button
                className="modal-close"
                onClick={() => setOpen(false)}
                aria-label={t('Fermer', 'Close')}
              >
                ×
              </button>
            </header>

            {error && <p className="modal-error">{error}</p>}

            {/* La commande est correcte, mais elle ne mènerait nulle part : le
                dire ICI, avant que l'ami ne la colle et n'attende une ruche
                qui n'écoute pas sur cette adresse. */}
            {invite?.injoignable && (
              <p className="modal-error invite-unreachable">
                {t(
                  invite.injoignable,
                  'This hive only listens on its own machine: nobody else can reach the advertised ' +
                    'address. Restart it with HIVE_HOST=0.0.0.0 to open the local network, then ' +
                    'regenerate the invitation.',
                )}
              </p>
            )}

            {/* ─── UNE SEULE ÉTAPE, ET C'EST TOUT LE SUJET ────────────────────
                Cette liste en comptait DEUX : « votre ami récupère Hive et lance
                npm install DANS LE DOSSIER », puis « il colle cette commande ».
                Le dossier — celui qu'il n'a pas, puisqu'il n'a rien installé.
                La commande ci-dessous installe si besoin, puis rejoint. */}
            <ol className="invite-steps">
              <li>
                {t(
                  'Votre ami colle cette commande dans un terminal — rien d’autre à installer, son Claude Code / Codex est détecté tout seul :',
                  'Your friend pastes this command into a terminal — nothing else to install, their Claude Code / Codex is detected automatically:',
                )}
              </li>
            </ol>

            {/* Le système se choisit : la commande POSIX collée dans PowerShell
                ne dit rien d'utile, et l'invité n'a aucun moyen de le savoir
                avant de l'avoir collée. */}
            <div className="invite-os" role="group" aria-label={t('Système', 'System')}>
              {(['posix', 'windows'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`invite-os-btn${systeme === s ? ' actif' : ''}`}
                  aria-pressed={systeme === s}
                  onClick={() => setSysteme(s)}
                >
                  {s === 'posix' ? 'Linux / macOS' : 'Windows'}
                </button>
              ))}
            </div>

            <div className="invite-cmd">
              <code className={commande === null ? 'muted-text' : undefined}>
                {commande ?? t('génération…', 'generating…')}
              </code>
              <button className="copy-btn" onClick={copy} disabled={commande === null}>
                {copied ? t('copié', 'copied') : t('copier', 'copy')}
              </button>
            </div>

            {/* Le repli n'est pas décoratif : une ruche d'une version
                antérieure ne renvoie pas `entree`, et l'écran doit rester
                utilisable plutôt que de montrer un vide. */}
            {invite && !invite.entree && (
              <p className="invite-note">
                {t(
                  'Cette ruche est d’une version qui ne compose pas encore la commande d’entrée : votre ami devra installer Hive d’abord.',
                  'This hive predates the one-command entry: your friend will have to install Hive first.',
                )}
              </p>
            )}

            <p className="invite-note">
              {t(
                'Cette invitation contient le token de la ruche : ne la partagez qu’avec des personnes de confiance, par un canal privé.',
                'This invitation contains the hive token: only share it with people you trust, over a private channel.',
              )}
            </p>

            <details className="invite-advanced">
              <summary>
                {t(
                  'Adresse incorrecte ? Régénérer avec une URL précise',
                  'Wrong address? Regenerate with an exact URL',
                )}
              </summary>
              <p>
                {t(
                  'Par défaut l’adresse réseau local est détectée. Pour un accès distant, indiquez l’URL WebSocket joignable (ex. ',
                  'By default the local network address is detected. For remote access, provide the reachable WebSocket URL (e.g. ',
                )}
                <code>wss://mondomaine:7777/ws</code>
                {t(').', ').')}
              </p>
              <div className="invite-url-row">
                <input
                  type="text"
                  className="code-input"
                  placeholder="ws://..:7777/ws"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void generate(customUrl || undefined)}
                >
                  {t('Régénérer', 'Regenerate')}
                </button>
              </div>
              {invite && (
                <p className="invite-current-url">
                  {t('Ruche annoncée :', 'Advertised hive:')} {invite.url}
                </p>
              )}
            </details>
          </div>
        </Voile>
      )}
    </>
  );
}
