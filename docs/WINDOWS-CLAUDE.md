# Faire tourner la ruche seul, sous Windows, avec son abonnement Claude

Ce document répond à trois questions précises, et à rien d'autre :

1. **Faut-il un ami ?** Non.
2. **Faut-il une API extérieure — OpenRouter ou autre ?** Non.
3. **Un Claude Code installé sous Windows est-il vraiment employé ?** Oui,
   depuis les correctifs décrits plus bas. Avant, non — et en silence.

---

## 1. Une ruche à une seule personne

Une ruche, c'est **deux processus**, et rien n'oblige à les mettre sur deux
machines :

| Processus           | Commande       | Ce qu'il fait                                     |
| ------------------- | -------------- | ------------------------------------------------- |
| L'**orchestrateur** | `npm run dev`  | garde les projets, les tâches, le tableau de bord |
| Le **nœud**         | `npm run node` | exécute réellement le travail, avec votre agent   |

Sur votre seule machine, vous lancez les deux — deux terminaux, c'est tout.
Le nœud rejoint `ws://localhost:7777/ws` par défaut, c'est-à-dire votre propre
orchestrateur.

**Inviter quelqu'un est une possibilité, jamais un prérequis.** Un ami n'ajoute
que des bras : son nœud prend des tâches en plus, avec son abonnement à lui.
Une ruche à un seul nœud fonctionne exactement de la même façon, en moins
parallèle.

---

## 2. Aucune API extérieure n'est nécessaire

**Le nœud n'appelle aucune API.** Il lance le binaire `claude` de votre machine,
en ligne de commande. C'est **Claude Code lui-même** qui s'authentifie, avec la
session de votre abonnement — la même que lorsque vous tapez `claude` dans un
terminal. La ruche ne voit jamais vos identifiants ; elle laisse simplement
passer les dossiers de configuration où Claude Code range sa session.

Ce que ça implique, et qui est le point de votre question :

- **`ANTHROPIC_API_KEY` n'est pas requise.** Si elle existe, elle est
  transmise ; si elle n'existe pas, Claude Code utilise votre abonnement. Rien
  ne la réclame.
- **OpenRouter n'est jamais nécessaire.** `OPENROUTER_API_KEY` n'est lue qu'à
  un seul endroit du dépôt : la « Reine », une fonctionnalité **facultative**
  de découpage automatique de gros chantiers. Sans clé, elle ne s'active pas,
  et le reste fonctionne.
- Le « concierge » qui rédige des plans en langage naturel est lui aussi
  facultatif : sans `ANTHROPIC_API_KEY`, la ruche bascule sur un planificateur
  heuristique, et le dit.

**Le travail de code, lui, ne dépend d'aucun de ces réglages.**

---

## 3. Installer, et VÉRIFIER que Claude est bien employé

```powershell
npm i -g @anthropic-ai/claude-code   # si ce n'est pas déjà fait
claude                                # une fois, pour ouvrir la session
```

Puis, dans la ruche :

```powershell
npm run cli -- doctor
```

La ligne qui répond à votre question :

```
✔ agent détecté : claude-code
```

Si vous lisez plutôt :

```
⚠ aucun agent de codage détecté — ce nœud ne pourra rien produire
```

alors le nœud tournerait en **simulé** : il aurait l'air de travailler et
produirait de **faux diffs**. Voir la section 5.

Le nœud le dit désormais lui-même au démarrage, sans qu'on ait à penser à
lancer le docteur :

```
   Agents détectés : claude-code, shell
   Agent utilisé   : Claude Code
```

---

## 4. `HIVE_AGENT` : à laisser tranquille

Le nœud **détecte** votre agent. Vous n'avez rien à régler.

`HIVE_AGENT` sert à forcer un choix, et notamment à forcer `shell`, le
simulateur — utile pour éprouver la ruche sans rien exécuter pour de vrai.
Si vous l'avez posé à `shell`, le nœud vous le rappelle au démarrage :

```
   ℹ Agent « shell simulé » forcé par HIVE_AGENT alors qu’un agent réel est disponible.
```

**Vérifiez votre `.env` s'il contient `HIVE_AGENT=shell`** : jusqu'aux
correctifs décrits ci-dessous, `.env.example` posait cette ligne par défaut, et
une copie machinale suffisait à n'employer jamais l'agent qu'on venait
d'installer.

---

## 5. Ce qui était cassé, et qui ne l'est plus

