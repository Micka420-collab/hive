// Détection des agents IA de codage installés sur la machine du membre.
// Objectif : qu'un ami n'ait RIEN à configurer — on repère automatiquement son
// Claude Code ou son Codex et on choisit le bon adaptateur.
//
// Sécurité : sondage par spawn(bin, ['--version'], { shell:false }) — jamais
// d'interprétation shell. On constate la présence du binaire, puis ce que le
// CLI dit de sa session (`sessionDeLAgent`) : installé n'est pas connecté.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { argvAgent } from '../shared/agent-windows.js';

/**
 * Les agents dont la ruche connaît la FORME des identifiants.
 *
 * Source unique : le type en dérive, donc ajouter un agent ici suffit — la
 * liste et le type ne peuvent plus se contredire.
 *
 * Attention : ce n'est PAS la liste des agents exécutables. `getAdapter`
 * accepte une chaîne libre et connaît des noms absents d'ici (`hermes-agent`).
 * D'où `estAgentType` juste dessous : un nom d'agent qui vient de
 * `HIVE_AGENT` est une donnée d'entrée, pas une valeur de ce type.
 */
export const AGENT_TYPES = [
  'claude-code',
  'cursor',
  'cline',
  'codex',
  'grok',
  'custom',
  'shell',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

/** Cette chaîne est-elle un agent dont on sait décrire les identifiants ? */
export function estAgentType(v: unknown): v is AgentType {
  return typeof v === 'string' && (AGENT_TYPES as readonly string[]).includes(v);
}

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
  // Cline : CLI sans interface (`cline --json`), installé par `npm i -g cline`.
  { agent: 'cline', bins: ['cline'], label: 'Cline' },
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
  // Le jeton d'ABONNEMENT (`claude setup-token`) : c'est lui qu'un bac reçoit
  // à la place de la session `~/.claude`, qu'il ne monte pas. Il vaut
  // l'abonnement entier — la même garde que la clé, au moins.
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  // La clé que `codex exec` lit réellement (codex-rs/login, `CODEX_API_KEY`).
  'CODEX_API_KEY',
  // L'autre identifiant sans navigateur de Codex (jeton d'accès personnel ou
  // JWT d'identité d'agent, codex-rs/login `CODEX_ACCESS_TOKEN`). Aucun agent
  // ne le reçoit — il n'est dans aucune liste transmise —, mais un `codex`
  // homonyme sondé l'hériterait du nœud : il part, comme les autres.
  'CODEX_ACCESS_TOKEN',
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

/**
 * Résout le premier binaire présent parmi les candidats d'un agent, et rend la
 * commande qui a répondu — `null` si aucune. La commande sert ensuite à lui
 * demander s'il est connecté (`sessionDeLAgent`) : le MÊME binaire que celui
 * qu'on a trouvé, pas un homonyme cherché ailleurs.
 */
async function firstPresent(
  bins: string[],
  sonder: Sonde,
  plateforme: string,
  env: NodeJS.ProcessEnv,
  existe: (chemin: string) => boolean,
  signature?: string,
): Promise<readonly string[] | null> {
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
      if (await check([candidate])) return [candidate];
    }
    // Le PATH n'a rien donné : l'agent peut vivre à un endroit connu qu'il
    // n'expose qu'au shell de connexion (voir `cheminsNatifs`). On ne sonde que
    // ce qui existe — lancer un chemin absent ne dirait rien de plus.
    for (const chemin of cheminsNatifs(bin, env, plateforme)) {
      if (existe(chemin) && (await check([chemin]))) return [chemin];
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
    if (parNode.length > 1 && (await check(parNode))) return parNode;
  }
  return null;
}

