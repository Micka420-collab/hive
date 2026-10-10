# Publier une version — et monter de l'une à l'autre

Ce document dit comment Hive numérote ses versions, comment on en publie une,
et comment une ruche en service passe à la suivante sans rien perdre. Il est
écrit pour deux lecteurs : la personne qui **étiquette**, et celle qui
**exploite** une ruche et veut la mettre à jour.

## 1. Le numéro : SemVer, à partir de 0.4.0

Une version s'écrit `vMAJEUR.MINEUR.CORRECTIF` — trois nombres, rien d'autre
(pas de `v1.2`, pas de `-beta`). C'est la règle que lit déjà la ruche
(`lireVersion`, `src/shared/fraicheur-version.ts`) : une étiquette qu'elle ne
sait pas lire n'est pas une version publiée.

**0.4.0 est la première étiquette.** 0.1.0 et 0.2.0 ont des sections dans
`CHANGELOG.md` mais n'ont jamais été étiquetées ; 0.3.0 a été déclarée dans
`package.json` sans étiquette ni notes. Rien avant `v0.4.0` n'est une version
d'où l'on monte.

Avant 1.0.0, SemVer autorise tout changement dans une mineure. Hive s'impose
plus : le chiffre dit à l'opérateur s'il a quelque chose à faire.

| On monte…     | quand la version…                                                                                                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MINEUR**    | apporte une fonction, **ou** demande un geste à qui exploite : un réglage de `.env` retiré ou renommé, un changement de stockage qui n'est pas un simple ajout de table, un protocole Reine ↔ ouvrière qui change (les ouvrières doivent monter avec la Reine), une commande de la CLI retirée, un volume ou un service de compose renommé, un plancher de Node relevé |
| **CORRECTIF** | ne corrige que des défauts, et ne demande rien à personne                                                                                                                                                                                                                                                                                                              |
| **MAJEUR**    | le passage à 1.0.0 est une décision du propriétaire du dépôt, pas une règle de ce document                                                                                                                                                                                                                                                                             |

Tout geste demandé à l'opérateur s'écrit dans les notes de la version, sous
« Pour monter » — une mineure sans cette rubrique ne demande rien.

### Où vit le numéro

Il est écrit dans trois fichiers, et deux bancs tiennent les deux derniers au
premier — une copie oubliée fait rougir la CI :

- `package.json` — la source ;
- `package-lock.json`, à ses **deux** entrées racine (`tests/version-ruche.test.ts`) ;
- `site/index.html`, en-tête et pied de page (`tests/site-fraicheur.test.ts`).

`npm version X.Y.Z --no-git-tag-version` met à jour les deux premiers d'un
coup ; le site se change à la main.

## 2. Ce qu'on publie — et ce qu'on ne publie pas

Une version, c'est **une étiquette git annotée sur `main`**, et les
**binaires de l'application de bureau** construits depuis elle (ADR 0013).
Pas de paquet npm, et **pas d'image de conteneur** — l'image se construit
chez l'opérateur, depuis le dépôt qu'il a sous les yeux
(`docker compose build`). Les installeurs en ligne de commande clonent le
dépôt ; les ouvrières entrent par `npx github:Micka420-collab/hive`.

**L'application de bureau.** Pousser l'étiquette déclenche
`.github/workflows/app-bureau.yml` : sur Windows, macOS et Linux, il construit
`Hive-Setup-X.Y.Z.exe`, les DMG `arm64`/`x64`, l'AppImage et le `.deb`, les
lance au banc de fumée, puis les dépose avec les `latest*.yml`
d'electron-updater dans une _release_ GitHub **brouillon** `vX.Y.Z`. La
version de l'app EST celle de `package.json` (lue au build) : aucun second
numéro à tenir.

**Publier la release brouillon est un geste humain, et c'est lui qui déclenche
les mises à jour** chez tous les utilisateurs de l'app (qui lisent le canal
`latest` des releases publiées). Avant de la publier : relire les paquets et
les rapports du banc (artefacts du run), et les notes.

