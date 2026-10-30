// Panneau « Inviter » : UN lien à envoyer, et la ruche fait le reste.
//
// ─── CE QUE CE PANNEAU REMETTAIT, ET CE QU'IL REMET ──────────────────────────
//
// Il remettait une COMMANDE de deux cents caractères, à coller dans « un
// terminal » — celui que l'invité ne sait pas toujours ouvrir, et dont il
// fallait choisir la version à sa place. Et cette commande portait l'ancienne
// invitation `hive1_`, qui CONTENAIT le jeton maître de la ruche : sans
// expiration, sans usage unique, sans révocation. Chaque clic sur « Inviter »
// faisait sortir le jeton de la Reine.
//
// Il remet désormais un LIEN DE PORTE (`shared/porte.ts`) : un billet à usage
// unique, valable 24 h, révocable, dans le fragment d'une URL que la ruche
// sert elle-même. L'invité l'ouvre ; la page reconnaît son système, lui
// propose l'application ou la commande, et lui dit quand sa machine est
// entrée. Ici, l'hôte VOIT l'invité arriver : le lien ouvert, puis la
// machine entrée — lus dans le journal (`porte_ouverte`, `node_joined`).
//
// La commande reste, repliée, pour qui la préfère ; et la ruche d'à côté, sans
// billet, reste en tête (`DecouvertsReseau`).

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchInvite } from './api';
import type { InviteResponse } from './api';
import { useT } from './i18n';
import { useDialog, Voile } from './ui';
import { copierTexte } from './copier';
import { DecouvertsReseau } from './DecouvertsReseau';
import type { HiveEvent } from '../../src/shared/types';

/**
 * Le cadre du dialogue, dans un composant À LUI : `useDialog` agit au montage
 * et au démontage, il doit donc vivre le temps de l'OUVERTURE — pas celui du
 * bouton « Inviter », monté en permanence dans la barre du haut.
 */
function CadreInvitation({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div
      ref={ref}
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-title"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** Ce que le journal dit de CE billet : ouvert ? entré ? — l'hôte voit l'invité arriver. */
export function arriveeDuBillet(
  events: readonly HiveEvent[] | undefined,
  ticketId: string | undefined,
): {
  ouvertures: number;
  derniereOuverture: number | null;
  entrees: { label: string; ts: number }[];
} {
  const vide = {
    ouvertures: 0,
    derniereOuverture: null,
    entrees: [] as { label: string; ts: number }[],
  };
  if (!events || !ticketId) return vide;
  let ouvertures = 0;
  let derniereOuverture: number | null = null;
  const entrees: { label: string; ts: number }[] = [];
  for (const e of events) {
    if (e.payload.ticketId !== ticketId) continue;
    if (e.type === 'porte_ouverte') {
      ouvertures += 1;
      derniereOuverture = Math.max(derniereOuverture ?? 0, e.ts);
    } else if (e.type === 'node_joined') {
      const label =
        typeof e.payload.label === 'string' ? e.payload.label : String(e.payload.nodeId ?? '');
      entrees.push({ label, ts: e.ts });
    }
  }
  return { ouvertures, derniereOuverture, entrees };
}

const heure = (ts: number, lang: string): string =>
  new Date(ts).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });

