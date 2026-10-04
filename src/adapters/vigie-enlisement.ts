// LA VIGIE (G13) — un agent qui tourne en rond, ou un fournisseur qui ne sert
// plus, vus PENDANT l'exécution. Détecteur pur, côté nœud, à état borné.
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
// son propre fil), une relance du CLI vers son fournisseur et la réponse qui
// la clôt, un épuisement déclaré. Une lecture par famille les en tire :
// `evenementsClaude` (stream-json), `evenementsCodex` (`codex exec --json`).
// Les autres familles n'ont pas de flux d'outils structuré que Hive lise
// (Cursor : son `tool_call` n'est pas enregistré ; Cline, Grok, Hermes, sur
// mesure : du texte) — la vigie ne les couvre pas, et ne devine rien d'eux.
//
// ─── CE QU'ELLE REND ─────────────────────────────────────────────────────────
//
// Un `ArretVigie` (shared/enlisement.ts), une fois : `enlisement` (compté comme
// un échec du modèle) ou `epuisement_fournisseur` (une panne d'infrastructure).
// Elle ne tue rien : l'adaptateur le dit au nœud (`AdapterProgress.arret`), qui
// arrête par le geste de l'annulation et du budget de durée (`ctrl.abort`).

import { createHash } from 'node:crypto';
import type { ArretVigie, CauseEpuisement, Enlisement } from '../shared/enlisement.js';
import type { AdapterResult } from './index.js';

// ─── LES SEUILS, PORTÉS D'OPENHANDS ──────────────────────────────────────────
//
// `StuckDetectionThresholds` (openhands-sdk/openhands/sdk/conversation/types.py,
// défauts relus au commit b66c7243 de OpenHands/software-agent-sdk) — les seuils
// d'un détecteur qui ARRÊTE déjà des agents en production, pas des chiffres
// choisis ici. Chaque règle exige que TOUT se répète — l'appel (outil et
// arguments) et, sauf pour les erreurs, son retour : un agent qui progresse
// (un fichier écrit autrement, des tests dont la sortie change) casse la
// répétition, et n'est jamais déclaré enlisé.

/** `action_observation` = 4 : même appel, même retour, quatre fois de suite. */
export const REPETITIONS_ENLISEMENT = 4;
/** `action_error` = 3, enlisé AU-DELÀ (`streak > threshold`) : même appel en échec, 4 fois. */
export const ERREURS_ENLISEMENT = 4;
/** `alternating_pattern` = 6 : A→B→A→B→A→B, appels et retours. */
export const OSCILLATION_ENLISEMENT = 6;

/**
 * Les relances BORNÉES par défaut de chaque CLI — au-delà, ce n'est plus une
 * relance que le fournisseur a décidée, c'est une attente sans fin.
 *
 *   · Claude Code : `CLAUDE_CODE_MAX_RETRIES`, 10 par défaut (code.claude.com/
 *     docs/en/errors, « Tune retry behavior ») — enregistré sur 2.1.289 :
 *     `max_retries: 10` à chaque `api_retry`, puis l'échec. Sous
 *     `CLAUDE_CODE_RETRY_WATCHDOG=1`, `max_retries: 300`, « roughly three
 *     hours of backoff » : sans la vigie, le délai dur, puis « timeout » ;
 *   · Codex : `DEFAULT_STREAM_MAX_RETRIES` = 5 (codex-rs/model-provider-info/
 *     src/lib.rs, rust-v0.156.0) — « Reconnecting... 5/5 », puis l'échec. Son
 *     attente du réseau, elle, n'a pas de borne (core/src/responses_retry.rs).
 *
 * Hive ne devance donc JAMAIS la décision par défaut du CLI : il borne ce que
 * le CLI ne borne plus, et range l'issue qu'il rend.
 */
export const RELANCES_BORNEES_CLAUDE = 10;
export const RELANCES_BORNEES_CODEX = 5;

/** Appels sans retour gardés au plus (outils en vol, sous-agents compris). */
const APPELS_EN_VOL_MAX = 64;
/** Fils suivis au plus : l'agent principal et ses sous-agents (`LIMITS.subAgents` = 32). */
const FILS_MAX = 33;
/** Le fil de l'agent principal. */
const PRINCIPAL = 'principal';

