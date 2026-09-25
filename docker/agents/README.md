# Hive agent runner

Cette image contient les CLI d’agents que Hive peut installer de façon
reproductible, vérifier et lancer dans un conteneur : **Claude Code**, **Codex**
et **Cline**. Elle est distincte de `docker/atelier`, qui sert uniquement au
bureau Chromium/VNC.

Construire et vérifier localement :

```bash
docker build -f docker/agents/Dockerfile -t hive-agent:local .
docker run --rm hive-agent:local claude --version
docker run --rm hive-agent:local codex --version
docker run --rm hive-agent:local cline --version
```

Les versions sont épinglées dans le Dockerfile (`CLAUDE_CODE_VERSION`,
`CODEX_VERSION`, `CLINE_VERSION`). Une mise à jour doit modifier l’argument de
version, reconstruire l’image et refaire les trois sondes.

Cline se distribue en binaire compilé par plateforme (Bun embarqué), tiré par
npm via les `optionalDependencies` du paquet. Il pèse lourd (~150 Mo) et exige
un CPU x86-64 récent : sur un cœur trop ancien il s’arrête en « Illegal
instruction ». Les runners CI et les machines modernes l’exécutent sans souci.

## Les CLI qui NE sont PAS dans l’image, et pourquoi

Hive détecte et sait piloter cinq CLI réels (`agent-detect.ts`). Deux ne sont
volontairement pas intégrés ici, parce qu’ils casseraient le contrat « versions
épinglées, rebuild reproductible » que ce Dockerfile tient :

- **Cursor** (`cursor-agent`) s’installe par `curl https://cursor.com/install | bash`
  — un script qui tire un binaire non versionné, et dont l’authentification
  repose sur une session `~/.cursor` locale, jamais copiée dans le bac.
- **Grok Build** (`grok`) est un binaire Rust natif hors npm, sans version
  épinglable proprement au moment du build.

Un opérateur qui veut faire tourner l’un de ces agents en conteneur fournit sa
propre image (à partir de celle-ci) et la désigne par la variable
`HIVE_ISOLEMENT_IMAGE`. Le preflight de Hive lance `<cli> --version` dans le
conteneur et n’exige que le code de sortie 0 ; toute image qui contient le
binaire du CLI choisi passe.

L’image ne contient aucun secret. Une clé API doit être fournie explicitement au
conteneur par l’opérateur ; une session stockée sur l’hôte n’est pas copiée dans
le bac. L’exécution réseau reste nécessaire aux agents de codage.