export function InvitePanel({ events }: { events?: readonly HiveEvent[] } = {}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copie, setCopie] = useState<'lien' | 'commande' | null>(null);
  const [peutPartager, setPeutPartager] = useState(false);
  // Le système de l'INVITÉ, pas celui de l'hôte : on ne devine pas, le choix
  // est à un clic, et POSIX est le cas le plus fréquent.
  const [systeme, setSysteme] = useState<'posix' | 'windows'>('posix');

  useEffect(() => {
    setPeutPartager(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const commande = invite === null ? null : (invite.entree?.[systeme] ?? invite.joinCommand);
  const lien = invite?.lien ?? null;
  const arrivee = useMemo(() => arriveeDuBillet(events, invite?.id), [events, invite?.id]);
  const entree = arrivee.entrees[0] ?? null;
  const lang = t('fr', 'en');

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

  const copier = async (quoi: 'lien' | 'commande') => {
    const texte = quoi === 'lien' ? lien : commande;
    if (texte === null) return;
    if (await copierTexte(texte)) {
      setError(null);
      setCopie(quoi);
      setTimeout(() => setCopie(null), 1500);
      return;
    }
    setError(
      t(
        'copie automatique impossible — sélectionnez le texte et copiez-le à la main.',
        'automatic copy failed — select the text and copy it by hand.',
      ),
    );
  };

  const partager = async () => {
    if (lien === null) return;
    try {
      await navigator.share({
        title: t('Rejoindre ma ruche Hive', 'Join my Hive'),
        text: t(
          'Ouvre ce lien sur ton ordinateur pour rejoindre ma ruche :',
          'Open this link on your computer to join my hive:',
        ),
        url: lien,
      });
    } catch {
      // Partage annulé : rien à dire.
    }
  };

  return (
    <>
      <button
        className="invite-btn"
        onClick={openPanel}
        title={t('Inviter quelqu’un à rejoindre la ruche', 'Invite someone to join the hive')}
      >
        {t('Inviter', 'Invite')}
      </button>

      {open && (
        <Voile onClose={() => setOpen(false)}>
          <CadreInvitation onClose={() => setOpen(false)}>
            <header className="modal-head">
              <h2 id="invite-title">
                <span className="marque" aria-hidden="true" />{' '}
                {t('Inviter dans la ruche', 'Invite into the hive')}
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

            {/* Le lien est correct, mais il ne mènerait nulle part : le dire
                ICI, avant que l'invité ne l'ouvre et n'attende une ruche qui
                n'écoute pas sur cette adresse. */}
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

            <DecouvertsReseau />

            <h3 className="invite-sous-titre">
              {t('Ou par un lien, depuis n’importe où', 'Or with a link, from anywhere')}
            </h3>

            {lien !== null ? (
              <section className="porte" aria-labelledby="porte-titre">
                <p id="porte-titre" className="porte-consigne">
                  {t(
                    'Envoyez ce lien. La personne l’ouvre sur son ordinateur ; la ruche reconnaît son système, l’installe si besoin et la guide jusqu’au bout.',
                    'Send this link. They open it on their computer; the hive recognises their system, installs if needed and walks them through.',
                  )}
                </p>
                <div className="porte-lien">
                  <input
                    className="porte-lien-champ"
                    type="text"
                    readOnly
                    value={lien}
                    aria-label={t('Lien d’invitation', 'Invitation link')}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="porte-copier"
                    onClick={() => void copier('lien')}
                    data-testid="porte-copier"
                  >
                    {copie === 'lien' ? t('Copié ✓', 'Copied ✓') : t('Copier le lien', 'Copy link')}
                  </button>
                  {peutPartager && (
                    <button
                      type="button"
                      className="porte-partager"
                      onClick={() => void partager()}
                    >
                      {t('Envoyer…', 'Send…')}
                    </button>
                  )}
                </div>
                <p className="porte-portee">
                  {t(
                    'Une seule machine · valable 24 h · révocable d’un geste dans l’Intendance. Le lien ne donne aucun pouvoir sur la ruche : il ne sert qu’à obtenir une clé propre à cette machine.',
                    'One machine · valid 24 h · revocable in one click from Stewardship. The link grants no power over the hive: it only serves to obtain a key specific to that machine.',
                  )}
                </p>

                {/* ─── L'INVITÉ, VU D'ICI ────────────────────────────────────
                    Trois états, lus dans le journal : rien encore ; le lien a
                    été ouvert (la personne est devant la page) ; la machine
                    est entrée. L'hôte n'a plus à demander « ça a marché ? ». */}
                <div
                  className={`porte-arrivee${entree ? ' entree' : arrivee.ouvertures > 0 ? ' ouvert' : ''}`}
                  role="status"
                  data-testid="porte-arrivee"
                >
                  <span className="porte-pastille" aria-hidden="true" />
                  {entree ? (
                    <span>
                      <strong>{entree.label}</strong>{' '}
                      {t('est entrée dans la ruche à', 'joined the hive at')}{' '}
                      {heure(entree.ts, lang)}.
                    </span>
                  ) : arrivee.ouvertures > 0 ? (
                    <span>
                      {t('Lien ouvert à', 'Link opened at')}{' '}
                      {heure(arrivee.derniereOuverture ?? Date.now(), lang)}
                      {arrivee.ouvertures > 1 ? ` (×${arrivee.ouvertures})` : ''} —{' '}
                      {t('la machine n’est pas encore entrée.', 'the machine has not joined yet.')}
                    </span>
                  ) : (
                    <span>
                      {t(
                        'Dès que le lien est ouvert, puis que la machine entre, vous le verrez ici.',
                        'As soon as the link is opened, then the machine joins, you will see it here.',
                      )}
                    </span>
                  )}
                </div>
              </section>
            ) : (
              <ol className="invite-steps">
                <li>
                  {t(
                    'La personne colle cette commande dans un terminal — rien d’autre à installer, son Claude Code / Codex est détecté tout seul :',
                    'They paste this command into a terminal — nothing else to install, their Claude Code / Codex is detected automatically:',
                  )}
                </li>
              </ol>
            )}

            {/* ─── LA COMMANDE, REPLIÉE QUAND IL Y A UN LIEN ──────────────────
                Elle reste pour qui la préfère, et pour une ruche antérieure qui
                ne compose pas de lien. Le système se choisit : la commande
                POSIX collée dans PowerShell ne dit rien d'utile. */}
            <details className="invite-commande" open={lien === null}>
              <summary>
                {lien !== null
                  ? t('Plutôt une commande à coller ?', 'Rather paste a command?')
                  : t('La commande', 'The command')}
              </summary>
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
                <button
                  className="copy-btn"
                  onClick={() => void copier('commande')}
                  disabled={commande === null}
                >
                  {copie === 'commande' ? t('copié', 'copied') : t('copier', 'copy')}
                </button>
              </div>
              {invite && !invite.entree && (
                <p className="invite-note">
                  {t(
                    'Cette ruche est d’une version qui ne compose pas encore la commande d’entrée : la personne devra installer Hive d’abord.',
                    'This hive predates the one-command entry: they will have to install Hive first.',
                  )}
                </p>
              )}
              {invite?.invite && (
                <p className="invite-note">
                  {t(
                    'Cette ruche remet encore l’ancienne invitation, qui contient son jeton : ne la partagez qu’avec des personnes de confiance, par un canal privé.',
                    'This hive still hands out the legacy invitation, which contains its token: only share it with people you trust, over a private channel.',
                  )}
                </p>
              )}
            </details>

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
          </CadreInvitation>
        </Voile>
      )}
    </>
  );
}
