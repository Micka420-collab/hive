# Journal des erreurs

> Ce fichier n'existe pas pour battre sa coulpe. Il existe parce que **les mêmes
> erreurs reviennent**, et qu'une erreur écrite avec sa cause profonde coûte
> moins cher la deuxième fois.
>
> Chaque entrée porte : ce qui s'est passé, **pourquoi ça a échappé à la
> relecture**, et la règle qui l'empêche de revenir. Les entrées sans règle
> applicable n'ont rien à faire ici.
>
> Ordre : par leçon, pas par chronologie. On ne relit pas un journal de bord.

---

## 1. Ce qui n'est pas EXÉCUTÉ n'est pas vérifié

### 1.0 — Toute la vitrine était morte, et quarante-cinq tests étaient verts

C'est l'entrée la plus coûteuse du journal, parce qu'elle réunit tout le reste
en un seul fait mesuré. À un mois de la sortie, la page publique du projet
portait ceci dans son dictionnaire anglais :

```js
'mc.12.d':
'mc.13.t': 'h · Works',
```

`mc.12.d` avait perdu sa valeur — mangée par une retouche, sa vraie valeur
échouée vingt lignes plus bas en orpheline. L'analyseur lisait donc
`'mc.12.d': 'mc.13.t'`, puis butait sur le `:` suivant :

```
Uncaught SyntaxError: Unexpected token ':'
```

**Un script qui ne s'analyse pas ne s'exécute pas du tout.** Pas « en partie »,
pas « sauf l'anglais » : rien, depuis la première ligne. En ligne, cela voulait
dire le basculement FR/EN mort, le bouton « copier » mort, le journal de
l'essaim vide, le décalage des ancres jamais appliqué. Sur la page que les
visiteurs voient en premier.

**Et quarante-cinq tests de vitrine étaient verts.** Mesuré, pas supposé — en
remettant la corruption puis en relançant les deux suites sur le même fichier :

```
tests/vitrine-executee.test.ts   6 échecs sur 7
tests/site.test.ts + fraicheur   45 passés sur 45
```

Il y avait même, parmi eux, une garde nommée « chaque clé du HTML a une
traduction anglaise ». Elle passait : sa régulière trouvait bien `'mc.12.d':`
dans le fichier. **Elle cherchait une CLÉ ; il manquait une VALEUR.** Tous ces
tests lisaient le HTML comme du texte ; aucun ne l'exécutait.

Le remède n'est pas un test de plus au même endroit, c'est un test d'une autre
NATURE — `tests/vitrine-executee.test.ts` :

1. il **compile** chaque `<script>` que le navigateur exécuterait (`new Function`,
   déterministe, sans navigateur — c'est la ligne qui aurait mordu) ;
2. il **évalue** le dictionnaire au lieu de le lire, ce qui rend une clé sans
   valeur impossible à confondre avec une traduction ;
3. il **monte la page et clique**, parce qu'un script qui s'analyse peut encore
   ne rien faire.

Deux détails valent d'être notés, parce qu'ils ont failli coûter le test
lui-même. Le bloc `type="application/ld+json"` n'est PAS exécuté par le
navigateur : le compiler échouerait à tous les coups, et on aurait désarmé la
garde entière pour la faire passer. Et la première version affirmait « au
départ la page est en français » — elle a rougi aussitôt, parce que la page suit
la langue du navigateur et que `happy-dom` démarre en anglais, comme Chromium :
l'assertion aurait été fausse chez la moitié des visiteurs réels.

> **Règle** — un fichier livré qui contient du code EXÉCUTABLE se fait exécuter
> par au moins un test. Une vitrine, un gabarit, un script d'installation : la
> question n'est pas « le texte est-il correct ? » mais « qu'est-ce qui se passe
> quand ça tourne ? ».
>
> **Règle** — une garde qui cherche par régulière ne prouve QUE la présence
> d'un motif. Pour prouver la validité d'une structure, il faut l'ANALYSER :
> `new Function`, `JSON.parse`, un vrai analyseur. La régulière voit la clé, pas
> la valeur.
>
> **Règle** — le nombre de tests verts ne mesure rien s'ils partagent tous le
> même angle mort. Quarante-cinq lectures ne valent pas une exécution.

### 1.1 — `require()` dans un module ESM : silencieux pour toujours

`baseIntegre()` appelait `require('better-sqlite3')` dans un fichier ESM.
`require` n'y existe pas : l'appel levait une `ReferenceError`, le `try`
l'attrapait, la fonction rendait `null` — **à chaque fois, sur toute machine**.

`hive doctor` affichait « intégrité non vérifiable (fichier verrouillé ?) » sur
une base parfaitement lisible. Un docteur définitivement aveugle sur un point,
qui le dit d'un ton mesuré.

**Pourquoi la relecture ne l'a pas vu** : le code se lit juste. `null` est une
réponse LÉGITIME de cette fonction, et le verdict qui en découle a l'air
réfléchi.

> **Règle** — une commande qui rend un diagnostic se LANCE avant d'être livrée.
> `npm run cli -- doctor` a trouvé en une seconde ce que trois relectures
> n'avaient pas vu.

### 1.2 — Une garde de sécurité désactivée partout, suite verte

`it.runIf(drapeau)` s'évalue à la **collecte**, avant que `beforeAll` n'ait
tourné. La sonde était posée dans `beforeAll` : le drapeau valait donc toujours
`false`, et les trois tests d'évasion par lien symbolique du miroir étaient
silencieusement désactivés **sur toutes les plateformes, Linux compris**.

**Ce qui l'a attrapé** : le compte est passé de « 17 réussis » à « 17 ignorés ».
Rien d'autre. Aucun rouge.

> **Règle** — toute sonde qui pilote `it.runIf` se fait **au chargement du
> module**, et un test EXIGE qu'elle réussisse là où elle le doit
> (`expect(sonde).toBe(true)` sur POSIX). Une garde qu'on croit tenue et qui ne
> tourne nulle part est pire que pas de garde.
>
> **Règle** — après un changement touchant des `skip`/`runIf`, comparer le
> nombre de tests EXÉCUTÉS, pas seulement le vert.

### 1.4 — Une garde qui ne connaît qu'une des deux API `fs`

La garde de `tests/empreinte.test.ts` relève les appels d'écriture de `src/` et
les compare à une liste déclarée. Première version : uniquement les noms en
`…Sync`. Elle a donc affirmé que `src/orchestrator/miroir.ts` **n'écrivait
pas** — alors qu'il fait `await fs.mkdir(...)`, l'API à promesses, importée en
`import { promises as fs } from 'node:fs'`.

Ce qui l'a montré : le désaccord entre la garde et l'inventaire fait à la main
juste avant. Sans cet inventaire, la garde aurait été verte et fausse.

Une garde qui rate une famille entière d'appels est **pire que rien** : elle
donne la confiance d'un vert là où il n'y a pas de couverture.

> **Règle** — une garde qui relève des appels doit couvrir **toutes** les
> formes de l'API visée. Pour `fs` : les `…Sync`, et les membres d'un objet
> `fs`/`fsp`/`promises`. Le préfixe est exigé côté promesses, sinon un `rm(`
> ou un `cp(` nus attrapent n'importe quelle méthode du dépôt.
>
> **Règle** — avant d'écrire une garde automatique, faire l'inventaire À LA
> MAIN une fois. Le désaccord entre les deux est le seul signal disponible ;
> sans lui, une garde incomplète est indiscernable d'une garde satisfaite.

### 1.3 — Un pas vert n'atteste que du code de sortie

Le pas de CI qui lance `install.sh --dry-run` est passé au vert du premier
coup. Il affichait ceci :

```
    cd …/essai-hive && npm run install:hive --dry-run
```

C'est la ligne « voilà ce qui se passerait sans `--dry-run` ». Elle est
**fausse deux fois**. Le vrai appel est `npm run install:hive -- --dry-run` :
sans le `--`, npm garde le drapeau POUR LUI — et `--dry-run` en est un vrai,
côté npm. La commande copiée depuis cet écran ne lançait donc pas l'installeur
du tout. Et elle contenait `--dry-run`, le drapeau dont la phrase dit
précisément qu'on s'en passe.

Le script sortait en 0, donc la CI était verte, donc personne ne regardait.
Ce qui l'a trouvé : **lire le journal d'un run réussi.**

En creusant, un troisième défaut sous les deux premiers — `--dry-run` était
ajouté à la liste transmise à l'installeur alors que le script s'arrête avant
lui. La branche « aucun argument à transmettre » était donc **inatteignable**,
et le test que j'écrivais pour elle a rougi en la révélant.

> **Règle** — un pas de CI dont la sortie est destinée à un humain doit être
> LU au moins une fois, run vert compris. Le code de sortie ne dit rien du
> contenu.
>
> **Règle** — toute ligne qui annonce une commande doit être **dérivée** de
> l'appel réel, jamais écrite pour lui ressembler. À défaut, un test compare
> les deux (`installeurs.test.ts`, « la commande qu'il affiche est celle qu'il
> lancerait »).

### 1.5 — Un `npm ci` vert peut avoir installé MOINS que le lock

Deux constructions de l'image, **même `Dockerfile`, même `package-lock.json`**,
à quatre minutes d'intervalle :

    a8f8909  06:05  image construite, ruche démarrée        vert
    a3ceec0  06:10  image construite, ruche morte au boot   rouge

    etat : Exited (2)
    ✘ L'orchestrateur ne peut pas démarrer : better-sqlite3 est absent.

Le second commit ne touche **que deux fichiers Markdown**. Aucune ligne de code
ne sépare ces deux images : la différence est venue du réseau.

Les quatre dépendances dont la ruche a besoin pour démarrer — Fastify, ses deux
greffons, `better-sqlite3` — sont déclarées **optionnelles**, et c'est délibéré :
un nœud membre, qui ne fait que prêter du temps-machine, n'en a pas l'usage.
Mais « optionnel » veut dire, pour npm : **si l'installation échoue, je
continue**. `better-sqlite3` porte un script qui télécharge un binaire prébuilt ;
quand ce téléchargement rate, `prebuild-install` se rabat sur une compilation,
qui réclame python3/make/g++ — absents de `slim`, et absents exprès. npm affiche
un avertissement, retire le paquet, **et sort avec 0**.

C'est la panne du § 4.3 atteinte par une cause que personne n'a écrite. Là-bas,
un drapeau de trop la provoquait, et le corriger suffisait. Ici, le fichier est
juste, et l'aléa suffit — donc aucune relecture de code ne l'aurait trouvée.

Ce qui rend la reprise particulière : **elle ne peut pas s'appuyer sur le code de
sortie**, puisqu'il vaut 0 précisément dans le cas qu'on veut rattraper. Elle
s'appuie donc sur une vérification. Mesuré au shell avant d'écrire la boucle :

| tentatives nécessaires | tentatives consommées | code de sortie de la boucle |
| ---------------------- | --------------------- | --------------------------- |
| 1                      | 1                     | 0                           |
| 3                      | 3                     | 0                           |
| plus que 3             | 3 (plafond)           | **0**                       |

La dernière ligne est celle qui compte : **une boucle `for … done` sort avec 0
même quand toutes ses tentatives ont échoué.** Une vérification placée à
l'intérieur ne fait donc rougir personne — c'est celle qui suit le `done`, en
`&&`, qui décide. Et elle doit vivre dans la **même couche** que l'installation :
séparée, Docker mettrait en cache une couche cassée et ne la revérifierait
jamais.

> **Règle** — `npm ci` vert ne prouve pas que le lock est installé. Une
> dépendance optionnelle absente est un succès pour npm et une panne pour le
> programme. Tout artefact qui embarque une dépendance optionnelle **nécessaire**
> doit la CHARGER à la construction, dans la couche qui l'installe.
>
> **Règle** — une vérification ne vaut que par ce qu'elle peut faire échouer.
> Avant de l'écrire, demander : _où est-elle branchée, et qu'est-ce qui rougit si
> elle échoue ?_

**Ce qui le garde** : trois tests dans `tests/conteneur.test.ts`. Et la loupe a
pris le premier en défaut avant qu'il ne serve : il cherchait les `require` dans
la couche entière, or la sonde de la boucle cite les mêmes paquets — retirer
`@fastify/static` de la vérification finale laissait les 24 tests verts. Ce
n'était pas qu'un test faible, c'était le trou lui-même : un paquet vérifié
seulement dans la boucle épuise les trois tentatives, puis passe. La garde
n'interroge donc plus que ce qui suit le `done`.

---

### 1.6 — « Mesurer », ça veut dire LANCER. Repoussé cinq lots, ça a rendu trois défauts

Le critère « ≤ 3 décisions, < 60 s » était la dernière ligne ⛔ du carnet. Elle
y était depuis cinq lots, avec une note qui expliquait comment la lever :
« l'installeur a `--timings`, personne ne l'a mesuré ». **`--timings` n'existe
pas.** L'installeur ne déclare que `--yes`, `--dry-run`, `--non-interactive`,
`--json`, `--help`. Une note qui invente l'outil de sa propre mesure est le
meilleur indice possible qu'elle n'a jamais été faite.

La mesure a fini par être faite — un pseudo-terminal, six `⏎`, un chronomètre.
Le chiffre attendu était l'accessoire ; ce qui est sorti, ce sont trois défauts
que **relire ne pouvait pas trouver** :

1. **Les deux portes d'entrée du projet ne parlaient pas de la même machine.**
   Sur ce conteneur (Node 22) : `sh install.sh` refuse avec le code 2, « Hive
   exige 24 ou plus » ; `npm run install:hive` répond « ✔ Node v22.22.2
   (20 minimum) », écrit le `.env` et invite à démarrer. Le second délivrait une
   installation « réussie » sur une machine où `better-sqlite3` n'a pas de
   binaire prébuilt — la panne de l'image morte (§ 1.5), atteinte par l'autre
   porte.
2. **La commande de secours affichée envoyait vers la version périmée** :
   « nvm install 20 », donnée à la seule personne qui la copiera, et qui la
   laissera exactement où elle était.
3. **L'installeur posait QUATRE questions là où il en promet trois** — et la
   quatrième avait pour défaut de jeter la réponse à la troisième.

Aucun des trois n'était visible dans un diff. Tous les trois sautent aux yeux
en dix secondes d'exécution.

> **Règle** — une ligne d'état qui dit « à mesurer » ne se lève pas en relisant
> le code : elle se lève en **lançant le programme comme un utilisateur le
> lance**, et en écrivant le chiffre AVEC les réglages du banc. Et quand la note
> qui explique comment mesurer cite un outil, **vérifier d'abord que l'outil
> existe** — s'il n'existe pas, personne n'a jamais mesuré, et tout ce que la
> ligne affirme est à reprendre de zéro.

> **Corollaire** — pour mesurer une interface interactive, il faut un **vrai
> pseudo-terminal** (`script -qec "…" /dev/null`). Un tuyau met `caps.interactif`
> à faux : le programme ne pose aucune question, et on mesure zéro décision en
> croyant en mesurer trois.

### 1.7 — La CI exerçait le script ; jamais la phrase qui dit comment l'appeler

Quatre documents — README, README anglais, `docs/INSTALLATION.md`, et l'en-tête
d'`install.ps1` lui-même — annonçaient la commande d'installation Windows :

```powershell
irm https://…/install.ps1 | iex
```

**Elle ne pouvait marcher sur aucune machine.** Un utilisateur l'a lancée et a
renvoyé la trace :

```
iex : Au caractère Ligne:53 : 1
+ [CmdletBinding()]
Attribut inattendu « CmdletBinding ».
+ param(
Jeton inattendu « param » dans l'expression ou l'instruction.
```

`iex` évalue une **expression** ; `param()` et `[CmdletBinding()]` ne sont
valides qu'au début d'un **script**. Le `ParserError` tombe à la ligne du
`param`, systématiquement, partout.

Un second défaut, indépendant, que corriger le premier n'aurait pas réglé :
`install.ps1` appelle `exit` **sept fois**. Dans un `iex`, `exit` s'évalue au
niveau de la SESSION — il ferme la fenêtre. Les sept codes de sortie, qui sont
toute l'interface de ce script (critère 9 : un déploiement sans écran doit
pouvoir les aiguiller), deviendraient inobservables. Lancé comme un fichier,
`exit` termine le script et pose `$LASTEXITCODE`.

**Et pendant tout ce temps la CI était verte.** Elle lançait `install.ps1` par
`-File`, sous PowerShell 5.1 **et** 7, avec des assertions sur l'encodage, le
mojibake, le BOM. Trois pas soignés — sur le script.

> Le script était juste. La phrase qui disait comment l'appeler ne l'était pas,
> et rien ne regardait l'écart entre les deux.

Les deux étaient cohérents avec eux-mêmes et incohérents entre eux. C'est la
même forme que le shim `.cmd` (§ 6.2) et que le nœud qui simulait (§ 9 bis) : un
chemin que personne n'exécute et que tout le monde croit. Aucune suite verte ne
pouvait le montrer, parce que le défaut ne vivait pas dans le code.

> **Règle** — une commande écrite dans un README est une INTERFACE. Elle doit
> être exécutée par quelque chose, au caractère près, drapeaux compris. Exercer
> une invocation VOISINE ne prouve rien sur celle qu'on annonce — c'est
> exactement ce qui a laissé `| iex` vivre dans quatre documents.

> **Règle** — quand un script déclare `param()` ou appelle `exit`, il est fait
> pour être lancé comme un FICHIER. `irm | iex` ne convient qu'à un script sans
> paramètres et sans code de sortie à observer. Télécharger puis lancer
> (`-OutFile` puis `-NoProfile -ExecutionPolicy Bypass -File`) préserve les deux
> — et `-ExecutionPolicy Bypass` n'est pas une négligence : un `.ps1` sur le
> disque y est soumis, là où `iex` la contournait par construction.

`tests/commande-annoncee.test.ts` exige désormais que les quatre copies soient
identiques au caractère près, qu'aucune ne tuyaute dans `iex`, et que **la CI
porte les mêmes drapeaux que la doc**.

### 1.8 — Un remède appliqué à UN seul endroit, et le mauvais remède ensuite

Deux temps, le même essai, sur la machine d'un utilisateur.

**Premier temps.** L'installation Windows réussit, avec ceci au passage :

```
npm warn allow-scripts   better-sqlite3@12.11.1 (install: prebuild-install…)
```

npm ≥ 11.17 bloque les scripts d'installation par défaut. Le binaire natif
n'arrive donc pas — et `npm install` **sort avec 0**, parce que la dépendance est
optionnelle. L'installeur affichait « ✔ dépendances installées » pour une ruche
qui ne pouvait pas démarrer.

Ce qui rend ce défaut instructif : **le remède était déjà écrit.**
`examples/deploiement-sans-ecran.sh` chargeait déjà les deux modules, avec son
commentaire — « un code 0 dit que l'installeur n'a pas échoué, pas que la ruche
peut démarrer ». La leçon était apprise, écrite, appliquée — **à un seul
endroit, celui que personne ne traverse en installant.**

> **Règle** — quand on applique une leçon, chercher TOUS les endroits qui font la
> même promesse, et le garder par une assertion qui les CONFRONTE. Un remède
> posé sur un seul chemin donne le sentiment d'avoir traité le problème, ce qui
> est pire que de le savoir ouvert.

**Second temps, et c'est ma faute directe.** Le message que je venais d'écrire
conseillait `npm install`. Mesuré chez le même utilisateur, ça ne réparait rien :

```
Error: le module better_sqlite3.node a été compilé pour NODE_MODULE_VERSION 137.
Cette version de Node exige 147.
```

Le paquet **était là**, à la bonne version. C'est son binaire natif qui ne
correspondait pas à l'ABI du Node utilisé. **`npm install` ne touche pas à un
paquet déjà installé à la bonne version** : il rend 0, et la panne reste
entière. Seul `npm rebuild <paquet>` refait le binaire.

> **Règle** — un diagnostic juste avec un remède faux est plus coûteux qu'un
> silence : il consomme la confiance de celui qui le suit, et il l'occupe. Une
> commande de réparation doit être ÉPROUVÉE sur la panne qu'elle prétend régler,
> pas déduite de sa vraisemblance.

> **Règle** — `npm install` répare une ABSENCE, jamais une INCOMPATIBILITÉ. Deux
> causes mènent au même message (`allow-scripts` a bloqué la récupération ; le
> Node de la machine a changé), et `rebuild` est la seule commande qui les règle
> toutes les deux.

