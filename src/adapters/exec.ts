// Aides communes aux adaptateurs qui lancent de vrais processus.
// Règle absolue (§5.1) : spawn(bin, argv, { shell: false }) — jamais shell:true.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { argvAgent } from '../shared/agent-windows.js';
import { envelopper } from '../node-client/isolement.js';
import { LIMITS } from '../shared/protocol.js';
import { texteDEchec } from '../shared/texte-d-echec.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { AdapterContext, AdapterResult } from './index.js';
import { cadenceDe, createSortieDirecte } from './sortie-directe.js';
import { borneTexteFinal, createTexteFinalTracker } from './texte-final.js';
import type { LecteurEvenementFinal } from './texte-final.js';

/** Toute exécution réelle exige un token non-trivial (contrainte §5.1). */
export function assertRealExecutionAllowed(kind: string, token: string): void {
  if (token === DEFAULT_TOKEN || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${kind} refusé : HIVE_TOKEN est trivial (valeur par défaut ou < ${MIN_TOKEN_LENGTH} caractères). ` +
        'Configurez un vrai token partagé avant toute exécution réelle.',
    );
  }
}

const OUTPUT_CAP = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * L'agent est piloté par argv : son entrée standard est FERMÉE (`/dev/null`).
 *
 * ─── UNE ENTRÉE OUVERTE QUE PERSONNE N'ÉCRIT, C'EST UNE ATTENTE SANS FIN ─────
 *
 * Le défaut de `spawn` est un tube que Hive n'écrit ni ne ferme jamais. Or
 * `codex exec` AJOUTE au prompt ce qu'il lit sur une entrée qui n'est pas un
 * terminal, jusqu'à la fin de fichier (codex-rs/exec, « Reading additional input
 * from stdin... ») : mesuré avec codex-cli 0.156.0, la tâche restait bloquée
 * jusqu'au délai dur — 15 minutes par tâche Codex, dans le bac comme dehors.
 * Claude Code, lui, perdait 3 s à attendre une entrée qui ne venait pas. Les
 * commandes de test et de préparation d'un merge (`runProc`) suivent la même
 * règle, pour la même raison.
 */
export const ENTREE_FERMEE: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe'];

/**
 * Motifs signalant un échec d'INFRASTRUCTURE de l'agent (auth/quota/crédit) plutôt
 * qu'un échec de la tâche. Sert au token-failover : la tâche est réaffectée à un
 * autre nœud plutôt que de brûler une tentative. Volontairement large ; un faux
 * positif ne fait que déplacer la tâche (au pire elle échoue faute de nœud viable).
 *
 * Testés sur ce que l'échec DIT (`texteDEchec`), jamais sur les logs bruts : la
 * ligne `init` du stream-json porte `"apiKeySource"` à CHAQUE exécution, et
 * tout échec de Claude Code ou de Cursor y passait pour une panne
 * d'identifiants. `credit balance` : le libellé de Claude Code 2.1.283
 * (« Credit balance is too low »), que seul ce faux positif rattrapait.
 */
const INFRA_FAILURE_RE =
  /unauthor|authentication|not logged in|forbidden|\b401\b|\b403\b|\b429\b|quota|rate.?limit|insufficient|out of credit|credit balance|billing|api[_ -]?key|invalid.{0,12}key|login|sign in|subscription/i;

/**
 * Le bac reçoit le même nom logique que son preflight, jamais un chemin hôte :
 * c'est l'enveloppe qui le résout — dans l'image pour un conteneur, sur l'hôte
 * monté en lecture seule pour bubblewrap (`installationHote`).
 */
function preparerCommande(bin: string, args: string[], ctx: AdapterContext) {
  const [binReel = bin, ...avant] = ctx.bac
    ? [bin]
    : argvAgent(bin, process.env, process.platform, existsSync);
  const argsReels = [...avant, ...args];

  return ctx.bac
    ? envelopper(binReel, argsReels, {
        fournisseur: ctx.bac.fournisseur,
        cwdHote: ctx.cwd,
        variables: ctx.bac.variables,
        image: ctx.bac.image,
      })
    : { bin: binReel, args: argsReels };
}

/**
 * D'où vient la réponse FINALE du processus — voir `texte-final.ts`.
 *
 *   · `'sortie-standard'` : la réponse EST la sortie standard (Codex, et les CLI
 *     en texte par la convention des outils sans écran : stdout rend, stderr
 *     diagnostique) ;
 *   · une fonction : la sortie standard est du JSON par lignes, et la fonction
 *     reconnaît l'événement final (stream-json, Cline).
 *
 * Absente : le processus ne déclare aucune réponse, `finalText` reste absent.
 * C'est le cas du shell : une commande n'est pas un agent qui répond.
 */
export type SourceTexteFinal = 'sortie-standard' | LecteurEvenementFinal;

/**
 * Lance un binaire avec ses arguments dans le cwd isolé de la tâche.
 * Sortie plafonnée, timeout dur, annulation via le signal du contexte.
 */
export function runCommand(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  texteFinal?: SourceTexteFinal,
): Promise<AdapterResult> {
  return executer(bin, args, ctx, { timeoutMs, ...(texteFinal ? { texteFinal } : {}) });
}

/**
 * Comme runCommand, mais invoque `onLine` pour CHAQUE ligne de stdout au fil de
 * l'eau (flux stream-json d'un agent). Sert au suivi des sous-agents en direct.
 * Le parseur `onLine` doit être tolérant ; toute exception y est absorbée.
 */
export function runCommandStreaming(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  onLine: (line: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  texteFinal?: SourceTexteFinal,
): Promise<AdapterResult> {
  return executer(bin, args, ctx, { timeoutMs, onLine, ...(texteFinal ? { texteFinal } : {}) });
}

/**
 * Le seul `spawn` des adaptateurs. `runCommand` et `runCommandStreaming` en
 * étaient deux copies ; la seconde avait appris à lire ligne à ligne, pas la
 * première — et c'est la première que Cursor et Cline employaient pour un flux
 * JSON par lignes.
 */
function executer(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  opts: {
    timeoutMs: number;
    onLine?: (line: string) => void;
    texteFinal?: SourceTexteFinal;
  },
): Promise<AdapterResult> {
  const lance = preparerCommande(bin, args, ctx);
  const { texteFinal } = opts;
  const suivi = typeof texteFinal === 'function' ? createTexteFinalTracker(texteFinal) : undefined;
  const parLigne =
    opts.onLine || suivi
      ? (line: string): void => {
          try {
            opts.onLine?.(line);
          } catch {
            /* parseur tolérant : on ignore */
          }
          suivi?.feed(line);
        }
      : undefined;

  return new Promise((resolve) => {
    const child = spawn(lance.bin, lance.args, {
      cwd: ctx.cwd,
      env: ctx.env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      signal: ctx.signal,
      // Voir `ENTREE_FERMEE` : un tube d'entrée que personne n'écrit bloquait
      // chaque tâche Codex jusqu'au délai dur.
      stdio: ENTREE_FERMEE,
    });

    // Stdout ET stderr partent aussi en direct, bornés et cadencés
    // (sortie-directe.ts) : c'est ici, au seul `spawn` des adaptateurs, que
    // tous les agents réels l'obtiennent d'un coup. Les deux flux : `codex
    // exec` n'écrit sur stdout que son dernier message, à la fin — toute son
    // activité (commandes, raisonnement) est sur stderr. La cadence est celle
    // de la TÂCHE (`cadenceDe`), pas de ce processus. Le caviardage, lui, est
    // l'affaire du nœud.
    const direct = createSortieDirecte(
      (sortie) => {
        try {
          ctx.onProgress({ sortie });
        } catch {
          /* le départ vit dans un minuteur : une exception y tuerait le nœud */
        }
      },
      undefined,
      cadenceDe(ctx.onProgress),
    );
    let output = '';
    let tampon = '';
    // Fin de la sortie standard seule, pour `'sortie-standard'` : stdout et
    // stderr sont MÊLÉS dans `output`, et plafonnés — Codex écrit sa réponse
    // tout à la fin, après des centaines de kilo-octets de stderr.
    let sortieStandard = '';
    let tue = false;
    // Décodage UTF-8 AU FIL DES MORCEAUX : un caractère accentué coupé entre
    // deux lectures devenait deux « � », jusque dans la ligne `result`.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (s: string) => {
      if (output.length < OUTPUT_CAP) output += s;
      direct.ecrire(s);
      if (texteFinal === 'sortie-standard') {
        sortieStandard = (sortieStandard + s).slice(-2 * LIMITS.finalText);
      }
      if (!parLigne) return;
      tampon += s;
      let idx: number;
      while ((idx = tampon.indexOf('\n')) >= 0) {
        parLigne(tampon.slice(0, idx));
        tampon = tampon.slice(idx + 1);
      }
    });
    child.stderr?.on('data', (s: string) => {
      if (output.length < OUTPUT_CAP) output += s;
      direct.ecrire(s, 'stderr');
    });

    const timeout = setTimeout(() => {
      tue = true;
      output += `\n[hive] timeout après ${opts.timeoutMs} ms — processus tué`;
      child.kill();
    }, opts.timeoutMs);
    timeout.unref?.();

    child.on('error', (err) => {
      clearTimeout(timeout);
      direct.terminer();
      // Le binaire n'a pas pu être lancé (absent, non exécutable) : échec d'infra.
      resolve({
        success: false,
        diff: '',
        logs: `${output}\n[hive] échec du lancement de « ${bin} » : ${err.message}`,
        subAgents: [],
        infra: true,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      // Avant le `resolve` : un morceau parti après le résultat serait ignoré
      // par le hub, et ressusciterait une console déjà vidée à l'écran.
      direct.terminer();
      if (parLigne && tampon.trim()) parLigne(tampon); // dernière ligne sans \n final
      // Un processus TUÉ n'a pas conclu : ce qu'il avait écrit n'est pas sa
      // réponse finale, et le lire comme tel ferait juger une phrase coupée.
      const finalText = tue
        ? undefined
        : texteFinal === 'sortie-standard'
          ? borneTexteFinal(sortieStandard)
          : suivi?.texte();
      // Échec dont le TEXTE évoque un problème d'auth/quota → infra
      // (réaffectation). Pas les logs bruts : voir `INFRA_FAILURE_RE`.
      const infra = code !== 0 && INFRA_FAILURE_RE.test(texteDEchec(output, finalText));
      resolve({
        success: code === 0,
        diff: '',
        logs: output,
        subAgents: [],
        ...(infra ? { infra: true } : {}),
        ...(finalText !== undefined ? { finalText } : {}),
      });
    });
  });
}
