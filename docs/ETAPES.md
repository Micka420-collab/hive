# Carnet des étapes

> L'état RÉEL du projet face à ses propres promesses — pas ce qu'on aimerait
> cocher.
>
> Deux sources : les **11 lots** de `MISSION-ACCUEIL.md` §13, et les **10
> critères** du definition of done (§4). Une ligne ne passe à ✅ que si quelque
> chose la VÉRIFIE : un test, une CI, une mesure. « Le code existe » ne suffit
> pas — c'est exactement comme ça qu'on se retrouve avec une règle écrite et un
> câblage absent.

---

## Lot 14 — Les Chantiers : lancer les travaux DÉCLARÉS du dépôt

| pièce                                                        | état | ce qui le vérifie, ou ce qui manque                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. La décision** — quels travaux, et lesquels sans humain  | ✅   | `src/shared/chantier.ts` + 23 tests. La ruche choisit dans ce que le dépôt déclare et n'invente jamais une commande ; ce qui SORT de la machine (publier, déployer, démarrer) exige un humain. Loupe : 10 mutants, et le survivant a révélé un vrai trou — `build:publish` passait pour de la vérification, donc automatisable. |
| **2. L'exécution locale** — lancer un chantier sur un nœud   | ✅   | `POST /api/projects/:id/chantiers/:nom/run` + `assign_chantier`/`chantier_result` + `runChantierJob`. **19 tests**, dont deux qui montent un `HiveNodeClient` RÉEL clonant un dépôt git et lançant `npm run` (codes 0 et 1 vérifiés), et trois qui font parler un **faux hub hostile**. Loupe : **17 mutants, 17 morts**.       |
| **3. GitHub Actions** — lister, lancer, lire l'état d'un run | ✅   | `listerWorkflows`, `lancerWorkflow` (workflow_dispatch), `lireRuns` — **et les trois routes qui les appellent**. 37 tests, `Fetcheur` injecté, loupe 15 + 8 mutants tous morts. Frontière : un workflow que l'API DÉCLARE, **par son id numérique**, jamais un nom de fichier.                                                  |
| **4. La liberté d'améliorer l'environnement**                | ✅   | Elle existe déjà et s'appelle `preparation.ts` : le dépôt déclare, la ruche installe. Ouvrir une porte plus large réintroduirait les deux failles fermées par `commande-test.ts` et `preparation.ts` — ce n'est pas une prudence de principe, c'est de l'expérience.                                                            |

> **La règle a été tenue** : « rien ne passe ✅ tant qu'un test ne montre pas un
> chantier réellement lancé sur un nœud ». Deux tests montent un vrai
> `HiveNodeClient`, qui clone un vrai dépôt git et lance vraiment `npm run` —
> codes de sortie 0 et 1 tous deux vérifiés, parce qu'un nœud qui rapporterait
> toujours « ça marche » passerait avec le seul cas heureux.
>
> **Les quatre pièces sont branchées.** Le lot 14 répond à la demande d'origine
> — « lancer des actions de workflow en local ET sur GitHub » — des deux côtés :
> un nœud clone et lance ce que le `package.json` déclare, et l'API GitHub lance
> ce que le dépôt a marqué `workflow_dispatch`.
>
> **Et il a un écran** : `Les Chantiers` (touche `h`), qui liste ce que le dépôt
> déclare, dit ce qui est lançable et **pourquoi le reste ne l'est pas**, montre
> la commande avant de la lancer, et affiche le verdict du nœud comme les runs
> GitHub. Un mécanisme sans écran n'existe pas — c'est le constat qu'ont déjà
> valu Le Partage, Les Guetteuses et le polyéthisme.

### Le piège de la pièce 3, et pourquoi il vaut d'être écrit

L'endpoint de lancement d'un workflow est :

```
POST /repos/{owner}/{repo}/actions/workflows/{id_OU_nom_de_fichier}/dispatches
```

**Ce segment accepte les deux.** Passer un nom de fichier — la forme naturelle,
celle qu'on a sous les yeux dans le dépôt — laisserait un appelant écrire un
morceau d'URL de l'API GitHub, et le premier `../..` la transformerait en
« n'importe quel endpoint, avec le jeton de l'hôte ». Ce jeton ouvre TOUS ses
dépôts. La ruche n'y met donc qu'un **entier**, vérifié présent dans la liste
que l'API vient de rendre — même forme que `jugerChantier` avec le bloc
`scripts` du `package.json`.

