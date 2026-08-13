// Détection des agents IA de codage installés sur la machine du membre.
// Objectif : qu'un ami n'ait RIEN à configurer — on repère automatiquement son
// Claude Code ou son Codex et on choisit le bon adaptateur.
//
// Sécurité : sondage par spawn(bin, ['--version'], { shell:false }) — jamais
// d'interprétation shell. On ne fait que constater la présence du binaire.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argvAgent } from '../shared/agent-windows.js';

export type AgentType = 'claude-code' | 'codex' | 'grok' | 'custom' | 'shell';

interface AgentProbe {
  agent: Exclude<AgentType, 'shell'>;
  /** Binaires candidats (Windows ajoute .cmd/.exe automatiquement via la sonde). */
  bins: string[];
  label: string;
}

const PROBES: AgentProbe[] = [
  { agent: 'claude-code', bins: ['claude'], label: 'Claude Code' },
  { agent: 'codex', bins: ['codex'], label: 'Codex' },
  // `grok-build` : binaire Rust natif, donc aucun shim `.cmd` à contourner.
  { agent: 'grok', bins: ['grok'], label: 'Grok Build' },
];

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
        '     Installez Claude Code (`npm i -g @anthropic-ai/claude-code`), puis relancez.';
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
 * Un environnement cassé retombe ainsi sur le shell simulé (sûr) plutôt que
 * d'envoyer du travail — et le token — à un binaire douteux.
 */
function probeBin(argv: readonly string[], timeoutMs = 4_000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (found: boolean): void => {
      if (done) return;
      done = true;
      resolve(found);
    };
    let child;
    try {
      const [bin, ...avant] = argv;
      child = spawn(bin ?? '', [...avant, '--version'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        // Un binaire qu'on n'a pas encore identifié n'hérite d'aucun secret.
        env: envSonde(process.env),
      });
    } catch {
      finish(false);
      return;
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
      finish(code === 0); // signal positif : le binaire a répondu correctement
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
): Promise<boolean> {
  for (const bin of bins) {
    for (const candidate of candidates(bin, plateforme)) {
      if (await sonder([candidate])) return true;
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
    if (parNode.length > 1 && (await sonder(parNode))) return true;
  }
  return false;
}

export interface DetectedAgent {
  agent: AgentType;
  label: string;
}

/**
 * Détecte le meilleur agent disponible, dans l'ordre : Claude Code, puis Codex,
 * sinon l'adaptateur `shell` simulé (toujours disponible, sûr).
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
    return { agent: 'custom', label: 'commande personnalisée (HIVE_AGENT_CMD)' };
  }
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins, sonder, plateforme, env, existe)) {
      return { agent: probe.agent, label: probe.label };
    }
  }
  return { agent: 'shell', label: 'shell (simulé)' };
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
    if (await firstPresent(probe.bins, sonder, plateforme, env, existe)) found.push(probe.agent);
  }
  found.push('shell');
  return found;
}
