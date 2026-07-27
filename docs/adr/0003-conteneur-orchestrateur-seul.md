# ADR 0003 — Une image pour l'orchestrateur, aucune pour le nœud

- **Statut** : proposé (lot 0 de la mission « L'ACCUEIL »)
- **Date** : 2026-07-27
- **Concerne** : §7.4 et §19.3-19.4 de `MISSION-ACCUEIL.md`

## Contexte

Hive a deux processus : l'**orchestrateur** (la Reine — HTTP, WebSocket,
SQLite, dashboard) et le **nœud membre** (l'ouvrière — elle lance l'agent de
codage de son hôte sur des tâches).

La question posée : publie-t-on une image pour les deux ?

## Options pesées

**A. Imager les deux.** Uniformité apparente. Mais un nœud doit lancer
`claude` ou `codex` — le binaire de **l'hôte**, avec **sa** configuration
(`HOME`, `~/.claude`, `ANTHROPIC_API_KEY`) et son espace de travail. Pour que
ça marche dans un conteneur, il faudrait monter le `$HOME` de l'hôte, et
souvent son Docker socket. À ce stade le conteneur ne protège plus rien : il
donne au code confiné exactement ce qu'on voulait lui cacher.

**B. Imager l'orchestrateur seul.** L'orchestrateur ne lance aucun agent : il
distribue, il enregistre, il sert le dashboard. Ses besoins sont un port et un
volume. C'est le composant qu'on met sur un serveur et qu'on laisse tourner.

**C. N'imager ni l'un ni l'autre.** Ferme le chemin « serveur » que la mission
exige (§5 C).

## Décision

**Image pour l'orchestrateur uniquement.** Le nœud s'installe sur la machine de
son hôte, sans conteneur — et c'est **dit** dans la documentation, pas laissé à
découvrir.

Ce n'est pas un renoncement au confinement des agents : Hive a déjà son propre
bac à sable (`src/node-client/isolement.ts`), qui met **la tâche** dans un
conteneur podman/docker/bubblewrap avec `--read-only`, `--cap-drop=ALL`,
`--pids-limit`, mémoire et CPU bornés, et les secrets passés **par nom**
(`--env=CLE`, jamais `--env=CLE=valeur`, qui fuirait dans `ps`). Le bon niveau
de confinement est la tâche, pas le nœud. Conteneuriser le nœud remplacerait un
bac à sable qui fonctionne par un autre qui devrait s'ouvrir pour fonctionner.

### Socle : Node 22 pour l'image, `>=20` comme plancher

`package.json` déclare `engines: >=20` et la CI teste Node 20. L'image, elle,
est **notre** environnement : on la fixe sur `node:22-slim` (LTS active, plus
longue durée de vie). Le plancher supporté reste 20, et la matrice CI teste 20
**et** 22 — le plancher est une promesse faite aux gens, la version de l'image
est un choix qui n'engage que nous.

## Conséquences

- `Dockerfile` multi-stage : construction du dashboard, puis image finale
  `node:22-slim` en `USER hive` (non-root), `HEALTHCHECK` sur `/api/pulse`.
- Volume nommé pour la base SQLite, **avec la procédure de sauvegarde** :
  `VACUUM INTO`, jamais une copie de fichier à chaud — `better-sqlite3` écrit
  en WAL, et copier le `.db` sans son `-wal` donne une base silencieusement
  incohérente.
- `compose.yaml` minimal ; le jeton et le secret de session viennent de
  l'environnement, **jamais du fichier compose** (qui finit dans un dépôt).
- La documentation dit explicitement pourquoi il n'y a pas d'image de nœud.
  Une absence non expliquée serait lue comme un oubli, et quelqu'un finirait
  par en fabriquer une en montant son `$HOME`.
- Le lot 11 dépend du lot 7 : sans chaîne de compilation, l'image devrait
  embarquer `tsx` et les sources.
