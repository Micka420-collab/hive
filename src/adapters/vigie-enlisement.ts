// LA VIGIE (G13) — un agent qui tourne en rond, ou un fournisseur qui ne sert
// plus. Détecteur pur, côté nœud, à état borné. Règles et seuils portés du
// StuckDetector d'OpenHands (MIT) — notice complète au bas de ce fichier.
//
// ─── POURQUOI ─────────────────────────────────────────────────────────────────
//
// Seuls des délais fixes arrêtaient un agent : 15 min (Claude Code, Codex,
// Cursor, Grok, agent sur mesure), 30 min (Cline, Hermes). Un agent qui boucle
// brûlait budget et Worker jusque-là, puis échouait sur « timeout » — une
// cause floue que la Couveuse, l'essaim et le Cerveau rangeaient telle quelle.
// Un fournisseur épuisé n'était vu qu'APRÈS coup, et seulement si son message
// croisait `INFRA_FAILURE_RE` (exec.ts) : enregistrés sur les vrais binaires
// (tests/fixtures/enlisement), le 529 de Claude Code 2.1.289 (« API Error: 529
// Overloaded… ») et la surcharge de Codex 0.156.0 (« Selected model is at
// capacity », « We’re currently experiencing high demand ») n'y répondaient
// pas : des échecs du MODÈLE. Et Codex attend le réseau SANS FIN
// (`unbounded_connection_retries`, stable et actif par défaut : « Reconnecting...
// waiting for network », 5 s puis jusqu'à 60 s) — le délai dur, puis « timeout ».
//
// ─── CE QU'ELLE LIT ──────────────────────────────────────────────────────────
//
// Les événements que le CLI DÉCLARE, jamais la narration de l'agent : un appel
// d'outil et son retour (appariés par leur identifiant, chaque sous-agent dans
// son propre fil), le travail de FOND en cours, une relance du CLI vers son
// fournisseur et la réponse qui la clôt, l'issue finale du CLI. Une lecture
// par famille les en tire : `evenementsClaude` (stream-json), `evenementsCodex`
// (`codex exec --json`). Les autres familles n'ont pas de flux d'outils
// structuré que Hive lise (Cursor : son `tool_call` n'est pas enregistré ;
// Cline, Grok, Hermes, sur mesure : du texte) — la vigie ne les couvre pas, et
// ne devine rien d'eux.
//
// ─── CE QU'ELLE REND, ET QUAND ───────────────────────────────────────────────
//
// Un `ArretVigie` (shared/enlisement.ts) : `enlisement` (compté comme un échec
// du modèle) ou `epuisement_fournisseur` (une panne d'infrastructure).
//
//   · EN VOL (`observer`), seulement deux arrêts : l'enlisement, et l'attente
//     du réseau SANS borne déclarée de Codex, au-delà d'`ATTENTE_RESEAU_MAX_MS`.
//     La vigie ne tue rien : l'adaptateur le dit au nœud (`AdapterProgress.
//     arret`), qui arrête l'agent par le geste de l'annulation ;
//   · À L'ISSUE (`issue`), l'épuisement : la DERNIÈRE ligne finale du CLI
//     (`result`, `turn.*`) — ou, s'il n'en a écrit aucune (délai dur, arrêt),
//     la série de relances encore en cours. Toute relance que le CLI BORNE
//     lui-même (Claude Code : `max_retries` de chaque `api_retry`, 10 par
//     défaut, 300 sous `CLAUDE_CODE_RETRY_WATCHDOG` ; Codex : « Reconnecting...
//     n/M ») va au bout : Hive ne devance jamais la décision du CLI.
//
// LIMITE ASSUMÉE — le flux n'est pas écrit que par le CLI : ce que l'agent
// lance peut écrire une ligne entière sur la sortie du CLI
// (`/proc/<pid du CLI>/fd/1`, dans le bac comme dehors). D'où la règle
// ci-dessus : aucun signal d'épuisement n'ARRÊTE en vol (un `rate_limit_event`
// « rejected » ne fait qu'annoter la remise à zéro d'une limite que l'issue
// finale confirme), et l'issue est la DERNIÈRE ligne finale — celle du CLI,
// qui écrit après l'agent. Forger un enlisement ne ferait que compter un échec
// contre l'agent ; forger l'attente du réseau demande dix minutes sans aucune
// réponse du fournisseur. Ce qui reste : un agent qui forge une relance puis se
// tait jusqu'au délai dur fait ranger ce délai en panne d'infrastructure.

