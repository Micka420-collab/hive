// Ce qu'un échec DIT — lu par le nœud (échec d'infrastructure ?) et par le hub
// (Couveuse, signatures de l'essaim, épisodes du Cerveau).
//
// ─── POURQUOI CE MODULE EST PARTAGÉ ──────────────────────────────────────────
//
// La règle vivait dans orchestrator/brood.ts, que le nœud ne peut pas importer.
// Le nœud classait donc ses échecs sur les logs BRUTS — et la ligne `init` du
// stream-json de Claude Code (comme celle de Cursor) porte toujours la clé
// `"apiKeySource"`, que `api[_ -]?key` reconnaît. Mesuré avec Claude Code
// 2.1.283 contre un faux serveur rendant un 400 : TOUT échec de Claude Code
// était lu « auth/quota ». Le nœud ouvrait une réquisition d'identifiants, ou
// réaffectait la tâche, et n'envoyait jamais de résultat en échec : la
// Couveuse, les signatures et le Cerveau, que ce contrat répare, ne recevaient
// RIEN. Une seule règle, lue des deux côtés, ferme ce trou.

// Séquences d'échappement ANSI (couleurs, curseur…) : bruit de terminal qui
// n'apprend rien à personne — retirées avant toute analyse.
// eslint-disable-next-line no-control-regex
export const MOTIF_ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

/**
 * Au-delà, une ligne JSON n'est pas un enregistrement d'erreur : une erreur
 * tient en une phrase, un événement de flux porte des transcriptions entières.
 * La borne garde aussi l'analyse linéaire sur les 300 échecs que l'essaim relit
 * — on n'analyse jamais un événement de 100 ko pour le jeter.
 */
const ERREUR_MAX = 4_096;

/**
 * Une ligne JSON qui EST une erreur, pas un événement qui en parle :
 *
 *   · `{"type":"error","message":"…"}` — ce que Cline écrit sur stderr en mode
 *     `--json` (`writeErr`, cline/cline apps/cli/src/utils/output.ts) ;
 *   · `{"error":{"message":"…"}}` — un corps d'erreur d'API brut (OpenAI,
 *     Anthropic) qu'un CLI en texte recopie tel quel.
 *
 * Les événements de Claude Code n'en sont jamais : leur `error` est un code
 * (`"error":"invalid_request"`), pas un objet porteur d'un message.
 */
