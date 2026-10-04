// Adaptateur Claude Code en mode headless (`claude -p`). Le flux stream-json est
// lu au fil de l'eau : les sous-agents (outil Task) engendrés par l'agent sont
// remontés EN DIRECT au hub (« reines & abeilles » — visibles sur le Swarm View).
// Les clés API de l'agent restent locales au nœud : rien n'est transmis au hub
// (contrainte §5.1). Le diff est calculé par le workspace git du nœud, pas par stdout.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { EFFORTS, type Effort } from '../shared/effort.js';
import { lancerStatut, type LanceurStatut } from '../node-client/agent-detect.js';
import { assertRealExecutionAllowed, runCommandStreaming } from './exec.js';
import {
  CONSIGNES_CLAUDE,
  configurationDuDepot,
  consignesDuDepot,
  noteLiensNonSuivis,
} from './consignes-depot.js';
import {
  createDelegationBridge,
  HIVE_APPROVE_TOOL,
  HIVE_DELEGATE_TOOL,
  HIVE_WAIT_TOOL,
  resultatSansPont,
  writeClaudeConsignes,
  writeClaudeMcpConfig,
  type DelegationBridge,
} from './delegation-bridge.js';
import { createDeclarationFournisseurTracker } from './fournisseur-parser.js';
import { createPresenceTracker } from './presence-parser.js';
import { createSubAgentTracker } from './subagent-parser.js';
import { texteFinalStreamJson } from './texte-final.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CLAUDE_TIMEOUT_MS = 15 * 60_000;

/**
 * Les réglages que Hive impose à CHAQUE exécution (`--settings`, en JSON sur la
 * ligne de commande : ni fichier à monter dans le bac, ni secret).
 *
 * `disableAllHooks` : « the repository's project settings take precedence over
 * yours and can set it back to `false` » (code.claude.com/docs/en/permissions) —
 * seuls `--settings` et les réglages gérés passent au-dessus du projet.
 *
 * `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` n'y est PAS, et c'est mesuré : sous Linux
 * (Claude Code 2.1.283), il impose le bac à sable de Claude à l'outil Bash. Sur
 * un poste sans `socat`, CHAQUE commande échouait (« Sandbox is required but
 * failed to initialize ») ; et ce bac posait une vingtaine de fichiers vides
 * dans le répertoire de la tâche (`package.json`, `.env*`, `node_modules/`,
 * `.gitmodules`, `.git/commondir`…) — autant de lignes dans le diff livré.
 */
export const REGLAGES_IMPOSES = JSON.stringify({ disableAllHooks: true });

/**
 * Les réglages imposés, ENRICHIS du `permissions.allow` compilé (G12) quand le
 * dépôt déclare des validations : hors du read-only set, chaque commande shell
 * exige une entrée `--allowedTools` ou une règle `permissions.allow`
 * (code.claude.com/docs/en/headless) — sans elle, le Worker rendait son diff
 * SANS avoir lancé le `npm test` déclaré. La liste vient du commit de BASE du
 * clone (`reglesAutorisationDeBase`), jamais de l'arbre que l'agent réécrit.
 * `disableAllHooks` survit à la fusion : c'est le même objet, pas un override.
 */
export function reglagesImposes(permissionsAllow: readonly string[] = []): string {
  if (permissionsAllow.length === 0) return REGLAGES_IMPOSES;
  return JSON.stringify({
    disableAllHooks: true,
    permissions: { allow: [...permissionsAllow] },
  });
}