import { createHash } from 'node:crypto';
import { remiseCredible } from '../shared/enlisement.js';
import type { ArretVigie, CauseEpuisement, Enlisement } from '../shared/enlisement.js';
import type { AdapterResult } from './index.js';

// ─── LES SEUILS, PORTÉS D'OPENHANDS ──────────────────────────────────────────
//
// `StuckDetectionThresholds` (openhands-sdk/openhands/sdk/conversation/types.py,
// défauts relus au commit b66c7243 de OpenHands/software-agent-sdk) — les seuils
// d'un détecteur qui ARRÊTE déjà des agents en production, pas des chiffres
// choisis ici. La répétition et l'oscillation exigent que TOUT se répète —
// l'appel (outil et arguments) et son retour : un agent qui progresse (un
// fichier écrit autrement, des tests dont la sortie change, la même commande
// qui échoue chaque fois autrement) casse la répétition, et n'est jamais
// déclaré enlisé.

/** `action_observation` = 4 : même appel, même retour, quatre fois de suite. */
export const REPETITIONS_ENLISEMENT = 4;
/**
 * `action_error` = 3, enlisé AU-DELÀ (`streak > threshold`) : le même appel
 * rejeté par le CADRE du CLI 4 fois de suite. Une ERREUR, chez OpenHands, est
 * un `AgentErrorEvent` — « an error produced by the agent/scaffold, not model
 * output » (sdk/event/llm_convertible/observation.py) : un appel d'outil
 * illisible ou impossible. Une commande qui sort en 1 y est une observation
 * ordinaire (`ObservationEvent`, sdk/agent/agent.py) — ici aussi : elle ne
 * compte que par la règle de répétition, sortie comprise.
 */
export const ERREURS_ENLISEMENT = 4;
/** `alternating_pattern` = 6 : A→B→A→B→A→B, appels et retours. */
export const OSCILLATION_ENLISEMENT = 6;

/**
 * L'attente du réseau sans borne de Codex (« Reconnecting... waiting for
 * network » : `Feature::UnboundedConnectionRetries`, stable et actif par
 * défaut ; 5 s puis jusqu'à 60 s entre deux essais — codex-rs/core/src/
 * responses_retry.rs, rust-v0.156.0), bornée par Hive en DURÉE depuis la
 * première relance sans réponse : 10 min, les deux tiers du délai dur de
 * l'adaptateur (15 min) — une panne du réseau plus longue ne laisse plus à la
 * tentative le temps de produire, un autre nœud peut la prendre. Bien au-delà
 * de toute relance que le CLI borne lui-même : dix relances de Claude Code ont
 * duré 183 et 217 s (enregistrées), cinq de Codex 29 s.
 */
export const ATTENTE_RESEAU_MAX_MS = 10 * 60_000;

/** Appels sans retour gardés au plus (outils en vol, sous-agents compris). */
const APPELS_EN_VOL_MAX = 64;
/** Fils suivis au plus : l'agent principal et ses sous-agents (`LIMITS.subAgents` = 32). */
const FILS_MAX = 33;
/** Le fil de l'agent principal. */
const PRINCIPAL = 'principal';

/**
 * Ce que la vigie lit du flux.
 *
 *   · `appel` / `retour` : un appel d'outil et son retour ; `cadre` : le CLI a
 *     REJETÉ l'appel (une erreur du cadre, jamais la sortie d'une commande) ;
 *     `inedit` : un appel dont le flux ne porte pas le contenu (un correctif
 *     de Codex) — il ne se compare à rien, c'est du progrès ;
 *   · `rejet` : le CLI a refusé la PERMISSION de cet appel, annoncé avant son
 *     retour — qui sera alors un rejet du cadre ;
 *   · `fond` : du travail de fond tourne (tâche ou agent en arrière-plan) —
 *     l'attendre n'est pas tourner en rond ;
 *   · `relance` : le CLI refait une requête à son fournisseur ; `bornee` : le
 *     CLI déclare lui-même jusqu'où ;
 *   · `reponse` : le fournisseur a répondu — la série de relances est close ;
 *   · `limite` : une limite d'abonnement atteinte, et sa remise à zéro ;
 *   · `fin` : l'issue FINALE du CLI, épuisement ou non (`cause` absente).
 */
