// Où l'app trouve ce qu'elle lance et ce qu'elle montre.
//
//   · RACINE_HIVE — le code de Hive : `resources/hive/` dans l'app installée
//     (hors asar, ADR 0013 § 3), la racine du dépôt en développement ;
//   · la coquille (préchargement, accueil, marque) : dans `app.asar`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface CheminsApp {
  readonly racineHive: string;
  readonly piece: string;
  readonly preload: string;
  /** La racine de la coquille : `bureau://app/…` y lit `accueil/` et `marque/`. */
  readonly coquille: string;
  readonly marque: string;
}

export function cheminsApp(): CheminsApp {
  // La coquille (asar ou `desktop/`) porte `app/`, `accueil/` et `marque/` —
  // cette dernière copiée du thème actif par `npm run build`
  // (`scripts/copier-marque.mjs`), pour que le développement et l'app
  // installée lisent la marque au MÊME chemin.
  const coquille = app.getAppPath();
  const racineHive = app.isPackaged
    ? path.join(process.resourcesPath, 'hive')
    : path.resolve(coquille, '..');
  return {
    racineHive,
    piece: app.isPackaged
      ? path.join(racineHive, 'piece.cjs')
      : path.join(coquille, 'app', 'piece.cjs'),
    preload: path.join(coquille, 'app', 'preload.cjs'),
    coquille,
    marque: path.join(coquille, 'marque'),
  };
}

/**
 * Ce que le `package.json` de la coquille dit de l'app : son identifiant
 * (`hiveIdApp`, l'`appId` d'electron-builder — AUMID des raccourcis Windows)
 * et, dans l'app construite, les systèmes où elle est signée (`hiveSigne`,
 * posé par `extraMetadata`, electron-builder.config.cjs).
 */
export interface MetaApp {
  readonly idApp: string;
  readonly signee: boolean;
}

export function metaApp(): MetaApp {
  const p = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
    hiveIdApp: string;
    hiveSigne?: Partial<Record<string, boolean>>;
  };
  return { idApp: p.hiveIdApp, signee: p.hiveSigne?.[process.platform] === true };
}
