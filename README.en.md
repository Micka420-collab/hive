<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/banniere-en-sombre.png">
  <img src="docs/images/banniere-en-clair.png" width="840" alt="Hive — Put several AIs to work on your project, at the same time. A Queen splits the project, your machines run it. The code and the keys never leave yours.">
</picture>

# 🐝 Hive

[![CI](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-F6C445?labelColor=17130C)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-F6C445?labelColor=17130C)
![Tests](https://img.shields.io/badge/tests-3900%20passing-F6C445?labelColor=17130C)
![License](https://img.shields.io/badge/license-MIT-F6C445?labelColor=17130C)

[🇫🇷 Français](README.md) · 🇬🇧 English · [🌐 Site](https://micka420-collab.github.io/hive/?lang=en) · [📚 Documentation](#-documentation)

</div>

---

You write what you want to build. Hive splits it into tasks, hands them to
your team's computers, and shows you every result **to validate**. Nothing is
merged without your say-so — **your code and your keys stay on your machines.**

Under the hood: a central **Queen** orchestrates, **nodes** run their coding
agents in isolated workspaces. Control is centralised; execution is not.

What Hive sets out to solve is not "getting an AI to write code" — it is
**keeping a team of AIs on one project for months** without it drifting,
repeating itself, or relearning in month six what it understood in month two.

```
                          ┌──────────────────────────────┐
       WebSocket  ◄──────►│      Orchestrator (Queen)    │◄──────►  WebSocket
                          │   Fastify · ws · SQLite      │
   ┌───────────────┐      │   scheduler · journal        │      ┌───────────────┐
   │  Member node  │      │   The Brain (knowledge)      │      │  Member node  │
   │  ruche-alpha  │      └───────────────┬──────────────┘      │  ruche-beta   │
   │ agents+sandbox│                      │ HTTP :7777          │ agents+sandbox│
   └───────────────┘              ┌───────┴────────┐            └───────────────┘
                                  │ Mission Control│
                                  │  React · 2D/3D │
                                  └────────────────┘
```

## 🔁 How it works

Three steps, and you stay in charge.

1. **You describe the project.** A few sentences are enough. Hive proposes an
   ordered list of tasks — you correct it before launching.
2. **The AIs work in parallel.** Each task goes to a member's computer, which
   runs its AI in an isolated folder. You watch progress live.
3. **You validate, then it merges.** Every result stops in front of you. You
   read it, you approve or refuse. Nothing passes without your say-so.

## ⚡ Install

On a machine with nothing on it yet:

```bash
# Linux · macOS
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 -OutFile "$env:TEMP\hive-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-install.ps1"
```

The script checks Node, fetches Hive, installs dependencies and asks **at most
three questions**. It never uses `sudo`, does not install Node for you, and
writes nothing outside its own folder — `--dry-run` shows all of it without
creating anything.

From an existing clone: `npm run setup`. In a container: `docker compose up`.

> **From a GitHub ZIP archive**, one step a clone does for you is missing: open a
> terminal in the extracted folder and run `npm install --no-fund --no-audit`
> **once**. Without it, `npm run ruche` and `npm run cli` stop — but they now
> tell you so, with the command to type. A real user's transcript is what earned
> that: before, they died on `Cannot find package 'tsx'`.

> **Node ≥ 24 is required**, and it is to remove a failure, not to chase a
> version: under Node 20 `better-sqlite3` has no prebuilt binary and must be
> **compiled**. On a Windows machine without C++ tooling that compilation fails
> — **and `npm install` still succeeds**, because the dependency is optional.
> You end up with a "green" install and a `hive start` that dies on
> `ERR_MODULE_NOT_FOUND`. Both behaviours were measured side by side in our own
> CI, on the same commit.

## 🚀 Quick start

```bash
npm install
npm run demo
```

Open **http://localhost:7777**: the swarm live, two simulated nodes and a
7-task demo project with dependencies. One task fails on purpose to show the
retry path.

The demo runs in simulation (`HIVE_SIMULATION=1`): no process is spawned, no
key is needed.

**Joining someone else's hive** is one line, with nothing to clone:

```bash
npx github:Micka420-collab/hive join hive2_your-ticket
```

## 🧠 The Brain — what makes it last

A hive working for months closes a loop: today's output becomes tomorrow's
context. That is what makes long projects drift, and it is the problem Hive
tackles first.

**Episodic memory is not enough.** Keeping "task 47 succeeded, here are its
logs" produces a pile that grows without end, where noise outgrows signal, and
which never says _what to do_. An agent picking up a project in month three
does not need the thousand episodes: it needs the **twenty rules** they
produced.

The Brain therefore files knowledge by **kind**, and the order is a priority:

| Kind          | What it is                                                 | Pruned? |
| ------------- | ---------------------------------------------------------- | ------- |
| **invariant** | What must always hold. Passed to **every** task.           | never   |
| **lesson**    | What a failure taught, **with the rule** that prevents it. | never   |
| **decision**  | A choice, the alternatives rejected, and why.              | never   |
| **map**       | A way in: where to start.                                  | never   |
| **episode**   | A raw observation. Raw material.                           | **yes** |

**And the hive feeds it itself.** Every accepted failure becomes an episode:
the fault is reduced to its signature, and the same fault **increments a single
note** rather than scattering fifty. Once a pattern reaches three recurrences,
Hive **proposes** consolidation — it never writes the rule. Writing a rule means
understanding _why_, and a false rule costs more than no rule at all: it gets
**followed**, and passed to every later task. The hive gathers the material; a
human writes the law.

Four mechanisms make it work:

- **Consolidation.** An episode recurring **three times** becomes a lesson
  carrying a rule. Once is an accident; twice is a coincidence — and that is
  the threshold which manufactures the most false rules, which costs more than
  no rule at all, because a rule gets _followed_.
- **The context budget.** Invariants always go in, ahead of everything else. If
  they do not fit the budget, Hive **refuses** rather than truncating: a
  context missing a safety constraint but looking complete is worse than an
  error, because nobody will check. Whatever does not fit is **listed**, never
  dropped in silence.
- **Pruning by use.** Only episodes go, and on last-**served** date rather than
  age: an old episode read last week beats yesterday's that nobody opened.
- **Knowledge is data, never instructions.** Notes are written by agents.
  Injected as-is they would be a delayed prompt injection — all the more
  effective for coming from a source the hive believes is its own. Everything
  goes through a delimited data block.

**The brain lives as markdown files** — YAML front-matter, `[[wikilink]]`s,
directly openable in Obsidian. That is not cosmetic: knowledge in files
**versions** (so it reads as a diff, is reviewed, and can be **reverted** —
`git revert` is the only forgetting mechanism that has ever worked), **reads
without the hive**, and **is editable by hand**. Any index laid on top is a
rebuildable cache; the folder is the source of truth.

> The proof the method works is in this repository:
> **[docs/ERREURS.md](docs/ERREURS.md)** is exactly this, kept by hand for
> weeks — ordered by lesson rather than chronology, each entry carrying its
> rule. It has caught real regressions, one of them via a rule written in the
> previous batch. The Brain **mechanises a proven practice**; it does not
> invent a theory.

## 🎚️ Autonomy levels

Autonomy is a ladder, not a switch, and it changes with one command:

| Level      | What the hive does                                       |
| ---------- | -------------------------------------------------------- |
| `off`      | Nothing automatic.                                       |
| `propose`  | It thinks and **proposes** a plan. Does not act.         |
| `gouverne` | It acts, but **every integration goes through a human**. |
| `plein`    | It ships and merges — on an explicitly enrolled repo.    |

It changes with one command, and the command **says what it implies before
doing it**:

```bash
npm run cli -- mode                      # the four modes, and where each project stands
npm run cli -- mode gouverne             # announces what it widens, writes nothing
npm run cli -- mode gouverne <project> --oui
```

**Only going up asks for confirmation.** Going down removes rights from the
hive — always safe, and asking "are you sure?" to take back control is the
surest way to teach people to type "yes" without reading, which makes the
prompt useless on the day it matters.

**Two switches in series**, deliberately: the _level_ is chosen by the user,
`HIVE_RUNNER=off|on` by the host paying for machine time (default: `off`).
Nobody alone triggers spending on someone else's machine. The big red button
stops **before** the effect, never after.

## 🧩 Agents and models

Any coding AI plugs in through the `AgentAdapter` interface:

| Adapter        | What it runs                                            |
| -------------- | ------------------------------------------------------- |
| `claude-code`  | `claude -p "<prompt>"` in the isolated workspace.       |
| `codex`        | `codex exec "<prompt>"`                                 |
| `grok`         | `grok -p "<prompt>"` — xAI’s CLI agent, Apache 2.0.     |
| `hermes-agent` | `hermes agent run --prompt "<prompt>"`                  |
| `custom`       | Yours, via `HIVE_AGENT_CMD`.                            |
| `shell`        | **Simulated** — no process spawned, the diffs are fake. |

**The node detects what is installed on your machine and uses it** — nothing to
configure. It falls back to `shell` only when it finds no agent, and it says so
on startup, because a silent simulator is a delayed lie. `HIVE_AGENT` forces the
choice if you want a different one.

**Your subscription is enough**: the node runs the `claude` binary, which
authenticates itself. No API key — Anthropic's or anyone else's — is required to
put the hive to work. See **[docs/WINDOWS-CLAUDE.md](docs/WINDOWS-CLAUDE.md)**
(in French).

**Polyethism** gives each worker the job its experience allows, and the
**Scouts' Council** has several agents verify a direction before committing to
it — a dance nobody repeats dies out.

## 🔒 Security

- **Zero `shell: true`** — every execution goes through `spawn(bin, argv, { shell: false })`.
- **Constant-time token comparison**; trivial tokens refused outside simulation.
- **Strict CORS**, never `*`; browser WebSocket origin verified.
- **Every input validated** — JSON Schema on REST, field by field on WS, bounded bodies.
- **Per-task sandbox** — dedicated cwd, scrubbed environment, hard timeout, capped output.
- **Never a merge without human review.**

> **What the sandbox does — and what it does not.** With **podman**, **docker**
> or **bubblewrap** installed, the agent only sees its own task directory: not
> your `HOME`, not your SSH keys, not your other projects. **The network stays
> open**, deliberately — a coding agent must reach its model's API. Isolation
> stops it from _reading_ your machine, not from _sending_ what it read of the
> repository.
>
> **Without a container engine**, only a process sandbox remains: a dedicated cwd
> and a stripped environment, but **the whole disk** stays readable under your
> user. In that case, open your hive to **trusted members** only — or set
> `HIVE_ISOLEMENT=exige`, and the node will **refuse to work** for lack of a
> sandbox, rather than work in the open.

The detail — and the other accepted limits, written down rather than left
unsaid — is in **[docs/FEATURES.en.md](docs/FEATURES.en.md)**.

## 🛠️ Commands

| Command                     | Effect                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| `npm run ruche`             | **Everything in one command** — Queen + worker + screen              |
| `npm run demo`              | Full demo (orchestrator + 2 nodes + project)                         |
| `npm run dev`               | Orchestrator only                                                    |
| `npm run node`              | A member node                                                        |
| `npm run cli -- doctor`     | **The doctor** — 13 failure causes, each with the fixing command     |
| `npm run cli -- sauvegarde` | SQLite backup via `VACUUM INTO`                                      |
| `npm run cli -- service`    | Install the hive as a service (systemd · launchd · scheduled task)   |
| `npm test`                  | The full suite (vitest) — the count lives in the badge, in one place |
| `npm run fusionner`         | Fast-forwards the branch onto `main` — no merge commit               |
| `npm run lint`              | ESLint + Prettier — zero errors required                             |
| `npm run loupe`             | **The magnifier** — is new code defended by its own tests?           |

### The magnifier

`typecheck`, `lint`, `test` and `build` all answer "does it work?". None answers
the one that matters at merge time:

> **is the code I just wrote defended by my own tests?**

The magnifier takes the lines the branch **adds**, derives safe mutations from
them (`&&`→`||`, `===`→`!==`…) and checks the suite **goes red** on each. A
surviving mutant marks new code nothing defends — and then you must choose:
write the missing test, or state in writing that the mutant is equivalent.
Never ignore it.

It runs **after** the barrier, it **samples** (and announces what it left out),
and it only mutates operators. That is said here because a verification tool
that overstates its reach lies in the reassuring direction, the worse of the
two.

## 📚 Documentation

| File                                                         | What's in it                                            |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| **[docs/FEATURES.en.md](docs/FEATURES.en.md)**               | Each part in detail, with its trade-offs                |
| **[docs/INSTALLATION.md](docs/INSTALLATION.md)**             | Install, uninstall, service, container, backups (FR)    |
| **[docs/WINDOWS-CLAUDE.md](docs/WINDOWS-CLAUDE.md)**         | Running solo on Windows with a Claude subscription (FR) |
| **[docs/PROTECTION-BRANCHE.md](docs/PROTECTION-BRANCHE.md)** | Protecting `main`: the exact settings, and why (FR)     |
| **[docs/ERREURS.md](docs/ERREURS.md)**                       | The error journal — by lesson, with the rules (FR)      |
| **[docs/ETAPES.md](docs/ETAPES.md)**                         | The project's real state against its own promises (FR)  |
| **[CHANGELOG.md](CHANGELOG.md)**                             | What changed, version by version                        |

Most of the deep documentation is in French, as is the codebase's commentary.
`docs/FEATURES.en.md` is the English reference.

## 🤝 Contributing

The repository's rules are few, and not negotiable: **anything that accumulates
ships its pruning bound in the same commit**; **no untrusted data enters a
prompt outside a data block**; **the platform is a parameter, never
`process.platform` read inline**; and **a suspicion is proven by mutation
before the test is written** — a test that cannot go red is not coverage, it is
decoration.

**[Propose a project to the hive](https://github.com/Micka420-collab/hive/issues/new?template=proposer-un-projet.yml)** ·
[see proposed projects](https://github.com/Micka420-collab/hive/issues?q=is%3Aissue+label%3A%22projet+propos%C3%A9%22)

---

<div align="center"><sub>MIT · Made with 🍯 — every worker counts.</sub></div>
