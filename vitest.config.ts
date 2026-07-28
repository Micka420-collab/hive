// Configuration Vitest.
//
// Elle existait pour une seule raison : donner aux tests un `HIVE_JWT_SECRET`.
// Elle en a deux depuis que la CI tourne sous Windows.
//
// ─── 1. LE SECRET DE SESSION ─────────────────────────────────────────────────
//
// La ruche refuse de démarrer sans secret de session (voir la garde dans
// `createServer`), et une quarantaine de tests montent un vrai serveur. Poser
// le secret ici, c'est reproduire ce que fait une installation réelle — plutôt
// que d'affaiblir la garde pour arranger les tests.
//
// `tests/jwt-secret.test.ts` retire cette variable lui-même : la garde y est
// donc bien exercée, et la casser rend ce fichier-là rouge.
//
// ─── 2. LE DÉLAI PAR DÉFAUT, ET POURQUOI IL EST GLOBAL ───────────────────────
//
// Les 5 000 ms par défaut de vitest sont trop justes pour cette suite SOUS
// WINDOWS. Ce n'est pas une supposition, c'est un constat répété : deux runs
// d'affilée y ont vu des tests DIFFÉRENTS dépasser le plafond, sur du code
// identique et vert au run précédent.
//
//     run 217 : rustine-vs-git ×2
//     run 218 : doctor-releve ×2, store-scaling ×1
//
// La raison est structurelle. Cette suite ne simule presque rien : elle lance
// de vraies commandes `git`, monte de vrais serveurs HTTP, écrit de vraies
// bases SQLite. Sous Windows, créer un processus et écrire sur disque coûte
// plusieurs fois ce que ça coûte sous Linux, et la charge du runner varie
// nettement d'une exécution à l'autre — 213 s de tests sur un run, 110 s sur
// le suivant.
//
// J'AI D'ABORD CORRIGÉ TEST PAR TEST, PUIS FICHIER PAR FICHIER. Les deux fois,
// la bascule s'est déplacée sur les voisins au run suivant. Continuer aurait
// été traiter le symptôme là où il apparaît — la manière la plus sûre de faire
// revenir un problème indéfiniment. Le plafond lui-même était le défaut.
//
// ─── CE QUE CE DÉLAI NE FAIT PAS PERDRE ──────────────────────────────────────
//
// Il ne masque pas les blocages, et c'est la seule chose qui comptait. Un test
// qui ATTEND touche son plafond AU MILLIÈME PRÈS, quel que soit ce plafond :
// c'est comme ça que trois tests du miroir ont été démasqués à 30 008, 30 019
// et 30 009 ms — git y attendait des identifiants pour toujours. Ils ont été
// CORRIGÉS, pas rallongés. Un test lent finit ; un test bloqué colle au
// plafond. La distinction survit intacte à 20 secondes.
//
// Les délais posés SUR CERTAINS TESTS restent en place et ne sont pas
// redondants : ils documentent lesquels ont été MESURÉS lents, et ils
// tiendraient encore si quelqu'un rabaissait ce plafond global un jour.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      HIVE_JWT_SECRET: 'secret-de-session-des-tests-pas-un-secret-reel',
    },
    testTimeout: 20_000,
  },
});
