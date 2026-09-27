// Le flux `codex exec --json`, lu EN ENTIER — une seule lecture par ligne.
//
// ─── POURQUOI CODEX TOURNE EN `--json` ───────────────────────────────────────
//
// En sortie humaine, `codex exec` RÉPÈTE le prompt sur stderr (« user », puis
// la consigne : codex-rs/exec/src/event_processor_with_human_output.rs,
// `print_config_summary`), mêlé à son raisonnement, à ses messages et à la
// sortie de ses commandes. Le nœud classait l'échec sur ce texte : une tâche
// dont la consigne parle d'« API key », de « login » ou de « billing » — ou
// dont l'agent lance un `grep api_key` — échouait-elle sur un 400, c'était une
// « panne d'identifiants ». La tâche partait en réaffectation, une réquisition
// de clé s'ouvrait, et l'échec n'était jamais rendu (enregistré sur le vrai
// binaire : tests/fixtures/flux-codex). Et Codex ne déclarait RIEN à Hive : ni
// jetons, ni coût.
//
// ─── LE CONTRAT (codex-cli 0.156.0, relu dans codex-rs/exec) ─────────────────
//
// stdout ne porte QUE du JSON par lignes, un `ThreadEvent` par ligne (lib.rs :
// « In --json mode, stdout must be valid JSONL » ; exec_events.rs) :
//
//   · `thread.started`, `turn.started` : ouverture, rien à dire ;
//   · `item.started` / `item.updated` / `item.completed` : un élément du tour —
//     `agent_message`, `reasoning`, `command_execution`, `file_change`,
//     `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, et
//     `error`, un AVERTISSEMENT non fatal (le tour continue) ;
//   · `turn.completed` : `usage`, les jetons du fil ENTIER
//     (`usage_from_last_total`) ;
//   · `turn.failed` : `error.message` — le tour a échoué, et c'est SA raison :
//     l'erreur du tour, à défaut la dernière erreur critique
//     (`last_critical_error`) ;
//   · `error` : une erreur SIGNALÉE (event_processor_with_jsonl_output.rs,
//     `ServerNotification::Error`) — y compris les tentatives que Codex va
//     REFAIRE (`will_retry`, que le JSON ne transmet pas) : « Reconnecting...
//     2/5 (unexpected status 429…) » (core/src/responses_retry.rs) précède
//     souvent une réussite, ou un échec d'une tout autre nature.
//
// Le prompt n'y est PAS répété : `print_config_summary` n'émet que
// `thread.started`, et l'élément du message utilisateur n'est pas publié.
// stderr ne garde que les diagnostics (traces de niveau `error`, `Reading
// additional input from stdin...`).
//
// ─── CE QUE CE MODULE EN TIRE ────────────────────────────────────────────────
//
//   · la RÉPONSE FINALE : le dernier `agent_message` terminé d'un tour CONCLU
//     (`turn.completed`) — comme Codex lui-même, qui n'écrit sa réponse
//     (`--output-last-message`) qu'après un tour terminé, et l'efface sur un
//     tour en échec ou interrompu (`final_message = None`) ;
//   · les LOGS : chaque événement rendu lisible, jamais le JSON brut. La
//     narration (raisonnement, messages, commandes et leur sortie, fichiers,
//     outils, plan, avertissements, erreurs signalées, jetons) porte
//     `MARQUE_NARRATION` ; seule la raison de `turn.failed` est écrite en
//     clair. `texteDEchec` — au nœud pour classer l'échec, au hub pour la
//     Couveuse, l'essaim et le Cerveau — ne lit donc que stderr et CETTE
//     raison : plus la consigne, plus la narration, plus un 429 d'une
//     tentative que Codex a refaite avant d'échouer sur autre chose ;
//   · la DÉCLARATION : les jetons de `turn.completed`, et rien d'autre. Codex
//     n'y déclare ni coût, ni temps modèle, ni modèle exact : ces champs
//     restent ABSENTS — l'écran dit « inconnu ». Aucun coût n'est déduit des
//     jetons : Hive n'a pas de grille de prix, et un tarif recopié aujourd'hui
//     serait faux demain.
//
// Un événement d'un type inconnu (une version future) est NOMMÉ dans les logs,
// jamais recopié ni deviné.

import { MARQUE_NARRATION } from '../shared/texte-d-echec.js';
import type { UsageFournisseur } from '../shared/types.js';
import type { LecteurFlux } from './exec.js';
import { borneTexteFinal } from './texte-final.js';

type Objet = Record<string, unknown>;

function objet(v: unknown): Objet | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objet) : undefined;
}

