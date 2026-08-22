// Détection des agents IA de codage installés sur la machine du membre.
// Objectif : qu'un ami n'ait RIEN à configurer — on repère automatiquement son
// Claude Code ou son Codex et on choisit le bon adaptateur.
//
// Sécurité : sondage par spawn(bin, ['--version'], { shell:false }) — jamais
// d'interprétation shell. On ne fait que constater la présence du binaire.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { argvAgent } from '../shared/agent-windows.js';

export type AgentType = 'claude-code' | 'cursor' | 'codex' | 'grok' | 'custom' | 'shell';

interface AgentProbe {
  agent: Exclude<AgentType, 'shell' | 'custom'>;
  /** Binaires candidats (Windows ajoute .cmd/.exe automatiquement via la sonde). */
  bins: string[];
  label: string;
  /**
   * Sous-chaîne attendue dans la sortie de `--version` (insensible à la casse).
   * Sert à écarter les homonymes génériques — surtout `agent`, nom du CLI Cursor
   * mais aussi de bien d'autres outils.
   */
  signature?: string;
}

/**
 * Ordre de préférence quand plusieurs agents sont là et qu'on ne demande pas
 * (hors TTY, CI) : Claude Code, puis Cursor, puis Codex, puis Grok.
 */
const PROBES: AgentProbe[] = [
  { agent: 'claude-code', bins: ['claude'], label: 'Claude Code' },
  // `cursor-agent` : nom historique unique. `agent` : binaire actuel de l'installeur
  // Cursor — exige la signature pour ne pas confondre avec un autre `agent`.
  {
    agent: 'cursor',
    bins: ['cursor-agent', 'agent'],
    label: 'Cursor',
    signature: 'cursor',
  },
  { agent: 'codex', bins: ['codex'], label: 'Codex' },
  // `grok-build` : binaire Rust natif, donc aucun shim `.cmd` à contourner.
  { agent: 'grok', bins: ['grok'], label: 'Grok Build' },
];

/** Libellé d'affichage pour un `AgentType` (détecté ou forcé). */
export function labelPour(agent: AgentType): string {
  if (agent === 'shell') return 'shell (simulé)';
  if (agent === 'custom') return 'commande personnalisée (HIVE_AGENT_CMD)';
  const probe = PROBES.find((p) => p.agent === agent);
  return probe?.label ?? agent;
}

/**
 * Variantes d'un binaire à essayer, selon la plateforme.
 *
 * ─── POURQUOI `.cmd` N'Y EST PAS, ALORS QU'IL Y ÉTAIT ────────────────────────
 *
 * La version précédente rendait `[bin.cmd, bin.exe, bin]` sous Windows, et
 * `.cmd` venait EN PREMIER. C'était une ligne qui ne pouvait pas fonctionner :
 * la sonde lance `spawn(bin, ['--version'], { shell: false })`, et Node refuse
 * d'exécuter un `.cmd` ou un `.bat` sans interpréteur de commandes — c'est
 * documenté, et durci depuis la CVE-2024-27980. Le candidat `.cmd` échouait
 * donc TOUJOURS, quelle que soit la machine.
 *
 * On ne garde pas une variante qui ne peut pas aboutir : elle donne l'illusion
 * d'une couverture. Restent `.exe`, la seule que `spawn` sait lancer sous
 * Windows, et le nom nu pour les rares binaires sans extension.
 *
 * ─── CE QUE ÇA IMPLIQUAIT, ET QUI EST MAINTENANT TRAITÉ AILLEURS ─────────────
 *
 * Un agent installé par npm — c'est le cas de Claude Code — n'expose sous
 * Windows qu'un shim `claude.cmd`. Il reste donc introuvable PAR CETTE
 * FONCTION, et c'est voulu : `candidates` ne rend que ce que `spawn` sait
 * lancer.
 *
 * Ce constat s'arrêtait autrefois là, sur un « c'est difficile à corriger ».
 * Il ne s'arrête plus : `firstPresent` vise le script réel du paquet npm et
 * lance Node dessus (voir `shared/agent-windows.ts`). C'est plus strict que
 * `shell: true`, pas moins — on sait quel fichier on exécute au lieu de
 * déléguer la résolution à `cmd.exe`.
 *
 * La plateforme est un PARAMÈTRE : sans ça, la branche Windows ne serait
 * vérifiable que sur une machine Windows, c'est-à-dire jamais. C'est exactement
 * ce qui a laissé la variante `.cmd` en place sans que personne la mette en
 * doute.
 */
