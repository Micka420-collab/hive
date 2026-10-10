// Adaptateur Codex CLI (`codex exec`). Ossature du Palier 1, même contrat et
// mêmes garde-fous que claude-code : clés locales au nœud, token non-trivial.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { MONTAGE } from '../node-client/isolement.js';
import { LIMITS } from '../shared/protocol.js';
import { texteDEchec } from '../shared/texte-d-echec.js';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { CONSIGNES_CODEX, consignesDuDepot, noteLiensNonSuivis } from './consignes-depot.js';
import { assertRealExecutionAllowed, runCommand, runCommandFlux } from './exec.js';
import {
  codexMcpOverrides,
  createDelegationBridge,
  resultatSansPont,
  type DelegationBridge,
} from './delegation-bridge.js';
import { createLecteurFluxCodex } from './flux-codex.js';
import { resultatSelonVigie } from './vigie-enlisement.js';
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
 *     le bubblewrap de Codex ne démarre pas, voir `sonderBacCodex` ; sous
 *     Windows, voir `bacWindowsDeclare` ;
 *   · une RELECTURE (`ctx.role`) hors bac : `read-only` — elle lit, n'écrit
 *     rien. Dans le bac, elle garde `danger-full-access` : en `read-only`, le
 *     bac de Codex s'y ouvrirait encore pour chaque commande — et n'y démarre
 *     pas —, le relecteur ne pourrait plus même lancer `git diff`. La frontière
 *     reste celle du bac de Hive, sur un clone jetable.
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
 * Un dépôt `untrusted` ne livre pas non plus son `AGENTS.md` à Codex
 * (core/src/agents_md.rs) : Hive le relit lui-même, comme simple donnée
 * bornée, et le met en tête du prompt (voir `argvCodex`).
 */
export type ExecutionCodex =
  | { sandbox: 'danger-full-access'; depot: typeof MONTAGE }
  | { sandbox: 'workspace-write' | 'read-only'; depot: string };

/**
 * `realpath` : Codex cherche la confiance d'un répertoire sous son chemin
 * canonique d'abord (`normalized_project_trust_keys`), et son cwd est celui que
 * rend le noyau — liens résolus.
 */
export function executionCodex(ctx: Pick<AdapterContext, 'bac' | 'cwd' | 'role'>): ExecutionCodex {
  if (ctx.bac) return { sandbox: 'danger-full-access', depot: MONTAGE };
  const sandbox = ctx.role === 'relecture' ? 'read-only' : 'workspace-write';
  return { sandbox, depot: realpathSync(ctx.cwd) };
}

/** Le dépôt de la tâche, `untrusted` pour cette exécution seulement. */
function depotNonFiable(execution: ExecutionCodex): string[] {
  return ['-c', `projects={${JSON.stringify(execution.depot)}={trust_level="untrusted"}}`];
}

// POLITIQUE D'ACTIONS (G12) : Codex reçoit l'outil `hive_approve_action` par le
// même pont MCP (codexMcpOverrides, enabled_tools) — ICI il est VISIBLE du
// modèle, et c'est voulu : Codex n'a pas d'équivalent au
// `--permission-prompt-tool` de Claude Code (où l'outil reste hors
// `--allowedTools`, appelé par le CLI seul) ; le seul canal est que le modèle
// demande LUI-MÊME une décision à la Chambre. Les règles execpolicy (`-c`
// allow/prompt/forbidden, la plus stricte l'emporte) ne sont PAS posées ici :
// leur forme exacte doit être prouvée sur le vrai binaire (pattern fixtures
// flux-codex), pas supposée — la politique compilée est déjà exposée à
// l'adaptateur via `ctx.permissionsAllow`.

