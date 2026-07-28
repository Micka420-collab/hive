// Le prompt d'une tâche est une DONNÉE. Le passer en argv en fait autre chose.
//
// ─── CE QUI SE PASSAIT ───────────────────────────────────────────────────────
//
// L'adaptateur claude-code lançait :
//
//     claude -p <prompt> --output-format stream-json --verbose
//
// Un prompt qui commence par un tiret n'est alors plus un prompt : c'est une
// option. Vérifié sur le vrai binaire, sans rien inventer :
//
//     $ claude -p '--version' --output-format stream-json --verbose
//     2.1.220 (Claude Code)
//
// La CLI n'a jamais vu de prompt. Elle a lu une option, l'a exécutée, et est
// sortie. Avec `--` posé au bon endroit, la même chaîne redevient du texte :
//
//     $ claude -p --output-format stream-json --verbose -- '--version'
//     {"type":"system","subtype":"init", …}     ← la session démarre vraiment
//
// ─── POURQUOI C'EST UNE FAILLE, ET DE QUELLE TAILLE ──────────────────────────
//
// Un nœud accepte déjà d'exécuter l'agent sur des prompts venus du hub : ce
// n'est donc pas « exécution de code là où il n'y en avait pas ». Ce que
// l'injection ajoute, c'est le contrôle des OPTIONS de l'agent — donc la
// possibilité de désarmer les garde-fous que le membre a posés sur SA machine
// (permissions, répertoires autorisés, configuration MCP). Le membre croit
// prêter un agent bridé ; il prête l'agent que le hub configure.
//
// Et le prompt n'est pas toujours écrit par un humain : le planificateur, la
// Reine et le runner d'essaim en fabriquent. Il suffit qu'un modèle produise
// une ligne commençant par un tiret.
//
// ─── DEUX MÉCANISMES, PARCE QU'ON NE CONNAÎT PAS TOUJOURS LA CLI ─────────────
//
// Pour `claude` et `codex`, on connaît la commande : le terminateur POSIX `--`
// est la réponse propre, et elle est vérifiée sur le binaire réel.
//
// Pour l'adaptateur `custom`, la commande est celle de l'opérateur — on ne peut
// pas supposer qu'elle comprend `--`, et lui en injecter un casserait des
// commandes légitimes. D'où `texteNonOption()`, qui ne suppose rien de la CLI.

/**
 * Rend un texte impossible à lire comme une option, sans rien lui retirer.
 *
 * Un argument qui commence par une espace n'est une option pour aucun analyseur
 * d'arguments — et pour du langage naturel, une espace de tête ne veut rien
 * dire. Le prompt arrive donc intact à l'agent, y compris quand il commence par
 * une liste Markdown (« - corriger le bug ») : c'est précisément le cas
 * légitime qu'un simple refus aurait cassé.
 *
 * À n'utiliser que là où `--` n'est pas une option : il est plus explicite.
 */
export function texteNonOption(texte: string): string {
  return texte.startsWith('-') ? ` ${texte}` : texte;
}
