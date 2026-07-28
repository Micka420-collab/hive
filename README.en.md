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
  <img src="https://img.shields.io/badge/node-%E2%89%A524-brightgreen" alt="node">
</p>

A central _Queen_ breaks a project into tasks and distributes them to members' machines (_Nodes_), each running its own coding agents (_worker bees_) in isolated workspaces. Control is centralized; **code and API keys stay on each member's machine.**

</div>

---

## ✨ At a glance

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🎛️ **Mission Control**   | 10 navigable views (honeycomb sidebar, keys 1-9 and 0, deep links `#/view/id`), **bilingual FR/EN interface** (topbar toggle): Hive, Queen, Honey House, Projects, Swarm, Health, Chronicle, Memory, My space, Stewardship (admins).                                                                                                                                                                                                                                                                                                                                                                                                       |
| 👑 **The Queen replies** | Multilingual chat with the hive (`POST /api/chat`, CLI `ask`): real progress, health, leaderboard, brief-writing guidance. Optional AI mode, guaranteed offline fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🍯 **Honey House**       | Review center for AI production: per-file diffs, logs, Parliament verdict **and surface — where the change was made**, keyboard approval (j/k/a/x), one-gesture Honeycomb merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🐝 **The Comb**          | **The project's code, readable by the bees**: file tree, syntax-highlighted editor (16 languages), **preview of the site being built** in an opaque origin, **edit → task** for the Queen, and a **read-only share link** that does not hand over the hive. A local mirror on the hub, never the GitHub API — showing the code must not spend the host's token.                                                                                                                                                                                                                                                                            |
| 📦 **The environment**   | The merge prepares before it tests (`npm ci`, `pip install -r`…). **What the REPOSITORY declares, never what the command names**: no package named by the hub, no relocated source. A failed install is not a red test — the tests do not run, and the report says so.                                                                                                                                                                                                                                                                                                                                                                     |
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

On a machine with nothing on it yet — **Linux and macOS**:

```bash
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 | iex
```

