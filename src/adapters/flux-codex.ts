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
//     souvent une réussite, ou un échec d'une tout autre nature. Une erreur
//     NON refaite fait sortir `codex exec` en 1 (lib.rs, `error_seen`) MÊME
//     si le tour se conclut ensuite par `turn.completed` : sans `turn.failed`,
//     c'est alors elle, la raison de l'échec ;
//   · RIEN du tout pour un tour INTERROMPU : `codex exec` sort en 1
//     (`error_seen`, lib.rs) sans `turn.completed` ni `turn.failed`
//     (event_processor_with_jsonl_output.rs, `TurnStatus::Interrupted`). Et
//     `error_seen` se lève aussi sur une requête du serveur que l'exécution
//     n'a pas su traiter (`handle_server_request`) — un `warn!` sur stderr,
//     aucun événement.
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
//     tour en échec ou interrompu (`final_message = None`). Codex se rabat,
//     faute de message, sur le texte d'un élément `Plan` : un élément du mode
//     plan (core/src/session/turn.rs, `ModeKind::Plan`), que `codex exec`
//     n'active pas (`collaboration_mode: None`) et que le flux JSON ne publie
//     même pas (`map_item_with_id`) — rien à reproduire ici. Pour une relecture
//     au schéma (`--output-schema`), ce message EST l'avis : « a JSON string
//     when structured output is requested » (exec_events.rs,
//     `AgentMessageItem`), écrit en ligne-marqueur AVANT d'être borné — ou,
//     d'un fournisseur qui n'a pas tenu le schéma, lu tel quel s'il porte sa
//     ligne `HIVE_CRITIQUE` (`reponseAuSchema`, `horsSchema`) ;
//   · les LOGS : chaque événement rendu lisible, jamais le JSON brut. TOUTE
//     ligne de narration (raisonnement, messages, commandes et leur sortie,
//     fichiers, outils, plan, avertissements, erreurs signalées, jetons) porte
//     `MARQUE_NARRATION` — en-tête compris : une commande en heredoc met ses
//     retours à la ligne jusque dans l'en-tête ;
//   · le BILAN (`bilan`) : ce que l'échec dit, en clair, sur une ligne — la
//     raison de `turn.failed`, l'erreur non refaite d'un tour pourtant
//     conclu, ou, faute de raison dans le flux, CE QUI s'est passé (sortie
//     sans conclusion, sans événement, après un tour conclu, tour conclu
//     sans que rien ne s'écrive sous le bac de Codex). Jamais rien :
//     sans bilan, ce que l'échec dit tombait sur la bannière de stderr
//     (« Reading additional input from stdin... »), la même pour TOUS les
//     échecs de Codex — une signature commune, et trois nœuds suffisent à en
//     faire une leçon « systémique » (orchestrator/essaim.ts). L'exécuteur l'écrit APRÈS le plafond des logs (exec.ts) : une
//     narration de 512 ko ne la pousse plus hors du journal. `texteDEchec` —
//     au nœud pour classer l'échec, au hub pour la Couveuse, l'essaim et le
//     Cerveau — ne lit donc que stderr et CE bilan : plus la consigne, plus la
//     narration, plus la réponse de l'agent, plus un 429 d'une tentative que
//     Codex a refaite avant d'échouer sur autre chose ;
//   · la DÉCLARATION : les jetons de `turn.completed`, et rien d'autre. Codex
//     n'y déclare ni coût, ni temps modèle, ni modèle exact : ces champs
//     restent ABSENTS — l'écran dit « inconnu ». Aucun coût n'est déduit des
//     jetons : Hive n'a pas de grille de prix, et un tarif recopié aujourd'hui
//     serait faux demain.
//
// Un événement d'un type inconnu (une version future) est NOMMÉ dans les logs,
// jamais recopié ni deviné. Un flux qui sort en 0 sans AUCUN `turn.completed`
// n'est pas le dialecte attendu (un codex-cli d'une autre époque) : c'est un
// échec dit, jamais une réussite muette sans réponse ni jetons. Il n'est PAS
// déclaré « infra » : le nœud n'a qu'un motif de réaffectation, « auth/quota »
// (node-client/client.ts), qui mentirait — le bilan nomme la version attendue,
// et c'est l'opérateur du nœud qui met codex à jour.

