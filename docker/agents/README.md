# Hive agent runner

Cette image contient les deux CLI que Hive peut vérifier et lancer dans un
conteneur : Claude Code et Codex. Elle est distincte de `docker/atelier`, qui
sert uniquement au bureau Chromium/VNC.

Construire et vérifier localement :

```bash
docker build -f docker/agents/Dockerfile -t hive-agent:local .
docker run --rm hive-agent:local claude --version
docker run --rm hive-agent:local codex --version
```

Les versions sont épinglées dans le Dockerfile. Une mise à jour doit modifier
les arguments de version, reconstruire l’image et refaire les deux sondes.

L’image ne contient aucun secret. Une clé API doit être fournie explicitement au
conteneur par l’opérateur ; une session stockée sur l’hôte n’est pas copiée dans
le bac. L’exécution réseau reste nécessaire aux agents de codage.
