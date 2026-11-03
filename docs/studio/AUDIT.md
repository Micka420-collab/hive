# Hive Studio — audit de reprise (PR A)

> Audit du 3 novembre 2026, sur `main` à `f93b53b9`, avant toute modification fonctionnelle.
> Référence UX : issues [#578](https://github.com/Micka420-collab/hive/issues/578) et [#579](https://github.com/Micka420-collab/hive/issues/579), maquette validée `docs/maquettes/hive-studio/dashboard-reference.png`.
>
> Trois niveaux de preuve, et ils ne se mélangent pas :
>
> - **exécuté** — lancé sur la machine d'audit, résultat consigné ici ;
> - **lu** — code source lu, pas exécuté pour cet audit ;
> - **déclaré** — affirmé par le dépôt (bancs, ADR, docs), non revérifié ici.

## 1. Ce qu'il faut retenir

1. **Le moteur est mûr ; l'écran ne le montre pas.** 159 routes HTTP, 8 388 bancs, un modèle d'autorisation explicite (ADR 0005, 0007), des missions suivies côté Reine, une revue humaine, une livraison gardée. Le tableau de bord, lui, expose 14 vues au vocabulaire apicole (Ruche, Reine, Miellerie, Essaim…) sans recherche, sans projet actif, et la seule façon de lancer une mission est enfouie dans la vue Projets.
2. **P0 sécurité — le bouton « Inviter » de `main` remet le jeton maître.** `InvitePanel` appelle `GET /api/invite`, qui fabrique une invitation `hive1_` contenant `HIVE_TOKEN` (accès total, définitif, non révocable). La route se déclare elle-même obsolète et nomme son remplaçant (`POST /api/billets`, billets `hive2_` éphémères, comptés, révocables). **Le correctif existe : PR #575** (CI verte sur les trois systèmes, fusionnable sans conflit).
3. **P0 qualité — `main` est rouge depuis les trois commits du 3 novembre.** `prettier --check` refuse `dashboard/public/assets/hive-studio/README.md` ; l'étape Lint échoue, et les étapes suivantes (typecheck, tests, build) ne tournent plus en CI. Corrigé dans cette PR.
4. **Aucun défaut produit trouvé dans les 20 échecs locaux.** Tous viennent de l'environnement de la machine d'audit (détail en § 3). Un seul méritait une correction dans le dépôt : un banc dont la fixture dépendait de l'exclusion Git globale que Claude Code installe sur chaque poste.
5. **Les binaires de la maquette sont entrés**, mais hors de `dashboard/public/` pour les deux PNG (3,9 Mo) : tout ce qui est dans `public/` est copié dans chaque build — paquet npm, installeurs, image Docker.

## 2. État de référence (exécuté)

Machine : Windows 11, Node 26.4.0, npm 11.17.0, git 2.53 (outils embarqués du shell d'audit) et MinGit 2.55.

| Commande                      | Résultat                                                                        | Durée |
| ----------------------------- | ------------------------------------------------------------------------------- | ----- |
| `npm ci`                      | OK, 296 paquets                                                                 | 21 s  |
| `npm run typecheck`           | OK                                                                              | 14 s  |
| `npm run typecheck:dashboard` | OK                                                                              | 14 s  |
| `npm run build:dashboard`     | OK                                                                              | 2 s   |
| `npx eslint .`                | OK                                                                              | ~40 s |
| `npx prettier --check .`      | **KO** : `dashboard/public/assets/hive-studio/README.md`                        | ~10 s |
| `npx vitest run`              | 8 388 bancs : 8 146 verts, **20 rouges**, 221 ignorés, 1 à faire (592 fichiers) | 171 s |

## 3. Les 20 échecs locaux, un par un

| Bancs                                                                                      | Cause établie                                                                                                                                                                                                                                                                                        | Preuve                                                                                                                                     | Verdict                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `git-hote` (6), `git-hote-train` (1), `adoption-admission` (1), `parcours-jeton-depot` (1) | Le shell d'audit exporte `MSYS_NO_PATHCONV=1` et `MSYS2_ARG_CONV_EXCL=*`. Git for Windows lance `upload-pack` à travers sa propre couche MSYS, qui ne convertit plus `/C:/…` : tout `git clone file:///C:/…` échoue (« does not appear to be a git repository »), et les bancs qui clonent expirent. | Le même `git clone` réussit dès que ces deux variables sont retirées ; les 9 bancs passent alors.                                          | environnement d'audit      |
| `configuration-inerte` (4)                                                                 | Claude Code inscrit `**/.claude/settings.local.json` dans `~/.config/git/ignore`. La fixture du banc construisait son dépôt piège par `git add -A` : sur tout poste où Claude Code est installé, le vecteur restait hors du dépôt.                                                                   | `git check-ignore -v` désigne l'exclusion globale ; avec `-c core.excludesFile=`, les 18 cas passent (13 verts, 5 ignorés par plateforme). | **banc fragile — corrigé** |
| `workflow-git` (5 sous le shell d'audit, 1 sous un PATH propre)                            | Mêmes variables MSYS pour 4 d'entre eux. Le 5ᵉ (« la connexion coupée en plein transfert ») dépend d'un minutage réseau local.                                                                                                                                                                       | Sous un `cmd.exe` à PATH minimal (MinGit + Node), seul le cas minuté reste rouge.                                                          | environnement / minutage   |
| `noeud-arret-signal` (1)                                                                   | Le banc exige un `node.exe` sans espace dans son chemin ; l'installation Windows standard est `C:\Program Files\nodejs\`.                                                                                                                                                                            | Message du banc : « chemin avec espace : HIVE_AGENT_CMD le couperait ».                                                                    | précondition du banc       |
| `service-accepte` (1)                                                                      | `schtasks /Create` répond « Accès refusé » : la session d'audit n'a pas le droit d'inscrire une tâche planifiée.                                                                                                                                                                                     | Sortie de `schtasks` dans le message d'échec.                                                                                              | droits de la session       |

Sous un `cmd.exe` à PATH minimal, d'autres bancs rougissent pour une raison symétrique (`sh` et `echo` absents de ce PATH) : ce relevé-là n'a servi qu'à isoler les causes ci-dessus. **La référence reste la CI GitHub (ubuntu, windows, macos)**, verte sur la PR #575 qui part de ce même `main` moins les trois commits de documentation.

## 4. CI et travail en cours sur GitHub (exécuté via `gh`)

- `main` : workflow CI **en échec** sur `f93b53b9`, `2fd40f44` et `a4f7febb` — étape « Lint (ESLint + Prettier) », fichier `dashboard/public/assets/hive-studio/README.md`. Les étapes suivantes n'ont pas tourné.
- 30 PR ouvertes. Celles qui touchent le périmètre Studio :
  - **#575** `feat(porte)` — un lien d'invitation unique, page de porte, `hive://rejoindre`, l'hôte voit l'invité arriver ; **retire l'usage de `/api/invite` du tableau de bord**. Base `main`, `MERGEABLE`/`CLEAN`, 17 vérifications vertes.
  - #576 `feat(ruche)` (base `claude/train-9`), #559 Train 8 « Mission Control UI series » (base `main`, état de fusion inconnu) : touchent l'ancien tableau de bord ; à réconcilier avec le nouveau shell au moment de leur fusion.
  - #577 `feat(site)` : vitrine, hors périmètre dashboard (une vérification rouge : « La suite tient dans plusieurs ordres de tests »).

## 5. Matrice des capacités

| Capacité                                | Implémentation                                                                                                                                                                                                                                                                       | État réel                                                                                                     | Défaut identifié                                                                                                                                         | Correction                                                                                                                    | Test                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Missions** (objectif → plan → tâches) | `POST /api/plan` (DAG heuristique ou LLM, sans écriture), `POST /api/projects/:id/tasks`, `POST /api/projects/:id/brief` (Queen Bee, clé OpenRouter) ; suivi automatique `missions.ts` (ouverture à la première tâche vivante, clôture quand plus rien ne vole, appartenance rangée) | **lu** ; parcours brief → plan → tâches présent dans la vue Projets et dans la modale « + Projet »            | Aucun point d'entrée « Que veux-tu accomplir ? » ; la mission courante d'un projet n'est affichée nulle part                                             | Studio : saisie principale → aperçu du plan → lancement ; carte « Mission en cours » lue sur `GET /api/projects/:id/missions` | bancs existants `plan`, `missions-*` (**déclaré**) ; E2E Studio à écrire           |
| **Contrôle d'exécution**                | `POST /api/tasks/:id/cancel` (décision : propriétaire/admin ou jeton sur projet orphelin) ; pas de pause de tâche                                                                                                                                                                    | **lu**                                                                                                        | La maquette montre « Pause » : le moteur ne sait pas suspendre une tâche                                                                                 | Afficher « Arrêter » avec confirmation ; **pas de bouton Pause** tant que le moteur ne le permet pas                          | —                                                                                  |
| **Agents**                              | Nœuds (`HiveNode` : agent, modèles, outils constatés, isolement déclaré), adaptateurs `claude-code`, `codex`, `cursor`, `cline`, `grok`, `hermes-agent`, `custom`, `shell` ; `agents-connectes.ts` distingue IA réelle et simulée                                                    | **lu** ; CLI présents sur la machine d'audit : Claude Code 2.1.317, Codex 0.154.0, Cline 3.0.57 (**exécuté**) | Visibles seulement dans Essaim et un voyant de la barre                                                                                                  | Colonne droite : agents réels, état, charge, tâche en cours                                                                   | E2E à écrire avec un agent réel                                                    |
| **Invitations machine**                 | `POST /api/billets` (`hive2_`, TTL, usages, révocation, refus du clair public), `POST /api/rejoindre` (temps constant, consommation atomique), `DELETE /api/billets/:id`, `GET /api/membres`                                                                                         | **lu**                                                                                                        | **P0** : l'écran utilise encore `GET /api/invite` (`hive1_`, jeton maître)                                                                               | **PR #575**                                                                                                                   | `porte*.test.ts` dans #575 (**déclaré**, CI verte)                                 |
| **Invitations personne**                | Liens de partage en lecture `hive3_` (`/api/projects/:id/partages`, jeton dans le fragment), adhésion par compte (`/membres`)                                                                                                                                                        | **lu**                                                                                                        | Deux parcours séparés (Projets, modale), aucun choix « personne / machine »                                                                              | Studio : un bouton « Inviter », deux chemins réels                                                                            | à écrire                                                                           |
| **Dashboard**                           | React 19 + Vite 8, 14 vues + Chambre, navigation par hash, raccourcis 1-9/0/h/w/i/c, thème clair uniquement                                                                                                                                                                          | **exécuté** (build)                                                                                           | Pas de projet actif, pas de recherche, pas de Ctrl/Cmd+K, jargon, saisie du jeton dans la barre                                                          | Shell Hive Studio v1.0 (rail unique, barre sobre, accueil Studio, colonne droite repliable), palette Ctrl/Cmd+K, thème sombre | gardes `vues-documentees`, `dashboard-feuilles`, `rien-de-mort` + bancs Studio     |
| **Temps réel / reconnexion**            | WebSocket `/ws` (origine contrôlée, plafond de sockets anonymes), rattrapage du journal après coupure, coupure « écran trop lent » dite à l'écran                                                                                                                                    | **lu**                                                                                                        | —                                                                                                                                                        | Réutilisé tel quel                                                                                                            | bancs `ws-*` (**déclaré**)                                                         |
| **Persistance / reprise**               | SQLite (`better-sqlite3` 13), journal d'événements, instantanés de mission, rétention bornée                                                                                                                                                                                         | **lu**                                                                                                        | —                                                                                                                                                        | —                                                                                                                             | bancs `store-*` et « la ruche monte de la version précédente » en CI (**déclaré**) |
| **Comptes et rôles**                    | JWT, rôles `admin`/`membre`, garde de force brute, inscription ouverte/fermée                                                                                                                                                                                                        | **lu**                                                                                                        | Lectures de projet encore ouvertes au jeton de ruche (que chaque machine membre détient) — **risque connu, assumé et écrit** dans `server.ts` (ADR 0007) | Hors périmètre de ce lot                                                                                                      | —                                                                                  |
| **Git / GitHub / livraison**            | Branches `hive/<taskId>`, plan de merge, livraison locale, PR GitHub, retour CI, reprise                                                                                                                                                                                             | **lu**                                                                                                        | —                                                                                                                                                        | Afficher diff, tests et décision dans le Studio                                                                               | bancs `git-*`, `livraison-*` (**déclaré** ; 9 rouges locaux expliqués en § 3)      |
| **Isolation**                           | Bac `processus`/`conteneur` déclaré par nœud, configuration d'agent écartée de l'arbre de tâche, clone sans identifiants de push                                                                                                                                                     | **lu**                                                                                                        | —                                                                                                                                                        | —                                                                                                                             | `configuration-inerte` (corrigé), `isolement`                                      |
| **Recherche globale**                   | aucune route ; les vues filtrent localement                                                                                                                                                                                                                                          | **lu**                                                                                                        | Absente                                                                                                                                                  | Palette Ctrl/Cmd+K sur les données déjà autorisées à cet écran (instantané + commandes)                                       | à écrire                                                                           |
| **Onboarding**                          | `OnboardingEssaim` (dans Projets), Ruche vide qui propose de commencer                                                                                                                                                                                                               | **lu**                                                                                                        | Pas de premier lancement global, pas d'« Ignorer » mémorisé                                                                                              | 3 étapes, ignorables, rejouables depuis l'aide                                                                                | à écrire                                                                           |

## 6. Défauts classés

| Rang | Défaut                                                           | Dépend de                  | Correction                                                                  |
| ---- | ---------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| P0   | Invitation au jeton maître depuis l'écran                        | —                          | PR #575                                                                     |
| P0   | CI rouge sur `main` (Prettier)                                   | —                          | cette PR                                                                    |
| P1   | Banc `configuration-inerte` dépendant de l'exclusion Git globale | —                          | cette PR                                                                    |
| P1   | Aucun point d'entrée de mission ni mission courante visible      | —                          | PR Studio                                                                   |
| P1   | Pas de recherche ni de palette de commandes                      | —                          | PR Studio                                                                   |
| P2   | Navigation à 14 entrées et jargon apicole en première lecture    | —                          | PR Studio (rail unique, chemins de remplacement documentés)                 |
| P2   | Le jeton de ruche se saisit dans la barre du haut                | —                          | PR Studio (popover de connexion, ouvert d'office quand le jeton est refusé) |
| P3   | Pas de thème sombre                                              | —                          | PR Studio                                                                   |
| P3   | Lectures de projet ouvertes au jeton de ruche                    | décision d'hôte (ADR 0007) | hors lot                                                                    |

## 7. Navigation : où va chaque vue

Aucune vue n'est retirée ; toutes gardent leur adresse (`#/ruche`, `#/miellerie`…) et leur raccourci clavier.

| Rail Hive Studio | Contenu                                                         | Vues existantes rattachées                                                          |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Accueil          | Studio : saisie de mission, mission en cours, espace de travail | nouvelle vue `#/studio`                                                             |
| Projets          | projets, code du projet                                         | `projets`, `rayon`                                                                  |
| Missions         | vue d'ensemble, validation des productions, historique, débats  | `ruche`, `miellerie`, `chronique`, `warroom`                                        |
| Agents           | ouvrières, Reine, santé, mémoire, cerveau (admin)               | `essaim`, `reine`, `sante`, `memoire`, `cerveau`, `chambre` (depuis une fiche nœud) |
| Équipe           | espace personnel, intendance (admin)                            | `monespace`, `intendance`                                                           |
| Automatisations  | chantiers déclarés par le dépôt                                 | `chantiers`                                                                         |
| Marketplace      | projets publics de la ruche                                     | `GET /api/projects/public` (route publique déjà servie)                             |

## 8. Plan de livraison

1. **Cette PR (A)** : `main` repasse au vert, binaires de la maquette, banc fiabilisé, audit.
2. **#575** (existante) : invitations sans jeton maître. À fusionner avant le Studio.
3. **PR Studio** (empilée sur #575) : shell v1.0, thème sombre, accueil Studio branché sur les vraies données, palette Ctrl/Cmd+K, aide et raccourcis, onboarding, colonne agents/activité/invitation, captures aux six résolutions et parcours E2E avec un agent réel.

## Annexe A — inventaire des routes

Relevé automatique de `src/orchestrator/server.ts` à `f93b53b9` : chaque `app.get|post|put|delete|patch`, et les gardes appelées dans son gestionnaire. Les quatre routes sans garde sont publiques par construction (`/api/health`, `/api/edition`, `/api/auth/login`, `/api/projects/public`) ; `/` est la page statique « interface non construite ».

| Domaine                   | Méthode | Route                                                          | Garde(s) détectée(s)                      | `server.ts` |
| ------------------------- | ------- | -------------------------------------------------------------- | ----------------------------------------- | ----------- |
| /                         | GET     | `/`                                                            | _page statique_                           | L4189       |
| admin › cerveau           | GET     | `/api/admin/cerveau`                                           | `role:voir_tous_les_projets`              | L8954       |
| admin › experience        | GET     | `/api/admin/experience`                                        | `role:voir_tous_les_projets`              | L8971       |
| admin › membres           | GET     | `/api/admin/membres`                                           | `role:gerer_membres`                      | L8980       |
| admin › membres           | PUT     | `/api/admin/membres/:userId/role`                              | `role:changer_role`                       | L8989       |
| admin › serveurs          | GET     | `/api/admin/serveurs`                                          | `role:gerer_serveurs`                     | L9030       |
| admin › serveurs          | GET     | `/api/admin/serveurs/:id/billet`                               | `role:gerer_serveurs`                     | L9065       |
| admin › serveurs          | PUT     | `/api/admin/serveurs/:id`                                      | `role:gerer_serveurs`                     | L9089       |
| atelier                   | GET     | `/api/atelier`                                                 | `jeton-ruche`                             | L4869       |
| atelier                   | POST    | `/api/atelier/demarrer`                                        | `role:gerer_serveurs`                     | L4874       |
| atelier                   | POST    | `/api/atelier/arreter`                                         | `role:gerer_serveurs`                     | L4889       |
| auth                      | POST    | `/api/auth/register`                                           | `jeton-ruche`                             | L5977       |
| auth                      | POST    | `/api/auth/login`                                              | _aucune (publique)_                       | L6043       |
| auth                      | GET     | `/api/auth/me`                                                 | `compte`                                  | L6092       |
| balance                   | GET     | `/api/balance`                                                 | `jeton-ruche`                             | L10204      |
| baptemes                  | GET     | `/api/baptemes`                                                | `jeton-ruche`                             | L5000       |
| baptemes                  | POST    | `/api/baptemes`                                                | `role:gerer_serveurs`                     | L5012       |
| baptemes                  | DELETE  | `/api/baptemes/:nodeId`                                        | `role:gerer_serveurs`                     | L5040       |
| billets                   | POST    | `/api/billets`                                                 | `role:gerer_serveurs`                     | L6162       |
| billets                   | DELETE  | `/api/billets/:id`                                             | `role:gerer_serveurs`                     | L9751       |
| chambre                   | GET     | `/api/chambre/:nodeId`                                         | `jeton-ruche`                             | L4905       |
| chat                      | POST    | `/api/chat`                                                    | `jeton-ruche`                             | L10660      |
| cockpit                   | GET     | `/api/cockpit`                                                 | `jeton-ruche`                             | L4699       |
| connecteurs               | GET     | `/api/connecteurs`                                             | `role:gerer_serveurs`                     | L5188       |
| connecteurs               | POST    | `/api/connecteurs/:connecteurId/secrets`                       | `role:gerer_serveurs`                     | L5215       |
| connecteurs               | GET     | `/api/connecteurs/journal`                                     | `role:gerer_serveurs`                     | L5278       |
| conseil                   | GET     | `/api/conseil/:sessionId`                                      | `jeton-ruche`                             | L9192       |
| conseil                   | POST    | `/api/conseil/:sessionId/decision`                             | `jeton-ruche` `compte` `propriete-projet` | L9292       |
| conseils                  | GET     | `/api/conseils`                                                | `jeton-ruche` `compte`                    | L9212       |
| decouverte                | GET     | `/api/decouverte`                                              | `role:gerer_serveurs`                     | L6411       |
| decouverte                | POST    | `/api/decouverte/:id/rejoindre`                                | `role:gerer_serveurs`                     | L6500       |
| edition                   | GET     | `/api/edition`                                                 | _aucune (publique)_                       | L4630       |
| events                    | GET     | `/api/events`                                                  | `jeton-ruche`                             | L9771       |
| gardiennes                | GET     | `/api/gardiennes`                                              | `jeton-ruche`                             | L10149      |
| genome                    | GET     | `/api/genome`                                                  | `jeton-ruche`                             | L12081      |
| ghost                     | GET     | `/api/ghost`                                                   | `jeton-ruche`                             | L10037      |
| github                    | GET     | `/api/github/status`                                           | `jeton-ruche`                             | L6647       |
| github                    | GET     | `/api/github/repos`                                            | `jeton-ruche`                             | L6677       |
| github                    | POST    | `/api/github/import`                                           | `jeton-ruche` `compte`                    | L6718       |
| guet                      | GET     | `/api/guet`                                                    | `jeton-ruche`                             | L10092      |
| health                    | GET     | `/api/health`                                                  | _aucune (publique)_                       | L4601       |
| hive-mind                 | GET     | `/api/hive-mind`                                               | `jeton-ruche`                             | L10794      |
| invite                    | GET     | `/api/invite`                                                  | `role:gerer_serveurs`                     | L6104       |
| livraison                 | POST    | `/api/livraison`                                               | `ecriture-depot` `garde:engagementTache`  | L7184       |
| livraison                 | POST    | `/api/livraison/fusion`                                        | `ecriture-depot` `porte-rejeu`            | L7409       |
| membres                   | GET     | `/api/membres`                                                 | `role:gerer_serveurs`                     | L9643       |
| membres                   | DELETE  | `/api/membres/:nodeId`                                         | `role:gerer_serveurs`                     | L9676       |
| metiers                   | GET     | `/api/metiers`                                                 | `jeton-ruche`                             | L5052       |
| metiers                   | POST    | `/api/metiers`                                                 | `role:gerer_serveurs`                     | L5061       |
| moi                       | GET     | `/api/moi/tableau`                                             | `compte`                                  | L14300      |
| motifs                    | GET     | `/api/motifs`                                                  | `jeton-ruche`                             | L5834       |
| nodes                     | POST    | `/api/nodes/:nodeId/outils/:outilId/poser`                     | `role:gerer_serveurs`                     | L9715       |
| openalex                  | GET     | `/api/openalex/search`                                         | `jeton-ruche` `compte`                    | L14369      |
| pheromones                | GET     | `/api/pheromones`                                              | `jeton-ruche`                             | L10122      |
| plan                      | POST    | `/api/plan`                                                    | `jeton-ruche`                             | L10623      |
| polyethisme               | GET     | `/api/polyethisme`                                             | `jeton-ruche`                             | L10167      |
| presences                 | GET     | `/api/presences`                                               | `jeton-ruche`                             | L4976       |
| projet › abonnement       | GET     | `/api/projects/:projectId/abonnement`                          | `lecture-projet`                          | L8789       |
| projet › adopter          | POST    | `/api/projects/:projectId/adopter`                             | `compte`                                  | L14199      |
| projet › apercu           | GET     | `/api/projects/:projectId/apercu`                              | `garde:projetLisible`                     | L13791      |
| projet › balance          | GET     | `/api/projects/:projectId/balance`                             | `lecture-projet`                          | L10245      |
| projet › balance          | PUT     | `/api/projects/:projectId/balance`                             | `compte` `propriete-projet`               | L10289      |
| projet › banc-ombre       | GET     | `/api/projects/:projectId/banc-ombre`                          | `lecture-projet`                          | L8110       |
| projet › banc-ombre       | POST    | `/api/projects/:projectId/banc-ombre`                          | `compte` `propriete-projet`               | L8134       |
| projet › brief            | POST    | `/api/projects/:projectId/brief`                               | `engagement-projet`                       | L13402      |
| projet › chantiers        | GET     | `/api/projects/:projectId/chantiers`                           | `lecture-projet`                          | L11680      |
| projet › chantiers        | POST    | `/api/projects/:projectId/chantiers/:nom/run`                  | `engagement-projet`                       | L11696      |
| projet › chantiers        | GET     | `/api/projects/:projectId/chantiers/result`                    | `lecture-projet`                          | L11980      |
| projet › conflicts        | GET     | `/api/projects/:projectId/conflicts`                           | `lecture-projet`                          | L11029      |
| projet › connecteurs      | GET     | `/api/projects/:projectId/connecteurs`                         | `lecture-projet` `propriete-projet`       | L5293       |
| projet › connecteurs      | POST    | `/api/projects/:projectId/connecteurs/:connecteurId/autoriser` | `propriete-projet`                        | L5325       |
| projet › connecteurs      | DELETE  | `/api/projects/:projectId/connecteurs/:connecteurId`           | `propriete-projet`                        | L5408       |
| projet › connecteurs      | POST    | `/api/projects/:projectId/connecteurs/:connecteurId/test`      | `compte` `propriete-projet`               | L5440       |
| projet › conseil          | POST    | `/api/projects/:projectId/conseil`                             | `engagement-projet`                       | L9153       |
| projet › essaim           | GET     | `/api/projects/:projectId/essaim`                              | `jeton-ruche` `lecture-projet`            | L7817       |
| projet › essaim           | GET     | `/api/projects/:projectId/essaim/cycles`                       | `lecture-projet`                          | L7877       |
| projet › essaim           | POST    | `/api/projects/:projectId/essaim`                              | `propriete-projet` `ecriture-depot`       | L7931       |
| projet › experience       | GET     | `/api/projects/:projectId/experience`                          | `lecture-projet`                          | L12120      |
| projet › fabriques        | GET     | `/api/projects/:projectId/fabriques`                           | `lecture-projet`                          | L5641       |
| projet › fabriques        | POST    | `/api/projects/:projectId/fabriques`                           | `engagement-projet`                       | L5653       |
| projet › fabriques        | POST    | `/api/projects/:projectId/fabriques/:id/statut`                | `engagement-projet`                       | L5712       |
| projet › fabriques        | POST    | `/api/projects/:projectId/fabriques/juger-chantier`            | `lecture-projet`                          | L5744       |
| projet › garde-fou        | GET     | `/api/projects/:projectId/garde-fou`                           | `lecture-projet`                          | L8001       |
| projet › garde-fou        | POST    | `/api/projects/:projectId/garde-fou`                           | `propriete-projet`                        | L8029       |
| projet › horizon          | GET     | `/api/projects/:projectId/horizon`                             | `lecture-projet`                          | L5784       |
| projet › horizon          | POST    | `/api/projects/:projectId/horizon`                             | `propriete-projet`                        | L5798       |
| projet › issues           | GET     | `/api/projects/:projectId/issues`                              | `engagement-projet`                       | L13230      |
| projet › issues           | POST    | `/api/projects/:projectId/issues/:numero`                      | `engagement-projet`                       | L13271      |
| projet › join             | POST    | `/api/projects/:projectId/join`                                | `compte`                                  | L13542      |
| projet › livraison-locale | POST    | `/api/projects/:projectId/livraison-locale`                    | `propriete-projet` `ecriture-depot`       | L11441      |
| projet › livraisons       | GET     | `/api/projects/:projectId/livraisons`                          | `engagement-projet`                       | L12973      |
| projet › livraisons       | POST    | `/api/projects/:projectId/livraisons/:taskId/reprendre`        | `engagement-projet`                       | L13052      |
| projet › members          | GET     | `/api/projects/:projectId/members`                             | `compte`                                  | L14172      |
| projet › membres          | POST    | `/api/projects/:projectId/membres`                             | `compte`                                  | L14223      |
| projet › membres          | DELETE  | `/api/projects/:projectId/membres/:userId`                     | `compte`                                  | L14260      |
| projet › merge            | GET     | `/api/projects/:projectId/merge`                               | `lecture-projet`                          | L11052      |
| projet › merge            | POST    | `/api/projects/:projectId/merge/run`                           | `engagement-projet`                       | L11384      |
| projet › merge            | GET     | `/api/projects/:projectId/merge/result`                        | `lecture-projet`                          | L11990      |
| projet › missions         | GET     | `/api/projects/:projectId/missions`                            | `lecture-projet`                          | L9845       |
| projet › missions         | GET     | `/api/projects/:projectId/missions/:missionId`                 | `lecture-projet`                          | L9904       |
| projet › missions         | POST    | `/api/projects/:projectId/missions/:missionId/rejouer`         | `compte` `propriete-projet`               | L9925       |
| projet › motifs           | POST    | `/api/projects/:projectId/motifs/:motifId/appliquer`           | `engagement-projet`                       | L5848       |
| projet › motifs           | GET     | `/api/projects/:projectId/motifs/perso`                        | `lecture-projet`                          | L5894       |
| projet › motifs           | POST    | `/api/projects/:projectId/motifs/perso`                        | `engagement-projet`                       | L5906       |
| projet › motifs           | POST    | `/api/projects/:projectId/motifs/perso/:motifId/appliquer`     | `engagement-projet`                       | L5942       |
| projet › partages         | POST    | `/api/projects/:projectId/partages`                            | `compte`                                  | L14069      |
| projet › partages         | GET     | `/api/projects/:projectId/partages`                            | `compte`                                  | L14119      |
| projet › partages         | DELETE  | `/api/projects/:projectId/partages/:partageId`                 | `compte`                                  | L14149      |
| projet › rayon            | GET     | `/api/projects/:projectId/rayon`                               | `garde:projetLisible`                     | L13734      |
| projet › rayon            | GET     | `/api/projects/:projectId/rayon/fichier`                       | `garde:projetLisible`                     | L13751      |
| projet › rayon            | POST    | `/api/projects/:projectId/rayon/retouche`                      | `compte`                                  | L13862      |
| projet › rejeu            | GET     | `/api/projects/:projectId/rejeu/comparaison`                   | `lecture-projet`                          | L9980       |
| projet › report           | GET     | `/api/projects/:projectId/report`                              | `lecture-projet`                          | L10836      |
| projet › sauvegardes      | GET     | `/api/projects/:projectId/sauvegardes`                         | `garde:projetLisible`                     | L13937      |
| projet › sauvegardes      | GET     | `/api/projects/:projectId/sauvegardes/:sauvegardeId`           | `garde:projetLisible`                     | L13950      |
| projet › sauvegardes      | POST    | `/api/projects/:projectId/sauvegardes`                         | `engagement-projet`                       | L13963      |
| projet › sauvegardes      | POST    | `/api/projects/:projectId/sauvegardes/:sauvegardeId/restaurer` | `engagement-projet`                       | L14013      |
| projet › tasks            | POST    | `/api/projects/:projectId/tasks`                               | `engagement-projet`                       | L10921      |
| projet › workflows        | GET     | `/api/projects/:projectId/workflows`                           | `lecture-projet`                          | L11850      |
| projet › workflows        | GET     | `/api/projects/:projectId/workflows/runs`                      | `lecture-projet`                          | L11872      |
| projet › workflows        | POST    | `/api/projects/:projectId/workflows/:workflowId/run`           | `engagement-projet` `porte-rejeu`         | L11907      |
| projets                   | POST    | `/api/projects`                                                | `jeton-ruche`                             | L10366      |
| projets                   | DELETE  | `/api/projects/:projectId`                                     | `compte`                                  | L10507      |
| projets                   | GET     | `/api/projects/public`                                         | _aucune (publique)_                       | L13489      |
| projets                   | POST    | `/api/projects/user`                                           | `compte`                                  | L13494      |
| pulse                     | GET     | `/api/pulse`                                                   | `jeton-ruche`                             | L10098      |
| queen                     | GET     | `/api/queen/cles`                                              | `jeton-ruche`                             | L5116       |
| queen                     | POST    | `/api/queen/cles`                                              | `role:gerer_serveurs`                     | L5131       |
| races                     | GET     | `/api/races`                                                   | `jeton-ruche`                             | L12805      |
| rejoindre                 | POST    | `/api/rejoindre`                                               | `debit-join`                              | L6262       |
| replay                    | GET     | `/api/replay`                                                  | `jeton-ruche`                             | L9800       |
| requisitions              | GET     | `/api/requisitions`                                            | `jeton-ruche`                             | L5094       |
| requisitions              | POST    | `/api/requisitions`                                            | `jeton-ruche`                             | L5508       |
| requisitions              | POST    | `/api/requisitions/:id/repondre`                               | `role:gerer_serveurs`                     | L5548       |
| reviews                   | GET     | `/api/reviews`                                                 | `jeton-ruche`                             | L12436      |
| state                     | GET     | `/api/state`                                                   | `jeton-ruche`                             | L5971       |
| tâche › cancel            | POST    | `/api/tasks/:taskId/cancel`                                    | `garde:decisionTache`                     | L12811      |
| tâche › chronologie       | GET     | `/api/tasks/:taskId/chronologie`                               | `jeton-ruche`                             | L12055      |
| tâche › consensus         | GET     | `/api/tasks/:taskId/consensus`                                 | `jeton-ruche`                             | L12446      |
| tâche › consigne-routage  | GET     | `/api/tasks/:taskId/consigne-routage`                          | `lecture-projet`                          | L12197      |
| tâche › consigne-routage  | PUT     | `/api/tasks/:taskId/consigne-routage`                          | `compte` `garde:decisionTache`            | L12226      |
| tâche › critique          | GET     | `/api/tasks/:taskId/critique`                                  | `jeton-ruche`                             | L12397      |
| tâche › delegation        | GET     | `/api/tasks/:taskId/delegation`                                | `jeton-ruche`                             | L12147      |
| tâche › evaluation        | GET     | `/api/tasks/:taskId/evaluation`                                | `jeton-ruche`                             | L12480      |
| tâche › evaluation        | POST    | `/api/tasks/:taskId/evaluation/ci`                             | `garde:engagementTache`                   | L12504      |
| tâche › evaluation        | POST    | `/api/tasks/:taskId/evaluation/retry`                          | `garde:engagementTache`                   | L12677      |
| tâche › race              | POST    | `/api/tasks/:taskId/race`                                      | `garde:engagementTache`                   | L12741      |
| tâche › race              | GET     | `/api/tasks/:taskId/race`                                      | `jeton-ruche`                             | L12774      |
| tâche › results           | GET     | `/api/tasks/:taskId/results`                                   | `jeton-ruche`                             | L12012      |
| tâche › review            | POST    | `/api/tasks/:taskId/review`                                    | `garde:decisionTache`                     | L12301      |
| tâche › routage           | GET     | `/api/tasks/:taskId/routage`                                   | `jeton-ruche`                             | L12031      |
| thermo                    | GET     | `/api/thermo`                                                  | `jeton-ruche`                             | L10107      |
| user                      | GET     | `/api/user/projects`                                           | `compte`                                  | L14353      |
| version                   | GET     | `/api/version`                                                 | `jeton-ruche`                             | L4619       |
| waggle                    | GET     | `/api/waggle`                                                  | `jeton-ruche`                             | L10030      |
| war-room                  | GET     | `/api/war-room`                                                | `jeton-ruche` `lecture-projet`            | L9431       |
| webhooks                  | POST    | `/api/webhooks/abonnement`                                     | `compte`                                  | L8823       |
| workers                   | GET     | `/api/workers`                                                 | `jeton-ruche`                             | L4648       |
| workers                   | GET     | `/api/workers/:nodeId/bilan`                                   | `jeton-ruche`                             | L4834       |
