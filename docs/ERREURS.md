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

### 1.0 bis — Le harnais existait ; le geste le plus fréquent n'y passait pas

Suite directe. Une fois `vitrine-executee.test.ts` en place — le banc qui MONTE
la page et CLIQUE —, on aurait pu croire les gestes de la vitrine couverts. Le
balayage du point de sortie a montré le contraire : **la toute première action
d'un arrivant n'y passait pas.** Les puces OS de la barre d'installation
(Windows / Linux·macOS / Docker) basculent la commande à copier ; `site.test.ts`
verrouillait bien les DONNÉES de chaque puce — sa commande, sa note, son invite
`$`/`>` — mais RIEN n'exécutait `choisirPuce` pour vérifier que cliquer met
vraiment la bonne commande dans la barre. Muté `p === puce` → `!==`, la garde
survivait : un arrivant Windows aurait copié `curl … | sh` dans PowerShell, et
l'installation aurait échoué à la première ligne, banc au vert.

Ce qui est instructif, c'est POURQUOI ce geste-là a été le dernier couvert : il
est trop évident. « C'est un bouton qui change un texte » — donc on verrouille
son texte et on passe. Les gardes obscures (un halo de graphe, un départage de
clic) ont eu leur mutation-test avant la commande d'installation, que lisent
pourtant tous les visiteurs.

> **Règle** — la criticité d'une interaction et la profondeur de son test sont
> souvent en sens INVERSE : le geste le plus évident (« juste un bouton »)
> reçoit le traitement le plus léger. Quand un harnais d'exécution existe, le
> premier à y faire passer est le geste le PLUS fréquent, pas le plus subtil.
>
> **Règle** — verrouiller la DONNÉE d'un contrôle (sa commande, son libellé)
> ne prouve pas que le CLIC l'utilise. Données lockées + comportement nu = un
> arrivant qui copie la bonne chose par accident, jusqu'au jour où non.

### 1.0 ter — La loupe ne balaie pas `site/` : tout un dossier de code hors sonde

En défendant l'un après l'autre les gestes de la vitrine (puces OS, onglets
d'aperçu, liens « ouvrir ma ruche », langue initiale), un fait s'est imposé :
**aucun de ces défauts n'aurait été trouvé par un balayage automatique.** La
loupe (`scripts/loupe.mjs`) ne mute que les lignes ajoutées sous `src`,
`dashboard/src`, `scripts` — jamais sous `site/`. Or `site/index.html` porte
plusieurs CENTAINES de lignes de JavaScript exécutable : toute la vitrine, la
seule page que voient les gens qui découvrent le projet.

C'est un angle mort de dossier entier, et il est pernicieux parce qu'il est
INVISIBLE : on lance `npm run loupe`, elle rend « rien de nu », et on croit le
diff couvert — alors qu'elle n'a même pas regardé le fichier le plus lu du
dépôt. Chaque garde du script de la vitrine (`p === puce`, `data-ecran === cle`,
`if (!base)`, `saved === 'en' || saved === 'fr'`) a dû être trouvée À LA MAIN, à
la lecture, puis défendue par un banc d'exécution (`vitrine-executee.test.ts`).

> **Règle** — « la loupe ne voit rien de nu » ne vaut que pour ce que la loupe
> REGARDE. Ce qu'elle exclut (`site/`, et tout `.html` porteur de script) reste
> à couvrir à la main : une garde hors de sa portée n'est pas défendue parce que
> le balayage est vert, elle est seulement HORS CHAMP.
>
> **Règle** — du code exécutable dans un fichier que le balayage n'atteint pas
> demande un banc d'exécution dédié, sinon il vit et meurt sans qu'aucune sonde
> ne le touche. La vitrine en est l'exemple type : très lue, jamais mutée.

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

### 2 quattuortrigies — Concaténer un motif de mutation avec `+ "'x'" +` en bash le fait ÉCLATER en arguments

En rejouant les mutations du Garde-Fous, j'ai voulu remplacer une ligne qui
contenait des apostrophes (`… === 'strict'`). Pour l'insérer dans un argument
bash déjà entre apostrophes, j'ai écrit `'… === ' + "'strict'" + ' …'`, croyant
concaténer trois morceaux. En bash, `+` n'est PAS un opérateur : c'est un
caractère littéral, et les ESPACES autour de lui séparent la commande en
plusieurs arguments. Le motif passé au remplaceur était donc tronqué au premier
espace — la mutation ne s'appliquait pas (ou s'appliquait ailleurs), et le banc
« rougissait » pour une AUTRE raison qu'attendue. Un faux « bit » : la mutation
que je croyais éprouver n'a jamais existé.

Ce qui l'a démasqué : trois mutations d'affilée ont donné des rouges
INCOHÉRENTS avec leur cible (une qui cassait cinq tests par erreur de syntaxe, là
où une seule aurait dû rougir). Un rouge qui ne tombe pas EXACTEMENT sur le test
visé est un signal, pas une victoire.

La règle : **quand un motif de mutation contient des apostrophes, mettre
l'argument ENTIER entre guillemets doubles** (`mut "… === 'strict'" "…"`), jamais
de concaténation `+`. Et surtout : **un rejeu ne compte que si le test qui
rougit est CELUI qu'on visait** — vérifier le NOM du test rouge, pas seulement
qu'il y a du rouge. Les mutations valides de ce lot ont été refaites, proprement
double-quotées, et ont mordu la bonne cible.

### 2 tritrigies — Un demi-câblage qui ENREGISTRE sans EXÉCUTER fait apprendre un mensonge

L'Aiguillage se câblait en quatre lots : le nœud DÉCLARE ses modèles (4a), et
l'adaptateur EXÉCUTE le modèle choisi (4b). J'allais livrer 4a seul — c'est un
lot plus petit, plus relisible, et les deux « marchent » indépendamment au
typecheck. J'ai failli le commiter.

Le piège : l'ENREGISTREMENT du modèle choisi (`poserModeleAiguillage`) était déjà
VIF depuis deux lots plus tôt, et il ne s'active que si un nœud déclare des
modèles. Livrer 4a seul aurait donc fait, dès qu'un opérateur pose `HIVE_MODELES` :
la ruche CHOISIT un modèle, l'ENREGISTRE, mais l'adaptateur (sans 4b) lance le
modèle par DÉFAUT. La contre-visite jugerait la production du défaut, et
l'Aiguillage l'attribuerait au modèle choisi. Chaque tâche apprendrait un
mensonge — pire que pas d'apprentissage, parce que ça se croit informé.

Rien dans 4a ne rougit à cause de ça : 4a est correct EN SOI. Le défaut naît de
son INTERACTION avec un effet déjà en vol. Un banc de 4a ne pouvait pas le voir.

> **Règle** — avant de livrer la moitié d'une fonctionnalité, demander : « quel
> EFFET DÉJÀ VIF cette moitié active-t-elle, que l'autre moitié est nécessaire à
> rendre VRAI ? ». Quand la première moitié allume un enregistrement, une mesure,
> un compteur — et que la seconde est ce qui le rend fidèle — les deux sont
> INSÉPARABLES, même si chacune compile et se teste seule. Un demi-câblage qui
> mesure sans agir n'est pas un progrès partiel : c'est une source de données
> fausses qui se présentent comme vraies.

### 2 duotrigies — Restreindre une liste EN AMONT d'un départage ne se teste que si le départage a de quoi trancher AUTREMENT

En câblant l'Aiguillage dans l'ordonnanceur, j'ai restreint les candidats au
départage phéromones : `exAequo = candidats.filter(...)` au lieu de
`eligibles.filter(...)`, pour qu'un nœud écarté faute du bon modèle ne revienne
pas par la porte des phéromones. Trois mutations rejouées, deux rouges — mais
celle-là, `candidats` → `eligibles`, a **SURVÉCU**.

La raison est nette une fois vue : mes bancs ne posaient **aucune phéromone**.
Sans dépôt, `meilleurNoeud` rend `null` (il ne tranche que sur un signal
strictement positif), le bloc de départage ne change donc jamais le nœud, et
`candidats` ou `eligibles` donnent le même résultat. La ligne était juste, et
**intestable en l'état** : rien dans le banc ne créait la situation où les deux
listes divergent.

Corrigé en ajoutant un banc qui POSE une phéromone sur un **non-porteur** du
modèle élu (un `insertResult` réussi sur son domaine) : alors, et seulement
alors, le départage sur `eligibles` renverrait la tâche au non-porteur, et le
mutant rougit. C'est la cousine de § 2 vicies (un banc doit vraiment créer sa
condition) appliquée à un DÉPARTAGE : restreindre l'entrée d'un tri ne se prouve
qu'avec une entrée qui, sans la restriction, sortirait différemment.

> **Règle** — une garde qui RESTREINT l'ensemble sur lequel opère un
> départage/tri conditionnel n'est éprouvée que si le banc fournit le SIGNAL qui
> ferait trancher ce départage autrement. Pas de signal ⇒ les deux ensembles
> coïncident ⇒ le mutant survit, et la restriction est du décor jusqu'à preuve
> du contraire.

### 2 untrigies — Un backtick DANS un gabarit ferme le gabarit, même en commentaire

Le schéma SQL du store est un seul gabarit : `const SCHEMA = \`… CREATE TABLE …\``.
En y ajoutant la table `aiguillage_modeles`, j'ai précédé le `CREATE` d'un
commentaire SQL qui citait les tables voisines entre backticks — `` `tasks` ``,
`` `contre_visites` `` — par réflexe Markdown. Or **un backtick n'a pas de sens
« commentaire » dans un gabarit** : le premier a FERMÉ le gabarit en plein
milieu, et tout ce qui suivait — du vrai SQL — est devenu du code TypeScript que
le compilateur a essayé de lire. D'où une volée de `TS1005`/`TS1443` **loin de la
cause**, sur des lignes parfaitement saines.

Ce qui trompe ici, c'est que le diagnostic ne désigne pas le coupable : le
compilateur signale l'endroit où le gabarit rouvert cesse d'être analysable, pas
le backtick qui l'a fermé. Corrigé en retirant les backticks du commentaire SQL ;
le typecheck est redevenu propre d'un coup.

> **Règle** — dans un gabarit (`` ` … ` ``), il n'y a pas de commentaire : tout
> est de la donnée jusqu'au prochain backtick, y compris ce qui ressemble à de la
> prose. Un backtick posé « pour décorer » un mot ferme la chaîne. Quand un
> typecheck rend des `TS1005` en cascade sur du code sain, chercher le gabarit
> ouvert AU-DESSUS, pas l'erreur signalée.

### 2 quinvicies — Une garantie de sécurité attachée à une CHAÎNE, pas à un sujet

`docs/FONCTIONNALITES.md` promettait aux utilisateurs :

> Un membre exclu **ne peut pas revenir avec le token maître** : le refus est
> définitif, il ne se replie pas sur l'ancienne porte.

Mesuré sur un vrai serveur : `node-exclu` fermé en 4403, **`node-exclu-bis`
admis**. La garde était réelle, mais elle testait le `nodeId` **annoncé par
celui qu'on veut exclure** — une valeur que l'adversaire choisit lui-même.

Ce qui rend l'entrée coûteuse, c'est que la fausse promesse était écrite à
**trois endroits**, et que chacun rassurait sur la foi des deux autres : le
commentaire du code, l'en-tête du banc, et la documentation publique. Le banc,
lui, n'éprouvait que la reconnexion sous le MÊME nom — il confirmait donc une
garantie qu'il ne mesurait pas.

> **Règle** — une garde qui protège contre une PERSONNE ne peut pas se fonder
> sur une valeur que cette personne fournit. Demander « qui es-tu ? » à
> l'adversaire et le croire n'est pas un contrôle d'accès.
>
> **Règle** — quand une promesse de sécurité est écrite en toutes lettres dans
> la doc destinée aux utilisateurs, le banc qui la tient doit rejouer le geste
> de CONTOURNEMENT, pas seulement le geste naïf.

### 2 sexvicies — Une mutation survivante n'accuse pas toujours le code

Sept mutations sur huit rouges ; la survivante disait « on peut supprimer le
test `getNode` du câblage sans que rien ne rougisse ». La tentation est de
conclure que le code est mort et de l'enlever.

C'était l'inverse. Deux tables disent qu'une machine est connue — `nodes` (elle
s'est déjà présentée) et `node_keys` (l'hôte lui a remis une clé) — et elles
**ne se recouvrent pas**. Tous les bancs du fichier obtenaient leur nœud par
billet, donc passaient tous par `node_keys` : la machine vraiment ancienne,
celle d'avant les billets, n'était éprouvée **nulle part**. Supprimer la ligne
aurait cassé exactement la compatibilité que le lot promettait.

Les deux mutations survivantes du lot ont ainsi réclamé deux bancs manquants,
et les deux portaient des garanties de **compatibilité** — celles qui ne
rougissent jamais toutes seules, parce qu'un cas jamais testé ressemble à un
cas qui marche.

> **Règle** — devant une mutation survivante, poser la question dans les deux
> sens : « ce code est-il mort ? » ET « quel cas réel mon banc n'atteint-il
> jamais ? ». La seconde est la plus souvent vraie sur un `||` entre deux
> sources qu'on croit équivalentes.

### 2 octovicies — J'ai enfreint ma propre règle, écrite une heure plus tôt

§ 2 unvicies dit que deux loupes dans un même atelier ne rendent AUCUN verdict :
l'une restaure pendant que l'autre mesure. La règle avait coûté un balayage
entier, refait seul, avec des chiffres différents (26 contre 30, 1 contre 2).

Le soir même, j'ai lancé un balayage large **en tâche de fond**, puis, quelques
minutes plus tard, une seconde loupe dans le même atelier pour valider une PR.
Les deux verdicts sont nuls. Je ne l'ai vu qu'en comptant les processus.

Deux choses valent d'être écrites, et la seconde plus que la première :

1. **Ce qu'on ne voit pas, on cesse d'y penser.** Un travail en tâche de fond
   sort du champ ; la commande suivante est raisonnée comme si l'atelier était
   au repos. Ce n'est pas de la distraction, c'est la propriété normale d'un
   état invisible.
2. **Ma règle était exactement du même genre que les défauts que je corrigeais
   la même nuit** : une règle écrite, juste, chèrement apprise — et que rien
   n'appliquait. Les registres 1, 2 et 3 disaient tous « la borne est écrite,
   pas câblée ». Le carnet aussi, donc.

> **Règle** — une règle de méthode qui ne peut être tenue que par la vigilance
> sera enfreinte, y compris par celui qui vient de l'écrire. Si elle porte sur
> quelque chose qu'un programme peut vérifier, elle doit devenir un VERROU, pas
> un paragraphe. `scripts/loupe.mjs` en a un depuis.

> **Règle** — avant de lancer une commande dans un atelier partagé, compter ce
> qui y tourne déjà. « Je viens de lancer quelque chose » n'est pas un fait
> qu'on se rappelle : c'est un fait qu'on MESURE.

### 2 trigies — Un harnais de mutation qui ne compte que les « passed » ment quand TOUT échoue

Mon script de mutation lisait le verdict par `re.search(r'(\\d+) passed', sortie)`.
Sur un banc de DEUX tests où la mutation fait tomber les DEUX, vitest imprime
« Tests 2 failed (2) » — **sans aucun « passed »**. Le motif ne mordait pas, le
script retombait sur `0` et annonçait **« SURVIT »** une mutation qui tuait tout.

Rattrapé par réflexe — devant une survivante inattendue, j'ai rejoué à la main
et LU la sortie entière (§ 2 novodecies) : deux `TypeError: null.name`, la
garde mordait parfaitement. Sans ce réflexe, j'aurais écrit un banc « qui ne
peut pas rougir » en croyant l'inverse.

> **Règle** — un verdict de mutation ne se lit pas au seul compteur « passed ».
> Compter AUSSI les « failed », et traiter l'absence des deux comme illisible,
> jamais comme « survit ». Un `0 passed` peut être `N failed`, c'est-à-dire le
> CONTRAIRE d'une survie.

### 2 nonvicies — Une garde de source qui trouve la DÉFINITION croit avoir trouvé l'APPEL

Le banc du verrou ci-dessus vérifiait le câblage ainsi :

```js
expect(vif).toContain('jugerVerrou(');
```

Rejoué contre le geste qu'il prétend attraper — commenter le câblage, puis le
supprimer — il est resté **VERT les deux fois**. `jugerVerrou(` figure aussi
dans sa propre **définition**, quelques lignes plus haut dans le même fichier.
La garde constatait donc que la fonction EXISTE, jamais qu'elle est APPELÉE.

C'est la **troisième** fois de la nuit que « le texte est là » se fait passer
pour « la règle est appliquée » : d'abord un appel commenté (§ 2 quatervicies),
puis une règle recopiée par un banc au lieu d'être appelée (registre 2), et
maintenant une définition prise pour un appel. Le motif est stable, seul le
déguisement change.

Corrigé en isolant le corps de `principal()` par suivi des accolades, et en ne
cherchant que dedans. Rejoué sous les trois formes : commenté, supprimé, et
verrou jamais retiré — trois rouges.

> **Règle** — une garde de source doit chercher dans la PORTÉE qui l'intéresse,
> pas dans le fichier. Dans un fichier qui définit ET appelle, `toContain` sur
> le tout ne distingue pas les deux, et se trompe toujours du côté rassurant.

### 2 septvicies — Un harnais de mutation qui restaure par `git checkout --` efface le travail non commité

Le harnais mute une ligne, lance le banc, puis restaure par
`git checkout -- <fichier>`. Sur du code **non commité**, cette restauration ne
revient pas à l'état d'avant la mutation : elle revient à **HEAD**, donc elle
supprime la fonction qu'on venait d'écrire. Constaté en direct : la première
mutation a rendu son verdict, et la deuxième a échoué sur « ancre absente » —
le fichier ne contenait plus rien à muter.

Le verdict rendu était juste ; c'est la suite de la campagne qui était perdue.
Un harnais qui échoue bruyamment est une chance : le même geste sur un fichier
que la campagne n'aurait plus touché aurait effacé le travail en silence.

> **Règle** — **commiter avant de muter**. Le point de restauration coûte un
> commit jetable qu'on écrase ensuite ; l'oublier coûte le travail.

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

#### Récidive du 3 août — j'ai écrit le dix-huitième fichier moi-même

`tests/join-ruche-vivante.test.ts`, première version : trois « actes » dont
l'en-tête disait fièrement « l'ordre est porteur : vitest exécute les `it` en
séquence — ce fichier s'appuie dessus et le dit ». Le tamis (graine 15838) a
mélangé les tests DU fichier : l'acte 3 joué en premier trouvait un billet
vierge, `join` réussissait, et le test attendait trente secondes une fin qui
ne venait jamais.

**Le dire n'est pas une exemption.** L'exemption existe — elle se déclare dans
`tests/ordre-declare.test.ts`, où l'ordre est le SUJET du test. Ici l'ordre
n'était pas le sujet, c'était une économie : trois prémisses partagées au lieu
de trois posées. Le remède a coûté vingt lignes — chaque test crée SON billet,
et la consommation de l'acte 3 se pose par la vraie route d'échange au lieu de
s'hériter. Le fichier y a gagné : les deux tests tiennent désormais chacun
debout tout seuls, dans n'importe quel ordre.

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

### 2.16 ter — Un survivant de la loupe se TRANCHE ; un équivalent sur un ternaire dénonce du code mort

La loupe échantillonne : au-delà de `LOUPE_MAX`, elle examine une ligne sur deux
(pas régulier) et DIT ce qu'elle laisse de côté. Sur beaucoup de branches
fusionnées, la moitié non examinée s'accumule — un angle mort réel. Un
**balayage élargi** le rouvre : `LOUPE_BASE` épinglée par variable
d'environnement (jamais écrite dans le dépôt — le défaut reste `origin/main`) sur
une base large, `LOUPE_MAX` monté pour examiner TOUTES les candidates, pas la
moitié.

Ce balayage a rendu deux survivants sur `normaliserBornes` (`garde-fou.ts`). Les
deux étaient ÉQUIVALENTS — mais ils ne disaient pas la même chose :

- `rangEchelon(b.min) <= rangEchelon(b.max)` muté en `<` : pour `min == max`, la
  branche suivante reconstruit `{ min, min }`, **égal en valeur** à `b` ; la
  seule différence est `return b` (même référence) contre un objet neuf. Aucun
  contrat ne repose sur l'identité de référence, et le contrat de VALEUR
  (`min == max` préservé) est déjà couvert. Écrire `expect(...).toBe(b)` tuerait
  le mutant, mais éprouverait un détail d'implémentation que personne n'exige :
  du décor déguisé en couverture. On le **laisse, et on le consigne équivalent**.
- `rangEchelon(b.min) >= rangEchelon(b.max) ? b.min : b.max` muté en `>` : on
  n'atteint cette ligne QUE si `min > max`, donc `min >= max` y est TOUJOURS
  vrai — le ternaire rend toujours `b.min`, et la branche `: b.max` est du **code
  mort**. Ici le survivant n'appelle pas un test : il appelle le **retrait de la
  branche morte**. Et pour qu'elle ne renaisse pas muette, un test EXÉCUTÉ épingle
  désormais « resserrer sur `min` » sur les trois inversions (VERDICT montré :
  `b.min` → `b.max` rougit `{ leger, leger } ≠ { strict, strict }`).

> **Règle** — un survivant de la loupe n'est pas d'office un test manquant. On
> TRANCHE : soit une entrée de VALEUR distingue l'original du mutant → on écrit
> CE test, muté d'abord ; soit aucune ne le distingue → il est équivalent. Un
> équivalent sur une comparaison ou un ternaire trahit souvent une branche que
> rien n'atteint : on la retire. Les équivalences qui restent (ici le `<=` de la
> ligne conservée) se CONSIGNENT, sinon le prochain balayage élargi rouvre la
> même enquête. Et le balayage élargi est un OUTIL : `LOUPE_BASE` s'épingle le
> temps d'un run, jamais dans le dépôt.

Corollaire, mesuré sur un balayage épinglé LOIN en arrière (base d'avant le
lot « Le Poste ») : **du code MÛR, réputé couvert, cache encore des gardes
nues.** Le per-nœud `noeud.status === 'online' ? « en ligne » : « hors ligne »`
(`NodesPanel.tsx`) survivait `=== → !==` : la fiche d'admin aurait annoncé une
machine EN LIGNE « hors ligne » (et l'inverse) — on coupe la vivante, on croit
la morte encore là. La cause n'est pas l'âge du code mais que **tous les bancs
de rendu ne montaient QUE des nœuds `online`** : la branche `offline` n'avait
jamais d'entrée. Un affichage à DEUX branches ne s'éprouve qu'avec une entrée
POUR CHAQUE branche — c'est le « des deux côtés » du § 2 quindecies, transposé
du seuil numérique au ternaire d'état. Le balayage élargi n'est donc pas réservé
au code récent : une fenêtre ancienne, jamais entièrement échantillonnée, en
vaut la peine.

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

### 3.2 ter — Un banc qui dort n'immobilise pas que lui-même

Le déclencheur du § 3.2 bis a fini par sonner. Sur `main`, la CI Windows a
rougi — et **elle seule**, le même commit ayant passé les cinq contrôles de sa
PR et le rejeu en trois ordres sous Linux. Trois hooks de démontage ont expiré
à 20 000 ms, tous à la même seconde :

    tests/conseil-runner.test.ts:41   afterEach  Hook timed out in 20000ms
    tests/essaim-endpoint.test.ts:35  afterEach  Hook timed out in 20000ms
    tests/hardening.test.ts:103       afterEach  Hook timed out in 20000ms

La règle interdisait de relever le plafond : « trouver CE QUI bloque ». Or les
trois hooks incriminés font exactement ce que le § 3.2 bis a mesuré à moins de
200 ms — `stop()`, `close()`, `rmSync`. Ce n'étaient donc pas eux. **Le blocage
était chez un VOISIN.** À la seconde exacte où les trois expiraient, un
quatrième fichier finissait :

    tests/filet-relivraison.test.ts (2 tests) 26749ms
        ✓ DEUX RENVOIS D'UNE MÊME TÂCHE SONT ESPACÉS 26450ms

Ce test attend **vingt-six secondes de temps réel** — un `setTimeout(26_000)`
nu — pour observer deux re-livraisons espacées de quinze. Presque zéro calcul,
mais un fork immobilisé si longtemps qu'il traverse toute la queue de fin. Sur
un runner Windows partagé à quatre cœurs, ses trois voisins de fin arrivent au
démontage pendant que ce fork tient encore une ruche vivante (SQLite, WebSocket,
boucle de tick) — et l'effacement des arborescences temporaires, déjà lent sous
Windows (voir § 6.1 bis, le handle qu'on ne voit pas sous Linux), déborde le
plafond.

**Ce qui a rendu la cause difficile à nommer** : le hook qui RAPPORTE le délai
n'est pas celui qui le CAUSE. La règle « trouver ce qui bloque » doit donc
regarder les voisins de queue, pas seulement la ligne qui a rougi. Je le dis au
conditionnel là où je ne peux pas le prouver : le défaut est Windows-seul et
intermittent (une fois en treize poussées), donc irreproductible sur ce banc
Linux — le lien de cause est INFÉRÉ d'une co-terminaison à la seconde près, pas
observé sous debogueur.

**Le remède ne touche pas au plafond.** Il ôte le blocage à sa source :
`createServer` accepte depuis toujours un `relivraisonMinMs` — documenté mot
pour mot « un test qui veut observer plusieurs re-livraisons ne peut pas
attendre quinze secondes par tour ». `filet-relivraison` précédait cette option
et ne l'avait jamais adoptée ; `instinct-endpoints`, lui, la passe déjà à 0.
L'espacement réglé à 2 000 ms ramène la fenêtre d'observation de 26 s à 12, sans
rien retirer à ce que le test prouve — muter la garde d'espacement
(`&&`→`||`, server.ts) le fait toujours rougir (un seul renvoi observé, « 1 ≥ 2 »
faux). Vingt secondes de temps réel disparaissent du chemin critique de CHAQUE
exécution, sur les trois OS.

> **Règle** — quand un hook expire, le coupable n'est pas toujours le hook. Sur
> un banc parallèle à ressources bornées, un fichier VOISIN qui dort en temps
> réel immobilise un fork et affame le démontage des autres. « Trouver ce qui
> bloque » veut dire regarder la QUEUE, pas seulement la ligne rouge.
>
> **Règle** — un test qui attend des secondes réelles alors qu'une option de
> banc peut les raccourcir n'est pas seulement lent : c'est un risque de
> stabilité CI. Le temps réel d'un test est une ressource partagée du banc.
>
> **Règle** — avant d'inventer un réglage pour raccourcir un banc, chercher
> s'il existe déjà. Ici il existait, documenté pour ce cas précis, et un test
> voisin l'utilisait — l'oubli était d'adoption, pas de conception.

**Ce qui le garde** : `tests/filet-relivraison.test.ts` lui-même, dont la
fenêtre raccourcie reste sensible à la mutation de la garde d'espacement
(vérifié : `&&`→`||` le fait tomber sur « moins de deux renvois »). Aucun compte
de tests ne change — le badge est intact.

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

### 8.1 — Le `grep` propose, le flot de contrôle tranche

Audit de la frontière hôte/invité. Un relevé montrait, au chemin des chantiers :

```js
runProc(msg.prepareCommand, dir, env, …)   // aucune garde sur cette ligne
```

alors que le chemin du merge, lui, appelle explicitement `jugerPreparation`
avant son `runProc`. La conclusion s'écrivait toute seule, et elle était
séduisante parce qu'elle avait la **forme d'un défaut déjà trouvé deux fois la
même nuit** : une garde câblée chez un appelant et pas chez l'autre — sur l'axe
le plus sensible du produit, en plus.

C'était faux. La garde est trente lignes plus haut, dans le même gestionnaire,
**avant le clone**, avec sortie anticipée. Le `grep` ne la montrait pas parce
qu'elle n'est pas sur la ligne de l'appel : elle est sur le chemin qui y mène.

Ce qui rend l'erreur intéressante, c'est son moteur : une hypothèse qui
ressemble à ce qu'on vient de trouver ailleurs se vérifie moins sévèrement. Deux
registres venaient d'établir « une règle écrite que rien n'applique », et le
troisième cas s'y est glissé sans payer sa preuve.

> **Règle** — une garde absente d'une LIGNE peut être présente dans le CHEMIN
> qui y mène ; et l'inverse est vrai — une garde présente peut être court-
> circuitée en amont. Avant d'annoncer une garde manquante, lire le flot de
> contrôle du gestionnaire entier, ou l'exécuter.
>
> **Règle** — se méfier deux fois plus d'une trouvaille qui a la forme de la
> précédente. C'est le moment où l'on vérifie le moins.

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

### Deuxième occurrence — la liste qui s'adapte à la mutation qu'elle traque

Le lot du dispatch CLI, même journée que la relecture de cette page. Mon test
« chaque commande gardée, lancée sans argument, s'arrête à l'usage » tirait sa
liste de commandes gardées **d'un parse de `cmd === 'x' && a1` dans la
source**. Retirer `&& a1` de `stings` — la mutation exacte que le test devait
attraper — retirait donc `stings` de la liste : la garde tombée, le test
cessait de la chercher. Vert, mutation survivante, mesuré.

C'est la même faute sous une autre forme : les deux membres ne sont plus une
égalité mais **un périmètre et son contenu**, dérivés de la même source. Le
remède est le même — la liste des vingt gardées est désormais LITTÉRALE dans le
test, et une assertion la confronte à la source : si elles divergent, l'une des
deux a bougé et quelqu'un doit relire.

Dans le même lot, une annexe qui pique : le commentaire de ma première version
affirmait que la bijection avait « mordu à la première exécution » sur le
crochet de `<billetId]>`. **Faux — c'est une relecture qui l'avait vu**, et la
mutation l'a prouvé : le crochet réintroduit, six tests verts. Attribuer à un
test ce que l'œil a trouvé, c'est fabriquer de la couverture en prose (§ 9
nonies, cousin direct). La garde d'équilibre des délimiteurs existe maintenant,
et c'est ELLE qui rougit sur ce crochet — vérifié.

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

### Cinquième occurrence — dans une MUTATION, cette fois

Le lot du dispatch CLI. Ma mutation « `exitCode = 1` → `0` dans la branche
d'usage » a frappé la **première** occurrence du motif — ligne 275, la
validation de `replay`, couverte par un AUTRE fichier de test. Verdict imprimé :
« survit ». Verdict réel : la mutation n'avait jamais touché ma cible.

Une mutation est un repère comme un autre : **mal ancrée, son verdict porte sur
autre chose que ce qu'on croit** — et un « survit » infondé fait écrire un test
de plus contre un défaut qui n'existe pas, ou pire, fait douter d'une garde
saine. Rejouée sur une ancre à contexte unique (la fin du fichier), elle a
rougi trois tests. Compter l'ancre AVANT le verdict vaut pour les gardes ET
pour ce qui les éprouve.

---

## 9 novodecies. Le shell lit le message de commit AVANT git

`git commit -m "… la garde `arreteA > 0`mutée en`>= 0` …"` — écrit entre
guillemets DOUBLES, avec des accents graves autour du code cité, comme on le
fait naturellement en Markdown.

Le shell a fait exactement ce qu'on lui demandait : il a pris le contenu des
accents graves pour une COMMANDE à exécuter, a cherché un programme nommé
`arreteA`, ne l'a pas trouvé — et a interprété les `>` comme des
redirections. Résultat : deux fichiers vides nommés `0` et `=` sont apparus
à la racine du dépôt, et le message poussé portait **deux trous béants** là
où le code cité aurait dû être :

    aSupprimer — le geste qui appelle le fournisseur…
     mutée en  : une ligne incohérente…

La phrase survivante avait toujours l'air d'une phrase. C'est ce qui rend la
faute vicieuse : rien ne rougit, rien n'échoue, et le message part sur la
branche en disant à moitié ce qu'il voulait dire.

**La règle.** Un message de commit qui CITE DU CODE ne passe jamais par
`-m "…"`. On l'écrit dans un fichier et on le donne à git :

```sh
git commit -F chemin/du/message.txt
```

Le heredoc `<<'FIN'` (avec le délimiteur entre apostrophes, qui coupe toute
interprétation) est l'autre forme sûre. Les guillemets simples marcheraient
aussi, mais interdisent les apostrophes — inutilisable en français.

C'est le cousin exact du séparateur `|` qui découpait une boucle de rejeu sur
les `||` des chaînes mutées (§ du dix-neuvième lot) : **dès qu'on fait
transiter du code par le shell comme s'il s'agissait de texte, le shell y
cherche des instructions.** La réparation, elle, coûte un `--amend -F` et un
`push --force-with-lease` sur la branche de travail — jamais sur `main`.

---

## 2 tervicies. `mode` n'est honoré qu'à la CRÉATION — un secret réécrit garde ses vieux droits

`src/installer-main.ts` portait DEUX écrivains du même fichier : le `.env`,
celui qui contient `HIVE_TOKEN` et `HIVE_JWT_SECRET`.

```ts
// chemin principal — temporaire, puis rename
ecrireAtomique(CHEMIN_ENV, contenu, 0o600);

// chemin de l'ASSISTANT — écriture directe
writeFileSync(CHEMIN_ENV, contenu, { mode: 0o600 });
```

Les deux demandent `0o600`. Les deux ont l'air corrects. Mesuré avant d'écrire
la moindre ligne de correctif :

```
fichier existant en 644, puis writeFileSync(… { mode: 0o600 })  → 644
temporaire neuf en 0600, puis rename                            → 600
```

**`mode` n'est honoré qu'à la CRÉATION du fichier.** Sur un fichier qui existe
déjà, l'option est silencieusement sans effet — aucune erreur, aucun
avertissement, et un code qui se lit comme s'il protégeait quelque chose.

Le scénario n'est pas théorique : le dépôt conseille lui-même
`cp .env.example .env` (§ du premier contact), et un `cp` produit un fichier en 644. L'assistant le complétait ensuite avec le jeton et le secret de session
dedans — lisibles par tous les comptes de la machine. Et c'est le chemin
INTERACTIF, donc aussi celui où un `^C` laisse un `.env` tronqué, l'atomicité
étant l'autre chose que la voie directe perdait.

**Ce qui rend ce défaut invisible.** Il n'y a rien à voir. Les deux appels
demandent le bon mode ; il faut savoir que l'un des deux ne l'obtient pas.
C'est la famille des options qui ne s'appliquent qu'à certains états — comme
`{ recursive: true }` qui ne crée rien si le chemin existe déjà en fichier.
Devant une option de droits ou de permissions, la question n'est jamais « l'a-t-on
demandée ? » mais « à quel moment est-elle lue ? ».

**La règle.** Écrire un secret n'a qu'une seule bonne façon : créer un fichier
NEUF avec le bon mode, puis `rename`. Un fichier neuf ne peut hériter de rien.
`src/ecriture-atomique.ts` la porte, et une garde de SOURCE interdit à tout
`src/**` d'écrire un `.env` autrement — parce que `installer-main.ts`
s'exécute à l'import et qu'aucun banc ne peut donc l'appeler : sans garde
structurelle, la correction ne serait pas TENUE (§ 2 sexdecies).

---

## 2 quatervicies. Une garde de SOURCE qui ne retire pas les commentaires accepte du code mort

Écrite pendant l'audit d'avant-sortie, une garde devait tenir la doctrine des
bornes : _toute table arrive avec son élagueur, et l'élagueur est CÂBLÉ_. Elle
cherchait donc, dans `server.ts` :

```ts
const jamaisAppeles = [...elagueurs()].filter((nom) => !SERVEUR.includes(`store.${nom}(`));
```

Rejeu, forme exacte du défaut historique : on commente l'appel à `pruneTasks`.

**La garde est restée VERTE.** Le texte `store.pruneTasks(` était toujours là —
simplement mort. `includes()` sur la source BRUTE ne distingue pas une ligne
qui s'exécute d'une ligne qu'on a mise entre parenthèses.

**Pourquoi c'est le pire des cas de figure.** Commenter un appel est le geste le
plus courant d'un débogage — et celui qu'on oublie le plus souvent de défaire.
La garde rassurait donc précisément à l'instant où la borne venait d'être
désactivée à la main. Une garde qui couvre le cas rare (suppression) et manque
le cas fréquent (mise en commentaire) est moins qu'inutile : elle donne un
sentiment de sûreté sur le mauvais scénario.

**La règle.** Toute garde qui juge du CODE en lisant du TEXTE retire d'abord les
commentaires — comme le fait déjà la garde des sondes sans secret :

```ts
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
    .join('\n');
}
```

**Et la leçon de méthode qui compte plus que la règle.** Ce défaut n'a pas été
trouvé en relisant : il a été trouvé parce que la garde neuve a été REJOUÉE
contre le défaut qu'elle prétendait attraper, avant d'être livrée. Une garde
qu'on n'éprouve pas est une hypothèse, et celle-ci était fausse. C'est le
pendant exact de « un test qui ne peut pas rougir est du décor » — appliqué aux
gardes structurelles, qu'on a d'autant plus tendance à croire sur parole
qu'elles ont l'air d'être du contrôle plutôt que du test.

Cousine de § 2 octodecies (la substitution qui frappe le commentaire au lieu du
code) : dans les deux cas, la prose et la logique se ressemblent trop pour qu'un
outil textuel les distingue tout seul.

---

## 2 duovicies. Une suite qui fuit des processus finit par se faire mentir elle-même

Relevé pris cette nuit sur le conteneur, en cherchant pourquoi un balayage
mettait douze minutes là où il en met quatre :

```
40 processus node survivants, jusqu'à 1 070 s d'âge
  · src/orchestrator/main.ts        (des ruches entières)
  · src/node-client/main            (des nœuds)
  · vite.js dashboard               (des serveurs de développement)
plusieurs à 35-40 % de CPU chacun.
charge : 13,18   cœurs : 4
```

Dix-sept minutes que personne ne les avait lancés. La machine tournait à
3,3 fois sa charge nominale, uniquement avec des cadavres.

**Les deux causes, et elles sont distinctes.**

1. **Tuer le père libère les enfants.** `scripts/ruche.mjs` démarre lui-même un
   hub, un nœud et un `vite`. Le banc l'abat en `SIGKILL` — précisément le
   signal qui ne lui laisse AUCUNE chance de reprendre sa descendance. Le
   lanceur meurt, ses trois enfants sont rattachés à l'init et continuent.
   `proc.kill()` ne parle qu'à un processus ; il fallait parler au GROUPE
   (`detached: true` au lancement, `process.kill(-pid)` pour frapper).

2. **Un chien de garde `unref()` ne garde rien.** Les trois bancs bornaient
   leurs attentes par `setTimeout(…).unref()`. `unref` dit exactement : « si
   plus rien d'autre ne retient la boucle, n'attends pas ce minuteur ». Quand
   le worker vitest se termine pendant qu'une attente est en cours, le boucher
   n'est donc jamais appelé, et l'enfant qu'il devait tuer survit à tout le
   monde. Le filet était posé à l'endroit exact où il ne pouvait pas servir.

**Ce que ça coûtait vraiment — et ce n'est pas la lenteur.** Les mêmes bancs
posent des budgets en temps MURAL : « la bannière doit paraître en 30 s ». Sur
une machine à 3,3× sa charge, un enfant parfaitement sain met plus de trente
secondes à s'annoncer. La suite s'est donc mise à rougir au hasard, sur des
processus qui allaient bien, tués par un budget que la fuite des exécutions
PRÉCÉDENTES avait rendu intenable. **La fuite ne ralentissait pas la suite :
elle la faisait mentir** — et elle empirait à chaque exécution, ce qui est la
signature d'un intermittent qui « apparaît sans raison » après quelques heures.

C'est la cause probable de l'exécution perdue de § 2 novodecies.

**La règle.** Un banc qui lance un vrai processus le lance dans son propre
groupe et le reprend **sans condition** en `afterEach` — pas dans le chemin
nominal, qui est précisément celui qui ne s'exécute pas les jours où ça compte.
`tests/harnais-processus.ts` porte les trois gestes, et
`tests/harnais-processus.test.ts` fabrique un vrai petit-enfant pour vérifier
qu'il meurt : sans ce banc, le quatrième fichier qui lancera un processus le
fera au `spawn` nu et la fuite reviendra, invisible (§ 2 sexdecies — une
correction appliquée partout n'est pas une correction tenue).

**Le corollaire de mesure.** Avant de croire un chiffre de durée — d'un test,
d'un balayage, d'un profil —, regarder `/proc/loadavg` et compter les
processus vivants. Un banc mesure toujours DEUX choses en même temps : le code,
et la machine. On ne peut lire la première qu'en tenant la seconde.

---

## 2 unvicies. Deux mutateurs dans un seul atelier ne rendent aucun verdict

L'atelier existe pour que la loupe mute du code sans jamais toucher l'arbre de
travail. Règle tenue — et insuffisante, parce qu'elle ne dit rien du cas où
DEUX balayages y entrent en même temps.

Cette nuit : une loupe lancée à un tour précédent tournait encore dans
l'atelier ; un second balayage, à la ligne, y a été lancé par-dessus. Les
horodatages l'établissent à la seconde — la loupe a fini à 02:24:41, l'autre
avait commencé à 02:12. Et à 02:10, un `git checkout` destiné à réaligner
l'atelier sur la branche courante avait déjà piétiné l'état que la loupe
tenait en vol.

**Ce que ça détruit, exactement.** Le rejeu de mutation repose sur une seule
hypothèse : _une_ différence entre la source et sa version de référence.
Toute la lecture en découle — rouge ⇒ cette garde est tenue, vert ⇒ elle est
nue. À deux mutations simultanées :

- une suite rouge ne dit plus LAQUELLE des deux mutations l'a fait rougir ;
- une suite verte ne prouve rien non plus, car la restauration de l'un peut
  avoir effacé la mutation de l'autre avant qu'elle n'ait été jugée ;
- et les deux se contaminent en silence, sans qu'aucun outil ne proteste.

Le piège, c'est que le résultat reste PLAUSIBLE. Les verdicts obtenus ce
soir-là avaient tous l'air raisonnables — les gardes qu'on croyait tenues
rougissaient, les noms des tests tombés étaient sur le sujet. C'est
exactement ce qui rend la tentation forte de les garder « puisqu'ils vont
dans le bon sens ». Un résultat plausible obtenu par un protocole cassé reste
un résultat qu'on ne peut pas produire : il a été jeté, et le balayage
relancé atelier exclusif.

**La règle.** Avant d'ouvrir un balayage dans l'atelier, VÉRIFIER qu'aucun
autre n'y tourne — et ne jamais y faire de `git checkout` tant qu'il en
tourne un :

```bash
pgrep -af 'vitest|loupe' | grep atelier   # doit être vide
cd "$ATELIER" && git status --short       # doit être vide aussi
```

Un atelier sale AVANT de commencer n'est pas un détail à nettoyer d'un
`git checkout --` : c'est la trace qu'un autre balayage est en cours ou s'est
interrompu. Dans les deux cas, on attend ou on enquête — on n'écrase pas.

---

## 2 vicies. Un banc qui tourne en root ne peut pas éprouver un refus de droits

`identite-noeud.ts` avale volontairement les échecs d'écriture : c'est la
machine de l'invité, on n'y meurt pas pour un dossier interdit. Restait à
prouver que le chemin dégradé fait bien ce qu'il annonce. Le banc évident :

```ts
mkdirSync(ferme);
chmodSync(ferme, 0o500);
expect(() => rangerCle(path.join(ferme, 'travail'), 'x')).not.toThrow();
expect(lireCle(path.join(ferme, 'travail'))).toBeNull();
```

Rouge — `expected 'x' to be null`. L'écriture avait **réussi**. La suite tourne
en root dans le conteneur, et root ignore les bits POSIX : `0o500` ne ferme
rien du tout.

**Ce qui aurait été pire que ce rouge.** La première assertion,
`not.toThrow()`, était verte. Écrite seule — ce qui est la forme naturelle du
test « ça ne doit pas exploser » — elle aurait donné un banc vert qui n'a
JAMAIS emprunté la branche qu'il prétend éprouver, sur un chemin de
dégradation qui n'aurait donc jamais été exécuté nulle part. C'est la seconde
assertion, celle qui vérifie la CONSÉQUENCE et pas seulement l'absence
d'explosion, qui a révélé le vice.

**La règle.** Ne jamais simuler une impossibilité d'écriture par les droits :
le compte qui exécute le banc n'est pas connu d'avance (root en conteneur,
utilisateur ordinaire en local, et Windows n'a pas ces bits). Un obstacle
STRUCTUREL, lui, tient pour tout le monde et sur tous les systèmes :

```ts
writeFileSync(path.join(racine, 'obstacle'), 'je suis un fichier');
const bouche = path.join(racine, 'obstacle', 'travail'); // ENOTDIR, root compris
```

Corollaire de famille : `chmod`, `process.getuid()`, `umask` et les droits en
général sont des HYPOTHÈSES sur l'environnement du banc. Une hypothèse tacite
sur l'environnement est exactement ce qui rend un test vert au mauvais
endroit — la même racine que « le banc trop léger », vue depuis le système de
fichiers.

---

## 2 novodecies. Filtrer la sortie d'un banc avant de l'avoir lue détruit la preuve

Barrière de fin de lot, quatre commandes enchaînées pour aller vite :

```bash
npm run typecheck | tail -4 && npm run lint | tail -4 \
  && npx vitest run | grep -E "Test Files|Tests |Duration" | tail -5
```

Le `grep` a rendu ceci : **2 failed | 3 199 passed**. Deux tests rouges sur
trois mille deux cents — et pas un mot de plus, parce que le motif retenu ne
gardait que les lignes de total. Ni le nom des tests, ni leur fichier, ni
l'assertion. Les quatre exécutions complètes qui ont suivi sont vertes.

**Ce qui est perdu l'est pour de bon.** Un intermittent ne se rejoue pas sur
commande : c'est ce qui le définit. La seule occurrence observée de la nuit
portait tout ce qu'on aurait pu en apprendre — deux noms de tests, deux
fichiers, deux messages — et un `grep` posé AVANT la lecture les a jetés.
Quatre exécutions vertes ne réparent pas ça ; elles disent seulement « pas
reproduit en quatre essais », ce qui n'est pas la même phrase que « corrigé »,
ni même que « compris ».

**La règle.** La sortie d'un banc va d'abord dans un FICHIER, et le filtre se
pose sur le fichier :

```bash
npx vitest run > /tmp/banc.log 2>&1; tail -20 /tmp/banc.log
```

Le tube coûte zéro à écrire et se paye une seule fois — au moment précis où
il y avait quelque chose à apprendre. C'est la même famille que le tube qui
avale un code de sortie (§ 9 quaterdecies) : dans les deux cas on interpose un
outil entre soi et ce que la machine a réellement dit.

**Ce qui a fini par le nommer — par accident.** Un balayage de mutation lancé
plus tard, dont la sortie était CAPTURÉE, a fait apparaître ceci parmi les
victimes d'une mutation de `refValide` :

```
× ^C ARRÊTE TOUT — bannière, Reine en ligne, arrêt dit, code 0   30017 ms
```

Trente mille dix-sept millisecondes. `refValide` n'a rien à voir avec le
Ctrl+C d'un lanceur : ce test n'est pas tombé sur la mutation, il a dépassé un
délai. Et le délai en question est un `setTimeout(30_000)` posé DANS le banc —
le boucher qui tue l'enfant si la bannière du hub ne paraît pas — alors que
vitest, lui, accorde 60 s à ce test.

Un chien de garde en temps mural ne distingue pas « en panne » de
« occupé ». À 30 s sur un budget de 60, il tirait à mi-course en laissant la
moitié du délai inutilisée : il suffisait que la machine soit chargée — ici,
par les balayages eux-mêmes — pour qu'un enfant parfaitement sain soit
déclaré muet. Porté à 45 s, il garde sa raison d'être (rendre une erreur
NOMMÉE plutôt qu'un dépassement anonyme) sans se déclencher sur la lenteur.

C'est une cause PROBABLE de l'exécution perdue, pas une cause prouvée : les
deux tests de ce soir-là n'ont jamais été nommés, et ils ne le seront pas.
La leçon de méthode ci-dessus tient donc entièrement — c'est parce que le
SECOND incident a été capturé qu'on a pu lire son horloge.

---

**Le troisième visage, vu la nuit suivante.** Un script de mutation en Python
imbriqué dans un `printf` de shell : les guillemets se sont télescopés,
`python3` a rendu une `SyntaxError`, la ligne n'a pas bougé — et la suite est
restée verte. « 4 verts » se lit exactement comme « la garde est nue », et deux
tests inutiles allaient être écrits. Seul le message d'erreur, imprimé au
milieu de la sortie, a sauvé le coup.

D'où la forme définitive : le script de mutation **vérifie qu'il a muté**.

```python
avant = l[i]
l[i] = l[i].replace(ancien, nouveau)
assert l[i] != avant, 'mutation NON appliquée'
```

Sans cette assertion, toute défaillance du mutateur — mauvaise ancre, mauvais
échappement, fichier déplacé — se déguise en découverte.

## 2 octodecies. Le rejeu peut frapper le COMMENTAIRE qui décrit la garde

Cousin immédiat de § 2 septdecies, et plus sournois : le bon fichier, la bonne
suite, la bonne chaîne — mais pas la bonne ligne.

Batterie de huit mutations sur `cerveau-designation.ts`, chacune appliquée par
`perl -0pi -e "s/\Q$avant\E/$apres/"`. Sept rendent la suite rouge. La
huitième — `d < meilleur` → `d > meilleur`, la règle « le plus proche gagne » —
rend **13 verts**. Verdict apparent : garde nue, il faut un test.

Sauf que ce mutant-là ne peut pas survivre : avec `meilleur` initialisé à
`Infinity`, `d > meilleur` est faux au premier tour, donc plus rien n'est
jamais trouvé, donc TOUT devrait rougir. Un mutant qui devrait tout casser et
ne casse rien n'est pas une garde nue : c'est un rejeu qui n'a pas eu lieu.

La cause tenait en un caractère manquant. `s///` sans `/g` remplace la
PREMIÈRE occurrence — et l'en-tête du module cite la garde qu'il protège :

```
 *   · `d < rayon(p.n) + 8 && d < meilleur` — la sélection du corps sous le
```

La mutation a donc été appliquée au commentaire. Le code n'a pas bougé d'un
octet, et la suite verte ne disait rien d'autre que « le code n'a pas changé ».

**Le signal qui a sauvé le coup.** Pas une relecture : une INCOHÉRENCE. Sept
mutations rouges, une verte, sur une règle dont on pouvait prédire à la main
qu'elle ferait tout tomber. Un rejeu dont le résultat contredit ce qu'on sait
du code est un rejeu à vérifier, jamais un résultat à noter.

**La règle.** Muter par NUMÉRO DE LIGNE, sur la ligne de code repérée d'abord,
et afficher la ligne obtenue avant de lancer :

```bash
LIGNE=$(grep -n 'if (d < rayon(p.n) + MARGE_DOIGT && d < meilleur) {' "$F" | cut -d: -f1)
awk -v l="$LIGNE" -v r="$nouveau" 'NR==l{print r; next}{print}' "$ORIG" > "$F"
sed -n "${LIGNE}p" "$F"     # on LIT ce qu'on vient d'écrire
```

Et le corollaire qui fait mal : plus un module documente honnêtement les
règles qu'il tient — ce que ce dépôt demande partout — plus ses commentaires
citent son propre code, et plus une substitution textuelle a de chances de
frapper la prose au lieu de la logique. La bonne documentation rend le rejeu
naïf dangereux.

---

## 2 septdecies. Un rejeu contre le MAUVAIS fichier ne prouve rien

Le rejeu de mutation est devenu l'instrument de confiance du dépôt : « la
mutation survit » veut dire « cette garde est nue », et on écrit un test.
Cette nuit, il a menti — parce qu'on ne lui avait pas donné les bons tests à
faire tourner.

Sondage de la fenêtre de l'instantané : on retire la clause
`ORDER BY (status IN ('done','failed')) ASC` de `tachesPourEcran`, puis on
lance `tests/store-scaling.test.ts` — **21 verts**. Verdict noté : garde nue.
Deux tests écrits, rejeu fait, rouge, satisfaction.

Sauf que le rouge affichait TROIS noms, dont deux qui n'étaient pas les
miens : « LES TÂCHES VIVANTES PASSENT TOUTES, même les plus anciennes » et
« quand les vivantes DÉBORDENT la limite… ». Ces gardes existaient depuis le
lot 17, dans `tests/taches-bornees.test.ts` — le fichier que je n'avais pas
lancé. Mes deux tests étaient des doublons, écrits sur la foi d'un sondage
qui n'avait rien sondé.

**Ce que le rejeu prouve, exactement.** « Survit » ne veut jamais dire « rien
ne la garde » : ça veut dire « rien ne la garde DANS LES FICHIERS QUE J'AI
LANCÉS ». C'est un quantificateur qu'on oublie parce qu'on choisit le fichier
« évident » — ici un fichier dont le nom parlait d'échelle, alors que la
garde vivait dans celui qui parle de bornes.

**La règle.** Avant de déclarer une garde nue, rejouer la mutation contre la
SUITE ENTIÈRE. Le coût est réel (une centaine de secondes) et il est
inférieur à celui d'un doublon : un test redondant coûte du temps à chaque
exécution, pour toujours, et fait croire à une couverture qu'on avait déjà.
La forme pratique, quand on veut aussi savoir si SON test est le seul
gardien :

```bash
npx vitest run --exclude 'tests/mon-nouveau-test.ts'   # mutation en place
```

Vert ⇒ la garde était bien nue et le test neuf est le seul à la tenir.
Rouge ⇒ quelqu'un la gardait déjà : lire QUI, et ne pas écrire de doublon.

Les deux doublons ont été retirés plutôt que gardés « au cas où ». Et les
trouvailles de la même nuit ont toutes été revérifiées par exclusion — les
sondes fuyantes et les bornes de grâce étaient, elles, réellement nues.

---

## 2 sexdecies. Une correction appliquée PARTOUT n’est pas une correction TENUE

L'audit du 2 août avait trouvé quatre sondes qui livraient `HIVE_TOKEN`,
`HIVE_JWT_SECRET` et la clé d'API au premier binaire hostile posé en tête du
`PATH`. La correction a été faite proprement : un module pur, `envSonde`,
appliqué aux cinq sites de sondage. Le registre de l'audit l'a comptée close.

Le balayage de la nuit a mesuré ce que valait cette clôture. En remplaçant
`env: envSonde(process.env)` par `env: process.env`, site par site :

| site                          | verdict                      |
| ----------------------------- | ---------------------------- |
| `doctor-releve.ts`            | 29 tests verts — **nu**      |
| `cli.ts`                      | 7 tests verts — **nu**       |
| `node-client/agent-detect.ts` | 12 tests verts — **nu**      |
| `node-client/isolement.ts`    | 36 tests verts — **nu**      |
| `node-client/tunnel.ts`       | 1 test ROUGE — le seul gardé |

**Quatre sites sur cinq pouvaient redevenir fuyants sans qu'une seule ligne
rougisse.** La correction était partout dans le code et nulle part dans les
gardes : elle vivait dans le SOUVENIR qu'on l'avait faite.

Ce n'est pas la même faute que « la garde n'était pas câblée » (§ 6.5) : ici
tout était câblé, et correctement. La faute est plus discrète — **on a
confondu « le défaut est réparé » avec « le défaut ne peut plus revenir »**.
Le premier se vérifie en lisant ; le second demande un test, et personne n'en
avait écrit parce que le code lu était juste.

**La règle.** Quand un défaut a été trouvé à PLUSIEURS endroits, la correction
n'est pas finie tant qu'une garde n'empêche pas le PROCHAIN endroit de naître
avec. Une garde par site prouve les sites d'aujourd'hui ; c'est une garde
STRUCTURELLE qu'il faut — ici : « tout lancement de `--version` dans `src`
passe par `envSonde` », lue sur la source, y compris dans les fichiers qui
n'existent pas encore. Elle rougit sur les cinq sites mutés, et elle rougira
sur le sixième.

Corollaire, appris en l'écrivant : une garde de FORME doit être doublée d'une
garde de COMPORTEMENT sur le module qu'elle nomme. Exiger le nom `envSonde`
sans vérifier qu'`envSonde` retire vraiment quelque chose, c'est déplacer le
décor d'un cran — il suffirait d'en écrire une qui ne fait rien.

---

## 2 quindecies. Un juge éprouvé UN ÉTAGE TROP HAUT ne l’est pas

`jugerBillet` décide qui entre dans la ruche : révoqué, expiré, épuisé,
inconnu. Il avait des tests — mais tous par-dessus le HTTP
(`billet-motifs.test.ts` monte une vraie ruche et lit le code 401). Le compte
était flatteur : quatre motifs, quatre tests. La garde `expireA <= maintenant`
a pourtant survécu à sa mutation.

**Pourquoi.** Le banc HTTP posait un billet avec `expiresAt: 1` — le
1ᵉʳ janvier 1970. À cinquante ans de la frontière, `<` et `<=` rendent le même
verdict. Le test prouvait « un billet largement périmé est refusé », ce qui
n'a jamais été la question ; la question est « à l'instant annoncé, est-ce
fini ? ».

Deux fautes se composent ici, et elles se composent souvent :

1. **L'étage.** Un juge pur testé seulement à travers son appelant hérite des
   commodités de l'appelant — des données rondes, des cas francs, ce qu'on
   fabrique facilement en montant un serveur. Les frontières, elles, ne se
   fabriquent bien qu'au contact : `jugerBillet(billet({ expireA: NOW }), NOW)`
   tient sur une ligne, et il n'existait pas.
2. **La distance à la borne.** C'est la leçon du 18ᵉ lot (« 1 Mo pile
   s'affichait 1024 ko »), reprise ici sur un ACCÈS et non sur un affichage.
   Un cas loin de la frontière ne dit rien de la frontière.

**La règle.** Tout module PUR qui rend un verdict mérite un banc à SON étage,
même s'il est déjà couvert d'en haut. Le test d'intégration prouve le
CÂBLAGE ; il ne prouve pas la RÈGLE. Et quand la règle porte une borne, le
banc doit la toucher des deux côtés : `terme - 1`, `terme`, `terme + 1`.

Corollaire mesuré le même soir : la garde jumelle de `jugerPartage` portait
exactement la même faiblesse, et `partageVivant` — qui sert l'écran et
l'élagage — pouvait diverger du juge sans que rien ne rougisse. **Une famille
de règles se garde en famille** : la jumelle non testée dérive à la première
retouche, et personne ne s'en aperçoit puisque l'autre est verte.

Corollaire tranchant, mesuré un balayage élargi plus tard sur `isModeleList`
(`protocol.ts`, borne `v.length <= LIMITS.modeles`) : le banc éprouvait le REFUS
au-dessus (17 modèles rejetés) et RIEN d'autre. Or **le côté refusé ne défend
pas un `<=` : `N + 1` est rejeté par `<=` comme par `<`.** Seul le côté ACCEPTÉ
— `N` pile à la borne — distingue les deux, et c'est justement lui qu'un
`terme + 1` seul laisse nu. Une borne « testée » par sa seule moitié haute est
une borne non testée : le off-by-one qui la resserre passe le banc. Le côté qui
compte pour un seuil d'acceptation est TOUJOURS l'acceptation à la borne.

---

## 2 quaterdecies. « Hors d’atteinte du banc » est souvent « au mauvais endroit »

Le balayage a rendu SANS TEST la ligne `p.id === attrape.current.id` — « le
doigt gagne » — de la simulation du graphe du Cerveau. Vérification faite,
elle était bel et bien inatteignable : la boucle entière commence par

```ts
const ctx = c.getContext('2d');
if (!ctx) return;
```

et `getContext` rend `null` sous happy-dom. Pas une mise en scène au monde ne
pouvait faire rougir cette ligne LÀ OÙ ELLE ÉTAIT. Le premier réflexe — et il
était déjà écrit dans le plan de la nuit — était de la déclarer « hors
d'atteinte » et de le noter honnêtement au carnet.

**C'était le mauvais réflexe, et voici pourquoi.** « Hors d'atteinte » se
prononce sur un COUPLE (la logique, son décor), jamais sur la logique seule.
Ici la force ne dépendait d'aucun contexte de dessin : elle prend des corps,
des bornes, un pas de temps, et rend des corps déplacés. Ce n'est pas le canevas
qui la rendait intestable, c'est le fait qu'elle habitait dedans.

Sortie dans `dashboard/src/views/cerveau-physique.ts`, elle s'éprouve à la
milliseconde près : six tests, et la mutation en fait rougir QUATRE. Au
passage, la règle qu'elle porte est devenue dicible en une phrase — « le corps
que l'humain tient ne bouge pas tout seul, et les autres si » — ce qu'aucun
commentaire dans la boucle ne disait.

**La règle.** Avant d'écrire « hors d'atteinte », poser la question suivante :
_est-ce la LOGIQUE qui est intestable, ou son VOISINAGE ?_ Si la logique est
pure — pas d'E/S, pas de contexte graphique, pas d'horloge —, l'extraire coûte
quelques lignes et rend la garde définitivement éprouvable. On ne garde
l'aveu « hors d'atteinte » que pour ce qui l'est vraiment : un vrai navigateur,
un vrai gestionnaire de services, une vraie machine Windows.

Le corollaire est moins confortable : **une ligne que le banc ne peut pas
atteindre est souvent le symptôme d'une logique mal rangée, pas une fatalité
de l'outillage.** Le balayage par mutation ne dit pas seulement « ce test
manque » ; il dit parfois « ce code est au mauvais endroit ».

**Seconde application, le même canevas.** La DÉCISION du relâcher de souris —
« un glisser ne choisit rien ; un clic choisit la note dessous, ou le vide » —
vivait dans le `onMouseUp` du même canevas, tout aussi injouable sous banc.
Extraite en `selectionAuRelacher` (aux côtés d'`estUnClic`), elle s'éprouve
au pixel près, et la mutation `!estUnClic → estUnClic` fait rougir le cas qui
compte : un glisser qui SÉLECTIONNE au relâcher. Ce qui reste dans le canevas
est alors inerte — retenir l'`id` sous le curseur, traîner le corps —, et
c'est CE résidu-là, et lui seul, qu'on avoue « hors d'atteinte ». Une famille
de tuyauterie de canevas s'extrait pièce par pièce, chaque décision d'abord.

## 2 quaterdecies bis. Un helper extrait pour un banc `.ts` doit être SELF-CONTAINED

Suite directe du § ci-dessus. J'ai sorti l'icône du rayon (`e.type === 'dossier'`)
d'un composant `.tsx` pour l'éprouver — exactement le bon geste. Mais j'ai visé
DEUX mauvais endroits avant le bon, et les deux échecs disent la même chose.

**Essai 1 — `export function icone` dans `Rayon.tsx`, banc `.ts` qui l'importe.**
Le tsconfig RACINE (celui qui compile `tests/`, en `moduleResolution: nodenext`)
tire alors `Rayon.tsx` dans son programme et rougit : `--jsx` n'y est pas réglé,
parce que ce tsconfig n'a jamais eu à compiler de JSX — le dashboard a le sien
(`dashboard/tsconfig.json`, résolution bundler). Un helper laissé dans un `.tsx`
n'est pas atteignable par un banc `.ts` du programme racine.

**Essai 2 — module pur `rayon-affichage.ts`, mais qui importe `EntreeRayon` de
`../api`.** Mieux : plus de JSX. Mais `../api` est `dashboard/src/api.ts`, dont
les imports sont extensionless (résolution bundler), et le tsconfig racine, lui,
exige les extensions `.js` (nodenext). Importer le module de banc a donc tiré
TOUT le graphe du dashboard dans le programme racine, qui a rougi sur les imports
d'`api.ts` — du code parfaitement correct pour SON tsconfig, faux pour l'autre.

**Ce qui marche — et pourquoi `cerveau-designation.ts`, lui, n'a jamais posé ce
problème :** il n'importe RIEN. Le module extrait pour un banc `.ts` du programme
racine doit être self-contained — n'importer que des modules `src/shared/*` purs
(que le programme racine compile déjà, extensions comprises), jamais `../api` ni
un `.tsx`. `rayon-affichage.ts` prend donc son type d'entrée directement de
`src/shared/rayon`, pas de son ré-export dans l'api.

> **Règle** — extraire un helper pour un banc n'est pas fini quand il compile
> côté dashboard : il faut que le PROGRAMME QUI LE TESTE puisse le tirer sans
> tirer ce qu'il ne sait pas compiler. Un module de banc n'importe que du pur
> et du partagé — la frontière `dashboard` (bundler) / racine (nodenext) ne se
> traverse que par `src/shared`.

---

## 2 quaterdecies ter. Extraire une décision peut LAISSER un opérateur mutable dans le décor intestable

Troisième application de § 2 quaterdecies, avec un piège que les deux premières
n'avaient pas révélé. La garde survivante était `attrape.current.id !== null` de
`onMouseMove` du Cerveau — « ce glisser traîne-t-il un corps ? » —, prisonnière
du canevas muet comme ses sœurs. Extraction évidente : sortir l'aiguillage dans
une fonction pure `deplacementDuGlisse`, et dispatcher dessus dans le
gestionnaire.

Le premier jet a rendu un type discriminé sur une chaîne — `{ geste: 'corps' } |
{ geste: 'fond' } | { geste: 'survol' }` — et le gestionnaire testait
`if (d.geste === 'corps')`, `if (d.geste === 'fond')`. **Le balayage a
immédiatement mordu ces `===` tout neufs** (il tournait encore quand il a
réécrit `=== 'fond'` en `!== 'fond'` sur le disque). Logique : `onMouseMove`
reste injouable sous banc, donc TOUTE comparaison qu'on y laisse est une
survivante. On avait déplacé la garde d'un cran — et, pire, TROQUÉ UNE survivante
(`id !== null`) CONTRE DEUX (`geste === 'corps'`, `geste === 'fond'`).

**La règle, qui prolonge § 2 quaterdecies.** Extraire la décision ne suffit pas :
il faut que l'appelant la CONSOMME sans opérateur. Un résultat en booléens NUS
(`{ traine: true; id } | { traine: false; fond }`, lu par `if (d.traine)` puis
`if (d.fond)`) laisse la SEULE comparaison — `prise.id !== null` — dans la
fonction pure, où un banc la garde. Le canevas ne reçoit plus que des drapeaux à
tester, jamais une comparaison à muter. Après correction, le balayage ne voit
qu'UNE mutation sur le diff, et elle est défendue.

Le corollaire général : **une extraction qui ré-expose un opérateur dans le
contexte intestable n'a rien gagné.** Mesurer l'extraction à la loupe, pas à
l'intention — c'est elle, pas moi, qui a vu que le premier découpage fuyait.

---

## 2 terdecies. Un témoin présent sur les DEUX branches ne témoigne de rien

Même famille que § 2 duodecies — on désigne sans vérifier — mais le matériau
est neuf : un **sélecteur DOM**, et cette fois c'est le REJEU de la mutation
qui a attrapé la faute, pas la relecture.

La garde `splitDiff` de la Miellerie a deux rendus : le diff DÉCOUPÉ par
fichier, et le repli BRUT (« Diff affiché brut ») quand la découpe échoue.
Mon test voulait prouver qu'un diff bien formé passe par la découpe ; il
affirmait :

```ts
expect(dom.querySelector('.mi-files')).toBeTruthy();
```

Mutation rejouée (`chunks.length === 0` → `!==`, la découpe toujours
refusée) : **« Tests 6 passed »**. Le mutant a survécu parce que `.mi-files`
existe sur LES DEUX chemins — le repli brut loge sa note explicative dans un
conteneur du même nom. Mon témoin ne distinguait pas les deux mondes que le
test prétendait départager.

**La règle.** Avant de fonder une garde sur un témoin (sélecteur, classe,
texte), LIRE LES DEUX BRANCHES du rendu et vérifier que le témoin n'existe
que sur celle qu'on affirme. Un témoin partagé rend un verdict vert dans les
deux mondes — c'est un décor, au sens strict de la discipline « muter
avant d'écrire ». Ici le vrai discriminant était `.mi-file-chip` (la puce
par fichier, que seule la découpe rend) — et, en ceinture, l'ABSENCE du
texte « Diff affiché brut ».

Ce que ce paragraphe ajoute à la famille : le comptage du § 2 duodecies ne
suffit pas ici — `.mi-files` est UNIQUE dans le DOM des deux rendus, un
`toHaveLength(1)` serait passé aussi. L'exclusivité ne se compte pas dans le
document qu'on tient ; elle se vérifie contre L'AUTRE document, celui que la
branche adverse aurait produit. C'est exactement ce que fait le rejeu de la
mutation — raison de plus pour ne JAMAIS s'en dispenser, même quand le test
« semble » évidemment lié à la garde.

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

## 9 novievicies. Un EPERM de nettoyage peut être la CONSÉQUENCE d'un délai dépassé

La CI Windows a rougi sur `preparation-merge.test.ts` avec deux échecs :

    Error: EPERM, Permission denied: …\Temp\hive-prep-lSOoej   (afterAll, rmSync)
    Error: Test timed out in 60000ms.                            (le test juste avant)

Le § 6.1 bis enseigne qu'un EPERM au nettoyage désigne une ressource laissée
OUVERTE, et que « Windows a raison » — la tentation d'ajouter `maxRetries` y est
nommée comme un traitement du symptôme. Appliquer cette leçon telle quelle ici
aurait envoyé chercher une fuite de handle qui n'existe pas.

Car l'ordre des faits dit autre chose : c'est le TEST qui a expiré d'abord, en
laissant ses processus git vivants ; le `afterAll` a ensuite tenté d'effacer un
dossier encore tenu par eux. L'EPERM est la conséquence, pas la cause. Deux
indices le confirmaient : le `maxRetries: 5` était DÉJÀ posé (donc le symptôme
était déjà traité), et la durée du run — **413 s contre ~140 à 298 s d'habitude**
— désignait un runner lent, pas un défaut de code. Vérifié : le commit suivant,
identique côté code, est passé VERT sur les cinq jambes.

### La règle

Devant un EPERM de nettoyage sous Windows, lire d'abord **ce qui a échoué juste
avant**. S'il y a un délai dépassé dans la même suite, l'EPERM en découle et
corriger le nettoyage ne corrigera rien. Les deux diagnostics mènent à des
gestes opposés — fermer une ressource, ou comprendre une lenteur — et se
tromper de leçon coûte une chasse dans du code qui va très bien.

Corollaire : ne jamais « réparer » un intermittent avant d'avoir vu s'il se
reproduit. Un second passage vert sur le même code est une donnée ; un correctif
posé sans elle en supprime la possibilité, et laisse croire qu'on a soigné
quelque chose.

---

## 9 quintrigies. Une règle de configuration lue à DEUX endroits est DEUX règles

`HIVE_PORT` était lu par la ruche et par son docteur. Chacun avait écrit sa
propre lecture, et elles ne disaient pas la même chose :

    server.ts         Number.parseInt('', 10) → NaN, puis une garde
                      (`Number.isInteger && 0 ≤ p ≤ 65535`) → 7777
    doctor-releve.ts  Number('')              → 0, et aucune garde

Il suffisait d'une ligne `HIVE_PORT=` laissée vide dans un `.env` — l'accident le
plus banal qui soit — pour que le docteur parte sonder le port **0**. Or écouter
le port 0 réussit toujours : le système en attribue un au hasard. Il le trouvait
donc LIBRE, et annonçait que la ruche ne tournait pas, pendant qu'elle écoutait
tranquillement sur 7777.

### Pourquoi celle-ci pique plus que les autres

Ce n'est pas n'importe quel code qui divergeait : c'est l'outil dont le SEUL rôle
est d'être cru quand plus rien ne marche. Un docteur qui se trompe de patient
n'est pas neutre — il envoie chercher une panne inventée, et fait rater la vraie.

Et le défaut ne se voit jamais sur le chemin heureux : avec un `HIVE_PORT` bien
écrit, ou absent, les deux lectures coïncident. Il n'apparaît qu'au moment exact
où l'on a le plus besoin du docteur — quand la configuration est cassée.

### La règle

> Une valeur de configuration a UN lecteur. Les autres l'appellent. Poser « la
> même » garde à deux endroits marche le jour où on l'écrit et diverge au premier
> changement — c'est la faute, pas le remède.

Un troisième lecteur existait, et il avait raison : `installer-assistant.ts`
écrivait `Number(…) || PORT_DEFAUT`, précisément parce qu'il connaissait le piège
du `Number('')`. Trois lecteurs, trois comportements, une seule variable.

### Le banc qui prétendait garder l'accord, et qui était du DÉCOR

Écrit d'abord, il comparait `loadConfigFromEnv()` à `portDepuisEnv()` — c'est-à-
dire une fonction à celle qu'elle appelle. Remise au docteur sa lecture
d'origine, il restait **VERT** : le docteur n'était même pas dans son graphe
d'imports. Il éprouvait l'accord de la règle avec elle-même.

> Un banc qui éprouve un ACCORD doit importer les DEUX parties qui doivent
> s'accorder. S'il n'en importe qu'une, il mesure une tautologie — et la
> mutation le dit tout de suite, à condition de la jouer sur l'autre côté.

Corollaire de méthode : quand une mutation ne fait rien rougir, la première
question n'est pas « le banc est-il faible ? » mais « le banc TOUCHE-t-il ce que
je viens de muter ? ».

---

## 9 quattuortrigies. Un opérateur de mutation se juge à son RENDEMENT, jamais à son idée

Deux opérateurs ajoutés à la loupe le même soir, sur le même raisonnement — « la
liste ne le contient pas, donc l'instrument est aveugle » (§ 9 sexvicies). Deux
résultats opposés, et seule la MESURE les distinguait :

| ajouté                                             | désignations neuves | dont actionnables    |
| -------------------------------------------------- | ------------------- | -------------------- |
| bornes relâchées (`> → >=`, `< → <=`, `\|\| → &&`) | 8                   | **7**                |
| `?? →                                              |                     | `, sur tous les `??` | 12  | **2** |

Les dix autres étaient équivalentes **par le type** : `get(k) ?? {…}` — un objet
n'est jamais _falsy_ ; `n.modeles ?? []` ; `row?.echelon ?? null` — une union de
littéraux non vides ; `essais ?? 0` et `c?.actif ?? false` — la valeur _falsy_
possible EST le repli.

La loupe ne lit pas les types. Elle aurait donc re-désigné ces dix **à chaque
passe**, pour toujours.

### Pourquoi c'est grave, et pas seulement bruyant

Un instrument qui ne peut plus rendre vert n'est plus une porte, c'est un mur.
Son en-tête met en garde contre le faux vert rassurant — le **faux rouge
permanent** est l'autre façon de n'être plus écouté, et la plus insidieuse :
personne ne décide de l'ignorer, on cesse simplement de le lire.

La règle du dépôt aggrave le coût : chaque survivant doit être ou éprouvé, ou
consigné par écrit. Dix consignations d'équivalence sur des lignes triviales,
c'est dix commentaires que tout lecteur futur devra traverser pour rien.

### La règle

> Ajouter un opérateur de mutation est une hypothèse, pas une amélioration. On
> la vérifie en le lançant sur une base épinglée et en comptant la part de ses
> désignations qui sont ACTIONNABLES. Faible, on RESSERRE l'opérateur jusqu'à ce
> qu'il ne parle que là où il mord — ou on le retire.

Resserré ici au seul repli **truthy littéral** (`?? true`, `?? 1`, `?? 2_000`),
`??` redevient précieux et silencieux ailleurs : il ne désigne plus que les
gardes qui **échouent en s'ouvrant** — `nodeOnShift.get(n.id) ?? true` (une
ouvrière hors service redevient disponible), `opts.uid ?? 1000` (`uid` 0 est
root), `code ?? 1` (un code de sortie 0 devient 1).

### Le corollaire qui coûte, et qu'on assume

Resserrer PERD des cas réels : `x ?? null` mord vraiment si `x` peut être la
chaîne vide. On préfère le rater plutôt que noyer chaque passe sous 107
désignations qu'on ne saurait pas trancher — et **on l'écrit**, dans le code de
l'instrument, pour que la prochaine personne sache que ce trou est un choix et
non un oubli.

---

## 9 tertrigies. « Couverture PLEINE » est une mesure DATÉE, pas un état acquis

Le carnet portait, au 11 août : « la loupe à couverture PLEINE sur le diff
cumulé — ATTEINTE ce tour […] 41/41, tous défendus, rien de nu — plus de mutant
nu qui dorme dans un non-examiné ».

C'était vrai. Rejoué le soir même sur **la même base épinglée**, le même
balayage a trouvé **57 mutations**, pas 41.

Rien n'avait été défait. Deux choses avaient grandi, chacune de son côté :

- **l'instrument** — l'opérateur `instanceof X → instanceof Object` a été ajouté
  à la loupe le 11 août aussi, mais APRÈS la passe. Un balayage ne voit que ce
  que sa liste contient au moment où il tourne (§ 9 sexvicies) ;
- **la surface** — quatre commits ont atterri depuis, et le diff se mesure
  toujours contre la même base ancienne : il ne cesse donc jamais de croître.

Le verdict n'était pas faux ; il avait **expiré**, sans que rien ne le dise.

### La règle

> Un verdict d'EXHAUSTIVITÉ (« tout examiné », « rien de nu », « 100 % couvert »)
> ne vaut que pour le couple **{instrument, surface}** du jour où il a été rendu.
> Il ne se recopie pas au tour suivant : il se re-mesure, ou il se dit périmé.

Un verdict partiel vieillit honnêtement — « 13/40 échantillonnés » reste vrai et
appelle du travail. Un verdict d'exhaustivité vieillit en MENSONGE : il dit qu'il
n'y a plus rien à chercher, et c'est précisément ce qui empêche d'aller
regarder. Le danger est proportionnel à la confiance qu'il inspire.

Corollaire d'écriture : consigner la BASE et la version de l'instrument avec le
chiffre. « 41/41 » ne se relit pas ; « 41/41 sur `68087bc`, avant l'opérateur
`instanceof` » se relit et se date tout seul.

---

## 9 duotrigies. Chercher des MOTS dans les tests ne dit pas ce qu'ils EXERCENT

J'ai annoncé à l'utilisateur qu'une garde de `server.ts` — celle qui empêche la
fermeture d'un socket mort d'emporter la connexion vivante qui l'a remplacé —
n'était **défendue par aucun banc**. J'en donnais même la preuve :

    grep -rln "reconnex\|reconnect\|nodeSockets\|ws_closed" tests/
    → 9 fichiers
    grep -n "ws_closed\|nodeDisconnected\|…" <ces fichiers>
    → 1 seule ligne, dans scheduler.test.ts, qui appelle la méthode directement

C'était faux. La garde est défendue par `hardening.test.ts` — « un nœud qui blip
puis se reconnecte en déclarant sa tâche la RÉ-ADOPTE ». Mutée en `!==`, ce banc
rougit. Pire : **ce fichier était dans ma propre liste de neuf**, et je l'ai
écarté parce que mon second `grep` n'y trouvait pas mes mots.

Il ne pouvait pas les trouver. Ce banc n'écrit ni `ws_closed`, ni
`nodeDisconnected` : il ferme un socket, en rouvre un autre, et regarde la
tâche. Il éprouve le COMPORTEMENT — c'est ce qu'on lui demande — donc il ne
nomme aucun des rouages qu'il traverse.

### La règle

> La seule façon de savoir si une garde est défendue, c'est de la **muter et de
> lancer la suite**. Un `grep` dans `tests/` ne mesure rien : les bons bancs
> sont écrits dans le vocabulaire de l'utilisateur, pas dans celui du code
> qu'ils traversent.

Le coût de se tromper n'est pas symétrique. Croire une garde défendue quand elle
ne l'est pas laisse un trou ; croire une garde NUE quand elle est tenue fait
écrire un doublon — et un banc posé autour d'une condition déjà gardée fige un
doublon sans rien défendre (§ 9 novemdecies). Dans les deux cas, la mutation
tranche en deux minutes ce qu'aucune lecture ne tranche.

Corollaire pratique : muter **avant** d'annoncer quoi que ce soit. J'avais la
mutation à portée de main et j'ai parlé d'abord.

### Ce que la mutation a trouvé à côté

La ligne SUIVANTE, elle, était réellement nue — la boucle qui ferme les fusions
du nœud parti. Mutée en `!==`, la suite entière est restée verte : 242 fichiers,
3 534 tests. Et elle casse dans les deux sens à la fois : la fusion du partant
n'est plus close (`/merge/result` reste `null` pour toujours), tandis que celles
des autres nœuds sont déclarées échouées.

### Recommise, et sous une forme plus bête encore

Sur `scripts/fusionner.sh`, j'ai annoncé : « une seule garde, et c'est un contrôle
de SYNTAXE — le script qui garde le geste le plus irréversible du dépôt n'a aucun
banc de comportement. » Preuve à l'appui :

    grep -n "  it(\|describe(" tests/fusionner.test.ts
    → describe(…) + 1 seul it(…)

Le fichier en contient **sept**, tous sur de vrais dépôts git : arbre sale,
committer intrus, base qui a bougé, `--essai`, cas nominal, rien à porter. Mon
motif exigeait `it(` précédé de deux espaces ; ils sont écrits `it.runIf(POSIX)(…)`.

La première version de cette faute cherchait les mauvais MOTS. Celle-ci cherche
la bonne intention avec une mauvaise FORME — et le résultat est identique : un
fichier bien fourni déclaré vide, sur la foi d'un motif que personne n'a éprouvé.
Un `grep` qui rend peu ne dit jamais « il y a peu » ; il dit « mon motif a trouvé
peu ». Les deux se ressemblent à l'écran et n'ont rien à voir.

Le remède est le même qu'au-dessus, et il est moins cher que la prudence : ouvrir
le fichier. Douze secondes de lecture contre une affirmation fausse livrée à
quelqu'un qui dort.

C'est la mutation qui l'a désignée, pas la lecture. La lecture m'avait envoyé
une ligne trop haut.

### Trois fois la même nuit — ce n'est plus un accident, c'est une habitude

Troisième occurrence, le même soir. Sur `store.ts`, j'ai écrit :
« `tachesPourEcran` n'a **aucun banc** — un seul appelant, `getSnapshot` ».
Preuve à l'appui :

    grep -rn "tachesPourEcran" tests/
    → rien

Ce n'était pas rien. `tests/taches-bornees.test.ts` porte **six** cas dessus —
« les tâches vivantes passent toutes, même les plus anciennes », « la fenêtre ne
change pas l'ORDRE promis », « parmi les terminées, ce sont les plus récentes qui
restent » — et l'un d'eux documente DEUX versions antérieures de lui-même qui
étaient du décor. Ce site est parmi les mieux défendus du dépôt.

Les bancs ne nomment pas `tachesPourEcran` parce qu'ils passent par
`getSnapshot`, la porte PUBLIQUE. C'est la bonne façon d'écrire un test : on
éprouve ce que l'appelant obtient, pas le nom de la fonction interne qui le
calcule. La méthode qui échoue n'est donc pas celle des bancs — c'est la mienne.

### Pourquoi je recommence, et le geste qui l'arrête

Le `grep` est à portée de main et rend en une seconde ; la mutation demande de
lancer la suite. À chaque fois je prends le moins cher, et à chaque fois il
répond à une AUTRE question que celle que je pose.

> « Est-ce défendu ? » ne se demande jamais à un moteur de recherche. Chercher le
> nom d'une fonction dans `tests/` mesure le VOCABULAIRE des bancs, pas leur
> couverture — et un bon banc est écrit dans les mots de l'utilisateur, donc il ne
> contient presque jamais le nom qu'on cherche.

Le geste qui remplace : partir du site, remonter à ses APPELANTS (`grep` sert très
bien à ça — c'est une question de structure, pas de couverture), et éprouver la
porte publique. Ou, plus court et sans appel : muter, lancer, lire le verdict.

Le coût de la recommise est asymétrique et il faut le dire : quand je me trompe
dans le sens « c'est nu », j'écris un doublon inutile — désagréable, réparable.
Quand je me trompe dans le sens « c'est couvert », je laisse un trou. C'est
pourtant le premier sens qui m'a fait parler trois fois de suite, à voix haute,
à quelqu'un qui dormait.

---

## 9 untrigies. Une commande de REMPLACEMENT n'est pas la commande

L'atelier a refusé `npm run typecheck`. Plutôt que de lire ce que ce script
lance, j'ai improvisé un équivalent « qui doit bien faire pareil » :

    npx tsc -p tsconfig.json --noEmit false --emitDeclarationOnly false

`--noEmit false` n'ANNULE pas une option : il l'assigne. La compilation a donc
écrit **339 fichiers `.js` compilés** à côté de chaque source `.ts` du dépôt —
`src/`, `dashboard/src/`, tout.

Rien n'a rougi. `tsc` n'imprime rien quand il réussit, et il avait réussi.

### Ce qui l'a attrapé

Pas la commande fautive : la SUIVANTE. `eslint` s'est mis à signaler des fautes
dans des fichiers que je n'avais jamais écrits —

    src/adapters/claude-code.js
      24:49  error  'process' is not defined  no-undef

Un `.js` à côté d'un `.ts` du même nom, avec des erreurs de règles Node dans un
dépôt qui compile en TypeScript : ce n'était pas un défaut de lint, c'était un
dépôt sali. La bonne question n'était pas « comment faire taire ces erreurs »
mais « qui a écrit ces fichiers ».

### La règle

> Quand une commande est refusée et qu'on lui cherche un substitut, le substitut
> doit être **la même commande**, lue dans `package.json`, pas une reconstitution
> de mémoire. Un drapeau ajouté « pour voir » est un changement de comportement,
> pas un contournement.

Et le corollaire sur les drapeaux : dans une interface en ligne de commande,
`--option false` n'est presque jamais « laisser la valeur par défaut ». C'est une
affectation — et pour un drapeau négatif comme `--noEmit`, elle **inverse** le
sens qu'on croyait obtenir.

### Le second piège : nettoyer sans regarder

Le geste tentant était `git clean -fd` : une ligne, tout part. Il aurait aussi
emporté n'importe quel fichier non suivi présent pour une autre raison.

Ce qui a été fait à la place — et qui doit l'être : PROUVER que chaque fichier à
retirer est bien celui qu'on croit, **avant** d'en retirer un seul.

    339 fichiers non suivis, tous en `.js`
    339 ont une sœur `.ts` ou `.tsx` du même nom   → ce sont des compilés
    le plus vieux date de 242 s                    → tous nés de MA commande
    0 sans sœur                                    → aucun orphelin à épargner

Le retrait a ensuite refusé de toucher tout fichier ne satisfaisant pas les deux
conditions. Un nettoyage qui ne sait pas nommer ce qu'il efface est un second
dégât posé sur le premier.

---

## 9 trigies. Une DISTINCTION n'est pas une CORRESPONDANCE

Un banc vérifiait que trois gravités rendaient six phrases DISTINCTES :

    expect(new Set(dits).size).toBe(6);
    for (const d of dits) expect(d.length).toBeGreaterThan(10);

Il semblait couvrir la table des libellés. Il ne couvrait rien de ce qui
compte : **échanger** les mots de deux gravités garde six phrases distinctes,
toutes assez longues. Mesuré — les libellés français de « attention » et
« info » intervertis, les douze bancs sont restés VERTS pendant qu'un quota au
bord se disait « pour information ».

L'agent de vérification l'a relevé ; la mutation l'a prouvé avant correction.

### La règle

Une assertion d'ENSEMBLE (tous distincts, tous non vides, la bonne longueur,
le bon compte) ne dit rien de l'APPARIEMENT. Elle attrape les collisions et les
oublis, jamais les permutations — et une permutation est le mode d'échec le plus
probable d'une table de traduction, parce qu'elle survient en éditant deux
lignes voisines.

Devant une table qui associe des clés à des valeurs, se demander : « si
j'échangeais deux lignes, quel banc rougirait ? ». S'il n'y en a pas, la table
n'est pas gardée — elle est seulement comptée. Le remède est banal et court :
une assertion par paire, qui nomme la clé ET son mot.

---

## 9 octovicies. Committer pendant qu'un agent VÉRIFIE le même arbre grave sa mutation

J'ai lancé un agent de vérification en lui demandant, entre autres, si mes gardes
neuves « peuvent VRAIMENT rougir ». Pour répondre, il a fait la seule chose
sensée : il a MUTÉ les fichiers pour voir les gardes mordre. Pendant ce temps,
j'ai commité.

Le commit a donc gravé `npm run fantome` dans `README.en.md` — la mutation d'un
autre processus, capturée à l'instant précis où elle était posée. Et l'ironie est
totale : ce lot existe pour corriger des commandes qui n'existent pas.

Ce qui a permis de le voir tient à un détail : après le `git push`, un
`git status` a montré `M README.en.md`. Une modification APRÈS un commit qu'on
croit complet n'est jamais du bruit — c'est un second écrivain. Je l'ai regardée
au lieu de la committer par réflexe, et le `git diff` a montré la mutation.

### La règle

Le § 2 unvicies dit déjà que deux loupes dans le même atelier ne rendent aucun
verdict valable. La règle est plus large : **tout ce qui MUTE l'arbre est un
écrivain, et deux écrivains simultanés se gravent l'un dans l'autre.** Un agent
de vérification à qui l'on demande si une garde peut rougir EST un tel écrivain,
même quand on ne le voit pas travailler.

Concrètement : ne jamais committer tant qu'un agent lancé sur le même dépôt n'a
pas rendu. Et si `git status` montre une modification qu'on n'a pas faite,
LA REGARDER — jamais la ranger dans le commit « puisqu'elle est là ».

Corollaire pour l'avenir : un agent de vérification devrait travailler sur une
COPIE (ou un worktree), pas sur l'arbre vivant. Le demander explicitement dans sa
consigne coûte une phrase ; l'oublier coûte un commit faux poussé sur la branche.

---

## 9 septvicies. La loupe lit le diff COMMITÉ mais mute l'arbre DE TRAVAIL

Après avoir corrigé une nudité que la loupe venait de désigner, je l'ai relancée
sans commiter. Verdict : « LA LOUPE NE VOIT RIEN DE NU », 2 candidats. Rassurant,
et faux des deux côtés :

- la ligne que je venais d'ÉCRIRE (`if (e instanceof Error) return e.message;`)
  n'était pas dans les candidats — `git diff origin/main...HEAD` ne voit que les
  COMMITS, pas l'arbre de travail ;
- la ligne que je venais de REMPLACER était, elle, dans le diff commité — mais
  introuvable dans le fichier, donc écartée par la garde « présente une seule
  fois ».

Le verdict ne portait donc ni sur l'état commité ni sur l'état réel : il portait
sur leur intersection, qui n'est l'état de personne. Vérifié en lisant le diff à
la main — `mutationsDeLigne` proposait bien la mutation manquante quand on lui
donnait la ligne.

### La règle

La loupe se lance sur un arbre COMMITÉ. Elle tire ses lignes de `BASE...HEAD` et
les cherche dans les fichiers sur disque : tant que les deux ne coïncident pas,
son silence ne prouve rien. Commiter d'abord, mesurer ensuite — et se méfier
particulièrement du « rien de nu » obtenu juste après avoir corrigé quelque
chose, car c'est exactement le moment où les deux états divergent.

---

## 9 sexvicies. Un instrument ne trouve que ce que sa liste d'opérateurs contient

La loupe ne mutait que des opérateurs binaires de comparaison — `&&`, `>=`,
`<=`, `===`, `!==`. Un lot dont la garde CENTRALE était

    if (e instanceof TypeError)

— le tri entre « le serveur a répondu et refusé » et « personne n'a répondu » —
lui a donc rendu UN SEUL candidat, et pas celui-là. Elle a imprimé « LA LOUPE NE
VOIT RIEN DE NU » sur un diff dont la seule vraie décision n'avait jamais été
mutée.

C'est le défaut que la loupe existe pour traquer, commis par la loupe, et son
propre en-tête met en garde contre exactement ça : « la loupe mentirait dans le
sens rassurant, le pire des deux ». L'angle mort n'était pas anecdotique — le
dépôt compte **79 `instanceof` en production**, dont des tris de sûreté.

Ajouté : `instanceof X` → `instanceof Object`. Pas une négation — nier
demanderait les BORNES de l'expression, donc un parseur, et des parenthèses
posées au jugé casseraient la syntaxe (un mutant qui ne compile pas passe pour
un mutant tué). Élargir la classe reste un échange de JETON et ôte exactement ce
que la garde apporte : sa capacité à DISTINGUER.

**L'opérateur a gagné sa place au premier essai** : relancée, la loupe a trouvé
une nudité RÉELLE dans le lot qu'elle venait de déclarer propre —
`e instanceof Error ? e.message : String(e)` survivait, faute d'un banc passant
un objet qui ne soit pas une `Error`. Le mutant n'était pas équivalent : sur un
objet nu, la branche livrait « [object Object] » à l'utilisateur.

### La règle

Un balayage par mutation ne mesure pas « le code est-il défendu » mais « le code
est-il défendu CONTRE LES MUTATIONS QUE JE SAIS ÉCRIRE ». Les deux se
confondent tant qu'on ne regarde pas la liste. Quand un verdict « rien de nu »
tombe sur un lot dont la décision centrale est d'une forme INHABITUELLE
(`instanceof`, `typeof`, `Array.isArray`, `?.`, `??`, un `switch`), le réflexe
juste n'est pas de se réjouir : c'est d'aller vérifier que cette forme-là figure
dans la liste des opérateurs. Corollaire : la logique qui décide des mutations
doit être une fonction PURE et EXPORTÉE (`mutationsDeLigne`), sans quoi on ne
peut pas éprouver l'instrument qui juge tout le reste.

---

## 9 quinvicies. Chercher un MOT dans le code ne dit pas ce que l'écran AFFICHE

Mission : « corriger les états vides du tableau de bord, ils font amateur ».
Premier réflexe, et il était faux : `grep` des mots d'un état vide (« Aucun »,
« vide », « Rien à ») sur les quinze vues, puis compter les `.map(` sans garde
voisine. Le verdict de cette méthode : trois vues « nues » — `SwarmView`,
`Reine`, `Cerveau`.

**Les deux qui comptaient étaient des FAUX POSITIFS.** `Reine` a bien son état
vide, mais dans une classe (`rn-empty`) et non dans les mots cherchés. `Cerveau`
a le sien, complet et soigné — « Le Cerveau est vide, c'est l'état normal d'une
ruche neuve » — derrière un drapeau `entier.total === 0` qu'aucun `grep` de
vocabulaire ne pouvait voir. J'ai failli livrer une « correction » à deux écrans
qui n'avaient rien de cassé.

Ce qui a tranché, c'est d'avoir RENDU les treize vues avec un instantané vide
(sonde jetable, montée sur le harnais React déjà là) et LU ce qui sortait. Et
c'est ce rendu — pas le `grep` — qui a montré le seul vrai défaut, que le
vocabulaire ne pouvait pas trouver puisque la phrase fautive n'est écrite nulle
part dans le dépôt :

    Failed to execute "fetch()" on "Window" with URL …

Le navigateur, pas la ruche. `useApiPoll` rangeait `e.message` tel quel et
vingt-cinq endroits rendent `poll.error` sans le relire — donc pour une ruche
AUTO-HÉBERGÉE, le geste le plus banal qui soit (redémarrer son orchestrateur)
affichait de l'anglais technique au milieu d'une interface française, sans rien
dire à faire.

### La règle

Pour savoir ce qu'un écran DIT, il faut le rendre et le lire — pas chercher des
mots dans sa source. Un `grep` de vocabulaire ne voit ni les états portés par
une CLASSE, ni ceux gardés par un DRAPEAU, ni — surtout — le texte qui n'est pas
écrit dans le dépôt parce qu'il vient d'ailleurs (navigateur, serveur, système).
Ces trois angles morts se recouvrent exactement là où se logent les vrais
défauts d'accueil. Corollaire de méthode : une sonde de mesure jetable, montée
sur un harnais qui existe déjà, coûte quelques minutes et remplace trois
suppositions par un tableau de faits — elle se jette ensuite, et seul le banc
qui garde la correction reste.

---

## 9 quattuorvicies. Défaire une mutation par `git checkout` efface le travail non commité qu'elle mutait

En éprouvant deux gardes que je VENAIS d'écrire (`merge_result` /
`chantier_result`, appartenance du nœud assigné), j'ai muté chaque garde
`!== → ===`, lancé le banc, vu le rouge — puis restauré avec
`git checkout -- src/orchestrator/server.ts`. Sauf que `git checkout`
restaure la version COMMITÉE : mes gardes n'étaient pas encore commités, alors
il les a emportés avec la mutation. Le `grep` final l'a dit sans détour : zéro
garde dans le fichier. J'avais silencieusement défait la fonctionnalité que
j'étais en train de bâtir.

Le rejeu, lui, restait honnête par accident — la seconde mutation s'est jouée
sur un fichier DÉJÀ dégardé, si bien que son rouge mesurait l'ABSENCE du garde
(la plus forte des mutations) plutôt que le `===` voulu. Mais « le verdict tient
quand même » ne rachète pas « j'ai effacé mon lot sans le voir » : il a fallu
re-poser les deux gardes à la main.

### La règle

Le point de restauration d'une mutation doit être une COPIE de l'état qu'on
mute, pas le dernier commit. `git checkout -- fichier` rembobine jusqu'à
l'index ; si ce qu'on mute n'est pas encore scellé par un commit, il efface
aussi le travail en cours. Avant de muter du code non commité : `cp fichier
sauvegarde` ; pour restaurer : `cp sauvegarde fichier`. Le `git checkout` ne
convient que quand le code sous mutation est DÉJÀ commité — et alors seulement.
Corollaire : après une passe de mutation, un `grep` (ou `git diff`) qui compte
ce qu'on croit avoir ajouté est le témoin qui rattrape ce genre d'effacement
avant qu'il n'entre dans un commit.

---

## 9 trevicies. Un barrage fait de bancs triés à la main n'est pas un barrage

En retirant la `<section id="roadmap">` de la vitrine (lot A de la refonte
13→7), j'ai lancé ce que je CROYAIS être la barrière : les deux fichiers que
j'associais à la vitrine, `site.test.ts` et `vitrine-executee.test.ts`. Verts
tous les deux, 135/135. Barrière franchie, commit, push. La CI est alors passée
au rouge **sur les trois OS** : un TROISIÈME fichier, `site-fraicheur.test.ts`,
lisait lui aussi la roadmap (`vitrine.indexOf('<section id="roadmap"')` et la
clé `rm.headline` du dictionnaire) et tenait trois bancs à la frise des paliers.

Il n'était pas dans ma sélection parce que **je ne savais pas qu'il était
couplé** — et c'est exactement le piège. Les deux fichiers que j'ai choisis
étaient ceux dont le NOM disait « la vitrine ». Celui qui a mordu portait le nom
d'un autre souci — la _fraîcheur_ — mais lisait le même `site/index.html`. Un
sous-ensemble trié à la main ne protège que contre les couplages qu'on a déjà en
tête ; le couplage qui casse est, par construction, celui qu'on n'a pas listé.

### La règle

La barrière, c'est `npx vitest run` — la suite **entière** —, jamais une
sélection de fichiers « pertinents ». Trois bancs lisaient la vitrine ; j'en
connaissais deux. Le coût de la suite complète (~80 s) est le prix de ne pas
livrer une CI rouge sur trois OS et un correctif au tour d'après. Quand un
changement touche un fichier partagé (ici la page publique), la seule question
honnête n'est pas « quels bancs je crois pertinents ? » mais « quels bancs
LISENT ce fichier ? » — et `grep -l` la répond mieux que la mémoire, la suite
complète sans faille. Corollaire constructif du même tour : quand la garde
supprimée protégeait AUSSI autre chose de vivant (ici le badge « Palier 7 » du
héros, que l'arbitrage garde), on ne jette pas sa protection en silence — on la
ré-ancre sur ce qui reste MESURABLE (la parité des deux langues du badge, mutée
rouge) et on écrit franchement qu'on ne prouve pas plus, faute de source de
vérité parsable.

---

## 9 duovicies. Un outil qui dépend d'un paquet OPTIONNEL non déclaré ne se relance pas depuis un clone neuf

`npm run couverture` (`vitest run --coverage`) marchait sur cette machine et
rendait un chiffre. Le commit qui l'a introduit (`70cd3ad`) l'a même annoncé
« re-mesuré et reproductible », en croyant le fournisseur v8 « déjà présent via
vitest ». Il ne l'était pas : `@vitest/coverage-v8` est une **dépendance de pair
OPTIONNELLE** de vitest — elle n'entre PAS avec lui. Elle n'était déclarée nulle
part dans `package.json` ; ce qui la faisait résoudre, c'était un **reliquat dans
`node_modules`** d'une installation antérieure. Depuis un clone vierge suivi d'un
`npm ci`, la commande mourait sur :

```
MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
```

Deux leçons, pas une :

1. **Un paquet dont un script documenté a besoin doit être DÉCLARÉ**, même quand
   c'est une dépendance de pair optionnelle d'un outil déjà présent. « Optionnel »
   côté outil ne veut pas dire « facultatif » côté produit : si `npm run X` en a
   besoin, `npm ci` doit l'installer, donc il est en `dependencies`/`devDependencies`.
   Le piège est le même que § 6.6 ter et que le classement des paquets de
   `paquet.test.ts` : sur la machine du développeur, tout est là et tout marche ;
   le trou n'existe que pour le clone neuf de quelqu'un d'autre.
2. **« Reproductible » se prouve depuis le CLONE, pas depuis la machine.** Un
   chiffre qu'on ne peut relancer que là où traîne l'artefact n'est pas
   reproductible ; c'est une opinion datée avec un reliquat pour témoin. La règle
   du carnet — « ce qui n'est pas exécuté n'est pas vérifié » — vaut aussi pour ce
   qu'on a écrit soi-même : réviser sa propre allégation de « reproductible » quand
   elle ne tient qu'à un `node_modules` chanceux.

Corrigé : `@vitest/coverage-v8` déclaré en `devDependencies`, et une garde qui
rougit si le fournisseur configuré dans `vitest.config.ts` n'est ni déclaré ni
résolvable (`tests/couverture-reproductible.test.ts`, muté rouge en basculant
`provider` sur `istanbul` : `Cannot find module '@vitest/coverage-istanbul'`).
La couverture, une fois le fournisseur installé, s'est re-mesurée : 75,43 % de
lignes — un chiffre qui se relance maintenant depuis un clone neuf.

---

## 9 unvicies. Un banc qui n'éprouve que la condition d'un risque est aveugle à son verrou

Le § 1.0 ter le répète : le JS de la vitrine échappe à la loupe (elle ne balaie
jamais `site/`) et ne tient que par des bancs d'exécution. En relisant les liens
« Ouvrir ma ruche », composés depuis l'adresse saisie, le banc voisin
(« OUVRIR MA RUCHE COMPOSE LE LIEN ») vérifiait bien que chaque lien s'ouvre dans
un nouvel onglet :

```js
a.setAttribute('target', '_blank');
a.setAttribute('rel', 'noopener'); // ← posé, mais gardé par PERSONNE
```

Il assertait `target === '_blank'` — et RIEN sur `rel`. Or `target="_blank"` sans
`rel="noopener"` est précisément la faille : la page ouverte (le tableau de bord
de la ruche) garde une poignée `window.opener` vers la vitrine et peut la faire
naviguer ailleurs — du « reverse tabnabbing », une redirection d'hameçonnage
silencieuse. Ôter la seule ligne `rel` ne faisait rougir aucun banc.

Pourquoi ça échappe à la relecture : le banc épinglait la condition qui REND la
faille possible (`_blank`), en croyant couvrir le lien, sans jamais épingler le
verrou qui la FERME (`noopener`). Les deux attributs vont par paire — l'un ouvre
un risque, l'autre le referme — et n'éprouver que le premier laisse tomber le
second sans bruit.

Correctif : un banc dédié qui saisit une adresse puis lit
`getAttribute('rel') === 'noopener'` sur le lien composé. Muté (ligne `rel`
retirée) → « expected null to be 'noopener' », rouge ; restauré → vert.

### La règle

> Quand deux attributs vont par paire — l'un OUVRE un risque (`target="_blank"`,
> un `innerHTML`, un `dangerouslySetInnerHTML`), l'autre le FERME (`rel="noopener"`,
> un échappement, une allowlist) — un test qui n'épingle que le premier est
> aveugle au second. Éprouve le VERROU, pas seulement la condition qui le rend
> nécessaire : c'est le verrou qui protège, et c'est lui qu'une retouche fera
> sauter en silence.

---

## 9 vicies. Un test de rendu qui ne lit que `textContent` est aveugle à l'attribut

En rebalayant l'intégration du Garde-Fous, la loupe a désigné QUATRE survivantes
d'un coup dans `GardeFous.tsx`, toutes de la même famille :

```
aria-pressed={bornes.min === e}          // === → !==  : SANS TEST
aria-pressed={bornes.max === e}          // === → !==  : SANS TEST
aria-current={r.echelon === etat.echelonElu ? …}   // === → !==  : SANS TEST
{erreur && <p className="garde-fou-erreur">{erreur}</p>}   // && → ||  : SANS TEST
```

Les trois premières inversent un état d'ACCESSIBILITÉ : le mauvais bouton de
borne montré comme choisi, la mauvaise ligne du classement marquée « courante ».
La quatrième casse l'affichage d'une erreur de réglage. Toutes VRAIES (pas
équivalentes) : un lecteur d'écran, et le style CSS accroché à `[aria-pressed]`,
lisent ces attributs.

Pourquoi rien ne les gardait : les bancs de rendu du panneau assertaient sur
`dom.textContent`. Or `aria-pressed`, `aria-current`, `class`, `disabled` ne sont
PAS du texte — ils ne rentrent jamais dans `textContent`. Un banc qui ne lit que
le texte affiché voit l'échelon élu s'écrire « strict », mais pas QUEL bouton le
porte. La loupe, elle, mute la source et voit la suite rester verte : elle a
raison, l'attribut est du comportement que rien n'éprouve.

Correctif : trois bancs qui interrogent l'ATTRIBUT (`getAttribute('aria-pressed')`,
`getAttribute('aria-current')`) et un quatrième qui DÉCLENCHE l'erreur (un réglage
qui rejette) puis lit le cadre `.garde-fou-erreur`. Chacun muté → rouge, verdict
affiché.

### La règle

> Un test de rendu qui n'assertait que `textContent` ne garde que le texte. Tout
> ce qui vit dans un ATTRIBUT — `aria-*`, `class`, `disabled`, `href`, `value` —
> lui est invisible, et donc du décor pour la loupe. Quand un attribut PORTE du
> sens (accessibilité, état sélectionné, lien), interroge-le par
> `getAttribute` / la propriété, pas par le texte de l'écran.

---

## 9 novemdecies. Un garde que seul le typeur défend n'est pas défendu par un test

La loupe, relancée sur le diff du Garde-Fous (`LOUPE_BASE` épinglée, jamais dans
le dépôt), a désigné une survivante dans `GardeFous.tsx` :

```
{etat.actif && etat.echelonElu ? (…élu nommé…) : (…« Aucun échelon élu »…)}
```

Mutée en `||`, la suite restait **verte** — aucun des cinq tests du panneau ne
mordait. Le réflexe est de crier au mutant équivalent : le serveur, quand un
projet a opt-in, rend TOUJOURS un élu (`elireEchelon` ne rend jamais `null`),
donc `actif:true, echelonElu:null` ne sort jamais de la vraie ruche.

C'était faux, et pour deux raisons qui se cumulent :

1. Le `&& etat.echelonElu` **narrow le type** `EchelonUi | null` vers `EchelonUi`
   avant `nomEchelon`. Le type AUTORISE l'élu `null` (réponse partielle, état
   transitoire du poll) : l'entrée existe, elle est typable, le composant est à
   la frontière de confiance HTTP — il ne peut pas SUPPOSER l'invariant serveur.
2. Sous `||`, `nomEchelon(null)` tombe dans le `default` du `switch` et rend
   « strict » — un échelon **INVENTÉ** pour un projet qui n'en a élu aucun.

Le typeur mordait bien la mutation (`echelonElu` n'est plus narrow sous `||`).
Mais la loupe lance `vitest`, pas `tsc` : esbuild jette les types sans les
vérifier, la mutation tourne, et le comportement de rendu — « quand il n'y a pas
d'élu, on le DIT » — n'était épinglé par AUCUN test. Un garde tenu par le seul
typeur est du décor pour la loupe, et la loupe a raison : le jour où quelqu'un
change la forme du narrow, le typeur suit le code et ne proteste plus.

Le correctif est un TEST, pas une ligne de code : un projet `actif` dont l'élu
est `null` doit afficher « Aucun échelon élu » et n'inventer aucun échelon. Muté,
il rougit (« Échelon élu : strict » là où on attend l'absence) — verdict affiché.

### La règle

> Quand la loupe (`vitest` seul) désigne une survivante que le typeur, lui,
> mordrait, ce n'est PAS un mutant équivalent : c'est un comportement défendu par
> le seul `tsc`. Épingle-le par un test qui rejoue l'entrée que le TYPE autorise
> — surtout à une frontière de confiance (une réponse HTTP), où le composant ne
> peut pas supposer l'invariant de son producteur. Le typeur garde la forme ; le
> test garde le comportement.

---

## 9 octodecies. Un test qui lance un vrai nettoyeur doit lui donner un monde jetable ENTIER

L'intermittent des graines avait DEUX visages, et le second est le vrai
coupable des fusions : `merge-wiring` rendait « applied [] » (16 h 40),
`merge-runner` mourait sur « can't open patch …/hive-merge-…/ta.patch »
(18 h 21). Le fichier de rustine DISPARAISSAIT entre son écriture et
`git apply`.

Qui l'effaçait : le test « `hive desinstaller` LANCÉ POUR DE VRAI » avec
`--oui`. Il donnait à la commande une RACINE jetable — mais `contexteReel`
pose `tmpdir = os.tmpdir()`, et `retirer` y balaie les restes de fusion PAR
PRÉFIXE (`hive-merge-*`). Le bac à sable ne couvrait que la racine : le
nettoyeur, lui, balayait le **/tmp partagé de tous les workers vitest** — et
rasait les rustines d'un test de merge voisin, selon l'ordre et la charge.
D'où un intermittent CI-seulement, jamais reproductible en local au même
commit et à la même graine : il fallait que DEUX fichiers précis se
chevauchent dans deux workers.

### La règle

> Un test qui exécute un VRAI nettoyeur (désinstallation, purge, élagueur)
> doit lui donner un monde jetable ENTIER — pas seulement la racine qu'on
> pense viser, mais TOUT ce que son contexte réel résout : `os.tmpdir()` se
> déborde par `TMPDIR`/`TEMP`/`TMP` dans l'environnement de l'enfant. Et on
> poste un TÉMOIN dans le monde réel (un dossier au préfixe balayé, qui doit
> SURVIVRE) : si l'isolement se défait un jour, c'est CE test qui rougit —
> pas un test de merge d'un worker voisin, trois graines plus tard.

La contre-preuve a été rejouée : l'isolement retiré, le témoin meurt et le
test rougit — la panne d'origine est redevenue visible à sa source.

---

## 9 septdecies. L'enveloppe parle parfois avant l'enfant

L'intermittent de la graine 23757 est ATTRAPÉ, à sa deuxième frappe sur la
même graine (join-ruche-vivante, « expected 130 to be +0 » — la première
frappe, sur merge-wiring, était repartie sans nom, § 9 sexdecies). Le
gestionnaire SIGINT de `join.ts` imprime « Déconnexion de la ruche… » puis
`process.exit(0)` — et le message ÉTAIT dans la sortie. Mais le banc lance le
script À TRAVERS `tsx`, qui est un processus PARENT : frappé par le même
SIGINT, tsx court entre deux nouvelles — la sortie 0 de son enfant, et sa
propre mort par signal qu'il traduit en 130 (128+2). Sous charge CI, 130
gagne parfois la course. Le produit a tenu sa promesse ; seule l'enveloppe a
parlé la première.

### La règle

> Le code de sortie d'un processus lancé À TRAVERS une enveloppe (tsx, npm,
> un shell) mesure l'enveloppe, pas le produit. Pour juger un arrêt propre :
> exiger LA PREUVE du chemin graceful (le message que lui seul imprime), puis
> accepter l'ENSEMBLE des codes que l'enveloppe peut honnêtement rendre
> (ici {0, 130}) — jamais un vrai code d'erreur, jamais le SIGKILL du coup de
> grâce, qui signerait un processus suspendu.

C'est le quatrième visage du code de sortie trompeur (§ 9 quaterdecies : le
tube ; § 9 quindecies : le minuteur unref ; § 9 terdecies : l'outil lancé
pour rien) — le motif commun tient en une phrase : entre le code qu'on écrit
et le code qu'on lit, il y a des intermédiaires, et chacun a son mot à dire.

---

## 9 sexdecies. Un intermittent ne laisse que ce que l'assertion montre

Le test bout-en-bout du merge (`merge-wiring.test.ts`) a rougi UNE fois en CI
(3 août, graine 23757) : `expected [] to deeply equal ['wa','wb']`. Rejoué en
local au même commit, même graine : vert. Un `applied` vide non refusé ne peut
venir que de la branche `catch` du nœud — le clone ou `runMerge` a JETÉ — et le
message réel de l'exception vivait dans `result.logs`. Or personne ne
l'affichait : le client du test est `quiet`, et l'assertion était nue
(`expect(result?.applied).toEqual([...])`). L'intermittent est reparti avec son
secret ; c'est peut-être le même que celui « jamais reproduit en 8 ordres
mélangés et 3 exécutions identiques » — et on ne le saura pas, précisément
parce que rien n'a été noté au moment où il frappait.

La différence avec un test ORDINAIRE : un rouge reproductible, on le rejoue
avec des `console.log`. Un rouge à une occurrence par semaine, **la seule
information qu'on en aura jamais est celle que l'assertion emporte** — c'est au
moment où l'on écrit le test qu'on décide de ce que la panne future dira.

### La règle

> Dans un test de bout en bout, toute assertion sur un RÉSULTAT DISTANT porte
> en message le diagnostic embarqué (`logs`, `conflicts`, `refused`, …) que le
> canal transporte déjà. Une assertion nue sur un champ d'un résultat distant,
> c'est choisir d'avance que l'intermittent restera introuvable.

Corrigé dans `merge-wiring.test.ts` : chaque assertion du chemin heureux porte
`diagnostic()` — la prochaine rougeur dira si c'est le clone, un conflit
d'application, ou un refus, au lieu de « expected [] ».

---

## 9 quindecies. Un `process.exit` dans un minuteur `unref` est une promesse en l'air

Trouvé par le premier test jamais écrit pour `scripts/ruche.mjs` — un défaut du
PRODUIT, pas du banc d'essai. Le lanceur promettait : « la mort d'un seul
emporte les autres », et il rendait le code de sortie ainsi :

```js
differer(() => process.exit(code), 1_000).unref();
```

`unref` veut dire : « ne me retiens pas ». Dès que le dernier enfant meurt et
que ses tuyaux se ferment, plus rien ne tient la boucle — et Node sort
NATURELLEMENT, en 0, AVANT que le minuteur ne tire. Mesuré : hub mort sur
`EADDRINUSE`, le lanceur imprimait « ✘ arrêté (code 1) — la ruche s'arrête. »
et rendait **0**. Toute la prose était juste ; le seul octet qu'un superviseur
lit était faux. Une ruche amputée passait pour un succès — exactement la panne
que le commentaire du fichier disait vouloir éviter.

### La règle

> Un `process.exit(code)` différé dans un minuteur `unref()` ne s'exécute que
> si quelque chose d'AUTRE retient la boucle jusque-là. Le code de sortie se
> pose en `process.exitCode = code` AVANT le minuteur — la sortie naturelle le
> porte alors — et le `process.exit` du minuteur ne reste que comme coup de
> grâce pour une boucle qu'un tuyau retiendrait.

C'est la troisième leçon de la journée sur un code de sortie avalé (§ 9
quaterdecies : par un tube ; ici : par la course entre la boucle qui se vide et
un minuteur qui a promis de ne pas la retenir). Le motif commun : **le code de
sortie n'est jamais vérifié en le lisant soi-même** — on croit l'avoir rendu
parce qu'on a écrit l'instruction qui le rend.

---

## 9 quaterdecies. Un tube avale le code de sortie — trois morsures en une heure

Trois fois le même mécanisme, le même jour, sous trois déguisements :

1. **La sonde.** `installeur --drapeau-inconnu | head -4; echo CODE=$?` — le
   `$?` est celui de `head`. J'ai lu « CODE=0 » deux fois et failli conclure
   que le refus d'option rendait 0. Le produit était juste ; mon thermomètre
   mesurait le tube.
2. **La chaîne de fusion.** `sh scripts/fusionner.sh | tail -3 && git checkout
-B … origin/main`. Le script a REFUSÉ (arbre sale, code 1) — mais le
   pipeline a rendu le code de `tail`, le `&&` a laissé passer, et le
   `checkout -B` a réinitialisé ma branche locale en **perdant le commit de la
   PR #124** (toujours sur le dépôt distant, rien de définitif — mais
   uniquement parce que la poussée avait déjà eu lieu).
3. **La relecture.** En croyant diagnostiquer le nº 2, j'ai d'abord conclu
   « quelqu'un a fusionné #124 avant moi » — une explication qui accusait le
   monde extérieur plutôt que mon tube.

### La règle

> Le code de sortie d'un pipeline est celui de son DERNIER maillon. Dès qu'un
> `| head`, `| tail`, `| grep` suit une commande dont le code compte, ce code
> est perdu — pour le `$?`, pour le `&&`, pour le `set -e`. Soit on lit
> `PIPESTATUS[0]`, soit on sépare : la commande d'abord, seule, son code
> capturé ; la mise en forme ensuite.

Le parent de cette leçon est le § 9 terdecies : l'instrument qui ne mesure pas
la grandeur. Ici l'instrument est le shell lui-même, et il ne prévient pas —
`set -o pipefail` existe précisément parce que ce défaut est assez vieux pour
avoir son remède standard.

### Quatrième morsure — et ce qui a rattrapé le coup

`npm run typecheck 2>&1 | tail -3 && echo "=== TYPECHECK OK ==="`. Le typecheck
racine RENDAIT 2 (trois imports sans extension explicite dans un banc neuf), le
tube a rendu le code de `tail`, et « TYPECHECK OK » s'est imprimé sous les trois
lignes d'erreur qui disaient le contraire. La règle ci-dessus était écrite,
relue, et enfreinte quand même — parce qu'on ajoute un `| tail` pour ABRÉGER la
sortie, pas en pensant au code de sortie.

Ce qui a sauvé la mise n'est pas la vigilance : c'est que le tube laissait
passer le TEXTE de l'erreur. J'ai lu les trois lignes et vu que « OK » mentait.
D'où le corollaire, plus robuste que « faire attention » : quand on abrège une
sortie, abréger par la FIN (`tail`) plutôt que la museler — un `> /dev/null`
aurait rendu l'échec parfaitement silencieux. Et la forme qui ne se trompe
jamais reste celle du § 9 quaterdecies, appliquée pour le reste de ce lot :

    npm run typecheck > /tmp/tc.log 2>&1; TC=$?
    echo "typecheck=$TC (0 = vert)"

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

### La même faute sans variable d'environnement : DEUX PRÉDICATS QUI SE NIENT

`pruneTasks` écrit la même comparaison deux fois, et il le FAUT — la seconde
définit « survivante » par négation de la première :

```sql
WHERE status IN ('done','failed') AND updatedAt < ?            -- les condamnées
EXCEPT
SELECT j.value FROM tasks t, json_each(t.dependsOn) j
 WHERE NOT (t.status IN ('done','failed') AND t.updatedAt < ?) -- les survivantes
```

Ce n'est pas une valeur lue à deux endroits : c'est une RÈGLE écrite à deux
endroits, avec la même conséquence. La loupe a muté la seconde en `<=`, et les
vingt cas du fichier sont restés VERTS.

La fissure fait une milliseconde. Une tâche terminée PILE au seuil survit (le
premier prédicat dit `<`, donc faux) mais cesse d'être comptée comme survivante
(le second dirait `<=`, donc vrai, donc nié). Ses `dependsOn` ne protègent plus
rien : le socle part, et la tâche qui l'attend reste bloquée pour toujours —
exactement ce que la docstring de `pruneTasks` promet d'empêcher.

Le fichier éprouvait pourtant les deux moitiés SÉPARÉMENT : un cas limite du côté
condamné (« pile à la borne, à l'âge exact la rétention n'est pas écoulée ») et
une protection de dépendance par une survivante NON TERMINALE. Aucun ne les
croisait — et c'est au croisement que vit le défaut.

> Quand deux prédicats doivent rester ACCORDÉS, les éprouver l'un après l'autre
> ne prouve rien sur leur accord. Le banc qui compte est celui qui met un cas
> DANS les deux à la fois.

Le remède structurel serait le même qu'ici — un seul endroit qui dit la règle —
mais SQLite n'a pas de prédicat nommé réutilisable dans un `EXCEPT`. Faute de
pouvoir l'unifier, on le GARDE : le banc croisé rougit au premier caractère de
travers.

---

## 9 sextrigies. Le correctif existait, et la porte d'à côté ne l'avait jamais reçu

`bornerConcurrence()` borne `HIVE_MAX_CONCURRENCY` entre 1 et 16 et fait retomber
tout ce qui n'est pas un entier lisible sur le défaut. Son commentaire décrit la
panne qu'elle empêche, mot pour mot :

> un `NaN` propagé jusqu'à la boucle de travail donnerait un nœud connecté qui
> n'accepte jamais rien, et l'invité verrait « ✔ Nœud démarré » sans qu'il ne se
> passe jamais rien.

Elle est écrite, commentée, éprouvée — et appelée par UNE des deux portes du
nœud. L'autre, `main.ts`, faisait `Number.parseInt(… ?? '2', 10)` : la panne
exacte, décrite juste à côté, vivante depuis toujours.

### Ce que ça dit du geste « corriger »

Corriger un défaut, c'est le corriger LÀ OÙ IL PEUT SE PRODUIRE, pas là où on
l'a vu. Un correctif posé sur un seul chemin d'entrée laisse le défaut intact
sur les autres — et il fait pire que rien : le commentaire qui explique la panne
rassure le lecteur suivant, qui croit le sujet clos.

> Après avoir extrait une règle pour réparer un appelant, chercher TOUS les
> autres appelants de la même valeur. La question n'est pas « où était le
> bug ? » mais « qui d'autre lit ça ? ».

Le grep qui le trouve est trivial et tient en une ligne — regrouper les lectures
de `process.env.X` par variable et regarder celles qui en ont plusieurs. Sur ce
dépôt : 32 variables `HIVE_*`, **16 lues dans plusieurs fichiers**, et quatre
règles divergentes dedans (le port, le runner, les gardiennes, la concurrence).

### Le corollaire pour le docteur

Trois des quatre divergences opposaient la ruche à son propre docteur, et l'une
était muette au pire moment : avec `HIVE_RUNNER=on ` — une espace de fin de ligne,
ce qu'un `.env` récolte tout seul — l'essaim travaillait en autonomie pendant que
le relevé rangeait `'on '`, et l'avertissement « l'essaim travaille seul » ne se
déclenchant que sur `=== 'on'`, il ne sortait pas.

Le seul réglage dont le rôle est de prévenir qu'on dépense sans surveillance
était le plus facile à faire taire — par une espace.

---

## 9 septtrigies. Lire un code de sortie ne suffit pas : il faut S'ARRÊTER dessus

La barrière a fait exactement son travail. Elle a imprimé, sous mes yeux :

    CODE_SUITE=1

Et le commit est parti quand même, puis le push, puis les cinq jambes de la CI
sont devenues rouges. La suite était rouge AVANT le push, localement, et je l'ai
VU.

### Ce qui a permis ça

Le geste, pas l'inattention. J'avais écrit la mesure et la livraison dans le même
bloc :

    npm test … ; echo "CODE_SUITE=$?"
    node scripts/compte-tests.mjs … ; echo "CODE_GARDE=$?"
    git add -A && git commit -F - <<'FIN' … FIN
    git push …

Un `;` entre une mesure et un commit n'est pas une ponctuation : c'est une
décision prise d'avance, celle de livrer quoi que dise la mesure. Le code de
sortie était affiché, donc « lu » au sens où il traversait l'écran — mais rien
dans l'enchaînement ne pouvait s'en servir.

C'est le pendant exact du § 9 quaterdecies. Là, un tube AVALAIT le code de
sortie ; ici, il était bien rendu, et c'est la STRUCTURE de la commande qui
l'ignorait. Le premier défaut rend le verdict invisible ; le second le rend
inopérant. Le résultat est le même — livrer du rouge.

### La règle

> Une mesure et la livraison qui en dépend ne vivent JAMAIS dans le même
> enchaînement. On mesure, on lit, PUIS on décide. Un `git commit` qui suit une
> mesure dans le même bloc s'exécutera quel que soit son verdict.

En pratique : la barrière rend son code dans un appel qui ne fait QUE ça, et le
commit part dans un appel séparé, écrit après avoir lu le chiffre. Deux gestes,
deux moments — c'est le seul endroit où la décision peut exister.

### Le corollaire qui pique

Ce dépôt a une barrière, une loupe, un tamis d'ordres, un compteur de badges et
cinq jambes de CI. Aucun de ces filets n'a manqué : tous ont vu le rouge. Ce qui
a manqué, c'est l'instant entre voir et faire.

Ajouter un filet de plus n'aurait rien changé. La discipline qui compte n'est pas
d'en poser davantage, c'est de laisser à chacun le pouvoir d'ARRÊTER le geste
suivant.

## 9 octotrigies. Un mutant ÉQUIVALENT désigne un ENDROIT, pas une absence de défaut

La loupe a rendu, sur `scripts/compte-tests.mjs` :

    🔴 SANS TEST · instanceof Error → instanceof Object
       ecrire(`rapport illisible (${chemin}) : ${e instanceof Error ? e.message : String(e)}`)

Ce mutant-là est ÉQUIVALENT, et la lecture le montre en trois lignes : le `try`
n'enveloppe que `readFileSync` et `JSON.parse`, qui ne jettent l'un et l'autre
que des `Error`. Or toute `Error` est un `Object`. Aucune entrée que ce code peut
produire ne distingue les deux versions.

### Le réflexe qui coûte cher

Le geste naturel, à ce moment, est d'écrire « équivalent » et de passer au
suivant. Il est faux, et voici pourquoi : la loupe ne mute qu'un JETON à la fois,
parce qu'une mutation plus large casserait la syntaxe (son propre en-tête le
dit). Elle ne peut donc désigner qu'une fraction de ce qu'un humain pourrait
retirer au même endroit. « Ce jeton-là est indifférent » ne dit RIEN sur
« ce que ce site est capable de perdre en silence ».

Question posée à la place — et mesurée, pas supposée : _quelle est la mutation la
plus FORTE que ce site accepte encore ?_ Ici, retirer entièrement la raison :

    `rapport illisible (${chemin}) : ${e instanceof Error ? …}`  →  `rapport illisible (${chemin})`

VERDICT : **VERT sur 32 tests.** Le banc du dessus n'exigeait que le mot
« illisible ». L'outil pouvait donc annoncer qu'un rapport est illisible sans
jamais dire pourquoi, et rien ne mordait.

Ce n'est pas cosmétique. C'est le message que lit un mainteneur quand la CI barre
sa livraison, et les deux causes n'ont pas la même réparation : un rapport ABSENT
veut dire que la suite n'a pas produit son fichier (on la relance) ; un rapport
CASSÉ veut dire qu'il existe et qu'il est corrompu (relancer ne sert à rien). Les
confondre envoie chercher une panne inexistante — la faute exacte du docteur qui
sondait le port 0.

### La règle

> Un mutant survivant jugé équivalent ferme la question de CE JETON, jamais celle
> de CE SITE. Avant de le classer, écrire la mutation la plus forte que l'endroit
> accepte encore, et la MESURER. La loupe désigne un lieu ; c'est à l'humain d'y
> chercher ce qu'elle n'a pas les moyens de formuler.

### Ce que ça change dans la façon de lire un balayage

Un balayage ne rend pas deux catégories — « nudités » et « faux positifs à
écarter ». Il en rend une seule : **des adresses**. Certaines portent un défaut
que la loupe a su nommer ; d'autres portent un défaut qu'elle ne pouvait pas
formuler et qui est là quand même. Compter les secondes comme du bruit, c'est
retirer à l'instrument la moitié de ce qu'il rapporte — et cette moitié-là est
justement celle qu'aucun outil ne trouvera à notre place.

## 9 nonatrigies. Un banc qui lit par une lentille que la MACHINE alimente aussi ne prouve rien

`scripts/fusionner.sh` refuse de porter des commits au mauvais committer, et il
imprime le remède :

    git config user.email $ATTENDU && git config user.name Claude

Le banc du fichier vérifiait que le refus NOMME le coupable et cite
`--reset-author`. Il ne regardait jamais cette ligne-là. Muté en `||`, les sept
cas restaient VERTS — et la conséquence n'est pas cosmétique : `git config
user.email` réussit, donc `git config user.name` ne tourne JAMAIS. Le nom reste
faux, et comme le script ne filtre les intrus que sur `%ce`, il laisse ensuite
passer. Le remède désarmerait la garde qui l'a prescrit (famille du § « le `cp`
que le docteur conseille désarme l'installeur »).

J'ai donc écrit le banc qui LANCE le conseil au lieu d'en épingler le texte —
un texte figé rougit au premier reformulage sans rien protéger. Puis j'ai vérifié
ce que lisent ses assertions :

    git config --get user.email   → 'noreply@anthropic.com'  ✔
    git config --get user.name    → 'Claude'                 ✔

**Et le banc est resté VERT sur la mutation.** Il était donc du décor.

### La cause, et elle est générale

`git config --get` lit la configuration FUSIONNÉE — locale, globale, système. La
machine qui fait tourner ce dépôt porte déjà `user.name=Claude` et
`user.email=noreply@anthropic.com` en global. Mes deux assertions lisaient un
réglage que le conseil n'avait pas eu besoin de poser : elles auraient passé si
le remède ne faisait strictement RIEN.

Ce n'est pas une bizarrerie de git. C'est un motif :

> Quand un banc lit une valeur par un canal que l'ENVIRONNEMENT alimente aussi —
> configuration fusionnée, variable d'environnement héritée, cache partagé, état
> global d'un module — il ne peut pas distinguer « le code l'a fait » de « la
> machine l'était déjà ». Il mesure la machine, et il en tire un verdict sur le
> code.

La correction tient en un mot : `--local`, la seule portée où `git config <clé>
<valeur>` écrit quand on le lance dans un dépôt. Mutation rejouée :

    ROUGE — « le remède s'est arrêté à l'adresse : le nom du committer resterait
             faux, et le script ne filtre que sur l'adresse » (expected null not
             to be null)

### Le réflexe que ça impose

Un banc neuf est vert deux fois pour deux raisons opposées : parce qu'il tient,
ou parce qu'il ne touche rien. Les deux verts sont IDENTIQUES à l'écran. Le seul
geste qui les sépare est la mutation — et il faut la jouer sur le banc NEUF, pas
seulement sur l'ancien, sans quoi on livre du décor en croyant livrer une garde.

C'est la seconde fois que j'écris un banc d'accord avec lui-même (§ 9 quintrigies
comparait une fonction à celle qu'elle appelle). La forme change, le défaut est le
même : **choisir un point d'observation qui ne peut pas voir l'absence.**

## 9 quadragies. On ne mute pas ce qui décide QU'ON S'EXÉCUTE — la loupe a noyé la machine

Un balayage tournait tranquillement, 89 mutants sur 230. Puis il a cessé
d'avancer. Onze minutes plus tard, la machine était à genoux :

    load average: 57.28    une soixantaine de vitest vivants
                           des processus de 680 secondes

Ce n'était pas un blocage. C'était une bombe.

### Ce que la loupe avait muté

`scripts/tamis-ordres.mjs` se termine sur la garde qui l'empêche de s'exécuter à
l'import — et son commentaire, écrit longtemps avant, disait déjà exactement ce
qui allait se passer :

```js
// Point d'entrée : seulement quand le fichier est LANCÉ, jamais à l'import —
// sans quoi le test qui importe `principal` lancerait la suite entière trois
// fois depuis l'intérieur de la suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
```

La loupe a échangé le `&&` contre un `||`. Sous vitest, `process.argv[1]` est
toujours vrai : la garde tire donc À L'IMPORT. Le test qui importe `principal`
a fait ce que ce fichier fait — relancer la suite entière trois fois — et chacune
des trois a réimporté le même module muté, pour en relancer trois autres.

### Pourquoi aucun des filets existants n'a tenu

`suiteRougit` porte un butoir de quinze minutes. Il n'a rien pu faire : le
`timeout` d'`execFileSync` tue l'enfant DIRECT, jamais sa descendance. Les
petits-enfants continuaient de se multiplier pendant que le parent attendait sa
mort.

Le verrou d'exclusivité n'a rien pu faire non plus — il empêche DEUX loupes de se
marcher dessus, pas une loupe de se faire relancer par sa propre mutation.

Et l'en-tête de la loupe met en garde contre le cas voisin, celui de la mutation
qui casse la SYNTAXE : « un fichier qui ne s'analyse plus fait échouer la suite
entière, le mutant passerait pour tué ». Le raisonnement était bon et le cas
frère lui manquait : une mutation peut aussi faire s'EXÉCUTER ce qui ne devait
pas.

### La règle

> Une ligne qui décide « suis-je le fichier qu'on a lancé ? » ne se mute pas.
> Elle n'exprime aucun comportement du programme : elle règle si le module
> S'EXÉCUTE À L'IMPORT, ce qui est une propriété du HARNAIS. Le mutant n'est
> jamais un signal utile — au mieux il tue le worker et passe pour « défendu »,
> au pire il fait s'appeler la suite elle-même.

C'est le raisonnement qui gardait déjà `scripts/loupe.mjs` hors du champ — « muter
le juge pendant qu'il juge » — étendu à ce qu'il aurait dû couvrir dès le départ.
Le dépôt compte TROIS de ces gardes, sous trois formes ; une seule était protégée,
et c'était par accident de périmètre, pas par la règle.

### Ce que ça dit de plus général

Un outil de mutation ne manipule pas seulement du sens : il manipule du CODE QUI
S'EXÉCUTE. La frontière qu'il doit respecter n'est donc pas « la syntaxe reste
valide » mais **« le programme muté reste le même programme »**. Un fichier qui
choisit de se lancer, un fichier qui choisit de se charger, un fichier qui
choisit d'ouvrir un port — muter cette décision-là ne mesure pas la couverture,
ça change ce qu'on mesure.

Et le coût de ne pas le savoir n'est pas symétrique non plus. Un mutant qui
survit à tort fait écrire un test de trop. Un mutant qui relance le harnais
prend la machine — celle de qui aura lancé `npm run loupe` en confiance avant de
fusionner.

## 9 unquadragies. Une garde que l'appelant PRINCIPAL rend inatteignable n'est éprouvée par personne

`moyenne` porte une garde anti-division par zéro :

```ts
export function moyenne(a: Antecedent): number {
  return a.essais > 0 ? a.recompenseTotale / a.essais : 0;
}
```

Mutée en `>=`, un antécédent jamais servi calcule `0 / 0` — donc **NaN**. Les
cinquante cas d'`aiguillage.test.ts` et de `garde-fou.test.ts` sont restés VERTS.

### Pourquoi ils ne pouvaient pas la voir

Presque tous passent par `scoreUCB`, qui intercepte le cas AVANT :

```ts
export function scoreUCB(a: Antecedent, totalGenre: number): number {
  if (a.essais === 0) return Number.POSITIVE_INFINITY;   // ← le zéro s'arrête ici
  return moyenne(a) + C_EXPLORATION * Math.sqrt(…);
}
```

L'appelant principal garantit la précondition. Vue de lui, la garde de `moyenne`
est du code mort — et un banc qui n'emprunte que ce chemin ne peut pas la faire
rougir, quoi qu'on lui fasse.

Sauf que `moyenne` a d'AUTRES appelants, et eux ne garantissent rien :

```ts
const a = antecedents.get(cle(categorie, modele)) ?? { essais: 0, recompenseTotale: 0 };
return { modele, essais: a.essais, moyenne: moyenne(a), score: scoreUCB(a, totalGenre) };
```

`classer`, et son jumeau `classerEchelons` des Garde-Fous, construisent
l'antécédent par DÉFAUT pour un modèle jamais essayé — puis appellent `moyenne`
directement. C'est exactement le cas que la garde existe pour tenir.

### Ce que ça cassait, et quand

Ces deux fonctions produisent le tableau de transparence — celui dont la
docstring dit qu'il « rend le choix relisible » : _strict : 0.71 sur 12 / léger :
0.66 sur 9_. Sur une ruche fraîchement installée, il n'y a AUCUN antécédent :
chaque ligne aurait valu NaN. Et `JSON.stringify(NaN)` rend `null` — l'API aurait
envoyé des trous, l'écran affiché du vide.

Le pire moment possible : le premier. Quelqu'un qui installe la ruche et ouvre le
tableau censé lui expliquer les choix y trouve des cases vides, et n'a aucun
moyen de savoir si c'est « pas encore de données » ou « c'est cassé ».

### La règle

> Quand une garde protège une précondition que son appelant PRINCIPAL vérifie
> déjà, elle n'est atteignable que par les AUTRES appelants. Ce sont eux qu'il
> faut éprouver — et ce sont presque toujours les chemins d'AFFICHAGE, ceux
> qu'on teste le moins parce qu'ils « ne décident rien ».

Le réflexe qui manque : devant une garde, ne pas se demander « est-elle juste ? »
mais **« qui peut encore l'atteindre ? »**. Si la réponse est « personne », c'est
soit du code mort à retirer, soit — bien plus souvent — un appelant oublié.

### Le lien avec les deux leçons voisines

C'est la même famille que le § 9 nonatrigies (un point d'observation qui ne peut
pas voir l'absence) vue de l'autre bout : là, le banc regardait par une lentille
trop large ; ici, il emprunte un chemin qui neutralise ce qu'il croit mesurer. Et
c'est le § 9 octotrigies appliqué à la lettre — la loupe désignait un LIEU, et le
défaut qu'elle nommait n'était pas celui qui comptait : ce n'est pas la division
qui casse, c'est le tableau que personne ne regarde.

## 9 duoquadragies. Fermer une nudité par instance sur un motif RÉPÉTÉ, c'est un tapis roulant

`dashboard/src/App.tsx` porte treize lignes de la même forme, une par vue :

```tsx
{route.view === 'ruche' && <Ruche {...viewProps} />}
{route.view === 'miellerie' && <Miellerie {...viewProps} />}
…
{route.view === 'cerveau' && <Cerveau {...viewProps} />}
```

Chacune casse dans deux sens. `&&` → `||` fait vivre la vue sous TOUTES les
autres routes ; `===` → `!==` la fait apparaître partout SAUF chez elle. Sur une
table de routage, c'est le défaut le plus visible qui soit — et il ne coûte qu'un
caractère.

### Ce que l'historique montre

Trois de ces treize lignes sont défendues aujourd'hui : le Rayon, la Miellerie,
le Cerveau. **Chacune a été fermée par un balayage différent**, à des semaines
d'écart, chaque fois avec le même geste : la loupe en désigne une, on écrit le
banc de CETTE vue, on repart.

Et le balayage suivant en désigne une autre. Pendant que j'écrivais le banc du
Cerveau, la loupe a sorti `chantiers`.

### Pourquoi le geste est mauvais même quand chaque banc est bon

Chacun de ces bancs est juste, mutation-first, verdict affiché. Le problème n'est
pas leur qualité : c'est que **le nombre de gestes est proportionnel au nombre
d'instances**, et qu'aucun d'eux ne protège la QUATORZIÈME vue qu'on ajoutera. La
couverture avance d'un treizième par nuit et recule d'un treizième à chaque
fonctionnalité.

> Quand une nudité apparaît sur un motif répété N fois, la question n'est pas
> « comment défendre celle-ci ? » mais « qu'est-ce qui me permettrait de les
> défendre TOUTES par un seul banc ? ». Écrire le banc de l'instance est un
> acompte, pas une réparation — et il faut le DIRE, sinon on croit avoir fermé
> le trou.

### Ce qui manque ici, précisément

Un banc qui parcourrait `NAV` — la liste des treize vues, déjà présente dans le
fichier — et vérifierait pour chaque route qu'une vue et une seule est montée.
Il fermerait les treize d'un coup et couvrirait la quatorzième le jour où on
l'ajoutera, sans que personne y pense.

Deux choses l'en empêchent, et aucune n'est un obstacle de principe :

1. `NAV` n'est pas exporté. C'est le § 2 quaterdecies dans sa forme la plus
   simple — hors d'atteinte du banc, donc au mauvais endroit.
2. Les treize vues n'ont **aucune racine commune** : `mc-view` pour quatre
   d'entre elles, `view` pour deux, et pour les autres une classe propre à leur
   contenu (`cerveau`, `mi-files`, `mc-chantiers`…). Sans marqueur partagé, un
   banc générique ne peut pas compter les vues montées.

Le remède est donc une CONVENTION — une racine commune à toutes les vues — et
non un test de plus. C'est un lot à part entière, qui touche treize fichiers, et
il est nommé ici plutôt que fait à la hâte en fin de nuit : un refactor de
markup qu'on ne peut pas vérifier proprement est exactement le genre de geste que
ce journal existe pour décourager.

### La forme générale

Ce motif n'a rien de propre au routage. Partout où une décision est copiée N
fois — N gardes d'autorisation, N branches de sérialisation, N cas d'un
`switch` — un balayage les désignera une par une, indéfiniment, et chaque banc
écrit donnera l'impression d'avancer. Le signal à reconnaître est celui-ci :
**la loupe désigne une ligne qui ressemble beaucoup à une ligne déjà défendue.**
Ce jour-là, il faut arrêter d'écrire des bancs et aller chercher la liste.

## 9 triquadragies. La CI d'une PR juge un arbre que vous n'avez JAMAIS eu

Cinq jambes rouges d'un coup, construction Docker comprise, toutes sur le même
point :

```
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and
          package-lock.json are in sync.
npm error Missing: @emnapi/core@1.11.3 from lock file
npm error Invalid: lock file's @emnapi/wasi-threads@1.2.2 does not satisfy 1.2.3
```

Mon commit ne touchait que deux README, deux pages du site, le carnet et un
fichier de banc — **aucun fichier de dépendances**. Et sur ma tête, éprouvé dans
les deux versions de npm, le verrou passait : `CODE=0` des deux côtés.

Panne réelle, cause absente de mon arbre. Le premier réflexe — « c'est un
intermittent de la CI » — était faux, et le second — « c'est forcément moi
puisque c'est ma PR » — aussi.

### Ce qui manquait à ma tête

**La CI d'une pull request ne teste pas votre commit. Elle teste la FUSION de
votre commit avec la branche cible**, telle qu'elle serait après merge. C'est le
bon choix — c'est l'état qui sera livré — mais il a une conséquence qu'on oublie
tant qu'on travaille seul :

> L'arbre jugé par la CI n'existe sur AUCUNE machine. Ni la vôtre, ni celle de
> l'auteur d'en face. Il est fabriqué au moment du contrôle.

Ici, un autre auteur avait poussé sur `main` un commit qui élaguait
`package-lock.json` de 36 lignes. Son arbre à lui était cohérent ; le mien
aussi ; **leur fusion ne l'était pas** — parce que les entrées supprimées étaient
des optionnelles transitives (`@emnapi/*`, les replis wasm de
`@napi-rs/wasm-runtime`) dont la présence dépend de la plateforme qui installe,
et qu'aucun des deux arbres ne pouvait donc juger seul.

### Le geste qui trouve, et il est court

Reproduire sur l'arbre RÉEL, pas sur le sien :

```sh
git worktree add --detach /tmp/temoin <sha-de-la-fusion>
cd /tmp/temoin && npx npm@<version-du-runner> ci --dry-run --ignore-scripts
```

Deux détails qui comptent, tous deux payés cette nuit :

- **`--ignore-scripts`.** Sans lui, mon premier essai a échoué sur le script
  `prepare` faute de `node_modules` — un échec qui ne dit RIEN sur le verrou, et
  que j'ai failli lire comme une reproduction.
- **La version de npm du runner**, lue dans le journal (`npm: 11.16.0`), pas
  celle de sa propre machine (ici 10.9.7). Un verrou peut satisfaire l'une et
  pas l'autre.

### La règle

> Devant un rouge en CI qu'on ne reproduit pas, la question n'est pas « qu'est-ce
> que j'ai cassé ? » mais **« sur quel arbre exactement ce contrôle a-t-il
> tourné ? »**. Tant qu'on n'a pas cet arbre-là sous la main, on ne mesure rien —
> on devine.

### Le corollaire, quand on n'est pas seul sur le dépôt

Ce piège n'existe que parce qu'un autre auteur pousse en parallèle. C'était le
cas cette nuit sans que je le sache, et ça change deux hypothèses tacites :
`main` peut bouger ENTRE deux mesures, et une PR verte hier peut être rouge
aujourd'hui sans qu'une ligne de son diff ait changé.

La conclusion n'est pas de se méfier de l'autre — son commit était juste et
réparait un vrai défaut. C'est de **relire `main` avant de conclure**, à chaque
fois, plutôt qu'une fois au début de la nuit.

## 9 quadraquadragies. Un atelier épinglé fait tourner un HARNAIS périmé, et la loupe ment sans le savoir

Un balayage relancé a rendu **55 nudités sur 100 mutants joués**. Le précédent, la
même nuit, en rendait **6 sur 225** — soit 2,7 %.

Vingt fois plus, d'un coup, sur du code du même dépôt. Ce chiffre-là ne se croit
pas : il s'explique ou on jette la mesure.

### L'explication, et elle était à deux commandes

L'atelier — un `git worktree --detach` — avait été monté sur `HEAD` **avant**
qu'un autre auteur ne pousse ce commit :

    fb317b1  Sous Node 24+, le localStorage natif coupait 18 fichiers de test
             avant le premier test

Son correctif vit dans `vitest.config.ts`. Mesuré :

    atelier   grep -c localStorage vitest.config.ts  →  0
    main      grep -c localStorage vitest.config.ts  →  3

Dix-huit fichiers de banc ne s'exécutaient donc PAS dans l'atelier. Toute mutation
couverte uniquement par eux survivait — et la loupe l'imprimait « SANS TEST »,
avec le même aplomb que pour une vraie nudité. Les désignations portaient
d'ailleurs presque toutes sur `dashboard/src/views/Cerveau.tsx`, une vue dont les
bancs touchent le DOM : exactement la famille que ces 18 fichiers couvrent.

### Ce que ça dit de l'outil

La loupe ne mesure pas la couverture. Elle mesure **ce que la suite qu'on lui
donne fait quand on abîme le code**. Un harnais amputé lui fait rendre des
verdicts faux dans le sens le plus coûteux qui soit : elle DÉSIGNE du code
correctement défendu, et l'on va écrire des bancs qui ne servent à rien.

C'est le miroir du § 9 quadragies. Là, une mutation cassait le harnais et la
machine s'écroulait — bruyant, donc trouvé en onze minutes. Ici, le harnais était
déjà cassé AVANT la première mutation, et rien ne le disait : la suite passait,
les mutants survivaient, tout avait l'air normal.

> Un atelier détaché fige le CODE **et** le HARNAIS. Le second est celui qu'on
> oublie, parce qu'on croit n'avoir épinglé qu'une base de diff.

### Le geste

Avant de lancer un balayage dans un atelier, vérifier que sa tête est celle
d'aujourd'hui — pas celle d'il y a deux heures :

```sh
git -C "$ATELIER" log --oneline -1     # la même que `main` ?
git fetch origin main && git log --oneline -1 origin/main
```

Et le contrôle qui aurait tout évité, en une ligne : **compter les fichiers que
la suite joue dans l'atelier, et le comparer au compte de l'arbre principal.** Un
écart de dix-huit fichiers se voit immédiatement ; une nudité de plus, non.

### Le signal qui doit alerter, et il est gratuit

Le rendement d'un balayage est stable sur un dépôt donné : quelques pour cent sur
du code mûr. **Un taux qui décuple n'est pas une bonne nouvelle, c'est un
symptôme.** Le réflexe juste n'est pas de se réjouir d'avoir trouvé un filon,
c'est de se demander ce qui a changé dans l'instrument — parce que le code, lui,
n'a pas pu se dégrader de vingt fois en une nuit.

J'ai failli passer la nuit à écrire cinquante-cinq gardes inutiles. Ce qui m'a
arrêté n'est pas une inspection minutieuse : c'est un CHIFFRE qui ne ressemblait
à rien de connu.

### CORRECTION — la thèse ci-dessus était FAUSSE, et voici la mesure

Tout ce qui précède décrit un vrai défaut : l'atelier faisait bien tourner un
harnais amputé, et il fallait le réparer. **Mais ce n'était pas la cause du taux
de nudités**, et je l'ai écrit comme si ça l'était.

Le balayage relancé sur l'atelier CORRIGÉ rend le même taux : 34 nudités sur 63
mutants joués. La réparation n'a rien changé au chiffre.

Ce que la répartition disait, et que je n'avais pas regardée :

    32 nudités sur 34  →  dashboard/src/views/Cerveau.tsx
    NodesPanel, GardeFous, App, StatTiles  →  majoritairement DÉFENDUS

Le harnais marchait donc. Vérifié pour de bon dans l'arbre PRINCIPAL, où il n'y a
aucun doute sur la configuration :

    if (mode !== 'graphe') return;   muté en ===
    → suite ENTIÈRE verte : 247 fichiers, 3 629 tests

`Cerveau.tsx` est réellement nu. C'est une vue à canevas — force dirigée,
`requestAnimationFrame`, `devicePixelRatio`, glisser au pointeur — dont happy-dom
ne peut pas jouer l'essentiel.

### La faute de raisonnement, qui est la vraie leçon

Je venais de trouver un défaut RÉEL — le harnais périmé — et il expliquait le
symptôme de façon élégante. J'ai arrêté de mesurer là.

> **Une cause plausible trouvée juste après un vrai défaut est la forme la plus
> séduisante de l'erreur.** Le défaut est réel, l'explication est cohérente,
> l'enchaînement est satisfaisant — et rien de tout cela ne la rend vraie.

Le contrôle qui manquait tient en une commande, et il était à portée : REGARDER
LA RÉPARTITION des nudités avant d'en expliquer le nombre. Trente-deux sur
trente-quatre dans un seul fichier ne dit pas « le harnais est cassé », ça dit
« ce fichier-là n'est pas testé ». Les deux hypothèses prédisent un taux élevé ;
une seule prédit qu'il se concentre.

Et le second contrôle, celui qui tranche : rejouer UNE désignation dans l'arbre
principal, où la configuration est certaine. Trois minutes. Je les ai payées
après avoir écrit la leçon plutôt qu'avant.

### Ce qui reste vrai, et ce qui est corrigé

- **Vrai** : un atelier détaché fige le code ET le harnais ; le contrôle de tête
  d'atelier reste nécessaire, et il a trouvé un défaut réel.
- **Vrai** : un taux qui décuple est un symptôme qu'il faut expliquer.
- **FAUX** : que ce symptôme-ci venait du harnais. Il venait du code.
- **Ajouté** : expliquer un NOMBRE sans regarder sa RÉPARTITION, c'est deviner
  avec des chiffres à l'appui.

## 9 quinquadragies. Une mesure dont on jette la sortie n'est pas une mesure

Deux fois dans la même nuit, la barrière a rendu `CODE_SUITE=1`. Deux fois, je
n'ai pas su dire QUEL banc avait rougi. La raison est la même les deux fois, et
elle est écrite dans ma propre commande :

```sh
npm test -- --reporter=json --outputFile.json=rapport.json > /dev/null 2>&1
echo "CODE_SUITE=$?"
```

Le code de sortie survit. Le NOM du test, non.

### Pourquoi ce geste est si tentant

La sortie de vitest fait des centaines de lignes, et les tours de chantier
s'enchaînent. Rediriger vers `/dev/null` garde l'écran lisible, et l'on se dit
que le code de sortie suffit — il suffit, en effet, pour DÉCIDER de ne pas
livrer. Il ne suffit pas pour COMPRENDRE, et c'est précisément quand il vaut 1
qu'on a besoin de comprendre.

Au rejeu, la suite était verte. Un intermittent, donc — et le § 9 novievicies
interdit de réparer un intermittent qu'on n'a pas vu se reproduire. Sauf qu'ici
je ne peux même pas le RECONNAÎTRE s'il revient : je n'ai jamais eu son nom.

> Une sortie jetée ne se rattrape pas. Le rejeu ne rejoue pas le même
> ordonnancement, la même charge, le même instant — c'est justement ce qui fait
> l'intermittent. La seule occasion de le nommer était la première.

### La règle

> Toute mesure qui peut rougir écrit sa sortie dans un FICHIER. On y dirige le
> flux, on lit le code de sortie, et on ne lit le fichier que si le code n'est
> pas 0. L'écran reste propre sans qu'on perde la trace.

```sh
npm test … > "$JOURNAL" 2>&1
echo "CODE_SUITE=$?"      # décider
grep -E "FAIL|AssertionError" "$JOURNAL" | head   # comprendre, si besoin
```

C'est ce que je fais pour les mutations depuis le début de la nuit — chaque
verdict rouge y est capturé et cité. La barrière, elle, était restée au
`/dev/null`, parce qu'elle est censée être verte. **Les mesures qu'on croit
verdoyantes sont celles qu'on instrumente le moins, et ce sont donc celles dont
on ne sait rien le jour où elles ne le sont pas.**

### Ce que ça coûte, concrètement

Deux rouges cette nuit, deux intermittents non identifiés, zéro information
gagnée. S'ils sont le même, je l'ignore. S'ils reviennent en CI sur une machine
de quelqu'un d'autre, je n'aurai rien à lui dire — et un intermittent qu'on ne
sait pas nommer finit par se faire relancer plutôt que lire, ce qui est la
première marche vers une suite qu'on ne croit plus.

## 9 sexquadragies. Un test écrit contre le MÉCANISME meurt avec lui ; écrit contre la GARANTIE, il survit

En sortant les étiquettes du graphe du Cerveau (`etiquettesPosees`), j'ai porté
la garde d'origine telle quelle :

```ts
if (heurte && !estActif) continue; // « le nœud actif passe TOUJOURS »
```

Neuf mutations sur les règles voisines ont rougi. Celle-ci, non : ôter
l'exception (`if (heurte) continue;`) laissait le banc VERT.

### Pourquoi elle ne pouvait pas rougir

Deux lignes plus haut, `ordreDePose` place la note active **en tête**. Elle est
donc posée la première, quand `posees` est encore vide — `heurte` y vaut
toujours `false`. La seconde condition n'est jamais consultée.

C'est le § 9 unquadragies (« qui peut encore l'atteindre ? ») dont la réponse est
« personne », et dont la cause n'est pas un appelant extérieur mais **une étape
antérieure de la même fonction**. Le tri ne se contentait pas de trier : il
tenait déjà, seul, la promesse que la garde prétendait tenir.

Et le commentaire aggravait le cas. « Le nœud actif passe TOUJOURS » désignait la
mauvaise ligne : un lecteur en concluait que l'ordre de pose est indifférent,
alors qu'il est la SEULE chose qui protège ce nom-là. Une garde morte ne se
contente pas d'être inutile — elle déplace l'attention loin du vrai gardien.

### Ce que j'ai failli écrire

Mon premier banc disait :

```ts
it('la note ACTIVE passe MÊME en recouvrant une déjà posée', …)
```

Un titre qui décrit le CHEMIN. Il passait aussi bien avec la garde qu'après son
retrait — non pas parce qu'il était robuste, mais parce qu'il n'avait jamais
éprouvé ce qu'il annonçait. Un test qui nomme un mécanisme et n'en dépend pas est
du décor à retardement : le jour où le mécanisme part, il reste vert et laisse
croire qu'il veille encore.

Réécrit contre la garantie — « la note ACTIVE garde son nom face à une note qui
la recouvre » — il ne dit plus PAR QUEL CHEMIN elle le garde. Vérifié par
mutation, l'exception ôtée : casser le tri (`a.id === actif` → `!==`) le fait
rougir. Il défend donc la promesse par le seul mécanisme qui reste, et aurait
défendu l'autre s'il avait été le seul.

### La règle

> Avant de porter une garde d'un endroit à un autre, demander ce qui la rend
> vraie — pas si elle est juste. Si une étape antérieure la garantit déjà, la
> garde est morte : on la retire, et on écrit la **promesse** dans le titre du
> banc, jamais le chemin qui la réalise. Un banc nommé d'après un mécanisme ne
> protège que ce mécanisme ; nommé d'après la garantie, il protège l'utilisateur
> — et reste debout quand l'implémentation change sous lui.

Corollaire pour l'extraction (§ 2 quaterdecies) : sortir une décision du canevas
ne consiste pas à déménager les lignes. La mutation, appliquée à la version
SORTIE, dit ce que le canevas cachait — ici, qu'une des trois règles n'en était
pas une.

## 9 septquadragies. Un banc qui promet de ne pas toucher au réseau doit le PROUVER, sinon un tiers fixe sa durée

`github-parcours.test.ts` monte un faux GitHub local. Son en-tête l'annonce
sans détour :

> Un vrai jeton GitHub ne peut pas vivre dans une suite de tests, et **dépendre
> du réseau rendrait la CI rouge un jour sur dix pour des raisons qui ne nous
> regardent pas**.

La promesse était tenue pour l'API. Elle ne l'était pas pour le CLONE : le faux
GitHub servait une `clone_url` vers le vrai `github.com`, et
`GET /api/projects/:id/rayon` rafraîchit le miroir, qui clone pour de bon. Un
seul test faisait donc sortir un `git clone` de la machine, vers un dépôt qui
n'existe pas.

### Pourquoi personne ne l'a vu pendant des semaines

Sous Linux, ce clone échoue en un souffle : 1,3 s pour le fichier entier. La
promesse paraissait tenue parce que la punition était invisible. Sur la CI
Windows du 12 août, le même clone a dépassé les 20 000 ms du délai — et fait
rougir une pull request qui ne touchait pas à cette ligne.

Le coût réel n'est pas le rouge. C'est le DIAGNOSTIC : devant un échec dans un
fichier étranger à son diff, on soupçonne d'abord un intermittent, puis la
machine, puis on relance. Trois raisonnements faux avant le bon, et une leçon
(§ 9 novievicies, « ne pas réparer un intermittent avant de le voir se
reproduire ») qui pousse justement à attendre — alors qu'ici la cause était
LISIBLE, pas aléatoire.

### Le signe qui distingue les deux

Un intermittent varie sans raison qu'on puisse nommer. Ici la durée avait une
cause nommable : **elle dépendait de la vitesse à laquelle un tiers dit non**.
Ce n'est pas de la lenteur, c'est une mesure qui porte sur autre chose que ce
qu'on croit mesurer.

> **Le réflexe** — devant un banc qui expire sur une machine et pas sur une
> autre, ne pas chercher « qu'est-ce qui est lent ? » mais **« qui, en dehors de
> cette machine, a le droit de fixer cette durée ? »**. Un DNS, un TLS, un dépôt
> distant, une invite d'identifiants : chacun est un tiers qui décide quand le
> test finit.

### La promesse doit avoir un banc, sinon elle vieillit

Une promesse écrite en commentaire ne se défend pas toute seule : celle-ci a
survécu des mois à sa propre violation. Elle porte désormais une assertion —
« AUCUN CLONE NE SORT DE LA MACHINE » — qui éprouve les DEUX portes par
lesquelles une URL sort (la fiche d'un dépôt, et la liste entière), et qui
rougit dès qu'on ramène la `clone_url` vers `github.com` (VERDICT :
`expected 'https://github.com/micka/import-cree-…' to be
'https://127.0.0.1:42131/micka/…'`).

### Et la garde que j'ai failli laisser

Mon premier correctif ajoutait un branchement répondant 404 aux chemins de git
AVANT le contrôle du jeton, pour qu'un 401 ne puisse pas réveiller Git
Credential Manager. Muté (`return false`), les treize cas restaient VERTS : la
branche était morte. La raison est en amont — l'URL est en `https:` et ce
serveur ne parle que HTTP en clair, donc git échoue à la poignée de main et
n'émet jamais de requête. Retirée, avec la mesure en commentaire.

> C'est le § 9 sexquadragies appliqué à sa propre écriture, une heure après
> l'avoir écrit. Une garde ajoutée « au cas où » dans le même geste que le
> correctif n'est pas plus dispensée de mesure qu'une autre — et c'est même là
> qu'elle est le plus facile à laisser passer, parce qu'on croit savoir
> pourquoi on l'a mise.

## 9 octoquadragies. Un banc qui parie sur l'heure perd ce pari, et le jour où il le perd n'est pas le vôtre

`chantier-execution.test.ts` éprouve qu'un nœud hors heures de service refuse un
chantier. Pour être hors service, il posait la fenêtre à `00:00-00:01`, et son
commentaire assumait le risque :

> quelle que soit l'heure à laquelle cette suite tourne, on est hors service
> (sauf une minute par jour, et c'est pourquoi la minute retenue est celle qui
> suit minuit UTC — la plus improbable pour une CI, **et le test le dit plutôt
> que de faire semblant d'être déterministe**).

L'honnêteté était réelle, et elle a coûté quand même. Dans la nuit du 12 au
13 août, une CI a démarré à 23:59:59 : macOS **et** Windows ont rougi ensemble
sur cette minute-là, dans une pull request qui ne touchait à rien de tout cela.

### Ce que coûte un pari assumé

Le rouge n'est pas le vrai prix. Le vrai prix est que **le pari se paie chez
quelqu'un d'autre** : celui qui pousse à 23:59 hérite d'un échec dans un fichier
étranger à son diff, et doit refaire tout le raisonnement — intermittent ?
machine ? mon changement ? — avant de retomber sur un commentaire qui, au fond,
lui dit « pas de chance ».

Assumer un pari dans un commentaire ne le rend pas moins coûteux. Ça le rend
seulement plus difficile à reprocher.

### La troisième voie, celle qu'on n'avait pas cherchée

Le débat était posé comme un choix entre deux options : parier sur une heure
improbable, ou faire semblant d'être déterministe (figer l'horloge, simuler).
Il y en avait une troisième, ni l'une ni l'autre : **calculer une prémisse qui
ne peut pas être fausse**.

La fenêtre est désormais dérivée de l'heure courante — trente minutes plus tard,
une minute de large. Rien n'est simulé : l'horloge reste la vraie, le nœud
consulte la vraie règle. Simplement, la prémisse est vraie par CONSTRUCTION
plutôt que par probabilité.

Et elle est **mesurée**, pas raisonnée : rejouée sur les 1 440 minutes de la
journée contre la vraie `isOnShift`, la fenêtre calculée rend « hors service »
1 440 fois sur 1 440.

La prémisse est enfin ÉNONCÉE dans le banc, avec la fonction que le nœud
consulte lui-même :

```ts
expect(isOnShift(nightShiftFromEnv({ HIVE_SHIFT: fenetre }), maintenant)).toBe(false);
```

Le jour où elle cesserait d'être vraie, le banc dit « prémisse » au lieu
d'échouer trois assertions plus loin sur une cause qui n'a rien à voir.

### Ce qui reste éprouvé

Le risque d'une prémisse plus confortable est d'amollir ce qu'on mesure. Vérifié
par mutation : le refus ôté du nœud (`if (true) return null;` dans
`node-client/client.ts`), le banc rougit — `expected true to be false`. Le même
rouge qu'avant, mais qui dit maintenant « la garde a sauté » et non « il est
minuit ».

### La règle

> Un banc ne doit jamais dépendre de QUAND il tourne. Devant une prémisse
> temporelle, ne pas choisir entre parier et simuler : chercher la valeur qui
> rend la prémisse vraie sur les vingt-quatre heures, la DÉRIVER de l'horloge
> plutôt que la deviner, et l'énoncer en assertion pour qu'elle se dénonce
> elle-même si elle tombe.

C'est le § 9 septquadragies, écrit deux heures plus tôt, sur un autre tiers :
là, la durée était fixée par un réseau ; ici, le verdict est fixé par l'horloge.
Même question à se poser — **qui, en dehors de ce banc, a le droit de décider
de son issue ?**

## 9 novemquadragies. La loupe mute aussi le texte des messages, et ces candidates-là ne prouvent rien

Le balayage du cœur a rendu, parmi ses désignations :

```
🔴 SANS TEST · src/orchestrator/github.ts · > → >=
   'Un identifiant de workflow est un entier > 0 — jamais un nom de fichier.'
```

Le `>` muté est celui d'une PHRASE, dans une chaîne de caractères. Aucun test
n'affirme ce libellé au mot près — la loupe le compte donc « sans test », et
elle a raison au sens strict : la ligne a changé, la suite est restée verte.

Mais ce n'est pas une NUDITÉ. Une nudité désigne une décision que rien ne
défend ; ici il n'y a pas de décision, seulement du texte d'aide. La loupe
dépense un lancement de suite complet — trente à soixante secondes — pour une
candidate qui ne peut rien apprendre, et pose dans son rapport une ligne rouge
que le prochain lecteur devra écarter à la main.

### Pourquoi ce n'est pas anodin sur un balayage élargi

Un balayage du cœur pèse 304 candidates. Chaque fausse candidate coûte une
minute de machine ET une décision humaine — et les décisions humaines à écarter
sont exactement ce qui fait qu'un rapport long finit par être lu en diagonale.
C'est le mécanisme par lequel un outil de mesure devient décoratif : non pas en
mentant, mais en noyant.

### Ce qui distingue les deux, et pourquoi c'est réparable

La loupe travaille sur les LIGNES AJOUTÉES du diff, en texte brut. Elle sait
déjà écarter les commentaires (`^\s*(//|\*|/\*)`), et pour la même raison : ce
qui ne s'exécute pas ne se mute pas utilement. Le contenu d'une chaîne est le
même cas — il s'exécute au sens où il s'affiche, mais aucun opérateur n'y
DÉCIDE de rien.

> **La règle** — avant d'ajouter une famille de mutations à un outil, se
> demander non pas « cette mutation change-t-elle la ligne ? » mais **« cette
> mutation change-t-elle une DÉCISION ? »**. Un opérateur dans un littéral de
> chaîne, une valeur dans un message, un nombre dans une phrase d'aide : la
> ligne change, le comportement non — et le verdict « sans test » y est
> techniquement juste et pratiquement faux.

Noté ici plutôt que corrigé dans l'instrument : écarter les chaînes demande de
savoir où elles commencent et finissent, donc un analyseur, et l'en-tête de la
loupe explique pourquoi elle s'en passe (une mutation qui casse la syntaxe fait
échouer toute la suite, et le mutant passerait pour tué — la loupe mentirait
dans le sens rassurant, le pire des deux). Un découpage naïf sur les guillemets
tomberait sur les apostrophes françaises, dont ce dépôt est plein. La bonne
version de ce correctif est un lot à part entière ; en attendant, ces
candidates se reconnaissent à l'œil et se consignent ici.

## 9 quinquagies. Un banc qui vérifie le CONTENU d'une liste ne dit rien de son ORDRE — et l'ordre est souvent le sens

Le balayage du cœur a rendu trois désignations de la même forme, dans deux
fichiers, toutes trois nues :

```
src/shared/cerveau.ts        · || → &&  b.recurrences - a.recurrences || a.signature.localeCompare(…)
src/shared/cerveau-graphe.ts · || → &&  a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers)   (aretes)
src/shared/cerveau-graphe.ts · || → &&  a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers)   (liensMorts)
```

### Ce que fait vraiment ce mutant

`A || B` muté en `&&` **ne dégrade pas** le tri : il en change la CLÉ. Quand `A`
départage — donc chaque fois qu'il sert — `A && B` rend `B`. Le critère
principal cesse purement d'exister, et c'est le départage, prévu pour les
égalités, qui gouverne tout le classement.

Concrètement : `aConsolider` ne sort plus les propositions par récurrence
décroissante mais par ordre alphabétique d'une signature opaque. La ruche promet
qu'« une panne revue trois fois propose une leçon » ; devant dix propositions,
celle survenue cinquante fois n'est plus la première. La liste reste JUSTE — tout
y est, rien n'est inventé — et devient inutile.

### Pourquoi aucune suite ne pouvait le voir

Les bancs de `aConsolider` ne construisaient jamais qu'UN seul paquet. `[0]` y
était trivialement le seul élément : l'ordre n'était éprouvé nulle part, et il
suffisait de deux paquets pour que le mutant tombe. Ceux du graphe vérifiaient
le CONTENU d'`aretes` (les bonnes arêtes, en bon nombre) sans jamais regarder
dans quel ordre elles sortaient.

C'est un angle mort structurel, pas un oubli local : `toEqual` sur un tableau
compare l'ordre, mais seulement si le cas de test comporte assez d'éléments pour
qu'un ordre existe. Un banc à un élément, ou qui teste par `toContain` / par
longueur, passe indifféremment sur toutes les permutations.

### La règle

> Devant une fonction qui TRIE, se demander non pas « rend-elle les bons
> éléments ? » mais **« un banc verrait-il la différence si je permutais le
> résultat ? »**. S'il faut deux éléments distincts pour que la question ait un
> sens, alors un banc à un élément ne mesure rien du tri — et un comparateur non
> éprouvé est le lieu le plus discret où une liste peut cesser de vouloir dire
> quelque chose.

Corollaire pratique : un banc d'ordre se construit avec des éléments dont les
deux critères S'OPPOSENT. Ici, « zebre » revient cinq fois et « alpha » trois :
par récurrence c'est zebre d'abord, par alphabet ce serait alpha. Un jeu où les
deux critères concordent laisse passer le mutant sans rien dire.

VERDICTS (bancs ciblés, restauration par copie entre chaque)

```
aConsolider || → &&   ROUGE (3) la tête doit être la plus récurrente: expected 3 to be 5
aretes      || → &&   ROUGE (2) ['c→a','a→z'] ≠ ['a→z','c→a']
liensMorts  || → &&   ROUGE (1) ['c→fantome-a','a→fantome-z'] ≠ ['a→fantome-z','c→fantome-a']
```

## 9 unquinquagies. Un test qui refuse « bien au-delà » de la borne ne dit rien de la borne

`chantier.ts` borne la longueur d'un nom de script à `NOM_MAX`. Le banc qui
l'éprouvait :

```ts
it('un nom démesuré est refusé', () => {
  const long = 'a'.repeat(200); // NOM_MAX vaut 100
  expect(jugerChantier({ [long]: 'x' }, long).ok).toBe(false);
});
```

Deux cents contre cent : le cas passe si loin de la borne qu'il ne la touche
jamais. `> NOM_MAX` muté en `>= NOM_MAX` reste vert, et un nom de cent
caractères — licite — se fait refuser sans que rien ne proteste.

### Le réflexe qui produit ce trou

On écrit le test qui montre que la garde REFUSE, parce que c'est le danger qu'on
avait en tête en l'écrivant. Le cas qu'on n'écrit pas est celui qui montre ce
qu'elle LAISSE PASSER — or une borne est une promesse dans les deux sens :
« jusqu'ici, oui ; au-delà, non ». Un banc qui n'éprouve qu'un seul des deux
côtés laisse la borne libre de glisser d'un cran.

C'est la deuxième fois dans ce dépôt (voir la borne acceptée d'`isModeleList`),
et la répétition dit que ce n'est pas une distraction : c'est le pli naturel de
l'écriture.

> **La règle** — devant une garde de borne, écrire DEUX cas et un seul jeu de
> valeurs : `borne` doit passer, `borne + 1` doit être refusé. Un jeu d'essai
> éloigné de la borne (« 200 pour une limite à 100 ») ne mesure pas la limite,
> il mesure qu'il existe une limite quelque part.

### Troisième occurrence, une heure plus tard

Cette leçon a resservi dans l'heure. `estRefPlausible` (`workflow.ts`) borne une
référence git à 255 caractères ; ses deux gardes étaient nues, et le banc qui
prétendait les couvrir énumérait onze références refusées — dont la chaîne vide
— sans **aucun** cas de longueur.

Le détail vaut d'être noté, parce qu'il montre comment un banc peut couvrir la
bonne intention et rater la garde : muter `||` en `&&` ne change rien pour `''`,
puisque la ligne SUIVANTE (`/^[A-Za-z0-9._/-]+$/`, motif à `+`) refuse déjà une
chaîne vide. Le mutant survit là où personne ne regardait — sur la longueur — et
une référence de trois cents caractères passe jusqu'au dispatch.

> **Corollaire** — quand plusieurs gardes se suivent, un cas d'essai peut être
> attrapé par la MAUVAISE. Il verdit, et la garde qu'on croyait éprouver reste
> nue. Le seul moyen de le savoir est de muter CELLE-LÀ et de regarder si le
> rouge vient.

### Le cas plus grave : une borne tenue à PLUSIEURS portes

Ici la même borne vit à trois endroits — `nomDeChantierValide` (est-ce un nom
utilisable ?), `chantiersDe` (que propose-t-on ?), `jugerChantier` (que
lance-t-on ?). Le balayage en a trouvé deux nues sur trois.

La propriété vraie n'est pas « chacune refuse les noms trop longs ». C'est
**« elles refusent les MÊMES »**. Une dérive d'un seul caractère entre deux
d'entre elles produit un défaut qu'aucune ne contient : un chantier apparaît à
l'écran et se fait refuser au clic — ou, pire, il est jugé lançable sans avoir
jamais été proposé, donc atteignable seulement par une requête forgée.

Le banc éprouve donc les trois ENSEMBLE, sur une fenêtre autour de la borne, et
son assertion est l'ACCORD, pas la valeur. C'est ce qui rend son rouge
descriptif : chaque mutation dit laquelle des trois portes a bougé.

```
jugerChantier        > → >=   [true, true, false]  ← valide, proposé… refusé au lancement
chantiersDe         <= → <    [true, false, true]  ← valide, lançable… jamais proposé
nomDeChantierValide <= → <    [false, true, true]  ← proposé, lançable… déclaré invalide
```

## 9 duoquinquagies. Un banc qui FABRIQUE l'état final saute l'étape qui le calcule

`workflow.ts` traduit l'état que GitHub donne (`active`, `disabled_manually`,
`disabled_inactivity`) en un état de la ruche, et cet état décide du MOTIF qu'un
humain lit quand un workflow refuse de partir. Les trois correspondances étaient
nues, et la branche du motif aussi.

Deux bancs existaient pourtant, et chacun ratait la garde pour une raison
différente — les deux valent d'être nommées.

### Le banc qui vérifie qu'on lève, sans regarder pourquoi

```ts
it('un workflow désactivé n’est pas lancé', async () => {
  const { f, appels } = faux([{ corps: { workflows: [brut({ state: 'disabled_manually' })] } }]);
  await expect(lancerWorkflow(…)).rejects.toThrow(ErreurGithub);
  expect(appels).toHaveLength(1);
});
```

Il fait bien passer `disabled_manually` par la lecture. Mais il n'affirme QUE le
refus — pas l'état lu, pas le motif rendu. Or toutes les correspondances mènent
au refus : le banc verdit quelle que soit celle qui a servi.

### Le banc qui se fabrique la réponse

```ts
const v = jugerWorkflow([wf({ etat: 'desactive_inactivite' })], 161_335);
expect(v.motif).toMatch(/inactivité/);
```

Celui-ci regarde bien le motif — mais il POSE l'état lui-même, `etat` déjà
traduit. La fonction qui traduit n'est jamais appelée. Le banc éprouve la moitié
aval d'une chaîne dont la moitié amont est justement celle qui était nue.

> **La règle** — quand un banc construit son entrée avec la valeur que
> produirait l'étape d'avant, il a sauté cette étape. Se demander devant chaque
> montage : **« cette valeur, qui la calcule en vrai ? »** Si la réponse est
> « une fonction du dépôt », le banc doit partir de CE QU'ELLE REÇOIT, pas de ce
> qu'elle rend.

### Ce que le défaut coûtait

Rien de visible, et c'est le pire. La docstring du module dit pourquoi ces états
existent : « refuser LOCALEMENT vaut mieux qu'un 403 dont personne ne déduira :
ce workflow est désactivé depuis six mois pour inactivité ». Une correspondance
inversée ne casse aucun écran — elle fait dire à la ruche « quelqu'un l'a
désactivé à la main » d'un workflow que GitHub a éteint tout seul. L'humain part
chercher un coupable qui n'existe pas, et la ruche a l'air sûre d'elle.

VERDICTS (banc ciblé, restauration par copie entre chaque)

```
etatDe 'à la main'   === → !==   ROUGE (2) expected 'inconnu' to be 'desactive_a_la_main'
etatDe 'inactivité'  === → !==   ROUGE (2) expected 'inconnu' to be 'desactive_inactivite'
etatDe 'actif'       === → !==   ROUGE (5) workflow refusé (le lancement casse)
le MOTIF à l'humain  === → !==   ROUGE (2) « … GitHub le rapporte dans un état
                                            que la ruche ne connaît pas » au lieu
                                            de « à la main »
```

## 9 triquinquagies. On éprouve ce qu'on CRAINT, jamais ce qu'on PROMET — et la garde nominale reste nue

Deux gardes `typeof` de `workflow.ts` sont restées nues alors que des bancs les
entouraient. La cause est la même pour les deux, et elle n'a rien d'un oubli :
les bancs n'éprouvaient que les entrées MALFORMÉES.

```ts
function msDe(v: unknown): number {
  if (typeof v !== 'string') return 0;      // ← nue
  …
}
chemin: champSurUneLigne(typeof o.path === 'string' ? o.path : '', MAX)  // ← nue
```

Le banc voisin s'appelle « une date illisible ne devient pas NaN » et passe
`'jamais'`. Muter `!==` en `===` rend 0 **dans les deux sens** pour cette entrée :
le cas ne peut pas mordre. Il éprouve le repli, pas la garde.

Le tri « le plus récent d'abord » utilise pourtant de vraies dates — mais il
n'affirme que l'ORDRE. Quand toutes les dates deviennent 0 ensemble, l'ordre
peut survivre par le départage, et le banc reste vert.

### Le pli qui produit ça

Devant une frontière de données tierces, on écrit d'instinct les cas hostiles :
le `null`, l'objet inattendu, la date illisible, l'injection. C'est le danger
qu'on avait en tête. Le cas qu'on n'écrit pas est le plus ordinaire — **la
valeur normale traverse-t-elle intacte ?** — parce qu'il paraît acquis.

Or une garde `typeof` inversée ne casse rien de visible : elle VIDE le champ.
Un chemin de workflow devient `''`, une date devient `0`, et l'écran affiche
sereinement du vide là où il y avait une information. Personne ne signale un
champ vide ; on suppose que GitHub ne l'a pas rempli.

> **La règle** — pour toute garde de forme (`typeof`, `Array.isArray`, un
> schéma), écrire DEUX cas : l'entrée malformée retombe sur le repli, ET
> l'entrée normale ressort **inchangée**. Le second est celui qui manque
> toujours, et c'est lui qui tient la garde : le premier ne fait souvent que
> reprendre le chemin du repli par un autre bout.

C'est la même famille que le § 9 unquinquagies (une borne dont seul le côté
refusé est éprouvé) : dans les deux cas, la moitié testée est celle qui dit
NON, et la moitié nue est celle qui dit OUI. Une garde promet les deux.

VERDICTS (banc ciblé, restauration par copie entre chaque)

```
msDe   typeof !== → ===   ROUGE (1) expected +0 to be 1785319200000
chemin typeof === → !==   ROUGE (2) expected '' to be '.github/workflows/nuit.yml'
```

## 9 quadraquinquagies. Un banc de canal temporel ne peut pas être déterministe — mais il peut cesser d'être un pari

`billet-motifs.test.ts` vérifie que le temps de réponse ne trahit pas
l'existence d'un billet. Il chronométrait UN appel par chemin et comparait le
rapport à 4. Son commentaire assumait déjà le risque :

> La borne est volontairement LARGE (facteur 4) : une CI partagée est bruyante,
> et un test qui rougit au hasard finit désactivé — ce qui vaut moins que pas de
> test du tout.

La borne était large ; le pari est resté. Il a perdu sur une CI chargée :
« inconnu 129,1 ms · mauvais 14,3 ms », rapport 9. Un coup d'ordonnanceur, pas
une fuite.

### La différence avec les deux autres pièges de la même famille

Pour la fenêtre de service (§ 9 octoquadragies) et pour le clone réseau
(§ 9 septquadragies), il existait une troisième voie : rendre la prémisse vraie
PAR CONSTRUCTION. Ici, non — le temps d'exécution est statistique par nature, et
prétendre le rendre déterministe serait un faux-semblant.

Ce qui reste possible n'est pas de supprimer le pari, mais de le **réduire au
point qu'il ne décide plus** : plusieurs tours, et la MÉDIANE, qu'un pic unique
ne déplace pas.

Deux détails font la moitié du travail :

- **entrelacer les tours.** Mesurer cinq inconnus puis cinq mauvais ferait
  porter une période de lenteur sur un seul groupe — donc fabriquerait l'écart
  qu'on cherche à réfuter ;
- **montrer TOUTES les mesures dans le message d'échec.** Une médiane seule ne
  dit pas si l'on regarde une fuite ou un accident. Les cinq valeurs le disent
  d'un coup d'œil.

### Ce qu'il faut vérifier après avoir rendu un banc plus robuste

Le danger d'assouplir, c'est d'obtenir un banc qui ne rougit plus DU TOUT. La
robustesse ne vaut que si la garde mord encore : la fuite a donc été
réintroduite dans le serveur — renoncer avant PBKDF2 pour un billet inconnu,
c'est-à-dire exactement la version « AVANT » que la docstring décrit — et le
banc a rougi.

```
médianes sur 5 tours — inconnu 1,3 ms · mauvais 16,0 ms
inconnus [1, 1, 1, 1, 1] · mauvais [16, 17, 16, 16, 1]   rapport 12,5 > 4
```

Les cinq valeurs racontent l'histoire mieux que le rapport : un chemin coûte
1 ms cinq fois de suite, l'autre 16. Ça, aucun ordonnanceur ne le fabrique.

> **La règle** — quand une prémisse ne peut pas être rendue vraie par
> construction, ne pas élargir la borne : AUGMENTER LE NOMBRE DE MESURES et
> passer par une statistique robuste. Élargir la borne affaiblit la garde ;
> mesurer plus la renforce. Et vérifier ensuite, par mutation, que le banc
> assoupli rougit toujours sur le vrai défaut — sans quoi on a troqué un test
> instable contre un test décoratif.

---

## 9 quinquinquagies. Un `--dry-run` en intégration continue n'éprouve pas une installation : il s'arrête avant tout ce qui peut échouer

La CI de ce dépôt lançait `install.sh --dry-run` sur les trois systèmes, et
depuis des semaines cette ligne se lisait « l'installation en une commande
marche partout ». Elle ne le disait pas.

Le mode sec s'arrête AVANT le clone, avant `npm install`, avant l'installeur.
Ce qu'il vérifie est réel — un script qui ne démarre pas, une syntaxe refusée
par le shell de la plateforme — mais c'est la première marche. Tout ce qui
casse chez un inconnu vit APRÈS : la résolution des dépendances, le module
natif SQLite qui doit trouver un binaire prébuilt pour son ABI, la
construction du tableau de bord, la ruche qui démarre et qui écoute au bon
endroit.

### Ce que ça avait masqué exactement

Le critère 1 du definition of done — « une commande, ≤ 3 décisions, < 60 s » —
était noté MESURÉ. Il l'avait été, mais sur un dépôt DÉJÀ cloné, avec les
dépendances DÉJÀ installées : c'est-à-dire pas depuis la commande qu'un
arrivant copie du README. Deux choses différentes portaient le même nom, et le
tableau de bord des critères comptait la plus facile.

### La forme générale

Un pas de CI qui exerce une VERSION RÉDUITE de ce qu'on promet est plus
dangereux qu'un pas absent. Absent, le trou se voit ; réduit, il se lit comme
une couverture. C'est le même pli que « la CI exerçait le SCRIPT, jamais la
PHRASE qui dit comment l'appeler » (§ 9 : `| iex`) — à chaque fois, deux
artefacts cohérents avec eux-mêmes, incohérents entre eux, et rien qui
regarde l'écart.

### Ce qui remplace

`scripts/essai-installation.sh` mène l'installation à son terme et affirme
trois choses, dont la dernière ne peut pas être simulée :

1. l'installation sort en 0 ;
2. le `.env` est en `-rw-------` ;
3. la ruche RÉPOND sur `/api/pulse`.

Le troisième distingue « les fichiers sont là » de « ça marche ». Il a été
éprouvé par mutation, sur un arbre cassé exprès — `app.listen({ port:
config.port + 1 })`, la ruche qui écoute à CÔTÉ du port qu'elle annonce :

```
arbre sain    → CODE=0 · installation sortie en 0, 15 s · .env en -rw------- · répond sur :7777 après 2 s
arbre cassé   → CODE=1 · le journal dit « Dashboard : http://127.0.0.1:7778 » quand le .env dit 7777
```

> **La règle** — avant d'écrire qu'un critère est mesuré, demander SUR QUOI.
> Un pas de CI qui s'arrête au seuil ne dit rien de la pièce. Et si le pas
> complet est trop cher pour les trois systèmes, en faire tourner un et DIRE
> que les deux autres restent au seuil : une couverture partielle annoncée
> vaut mieux qu'une couverture totale supposée.

---

## 9 sexquinquagies. Tuer un processus par son PID, par son groupe, par sa session — trois façons plausibles, deux mesurées fausses

Un banc d'installation lance la ruche, l'interroge, puis doit rendre la place.
Trois versions du ménage ont été écrites. Les deux premières se lisent bien et
ne marchent pas.

**Version 1 — `kill "$RUCHE_PID"`.** Un signal au père ne descend pas
(§ 9 quadragies). `npm run ruche` lance `node scripts/ruche.mjs`, qui lance
tsx, qui lance esbuild : tuer le premier laisse les autres tenir le port. Une
ruche a survécu et fait rougir `installeur-porte.test.ts` — un banc qui a
besoin de POUVOIR occuper 7777 pour simuler l'occupation. Le symptôme est
apparu dans un fichier qui n'a aucun rapport avec l'installation.

**Version 2 — `setsid` puis `kill -- -$!`.** Élégant sur le papier : le
lanceur devient chef de session, son PID EST l'identifiant du groupe, un seul
signal atteint toute la descendance. Sans effet en pratique ; mesuré, le port
était encore tenu vingt secondes après. La théorie était juste, la
correspondance entre `$!` et le groupe réellement créé ne l'était pas.

**Version 3 — viser le `cwd`.** Tout ce qui travaille dans notre dossier
d'essai nous appartient. `/proc/PID/cwd` ne ment pas, et il survit aux ré-exec
successifs de npm → node → tsx. C'est la seule chose qu'on connaisse avec
certitude, alors c'est sur elle qu'on tire.

### Le vrai enseignement n'est pas le `cwd`

C'est le pas qui manquait aux trois : **attendre que le port soit rendu, et le
dire s'il ne l'est pas.** Sans cette attente, une fuite reste muette et
empoisonne la course suivante — et le rouge apparaît ailleurs, plus tard, dans
un banc innocent. Les deux premières versions ne sont pas tombées parce
qu'elles étaient fausses ; elles sont tombées parce que rien ne vérifiait
qu'elles avaient marché.

Détail qui compte : la sonde d'attente est un `curl` SANS `-f`. On demande
« quelqu'un décroche-t-il ? », pas « répond-il bien ? ». Un 401 sans jeton
prouve que le port est TENU ; le prendre pour un échec ferait sortir de la
boucle en croyant la place libre — soit exactement le silence qu'on cherchait
à supprimer.

> **La règle** — un nettoyage n'est pas fait parce qu'on a envoyé le signal.
> Il est fait quand on a VÉRIFIÉ que la ressource est rendue. Tant que la
> vérification manque, chaque version successive du `kill` n'est qu'une
> hypothèse mieux habillée.

---

## 9 septenquinquagies. Un badge corrigé par outil redevient faux dès que l'arbre bouge

`scripts/compte-tests.mjs --corriger` avait porté les six annonces à 3 692.
Le chiffre était juste au moment où il a été écrit. Puis un banc a été retiré
— celui d'une correction elle-même annulée — et personne n'a rejoué le compte.
Les six annonces sont restées à 3 692 pendant que la suite en rendait 3 691.

C'est le contraire du piège habituel. La règle « badges JAMAIS écrits de tête »
avait été respectée : le chiffre venait bien d'une mesure. Ce qui manquait,
c'est que la mesure était PLUS VIEILLE que l'arbre qu'elle décrit.

Le pas de CI, lui, aurait rougi — il rejoue `compte-tests.mjs` sans
`--corriger` sur le rapport de la course. Le défaut aurait donc coûté un
aller-retour rouge, pas une sortie fausse. Mais l'aller-retour n'est pas
gratuit, et surtout : il apprend à pousser d'abord et à lire le rouge ensuite.

> **La règle** — le compte se re-mesure APRÈS le dernier changement de la
> branche, pas au moment où on y pense. Une correction automatique n'est pas
> un acquis : c'est un instantané, et il périme au commit suivant.

---

## 9 octoquinquagies. La loupe interrompue laisse l'arbre MUTÉ — et le mutant qu'elle avait planté était un vrai trou

Un balayage lancé avec un `timeout` a été tué au bout de dix minutes. Il
restaurait chaque mutant après l'avoir jugé ; tué entre les deux, il a laissé
le dernier en place :

```
 M scripts/essai-installation.sh
-[ -f "$CIBLE/.env" ] || { echo "✘ .env absent" >&2; exit 1; }
+[ -f "$CIBLE/.env" ] && { echo "✘ .env absent" >&2; exit 1; }
```

Le verrou `.loupe-verrou` est resté lui aussi, alors qu'aucun processus ne le
tenait — un verrou d'exclusivité posé par un procédé mortel doit être vérifié
avant d'être cru.

### Ce que la restauration doit être

Pas `git checkout` : § 9 quattuorvicies. Une copie du fichier, et rien d'autre
que ce fichier. Ici tout le reste était commis, mais le réflexe se prend quand
il ne coûte rien, pas le jour où il coûte.

### Le vrai enseignement est ailleurs

Le mutant planté par accident **ne pouvait tuer aucun cas de la suite**. Rien
ne relisait `scripts/essai-installation.sh` — c'est-à-dire que le seul
instrument du dépôt qui mène l'installation jusqu'au bout n'était lui-même
gardé par personne. Un gardien que rien ne garde a la forme exacte du défaut
qu'il existe pour attraper : s'il cessait silencieusement d'affirmer quoi que
ce soit, la CI resterait verte et dirait « l'installation marche » sans l'avoir
vérifiée — pire que si le pas n'existait pas.

`tests/essai-installation.test.ts` répond à ça : le VRAI script, lancé par
`sh`, dans un dossier où l'on plante un faux `install.sh` dont on décide le
code de sortie et le `.env`. Verdict affiché :

```
mutant `||` → `&&` sur le garde du .env  →  4 cas rouges
mutant CODE_INCONCLUANT 78 → 1           →  1 cas rouge, « 78, pas 1 »
après restauration par copie             →  9 verts
```

### Et une erreur de banc, mesurée plutôt que devinée

Première version du montage : les fichiers du faux chantier étaient écrits dans
le dossier de travail du banc, pas dans le `--dir` que le script choisit. Le
pas 3 lance `npm run ruche` DEPUIS l'installation ; il est mort sur un
`package.json` introuvable. Deuxième erreur, dans la foulée : `printf '%s'`
n'interprète pas les échappements, et une chaîne JSON y a déposé un `\n`
littéral — le port lu valait `36465\nHIVE_TOKEN`. Les heredocs entre quotes
règlent les deux.

### Ce que la règle protège vraiment : une ÉCHÉANCE, pas un accident

Cette leçon s'est longtemps lue comme une prudence contre l'imprévu — une
coupure de courant, un `Ctrl-C` malheureux, une session qui tombe. Mesuré le
13 août au soir, c'est faux, et la nuance change la force de la règle.

Un balayage ciblé sur `scripts/essai-installation.sh` a été tué par le plafond
de dix minutes de l'outil qui le lançait, au beau milieu d'une mutation. État
laissé derrière :

```
atelier :  M scripts/essai-installation.sh   ← la mutation, en place
           .loupe-verrou                     ← tenu par un pid mort
arbre principal : propre
```

Dix mutations à jouer, chacune une suite complète : le dépassement n'était pas
un risque, c'était une CERTITUDE arithmétique. Le même balayage lancé à la
racine aurait laissé une garde retournée dans l'arbre où l'on commite — et le
crochet de fin de tour aurait demandé de la commiter (§ 9 septuagies).

> **La règle de l'atelier ne protège pas d'un incident exceptionnel : elle
> protège d'un événement qui arrive À L'HEURE.** Tout instrument qui mute
> l'arbre et tourne plus longtemps qu'un plafond d'exécution SERA interrompu au
> milieu — pas « pourrait l'être ». Une règle de sûreté dont on croit qu'elle
> couvre le rare est appliquée mollement ; la même règle, sachant qu'elle
> couvre le régulier, ne se négocie plus.

Le nettoyage, lui, reste manuel et le restera : restaurer par copie dans
l'atelier, retirer le verrou. Ça ne coûte rien PARCE QUE c'est dans l'atelier.

> **La règle** — un procédé qui mute des fichiers doit être considéré comme
> laissant l'arbre sale dès qu'il ne se termine pas de lui-même : `git status`
> AVANT de croire quoi que ce soit, et le verrou d'exclusivité vérifié contre
> les processus vivants, pas contre sa seule existence. Et le mutant trouvé
> dans cet état-là se traite comme n'importe quel survivant (§ 2.16 ter) : il
> a désigné un trou réel.

---

## 9 novemquinquagies. Deux endroits décidaient du même port, et l'ordre du programme les faisait diverger

L'installeur sondait le port AVANT de lire le `.env`, et retenait le port du
`.env` pour l'écrire. Les deux gestes étaient justes séparément ; c'est leur
ordre qui mentait.

```
ligne 186  portLibre(PORT_DEFAUT)                     ← la sonde
ligne 274  existant = lireEnv(readFileSync(CHEMIN_ENV))  ← la lecture
ligne 130  garde('HIVE_PORT', String(PORT_DEFAUT))    ← ce qui sera écrit
```

Sur une PREMIÈRE installation les deux coïncident, et c'est tout ce que la
suite exerçait. Sur une réinstallation par-dessus un `.env` portant un port
personnalisé — le cas de quiconque a déjà 7777 pris par autre chose — la sonde
répondait sur une porte que la ruche n'ouvrira pas :

- **faux calme** : le port réel est tenu, la sonde dit « Port 7777 libre » et
  `hive` sort en 0. La panne se découvre au démarrage ;
- **fausse alerte** : 7777 est tenu par un tiers, la ruche irait sur 9000 sans
  gêne, et l'installeur rend `PORT_OCCUPE`. Une alerte sans objet apprend à
  ignorer les alertes.

Le rapport `--json` mentait de la même façon : `fait.port.numero` valait
`PORT_DEFAUT`, pas le port retenu — donc un script de supervision surveillait
la mauvaise porte.

### Ce que ce défaut n'était PAS

Ce n'était pas « `garde()` devrait lire l'environnement ». Une version
antérieure de ce travail avait modifié `installer-main` pour sonder
`portDepuisEnv()` : elle a introduit une divergence là où il n'y en avait pas.
`garde()` ne lit QUE le `.env` existant, délibérément — c'est ce qui rend une
réinstallation idempotente. La correction est de faire lire à la sonde la même
source que l'écriture, pas de donner une source de plus à l'écriture.

### La forme générale

Deux endroits qui décident de la même chose finissent toujours par diverger ;
ce qui décide QUAND ils divergent, c'est l'ordre des instructions — et l'ordre
ne se lit pas dans une revue, parce que les deux lignes sont à quatre-vingt-dix
lignes l'une de l'autre et que chacune est correcte.

La réparation est celle du § 2 quaterdecies : la décision sort dans une
fonction PURE (`portRetenu`), les deux appelants la lisent, et une garde
compare les deux plutôt que de recopier la règle :

```ts
const ecrit = composerReglages(existant).find((r) => r.cle === 'HIVE_PORT')?.valeur;
expect(String(portRetenu(existant))).toBe(ecrit);
```

### Verdict affiché

```
AVANT correction — les deux nouveaux cas ROUGISSENT
  « le port du .env est occupé »  →  la sonde dit « Port 7777 — déjà occupé »
                                      quand le .env dit un autre port
  « le port du .env est libre »   →  [ATTENTION] Port 7777 — déjà occupé,
                                      pour une ruche qui n'ira jamais sur 7777

mutants sur portRetenu, après correction
  `brut === undefined → null`            →  2 cas rouges
  `n >= 1 && n <= 65535` → `||`          →  1 cas rouge, « pour « 0 » »
  ignorer le .env (const brut = undefined) →  4 cas rouges
  après restauration par copie            →  31 verts
```

> **La règle** — quand deux chemins doivent s'accorder sur une valeur, ne pas
> les écrire deux fois : extraire la décision, et faire ROUGIR l'écart plutôt
> que de le relire. Et se méfier du cas nominal qui les fait coïncider : c'est
> lui qui garde le désaccord invisible.

### Un troisième état, qui n'existait pas

`HIVE_PORT=abc` n'est ni libre ni occupé. Avant, la valeur était simplement
ignorée par la sonde et recopiée telle quelle dans le `.env` — la ruche
démarrait ensuite sur on ne sait quoi. `portRetenu` rend `null`, et l'écran le
dit : « HIVE_PORT=abc — valeur illisible ». Retomber sur le défaut aurait sondé
une porte que personne n'a demandée et l'aurait déclarée libre : un vert
emprunté, la pire des réponses.

---

## 9 sexagies. Trois « restes de balayage » repris de liste en liste — deux étaient déjà faits, le troisième était équivalent

Une liste de points ouverts se recopie d'un tour à l'autre plus vite qu'elle ne
se vérifie. Trois items y figuraient depuis plusieurs tours ; aucun n'a été cru
sur parole, tous ont été MESURÉS sur HEAD. Résultat : un seul demandait un
geste, et ce n'était pas celui qu'on croyait.

### 1. `server.ts` — `find` sur `taskId && nodeId` : DÉJÀ DÉFENDU

La recherche vit dans `inspectionDeProduction` (`gardiennes.ts`), extraite pour
être tenue en un seul endroit — deux copies, route HTTP et livraison autonome,
pouvaient dériver. Mutant `&&` → `||` :

```
2 cas rouges — « la tâche doit correspondre » et « l’ouvrière doit correspondre »
               expected 'hollow' to be 'clean'
39 verts après restauration
```

Les deux moitiés sont nommées par leur banc. Rien à faire.

### 2. Le glisser au canevas du Cerveau : INJOUABLE, et c'est mesuré

Les trois décisions du glisser sont déjà sorties du composant — `priseAuDoigt`,
`deplacementDuGlisse`, `selectionAuRelacher` — pures et éprouvées hors canevas.
Ce qui reste dans `Cerveau.tsx` est de la tuyauterie : `sous()`, `auGraphe()`,
la mutation de `corps.current`.

Ce reste ne peut pas être joué sous banc, et la raison se mesure plutôt que de
s'affirmer :

```
happy-dom · canvas.getContext('2d')      → null
happy-dom · getBoundingClientRect()      → 0×0 @ 0,0
```

Sans contexte 2D et sans géométrie, un `mousemove` simulé ne peut ni trouver le
corps sous le curseur ni vérifier où il atterrit. Un banc qui « jouerait » ce
glisser ne jouerait que ses propres bouchons.

**On le DIT plutôt que de le simuler.** C'est la seule réponse honnête, et elle
est déjà écrite dans les gestionnaires : « les booléens sont NUS à dessein —
aucune comparaison ne retombe dans ce gestionnaire injouable sous banc ».

### 3. Balance — `arme && cible !== null` : une moitié vive, une moitié équivalente

Deux mutants opposés, et ils ne disent pas la même chose :

```
`arme` retiré               → 1 cas rouge (« au repos, aucun avertissement
                               d’engagement » : expected <p …> to be null)
`cible !== null` neutralisé → 3 verts — SURVIVANT
```

Le survivant est ÉQUIVALENT, et la preuve est structurelle : `arme` ne devient
vrai que dans `poser`, qui rend la main tôt quand `cible === null` ; et `cible`
ne dépend que de `saisie`, dont le `onChange` DÉSARME. Aucune entrée ne
distingue l'original du mutant.

**Mais on ne la retire pas**, contrairement à la branche morte du § 2.16 ter.
La différence compte : ce `cible !== null` n'est pas du décor, c'est le
rétrécissement de type qui autorise `formatDuree(cible)` juste en dessous. La
retirer casserait la compilation. Elle se consigne donc SUR PLACE, avec les
deux verdicts, pour que le prochain balayage ne rouvre pas l'enquête.

> **La règle** — un item de liste n'est pas un fait. Avant de prendre le geste
> qu'il suggère, le mesurer sur HEAD : ici, deux items sur trois étaient déjà
> clos, et le seul vivant demandait le contraire de ce que la liste laissait
> croire (consigner, pas écrire un test). Une liste qu'on recopie sans mesurer
> finit par décrire un dépôt qui n'existe plus.

---

## 9 unsexagies. Un balayage sur du terrain jamais vu : trois survivants, et un seul appelait un test

`src/node-client` n'avait jamais été balayé — les campagnes précédentes avaient
couvert `src/orchestrator`, `src/shared`, `src/tui`. Base épinglée sur le commit
d'origine du dépôt, `LOUPE_CHEMINS=src/node-client` : **95 candidates**, sur
2 541 lignes ajoutées. Terrain neuf, pas un rejeu.

Trois survivants dans le premier tiers. Ils ne demandaient pas la même chose,
et c'est tout l'intérêt de les TRANCHER un par un plutôt que de les compter.

### Le seul vrai trou — `optionBac`, dernière porte avant le bac à sable

```ts
if (!bac.decision.isole || !bac.fournisseur) return {};
```

Muté en `&&`, aucune assertion ne bougeait. La cause est instructive : **tous
les cas de la suite passaient par un constructeur qui rend un `Bac` COHÉRENT**
(`decider` pose `isole` vrai si et seulement si un fournisseur existe). Les deux
moitiés de la garde étaient donc toujours d'accord — et leur désaccord, le seul
cas où la garde sert, n'était jamais joué.

Le type, lui, autorise le désaccord : `Bac.fournisseur` est
`Fournisseur | null`, et `optionBac` est exporté. Ce n'est pas un état théorique
qu'on invente pour tuer un mutant ; c'est ce que la signature promet de
supporter, sur la frontière que ce module existe pour tenir. Le message d'échec
du banc dit le danger mieux qu'un paragraphe :

```
expected { bac: { fournisseur: null, …(1) } } to deeply equal {}
```

Une option de bac qui ne borne rien, sous un nom qui promet le contraire. Et
l'autre moitié est pire encore : décision NON isolée + moteur présent, le mutant
mettrait le travail en conteneur alors que l'humain a écrit `HIVE_ISOLEMENT=off`.

### Deux équivalences, consignées sur place

- `parNode.length > 1` muté en `>= 1` (`agent-detect.ts`). `argvAgent` ne rend
  que `['node', script]` ou `[bin]`, et `candidates()` contient TOUJOURS `bin` :
  quand la longueur vaut 1, `sonder([bin])` vient d'être appelé et a rendu faux.
  Le mutant ajoute une sonde dont la réponse est déjà connue. L'écrire en test
  éprouverait le NOMBRE d'appels à `sonder` — un détail que personne n'exige.
- `err instanceof Error` muté en `instanceof Object` (`client.ts`).
  `nightShiftFromEnv` ne lève que par `parseWindows`, dont les trois points de
  levée font `throw new Error(…)` : les deux tests sont vrais ensemble, toujours.
  On garde la garde — `err` est typé `unknown`, et le jour où une levée d'ailleurs
  remonte, `instanceof Object` afficherait « invalide (undefined) ».

### Ce que ce balayage apprend au-delà de ses trois verdicts

Un survivant sur une garde à DEUX MOITIÉS signale presque toujours la même
chose : **le banc construit ses entrées par le constructeur légitime**, celui
qui maintient l'invariant. C'est bien pour tester le chemin nominal, et c'est
exactement ce qui rend les gardes défensives invisibles. Les atteindre demande
de fabriquer l'état incohérent À LA MAIN — ce qui n'est légitime que si le TYPE
l'autorise et si la fonction est exportée. Les deux conditions étaient réunies
ici ; quand elles ne le sont pas, le survivant est équivalent et se consigne.

> **La règle** — sur du terrain jamais balayé, ne pas compter les survivants :
> les trancher. Trois survivants n'appelaient pas trois tests — un seul en
> appelait un, et écrire les deux autres aurait ajouté du décor tout en donnant
> l'impression d'avoir refermé trois trous.

### Deuxième tiers : la borne refusée POUR UNE AUTRE RAISON

`hoteValide` refuse un nom d'hôte au-delà de 253 caractères. Le banc avait bien
un cas long — et il ne disait rien de la borne :

```ts
'x'.repeat(254),          // refusé… parce qu'il n'a AUCUN point
```

Moins de deux labels : ce nom aurait été refusé tout autant à dix caractères. La
mutation `> 253` → `>= 253` restait donc verte, et `> 254` aussi. C'est le
§ 9 unquinquagies aggravé d'un cran : non seulement le cas était « bien au-delà »
de la borne, mais il échouait sur une garde ENTIÈREMENT DIFFÉRENTE — un vert qui
ne mesure même pas ce qu'on croit qu'il mesure.

Le remède est un couple qui ne diffère que d'un caractère et passe toutes les
autres gardes (quatre labels, aucun au-delà de 63, alphanumériques). Avec ses
prémisses affirmées, sans quoi un vert ne prouverait que sa propre arithmétique :

```
`> 253` → `>= 253`  →  « 253 est la dernière longueur acceptable » : expected false to be true
`> 253` → `> 254`   →  « 254 est la première refusée » : expected true to be false
```

### Et un `&&` qui n'était pas du JavaScript

```ts
`curl -fsSLO …${arch}.deb` + ` && sudo dpkg -i …${arch}.deb`;
```

La loupe mute le texte comme le code, et ce `&&`-ci vit dans une chaîne : c'est
du SHELL. Le banc voisin vérifiait déjà les deux moitiés de la commande — il
avait été écrit pour ça, après qu'un `toContain('arm64.deb')` s'était laissé
satisfaire par la moitié `curl` seule. Mais il ne regardait pas CE QUI LES RELIE.

Muté en `||`, la ligne devient « télécharge, et si ça ÉCHOUE, installe » : un
téléchargement réussi n'installe alors rien, et l'étape se présente comme faite.
C'est une ligne que quelqu'un copie et lance avec `sudo`.

> **La règle (suite)** — une candidate dans une chaîne de caractères n'est pas
> d'office du décor (§ 9 novemquadragies). Il faut demander ce que la chaîne
> DEVIENT : un message affiché, oui, c'est du décor ; une commande qu'un humain
> exécutera, non — c'est du code qui tourne ailleurs, et son connecteur porte
> autant de sens que n'importe quel `if`.

### Le bilan, une fois les 24 verdicts tranchés

**14 défendues, 10 survivants.** Sur les dix : **cinq tests écrits**, **cinq
équivalences consignées**. Aucun laissé en suspens — c'est la seule façon de
pouvoir rejouer le balayage sans rouvrir les mêmes enquêtes.

Les cinq tests, et ce qu'ils défendaient vraiment :

| Mutant                             | Ce qui passait                                           |
| ---------------------------------- | -------------------------------------------------------- |
| `optionBac` : `\|\|` → `&&`        | `fournisseur: null` transmis au client                   |
| `hoteValide` : `> 253` → `>= 253`  | la borne, jamais dite (cas long refusé POUR AUTRE CHOSE) |
| `hoteValide` : `<= 63` → `< 63`    | la borne PAR LABEL, jamais dite                          |
| `enTeteValide` : `<` → `<=`        | la signature EXACTE, refusée comme trop courte           |
| `runMerge` : `length > 0` → `>= 0` | `prepareCommand: []` refusé au lieu d'être ignoré        |

Les cinq équivalences, toutes consignées SUR PLACE avec leur preuve :
`parNode.length > 1` (une sonde dont la réponse est déjà connue), trois
`instanceof` (`client.ts`, `join.ts`, `merge-runner.ts` — les levées possibles
sont toutes du type testé), et le `<= 63` initialement tué par accident.

### L'accident qu'il ne faut pas prendre pour une garde

Le mutant `<= 63` → `< 63` mourait déjà, sans qu'on ait rien écrit pour lui :
le cas des 253 caractères est monté avec des labels de 63 — la longueur MAXIMALE
— et refuser 63 le fait échouer. Vert par ricochet.

C'est fragile, et il fallait le dire plutôt que de l'encaisser : le jour où ce
montage prendrait des labels plus courts, la borne des 63 redeviendrait nue sans
qu'aucun rouge ne le signale. Elle a donc SA garde, qui la nomme.

> **La règle** — quand un mutant meurt sans qu'on ait visé, vérifier POURQUOI.
> Si c'est le montage d'un autre test qui l'a tué par ricochet, la protection
> tient à un détail que personne n'a promis de conserver : elle se réécrit pour
> elle-même. Une couverture qu'on ne peut pas expliquer est une couverture qu'on
> perdra sans s'en apercevoir.

---

## 9 duosexagies. La CI exerçait l'installeur ; personne n'exerçait la commande qu'il CONSEILLE

Une installation réelle sur Windows 11 (Node 26), rapportée depuis le terrain,
est allée jusqu'au bout : clone, dépendances, module natif, écran d'accueil,
`.env` en 0600, premier projet. Tout ce que la CI vérifie a tenu.

Puis la personne a tapé la première commande de l'écran de fin, et :

```
PS C:\WINDOWS\system32> npm run dev
npm : Impossible de charger le fichier C:\Program Files\nodejs\npm.ps1,
car l'exécution de scripts est désactivée sur ce système.
```

**Deux défauts dans une seule ligne**, et l'écran de fin portait les deux.

### 1. Le dossier — le shell n'est jamais resté dans la ruche

`install.ps1` fait `Push-Location $Dir` … `Pop-Location`. `install.sh` clone
dans `$HOME/hive` et lance npm depuis un sous-shell. Dans les deux cas, quand
l'installeur rend la main, **la personne est là où elle était** — ici
`C:\WINDOWS\system32`. L'écran conseillait `npm run dev` depuis un endroit sans
`package.json`.

Le plus embarrassant : la bonne forme existait à trois mètres. Le mode
`--dry-run` d'`install.ps1` écrit `cd $Dir; npm run install:hive`. Le chemin
sec savait ; le chemin réel ne savait pas.

### 2. Le `.ps1` — PowerShell refuse le shim que `npm` utilise

Sous PowerShell, `npm` résout vers `npm.ps1`, et la stratégie d'exécution par
défaut de Windows le refuse. `npm.cmd` — le shim batch — n'est pas gouverné par
cette stratégie.

On ne change PAS la stratégie de la machine : Hive n'écrit rien hors de son
dossier, et une stratégie d'exécution est un réglage de sécurité du système, pas
du produit. On donne la commande qui marche sans rien changer.

### Pourquoi la CI ne pouvait pas le voir

Elle exerce `install.ps1 -DryRun` sous les DEUX PowerShell (7 et 5.1), et elle
le fait bien. Mais :

- le dry-run s'arrête AVANT l'installeur, donc avant l'écran de fin ;
- et surtout, **rien n'exécutait la commande que l'installeur conseille**.

C'est le pli du `| iex`, une troisième fois (§ 9, et la CI exerçait « le SCRIPT,
jamais la PHRASE qui dit comment l'appeler »). Le script est éprouvé de bout en
bout ; la phrase qu'il imprime pour dire quoi taper ensuite ne l'est pas. Les
deux sont cohérents avec eux-mêmes et incohérents entre eux, et rien ne regarde
l'écart.

### Ce qui rendait ce défaut invisible ICI en particulier

`prochainesEtapes` était pure et testée — mais testée sur ce qu'elle CONTIENT
(« npm run dev » apparaît), jamais sur ce qu'elle SUPPOSE : que le shell soit
dans le bon dossier, et que `npm` soit lançable. Une garde de contenu ne dit
rien d'un contexte.

Elle prend désormais `plateforme` et `dossier` en paramètres — pas par élégance :
c'est ce qui permet d'éprouver Windows depuis Linux, alors qu'aucun runner ne
peut jouer la stratégie d'exécution d'une machine de bureau.

```
mutant : `npm.cmd` redevient `npm`  →  1 cas rouge (la panne du terrain, rejouée)
mutant : la ligne `cd` retirée      →  2 cas rouges
mutant : `plateforme === 'win32'` inversé → 3 cas rouges
après restauration par copie        →  34 verts
```

> **La règle** — tout texte qu'un produit imprime pour dire QUOI FAIRE ENSUITE
> est du code qu'un humain exécutera. Il se teste comme du code, et il se teste
> avec son CONTEXTE : d'où on le lance, et avec quel interpréteur. Un rapport de
> terrain vaut mille exécutions de CI, parce qu'il est le seul à contenir le pas
> que personne n'a pensé à automatiser.

---

## 9 trisexagies. Un fichier qui n'exporte rien est un fichier que personne ne garde

Un balayage élargi sur `src/adapters` + `src/cli.ts` (base épinglée sur le
commit d'origine) a rendu **157 candidates, 23 examinées, 14 défendues, 9
survivants**. Les neuf sont dans le MÊME fichier : `src/cli.ts`.

Ce n'est pas une coïncidence, c'est une propriété. `src/cli.ts` n'exporte
rien : ses commandes sont des fonctions internes qui appellent l'API puis
`console.log`. Aucun banc ne peut les interroger, donc aucune de leurs décisions
n'est gardée — et la loupe le dit sans ambiguïté, neuf fois de suite.

« Hors d'atteinte du banc » est presque toujours « au mauvais endroit »
(§ 2 quaterdecies). Le remède n'est pas d'écrire des bancs contorsionnés autour
d'un `console.log` : c'est de faire DESCENDRE les décisions dans des modules
purs, et de ne laisser en surface que l'impression.

### Ce que les décisions descendues valaient vraiment

| Mutant                             | Ce qui passait                                            |
| ---------------------------------- | --------------------------------------------------------- |
| `board.nodes.length === 0` → `!==` | un tableau PLEIN affichait « aucune contribution encore » |
| `v.sansSurface > 0` → `>= 0`       | « 0 bulletin(s) sans diff lisible » écrit à l'écran       |
| `v.surfaces.length > 1` → `> 0`    | une surface unique annoncée comme un désaccord            |
| `avgDurationMs > 0` → `>= 0`       | « 0.0s/tâche » annoncé comme une mesure                   |
| `uses !== undefined` → `===`       | `--uses 3` n'atteignait jamais la ruche                   |
| `j === 1` → `!==`                  | « hier » pour 2, 29 et 364 jours                          |

Le premier et le cinquième ne sont pas du même ordre que les autres. Le premier
fait disparaître de l'écran tout le travail de l'essaim, sans rien signaler. Le
cinquième touche un **droit d'entrée compté** : la personne demande un billet à
trois usages, la ruche applique son défaut, et rien ne dit que la demande a été
perdue.

### Le défaut trouvé EN ÉCRIVANT le banc, pas en lisant le code

```ts
Number(''); // 0
Number('  '); // 0
```

`--uses ""` posait donc un billet à **zéro usage** — inutilisable, et sans un
mot. Personne ne l'avait vu, et je ne l'ai pas vu non plus : il est tombé sur un
cas que je croyais acquis en écrivant `for (const brut of ['abc', '', …])`. Le
banc a rougi sur MA supposition, et c'est le code qui avait raison de rougir.

Une chaîne vide n'est pas un nombre que quelqu'un a tapé : c'est une absence, et
une absence laisse la ruche décider.

### Une équivalence, consignée

`j === 1` muté en `<= 1` survit : la ligne au-dessus a déjà repris la main pour
tout `j <= 0`, donc `j >= 1` est acquis. Le `===` fait le travail d'un `<=`
grâce à sa voisine. Le mutant du balayage, lui, était `!==`, et trois cas le
tuent.

> **La règle** — quand une campagne de mutation concentre ses survivants dans UN
> fichier, ne pas les traiter un par un : lire ce que le fichier a de
> particulier. Ici, il n'exportait rien. Le nombre de survivants ne mesurait pas
> neuf oublis, il mesurait une frontière mal placée.

### Ce qui reste dans `src/cli.ts`, et pourquoi ce n'est pas « équivalent »

**Huit des neuf sont refermés** — six décisions d'affichage et deux décisions
d'envoi, toutes descendues dans des modules purs. Ce que leurs mutants faisaient,
mis bout à bout, dit assez pourquoi ça valait la peine :

| Survivant                    | Ce que le mutant faisait                                    |
| ---------------------------- | ----------------------------------------------------------- |
| `board.nodes.length === 0`   | un tableau PLEIN disait « aucune contribution encore »      |
| `v.sansSurface > 0`          | « 0 bulletin(s) sans diff lisible » à l'écran               |
| `v.surfaces.length > 1`      | une surface unique annoncée comme un désaccord              |
| `uses !== undefined`         | `--uses 3` n'atteignait jamais la ruche                     |
| `j === 1`                    | « hier » pour 2, 29 et 364 jours                            |
| `m.cle !== 'local'`          | le repli d'un téléchargement raté ne proposait que lui-même |
| `res.suggestions.length > 0` | « À demander ensuite : » suivi de rien                      |
| `r.elaguees.length > 0`      | « 0 plus ancienne(s) retirée(s) » — un ménage jamais fait   |
| `r.billets.length === 0`     | « — aucun. » au-dessus d'une liste pleine                   |

**LE NEUVIÈME EST TOMBÉ AUSSI**, et pas comme prévu. Je l'avais annoncé comme
un lot à soi — rendre la commande invocable, entrées/sorties injectées, système
de fichiers simulé. C'était surdimensionné : ce qui manquait n'était pas de
pouvoir LANCER la commande, c'était d'avoir nommé son INVARIANT.

    on ne pose rien quand le plan refuse,
    et les avertissements précèdent l'action.

Une fois la phrase écrite, la fonction qui la porte tient en trois lignes —
`avantDePoser(plan)`, à côté de `planifier`, dans le module qui décide déjà de
tout le reste. Aucune injection, aucun système de fichiers simulé.

Les deux sens du mutant étaient graves. Un plan VALIDE pris pour un refus
afficherait `undefined` en guise de motif et n'installerait rien ; un REFUS
traversant poserait sur la machine le fichier de service que le plan venait
d'interdire — celui dont le motif dit « selon le format, cette valeur y
ajouterait une directive ».

```
`plan.genre === 'refus'` → `!==`   →  4 cas rouges
`poser: false` → `poser: true`     →  2 cas rouges
après restauration par copie       →  50 verts
```

> **La règle** — « ça demande un gros lot » mérite d'être vérifié avant d'être
> écrit. Souvent, ce qui coûte cher est de rendre le CODE testable ; ce qui
> suffit est de nommer la DÉCISION qu'il prend. J'ai estimé le premier, et
> c'était le second.

Cette ligne est écrite ici parce que ne rien dire aurait été la seule vraie
faute : un survivant qu'on n'a ni tué ni déclaré équivalent redevient invisible
au balayage suivant, et se recompte comme neuf.

> **La règle** — un survivant qu'on ne referme pas dans le tour se NOMME, avec
> ce que son mutant ferait et ce qu'il faudrait pour l'atteindre. « Pas encore »
> est une réponse acceptable ; « pas vu » ne l'est pas.

---

## 9 quadrasexagies. Un paramètre par défaut lu dans l'environnement transforme un banc déterministe en pari sur la machine

`prochainesEtapes(agent)` ignorait la plateforme. Deux bancs l'appelaient sans
rien préciser, et c'était sans conséquence.

Le jour où la fonction a cessé de l'ignorer — `plateforme: string =
process.platform` —, ces deux bancs sont devenus **dépendants de la machine qui
les lance**. Verts sous Linux, rouges sur le runner Windows :

```
AssertionError: expected 'Aller dans la ruche  :  cd D:\a\hive\hive…'
                to contain 'npm run dev'
+ Lancer la ruche          :  npm.cmd run dev
```

La CI l'a dit avant la fusion, et c'est exactement son travail. La leçon n'est
pas « la CI a bien fonctionné », c'est **ce que j'ai omis en ajoutant le
paramètre** : un défaut qui lit l'environnement ne se contente pas d'être
pratique, il déplace une décision hors du banc. Le banc croyait éprouver un
contenu ; il éprouvait le contenu **sur la machine du jour**.

### Le remède, et sa preuve

Les deux cas NOMMENT désormais leur plateforme. Ce n'est pas un affaiblissement
— l'assertion est inchangée —, c'est le banc qui reprend la main sur ce qu'il
exerce.

```
défaut forcé à 'win32', cas corrigés  →  59 verts
défaut forcé à 'win32', ancienne forme →  1 rouge (ce que la CI a vu)
```

La simulation vaut mieux que l'attente : forcer le défaut reproduit le runner
Windows en une seconde, là où pousser et attendre coûte huit minutes.

> **La règle** — quand on ajoute un paramètre par défaut qui lit
> l'environnement (`process.platform`, `process.cwd()`, `Date.now()`), relire
> TOUS les appels existants : ceux qui l'omettaient viennent de changer de
> nature sans changer d'une lettre. Un banc nomme ce qu'il éprouve.

---

## 9 quinsexagies. La loupe redésigne les équivalences consignées à chaque passe — et il ne faut PAS lui donner de quoi les taire

Le balayage de `src/tui` a rendu deux survivants. Le second était déjà tranché,
et sa consignation est écrite dans le code, à la ligne au-dessus :

```
🔴 SANS TEST · src/tui/rendu.ts · > → >=
             while ([...reste].length > largeur) {
```

```ts
// ─── `>` OU `>=` NE CHANGE RIEN, ET C'EST MESURÉ ───────────────────────
//
// Un balayage désigne cette borne « sans test » à chaque passe. Elle est
// ÉQUIVALENTE […] Différentiel exhaustif plutôt que raisonnement :
// largeurs 1 à 8, un à trois mots […] 2 016 cas, ZÉRO écart.
```

La loupe ne lit pas les commentaires. Elle mute, elle lance la suite, elle
constate qu'aucun cas ne rougit, et elle le dit — c'est exactement son travail,
et elle a raison de le refaire : une équivalence peut cesser d'en être une le
jour où le code autour change.

### La tentation, et pourquoi il faut y résister

Un marqueur — `// loupe:équivalent` — ferait disparaître cette redite. Le coût
serait dérisoire à écrire et énorme à porter : **tout commentaire deviendrait un
moyen de faire taire l'instrument**. Un survivant gênant, une ligne au-dessus,
et le balayage suivant ne le voit plus. La loupe ne mesurerait plus le code,
elle mesurerait la discipline de ceux qui l'annotent.

Ce qu'on paie sans marqueur est petit et borné : un emplacement de balayage sur
`LOUPE_MAX`, et une relecture du commentaire déjà écrit. Ce qu'on paierait avec
est illimité, et invisible.

> **La règle** — un instrument de mesure ne prend pas d'instructions du code
> qu'il mesure. Quand il redit une chose déjà tranchée, la bonne réponse est de
> relire la consignation — pas de lui apprendre à se taire.

### Et le premier survivant, lui, était un vrai trou

`sortie.columns > 0` muté en `>= 0`. Un terminal qui annonce ZÉRO colonne — un
tuyau, un journal de CI, une console pas encore dimensionnée — n'annonce pas une
largeur : il annonce qu'il n'en sait rien. Le mutant le prend au mot, retombe
sur le plancher de 20, et rend un écran où plus rien ne tient.

```
`columns > 0` → `>= 0`  →  « zéro colonne ⇒ repli 80 » : expected 20 to be 76
```

Le cas manquait parce que les bancs donnaient des largeurs PLAUSIBLES — 200, 64, 100. Zéro n'est pas une largeur plausible, et c'est précisément pour ça que
personne ne l'avait écrit.

---

## 9 sexsexagies. Un chemin imprimé pour être collé se cite TOUJOURS — « Jean Dupont » n'est pas un cas limite

Le correctif du rapport de terrain Windows ajoutait une ligne à l'écran de fin :

```
Aller dans la ruche      :  cd C:\Users\Evan\hive
```

Elle est juste, et elle casse dès que le compte s'appelle « Jean Dupont » —
c'est-à-dire pour une bonne part des machines Windows du monde :

```
cd C:\Users\Jean Dupont\hive
→ PowerShell : deux paramètres positionnels, refus
→ sh         : `cd` reçoit deux arguments et n'en garde qu'un
```

Le défaut a vécu quelques heures, entre le correctif du matin et cet audit. Il
est instructif pour une raison précise : **j'ai écrit la ligne en pensant à la
COMMANDE, pas au CHEMIN**. Le contenu était le sujet ; la citation, un détail
de forme. C'est l'inverse — une ligne destinée à être collée est du code, et
son argument est une donnée non maîtrisée.

### Pourquoi on cite TOUJOURS, et pas « si ça contient une espace »

Parce que la condition serait juste et le résultat faux un jour sur dix. Une
ligne collable « seulement quand le nom d'utilisateur est simple » n'est pas
collable. Une citation inutile ne coûte rien ; une citation manquante coûte le
premier geste après l'installation.

### Les deux conventions ne sont pas la même, et c'est le piège suivant

L'apostrophe existe dans les noms — « O'Brien ». Elle ferme la citation, et les
deux mondes la rouvrent différemment :

```
PowerShell : on la DOUBLE            'O''Brien'
sh         : on SORT de la citation  'o'\''brien'
```

Se tromper de convention rend une ligne qui a l'air juste et qui ne l'est pas —
le pire des deux, puisque personne ne la relit.

Guillemets SIMPLES des deux côtés, et pas doubles : sous PowerShell comme sous
sh, ils sont littéraux. Un chemin contenant `$` ou un accent grave ne sera pas
interprété.

```
citation retirée                        →  4 cas rouges
convention Windows appliquée sous sh    →  1 cas rouge, « sh la sort de la citation »
```

> **La règle** — tout ce qu'un produit imprime pour être COLLÉ doit résister aux
> données de la machine de quelqu'un d'autre : espaces, apostrophes, accents,
> `$`. Le contenu de la commande est ce qu'on relit ; la citation de ses
> arguments est ce qu'on oublie.

### Et le troisième survivant du balayage : `\x1b[0J` n'est pas une opération neutre

`effacerLignes(n)` rendait `''` pour `n <= 0`. Muté en `n < 0`, le cas ZÉRO
émet `\x1b[0A\x1b[0J` : `0A` ne remonte de rien, mais **`0J` efface du curseur
jusqu'au bas de l'écran**. Rendre la séquence pour zéro, c'est retirer du texte
que personne n'a demandé à retirer — et sur un écran d'installation, ce texte
est le récapitulatif de ce qui vient d'être écrit.

La fonction était privée au module. L'exporter était le prix à payer, et il est
faible : c'est une fonction pure de trois lignes dont le seul appelant est un
rendu.

```
`n <= 0` → `n < 0`  →  « zéro ne doit rien émettre » :
                        expected '\u001b[0A\u001b[0J' to be ''
```

---

## 9 septensexagies. Une italique en `*…*` a mis `main` au rouge sur trois systèmes — et le lint de la CI ne pardonne pas les fichiers qu'on croit hors sujet

`npm run lint` vaut `eslint . && prettier --check .`. Le point, c'est le POINT :
`prettier --check .` regarde TOUT le dépôt, y compris ce que personne ne
considère comme du code.

Une branche voisine a ajouté une compétence d'agent, `.agents/skills/…/SKILL.md`,
avec une italique écrite `*fallback*` là où la configuration du dépôt veut
`_fallback_`. Un caractère. Les trois jambes de la matrice sont tombées, et
elles y sont restées : `main` était rouge quand ce défaut a été trouvé.

```
eslint .            → 0
prettier --check .  → 1   .agents/skills/testing-hive-dashboard/SKILL.md
```

### Ce qui rend ce défaut particulier

Il n'est ni dans `src/`, ni dans `tests/`, ni dans la documentation lue par
quelqu'un. C'est un fichier d'outillage, et c'est exactement pour ça qu'il est
passé : on relit le code qu'on écrit, on ne relit pas le Markdown d'une
compétence. La CI, elle, ne fait pas cette différence — et elle a raison.

Correction : `prettier --write` sur le fichier. Une ligne, et les trois jambes
repartent.

### Le piège d'instrument que je me suis tendu en le mesurant

Premier sondage :

```sh
npx prettier --check . 2>&1 | tail -5; echo "PRETTIER=$?"
→ PRETTIER=0
```

**Zéro.** Alors que la commande venait d'afficher son avertissement. `$?` lit le
code de `tail`, pas celui de `prettier` — c'est le § 9 terdecies, écrit dans ce
même carnet, et je l'ai refait en le cherchant. Sans tube :

```sh
npx prettier --check . > /tmp/p.log 2>&1; CODE=$?   → 1
```

> **La règle** — le lint d'un dépôt couvre le dépôt, pas « les fichiers
> sérieux ». Et un code de sortie ne se lit jamais à travers un tube : la seule
> mesure valable est celle qu'on prend sans intermédiaire.

## 9 octosexagies. La loupe mutait sa propre prose — et un mutant posé dans un commentaire ne peut PAS être tué

Balayage du 13 août sur `dashboard/src` (base épinglée `74fc316`, 72 candidates,
72 examinées, aucun échantillonnage). Dix survivants. **Trois d'entre eux
étaient des lignes de commentaire**, et pas n'importe lesquelles :

```
🔴 SANS TEST · dashboard/src/views/Balance.tsx · !== → ===
             {/* ─── ÉQUIVALENCE CONSIGNÉE : `cible !== null` ne peut pas être faux ici
🔴 SANS TEST · dashboard/src/views/Balance.tsx · === → !==
             main tôt quand `cible === null` ; et `cible` ne dépend que de
🔴 SANS TEST · dashboard/src/views/Balance.tsx · !== → ===
             `cible !== null` neutralisé → 3 verts, survivant équivalent */}
```

Ce sont les trois lignes qui **consignent une équivalence trouvée par un
balayage précédent**. La loupe s'est dénoncée en relisant sa propre note.

### Ce n'est PAS le § 9 quinsexagies, et la différence est le tout

Le § 9 quinsexagies dit qu'une équivalence consignée est légitimement
re-désignée à chaque passe, et qu'il ne faut surtout pas donner à la loupe de
quoi la taire — parce qu'une équivalence peut cesser d'en être une.

Ici, rien de tel. Le mutant n'est pas posé sur la GARDE, il est posé sur la
PHRASE qui en parle. Du texte ne s'exécute pas : la suite reste verte quoi qu'il
arrive, le mutant est increvable **par construction**, et son verdict ne porte
sur rien. Les deux cas se ressemblent à l'écran ; l'un est un fait qui se
rejuge, l'autre est un bruit qui se répétera à l'identique pour toujours.

### Le sens du mensonge, et pourquoi il compte quand même

L'en-tête de la loupe met en garde contre le mensonge RASSURANT — une mutation
qui casse la syntaxe fait échouer la suite et passe pour un mutant tué. Celui-ci
est son exact opposé : le mensonge ALARMANT. Il ne cache rien, donc il est moins
grave, et c'est précisément pourquoi il avait survécu si longtemps.

Il n'est pas gratuit pour autant : **chaque faux survivant coûte une exécution
complète de la suite** — deux minutes ici — et il salit un verdict qu'on lit
pour décider de fusionner. Un instrument qui rend trois faux positifs sur dix
apprend à son opérateur à survoler la liste. C'est l'autre façon de n'être plus
écouté (§ REPLI_QUI_MORD : « un mur ne se lit pas »).

### La correction, et surtout ce qu'elle ne fait pas

Le filtre existait (`^\s*(//|\*|/\*)`) et ratait la forme la plus courante du
tableau de bord : un commentaire JSX s'ouvre par `{` PUIS `/*`. Il est sorti de
`candidates()` en `ligneMutable(texte)`, pure et éprouvée — même geste que
`mutationsDeLigne` avant lui (§ 2 quaterdecies), et pour la même raison : la
règle vivait dans une fonction qui lit le disque et le dépôt.

**Ce qu'elle ne fait pas, et il faut le dire plutôt que le sous-entendre** : les
lignes de CONTINUATION d'un commentaire multi-lignes qui ne commencent pas par
`*` restent invisibles. Deux des trois faux survivants ci-dessus sont dans ce
cas. Le filtre travaille ligne par ligne, sur des lignes que `git diff -U0` rend
par morceaux NON CONTIGUS : suivre l'état « je suis dans un commentaire » d'un
morceau à l'autre serait une devinette.

Et une devinette qui se trompe ÉCARTE du code réel — elle rend le mensonge
rassurant, celui qui cache. J'ai donc préféré une garde étroite et sûre à une
garde large et probable.

> **La règle** — quand on corrige un instrument de mesure, le sens de l'erreur
> résiduelle se choisit, il ne se subit pas. Deux faux survivants jugés à la
> main en dix secondes coûtent moins cher qu'une seule nudité tue.

## 9 novensexagies. Un banc qui monte l'écran sans jouer le geste couvre deux sites sur trois en ayant l'air d'en couvrir trois

Cinq des dix survivants du même balayage portaient la MÊME ligne, recopiée dans
trois fichiers :

```
libelleAgent(n.agentType, lang === 'en')
```

`libelleAgent` est bien défendu depuis toujours, drapeau `anglais` compris. Ce
que rien ne tenait, c'était le CÂBLAGE — le drapeau que les vues lui passent.
Inversé, l'ouvrière de repli s'annonce « Shell (simulated) » à un francophone :
la seule ligne de l'écran qui prévient que les diffs produits sont SIMULÉS
devient du bruit dans une langue étrangère.

J'ai écrit un banc pour les cinq sites, il est passé **vert du premier coup**,
et j'ai failli m'arrêter là.

### Ce que le rejeu SITE PAR SITE a montré

```
dashboard/src/NodesPanel.tsx:106 → CODE=0  VERT ⚠ NU
dashboard/src/NodesPanel.tsx:190 → CODE=1  ROUGE ✔ défendu
dashboard/src/NodesPanel.tsx:200 → CODE=1  ROUGE ✔ défendu
dashboard/src/SwarmView.tsx:131  → CODE=1  ROUGE ✔ défendu
dashboard/src/views/Essaim.tsx:61 → CODE=1  ROUGE ✔ défendu
```

Le site 106 est dans la FICHE de la coéquipière, qui ne se rend qu'après un clic
sur la carte. Mon banc montait le panneau et lisait son texte — il n'ouvrait
jamais la fiche. Il couvrait donc quatre sites sur cinq, en ayant toutes les
apparences d'en couvrir cinq : même fichier, même assertion, même vert.

Un banc qui monte un écran voit ce que l'écran montre AU REPOS. Tout ce qui
n'apparaît qu'après un geste — clic, survol, ouverture — est hors de sa portée,
et rien dans son résultat ne le signale.

> **La règle** — un banc de rendu ne se déclare pas couvrant parce qu'il est
> vert : il se déclare couvrant quand chaque site qu'il prétend tenir a été muté
> SÉPARÉMENT et l'a fait rougir. Muter le fichier en bloc aurait affiché un
> rouge franc et laissé la garde manquante intacte — le bloc masque ce que le
> site par site expose.

Corollaire, applicable à tout le tableau de bord : **compter les sites avant
d'écrire le banc**. Cinq occurrences de la même ligne, c'est cinq mutations à
jouer, pas une.

## 9 septuagies. Un crochet qui dit « commite tes changements » pendant qu'un instrument tient une mutation est un piège — et j'ai créé la fenêtre moi-même

`npm run loupe` lancée dans l'arbre **principal** pour éprouver une PR avant
fusion. Trente secondes plus tard, le crochet de fin de tour :

> There are uncommitted changes in the repository. Please commit and push these
> changes to the remote branch.

Et de fait, `git status` montrait un fichier modifié :

```diff
-    const estActif = p.id === actif;
+    const estActif = p.id !== actif;
```

C'était la garde que je venais d'éprouver **ce tour-là**, retournée par la loupe
pendant qu'elle jouait la suite dessus. Obéir au crochet aurait commité — et
poussé — une garde délibérément cassée, sous un message de commit qui affirme
l'avoir défendue.

### Les deux gestes qui auraient aggravé, et pourquoi

1. **Commiter.** Le fichier « modifié » n'est pas un travail en attente, c'est
   l'état transitoire d'une mesure en cours. Un arbre sale n'est pas toujours un
   arbre à ranger.
2. **Tuer la loupe pour nettoyer.** C'est le § 9 octoquinquagies mot pour mot :
   la restauration vit dans un `finally`, donc un processus tué laisse la
   mutation EN PLACE. Le geste « je nettoie » est exactement celui qui salit.

Le bon geste est le troisième, et il ne ressemble pas à une action : **attendre
la fin de l'instrument**, puis vérifier que l'arbre est redevenu propre et que
le verrou est libéré.

### La faute qui précède, et c'est elle qui compte

Rien de tout cela n'aurait eu lieu si j'avais lancé la loupe dans un **atelier
détaché**, comme je le fais depuis le § 9 octoquinquagies — et comme je l'avais
fait une heure plus tôt dans le même tour, pour le balayage élargi. Pour un
diff court, j'ai jugé le `git worktree add` disproportionné et tapé
`npm run loupe` à la racine.

C'est un raisonnement en coût, appliqué à une règle de sûreté. La règle ne dit
pas « quand c'est long » : elle dit que **muter dans l'arbre où l'on commite
crée une fenêtre pendant laquelle le dépôt ment sur son propre contenu**. Une
fenêtre de deux minutes est une fenêtre. Ce qui la rend dangereuse n'est pas sa
durée, c'est ce qui peut tomber dedans — un crochet, une coupure, un autre
processus, moi.

> **La règle** — la loupe se joue TOUJOURS dans un atelier détaché, quelle que
> soit la taille du diff. Et un avertissement automatique qui décrit un arbre
> sale ne dit pas d'où vient la saleté : avant d'obéir, on regarde le diff et on
> demande qui le tient.

## 9 unseptuagies. J'ai corrigé la langue que je regardais, pas la classe de défaut — et le balayage suivant me l'a rendu en deux heures

Le § 9 octosexagies raconte la loupe mutant sa propre prose : des lignes de
commentaire JSX rendues « code neuf que rien ne défend ». Correction posée,
éprouvée, fusionnée — `{/*` rejoint `//`, `*` et `/*` dans le filtre.

Deux heures plus tard, balayage sur `scripts/`, jamais vu jusque-là :

```
🔴 SANS TEST · scripts/essai-installation.sh · < → <=
           # < 60 s ») avait été mesuré sur un dépôt DÉJÀ cloné
```

Un commentaire **shell**. Le même défaut, dans une autre langue, sur un terrain
qui est dans le périmètre par défaut de la loupe **depuis le premier jour**.

### Ce qui était fautif dans la correction précédente

Pas le code : `{/*` était juste, sûr et nécessaire. Ce qui manquait est une
question, et elle tient en huit mots : **« et dans les autres langages du
périmètre ? »**

`PORTEE_PAR_DEFAUT` vaut `['src', 'dashboard/src', 'scripts']`. Le troisième
n'est pas du TypeScript — c'est du shell, du PowerShell, du YAML. L'information
était sur la même page du même fichier, à quarante lignes de la fonction que je
corrigeais. Je ne l'ai pas lue parce que je regardais un survivant JSX, et que
le survivant JSX était expliqué.

> **Un filtre qui traverse plusieurs langages ne se corrige pas dans la langue
> du symptôme.** Quand on répare une règle, la question n'est pas « ce cas-ci
> est-il couvert ? » mais « quel est l'ENSEMBLE sur lequel cette règle
> s'applique, et l'ai-je parcouru ? ».

### Le piège de la correction évidente, et pourquoi il fallait résister

`#` ouvre un commentaire en shell. Le geste réflexe est de l'ajouter à la liste :
une alternance de plus, trois caractères, fini.

Il aurait été FAUX. En TypeScript moderne, `#compteur = 0` est un **champ
privé** — du code exécutable, qui porte des comparaisons comme n'importe quelle
autre ligne. Un `^\s*#` global aurait écarté du code réel, en silence.

Et ce n'est pas une erreur du même genre que celle qu'on soigne. Muter un
commentaire ment dans le sens **alarmant** : ça coûte une suite entière pour
rien, mais ça ne cache rien. Écarter un champ privé ment dans le sens
**rassurant** : la garde n'est jamais examinée, et la loupe dit « rien de nu ».

> **Quand on corrige un instrument, le sens de l'erreur résiduelle se choisit —
> il ne se subit pas.** Une correction qui échange un mensonge alarmant contre
> un mensonge rassurant est une régression, même quand elle ferme le symptôme
> qu'on avait sous les yeux.

Le marqueur de commentaire est une propriété du LANGAGE : la décision a donc
besoin du nom du fichier, pas seulement du texte. Et la liste des extensions où
`#` commente est **fermée** — l'élargir sera un geste conscient, là où une règle
« tout ce qui n'est pas du JS » finirait par écarter le code d'un langage auquel
personne n'aura pensé.

## 9 duoseptuagies. Un avertissement qui crie sur une machine saine est pire qu'un avertissement absent

`scripts/deps-optionnelles.mjs` existe pour une raison mesurée : sous Windows,
`npm ci` sortait en **0** pendant que `better-sqlite3` n'était pas installé, et
**68 fichiers de test sur 135** mouraient à l'import sans que rien ne dise
pourquoi. Le script rapporte ce qui manque, pour que la ligne suivante du
journal explique les 68 échecs.

Le balayage a trouvé sa borne nue :

```
🔴 SANS TEST · scripts/deps-optionnelles.mjs · > → >=
           if (absentes.length > 0) {
```

Avec `>=`, une installation **parfaitement saine** affiche « ⚠ Ces paquets
manquent » et conseille de relancer `npm ci --foreground-scripts`.

### Pourquoi ce mutant-là n'est pas cosmétique

Un diagnostic n'a qu'un seul capital : **qu'on le lise**. Un avertissement qui
se déclenche sur une machine en bon état est lu deux fois, ignoré la troisième,
et filtré la quatrième. Le jour où il dit vrai, il ne reste rien.

Ce script-ci ne serait pas seulement inutile : il serait **contre-productif**,
parce qu'il a été écrit pour être le premier endroit où quelqu'un regarde quand
une CI verte cache 68 morts. L'entraîner à être du bruit, c'est défaire
exactement ce pour quoi il existe.

> **Un faux positif de diagnostic ne coûte pas un affichage de trop : il coûte
> la crédibilité de tous les vrais positifs qui suivront.** Une borne
> d'avertissement mérite donc le même soin qu'une garde de sécurité — et le
> banc qui la tient doit épingler le cas SILENCIEUX, pas seulement le cas
> bruyant.

### Et la raison pour laquelle elle n'était pas tenue

Rien n'était exporté : tout vivait au niveau du module. « Hors d'atteinte du
banc » est presque toujours « au mauvais endroit » (§ 2 quaterdecies) — la
troisième fois que ce paragraphe se vérifie sur un script de `scripts/`.

## 9 terseptuagies. L'intermittent Windows est CONFIRMÉ intermittent — et ce qui l'a prouvé n'est pas un correctif, c'est un instrument qui manquait

Le 13 août, la jambe Windows d'une PR est tombée sur quatre `Hook timed out in
20000ms`, dans **trois fichiers sans rapport entre eux** :

```
tests/essaim-livraison.test.ts   afterEach   ×2
tests/serveurs-endpoint.test.ts  afterEach
tests/taches-bornees.test.ts     afterEach
```

La PR ne touchait ni ces fichiers, ni rien qu'ils importent : elle modifiait
deux scripts et ajoutait un banc de sept tests purs. `main` était vert sur
Windows au commit précédent.

### L'indice qui interdisait la lecture facile

`tests/taches-bornees.test.ts:51` est un `afterEach` **SYNCHRONE** —
`store.close()` puis `rmSync` d'un dossier temporaire.

Du code synchrone ne peut pas se bloquer sur un événement qui ne vient pas. Il
ne peut qu'être **privé de CPU**. Cette seule ligne écarte toute la famille
d'explications « un handle reste ouvert », « une connexion ne se ferme pas » —
qui aurait pourtant très bien collé aux deux autres fichiers, où l'on attend
bien un `server.stop()`.

Les temps confirment :

|                   | test CPU |   mur | cœurs |
| ----------------- | -------- | ----: | ----: |
| Windows           | 833 s    | 304 s |     4 |
| Linux, même arbre | 267 s    | 117 s |     — |

2,7 de parallélisme effectif sur quatre cœurs : les workers se disputaient la
machine.

### La question qui tranche, et l'outil qui n'existait pas

Devant un rouge de plateforme, une seule question commande la suite :
**déterministe, ou intermittent ?** Les deux réponses appellent des gestes
opposés — corriger le code d'un côté, chercher ce qui affame le runner de
l'autre — et **aucune exécution unique ne les distingue.**

Y répondre demande de rejouer le MÊME arbre. Or :

- la CI n'avait pas de `workflow_dispatch` : relancer exigeait de **pousser**,
  donc de modifier le code qu'on essaie de juger ;
- l'API refuse le rejeu aux intégrations (`403 Resource not accessible by
integration`).

Le dépôt était donc structurellement incapable de répondre à sa propre question.
La chasse « trois exécutions CI-identiques » consignée plus haut avait déjà payé
ce manque sans le nommer.

`workflow_dispatch` ajouté, seconde exécution lancée : **les six jambes vertes,
Windows compris, sur les mêmes trois fichiers.** Intermittent confirmé.

### Les deux gestes que je n'ai PAS faits, et pourquoi ils étaient tentants

1. **Relever `hookTimeout` à 30 s.** `vitest.config.ts` porte son propre
   déclencheur d'escalade, écrit avant d'en avoir besoin : à 20 s pour une
   opération mesurée à 200 ms, on n'attend plus un disque. Le fichier interdit
   explicitement ce geste, et c'est la troisième fois qu'il évite un plafond.
2. **Plafonner les forks sur Windows.** C'est mon hypothèse principale, elle est
   cohérente avec les chiffres, et je ne peux pas la mesurer d'ici. Une cause
   plausible trouvée juste après un vrai symptôme est la forme la plus séduisante
   de l'erreur (§ 9 quadraquadragies) — la retenir sans mesure, c'est deviner
   avec des chiffres à l'appui.

> **Quand un échec ne se reproduit pas sur commande, le premier lot n'est pas de
> le corriger : c'est de se donner les moyens de le REJOUER.** Un dépôt qui ne
> sait pas relancer la même CI sur le même arbre ne peut pas distinguer un défaut
> d'un aléa — et toute correction posée dans cet état est un pari, y compris
> quand elle rend le vert.

### Le chiffre qui a suivi, et ce qu'il exclut

Les deux exécutions Windows, sur des arbres identiques à UNE LIGNE de YAML près :

|             |   rouge |   verte |
| ----------- | ------: | ------: |
| CPU de test | 833,8 s | 662,7 s |
| mur         | 303,7 s | 247,4 s |
| fichiers    |     255 |     255 |

**Le même travail a coûté 26 % de CPU en plus sur l'exécution rouge.** C'est la
machine qui variait, pas le code — la démonstration est faite, et elle ferme
définitivement la piste « ma modification a rendu la suite plus lourde ».

Mais elle ne suffit PAS, et c'est le point qu'il ne faut pas glisser sous le
tapis : 26 % ne fait pas passer un hook de 200 ms à 20 secondes. C'est un
facteur CENT. La variance globale explique la fragilité — une suite qui court
déjà près du plafond —, elle n'explique pas le DÉCROCHAGE.

> Une mesure qui confirme une hypothèse peut rester insuffisante pour la
> conclure. « La machine était 26 % plus lente » et « un hook a mis cent fois
> son temps » sont deux faits compatibles, et le premier ne démontre pas le
> second. S'arrêter là serait accepter un ordre de grandeur de trou dans le
> raisonnement parce que le sens général est plaisant.

Ce qui reste ouvert, et se dit comme tel : **pourquoi** le runner Windows est
affamé n'est pas répondu. Le lot suivant a maintenant l'outil pour le chercher —
plusieurs exécutions du même arbre, avec et sans plafond de forks, et une
comparaison des temps plutôt qu'une intuition.

## 9 quaterseptuagies. J'ai livré un instrument en affirmant qui pourrait s'en servir — sans l'avoir essayé une seule fois

Le § 9 terseptuagies raconte pourquoi `workflow_dispatch` a été ajouté : sans
lui, une jambe rouge ne peut pas être rejouée sur le même arbre, et la seule
question qui compte — déterministe ou intermittent ? — reste sans réponse.

L'ajout était juste. Le commentaire qui l'accompagnait ne l'était pas :

> « il ne coûte rien : un déclencheur manuel ne s'exécute que lorsqu'un humain
> **— ou un agent qui rend des comptes —** le demande. »

Fusionné. Puis, au tour suivant, en voulant mener l'expérience :

```
POST …/actions/workflows/ci.yml/dispatches → 403
« Resource not accessible by integration »
```

Un jeton d'intégration n'a pas `actions: write` sur ce dépôt. **Je ne peux pas
déclencher l'instrument que je venais de construire pour moi-même.**

### Ce qui rend cette faute particulière

Ce n'est pas un défaut de code : le déclencheur marche, et un humain s'en sert en
deux clics. C'est une **affirmation de capacité livrée sans mesure**, dans un
dépôt dont la règle d'ouverture est « vérifié ne veut pas dire écrit ».

Et l'information était déjà là. Dix minutes plus tôt, dans le même tour, j'avais
reçu :

```
POST …/actions/runs/{id}/rerun-failed-jobs → 403
« Resource not accessible by integration »
```

J'ai lu ce 403 comme « le rejeu n'est pas accessible », et j'en ai conclu qu'il
fallait un autre chemin — sans voir qu'il disait quelque chose de plus général :
**cette intégration n'écrit pas sur les Actions.** Le refus portait sur la
famille entière, pas sur une route. J'ai construit la route voisine et je l'ai
annoncée ouverte.

> **Un refus de permission parle du DROIT, pas de la porte.** Lire « cette
> route-ci m'est fermée » là où le message dit « je n'ai pas ce droit » conduit
> à construire une seconde porte dans le même mur — et à la déclarer praticable
> sans l'avoir poussée.

### Le contrôle qui manquait, et il coûtait une commande

Essayer le déclencheur AVANT d'écrire ce qu'il permet. Un appel, dix secondes,
et la phrase se serait écrite juste du premier coup.

C'est la version « capacité » du § 2.16 ter : on ne conclut pas qu'un mutant est
équivalent parce que c'est plausible, on cherche l'entrée qui tranche. Ici
l'entrée qui tranche était un `POST`.

### Ce qui reste vrai, et ce qui est corrigé

- **Vrai** : sans `workflow_dispatch`, la question ne peut pas être posée du
  tout, et relancer imposait de pousser — donc de modifier le code qu'on juge.
- **Vrai** : l'instrument fonctionne, et il est opérable en deux clics.
- **FAUX** : qu'un agent puisse s'en servir. Corrigé dans `ci.yml`, avec les
  deux 403 mesurés cités à l'appui.
- **Conséquence de conduite** : devant un rouge de plateforme, un agent DIT que
  la seconde mesure est nécessaire et qui peut la lancer. Il ne promet pas de la
  produire lui-même.

## 9 quinseptuagies. La PREMIÈRE exécution d'un banc n'est pas comparable aux suivantes — et j'ai failli publier l'artefact

L'hypothèse de la sur-souscription (§ 9 terseptuagies) enfin mesurable, j'ai
lancé la comparaison : même arbre, même machine à quatre cœurs, une exécution
sans plafond de processus puis une avec `HIVE_VITEST_FORKS=2`.

```
sans plafond : mur 146,3 s   tests 255,9 s
plafond = 2  : mur 116,0 s   tests 233,1 s
```

Vingt et un pour cent plus RAPIDE avec moins de processus. Contre-intuitif,
spectaculaire, et parfaitement cohérent avec l'hypothèse : la machine thrashait,
on l'a soulagée. J'avais la conclusion, elle était belle, et elle était FAUSSE.

### Ce que la répétition a rendu

| exécution       |      témoin | plafond = 2 |
| --------------- | ----------: | ----------: |
| 1               |     146,3 s |     116,0 s |
| 2               |     117,7 s |     115,3 s |
| 3               |     112,0 s |     115,0 s |
| moyenne à chaud | **114,9 s** | **115,4 s** |

Un demi pour cent d'écart. **Du bruit.**

La différence entière venait de la première exécution du témoin, et la colonne
qui la dénonce était sous mes yeux dès le premier tableau :

```
témoin  #1 : transform 25,61 s      ← cache FROID
témoin  #2 : transform 11,30 s
témoin  #3 :  transform 9,19 s
plafond #1 :  transform 9,47 s      ← cache déjà chaud, rempli par le témoin
```

Vitest met en cache ses transformations. La première exécution les paie toutes ;
les suivantes n'en paient aucune. J'avais mesuré le témoin EN PREMIER, donc le
témoin a payé le cache, et le plafond en a hérité gratuitement.

### La faute, et elle n'est pas dans l'analyse

Elle est dans le PROTOCOLE, décidé sans y penser : mesurer A puis B, une fois
chacun. Cet ordre à lui seul avantage systématiquement B, quel que soit B — on
aurait « démontré » la même chose en comparant le témoin à lui-même.

> **Un banc dont le premier échantillon porte un cache froid favorise
> mécaniquement ce qui est mesuré ensuite.** Une comparaison à un échantillon
> par bras ne mesure donc pas ce qu'on croit : elle mesure l'ordre dans lequel
> on s'y est pris.

Le contrôle qui manquait ne demandait ni outil ni idée : **répéter**. Quatre
minutes de plus, et l'artefact s'effondre tout seul.

### Ce que ça dit sur le § 9 quadraquadragies, qui n'est pas le même piège

Là-bas, une cause plausible arrivait juste après un vrai défaut, et je m'étais
arrêté de mesurer. Ici je n'ai pas arrêté de mesurer : **j'ai mesuré une seule
fois**, et une seule fois est un chiffre, pas une mesure. Les deux se ressemblent
et se soignent différemment — l'un demande de continuer à chercher la cause,
l'autre de répéter le même geste jusqu'à ce que la variance se voie.

### Le résultat, celui qu'on garde

- **Sur Linux, quatre cœurs : plafonner les processus à 2 ne change RIEN**
  (114,9 s contre 115,4 s). L'hypothèse de la sur-souscription n'est ni
  confirmée ni infirmée pour Windows — elle n'est simplement pas visible ici.
- **Bonne nouvelle utile quand même** : le plafond ne coûte rien. Une expérience
  Windows peut donc être lancée sans craindre de tripler le temps de CI.
- **La question reste ouverte**, et elle ne peut être tranchée que sur Windows,
  par quelqu'un qui a le droit de déclencher le workflow (§ 9 quaterseptuagies).

Ce qu'il ne faut PAS conclure : « le plafond est inutile ». Il n'a rien changé
sur une machine qui ne montrait pas le symptôme. Mesurer un remède là où il n'y
a pas de maladie ne dit rien du remède.

## 9 sexseptuagies. L'unité de jugement de la loupe est la MUTATION, pas la ligne — j'ai écrit un contrôle anti-abus qui était lui-même abusif

Un balayage de `src/orchestrator` (54 candidates, 54 examinées) a rendu six
survivants. **Les six étaient déjà tranchés et consignés sur place**, chacun
avec son raisonnement mesuré — et quatre fichiers portaient littéralement la
même phrase :

> « Un balayage élargi de la loupe le re-signalera « sans test » à chaque fois. »

La connaissance existait, elle était au bon endroit, et l'instrument ne savait
pas la lire. Chaque passe redemandait six jugements humains identiques aux
précédents.

D'où une marque, `loupe : équivalent`, posée dans le commentaire au-dessus de la
ligne. Avec deux gardes contre l'usage abusif, parce qu'une liste d'exclusion
est un endroit où une vraie nudité se cache pour toujours :

1. **la mutation est jouée quand même** — la marque épargne le jugement, pas la
   mesure ;
2. **une marque fausse se dénonce** — si un mutant réputé équivalent se fait
   TUER, la consignation ment ou le code a bougé sous elle.

Bancs verts, trois mutations rouges sur les gardes, tout en règle. Puis la
vérification de bout en bout, sur un vrai fichier :

```
⚠ MARQUE FAUSSE · tableau.ts · || → &&
  ✔ équivalent consigné · tableau.ts · < → <=
⚠ MARQUE FAUSSE · tableau.ts · === → !==
```

### Ce que le contrôle avait de faux

Une LIGNE porte plusieurs mutations. Celle-ci en porte trois :

```js
for (const a of alertes) if (pire === null || RANG[a.gravite] < RANG[pire]) pire = a.gravite;
//                                     ^^                  ^                ^^^
//                                  || → &&            < → <=          === → !==
```

La consignation n'en juge qu'UNE équivalente. Les deux autres sont tuées par la
suite — ce qui est parfaitement sain, et exactement ce qu'on veut. Ma marque,
posée sur la LIGNE, les couvrait toutes ; mon détecteur de marque abusive
criait donc au loup sur deux mutants défendus, et faisait sortir la loupe en 1.

**J'avais écrit un contrôle contre les marques abusives, et le contrôle était
lui-même abusif.**

> **Tout ce qui prétend juger doit se dire dans l'unité où le jugement se
> rend.** La loupe juge des MUTATIONS ; une annotation qui parle de LIGNES ne
> peut donc pas être exacte, quel que soit le soin mis à l'écrire. Le décalage
> d'unité ne se rattrape pas par de la prudence — il se corrige en changeant
> l'unité.

La marque nomme désormais son mutant : `loupe : équivalent — < → <=`, avec le
libellé exact que la loupe imprime. Bénéfice de bord plus important que la
mécanique : **la consignation doit maintenant DIRE ce qu'elle a jugé**, au lieu
de laisser un lecteur le deviner d'un paragraphe de prose.

### Ce qui a trouvé le défaut, et ce qui ne l'aurait pas trouvé

Ni les bancs — 37 verts, tous justes — ni les trois mutations de vérification,
qui mordaient toutes. Ils éprouvaient la fonction pure, et la fonction pure
était correcte : elle répondait exactement la question qu'on lui posait. **La
question elle-même était mal posée**, et aucune mesure de la réponse ne pouvait
le dire.

Ce qui l'a trouvé : avoir rejoué l'instrument complet sur un vrai fichier du
dépôt, une fois. Trois minutes.

> Un banc vert sur un module ne dit rien de la question que l'appelant lui pose.
> Le seul contrôle qui attrape une erreur d'unité est l'exécution de bout en
> bout sur une entrée réelle — parce qu'elle est la seule à faire se rencontrer
> les deux.

## 9 septenseptuagies. Une annotation ne vaut pas par ce qu'elle dit, mais par ce que l'instrument peut en ATTEINDRE

La marque `loupe : équivalent` (§ 9 sexseptuagies) posée, bancs verts, mécanique
vérifiée de bout en bout sur `tableau.ts`. Je l'ai alors posée sur les six
consignations existantes, dont celle de `Balance.tsx`, en tête de son bloc de
commentaire JSX.

Le rejeu suivant, sur le diff de la PR elle-même :

```
✔ équivalent consigné · Balance.tsx · !== → ===
          ─── ÉQUIVALENCE CONSIGNÉE : `cible !== null` ne peut pas être faux ici
```

La ligne « couverte » est de la **prose**. Pas la ligne de code.

### Pourquoi la marque n'atteignait pas ce qu'elle visait

Un commentaire JSX de quinze lignes ressemble à ceci :

```jsx
{/* ─── ÉQUIVALENCE CONSIGNÉE : … ← la marque était ICI
    (§ 2.16 ter). `arme` ne devient vrai que dans `poser`, …
    … quinze lignes de prose sans `*` en tête …
    `cible !== null` neutralisé → 3 verts, survivant équivalent */}
{arme && cible !== null && (   ← et elle devait couvrir CECI
```

Les lignes de continuation ne commencent ni par `//` ni par `*` : `ligneMutable`
les prend donc pour du CODE — c'est sa limitation connue, déjà consignée dans
son propre en-tête. La remontée depuis la ligne de code s'arrêtait donc à la
toute première d'entre elles, quinze lignes avant la marque.

Deux limitations parfaitement documentées, chacune sans danger, dont la
composition produit une annotation muette. Aucune des deux notes ne pouvait le
prédire : elles décrivaient chacune leur propre comportement.

> **Deux angles morts connus qui se croisent font un angle mort neuf, et
> personne ne l'a écrit nulle part.** Documenter une limitation ne protège que
> de son effet direct ; il faut la rejouer AVEC les autres pour voir ce qu'elle
> produit en composition.

### Ce qui l'a trouvé, et ce que ça confirme

Le même geste qu'au § 9 sexseptuagies, une heure plus tôt : rejouer l'instrument
COMPLET sur une entrée réelle. Deux défauts en deux rejeux, et zéro trouvé par
les bancs — qui étaient verts, justes, et sans rapport avec la question.

La marque descend donc sur sa PROPRE ligne, collée à ce qu'elle juge. Vérifié
plutôt que supposé, les quatre cas :

```
ligne de code, !== → === : true
ligne de code, === → !== : true
ligne de code, || → &&   : false   ← jamais jugé, donc jamais couvert
ligne de prose            : false
```

> Une annotation destinée à un outil se vérifie EN LA LISANT AVEC L'OUTIL. La
> relire soi-même ne prouve que sa lisibilité par un humain — c'est-à-dire
> précisément ce dont l'outil ne fait rien.

## 9 octoseptuagies. Un type structurel qui INVENTE une valeur fabrique des tests qui ne peuvent rien prouver

Les modules purs de ce dépôt déclarent leurs formes plutôt que de les importer
(`src/shared/cli-rendu.ts` en donne la règle) : un module pur ne doit rien tirer
derrière lui, sinon il n'est pur que de nom. En sortant les décisions de
`Balance.tsx`, j'ai suivi ce patron — et j'ai écrit :

```ts
export type ModeBalance = 'leger' | 'observation' | 'strict';
```

Le mode de repli ne s'appelle pas `leger`. Il s'appelle **`off`**.

Le banc a donc éprouvé `effetDuMode('leger', …)`, et il est **passé au vert**,
sur une entrée que la ruche ne produira jamais. Une assertion parfaitement
juste, sur un cas qui n'existe pas.

### Ce qui ne pouvait PAS le dire

- Le typecheck du module : content, `'leger'` étant membre du type que je venais
  d'inventer.
- Le banc : vert, pour la même raison.
- La loupe : elle mute des opérateurs, pas des littéraux de type.

Ce qui l'a dit : le typecheck du **tableau de bord**, au site d'appel, là où le
vrai type et le mien se sont enfin rencontrés. Deux fichiers plus loin.

### La règle, et elle n'est pas « n'utilisez pas de types structurels »

Le découplage reste juste, et il a été payé cher deux commandes plus tôt :
importer `Compte` de `../api` tirait `dashboard/src/api.ts` et toute sa chaîne
dans le programme du typecheck RACINE, plus strict — quatre erreurs `TS2835`
dans des fichiers que je n'avais pas touchés.

> **Un type structurel doit être un MIROIR, pas une paraphrase.** Il rend un
> module indépendant, et c'est sa raison d'être ; mais dès qu'il s'écarte de
> l'original — un membre en trop, un nom approché, un champ optionnel qui ne
> l'est pas — il cesse de décrire le monde et se met à décrire ce qu'on croyait.
> Les tests écrits contre lui deviennent alors invérifiables : verts, précis,
> et sans objet.

Le contrôle qui manquait tient en une commande : **lire le type d'origine avant
de le recopier**, et non après que le compilateur a protesté. Trente secondes.

### Le corollaire qui vaut pour la relecture

Un banc vert sur une valeur inventée ne se voit à AUCUNE relecture du banc — la
valeur y est cohérente, nommée, commentée. Elle ne se voit qu'en confrontant le
type à sa source. C'est la même famille que le § 9 sexseptuagies : ni les bancs
ni les mutations ne peuvent attraper une erreur sur la QUESTION posée, seule la
rencontre avec le vrai appelant le peut.

---

## 9 nonseptuagies. Un instrument doit REFUSER un réglage illisible, jamais le deviner — la loupe rendait un feu vert sur une faute de frappe

La loupe échantillonne, et son plafond se donne par l'environnement :

```js
const MAX_MUTATIONS = Number(process.env.LOUPE_MAX ?? 12);
```

`Number('douze')` rend `NaN`. Et rien, ensuite, ne s'en aperçoit :

```text
pas      = Math.max(1, Math.ceil(440 / NaN))                     // NaN
retenues = toutes.filter((_, i) => i % NaN === 0).slice(0, NaN)  // []
```

Zéro mutation retenue. La boucle ne tourne pas. `survivants` reste vide. Et la
loupe imprime son plus beau verdict, sortie 0 :

```
════ LA LOUPE NE VOIT RIEN DE NU ════
Chaque ligne examinée est défendue par au moins un test.
```

### Pourquoi c'est le pire endroit possible pour ce défaut

La phrase n'est même pas fausse. Aucune ligne n'a été examinée, donc toutes
celles qui l'ont été sont défendues — c'est vrai par vacuité. Elle se lit
« fusionne ».

L'en-tête de ce fichier met en garde, depuis le premier jour, contre le faux vert
rassurant. Il en produisait un, sur une variable mal orthographiée. `LOUPE_MAX=0`
faisait pareil.

### La règle existait déjà, écrite, dans le même dépôt

`scripts/vitest-forks.mjs` avait tranché exactement cette question quelques jours
plus tôt, et sa docstring dit la chose mot pour mot :

> Une valeur illisible pourrait retomber en silence sur le défaut. Ce serait le
> pire comportement possible POUR UN INSTRUMENT : on croirait mesurer avec un
> plafond, on mesurerait sans. **Une mesure qui ment est pire que pas de mesure.**

Je l'avais écrite. Je ne l'avais pas généralisée. La leçon n'est donc pas
« valider les entrées » — c'est que **la doctrine d'un dépôt ne s'applique pas
toute seule** : un réglage qui se lit par `Number(x ?? défaut)` est un réglage
qui devine, et il y en avait un autre à trois fichiers de là.

Corollaire sur le zéro : demander à un instrument de ne rien regarder n'est pas
un réglage, c'est une contradiction. Elle se refuse au même titre.

### Ce qui l'a trouvé, et c'est le point qui compte

Aucun banc. Le défaut a été trouvé en REJOUANT la loupe de bout en bout dans
l'atelier, pour vérifier un tout autre correctif.

C'est le **quatrième** défaut de `scripts/loupe.mjs` découvert de cette façon
(§ 9 sexseptuagies, § 9 septenseptuagies, les combinateurs CSS, celui-ci), et le
quatrième qu'aucun de ses bancs ne pouvait voir. La raison est structurelle et
mérite d'être nommée : **ses bancs éprouvent des fonctions pures, et chacun de
ces défauts vivait dans la COLLE entre elles** — la lecture d'une variable
d'environnement, le passage d'un nom de fichier, le parcours d'un diff.

Extraire des fonctions pures les rend éprouvables ; ça ne rend pas éprouvable ce
qui les appelle. Un instrument doit être rejoué sur du vrai, chaque fois qu'on y
touche.

---

## 9 octogies. Une liste de REFUS et une liste d'ADMISSION ne se trompent pas dans le même sens — et un seul des deux sens est acceptable

Un balayage a rendu ce survivant :

```
🔴 SANS TEST · dashboard/src/views/balance.css · > → >=
             .bal-noeuds > summary {
```

En CSS, `>` n'est pas une comparaison : c'est le combinateur enfant. Muté, le
sélecteur ne s'analyse plus et le navigateur jette la règle.

### Le mutant n'avait AUCUNE des deux issues

Le § 2.16 ter n'en laisse que deux : une entrée le distingue — on écrit ce test —
ou il est équivalent — on le consigne. Celui-ci :

- n'est **pas** équivalent : la règle disparaît vraiment, à l'écran ;
- n'est **pas** testable : aucun banc ne lit de feuille de style.

C'est une troisième issue, que le contrat de la loupe n'a pas. Et un survivant
sans issue revient à chaque passe sans jamais pouvoir s'éteindre : le faux rouge
perpétuel, l'autre façon de n'être plus écouté.

### La faute que j'ai failli commettre en le corrigeant

Le premier réflexe était d'écrire une liste d'ADMISSION : « ne muter que `.ts`,
`.tsx`, `.mjs`, `.sh` ». Elle aurait marché ce jour-là, sur ce dépôt-là.

Le jour où quelqu'un ajoute un `.py` au périmètre, une liste d'admission le rend
**invisible** à la loupe. Sans rien dire. Pour toujours. C'est le mensonge
rassurant — celui que ce fichier existe entièrement pour empêcher.

Une liste de REFUS se trompe dans l'autre sens : un langage inconnu est muté, et
s'il n'a pas ces opérateurs il rend un survivant bruyant. Bruyant se voit en dix
secondes et se corrige d'une extension. Muet ne se voit jamais.

> **La règle : quand une garde peut se tromper dans les deux sens, on choisit
> celui qui FAIT DU BRUIT.** Le silence n'est pas la version prudente d'une
> erreur, c'en est la version définitive.

Le même fichier portait déjà ce raisonnement, dans l'autre sens, vingt lignes
plus haut : `DIESE_COMMENTE` est une liste fermée précisément pour ne jamais
écarter du code d'un langage auquel personne n'aura pensé. Les deux gardes se
lisent maintenant l'une à côté de l'autre, et c'est voulu.

---

## 9 unoctogies. La barrière est un INSTANTANÉ — j'ai poussé un fichier qu'elle n'avait jamais vu

Ordre réel des gestes, dans le lot qui a corrigé la loupe :

```text
1. correctifs de scripts/loupe.mjs + bancs
2. npm run typecheck · typecheck:dashboard · lint · suite      ← TOUT VERT
3. ajout de deux leçons dans docs/ERREURS.md
4. mesure des badges, commit, push
5. CI ROUGE sur les TROIS jambes : prettier, docs/ERREURS.md
```

La barrière du pas 2 était verte, et elle disait vrai — sur l'arbre du pas 2. Le
fichier du pas 3 n'existait pas encore quand elle a regardé.

### Pourquoi ça s'est glissé là précisément

Parce que la barrière est longue (la suite prend deux minutes) et que je l'avais
lancée EN TÂCHE DE FOND pour écrire le carnet pendant qu'elle tournait. Le
parallélisme est bon pour le temps ; il est mauvais pour la vérité, parce qu'il
sépare le moment où l'on mesure du moment où l'on écrit.

Et la faute a une signature reconnaissable : j'ai considéré `docs/` comme
« hors barrière », parce que c'est de la prose. Or `npm run lint` fait
`eslint . && prettier --check .` — le point veut dire le dépôt ENTIER. Un
document est un fichier du dépôt comme un autre.

### La règle, et elle est plus étroite qu'« relancer la barrière »

> **Le dernier geste avant `git add` est la barrière, pas l'écriture.** Si on
> touche quoi que ce soit après l'avoir lancée — du code, un test, un document,
> un badge — elle est périmée et son verdict ne porte plus sur ce qu'on pousse.

C'est la même forme que la règle des badges (« jamais de tête, mesurer avant »),
appliquée à la mesure elle-même : une mesure n'est valable que pour l'état
qu'elle a effectivement lu. Le lancement en tâche de fond reste utile, à une
condition — que rien ne bouge pendant qu'elle regarde.

### Le détail qui vaut d'être gardé

Prettier ne s'est pas contenté de signaler : il REFORMATE les blocs de code
`js` dans le Markdown. Le bloc ci-dessus est une trace de valeurs alignées en
colonnes, pas du code exécutable ; le laisser en `js` aurait fait écraser
l'alignement qui le rend lisible. La clôture est donc `text`, et c'est plus
honnête : ce n'est pas du code, c'est ce que le code a donné.

---

## 9 duooctogies. Ma barrière tournait sous un Node que le produit REFUSE d'installer

En voulant mesurer l'installation de bout en bout, j'ai mis Node 24 en tête du
`PATH`. La suite, verte cinq minutes plus tôt, a rendu **549 rouges** :

```text
The module 'better_sqlite3.node' was compiled against a different Node.js
version using NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 137.
```

127 est Node 22, 137 est Node 24. Le module natif avait été construit pour le
Node par défaut du conteneur.

### Ce que ça révèle, et qui n'est pas le rouge

Le rouge n'est qu'un symptôme. Le fait est celui-ci :

|                                       | version                             |
| ------------------------------------- | ----------------------------------- |
| ce que `package.json` exige           | `"node": ">=24"`                    |
| ce que la CI mesure                   | `NODE: '24'`                        |
| ce que l'installeur REFUSE            | Node 22 — « Hive exige 24 ou plus » |
| **ce sous quoi ma barrière tournait** | **v22.22.2**                        |

L'installeur refuse Node 22 explicitement, avec un message soigné expliquant que
le module natif devrait être compilé. Et la barrière locale — celle qui décide si
un lot part — tournait sous ce Node-là depuis le début de la session.

### Ce que ça N'A PAS coûté, et il faut le dire dans cet ordre

Aucun défaut n'est passé : chaque lot a été mesuré par la CI sous Node 24 avant
d'être fusionné, et les six jambes étaient vertes. Le filet a tenu.

Mais il a tenu parce qu'il n'y avait rien à attraper, pas parce que la barrière
locale le garantissait. **Une barrière qui tourne sur un autre moteur que le
produit peut rendre vert sur du code qui échoue chez tout le monde.** Aujourd'hui
les deux étaient d'accord ; c'est de la chance, pas de la conception.

### La règle

> **Un instrument de mesure doit tourner sur la même chose que ce qu'il mesure.**
> Une suite verte sous un runtime que le produit rejette ne dit rien du produit —
> elle dit qu'un autre programme, sur une autre machine, passe ses tests.

C'est la même faute que le § 9 unoctogies, un cran plus profond : là, la barrière
avait lu le mauvais ARBRE ; ici, elle tournait sur le mauvais MOTEUR. Les deux
fois, le verdict portait sur autre chose que ce qu'on croyait mesurer.

Ce qui l'a trouvée : rien de délibéré. C'est un effet de bord d'un changement de
`PATH` fait pour une tout autre raison. Une garde qui n'existe pas se découvre
par accident ou pas du tout — et compter sur l'accident n'est pas une méthode.

---

## 9 teroctogies. Une mesure sur un montage à moi ne mesure que mon montage

En vérifiant qu'un ménage par `lsof` reconnaîtrait bien les processus de
l'essai, j'ai voulu aller vite : plutôt qu'une installation complète, un
dossier bricolé à la main — `package.json`, `src`, `scripts`, un lien vers
`node_modules`, un `.env` écrit à la main — puis `npm run ruche`.

Le résultat imprimé :

```text
ruche debout après 40s
  pids : aucun
PORT RENDU
```

« PORT RENDU » a l'air d'un succès. C'en est l'inverse exact : **la ruche
n'avait jamais démarré** (`Exit 1`, avalé par le `&`), donc aucun processus ne
tenait le port, donc la sortie ne disait rien du mécanisme que je prétendais
mesurer. Le « après 40s » était la boucle d'attente arrivée au bout.

### C'est la même faute que le `sed` qui n'avait pas mordu

Quelques heures plus tôt, une mutation posée par `sed` avec des `||` non
échappés ne s'était jamais appliquée, et son `CODE=0` avait été lu comme
« le mutant survit ». Même forme :

> **Une mesure dont le SUJET n'a pas été mis en place rend un résultat qui a
> l'air d'en être un.** Elle ne rate pas bruyamment ; elle répond à côté, avec
> aplomb.

### Ce qui l'a rattrapée, et qui doit devenir un réflexe

Une seule chose : avoir regardé la ligne `[1]+ Exit 1` au lieu de sauter au
verdict. Le contrôle qui manquait est trivial et se pose AVANT le verdict —
**vérifier que le sujet est bien là** : la ruche répond-elle, la mutation
est-elle bien dans le fichier, le port est-il bien tenu au départ ?

Refait sur une VRAIE installation (`install.sh`, code 0, ruche debout en 2 s),
la mesure a enfin porté sur quelque chose :

```text
pid 2461  cwd=/tmp/mesure-lsof-reel  → RECONNU
pid 2462  cwd=/tmp/mesure-lsof-reel  → RECONNU
un cwd étranger sur le même port     → ÉPARGNÉ
après kill : port rendu après 0s
```

### Le corollaire, qui vaut au-delà de ce cas

Un banc qui monte son propre décor plutôt que d'utiliser le vrai chemin
d'installation éprouve le décor. C'est acceptable quand le décor EST le sujet
(une fonction pure et ses entrées) ; ça ne l'est jamais quand le sujet est
« est-ce que ça marche pour de vrai ». Là, le seul montage honnête est celui
que l'utilisateur subira.

---

## 9 quateroctogies. Un bouchon `vi.mock` et la portée du banc sont deux endroits différents

Deux fois dans la même journée, sur deux fichiers de banc sans rapport :

```text
ReferenceError: fetchChantiers is not defined
```

La fonction ÉTAIT bouchonnée — la fabrique `vi.mock('../dashboard/src/api', …)`
la remplace bien. Mais `vi.mocked(fetchChantiers)` a besoin du SYMBOLE, et le
symbole vient de l'`import`, qui ne liste que les fonctions dont on s'était
servi jusque-là.

La confusion est facile parce que les deux blocs se ressemblent et se suivent :

```text
vi.mock('…/api', … ({ fetchChantiers: vi.fn(…), fetchRayon: vi.fn(…), … }))
     ↑ ce qui est REMPLACÉ à l'exécution

import { fetchRayon } from '…/api';
     ↑ ce qui est NOMMÉ dans ce fichier
```

Deux listes, deux rôles, et rien ne dit qu'elles doivent coïncider : on ne
nomme que ce qu'on manipule.

### Pourquoi ça mérite une entrée malgré la trivialité

Parce que l'erreur est BRUYANTE et instantanée — `ReferenceError` au premier
appel — et que je l'ai quand même refaite trois heures plus tard sur un autre
fichier. Une faute qui échoue bien n'est pas une faute qu'on retient : elle
coûte deux minutes, on la corrige sans y penser, et rien ne l'inscrit.

Le réflexe à garder tient en une phrase : **avant d'écrire `vi.mocked(x)`,
vérifier que `x` est dans l'`import` du fichier, pas seulement dans la
fabrique.**

### Le cousin, rencontré dans la foulée

Même banc, cinq minutes plus tard : j'ai bouchonné `fetchConflicts` avec la
forme `{ id, list }` — celle que le composant CONSOMME
(`conflictsPoll.data.list`) — alors que la fonction PRODUIT `{ conflicts }`,
et que c'est le sondage qui enveloppe.

C'est le § 9 octoseptuagies vu d'un autre angle : j'avais lu le type au site
d'USAGE au lieu du site de DÉFINITION. Le bouchon doit imiter ce que la
fonction rend, jamais ce que son appelant en fait.

---

## 9 quinoctogies. La PORTÉE d'une garde fait partie de la garde — et elle se mesure, comme le reste

`tests/security-invariants.test.ts` est un beau fichier : 400 lignes qui
verrouillent des propriétés de tout le code source plutôt qu'un comportement.
Il interdit `shell: true`, exige que les lanceurs déclarent `shell: false`,
refuse un CORS `*`, refuse un jeton trivial.

Il ne servait à rien sur la moitié du terrain, et personne ne l'avait vu.

### La preuve, avant le correctif

```text
planté   : shell: true  dans scripts/ruche.mjs
le garde : Tests 28 passed (28)   CODE=0
```

Le fichier qui DÉMARRE la ruche pouvait passer par un interpréteur, et le garde
des invariants de sécurité restait vert.

### Trois dimensions, et les trois étaient courtes

| dimension       | ce que la garde couvrait      | ce qu'il fallait                        |
| --------------- | ----------------------------- | --------------------------------------- |
| **portée**      | `src/**/*.ts`                 | + `scripts/*.mjs` (ruche, tamis, loupe) |
| **motif**       | `\bspawn\s*\(`                | toute la famille `child_process`        |
| **granularité** | un `shell: false` par FICHIER | un par LANCEMENT                        |

Le motif est mesuré, pas supposé : `/\bspawn\s*\(/.test('spawnSync(')` rend
**`false`**. `spawnSync` et `execFileSync` échappaient à la règle depuis
toujours — `src/service-reel.ts` déclare `shell: false` par bonne pratique, pas
parce qu'on l'y obligeait.

### Ce que la garde élargie a trouvé du premier coup

`src/doctor-releve.ts` lance `docker --version` puis `podman --version` par
`execFile`. Sûr — liste fermée, argument constant, environnement filtré. Mais
son propre en-tête affirmait, depuis des semaines :

> « Ce fichier n'exécute d'ailleurs AUCUN binaire externe. »

C'est faux. La prose avait survécu au code qu'elle décrivait, et elle mentait
précisément sur la propriété que le fichier voisin existe pour garantir.

### Et ma propre correction avait le même défaut, un cran plus bas

La règle élargie, écrite et vue verte, a été mutée aussitôt. Retirer le
`shell: false` de l'UN des deux lancements de `scripts/loupe.mjs` : **30 passed,
sortie 0**. Ma règle disait « tout FICHIER qui ouvre un processus », et c'est
exactement ce qu'elle vérifiait — l'intention était « tout LANCEMENT ».

Corrigée en comptant les deux côtés, et l'approximation est dite sur place :
rien n'empêche deux `shell: false` de porter sur le même appel. Le jour où ça ne
suffira plus, il faudra un vrai analyseur syntaxique, pas une regex de plus.

### La règle

> **Une garde a une portée, un motif et une granularité. Les trois sont la
> garde.** Vérifier qu'elle est verte ne dit rien ; il faut lui présenter la
> faute qu'elle prétend interdire, à l'endroit le plus éloigné de là où on l'a
> écrite.

Le raisonnement existait déjà, écrit, dans `scripts/loupe.mjs` : `scripts/` est
entré dans son périmètre parce qu'« un outil qui existe pour débusquer le code
que rien ne défend ne peut pas avoir d'angle mort sur le chemin que TOUT LE
MONDE emprunte en premier ». La garde de sécurité n'avait jamais reçu le même
traitement — et c'est le § 9 nonseptuagies sous un autre jour : la doctrine d'un
dépôt ne s'applique pas toute seule.

### Le même trou, sur une deuxième garde, trouvé par la même méthode

La règle ci-dessus a été appliquée le jour même au verrou voisin — celui qui
interdit à la Balance d'entrer dans le choix du nœud. Il inspecte les imports
de `scheduler.ts` depuis `./balance.js` et refuse les noms d'imputation.

Faute plantée au point le plus éloigné de là où il a été écrit, en deux lignes,
sans qu'aucun nom interdit n'apparaisse dans le fichier surveillé :

```text
store.ts      export { estimerCout as coutIndicatif } from './balance.js';
scheduler.ts  import { coutIndicatif } from './store.js';

le verrou :   Tests 30 passed (30)   CODE=0
```

Le scheduler routerait au moins-cher — la doctrine qu'il existe pour tenir —
et la CI resterait verte. Le chemin n'était pas hypothétique : `store.ts`
importe déjà la Balance, et le scheduler importe déjà `store.ts`. Seul le
contenu qui transite les séparait, et rien ne le gardait.

Fermé en fermant le MÉCANISME plutôt qu'en énumérant les chemins : **personne
ne ré-exporte la Balance.** Le scheduler ne peut plus l'atteindre qu'en la
nommant, ce que le verrou d'origine voit.

### Ce qu'un verrou de source peut attraper, et ce qu'il ne peut pas

La nouvelle règle ne couvre PAS une enveloppe écrite à la main :

```ts
// store.ts — passe le verrou, et le passera toujours
export function coutIndicatif(d: Domaine, t: number[]) {
  return estimerCout(d, t);
}
```

Aucune expression régulière n'attrapera ça, et prétendre le contraire serait le
mensonge rassurant. La distinction mérite d'être écrite parce qu'elle dit à quoi
sert vraiment ce genre de verrou :

> **Un verrou de source couvre l'ACCIDENT, pas l'INTENTION.** Ré-exporter est un
> geste d'une ligne qu'on fait « puisque c'est déjà là » ; écrire une enveloppe
> qui blanchit un coût est une décision prise en connaissance de cause. Le
> premier se prévient par une garde, le second par une relecture humaine — et
> confondre les deux fait attendre d'une regex ce qu'elle ne peut pas donner.

### Cinq verrous éprouvés, quatre trous — et un qu'on ne ferme PAS

La méthode appliquée aux cinq verrous de source du dépôt, chacun sondé au point
le plus éloigné de là où il a été écrit :

| verrou                       | sonde                                                     | avant     |
| ---------------------------- | --------------------------------------------------------- | --------- |
| `shell: true` interdit       | planté dans `scripts/ruche.mjs`                           | 28 passed |
| chaque lancement le déclare  | un des deux appels de `loupe.mjs` dénudé                  | 30 passed |
| la Balance hors du scheduler | ré-exportée par `store.ts` sous un autre nom              | 30 passed |
| `budgets` sans élagage       | `DELETE FROM budgets` de masse dans `serveurs.ts`         | 31 passed |
| pas de migration dans `src/` | `'ALTER' + ' TABLE tasks ADD COLUMN cout'` dans `exec.ts` | 31 passed |

Quatre sur cinq ont été fermés. **Le cinquième ne le sera pas, et c'est une
décision, pas un oubli.**

### Pourquoi le SQL en morceaux reste dehors

`'ALTER' + ' TABLE …'` échappe au motif `\bALTER\s+TABLE\b`. On pourrait
poursuivre — concaténations, gabarits, `String.fromCharCode`. Chaque tour de
vis attraperait le tour précédent et raterait le suivant.

Les formes ACCIDENTELLES, elles, sont déjà couvertes : `\s+` prend le saut de
ligne et l'espace double, donc une migration écrite normalement, même mise en
forme par prettier, est vue. Écrire `'ALTER' + ' TABLE'` n'est pas une
distraction — c'est une phrase qu'on ne compose que pour n'être pas vu.

C'est la frontière déjà posée plus haut, mesurée une seconde fois : **le verrou
couvre l'accident, pas l'intention.** La reconnaître évite l'erreur inverse, qui
serait de faire grossir une expression régulière jusqu'à croire qu'elle garde ce
qu'elle ne garde pas.

### Une liste avait dix-sept fichiers de retard

`CONSTRUCTEURS_DE_PROMPT` nomme trois fichiers. Mesuré : **vingt** fichiers de
`src/` importent le helper d'encapsulation. La liste n'était donc pas ce que son
nom laissait croire — pas un inventaire des constructeurs de prompt, mais une
règle plus stricte sur trois d'entre eux.

Aucun défaut réel derrière : les vingt appellent bien le helper (mesuré, zéro
import muet). Mais une liste qui a dix-sept fichiers de retard se lit comme une
couverture qu'elle n'a pas.

Ajouté à côté, et c'est ce que le cas suggérait plutôt qu'une liste rallongée :
**un fichier qui importe le helper doit l'appeler.** Zéro coût aujourd'hui, et
ça attrape l'oubli qui viendra — quelqu'un retire l'encapsulation dans une
refonte et laisse la ligne d'import derrière lui.

---

## 9 sexoctogies. Pousser pendant que la CI tourne la relance depuis zéro — j'ai jeté trois exécutions sur quatre

La liste du tour de chantier commence par « la PR en cours : CI verte ? ». Quand
la réponse est « elle tourne encore », j'ai quatre fois de suite fait le geste
qui paraît productif — prendre le lot suivant, le finir, le pousser — sans voir
qu'il annulait la question à laquelle j'attendais une réponse.

Mesuré sur la PR #265 :

```text
09:09  f79e342  run 31786871797
09:17  96f8d48  run 31787436553
09:23  cd6937a  run 31787855475
09:27  76edaab  run 31788147077

→ 4 exécutions, 3 JETÉES, une seule a rendu un verdict
→ 21 travaux CI lancés pour rien (7 par exécution, sur 3 systèmes)
```

La PR n'a jamais été rouge. Elle n'a simplement jamais eu le temps de finir.

### Ce que ça a coûté, et ce que ça n'a PAS coûté

Ça n'a rien cassé : les quatre lots sont bons, ils sont tous entrés, et la
dernière exécution les a tous validés ensemble. Ce n'est pas une faute de
correction — c'est une faute de RYTHME, et elle a deux prix.

Le premier se mesure : vingt et un travaux de CI, dont trois installations
complètes sous macOS et trois sous Windows, calculés puis jetés.

Le second se voit moins et pèse plus : **la fenêtre entre « je pousse » et « je
sais » ne s'est jamais refermée.** Pendant vingt minutes, quatre lots empilés
attendaient un verdict qu'aucun n'obtenait. Si le premier avait été rouge, je
l'aurais appris avec trois lots de plus par-dessus — et trier lequel a cassé
quoi coûte bien plus cher que d'attendre cinq minutes.

### La règle, et elle est étroite

> **Une CI qui tourne est une question posée. On n'en pose pas une deuxième
> avant d'avoir la réponse à la première.**

Ça ne veut pas dire ne rien faire : préparer le lot suivant, le mesurer, le
mettre au point localement — tout cela est libre et se fait très bien pendant
l'attente. C'est le `git push` qui doit attendre, parce que lui seul remet le
compteur à zéro.

Ce que j'ai fait de mieux ce tour-là, et qui vaut d'être noté aussi : m'être
arrêté quand je l'ai vu, plutôt que d'écrire cette leçon tout de suite — la
committer aurait relancé la CI une cinquième fois, pour dire dans le carnet
qu'il ne fallait pas le faire.

---

## 9 septoctogies. Un critère d'arrêt posé APRÈS le résultat n'est pas un critère, c'est une justification

Huit balayages par échantillon, sur des terrains différents, ont rendu zéro
survivant d'affilée. Avant de lancer le huitième, j'ai écrit la règle noir sur
blanc : _si celui-ci rend zéro comme les sept précédents, l'échantillonnage sur
terrain déjà vu s'arrête._

Il a rendu zéro. Il s'est arrêté.

### Pourquoi l'ordre compte plus que la règle elle-même

La règle aurait été exactement aussi défendable écrite dix minutes plus tard.
Ce qui aurait changé, c'est ma capacité à la défendre — et surtout ma capacité
à ne PAS la changer.

Un critère énoncé après coup se plie tout seul au résultat qu'il doit expliquer.
Si le huitième avait sorti trois survivants, un critère écrit ensuite serait
devenu « on continue tant que ça trouve » ; il a sorti zéro, et écrit ensuite il
serait devenu « huit zéros, c'est concluant ». Les deux phrases sonnent bien.
Aucune des deux n'est une décision : ce sont des commentaires sur un résultat
déjà connu, déguisés en méthode.

> **Une règle qu'on écrit en connaissant le résultat qu'elle doit trancher ne
> tranche rien. Elle habille.**

### La faute que ça évite, et elle est concrète

Sans critère préalable, la pente est de continuer à échantillonner. Chaque tour
est peu cher, chaque zéro rassure, et l'ensemble ressemble à du travail. C'est
la version méthodique de chercher ses clés sous le lampadaire : on cherche là
où c'est éclairé, pas là où on a perdu les clés. Huit zéros ne disent pas « le
dépôt est gardé » ; ils disent que **cet instrument-là ne discrimine plus** — et
un instrument qui ne discrimine plus n'apporte aucune information, quel que
soit le nombre de fois qu'on le relance.

Le coût du neuvième passage n'est pas la machine. C'est qu'il aurait produit un
neuvième zéro, qui aurait eu l'air d'une confirmation.

### Ce qui reste à dire, et qui n'est pas à moi

L'arrêt ne remplit pas le trou : trois terrains restent à 13 %, 22 % et 23 % de
couverture par mutation. La suite — un balayage complet à environ six heures et
demie de machine par terrain, ou l'acceptation des chiffres tels quels — est un
arbitrage de coût, donc une décision de l'utilisateur. Ce que je peux faire sans
lui, et que j'ai fait : écrire les trois pourcentages **nus** dans le definition
of done, plutôt que de laisser un ✅ de lot donner à croire qu'ils sont pleins.

### La règle générale

> **Le moment d'écrire un critère d'arrêt est celui où on ignore encore de quel
> côté il tombera.** Après, ce n'est plus un critère — et le seul moyen de
> savoir si on l'a écrit trop tard, c'est de se demander si on serait prêt à
> l'appliquer au résultat inverse.

---

## 9 octooctogies. J'avais audité le CONTENU du script d'installation, jamais la FORME par laquelle il arrive

`install.sh` est le fichier le plus relu du dépôt. Son en-tête énumère ce qu'il
s'interdit — aucun `sudo`, aucune installation de Node à la place de
l'utilisateur, aucun port ouvert —, ses codes de sortie sont alignés sur ceux du
produit, son `.env` naît en 0600, et une jambe de CI mène l'installation
jusqu'à une ruche qui répond, sur deux systèmes.

Tout cela porte sur ce que le fichier CONTIENT. Le défaut, lui, vivait dans la
façon dont il ARRIVE.

### Le défaut

La commande du README est `curl … | sh`. `sh` ne lit pas le script d'un bloc :
il lit ce qui arrive, l'exécute, et redemande la suite. Une coupure du tuyau —
wifi, mandataire, CDN — laissait donc s'exécuter tout ce qui était déjà arrivé,
et `sh` rendait **0**, parce que le dernier ordre complet avait réussi.

    head -416 install.sh | sh   →   CODE=0, bannière, deux coches vertes,
                                    et rien d'installé.

Aucune relecture du contenu ne pouvait trouver ça. Le fichier est correct ligne
à ligne ; c'est le COUPLE fichier + tuyau qui ne l'est pas.

### Pourquoi je ne l'avais pas vu

Parce que j'avais lu le script comme un programme, et qu'un programme est ce
qu'on lit. Mais un script canalisé dans un shell n'est pas un programme : c'est
un FLUX d'ordres, et son unité d'exécution n'est pas le fichier, c'est la ligne
arrivée. Le modèle mental était faux, pas la lecture.

C'est la même famille que le § 9 quinoctogies (la portée d'une garde fait partie
de la garde) et que le constat de la loupe — ses quatre défauts vivaient dans la
COLLE entre ses fonctions pures, pas dans les fonctions. À chaque fois, la faute
est au JOINT : entre une garde et son périmètre, entre deux fonctions, entre un
fichier et son canal.

### La règle

> **Un artefact qu'on livre a deux propriétés : ce qu'il contient, et la façon
> dont il arrive. Auditer la première et pas la seconde, c'est vérifier une
> serrure sans regarder si la porte est posée.**

Le test qui la garde ne relit pas la source : il COUPE le fichier et le donne à
`sh` par l'entrée standard — le geste exact du README — puis regarde ce qui est
sorti. Un banc qui aurait cherché `principal()` dans le texte aurait gardé une
orthographe ; celui-là garde le comportement dans les conditions réelles de
livraison.

### Et le corollaire, qui coûte moins cher que la leçon

Pour chaque chose que le projet demande à quelqu'un d'exécuter, la question à
poser une fois est : **par quel chemin arrive-t-elle, et que se passe-t-il si ce
chemin se coupe au milieu ?** Elle a rendu ici un défaut de gravité réelle en
dix minutes de mesure. Posée sur `install.ps1`, elle a rendu « rien à faire » en
deux minutes — le README y télécharge dans un fichier avant d'exécuter, et
PowerShell analyse le tout avant la première ligne. Une question qui répond
« rien à faire » n'est pas une question perdue : c'est une borne qu'on peut
écrire au lieu de la supposer.

---

## 9 nonoctogies. Une garde née d'un défaut hérite du périmètre de ce défaut — et reste verte en le prouvant

Un utilisateur avait signalé que `irm …/install.ps1 | iex` ne pouvait marcher
sur aucune machine : `iex` évalue une EXPRESSION, et le `param()` du script
n'est valide qu'au début d'un SCRIPT. La correction fut bonne : les documents
ont été réparés, et un banc — `tests/commande-annoncee.test.ts` — a été écrit
pour que ça ne revienne pas.

Ce banc porte une liste écrite à la main :

    const ANNONCES = ['README.md', 'README.en.md', 'docs/INSTALLATION.md', 'install.ps1'];

Quatre fichiers. Exactement les quatre où le défaut avait été TROUVÉ.

Il vivait dans deux autres, et il y vit encore aujourd'hui — mesuré :
`MISSION-ACCUEIL.md` § 7.2.1, un cahier des charges qui dit « tous les points
ci-dessous sont exigés », et `docs/adr/0002-distribution-one-liners.md`,
c'est-à-dire **l'ADR des one-liners eux-mêmes**.

### Pourquoi c'est invisible

Parce que la garde est verte, et qu'elle a raison de l'être. Elle tient
parfaitement la promesse qu'elle fait. Le problème n'est pas qu'elle mente,
c'est que sa promesse est plus étroite qu'on ne la lit : on lit « `| iex` ne
peut plus revenir », elle dit « `| iex` ne peut plus revenir dans ces quatre
fichiers ».

Et l'écart ne se voit pas de l'extérieur, parce qu'un banc vert ne dit jamais
ce qu'il n'a pas regardé.

### La forme générale, qui vaut au-delà de ce cas

> **Quand un incident produit une garde, le périmètre par défaut de cette garde
> est celui de l'incident — pas celui du risque.** Les endroits où un défaut a
> été trouvé sont un ÉCHANTILLON des endroits où il peut vivre, et on écrit la
> garde le jour où on ne connaît que l'échantillon.

C'est le § 9 quinoctogies (« la portée d'une garde fait partie de la garde »)
avec une cause nommée : ce n'est pas de l'étourderie, c'est une conséquence
mécanique du moment où la garde est écrite. Le remède n'est donc pas « faire
attention » — c'est de ne pas LISTER.

### Lister contre découvrir

Une liste garde ce à quoi on a pensé, le jour où on y a pensé. Une découverte
garde aussi ce qui naîtra après. La bascule tient en quelques lignes : le banc
marche le dépôt au lieu de lire quatre chemins, et un document écrit demain est
DEDANS par défaut au lieu d'être DEHORS par défaut (§ 9 octogies : une liste de
refus et une liste d'admission ne se trompent pas dans le même sens).

Une découverte a son propre risque, symétrique : ne rien trouver et rendre tout
le bloc vert. Elle demande donc sa propre garde — le banc exige de voir les
fichiers connus, et cette exigence a été MUTÉE (marche non récursive → rouge,
restaurée → vert). Une garde-de-la-garde qu'on n'a pas vue rougir n'est qu'une
ligne de plus.

### Et ce qu'il ne faut PAS faire au passage

Le réflexe facile aurait été d'interdire le motif partout. Trois documents le
citent à bon droit — la CI raconte l'histoire, ce fichier-ci en tire la leçon,
le banc le décrit. Interdire aurait effacé le dossier pour faire passer un
banc.

La règle retenue est donc « le motif ne peut apparaître qu'à CÔTÉ de la raison
qui le condamne », avec une borne **mesurée** : la cause est à 3, 7 et 10 lignes
dans les documents légitimes, à l'infini dans les fautifs. Ni la mission ni
l'ADR n'ont été réécrits — une mission se cite, un ADR ne se réécrit pas ; ils
reçoivent la correction à côté.

### La prise la plus instructive

Le banc élargi a nommé trois fichiers, pas deux. Le troisième était **lui-même** :
son message d'échec montrait `install.ps1 | iex` sans la cause à moins de quinze
lignes. L'exempter aurait rouvert le trou exact qu'il ferme. Il s'y est conformé.

> **Le premier fichier qu'une garde élargie doit pouvoir accuser, c'est celui
> qui la contient.**

Et elle a récidivé sur-le-champ : la première rédaction de CETTE leçon citait
`irm …/install.ps1 | iex` dans son premier paragraphe sans énoncer la cause à
moins de quinze lignes — le `param(` le plus proche était **8 439 lignes** plus
haut, dans le § qui raconte l'incident d'origine. La barrière complète l'a
attrapée, pas la relecture.

Deux fois en un lot, la règle a mordu la main qui l'écrivait, et les deux fois
le correctif a **amélioré** ce qu'il touchait : le message d'échec dit
maintenant pourquoi, et ce paragraphe-ci se suffit à lui-même au lieu de
renvoyer implicitement à huit mille lignes de distance. Une garde qu'on ne peut
pas satisfaire sans écrire mieux est une garde bien posée.

### Retournée contre le reste du dépôt — et le décompte compte autant que la prise

Une leçon qui ne sert qu'une fois est une anecdote. Celle-ci a donc été passée
sur tous les bancs. **Quatorze découvrent déjà.** Les listes écrites à la main
qui restent sont, pour la plupart, des ensembles réellement CLOS : deux README,
trois fichiers Docker. Une liste de deux README n'a pas de troisième README à
rater — y voir un défaut serait appliquer la règle sans la comprendre.

Une seule avait la mauvaise forme : `tests/installeurs-demarrable.test.ts`, trois
scripts qui promettent une ruche qui démarre, et rien pour un quatrième.

Deux choses en sont sorties, qui prolongent la règle :

**1. Ne pas basculer sur une découverte quand le critère ne tient pas.** « Un
script qui promet une ruche qui démarre » ne se détecte pas proprement : l'un
mentionne `npm install` dans un commentaire, l'autre le fait dire par un `dire
"…"`. La forme retenue garde la LISTE et lui adosse une garde de COMPLÉTUDE — la
découverte n'a plus à être exacte, seulement à ne rien laisser passer
silencieusement. Le défaut par défaut s'inverse sans exiger un critère parfait.

**2. Dire quand ça ne change rien.** La découverte rend aujourd'hui exactement
les trois de la liste : aucun script n'était oublié, le lot ne corrige rien
d'observable, il ne change que le comportement futur. C'est écrit tel quel dans
le carnet.

> **Une garde qu'on pose « au cas où » et qu'on présente comme une correction
> est un arrondi.** Le seul moyen de ne pas se mentir est de dire, au moment de
> la poser, ce qu'elle aurait attrapé — et « rien, aujourd'hui » est une réponse
> honnête et suffisante.

### Le miroir de cette leçon : une portée trop LARGE en exclusion

Le § ci-dessus décrit une garde qui regardait trop peu. Le même tour en a
produit l'exact miroir, et il est plus vicieux.

`scripts/loupe.mjs` refuse de muter les langages où `>` n'est pas une
comparaison — juste, et mesuré : dans une feuille de style, muter un
combinateur rend un survivant que rien ne peut ni tuer ni juger équivalent.
Mais `.html` a été jeté dans cette liste avec le CSS, « parce que `<` ouvre une
balise ». Vrai du balisage. Faux de la PAGE, qui porte aussi du JavaScript.

Conséquence, mesurée :

    langageMutable('site/index.html')  →  false

La vitrine — 828 lignes de script, le premier écran que voit un arrivant — n'a
jamais été balayée, et ne pouvait pas l'être. Pas « aucune candidate » : aucune
candidate POSSIBLE, à jamais.

### Pourquoi l'exclusion trop large est PIRE que l'inclusion trop étroite

Une garde qui regarde trop peu laisse passer un défaut ; on finit par le
trouver ailleurs. Une garde qui exclut trop produit un SILENCE, et le silence
d'un instrument se lit comme une absence de défaut. Sur un balayage par
mutation, ça donne « LA LOUPE NE VOIT RIEN DE NU » sur un terrain que la loupe
ne pouvait pas regarder — la phrase exacte que cet instrument existe pour
empêcher.

> **Une liste de refus se juge sur ce qu'elle refuse À TORT, et cette
> erreur-là ne se signale jamais d'elle-même.** L'inclusion trop étroite finit
> par produire un incident ; l'exclusion trop large ne produit rien du tout, et
> c'est précisément pour ça qu'on ne la trouve pas.

Le remède n'est pas d'annuler l'exclusion — la raison qui l'a fait naître tient
toujours. C'est de la rendre plus FINE que l'extension : on ne regarde que ce
que le navigateur exécuterait. La question à poser à toute liste de refus est
donc : « qu'est-ce que je jette avec, et est-ce que je saurais jamais que je
l'ai jeté ? »

---

## 9 nonagies. « Différent » est SYMÉTRIQUE — un banc qui assène la différence ne peut pas départager

La vitrine choisit sa langue ainsi :

    var dict = lang === 'en' ? EN : FR;

Un banc s'appelle « LE BASCULEMENT CHANGE VRAIMENT LE TEXTE, DANS LES DEUX
SENS ». Il clique FR, clique EN, et exige que les deux titres diffèrent, qu'ils
soient longs, et qu'ils partagent peu de mots.

Le mutant qui échange les deux dictionnaires — donc qui sert l'anglais au
francophone et le français à l'anglophone — lui survit. Mesuré à la main, mutant
posé puis restauré par copie : **149 bancs verts.**

### Ce banc avait de BONNES raisons d'être ainsi, et c'est le cœur

Sa première rédaction exigeait le mot « essaim » dans le titre français. Elle a
rougi le jour où le titre est passé à « Faites coder plusieurs IA sur votre
projet » — un changement de copie légitime, et même meilleur. Un banc qui
interdit d'améliorer un texte se fait désarmer ; il a donc été réécrit pour ne
plus épingler aucun mot.

C'était juste. Mais en cessant d'épingler, il a cessé de DÉPARTAGER. « fr ≠ en »
reste vrai quand on échange fr et en. La propriété choisie pour être robuste
était symétrique, et une propriété symétrique est aveugle à une inversion.

> **Fuir la fragilité et perdre le pouvoir de discriminer sont le même geste, à
> un cran près.** Un banc qui n'assène plus qu'une DIFFÉRENCE ne peut pas dire
> laquelle est laquelle.

### Ce qui répare, sans revenir à la fragilité

Ni « le titre contient essaim », ni « les deux diffèrent », mais : **la page
applique le dictionnaire qu'elle prétend appliquer.** Le dictionnaire est son
propre oracle — pour chaque élément traduit, quand le bouton EN s'annonce
pressé, le contenu doit être EXACTEMENT `EN[clé]`.

Aucun mot n'est choisi par nous : une réécriture de la copie déplace le
dictionnaire et l'élément ensemble, et le banc suit sans broncher. Une inversion
les sépare, et il mord.

    VERDICT AFFICHÉ   dictionnaire inversé   →  219 éléments nommés, rouge
                      attributs inversés     →   6 attributs nommés, rouge
                      page de présentation   →   45 éléments nommés, rouge
                      source saine           →  19 verts

### Deux pièges rencontrés en le posant, tous deux instructifs

**1. La garde a d'abord rougi sur du sain, et elle avait tort.** Un élément —
`go.demo` — ne correspondait pas. Cause mesurée : le dictionnaire écrit
`<br />`, et `innerHTML` relu rend `<br>`. La garde comparait la façon dont un
analyseur écrit une balise vide, pas du contenu. Corrigé en normalisant LES DEUX
côtés par le même aller-retour. La règle : quand une garde neuve accuse du code
sain, on cherche d'abord l'erreur dans la garde — mais on la CHERCHE, on ne
l'assouplit pas jusqu'à ce qu'elle se taise.

**2. Elle ne regardait que le TEXTE.** Le mutant voisin, sur les ATTRIBUTS
traduits (`title`, `aria-label`), lui survivait : 17 verts. Un lecteur d'écran
anglophone se serait fait annoncer les libellés en français sans qu'un banc
bronche. Une ancre posée sur le contenu visible n'ancre pas ce qui n'est lu que
par les outils d'accessibilité.

### Et la portée, encore

Le balayage a nommé le MÊME survivant sur `site/presentation/index.html`. Ne
garder que la page d'accueil aurait refait, le soir même, la faute du § 9
nonoctogies — garder les endroits où le défaut a été TROUVÉ plutôt que ceux où
il peut VIVRE. La garde couvre les deux pages, et constate l'absence d'attributs
traduits sur la seconde au lieu de l'exiger.

### Commise une seconde fois, dans l'heure, par celui qui venait de l'écrire

Le § ci-dessus a été écrit à 13 h. À 14 h, en posant une garde sur la vitrine,
j'ai écrit :

    const PAGES_TRADUITES = ['site/index.html', 'site/presentation/index.html'];

— les deux pages que le balayage avait rendues À CE MOMENT-LÀ. Il a fini une
heure plus tard et en a nommé une troisième, `site/rush/index.html`, 115
éléments traduits et 9 survivants, qui serait restée dehors.

Le périmètre de l'INCIDENT au lieu de celui du RISQUE, exactement. Et pas par
ignorance de la règle : je venais de l'écrire.

> **Une leçon qu'on connaît ne protège de rien ; seul un mécanisme protège.**
> C'est précisément pourquoi la règle est « ne pas LISTER » et non « faire
> attention aux listes » : la seconde formulation demande une vigilance qui
> échoue une heure après avoir été rédigée, la première se vérifie par un banc.

Le rappel utile, quand on hésite : **une liste écrite à la main n'est justifiée
que si le critère de découverte serait ambigu.** Pour les installeurs, il
l'était (`npm install` en commentaire, ou affiché par un `dire "…"`) et la liste
est restée, gardée par une complétude. Pour les pages traduites, il ne l'est pas
du tout — dictionnaire `var EN = {` plus les deux boutons — et rien ne
justifiait la liste. Je ne me suis pas posé la question ; c'est ça, l'erreur,
pas le résultat.

### Troisième piège du même tour : un banc en TABLEAU dont le sujet ÉCRIT

Le balayage avait nommé nue la troisième branche de la résolution de langue —
celle qui décide pour un arrivant sans rien de rangé, d'après
`navigator.language`. Le banc écrit pour la couvrir parcourt un tableau :
`fr`, `fr-FR`, `fr-CA`, `en-US`, `de-DE`, `''`.

Il a rougi sur source SAINE, et son verdict accusait la page d'un défaut
spectaculaire :

    fr     → fr (attendu fr)
    fr-FR  → fr (attendu fr)
    fr-CA  → fr (attendu fr)
    en-US  → fr (attendu en)      ← un navigateur anglais verrait du français ?
    de-DE  → fr (attendu en)
    (vide) → fr (attendu en)

C'était le banc, pas la page. **La vitrine RANGE sa langue au chargement.** Le
premier tour, `fr`, écrivait `hive.lang=fr` ; les cinq suivants lisaient donc
une PRÉFÉRENCE au lieu de la langue du navigateur, et rendaient « fr » quoi
qu'on leur donne. L'ordre du tableau suffisait à fabriquer le résultat : commencé
par `en-US`, il aurait rendu six « en » et accusé la page de l'inverse.

> **Quand le sujet d'un banc en tableau ÉCRIT quelque part, chaque ligne hérite
> de la précédente.** Le `beforeEach` ne suffit pas : il tourne une fois par
> `it`, pas une fois par ligne. Ce qu'il faut remettre à zéro, c'est ce que le
> SUJET écrit, à l'endroit exact où la boucle recommence.

Et le fil qui relie les trois pièges de ce tour — `go.demo` (`<br />` contre
`<br>`), les attributs oubliés, ce tableau empoisonné — est toujours le même :
**une garde neuve qui accuse du code sain a presque toujours tort, et il faut
CHERCHER pourquoi, pas l'assouplir jusqu'à ce qu'elle se taise.** Les trois fois,
la recherche a rendu un banc meilleur ; une seule fois sur trois, elle aurait
donné raison au banc.

---

## 9 unnonagies. Rendre une garde CAPABLE et ne pas la BRANCHER, c'est l'avoir écrite pour soi

Deux lots ont été nécessaires pour que la loupe puisse voir le JavaScript de la
vitrine : retirer l'exclusion en bloc de `.html`, puis borner la mutation à ses
`<script>`. Le balayage lancé à la main a aussitôt rendu 43 candidates dont 33
SANS TEST, et parmi elles l'inversion du dictionnaire qui sert l'anglais aux
francophones.

Et pourtant, après ces deux lots, `npm run loupe` — **la garde de FUSION**,
celle qui tourne sans variable d'environnement — ne regardait toujours pas
`site/`. Le périmètre par défaut était resté `['src', 'dashboard/src',
'scripts']`.

La prochaine décision ajoutée à la vitrine serait donc passée avec « rien à
conclure », exactement comme avant les deux lots.

### Pourquoi c'est un piège à part

Parce que les deux premiers lots donnent la sensation du travail fini. Ils sont
difficiles, mesurés, et ils rendent un résultat spectaculaire — 33 survivants.
La troisième ligne, elle, est triviale : ajouter `'site'` à un tableau. Rien
n'attire l'attention sur elle, et elle porte tout.

> **Une capacité n'est une garde que branchée sur le chemin par défaut.** Ce
> qu'on ne regarde qu'en tapant une variable d'environnement, on ne le regarde
> qu'une fois — le jour où on l'a écrit.

C'est la même forme que l'angle mort du DÉCLENCHEUR de `npm audit`, consigné
dans `docs/DEFINITION-DE-SORTIE.md § C` : le gate existait, il était correct, et
il ne tournait qu'à l'ouverture d'une PR — donc un avis publié entre deux
livraisons restait invisible. Une garde a deux moitiés : ce qu'elle sait voir,
et QUAND elle est appelée. Livrer la première sans la seconde ne livre rien.

### Le raccord qui la rend circulaire, et qu'il faut savoir défaire

L'entrée `site` avait une raison de ne pas figurer dans le périmètre : `.html`
était muet, donc `site/` n'aurait rien rendu, donc l'y mettre était inutile. La
raison était juste — et elle a survécu à la disparition de sa cause.

> **Quand on lève une contrainte, on relit les décisions qui n'existaient QUE
> par elle.** Elles ne se signalent pas : elles ont l'air de choix, pas de
> conséquences.

### Et la preuve, qui ne s'affirme pas

Que le périmètre atteigne vraiment la vitrine se MESURE, arithmétiquement :

    périmètre par défaut (nouveau)          2269 candidates
    ancien périmètre, demandé à la main     2226
    site/ seul                                43
                                          ─────
                                2269 − 2226 = 43   ✓

Un banc qui aurait seulement vérifié `PORTEE_PAR_DEFAUT.includes('site')`
garderait l'orthographe de la liste. Cette soustraction garde le comportement.

### Et un mutant « équivalent » qui ne l'était que sous le décor du banc

Le balayage avait nommé nue la garde du presse-papier :

    if (navigator.clipboard && navigator.clipboard.writeText) {

Le banc qui exerce ce bouton injecte un presse-papier COMPLET. Sous ce montage,
`&&` et `||` prennent la même branche : le mutant est indiscernable, et la
tentation est de le consigner « équivalent » au titre du § 2.16 ter.

Il ne l'est pas. Il l'est **sous ce décor-là**. L'entrée qui départage existe et
elle est banale : un navigateur où `navigator.clipboard` existe mais
`writeText` non — contexte non sécurisé, vieux Safari, Firefox sans le drapeau.
Avec `&&` la page replie sur `textarea` + `execCommand` ; avec `||` elle appelle
une fonction qui n'existe pas, et la copie est perdue en silence.

> **Avant de consigner une équivalence, demander : est-ce le CODE qui rend les
> deux branches indiscernables, ou seulement ce que j'ai planté autour ?** Les
> deux se ressemblent exactement — dans les deux cas le mutant survit — et une
> seule des deux réponses autorise à classer l'affaire.

Le raccourci utile : une garde de CAPACITÉ (`si le navigateur sait faire X`) n'a
jamais d'entrée distinguante tant que le banc donne toujours un navigateur qui
sait. Ce sont précisément les branches de repli — celles qu'on n'exerce jamais
parce qu'elles sont « le cas rare » — qui accumulent les faux équivalents.

---

## 9 duononagies. Je n'ai pas d'horloge — « ça traîne » est une conclusion que je ne peux pas tirer seul

Sur une PR, six jambes de CI étaient vertes et Windows encore `in_progress`. Le
point de mesure fiable (`get_workflow_job`) montrait le pas 16, « Build », commencé
à 17:39:48 et toujours en cours. J'ai écrit : _« huit minutes là où il en prend
seize secondes d'ordinaire »_, et j'ai commencé à raisonner sur un blocage.

Le relevé final dit autre chose : le travail a conclu **success à 17:40:14**, et
le pas Build a duré **22 secondes**. Rien n'a traîné.

### D'où venait l'erreur — et ce que je ne peux PAS établir

Deux causes sont possibles et je ne sais pas les départager : ou bien le point
de mesure me servait un instantané périmé (le cache de GitHub retarde, mesuré
plus tôt sur la LISTE des check-runs), ou bien mon estimation de l'heure était
fausse — probablement les deux. Prétendre savoir laquelle serait exactement le
genre d'arrondi que ce carnet refuse.

Ce que je peux établir, en revanche : **je n'observe pas de montre.** Ce dont je
dispose, ce sont les horodatages que les outils me rendent ; entre deux appels,
je n'ai aucune mesure de ce qui s'est écoulé, seulement l'impression d'avoir
fait beaucoup de choses. Cette impression n'est pas une durée. La conclusion
« huit minutes » ne reposait sur rien de mesuré, quelle que soit la fraîcheur de
la donnée.

> **« Ça fait longtemps » n'est pas une observation, c'est un ressenti — et le
> mien n'est calibré sur rien.** Une durée se calcule entre deux horodatages
> RENDUS, jamais entre un horodatage et le sentiment d'être arrivé à maintenant.

### Ce que ça aurait coûté

La suite naturelle d'un « ça bloque » est de repousser pour déclencher une
exécution neuve — c'est-à-dire jeter une CI complète à quinze pas sur seize,
exactement le gaspillage du § 9 sexoctogies, et pour une panne imaginaire.

### La règle pratique

Quand un travail paraît long : ne pas conclure, **attendre et re-mesurer**. Le
second relevé donne soit un `completed_at` — et la durée devient un fait — soit
le même pas encore en cours, cette fois avec deux horodatages RENDUS entre
lesquels une soustraction a un sens. C'est le seul chemin honnête vers « ça
traîne », et il ne coûte qu'un appel de plus.

### Quatrième montage fautif : une horloge factice ne gèle pas les promesses

Le banc du bouton « copier la commande » devait vérifier deux choses : la
confirmation immédiate, et le retour au repos 1800 ms plus tard. Il a donc
installé `vi.useFakeTimers()`, cliqué, puis fait `vi.advanceTimersByTime(0)`
avant d'assener le libellé.

Rouge sur source saine : _« attendu copié ✓, reçu Copier la commande »_.

La confirmation n'arrive qu'une fois la promesse du presse-papier tenue. Une
promesse se résout en **micro-tâche**, et une horloge factice ne remplace que
les MINUTEURS — `advanceTimersByTime(0)` ne vide aucune micro-tâche. Il fallait
`await` avant d'avancer le temps.

> **Les horloges factices gèlent les minuteurs, pas les promesses.** Un banc qui
> mêle les deux doit vider les micro-tâches (`await`) AVANT d'avancer les
> minuteurs, dans cet ordre — l'inverse assène sur un état que la promesse n'a
> pas encore écrit.

C'est le quatrième montage fautif de la même série, et le fil ne varie pas : la
garde accusait du code sain, et c'est la garde qui avait tort. Les quatre fois,
chercher la cause a rendu un banc meilleur ; assouplir l'assertion aurait rendu
un banc muet.

### Cinquième montage fautif : un `monter()` qui EMPILE au lieu de remplacer

Le banc devait vérifier trois états successifs du bandeau de plafond : arrêté,
atteint-sans-arrêt, sous le plafond. Il a rougi sur source SAINE au deuxième :

    atteint sans arrêt : attendu { arretee: false, atteint: true }
                         reçu   { arretee: true,  atteint: true }

La vue semblait annoncer « ARRÊTÉE » sur un projet qui ne l'était pas — un défaut
grave, sur l'écran de l'argent. Il n'existait pas.

`monter()` crée un conteneur, l'ajoute au corps, et rend `document.body` — à bon
droit : les modales se montent par PORTAIL, donc hors du conteneur. Mais il ne
démontait pas le précédent. Deux appels dans un même banc laissaient **deux
arbres empilés**, et le second cherchait ses éléments en trouvant aussi ceux du
premier. Le bandeau « ARRÊTÉE » venait du montage d'AVANT.

L'`afterEach` ne rattrapait rien : il ne connaît que le DERNIER conteneur, les
autres fuyaient jusqu'à la fin du fichier.

> **Un utilitaire de montage qui rend le document entier doit démonter le
> précédent, sinon les montages s'ADDITIONNENT.** Et l'addition ne se voit pas :
> elle produit un faux positif qui ressemble trait pour trait à un défaut du
> produit.

### La correction est allée dans le MÉCANISME, pas dans le cas

Le réflexe rapide aurait été de découper le banc en trois `it` séparés — chacun
aurait eu son `afterEach`, et le symptôme aurait disparu. Le piège serait resté
armé pour le banc suivant qui monte deux fois.

`monter()` démonte désormais le précédent. Le banc a pu garder sa forme (trois
états lus d'affilée, ce qui se relit mieux qu'un état par banc), et tout le
fichier y gagne.

C'est le cinquième montage fautif de la série — après `<br />` contre `<br>`,
les attributs oubliés, le tableau empoisonné par le rangement et l'horloge
factice qui ne gèle pas les promesses. Le fil est identique à chaque fois, et
c'est ce qui en fait une règle plutôt qu'une anecdote : **une garde neuve qui
accuse du code sain a presque toujours tort.** Cinq fois sur cinq, chercher la
cause a rendu un banc — ou un utilitaire — meilleur.

---

## 9 ternonagies. J'ai écrit « le balayage tourne encore » sans regarder s'il tournait

Un balayage complet de 43 mutations avait été lancé en tâche de fond. Deux tours
plus tard, j'ai livré une PR dont le corps affirmait : _« Le balayage complet de
`Balance.tsx` tourne encore ; son verdict final viendra au tour suivant. »_

Mesuré au tour d'après :

    ps aux | grep -c "[l]oupe.mjs"      →  0
    /tmp/at-balance/.loupe-verrou        →  présent, daté 21:35
    dernière écriture du journal          →  22:00
    (la PR a été créée à 22:47)

Le processus était mort à 22 mutations sur 43, tué net — le gestionnaire de
sortie n'avait pas tourné, puisque le verrou est resté. J'ai annoncé l'état d'un
processus que je n'avais pas regardé, alors qu'UNE commande suffisait.

### Ce que ça a de différent du § 9 duononagies

Là, je concluais « ça traîne » d'un ressenti de durée que je n'ai pas les moyens
d'avoir. Ici, c'est pire et plus simple : l'information était disponible, à un
appel de distance, et je ne l'ai pas demandée. Je n'ai pas mal raisonné — je n'ai
pas mesuré du tout.

> **« Ça tourne » est une observation, pas un souvenir.** Un processus lancé au
> tour précédent n'est pas un processus vivant : entre les deux, il a pu finir,
> mourir, ou être fauché. Avant d'écrire son état dans quoi que ce soit de
> durable — carnet, corps de PR, commit — on le regarde.

### La contrainte d'environnement, qui se dit aussi

Le balayage n'a pas échoué : il a été FAUCHÉ. Une tâche de fond longue ne
survit pas nécessairement d'un tour à l'autre ici. La conséquence pratique n'est
pas « ne plus lancer de tâches longues », c'est de les **dimensionner pour
qu'elles finissent** — et de vérifier leur pouls avant de parler d'elles.

### Ce qui a bien tenu, et mérite d'être noté

Le verrou d'exclusivité de la loupe n'est PAS un piège : `jugerVerrou` demande
si le PID est vivant, et traite le verrou d'un cadavre comme périmé. Un
instrument qui pourrait rester bloqué par son propre corps aurait transformé
cette panne en panne durable. Ce n'est pas le cas, et c'est le fruit d'une garde
écrite avant d'en avoir besoin.
