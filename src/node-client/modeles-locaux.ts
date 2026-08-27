// Modèles visibles LOCALEMENT sur le poste — sans appel fournisseur.
//
// Une configuration locale prouve qu'un sélecteur est connu du poste ; elle ne
// prouve jamais que l'abonnement y donne encore accès. Les suggestions sont
// donc présentées à l'humain, puis deviennent routables seulement s'il les
// confirme dans le choix du premier lancement.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentType } from './agent-detect.js';
import { LIMITS } from '../shared/protocol.js';

export type SourceModeleLocal = 'environnement' | 'configuration' | 'suggestion';

export interface ModeleLocal {
  readonly id: string;
  readonly source: SourceModeleLocal;
}

const MAX_CONFIG_OCTETS = 256 * 1024;
const CONTROLE = /[\u0000-\u001f\u007f\u001b]/;

/** Un sélecteur peut devenir un argument `--model` sans devenir une option. */
export function modeleLocalValide(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const nom = v.trim();
  return nom.length > 0 && nom.length <= LIMITS.name && !nom.startsWith('-') && !CONTROLE.test(nom);
}

function chaines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(modeleLocalValide).map((x) => x.trim());
}

/** Champs documentés / courants d'un `~/.claude/settings.json`. */
export function modelesDepuisClaudeSettings(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const o = raw as Record<string, unknown>;
  const out: string[] = [];
  for (const cle of ['model', 'fallbackModel'] as const) {
    if (modeleLocalValide(o[cle])) out.push(o[cle].trim());
  }
  out.push(...chaines(o.availableModels));
  if (o.modelPicker && typeof o.modelPicker === 'object') {
    const options = (o.modelPicker as Record<string, unknown>).options;
    if (Array.isArray(options)) {
      for (const option of options) {
        if (!option || typeof option !== 'object') continue;
        const model = (option as Record<string, unknown>).model;
        if (modeleLocalValide(model)) out.push(model.trim());
      }
    }
  }
  if (o.modelOverrides && typeof o.modelOverrides === 'object') {
    for (const alias of Object.keys(o.modelOverrides as Record<string, unknown>)) {
      if (modeleLocalValide(alias)) out.push(alias.trim());
    }
  }
  return [...new Set(out)];
}

/** Le fichier Cursor porte le modèle sélectionné, pas les droits du compte. */
export function modelesDepuisCursorConfig(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const model = (raw as Record<string, unknown>).model;
  if (typeof model === 'string') return modeleLocalValide(model) ? [model.trim()] : [];
  if (!model || typeof model !== 'object') return [];
  const o = model as Record<string, unknown>;
  const out: string[] = [];
  for (const cle of ['modelId', 'displayModelId'] as const) {
    if (modeleLocalValide(o[cle])) {
      out.push(o[cle].trim());
      break;
    }
  }
  if (Array.isArray(o.aliases)) out.push(...chaines(o.aliases));
  else if (o.aliases && typeof o.aliases === 'object') {
    for (const alias of Object.keys(o.aliases as Record<string, unknown>)) {
      if (modeleLocalValide(alias)) out.push(alias.trim());
    }
  }
  return [...new Set(out)];
}