/**
 * Les arguments de `claude -p`, avec le modèle de l'Aiguillage en option s'il y
 * en a un.
 *
 * `--permission-mode acceptEdits` : SANS lui, `claude -p` sans terminal refuse
 * silencieusement chaque `Edit`/`Write` (« you haven't granted it yet »,
 * `is_error: true`) — l'agent tourne, propose de vraies corrections, le process
 * sort en code 0, et le nœud calcule un diff VIDE. `success: true` masquait la
 * panne : mesuré en double sur ce dépôt (deux tâches, 0 octet de diff malgré 8
 * `Edit` tentés sur la seconde). `acceptEdits` — pas `bypassPermissions` — reste
 * scopé aux fichiers : la tâche s'exécute déjà dans un clone jetable, un
 * répertoire dédié, un environnement épuré (`buildSandboxEnv` : les seules
 * variables de l'agent — dont, HORS du bac, le HOME du membre, où vit sa
 * session), donc autoriser l'écriture n'ouvre rien de plus large.
 *
 * ─── RIEN DE CE QUE LE DÉPÔT APPORTE NE S'EXÉCUTE ────────────────────────────
 *
 * Sans terminal, `claude -p` ne demande jamais la confiance du dossier : il
 * lançait les hooks de `.claude/settings.json`, les serveurs de `.mcp.json` et
 * appliquait le bloc `env` du projet (code.claude.com/docs/en/headless). Mesuré
 * sur 2.1.283, dans un dépôt piégé, avec une fausse clé : le hook SessionStart
 * lisait la clé dans `/proc/<pid de claude>/environ`, le serveur MCP la
 * recevait dans son environnement, et un `ANTHROPIC_BASE_URL` du projet
 * envoyait chaque requête — clé comprise — à l'adresse choisie par le dépôt.
 * Même règle que `git-protege.ts` pour git : la tâche vient d'un AUTRE membre.
 *
 *   · `--setting-sources user` est LA parade : ni `.claude/settings*.json`, ni
 *     `.mcp.json`, ni `CLAUDE.md`, `.claude/rules`, skills ou agents du projet.
 *     Seule, elle éteint tous les témoins ;
 *   · `--settings REGLAGES_IMPOSES` et `--strict-mcp-config` (toujours, pont
 *     ou non : sans `--mcp-config`, aucun serveur) doublent la garde si une
 *     version du CLI élargissait un jour ce qu'une source « user » recouvre.
 *     Aucun ne suffit seul : les hooks coupés, le `.mcp.json` démarrait encore ;
 *     le MCP strict, le hook tournait encore ;
 *   · `--bare` n'est PAS une option : il ne lit pas `CLAUDE_CODE_OAUTH_TOKEN`
 *     (code.claude.com/docs/en/authentication), le jeton de l'abonnement dans
 *     le bac — et il laisse passer le bloc `env` du projet.
 *
 * CHOIX ASSUMÉ, hors du bac (sandbox de processus, HOME du membre) : ses
 * PROPRES hooks et serveurs MCP (`~/.claude`) sont coupés eux aussi. Ses
 * réglages restent lus. Une tâche de la ruche n'est pas une session du membre :
 * rien de ce qu'il a branché pour lui ne doit agir sur le dépôt d'un autre.
 *
 * `consignesPath` : les consignes du dépôt relues comme DONNÉES
 * (`consignes-depot.ts`), que `--setting-sources user` retire au CLI.
 *
 * `--effort <niveau>` suit la même règle que `--model` : un des niveaux que
 * `claude --help` documente (« low, medium, high, xhigh, max », relevé sur
 * 2.1.283 — `EFFORTS`), absent quand l'Aiguillage n'en a commandé aucun.
 *
 * `--model <nom>` va AVANT le `--` : c'est une OPTION, et tout ce qui suit `--`
 * est du texte de prompt (cf. l'injection démontrée dans `prompt-argv.ts`). Le
 * prompt reste donc en TOUT DERNIER, derrière `--`. Un nom de modèle n'est pas un
 * secret ; il part en clair, comme `--verbose`. `spawn` reçoit ce tableau tel
 * quel (`shell: false`), donc aucun de ces mots ne passe par un shell.
 */
export function argvClaude(
  prompt: string,
  modele?: string,
  mcpConfigPath?: string,
  mcpServerName = 'hive',
  consignesPath?: string,
  effort?: Effort,
  permissionsAllow?: readonly string[],
  approbation = false,
): string[] {
  const drapeauxModele = [
    ...(modele ? ['--model', modele] : []),
    ...(effort ? ['--effort', effort] : []),
  ];
  const drapeauxPermission = ['--permission-mode', 'acceptEdits'];
  const drapeauxDepot = [
    '--setting-sources',
    'user',
    '--settings',
    reglagesImposes(permissionsAllow),
    '--strict-mcp-config',
  ];
  const drapeauxConsignes = consignesPath ? ['--append-system-prompt-file', consignesPath] : [];
  // `--permission-prompt-tool` SEULEMENT quand le pont porte la capacité de
  // décision (`approbation`) : le drapeau pointe un outil MCP, et le poser
  // sans serveur derrière transformerait chaque demande en impasse.
  //
  // L'outil de décision n'entre PAS dans `--allowedTools` : le drapeau suffit
  // au CLI (code.claude.com/docs/en/headless), et l'y lister l'exposerait au
  // MODÈLE — qui pourrait alors « s'approuver » lui-même en appelant l'outil
  // directement, hors de toute action réellement proposée. Codex est l'inverse
  // assumé : là-bas c'est le modèle qui demande (enabled_tools, codex.ts).
  const outilsHive = [
    `mcp__${mcpServerName}__${HIVE_DELEGATE_TOOL}`,
    `mcp__${mcpServerName}__${HIVE_WAIT_TOOL}`,
  ];
  const drapeauxMcp = mcpConfigPath
    ? [
        '--mcp-config',
        mcpConfigPath,
        '--allowedTools',
        outilsHive.join(','),
        ...(approbation
          ? ['--permission-prompt-tool', `mcp__${mcpServerName}__${HIVE_APPROVE_TOOL}`]
          : []),
      ]
    : [];
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    ...drapeauxPermission,
    ...drapeauxDepot,
    ...drapeauxModele,
    ...drapeauxConsignes,
    ...drapeauxMcp,
    '--',
    prompt,
  ];
}

