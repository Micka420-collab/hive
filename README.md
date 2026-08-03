<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/banniere-sombre.png">
  <img src="docs/images/banniere-clair.png" width="840" alt="Hive — Faites coder plusieurs IA sur votre projet, en même temps. Une Reine découpe le projet, vos machines exécutent. Le code et les clés ne quittent jamais les vôtres.">
</picture>

# 🐝 Hive

[![CI](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml/badge.svg)](https://github.com/Micka420-collab/hive/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-F6C445?labelColor=17130C)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-F6C445?labelColor=17130C)
![Tests](https://img.shields.io/badge/tests-3141%20passing-F6C445?labelColor=17130C)
![Licence](https://img.shields.io/badge/licence-MIT-F6C445?labelColor=17130C)

🇫🇷 Français · [🇬🇧 English](README.en.md) · [🌐 Site](https://micka420-collab.github.io/hive/) · [📚 Documentation](#-documentation)

</div>

---

Une **Reine** centrale découpe un projet en tâches et les distribue aux machines
des membres — les **nœuds** — qui exécutent chacune leurs agents de codage dans
des espaces de travail isolés. Le contrôle est centralisé ; **le code et les clés
restent chez chaque membre.**

Ce que Hive cherche à résoudre n'est pas « faire écrire du code à une IA » —
c'est **faire tenir une équipe d'IA sur un projet pendant des mois** sans
qu'elle dérive, se répète, ou réapprenne au sixième mois ce qu'elle avait
compris au deuxième.

```
                          ┌──────────────────────────────┐
       WebSocket  ◄──────►│     Orchestrateur (Reine)    │◄──────►  WebSocket
                          │   Fastify · ws · SQLite      │
   ┌───────────────┐      │   ordonnanceur · journal     │      ┌───────────────┐
   │  Nœud membre  │      │   Le Cerveau (savoir)        │      │  Nœud membre  │
   │  ruche-alpha  │      └───────────────┬──────────────┘      │  ruche-beta   │
   │ agents+bac    │                      │ HTTP :7777          │ agents+bac    │
   └───────────────┘              ┌───────┴────────┐            └───────────────┘
                                  │ Mission Control│
                                  │  React · 2D/3D │
                                  └────────────────┘
```

## ⚡ Installation

Sur une machine où il n'y a encore rien :

```bash
# Linux · macOS
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 -OutFile "$env:TEMP\hive-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-install.ps1"
```

Le script vérifie Node, récupère Hive, installe les dépendances et pose **au
plus trois questions**. Il n'utilise **jamais `sudo`**, n'installe pas Node à
votre place, et n'écrit rien hors de son dossier — `--dry-run` le montre sans
rien créer.

Depuis un dépôt déjà cloné : `npm run setup`. En conteneur :
`docker compose up`. Détail complet dans **[docs/INSTALLATION.md](docs/INSTALLATION.md)**.

> **Depuis une archive ZIP de GitHub**, il manque l'étape que le clone fait pour
> vous : ouvrez un terminal dans le dossier décompressé et lancez
> `npm install --no-fund --no-audit` **une fois**. Sans ça, `npm run ruche` et
> `npm run cli` s'arrêtent — mais ils vous le disent maintenant, avec la
> commande à taper. C'est une trace d'utilisateur réel qui l'a obtenu :
> auparavant, ils mouraient sur `Cannot find package 'tsx'`.

> **Node ≥ 24 est exigé**, et c'est pour retirer une panne, pas pour être à la
> mode : sous Node 20, `better-sqlite3` n'a pas de binaire prébuilt et doit se
> **compiler**. Sur une machine Windows sans outillage C++ la compilation
> échoue — **et `npm install` réussit quand même**, parce que la dépendance est
> optionnelle. On obtient une installation « verte » et un `hive start` qui
> meurt sur `ERR_MODULE_NOT_FOUND`. Les deux comportements ont été mesurés côte
> à côte dans notre CI, sur le même commit.

## 🚀 Démarrage rapide

```bash
npm install
npm run demo
```

Ouvrez **http://localhost:7777** : l'essaim en direct, deux nœuds simulés et un
projet de démonstration de 7 tâches avec dépendances. Une tâche échoue
volontairement pour montrer le mécanisme de reprise.

La démo tourne en simulation (`HIVE_SIMULATION=1`) : aucun processus lancé,
aucune clé requise.

**Rejoindre la ruche de quelqu'un d'autre** tient en une ligne, sans cloner :

```bash
npx github:Micka420-collab/hive join hive2_votre-billet
```

## 🧠 Le Cerveau — ce qui permet de durer

Une ruche qui travaille des mois referme une boucle : sa production
d'aujourd'hui devient son contexte de demain. C'est ce qui fait dériver les
projets longs, et c'est le problème que Hive traite en premier.

**La mémoire épisodique ne suffit pas.** Garder « la tâche 47 a réussi, voici
ses logs » produit une masse qui grossit sans fin, où le bruit croît plus vite
que le signal, et qui ne dit jamais _ce qu'il faut faire_. Un agent qui reprend
un projet au troisième mois n'a pas besoin des mille épisodes : il a besoin des
**vingt règles** qu'ils ont produites.

Le Cerveau range donc le savoir par **genre**, et l'ordre est une priorité :

| Genre         | Ce que c'est                                                   | S'élague ? |
| ------------- | -------------------------------------------------------------- | ---------- |
| **invariant** | Ce qui doit rester vrai toujours. Transmis à **chaque** tâche. | jamais     |
| **leçon**     | Ce qu'une erreur a appris, **avec la règle** qui l'empêche.    | jamais     |
| **décision**  | Un choix, ses alternatives écartées, et le pourquoi.           | jamais     |
| **carte**     | Une porte d'entrée : par où commencer.                         | jamais     |
| **épisode**   | Une observation brute. Matière première.                       | **oui**    |

**Et la ruche l'alimente elle-même.** Chaque échec pris en compte devient un
épisode : la panne est réduite à sa signature, et la même panne **incrémente une
seule note** plutôt que d'en semer cinquante. Quand un motif atteint trois
récurrences, Hive **propose** la consolidation — elle ne rédige jamais la règle.
Écrire une règle demande de comprendre _pourquoi_, et une règle fausse coûte
plus cher que pas de règle du tout : elle est **suivie**, et transmise à chaque
tâche suivante. La ruche accumule la matière ; l'humain écrit la loi.

Quatre mécanismes le font fonctionner :

- **La consolidation.** Un épisode qui se répète **trois fois** devient une
  leçon portant une règle. Une fois est un accident ; deux fois est une
  coïncidence — et c'est le seuil qui fabrique le plus de règles fausses, ce
  qui coûte plus cher que pas de règle du tout, parce qu'une règle est
  _suivie_.
- **Le budget de contexte.** Les invariants passent **toujours**, avant tout le
  reste. S'ils ne tiennent pas dans le budget, Hive **refuse** au lieu de
  tronquer : un contexte amputé d'une contrainte de sûreté mais qui a l'air
  complet est pire qu'une erreur, parce que personne ne va vérifier. Ce qui
  n'entre pas est **listé**, jamais jeté en silence.
- **L'élagage par l'usage.** Seuls les épisodes partent, et sur la date de
  **dernier service** plutôt que d'âge : un épisode ancien mais relu la semaine
  dernière vaut mieux qu'un épisode d'hier que personne n'a ouvert.
- **Le savoir est une donnée, jamais une instruction.** Les notes sont écrites
  par des agents. Injectées telles quelles, elles seraient une injection de
  prompt à retardement — d'autant plus efficace qu'elle vient d'une source que
  la ruche croit sienne. Tout passe donc par un bloc de données délimité.

**Le cerveau vit en fichiers markdown** — en-tête YAML, liens `[[wikilink]]`,
directement ouvrables dans Obsidian. Ce n'est pas cosmétique : un savoir en
fichiers **se versionne** (donc se relit en diff, se révise en revue, et se
**revient en arrière** — `git revert` est le seul mécanisme d'oubli qui ait
jamais marché), **se lit sans la ruche**, et **s'édite à la main**. Tout index
posé par-dessus est un cache reconstructible ; la source de vérité est le
dossier.

> La preuve que la méthode marche est dans ce dépôt : **[docs/ERREURS.md](docs/ERREURS.md)**
> est exactement ça, tenu à la main depuis des semaines — organisé par leçon et
> non par chronologie, chaque entrée portant sa règle. Il a attrapé des
> régressions réelles, dont une par une règle écrite au lot précédent. Le
> Cerveau **mécanise une pratique éprouvée**, il n'invente pas une théorie.

## 🎚️ Niveaux d'autonomie

L'autonomie n'est pas un interrupteur mais une échelle, et elle se change en une
commande :

| Niveau     | Ce que la ruche fait                                       |
| ---------- | ---------------------------------------------------------- |
| `off`      | Rien d'automatique.                                        |
| `propose`  | Elle réfléchit et **propose** un plan. N'agit pas.         |
| `gouverne` | Elle agit, mais **toute intégration passe par un humain**. |
| `plein`    | Elle livre et fusionne — dépôt explicitement inscrit.      |

Ça se change en une commande, et la commande **dit ce qu'elle implique avant
de le faire** :

```bash
npm run cli -- mode                      # les quatre modes, et où en est chaque projet
npm run cli -- mode gouverne             # annonce ce que ça élargit, n'écrit rien
npm run cli -- mode gouverne <projet> --oui
```

**Seule la montée se confirme.** Redescendre retire des droits à la ruche —
c'est toujours sûr, et demander « êtes-vous sûr ? » pour reprendre la main est
le meilleur moyen d'apprendre à taper « oui » sans lire, donc de rendre la
confirmation inutile le jour où elle compte.

**Deux interrupteurs en série**, et c'est délibéré : le _niveau_ est choisi par
l'utilisateur, `HIVE_RUNNER=off|on` par l'hôte qui paie le temps-machine
(défaut : `off`). Personne ne déclenche seul de la dépense sur la machine d'un
autre. Le gros bouton rouge arrête **avant** l'effet, jamais après.

## 🧩 Agents et modèles

Toute IA de codage se branche via l'interface `AgentAdapter` :

| Adaptateur     | Ce qu'il lance                                           |
| -------------- | -------------------------------------------------------- |
| `claude-code`  | `claude -p "<prompt>"` dans l'espace isolé.              |
| `codex`        | `codex exec "<prompt>"`                                  |
| `grok`         | `grok -p "<prompt>"` — l’agent CLI de xAI, Apache 2.0.   |
| `hermes-agent` | `hermes agent run --prompt "<prompt>"`                   |
| `custom`       | Le vôtre, via `HIVE_AGENT_CMD`.                          |
| `shell`        | **Simulé** — aucun processus lancé, les diffs sont faux. |

**Le nœud détecte ce qui est installé sur votre machine et s'en sert** : rien à
régler. Il n'emploie `shell` que s'il ne trouve aucun agent — et il le dit
alors au démarrage, parce qu'un simulateur silencieux est un mensonge à
retardement. `HIVE_AGENT` force le choix si vous en voulez un autre.

**Votre abonnement suffit** : le nœud lance le binaire `claude`, qui
s'authentifie tout seul. Aucune clé d'API, d'Anthropic ou d'ailleurs, n'est
requise pour faire travailler la ruche — voir
**[docs/WINDOWS-CLAUDE.md](docs/WINDOWS-CLAUDE.md)**.

Le **polyéthisme** confie à chaque ouvrière le travail que son expérience
permet, et le **Conseil des Éclaireuses** fait vérifier une direction par
plusieurs agents avant de s'y engager — une danse que personne ne reprend
s'éteint.

## 🔒 Sécurité

- **Zéro `shell: true`** — toute exécution passe par `spawn(bin, argv, { shell: false })`.
- **Jeton comparé à temps constant** ; jeton trivial refusé hors simulation.
- **CORS restreint**, jamais `*` ; origine des WebSockets vérifiée.
- **Toute entrée validée** — JSON Schema au REST, champ par champ en WS, corps bornés.
- **Bac à sable par tâche** — cwd dédié, environnement épuré, délai dur, sortie plafonnée.
- **Jamais de fusion sans revue humaine.**

> **Limite assumée (bac à sable v0)** : un processus réel peut lire le disque et
> accéder au réseau. D'ici une vraie isolation, ne faites tourner Hive qu'entre
> **membres de confiance**.

Le détail — et les autres limites assumées, écrites plutôt que tues — est dans
**[docs/FONCTIONNALITES.md](docs/FONCTIONNALITES.md)**.

## 🛠️ Commandes

| Commande                    | Effet                                                                        |
| --------------------------- | ---------------------------------------------------------------------------- |
| `npm run ruche`             | **Tout en une commande** — Reine + ouvrière + écran                          |
| `npm run demo`              | Démo complète (orchestrateur + 2 nœuds + projet)                             |
| `npm run dev`               | Orchestrateur seul                                                           |
| `npm run node`              | Un nœud membre                                                               |
| `npm run cli -- doctor`     | **Le docteur** — 13 causes de panne, et la commande qui répare               |
| `npm run cli -- sauvegarde` | Sauvegarde SQLite par `VACUUM INTO`                                          |
| `npm run cli -- service`    | Installer la ruche en service (systemd · launchd · tâche planifiée)          |
| `npm test`                  | La suite complète (vitest) — le compte vit dans le badge, en un seul endroit |
| `npm run fusionner`         | Porte la branche sur `main` en **avance rapide** — sans commit de fusion     |
| `npm run lint`              | ESLint + Prettier — zéro erreur exigé                                        |
| `npm run loupe`             | **La loupe** — le code neuf est-il défendu par ses tests ?                   |

### La loupe

`typecheck`, `lint`, `test` et `build` répondent tous à « est-ce que ça
marche ? ». Aucun ne répond à celle qui compte au moment de fusionner :

> **le code que je viens d'écrire est-il défendu par mes propres tests ?**

La loupe prend les lignes que la branche **ajoute**, en tire des mutations sûres
(`&&`→`||`, `===`→`!==`…) et vérifie que la suite **rougit** sur chacune. Un
mutant qui survit désigne du code neuf que rien ne défend — et il faut alors
choisir : écrire le test manquant, ou constater par écrit que le mutant est
équivalent. Jamais l'ignorer.

Elle vient **après** la barrière, elle **échantillonne** (et annonce ce qu'elle
a laissé de côté), et elle ne mute que des opérateurs. C'est dit ici parce
qu'un outil de vérification qui exagère sa portée ment dans le sens rassurant,
le pire des deux.

## 📚 Documentation

| Fichier                                                      | Ce qu'on y trouve                                        |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| **[docs/INSTALLATION.md](docs/INSTALLATION.md)**             | Installer, désinstaller, service, conteneur, sauvegardes |
| **[docs/WINDOWS-CLAUDE.md](docs/WINDOWS-CLAUDE.md)**         | Tourner seul sous Windows avec son abonnement Claude     |
| **[docs/PROTECTION-BRANCHE.md](docs/PROTECTION-BRANCHE.md)** | Protéger `main` : les réglages exacts, et pourquoi       |
| **[docs/FONCTIONNALITES.md](docs/FONCTIONNALITES.md)**       | Chaque partie en détail, avec ses arbitrages             |
| **[docs/ERREURS.md](docs/ERREURS.md)**                       | Le journal des erreurs — par leçon, avec les règles      |
| **[docs/ETAPES.md](docs/ETAPES.md)**                         | L'état réel du projet face à ses propres promesses       |
| **[docs/MODELE-ECONOMIQUE.md](docs/MODELE-ECONOMIQUE.md)**   | Quotas, abonnements, ce qui est facturé                  |
| **[CHANGELOG.md](CHANGELOG.md)**                             | Ce qui a changé, version par version                     |

**[docs/ETAPES.md](docs/ETAPES.md)** mérite un mot : il tient l'état honnête du
projet, y compris ce qui **n'est pas** tenu. Une ligne n'y passe au vert que si
quelque chose la vérifie — un test, une CI, une mesure. « Le code existe » n'y
suffit pas.

## 🤝 Contribuer

Les règles du dépôt tiennent en peu de lignes, et elles ne sont pas
négociables : **tout ce qui s'accumule ship sa borne d'élagage dans le même
commit** ; **aucune donnée non fiable n'entre dans un prompt hors d'un bloc de
données** ; **la plateforme est un paramètre, jamais `process.platform` lu en
ligne** ; et **une suspicion se prouve par mutation avant qu'on écrive le
test** — un test qui ne peut pas rougir n'est pas de la couverture, c'est du
décor.

**[Proposer un projet à la ruche](https://github.com/Micka420-collab/hive/issues/new?template=proposer-un-projet.yml)** ·
[voir les projets proposés](https://github.com/Micka420-collab/hive/issues?q=is%3Aissue+label%3A%22projet+propos%C3%A9%22)

---

<div align="center"><sub>MIT · Fait avec 🍯 — chaque ouvrière compte.</sub></div>
