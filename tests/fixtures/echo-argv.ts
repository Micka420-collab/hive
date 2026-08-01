// UN POINT D'ENTRÉE MINUSCULE, POUR ÉPROUVER LA PORTE POUR DE VRAI.
//
// `tests/amorce.test.mjs` le lance à travers `scripts/lancer.mjs`, dans un vrai
// processus, et compare ce qu'il imprime.
//
// ─── POURQUOI UN FICHIER PLUTÔT QU'UNE ASSERTION DE TEXTE ────────────────────
//
// Le lanceur fait deux choses qu'aucune relecture ne valide :
//
// 1. Il RÉÉCRIT `process.argv` pour que le point d'entrée voie exactement ce
//    que `tsx <fichier> <args>` lui aurait donné. Une erreur d'indice ici
//    avalerait la première commande tapée — `doctor` deviendrait invisible.
// 2. Il charge un `.ts` par `await import()`. Sous Windows, un chemin absolu
//    (`C:\…`) n'est PAS un spécificateur ESM valide : Node y lit un schéma
//    d'URL `c:` et refuse. Seul `pathToFileURL` convertit correctement — c'est
//    le § 6.1 du journal, sous une troisième forme.
//
// Les deux ne se voient qu'en LANÇANT, et la seconde ne se voit qu'à
// l'exécution sur Windows. D'où ce fichier : la CI y tourne sur les trois
// systèmes, et ce test est le seul qui traverse la porte au lieu de la lire.

console.log(JSON.stringify(process.argv.slice(2)));
