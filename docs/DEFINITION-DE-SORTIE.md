# Definition of Done — la sortie de Hive

> Chaque point de sortie du carnet (`docs/ETAPES.md`) répète la même phrase :
> _« aucun definition of done de sortie n'est écrit ni mesuré ; seul
> l'installation l'est »_. Ce fichier est cet instrument manquant.
>
> **La règle qu'il tient : un critère qui n'est pas MESURÉ n'est pas ATTEINT, et
> il se dit comme tel.** Un ✅ ici veut dire qu'une commande ou un banc a rendu
> le verdict — pas qu'on le croit. Le reste porte son vrai visage :
>
> - ✅ **atteint** — mesuré, la preuve est nommée ;
> - ❌ **non atteint** — pas encore fait, ou pas encore mesuré ;
> - 🔒 **hors d'atteinte** — dépend de comptes ou de machines qui ne sont pas
>   les miens ; à DIRE, jamais à simuler ;
> - 👤 **décision de l'utilisateur** — un arbitrage d'édition ou de commerce qui
>   ne se tranche pas depuis le code.
>
> On ne coche rien de tête. Les chiffres de cette page sont ceux d'une mesure
> datée ; quand la mesure vieillit, on la refait avant de s'y fier.

## A. Le code tient — ✅ mesuré en CI (arbre `9080648` + le lot des comptes annoncés, 29 août 2026, `ubuntu-latest` / Node 24)

> **L'ARBRE NOMMÉ EST TOUJOURS LE PRÉCÉDENT, ET C'EST NORMAL.** Un document ne
> peut pas contenir son propre condensé : le stamper puis rectifier le commit
> change le condensé qu'on vient d'écrire. Le hash ci-dessus est donc celui du
> commit qui PORTE le code mesuré ; ce commit-ci ne fait que l'inscrire. Une
> tentative de « corriger » cet écart le recréerait à l'identique.
>
> **UN TABLEAU DATÉ DOIT DIRE QU'IL EST DATÉ.** Cette section annonçait 3900
> bancs, mesurés la veille sur l'arbre `cf84422`. Le chiffre était juste ce
> jour-là et faux le lendemain — c'est-à-dire un badge écrit de tête avec un
> jour de retard. La date et l'arbre sont désormais dans le titre : un lecteur
> peut vérifier si la mesure est encore la sienne.
>
> **ET LA PRÉCAUTION N'A PAS SUFFI.** Le 16 août au matin, ce tableau annonçait
> encore 4071 sur l'arbre `90c1694` ; la suite en comptait 4249. Datée, la
> mesure restait FAUSSE — parce que dater n'oblige personne à refaire. Un point
> de sortie l'a relevé et l'a écrit noir sur blanc : « par sa propre règle, ce
> tableau n'est plus une mesure ». Il est refait ici, et la leçon se range à
> côté de la première : **une date ne périme rien toute seule ; c'est au lecteur
> de re-mesurer, et au document de le lui dire assez fort pour qu'il le fasse.**
>
> **CE N'EST PLUS AU LECTEUR.** Les quatre nombres de la ligne « Suite de bancs »
> sont désormais CONSTATÉS par `scripts/compte-tests.mjs`, que la CI lance après
> la suite : dès qu'ils s'écartent du rapport, la jambe `ubuntu` rougit et nomme
> l'écart. Le seul document dont le sujet était la mesure était le dernier que la
> mesure ne touchait pas ; il ne peut plus vieillir en silence.
>
> **ET IL NE SE RÉPARE PAS TOUT SEUL, C'EST VOULU.** `--corriger` remet les six
> badges à jour et REFUSE ce tableau-ci. Écrire des chiffres frais sous un titre
> qui nomme un autre arbre produirait une mesure d'apparence — le défaut
> d'origine, en pire, parce que l'outil l'aurait signée. Les deux gestes vont
> ensemble : on re-mesure, on réécrit les quatre nombres, **et on re-date ce
> titre**. C'est ce que dit le refus, et c'est ce qui a été fait ici.