function chaine(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Un compte de jetons lisible : entier positif ou nul, sinon absent. */
function jetons(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
}

/** Un nom venu du flux (type d'événement, statut) : court, sur une ligne. */
function nom(v: unknown): string {
  return chaine(v).replace(/\s+/g, ' ').slice(0, 60) || '?';
}

/**
 * Des lignes de NARRATION, toutes marquées : un corps sur plusieurs lignes —
 * sortie d'une commande, message de l'agent — ne s'échappe jamais de la marque,
 * sans quoi sa deuxième ligne redeviendrait « ce que l'échec dit ».
 */
function narrer(entete: string, corps = ''): string {
  const lignes = corps.replace(/\s+$/, '').split(/\r\n|\r|\n/);
  if (lignes.length === 1 && lignes[0] === '') return `${MARQUE_NARRATION} ${entete}`;
  if (lignes.length === 1) return `${MARQUE_NARRATION} ${entete} : ${lignes[0]}`;
  return [`${MARQUE_NARRATION} ${entete} :`, ...lignes.map((l) => `${MARQUE_NARRATION}   ${l}`)]
    .map((l) => l.trimEnd())
    .join('\n');
}

/**
 * La raison d'un tour en ÉCHEC, en clair et sur UNE ligne : c'est ce que
 * l'échec dit. Sur une ligne, parce que ses lecteurs travaillent par lignes —
 * une suite de message coupée de son en-tête ne dirait plus d'où elle vient.
 */
function raisonDEchec(message: string): string {
  const texte = message.trim().replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ⏎ ');
  return `codex : tour en échec — ${texte || 'sans message'}`;
}

/** Les jetons que `turn.completed` déclare ; absents si le fil n'en a compté aucun. */
function declarationDepuisUsage(usage: unknown): UsageFournisseur | undefined {
  const u = objet(usage);
  if (!u) return undefined;
  const entree = jetons(u.input_tokens);
  const sortie = jetons(u.output_tokens);
  // Sans décompte reçu, Codex rend `Usage::default()` — des ZÉROS
  // (`usage_from_last_total`). Tout appel au modèle consomme des jetons
  // d'entrée : zéro partout veut dire « non compté », pas « gratuit ».
  if (!entree && !sortie) return undefined;
  return {
    source: 'codex',
    ...(entree !== undefined ? { jetonsEntree: entree } : {}),
    ...(sortie !== undefined ? { jetonsSortie: sortie } : {}),
  };
}

/**
 * Les jetons, dits dans les logs. `input_tokens` COMPREND les jetons lus en
 * cache et `output_tokens` ceux du raisonnement (codex-rs/codex-api,
 * `ResponseCompletedUsage` ; le mode humain soustrait le cache pour son
 * « tokens used ») : on dit les deux, sans les additionner.
 */
function direJetons(usage: unknown, declaration: UsageFournisseur | undefined): string {
  const u = objet(usage);
  if (!declaration || !u) return 'aucun jeton déclaré';
  const cache = jetons(u.cached_input_tokens);
  const raisonnement = jetons(u.reasoning_output_tokens);
  const entree = `${declaration.jetonsEntree ?? '?'} en entrée${cache ? ` (dont ${cache} lus en cache)` : ''}`;
  const sortie = `${declaration.jetonsSortie ?? '?'} en sortie${raisonnement ? ` (dont ${raisonnement} de raisonnement)` : ''}`;
  return `jetons déclarés : ${entree} · ${sortie} — coût et temps modèle non déclarés`;
}

const STATUT_COMMANDE: Record<string, string> = {
  completed: 'réussie',
  failed: 'en échec',
  declined: 'refusée',
  in_progress: 'en cours',
};

const GENRE_CHANGEMENT: Record<string, string> = {
  add: 'ajouté',
  delete: 'supprimé',
  update: 'modifié',
};

/** Un élément du tour, rendu ; `undefined` pour une phase qui n'apprend rien. */
function rendreElement(phase: string, item: Objet): string | undefined {
  const type = chaine(item.type);
  const termine = phase === 'item.completed';
  switch (type) {
    case 'agent_message':
      return termine ? narrer('codex', chaine(item.text)) : undefined;
    case 'reasoning':
      return termine ? narrer('raisonnement', chaine(item.text)) : undefined;
    case 'command_execution': {
      const commande = chaine(item.command);
      if (phase === 'item.started') return narrer('commande lancée', commande);
      if (!termine) return undefined;
      const statut = STATUT_COMMANDE[chaine(item.status)] ?? nom(item.status);
      const code = typeof item.exit_code === 'number' ? ` (code ${item.exit_code})` : '';
      return narrer(`commande ${statut}${code} — ${commande}`, chaine(item.aggregated_output));
    }
    case 'file_change': {
      if (!termine) return undefined;
      const changements = Array.isArray(item.changes) ? item.changes : [];
      const lignes = changements
        .map(objet)
        .filter((c): c is Objet => c !== undefined)
        .map((c) => `${GENRE_CHANGEMENT[chaine(c.kind)] ?? nom(c.kind)} ${chaine(c.path)}`);
      const statut = chaine(item.status) === 'completed' ? 'appliqué' : nom(item.status);
      return narrer(`correctif ${statut}`, lignes.join('\n'));
    }
    case 'mcp_tool_call': {
      const outil = `${chaine(item.server)}/${chaine(item.tool)}`;
      if (phase === 'item.started') return narrer('outil MCP lancé', outil);
      if (!termine) return undefined;
      return narrer(`outil MCP ${outil} (${nom(item.status)})`, chaine(objet(item.error)?.message));
    }
    case 'collab_tool_call':
      return phase === 'item.updated'
        ? undefined
        : narrer(`collaboration ${nom(item.tool)} (${nom(item.status)})`);
    case 'web_search':
      return termine ? narrer('recherche web', chaine(item.query)) : undefined;
    case 'todo_list': {
      const etapes = (Array.isArray(item.items) ? item.items : [])
        .map(objet)
        .filter((e): e is Objet => e !== undefined)
        .map((e) => `${e.completed === true ? '✓' : '•'} ${chaine(e.text)}`);
      return narrer('plan', etapes.join('\n'));
    }
    case 'error':
      // Non fatal : Codex continue (`ErrorItem`, « a non-fatal error surfaced
      // as an item ») — un avertissement de l'agent, pas l'échec.
      return termine ? narrer('avertissement', chaine(item.message)) : undefined;
    default:
      return termine ? narrer(`élément codex non reconnu : ${nom(type)}`) : undefined;
  }
}

/** Le lecteur du flux d'UNE exécution `codex exec --json`. */
export interface LecteurFluxCodex extends LecteurFlux {
  /** Les jetons déclarés par le dernier `turn.completed` ; absents sinon. */
  declaration(): UsageFournisseur | undefined;
}

/**
 * Une FABRIQUE : l'état (dernier message, dernière erreur, jetons) vit le temps
 * d'une exécution.
 */
export function createLecteurFluxCodex(): LecteurFluxCodex {
  /** Le dernier message de l'agent, pas encore une réponse : le tour court. */
  let dernierMessage: string | undefined;
  let reponse: string | undefined;
  let declaration: UsageFournisseur | undefined;

  const rendre = (e: Objet): string | undefined => {
    switch (e.type) {
      case 'thread.started':
      case 'turn.started':
        return undefined;
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = objet(e.item);
        if (!item) return narrer(`événement codex sans élément : ${nom(e.type)}`);
        if (e.type === 'item.completed' && item.type === 'agent_message') {
          dernierMessage = chaine(item.text);
        }
        return rendreElement(e.type, item);
      }
      case 'turn.completed':
        reponse = dernierMessage;
        declaration = declarationDepuisUsage(e.usage) ?? declaration;
        return narrer(`tour terminé — ${direJetons(e.usage, declaration)}`);
      case 'turn.failed':
        // Codex efface sa réponse finale sur un tour en échec : ce qu'il avait
        // dit avant n'est pas une conclusion (event_processor_with_jsonl_output.rs).
        dernierMessage = undefined;
        reponse = undefined;
        return raisonDEchec(chaine(objet(e.error)?.message));
      case 'error':
        // Marquée : une tentative refaite n'est pas l'échec. Une erreur qui
        // fait échouer le tour revient, en clair, dans `turn.failed` — le
        // flux enregistré l'y répète mot pour mot. Compromis accepté : une
        // erreur fatale que Codex ne conclurait par AUCUN `turn.failed`
        // resterait narration ; l'écran la montre, le classement l'ignore.
        return narrer('erreur signalée', chaine(e.message));
      default:
        return narrer(`événement codex non reconnu : ${nom(e.type)}`);
    }
  };

  return {
    lire(ligne: string): string | undefined {
      const brute = ligne.trim();
      if (brute === '') return undefined;
      // Hors contrat, stdout n'est que du JSON par lignes ; une ligne en texte
      // est donc un diagnostic égaré — gardée telle quelle, en clair.
      if (!brute.startsWith('{')) return brute;
      let evenement: unknown;
      try {
        evenement = JSON.parse(brute);
      } catch {
        // Ligne tronquée (processus tué au milieu) : dite, jamais recopiée.
        return narrer(`événement codex illisible (${brute.length} caractères)`);
      }
      const e = objet(evenement);
      return e ? rendre(e) : narrer('événement codex illisible');
    },
    texte: () => (reponse === undefined ? undefined : borneTexteFinal(reponse)),
    declaration: () => declaration,
  };
}