export type EvenementVigie =
  | { genre: 'appel'; id: string; agent: string; outil: string; empreinte: string; inedit?: true }
  | { genre: 'retour'; id: string; empreinte: string; cadre: boolean }
  | { genre: 'rejet'; id: string }
  | { genre: 'fond'; actif: boolean }
  | { genre: 'relance'; cause: CauseEpuisement; bornee: boolean }
  | { genre: 'reponse' }
  | { genre: 'limite'; remiseA?: number }
  | { genre: 'fin'; cause?: CauseEpuisement };

export interface Vigie {
  /**
   * L'arrêt EN VOL que cet événement décide — rendu une fois, puis plus rien.
   * `maintenant` : l'horloge de l'appelant (la vigie n'en lit aucune).
   */
  observer(e: EvenementVigie, maintenant: number): ArretVigie | undefined;
  /** L'issue de l'exécution, une fois que le CLI a rendu la main (voir l'en-tête). */
  issue(): ArretVigie | undefined;
}

/** Un appel apparié à son retour : ce que les règles comparent. */
interface Paire {
  appel: string;
  retour: string;
  cadre: boolean;
  /** Faux pour un appel `inedit`, ou observé pendant du travail de fond. */
  comparable: boolean;
  outil: string;
}

/**
 * Les règles d'OpenHands (`StuckDetector.is_stuck`), dans son ordre, sur les
 * derniers appels d'UN fil :
 *
 *   1. même appel, même retour (`_is_stuck_repeating_action_observation`) ;
 *   2. même appel, rejeté par le cadre à chaque fois (`_is_stuck_repeating_action_error`) ;
 *   4. deux appels alternés, retours compris (`_is_stuck_alternating_action_observation`).
 *
 * Non portés, et pourquoi : le monologue (3 — des messages de l'agent sans
 * action ; sans terminal, `claude -p` et `codex exec` CONCLUENT le tour sur une
 * réponse sans appel d'outil : il ne peut pas se répéter), l'erreur de
 * contexte (5 — `return False` chez OpenHands, en attente), le rappel au
 * 3e rejet (`get_action_error_nudge` : Hive ne parle pas encore à un agent en
 * cours — G17). L'égalité d'un appel est celle de goose (`tool_monitor.rs` :
 * nom ET arguments) : la « pensée » qu'OpenHands compare aussi n'est pas dans
 * l'appel du flux.
 *
 * Les règles 1 et 4 se taisent sur un appel non `comparable` : attendre du
 * travail de fond (relire une sortie qui n'a pas encore changé, lister des
 * agents qui avancent) répète un appel sans tourner en rond.
 */
function enlise(fil: readonly Paire[]): Enlisement | undefined {
  const dernier = fil.at(-1);
  if (!dernier) return undefined;
  const fin = (n: number): readonly Paire[] => (fil.length >= n ? fil.slice(-n) : []);
  const memePaire = (a: Paire, b: Paire): boolean => a.appel === b.appel && a.retour === b.retour;
  const { outil } = dernier;
  const repetes = fin(REPETITIONS_ENLISEMENT);
  if (repetes.length > 0 && repetes.every((p) => p.comparable && memePaire(p, dernier))) {
    return { motif: 'repetition', fois: REPETITIONS_ENLISEMENT, outil };
  }
  const rejets = fin(ERREURS_ENLISEMENT);
  if (rejets.length > 0 && rejets.every((p) => p.cadre && p.appel === dernier.appel)) {
    return { motif: 'erreurs', fois: ERREURS_ENLISEMENT, outil };
  }
  const alterne = fin(OSCILLATION_ENLISEMENT);
  const oscille = alterne.every((p, i) => p.comparable && (i < 2 || memePaire(p, alterne[i - 2]!)));
  if (alterne.length > 0 && oscille) {
    return { motif: 'oscillation', fois: OSCILLATION_ENLISEMENT, outil };
  }
  return undefined;
}

