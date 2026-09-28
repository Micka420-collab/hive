// La fenêtre de l'app, et tout ce qui l'enferme (ADR 0013 § 13).
//
// Elle porte le jeton maître de la ruche : `contextIsolation`, `sandbox`,
// aucun `nodeIntegration`, navigation limitée à l'origine de SA Reine et à
// l'accueil local, nouvelles fenêtres refusées (les `https:` partent au
// navigateur), permissions refusées sauf l'écriture du presse-papier, et une
// CSP posée sur les réponses de la Reine.

import { BrowserWindow, type Session, shell } from 'electron';
import { avecCsp, politiqueCsp } from './csp.js';
import { etat } from './etat.js';
import { journal } from './journaux.js';
import { lienExterne, navigationPermise, URL_ACCUEIL } from './navigation.js';

export interface OptionsFenetre {
  readonly preload: string;
  readonly icone: string;
  /** Le fond de la marque (`marque/coquille.json`), peint avant la première page. */
  readonly fond: string;
  /** Montrer la fenêtre dès qu'elle est prête (faux au lancement de session). */
  readonly montrer: boolean;
  /** Fermer la fenêtre la cache-t-il (vrai) ou quitte-t-il (faux) ? */
  readonly fermerCache: () => boolean;
  /** La fenêtre vient d'être cachée par une fermeture. */
  readonly surCachee: () => void;
}

/** La seule permission qu'on accorde : écrire dans le presse-papier (copier un jeton, un diff). */
const PERMISSIONS = new Set(['clipboard-sanitized-write']);

let quitter = false;

/** À poser avant `app.quit()` : la fermeture de la fenêtre ne la cache plus. */
export function marquerQuitter(): void {
  quitter = true;
}

/** Les réglages de la session : CSP sur la Reine, permissions. Une fois, avant toute page. */
export function verrouillerSession(s: Session): void {
  s.webRequest.onHeadersReceived({ urls: ['http://127.0.0.1/*'] }, (details, rappel) => {
    const origine = etat().origine;
    let port = 0;
    try {
      const u = new URL(details.url);
      if (origine !== null && u.origin === origine) port = Number(u.port);
    } catch {
      // URL illisible : on ne touche à rien.
    }
    if (port === 0 || details.responseHeaders === undefined) {
      rappel({});
      return;
    }
    rappel({ responseHeaders: avecCsp(details.responseHeaders, politiqueCsp(port)) });
  });
  s.setPermissionRequestHandler((_wc, permission, rappel) => rappel(PERMISSIONS.has(permission)));
  s.setPermissionCheckHandler((_wc, permission) => PERMISSIONS.has(permission));
}

export function creerFenetre(o: OptionsFenetre): BrowserWindow {
  const fenetre = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Hive',
    icon: o.icone,
    backgroundColor: o.fond,
    autoHideMenuBar: true,
    webPreferences: {
      preload: o.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  const garder = (evenement: Electron.Event, url: string): void => {
    if (navigationPermise(url, etat().origine)) return;
    evenement.preventDefault();
    if (lienExterne(url)) void shell.openExternal(url);
    else journal.warn(`navigation refusée : ${url}`);
  };
  fenetre.webContents.on('will-navigate', garder);
  fenetre.webContents.on('will-redirect', garder);
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (lienExterne(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Un rendu qui tombe se recharge — une fois toutes les dix secondes au plus,
  // pour qu'une page qui plante au chargement ne boucle pas.
  let dernierRechargement = 0;
  fenetre.webContents.on('render-process-gone', (_e, details) => {
    journal.error(`rendu perdu : ${details.reason}`);
    if (Date.now() - dernierRechargement < 10_000) return;
    dernierRechargement = Date.now();
    // Recharger n'est permis que vers ce que la fenêtre a le droit d'afficher
    // MAINTENANT : `reload()` ne passe pas par `will-navigate`, et l'origine
    // d'une Reine partie peut être tenue par un autre programme — qui
    // recevrait l'écran et le jeton de son `localStorage`.
    if (navigationPermise(fenetre.webContents.getURL(), etat().origine))
      fenetre.webContents.reload();
    else void fenetre.loadURL(URL_ACCUEIL);
  });

  // Le fil de la navigation, dans `bureau.log` : une page qui ne charge pas
  // doit se lire dans les journaux, pas se deviner.
  fenetre.webContents.on('did-fail-load', (_e, code, description, url) => {
    if (code !== -3) journal.warn(`chargement échoué (${String(code)} ${description}) : ${url}`);
  });
  fenetre.webContents.on('console-message', (e) => {
    if (e.level === 'error') journal.warn(`page : ${e.message}`);
  });

  fenetre.once('ready-to-show', () => {
    if (o.montrer) fenetre.show();
  });

  fenetre.on('close', (e) => {
    if (quitter || !o.fermerCache()) return;
    e.preventDefault();
    fenetre.hide();
    o.surCachee();
  });

  void fenetre.loadURL(URL_ACCUEIL);
  return fenetre;
}

/** Montre la fenêtre, la ramène devant. */
export function ramener(fenetre: BrowserWindow): void {
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
}