// PAS D'EFFORT ICI, et c'est voulu : `model_reasoning_effort` (via `-c`) prend
// des valeurs ANNONCÉES PAR CHAQUE MODÈLE (`ReasoningEffort::Custom`,
// codex-rs/protocol/src/openai_models.rs), que `codex exec --help` (0.156.0)
// ne documente pas. Un niveau refusé par le modèle brûlerait la tentative en
// échec d'infrastructure, sans verdict. L'adaptateur ne déclare donc aucun
// effort, et l'Aiguillage ne lui en commande jamais (`shared/effort.ts`).

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
 *
 * ─── LES CONSIGNES DU DÉPÔT, EN TÊTE DU PROMPT ──────────────────────────────
 *
 * `consignes` : l'`AGENTS.md` du dépôt relu comme DONNÉES
 * (`consignes-depot.ts`), que le dépôt `untrusted` retire à Codex. Il part EN
 * TÊTE DU PROMPT, comme le contexte de la ruche (`composeAgentPrompt`) : au
 * rang `user`, celui où Codex range lui-même l'`AGENTS.md` d'un dépôt de
 * confiance (`UserInstructions::role`, core/src/context/user_instructions.rs,
 * tag rust-v0.156.0) — pas plus haut que la consigne de la tâche, que le pied
 * du bloc déclare seule à faire foi.
 *
 * PAS PAR `-c developer_instructions`, ESSAYÉ PUIS ÉCARTÉ : c'est un message
 * `developer`, AU-DESSUS de la tâche (session/mod.rs,
 * `build_initial_context_with_world_state`) — le texte de l'auteur du dépôt
 * y aurait pesé plus que la consigne. Et c'est la couche la plus haute de la
 * configuration : elle REMPLAÇAIT les `developer_instructions` du membre
 * (ses garde-fous, peut-être), au gré du dépôt — il suffisait d'y poser un
 * `AGENTS.md`. `model_instructions_file` et `instructions`, eux, remplacent le
 * prompt de base de Codex. Le prompt n'ajoute rien à la configuration du
 * membre ni à la confiance du dépôt.
 *
 * ─── LA PASSERELLE DU RÉSEAU FILTRÉ ─────────────────────────────────────────
 *
 * `baseApi` : dans un bac filtré, l'API passe par la passerelle du nœud, qui
 * remplace le leurre de `CODEX_API_KEY` par la vraie clé (`proxy-egress.ts`).
 * Codex ne lit pas `OPENAI_BASE_URL` : seule sa clé de configuration
 * `openai_base_url` déplace le fournisseur OpenAI intégré
 * (codex-rs/core/src/config/mod.rs, `built_in_model_providers`). La base est
 * une adresse de la boucle du bac, pas un secret.
 */
export function argvCodex(
  prompt: string,
  execution: ExecutionCodex,
  modele?: string,
  bridge?: DelegationBridge,
  consignes?: string,
  baseApi?: string,
): string[] {
  return [
    'exec',
    '--json',
    '--sandbox',
    execution.sandbox,
    '--ephemeral',
    '--skip-git-repo-check',
    ...depotNonFiable(execution),
    ...(baseApi ? ['-c', `openai_base_url=${JSON.stringify(baseApi)}`] : []),
    ...(modele ? ['--model', modele] : []),
    ...(bridge ? codexMcpOverrides(bridge) : []),
    '--',
    consignes ? `${consignes}\n\n${prompt}` : prompt,
  ];
}

/**
 * Budget du bloc de consignes pour Codex, en caractères : la moitié de celui
 * de Claude Code, qui le reçoit par fichier. Ici il passe sur la ligne de
 * commande, dans le prompt, et Windows borne la ligne entière à 32 767
 * caractères (CreateProcess). Le bloc est du JSON par lignes ; la mise entre
 * guillemets de libuv ne fait qu'échapper `"` et doubler les `\` qui le
 * précèdent — au pire le DOUBLE, U+007F compris (laissé tel quel). Codex, lui,
 * lirait jusqu'à 32 Kio d'`AGENTS.md` (`project_doc_max_bytes`).
 */
const MAX_CONSIGNES_CODEX = 8_000;

/**
 * La sonde du bac de Codex : `true`, sous le MÊME bac que `codex exec
 * --sandbox <mode>` — même assistant `codex-linux-sandbox`, même bubblewrap
 * (celui du PATH, sinon celui du paquet), même réseau coupé
 * (codex-rs/cli/src/debug_sandbox.rs ; `sandbox_mode` est l'option que
 * `codex sandbox` garde pour ses appelants). Aucun modèle n'est appelé. Le
 * dépôt y est `untrusted` comme pour `codex exec` : `codex sandbox` ne se
 * déclare jamais de confiance, mais une seule règle vaut mieux que deux.
 */
