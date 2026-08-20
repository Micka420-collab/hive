# Features — in detail

> The [README](../README.en.md) says what Hive is and how to run it. This file
> says what each part does, and **why it is built that way** — the trade-offs,
> the accepted limits, and what was measured rather than assumed.
>
> It is deliberately long. A README that contains everything is read by nobody;
> a reference you open when you need it, is.

---

## 🎛️ Mission Control — the cockpit

The dashboard (served on `:7777`) is a full hive-management application,
keyboard-navigable (keys **1-9**, `0`, `h`, `i`, `c`) through a honeycomb sidebar:

| View               | What you do there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🐝 **Hive**        | Overview: 2D/3D Swarm View, KPIs, **Full Swarm pulse** (level / pause / drift → Projects), clickable honeycomb, queue, journal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 👑 **Queen**       | Talk to the hive in **your language**: progress, health, leaderboard, brief-scoping help. **SSE streaming** (progressive text), read-only multi-agent / Full Swarm context, Anthropic token counts, Chat / Plan / Autonomy / Backups modes, **Restore…** chip when failures sit next to a checkpoint.                                                                                                                                                                                                                                                                                                                                            |
| 🍯 **Honey House** | **Review what the AIs produced**: per-file diffs, logs, Parliament verdict **and surface — did two agents go to the same place, or not**, keyboard approve (a) / reject (x), then Honeycomb merge.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ⬡ **Projects**     | Progress reports, brief→DAG workshop (Queen Bee), merge planning and launch, Sting conflicts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🐝 **The Comb**    | **The project's code, readable**: file tree, highlighted editor, preview of the site produced, edit → task (with an `avant_retouche` safety net), and a **checkpoint timeline** (view the patch; restore opens a task).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🕺 **Swarm**       | Member node cards + Waggle Board (nectar podium).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 💓 **Health**      | Hive pulse (throughput, p50/p95 latency, success rate) + Ghost anomalies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 📜 **Chronicle**   | Filterable journal + Time-Lapse Replay (sepia "you are watching the past" mode).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🧠 **Memory**      | Search the hive's knowledge (Hive Mind) + OpenAlex scientific library.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🏗 **Works**        | **The works the repository DECLARES**, one click away: its scripts on a hive node, its workflows on GitHub. The hive picks from that list and never invents a command — and whatever leaves the machine carries its reason for needing a human.                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🪪 **My space**    | One person's dashboard: their projects, quota, subscriptions, machines — and whatever needs their attention, ranked by urgency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🖥 **Stewardship**  | _Administrators only._ The machines started for subscribers, and the hive's accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 🧠 **Brain**       | _Administrators only._ The hive's knowledge as a **living graph**, Obsidian-style: notes repel each other, links pull them together, and a halo breathes on whatever was used recently. A **hollow** dot has never been used — knowledge stored without use. Dead links are listed but **never drawn**: tracing them into the void would invent a note that does not exist. Read-only. **Explorable**: accent-insensitive search, filters by kind, a “dormant” filter, zoom, pan, and a **list** view — a real table, keyboard-navigable, because a screen existing only in pixels would be the one place where `NO_COLOR` and `TERM=dumb` stop. |

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
Successful diffs are kept as **checkpoints** on the Comb: you can **view** (and
**copy**) the patch before acting — large diffs are truncated in the preview;
restore opens a **task** for the swarm (never a silent rewrite of the repo),
with a shortcut into the Honey House. An edit from the Comb first records an
`avant_retouche` reverse patch so a later restore can undo the proposal.

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
# or: POST /api/chat { "message": "…", "projectId"?: "…", "stream"?: true }
#     · Accept: text/event-stream → deltas then done
#     · 👑 Queen view (progressive text)
```

Two modes, never blocking: **live state** (deterministic answers composed from
reports, pulse, nectar, anomalies and memory — 100% offline) and **AI** (if
`ANTHROPIC_API_KEY` is set on the Queen: `HIVE_CHAT_MODEL`, default
`claude-haiku-4-5`; the key never leaves the orchestrator, and the model only
receives the hive's real numbers). AI replies can **stream** over SSE. The
prompt also sees read-only **in-flight work**, **sub-agents**, and **Full Swarm**
state — the Queen never raises autonomy or rewrites git. The Queen also guides
the project owner: best practices per project type (web, API, mobile, data,
e-commerce, CLI) and an effective brief structure. In AI mode, Anthropic
**token counts** show on each reply (and for the session). Mode chips link Chat
→ Plan (Projects / Queen Bee) → Autonomy (Full Swarm on the project) → Backups
(Comb). When recent failures sit next to a checkpoint, the Queen offers a
**Restore…** chip that opens the Comb timeline.

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