**Troisième temps, deux corrections plus tard.** Le message corrigé listait deux
commandes. La trace montre la première ne rien faire :

```
PS> npm approve-scripts --allow-scripts-pending
2 packages have install scripts not yet covered by allowScripts: …
Run `npm approve-scripts <pkg>` to allow…
```

`--allow-scripts-pending` **liste**, il n'autorise rien — il faudrait
`npm approve-scripts better-sqlite3`. Et la ligne suivante de la même trace
montre `npm rebuild better-sqlite3` réussissant **seul**, verrou toujours en
place : `rebuild` compile au lieu d'attendre le script d'installation.

> **Règle** — une commande qui ne fait rien, dans une liste de réparation, est
> pire qu'absente : c'est une occasion de plus de croire qu'on a essayé. Ne
> donner que le geste dont on a VU l'effet, et un seul quand un seul suffit.

Trois versions de ce message pour arriver à une commande juste. Ce qui a tranché
chaque fois n'est pas un raisonnement : c'est la trace brute d'une machine
réelle.

---

## 2. Un test peut passer pour la mauvaise raison

### 2.1 — Un comptage qui compense

Une assertion comptait `.pj-ouv-desc` sur toute la page. Sous mutation, une
ligne gagnait un span vide pendant qu'une autre en perdait un : **le total ne
bougeait pas**. Le test restait vert sur du code cassé.

> **Règle** — compter **par ligne**, jamais sur un agrégat qui peut se
> compenser.

### 2.2 — Une assertion de texte SQL satisfaite par le mauvais fragment

`expect(source.slice(i, i + 400)).toMatch(/etat = 'supprime'/)` restait vert
quand la condition du `DELETE` était retirée — parce que la **sous-requête**
contenait la même chaîne.

> **Règle** — pour une requête destructrice, ne pas asserter sur le TEXTE :
> exécuter la purge sur une vraie base et constater ce qui reste.

### 2.3 — Une garde sur la source que sa propre prose fait passer

Un test lisait `miroir.ts` pour vérifier que `GIT_TERMINAL_PROMPT=0` y est. Le
commentaire explicatif juste au-dessus contenait la même chaîne : la garde
passait grâce à sa propre documentation.

> **Règle** — toute assertion sur du code source **retire les commentaires
> d'abord** :
> `.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')`

**Récurrence, sur un fichier de CI cette fois** — et dans l'autre sens, ce qui
la rend plus instructive. `tests/conteneur.test.ts` lit trois fichiers ; j'avais
posé le retrait des commentaires sur le Dockerfile et le compose, **pas** sur
`ci.yml`. Les nouvelles gardes ont donc échoué sur ma propre prose : le
commentaire qui explique _pourquoi `--retry-connrefused` n'est plus là_ contient
`--retry-connrefused`.

Un échec est le cas heureux. Le même oubli, sur une garde formulée en positif,
serait passé **grâce** à l'explication — exactement le défaut d'origine.

> **Règle** — le retrait des commentaires vaut pour **tout** format lu comme du
> texte, pas seulement pour les sources du langage : YAML, Dockerfile, shell,
> `.ini`. En YAML comme en shell, une ligne commençant par `#` est un
> commentaire, et le même retrait les couvre tous les deux. Et quand un fichier
> de test lit plusieurs fichiers, ils passent **tous** par le même filtre — un
> seul nu et deux habillés est un piège qui attend.

**Le même défaut vu par l'autre bout : la garde qui ROUGIT sur son propre
commentaire.** J'ai écrit une garde qui relit `installer-main.ts` pour vérifier
qu'aucun `nvm install <version périmée>` n'y traîne. Elle a rougi
immédiatement — sur le commentaire que je venais d'écrire juste au-dessus du
correctif, et qui racontait le défaut en citant « nvm install 20 ».

Un échec est le cas heureux, comme ci-dessus. Mais il enseigne quelque chose de
plus : **un test qui rougit sur un commentaire est un test qu'on apprendra à
contourner** — on éditera la prose pour faire taire l'assertion, et le jour où
elle rougira pour la vraie raison, le réflexe sera le même.

La sortie n'était donc pas de filtrer mieux : c'était de **sortir le texte de la
zone illisible**. Le message de prérequis vit maintenant dans le module pur
(`messagePrerequisNode`), et la garde lit ce que le programme DIT, pas ce que sa
source contient.

> **Règle** — quand une garde doit relire une source, se demander d'abord
> pourquoi cette valeur n'est pas atteignable autrement. Neuf fois sur dix, la
> réponse est qu'elle est enfermée dans un fichier qui s'exécute à l'import — et
> **l'extraire dans le module pur coûte moins cher que le filtre, et vaut plus.**

### 2.8 — Un fichier qui s'exécute à l'import est un angle mort, pas un détail

`installer-main.ts` appelle `main()` à l'import. Conséquence directe : **rien de
ce qu'il contient n'est atteignable par un test** — l'importer sonderait des
ports, écrirait un `.env` et poserait des questions au vide.

Ce n'est pas resté théorique. Le déroulé de l'assistant y vivait, et c'est là
qu'une **quatrième décision** s'est installée sur un accueil qui en promet
trois, avec un défaut qui jetait la réponse à la troisième. Elle y est restée
jusqu'à ce que quelqu'un lance le programme avec un pseudo-terminal et compte
les arrêts à la main.

La tentation, à ce stade, est de rendre le point d'entrée importable — un garde
`if (argv[1] === import.meta.url)`. C'est le geste risqué : si la résolution
diffère (lien symbolique, enveloppe, chemin compilé), `main()` ne s'exécute
plus **en silence**, et c'est la porte d'entrée du projet qui devient un
no-op.

Le geste juste est l'inverse : **sortir le DÉROULÉ, laisser le lanceur**. Le
point d'entrée continue de s'exécuter à l'import — c'est son rôle — et ce qu'il
enchaînait devient un module ordinaire, avec ses effets injectés.

> **Règle** — un fichier qui s'exécute à l'import ne doit contenir QUE
> l'enchaînement : lire les arguments, appeler, écrire le code de sortie. Toute
> logique qui s'y trouve est hors de portée des tests **par construction**, et
> personne ne s'en apercevra avant qu'un défaut y ait vécu des mois. Quand on en
> découvre une, on l'extrait — on ne rend pas le lanceur importable.

### 2.3 bis — Le test passait grâce au message d'erreur qu'il ne visait pas

Un test de la contre-expertise devait prouver qu'une objection ne peut pas
fabriquer de faux retours à la ligne. Il donnait un texte contenant U+2028,
attendait **une** objection, et en trouvait bien une. Vert.

La loupe a refusé de le croire : en retirant `champSurUneLigne`, il restait vert.

Ce qu'il mesurait vraiment : le texte ne contenait ni « valide » ni « conteste »,
donc le verdict était **illisible**, donc la fonction rendait son message
« verdict illisible » — une CONSTANTE, sans U+2028. L'objection comptée était
celle-là. La ligne visée n'était même pas capturée.

Et sous ce test faible, un vrai défaut. En JavaScript, `.` ne traverse pas
U+2028 : avec `/^\s*[-*]\s+(.+)$/`, une objection contenant ce caractère ne
capturait **rien du tout**. Elle était perdue en silence — dans le seul module
du dépôt dont la raison d'être est de ne pas perdre d'objection.

En creusant encore, la cause commune : `champSurUneLigne`, le nettoyeur PARTAGÉ
du dépôt, ne connaissait que `\r`, `\n` et la tabulation. U+2028 (LINE
SEPARATOR) et U+2029 (PARAGRAPH SEPARATOR) le traversaient intacts, alors que ce
sont des retours à la ligne pour un terminal, un navigateur et la plupart des
rendus. Une fonction qui promet « sur une seule ligne » et laisse passer un
séparateur de ligne ne tient pas sa promesse — et le Cerveau, la Couveuse et la
contre-expertise s'appuyaient tous les trois dessus.

> **Règle** — quand un test attend UN élément, vérifier **lequel**. Un compte
> juste obtenu par le mauvais élément est un test qui ne gardera jamais rien.
> Ici, `toHaveLength(1)` était satisfait par un message d'erreur.
>
> **Règle** — un mutant qui refuse de mourir n'est pas une bizarrerie à
> contourner : c'est une question à laquelle il faut répondre. Les trois
> défauts ci-dessus sont sortis d'un seul mutant survivant.
>
> **Règle** — une garde sur les « retours à la ligne » couvre TOUS les
> séparateurs de ligne Unicode, pas seulement ceux du clavier :
> `\r \n \t \v \f U+0085 U+2028 U+2029`.

**Ce qui le garde** : huit tests dans `tests/security-invariants.test.ts`, un
par séparateur. Le mutant décisif est le retour à l'état d'avant — la classe
ramenée à `[\r\n\t]` fait tomber **exactement cinq** tests, soit les cinq
caractères ajoutés.

### 2.3 ter — Un filet de sécurité rendait le test vert sans le code testé

Trois tests devaient prouver la seule chose qui décide du lot 13 : **une
critique produite par un modèle atteint-elle vraiment l'autre ?** Ils montaient
deux nœuds, faisaient produire le premier, et attendaient que le second reçoive
la tâche de relecture. Verts du premier coup.

La loupe a coupé l'envoi — `envoyerTache` remplacé par un `void`. **Toujours
verts, les treize.**

La cause n'était ni dans le code ni dans l'assertion, mais dans le PLAFOND
D'ATTENTE. La ruche a un filet : `staleAssignedTasks(5_000)` re-livre toute
tâche assignée restée muette plus de cinq secondes — « message perdu en vol ».
La relecture était bien créée et posée sur le bon nœud ; sans dispatch, elle
partait quand même, cinq secondes plus tard, par le filet. Et le test attendait
huit secondes.

Mesuré, la même relecture sur la même ruche :

| chemin              | latence de la 1re livraison |
| ------------------- | --------------------------- |
| dispatch direct     | **7 ms**                    |
| filet de rattrapage | **5 060 ms**                |

Le plafond est passé à 3 s : quatre cents fois la latence réelle, et bien en
deçà du filet. Les trois tests tombent maintenant quand l'envoi est coupé.

> **Règle** — un test qui attend « jusqu'à ce que ça arrive » ne prouve rien
> tant qu'on n'a pas cherché **par quel autre chemin ça pourrait arriver**. Un
> système qui a des filets de reprise en a toujours un.
>
> **Règle** — quand un plafond d'attente sépare deux chemins possibles, il se
> CHOISIT par la mesure des deux, et le rapport s'écrit à côté. Un plafond qui
> ne discrimine pas ne mesure rien.

**Ce que ça a révélé au passage** : une tâche assignée jamais acquittée est
re-servie à chaque tick, le filet ne gardant aucune trace de ses tentatives.
Comportement PRÉ-EXISTANT, vérifié sur une tâche ordinaire sans rapport avec la
contre-expertise. Corrigé depuis — et il a fallu DEUX rectifications pour
décrire ce défaut correctement : voir le § 6bis.2, qui les raconte.

### 2.4 — Prétendre tester un chemin inatteignable

Un test passait `{ PATH: '' }` à `detectBestAgent` en croyant forcer le repli.
Or `env` ne sert **qu'à** lire `HIVE_AGENT_CMD` ; la sonde interroge le PATH
RÉEL du processus. Sur une machine où `claude` est installé — donc toute machine
de développement — la détection le trouvait toujours.

> **Règle** — quand un chemin n'est pas atteignable depuis un test, **ajouter la
> couture d'injection** plutôt que d'écrire une garde dégradée. Et si on pose un
> pis-aller, l'écrire comme tel et y revenir.

### 2.5 — Un test bloqué par une garde EN AMONT du comportement testé

Le test « `install.sh --dry-run` n'écrit rien » passait. Il n'observait rien :
la machine tourne sous le plancher de Node, donc le script sortait au contrôle
de version **avant** d'atteindre le clone. Le chemin `--dry-run` n'était jamais
parcouru.

Prouvé par mutation : en faisant cloner `--dry-run` de force, le test restait
**vert**.

C'est le même défaut que 2.4, et je l'ai commis **dans le test censé prévenir
ce défaut** — le jour même où je l'ai écrit dans ce fichier. La leçon n'est
donc pas « faire attention » : c'est que **la mutation est le seul juge**.

> **Règle** — quand un script comporte des gardes en amont (version, prérequis,
> présence d'un binaire), un test du comportement AVAL doit les franchir
> explicitement : `PATH` détourné vers un faux binaire, variable d'environnement,
> paramètre. Sinon on teste la garde, pas le comportement.
>
> **Règle** — muter systématiquement le comportement visé, pas seulement les
> lignes qu'on vient d'écrire. Un test vert sur un mutant est un test qui ne
> sert à rien, quelle que soit sa prose.

---

### 2.6 — Une assertion écrite en fonction de la constante qu'elle devrait vérifier est un MIROIR

`src/installer.ts` déclarait `export const NODE_MIN = 20;` — sous un
commentaire affirmant « telle que le `package.json` la déclare », alors que le
paquet dit 24, comme `NODE_MINIMUM`, `install.sh` et `install.ps1`. La valeur
était fausse depuis des mois. Quatre tests la couvraient :

```ts
expect(nodeSuffisant(`v${NODE_MIN}.0.0`)).toBe(true);
expect(nodeSuffisant(`v${NODE_MIN + 4}.11.1`)).toBe(true);
expect(nodeSuffisant(`v${NODE_MIN - 2}.9.0`)).toBe(false);
```

Ils sont verts pour `NODE_MIN = 20`. Ils sont verts pour 24. Ils sont verts
pour 3. Ils ne vérifient pas le plancher : ils vérifient que la comparaison est
une comparaison — ce qui est vrai par construction. **Un test écrit en fonction
de la valeur qu'il devrait contrôler ne peut pas la contredire.**

Et la garde qui aurait dû attraper la divergence s'intitulait « LE PLANCHER DE
NODE N'EXISTE QU'UNE FOIS — **en quatre endroits** ». Il y en avait **six**. Les
deux oubliés vivaient dans `src/` : typés, compilés, donc réputés sûrs — alors
que le typage ne dit rien d'un nombre. La garde surveillait consciencieusement
les deux scripts shell, précisément parce qu'ils sont hors de la compilation,
et laissait passer ce qui était sous son nez.

> **Règle** — une assertion sur une constante se formule avec une **valeur
> écrite en toutes lettres**, ou avec l'autre source de vérité, jamais avec
> la constante elle-même. `expect(NODE_MIN).toBe(NODE_MINIMUM)` vaut ; pas
> `nodeSuffisant(\`v${NODE_MIN}.0.0\`)`.

> **Règle** — une garde qui ÉNUMÈRE des copies doit les compter juste, et son
> titre porte le compte pour qu'il se relise. Mieux : faire que les copies
> n'existent pas. Celles qui vivent dans le même langage doivent être
> **importées**, pas relues — `NODE_MIN` vaut désormais `NODE_MINIMUM`, et il
> ne reste à surveiller que ce qui est vraiment hors d'atteinte du compilateur.

### 2.7 — Un défaut peut n'appartenir à AUCUN des deux fichiers

L'assistant proposait `HIVE_CORS_ORIGIN=http://localhost:7777` — l'origine par
laquelle l'orchestrateur sert le dashboard compilé. C'est juste. Deux écrans
plus loin, le même programme écrit « `npm run dev:dashboard` (puis
`http://localhost:5173`) ». C'est juste aussi.

Ensemble, c'est une panne : qui répondait « Poser ces réglages » — la réponse
affirmative, celle qu'on choisit quand on fait confiance au programme — sortait
avec un CORS qui **interdit l'adresse que l'écran suivant lui donne**. Et un
navigateur bloqué par CORS ne dit rien à l'utilisateur : Mission Control reste
vide, sans message.

Les deux fichiers avaient chacun raison. Aucun test ne pouvait voir le défaut,
parce qu'aucun ne les regardait **ensemble** — `assistant.test.ts` vérifiait
l'origine proposée, `installer.test.ts` vérifiait les prochaines étapes, et le
désaccord vivait entre les deux.

> **Règle** — quand deux modules produisent des textes que le même humain lira
> à la suite (une valeur posée puis l'adresse à ouvrir, un code d'erreur puis
> sa réparation), écrire une assertion qui les **confronte** : extraire
> l'adresse annoncée par l'un et vérifier qu'elle figure dans ce que l'autre
> autorise. Une valeur partagée devient alors une constante commune, et le test
> la relie à sa troisième source hors du langage (ici `dashboard/vite.config.ts`).

### 2.9 — Une garde nommée d'après UNE ressource ne couvre pas la suivante

`site.test.ts` portait « les fichiers de fonte référencés existent ». Sa
régulière était `url\('(fonts/[^']+\.woff2)'\)` : elle ne pouvait, par
construction, voir que des `.woff2` dans `fonts/`.

Le jour où le surlignage du titre est devenu un fichier (`site/miel.svg`), rien
ne vérifiait plus son existence. Le supprimer laissait la CI **entièrement
verte** et le titre nu — sur la seule page que voient les gens qui découvrent le
projet.

Le piège n'est pas dans la régulière : il est dans ce que son nom fait croire.
« Les fichiers référencés existent » se lit comme une couverture des ressources.
On ne relit pas le motif d'une garde verte.

> **Règle** — une garde d'existence se formule sur le **mécanisme** (« chaque
> `url()` du document »), jamais sur l'instance qui l'a motivée (« chaque
> fonte »). Le test de la formulation : est-ce que la garde couvre la ressource
> qu'on ajoutera le mois prochain sans y penser ? Si la réponse tient à son nom
> et non à son motif, elle ne couvre rien de plus qu'aujourd'hui.

### 2.10 — Une garde qui découpe une TRANCHE de fichier, et ses deux façons de mentir

Une garde neuve devait interdire qu'une commande d'installation revienne codée
en dur dans le script de la vitrine — la table des systèmes vit dans le HTML, et
une seconde copie dans le script dériverait au premier ajout.

Elle a été creuse deux fois, pour deux raisons différentes, et aucune ne se voit
en relisant.

**1. La borne de fin cherchée AVANT son début.** La tranche allait de
`var barreCmd` à `'/* ── Raccourcis'`. Or « Raccourcis » apparaît d'abord dans un
commentaire de la feuille de style, **3 000 lignes plus haut**. `slice(début,
fin)` avec `fin < début` rend la chaîne vide — et une chaîne vide ne contient
aucune commande. La garde passait au vert **sans avoir lu une ligne**.

**2. Ancrée sur une variable, elle ne protège que ce qui la suit.** Corrigée, la
tranche commençait toujours à `var barreCmd`. Une mutation posant la constante
**trois lignes au-dessus** a survécu. Rien n'oblige un futur auteur à écrire sa
table après ce point précis — et la garde était muette sur tout le reste.

La version qui tient ne découpe plus rien : elle lit **tous les `<script>` du
document**, et vérifie d'abord qu'elle a lu quelque chose.

```js
const scripts = [...vitrine.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
expect(scripts.length).toBeGreaterThan(0);
expect(total.length, 'les scripts lus sont vides').toBeGreaterThan(2000);
```

> **Règle** — une garde qui isole une portion de fichier doit **prouver qu'elle
> a extrait quelque chose** avant d'affirmer ce qu'il n'y a pas dedans. Sans
> cette borne, toute erreur d'extraction se lit comme une absence de défaut :
> c'est le faux vert le plus facile à écrire et le plus difficile à voir.

> **Règle** — ne pas ancrer une garde sur un identifiant du code qu'elle
> surveille. Ce que la garde interdit doit être interdit **partout**, pas après
> une ligne particulière. Si la portée choisie a une frontière, le prochain
> auteur écrira de l'autre côté — sans le faire exprès.

### 2.11 — Deux façons pour un test d'ORDRE d'être indécidable

Un test devait prouver qu'une fenêtre sur les tâches ne change pas l'ordre
promis (`createdAt` croissant). La mutation qui retirait le tri final **a
survécu deux fois**, et pour deux raisons différentes — aucune visible en
relisant le test.

**1. Les valeurs comparées étaient toutes égales.** `createTask` prend
`now = Date.now()` par défaut : six tâches posées dans une boucle naissent à la
même milliseconde. `[...dates].sort()` est alors trivialement égal à `dates` —
six valeurs identiques sont triées dans tous les sens.

**2. La source rendait déjà l'ordre attendu.** Corrigé le premier point, j'ai
posé les tâches avec des âges CROISSANTS. La requête les rend de la plus fraîche
à la plus vieille, c'est-à-dire dans l'ordre inverse des âges — donc dans
l'ordre de création. Le tri final n'avait rien à faire, et le retirer ne changeait
rien.

