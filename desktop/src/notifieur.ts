// L'app écoute le journal de SA Reine comme un écran (`subscribe` sur `/ws`)
// et notifie ce qui attend un humain (`notificationPour`). Hors de la fenêtre
// — cachée dans la barre, ou derrière un autre programme —, c'est la seule
// façon d'apprendre qu'un agent attend un identifiant.

import { Notification } from 'electron';
import { etat, surEtat } from './etat.js';
import { journal } from './journaux.js';
import { type NotificationRuche, notificationPour } from './notifications.js';

export type Montrer = (n: NotificationRuche) => void;

/** Une notification native ; son clic ouvre la vue qu'elle nomme. */
export function notifierNatif(ouvrir: (route: string) => void): Montrer {
  return (n) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: n.titre, body: n.corps, silent: false });
    notification.on('click', () => ouvrir(n.route));
    notification.show();
  };
}

/** S'abonne tant que la Reine est en ligne ; se réabonne à chaque nouvelle origine. */
export function ecouterLaRuche(montrer: Montrer): void {
  let socket: WebSocket | null = null;
  let origineSuivie: string | null = null;
  let recul = 1_000;

  const ouvrir = (origine: string, jeton: string): void => {
    const ws = new WebSocket(`${origine.replace(/^http/, 'ws')}/ws`);
    socket = ws;
    ws.addEventListener('open', () => {
      recul = 1_000;
      ws.send(JSON.stringify({ type: 'subscribe', token: jeton }));
    });
    ws.addEventListener('message', (m: MessageEvent) => {
      let msg: { type?: unknown; event?: { type?: unknown; payload?: unknown } };
      try {
        msg = JSON.parse(String(m.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type !== 'event' || typeof msg.event?.type !== 'string') return;
      const payload =
        typeof msg.event.payload === 'object' && msg.event.payload !== null
          ? (msg.event.payload as Record<string, unknown>)
          : {};
      const n = notificationPour({ type: msg.event.type, payload });
      if (n !== null) montrer(n);
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      const e = etat();
      if (e.origine !== origine || e.jeton === null) return;
      setTimeout(() => {
        const maintenant = etat();
        if (socket === null && maintenant.origine === origine && maintenant.jeton !== null) {
          ouvrir(origine, maintenant.jeton);
        }
      }, recul).unref();
      recul = Math.min(recul * 2, 30_000);
    });
    ws.addEventListener('error', () => journal.warn('flux de la Reine : erreur de connexion'));
  };

  surEtat((e) => {
    if (e.origine === origineSuivie) return;
    origineSuivie = e.origine;
    const ancien = socket;
    socket = null;
    ancien?.close();
    if (e.origine !== null && e.jeton !== null) ouvrir(e.origine, e.jeton);
  });
}