/** La vigie d'UNE exécution. */
export function createVigie(): Vigie {
  const enVol = new Map<
    string,
    { agent: string; outil: string; empreinte: string; inedit: boolean; rejete: boolean }
  >();
  const fils = new Map<string, Paire[]>();
  let fond = false;
  /** Les relances encore sans réponse : leur cause, et depuis quand. */
  let serie: { cause: CauseEpuisement; depuis: number } | undefined;
  let remiseDeclaree: number | undefined;
  /** La dernière issue finale lue ; `undefined` : le CLI n'en a écrit aucune. */
  let finale: { cause?: CauseEpuisement } | undefined;
  let arretEnVol: ArretVigie | undefined;
  const arreter = (arret: ArretVigie): ArretVigie => {
    arretEnVol = arret;
    return arret;
  };
  return {
    observer(e, maintenant) {
      if (arretEnVol) return undefined;
      switch (e.genre) {
        case 'appel': {
          const { agent, outil, empreinte } = e;
          enVol.set(e.id, { agent, outil, empreinte, inedit: e.inedit === true, rejete: false });
          // Bornée : un appel jamais rendu (agent tué, ligne perdue) ne s'accumule pas.
          if (enVol.size > APPELS_EN_VOL_MAX) enVol.delete(enVol.keys().next().value!);
          return undefined;
        }
        case 'retour': {
          const appel = enVol.get(e.id);
          if (!appel) return undefined;
          enVol.delete(e.id);
          const fil = fils.get(appel.agent) ?? [];
          fils.delete(appel.agent);
          fils.set(appel.agent, fil);
          if (fils.size > FILS_MAX) fils.delete(fils.keys().next().value!);
          fil.push({
            appel: appel.empreinte,
            retour: e.empreinte,
            cadre: e.cadre || appel.rejete,
            comparable: !appel.inedit && !fond,
            outil: appel.outil,
          });
          if (fil.length > OSCILLATION_ENLISEMENT) fil.shift();
          const enlisement = enlise(fil);
          return enlisement ? arreter({ issue: 'enlisement', ...enlisement }) : undefined;
        }
        case 'rejet': {
          const appel = enVol.get(e.id);
          if (appel) appel.rejete = true;
          return undefined;
        }
        case 'fond':
          fond = e.actif;
          return undefined;
        case 'reponse':
          serie = undefined;
          return undefined;
        case 'relance': {
          serie = { cause: e.cause, depuis: serie?.depuis ?? maintenant };
          if (e.bornee || maintenant - serie.depuis <= ATTENTE_RESEAU_MAX_MS) return undefined;
          return arreter({ issue: 'epuisement_fournisseur', cause: e.cause });
        }
        case 'limite':
          // Crue seulement crédible (sous 8 jours) : 9e18 levait au formatage.
          if (remiseCredible(e.remiseA, maintenant)) remiseDeclaree = e.remiseA;
          return undefined;
        case 'fin':
          finale = e.cause ? { cause: e.cause } : {};
          serie = undefined;
          return undefined;
      }
    },
    issue() {
      if (arretEnVol) return arretEnVol;
      const cause = finale ? finale.cause : serie?.cause;
      if (!cause) return undefined;
      const remise = cause === 'limite' && remiseDeclaree !== undefined;
      return {
        issue: 'epuisement_fournisseur',
        cause,
        ...(remise ? { remiseA: remiseDeclaree } : {}),
      };
    },
  };
}

/**
 * Le résultat d'une exécution, avec l'issue que la vigie a rendue. Une
 * exécution RÉUSSIE la garde telle quelle : le CLI a conclu avant que l'arrêt
 * ne le touche. Un épuisement prend le chemin des pannes d'infrastructure
 * (`infra`) : la tentative est réaffectée, rien ne l'impute au modèle. Un
 * enlisement n'en est JAMAIS une, même si ce que la boucle a écrit en dernier
 * croise `INFRA_FAILURE_RE` (un `curl` qui reçoit un 401 en boucle) : c'est le
 * modèle qui tournait en rond.
 */
