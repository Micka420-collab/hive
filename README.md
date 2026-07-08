# 🐝 Hive — Palier 1

![CI](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg)

Plateforme communautaire d'orchestration d'agents IA. Un **orchestrateur** central
(la _Queen_) découpe un projet en tâches et les distribue en temps réel aux
**machines des membres** (les _Nodes_), qui exécutent chacune un ou plusieurs
agents de codage (les _ouvrières_) dans des espaces de travail isolés.

**Architecture hybride (hub-and-spoke)** : le contrôle est centralisé, l'exécution
et le code restent locaux chez chaque membre.

```
                        ┌────────────────────────┐
        WebSocket ◄────►│  Orchestrateur (Queen) │◄────► WebSocket
                        │  Fastify + ws + SQLite │
   ┌──────────────┐     │  scheduler / journal   │     ┌──────────────┐
   │ Node membre  │     └───────────┬────────────┘     │ Node membre  │
   │ ruche-alpha  │                 │ HTTP :7777        │ ruche-beta   │
   │ agents+sandbox│         ┌──────┴───────┐           │ agents+sandbox│
   └──────────────┘         │  Swarm View   │           └──────────────┘
                            │ (React, live) │
                            └──────────────┘
```

## Démarrage rapide (démo)

Prérequis : Node.js ≥ 20.

```bash
npm install
npm run demo
```

Puis ouvrez **http://localhost:7777** : le Swarm View montre en direct
l'orchestrateur, 2 nœuds simulés (`ruche-alpha`, `ruche-beta`) et un projet de
démonstration de **7 tâches avec dépendances** (DAG). La tâche « API de
facturation » échoue volontairement à sa première tentative pour montrer le
mécanisme de retry.