// ─── INSTALLÉ N'EST PAS CONNECTÉ ─────────────────────────────────────────────
//
// La preuve V2 Alpha a lancé une ouvrière Cursor — annoncée, inscrite, comptée
// parmi les « ouvrières réelles » — sur une machine où `cursor-agent status`
// répondait « Not logged in ». Deux raccourcis s'additionnaient : la détection
// ne demandait que `--version`, et les identifiants comptaient le DOSSIER
// `~/.cursor`, que le CLI crée dès son installation. Chaque tâche confiée à
// cette ouvrière aurait échoué « non authentifié ».
//
// Chaque CLI qui en a une répond ici à SA commande de statut : locale, sans
// saisie, sans rien dépenser — mesurées le 27 septembre 2026 sur les CLI
// installés :
//
//     claude auth status              → JSON, `"loggedIn": true|false` (code 0|1)
//     cursor-agent status --format json → JSON, `"isAuthenticated": false` (code 0 !)
//     codex login status              → « Logged in using ChatGPT » (0) | « Not logged in » (1)
//
// Cursor rend 0 non connecté : le code ne dit rien, seule la réponse compte.
// Une réponse qu'on ne sait pas lire — sous-commande inconnue d'un CLI plus
// ancien, délai dépassé, binaire qui plante — vaut « inconnue », et l'agent
// garde la règle d'avant (le dossier de session) : on ne retire un agent que
// sur SA parole, jamais sur une supposition, sans quoi une mise à jour du CLI
// suffirait à vider une ruche qui marchait.

/** Ce que le CLI dit de sa propre session. */
export type EtatSession = 'connectee' | 'non_connectee' | 'inconnue';

/** Le délai d'une commande de statut : trop lente, elle ne dit rien (`inconnue`). */
export const STATUT_MAX_MS = 5_000;

interface Statut {
  /** Les arguments de la commande de statut, ajoutés à la commande trouvée. */
  readonly args: readonly string[];
  /** Ce que disent son code et sa sortie (stdout et stderr mêlés). */
  readonly lire: (code: number | null, sortie: string) => EtatSession;
  /** La commande, telle qu'on la cite à l'humain. */
  readonly commande: string;
  /** Le geste qui connecte, puis la clé qui en dispense. */
  readonly connecter: string;
  readonly cle: string;
  /**
   * La première version du CLI qui connaît la commande de statut. Avant elle,
   * le CLI la prend pour autre chose — voir `STATUTS['claude-code']` — et on
   * ne la lance pas : la session reste `inconnue`.
   */
  readonly versionMin?: readonly [number, number, number];
  /** Vrai quand la commande de statut ne dirait rien d'utile ici (voir Codex). */
  readonly sansObjet?: (env: NodeJS.ProcessEnv) => boolean;
}

/** `x.y.z` lu dans une sortie de `--version` est-il au moins `min` ? Illisible : non. */
export function versionAuMoins(sortie: string, min: readonly [number, number, number]): boolean {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(sortie);
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i]! !== min[i]) return v[i]! > min[i]!;
  }
  return true;
}

/**
 * Le fournisseur de modèle que Codex utilisera, s'il n'est pas celui d'OpenAI.
 *
 * ─── « NOT LOGGED IN », SUR UN CODEX QUI TOURNE TRÈS BIEN ───────────────────
 *
 * `codex login status` ne parle que des identifiants OPENAI. Un Codex branché
 * sur un autre fournisseur (`model_provider = "ollama"`, Azure, un fournisseur
 * déclaré) répond « Not logged in » et code 1 — et travaille pourtant, sans
 * session ni CODEX_API_KEY. Le prendre au mot retirait de la ruche un agent
 * qui marchait, et `HIVE_AGENT=codex` refusait de démarrer. Sa parole ne vaut
 * donc que sur le fournisseur par défaut ; ailleurs, elle est `inconnue`.
 *
 * On lit la configuration EFFECTIVE, comme Codex : `$CODEX_HOME/config.toml`
 * (défaut `~/.codex`), `model_provider` à la racine, ou celui du profil que
 * désigne `profile`. Une lecture de lignes suffit à ces deux clés ; un fichier
 * absent ou illisible, c'est le fournisseur par défaut.
 */
