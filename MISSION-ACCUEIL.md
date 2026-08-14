# PROMPT — Mission « L'ACCUEIL »

> **Dépôt :** `github.com/Micka420-collab/hive` · branche `main`
> **Mode :** ultracode, exécution-first, budget sous-agents illimité.
> **À déposer** à la racine du dépôt (`MISSION-ACCUEIL.md`) et à donner comme prompt d'ouverture à l'agent (Claude Code / Codex / la ruche elle-même).

---

## 0. TL;DR (pour Micka)

Ce fichier remplace « fais un installeur joli ». Il dit à l'agent : **qui il est**, **ce qui existe déjà et qu'il ne doit pas réinventer**, **les trois chemins d'entrée à couvrir** (Reine locale · nœud ami · serveur), **la charte visuelle exacte** du TUI, **la matrice de distribution** (Windows / Linux / macOS / Docker / npx), **les invariants de sécurité non négociables**, **les tests exigés**, et **comment livrer**. Chaque exigence est vérifiable ou chiffrée — rien qui se termine par « et que ce soit propre ».

---

## 1. IDENTITÉ & DIRECTIVE PRIME

Tu es **l'ingénieur responsable de l'accueil de Hive**. Pas un décorateur de terminal : le premier écran est une **fonctionnalité produit**, et c'est celle qui décide si la ruche a des membres ou pas.

**Directive prime :** faire passer Hive de « un dépôt qu'il faut cloner, lire et configurer » à **« une commande, moins d'une minute, et ma ruche tourne »** — sur **Windows**, sur **Linux/macOS**, et sur un **serveur sans écran**, sans jamais trahir les garanties de sûreté déjà en place.

**Règle d'or :** un installeur qui touche à la machine est un installeur qu'on n'ose pas lancer. Hive demande déjà qu'on lui confie ses clés d'API — l'accueil doit **acheter la confiance**, pas la dépenser.

---

## 2. ÉTAT RÉEL DU DÉPÔT — NE RÉINVENTE RIEN

Lis ces fichiers **avant d'écrire une ligne**. Ils contiennent déjà les bonnes décisions ; ton travail les prolonge.

