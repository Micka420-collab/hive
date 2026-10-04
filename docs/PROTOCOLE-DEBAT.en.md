# Debate, critique and arbitration — the hive's protocol

> What the hive does when two agents disagree, who settles, and what happens
> to an objection. Two protocols coexist, because there are two questions:
> **"are we heading the right way?"** (the Council) and **"is this production
> good?"** (counter-review + Evaluator). The War Room reads them together; the
> human settles.
>
> **This document cannot drift from the code.** Every table framed by a
> `verifie:…` comment is read back by `tests/protocole-debat.test.ts`: the
> constants against their values in the code, the Evaluator rules against
> `evaluate()` itself, scenario by scenario, the refusals, doors and events
> against their exhaustive lists. A changed constant, a moved rule, a refusal
> added without being described here: the suite turns red. The French
> version, [PROTOCOLE-DEBAT.md](PROTOCOLE-DEBAT.md), is held by the same test.

## The common rule

**No agent alone decides what enters `main`.** The Council proposes to a
human; the counter-review objects; the Evaluator judges quality, not
permission; merging a pull request always requires a human approval
(`canMerge` is true only on `accepted` **and** human review `approved`,
`src/orchestrator/evaluator.ts`).

## Who decides what

| Who                       | What it decides                                                                                                                             | What it never decides                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The Council of Scouts     | A **recommendation** (outcome `quorum`) — or the admission that it did not converge.                                                        | Nothing is applied: no task created, no repository touched.                                          |
| The counter-review        | `valide` or `conteste`, with objections. A contest, once every review is closed, requests an automatic correction.                          | It is never enough to merge, and never reruns the producer for its reviewer's failure.               |
| The Evaluator             | A quality verdict on the exact result; `correction_required` and `rejected` **stop** delivery and merge.                                    | It authorizes no merge; `human_review_required` and `additional_test_required` do not stop anything. |
| The human (project owner) | Settle a closed Council, approve or reject a production (with a reason), **override** the Evaluator with a required reason, deliver, merge. | —                                                                                                    |

"Project owner": its owner or an administrator — or the hive token on a
project with no owner (#467, `proprieteProjetPermise`,
`src/orchestrator/server.ts`). A member convenes the Council the way they add
a task; they do not settle it.

## The constants

<!-- verifie:constantes -->

