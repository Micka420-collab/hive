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

**Ce que ça a révélé au passage** : une tâche assignée jamais acquittée reçoit
environ **118 `assign_task` en douze secondes** — le filet re-livre à chaque
tick sans rafraîchir `updatedAt`, donc la tâche reste éternellement « muette
depuis plus de 5 s ». Comportement PRÉ-EXISTANT, vérifié sur une tâche
ordinaire sans rapport avec la contre-expertise. Noté comme dette plutôt que
corrigé au passage : ce n'est pas le sujet de ce changement.

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

| geste                               | ce qui se passe vraiment                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `npm ci --omit=dev`                 | lance quand même `prepare` — donc `tsc`, qu'il vient de retirer (§ 4.3)           |
| `npm ci` + dépendance optionnelle   | **sort avec 0** même si le paquet a échoué et a été retiré (§ 1.5)                |
| `for … done` en shell               | **sort avec 0** même si toutes les tentatives ont échoué — vérifier après (§ 1.5) |
| `npm config set node_gyp …`         | **refusé** par npm 10 : « not a valid npm option »                                |
| `npm_config_node_gyp=…`             | posé, visible dans l'environnement, **ignoré** par npm 10                         |
| `npm run loupe` avant `git commit`  | ne voit **pas** les fichiers non suivis — commiter d'abord                        |
| `sleep` en avant-plan               | **bloqué** ici — utiliser `curl --retry N --retry-delay 1 --retry-all-errors`     |
| `pkill` en fin de chaîne `&&`       | fait échouer la chaîne (code 144) — l'isoler                                      |
| réf distante après reset sur `main` | prend du retard : **pousser la branche** après chaque repositionnement            |

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
