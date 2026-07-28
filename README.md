<div align="center">

# 🐝 Hive

**Orchestration communautaire d'agents IA — l'essaim, en temps réel, persistant et visible.**

🇫🇷 Français · [🇬🇧 English](README.en.md)

**🌐 [Découvrir Hive — le site vitrine](https://micka420-collab.github.io/hive/)**

**🤝 [Proposer un projet à la ruche](https://github.com/Micka420-collab/hive/issues/new?template=proposer-un-projet.yml)** · [voir les projets proposés](https://github.com/Micka420-collab/hive/issues?q=is%3Aissue+label%3A%22projet+propos%C3%A9%22)

<sub>Le site vit dans `site/` et se déploie tout seul à chaque push sur `main`. Première mise en ligne : **Settings → Pages → Source : GitHub Actions**, puis relancer le workflow _Site_. (Sur un dépôt privé, Pages demande une offre payante ; sur un dépôt public, c'est gratuit.)</sub>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="version">
  <a href="https://github.com/Micka420-collab/hive/actions/workflows/ci.yml"><img src="https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="node">
</p>

Une _Queen_ centrale découpe un projet en tâches et les distribue aux machines des membres (_Nodes_), qui exécutent chacune leurs agents de codage (_ouvrières_) dans des espaces de travail isolés. Le contrôle est centralisé ; **le code et les clés restent chez chaque membre.**

[![CI](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A520-3c873a)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Tests](https://img.shields.io/badge/tests-561%20passing-2ea44f)
![Palier](https://img.shields.io/badge/palier%205-livr%C3%A9-2ea44f)

</div>

---

## ✨ En bref

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎛️ **Mission Control**  | 10 vues navigables (sidebar alvéolaire, touches 1-9 et 0, deep-links `#/vue/id`), **interface bilingue FR/EN** (bascule topbar) : Ruche, Reine, Miellerie, Projets, Essaim, Santé, Chronique, Mémoire, Mon espace, Intendance (admins).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 👑 **La Reine répond**  | Chat multilingue avec la ruche (`POST /api/chat`, CLI `ask`) : avancement réel, santé, classement, aide au brief avec bonnes pratiques. IA optionnelle, repli hors-ligne garanti.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 🍯 **Miellerie**        | Centre de revue des productions IA : diff par fichier, logs, consensus du Parlement, approbation au clavier (j/k/a/x), merge Honeycomb en un geste.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🐝 **Le Rayon**         | **Le code du projet, lisible par les abeilles** : arbre de fichiers, éditeur coloré (16 langages), **aperçu du site produit** dans une origine opaque, **retouche → tâche** pour la Reine, et un **lien de partage en lecture** qui ne donne pas la ruche. Miroir local du hub, jamais l'API GitHub — montrer le code ne dépense pas le jeton de l'hôte.                                                                                                                                                                                                                                                                                                                               |
| 📦 **L'environnement**  | Le merge prépare avant de tester (`npm ci`, `pip install -r`…). **Ce que le DÉPÔT déclare, jamais ce que la commande nomme** : pas de paquet nommé par le hub, pas de source déplacée. Installation en échec ≠ tests rouges — les tests ne tournent pas et le rapport le dit.                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🧠 **Queen Bee**        | Décrivez un projet en une phrase → un **DAG de tâches** est généré (heuristique ou IA).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 🧬 **Hive Mind**        | Mémoire partagée : la ruche apprend des tâches réussies et réinjecte le savoir dans les suivantes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🛡️ **Sting Detector**   | Repère les tâches concurrentes qui toucheraient le même fichier et **sérialise** pour éviter les conflits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🕸️ **Hub-and-spoke**    | Un orchestrateur, N nœuds membres. Temps réel via WebSocket, état persistant en SQLite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 🐝 **Swarm View**       | Vue vivante de l'essaim, en **2D (SVG léger)** ou **3D ([Galacean Engine](https://github.com/galacean/engine))**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ⚔ **Drone Wars**        | Redondance compétitive opt-in : `npm run cli -- race <taskId> [2-5]` (ou bouton du tiroir) — la même tâche sur plusieurs nœuds, le premier succès gagne, les perdants sont annulés. Suivi : `races` (CLI), badge ⚔ dans l'Essaim, bonus nectar au vainqueur.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 💓 **Pouls & fantômes** | Signes vitaux agrégés (`/api/pulse`), anomalies (`/api/ghost`), classement nectar (`/api/waggle`), time-lapse (`/api/replay`), rapport projet (`/api/projects/:id/report`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 🐜 **Phéromones**       | La ruche apprend **quel nœud réussit quel type de tâche** (api, ui, db, tests, docs, infra) et départage les ouvrières à charge égale. Signal évaporé en 7 jours. `/api/pheromones`, événement `pheromone_route`, carte dans l'Essaim.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🌡️ **Thermorégulation** | Quand les échecs s'accumulent, la ruche **ventile** : la concurrence par nœud baisse (×0,75 puis ×0,5) le temps de refroidir, avec hystérésis anti-clignotement. `/api/thermo`, événement `thermo_shift`, jauge dans Santé.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 👶 **Couveuse**         | Une tâche re-tentée repart avec les **leçons de ses échecs précédents**, injectées dans un bloc de données isolé des instructions (anti-injection de prompt). Événement `brood_context`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ⚖️ **La Balance**       | Le pèse-ruche : **peser** (utile / reprise / échec / rebuté), **prévoir** (devis d'un DAG) et **borner** — plafond par projet, doublement opt-in : `HIVE_BALANCE=strict` **et** un plafond posé à la main. `/api/balance`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🛂 **Les Gardiennes**   | Contrôle d'entrée du nectar : un « succès » à **diff vide**, **hors des fichiers promis**, **non applicable** ou aux **logs qui crient l'échec** n'entre pas sur parole. `HIVE_GARDIENNES=off\|consultatif\|strict` (défaut : annoter, ne rien refuser). `/api/gardiennes`, `guard_refused`.                                                                                                                                                                                                                                                                                                                                                                                           |
| 🐝 **Plein Essaim**     | L'autonomie RÉELLE : la ruche décide (`deciderPas`), agit, et se cadence toute seule. **Deux interrupteurs en série** — le niveau, choisi par l'utilisateur, et `HIVE_RUNNER=off\|on`, choisi par l'hôte qui paie le temps-machine (défaut : `off`). Un cycle par projet et par minute, recul exponentiel puis pause après 5 échecs, et le gros bouton rouge arrête AVANT l'effet. Elle **délibère**, **planifie**, **corrige**, **livre** (pull request sur le dépôt, uniquement pour une production APPROUVÉE par un humain) et **fusionne** (niveau `plein` ET dépôt inscrit ; les protections de branche du propriétaire restent la dernière barrière). `essaim_cycle` au Journal. |
| 🐙 **Connecter GitHub** | **En un clic depuis la vue Projets** (panneau « Connecter un dépôt GitHub ») ou en ligne de commande (`npm run cli -- github`). Les dépôts arrivent les plus récents d'abord, privé/archivé/langage marqués, déjà-connectés signalés. Le dépôt connecté **appartient à qui l'a connecté** ; le jeton GitHub reste sur l'orchestrateur, **jamais en base et jamais dans le navigateur**.                                                                                                                                                                                                                                                                                                |
| 🤝 **Inviter un ami**   | Un **billet** à coller : éphémère, à usage compté, **révocable**. Il ne donne aucun pouvoir sur la ruche — il sert à obtenir une **clé propre à la machine**, donc on peut exclure **une** personne sans éjecter l'essaim. `tunnel` ouvre un accès distant chiffré sans ouvrir de port.                                                                                                                                                                                                                                                                                                                                                                                                |
| 🔒 **Sûr par défaut**   | Zéro `shell: true`, token constant-time, CORS strict, sandbox par tâche, clés jamais exfiltrées. **Jamais de merge sans revue humaine.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🧩 **Agent-agnostique** | `shell` (simulé), `claude-code`, `codex`, `hermes-agent`, `custom` — ou votre propre `AgentAdapter`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 🗺️ Architecture

```
                          ┌──────────────────────────────┐
       WebSocket  ◄──────►│     Orchestrateur (Queen)    │◄──────►  WebSocket
                          │   Fastify · ws · SQLite      │
   ┌───────────────┐      │   scheduler · journal        │      ┌───────────────┐
   │  Node membre  │      │   Queen Bee (planner)        │      │  Node membre  │
   │  ruche-alpha  │      └───────────────┬──────────────┘      │  ruche-beta   │
   │ agents+sandbox│                      │ HTTP :7777           │ agents+sandbox│
   └───────────────┘              ┌───────┴────────┐            └───────────────┘
                                  │   Swarm View   │
                                  │ React · 2D/3D  │
                                  └────────────────┘
```

## 🤝 Rejoindre la ruche d'un ami — une commande, sans rien cloner

On vous a envoyé un billet ? Une seule ligne suffit :

```bash
npx github:Micka420-collab/hive join hive2_votre-billet
```

Pas de `git clone`, pas de dashboard, pas de base de données : **4 Mo et
9 paquets**. Le billet contient l'adresse de la ruche et de quoi obtenir une
clé propre à votre machine — il n'y a aucun fichier à éditer.

Pour ne strictement rien installer de superflu :

```bash
npm install -g github:Micka420-collab/hive --omit=optional
hive join hive2_votre-billet
```

`--omit=optional` retire Fastify et SQLite, dont **seule** la ruche complète a
besoin. Un nœud qui prête du temps-machine ne lance pas de serveur.

> Avant, il fallait cloner le dépôt et installer **218 Mo et 279 paquets** —
> dont un moteur 3D et un éditeur de code, pour un dashboard qu'un nœud
> n'ouvre jamais.

## ⚡ Installation (une commande)

```bash
npm run setup
```

Vérifie Node, installe les dépendances, engendre un jeton aléatoire, écrit un
`.env` commenté en `600`, et détecte votre agent de codage. Il ne touche à
**rien** en dehors du dossier du projet : pas de `sudo`, pas de paquet système,
pas de service au démarrage.

Relançable sans risque : **une valeur déjà présente dans `.env` n'est jamais
réécrite** — écraser un jeton en service couperait tous les nœuds connectés.

## 🚀 Démarrage rapide (démo)

Prérequis : **Node.js ≥ 20**.

```bash
npm install
npm run demo
```

Ouvrez **http://localhost:7777** : le Swarm View montre en direct l'orchestrateur,
2 nœuds simulés (`ruche-alpha`, `ruche-beta`) et un projet de démonstration de
**7 tâches avec dépendances** (DAG). La tâche « API de facturation » échoue
volontairement à sa première tentative pour illustrer le mécanisme de _retry_,
et une 8e tâche part en **course de drones** (⚔) sur les deux nœuds dès qu'ils
sont en ligne — badge ⚔ dans l'Essaim, `npm run cli -- races` pour la suivre.

- **Basculez 2D ⇄ 3D** en haut à droite. La vue 3D (alvéoles hexagonales,
  ouvrières en orbite, fils lumineux nœud↔tâche, caméra orbitale) est **chargée à
  la demande** (~290 Ko gzip) et retombe proprement si WebGL est indisponible.
- **Ouvrez une tâche** : un tiroir affiche diff et logs dans un **éditeur
  CodeMirror 6** (coloration, numéros de ligne), lui aussi chargé à la demande.
- **Testez la persistance** : `Ctrl+C` en pleine exécution, puis relancez
  `npm run demo` — le projet et son avancement sont toujours là ; les tâches
  orphelines (`running` au crash) repartent proprement en `ready`.

La démo tourne en **mode simulation** (`HIVE_SIMULATION=1`) : adaptateur shell
simulé, aucun processus lancé, token par défaut toléré (uniquement dans ce mode).

## 🎛️ Mission Control — l'interface de pilotage

Le dashboard (servi sur `:7777`) est une application complète de gestion de la
ruche, navigable au clavier (touches **1-9**, `0`) via une sidebar alvéolaire :

| Vue               | Ce qu'on y fait                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐝 **Ruche**      | Vue d'ensemble : Swarm View 2D/3D, KPIs, rayon de miel cliquable, file d'attente, journal.                                                                                        |
| 👑 **Reine**      | Dialoguer avec la ruche dans **votre langue** : avancement, santé, classement, aide au cadrage de brief.                                                                          |
| 🍯 **Miellerie**  | **Revoir ce que les IA ont produit** : diffs par fichier, logs, consensus du Parlement, approbation (a) ou rejet (x) au clavier, puis merge Honeycomb.                            |
| ⬡ **Projets**     | Connecter un dépôt GitHub, rapports d'avancement, atelier brief→DAG (Queen Bee), plan et lancement de merge, conflits Sting, équipe, partage en lecture, Conseil des Éclaireuses. |
| 🐝 **Rayon**      | **Le code du projet, lisible** : arbre de fichiers, éditeur coloré, aperçu du site produit, et retouche → tâche pour la Reine.                                                    |
| 🕺 **Essaim**     | Cartes des nœuds membres + Waggle Board (podium nectar).                                                                                                                          |
| 💓 **Santé**      | Pouls de la ruche (débit, latences p50/p95, succès) + anomalies Ghost.                                                                                                            |
| 📜 **Chronique**  | Journal filtrable + Time-Lapse Replay (mode sépia « vous regardez le passé »).                                                                                                    |
| 🧠 **Mémoire**    | Recherche dans le savoir de la ruche (Hive Mind) + bibliothèque scientifique OpenAlex.                                                                                            |
| 🪪 **Mon espace** | Le tableau de bord d'une personne : ses projets, son quota, ses abonnements, ses machines — et ce qui réclame son attention, classé par urgence.                                  |
| 🖥 **Intendance**  | _Administrateurs seulement._ Les machines démarrées pour les abonnés, les comptes de la ruche, et **les clés** : qui a une clé de votre ruche, et de quoi la révoquer.            |

**Mon espace** répond à une seule question : _qu'est-ce qui va me coûter quelque
chose si je ne fais rien aujourd'hui ?_ Les alertes passent donc avant les
cartes, et leur ordre est une prise de position — ce qui est **irréversible**
(des données sur le point d'être effacées) prime ce qui coupe le service, qui
prime un quota qui se vide. Une facture se règle après coup ; des données
effacées ne reviennent pas.

**L'Intendance** exige un COMPTE administrateur, jamais le seul jeton de ruche :
celui-ci est distribué à chaque nœud membre, et s'en servir comme preuve
donnerait les pleins pouvoirs à toute machine qui butine. Le premier compte créé
est administrateur, et le dernier ne peut pas se retirer.

Les décisions de revue sont **partagées entre tous les opérateurs** (stockées
côté orchestrateur, synchronisées en temps réel via WebSocket ; repli
localStorage hors-ligne). « Couler le miel » n'intègre que les productions
**approuvées** — le merge reste toujours un geste humain explicite.

## 🐝 Le Rayon — voir le code, voir l'IA travailler

Ce que les membres voyaient jusqu'ici, c'étaient des **tâches** : des titres,
des états, des diffs. Jamais le code. On travaillait sur un projet sans pouvoir
l'ouvrir — comme aider à réparer un moteur sans avoir le droit de soulever le
capot. Le Rayon ouvre le capot.

| Ce qu'on y trouve      | Pour qui                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| **Arbre + éditeur**    | Toute abeille qui a accès au projet. Coloration pour 16 langages, fichiers bornés à 512 Ko.      |
| **L'Aperçu**           | Le site que l'IA vient d'écrire, **rendu** — pas seulement son diff.                             |
| **La retouche**        | La Reine seulement. Corriger une ligne à l'écran crée une **tâche**, jamais une écriture.        |
| **Le lien de partage** | Montrer l'avancement et le code **sans donner la ruche** : jeton distinct, expirable, révocable. |

**Le hub tient son propre miroir** : un clone superficiel en lecture seule par
projet (`data/rayons/<id>`), rafraîchi au plus une fois par minute. Passer par
l'API GitHub aurait exigé le **jeton de l'hôte** — montrer le code à une abeille
dépenserait pour elle un droit qui n'est pas le sien. **`.git` n'est jamais
servi** : il contient `config`, donc l'URL distante, donc les identifiants du
dépôt privé ; ni `.env`, `.npmrc`, `id_rsa` et les extensions de clés.

**La retouche ne s'enregistre pas — elle se propose.** Le miroir est une copie
jetable : y écrire donnerait l'illusion d'avoir corrigé quelque chose, jusqu'au
prochain rafraîchissement qui effacerait tout en silence. Une modification
devient donc une **tâche** avec le contexte du fichier, qui passe par la revue
comme n'importe quelle production. Un porteur de lien de partage **lit** ; il ne
fabrique pas de travail pour l'essaim de quelqu'un d'autre.

**L'Aperçu s'exécute dans une origine opaque.** Prévisualiser un site que l'agent
vient d'écrire, c'est exécuter dans votre navigateur du HTML et du JavaScript que
personne n'a relus : servi en même origine que le tableau de bord, trois lignes
suffiraient à envoyer votre jeton de session ailleurs. Le document est donc replié
en un seul fichier auto-suffisant et affiché dans une `<iframe sandbox>` **sans
`allow-same-origin`** — le cadre ne lit ni le `localStorage`, ni les cookies — avec
une `Content-Security-Policy` qui coupe le réseau (`connect-src 'none'`,
`form-action 'none'`) et sans aucune navigation possible.

**Faire entrer une ouvrière dans un projet privé** se fait depuis le panneau
« Équipe » de la vue Projets. Un dépôt importé de GitHub arrive **sans
propriétaire** — l'import s'authentifie par le jeton de ruche, qui n'est le
compte de personne : un administrateur l'**adopte** d'abord, puis admet qui il
veut. On admet par **identifiant de compte**, jamais par courriel : le courriel
ferait de cette route un oracle « ce courriel a-t-il un compte ici ? »
interrogeable par tout propriétaire de projet. Chacun lit son propre
identifiant sur cette même carte, et le donne comme on se passe un billet.

**Partager en lecture** se fait depuis le panneau « Partage en lecture » de la
vue Projets, et donne une URL à coller :

```
https://<votre-tunnel>/#/rayon/<projet>?partage=hive3_…
```

Celui qui l'ouvre n'a **ni compte ni jeton de ruche** : il arrive sur un écran
dépouillé qui dit ce qu'il est (lecture seule), montre l'avancement et le code,
et rien d'autre — pas de barre latérale, pas d'essaim, pas de journal, et aucun
bouton de retouche. Il ne voit pas non plus **qui** travaille : les identifiants
de nœuds nomment les machines de gens qui n'ont pas consenti à figurer dans un
lien qu'on fait circuler. Le jeton voyage après le `#` — donc il n'apparaît dans
aucun journal d'accès — et il est retiré de la barre d'adresse dès qu'il est
rangé.

Le jeton de partage n'est **pas** le jeton de ruche : il porte deux actes
seulement (voir l'avancement, lire le code), vaut pour **un** projet, expire
(7 jours par défaut, 90 au plus) et se révoque un par un sans toucher aux
autres.

## 📦 L'environnement — l'agent installe ce dont il a besoin

`npm test` sur un clone frais échoue faute de `node_modules`. Le merge accepte
donc une **préparation** avant les tests :

```bash
npm run cli -- merge-run <projectId> -- --preparer npm ci --tester npm test
# ou les deux champs du panneau « Plan de merge » dans ⬡ Projets
```

**La préparation installe ce que le DÉPÔT déclare, jamais ce que la COMMANDE
nomme.** `npm ci` lit le `package-lock.json` du dépôt ; `npm install lodash`
laisse le hub choisir ce qui s'exécute sur la machine d'un membre. Sont donc
refusés : les binaires qui n'installent rien (`sh`, `curl`, `make`), les
sous-commandes qui ne sont pas des installations (`npm run deploy`), les
arguments qui nomment un paquet, et les drapeaux qui déplacent la **source**
(`--index-url`, `--registry`, `--userconfig`…). La préparation passe par le bac
à sable du nœud, comme les tests.

Si l'installation échoue — machine hors ligne, registre injoignable, lockfile
désaccordé — **les tests ne sont pas lancés** et le rapport le dit : « environnement
non préparé ». Un `✘ tests rouges` vous aurait envoyé chercher une régression
dans du code qui va très bien.

## 👑 La Reine répond — parler à la ruche

Chaque membre (donneur d'ordre comme porteur de nœud) peut interroger la ruche
en langage naturel — la langue du message est détectée et la réponse arrive
dans cette langue :

```bash
npm run cli -- ask "Où en est le projet ?"
npm run cli -- ask "Which node works best?"
# ou : POST /api/chat { "message": "…", "projectId"?: "…" } · vue 👑 Reine du dashboard
```

Deux modes, jamais bloquants : **état réel** (réponses déterministes composées
depuis les rapports, le pouls, le nectar, les anomalies et la mémoire — 100 %
hors-ligne) et **IA** (si `ANTHROPIC_API_KEY` est définie côté Queen :
`HIVE_CHAT_MODEL`, défaut `claude-haiku-4-5` ; la clé ne quitte jamais
l'orchestrateur, et le modèle ne reçoit que les chiffres réels de la ruche).
La Reine guide aussi le donneur d'ordre : bonnes pratiques par type de projet
(web, API, mobile, data, e-commerce, CLI) et structure de brief efficace.

## 🧠 Queen Bee — du brief au DAG (Palier 2)

Dans **« Nouveau projet »**, décrivez l'objectif en langage naturel et cliquez
**« ✨ Générer les tâches »** : Hive propose un graphe de tâches, éditable avant
lancement. En terminal : `POST /api/plan { "brief": "…" }`.

Le planner est **pluggable**, avec repli automatique — jamais bloquant :

| Mode            | Quand                                          | Coût / clé                |
| --------------- | ---------------------------------------------- | ------------------------- |
| **Heuristique** | Défaut. Découpage déterministe par mots-clés.  | Hors-ligne, gratuit       |
| **IA (Claude)** | Si `ANTHROPIC_API_KEY` est définie côté Queen. | Clé **locale** à la Queen |

```bash
# Activer le planner IA (facultatif) — la clé ne quitte jamais l'orchestrateur.
ANTHROPIC_API_KEY=sk-ant-…            # présence → mode IA, sinon heuristique
HIVE_PLANNER_MODEL=claude-haiku-4-5   # défaut rapide/économique ; opus pour + de finesse
```

## 🧩 Hive Mind — la ruche apprend (Palier 2)

La ruche garde une **mémoire partagée** : chaque tâche réussie laisse un
_souvenir_ (ce qui a été fait + un extrait des logs). Avant d'assigner une
nouvelle tâche, l'orchestrateur récupère les souvenirs les plus pertinents et
**les injecte dans le prompt de l'ouvrière** — les tâches suivantes profitent du
travail déjà accompli.

La récupération est **100 % hors-ligne** (scoring lexical type BM25, sans
embeddings ni API), donc déterministe et sans coût. Le dashboard affiche un
**panneau Hive Mind** (recherche + souvenirs récents, en direct). Interrogez la
mémoire :

```bash
npm run cli -- mind "authentification jwt"   # souvenirs les plus pertinents
npm run cli -- mind                          # souvenirs récents
# ou : GET /api/hive-mind?q=…
```

## 🛡️ Sting Detector — prévention de conflits (Palier 2)

Deux tâches qui pourraient tourner **en même temps** (aucun ordre de dépendance
entre elles) et qui **touchent le même fichier** risquent de se marcher dessus.
Le Sting Detector les repère — analyse hors-ligne des titres/prompts, sans
exécuter d'agent :

- **Conflit fort** (même fichier cité) → l'ordonnanceur **diffère** l'une des
  deux jusqu'à ce que l'autre se termine (sérialisation, prévention effective).
- **Conflit faible** (fort recouvrement de vocabulaire) → simple **avertissement**
  dans le journal, jamais bloquant.

Un **panneau Conflits** apparaît dans le dashboard dès qu'un conflit est détecté,
les tâches retenues par sérialisation sont **marquées ⏸** dans la table, et les
événements défilent dans le Journal en temps réel.

```bash
npm run cli -- stings <projectId>            # conflits potentiels du projet
# ou : GET /api/projects/:id/conflicts
```

## 🤝 Inviter un ami (connecter son IA en 30 s)

1. **Vous (hôte)** — lancez l'orchestrateur avec un vrai token (`npm run dev`),
   puis créez un **billet** :

   ```bash
   npm run cli -- invite                    # sur le réseau local
   npm run cli -- tunnel                    # depuis n'importe où, en wss:// chiffré
   npm run cli -- invite --uses 3 --hours 2 # 3 machines, valable 2 h
   ```

   Vous obtenez une commande unique à envoyer :

   ```
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   ```

2. **Votre ami** — récupère Hive, lance `npm install`, puis **colle la commande**.
   Son Claude Code / Codex est détecté automatiquement, et sa clé de nœud est
   mémorisée pour les reconnexions.

   ```bash
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   # 🐝 Connexion à : wss://…/ws  (« Ruche de Micka »)
   #    🔑 Clé de nœud obtenue et mémorisée — les redémarrages ne redemanderont rien.
   # ✔ Nœud démarré — vous butinez pour la ruche.
   ```

### Ce qu'un billet est, et ce qu'il n'est pas

Un billet **ne donne aucun pouvoir sur la ruche** : il ne sert qu'à obtenir une
**clé propre à la machine** de votre ami. C'est ce qui rend possible ce qui ne
l'était pas :

|                            |                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| **Éphémère**               | 24 h par défaut (`--hours`), puis il ne vaut plus rien                                           |
| **À usage compté**         | une seule machine par défaut (`--uses`)                                                          |
| **Révocable**              | `npm run cli -- revoquer <billetId>`                                                             |
| **Exclusion individuelle** | `npm run cli -- exclure <nodeId>` coupe **une** personne, immédiatement, sans toucher aux autres |
| **Rien en clair en base**  | seules des empreintes PBKDF2 sont rangées : une base volée ne donne aucun accès                  |

```bash
npm run cli -- membres        # qui a les clés, quels billets circulent encore
npm run cli -- exclure node-…  # sa clé ne vaut plus rien, sa connexion est coupée
```

> Un membre exclu **ne peut pas revenir avec le token maître** : le refus est
> définitif, il ne se replie pas sur l'ancienne porte.

### Se connecter depuis l'extérieur

Par défaut, la ruche n'est joignable que sur le réseau local. Pour un ami
ailleurs, `npm run cli -- tunnel` ouvre un tunnel sortant chiffré et émet le
billet dessus — **aucun port à ouvrir sur la box, aucun VPN, aucun domaine** :

```bash
npm run cli -- tunnel
# 🌍 Ouverture d'un tunnel via Cloudflare Quick Tunnel…
#    ✔ https://xyz.trycloudflare.com  →  wss://xyz.trycloudflare.com/ws
```

Pas de `cloudflared` ? Une commande vous dit quoi faire sur **votre** machine :

```bash
npm run cli -- cloudflare            # diagnostic + prochaines étapes
npm run cli -- cloudflare --install  # binaire local, AUCUN sudo
```

Hive n'embarque **aucune dépendance de tunnel** : la commande détecte un
`cloudflared` (ou `localtunnel`) que vous avez installé vous-même. Faire
transiter le code source de tous les membres par un tiers doit être votre choix,
pas un effet de bord d'un `npm install`.

> ⚠️ **`ws://` vers une adresse publique est refusé par défaut.** Ce n'est pas
> seulement le billet qui fuiterait, mais **tout le trafic** : prompts, logs et
> **diffs de code source**. Utilisez `wss://`, ou `--insecure` en connaissance de
> cause.

#### URL stable — pour une ruche qui dure

L'URL d'un tunnel rapide **change à chaque redémarrage**. Les nœuds mémorisent
leur clé et survivent aux relances, mais l'URL qu'ils ont apprise meurt avec le
tunnel : il faudrait réémettre un billet à **chaque membre, à chaque relance**.

Avec un compte Cloudflare (gratuit) et un domaine, dix minutes une fois suffisent
à obtenir une adresse définitive :

```bash
npm run cli -- cloudflare --setup ruche.mondomaine.com
```

La commande énumère les quatre étapes (`login`, `create`, `route dns`, `run`),
**dit pourquoi chacune existe**, signale celle qui ouvre un navigateur, et donne
la ligne à poser dans votre `.env` :

```
HIVE_PUBLIC_URL=wss://ruche.mondomaine.com/ws
```

Elle n'exécute rien à votre place : vous devez pouvoir lire ce qui va être fait
sur votre compte Cloudflare avant que ça arrive.

**Autres options d'adresse** : `HIVE_PUBLIC_URL=wss://mondomaine/ws`, ou
`npm run cli -- invite wss://mondomaine/ws`.

<details>
<summary>Ancien format <code>hive1_</code></summary>

Les invitations `hive1_` contiennent le **token maître** : accès total, sans
expiration ni révocation individuelle. Elles restent acceptées pour ne pas
déconnecter les ruches existantes, mais `npm run join` affiche un avertissement.
Émettez un billet dès que possible.

</details>

## 🛠️ Scripts

| Commande                | Effet                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo`          | Démo complète (orchestrateur + 2 nœuds + projet de 7 tâches)                                                                           |
| `npm run dev`           | Orchestrateur seul (watch)                                                                                                             |
| `npm run node`          | Un nœud membre (configuré par variables d'environnement)                                                                               |
| `npm run join -- <inv>` | Rejoindre une ruche depuis une invitation (agent auto-détecté)                                                                         |
| `npm run cli`           | CLI : `state`/`mind`/`plan`/`brief`/`project`/`tasks`/`watch`/`merge`/`replay`/`waggle`/`consensus`/`ghost`/`pulse`/`report`/`invite`… |
| `npm test`              | Tests unitaires + e2e (vitest)                                                                                                         |
| `npm run lint`          | ESLint + Prettier (zéro erreur exigé)                                                                                                  |
| `npm run build`         | Typecheck (orchestrateur + dashboard) + build du dashboard                                                                             |
| `npm run dev:dashboard` | Dashboard en dev (Vite, proxy vers :7777)                                                                                              |

## 🌐 Déploiement multi-machines

<details>
<summary><b>Machine orchestrateur</b> — créez <code>.env</code> depuis <code>.env.example</code></summary>

```env
HIVE_HOST=0.0.0.0            # accepter les nœuds distants
HIVE_PORT=7777
HIVE_TOKEN=<token fort>      # ex. node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
HIVE_JWT_SECRET=<secret fort># ex. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
HIVE_CORS_ORIGIN=http://mon-orchestrateur:7777
```

Puis : `npm run build:dashboard && npm run dev`.
⚠️ Hors simulation, l'orchestrateur **refuse de démarrer** si `HIVE_TOKEN` est
trivial (valeur par défaut ou < 16 caractères), si `HIVE_JWT_SECRET` manque ou
fait moins de 24 caractères, ou si le CORS vaut `*`.

`HIVE_JWT_SECRET` signe les **sessions des comptes**. Il est distinct de
`HIVE_TOKEN` et ne se partage avec personne : `HIVE_TOKEN` se recopie sur chaque
machine membre, alors que qui connaît le secret de session peut se fabriquer la
session de n'importe quel compte, **administrateur compris**. Il n'a
délibérément aucune valeur par défaut — un défaut écrit dans un dépôt public
serait la même clé pour toutes les ruches du monde. `npm run install:hive` le
pose pour vous ; le changer déconnecte tout le monde, ce qui est exactement le
geste à faire le jour où vous le croyez sorti.

</details>

<details>
<summary><b>Chaque machine membre</b></summary>

```env
HIVE_URL=ws://mon-orchestrateur:7777/ws
HIVE_TOKEN=<le même token fort>
HIVE_NODE_NAME=ma-machine
HIVE_OWNER_NAME=moi
HIVE_AGENT=shell             # ou claude-code / codex
HIVE_MAX_CONCURRENCY=2
```

Puis : `npm run node`. Le membre garde le contrôle : **rien ne s'exécute tant
qu'il n'a pas lancé son client** (consentement), et `Ctrl+C` quitte la ruche (ses
tâches en cours sont réaffectées automatiquement).

</details>

**Dashboard** : ouvrez `http://mon-orchestrateur:7777` et saisissez le token dans
le champ en haut à droite (mémorisé localement).

## ⌨️ Piloter la ruche depuis le terminal

```bash
npm run cli -- state                               # état de la ruche
npm run cli -- plan "un SaaS avec auth et API"     # proposer un DAG (Queen Bee)
npm run cli -- mind "authentification jwt"         # interroger la mémoire (Hive Mind)
npm run cli -- stings <projectId>                  # conflits potentiels (Sting Detector)
npm run cli -- project "Mon SaaS" [repoUrl]        # créer un projet
npm run cli -- brief <projectId> "Description..."   # 🐝 Queen Bee : l'IA découpe ton brief en DAG
npm run cli -- tasks <projectId> mes-taches.json   # envoyer un lot de tâches (DAG manuel)
npm run cli -- watch <projectId>                   # suivre l'avancement en direct
npm run cli -- cancel <taskId>                     # annuler une tâche (le nœud abandonne)
```

Format du fichier de tâches : voir `examples/projet-exemple.json` — chaque tâche a
`title`, `prompt`, et éventuellement `id` et `dependsOn` (références aux ids du
même lot ou de tâches existantes du projet).

## 🔌 Brancher un vrai agent de codage

Toute IA de codage se branche via l'interface `AgentAdapter` (`src/adapters/index.ts`) :

```ts
interface AgentAdapter {
  name: string;
  run(task: Task, ctx: AdapterContext): Promise<{ success; diff; logs; subAgents }>;
}
```

Adaptateurs fournis :

- **`shell`** _(défaut)_ — simulé, sûr : aucun processus lancé. Le mode réel
  (`HIVE_REAL_SHELL=1`) exécute le prompt comme **une** commande via
  `spawn(bin, argv, { shell: false })` — refusé si le token est trivial.
- **`claude-code`** — lance `claude -p "<prompt>"` (CLI headless) dans le workspace
  isolé. Sa config et sa clé API lui sont **automatiquement transmises**
  (HOME/config + `ANTHROPIC_API_KEY`…) ; variables en plus via `HIVE_KEEP_ENV`.
- **`codex`** — lance `codex exec "<prompt>"`, mêmes règles.
- **`hermes-agent`** — lance `hermes agent run --prompt "<prompt>"`, mêmes règles.

Avec un `repoUrl`, le nœud clone le dépôt et travaille sur la branche
**`hive/<taskId>`** — jamais sur `main`. Le diff remonte pour **revue humaine**
(`GET /api/tasks/:id/results`) ; **aucun merge automatique** au Palier 1.

## 🔒 Sécurité

- **Zéro `shell: true`** — toute exécution passe par `spawn(bin, argv, { shell: false })`.
- **Token partagé obligatoire** (REST : `x-hive-token` ; WS : premier message
  `register`/`subscribe`), comparé à **temps constant**. Token trivial refusé hors
  simulation — y compris par les adaptateurs réels côté nœud.
- **CORS restreint** aux origines listées (jamais `*`) ; l'origine des connexions
  WebSocket navigateur est vérifiée.
- **Validation de toutes les entrées** — JSON Schema sur le REST, validation champ
  par champ des messages WS, corps ≤ 1 Mo, message WS ≤ 2 Mo, logs/diffs plafonnés.
- **Anti-DoS** — plafond de messages WebSocket par socket + limitation de débit REST
  par IP (429 au-delà du seuil).
- **Sandbox v0** — un cwd dédié par tâche, environnement épuré, annulation
  coopérative, timeout dur, sortie plafonnée. Le `shell` simulé ne reçoit **aucune**
  variable ; un agent réel reçoit uniquement sa config et sa clé — le strict minimum.
- **Défense en profondeur côté nœud** — le client valide les identifiants reçus du
  hub avant tout usage local (anti path-traversal même si la Queen était compromise).

> **Limite assumée (sandbox v0)** : un processus réel peut lire le disque et accéder
> au réseau. D'ici la vraie isolation (VM/conteneur + réseau filtré), ne faites
> tourner Hive qu'entre **membres de confiance**, et laissez `HIVE_AGENT=shell`
> simulé partout ailleurs.

> **Limite assumée (le plafond de la Balance)** : le plafond de dépense **n'est
> PAS une frontière de sécurité**. `durationMs` est une donnée **déclarée par
> l'agent** — un nœud hostile peut annoncer 24 h par résultat et étrangler un
> projet à lui seul. Le plafond protège d'un **emballement**, jamais d'un
> **adversaire** ; le mot « plafond » promet l'inverse, d'où cette phrase. Le
> blocage est doublement opt-in (`HIVE_BALANCE=strict` **et** un plafond posé à
> la main sur le projet), les tâches en vol vont à leur terme, les autres projets
> continuent, et le déblocage est un **geste humain explicite** — exactement
> comme le merge.

## 🔄 Modèle de données & cycle de vie

```
pending → ready (dépendances done) → assigned → running → done | failed
```

- Échec → _retry_ (3 tentatives max), puis `failed` ; les dépendants échouent en cascade.
- Nœud sans heartbeat > 15 s → `offline`, ses tâches actives repartent en `ready`.
- Résultat d'une tâche réaffectée ou terminée → **ignoré** (idempotence).
- Chaque transition est journalisée dans `events` (base du futur Time-Lapse Replay).
- Tout l'état vit dans SQLite (`data/hive.db`) et survit aux redémarrages.
- Le **grand livre** de la Balance (dépense par projet, **depuis toujours**) est un
  **cache reconstructible** : `balance_ledger_cache` n'accélère que le démarrage, et
  `DELETE FROM balance_ledger_cache` suffit à le refaire à l'identique depuis
  `results`. Rien d'autre de calculé n'est écrit en base — la pesée, elle, est
  recalculée à la demande sur une fenêtre bornée.

## 📁 Structure

```
src/
  orchestrator/   server.ts (Fastify+WS) · scheduler.ts · store.ts (SQLite) · auth.ts (JWT)
                  planner.ts + queen-bee.ts (Queen Bee) · hive-mind.ts (mémoire) · sting-detector.ts
                  honeycomb.ts (merge) · replay.ts · waggle.ts · parliament.ts · ghost.ts
                  pulse.ts · project-report.ts · drone-wars.ts · main.ts
  node-client/    client.ts (WS+backoff) · workspace.ts (sandbox v0) · merge-runner.ts · main.ts
  adapters/       index.ts (AgentAdapter) · shell.ts · claude-code.ts · codex.ts · custom.ts
                  hermes-agent.ts · exec.ts · subagent-parser.ts
  shared/         types.ts · protocol.ts (messages WS typés + validation) · invite.ts · night-shift.ts
  demo.ts         npm run demo
dashboard/        Vite + React : SwarmView 2D/3D (Galacean) · StatTiles · NodesPanel
                  Journal · TaskDrawer (+ CodeEditor) · NewProjectModal · InvitePanel
                  HiveMindPanel · ConflictsPanel (Palier 2)
tests/            scheduler · adapters · e2e · resilience · protocol · hardening
                  invite · planner · hive-mind · sting-detector · drone-wars
                  concierge · reviews · night-shift · waggle · merge
                  pheromones · thermo · brood · store-scaling · gardiennes — 561 tests
```

## 🧭 Roadmap

- **Palier 1** ✅ — essaim réel, temps réel, persistant ; Swarm View 2D/3D ;
  invitations ; éditeur intégré ; sécurité & sandbox v0.
- **Palier 2** ✅ — **Queen Bee** (découpage IA d'un brief en DAG) ·
  **Hive Mind** (mémoire partagée : la ruche apprend des tâches passées) ·
  **Sting Detector** (prévention de conflits par sérialisation).
- **Palier 3** ✅ — **Honeycomb Merge** (plan d'intégration + exécution réelle
  sur un nœud, sélection de revue) · **Drone Wars** (redondance compétitive
  opt-in) · **Time-Lapse Replay** (depuis le journal d'événements).
- **Palier 4** ✅ — **Nectar & Waggle Board** (+ bonus de victoire ⚔) ·
  **Night Shift** (heures de service par membre) · **Parlement des Agents**
  (consensus par vote) · **Ghost in the Hive** (anomalies du journal).
- **Palier 5** ✅ — **l'instinct de la ruche** : **Phéromones** (routage par
  affinité apprise nœud × domaine, signal évaporé en 7 jours) ·
  **Thermorégulation** (ventilation adaptative de la concurrence, avec
  hystérésis) · **Couveuse** (les re-tentatives repartent avec les leçons de
  leurs échecs, en bloc de données isolé des instructions).
- **Ensuite** — isolation durcie (VM/conteneur), fédération de ruches,
  finalisation des comptes utilisateurs (UI de connexion sur l'auth JWT
  existante).

<div align="center"><sub>Fait avec 🍯 — chaque ouvrière compte.</sub></div>
