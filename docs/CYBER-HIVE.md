# Cyber Hive — Documentation technique

> Module de pentest autonome orchestré par IA, intégré à Hive.
> Ce document décrit l'architecture, les modules et l'utilisation de Cyber Hive.

---

## 📋 Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture](#architecture)
3. [Système de connexion IA](#système-de-connexion-ia)
4. [Module de pentest autonome](#module-de-pentest-autonome)
5. [Déchiffreur universel](#déchiffreur-universel)
6. [IA offensive — Jailbreak](#ia-offensive--jailbreak)
7. [Dashboard temps réel](#dashboard-temps-réel)
8. [Module de défense](#module-de-défense)
9. [Générateur de rapports](#générateur-de-rapports)
10. [Parseur langage naturel](#parseur-langage-naturel)
11. [Tests et CI/CD](#tests-et-cicd)

---

## Vue d'ensemble

Cyber Hive est un module de cybersécurité offensive et défensive intégré à Hive. Il permet d'orchestrer des tests de pénétration autonomes pilotés par IA, avec:

- **Pentest autonome** : orchestrateur IA qui enchaîne reconnaissance, exploitation et post-exploitation
- **Anti-traçage avancé** : nettoyage de logs, false flag, log poisoning, timestomping, memory wiping
- **Connexion IA multi-providers** : OAuth 2.1+PKCE, clés API, MCP (17 providers, 8 serveurs MCP externes)
- **Déchiffrement universel** : 20 algorithmes (AES, ChaCha20, RSA, 3DES, Blowfish, stéganographie, etc.)
- **IA offensive** : jailbreak pour attaque de 10 types d'infrastructures (serveur, cloud, IoT, SCADA, etc.)
- **Dashboard temps réel** : interface WebSocket avec timeline, données trouvées, posture de sécurité
- **Défense et durcissement** : analyse des vulnérabilités, score de sécurité, recommandations
- **Rapports complets** : Markdown, JSON, HTML autonome téléchargeable

Le code source se trouve dans `src/cyber-hive/`. Le point d'entrée public est `src/cyber-hive/index.ts`.

---

## Architecture

```
src/cyber-hive/
├── index.ts                    # Point d'entrée, exports publics
├── types.ts                    # Types partagés (Cible, ResultatPentest, etc.)
├── pentest-orchestrator.ts     # Orchestrateur principal du pentest
├── autonomous-agent.ts         # Agent autonome v1
├── autonomous-agent-v2.ts      # Agent autonome v2 (chaînes profondes)
├── anti-trace.ts               # Anti-traçage v1
├── anti-trace-v2.ts            # Anti-traçage v2 (renforcé, 3 niveaux)
├── attack-visualizer.ts        # Visualisation des attaques
├── container-manager.ts        # Isolation Docker
├── tool-registry.ts            # Registre des outils (nmap, sqlmap, etc.)
├── mcp-server.ts               # Serveur MCP local
├── mcp-client.ts               # Client MCP (8 serveurs externes)
├── connection-types.ts         # Types du système de connexion IA
├── connection-manager.ts        # Gestionnaire de connexions (OAuth, API, MCP)
├── connection-panel.ts         # UI du panneau de connexion
├── provider-registry.ts        # Registre des 17 providers IA
├── ai-orchestrator.ts          # Orchestrateur IA unifié (LLMs + MCP)
├── dechiffreur.ts              # Déchiffreur universel (20 algorithmes)
├── jailbreak-attaques.ts       # IA offensive — jailbreak
├── natural-language.ts         # Parseur d'input en langage naturel
├── natural-language-parser.ts  # Parseur de cible en langage naturel
├── defense.ts                  # Module de défense et durcissement
├── report-generator.ts         # Générateur de rapports (MD/JSON/HTML)
├── dashboard.ts                # Dashboard web temps réel (WebSocket)
└── __tests__/
    ├── connection-system.test.ts
    ├── dashboard.test.ts
    ├── dechiffreur.test.ts
    ├── defense-port-matching.test.ts
    ├── defense-sqlmap-false-positive.test.ts
    └── jailbreak-attaques.test.ts
```

---

## Système de connexion IA

Le système de connexion IA permet à Cyber Hive de se connecter à de multiples providers d'IA (LLMs, agents de code, serveurs MCP) via différents protocoles.

### Providers supportés (17)

| Catégorie | Providers |
|-----------|-----------|
| LLMs | Claude (Anthropic), GPT (OpenAI), Gemini (Google), Grok (xAI), Mistral, DeepSeek |
| Agents de code | Claude Code, Cursor, Cline, Codex, Hermes Agent |
| Serveurs MCP | AutoPentest, HexStrike, Shannon, Zen-AI-Pentest, Nemesis, LLM4Pentest |

### Méthodes de connexion

- **OAuth 2.1 + PKCE** : flux d'autorisation sécurisé pour les providers qui le supportent
- **Clés API** : authentification directe par clé API
- **MCP (Model Context Protocol)** : connexion à des serveurs MCP externes pour étendre les capacités

### Utilisation

```typescript
import { ConnectionManager } from './cyber-hive';

const manager = new ConnectionManager();

// Connexion OAuth
await manager.connectOAuth('anthropic');

// Connexion par clé API
await manager.connectApiKey('openai', 'sk-...');

// Connexion MCP
await manager.connectMCP('autopentest', 'ws://localhost:8080');
```

L'orchestrateur IA unifié (`ai-orchestrator.ts`) combine les LLMs et les serveurs MCP pour orchestrer un pentest autonome.

---

## Module de pentest autonome

### Orchestrateur (`pentest-orchestrator.ts`)

L'orchestrateur coordonne les phases de pentest :

1. **Reconnaissance** : nmap, masscan, whatweb, gobuster
2. **Exploitation** : sqlmap, wpscan, hashcat
3. **Post-exploitation** : collecte de données, escalation de privilèges

### Agent autonome v1 (`autonomous-agent.ts`)

Agent de base qui enchaîne les outils en fonction des résultats précédents.

### Agent autonome v2 (`autonomous-agent-v2.ts`)

Version enrichie avec :
- Chaînes d'attaque plus profondes (Masscan, Whatweb, Gobuster, WPScan, Hashcat)
- Décision contextuelle renforcée (sous-domaines, technologies, escalade)
- Gestion d'historique pour éviter les boucles

### Anti-traçage v1 (`anti-trace.ts`)

Techniques de base :
- Shredding de logs
- Anti-forensics (journalctl, auditctl)
- Spoofing (X-Forwarded-For, session ID)
- DNS over TOR
- Injection de faux historique
- Nettoyage cache ARP, cache mémoire, temporaires, timestamps

### Anti-traçage v2 (`anti-trace-v2.ts`)

Version massivement renforcée avec 3 niveaux de paranoïa :
- **Memory wiping** : nettoyage en mémoire
- **False flag injection** : APT28, Lazarus, etc.
- **Log poisoning** : corruption de logs
- **Timing obfuscation** : masquage temporel
- **Faux positifs** : génération de bruit
- **Timestomping avancé** : modification de timestamps
- **Nettoyage utmp/wtmp/lastlog** : effacement des traces de connexion
- **Nettoyage Docker complet** : suppression des traces de conteneurs

---

## Déchiffreur universel

Le module `dechiffreur.ts` permet de déchiffrer tout type de document avec 20 algorithmes :

### Algorithmes standards
- AES-256-GCM, AES-256-CBC, AES-128-CBC
- ChaCha20-Poly1305
- 3DES, Blowfish
- RSA (OAEP/PKCS1)
- Base64, Base64URL, Hex, XOR, ROT13

### Algorithmes militaires/gouvernementaux
- AES-256-CCM (mode AEAD FIPS-140)
- AES-256-XTS (chiffrement de stockage, NIST SP 800-38E)
- DES-CBC (historique, FIPS 46-3)
- Camellia-256-CBC (standard japonais/EU, ISO/IEC 18033-3)
- Cascade cipher (chiffrement en cascade multi-algorithmes)
- Stéganographie LSB (extraction de données cachées dans images)
- Brute-force XOR (test de toutes les clés 1-octet)

### Détection automatique

Le module détecte automatiquement le format d'encodage (Base64, Base64URL, Hex, binaire, texte) et l'algorithme de chiffrement utilisé.

---

## IA offensive — Jailbreak

Le module `jailbreak-attaques.ts` donne à l'IA de Cyber Hive des capacités offensives sur 10 types d'infrastructures :

| Type | Description |
|------|-------------|
| `serveur` | Services serveur (HTTP, SSH, FTP, etc.) |
| `domaine` | Noms de domaine (DNS, whois, sous-domaines) |
| `gouv` | Infrastructures gouvernementales (.gouv, .gov, .mil) |
| `cloud` | AWS, Azure, GCP, K8s, Docker |
| `iot` | Objets connectés |
| `scada` | SCADA/ICS (systèmes industriels) |
| `container` | Conteneurs (Docker, Kubernetes) |
| `mobile` | Applications mobiles |
| `api` | API REST/GraphQL |
| `reseau` | Infrastructure réseau |

Le module inclut :
- Un prompt système jailbreak offensif pour l'orchestrateur IA
- Un catalogue de stratégies d'attaque par type d'infrastructure
- Un générateur de prompts d'attaque contextuels
- Une détection automatique du type d'infrastructure depuis la cible
- Des fonctions de filtrage par phase (reconnaissance, exploitation)

---

## Dashboard temps réel

Le module `dashboard.ts` fournit une interface web moderne avec :

- **3 colonnes** : timeline de l'attaque, données trouvées, posture de sécurité
- **WebSocket** : streaming temps réel des événements
- **Input en langage naturel** : saisie de cible en texte libre
- **Rapport téléchargeable** : formats Markdown, HTML, JSON
- **Panneau de connexion IA** : cartes de providers avec boutons OAuth/API/MCP

Le dashboard écoute sur le port 7777 par défaut.

---

## Module de défense

Le module `defense.ts` analyse les vulnérabilités trouvées pendant le pentest :

- Calcul d'un **score de sécurité** global
- **Recommandations** de correctifs par vulnérabilité
- Évaluation de la **posture globale** de la cible
- Détection des ports ouverts avec word-boundary regex (évite les faux positifs)
- Analyse SQLMap avec regex précise (distingue "is injectable" de "do not appear to be injectable")

---

## Générateur de rapports

Le module `report-generator.ts` produit des rapports détaillés :

- **Markdown** : format texte lisible
- **JSON** : format structuré pour intégration
- **HTML autonome** : page HTML téléchargeable avec styles intégrés

Le rapport contient :
- Données trouvées (credentials, fichiers, bases de données)
- Méthodologie utilisée
- Timeline des actions
- Traces anti-forensics appliquées
- Recommandations de défense
- Conclusion et score de sécurité

---

## Parseur langage naturel

Deux modules de parsing en langage naturel :

### `natural-language.ts`
Parseur d'input général : accepte une description libre en entrée et extrait les intentions.

### `natural-language-parser.ts`
Parseur de cible : accepte une IP, URL, domaine ou description libre et extrait :
- Hôte
- Ports
- Scope
- Type de cible
- Options

---

## Tests et CI/CD

### Suite de tests

Les tests sont dans `src/cyber-hive/__tests__/` et couvrent :

| Fichier | Couverture |
|---------|------------|
| `connection-system.test.ts` | Types, registre de providers, gestionnaire de connexions, client MCP, orchestrateur IA |
| `dashboard.test.ts` | Dashboard WebSocket, streaming, rapports |
| `dechiffreur.test.ts` | Détection de format, détection d'algorithme, déchiffrement (20 algorithmes), métadonnées, gestion d'erreurs |
| `defense-port-matching.test.ts` | Word-boundary regex pour ports (évite faux positifs port 230 vs 23) |
| `defense-sqlmap-false-positive.test.ts` | Regex SQLMap (distingue injectable de non-injectable, EN + FR) |
| `jailbreak-attaques.test.ts` | Prompt système, génération de prompts, stratégies par type/phase, détection d'infrastructure, autorisation spéciale |

### CI/CD

Le pipeline CI (`.github/workflows/ci.yml`) exécute :
- **Vitest** : suite complète de tests
- **ESLint** : vérification du code
- **TypeScript strict** : compilation sans erreur

Lancer les tests localement :

```bash
npx vitest run src/cyber-hive/
```

---

## Évolutions récentes

| PR | Description |
|----|-------------|
| #375 | IA offensive jailbreak, attaques sur tous types d'infrastructures |
| #374 | Déchiffreur universel, 20 algorithmes (standards + militaires) |
| #373 | Fix SQLMap false positive sur paramètres non-injectables |
| #371 | Fix port matching avec word boundaries dans l'analyseur de défense |
| #368 | Système de connexion IA (OAuth 2.1, MCP, API) + 8 serveurs MCP externes |
| #367 | Dashboard temps réel, attaque enrichie v2, anti-traçage v2, défense, rapport complet |
| #366 | Fix args : validation stricte des entiers décimaux |
| #365 | Module de pentest autonome avec MCP (initial) |