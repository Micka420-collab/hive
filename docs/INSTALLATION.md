# Installer Hive

> **Prérequis unique : Node.js ≥ 24.** Rien d'autre. Pas de compilateur, pas de
> `sudo`, pas de service système.

---

## En une commande

**Linux et macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/Micka420-collab/hive/main/install.ps1 | iex
```

Le script vérifie Node, récupère Hive dans `~/hive`, installe les dépendances,
puis passe la main à l'installeur qui vous pose **au plus trois questions**.

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

Tout autre drapeau est **transmis à l'installeur** de Hive — notamment
`--non-interactive`, pour un serveur sans écran.

Les variables `HIVE_DIR` et `HIVE_REF` font la même chose que `--dir` et
`--ref`.

---

## Installer sur un serveur, sans écran

```sh
curl -fsSL .../install.sh | sh -s -- --non-interactive
```

`--non-interactive` est implicite dès que `CI` est présente dans
l'environnement : aucune question n'est posée, et une réponse manquante devient
une **erreur explicite** plutôt qu'une invite qui attend dans le vide.

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

**Deux nuances, parce qu'elles vous concernent :**

- `$TMPDIR/hive-merge-*` est la seule écriture hors du dossier. Ces
  répertoires sont effacés à la fin de chaque fusion ; il n'en reste que si un
  processus a été tué au mauvais moment. `desinstaller` les trouve.
- si vous avez rejoint une ruche avec `npx github:… join`, le dossier
  `.hive-work` a été créé **là où vous avez tapé la commande** — pas dans
  `~/hive`, que vous n'avez peut-être pas. Votre clé de nœud y est. Lancez
  `desinstaller` depuis ce dossier-là.

Si vous aviez installé le paquet globalement :

```sh
npm uninstall -g @micka420/hive
```