export function candidates(bin: string, plateforme: string = process.platform): string[] {
  if (plateforme === 'win32') return [`${bin}.exe`, bin];
  return [bin];
}

/**
 * Les emplacements où un agent s'installe SANS passer par le PATH du nœud.
 *
 * ─── CE QUE LE SONDAGE PAR PATH RATE ─────────────────────────────────
 *
 * L'installeur natif de Claude Code dépose son binaire dans `~/.local/bin`, et
 * ajoute ce dossier au PATH DU SHELL de connexion. Un nœud lancé autrement —
 * double-clic, service, terminal intégré d'un éditeur — hérite d'un PATH qui
 * ne le contient pas : `spawn('claude')` rend ENOENT, la détection conclut
 * « aucun agent », et la ruche produit des diffs SIMULÉS sur une machine où
 * l'agent est pourtant installé. C'est exactement le symptôme rapporté :
 * « il détecte mal Claude Code ».
 *
 * On sonde donc AUSSI ces chemins absolus. `env` et `plateforme` sont des
 * paramètres : sans eux la branche Windows ne serait vérifiable que sur
 * Windows, c'est-à-dire jamais.
 */
export function cheminsNatifs(bin: string, env: NodeJS.ProcessEnv, plateforme: string): string[] {
  const maison = (plateforme === 'win32' ? env.USERPROFILE : env.HOME)?.trim();
  if (!maison) return [];
  const p = plateforme === 'win32' ? path.win32 : path.posix;
  const exe = plateforme === 'win32' ? `${bin}.exe` : bin;
  const lieux = [p.join(maison, '.local', 'bin', exe)];
  // L'installation « locale » de Claude Code, hors PATH par construction.
  if (bin === 'claude') lieux.push(p.join(maison, '.claude', 'local', exe));
  return lieux;
}

/**
 * Ce qu'il faut dire à l'humain sur l'agent retenu — ou `null` s'il n'y a
 * rien à signaler.
 *
 * ─── POURQUOI C'EST UNE FONCTION, ET PAS TROIS LIGNES DANS `main.ts` ─────────
 *
 * Ça y était, et la loupe a montré les deux comparaisons SANS TEST : on
 * pouvait inverser `=== 'shell'` en `!==` sans qu'une seule assertion bouge.
 * Les tests lisaient la SOURCE et constataient que les phrases existaient ;
 * aucun ne vérifiait laquelle est choisie.
 *
 * Ce n'est pas un détail cosmétique. Les deux cas demandent à l'humain des
 * gestes opposés — « installez un agent » contre « vous en avez un, c'est
 * vous qui l'avez désactivé ». Se tromper de phrase envoie quelqu'un
 * réinstaller ce qu'il a déjà.
 */
export function messageAgent(agent: AgentType, tous: readonly AgentType[]): string | null {
  if (agent !== 'shell') return null;
  return tous.some((a) => a !== 'shell')
    ? '   ℹ Agent « shell simulé » forcé par HIVE_AGENT alors qu’un agent réel est disponible.'
    : '   ℹ Aucun agent IA détecté : mode « shell simulé » — les diffs produits sont FAUX.\n' +
        '     Installez Claude Code (`npm i -g @anthropic-ai/claude-code`), Cursor\n' +
        '     (`curl https://cursor.com/install -fsS | bash`), ou Codex, puis relancez.';
}

