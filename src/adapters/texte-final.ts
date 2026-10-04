// La parole finale d'un agent — ce qu'il a RÉPONDU, pas ce qu'il a imprimé.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// La contre-expertise lisait son verdict dans `logs + diff`, le Conseil y
// cherchait ses marqueurs. Or `logs` est la sortie BRUTE du CLI, et sa forme
// dépend de l'agent — jamais de la réponse :
//
//   · Claude Code et Cursor (stream-json) écrivent du JSON par lignes. La
//     réponse est une chaîne ÉCHAPPÉE dans la ligne `{"type":"result"}` : ses
//     retours à la ligne y sont des `\n` littéraux. Aucun marqueur « en début
//     de ligne » n'y survit, aucune objection « - … » n'y est une ligne. Mesuré
//     sur un enregistrement réel (tests/fixtures/texte-final) : deux objections
//     écrites par le relecteur, ZÉRO retenue.
//
//   · Codex (sortie humaine) RÉPÈTE le prompt sur stderr (« user », puis le
//     prompt : codex-rs/exec/src/event_processor_with_human_output.rs:224). Et
//     la consigne de critique contient « valide » ou « conteste » : chaque
//     relecture de Codex était lue « conteste », quoi qu'il ait répondu.
//
// Ce module dit, pour chaque famille de CLI, OÙ vit sa réponse finale — d'après
// le CONTRAT de ce CLI, pas d'après une heuristique sur ses logs.
//
// ─── LES CONTRATS, ET LEUR PREUVE ────────────────────────────────────────────
//
//   · stream-json de Claude Code : la ligne `{"type":"result"}` porte `result`
//     sur un succès, `errors` sur un échec (types `SDKResultSuccess` et
//     `SDKResultError` de @anthropic-ai/claude-agent-sdk 0.3.283, sdk.d.ts).
//
//   · le même, AU SCHÉMA (`--json-schema`, une relecture) : l'avis est l'objet
//     que le modèle remet à l'outil `StructuredOutput` et que le CLI ACCEPTE —
//     `structured_output` n'en garde que le dernier, `result` sa sérialisation
//     (code.claude.com/docs/en/headless, « Get structured output » ; enregistré
//     sur Claude Code 2.1.289 : tests/fixtures/avis-structure). Un modèle qui
//     n'appelle jamais l'outil laisse un `success` SANS `structured_output`, que
//     la documentation dit de traiter en échec (code.claude.com/docs/en/
//     agent-sdk/structured-outputs, « Error handling ») : aucun texte final — la
//     prose n'est jamais lue à la place de l'avis exigé. Un objet hors schéma,
//     le CLI le refuse lui-même, puis échoue en
//     `error_max_structured_output_retries`. Voir `lecteurAvisStreamJson`.
//
//   · stream-json de Cursor : la MÊME ligne `result`, mais PAS le même sens —
//     tout le texte de l'exécution, narration comprise. La réponse est le texte
//     de l'assistant depuis le dernier outil (`lecteurCursor`, binaire
//     cursor-agent 2026.09.02).
//
//   · Cline (`--json`) : la ligne `{"type":"run_result"}` porte `text`
//     (cline/cline, apps/cli/src/runtime/run-agent.ts).
//
//   · Codex et les CLI en texte : la SORTIE STANDARD. Quand stdout n'est pas un
//     terminal, `codex exec` y écrit le dernier message de l'agent et RIEN
//     d'autre ; bannière, prompt, commandes et avertissements partent sur
//     stderr (event_processor_with_human_output.rs:385-420 et 516-522).
//
// Un format que l'on ne reconnaît pas ne rend RIEN. Jamais un texte deviné
// dans les logs : la contre-expertise sait dire « aucun texte final », elle ne
// saurait pas dire « on a lu le mauvais ».
//
// ─── CE QUE CE TEXTE N'EST PAS ───────────────────────────────────────────────
//
// Pas une instruction. Il vient d'un agent, donc d'une sortie de processus non
// fiable : chaque lecteur le traite en DONNÉE (`lireAvis`, `lireProposition`,
// la Couveuse via `blocDonnees`). Et pas un secret de plus : le même texte
// voyageait déjà vers le hub, noyé dans `logs`.

import { ligneAvis } from '../shared/critique-structuree.js';
import { COUPURE_TEXTE_FINAL, LIMITS } from '../shared/protocol.js';

/** Ce qu'on garde du DÉBUT d'un texte trop long : là où la relecture pose son verdict. */
const TETE_GARDEE = 2_000;