The script checks Node, fetches Hive, installs dependencies and asks you **at
most three questions**. It never uses `sudo`, does not install Node on your
behalf, and writes nothing outside its own directory — `--dry-run` shows you
everything without creating a thing. Full details:
**[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

From an already-cloned repository:

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

Prerequisite: **Node.js ≥ 24**.

> **Why 24 and not 20?** Because it removes an install failure, not because it
> is newer.
>
> `better-sqlite3` is a native module. On Node 20 no prebuilt binary exists for
> that ABI, so npm has to **compile** it. On a Windows machine without a C++
> toolchain the build fails — **and `npm install` still succeeds**, because the
> dependency is declared optional. You end up with a "green" install and a
> `hive start` that dies with `ERR_MODULE_NOT_FOUND`.
>
> On Node 24 the prebuilt binary exists: nothing to compile, no compiler to
> install, on any platform. Both behaviours were measured side by side in our
> own CI, on the same commit.
>
> On an older Node, `hive doctor` will tell you under the `moteur` key, with the
> command that fixes it — instead of leaving you to guess.
>
> **And Windows is genuinely exercised.** Not as a promise: CI runs the whole
> suite on `ubuntu-latest` **and** `windows-latest`, on every commit. That is
> what surfaced — and fixed — three defects no amount of reading would have
> caught: `npm ci` unable to launch on a Windows node, a clone waiting forever
> on credentials, and a pruning bound deleting more rows than it should.

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

| View               | What you do there                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐝 **Hive**        | Overview: 2D/3D Swarm View, KPIs, clickable honeycomb, queue, journal.                                                                                                                             |
| 👑 **Queen**       | Talk to the hive in **your language**: progress, health, leaderboard, brief-scoping help.                                                                                                          |
| 🍯 **Honey House** | **Review what the AIs produced**: per-file diffs, logs, Parliament verdict **and surface — did two agents go to the same place, or not**, keyboard approve (a) / reject (x), then Honeycomb merge. |
| ⬡ **Projects**     | Progress reports, brief→DAG workshop (Queen Bee), merge planning and launch, Sting conflicts.                                                                                                      |
| 🐝 **The Comb**    | **The project's code, readable**: file tree, highlighted editor, preview of the site produced, and edit → task for the Queen.                                                                      |
| 🕺 **Swarm**       | Member node cards + Waggle Board (nectar podium).                                                                                                                                                  |
| 💓 **Health**      | Hive pulse (throughput, p50/p95 latency, success rate) + Ghost anomalies.                                                                                                                          |
| 📜 **Chronicle**   | Filterable journal + Time-Lapse Replay (sepia "you are watching the past" mode).                                                                                                                   |
| 🧠 **Memory**      | Search the hive's knowledge (Hive Mind) + OpenAlex scientific library.                                                                                                                             |
| 🪪 **My space**    | One person's dashboard: their projects, quota, subscriptions, machines — and whatever needs their attention, ranked by urgency.                                                                    |
| 🖥 **Stewardship**  | _Administrators only._ The machines started for subscribers, and the hive's accounts.                                                                                                              |

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

## 🐝 The Comb — seeing the code, watching the AI work

What members could see so far were **tasks**: titles, states, diffs. Never the
code. You worked on a project without being able to open it — like helping fix
an engine without being allowed to lift the hood. The Comb lifts the hood: a
file tree, a syntax-highlighted editor (16 languages), a **preview** of the site
the AI just wrote, and — for the Queen — an **edit** that becomes a task.

**The hub keeps its own mirror**: a read-only shallow clone per project
(`data/rayons/<id>`), refreshed at most once a minute. Going through the GitHub
API would have required the **host's token** — showing the code to a bee would
spend a right that is not hers. **`.git` is never served**: it holds `config`,
hence the remote URL, hence the private repository's credentials; neither are
`.env`, `.npmrc`, `id_rsa` or key extensions.

**An edit is not saved — it is proposed.** The mirror is a disposable copy;
writing to it would give the illusion of having fixed something, until the next
refresh silently erased it. A change therefore becomes a **task** carrying the
file's context, reviewed like any other production. Someone holding a share link
**reads**; they do not manufacture work for somebody else's swarm.

**The preview runs in an opaque origin.** Previewing a site the agent just wrote
means executing, in your browser, HTML and JavaScript nobody has read: served on
the same origin as the dashboard, three lines would be enough to send your
session token elsewhere. The document is therefore folded into a single
self-contained file and displayed in an `<iframe sandbox>` **without
`allow-same-origin`** — the frame reads neither `localStorage` nor cookies —
with a `Content-Security-Policy` that cuts the network (`connect-src 'none'`,
`form-action 'none'`) and no navigation of any kind.

**Letting a worker into a private project** is done from the "Team" panel in the
Projects view. A repository imported from GitHub arrives **without an owner** —
the import authenticates with the hive token, which is nobody's account: an
administrator **adopts** it first, then admits whoever they want. Admission goes
by **account identifier**, never by email: email would turn this route into an
oracle answering "does this email have an account here?" for any project owner.
Everyone reads their own identifier on that same card, and hands it over the way
one hands over an invitation ticket.

**Sharing read-only** is done from the "Read-only sharing" panel in the Projects
view and yields a URL to paste
(`https://<your-tunnel>/#/rayon/<project>?partage=hive3_…`). Whoever opens it has
**neither an account nor the hive token**: they land on a stripped-down screen
that says what it is (read-only), shows progress and code, and nothing else — no
sidebar, no swarm, no journal, no edit button. They do not see **who** is
working either: node identifiers name the machines of people who never agreed to
appear in a link being passed around. The token travels after the `#` — so it
shows up in no access log — and it is removed from the address bar once stored. The share token is **not** the hive
token: it carries two acts only (see progress, read code), applies to **one**
project, expires (7 days by default, 90 at most) and is revoked one at a time
without touching the others.

## 📦 The environment — the agent installs what it needs

`npm test` on a fresh clone fails for want of `node_modules`. The merge
therefore accepts a **preparation** before the tests:

```bash
npm run cli -- merge-run <projectId> -- --preparer npm ci --tester npm test
# or the two fields of the "Merge plan" panel in ⬡ Projects
```

**Preparation installs what the REPOSITORY declares, never what the COMMAND
names.** `npm ci` reads the repository's `package-lock.json`; `npm install
lodash` lets the hub choose what runs on a member's machine. Refused, therefore:
binaries that install nothing (`sh`, `curl`, `make`), subcommands that are not
installations (`npm run deploy`), arguments that name a package, and flags that
relocate the **source** (`--index-url`, `--registry`, `--userconfig`…).
Preparation goes through the node's sandbox, just like the tests.

If the install fails — machine offline, registry unreachable, lockfile out of
step — **the tests are not run** and the report says "environment not prepared".
A `✘ tests red` would have sent you hunting for a regression in code that is
perfectly fine.

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
| `npm run cli -- doctor` | **The doctor** — 11 failure causes, and for each the exact command that repairs it. `--json` for monitoring.                          |
| `npm run loupe`         | **The magnifying glass** — is the code this branch adds defended by its own tests? (see below)                                        |
| `npm run build`         | Typecheck (orchestrator + dashboard) + dashboard build                                                                                |
| `npm run dev:dashboard` | Dashboard in dev mode (Vite, proxy to :7777)                                                                                          |

### 🔎 The magnifying glass — what we look at before merging

`typecheck`, `lint`, `test` and `build` all answer the same question: **"does it
work?"**. None answers the one that matters when merging:

> **is the code I just wrote defended by my own tests?**

A green suite stays green when you add code nothing checks. That is the most
common and the quietest failure mode: a guard ships, it is correct, and nobody
notices the day someone removes it.

The magnifying glass takes the lines the branch **adds** to `src/` and
`dashboard/src/`, derives safe mutations from them (`&&`→`||`, `===`→`!==`, …)
and checks that the suite **goes red** on each one. A surviving mutation points
at new code nothing defends.

```bash
npm run loupe                      # after the gate, never instead of it
LOUPE_BASE=origin/main npm run loupe
LOUPE_MAX=30 npm run loupe         # 12 by default; beyond that it samples
```

Faced with a survivor you must **choose** — never ignore:

- write the missing test; **or**
- establish that the mutant is **equivalent** (no input tells the two versions
  apart) and **say so in writing**.

What it does not do, and this must be said: it runs **after** the gate and
assumes everything green; it **samples** (and reports what it left out — silent
truncation would read as "everything is covered"); and it only mutates
**operators**, because a mutation breaking the syntax would fail the whole suite
and pass for a killed mutant. The glass would then lie in the reassuring
direction, the worse of the two.

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