import { reponseAuSchema } from '../shared/critique-structuree.js';
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

const FIN_DE_LIGNE = /\r\n|\r|\n/;

/**
 * Des lignes de NARRATION, TOUTES marquées : un texte sur plusieurs lignes —
 * sortie d'une commande, message de l'agent, et jusqu'à l'EN-TÊTE, qui porte
 * la commande lancée — ne s'échappe jamais de la marque, sans quoi sa deuxième
 * ligne redeviendrait « ce que l'échec dit ». Une commande en heredoc
 * (`python3 - <<'PY'`, que Codex joint par `shlex_join` en gardant ses retours
 * à la ligne) qui parlait d'`api_key` refaisait ainsi d'un 400 une panne
 * d'identifiants. La règle vit ICI, pas chez chaque appelant.
 */
function narrer(entete: string, corps = ''): string {
  const [tete = '', ...suiteTete] = entete.trim().split(FIN_DE_LIGNE);
  const texteCorps = corps.replace(/\s+$/, '');
  const suite = [...suiteTete, ...(texteCorps === '' ? [] : texteCorps.split(FIN_DE_LIGNE))];
  if (suite.length === 0) return `${MARQUE_NARRATION} ${tete}`;
  if (suite.length === 1 && suiteTete.length === 0) {
    return `${MARQUE_NARRATION} ${tete} : ${suite[0]}`;
  }
  return [`${MARQUE_NARRATION} ${tete} :`, ...suite.map((l) => `${MARQUE_NARRATION}   ${l}`)]
    .map((l) => l.trimEnd())
    .join('\n');
}

/** Un message d'échec tient en une phrase ; au-delà, c'est un corps recopié. */
const RAISON_MAX = 2_000;

/**
 * La raison d'un tour en ÉCHEC, en clair et sur UNE ligne : c'est ce que
 * l'échec dit. Sur une ligne, parce que ses lecteurs travaillent par lignes —
 * une suite de message coupée de son en-tête ne dirait plus d'où elle vient.
 */
function raisonDEchec(genre: string, message: string): string {
  const texte = message
    .trim()
    .replace(/\s*(?:\r\n|\r|\n)\s*/g, ' ⏎ ')
    .slice(0, RAISON_MAX);
  return `codex : ${genre} — ${texte || 'sans message'}`;
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
      // Le plan à son ouverture et à sa clôture : chaque `item.updated` le
      // répète en entier, du bruit qui mangeait le plafond des logs.
      if (phase === 'item.updated') return undefined;
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
  /**
   * Relecture au schéma dont la réponse est venue en TEXTE, ligne-marqueur
   * comprise : le fournisseur n'a pas tenu `--output-schema` — l'adaptateur le
   * dit au journal (`reponseAuSchema`).
   */
  horsSchema(): boolean;
}

const DIALECTE_INCONNU =
  'codex : flux `--json` sans aucun `turn.completed` ni `turn.failed` — dialecte non reconnu (codex-cli 0.156.0 ou plus récent attendu)';