/**
 * Borne un texte final : rogné, vide ⇒ absent, et au plus `LIMITS.finalText`
 * caractères — son DÉBUT et sa FIN, la coupe DITE en son milieu.
 *
 * Les deux bouts, parce que les lecteurs ne cherchent pas au même endroit : le
 * Conseil veut son marqueur « en tout dernier », la relecture son verdict EN
 * TÊTE (« valide » ou « conteste », puis une objection par ligne) et son
 * marqueur `HIVE_CRITIQUE` en tout dernier, lui aussi. Ne garder
 * que la fin — la première version de cette fonction — perdait le « conteste »
 * d'une relecture bavarde ; une « entrée valide » dans la prose restante
 * suffisait alors à l'APPROUVER. La coupe est écrite `COUPURE_TEXTE_FINAL` :
 * le hub sait qu'il n'a pas tout lu, et `lireAvis` n'accorde plus de feu vert
 * qu'à un verdict posé en première ligne.
 *
 * Idempotente : un texte déjà borné n'est plus assez long pour être recoupé
 * (le nœud reborne ce que rend un adaptateur, `declarationsDuResultat`).
 */
export function borneTexteFinal(texte: string): string | undefined {
  const t = texte.trim();
  if (t.length <= LIMITS.finalText) return t === '' ? undefined : t;
  const joint = `\n${COUPURE_TEXTE_FINAL}\n`;
  let tete = t.slice(0, TETE_GARDEE);
  let queue = t.slice(-(LIMITS.finalText - TETE_GARDEE - joint.length));
  // Couper au milieu d'une paire de substitution laisserait un demi-caractère
  // de part et d'autre de la coupe : on les retire plutôt que de ranger une
  // chaîne mal formée.
  if (/[\uD800-\uDBFF]$/.test(tete)) tete = tete.slice(0, -1);
  if (/^[\uDC00-\uDFFF]/.test(queue)) queue = queue.slice(1);
  return `${tete.trimEnd()}${joint}${queue.trimStart()}`;
}

/** Reconnaît l'événement FINAL d'un flux JSON par lignes et en rend le texte. */
export type LecteurEvenementFinal = (evenement: Record<string, unknown>) => string | undefined;

/**
 * stream-json de Claude Code : `result` sur un succès, sinon les `errors`
 * déclarés par le CLI. Tout autre événement ne dit rien.
 */
export const texteFinalStreamJson: LecteurEvenementFinal = (e) => {
  if (e.type !== 'result') return undefined;
  if (typeof e.result === 'string') return e.result;
  if (Array.isArray(e.errors)) {
    const erreurs = e.errors.filter((x): x is string => typeof x === 'string');
    if (erreurs.length > 0) return erreurs.join('\n');
  }
  return undefined;
};

/** Les blocs de contenu d'un message `assistant` ou `user` du flux. */
function blocsDe(message: unknown): Record<string, unknown>[] {
  const contenu =
    typeof message === 'object' && message !== null
      ? (message as { content?: unknown }).content
      : undefined;
  return Array.isArray(contenu)
    ? contenu.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
    : [];
}

/**
 * stream-json d'une relecture au schéma (`--json-schema`) : l'avis est l'objet
 * que le modèle remet à l'outil `StructuredOutput` et que le CLI ACCEPTE (son
 * `tool_result` sans `is_error`), écrit en ligne-marqueur (`ligneAvis`).
 *
 * ─── PAS `structured_output` SEUL ───────────────────────────────────────────
 *
 * Deux appels dans une même réponse — un avis qui conteste, puis un qui valide
 * — sont ACCEPTÉS tous les deux, et `structured_output` ne garde que le
 * dernier (enregistré sur 2.1.289 : tests/fixtures/avis-structure/
 * claude-deux-avis.stream.jsonl) : le constat majeur disparaissait sous un
 * « valide ». Chaque objet DISTINCT accepté devient donc sa ligne-marqueur, et
 * plus d'une ligne-marqueur rend l'avis illisible — contesté, et dit : la règle
 * même du marqueur. `structured_output` ne sert qu'à défaut d'appel lu dans le
 * flux ; ceux d'un sous-agent (`parent_tool_use_id`) ne sont pas la réponse.
 *
 * Un succès sans objet ne dit rien (voir l'en-tête) ; un échec garde ses
 * `errors`, où le CLI dit pourquoi. Une FABRIQUE : l'état vit une exécution.
 */
export function lecteurAvisStreamJson(): LecteurEvenementFinal {
  const proposes = new Map<unknown, unknown>();
  // Ordre d'acceptation, un objet par contenu : deux appels identiques sont un avis.
  const acceptes = new Map<string, unknown>();
  return (e) => {
    if (e.parent_tool_use_id) return undefined;
    if (e.type === 'assistant') {
      for (const b of blocsDe(e.message)) {
        if (b.type === 'tool_use' && b.name === 'StructuredOutput') proposes.set(b.id, b.input);
      }
    } else if (e.type === 'user') {
      for (const b of blocsDe(e.message)) {
        if (b.type !== 'tool_result' || b.is_error === true || !proposes.has(b.tool_use_id)) {
          continue;
        }
        const objet = proposes.get(b.tool_use_id);
        acceptes.set(JSON.stringify(objet) ?? '', objet);
      }
    } else if (e.type === 'result') {
      if (acceptes.size > 0) return [...acceptes.values()].map((o) => ligneAvis(o)).join('\n');
      if (e.structured_output !== undefined) return ligneAvis(e.structured_output);
      return e.is_error === true ? texteFinalStreamJson(e) : undefined;
    }
    return undefined;
  };
}

