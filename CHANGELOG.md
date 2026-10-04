# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Pour monter

- **Faites tourner le jeton de chaque projet privé dont l'URL en porte un**
  (`https://user:jeton@…`). Jusqu'ici, le clone de chaque tâche l'écrivait
  dans son `.git/config` — lisible par chaque agent —, et git le confiait à
  l'assistant d'identifiants du membre qui clonait ou poussait : en clair dans
  `~/.git-credentials` avec `store`, dans le gestionnaire de Windows — à la
  place de l'entrée du membre pour cet hôte —, dans le trousseau de macOS.
  Révoquez-le chez l'hébergeur ; l'URL d'un projet ne se change pas encore :
  recréez le projet avec le nouveau. Sur chaque machine, `hive doctor`
  (`identifiants_git`) nomme les fichiers de `store` et les hôtes du
  gestionnaire de Windows qui gardent un identifiant git — jamais sa valeur.
  Le trousseau de macOS se vérifie dans « Trousseaux d'accès » ; chaque entrée
  se retire à la main (#551).
- **git ≥ 2.31** sur les ouvrières et la Reine pour un projet dont l'URL porte
  un jeton : en dessous, git ignorerait l'accès que la ruche lui passe par
  l'environnement — le clone est refusé, en le disant (`hive doctor` : `git`).
  Une URL au mot de passe sans nom (`https://:jeton@…`) est refusée aussi : git
  n'envoie pas de compte au nom vide ; `https://<jeton>@…` convient (#551).
- **Un projet dont l'URL de dépôt porte un caractère de contrôle** (rangée
  avant #551, ou chemin local d'administrateur) ne part plus vers les
  ouvrières : ses tâches échouent avant tout envoi, la cause au Journal
  (« URL de dépôt du projet illisible (caractère de contrôle) — recréez le
  projet avec une URL valide »), et ses merges, chantiers et courses sont
  refusés de même. Jusqu'ici, chaque ouvrière jetait l'assignation sans un mot
  et la tâche restait assignée pour toujours. Recréez le projet. Une ouvrière
  à jour refuse aussi, en le disant, toute assignation qu'elle ne sait pas
  lire (des versions différentes, ou un champ hors des bornes du protocole) :
  gardez la Reine et ses ouvrières à la même version (#554).

## [0.5.0] — 2026-09-28

Hive s'installe désormais **comme une application** : la Reine, une ouvrière
par agent connecté et Mission Control dans une fenêtre, sans Node à installer
ni terminal à ouvrir (#532). Autour d'elle, le train d'intégration 5 (#530)
apporte les connecteurs externes (webhook, Slack), le banc d'ombre des modèles,
le graphe d'expérience inter-projets, les missions rejouables, la boucle
d'auto-amélioration Hive → Hive, la découverte des nœuds sur le réseau local et
un Aiguillage v3 ; #529 cloisonne le savoir appris entre les personnes. La
version relève le plancher de Node (24.18.0) et demande une glibc ≥ 2.34 sous
Linux : une ruche en service **sauvegarde d'abord** (`docs/RELEASING.md`, § 5),
puis lit « Pour monter » ci-dessous.

### L'application de bureau

Les paquets sont attachés à la release `v0.5.0` sur GitHub, construits et
lancés au banc de fumée sur leur système (`docs/APPLICATION.md`) :

| Système | Fichier                                                                           |
| ------- | --------------------------------------------------------------------------------- |
| Windows | `Hive-Setup-0.5.0.exe` — assisté, par utilisateur, sans droits administrateur     |
| macOS   | `Hive-0.5.0-arm64.dmg` (Apple Silicon) ou `Hive-0.5.0-x64.dmg` (Intel)            |
| Linux   | `hive_0.5.0_amd64.deb` (conseillé, Ubuntu 24.04+) ou `Hive-0.5.0-x86_64.AppImage` |

- **Les paquets ne sont pas encore signés.** Windows (SmartScreen) et macOS
  (Gatekeeper) préviennent au premier lancement : la marche à suivre, pas à
  pas, est dans `docs/APPLICATION.md` (« Installer »). Sous macOS 15 et
  suivants, le clic droit → Ouvrir ne suffit plus : **Réglages Système →
  Confidentialité et sécurité → Ouvrir quand même**.
- **Premier lancement** : l'app crée sa ruche (dossier privé, `.env` en `0600`,
  jeton et secret tirés comme par l'installeur), détecte les agents **et s'ils
  sont connectés** (la commande qui connecte chacun est affichée), lance la
  Reine et une ouvrière par famille, puis ouvre Mission Control déjà connecté.
  Sans agent connecté, la démonstration simulée le dit.
- **Une ruche installée par git existe déjà ?** L'app propose de l'ouvrir, d'en
  importer une copie (base par `hive sauvegarde`, mémoire, identités, clés), ou
  d'en commencer une neuve — la ruche d'origine n'est jamais modifiée.
- **Barre système, notifications et liens `hive://ouvrir/<vue>`** : ce qui
  attend un humain (identifiant réclamé, relecture impossible, livraison à
  reprendre, fusion refusée, plafond de dépense, ouvrière arrêtée) devient une
  notification qui ouvre la bonne vue.
- **Mises à jour depuis les releases publiées**, jamais dans votre dos : une
  sauvegarde de la base avant chaque changement de version ; sans signature,
  rien ne se télécharge ni ne s'installe sans un clic (macOS non signé ouvre la
  page de la version).
- **Aucune télémétrie** : journaux et rapports de plantage restent sur la
  machine. L'app écoute sur `127.0.0.1` seulement.
- Sous le capot : un seul superviseur pour `npm run ruche` et l'app
  (`src/ruche-superviseur.ts`), `better-sqlite3` 13 (N-API, binaires dans le
  paquet) chargé par le même binaire sous Node et sous Electron (#531, #532).

### Pour monter

Gestes attendus de qui exploite une ruche en 0.4.0. Une ruche d'avant 0.4.0
lit d'abord la rubrique « Pour monter » de 0.4.0 (compte exigé pour supprimer
un projet, `HIVE_TRUST_PROXY`, domaine Cloud dans `.env`…).

- **Sauvegardez d'abord** (`hive sauvegarde`, jamais un `cp` à chaud), et
  sortez la copie et `.env` de la machine (`docs/RELEASING.md`, § 5).
- **Node ≥ 24.18.0 (donc npm ≥ 11.16).** Seul npm ≥ 11.16 respecte le refus du
  script de construction de `better-sqlite3` (`allowScripts`) ; en deçà, npm
  tente un `node-gyp rebuild` et, sans python3, écarte la dépendance **en
  silence** — la Reine meurt sur `Cannot find module 'better-sqlite3'`. Les
  installeurs et `hive doctor` refusent les Node 24.0 à 24.17 (`nvm install 24`,
  `winget install`). Puis `npm ci` et la sonde qui **ouvre** une base :
  `node -e "new (require('better-sqlite3'))(':memory:').close()"` (#531).
- **Linux : glibc ≥ 2.34** (Ubuntu 22.04+, Debian 12+), exigée par le binaire
  de `better-sqlite3` 13. Une machine Ubuntu 20.04 / Debian 11 monte d'OS ou
  passe à l'image Docker ; `hive doctor` le dit (#531).
- **Montez les ouvrières avec la Reine.** Le protocole Reine ↔ ouvrière gagne
  l'effort déclaré et commandé (`register.efforts`, `assign_task.effort`) et la
  reprise sur la même branche (`prolonger`) : une ouvrière 0.4.0 ne sait pas
  reprendre une PR livrée sur sa branche. Une ouvrière entrée par `npx` se
  relance depuis le même dossier :
  `npx github:Micka420-collab/hive#v0.5.0 join <billet>` (#518, #519).
- **Connecteurs externes : rien ne part sans vous.** Sans secret, ils dorment.
  Pour Slack, posez `SLACK_BOT_TOKEN` (et `SLACK_APP_TOKEN` pour les boutons
  d'approbation en Socket Mode) **et** `SLACK_CANAUX`, la liste des IDs de
  canaux que l'administrateur permet — sans elle, Slack ne poste nulle part ;
  puis chaque projet autorise le connecteur (portées, canaux et usagers par ID)
  dans l'Intendance → Connecteurs externes (#499, #530).
- **Webhook : `https://` seulement** (`http://` n'est accepté que vers la boucle
  locale), et aucune redirection n'est suivie. Une URL `http://` vers une autre
  machine est refusée (#499, #530).
- **Un effet de rejeu se valide par un compte propriétaire ou administrateur.**
  Sur un projet de rejeu, PR, push, fusion, livraison locale et workflows sont
  simulés ; « Valider pour de vrai » (ou `--valider-rejeu`) n'est accepté que
  d'un compte qui répond de chaque projet tenant ce dépôt — jamais du jeton de
  ruche (#512, #530).
- **La boucle Hive → Hive attend l'approbation d'un compte.** Une production
  sensible s'arrête avant la QA jusqu'à ce qu'un compte propriétaire ou
  administrateur l'approuve dans la Miellerie ; une approbation au jeton de
  ruche ne compte pas (#511, #530).
- **Rien à faire pour le stockage.** Les nouvelles tables (`reprises_livraison`,
  `aiguillage_bras`, `efforts_noeuds`, `connecteurs_projet`,
  `connecteurs_journal`, `banc_ombre`, `taches_ombre`, `missions`,
  `missions_taches`, `rejeux`, `rejeux_actions`, `identite_ruche`) naissent
  seules (`CREATE … IF NOT EXISTS`) ; aucun `ALTER TABLE`, aucun `DROP`. Revenir
  à 0.4.0 ne demande en général que le code — le chemin sûr reste de reposer la
  sauvegarde (`docs/RELEASING.md`, § 5). Le travail `montee` de la CI monte
  vraiment depuis `v0.4.0`.

### Ajouts

- **L'application de bureau Hive** (ADR 0013) — voir plus haut (#532).
- **Les connecteurs externes : webhook générique et Slack.** Un contrat à
  portées fermées (`lecture`, `notification`, `approbation`, `action`), une
  autorisation par projet, un journal en ajout seul (qui, quoi, aperçu caviardé,
  empreinte du corps envoyé), des secrets dans le `.env` de la Reine — jamais en
  base ni vers un nœud. Le webhook est signé HMAC (`X-Hive-Signature`) ; Slack
  poste les demandes d'approbation avec des boutons Approuver / Refuser, et un
  clic prend **exactement** le chemin de la Miellerie, Hive Mind compris
  (#499, #530).
- **Le banc d'ombre des modèles.** Une petite tâche testable, tirée au sort, est
  rejouée par un second modèle dans un bac isolé, jamais livrée ; les tests du
  projet décident, la contre-expertise fixe la confiance, et le Génome range le
  résultat à part (provenance `shadow`). **Éteint par défaut**, allumé par
  projet avec un budget (exécutions par 24 h, plafond de coût) ; panneau sous
  les Garde-Fous, `docs/BANC-OMBRE.md` (#501).
- **Le graphe d'expérience inter-projets.** Tâches, modèles, revues, erreurs et
  leçons reliés avec leur provenance et leur date ; avant de commencer,
  l'ouvrière reçoit — comme données, jamais comme consignes — les tâches
  passées qui ressemblent à la sienne. Isolé au projet par défaut ;
  `HIVE_EXPERIENCE_PORTEE=ruche` l'étend aux projets dont le savoir est admis
  (#502, #529).
- **Les missions rejouables et le Time Travel.** Chaque mission garde un
  instantané versionné (plan, modèles, politique de routage, Génome, garde-fous,
  décisions) ; « Rejouer… » la relance dans un nouveau projet sous un autre
  modèle, une autre politique ou une autre autonomie, **effets irréversibles
  simulés**, puis compare les deux. Une tâche annulée a enfin son propre statut
  dans la Chronique (#512).
- **La boucle d'auto-amélioration Hive → Hive** (`npm run boucle:v3`).
  Architecture, implémentation relue par une autre famille, porte des
  changements sensibles (une liste nommée de surfaces, fermée sur tout ce
  qu'elle ne sait pas lire), QA de cette production exacte, puis une PR — jamais `main` — qui porte
  son rapport de risques. À blanc sans `--oui` (#511).
- **La découverte des nœuds sur le réseau local**, avec trois consentements :
  la machine s'annonce (`hive join --decouvrable` ou `HIVE_DECOUVRABLE=1`), la
  Reine écoute (`HIVE_DECOUVERTE=1`), et un administrateur recopie le **code
  d'appariement** affiché par la machine (Inviter → « Sur votre réseau local »).
  Rien de secret n'est diffusé ; le billet voyage scellé sous ce code. Éteinte
  par défaut (#505).
- **Un compagnon dans Mission Control** — abeille, bourdon ou osmie, ou votre
  propre animal (PNG / WebP, gardé dans le navigateur) — qui résume l'état réel
  de la ruche, ne couvre jamais le contenu, se range, et respecte la réduction
  des animations (#510).

### Changements

- **Aiguillage v3.** Un modèle jamais essayé n'est plus choisi d'office
  (fini le `+∞`) : chaque bras (modèle × harnais × effort) part d'un a priori
  fini ; Mission Control montre un intervalle de confiance à 95 % et dit
  « décidé » ou « explore encore » ; le coût déclaré pèse seulement quand chaque
  bras comparé en déclare un. L'effort (`--effort`) n'est commandé qu'au Claude
  Code qui le documente (#519).
- **Reprendre une PR livrée avance la MÊME branche**, au lieu d'ouvrir une
  seconde PR ne portant que le correctif ; trois reprises au plus par livraison.
  Même règle pour la livraison locale (`livrer-local --prolonger=<n>`) (#518).
- **Le savoir appris est cloisonné entre les personnes et les auditoires.**
  Souvenirs du Hive Mind, épisodes du Cerveau et graphe d'expérience suivent une
  seule règle : même projet, projet public, ou même propriétaire (ou aucun) avec
  un auditoire déjà inclus. Les souvenirs ne passent plus d'une personne à
  l'autre ; les épisodes se partagent à nouveau entre les projets privés d'une
  même personne (#529).
- **Une approbation Slack prend le chemin canonique de la revue humaine** ;
  supprimer un projet efface aussi son journal de connecteurs, ses instantanés
  de missions, ses bras d'Aiguillage et ses tâches d'ombre (#530).
- **Un nœud qui ne peut pas travailler ne s'annonce pas** ; `hive doctor` dit
  aussi une glibc trop ancienne (#505, #531).

### Corrections

- **Une panne du bac pendant les tests n'est plus imputée au modèle.** Mémoire
  épuisée, disque plein, DNS, démon de conteneurs : la validation devient
  « preuve manquante » (`environnement`), avec le remède, au lieu d'envoyer
  l'agent corriger un code sain et de compter une correction au Génome (#517).
- **Codex relit à nouveau l'`AGENTS.md` du dépôt**, comme simple donnée bornée
  en tête du prompt — le dépôt reste non fiable pour Codex (#520, issue #514).
- **Un `CLAUDE.md` riche en emojis ne disparaît plus du contexte** : la coupe
  d'un champ ne tranche plus une paire de substitution (#520).
- **Une installation sans python3 ne perd plus `better-sqlite3` en silence**,
  et les messages de réparation nomment les vraies causes (`--omit=optional`,
  npm trop ancien, glibc, plateforme sans binaire) au lieu de
  `npm rebuild` (#531).
- **Un banc Windows intermittent** (`caste-boucle`) : son faux nœud bat
  désormais le cœur comme un vrai (#533).

### Sécurité

- **Cursor et Cline n'exécutent plus les hooks ni les plugins du dépôt de la
  tâche** (`.cursor/hooks.json`, `.claude/settings*.json`, `.clinerules/hooks/`,
  `.cline/hooks/`, `.cline/plugins/`) : ces chemins sont écartés de l'arbre
  pendant l'exécution et remis avant le diff, sur tous les systèmes (#516).
- **Lecture durcie des consignes du dépôt** : `O_NOFOLLOW`, fichier ordinaire
  exigé, coupe UTF-8 sans caractère tronqué ; un lien échangé après coup n'est
  plus suivi (#520).
- **Le jeton de ruche ne valide plus rien d'irréversible** : ni un effet de
  rejeu, ni une production sensible de la boucle Hive → Hive ; chaque revue
  humaine enregistre qui a décidé, et un clic Slack ne s'invente pas de motif
  (#530).
- **Slack borné par l'administrateur** (`SLACK_CANAUX`), tests de connecteur
  limités en débit, listes d'autorisations visibles de qui répond du projet
  seulement ; webhooks en https, sans redirection ; texte d'erreur Slack
  caviardé. Le jeton de la CI ne fait plus que lire (#530).
- **La découverte locale n'offre qu'aux machines des sous-réseaux de la Reine**,
  jamais la boucle locale ni l'adresse de métadonnées du cloud ; l'empreinte
  de ruche n'est dérivée d'aucun secret (#505, #530).
- **Un projet privé ne sert jamais son savoir à une autre personne** — ni par
  le Hive Mind, ni par le Cerveau, ni par le graphe d'expérience fédéré (#529,
  #530).
- **L'app durcit sa coquille** : isolation de contexte, bac à sable du rendu,
  navigation verrouillée à la Reine, CSP posée, fusibles Electron, chaque
  message IPC vérifie son origine (#532).

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
