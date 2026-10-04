// Aides communes aux adaptateurs qui lancent de vrais processus.
// Règle absolue (§5.1) : spawn(bin, argv, { shell: false }) — jamais shell:true.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { argvAgent } from '../shared/agent-windows.js';
import { envDuLanceur, envelopper, envMoteur, optionsEnveloppe } from '../node-client/isolement.js';
import type { ConteneurPilote } from '../node-client/pilote-execution.js';
import type { GraviteAgent } from '../shared/niveaux-sortie.js';
import { lancerArbre } from '../shared/arbre-processus.js';
import type { IssueArbre } from '../shared/arbre-processus.js';
import { LIMITS } from '../shared/protocol.js';
import { texteDEchec } from '../shared/texte-d-echec.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { AdapterContext, AdapterResult } from './index.js';
import { cadenceDe, createSortieDirecte } from './sortie-directe.js';
import type { FluxSortie } from './sortie-directe.js';
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
 * `usage limit` : le quota épuisé d'un compte ChatGPT sous Codex (« You’ve hit
 * your usage limit… », codex-rs/protocol/src/error.rs) — sans lui, chaque
 * tâche de ce nœud échouait comme une faute de la tâche.
 */
const INFRA_FAILURE_RE =
  /unauthor|authentication|not logged in|forbidden|\b401\b|\b403\b|\b429\b|quota|rate.?limit|usage limit|insufficient|out of credit|credit balance|billing|api[_ -]?key|invalid.{0,12}key|login|sign in|subscription/i;

/**
 * La ligne qui a fait lire un échec comme une panne d'infrastructure : la
 * dernière qui porte un motif d'`INFRA_FAILURE_RE`, sinon la dernière tout
 * court (un lancement impossible se dit en fin de journal). C'est elle que le
 * refus du nœud cite — « agent indisponible (auth/quota) » seul ne disait ni
 * quel quota, ni quelle clé, et les logs de l'agent ne partent pas avec un
 * refus : l'opérateur n'avait rien à lire.
 */
export function ligneDInfra(texte: string): string {
  const lignes = texte
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  // Pas `findLast` (ES2023) : le tableau de bord type ce module en ES2022 —
  // son graphe l'atteint par server.ts → doctor-releve → porte-securite → …
  return [...lignes].reverse().find((l) => INFRA_FAILURE_RE.test(l)) ?? lignes.at(-1) ?? '';
}

/**
 * Le bac reçoit le même nom logique que son preflight, jamais un chemin hôte :
 * c'est l'enveloppe qui le résout — dans l'image pour un conteneur, sur l'hôte
 * monté en lecture seule pour bubblewrap (`installationHote`).
 *
 * `pont` : le dossier hôte du pont de délégation de la tâche, que le bac monte
 * en lecture seule (`OptionsEnveloppe.pont`). Hors bac, le CLI l'atteint déjà
 * par son chemin d'hôte.
 */
function preparerCommande(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  pont?: string,
): { bin: string; args: string[]; env: NodeJS.ProcessEnv; conteneur?: ConteneurPilote } {
  if (ctx.bac) {
    const { fournisseur } = ctx.bac;
    // Un conteneur piloté porte un NOM connu (Sandbox Live : `pause`, `stats`).
    // Aléatoire au bout : un conteneur laissé par un nœud tué garde le sien
    // jusqu'au ramassage, et une relance de la tâche ne doit pas s'y heurter.
    const nom =
      ctx.pilote && fournisseur.bin !== 'bwrap'
        ? `hive-${ctx.bac.tache ?? 'tache'}-${randomBytes(4).toString('hex')}`
        : undefined;
    const options = {
      ...optionsEnveloppe(ctx.bac, ctx.cwd),
      ...(pont ? { pont } : {}),
      ...(nom ? { nom } : {}),
    };
    return {
      ...envelopper(bin, args, options),
      env: envDuLanceur(fournisseur, ctx.env),
      // Le moteur est joint sans l'environnement de l'agent : `pause` et
      // `stats` n'ont que faire de sa clé d'API.
      ...(nom ? { conteneur: { bin: fournisseur.bin, nom, env: envMoteur(fournisseur) } } : {}),
    };
  }
  const [binReel = bin, ...avant] = argvAgent(bin, process.env, process.platform, existsSync);
  return { bin: binReel, args: [...avant, ...args], env: ctx.env };
}