/**
 * Les variables qu'une SONDE ne doit jamais recevoir.
 *
 * ─── LE DANGER, ÉNONCÉ SANS DÉTOUR ───────────────────────────────────────────
 *
 * Sonder, c'est lancer un binaire dont on ne sait encore RIEN — c'est même
 * toute la question qu'on lui pose. `join.ts` le disait déjà en toutes
 * lettres : « on ne met PAS le token dans l'environnement avant, sinon un
 * binaire homonyme malveillant (claude.cmd déposé en tête de PATH) en
 * hériterait ».
 *
 * `join.ts` s'en protégeait par l'ORDRE : il sondait avant d'avoir lu le
 * secret. Une protection par l'ordre tient tant que personne ne réordonne —
 * et `main.ts` charge `.env` dès sa première ligne, donc y sonder exposerait
 * le jeton. La protection doit donc vivre DANS la sonde, pas dans la prudence
 * de ses appelants.
 *
 * ─── POURQUOI UNE LISTE DE REFUS, ET NON D'AUTORISATION ──────────────────────
 *
 * Une liste d'autorisation serait plus sûre en théorie et cassante en
 * pratique : `claude --version` a besoin du PATH, et sous Windows aussi de
 * `SystemRoot`, `PATHEXT`, `ProgramFiles`… en oublier un ferait échouer la
 * sonde, donc conclure « aucun agent », donc retomber en simulé — le défaut
 * même qu'on répare. On nomme donc ce qui doit partir, et un test garde la
 * liste contre la dérive : elle a le droit d'être incomplète, pas d'être
 * oubliée le jour où l'on ajoute un secret.
 */
export const SECRETS_JAMAIS_SONDES: readonly string[] = [
  // Les secrets de la ruche elle-même.
  'HIVE_TOKEN',
  'HIVE_JWT_SECRET',
  'HIVE_INVITE',
  'HIVE_GITHUB_TOKEN',
  'HIVE_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
  // Les identifiants de l'humain. Un `claude.cmd` hostile veut EXACTEMENT ça :
  // l'abonnement de celui qui l'exécute. Une sonde n'en a aucun besoin —
  // `--version` s'affiche sans authentification.
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'CURSOR_API_KEY',
  'QUEEN_BEE_API_KEY',
  'OPENROUTER_API_KEY',
];

/**
 * L'environnement qu'une sonde a le droit d'hériter : tout, sauf les secrets.
 *
 * Pur, et donc vérifiable — c'est ce qui permet de prouver que le jeton ne
 * passe pas, au lieu de l'affirmer.
 */
export function envSonde(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const propre: NodeJS.ProcessEnv = { ...env };
  for (const cle of SECRETS_JAMAIS_SONDES) delete propre[cle];
  return propre;
}

/**
 * Vrai si `bin --version` s'exécute et retourne le code 0 — un signal POSITIF
 * de présence d'un vrai agent. On refuse volontairement les faux positifs :
 *  - timeout → « incertain », traité comme absent (on ne route pas de vraies
 *    tâches vers un binaire qui se bloque) ;
 *  - code de sortie ≠ 0, ou erreur de lancement (ENOENT, EACCES…) → absent.
 *  - `signature` fournie → la sortie doit la contenir (insensible à la casse),
 *    sinon un homonyme générique (`agent`) compterait à tort.
 * Un environnement cassé retombe ainsi sur le shell simulé (sûr) plutôt que
 * d'envoyer du travail — et le token — à un binaire douteux.
 */
function probeBin(
  argv: readonly string[],
  timeoutMs = 4_000,
  signature?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (found: boolean): void => {
      if (done) return;
      done = true;
      resolve(found);
    };
    let child;
    let sortie = '';
    try {
      const [bin, ...avant] = argv;
      child = spawn(bin ?? '', [...avant, '--version'], {
        shell: false,
        windowsHide: true,
        // On capture stdout/stderr seulement si une signature est exigée —
        // sinon `ignore` évite de gonfler la mémoire pour rien.
        stdio: signature ? ['ignore', 'pipe', 'pipe'] : 'ignore',
        // Un binaire qu'on n'a pas encore identifié n'hérite d'aucun secret.
        env: envSonde(process.env),
      });
    } catch {
      finish(false);
      return;
    }
    if (signature) {
      const cap = (chunk: Buffer): void => {
        if (sortie.length < 8_192) sortie += chunk.toString();
      };
      child.stdout?.on('data', cap);
      child.stderr?.on('data', cap);
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(false); // bloqué : incertain → considéré absent
    }, timeoutMs);
    timer.unref?.();
    child.on('error', () => {
      clearTimeout(timer);
      finish(false); // ENOENT / EACCES / etc. → absent
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish(false);
        return;
      }
      if (signature && !sortie.toLowerCase().includes(signature.toLowerCase())) {
        finish(false);
        return;
      }
      finish(true);
    });
  });
}