Deux autres surprises, trouvées en écrivant les tests :

- **`/actions/workflows` ne rend pas un tableau** mais
  `{ total_count, workflows: [...] }`, contrairement à `/user/repos` et
  `/issues` juste à côté. Copier la boucle des dépôts donnerait une liste
  **vide sans erreur** — et « ce dépôt n'a aucun workflow » est un mensonge
  parfaitement crédible.
- **Un 422 sur le dispatch a une cause quasi unique et PERMANENTE** : le
  workflow ne déclare pas `workflow_dispatch:`. Le conseil générique
  (« réessayez ») serait faux, et rien dans la liste ne permet de le savoir
  d'avance — l'API ne dit pas quels déclencheurs un workflow porte.

### La pièce 2, et la décision qui la porte

L'idée évidente est de recycler `assign_merge` avec une liste de diffs vide :
un chantier, c'est cloner le dépôt et lancer une commande, soit exactement un
merge sans rien à appliquer. **Ça ne marche pas, et c'est volontaire** :
`isMergeDiffs` (dans `shared/protocol.ts`) refuse une liste vide. Un merge sans
diff est un merge malformé, et relâcher cette validation pour faire passer un
chantier abîmerait la garde du merge pour le confort d'un autre usage.

D'où deux messages neufs — et une décision qui change tout :

> **LE MESSAGE NE PORTE PAS DE COMMANDE. IL PORTE UN NOM.**

`assign_merge` transporte un `testCommand`. `assign_chantier`, lui, transporte
le NOM d'un script, et le nœud relit le `package.json` du clone qu'il vient de
faire, vérifie que le nom y figure, puis compose l'argv lui-même.

La raison est celle qui a fait naître `jugerCommandeTest` : **un nœud ne doit
pas tenir pour acquis que le hub est bien celui qu'il croit** — le jeton de
ruche est partagé, les anciennes invitations le portent en clair, et le
transport peut être un `ws://` de réseau local. Un hub compromis qui envoie une
commande la fait exécuter ; un hub compromis qui envoie un nom ne peut désigner
que ce que le dépôt déclare déjà.

C'est une frontière plus solide qu'une liste de binaires autorisés, parce
qu'elle ne repose sur rien que l'attaquant puisse fournir.

**Et la loupe a montré que rien ne la testait.** La retirer laissait 15 tests
verts, pour une raison structurelle : le hub refuse déjà tout ce qui est
mauvais, si bien qu'un nœud branché sur un VRAI hub ne voit jamais passer une
demande hostile. Il a donc fallu un **faux hub** qui envoie ce qu'un vrai
refuserait — la seule façon d'exercer une garde que le reste du système rend
inatteignable. Trois tests la tiennent désormais, dont un qui vérifie qu'elle
n'est pas un mur : ce que le dépôt déclare vraiment passe.

### Lancer un workflow, est-ce « sortant » ?

La question s'est posée en branchant la pièce 3, et elle méritait mieux qu'un
réflexe. Un chantier sortant — publier, déployer, démarrer — n'est pas lançable
par la route locale. Un workflow tourne dehors, peut déployer, consomme des
minutes : la même règle devrait s'appliquer.

**Ce qui le distingue tient en une ligne de YAML : `on: workflow_dispatch:`.**

C'est le propriétaire du dépôt qui l'écrit, dans le dépôt, sur sa branche par
défaut. Ce n'est pas une CAPACITÉ que la ruche découvre en lisant un nom — c'est
une PERMISSION que le dépôt déclare, lisible par une machine, et **GitHub la
fait respecter lui-même** : un workflow qui ne la porte pas répond 422, quoi
qu'on demande.

C'est la forme la plus forte de « la ruche exécute ce que le DÉPÔT déclare »
qu'on puisse trouver — plus forte qu'un nom de script, qui n'est qu'une
convention. La route existe donc, et la ruche ne choisit toujours pas
librement : seulement dans la liste que l'API vient de rendre, par identifiant
numérique.

Ce que la route n'expose PAS, et c'est délibéré : `intentionHumaine`. Une
requête HTTP ne peut pas prouver qu'un humain est derrière, et `jugerChantier`
réserve les travaux sortants à une intention humaine explicite. L'exposer
laisserait n'importe quel appelant cocher la case.

