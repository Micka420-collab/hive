# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-09-28

Première étiquette de Hive. Elle reprend tout ce qui a été fusionné dans `main`
depuis 0.2.0 (15 juillet 2026) — 0.3.0 avait été déclarée dans `package.json`
sans jamais être étiquetée. Le gros de la période : la Chambre et l'autonomie
graduée (ADR 0010), le Cerveau qui survit à la fenêtre de contexte, la
contre-expertise d'une IA relue par une AUTRE famille, le bac à sable des
agents, la délégation bornée entre ouvrières, l'observabilité de Mission
Control, le module Cyber Hive, et le passage des conteneurs (Community et Cloud)
sous CI. Une ruche en service **sauvegarde d'abord** (`docs/RELEASING.md`, § 5),
puis lit « Pour monter » ci-dessous : rien d'autre n'est demandé.

### Pour monter

Gestes attendus de qui exploite une ruche installée avant 0.4.0. Sauf mention
« conteneur », ils valent aussi pour une installation par git.

- **La première administration d'une ruche exposée exige le jeton de ruche.**
  Le tout premier compte devient administrateur ; il ne peut plus être créé
  sans présenter `x-hive-token`. Gardez le jeton à portée pour l'installation
  (#440, #467).
- **Supprimer un projet exige désormais un compte.** `DELETE /api/projects/:id`
  demande le propriétaire, ou un administrateur pour un projet orphelin ; le
  jeton de ruche seul est refusé (`403 compte_requis`). L'action n'apparaît dans
  le tableau de bord que pour ces rôles (#498).
- **`HIVE_TRUST_PROXY` n'accepte plus qu'une adresse.** IP, CIDR, ou
  `loopback` / `linklocal` / `uniquelocal` — une valeur numérique (l'ancien
  `1`) est illisible, refusée, et retombe sur « aucun proxy de confiance ».
  Derrière un reverse-proxy, remplacez-la par la liste des proxys, sinon chaque
  client partage un seul compteur anti-abus (#439, #467).
- **Codex sur l'hôte nu veut un bac qui fonctionne.** Hors du bac à sable de
  Hive, une production Codex écrit par le propre bubblewrap de Codex ; sous
  Ubuntu 24.04+ (restriction AppArmor des namespaces non privilégiés) il faut
  que `bwrap` marche, ou faire tourner les agents dans le bac de Hive
  (`HIVE_ISOLEMENT=auto` avec podman/docker, ou `apt`/`dnf install bubblewrap`
  sous Linux). À défaut, la tâche échoue **visiblement, avant toute dépense** —
  fini le diff de 0 octet annoncé « réussi ». Sous Windows, sans bac Codex la
  sortie en lecture seule est refusée au lieu de passer pour un succès (#507,
  #503, #465, #486).
- **Claude Code : montez à 2.1.40 ou plus.** En deçà, `claude auth status` est
  un prompt facturé (le sous-commande `auth` n'existait pas), donc la détection
  d'agent ne sait pas dire si le CLI est connecté. Depuis 2.1.40 la ruche lance
  aussi Claude avec `--setting-sources user` : plus aucun `.claude/settings*.json`
  ni `CLAUDE.md` du dépôt de la tâche n'est chargé par le CLI (#492, #508).
- **Agents en bac sans navigateur : posez leurs clés.** Fournissez
  `CLAUDE_CODE_OAUTH_TOKEN` (via `claude setup-token`) et/ou `CODEX_API_KEY`
  (`codex exec` ignore `OPENAI_API_KEY`). Un CLI dont la commande de statut se
  dit déconnecté, et sans clé, n'obtient pas d'ouvrière : le bandeau et
  `hive doctor` le disent (#492).
- **Hive Cloud : le domaine passe de `docker/Caddyfile.cloud` à `.env`.**
  Jusqu'ici `docs/CLOUD.md` faisait remplacer `hive.example.com` DANS ce fichier
  suivi par git ; il lit maintenant `{$HIVE_DOMAIN}`, et
  `docker-compose.cloud.yml` refuse de démarrer sans lui. Avant de tirer le
  code : écrire `HIVE_DOMAIN=<votre domaine>` dans `.env`, puis rendre le
  fichier à git (`git checkout -- docker/Caddyfile.cloud`) — sinon `git pull` ou
  `git checkout vX.Y.Z` tombe en conflit sur cette ligne. _(conteneur Cloud)_
- **Community : `HIVE_PORT` et `HIVE_DB` de `.env` ne s'appliquent plus DANS le
  conteneur.** `docker-compose.yml` les fixe (`7777`, `/app/data/hive.db`) par
  `environment`, qui prime sur `env_file` : un `.env` d'hôte les faisait pointer
  hors du volume, ou écouter là où la redirection de port ne cherchait pas. Pour
  un autre port sur l'hôte, changer la partie GAUCHE de `ports`. Une base tenue
  sous un autre nom dans le volume s'ouvrirait vide : la renommer en
  `/app/data/hive.db` (depuis la sauvegarde) avant de redémarrer. _(conteneur
  Community)_
- **Rien à faire pour le stockage.** Les nouvelles tables et index (Balance,
  Gardiennes, verrou Reine, délégation, réputation, journal, critique…) naissent
  seuls au premier usage (`CREATE … IF NOT EXISTS`) ; aucun `ALTER TABLE`, aucun
  `DROP`, aucun `PRAGMA user_version`. Revenir à une version antérieure ne
  demande donc en général que le code — mais le chemin sûr reste de reposer la
  sauvegarde prise avant la montée (`docs/RELEASING.md`, § 5).

### Ajouts

- **La Chambre et l'autonomie graduée (ADR 0010).** Un poste d'ouvrière —
  baptême, métier, présence, polyéthisme — et une échelle d'autonomie que
  `hive mode` bascule sans quitter le clavier. La Fabrique de la Chambre propose,
  juge et lance des Chantiers ; les Motifs enregistrent des procédures par
  projet, appliquées en tâches ordonnées avec un aperçu des étapes avant de
  confirmer. Feedback d'erreur HITL, horizon injecté dans le contexte de
  l'ouvrière.
- **Le Cerveau — le savoir qui survit à la fenêtre de contexte.** La ruche
  alimente son propre cerveau : chaque échec pris en compte y laisse une trace,
  chaque succès validé y entre. Un onglet `#/cerveau` (administrateurs) l'explore
  — recherche, filtres, vue liste. Hive Mind hybride (`rankMemoriesHybrid`, BM25
  et trigrammes) pour les projets longs, et n'apprend désormais **que du travail
  validé**, en attribuant chaque épisode (#495).
- **La contre-expertise — une IA relue par une AUTRE.** Un modèle reçoit
  vraiment le travail d'un autre, lit un verdict, et une revue croisée par
  famille d'agents décide de la livraison ; l'Évaluateur agrège la contre-revue
  exacte, rejoue le producteur sur verdict contesté, et rattache chaque avis au
  résultat exact. Une revue impossible dit `human_review_required` avec sa cause
  au lieu de bloquer en silence (#460, #484, #488). La critique devient
  structurée — sévérité, critère, marqueur `HIVE_CRITIQUE` — et **atteint la
  reprise** (#493, #488).
- **Une ouvrière par famille d'agents détectée.** `npm run ruche` démarre un
  nœud par famille (`claude-code`, `codex`…), chacun épinglé à son agent, une
  tâche à la fois, pour que chaque production soit relue par les autres familles.
  `--une-ouvriere` ou `HIVE_AGENT` garde un nœud unique (#466).
- **La délégation bornée entre ouvrières.** Une ouvrière délègue un
  sous-arbre de tâches à d'autres, avec des budgets par racine (durée, coût
  déclaré), une enveloppe de coût, une épingle de routage opérateur, et sans
  famine de créneau ; la délégation réelle est exposée aux CLI Claude et Codex.
  Mission Control affiche le graphe de délégation réel (#405, #421, #423, #496,
  #406).
- **Le bac à sable des agents.** Une image « agent-aware » épinglée (Claude,
  Codex, Cline…), un préflight en bac propre qui valide les agents, un moteur
  choisi par préflight (podman keep-id, conteneurs étiquetés et récupérés). Le
  nœud déclare son bac et Mission Control le dit ; le producteur exécute les
  vérifications du projet lui-même dans son bac (#458, #486, #465, #475, #503).
- **Mission Control observe vraiment.** Une projection d'ouvrière auditable, les
  preuves du modèle, où est passé le temps d'une tâche (et ce qui reste inconnu),
  la réputation d'une ouvrière par catégorie, pourquoi une tâche est allée à ce
  nœud et à ce modèle, le rapport de mission, l'économie et la qualité des
  ouvrières, et un accueil « cockpit » (#392, #451, #452, #450, #504, #513).
- **Le Génome et le coût réel.** Un registre en lecture seule de ce que chaque
  modèle a réellement fait, par catégorie ; la chronologie et le coût / temps
  modèle tels que le CLI de l'agent les a déclarés, portés jusqu'au tableau de
  bord (#454, #455, #456).
- **Livrer une mission sans GitHub.** Livraison sur une branche git locale, et
  la commande unique de la V2 Alpha qui prouve une vraie mission, critère par
  critère (#476, #459, #469).
- **Le module Cyber Hive.** Un module de pentest autonome piloté en langage
  naturel (MCP) : orchestrateur, agent autonome, registre d'outils, défense
  (analyse SQLMap, ports), déchiffrement universel de documents (20 algorithmes),
  IA offensive, connexion IA (OAuth 2.1, MCP, API) avec 8 serveurs MCP externes,
  et son propre écran de tableau de bord (#365, #367, #368, #374, #375).
- **La War Room.** Une chronologie en lecture seule du débat, le Conseil des
  Éclaireuses depuis le tableau de bord avec la décision humaine enregistrée, et
  chaque issue de revue dans une seule chronologie filtrée (#478, #513).
- **La Reine parle, en flux.** `POST /api/chat` en SSE, micro (Web Speech) et
  lecture à voix haute, documents ; nouvelles intentions `review`, `races`,
  multilingue. `hive ask` coupe le flux au Ctrl+C.
- **Le sortie en flux de l'agent, caviardée au nœud.** La sortie vive de l'agent
  remonte sous sa forme lisible (jamais l'événement brut), expurgée des secrets
  côté nœud (#489).
- **Le Rayon, l'Aperçu, le partage en lecture, l'environnement.** Les abeilles
  voient le code (Rayon) ; l'Aperçu montre ce que l'IA construit sans donner la
  session ; un projet se partage en lecture aux deux bouts sans donner la ruche ;
  l'agent installe ce dont il a besoin dans un environnement borné ; un projet
  s'adopte et admet des ouvrières.
- **Les instincts de la ruche.** Gardiennes (contrôle d'entrée du nectar),
  Phéromones (routage par affinité apprise), Thermorégulation, Couveuse
  (re-tentatives qui apprennent), Drone Wars (redondance compétitive opt-in),
  Waggle Board (bonus de nectar aux vainqueurs), Night Shift (`HIVE_SHIFT`),
  Guetteuses.
- **L'Atelier de recette.** Un bureau Debian (Xvfb, Openbox, Chromium, Python) où
  la ruche recette une production visuelle.
- **Les Chantiers et les workflows GitHub.** La ruche sait quels travaux le dépôt
  déclare, leur donne un écran, et lance vraiment les GitHub Actions.
- **Le connecteur GitHub, les clés de la ruche, le Conseil ont chacun un écran.**
  Panneaux dédiés dans l'Intendance et la carte projet ; clés API proactives
  (OpenRouter & co) posées depuis la Chambre vers le `.env` de la Reine.
- **Rejoindre une ruche en une commande, sans rien cloner** (`npx`), et un
  installeur scriptable (`src/args.ts`) ; installeurs signés sur GitHub Pages,
  empreinte SHA-256 affichée. Site vitrine bilingue FR/EN, section tarifs, deux
  éditions (Community gratuit / Cloud), deux paliers d'équipe (Team / Enterprise).
- **Une garde sur le code que personne n'appelle** (`tests/modules-sans-appelant.test.ts`)
  et une garde d'origine pour les WebSockets, enfin éprouvée sur les quatre cas
  (`tests/ws-origine.test.ts`).

### Changements

- **Mission Control, refonte façon Craft / Apple.** Le tableau de bord passe au
  papier de cire (miel unique), respire, et se veut plus professionnel ;
  navigation à huit vues.
- **Mode production des agents.** Le nœud refuse de démarrer un vrai agent sans
  isolement quand la politique l'exige, au lieu de basculer en silence sur le
  simulé.
- **Les vues chargées à la demande ne blanchissent plus le tableau de bord** : une
  vue qui plante garde Mission Control debout, et un chargement raté est réessayé
  (#471).
- **Un modèle qui a planté sur une tâche n'est pas réélu** pour elle, et les
  courses enregistrent leurs raisons (#473). Les vues de routage disent ce que
  l'Aiguillage décide, et un modèle peut être retiré (#463).
- **La rétention du journal a un seul propriétaire** : les preuves d'une tâche
  vivent et disparaissent avec elle (#497).

### Corrections

- **Sur Windows, la ruche se servait d'un agent SIMULÉ sans le dire vraiment** —
  corrigé.
- **L'image pouvait naître morte.** `npm ci` sort avec 0 même quand une
  dépendance optionnelle nécessaire au démarrage (Fastify, ses greffons,
  `better-sqlite3`) a échoué ; la construction le vérifie maintenant.
- **Le verrou npm déclarait encore l'ancienne version** (0.2.0 puis 0.3.0) à ses
  deux entrées racine : une ruche qui ne dit pas d'une seule voix quelle version
  elle est ne peut pas répondre « suis-je à jour ? ».
- **Le docteur annonçait trois chiffres pour ses 13 diagnostics** ; une garde qui
  balaie le dépôt tient désormais le compte.
- **Une ouvrière `npm run ruche` reçoit la vraie adresse de sa Reine** ; le pont
  de délégation marche depuis n'importe quel dossier ; la Reine et le nœud
  tournent dans un seul processus, pas derrière le CLI de `tsx` (#482, #480,
  #443).
- **Une connexion de hub morte est détectée** au lieu d'attendre le TCP ; les
  sockets qui ne répondent plus aux pings sont coupées ; le nœud s'arrête sur
  `SIGTERM` comme sur `SIGINT` (#437, #442, #468).
- **Le travail perdu d'un nœud a une issue visible** ; les tableaux de bord
  rattrapent le journal, et une session expirée le dit au lieu d'un 404/401 sur
  votre propre projet (#474, #485).
- **Codex tourne en `codex exec --json`** : usage déclaré, échecs classés depuis
  les événements ; une production qui n'a rien écrit le dit (#481, #507).
- **L'accueil, le CORS et les deux portes d'entrée disent enfin la même machine**
  et le même nombre de décisions ; le déroulé de l'accueil devient testable.
- **Une mission démarre sur un dépôt sans le moindre commit** ; le connecteur lit
  la version de l'installeur depuis `package.json`.
- **Docker** : les CLI d'agents installés depuis un verrou, non plus un global
  flottant ; la Reine garde dans son volume les clés API accordées depuis la
  Chambre ; une Reine par base, pragmas explicites (#447, #446, #479).
- **`champSurUneLigne` ne laisse plus passer U+2028 / U+2029** (y compris dans une
  objection de relecture) ; le plafond de délai avait un jumeau resté à 10 s ;
  le CHANGELOG se répétait trois fois — corrigé, et tenu par une garde.
- **La ruche ne fusionne plus n'importe quelle pull request du dépôt** ; un compte
  ne reçoit plus 401 sur le rapport de son propre projet ; un projet créé depuis
  le tableau de bord a un propriétaire.
- **`hive desinstaller` et `hive service`** dressent l'inventaire de tout ce que
  Hive a posé ; image, compose et sauvegarde (`VACUUM INTO`) au complet.
- **`vitest` monté en 4.1.11** pour l'avis GHSA-82fw-gwwq-j7x9 (#431).

### Sécurité

- **Le premier compte et les actions d'administration sont séparés de
  `HIVE_TOKEN`.** Une ruche exposée exige le jeton pour son premier
  administrateur ; chaque route qui engage un projet, les réglages réservés au
  propriétaire et la porte de livraison de l'Évaluateur sont gardés (#391, #440,
  #467). La War Room ne lit un projet que sur un verdict `permis` — une régression
  qui, un temps, ouvrait à tout compte les objections et décisions de tout projet
  privé, refermée avant publication (#478 corrigé dans le train 2).
- **Le git de l'hôte n'exécute jamais ce que le dépôt de la tâche a configuré** :
  ni hooks, ni `core.hooksPath`, ni serveur MCP ou binaire livré ; les
  identifiants sont lavés jusqu'au dernier `@` ; Claude Code ne lit plus les
  réglages du dépôt (`--setting-sources user`) (#483, #508, #467).
- **Une livraison locale répond POUR LE DÉPÔT sur chaque forge** : impossible de
  créer un jumeau sans propriétaire sur l'URL d'un projet possédé pour y pousser
  (#476 durci dans le train 2).
- **Les sources de dépôt HTTP sont restreintes**, le relais OpenAlex est réservé à
  la ruche, les identifiants du dépôt sont retirés de l'instantané de l'essaim, et
  seules des cibles de wake-hook validées s'exécutent (#388, #441, #435, #390).
- **Le bac à sable ferme d'anciennes fuites** : la commande de test d'un merge
  passe par le bac et ne peut plus être n'importe quel binaire ; le prompt d'une
  tâche ne peut plus devenir une option de l'agent ; les extraits de validation
  sont caviardés au nœud avant de remonter (#489).
- **Corrections héritées de l'audit adverse** : billet d'un serveur provisionné
  qui était en clair, annuaire rendu gratuitement par `/api/auth/register`, ajout
  arbitraire à un projet privé, ligne entière publiée par `GET /api/projects/public`,
  injection de prompt par le Hive Mind, secret de session écrit en dur, et la
  Balance (8 correctifs).

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

### Tests

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
