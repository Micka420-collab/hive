// Lancer Hive à l'ouverture de session — DÉSACTIVÉ par défaut, comme le
// service (ADR 0004, ADR 0013 § 9). Une case dans la barre système et dans
// l'accueil ; l'installeur Windows en propose une aussi, qui écrit la MÊME
// entrée (`HKCU\…\Run`, valeur « Hive ») — l'app la relit donc telle quelle.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { cheminAutostart, executableDeSession, fichierAutostart } from './autostart-linux.js';

/** L'argument qui dit « lancé par la session » : fenêtre non montrée là où la barre existe. */
export const ARGUMENT_SESSION = '--session';
const NOM = 'Hive';

export function sessionActive(): boolean {
  if (process.platform === 'linux') return existsSync(cheminAutostart(process.env, homedir()));
  const reglages = app.getLoginItemSettings({ args: [ARGUMENT_SESSION] });
  if (process.platform !== 'win32') return reglages.openAtLogin;
  // Windows : `openAtLogin` ne lit que la valeur nommée d'après l'AUMID
  // (Electron 44, browser_win.cc), jamais « Hive » que l'app et l'installeur
  // écrivent — la case restait décochée, impossible à éteindre. Les
  // `launchItems` listent les entrées de CE binaire, par nom.
  return reglages.launchItems.some((i) => i.name === NOM && i.enabled);
}

export function poserSession(actif: boolean): void {
  if (process.platform === 'linux') {
    const f = cheminAutostart(process.env, homedir());
    if (!actif) {
      rmSync(f, { force: true });
      return;
    }
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, fichierAutostart(executableDeSession(process.env, process.execPath)));
    return;
  }
  app.setLoginItemSettings({ openAtLogin: actif, args: [ARGUMENT_SESSION], name: NOM });
}