Deuxième chose à savoir : `jugerCommandeTest` ne borne que le BINAIRE, et
l'assume (« qui contrôle le dépôt contrôle déjà ce que `npm test` exécute »).
`npm run publish` y passerait donc. Ce n'est pas un trou : `merge/run` est
appelé par un humain — depuis `cli.ts` ou le dashboard, vérifié — qui a tapé sa
commande. La route des chantiers, elle, est faite pour être appelée PAR LA
RUCHE, et c'est précisément ce qui justifie que `jugerChantier` y soit plus
strict. La différence est dans l'appelant, pas dans la commande.

---

## Les 10 critères mesurables

| #   | Critère                                                                  | État | Ce qui le vérifie, ou ce qui manque                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Machine nue → ruche qui tourne en **une commande**, **≤ 3 décisions**    | ✅   | **Mesuré de bout en bout** : `sh install.sh` sur une machine en Node 24, dans un dossier vide → **23,3 s, code 0**, `.env` en 0600, et `hive doctor` rend 10 ✔. Décisions : **3** en interactif, **0** avec `--non-interactive`. Détail et réserves sous le tableau.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | **< 60 s** hors téléchargement npm                                       | ✅   | **Mesuré : ≈ 2,5 s**, contre 60 s de budget. Détail et réglages du banc sous le tableau. (La note d'avant citait un drapeau `--timings` : **il n'existe pas** — l'installeur ne déclare que `--yes`, `--dry-run`, `--non-interactive`, `--json`, `--help`. Une note qui invente l'outil de sa propre mesure est le meilleur indice qu'elle n'a jamais été faite.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | **0 nouvelle dépendance runtime** — TUI en ANSI à la main                | ✅   | `tests/paquet.test.ts` : `dependencies` = `['simple-git', 'ws']`, point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | Relançable **n fois** sans effet de bord                                 | ✅   | `tests/installer.test.ts` (27 tests) : « préserve chaque valeur existante », « complète les clés absentes sans toucher aux autres ».                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Fonctionne **sans TTY** (CI, ssh, pipe)                                  | ✅   | `tests/tui-terminal.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | `NO_COLOR=1`, `TERM=dumb`, 80 colonnes                                   | ✅   | `tests/tui-rendu.test.ts` + `tests/reglages-documentes.test.ts`, sur un module pur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | **CI verte sur `ubuntu-latest` ET `windows-latest`**                     | ✅   | Dépassé : les **trois** plateformes sont vertes, macOS comprise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | `hive doctor` diagnostique **10 causes** + quoi faire                    | ✅   | **12** diagnostics, un test par cas, panne **et** sain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 9   | Déploiement **sans écran** : `--non-interactive` + env + codes de sortie | ✅   | `examples/deploiement-sans-ecran.sh` + `tests/deploiement-sans-ecran.test.ts` (8 tests). L'exemple **traite chaque code séparément** — un `\|\| exit 1` aplatirait sept situations en une, et les codes ne serviraient plus à rien. Le test lance le VRAI script par `sh`, contre un faux `install:hive` qui rend le code voulu. Loupe : **7 mutants, 7 morts**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10  | README **FR et EN** + `CHANGELOG.md` à jour                              | ✅   | Les trois existent et sont tenus. **Cette ligne a été FAUSSE un temps** : elle affichait ✅ pendant que six fonctionnalités livrées (Cerveau, contre-expertise, `hive mode`, image, sauvegarde, désinstallation) manquaient au CHANGELOG. Un fichier d'état qui se coche lui-même est le premier à dériver — corrigé, et noté ici pour que la prochaine relecture s'en méfie. **Puis fausse une SECONDE fois, autrement** : le CHANGELOG était bien « à jour », et un cinquième de son contenu y figurait **trois fois** — dont une copie tombée dans la section `[0.2.0]`, déjà publiée. « À jour » ne veut pas dire « juste ». Le défaut a grossi huit livraisons durant sans qu'aucune relecture le voie, parce qu'une duplication est invisible dans un diff. Ce n'est plus une ligne d'état qui garde ce critère, c'est `tests/documents-qui-grossissent.test.ts`. |

**Les dix critères sont tenus.** Ce qu'il reste à leur reprocher est écrit sous
le tableau plutôt que caché derrière un ✅ : le banc du critère 1 n'est pas une
VM vierge, et `install.sh` ne construit pas le dashboard — « ruche qui tourne »
n'est pas « ruche qu'on peut regarder ».

---

## La mesure des critères 1 et 2 — ce qu'elle a coûté et ce qu'elle a trouvé

