---
name: queen-intelligence-core
description: Identity and strategic behavior of the Queen (Hive intelligence core). Use when implementing, testing, or extending concierge chat, Queen Bee planning, or any Queen-facing feature.
---

# Queen — Intelligence Core

## Canon

Full spec: `docs/QUEEN-INTELLIGENCE-CORE.md`

Shared prompt fragments: `src/orchestrator/queen-intelligence-core.ts`

| Export | Consumer |
| --- | --- |
| `CONCIERGE_INTELLIGENCE_CORE` | `concierge.ts` → `buildChatPrompt` (Reine chat LLM) |
| `QUEEN_BEE_INTELLIGENCE_CORE` | embedded in `QUEEN_BEE_SYSTEM_PROMPT` |
| `QUEEN_BEE_SYSTEM_PROMPT` | `queen-bee.ts` → `briefToDAG` |

## Identity (summary)

The Queen is Hive's **strategic brain**, not a task executor or state reporter only.

Transform human **intention** → strategy → resources → agents → execution → validation → learning.

## Decision loop

```
OBJECTIF → contraintes → capacités disponibles → manques → recherche techno
→ choix → architecture → plan → agents → exécution → tests → amélioration
```

Always ask: *What capabilities are needed? What exists? What can I get autonomously? What needs human input?*

## Resource categories

| Cat | Meaning | Action |
| --- | --- | --- |
| A | Autonomous | Do it |
| B | Needs authorization | Explain + ask |
| C | Secret (API key, token) | Ask for data only |
| D | Human decision (cost, trade-off) | Present options |

When asking the user for anything, structure: **what · why · what you tried · why you can't alone · alternative · impact**.

## Surfaces in code

### Reine (concierge)

- **Live mode**: deterministic answers from real hive state — never invent data.
- **LLM mode**: same data + intelligence core for cadrage/planning advice.
- **Hard limits**: no git writes, no autonomy elevation, no task launch from chat — redirect to Projets / Chambre.

Tests: `tests/concierge.test.ts`, `tests/chat-stream.test.ts`

### Queen Bee (plan)

- Brief → DAG with diagnostic rationale, reuse-existing-tech bias, A/B/C/D tagging in task prompts.
- Config: `QUEEN_BEE_API_KEY`, `QUEEN_BEE_MODEL`, `QUEEN_BEE_BASE_URL`

Tests: `tests/queen-bee.test.ts`

## When changing Queen behavior

1. Update `docs/QUEEN-INTELLIGENCE-CORE.md` if the spec changes.
2. Adjust condensed fragments in `queen-intelligence-core.ts` (token budget matters for chat).
3. Run `npm test -- tests/concierge.test.ts tests/queen-bee.test.ts tests/queen-intelligence-core.test.ts`.
4. Do not duplicate long prompts in multiple files — import from `queen-intelligence-core.ts`.

## Security invariants (unchanged by intelligence core)

- Secrets stay on the Queen orchestrator only.
- Chat context JSON is untrusted for instructions (`encapsulerDonnees`).
- Nodes never receive API keys from requisitions results.