> **LA MACHINE EST DANS LE TITRE, ET CE N'EST PAS UN DÉTAIL.** Le TOTAL (5474)
> ne dépend pas de l'hôte : vitest compte un banc ignoré comme un banc. La
> RÉPARTITION, elle, en dépend, et les quatre nombres de cette ligne sont ceux
> de la jambe `ubuntu-latest` / Node 24 — la seule où `compte-tests.mjs` tourne,
> donc la seule qui fait foi pour ce tableau.
>
> **CE PARAGRAPHE EST NÉ D'UNE ERREUR, ET ELLE MÉRITE D'ÊTRE DITE.** Ces quatre
> nombres ont d'abord été recopiés d'une mesure locale sous Node 22 : 5466 verts
> et 8 ignorés devenaient 5461 et 13. Rien de faux dans cette mesure-là — elle
> était juste prise sur une machine qui n'est pas celle qui juge. Cinq bancs de
> `installeur-porte` ne s'exécutent qu'à partir de Node 24 ; huit autres sont
> réservés à Windows et à macOS. **Aucune machine n'exécute les 5474** — pas même
> une jambe de CI. Une mesure locale honnête peut donc être le mauvais chiffre à
> écrire ici, et c'est la CI qui l'a dit, pas une relecture.

| Critère                  | Comment on le mesure                                     | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typage (hub + tableau)   | `npm run typecheck` && `npm run typecheck:dashboard`     | ✅ vert / vert                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Qualité (style + format) | `npm run lint` (eslint + `prettier --check`)             | ✅ vert                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Suite de bancs           | `npm test` (vitest run)                                  | ✅ **5474** (5466 verts, 8 ignorés, **0 rouge**)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Trois OS × Node 24       | matrice CI `ubuntu` / `windows` / `macos`                | ✅ vertes (run `32369933266`, hors badge)                                                                                                                                                                                                                                                                                                                                                                                                                         |
| L'image démarre          | jambe CI « L'image se construit, et la ruche y démarre » | ✅ verte                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rien de neuf n'est nu    | `npm run loupe` (mutation sur le diff ajouté)            | ✅ six terrains, chacun sur base épinglée : horloge — affichage (`1b93c44`, 18 examinées → 2 nues), la note (`6379854`, 17 → 3 nues), la file (`6c6c52b`, 2 → **rien de nu**) ; **butinage** — le transport (`ba07327`, 19 → 4 nues), le déballage (`13bfda3`, 12 → **rien de nu**), la licence (`7530fa0`, 10 → 2 **équivalentes prouvées**). **9 nues, 9 fermées, contre-rejeu 9/9 ; 2 équivalences confirmées par contre-rejeu** (§ terrain, `docs/ETAPES.md`) |
| Seuil de couverture      | `npm test -- --coverage` (cliquet, jambe `ubuntu`)       | ✅ tenu — vu rougir à +0,1 point                                                                                                                                                                                                                                                                                                                                                                                                                                  |

- ⚠️ **« SUR CE LOT » N'EST PAS UN RÉFÉRENT.** Cette case a annoncé « 17 nus
  trouvés sur ce lot — tous fermés » pendant quatre lots de plus, dont trois
  qui ont touché ce fichier sans la relire. Un lot est un mot qui glisse : il
  désigne toujours le dernier, donc plus rien dès qu'un autre arrive, et le
  chiffre reste vrai à l'endroit exact où il a cessé de l'être. Le compte porte
  désormais un terrain nommé et renvoie au carnet, où chaque balayage est daté
  par son fichier et sa base épinglée.

- ⚠️ **CE QUE VALAIENT LES « RIEN DE NU » D'AVANT LE 15 AOÛT.** La loupe ne
  vérifiait pas que la suite était VERTE avant de muter. Sur une suite déjà
  rouge, elle déclare chaque mutant « défendu » — tué par une panne qui ne le
  concerne pas — et conclut « rien de nu » sans avoir rien mesuré. Le cas s'est
  produit ce jour-là : **9 sur 9 « défendues », dont des lignes d'un fichier
  qu'aucun test n'importe** ; le même diff, une fois le banc réparé, a rendu
  **17 joués, 3 nus**.

  La garde existe depuis (§ 9 quincenties), mais **l'état de la suite n'était
  pas consigné lors des balayages antérieurs** : ces verdicts-là ne sont ni
  invalidés ni confirmés, ils sont **non vérifiables**. Ils ne sont donc pas
  recomptés ici comme des mesures.

