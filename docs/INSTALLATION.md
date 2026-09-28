# Installer Hive

> **Prérequis unique : Node.js ≥ 24.18.** Rien d'autre. Pas de compilateur, pas
> de `sudo`, pas de service système. Sous Linux, une glibc ≥ 2.34 (Ubuntu 22.04+,
> Debian 12+) — voir [plus bas](#linux--glibc--234).

---

## Application de bureau — sans Node, sans terminal

Un installeur par système, attaché à chaque [version publiée](https://github.com/Micka420-collab/hive/releases) :
`Hive-Setup-X.Y.Z.exe` (Windows, pour vous seul, sans droits administrateur),
`Hive-X.Y.Z-arm64.dmg` ou `-x64.dmg` (macOS), `hive_X.Y.Z_amd64.deb` ou
`Hive-X.Y.Z-x86_64.AppImage` (Linux). L'app embarque son propre Node : rien
de ce qui suit n'est nécessaire pour elle.

- **Données** : `%APPDATA%\Hive\ruche` (Windows),
  `~/Library/Application Support/Hive/ruche` (macOS), `~/.config/Hive/ruche`
  (Linux) — `.env`, `data/hive.db`, `.hive-work/` ; journaux dans `logs/`.
- **Paquets non signés** : SmartScreen → _Informations complémentaires_ →
  _Exécuter quand même_ ; Gatekeeper → _Réglages Système → Confidentialité et
  sécurité → Ouvrir quand même_.
- **Ubuntu 24.04 et suivants** : préférez le `.deb` (bac à sable de Chromium
  conservé) ; l'AppImage y tourne en `--no-sandbox`.
- **Une ruche `~/hive` existe déjà** : au premier lancement, l'app propose de
  l'ouvrir (si sa Reine tourne), d'en importer une copie, ou de commencer une
  ruche neuve — la source n'est jamais modifiée.
- **Désinstaller** : les données restent par défaut ; l'installeur Windows
  propose une case décochée pour les effacer.

Tout le détail — premier lancement, barre système, mises à jour, signature :
**[APPLICATION.md](APPLICATION.md)**.

---

## En une commande

**Linux et macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh
```

Variante prudente (empreinte avant d’agir — ADR 0002) : télécharger le script,
comparer le SHA-256 au manifeste publié sur
[Pages](https://micka420-collab.github.io/hive/install.sha256) (`install.sh` et
`install.ps1`), le lire, puis l’exécuter. Une **Release GitHub signée** n’existe
pas encore (🔒 comptes humains) : Pages garde du pipe aveugle, pas d’un dépôt
compromis. `install.sh` affiche aussi son empreinte quand il tourne comme
fichier (hash du contenu via stdin — stable sous Windows/Git Bash).

```sh
curl -fsSLO https://micka420-collab.github.io/hive/install.sh
sha256sum install.sh
less install.sh
sh install.sh
```

> Les URL `raw.githubusercontent.com/…/main/…` suivent la branche vivante. Les
> scripts servis par Pages sont les mêmes fichiers, copiés au déploiement
> (`pages.yml`).

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 -OutFile "$env:TEMP\hive-install.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-install.ps1"
```

Variante prudente Windows : télécharger
`https://micka420-collab.github.io/hive/install.ps1`, comparer avec
`Get-FileHash … -Algorithm SHA256` au même
[manifeste Pages](https://micka420-collab.github.io/hive/install.sha256), lire,
puis lancer via `-File` (jamais `| iex`).

Le script vérifie Node, récupère Hive dans `~/hive`, installe les dépendances,
puis passe la main à l'installeur qui vous pose **au plus trois questions**.

### Une fois l'installeur terminé

L'installeur **entre** dans le dossier de la ruche, puis en ressort : votre
shell est resté là où il était. Il faut donc y aller :

```sh
cd ~/hive
npm run dev
```

**Sous PowerShell, écrivez `npm.cmd` et non `npm`.** Une installation réelle
sur Windows 11 s'est arrêtée exactement là :

```
PS C:\WINDOWS\system32> npm run dev
npm : Impossible de charger le fichier C:\Program Files\nodejs\npm.ps1,
car l'exécution de scripts est désactivée sur ce système.
```

`npm` résout vers `npm.ps1`, que la stratégie d'exécution de Windows refuse par
défaut. `npm.cmd` est le shim batch : la stratégie ne le gouverne pas, et il
marche **sans rien changer à votre machine**.

```powershell
cd $HOME\hive
npm.cmd run dev
```

Hive ne modifiera jamais votre stratégie d'exécution à votre place — c'est un
réglage de sécurité de votre système, pas le nôtre. L'écran de fin de
l'installeur donne désormais ces deux lignes telles quelles.

---

## Lisez-le avant de l'exécuter

Tuyauter un script inconnu dans `sh` demande une confiance qu'un script doit
mériter. Ceux-ci sont écrits pour être lus — commentés, courts, sans astuce.

```sh
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | less
```

Ce qu'ils **ne font pas**, et c'est vérifié par
[`tests/installeurs.test.ts`](../tests/installeurs.test.ts) :

- **aucune élévation de privilèges.** Pas un `sudo`, pas un `RunAs`. Rien hors
  du dossier d'installation.
- **ils n'installent pas Node à votre place.** Un script qui touche au
  gestionnaire de paquets d'une machine qu'il ne connaît pas, en aveugle, ne
  mérite pas d'être exécuté. S'il manque, on affiche la commande exacte pour
  **votre** système et on s'arrête.
- **ils n'ouvrent aucun port et ne démarrent aucun service.**
- **ils ne réécrivent pas votre `.env`.** Une valeur déjà présente n'est jamais
  écrasée — écraser un jeton en service couperait tous les nœuds connectés.

---

## Voir sans rien écrire

```sh
sh install.sh --dry-run
```

```powershell
.\install.ps1 -DryRun
```

Montre chaque étape, ne crée **rien** — pas même le dossier de destination.

---

## Options

|                         |                                  |
| ----------------------- | -------------------------------- |
| `--dir=CHEMIN` / `-Dir` | où installer (défaut : `~/hive`) |
| `--ref=REF` / `-Ref`    | branche ou tag (défaut : `main`) |
| `--dry-run` / `-DryRun` | montre, n'écrit rien             |
| `-Depot` (Windows)      | dépôt d'où tirer Hive            |

Tout autre drapeau est **transmis à l'installeur** de Hive — notamment
`--non-interactive`, pour un serveur sans écran.

### Par l'environnement

Les trois variables ci-dessous sont honorées **par les deux installeurs**, et un
banc l'exige : un réglage que l'un accepterait et que l'autre ignorerait en
silence serait un mensonge par omission.

| Variable     | Ce qu'elle fait       | Équivalent en drapeau |
| ------------ | --------------------- | --------------------- |
| `HIVE_DIR`   | où installer          | `--dir` / `-Dir`      |
| `HIVE_REF`   | branche ou tag        | `--ref` / `-Ref`      |
| `HIVE_DEPOT` | dépôt d'où tirer Hive | `-Depot` (Windows)    |

`HIVE_DEPOT` sert à installer **depuis son propre fork** plutôt que depuis le
dépôt public :

```sh
HIVE_DEPOT=https://github.com/moi/hive.git sh install.sh
```

```powershell
$env:HIVE_DEPOT = 'https://github.com/moi/hive.git'; .\install.ps1
```

---

## Installer sur un serveur, sans écran

```sh
curl -fsSL .../install.sh | sh -s -- --non-interactive
```

`--non-interactive` est implicite dès que `CI` est présente dans
l'environnement : aucune question n'est posée, et une réponse manquante devient
une **erreur explicite** plutôt qu'une invite qui attend dans le vide.

### Sur une machine virtuelle Proxmox

Deux scripts, deux endroits — ils ne se mélangent pas, et c'est volontaire :
l'un connaît l'hyperviseur, l'autre connaît la ruche.

**1. Sur l'hôte Proxmox** (console web → Shell) :

```sh
sh scripts/vm-proxmox.sh --essai   # montre ce qu'il ferait, ne crée rien
sh scripts/vm-proxmox.sh
```

Il cherche un numéro de VM LIBRE — au-dessus de 9000, en regardant les VM **et**
les conteneurs LXC, qui partagent le même espace de numéros — et ne touche à
aucune machine existante. Il s'arrête plutôt que d'écraser quoi que ce soit.

Réglages : `VM_NOM`, `VM_CPU`, `VM_RAM`, `VM_DISQUE`, `VM_ISO`, `VM_PONT`,
`VM_STOCKAGE`. L'ISO par défaut est `ubuntu-26.04-live-server-amd64.iso` — pas
le bureau (3,5 Go d'interface qu'un serveur ne montre à personne), et Ubuntu
plutôt que Debian pour une raison mesurable : la CI de Hive est verte sur
`ubuntu-latest`, et faire tourner la production sur la famille où la suite est
éprouvée retire une classe entière de surprises.

**2. Dans la machine virtuelle**, une fois Ubuntu installé :

```sh
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/scripts/poser-la-ruche.sh | sudo sh
```

Il pose Node 24, compile Hive, engendre les secrets **sur place** (`openssl rand`,
`.env` en 0600, jamais en argument de commande — un argument se lit dans `ps`),
installe un service `systemd` qui redémarre avec la machine, et n'ouvre le port
qu'au réseau local.

Il refait aussi la sonde du `Dockerfile` : `better-sqlite3` est une dépendance
**optionnelle**, et quand sa compilation native échoue npm l'écarte en silence
en rendant `0`. La ruche démarrerait alors, répondrait, et ne saurait rien
ranger. Trois essais, puis une base réellement ouverte — sinon le script
s'arrête au lieu de vous laisser une ruche mort-née.

Le jeton n'est **pas affiché** à la fin : cette sortie finit dans un journal,
un historique de terminal ou une capture d'écran. Le script vous dit où le lire.

Pour recruter quelqu'un, ne partagez jamais ce jeton — la ruche a une porte
faite pour ça, révocable et à durée limitée :

```sh
cd /opt/hive && sudo -u hive npm run cli -- invite --uses 1 --hours 24
```

### Codes de sortie

Les mêmes partout — scripts d'installation, `hive`, et
[`src/codes-sortie.ts`](../src/codes-sortie.ts). Un script appelant n'a qu'une
table à connaître.

| code  | sens                                     |
| ----- | ---------------------------------------- |
| `0`   | succès                                   |
| `1`   | erreur                                   |
| `2`   | prérequis manquant (Node, git)           |
| `3`   | réponse manquante en mode non interactif |
| `4`   | port occupé                              |
| `5`   | refus de sécurité                        |
| `130` | interrompu (Ctrl-C)                      |

---

## Pourquoi Node 24.18 et pas moins

Ce n'est pas une préférence pour le neuf : **ça retire une panne**.

`better-sqlite3` est un module natif. Depuis sa version 13, son binaire (N-API)
est **livré dans le paquet npm** — rien à télécharger, rien à compiler, sur
Linux, macOS et Windows, en x64 comme en arm64. Mais le paquet garde un
`binding.gyp`, dont npm déduit un `node-gyp rebuild` : Hive le refuse
(`allowScripts` dans `package.json`), et **seul npm ≥ 11.16 lit ce refus**.

Node 24.0 à 24.17 embarquent npm 11.3 à 11.13 (source : `dist/index.json` de
nodejs.org). Là, npm tente la compilation ; sur une machine sans python3 — un
Windows neuf, une image `slim` — elle échoue… **et `npm install` réussit quand
même**, parce que la dépendance est déclarée optionnelle. On se retrouve avec
une installation « verte » et un `hive start` qui meurt sur
`Cannot find module 'better-sqlite3'`. **Node 24.18.0 est le premier Node 24
livré avec npm 11.16.**

C'est pour ça que les installeurs vérifient la version — mineur compris —
**avant** de lancer quoi que ce soit, et que la CI installe et démarre la ruche
sous Node 24.18.0 exactement (job `plancher`).

### Linux : glibc ≥ 2.34

Le binaire Linux de `better-sqlite3` 13 exige **glibc 2.34** et
**GLIBCXX 3.4.29** : Ubuntu 22.04+, Debian 12+, Fedora 35+, RHEL 9+. Sur
Ubuntu 20.04 ou Debian 11 (glibc 2.31), il ne se charge pas — `GLIBC_2.34 not
found` — et aucune compilation de secours ne prend le relais. `hive doctor` le
détecte et le dit. Deux issues : mettre le système à jour, ou faire tourner la
ruche dans son [image Docker](#dans-un-conteneur) (Debian 12, glibc 2.36).

Les autres causes d'un module introuvable, et leur geste :

| Ce que dit l'erreur                                        | Cause                                          | Geste                                               |
| ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `Cannot find module 'better-sqlite3'`                      | `--omit=optional`, ou npm < 11.16 sans python3 | Node ≥ 24.18, puis `npm install --include=optional` |
| `version 'GLIBC_2.34' not found`                           | glibc trop ancienne                            | système à jour, ou l'image Docker                   |
| `Cannot find module '…/build/Release/better_sqlite3.node'` | plateforme sans binaire (ni x64 ni arm64)      | l'image Docker                                      |

`npm rebuild better-sqlite3` ne répare **aucune** de ces trois causes : le
script est refusé, il ne fait rien.

---

## « Aucun agent de codage détecté » — alors que ma clé est là

C'est le cas le plus fréquent, et le message d'erreur ne le disait pas.

Hive cherche **deux choses** pour chaque agent, et elles sont indépendantes :

| ce qui est cherché         | où                                        | exemple                           |
| -------------------------- | ----------------------------------------- | --------------------------------- |
| la **ligne de commande**   | sur le `PATH`, ou aux emplacements natifs | `claude`, `codex`, `cursor-agent` |
| la **clé** (ou la session) | l'environnement, `.env` compris           | `ANTHROPIC_API_KEY`, `~/.claude`  |

Un poste peut donc porter la clé sans la ligne de commande — et c'est le seul
cas que Hive répare d'un `npm install`. Depuis ce lot, il vous le dit :

```
✘ Aucun agent de codage détecté. …
La clé de Claude Code est déjà là — il ne manque que sa ligne de commande.
  Une seule commande suffit :  npm install -g @anthropic-ai/claude-code
```

Et il se **tait** s'il n'a rien de vrai à proposer : poser une ligne de commande
sans identifiants donne un agent qui refuse de travailler, et vous auriez suivi
le conseil pour rien.

Hive n'installe que ce qu'il sait nommer — `claude-code` et `codex`. Un agent
inconnu ne se voit jamais proposer un `npm install` deviné : exécuter un nom
venu d'ailleurs est exactement ce qu'un installeur ne doit pas faire.

## Codex : ce qu'il lui faut pour écrire

Codex a son propre bac à sable, et Hive choisit son mode selon celui du nœud :

| le nœud                     | une production                 | une relecture                  |
| --------------------------- | ------------------------------ | ------------------------------ |
| **avec** un bac (podman, …) | `--sandbox danger-full-access` | `--sandbox danger-full-access` |
| **sans** bac                | `--sandbox workspace-write`    | `--sandbox read-only`          |

Dans le bac du nœud, c'est lui la frontière : celui de Codex ne pourrait pas
s'y ouvrir. **Sans bac, Codex a besoin du sien**, et donc :

- **sous Linux, d'un bubblewrap qui démarre.** Là où le noyau restreint les
  espaces de noms non privilégiés (`kernel.apparmor_restrict_unprivileged_userns=1`,
  le défaut d'Ubuntu depuis 24.04), seul un `bwrap` couvert par un profil
  AppArmor peut les créer : c'est le cas du `/usr/bin/bwrap` des versions qui
  livrent le profil `bwrap-userns-restrict` (constaté sous Ubuntu 26.04), pas
  d'Ubuntu 24.04 d'origine. Sans lui, Codex sortirait « en succès » sans avoir
  rien écrit ; le nœud le vérifie avant la première tâche, sans appeler le
  modèle, et la tâche échoue en le disant. Remède : donner un bac au nœud
  (podman ou docker), ou un profil AppArmor pour `bwrap` ;
- **sous Windows, d'un bac Windows déclaré** : sans `[windows] sandbox =
"unelevated"` (ou `"elevated"`) dans le `config.toml` de Codex, Codex rabat
  l'écriture en lecture seule. La tâche échoue alors avant l'agent, en le
  disant, plutôt que de payer le modèle pour rien.

Le dépôt de la tâche est **toujours** lancé comme non fiable (`untrusted`) :
son `.codex/config.toml`, ses crochets et ses règles ne sont jamais chargés,
et Codex n'inscrit plus le répertoire de chaque tâche dans votre
`config.toml`. Codex ne lit l'`AGENTS.md` que d'un dépôt de confiance : Hive
le relit donc lui-même (celui de la racine, ou son `AGENTS.override.md`, sans
suivre de lien, borné) et le transmet à Codex comme **simple donnée**, en
tête du prompt de la tâche — au même rang que Codex donne à l'`AGENTS.md` d'un
dépôt de confiance, jamais au-dessus de la consigne — comme il le fait pour le
`CLAUDE.md` de Claude Code ; le journal de la tâche le dit. Ceux des
sous-dossiers, Codex les lit lui-même quand il y travaille. Votre propre
configuration n'est pas touchée : vos `developer_instructions` et votre
`AGENTS.md` personnel (`~/.codex/AGENTS.md`) s'appliquent toujours. Un
`AGENTS.md` (ou `CLAUDE.md`) qui est un lien symbolique, même vers un fichier du
dépôt, n'est pas repris : Hive ne suit aucun lien, et le journal le dit.

## Si quelque chose ne va pas

```sh
cd ~/hive && npm run cli -- doctor
```

Douze diagnostics, et **chacun dit quoi taper** pour réparer — pas seulement ce
qui ne va pas. Un thermomètre qui ne propose rien ne sert qu'à nommer la peine.

```
🩺 hive doctor

  ✔ node_version  Node 24.21.0 (≥ 24.18.0 exigé)
  ✔ moteur        paquets de la ruche complète tous chargeables
  ✘ env_present   aucun fichier .env
       → cp .env.example .env
  ...
```

`--json` rend le tout en machine, pour une supervision.

### « Une autre Reine tient déjà cette base »

Une seule Reine par base : deux s'assigneraient les mêmes tâches, et la seconde
requalifierait au démarrage les travaux en vol de la première. La Reine tient
donc un verrou sur `data/hive.db.reine.lock` tant qu'elle tourne.

Ce verrou appartient au **système** : il tombe de lui-même quand la Reine
s'arrête, de quelque façon qu'elle s'arrête — arrêt propre, processus tué,
coupure de courant, conteneur détruit puis recréé. Il n'y a rien à nettoyer
après un arrêt brutal, et le fichier reste en place d'un démarrage à l'autre :
c'est normal.

Si ce message s'affiche, une Reine tourne **vraiment** sur cette base, et il dit
laquelle (pid et machine). Arrêtez-la, ou donnez à la nouvelle une autre base
(`HIVE_DB`). Avec Docker, c'est en général une Reine lancée sur l'hôte alors que
le conteneur tourne sur le même dossier `data/`, ou deux services sur le même
volume. Supprimer le fichier n'arrêterait pas l'autre Reine : elle continuerait
d'écrire, et la vôtre démarrerait à côté.

Seul « Le verrou de Reine est illisible » (le fichier a été remplacé par autre
chose) demande de le supprimer : il est recréé au démarrage suivant.

---

## Rejoindre la ruche d'un ami

Si on vous a envoyé un billet, vous n'avez pas besoin de tout ça :

```sh
npx github:Micka420-collab/hive join hive2_votre-billet
```

Pas de clone, pas de dashboard, pas de base de données — **4 Mo et 9 paquets**.
Le billet contient l'adresse de la ruche et de quoi obtenir une clé propre à
votre machine.

---

## Dans un conteneur

```sh
cp .env.example .env    # posez-y HIVE_TOKEN et HIVE_JWT_SECRET
docker compose up -d --wait
```

Le tableau de bord est alors sur `http://127.0.0.1:7777`. Le `.env` peut être
celui d'une ruche posée sur l'hôte : ce qui décrit le conteneur (adresse
d'écoute, port, base, fichier de clés) est reposé par `docker-compose.yml`, qui
prime. Pour publier sur un autre port de l'hôte, changez la partie gauche de
`ports` (`127.0.0.1:8080:7777`), pas `HIVE_PORT`.

### Le compose démarre une Reine — pas d'ouvrière

`docker compose up` ne démarre **aucune machine qui travaille**. Les ouvrières
font tourner les agents de codage (Claude Code, Codex, Cursor…) avec les
identifiants de leur machine ; les enfermer dans le conteneur de la Reine leur
donnerait une maison sans clés. Sans ouvrière, les tâches attendent, et l'écran
le dit. Pour en rattacher une :

- **sur cette machine**, depuis le dépôt (Node 24) — le nœud lit le même `.env`,
  dont `HIVE_URL=ws://localhost:7777/ws` vise justement le port publié :

  ```sh
  npm ci
  npm run node
  ```

- **depuis une autre machine** : le port n'est publié que sur la boucle locale,
  il faut donc une adresse que l'autre machine peut joindre. `npm run cli --
tunnel`, lancé sur cet hôte depuis le dépôt, en ouvre une chiffrée sans
  toucher au pare-feu et imprime le billet à transmettre ; Hive Cloud la donne
  derrière Caddy ([`CLOUD.md`](CLOUD.md)). L'autre machine lance alors
  `npx github:Micka420-collab/hive join hive2_…` (voir
  [Rejoindre la ruche d'un ami](#rejoindre-la-ruche-dun-ami)).

### Mettre à jour

L'image se construit ici, depuis le dépôt : il n'y a pas d'image publiée à
tirer. Sauvegardez d'abord — la base, puis les clés posées depuis la Chambre,
qui vivent dans le volume (ce fichier naît avec la première clé : sans clé
posée, la troisième commande n'a rien à copier) :

```sh
docker compose exec ruche node dist/cli.js sauvegarde
docker compose cp ruche:/app/data/sauvegardes ./sauvegardes
docker compose cp ruche:/app/data/queen.env ./queen.env.sauvegarde
```

Puis :

```sh
git pull --ff-only                  # ou : git fetch --tags && git checkout vX.Y.Z
docker compose build --pull ruche
docker compose up -d --wait
```

Le volume `hive-donnees` n'est pas touché : la nouvelle Reine rouvre la même
base. Le détail, les versions et le retour arrière : [`RELEASING.md`](RELEASING.md).

L'image est en **Node 24 sur Debian slim** (glibc 2.36). `better-sqlite3` 13
livre aussi des binaires musl : Alpine ne forcerait plus de compilation. `slim`
reste la base que la CI mesure — l'image, la montée de version, l'atelier —, et
un changement de libc se mesure avant de se faire.

Le **bureau de recette** (écran, CDP, outils) est un profil à part :
[`docs/ATELIER.md`](ATELIER.md). Il ne remplace pas `HIVE_ISOLEMENT`. Avec une
Reine en conteneur, on l'allume **depuis l'hôte**
(`docker compose --profile atelier up -d atelier`) : `HIVE_ATELIER=auto` et le
bouton « Allumer l'atelier » ne valent que pour une Reine lancée sur l'hôte.

Ce que `docker-compose.yml` décide pour vous, et pourquoi :

- **le port est publié sur `127.0.0.1`**, pas sur toutes les interfaces. Sous
  Linux, Docker écrit ses règles directement dans netfilter, **en amont de la
  plupart des pare-feu** : un `ports: - '7777:7777'` ouvre la ruche sur
  Internet sans que `ufw status` le montre. Pour l'ouvrir vraiment, il y a
  `hive tunnel` — chiffré et révocable —, ou, si tu vends l'hébergement,
  **Hive Cloud** : `docker compose -f docker-compose.cloud.yml up -d` (TLS via
  Caddy, voir [`docs/CLOUD.md`](CLOUD.md)) ;
- **les secrets viennent d'un fichier**, jamais de la ligne de commande : un
  `docker run -e HIVE_TOKEN=…` se lit dans le `ps` de n'importe quel compte de
  la machine ;
- **`restart: unless-stopped`**, pas `always`. Un logiciel qui repart quand on
  l'a éteint est un logiciel qu'on ne contrôle pas ;
- **le conteneur ne tourne pas en root**, son système de fichiers est en
  lecture seule sauf le volume de données, et toutes les capacités sont
  retirées ;
- **un vrai PID 1** (`init: true`) : la Reine lance git pour le Rayon, et un
  init ramasse les orphelins que `node` laisserait s'empiler.

Community (0 €, chez soi) et Cloud (payant, sur TES serveurs) partagent la
même image Docker. Seuls l'édition, le secret de webhook et le reverse proxy
changent.

La CI **construit l'image et y démarre la ruche** à chaque PR — un Dockerfile
qu'on ne construit jamais est une promesse que rien n'exerce. Elle fait aussi
tourner ce compose comme un opérateur : `up --wait` depuis un `.env` copié de
l'exemple, puis un compte, un projet, une clé de la Chambre et le code du
projet relus après `docker compose restart`, après un `kill -9` de la Reine
depuis l'hôte (relevée par `unless-stopped`) et après `down` puis `up`
(travail `compose`, `scripts/essai-conteneurs.mjs`).

---

## Systèmes et bacs à sable : ce que la CI prouve

Un nœud exécute son agent **sans bac** (le processus nu, dans son répertoire de
tâche) ou dans un **bac** : bubblewrap, Podman ou Docker, retenu par le
preflight (`HIVE_ISOLEMENT`). Ce tableau dit ce que la CI exerce pour de vrai à
chaque PR — pas ce qui « devrait marcher ».

|             | Sans bac                                     | bubblewrap                | Podman                                              | Docker                                              |
| ----------- | -------------------------------------------- | ------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| **Linux**   | **prouvé** (suite complète, vrais processus) | **prouvé** (vrai `bwrap`) | **prouvé** (rootless, `keep-id`)                    | **prouvé** (démon du runner)                        |
| **macOS**   | **prouvé** (suite complète, vrais processus) | sans objet (Linux seul)   | non prouvé — aucun moteur en CI                     | non prouvé — aucun moteur en CI                     |
| **Windows** | **prouvé** (suite complète, vrais processus) | sans objet (Linux seul)   | refusé pour Claude Code et Codex ; non prouvé sinon | refusé pour Claude Code et Codex ; non prouvé sinon |

Ce qui fonde chaque case :

- **sans bac, les trois systèmes** : la suite entière tourne sur
  `ubuntu-latest`, `macos-latest` et `windows-latest`. L'arrêt d'un agent y est
  éprouvé sur de vrais processus, **petits-enfants compris** — annulation,
  délai dépassé, agent sorti en laissant un descendant
  (`tests/arbre-processus.test.ts`) ; arrêt du nœud à la RÉCEPTION de l'ordre
  IPC que `npm run ruche` lui envoie sous Windows
  (`tests/noeud-arret-signal.test.ts`, un superviseur de banc envoie l'ordre)
  et de la Reine (`tests/reine-demarrage.test.ts`) ; merges et chantiers en
  cours (`tests/arret-noeud-travaux.test.ts`). Linux et macOS seulement :
  SIGTERM sur les deux portes du nœud (`tests/noeud-arret-signal.test.ts`),
  l'arrêt par `npm run ruche` lui-même (`tests/lanceur-ruche.test.ts`) et la
  reprise après un `kill -9` (`tests/resilience-processus.test.ts`). L'ENVOI
  de l'ordre par `scripts/ruche.mjs` sous Windows (canal IPC, `taskkill` de
  l'écran, balayage final) n'est éprouvé par aucun banc ;
- **bubblewrap** : le vrai `bwrap`, sur un agent installé dans un HOME comme
  chez un membre (`tests/isolement-runtime.integration.test.ts`), et le
  **réseau filtré** de bout en bout — un programme hostile dans le bac ne
  trouve la vraie clé dans aucun `/proc/*/environ`, se voit refuser un hôte
  hors liste et le réseau local, et joint l'API par la passerelle du nœud
  (`tests/reseau-bac.integration.test.ts`). Sur la jambe Linux,
  `HIVE_BWRAP_REQUIS=1` fait **échouer** ces bancs si bubblewrap manque ou ne
  filtre pas, au lieu de les sauter ;
- **Podman et Docker sous Linux** : le job `image` construit l'image des agents
  (`npm run bac:image`) et y passe le preflight réel de Hive, une fois par
  moteur — Docker du runner, puis Podman rootless (`--userns=keep-id`). Leur
  réseau filtré (`--network=none`, socket du proxy monté) n'est éprouvé que
  sur ses arguments (`tests/enveloppe-reseau.test.ts`) ; sur la machine du
  membre, la sonde du nœud le mesure au démarrage et l'annonce (ligne
  « Réseau : ») ;
- **macOS avec un moteur** : les runners macOS n'en ont aucun. Le preflight
  décide sur la machine du membre, et le pont de délégation (un socket Unix
  dans le dossier monté) n'a jamais été éprouvé à travers la machine virtuelle
  de Docker Desktop ou de `podman machine` ;
- **Windows avec un moteur** : le nœud **refuse** le bac pour Claude Code et
  Codex — leur pont MCP local n'est pas partageable avec un conteneur
  (`raisonPontMcpDansBac`). Pour les autres agents, rien n'est prouvé : le
  Docker Desktop du runner sert des conteneurs Windows, et le banc
  d'intégration s'y déclare indisponible plutôt que d'inventer un résultat.

### Arrêter un nœud : ce qui part avec lui

Chaque agent, commande de test de merge, chantier, validation et pose d'outil
est lancé comme la tête d'un **arbre** que le nœud possède (`src/shared/arbre-processus.ts`) :

- **Linux, macOS** : chef de son propre groupe de processus. Annulé ou
  expiré, tout le groupe reçoit SIGTERM, puis SIGKILL deux secondes plus tard ;
- **Windows** : `taskkill /T /F` emporte l'arbre des parents.

Un nœud qui s'arrête — Ctrl+C, SIGTERM d'un superviseur, terminal fermé
(SIGHUP), ou l'ordre de `npm run ruche` par son canal IPC, seul arrêt propre
sous Windows — annule tout ce qu'il mène, laisse deux secondes aux arbres pour
finir (sous Linux et macOS, `docker run` relaie l'arrêt à son conteneur), puis
abat ce qui reste en sortant.

Ce qui échappe encore, et qu'il faut savoir :

- un nœud tué **net** — `kill -9`, panne, ou sous Windows un
  `TerminateProcess` venu d'ailleurs (Gestionnaire des tâches, `taskkill /F`
  sur le nœud, arrêt de la tâche planifiée de `hive service`) : aucune ligne
  du nœud ne tourne plus. Ses conteneurs sont supprimés au démarrage suivant
  (étiquette du nœud) ; un agent sans bac tourne jusqu'à sa propre fin ;
- un conteneur qui ne s'arrête pas dans les deux secondes : son client
  `docker run` (ou `podman run`) est abattu, et le conteneur est supprimé au
  démarrage suivant du nœud ;
- sous Windows, **toute** tâche en bac conteneur annulée ou expirée :
  `taskkill /T /F` abat le client `docker run` (ou `podman run`) sans étape
  SIGTERM, donc sans relayer l'arrêt — le conteneur tourne (et peut consommer
  des crédits d'API) jusqu'au démarrage suivant du nœud, qui le supprime par
  son étiquette ;
- un descendant qui quitte le groupe de lui-même (`setsid`, un démon) ;
- sous Windows, les descendants d'un agent **sorti de lui-même** : son pid est
  libéré et peut déjà nommer un autre processus — le nœud cesse d'attendre
  leur sortie, il ne tue rien à l'aveugle.

### Noms réservés de Windows

`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9` désignent des
périphériques dans tout dossier Windows, avec ou sans extension. Sous Windows,
un nœud dont le nom (`HIVE_NODE_NAME`, sinon celui de la machine) serait l'un
d'eux travaille dans `.hive-work/<nom>~` (sous Linux et macOS, où c'est un nom
ordinaire, son dossier — et donc son identité — ne change pas) ; un
`HIVE_WORKDIR` dont un segment est réservé, ou finit par un point ou une
espace, est refusé au démarrage, segment nommé, plutôt que remappé en silence.
Sur tous les systèmes, un identifiant de tâche, de merge, de chantier ou de
projet réservé devient `<id>~` dans les chemins du nœud. L'identifiant, lui, ne
change pas.

---

## Sauvegarder la base

> **Deux sauvegardes, deux métiers.** Ici : copie SQLite de la **ruche**
> (`VACUUM INTO`). Pour le **code d’un projet** (timeline d’étapes, restauration
> via tâche), voir le panneau **Sauvegardes** du Rayon — ce n’est pas la même
> chose.

```sh
npm run cli -- sauvegarde --garder=7
```

**N'utilisez pas `cp`.** La base tourne en mode WAL : les écritures récentes
vivent dans un fichier `-wal` à côté du fichier principal. Une copie à chaud
donne une base qui s'ouvre sans erreur, passe `integrity_check`, et à laquelle
il **manque des lignes**.

Mesuré, sur 5 000 insertions — c'est le test le plus important de
[`tests/sauvegarde.test.ts`](../tests/sauvegarde.test.ts) :

|                                   | lignes rendues    | `integrity_check` |
| --------------------------------- | ----------------- | ----------------- |
| `hive sauvegarde` (`VACUUM INTO`) | **5 000 / 5 000** | `ok`              |
| `cp hive.db copie.db`             | **4 741 / 5 000** | `ok`              |

Les deux passent le contrôle d'intégrité. C'est bien le problème : la copie
n'est pas corrompue, elle est **incomplète**, et rien ne le dit.

La commande écrit dans `data/sauvegardes/`, sous un nom `.part` qu'elle renomme
une fois la copie terminée — un renommage est atomique, donc **ce qui porte un
nom définitif est toujours complet**, même si le processus meurt au milieu.
`--garder=N` borne le nombre de copies conservées ; les plus anciennes partent,
jamais celle qu'on vient d'écrire.

---

## Faire tourner la ruche en permanence

Une ruche qui tient des semaines doit survivre à un redémarrage. C'est
**optionnel** : rien ne s'installe sans qu'on le demande.

```sh
npm run cli -- service install --utilisateur
```

Le niveau doit être **dit**, jamais deviné — la commande refuse sans, avec le
code de sortie `3` :

|                 |                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `--utilisateur` | aucun droit administrateur. S'arrête à la fermeture de session, sauf `loginctl enable-linger $USER` |
| `--systeme`     | survit à la déconnexion, réclame l'administrateur                                                   |

| plateforme | ce qui est posé                              |
| ---------- | -------------------------------------------- |
| Linux      | une unité `systemd --user`, durcie           |
| macOS      | un `LaunchAgent`                             |
| Windows    | une tâche planifiée à l'ouverture de session |

```sh
npm run cli -- service status     # posé ? actif ?
npm run cli -- service logs       # les 200 dernières lignes
npm run cli -- service uninstall  # retire ce qui a été posé, et rien d'autre
```

**`service uninstall` ne touche ni au `.env` ni à la base** — il désinscrit,
puis efface le fichier de service. Dans cet ordre : l'inverse laisserait une
unité orpheline qui relance un binaire absent, c'est-à-dire une erreur toutes
les cinq secondes dans votre journal.

Sous Linux, l'unité est durcie : `NoNewPrivileges`, `PrivateTmp`,
`ProtectSystem=strict`, `ProtectHome=read-only`, et un `ReadWritePaths` réduit
au seul dossier d'installation. Sous Windows, la tâche tourne en
`LeastPrivilege` — une ruche n'a aucune raison d'être administrateur.

> **Ce qui n'est pas vérifié automatiquement.** La CI éprouve la FORME des trois
> fichiers de service, l'échappement des chemins hostiles, et le cycle
> install → uninstall contre un système simulé. Elle ne peut pas vérifier que
> `systemctl`, `launchctl` et `schtasks` ACCEPTENT ces fichiers : un runner n'a
> ni bus de session, ni session graphique, ni envie qu'on inscrive une tâche
> chez lui. Ça, il faut une vraie machine.

---

## Désinstaller

```sh
cd ~/hive && npm run cli -- desinstaller
```

Cette commande **ne supprime rien**. Elle montre tout ce que Hive a écrit sur
votre machine, ce que ça pèse, et ce que vous perdriez à l'effacer. C'est le
défaut, pas une option : un drapeau qu'on oublie de taper ne doit jamais
transformer un inventaire en effacement.

```
🐝 Ce que Hive a écrit — /home/moi/hive

  ✘ la mémoire de la ruche — 320 ko
       /home/moi/hive/data/hive.db
       ⚠ les projets, les tâches, le Hive Mind, le grand livre et les comptes.

  ▸ les espaces de travail des tâches — 41 Mo
       /home/moi/hive/.hive-work
         · node-key.txt — la clé de ce nœud ; sans elle, il faut un billet
       ↻ une tâche EN COURS y vit.
```

`--oui` enlève ce qui se reconstruit (miroirs git, espaces de travail, restes
de fusion). `--json` rend le tout en machine.

### Ce que la commande ne fera pas à votre place

**`.env` et `data/hive.db` ne sont jamais supprimés**, quel que soit le
drapeau. `HIVE_TOKEN` perdu déconnecte tous vos nœuds ; `HIVE_JWT_SECRET`
perdu invalide toutes les sessions ; et la base est la seule copie de la
mémoire de la ruche. La commande vous donne le `rm -rf` exact, et s'arrête là.

Un outil d'installation n'est pas un outil de destruction —
[ADR 0004](adr/0004-politique-de-service-et-desinstallation.md).

### Où Hive écrit, exactement

|                                  |                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<installation>/.env`            | jetons et secrets                                                                                       |
| `<installation>/data/hive.db`    | la base, plus ses `-wal`, `-shm` et `.reine.lock`                                                       |
| `<installation>/data/rayons/`    | les miroirs des dépôts                                                                                  |
| `<installation>/.hive-work/`     | espaces de travail, clé du nœud, `cloudflared`, branches de mission non poussées (`<nœud>/livraisons/`) |
| `$TMPDIR/hive-merge-*`           | patchs d'une fusion — effacés à la fin de chacune                                                       |
| `$TMPDIR/hive-agent-preflight-*` | répertoires vides de sonde — effacés après chaque preflight                                             |
| `$TMPDIR/hive-pont-*`            | ponts MCP de délégation d'un nœud — effacés à son arrêt                                                 |

Pas de service, pas d'entrée de registre, pas de fichier dans `/etc`, rien
dans votre dossier personnel. Ce n'est pas une promesse en prose :
[`tests/empreinte.test.ts`](../tests/empreinte.test.ts) relève les appels
d'écriture réels de `src/` et **rougit** si l'un d'eux apparaît ailleurs.

**Quelques nuances, parce qu'elles vous concernent :**

- `$TMPDIR/hive-merge-*` : ces répertoires sont effacés à la fin de chaque
  fusion ; il n'en reste que si un processus a été tué au mauvais moment.
  `desinstaller` les trouve.
- `$TMPDIR/hive-agent-preflight-*` : le preflight utilise un répertoire vide
  pour ne jamais monter votre workspace ; il est supprimé dès que la sonde
  `--version` se termine.
- `$TMPDIR/hive-pont-<pid>-*/` : le dossier privé (700) où un nœud pose le
  socket local et la configuration du pont MCP qui relie un CLI à
  `hive_delegate` et `hive_wait_for_delegation_result` — un sous-dossier par
  tentative, authentifié pour elle seule et effacé à sa fin. Il vit hors de
  `.hive-work` parce qu'un chemin de socket Unix est limité à 104–108 octets :
  depuis un dossier profond, le pont ne pouvait plus s'ouvrir. Le dossier part
  à l'arrêt du nœud — Ctrl-C, le SIGTERM d'un superviseur (`hive service`,
  systemd, launchd, arrêt d'un conteneur), l'ordre de `npm run ruche` ; celui
  d'un nœud tué net (`kill -9`, ou sous Windows un `TerminateProcess` venu
  d'ailleurs) reste jusqu'au prochain démarrage d'un nœud de ce compte, qui le
  balaie.
  Le même dossier porte, pour chaque tâche au réseau filtré, le socket de son
  proxy et le relais `r.cjs` que le bac monte en lecture seule — effacés à la
  fin de la tâche.
  Si `TMPDIR` lui-même est trop profond, le nœud le dit dès son démarrage.
  Sous Windows, le pont écoute sur un pipe nommé `\\.\pipe\hive-pont-*`.
  Rien de ce pont n'entre dans le répertoire de la tâche, donc dans un diff.
  Une image de bac personnalisée doit contenir `node` en plus du CLI : le
  preflight le vérifie pour Claude Code et Codex avant d'accepter le bac.
- `<installation>/.hive-work/tasks/<task-id>.git` : le git dir **de la
  ruche**, posé à côté de la tâche juste après le clone et effacé avec elle.
  C'est par lui — jamais par le `.git` que l'agent a eu entre les mains — que
  le nœud calcule le diff de revue et relit le dépôt pour les validations du
  bac : un crochet, un filtre ou un `core.fsmonitor` écrit par l'agent dans
  son dépôt ne s'exécute donc jamais sur votre machine, hors du bac.
- `<installation>/.hive-work/tasks/<task-id>.inerte` : pour Cursor et Cline,
  qui n'ont pas d'option pour ignorer les hooks d'un projet, la configuration
  d'agent du dépôt (`.cursor/hooks.json`, `.claude/settings*.json`,
  `.clinerules/hooks`, `.cline/hooks`, `.cline/plugins`) attend ici pendant que
  l'agent tourne, hors du bac, puis retourne dans la tâche avant le diff. Le
  dossier est effacé avec la tâche.
- **un dépôt privé par SSH** (`git@hôte:…`) : le nœud clone — et, pour une
  livraison locale, liste et pousse — en mode lot
  (`ssh -o BatchMode=yes`), sans jamais attendre une invite. La clé d'hôte
  doit donc déjà figurer dans votre `~/.ssh/known_hosts`, et une clé à phrase
  de passe doit être chargée dans votre agent ssh (`ssh-add`) — le nœud lui
  transmet `SSH_AUTH_SOCK`, jamais à l'agent de codage. Le `core.sshCommand`
  de votre configuration git globale ou système est conservé — le mode lot
  lui est ajouté : sous Windows, un `core.sshCommand` qui désigne
  `C:/Windows/System32/OpenSSH/ssh.exe` continue donc de servir l'agent ssh
  de Windows. Celui d'un dépôt n'est jamais lu.
- **si vous avez demandé un service**, son fichier vit dans votre dossier
  personnel — `~/.config/systemd/user/` sous Linux, `~/Library/LaunchAgents/`
  sous macOS. C'est la seule chose que Hive écrit là, elle est **opt-in**, et
  `desinstaller` la liste. Retirez-la avec `hive service uninstall`, **pas à la
  main** : effacer le fichier sans désinscrire laisse une unité orpheline.
- si vous avez rejoint une ruche avec `npx github:… join`, le dossier
  `.hive-work` a été créé **là où vous avez tapé la commande** — pas dans
  `~/hive`, que vous n'avez peut-être pas. Votre clé de nœud y est. Lancez
  `desinstaller` depuis ce dossier-là.

Si vous aviez installé le paquet globalement :

```sh
npm uninstall -g @micka420/hive
```

## Rejoindre la ruche de quelqu'un d'autre — en une commande

Celui qui invite engendre un billet (tableau de bord → **Inviter**, ou
`npm run cli -- invite`). La ruche remet alors **une** commande, une par
système. L'invité la colle dans un terminal, et c'est tout :

```sh
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/rejoindre.sh | sh -s -- hive2_…
```

```powershell
# Windows
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/rejoindre.ps1 -OutFile "$env:TEMP\hive-rejoindre.ps1"; powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\hive-rejoindre.ps1" -Billet hive2_…
```

Elle **installe si besoin**, puis rejoint. Si Hive est déjà là, rien n'est
réinstallé. L'adresse de la ruche est dans le billet — il n'y a rien d'autre à
saisir, et l'agent de codage de l'invité (Claude Code, Codex) est détecté seul.

### Ce qu'il faut savoir sur le billet

- il est **compté** : il ouvre N entrées, pas un accès permanent ;
- il est **révocable** d'un geste par l'hôte (`npm run cli -- revoquer <id>`) ;
- il est échangé contre une clé propre au nœud dès la première connexion, après
  quoi il ne sert plus à rien.

⚠ Le billet passe en **argument de commande** : il apparaît donc dans
l'historique du shell de l'invité et dans sa table des processus — sur SA
machine, pas sur le réseau ni chez l'hôte. Un billet à usage unique referme
cette fenêtre dès l'entrée ; c'est le réglage à préférer pour inviter une seule
personne.

### Sur le même réseau local, sans billet

Si la ruche écoute le réseau (`HIVE_DECOUVERTE=1`, `HIVE_HOST=0.0.0.0`), la
machine à ajouter peut se signaler au lieu d'attendre un billet :

```sh
hive join --decouvrable        # ou : npm run join -- --decouvrable
```

Elle affiche un **code d'appariement** ; l'hôte clique **Inviter** → « Sur votre
réseau local » → **Rejoindre** et le recopie. Détails et garanties :
[FONCTIONNALITES.md](FONCTIONNALITES.md#la-machine-dà-côté-sans-billet-à-copier-réseau-local).

### Les réglages

| Réglage           | Ce qu'il fait                         | Défaut       |
| ----------------- | ------------------------------------- | ------------ |
| `HIVE_DIR`        | où installer                          | `~/hive`     |
| `HIVE_DEPOT_BRUT` | d'où tirer les scripts (fork, miroir) | dépôt public |