/**
 * Comment on constate la présence d'un binaire.
 *
 * C'est la COUTURE qui manquait. Voir `detectBestAgent`.
 */
export type Sonde = (argv: readonly string[]) => Promise<boolean>;

/** Résout le premier binaire présent parmi les candidats d'un agent. */
async function firstPresent(
  bins: string[],
  sonder: Sonde,
  plateforme: string,
  env: NodeJS.ProcessEnv,
  existe: (chemin: string) => boolean,
  signature?: string,
): Promise<boolean> {
  // Signature : uniquement pour le binaire générique `agent` (CLI Cursor), et
  // uniquement avec la sonde réelle. `cursor-agent` est déjà un nom unique —
  // lui exiger « cursor » dans `--version` casserait une install parfaitement
  // valide dont la bannière ne répète pas la marque. Une sonde injectée
  // (tests) décide elle-même.
  const checkPour = (bin: string): Sonde => {
    const sig = bin === 'agent' ? signature : undefined;
    return sig && sonder === probeBin ? (argv) => probeBin(argv, 4_000, sig) : sonder;
  };
  for (const bin of bins) {
    const check = checkPour(bin);
    for (const candidate of candidates(bin, plateforme)) {
      if (await check([candidate])) return true;
    }
    // Le PATH n'a rien donné : l'agent peut vivre à un endroit connu qu'il
    // n'expose qu'au shell de connexion (voir `cheminsNatifs`). On ne sonde que
    // ce qui existe — lancer un chemin absent ne dirait rien de plus.
    for (const chemin of cheminsNatifs(bin, env, plateforme)) {
      if (existe(chemin) && (await check([chemin]))) return true;
    }
    // ─── LE SHIM `.cmd`, CONTOURNÉ PAR LE HAUT ─────────────────────────────
    //
    // Si aucun exécutable ne répond, l'agent peut quand même être là : installé
    // par npm, il n'expose sous Windows qu'un `claude.cmd` que `spawn` ne sait
    // pas lancer. On vise alors son script réel et on lance Node — voir
    // `shared/agent-windows.ts`.
    //
    // En DERNIER, jamais en premier : quand un vrai binaire existe, c'est lui
    // qui a raison. On n'ajoute un chemin que là où il n'y en avait aucun.
    // ─── ÉQUIVALENCE CONSIGNÉE : `> 1` muté en `>= 1` ne change rien ─────────
    //
    // Un balayage élargi (base épinglée sur le commit d'origine,
    // `LOUPE_CHEMINS=src/node-client`) l'a laissé survivre. Il est ÉQUIVALENT,
    // et la preuve tient en deux pas :
    //
    //   · `argvAgent` ne rend que deux formes — `['node', script]` (2) quand il
    //     a trouvé le script réel, ou `[bin]` (1) quand il n'a rien trouvé ;
    //   · `candidates(bin, …)` contient TOUJOURS `bin` — sur win32 comme
    //     ailleurs. Donc quand `argvAgent` rend `[bin]`, `sonder([bin])` vient
    //     d'être appelé dans la boucle ci-dessus et a rendu faux, sans quoi on
    //     aurait déjà quitté par `return true`.
    //
    // Le mutant ajoute donc une sonde de plus dont la réponse est déjà connue.
    // L'écrire en test éprouverait le NOMBRE d'appels à `sonder` — un détail
    // d'implémentation que personne n'exige : du décor déguisé en couverture.
    //
    // Ce que la longueur teste vraiment n'est pas une borne, c'est « argvAgent
    // a-t-il trouvé quelque chose ? ». Elle en est un proxy, et c'est ce proxy
    // qui rend le mutant indistinguable.
    const parNode = argvAgent(bin, env, plateforme, existe);
    if (parNode.length > 1 && (await check(parNode))) return true;
  }
  return false;
}