- ⚠️ **Ce que « rien de neuf n'est nu » couvre, et pas plus** : la loupe
  ÉCHANTILLONNE. Le ✅ ci-dessus porte sur le diff de chaque lot, **pas sur le
  dépôt**. La couverture par mutation du dépôt, elle, se dit terrain par
  terrain, et voici les chiffres nus (base épinglée `f0fc005`, union des
  échantillons dont les totaux coïncident) :

  | Terrain                        | Vu / total | Part      |
  | ------------------------------ | ---------- | --------- |
  | `src/shared`                   | 49 / 49    | **100 %** |
  | `dashboard/src` (hors `views`) | 72 / 72    | **100 %** |
  | `scripts/`                     | 46 / 46    | **100 %** |
  | `src/orchestrator`             | 54 / 54    | **100 %** |
  | `src/node-client` + `src/tui`  | 45 / 192   | 23 %      |
  | `src/adapters` + racine `src/` | 49 / 222   | 22 %      |
  | `dashboard/src/views`          | 57 / 440   | 13 %      |
  | `site/` (les 3 pages)          | 43 / 43    | **100 %** |

  **`site/` a rejoint les terrains à 100 % le 14 août, et son histoire vaut
  d'être dite** : `.html` était exclu EN BLOC de la loupe, donc la vitrine — le
  premier écran d'un arrivant — ne pouvait rendre AUCUNE candidate. Une fois
  l'exclusion levée et la mutation bornée aux `<script>`, le premier balayage
  complet a rendu **33 SANS TEST sur 43**, dont l'inversion du dictionnaire qui
  sert l'anglais aux francophones. Huit lots plus tard, le balayage rend
  **43 / 43, zéro nu** — mesuré deux fois, la seconde parce que la première
  précédait le dernier correctif et n'aurait donné qu'une déduction.

  Sur les cinq terrains à 100 %, « gardé » est mesuré. Sur les trois autres,
  ce qui est mesuré est **l'échantillon**, et rien d'autre : 87 % de
  `dashboard/src/views` n'a jamais été regardé par la loupe. Ce n'est pas
  masqué derrière un ✅, c'est écrit ici.

  **ET LES BALAYAGES PAR FICHIER NE S'ADDITIONNENT PAS À CETTE LIGNE.** Depuis
  le 16 août, `dashboard/src/views` est balayé vue par vue — douze fichiers, le
  détail est dans `docs/ETAPES.md`. Ces chiffres NE sont PAS reportés dans le
  tableau ci-dessus, et c'est délibéré : chaque balayage par fichier utilise sa
  PROPRE base (le parent du commit qui a créé le fichier), quand la ligne
  `57 / 440` vient d'une union à base unique `f0fc005`. Deux instruments
  différents, deux dénominateurs différents — les mélanger fabriquerait un
  pourcentage que personne n'a mesuré.

  Ce que les balayages par fichier disent, et qui vaut par soi-même — **le total
  est donné avec ses termes, pour qu'on puisse le refaire** :

  | Vue       | Fermées | Vue        | Fermées   | Vue       | Fermées |
  | --------- | ------- | ---------- | --------- | --------- | ------- |
  | Partage   | 2       | Balance    | 0         | Sante     | 2       |
  | Chantiers | 5       | Intendance | 0         | Essaim    | 1       |
  | Rayon     | 1       | Cerveau    | 3 (sur 7) | Ruche     | 7       |
  | Miellerie | 4       | Memoire    | 6         | Reine     | 17      |
  |           |         |            |           | **Total** | **48**  |

  Dont un relevé de fusion qui pouvait afficher la coulée d'un autre, une bande
  d'erreur qui s'inversait, trois bornes `> 0` toujours vraies, une invite qui
  enseignait le geste de l'autre mode, et un compteur de débit qui additionnait
  tout SAUF le travail terminé. Deux vues (Balance, Intendance) n'ont rien rendu
  — ce qui se rapporte aussi.

  **Quatre fichiers ont été balayés ENTIERS** : `Partage.tsx` (5/5),
  `Ruche.tsx` (16/16), `Memoire.tsx` (14/14) et `Reine.tsx` (24/24). Le chiffre de la Ruche
  vaut d'être isolé, parce qu'il mesure l'échantillonnage lui-même : un premier
  tirage de 8 candidates sur 16 n'avait rendu que **2** des 7 nues. La moitié du
  fichier regardée a trouvé moins du tiers. Un échantillon dit ce qu'il a vu ; il
  ne se multiplie pas par deux, et « 10 examinées sur 50 » ne veut pas dire
  « environ un cinquième des nues ».

  **Le Cerveau n'a plus AUCUNE nue éprouvable.** Les quatre qui restent vivent
  derrière `getContext`, et cette limite est MESURÉE, pas affirmée :
  `tests/canevas-hors-portee.test.tsx` éprouve que le contexte 2D rend bien
  `null` sous happy-dom. Elles ne seront jamais comptées closes.

  **L'état du terrain, en UN SEUL exemplaire.** Il vivait recopié à la fin de
  chaque entrée de `docs/ETAPES.md` — jusqu'à ce que
  `tests/documents-qui-grossissent` refuse la neuvième copie. Un carnet
  d'ÉTAPES raconte ce qui change ; un état se tient à un seul endroit, sinon
  c'est N copies à garder d'accord dont aucune ne se voit vieillir.

  | Vue        | Examinées          | Nues fermées |
  | ---------- | ------------------ | ------------ |
  | Partage    | **5/5 (balayé)**   | 2            |
  | Ruche      | **16/16 (balayé)** | 7            |
  | Memoire    | **14/14 (balayé)** | 6            |
  | Chantiers  | 11/21              | 5            |
  | Rayon      | 8/16               | 1            |
  | Miellerie  | 12/126             | 4            |
  | Balance    | 11/41              | 0            |
  | Intendance | 10/38              | 0            |
  | Reine      | **24/24 (balayé)** | 17           |

