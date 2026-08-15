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
//
// ─── 3. …ET LE MÊME PLAFOND POUR LES HOOKS, QUI AVAIT ÉTÉ OUBLIÉ ─────────────
//
// `testTimeout` et `hookTimeout` sont DEUX réglages distincts chez vitest.
// Élargir le premier laisse le second à ses 10 000 ms par défaut — et c'est
// ce qui s'est passé ici pendant tout ce temps.
//
// L'oubli est particulièrement mal placé, parce que le raisonnement du § 2
// ci-dessus décrit ce que font les HOOKS, pas les corps de test : c'est
// `beforeEach` qui monte le serveur, et `afterEach` qui l'arrête et efface
// l'arborescence. Les tests recevaient 20 s pour interroger un serveur déjà
// prêt, pendant que le hook chargé de le construire n'en avait que 10.
//
// La facture est tombée sous Windows, sur `main` :
//
//     tests/billet-motifs.test.ts:48     beforeEach  Hook timed out in 10000ms
//     tests/tableau-endpoint.test.ts:45  afterEach   Hook timed out in 10000ms
//
// Mesuré ici, sous Linux, cinq cycles complets `createServer` → `stop` →
// `rmSync` :
//
//     démarrage          189, 89, 68, 62, 64 ms
//     arrêt + effacement   9,  8,  7, 10, 11 ms
//
// Un cycle coûte donc moins de 200 ms là où rien ne le gêne. Les deux
// réglages sont désormais alignés : le même plafond pour le même travail.
//
// ─── LE DÉCLENCHEUR D'ESCALADE, ÉCRIT AVANT D'EN AVOIR BESOIN ────────────────
//
// Le § 3.1 du journal interdit de relever un plafond pour faire taire un
// symptôme — je l'ai fait trois fois, et la panne s'est déplacée sur les
// voisins à chaque fois. Ceci n'en est pas : c'est la PREMIÈRE fois que les
// hooks reçoivent le traitement que les tests avaient déjà, et l'écart entre
// les deux réglages n'a jamais été une décision.
//
// Mais la règle vaut pour la suite, alors elle est posée ici : **si un hook
// expire de nouveau à 20 000 ms, ce n'est plus de la lenteur.** 20 s pour une
// opération mesurée à 200 ms, c'est cent fois le coût — à ce niveau on
// n'attend plus un disque, on attend quelque chose qui ne viendra pas. Le
// geste sera alors de trouver CE QUI bloque, pas de passer à 30.

import { defineConfig } from 'vitest/config';

import { reglageDesForks } from './scripts/vitest-forks.mjs';

// ─── LE PLAFOND DE PROCESSUS, RÉGLABLE POUR ÊTRE MESURABLE ───────────────────
//
// `null` par défaut : vitest garde EXACTEMENT le comportement qu'il avait, et
// ce fichier ne décide de rien. La variable n'existe que pour rejouer le même
// arbre avec et sans plafond quand on cherche ce qui affame le runner Windows
// (§ 9 terseptuagies) — une hypothèse plausible ne se code pas, elle se mesure.
//
// L'appel est ICI, au chargement, et pas caché derrière une condition : une
// valeur illisible doit faire échouer le démarrage AVANT le premier test, pas
// au milieu d'une mesure qu'on croirait valide.
const FORKS = reglageDesForks(process.env.HIVE_VITEST_FORKS);

export default defineConfig({
  test: {
    env: {
      HIVE_JWT_SECRET: 'secret-de-session-des-tests-pas-un-secret-reel',
    },
    // ─── LE WEB STORAGE NATIF DE NODE, ET POURQUOI IL EST COUPÉ ────────────────
    //
    // Depuis Node 22+, `localStorage` existe en global, hors de tout DOM. Sous
    // happy-dom, ce global de Node passe AVANT le `localStorage` simulé par
    // l'environnement de test — et le sien n'est pas relié à un fichier
    // (`--localstorage-file` absent), donc ses méthodes n'existent pas :
    // `TypeError: localStorage.getItem is not a function`, dans TOUT fichier
    // qui touche le stockage de préférence (langue, etc.), avant même le
    // premier test. Couper le global de Node laisse happy-dom fournir le sien.
    execArgv: ['--no-experimental-webstorage'],
    testTimeout: 20_000,
    // ─── LA COUVERTURE, MESURABLE EN UNE COMMANDE ────────────────────────────
    //
    // Elle ne l'était pas : le seul chiffre connu (62,31 % de lignes) datait du
    // 3 août à midi, avait été obtenu à la main, et neuf lots de tests de vues
    // l'ont périmé dans la journée. Un chiffre qu'on ne peut pas relancer
    // devient une opinion datée — c'est la règle du carnet, appliquée à
    // l'instrument qui la mesure.
    //
    // `npm run couverture` rend le même total à chaque exécution : v8 compte
    // ce que le processus exécute, sans échantillonnage.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'dashboard/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts', 'dashboard/src/main.tsx'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      // ─── LE CLIQUET — un seuil qui ne descend jamais ────────────────────
      //
      // Le point de sortie classait ceci en 3e : « le seuil de couverture n'est
      // pas câblé. 75,43 % mesuré le 14 août, jamais remesuré. Sans cible qui
      // rougit d'elle-même, "couvert" n'est pas un critère, c'est une
      // anecdote. »
      //
      // Les valeurs ci-dessous ne sont pas choisies : elles sont MESURÉES, le
      // 15 août, sur l'arbre de ce lot —
      //
      //     statements  75.81 %   (10803 / 14250)
      //     branches    71.88 %   ( 7774 / 10814)
      //     functions   76.43 %   ( 2323 /  3039)
      //     lines       76.97 %   ( 9484 / 12321)
      //
      // ─── POURQUOI EXACTEMENT LA MESURE, ET PAS UN CHIFFRE ROND ──────────
      //
      // Un seuil sous la mesure laisse de la place pour éroder EN SILENCE :
      // c'est précisément ce qu'on veut interdire. Posé sur la mesure, il
      // rougit dès qu'une ligne neuve arrive sans banc — et c'est le geste
      // qu'on cherche à provoquer, pas un accident.
      //
      // Le poser exactement est SÛR parce qu'istanbul TRONQUE : 2323/3039 vaut
      // 76,4396 % et s'affiche « 76.43 ». La valeur écrite ici est donc
      // toujours ≤ la vraie, jamais au-dessus. (Vérifié sur les quatre.)
      //
      // ─── LA RÈGLE, ET LA SEULE FAÇON DE LA DESCENDRE ────────────────────
      //
      // Ce seuil MONTE avec la mesure et ne descend pas. S'il faut le baisser —
      // un retrait de code bien couvert peut légitimement faire tomber le
      // pourcentage — cela se fait avec la raison ÉCRITE ici même. Le baisser
      // en silence pour faire passer un lot, c'est rendre l'anecdote à sa place
      // de critère.
      thresholds: {
        statements: 75.81,
        branches: 71.88,
        functions: 76.43,
        lines: 76.97,
      },
    },
    // Le MÊME plafond que ci-dessus : c'est le hook qui monte le serveur et
    // efface l'arborescence, donc le travail lourd est ici. Les laisser
    // diverger, c'est donner 20 s pour interroger un serveur et 10 pour le
    // construire.
    hookTimeout: 20_000,
    // Étalé en DERNIER et seulement s'il existe : `...null` est illégal, et
    // `...{}` écrirait `pool: undefined` — deux façons de casser le défaut
    // qu'on voulait justement préserver.
    ...(FORKS ?? {}),
  },
});
