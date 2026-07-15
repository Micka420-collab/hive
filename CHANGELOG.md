# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
  drones vole encore.
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

### Fixed

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
