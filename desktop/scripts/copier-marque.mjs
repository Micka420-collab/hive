// Copie les sorties du thème actif dans `desktop/marque/` : c'est là que la
// coquille les lit, en développement comme dans l'app installée (`files`
// d'electron-builder les range au même chemin dans l'asar).
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BUREAU, sortiesDuTheme, themeActif } from './theme.mjs';

const sorties = sortiesDuTheme();
if (!existsSync(path.join(sorties, 'icon.png'))) {
  console.error(`✘ Le thème « ${themeActif()} » n'a pas de sorties générées : npm run marque`);
  process.exit(2);
}
const cible = path.join(BUREAU, 'marque');
rmSync(cible, { recursive: true, force: true });
cpSync(sorties, cible, { recursive: true });
console.log(`marque « ${themeActif()} » copiée dans desktop/marque/`);
