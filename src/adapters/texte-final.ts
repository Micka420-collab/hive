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
//   · stream-json (Claude Code, Cursor) : la ligne `{"type":"result"}` porte
//     `result` sur un succès, `errors` sur un échec (types `SDKResultSuccess`
//     et `SDKResultError` de @anthropic-ai/claude-agent-sdk 0.3.283, sdk.d.ts).
//     Cursor écrit la même ligne, `result` = le texte de l'assistant (binaire
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

import { LIMITS } from '../shared/protocol.js';

/**
 * Borne un texte final : rogné, vide ⇒ absent, et au plus `LIMITS.finalText`
 * caractères — LES DERNIERS.
 *
 * La fin, pas le début : les consignes de la ruche demandent le marqueur « en
 * tout dernier » (Conseil), et c'est à la fin qu'un agent conclut. Un verdict
 * de relecture, lui, est demandé « court » : s'il déborde de 8 000 caractères,
 * perdre son premier mot le rend illisible, donc CONTESTÉ — le défaut sûr.
 */
export function borneTexteFinal(texte: string): string | undefined {
  let t = texte.trim();
  if (t.length > LIMITS.finalText) {
    t = t.slice(-LIMITS.finalText);
    // Couper au milieu d'une paire de substitution laisserait un demi-caractère
    // en tête : on le retire plutôt que de ranger une chaîne mal formée.
    if (/^[\uDC00-\uDFFF]/.test(t)) t = t.slice(1);
    t = t.trimStart();
  }
  return t === '' ? undefined : t;
}

/** Reconnaît l'événement FINAL d'un flux JSON par lignes et en rend le texte. */
export type LecteurEvenementFinal = (evenement: Record<string, unknown>) => string | undefined;

/**
 * stream-json (Claude Code, Cursor) : `result` sur un succès, sinon les
 * `errors` déclarés par le CLI. Tout autre événement ne dit rien.
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

/** Cline (`--json`) : `text` de l'événement `run_result`. */
export const texteFinalCline: LecteurEvenementFinal = (e) =>
  e.type === 'run_result' && typeof e.text === 'string' ? e.text : undefined;

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