export interface DetectedAgent {
  agent: AgentType;
  label: string;
}

/**
 * Détecte le meilleur agent disponible, dans l'ordre : Claude Code, Cursor,
 * Codex, Grok — sinon l'adaptateur `shell` simulé (toujours disponible, sûr).
 *
 * Quand plusieurs agents sont installés et qu'un terminal est disponible, le
 * démarrage demande lequel retenir (`choisir-agent.ts`) : cette fonction reste
 * le repli hors TTY et le défaut proposé dans le menu.
 */
export async function detectBestAgent(
  env: NodeJS.ProcessEnv = process.env,
  // ─── LA COUTURE, ET POURQUOI ELLE MANQUAIT ─────────────────────────────────
  //
  // `env` ne sert QU'À lire `HIVE_AGENT_CMD`. La sonde, elle, fait
  // `spawn(bin, …)` sur le PATH RÉEL du processus, qu'aucun paramètre ne
  // détourne. Conséquence : le chemin de repli — celui qui décide que ce membre
  // N'A PAS d'agent, et donc que son nœud produira des diffs simulés — n'était
  // atteignable depuis aucun test. Sur une machine où `claude` est installé, et
  // c'est le cas de toutes celles où l'on développe, la détection le trouvait
  // toujours.
  //
  // Un test l'avait constaté en échouant : `{ PATH: '' }` ne change rien. On
  // s'était rabattu sur une garde qui LIT LA SOURCE — un pis-aller assumé, et
  // écrit comme tel.
  //
  // `relever()` porte exactement cette couture, ajoutée pour exactement cette
  // raison. La voici ici. La décision « aucun agent » se vérifie désormais pour
  // de vrai, au lieu d'être crue sur parole.
  sonder: Sonde = probeBin,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
): Promise<DetectedAgent> {
  // Choix explicite du membre : une commande libre (n'importe quelle IA CLI) via
  // HIVE_AGENT_CMD prime sur la détection automatique.
  if ((env.HIVE_AGENT_CMD ?? '').trim()) {
    return { agent: 'custom', label: labelPour('custom') };
  }
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins, sonder, plateforme, env, existe, probe.signature)) {
      return { agent: probe.agent, label: probe.label };
    }
  }
  return { agent: 'shell', label: labelPour('shell') };
}

/**
 * Variables d'environnement qu'un agent RÉEL doit retrouver dans la sandbox
 * pour fonctionner : ses répertoires de config (HOME/…) et ses identifiants
 * (clé API). Sans elles, la sandbox épurée empêcherait `claude`/`codex` de
 * s'authentifier. L'adaptateur `shell` simulé ne reçoit rien (isolation totale).
 * Les secrets restent locaux au nœud — jamais transmis au hub.
 */