| Cerveau | 10/50 | 3 (4 hors de portée, mesurées) |
| Sante | 10/39 | 2 |
| Essaim | 12/46 | 1 |

Jamais balayées : `shared` (502), `MonEspace` (434), `Chronique` (400).

- ⚠️ **L'échantillonnage sur terrain déjà vu est ARRÊTÉ** (14 août). Huit
  tirages réguliers successifs, sur des terrains différents, ont tous rendu
  zéro survivant. Le critère d'arrêt avait été posé AVANT le huitième, et il
  est appliqué tel quel : un instrument qui ne discrimine plus n'apporte plus
  d'information. Les deux suites — un balayage COMPLET (~6 h 30 de machine par
  terrain) ou l'acceptation des chiffres ci-dessus — sont 👤 **une décision de
  l'utilisateur**. Par défaut c'est la seconde qui s'applique, parce qu'elle
  ne prétend rien.
- ⚠️ **La barrière LOCALE tournait sous Node 22** jusqu'au 14 août — la version
  que l'installeur refuse (le produit exige `>=24`). Aucun défaut n'est passé,
  la CI mesurant sous 24 sur chaque lot ; mais le filet a tenu parce qu'il n'y
  avait rien à attraper, pas parce que la barrière locale le garantissait
  (§ 9 duooctogies).

## B. On l'installe — ✅ mesuré, avec une réserve DITE

Les **10 critères mesurables de l'installation** (`docs/ETAPES.md § « Les 10
critères mesurables »`) sont tenus et éprouvés : `installer-assistant.test.ts`,
`installer.test.ts` (27 bancs), `deploiement-sans-ecran.test.ts` (8 bancs, loupe
7/7), `tui-terminal.test.ts`, `tui-rendu.test.ts`, `paquet.test.ts`. Mesure de
bout en bout : `sh install.sh` sur Node 24 dans un dossier vide → **23,3 s,
code 0**, `.env` en 0600, `hive doctor` rend **10 ✔** ; **3** décisions en
interactif, **0** avec `--non-interactive`.

### Le critère 1 par système — la seule formulation qui soit vraie

La phrase « marche sur les 3 OS » ne veut PAS dire ce qu'elle a l'air de dire.
La matrice à trois systèmes mesure que _le code compile et que les bancs
passent_. L'installation, elle, est une autre affaire, et elle se dit système
par système :

| Système     | Ce qui est mesuré                                          | Depuis quand             |
| ----------- | ---------------------------------------------------------- | ------------------------ |
| **Linux**   | ✅ installation → tableau → projet → invité → **travail**  | **16 août, à chaque PR** |
| **macOS**   | ✅ installation → tableau → projet → invité → **travail**  | **16 août, à chaque PR** |
| **Windows** | ✅ installation → tableau → projet → invité → **travail**¹ | **16 août, à chaque PR** |

### Le pas 7/7 — « la ruche produit », enfin mesuré en continu

Le parcours s'est arrêté six jours sur « un invité est dans la ruche », c'est-à-dire
juste avant **la seule chose que Hive promet** : qu'une ouvrière prenne un travail
et rende quelque chose. Le 16 août il va jusqu'au bout :

```text
✔ 7/7 — une tâche a été confiée, exécutée par node-b6666039…
        et rendue avec 187 signes de diff (ad53f149…)