| Constant                         | Value                                            | Where                                | What it governs                                                            |
| -------------------------------- | ------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------- |
| `VERSION_CONSEIL`                | 1                                                | `src/orchestrator/conseil.ts`        | Version of the deliberation protocol, stored with each session.            |
| `QUORUM_ECLAIREUSES`             | 3                                                | `src/orchestrator/conseil.ts`        | Distinct supports (author excluded) for a proposal to converge.            |
| `DIVERSITE_MIN`                  | 2                                                | `src/orchestrator/conseil.ts`        | Distinct agent families among those supports.                              |
| `POIDS_ARRET`                    | 1.5                                              | `src/orchestrator/conseil.ts`        | Weight of a stop signal against a support.                                 |
| `DEMI_VIE_TOURS`                 | 1                                                | `src/orchestrator/conseil.ts`        | Rounds after which an unreinforced dance loses half its intensity.         |
| `TOURS_MAX`                      | 5                                                | `src/orchestrator/conseil.ts`        | Maximum rounds; beyond, the Council stops (`epuise`).                      |
| `TOURS_SECS`                     | 2                                                | `src/orchestrator/conseil.ts`        | Rounds without a new proposal before exploration ends.                     |
| `LENTILLES`                      | utilite, concurrence, faiblesse, levier, abandon | `src/orchestrator/conseil.ts`        | The exploration angles, two of them adversarial.                           |
| `VERIFICATRICES_PAR_PROPOSITION` | 3                                                | `src/orchestrator/conseil-runner.ts` | Verifiers asked per proposal and per round — exactly the quorum.           |
| `CONSEILS_CONSERVES`             | 50                                               | `src/orchestrator/conseil-runner.ts` | Closed sessions kept; their human decision lives as long as they do.       |
| `JUSTIFICATION_MAX`              | 1000                                             | `src/shared/war-room.ts`             | Characters of the required justification of a Council decision.            |
| `RELECTEURS_PAR_PRODUCTION`      | 2                                                | `src/shared/contre-expertise.ts`     | Maximum reviewers per production, one per family, never the producer's.    |
| `AGENTS_SANS_AVIS`               | shell                                            | `src/shared/contre-expertise.ts`     | Families that never review (the simulated `shell`).                        |
| `OBJECTIONS_MAX`                 | 20                                               | `src/shared/contre-expertise.ts`     | Maximum objections read from a reviewer's verdict.                         |
| `ATTENTE_RELECTEUR_ABSENT_MS`    | 300000                                           | `src/orchestrator/scheduler.ts`      | Wait for an offline reviewer family (5 minutes) before `relecteur_absent`. |
| `MAX_ATTEMPTS`                   | 3                                                | `src/shared/types.ts`                | A task's attempt counter, shared by Worker failures and corrections.       |
| `VERSION_EVALUATOR`              | 1                                                | `src/orchestrator/evaluator.ts`      | Version of the Evaluator rules.                                            |
| `BORNES_CRITIQUE.objections`     | 8                                                | `src/orchestrator/brood.ts`          | Maximum objections frozen in a correction's critique.                      |
| `BORNES_CRITIQUE.objection`      | 300                                              | `src/orchestrator/brood.ts`          | Characters per frozen objection.                                           |
| `BORNES_CRITIQUE.raisons`        | 3                                                | `src/orchestrator/brood.ts`          | Maximum Evaluator reasons frozen.                                          |
| `BORNES_CRITIQUE.raison`         | 400                                              | `src/orchestrator/brood.ts`          | Characters per frozen reason.                                              |
| `BORNES_CRITIQUE.note`           | 1000                                             | `src/orchestrator/brood.ts`          | Characters of the human reason joined to the critique.                     |
| `BUDGET_CRITIQUE`                | 2000                                             | `src/orchestrator/server.ts`         | Characters of the "critique" block in the worker's context.                |
| `RAISON_REVUE_MAX`               | 1000                                             | `src/shared/war-room.ts`             | Characters of a human review's reason, at the route and when read back.    |

<!-- /verifie:constantes -->

---

## 1. The strategic debate — the Council of Scouts

`src/orchestrator/conseil.ts` decides (a pure module), `conseil-runner.ts`
runs it. A Council only opens on a human gesture (`POST
/api/projects/:projectId/conseil`, or "Convene the Council" in the War Room):
it creates real worker tasks, so it spends the time members lend.

1. **Proposal.** One scout per lens explores and reports `HIVE_PROPOSITION
{…}` as its final answer. An author's self-assessment (`qualite`) orders
   what gets checked first; it **never** counts as a support.
2. **Independent verification.** The other scouts go and look, and answer
   `HIVE_AVIS {"type":"soutien|arret",…}`. An author's opinion on its own
   proposal is ignored (flagged, never counted). One opinion per scout and per
   proposal: the latest wins.
3. **Decay.** An unreinforced dance loses half its intensity every
   `DEMI_VIE_TOURS` rounds: the first idea does not win by seniority.
4. **Quorum, not majority.** `QUORUM_ECLAIREUSES` distinct supports, from at
   least `DIVERSITE_MIN` families, **no** stop signal, a positive intensity. A
   stop weighs `POIDS_ARRET` supports.
5. **Bound.** `TOURS_MAX` rounds; exploration also ends after `TOURS_SECS`
   rounds without a new proposal.

<!-- verifie:issues -->

| Outcome       | Settled by a human | What the hive does                                                     |
| ------------- | ------------------ | ---------------------------------------------------------------------- |
| `quorum`      | no                 | A recommendation, **proposed** to the human. Nothing is applied.       |
| `depart`      | yes                | Several proposals tied at quorum: breaking the tie is refused.         |
| `sans_quorum` | yes                | Debate, nothing converged, nothing left to check.                      |
| `epuise`      | yes                | `TOURS_MAX` reached without converging: the Council stops and says so. |
| `vide`        | no                 | No proposal reported: there is nothing to settle.                      |