/**
 * D'où vient la réponse FINALE du processus — voir `texte-final.ts`.
 *
 *   · `'sortie-standard'` : la réponse EST la sortie standard (les CLI en texte,
 *     par la convention des outils sans écran : stdout rend, stderr
 *     diagnostique) ;
 *   · une fonction : la sortie standard est du JSON par lignes, et la fonction
 *     reconnaît l'événement final (stream-json, Cline).
 *
 * Absente : le processus ne déclare aucune réponse, `finalText` reste absent.
 * C'est le cas du shell : une commande n'est pas un agent qui répond. Un flux
 * lu en entier (`LecteurFlux`) porte sa propre réponse.
 */
export type SourceTexteFinal = 'sortie-standard' | LecteurEvenementFinal;

/**
 * Une sortie standard que l'adaptateur lit EN ENTIER : un flux d'événements
 * dont il connaît chaque type (Codex `--json`, `flux-codex.ts`).
 *
 * ─── CE QUI LE DISTINGUE D'UN `LecteurEvenementFinal` ────────────────────────
 *
 * Le stream-json de Claude Code entre BRUT dans les logs, et `texteDEchec` en
 * retire les événements : le lecteur n'y cherche que la ligne finale. Un flux
 * lu en entier n'y entre JAMAIS brut — chaque ligne y entre RENDUE, lisible
 * pour l'écran et les Gardiennes, narration marquée (`MARQUE_NARRATION`) et
 * erreurs en clair. C'est cette forme que lisent ensuite tous les lecteurs
 * d'un échec, au nœud comme au hub, par la même règle (`texteDEchec`).
 */
export interface LecteurFlux {
  /**
   * Une ligne de stdout, dans l'ordre d'arrivée. Rend ce que les logs en
   * gardent — sa forme lisible, sur une ou plusieurs lignes —, ou `undefined`
   * pour la taire. Ne lève jamais : une ligne illisible se dit, elle ne casse
   * pas la lecture des suivantes.
   *
   * `gravite` : ce que l'ÉVÉNEMENT déclare de lui-même (une erreur signalée,
   * un avertissement) — le niveau de la ligne dans la console en direct. Le
   * lecteur, qui a déjà analysé l'événement, est le seul à le savoir sans le
   * redeviner dans le texte rendu.
   */
  lire(ligne: string): { texte: string; gravite?: GraviteAgent } | undefined;
  /** La réponse finale déclarée par le flux, déjà bornée (`borneTexteFinal`). */
  texte(): string | undefined;
  /**
   * À la sortie du processus (`code`), ce que l'échec DIT, en clair et sur une
   * ligne — ou `undefined` si le flux n'a rien à en dire. Un bilan sur une
   * sortie en 0 est un échec aussi : le flux n'a pas conclu comme il le doit.
   *
   * L'exécuteur l'écrit APRÈS le plafond des logs : c'est souvent la SEULE
   * ligne qui dise l'échec, et c'est la dernière que l'agent écrit — celle
   * qu'une narration de 512 ko poussait hors du journal, au nœud (classement
   * d'infra) comme au hub (Couveuse, essaim).
   *
   * `arreteParHive` : le processus a été tué par Hive (délai de garde,
   * annulation) — le marqueur `[hive]` dit déjà pourquoi.
   */
  bilan(code: number | null, arreteParHive: boolean): string | undefined;
}

/**
 * Les logs, et leur FIN GARANTIE : le bilan d'un flux, le délai de garde. Le
 * nœud n'envoie au hub que la tête du journal (`LIMITS.log`) ; la fin y trouve
 * donc sa place, prise sur la narration plutôt que perdue.
 */
function journalAvecFin(output: string, fin: string[]): string {
  if (fin.length === 0) return output;
  const texteFin = fin.join('\n');
  const place = Math.max(0, LIMITS.log - texteFin.length - 1);
  const corps = output.length > place ? output.slice(0, place) : output;
  return corps === '' || corps.endsWith('\n') ? `${corps}${texteFin}` : `${corps}\n${texteFin}`;
}

/**
 * Lance un binaire avec ses arguments dans le cwd isolé de la tâche.
 * Sortie plafonnée, timeout dur, annulation via le signal du contexte.
 * `pont` : voir `preparerCommande`.
 */
export function runCommand(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  texteFinal?: SourceTexteFinal,
  pont?: string,
): Promise<AdapterResult> {
  return executer(bin, args, ctx, {
    timeoutMs,
    ...(texteFinal ? { texteFinal } : {}),
    ...(pont ? { pont } : {}),
  });
}

/**
 * Le parseur d'une ligne de stdout (stream-json). Il peut rendre la GRAVITÉ
 * que l'événement déclare de lui-même (`graviteStreamJson`) : c'est le niveau
 * de la ligne dans la console en direct. Rien rendu : son flux, stdout.
 */
