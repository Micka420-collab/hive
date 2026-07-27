# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **🛂 Les Gardiennes — le contrôle d'entrée du nectar** (module pur
  `src/orchestrator/gardiennes.ts`). Jusqu'ici la ruche croyait l'agent sur
  parole : un `success: true` accompagné d'un **diff vide** fabriquait un
  souvenir Hive Mind (pollution définitive de la mémoire collective), déposait
  une phéromone **positive** sur le couple nœud × domaine, créditait du
  **nectar** au Waggle Board et comptait en **`utile`** dans La Balance — un
  mensonge comptable qui empirait de jour en jour. Les Gardiennes inspectent
  chaque production déclarée réussie et rendent des **griefs typés** :
  `empty_diff` (diff vide sur une promesse de modification), `surface_missed`
  (aucun des fichiers annoncés n'est touché — comparaison **normalisée en
  casse**, `extractPaths` rendant des chemins en minuscules là où `parseDiff`
  garde la casse d'origine), `malformed_diff` (texte qui ne nomme aucun fichier,
  ou hunks orphelins) et `logs_contradict` (logs qui crient l'échec sur des
  motifs **étroits**, distincts de ceux de la Couveuse — « 0 errors » n'accuse
  personne). Interrupteur `HIVE_GARDIENNES=off|consultatif|strict`, **défaut
  `consultatif`** : on observe et on annote longtemps avant de contraindre — en
  `consultatif`, la séquence d'événements est **rigoureusement identique** à
  celle d'avant (prouvé par le harnais de rejeu partagé). En `strict`, une
  production creuse emprunte le circuit d'échec existant : elle ne nourrit ni le
  Hive Mind, ni les phéromones, ni le nectar, ni `utile`, et la tâche **re-tente
  sur le budget `MAX_ATTEMPTS` existant** — jamais sur un compteur à part, donc
  jamais sans fin. Le verdict est calculé **à la réception** et rangé aussitôt
  dans une **table neuve** `gardiennes` (`CREATE TABLE IF NOT EXISTS`, aucun
  `ALTER TABLE`, aucun index existant modifié) avec sa **borne d'élagage**
  `pruneGardiennes` dans le même commit : `pruneResults` vide `diff` et `logs`
  au-delà de 5 000 résultats, donc un verdict recalculé après coup serait faux.
  `GET /api/gardiennes` (vue dérivée pure et bornée), événement `guard_refused`
  (faits typés, codes en anglais snake_case).
- **🐜 Phéromones — routage par affinité apprise** (module pur
  `src/orchestrator/pheromones.ts`). Chaque résultat dépose une phéromone
  (+10 succès, −6 échec) sur le couple **nœud × domaine** de tâche (api, ui,
  db, tests, docs, infra, general — heuristique bilingue en mots entiers) ;
  le signal s'évapore avec une **demi-vie de 7 jours**. À l'assignation, le
  critère « nœud le moins chargé » reste souverain : les phéromones ne
  **départagent** que les ex æquo à charge minimale, et seulement sur un
  signal net. `GET /api/pheromones`, événement `pheromone_route`, carte
  dédiée dans la vue Essaim.
- **🌡️ Thermorégulation — la ruche ventile quand elle surchauffe** (module
  pur `src/orchestrator/thermo.ts`). Température 0-100 sur une fenêtre de
  10 min (échecs ×1, re-tentatives ×0,6, refus infra ×0,8 ; les échecs en
  **cascade** ne comptent pas, ce sont des conséquences, pas des symptômes).
  Bandes froide/normale/chaude/surchauffe → concurrence effective par nœud
  ×1 / ×1 / ×0,75 / ×0,5, jamais moins d'une tâche. **Hystérésis** par ticks
  consécutifs hors bande : pas de clignotement aux frontières.
  `GET /api/thermo` (`{ instantane, applique }`), événement `thermo_shift`,
  jauge dans la vue Santé qui montre la divergence lecture/appliqué.