Tant que les paquets ne sont pas signés, **ce droit de publier est la seule
racine de confiance des mises à jour** : l'app ne vérifie qu'une empreinte
publiée dans la même release. Qui peut publier une release peut livrer du code
à tous — d'où l'accord demandé à chaque installation non signée, et la
protection des comptes et jetons qui ont l'écriture sur le dépôt
([APPLICATION.md § Signature](APPLICATION.md#signature)). Les paquets déposés
sont exactement ceux que le banc de fumée du job `publier` a lancés.

Les secrets de signature (Apple, Authenticode, Azure Trusted Signing) sont
facultatifs : absents, les paquets sortent non signés et marchent. La liste
exacte et leur effet : [APPLICATION.md § Signature](APPLICATION.md#signature).

## 3. Préparer une version

Dans une PR, comme n'importe quel changement :

1. Choisir le numéro (§ 1) d'après ce qui a été fusionné depuis l'étiquette
   précédente :

   ```sh
   git fetch --tags origin
   git log --first-parent --format='- %s' vPRÉCÉDENTE..origin/main
   ```

   Chaque ligne est une PR fusionnée (fusion « squash » ou commit de fusion,
   le numéro de la PR y figure). C'est la matière des notes.

2. `npm version X.Y.Z --no-git-tag-version`, puis la version de
   `site/index.html` (en-tête et pied de page).

3. `CHANGELOG.md` : une section `## [X.Y.Z] — AAAA-MM-JJ` tirée de la liste
   ci-dessus, regroupée (Ajouts / Changements / Corrections), avec une
   rubrique **Pour monter** quand un geste est demandé. Ce qui traîne sous
   `[Unreleased]` y descend.

4. La CI de la PR doit être verte — y compris le travail `montee`, qui
   démarre la version **précédente** en compose, lui fait poser des données,
   puis démarre l'arbre de la PR sur le même volume et relit tout (§ 6).

**La première, `v0.4.0`, fait exception sur deux points.** Le numéro a été
porté à 0.4.0 par la PR qui a posé ce document, pour que l'étiquette puisse
suivre sa fusion ; sa section du `CHANGELOG.md` s'écrit juste avant d'étiqueter,
une fois fusionnées les PR qu'on veut y voir. Et il n'y a pas d'étiquette
précédente : la liste part de 0.2.0 (15 juillet 2026). `[Unreleased]` a été
tenu à la main jusqu'au 29 août ; au-delà, seules les PR le disent.

```sh
git log --first-parent --since=2026-07-15 --format='- %s' origin/main
```

## 4. Étiqueter

Une fois la PR fusionnée, depuis un clone propre :

```sh
git fetch origin && git checkout main && git pull --ff-only
node -p "require('./package.json').version"     # doit afficher X.Y.Z
git tag -a vX.Y.Z -m "Hive X.Y.Z"
git push origin vX.Y.Z
```

**Annotée** (`-a`) : `git describe` ne voit pas les étiquettes légères. Le
travail `montee` vérifie qu'une étiquette dit la vérité — posée sur un commit
dont `package.json` déclare un autre numéro, elle fait échouer la CI : une
version qui ne sait pas son propre numéro fausserait `/api/version` pour toute
sa durée.

L'étiquette poussée, `app-bureau.yml` construit l'app et ouvre la _release_
**brouillon** `vX.Y.Z` avec ses paquets (§ 2). Il reste à y écrire les notes,
puis à la **publier** — ce qui déclenche les mises à jour de l'app :

```sh
gh run list --workflow app-bureau.yml --branch vX.Y.Z   # attendre le vert
gh release edit vX.Y.Z --title "Hive X.Y.Z" \
  --notes-file <(gh api repos/Micka420-collab/hive/releases/generate-notes \
    -f tag_name=vX.Y.Z -f previous_tag_name=vPRÉCÉDENTE --jq .body)
gh release edit vX.Y.Z --draft=false                     # le geste qui publie
```

Sans l'app (le flux échoue, ou l'on ne veut pas publier de binaires), une
_release_ de notes seule reste possible :

```sh
gh release create vX.Y.Z --verify-tag --title "Hive X.Y.Z" \
  --generate-notes --notes-start-tag vPRÉCÉDENTE
```

`--generate-notes` liste les PR fusionnées entre les deux étiquettes. Pour la
toute première (`v0.4.0`), il n'y a pas d'étiquette précédente et GitHub
listerait tout l'historique : passez plutôt la section du `CHANGELOG.md` avec
`--notes-file`.

## 5. Monter de version — pour qui exploite une ruche

### Toujours : sauvegarder d'abord

La base se copie par `hive sauvegarde` (`VACUUM INTO`), **jamais** par un `cp`
à chaud : il perd les écritures récentes et rend une copie qui a l'air valide
([`INSTALLATION.md`](INSTALLATION.md#sauvegarder-la-base)).

| Installation         | Sauvegarde                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| par git (installeur) | `npm run cli -- sauvegarde`, puis copier hors de la machine `data/sauvegardes/` et `.env` (qui porte aussi les clés posées depuis la Chambre)                                                                                                                                                               |
| `docker compose`     | `docker compose exec ruche node dist/cli.js sauvegarde`, puis `docker compose cp ruche:/app/data/sauvegardes ./sauvegardes` et `docker compose cp ruche:/app/data/queen.env ./queen.env.sauvegarde` (les clés de la Chambre vivent dans le volume ; le fichier naît avec la première) ; garder aussi `.env` |
| Hive Cloud           | les mêmes, avec `-f docker-compose.cloud.yml`                                                                                                                                                                                                                                                               |

`.env` et `queen.env` sont des fichiers de **secrets** : rangez-les comme tels.

### Installation par git

```sh
git fetch --tags
git checkout vX.Y.Z              # ou, pour suivre main : git pull --ff-only
npm ci
node -e "new (require('better-sqlite3'))(':memory:').close()"
npm run build
```

puis redémarrer la ruche — `npm run ruche`, ou le service qu'a posé
`npm run cli -- service install` (voir
[`INSTALLATION.md`](INSTALLATION.md#faire-tourner-la-ruche-en-permanence)).
C'est la marche que la ruche donne elle-même (`/api/version`,
`marcheASuivre`) ; la troisième ligne n'est pas une politesse :
`better-sqlite3` est une dépendance optionnelle que npm peut écarter **en
silence**, et une ruche démarrerait alors morte.

### `docker compose` (Community)

```sh
git fetch --tags && git checkout vX.Y.Z      # ou : git pull --ff-only
docker compose build --pull ruche
docker compose up -d --wait
```

`build --pull` reconstruit la Reine sur une base Node à jour (correctifs de
sécurité de Debian compris). Le volume `hive-donnees` n'est pas touché : la
nouvelle Reine rouvre la même base.

### Hive Cloud

```sh
git fetch --tags && git checkout vX.Y.Z
docker compose -f docker-compose.cloud.yml pull caddy
docker compose -f docker-compose.cloud.yml build --pull ruche
docker compose -f docker-compose.cloud.yml up -d --wait
```

Le domaine est dans `.env` (`HIVE_DOMAIN`), pas dans un fichier suivi : pour
une ruche Cloud posée à partir de 0.4.0, la mise à jour du code ne rencontre
aucune modification locale. Une ruche posée AVANT avait reçu la consigne
d'éditer `docker/Caddyfile.cloud` : une seule fois, déplacer le domaine dans
`.env` puis `git checkout -- docker/Caddyfile.cloud` avant de tirer le code
(rubrique « Pour monter » de 0.4.0, dans `CHANGELOG.md`).

### Les ouvrières

La Reine et ses ouvrières parlent un protocole **sans numéro de version** :
montez-les ensemble, surtout pour une mineure. Une ouvrière posée par git suit
la même marche que ci-dessus, puis, si elle isole par Podman ou Docker,
reconstruit l'image de son bac — `npm run bac:image` (`-- --moteur docker` pour
Docker) : la mise à jour ne la touche pas. Oubliée, l'ouvrière le dit à son
démarrage (« image … périmée »), comme `hive doctor`
([`docker/agents/README.md`](../docker/agents/README.md)). Une ouvrière entrée
par `npx` se relance sur la
version voulue, **depuis le même dossier et avec le même billet** : la clé
qu'elle a obtenue la première fois (`.hive-work/join`) est reprise, et le
billet n'est pas redemandé.

```sh
npx github:Micka420-collab/hive#vX.Y.Z join hive2_votre-billet
```

### Revenir en arrière

À ce jour, le stockage n'**ajoute** que des tables et des index
(`CREATE … IF NOT EXISTS`) : `src/` ne contient ni `ALTER TABLE`, ni `DROP`,
ni `PRAGMA user_version` — la règle est écrite dans l'en-tête de
`src/orchestrator/balance.ts`. Revenir à l'étiquette précédente ne demande
donc en général que le code — mais « en général » n'est pas une garantie :
le chemin sûr est de reposer la sauvegarde prise avant la montée. La CI
l'exerce en compose, commandes comprises (§ 6).

Par git : arrêter la ruche, puis

```sh
git checkout vPRÉCÉDENTE && npm ci && npm run build
rm -f data/hive.db-wal data/hive.db-shm
cp data/sauvegardes/<la copie d'avant la montée>.db data/hive.db
```

Le `-wal` et le `-shm` appartiennent à la base qu'on remplace : laissés en
place, SQLite rejouerait leurs écritures sur la copie reposée.

En compose (la sauvegarde sortie du volume est dans `./sauvegardes`) :

```sh
git checkout vPRÉCÉDENTE
docker compose stop ruche
docker compose run --rm --no-deps -v "$PWD/sauvegardes:/restaurer:ro" ruche \
  sh -c 'rm -f /app/data/hive.db-wal /app/data/hive.db-shm && cp /restaurer/<fichier>.db /app/data/hive.db'
docker compose build ruche && docker compose up -d --wait
```

## 6. Ce que la CI prouve, à chaque PR

Trois travaux de `.github/workflows/ci.yml` exploitent les conteneurs comme un
opérateur, par `scripts/essai-conteneurs.mjs` :

- **`compose`** — `docker compose up --wait` depuis un `.env` copié de
  l'exemple ; un compte, un projet, une clé posée depuis la Chambre et le code
  du projet (le Rayon, cloné par le git de l'image) relus après
  `docker compose restart`, après un `kill -9` de la Reine depuis l'hôte
  (relevée par `unless-stopped`), et après `down` puis `up` ; la sauvegarde
  ci-dessus écrite, sortie du volume, rouverte — puis reposée comme au § 5.
- **`cloud`** — `docker-compose.cloud.yml` derrière le vrai Caddy (voir
  [`CLOUD.md`](CLOUD.md), § 7).
- **`montee`** — la plus récente étiquette `vX.Y.Z` (qui n'est pas l'arbre
  éprouvé) démarre, pose ses données ; l'arbre courant démarre sur le même
  volume et relit tout, et annonce son propre numéro. **Tant qu'aucune
  étiquette n'existe, ce travail le dit** — un avis dans le résumé de
  l'exécution — et ne fait rien d'autre : un vert muet ferait croire la montée
  éprouvée.