/**
 * La ligne du journal qui DIT ce que le dépôt apportait et que Hive a écarté —
 * ou `undefined` s'il n'apportait rien. Sans elle, l'auteur d'un dépôt dont
 * les hooks ne tournent plus ne saurait pas pourquoi.
 */
export function noteConfigurationIgnoree(
  presents: readonly string[],
  consignesReprises: boolean,
): string | undefined {
  if (presents.length === 0) return undefined;
  const liste = presents.map((nom) => (nom === '.claude' ? '.claude/' : nom)).join(', ');
  const consignes = consignesReprises
    ? ' ; CLAUDE.md et .claude/rules relus comme simples données'
    : '';
  return `configuration d'agent du dépôt ignorée (hooks, MCP, env) : ${liste}${consignes}`;
}

/**
 * Les efforts que l'aide du `claude` INSTALLÉ documente, dans l'ordre de
 * `EFFORTS` : le bloc de l'option `--effort`, jusqu'à l'option suivante, et
 * la liste entre parenthèses qu'il porte (« (low, medium, high, xhigh, max) »
 * sur 2.1.283). Pas d'option, pas de liste : aucun effort.
 *
 * Lu sur le binaire et non figé dans le code : un Claude Code d'avant
 * `--effort` refuserait l'option à chaque tâche (échec d'infrastructure, sans
 * verdict), et un niveau qu'il ne connaît pas est ignoré avec un simple
 * avertissement — le verdict serait rangé sous un effort qui n'a pas tourné.
 */
export function effortsDeLAide(aide: string): Effort[] {
  const debut = aide.indexOf('--effort');
  if (debut < 0) return [];
  const bloc = aide.slice(debut);
  const fin = bloc.search(/\n\s*-/);
  const liste = /\(([^)]*)\)/.exec(fin < 0 ? bloc : bloc.slice(0, fin))?.[1] ?? '';
  const cites = new Set(liste.split(',').map((m) => m.trim()));
  return EFFORTS.filter((e) => cites.has(e));
}

/**
 * Sonde les efforts du `claude` installé : `claude --help`, qui n'appelle aucun
 * modèle. Muette, en échec ou trop lente : AUCUN effort — le nœud n'en déclare
 * pas, et le CLI garde son défaut. `lancer` : injectable pour les bancs.
 */
export async function sonderEffortsClaude(lancer: LanceurStatut = lancerStatut): Promise<Effort[]> {
  const r = await lancer(['claude'], ['--help']);
  return r?.code === 0 ? effortsDeLAide(r.sortie) : [];
}

