# Changelog

Tout changement notable de HIVE est documenté dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère au [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **🧬 OpenAlex** — moteur de recherche scientifique intégré (papers, auteurs, citations).  
  Route `GET /api/openlex/search?q=...` + onglet dédié dans le dashboard
- **🧠 Queen Bee** — découpage IA d'un brief projet en DAG de tâches via OpenRouter.  
  Commande CLI `brief` + endpoint `POST /brief`
- **🧩 Hive Mind** — mémoire RAG partagée entre agents. Store hybride SQLite FTS5 +  
  embeddings Ollama. API `POST /api/memory`, `GET /api/memory/search?q=...`
- **🔐 Authentification** — register/login JWT + marketplace de projets publics
- **Adaptateur Hermes Agent** — `hermes agent run --prompt "<prompt>"`
- **Dashboard React + Vite** — Swarm View 2D/3D (Galacean), KPI, journal, tiroir  
  CodeMirror, création projet/tâches UI, panneau d'invitation

### Fixed

- Compilation TypeScript stricte (`tsc --noEmit` propre)
- Tests Hive Mind : correction FTS5 (requête → OR) + assertion `buildContext`

## [0.1.0] — 2026-07-14

### Added

- Orchestrateur central (Fastify + WebSocket + SQLite) avec hub-and-spoke
- Client nœud avec reconnexion automatique et heartbeat
- Démo `npm run demo` : orchestrateur + 2 nœuds simulés + projet 7 tâches DAG
- Sandbox v0 : cwd dédié, environnement épuré, timeout, annulation
- Adaptateurs : shell (simulé), claude-code, codex
- Dashboard Swarm View : vue SVG 2D + vue 3D Galacean Engine
- CLI : state, project, brief, tasks, watch, cancel, invite
- Invitations : `npm run join -- <token>` avec auto-détection d'agent
- Persistance SQLite (survit aux crashs), journal d'événements
- Sécurité : token partagé, CORS restreint, validation entrées, anti-DoS,  
  zéro `shell: true`, défense anti path-traversal côté nœud