function estEnregistrementDErreur(ligne: string): boolean {
  // `"error"` avec ses guillemets : absent de l'immense majorité des événements
  // (`"is_error"` ne le contient pas), il épargne le `JSON.parse` au reste.
  if (ligne.length > ERREUR_MAX || !ligne.includes('"error"')) return false;
  let objet: unknown;
  try {
    objet = JSON.parse(ligne);
  } catch {
    return false; // ligne tronquée : machinale, et illisible
  }
  if (typeof objet !== 'object' || objet === null || Array.isArray(objet)) return false;
  const { type, message, error } = objet as Record<string, unknown>;
  if (type === 'error' && typeof message === 'string') return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

/**
 * Début de chaque ligne de journal que HIVE écrit en rendant lisible un
 * événement d'un flux structuré — la narration d'un agent, pas son échec.
 *
 * ─── POURQUOI UNE MARQUE ─────────────────────────────────────────────────────
 *
 * Codex tourne en `--json` (adapters/flux-codex.ts) : son flux n'entre pas BRUT
 * dans les logs, il y entre RENDU, une ligne lisible par événement. Rendu, un
 * événement ne commence plus par `{"` — la règle de `texteDEchec` l'aurait
 * donc pris pour une phrase de l'échec. Or ces lignes disent ce que l'agent a
 * PENSÉ, DIT et LANCÉ : une tâche qui parle d'« API key » y écrit « API key »,
 * son `grep api_key` aussi, et tout échec de Codex redevenait une panne
 * d'identifiants — le mal que ce module répare pour le stream-json, revenu
 * par l'autre porte. La marque rend à ces lignes leur nature d'événement.
 *
 * Le bilan d'un tour en ÉCHEC, lui, est écrit SANS marque : c'est l'échec
 * lui-même, au même titre que les enregistrements d'erreur des autres flux
 * (`estEnregistrementDErreur`).
 *
 * Et la réponse finale n'est PAS rajoutée pour une narration retirée : elle y
 * est déjà (`┊ codex : …`), retirée à dessein. La rajouter rendait à « ce que
 * l'échec dit » les mots de l'agent — une réponse qui parle d'API key, sur un
 * tour conclu que Codex fait pourtant sortir en 1, et c'était encore une
 * panne d'identifiants.
 *
 * `┊` et pas un préfixe ASCII : aucun CLI n'ouvre une ligne de diagnostic par
 * ce caractère, et un marqueur `[codex]` aurait rejoint `[hive]`, que la règle
 * doit GARDER (délai de garde, échec du lancement).
 *
 * COMPROMIS ACCEPTÉ : la règle vaut pour les logs de TOUS les adaptateurs. Une
 * ligne qu'un autre CLI ouvrirait par `┊` (un guide d'indentation de TUI)
 * sortirait aussi de « ce que l'échec dit ». Aucun des CLI branchés n'en
 * écrit ; restreindre la règle à Codex demanderait à `texteDEchec` de
 * connaître l'adaptateur, que le hub (Couveuse, essaim) ne connaît pas.
 */
export const MARQUE_NARRATION = '┊';

/**
 * Ce qu'un échec DIT à un humain — ses logs, sans les événements d'un flux
 * structuré, et la réponse finale de l'agent quand ces événements la cachaient.
 *
 * ─── POURQUOI ─────────────────────────────────────────────────────────────────
 *
 * Claude Code, Cursor et Cline écrivent leur sortie standard en JSON par
 * lignes. `MOTIF_ERREUR` y trouvait « error » dans des CLÉS — `is_error`,
 * `compact_error`, `"error":"invalid_request"` — et la Couveuse servait à
 * l'ouvrière suivante des préfixes d'événements JSON coupés à 200 caractères,
 * tandis que l'essaim en tirait des SIGNATURES : deux pannes sans rapport
 * finissaient sous la même clé `{"type":"system",…`, et trois nœuds suffisent à
 * déclarer une leçon « systémique » — qui ouvre des chantiers en mode autonome.
 * Et le nœud, sur les mêmes clés (`apiKeySource`), prenait tout échec de Claude
 * Code pour une panne d'identifiants (en-tête de ce module).
 *
 * ─── LA RÈGLE ─────────────────────────────────────────────────────────────────
 *
 * Une ligne qui commence par `{"` est un ÉVÉNEMENT de machine, pas une phrase :
 * les flux JSON par lignes commencent chaque enregistrement ainsi, un message
 * humain jamais. Critère de préfixe d'abord : la dernière ligne d'un log
 * plafonné (512 ko) est un JSON TRONQUÉ — illisible, mais tout aussi machinal.
 *
 * SAUF un enregistrement d'ERREUR (`estEnregistrementDErreur`) : chez Cline, ou
 * chez un CLI en texte qui recopie un corps d'erreur d'API, cette ligne JSON
 * est l'échec lui-même — souvent sa SEULE ligne utile. La retirer faisait
 * tomber la signature sur une bannière, commune à toutes les pannes du CLI.
 *
 * Une ligne qui commence par `MARQUE_NARRATION` est le MÊME événement, rendu
 * lisible par Hive (Codex) : retirée au même titre.
 *
 * Ce qui reste — stderr, marqueurs `[hive]` (délai de garde…), erreurs d'un
 * flux, sortie en texte des autres CLI — est ce que l'échec dit à un humain.
 * Si des événements JSON ont été retirés, la parole de l'agent était DEDANS :
 * on la rend en y ajoutant son texte final. Sans événement retiré (CLI en
 * texte), les logs contiennent déjà la sortie standard, et l'ajouter la
 * doublerait. Une narration retirée ne la rend pas : voir `MARQUE_NARRATION`.
 */
export function texteDEchec(logs: string, finalText?: string): string {
  let evenementRetire = false;
  const humaines = logs.split('\n').filter((l) => {
    const brute = l.replace(MOTIF_ANSI, '').trim();
    if (brute.startsWith(MARQUE_NARRATION)) return false;
    if (!brute.startsWith('{"') || estEnregistrementDErreur(brute)) return true;
    evenementRetire = true;
    return false;
  });
  const texte = humaines.join('\n');
  return evenementRetire && finalText ? `${texte}\n${finalText}` : texte;
}
