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
//   · `auto` — Windows et macOS SIGNÉS : téléchargement en arrière-plan,
//     installation sur geste ou à la sortie ;
//   · `geste` — tout le reste sous Windows et Linux : rien ne se télécharge
//     ni ne s'installe sans un « oui » dans la boîte qui l'annonce ;
//   · `page` — macOS sans signature : Squirrel.Mac refuse une app non signée,
//     l'app ouvre donc la page de la version.
//
// ─── POURQUOI PAS D'`auto` SANS SIGNATURE ────────────────────────────────────
//
// Sans `publisherName` (Authenticode), electron-updater ne vérifie que le
// sha512 de `latest.yml` — lu dans la MÊME Release que l'installeur. Qui peut
// publier une Release (un jeton volé) installerait alors son code chez tout le
// monde, à la sortie suivante, sans qu'on le voie. Tant que rien n'est signé,
// le droit de publier est la seule racine de confiance : chaque installation
// se fait donc sur un accord explicite (`hiveSigne`, posé au build par
// `electron-builder.config.cjs`, docs/APPLICATION.md § Signature).
//
// ─── UNE INSTALLATION QUI ÉCHOUE RELANCE LA RUCHE ────────────────────────────
//
// La ruche est arrêtée AVANT l'installeur. S'il ne part pas (mot de passe
// `pkexec` refusé, fichier manquant), electron-updater n'émet qu'un `error`
// et l'app reste ouverte : la ruche est relancée et on le dit — sinon, une
// ruche arrêtée derrière un écran figé, sans un mot.
//
// Pas de retour arrière : `allowDowngrade` reste faux — une base migrée en
// avant ne se relit pas sous l'ancien code (la sauvegarde d'avant chaque
// changement de version est faite au démarrage, `main.ts`).

import { app, dialog, shell } from 'electron';
import electronUpdater from 'electron-updater';
import { metaApp } from './chemins.js';
import { journal } from './journaux.js';

const { autoUpdater } = electronUpdater;

export type ModeMiseAJour = 'auto' | 'geste' | 'page';

const DEPOT = 'https://github.com/Micka420-collab/hive';
const TOUTES_LES_6_H = 6 * 60 * 60_000;

function modeMiseAJour(signee: boolean, plateforme: NodeJS.Platform): ModeMiseAJour {
  if (signee && (plateforme === 'win32' || plateforme === 'darwin')) return 'auto';
  return plateforme === 'darwin' ? 'page' : 'geste';
}

/** Ce que la boîte « disponible » dit de l'installation, en mode `geste`. */
function detailGeste(): string {
  if (process.platform === 'win32') {
    return (
      'Cette copie de Hive n’est pas signée : une mise à jour ne s’installe qu’avec votre accord. ' +
      'La ruche sera arrêtée proprement avant l’installation.'
    );
  }
  if ((process.env.APPIMAGE ?? '') !== '') {
    return 'La ruche sera arrêtée proprement, puis Hive redémarrera dans sa nouvelle version.';
  }
  return (
    'Le paquet .deb s’installe avec les droits administrateur : votre mot de passe sera demandé. ' +
    'La ruche sera arrêtée proprement avant l’installation.'
  );
}

export interface OptionsMisesAJour {
  /** Arrête la ruche proprement avant que l'installeur ne remplace l'app. */
  readonly avantInstallation: () => Promise<void>;
  /** L'installeur n'est pas parti : relancer la ruche arrêtée pour lui. */
  readonly apresEchec: () => Promise<void>;
  /** L'avancement d'un téléchargement (0 → 1), `null` quand il est fini ou abandonné. */
  readonly progression: (fraction: number | null) => void;
}

let branche = false;
let demandeManuelle = false;

export function brancherMisesAJour(o: OptionsMisesAJour): void {
  if (branche || !app.isPackaged) return;
  branche = true;
  const mode = modeMiseAJour(metaApp().signee, process.platform);
  autoUpdater.logger = journal;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = mode === 'auto';
  autoUpdater.autoInstallOnAppQuit = mode === 'auto';

  let installation = false;
  const installer = async (): Promise<void> => {
    await o.avantInstallation();
    // Un installeur qui ne part pas émet `error` PENDANT cet appel (ou plus
    // tard, Squirrel.Mac) : c'est ce drapeau qui le lui fait reconnaître.
    installation = true;
    autoUpdater.quitAndInstall(false, true);
  };

  autoUpdater.on('update-available', (info) => {
    journal.info(`mise à jour disponible : ${info.version} (${mode})`);
    if (mode === 'auto') {
      // Demandée à la main, elle se dit tout de suite : le téléchargement
      // prend des minutes, et un clic sans réponse semble perdu.
      if (demandeManuelle) {
        demandeManuelle = false;
        void dialog.showMessageBox({
          type: 'info',
          title: 'Mise à jour de Hive',
          message: `Hive ${info.version} se télécharge…`,
          detail: 'Une boîte vous proposera de redémarrer quand elle sera prête.',
        });
      }
      return;
    }
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
        detail: detailGeste(),
        buttons: ['Télécharger et installer', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0) void autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on('download-progress', (p) => o.progression(p.percent / 100));

  autoUpdater.on('update-downloaded', (info) => {
    journal.info(`mise à jour téléchargée : ${info.version}`);
    o.progression(null);
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
    o.progression(null);
    if (installation) {
      installation = false;
      void o.apresEchec();
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Mise à jour de Hive',
        message: 'La mise à jour n’a pas été installée : la ruche redémarre.',
        detail: e.message,
      });
      return;
    }
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
