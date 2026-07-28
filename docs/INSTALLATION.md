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

Hive n'écrit **rien** hors de son dossier : pas de service, pas d'entrée de
registre, pas de fichier dans `/etc`. Le supprimer suffit.

```sh
rm -rf ~/hive
```

Si vous aviez installé le paquet globalement :

```sh
npm uninstall -g @micka420/hive
```
