// Adaptateur Codex CLI (`codex exec`). Ossature du Palier 1, même contrat et
// mêmes garde-fous que claude-code : clés locales au nœud, token non-trivial.

import { realpathSync } from 'node:fs';
import { MONTAGE } from '../node-client/isolement.js';
import { LIMITS } from '../shared/protocol.js';
import { texteDEchec } from '../shared/texte-d-echec.js';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand, runCommandFlux } from './exec.js';
import {
  codexMcpOverrides,
  createDelegationBridge,
  resultatSansPont,
  type DelegationBridge,
} from './delegation-bridge.js';
import { createLecteurFluxCodex } from './flux-codex.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CODEX_TIMEOUT_MS = 15 * 60_000;

/**
 * Où Codex exécute ce que le modèle lance, et où vit le dépôt de la tâche.
 *
 * ─── SANS `--sandbox`, CODEX NE PRODUISAIT RIEN ───────────────────────────────
 *
 * `codex exec` sans mode tourne en LECTURE SEULE (`SandboxMode::default`,
 * codex-rs/config/src/config_toml.rs, `derive_permission_profile` ; relu au tag
 * rust-v0.156.0). Chaque correctif y est refusé (« patch rejected: writing is
 * blocked by read-only sandbox », core/src/safety.rs), le processus sort en 0,
 * et le nœud calculait un diff VIDE sous `success: true` — enregistré sur le
 * vrai binaire (tests/fixtures/flux-codex/lecture-seule.*). Les Gardiennes,
 * consultatives, ne bloquaient rien : toute production confiée à Codex était
 * perdue sans un mot. Le même mal que Claude Code avant `acceptEdits`.
 *
 * Le mode suit le bac de HIVE, résolu au démarrage du nœud (`ctx.bac`) :
 *
 *   · DANS le bac (conteneur ou bubblewrap) : `danger-full-access`. Le bac de
 *     Hive EST la frontière — un seul répertoire inscriptible, HOME éphémère.
 *     Celui de Codex ne s'y ouvre pas : le conteneur retire toutes les
 *     capacités (`--cap-drop=ALL`, `no-new-privileges`, `--user`), et son
 *     bubblewrap à lui ne peut plus créer d'espace de noms — Codex sort alors
 *     en 0 sans qu'aucune commande ait tourné (openai/codex#46246) ;
 *   · HORS bac : `workspace-write` — écriture dans le répertoire de la tâche et
 *     dans son `TMPDIR` (à côté, voir `buildSandboxEnv`), réseau coupé pour les
 *     commandes. Plus étroit que l'`acceptEdits` de Claude Code. Sur un hôte où
 *     le bubblewrap de Codex ne démarre pas, voir `sonderBacCodex`.
 *
 * ─── LE DÉPÔT DE LA TÂCHE N'EST JAMAIS « DE CONFIANCE » ───────────────────────
 *
 * Dès qu'il peut écrire son répertoire, Codex le déclare de confiance TOUT SEUL :
 * il l'inscrit dans `$CODEX_HOME/config.toml`, puis recharge la configuration
 * — et charge alors celle du DÉPÔT (`.codex/config.toml`, crochets, règles
 * d'exécution ; app-server `thread_processor.rs`, `set_project_trust_level`).
 * Mesuré hors bac avec codex-cli 0.156.0 : le serveur MCP qu'un dépôt déclare
 * a tourné sur l'hôte, hors de tout bac, et chaque tâche ajoutait son
 * répertoire au `config.toml` du MEMBRE. Or ce dépôt, c'est le hub qui l'a
 * choisi, pas lui. On pose donc, pour CETTE exécution seulement, `untrusted`
 * sur le répertoire que Codex voit (dans le bac : `MONTAGE`) : rien n'est
 * écrit, et la configuration du dépôt reste lettre morte, comme avant.
 *
 * COMPROMIS ACCEPTÉ : un dépôt `untrusted` ne livre pas non plus son
 * `AGENTS.md` à Codex (core/src/agents_md.rs). Le réinjecter comme simple
 * donnée bornée est un suivi, comme le `CLAUDE.md` de Claude Code.
 */
export type ExecutionCodex =
  | { sandbox: 'danger-full-access'; depot: typeof MONTAGE }
  | { sandbox: 'workspace-write'; depot: string };

/**
 * `realpath` : Codex cherche la confiance d'un répertoire sous son chemin
 * canonique d'abord (`normalized_project_trust_keys`), et son cwd est celui que
 * rend le noyau — liens résolus.
 */
export function executionCodex(ctx: Pick<AdapterContext, 'bac' | 'cwd'>): ExecutionCodex {
  return ctx.bac
    ? { sandbox: 'danger-full-access', depot: MONTAGE }
    : { sandbox: 'workspace-write', depot: realpathSync(ctx.cwd) };
}