export function createClaudeCodeAdapter(
  token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN,
): AgentAdapter {
  // Un agent réel modifie de vrais fichiers : mêmes exigences que le shell réel.
  assertRealExecutionAllowed("L'adaptateur claude-code", token);
  return {
    name: 'claude-code',
    effortsDocumentes: () => sonderEffortsClaude(),
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      const tracker = createSubAgentTracker();
      // Annulée avant le départ : rien ne se prépare (pont, config MCP) et
      // rien ne se lance — le suivi, vide, dit qu'aucun sous-agent n'a couru.
      if (ctx.signal?.aborted) {
        return {
          success: false,
          diff: '',
          logs: '[claude-code] tâche annulée avant le départ',
          subAgents: tracker.list(),
        };
      }
      ctx.onProgress({ log: 'claude -p (stream-json) démarré' });
      const presence = createPresenceTracker();
      // La ligne `result` finale porte le coût et le temps modèle déclarés.
      const declaration = createDeclarationFournisseurTracker('claude-code');
      let bridge: DelegationBridge | undefined;
      try {
        // Sans les trois capacités, aucun faux outil n'est injecté dans le CLI.
        // En exécution via HiveNodeClient elles sont toujours fournies ensemble ;
        // un contexte partiel n'entre pas dans le pont pour y échouer en panne
        // d'« infrastructure » (`capacités de délégation absentes`).
        if (ctx.delegate && ctx.waitForDelegationResult && ctx.rendezVous) {
          // L'échéance du run — l'instant où `runCommandStreaming` tuera le
          // processus (posée ici, à quelques instants du spawn près) : le
          // nœud borne l'attente d'une décision d'action à ce qui reste à
          // vivre au CLI, et la Chambre raccourcit son TTL d'autant.
          const echeanceRun = Date.now() + CLAUDE_TIMEOUT_MS;
          const decideAction = ctx.decideAction;
          bridge = await createDelegationBridge(
            decideAction
              ? { ...ctx, decideAction: (action) => decideAction(action, echeanceRun) }
              : ctx,
            task.id,
          );
          writeClaudeMcpConfig(bridge);
        }
        // Les consignes du dépôt voyagent dans le dossier du pont, que le bac
        // monte en lecture seule : jamais dans le répertoire de la tâche, où
        // elles entreraient dans le diff. Le nœud fournit toujours un pont ;
        // sans lui (adaptateur appelé seul), elles restent écartées comme le
        // reste, et la note ne les annonce pas reprises.
        const consignes = consignesDuDepot(ctx.cwd, CONSIGNES_CLAUDE);
        const consignesPath =
          bridge && consignes ? writeClaudeConsignes(bridge, consignes) : undefined;
        const note = noteConfigurationIgnoree(
          configurationDuDepot(ctx.cwd),
          consignesPath !== undefined,
        );
        if (note) ctx.onProgress({ log: note });
        const liens = noteLiensNonSuivis(ctx.cwd, CONSIGNES_CLAUDE);
        if (liens) ctx.onProgress({ log: liens });
        // --verbose est requis par Claude Code pour stream-json en mode -p.
        //
        // LE PROMPT EST EN DERNIER, DERRIÈRE `--`, ET CE N'EST PAS COSMÉTIQUE :
        // il était auparavant collé après `-p`, où un prompt commençant par un
        // tiret était lu comme une OPTION. Vérifié sur le binaire réel —
        // `claude -p '--version' …` imprimait la version sans jamais voir de
        // prompt. Le hub pouvait ainsi choisir les options de l'agent sur la
        // machine du membre, donc désarmer les garde-fous que celui-ci y a posés.
        // Tout ce qui suit `--` est du texte. Cf. src/adapters/prompt-argv.ts.
        const result = await runCommandStreaming(
          'claude',
          argvClaude(
            task.prompt,
            ctx.modele,
            bridge?.childConfigPath,
            bridge?.mcpServerName,
            consignesPath,
            ctx.effort,
            ctx.permissionsAllow,
            // La décision ne se promet au CLI que si le pont existe ET que le
            // nœud a fourni la capacité : les deux moitiés d'un même canal.
            bridge !== undefined && ctx.decideAction !== undefined,
          ),
          ctx,
          (line) => {
            const subAgents = tracker.feed(line);
            const presences = presence.feed(line);
            declaration.feed(line);
            // Remonter dès qu'un sous-agent apparaît/évolue → butineuses en direct.
            if (subAgents) ctx.onProgress({ subAgents });
            // Présence Rayon : fichiers ouverts constatés (ADR 0010).
            if (presences) ctx.onProgress({ presences });
          },
          CLAUDE_TIMEOUT_MS,
          // La réponse finale vit dans la ligne `result` du flux — pas dans
          // les logs, où elle n'est qu'une chaîne échappée (texte-final.ts).
          texteFinalStreamJson,
          // Le dossier du pont, que le bac éventuel monte en lecture seule.
          bridge?.dossier,
        );
        // La liste finale accompagne le résultat (dernier état des sous-agents).
        const fournisseur = declaration.declaration();
        return { ...result, subAgents: tracker.list(), ...(fournisseur ? { fournisseur } : {}) };
      } catch (error) {
        return resultatSansPont(error, tracker.list());
      } finally {
        await bridge?.close();
      }
    },
  };
}