Il fallait que la **dernière créée soit la plus fraîche** : la requête la sort en
tête, là où l'ordre promis la met en queue. Alors seulement le tri porte.

> **Règle** — un test d'ordre doit d'abord garantir que les clés de tri sont
> **distinctes**. Une assertion sur un tri de valeurs égales est vraie pour
> n'importe quel code. Ici, une ligne suffit :
> `expect(new Set(dates).size).toBe(dates.length)`.

> **Règle** — et il doit partir d'une entrée **déjà désordonnée pour le critère
> testé**. Si la source rend spontanément le bon ordre, on teste la source, pas
> le tri. La question à se poser : « si j'enlève le tri, qu'est-ce qui change ? »
> — si la réponse est « rien », le test ne vaut rien, quelle que soit sa prose.

### 2.12 — Un test « ça ne part pas » est vert quand RIEN ne part

Six tests devaient prouver qu'une production non contre-visitée ne quitte pas la
ruche. Trois disaient « ça ne part pas », trois disaient « ça part ». Les trois
premiers sont passés du premier coup.

Ils ne testaient rien. La ruche répondait « inerte — 0 ouvrière de caste
gouvernante, 2 requises » : **aucune production ne partait, jamais, pour une
raison sans aucun rapport avec la porte**. Un montage incomplet se lit
exactement comme une garde qui fonctionne.

Ce sont les trois cas « ça DOIT partir » qui l'ont dit, en tombant tous les
trois. Sans eux, j'aurais livré une porte dont je n'aurais rien su — et elle
aurait pu être inversée, absente, ou inatteignable.

> **Règle** — un test qui affirme une ABSENCE (rien n'est envoyé, rien n'est
> écrit, rien ne part) ne vaut que s'il est accompagné du cas où la chose
> ARRIVE, sur le même montage. Le cas positif ne prouve pas la fonctionnalité :
> il prouve que le montage est capable de produire l'effet, donc que l'absence
> mesurée par les autres veut dire quelque chose.

### 2.13 — Un test qui écrit dans le store court-circuite le chemin qu'il croit tester

La même série écrivait la contre-visite par `store.enregistrerContreVisite`,
directement. Elle éprouvait donc parfaitement la LECTURE — la porte lit bien la
table — et pas du tout l'ÉCRITURE : rien ne prouvait que la contre-expertise
range son verdict.

La mutation l'a dit sans ambiguïté : retirer l'enregistrement du chemin réel a
laissé les six tests verts. Une ruche livrée ainsi aurait eu une porte qui se
referme sur tout, puisque la table serait restée vide.

> **Règle** — quand un test pose lui-même l'état qu'il va lire, il teste un
> lecteur, pas un circuit. Le circuit se prouve à l'autre bout : quelque part,
> un test doit produire cet état **par le vrai chemin**. Ici, l'assertion est
> allée dans le test qui fait déjà l'aller-retour complet, plutôt que d'en
> fabriquer un second.

### 2.14 — Le vert emprunté au voisin

Passée sous `--sequence.shuffle`, la suite perdait quatorze tests. Trois
constats successifs, chacun a démoli l'hypothèse précédente :

| Expérience                                                         | Ce qu'elle a dit                                 |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| trois graines différentes                                          | 14, 21, 25 échecs — donc pas un test précis      |
| **la même graine, deux fois**                                      | **exactement les mêmes 14** — donc pas la charge |
| `--no-file-parallelism`                                            | les mêmes 14 — donc pas la concurrence           |
| les 33 premiers fichiers **rejoués dans l'ordre exact du mélange** | tous verts — donc **pas l'ordre des fichiers**   |

Restait l'ordre des tests **à l'intérieur** d'un fichier. Le sondage élargi (six
graines de plus) a porté le compte à **dix-sept fichiers**, une quarantaine de
tests : les trois premières graines n'étaient qu'un échantillon.

Le motif était partout le même. Un test pose un état, le suivant le lit sans
jamais le dire.

Ce n'est pas une question d'hygiène, et c'est là que ça devient cher :

- `NE TOUCHE PAS AUX LIENS VIVANTS` ne voyait un lien mort que parce que deux
  tests de révocation étaient passés avant. **La moitié de la borne — que
  l'élagage emporte bien les morts — n'était vérifiée qu'un ordre sur deux.**
- `REPRENDRE LA MÊME ISSUE NE COLLISIONNE PAS` se disait « la seconde prise du
  fichier ». Joué en premier, il était la première : **il n'éprouvait aucune
  collision**, c'est-à-dire exactement le défaut pour lequel il existe.
- `UNE ASSIGNATION PÉRIMÉE` comptait sur un nœud voisin pour rafler la tâche
  avant lui. Seul, il la recevait — et **accusait le hub de se taire** alors que
  c'était sa propre prémisse qui manquait.

Le geste par défaut n'a presque rien coûté : que chaque test pose sa prémisse.
Un serveur monté par test là où il y en avait un pour le fichier, un projet neuf
là où douze tests s'en transformaient un seul, une PR numérotée là où le faux
GitHub rendait toujours `42` — **deux des dix-sept fichiers ne pouvaient pas
être découplés tant que le FAUX ne servait qu'un exemplaire.**

Un seul fichier a gardé son ordre : `caste-boucle`, où l'ordre _est_ le sujet
(une caste monte sur ses productions, puis se perd). Vitest l'entend avec
`describe(nom, { shuffle: false }, …)` — et c'est la porte dérobée idéale pour
faire taire un couplage accidentel en deux mots. Elle se déclare donc dans
`tests/ordre-declare.test.ts`, avec sa raison.

> **Règle** — un test dont le vert dépend de sa place dans le fichier ne prouve
> rien tout seul. Il pose sa prémisse, ou il déclare que l'ordre est son sujet.
> `npm run tamis-ordres` rejoue la suite dans plusieurs ordres écrits ; la CI le
> lance à chaque PR. **La CI ne mélangeait pas : rien de tout ceci n'y était
> visible.**

### 2.15 — Le remède qui désarme l'outil fait pour réparer

Sur un clone vierge (Node 24, mesuré), le docteur disait :

```
✘ env_present    aucun fichier .env
     → cp .env.example .env
```

Ce geste plante `HIVE_TOKEN=change-me` et `HIVE_JWT_SECRET=change-me` — les
valeurs **publiées avec le code**. Or l'installeur ne complète que les clés
**absentes** ; sa prudence est juste, il ne peut pas distinguer une valeur
choisie d'une valeur recopiée. Lancé ensuite, il répondait donc :

```
[OK] .env complété — vos valeurs sont intactes
```

et laissait les deux marque-places. **Le premier remède du docteur était le
geste qui fermait la porte de secours.** Restaient deux modifications à la main
dans un fichier de quatre cents lignes, là où une commande suffit.

Les deux modules étaient justes, chacun testé chez lui. Le défaut vivait
**entre eux** — la forme exacte du § 1, mais entre deux CONSEILS plutôt qu'entre
deux fonctions.

> **Règle** — un remède se mesure à l'état qu'il produit, pas à sa
> vraisemblance. `tests/premier-contact.test.ts` fait tourner ce que l'installeur
> ÉCRIT dans ce que le docteur EXIGE : deux constantes qui divergeraient
> rougissent le jour même. Et il fixe le piège lui-même — `change-me` survit à
> l'installeur — pour que le changer redevienne une décision, pas une dérive.

### 2.16 — Une mutation dont l'ancre ne colle pas se lit comme une ligne défendue

En passant `constatEnroule` à la loupe, une mutation sur six a « survécu ». Le
code n'y était pour rien : mon `replace` cherchait la ligne avec **quatre**
espaces d'indentation là où le fichier en a deux. La substitution n'a rien fait,
la suite est restée verte — et un test qui n'a jamais été éprouvé s'est présenté
comme un test qui tient.

C'est le mode d'échec le plus vicieux de la loupe : il ment dans le sens
rassurant, et il ressemble exactement à ce qu'on espère voir.

> **Règle** — une mutation s'ASSERTE avant de se juger : `assert old in s` dans
> le script, sinon « survivant » veut dire « jamais appliqué ». Le vert d'une
> mutation ratée n'est pas une information, c'est du bruit qu'on prend pour une
> preuve.

### 2.16 bis — La loupe mute LE DÉPÔT : rien d'autre ne doit tourner pendant

La loupe applique ses mutations **dans les fichiers**, puis les retire. Tant
qu'elle tourne, l'arbre de travail est donc faux à tout instant — et deux choses
en découlent, qui m'ont coûté chacune un aller-retour :

- **Les tests lancés en parallèle mesurent le code muté.** Trois échecs sont
  apparus sur `tamis-ordres`, exactement là où la loupe travaillait. J'ai
  cherché le défaut dans mes tests neufs ; il n'y en avait aucun.
- **Une loupe interrompue laisse sa dernière mutation en place.** Tuée par un
  délai, elle a laissé `&&` → `||` dans le script — et je l'ai _commité_. Une
  seconde fois, arrêtée proprement, elle laissait `===` → `!==`.

Le second cas est le vrai danger : la mutation survivante ressemble à du code,
elle passe la relecture, et elle part dans une livraison.

> **Règle** — la loupe s'exécute SEULE, et jamais en arrière-plan pendant qu'on
> travaille. Après une loupe interrompue, `git diff` sur `src`, `scripts` et
> `dashboard/src` AVANT tout `git add` — la mutation restante ne se voit qu'à
> l'œil, et elle se lit comme une ligne ordinaire.

### 2.17 — On coupe un chemin, on n'ampute pas une phrase

Le module de rendu **coupe** tout ce qui dépasse — bon geste pour un nom de
machine ou un chemin de disque, dont on reconnaît le début.

Les deux avertissements de sécurité de l'installeur font 178 et 281 caractères ;
`LARGEUR_MAX` vaut 76. On en perdait donc **102 et 205** — et à chaque fois la
fin, c'est-à-dire la seule moitié qui dit quoi faire :

```
[ATTENTION] Votre HIVE_TOKEN fait 9 caractères : c'est trop court pour pr…
```

« Remplacez-le dans .env par au moins 16 caractères — la ruche refusera de
démarrer autrement » n'a jamais atteint personne, sur aucun terminal, à aucune
largeur : le texte dépasse la borne de trois fois. On alertait quelqu'un sur le
secret qui protège sa ruche **en lui coupant la parole au milieu**.

> **Règle** — couper convient à un identifiant, jamais à une phrase. `enrouler`
> répartit sans rien perdre, `constatEnroule` aligne les lignes de suite sous le
> libellé (une marque par ligne ferait lire quatre alertes là où il y en a une),
> et un mot plus long que la ligne est **débité, pas jeté** : repousser une URL
> de 200 caractères ne ferait que déplacer le débordement.

## 3. Corriger le symptôme là où il apparaît fait revenir le problème

### 3.1 — Le plafond de délai, trois fois

Des tests dépassaient les 5 000 ms par défaut de vitest sous Windows. J'ai
élargi **les deux tests** concernés. Au run suivant, trois AUTRES tests
dépassaient. J'ai élargi **le fichier**. Au run suivant, deux autres fichiers.

La cause n'était dans aucun de ces tests : cette suite lance de vraies commandes
`git`, monte de vrais serveurs, écrit de vraies bases, et sous Windows la charge
du runner varie du simple au double — 213 s de tests sur un run, 110 s sur le
suivant. **Le plafond lui-même était le défaut.**

> **Règle** — si un correctif se déplace sur les voisins au run suivant,
> **arrêter de traiter le symptôme** et remonter d'un cran. Deux occurrences
> suffisent à établir le motif ; il ne faut pas en attendre trois.

### 3.2 — Distinguer LENT de BLOQUÉ

Élargir un délai n'est légitime que si c'est de la lenteur. Le discriminant est
net et il a servi :

- trois tests du miroir tapaient **30 008, 30 019 et 30 009 ms** — le plafond au
  millième près. Ce n'était pas lent, ça **attendait** : git y réclamait des
  identifiants pour toujours. Corrigés, pas rallongés.
- un test de limite de débit est passé **dans** les 30 s : lui était lent.

> **Règle** — un test qui touche son plafond **au millième près** attend ; un
> test lent finit avant. Écrire l'hypothèse dans le code avant de la vérifier :
> « si ça retombe au plafond, c'est un blocage à corriger, pas un délai à
> rallonger ».

### 3.2 bis — Le plafond qu'on a relevé, et son jumeau qu'on a oublié

Suite directe des deux entrées ci-dessus. Le plafond global avait été porté à
20 s, avec l'analyse écrite dans `vitest.config.ts`. Deux hooks ont quand même
expiré sous Windows, sur `main` :

    tests/billet-motifs.test.ts:48     beforeEach  Hook timed out in 10000ms
    tests/tableau-endpoint.test.ts:45  afterEach   Hook timed out in 10000ms

**10 000, pas 20 000.** `testTimeout` et `hookTimeout` sont deux réglages
distincts chez vitest : relever le premier laisse le second à son défaut.

L'oubli est mal placé, et c'est ce qui le rend intéressant. Le raisonnement qui
justifiait les 20 s — « cette suite monte de vrais serveurs, écrit de vraies
bases » — décrit ce que font les **hooks**, pas les corps de test. C'est
`beforeEach` qui appelle `createServer`, et `afterEach` qui l'arrête puis efface
l'arborescence. On donnait donc le plafond large à l'interrogation d'un serveur
déjà prêt, et le plafond serré à sa construction.

Mesuré ici, cinq cycles complets `createServer` → `stop` → `rmSync` :

| étape               | durées observées (Linux) |
| ------------------- | ------------------------ |
| démarrage           | 189, 89, 68, 62, 64 ms   |
| arrêt et effacement | 9, 8, 7, 10, 11 ms       |

Moins de 200 ms là où rien ne gêne. Les deux plafonds sont désormais alignés.

**Pourquoi aucune relecture ne pouvait le voir** : `hookTimeout` n'avait pas une
valeur fausse, il était ABSENT. Un réglage manquant n'offre rien à relire — il
applique son défaut en silence, et le défaut n'est écrit nulle part dans le
dépôt. C'est la même forme que le § 1.4 : ce qui n'est pas là ne se relit pas.

> **Règle** — quand un réglage est relevé après analyse, chercher **son
> jumeau**. Les outils exposent souvent la même idée sous deux clés
> (`testTimeout`/`hookTimeout`, lecture/écriture, connexion/requête), et n'en
> relever qu'une laisse la moitié du problème intacte.
>
> **Règle** — un défaut d'outil qui compte doit être ÉCRIT, même quand il
> convient. Une valeur explicite se relit, se compare et se garde ; un défaut
> implicite ne fait rien de tout cela.

**Ce qui le garde** : `tests/reglages-vitest.test.ts` exige que les deux clés
soient écrites, que le hook ait au moins le plafond du test, et qu'aucun des
deux ne dépasse la minute. Le mutant qui compte est le premier : remis dans
l'état d'AVANT — `hookTimeout` simplement retiré — les trois tests tombent.

Et le déclencheur d'escalade est posé d'avance, parce que le § 3.1 interdit de
recommencer : **si un hook expire de nouveau à 20 000 ms, ce n'est plus de la
lenteur.** Cent fois un coût mesuré à 200 ms, ce n'est plus un disque qu'on
attend. Le geste sera de trouver ce qui bloque, pas de passer à 30.

### 3.3 — Attendre, oui, mais attendre la BONNE erreur

Le pas de CI qui attend la ruche dans le conteneur ne faisait **pas** de
`sleep` deviné : il bouclait avec `curl --retry 30 --retry-connrefused`. C'est
la bonne intention, et elle n'a servi à rien — le pas a échoué **en 0,2 s**.

    curl: (56) Recv failure: Connection reset by peer

Docker publie le port de l'hôte dès le `docker run` : `docker-proxy` écoute
**avant** que la ruche ne soit prête. La connexion aboutit donc, puis elle est
coupée. Ce n'est pas « connection refused » (7), le seul cas que
`--retry-connrefused` reprend. Mesuré sur un port qui accepte puis coupe,
c'est-à-dire dans ces conditions exactes :

| drapeau               | tentatives             |
| --------------------- | ---------------------- |
| `--retry-connrefused` | **1 — aucune reprise** |
| `--retry-all-errors`  | 4 (1 + 3 reprises)     |

La boucle d'attente ne bouclait pas. Elle en avait toute l'apparence : le
nombre de reprises, le délai, le commentaire qui explique qu'on n'attend pas
une durée devinée. Tout était juste sauf le prédicat.

> **Règle** — une boucle d'attente se choisit sur **la panne qu'on va
> réellement rencontrer**, pas sur celle qu'on imagine. Devant un port
> intermédiaire — Docker, un proxy, un tunnel — la panne d'attente n'est
> presque jamais « refusé » : c'est « accepté puis coupé ». Et le seul moyen de
> le savoir est de regarder le code de sortie, pas de relire l'intention.

### 3.3 bis — `execFileSync` vers un serveur hébergé DANS LE MÊME processus

Les tests de CLI de ce dépôt lancent `src/cli.ts` avec `execFileSync`, et ils
ont raison : ils travaillent sur des fichiers, sans serveur.

`tests/mode-cli.test.ts` avait besoin d'une ruche VIVANTE, montée par
`createServer` dans le processus de test. Avec `execFileSync`, l'interblocage
est parfait :

- `execFileSync` bloque le fil **synchroniquement** ;
- donc la boucle d'événements ne tourne plus ;
- donc le serveur ne peut pas répondre à la requête HTTP de la CLI ;
- donc la CLI attend sa réponse pour toujours ;
- donc `execFileSync` attend la CLI pour toujours.

**Ce qui rend ce cas cher, c'est qu'il ne rougit pas** — il pend. Pas
d'assertion fausse, pas de message : un test qui tourne jusqu'au délai de
l'outil, ou jusqu'à celui de la CI dix minutes plus tard, sans rien dire
d'utile. Un rouge se lit ; un blocage se devine.

**Sa signature, mesurée sur le run qui a fini par rendre la main :**

```
× SANS ARGUMENT, elle montre les quatre modes …   301233ms
× MONTER SANS ACCORD N’ÉCRIT RIEN et le dit       301248ms
× AVEC `--oui`, LE NIVEAU EST RÉELLEMENT POSÉ     301246ms
× REDESCENDRE NE DEMANDE RIEN                     301260ms
× un mode inconnu est refusé, sans rien écrire    301262ms
AssertionError: expected 'Erreur : fetch failed\n' …
```

Cinq tests groupés à **301,2 s, à trente millisecondes près**, tous sur
`fetch failed`. C'est exactement le discriminant du § 3.2 : _un test qui
touche son plafond au millième près ATTEND ; un test lent finit avant._ Cinq
plafonds simultanés désignent une ressource bloquée partagée, jamais de la
lenteur — et `fetch failed` nomme laquelle : le serveur du processus de test.

> **Règle** — dès qu'un test lance un sous-processus qui PARLE au processus de
> test (serveur en mémoire, socket locale, port ouvert par le test), le
> lancement doit être **asynchrone** (`promisify(execFile)`), jamais `…Sync`.
> Le discriminant est simple : « ce que je lance a-t-il besoin que je continue
> à tourner ? »

### 3.4 — Un diagnostic placé en aval de ce qu'il diagnostique n'existe pas

Le même pas finissait par `docker logs ruche-ci | tail -20`, mis là exprès pour
qu'on sache ce que la ruche avait dit. Sous `bash -e`, l'échec de `curl`
l'emportait avec lui.

**La seule fois où ce journal servait à quelque chose était donc la seule fois
où il ne s'affichait pas.** La première panne réelle du démarrage n'a rien
diagnostiqué : il a fallu deviner depuis le seul code de sortie de `curl`.

> **Règle** — tout ce qui sert à COMPRENDRE une panne se met dans un pas
> séparé en `if: always()`, jamais à la suite de ce qui peut échouer. La
> question à se poser en écrivant un diagnostic : « celui-ci tourne-t-il encore
> le jour où j'en ai besoin ? »

### 3.5 — Le garde était derrière la porte qu'il gardait

Même famille que 3.4, mais côté produit, et mesuré sur la machine d'un
utilisateur, pas en CI.

`scripts/ruche.mjs` portait, dès sa première version, un contrôle de ce qui
manque, sous un commentaire qui disait « Ce qui manque se dit **AVANT** de
lancer quoi que ce soit ». Il n'a jamais pu s'afficher **une seule fois**.