function argvSondeBacCodex(execution: ExecutionCodex): string[] {
  return [
    'sandbox',
    '-c',
    `sandbox_mode="${execution.sandbox}"`,
    ...depotNonFiable(execution),
    '--',
    'true',
  ];
}

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
 * Linux seulement : c'est là que la panne est mesurée. Windows a sa propre
 * garde (`bacWindowsDeclare`), et un bac qui refuserait d'écrire ailleurs
 * serait vu APRÈS coup (`refusDEcriture`, et le bilan de `flux-codex.ts`).
 */
async function sonderBacCodex(
  ctx: AdapterContext,
  execution: ExecutionCodex,
): Promise<AdapterResult | undefined> {
  const sonde = await runCommand('codex', argvSondeBacCodex(execution), ctx, SONDE_BAC_CODEX_MS);
  if (sonde.success) return undefined;
  // `codex` ne s'est pas lancé du tout : ce n'est pas son bac, c'est le binaire
  // — l'échec d'infra de l'exécuteur, que le nœud sait déjà traiter. Et une
  // tâche annulée pendant la sonde se dit annulée (`LIGNE_ANNULATION`, jamais
  // `infra`) : la lire ici comme un bac cassé soufflerait un remède à un poste
  // qui n'a rien.
  if (sonde.infra || ctx.signal.aborted) return sonde;
  const dit = texteDEchec(sonde.logs)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return {
    success: false,
    diff: '',
    logs: finirPar(
      sonde.logs,
      `codex : échec avant l'agent — le bac de Codex (--sandbox ${execution.sandbox}) ne démarre pas sur cet hôte` +
        `${dit ? ` (« ${dit.slice(0, 200)} »)` : ''} ; sans lui, Codex sort en 0 sans rien écrire (openai/codex#46246). ` +
        'Remède : donner un bac au nœud (podman ou docker), où Codex tourne sans le sien, ' +
        'ou laisser bubblewrap créer ses espaces de noms (Ubuntu : un profil AppArmor pour bwrap, ou kernel.apparmor_restrict_unprivileged_userns=0)',
    ),
    subAgents: [],
  };
}

/**
 * Le bac Windows de Codex est-il déclaré dans cette configuration ?
 *
 * ─── SOUS WINDOWS, `workspace-write` DEVIENT `read-only` SANS UN MOT ─────────
 *
 * `effective_sandbox_mode` (codex-rs/config/src/config_toml.rs, rust-v0.156.0)
 * rabat `workspace-write` sur `read-only` quand le niveau du bac Windows est
 * `Disabled` — le défaut, faute de `[windows] sandbox = "elevated"` ou
 * `"unelevated"` (`WindowsSandboxLevel::from_config` ; `"mxc"` vaut aussi
 * `Disabled`), ou des anciennes clés `[features]` que Codex relit encore
 * (`elevated_windows_sandbox`, `experimental_windows_sandbox`,
 * `enable_experimental_windows_sandbox` : `legacy_windows_sandbox_mode`).
 * Chaque production y était alors payée, puis perdue. On le dit AVANT.
 *
 * Une lecture de lignes, comme `fournisseurCodexTiers` (agent-detect.ts).
 * COMPROMIS ACCEPTÉ : un bac déclaré dans un profil (`-p`) n'est pas vu —
 * Hive n'en passe aucun, et un faux « non déclaré » échoue en le disant.
 */
export function bacWindowsDeclare(configToml: string): boolean {
  let section = '';
  for (const ligne of configToml.split(/\r?\n/)) {
    const entete = /^\s*\[([^\]]+)\]\s*$/.exec(ligne);
    if (entete) {
      section = entete[1]!.trim();
      continue;
    }
    if (section === 'windows' && /^\s*sandbox\s*=\s*["'](elevated|unelevated)["']/.test(ligne)) {
      return true;
    }
    const ancienne =
      /^\s*(elevated_windows_sandbox|experimental_windows_sandbox|enable_experimental_windows_sandbox)\s*=\s*true\b/;
    if (section === 'features' && ancienne.test(ligne)) return true;
  }
  return false;
}