/** Extrait uniquement les sélecteurs `model = "…"`, jamais clés/URL TOML. */
export function modelesDepuisToml(contenu: string): string[] {
  const out: string[] = [];
  let section = '';
  for (const ligne of contenu.split(/\r?\n/)) {
    const table = /^\s*\[model\.["']?([^"'[\]]+)["']?\]\s*$/.exec(ligne);
    if (table?.[1]) {
      section = 'model';
      if (modeleLocalValide(table[1])) out.push(table[1].trim());
      continue;
    }
    const sectionBrute = /^\s*\[([^\]]+)\]\s*$/.exec(ligne);
    if (sectionBrute?.[1]) {
      section = sectionBrute[1].trim();
      continue;
    }
    // Dans `[model.<alias>]`, `model = "provider-id"` est un détail du
    // fournisseur : l'argument CLI est l'alias de la table, déjà pris ci-dessus.
    if (section === 'model') continue;
    const m = /^\s*(?:model|default)\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/.exec(ligne);
    if (m?.[1] && modeleLocalValide(m[1])) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

export function suggestionsModeles(agent: AgentType): string[] {
  switch (agent) {
    case 'claude-code':
      return ['sonnet', 'opus', 'haiku'];
    case 'grok':
      return ['grok-build'];
    default:
      return [];
  }
}

interface OptionsInventaire {
  existe?: (chemin: string) => boolean;
  lire?: (chemin: string) => string;
  plateforme?: string;
}

function lireJson(
  chemin: string,
  opts: Required<Pick<OptionsInventaire, 'existe' | 'lire'>>,
): unknown {
  if (!opts.existe(chemin)) return null;
  try {
    return JSON.parse(opts.lire(chemin).slice(0, MAX_CONFIG_OCTETS));
  } catch {
    return null;
  }
}

function lireTexte(
  chemin: string,
  opts: Required<Pick<OptionsInventaire, 'existe' | 'lire'>>,
): string {
  if (!opts.existe(chemin)) return '';
  try {
    return opts.lire(chemin).slice(0, MAX_CONFIG_OCTETS);
  } catch {
    return '';
  }
}

/**
 * Inventorie config/env + suggestions sûres. Aucun binaire n'est lancé et
 * aucun fichier de projet n'est lu : un dépôt ne peut donc pas déclarer des
 * capacités machine à la place de son propriétaire.
 */
export function inventorierModelesLocaux(
  agent: AgentType,
  env: NodeJS.ProcessEnv = process.env,
  options: OptionsInventaire = {},
): ModeleLocal[] {
  const opts = {
    existe: options.existe ?? existsSync,
    lire: options.lire ?? ((chemin: string) => readFileSync(chemin, 'utf8')),
  };
  const plateforme = options.plateforme ?? process.platform;
  const home = (plateforme === 'win32' ? env.USERPROFILE : env.HOME)?.trim();
  const p = plateforme === 'win32' ? path.win32 : path.posix;
  const trouves: ModeleLocal[] = [];

  const ajouter = (id: unknown, source: SourceModeleLocal) => {
    if (!modeleLocalValide(id)) return;
    const nom = id.trim();
    if (!trouves.some((m) => m.id === nom)) trouves.push({ id: nom, source });
  };

  if (agent === 'claude-code') {
    for (const cle of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
    ]) {
      ajouter(env[cle], 'environnement');
    }
    const dir = env.CLAUDE_CONFIG_DIR?.trim() || (home ? p.join(home, '.claude') : '');
    if (dir) {
      for (const id of modelesDepuisClaudeSettings(lireJson(p.join(dir, 'settings.json'), opts))) {
        ajouter(id, 'configuration');
      }
    }
  } else if (agent === 'cursor') {
    const fichier = env.CURSOR_CONFIG_DIR?.trim()
      ? p.join(env.CURSOR_CONFIG_DIR.trim(), 'cli-config.json')
      : env.XDG_CONFIG_HOME?.trim()
        ? p.join(env.XDG_CONFIG_HOME.trim(), 'cursor', 'cli-config.json')
        : home
          ? p.join(home, '.cursor', 'cli-config.json')
          : '';
    if (fichier) {
      for (const id of modelesDepuisCursorConfig(lireJson(fichier, opts))) {
        ajouter(id, 'configuration');
      }
    }
  } else if (agent === 'codex' || agent === 'grok') {
    const dir =
      agent === 'codex'
        ? env.CODEX_HOME?.trim() || (home ? p.join(home, '.codex') : '')
        : env.GROK_HOME?.trim() || (home ? p.join(home, '.grok') : '');
    if (dir) {
      for (const id of modelesDepuisToml(lireTexte(p.join(dir, 'config.toml'), opts))) {
        ajouter(id, 'configuration');
      }
    }
  }

  for (const id of suggestionsModeles(agent)) ajouter(id, 'suggestion');
  return trouves.slice(0, LIMITS.modeles);
}