> Elle était la dernière ligne ⛔ du carnet, repoussée cinq lots durant. Ce
> qu'elle a rapporté n'est pas un chiffre : ce sont **trois défauts que
> personne ne pouvait voir en relisant**, parce qu'ils vivaient entre deux
> fichiers que rien ne regardait ensemble.

### Le banc — parce qu'un chiffre porte les réglages de son banc

Conteneur Linux, **Node v24.18.0**, `node_modules` déjà présent, dépôt local,
lien réseau rapide, cache npm chaud. **Ce n'est pas « une VM Windows 11 vierge »
et il ne faut pas le lire comme telle.**

La commande qui compte les décisions — reproductible, et c'est tout son
intérêt :

```sh
printf '\r\r\r\r\r\r' | script -qec "npx tsx src/installer-main.ts" /dev/null
```

Un vrai pseudo-terminal est indispensable : sans lui `caps.interactif` est
faux, l'installeur ne pose AUCUNE question, et on mesurerait zéro.

### Critère 1 — les décisions : 4 avant, 3 après

L'installeur s'arrêtait **quatre** fois. La quatrième était « Ne rien changer /
Poser ces réglages », posée sur un `.env` qu'il venait lui-même de créer trois
secondes plus tôt — et son défaut, `Ne rien changer`, **jetait le choix
d'exposition fait à l'écran précédent**. Valider trois fois au ⏎ donnait donc
une ruche configurée à moitié, sans que rien ne le signale autrement qu'un
« Rien écrit. ».

La confirmation n'a pas été supprimée : elle reste ENTIÈRE dès que le plan
**ouvre la machine** (`planOuvre`). Le prédicat regarde le plan et non
l'étiquette du choix, parce qu'un tunnel Cloudflare et un reverse proxy laissent
`HIVE_HOST` sur `127.0.0.1` **et rendent pourtant la ruche joignable depuis
Internet**.

| chemin                                  | décisions | confirmation avant écriture |
| --------------------------------------- | --------- | --------------------------- |
| `.env` neuf, « rien que cette machine » | **3**     | non — rien ne s'ouvre       |
| `.env` neuf, « mon réseau local »       | 4         | **oui** — `0.0.0.0`         |
| `.env` neuf, tunnel / reverse proxy     | 4 ou 5    | **oui** — joignable         |
| relance sur un `.env` existant          | 4         | **oui** — fichier d'autrui  |

Les trois décisions du chemin par défaut sont : le chemin d'entrée,
l'exposition réseau, le nom du premier projet. Nommer un projet en ajoute une
quatrième (son dépôt git) — mais nommer un projet, c'est déjà dépasser
« machine nue → ruche qui tourne ».

### Critère 2 — le temps : ≈ 2,5 s pour 60 s de budget

Trois exécutions chacune, mêmes conditions :

| étape                                     | mesuré                | compte ? |
| ----------------------------------------- | --------------------- | -------- |
| `install.sh`, prérequis                   | 76 ms                 | oui      |
| `git clone --depth 1`                     | 960 · 962 · 1067 ms   | oui      |
| l'installeur, `.env` neuf, non interactif | 955 · 1025 · 1232 ms  | oui      |
| l'installeur, interactif au ⏎, sous pty   | 1031 · 1035 · 1048 ms | oui      |
| `npm install` (283 paquets, cache chaud)  | **22 602 ms**         | **non**  |

**≈ 2,5 s** hors npm. Même en COMPTANT npm, on reste à ≈ 25 s : le critère
tient dans les deux lectures, avec une marge telle qu'une machine dix fois plus
lente passerait encore.

### Le critère 1, mesuré de bout en bout — enfin

La première tentative s'était arrêtée au prérequis : ce conteneur porte Node 22
et `install.sh` exige 24. Ce n'était pas un échec du script, c'était lui qui
faisait son travail — mais ça laissait la ligne non mesurée.

`npx node@24` fournit un binaire Node 24. Avec lui en tête de `PATH`, la
commande a été lancée pour de vrai, dans un dossier vide :

```sh
PATH="$N24:$PATH" HIVE_DIR=/tmp/vierge sh install.sh --non-interactive --json
```

