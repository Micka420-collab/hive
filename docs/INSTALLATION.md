# Installer Hive

> **Prérequis unique : Node.js ≥ 24.** Rien d'autre. Pas de compilateur, pas de
> `sudo`, pas de service système.

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

## Pourquoi Node 24 et pas moins

Ce n'est pas une préférence pour le neuf : **ça retire une panne**.

`better-sqlite3` est un module natif. Sous Node 20, aucun binaire prébuilt
n'existe pour cette ABI — npm doit le **compiler**, ce qui exige un outillage
C++. Sur une machine Windows sans Visual Studio Build Tools, la compilation
échoue… **et `npm install` réussit quand même**, parce que la dépendance est
déclarée optionnelle. On se retrouve avec une installation « verte » et un
`hive start` qui meurt sur `ERR_MODULE_NOT_FOUND`.

Sous Node 24, le binaire prébuilt existe : rien à compiler, aucun compilateur à
installer, sur aucun système. Les deux comportements ont été mesurés côte à côte
dans notre propre CI, sur le même commit.

C'est pour ça que les installeurs vérifient la version **avant** de lancer quoi
que ce soit, plutôt que de vous laisser découvrir le problème deux étapes plus
loin.

---

## Si quelque chose ne va pas

```sh
cd ~/hive && npm run cli -- doctor
```

Douze diagnostics, et **chacun dit quoi taper** pour réparer — pas seulement ce
qui ne va pas. Un thermomètre qui ne propose rien ne sert qu'à nommer la peine.

```
🩺 hive doctor

  ✔ node_version  Node 24 (≥ 24 exigé)
  ✔ moteur        paquets de la ruche complète tous chargeables
  ✘ env_present   aucun fichier .env
       → cp .env.example .env
  ...
```

`--json` rend le tout en machine, pour une supervision.

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
cp .env.example .env    # posez-y votre HIVE_TOKEN
docker compose up -d
```

L'image est en **Node 24 sur Debian slim**, pas sur Alpine : `better-sqlite3`
publie des binaires prébuilts pour la glibc, pas pour la musl d'Alpine. Sur
Alpine, npm devrait le **compiler** — et comme la dépendance est optionnelle,
un échec de compilation produirait une image « réussie » dont le démarrage
meurt sur `ERR_MODULE_NOT_FOUND`. C'est la panne que Node 24 a supprimée côté
poste de travail ; on ne la réintroduit pas ici.

Le **bureau de recette** (écran, CDP, outils) est un profil à part :
[`docs/ATELIER.md`](ATELIER.md). Il ne remplace pas `HIVE_ISOLEMENT`.

Ce que `docker-compose.yml` décide pour vous, et pourquoi :

- **le port est publié sur `127.0.0.1`**, pas sur toutes les interfaces. Sous
  Linux, Docker écrit ses règles directement dans netfilter, **en amont de la
  plupart des pare-feu** : un `ports: - '7777:7777'` ouvre la ruche sur
  Internet sans que `ufw status` le montre. Pour l'ouvrir vraiment, il y a
  `hive tunnel`, ou — si tu vends l'hébergement — **Hive Cloud** :
  `docker compose -f docker-compose.cloud.yml up -d` (TLS via Caddy, voir
  [`docs/CLOUD.md`](CLOUD.md)).

Community (0 €, chez soi) et Cloud (payant, sur TES serveurs) partagent le
même image Docker. Seuls l'édition, le secret de webhook et le reverse proxy
changent.
`hive tunnel` — chiffré et révocable ;

- **les secrets viennent d'un fichier**, jamais de la ligne de commande : un
  `docker run -e HIVE_TOKEN=…` se lit dans le `ps` de n'importe quel compte de
  la machine ;
- **`restart: unless-stopped`**, pas `always`. Un logiciel qui repart quand on
  l'a éteint est un logiciel qu'on ne contrôle pas ;
- **le conteneur ne tourne pas en root**, son système de fichiers est en
  lecture seule sauf le volume de données, et toutes les capacités sont
  retirées.

La CI **construit l'image et y démarre la ruche** à chaque PR — un Dockerfile
qu'on ne construit jamais est une promesse que rien n'exerce.

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

|                               |                                                   |
| ----------------------------- | ------------------------------------------------- |
| `<installation>/.env`         | jetons et secrets                                 |
| `<installation>/data/hive.db` | la base, plus ses `-wal` et `-shm`                |
| `<installation>/data/rayons/` | les miroirs des dépôts                            |
| `<installation>/.hive-work/`  | espaces de travail, clé du nœud, `cloudflared`    |
| `$TMPDIR/hive-merge-*`        | patchs d'une fusion — effacés à la fin de chacune |

Pas de service, pas d'entrée de registre, pas de fichier dans `/etc`, rien
dans votre dossier personnel. Ce n'est pas une promesse en prose :
[`tests/empreinte.test.ts`](../tests/empreinte.test.ts) relève les appels
d'écriture réels de `src/` et **rougit** si l'un d'eux apparaît ailleurs.

**Trois nuances, parce qu'elles vous concernent :**

- `$TMPDIR/hive-merge-*` : ces répertoires sont effacés à la fin de chaque
  fusion ; il n'en reste que si un processus a été tué au mauvais moment.
  `desinstaller` les trouve.
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

### Les réglages

| Réglage           | Ce qu'il fait                         | Défaut       |
| ----------------- | ------------------------------------- | ------------ |
| `HIVE_DIR`        | où installer                          | `~/hive`     |
| `HIVE_DEPOT_BRUT` | d'où tirer les scripts (fork, miroir) | dépôt public |
