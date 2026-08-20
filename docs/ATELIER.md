# L'Atelier — bureau de recette

Un écran, un navigateur, des fichiers : l'agent **voit** ce qu'il fabrique.
Ce n'est pas l'isolement des tâches (`HIVE_ISOLEMENT`) — ça s'ajoute.

## Allumer

Depuis la racine du dépôt, **Community** (`HIVE_EDITION=community`, le défaut) :

```
docker compose --profile atelier up -d atelier
```

Arrêt : `docker compose --profile atelier stop atelier`.

La Queen peut faire le même geste : `HIVE_ATELIER=auto` puis, dans le tableau
de bord (vue Reine), « Allumer l'atelier ». `POST /api/atelier/demarrer`.

Sans Docker ni Podman : pas de bureau simulé. L'agent travaille en aveugle,
et on le dit.

## Trois canaux

| Canal   | Port (hôte, **127.0.0.1** seulement) | Rôle                                                       |
| ------- | ------------------------------------ | ---------------------------------------------------------- |
| Visuel  | 6080                                 | noVNC — l'écran                                            |
| Web     | 9222                                 | Chrome DevTools Protocol — DOM, clics, captures            |
| Système | 8765                                 | démon d'outils — `python3`, `node`, LibreOffice, Tesseract |

Le CDP écoute dans le conteneur ; compose **publie** 127.0.0.1, pas 0.0.0.0.

## Ce qui n'entre pas

Aucun `env_file`. Ni `HIVE_TOKEN`, ni clé d'API. Liste d'autorisation dans
`src/atelier/outil.ts`. Les crochets `/workspace/.wake-hooks` ne tournent que
s'ils sont **exécutables** et **possédés par `hive`**.

Volume persistant : `hive-atelier-workspace` → `/workspace`.

## Image

`docker/atelier/Dockerfile` — Debian (node:24-bookworm-slim), Xvfb, Openbox,
Chromium (pas google-chrome-stable : le dépôt Google casse les builds slim
pour le même CDP), Python 3, Node 24, LibreOffice, Tesseract. Utilisateur
`hive`, pas root.

## Réglages (`.env`)

```
HIVE_ATELIER=off          # off | auto | on — défaut off
HIVE_ATELIER_MOTEUR=docker
HIVE_ATELIER_PORT=6080
HIVE_ATELIER_CDP=9222
HIVE_ATELIER_OUTIL=8765
```
