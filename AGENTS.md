# AGENTS.md

## Cursor Cloud specific instructions

Hive is a single Node/TypeScript product: an orchestrator ("Reine"/Queen, Fastify +
`ws` + SQLite on port `7777` which also serves the built dashboard) plus worker
nodes ("ouvrière") that run coding agents, plus a React "Mission Control"
dashboard (Vite dev server on port `5173`). Standard lint/test/build/run commands
live in `package.json` and the `README.md` "Commandes" table — use those; only the
non-obvious caveats are captured below.

### Node version

- Node **>=24** is required (`engines` field; `better-sqlite3` prebuilt binaries and
  several APIs depend on it). The update script installs Node 24 via `nvm` and sets
  it as the default, so fresh shells already resolve to it.
- Gotcha: a system `node` at `/exec-daemon/node` (v22) sits early on `PATH`. It is
  shadowed by nvm's default only because `~/.bashrc` sources `nvm.sh`. If a shell
  ever reports Node 22 (e.g. `better-sqlite3` ABI errors), run
  `source ~/.nvm/nvm.sh && nvm use 24` before Node commands.

### Configuration (`.env`)

- The app reads a root `.env` (gitignored; never commit it). Outside simulation
  mode the Queen **refuses to start** without `HIVE_JWT_SECRET`, and `HIVE_TOKEN`
  must be non-trivial (>=16 chars). The update script generates a valid `.env`
  with random secrets if one is not already present; delete it to regenerate.
- Auth: every API call needs an `x-hive-token` header. The dashboard reads the
  token from `localStorage` key `hive.token`, or you can type it into the masked
  "token" input in the dashboard top bar (it persists). Without it `/api/state`
  returns `{"error":"token invalide"}`.

### Running

- `npm run ruche` starts all three processes with prefixed logs (`reine`,
  `ouvrière`, `écran`): Queen `:7777`, a local worker node, and the Vite dashboard
  `:5173`. Open `http://localhost:5173`. Variants: `-- --sans-ecran`,
  `-- --sans-noeud`, `-- --ecran-seul`. `^C` stops all three.
- With no AI coding CLI installed, the worker auto-selects `Shell (simulé)` — tasks
  still dispatch and complete but produced diffs are fake. That is sufficient to
  exercise the platform end-to-end; install Claude Code (`npm i -g
@anthropic-ai/claude-code`) only when testing real agent detection.
- Docker is **not** needed for development (it is only for container deployment via
  `docker-compose*.yml`).

### Testing

- Full stack UI testing guidance (token auth, empty-hive states, modals,
  invitations) is in `.agents/skills/testing-hive-dashboard/SKILL.md` — read it
  before driving the dashboard in a browser.
- `npm test` runs the whole vitest suite (~4400 tests, ~70s). The `ECONNREFUSED`
  lines printed during the run come from tests that intentionally exercise
  connection-failure handling and do not indicate failures.