/**
 * Un tour CONCLU où RIEN n'a pu s'exécuter sous le bac de Codex : aucun
 * correctif appliqué — au moins un tenté, en échec — et aucune commande
 * réussie.
 *
 * ─── SORTIE EN 0, ET RIEN D'ÉCRIT ────────────────────────────────────────────
 *
 * Quand le bac de Codex ne démarre pas (bubblewrap sans espace de noms :
 * openai/codex#46246), chaque correctif sort `file_change` en `failed`, le
 * modèle conclut qu'il n'a rien pu faire, et `codex exec` sort en 0 —
 * enregistré sur le vrai binaire (tests/fixtures/flux-codex/bac-casse.*). Sans
 * ce bilan, c'était une réussite au diff vide.
 *
 * ─── UN CORRECTIF RATÉ DANS UN BAC SAIN N'EST PAS CETTE PANNE ────────────────
 *
 * Un correctif échoue aussi dans un bac qui marche — un fichier là où il
 * fallait un dossier, un fichier en lecture seule — et le modèle se rattrape
 * par une commande (`printf … > f`) : enregistré sur le vrai binaire
 * (tests/fixtures/flux-codex/rattrape-*). Le bac cassé, lui, fait échouer
 * TOUTES les commandes (bubblewrap ne démarre pour aucune) : une seule
 * commande réussie suffit donc à lever le doute, comme un seul correctif
 * appliqué. Une relecture n'en tente aucun : elle n'y passe jamais.
 *
 * Ne vaut que sous `--sandbox workspace-write` (`bacCodexEnEcriture`) : dans
 * le bac de Hive, Codex n'a pas de bac à lui qui puisse casser.
 */
function rienNAPuSEcrire(enEchec: number): string {
  return `codex : échec — tour conclu sans que rien ne s'écrive (${enEchec} correctif(s) en échec, aucun appliqué, aucune commande réussie) : le bac de Codex n'a rien laissé faire, rien n'a été produit`;
}

/**
 * Le préfixe des erreurs que Codex va REFAIRE. Toute `error` à `will_retry`
 * naît d'un `EventMsg::StreamError` (app-server bespoke_event_handling.rs), et
 * ses seuls émetteurs (`notify_stream_error` : core/src/responses_retry.rs,
 * core/src/compact.rs) écrivent « Reconnecting... ». Le JSON taisant
 * `will_retry`, c'est le seul signe : sans lui, un 429 réessayé puis réussi
 * devenait la raison d'une sortie en 1 — et une panne d'infra.
 */
const TENTATIVE_REFAITE = 'Reconnecting...';

/**
 * Une FABRIQUE : l'état (dernier message, dernière erreur, jetons) vit le temps
 * d'une exécution.
 *
 * `bacCodexEnEcriture` : Codex tourne sous son propre bac, en écriture
 * (`--sandbox workspace-write`) — seul cas où `rienNAPuSEcrire` a un sens.
 * `avisAuSchema` : une relecture lancée avec `--output-schema` — la réponse
 * finale est l'avis structuré (voir l'en-tête).
 */
