<div align="center">

# 🐝 Hive

**Orchestration communautaire d'agents IA — l'essaim, en temps réel, persistant et visible.**

🇫🇷 Français · [🇬🇧 English](README.en.md)

**🌐 [Découvrir Hive — le site vitrine](https://micka420-collab.github.io/hive/)**

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
![Tests](https://img.shields.io/badge/tests-374%20passing-2ea44f)
![Palier](https://img.shields.io/badge/palier%205-livr%C3%A9-2ea44f)

</div>

---

## ✨ En bref

|                         |                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🎛️ **Mission Control**  | 8 vues navigables (sidebar alvéolaire, touches 1-8, deep-links `#/vue/id`), **interface bilingue FR/EN** (bascule topbar) : Ruche, Reine, Miellerie, Projets, Essaim, Santé, Chronique, Mémoire.                                                             |
| 👑 **La Reine répond**  | Chat multilingue avec la ruche (`POST /api/chat`, CLI `ask`) : avancement réel, santé, classement, aide au brief avec bonnes pratiques. IA optionnelle, repli hors-ligne garanti.                                                                            |
| 🍯 **Miellerie**        | Centre de revue des productions IA : diff par fichier, logs, consensus du Parlement, approbation au clavier (j/k/a/x), merge Honeycomb en un geste.                                                                                                          |
| 🧠 **Queen Bee**        | Décrivez un projet en une phrase → un **DAG de tâches** est généré (heuristique ou IA).                                                                                                                                                                      |
| 🧬 **Hive Mind**        | Mémoire partagée : la ruche apprend des tâches réussies et réinjecte le savoir dans les suivantes.                                                                                                                                                           |
| 🛡️ **Sting Detector**   | Repère les tâches concurrentes qui toucheraient le même fichier et **sérialise** pour éviter les conflits.                                                                                                                                                   |
| 🕸️ **Hub-and-spoke**    | Un orchestrateur, N nœuds membres. Temps réel via WebSocket, état persistant en SQLite.                                                                                                                                                                      |
| 🐝 **Swarm View**       | Vue vivante de l'essaim, en **2D (SVG léger)** ou **3D ([Galacean Engine](https://github.com/galacean/engine))**.                                                                                                                                            |
| ⚔ **Drone Wars**        | Redondance compétitive opt-in : `npm run cli -- race <taskId> [2-5]` (ou bouton du tiroir) — la même tâche sur plusieurs nœuds, le premier succès gagne, les perdants sont annulés. Suivi : `races` (CLI), badge ⚔ dans l'Essaim, bonus nectar au vainqueur. |
| 💓 **Pouls & fantômes** | Signes vitaux agrégés (`/api/pulse`), anomalies (`/api/ghost`), classement nectar (`/api/waggle`), time-lapse (`/api/replay`), rapport projet (`/api/projects/:id/report`).                                                                                  |
| 🐜 **Phéromones**       | La ruche apprend **quel nœud réussit quel type de tâche** (api, ui, db, tests, docs, infra) et départage les ouvrières à charge égale. Signal évaporé en 7 jours. `/api/pheromones`, événement `pheromone_route`, carte dans l'Essaim.                       |
| 🌡️ **Thermorégulation** | Quand les échecs s'accumulent, la ruche **ventile** : la concurrence par nœud baisse (×0,75 puis ×0,5) le temps de refroidir, avec hystérésis anti-clignotement. `/api/thermo`, événement `thermo_shift`, jauge dans Santé.                                  |
| 👶 **Couveuse**         | Une tâche re-tentée repart avec les **leçons de ses échecs précédents**, injectées dans un bloc de données isolé des instructions (anti-injection de prompt). Événement `brood_context`.                                                                     |
| 🤝 **Inviter un ami**   | Une commande à coller — son Claude Code / Codex est détecté et rejoint la ruche en 30 s.                                                                                                                                                                     |
| 🔒 **Sûr par défaut**   | Zéro `shell: true`, token constant-time, CORS strict, sandbox par tâche, clés jamais exfiltrées. **Jamais de merge sans revue humaine.**                                                                                                                     |
| 🧩 **Agent-agnostique** | `shell` (simulé), `claude-code`, `codex`, `hermes-agent`, `custom` — ou votre propre `AgentAdapter`.                                                                                                                                                         |

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
ruche, navigable au clavier (touches **1-8**) via une sidebar alvéolaire :

| Vue              | Ce qu'on y fait                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🐝 **Ruche**     | Vue d'ensemble : Swarm View 2D/3D, KPIs, rayon de miel cliquable, file d'attente, journal.                                                             |
| 👑 **Reine**     | Dialoguer avec la ruche dans **votre langue** : avancement, santé, classement, aide au cadrage de brief.                                               |
| 🍯 **Miellerie** | **Revoir ce que les IA ont produit** : diffs par fichier, logs, consensus du Parlement, approbation (a) ou rejet (x) au clavier, puis merge Honeycomb. |
| ⬡ **Projets**    | Rapports d'avancement, atelier brief→DAG (Queen Bee), plan et lancement de merge, conflits Sting.                                                      |
| 🕺 **Essaim**    | Cartes des nœuds membres + Waggle Board (podium nectar).                                                                                               |
| 💓 **Santé**     | Pouls de la ruche (débit, latences p50/p95, succès) + anomalies Ghost.                                                                                 |
| 📜 **Chronique** | Journal filtrable + Time-Lapse Replay (mode sépia « vous regardez le passé »).                                                                         |
| 🧠 **Mémoire**   | Recherche dans le savoir de la ruche (Hive Mind) + bibliothèque scientifique OpenAlex.                                                                 |

Les décisions de revue sont **partagées entre tous les opérateurs** (stockées
côté orchestrateur, synchronisées en temps réel via WebSocket ; repli
localStorage hors-ligne). « Couler le miel » n'intègre que les productions
**approuvées** — le merge reste toujours un geste humain explicite.

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
   puis générez une invitation :
   - dans le **dashboard** : bouton **« + Inviter un ami »** → copiez la commande ;
   - ou en **terminal** : `npm run cli -- invite`.

   Vous obtenez une commande unique :

   ```
   npm run join -- hive1_eyJ2IjoxLCJ1cmwiOiJ3cy8v…
   ```

2. **Votre ami** — récupère Hive, lance `npm install`, puis **colle la commande**.
   L'URL et le token sont dans l'invitation, **son Claude Code / Codex est détecté
   automatiquement**, et son identité de nœud est mémorisée pour les reconnexions.

   ```bash
   npm run join -- hive1_eyJ2IjoxLCJ1cmwiOiJ3cy8v…
   # 🐝 Connexion à la ruche : Ruche de Micka
   #    Agents détectés : claude-code, shell
   #    Agent utilisé   : Claude Code
   # ✔ Nœud démarré — vous butinez pour la ruche.
   ```

> ⚠️ **L'invitation contient le token de la ruche : c'est un secret.** Ne la
> partagez qu'avec des personnes de confiance, par un canal privé. Les clés API de
> votre ami restent **sur sa machine**, jamais transmises au hub.

**Adresse réseau** : par défaut l'IP locale détectée. Pour un accès distant :
`HIVE_PUBLIC_URL=wss://mondomaine:7777/ws`, l'option du dashboard, ou
`npm run cli -- invite wss://mondomaine:7777/ws`.

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
HIVE_CORS_ORIGIN=http://mon-orchestrateur:7777
```

Puis : `npm run build:dashboard && npm run dev`.
⚠️ Hors simulation, l'orchestrateur **refuse de démarrer** si `HIVE_TOKEN` est
trivial (valeur par défaut ou < 16 caractères) ou si le CORS vaut `*`.

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

## 🔄 Modèle de données & cycle de vie

```
pending → ready (dépendances done) → assigned → running → done | failed
```

- Échec → _retry_ (3 tentatives max), puis `failed` ; les dépendants échouent en cascade.
- Nœud sans heartbeat > 15 s → `offline`, ses tâches actives repartent en `ready`.
- Résultat d'une tâche réaffectée ou terminée → **ignoré** (idempotence).
- Chaque transition est journalisée dans `events` (base du futur Time-Lapse Replay).
- Tout l'état vit dans SQLite (`data/hive.db`) et survit aux redémarrages.

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
                  pheromones · thermo · brood · store-scaling — 374 tests
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