| Fichier                           | Ce qu'il fait déjà                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/installer.ts` (217 l.)       | **Module pur, testé** : `engendrerJeton` (randomBytes), `lireEnv`, `composerReglages`, `rendreEnv`, `avertissements`, `nodeSuffisant`, `prochainesEtapes`.     |
| `src/installer-main.ts` (95 l.)   | La partie impure : lit, écrit `.env` en `0600`, affiche. **C'est le seul fichier qui touche au disque.**                                                       |
| `src/node-client/agent-detect.ts` | Détection Claude Code / Codex par `spawn(bin, ['--version'], {shell:false})`, avec variantes `.cmd`/`.exe` sur Windows.                                        |
| `src/node-client/join.ts`         | `npm run join -- hive1_…` : billet → clé de nœud, identité stable (`node-id.txt`), clé rangée en `0600`.                                                       |
| `src/node-client/cloudflare.ts`   | Téléchargement multi-plateforme d'un binaire tiers **avec vérification des octets magiques** (`MZ` sur Windows, ELF/Mach-O ailleurs). **Réutilise ce patron.** |
| `src/node-client/isolement.ts`    | Détection podman **avant** docker (rootless d'abord), messages d'installation, garde-fous.                                                                     |
| `.env.example` (8,9 ko)           | La référence des réglages et de leur documentation.                                                                                                            |
| `src/shared/types.ts`             | `MIN_TOKEN_LENGTH` — la ruche **refuse de démarrer** en dessous.                                                                                               |

**Invariants déjà acquis, à ne pas casser :**

1. **Aucun `sudo`, aucun paquet système, aucun service au démarrage, aucun `PATH` modifié** par défaut.
2. **Le `.env` existant n'est jamais réécrit** — il est lu, complété, jamais écrasé. Écraser un jeton en service coupe tous les nœuds connectés.
3. **`shell: false` partout.** Zéro interpolation dans une commande.
4. **`HIVE_RUNNER=off` par défaut** — l'autonomie réelle dépense du temps-machine ; on ne l'allume jamais à la place de quelqu'un.
5. **Les clés d'API ne quittent jamais la machine qui les héberge.**
6. Fichiers sensibles en `0600` (`.env`, `node-key.txt`).

---

## 3. LE PROBLÈME, PRÉCISÉMENT

L'installeur actuel fait le bon travail mais le fait **mal voir** :

- `println` à plat, aucun état de progression, aucune interaction — l'utilisateur ne **choisit** rien, il subit une liste.
- **Il faut avoir déjà cloné le dépôt** pour le lancer. Le vrai premier écran de Hive, aujourd'hui, c'est un `git clone` dans un README de 538 lignes.
- **Aucun chemin serveur** : pas de mode non-interactif, pas d'unité systemd, pas d'image conteneur, pas de bind explicite, pas de codes de sortie documentés.
- **Windows est toléré, pas accueilli** : `.cmd/.exe` gérés dans la détection d'agent, rien d'autre.
- **Aucun diagnostic** : quand ça ne marche pas, il n'y a rien à lancer pour savoir pourquoi.

---

## 4. CIBLE MESURABLE (definition of done)

L'accueil est fini quand **tout** ceci est vrai :

| #   | Critère                                                                                                   | Comment on le vérifie                           |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | De « machine nue » à « ruche qui tourne » en **une commande** et **≤ 3 décisions humaines**.              | Chrono sur VM propre Windows 11 + Ubuntu 24.04. |
| 2   | **< 60 s** hors temps de téléchargement npm.                                                              | Mesure loggée par l'installeur (`--timings`).   |
| 3   | **0 nouvelle dépendance runtime.** Le TUI est écrit à la main en ANSI.                                    | `package.json` inchangé côté `dependencies`.    |
| 4   | Relançable **n fois** sans effet de bord ni perte de config.                                              | Test d'idempotence (voir §12).                  |
| 5   | Fonctionne **sans TTY** (CI, `ssh cmd`, pipe) en dégradant proprement.                                    | Test avec `stdout` non-TTY.                     |
| 6   | Fonctionne avec `NO_COLOR=1`, `TERM=dumb`, et en 80 colonnes.                                             | Tests de rendu pur.                             |
| 7   | **CI verte sur `ubuntu-latest` ET `windows-latest`.**                                                     | Matrice ajoutée à `.github/workflows/ci.yml`.   |
| 8   | `hive doctor` diagnostique **10 causes de panne** et dit quoi faire pour chacune.                         | Un test par diagnostic.                         |
| 9   | Un serveur se déploie **sans écran** : `--non-interactive` + variables d'env, codes de sortie documentés. | Script de bout en bout dans `examples/`.        |
| 10  | README **FR et EN** + `CHANGELOG.md` à jour dans le même commit.                                          | Revue.                                          |

---

## 5. LES TROIS CHEMINS D'ENTRÉE

Un seul binaire, **trois intentions**. La première question du TUI est celle-ci et rien d'autre :

```
  ▸ Ouvrir ma propre ruche          (je suis la Reine — orchestrateur + dashboard)
    Rejoindre une ruche             (j'ai reçu un billet d'invitation)
    Installer sur un serveur        (sans écran, service, conteneur)
```

**A · Reine locale.** Ce que fait `install:hive` aujourd'hui, en interactif : Node → `.env` → agent → premiers pas. Doit finir en **proposant de lancer** (`npm run dev`) plutôt qu'en l'écrivant.

**B · Nœud ami.** Colle le billet `hive1_…` → tout est dedans (URL + jeton). Chaîne sur `join.ts`, qui existe. **Zéro fichier à éditer.** Si le billet est expiré/consommé, dis-le **en clair** avec la marche à suivre — c'est le cas d'échec le plus fréquent et le plus vexant.

**C · Serveur.** Voir §9. Non-interactif, idempotent, scriptable, supervisé.

---

## 6. LE DESIGN — « comme Claude Code », rendu explicite

« Beau » n'est pas une instruction. Voici la charte, elle est contraignante.

### 6.1 Charte

- **Palette :** ambre/miel comme accent unique (`\x1b[38;5;214m`), texte par défaut sans couleur, gris `dim` pour tout ce qui est secondaire. **Jamais plus d'une couleur d'accent à l'écran.**
- **Cadres arrondis** en box-drawing : `╭ ─ ╮ │ ╰ ╯`. Largeur **fixée à `min(terminal, 76)`**, jamais de débordement.
- **Espace négatif** : une ligne vide avant et après chaque bloc. La densité, c'est du bruit.
- **États** : `✔` (fait), `▸` (curseur), `◦` (à venir), `⚠` (avertissement), `✘` (échec). Pas d'emoji dans le flux d'exécution — l'emoji reste pour le README et le titre.
- **Spinner** : cadence 80 ms, séquence `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, **remplacé par la ligne finale** (jamais de spinner résiduel dans le scrollback).
- **Marque** : un hexagone ASCII + « HIVE », 4 lignes maximum. Une seule fois, en haut.

### 6.2 Séquence d'écrans

```
╭──────────────────────────────────────────────────────────────────────────╮
│   ⬡  H I V E                                                             │
│   Orchestration communautaire d'agents IA                        v0.2.0  │
╰──────────────────────────────────────────────────────────────────────────╯

  Vérifications

  ✔  Node v24.8.0                                     (≥ 24 requis)
  ✔  Port 7777 libre
  ✔  Espace disque              2,1 Go
  ✔  Agent de codage            Claude Code
  ◦  Bac à sable                podman absent, docker absent  →  mode direct

  Que voulez-vous faire ?

  ▸ Ouvrir ma propre ruche
    Rejoindre une ruche
    Installer sur un serveur

  ↑↓ choisir · ⏎ valider · ^C annuler
```

Puis : configuration (jeton engendré, montré **une seule fois**, jamais re-affiché), résumé des écritures **avant** de les faire, exécution, et un dernier cadre « et maintenant » avec **3 commandes maximum**.

### 6.3 Règles d'interaction

- **Navigation aux flèches** (raw mode), `⏎` valide, `^C` annule **proprement** (curseur restauré, écran non cassé, code de sortie `130`).
- **Toute question a un défaut sûr.** `⏎` seul doit toujours mener à l'issue la plus prudente.
- **Rien n'est écrit avant un récapitulatif** listant les chemins touchés. C'est ce qui rend l'installeur lançable sans peur.
- **Le jeton engendré est affiché encadré, avec la consigne** : ne jamais le publier, partager un **billet** à la place.

### 6.4 Dégradations obligatoires

| Condition                | Comportement                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `stdout` non-TTY         | Sortie linéaire, une ligne par étape, **aucun code ANSI**.                             |
| `NO_COLOR` / `TERM=dumb` | Idem sans couleur, cadres conservés en ASCII (`+ - \|`).                               |
| Largeur < 60 colonnes    | Cadres abandonnés, texte brut.                                                         |
| `--non-interactive`      | Aucune question ; toute réponse manquante = **échec explicite**, pas un défaut deviné. |
| `CI=true`                | `--non-interactive` implicite.                                                         |

### 6.5 Architecture du TUI

**Contrainte forte : zéro dépendance.** Deux fichiers, séparation identique à celle qui existe déjà :

- `src/tui/rendu.ts` — **pur**. Des fonctions `(état) => string[]`. Cadres, listes, badges, barres. **100 % testable sans terminal.**
- `src/tui/terminal.ts` — impur. Raw mode, `readline`, curseur, signaux, restauration en `finally`.

L'installeur devient `src/installer-main.ts` → orchestration ; `src/installer.ts` reste la logique pure et **ne bouge que par ajout**.

---

## 7. DISTRIBUTION — LA MATRICE

C'est ici que « pour Windows et les autres serveurs » se concrétise. **Tous les points ci-dessous sont exigés.**

### 7.1 npm (chemin canonique)

- Publier le paquet — `private: true` doit sauter, nom à vérifier sur le registre (`hive` est pris : prévois `@micka420/hive` ou `hive-ruche`, **tranche et documente**).
- `bin: { hive: "./dist/cli.js" }`, build par `tsc` (pas de bundler nouveau).
- **`npm publish --provenance` via OIDC GitHub Actions.** Non négociable : c'est cohérent avec ce que le projet promet sur la traçabilité, et ça donne une attestation vérifiable à ceux qui lancent un `npx` à l'aveugle.
- Entrée : `npx @micka420/hive@latest` → l'écran de §6.2.

### 7.2 Windows

> **Note de livraison (2026-08-14) — la forme demandée au point 1 ci-dessous ne
> peut fonctionner sur aucune machine, et elle est conservée telle quelle parce
> qu'une mission se cite, elle ne se réécrit pas.** `iex` évalue une EXPRESSION,
> et le `param()` d'`install.ps1` n'est valide qu'au début d'un SCRIPT ; un
> utilisateur l'a signalé avec sa trace de `ParserError`. S'y ajoute que le
> script appelle `exit` sept fois, ce qui sous `iex` fermerait la session de
> l'utilisateur au lieu de rendre un code. La commande livrée télécharge donc le
> fichier d'abord (`-OutFile`) et le lance par `-File` — voir le README, et
> `docs/adr/0002-distribution-one-liners.md` pour le dossier complet. Tout le
> reste du point 1 (rien en douce, 5.1 et 7+, empreinte, pas d'élévation) est
> tenu inchangé.

1. **One-liner PowerShell** — `irm https://hive.<domaine>/install.ps1 | iex` :
   - vérifie/installe **rien** en douce : si Node < 20 manque, il **affiche** la marche à suivre (winget/nodejs.org) et sort avec un code net ;
   - PowerShell **5.1 et 7+** tous les deux supportés ;
   - **empreinte SHA-256 affichée et vérifiable** avant exécution du reste, avec l'URL de l'empreinte publiée dans la Release GitHub ;
   - **pas d'élévation.** Si un chemin réclame l'admin, on le refuse et on propose l'alternative utilisateur.
2. **Manifeste winget** (`hive.hive`) une fois le paquet npm publié — chemin propre pour les postes gérés.
3. **Service Windows** — opt-in **explicite**, jamais par défaut :
   - défaut recommandé : **Tâche planifiée à l'ouverture de session** (aucun droit admin) ;
   - option avancée documentée : service via `sc.exe`/NSSM, avec la conséquence dite en clair (tourne hors session, survit à la déconnexion, réclame l'admin).
4. **Chemins** : `%APPDATA%\hive` pour l'état, `%LOCALAPPDATA%\hive\logs`. Jamais d'espace non échappé, jamais de séparateur codé en dur — `path.join` partout.
5. **ACL** : l'équivalent Windows du `0600` (`icacls` restreint à l'utilisateur courant) sur `.env` et `node-key.txt`. **Aujourd'hui le `mode: 0o600` est silencieusement inopérant sur Windows — c'est un vrai trou, ferme-le.**
6. Terminal : tester **Windows Terminal, ConHost et VS Code**. ConHost ancien ne gère pas les couleurs 256 → détection et repli 16 couleurs.

### 7.3 Linux / macOS

1. **One-liner** — `curl -fsSL https://hive.<domaine>/install.sh | sh` : POSIX `sh`, pas de bashisme, `set -eu`, empreinte affichée, aucun `sudo`.
2. **Unité systemd** générée (`hive.service`), **installée seulement sur demande explicite**, en mode `--user` par défaut :
   - `Restart=on-failure`, `RestartSec=5`, `WorkingDirectory`, `EnvironmentFile=%h/.config/hive/.env` en `0600` ;
   - durcissement : `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectSystem=strict`, `ProtectHome=read-only` avec `ReadWritePaths` minimal ;
   - `hive service install|status|logs|uninstall` — et **`uninstall` doit vraiment tout retirer**.
3. **macOS** : `launchd` plist équivalent, même politique opt-in.
4. Chemins XDG : `~/.config/hive`, `~/.local/share/hive`, `~/.cache/hive`.

### 7.4 Conteneur

1. **Dockerfile multi-stage**, image finale `node:22-slim` **non-root** (`USER hive`), `HEALTHCHECK` sur `/api/pulse`.
2. **Volume** pour la base SQLite — nommé, documenté, **avec la procédure de sauvegarde** (`better-sqlite3` : `VACUUM INTO`, pas une copie de fichier à chaud).
3. `compose.yaml` minimal : orchestrateur + volume + variables. Le jeton vient de l'environnement, **jamais du fichier compose**.
4. Publication sur **GHCR**, image **signée (cosign, keyless OIDC)** et SBOM joint. Même raison qu'en §7.1.
5. **Le nœud membre n'est pas conteneurisé** par défaut : il doit voir l'agent de codage et l'espace de travail de son hôte. Dis-le, ne le laisse pas se découvrir.

### 7.5 Ce que l'installeur ne fait jamais

Installer Node, Git, Docker, un agent de codage, ou quoi que ce soit hors du dossier de projet **sans un « oui » explicite à une question qui nomme le paquet**. Il détecte, il explique, il donne la commande. Il n'installe pas à la place des gens.

---

## 8. RÉSEAU & MISE EN LIGNE

- **Bind par défaut : `127.0.0.1`.** Toujours.
- `--bind 0.0.0.0` exige **deux** choses : le drapeau **et** un jeton ≥ `MIN_TOKEN_LENGTH` non trivial. Sinon, refus documenté. Un avertissement encadré rappelle qu'il n'y a pas de TLS en propre.
- **Trois chemins d'exposition**, dans cet ordre de préférence :
  1. **Tunnel `cloudflared`** — le code existe déjà (`cloudflare.ts`, `tunnel.ts`), zéro port ouvert ;
  2. **Reverse proxy** — extraits **Caddy** (TLS auto) et **nginx**, avec `proxy_pass` **WebSocket correct** (`Upgrade`/`Connection`) : c'est le piège classique, ne le laisse pas au lecteur ;
  3. Port direct, découragé, documenté quand même.
- Vérification de port **avant** d'écrire quoi que ce soit, avec proposition du port suivant libre.

---

## 9. MODE SERVEUR / HEADLESS

```bash
hive install \
  --role queen \
  --non-interactive \
  --port 7777 \
  --bind 127.0.0.1 \
  --token-from-env HIVE_TOKEN \
  --gardiennes strict \
  --runner off \
  --service systemd-user \
  --yes
```

Exigences :

- **Le jeton ne passe JAMAIS en argument de ligne de commande.** `--token-from-env` ou `--token-file` uniquement — `/proc/*/cmdline` et l'historique shell sont lisibles.
- **`--dry-run`** : affiche exactement ce qui serait écrit, n'écrit rien. Sortie stable, diffable.
- **`--json`** : sortie machine pour Ansible/Terraform/Nix.
- **Codes de sortie documentés** dans le README :

  | Code | Sens                                                          |
  | ---- | ------------------------------------------------------------- |
  | 0    | succès (y compris « rien à faire »)                           |
  | 1    | erreur générique                                              |
  | 2    | prérequis manquant (Node, disque…)                            |
  | 3    | réponse requise absente en non-interactif                     |
  | 4    | port occupé                                                   |
  | 5    | refus de sécurité (jeton faible, bind public sans jeton fort) |
  | 130  | interrompu par l'utilisateur                                  |

- **Idempotent** : relancé, il constate et ne réécrit rien. Sortie `0`, message « déjà en place ».

---

## 10. `hive doctor`

Une commande, un verdict par ligne, **et pour chaque échec la commande exacte qui répare**. Minimum dix diagnostics :

1. Version de Node ≥ 24.
2. `.env` présent, lisible, permissions correctes (**ACL sur Windows**).
3. Jeton ≥ `MIN_TOKEN_LENGTH` et non trivial.
4. Port d'écoute libre ou occupé **par notre propre processus** (distinguer les deux).
5. Base SQLite : présente, intègre (`PRAGMA integrity_check`), inscriptible.
6. Dashboard construit et servi.
7. Agent de codage détecté (via `agent-detect.ts`).
8. Runtime d'isolement détecté (via `isolement.ts`), avec la nuance podman/docker déjà écrite dans le code.
9. Connectivité orchestrateur → dashboard → **WebSocket** (le WS est le point de panne qui ne se voit pas).
10. Réglages dangereux allumés : `HIVE_RUNNER=on`, bind public, `HIVE_GARDIENNES=off`.
11. Espace disque et droits d'écriture sur l'espace de travail.

`--json` obligatoire ici aussi : c'est la commande qu'on branche sur une supervision.

---

## 11. SÉCURITÉ — INVARIANTS NON NÉGOCIABLES

1. **Aucun `shell: true`**, aucune concaténation dans une commande. Toujours `spawn(bin, args, {shell:false})`.
2. **Aucun secret en argv, en log, en télémétrie.** Il n'y a **pas de télémétrie**, et le README le dit.
3. **Tout téléchargement de binaire est vérifié** — reprends le patron d'octets magiques de `cloudflare.ts` et **ajoute une empreinte SHA-256 attendue**, publiée dans la Release.
4. **Le `.env` n'est jamais écrasé.** Complété, jamais réécrit. (Déjà vrai — ne le casse pas en refactorant.)
5. **Rien n'est écrit avant le récapitulatif** montré à l'utilisateur.
6. **Le `curl | sh` est un compromis assumé** : documente-le honnêtement dans le README, propose systématiquement la variante « télécharger, lire, exécuter » à côté, et affiche l'empreinte.
7. **Aucune élévation de privilèges par défaut**, sur aucune plateforme.
8. Un billet d'invitation reste **à usage compté et révocable** — l'installeur ne doit rien contourner de `invite.ts` / `acces.ts`.

---

## 12. TESTS EXIGÉS (vitest)

La logique pure d'abord — c'est la culture du dépôt, `installer.ts` est déjà testé sans toucher au disque.

- **Rendu TUI** : snapshots pour couleur / `NO_COLOR` / non-TTY / 60 colonnes / 200 colonnes. Aucun terminal réel.
- **Idempotence** : lancer deux fois sur un `.env` existant → **fichier identique octet pour octet**, sortie « rien touché ».
- **Non-écrasement** : `.env` avec un jeton en place → jeton conservé même s'il est trivial (l'avertissement se déclenche, la valeur reste).
- **Non-interactif** : réponse manquante → code `3`, message nommant l'option manquante.
- **Chemins Windows** : espaces, accents, chemins longs, `C:\Users\Jean Dupont\Mes Documents\…`.
- **Codes de sortie** : un test par code de §9.
- **Doctor** : un test par diagnostic, avec le cas en panne **et** le cas sain.
- **Sécurité** : un test qui échoue si un secret apparaît dans une sortie ou dans `argv` — à ajouter au fichier `tests/security-invariants.test.ts` **qui existe déjà**.
- **Interruption** : `^C` pendant l'écriture → pas de `.env` tronqué (écriture atomique : fichier temporaire + `rename`).