Le Swarm View a **deux rendus** (bascule 2D/3D en haut à droite) : une vue SVG
légère par défaut, et une vue **3D temps réel propulsée par
[Galacean Engine](https://github.com/galacean/engine)** — alvéoles-piliers
hexagonales, ouvrières en orbite pulsante, fils lumineux nœud↔tâche, caméra
orbitale (glisser pour tourner). Le moteur 3D (~290 Ko gzip) est **chargé à la
demande** : il n'alourdit le démarrage que si l'on active la vue 3D, et retombe
sur un message clair si WebGL est indisponible.

Le tableau de bord est un **centre de contrôle complet** : rangée de KPI (nœuds,
avancement, débit), cartes de nœuds avec barres de charge, journal coloré,
création de projet + tâches depuis l'UI, et un **tiroir de détail par tâche**
intégrant un **éditeur de code (CodeMirror 6)** — le diff et les logs s'affichent
avec coloration syntaxique, numéros de ligne et édition locale d'exploration.
L'éditeur est chargé à la demande (il n'entre dans le bundle qu'à l'ouverture
d'un tiroir).

**Tester la persistance** : `Ctrl+C` en pleine exécution, puis relancez
`npm run demo` — le projet et son avancement sont toujours là, et les tâches
orphelines (`running` au moment du crash) repartent proprement en `ready`.

La démo tourne en **mode simulation** (`HIVE_SIMULATION=1`) : l'adaptateur
shell est simulé, aucun processus n'est lancé, et le token par défaut n'est
toléré que dans ce mode.

## Inviter un ami (connecter son IA en 30 secondes)

Le moyen le plus rapide de faire rejoindre un ami avec **son propre Claude Code,
Codex ou autre agent** :

1. **Vous (hôte)** — lancez l'orchestrateur avec un vrai token
   (`npm run dev`, voir déploiement ci-dessous), puis générez une invitation :
   - dans le **dashboard** : bouton **« + Inviter un ami »** → copiez la commande ;
   - ou en **terminal** : `npm run cli -- invite`.

   Vous obtenez une commande unique du type :

   ```
   npm run join -- hive1_eyJ2IjoxLCJ1cmwiOiJ3cy8v…
   ```

2. **Votre ami** — récupère Hive, lance `npm install`, puis **colle la commande**.
   C'est tout : l'URL et le token sont dans l'invitation, **son Claude Code /
   Codex est détecté automatiquement**, et son identité de nœud est mémorisée
   pour les reconnexions. Aucun fichier de config à éditer.

   ```bash
   npm run join -- hive1_eyJ2IjoxLCJ1cmwiOiJ3cy8v…
   # 🐝 Connexion à la ruche : Ruche de Micka
   #    Agents détectés : claude-code, shell
   #    Agent utilisé   : Claude Code
   # ✔ Nœud démarré — vous butinez pour la ruche.
   ```

> ⚠ **L'invitation contient le token de la ruche : c'est un secret.** Ne
> l'envoyez qu'à des personnes de confiance, par un canal privé (elle donne le
> droit de rejoindre la ruche et d'exécuter des tâches).

**Adresse réseau** : l'invitation annonce par défaut l'IP locale détectée
(réseau local). Pour un accès distant, indiquez l'URL joignable via
`HIVE_PUBLIC_URL=wss://mondomaine:7777/ws`, l'option du dashboard, ou
`npm run cli -- invite wss://mondomaine:7777/ws`. Les clés API de l'agent de
votre ami restent **sur sa machine**, jamais transmises au hub.

## Scripts

| Commande                | Effet                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run demo`          | Démo complète (orchestrateur + 2 nœuds + projet de 7 tâches)       |
| `npm run dev`           | Orchestrateur seul (watch)                                         |
| `npm run node`          | Un nœud membre (configuré par variables d'environnement)           |
| `npm run join -- <inv>` | Rejoindre une ruche depuis une invitation (agent auto-détecté)     |
| `npm run cli`           | CLI : `state`/`project`/`tasks`/`watch`/`cancel`/`events`/`invite` |
| `npm test`              | Tests unitaires + e2e (vitest)                                     |
| `npm run lint`          | ESLint + Prettier (zéro erreur exigé)                              |
| `npm run build`         | Typecheck + build du dashboard                                     |
| `npm run dev:dashboard` | Dashboard en dev (Vite, proxy vers :7777)                          |

## Déploiement multi-machines

1. **Sur la machine orchestrateur** — créez `.env` à partir de `.env.example` :

   ```env
   HIVE_HOST=0.0.0.0            # accepter les nœuds distants
   HIVE_PORT=7777
   HIVE_TOKEN=<token fort>      # ex. node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   HIVE_CORS_ORIGIN=http://mon-orchestrateur:7777
   ```

   Puis : `npm run build:dashboard && npm run dev`.
   ⚠ Hors simulation, l'orchestrateur **refuse de démarrer** si `HIVE_TOKEN`
   est trivial (valeur par défaut ou < 16 caractères) ou si le CORS est `*`.

2. **Sur chaque machine membre** :

   ```env
   HIVE_URL=ws://mon-orchestrateur:7777/ws
   HIVE_TOKEN=<le même token fort>
   HIVE_NODE_NAME=ma-machine
   HIVE_OWNER_NAME=moi
   HIVE_AGENT=shell             # ou claude-code / codex
   HIVE_MAX_CONCURRENCY=2
   ```

   Puis : `npm run node`. Le membre garde le contrôle : **rien ne s'exécute
   tant qu'il n'a pas lancé son client** (consentement), et `Ctrl+C` quitte la
   ruche (ses tâches en cours sont réaffectées automatiquement).

3. **Dashboard** : ouvrez `http://mon-orchestrateur:7777` et saisissez le token
   dans le champ en haut à droite (mémorisé localement).

## Piloter la ruche depuis le terminal

```bash
npm run cli -- state                               # état de la ruche
npm run cli -- project "Mon SaaS" [repoUrl]        # créer un projet
npm run cli -- tasks <projectId> mes-taches.json   # envoyer un lot de tâches (DAG)
npm run cli -- watch <projectId>                   # suivre l'avancement en direct
npm run cli -- cancel <taskId>                     # annuler une tâche (le nœud abandonne)
```

Format du fichier de tâches : voir `examples/projet-exemple.json` — chaque tâche
a `title`, `prompt`, et éventuellement `id` et `dependsOn` (références aux ids
du même lot ou de tâches existantes du projet).

## Brancher un vrai agent de codage

Toute IA de codage se branche via l'interface `AgentAdapter`
(`src/adapters/index.ts`) :

```ts
interface AgentAdapter {
  name: string;
  run(task: Task, ctx: AdapterContext): Promise<{ success; diff; logs; subAgents }>;
}
```

Adaptateurs fournis :

- **`shell`** (défaut) — simulé, sûr : aucun processus lancé. Le mode réel
  (`HIVE_REAL_SHELL=1`) exécute le prompt comme UNE commande via
  `spawn(bin, argv, { shell: false })` — refusé si le token est trivial.
- **`claude-code`** — lance `claude -p "<prompt>"` (CLI Claude Code headless)
  dans le workspace isolé de la tâche. Installez le CLI et exportez
  `HIVE_KEEP_ENV=ANTHROPIC_API_KEY` (ou laissez le CLI utiliser sa config
  locale). **Les clés API restent sur le nœud, jamais transmises au hub.**
- **`codex`** — lance `codex exec "<prompt>"`, mêmes règles.

Quand le projet a un `repoUrl`, le nœud clone le dépôt dans un répertoire dédié
et travaille sur la branche **`hive/<taskId>`** — jamais sur `main`. Le diff
remonte à l'orchestrateur pour **revue humaine** (`GET /api/tasks/:id/results`) ;
aucun merge automatique au Palier 1.

## Sécurité

- **Zéro `shell: true`** : toute exécution passe par `spawn(bin, argv, { shell: false })`.
- **Token partagé obligatoire** (REST : header `x-hive-token` ; WS : premier
  message `register`/`subscribe`), comparé à temps constant. Token trivial
  refusé hors simulation — y compris par les adaptateurs réels côté nœud.
- **CORS restreint** aux origines listées (jamais `*`) ; l'origine des
  connexions WebSocket navigateur est vérifiée.
- **Validation de toutes les entrées** : JSON Schema sur les routes REST,
  validation champ par champ des messages WS, corps limité à 1 Mo, messages WS
  à 2 Mo, logs/diffs plafonnés.
- **Sandbox v0** : un cwd dédié par tâche, environnement épuré (pas de
  HOME/USERPROFILE, TEMP redirigé à côté du workspace), annulation coopérative,
  timeout dur, sortie plafonnée.
- **Défense en profondeur côté nœud** : le client valide les identifiants reçus
  du hub avant tout usage dans un chemin local (anti path-traversal même si
  l'orchestrateur était compromis).

### Limites connues de la sandbox v0 (assumées au Palier 1)

Un processus lancé en mode réel peut toujours **lire le disque et accéder au
réseau** : l'isolation par cwd + environnement épuré protège contre les fuites
accidentelles, pas contre un agent activement malveillant. D'ici la vraie
isolation (VM/conteneur + réseau filtré, prévue à l'itération suivante), ne
faites tourner Hive qu'entre **membres de confiance**, et laissez `HIVE_AGENT=shell`
simulé partout ailleurs.

## Modèle de données & cycle de vie

```
pending → ready (dépendances done) → assigned → running → done | failed
```

- Échec → retry (3 tentatives max), puis `failed` ; les dépendants échouent en cascade.
- Nœud sans heartbeat > 15 s → `offline`, ses tâches actives repartent en `ready`.
- Résultat pour une tâche réaffectée ou terminée → **ignoré** (idempotence).
- Chaque transition est journalisée dans `events` (base du futur Time-Lapse Replay).
- Tout l'état vit dans SQLite (`data/hive.db`) et survit aux redémarrages.

## Structure

```
src/
  orchestrator/   server.ts (Fastify+WS) · scheduler.ts · store.ts (SQLite) · main.ts
  node-client/    client.ts (WS+backoff) · workspace.ts (sandbox v0) · main.ts
  adapters/       index.ts (AgentAdapter) · shell.ts · claude-code.ts · codex.ts · exec.ts
  shared/         types.ts · protocol.ts (messages WS typés + validation)
  demo.ts         npm run demo
dashboard/        Vite + React : SwarmView 2D/3D (Galacean), StatTiles, NodesPanel,
                  Journal, TaskDrawer (+ CodeEditor CodeMirror), NewProjectModal, InvitePanel
tests/            scheduler.test.ts · adapters.test.ts · e2e.test.ts
```

## Roadmap

- **Palier 2** : Queen Bee (découpage IA d'un brief en DAG), Hive Mind (mémoire
  RAG partagée), Sting Detector (prévention de conflits).
- **Palier 3** : Honeycomb Merge (merge sémantique + tests), Drone Wars
  (redondance compétitive), Time-Lapse Replay (depuis le journal d'événements).
- **Palier 4** : Nectar & Waggle Board, Night Shift, Parlement des Agents,
  Ghost in the Hive.