| ce qui a été mesuré                           | résultat                       |
| --------------------------------------------- | ------------------------------ |
| durée totale, une seule commande              | **23 313 ms**                  |
| dont `npm install` (283 paquets)              | ≈ 20 000 ms — **hors critère** |
| **le reste** (prérequis + clone + installeur) | **≈ 3,3 s**                    |
| code de sortie                                | **0**                          |
| `.env`                                        | créé, 8 clés, permissions 600  |
| décisions posées                              | **0** (`--non-interactive`)    |

**Et la ruche installée est VIVANTE**, ce qui est la moitié du critère qu'un
code de sortie ne prouve pas : `better-sqlite3` et `fastify` se chargent dans
le clone — c'est-à-dire que la panne de l'image morte ne s'y produit pas — et
`hive doctor` rend **10 ✔** sur douze diagnostics.

#### Les deux points que le doctor soulève, et qu'il faut dire

```
⚠ dashboard   tableau de bord non construit — la ruche tourne, mais sans écran
? websocket   ruche éteinte — le WebSocket n'a pas pu être essayé
```

Le second est normal : on n'a pas démarré la ruche. **Le premier est un vrai
constat.** `install.sh` ne construit pas le dashboard ; après « une commande »,
la ruche tourne et n'a pas d'écran. Le `npm run build:dashboard` coûte ≈ 1 s,
et l'installeur le donne dans ses prochaines étapes — c'est donc documenté, pas
caché. Reste que « ruche qui tourne » et « ruche qu'on peut regarder » ne sont
pas la même chose, et que le doctor a raison de le signaler. **Changer ça est
une décision sur le produit, pas sur la mesure** : elle n'est pas prise ici.

#### Ce que ce banc n'est pas

Ce conteneur avait déjà `git`, `npm`, et un Node 24 fourni par `npx`. Ce n'est
donc pas « une VM Windows 11 vierge » — le carnet le disait déjà, et ça reste
vrai. Ce qui a changé : la commande a été **lancée**, du début à la fin, et son
résultat vérifié autrement que par son code de sortie.

### Ce que la mesure a trouvé, et que personne ne cherchait

1. **Le plancher de Node était écrit SIX fois, et deux copies mentaient.**
   `src/installer.ts` déclarait `NODE_MIN = 20` sous un commentaire affirmant
   « telle que le `package.json` la déclare » — alors que le paquet,
   `NODE_MINIMUM`, `install.sh` et `install.ps1` disent tous 24. Conséquence,
   vue en lançant les DEUX portes d'entrée sur la même machine (Node 22) :
   `sh install.sh` refuse avec le code 2, `npm run install:hive` répond
   « ✔ Node v22.22.2 (20 minimum) », écrit le `.env` et invite à démarrer. Une
   installation « réussie » sur une machine où `better-sqlite3` n'a pas de
   binaire prébuilt — **la panne de l'image morte, atteinte par l'autre porte.**
   La garde existait et s'intitulait « en quatre endroits » : elle en comptait
   quatre sur six.
2. **La sixième copie était la commande de secours affichée** : « nvm install
   20 », c'est-à-dire la commande exacte pour rester bloqué, donnée à la seule
   personne qui la copiera.
3. **Le CORS proposé interdisait l'adresse que l'écran suivant annonce.** Le
   plan « locale » posait `HIVE_CORS_ORIGIN=http://localhost:7777` — le
   dashboard compilé — pendant que l'installeur écrit deux écrans plus loin
   « `npm run dev:dashboard` (puis `http://localhost:5173`) ». Qui répondait
   « Poser ces réglages » ouvrait Mission Control sur un écran vide, sans même
   un message d'erreur. Les deux écrans avaient raison séparément ; c'est leur
   **désaccord** qui était le défaut, et aucun test ne pouvait le voir puisque
   aucun ne les regardait ensemble.

### Le câblage était sans garde. Il ne l'est plus.

Cette section disait, quelques heures durant :

> Le câblage de la troisième décision — `!neuf || planOuvre(plan)` — n'est tenu
> par aucun test […] et le jour où quelqu'un touche à cette ligne, rien ne
> rougira.

C'était vrai, et c'était la bonne façon de le dire — mais une dette écrite
reste une dette. La cause n'était pas la difficulté : c'était que le déroulé
vivait dans `installer-main.ts`, **qui appelle `main()` à l'import**. Aucun test
ne pouvait l'atteindre sans sonder des ports, écrire un `.env` et poser des
questions au vide. C'est exactement pour ça qu'une quatrième décision avait pu
s'y installer sans que rien ne rougisse.