```

`done` est DÉCLARATIF, et le pas ne s'en contente pas : il exige un résultat
RANGÉ, un SUCCÈS parmi eux, un DIFF non vide, et un nœud que la ruche CONNAÎT.

**Décision consignée : `HIVE_AGENT=shell` est FORCÉ sur les trois jambes.** Les
runners macOS et Windows n'ont pas de démon Docker ; laisser l'ouvrière détecter
un agent réel la ferait tourner dans un bac à sable absent, et la tâche
échouerait — non par défaut du produit, mais par absence d'un service que cette
jambe ne prétend pas mesurer. L'adaptateur simulé traverse la chaîne entière
sans lancer de processus, et c'est ce qu'un arrivant obtient sans clé d'API.

- ⚠️ **Ce que le pas 7/7 NE mesure PAS**, et qui doit se dire : la qualité de ce
  que produit un VRAI agent. Il prouve que la chaîne est entière — création,
  assignation, exécution, rangement, relecture — pas qu'un modèle écrit du bon
  code. La disponibilité du bac à sable, elle, est le sujet de `hive doctor`, où
  elle est mesurée depuis qu'un ✔ posé sur un CLIENT plutôt qu'un SERVICE y a été
  trouvé (§ 9 novemtrigicenties).

**Le parcours a été allongé le 15 août.** Les trois jambes s'arrêtaient à « la
ruche répond sur `/api/pulse` » — ce qui prouve l'orchestrateur et pas l'écran.
Elles mènent désormais les deux pas que le point de sortie classait sans aucune
mesure (3c) :

```text
✔ 4/5 — le tableau est servi et charge son paquet
✔ 5/5 — premier projet créé, et visible dans l'instantané que lit le tableau
```

Le pas 4 ne se contente pas d'un HTTP 200 : **quatre pages différentes rendent
200** et trois sont des écrans blancs — le repli « l'écran n'est pas construit »,
le gabarit de développement servi tel quel (il demande `/src/main.tsx`), et une
coquille sans script.

### ¹ Windows : ce que le pas 4 a trouvé à sa PREMIÈRE exécution

> **Cette ligne a d'abord été écrite `✅` pour les trois systèmes. C'était faux
> pour Windows, et faux au sens précis que ce document interdit : je l'ai écrite
> à partir du fait que le pas EXISTAIT, avant que la jambe Windows ne l'ait
> jamais joué.** Elle est corrigée ici par la mesure qui l'a démentie — run
> `31876399994`, travail `94992678231` :
>
> ```text
> ✔ 3/3 — la ruche répond sur :7777 après 1 s
> ✘ 4/5 — la ruche sert la page « l'écran n'est pas construit »
> ```

`install.ps1` **ne construisait pas le tableau de bord**, et ne l'a jamais fait :
`install.sh` a une étape « Construction de l'écran » depuis toujours, son jumeau
s'arrêtait à `install:hive`. Un arrivant sous Windows installait Hive, ouvrait
l'adresse, et lisait un mode d'emploi au lieu d'utiliser le produit — **le
premier écran de Hive sous Windows était une page d'excuses.**

Ce n'est pas une régression : ce chemin n'était exercé nulle part, puisque les
jambes de seuil s'arrêtaient avant. L'étape manquante est ajoutée, et une garde
de parité interdit qu'elle reparte (`tests/installeurs-jumeaux.test.ts`, vue
rouge sur le défaut vivant).

**La case est repassée `✅` sur la mesure, pas sur le correctif.** Il a fallu
deux tours de plus : le premier a construit l'écran et rendu les cinq `✔`, puis
`process.exit()` a fait abandonner libuv sous Windows (`Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)`) — le verdict était bon, la sortie non.
L'essai ne coupe plus la boucle. Run `31877154772`, travail `94994483745` :

```text
✓ built in 488ms
  ✔ tableau de bord prêt
