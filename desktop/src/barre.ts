// La barre système : l'état de la ruche en une ligne, et les gestes qu'on
// veut sans ouvrir la fenêtre (ADR 0013 § 9).

import path from 'node:path';
import { Menu, Tray, nativeImage } from 'electron';
import { etat, surEtat } from './etat.js';
import { libelleEtat } from './notifications.js';

export interface GestesBarre {
  readonly ouvrir: () => void;
  readonly redemarrer: () => void;
  readonly session: () => boolean;
  readonly poserSession: (actif: boolean) => void;
  /** Linux seulement : garder la ruche en arrière-plan quand on ferme la fenêtre. */
  readonly arrierePlan: (() => boolean) | null;
  readonly poserArrierePlan: (actif: boolean) => void;
  readonly miseAJour: () => void;
  readonly journaux: () => void;
  readonly quitter: () => void;
}

/** L'icône : modèle monochrome sous macOS (la barre la teinte), couleur ailleurs. */
function icone(marque: string): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const i = nativeImage.createFromPath(path.join(marque, 'trayTemplate.png'));
    i.setTemplateImage(true);
    return i;
  }
  return nativeImage.createFromPath(path.join(marque, 'tray.png'));
}

export function creerBarre(marque: string, g: GestesBarre): Tray {
  const barre = new Tray(icone(marque));
  barre.setToolTip('Hive');
  const construire = (): void => {
    const e = etat();
    const menu = Menu.buildFromTemplate([
      { label: libelleEtat(e), enabled: false },
      { type: 'separator' },
      { label: 'Ouvrir Hive', click: g.ouvrir },
      { label: 'Redémarrer la ruche', click: g.redemarrer, enabled: e.reine !== 'externe' },
      { type: 'separator' },
      {
        label: 'Lancer à l’ouverture de session',
        type: 'checkbox',
        checked: g.session(),
        click: (item) => g.poserSession(item.checked),
      },
      ...(g.arrierePlan
        ? [
            {
              label: 'Garder en arrière-plan à la fermeture',
              type: 'checkbox' as const,
              checked: g.arrierePlan(),
              click: (item: Electron.MenuItem) => g.poserArrierePlan(item.checked),
            },
          ]
        : []),
      { label: 'Rechercher une mise à jour', click: g.miseAJour },
      { label: 'Journaux', click: g.journaux },
      { type: 'separator' },
      { label: 'Quitter Hive', click: g.quitter },
    ]);
    barre.setContextMenu(menu);
    barre.setToolTip(`Hive — ${libelleEtat(e)}`);
  };
  construire();
  surEtat(construire);
  // Un clic sur l'icône ouvre la fenêtre (Windows, Linux) ; macOS montre le menu.
  if (process.platform !== 'darwin') barre.on('click', g.ouvrir);
  return barre;
}