La cause tient dans la ligne qui le lançait :

```
"ruche": "node --import tsx scripts/ruche.mjs"
```

`--import` est résolu par Node **avant la première instruction du fichier**. Sur
une copie où les dépendances manquent — une archive ZIP de GitHub, le cas le
plus fréquent — Node meurt à la résolution :

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from
C:\Users\micki\Desktop\hive-main\
```

Et `npm run cli -- doctor`, l'outil dont le métier **entier** est de dire ce qui
manque, tombait sur le même piège par une autre porte (`"cli": "tsx src/cli.ts"`,
donc le binaire) :

```
'tsx' n'est pas reconnu en tant que commande interne ou externe
```

Deux messages qui ne nomment ni le dépôt, ni `npm install`, ni le geste à faire.

Ce qui rend le défaut coûteux, c'est qu'il **imite la couverture** : le contrôle
existe, il est bien écrit, il est commenté, et sa lecture rassure. Rien ne
distingue à l'œil un garde qui tourne d'un garde qu'on ne peut pas atteindre.

Le remède est structurel, pas cosmétique : une **amorce** en JavaScript nu, sans
la moindre dépendance (`scripts/amorce.mjs`), et une **porte unique**
(`scripts/lancer.mjs`) que tous les points d'entrée humains traversent. `tsx`
n'y est plus chargé que par un `await import()`, donc **après** le garde. Un test
relit `package.json` et refuse qu'un script reprenne `--import tsx` ou appelle le
binaire.

Corollaire tranché au passage : l'amorce **arrête** sur une dépendance absente —
plus rien ne peut tourner, s'arrêter ne coûte aucun diagnostic — mais se contente
d'**avertir** sur un Node trop ancien, parce que `hive doctor` tourne encore et
nomme cette cause parmi douze autres. Bloquer là aurait refait le même défaut
d'un cran plus haut : un garde qui interdit l'entrée à son propre médecin.

> **Règle** — un contrôle de prérequis ne doit dépendre d'**aucun** des
> prérequis qu'il contrôle. En pratique : rien qu'il vérifie ne doit apparaître
> dans un `import` statique, dans un drapeau de ligne de commande (`--import`,
> `--require`, `--loader`), ni dans le nom du binaire lancé — tous sont résolus
> avant la première instruction.
>
> **Règle** — la question à poser d'un message d'erreur soigné : « **quelle
> commande, exactement, le fait apparaître ?** » S'il n'y en a pas, c'est du
> décor. Le seul moyen de le savoir est de casser le prérequis pour de vrai et
> de regarder la sortie.

---

## 4. Un correctif trop large casse ce qu'il ne visait pas

### 4.1 — `GIT_CONFIG_NOSYSTEM` a emporté `core.symlinks`

Pour empêcher Git Credential Manager d'attendre indéfiniment sous Windows,
j'avais coupé **toute** la configuration machine. Elle contient aussi
`core.symlinks=true` sur Git for Windows : le clone aplatissait donc les liens
symboliques, et les trois gardes du miroir contre l'évasion par lien ne
vérifiaient plus rien.

**Ce qui l'a attrapé** : l'assertion « le clone a APLATI le lien symbolique
(git `core.symlinks=false` ?) » que j'avais posée **au lot précédent**, pour
exactement ce cas. Elle a servi au run suivant celui où je l'ai écrite.

> **Règle** — viser le composant fautif (`GCM_INTERACTIVE=Never`), pas la
> catégorie qui le contient. Un correctif large est un correctif qu'on ne sait
> pas justifier.

### 4.2 — Ne pas désactiver une garde d'un outil tiers pour se simplifier la vie

`simple-git` bloque `credential.helper` en configuration, et il a raison : un
assistant d'identifiants peut désigner n'importe quel binaire. Il existe un
drapeau `allowUnsafeCredentialHelper` — je ne l'ai pas utilisé. On coupe la
source du problème plutôt que la protection.

> **Règle** — quand un outil refuse quelque chose « pour votre bien », d'abord
> comprendre pourquoi, puis chercher la voie que la garde laisse ouverte.

### 4.3 — `--ignore-scripts` visait `prepare` et aurait emporté le binaire natif

Même forme que 4.1, sur un autre outil, et avec une aggravation.

La première construction de l'image est morte à l'étage qui SERT :

    > hive@0.2.0 prepare
    > npm run build:node
    sh: 1: tsc: not found
    npm error code 127

npm lance `prepare` à **chaque `npm ci`, y compris avec `--omit=dev`** — et le
`prepare` de ce dépôt appelle `tsc`, qui est justement ce que `--omit=dev`
vient de retirer. L'étage se coupait la branche sur laquelle il était assis.

Le correctif qui vient à l'esprit est un drapeau : `--ignore-scripts`. Il est
juste sur le symptôme et faux sur le reste — il neutralise AUSSI le script
d'installation de `better-sqlite3`, celui qui télécharge le binaire prébuilt.
Mesuré sur les deux vrais manifestes du dépôt, avant de choisir :

| approche                         | `npm ci` | binaire natif |
| -------------------------------- | -------- | ------------- |
| tel quel                         | **127**  | —             |
| `--ignore-scripts`               | 0        | **absent**    |
| `npm pkg delete scripts.prepare` | 0        | présent       |

**L'aggravation est là.** Le défaut de départ est une construction ROUGE : elle
s'arrête, elle se lit, elle se corrige. Le correctif d'une ligne rend la
construction VERTE et déplace la panne au démarrage, sur un module natif
introuvable — c'est-à-dire exactement la panne que le choix de `slim` plutôt
qu'`alpine` évite vingt lignes plus haut dans le même fichier. J'aurais
réintroduit par le correctif ce que le fichier documente avoir évité.

> **Règle** — un correctif qui fait passer un rouge au vert n'a rien prouvé
> tant qu'on n'a pas demandé **ce qu'il éteint d'autre**. Et se méfier
> particulièrement de celui qui transforme un échec bruyant en succès
> apparent : une image qui refuse de se construire est un problème, une image
> qui se construit et ne démarre pas est un piège.

**Ce qui le garde** : deux tests dans `tests/conteneur.test.ts` — l'un exige
que tout `npm ci` neutralise `prepare`, l'autre exige que l'étage qui sert le
fasse **sans** `--ignore-scripts`. Les deux mutants ont été joués : chacun
rougit le sien.

---

## 5. Gestes destructeurs

### 5.1 — `git checkout` pour annuler une mutation de test

Après avoir muté un fichier pour vérifier qu'un test rougit, `git checkout
<fichier>` restaure **HEAD** — et efface toutes les modifications non commitées
du même fichier. J'ai perdu un correctif écrit dix minutes plus tôt.

> **Règle** — avant de muter, `cp <fichier> <scratchpad>/x.bak`. Restaurer
> **depuis la copie**, jamais par `git checkout`.

### 5.2 — Une loupe interrompue laisse sa mutation dans le fichier

La loupe mute `src/` **en place** et restaure à la fin. Un `LOUPE_MAX=45` a été
tué en cours de route par un redémarrage du processus : la restauration n'a
jamais eu lieu, et `src/shared/cerveau.ts` est resté avec une ligne inversée
que **je n'avais pas écrite** :

```ts
...(unTexte(champs.get('serviLe')) !== undefined ? {} : { serviLe: … })
```

`serviLe` disparaissait donc à chaque lecture de note.

**Ce qui rend ce cas dangereux, c'est la façon dont il se présente.** Le test
d'aller-retour a rougi, et le rapport disait « 7 clés au lieu de 8 » — la
signature exacte d'un défaut que je viens d'introduire. J'ai commencé à
chercher ce que j'avais cassé dans MON code. Un `git diff HEAD` a montré la
vérité en trois lignes.

Deux conséquences, et la seconde est pire :

- sans le test d'aller-retour, la mutation partait **dans le commit**, et un
  outil de vérification aurait introduit le seul défaut que rien ne défendait ;
- l'outil qui cherche du code non couvert peut donc, s'il meurt au mauvais
  moment, **en fabriquer**.

> **Règle** — après toute loupe qui ne s'est pas terminée proprement (tuée,
> interrompue, session redémarrée), `git diff HEAD -- src/ dashboard/` AVANT
> de conclure quoi que ce soit sur un test rouge. Un échec juste après une
> loupe est un leftover jusqu'à preuve du contraire.
>
> **Règle** — et l'inverse est vrai aussi : ce jour-là, le test d'aller-retour
> a fait exactement son travail. Un test qui rougit sur une mutation qu'on n'a
> pas voulue est la démonstration qu'il rougirait sur celle qu'on aurait pu
> écrire par erreur.

---

### 5.3 — Un mutant commité, parce qu'une flotte écrivait dans le même arbre

`ligneAFuite` est partie sur `main` avec sa condition inversée :

```js
if (droite !== '') return gauche; // au lieu de `=== ''`
```

Elle abandonnait donc **dès qu'il y avait quelque chose à afficher** : le chrono
jamais rendu, la fuite de points jamais dessinée — la colonne du rail perdait
exactement ce pour quoi elle venait d'être écrite.

**Comment.** Une flotte d'agents d'audit tournait sur le dépôt, avec pour
consigne « ne modifie aucun fichier suivi par git ». L'un d'eux a lancé
`npm run loupe` : une lecture, au sens où il l'entendait ; une **écriture**, en
réalité — la loupe mute une ligne, lance la suite, restaure. Elle tournait donc
en boucle sur `src/tui/rendu.ts` pendant que je travaillais dans le même arbre.

`git add -A` a ramassé la mutation **en vol**, sur un fichier que ce commit-là
ne touchait pas. Ma relecture n'a rien vu : je relisais ce que j'avais changé.
Et la suite non plus, parce que je n'avais lancé que le fichier de tests du lot
en cours ; `tests/tui-rail.test.ts` serait devenu rouge sur-le-champ.

La loupe, elle, n'a pas failli : elle a restauré à chaque tour, et l'arbre était
propre après. Ce qui a échoué, c'est de commiter pendant qu'elle tournait.

> **Règle** — `git add -A` est interdit dès que quelque chose d'autre peut
> écrire dans l'arbre. Les chemins s'écrivent explicitement, et
> `git diff --cached` se lit avant chaque commit — le diff COMPLET, pas celui
> de ce qu'on croit avoir touché.
>
> **Règle** — « ne modifie aucun fichier » ne suffit pas comme consigne à un
> agent : il faut nommer les OUTILS interdits. `npm run loupe`,
> `prettier --write`, `npm install`, un formateur : tous écrivent sans qu'on ait
> l'impression de modifier quoi que ce soit.
>
> **Règle** — une flotte d'agents qui écrit travaille dans un arbre SÉPARÉ.
> Partager un répertoire de travail entre processus concurrents, c'est partager
> de la mémoire mutable : même classe de bogues, et aucun verrou.
>
> **Règle** — après un lot, lancer la suite ENTIÈRE avant de commiter, pas
> seulement le fichier de tests du lot. C'est le seul filet qui attrape ce
> qu'on n'a pas vu venir.

---

## 6. Windows n'est pas Linux avec des barres inverses

### 6.1 — `new URL(...).pathname` double la lettre de lecteur

`new URL('../x.ts', import.meta.url).pathname` vaut `/D:/a/hive/…` sous
Windows — une barre **avant** la lettre de lecteur. `readFileSync` le résout
alors depuis le lecteur courant : `D:\D:\a\hive\…`, ENOENT.

Ironie : je l'ai écrit dans un test dont le sujet est la justesse Windows. Le
motif correct était dans un autre fichier de tests, à deux répertoires de là.

> **Règle** — passer l'objet `URL` **tel quel** à `readFileSync`, qui sait le
> lire. Ne jamais construire un chemin de fichier depuis `.pathname`.

**Recommis dans le fichier qui cite cette règle.** `tests/empreinte.test.ts`
utilisait `new URL('.', RACINE).pathname` pour deux choses : le `cwd` d'un
`spawn`, et la racine d'un parcours de `src/`. Sous Windows, le premier a
échoué (`expected -1 to be +0`), le second a rendu une liste **vide**.

Le second est le pire. Le relevé des écritures ne voyait plus aucun fichier :
la garde « la liste des fichiers qui écrivent » a rougi — elle comparait à une
liste attendue — mais celle de `os.homedir()` bouclait sur **zéro élément** et
**passait**. Une garde de sécurité verte qui n'a rien regardé, exactement le
§ 1.2.

> **Règle** — `fileURLToPath` est la SEULE conversion correcte d'une `URL` vers
> un chemin. `.pathname` ne l'est jamais, sur aucune plateforme — il se trouve
> qu'il fonctionne par accident sous POSIX.
>
> **Règle** — une garde qui BOUCLE sur un relevé doit refuser un relevé vide.
> `expect(vus).toBeGreaterThan(0)`, ou un plancher grossier sur le nombre de
> fichiers parcourus. Sans ça, casser le parcours désarme la garde en silence
> — et c'est la plateforme la moins regardée qui le fera.

**Une TROISIÈME fois, et cette fois la règle était déjà écrite deux fois
au-dessus.** `tests/deploiement-sans-ecran.test.ts` composait le chemin du
script avec
`path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', …)`. Vert
sur Linux et macOS, rouge sur Windows :

```
sh -n D:\D:\a\hive\hive\examples\deploiement-sans-ecran.sh
```

Ce qui rend cette récurrence-là instructive, c'est **ce qui l'a laissée
passer** : trois lignes plus bas, le même fichier fait
`readFileSync(new URL('../examples/…', import.meta.url))` — et c'est CORRECT,
parce que `fs` accepte une URL `file:` et la convertit lui-même. Les deux
formes se ressemblent, cohabitent dans le même fichier, et une seule est juste.

> **Règle** — la présence d'un `new URL(…, import.meta.url)` correct à côté ne
> valide pas celui qu'on écrit. Dès qu'un chemin doit devenir une CHAÎNE — un
> argument de `spawn`, un `cwd`, une base de `path.resolve` —, c'est
> `fileURLToPath`, sans exception. Passer l'`URL` telle quelle ne marche que
> pour les fonctions de `fs`, qui l'acceptent explicitement.
>
> **Et la leçon de fond** : un journal qu'on a écrit ne dispense pas de le
> relire. Cette entrée existait, elle était juste, elle nommait exactement la
> ligne fautive — et elle a été recommise par son propre auteur, dans une
> session où il l'avait déjà citée.

#### 6.1 ter — Le même défaut dans l'autre sens : `import()` d'un chemin absolu

`scripts/lancer.mjs`, écrit dans la même session que l'entrée ci-dessus,
finissait par :

```js
await import(cible); // cible = path.resolve(RACINE, 'src/cli.ts')
```

Sous Linux et macOS, `cible` commence par `/` et Node l'accepte. Sous Windows,
c'est `C:\Users\…\src\cli.ts`, et `import()` prend un **spécificateur**, pas un
chemin :

```
ERR_UNSUPPORTED_ESM_URL_SCHEME — Only URLs with a scheme in: file, data, and
node are supported by the default ESM loader. Received protocol 'c:'
```

Deux systèmes sur trois auraient donc été **verts** pendant que la porte
d'entrée du dépôt serait morte chez tous les utilisateurs de Windows — dont
celui qui avait signalé la panne d'origine. `fileURLToPath` était déjà employé
correctement trois lignes plus haut : c'est la conversion **inverse** qui
manquait, `pathToFileURL`.

Ce qui manquait surtout, c'est un test qui LANCE. Les assertions écrites
d'abord relisaient le texte de `package.json` et des scripts ; aucune ne
traversait la porte. `tests/amorce.test.mjs` lance désormais un vrai processus
sur un point d'entrée minuscule (`tests/fixtures/echo-argv.ts`) et compare ce
qu'il imprime — sur les trois systèmes de la CI.

> **Règle** — un chemin ne devient jamais un spécificateur de module par
> concaténation, dans aucun sens : `fileURLToPath` pour aller de l'URL au
> chemin, `pathToFileURL(...).href` pour revenir. La règle est symétrique parce
> que le défaut l'est.
>
> **Règle** — un lanceur se teste en le LANÇANT. Relire son texte ne distingue
> pas les deux formes ci-dessus, et sur deux systèmes sur trois elles se
> comportent à l'identique.

### 6.1 bis — Un handle ouvert ne se voit PAS sous Linux

Dix-neuf tests du lot 17 sont passés ici et sont tombés en CI Windows, tous sur
la même ligne — et aucun sur une assertion :

```
Error: EPERM, Permission denied: C:\Users\RUNNER~1\AppData\Local\Temp\taches-bornees-yTKhvb
  ❯ tests/taches-bornees.test.ts:52:3
      rmSync(dossier, { recursive: true, force: true });
```

Le `afterEach` effaçait le dossier de la base **sans fermer la base**. Windows
refuse de supprimer un fichier dont un handle est encore ouvert ; Linux
l'accepte sans un mot, et laisse donc passer une fuite bien réelle.

La tentation est de mettre `maxRetries` et de passer à autre chose. Ce serait
traiter le symptôme : le défaut n'est pas dans `rmSync`, il est dans un test qui
ouvre une base et ne la referme jamais. **Windows a raison.** Toutes les autres
suites du dépôt appellent `store.close()` — celle-ci l'avait oublié, et rien
sous Linux ne pouvait le dire.

> **Règle** — une suite qui ouvre une ressource système (base sur disque,
> serveur, fichier) la ferme dans le même `afterEach` qui nettoie, et AVANT le
> nettoyage. Le test qui l'oublie est vert sur la plateforme la plus permissive
> de la matrice, ce qui veut dire : vert chez soi, rouge chez les autres.

> **Règle** — un balayage vaut mieux qu'une correction. Après celle-ci, j'ai
> cherché toutes les suites qui créent un store SUR DISQUE, effacent leur
> dossier, et n'appellent jamais `close()`. Il n'y en avait pas d'autre — mais
> la question se pose en dix secondes, et elle ferme la classe entière au lieu
> d'un cas.

### 6.2 — Un `.cmd` ne se lance pas sans interpréteur

Sous Windows, `npm` est `npm.cmd`. Node **refuse** d'exécuter un `.cmd`/`.bat`
sans `shell: true` — durci depuis la CVE-2024-27980. Conséquence : la
préparation d'environnement d'un merge (`npm ci`) était **inopérante sur tout
nœud Windows**, en silence.

La correction ne passe pas par `shell: true` (contrainte §5.1) mais par
l'exécutable RÉEL : `npm` est un script JavaScript livré avec Node, donc on
lance l'interpréteur avec ce script en argument. **Plus strict qu'avant, pas
moins.**

> **Règle** — une variante de plateforme qui ne peut pas aboutir doit être
> retirée, pas gardée « au cas où ». `candidates()` listait `bin.cmd` en
> premier : une ligne qui échouait à tous les coups en ayant l'air de couvrir un
> cas.

**Et je l'ai recommis quatre lots plus tard**, dans un test :
`execFileSync('npx', ['tsx', 'src/cli.ts', …])`. Vert sur cette machine,
condamné sous Windows pour exactement la même raison — `npx` y est `npx.cmd`.
Attrapé en relisant mon propre rappel de contrôle, pas par un test.

Une règle apprise dans le code produit ne se transporte pas toute seule dans
les tests : c'est là qu'on écrit vite, en croyant que « ce n'est qu'un test ».

> **Règle** — pour lancer du Node depuis un test, `process.execPath` et rien
> d'autre. C'est un vrai exécutable sur les trois plateformes, il n'y a aucune
> résolution de `PATH` à faire, et c'est plus rapide (ici : 4,0 s → 1,8 s).
> `node --import tsx <fichier.ts>` remplace `npx tsx <fichier.ts>`.

**La même leçon, appliquée à `npm` en 6.2, a mis des mois à atteindre l'agent.**
`agent-detect.ts` portait ce commentaire, écrit en toute lucidité :

> « Un agent installé par npm — c'est le cas de Claude Code — n'expose sous
> Windows qu'un shim `claude.cmd`. Il est donc INDÉTECTABLE ici […] le corriger
> demande de lancer autre chose que le shim, ce que la contrainte §5.1 rend
> délibérément difficile. »

Le remède était pourtant écrit trois sections plus haut, et déjà appliqué à
`npm` : viser le script réel du paquet et lancer Node dessus. Le constat était
juste, complet, et **il s'est substitué à la correction**.