export function resultatSelonVigie(
  result: AdapterResult,
  arret: ArretVigie | undefined,
): AdapterResult {
  if (!arret || result.success) return result;
  if (arret.issue === 'enlisement') {
    const { infra: _infra, ...echec } = result;
    return { ...echec, enlisement: { motif: arret.motif, fois: arret.fois, outil: arret.outil } };
  }
  const { cause, remiseA } = arret;
  return {
    ...result,
    infra: true,
    epuisement: { cause, ...(remiseA !== undefined ? { remiseA } : {}) },
  };
}

// ─── LES LECTURES PAR FAMILLE ────────────────────────────────────────────────

type Objet = Record<string, unknown>;

const estObjet = (v: unknown): v is Objet =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const chaine = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * JSON aux clés triées : deux appels identiques donnent la même empreinte, quel
 * que soit l'ordre dans lequel le modèle a écrit leurs arguments.
 */
function jsonStable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonStable).join(',')}]`;
  if (estObjet(v)) {
    const cles = Object.keys(v).sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${jsonStable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** L'empreinte d'un appel ou d'un retour : la vigie ne garde jamais le texte. */
const empreinte = (texte: string): string => createHash('sha256').update(texte).digest('hex');

/**
 * Le statut HTTP d'une erreur d'API Claude, en cause d'épuisement : 429 la
 * limite ; 502 et 504 — une passerelle qui ne joint pas l'amont, celle de Hive
 * comprise (`proxy-egress.ts`) — l'absence de réponse, comme `null` (« no HTTP
 * response », doc de `api_retry`) ; 529 et les autres 5xx la surcharge. Les
 * autres (401, 403, 400…) ne sont pas un épuisement : l'adaptateur et sa
 * réquisition d'identifiants en décident.
 */
function causeDuStatut(statut: unknown): CauseEpuisement | undefined {
  if (statut === null || statut === 502 || statut === 504) return 'injoignable';
  if (typeof statut !== 'number') return undefined;
  if (statut === 429) return 'limite';
  return statut >= 500 ? 'surcharge' : undefined;
}

/**
 * Les fenêtres d'abonnement PARTAGÉES par tous les modèles : « The session and
 * weekly limits are shared across all models, so switching models doesn't
 * restore access » (code.claude.com/docs/en/errors). `five_hour` est la
 * « session limit », `seven_day` la « weekly limit » (table `Uye` du binaire
 * 2.1.289). Les limites d'une famille de modèles (Opus, Sonnet) n'arrêtent pas
 * un agent qui tourne sur une autre : le CLI en décide.
 */
const FENETRES_PARTAGEES = new Set(['five_hour', 'seven_day']);

/**
 * Le rejet d'un appel par le CADRE de Claude Code : le CLI enveloppe ses
 * propres erreurs d'outil (« Error: No such tool available », paramètres
 * invalides, appel annulé…) dans `<tool_use_error>`, et les reconnaît par ce
 * motif (`^\s*<tool_use_error>([\s\S]*)<\/tool_use_error>\s*$`, binaire
 * 2.1.289). Une PERMISSION refusée rend son message sans cette enveloppe :
 * elle s'annonce avant, par `system/permission_denied` (voir
 * `evenementsClaude`). Une commande `Bash` qui sort en 1 rend `is_error` SANS
 * enveloppe ni annonce (« Exit code N » et sa sortie) : la sortie d'une
 * commande, pas un rejet du cadre.
 */
const REJET_DU_CADRE = /^\s*<tool_use_error>[\s\S]*<\/tool_use_error>\s*$/;

function texteDuRetour(contenu: unknown): string {
  if (typeof contenu === 'string') return contenu;
  if (!Array.isArray(contenu)) return '';
  return contenu
    .filter(estObjet)
    .map((b) => chaine(b.text))
    .join('');
}

/**
 * Le stream-json de Claude Code, une ligne. Contrat : les types du SDK
 * (@anthropic-ai/claude-agent-sdk 0.3.289, sdk.d.ts : `SDKAPIRetryMessage`,
 * `SDKBackgroundTasksChangedMessage`, `SDKPermissionDeniedMessage`,
 * `SDKRateLimitEvent`, `SDKResultSuccess.api_error_status`) et les flux
 * enregistrés sur le CLI 2.1.289 (tests/fixtures/enlisement) :
 *
 *   · `assistant` : ses `tool_use` (`parent_tool_use_id` : le sous-agent qui
 *     l'émet), et une RÉPONSE du fournisseur — sauf le message d'erreur que le
 *     CLI synthétise (`is_api_error_message`) ;
 *   · `user` : ses `tool_result` (`is_error`, et `REJET_DU_CADRE`) ;
 *   · `system/permission_denied` : la permission d'un appel refusée
 *     (`tool_use_id`) — émis à la décision, avant son `tool_result` ; en `-p`,
 *     les refus implicites compris. Les refus d'un hook `PreToolUse` ou d'une
 *     règle de chemin n'y sont pas (doc du type) : leur message ne change pas,
 *     la règle de répétition les prend ;
 *   · `system/background_tasks_changed` : l'ensemble des tâches de fond
 *     vivantes, à REMPLACER à chaque message (« a level signal ») ; une tâche
 *     `ambient` n'est pas de l'activité ;
 *   · `system/api_retry` : une RELANCE bornée par le CLI (`max_retries`), sa
 *     cause dans `error_status` ;
 *   · `rate_limit_event` refusé (`status: rejected`, sans dépassement payant
 *     possible — la règle du CLI, `updateRetryAfter` : `!overageStatus ||
 *     overageStatus === "rejected"`) sur une fenêtre partagée : sa remise à
 *     zéro (`resetsAt`, en SECONDES : l'en-tête
 *     `anthropic-ratelimit-unified-reset`, lu `Math.round(Number(…))`) ;
 *   · `result` : l'issue finale — un épuisement quand c'est une erreur d'API
 *     (`is_error`, `api_error_status`).
 */
export function evenementsClaude(ligne: string): EvenementVigie[] {
  const brute = ligne.trim();
  if (!brute.startsWith('{')) return [];
  let lu: unknown;
  try {
    lu = JSON.parse(brute);
  } catch {
    return [];
  }
  if (!estObjet(lu)) return [];
  const blocs = (message: unknown): Objet[] => {
    const contenu = estObjet(message) ? message.content : undefined;
    return Array.isArray(contenu) ? contenu.filter(estObjet) : [];
  };
  switch (lu.type) {
    case 'assistant': {
      const agent = typeof lu.parent_tool_use_id === 'string' ? lu.parent_tool_use_id : PRINCIPAL;
      const appels = blocs(lu.message).flatMap<EvenementVigie>((b) =>
        b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string'
          ? [
              {
                genre: 'appel',
                id: b.id,
                agent,
                outil: b.name,
                empreinte: empreinte(`${b.name}\u0000${jsonStable(b.input)}`),
              },
            ]
          : [],
      );
      return lu.is_api_error_message === true ? appels : [{ genre: 'reponse' }, ...appels];
    }
    case 'user':
      return blocs(lu.message).flatMap<EvenementVigie>((b) =>
        b.type === 'tool_result' && typeof b.tool_use_id === 'string'
          ? [
              {
                genre: 'retour',
                id: b.tool_use_id,
                empreinte: empreinte(jsonStable(b.content)),
                cadre: b.is_error === true && REJET_DU_CADRE.test(texteDuRetour(b.content)),
              },
            ]
          : [],
      );
    case 'system': {
      if (lu.subtype === 'permission_denied' && typeof lu.tool_use_id === 'string') {
        return [{ genre: 'rejet', id: lu.tool_use_id }];
      }
      if (lu.subtype === 'background_tasks_changed') {
        const taches = Array.isArray(lu.tasks) ? lu.tasks.filter(estObjet) : [];
        return [{ genre: 'fond', actif: taches.some((t) => t.ambient !== true) }];
      }
      const cause = lu.subtype === 'api_retry' ? causeDuStatut(lu.error_status) : undefined;
      return cause ? [{ genre: 'relance', cause, bornee: true }] : [];
    }
    case 'rate_limit_event': {
      const info = estObjet(lu.rate_limit_info) ? lu.rate_limit_info : {};
      const bloque =
        info.status === 'rejected' &&
        (info.overageStatus === undefined || info.overageStatus === 'rejected') &&
        FENETRES_PARTAGEES.has(chaine(info.rateLimitType));
      if (!bloque) return [];
      const reset = info.resetsAt;
      const lisible = typeof reset === 'number' && Number.isSafeInteger(reset) && reset > 0;
      return [{ genre: 'limite', ...(lisible ? { remiseA: reset * 1000 } : {}) }];
    }
    case 'result': {
      // `null` n'est pas « sans réponse » ici : un résultat sans statut d'API.
      const statut = lu.is_error === true ? lu.api_error_status : undefined;
      const cause = statut === null ? undefined : causeDuStatut(statut);
      return [cause ? { genre: 'fin', cause } : { genre: 'fin' }];
    }
    default:
      return [];
  }
}

/**
 * Ce que dit une erreur de Codex quand c'est son FOURNISSEUR qui ne sert plus.
 * Les messages sont les `Display` de `CodexErrorDetails` (codex-rs/protocol/src/
 * error.rs, rust-v0.156.0), que `codex exec --json` rend tels quels dans
 * `error.message` et `turn.failed` (exec/src/event_processor_with_jsonl_output.rs)
 * — et, entre parenthèses, derrière chaque « Reconnecting... ». Enregistrés
 * sur le binaire 0.156.0 : tests/fixtures/enlisement/codex-*. Dans l'ordre :
 * un 502 ou un 504 dit une passerelle qui ne joint pas l'amont, avant tout 5xx.
 */
const EPUISEMENTS_CODEX: ReadonlyArray<readonly [RegExp, CauseEpuisement]> = [
  // UsageLimitReached (« You’ve hit your usage limit… », crédits, plafond de dépense)
  [
    /You[’']ve hit your usage limit|Your workspace is out of credits|You hit your spend cap/,
    'limite',
  ],
  // QuotaExceeded ; RetryLimit sur un 429 ; RateLimitExceeded (dans le flux)
  [
    /Quota exceeded\. Check your plan|exceeded retry limit, last status: 429\b|rate limit exceeded: /,
    'limite',
  ],
  // RetryLimit et UnexpectedStatus en 502/504 : la passerelle ne joint pas l'amont
  [/(?:last status:|unexpected status) 50[24]\b/, 'injoignable'],
  // ServerOverloaded ; InternalServerError ; RetryLimit et UnexpectedStatus en 5xx
  [
    /Selected model is at capacity|currently experiencing high demand|last status: 5\d\d\b|unexpected status 5\d\d\b/,
    'surcharge',
  ],
  // ConnectionFailed et l'attente du réseau ; un flux coupé avant sa fin
  [/waiting for network|Connection failed: |stream disconnected before completion/, 'injoignable'],
];

function causeCodex(message: string): CauseEpuisement | undefined {
  return EPUISEMENTS_CODEX.find(([motif]) => motif.test(message))?.[1];
}

/** Un appel de l'agent principal et son retour, lus d'un même événement (Codex). */
const paire = (
  id: string,
  outil: string,
  appel: { empreinte: string; inedit?: true },
  retour: string,
  cadre: boolean,
): EvenementVigie[] => [
  { genre: 'appel', id, agent: PRINCIPAL, outil, ...appel },
  { genre: 'retour', id, empreinte: retour, cadre },
];

/**
 * Un événement de `codex exec --json`, déjà analysé par `flux-codex.ts`.
 * Contrat : `ThreadEvent` (codex-rs/exec/src/exec_events.rs, rust-v0.156.0).
 *
 *   · `command_execution` : la commande, et sa sortie avec son code. Le CADRE
 *     l'a rejetée quand son code vaut -1 : `ToolEventFailure::Message` (statut
 *     `failed`) et `::Rejected` (`declined`), sans processus
 *     (core/src/tools/events.rs) ; une commande lancée qui sort en 1 garde son
 *     code — `ToolEventFailure::Output` ;
 *   · `mcp_tool_call` : serveur, outil, arguments ; résultat, ou `error` — un
 *     appel que le cadre n'a pas pu faire (`McpToolCallItemError`) ;
 *   · `file_change`, `web_search`, `collab_tool_call` : leur contenu n'est PAS
 *     dans le flux (`FileChangeItem` : chemins et genres seulement) — ils ne
 *     se comparent à rien (`inedit`), et comptent comme du progrès. Pas même
 *     par leur identifiant : `WebSearchItem` porte le sien, aplati dans
 *     `ThreadItem` (deux clés `id`), et `JSON.parse` garde le dernier ;
 *   · tout élément terminé est une RÉPONSE du fournisseur ;
 *   · `error` « Reconnecting... » : une RELANCE, quand sa raison est un
 *     épuisement — bornée par Codex quand il dit son compte (« 3/5 ») ; une
 *     autre raison (flux illisible, délai d'une requête) : rien ;
 *   · `turn.completed`, `turn.failed` : l'issue finale.
 */
export function evenementsCodex(e: Objet): EvenementVigie[] {
  if (e.type === 'error') {
    const message = chaine(e.message);
    const cause = message.startsWith('Reconnecting...') ? causeCodex(message) : undefined;
    const bornee = /^Reconnecting\.\.\. \d+\/\d+/.test(message);
    return cause ? [{ genre: 'relance', cause, bornee }] : [];
  }
  if (e.type === 'turn.completed') return [{ genre: 'fin' }];
  if (e.type === 'turn.failed') {
    const cause = causeCodex(chaine(estObjet(e.error) ? e.error.message : undefined));
    return [cause ? { genre: 'fin', cause } : { genre: 'fin' }];
  }
  if (e.type !== 'item.completed' || !estObjet(e.item)) return [];
  const item = e.item;
  const id = chaine(item.id);
  const reponse: EvenementVigie = { genre: 'reponse' };
  if (id === '') return [reponse];
  switch (item.type) {
    case 'command_execution': {
      const retour = `${String(item.exit_code)}\u0000${chaine(item.aggregated_output)}`;
      const appel = { empreinte: empreinte(chaine(item.command)) };
      return [reponse, ...paire(id, 'commande', appel, empreinte(retour), item.exit_code === -1)];
    }
    case 'mcp_tool_call': {
      const outil = `${chaine(item.server)}/${chaine(item.tool)}`;
      const appel = { empreinte: empreinte(`${outil}\u0000${jsonStable(item.arguments)}`) };
      const retour = empreinte(jsonStable(item.result ?? item.error ?? null));
      return [reponse, ...paire(id, outil, appel, retour, item.error != null)];
    }
    case 'file_change':
    case 'web_search':
    case 'collab_tool_call':
      return [reponse, ...paire(id, chaine(item.type), { empreinte: '', inedit: true }, '', false)];
    default:
      return [reponse];
  }
}

// ─── NOTICE ──────────────────────────────────────────────────────────────────
//
// Les règles et les seuils de l'enlisement (`enlise`, `REPETITIONS_ENLISEMENT`,
// `ERREURS_ENLISEMENT`, `OSCILLATION_ENLISEMENT`) sont portés du StuckDetector
// d'OpenHands — `openhands-sdk/openhands/sdk/conversation/stuck_detector.py` et
// `types.py` (`StuckDetectionThresholds`), https://github.com/OpenHands/
// software-agent-sdk, commit b66c724361571aa5c982883173c71b04739b247d.
// Modifications de Hive : appels et retours appariés par l'identifiant que le
// CLI leur donne, un fil par sous-agent, empreintes au lieu des événements ;
// l'`AgentErrorEvent` lu comme le rejet d'un appel par le cadre du CLI
// (`<tool_use_error>` et permission refusée de Claude Code, code -1 de Codex,
// erreur d'un appel MCP) ;
// répétition et oscillation tues pendant du travail de fond ; la « pensée »
// hors de l'égalité d'un appel (idée de `tool_monitor.rs`, goose, Apache-2.0 —
// aucune ligne reprise) ; monologue, erreur de contexte et rappel au 3e rejet
// non portés (voir `enlise`). Sa licence :
//
//   MIT License
//
//   Copyright (c) 2026 OpenHands contributors
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the
//   following conditions:
//
//   The above copyright notice and this permission notice shall be included
//   in all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
//   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//   USE OR OTHER DEALINGS IN THE SOFTWARE.