export type LecteurLigne = (line: string) => GraviteAgent | undefined | void;

/**
 * Comme runCommand, mais invoque `onLine` pour CHAQUE ligne de stdout au fil de
 * l'eau (flux stream-json d'un agent). Sert au suivi des sous-agents en direct.
 * Le parseur `onLine` doit être tolérant ; toute exception y est absorbée.
 */
export function runCommandStreaming(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  onLine: LecteurLigne,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  texteFinal?: SourceTexteFinal,
  pont?: string,
): Promise<AdapterResult> {
  return executer(bin, args, ctx, {
    timeoutMs,
    onLine,
    ...(texteFinal ? { texteFinal } : {}),
    ...(pont ? { pont } : {}),
  });
}

/**
 * Comme runCommand, pour une sortie standard lue EN ENTIER par `flux` : les
 * logs gardent ce qu'il en rend, la réponse finale est la sienne.
 * `pont` : voir `preparerCommande`.
 */
export function runCommandFlux(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  flux: LecteurFlux,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pont?: string,
): Promise<AdapterResult> {
  return executer(bin, args, ctx, { timeoutMs, flux, ...(pont ? { pont } : {}) });
}

/**
 * La ligne qui dit, dans les logs, qu'une tâche ANNULÉE a été arrêtée — elle
 * et sa descendance (`arbre-processus.ts`).
 */
export const LIGNE_ANNULATION = '[hive] tâche annulée — processus arrêté avec sa descendance';

/**
 * Un arrêt qui DIT sa cause : la raison d'`abort` que le nœud donne quand ce
 * n'est pas un humain qui annule (la vigie, G13). Le même geste, le même arbre
 * abattu ; les logs finissent sur sa ligne plutôt que sur `LIGNE_ANNULATION`,
 * qui ferait lire « annulée » une tâche que personne n'a annulée.
 */
export class ArretMotive extends Error {
  constructor(readonly ligne: string) {
    super(ligne);
  }
}

/**
 * Le seul `spawn` des adaptateurs. `runCommand` et `runCommandStreaming` en
 * étaient deux copies ; la seconde avait appris à lire ligne à ligne, pas la
 * première — et c'est la première que Cursor et Cline employaient pour un flux
 * JSON par lignes.
 *
 * ─── L'ARBRE ENTIER, ET UNE ANNULATION QUI N'EST PAS UNE PANNE ──────────────
 *
 * Le délai et l'annulation ne tuaient que l'enfant direct (`child.kill()`, le
 * `signal` de `spawn`) : un agent arrêté laissait tourner ses sous-processus,
 * et un seul d'entre eux qui tenait la sortie gardait la tâche pendue. C'est
 * désormais tout l'ARBRE qui part, dans une borne (`lancerArbre`).
 *
 * Et l'annulation passait par l'événement `error` de `spawn` (`AbortError`),
 * que ce fichier lit comme un lancement impossible : `infra: true`, « échec du
 * lancement de « claude » ». Le nœud y voyait un binaire ABSENT et ouvrait une
 * réquisition « Binaire Claude Code introuvable » dans la Chambre — pour une
 * tâche qu'un humain venait d'annuler. Une annulation se dit comme telle
 * (`LIGNE_ANNULATION`) et n'est jamais un échec d'infrastructure.
 */
