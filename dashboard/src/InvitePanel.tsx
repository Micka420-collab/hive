// Panneau « Inviter un ami » : génère une invitation (URL + token encodés) et
// affiche la commande prête à copier, avec les étapes pour l'ami. L'ami colle
// la commande, son agent IA est détecté automatiquement, il rejoint la ruche.

import { useState } from 'react';
import { fetchInvite } from './api';
import type { InviteResponse } from './api';

export function InvitePanel() {
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

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.joinCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('copie impossible — sélectionnez et copiez manuellement.');
    }
  };

  return (
    <>
      <button
        className="invite-btn"
        onClick={openPanel}
        title="Inviter un ami à rejoindre la ruche"
      >
        + Inviter un ami
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>🐝 Inviter un ami dans la ruche</h2>
              <button className="modal-close" onClick={() => setOpen(false)} aria-label="Fermer">
                ×
              </button>
            </header>

            {error && <p className="modal-error">{error}</p>}

            <ol className="invite-steps">
              <li>
                Votre ami récupère Hive et lance <code>npm install</code> dans le dossier.
              </li>
              <li>Il colle cette commande — son Claude Code / Codex est détecté tout seul :</li>
            </ol>

            <div className="invite-cmd">
              <code>{invite ? invite.joinCommand : 'génération…'}</code>
              <button className="copy-btn" onClick={copy} disabled={!invite}>
                {copied ? '✔ copié' : 'copier'}
              </button>
            </div>

            <p className="invite-note">
              ⚠ Cette invitation contient le token de la ruche : ne la partagez qu’avec des
              personnes de confiance, par un canal privé.
            </p>

            <details className="invite-advanced">
              <summary>Adresse incorrecte ? Régénérer avec une URL précise</summary>
              <p>
                Par défaut l’adresse réseau local est détectée. Pour un accès distant, indiquez
                l’URL WebSocket joignable (ex. <code>wss://mondomaine:7777/ws</code>).
              </p>
              <div className="invite-url-row">
                <input
                  type="text"
                  placeholder="ws://..:7777/ws"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <button onClick={() => void generate(customUrl || undefined)}>Régénérer</button>
              </div>
              {invite && <p className="invite-current-url">Ruche annoncée : {invite.url}</p>}
            </details>
          </div>
        </div>
      )}
    </>
  );
}
