// Le thème de marque actif : `HIVE_BRANDING`, sinon `branding/actif`.
// Partagé par la copie de la marque et la configuration d'electron-builder,
// pour qu'un build ne mélange jamais deux thèmes.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUREAU = fileURLToPath(new URL('..', import.meta.url));

export function themeActif() {
  const force = (process.env.HIVE_BRANDING ?? '').trim();
  if (force !== '') return force;
  return readFileSync(path.join(BUREAU, 'branding', 'actif'), 'utf8').trim() || 'neutre';
}

export function sortiesDuTheme() {
  return path.join(BUREAU, 'branding', themeActif(), 'sorties');
}