function executer(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  opts: {
    timeoutMs: number;
    onLine?: LecteurLigne;
    texteFinal?: SourceTexteFinal;
    pont?: string;
    flux?: LecteurFlux;
  },
): Promise<AdapterResult> {
  // Annulée avant de partir : rien n'est lancé, et rien ne se lit en panne.
  if (ctx.signal?.aborted) {
    return Promise.resolve({ success: false, diff: '', logs: LIGNE_ANNULATION, subAgents: [] });
  }
  const lance = preparerCommande(bin, args, ctx, opts.pont);
  const { texteFinal, flux } = opts;
  const suivi = typeof texteFinal === 'function' ? createTexteFinalTracker(texteFinal) : undefined;

  return new Promise((resolve) => {
    // Stdout ET stderr partent aussi en direct, bornés et cadencés
    // (sortie-directe.ts) : c'est ici, au seul `spawn` des adaptateurs, que
    // tous les agents réels l'obtiennent d'un coup. Les deux flux : un CLI en
    // texte peut n'écrire sur stdout que son dernier message, à la fin, et
    // toute son activité sur stderr. Un flux lu en entier (Codex `--json`,
    // `LecteurFlux`) part, lui, sous sa forme LISIBLE, ligne à ligne
    // (`parLigne`) : jamais ses événements bruts. La cadence est celle de la
    // TÂCHE (`cadenceDe`), pas de ce processus. Le caviardage, lui, est
    // l'affaire du nœud.
    const direct = createSortieDirecte(
      (_texte, sortie) => {
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
    // Les logs du résultat reçoivent des lignes ENTIÈRES, flux par flux — comme
    // la sortie en direct. Versées lecture par lecture, stdout et stderr
    // s'entrelaçaient au milieu d'une ligne : une clé coupée par une lecture de
    // stderr (`sk-live-ab<ligne de stderr>cd…`) n'était plus égale à sa valeur,
    // et le caviardage du nœud la laissait partir en deux moitiés. Une ligne
    // sans fin est versée quand elle atteint le plafond : c'est la seule coupe
    // qui reste possible, au-delà de 512 Kio d'un seul tenant.
    const enCours: Record<FluxSortie, string> = { stdout: '', stderr: '' };
    const verser = (flux: FluxSortie, s: string): void => {
      const texte = enCours[flux] + s;
      const fin = texte.length >= OUTPUT_CAP ? texte.length - 1 : texte.lastIndexOf('\n');
      enCours[flux] = texte.slice(fin + 1);
      if (fin >= 0 && output.length < OUTPUT_CAP) output += texte.slice(0, fin + 1);
    };
    const viderLignes = (): void => {
      for (const flux of ['stdout', 'stderr'] as const) {
        if (enCours[flux] !== '' && output.length < OUTPUT_CAP) output += enCours[flux];
        enCours[flux] = '';
      }
    };
    // Ce qui n'est PAS un flux d'agent brut — la forme lisible d'un flux lu en
    // entier (`LecteurFlux`) — entre d'un bloc, toujours en ligne entière.
    const consigner = (s: string): void => {
      if (output.length < OUTPUT_CAP) output += s;
    };
    let tampon = '';
    // Fin de la sortie standard seule, pour `'sortie-standard'` : stdout et
    // stderr sont MÊLÉS dans `output`, et plafonnés — un CLI en texte écrit sa
    // réponse tout à la fin, après des centaines de kilo-octets de stderr.
    let sortieStandard = '';
    const parLigne =
      opts.onLine || suivi || flux
        ? (line: string): void => {
            let gravite: GraviteAgent | undefined;
            try {
              gravite = opts.onLine?.(line) ?? undefined;
            } catch {
              /* parseur tolérant : on ignore */
            }
            suivi?.feed(line);
            // Un stdout lu ligne à ligne (stream-json) part à l'écran ligne à
            // ligne, avec la gravité que le parseur de l'agent y a lue : le
            // fragment brut ne sait pas où finit un événement.
            if (!flux) direct.ecrire(`${line}\n`, 'stdout', gravite);
            // Un flux lu en entier entre dans les logs RENDU, jamais brut —
            // et TOUJOURS en début de ligne : un morceau de stderr sans fin de
            // ligne collait la narration derrière lui ; sa marque n'ouvrait
            // plus la ligne, et `texteDEchec` gardait les mots de l'agent
            // (« API key ») comme ce que l'échec dit. `verser` n'y livre plus
            // que des lignes entières ; la garde tient pour la ligne sans fin
            // versée au plafond. Et c'est cette forme-là que l'écran suit.
            const rendue = flux?.lire(line);
            if (rendue !== undefined) {
              const texte = rendue.texte;
              consigner(output === '' || output.endsWith('\n') ? `${texte}\n` : `\n${texte}\n`);
              direct.ecrire(`${texte}\n`, 'stdout', rendue.gravite);
            }
          }
        : undefined;

    const finir = (issue: IssueArbre): void => {
      // Plus de mesure ni de pause sur un processus qui a fini — et ce qu'une
      // pause en vol aurait arrêté est relancé (`pilote-execution.ts`).
      detacher?.();
      viderLignes();
      // La dernière ligne sans \n final — un lancement impossible n'a rien écrit.
      if (issue.issue !== 'lancement' && parLigne && tampon.trim()) parLigne(tampon);
      // Avant le `resolve` : un morceau parti après le résultat serait ignoré
      // par le hub, et ressusciterait une console déjà vidée à l'écran. APRÈS
      // la dernière ligne : terminée avant, la sortie la taisait à l'écran.
      direct.terminer();
      if (issue.issue === 'lancement') {
        // Le binaire n'a pas pu être lancé (absent, non exécutable) : échec d'infra.
        resolve({
          success: false,
          diff: '',
          logs: `${output}\n[hive] échec du lancement de « ${bin} » : ${issue.erreur.message}`,
          subAgents: [],
          infra: true,
        });
        return;
      }
      const arrete = issue.issue === 'arret';
      const code = issue.issue === 'sortie' ? issue.code : null;
      // Un processus ARRÊTÉ n'a pas conclu : ce qu'il avait écrit n'est pas sa
      // réponse finale, et le lire comme tel ferait juger une phrase coupée.
      const finalText = arrete
        ? undefined
        : texteFinal === 'sortie-standard'
          ? borneTexteFinal(sortieStandard)
          : (flux ?? suivi)?.texte();
      const bilan = flux?.bilan(code, arrete);
      const logs = journalAvecFin(output, [
        ...(issue.issue === 'arret' && issue.motif === 'delai'
          ? [`[hive] timeout après ${opts.timeoutMs} ms — processus tué`]
          : []),
        ...(issue.issue === 'arret' && issue.motif === 'annule'
          ? [ctx.signal.reason instanceof ArretMotive ? ctx.signal.reason.ligne : LIGNE_ANNULATION]
          : []),
        ...(issue.issue === 'sortie' && issue.tenue
          ? [
              "[hive] la sortie est restée ouverte après la fin de l'agent : " +
                'un processus qu’il a lancé la tenait',
            ]
          : []),
        ...(bilan !== undefined ? [bilan] : []),
      ]);
      const success = code === 0 && bilan === undefined;
      // Échec dont le TEXTE évoque un problème d'auth/quota → infra
      // (réaffectation). Pas les logs bruts : voir `INFRA_FAILURE_RE`. Jamais
      // une annulation : voir l'en-tête.
      const annulee = issue.issue === 'arret' && issue.motif === 'annule';
      const infra = !success && !annulee && INFRA_FAILURE_RE.test(texteDEchec(logs, finalText));
      resolve({
        success,
        diff: '',
        logs,
        subAgents: [],
        ...(infra ? { infra: true } : {}),
        ...(finalText !== undefined ? { finalText } : {}),
      });
    };

    // Le délai dur, armé par le pilote quand il y en a un : une pause de
    // l'agent (Sandbox Live) le SUSPEND — l'agent repris retrouve le temps
    // qu'il n'a pas consommé, au lieu d'être tué pendant qu'il dormait.
    const pilote = ctx.pilote;
    const armerDelai = pilote
      ? (delaiMs: number, declencher: () => void) =>
          pilote.minuteur(delaiMs, () => {
            // Détaché AVANT le signal : plus de pause possible sur un agent
            // qu'on arrête, et ce qu'une pause en vol aurait arrêté est relancé
            // — arrêté, il ne traiterait pas ce SIGTERM (`pilote-execution.ts`).
            detacher?.();
            declencher();
          })
      : undefined;
    const child = lancerArbre(
      lance.bin,
      lance.args,
      // Voir `ENTREE_FERMEE` : un tube d'entrée que personne n'écrit bloquait
      // chaque tâche Codex jusqu'au délai dur.
      { cwd: ctx.cwd, env: lance.env, stdio: ENTREE_FERMEE },
      {
        delaiMs: opts.timeoutMs,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
        ...(armerDelai ? { armerDelai } : {}),
      },
      finir,
    );
    // La commande LOGIQUE (l'agent et ses arguments), pas l'enveloppe du bac :
    // c'est elle que l'écran doit lire. Le nœud la caviarde avant l'envoi.
    const detacher: (() => void) | undefined =
      child.pid !== undefined
        ? pilote?.attacher({
            pid: child.pid,
            commande: [bin, ...args].join(' ').slice(0, 4096),
            ...(lance.conteneur ? { conteneur: lance.conteneur } : {}),
          })
        : undefined;

    // Décodage UTF-8 AU FIL DES MORCEAUX : un caractère accentué coupé entre
    // deux lectures devenait deux « � », jusque dans la ligne `result`.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (s: string) => {
      // Un flux lu en entier n'entre ni brut dans les logs, ni brut à l'écran :
      // sa forme lisible y entre ligne à ligne (`parLigne`).
      if (!flux) {
        verser('stdout', s);
        // Lu ligne à ligne (`parLigne`) : il part de là, avec sa gravité.
        if (!parLigne) direct.ecrire(s);
      }
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
      verser('stderr', s);
      direct.ecrire(s, 'stderr');
    });
  });
}