/**
 * Ce que la vigie lit du flux.
 *
 * `fin` : l'erreur FINALE que le CLI déclare (ligne `result`, `turn.failed`) —
 * le CLI s'arrête de lui-même, la vigie ne range que l'issue ; `epuise` : un
 * épuisement déclaré EN VOL (une limite d'abonnement atteinte).
 */
export type EvenementVigie =
  | { genre: 'appel'; id: string; agent: string; outil: string; empreinte: string }
  | { genre: 'retour'; id: string; empreinte: string; erreur: boolean }
  | { genre: 'relance'; cause: CauseEpuisement; tentative?: number }
  | { genre: 'reponse' }
  | { genre: 'epuise' | 'fin'; cause: CauseEpuisement; remiseA?: number };

export interface Vigie {
  /** L'arrêt que cet événement décide — rendu UNE fois, puis plus rien. */
  observer(e: EvenementVigie): ArretVigie | undefined;
}

/** Un appel apparié à son retour : ce que les règles comparent. */
interface Paire {
  appel: string;
  retour: string;
  erreur: boolean;
  outil: string;
}

/**
 * Les règles d'OpenHands (`StuckDetector.is_stuck`), dans son ordre, sur les
 * derniers appels d'UN fil :
 *
 *   1. même appel, même retour (`_is_stuck_repeating_action_observation`) ;
 *   2. même appel, en échec à chaque fois (`_is_stuck_repeating_action_error`) ;
 *   4. deux appels alternés, retours compris (`_is_stuck_alternating_action_observation`).
 *
 * Non portés, et pourquoi : le monologue (3 — des messages de l'agent sans
 * action ; sans terminal, `claude -p` et `codex exec` CONCLUENT le tour sur une
 * réponse sans appel d'outil : il ne peut pas se répéter), l'erreur de
 * contexte (5 — `return False` chez OpenHands, en attente). L'égalité d'un
 * appel est celle de goose (`tool_monitor.rs` : nom ET arguments) : la
 * « pensée » qu'OpenHands compare aussi n'est pas dans l'appel du flux.
 */
function enlise(fil: readonly Paire[]): Enlisement | undefined {
  const dernier = fil.at(-1);
  if (!dernier) return undefined;
  const fin = (n: number): readonly Paire[] => (fil.length >= n ? fil.slice(-n) : []);
  const memePaire = (a: Paire, b: Paire): boolean => a.appel === b.appel && a.retour === b.retour;
  const { outil } = dernier;
  const repetes = fin(REPETITIONS_ENLISEMENT);
  if (repetes.length > 0 && repetes.every((p) => memePaire(p, dernier))) {
    return { motif: 'repetition', fois: REPETITIONS_ENLISEMENT, outil };
  }
  const echecs = fin(ERREURS_ENLISEMENT);
  if (echecs.length > 0 && echecs.every((p) => p.erreur && p.appel === dernier.appel)) {
    return { motif: 'erreurs', fois: ERREURS_ENLISEMENT, outil };
  }
  const alterne = fin(OSCILLATION_ENLISEMENT);
  if (alterne.length > 0 && alterne.every((p, i) => i < 2 || memePaire(p, alterne[i - 2]!))) {
    return { motif: 'oscillation', fois: OSCILLATION_ENLISEMENT, outil };
  }
  return undefined;
}

/**
 * La vigie d'UNE exécution. `relancesBornees` : la borne par défaut du CLI
 * (`RELANCES_BORNEES_CLAUDE`, `RELANCES_BORNEES_CODEX`).
 */
