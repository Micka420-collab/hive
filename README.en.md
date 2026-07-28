<div align="center">

# 🐝 Hive

**Community orchestration of AI coding agents — the swarm, live, persistent and visible.**

[🇫🇷 Français](README.md) · 🇬🇧 English

**🌐 [Discover Hive — the showcase site](https://micka420-collab.github.io/hive/?lang=en)**

**🤝 [Propose a project to the hive](https://github.com/Micka420-collab/hive/issues/new?template=proposer-un-projet.yml)** · [see proposed projects](https://github.com/Micka420-collab/hive/issues?q=is%3Aissue+label%3A%22projet+propos%C3%A9%22)

<sub>The site lives in `site/` and deploys itself on every push to `main`. First publication: **Settings → Pages → Source: GitHub Actions**, then re-run the _Site_ workflow. (On a private repo, Pages requires a paid plan; on a public repo it is free.)</sub>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="version">
  <a href="https://github.com/Micka420-collab/hive/actions/workflows/ci.yml"><img src="https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="node">
</p>

A central _Queen_ breaks a project into tasks and distributes them to members' machines (_Nodes_), each running its own coding agents (_worker bees_) in isolated workspaces. Control is centralized; **code and API keys stay on each member's machine.**

</div>

---

## ✨ At a glance

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🎛️ **Mission Control**   | 10 navigable views (honeycomb sidebar, keys 1-9 and 0, deep links `#/view/id`), **bilingual FR/EN interface** (topbar toggle): Hive, Queen, Honey House, Projects, Swarm, Health, Chronicle, Memory, My space, Stewardship (admins).                                                                                                                                                                                                                                                                                                                                                                                                       |
| 👑 **The Queen replies** | Multilingual chat with the hive (`POST /api/chat`, CLI `ask`): real progress, health, leaderboard, brief-writing guidance. Optional AI mode, guaranteed offline fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🍯 **Honey House**       | Review center for AI production: per-file diffs, logs, Parliament consensus, keyboard approval (j/k/a/x), one-gesture Honeycomb merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 🧠 **Queen Bee**         | Describe a project in one sentence → a **task DAG** is generated (heuristic or AI).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🧬 **Hive Mind**         | Shared memory: the hive learns from completed tasks and feeds that knowledge into the next ones.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🛡️ **Sting Detector**    | Spots concurrent tasks that would touch the same file and **serializes** them to prevent conflicts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🕸️ **Hub-and-spoke**     | One orchestrator, N member nodes. Real time over WebSocket, persistent state in SQLite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🐝 **Swarm View**        | A living view of the swarm, in **2D (lightweight SVG)** or **3D ([Galacean Engine](https://github.com/galacean/engine))**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ⚔ **Drone Wars**         | Opt-in competitive redundancy: `npm run cli -- race <taskId> [2-5]` (or the drawer button) — the same task flies on several nodes, first success wins, losers are cancelled. Track it: `races` (CLI), ⚔ badge in the Swarm view, nectar bonus for the winner.                                                                                                                                                                                                                                                                                                                                                                              |
| 💓 **Pulse & ghosts**    | Aggregated vitals (`/api/pulse`), anomalies (`/api/ghost`), nectar leaderboard (`/api/waggle`), time-lapse (`/api/replay`), project report (`/api/projects/:id/report`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 🐜 **Pheromones**        | The hive learns **which node succeeds at which kind of task** (api, ui, db, tests, docs, infra) and breaks ties between equally loaded workers. Signal evaporates over 7 days. `/api/pheromones`, `pheromone_route` event, card in the Swarm view.                                                                                                                                                                                                                                                                                                                                                                                         |
| 🌡️ **Thermoregulation**  | When failures pile up the hive **fans itself**: per-node concurrency drops (×0.75 then ×0.5) until it cools down, with anti-flapping hysteresis. `/api/thermo`, `thermo_shift` event, gauge in the Health view.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 👶 **Brood Chamber**     | A retried task restarts with the **lessons of its previous failures**, injected inside a data block kept separate from instructions (prompt-injection safe). `brood_context` event.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ⚖️ **The Balance**       | The hive scale: **weigh** (useful / rework / failure / rejected), **forecast** (a DAG's estimate) and **cap** — per-project spend cap, doubly opt-in (`HIVE_BALANCE=strict` **and** a cap set by hand). `/api/balance`, `…/projects/:id/balance`.                                                                                                                                                                                                                                                                                                                                                                                          |
| 🛂 **The Guards**        | Entrance control for incoming nectar: a "success" with an **empty diff**, **outside the promised files**, **unapplicable**, or with **logs screaming failure** does not enter on the worker's word. `HIVE_GARDIENNES=off\|consultatif\|strict` (default: annotate, refuse nothing). `/api/gardiennes`, `guard_refused`.                                                                                                                                                                                                                                                                                                                    |
| 🐝 **Full Swarm**        | REAL autonomy: the hive decides (`deciderPas`), acts, and paces itself. **Two switches in series** — the level, chosen by the user, and `HIVE_RUNNER=off\|on`, chosen by the host who pays for machine time (default: `off`). One cycle per project per minute, exponential backoff then a pause after 5 failures, and the big red button stops it BEFORE the effect. It **deliberates**, **plans**, **fixes**, **delivers** (a pull request on the repo, only for a production a human APPROVED) and **merges** (level `plein` AND repo enrolled; the owner's branch protections remain the last barrier). `essaim_cycle` in the Journal. |
| 🐙 **Connect GitHub**    | `npm run cli -- github` lists your repos (most recently pushed first, archived last, already-connected flagged) and connects one **by its number**. The token lives in memory, **never in the database**.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🤝 **Invite a friend**   | A **ticket** to paste: ephemeral, counted uses, **revocable**. It grants no power over the hive — it obtains a key **belonging to that machine**, so you can remove **one** person without ejecting the swarm. `tunnel` opens encrypted remote access with no port to forward.                                                                                                                                                                                                                                                                                                                                                             |
| 🔒 **Safe by default**   | Zero `shell: true`, constant-time token, strict CORS, per-task sandbox, keys never exfiltrated. **Never a merge without human review.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🧩 **Agent-agnostic**    | `shell` (simulated), `claude-code`, `codex`, `hermes-agent`, `custom` — or your own `AgentAdapter`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 🗺️ Architecture

```
                          ┌──────────────────────────────┐
       WebSocket  ◄──────►│     Orchestrator (Queen)     │◄──────►  WebSocket
                          │   Fastify · ws · SQLite      │
   ┌───────────────┐      │   scheduler · journal        │      ┌───────────────┐
   │  Member node  │      │   Queen Bee (planner)        │      │  Member node  │
   │  ruche-alpha  │      └───────────────┬──────────────┘      │  ruche-beta   │
   │ agents+sandbox│                      │ HTTP :7777           │ agents+sandbox│
   └───────────────┘              ┌───────┴────────┐            └───────────────┘
                                  │   Swarm View   │
                                  │ React · 2D/3D  │
                                  └────────────────┘
```

## 🤝 Join a friend's hive — one command, nothing to clone

Got a ticket? One line is enough:

```bash
npx github:Micka420-collab/hive join hive2_your-ticket
```

No `git clone`, no dashboard, no database: **4 MB and 9 packages**. The ticket
carries the hive's address and what it takes to obtain a key of your own —
there is no file to edit.

To install strictly nothing superfluous:

```bash
npm install -g github:Micka420-collab/hive --omit=optional
hive join hive2_your-ticket
```

`--omit=optional` drops Fastify and SQLite, which **only** a full hive needs. A
node lending machine time never starts a server.

> Before, this meant cloning the repository and installing **218 MB and 279
> packages** — including a 3D engine and a code editor, for a dashboard a node
> never opens.

## ⚡ Install (one command)

```bash
npm run setup
```

Checks Node, installs dependencies, generates a random token, writes a
commented `.env` with mode `600`, and detects your coding agent. It touches
**nothing** outside the project folder: no `sudo`, no system package, no
startup service.

Safe to re-run: **a value already present in `.env` is never rewritten** —
overwriting a live token would cut off every connected node.

## 🚀 Quick start (demo)

Prerequisite: **Node.js ≥ 20**.

```bash
npm install
npm run demo
```

Open **http://localhost:7777**: the Swarm View shows the orchestrator live,
2 simulated nodes (`ruche-alpha`, `ruche-beta`) and a demo project of
**7 tasks with dependencies** (DAG). The "API de facturation" (billing API)
task deliberately fails
on its first attempt to demonstrate the _retry_ mechanism, and an 8th task
takes off as a **drone race** (⚔) across both nodes as soon as they are
online — ⚔ badge in the Swarm view, `npm run cli -- races` to follow it.

- **Toggle 2D ⇄ 3D** at the top right. The 3D view (hexagonal cells, worker
  bees in orbit, glowing node↔task threads, orbital camera) is **loaded on
  demand** (~290 KB gzip) and degrades gracefully when WebGL is unavailable.
- **Open a task**: a drawer shows diff and logs in a **CodeMirror 6 editor**
  (syntax highlighting, line numbers), also loaded on demand.
- **Test persistence**: hit `Ctrl+C` mid-run, then relaunch `npm run demo` —
  the project and its progress are still there; orphaned tasks (`running` at
  crash time) restart cleanly as `ready`.

The demo runs in **simulation mode** (`HIVE_SIMULATION=1`): simulated shell
adapter, no process spawned, default token tolerated (only in this mode).

## 🎛️ Mission Control — the cockpit

The dashboard (served on `:7777`) is a full hive-management application,
keyboard-navigable (keys **1-9** and `0`) through a honeycomb sidebar:

| View               | What you do there                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 🐝 **Hive**        | Overview: 2D/3D Swarm View, KPIs, clickable honeycomb, queue, journal.                                                                 |
| 👑 **Queen**       | Talk to the hive in **your language**: progress, health, leaderboard, brief-scoping help.                                              |
| 🍯 **Honey House** | **Review what the AIs produced**: per-file diffs, logs, Parliament consensus, keyboard approve (a) / reject (x), then Honeycomb merge. |
| ⬡ **Projects**     | Progress reports, brief→DAG workshop (Queen Bee), merge planning and launch, Sting conflicts.                                          |
| 🕺 **Swarm**       | Member node cards + Waggle Board (nectar podium).                                                                                      |
| 💓 **Health**      | Hive pulse (throughput, p50/p95 latency, success rate) + Ghost anomalies.                                                              |
| 📜 **Chronicle**   | Filterable journal + Time-Lapse Replay (sepia "you are watching the past" mode).                                                       |
| 🧠 **Memory**      | Search the hive's knowledge (Hive Mind) + OpenAlex scientific library.                                                                 |
| 🪪 **My space**    | One person's dashboard: their projects, quota, subscriptions, machines — and whatever needs their attention, ranked by urgency.        |
| 🖥 **Stewardship**  | _Administrators only._ The machines started for subscribers, and the hive's accounts.                                                  |

**My space** answers a single question: _what will cost me something if I do
nothing today?_ Alerts therefore come before cards, and their order is a stance
— what is **irreversible** (data about to be erased) outranks what stops the
service, which outranks a quota running low. A bill can be paid after the fact;
erased data does not come back.

**Stewardship** requires an administrator ACCOUNT, never the hive token alone:
that token is handed to every member node, and using it as proof would give full
powers to any machine that forages. The first account created is an
administrator, and the last one cannot step down.

Review decisions are **shared across all operators** (stored on the
orchestrator, synced in real time over WebSocket; offline localStorage
fallback). "Pour the honey" only integrates **approved** productions — merging
always remains an explicit human gesture.

## 👑 The Queen replies — talking to the hive

Every member (project owner and node holder alike) can ask the hive questions
in natural language — the message's language is detected and the answer comes
back in that language:

```bash
npm run cli -- ask "Où en est le projet ?"
npm run cli -- ask "Which node works best?"
# or: POST /api/chat { "message": "…", "projectId"?: "…" } · 👑 Queen view in the dashboard
```

Two modes, never blocking: **live state** (deterministic answers composed from
reports, pulse, nectar, anomalies and memory — 100% offline) and **AI** (if
`ANTHROPIC_API_KEY` is set on the Queen: `HIVE_CHAT_MODEL`, default
`claude-haiku-4-5`; the key never leaves the orchestrator, and the model only
receives the hive's real numbers). The Queen also guides the project owner:
best practices per project type (web, API, mobile, data, e-commerce, CLI) and
an effective brief structure.

## 🧠 Queen Bee — from brief to DAG

In **"New project"**, describe the goal in natural language and click
**"✨ Generate the tasks"**: Hive proposes a task graph, editable before launch.
From a terminal: `POST /api/plan { "brief": "…" }`.

The planner is **pluggable**, with automatic fallback — never blocking:

| Mode            | When                                        | Cost / key                 |
| --------------- | ------------------------------------------- | -------------------------- |
| **Heuristic**   | Default. Deterministic keyword-based split. | Offline, free              |
| **AI (Claude)** | If `ANTHROPIC_API_KEY` is set on the Queen. | Key **local** to the Queen |

```bash
# Enable the AI planner (optional) — the key never leaves the orchestrator.
ANTHROPIC_API_KEY=sk-ant-…            # presence → AI mode, otherwise heuristic
HIVE_PLANNER_MODEL=claude-haiku-4-5   # fast/economical default; opus for more finesse
```

## 🧬 Hive Mind — the hive learns

The hive keeps a **shared memory**: every successful task leaves a _memory_
(what was done + a log excerpt). Before assigning a new task, the orchestrator
retrieves the most relevant memories and **injects them into the worker's
prompt** — later tasks benefit from work already done.

Retrieval is **100% offline** (BM25-style lexical scoring, no embeddings, no
API), hence deterministic and free. The dashboard shows a live **Hive Mind
panel** (search + recent memories). Query the memory:

```bash
npm run cli -- mind "jwt authentication"    # most relevant memories
npm run cli -- mind                         # recent memories
# or: GET /api/hive-mind?q=…
```

## 🛡️ Sting Detector — conflict prevention

Two tasks that could run **at the same time** (no dependency ordering between
them) while **touching the same file** risk stepping on each other. The Sting
Detector spots them — offline analysis of titles/prompts, no agent executed:

- **Strong conflict** (same file named) → the scheduler **defers** one of the
  two until the other finishes (serialization, effective prevention).
- **Weak conflict** (heavy vocabulary overlap) → a simple journal **warning**,
  never blocking.

A **Conflicts panel** appears in the dashboard as soon as a conflict is
detected, serialized tasks are **marked ⏸** in the table, and events stream
into the Journal in real time.

```bash
npm run cli -- stings <projectId>            # the project's potential conflicts
# or: GET /api/projects/:id/conflicts
```

## 🤝 Invite a friend (connect their AI in 30 s)

1. **You (host)** — start the orchestrator with a real token (`npm run dev`),
   then create a **ticket**:

   ```bash
   npm run cli -- invite                    # on the local network
   npm run cli -- tunnel                    # from anywhere, over encrypted wss://
   npm run cli -- invite --uses 3 --hours 2 # 3 machines, valid for 2 h
   ```

   You get a single command to send:

   ```
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   ```

2. **Your friend** — gets Hive, runs `npm install`, then **pastes the command**.
   Their Claude Code / Codex is auto-detected, and their node key is remembered
   across restarts.

   ```bash
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   # 🐝 Connecting to: wss://…/ws  ("Micka's Hive")
   #    🔑 Node key obtained and stored — restarts won't ask again.
   # ✔ Node started — you're foraging for the hive.
   ```

### What a ticket is, and what it is not

A ticket **grants no power over the hive**: it only serves to obtain a key that
belongs to your friend's machine. That is what makes possible what previously
was not:

|                             |                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Ephemeral**               | 24 h by default (`--hours`), then it is worthless                                                    |
| **Counted uses**            | one machine by default (`--uses`)                                                                    |
| **Revocable**               | `npm run cli -- revoquer <ticketId>`                                                                 |
| **Individual removal**      | `npm run cli -- exclure <nodeId>` cuts **one** person off, immediately, without touching anyone else |
| **Nothing stored in clear** | only PBKDF2 hashes are stored: a stolen database grants no access                                    |

```bash
npm run cli -- membres         # who holds keys, which tickets are still around
npm run cli -- exclure node-…  # their key becomes worthless, their socket is closed
```

> A removed member **cannot come back using the master token**: the refusal is
> final, it does not fall back to the old door.

### Connecting from outside

By default the hive is only reachable on the local network. For a friend
elsewhere, `npm run cli -- tunnel` opens an encrypted outbound tunnel and issues
the ticket on it — **no port to open on your router, no VPN, no domain name**:

```bash
npm run cli -- tunnel
# 🌍 Opening a tunnel via Cloudflare Quick Tunnel…
#    ✔ https://xyz.trycloudflare.com  →  wss://xyz.trycloudflare.com/ws
```

No `cloudflared`? One command tells you what to do on **your** machine:

```bash
npm run cli -- cloudflare            # diagnosis + next steps
npm run cli -- cloudflare --install  # local binary, NO sudo
```

Hive ships **no tunnel dependency**: the command detects a `cloudflared` (or
`localtunnel`) that you installed yourself. Routing every member's source code
through a third party must be your choice, not a side effect of `npm install`.

> ⚠️ **`ws://` to a public address is refused by default.** It is not only the
> ticket that would leak, but **all traffic**: prompts, logs and **source-code
> diffs**. Use `wss://`, or `--insecure` knowing exactly what you are doing.

#### A stable URL — for a hive that lasts

A quick tunnel's URL **changes on every restart**. Nodes remember their key and
survive restarts, but the URL they learned dies with the tunnel: you would have
to issue a new ticket to **every member, on every restart**.

With a (free) Cloudflare account and a domain, ten minutes once buys a permanent
address:

```bash
npm run cli -- cloudflare --setup hive.mydomain.com
```

The command lists the four steps (`login`, `create`, `route dns`, `run`),
**says why each one exists**, flags the one that opens a browser, and gives you
the line to put in your `.env`:

```
HIVE_PUBLIC_URL=wss://hive.mydomain.com/ws
```

It executes nothing on your behalf: you must be able to read what is about to
happen on your Cloudflare account before it happens.

**Other address options**: `HIVE_PUBLIC_URL=wss://mydomain/ws`, or
`npm run cli -- invite wss://mydomain/ws`.

<details>
<summary>Legacy <code>hive1_</code> format</summary>

`hive1_` invitations contain the **master token**: full access, with no expiry
and no individual revocation. They are still accepted so existing hives keep
working, but `npm run join` prints a warning. Issue a ticket as soon as you can.

</details>

## 🛠️ Scripts

| Command                 | Effect                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo`          | Full demo (orchestrator + 2 nodes + 7-task project)                                                                                   |
| `npm run dev`           | Orchestrator alone (watch)                                                                                                            |
| `npm run node`          | One member node (configured via environment variables)                                                                                |
| `npm run join -- <inv>` | Join a hive from an invitation (agent auto-detected)                                                                                  |
| `npm run cli`           | CLI: `state`/`mind`/`plan`/`brief`/`project`/`tasks`/`watch`/`merge`/`replay`/`waggle`/`consensus`/`ghost`/`pulse`/`report`/`invite`… |
| `npm test`              | Unit + e2e tests (vitest)                                                                                                             |
| `npm run lint`          | ESLint + Prettier (zero errors required)                                                                                              |
| `npm run build`         | Typecheck (orchestrator + dashboard) + dashboard build                                                                                |
| `npm run dev:dashboard` | Dashboard in dev mode (Vite, proxy to :7777)                                                                                          |

## 🌐 Multi-machine deployment

<details>
<summary><b>Orchestrator machine</b> — create <code>.env</code> from <code>.env.example</code></summary>

```env
HIVE_HOST=0.0.0.0            # accept remote nodes
HIVE_PORT=7777
HIVE_TOKEN=<strong token>    # e.g. node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
HIVE_JWT_SECRET=<strong secret> # e.g. node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
HIVE_CORS_ORIGIN=http://my-orchestrator:7777
```

Then: `npm run build:dashboard && npm run dev`.
⚠️ Outside simulation, the orchestrator **refuses to start** if `HIVE_TOKEN` is
trivial (default value or < 16 characters), if `HIVE_JWT_SECRET` is missing or
shorter than 24 characters, or if CORS is `*`.

`HIVE_JWT_SECRET` signs **account sessions**. It is distinct from `HIVE_TOKEN`
and shared with nobody: `HIVE_TOKEN` gets copied onto every member machine,
whereas anyone who knows the session secret can forge a session for any account,
**including the administrator's**. It deliberately has no default value — a
default written in a public repository would be the same key for every hive in
the world. `npm run install:hive` sets it for you; changing it logs everyone
out, which is exactly what you want the day you think it leaked.

</details>

<details>
<summary><b>Each member machine</b></summary>

```env
HIVE_URL=ws://my-orchestrator:7777/ws
HIVE_TOKEN=<the same strong token>
HIVE_NODE_NAME=my-machine
HIVE_OWNER_NAME=me
HIVE_AGENT=shell             # or claude-code / codex
HIVE_MAX_CONCURRENCY=2
```

Then: `npm run node`. The member stays in control: **nothing runs until they
start their client** (consent), and `Ctrl+C` leaves the hive (their in-flight
tasks are reassigned automatically).

</details>

**Dashboard**: open `http://my-orchestrator:7777` and enter the token in the
top-right field (remembered locally).

## ⌨️ Driving the hive from the terminal

```bash
npm run cli -- state                               # hive state
npm run cli -- plan "a SaaS with auth and an API"  # propose a DAG (Queen Bee)
npm run cli -- mind "jwt authentication"           # query the memory (Hive Mind)
npm run cli -- stings <projectId>                  # potential conflicts (Sting Detector)
npm run cli -- project "My SaaS" [repoUrl]         # create a project
npm run cli -- brief <projectId> "Description..."   # 🐝 Queen Bee: AI splits your brief into a DAG
npm run cli -- tasks <projectId> my-tasks.json     # send a batch of tasks (manual DAG)
npm run cli -- watch <projectId>                   # follow progress live
npm run cli -- cancel <taskId>                     # cancel a task (the node abandons it)
```

Task file format: see `examples/projet-exemple.json` — each task has `title`,
`prompt`, and optionally `id` and `dependsOn` (references to ids in the same
batch or to existing project tasks).

## 🔌 Plugging in a real coding agent

Any coding AI plugs in through the `AgentAdapter` interface (`src/adapters/index.ts`):

```ts
interface AgentAdapter {
  name: string;
  run(task: Task, ctx: AdapterContext): Promise<{ success; diff; logs; subAgents }>;
}
```

Bundled adapters:

- **`shell`** _(default)_ — simulated, safe: no process spawned. Real mode
  (`HIVE_REAL_SHELL=1`) runs the prompt as **one** command via
  `spawn(bin, argv, { shell: false })` — refused if the token is trivial.
- **`claude-code`** — runs `claude -p "<prompt>"` (headless CLI) in the
  isolated workspace. Its config and API key are **forwarded automatically**
  (HOME/config + `ANTHROPIC_API_KEY`…); extra variables via `HIVE_KEEP_ENV`.
- **`codex`** — runs `codex exec "<prompt>"`, same rules.
- **`hermes-agent`** — runs `hermes agent run --prompt "<prompt>"`, same rules.

With a `repoUrl`, the node clones the repository and works on branch
**`hive/<taskId>`** — never on `main`. The diff comes back for **human review**
(`GET /api/tasks/:id/results`); **no automatic merge**.

## 🔒 Security

- **Zero `shell: true`** — every execution goes through `spawn(bin, argv, { shell: false })`.
- **Mandatory shared token** (REST: `x-hive-token`; WS: first
  `register`/`subscribe` message), compared in **constant time**. Trivial
  tokens refused outside simulation — including by real adapters node-side.
- **CORS restricted** to listed origins (never `*`); browser WebSocket
  connection origins are checked.
- **All inputs validated** — JSON Schema on REST, field-by-field validation of
  WS messages, body ≤ 1 MB, WS message ≤ 2 MB, logs/diffs capped.
- **Anti-DoS** — per-socket WebSocket message cap + per-IP REST rate limiting
  (429 beyond the threshold).
- **Sandbox v0** — a dedicated cwd per task, stripped environment, cooperative
  cancellation, hard timeout, capped output. The simulated `shell` receives
  **no** variables; a real agent receives only its config and key — the bare
  minimum.
- **Defense in depth node-side** — the client validates identifiers received
  from the hub before any local use (anti path-traversal even if the Queen
  were compromised).

> **Accepted limitation (sandbox v0)**: a real process can read the disk and
> reach the network. Until true isolation (VM/container + filtered network),
> only run Hive among **trusted members**, and keep `HIVE_AGENT=shell`
> simulated everywhere else.

> **Accepted limitation (the Balance's spend cap)**: the spend cap is **NOT a
> security boundary**. `durationMs` is **agent-declared** data — a hostile node
> can claim 24 h per result and choke a project on its own. The cap guards
> against **runaway spending**, never against an **adversary**; the word "cap"
> promises the opposite, hence this sentence. Blocking is doubly opt-in
> (`HIVE_BALANCE=strict` **and** a cap set by hand on the project), in-flight
> tasks run to completion, other projects carry on, and unblocking is an
> **explicit human gesture** — exactly like the merge.

## 🔄 Data model & lifecycle

```
pending → ready (dependencies done) → assigned → running → done | failed
```

- Failure → _retry_ (3 attempts max), then `failed`; dependents fail in cascade.
- Node without a heartbeat > 15 s → `offline`, its active tasks go back to `ready`.
- Result for a reassigned or finished task → **ignored** (idempotence).
- Every transition is journaled in `events` (the source of Time-Lapse Replay).
- All state lives in SQLite (`data/hive.db`) and survives restarts.
- The Balance's **ledger** (per-project spend, **all-time**) is a **rebuildable
  cache**: `balance_ledger_cache` only speeds up startup, and
  `DELETE FROM balance_ledger_cache` is enough to rebuild it identically from
  `results`. Nothing else computed is ever written to the database — the weighing
  itself is recomputed on demand over a bounded window.

## 📁 Layout

```
src/
  orchestrator/   server.ts (Fastify+WS) · scheduler.ts · store.ts (SQLite) · auth.ts (JWT)
                  planner.ts + queen-bee.ts (Queen Bee) · hive-mind.ts (memory) · sting-detector.ts
                  honeycomb.ts (merge) · replay.ts · waggle.ts · parliament.ts · ghost.ts
                  pulse.ts · project-report.ts · drone-wars.ts · concierge.ts (the Queen) · main.ts
  node-client/    client.ts (WS+backoff) · workspace.ts (sandbox v0) · merge-runner.ts · main.ts
  adapters/       index.ts (AgentAdapter) · shell.ts · claude-code.ts · codex.ts · custom.ts
                  hermes-agent.ts · exec.ts · subagent-parser.ts
  shared/         types.ts · protocol.ts (typed WS messages + validation) · invite.ts · night-shift.ts
  demo.ts         npm run demo
dashboard/        Vite + React: Mission Control (8 views, FR/EN) · SwarmView 2D/3D (Galacean)
                  Journal · TaskDrawer (+ CodeEditor) · NewProjectModal · InvitePanel
                  HiveMindPanel · ConflictsPanel · i18n.ts
tests/            scheduler · adapters · e2e · resilience · protocol · hardening
                  invite · planner · hive-mind · sting-detector · drone-wars
                  concierge · reviews · night-shift · waggle · merge
                  pheromones · thermo · brood · store-scaling · gardiennes — 561 tests
```

## 🧭 Roadmap

- **Tier 1** ✅ — real swarm, real time, persistent; 2D/3D Swarm View;
  invitations; built-in editor; security & sandbox v0.
- **Tier 2** ✅ — **Queen Bee** (AI brief-to-DAG split) · **Hive Mind**
  (shared memory: the hive learns from past tasks) · **Sting Detector**
  (conflict prevention through serialization).
- **Tier 3** ✅ — **Honeycomb Merge** (integration plan + real execution on a
  node, review selection) · **Drone Wars** (opt-in competitive redundancy) ·
  **Time-Lapse Replay** (from the event journal).
- **Tier 4** ✅ — **Nectar & Waggle Board** (+ ⚔ race-win bonus) ·
  **Night Shift** (per-member service hours) · **Agents' Parliament**
  (consensus by vote) · **Ghost in the Hive** (journal anomalies).
- **Tier 5** ✅ — **the hive's instinct**: **Pheromones** (learned node ×
  domain affinity routing, signal evaporating over 7 days) ·
  **Thermoregulation** (adaptive concurrency ventilation, with hysteresis) ·
  **Brood Chamber** (retries restart with the lessons of their failures, in a
  data block kept separate from instructions).
- **Next** — hardened isolation (VM/container), hive federation, finishing
  user accounts (login UI on top of the existing JWT auth).

<div align="center"><sub>Made with 🍯 — every worker bee counts.</sub></div>
