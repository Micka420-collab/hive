@AGENTS.md

## Spécifique à Claude Code

- Les skills du projet sont dans `.claude/skills/` : une COPIE générée de
  `.agents/skills/` (que Codex lit). On ne modifie que `.agents/skills/`, puis
  `node scripts/skills.mjs synchroniser`. La suite vitest rougit si la copie
  diverge.
- Aucun hook ni serveur MCP de projet n'est versionné ici : `.claude/` est
  ignoré par git, sauf `.claude/skills/`. Un réglage de projet se propose en
  PR, relu comme du code.
- Quand Hive fait travailler Claude Code sur un dépôt (y compris celui-ci, par
  la boucle V3), il le lance avec `--setting-sources user` : ce fichier, les
  skills et les réglages du dépôt n'y sont PAS chargés — les consignes sont
  relues comme données (`src/adapters/consignes-depot.ts`).