<!-- /verifie:issues -->

**The human decision is recorded (#478).** `POST
/api/conseil/:sessionId/decision` records `council_decided`: the retained
path — or `null`, "no path", which is a decision too —, a required
justification (`JUSTIFICATION_MAX` characters, never silently truncated), and
**who**: the account, its name frozen at the gesture, or the admission
`jeton_de_ruche` (the token is shared, it names nobody). A Council still
deliberating cannot be settled (409). Revising a decision requires naming the
one it replaces (`precedente`): two operators settling at once never silently
overwrite each other. The current decision survives journal pruning as long as
its Council is kept (`pruneEvents`).

---

## 2. The debate over code — counter-review, Evaluator, correction

### Step 1 — the production

A worker returns a result (`results`, identified by its `resultId`). The
Gardiennes inspect it (`clean`, `suspect`, `hollow`).

### Step 2 — critique by another family

`src/shared/contre-expertise.ts`, launched by `signalerContreExpertise`
(`src/orchestrator/server.ts`).

- **Who reviews:** at most `RELECTEURS_PAR_PRODUCTION` reviewers, **one per
  family**, never the producer's family nor a family of `AGENTS_SANS_AVIS`. No
  other family online: the counter-review is refused **and journaled**
  (`contre_expertise`, `possible: false`) — never mistaken for "found
  nothing".
- **Anonymity:** the reviewer does not know WHO produced. Its instructions
  (`consigneDeCritique`) receive only the task title and the diff: neither
  the producer's family nor its model, nor its logs (where its CLI names
  itself), not even "another model". Its context carries neither the
  Cerveau's episodes (Hive writes the failure as the CLI states it, « codex :
  échec — … » included), nor Hive Mind memories (they fall back on a
  production's logs), nor the experience graph; it keeps the rules only a
  human writes (invariants, lessons, decisions, maps). Humans keep the family:
  the announcement (`contre_expertise`), the verdict
  (`contre_expertise_verdict`) and the Evaluator's evidence name producer and
  reviewer. What escapes Hive: the diff's content (a style, a signature
  written in a file), the task title, a human rule that would name a family —
  and inference: in a two-family hive the reviewer knows the other one
  produced, all the more when Hive reviews itself, its `AGENTS.md` (served as
  the repository's instructions) describing the cross-review.
- **The verdict:** the reviewer answers `valide` or `conteste`, then one
  objection per line (`OBJECTIONS_MAX` at most, 300 characters each), in its
  **final answer** — never read from its logs —, and **ends** with a
  `HIVE_CRITIQUE` line (`src/shared/critique-structuree.ts`):

  ```text
  HIVE_CRITIQUE {"verdict":"valide|conteste","findings":[{"severite":"…","critere":"…","fichier":"…","preuve":"…","proposition":"…"}]}
  ```

  - `severite` ∈ `bloquant`, `majeur`, `mineur`, `info`; `critere` ∈
    `correction`, `securite`, `tests`, `performance`, `lisibilite`,
    `conformite` (accents and case tolerated); each finding carries its
    `preuve`.
  - **A `bloquant` or `majeur` finding contests**, even under `valide` — it
    becomes an objection. **`mineur` and `info` never block**: they are
    remarks, shown and passed on, that never reopen the production. A written
    `conteste` stays a contest.
  - The marker is read **only on the last non-empty line** (a closing code
    fence, a bullet or backticks around it are tolerated). Any other
    `HIVE_CRITIQUE` line — quoted from a diff that carried a ready-made one —
    never decides: more than one marker line, and the marker is unreadable.
    Read, it decides; the prose is no longer read, except a `conteste` on the
    **first line**: under a `valide` marker with no blocking finding, the
    contradictory answer is contested. A contest always keeps a reason: its
    blocking findings, otherwise the prose objections.
  - A malformed marker (broken JSON, off-grid value, missing `preuve`, more
    than one line, cut by a too-long answer) is discarded **whole** — never
    half-read — and the opinion is **contested** (`marqueur: "illisible"`):
    the discarded marker may have carried the only major defect.
  - **Without a marker**, the free-text reading applies: `conteste` always
    wins, and **one objection is enough** — written under `valide`, it counts
    as a contest (`agreger`). An unreadable verdict counts as contested too.
  - **Schema-bound:** a review — and only a review — imposes this grid as a
    JSON Schema (`SCHEMA_AVIS`) on a CLI that can hold it: Claude Code
    (`--json-schema`, from 2.1.205) and Codex (`--output-schema`). The opinion
    is read where the CLI returns it (`structured_output`, last
    `agent_message`), never from its prose, and written as a `HIVE_CRITIQUE`
    line: same reading, same grid — off-grid, it is contested. A CLI that ends
    without the required opinion leaves a review with no final answer. An
    older Claude Code keeps the instructions' line, and the review's journal
    says so, version included.

- **Scoring:** there is **no single score** — it would hide _which_ criterion
  failed. Findings are **counted per criterion and severity**
  (`compterParCritere`), which the Miellerie ("Findings per criterion") and
  the War Room (under each opinion) show. Severity decides, not the criterion;
  an `accepted` production with remarks says so in its reasons.
- **The wait:** a review only goes to its family. A family absent for
  `ATTENTE_RELECTEUR_ABSENT_MS` fails the review with
  `contre_expertise_review_failed`, reason `relecteur_absent`.

### Step 2b — the impossible review (#484)

A review can end **without an opinion**: absent family, reviewer failing past
its attempts, no final answer, review cancelled by a human. When it is the
last review in flight for that result and no opinion arrived:

1. **One fallback**, once, by a family independent of the producer that has
   not been engaged on this result yet (`contre_expertise` with `secours:
true`).
2. Otherwise — no fallback family, fallback already tried, or a
   **cancelled** review (a review a human just stopped is not bought back) —
   the hive records `contre_expertise_impossible` with its cause, and the
   Evaluator answers `human_review_required`: "relecture impossible:
   _cause_".

**The producer is never rerun for its reviewer's failure.** If another
reviewer already gave an opinion, that opinion decides once every review has
ended.

### Step 3 — the evidence and the Evaluator

`src/orchestrator/evaluator.ts` composes the facts of the **exact result**:
result, Gardiennes, Parliament, human review, counter-review, validations
(`tests`, `typecheck`, `build`, `lint`, brought by an identified evidence
producer — Hive sandbox or GitHub CI — never read from a worker's logs). The
first rule that applies decides, in the order of `evaluate()`. The test counts
the exits of `evaluate()` in its source, plays every row, and requires its
reason (the start of `reasons[0]`, which the code writes in French) to point
at that row only:

<!-- verifie:evaluator -->

| #   | When                                                                   | Decision                   | Retry recommended | Reason given (excerpt)             |
| --- | ---------------------------------------------------------------------- | -------------------------- | ----------------- | ---------------------------------- |
| 1   | no Worker result                                                       | `correction_required`      | yes               | `aucun résultat Worker`            |
| 2   | latest result failed                                                   | `rejected`                 | yes               | `le dernier résultat a échoué`     |
| 3   | hollow production (Gardiennes `hollow`)                                | `rejected`                 | yes               | `production creuse`                |
| 4   | the security gate found an added secret or an introduced vulnerability | `correction_required`      | yes               | `la porte de sécurité a trouvé`    |
| 5   | Gardiennes `suspect`                                                   | `correction_required`      | yes               | `signal suspect`                   |
| 6   | human rejection                                                        | `correction_required`      | yes               | `la revue humaine a rejeté`        |
| 7   | no Gardiennes inspection                                               | `human_review_required`    | no                | `aucune inspection indépendante`   |
| 8   | the result is not the one the Parliament elected                       | `correction_required`      | yes               | `faction élue`                     |
| 9   | contested counter-review                                               | `correction_required`      | yes               | `demande une amélioration`         |
| 10  | a failed validation                                                    | `correction_required`      | yes               | `en échec`                         |
| 11  | review impossible, with no opinion and no review in flight             | `human_review_required`    | no                | `relecture impossible :`           |
| 12  | security gate not verified, under `strict` polyethism                  | `human_review_required`    | no                | `non vérifiée, polyéthisme strict` |
| 13  | a validation is missing (or tests are not declared)                    | `additional_test_required` | no                | `preuves manquantes`               |
| 14  | a review of this result is still in flight                             | `human_review_required`    | no                | `contre-revue en cours`            |
| 15  | no favorable opinion from another family                               | `human_review_required`    | no                | `aucune contre-revue`              |
| 16  | everything green **and** an independent favorable opinion              | `accepted`                 | no                | `contre-revue favorable`           |

<!-- /verifie:evaluator -->

The impossible review (11) comes **before** missing evidence: no CI would
make `accepted` without an independent opinion, and "additional tests
required" would send the operator after evidence that unblocks nothing. A
first favorable opinion is not acceptance while another review of the same
result is in flight (14): an objection stays blocking, wherever it comes
from.

**Failing sandbox tests are compared to the base**, test by test
(`src/shared/lecture-tests.ts`, G11b) — when their default output is readable
(vitest, jest, `node --test`, TAP), without adding anything to the declared
script, and **complete and consistent**: it is partly written by the agent's
code, and a glued line, a summary that does not count everything, a duplicate
name or a failure the runner does not restate give the script's verdict —
never one more green. The base is replayed apart, in the sandbox: a fresh
repository fetched from the registry (never by reading the objects the agent
may have forged), a fresh install from its lockfile, its build, the same
script. A **regression** (red on every run of the production, on none of the
base) stays rule 10, and its reasons **name** it; tests **already red at the
base**, with the same failure (the message the runner prints, and its file),
no longer block — `accepted` (16) **says** them; a **flaky** test (seen red on
one run and green on another, of the production or of the base) is neither:
missing evidence (13). Each side is seen up to twice, lazily, and the second
run of the production replays its DELIVERED tree, apart — what the first run
left in the directory cannot make it pass —, a port of SWE-bench's
FAIL_TO_PASS / PASS_TO_PASS logic (`grading.py`, MIT), with the base as
reference. An unreadable or truncated output, a run with an environment
failure, a side that cannot be replayed, or runs that do not compare give the
script's verdict. The overhead — only when tests fail, 55 min at worst: two
replays apart (extraction, install, build, tests) and a second run of the
base — is announced in the progress line; each node remembers the bases it
replayed, except those that wavered.

The **security gate** (`src/shared/porte-securite.ts`) is not a fifth
validation: the node attaches it to its result (`porteSecurite`, recorded as
`security_gate_recorded`), part by part — secrets (Betterleaks, high
confidence, added lines only, on EVERY result that carries a diff, failures
included) and dependencies (osv-scanner, vulnerabilities INTRODUCED compared
with the base, for a successful production of the task tree; what leaves for
osv.dev: `src/shared/porte-securite-dependances.ts`). The Queen revalidates
each part ON ITS OWN: a malformed part becomes `rapport_rejete`, journaled
(`security_gate_rejected`), without taking the other with it. A finding (4)
comes before everything that calls a human: `human_review_required` does not
stop delivery, and an approval must not let a key go out; on a failed result
(2), the findings follow the reason, so that the critique carries them. Not
verified (tool missing, failed, osv.dev unreachable, node older than the
gate), it is **never counted green** — `accepted` says so in its reasons, as
it says how many introduced packages could not be queried ("passed in
part") — and it holds the production only under `strict` polyethism (12):
like a missing counter-visit, the production then waits for a human
(`human_review_required`, no retry — the producer cannot install the node's
tool). What that changes, and nothing more: delivery already required a human
approval, which this verdict does not block; the Evaluator no longer accepts
on its own (no memory kept in the Hive Mind without a human, no production
"judged" in the workers' quality). A human rejection relaunches the
production, and the gate with it.

### Step 4 — the correction, with the critique (#488)

Three doors reopen a successful production, all through
`Scheduler.retryFromEvaluator`; each freezes its **source** in the critique:

<!-- verifie:portes -->

| Source          | Door                                    | Trigger                                                                   |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `contre_revue`  | insufficient counter-review (automatic) | every review of the result is closed and the Evaluator recommends a retry |
| `revue_humaine` | human rejection (Honey House)           | `POST /api/tasks/:taskId/review` `{ state: "rejected", raison? }`         |
| `evaluator`     | explicit retry                          | `POST /api/tasks/:taskId/evaluation/retry` `{ resultId }`                 |

<!-- /verifie:portes -->

Common guards: the `resultId` must be the latest, no delivery may exist,
dependents must still be `pending`, no delegating ancestor may have failed,
and the attempt counter — the one Worker failures use — bounds the loop: a
retry is refused (`attempts_exhausted`) once the task has reached
`MAX_ATTEMPTS`.

**Known limit — the bound does not start from the same place.** A Worker
failure increments the counter and fails the task when it reaches
`MAX_ATTEMPTS`: three runs at most. A correction retry is granted while the
counter is **below** `MAX_ATTEMPTS`, and the first production did not
increment it: a production contested every time runs four times before
`attempts_exhausted` (measured on the capture lab hive). Aligning both paths
would change the bound of shipped behavior: it is left to an explicit
decision.

**The critique travels with the correction.** At retry time, the hive freezes
in the `task_retry` payload (`source: "evaluator"`, `critique.source` = the
door): the counter-review **objections** of the exact result
(`BORNES_CRITIQUE.objections` × `BORNES_CRITIQUE.objection`), the Evaluator
**reasons** (`BORNES_CRITIQUE.raisons` × `BORNES_CRITIQUE.raison`), and the
**reason of the human** who rejected (`BORNES_CRITIQUE.note`), and the
counter-review **remarks** — its `mineur` or `info` findings (blocking ones
are already there, as objections). At the next assignment, this block enters
the worker's context, within a `BUDGET_CRITIQUE`-character budget: human note
first, then objections, then reasons, then remarks — under budget, the tail
falls off. Like any text coming from an
agent, the critique is **data** framed by `<<<HIVE_DATA … HIVE_DATA>>>`,
never a free instruction. `critique_context` journals that it was joined;
`critique_refus` says it did not fit the budget — the attempt leaves without
it, and that shows.

**The critique survives the wait.** It only lives in the `task_retry`
payload, and `task_retry` is a **proof** that journal retention keeps with its
task (`src/shared/retention-journal.ts`): a reopened task waiting long in
`ready` keeps its critique, however many events are journaled meanwhile. Only
the journal's hard cap, as a last resort, can still remove an open task's
dossier — the whole task, or for a looping task by first cutting what a newer
proof of the same type replaces — and it **says so** in the Journal
(`journal_elagage`).

### Step 5 — retry refusals, and what is left to settle

A refused retry is journaled (`evaluator_retry_skipped`, with its reason
**and its source**: `contre_revue` or `revue_humaine`):

<!-- verifie:refus -->

| Refusal                      | Opens a disagreement | What it says                                                                     |
| ---------------------------- | -------------------- | -------------------------------------------------------------------------------- |
| `attempts_exhausted`         | yes                  | Attempts are exhausted: the objection stays without follow-up.                   |
| `root_cost_budget_exhausted` | yes                  | The delegated root has no cost budget left: the correction will not be paid for. |
| `delivery_exists`            | yes                  | The production is already delivered: it is no longer rerun.                      |
| `dependent_progressed`       | yes                  | Dependent tasks have already built on it.                                        |
| `stale_result`               | no                   | A newer production exists: the contest is moot.                                  |
| `task_not_done`              | no                   | The task is no longer done.                                                      |
| `ancestor_failed`            | no                   | A delegating ancestor failed: nobody would read the correction.                  |
| `invalid_result_id`          | no                   | The named result does not belong to the task.                                    |
| `unknown_task`               | no                   | The task no longer exists.                                                       |
| `shadow_task`                | no                   | A shadow-bench shadow gets one attempt: it is compared, not corrected.           |

<!-- /verifie:refus -->

"Opens a disagreement" only holds for the `contre_revue` source: after a
**human rejection**, the human has already settled — the War Room says "human
rejection without correction" without counting it as pending (neither
approving against one's judgement nor rejecting again would clear it). A
refusal journaled before that field, with no source, is still read as a
contest: unknown, so shown rather than hidden — unless a human rejection of
that production is stored: the route stored the rejection before journaling
the refusal, so "a review after the refusal" would never have cleared it.

### Step 6 — human arbitration

- The human review (Honey House) **decides**: `approved` opens delivery,
  `rejected` reruns the correction with its reason (`RAISON_REVUE_MAX`
  characters). A reason without a verdict is refused (`400
raison_sans_verdict`). A retry clears the verdict: an approval does not
  leak to the next production.
- `correction_required` and `rejected` **stop** delivery and merge.
  Overriding requires a reason (`forcer: { raison }`), and the gesture is
  journaled (`evaluator_overridden`: who, why, against which verdict) when it
  commits.
- Merging a pull request requires `accepted` **and** `approved`.
- Under `strict` polyethism, the counter-visit can **refuse** to deliver what
  a human approved (never the reverse): nurses and sensitive surfaces are
  always re-visited (`exigeContreVisite`, `src/orchestrator/polyethisme.ts`).

---

## 3. The War Room — reading it all in one place

`GET /api/war-room` (`src/shared/war-room.ts`, view
`dashboard/src/views/WarRoom.tsx`) folds these facts into one thread, per
project and per task, **recomputing nothing**; its only write is the decision
on a Council.

**On top, what is waiting on someone** — computed over the whole retained
thread, never hidden by a filter:

| What waits                                         | What clears it                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| a Council closed `depart`, `sans_quorum`, `epuise` | a human decision, "no path" included                                                                     |
| a contest whose retry was refused                  | a human review posted **after** the refusal (approve or reject), an Evaluator override, or a new attempt |
| an impossible review                               | the missing human review (whenever it was posted), an override, or a new attempt                         |

The override (`evaluator_overridden`) settles: it is a human's final decision
on that production, and the only gesture that ships a contested production
whose attempts are exhausted — once delivered, a rejection is refused
(`delivery_exists`) and would clear nothing. An impossible review lends the
Evaluator no verdict: the War Room states the journaled fact (no independent
opinion will come), not what the Evaluator concludes from it — an earlier
rule, a red CI for instance, may answer something other than
`human_review_required`.

**The thread**, newest first, is filtered by **voice** — the route's
`famille` — and each event read has exactly one:

<!-- verifie:journal -->

| Event                            | Who writes it                               | Voice       |
| -------------------------------- | ------------------------------------------- | ----------- |
| `council_opened`                 | the Council                                 | `conseil`   |
| `council_proposal`               | a scout                                     | `conseil`   |
| `council_review`                 | a verifier                                  | `conseil`   |
| `council_round`                  | the Council                                 | `conseil`   |
| `council_closed`                 | the Council                                 | `conseil`   |
| `contre_expertise`               | the launch (or its refusal, or a fallback)  | `relecture` |
| `contre_expertise_verdict`       | a reviewer from another family              | `relecture` |
| `contre_expertise_review_failed` | a review closed without an opinion          | `relecture` |
| `contre_expertise_impossible`    | the end of a counter-review with no opinion | `relecture` |
| `task_retry`                     | a correction retry (source `evaluator`)     | `evaluator` |
| `evaluator_retry_skipped`        | a refused retry                             | `evaluator` |
| `council_decided`                | a human settling a Council                  | `humain`    |
| `task_reviewed`                  | a human reviewing a production              | `humain`    |
| `evaluator_overridden`           | a human overriding the Evaluator            | `humain`    |

<!-- /verifie:journal -->

Retries after a Worker failure share `task_retry`; they are not a
disagreement, and the War Room does not show them. The journal is pruned:
when it has already lost lines, the thread **says so**. What must survive
pruning does — the current decision of each kept Council, and a task's
**proofs** (retry refusals, overrides, reviews, their impossibility), kept
with it while the hive can still decide something about it, then thirty days
after it closes (`src/shared/retention-journal.ts`) — and what clears a
disagreement is also read from the stored tables (current review, latest
result).

## What does not exist (yet)

- **A producer response round** before the correction (accept and revise, or
  refute with evidence and escalate). It costs one more agent run per
  disagreement: a pending product decision.
- **Risk-graded arbitration** outside `strict` polyethism.
