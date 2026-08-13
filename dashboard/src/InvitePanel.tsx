// Panneau « Inviter un ami » : génère une invitation (URL + token encodés) et
// affiche la commande prête à copier, avec les étapes pour l'ami. L'ami colle
// la commande, son agent IA est détecté automatiquement, il rejoint la ruche.

import { useEffect, useState } from 'react';
import { fetchInvite } from './api';
import type { InviteResponse } from './api';
import { useT } from './i18n';
import { Voile } from './ui';

/** Repli de copie pour les contextes non sécurisés (http LAN) via une zone de texte hors écran. */
function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function InvitePanel() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (!invite) return;
    const text = invite.joinCommand;
    // navigator.clipboard n'existe QUE dans un contexte sécurisé (https ou
    // localhost). Hive étant LAN-first (http://192.168.x.x), on prévoit un repli
    // via une zone de texte + execCommand, sinon la copie échouerait toujours.
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopy(text)) {
        throw new Error('execCommand a échoué');
      }
      setError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(
        t(
          'copie automatique impossible — sélectionnez la commande et copiez-la à la main.',
          'automatic copy failed — select the command and copy it by hand.',
        ),
      );
    }
  };

  return (
    <>
      <button
        className="invite-btn"
        onClick={openPanel}
        title={t('Inviter un ami à rejoindre la ruche', 'Invite a friend to join the hive')}
      >
        {t('+ Inviter un ami', '+ Invite a friend')}
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
                🐝 {t('Inviter un ami dans la ruche', 'Invite a friend into the hive')}
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
                ⚠{' '}
                {t(
                  invite.injoignable,
                  'This hive only listens on its own machine: nobody else can reach the advertised ' +
                    'address. Restart it with HIVE_HOST=0.0.0.0 to open the local network, then ' +
                    'regenerate the invitation.',
                )}
              </p>
            )}

            <ol className="invite-steps">
              <li>
                {t('Votre ami récupère Hive et lance ', 'Your friend grabs Hive and runs ')}
                <code>npm install</code>
                {t(' dans le dossier.', ' in the folder.')}
              </li>
              <li>
                {t(
                  'Il colle cette commande — son Claude Code / Codex est détecté tout seul :',
                  'They paste this command — their Claude Code / Codex is detected automatically:',
                )}
              </li>
            </ol>

            <div className="invite-cmd">
              <code>{invite ? invite.joinCommand : t('génération…', 'generating…')}</code>
              <button className="copy-btn" onClick={copy} disabled={!invite}>
                {copied ? t('✔ copié', '✔ copied') : t('copier', 'copy')}
              </button>
            </div>

            <p className="invite-note">
              ⚠{' '}
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
                  placeholder="ws://..:7777/ws"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <button onClick={() => void generate(customUrl || undefined)}>
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