> **Règle** — un commentaire qui documente un défaut comme non corrigé est une
> dette qui se lit comme une décision. Écrire « c'est difficile » à l'endroit
> exact où l'on connaît déjà le remède, c'est refermer la question. Quand on
> décrit un défaut sans le corriger, dire **ce qu'il faudrait faire**, pas
> seulement pourquoi c'est pénible.

### 6.3 — Une branche par plateforme est invérifiable si elle lit `process.platform`

C'est la cause commune de 6.2 et de plusieurs autres : du code spécifique à une
plateforme, lisible seulement sur cette plateforme, donc jamais éprouvé.

> **Règle** — la plateforme se passe **en paramètre**
> (`decider(bin, plateforme)`, `candidates(bin, plateforme)`), avec
> `process.platform` par défaut. La branche win32 se vérifie alors depuis Linux,
> à chaque CI.

**La frontière de cette règle** — ajoutée après qu'elle m'a coûté deux tests
rouges sous Windows. Le paramètre rend la branche win32 vérifiable **tant que
le test reste pur**. Dès qu'un test écrit sur le VRAI disque, le paramètre doit
dire la VÉRITÉ.

`tests/sauvegarde.test.ts` avait un helper `ctx()` figeant `plateforme:
'linux'` — correct, et précieux, pour les tests de `planifier`. Deux tests plus
bas s'en servaient en y passant un chemin de `mkdtempSync`. Sous Windows,
c'est `D:\a\_temp\…`, jugé par `path.posix.isAbsolute` :

    path.posix.isAbsolute('D:\\a\\_temp\\x')  →  false   ← le refus
    path.win32.isAbsolute('D:\\a\\_temp\\x')  →  true
    path.posix.isAbsolute('/tmp/x')           →  true
    path.win32.isAbsolute('/tmp/x')           →  true    ← l'asymétrie

La sauvegarde était refusée pour « chemin relatif » sur un chemin absolu.

La dernière ligne du tableau est celle qui compte : un chemin POSIX est absolu
pour les **deux** juges. Mentir sur la plateforme depuis Linux ne casse donc
rien, et **la panne ne se simule pas à l'envers**. Aucune garde sur la source
ne l'aurait vue non plus — la ligne fautive est syntaxiquement identique à
celle, correcte, du test pur d'à côté. Seule la branche Windows de la matrice
rend ce défaut, et c'est là que la matrice à trois OS paie son coût.

> **Règle** — un test qui touche le vrai disque prend `process.platform`, sans
> exception. Les deux moitiés ne partagent pas le même helper : dans
> `tests/empreinte.test.ts` (où je l'avais fait juste) il y a `ctxPosix` d'un
> côté et un contexte réel de l'autre. Un seul helper avec un défaut commode
> est le piège.

### 6.4 — Un test qui LANCE un script POSIX doit sonder la plateforme

J'ai écrit `tests/installeurs.test.ts` en lançant `sh install.sh` — sans me
demander si `sh` existe partout. La CI Windows a rendu un code de sortie **-1** :
le `spawn` lui-même échouait, faute de shell POSIX.

Ce n'est pas un défaut du produit. `install.sh` n'a rien à faire sous Windows,
qui a `install.ps1`. C'est le TEST qui prétendait tourner partout.

Le plus notable : je l'ai commis dans le fichier qui teste les **deux**
installeurs — donc en ayant la question des plateformes sous les yeux.

> **Règle** — un test qui exécute un binaire ou un script dépendant de la
> plateforme sonde sa disponibilité **au chargement du module**, gate avec
> `it.runIf`, AVERTIT quand il ne peut pas tourner, et EXIGE que la sonde
> réussisse là où elle le doit. Le motif est celui de `tests/miroir.test.ts`.
>
> **Règle** — quand la couverture est RÉPARTIE entre plateformes (ici : `sh`
> sur POSIX, `.ps1` en CI Windows, gardes sur la source partout), l'écrire dans
> le fichier. Sinon la prochaine personne verra un trou et non un partage.

### 6.5 — Sonder une CAPACITÉ ne répond pas à la question de la CIBLE

La correction de 6.4 sondait `sh` par un `execFileSync('sh', ['-c', 'exit 0'])`.
Elle n'a rien changé : **Windows _a_ un `sh`**, parce que Git Bash est sur le
PATH des runners GitHub. La sonde disait vrai, les tests tournaient — et ils
éprouvaient une configuration **que personne n'utilise**, `install.sh` sous
Git Bash, alors que Windows a `install.ps1`.

J'avais posé la bonne question sur le mauvais sujet : « est-ce _possible_ ? »
au lieu de « est-ce la _cible_ ? ». Une réponse juste à une question
hors-sujet ressemble à s'y méprendre à une correction.

Et le test qui a cassé au run suivant ne cassait pas pour cette raison, mais
pour une seconde faute Windows cachée dessous : je composais un `PATH` avec
`` `${faux}:${process.env.PATH}` ``. Le séparateur est `;` sous Windows. Le
faux `node` n'était donc jamais trouvé, et le script sortait sur la garde de
version. Deux défauts empilés, dont le second n'apparaît qu'une fois le premier
levé — c'est la forme habituelle : **une correction qui débloque l'exécution
révèle le bug suivant, elle ne le crée pas.**

> **Règle** — quand une sonde décide si un test s'exécute, elle doit exprimer
> la **pertinence**, pas la faisabilité. Ici : `if (process.platform === 'win32')
return false;` **avant** de chercher `sh`.
>
> **Règle** — jamais de `:` littéral pour composer un `PATH`, ni de `/` pour
> composer un chemin. `path.delimiter` et `path.join`, y compris dans les tests
> — surtout dans les tests, puisque ce sont eux qui tournent sur les trois
> plateformes.

**La même faute, quatre lots plus tard, sur un autre sujet.** Un test vérifiait
que le calcul de taille ne suit pas les liens symboliques. Il créait le lien
avec `execFileSync('ln', ['-s', …])` et s'abstenait « s'il n'y a pas de `ln` ».

Sous Windows, Git Bash **en a un**, il réussit — et **copie le dossier** au
lieu de lier. Le test a mesuré 51 000 octets au lieu de 1 000 et accusé la
garde d'avoir suivi un lien qui n'existait pas.

> **Règle** — une sonde qui conditionne un test doit interroger le **résultat**,
> pas l'outil. Ici : créer le lien avec `node:fs`, puis exiger
> `lstatSync(lien).isSymbolicLink()`. Si ce n'en est pas un, il n'y a rien à
> conclure — et on le DIT, plutôt que de passer en silence.

### 6.6 — Il y a DEUX PowerShell, et ils ne lisent pas le même fichier

`install.ps1` porte `#Requires -Version 5.1`. La CI ne lançait que `pwsh`,
c'est-à-dire PowerShell **7** — celui qu'il faut installer à part. Windows
PowerShell **5.1**, `powershell.exe`, est celui qui est livré avec l'OS et
qu'on obtient en cliquant « PowerShell » dans le menu Démarrer : c'est lui qui
exécute le script chez la plupart des gens, et il n'avait jamais tourné.

Les deux ne décodent pas les fichiers pareil. Sans BOM, **5.1 lit en page
ANSI** : `détecté` devient `dÃ©tectÃ©`, `—` devient `â€"`, l'abeille
disparaît. L'écran d'accueil du projet — la toute première chose que voit
quelqu'un — en charabia, sous l'interpréteur majoritaire, avec une CI verte.

Mesuré avant d'être corrigé : relire les octets du fichier en `cp1252` a rendu
le charabia exact, depuis Linux, sans Windows sous la main. Le BOM UTF-8 met
les deux versions d'accord.

> **Règle** — quand un fichier déclare une version minimale d'interpréteur,
> **c'est cette version-là** qu'il faut lancer en CI, pas seulement la plus
> récente. Ici : un pas `shell: powershell` (5.1) à côté du pas `pwsh` (7).
>
> **Règle** — un `.ps1` commence par un BOM UTF-8 ; un `.sh` n'en a **jamais**
> (le BOM passerait avant le `#!` et casserait le shebang). Les deux sont des
> gardes de `tests/installeurs.test.ts` : trois octets invisibles que le
> premier éditeur venu peut ôter sans le dire.
>
> **Règle** — un pas de CI qui vérifie un ENCODAGE doit refuser le charabia
> explicitement. Sans ça il reste vert en affichant n'importe quoi — voir
> § 1.3.

### 6.7 — La garde s'est fait mordre par ce qu'elle gardait

Le pas de CI du § 6.6 cherchait le charabia en écrivant `'Ã|â€'` et
`'Vérification des prérequis'` tels quels. **Il a rendu une `ParserError`.**

Parce que GitHub Actions écrit le contenu d'un bloc `run:` dans un fichier
`.ps1` **temporaire — lui aussi sans BOM** — avant de le donner à
`powershell.exe`. Mon `Ã` y est devenu `Ãƒ`, mon `â€` est devenu `Ã¢â‚¬`, le
guillemet s'est retrouvé cassé, et l'analyseur a refusé le script.

Le défaut que ce pas traque a donc mordu le pas lui-même, au premier essai.
C'était la meilleure démonstration possible qu'il valait la peine d'exister —
et la leçon est plus large qu'`install.ps1` : **tout** bloc `run:` sous
`shell: powershell` subit le même décodage. Un fichier commité peut porter un
BOM ; un bloc `run:` ne le peut pas.

> **Règle** — le corps d'un `run:` sous `shell: powershell` s'écrit en **ASCII
> pur**. Les caractères accentués sur lesquels on veut assener quelque chose se
> construisent par point de code (`[char]0x00C3`), jamais en littéral. La prose
> française va dans un commentaire **YAML**, hors du `run:` — le runner lit le
> workflow en UTF-8, c'est seulement le script extrait qui perd l'information.
>
> **Règle** — préférer la preuve **positive** à la preuve négative. « Aucun
> `Ã` » peut être vrai d'une sortie vide ; « un `é` a survécu » ne peut pas.
> Les deux assertions cohabitent, mais c'est la seconde qui porte.

### 6.8 — Windows PowerShell 5.1 mange les guillemets des arguments natifs

Le pas 5.1 réparé, la panne a bougé — et elle est passée **dans
`install.ps1`**, à sa toute première vérification :

```
powershell.exe : [eval]:1
```

`[eval]:1` est le préfixe d'erreur de `node -p`. L'appel était
`node -p 'process.versions.node.split(".")[0]'`. Impeccable sous `pwsh` ; sous
5.1, Node recevait `process.versions.node.split(.)[0]`.

Windows PowerShell 5.1 réécrit les arguments d'une commande native avec ses
propres règles et **mange les guillemets doubles** qu'ils contiennent.
PowerShell 7.3 a corrigé ce passage d'arguments ; 5.1 ne le sera jamais — c'est
un composant du système, pas une application qu'on met à jour.

Et comme `$ErrorActionPreference` vaut `Stop`, la sortie d'erreur native
devient une exception : **l'installeur mourait à son premier contrôle**, sous
l'interpréteur que la plupart des gens ont, sur le seul chemin d'installation
proposé aux utilisateurs Windows.

Trois défauts réels sortis du seul fait de lancer 5.1 (§ 6.6, § 6.7, celui-ci).
Chacun invisible sous `pwsh`, chacun fatal chez l'utilisateur.

> **Règle** — aucun guillemet double dans un argument passé à une commande
> native depuis PowerShell. Quand une expression en réclame, on la simplifie
> jusqu'à ce qu'elle n'en ait plus besoin — ici, `node -p` rend la version
> entière et c'est PowerShell qui la découpe. Une garde de
> `tests/installeurs.test.ts` l'exige, et elle **compte** ce qu'elle a
> inspecté : à zéro argument vu, elle échoue plutôt que de passer sans rien
> regarder.

---

## 6.6 bis. Un fichier de configuration comparé à mes attentes, jamais à son consommateur

L'unité systemd que Hive écrit était **refusée par systemd depuis le premier
jour**. Onze tests la couvraient. Tous verts.

    WorkingDirectory= path is not absolute: "/home/user/hive"
    hive-ruche.service: Unit configuration has fatal error, unit will not be started.

La cause tient en une fonction trop bien nommée. `citerSystemd` citait « une
valeur dans un fichier d'unité systemd » — un domaine qui a l'air juste
partout. Elle a donc été employée sur les **quatre** directives que le module
écrit. Or systemd n'a pas une grammaire, il en a **deux**, et il ne le dit nulle
part au même endroit :

| directive           | guillemets                          | pourquoi                      |
| ------------------- | ----------------------------------- | ----------------------------- |
| `ExecStart=`        | **obligatoires** si espace          | ligne de commande, découpée   |
| `ReadWritePaths=`   | **obligatoires** si espace          | liste séparée par des espaces |
| `WorkingDirectory=` | **fatals** — l'unité ne démarre pas | prend la ligne entière        |
| `EnvironmentFile=`  | **ignorés SANS UN MOT**             | prend la ligne entière        |

Le quatrième est le pire, et c'est celui qui manquait le plus. Cité,
`EnvironmentFile=` n'échoue pas : systemd note « path is not absolute,
ignoring » et passe. Le service démarre, écoute, et n'a **ni `HIVE_TOKEN` ni
`HIVE_JWT_SECRET`** — exactement la panne que l'en-tête de `src/shared/service.ts`
déclare exister pour fermer.

### Ce qui rendait les onze tests aveugles

Ils comparaient le fichier produit **à la chaîne que j'attendais** :

    expect(ligne).toBe('WorkingDirectory="/home/moi/hive"');

Cette ligne ne pouvait rien trouver. Elle gravait ma croyance et la relisait.
Un fichier de configuration n'a qu'un seul juge — **le programme qui doit
l'avaler** —, et il n'avait jamais été consulté.

### Ce que ça coûtait de le consulter : 28 ms

C'est le chiffre que je n'avais pas pris. Je répétais « aucune CI ne peut
vérifier que `systemctl` avale le fichier », ce qui est vrai de
`systemctl enable` et **faux** de la question posée. Entre « installer pour de
bon » et « ne rien vérifier », il y a `systemd-analyze verify` : il charge
l'unité, rend ses erreurs, sans gestionnaire, sans bus, sans privilège. Les
équivalents existent sur les deux autres plateformes — `plutil -lint`,
`schtasks /Create /XML`.

C'est la **troisième** fois qu'une limite déclarée hors d'atteinte tombe dès
qu'on la chiffre (§ 9 decies). Le motif est stable : je décris l'obstacle avec
les mots de la version maximale de la tâche, et je n'essaie jamais la version
minimale qui répondrait quand même.

### La règle

> Un fichier destiné à un autre programme se vérifie **en le lui donnant**.
> Tant que son consommateur ne l'a pas lu, une garde dessus ne mesure que la
> constance de mes attentes. Et avant d'écrire qu'une vérification est
> impossible : chercher le mode « valide sans installer » de l'outil — la
> plupart en ont un, et il coûte des millisecondes.

`tests/service-accepte.test.ts` soumet désormais le fichier au juge de chaque
plateforme, et lui redonne la version d'AVANT le correctif pour vérifier qu'il
la refuse — sans quoi un outil complaisant serait vert lui aussi.

---

## 6 bis. Un remplacement de texte sans compte touche TOUTES les occurrences

### 6bis.1 — 286 lignes de CHANGELOG en triple, et la cause tient en un argument

Le défaut visible est raconté au § 2.3 ter du point de vue de la garde. Voici sa
CAUSE, trouvée après coup — la garde attrapait la rechute sans expliquer d'où
elle venait.

Le commit fondateur (`7a40c6f`) montre **trois hunks** pour une seule entrée de
CHANGELOG : 66 lignes insérées, soit exactement trois fois vingt-deux.

    @@ -7,6   +7,28   @@
    @@ -706,6 +728,28 @@
    @@ -868,6 +912,28 @@

L'entrée était posée **avant `### Fixed`**. Or `### Fixed` figurait trois fois
dans le fichier — aux lignes 10, 709 et 871, qui sont précisément les trois
points d'insertion une fois retiré le contexte des hunks. La correspondance est
exacte, elle ne laisse pas de place au doute.

Reproduit en deux lignes :

```python
texte.replace(ancre, bloc + ancre)      # → 3 copies
texte.replace(ancre, bloc + ancre, 1)   # → 1 copie
```

**En Python, `str.replace` remplace TOUTES les occurrences par défaut.** Il faut
un troisième argument pour n'en prendre qu'une. Rien dans l'appel ne signale ce
choix : la version fautive et la version juste se ressemblent à un caractère
près, et la fautive est la plus courte.

La croissance monotone sur huit livraisons s'explique alors toute seule : chaque
nouvelle entrée était insérée devant les trois `### Fixed`, donc les trois copies
grandissaient ensemble, à l'identique. 25 → 46 → 60 → 79 → 97 → 117 → 146.

**Pourquoi ça a échappé huit fois** : le diff d'un tel commit est parfaitement
lisible. Il montre trois hunks, chacun ajoutant du texte correct, au bon format,
au bon endroit d'une section qui existe. Rien n'y est faux LOCALEMENT. Ce qui est
faux est global — et un diff ne montre jamais le global.

> **Règle** — un remplacement de texte ancré est borné à UNE occurrence, toujours
> (`, 1` en Python, `replace_all: false` dans l'outil d'édition). Le défaut du
> langage va dans le mauvais sens : il faut écrire quelque chose pour être
> prudent, et ne rien écrire pour tout casser.
>
> **Règle** — avant d'ancrer une insertion sur un motif, COMPTER ses occurrences.
> Un ancrage sur un motif présent trois fois n'est pas une insertion, c'est une
> diffusion. Les titres de section (`### Fixed`, `### Added`) sont les pires
> ancres possibles : ils se répètent par nature.

**Ce qui le garde** : `tests/documents-qui-grossissent.test.ts` rougit sur toute
répétition d'au moins huit lignes dans les cinq documents qui ne font que
grandir. La règle ci-dessus empêche ; la garde rattrape.

### 6bis.2 — Un filet de reprise qui n'a pas de mémoire devient un robinet

La ruche re-sert `assign_task` aux tâches assignées restées muettes plus de cinq
secondes : un filet pour un message PERDU EN VOL. Il ne gardait aucune trace de
ses tentatives, donc une tâche muette repartait à CHAQUE TICK.

**Ce qui rend cette entrée intéressante, c'est qu'il m'a fallu trois descriptions
pour arriver à la bonne.**

**Version 1 — « 118 renvois en douze secondes ».** Le compte était exact. Il
venait d'une sonde montée à `tickMs: 60`, alors que la production est à
**2 000 ms** : trente-trois fois le rythme réel. Un nombre mesuré sur un banc
porte les réglages de ce banc.

**Version 2 — « indéfiniment ».** Faux aussi, et de façon plus intéressante. Le
test montrait la tâche finissant en `ready`, pas en `assigned` : le _reaper_
l'avait désassignée. Le nœud du banc ne battait jamais, donc il mourait de
timeout, donc sa tâche revenait dans la file et la boucle s'arrêtait seule. Le
test observait le reaper, pas le filet.

**Version 3, la bonne.** Le cas qui compte est l'inverse : un nœud bien VIVANT,
qui bat normalement, mais bloqué sur une tâche dont il ne rend jamais compte.
Celui-là n'est jamais moissonné, sa tâche reste assignée, et c'est lui que le
filet arrosait sans fin. Le test monte donc un nœud qui envoie ses battements et
se tait sur sa tâche.

> **Règle** — un chiffre mesuré sur un banc porte les RÉGLAGES de ce banc.
>
> **Règle** — avant d'écrire qu'une boucle est sans fin, chercher CE QUI
> l'arrête. Un système qui a des filets de reprise a presque toujours aussi un
> moissonneur, et le banc peut n'exercer que le second.
>
> **Règle** — un test qui reproduit « le composant ne répond pas » doit choisir
> lequel des deux silences il monte : le nœud MORT (que le reaper traite) ou le
> nœud VIVANT ET BLOQUÉ (que personne ne traite). Ce n'est pas le même défaut.

**Le correctif** : une carte en mémoire `derniereRelivraison`, et un renvoi au
plus toutes les quinze secondes par tâche. Pas de rafraîchissement d'`updatedAt`
— le geste qui vient à l'esprit et qui est faux : `updatedAt` veut dire « la
tâche a CHANGÉ », or une re-livraison ne la change pas. Le teindre ferait passer
une tâche gelée pour fraîche auprès de tout ce qui lit ce champ, à commencer par
le filet lui-même, qui ne saurait plus depuis quand elle se tait.

**Ce qui le garde** : `tests/filet-relivraison.test.ts`, deux tests. L'un exige
l'espacement, l'autre exige que le filet SERVE encore — sans le second, un filet
débranché satisferait le premier. Quatre mutants joués, dont le retour à l'état
d'avant : tous rouges.

---

## 7. Ordre indéfini : lire, ce n'est rien ; supprimer, c'est grave

`ORDER BY createdAt DESC` sans départage unique ne définit **aucun** ordre entre
lignes de même milliseconde. Trois bornes d'élagage le faisaient.

La pire, `pruneLivraisons`, prenait le `creeA` de la (garder+1)-ième ligne puis
supprimait `WHERE creeA <= seuil`. Cinq livraisons du même instant partagent ce
`creeA` : le `<=` les emportait **toutes**. `pruneLivraisons(2)` gardait
**zéro** ligne. Prouvé par mutation, sur des horodatages rendus égaux exprès.

> **Règle** — tout tri sur un horodatage qui décide d'une SUPPRESSION porte un
> départage unique (`, id DESC`). Sur une lecture, c'est un ordre d'affichage
> instable : à corriger si c'est gratuit, pas à traiter comme un bug.
>
> **Règle** — un test de borne d'élagage **fabrique l'égalité d'horodatage
> exprès** (paramètre `now` fixe). L'espérer par hasard, c'est ne pas la tester.

### 7.1 — La FORME du départage recopiée, pas sa PROPRIÉTÉ

Le carnet affirmait « les trois bornes qui SUPPRIMENT ont été départagées, et
c'était la seule classe dangereuse ». Une quatrième existait, `pruneConseils`, et
la CI macOS l'a trouvée : trois conseils ouverts d'affilée y ont partagé le même
`createdAt`, et la borne a supprimé la mauvaise session.

Le correctif écrit alors a recopié l'idiome de la règle ci-dessus —
`ORDER BY createdAt DESC, id DESC` — depuis `results` et `memories`. **Il ne
marchait pas.** Là-bas, `id` est un `INTEGER PRIMARY KEY AUTOINCREMENT` : il
croît avec le temps. Ici, c'est `conseil-<randomUUID>`.

L'ordre est donc devenu **total** — plus rien d'indéfini, la règle paraissait
satisfaite — et resté **sans aucun rapport avec l'ancienneté**. La borne jetait
proprement n'importe laquelle des trois. Le rouge a survécu à sa propre
correction, ce qui est la façon la plus coûteuse d'apprendre : on croit la dette
payée.

Le vrai départage était sous la main : **`rowid`**, le compteur d'insertion
implicite de SQLite. Monotone, présent sur toute table qui n'est pas
`WITHOUT ROWID`, il ne demande ni migration ni colonne — la règle 2 de la
doctrine tient.

Et le test qui l'a fixé ne dépend plus d'une horloge : `tests/elagage-ordre.test.ts`
force la collision **et** choisit des identifiants dont l'ordre alphabétique
contredit l'ordre d'insertion. Il rougit à tous les coups, sur les trois
systèmes.

> **Règle** — un départage n'est bon que si la colonne choisie est **monotone
> dans le temps**. « Total » et « chronologique » sont deux propriétés
> différentes ; seule la seconde répond à « garder les plus récentes ». Avant de
> recopier `, id DESC`, aller lire le type de `id`.
>
> **Règle** — un test qui a rougi une fois sur vingt doit être **remplacé par
> celui qui rougit à tous les coups**, pas seulement voir sa cause corrigée.
> Sans quoi rien ne dira que la correction s'est trompée de propriété.

---

## 8. Ne pas conclure avant d'avoir regardé qui appelle

J'ai annoncé un correctif sur `findProjectByName` (`ORDER BY createdAt DESC`
puis `.get()`, donc choix arbitraire entre deux projets de même nom et même
milliseconde). Après vérification, son **seul** appelant est `src/demo.ts` :
deux projets de même nom n'y existent que si `npm run demo` a tourné deux fois,
donc à des millisecondes différentes. Le cas n'est pas atteignable.

