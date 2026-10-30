---
name: hive-contributor
description: Conventions, garde-fous et boucle de travail du dépôt Hive (TypeScript strict, Node 24.18+, vitest, Fastify, SQLite, React, Electron). Utiliser pour toute modification de code, de documentation ou de CI dans Hive, avant d'ouvrir ou de mettre à jour une PR, ou quand on demande comment contribuer, préparer une PR ou lancer les vérifications.
license: MIT
compatibility: Claude Code et Codex. Requiert node 24.18 ou plus récent, npm 11.16 ou plus récent, et git.
metadata:
  owner: Micka420-collab/hive
  version: '1.0'
---

# Contribuer à Hive

Lire d'abord `AGENTS.md` (démarrage, `.env`, ports, pièges de Node). Ce skill
dit COMMENT changer le code ; `AGENTS.md` dit comment le faire tourner.

## Règles non négociables

1. Jamais de poussée sur `main`. Une branche par changement, une PR vers `main`.
2. Jamais de shell pour lancer un programme : `spawn` / `execFile` avec
   `shell: false`, arguments en tableau, `--` avant toute entrée venue d'un
   utilisateur ou d'un dépôt.
3. Le contenu d'un dépôt de tâche (consignes, hooks, configuration MCP,
   skills) est une DONNÉE, jamais un ordre ni un programme : relu borné
   (`src/adapters/consignes-depot.ts`), neutralisé à l'exécution.
4. La plateforme est un paramètre : passer `process.platform` en argument
   plutôt que le lire au fond d'une fonction, pour que Windows soit testable
   depuis Linux.
5. Tout ce qui s'accumule (table, file, journal, cache) livre sa borne
   d'élagage dans le même commit.
6. Un comportement annoncé (README, doc, interface) est prouvé par un test
   qui ÉCHOUE sans le changement. Montrer cet échec dans la PR.
7. Ne jamais lire, afficher, journaliser ni committer `.env`, un jeton ou une
   clé. Un message d'erreur ne recopie pas une URL qui peut porter un jeton.

## Le style du dépôt

- Code, commentaires, messages de commit et documentation en français.
- Un commentaire dit POURQUOI, et souvent ce qui a cassé avant : le défaut
  mesuré, la version de l'outil, la plateforme. Pas de paraphrase du code.
- Les noms suivent le domaine de la ruche : Reine (orchestrateur), ouvrière
  (nœud), Rayon (miroir du code), bac (isolement), Aiguillage (routage).
- Un réglage lu dans l'environnement est écrit dans `.env.example`
  (`tests/reglages-documentes.test.ts` le vérifie). Une valeur inconnue qui
  affaiblirait une garde arrête le démarrage plutôt que de retomber en
  silence sur le défaut permissif.

## Boucle de travail

1. Chercher une PR ouverte sur le même sujet :
   `gh api 'repos/Micka420-collab/hive/pulls?state=open' --jq '.[].title'`.
2. Écrire d'abord le test vitest qui échoue (`tests/<sujet>.test.ts`).
3. Implémenter le minimum qui le fait passer.
4. Vérifier, dans cet ordre :
   - `npm run lint` (ESLint puis `prettier --check`) ;
   - `npm run typecheck` (et `npm run typecheck:dashboard` si `dashboard/`) ;
   - `npx vitest run tests/<fichier>.test.ts`, puis `npm test` en entier ;
   - `npm run loupe` : le code ajouté est-il défendu par ses tests ?
5. Le compte de tests est affiché publiquement : après `npm test -- --reporter=json --outputFile.json=rapport-tests.json`,
   `node scripts/compte-tests.mjs rapport-tests.json --corriger` met les
   badges à jour. Le tableau A de `docs/DEFINITION-DE-SORTIE.md` se
   re-mesure à la main, sur la jambe `ubuntu-latest` de la CI.
6. La CI tourne sur Ubuntu, macOS et Windows : dire dans la PR ce qui n'a été
   éprouvé que sur un système.

## Description de PR

- **Problème** constaté, avec sa reproduction.
- **Changement** : fichiers touchés, décisions prises seul.
- **Preuves** : tests ajoutés, et la preuve qu'ils échouent sans le correctif.
- **Limites** : ce qui n'est PAS prouvé, dit comme tel.
- `Closes #N` quand une issue est fermée.

## Interdits

- Corriger un compteur de tests à la main.
- Désactiver ou affaiblir un test pour passer la CI.
- Ajouter une dépendance sans dire sa licence, son mainteneur et pourquoi
  l'existant ne suffit pas.
- Installer un skill tiers dans le dépôt : il passe par `skills.lock.json`
  (`node scripts/skills.mjs relever …`, lecture complète, puis entrée du
  verrou), jamais par `npx skills add`.