export function createLecteurFluxCodex(
  opts: { bacCodexEnEcriture?: boolean; avisAuSchema?: boolean } = {},
): LecteurFluxCodex {
  /** Le dernier message de l'agent, pas encore une réponse : le tour court. */
  let dernierMessage: string | undefined;
  let reponse: string | undefined;
  let declaration: UsageFournisseur | undefined;
  /** Le tour s'est-il conclu, et comment : c'est ce qui fonde le bilan. */
  let fin: 'conclu' | 'echec' | undefined;
  let raisonDuTour: string | undefined;
  /** La dernière erreur SIGNALÉE (`error`) que Codex ne refait pas. */
  let derniereErreur: string | undefined;
  /** Un événement au moins a-t-il été lu : sinon, pas de `--json` du tout. */
  let fluxLu = false;
  /** Les correctifs (`file_change`) terminés, appliqués ou en échec. */
  let correctifsAppliques = 0;
  let correctifsEnEchec = 0;
  /** Les commandes terminées en code 0 : le bac de Codex a démarré. */
  let commandesReussies = 0;

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
        if (e.type === 'item.completed' && item.type === 'file_change') {
          if (item.status === 'completed') correctifsAppliques += 1;
          if (item.status === 'failed') correctifsEnEchec += 1;
        }
        if (
          e.type === 'item.completed' &&
          item.type === 'command_execution' &&
          item.exit_code === 0
        ) {
          commandesReussies += 1;
        }
        return rendreElement(e.type, item);
      }
      case 'turn.completed':
        fin = 'conclu';
        reponse = dernierMessage;
        declaration = declarationDepuisUsage(e.usage) ?? declaration;
        return narrer(`tour terminé — ${direJetons(e.usage, declaration)}`);
      case 'turn.failed':
        // Codex efface sa réponse finale sur un tour en échec : ce qu'il avait
        // dit avant n'est pas une conclusion (event_processor_with_jsonl_output.rs).
        dernierMessage = undefined;
        reponse = undefined;
        fin = 'echec';
        raisonDuTour = chaine(objet(e.error)?.message);
        // Rien ici : le bilan l'écrit, en clair, après le plafond des logs.
        return undefined;
      case 'error': {
        // Marquée : une tentative refaite n'est pas l'échec. Une erreur qui
        // fait échouer le tour revient dans `turn.failed` ; une erreur non
        // refaite d'un tour CONCLU (sortie en 1 malgré tout) revient par le
        // bilan — jamais une tentative (`TENTATIVE_REFAITE`).
        const message = chaine(e.message);
        if (!message.startsWith(TENTATIVE_REFAITE)) derniereErreur = message;
        return narrer('erreur signalée', message);
      }
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
      if (!e) return narrer('événement codex illisible');
      fluxLu = true;
      return rendre(e);
    },
    // Un message vide reste ABSENT, schéma ou non : un avis qui manque n'est
    // pas un avis illisible.
    texte: () =>
      reponse === undefined || reponse.trim() === ''
        ? undefined
        : borneTexteFinal(opts.avisAuSchema ? reponseAuSchema(reponse).texte : reponse),
    bilan(code: number | null, arreteParHive: boolean): string | undefined {
      if (fin === 'echec') return raisonDEchec('tour en échec', raisonDuTour ?? '');
      if (code === 0) {
        if (fin !== 'conclu') return DIALECTE_INCONNU;
        const rien =
          opts.bacCodexEnEcriture === true &&
          correctifsEnEchec > 0 &&
          correctifsAppliques === 0 &&
          commandesReussies === 0;
        return rien ? rienNAPuSEcrire(correctifsEnEchec) : undefined;
      }
      // Arrêté par Hive (délai de garde, annulation) : le marqueur `[hive]`
      // dit déjà pourquoi, et ses dernières erreurs n'étaient peut-être que
      // des tentatives.
      if (arreteParHive) return undefined;
      // Un tour conclu, et pourtant une sortie en échec : l'erreur non refaite
      // que Codex a vue (`error_seen`).
      if (fin === 'conclu' && derniereErreur !== undefined) {
        return raisonDEchec('erreur signalée', derniereErreur);
      }
      // Faute de raison dans le flux, on dit ce qui s'est PASSÉ — jamais une
      // erreur devinée, et jamais le silence (en-tête : la bannière de stderr
      // devenait la signature de tous ces échecs). Mots choisis hors de
      // `INFRA_FAILURE_RE` : ce n'est pas une panne d'identifiants.
      const sortie = code === null ? 'arrêté par un signal' : `sortie en code ${code}`;
      if (fin === 'conclu') {
        return `codex : échec — ${sortie} après un tour conclu, sans erreur non refaite dans le flux (raison non déclarée, voir stderr)`;
      }
      if (!fluxLu) {
        return `codex : échec — ${sortie} sans aucun événement \`--json\` (codex-cli trop ancien pour \`--json\`, ou lancement en échec : voir stderr)`;
      }
      return `codex : échec — ${sortie} sans que le tour se conclue (ni \`turn.completed\` ni \`turn.failed\` : tour interrompu)`;
    },
    declaration: () => declaration,
    horsSchema: () =>
      opts.avisAuSchema === true && reponse !== undefined && reponseAuSchema(reponse).horsSchema,
  };
}