/**
 * Arguments `codex exec` avec le modèle aiguillé et le pont MCP optionnels.
 *
 * `--json` : la sortie est le flux d'événements que lit `flux-codex.ts` — la
 * réponse finale, les jetons déclarés, les erreurs à part de la narration.
 * Sans lui, `codex exec` répète la consigne sur stderr, et le nœud y classait
 * l'échec (voir l'en-tête de `flux-codex.ts`).
 *
 * `--sandbox` et la confiance du dépôt : voir `ExecutionCodex`.
 * `--ephemeral` : aucune session écrite sur le disque — hors bac, le HOME est
 * celui du membre, et chaque tâche y laissait sa transcription.
 * `--skip-git-repo-check` : une tâche sans dépôt tourne dans un répertoire
 * vierge (`prepareWorkspace`), où `codex exec` sortait en 1 avant de rien
 * faire (« Not inside a trusted directory », exec/src/lib.rs).
 *
 * La clé du dépôt est une chaîne TOML (`JSON.stringify`, comme
 * `codexMcpOverrides`) sous la clé `projects` entière : une clé pointée
 * (`projects."/x".trust_level`) se couperait aux points du chemin.
 */
export function argvCodex(
  prompt: string,
  execution: ExecutionCodex,
  modele?: string,
  bridge?: DelegationBridge,
): string[] {
  return [
    'exec',
    '--json',
    '--sandbox',
    execution.sandbox,
    '--ephemeral',
    '--skip-git-repo-check',
    '-c',
    `projects={${JSON.stringify(execution.depot)}={trust_level="untrusted"}}`,
    ...(modele ? ['--model', modele] : []),
    ...(bridge ? codexMcpOverrides(bridge) : []),
    '--',
    prompt,
  ];
}

/**
 * La sonde du bac de Codex : `true`, sous le MÊME bac que `codex exec
 * --sandbox workspace-write` — même assistant `codex-linux-sandbox`, même
 * bubblewrap (celui du PATH, sinon celui du paquet), même réseau coupé
 * (codex-rs/cli/src/debug_sandbox.rs ; `sandbox_mode` est l'option que
 * `codex sandbox` garde pour ses appelants). Aucun modèle n'est appelé.
 */
const ARGV_SONDE_BAC_CODEX = [
  'sandbox',
  '-c',
  'sandbox_mode="workspace-write"',
  '--',
  'true',
] as const;

const SONDE_BAC_CODEX_MS = 30_000;

/**
 * Le bac de Codex démarre-t-il sur cet hôte ? Rend l'échec à rendre, ou rien.
 *
 * ─── UN BAC QUI NE DÉMARRE PAS, ET CODEX SORT EN 0 ───────────────────────────
 *
 * Sous Linux, le bac de Codex est bubblewrap. Là où il ne peut pas créer
 * d'espace de noms — Ubuntu 24.04 et suivantes
 * (`kernel.apparmor_restrict_unprivileged_userns=1`) pour tout bubblewrap que
 * leur profil AppArmor ne couvre pas, un nœud lui-même dans un conteneur —,
 * chaque correctif échoue, et `codex exec` sort pourtant en 0, le modèle
 * concluant qu'il n'a rien pu faire (openai/codex#46246). Enregistré ici avec
 * une copie de bubblewrap hors profil : « bwrap: loopback: Failed
 * RTM_NEWADDR: Operation not permitted » (tests/fixtures/flux-codex/bac-casse.*).
 *
 * La sonde le voit AVANT le modèle, donc sans rien dépenser, et c'est un échec
 * de la TÂCHE qui dit la cause et le remède — pas un échec d'« infra » : le
 * nœud n'a qu'un motif de réaffectation, « auth/quota » (node-client/client.ts),
 * qui mentirait, et un refus n'emporte que ce motif — la cause se perdrait.
 * Même règle que `resultatSansPont` pour un socket trop long : ce poste
 * échouera à chaque tentative, c'est à son opérateur d'agir.
 *
 * Linux seulement : c'est là que la panne est mesurée. Ailleurs, un bac qui
 * refuserait d'écrire serait vu APRÈS coup (`refusDEcriture`, et le bilan de
 * `flux-codex.ts`).
 */