export function createVigie(relancesBornees: number): Vigie {
  const enVol = new Map<string, { agent: string; outil: string; empreinte: string }>();
  const fils = new Map<string, Paire[]>();
  let relances = 0;
  let rendu = false;
  const arreter = (arret: ArretVigie): ArretVigie => {
    rendu = true;
    return arret;
  };
  return {
    observer(e) {
      if (rendu) return undefined;
      switch (e.genre) {
        case 'appel': {
          enVol.set(e.id, { agent: e.agent, outil: e.outil, empreinte: e.empreinte });
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
            erreur: e.erreur,
            outil: appel.outil,
          });
          if (fil.length > OSCILLATION_ENLISEMENT) fil.shift();
          const enlisement = enlise(fil);
          return enlisement ? arreter({ issue: 'enlisement', ...enlisement }) : undefined;
        }
        case 'reponse':
          relances = 0;
          return undefined;
        case 'relance':
          // Le compte DÉCLARÉ par le CLI quand il en donne un : sous le chien de
          // garde, Claude Code redit la même tentative toutes les 30 s d'attente.
          relances = e.tentative ?? relances + 1;
          return relances > relancesBornees
            ? arreter({ issue: 'epuisement_fournisseur', cause: e.cause })
            : undefined;
        case 'epuise':
        case 'fin':
          return arreter({
            issue: 'epuisement_fournisseur',
            cause: e.cause,
            ...(e.remiseA !== undefined ? { remiseA: e.remiseA } : {}),
          });
      }
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

/** Un appel de l'agent principal et son retour, lus d'un même événement (Codex). */
const paire = (
  id: string,
  outil: string,
  appel: string,
  retour: string,
  erreur: boolean,
): EvenementVigie[] => [
  { genre: 'appel', id, agent: PRINCIPAL, outil, empreinte: appel },
  { genre: 'retour', id, empreinte: retour, erreur },
];

/**
 * Le statut HTTP d'une erreur d'API Claude, en cause d'épuisement : 429 la
 * limite, 529 et 5xx la surcharge, `null` (« no HTTP response », doc de
 * `api_retry`) l'absence de réponse. Les autres (401, 403, 400…) ne sont pas
 * un épuisement : l'adaptateur et sa réquisition d'identifiants en décident.
 */
function causeDuStatut(statut: unknown): CauseEpuisement | undefined {
  if (statut === null) return 'injoignable';
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
 * Le stream-json de Claude Code, une ligne. Contrat : les types du SDK
 * (@anthropic-ai/claude-agent-sdk 0.3.289, sdk.d.ts : `SDKAPIRetryMessage`,
 * `SDKRateLimitEvent`, `SDKResultSuccess.api_error_status`) et les flux
 * enregistrés sur le CLI 2.1.289 (tests/fixtures/enlisement) :
 *
 *   · `assistant` : ses `tool_use` (`parent_tool_use_id` : le sous-agent qui
 *     l'émet), et une RÉPONSE du fournisseur — sauf le message d'erreur que le
 *     CLI synthétise (`is_api_error_message`) ;
 *   · `user` : ses `tool_result` (`is_error`) ;
 *   · `system/api_retry` : une RELANCE, sa cause dans `error_status` ;
 *   · `rate_limit_event` refusé (`status: rejected`, sans dépassement payant
 *     possible — la règle du CLI, `updateRetryAfter` : `!overageStatus ||
 *     overageStatus === "rejected"`) sur une fenêtre partagée : épuisé, avec
 *     sa remise à zéro (`resetsAt`, en SECONDES : l'en-tête
 *     `anthropic-ratelimit-unified-reset`, lu `Math.round(Number(…))`) ;
 *   · `result` en erreur d'API (`is_error`, `api_error_status`) : l'issue finale.
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
                erreur: b.is_error === true,
              },
            ]
          : [],
      );
    case 'system': {
      const cause = lu.subtype === 'api_retry' ? causeDuStatut(lu.error_status) : undefined;
      const tentative = typeof lu.attempt === 'number' ? { tentative: lu.attempt } : {};
      return cause ? [{ genre: 'relance', cause, ...tentative }] : [];
    }
    case 'rate_limit_event': {
      const info = estObjet(lu.rate_limit_info) ? lu.rate_limit_info : {};
      const bloque =
        info.status === 'rejected' &&
        (info.overageStatus === undefined || info.overageStatus === 'rejected') &&
        FENETRES_PARTAGEES.has(chaine(info.rateLimitType));
      if (!bloque) return [];
      const reset = info.resetsAt;
      const remiseA =
        typeof reset === 'number' && Number.isSafeInteger(reset) && reset > 0
          ? reset * 1000
          : undefined;
      return [{ genre: 'epuise', cause: 'limite', ...(remiseA !== undefined ? { remiseA } : {}) }];
    }
    case 'result': {
      // `null` n'est pas « sans réponse » ici : un résultat sans statut d'API.
      const cause =
        lu.is_error === true && lu.api_error_status !== null
          ? causeDuStatut(lu.api_error_status)
          : undefined;
      return cause ? [{ genre: 'fin', cause }] : [];
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
 * sur le binaire 0.156.0 : tests/fixtures/enlisement/codex-*.
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

/**
 * Un événement de `codex exec --json`, déjà analysé par `flux-codex.ts`.
 * Contrat : `ThreadEvent` (codex-rs/exec/src/exec_events.rs, rust-v0.156.0).
 *
 *   · `command_execution` : la commande, et sa sortie avec son code ;
 *   · `mcp_tool_call` : serveur, outil, arguments ; résultat ou erreur ;
 *   · `file_change`, `web_search`, `collab_tool_call` : leur contenu n'est PAS
 *     dans le flux (`FileChangeItem` : chemins et genres seulement) — ils ne
 *     se comparent à rien, et comptent comme du progrès ;
 *   · tout élément terminé est une RÉPONSE du fournisseur ;
 *   · `error` « Reconnecting... » : une RELANCE (`TENTATIVE_REFAITE`), quand
 *     sa raison est un épuisement — une autre (flux illisible, délai d'une
 *     requête) reste bornée par Codex lui-même, et la vigie n'en compte rien ;
 *   · `turn.failed` : l'issue finale, quand sa raison est un épuisement.
 */
export function evenementsCodex(e: Objet): EvenementVigie[] {
  if (e.type === 'error') {
    const message = chaine(e.message);
    const cause = message.startsWith('Reconnecting...') ? causeCodex(message) : undefined;
    // « Reconnecting... 3/5 » dit son compte ; l'attente du réseau, non.
    const compte = /^Reconnecting\.\.\. (\d+)\//.exec(message)?.[1];
    return cause
      ? [{ genre: 'relance', cause, ...(compte ? { tentative: Number(compte) } : {}) }]
      : [];
  }
  if (e.type === 'turn.failed') {
    const cause = causeCodex(chaine(estObjet(e.error) ? e.error.message : undefined));
    return cause ? [{ genre: 'fin', cause }] : [];
  }
  if (e.type !== 'item.completed' || !estObjet(e.item)) return [];
  const item = e.item;
  const id = chaine(item.id);
  const reponse: EvenementVigie = { genre: 'reponse' };
  if (id === '') return [reponse];
  switch (item.type) {
    case 'command_execution': {
      const retour = `${String(item.exit_code)}\u0000${chaine(item.aggregated_output)}`;
      const erreur = item.status !== 'completed' || item.exit_code !== 0;
      const commande = empreinte(chaine(item.command));
      return [reponse, ...paire(id, 'commande', commande, empreinte(retour), erreur)];
    }
    case 'mcp_tool_call': {
      const outil = `${chaine(item.server)}/${chaine(item.tool)}`;
      const appel = empreinte(`${outil}\u0000${jsonStable(item.arguments)}`);
      const retour = empreinte(jsonStable(item.result ?? item.error ?? null));
      const erreur = item.status === 'failed' || item.error != null;
      return [reponse, ...paire(id, outil, appel, retour, erreur)];
    }
    case 'file_change':
    case 'web_search':
    case 'collab_tool_call':
      // Leur contenu n'est pas dans le flux : un appel qui ne se compare à RIEN.
      return [reponse, ...paire(id, chaine(item.type), `inedit:${id}`, `inedit:${id}`, false)];
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
// CLI leur donne, un fil par sous-agent, empreintes au lieu des événements, la
// « pensée » hors de l'égalité d'un appel (idée de `tool_monitor.rs`, goose,
// Apache-2.0 — aucune ligne reprise), monologue et erreur de contexte non
// portés (voir `enlise`). Sa licence :
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
