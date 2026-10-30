---
name: hive-adapter-spoke
description: Créer ou modifier un adaptateur d'agent (AgentAdapter, src/adapters/) ou le comportement d'une ouvrière Hive (src/node-client/) sans rouvrir les gardes d'isolement, de détection, d'identifiants et de neutralisation du dépôt de tâche. Utiliser pour brancher un nouveau CLI d'agent IA, modifier claude-code, codex, cursor, cline, grok ou hermes-agent, ou changer ce qu'une ouvrière exécute.
license: MIT
compatibility: Claude Code et Codex. Requiert node 24.18 ou plus récent ; podman, docker ou bubblewrap pour les essais dans le bac.
metadata:
  owner: Micka420-collab/hive
  version: '1.0'
---

# Ajouter ou modifier un adaptateur d'agent

Un adaptateur fait tourner le CLI d'un MEMBRE, avec SON abonnement, sur le
dépôt d'un AUTRE membre. Chaque point ci-dessous ferme un trou déjà mesuré
dans ce dépôt ; un adaptateur qui en oublie un le rouvre.

Modèles à lire avant d'écrire : `src/adapters/claude-code.ts` (le plus
documenté), `src/adapters/codex.ts` (confiance du dépôt, bac propre au CLI),
`src/adapters/index.ts` (l'interface `AgentAdapter`).

## Checklist de conception — répondre à chaque point dans la PR

1. **Commande.** Binaire et argv exacts, binaire réglable par variable
   d'environnement (`HIVE_<NOM>_BIN`, à écrire dans `.env.example`).
   `spawn` sans shell. Le prompt va en DERNIER, derrière `--`
   (`src/adapters/prompt-argv.ts` montre l'injection que ça empêche).
2. **Détection.** Comment `src/node-client/agent-detect.ts` le trouve, et la commande qui dit
   s'il est connecté : un CLI installé mais non connecté n'a pas d'ouvrière.
3. **Ce que le dépôt fait exécuter au CLI.** Hooks, serveurs MCP, bloc `env`,
   plugins, réglages de projet, skills de projet. Les couper par une option
   du CLI (`--setting-sources user`, confiance `untrusted`…). Sans option :
   déclarer ces chemins dans `configurationExecutee` pour que le nœud les
   écarte avant l'agent (`node-client/configuration-inerte.ts`), ou refuser
   hors bac conteneur.
4. **Consignes du dépôt.** `CLAUDE.md` / `AGENTS.md` relus comme DONNÉES
   bornées par `consignes-depot.ts`, en tête du prompt, liens symboliques
   non suivis — jamais chargés nativement par le CLI.
5. **Identifiants.** Transmis par NOM dans l'environnement épuré du bac
   (`buildSandboxEnv`, `node-client/workspace.ts`), jamais à une sonde,
   jamais dans un journal.
6. **Sortie.** Lire la réponse finale, pas le flux brut. Jetons, coût et
   modèle seulement s'ils sont DÉCLARÉS par le CLI ; sinon « inconnu »,
   jamais une estimation (l'Aiguillage apprend sur ces chiffres).
7. **Effort et modèle.** Seulement les valeurs que l'aide du CLI installé
   documente (`effortsDocumentes`) ; sinon aucune.
8. **Arrêt.** L'arbre de processus tombe avec le nœud : groupe POSIX,
   `taskkill /T` sous Windows. Aucun orphelin après Ctrl+C ou `kill -9`.
9. **Délégation.** L'agent sait-il utiliser le pont MCP de délégation
   (`delegation-bridge.ts`) ? Sinon, le dire.

## Tests obligatoires

- **Faux binaire** sur le PATH : argv exact, absence de shell, variables
  transmises et rien d'autre.
- **Dépôt piégé** : hooks, configuration et skills du dépôt NON exécutés —
  un fichier témoin ne doit pas apparaître (modèle :
  `tests/claude-configuration-depot.test.ts`).
- **Bac** : exécution dans l'image `hive-agent:ci` ; écriture limitée au
  montage de la tâche.
- **Arrêt** : le nœud arrêté, aucun processus de l'agent ne lui survit.
- **Vrai binaire** quand il est présent, ignoré sinon en le DISANT (motif
  `HIVE_CLAUDE_REQUIS`).

## À ne pas faire

- Lancer le CLI depuis l'arbre de la tâche quand le binaire se cherche dans
  le répertoire courant (Windows) : partir du parent, entrer par `-C`.
- Déclarer le dépôt de tâche « de confiance » pour faire taire une invite.
- Estimer un coût que le CLI n'a pas donné.