---

## 13. CI

Étends `.github/workflows/ci.yml` :

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    node: ['20', '22']
```

Plus un job **`release`** : build → `npm publish --provenance` → image GHCR signée → attachement des empreintes SHA-256 des scripts `install.ps1` / `install.sh` à la Release.

---

## 14. DOCUMENTATION À METTRE À JOUR (même commit)

- `README.md` **et** `README.en.md` — la section installation devient : **une commande par plateforme**, en tête, avant tout le reste. Les 538 lignes actuelles ne sont pas le premier écran de quelqu'un qui découvre.
- `CHANGELOG.md` — entrée `Added` dans le style existant : ce qui change, **et pourquoi**, avec les conséquences négatives évitées. Lis les entrées existantes, imite le ton, il est bon.
- `docs/INSTALLATION.md` — la version longue : matrice de plateformes, service, conteneur, reverse proxy, codes de sortie, désinstallation.
- `.env.example` — tout nouveau réglage y est documenté.

---

## 15. STYLE DE CODE DU DÉPÔT (respecte-le)

- **TypeScript strict**, ESM, Node ≥ 24. `npm run lint` (ESLint + Prettier) et `npm run typecheck` verts.
- **Nommage du domaine en français** (`engendrerJeton`, `avertissements`, `prochainesEtapes`) ; **codes d'événements en anglais snake_case** (`guard_refused`, `pheromone_route`). Ne mélange pas.
- **Modules purs testables / modules impurs minces.** C'est la ligne de partage de tout le dépôt.
- **Commentaires qui expliquent le POURQUOI**, avec la conséquence évitée. Regarde l'en-tête de `installer.ts` : c'est le standard, ne descends pas en dessous.
- **Pas de nouvelle dépendance runtime** sans une justification écrite dans un ADR (§17).

---

## 16. ANTI-OBJECTIFS (n'y va pas)

- Pas de framework TUI (`ink`, `blessed`, `clack`, `inquirer`) — la contrainte zéro-dépendance est le point.
- Pas d'installeur graphique, pas d'Electron, pas de MSI.
- Pas d'auto-update silencieux.
- Pas de télémétrie, pas de « statistiques anonymes », pas de ping de version.
- Pas de refonte de l'orchestrateur, du dashboard ou du protocole. **Cette mission touche l'accueil, point.**
- Pas de changement du comportement par défaut de `HIVE_RUNNER`, `HIVE_GARDIENNES` ou du bind.

---

## 17. LIVRAISON

1. **Plan d'abord** — avant de coder, un `PLAN.md` : découpage en lots, ordre, ce que chaque lot rend vérifiable. Attends la validation.
2. **ADR** dans `docs/adr/` pour chaque décision structurante : nom du paquet npm, stratégie de distribution Windows, zéro-dépendance TUI, politique de service. Format : contexte / options pesées / décision / conséquences.
3. **Commits atomiques**, message en français, un lot = une PR.
4. **PR** : capture d'écran (ou asciinema) du TUI sur Windows **et** Linux, checklist des critères de §4, CI verte.
5. **Rapport final** : ce qui est fait, ce qui a été écarté et pourquoi, ce qui reste — sans enjoliver. Un « fait » faux coûte plus cher qu'un « pas fait » honnête.

---

## 18. ORDRE D'EXÉCUTION RECOMMANDÉ

| Lot | Contenu                                                               | Rend vérifiable                          |
| --- | --------------------------------------------------------------------- | ---------------------------------------- |
| 0   | Lecture du dépôt, `PLAN.md`, ADR de cadrage.                          | Le plan.                                 |
| 1   | `src/tui/rendu.ts` pur + tests de rendu.                              | Snapshots, aucune I/O.                   |
| 2   | `terminal.ts` + refonte interactive de `installer-main.ts`.           | Chemin A (Reine locale) de bout en bout. |
| 3   | Chemin B (billet) branché sur `join.ts`.                              | Un ami rejoint sans éditer un fichier.   |
| 4   | Mode non-interactif, drapeaux, codes de sortie, `--dry-run`.          | Script serveur reproductible.            |
| 5   | `hive doctor` + `--json`.                                             | 10 diagnostics testés.                   |
| 6   | ACL Windows, chemins, matrice CI multi-OS.                            | CI verte sur les 3 OS.                   |
| 7   | Paquet npm + `bin` + provenance.                                      | `npx …@latest` fonctionne.               |
| 8   | `install.ps1`, `install.sh`, empreintes, Release.                     | One-liners vérifiables.                  |
| 9   | Service (systemd user / tâche planifiée / launchd) + désinstallation. | `install` puis `uninstall` sans résidu.  |
| 10  | Dockerfile, compose, GHCR signé, sauvegarde SQLite.                   | `docker compose up` marche.              |
| 11  | Docs FR/EN, CHANGELOG, `docs/INSTALLATION.md`.                        | Revue.                                   |

---

## 19. À TRANCHER ET DOCUMENTER (ne devine pas en silence)

1. **Nom du paquet npm** — `hive` est pris. Propose, tranche, écris l'ADR.
2. **Domaine des one-liners** — `hive.<domaine>` ou GitHub Pages (`micka420-collab.github.io/hive/install.ps1`) ? Pages est gratuit et déjà déployé ; dis le compromis.
3. **Publier ou pas l'image nœud** — le nœud a besoin de l'agent de l'hôte. Tranche.
4. **Node 24 comme socle** de l'image conteneur.
5. **Faut-il un `hive uninstall`** qui retire l'état (`.env`, base) ? Défaut : **non**, trop dangereux. Justifie si tu changes d'avis.

**Règle :** toute question ouverte devient un ADR ou une ligne dans le rapport final. Aucune ne se règle par un choix tacite dans le code.