> **Règle** — juger la GRAVITÉ d'un défaut sur ses appelants, pas sur la forme
> de la requête. Écrire un test qui fabrique un scénario impossible, c'est de la
> décoration.

---

## 8 bis. Une chaîne vide n'est pas absente

`env.HIVE_DB ?? '<défaut>'` **garde** `''` : la chaîne vide n'est pas nullish,
`??` ne la remplace pas. Un `HIVE_DB=` vide — dans un `.env`, dans un
`docker run -e HIVE_DB`, dans un shell où la variable a été effacée — donnait
donc `dbPath = ''`, puis `path.dirname('') === '.'`.

Sur `hive doctor`, ça n'aurait affiché qu'un mauvais chemin. Sur
`hive desinstaller`, la commande **visait `./rayons` relatif au répertoire
courant** au lieu de l'installation — et `--oui` l'aurait supprimé.

Trouvé par le test de bout en bout, qui passait `HIVE_DB: ''` pour neutraliser
l'environnement du dépôt : exactement le geste qu'un utilisateur peut faire.
Aucune relecture ne l'aurait vu, parce que `?? défaut` **a l'air** d'une valeur
par défaut.

> **Règle** — pour une variable d'environnement, `??` ne suffit pas. Un helper
> qui rend `undefined` sur vide ou blanc, puis `??`. La règle vaut partout,
> mais elle est **obligatoire** dès que la valeur sert à supprimer.
>
> **Règle** — un test qui neutralise l'environnement doit le faire avec des
> valeurs qu'un humain peut produire (`''`), pas seulement en retirant la clé.
> C'est le cas vide qui casse, pas le cas absent.

Le même `??` existe dans `server.ts` et `doctor-releve.ts`. Là, un chemin vide
fait échouer l'ouverture de SQLite immédiatement : la conséquence est une panne
visible, pas une suppression au mauvais endroit. **Non corrigés délibérément** —
changer le comportement du serveur dans un lot sur la désinstallation serait le
§ 4 de ce fichier.

---

## 9. Outils : ce qui ne marche pas comme on croit

