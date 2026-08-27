// Préférence locale du nœud : application IA + modèles confirmés.
//
// Le fichier vit sous le workRoot (déjà gitignoré), pas dans le dépôt ni dans
// la base de la Reine. `HIVE_AGENT` / `HIVE_MODELES` gardent toujours priorité.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { estAgentType, type AgentType } from './agent-detect.js';
import { parseModeles } from './modeles.js';

export interface PreferencesIA {
  readonly version: 1;
  readonly agent: AgentType;
  /** `null` = laisser l'application choisir son modèle. */
  readonly modeles: string[] | null;
}

export const FICHIER_PREFERENCES_IA = 'ia.json';

export function cheminPreferencesIA(workRoot: string): string {
  return path.join(workRoot, FICHIER_PREFERENCES_IA);
}

export function lirePreferencesIA(workRoot: string): PreferencesIA | null {
  const fichier = cheminPreferencesIA(workRoot);
  if (!existsSync(fichier)) return null;
  try {
    const raw = JSON.parse(readFileSync(fichier, 'utf8').slice(0, 32 * 1024)) as {
      version?: unknown;
      agent?: unknown;
      modeles?: unknown;
    };
    if (raw.version !== 1 || !estAgentType(raw.agent)) return null;
    if (raw.modeles === null) return { version: 1, agent: raw.agent, modeles: null };
    if (!Array.isArray(raw.modeles)) return null;
    const propres = parseModeles(raw.modeles.map(String).join(','));
    if (!propres) return null;
    return { version: 1, agent: raw.agent, modeles: propres };
  } catch {
    return null;
  }
}

export function ecrirePreferencesIA(workRoot: string, preferences: PreferencesIA): string {
  mkdirSync(workRoot, { recursive: true });
  const fichier = cheminPreferencesIA(workRoot);
  const temporaire = `${fichier}.tmp-${process.pid}`;
  writeFileSync(temporaire, `${JSON.stringify(preferences, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  renameSync(temporaire, fichier);
  try {
    chmodSync(fichier, 0o600);
  } catch {
    // Windows n'exprime pas les ACL via chmod : l'écriture reste valide.
  }
  return fichier;
}