/** La garde Windows : l'échec à rendre, ou rien. Voir `bacWindowsDeclare`. */
function gardeWindows(env: NodeJS.ProcessEnv): AdapterResult | undefined {
  const maison = (env.USERPROFILE ?? env.HOME ?? '').trim();
  const dossier = (env.CODEX_HOME ?? '').trim() || (maison ? path.join(maison, '.codex') : '');
  let texte = '';
  try {
    texte = dossier ? readFileSync(path.join(dossier, 'config.toml'), 'utf8') : '';
  } catch {
    /* pas de configuration : le bac Windows n'y est pas déclaré */
  }
  if (bacWindowsDeclare(texte)) return undefined;
  return {
    success: false,
    diff: '',
    logs:
      "codex : échec avant l'agent — sous Windows, Codex rabat --sandbox workspace-write sur read-only " +
      'tant que son bac Windows n’est pas déclaré : il paierait le modèle sans rien pouvoir écrire. ' +
      'Remède : ajouter [windows] sandbox = "unelevated" (ou "elevated") au config.toml de Codex, ' +
      'ou donner un bac au nœud (podman ou docker)',
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
 * l'a rabattu — sous Windows sans bac Windows déclaré, que `gardeWindows` ne
 * verrait pas (un profil). Une relecture (`read-only`) n'écrit rien : elle
 * n'y passe jamais.
 */
function refusDEcriture(result: AdapterResult, execution: ExecutionCodex): AdapterResult {
  if (execution.sandbox !== 'workspace-write' || !result.success) return result;
  if (!texteDEchec(result.logs).includes(REFUS_LECTURE_SEULE)) return result;
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
      if (execution.sandbox === 'workspace-write' && process.platform === 'win32') {
        const echec = gardeWindows(ctx.env);
        if (echec) return echec;
      }
      if (execution.sandbox !== 'danger-full-access' && process.platform === 'linux') {
        if (!bacCodexVerifie) {
          const echec = await sonderBacCodex(ctx, execution);
          if (echec) return echec;
          bacCodexVerifie = true;
        }
      }
      let bridge: DelegationBridge | undefined;
      try {
        if (ctx.delegate && ctx.waitForDelegationResult && ctx.rendezVous) {
          bridge = await createDelegationBridge(ctx, task.id);
        }
        // Relu sur l'hôte (`ctx.cwd`), même dans le bac : c'est le même dépôt.
        const consignes = consignesDuDepot(ctx.cwd, CONSIGNES_CODEX, MAX_CONSIGNES_CODEX);
        if (consignes) {
          ctx.onProgress({
            log: 'AGENTS.md du dépôt relu comme simple donnée (le dépôt reste non fiable pour Codex)',
          });
        }
        const liens = noteLiensNonSuivis(ctx.cwd, CONSIGNES_CODEX);
        if (liens) ctx.onProgress({ log: liens });
        // `--` avant le prompt : sans lui, un prompt commençant par un tiret est
        // lu comme une option de `codex exec` (cf. src/adapters/prompt-argv.ts,
        // où l'injection est démontrée sur le binaire claude).
        //
        // La réponse, les jetons et les logs viennent du FLUX, lu en entier :
        // le dernier message de l'agent, jamais la consigne — que le mode
        // humain répétait sur stderr, « valide » ou « conteste » compris.
        // Le bilan « rien n'a pu s'écrire » ne vaut que sous le bac de Codex
        // en écriture : dans le bac de Hive il n'y en a pas, et une relecture
        // n'écrit pas.
        const pilote = ctx.pilote;
        const flux = createLecteurFluxCodex({
          bacCodexEnEcriture: execution.sandbox === 'workspace-write',
          // La vigie (G13) : un arrêt EN VOL part au nœud, qui seul arrête.
          surArret: (arret) => ctx.onProgress({ arret }),
          ...(pilote ? { tempsCouru: () => pilote.tempsCouru() } : {}),
        });
        const result = await runCommandFlux(
          'codex',
          argvCodex(
            task.prompt,
            execution,
            ctx.modele,
            bridge,
            consignes,
            ctx.bac?.reseau?.variables.OPENAI_BASE_URL,
          ),
          ctx,
          flux,
          CODEX_TIMEOUT_MS,
          // Le dossier du pont, que le bac éventuel monte en lecture seule.
          bridge?.dossier,
        );
        const fournisseur = flux.declaration();
        return refusDEcriture(
          {
            ...resultatSelonVigie(result, flux.arret()),
            subAgents: [],
            ...(fournisseur ? { fournisseur } : {}),
          },
          execution,
        );
      } catch (error) {
        return resultatSansPont(error, []);
      } finally {
        await bridge?.close();
      }
    },
  };
}