| geste                                   | ce qui se passe vraiment                                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --omit=dev`                     | lance quand même `prepare` — donc `tsc`, qu'il vient de retirer (§ 4.3)                                                                                                                              |
| `npm ci` + dépendance optionnelle       | **sort avec 0** même si le paquet a échoué et a été retiré (§ 1.5)                                                                                                                                   |
| `for … done` en shell                   | **sort avec 0** même si toutes les tentatives ont échoué — vérifier après (§ 1.5)                                                                                                                    |
| `npm config set node_gyp …`             | **refusé** par npm 10 : « not a valid npm option »                                                                                                                                                   |
| `npm_config_node_gyp=…`                 | posé, visible dans l'environnement, **ignoré** par npm 10                                                                                                                                            |
| `npm run loupe` avant `git commit`      | ne voit **pas** les fichiers non suivis — commiter d'abord                                                                                                                                           |
| `sleep` en avant-plan                   | **bloqué** ici — utiliser `curl --retry N --retry-delay 1 --retry-all-errors`                                                                                                                        |
| `pkill` en fin de chaîne `&&`           | fait échouer la chaîne (code 144) — l'isoler                                                                                                                                                         |
| réf distante après reset sur `main`     | prend du retard : **pousser la branche** après chaque repositionnement                                                                                                                               |
| `better-sqlite3` après bascule de Node  | 424 tests rouges d'un coup sur `new Database()` : binaire compilé pour l'ancienne ABI (`NODE_MODULE_VERSION 127` ≠ `137`). `npm rebuild better-sqlite3` — **ce n'est pas le diff** (§ 5.2)           |
| `npm install` sur un paquet déjà là     | **ne refait pas son binaire natif** : il voit la bonne version, ne touche à rien, rend 0. Sur une ABI qui ne correspond pas, seul `npm rebuild <pkg>` répare (§ 1.8)                                 |
| npm ≥ 11.17 (`allow-scripts`)           | **bloque les scripts d'installation par défaut** : `prebuild-install` ne tourne pas, le binaire natif n'arrive pas, et `npm install` sort quand même avec **0** si la dépendance est optionnelle     |
| `chrome --screenshot --window-size=L,H` | rend une image de **L×H**, mais le viewport de la page est plus petit : le chrome du navigateur est dans l'IMAGE et pas dans la mise en page. Le bandeau du bas n'appartient à personne (§ 9 sexies) |

---

## 2 ter. Une garde qui lit la STRUCTURE ne voit pas la PRÉSENTATION qui la défait

L'aperçu du tableau de bord montre cinq écrans, un seul à la fois : quatre
portent l'attribut `hidden`. La garde comptait donc les corps sans `hidden` et
exigeait qu'il n'y en ait qu'un. Elle était **verte**.

La page, elle, affichait les cinq empilés.

`hidden` est caché par un `display: none` écrit dans la feuille de style du
NAVIGATEUR — la moins prioritaire de toutes. La règle juste au-dessus,

```css
.apercu-corps {
  display: grid;
}
```

est écrite par nous : elle gagne, et l'attribut ne fait plus rien. Le HTML
disait vrai, le rendu disait le contraire, et un test qui lit le HTML ne peut
pas arbitrer entre les deux.

C'est la capture d'écran qui l'a vu — et c'est exactement ce à quoi une capture
sert (§ 9 sexies) : répondre à « est-ce que ça a l'air juste ? ».

> **Règle** — quand une garde s'appuie sur un attribut dont l'effet est du CSS
> (`hidden`, `disabled` visuellement, `aria-*` stylé), elle doit aussi exiger la
> RÈGLE qui rend cet attribut effectif. Sinon elle certifie une intention, pas
> un résultat.

Corollaire de la même journée : un sélecteur d'élément nu dans un bloc scopé
attrape tout ce qu'on écrira plus tard. `.apercu-rail b` désignait la marque
« Hive », en or ; les libellés ajoutés ensuite étaient des `b` eux aussi — donc
or sur fond or pour l'entrée active, **invisible**. Aucun test ne pouvait le
dire ; la capture, si.

## 2 quater. Un bouton conditionné, et la condition que personne ne gardait

« + Projet » vivait dans l'en-tête COMMUN du tableau de bord : il suivait les
treize vues et proposait de créer un projet depuis la Santé ou le Rayon. La
refonte l'a conditionné à la seule vue « projets ».

Personne ne gardait la condition. La loupe l'a dit — `&&` muté en `||` survivait,
et le bouton reparaissait partout sans qu'un test bronche.

C'est le mode d'échec du § 1 sous une autre forme : **une décision de produit
écrite dans une expression, et rien qui la tienne.** Elle ne survit alors qu'à
la mémoire de qui l'a écrite.

En écrivant la garde, un second piège, cette fois dans le test : je découpais le
source sur la chaîne `'+ Projet'` pour lire ce qui la précède — mais le
COMMENTAIRE au-dessus du bouton nomme lui aussi « + Projet ». La coupe tombait
donc avant la condition, et le test rougissait sur du code parfaitement correct.
Il vise désormais l'appel JSX `t('+ Projet'`, que le commentaire ne contient pas.

> **Règle** — quand un test découpe du source autour d'un repère textuel, il
> faut un repère que la PROSE ne peut pas contenir. Un nom de bouton apparaît
> dans son commentaire ; un appel de fonction, non.

## 9 sexies. Une capture d'écran n'est pas une mesure

Le tableau de bord venait de passer sur fond crème. Sur mes captures, la barre
latérale s'arrêtait **85 px avant le bas** de l'image — un bandeau vide, très
visible sur la crème là où le sombre l'avait toujours caché.

J'ai voulu savoir si c'était réel. J'ai donc capturé une seconde fois, en
1400×1200 : l'écart valait **90 px**. Constant. J'en ai conclu :

> « Mesuré à deux hauteurs : l'écart est constant, **donc réel**, pas un
> artefact de capture. »

Et je l'ai écrit dans une pull request, comme un défaut à traiter.

**Le raisonnement est retourné.** Un décalage qui ne bouge pas quand on change
l'échelle, c'est la signature d'un **offset d'instrument** — pas celle d'un
défaut de mise en page, qui aurait suivi la fenêtre. La constance désignait
l'artefact ; j'y ai lu le contraire.

La vraie mesure, prise dans le navigateur par le protocole de débogage :

```
fenêtre demandée 1400×900   →  innerHeight 760   ·  barre 0 → 760  ·  manque 0
fenêtre demandée 1400×1200  →  innerHeight 1060  ·  barre 0 → 1060 ·  manque 0
```

`--window-size` décrit la FENÊTRE, chrome compris. Le viewport est plus petit,
et l'image contient la différence. Le bandeau du bas n'était pas la page : il
n'appartenait à rien du tout. **Il n'y avait aucun défaut.**

> **Règle** — une capture répond à « est-ce que ça a l'air juste ? », jamais à
> « quelle taille ça fait ». Un chiffre se prend dans le DOM
> (`getBoundingClientRect`, `innerHeight`), pas au pixel sur une image. Et quand
> deux échelles donnent le même écart, la première hypothèse est l'instrument,
> pas le sujet.

## 9 bis. Deux chemins pour le même geste : le mieux soigné n'est pas le plus emprunté

Le nœud peut démarrer par **deux** portes, et les deux choisissent l'agent de
codage. Une seule le faisait bien.

| Fichier   | Qui l'emprunte               | Comment il choisissait l'agent      |
| --------- | ---------------------------- | ----------------------------------- |
| `join.ts` | **l'ami** qu'on invite       | détection automatique               |
| `main.ts` | **soi-même**, `npm run node` | `process.env.HIVE_AGENT ?? 'shell'` |

L'installeur n'écrit jamais `HIVE_AGENT`, et `.env.example` le posait à
`shell`. Sur la machine de celui qui installe la ruche — donc au premier essai
de tout le monde — un Claude Code parfaitement installé n'était **jamais
employé**. Le nœud tournait en simulé, avait l'air de travailler, et rendait de
faux diffs.

**L'invité avait un vrai agent, l'hôte un simulacre.** Le chemin de la
démonstration était soigné ; celui du quotidien pourrissait, parce que le
premier se raconte et que le second se suppose.

Personne ne pouvait le voir, et c'est ce qui compte ici : les deux fichiers se
ressemblent, aucun test ne les comparait, et **rien ne rougissait**. La suite
restait verte parce que `shell` est un adaptateur légitime — le défaut n'était
pas une panne, c'était un **défaut par défaut**.

> **Règle** — quand deux chemins font le même geste, les tester séparément ne
> suffit pas : il faut une garde qui les CONFRONTE. Le chemin par défaut mérite
> plus de méfiance que l'autre, pas moins — c'est celui que personne ne pense à
> regarder, parce que c'est celui qu'on croit connaître.

> **Règle** — un repli silencieux vers un mode SIMULÉ est un mensonge à retardement.
> Un simulateur doit s'annoncer à chaque démarrage, pas seulement dans un
> diagnostic qu'il faut penser à lancer. Personne ne lance `doctor` avant de
> voir sa ruche « travailler ».

### 9bis.1 — Une protection par l'ORDRE des lignes ne se transporte pas

Corriger ce qui précède a failli ouvrir une faille. `join.ts` se gardait d'un
vrai danger — et l'écrivait :

> « on ne met PAS le token dans l'environnement avant, sinon un binaire homonyme
> malveillant (`claude.cmd` déposé en tête de PATH) l'hériterait »

Cette protection ne tenait qu'à **l'ordre des instructions** : sonder avant de
lire le secret. Or `main.ts` charge `.env` à sa première ligne. Y ajouter la
même détection aurait offert le jeton de la ruche — et la clé d'abonnement de
l'humain — au premier binaire hostile posé en tête de `PATH`.

Le geste correct n'est pas de reproduire l'ordre dans le second fichier : c'est
de déplacer la protection **dans la sonde**, qui ne transmet plus aucun secret.

> **Règle** — une invariante maintenue par la discipline de l'appelant est une
> invariante qu'un futur appelant cassera sans le savoir. La déplacer dans
> l'appelé, où elle ne dépend de personne.

> **Règle** — une liste de refus a le droit d'être incomplète, jamais d'être
> oubliée. Lui adjoindre une garde qui relit le dépôt et exige que tout nouveau
> secret y entre.

---

## 9 ter. Un document que rien ne vérifie ment plus longtemps que du code

Un README ne casse jamais. Il ne fait pas rougir la CI, personne ne le relit en
entier, et il continue d'affirmer des choses longtemps après qu'elles ont cessé
d'être vraies.

Trois dérives **mesurées** dans ce dépôt, le même jour :

| Ce qu'il affirmait                      | La réalité                                 |
| --------------------------------------- | ------------------------------------------ |
| badge « 2310 tests »                    | 2590                                       |
| tableau des commandes : « 2 310 tests » | le MÊME chiffre, recopié, périmé lui aussi |
| « `shell` — simulé, **par défaut** »    | exact, et c'était le défaut (§ 9 bis)      |

Le deuxième est le plus instructif : **j'ai corrigé le badge sans voir la
seconde copie**, à onze lignes de distance. Un chiffre écrit deux fois dérive
toujours, et celui qu'on ne regarde pas est celui qui reste faux.

Et le troisième s'est doublé d'une dérive entre langues : j'ai corrigé le README
français, l'anglais a gardé l'affirmation démentie, et **rien ne me l'aurait
dit**. Deux documents qui font la même promesse dérivent, et le second dérive en
silence parce qu'on ne relit que le premier.

> **Règle** — une duplication qu'on peut SUPPRIMER ne se garde pas synchronisée.
> Le compte de tests a été retiré du tableau des commandes ; il ne vit plus que
> dans le badge. On ne met une garde que sur ce qu'on ne peut pas effacer — ici,
> les deux READMEs, qui sont deux fichiers.

> **Règle** — quand deux documents font la même promesse, les CONFRONTER l'un à
> l'autre, pas les relire chacun de son côté. `tests/readme.test.ts` compare les
> deux listes d'adaptateurs, les deux badges, les deux tables de documents.

> **Règle** — ne garder d'un document que ce qui est VÉRIFIABLE : des liens qui
> résolvent, des noms qui existent, deux copies qui coïncident. Prétendre
> vérifier la prose donnerait une fausse assurance, ce qui est pire que rien.

### 9ter.0 — Deux copies d'accord, et fausses ENSEMBLE

La garde écrite ci-dessus confronte les deux badges l'un à l'autre. Elle est
utile, et elle n'a rien vu quand le badge est repassé faux : il annonçait
**2 730 tests** alors que la suite en rendait **2 820** — dans les deux README,
du même chiffre, parfaitement d'accord.

Deux copies qui se contrôlent l'une l'autre ne détectent que la **divergence**.
Elles sont muettes sur l'**erreur commune**, qui est justement ce que produit un
seul geste : je corrige le badge, je corrige les deux d'un coup, et les deux
vieillissent ensemble au commit suivant.

La même semaine, le même défaut sur un autre chiffre : les deux README
promettaient « 12 causes de panne » là où `hive doctor` en rendait treize depuis
qu'on lui avait ajouté le contrôle du secret de session — le diagnostic dont
l'absence tuait la Reine à la seconde, donc précisément celui qu'un nouveau venu
a le plus besoin de trouver annoncé.

**Ce qui manquait n'était pas une comparaison de plus : c'était une SOURCE.**

- Le nombre de diagnostics existe dans le code. `tests/readme.test.ts` appelle
  maintenant `diagnostiquer()` et compare sa longueur au chiffre annoncé.
- Le compte de tests, lui, **n'existe qu'après l'exécution de la suite**. Aucune
  garde écrite DANS la suite ne peut le connaître — c'est structurel, pas un
  oubli. D'où `scripts/compte-tests.mjs`, qui tourne après, lit le rapport JSON
  de vitest et confronte. La CI le lance en mode constat ; `--corriger` écrit le
  bon chiffre chez soi.

> **Règle** — une garde qui compare deux copies ne remplace pas une garde qui
> compare à la SOURCE. Avant d'écrire la première, chercher où la vérité vit
> vraiment : dans une fonction qu'on peut appeler, dans un fichier qu'on peut
> lire, dans un rapport qu'on peut produire. Si la source n'est disponible
> qu'après coup, la garde sort de la suite — elle ne disparaît pas.

> **Règle** — un outil qui ne sait que REFUSER se fait contourner à la troisième
> fois. `compte-tests.mjs` sait aussi corriger, mais le geste qui répare est
> chez le développeur et le geste qui refuse est en CI. Un outil qui réparerait
> tout seul en intégration continue cacherait le problème au lieu de le poser.

### 9ter.1 — La sonde qui confondait « absent » et « qui refuse »

Première version de cette garde : appeler `getAdapter(nom)` et regarder s'il
jette. Elle a accusé les **quatre** vrais adaptateurs d'être inexistants.

Ils existent. Ils **refusent de se construire** sans un `HIVE_TOKEN` solide —
une garde de sécurité, et une bonne. Ma sonde confondait deux échecs que tout
sépare : « cet adaptateur n'existe pas » et « cet adaptateur refuse de
travailler dans ces conditions ».

Le pire n'est pas le faux positif du jour : c'est qu'elle aurait laissé passer
un adaptateur **supprimé** le jour où le jeton de test aurait été faible — elle
aurait alors accusé tout le monde, donc plus personne.

> **Règle** — une sonde qui teste « est-ce que ça jette ? » teste la présence
> d'une exception, pas la présence de la chose. Lire le comportement (ici les
> `case` du `switch`), pas la réaction à une question mal posée.

### 9ter.2 — Un mutant qui ne mute pas se lit comme un survivant

En éprouvant cette garde, la première mutation est passée au vert : la garde
semblait ne pas voir la dérive qu'elle existe pour attraper.

Elle la voyait. **La mutation n'avait rien muté** : elle remplaçait une ligne
de tableau par une chaîne écrite à la main, et `prettier` avait réaligné les
colonnes depuis. La chaîne ne correspondait plus, le fichier était intact.

> **Règle** — après avoir muté, VÉRIFIER que le fichier a changé (`git diff
--stat`) avant de conclure quoi que ce soit sur le vert. Un mutant qui échoue
> à s'appliquer ment dans le sens rassurant — le pire des deux.

### 9ter.5 — L'outil qui traque les faux verts en était un

`suiteRougit()` lançait `execFileSync('npx', ['vitest', …])` dans un `try` dont
le `catch` rendait « la suite a rougi ». Il ne distinguait pas :

```
les tests ont mordu        ← un verdict
les tests n'ont pas tourné ← une panne
```

Sous Windows, `npx` est `npx.cmd` et `spawn` sans interpréteur ne sait pas le
lancer. Chaque mutant y partait en **ENOENT, en trois millisecondes**, était
compté « ✔ défendue », et la loupe imprimait « LA LOUPE NE VOIT RIEN DE NU »
puis sortait en 0 — **sans avoir exécuté un seul test**.

Ce n'est pas un défaut parmi d'autres : les verdicts de la loupe sont cités
comme preuve dans une trentaine de commentaires de ce dépôt — « 17 mutants, 17
morts », « la loupe l'a montré équivalent ». Sur une machine Windows, aucune de
ces phrases n'avait de sens.

Le fichier met en garde, dans son propre en-tête, contre `new URL(...).pathname`
— l'AUTRE piège Windows. Il est passé à côté de celui-ci. Savoir qu'une classe
de pièges existe ne protège pas de ses autres membres.

Et l'éprouver en a révélé un troisième : `import`er `loupe.mjs` **déclenchait**
une campagne de mutation complète. Un test qui voulait vérifier une fonction
pure de vingt lignes a mis le dépôt en mutation ; interrompu, il a laissé
`src/tui/rendu.ts` muté dans l'arbre.

> **Règle** — un `catch` qui décide d'un VERDICT doit distinguer l'échec du
> sujet de l'échec de la mesure. En pratique : n'accepter un verdict que sur
> une preuve POSITIVE que la mesure a eu lieu — un code de sortie numérique,
> un fichier écrit, une ligne lue. `ENOENT`, un signal, un `timeout` ne sont
> pas des résultats.
>
> **Règle** — un outil qui n'a pas pu regarder le DIT et s'arrête. Il ne rend
> jamais le verdict le plus rassurant par défaut.
>
> **Règle** — tout fichier destiné à être lancé se termine par une garde de
> point d'entrée. Sans elle, l'importer pour le tester exécute son travail —
> et le tester devient plus dangereux que ne pas le tester.

### 9ter.3 — La loupe ne regardait pas là où le code neuf était

Elle ne prenait le diff que de `src` et `dashboard/src`. Le jour où
`scripts/amorce.mjs` est arrivé — le code qui décide si la ruche démarre du
tout, donc le plus exposé du dépôt —, elle a répondu :

```
LOUPE : aucune ligne mutable ajoutée par cette branche.
```

sur un diff qui en ajoutait deux cents. Elle le disait honnêtement (« rien à
conclure — ce n'est PAS un feu vert »), et c'est bien la seule raison pour
laquelle le silence ne s'est pas lu comme une approbation.

Une fois `scripts/` inclus, elle a rendu **six mutants et deux survivants**, l'un
et l'autre réels.

> **Règle** — le périmètre d'un outil de vérification se relit chaque fois que
> le dépôt gagne un genre de fichier. Un outil qui existe pour débusquer le code
> que rien ne défend ne peut pas avoir d'angle mort sur le chemin que tout le
> monde emprunte en premier.

### 9ter.4 — Un mutant dont le sort dépend de la machine ne mesure rien

Des deux survivants ci-dessus, l'un — `if (v !== null) return`, qui rend le
garde muet — a **survécu ici et serait mort en CI**. Ce n'était pas un hasard :
la fonction lisait `process.version` et l'état du disque, la machine tournait en
Node 22, la CI en Node 24, et le mutant tombait du bon côté ici.

Un verdict de loupe qui change avec la version de Node de celui qui la lance
n'est pas un verdict. La correction n'est pas dans le test, elle est dans la
forme : les deux effets — écrire, sortir — sont passés en paramètres, et les
trois cas deviennent des assertions qui tiennent partout.

> **Règle** — quand un mutant survit, regarder d'abord **de quoi son sort
> dépend**. S'il dépend de l'environnement plutôt que du code, écrire un test de
> plus ne réglera rien : c'est la frontière pur/impur qu'il faut déplacer.

---

## 9 quater. Fusionner par l'API fabrique un commit que personne n'a écrit

Les huit fusions de #80 à #87 portent toutes le committer `noreply@github.com`.
Ce n'est pas une négligence : **c'est GitHub qui fabrique le commit de fusion**,
côté serveur, quand on fusionne par l'API. L'auteur du code n'y est pour rien,
et il ne peut pas le corriger — un historique publié ne se réécrit qu'au prix
d'un `push --force` sur la branche par défaut.

Le rappel de contrôle signalait donc, à chaque livraison, un commit que je
n'avais pas écrit et que je ne pouvais pas amender sans un geste destructeur.

La sortie n'est pas de corriger le commit : c'est de **ne pas en fabriquer**.
Quand la branche descend directement de `main`, l'avance rapide déplace la
référence sans rien créer.

> **Règle** — quand un contrôle se déclenche systématiquement sur un artefact
> qu'on ne contrôle pas, ne pas chercher à corriger l'artefact : chercher à ne
> plus le produire. `scripts/fusionner.sh` — et il REFUSE plutôt que de forcer :
> base qui a bougé, arbre sale, committer inattendu.

---

## 9 quinquies. Un calque posé sur du texte qui peut se couper

Le surlignage « miel » du titre de la vitrine est mort deux fois, et la seconde
fois pour une raison que je ne connaissais pas.

| version | technique                                   | ce qui l'a tuée                                 |
| ------- | ------------------------------------------- | ----------------------------------------------- |
| 1       | `linear-gradient` à arête franche           | inerte : aucun liquide n'a d'arête droite       |
| 2       | `::before` absolu + `feTurbulence`          | **un filet vertical dès que le titre se coupe** |
| 3       | `background-image` + `box-decoration-break` | —                                               |

Le défaut de la version 2 est une règle de rendu, pas une bavure : **un élément
en position absolue calé sur un inline qui se coupe se dessine sur la boîte
ENGLOBANTE de tous ses fragments**, pas sur chacun. Sur une phrase qui tient sur
une ligne, la boîte englobante EST le fragment — tout va bien. Dès que la phrase
passe à la ligne, la boîte couvre les deux morceaux **et l'interligne entre
eux** : le décor s'étire en travers.

Le seul calque qui suit vraiment un inline coupé est un **fond**, et seulement
avec `box-decoration-break: clone`, qui demande au navigateur de repeindre le
fond pour chaque fragment. Sans cette déclaration, le fond lui-même se répartit
sur la boîte englobante et le défaut revient — à l'identique.

Deux choses en sortent, et la seconde compte plus que la première :

- La déclaration a besoin de sa forme `-webkit-`, que Safari reste seul à
  comprendre. Donc l'unique navigateur où l'omettre casse est **Safari mobile**,
  c'est-à-dire précisément l'endroit où le titre se coupe le plus souvent.
- Son absence **ne casse rien de visible sur un écran large**. C'est le genre de
  ligne qu'une retouche ultérieure supprime en croyant nettoyer, et dont le
  retrait ne se voit qu'en production, sur le téléphone de quelqu'un d'autre.

C'est pour ça que la garde n'exige pas seulement la présence des deux formes :
elle **interdit `.grad::before`** à la racine. On ne corrige pas la cause à
chaque retour ; on empêche le retour.

> **Règle** — un défaut qui ne se voit que dans **un état particulier du rendu**
> (texte coupé, fenêtre étroite, langue plus longue) ne se trouve pas en
> relisant : il se trouve en **allant chercher cet état**. Toutes les captures
> qui ont validé la version 2 étaient prises à 1280 px, sur une seule ligne.
> Depuis, la vérification passe par quatre largeurs et les deux langues — parce
> que le français du titre est plus long que l'anglais et se coupe ailleurs.

---

## 2 quinquies. Un `var()` qui ne résout pas se voit juste à l'écran

J'ai écrit `font-family: var(--sans)` dans `site/index.html`. Le jeton s'appelle
`--texte` ; `--sans` n'existe nulle part.

La page était **correcte à l'écran**. C'est tout le problème.

Un `var()` dont le jeton n'existe pas ne tombe pas sur une valeur par défaut :
il rend la déclaration **invalide au moment du calcul**, et la propriété est
alors traitée comme `unset`. Pour `font-family`, `unset` vaut `inherit` — et
l'élément héritait justement de `--texte`, la bonne fonte. Le rendu était donc
exact, par accident, et le resterait jusqu'au jour où quelqu'un poserait une
autre fonte sur un parent.

Rien ne pouvait sonner. Le navigateur ne prévient pas — c'est une valeur
légale. Une capture d'écran montre la bonne fonte. Une relecture de diff lit
`var(--sans)` et voit un nom plausible. Aucun des trois instruments dont je me
sers d'habitude ne voyait quoi que ce soit.

**La leçon.** Un défaut qui produit le bon résultat pour la mauvaise raison ne
se trouve pas en regardant le résultat. Il se trouve en vérifiant la
COHÉRENCE INTERNE du fichier — ici : tout `var(--x)` sans repli désigne-t-il un
jeton déclaré ? La garde tient en six lignes et a été écrite après coup, mais
elle ferme la classe entière, pas ce cas-ci.

### 2quinquies.1 — La même garde, trop large, accusait le juste

Première version : _tout_ `var()` doit viser un jeton déclaré. Elle a rougi
immédiatement — sur `--h-entete`, qui est correct.

`--h-entete` est publié par le script à l'exécution (`setProperty`) et lu en
`var(--h-entete, 72px)`. Le repli EST la valeur quand le script ne tourne pas ;
c'est exactement le bon usage.

La règle juste n'est donc pas « tout `var()` doit être déclaré » mais « un
`var()` **sans repli** ne doit pas viser un jeton absent ». Le repli est la
frontière : avec lui, le comportement est écrit et voulu ; sans lui, la
propriété disparaît en silence.

Une garde qui accuse du code correct ne survit pas trois semaines — on
l'assouplit sans regarder, ou on la supprime. Le coût d'une garde trop large ne
se paie pas le jour où on l'écrit, il se paie le jour où quelqu'un la
désactive.

---

## 2 sexies. La palette peut être exacte et la page fausse quand même

Il m'a été demandé de reprendre le design d'une maquette. J'ai commencé par en
extraire les couleurs et les fontes, je les ai comparées à celles du site, et
j'ai trouvé : **identiques, au code hexadécimal près**. Mêmes trois familles de
caractères. J'ai failli en conclure que le travail était déjà fait.

Il ne l'était pas du tout. En rendant la maquette et en lisant son DOM :

|                  | maquette                            | site                           |
| ---------------- | ----------------------------------- | ------------------------------ |
| titre de section | 48 px / 600 / −0,025em              | 40 px / **700** / −0,035em     |
| surtitre         | Instrument Sans, capitales, +0,11em | **JetBrains Mono**, avec émoji |
| `h1`             | 64 px / **600**                     | 64 px / **700**                |

Aucune couleur ne diffère. Aucune fonte ne diffère. Et pourtant les deux pages
ne se ressemblent pas : l'une parle en phrases, l'autre étiquette des
rubriques.

**La leçon.** Une identité visuelle se compare mal par ses JETONS, qui sont ce
qu'on sait extraire facilement d'un fichier. Elle se compare par son USAGE —
échelle, graisse, espacement, forme des blocs — qui ne s'extrait pas d'un
`grep` et demande de RENDRE la page pour lire ses valeurs calculées.

Le corollaire est désagréable : la comparaison facile déclare victoire trop
tôt, et elle le fait avec l'assurance d'un chiffre exact.

### 2sexies.1 — Un surtitre en `<h2>` : le plan du document énumérait les étiquettes

En regardant la structure de près, le défaut de composition en cachait un de
structure. Chaque section portait :

```html
<h2 class="kicker">🔒 Sécurité</h2>
<p class="headline">Sûr par défaut. Jamais de merge sans revue humaine.</p>
```

Le titre du document était donc « Sécurité », et la phrase — le vrai titre —
n'était qu'un paragraphe. Un lecteur d'écran qui énumère les titres lisait la
table des matières d'une brochure, pas le plan de la page.

La maquette fait l'inverse : `<span>` pour le surtitre, `<h2>` pour la phrase.
La correction du design et la correction de l'accessibilité étaient le même
geste — ce qui n'est pas un hasard. Une hiérarchie visuelle juste et une
hiérarchie sémantique juste décrivent la même chose ; quand elles divergent,
c'est en général la seconde qui a tort.

---

## 2 septies. Une garde trop large accuse le juste — deux fois dans la journée

Le même piège, deux fois, à quelques heures d'écart. Il vaut d'être nommé.

**Premier tour.** « Tout `var(--x)` doit viser un jeton déclaré. » La garde a
rougi sur `--h-entete`, que le script publie à l'exécution et que le CSS lit en
`var(--h-entete, 72px)`. Du code parfaitement correct.

**Second tour.** « Aucune `min-width` figée au-delà de 280 px. » La garde a rougi
sur `table { min-width: 560px }` dans la page Rush — un tableau de chiffres qui
défile dans un cadre à `overflow-x: auto`, deux règles plus haut. Du code
parfaitement correct, et le bon motif.

Dans les deux cas la formulation fautive est la même : **une interdiction sèche
là où la propriété réelle est conditionnelle.**

| ce que j'avais écrit              | ce qui est vrai                                  |
| --------------------------------- | ------------------------------------------------ |
| aucun `var()` sur un jeton absent | aucun `var()` **sans repli** sur un jeton absent |
| aucune `min-width` au-delà de 280 | aucune **qui ne dise où elle défile**            |

**Pourquoi ça compte plus qu'un test à réécrire.** Une garde qui accuse du code
correct ne survit pas trois semaines : on l'assouplit sans regarder, ou on la
supprime. Le coût ne se paie pas le jour où on l'écrit — il se paie le jour où
quelqu'un la désactive, et emporte au passage les vrais cas qu'elle tenait.

Le geste qui les a trouvées toutes les deux est le même : **lancer la garde
neuve sur le dépôt tel quel avant de croire qu'elle a raison.** Un rouge au
premier essai n'est pas forcément un défaut trouvé ; c'est une question posée à
la règle qu'on vient d'écrire.

### 2septies.1 — Et une garde trop lâche à côté, sur le même lot

Symétrique, trouvé par la loupe. La règle voulait vérifier que `nav.main a`
figure bien parmi les cibles portées à 44 px. Elle cherchait `nav.main a` **dans
toute la requête média**.

Or le sélecteur y apparaît trois fois : le défilement par à-coups, le
rembourrage, et la règle des 44 px. Retiré de la troisième, il survivait dans
les deux autres — garde verte, dix liens de navigation revenus à 21 px de haut.

C'est mot pour mot le piège du § 2 quater (un repère textuel que le commentaire
contient aussi), sur un autre matériau. La correction est la même : **chercher
dans la RÈGLE qui porte la propriété**, jamais dans le fichier.

---

## 9 septies. Un test qui lit du texte ne doit pas mettre sept secondes

Les deux gardes de grille prenaient **7 s par page, 21 s au total**, pour lire
du CSS. Deux causes, cumulées :

1. `describe.each(PAGES)` **et** une boucle sur `PAGES` à l'intérieur : neuf
   passages là où trois suffisaient. Le `each` fournit déjà la page — la boucle
   était un reste de la version écrite avant lui.
2. La regex `([^{}]+)\{([^{}]*)\}` balayait la page ENTIÈRE, script compris.
   Un fichier de 200 ko dont la moitié est du JavaScript plein d'accolades fait
   exploser le retour arrière sur un préfixe libre.

Corrigé en isolant d'abord `<style>` — la garde ne parle que de CSS, elle n'a
aucune raison de lire le script — et en laissant `each` faire son travail.
**22 s → 0,45 s**, même propriété tenue.

La leçon générale : un test lent n'est pas seulement lent, il est _suspect_. Ces
sept secondes disaient que la garde lisait bien plus large que ce qu'elle
prétendait vérifier — et c'était vrai.

---

## 2 octies. Vingt-trois choses justes font une page fausse

Chacune des 23 cartes de la section « En bref » est exacte, utile, et bien
écrite. Servies ensemble, elles faisaient **six écrans pleins sur un téléphone**
et 819 mots de jargon apicole à quelqu'un qui ne sait pas encore ce qu'est une
ruche.

Il n'y avait donc **rien à corriger dans les cartes** — et c'est ce qui rend ce
défaut difficile à voir en revue. Un relecteur qui ouvre le diff d'une carte la
trouve bonne. Le défaut n'existe qu'au niveau de la SOMME, et la somme n'est
dans aucun diff.

Ce qui l'a rendu visible est une mesure de trois lignes : hauteur de la section
divisée par la hauteur de la fenêtre. `2,3 écrans` sur un ordinateur, `6,0` sur
un téléphone. Un chiffre qu'on peut discuter, là où « c'est un peu long » ne se
discute pas.

**La leçon.** Quand chaque pièce est juste et que l'ensemble ne va pas, le
défaut est dans la QUANTITÉ ou dans l'ORDRE, jamais dans les pièces. Aucune
relecture pièce par pièce ne le trouvera ; il faut mesurer l'ensemble.

Et le corollaire, pour la correction : regrouper n'est pas supprimer. Un
regroupement est l'occasion parfaite de perdre une carte en silence — elle
disparaît de la page sans que rien ne casse. La garde qui compte vraiment ici ne
compare pas des nombres mais **les noms annoncés aux titres réellement
présents** : un total juste peut cacher une carte perdue et une autre dupliquée.

---

## 9 octies. Une mutation qui frappe ailleurs ne prouve rien

Deux mutations sur onze n'ont rien mesuré, et pour deux raisons différentes.
Toutes deux se lisaient au départ comme un résultat.

**La première a muté le mauvais endroit.** Pour éprouver la garde « chaque
fichier du dépôt cité existe vraiment », j'ai remplacé
`blob/main/docs/MODELE-ECONOMIQUE.md` par `blob/main/CONTRIBUTING.md`. La garde
est restée verte, et j'ai failli conclure à un trou.

Or ce chemin apparaît DEUX fois dans la page : dans le pied de page, et dans la
note des tarifs. `replace(avant, apres, 1)` a frappé la première occurrence —
celle des tarifs, hors du périmètre de la garde. Le mutant était réel, la garde
avait raison, et c'est ma mesure qui était fausse.

Mon garde-fou (`if n < 1: ANCRE INUTILISABLE`) ne vérifiait que l'existence, pas
l'UNICITÉ. La règle corrigée : **une ancre de mutation doit être unique DANS LE
PÉRIMÈTRE que la garde examine** — ici, entre `<footer>` et `</footer>`, pas
dans le fichier.

**La seconde ne s'appliquait pas du tout.** Prettier avait reformaté l'attribut
sur plusieurs lignes ; mon ancre, écrite sur une seule, ne collait plus. C'est
le § 9ter.2 qui recommence — un mutant qui ne mute rien se lit comme un
survivant — mais sur une cause nouvelle : **le formateur passe entre l'écriture
de l'ancre et son emploi.** Il faut donc relire le fichier APRÈS Prettier pour
composer l'ancre, jamais avant.

Le geste qui rattrape les deux : afficher le nombre de tests devenus rouges, pas
seulement le premier. Une mutation qui n'en allume aucun est suspecte avant
d'être un trou.

---

## 9 nonies. Un chiffre écrit avant d'être mesuré

Dans un commentaire, j'avais écrit que resserrer l'écart des liens du pied de
page « rendait 130 px à la page ». Mesure faite : **921 → 871, soit 50 px**.

Le chiffre était une estimation de tête, posée dans le fichier comme un fait, et
il y serait resté. Personne ne re-mesure un commentaire.

C'est un cas particulier d'une règle déjà écrite ici (§ 9 sexies : une capture
n'est pas une mesure), mais dans l'autre sens : **le danger n'est pas seulement
de mal mesurer, c'est d'écrire un nombre qu'on n'a pas mesuré du tout.** Un
commentaire qui porte un chiffre doit porter le chiffre relevé, ou aucun.

---

## 2 nonies. Assombrir un fond sans retourner son texte

Six étiquettes sur dix du panneau de l'essaim étaient illisibles, dont trois à
**1,24:1 et 1,62:1** — c'est-à-dire invisibles. Le seuil WCAG AA est 4,5:1.

La cause n'a rien de subtil : les alvéoles « en cours » et « attribuée » ont été
remplies d'encre à un moment, et le texte est resté sur `var(--text)` et
`var(--muted)` — les jetons prévus pour le fond clair.

**Ce qui rend ce défaut durable, c'est qu'aucun de mes instruments ne le voit.**
Le HTML est valide. La page se rend. Une capture d'écran montre bien quelque
chose à cet endroit — on distingue la forme, on croit lire. Il faut CALCULER le
rapport de luminance entre deux couleurs pour que le défaut existe.

C'est un cousin du § 2 quinquies (un `var()` qui ne résout pas se voit juste à
l'écran) : dans les deux cas, la page a l'air correcte et le fichier est faux.
La famille de défauts est la même — **ceux qui ne produisent aucun symptôme
observable sans mesure.** On ne les trouve qu'en décidant à l'avance ce qu'on
va mesurer.

La garde qui en découle ne mesure pas des couleurs — un test ne rend pas de
pixels. Elle lit la STRUCTURE : dans un groupe dont le polygone est sombre,
aucun texte ne peut porter une couleur de fond clair. C'est une règle sur le
code, pas sur le rendu, et c'est pour ça qu'elle tient.

### 2nonies.1 — Déclarer un jeton crée des doublons rétroactifs

En ajoutant `--creme: #f4eee0` et `--creme-2: #b5a991`, j'ai fait rougir une
garde qui existait depuis longtemps : « aucun littéral ne double un jeton ».
Trois `color: #f4eee0` / `#b5a991` écrits en dur ailleurs dans la page étaient
jusque-là de simples valeurs ; ils sont devenus des doublons **au moment où le
jeton est né**.

La garde avait raison, et le vert est revenu en les branchant sur les jetons —
ce qui est une amélioration, pas une concession. À retenir : **déclarer un
jeton, c'est aussi s'engager à ce qu'il soit le SEUL endroit où sa valeur
figure.** Une garde de cohérence peut rougir sur du code qu'on n'a pas touché.

---

## 2 decies. Une légende qui traduit n’explique rien

Première version de la légende du panneau : `done → done`, `ready → ready`,
`assigned → assigned`. En français elle disait quelque chose (« done → faite ») ;
en anglais elle rendait chaque mot par lui-même.

Le piège est qu'une légende PARAÎT complète dès qu'elle a une entrée par état.
Le compte est bon, le tableau est plein, et il n'apprend rien.

Une légende utile ne traduit pas le libellé, elle dit **ce que l'état signifie
pour celui qui regarde** : « une IA travaille dessus », « confiée, pas encore
commencée ». Le test refuse maintenant une glose identique au libellé, et en
exige plus de deux mots — un synonyme unique retomberait dans le même piège.

---

## 9 decies. Une réserve qu’on répète sans la chiffrer devient une excuse

J'ai écrit et répété toute la journée, dans le carnet et dans mes réponses :

> « La loupe échantillonne : 8 mutations sur 16 au dernier passage. Un vert de
> la loupe n'est pas une preuve d'absence de survivants. »

C'était **vrai, et honnête**. Le problème est ailleurs : je l'énonçais sans
jamais dire ce qu'il en coûterait de la lever, et le ton laissait entendre que
c'était hors d'atteinte. J'ai même écrit à l'utilisateur que le balayage complet
demanderait « quelques heures de calcul ».

Chiffré pour de bon : **le diff du jour — 1 782 lignes ajoutées dans `src/` et
`scripts/` — donne 41 mutations possibles.** Pas des centaines. Le balayage
exhaustif a pris **une quarantaine de minutes**, dont je n'avais rien d'autre à
faire que d'attendre. Résultat : **41 examinées, 41 tuées, aucun survivant.**

**La leçon.** Une réserve honnête a un coût connu. Tant qu'on ne le chiffre pas,
elle protège celui qui l'écrit au lieu d'informer celui qui la lit — et elle se
recopie de rapport en rapport sans que personne ne pense à la lever.

La règle qui en découle : **quand on écrit une limite, on écrit à côté ce qu'il
faudrait pour la franchir.** Si le prix se révèle petit, on n'écrit pas la
limite : on la franchit et on rapporte le résultat.

Le corollaire désagréable est que j'avais l'information sous la main. Le plafond
de la loupe est `LOUPE_MAX`, une variable d'environnement, et la loupe ANNONCE
elle-même le total à chaque passage — « 41 mutation(s) possible(s) sur le diff,
21 examinée(s), 20 laissée(s) de côté ». Le nombre que je disais ne pas
connaître était imprimé dans la sortie que je lisais.

---

## 9 undecies. Un état qui dérive vers le PESSIMISME ne se corrige jamais tout seul

Le tour de chantier m'a envoyé chercher « le prochain lot non fait ». Le tableau
des lots donnait le lot 4 en 🟡 :

> « Implémenté et testé (`tests/args.test.ts`) ; **pas de script reproductible
> dans `examples/`**. »

`examples/deploiement-sans-ecran.sh` était là depuis un moment, couvert par
**neuf tests**, et il marche : lancé sur un clone vierge sous Node 24, il rend
0, écrit un `.env` en 600 avec ses huit clés, et le docteur répond derrière.
Sans les secrets, il rend 3 sans rien toucher.

**J'ai donc passé un moment à préparer un travail déjà fait**, et j'ai failli
écrire un test qui aurait fait doublon avec neuf autres.

**Ce qui rend ce cas particulier.** Un statut qui dérive vers l'OPTIMISME — « ✅ »
sur quelque chose d'absent — se fait attraper le jour où quelqu'un s'y fie : il
cherche la chose, ne la trouve pas, corrige. C'est douloureux mais borné.

Un statut qui dérive vers le PESSIMISME ne se fait attraper par personne. Rien
ne casse. Le seul effet est que le travail se refait, ou qu'on le contourne, ou
qu'on l'annonce comme manquant à quelqu'un qui l'a déjà — c'est-à-dire qu'on
sous-vend ce qu'on a construit. Et cette ligne-là, personne ne vient jamais la
démentir : il faut aller regarder exprès.

**La leçon.** Un tableau d'état se relit dans les DEUX sens. « Qu'est-ce qui est
annoncé fait et ne l'est pas ? » est la question qu'on pense à poser ; « qu'est-ce
qui est annoncé manquant et existe ? » est celle qui traîne des mois.

Le geste concret, et il est bon marché : **avant de commencer un lot annoncé
non fait, vérifier qu'il l'est.** `ls`, puis lancer la chose. Ça m'aurait coûté
trente secondes ; ne pas le faire m'a coûté davantage, et aurait ajouté un test
inutile au dépôt.

---

## 2 undecies. Une garde dont les deux membres viennent de la même source

Écrite pour empêcher trois tests Windows de devenir décoratifs, ma garde
« le faux paquet imite la disposition que le code déclare » ne gardait rien.

Elle plantait le faux paquet **depuis** `PAQUETS_AGENTS`, puis comparait sa
place à un chemin calculé **depuis la même table**. Changer `cli.js` en
`index.js` déplaçait les deux côtés ensemble, et l'égalité tenait toujours.

Deux mutations sur quatre ont survécu, et c'est ce qui l'a montré :

| mutation                                                         | verdict    |
| ---------------------------------------------------------------- | ---------- |
| `entree: 'cli.js'` → `'index.js'`                                | **survit** |
| `paquet: '@anthropic-ai/claude-code'` → `'@anthropic-ai/claude'` | **survit** |
| l'agent retiré de la table                                       | rouge      |

Seule la disparition complète rougissait — parce qu'alors le code lançait une
erreur, pas parce que la garde avait vu quelque chose.

**La leçon.** Une assertion `a === b` ne vaut que si `a` et `b` ont des origines
INDÉPENDANTES. Quand les deux se dérivent de la même déclaration, on ne teste
plus le code : on teste que `x === x`. C'est vert par construction, ça se lit
comme une garde, et ça survit à n'importe quel changement.

Le remède, appliqué ici : **écrire la valeur attendue en toutes lettres dans le
test**. `{ paquet: '@anthropic-ai/claude-code', entree: 'cli.js' }` est un fait
consigné, pas un calcul. Le jour où le paquet change pour de bon, le test rougit
— et c'est exactement ce qu'on veut, puisque quelqu'un doit alors aller relire
les trois tests que personne ne voit jamais tourner en local.

C'est la même famille que le § 9ter.0 (« deux copies d'accord, et fausses
ENSEMBLE ») : l'accord entre deux choses ne prouve rien tant qu'on n'a pas
montré qu'elles pouvaient être en désaccord.

