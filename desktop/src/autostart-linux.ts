// Le lancement à l'ouverture de session, sous Linux : un fichier
// `~/.config/autostart/hive.desktop` (spécification XDG Autostart), que
// GNOME, KDE, XFCE et Cinnamon lisent tous. Windows et macOS ont
// `setLoginItemSettings` ; Linux n'a que ce fichier.
//
// Pour une AppImage, `process.execPath` est un chemin de montage TEMPORAIRE
// (`/tmp/.mount_Hive…`) qui n'existera plus à la prochaine session : c'est
// `$APPIMAGE`, le fichier lui-même, qu'il faut lancer.

import path from 'node:path';

/** Le binaire à lancer à l'ouverture de session. */
export function executableDeSession(env: NodeJS.ProcessEnv, execPath: string): string {
  const appimage = (env.APPIMAGE ?? '').trim();
  return appimage !== '' ? appimage : execPath;
}

/** Cite un argument pour la clé `Exec=` (spécification Desktop Entry). */
function citer(arg: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(arg) ? arg : `"${arg.replace(/(["`$\\])/g, '\\$1')}"`;
}

export function fichierAutostart(executable: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Hive',
    'Comment=La ruche démarre avec la session',
    `Exec=${citer(executable)} --session`,
    'Icon=hive',
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function cheminAutostart(env: NodeJS.ProcessEnv, home: string): string {
  const config = (env.XDG_CONFIG_HOME ?? '').trim() || path.join(home, '.config');
  return path.join(config, 'autostart', 'hive.desktop');
}