Le déroulé vit désormais dans `src/installer-assistant.ts`, avec l'écriture du
`.env` **injectée**. Le point d'entrée n'a pas changé — il lance toujours
l'installeur à l'import, et c'est très bien pour un point d'entrée. Ce qui a
changé, c'est qu'un test peut jouer le déroulé RÉEL avec un faux clavier :
`tests/installer-assistant.test.ts`, 8 tests, qui **compte les arrêts** au lieu
de les mesurer une fois à la main.

Loupe sur ce câblage : **8 mutants, 8 morts** — dont « la confirmation revient
toujours », qui est l'état exact du code avant la mesure, et qui fait rougir
3 tests.

Ce que le test ne couvre toujours pas : les deux décisions que
`installer-main.ts` pose lui-même (le chemin d'entrée, la confirmation
d'écriture sur un `.env` existant), et l'enchaînement complet. Ils restent
vérifiés à la main, sous pty, avec la commande écrite plus haut — et le tableau
des quatre chemins a été rejoué après l'extraction, à l'identique.

---

## Les 11 lots

| #   | Lot                                                                  | État | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Plan + ADR de cadrage                                                | ✅   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1   | `src/tui/rendu.ts` pur + tests de rendu                              | ✅   | 42 tests, aucune I/O.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | `terminal.ts` + installeur interactif                                | ✅   | Chemin A (Reine locale).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Chemin B (billet) branché sur `join.ts`                              | ✅   | Un ami rejoint sans éditer un fichier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | Mode non-interactif, drapeaux, codes de sortie, `--dry-run`          | 🟡   | Implémenté et testé (`tests/args.test.ts`) ; pas de script reproductible dans `examples/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | `hive doctor` + `--json`                                             | ✅   | 12 diagnostics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6   | ACL Windows, chemins, **matrice CI 3 OS**                            | ✅   | Les trois vertes. macOS est passée **du premier coup** — ma prédiction de rouge était fausse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Paquet npm + `bin` + provenance                                      | 🚫   | **Bloqué** — compte npm de l'utilisateur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8   | `install.ps1`, `install.sh`, empreintes, Release                     | 🟡   | Les deux existent et sont exercés en CI — `install.ps1` sous PowerShell **7 et 5.1**, qui a rendu trois défauts réels. Empreintes + Release restent à faire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | Service (systemd user / tâche planifiée / launchd) + désinstallation | 🟡   | **Les deux moitiés livrées.** `hive desinstaller` (inventaire par défaut, `.env` et base jamais touchés) et `hive service install\|status\|logs\|uninstall` — unité systemd durcie, LaunchAgent, tâche planifiée, plan pur vérifié pour les 3 plateformes depuis n'importe laquelle, échappement éprouvé sur chemins hostiles. **Reste 🟡 et non ✅ : aucune CI ne peut vérifier que `systemctl`/`launchctl`/`schtasks` ACCEPTENT ces fichiers.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | Dockerfile, compose, GHCR signé, sauvegarde SQLite                   | 🟡   | Dockerfile, compose et sauvegarde livrés. **La première construction réelle a rendu un défaut que rien d'autre n'aurait vu** : `npm ci` lance `prepare` — donc `tsc` — aux deux étages, y compris celui qui vient de retirer TypeScript (§ 4.3 de `docs/ERREURS.md`). GHCR/cosign restent **bloqués**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | Docs FR/EN, CHANGELOG, `docs/INSTALLATION.md`                        | ✅   | READMEs, CHANGELOG et `docs/INSTALLATION.md` — les trois présents et tenus. Les deux READMEs ont été **resserrés** : le détail exhaustif vit dans `docs/FONCTIONNALITES.md` et `docs/FEATURES.en.md`, rien n'a été perdu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 12  | **Le Cerveau** — le savoir qui survit à la fenêtre de contexte       | ✅   | **La boucle est fermée, et un test la parcourt en entier.** `tests/cerveau-wiring.test.ts` monte une vraie ruche, laisse une tâche échouer, et vérifie que l'épisode **écrit par la ruche elle-même** revient dans le contexte de la tâche SUIVANTE. Mutation jouée : couper l'écriture rougit le test. La même panne incrémente UNE note (identifiant dérivé de `signatureEchec`), la consolidation est **proposée** à 3 récurrences et jamais rédigée — une règle fausse est SUIVIE —, `elaguer()` tourne à l'heure, et `cerveau_refus` dit quand une ouvrière part sans ses invariants. 62 tests, la loupe ne voit rien de nu. Ce qui reste est du confort, pas du câblage : aucune vue au tableau de bord, et la promotion en leçon se fait à la main dans Obsidian.                                                                                                                                                                  |
| 13  | La contre-expertise : une IA relue par une AUTRE                     | ✅   | La critique ATTEINT désormais l'autre modèle. `tests/cerveau-wiring.test.ts` monte deux nœuds de modèles différents, fait produire le premier, et vérifie que le second reçoit une `assign_task` portant la consigne de critique — puis que son verdict remonte en `contre_expertise_verdict`. **Cette ligne est restée 🟡 deux PR durant**, avec un module complet et personne pour l'appeler ; elle ne passe ✅ que maintenant, parce qu'un test l'exerce de bout en bout. Le plafond d'attente du test est à 3 s À DESSEIN : le filet `staleAssignedTasks(5_000)` rattrape une tâche muette et rendrait le test vert même sans dispatch — mesuré, 7 ms par le dispatch contre 5 060 ms par le filet. Un plafond qui ne discrimine pas ne mesure rien. Le verdict ne bloque JAMAIS la fusion : « jamais de fusion sans revue humaine » reste la règle, et une contre-expertise qui déciderait remplacerait la revue au lieu de l'armer. |

Légende — ✅ tenu et vérifié · 🟡 partiel · ⛔ à faire · 🚫 bloqué hors de mon
périmètre (comptes de l'utilisateur).

---

## Ordre de travail retenu, et pourquoi

1. **macOS dans la CI.** Meilleur rapport valeur/effort de la liste : une ligne
   de matrice, et c'est la plateforme où `launchd`, les chemins et les
   permissions diffèrent. La CI Windows a rendu **cinq défauts réels dont une
   perte de données** en s'ouvrant ; il n'y a aucune raison que macOS soit
   différent. Et ça débloque le lot 9 (launchd), qu'on écrirait à l'aveugle
   sinon.
2. **`install.sh` + `install.ps1` + `docs/INSTALLATION.md`.** C'est la promesse
   d'entrée — « une commande » — et elle n'est pas tenue. Sans eux, les critères
   1 et 2 sont invérifiables, pas seulement non vérifiés.
3. **Désinstallation + service.** Installer sans pouvoir désinstaller
   proprement, c'est ce qui fait qu'on n'essaie pas un outil. La désinstallation
   passe **avant** le service : elle est plus rassurante et plus simple à
   garantir.
4. **Dockerfile + compose + sauvegarde SQLite.** Faisable malgré le blocage
   GHCR. `docker compose up` doit marcher.
5. **Mesurer les critères 1 et 2.** ✅ **Fait.** En dernier, parce que ça n'a de
   sens qu'une fois l'installeur en place — et alors c'est une mesure, pas une
   affirmation. Ce qu'on n'avait pas prévu, c'est qu'elle rapporterait trois
   défauts au lieu d'un chiffre : **mesurer, c'est lancer, et lancer trouve ce
   que relire ne trouve pas.**

---

## Ce qui restera hors d'atteinte, et qu'il faut dire

- **Lot 7 (npm)** et **la partie GHCR/cosign du lot 10** dépendent de comptes
  qui ne sont pas les miens. Le code peut être prêt ; la publication non.
- **Le critère 1 mesuré « sur VM propre Windows 11 + Ubuntu 24.04 »** au sens
  strict demande deux machines vierges. Ce qu'on peut faire ici : mesurer dans
  un conteneur propre, et **dire** que ce n'est pas la même chose.

---

## Dette connue, assumée, non bloquante

- Cinq lectures trient sur un horodatage seul (`listPartages`,
  `listLivraisons`, billets d'invitation, clés de nœud, sessions de conseil) :
  l'ordre entre deux lignes de même milliseconde est indéfini. **Rien ne se
  perd** — c'est un rang d'affichage. Les trois bornes qui SUPPRIMENT ont été
  départagées, et c'était la seule classe dangereuse.
- Un agent installé par npm reste **indétectable sous Windows** (`claude.cmd`,
  que `spawn` ne peut pas lancer sans interpréteur). `hive doctor` le dit sous
  la clé `agent`, donc ce n'est pas silencieux — mais ce n'est pas satisfaisant.
  Corriger demanderait de lancer autre chose que le shim, ce que la contrainte
  §5.1 rend délibérément difficile.