/** Cline (`--json`) : `text` de l'événement `run_result`. */
export const texteFinalCline: LecteurEvenementFinal = (e) =>
  e.type === 'run_result' && typeof e.text === 'string' ? e.text : undefined;

/** Le texte d'un événement `assistant` : ses blocs `text`, dans l'ordre. */
function texteAssistant(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const contenu = (message as { content?: unknown }).content;
  if (!Array.isArray(contenu)) return '';
  let texte = '';
  for (const bloc of contenu as unknown[]) {
    if (typeof bloc !== 'object' || bloc === null) continue;
    const { type, text } = bloc as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof text === 'string') texte += text;
  }
  return texte;
}

/**
 * Cursor (stream-json) : le texte de l'assistant DEPUIS LE DERNIER OUTIL.
 *
 * ─── POURQUOI PAS SA LIGNE `result` ─────────────────────────────────────────
 *
 * Chez Cursor, `result` n'est pas la réponse finale : c'est la concaténation,
 * SANS séparateur, de TOUS les fragments de texte de l'exécution — narration
 * d'avant chaque outil comprise — et en stream-json rien ne la vide, pas même
 * une reprise (binaire cursor-agent 2026.09.02 : `ce += …` à chaque
 * `textDelta`, `result: ce`). Lue telle quelle, un « - je lis auth.ts » devenait
 * une objection, et la narration se collait devant un `HIVE_PROPOSITION`, qui
 * ne commençait plus sa ligne.
 *
 * Ce que Cursor imprime en mode TEXTE, lui, est la réponse : le texte depuis le
 * dernier outil (son tampon `je`, vidé à chaque `toolCallStarted` et à chaque
 * reprise qui n'est pas un « resume »). On le reconstruit depuis le flux :
 * `assistant` ajoute (Cursor y vide son texte avant chaque outil et chaque
 * reprise), `tool_call`/`started` et `retry`/`starting` vident. `result` ne
 * sert qu'à dire « c'est fini » — et ne rend son propre texte que si le flux
 * n'a porté AUCUN événement `assistant` : il n'y a alors rien à découper.
 *
 * Une FABRIQUE : l'état vit le temps d'une exécution. Hive ne passe jamais
 * `--stream-partial-output` (`argvCursor`), sous lequel chaque fragment
 * arriverait deux fois.
 */
export function lecteurCursor(): LecteurEvenementFinal {
  let depuisOutil = '';
  let aParle = false;
  return (e) => {
    if (e.type === 'assistant') {
      aParle = true;
      depuisOutil += texteAssistant(e.message);
    } else if (e.type === 'tool_call' && e.subtype === 'started') {
      depuisOutil = '';
    } else if (e.type === 'retry' && e.subtype === 'starting' && e.is_resume !== true) {
      depuisOutil = '';
    } else if (e.type === 'result') {
      // Vide si l'agent a fini sur un outil : `borneTexteFinal` le rend absent,
      // comme le mode texte de Cursor n'imprime alors rien.
      if (aParle) return depuisOutil;
      return typeof e.result === 'string' ? e.result : undefined;
    }
    return undefined;
  };
}

/**
 * Suit un flux JSON par lignes et garde le DERNIER texte final reconnu.
 *
 * Nourri ligne à ligne, au fil de l'eau : la ligne finale arrive EN DERNIER,
 * c'est-à-dire exactement celle que le plafond de capture des logs (512 ko)
 * coupe sur une longue exécution. Lire le texte final dans `logs` après coup
 * l'aurait perdu sur les tâches qui comptent le plus.
 *
 * Les lignes qui ne sont pas un objet JSON (bannières, avertissements, ligne
 * tronquée) sont ignorées : elles ne déclarent rien.
 */
export function createTexteFinalTracker(lire: LecteurEvenementFinal): {
  feed(line: string): void;
  texte(): string | undefined;
} {
  let dernier: string | undefined;
  return {
    feed(line: string) {
      const brut = line.trim();
      if (!brut.startsWith('{')) return;
      let evenement: unknown;
      try {
        evenement = JSON.parse(brut);
      } catch {
        return; // ligne tronquée ou non JSON : rien n'est déclaré par elle
      }
      if (typeof evenement !== 'object' || evenement === null || Array.isArray(evenement)) return;
      const texte = lire(evenement as Record<string, unknown>);
      if (texte !== undefined) dernier = texte;
    },
    texte: () => (dernier === undefined ? undefined : borneTexteFinal(dernier)),
  };
}