export function fournisseurCodexTiers(env: NodeJS.ProcessEnv): string | null {
  const maison = (env.HOME ?? env.USERPROFILE ?? '').trim();
  const dossier = (env.CODEX_HOME ?? '').trim() || (maison ? path.join(maison, '.codex') : '');
  if (!dossier) return null;
  let texte: string;
  try {
    texte = readFileSync(path.join(dossier, 'config.toml'), 'utf8');
  } catch {
    return null;
  }
  const valeur = (l: string, cle: string): string | undefined =>
    new RegExp(`^\\s*${cle}\\s*=\\s*["']([^"']+)["']`).exec(l)?.[1];
  let section = '';
  const racine: Record<string, string> = {};
  const profils: Record<string, string> = {};
  for (const ligne of texte.split(/\r?\n/)) {
    const entete = /^\s*\[([^\]]+)\]\s*$/.exec(ligne);
    if (entete) {
      section = entete[1]!.trim();
      continue;
    }
    const fournisseur = valeur(ligne, 'model_provider');
    if (section === '') {
      if (fournisseur) racine.model_provider = fournisseur;
      const profil = valeur(ligne, 'profile');
      if (profil) racine.profile = profil;
    } else if (fournisseur && section.startsWith('profiles.')) {
      profils[section.slice('profiles.'.length).replace(/^["']|["']$/g, '')] = fournisseur;
    }
  }
  const effectif = (racine.profile && profils[racine.profile]) ?? racine.model_provider;
  return effectif && effectif !== 'openai' ? effectif : null;
}

/** Un booléen du premier objet JSON de la sortie — `null` s'il n'y est pas. */
function champBooleen(sortie: string, champ: string): boolean | null {
  const debut = sortie.indexOf('{');
  const fin = sortie.lastIndexOf('}');
  if (debut < 0 || fin < debut) return null;
  try {
    const v = (JSON.parse(sortie.slice(debut, fin + 1)) as Record<string, unknown>)[champ];
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

const selon = (connecte: boolean | null): EtatSession =>
  connecte === null ? 'inconnue' : connecte ? 'connectee' : 'non_connectee';

const STATUTS: Partial<Record<AgentType, Statut>> = {
  'claude-code': {
    args: ['auth', 'status'],
    lire: (_code, sortie) => selon(champBooleen(sortie, 'loggedIn')),
    commande: 'claude auth status',
    // ─── AVANT 2.1.40, `auth status` EST UN PROMPT FACTURÉ ────────────────────
    //
    // Le sous-commande `auth` est apparue en 2.1.40 — mesuré le 27 septembre
    // 2026 sur les paquets npm, HOME vide : 2.1.38 et 2.1.39 répondent « Not
    // logged in · Please run /login », 2.1.40 rend le JSON. Avant, `claude auth
    // status` lance le mode `--print` avec « auth status » pour prompt : un
    // appel au modèle, payé par un membre connecté, à chaque sonde. On lit donc
    // d'abord `--version`, et en dessous on ne demande rien.
    versionMin: [2, 1, 40],
    connecter: '`claude login` (ou `claude setup-token` → CLAUDE_CODE_OAUTH_TOKEN)',
    cle: 'ANTHROPIC_API_KEY',
  },
  cursor: {
    args: ['status', '--format', 'json'],
    lire: (_code, sortie) => selon(champBooleen(sortie, 'isAuthenticated')),
    commande: 'cursor-agent status',
    connecter: '`cursor-agent login`',
    cle: 'CURSOR_API_KEY',
  },
  codex: {
    args: ['login', 'status'],
    lire: (code, sortie) =>
      /\bnot logged in\b/i.test(sortie)
        ? 'non_connectee'
        : code === 0 && /\blogged in\b/i.test(sortie)
          ? 'connectee'
          : 'inconnue',
    commande: 'codex login status',
    sansObjet: (env) => fournisseurCodexTiers(env) !== null,
    connecter: '`codex login`',
    cle: 'CODEX_API_KEY (`codex exec` ignore OPENAI_API_KEY)',
  },
};

/** Ce qu'on dit d'un agent installé que son CLI dit non connecté — `null` s'il n'a pas de statut. */
export function phraseNonConnecte(agent: AgentType): string | null {
  const s = STATUTS[agent];
  if (!s) return null;
  return (
    `${labelPour(agent)} est installé mais non connecté (\`${s.commande}\` le dit) : ` +
    `${s.connecter}, ou posez ${s.cle} dans le .env de ce nœud.`
  );
}

/**
 * Comment on lance une commande de statut : la commande trouvée, les arguments
 * du statut — rend le code et la sortie, ou `null` si elle n'a rien rendu
 * (introuvable, plantée, délai dépassé).
 */
export type LanceurStatut = (
  commande: readonly string[],
  argsStatut: readonly string[],
) => Promise<{ code: number | null; sortie: string } | null>;

/**
 * Le lanceur réel — exporté pour l'autre sonde sans prompt qu'un adaptateur
 * lance (`claude --help`, cf. `effortsDeLAide`). Même garde que la sonde de présence : aucun secret dans
 * l'environnement (`envSonde`) — la session vit dans le HOME, que l'on garde,
 * et une clé posée se juge sans rien lancer. La sortie de `claude auth status`
 * nomme le compte : elle est bornée, lue pour UN booléen, jamais écrite nulle part.
 */
export const lancerStatut: LanceurStatut = (commande, argsStatut) =>
  new Promise((resolve) => {
    let fini = false;
    const finir = (r: { code: number | null; sortie: string } | null): void => {
      if (fini) return;
      fini = true;
      resolve(r);
    };
    let enfant;
    let sortie = '';
    try {
      const [bin, ...avant] = commande;
      enfant = spawn(bin ?? '', [...avant, ...argsStatut], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: envSonde(process.env),
        // Son PROPRE groupe (POSIX) : `cursor-agent` est un script qui lance
        // Node, et tuer le seul script laissait le petit-enfant finir seul.
        detached: process.platform !== 'win32',
      });
    } catch {
      finir(null);
      return;
    }
    // 64 Kio : une commande de statut tient en quelques lignes, mais l'aide de
    // `claude` en fait 22 Ko (2.1.283) et grandit à chaque option.
    const lire = (bout: Buffer): void => {
      if (sortie.length < 65_536) sortie += bout.toString();
    };
    enfant.stdout?.on('data', lire);
    enfant.stderr?.on('data', lire);
    const minuteur = setTimeout(() => {
      tuerArbre(enfant.pid);
      finir(null);
    }, STATUT_MAX_MS);
    minuteur.unref?.();
    enfant.on('error', () => {
      clearTimeout(minuteur);
      finir(null);
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      finir({ code, sortie });
    });
  });

/**
 * Tue une commande de statut ET ses descendants : le groupe entier sous POSIX
 * (elle en est la cheffe, `detached`), l'arbre par `taskkill /T` sous Windows.
 */
function tuerArbre(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
        env: envSonde(process.env),
      });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // déjà parti
  }
}