- **👶 Couveuse — les re-tentatives apprennent de leurs échecs** (module pur
  `src/orchestrator/brood.ts`). À la ré-assignation d'une tâche déjà échouée,
  les logs des tentatives précédentes sont repliés en leçons (lignes d'erreur
  privilégiées, ANSI nettoyé) et injectées en tête du `hiveContext`, dans un
  **bloc de données isolé des instructions** (`<<<HIVE_DATA`, une ligne JSON
  par tentative, délimiteur neutralisé) — un agent hostile ne peut pas
  transformer ses logs en ordres pour l'ouvrière suivante. Budget borné de
  bout en bout (≤ 8000 au total, la limite au-delà de laquelle le nœud rejette
  l'assignation). Événement `brood_context`.
- **🌐 Site vitrine** — landing page bilingue FR/EN dans `site/` (design
  « ruche » : Swarm View animée en SVG, journal vivant, 8 fonctionnalités,
  architecture hub-and-spoke, sécurité, démarrage, roadmap), auto-déployée
  sur GitHub Pages par `.github/workflows/pages.yml` à chaque push sur
  `main`. SEO complet (Open Graph, Twitter Card, JSON-LD, sitemap), image
  de partage `og.png`, accessibilité (skip-link, `aria-pressed`,
  `prefers-reduced-motion`), langue mémorisée (`?lang=`, localStorage,
  langue du navigateur) et compteur d'étoiles GitHub en amélioration
  progressive.

- **Revues partagées** — les verdicts de la Miellerie vivent côté serveur
  (`POST /api/tasks/:id/review`, `GET /api/reviews`, événement `task_reviewed`) :
  tous les opérateurs voient les mêmes approbations en temps réel ;
  localStorage ne sert plus que de repli hors-ligne.
- **Merge sélectif** — `POST /merge/run` accepte `taskIds` (validés : tâches
  terminées du projet) ; « Couler le miel » depuis la Miellerie n'intègre que
  les productions **approuvées**.
- **⚔ Drone Wars câblé** — redondance compétitive opt-in : `POST
/api/tasks/:id/race { factor }` (CLI `race`, bouton du tiroir de tâche)
  confie la même tâche prête à 2-5 nœuds (diversité d'agents maximisée) ;
  le premier succès gagne, les perdants reçoivent `cancel_task`. Primaire
  promu si un drone tombe ; échecs/refus/déconnexions absorbés par la
  course (une seule tentative brûlée au pire). Courses en mémoire —
  un redémarrage du hub retombe sur le circuit mono-nœud, sans double
  exécution.
- **🌍 Interface bilingue fr/en** — bascule FR/EN dans la topbar, détection
  de la langue du navigateur, 24 fichiers traduits (glossaire ruche : forage,
  honeycomb, pour the honey, the Honey House…). La Reine répondait déjà dans
  la langue du message.
- **Revues multi-opérateurs durcies** — compare-and-set opt-in
  (`expectedUpdatedAt`, 409 avec l'état courant), horodatages exposés par
  `GET /api/reviews`, identité d'onglet (`clientId`) échouée dans
  `task_reviewed` : les échos propres sont reconnus formellement.
- **La Reine parle revue** — nouvelle intention `review` : « que reste-t-il à
  revoir ? » répond avec les compteurs réels (approuvées/rejetées/en attente)
  et les prochaines productions à inspecter.
- **⚔ Le nectar des vainqueurs** — le Waggle Board crédite un bonus de
  5 nectars par victoire de course (`drone_won`, en plus du `task_done` du
  vainqueur) ; perdre ou être annulé en course reste neutre (redondance
  opt-in, pas de double peine). Victoires affichées dans l'Essaim et la CLI.
- **Courses visibles** — `GET /api/races` expose les courses en vol ; les
  cartes de nœuds de l'Essaim portent un badge ⚔ animé quand un de leurs
  drones vole encore, et une carte « Courses en vol » liste tâche + drones
  (noms et statuts). Après la course, le tiroir de tâche affiche le
  vainqueur 🏆 (retrouvé au journal via `drone_won`).
- **La Reine parle courses** — nouvelle intention `races` fr/en (« y a-t-il
  des courses en vol ? ») : courses réelles avec drones nommés et statuts,
  ou mode d'emploi pour en lancer une ; courses exposées au mode IA. Le suivi
  est complet : CLI `races`, badge ⚔ Essaim, famille « Courses » en Chronique,
  démo avec course automatique.
- **Night Shift câblé** — `HIVE_SHIFT` agit vraiment : hors des heures de
  service du membre, le nœud refuse poliment tâches ET merges (aucune
  tentative brûlée, `retryAfterMs` évite la re-sollicitation en boucle,
  config malformée = refus propre). Le heartbeat déclare `onShift` : la
  sélection de merge évite d'office les nœuds hors service. Documenté dans
  `.env.example`.

### Security

- **Le secret de session était écrit en dur dans un dépôt public**
  (⚠️ **CHANGEMENT CASSANT** : la ruche refuse désormais de démarrer sans
  `HIVE_JWT_SECRET`, et les sessions ouvertes avec l'ancien secret sont
  invalidées — c'est le prix, et il est juste). `auth.ts` signait les jetons de
  session avec `process.env.HIVE_JWT_SECRET || 'change-me-jwt-dev-only'`, et ni
  `npm run install:hive` ni les README ne posaient cette variable : **toutes**
  les ruches installées signaient donc avec la même clé, lisible par quiconque
  ouvrait le fichier. `verifyJwt` ne vérifiant que la signature et l'expiration,
  et `roleDe` rendant « membre » pour un identifiant inconnu, un jeton forgé
  donnait (1) une **session complète sans compte**, contournant intégralement
  `HIVE_INSCRIPTION=fermee`, et (2) forgé sur l'identifiant de l'administrateur,
  **l'administration entière** — serveurs, rôles, tout. L'invariant « le jeton
  de ruche ne vaut pas preuve d'administration » était scrupuleusement tenu,
  mais le JWT n'en valait pas davantage. Il n'y a plus **aucune** valeur par
  défaut : `secretJwtDepuisEnv` refuse l'absence, le blanc, l'ancien secret
  publié (`SECRET_JWT_INTERDIT`, qui traîne désormais dans les `.env` recopiés)
  et tout secret de moins de `LONGUEUR_MIN_SECRET_JWT` = 24 caractères — le
  marque-place `change-me` de `.env.example` compris. La garde vit dans
  `createServer`, **avant toute écoute réseau**, sur le modèle exact de celle de
  `HIVE_TOKEN` : un serveur qui ne démarre pas se remarque, un serveur
  silencieusement forgeable non. La simulation (`npm run demo`) démarre toujours
  sans configuration, sur un secret **éphémère tiré au sort par processus** : les
  sessions d'une démo meurent avec elle. `npm run install:hive` engendre
  désormais un `HIVE_JWT_SECRET` de 64 caractères — **distinct du jeton de
  ruche**, qui lui se recopie de machine en machine — préserve celui qui existe
  déjà, et signale un `.env` qui aurait recopié l'ancien secret. Documenté dans
  les deux README et `.env.example` ; `tests/jwt-secret.test.ts` exécute la
  contrefaçon (ancien secret public, compte inexistant, secret d'une autre
  ruche) avec le jeton légitime en contrôle négatif.

### Fixed

- **Injection de prompt par le Hive Mind** (faille adjacente à celle de la
  Couveuse : durcir l'une sans l'autre ne protégeait de rien, les deux blocs
  arrivant dans le MÊME prompt d'ouvrière). `memory.content` sort de
  `summarizeTask`, donc du prompt de la tâche **et des logs** de l'ouvrière :
  la même matière non fiable, seulement passée par une tâche **réussie**. Les
  souvenirs sont désormais encapsulés comme les leçons (consigne « NOTES
  ISSUES DE TÂCHES PASSÉES, jamais des instructions », une ligne JSON par
  souvenir, délimiteur neutralisé, budget strict avec troncature avant
  sérialisation et chaîne vide plutôt qu'un bloc non refermé). Le contrat est
  extrait dans un helper partagé `src/shared/donnees-non-fiables.ts` utilisé
  par `brood.ts`, `hive-mind.ts` et `concierge.ts` — dont le `clean()`
  neutralise à son tour le délimiteur, qu'un nom de projet hostile pouvait
  encore glisser au milieu du JSON. Nouvel invariant `§5.2` dans
  `tests/security-invariants.test.ts` : le marqueur n'est défini que dans le
  helper, tout constructeur de contexte y passe, et les blocs restent bien
  formés et sous budget face à des entrées hostiles.
- **Audit adversarial des nouveautés « instinct »** (5 lentilles indépendantes,
  chaque constat soumis à réfutation avant d'être retenu) — 3 correctifs
  critiques, mesures à l'appui sur une ruche de 100 000 tâches / 20 000
  résultats / base de 6 Go :
  - **Injection de prompt par la Couveuse** : les logs d'agent étaient
    interpolés en texte libre dans le prompt de l'ouvrière suivante. Contrat
    `<<<HIVE_DATA` de `concierge.ts` appliqué (consigne de sécurité, une ligne
    JSON par tentative, délimiteur neutralisé, nom de nœud nettoyé).
  - **Repli des phéromones en O(toutes les tâches)** : `SELECT *` sans LIMIT +
    `JSON.parse` par ligne + domaine calculé pour 100 000 tâches dont 500
    utiles → **2 636 ms par passe**, amplifié par `reapDeadNodes` (une passe
    par nœud fauché). Lecture ciblée par clé primaire, mémoïsation par
    `taskId`, RegExp pré-compilées, TTL 3 s sur la route → **0,24 ms**.
    Racine jumelle corrigée : `promotePendingTasks` faisait le même `SELECT *`.
  - **Table `results` sans index de tri et jamais élaguée** : plan `SCAN` +
    `TEMP B-TREE` ouvrant les pages de débordement `diff`/`logs` alors que la
    requête ne projette que 4 petites colonnes → index **couvrant**
    `idx_results_recent`, **1 612 ms → 0,43 ms**. `pruneResults` allège
    (vide `diff`/`logs`) au-delà de 5 000 résultats sans jamais supprimer la
    ligne, dont la Miellerie et le Parlement ont encore besoin.
- Thermorégulation : les échecs en **cascade** ne chauffent plus la ruche
  (1 échec réel + 9 dépendantes : 77° → 25°), les refus **Night Shift** ne
  comptent plus comme des refus infra, et la fenêtre de 10 min est lue par
  **borne temporelle SQL** (index `events(ts, type)`) au lieu d'un lot de
  1000 événements qu'un flot de `task_progress` suffisait à saturer.
- Le message français n'est plus figé dans le payload persisté des nouveaux
  événements — seul cas sur 34 : le Journal reconstruit le texte bilingue,
  comme pour tous les autres.
- `startRace` respecte la ventilation ; la re-livraison de secours porte enfin
  le `hiveContext` (fonction de contexte partagée) ; l'hystérésis compte les
  ticks hors bande (deux bandes alternées ne basculaient jamais).
- 4 correctifs (revue du suivi de courses) : victoires plafonnées aux tâches
  visibles du journal (pas de bonus fantôme après élagage), badge ⚔ coupé par
  `prefers-reduced-motion` et éteint si le poll `/api/races` est en panne,
  `role="img"` sur le badge (aria-label prohibé sur un span générique).
- 8 correctifs (revue du câblage Drone Wars) : startRace respecte le Sting
  Detector, drones fantômes purgés à la réconciliation, capacité consciente
  des drones non-primaires (fini la sur-réservation), promotion en `assigned`
  (filet staleAssignedTasks réarmé, re-livraison à tous les drones),
  cancel_task centralisé dans le scheduler, télémétrie des drones visible,
  workspaces suffixés par nœud (plus de collision sur workRoot partagé).

- 21 correctifs issus de la revue adversariale multi-agents (AZERTY,
  raccourcis sous modales, IME, focus des alvéoles, contraste AA, anti-
  injection du prompt de la Reine, collisions d'ids Queen Bee, pollings
  résilients…), journal Chronique paginé (300 lignes rendues).
- 10 correctifs (2e passe) : le serveur est la source de vérité des revues
  (une tâche rejetée ne coule jamais, sélection comme repli), 409 sur la
  pré-approbation, store client convergent (fencing d'hydratation, POSTs
  sérialisés, re-hydratation à chaque reconnexion WS).
- 8 correctifs (3e passe) : `HIVE_SHIFT` malformée ne gèle plus une tâche,
  `task_reject.retryAfterMs` (cooldown proportionnel — plus de spam du
  journal la nuit), merge aussi refusé hors service, verdicts WS d'autres
  opérateurs différés puis rejoués, outbox `hive.review.unsynced` re-postée
  (bandeau « revues non synchronisées »).
- **⚖️ La Balance — audit adverse, 8 correctifs.**
  - **Le grand livre perdait des dépenses, définitivement.** `CacheProjets.resoudre`
    insérait les manquants puis RELISAIT le cache pour bâtir son retour ; la purge
    d'insertion pouvait emporter une clé que l'appel devait rendre, et le filigrane
    ayant avancé, la dépense n'était jamais relue. Reproduit : 21 006 ms comptés
    contre 5 021 006 ms réels, avec `aJour: true` — un projet à 50× son plafond que
    `jugerPlafond` laissait passer. Le cache borné est désormais un objet UNIQUE
    (`src/orchestrator/cache-borne.ts`, partagé avec `CacheDomaines` qui avait le
    même contrat et le même défaut) : le retour est bâti sur les hits relevés AVANT
    insertion et les lignes rendues par le chargeur, l'éviction est un VRAI LRU, et
    elle est en **O(1) amorti** (file explicite) au lieu de `keys().next()`, qui est
    O(taille) dans V8 — 6 540 ms → 368 ms sur un rattrapage de 400 000 tentatives.
  - **`listReviewsFor(ids)`** : le socle de la Balance ne déplie plus la table
    `reviews` (jamais élaguée) toutes les 3 s pour n'en garder que 2 000 clés —
    144 ms → 4,7 ms à 100 000 revues, sur un chemin qui bloquait la boucle
    d'événements et retardait le tick.
  - **Coercition AJV** : `plafondMs: false` devenait un plafond de 0 (projet arrêté
    net) et `""` un `null` (plafond retiré). La valeur BRUTE est refusée en
    `preValidation`, avant que le schéma ne valide une valeur déjà remplacée.
  - **Filet de re-livraison** : le contexte (BM25 sur la mémoire) n'est plus
    reconstruit par tâche muette ET par tick dans le corps synchrone du
    `setInterval` ; il n'est calculé que si une socket est ouverte, et mémoïsé par
    tâche.
  - **Rattrapage du grand livre au démarrage** : nouveau CACHE reconstructible
    `balance_ledger_cache` (filigrane + soldes), qui **amende explicitement la
    règle 1 de la doctrine** — motif et condition de validité écrits dans
    `balance.ts`. 200 000 résultats : 101 ticks de rattrapage (≈ 200 s de plafonds
    FAIL-OPEN à chaque démarrage) → 5 ticks. Jeté au moindre doute (version,
    filigranes divergents, filigrane au-delà du dernier `results.id`) ; la
    reconstruction totale est un `DELETE`.
  - **Mode `off`** : plus de `depenseMs: 0` fabriqué pour les projets plafonnés —
    un solde inconnu n'est pas un solde nul. `soldes: []`.
  - **Événements renommés** avant qu'une base de production n'existe :
    `balance_alerte` → `balance_alert`, `balance_seuil` → `balance_cap_reached`,
    `balance_plafond` → `balance_cap_set`. C'étaient les 3 seuls types en français
    sur 46.
  - Commentaire faux corrigé dans `pruneResults` (le seuil est le plus RÉCENT
    résultat à alléger, pas le plus ancien conservé intact).

## [0.2.0] — 2026-07-15

Grande intégration nocturne : les 12 PRs ouvertes (paliers 2 → 4 + innovations)
fusionnées et réconciliées avec la lignée auth/marketplace/OpenAlex, puis
refonte complète de l'interface en **Mission Control**.

### Added

- **🎛️ Mission Control** — le dashboard devient une application 8 vues
  (sidebar alvéolaire, navigation hash, touches 1-8, deep-links) : Ruche,
  Reine, Miellerie, Projets, Essaim, Santé, Chronique, Mémoire.
- **👑 La Reine répond** — dialogue multilingue avec la ruche
  (`POST /api/chat`, CLI `ask`, vue dédiée) : avancement réel, résumé du
  journal, classement, santé, aide au cadrage avec bonnes pratiques par type
  de projet. Détection de langue (fr/en natif, toute langue via IA), repli
  hors-ligne déterministe garanti — le modèle ne reçoit que les chiffres réels.
- **🍯 Miellerie** — centre de revue des productions IA : file triée
  (échecs d'abord), diff découpé par fichier avec stats +/−, logs, consensus
  du Parlement (barre de factions, quorum), approbation/rejet au clavier
  (j/k/a/x), footer merge Honeycomb avec suivi du résultat.
- **Paliers 2→4 fusionnés dans main** : Queen Bee (planner heuristique +
  Claude), Hive Mind (BM25, injection de contexte à l'assignation),
  Sting Detector, Honeycomb Merge (plan + exécution réelle sur nœud),
  token-failover, sous-agents, adaptateur commande libre, Time-Lapse Replay,
  Drone Wars (cœur pur), Waggle Board, Parlement des Agents, Ghost in the
  Hive, Night Shift, Hive Pulse, rapport par projet, garde des invariants
  de sécurité (§5).
- **🧬 OpenAlex** — moteur de recherche scientifique intégré, désormais dans
  la vue Mémoire.
- **🔐 Authentification** — register/login JWT (node:crypto pur) +
  marketplace de projets publics.
- **Adaptateur Hermes Agent** — `hermes agent run --prompt "<prompt>"`.

### Changed

- Queen Bee : deux backends complémentaires — `/api/plan` (heuristique +
  Claude via `ANTHROPIC_API_KEY`) et `/api/projects/:id/brief` (OpenRouter).
- Hive Mind : la variante BM25 câblée de bout en bout (protocole → nœud →
  dashboard) remplace la classe FTS5 ; le contexte est joint à l'assignation
  côté serveur, sans réécrire le prompt persisté.

### Fixed

- Compilation TypeScript stricte (`tsc --noEmit` propre), ESLint + Prettier
  zéro erreur, 253 tests vitest verts.

## [0.1.0] — 2026-07-14

### Added

- Orchestrateur central (Fastify + WebSocket + SQLite) avec hub-and-spoke
- Client nœud avec reconnexion automatique et heartbeat
- Démo `npm run demo` : orchestrateur + 2 nœuds simulés + projet 7 tâches DAG
- Sandbox v0 : cwd dédié, environnement épuré, timeout, annulation
- Adaptateurs : shell (simulé), claude-code, codex
- Dashboard Swarm View : vue SVG 2D + vue 3D Galacean Engine
- CLI : state, project, brief, tasks, watch, cancel, invite
- Invitations : `npm run join -- <token>` avec auto-détection d'agent
- Persistance SQLite (survit aux crashs), journal d'événements
- Sécurité : token partagé, CORS restreint, validation entrées, anti-DoS,  
  zéro `shell: true`, défense anti path-traversal côté nœud