✔ 1/3 — installation sortie en 0, 134 s
✔ 2/3 — .env écrit, port 7777 et jeton présents
✔ 3/3 — la ruche répond sur :7777 après 1 s
✔ 4/5 — le tableau est servi et charge son paquet
✔ 5/5 — premier projet créé (e0ab1d0b…) et visible par le tableau
```

Ni code 78, ni assertion : les cinq affirmations ont mordu. **Trois systèmes
mènent maintenant l'arrivant de la commande du README à son premier projet, à
chaque PR** — et le chemin Windows aura demandé cinq rouges successifs, chacun
un défaut réel que personne ne voyait.

**macOS a basculé le 14 août** (`seuil` devient une matrice, run
`31776537105`). Première fois que la commande du README y était menée à son
terme — nulle part auparavant, ni en CI ni sur une machine :

```
✔ 1/3 — installation sortie en 0, 9 s
✔ 2/3 — .env en -rw-------
✔ 3/3 — la ruche répond sur :7777 après 2s
```

**Windows a basculé le 15 août** (`scripts/essai-installation.ps1`, jambe
`seuil-windows`, run `31871739630`, travail `94981345140`) :

```
✔ 1/3 — installation sortie en 0, 115 s
✔ 2/3 — .env écrit, port 7777 et jeton présents
✔ 3/3 — la ruche répond sur :7777 après 1 s
```

Ni l'un ni l'autre n'est un code 78 (« non concluant », câblé pour le cas d'un
port déjà tenu) : les trois affirmations ont réellement mordu. La jambe Windows
a d'ailleurs rougi **trois fois avant** de compter — mojibake d'encodage,
apostrophe courbe fermant une chaîne, puis le fond —, ce qui est la preuve
qu'elle exécute vraiment le script et ne le survole pas.

- ¹ **Ce que la colonne Windows ne dit PAS, et qui n'est pas un détail** : la
  version POSIX vérifie que le `.env` est en **0600**. La jambe Windows ne le
  vérifie pas, parce qu'il n'y a rien à vérifier — Node n'y retient du `mode`
  que le bit « lecture seule », aucune ACL n'est posée. Le secret y est donc
  moins protégé qu'ailleurs. Écrire un contrôle qui passerait quand même aurait
  donné une couverture apparente sur une protection absente ; **fermer ce trou
  est un lot à part, qui touche l'installeur et pas son essai**, et il n'est pas
  fait.
- 🔒 **Ce qui reste une réserve, et qu'il ne faut pas maquiller** : un runner CI
  n'est pas le poste de bureau d'un utilisateur, avec ses réglages, son
  antivirus et son shell à lui. Trois systèmes mesurés en continu ne valent pas
  trois systèmes éprouvés chez de vrais arrivants — cette réserve-là ne se lève
  pas en CI, elle se lève à la sortie.

## C. C'est défendu — ✅ mesuré et gardé (le gate a mordu à sa naissance)

Livré et couvert par des bancs : **Les Gardiennes** (contrôle d'entrée du
nectar), les audits adversariaux de nuit, les failles fermées (injection Hive
Mind, secret de session `HIVE_JWT_SECRET`, import d'un chemin absolu sous
Windows).

- ✅ **Gate câblé** : `npm audit --audit-level=high` est désormais une étape de
  la CI (jambe `ubuntu`, `.github/workflows/ci.yml`). Il a trouvé **2 vulns
  hautes le jour où il est né** — `brace-expansion` (DoS, `GHSA-rgw5-rvv9-x895`)
  et `fast-uri` (host confusion, `GHSA-7p8r-x3mc-p8w7`), toutes deux
  transitives —, fermées par `npm audit fix` (`package-lock.json` seul). Mesure
  après fix : **0 vulnérabilité**. Coût assumé et voulu : un avis publié demain
  sur une transitive rougira la CI sans changement de code — une vuln haute qui
  dort est pire qu'une CI qui la nomme.
- ⚠️ **L'angle mort du DÉCLENCHEUR, et comment on le couvre** : ce gate ne tourne
  qu'à l'ouverture ou la mise à jour d'une PR. Un avis publié ENTRE deux
  livraisons reste donc invisible en CI jusqu'au prochain push. Ce n'est pas une
  vue de l'esprit : `nanoid` < 3.3.17 (boucle infinie quand `size` vaut zéro,
  `GHSA-2v37-7h3g-55p8`) est tombé après le câblage, et c'est un `npm audit`
  **local** périodique — pas la CI — qui l'a attrapé et fermé (#196). Leçon
  générale : câbler une garde ne suffit pas si son **déclencheur** ne couvre pas
  tous les moments où le risque survient. Tant qu'aucune exécution **planifiée**
  ne double ce gate, « gardé » vaut **à la livraison** ; entre deux livraisons,
  ça tient à l'habitude d'auditer localement.

## D. Couverture — ❌ pas un critère, mais enfin RE-MESURÉE et REPRODUCTIBLE

**Le trou trouvé et fermé ce tour :** `npm run couverture` (`vitest run
--coverage`) exige un fournisseur, `@vitest/coverage-v8`, qui est une dépendance
de pair **optionnelle** de vitest — il n'entre PAS avec lui. Il n'était **pas
déclaré** dans `devDependencies` ; un `npm ci` propre ne l'installait donc
jamais, et la commande mourait sur `MISSING DEPENDENCY  Cannot find dependency
'@vitest/coverage-v8'`. Le « re-mesurée et reproductible » du commit `70cd3ad`
tenait à un reliquat dans `node_modules`, pas à une dépendance déclarée : depuis
un clone vierge, l'instrument ne se relançait pas. Corrigé : le fournisseur est
désormais **déclaré** (`@vitest/coverage-v8` en `devDependencies`) et **gardé**
par un banc (`tests/couverture-reproductible.test.ts`, muté rouge : il lie le
fournisseur déclaré au `provider` de `vitest.config.ts` et exige qu'il se
résolve).

**Mesure datée (22 août 2026, arbre `679fde8` + ce lot) :**

| Dimension    | Couverture  | Détail          | 15 août |
| ------------ | ----------- | --------------- | ------- |
| Lignes       | **78,08 %** | 11 091 / 14 204 | 76,97 % |
| Branches     | 72,76 %     | 9 286 / 12 761  | 71,88 % |
| Fonctions    | 79,21 %     | 2 748 / 3 469   | 76,43 % |
| Instructions | 76,66 %     | 12 611 / 16 449 | 75,81 % |

> **CE TABLEAU AVAIT CESSÉ D'ÊTRE UNE MESURE, ET IL A FALLU LE POINT DE SORTIE
> POUR LE VOIR.** La colonne du 15 août portait 12 321 lignes ; l'arbre en porte
> 14 204. Ce ne sont pas les COUVERTS qui avaient bougé, ce sont les
> DÉNOMINATEURS — le tableau décrivait un dépôt plus petit que celui qui
> existait. Daté, il restait faux, exactement comme le tableau A l'avait été le
> 16 août. La date ne périme rien toute seule.
>
> Le cliquet, lui, était resté sur la mesure du 15 : 75,7 / 71,7 / 76,3 / 76,8,
> soit jusqu'à 2,9 points SOUS le réel. Il ne mordait plus. **Un cliquet qui ne
> mord plus n'est pas un cliquet, c'est un chiffre**, et il laissait éroder en
> silence tout ce qui séparait les deux. Il est remonté sur la mesure.

### ✅ LE SEUIL EST CÂBLÉ — un cliquet, mesuré et exercé

C'était le dernier gate manquant du point de sortie (3e) : « sans cible qui
rougit d'elle-même, "couvert" n'est pas un critère, c'est une anecdote ». Il
manquait DEUX choses, et n'en avoir qu'une aurait laissé du décor :

1. **des seuils** dans `vitest.config` — posés sur la mesure, pas sur un chiffre
   rond. Un seuil sous la mesure laisse éroder en silence ;
2. **une exécution** qui les atteigne. La CI lançait `npm test` sans
   `--coverage` : le seuil aurait été écrit et jamais exercé. Le drapeau est
   désormais posé sur la jambe `ubuntu`, dans le MÊME pas que les tests — le
   rejouer entier pour le mesurer doublerait la jambe la plus longue.

**Le gate a été vu rougir avant d'être cru** — seuil des lignes monté d'un
dixième :

```text
ERROR: Coverage for lines (76.97%) does not meet global threshold (77.07%)
CODE=1
```

⚠️ **Et il a rougi une seconde fois, pour de mauvaises raisons.** Posés d'abord
à l'ÉGALITÉ sur la mesure locale, les seuils ont fait rougir la CI sur deux
centièmes de point : la couverture n'est pas reproductible d'une **machine** à
l'autre (branches 7774 ici / 7772 en CI, mêmes dénominateurs), parce que des
bancs ne tournent que si un outil est présent. Deux passages locaux successifs,
eux, rendent des chiffres identiques — le tremblement est entre machines, pas
entre tours. Les seuils portent donc une marge d'environ **0,1 point**, annoncée
comme provisoire tant que ce tremblement n'est pas caractérisé sur plusieurs
runners (§ 9 septdecicenties).

**La règle : ce seuil MONTE et ne descend pas.** S'il faut le baisser — un
retrait de code bien couvert peut légitimement faire tomber le pourcentage — la
raison s'écrit dans `vitest.config`, à côté du chiffre. Le baisser en silence
pour faire passer un lot rendrait l'anecdote à sa place de critère.

- ⚠️ **Ce que ce gate NE dit pas.** La couverture mesure ce qui est EXÉCUTÉ,
  jamais ce qui est GARDÉ : une ligne traversée par un banc sans assertion y
  compte pour couverte. Le verdict qui juge la garde reste le balayage par
  mutation (`npm run loupe`). Les deux sont complémentaires et aucun ne remplace
  l'autre.

## E. Présentable — ❌ / 🔒 / 👤 : ce qui n'est pas du code

- 👤 ❌ **Identité visuelle de la vitrine** (#63, 13→7 sections) : la première
  impression d'un arrivant. Décision d'édition de l'utilisateur — la page
  publique ne se reskine pas de tête. Non atteint.
- ❌ **README GitHub au design de la vitrine** : la première impression côté
  dépôt, en aval de #63. Non atteint.
- ✅ / 🔒 **Empreintes des installeurs (lot 8, moitié)** : Pages publie
  `install.sh`, `install.ps1` et `install.sha256` ; README / INSTALLATION /
  ADR 0002 (amende 21 août) montrent la variante télécharger → hasher → lire.
  **Mesuré** (`tests/site-installeurs`, CI Pages). Une **Release GitHub
  signée** reste 🔒 (comptes humains) — le manifeste Pages ne remplace pas un
  tag signé.
- 🔒 **Paquet npm signé** (lot 7), **image officielle GHCR + `cosign`** (lot 10) :
  pas mes comptes ni mes clés. `curl … | sh` depuis le dépôt marche sans eux ;
  « `npm i -g` » et « `docker pull` » d'un artefact officiel restent une décision
  et des identifiants humains.
- 👤 **Tarifs de la vitrine** : décision commerciale de l'utilisateur.

## Verdict honnête

Le **code**, l'**installation** (en CI) et le **socle de sûreté** — désormais
gardé par `npm audit --audit-level=high` en CI — sont mesurés et tenus. L'empreinte
Pages des installeurs est posée ; la Release signée non. Ce qui manque encore à
une sortie « présentable » n'est pas du code produit : c'est **(1)** une identité
de vitrine tranchée, **(2)** des artefacts publiés sous des comptes qui ne sont
pas les miens. **Le troisième manque — le seuil de couverture non câblé — est
fermé le 15 août** : seuils posés sur la mesure, exercés par la CI, et vus
rougir. Aucun des manques restants n'est caché derrière un ✅.