async function sonderBacCodex(ctx: AdapterContext): Promise<AdapterResult | undefined> {
  const sonde = await runCommand('codex', [...ARGV_SONDE_BAC_CODEX], ctx, SONDE_BAC_CODEX_MS);
  if (sonde.success) return undefined;
  // `codex` ne s'est pas lancé du tout : ce n'est pas son bac, c'est le binaire
  // — l'échec d'infra de l'exécuteur, que le nœud sait déjà traiter.
  if (sonde.infra) return sonde;
  const dit = texteDEchec(sonde.logs)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return {
    success: false,
    diff: '',
    logs: finirPar(
      sonde.logs,
      `codex : échec avant l'agent — le bac de Codex (--sandbox workspace-write) ne démarre pas sur cet hôte` +
        `${dit ? ` (« ${dit.slice(0, 200)} »)` : ''} ; sans lui, Codex sort en 0 sans rien écrire (openai/codex#46246). ` +
        'Remède : donner un bac au nœud (podman ou docker), où Codex tourne sans le sien, ' +
        'ou laisser bubblewrap créer ses espaces de noms (Ubuntu : un profil AppArmor pour bwrap, ou kernel.apparmor_restrict_unprivileged_userns=0)',
    ),
    subAgents: [],
  };
}

/**
 * La phrase que Codex trace sur stderr quand son bac en LECTURE SEULE refuse un
 * correctif (core/src/safety.rs, `PATCH_REJECTED_READ_ONLY_REASON`, journalisée
 * par `codex_core::tools::router`). Elle ne vient pas du modèle : sa narration
 * est marquée, et `texteDEchec` ne la lit pas.
 */
const REFUS_LECTURE_SEULE = 'writing is blocked by read-only sandbox';

/**
 * Une exécution « réussie » où Codex a pourtant refusé d'écrire : un échec, dit.
 *
 * Avec `--sandbox workspace-write`, le bac n'est en lecture seule que si Codex
 * l'a rabattu — sous Windows sans bac Windows configuré (`[windows] sandbox`),
 * `effective_sandbox_mode` fait de `workspace-write` un `read-only` sans rien
 * dire. Une relecture n'écrit rien : elle n'y passe jamais.
 */
function refusDEcriture(result: AdapterResult): AdapterResult {
  if (!result.success || !texteDEchec(result.logs).includes(REFUS_LECTURE_SEULE)) return result;
  return {
    ...result,
    success: false,
    logs: finirPar(
      result.logs,
      "codex : échec — le bac de Codex était en lecture seule et a refusé d'écrire (« writing is blocked by read-only sandbox ») : " +
        'rien n’a été produit. Sous Windows : configurer le bac Windows de Codex ([windows] sandbox), ou donner un bac au nœud',
    ),
  };
}

/**
 * Une ligne de plus à la FIN des logs, dans la place que le nœud en envoie au
 * hub (`LIMITS.log`) — la même règle que `journalAvecFin` (exec.ts) : c'est
 * souvent la seule ligne qui dise l'échec.
 */
function finirPar(logs: string, ligne: string): string {
  const corps = logs.slice(0, Math.max(0, LIMITS.log - ligne.length - 1));
  return corps === '' || corps.endsWith('\n') ? `${corps}${ligne}` : `${corps}\n${ligne}`;
}

export function createCodexAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur codex", token);
  // Une fois vérifié, le bac de Codex l'est pour la vie du nœud : l'hôte ne
  // change pas d'une tâche à l'autre. Un échec, lui, est re-sondé — un `spawn`
  // de plus, sur un poste qui n'en exécute aucune autre.
  let bacCodexVerifie = false;
  return {
    name: 'codex',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'codex exec démarré' });
      const execution = executionCodex(ctx);
      if (execution.sandbox === 'workspace-write' && process.platform === 'linux') {
        if (!bacCodexVerifie) {
          const echec = await sonderBacCodex(ctx);
          if (echec) return echec;
          bacCodexVerifie = true;
        }
      }
      let bridge: DelegationBridge | undefined;
      try {
        if (ctx.delegate && ctx.waitForDelegationResult && ctx.rendezVous) {
          bridge = await createDelegationBridge(ctx, task.id);
        }
        // `--` avant le prompt : sans lui, un prompt commençant par un tiret est
        // lu comme une option de `codex exec` (cf. src/adapters/prompt-argv.ts,
        // où l'injection est démontrée sur le binaire claude).
        //
        // La réponse, les jetons et les logs viennent du FLUX, lu en entier :
        // le dernier message de l'agent, jamais la consigne — que le mode
        // humain répétait sur stderr, « valide » ou « conteste » compris.
        const flux = createLecteurFluxCodex();
        const result = await runCommandFlux(
          'codex',
          argvCodex(task.prompt, execution, ctx.modele, bridge),
          ctx,
          flux,
          CODEX_TIMEOUT_MS,
          // Le dossier du pont, que le bac éventuel monte en lecture seule.
          bridge?.dossier,
        );
        const fournisseur = flux.declaration();
        return refusDEcriture({
          ...result,
          subAgents: [],
          ...(fournisseur ? { fournisseur } : {}),
        });
      } catch (error) {
        return resultatSansPont(error, []);
      } finally {
        await bridge?.close();
      }
    },
  };
}
