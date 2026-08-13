---
name: testing-hive-dashboard
description: How to run the Hive orchestrator + dashboard locally and exercise the UI (token auth, empty-hive states, modals, invitations, agent detection) when testing changes end-to-end in a browser.
---

# Testing the Hive dashboard end-to-end

## Bring the stack up

```bash
source ~/.nvm/nvm.sh && nvm use 24     # Node >=24 is required (engines field)
cd <repo> && npm run ruche             # queen (7777) + local worker node + Vite dashboard (5173)
```

`npm run ruche` runs all three processes with prefixed logs (`reine`, `ouvrière`, `écran`).
Run it backgrounded and tail the log file — the `ouvrière` lines are where agent detection
is printed (e.g. `Agent utilisé   : Claude Code`), which is often the thing under test.
Variants: `-- --sans-ecran`, `-- --sans-noeud`, `-- --ecran-seul`.

Configuration is read from a root `.env` (do not print or commit its values). Keys that matter
for testing: `HIVE_PORT`, `HIVE_HOST` (default `127.0.0.1`), `HIVE_TOKEN`, `HIVE_SIMULATION`,
`HIVE_ISOLEMENT`, `HIVE_NODE_NAME`, `HIVE_AGENT` (force an agent, e.g. `shell`, for a node that
executes nothing for real).

## Auth

Every API call needs an `x-hive-token` header. The dashboard reads it from `localStorage`
under the key `hive.token` (see `dashboard/src/api.ts`); if it is absent `/api/state` answers
`{"error":"token invalide"}`. The token can also be typed into the masked `token` input in
the dashboard top bar, which persists it — no devtools needed.

## Getting the app into a specific state

- **Empty hive** (needed for the `.ruche-depart` "Your hive is ready" card and other
  zero-state UI): stop the stack, move `data/hive.db*` aside, restart. The DB is recreated
  empty and the local node re-registers automatically. Restore the files afterwards if the
  previous data mattered.
- **Creating a project without any remote repo or second member** works: "+ Project"
  (Projects view header) or "Start a project" (empty-hive card in the Hive view) → set a
  name, leave "Git repository" empty, pick the "Single task" template, "Start foraging".
  The task is dispatched to the local node within a second or two.
- **Language**: the top bar has an FR/EN toggle; assertions on labels must account for it.

## Where the overlays live (useful when testing modals)

- Invite → "+ Invite a friend" in the top bar (`InvitePanel.tsx`)
- Account → "Sign in" in the top bar (`AccountPanel.tsx`)
- New project → "+ Project", **only rendered in the Projects view** (`NewProjectModal.tsx`)
- Worker sheet → click a node card in the Hive view's Nodes panel (`NodesPanel.tsx`)
- OpenAlex → Memory view → "🧬 OpenAlex" button (`OpenAlexPanel.tsx`)

All of them render through `Voile` (`dashboard/src/ui.tsx`), which portals to `document.body`.
Beware: the top bar has `backdrop-filter`, which makes it the containing block for
`position: fixed` descendants — any overlay that stops using the portal will silently render
off-screen (previously measured at y = -129). A quick objective check in the console:
`document.querySelector('.modal').getBoundingClientRect()` vs `innerHeight`/`innerWidth`.

Escape-to-close comes from `useDialog` (or a local handler in `InvitePanel`). It was missing
on `OpenAlexPanel` until it was wired up; a new overlay that forgets `useDialog` closes on the
backdrop and the × but not on Escape, so verify per-modal rather than assuming.

## Window sizing for responsive checks

Resize the real browser window rather than emulating: `wmctrl -r :ACTIVE: -e 0,50,50,<w>,<h>`,
and `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz` to restore. `.modal` is capped
with `max-height: calc(100dvh - 40px)` and scrolls internally.

## Invitations

`GET /api/invite` (and `POST /api/billets`) return `injoignable` when the hive listens on a
loopback host but advertises a LAN IP; the dashboard shows it as a ⚠ line inside the invite
modal. To make the warning appear, keep `HIVE_HOST=127.0.0.1` (the default) on a machine that
has a non-internal IPv4. To make it disappear, use the modal's collapsible "Regenerate with an
exact URL" section with `ws://localhost:7777/ws`.

## Testing the CLI installer's rendering

`src/tui/rendu.ts` adapts to terminal capabilities, so a piped run (non-TTY) exercises the
*fallback* path and hides every regression in the real one — no banner, no spinner, no frames.
Drive it through a pty instead, with a chosen width, and strip the escapes only when reading:

```python
pid, fd = pty.fork()
if pid == 0:
    os.execvpe('node', ['node', 'scripts/lancer.mjs', 'src/installer-main.ts'],
               dict(os.environ, COLORTERM='truecolor', TERM='xterm-256color'))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))  # 100 columns
# then feed the prompts with os.write(fd, b'\r') on a timer and read the output
```

Run it in a scratch directory (it writes `.env` there) and delete the `.env` between runs,
otherwise the "already in place" branch skips the section under test. Watch for the two
failure modes the unit tests do not catch: text truncated with `…` (a URL or command you are
meant to copy), and multi-space column alignment collapsed by re-wrapping.

Installer tests fail with exit code 4 when **port 7777 is already in use** by a leftover
`npm run ruche`; check with `ss -ltnp` before believing a rendering regression.

## Test-count badges

The README/site badges are asserted by a test. After adding or removing tests:
`npx vitest run --reporter=json --outputFile=rapport-tests.json && npm run compte-tests -- --corriger`.
`tests/service-accepte.test.ts` fails in this environment (systemd units absent) and is
preexisting on `main`.

## Devin Secrets Needed

None — the local `.env` in the repo root supplies everything (`HIVE_TOKEN`, `HIVE_JWT_SECRET`).
Claude Code (`claude`) must be installed for agent-detection tests; otherwise the node falls
back to `Shell (simulé)`.