/** Aucune commande lancée : la session reste inconnue. Le défaut d'une sonde injectée. */
const statutMuet: LanceurStatut = () => Promise.resolve(null);

/** Ce que le CLI trouvé dit de sa session. */
export async function sessionDeLAgent(
  agent: AgentType,
  commande: readonly string[],
  lancer: LanceurStatut = lancerStatut,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EtatSession> {
  const statut = STATUTS[agent];
  if (!statut || statut.sansObjet?.(env)) return 'inconnue';
  if (statut.versionMin) {
    const v = await lancer(commande, ['--version']);
    if (!v || v.code !== 0 || !versionAuMoins(v.sortie, statut.versionMin)) return 'inconnue';
  }
  const r = await lancer(commande, statut.args);
  return r === null ? 'inconnue' : statut.lire(r.code, r.sortie);
}

/** Un agent dont le binaire répond, et ce que son CLI dit de sa session. */
export interface AgentPresent {
  readonly agent: AgentType;
  readonly session: EtatSession;
}

/**
 * Cet agent est-il installé mais NON CONNECTÉ — son CLI le dit, et aucune clé
 * n'en dispense ? Rend alors ce qu'il faut faire, sinon `null`.
 */
export function nonConnecte(p: AgentPresent, env: NodeJS.ProcessEnv): string | null {
  if (p.session !== 'non_connectee') return null;
  return requisitionSiCredentialsManquantes(p.agent, env, { session: p.session })?.detail ?? null;
}

/** Les outils de détection, injectables ensemble (voir `detectBestAgent`). */
interface OutilsDetection {
  sonder: Sonde;
  plateforme: string;
  env: NodeJS.ProcessEnv;
  existe: (chemin: string) => boolean;
  statut: LanceurStatut | undefined;
}

/**
 * Tous les agents dont le binaire répond, avec leur session — dans l'ordre de
 * préférence. Une sonde INJECTÉE (bancs) ne lance aucune commande de statut
 * par défaut : même règle que la signature de `firstPresent`, le banc décide.
 */
async function constater(o: OutilsDetection, premierUtilisable = false): Promise<AgentPresent[]> {
  const lancer = o.statut ?? (o.sonder === probeBin ? lancerStatut : statutMuet);
  const presents: AgentPresent[] = [];
  for (const probe of PROBES) {
    const commande = await firstPresent(
      probe.bins,
      o.sonder,
      o.plateforme,
      o.env,
      o.existe,
      probe.signature,
    );
    if (!commande) continue;
    const p = {
      agent: probe.agent,
      session: await sessionDeLAgent(probe.agent, commande, lancer, o.env),
    };
    presents.push(p);
    if (premierUtilisable && !nonConnecte(p, o.env)) break;
  }
  return presents;
}

/** Les agents présents, avec leur session — pour le constat envoyé au hub (`connexion.ts`). */
export function constaterAgents(
  env: NodeJS.ProcessEnv = process.env,
  sonder: Sonde = probeBin,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
  statut?: LanceurStatut,
): Promise<AgentPresent[]> {
  return constater({ env, sonder, plateforme, existe, statut });
}

/** Ce que la détection rend : les agents qu'on peut employer, et ceux qu'on écarte en le disant. */
export interface InventaireAgents {
  /** Utilisables, dans l'ordre de préférence : `custom` en tête s'il est demandé, `shell` en dernier. */
  readonly tous: AgentType[];
  /** Installés, mais leur CLI se dit non connecté et aucune clé n'en dispense : ni choisis, ni annoncés. */
  readonly nonConnectes: { readonly agent: AgentType; readonly detail: string }[];
  /** Tous les binaires présents, avec leur session — le constat envoyé au hub (`connexion.ts`). */
  readonly presents: AgentPresent[];
}

/**
 * L'inventaire des agents : UNE passe de sondes, dont on tire à la fois ce qui
 * travaille et ce qu'on écarte — le nœud, la ruche et le docteur disent ainsi
 * pourquoi un agent installé n'a pas d'ouvrière.
 */
export async function inventaireAgents(
  env: NodeJS.ProcessEnv = process.env,
  sonder: Sonde = probeBin,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
  statut?: LanceurStatut,
): Promise<InventaireAgents> {
  const tous: AgentType[] = [];
  const nonConnectes: { agent: AgentType; detail: string }[] = [];
  if ((env.HIVE_AGENT_CMD ?? '').trim()) tous.push('custom');
  const presents = await constater({ env, sonder, plateforme, existe, statut });
  for (const p of presents) {
    const detail = nonConnecte(p, env);
    if (detail) nonConnectes.push({ agent: p.agent, detail });
    else tous.push(p.agent);
  }
  tous.push('shell');
  return { tous, nonConnectes, presents };
}

/**
 * Un nœud à qui l'on IMPOSE un agent non connecté (`HIVE_AGENT`) ne démarre
 * pas — rend pourquoi, sinon `null`. Il s'inscrirait comme une ouvrière de cet
 * agent, la Reine lui confierait du travail, et chaque tâche échouerait « non
 * authentifié » : mieux vaut un refus qui nomme le remède (`main.ts`, `join.ts`).
 */
export function refusNonConnecte(agent: AgentType, inventaire: InventaireAgents): string | null {
  const n = inventaire.nonConnectes.find((x) => x.agent === agent);
  return n ? `${n.detail} (HIVE_AGENT=${agent} l’impose à ce nœud.)` : null;
}

/** Les lignes qui disent, au démarrage d'un nœud, quels agents installés sont écartés. */
export function lignesNonConnectes(inventaire: InventaireAgents): string[] {
  return inventaire.nonConnectes.map((n) => `   Non connecté    : ${n.detail}`);
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
  statut?: LanceurStatut,
): Promise<DetectedAgent> {
  // Choix explicite du membre : une commande libre (n'importe quelle IA CLI) via
  // HIVE_AGENT_CMD prime sur la détection automatique.
  if ((env.HIVE_AGENT_CMD ?? '').trim()) {
    return { agent: 'custom', label: labelPour('custom') };
  }
  // S'arrête au premier UTILISABLE : un Cursor non connecté cède la place au
  // Codex connecté qui le suit, sans qu'on sonde ceux d'après.
  const presents = await constater({ env, sonder, plateforme, existe, statut }, true);
  const retenu = presents.find((p) => !nonConnecte(p, env));
  const agent = retenu?.agent ?? 'shell';
  return { agent, label: labelPour(agent) };
}

/**
 * Variables d'environnement qu'un agent RÉEL doit retrouver dans la sandbox
 * pour fonctionner : ses répertoires de config (HOME/…) et ses identifiants
 * (clé API). Sans elles, la sandbox épurée empêcherait `claude`/`codex` de
 * s'authentifier. L'adaptateur `shell` simulé ne reçoit rien (isolation totale).
 * Les secrets restent locaux au nœud — jamais transmis au hub.
 *
 * Ce sont des NOMS : la sandbox de processus copie leurs valeurs, un bac les
 * fait hériter sans jamais les écrire en argument. Les dossiers de
 * configuration ne servent que HORS bac — dedans, le HOME est éphémère (voir
 * `VARIABLES_CHEMIN_HOTE`), et seuls les jetons nommés authentifient l'agent.
 */
export function agentCredentialEnv(agent: AgentType): string[] {
  if (agent === 'shell') return [];
  const configDirs = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'];
  if (agent === 'claude-code') {
    // CLAUDE_CODE_OAUTH_TOKEN : l'abonnement sans navigateur (`claude setup-token`).
    return [
      ...configDirs,
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ];
  }
  if (agent === 'cursor') {
    // CURSOR_API_KEY pour les scripts ; ~/.cursor porte la session login.
    return [...configDirs, 'CURSOR_API_KEY'];
  }
  if (agent === 'codex') {
    // CODEX_API_KEY : la clé que `codex exec` lit sans session `codex login`.
    // OPENAI_API_KEY reste transmise (un fournisseur déclaré dans la config de
    // Codex peut la nommer), mais elle n'AUTHENTIFIE pas `codex exec` : voir
    // `requisitionSiCredentialsManquantes`.
    return [...configDirs, 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY'];
  }
  if (agent === 'grok') {
    // `XAI_API_KEY` pour l'authentification sans navigateur ; `GROK_HOME` parce
    // que la session ouverte au navigateur est rangée là (défaut `~/.grok`), et
    // sans elle l'agent redemanderait une connexion qu'aucun nœud ne peut faire.
    return [...configDirs, 'XAI_API_KEY', 'GROK_HOME'];
  }
  return configDirs;
}

/**
 * Les agents dont `requisitionSiCredentialsManquantes` sait VRAIMENT juger les
 * identifiants — c'est-à-dire ceux qui ont une branche à eux ci-dessous.
 *
 * ─── POURQUOI CETTE LISTE EXISTE ────────────────────────────────────────────
 *
 * La fonction rend `null` pour tout agent qu'elle ne connaît pas, et `null`
 * signifie « rien ne manque ». Pour un appelant, c'est indiscernable de « la
 * clé est là » — alors que la vérité est « je ne sais pas regarder ».
 *
 * Cline, par exemple, lit sa PROPRE configuration de fournisseur : Hive ne sait
 * pas où chercher, et prétendre le contraire ferait proposer une installation
 * automatique sur la foi d'une clé jamais vue.
 *
 * `tests/connexion-noeud.test.ts` garde l'accord entre cette liste et les
 * branches réelles de la fonction : en ajouter une sans l'inscrire ici, ou
 * l'inverse, fait rougir la suite.
 */
export const AGENTS_A_IDENTIFIANTS_CONNUS: readonly AgentType[] = Object.freeze([
  'claude-code',
  'cursor',
  'codex',
  'grok',
]);

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
 *
 * ─── UNE SESSION DE L'HÔTE N'EST PAS UN IDENTIFIANT DANS LE BAC ─────────────
 *
 * `~/.claude`, `~/.codex`, `~/.cursor` et `~/.grok` sont des dossiers de l'HÔTE. Un bac
 * (conteneur ou bubblewrap) donne à l'agent un HOME éphémère et ne monte jamais
 * celui du membre : la session ouverte par `claude login` n'y entre pas. Avec
 * `sessionsHote: false` — l'agent tourne dans un bac —, seules comptent les clés
 * passées par leur NOM, et le détail dit laquelle poser.
 */
export function requisitionSiCredentialsManquantes(
  agent: AgentType,
  env: NodeJS.ProcessEnv = process.env,
  opts: {
    existe?: (chemin: string) => boolean;
    plateforme?: string;
    /** Les dossiers de session de l'hôte sont-ils visibles de l'agent ? Faux dans un bac. */
    sessionsHote?: boolean;
    /**
     * Ce que le CLI a dit de sa session (`sessionDeLAgent`). Connue, elle
     * l'emporte sur le dossier : `~/.cursor` existe dès l'installation, connecté
     * ou non. Inconnue (défaut), le dossier décide, comme avant.
     */
    session?: EtatSession;
  } = {},
): RequisitionCredential | null {
  const existe = opts.existe ?? existsSync;
  const plateforme = opts.plateforme ?? process.platform;
  const sessionsHote = opts.sessionsHote ?? true;
  const constatee = opts.session ?? 'inconnue';
  if (agent === 'shell' || agent === 'custom') return null;

  const maison = (plateforme === 'win32' ? env.USERPROFILE : env.HOME)?.trim();
  const p = plateforme === 'win32' ? path.win32 : path.posix;
  const cle = (nom: string): boolean => Boolean((env[nom] ?? '').trim());
  const session = (dossier: string): boolean =>
    sessionsHote && (constatee === 'inconnue' ? existe(dossier) : constatee === 'connectee');
  const horsDuBac = (dossier: string, aPoser: string): string =>
    `Dans le bac à sable, la session ${dossier} de l’hôte est invisible : posez ${aPoser} ` +
    'dans le .env de ce nœud.';
  // Le CLI s'est dit non connecté : c'est ce qu'on répète, avec son remède.
  const ditNonConnecte =
    sessionsHote && constatee === 'non_connectee' ? phraseNonConnecte(agent) : null;

  if (agent === 'claude-code') {
    if (cle('ANTHROPIC_API_KEY') || cle('ANTHROPIC_AUTH_TOKEN')) return null;
    if (cle('CLAUDE_CODE_OAUTH_TOKEN')) return null;
    if (maison && session(p.join(maison, '.claude'))) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé ou session Anthropic (Claude Code)',
      detail:
        ditNonConnecte ??
        (sessionsHote
          ? 'ANTHROPIC_API_KEY absente et aucun dossier ~/.claude détecté sur ce poste. ' +
            'Connectez-vous avec `claude login` localement, posez CLAUDE_CODE_OAUTH_TOKEN ' +
            '(`claude setup-token`), ou accordez une clé depuis la Chambre.'
          : horsDuBac(
              '~/.claude',
              'CLAUDE_CODE_OAUTH_TOKEN (jeton d’abonnement : `claude setup-token`) ou ANTHROPIC_API_KEY',
            )),
    };
  }

  if (agent === 'cursor') {
    if (cle('CURSOR_API_KEY')) return null;
    if (maison && session(p.join(maison, '.cursor'))) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé ou session Cursor',
      detail:
        ditNonConnecte ??
        (sessionsHote
          ? 'CURSOR_API_KEY absente et aucun dossier ~/.cursor détecté sur ce poste. ' +
            'Connectez-vous avec `agent login` localement, ou posez CURSOR_API_KEY.'
          : horsDuBac('~/.cursor', 'CURSOR_API_KEY')),
    };
  }

  // ─── CODEX : CODEX_API_KEY OU LA SESSION `codex login`, ET RIEN D'AUTRE ────
  //
  // `codex exec` s'authentifie par CODEX_API_KEY, sinon par le `auth.json` que
  // `codex login` écrit dans ~/.codex (codex-rs/login, `load_auth`). Il ne lit
  // JAMAIS OPENAI_API_KEY : le fournisseur OpenAI intégré n'a pas de variable
  // de clé (`env_key: None`). La compter faisait dire « clé présente » à un
  // poste dont chaque tâche Codex échouait en 401 — dans le bac comme dehors.
  //
  // `CODEX_HOME` n'est pas regardé : il n'est pas dans les variables transmises
  // à l'agent, qui cherche donc sa session sous le HOME, là où on la cherche.
  if (agent === 'codex') {
    if (cle('CODEX_API_KEY')) return null;
    if (maison && session(p.join(maison, '.codex', 'auth.json'))) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé OpenAI (Codex)',
      detail:
        ditNonConnecte ??
        (sessionsHote
          ? 'CODEX_API_KEY absente et aucune session `codex login` (~/.codex/auth.json) sur ' +
            'ce poste. Connectez-vous avec `codex login` localement, ou posez CODEX_API_KEY — ' +
            '`codex exec` ignore OPENAI_API_KEY.'
          : horsDuBac('~/.codex', 'CODEX_API_KEY (`codex exec` ignore OPENAI_API_KEY)')),
    };
  }

  if (agent === 'grok') {
    if (cle('XAI_API_KEY')) return null;
    const grokHome = (env.GROK_HOME ?? (maison ? p.join(maison, '.grok') : '')).trim();
    if (grokHome && session(grokHome)) return null;
    return {
      genre: 'cle_api',
      libelle: 'Clé xAI ou session Grok',
      detail: sessionsHote
        ? 'XAI_API_KEY absente et aucune session Grok locale (~/.grok) détectée sur ce poste.'
        : horsDuBac('~/.grok', 'XAI_API_KEY'),
    };
  }

  return null;
}

/** Liste tous les agents UTILISABLES — un agent non connecté n'y est pas (`inventaireAgents`). */
export async function detectAllAgents(
  env: NodeJS.ProcessEnv = process.env,
  // Même couture que `detectBestAgent`, et pour la même raison : sans elle,
  // « aucun agent » n'est vérifiable sur aucune machine de développement.
  sonder: Sonde = probeBin,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
  statut?: LanceurStatut,
): Promise<AgentType[]> {
  return (await inventaireAgents(env, sonder, plateforme, existe, statut)).tous;
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
  const commande = await firstPresent(
    probe.bins,
    opts.sonder ?? probeBin,
    opts.plateforme ?? process.platform,
    opts.env ?? process.env,
    opts.existe ?? existsSync,
    probe.signature,
  );
  return commande !== null;
}
