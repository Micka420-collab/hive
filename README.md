<div align="center">

# 🐝 Hive

**Orchestration communautaire d'agents IA — l'essaim, en temps réel, persistant et visible.**

Une _Queen_ centrale découpe un projet en tâches et les distribue aux machines des membres (_Nodes_), qui exécutent chacune leurs agents de codage (_ouvrières_) dans des espaces de travail isolés. Le contrôle est centralisé ; **le code et les clés restent chez chaque membre.**

[![CI](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A520-3c873a)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Tests](https://img.shields.io/badge/tests-110%20passing-2ea44f)
![Palier](https://img.shields.io/badge/palier%202-v0%20livr%C3%A9-2ea44f)

</div>

---

## ✨ En bref

|                         |                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 🧠 **Queen Bee**        | Décrivez un projet en une phrase → un **DAG de tâches** est généré (heuristique ou IA).                           |
| 🧬 **Hive Mind**        | Mémoire partagée : la ruche apprend des tâches réussies et réinjecte le savoir dans les suivantes.                |
| 🛡️ **Sting Detector**   | Repère les tâches concurrentes qui toucheraient le même fichier et **sérialise** pour éviter les conflits.        |
| 🕸️ **Hub-and-spoke**    | Un orchestrateur, N nœuds membres. Temps réel via WebSocket, état persistant en SQLite.                           |
| 🐝 **Swarm View**       | Vue vivante de l'essaim, en **2D (SVG léger)** ou **3D ([Galacean Engine](https://github.com/galacean/engine))**. |
| 🤝 **Inviter un ami**   | Une commande à coller — son Claude Code / Codex est détecté et rejoint la ruche en 30 s.                          |
| 🔒 **Sûr par défaut**   | Zéro `shell: true`, token constant-time, CORS strict, sandbox par tâche, clés jamais exfiltrées.                  |
| 🧩 **Agent-agnostique** | `shell` (simulé), `claude-code`, `codex` — ou votre propre `AgentAdapter`.                                        |

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
volontairement à sa première tentative pour illustrer le mécanisme de _retry_.

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
embeddings ni API), donc déterministe et sans coût. Interrogez la mémoire :

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

| Commande                | Effet                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run demo`          | Démo complète (orchestrateur + 2 nœuds + projet de 7 tâches)       |
| `npm run dev`           | Orchestrateur seul (watch)                                         |
| `npm run node`          | Un nœud membre (configuré par variables d'environnement)           |
| `npm run join -- <inv>` | Rejoindre une ruche depuis une invitation (agent auto-détecté)     |
| `npm run cli`           | CLI : `state`/`project`/`tasks`/`watch`/`cancel`/`events`/`invite` |
| `npm test`              | Tests unitaires + e2e (vitest) — **110 verts**                     |
| `npm run lint`          | ESLint + Prettier (zéro erreur exigé)                              |
| `npm run build`         | Typecheck (orchestrateur + dashboard) + build du dashboard         |
| `npm run dev:dashboard` | Dashboard en dev (Vite, proxy vers :7777)                          |

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
npm run cli -- tasks <projectId> mes-taches.json   # envoyer un lot de tâches (DAG)
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
  orchestrator/   server.ts (Fastify+WS) · scheduler.ts · store.ts (SQLite)
                  planner.ts (Queen Bee) · hive-mind.ts (mémoire) · sting-detector.ts · main.ts
  node-client/    client.ts (WS+backoff) · workspace.ts (sandbox v0) · main.ts
  adapters/       index.ts (AgentAdapter) · shell.ts · claude-code.ts · codex.ts · exec.ts
  shared/         types.ts · protocol.ts (messages WS typés + validation) · invite.ts
  demo.ts         npm run demo
dashboard/        Vite + React : SwarmView 2D/3D (Galacean) · StatTiles · NodesPanel
                  Journal · TaskDrawer (+ CodeEditor) · NewProjectModal · InvitePanel
tests/            scheduler · adapters · e2e · resilience · protocol · hardening
                  invite · planner · hive-mind · sting-detector  — 110 tests
```

## 🧭 Roadmap

- **Palier 1** ✅ — essaim réel, temps réel, persistant ; Swarm View 2D/3D ;
  invitations ; éditeur intégré ; sécurité & sandbox v0.
- **Palier 2** ✅ _(v0 des trois briques)_ — **Queen Bee** (découpage IA d'un
  brief en DAG) ✅ · **Hive Mind** (mémoire partagée : la ruche apprend des tâches
  passées) ✅ · **Sting Detector** (prévention de conflits par sérialisation) ✅.
- **Palier 3** — Honeycomb Merge (merge sémantique + tests) · Drone Wars
  (redondance compétitive) · Time-Lapse Replay (depuis le journal d'événements).
- **Palier 4** — Nectar & Waggle Board · Night Shift · Parlement des Agents ·
  Ghost in the Hive.

<div align="center"><sub>Fait avec 🍯 — chaque ouvrière compte.</sub></div>
