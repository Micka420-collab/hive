// Les mises à jour de l'app : electron-updater sur les Releases GitHub
// publiées, canal `latest` (ADR 0013 § 10).
//
// ─── JAMAIS DE REDÉMARRAGE DANS LE DOS ───────────────────────────────────────
//
// Une ouvrière peut être au milieu d'une tâche, un agent au milieu d'un
// merge. Une mise à jour téléchargée ne s'installe donc QUE sur un geste :
// « Redémarrer maintenant » dans la boîte qui l'annonce, ou en quittant Hive.
// Et avant d'installer, la ruche est arrêtée proprement — pas tuée par
// l'installeur.
//
// ─── TROIS FAÇONS, SELON CE QUE LE SYSTÈME PERMET ────────────────────────────
//
//   · `auto` — Windows (NSIS) et l'AppImage : téléchargement en arrière-plan,
//     installation sur geste ou à la sortie ;
//   · `geste` — le `.deb` : l'installation demande le mot de passe (`pkexec`),
//     donc rien ne se télécharge sans qu'on l'ait demandé ;
//   · `page` — macOS sans signature : Squirrel.Mac refuse une app non signée,
//     l'app ouvre donc la page de la version. `auto` dès que la signature
//     existe (`hiveSigne`, posé au build par `electron-builder.config.cjs`).
//
// Pas de retour arrière : `allowDowngrade` reste faux — une base migrée en
// avant ne se relit pas sous l'ancien code (la sauvegarde d'avant chaque
// changement de version est faite au démarrage, `main.ts`).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, dialog, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { journal } from './journaux.js';

const { autoUpdater } = electronUpdater;

export type ModeMiseAJour = 'auto' | 'geste' | 'page';

const DEPOT = 'https://github.com/Micka420-collab/hive';
const TOUTES_LES_6_H = 6 * 60 * 60_000;

function signeeMac(): boolean {
  try {
    const p = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
      hiveSigne?: unknown;
    };
    return p.hiveSigne === true;
  } catch {
    return false;
  }
}

export function modeMiseAJour(): ModeMiseAJour {
  if (process.platform === 'win32') return 'auto';
  if (process.platform === 'darwin') return signeeMac() ? 'auto' : 'page';
  return (process.env.APPIMAGE ?? '') !== '' ? 'auto' : 'geste';
}

export interface OptionsMisesAJour {
  /** Arrête la ruche proprement avant que l'installeur ne remplace l'app. */
  readonly avantInstallation: () => Promise<void>;
}

let branche = false;
let demandeManuelle = false;

export function brancherMisesAJour(o: OptionsMisesAJour): void {
  if (branche || !app.isPackaged) return;
  branche = true;
  const mode = modeMiseAJour();
  autoUpdater.logger = journal;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = mode === 'auto';
  autoUpdater.autoInstallOnAppQuit = mode === 'auto';

  const installer = async (): Promise<void> => {
    await o.avantInstallation();
    autoUpdater.quitAndInstall(false, true);
  };

  autoUpdater.on('update-available', (info) => {
    journal.info(`mise à jour disponible : ${info.version} (${mode})`);
    if (mode === 'auto') return;
    if (mode === 'page') {
      void dialog
        .showMessageBox({
          type: 'info',
          title: 'Mise à jour de Hive',
          message: `Hive ${info.version} est disponible.`,
          detail:
            'Cette copie de Hive n’est pas signée : macOS n’autorise pas la mise à jour automatique. ' +
            'Téléchargez la nouvelle version depuis sa page, puis remplacez l’app dans Applications.',
          buttons: ['Ouvrir la page de la version', 'Plus tard'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((r) => {
          if (r.response === 0) void shell.openExternal(`${DEPOT}/releases/tag/v${info.version}`);
        });
      return;
    }
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Mise à jour de Hive',
        message: `Hive ${info.version} est disponible.`,
        detail:
          'Le paquet .deb s’installe avec les droits administrateur : votre mot de passe sera demandé. ' +
          'La ruche sera arrêtée proprement avant l’installation.',
        buttons: ['Télécharger et installer', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) void autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on('update-downloaded', (info) => {
    journal.info(`mise à jour téléchargée : ${info.version}`);
    if (mode === 'geste') {
      void installer();
      return;
    }
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Mise à jour de Hive',
        message: `Hive ${info.version} est prête.`,
        detail:
          'Elle s’installera quand vous quitterez Hive. Redémarrer maintenant arrête la ruche ' +
          'proprement — une tâche en cours sera reprise au redémarrage.',
        buttons: ['Redémarrer maintenant', 'Plus tard'],
        defaultId: 1,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) void installer();
      });
  });

  autoUpdater.on('update-not-available', (info) => {
    if (!demandeManuelle) return;
    demandeManuelle = false;
    void dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour de Hive',
      message: `Hive est à jour (${info.version}).`,
    });
  });

  autoUpdater.on('error', (e) => {
    journal.warn(`mise à jour : ${e.message}`);
    if (!demandeManuelle) return;
    demandeManuelle = false;
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Mise à jour de Hive',
      message: 'La recherche de mise à jour a échoué.',
      detail: e.message,
    });
  });

  const chercher = (): void => {
    autoUpdater.checkForUpdates().catch((e: unknown) => journal.warn(`mise à jour : ${String(e)}`));
  };
  // Une minute après le démarrage — la ruche d'abord —, puis toutes les 6 h.
  setTimeout(chercher, 60_000).unref();
  setInterval(chercher, TOUTES_LES_6_H).unref();
}

/** « Rechercher une mise à jour » : la même recherche, dont l'issue se dit toujours. */
export function chercherMiseAJour(): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour de Hive',
      message: 'Les mises à jour ne se cherchent que dans l’app installée.',
      detail: 'En développement, la version est celle du dépôt : git pull.',
    });
    return;
  }
  demandeManuelle = true;
  autoUpdater.checkForUpdates().catch((e: unknown) => journal.warn(`mise à jour : ${String(e)}`));
}