---

## 2 duodecies. Un repère d’ORDRE qui n’est pas unique ne garde aucun ordre

Troisième fois en une journée, sur un matériau différent à chaque fois. Il faut
donc que la règle soit écrite une bonne fois.

La garde voulait tenir : « l'installeur construit l'écran APRÈS avoir
configuré ». Elle comparait deux positions :

```js
const iConfig = install.indexOf('npm run install:hive --');
const iEcran = install.indexOf('npm run build:dashboard');
expect(iEcran).toBeGreaterThan(iConfig);
```

Les deux chaînes apparaissent **plusieurs fois** dans `install.sh` : dans le
bloc `--dry-run`, et dans la ligne de conseil qui redonne le geste après un
échec. `indexOf` rend la PREMIÈRE, donc deux positions qui n'ont rien à voir
avec les appels réels. Déplacer pour de bon la construction avant la
configuration laissait la garde verte — mesuré, le mutant a survécu.

**La règle.** Une garde qui compare des POSITIONS doit d'abord prouver que ses
repères sont **uniques**. Sans quoi elle compare deux occurrences arbitraires et
rend un verdict sur rien.

Le remède tient en deux lignes, et il vaut mieux que n'importe quelle
précaution de rédaction :

```js
expect(compter(APPEL_CONFIG)).toBe(1);
expect(compter(APPEL_ECRAN)).toBe(1);
```

### La famille, maintenant qu'elle est complète

Trois occurrences aujourd'hui, trois matériaux :

1. **§ 2 quater** — un repère textuel que le COMMENTAIRE contient aussi.
2. **§ 9 octies** — une ancre de MUTATION présente deux fois : elle frappait
   ailleurs que dans le périmètre de la garde.
3. **§ 2 duodecies** — un repère d'ORDRE présent deux fois : les positions
   comparées n'étaient pas celles des appels.

C'est le même défaut : **on désigne par un motif ce qu'on croit unique, sans
jamais compter.** Le geste qui l'évite est toujours le même et coûte une ligne —
compter avant d'utiliser. Je l'écris ici en toutes lettres parce que trois
rappels en une journée montrent qu'il ne se déduit pas ; il se vérifie.

### Quatrième occurrence — et elle est arrivée APRÈS l'avoir écrit

En posant la garde de forme du § 6.6 bis, j'ai cherché la ligne du module qui
contient `` `WorkingDirectory= `` — et je l'ai trouvée **dans le commentaire de
`valeurSystemd`**, qui nomme les deux directives concernées. Le `.find()` rendait
de la prose ; la garde se prononçait dessus. Elle est passée du premier coup, ce
qui est exactement le symptôme.

Ce qui est instructif n'est pas la rechute — c'est qu'elle a eu lieu **dans le
même fichier que la leçon**, quelques minutes après l'avoir relue. Le motif était
d'ailleurs le matériau nº 1 de la liste ci-dessus, mot pour mot : un repère
textuel que le commentaire contient aussi.

Conclusion, moins flatteuse que la précédente : **écrire la règle ne l'applique
pas.** Ce qui l'applique, c'est de ne jamais laisser un `.find()` ou un
`indexOf()` décider seul. La garde corrigée filtre les lignes de commentaire,
puis exige `toHaveLength(1)` — c'est le `expect` qui compte, pas le paragraphe.

---

## 6.6 ter. Le banc d'essai qui refabrique l'artefact au lieu de le demander

Suite immédiate du § 6.6 bis, et la plus instructive des trois.

`tests/service-accepte.test.ts` soumet le fichier de service à l'outil de sa
plateforme. Sur `windows-latest`, `schtasks` a répondu :

    ERROR: The task XML is malformed.
    (1,2)::ERROR: one root element

Mon premier réflexe a été de chercher le défaut dans le plan Windows. **Il n'y
en avait pas.** `src/service-reel.ts` préfixe les fichiers UTF-16 de la marque
d'ordre `FF FE` — sans elle, un analyseur XML ne sait pas dans quel sens lire
les paires d'octets — et un commentaire de six lignes explique pourquoi. Le
produit était juste.

C'est mon aide de test qui était fausse :

```ts
// ce que j'avais écrit — une réécriture à moi de l'écrivain
writeFileSync(ou, p.fichier.contenu, p.fichier.encodage);

// ce qu'il fallait — l'écrivain lui-même
SYSTEME.ecrire(ou, p.fichier.contenu, p.fichier.mode, p.fichier.encodage);
```

`writeFileSync(…, 'utf16le')` de Node n'écrit **pas** de marque d'ordre. Mon
banc d'essai posait donc des octets que la ruche n'écrit jamais, et jugeait
ceux-là.

### Pourquoi celle-ci pique

J'ai commis, **dans le test du lot consacré à ce sujet**, la faute exacte que le
lot corrige. Le § 6.6 bis dit : _un fichier destiné à un autre programme se
vérifie en le lui donnant._ Encore faut-il lui donner **le fichier que le
produit écrit** — pas une reconstitution de mémoire. J'avais remplacé une
comparaison à mes attentes par une soumission au vrai juge, et je lui ai présenté
un faux.

Le pendant en négatif était pire encore : la contre-épreuve
(« un XML à la racine inconnue est refusé ») écrivait elle aussi sans marque
d'ordre. Elle aurait donc rougi **pour l'absence de marque et non pour la balise
mutée** — verte pour la mauvaise raison, ce qui ne garde rien.

### La règle

> Un test qui juge un artefact doit se le faire **produire par le code de
> production**, jusqu'au dernier octet. Dès qu'un banc d'essai réimplémente une
> étape de la chaîne — l'écriture, l'encodage, la sérialisation — il juge son
> propre ouvrage et non celui du produit.

Le test y a gagné : il couvre désormais plan → écrivain → outil de la
plateforme, au lieu de deux tiers de la chaîne.

---

## 9 terdecies. Vérifier qu'un outil EXISTE en le lançant mesure autre chose

Le lot du § 6.6 bis ajoute une étape de CI qui doit répondre à une question
simple : **le juge est-il installé ?** Si `systemd-analyze` disparaissait de
l'image, les `runIf` de `tests/service-accepte.test.ts` seraient sautés — donc
verts, et sans objet.

Je l'ai écrite en **lançant** l'outil. Trois jambes rouges, deux causes, aucune
qui n'ait rien à voir avec la présence :

| jambe   | ce que j'ai écrit        | ce qui s'est passé                                                                                         |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| macOS   | `plutil 2>&1 \| head -1` | `plutil` sans argument imprime son mode d'emploi et sort en **non nul** ; `-o pipefail` l'a propagé        |
| Windows | `schtasks /Query /?`     | sous Git Bash, `/Query` est converti en **chemin Windows** avant d'atteindre le binaire → `Invalid syntax` |

Dans les deux cas **l'outil était présent**. L'étape ne mesurait pas sa présence,
elle mesurait ce que le programme fait de ses arguments — et sur Windows, ce que
le shell fait des arguments avant lui.

`command -v` répond exactement à la question posée : il consulte le PATH, ne
lance rien, et ne passe aucun argument à mangler. (Avec un repli sur
`$outil.exe`, parce que la résolution de Git Bash n'est pas celle d'un shell
POSIX.)

### La règle

> Pour savoir si un programme EXISTE, on regarde le PATH — on ne l'exécute pas.
> Un lancement introduit deux variables étrangères à la question : le code de
> sortie du programme pour l'invocation choisie, et le traitement que le shell
> réserve aux arguments.

C'est le pendant exact de la leçon du même lot (§ 6.6 bis) : là, je vérifiais un
fichier sans le donner à son consommateur ; ici, j'interroge un consommateur pour
une question qui ne le regardait pas. Les deux fois, l'instrument ne mesurait pas
la grandeur.

---

## 9 duodecies. Ajouter une étape déplace la frontière de ce que la CI couvre

`install.sh` a gagné une étape 5 : la construction de l'écran. Les cinq travaux
de la CI sont passés au vert, et j'ai failli m'arrêter là.

**La CI ne lance `install.sh` qu'en `--dry-run`** — et ce mode sort à l'étape 4.
L'étape que je venais d'ajouter n'a donc **jamais été exécutée** par aucun des
cinq travaux. Le vert ne disait rien d'elle.

Pire, et c'est le vrai défaut : la carte de fin du `--dry-run` annonçait
toujours un seul geste, `npm run install:hive`. Elle promettait donc **moins**
que ce que le vrai passage allait faire. C'est mot pour mot la faute que le
commentaire d'à côté documente déjà à propos du `--` manquant : _une ligne qui
dit « voilà ce qui va se passer » doit dire vrai, sinon elle est pire que son
absence._

**La leçon.** Une CI couvre un CHEMIN, pas un fichier. Ajouter une étape après
le point de sortie d'un mode, c'est ajouter du code hors couverture — sans que
rien ne baisse, puisqu'aucune mesure ne suit ce chemin-là.

Le réflexe qui manque, et qui coûte trente secondes : **après avoir ajouté une
étape, relire ce que la CI lance vraiment, et où ça s'arrête.** Ici, `grep
install.sh .github/workflows/ci.yml` donnait la réponse en une ligne :
`sh install.sh --dry-run`.

Ce qui a été fait avec cette information : la carte annonce désormais les deux
gestes — donc la CI vérifie au moins l'ANNONCE, ce qu'elle pouvait encore faire.
Et le carnet dit que l'étape elle-même n'est tenue que par des gardes statiques
et par une exécution à la main. C'est peu ; le dire est ce qui empêche de le
prendre pour davantage.

---

## 10. Ce qui a le mieux marché

À garder, parce que ces gestes ont trouvé des défauts que rien d'autre n'aurait
trouvés :

1. **Muter avant d'écrire le test.** Un test qui ne peut pas rougir n'est pas de
   la couverture, c'est du décor. Neutraliser la garde, vérifier le rouge,
   restaurer.
2. **Lancer la commande.** Le bug `require`/`import` et la validation de
   `@fastify/static` 10 viennent de là, pas de la relecture.
3. **Ouvrir une plateforme qu'on n'exerce pas.** La CI Windows a rendu cinq
   défauts réels dont une perte de données, en une journée.
4. **Écrire l'hypothèse dans le code avant de la vérifier.** « Si ça retombe au
   plafond, c'est un blocage » a tranché sans discussion au run suivant.
5. **Dire ce qu'on ne peut pas vérifier**, plutôt que de le taire ou de le
   simuler.
