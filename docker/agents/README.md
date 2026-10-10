# Hive agent runner

Cette image contient les CLI d’agents que Hive peut installer de façon
reproductible, vérifier et lancer dans un conteneur : **Claude Code**, **Codex**
et **Cline**. Elle est distincte de `docker/atelier`, qui sert uniquement au
bureau Chromium/VNC.

C’est l’image **par défaut** du bac à sable conteneur
(`localhost/hive-agent:local`). Hive ne la publie ni ne la télécharge : chaque
nœud la construit, avec le moteur qu’il utilisera.

```bash
npm run bac:image                      # podman s’il répond, sinon docker
npm run bac:image -- --moteur docker   # un moteur précis
```

Vérifier à la main :

```bash
podman run --rm localhost/hive-agent:local claude --version
podman run --rm localhost/hive-agent:local codex --version
podman run --rm localhost/hive-agent:local cline --version
```

Chaque moteur a son propre magasin d’images : construite par Docker, l’image
n’existe pas pour Podman. Au démarrage, le nœud éprouve les moteurs dans l’ordre
(podman, docker, bubblewrap) et garde le premier dont le preflight passe ; une
image absente se dit « absente », avec cette commande, et jamais « agent absent ».

Les versions sont épinglées dans `docker/agents/package.json`, et **tout l’arbre
de leurs dépendances** dans `docker/agents/package-lock.json` (versions et
empreintes d’intégrité) : l’image s’installe par `npm ci`, qui pose exactement
cet arbre ou échoue. Un `npm install --global` n’épinglait que les trois CLI ;
leurs dépendances transitives flottaient, et une publication en amont a suffi à
casser la construction le 25 septembre sans qu’une ligne du dépôt change.

Mettre à jour un CLI : changer sa version dans `package.json`, lancer
`npm install --package-lock-only` dans ce dossier, reconstruire l’image et refaire
les trois sondes.

Cline se distribue en binaire compilé par plateforme (Bun embarqué), tiré par
npm via les `optionalDependencies` du paquet. Il pèse lourd (~150 Mo) et exige
un CPU x86-64 récent : sur un cœur trop ancien il s’arrête en « Illegal
instruction ». Les runners CI et les machines modernes l’exécutent sans souci.

## Après une mise à jour de Hive : relancer `npm run bac:image`

Une mise à jour du dépôt (`git pull`, `git checkout vX.Y.Z`) ne touche pas au
magasin d’images du moteur : le nœud garde l’image construite avant, même quand
ce Dockerfile ou l’arbre épinglé des CLI ont changé. Après chaque mise à jour,
sur chaque nœud qui isole par Podman ou Docker :

```bash
npm run bac:image        # avec -- --moteur docker si c’est Docker qui isole
```

Pour que l’oubli se voie, `npm run bac:image` pose sur l’image l’étiquette
`hive.empreinte` : l’empreinte (SHA-256) de ce Dockerfile et des fichiers qu’il
copie, fins de ligne ramenées à LF. Le nœud la relit au démarrage, `hive doctor`
aussi, et la compare à celle des entrées de la version installée :

- **à jour** : rien de plus à dire ;
- **périmée** — pas d’étiquette (une image construite avant cette étiquette, ou
  à la main), ou une autre empreinte : le nœud l’écrit au démarrage
  (`⚠ Image localhost/hive-agent:local périmée (…) — reconstruisez-la …`) et
  `hive doctor` passe l’isolement en ⚠, avec la commande du moteur concerné.

Une image périmée est **dite, jamais refusée** : les murs du bac (racine en
lecture seule, capacités retirées, uid non privilégié, bornes) sont posés au
lancement, pas par l’image ; la refuser ferait retomber le nœud sur un bac moins
étanche, ou sur la sandbox de processus, où les validations ne tournent pas du
tout. Elle peut en revanche manquer de ce que la nouvelle version y a changé —
d’où la ligne, à chaque démarrage, jusqu’à la reconstruction.

Une image nommée par `HIVE_ISOLEMENT_IMAGE` n’est jamais jugée : Hive n’en
attend aucune empreinte, et le dit (« non gérée par Hive »). L’empreinte ne
couvre que les entrées du dépôt : la base `node:24-bookworm-slim` est une
étiquette flottante, qu’elle ne fige pas. Lire l’étiquette à la main :

```bash
podman image inspect localhost/hive-agent:local \
  --format '{{index .Config.Labels "hive.empreinte"}}'
```

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
conteneur, avec les mêmes contraintes que l’exécution réelle (racine en lecture
seule, `/tmp` en mémoire et non exécutable, uid non privilégié, aucune
capacité) et exige le code de sortie 0. Une image passe si son CLI répond sous
ces contraintes ; sa seule présence ne suffit pas.

Tout CLI ajouté à ce Dockerfile doit aussi être ajouté à la liste des binaires
de `tests/isolement-runtime.integration.test.ts` : c’est ce test, lancé en CI
avec l’image construite, qui prouve le preflight durci.

L’image ne contient aucun secret. Une clé API doit être fournie explicitement au
conteneur par l’opérateur ; une session stockée sur l’hôte n’est pas copiée dans
le bac. L’exécution réseau reste nécessaire aux agents de codage.