export function agentCredentialEnv(agent: AgentType): string[] {
  if (agent === 'shell') return [];
  const configDirs = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'];
  if (agent === 'claude-code') {
    return [...configDirs, 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
  }
  if (agent === 'cursor') {
    // CURSOR_API_KEY pour les scripts ; ~/.cursor porte la session login.
    return [...configDirs, 'CURSOR_API_KEY'];
  }
  if (agent === 'codex') {
    return [...configDirs, 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];
  }
  if (agent === 'grok') {
    // `XAI_API_KEY` pour l'authentification sans navigateur ; `GROK_HOME` parce
    // que la session ouverte au navigateur est rangée là (défaut `~/.grok`), et
    // sans elle l'agent redemanderait une connexion qu'aucun nœud ne peut faire.
    return [...configDirs, 'XAI_API_KEY', 'GROK_HOME'];
  }
  return configDirs;
}

/** Réquisition à ouvrir quand l'agent réel n'a pas d'identifiants locaux. */
export type RequisitionCredential = {
  genre: 'cle_api';
  libelle: string;
  detail: string;
};

/**
 * Si l'agent détecté ne peut pas s'authentifier localement, propose une
 * réquisition (ADR 0010). Le secret ne transite jamais : l'humain configure
 * le poste ou accorde depuis la Chambre (Queen / Intendance).
 */
export function requisitionSiCredentialsManquantes(
  agent: AgentType,
  env: NodeJS.ProcessEnv = process.env,
  opts: {
    existe?: (chemin: string) => boolean;
    plateforme?: string;
  } = {},
): RequisitionCredential | null {
  const existe = opts.existe ?? existsSync;
  const plateforme = opts.plateforme ?? process.platform;
  if (agent === 'shell' || agent === 'custom') return null;

  const maison = (plateforme === 'win32' ? env.USERPROFILE : env.HOME)?.trim();
  const p = plateforme === 'win32' ? path.win32 : path.posix;

  if (agent === 'claude-code') {
    if ((env.ANTHROPIC_API_KEY ?? '').trim()) return null;
    if ((env.ANTHROPIC_AUTH_TOKEN ?? '').trim()) return null;
    if (maison && existe(p.join(maison, '.claude'))) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé ou session Anthropic (Claude Code)',
      detail:
        'ANTHROPIC_API_KEY absente et aucun dossier ~/.claude détecté sur ce poste. ' +
        'Connectez-vous avec `claude login` localement, ou accordez une clé depuis la Chambre.',
    };
  }

  if (agent === 'cursor') {
    if ((env.CURSOR_API_KEY ?? '').trim()) return null;
    if (maison && existe(p.join(maison, '.cursor'))) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé ou session Cursor',
      detail:
        'CURSOR_API_KEY absente et aucun dossier ~/.cursor détecté sur ce poste. ' +
        'Connectez-vous avec `agent login` localement, ou posez CURSOR_API_KEY.',
    };
  }

  if (agent === 'codex') {
    if ((env.OPENAI_API_KEY ?? '').trim()) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé OpenAI (Codex)',
      detail: 'OPENAI_API_KEY absente sur ce nœud — l’agent ne pourra pas s’authentifier.',
    };
  }

  if (agent === 'grok') {
    if ((env.XAI_API_KEY ?? '').trim()) return null;
    const grokHome = (env.GROK_HOME ?? (maison ? p.join(maison, '.grok') : '')).trim();
    if (grokHome && existe(grokHome)) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé xAI ou session Grok',
      detail: 'XAI_API_KEY absente et aucune session Grok locale (~/.grok) détectée sur ce poste.',
    };
  }

  return null;
}

/** Liste tous les agents détectés (pour information / diagnostic). */
export async function detectAllAgents(
  env: NodeJS.ProcessEnv = process.env,
  // Même couture que `detectBestAgent`, et pour la même raison : sans elle,
  // « aucun agent » n'est vérifiable sur aucune machine de développement.
  sonder: Sonde = probeBin,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
): Promise<AgentType[]> {
  const found: AgentType[] = [];
  if ((env.HIVE_AGENT_CMD ?? '').trim()) found.push('custom');
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins, sonder, plateforme, env, existe, probe.signature)) {
      found.push(probe.agent);
    }
  }
  found.push('shell');
  return found;
}

/**
 * Le binaire de l'agent est-il encore sur le PATH (ou chemins natifs) ?
 * Sert à la reprise mid-task après Accorder `binaire` : sans ça on relancerait
 * tout de suite un spawn ENOENT et on perdrait la pause.
 */
export async function agentBinairePresent(
  agent: AgentType,
  opts: {
    sonder?: Sonde;
    plateforme?: string;
    env?: NodeJS.ProcessEnv;
    existe?: (chemin: string) => boolean;
  } = {},
): Promise<boolean> {
  if (agent === 'shell' || agent === 'custom') return true;
  const probe = PROBES.find((p) => p.agent === agent);
  if (!probe) return false;
  return firstPresent(
    probe.bins,
    opts.sonder ?? probeBin,
    opts.plateforme ?? process.platform,
    opts.env ?? process.env,
    opts.existe ?? existsSync,
    probe.signature,
  );
}