Deux défauts distincts empêchaient exactement ce que vous demandiez. Ils sont
consignés ici parce qu'ils expliquent ce que vous avez pu observer.

### 5.1 — Sous Windows, un Claude Code installé par npm restait introuvable

npm n'installe sous Windows qu'un **shim** `claude.cmd`. Or la ruche lance ses
agents par `spawn(bin, argv, { shell: false })` — sans interpréteur de
commandes, par choix de sécurité — et Node **refuse d'exécuter un `.cmd` sans
interpréteur** (documenté, et durci depuis la CVE-2024-27980). La détection
échouait donc **sur toute machine Windows**, quelle qu'elle soit.

Le nœud retombait alors sur l'adaptateur `shell`, qui est simulé.

**Correctif** : au lieu du shim, on vise le script réel du paquet —
`%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\cli.js` — et on lance
`node` dessus. C'est **plus strict** que d'autoriser un shell, pas moins : on
sait exactement quel fichier on exécute, au lieu de déléguer la résolution à
`cmd.exe`.

> ⚠ **Non vérifié sur une vraie machine Windows.** La logique l'est —
> plateforme, environnement et existence du fichier sont des paramètres, donc
> éprouvés depuis Linux et par la CI Windows. Le `spawn` final, lui, ne peut
> être confirmé que par un essai réel. C'est le seul point de ce document qui
> attend votre confirmation.

### 5.2 — Le nœud lancé chez soi n'employait pas l'agent détecté

Plus grave, et indépendant de Windows. `npm run node` contenait :

```ts
const agentType = (process.env.HIVE_AGENT ?? 'shell') as AgentType;
```

L'installeur n'écrit pas `HIVE_AGENT` dans `.env`. **Rien ne venait donc jamais
le mettre à autre chose** : un Claude Code parfaitement installé, parfaitement
détectable, n'était jamais employé. Le nœud tournait en simulé, en silence.

Le plus révélateur : `join.ts` — le chemin de l'**ami** qu'on invite — détecte
automatiquement depuis toujours. **L'invité avait un vrai agent, l'hôte un
simulacre.** L'inverse exact de ce qu'on attend, et précisément à rebours de
votre demande : faire tourner la ruche **seul**.

**Correctif** : `npm run node` détecte comme le fait le chemin de l'ami, et
annonce ce qu'il a retenu. `HIVE_AGENT` garde le dernier mot.

### 5.3 — Ce que corriger le 5.2 a obligé à durcir

Faire sonder `main.ts` n'était pas gratuit. `join.ts` se protégeait d'un danger
**par l'ordre des lignes** : il sondait avant d'avoir lu le secret.

> « on ne met PAS le token dans l'environnement avant, sinon un binaire homonyme
> malveillant (`claude.cmd` déposé en tête de PATH) l'hériterait »

Or `main.ts` charge `.env` dès sa première ligne. Y sonder tel quel aurait
offert le jeton de la ruche — **et votre clé d'abonnement** — au premier binaire
hostile posé en tête de `PATH`. C'est exactement ce qu'un tel binaire cherche.

Une protection qui tient à l'ordre des lignes ne tient pas. Elle vit désormais
**dans la sonde** : une sonde ne reçoit plus aucun secret, et un test garde la
liste contre l'oubli le jour où l'on en ajoute un.

---

## 6. Si le nœud dit « aucun agent détecté » alors que Claude est installé

Dans l'ordre, du plus fréquent au plus rare :

1. **`claude --version` répond-il, dans le terminal où vous lancez la ruche ?**
   C'est exactement ce que la sonde fait. S'il ne répond pas là, le problème est
   dans le `PATH` de ce terminal — rouvrez-le après l'installation globale.
2. **`.env` contient-il `HIVE_AGENT=shell` ?** Retirez la ligne.
3. **`npm config get prefix`** : si vous avez déplacé le préfixe npm, la ruche
   le lit via `npm_config_prefix`. Lancer la ruche par `npm run node` suffit à
   le poser.
4. En dernier recours, `HIVE_AGENT_CMD` permet de nommer une commande libre.

---

## Ce que ce document ne prétend pas

- Les correctifs sont vérifiés par la CI sur Windows, macOS et Linux, et par un
  essai de bout en bout sous Linux (agent détecté et employé, agent absent,
  agent forcé). **L'essai final sous Windows reste à faire par vous.**
- `install.sh` ne construit pas le tableau de bord : une ruche installée tourne,
  mais l'écran demande `npm run build:dashboard`.
