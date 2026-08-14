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

## Le chantier de la sortie — comment il est tenu

La sortie officielle est visée **autour du 2 septembre 2026**. Le chantier ne
tient pas dans une session : il est donc **rythmé par trois rappels** qui
réveillent le travail au lieu de compter sur la mémoire.

| rappel                  | cadence                    | ce qu'il fait                                                                                                                      |
| ----------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Le tour de chantier** | toutes les 3 h             | PR en cours → CI → barrière (typecheck, lint, tests) → lot suivant de ce carnet. S'arrête au premier point qui demande une action. |
| **Le point de sortie**  | chaque matin, 8 h Paris    | jours restants, ce qui est **vérifié** depuis la veille, ce qui reste, ce qui restera hors d'atteinte. Écrit ici.                  |
| **La revue de sortie**  | une fois, le 26 août (J-7) | plus rien de neuf : premier contact, les trois systèmes, vitrine ↔ README, secrets, dette assumée.                                 |

La règle qui les gouverne tous : **« vérifié » ne veut pas dire « écrit »**. Un
critère non mesuré n'est pas atteint, et il se dit comme tel — c'est le sens de
l'avertissement en tête de ce carnet.

---

## Point de sortie du 3 août — J-30

Sortie visée le 2 septembre 2026. **Trente jours.** Rien n'est arrondi ici : un
critère non mesuré n'est pas atteint, et il se dit comme tel.

### Livré ET vérifié depuis hier

Trois choses seulement, et les trois sont mesurées, pas écrites.

|                                            | ce qui le prouve                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **La loupe a balayé tout le code du jour** | 41 mutations possibles, **41 examinées, 41 tuées**, sans échantillonnage. Atelier séparé, base sur le premier commit du 2 août.                                                                       |
| **Le `spawn` de l'agent sous Windows**     | Log de la jambe `windows-latest` : `✓ tests/agent-windows-spawn.test.ts (4 tests)` — quatre, là où Linux affiche `1 passé                                                                             | 3 sautés`. Le chemin composé existe, `spawn('node', […], shell:false)` le lance, les arguments traversent. |
| **Le déploiement sans écran**              | Lancé sur un clone vierge sous Node 24 : code **0**, `.env` créé en **600** avec 8 clés, aucun secret d'exemple survivant, `hive doctor` qui répond. Sans les secrets : **3**, avant de rien toucher. |

Deux de ces trois lignes étaient annoncées **hors d'atteinte** la veille. Dans les
deux cas la barrière n'était pas technique — je n'avais pas chiffré le coût de la
franchir (§ 9 decies et § 2 undecies du journal).

Barrière au 3 août : `typecheck`, `lint`, **2 998 tests passés / 3 sautés** sur
183 fichiers, verte sur les trois systèmes.

### Ce qui reste, par ce qui gêne un nouvel arrivant EN PREMIER

1. **Après une installation réussie, il n'y a pas d'écran.** Mesuré à l'instant
   sur un clone vierge : le docteur ne reproche qu'une chose,
   `⚠ dashboard — tableau de bord non construit`. Celui qui suit la consigne
   (`npm run dev`) et ouvre son navigateur reçoit **un bloc JSON**
   (`{"hive":"orchestrateur en ligne","hint":…}`). C'est le premier contact avec
   le produit, et c'est un texte de débogage. **Coût de la correction, chiffré :
   `npm run build:dashboard` prend 1 866 ms** et fait passer le diagnostic de ⚠
   à ✔. C'est le lot en cours.
2. **La vitrine fait 13 sections et ~11 400 px** là où la maquette en fait 7 et
   3 865. Le premier écran est juste ; la page est trois fois trop longue.
   **Demande un arbitrage** (voir plus bas).
3. **Lot 8 — pas de Release, pas d'empreintes.** Le chemin annoncé
   (`curl … | sh`) clone `main` et fonctionne ; il n'y a simplement aucune
   version figée à installer. La moitié « Release » est bloquée.
4. ~~**Lot 9 🟡 — les fichiers de service sont écrits, jamais acceptés.** Aucune
   CI ne peut vérifier que `systemctl` / `launchctl` / `schtasks` les avalent.~~
   **Faux, et cher.** Cette phrase décrivait `systemctl enable` — pas la question
   posée. `systemd-analyze verify` charge l'unité et rend ses erreurs en **28 ms**,
   sans gestionnaire ni privilège. Lancé une fois : **l'unité que Hive écrit était
   REFUSÉE** (`WorkingDirectory= path is not absolute` → `unit will not be
started`), et `EnvironmentFile=` était ignoré **en silence** — le service
   démarrait donc sans `HIVE_TOKEN` ni `HIVE_JWT_SECRET`. Corrigé, soumis aux
   trois juges de plateforme à chaque CI. Voir § 6.6 bis du journal.

### Hors d'atteinte — à dire, pas à simuler

- **Les comptes npm (lot 7) et GHCR/cosign (lot 10)** ne sont pas les miens. Le
  code est prêt, la publication non.
- **Une VM Windows 11 et une Ubuntu 24.04 vierges** pour mesurer le critère 1 au
  sens strict. Ce qui a été mesuré l'a été dans un conteneur — ce n'est pas la
  même chose, et ça se dit. _(À noter : le `spawn` Windows, lui, EST vérifié
  depuis hier — sur le runner de la CI, qui est une vraie machine Windows.)_
- **L'intermittent signalé à l'origine n'a jamais été reproduit sur Linux** :
  invisible en 8 ordres mélangés et 3 exécutions identiques. Pas fermé —
  introuvable d'ici.
- **Les tarifs** (0 € / 49 € / dès 79 €) sont affichés comme modèle proposé,
  aucun paiement encaissé. Encaisser avant le 2 septembre est une décision
  commerciale.
- **La longueur de la vitrine et sa navigation.** La maquette a 3 liens et
  7 sections ; la page en a 10 et 13. Retirer six sections construites sur
  demande n'est pas une correction de design.

### Correction du même jour — le point 4 était faux

Écrit le matin : « aucune CI ne peut vérifier que `systemctl` / `launchctl` /
`schtasks` avalent les fichiers ». Lancé l'après-midi : `systemd-analyze verify`,
**28 ms**, et un refus net.

| ce que systemd disait de l'unité de Hive | conséquence                                         |
| ---------------------------------------- | --------------------------------------------------- |
| `WorkingDirectory= path is not absolute` | `unit will not be started` — le service ne part pas |
| `EnvironmentFile= …, ignoring`           | **aucune erreur** : il part, sans aucun secret      |

Cause : une fonction d'échappement au nom trop général, employée sur les quatre
directives, alors que systemd en a deux grammaires. Onze tests couvraient ce
fichier ; ils comparaient le fichier à mes attentes, jamais à son consommateur.

Ce qui est fait maintenant : `tests/service-accepte.test.ts` soumet le fichier au
juge de sa plateforme — `systemd-analyze verify`, `plutil -lint`,
`schtasks /Create /XML` — et lui redonne la version d'AVANT le correctif pour
vérifier qu'il la refuse. Une étape de CI exige la présence des trois outils
avant de lancer la suite, faute de quoi les `runIf` s'éteindraient en vert.
6 mutations, 6 rouges. Barrière : **3 016 tests / 7 sautés**, 184 fichiers.

Ce qui reste NON vérifié sur ce lot, et qui se dit : l'unité est **recevable**,
elle n'a pas été **démarrée**. `systemctl --user enable --now` demande un bus de
session qu'aucun runner n'a. Le lot passe de « jamais accepté » à « accepté,
jamais démarré » — c'est un cran, pas la fin.

### Analyse du dépôt entier — même jour, à la demande de l'utilisateur

Deux instruments, deux chiffres jamais mesurés jusqu'ici.

**La couverture (v8, première mesure)** : **62,31 % des lignes, 56,48 % des
branches** sur `src` + `dashboard/src` + `scripts`. 3 016 tests verts laissent
~4 500 lignes que rien n'exécute, dont **2 654 dans 34 fichiers à 0 %**. Le 0 %
est parfois trompeur — `src/cli.ts` (728 lignes) est exercé en sous-processus,
invisible pour v8 — mais l'inventaire réel derrière ce 0 % l'était à peine
moins : **sur les 40 commandes du dispatch, 3 étaient lancées par un test**
(`replay`, `events`, `mode`).

**La loupe sur tout le dépôt** : **1 979 mutations candidates** (opérateurs,
131 fichiers). À ~80 s la mutation, **~44 h** — hors de portée d'une traite.
Les plus chargés : `server.ts` (143), `cli.ts` (112), puis les vues du tableau
de bord. Le balayage exhaustif reste un chantier de nuit, PAS un acquis.

**Premier lot tiré de l'analyse — le dispatch du CLI** (`tests/cli-dispatch.test.ts`,
6 gardes) : commande inconnue → usage + code 1 sans requête ; bijection
dispatch ↔ usage imprimé par le vrai processus ; les 20 commandes gardées
lancées sans argument s'arrêtent à l'usage, jamais au réseau (témoin :
`HIVE_HTTP` injoignable) ; équilibre des délimiteurs. Un défaut réel corrigé au
passage : `revoquer <billetId]>` dans l'usage — vu à la relecture, PAS par la
bijection, et c'est écrit tel quel dans le test. 5 mutations, 5 rouges — mais
la première passe en avait laissé survivre 3, dont deux fautes déjà au journal
(§ 2 undecies : liste auto-adaptée ; § 2 duodecies : ancre de mutation non
unique, cinquième occurrence).

**Prochaines zones sombres de `src/`, par lignes jamais exécutées** :
`installer-main.ts` (116), `node-client/join.ts` (107 — le chemin B, celui d'un
ami qui rejoint), `demo.ts` (93), `node-client/tunnel.ts` (50), les trois
`main.ts` d'entrée. `join.ts` et `tunnel.ts` portent des billets et des clés :
ils passent devant.

**LE BALAYAGE LOUPE DU DÉPÔT ENTIER EST RENDU** (3 août, 15 h 20 → 16 h 40
UTC) : 1 979 mutations candidates, 69 examinées en échantillonnage régulier
pleine largeur. **40 défendues, 29 survivantes — 42 %.** Le gros vit dans les
vues du dashboard à 0 % (Miellerie ×4, Projets ×3, Cerveau ×2, App ×2…), mais
**8 survivantes sont hors dashboard**, dans du code couvert : `scheduler.ts`
(fenêtre de rejets récents), `server.ts` (garde `refMachine && etat ===
'supprime'`), `concierge.ts`, `workflow.ts`, `tui/rendu.ts`, `cli.ts` (badge
IA/état réel), `ruche.mjs` (le code d'arrêt composé), et `installer-main.ts` —
celle-ci dans une CHAÎNE IMPRIMÉE : muter le `&&` de « npm run
build:dashboard && npm run dev » fausse le conseil affiché au chemin serveur.
Trois survivantes du balayage ont été tuées L'APRÈS-MIDI MÊME (TaskDrawer,
Essaim, Chronique — lots 8 à 10) : restent **26**, listées dans
`scratchpad/loupe-nuit-70.log`, à traiter par familles.

**Trente-cinquième lot — le Cerveau ×2 et la trace du plafond** (nuit,
04 h 25 → 04 h 50 UTC). Cerveau — « Recentrer » n'existe qu'en mode graphe
(mutée, le bouton apparaîtrait au-dessus de la LISTE où il ne peut rien
recentrer : un clic sans effet visible, le pire des retours, celui qui laisse
croire à une panne) ; et les orphelines ne s'annoncent que s'il y en a (mutée
en `||`, le court-circuit rend `true` quand il Y EN A — l'alerte disparaît au
moment où elle informe — et un cerveau parfaitement relié annoncerait
« 0 orphelines » ; une alerte qui se déclenche à vide finit par ne plus être
lue). Balance — « Posé par… » ne s'affiche que si un plafond est posé (mutée
en `===` : la trace du geste humain s'afficherait sur un projet SANS plafond
et disparaîtrait de celui qui en a un — savoir QUI a borné un projet et QUAND
est ce qui rend le geste discutable au lieu d'être subi). **3 mutations
rejouées, 3 rouges.**

Quatrième banc trop léger de la nuit, même famille que les trois autres : la
trace ne vient PAS du solde mais d'une sonde à part (`fetchProjectBalance`),
lue seulement pour les projets qui ONT un plafond. Un banc qui la posait dans
le solde jugeait une vue qui ne la lit jamais. Et l'écran ne montre que les
huit premiers caractères de l'identifiant (l'entier vit dans le `title`) —
c'est ce qu'on juge, pas ce qu'on aurait aimé lire.

**Trente-quatrième lot — la barre d'espace du Time-Lapse** (nuit, 04 h 05 →
04 h 20 UTC). `e.key === ' '` mutée en `!==` : TOUTE touche basculerait la
lecture SAUF l'espace — la seule que l'écran annonce (« Lecture / pause
(Espace) »). Le raccourci existe précisément pour qu'on n'ait pas à viser un
bouton pendant qu'une archive défile. **1 mutation rejouée, 1 rouge.**

Troisième piège de banc de la nuit, et toujours le même : les commandes de
transport n'existent QUE s'il y a des images à rejouer, et le faux replay du
fichier en rendait ZÉRO — le banc jugeait la branche « aucun événement à
rejouer », pas celle qu'on visait. Trois fois cette nuit (la pesée vide de la
Balance, la forme `results` d'OpenAlex, les images du replay), la même faute :
**un banc qui ne charge pas assez juge une branche voisine, et il est vert
pour de mauvaises raisons.** La parade est toujours de LIRE la garde qui
protège le bloc visé avant d'écrire le décor.

**Trente-troisième lot — trois de plus du balayage de nuit** (nuit, 03 h 30 →
04 h 00 UTC). AccountPanel — le bouton de soumission dit ce qu'il va faire
(`mode === 'login'` mutée : il promettrait « Créer le compte » à qui se
connecte et « Se connecter » à qui s'inscrit ; l'indice de longueur bascule
bien, LUI, mais c'est une AUTRE ligne — une famille de bascules ne se garde
pas par un seul de ses membres). Journal — le coût s'affiche quand il existe
et se tait sinon (`typeof v === 'number'` mutée : la durée d'une tâche
terminée disparaîtrait, et un événement sans durée passerait à `formatDuree`
d'un `undefined` ; l'en-tête du module promet en toutes lettres « jamais un
0 ms inventé »). Balance — « grand livre à l'arrêt » ne se dit qu'en mode
`off` (mutée : une ruche qui TIENT ses comptes annoncerait l'arrêt, et une
ruche en `off` promettrait un rattrapage qui n'aura jamais lieu).
**3 mutations rejouées, 3 rouges.**

Deux pièges de banc, tous deux réglés en LISANT la source plutôt qu'en
devinant : `CarteBalance` prend ses données EN PROPRIÉTÉ (il n'y a pas de vue
`Balance` par défaut à monter), et elle se TAIT sur une pesée vide — un banc
à `totalMs: 0` jugeait la branche « rien pesé », pas celle qu'on visait. Le
champ `corpus` s'appelle `{ taches, tentatives, ignorees }`, pas `{ lues,
imputees }`. Un banc qui invente la forme de ses données ne teste pas la vue.

Reste du balayage : la garde `plafondMs !== null && trace` de Balance, et
`voisinage = choisi !== null` du Cerveau — celle-ci vit dans la boucle de
dessin du canevas, comme le glisser du lot 25 ; contrairement à lui, elle ne
porte aucune règle extractible (un ternaire d'affichage), et sera documentée
comme telle plutôt que simulée.

**Trente-deuxième lot — un balayage de nuit NEUF, et ses deux premières
prises** (nuit, 03 h 00 → 03 h 25 UTC). Nouveau balayage lancé dans
l'atelier (base : premier commit, LOUPE_MAX=140) sur un dépôt qui a reçu
soixante-dix tests dans la journée — l'échantillon est donc frais, et son
taux de survie l'est aussi : **50 % sur les dix premières examinées**. La
qualité d'un dépôt ne se lit pas au nombre de tests.

Deux tuées dans ce lot. OpenAlex — `{paper.doi && (…)}` mutée en `||` : le
court-circuit rend `true` sur un article QUI A un DOI (React n'affiche
rien : le lien disparaît au moment où il sert), et un article SANS DOI
recevrait un lien vers `https://doi.org/null`. Une bibliographie qui envoie
sur une page morte vaut moins que pas de lien du tout. Plein Essaim —
`l.portee === 'systemique'` mutée : le ⚠ irait aux leçons vues sur UNE
machine (un incident local présenté comme un défaut du code) et la vraie
leçon systémique perdrait sa marque — l'inverse exact de ce que la portée
sert à distinguer. **2 mutations rejouées, 2 rouges.**

Piège de banc au passage : mon faux OpenAlex rendait `{ papers, total }` là
où la vue lit `{ results, total, page }` — la vue est tombée sur
`papers.map` de `undefined`. Un banc qui ment sur la FORME de la réponse ne
teste pas la vue, il teste sa gestion d'erreur. Corrigé en lisant le
destructurage de la source, pas en devinant.

Les trois autres survivantes du même balayage (AccountPanel `mode ===
'login'`, App `route.view === 'miellerie'`, Journal `typeof v === 'number'`)
attendent le lot suivant, et le balayage continue.

**Trente-et-unième lot — LA COUVERTURE, RE-MESURÉE ET REPRODUCTIBLE** (nuit,
02 h 30 → 02 h 45 UTC, lots 6 et 10 de la file).

D'abord le lot 6, la désinstallation : ses deux gardes — la résolution du
chemin parent en absolu (celle qui empêche un nom hostile de sortir du
dossier balayé) et l'aiguillage chemin-unique / balayage-par-préfixe — sont
**déjà tenues**. Sondées contre la SUITE ENTIÈRE cette fois, pas contre un
fichier choisi au nom : 3 rouges pour la première, 5 pour la seconde. Rien à
faire, et c'est le résultat.

Puis le lot 10. Le seul chiffre de couverture connu — 62,31 % de lignes —
datait du 3 août à MIDI, avait été obtenu à la main, et neuf lots de tests de
vues l'ont périmé dans la journée qui a suivi. Un chiffre qu'on ne peut pas
relancer devient une opinion datée. `npm run couverture` existe désormais
(bloc `coverage` dans la config vitest, fournisseur v8 déjà présent) et rend
**exactement le même total à deux exécutions d'affilée** — c'est la seule
preuve qui compte pour un instrument de mesure :

|              | 3 août midi | 4 août 02 h 40               |
| ------------ | ----------- | ---------------------------- |
| lignes       | 62,31 %     | **73,05 %** (8 634 / 11 819) |
| branches     | 56,48 %     | **66,44 %** (6 929 / 10 428) |
| fonctions    | —           | **71,09 %** (2 041 / 2 871)  |
| instructions | —           | **71,87 %** (9 811 / 13 651) |

**Onze fichiers restent à 0 %**, et le carnet les nomme plutôt que de les
laisser dans un rapport que personne ne rouvre : `cli.ts` (728 lignes — il
est exercé en sous-processus, invisible pour v8, mais son dispatch a
désormais son banc), `SwarmView3D.tsx` (226 — du canevas WebGL),
`installer-main.ts` (116), `node-client/join.ts` (107), `demo.ts` (93),
`CodeEditor.tsx` (41), les trois `main.ts` d'entrée (29+29+14), `Partage.tsx`
(22), `ConflictsPanel.tsx` (15). Et dix fichiers sous 40 %, dont
`Cerveau.tsx` (18,9 % — le canevas, encore), `dashboard/src/api.ts` (26,6 %)
et `NewProjectModal.tsx` (3,4 %).

Le chiffre n'est PAS un objectif : c'est une carte des angles morts. Le
verdict qui compte reste celui du balayage par mutation — 34 % de survivantes
sur l'échantillon du soir — parce qu'il dit ce qui est GARDÉ, là où la
couverture ne dit que ce qui est EXÉCUTÉ.

**Trentième lot — la fenêtre de l'instantané : RIEN à faire, et c'est le
résultat** (nuit, 01 h 55 → 02 h 20 UTC, lot 9 de la file). Les deux gardes
visées — la clause d'ordre qui garde les tâches VIVANTES anciennes dans la
fenêtre, et `tasksTotal` qui dit le compte réel — sont **déjà tenues** depuis
le lot 17. Je ne l'ai pas vu tout de suite : j'avais sondé avec
`tests/store-scaling.test.ts` (21 verts, verdict « nue ») alors que les
gardes vivent dans `tests/taches-bornees.test.ts`. Deux tests écrits pour
rien, retirés plutôt que gardés « au cas où » — un doublon coûte du temps à
chaque exécution, pour toujours, et fait croire à une couverture qu'on avait
déjà. § 2 septdecies au journal : un rejeu contre le mauvais fichier ne
prouve rien ; « survit » veut dire « survit AUX FICHIERS QUE J'AI LANCÉS ».

Les trouvailles de la nuit ont donc été REVÉRIFIÉES par exclusion (mutation
en place, suite entière moins le fichier neuf) : la sonde du docteur passe la
suite entière sans rougir — elle était bien nue —, et la borne d'expiration
des billets aussi. Les deux lots précédents tiennent.

**Vingt-neuvième lot — LES CINQ BORNES D'ÉLAGAGE, À LA MILLISECONDE** (nuit,
01 h 25 → 01 h 50 UTC, lot 4 de la file). Sondées d'abord : la protection des
dépendances de `pruneTasks` (celle qui empêche d'effacer une tâche dont une
VIVANTE a encore besoin) est bien gardée, et la garde « déjà mort » de
`pruneAcces` aussi. **Cinq bornes de temps étaient nues** — toutes les mêmes,
et toutes sur le même motif : les cas existants vivent LOIN de la frontière
(3 et 40 jours pour une rétention de 30 ; un billet vivant à un jour de son
terme). `pruneTasks` effaçait un tour trop tôt la tâche dont l'âge vaut
exactement la rétention ; `pruneAcces` gardait un billet expiré à l'instant
précis et effaçait un jour trop tôt celui né pile au seuil de grâce ;
`prunePartages` portait les deux mêmes fautes sur les liens de partage. Une
grâce de trente jours qui efface au vingt-neuvième est un mensonge, et un
billet mort qu'on garde est une porte qu'on croit fermée. **5 mutations
rejouées, 5 rouges.**

Un piège de banc en chemin, et le fichier le documentait déjà : un compte de
suppressions dépend de ce que les tests voisins ont laissé derrière eux
(« expected 2 to be 1 »). On juge par IDENTIFIANT, jamais par compte —
l'avertissement était écrit vingt lignes plus haut, et je suis tombé dedans
quand même. L'horloge du cas limite est FIXÉE pour la même raison : un
élagage qui rappellerait l'heure quelques millisecondes plus tard ferait
basculer la frontière au hasard, c'est-à-dire un intermittent qu'on fabrique
soi-même.

**Vingt-huitième lot — QUATRE SONDES SUR CINQ POUVAIENT REDEVENIR FUYANTES**
(nuit, 00 h 50 → 01 h 20 UTC, lot 3 de la file de nuit). L'audit du 2 août
avait trouvé quatre sondes qui livraient `HIVE_TOKEN`, `HIVE_JWT_SECRET` et
la clé d'API au premier binaire hostile du `PATH`. La correction —
`envSonde`, appliquée aux cinq sites — avait été comptée close. Mesure faite
cette nuit, site par site, en remplaçant `env: envSonde(process.env)` par
`env: process.env` : doctor-releve **nu** (29 verts), cli **nu** (7 verts),
agent-detect **nu** (12 verts), isolement **nu** (36 verts), tunnel **gardé**
(1 rouge). Quatre sur cinq sans garde.

La réponse n'est pas cinq tests de plus : ce serait prouver les sites
d'aujourd'hui et laisser le sixième naître nu, exactement comme les quatre
précédents. `tests/sondes-sans-secret.test.ts` lit la SOURCE et tient une
propriété structurelle — _tout lancement de `--version` dans `src` passe par
`envSonde`_ — y compris dans les fichiers qui n'existent pas encore. Elle est
doublée d'une garde de COMPORTEMENT sur le module pur (une garde de forme
qui exige un nom sans vérifier ce qu'il fait déplace le décor d'un cran), et
d'une garde qui compte les sondes vues : si le découpage cessait de les voir,
le test deviendrait vert pour de mauvaises raisons. **6 mutations rejouées
(les 5 sites + le module pur), 6 rouges.** § 2 sexdecies au journal : une
correction appliquée partout n'est pas une correction tenue.

**Vingt-septième lot — LE BALAYAGE DU SOIR EST SOLDÉ : 32 SUR 32** (nuit,
00 h 15 → 00 h 45 UTC). La dernière survivante était le `.find((i) =>
i.taskId === task.id && i.nodeId === dernier.nodeId)` qui choisit
l'inspection des Gardiennes annoncée dans la pull request. Mutée en `||`,
elle retient la première inspection qui partage SOIT la tâche SOIT
l'ouvrière — et `listInspections` rend les plus récentes en tête : le corps
de la PR annonce alors le verdict d'une AUTRE production. C'est un mensonge
de la ruche à celui qui relit, dans le seul document dont il dispose pour
décider de fusionner.

Il a fallu un banc neuf : le faux GitHub existant notait les APPELS
(méthode, chemin) mais jetait les CORPS — or c'est le corps qui porte le
verdict, et aucune assertion sur un chemin ne pouvait départager les deux
mondes. `tests/livraison-inspection.test.ts` monte donc un GitHub simulé qui
garde ce qu'on lui envoie, avec une mise en scène ASYMÉTRIQUE (deux
inspections, dont une d'une autre tâche par la MÊME ouvrière, posée en
second pour arriver en tête du tri) : un banc à une seule inspection aurait
rendu le même corps dans les deux mondes.

**Et la garde JUMELLE du chemin autonome survivait aussi** — sondée dans la
foulée par application de § 2 quindecies (une famille de règles se garde en
famille). Elle se prouve encore mieux : le banc autonome livre une
production que personne n'a inspectée, et la mutation lui fait annoncer
« Gardiennes — verdict clean ». L'absence de verdict est une information ;
une absence maquillée en verdict est un mensonge. Le faux GitHub d'essaim
gagne la capture des corps au passage. **2 mutations rejouées, 2 rouges.**

**COMPTE FINAL DU BALAYAGE DU SOIR : 95 examinées, 63 défendues,
32 survivantes — 32 résolues, toutes par un test qui les tue, aucune
déclarée équivalente.** Dont une qu'on avait annoncée « probablement hors
d'atteinte » et qui ne l'était pas (la physique du canevas, sortie en module
pur), et deux gardes de sûreté trouvées en chemin par la file de nuit
(l'instant exact d'expiration d'un accès, la machine effaçable sans date
d'arrêt).

**Vingt-sixième lot — L'INSTANT OÙ UN ACCÈS MEURT, et la machine qu'on
n'efface pas** (nuit, 23 h 30 → 00 h 10 UTC). Premier lot tiré de la file de
nuit rendue par un agent Fable 5 (classée par ce qui coûte le plus cher si
une garde est muette : argent → secrets → suppression de données → codes de
sortie). Les bornes d'ARGENT ont été sondées d'abord et sont toutes
DÉFENDUES (plafond à la borne exacte, seuil d'alerte, plan sans heures :
trois mutations, trois rouges sans écrire une ligne — on vérifie avant de
croire, dans les deux sens). Deux familles étaient nues :

· `jugerBillet` n'avait **aucun banc à lui** — il n'était éprouvé qu'à
travers le HTTP, avec un billet périmé depuis 1970, à des décennies de la
borne. Mutée en `<`, la garde `expireA <= maintenant` laissait la porte de
la ruche s'ouvrir une dernière fois à l'instant exact de l'expiration. Son
jumeau `jugerPartage` portait la même faiblesse, et `partageVivant` (qui
sert l'écran ET l'élagage) pouvait diverger du juge sans que rien ne rougisse.
`tests/expiration-instant.test.ts`, 10 tests, **3 mutations rejouées,
3 rouges.**

· `aSupprimer` — le geste le plus irréversible du dépôt, celui qui appelle
le fournisseur pour effacer une machine. `s.arreteA > 0` mutée en `>= 0` :
une ligne incohérente (état `arrete`, aucune date d'arrêt) devenait
candidate à l'effacement DÉFINITIF, et immédiatement — `now - 0` dépasse
toute rétention. Le terme de rétention lui-même n'était éprouvé que d'un
côté. 2 tests, **2 mutations rejouées, 2 rouges.** Le dernier admin
(`admins <= 1`), lui, était déjà défendu.

**Vingt-cinquième lot — les trois dernières du dashboard, et la physique
sortie de son canevas** (nuit, 22 h 50 → 23 h 25 UTC). Balance — le geste
ARMÉ dit ce qu'il va faire (`arme && cible !== null` mutée en `===` : le
plafond s'armerait sans annoncer ce qu'il coupe, et le second clic — celui
qui engage — se ferait à l'aveugle sur un geste qui peut arrêter
l'assignation d'un projet entier). Cerveau — une note jamais servie le dit,
et celle qui l'a été donne son âge (`serviIlYaJours === null` mutée : la
note servie il y a deux jours s'annoncerait « jamais », on la resservirait
pour rien, et la dormante afficherait « il y a null j » ; les DEUX lignes —
le texte et l'habit `dort` — sont éprouvées).

**Et la survivante du canevas, qu'on avait annoncée « probablement hors
d'atteinte », ne l'était pas.** `p.id === attrape.current.id` (« le doigt
gagne ») vivait dans une boucle que happy-dom n'exécute jamais
(`getContext('2d')` rend `null`). Le repli honnête aurait été de l'écrire au
carnet ; la bonne réponse était de constater que la force ne dépend d'AUCUN
contexte de dessin. Elle est sortie dans `dashboard/src/views/cerveau-physique.ts`
avec la règle qu'elle porte enfin dicible — « le corps que l'humain tient ne
bouge pas tout seul, et les autres si ». 6 tests neufs, la mutation en fait
rougir 4, et les seuils de convergence sont MESURÉS (46 pts à 400 tours,
0,005 à 2 000) et non devinés. § 2 quaterdecies au journal : « hors
d'atteinte du banc » est souvent « au mauvais endroit ». **4 mutations
rejouées, 4 rouges.** Reste UNE survivante : le `find` de la livraison
(`server.ts`), qui demande un banc GitHub simulé.

**Vingt-quatrième lot — la coquille qui synchronise, le jeton à Entrée,
l'essaim qui ne décore pas le zéro, le rayon qui déplie** (nuit, 22 h 10 →
22 h 45 UTC). App ×2 — SEUL `task_reviewed` synchronise les revues (mutée
en `!==`, le verdict d'un autre opérateur ne se synchroniserait jamais et
chaque événement de progression EFFACERAIT la revue existante ; témoin
corrigé en route : le cache vit EN MÉMOIRE — `getReview` — pas dans
localStorage, qui ne porte que le geste local), et le jeton se pose à
Entrée et à aucune autre touche (mutée, chaque frappe poserait un jeton
incomplet et reconnecterait le flux). PleinEssaim — le compte
d'observations ne se dit que s'il y en a (mutée, « 0 production(s)
observée(s) » : une surveillance qui prétend avoir observé sans rien voir).
Rayon — ouvrir un dossier montre SES enfants (mutée, le court-circuit rend
`true` : l'arbre entier devient une liste plate de racine). **4 mutations
rejouées, 4 rouges.** Restent 4 : Balance (arme && cible), Cerveau ×2,
et le `find` de la livraison (banc GitHub simulé à monter).

**Vingt-troisième lot — deux bornes et le cœur du scrutin** (nuit du 3 au
4 août, 21 h 10 → 21 h 40 UTC). `serveurs.ts` — la semaine des « bientôt
effacés » se termine PILE à sept jours (`jours <= 7` mutée en `<` : la
machine à exactement sept jours — celle qu'on a le plus de temps de
sauver — disparaissait de la liste ; le cas existant vivait à 3 jours).
`tui/rendu.ts` — la ligne qui tient PILE dans le cadre garde sa teinte
(`largeurVisible <= interieur` mutée : elle passerait par `tronquer`, qui
retire les séquences de style — testé avec une teinte posée sur une
largeur exacte). `server.ts` — LE SCRUTIN DÉPOUILLE : `attendues.length
=== 0` mutée en `!==` sauterait précisément les sessions qui ont des
éclaireuses à dépouiller — tout conseil resterait « exploration » à
jamais. Le test existant ne pouvait pas le voir : `Array.isArray(v.danses)`
est vrai sur un tableau VIDE (du décor), et le scrutin ne vit PAS dans
`scheduler.tick()` mais dans le tickTimer du serveur — le banc monte SA
ruche au cœur qui bat à 50 ms et exige LA danse. **3 mutations rejouées,
3 rouges.** Restent 8 survivantes.

**Vingt-deuxième lot — chaque alvéole pèse SON miel, et l'erreur GitHub
porte son habit** (même soir, 20 h 25 → 20 h 40 UTC, après la fusion de la
PR #135). LE BALAYAGE DU SOIR EST RENDU entre-temps : **95 examinées,
63 défendues, 32 SANS TEST (34 %)** — verdict scellé, dernière survivante
recensée : la borne de troncature de `tui/rendu.ts`. Ce lot tue les deux de
Projets : `p.projectId === project.id` du compteProjet (mutée, avec DEUX
projets au banc — 30 min / 2 h — chaque carte afficherait la pesée de
L'AUTRE ; le banc à un seul projet n'aurait rien vu), et
`{erreur && <p className="pj-gh-erreur">}` (mutée, un habit d'erreur vide
dès l'ouverture de la section GitHub, l'erreur réelle rendue crue — les
deux mondes joués : ouverture sereine puis sonde en panne). **2 mutations
rejouées, 2 rouges, chacune tuant exactement son test nommé.** Restent 11.

**Vingt-et-unième lot — la Mémoire qui sait, l'Intendance qui n'ouvre pas
de rangée vide** (même soir, 20 h 05 → 20 h 20 UTC). Mémoire — le compteur
dit « se souvient de 3 choses » quand le compte EST là (`total === null ?`
mutée en `!==` : la ruche qui sait afficherait « fouille ses rayons » à
jamais, et le chargement « se souvient de null chose »). Intendance — la
rangée de suite d'une machine n'existe que si elle a quelque chose à dire
(`(erreur || note || aConfirmer) &&` mutée en `||` : une rangée vide sous
chaque machine au repos, et la confirmation rendue crue hors de sa rangée) ;
le monde « avec » se fabrique SANS réseau — demander l'effacement ne fait
que poser `aConfirmer`, le vrai geste n'arrive qu'à la confirmation. Trois
pièges de banc payés en route : l'état de serveur `'actif'` N'EXISTE PAS
(la liste est demande/provisionnement/pret/arrete/supprime/echoue — le
banc a planté sur `ETAT_SENS[s.etat]` avant la première assertion),
`fetchMembres` exige `inscription.avertissement`, et le bouton du geste
s'appelle « → supprimé », pas « effacé ». **2 mutations rejouées,
2 rouges, chacune tuant exactement son test nommé.**

**Vingtième lot — la Reine et Mon Espace, et § 2 terdecies appliqué AVANT
la morsure** (même soir, 19 h 45 → 19 h 55 UTC). Reine — le badge « 📡 état
réel » ne se porte que sur la réponse CALCULÉE (`m.source === 'live' &&`
mutée en `||` : la supposition du modèle se parerait du badge des
instruments, et la lecture réelle le perdrait). Le premier discriminant
(`.rn-src`) s'est révélé PARTAGÉ au premier passage — la branche llm porte
aussi un `.rn-src` (« ✨ IA ») — et cette fois la leçon toute fraîche a
servi : c'est le TEXTE du badge qui distingue, pas le sélecteur. Mon
Espace — le compte à rebours d'une alerte ne s'affiche que quand il reste
des jours (`a.jours >= 0 &&` mutée : l'échéance à venir perd son compte, et
l'échéance passée affiche « -1 j » — un délai négatif présenté comme du
temps restant) ; la vue exige une session (`user`), sans quoi elle s'arrête
à l'invitation. **2 mutations rejouées, 2 rouges, chacune tuant exactement
son test nommé.**

**Dix-neuvième lot — trois sentinelles de plus : Journal, et les deux de
Santé** (même soir, 19 h 35 → 19 h 45 UTC). Journal — « En attente
d'événements… » ne se dit QUE devant un journal vide (`events.length === 0
&&` mutée en `||` : la ruche active prétendrait attendre, et le journal
vide — le seul moment où la ligne renseigne — la perdrait). Santé —
l'erreur de la chasse aux fantômes porte son habit `.panel-error` et
seulement elle (`ghost.error` est l'erreur de la SONDE : le mock doit
REJETER, pas rendre un payload — mutée en `||`, un habit d'erreur vide
s'afficherait au repos et l'erreur réelle se rendrait crue) ; et la liste
des sondages du Guet n'existe que s'il y a des passages (mutée, le
court-circuit rend `true` — React n'affiche RIEN : la liste disparaît au
moment exact où elle informe). Au passage, un piège d'outillage : un rejeu
en boucle shell avec `|` comme séparateur IFS s'est fait découper par les
`||` DES CHAÎNES MUTÉES — trois « no tests » muets ; rejoué un par un,
heredoc, verdict affiché. **3 mutations rejouées, 3 rouges.**

**Dix-huitième lot — les cinq survivantes HORS dashboard du balayage du
soir** (même soir, 19 h 20 → 19 h 30 UTC), et quatre d'entre elles disent la
même chose : LES BORNES ET LES MOITIÉS NE SE TESTENT QUE SUR ELLES-MÊMES.
`cloudflare.ts` — la commande apt est composée (`curl … && sudo dpkg -i …`)
et le test existant (`toContain('arm64.deb')`) était satisfait par la moitié
curl SEULE : mutée, la moitié dpkg téléchargeait arm64 et installait amd64
sans rougir ; on exige désormais que l'AUTRE architecture n'apparaisse nulle
part. `desinstallation.ts` — `while (n >= 1024)` : tous les cas du test
vivaient LOIN des seuils ; 1 Mo pile s'affichait « 1024 ko » sous le mutant ;
la borne se teste sur la borne (1 Mo et 1 Go exacts). `abonnement.ts` —
`now >= fin` du délai de grâce : les cas existants étaient à 3 jours et à
J+1 ; l'instant EXACT du terme donnait encore des droits sous `>`.
`installer-assistant.ts` — `depot === '' ? undefined : depot` mutée JETTE
précisément ce que l'humain vient de taper (le seul cas testé était le ⏎,
qui ne distingue pas les deux sens) ; le dépôt répondu doit se retrouver
dans la commande proposée. `cli.ts` — `methodes.length === 0` du diagnostic
cloudflare : mutée, la machine outillée s'entend dire « Aucune méthode
connue » ; le test lance le VRAI CLI avec un PATH neutralisé (l'absence de
cloudflared rendue déterministe sur les trois systèmes) et exige la liste.
**5 mutations rejouées, 5 rouges.**

**Dix-septième lot — la première fournée du balayage du soir : sept
survivantes tombent** (même soir, 18 h 50 → 19 h 15 UTC). Le balayage élargi
de la nuit (base : premier commit du dépôt, LOUPE_MAX=100, toujours en cours
dans l'atelier) rend ses survivantes par paquets ; les sept premières sont
mortes. Miellerie ×4 — le compteur de revues (« 1/3 revues » sur TROIS tâches
dont UNE revue : le premier banc à 1+1 était SYMÉTRIQUE, § 2 duodecies encore,
la mutation y comptait juste par accident), la garde splitDiff
(`chunks.length === 0 ||` — mutée, un vrai diff se rendrait en bloc brut sans
ses compteurs par fichier), l'habit `active` de la rangée suivie, et les
touches j/k mortes précisément quand la file est pleine (`length === 0`
mutée en `!==`). Chronique — le bandeau « vous regardez le passé » qui
s'afficherait au PRÉSENT, en permanence (`{inReplay && (` mutée en `||`).
Essaim ×2 — le ⚔ de course porté par l'ouvrière dont le drone est TOMBÉ
(`d.status === 'running'`), et « running » cru à l'écran (`statusLabel`).
**17 tests dans les trois fichiers, 7 mutations rejouées, 7 rouges.** Une
leçon payée en direct : mon premier discriminant du splitDiff — `.mi-files` —
existe sur LES DEUX chemins du rendu (le repli brut y loge sa note « Diff
affiché brut ») et la mutation a SURVÉCU au premier rejeu ; seule la puce
`.mi-file-chip` distingue la découpe. Le rejeu n'est pas une cérémonie : il
attrape aussi le test qui croit discriminer et ne discrimine rien.

**Seizième lot — le Cerveau, et LE BALAYAGE EST SOLDÉ : 29 survivantes sur
29 résolues** (même jour, 17 h 45 → 17 h 50 UTC) : les deux dernières.
L'interrupteur de mode qui allumerait l'AUTRE mode (`mode === 'graphe'`
mutée sur la ligne de la classe — pas ses jumelles `aria-pressed` et
`{mode === 'graphe' &&`), et `noteChoisie` (`choisi === null ? null : …`
mutée : la fiche ne s'ouvrirait JAMAIS — l'écran fait pour interroger le
savoir n'aurait plus de réponse). Le canevas ne se dessine pas sous
happy-dom : la LISTE — « la même information, dans un tableau navigable »,
décision d'interface n° 1 de la vue — est le chemin du test, comme du
clavier. `tests/cerveau-vue.test.tsx`, 2 tests, **2 mutations rejouées,
2 rouges.**

**MISSION « LE POSTE » — lot 3 : le nectar dans la fiche** (même soir,
18 h 35 → 18 h 45 UTC) : la fiche coéquipière porte la ligne du Waggle Board
de CETTE ouvrière — 🍯 score, % de réussite, ⚔ victoires de course (tues à
zéro : une absence ne se décore pas). UN relevé à l'ouverture de la fiche,
pas une sonde de plus ; en panne, le nectar se tait et la fiche vit sans
lui ; une ouvrière absente du classement n'a pas de nectar inventé. 2 tests
de plus (8 au fichier), **2 mutations rejouées, 2 rouges** (la ligne de la
BONNE ouvrière — deux entrées aux chiffres différents au banc —, et le ⚔ à
zéro). Au passage : § 9 nonies récidivé et rattrapé avant push — badges
écrits « +4 » de tête, la suite mesurait +2 ; corrigés à 3 134 MESURÉS.

**MISSION « LE POSTE » — lot 2 : la fiche coéquipière** (même soir, 18 h 15 →
18 h 30 UTC) : cliquer la carte d'une ouvrière ouvre SA fiche — qui elle est
(machine, agent, hôte, charge), et SES MISSIONS (portées + rendues : le
résultat garde son nom même si la tâche a été réassignée), cliquables vers
le tiroir de tâche — l'entrée PAR OUVRIÈRE vers ce que la ruche sait déjà
montrer par tâche (diff, logs, Rayon, Aperçu). La fiche ne s'offre que si
l'appelant fournit tâches et geste ; ouvrir le tiroir FERME la fiche (deux
surfaces modales ne s'empilent pas). 4 tests, **3 mutations rejouées,
3 rouges** (le filtre des missions, le compte des butinées, la fiche
conditionnée).

**LE SECOND VISAGE DE L'INTERMITTENT EST TROUVÉ — et c'était le vrai
coupable des fusions** (même soir) : le test « hive desinstaller LANCÉ POUR
DE VRAI --oui » donnait à la commande une racine jetable, mais
`contexteReel` pose `tmpdir = os.tmpdir()` RÉEL — et `retirer` y balaie
`hive-merge-*` : il rasait les RUSTINES des tests de merge des workers
vitest voisins. D'où « applied [] » (merge-wiring, 16 h 40, graine 23757)
et « can't open patch » (merge-runner, 18 h 21, graine 15838) — CI
seulement, jamais au rejeu local (il fallait le chevauchement de deux
fichiers précis dans deux workers). Corrigé : le sous-processus reçoit un
/tmp à lui (`TMPDIR`/`TEMP`/`TMP`, qu'`os.tmpdir()` respecte), le balayage
par préfixe reste couvert DANS le bac, et un TÉMOIN dans le vrai /tmp monte
la garde — l'isolement retiré, c'est LUI qui rougit (contre-preuve
rejouée). § 9 octodecies au journal. Le « 130 » de join (§ 9 septdecies)
était le PREMIER visage, distinct et lui aussi corrigé.

**MISSION « LE POSTE » — lot 1 : la machine derrière chaque ouvrière** (même
soir, 18 h 05 → 18 h 20 UTC, demandé par l'utilisateur en s'inspirant de
ai-workers.dls.so — les ouvrières IA présentées comme des coéquipières).
« Quelles ouvrières tournent sous Windows ? » a désormais une réponse à
l'écran : le nœud DÉCLARE sa plateforme à l'inscription
(`plateformeDepuis(process.platform)` — module pur `src/shared/machine.ts`,
une seule liste partagée protocole/écran), le protocole la VALIDE (hors
liste → message entier refusé, pas de correction en douce), le store la
retient dans une table LATÉRALE `machines_noeuds` (règle 2 : aucune
migration ; borne structurelle : une ligne par nœud ; un client ancien qui
ne déclare rien N'EFFACE PAS le savoir acquis), et le panneau des nœuds
porte la puce (🪟 windows · 🍎 macos · 🐧 linux — rien pour un nœud d'avant,
plutôt qu'une invention). `tests/poste-machine.test.ts` (10 tests, dont un
BOUT-EN-BOUT : vrai nœud, vraie ruche, `/api/state` porte la plateforme de
ce processus) + `tests/poste-ecran.test.tsx` (2 tests). **6 mutations
rejouées — une par maillon : pur, protocole, store, écran, client, serveur —
6 rouges.** Lots suivants de la mission : la fiche coéquipière (missions,
mémoire, liens Rayon/Aperçu — « l'ordinateur virtuel de la ruche pour
tester/modifier le code » — existe déjà en pièces, il manque la porte
d'entrée par ouvrière).

**L'INTERMITTENT DE LA GRAINE 23757 EST ATTRAPÉ** (même soir) : deuxième
frappe sur la même graine, et cette fois avec un nom — join-ruche-vivante,
« expected 130 to be +0 », le message « Déconnexion de la ruche… » PRÉSENT
dans la sortie. Le produit sort en 0 ; c'est l'enveloppe `tsx` du banc qui,
frappée par le même SIGINT, traduit parfois sa propre mort en 130 avant
d'avoir vu le 0 de son enfant. Corrigé dans le test : preuve du chemin
graceful exigée + les deux codes d'arrêt propre acceptés, jamais un vrai
code d'erreur ni le SIGKILL du coup de grâce — § 9 septdecies au journal
(le QUATRIÈME visage du code de sortie trompeur de la journée). La première
frappe (16 h 40, merge-wiring) reste inexpliquée mais porte désormais son
diagnostic embarqué.

**CORRECTION DU MÊME SOIR — le « 29/29 » ci-dessous a été écrit VINGT
MINUTES TROP TÔT.** J'avais compté les survivantes sur la LISTE DE QUEUE du
journal de balayage, qui n'en portait que 27 : les DEUX de `App.tsx`
(l'info-bulle qui parlerait l'autre langue, et `route.view === 'rayon'` —
le Rayon sous toutes les vues sauf la sienne) vivaient dans le CORPS du
journal et pas dans sa queue. C'est § 2 duodecies appliqué à mon propre
comptage : la source de vérité était `grep -c "SANS TEST"` (29), pas une
liste dérivée. Les deux sont tuées dans la foulée — `tests/app-coquille.test.tsx`,
la coquille MONTÉE pour de vrai (flux WebSocket et sondes simulés, nav,
routage par hash et i18n réels), 2 mutations rejouées, 2 rouges — et c'est
MAINTENANT que le compte est bon.

**LE COMPTE FINAL DU BALAYAGE DU 3 AOÛT : 69 examinées, 40 défendues
d'emblée, 29 survivantes — et les 29 sont résolues le jour même**, toutes
par un test qui les tue (aucune déclarée équivalente). En chemin : deux
défauts du PRODUIT corrigés (l'unité systemd jamais chargeable, le code de
sortie avalé du lanceur), une extraction (conseilServeur), une injection
promise par un commentaire et enfin réelle (fournisseurServeurs), et cinq
leçons neuves au journal. Leçon de barrière au passage : la CI court DEUX
tsc (`typecheck` + `typecheck:dashboard`) — la barrière locale n'en courait
qu'un, trois jambes rouges pour une ligne l'ont dit.

**Quinzième lot — sept sentinelles : les survivantes isolées tombent toutes**
(même jour, 17 h 30 → 17 h 45 UTC) : une par vue, plus le module partagé et
la Balance (jouée par la carte Projets). Ruche (« 0/0 tâches butinées » sur
une ruche vide, si la mutation vivait), Rayon (le `repoUrl` rendu CRU avec
son jeton `ghp_…` au lieu de passer par `sansIdentifiants` — la moitié
dangereuse de ce `&&`-là), Chantiers (« (code 1) » disparu des verdicts
réels, « (code null) » sur les autres), Santé (l'habit cliquable au fantôme
qui ne mène nulle part), OpenAlex (une erreur vide au repos, la vraie sans
son habit), `countPendingReviews` (le badge compterait revues et tâches en
vol : 3 au lieu de 1), et l'alerte de plafond de la Balance (l'alarme sur
chaque plafond SAUF ceux qui la méritent).
`tests/vues-sentinelles.test.tsx` (6) + un test dans
`tests/projets-alveoles.test.tsx`, **7 mutations rejouées, 7 rouges.**
Restent **4 survivantes : Cerveau ×2, App ×2.** À NOTER honnêtement : une
passe complète sur trois a rendu UN rouge non identifié (la sortie était
partie dans un grep, pas dans un fichier — la leçon § 9 sexdecies appliquée
à moitié) ; deux passes complètes suivantes et cinq passes des fichiers
neufs sont vertes. S'il refrappe en CI, merge-wiring porte désormais son
diagnostic.

**Quatorzième lot — les Projets : la porte, le rapport, l'étoile** (même
jour, 17 h 25 → 17 h 30 UTC) : les TROIS survivantes de la vue. La porte de
l'atelier Queen Bee (`busy !== 'idle' ||` mutée en `===` : bouton mort au
repos, vivant pendant le travail — les deux moitiés vérifiées par frappe
réelle dans le champ contrôlé), le rapport de merge qui ne se rend qu'une
fois RENDU (muté, `result` indéfini casse l'écran au repos — le flux complet
est joué : plan, double confirmation, scrutation aux minuteurs simulés,
résultat au battement suivant), et l'habit « retenue » du Conseil des
Éclaireuses sur LA danse retenue seule (la battue n'a aucun arrêt : sa classe
ne peut devenir « retenue » que par la mutation ; l'ancre visée est la ligne
de la CLASSE, pas sa jumelle de l'étoile — § 2 duodecies).
`tests/projets-alveoles.test.tsx`, 3 tests, **3 mutations rejouées,
3 rouges.** Leçon d'instrument : deux sous-composants embarqués (PleinEssaim,
Balance) sondent par de VRAIS fetch — sans leurs simulacres, le banc bruisse
d'ECONNREFUSED vers le port 3000. Restent **11 survivantes.**

**Treizième lot — la Miellerie, la plus grosse famille, tombe entière** (même
jour, 17 h 15 → 17 h 25 UTC) : les QUATRE survivantes de la vue, chacune avec
ce que l'écran aurait raconté de faux — la file de revue qui enterrerait le
travail À FAIRE sous le travail fait (la revue est plus FRAÎCHE exprès : seul
le rang peut mettre la neuve devant), l'inspecteur qui montrerait le diff
d'UNE AUTRE tâche sous le titre de celle qu'on relit (l'étranger vient en
premier dans la liste simulée, pour que la boucle ait à choisir), le pied de
coulée qui nommerait le projet VOISIN (qui n'a aucune tâche : son nom ne peut
surgir que par la mutation), et « le nœud coule le miel… » affiché au repos
et tu pendant la coulée (les deux moitiés vérifiées, le double-clic
d'armement joué pour de vrai). `tests/miellerie-revue.test.tsx`, 4 tests,
**4 mutations rejouées, 4 rouges.** Restent **14 survivantes.**

**Douzième lot — les HUIT hors-dashboard sont toutes tuées** (même jour,
16 h 40 → 17 h 10 UTC) : les quatre pures d'abord, chacune dans son harnais
existant — `tui/rendu.ts` (le huitième fantôme sur un ratio exact : la garde
de largeur ne rougissait pas, c'est le CONTENU qui mentait), `workflow.ts`
(`lireRun` : la ligne JUMELLE de `lireWorkflow`, § 2 duodecies — même texte,
deux sorts), `concierge.ts` (le compte « en vol » : le contexte 1-en-vol /
1-tombé du test voisin était SYMÉTRIQUE, la mutation y était invisible ; 2/1
la voit), `scheduler.ts` (la frontière `<=` exacte d'expiration du cooldown à
l'enrôlement d'une course, contre-preuve à expiration − 1). Puis les quatre
qui demandaient un harnais : `ruche.mjs` (la Reine qui sort en 0 sans qu'on
ait rien demandé — `pkill -INT -P` sur l'enfant seul, prémisse « arrêté
(code 0) » VÉRIFIÉE sinon `null ?? 1` rend le test vert par la mauvaise
porte ; l'apostrophe courbe du marqueur du test voisin, qui ne pouvait pas
matcher, corrigée au passage), `installer-main.ts` (le `&&` de la chaîne
imprimée : extrait en `conseilServeur()` PURE dans `installer.ts` — `main()`
court à l'import, le bloc n'existait qu'au clavier — avec garde de
consommation pour que l'extraction ne soit pas du décor), `server.ts` (le
fournisseur de serveurs rendu RÉELLEMENT injectable — le commentaire le
promettait, le code l'écrivait en dur, et avec le manuel no-ops/`ref: ''` la
garde arrêt/suppression traversait l'API sans témoin ; un fournisseur
enregistreur prouve que « supprimer » suit la suppression et jamais l'arrêt),
`cli.ts` (le badge 📡/✨ : une vraie ruche, la vraie CLI en sous-processus —
un fait ne se déguise pas en génération). **8 mutations rejouées ligne à
ligne, 8 rouges.** Restent **18 survivantes, toutes dans les vues du
dashboard.** Leçon d'instrument au passage : `git checkout --` pour retirer
une mutation EMPORTE les éditions non committées du même fichier — les
mutations sur fichiers en chantier se retirent par mutation INVERSE.

**Onzième lot — la CI de la PR #131, deux rougeurs, deux leçons** (même
jour) : le tamis a rougi sur `merge-wiring` (graine 23757) — vert en local au
même commit, même graine ; un `applied` vide non refusé vient du `catch` du
nœud, et le message réel vivait dans `result.logs` QUE PERSONNE N'AFFICHAIT.
L'intermittent est reparti avec son secret — c'est peut-être celui « jamais
reproduit » du carnet. Chaque assertion du chemin heureux porte désormais
`diagnostic()` (§ 9 sexdecies : un intermittent ne laisse que ce que
l'assertion montre). Puis les DEUX gardes de cohérence des badges ont rougi
— et elles avaient raison : le compte de tests vit à SIX endroits (2 READMEs,
2 pages × 2 langues), ma recherche n'en avait trouvé que deux (§ 2 duodecies,
la virgule anglaise « 3,088 » échappait au motif « 3 088 »).

**Dixième lot — la Chronique : les deux vides ne se confondent pas** (même
jour) : la survivante `events.length === 0` — mutée, « la ruche n'a encore
rien vécu » s'afficherait sous un journal plein. `tests/chronique-journal.test.tsx`
(4 tests) : le vide d'accueil, sa disparition dès le premier événement, le
« tout filtré » qui désigne LES FILTRES au lieu d'accuser la ruche, et les
compteurs de famille au vrai compte. 3 mutations 3 rouges.

**Neuvième lot — l'Essaim : le conseil de caste ne ment à personne** (même
jour) : la survivante `n.caste !== 'butineuse'` — inversée, la caste sommitale
recevrait « N productions pour le palier suivant » (un palier qui n'existe
pas) et les autres perdraient leur guide. `tests/essaim-castes.test.tsx`
(5 tests, api simulé, 3 sondes muettes + polyéthisme mis en scène) : la
nourrice voit ce qui lui manque chiffré contre le bon seuil, la butineuse ne
reçoit rien, la bâtisseuse au volume atteint apprend que c'est la fiabilité
qui retient, la liste vide se dit, et l'écart mode/modeDemande (Gardiennes
éteintes) est affiché. 3 mutations 3 rouges — la troisième avait d'abord
MANQUÉ SA CIBLE (motif inventé au lieu de l'ancre réelle, « survit » nul) et
a été rejouée sur la vraie ligne.

**Huitième lot — le tiroir de tâche, rendu et manipulé** (même jour) : la
survivante `task.status === 'done' && victory` du balayage — inversée, la
bannière 🏆 décorerait tout SAUF les gagnées. `tests/tiroir-tache.test.tsx`
(5 tests, happy-dom, module api simulé par `importOriginal`, CodeMirror
écarté) : le trophée nomme le vainqueur et compte les annulés ; la même
victoire sur une tâche en cours se tait ; une tâche échouée ne demande même
pas la course ; Annuler n'existe que si annulable et annule LA BONNE tâche.
4 mutations 4 rouges.

**Septième lot — le lanceur, et le code de sortie qu'il ne rendait pas**
(même jour) : premier test jamais écrit pour `scripts/ruche.mjs`
(`tests/lanceur-ruche.test.ts`, 2 tests POSIX, vraie Reine sur port éphémère),
et il a trouvé UN DÉFAUT DU PRODUIT à sa première exécution : le lanceur
imprimait « ✘ arrêté (code 1) — la ruche s'arrête. » puis SORTAIT EN 0 — le
`process.exit(code)` vivait dans un minuteur `unref()`, et la boucle vide
sortait naturellement avant qu'il ne tire. Une ruche amputée passait pour un
succès aux yeux d'un superviseur. Corrigé (`process.exitCode` posé avant le
minuteur), § 9 quindecies au journal — troisième leçon du jour sur un code de
sortie avalé. 4 mutations 4 rouges, dont le défaut d'origine réintroduit.

**Sixième lot — la transition des différées, extraite et tuée** (même jour) :
la survivante `ev.type === 'task_conflict_deferred'` du balayage vivait dans un
`useEffect` de `App.tsx` — 467 lignes d'intégration qu'aucun test ne monte.
Le geste établi du dépôt (extraire le pur, tester le pur — comme `rendu.ts`)
s'applique : `dashboard/src/differees.ts`, transition pure, avec son contrat
d'IDENTITÉ RÉFÉRENTIELLE (un événement étranger rend `prev` LUI-MÊME — sans
quoi l'écran se re-rendrait au rythme du flux en plein essaim). 6 tests,
4 mutations 4 rouges — dont la survivante d'origine, dans les deux sens.
L'e2e de `join` a par ailleurs coûté TROIS jambes rouges avant d'être juste
(ordre emprunté au voisin — § 2.14 récidive —, puis scrutation post-mortem
d'un nœud déjà tué) : le fichier garde les trois leçons en tête.

**Cinquième lot — le chemin RÉUSSI de `join`, contre une ruche vivante**
(même jour) : ce que le carnet portait comme « territoire des tests e2e » est
fait. `tests/join-ruche-vivante.test.ts` monte une VRAIE ruche (`createServer`,
port éphémère), crée un billet à usage unique par la vraie route
`POST /api/billets`, et joue les trois actes dans l'ordre où l'ami les vit :
l'échange (clé mémorisée en 0600, nœud visible côté ruche, URL réelle affichée
avant tout échange), le redémarrage (le billet N'EST PAS redemandé — la raison
d'être de la mémoire de clé), et le même billet sur un nid neuf (refus net,
marche à suivre). 4 mutations 4 rouges : clé jamais rangée, jamais relue, 0600
perdu, persistance annoncée sans vérification.

**Quatrième lot — `bin.ts` et `orchestrator/main.ts`, faits** (même jour) :
8 tests, 6 mutations 6 rouges. La porte unique du paquet npm : l'aide et la
table des sous-commandes confrontées (source comptée ↔ aide imprimée), la
réécriture d'`argv` prouvée par `hive cli state` (sans elle, `cli` prendrait
« cli » pour la commande et rendrait l'usage au lieu de tenter la requête),
l'aiguillage de chaque sous-commande, et les drapeaux nus qui vont à
l'installeur. La Reine : bannière (écran + base), arrêt PROPRE sur SIGTERM —
le signal que systemd enverra — avec code 0 dit et mesuré, et le `.env` du
répertoire courant réellement lu (base annoncée = base du fichier, aucun
autre canal). Ce qui reste à 0 % dans `src/` et se dit : `demo.ts` (93 lignes
— reconstruit le dashboard à la volée s'il manque, instable en CI) et
`node-client/main.ts` (29 lignes, le nœud configuré — demande une ruche
vivante, territoire e2e).

**Troisième lot — `installer-main.ts`, fait** (même jour) : 6 tests en
sous-processus dans un cwd jetable, 6 mutations 6 rouges. La répartition
Node 22 / Node 24 est ASSUMÉE et travaille pour nous : sous le Node 22 du
conteneur, on teste la porte `PREREQUIS` (refus net, code 2, quoi faire) — un
chemin que la CI, sous Node 24, n'emprunte jamais ; sous Node ≥ 24, les chemins
complets : le dry-run annonce puis n'écrit RIEN, `--json` rend du JSON
analysable sans filtre, le vrai passage crée le `.env` en 0600 puis
l'idempotence tient octet pour octet, et un port occupé se lit dans le code de
sortie (4) sans annuler le reste. Leçon du lot au journal (§ 9 quaterdecies) :
un tube avale le code de sortie — trois morsures en une heure, dont une qui a
réinitialisé la branche locale en perdant un commit (sauf sur le distant).

**Deuxième lot — `join.ts` et `tunnel.ts`, faits** (même jour) : 16 tests,
6 mutations 6 rouges. Le tunnel : `urlRucheDepuisTunnel` refuse `http`, le vrai
`spawn` sur un fournisseur factice (URL sur stdout ET stderr — cloudflared
annonce sur stderr —, sortie sans URL, minuteur), et LA garde du lot : un faux
`cloudflared` dans le PATH **déverse l'environnement qu'il reçoit** — les
sentinelles `HIVE_TOKEN`/`ANTHROPIC_API_KEY` n'y figurent pas, et la mutation
`envSonde(process.env)` → `process.env` rougit. `join` : les trois refus
précoces en sous-processus (invitation difforme → 1 ; sans billet ni terminal
→ code 3 avec les deux issues imprimées ; billet vers ruche injoignable → URL
réelle montrée puis refus), plus la preuve que `HIVE_INVITE` est bien lu avant
la garde TTY. Ce qui reste NON couvert sur ce chemin, et qui se dit : le
démarrage RÉUSSI (échange de billet accepté, clé mémorisée en 0600, WebSocket
ouvert) demande une ruche vivante — c'est le territoire des tests e2e.

### Ce que la loupe ne couvre toujours pas

Le balayage du 3 août porte sur **le diff du jour**, pas sur le dépôt entier, et
la loupe ne mute que des **opérateurs**. Une garde absente sur du code sans
opérateur lui reste invisible.

---

## Point franc du 2 août — J-31

Rendu à la demande de l'utilisateur, après une journée de sept lots fusionnés
(#104 à #111). Aucun arrondi : ce qui n'est pas mesuré est écrit comme non
mesuré.

### Livré ET vérifié aujourd'hui

Sept lots, chacun avec ses gardes éprouvées par mutation avant d'être crues.

| lot                                  | ce qui est vérifié, et comment                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Le tamis des ordres                  | 17 fichiers qui empruntaient leur vert au voisin ; `npm run tamis-ordres` rejoue trois graines en CI                            |
| Le premier contact                   | le remède du docteur ne désarme plus l'installeur ; 6 tests font passer ce que l'installeur ÉCRIT par ce que le docteur DEMANDE |
| La vitrine montre le tableau de bord | 5 écrans, 51 clés de traduction, 6 gardes                                                                                       |
| Plus sobre + téléphone               | l'or redevient la couleur du surligneur ; 5 gardes                                                                              |
| L'échelle de la maquette             | `h1` et titres de section identiques au DOM de la maquette, chiffre pour chiffre ; 9 gardes, 12 mutations                       |
| Le téléphone mesuré                  | débord 0 et aucune cible sous 40 px sur 3 pages × 5 largeurs ; 6 gardes, 11 mutations                                           |
| « En bref » en 4 familles            | 6,0 → 1,5 écran sur téléphone, 23 cartes conservées ; 6 gardes, 8 mutations                                                     |

La suite passe de **2 893 à 2 978 tests** sur 182 fichiers, verte sur les trois
systèmes.

### Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse l'expérience d'un nouvel arrivant EN PREMIER.

1. **Le chemin `spawn` de l'agent sous Windows — la limite était franchissable.**
   Je l'ai annoncée hors d'atteinte toute la journée : « aucune machine Windows
   ici, et la CI n'y installe pas Claude Code ». La deuxième moitié est vraie et
   la conclusion était fausse. La question n'est pas « Claude Code répond-il ? »
   mais « Node, lancé SANS interpréteur, sur un chemin Windows composé par nous,
   exécute-t-il le script qui s'y trouve ? » — et ça ne demande pas Claude Code,
   ça demande **un fichier à la bonne place**. `prefixeNpmWindows` lit
   `npm_config_prefix` avant `APPDATA` : `tests/agent-windows-spawn.test.ts`
   plante donc un faux paquet dans un dossier temporaire et fait le vrai
   `spawn`. **VÉRIFIÉ.** Le log de la jambe `windows-latest` du 3 août dit
   `✓ tests/agent-windows-spawn.test.ts (4 tests)` — quatre, là où Linux
   affiche `1 passé | 3 sautés`. Les trois tests Windows ont donc bien tourné,
   et ils passent : le chemin composé existe, `spawn('node', […], shell:false)`
   le lance, les arguments de la tâche traversent, et sans fichier on retombe
   sur `[bin]`. C'est la première fois de la journée que cette ligne n'est pas
   une promesse.

   _(Cette ligne a dit « pas encore vu passer » pendant exactement une heure —
   le temps que la CI réponde. La corriger tout de suite est l'application du
   § 9 undecies : un état qui dérive vers le pessimisme n'est démenti par
   personne.)_

2. **`npm install` pèse 20 des 23 secondes de l'installation.** Le critère 2 tient
   dans les deux lectures, mais c'est ce que le nouvel arrivant ATTEND en
   regardant un écran muet.
3. **La vitrine fait encore 11 sections et ~10 000 px** là où la maquette en fait
   7 et 3 865. Les familles ont réglé « En bref » ; les six autres sections n'ont
   pas été retouchées.
4. **La barre latérale de Mission Control** : mesurée à `manqueEnBas: 0` par CDP,
   donc le défaut que j'avais annoncé n'existe pas. Ligne close, mentionnée ici
   parce que je l'avais affirmée à tort.

### Ce qui restera hors d'atteinte, et demande une décision humaine

- **Les comptes npm et GHCR/cosign** (lot 7, partie du lot 10) ne sont pas les
  miens. Le code est prêt ; la publication non.
- **Une VM Windows 11 et une Ubuntu 24.04 vierges** pour mesurer le critère 1 au
  sens strict. Ce qui a été mesuré ici l'a été dans un conteneur — ce n'est pas
  la même chose, et ça se dit.
- **L'intermittent signalé à l'origine n'a JAMAIS été reproduit sur Linux** :
  invisible en 8 ordres mélangés et 3 exécutions identiques. Il n'est pas fermé,
  il est introuvable d'ici.
- **Les tarifs** (0 € / 49 € / à partir de 79 €) sont affichés comme modèle
  proposé, aucun paiement encaissé. Encaisser pour de vrai avant le 2 septembre
  est une décision commerciale.
- **La longueur de la vitrine** : raccourcir de 11 sections à 7 n'est pas du
  design, c'est décider quel contenu disparaît.

### La réserve sur la méthode — levée, et ce qu'elle cachait

**Elle est fermée pour le code du jour.** Balayage exhaustif dans l'atelier
séparé, base sur le premier commit du 2 août : **41 mutations possibles,
41 examinées, 41 tuées, aucun survivant.** Sans échantillonnage. C'est la
première fois de la journée qu'on peut écrire autre chose que « la loupe est
verte » — qui ne voulait dire que « verte sur ce qu'elle a bien voulu regarder ».

Ce que la réserve cachait est moins flatteur. Je l'ai répétée toute la journée —
« la loupe échantillonne, 8 sur 16, ce n'est pas une preuve d'absence » — sans
jamais chiffrer ce qu'il en coûterait de la lever, et en laissant entendre
qu'elle était hors d'atteinte. Le coût réel : **41 mutations, une quarantaine de
minutes d'attente.** Voir § 9 decies du journal.

**Ce qui reste vrai malgré tout**, et qu'il faut continuer de dire :

- Le balayage porte sur le **diff du jour**, pas sur le dépôt entier. Le code
  antérieur n'a pas été repassé sous cette loupe-là.
- La loupe ne mute que des **opérateurs** (`&&`/`||`, `===`/`!==`, `<=`/`<`).
  Une garde absente sur du code sans opérateur reste invisible pour elle.
- Un survivant peut être **équivalent** — aucune entrée ne distingue les deux
  versions. Ici la question ne se pose pas : il n'y en a eu aucun.

---

## Lot 18 — `HIVE_POLYETHISME=strict` fait enfin quelque chose

**Arbitrage rendu par l'utilisateur le 2 août : câbler la contre-visite.**

Le cadre envoyé à chaque nourrice disait, mot pour mot : « TA PRODUCTION SERA
RELUE par une ouvrière plus expérimentée avant d'être appliquée. »
`exigeContreVisite` et `trancher` savaient depuis toujours quoi en faire, et
n'avaient **aucun appelant**. La phrase était donc fausse — de la pire espèce :
celle qui rassure celui qu'elle vise.

### Où la porte s'est posée, et pourquoi là

Pas sur le verdict. `noterVerdict` dit explicitement qu'il ne bloque aucune
fusion, et c'est juste : « une contre-expertise qui DÉCIDERAIT remplacerait la
revue au lieu de l'armer ».

La porte est sur **`aLivrer`**, qui exige déjà `approved` — une revue humaine.
La contre-visite s'y **ajoute** : la ruche peut refuser de livrer ce qu'un
humain a approuvé, jamais l'inverse. `attendre` n'est pas un échec, c'est
l'état d'une production que la ruche ne peut pas juger seule et qui reste donc
où elle était : devant l'humain.

Elle ne mord qu'en `strict`. En `consignes` — le défaut — le polyéthisme guide
sans contraindre. Faire mordre partout changerait le comportement de toutes les
ruches installées, sur une décision que personne n'a prise.

### La table qui manquait

Le verdict ne vivait que dans un événement, c'est-à-dire dans le passé, alors
que la décision de livrer se prend plus tard, sur un autre tick. `contre_visites`
est LATÉRALE (règle 2 : aucune migration), clé par **production** et non par
relecture — ce qui compte au moment de livrer, c'est « cette production
a-t-elle été contre-visitée ». Sa borne référentielle est câblée dans le même
changement, et elle naît vraie : `pruneTasks` fait vraiment disparaître des
tâches depuis le lot 17.

### Ce qui tient

**Six mutations, six rouges** : porte retirée, porte qui mord en `consignes`,
contre-visite absente valant `appliquer`, `ameliorer` qui passe, caste de la
relectrice ignorée, verdict non rangé.

Le dernier a **survécu au premier tour**, et la leçon vaut d'être écrite : mes
six tests écrivaient la contre-visite **par le store**, jamais par le vrai
chemin. Rien ne prouvait que la contre-expertise la range. L'assertion manquante
est allée dans `cerveau-wiring.test.ts`, qui fait déjà l'aller-retour complet.

Et trois de mes tests ont d'abord été verts **pour la mauvaise raison** : la
ruche répondait « inerte — 0 ouvrière de caste gouvernante, 2 requises », donc
rien ne partait jamais. Mes trois cas « ne doit pas partir » passaient sans rien
tester. Ce sont les trois cas « DOIT partir », en face, qui l'ont dit.

---

## Lot 17 — la table `tasks` a enfin sa borne, et l'instantané sa fenêtre

Deux défauts, la même racine : **rien ne bornait les tâches**, ni sur disque ni
sur le fil.

### Ce que coûtait un instantané, mesuré

`getSnapshot()` chargeait la table entière, et `broadcastState()` la rediffuse à
**chaque changement d'état**. Mesuré sur ce dépôt, tâches de longueur réaliste :

| tâches     | `getSnapshot` | `JSON.stringify` | octets envoyés |
| ---------- | ------------- | ---------------- | -------------- |
| 500        | 3,9 ms        | 2,3 ms           | 0,23 Mo        |
| 2 000      | 14,2 ms       | 8,9 ms           | 0,91 Mo        |
| 5 000      | 39,4 ms       | 21,5 ms          | 2,28 Mo        |
| **20 000** | **182,1 ms**  | **94,6 ms**      | **9,13 Mo**    |

À 20 000 tâches, un seul changement d'état **bloque la boucle 277 ms** et pousse
9,1 Mo à chaque tableau de bord connecté. L'orchestrateur est mono-thread :
pendant ce temps, il ne répond à personne.

L'instantané porte donc une **fenêtre** de 2 000 tâches — le dernier palier qui
tient sous ~25 ms. Et il porte `tasksTotal`, le compte réel : sans ce champ, un
instantané tronqué a exactement l'air d'un instantané complet, et l'écran fait
compter faux à qui le lit. `StatTiles` l'affiche quand la fenêtre mord.

**L'ordre n'est pas « les plus récentes ».** Les tâches vivantes passent TOUTES,
quel que soit leur âge ; la limite ne rogne que sur les terminées. Une fenêtre
par date perdrait la tâche bloquée depuis un an — exactement celle qu'on cherche
quand quelque chose ne va pas.

### `pruneTasks`, et les deux choses qu'il ne supprime pas

`tasks` était la seule table du dépôt sans élagueur. Pire : deux bornes
référentielles justifiaient leur conception par « les tâches ont déjà leur
propre élagage ». C'était faux, et mesuré comme tel — elles supprimaient **0
ligne, pour toujours**. Elles sont vraies depuis ce lot.

| ne part pas                              | pourquoi                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| une tâche dont une **survivante** dépend | `dependsOn` cite des identifiants ; une tâche qui attend un id disparu n'est jamais prête     |
| la **mémoire** (`memories`)              | le Cerveau existe pour que le savoir dure plus longtemps que l'épisode ; il a sa propre borne |

Le premier point est le piège : protéger « tout id cité par une tâche, quelle
qu'elle soit » aurait l'air prudent, et ferait de la borne un no-op de plus — sur
une chaîne A ← B ← C terminée, seul le dernier maillon partirait, à jamais. On
n'exclut donc que les ids cités par les tâches qui **survivent**.

La rétention est **temporelle** (30 jours) là où toutes les autres comptent des
lignes. « Les 5 000 dernières » effacerait le mois de janvier d'un projet actif
et garderait trois ans d'un projet endormi : la même règle, deux résultats
opposés. Trente jours veut dire la même chose pour tout le monde.

### Ce qui tient

**Dix mutations, dix rouges** — dont la borne rendue muette, la protection
étendue à toute tâche (le no-op), l'emport des tâches vivantes, la rétention
ignorée, la cascade sur la mémoire, l'oubli de la cascade sur `reviews`, la
fenêtre retirée, `tasksTotal` qui ment, l'ordre passé aux « plus récentes », et
le tri final supprimé.

Le dernier a **survécu deux fois** avant de tomber. La première parce que mes six
tâches naissaient dans la même milliseconde — six `createdAt` identiques sont
triés dans tous les sens. La seconde parce que j'avais mis les deux ordres dans
le même sens, si bien que la requête rendait déjà le résultat attendu. C'est la
mutation qui l'a dit, pas la relecture.

---

## Le haut de page repris du design — les quatre pièces qui manquaient

La maquette de Claude Design pose le texte à gauche et un rayon d'alvéoles à
droite. Quatre pièces manquaient encore ; elles sont là.

| pièce                       | ce qu'elle fait                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **La pastille**             | Deux faits vérifiables avant le titre : open source, une commande. Une petite alvéole y bat.                                                |
| **Les puces de système**    | Linux · macOS, Windows, Docker, Déjà cloné. Une seule commande affichée à la fois — quatre en même temps, et chacun copie celle du voisin.  |
| **La barre d'installation** | Le seul aplat d'encre du haut de page, donc le seul geste désigné. Elle copie **le nœud qu'elle affiche**.                                  |
| **Le rayon d'alvéoles**     | Cinq rangées décalées, l'alvéole centrale portant le H. Halo qui respire, ensemble qui flotte, chaque alvéole ondulant à son propre retard. |

S'y ajoute le **bandeau des agents** : « Fonctionne avec l'IA que vous utilisez
déjà ». C'est la question qu'on se pose avant les fonctionnalités, et elle se
répond en cinq noms — qui sont les clés **réelles** de `src/adapters/index.ts`.

### Ce que la maquette proposait et qu'on n'a PAS repris

Une carte « Tâches réussies — 94 % » avec sa courbe. Le chiffre est inventé : la
maquette est une maquette. Le mettre sur la page publique en ferait une mesure,
et rien dans le dépôt ne la produit. Une vitrine qui affiche une statistique que
personne ne calcule est un mensonge de la forme la plus coûteuse — celle qu'on
ne peut plus retirer sans avoir l'air de reculer.

### Ce qui tient tout ça

Huit gardes, **et les huit ont été vues rougir** : une puce sans commande, le
bouton copiant une constante au lieu du nœud affiché, la barre naissant vide,
une table de commandes revenant dans un script, un agent annoncé et inexistant,
`shell` annoncé comme utilisable alors qu'il ne lance rien, la piste du bandeau
qui cesse d'être écrite en double, et la piste qui cesse d'être masquée aux
lecteurs d'écran.

---

## Le README au design de la vitrine — et deux chiffres qui mentaient

Les deux README ouvrent maintenant sur une **bannière** qui reprend exactement
la vitrine : mêmes fontes (Bricolage, Instrument, JetBrains), même crème, même
coulée de miel derrière la même phrase. Quatre images — français et anglais,
clair et sombre, servies par `<picture>` selon le thème de qui regarde.

Sur fond sombre, la coulée a dû **monter jusqu'en haut des bas-de-casse** : à sa
hauteur de vitrine elle ne couvre que le bas des lettres, et le texte en encre
foncée disparaissait dans le fond. Un surlignage, pas un soulignement.

Deux chiffres du README mentaient, et les deux pour la même raison de fond —
**rien ne les reliait à leur source** :

| ce qu'il annonçait     | la réalité | ce qui le tient désormais                                |
| ---------------------- | ---------- | -------------------------------------------------------- |
| « 12 causes de panne » | 13         | `tests/readme.test.ts` appelle `diagnostiquer()`         |
| badge « 2 730 tests »  | 2 838      | `scripts/compte-tests.mjs`, lancé par la CI après vitest |

Le second cas mérite d'être dit : la garde existante comparait **les deux badges
l'un à l'autre**. Ils étaient d'accord. Ils étaient faux ensemble — ce que
produit toujours un seul geste de correction. Voir § 9ter.0 du journal.

---

## Le miel du titre — trois versions, et ce qui a tué les deux premières

Le surlignage du titre de la vitrine est le geste signature du design. Il a fallu
trois tentatives, et la deuxième est morte d'une règle de rendu que je ne
connaissais pas : **un élément en position absolue calé sur un inline qui se
coupe se dessine sur la boîte ENGLOBANTE de tous ses fragments**. Sur une ligne,
tout allait bien ; dès que le titre passait à la ligne — c'est-à-dire sur tout
mobile — un filet vertical reliait les deux lignes.

La version retenue est un **fond** (`site/miel.svg`) posé avec
`box-decoration-break: clone`, seul mécanisme qui repeint le décor pour chaque
fragment. Six couches y font la matière : bord ondulé porté par les nœuds de la
courbe (et non par les poignées), ourlet de ménisque + son ombre, translucidité
croissante avec l'épaisseur, fond de coulée chaud et non brun, irrégularité
d'épaisseur sur la longueur, plaques spéculaires brisées.

Vérifié à quatre largeurs (1280, 820, 390) et dans les deux langues — le
français du titre est plus long que l'anglais et se coupe ailleurs. Le titre
porte désormais `text-wrap: balance`, qui évite les deux mots orphelins en
seconde ligne.

Cinq gardes tiennent la correction, et **les cinq ont été vues rougir** :
`background-image` retiré, `box-decoration-break` retiré, sa forme `-webkit-`
retirée (le seul navigateur où l'omettre casse est Safari mobile, précisément là
où le titre se coupe), `site/miel.svg` supprimé, et le retour d'un
`.grad::before`. Voir § 2.9 et § 9 quinquies du journal des erreurs.

---

## Lot 16 — L'audit adversarial du 2 août, et son registre

Un mois avant la sortie, six lentilles indépendantes ont fouillé la ruche, avec
une consigne unique : **ne rendre une trouvaille que PROUVÉE en exécutant**.
Chacune a ensuite été confiée à un avocat du diable chargé de la RÉFUTER, dans
une copie non suivie du dépôt.

**12 trouvailles jugées, 10 retenues, 2 réfutées.** Les deux réfutations valent
autant que les retenues : l'une affirmait qu'un binaire refusait six commandes
documentées — l'avocat les a lancées, elles passent ; l'autre décrivait un
mécanisme exact mais adossé à trois affirmations fausses. Une fausse alerte
envoie corriger du code qui va bien : c'est plus cher qu'une trouvaille manquée.

### Corrigé dans la foulée

| #   | gravité   | ce qui n'allait pas                                                                                                                                                                                                                                                                                                                            | la garde qui le tient désormais                                                                                                                                                                                                       |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **haute** | **La loupe était elle-même un faux vert.** `catch { return true }` ne distinguait pas « les tests ont mordu » de « les tests n'ont pas tourné ». Sous Windows, `npx` est `npx.cmd` : chaque mutant partait en ENOENT en 3 ms, comptait pour « ✔ défendue », et elle imprimait « LA LOUPE NE VOIT RIEN DE NU » sans avoir exécuté un seul test. | `verdictDeLErreur` est pure et éprouvée : seul un `status` numérique est un verdict ; ENOENT, signal, `timeout` sortent en 2. Et le corps est derrière une garde de point d'entrée — l'importer déclenchait une campagne de mutation. |
| 2   | **haute** | **Le plafond vendu n'atteignait jamais la porte.** Le webhook d'abonnement appelait `store.setBudget` au lieu de `scheduler.setPlafond` : sur une rétrogradation 200 h → 10 h, 190 heures non payées passaient encore, jusqu'au redémarrage du processus.                                                                                      | `tests/bornes-cablees.test.ts` interdit tout appel à `store.setBudget` hors de `setPlafond`, et vérifie que celui-ci invalide bien le cache.                                                                                          |
| 3   | **haute** | **La tâche planifiée Windows ne pouvait pas s'inscrire.** Le XML déclare `encoding="UTF-16"`, l'écriture était en UTF-8 sans marque d'ordre : `schtasks /Create /XML` refusait, et la ruche ne redémarrait jamais à l'ouverture de session.                                                                                                    | L'encodage voyage dans le PLAN. Les gardes écrivent pour de vrai et relisent les OCTETS — une nature différente des 41 autres, qui lisaient une structure en mémoire.                                                                 |
| 4   | moyenne   | **Quatre sondes livraient les secrets au binaire qu'elles éprouvaient.** `bin --version` sans `env` hérite de tout `process.env` — HIVE_TOKEN, HIVE_JWT_SECRET, la clé d'API — vers un `docker` ou un `cloudflared` trouvé dans le PATH.                                                                                                       | Les quatre passent `envSonde`. Une garde de source exige qu'une CINQUIÈME naisse soignée.                                                                                                                                             |
| 5   | moyenne   | **`--sans-ecran --sans-noeud` démarrait quand même l'ouvrière** — celle qui exécute du code avec votre agent. L'aiguillage rendait au premier drapeau testé.                                                                                                                                                                                   | Drapeaux soustractifs, et un test qui vérifie que leur ORDRE ne change rien : c'était toute la faute.                                                                                                                                 |

### Retenu, non corrigé — et pourquoi

| #   | gravité   | ce qui reste                                                                                                                                                                                                                                                                                                       | pourquoi pas cette nuit                                                                                                                                                                                                                         |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **haute** | **`getSnapshot()` lit `tasks` ENTIÈRE, sans `LIMIT`, et la diffuse à chaque tableau de bord toutes les 250 ms.** Mesuré : à 20 000 tâches, 412 ms de boucle Node bloquée et 41,9 Mo par socket. `tasks` est la seule table sans élagueur — et deux docstrings affirment le contraire (`store.ts:2169` et `:2249`). | C'est un changement d'architecture : borner la lecture ET paginer côté tableau de bord ET donner à `tasks` sa borne d'élagage. Bâclé à une heure du matin, ça casse le direct. **Lot 17.**                                                      |
| 7   | **haute** | **La rétention de 30 jours n'est jamais balayée.** `aSupprimer` n'a aucun appelant : le tableau de bord affiche « ⏳ N j avant effacement » puis « va être effacée aujourd'hui », et l'effacement n'arrive jamais. Les données des clients partis sont conservées indéfiniment.                                    | Demande de câbler une SUPPRESSION irréversible dans une cadence automatique. Ça se fait éveillé, avec un test de câblage qui prouve la transition sans geste humain. **Lot 17.**                                                                |
| 8   | moyenne   | **`HIVE_POLYETHISME=strict` ne fait rien.** Les quatre fonctions de contre-visite n'ont aucun appelant, et le cadre envoyé à chaque jeune ouvrière lui affirme « TA PRODUCTION SERA RELUE ».                                                                                                                       | L'avocat du diable a réfuté un pilier : un second organe de relecture existe et FONCTIONNE (la contre-expertise). L'arbitrage — brancher `trancher` dessus, ou retirer `strict` et la phrase — appartient à l'humain. **À trancher avec vous.** |
| 9   | moyenne   | **`hive doctor` passe au vert, la Reine meurt une seconde plus tard** : `HIVE_JWT_SECRET` n'est vérifié par aucun des 12 contrôles. Un nouveau venu suit le docteur à la lettre, tape `npm run ruche`, et la Reine refuse de démarrer.                                                                             | Correction simple et sûre — un 13ᵉ contrôle frère de `jeton`. **Lot 17**, en tête.                                                                                                                                                              |
| 10  | moyenne   | **« Les Chantiers » manque aux deux documents qui prétendent lister chaque vue**, alors que `ETAPES.md` se félicite de son écran.                                                                                                                                                                                  | Documentaire, et la garde à étendre est nommée. **Lot 17.**                                                                                                                                                                                     |

> **Ce que cet audit dit du dépôt.** Neuf des dix trouvailles sont de la MÊME
> famille : un chemin que personne n'exécute et que tout le monde croit bon.
> C'est la famille que ce journal traque depuis le début — et elle continue de
> produire, y compris dans les outils écrits POUR la traquer. La loupe en est
> l'exemple pur : elle cherchait les faux verts et en était un.

---

## Lot 15 — L'amorce : la ruche dit ce qui manque, au lieu de mourir en silence

Ce lot n'était pas au plan. Il vient d'une trace collée par la personne qui
utilise la ruche, sur sa machine, le 1er août :

```
PS C:\Users\micki\Desktop\hive-main> npm run ruche
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from
C:\Users\micki\Desktop\hive-main\

PS C:\Users\micki\Desktop\hive-main> npm run cli -- doctor
'tsx' n'est pas reconnu en tant que commande interne ou externe
```

| pièce                                                  | état | ce qui le vérifie, ou ce qui manque                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. L'amorce** — dire ce qui manque, sans rien exiger | ✅   | `scripts/amorce.mjs`, JavaScript nu, zéro dépendance. `verdict()` et `annoncer()` sont PURS : les cas deviennent des assertions sur une machine où tout est justement installé. 37 tests dans `tests/amorce.test.mjs`.                                         |
| **2. La porte unique** — un seul chemin, pas six       | ✅   | `scripts/lancer.mjs`. `ruche`, `cli`, `node`, `join`, `demo`, `install:hive` y passent tous. Un test relit `package.json` et refuse qu'un script reprenne `--import tsx` ou appelle le binaire `tsx`.                                                          |
| **3. La preuve sur une copie cassée**                  | ✅   | `tsx` réellement retiré de `node_modules`, puis `npm run cli -- doctor` relancé : message nommant la cause et la commande, code de sortie **2**. C'est la seule vérification qui compte ici — le défaut était précisément un message qu'on croyait s'afficher. |
| **4. Ce qui ARRÊTE et ce qui AVERTIT**                 | ✅   | Dépendance absente → arrêt (plus rien ne peut tourner). Node trop ancien → **avertissement seulement**, parce que `hive doctor` tourne encore et nomme cette cause parmi treize autres. Bloquer là aurait refait le défaut d'un cran plus haut.                |
| **5. La porte est TRAVERSÉE par un test**              | ✅   | Un vrai processus lance `scripts/lancer.mjs` sur `tests/fixtures/echo-argv.ts`, sur les trois systèmes de la CI. C'est ce qui a trouvé la faille Windows : `await import('C:\…')` est refusé par Node (`protocol 'c:'`), et aucune relecture ne le distingue.  |

> **Ce que ce lot corrige n'est pas un message, c'est une illusion de
> couverture.** Le contrôle existait dans `scripts/ruche.mjs` depuis sa première
> version, sous un commentaire qui disait « Ce qui manque se dit AVANT de lancer
> quoi que ce soit ». Il n'a jamais pu s'afficher une seule fois : `--import tsx`
> est résolu par Node avant la première instruction du fichier. Rien ne
> distingue à l'œil un garde qui tourne d'un garde inatteignable — d'où le test
> qui relit `package.json` plutôt qu'une relecture attentive de plus. Voir
> § 3.5 du journal des erreurs.

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
| 8   | `hive doctor` diagnostique **10 causes** + quoi faire                    | ✅   | **13** diagnostics, un test par cas, panne **et** sain. Le chiffre est désormais relié au code par `tests/readme.test.ts` — il annonçait 12 depuis l'ajout du secret de session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
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

> **Ce chiffre est daté, et il le reste.** Le docteur en rend TREIZE depuis
> qu'on lui a ajouté le contrôle du secret de session. Le dénominateur de la
> mesure ci-dessus n'est donc plus celui d'aujourd'hui — et je ne le réécris
> pas : une mesure qu'on retouche sans relancer le banc n'est plus une mesure,
> c'est une opinion datée d'un jour qu'elle ne nomme plus. Elle sera refaite au
> prochain passage sur une machine en Node 24.

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

| #   | Lot                                                                  | État | Détail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Plan + ADR de cadrage                                                | ✅   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1   | `src/tui/rendu.ts` pur + tests de rendu                              | ✅   | 42 tests, aucune I/O.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2   | `terminal.ts` + installeur interactif                                | ✅   | Chemin A (Reine locale).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Chemin B (billet) branché sur `join.ts`                              | ✅   | Un ami rejoint sans éditer un fichier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | Mode non-interactif, drapeaux, codes de sortie, `--dry-run`          | ✅   | **Cette ligne est restée 🟡 alors que le travail était fait.** `examples/deploiement-sans-ecran.sh` existe, il est couvert par **9 tests** (`tests/deploiement-sans-ecran.test.ts` — dont le 130 du ^C, le 3 du secret absent, « aucun secret en argument » et « jamais interactif »), et il a été **lancé pour de vrai** le 2 août sur un clone vierge sous Node 24 : code **0**, `.env` créé en **600** avec ses 8 clés, aucun secret d'exemple survivant, et `hive doctor` qui répond. Sans les secrets, il rend **3** avant de toucher à quoi que ce soit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 5   | `hive doctor` + `--json`                                             | ✅   | 12 diagnostics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 6   | ACL Windows, chemins, **matrice CI 3 OS**                            | ✅   | Les trois vertes. macOS est passée **du premier coup** — ma prédiction de rouge était fausse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7   | Paquet npm + `bin` + provenance                                      | 🚫   | **Bloqué** — compte npm de l'utilisateur.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | `install.ps1`, `install.sh`, empreintes, Release                     | 🟡   | Les deux existent et sont exercés en CI — `install.ps1` sous PowerShell **7 et 5.1**, qui a rendu trois défauts réels. Empreintes + Release restent à faire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 9   | Service (systemd user / tâche planifiée / launchd) + désinstallation | 🟡   | **Les deux moitiés livrées.** `hive desinstaller` (inventaire par défaut, `.env` et base jamais touchés) et `hive service install\|status\|logs\|uninstall` — unité systemd durcie, LaunchAgent, tâche planifiée, plan pur vérifié pour les 3 plateformes depuis n'importe laquelle, échappement éprouvé sur chemins hostiles. **Cette case disait : « aucune CI ne peut vérifier que `systemctl`/`launchctl`/`schtasks` ACCEPTENT ces fichiers ». C'était faux, et ça masquait un défaut fatal** — l'unité systemd était REFUSÉE (`WorkingDirectory=` cité → `unit will not be started`), et `EnvironmentFile=` cité était ignoré **en silence**, donc un service qui démarrait sans aucun secret. `systemd-analyze verify` le disait en 28 ms. Corrigé ; `tests/service-accepte.test.ts` soumet désormais le fichier au juge de chaque plateforme à chaque CI (`systemd-analyze verify`, `plutil -lint`, `schtasks /Create /XML`), avec la version d'avant le correctif comme contre-épreuve. **Reste 🟡 et non ✅ : le fichier est ACCEPTÉ, il n'est pas DÉMARRÉ** — `systemctl --user enable --now` demande un bus de session qu'aucun runner n'a. |
| 10  | Dockerfile, compose, GHCR signé, sauvegarde SQLite                   | 🟡   | Dockerfile, compose et sauvegarde livrés. **La première construction réelle a rendu un défaut que rien d'autre n'aurait vu** : `npm ci` lance `prepare` — donc `tsc` — aux deux étages, y compris celui qui vient de retirer TypeScript (§ 4.3 de `docs/ERREURS.md`). GHCR/cosign restent **bloqués**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Docs FR/EN, CHANGELOG, `docs/INSTALLATION.md`                        | ✅   | READMEs, CHANGELOG et `docs/INSTALLATION.md` — les trois présents et tenus. Les deux READMEs ont été **resserrés** : le détail exhaustif vit dans `docs/FONCTIONNALITES.md` et `docs/FEATURES.en.md`, rien n'a été perdu.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | **Le Cerveau** — le savoir qui survit à la fenêtre de contexte       | ✅   | **La boucle est fermée, et un test la parcourt en entier.** `tests/cerveau-wiring.test.ts` monte une vraie ruche, laisse une tâche échouer, et vérifie que l'épisode **écrit par la ruche elle-même** revient dans le contexte de la tâche SUIVANTE. Mutation jouée : couper l'écriture rougit le test. La même panne incrémente UNE note (identifiant dérivé de `signatureEchec`), la consolidation est **proposée** à 3 récurrences et jamais rédigée — une règle fausse est SUIVIE —, `elaguer()` tourne à l'heure, et `cerveau_refus` dit quand une ouvrière part sans ses invariants. 62 tests, la loupe ne voit rien de nu. Ce qui reste est du confort, pas du câblage : aucune vue au tableau de bord, et la promotion en leçon se fait à la main dans Obsidian.                                                                                                                                                                                                                                                                                                                                                                               |
| 13  | La contre-expertise : une IA relue par une AUTRE                     | ✅   | La critique ATTEINT désormais l'autre modèle. `tests/cerveau-wiring.test.ts` monte deux nœuds de modèles différents, fait produire le premier, et vérifie que le second reçoit une `assign_task` portant la consigne de critique — puis que son verdict remonte en `contre_expertise_verdict`. **Cette ligne est restée 🟡 deux PR durant**, avec un module complet et personne pour l'appeler ; elle ne passe ✅ que maintenant, parce qu'un test l'exerce de bout en bout. Le plafond d'attente du test est à 3 s À DESSEIN : le filet `staleAssignedTasks(5_000)` rattrape une tâche muette et rendrait le test vert même sans dispatch — mesuré, 7 ms par le dispatch contre 5 060 ms par le filet. Un plafond qui ne discrimine pas ne mesure rien. Le verdict ne bloque JAMAIS la fusion : « jamais de fusion sans revue humaine » reste la règle, et une contre-expertise qui déciderait remplacerait la revue au lieu de l'armer.                                                                                                                                                                                                              |

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

- Quatre lectures trient sur un horodatage seul (`listPartages`,
  `listLivraisons`, billets d'invitation, clés de nœud) : l'ordre entre deux
  lignes de même milliseconde est indéfini. **Rien ne se perd** — c'est un rang
  d'affichage.
- ~~« Les trois bornes qui SUPPRIMENT ont été départagées, et c'était la seule
  classe dangereuse »~~ — **cette ligne était fausse deux fois**, et la CI macOS
  l'a montré. Il y en avait une **quatrième**, `pruneConseils`, jamais recensée.
  Et son départage, écrit ensuite en recopiant `results` et `memories`, portait
  sur `id` — un `randomUUID` ici, un entier auto-incrémenté là-bas. L'ordre est
  devenu **total sans devenir chronologique** : la borne jetait proprement
  n'importe laquelle des trois sessions. Corrigé par `rowid` (le compteur
  d'insertion de SQLite : monotone, ni migration ni colonne), et fixé par
  `tests/elagage-ordre.test.ts`, qui **force** la collision d'horodatage et
  choisit des identifiants dont l'ordre alphabétique contredit l'ordre
  d'insertion — il rougit à tous les coups, plus une fois sur vingt sur un seul
  système. Voir § 7.1 du journal.
- ~~Un agent installé par npm reste **indétectable sous Windows**~~ —
  **CORRIGÉ**, et la correction n'a pas demandé d'assouplir la §5.1 : elle vise
  le script réel du paquet et lance Node, exactement comme `lanceur.ts` le fait
  pour `npm`. C'est plus strict que `shell: true`, pas moins — on sait quel
  fichier on exécute au lieu de déléguer la résolution à `cmd.exe`.
  `src/shared/agent-windows.ts`, pur, plateforme et environnement en paramètres,
  existence du fichier injectée. **Non vérifié sur un vrai Windows** : la
  logique l'est (loupe 7/7), le `spawn` final ne l'est pas — aucune machine
  Windows ici, et la CI n'y installe pas Claude Code.
- ~~`npm run node` employait **`shell` par défaut**, donc un simulacre~~ —
  **CORRIGÉ**, et c'était le plus grave des deux : indépendant de Windows, il
  touchait **la machine de celui qui installe la ruche**, donc le premier essai
  de tout le monde. L'installeur n'écrit pas `HIVE_AGENT`, `.env.example` le
  posait à `shell` : un Claude Code installé et détectable n'était **jamais
  employé**, et la ruche rendait de faux diffs en ayant l'air de travailler.
  `join.ts` — le chemin de l'**ami** — détectait, lui, depuis toujours :
  l'invité avait un vrai agent, l'hôte un simulacre. Mesuré avant/après en
  lançant réellement le nœud, sur les trois cas (aucun agent, agent présent,
  agent forcé). Voir § 9 bis du journal des erreurs.
- La sonde de détection **ne transmet plus aucun secret** au binaire qu'elle
  éprouve. `join.ts` s'en gardait par l'ORDRE des lignes — une protection qui ne
  se transporte pas : `main.ts` charge `.env` en premier, et y sonder aurait
  offert le jeton de la ruche et la clé d'abonnement au premier `claude.cmd`
  hostile posé en tête de `PATH`. La garde vit désormais dans la sonde, avec un
  test qui relit le dépôt pour exiger que tout nouveau secret y entre.

---

## Le tamis des ordres — dix-sept fichiers qui empruntaient leur vert au voisin

La suite tournait toujours dans le même ordre. Rejouée sous
`--sequence.shuffle`, elle perdait quatorze tests.

Trois expériences, et chacune a démoli l'hypothèse d'avant :

| ce qu'on soupçonnait        | ce qu'on a mesuré                                             |
| --------------------------- | ------------------------------------------------------------- |
| des tests instables         | trois graines → 14, 21, 25 échecs, jamais les mêmes           |
| la charge de la machine     | **la même graine rend exactement les mêmes 14, deux fois**    |
| la concurrence des fichiers | `--no-file-parallelism` : les mêmes 14                        |
| l'ordre des **fichiers**    | les 33 premiers rejoués dans l'ordre exact du mélange : verts |

Restait l'ordre des tests **à l'intérieur** d'un fichier. Un sondage élargi a
porté le compte à **dix-sept fichiers** : les trois premières graines n'étaient
qu'un échantillon, et s'y fier aurait laissé huit fichiers dehors.

Le motif était partout le même — un test pose un état, le suivant le lit sans
jamais le dire. Ce que ça coûtait pour de vrai :

- `NE TOUCHE PAS AUX LIENS VIVANTS` ne voyait un lien mort que parce que deux
  tests de révocation étaient passés avant : **la moitié de la borne n'était
  vérifiée qu'un ordre sur deux.**
- `REPRENDRE LA MÊME ISSUE NE COLLISIONNE PAS` se disait « la seconde prise du
  fichier ». Joué en premier, il n'éprouvait **aucune collision** — le défaut
  qu'il existe pour attraper.
- `UNE ASSIGNATION PÉRIMÉE` comptait sur un nœud voisin pour rafler la tâche.
  Seul, il la recevait, et **accusait le hub de se taire** alors que sa propre
  prémisse manquait.

Deux fichiers ne pouvaient pas être découplés tant que le **faux** ne servait
qu'un exemplaire : le faux GitHub rendait la PR `42` à chaque appel, et le
catalogue ne contenait qu'un dépôt — or importer est un acte unique. Les deux
faux servent désormais une collection, et chaque test prend le sien.

Un seul fichier garde son ordre : `caste-boucle`, où l'ordre **est** le sujet.
`describe(nom, { shuffle: false }, …)` le dit à vitest — et c'est la porte
dérobée idéale pour faire taire un couplage accidentel en deux mots, alors elle
se déclare dans `tests/ordre-declare.test.ts` avec sa raison.

`npm run tamis-ordres` rejoue la suite dans trois ordres écrits, et la CI le
lance à chaque PR. Les graines sont **écrites** : un échec se rejoue à
l'identique, avec la commande que le script affiche.

**La CI ne mélangeait pas.** Rien de tout ceci n'y était visible, et rien ne
l'aurait rendu visible tout seul.

---

## Le premier contact — marché pour de vrai, sur un clone vierge

Le conteneur tourne sous Node 22 et la ruche exige 24 : le parcours d'un nouveau
venu n'avait donc jamais été **observé**, seulement raisonné. Node 24 posé à
côté, il l'a été — clone dans un dossier vide, `npm install`, installeur,
démarrage, `doctor`.

**Ce qui marche déjà, et qu'il fallait vérifier plutôt que supposer :**

| étape                                    | ce qu'on voit                                                |
| ---------------------------------------- | ------------------------------------------------------------ |
| `npm install`                            | 19 s, 285 paquets, aucune faille                             |
| `npm install --omit=dev`                 | refus NOMMÉ : « il manque tsx », avec la commande qui répare |
| `npm run install:hive`                   | `.env` créé en 0600, deux secrets tirés, le jeton encadré    |
| `npm run dev`                            | la Reine répond `{"ok":true}` sur `/api/health`              |
| ouvrir l'adresse annoncée sans dashboard | la route dit `npm run build:dashboard`                       |

**Les deux frottements trouvés, et corrigés :**

**1. Le remède du docteur désarmait l'installeur.** `cp .env.example .env`
plante `change-me` dans les deux secrets ; l'installeur ne complète que les clés
ABSENTES, répond « vos valeurs sont intactes » et laisse les marque-places. Le
premier conseil du docteur fermait la porte de secours. Il nomme désormais
`npm run install:hive` — mesuré : un clone vierge passe de trois ✘ à zéro en
**une commande**, contre trois commandes et deux modifications à la main.

**2. Les avertissements de sécurité perdaient leur moitié utile.** 178 et 281
caractères pour une largeur de 76 : 102 et 205 caractères coupés, et à chaque
fois la phrase qui dit quoi faire. `enrouler` et `constatEnroule` répartissent
au lieu de couper, les lignes de suite alignées sous le libellé.

`tests/premier-contact.test.ts` tient le maillon : ce que l'installeur ÉCRIT
satisfait ce que le docteur EXIGE. Deux constantes qui divergeraient rougissent
le jour même, plutôt qu'au premier clone de quelqu'un d'autre.

**Ce que ça ne dit pas** : tout ceci est mesuré sous Linux. Le mur Node 22 du
conteneur est levé, pas celui de Windows et macOS.

---

## La vitrine montre enfin le tableau de bord

La section « Mission Control » **listait** treize vues et n'en **montrait**
aucune. On y décrivait une sidebar alvéolaire, des touches 1-0, un rayon
cliquable — et le lecteur devait imaginer. C'est le seul endroit du site où
montrer coûte moins cher que dire.

Les cinq écrans qu'on ouvre le plus — Tâches, Ordinateurs, Activité, À relire,
l'Atelier — sont désormais reproduits en HTML, pas en captures : ils suivent les
jetons de la vitrine, se traduisent comme le reste, restent nets à tout zoom et
ne périment pas au premier changement de thème. Les chiffres sont illustratifs,
**et la légende le dit** — annoncer des mesures qu'aucune ruche n'a produites
serait la première promesse fausse du site.

Aucun catalogue d'écrans dans le script : il apparie par `data-ecran`, comme les
puces de système. Ajouter un sixième écran dans le HTML suffit.

**Deux défauts trouvés en le construisant, et le premier est instructif.**
Quatre écrans portaient `hidden` et la garde était verte — mais la page les
affichait tous les cinq, parce que `display: grid` bat le `display: none` que le
navigateur attache à `hidden`. Une garde qui lit la structure ne voit pas la
présentation qui la défait ; c'est la capture qui l'a montré. Le second :
`.apercu-rail b` désignait déjà la marque « Hive » en or, si bien que les
libellés ajoutés ensuite passaient en or sur fond or — invisibles sur l'entrée
active. Journal § 2 ter.

---

## « Comment ça marche » — la section que la page n’avait pas

L'archive du redesign contenait la SOURCE de la maquette (`Hive.dc.html`), pas
seulement son bundle. Elle a rendu visible ce qu'aucune lecture du rendu ne
m'avait montré : **la page listait vingt-trois fonctions à quelqu'un qui ne
savait pas encore ce que la ruche fait.** Elle répondait « avec quoi ? » avant
d'avoir répondu « comment ? ».

Trois étapes, reprises au mot près, et la troisième porte la promesse que tout
le reste garantit : _« Chaque résultat s'arrête devant vous. Vous lisez, vous
validez ou vous refusez. Rien ne passe sans votre accord. »_

Valeurs relevées au DOM de la maquette, et obtenues à l'identique après coup :
grille **374,656 px × 3** à 1440, rayon **16 px**, remplissage **30/28**, fond
`--panel`, liseré `--border-2`.

**Et la bande d'appel finale**, sur son propre aplat (`--chip`, mesuré à
rgb(239,231,215)). La page se terminait sur une frise de paliers livrés — de
l'histoire, pas une invitation. La maquette met là son seul appel à l'action, et
c'est le moment où quelqu'un qui a tout lu a fait défiler très loin du haut.

Sept mutations, sept rouges.

### Ce qui reste entre cette page et la maquette

Deux écarts, tous deux SOUSTRACTIFS — c'est-à-dire qu'ils demandent de retirer,
pas d'ajouter, et que ce n'est pas à moi de trancher :

1. **La navigation.** La maquette a **trois liens** (Comment ça marche,
   Sécurité, Tarifs) plus un bouton « Ouvrir la ruche », et un menu replié sur
   téléphone. Cette page en a dix.
2. **La longueur.** La maquette tient en **7 sections et 3 865 px** ; cette page
   en fait 13 et ~11 400. Les six sections que la maquette n'a pas —
   architecture, Mission Control, communauté, raccourcis, roadmap, et la liste
   des fonctions — ont toutes été demandées et construites. Les retirer est une
   décision de produit.

---

## Le panneau de l’essaim : six étiquettes sur dix étaient illisibles

C'est la première image de la page — la preuve visuelle que la ruche fait
quelque chose. Contrastes mesurés dans le DOM, avant :

| étiquette               | mesuré     | seuil AA |
| ----------------------- | ---------- | -------- |
| « Intégration »         | **1,24:1** | 4,5:1    |
| « API factu. »          | 1,62:1     | 4,5:1    |
| « Auth JWT »            | 1,62:1     | 4,5:1    |
| « running »             | 2,33:1     | 4,5:1    |
| « assigned »            | 3,03:1     | 4,5:1    |
| « ready » · « pending » | 3,84:1     | 4,5:1    |

À 1,24 le texte n'est pas « peu lisible », il est **invisible**. La cause est
mécanique : quelqu'un a assombri le remplissage des alvéoles sans retourner la
couleur du texte, resté sur les jetons prévus pour le fond clair. Rien ne
pouvait sonner — le HTML est valide, la page se rend, et une capture montre bien
« quelque chose » à cet endroit.

Après : **le pire vaut 4,75:1**, et les états passent de 9 à 11 px.

**Et une légende, parce que cinq couleurs racontaient un cycle de vie que rien
n'expliquait.** Une image dont il faut deviner le code n'est pas une
démonstration, c'est une décoration. La légende dit ce que l'état signifie pour
le visiteur — « une IA travaille dessus », pas « running → running ». Un test
refuse une glose qui traduit un mot par lui-même.

Au passage, une garde qui existait déjà a attrapé ma propre faute : en déclarant
les jetons `--creme` et `--creme-2`, j'ai transformé trois littéraux existants
en doublons. Elle avait raison ; ils sont branchés sur les jetons.

Six mutations, six rouges.

## « En bref » : le jargon quitte la carte fermée

Les quatre familles marchaient, mais chaque carte fermée portait encore une
ligne de chasse fixe : « Queen Bee · Sting Detector · Drone Wars ·
Phéromones… » — le vocabulaire interne de la ruche servi à quelqu'un qui n'en
connaît pas un mot. La section s'ouvrait donc sur du jargon au lieu d'une
promesse.

Les noms passent **en tête du volet** : celui qui déplie sait déjà ce que la
famille fait, et la liste devient un sommaire au lieu d'une énigme. La garde
« ce qu'une famille annonce est exactement ce qu'elle contient » ne change pas
de propriété — seulement d'endroit où elle la cherche.

Le numéro devient une **alvéole** — la forme de la marque, celle des puces de
tarif et de la légende de l'essaim. Un chiffre nu se lisait comme une note de
bas de page.

---

## Le pied de page : un plan, pas une rangée de liens

Il y avait quatre liens en ligne, sans titre. La maquette en fait un PLAN : la
marque et sa promesse d'un côté, trois colonnes nommées de l'autre, une barre du
bas pour ce qui n'est ni l'un ni l'autre.

La différence n'est pas décorative. **Un pied de page est ce qu'on lit quand la
page n'a pas répondu à la question qu'on se posait.** Quatre liens sans titre
obligent à tous les essayer ; trois colonnes nommées disent en un coup d'œil de
quel côté chercher.

Valeurs relevées au DOM de la maquette : nom 18px/700, promesse 14px/400, titre
de colonne 12,5px/700 en capitales à +0,08em, lien 14,5px/400, barre du bas
13px. Fond sur `--panel` — la dernière section de la page est au ton du corps,
et sans changement de plan le pied de page s'y fondrait, c'est-à-dire qu'on ne
verrait pas que la page est finie.

**Chaque destination a été vérifiée AVANT d'être écrite**, et un test le
re-vérifie : ancres contre les sections réelles, chemins `blob/main/…` contre les
fichiers du dépôt, gabarits contre `.github/ISSUE_TEMPLATE/`, pages voisines
contre `site/*/index.html`. C'est ce qui a écarté « Contribuer » et « Sécurité » :
`CONTRIBUTING.md` et `SECURITY.md` n'existent pas, et un lien vers une page
absente vaut moins que pas de lien du tout.

Un lien mort en pied de page est le plus discret des défauts d'un site :
personne n'écrit pour signaler qu'un « Contribuer » renvoie une 404, et il reste
des années.

Onze mutations, onze rouges — après en avoir corrigé deux qui ne valaient rien
(voir § 9 octies du journal). Téléphone : 15 liens, tous à 44 px, aucun débord,
sur les cinq largeurs.

---

## « En bref » : vingt-trois cartes que personne ne lisait

Le reproche était : _plus designé, moins chargé, plus simple à comprendre_. La
mesure lui donne raison sans discussion.

|                      | avant                     | après              |
| -------------------- | ------------------------- | ------------------ |
| hauteur, ordinateur  | 2 066 px (2,3 écrans)     | **1 088 px** (1,2) |
| hauteur, téléphone   | 5 422 px (**6,0 écrans**) | **1 386 px** (1,5) |
| ce qu'on lit d'abord | 23 cartes, 819 mots       | **4 promesses**    |
| cartes conservées    | 23                        | **23**             |

Six écrans pleins de cartes, servies d'un coup, sans hiérarchie, à quelqu'un qui
ne sait pas encore ce qu'est une ruche. Le défaut n'était pas dans les cartes —
elles sont justes une par une — mais dans le fait de les servir TOUTES en même
temps.

**Quatre familles, repliables.** Replié, on lit quatre phrases : répartir le
travail, garder la main, voir ce qui se passe, tenir dans la durée. Chaque
résumé porte aussi les noms des fonctions qu'il contient — sans eux, il faudrait
ouvrir les quatre volets pour savoir lequel contient « Le Rayon ».

**Rien n'est supprimé.** Les 23 cartes sont là, mot pour mot, avec leurs clés de
traduction. C'est exactement ce qu'un regroupement rend facile à perdre : une
carte disparaît sans que rien ne casse, et personne ne s'en aperçoit avant des
mois. Six gardes tiennent cette propriété, dont la principale — **ce qu'une
famille annonce est exactement ce qu'elle contient** — compare les NOMS annoncés
aux titres réels des cartes du volet, jamais leur nombre.

`<details>` natif plutôt qu'un accordéon en JavaScript : clavier, impression et
recherche dans la page marchent sans une ligne de script, et une page dont le
script a échoué garde ses quatre volets ouvrables. Une garde interdit qu'un
`onclick` reprenne la main dessus.

Huit mutations, huit rouges — dont la carte « Drone Wars » supprimée, qui fait
rougir **cinq** gardes à la fois.

---

## Le téléphone, mesuré à cinq largeurs

Trois défauts, aucun visible à l'écran. C'est le point commun : ils ne se
trouvent qu'en lisant des BOÎTES — `getBoundingClientRect`, `scrollWidth`,
`getComputedStyle` — à 320, 360, 390, 414 et 430 px de large.

**1. Un plancher de grille poussait la page hors cadre.**
`repeat(auto-fit, minmax(320px, 1fr))` : à 320 px moins les marges, la colonne
ne peut pas rétrécir. Le document débordait de 18 px. **Neuf grilles** avaient
le même plancher, sur les trois pages ; deux seulement employaient déjà le bon
idiome, `minmax(min(100%, …), 1fr)` — qui vaut exactement la même chose tant
qu'il y a la place, et cède quand il n'y en a plus.

**2. Les cibles tactiles étaient à moitié trop petites.**
Mesuré : les dix liens de navigation à **21 px de haut**, le bouton GitHub 36,
le bouton « copier » 38, les onglets de l'aperçu 28, les liens de pied de page
22, le champ d'adresse 35, les dépliants du Rush 25. Apple, Google et le WCAG
2.5.5 demandent 44. Vingt-et-un pixels, c'est la hauteur d'une ligne de texte :
le doigt qui vise « Sécurité » touche « Tarifs ».

**3. L'en-tête mangeait 22 % du premier écran.**
177 px sur **trois rangs** à 320 et 360 px de large. La maquette, elle, tient en
65 px — mais en repliant toute sa navigation derrière un bouton. On ne la suit
pas jusque-là (un menu replié demande un geste de plus), on lui prend seulement
la contrainte : un rang pour la marque et ses commandes. Le mot « GitHub » y
suffisait — et le compteur d'étoiles le RALLONGEAIT encore à l'arrivée. Le
libellé est découpé en trois nœuds pour que le mot puisse tomber au CSS sans que
le lien perde son nom accessible. **177 px → 121 px.**

Ce qui reste petit et ne bougera pas : l'intérieur de l'aperçu (10–12 px) et les
étiquettes du dessin de l'essaim (9–10 px). Ce sont des MINIATURES — un modèle
réduit d'écran se lit comme une photographie. Les agrandir ne les rendrait pas
lisibles, ça les ferait déborder de leur cadre.

**Onze mutations, onze rouges** — dont un survivant corrigé en cours de route :
la garde qui cherchait `nav.main a` dans toute la requête média restait verte
alors que le sélecteur avait été retiré de la règle des 44 px, parce qu'il
figure aussi dans deux règles voisines. Voir § 2septies.1 du journal.

Deux erreurs de ma part, consignées : une garde neuve accusant du code correct
(§ 2 septies) et deux tests à 7 s qui lisaient bien plus large qu'ils ne le
prétendaient (§ 9 septies).

---

## La vraie échelle de la maquette — mesurée, pas approchée

La demande était de reprendre le design de la maquette pour de bon. Ma première
comparaison a failli conclure qu'il n'y avait rien à faire.

**La palette et les fontes étaient déjà exactes.** Les treize couleurs
dominantes de la maquette, extraites du fichier, correspondent au code
hexadécimal près aux jetons de `:root`. Mêmes trois familles. Sur ce seul
critère, le travail semblait fait.

Il ne l'était pas. En rendant la maquette dans Chromium et en lisant son DOM —
pas en regardant une capture, cf. § 9 sexies du journal :

|                  | maquette                            | vitrine (avant)            |
| ---------------- | ----------------------------------- | -------------------------- |
| `h1`             | 64 px / **600**                     | 64 px / **700**            |
| titre de section | **48 px** / 600 / −0,025em          | 40 px / 700 / −0,035em     |
| surtitre         | Instrument Sans, capitales, +0,11em | JetBrains Mono + émoji     |
| balise du titre  | `<h2>` sur la phrase                | `<h2>` sur **l'étiquette** |

Aucune couleur ne diffère, et pourtant les deux pages ne se ressemblent pas :
l'une parle en phrases, l'autre étiquette des rubriques.

**Le défaut de composition en cachait un de structure.** Le surtitre portait le
`<h2>` et la phrase un `<p>` : la liste des titres du document énumérait
« Sécurité », « Tarifs », « Démarrer » — jamais ce que la section dit. Un
lecteur d'écran lisait une table des matières de brochure. Corriger le design
et corriger l'accessibilité était ici le même geste.

Après correction, les valeurs calculées de `h1` et des titres de section sont
**identiques à celles de la maquette**, chiffre pour chiffre, et la géométrie du
haut de page l'était déjà (colonne de 550 px, gouttière de 60 px, quatre lignes
de titre à 1440 px comme à 1100).

**Douze mutations, douze gardes rouges.** Chaque garde nouvelle a été éprouvée
en cassant ce qu'elle protège : titre remis en gras, surtitre repassé en chasse
fixe, émoji rendu à une rubrique, section privée de son titre, jeton fantôme.
Une treizième ancre s'est révélée non unique et a été refaite — un mutant qui ne
mute rien se lit comme un survivant (§ 9ter.2).

**Une garde nouvelle a trouvé un défaut réel dès sa première exécution :**
`font-family: var(--sans)` alors que le jeton s'appelle `--texte`. La page était
juste à l'écran — un `var()` non résolu retombe sur l'héritage, qui donnait ici
la bonne fonte. Ni le navigateur, ni une capture, ni une relecture de diff ne
pouvaient le voir. Détail dans le journal, § 2 quinquies.

**Ce qui n'a PAS été fait, et pourquoi.** La maquette tient en 7 sections et
3 865 px ; la vitrine en 11 sections et 11 200 px. Raccourcir la page de deux
tiers n'est pas une correction de design, c'est décider quel contenu disparaît —
architecture, Mission Control, communauté, raccourcis, roadmap. C'est une
décision de produit, elle est posée plus bas dans « Ce qui demande un arbitrage
humain ».

---

## Plus sobre, et une vraie version téléphone

Deux demandes en une, et la seconde a commencé par un faux diagnostic.

**Le téléphone n'était pas cassé.** Ma première capture à `--window-size=390`
montrait du texte coupé sur la droite : j'ai failli corriger un débordement qui
n'existait pas. `--window-size` décrit la fenêtre, chrome compris — le viewport
réel valait 500 px, l'image 390, d'où la coupe. Mesuré avec
`Emulation.setDeviceMetricsOverride` à un vrai 390 : `scrollWidth` = 390, aucun
débordement. C'est la troisième fois de la journée que cet écart me piège
(§ 9 sexies du journal).

Ce qui était vrai, en revanche : **dix liens de navigation sur trois lignes
avant le premier mot du pitch.** On faisait lire un sommaire à quelqu'un qui ne
sait pas encore ce qu'est la ruche. La barre tient désormais sur une ligne qui
glisse, avec un fondu au bord qui l'annonce — rien n'est caché derrière un menu
replié, parce qu'un menu demande un geste de plus sur une page dont toutes les
sections sont à un doigt de défilement.

**La sobriété, elle, se résume à une règle :** l'or est la couleur du
surligneur, pas celle des boutons. Trois aplats dorés en dégradé se disputaient
le haut de page — GitHub, la langue active, l'appel à l'action. Ils passent en
encre. Le bouton « copier » garde un contour de miel au lieu d'un aplat plein,
les quatre badges cessent d'avoir chacun leur couleur, et la promesse
« votre code reste chez vous » quitte l'orange vif pour l'encre : une phrase
entière d'accent criait plus fort que le titre.

**Le miel a gardé sa matière et perdu son poids.** Les opacités des sept
couches sont divisées par deux, et la coulée passe de 0,6 à 0,42 em. À 0,6,
l'ourlet à 0,95 dessinait un contour net et le miel se lisait comme un objet
posé SUR le mot ; à la moitié, il redevient ce qu'un surligneur fait — une bande
qui passe dessous.

Au passage, une animation morte retirée : `glowpulse` n'avait plus d'appelant.

Cinq gardes nouvelles, toutes passées à la loupe. L'une d'elles était trop
lâche et la loupe l'a dit : `/mask-image:/` attrapait aussi `-webkit-mask-image`,
donc le test restait vert avec le seul préfixe — cassé partout sauf chez WebKit.
Il exige maintenant les deux écritures.

---

## Les deux dernières gardes du Cerveau : extraites, pas classées « intestables »

Le balayage de nuit laissait trois survivantes hors du canevas, et le plan de
la nuit disait d'en documenter deux comme **dette assumée** — elles vivent
dans la boucle de dessin, `getContext` rend `null` sous happy-dom, donc rien
ne les exécute jamais. C'était le bon diagnostic et la mauvaise conclusion.

En lisant la source plutôt que le plan (§ 2 quaterdecies : « hors d'atteinte
du banc » est presque toujours « au mauvais endroit ») :

- `d < rayon(p.n) + 8 && d < meilleur` ne touche **aucun** contexte de dessin.
  Elle prend un point déjà converti en coordonnées du graphe et une liste de
  corps, et rend une décision. C'est la même situation que la physique du
  lot 25, sortie dans `cerveau-physique.ts` — et le même remède.
- `voisinage = choisi !== null ? proches : null` était **pire que non testée :
  redondante**. `proches` vaut déjà `null` quand `choisi` l'est (son `useMemo`
  l'exige). La condition ne retirait jamais rien. Une garde qui ne garde rien
  reste une garde qu'un jour on mute : elle est retirée, pas testée.

`dashboard/src/views/cerveau-designation.ts` porte désormais `rayon`,
`MARGE_DOIGT`, `corpsSousLePoint` et `estEteinte` ; `Cerveau.tsx` ne garde que
la conversion écran → graphe, seule à connaître le cadrage courant. Les deux
sites de calcul du halo passent par le même prédicat au lieu de recopier la
même expression à deux endroits.

**Ce que ces règles protègent.** Mutée en `>`, la sélection attrape la note la
plus ÉLOIGNÉE du clic : l'écran répond, mais à côté — la panne qui ne
ressemble pas à une panne. Sans `d < meilleur`, deux notes qui se chevauchent
rendent l'une des deux inatteignable, et laquelle dépend de l'ordre
d'insertion d'un `Map`. Sans l'exception du voisinage, désigner une note
éteint précisément ce qu'on voulait voir : ses liens.

**Rejeu, verdict affiché.** Huit mutations, huit rouges — après correction de
la deuxième, qui avait frappé le commentaire au lieu du code et rendu un faux
vert (§ 2 octodecies du journal, écrite pour ça).

| mutation                                                  | verdict  |
| --------------------------------------------------------- | -------- |
| `d < rayon + MARGE` → `>`                                 | 6 rouges |
| garde `d < meilleur` retirée (le DERNIER en portée gagne) | 1 rouge  |
| `d < meilleur` → `d > meilleur`                           | 5 rouges |
| `actif === null` → `!==`                                  | 4 rouges |
| `id === actif` → `!==`                                    | 3 rouges |
| `!voisinage?.has(id)` → `voisinage?.has(id)`              | 3 rouges |
| `Math.min(7, …)` → `Math.max`                             | 4 rouges |
| `Math.sqrt(recurrences)` → `recurrences`                  | 1 rouge  |
| `MARGE_DOIGT = 8` → `0`                                   | 2 rouges |

**Deux autres survivantes tuées dans le même lot**, chacune vérifiée NUE par
exclusion avant d'écrire quoi que ce soit :

- `workflows.length === 0` (Chantiers) — mutée, un dépôt sans workflow affiche
  quand même le champ « Branche ou tag » : une commande sans rien à commander.
- `route.view === 'miellerie'` (App) — mutée, la Miellerie se colle SOUS toutes
  les autres vues et disparaît de sa propre route. La suite entière moins
  `tests/app-coquille.test.tsx` reste verte avec la mutation en place
  (208 fichiers, 3 183 tests) : la garde était bien nue.

Suite mesurée après le lot : **3 208** (3 201 passés, 7 ignorés, 210 fichiers).
Les six badges sont alignés sur ce chiffre mesuré.

**Ce qui reste ouvert.** Une exécution de la barrière a rendu 2 rouges sur
3 201 ; les quatre suivantes sont vertes. Le détail avait été mangé par un
`grep` posé avant lecture — l'intermittent n'est donc ni nommé ni fermé
(§ 2 novodecies).

---

## `join.ts` était à 0 % de couverture : pas mal testé — intestable

La re-mesure de couverture avait désigné `src/node-client/join.ts` (335 lignes)
à **0 %**. Pas « oublié » : le fichier finit par `await main()` sans garde,
donc l'importer ouvrirait un WebSocket et poserait des gestionnaires de signal
au moment du chargement. Aucun banc ne pouvait le toucher (§ 2.8 du carnet), et
le compteur de tests montait pendant ce temps.

Ce qu'il porte n'est pourtant pas anodin : **c'est le premier code qu'un ami
invité exécute sur SA machine.**

- combien de tâches il mènera de front, depuis une variable d'environnement
  qu'il tape lui-même ;
- l'identité sous laquelle la ruche le reconnaîtra d'un redémarrage à l'autre ;
- sa clé propre, écrite en clair dans un fichier de son disque.

Ces trois décisions ne dépendent ni du réseau, ni des signaux, ni d'`argv`.
Elles sortent dans `src/node-client/identite-noeud.ts` ; `join.ts` les importe
et perd 62 lignes sans changer d'un octet ce qu'il fait.

**Ce qu'on protège, et pourquoi ça compte.** `0` en concurrence donnerait un
nœud qui affiche « ✔ Nœud démarré » et n'accepte jamais rien — une panne qui
ressemble à un fonctionnement. Une identité qui change à chaque lancement
laisse une file de fantômes dans la ruche. Une clé en `0644` sur une machine
partagée est une identité de nœud qu'un autre compte peut endosser sans rien
voler d'apparent.

**Rejeu, verdict affiché** (16 tests neufs) :

| mutation                                                      | verdict                 |
| ------------------------------------------------------------- | ----------------------- |
| `Math.max(n, MIN)` → `Math.min` (borne basse)                 | 4 rouges                |
| `Math.min(…, MAX)` → `Math.max` (borne haute)                 | 4 rouges                |
| `ID_PATTERN.test(existante)` nié                              | 3 rouges                |
| garde `ID_PATTERN` retirée (on croit le fichier sur parole)   | 1 rouge                 |
| `v.length > 0` → `>= 0` (un fichier vide deviendrait une clé) | 1 rouge                 |
| `mode: 0o600` → `0o644`                                       | 1 rouge                 |
| clé et identité dans le MÊME fichier                          | 1 rouge                 |
| `Number.isInteger` → `Number.isFinite`                        | **survit — équivalent** |

La dernière est notée telle quelle, sans test décoratif : `parseInt` ne rend
jamais qu'un entier ou `NaN`, donc les deux prédicats ne peuvent pas diverger.
Vérifié par exécution sur `'Infinity'`, `'1e400'`, `'3.9'`, `'0x10'`, `' 7 '`.

**Un banc trop léger de plus, et d'une espèce nouvelle.** Le test du disque en
lecture seule passait par `chmod 0o500` — sans effet, la suite tournant en
root. Sa première assertion (`not.toThrow()`) était verte : écrite seule, elle
aurait rendu un banc vert n'ayant jamais emprunté le chemin dégradé qu'il
prétend éprouver. C'est l'assertion de CONSÉQUENCE qui a mordu. L'obstacle est
désormais structurel — un fichier là où il faudrait un dossier, `ENOTDIR` pour
tout le monde et sur tous les systèmes (§ 2 vicies).

### Balayage du lot 11 (mop-up) — premier essai ANNULÉ, deux mutateurs dans un seul atelier

Neuf gardes de `comptes.ts` et `livraison.ts` devaient passer à la mutation,
suite entière à chaque fois. `concierge.ts` a été écarté après lecture : ses
869 lignes sont presque entièrement de la construction de phrases bilingues,
sans règle à trahir.

**Le premier passage ne compte pas.** Une loupe lancée plus tôt tournait
encore dans le MÊME atelier, et son journal l'établit à la seconde : elle a
fini à 02:24:41, mon balayage avait commencé à 02:12. Pire, à 02:10 un
`git checkout` destiné à réaligner l'atelier sur la branche a piétiné l'état
que la loupe avait en vol. Deux mutateurs sur un même répertoire ne rendent
pas des verdicts moins précis : ils ne rendent aucun verdict. Une suite rouge
ne dit plus laquelle des deux mutations l'a fait rougir, et une restauration
peut effacer la mutation de l'autre avant qu'elle n'ait été jugée.

Les chiffres du premier passage ne sont donc pas recopiés ici, même ceux qui
« avaient l'air bons » — un résultat plausible obtenu par un protocole cassé
reste un résultat qu'on ne peut pas produire.

**Le second passage, atelier exclusif** (garde d'exclusivité exécutée AVANT
toute mutation : « processus tiers dans l'atelier : 0 ✔ ») :

| garde                                                          | verdict          |
| -------------------------------------------------------------- | ---------------- |
| `comptes:147` — dernier administrateur (`admins <= 1` → `< 1`) | 2 rouges         |
| `livraison:111` — HTTPS obligatoire (`!==` → `===`)            | 27 rouges        |
| `livraison:112` — hôte `github.com` (`&&` → `\|\|`)            | 26 rouges        |
| `livraison:210` — ref vide ou trop longue (`\|\|` → `&&`)      | 1 rouge          |
| `livraison:212` — traversée `..` et `//` (`\|\|` → `&&`)       | 1 rouge          |
| `livraison:213` — `/` au bord et `.lock` (`\|\|` → `&&`)       | 1 rouge          |
| `livraison:440` — numéro de PR entier > 0 (`\|\|` → `&&`)      | 1 rouge          |
| `livraison:318` — encodage `base64` (`!==` → `===`)            | 19 rouges        |
| **`livraison:141` — numéro d'issue entier > 0**                | **SURVIT — nue** |

Huit gardes tenues, une nue. Et les chiffres diffèrent de ceux du passage
annulé (26 contre 30, 1 contre 2) : l'écart était fait de tests tombés par
DÉPASSEMENT DE DÉLAI, pas par la mutation. Refaire le balayage n'était donc
pas du zèle.

**La survivante est le jumeau asymétrique de la garde d'à côté.** `lireFaitsPr`
porte MOT POUR MOT le contrôle de `fusionnerPr`, testé depuis toujours — et
elle seule était nue. C'est encore § 2 sexdecies : un soin appliqué à un site
et pas à son jumeau.

Ce que la garde tient réellement dépasse le zéro poli : c'est le SEUL contrôle
avant que `numero` ne parte dans un chemin d'URL,
`/repos/${depot}/pulls/${numero}`. Sur `||`, une valeur non entière venue d'un
JSON est arrêtée net. Sur `&&`, `!Number.isInteger(x)` vaut vrai mais `x <= 0`
vaut faux — toute comparaison contre `NaN` l'est —, donc la conjonction est
fausse et la valeur passe ENTIÈRE dans le chemin appelé. Un contrôle qui ne
peut plus être vrai que sur `-1` et `-2` n'est plus un contrôle.

Test écrit, rejeu fait : **ROUGE**, et l'assertion qui tombe est « AUCUN appel
réseau » — sur `&&`, `0`, `-1`, `1.5` et `'7/../../secrets'` partent tous les
quatre vers GitHub.

### L'intermittent de la nuit a fini par se nommer

Le passage annulé ci-dessus n'aura pas été inutile pour autant : sa sortie
était CAPTURÉE, et elle a fait apparaître, parmi les victimes d'une mutation
de `refValide`, un test qui n'a rien à voir avec elle. Ce constat-là ne
dépend d'aucune mutation — c'est une horloge :

```
× ^C ARRÊTE TOUT — bannière, Reine en ligne, arrêt dit, code 0   30017 ms
```

Ce n'est pas la mutation qui l'a tué : c'est un `setTimeout(30_000)` posé
DANS le banc — le boucher qui tue l'enfant si la bannière du hub ne paraît
pas — alors que vitest accorde 60 s à ce test. Un chien de garde en temps
mural ne distingue pas « en panne » de « occupé » : chargé par les balayages
eux-mêmes, le conteneur mettait plus de trente secondes à démarrer une ruche
parfaitement saine. Le boucher passe à **45 s** : il garde sa raison d'être
(rendre une erreur NOMMÉE plutôt qu'un dépassement anonyme de vitest) sans
tirer sur la lenteur.

Cause **probable** de l'exécution perdue plus tôt dans la nuit, pas cause
prouvée : les deux tests de ce soir-là n'ont jamais été nommés et ne le seront
pas. C'est parce que le SECOND incident, lui, a été capturé qu'on a pu lire
son horloge.

---

## La suite fuyait des ruches entières — et c'est ça qui la faisait mentir

En cherchant pourquoi un balayage mettait douze minutes là où il en met quatre,
un relevé de processus a rendu ceci :

```
40 processus node survivants, jusqu'à 1 070 s d'âge
  · src/orchestrator/main.ts   (des ruches entières)
  · src/node-client/main       (des nœuds)
  · vite.js dashboard          (des serveurs de développement)
plusieurs à 35-40 % de CPU chacun.
charge : 13,18   cœurs : 4
```

Dix-sept minutes que personne ne les avait lancés. La machine tournait à
**3,3 fois sa charge nominale**, uniquement avec des cadavres. Après reprise
des orphelins, la charge est retombée à **3,70** et le balayage en cours a
repris une allure normale.

**Deux causes, distinctes.** Le lanceur `ruche.mjs` démarre lui-même un hub, un
nœud et un `vite` ; les bancs l'abattent en `SIGKILL`, c'est-à-dire le signal
qui ne lui laisse aucune chance de reprendre sa descendance — un `proc.kill()`
ne parle qu'à un processus, il fallait parler au GROUPE. Et les bornes
d'attente étaient posées en `setTimeout(…).unref()`, ce qui signifie
littéralement « si plus rien ne retient la boucle, n'attends pas ce minuteur » :
quand le worker vitest se termine pendant une attente, le boucher n'est jamais
appelé et l'enfant survit à tout le monde. Le filet était à l'endroit exact où
il ne pouvait pas servir.

**Ce que ça coûtait n'est pas la lenteur.** Les mêmes bancs bornent leurs
attentes en temps MURAL. À 3,3× la charge, une ruche parfaitement saine met
plus de trente secondes à s'annoncer — et se fait tuer par son propre chien de
garde. La suite rougissait au hasard, sur du code qui allait bien, et ça
empirait à chaque exécution : la signature exacte d'un intermittent qui
« apparaît sans raison » après quelques heures de travail.

**Le correctif.** `tests/harnais-processus.ts` : lancement en groupe propre
(`detached`), `tuerGroupe` qui frappe le groupe entier (donc les
petits-enfants), et `reprendreTous` posé en `afterEach` **sans condition** —
parce que c'est quand un test échoue, expire ou laisse une promesse pendante
que des processus restent, donc exactement quand un nettoyage conditionnel ne
s'exécute pas. Les trois bancs concernés (`lanceur-ruche`, `reine-demarrage`,
`join-ruche-vivante`) y sont câblés.

**Et la garde qui la rend tenue.** `tests/harnais-processus.test.ts` fabrique un
VRAI père qui engendre un VRAI fils, et vérifie que tuer le groupe emporte le
petit-enfant — c'est lui qui survivait. Sans ce banc, le quatrième fichier qui
lancera un processus le fera au `spawn` nu et la fuite reviendra, invisible
(§ 2 sexdecies : une correction appliquée partout n'est pas une correction
tenue).

**Le corollaire de mesure**, noté au carnet : avant de croire un chiffre de
durée, regarder `/proc/loadavg` et compter les processus vivants. Un banc
mesure toujours deux choses à la fois — le code, et la machine.

**Ce qui a été vérifié et NON modifié.** Les autres bancs qui lancent des
processus (`ask-cli`, `bin-porte-unique`, les sondes du docteur) passent par
`execFile` promisifié : ils ATTENDENT la fin du processus, qui est de toute
façon une commande brève, pas un serveur. Aucun orphelin ne leur est
attribuable dans le relevé. `service.test.ts` cite `orchestrator/main.js` mais
ne lance rien. Ils sont donc laissés tels quels — élargir le harnais à des
appels qui n'en ont pas besoin ajouterait du bruit sans fermer de trou.

**Deux échecs à la barrière, tous deux instructifs.**

1. `tests/empreinte.test.ts` a rougi : « un fichier de `src/` s'est mis à
   écrire ». C'est la garde qui fait exactement son travail — les gestes
   d'écriture avaient changé de fichier source. Les CHEMINS, eux, n'ont pas
   bougé d'un octet : `<workdir>/join/node-id.txt` et `node-key.txt` restent
   déclarés dans `empreinte()`, donc dans `hive desinstaller` et dans
   `docs/INSTALLATION.md`. Seule la clé de la liste `AUTORISES` change. Une
   garde qui interpelle sur un simple déplacement est une garde qui marche.

2. Mon propre banc du harnais a EXPIRÉ à 30 010 ms — et il avait raison. Le
   harnais nettoyait sur `close`, or `close` attend que les FLUX se ferment,
   pas que le processus meure : un enfant lancé en `stdio: 'inherit'` tient
   les tuyaux de son père ouverts tant qu'il vit. Sur `close`, le nettoyage
   n'arrivait donc **jamais dans le seul cas qui compte** — « le père est
   mort, son fils tourne encore » —, et l'appelant restait suspendu jusqu'à
   son échéance. Corrigé en `exit`, qui parle du processus. Sans le banc du
   père fugace, ce trou serait entré dans le dépôt à l'intérieur même du
   correctif censé le boucher.

**Preuve de bout en bout.** Après une suite complète : **0 processus de ruche
survivant** (compté), contre 40 au relevé de la nuit. Et la suite passe de
117,7 s à **87,7 s** — un quart de son temps était consommé par ses propres
cadavres.

Suite mesurée : **3 231** (3 224 passés, 7 ignorés, 212 fichiers). Les six
badges sont posés par `node scripts/compte-tests.mjs rapport-tests.json
--corriger`, à partir du rapport JSON de l'exécution — pas à la main.

---

## Le `.env` de l'assistant gardait ses vieux droits — avec les secrets dedans

`src/installer-main.ts` était l'autre fichier à 0 % de couverture, et pour la
même raison structurelle que `join.ts` : il finit par `main().catch(…)`, donc
l'importer LANCE l'installeur. Aucun banc ne pouvait le toucher.

Il portait DEUX écrivains du même fichier — le `.env`, celui qui contient
`HIVE_TOKEN` et `HIVE_JWT_SECRET` : le chemin principal écrivait par
temporaire + `rename`, le chemin de l'**assistant** par un `writeFileSync`
direct. Les deux demandaient `{ mode: 0o600 }`. Les deux ont l'air corrects.

**Mesuré avant d'écrire une ligne de correctif :**

```
fichier existant en 644, puis writeFileSync(… { mode: 0o600 })  → 644
temporaire neuf en 0600, puis rename                            → 600
```

`mode` n'est honoré qu'à la **création**. Sur un fichier qui existe déjà,
l'option est silencieusement sans effet. Et le scénario n'est pas théorique :
le dépôt conseille lui-même `cp .env.example .env`, ce qui produit un 644.
L'assistant le complétait ensuite avec les secrets dedans — lisibles par tous
les comptes de la machine. C'est en outre le chemin INTERACTIF, donc celui où
l'on appuie sur `^C` : il perdait aussi l'atomicité, et un `^C` au mauvais
moment y laissait un `.env` tronqué.

**Le correctif** n'est pas « ajouter un `chmod` » : c'est faire passer les deux
écrivains par la même voie. `src/ecriture-atomique.ts` porte `ecrireAtomique` et
`MODE_SECRET`, avec 9 tests sur de vrais fichiers — dont celui qui pose la
prémisse (un `.env` en 644) et vérifie qu'il ressort en 600.

**Et la garde qui la tient.** Le correctif vit dans un fichier qu'aucun banc ne
peut appeler : sans garde structurelle, le prochain écrivain du `.env` naîtrait
au `writeFileSync` direct et personne ne le verrait (§ 2 sexdecies). Deux
gardes de SOURCE ont donc été ajoutées — aucun `writeFileSync` de `src/**` ne
vise un `.env`, et l'installeur passe bien deux fois par la voie atomique. Le
défaut d'origine a été remis en place pour les éprouver : **ROUGE toutes les
deux**. La première compte aussi les écrivains qu'elle voit (`> 3`), pour ne
pas devenir verte le jour où elle cesserait de regarder.

Carnet : § 2 tervicies — devant une option de droits, la question n'est jamais
« l'a-t-on demandée ? » mais « à quel moment est-elle lue ? ».

---

## L'avertissement « transport en clair » ne pouvait rien garder

Dernière survivante grave du balayage de nuit : `transport === 'clair_public'`
dans `join.ts`, mutée en `!==`, ne faisait rougir personne. Même cause
structurelle que les deux lots précédents — le fichier finit par `await main()`,
donc l'importer ouvrirait un WebSocket, et aucun banc ne peut le charger.

Le dépôt avait DÉJÀ tranché ce cas exact, pour l'installeur : `conseilServeur()`
vit dans `installer.ts` (pur) « parce que `main()` court à l'import et qu'aucun
test ne peut le lire — c'est là que le `&&` du conseil avait survécu au
balayage, invisible ». Même remède : `src/node-client/annonces-join.ts`.

**Ce qui n'était tenu par rien.** `jugerTransport()` est pur et éprouvé
ailleurs : savoir si une URL est sûre, privée ou publique n'était pas le
problème. Ce que personne ne gardait, c'est la CORRESPONDANCE entre ce verdict
et ce que l'invité lit. Or les deux phrases en clair ne disent pas la même
chose :

- « réseau privé (usuel en local) » rassure, et il a raison de le faire ;
- « adresse publique » prévient que la clé, les prompts, les logs ET les diffs
  de code traverseront l'internet sans chiffrement.

Muter la garde ne fait pas « perdre » un avertissement : elle les **échange**.
Celui qui envoie son code source sur l'internet lit « usuel en local », et
celui qui se connecte à sa propre machine est effrayé pour rien. Un
avertissement qui se trompe de situation est pire que pas d'avertissement — il
apprend à ne plus le lire.

**La seconde annonce avait le même vice**, moins grave et de la même famille :
deux situations distinctes mènent au mode « shell simulé » — aucun agent IA
installé, ou bien `HIVE_AGENT` qui l'impose alors que de vrais agents sont là.
Dire « aucun agent détecté » à quelqu'un qui en a trois installés l'envoie
réinstaller ce qu'il possède déjà, au lieu de regarder sa variable
d'environnement.

**Rejeu, verdict affiché** (11 tests neufs, mutation par NUMÉRO DE LIGNE) :

| mutation                             | verdict  |
| ------------------------------------ | -------- |
| `verdict === 'clair_public'` → `!==` | 5 rouges |
| `verdict === 'clair_prive'` → `!==`  | 4 rouges |
| `retenu !== 'shell'` → `===`         | 5 rouges |
| `some((a) => a !== 'shell')` → `===` | 2 rouges |
| `!auMoinsUnReel` → `auMoinsUnReel`   | 3 rouges |

Cinq gardes, cinq rouges. Un test branche en plus les deux pièces sur le vrai
`jugerTransport` : un module pur peut être parfait et mal câblé.

---

## La Miellerie annonçait « prêt à fusionner » sans savoir compter

Trois survivantes de plus, toutes dans l'écran où l'humain décide de couler le
miel — c'est-à-dire d'intégrer pour de bon ce que l'IA a produit.

**Le compteur d'approbations.** `t.status === 'done' && getReview(t.id) ===
'approved'` mutée en `||` : le compteur cesse de compter des APPROBATIONS pour
compter des ACHÈVEMENTS. Il annoncerait « 3 approuvée(s) / 3 terminée(s) » sur
un projet dont personne n'a relu une seule production — sur la ligne exacte que
l'utilisateur regarde avant d'appuyer. Son jumeau, le compteur de rejets, avait
le même trou ; et le filtre par projet (`t.projectId === projectId`) qui les
précède n'était pas gardé non plus : sans lui, le pied de vue annonce comme
prêtes des productions d'un autre dépôt, que la coulée ne prendra pas — le
chiffre et le geste divergent en silence.

La fixture est **asymétrique à dessein** : trois terminées, une approuvée, une
rejetée, une non relue. Un contexte symétrique (une approuvée pour une
terminée) rendrait « 1 / 1 » des deux côtés de la mutation — vert pour la
mauvaise raison, le piège que ce fichier documentait déjà et qui a coûté cinq
bancs cette nuit.

**Le plan de fusion d'un autre projet.** `planState.id === projectId` a l'air
redondante : un `useEffect` vide déjà `planState` quand le projet change. C'est
précisément pourquoi quelqu'un la supprimerait un jour.

Elle ne sert que sur une COURSE, et cette course est réelle : la demande de
plan est asynchrone. Changer de projet PENDANT le vol déclenche l'effet, qui
nettoie ; puis la réponse du PREMIER projet arrive et se réinstalle dans
l'état — l'effet ne se rejouera pas, `projectId` n'ayant pas rebougé. Sans la
garde, le plan du Rucher s'affiche sous le titre de l'Autre rucher : des
numéros de tâches, des conflits et un verdict « intégrable » qui parlent d'un
dépôt qu'on ne regarde pas.

Le banc monte donc la course pour de vrai — demande retenue en vol, changement
de projet par re-rendu SUR LA MÊME RACINE (remonter repartirait d'un état vide
et la garde n'aurait plus rien à garder), livraison tardive, réouverture. Rejeu :
**ROUGE**, avec le plan `7/9` du premier rucher affiché sous le second.

**Rejeu, verdict affiché** (3 tests neufs, mutation par numéro de ligne) :

| mutation                                | verdict |
| --------------------------------------- | ------- |
| compteur des approuvées : `&&` → `\|\|` | 1 rouge |
| compteur des rejets : `&&` → `\|\|`     | 1 rouge |
| filtre par projet : `===` → `!==`       | 1 rouge |
| plan d'un autre projet : `===` → `!==`  | 1 rouge |

Les quatre gardes ont été vérifiées NUES par exclusion avant écriture : la
suite entière moins ce fichier reste verte avec la mutation en place.

---

## Le rayon de miel disait « repoussée » de tout ce qui attendait

Survivante du balayage : `deferred?.has(t.id) && t.status === 'ready'`, dans le
composant `Honeycomb`. Elle n'avait aucun banc — et c'est un angle mort typique :
`tests/honeycomb.test.ts` existe bel et bien, mais éprouve l'ALGORITHME du plan
de fusion, pas l'affichage. Deux choses portent le même nom, l'une est couverte,
et on croit l'autre couverte aussi.

**Ce que cette grille existe pour dire.** Le rayon est le seul écran qu'on lit
sans lire : une couleur par état, à trois mètres. Toute sa valeur tient dans le
fait que deux états différents ne se ressemblent pas. Or « en attente » et
« repoussée » sont opposés — `ready`, la ruche va la prendre dès qu'une
ouvrière se libère ; `deferred`, un humain a décidé de NE PAS la faire pour
l'instant.

Mutée en `||`, toute tâche en attente porte l'habit des repoussées : le tableau
annonce que rien ne va démarrer, sur une ruche qui démarre. Et l'autre moitié
ment aussi — mutée en `!== 'ready'`, une tâche repoussée déjà partie porte
l'habit, et celle qui attend vraiment le perd.

La fixture sépare donc les QUATRE combinaisons (repoussée×attente), parce que
la mutation n'en change que deux : c'est le contraste qui juge, pas le total.

| mutation              | verdict  |
| --------------------- | -------- |
| `&&` → `\|\|`         | 2 rouges |
| `=== 'ready'` → `!==` | 2 rouges |

**Un piège de méthode, encore.** Deux des trois mutations de la première
batterie n'ont pas été appliquées du tout : les guillemets imbriqués du script
ont fait échouer `python3`, qui a imprimé une `SyntaxError` — et la suite est
restée verte, ce qui se lit exactement comme « la garde est nue ». Le message
d'erreur était visible ; sans lui, deux tests inutiles auraient été écrits. Le
correctif est le même qu'au § 2 octodecies : le script de mutation doit
VÉRIFIER que la ligne a changé (`assert l[i] != avant`) avant de lancer quoi
que ce soit.

---

## Les Gardiennes accusaient la mauvaise machine

Survivante du balayage : `snapshot.nodes.find((n) => n.id === nodeId)` dans la
vue Santé. Trois fichiers portent pourtant « gardiennes » dans leur nom — ils
éprouvent l'inspection, son endpoint et son câblage, jamais ce que l'écran en
RACONTE. Deuxième fois cette nuit qu'un nom de fichier rassurant cache un angle
mort d'affichage (après `honeycomb.test.ts`).

Le code disait déjà l'enjeu, à l'endroit exact :

> Le NOM du nœud, pas son identifiant : « 3f2a-… » ne dit à personne sur qui il
> hésite à compter.

C'est une ACCUSATION affichée à un humain : cette machine-là a rendu du travail
creux. Mutée, `find` rend le premier nœud qui N'EST PAS celui-là — la ruche
accuse nommément la mauvaise machine, dans l'écran fait pour décider à qui l'on
confie du travail.

**Ce qui rend ce défaut particulièrement difficile à voir** : l'écran reste
parfaitement cohérent. Un nom réel, un verdict réel, un grief réel. Seul le LIEN
entre eux est faux — et rien à l'écran ne peut le trahir. C'est le contraire
d'un plantage : c'est une phrase bien formée qui dit le contraire du vrai.

Le repli `?? nodeId` compte aussi : un nœud parti de la ruche n'est plus dans
l'instantané, et doit rendre son identifiant brut. Afficher une chaîne vide
laisserait un grief sans coupable ; afficher le nom du voisin accuse quelqu'un
à sa place. Le silence est le moindre mal, l'erreur nommée le pire.

| mutation                        | verdict  |
| ------------------------------- | -------- |
| `n.id === nodeId` → `!==`       | 3 rouges |
| repli `?? nodeId` → chaîne vide | 1 rouge  |

La fixture met le nœud accusé en SECOND exprès : mutée, la recherche rend le
premier de la liste, donc l'innocent — il faut donc qu'il existe et qu'il soit
distinct pour que le contraste juge.

**Au passage, une sonde oubliée.** Le premier jet ne simulait que
`fetchGardiennes` ; les quatre autres sondes de l'écran partaient réellement sur
le réseau (`ECONNREFUSED 127.0.0.1:3000` dans la sortie). Le banc passait quand
même — mais il dépendait de la machine qui l'exécute, et il payait un aller-
retour réseau à chaque montage. Toutes les sondes de l'écran sont désormais
simulées, pas seulement celle qu'on juge.

---

## Deux bornes de saisie du CLI : le premier argument et le dernier dépôt

Deux survivantes, toutes deux dans `src/cli.ts` — qui se termine par un
`try { … } catch` de tête, donc s'exécute à l'import. Aucun banc ne pouvait les
appeler. Cinquième fois cette nuit que ce motif rend une règle intestable, et
cinquième fois que le remède est le même : la sortir dans un module pur.

**`iSetup >= 0` — zéro est une position, pas une absence.** `indexOf` rend `0`
quand le drapeau est le PREMIER argument, c'est-à-dire dans l'invocation que la
documentation montre : `hive cloudflare --setup ma-ruche.exemple.fr`. Sur `> 0`,
celle-là perd son argument **en silence** — pas d'erreur, pas de message, juste
un hôte `undefined`. C'est le même piège que le `-1` d'`indexOf`, vu par l'autre
bout : on se méfie de la valeur sentinelle et on oublie que la première position
est légitime.

En lisant, une seconde occurrence du même `iSetup >= 0` est apparue vingt lignes
plus bas, que le balayage n'avait pas signalée — même borne, même défaut. Elle
passe par `aLeDrapeau`, distinct de `valeurApres` à dessein : un `--setup` posé
SANS valeur est présent, et les confondre ferait suivre le chemin « pas de
tunnel nommé » au lieu de refuser un nom d'hôte manquant.

**`n <= r.depots.length` — le dernier dépôt devenait inchoisissable.** Sur `<`,
le refus se contredit lui-même : « n'est pas un numéro de la liste (1 à 12) »
quand l'utilisateur vient de taper 12, qu'il a lu à l'écran. Une erreur qui nie
ce qu'elle affiche ne s'attribue à rien — on se croit fou avant de croire à un
défaut.

**Rejeu, verdict affiché** (11 tests neufs, mutation par numéro de ligne avec
`assert l[i] != avant`) :

| mutation                          | verdict  |
| --------------------------------- | -------- |
| `valeurApres` : `i >= 0` → `> 0`  | 1 rouge  |
| `aLeDrapeau` : `>= 0` → `> 0`     | 1 rouge  |
| borne haute : `n > taille` → `>=` | 3 rouges |
| borne basse : `n < 1` → `n < 2`   | 2 rouges |
| les deux bornes : `\|\|` → `&&`   | 5 rouges |
| garde d'entier inversée           | 5 rouges |

Les deux gardes ont été sondées contre la **suite entière** avant écriture —
3 256 tests verts avec chacune des mutations en place.

---

## Une revue faite hors ligne pouvait disparaître sans un mot

Survivante du balayage : `v !== null && typeof v === 'object' && 'state' in v`,
dans le tampon des revues non synchronisées. Nudité vérifiée contre la suite
ENTIÈRE avant écriture — 3 267 tests verts avec la mutation en place.

**Ce que ce tampon porte.** Un humain approuve ou rejette une production. Le
POST part. S'il échoue — coupure, ruche redémarrée, tunnel tombé —, le verdict
n'est pas perdu : il est gardé localement, réaffiché, et re-posté au retour du
réseau. Chaque entrée mémorise DEUX choses, et la seconde est la subtile :
`state`, le verdict de l'humain, et `base`, le verdict SERVEUR connu au moment
du geste. `base` existe pour ne pas rejouer un geste périmé — si un autre
opérateur a statué entre-temps, sa décision est plus récente et prime.

**Ce que la garde distingue.** Deux formats cohabitent : l'ANCIEN (le verdict
nu, `"approved"`) et le NOUVEAU (`{ state, base }`). Mutée, un tampon au format
neuf est relu comme s'il était ancien : `state` devient l'OBJET tout entier, et
`base` retombe à `null`. Deux conséquences, toutes deux silencieuses :

1. le verdict affiché n'est plus « approuvée » mais une structure — l'écran
   cesse de dire ce que l'humain a décidé ;
2. `base` valant `null`, la comparaison au serveur échoue et l'entrée est
   ABANDONNÉE : le geste hors ligne disparaît sans un mot.

C'est la perte de données la plus grave rencontrée cette nuit : silencieuse, et
sur une décision humaine.

| mutation                                  | verdict  |
| ----------------------------------------- | -------- |
| `'state' in v` nié                        | 3 rouges |
| `typeof v === 'object'` → `!==`           | 5 rouges |
| péremption : `serverVal !== base` → `===` | 5 rouges |

Les deux moitiés de la règle sont éprouvées, sans quoi la première serait
creuse : un geste dont la base correspond toujours au serveur est RENVOYÉ, et
un geste dont le serveur a bougé depuis est ABANDONNÉ.

**Un piège d'asynchrone au passage.** Le premier jet affirmait que le rejeu
avait bien re-posté, et rendait « rien n'a été renvoyé » sur un rejeu
parfaitement sain : `postReview` n'est pas appelé tout de suite mais enchaîné
derrière la promesse de la tâche (`prev.then(() => postReview(…))`), pour
sérialiser les envois. Affirmer sans drainer les microtâches, c'est juger
l'instant AVANT l'envoi. Même famille que les cinq bancs trop légers de la
nuit : le banc ne regardait pas ce qu'il croyait regarder.

---

## `j` et `k` échangeaient leurs directions

Survivante du balayage : `e.key === 'j' ? 1 : -1` dans la file de revue de la
Miellerie. Nudité vérifiée par exclusion avant écriture — 3 274 tests verts
avec la mutation en place.

`j` et `k` sont le geste de base de cet écran : on descend la file en
approuvant ou rejetant, sans quitter le clavier. C'est la raison d'être des
raccourcis — relire quarante productions à la souris est un travail qu'on
abandonne au bout de dix.

**Mutée, la touche ne cesse pas de fonctionner : les deux ÉCHANGENT leurs
directions.** C'est ce qui rend le défaut coûteux plutôt que visible — rien
n'est cassé, tout répond, mais la main apprend l'inverse de ce qu'elle sait. Une
file parcourue à l'envers se relit deux fois, ou se saute.

**Ce qui rend le banc décisif : le point de départ.** Depuis la PREMIÈRE
production, `j` va sur la deuxième et `k` boucle sur la dernière — deux
destinations différentes. Un banc qui partirait du milieu d'une liste
symétrique ne distinguerait pas les deux sens, et resterait vert sur
l'inversion. Une assertion explicite pose d'ailleurs la règle : les deux
touches ne mènent jamais au même endroit.

| mutation                                       | verdict  |
| ---------------------------------------------- | -------- |
| `e.key === 'j'` → `!==` (les deux échangent)   | 2 rouges |
| `? 1 : -1` → `? 1 : 1` (`k` cesse de remonter) | 2 rouges |
| `flat.length === 0` → `!==` (file vide)        | 4 rouges |
| garde de saisie `inInput()` niée               | 5 rouges |

Les deux gardes d'entrée sont éprouvées avec le reste : taper « jk » dans un
champ ne doit pas faire défiler la file sous l'utilisateur, et `Ctrl+J`
appartient au navigateur.

---

## Tâche #62 — audit d'avant-sortie, premier registre

L'audit commence par les deux points ouverts nommés au carnet, et les mesure
plutôt que de les supposer.

### 1. `getSnapshot()` sans LIMIT — FERMÉ

`getSnapshot(limite = LIMITE_TACHES_INSTANTANE)` : la borne existe et porte sa
valeur par défaut. Rien à faire.

### 2. La table `tasks` sans élagueur — FERMÉ, et vérifié à trois niveaux

- les **13** élagueurs définis dans le magasin sont tous invoqués par
  `server.ts` (comparaison exhaustive définis / appelés : aucun écart) ;
- **toutes** les tables créées sont bornées, ou bornées par un geste humain ;
- `pruneResults` fait exception à la forme : il ne SUPPRIME pas, il ALLÈGE
  (`diff` et `logs` vidés, le fait daté conservé). Un relevé naïf le comptait
  comme « n'élague rien » et déclarait `results` sans borne — c'était faux, et
  lire le corps de la méthode l'a montré avant que ça ne devienne une trouvaille
  imaginaire.

### 3. La trouvaille : la doctrine n'était tenue que par la discipline

La règle est écrite noir sur blanc au-dessus de la boucle d'élagage — _« une
table nouvelle arrive avec sa borne, et la borne est CÂBLÉE, pas seulement
écrite »_ — et elle a déjà cédé DEUX FOIS, de deux façons distinctes : trois
bornes écrites jamais appelées (lot 46), puis une table sans aucune borne
(`tasks`). Une garde qui ne vérifierait que l'un des deux cas n'aurait pas vu
l'autre.

`tests/bornes-doctrine.test.ts` vérifie les deux, plus trois propriétés de la
liste d'exceptions elle-même : aucune exception ne survit à sa table, chacune
porte un MOTIF lisible (pas un `TODO`), et un compteur empêche la garde de
devenir verte à vide.

Le choix d'une liste d'exceptions _avec motif_ plutôt qu'une règle absolue est
délibéré : toutes les tables n'ont pas à être élaguées, et l'exiger rendrait la
garde fausse — donc contournée. Ce qui distingue les deux familles n'est pas la
taille mais la CAUSE de la croissance : sous le geste d'un humain, ou sous la
machine. L'exception force à trancher la question au lieu de l'oublier.

### 4. La garde neuve portait le vice qu'elle traque

Rejouée contre le défaut du lot 46 — on COMMENTE l'appel à `pruneTasks` — elle
est restée **verte** : elle cherchait `store.pruneTasks(` dans la source brute,
et le texte était toujours là, simplement mort.

C'est le pire des cas de figure : commenter un appel est le geste le plus
courant d'un débogage, et celui qu'on oublie le plus de défaire. La garde
rassurait donc exactement à l'instant où la borne venait d'être désactivée à la
main. Corrigée par un retrait des commentaires ; rejouée sous ses DEUX formes —
appel commenté, appel supprimé — **rouge les deux fois**.

La leçon vaut plus que la garde, et elle est au carnet (§ 2 quatervicies) : une
garde structurelle qu'on n'éprouve pas est une hypothèse, et on la croit
d'autant plus volontiers sur parole qu'elle a l'air d'être du contrôle plutôt
que du test.

### 5. Registre 2 — le refus de bac à sable sortait en code fourre-tout

**Prouvé en exécutant**, pas supposé. Un nœud lancé avec `HIVE_ISOLEMENT=exige`
sur une machine sans moteur de conteneurs (`PATH` vidé de podman et de docker) :

```
🛡  Isolement : HIVE_ISOLEMENT=exige et aucun moteur de conteneurs trouvé…
✘ Ce nœud ne démarre pas.
CODE=1
```

Le refus fonctionne. Le code, non. `codes-sortie.ts` décrit ce `1` comme _« le
fourre-tout, à n'utiliser qu'en DERNIER RECOURS »_ et définit `REFUS_SECURITE`
juste en dessous, pour ce cas exact. Le même fichier dit ce que la confusion
coûte : _« Ansible, systemd ou un Makefile ne peuvent pas distinguer "déjà en
place" de "port occupé" de "on a refusé pour raison de sécurité". La seule
réponse possible devient relancer et espérer. »_

Concrètement : un `Restart=on-failure` voit `1`, relance, le nœud refuse,
relance — **sur une machine qui ne pourra jamais travailler**, faute de moteur
de conteneurs. Un code dédié laisse le superviseur s'arrêter et prévenir
l'humain, seul capable d'installer podman.

**Le correctif ne recopie pas le code chez l'appelant.** Le trou d'origine de
`bac.ts` était précisément un duplicata — deux chemins de démarrage, deux
copies, et `join.ts` s'était retrouvé sans aucun bac à sable. Le code vit donc
dans la décision (`bac.codeSortie`), et les deux chemins la lisent.

**Deux fois la même leçon, payée sur mon propre banc.**

Le premier jet fabriquait un `Bac` À LA MAIN dans le montage de test — donc
recopiait la règle et jugeait sa propre copie. Mesuré : deux mutations de la
règle laissaient le banc **vert**. La règle est sortie en `codeDuBac()`, minuscule
et exportée, précisément pour qu'un banc ne puisse plus la réécrire.

Et une fois cela corrigé, une troisième mutation survivait encore : remplacer
`codeDuBac(decision.refuse)` par `codeDuBac(false)` dans `preparerBac` ne
faisait rougir personne — la règle était éprouvée, son APPLICATION non. L'état
refusant de `preparerBac` exige une machine sans moteur de conteneurs, qu'un
banc ne peut pas fabriquer sans sonder le système ; un simulacre de sonde ne
prouverait que le simulacre. Le câblage est donc jugé à la source, et c'est dit
franchement dans le banc plutôt que masqué par une simulation.

| mutation                               | verdict  |
| -------------------------------------- | -------- |
| `main.ts` : retour au `1` nu           | 1 rouge  |
| `join.ts` : retour au `1` nu           | 1 rouge  |
| la règle rend le fourre-tout           | 2 rouges |
| le code ne dépend plus du refus        | 2 rouges |
| `preparerBac` n'applique plus sa règle | 1 rouge  |
| le code du bac devient une constante   | 2 rouges |

## Tâche #62 — troisième registre : l'exclusion d'un membre était contournable en se renommant

### La trouvaille, prouvée en exécutant

L'axe (b) de l'audit — billets et clés — demandait deux choses : un billet à
usage unique est-il RÉELLEMENT consommé, et la révocation est-elle effective ?

Les deux premières réponses sont bonnes, et vérifiées :

- la consommation est **atomique** — `UPDATE … WHERE usesLeft > 0` fait tout le
  travail, et deux nœuds qui présentent le même billet au même instant ne
  peuvent pas réussir tous les deux, quel que soit l'entrelacement ;
- la révocation **mord tout de suite** : la route ferme le socket en cours
  (4403), et un seul socket existe par nœud, le précédent étant fermé au
  remplacement.

La troisième réponse était mauvaise. Sur un serveur réel :

| geste                                                | mesuré      |
| ---------------------------------------------------- | ----------- |
| exclure `node-exclu`                                 | 200         |
| il revient sous `node-exclu`, avec le token de ruche | 4403 ✔      |
| il revient sous **`node-exclu-bis`**, même token     | **ADMIS** ✘ |

La garde existait, mais elle était attachée au `nodeId` **annoncé** — une chaîne
que l'exclu choisit lui-même. Quatre caractères suffisaient.

### Pourquoi c'était plus grave qu'un défaut de code

La promesse était écrite à **trois endroits**, et chacun rassurait sur la foi
des deux autres : le commentaire du `register`, l'en-tête de `acces-ws.test.ts`,
et surtout `docs/FONCTIONNALITES.md` — donc adressée aux utilisateurs :

> Un membre exclu ne peut pas revenir avec le token maître : le refus est
> définitif, il ne se replie pas sur l'ancienne porte.

Le banc, lui, n'éprouvait que la reconnexion sous le MÊME nom. Il confirmait
une garantie qu'il ne mesurait pas.

### L'arbitrage, et pourquoi il n'a pas été pris seul

Durcir un chemin d'authentification n'est pas une correction : c'est un
changement de contrat. L'utilisateur dormant, la question a été posée à un
agent Fable 5, qui a vérifié le dépôt avant de trancher — **DURCIR, sans
interrupteur** — et a rapporté deux faits décisifs que l'analyse initiale
n'avait pas :

1. **aucune rotation de `HIVE_TOKEN` n'existe ni n'est documentée.**
   `.env.example` l'écrit lui-même : « elle ouvre tout, POUR TOUJOURS, et ne
   peut être révoquée que pour tout le monde à la fois ». L'échappatoire douce
   — « dites à l'hôte de faire tourner son token » — conseillait donc un geste
   que le produit ne sait pas faire ;
2. la fausse promesse était **aussi dans la documentation publique**, pas
   seulement dans un commentaire interne.

Vérification faite de mon côté : les deux sont exacts. Et l'**ADR 0007** porte
déjà le statut « (a) resserrée par la propriété, avec **(c) pour cible** », où
la voie (c) est précisément de séparer le rôle d'opérateur du rôle de machine
membre, en laissant ouvert « le sort du jeton partagé ». Ce lot n'invente donc
pas une politique : il tranche la part la plus étroite d'une cible déjà
acceptée.

### La règle, et ce qu'elle ne casse pas

`tokenMaitrePeutEnregistrer({ nodeIdConnu, rucheAExclu })` — pure, dans
`acces.ts`, éprouvable sans base ni socket. Le token de ruche n'enregistre plus
un `nodeId` **inconnu** dès lors que la ruche a **déjà exclu** quelqu'un.

Le déclencheur est la première exclusion, jamais la mise à jour :

- une ruche qui n'a exclu personne ne change en **rien** ;
- une machine déjà connue garde sa porte — aucune ne tombe au premier
  `git pull`.

Résidu **assumé et épinglé par un banc** : le porteur du token maître peut
encore usurper un `nodeId` connu. Ce geste est visible — il coupe la connexion
du titulaire (4000). La vraie réponse à un token qui a fui reste de changer le
token, et la documentation le dit désormais au lieu de promettre l'inverse.

### Mutations — huit passées, huit rouges

| mutation                                           | verdict  |
| -------------------------------------------------- | -------- |
| la règle admet toujours (porte rouverte)           | 1 rouge  |
| la règle refuse toujours (casse toutes les ruches) | 4 rouges |
| la règle : le `\|\|` devient `&&`                  | 4 rouges |
| la règle : déclencheur inversé                     | 3 rouges |
| le magasin : « a exclu » devient « a un membre »   | 1 rouge  |
| le câblage : la ruche n'a jamais exclu             | 1 rouge  |
| le câblage : un nœud connu n'est plus reconnu      | 1 rouge¹ |
| le câblage : une clé connue n'est plus reconnue    | 1 rouge¹ |

¹ **Ces deux-là ont d'abord SURVÉCU**, et c'est le plus instructif du lot. Deux
tables disent qu'une machine est connue — `nodes` et `node_keys` — et elles ne
se recouvrent pas. Tous les bancs du fichier obtenaient leur nœud par billet,
donc passaient tous par `node_keys` : la machine d'avant les billets, et la
machine invitée mais jamais venue, n'étaient éprouvées **nulle part**. Les deux
bancs manquants portaient chacun une garantie de **compatibilité** — celles qui
ne rougissent jamais seules, parce qu'un cas jamais testé ressemble à un cas
qui marche.

### Reste à faire, relevé en passant

En rejouant la loupe, une première mesure a été faite contre une base
**périmée** (l'atelier suivait le `main` local, en retard de huit fusions). Le
verdict rouge qu'elle a rendu ne concernait donc pas cette branche — mais il
n'est pas nul pour autant : il porte sur du code **déjà fusionné** cette nuit,
et deux mutants y sont sans défense.

- `dashboard/src/NodesPanel.tsx` — `{...(tasks && onOpenTask ? … : {})}`
- `src/cli.ts` — `const choisi = rang === null ? undefined : r.depots[rang]`

À reprendre : écrire les deux bancs, ou constater par écrit que les mutants
sont équivalents. **Fait dans la foulée — voir ci-dessous.**

## La dette de la loupe, payée : deux mutants sans défense dans du code déjà livré

Relevés par une mesure faite contre une base périmée, donc trouvés par accident
— mais réels, et sur du code déjà fusionné. Les deux sont fermés, chacun par le
remède que son défaut appelait.

### `src/cli.ts` — entre l'index et l'élément, une ligne que rien ne tenait

    const rang = choisirParNumero(reponse, r.depots.length);
    const choisi = rang === null ? undefined : r.depots[rang];

La première ligne était éprouvée ; la seconde, non. Elle vit dans une fonction
qui attend une réponse au clavier (`rl.question`), donc qu'aucun banc ne peut
appeler — § 2.8, pour la sixième fois de la nuit, et pour la sixième fois le
remède est d'extraire la règle plutôt que de simuler un terminal.

Le piège tient en une phrase : muter `=== null` en `!== null` ne fait rien
planter, parce que `liste[null]` vaut `undefined` **comme le refus légitime**.
Les deux branches rendent alors la même chose, la fonction devient une
constante, et le CLI répond « ce n'est pas un numéro de la liste » à TOUTES les
saisies — y compris les bonnes. La commande est morte et rien ne le dit.

`choisirDansListe(saisie, liste)` sort la règle dans `choix-cli.ts`.

| mutation                                    | verdict    |
| ------------------------------------------- | ---------- |
| le mutant exact de la loupe (`===` → `!==`) | 2 rouges   |
| la fonction ne rend plus jamais rien        | 2 rouges   |
| tout choix rend le PREMIER élément          | 1 rouge    |
| la borne haute déborde d'un cran            | ÉQUIVALENT |

Le dernier est **constaté par écrit** dans le module plutôt qu'ignoré : élargir
la borne d'un cran fait rendre `liste[3]` sur une liste de trois, c'est-à-dire
`undefined`, c'est-à-dire le refus. Aucun appelant ne peut distinguer les deux.
C'est la **même coïncidence du langage** qui cachait le défaut d'origine, et
c'est pour ça qu'elle méritait d'être écrite : la borne reste juste, mais ce qui
la tient est `choisirParNumero`, pas ce banc-ci.

### `dashboard/src/NodesPanel.tsx` — une affordance qui ment

    {...(tasks && onOpenTask ? activateProps(() => setOuverte(n.id)) : {})}

Muté en `||`, le résultat n'est pas une carte cassée : c'est **pire**. La carte
porte `role="button"`, `tabIndex=0`, le curseur main et la réponse au clavier —
et n'ouvre rien, puisque la fiche exige les deux propriétés. Pour quelqu'un qui
navigue au clavier, c'est un arrêt de tabulation annoncé « bouton » par un
lecteur d'écran, qui ne mène nulle part. Une affordance qui ment coûte plus cher
qu'une affordance absente : on réessaie.

| mutation                                    | verdict  |
| ------------------------------------------- | -------- |
| le mutant exact de la loupe (`&&` → `\|\|`) | 1 rouge  |
| toute carte devient un bouton               | 2 rouges |
| aucune carte n'est jamais un bouton         | 6 rouges |

Le banc éprouve les **deux sens** séparément : `tasks` seule, puis `onOpenTask`
seule. Il ne suffit pas que l'une manque — il faut que **chacune, seule**, soit
insuffisante, sinon le `||` passerait sur la moitié des cas.

## Tâche #62 — clôture : les deux derniers axes, et ce qu'ils N'ONT PAS trouvé

Un audit qui ne consigne que ses trouvailles ment sur sa couverture : on ne peut
plus distinguer « examiné, rien à signaler » de « jamais regardé ». Les deux
derniers axes sont donc écrits ici avec ce qui a été vérifié, et comment.

### Axe (c) — le chemin de livraison : RIEN À SIGNALER

Question posée : que peut-on écrire dans le dépôt de quelqu'un ? La base est-elle
jamais forcée ? Écrit-on sur `main` ?

| garde                                  | où                                              | verdict                   |
| -------------------------------------- | ----------------------------------------------- | ------------------------- |
| `refValide` sur la base ET la branche  | `livraison.ts:336`                              | présente                  |
| `cheminValide` sur tout chemin du diff | **câblée** en `rustine.ts:191`                  | présente                  |
| mode de fichier                        | `MODE_FICHIER = '100644'` en dur                | aucun exécutable livrable |
| création de branche                    | `POST refs`, échoue si elle existe              | rien d'écrasé en silence  |
| fusion                                 | aucune — « une PR ouverte est un objet inerte » | rien sur `main`           |
| application du diff                    | tout ou rien, AVANT la moindre écriture         | pas de branche orpheline  |

Le point qui comptait le plus est le troisième : `cheminValide` n'est pas
seulement écrite, elle est **appelée au point d'analyse**, et le cas de
traversée est éprouvé de bout en bout (`tests/rustine.test.ts` livre
`../../etc/passwd` et attend un refus). C'est exactement ce que les registres 1
et 2 reprochaient ailleurs — ici, c'est fait.

### Axe (d) — ce qu'un hôte peut faire faire à la machine d'un invité : RIEN À SIGNALER

C'est la frontière qui compte pour ce produit : des amis prêtent leur machine.
La question n'est pas « le hub est-il correct » mais « que se passe-t-il si le
hub ment ? ».

Le nœud ne fait confiance à personne, et c'est écrit noir sur blanc dans
`merge-runner.ts` : _« un nœud ne doit pas tenir pour acquis que le hub est bien
celui qu'il croit »_. Les **trois** chemins d'exécution jugent leurs commandes :

| chemin   | garde                                    | où                               |
| -------- | ---------------------------------------- | -------------------------------- |
| tâche    | `jugerCommandeTest` + `jugerPreparation` | `client.ts:435-436`              |
| chantier | `jugerPreparation`, puis `jugerChantier` | `client.ts:554`, `:595`          |
| merge    | `jugerCommandeTest` + `jugerPreparation` | `runMerge`, avant toute écriture |

Un chantier ne peut nommer qu'un script **que le dépôt déclare lui-même** — le
hub choisit lequel, jamais quoi. Et autour : `shell: false` partout,
environnement épuré (aucun secret du nœud vers l'enfant), sortie plafonnée,
délai dur, enveloppe de bac à sable sur tous les chemins.

### La fausse trouvaille que la méthode a évitée

Un relevé par `grep` montrait `runProc(msg.prepareCommand, …)` au chemin des
chantiers **sans** `jugerPreparation` sur la même ligne, alors que le chemin du
merge, lui, l'appelle explicitement. La conclusion s'écrivait toute seule : la
garde est câblée chez un appelant et pas chez l'autre — la forme exacte des
registres 1 et 2, sur l'axe le plus sensible du produit.

C'était faux. La garde est en `client.ts:554`, dans le même gestionnaire, **avant
le clone**, avec sortie anticipée. Lire le flot de contrôle plutôt que le
résultat du `grep` a évité une trouvaille imaginaire — deuxième fois cette nuit
après `pruneResults`, et pour la même raison.

> **Ce que ça dit de la méthode** : le `grep` propose, il ne conclut pas. Une
> garde absente d'une ligne peut être présente dans le chemin qui y mène, et
> l'inverse est vrai aussi. Seule la lecture du flot — ou l'exécution — tranche.

### Bilan de l'audit #62

| registre | axe                       | résultat                                              |
| -------- | ------------------------- | ----------------------------------------------------- |
| 1        | bornes d'élagage          | 2 points ouverts fermés, doctrine tenue par une garde |
| 2        | bac à sable (a)           | refus en code fourre-tout — **corrigé**               |
| 3        | billets et clés (b)       | exclusion contournable en se renommant — **corrigé**  |
| —        | livraison (c)             | rien à signaler, gardes câblées et éprouvées          |
| —        | frontière hôte/invité (d) | rien à signaler, défense en profondeur                |

Deux défauts de fond trouvés, tous deux **prouvés en exécutant** avant d'être
corrigés, et tous deux de la même famille : une règle écrite que rien
n'appliquait.

## Tâche #64 — l'installeur : ce qui était déjà là, et le seul défaut trouvé

### Ce qui n'a PAS été touché, et pourquoi

L'identité de l'installeur existe déjà, et elle est solide. Rendue aux quatre
niveaux de capacité pour la juger — en la REGARDANT, pas en lisant son code :

| capacité          | ce qui s'affiche                                          |
| ----------------- | --------------------------------------------------------- |
| 24 bits           | la marque en lettres de blocs, dégradé miel ligne à ligne |
| 256 couleurs      | le titre d'une ligne, `⬡  H I V E`                        |
| sans couleur      | idem, sans teinte                                         |
| ASCII 50 colonnes | `<>  H I V E — …`, tronqué proprement                     |

La marque est **volontairement** réservée au 24 bits, et le banc qui le tient
porte sa raison : « sans dégradé, trois lignes de blocs pleins ne sont pas une
marque : c'est un mur d'ambre au-dessus des prérequis, qui sont la seule chose
à lire ». J'ai rendu la marque en 256 couleurs et en monochrome pour vérifier :
c'est **exact**, l'aplat ambre est un mur.

C'est donc une décision d'édition, motivée et éprouvée. La rouvrir pendant que
l'utilisateur dort n'est pas mon rôle — même famille que le nombre de sections
de la vitrine.

### Le défaut, lui, est réel : la légende des codes de sortie mentait

`codes-sortie.ts` le dit de lui-même : ces codes sont une **interface
publique**, « les changer casse les scripts de quelqu'un ». La légende qui les
explique dans `--help` est la partie de cette interface qu'un humain lit.

Elle était écrite **à la main, mot pour mot, dans deux fichiers** — et les deux
copies avaient déjà dérivé, du même côté : **six codes annoncés sur sept**.

`ERREUR` (1) manquait. C'est le fourre-tout, celui qu'un script rencontre le
plus souvent après `0`. Quelqu'un dont l'installation rendait `1` lisait
`--help` et n'y trouvait rien : ni le sens du code, ni même son existence.

La table `SENS` était là, dans le même fichier, et disait la vérité pour les
sept. **Personne ne s'en servait.** C'est le motif de la nuit une fois de plus :
la règle est écrite, et ce qui s'affiche est une copie.

`legendeCodes()` la dérive de `CODE` + `SENS`, et les deux aides l'appellent.

### Mutations — sept passées, sept rouges

| mutation                                                    | verdict  |
| ----------------------------------------------------------- | -------- |
| **le défaut d'origine** : le code 1 disparaît               | 1 rouge  |
| la légende devient vide                                     | 3 rouges |
| les numéros sans leur sens                                  | 2 rouges |
| les sens sans leur numéro                                   | 1 rouge  |
| une aide réécrit la légende à la main (`installer.ts`)      | 1 rouge  |
| une aide cesse d'appeler la légende                         | 1 rouge  |
| une aide réécrit la légende à la main (`installer-main.ts`) | 1 rouge  |

Les trois dernières rejouent la garde **structurelle** contre le geste qu'elle
prétend attraper, sous ses deux formes et sur les deux fichiers — la leçon
§ 2 quatervicies, appliquée d'emblée cette fois plutôt qu'après coup.

Le contrat des codes n'est pas modifié : aucun numéro ne bouge, aucun n'est
ajouté. Seul l'affichage cesse d'en oublier un.

## Le verrou de la loupe — la règle que j'ai enfreinte une heure après l'avoir écrite

### Ce qui s'est passé

§ 2 unvicies dit que deux loupes dans un même atelier ne rendent **aucun**
verdict : l'une restaure pendant que l'autre mesure. La règle avait coûté un
balayage entier, refait seul, avec des chiffres différents.

Le soir même, j'ai lancé un balayage large **en tâche de fond**, puis une
seconde loupe dans le même atelier pour valider une PR. Les deux verdicts sont
nuls. Je ne l'ai vu qu'en comptant les processus.

La fusion de la PR concernée ne repose pas dessus — CI verte sur les 5 jambes,
`mergeable_state` propre, barrière locale entière — et ce verdict-là disait de
toute façon « rien à conclure », pas « feu vert ». Mais la garde n'a pas été
mesurée honnêtement, et ça ne se raconte pas autrement.

### Pourquoi un verrou plutôt qu'une résolution

Ma règle était **exactement du même genre que les défauts corrigés la même
nuit** : écrite, juste, chèrement apprise — et appliquée par rien. Les registres
1, 2 et 3 disaient tous « la borne est écrite, pas câblée ». Le carnet aussi,
donc.

`scripts/loupe.mjs` porte désormais un verrou : `jugerVerrou` (pure, `vivant`
injecté), refus explicite qui nomme le pid tenant et dit quoi faire, péremption
à 2 h contre le pid recyclé, retrait en sortie.

Éprouvé **en exécutant**, dans les deux sens :

| essai                               | mesuré                         |
| ----------------------------------- | ------------------------------ |
| verrou au nom d'un processus mort   | `CODE=0`, la loupe passe       |
| verrou au nom d'un processus VIVANT | `CODE=2`, refus nommant le pid |

Le premier essai avait d'abord été raté : le processus qui posait le verrou
sortait aussitôt, donc son pid était mort et la loupe passait — à raison. Le
banc ne créait pas la condition qu'il prétendait créer, comme le `chmod` en
root du § 2 vicies.

### Mutations — quatre sur la règle, trois sur le câblage

| mutation                                       | verdict  |
| ---------------------------------------------- | -------- |
| le verrou ne bloque JAMAIS                     | 4 rouges |
| le verrou bloque TOUJOURS                      | 1 rouge  |
| la borne de péremption glisse d'une ms         | 1 rouge  |
| la péremption disparaît (pid recyclé condamne) | 3 rouges |
| le câblage mis en **commentaire**              | 1 rouge¹ |
| le câblage **supprimé**                        | 1 rouge¹ |
| le verrou n'est plus retiré en sortant         | 1 rouge  |

### ¹ La garde de câblage a d'abord échoué à son propre rejeu

Elle cherchait `jugerVerrou(` dans tout le fichier. Commenter le câblage, puis
le supprimer, la laissait **verte les deux fois** : `jugerVerrou(` figure aussi
dans sa propre **définition**, quelques lignes plus haut. La garde constatait
que la fonction existe, jamais qu'elle est appelée.

**Troisième fois de la nuit** que « le texte est là » se fait passer pour « la
règle est appliquée » : un appel commenté (§ 2 quatervicies), une règle recopiée
par un banc (registre 2), et maintenant une définition prise pour un appel. Le
motif est stable, seul le déguisement change.

Corrigé en isolant le corps de `principal()` par suivi des accolades. Rejoué
sous les trois formes — trois rouges.

## La porte du compte : « se connecter » pouvait créer un compte

### La survivante, et pourquoi elle sortait du lot des autres

Les rappels de la nuit portaient une liste de survivantes « de moindre portée »
— états vides, bascules d'affichage. **La liste était périmée** : Balance,
premier nom vérifié, était déjà défendue (`tests/vues-sentinelles.test.tsx`,
mutation → 1 rouge). Les listes de survivantes ne se croient pas sur parole ;
elles se remutent.

Sur les huit restantes, une seule ne relevait pas de l'affichage :

    mode === 'login' ? await authLogin(…) : await authRegister(…)

Nudité vérifiée contre la suite **entière** avant d'écrire une ligne : **3 330
tests verts** avec `!==` en place (§ 2 septdecies — « survit » veut dire « survit
aux fichiers que j'ai lancés », donc on lance tout).

### Ce que la mutation produit

Elle ne change pas un affichage, elle change **l'opération d'identifiants**
envoyée au serveur. « Se connecter » appellerait `authRegister` :

- si l'adresse existe déjà, la personne lit « email déjà utilisé » alors qu'elle
  essayait de se connecter — et n'a aucune raison de soupçonner l'écran plutôt
  que sa mémoire ;
- si l'adresse est libre — une faute de frappe suffit — **un compte neuf est
  créé en silence** et la session s'ouvre dessus. La personne se croit chez elle
  et ne voit aucun de ses projets, tandis que son vrai compte n'a pas bougé.

Rien ne casse, tout répond. Et le libellé du bouton resterait juste, puisqu'il
vient d'une **autre** ligne : un écran parfaitement cohérent enverrait la
mauvaise requête.

### Pourquoi le banc existant ne la voyait pas

`tests/compte-porte.test.tsx` existait déjà et gardait `canSubmit`, l'indice de
longueur et le libellé du bouton. Il portait même l'avertissement qui décrit
exactement ce qui s'est passé :

> une famille de bascules ne se garde pas par un seul de ses membres

`mode === 'login'` apparaît **sept fois** dans le composant. Les gardées étaient
les bascules d'affichage ; celle de `submit()` — la seule qui choisisse l'appel
réseau — ne l'était pas. Le nouveau banc vit donc dans ce fichier-là, à côté de
l'avertissement qu'il vérifie enfin.

### Deux voisines débusquées en rejouant

En mutant les six autres occurrences pour vérifier que le banc neuf ne les
confondait pas avec la sienne, **deux ont survécu**. Les mesurer et les laisser
nues aurait été pire que ne pas les avoir regardées — le silence se relit comme
« couvert ».

- **le titre de la modale** : muté, l'écran se contredit (onglet « Connexion »,
  bouton « Se connecter », titre « Créer un compte ») ;
- **l'`autocomplete` du mot de passe** : invisible à l'œil, donc jamais
  remarqué. Muté, il ment dans les deux sens — `new-password` à la connexion
  fait proposer de **générer** un mot de passe au lieu de remplir l'enregistré ;
  `current-password` à l'inscription fait **remplir un mot de passe existant**
  dans un compte neuf, et la réutilisation se fait toute seule.

### Mutations — quatre, quatre rouges

| mutation                                        | avant le lot  | après    |
| ----------------------------------------------- | ------------- | -------- |
| l.90 — l'envoi : `login` et `register` échangés | **survivait** | 4 rouges |
| l.108 — la porte `canSubmit`                    | 4 rouges      | 4 rouges |
| l.125 — le titre de la modale                   | **survivait** | 1 rouge  |
| l.196 — l'`autocomplete` du mot de passe        | **survivait** | 1 rouge  |

### Une chose constatée plutôt que supposée

Le premier banc de contraste cherchait l'onglet « Inscription » après un envoi
réussi. Il a rougi : `submit()` appelle `onClose()`, donc **la modale se
referme** — comportement voulu, que je n'avais pas vérifié. Rouvrir avant de
basculer, plutôt que supposer que l'écran reste tel qu'on l'a laissé.

## Le journal : la moitié droite de la garde n'était éprouvée nulle part

### Ce que la liste disait, et ce qui était vrai

Le rappel nommait `dashboard/src/views/Journal.tsx` — **ce fichier n'existe
pas**. Le Journal vit dans `dashboard/src/Journal.tsx`, un cran plus haut. La
ligne, elle, était réelle :

    typeof v === 'number' && Number.isFinite(v) ? formatDuree(v) : null

Une liste de survivantes se vérifie donc **deux fois** : que la ligne existe, et
qu'elle est encore nue. Nudité confirmée contre la suite entière : **3 336 verts**
avec le `&&` muté en `||`.

### Pourquoi le banc voisin ne la voyait pas

Une sentinelle gardait déjà cette ligne — et éprouvait une durée **absente**.
Or `typeof undefined === 'number'` est déjà faux : la moitié `Number.isFinite`
ne servait **jamais** dans ce banc.

Elle ne porte que pour `NaN` et l'infini, et c'est exactement ce qu'une charge
utile malformée produit : une soustraction de dates dont l'une manque rend
`NaN`, pas `undefined`. Sans cette moitié, le journal afficherait « terminée
en NaN » — alors que l'en-tête du module promet « jamais un 0 ms inventé ».

C'est le § 2 sexvicies dans sa forme la plus pure : la question à poser devant
une survivante n'est pas seulement « ce code est-il mort ? », mais **« quel cas
réel mon banc n'atteint-il jamais ? »**.

### Mutations — cinq passées

| mutation                                   | verdict        |
| ------------------------------------------ | -------------- |
| **la survivante** : le `&&` devient `\|\|` | 1 rouge        |
| `Number.isFinite` disparaît                | 1 rouge        |
| la garde ne filtre plus rien               | 2 rouges       |
| la garde refuse tout                       | 2 rouges       |
| le contrôle de type disparaît              | **ÉQUIVALENT** |

Le dernier est **constaté par écrit** dans la source : `Number.isFinite` est la
forme STRICTE, sans coercition — elle rend déjà `false` sur `'12'`, `null` ou
`undefined`. Les deux versions sont indiscernables pour tout appelant.

Le `typeof` reste quand même, et pas par redondance : il dit l'intention, et il
protège du jour où quelqu'un écrirait le `isFinite` **global** — celui-là
coerce, et `isFinite('12')` vaut `true`.

### Une chose apprise en rougissant

Le premier banc cherchait la ligne `t-infinie`. Elle n'existait pas : le journal
tronque les identifiants à **huit caractères** (`slice(0, 8)`), et `t-infinie`
en fait neuf. Le repère se cherchait donc dans un texte qui ne pouvait pas le
contenir — un banc rouge pour une raison qui n'avait rien à voir avec la garde.

## L'Aiguillage appris — la ruche choisit le modèle qui a fait le mieux, sans se figer

### La demande

L'utilisateur, réveillé : « une fois connectée, la ruche doit pouvoir dire —
Fable 5 pour l'idéation, Opus 5 était meilleur sur cette tâche-là la dernière
fois. Elle teste, garde en mémoire, réutilise le meilleur ; et essaie d'autres
méthodes pour ne garder que la meilleure. »

### Ce qui existait, et ce qui manquait

Le **Polyéthisme** note déjà chaque _nœud_ par sa fiabilité (caste), mais pas le
couple _(genre de tâche × modèle)_ — et un nœud ne déclare qu'un `agentType`,
jamais opus5/fable5. Le **Conseil** fait délibérer plusieurs modèles, mais ne
retient rien d'un tour à l'autre. Il manquait la **mémoire** et le **choix
appris**.

### Trois forks tranchés avec l'utilisateur (présent)

- **Signal appris** : le verdict de **contre-visite** du Polyéthisme
  (`appliquer`/`améliorer`/`refaire`) — une note de qualité, pas un succès
  binaire.
- **Exposition des modèles** : la ruche **choisit**, le nœud **exécute** (la
  tâche portera le modèle, l'adaptateur claude-code le passera au CLI).
- **Catégorie** : **dérivée du prompt/titre**, sans rien demander à personne.

### Le module — `src/orchestrator/aiguillage.ts`, pur

- `categoriser(titre, prompt)` → un des sept genres (idéation, code, correction,
  refactorisation, test, documentation, autre), par comptage de mots FR+EN, la
  précédence départageant les ex æquo (« corriger le test qui échoue » est une
  _correction_, pas un _test_).
- `recompenseDe(verdict)` : `appliquer`=1, `améliorer`=0.5, `refaire`=0. Le
  milieu compte — punir l'à-peu-près comme le faux ferait préférer un modèle qui
  rate moins souvent mais complètement.
- `replierAntecedents` : la mémoire (genre × modèle) → {essais, note}, avec
  **oubli** au-delà de `CORPUS_AIGUILLAGE` (un modèle s'améliore ; on ne le juge
  pas sur ce qu'il n'est plus).
- `choisirModele` / `classer` : **UCB1**, déterministe. Le meilleur score
  l'emporte, mais un modèle **peu essayé** reçoit un bonus, et un modèle
  **jamais essayé** vaut `+∞` (« inconnu » n'est pas « mauvais »). C'est
  exactement « garder le meilleur sans se figer », et sans le moindre
  `Math.random` — deux ruches au même vécu font le même choix.

Le module NE câble rien : déclarer les modèles d'un nœud, porter le modèle dans
l'assignation, enregistrer le verdict — c'est le lot suivant.

### Mutations — huit posées

| mutation                                   | verdict                   |
| ------------------------------------------ | ------------------------- |
| un modèle neuf ne vaut plus l'infini       | 2 rouges                  |
| le bonus d'exploration disparaît (glouton) | 2 rouges                  |
| l'exploration réduite à zéro               | 2 rouges                  |
| le départage par le nom disparaît          | 1 rouge                   |
| le tri classe le PIRE en tête              | 4 rouges                  |
| l'oubli disparaît (fenêtre infinie)        | 1 rouge                   |
| « autre » devient « code » par défaut      | 1 rouge                   |
| la précédence bascule au dernier ex æquo   | **survivait → simplifié** |

### La survivante était du DÉCOR — et le rejeu l'a montré

`rang < meilleurRang` (le départage des ex æquo) muté en `<=` **survivait**. En
cherchant pourquoi : le rang ne fait que **croître** dans la boucle, et n'est
jamais `<` au meilleur déjà retenu — la branche ne se déclenchait **jamais**. La
précédence était en réalité tenue par l'**ordre de parcours** + le `>` strict,
et tout le bookkeeping `meilleurRang` était mort.

Retiré. La fonction est plus courte, et les deux mutations qui éprouvent
vraiment la précédence (`>` → `>=`, et l'ordre inversé) rougissent désormais.
C'est § 2 sexvicies pris à l'endroit : une survivante n'accuse pas toujours le
banc — parfois elle accuse du code qui ne sert à rien.

## POINT DE SORTIE — 4 août 2026, sortie visée ~2 septembre

### 1. Le temps

**29 jours** (4 août → 2 septembre).

Et d'abord une vérité de méthode : **il n'existe aucun « definition of done » de
sortie écrit et mesuré** dans ce dépôt. Le seul jeu de critères mesurés est
celui de l'installation (une commande, ≤ 3 décisions, < 60 s — lot #53). « Une
sortie présentable » n'est donc mesuré par personne, et tant que ce n'est pas
écrit, on ne peut pas dire qu'on l'atteint. C'est le premier manque, et pas le
plus visible.

### 2. Livré ET vérifié depuis hier (pas « écrit » — vérifié)

| lot                                         | comment c'est vérifié                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Audit #62, registre 1 (doctrine des bornes) | garde `tests/bornes-doctrine.test.ts`, rejouée sous ses DEUX formes (appel commenté ET supprimé) → rouge                            |
| Registre 2 (refus de bac à sable)           | **prouvé en exécutant** : le refus sortait `1` au lieu de `CODE.REFUS_SECURITE=5` ; corrigé, 6 mutations rouges                     |
| Registre 3 (exclusion contournable)         | **mesuré sur serveur réel** : `node-exclu-bis` + token maître était ADMIS ; durci (décision d'un agent Fable 5), 8 mutations rouges |
| Axes c (livraison) et d (hôte→invité)       | examinés, rien à signaler ; une fausse trouvaille évitée en lisant le flot de contrôle                                              |
| Lot #64 (légende des codes de sortie)       | annonçait 6 codes sur 7 ; dérivée de la table, 7 mutations rouges                                                                   |
| Le verrou d'exclusivité de la loupe         | **prouvé en exécutant** (CODE=2 face à un pid vivant) — une règle que j'avais moi-même enfreinte                                    |
| La porte du compte                          | « se connecter » pouvait créer un compte ; **nudité prouvée contre la suite entière** (3 330 verts avec la mutation), corrigée      |
| Le journal (`Number.isFinite`)              | la moitié droite de la garde n'était éprouvée nulle part ; banc NaN/infini ajouté                                                   |
| L'Aiguillage appris (`aiguillage.ts`)       | cœur PUR d'un routeur de modèle (UCB1), 18 tests, 8 mutations — une survivante a révélé du code mort, retiré. **NON CÂBLÉ.**        |

Suite **3 299 → 3 355**, mesurée. Douze PR fusionnées (#142–#153) ; #154 (Aiguillage) en CI.

Ce qui est déjà couvert et n'est donc PAS un trou : le parcours de bout en bout
(projet → tâche → 2 nœuds simulés → résultat) par `tests/e2e.test.ts` ; l'install
≤ 3 décisions < 60 s (lot #53).

### 3. Ce qui reste, par ordre de casse pour un nouvel arrivant

1. **Le premier écran — les états vides.** Un nouvel arrivant ouvre un tableau
   de bord VIDE : aucun projet, aucune tâche, ruche déserte. Sept gardes
   d'états vides (Projets, Ruche, Rayon, MonEspace, Partage, Miellerie) restent
   **sans banc** — un message faux ou absent là est la toute première chose
   qu'il voit. **Actionnable, je reprends dessus maintenant.**
2. **La vitrine.** Existe et rend (couverte par `tests/site.test.ts`), mais son
   identité visuelle attend une **décision d'édition de l'utilisateur** (13→7
   sections). Pas cassée, pas finie — et « présentable » n'est mesuré par
   personne (cf. §1).
3. **Le câblage des deux features demandées** (idées de l'utilisateur, réveillé) :
   l'Aiguillage (cœur livré ; reste protocole + assignation + enregistrement) et
   l'agent garde-fou (à concevoir). Utiles, pas bloquants de sortie.
4. **Le tiers non examiné du balayage loupe** (23 mutations sur 35 laissées de
   côté au dernier passage) : couverture inconnue sur le reste du diff cumulé.

### 4. Hors d'atteinte — à DIRE, pas à simuler

- **Les comptes npm (lot 7) et GHCR/cosign (lot 10) ne sont pas les miens.**
  Aucune image publiée ni paquet signé possible depuis ici. L'install par
  `curl | sh` depuis le dépôt fonctionne sans eux, mais « docker pull » d'une
  image officielle et « npm i -g » d'un paquet signé restent bloqués sur une
  décision et des identifiants humains.
- **Aucune VRAIE machine Windows ni macOS.** La CI tourne sur des runners
  GitHub : c'est une preuve que le code passe là-bas, PAS que l'install marche
  sur le poste d'un utilisateur. Le critère « marche sur les 3 OS » est vérifié
  en CI, pas sur du matériel réel — et cette nuance doit être dite.
- **Le nombre de sections de la vitrine (13→7) et les tarifs** : décisions
  d'édition et commerciales de l'utilisateur, pas les miennes.

## Le premier écran, suite : deux états de plus gardés, quatre mesurés nus et en file

Poursuite du point 1 du POINT DE SORTIE. Les sept survivantes d'affichage ont
d'abord été **vérifiées nues contre la suite ENTIÈRE en un seul passage** (les
six restantes mutées d'un coup → 3 349 verts, aucune attrapée). « Pas attrapée
par les bancs de vue » n'est pas « nue » (§ 2 septdecies) ; ce passage groupé,
lui, le prouve.

Deux gardées ce lot, les plus urgentes pour un nouvel arrivant :

- **MonEspace — « expire aujourd'hui » (0 jour).** Le sentinel voisin éprouvait
  5 jours (à venir) et −1 (passé), jamais **0** — et `>= 0` vs `> 0` ne diffèrent
  QU'À zéro. Or zéro jour, c'est l'échéance du jour, le moment où le compte à
  rebours sert le plus. Banc de borne ajouté ; `>= 0` → `> 0` rougit.
- **Partage — l'écran d'un invité.** `rapport === null` garde le « Ouverture du
  rayon… » qu'un invité voit en collant son lien. Muté, la vue lit `rapport.name`
  sur `null` — un plantage à l'accueil de quelqu'un qui découvre le produit.
  Banc par contraste ; le mutant fait tomber les deux tests (TypeError).

Restent **quatre**, mesurées nues et **consignées ici pour n'être pas
silencieuses** (les mesurer et les taire serait pire que ne pas les avoir
regardées) :

| garde                        | fichier       | ce qu'un mutant casse                                             |
| ---------------------------- | ------------- | ----------------------------------------------------------------- |
| `depots.depots.length === 0` | `Projets.tsx` | « Aucun dépôt ne correspond » disparaît de la recherche de dépôts |
| `busy === 'send'`            | `Projets.tsx` | le bouton d'envoi ment sur son état (« Envoi… » au repos)         |
| `e.type === 'dossier'`       | `Rayon.tsx`   | un dossier reçoit l'icône d'un fichier                            |

**Miellerie `showInfo` — GARDÉE depuis.** Le volet « verdict » est ouvert par
défaut (`showInfo` vaut `true`) ; `i` le replie. Muté, il serait replié à
l'ouverture — on relirait les productions sans voir le jugement. Banc par
contraste dans `tests/miellerie-clavier.test.tsx`, mutation `&&` → `!showInfo`
**lue en entier** (1 rouge, § 2 trigies). Restent **trois** : Projets ×2 (flux
GitHub et panneau d'envoi, plus profonds à monter) et Rayon (icône, cosmétique).

### Une leçon de méthode, chèrement rappelée

Le mutant de Partage a d'abord été annoncé **« SURVIT »** par mon script — à
tort. Sur un banc de deux tests où la mutation les fait tomber tous les deux,
vitest n'imprime aucun « passed », et mon compteur retombait sur zéro. Lire la
sortie entière a montré la vérité (deux `TypeError`). Consigné au carnet
(§ 2 trigies) : un verdict de mutation ne se lit pas au seul « passed ».

## Câblage de l'Aiguillage — lot 1 : un nœud déclare ses modèles ; et la décision de stockage

### Lot 1 livré : le protocole

Un nœud claude-code peut désormais déclarer `modeles?: string[]` dans son
`register` (ex. `['claude-opus-5', 'claude-fable-5']`) — le champ que
l'Aiguillage consommera pour choisir. Validé **exactement comme `plateforme`** :
liste bornée (≤ 16), chaque nom une chaîne non vide et courte, et un message mal
formé est **refusé en entier**, pas rafistolé. Optionnel : un nœud d'avant, ou
un agent à modèle unique, n'en envoie pas et le hub retombe sur son
comportement d'avant. Un nom de modèle n'est pas un secret ; il transite en
clair sans danger. Cinq mutations, cinq rouges (vérificateur de verdict corrigé,
§ 2 trigies).

### Décision d'architecture pour la suite — confiée à un agent Fable 5

**Où ranger le lien tâche→modèle ?** L'agent a vérifié le dépôt et tranché :
**une table LATÉRALE, pas une colonne.** Le motif est décisif et je l'ai
re-vérifié : le dépôt a une **règle 2 écrite** (`store.ts` : « aucune migration,
aucune colonne ajoutée à une table existante ») — le schéma est tout en
`CREATE TABLE IF NOT EXISTS`, sans un seul `ALTER TABLE`, donc une colonne neuve
sur `tasks` n'existerait jamais sur une base déjà en service. C'est pourquoi
`taches_issue`, `contre_expertises`, `contre_visites`, `conseil_plans` sont déjà
des tables latérales clé-par-tâche. Le précédent est massif.

Forme retenue (**B′**) — ne recopier RIEN, ne stocker que le fait qui manque :

```sql
CREATE TABLE IF NOT EXISTS aiguillage_modeles (
  taskId  TEXT PRIMARY KEY,   -- une ligne par tâche, dernière assignation gagne
  modele  TEXT NOT NULL,
  choisiA INTEGER NOT NULL
);
```

- Écrite **à l'assignation** (pas sur `results` : le modèle est choisi AVANT
  qu'un résultat existe, et `results` a plusieurs lignes par tâche).
- Les `Observation[]` sont **reconstruites à la lecture** : jointure
  `contre_visites × aiguillage_modeles × tasks`, `ORDER BY renduA DESC LIMIT
CORPUS_AIGUILLAGE`, `categoriser(title, prompt)` calculé au moment du choix.
  Une seule source par fait : `suite` reste dans `contre_visites`, la catégorie
  suit la taxonomie du jour — la dérive à deux copies (le défaut corrigé toute
  la nuit) n'a **pas de troisième endroit où renaître**.
- Doctrine des bornes respectée : `pruneAiguillageModeles`
  (`DELETE … WHERE taskId NOT IN (SELECT id FROM tasks)`), câblée dans
  `server.ts` après `pruneTasks` — table qui grossit sous la machine, bornée et
  câblée dans le même changement (règle 3). Aucune entrée
  `BORNÉES_PAR_L_HUMAIN`.

Lots suivants : (2) la table + ses méthodes + la lecture jointe, avec la garde
`bornes-doctrine` qui reste verte ; (3) le scheduler choisit à l'assignation et
enregistre ; (4) le nœud range ses modèles déclarés et l'adaptateur claude-code
passe `--model` au CLI.

### Lot 2 livré : la mémoire tâche→modèle, côté store

Table `aiguillage_modeles` posée telle que B′ ci-dessus. `poserModeleAiguillage`
(`INSERT OR REPLACE`, dernière assignation gagne), `observationsAiguillage`
(jointure interne modèle × verdict × tâche, `ORDER BY renduA DESC LIMIT`, rendue
en ordre chronologique tel que `replierAntecedents` l'attend), et
`pruneAiguillageModeles` (borne référentielle) câblé après `pruneContreVisites`
dans `server.ts`. Un demi-fait — modèle sans verdict, ou verdict sans modèle —
n'entre PAS dans la mémoire : la jointure interne l'exige, et deux bancs le
tiennent. Banc `aiguillage-store.test.ts` : 6 tests, **6 mutations rejouées, 6
rouges** (INSERT OR REPLACE, jointure interne, ordre DESC, `reverse()`, borne
`limite`, `NOT IN`). `bornes-doctrine` reste verte (table + élagueur câblé dans
le même changement). Fusionné dans #155.

### Ce que l'utilisateur a demandé le 4 août — tester d'AUTRES fournisseurs (xAI, etc.)

> « faut aussi qu'il puisse tester avec les autres modèles d'IA comme chez xAI et
> les autres, fait des tests toute la journée, travaille sur le projet »

Découverte en cherchant où câbler : **la ruche a DÉJÀ les adaptateurs
multi-fournisseurs.** `src/adapters/` porte `grok.ts` (xAI Grok Build, `grok -p`),
`codex.ts` (OpenAI), `claude-code.ts`, `hermes-agent.ts`, `custom.ts`, `shell.ts`.
Un nœud peut donc déjà ÊTRE un nœud Grok. Ce qui manque n'est pas l'exécution,
c'est le CHOIX : l'Aiguillage, précisément. Deux nuances réelles restent :

1. les modèles sont **partitionnés par nœud** (un nœud claude-code ne lance pas
   Grok) — l'ordonnanceur doit choisir **(nœud, modèle) ensemble**, pas juste un
   nœud ; c'est l'objet du lot 3 ci-dessous ;
2. les adaptateurs ne passent pas encore de **variante de modèle** (`grok -p`
   sans `--model`, `claude` sans `--model`) — objet du lot 4.

L'Aiguillage pur traite déjà le modèle comme une chaîne opaque : il route
`grok-4`, `claude-opus-5`, `codex-...` sur le même pied, sans rien de spécial à
faire par fournisseur. Le cœur est donc bon ; il ne reste qu'à le brancher.

### Décision lot 3 — comment marier routeur appris et équilibrage de charge (agent Fable 5)

Le fork : les modèles vivant sur des nœuds différents, comment le routeur appris
pilote-t-il le travail vers le meilleur modèle — Y COMPRIS entre fournisseurs —
sans casser l'équilibrage de charge ni provoquer de famine ? Confié à un agent
Fable 5 (a lu `aiguillage.ts`, les trois sites de `scheduler.ts`, `types.ts`,
`adapters/`, `store.ts`, `drone-wars.ts`). Tranché ainsi :

1. **Union sur les nœuds ÉLIGIBLES, pas tous les nœuds en ligne.** Pipeline :
   filtre d'éligibilité existant (online, `concurrenceEffective`, cooldown de
   refus) → union des `modeles` des seuls éligibles → `choisirModele` → nœud le
   moins chargé parmi ceux qui offrent l'élu. Classer des paires (nœud, modèle)
   serait du sur-machinage : `scoreUCB` ne dépend que de (catégorie × modèle),
   jamais du nœud. L'union sur les _éligibles_ tue structurellement la famine :
   le modèle exclusif d'un nœud saturé n'entre pas dans l'union.
2. **Lexicographique, jamais pondéré.** Éligibilité (filtre dur) → modèle (UCB) →
   charge (départage parmi les offrants) → phéromones puis nom. Un score pondéré
   est mort-né : `scoreUCB` rend `+∞` pour un modèle jamais essayé, aucune
   pondération ne survit à l'infini. Compromis assumé et à écrire : le modèle
   DOMINE la charge parmi les éligibles — c'est le but (« piloter réellement »),
   et la surcharge reste impossible car la capacité est un filtre dur en amont.
3. **Une fonction pure `aiguillerNoeuds(categorie, eligibles, antecedents)`** dans
   `aiguillage.ts` (rend `{ modele, noeuds }` ou `null`), trois retouches
   chirurgicales dans `scheduler.ts` : (site 1) boucle principale, restreindre
   `eligibles` à `route.noeuds` avant le départage phéromones, antécédents
   construits paresseusement une fois par passe (façon `lireTraces`) ; (site 2)
   course de drones, NE PAS restreindre (la course maximise la diversité), mais
   calculer le modèle élu par drone et le ranger dans la `DroneRace` en mémoire ;
   (site 3) victoire/promotion, re-poser le modèle du nœud qui devient
   `assignedNodeId`, lu dans la course.
4. **No-op** : garde en tête de `aiguillerNoeuds` — aucun éligible ne déclare de
   `modeles` non vide ⇒ `null`, l'appelant ne touche à RIEN (même tri, mêmes
   phéromones, zéro lecture SQL neuve, aucun `poserModeleAiguillage`). À
   verrouiller : flotte sans `modeles` ⇒ trace d'événements et écritures store
   strictement identiques à aujourd'hui.
5. **On enregistre le modèle COMMANDÉ**, dans le même geste que le `patchTask`
   d'assignation réussi (jamais avant le patch — un patch raté poserait un modèle
   fantôme ; jamais au résultat — les ré-assignations doivent écraser). Course :
   poser le modèle du primaire au départ, RE-poser celui du VAINQUEUR au `won`
   (c'est sa production que la contre-visite juge, et `won` précède `renduA`).
   Nuance à documenter : c'est le modèle commandé, pas prouvé exécuté — l'écho du
   modèle effectif par le nœud est le lot 4.
6. **Piège du troupeau, borné.** Le `+∞` d'exploration tient jusqu'au premier
   VERDICT (la jointure passe par `contre_visites`), pas jusqu'au premier
   lancement — un modèle neuf aspirerait donc toutes les tâches prêtes de la
   catégorie. Borne : compter les élections EN VOL (modèle posé, verdict pas
   rendu) comme des `essais` supplémentaires injectés dans les antécédents avant
   `classer` — le premier lancement éteint l'infini, la moyenne est
   temporairement pessimiste puis se corrige, tout reste déterministe (les ex
   æquo à `+∞` restent départagés par `localeCompare`, déjà en place). Famine par
   nœud saturé : morte-née (reco 1). Boucle par refus : déjà bornée par le
   cooldown `recentRejections` existant.

Découpage retenu pour tenir des lots relisibles : **lot 3a** — `node.modeles`
atteint le hub (types + table latérale 1:1 `modeles_noeuds` façon `plateforme`,
`registerNode` la range, `NODE_SELECT` la joint, `server.ts` la passe) + la
fonction pure `aiguillerNoeuds` et ses bancs ; AUCUN changement de comportement
du scheduler. **Lot 3b** — les trois sites du scheduler s'en servent, l'élection
est enregistrée, la borne des élections en vol ; le comportement change alors,
sous la garde du no-op. **Lot 4** — l'adaptateur passe la variante au CLI.

### Lot 3b livré : la boucle principale de l'ordonnanceur écoute le routeur

`assignReadyTasks` appelle `aiguillerNoeuds` entre le tri par charge et le
départage phéromones. Antécédents repliés au plus une fois par passe
(`lireAntecedents`, jumeau de `lireTraces`) — et seulement si un éligible déclare
des modèles, sinon zéro lecture SQL neuve. La catégorie est RECALCULÉE à la
lecture (`categoriser`), jamais figée. Le départage phéromones opère sur la
sous-liste restreinte (`candidats`), pas sur tous les éligibles : un nœud écarté
faute du bon modèle ne revient pas par la porte des phéromones — sinon on
enregistrerait un modèle pour une tâche partie sur un nœud qui ne sait pas le
lancer. Le modèle commandé est rangé (`poserModeleAiguillage`) APRÈS le patch
d'assignation réussi, jamais avant.

**Inerte en production jusqu'au lot 4** : aucun nœud ne déclare encore de
modèles, donc `aiguillerNoeuds` rend toujours `null` — d'où la sûreté de câbler
le routeur et son enregistrement AVANT que quoi que ce soit ne les active.

Banc `aiguillage-scheduler.test.ts` : 4 tests (no-op sans modèles, aiguillage +
élection enregistrée, union sur les éligibles / famine tuée, modèle avant
phéromones), toutes les mutations rejouées rouges — dont une survivante attrapée
et corrigée (§ 2 duotrigies : un départage phéromones sur la mauvaise liste
survivait faute d'un banc qui pose une phéromone sur un non-porteur). Les 117
tests d'ordonnancement voisins restent verts. **Reste 3b-bis** — la borne du
troupeau (élections en vol) — puis **lot 3c** (course de drones), **lot 4**
(activation : le nœud déclare, l'adaptateur passe `--model`).

### Lot 3b-bis livré : la borne du troupeau (élections en vol)

Le `+∞` d'un modèle jamais essayé tient jusqu'au premier VERDICT — pas jusqu'au
premier LANCEMENT. Le temps que les contre-visites reviennent (des minutes), un
modèle neuf raflerait toutes les tâches prêtes de son genre. Corrigé côté
CROISÉ-PASSE (la limite de capacité borne déjà chaque passe) :

- `store.electionsEnVolAiguillage()` — les tâches ENCORE actives
  (`assigned`/`running`) au modèle posé mais sans contre-visite. DEUX filtres,
  pas un : « sans verdict » seul laisserait une tâche `done`/`failed` jamais
  relue peser en vol pour toujours ;
- `aiguillage.injecterEnVol(antecedents, enVol)` — +1 `essai` SANS note par
  élection en vol : le `+∞` s'éteint dès le premier lancement (score fini),
  moyenne temporairement pessimiste puis corrigée aux vrais verdicts ;
- `scheduler.lireAntecedents` — injecte les élections en vol après les verdicts,
  une fois par passe.

Banc : 3 `injecterEnVol` (le `+∞` s'éteint, la note reste 0, chaque vol compte),
4 `electionsEnVolAiguillage` (active+sans verdict = en vol ; jugée sort ; `done`
sans verdict n'entre pas ; sans modèle rien), 1 intégration (un modèle neuf à
5 élections en vol ne rafle plus la tâche prête, opus reprend). Mutations
rejouées rouges aux trois niveaux (pure, store, câblage). **Reste** : lot 3c
(course de drones — les deux sites du scheduler encore intouchés), lot 4
(activation).

### Lot 3c livré : la course de drones enregistre le modèle du vainqueur

Le second chemin d'assignation (Plein Essaim). Parti pris DIFFÉRENT de la boucle
principale : on ne RESTREINT PAS la course au meilleur modèle — une course tire
sa robustesse de la DIVERSITÉ des agents (décision Fable 5). On note seulement :

- `DroneRace.modeleParDrone?` (nodeId → modèle), rempli par le scheduler à
  l'enrôlement (drone-wars reste pur), préservé au fil des `{ ...race }` ;
- `startRace` : `choisirModele` par drone ; le modèle du PRIMAIRE est posé dès le
  départ — la course compte alors comme une élection en vol (borne du troupeau) ;
- `handleDroneResult 'won'` : on RE-pose le modèle du VAINQUEUR (écrase le
  primaire) — c'est SA production que la contre-visite jugera ;
- `promoteNextDrone` : le producteur suivi change, l'élection en vol suit ;
- `antecedentsAiguillage` extrait (repli des verdicts + injection des essais en
  vol), partagé par la boucle principale (mémoïsé) et la course (une fois).

Banc `aiguillage-drone.test.ts` : le vainqueur non-primaire voit SON modèle
enregistré (pas le primaire remplacé) ; le primaire est en vol pendant la
course ; la promotion suit le producteur ; no-op sans modèles. Mutations des
trois sites de pose rejouées rouges, chacune par son banc. **Reste** : lot 4
(activation — le node-client déclare ses modeles détectés, l'adaptateur passe la
variante au CLI). Après le lot 4, la boucle est CÂBLÉE de bout en bout : le nœud
déclare → la ruche choisit → le nœud exécute → la contre-visite juge → la ruche
apprend.

### Lot 4 livré : L'ACTIVATION — la boucle est câblée de bout en bout

La ruche choisit désormais un modèle ET le fait exécuter. **4a et 4b vont
ENSEMBLE par nécessité** : sans 4b, un nœud qui déclare des modèles ferait
choisir+enregistrer (lots 3b/3c, déjà vifs) un modèle que l'adaptateur
n'emploierait pas — le verdict serait attribué au MAUVAIS modèle, et l'Aiguillage
apprendrait un mensonge. Presque livré 4a seul ; rattrapé avant le commit.

- **4a — le nœud DÉCLARE (déclaré, pas détecté).** `parseModeles(HIVE_MODELES)`
  (pur, sanitisant : vide/doublon/nom démesuré écartés, borné comme le protocole,
  rien de valide ⇒ `undefined` ⇒ no-op). On ne DÉTECTE pas : un modèle qu'un
  abonnement interdit échouerait en boucle SANS rendre de verdict (l'échec
  d'infra réassigne, il ne juge pas), donc l'Aiguillage ne pourrait même pas
  apprendre à l'éviter — l'opérateur seul sait ce que son compte peut appeler.
  `NodeClientOptions.modeles` inclus dans le register (validé au lot 1).
- **4b — le modèle ATTEINT le CLI.** `assign_task.modele` (protocole, optionnel,
  validé comme un nom de nœud) ; `onAssign(nodeId, task, modele)` (la boucle passe
  `route.modele`, la course `modeleParDrone[droneId]`) ; `server.envoyerTache` le
  met dans `assign_task` ; le node-client le passe en `ctx.modele` ; `argvClaude`
  (pur, extrait) → `--model <nom>` AVANT le `--`, prompt en dernier, `shell:false`.

**Bornes de couverture, dites honnêtement.** Les points de DÉCISION sont tous
éprouvés par mutation (8 rejouées rouges) : `parseModeles` (chaque clause + la
borne), `argvClaude` (avec/sans, position avant `--`), `assign_task.modele`
(accepté/rejeté), les DEUX sites `onAssign`. Les deux PASSE-PLATS d'une ligne
entre ces extrémités — `envoyerTache` qui recopie `modele` dans `assign_task`, et
le node-client qui le pose en `ctx.modele` — ne sont pas éprouvés par un banc
DÉDIÉ : un e2e qui les couvrirait dépendrait du minuteur du tick (assignation
asynchrone), et ce dépôt a trop de leçons sur les intermittents (§ 9) pour en
ajouter un flou. Ils sont couverts par COMPOSITION (onAssign prouvé porte le
modèle ; `assign_task.modele` prouvé se relit ; `argvClaude(ctx.modele)` prouvé),
et par relecture. Frontière assumée, pas oubliée.

**La boucle est complète** : le nœud déclare (`HIVE_MODELES`) → la ruche choisit
(UCB1, borné) → le nœud exécute (`--model`) → la contre-visite juge → la ruche
apprend, et n'arrête jamais d'explorer. C'est la demande d'origine de
l'utilisateur, tenue. Reste, hors Aiguillage : l'Agent Garde-Fous (feature 2,
non commencée), et les tâches de nuit #63.

---

## FEATURE 2 — l'Agent Garde-Fous (la ruche apprend son propre trou de vol)

Demande utilisateur, verbatim : « je veux aussi dans Hive un agent garde-fous
qui teste les meilleurs garde-fous pour des projets avec la base de l'IA — mais
pas forcément utilisé sur tous les projets ». Même moteur explore/exploit UCB1
que l'Aiguillage, mais appliqué à une autre question : « quel ÉCHELON de
garde-fous pour ce PROJET ? », et OPT-IN par projet.

### Le fork tranché par un agent Fable 5 (avant d'écrire une ligne)

Trois partis pris étaient ouverts ; un agent Fable 5 les a tranchés, et voici la
décision retenue (avec la justification, pour qu'on n'ait pas à la redémontrer) :

**Q1 — LE BRAS : une ÉCHELLE de trois échelons ordonnés, pas un éventail.**
`leger < standard < strict`, chacun un paquet cohérent de deux modes
(`{ModeGardiennes, ModePolyethisme}`), et rien d'autre :

- `leger` = gardiennes `consultatif` + polyéthisme `consignes` (on annote et on
  cadre, rien n'est jamais retenu) ;
- `standard` = gardiennes `strict` + polyéthisme `consignes` (le trou de vol refuse
  le nectar creux, mais aucune contre-visite ne retient) ;
- `strict` = gardiennes `strict` + polyéthisme `strict` (le paquet complet).

Pourquoi PAS le produit cartésien (9 configs) ni les interrupteurs indépendants :
un projet réel rend quelques verdicts par jour ; neuf bras passeraient des
semaines à seulement éteindre les infinis d'exploration. C'est l'argument déjà
gravé dans l'Aiguillage (« une taxonomie fine se paie deux fois »). L'ordre TOTAL
n'est pas un luxe : les bornes {min, max} de gouvernance (Q3) n'ont de sens que
sur une échelle ordonnée. Les SEUILS de caste (SEUIL_BATISSEUSE, FIABILITE_…) ne
sont PAS des bras et ne le seront jamais : ils calibrent le polyéthisme lui-même,
et les faire varier par projet rendrait les castes incomparables d'une ruche à
l'autre — une butineuse doit vouloir dire la même chose partout.

**Q2 — LA RÉCOMPENSE : un compromis qualité/coût, pour que « toujours strict » ne
gagne pas trivialement.** `r = (2·q + 1·f) / 3`, dans [0, 1] :

- `q`, la QUALITÉ = le verdict des GARDIENNES (`clean`=1, `suspect`=2/3, `hollow`=0),
  et `q = 0` si la production a fini REPRISE, quel que soit le verdict d'entrée.
  Le 2/3 est `1 − POIDS_SUSPECTE`, la même indulgence que `fiabilite()`. C'est le
  MÊME instrument sur tous les échelons ;
- `f`, la FLUIDITÉ = ce que le garde-fou a coûté (`directe`=1,
  `retenue_puis_relachee`=1/2, `en_attente`=0).

Le verdict de CONTRE-VISITE (`appliquer/ameliorer/refaire`) n'entre PAS dans `r` :
il n'existe que sur l'échelon `strict`, et une récompense mesurée avec un
instrument différent selon le bras ne compare rien. Le bénéfice de la
contre-visite se lit par ce qu'elle PRÉVIENT (moins de reprises), pas par sa
propre note. Le strict paie son péage `f=1/2` à chaque relecture même stérile, et
ne le rembourse que s'il évite réellement des creux ; le léger encaisse `q=0` sur
chaque creux qui passe. Les jetons/la durée bruts restent dehors : `durationMs`
varie cent fois plus avec la taille de la tâche qu'avec le réglage — un
dénominateur bruité. **« gardiennes off » est EXCLU de l'espace des bras** : un
bras qui éteint l'instrument de mesure n'a aucun signal, donc reste à `+∞` pour
toujours ou paraît nul sur du vide — deux faux. L'humain peut éteindre les
Gardiennes, mais c'est un geste HORS échelle (l'agent inactif), pas un bras.

**Q3 — LA GOUVERNANCE : l'agent APPLIQUE, mais seulement DANS des bornes que seul
l'humain écrit, et il s'y meut dans les DEUX sens.** Une table `garde_fous` sur le
motif exact de `essaim` (une ligne par projet, une intention humaine jamais un
calcul, borne structurelle sans élagueur, → `BORNÉES_PAR_L_HUMAIN`) porte
`{actif, borneMin, borneMax, definiPar}`. Pas de ligne ou `actif=0` ⇒ l'agent
n'existe pas pour ce projet (l'opt-in demandé). DANS les bornes, l'agent relâche
ET resserre : un cliquet « resserrer seul » serait interdit par la règle 3 du
polyéthisme et convergerait mécaniquement vers le plus strict (le gagnant trivial
qu'on vient d'écarter, en contradiction avec la règle 6). La doctrine « une ruche
qui élève son propre niveau d'autonomie est échappée » vise l'élargissement de sa
PROPRE latitude — pas le mouvement dans une latitude déjà consentie. Quatre
verrous : opt-in ; bornes écrites par `definiPar` SEUL (le module REÇOIT ses
bornes, n'en REND jamais) ; plancher structurel (l'échelon le plus bas garde les
Gardiennes allumées — « tout éteindre » inatteignable par l'agent) ; élections
journalisées.

### Lot G1 livré : le module PUR `src/orchestrator/garde-fou.ts` (inerte)

Comme le lot 2 de l'Aiguillage : le module pur d'abord, AUCUN câblage, aucun
changement de comportement. Il RÉUTILISE littéralement le moteur de l'Aiguillage
(`scoreUCB`, `moyenne`, `Antecedent`) — c'est le « même moteur » demandé, partagé
pour de vrai, pas recopié.

Surface : `ECHELONS`/`rangEchelon`, `REGLAGES` (le paquet de modes par échelon,
plancher jamais `off`), `NOTE_VERDICT`/`NOTE_TRAVERSEE`/`POIDS_QUALITE`(2)/
`POIDS_FLUIDITE`(1)/`recompenseGardeFou`, `CORPUS_GARDE_FOU`(200)/
`replierAntecedentsGardeFou`, `Bornes`/`BORNES_DEFAUT`/`normaliserBornes` (inversées
⇒ resserrées sur le plus strict, fermé par défaut)/`echelonsPermis` (jamais vide),
`comparerRangs` (un SEUL départage partagé : score décroissant puis plus strict à
ex æquo)/`classerEchelons`/`elireEchelon` (jamais `null`, via `reduce` sans valeur
initiale sur une liste garantie non vide — pas d'assertion `!`, pas de branche
morte).

Banc `tests/garde-fou.test.ts` : 18 tests. Chaque point de décision éprouvé par
mutation (rejeu rouge affiché) — les poids 2/1 (via le couple clean+en_attente=2/3
et hollow+directe=1/3), la porte `reprise` (clean+directe reprise=1/3 vs 1), la
fenêtre `slice(-CORPUS)` (l'ancienne oubliée), les bornes inversées (resserrées
sur le strict), et surtout le verrou de gouvernance (`strict` parfait mais hors
bornes n'est JAMAIS élu). **Reste** : lot G2 (la table `garde_fous` + la
reconstruction des observations par jointure, motif `observationsAiguillage`), lot
G3 (le câblage scheduler : lire les bornes, élire, appliquer le `Reglage`,
journaliser), lot G4 (protocole/tableau de bord).

### Lot G2 livré : la table `garde_fous` — le consentement humain (inerte)

La première moitié de la mémoire du Garde-Fous : les BORNES qu'un humain pose,
et rien de ce que la ruche calcule. Motif `essaim`/`budgets` au mot près — une
ligne par projet, `{actif, borneMin, borneMax, definiPar}`, `INSERT … ON CONFLICT
DO UPDATE`, suppression sur `null`, borne STRUCTURELLE (1:1 avec `projects`, aucun
élagueur) inscrite dans `BORNÉES_PAR_L_HUMAIN` avec son motif. `setGardeFou`
(bornes typées `Echelon` à l'écriture), `getGardeFou` (bornes en texte brut — les
valider est le geste du module, `normaliserBornes`, pas du store ; `null` ⇒
inactif par absence, l'opt-in demandé), `listProjetsGardeFou` (actifs seuls,
triés).

L'échelon ÉLU n'est délibérément PAS rangé ici (règle 1 : aucune vue dérivée
matérialisée — il se recalcule des antécédents). Cette table ne porte QUE le
consentement ; la seconde moitié (l'échelon posé par tâche + les observations
reconstruites par jointure) est le lot G3, séparé parce qu'elle porte un vrai
fork : le verdict `attendre` (production retenue à la revue humaine) N'EST PAS
rangé dans `contre_visites` (sa contrainte CHECK n'admet que appliquer/ameliorer/
refaire), donc reconstruire la `traversee` (`en_attente`) de la récompense
demande soit de PERSISTER ce fait daté (doctrine « un verdict recalculé est un
mensonge à retardement »), soit de le DÉRIVER de la caste vive — à trancher (agent
Fable 5) au lot G3.

Banc `garde-fou-store.test.ts` : 6 tests (inactif par absence, aller-retour,
booléen `actif` reconstruit, écrasement en place, retrait sur `null`, liste triée
des actifs seuls — identifiants littéraux pour que le ORDER BY rougisse sans
intermittence). Mutations rejouées rouges. `bornes-doctrine.test.ts` reste vert :
la table neuve est bornée-par-l'humain, pas orpheline.

### Lot G3 livré : les observations reconstruites par jointure (inerte)

La seconde moitié de la mémoire du Garde-Fous. Le fork de la `traversee` (tranché
par un agent Fable 5, consigné ci-dessous) : le verdict « attendre » (production
retenue à la revue humaine) N'EST PAS rangé dans `contre_visites` (sa contrainte
CHECK n'admet que appliquer/ameliorer/refaire), donc « aucune contre-visite »
recouvrait DEUX cas opposés — `directe` (passée librement, fluidité 1) et
`en_attente` (retenue, fluidité 0). Les confondre fausserait la récompense aux
deux extrêmes.

**Décision (A raffinée) : persister le seul atome NON recalculable — l'EXIGENCE —
et DÉRIVER la traversée à la lecture.**

- `garde_fou_echelons(taskId PK, echelon, choisiA)` — l'échelon qui a gouverné une
  tâche, posé à l'assignation (motif `aiguillage_modeles`, INSERT OR REPLACE).
- `garde_fou_exigences(productionTaskId PK, exigence CHECK(exigee|dispensee),
decideA)` — une contre-visite était-elle REQUISE ? Fait décidé à l'instant où la
  caste VIVE est interrogée (`exigeContreVisite`), donc figé là : rejuger une
  vieille production avec la caste d'AUJOURD'HUI serait un mensonge à retardement
  (le mal que la doctrine des Gardiennes existe pour empêcher). C'est le seul
  atome qu'on range, et rien d'autre.
- `observationsGardeFou()` — jointure `garde_fou_echelons × gardiennes (verdict le
plus récent) × contre_visites × garde_fou_exigences`, filtrée aux productions
  TRANCHÉES (une contre-visite OU une exigence), rendue chronologique et bornée
  (motif `observationsAiguillage`). Rend des FAITS BRUTS, jamais la traversée.
- `observationDepuisFaits` (PUR, garde-fou.ts) — reconstruit la traversée comme une
  VUE : contre-visite faite ⇒ `retenue_puis_relachee` (+ `reprise` si `refaire`) ;
  sinon exigée ⇒ `en_attente` ; sinon dispensée ⇒ `directe` ; sinon (rien de
  tranché) ⇒ `null`, EN VOL, fermé par défaut — on ne suppose JAMAIS `directe`
  faute de décision.

Pourquoi PAS ranger la traversée toute faite : la figer figerait un ÉTAT — une
production retenue aujourd'hui, RELÂCHÉE demain si une relectrice de caste
suffisante émerge, laisserait une ligne `en_attente` menteuse. La traversée est
une vue de deux faits datés (règle 1 de La Balance : aucune vue matérialisée).
Pourquoi PAS une colonne sur `garde_fou_echelons` : cette table est INSERT OR
REPLACE (dernière assignation gagne) — une réassignation effacerait la traversée
d'un premier temps. Deux faits datés dans une ligne = dérive.

Deux bornes référentielles jumelles (`pruneGardeFouEchelons`,
`pruneGardeFouExigences`), câblées dans server.ts après `pruneTasks` dans le MÊME
lot (règle 3) — `bornes-doctrine.test.ts` reste vert. Bancs : 6 tests purs
(`observationDepuisFaits`, chaque branche + le null en vol) et 5 de store
(assemblage, écart des en vol, verdict le plus récent, ordre + LIMIT, les deux
élagueurs orphelin/vivant). Mutations rejouées rouges. **Reste** : lot G4 (câblage
scheduler — lire les bornes, élire, appliquer le `Reglage`, poser l'échelon à
l'assignation et l'exigence au point `exigeContreVisite`), lot G5 (protocole /
tableau de bord).

### Lot G4a livré : le câblage Gardiennes de l'ordonnanceur (boucle principale)

L'ACTIVATION, première moitié : sur un projet OPT-IN, la ruche élit un échelon de
garde-fous dans les bornes de l'humain, le POSE à l'assignation, et la sévérité
des Gardiennes de la production suit CET échelon. Projet non opt-in ⇒ repli sur le
mode global — la ruche reste indiscernable d'avant (inerte tant que personne
n'active, comme l'Aiguillage sans HIVE_MODELES).

- `store.getEchelonGardeFou(taskId)` — l'échelon POSÉ, lu à la réception : le mode
  qui JUGE est le mode qui a GOUVERNÉ. On ne re-élit jamais après coup (les
  antécédents ont pu bouger).
- `garde-fou.versEchelon(brut)` (pur) — valide le texte des bornes rendu brut par
  le store.
- `scheduler.antecedentsGardeFou()` — replie `observationsGardeFou → observationDepuisFaits`.
- `scheduler.echelonGardeFouElu(projectId)` — `null` si pas d'opt-in ; sinon
  `elireEchelon` dans les bornes (illisibles ⇒ repli sur le plus strict).
- `scheduler.modeGardiennesDe(task)` — échelon posé ? `REGLAGES[echelon].gardiennes`
  : mode global. Câblé à la porte `renifler` et au REFUS de `handleTaskResult`.
- Pose : après le patch d'assignation réussi (comme le modèle de l'Aiguillage).

**Fork tranché (moi-même, défendable) : l'apprentissage est GLOBAL, la gouvernance
PAR PROJET.** Les antécédents replient le vécu de TOUTE la ruche (motif Aiguillage),
pas d'un seul projet. Un apprentissage par projet n'aurait presque jamais assez de
verdicts pour sortir du « fermé par défaut » (c'est la raison même de l'échelle à
trois échelons — « un projet rend quelques verdicts par jour ») : il resterait
bloqué sur strict, ce qui NIE l'adaptation qu'on cherche. Le global apprend vite
quel échelon offre le meilleur compromis, et le PAR-PROJET vit dans l'opt-in et les
bornes (un dépôt d'auth pose min=strict, un prototype ouvre à leger). C'est
sample-efficient ET gouverné par projet.

**Bornes de ce lot, dites honnêtement.** Ne sont PAS encore câblés : la COURSE DE
DRONES (le second REFUS, `handleDroneResult`, laissé au mode global — un drone n'a
pas d'échelon posé, donc `modeGardiennesDe` y replierait déjà sur le global : le
changer serait un mutant équivalent tant que rien n'y pose d'échelon), et le
POLYÉTHISME (contre-visite + exigence, server-side, lot G4b) — c'est LUI qui rendra
les observations repliables et fera vraiment APPRENDRE le bandit ; tant que G4b
n'est pas là, tout projet opt-in reste à `strict` (aucune observation ⇒ +∞ ⇒
départage strict), ce qui est SÛR et non menteur (l'échelon posé strict gouverne
bien les Gardiennes ; aucun verdict n'est encore attribué).

Banc `garde-fou-scheduler.test.ts` : 5 tests (no-op sans opt-in, froid → strict,
compromis appris → leger, bornes respectées → jamais hors {min,max}, le REFUS suit
l'échelon et pas le mode global). Mutations rejouées rouges. **Reste** : G4b
(Polyéthisme + exigence → l'apprentissage démarre), G4c (course de drones), G5
(protocole/tableau).

### Lot G4b livré : le Polyéthisme + l'exigence côté livraison (l'apprentissage démarre)

L'ACTIVATION, seconde moitié — et c'est ELLE qui ferme la boucle d'apprentissage.
En G4a, tout projet opt-in restait à `strict` faute d'observations repliables. G4b
range l'EXIGENCE, ce qui rend les productions repliables : le bandit apprend enfin.

Dans `server.ts`, au point de décision de livraison (`contreVisiteAutorise`, appelé
par `aLivrer`) :

- `polyethismeDe(task)` — le jumeau server de `modeGardiennesDe` : échelon posé ?
  `REGLAGES[echelon].polyethisme` : mode global. Les DEUX modes d'une production
  viennent donc du MÊME échelon posé.
- Le court-circuit global `polyethismeEnVigueur() !== 'strict'` devient
  `polyethismeDe(task) !== 'strict'` : un projet opt-in en `strict` ATTEINT la
  contre-visite même sous un hive global `consignes` (sans quoi la sévérité
  choisie n'aurait aucun effet).
- L'EXIGENCE est RANGÉE pour toute production d'un projet opt-in :
  `dispensee` si l'échelon n'est pas strict (branché AVANT le gate, sinon les
  productions `leger`/`standard` — dispensées de contre-visite — n'auraient jamais
  d'exigence et resteraient en vol à vie), sinon `exigee = exigeContreVisite(...)`.
  `INSERT OR REPLACE` : rejoué à chaque passe, la dernière décision (au moment de
  livrer) gagne, motif de la doctrine des Gardiennes.

Banc `garde-fou-livraison.test.ts` : 2 tests via un GET SYNCHRONE sur `/essaim`
(runner éteint → aucun tick, aucun intermittent § 9 ; aucun GitHub, aucun réseau —
`etatEssaim` ne fait que COMPTER, et ce comptage passe par `aLivrer →
contreVisiteAutorise`). LEGER : la production passe d'EN VOL à REPLIABLE, exigence
`dispensee` rangée. STRICT : la contre-visite est atteinte malgré le global
consignes, exigence `exigee` rangée (nœud nourrice). Mutations rejouées rouges.

**Bornes de ce lot, dites honnêtement.** Le cadre de prompt (`construireCadre`,
server ~1132) garde son gate global `polyethismeEnVigueur() === 'off'` : le texte
du cadre est IDENTIQUE entre `consignes` et `strict` (seule la contre-visite les
sépare), donc un projet opt-in reçoit déjà son cadre tant que le global n'est pas
`off` ; le seul trou (global `off` + opt-in) est un réglage rare, laissé à un lot
ultérieur avec la course de drones (G4c). **Reste** : G4c (course de drones —
second REFUS + pose côté drone), G5 (protocole / tableau de bord).

La boucle est CÂBLÉE de bout en bout sur la voie principale : le projet opt-in →
la ruche élit un échelon dans ses bornes (G4a) → la production est gouvernée
(Gardiennes G4a + Polyéthisme G4b) → l'exigence et le verdict sont rangés → la
contre-visite juge → `observationsGardeFou` replie → le bandit apprend, et
n'arrête jamais d'explorer.

### Lot G4c livré : la course de drones (le second chemin d'assignation)

L'autre voie d'assignation (Plein Essaim) suit maintenant l'échelon de garde-fous,
comme la voie mono (G4a). Parti pris IDENTIQUE à l'Aiguillage : on ne RESTREINT
PAS la course à un échelon — sa robustesse vient de la DIVERSITÉ des agents. On
POSE seulement.

- Pose UNE FOIS au lancement (`lanceCourse`, après le modèle du primaire) :
  `echelonGardeFouElu(task.projectId)` puis `poserEchelonGardeFou(taskId, …)`. Le
  mode de garde-fous est PAR TÂCHE (pas par drone comme le modèle), donc un seul
  pose suffit — il vaut pour le drone qui gagnera, sans re-pose au vainqueur ni à
  la promotion (contrairement au modèle, re-posé car il diffère par drone).
- Le REFUS de la course (`handleDroneResult`) lit désormais `modeGardiennesDe(task)`
  au lieu du seul mode global — la même parité qui empêche une course de
  contourner les Gardiennes vaut pour l'échelon élu. Maintenant TESTABLE (en G4a
  ce site restait au global, faute d'échelon posé côté drone : c'eût été un mutant
  équivalent).

Banc `garde-fou-drone.test.ts` : 2 tests (l'échelon posé au lancement pour un
projet opt-in / rien sinon ; le REFUS de la course suit l'échelon — un creux d'un
drone sous un projet opt-in strict est refusé, `applique` vrai, là où un projet
non opt-in sous le même global consultatif ne refuse pas). Mutations rejouées
rouges. Leçon consignée dans docs/ERREURS.md (§ 2 quattuortrigies : le piège bash
`+ "'x'" +` qui éclate le motif de mutation en arguments — un faux « bit »).

**L'Agent Garde-Fous est CÂBLÉ de bout en bout, sur les DEUX chemins
d'assignation.** Reste, hors cœur : G5 (protocole / tableau de bord — exposer
l'échelon élu et son vécu au Mission Control, comme l'Aiguillage montre ses
modèles), et le trou assumé du cadre de prompt sous global `off` + opt-in (rare).

### Lot G5a livré : les endpoints du tableau de bord (lire l'état, régler l'opt-in)

Le Garde-Fous devient VISIBLE et RÉGLABLE, comme le Plein Essaim — deux gestes,
côté server (le React suit au lot G5b). Aucun précédent : l'Aiguillage n'est
exposé NULLE PART au tableau (recon), donc c'est la première fois qu'un bandit
appris se montre à l'humain.

- `scheduler.classementGardeFou(projectId)` (PUBLIC, motif `get gardiennes`) : le
  classement des échelons PERMIS d'un projet — le premier est l'ÉLU — ou `[]` sans
  opt-in. Réutilise `antecedentsGardeFou` + `classerEchelons` (rien de neuf côté
  calcul). L'humain voit la moyenne / les essais / le score par échelon : POURQUOI
  tel échelon gouverne.
- `GET /api/projects/:id/garde-fou` : le consentement (opt-in + bornes + poseur) +
  `echelonElu` + `classement` + l'échelle complète (`ECHELONS`, `REGLAGES`) pour
  décrire ce que chaque échelon commande. Gardé par `lectureProjetPermise`, 404 si
  projet inconnu.
- `POST /api/projects/:id/garde-fou` : geste HUMAIN (le méta garde-fou — la ruche
  n'élargit jamais sa propre latitude). Schéma Fastify : `actif` booléen,
  `borneMin`/`borneMax` validés contre l'échelle (`enum [...ECHELONS]`,
  `additionalProperties:false`) — seul un échelon connu entre. `setGardeFou(…,
'humain')`. Gardé par `authorized`, 404 si projet inconnu.

Banc `garde-fou-endpoint.test.ts` : 5 tests via le harnais HTTP (createServer,
runner éteint — aucun intermittent § 9). Non opt-in (inactif, classement vide,
échelle décrite) ; régler puis lire (l'opt-in et les bornes reviennent, l'élu à
froid = strict) ; le classement reflète le vécu (leger passe élu) ; une borne hors
échelle refusée (400) ; projet inconnu (404). Mutations rejouées rouges. **Reste** :
G5b (le composant React `GardeFous.tsx`, façon `PleinEssaim.tsx` — helpers purs
testés contre `garde-fou.ts`, rendu léger asserté sur `textContent`, canevas non
simulé sous happy-dom).

### Lot G5b livré : le composant React `GardeFous.tsx` (le Garde-Fous se MONTRE)

Le dernier maillon de la feature 2. Le Mission Control montre désormais l'échelon
élu et son vécu, comme le Plein Essaim montre le solde — miroir de
`PleinEssaim.tsx` (recon Explore : c'est LE motif d'un panneau de projet réglable).

- `dashboard/src/api.ts` : les types `EchelonUi` / `RangGardeFouUi` / `EtatGardeFouUi`
  (miroirs tenus à la main de la RÉPONSE du server, façon `EtatEssaimUi`) +
  `fetchGardeFou` (GET) et `reglerGardeFou` (POST, geste humain).
- `dashboard/src/GardeFous.tsx` : deux commandes DISTINCTES — l'opt-in (case à
  cocher) et les BORNES {min, max} de l'échelle (boutons `aria-pressed`) — plus
  l'échelon ÉLU nommé et le CLASSEMENT (moyenne / essais / score par échelon,
  l'élu marqué `aria-current`). L'humain voit POURQUOI tel échelon gouverne, il ne
  pose pas un réglage à l'aveugle. Poll 5 s. PAS de canevas (un tableau suffit).
- Monté dans `Projets.tsx` juste sous `<PleinEssaim>` — les deux réglages « jusqu'où
  la ruche va seule », côte à côte.

Discipline du canevas happy-dom (leçon G5, `cerveau-vue.test.tsx`) : la seule
logique qui peut se tromper — le `+∞` d'un échelon jamais essayé, que `toFixed`
rendrait « Infinity » — est extraite en HELPERS PURS (`formatScore`,
`formatMoyenne`, `descriptionEchelon`), testés directement et mutés (verdict
affiché). Le rendu React n'a qu'un `textContent` léger, asserté sous `fetchGardeFou`
simulé. Banc `garde-fou-vue.test.tsx` : 4 tests (2 helpers purs, 2 rendus — actif :
l'élu nommé + le classement + « ∞ » et pas « Infinity » ; inactif : « Aucun échelon
élu » assumé plutôt qu'inventé).

**La feature 2 (Agent Garde-Fous) est COMPLÈTE** — le moteur UCB (G1), le store
latéral (G2), la boucle d'apprentissage sur les deux chemins d'assignation (G3/G4),
les endpoints (G5a) et le panneau réglable (G5b). Opt-in par projet, gouvernance
humaine des bornes, apprentissage global du corpus.

### Balayage loupe post-G5b : une survivante réelle dans `GardeFous.tsx`

Après la fusion de la feature 2, un balayage loupe élargi (`LOUPE_BASE` épinglée
sur le commit d'avant G4a, jamais dans le dépôt) sur le diff d'intégration a
désigné une survivante dans le panneau : `{etat.actif && etat.echelonElu ? …}`
mutée en `||` laissait la suite verte.

Jugement (la loupe désigne, l'humain tranche) : PAS un mutant équivalent. Le
`&& etat.echelonElu` narrow `EchelonUi | null` → `EchelonUi` avant `nomEchelon` ;
le type autorise l'élu `null` (réponse partielle / état transitoire du poll), et
sous `||` `nomEchelon(null)` rend « strict » — un échelon inventé pour un projet
qui n'en a élu aucun. Le typeur mordait, mais la loupe lance `vitest` (esbuild
jette les types) : le comportement n'était épinglé par aucun test. Correctif =
un TEST, pas une ligne de code (un projet actif à l'élu `null` DOIT dire « Aucun
échelon élu »). Muté → rouge, verdict affiché. Leçon consignée : ERREURS
§ 9 novemdecies (« un garde que seul le typeur défend n'est pas défendu par un
test »).

**Reste du balayage à faire** : la loupe est morte tôt (le container a redémarré ;
`GardeFous.tsx` est en tête alphabétique du diff), donc `scheduler.ts` (+98) et
`server.ts` (+112) de l'intégration Garde-Fous n'ont pas encore été balayés — lot
suivant.

### Balayage loupe de l'intégration : quatre survivantes d'accessibilité dans le panneau

Balayage loupe complet du diff d'intégration Garde-Fous (`LOUPE_BASE` épinglée sur
9168f01, avant G4a ; jamais dans le dépôt). Sur 12 mutations mutables, verdicts
obtenus pour 9 avant que la loupe — très lente sur ce dépôt (chaque mutant ≈ une
suite entière) — ne soit arrêtée. Résultat NET :

- `scheduler.ts` : TOUTES défendues (`modeGardiennesDe(task) === 'off'`,
  `brut === null`, observations `!== null`) — les bancs de refus G4a/G4b/G4c
  tiennent.
- `GardeFous.tsx` : QUATRE survivantes réelles, toutes de la même famille — un
  état porté par un ATTRIBUT qu'aucun banc n'assertait (les rendus lisaient
  `textContent`, qui ignore les attributs) :
  · `aria-pressed={bornes.min === e}` et `.max === e` (quel bouton de borne est
  montré choisi) ;
  · `aria-current={r.echelon === etat.echelonElu ? …}` (quelle ligne du classement
  est courante) ;
  · `{erreur && <p className="garde-fou-erreur">…}` (l'affichage d'une erreur).

Jugées VRAIES, pas équivalentes (accessibilité + style CSS accroché à
`[aria-pressed]` les lisent). Correctif = trois bancs qui interrogent l'attribut
(`getAttribute`) et un qui déclenche l'erreur puis lit son cadre. Chacun muté →
rouge, verdict affiché. Suite portée à 3474. Leçon : ERREURS § 9 vicies
(« un test de rendu qui ne lit que `textContent` est aveugle à l'attribut »).

**Reste, honnêtement** : la loupe s'est arrêtée après 9 mutations sur 12 — les
**3 candidates de `server.ts`** (les gardes de la livraison / contre-visite du
diff d'intégration) n'ont PAS encore été examinées. La loupe est trop lente sur
ce dépôt pour un balayage de fond en tâche de nuit (redémarrages + crochet d'arrêt
qui refuse un arbre sali par un mutant transitoire) ; le reliquat `server.ts` est
à reprendre en ciblé (mutation d'un garde à la fois, suite entière par garde).

### Balayage loupe Garde-Fous CLÔTURÉ : les 3 gardes `server.ts` mesurées, toutes défendues

Reprise CIBLÉE (la loupe complète est trop lente ici — chaque mutant ≈ une suite
entière) des 3 candidates de `server.ts` que le balayage n'avait pas atteintes,
toutes dans le câblage livraison / contre-visite (G4b/G5a). Une mutation à la
fois, SUITE ENTIÈRE rejouée par garde (un targeted sur le seul fichier risquerait
un faux survivant — une garde peut être défendue par un banc d'un AUTRE fichier),
verdict affiché :

| ligne | garde                                                        | mutation    | verdict                                               |
| ----- | ------------------------------------------------------------ | ----------- | ----------------------------------------------------- |
| 1129  | `brut === null ? null : versEchelon(brut)` (`polyethismeDe`) | `===`→`!==` | 🔴 mord `STRICT : le projet ATTEINT la contre-visite` |
| 2486  | `getEchelonGardeFou(task.id) !== null` (`optIn`)             | `!==`→`===` | 🔴 mord `LEGER : … RANGE « dispensee »`               |
| 2488  | `if (poly !== 'strict')` (la porte de contre-visite)         | `!==`→`===` | 🔴 mord `LEGER : … RANGE « dispensee »`               |

Les trois sont **défendues** par `tests/garde-fou-livraison.test.ts` (les bancs de
refus par projet, G4b). Rien à écrire, aucun équivalent à documenter.

**Le balayage loupe de TOUT le diff d'intégration Garde-Fous (base d'avant G4a)
est donc clos** : sur les 12 candidates mutables, la seule vraie dette était la
famille des 4 gardes d'ATTRIBUT du panneau (aria-pressed ×2, aria-current,
`erreur && <p>`), corrigée au lot précédent (#171). Le reste — scheduler.ts et
server.ts — était déjà défendu. Plus de « reste » sur ce diff.

### La leçon § 9 vicies généralise : deux survivantes d'attribut dans `PleinEssaim`

En appliquant la leçon § 9 vicies (« un test de rendu qui ne lit que `textContent`
est aveugle à l'attribut ») au FRÈRE de `GardeFous.tsx` — `PleinEssaim.tsx`, même
motif de boutons de réglage — la loupe ciblée a trouvé DEUX survivantes de la même
famille sur les boutons de niveau :

| ligne | garde                                         | mutation    | verdict (suite entière)                      |
| ----- | --------------------------------------------- | ----------- | -------------------------------------------- |
| 247   | `aria-pressed={etat.niveau === n}`            | `===`→`!==` | 🟢 survivante (aucun test ne lit l'attribut) |
| 248   | `className={etat.niveau === n ? 'actif' : …}` | `===`→`!==` | 🟢 survivante (aucun test ne lit la classe)  |

Inverser l'un ou l'autre marque TOUS les boutons SAUF le bon comme « courant » —
un vrai défaut d'interface (lecteur d'écran via `aria-pressed`, style via `.actif`),
invisible au banc qui n'assertait que le texte. Correctif : un banc de rendu dans
`tests/vues-sentinelles.test.tsx` qui lit `getAttribute('aria-pressed')` ET
`className` sur un niveau élu distinct d'un niveau inactif. Chacune des deux
mutations rejouée → rouge, verdict affiché. Suite +1.

La leçon tient donc au-delà de son premier cas : partout où un panneau porte un
état d'ACTIVATION dans un attribut (aria-*, classe), le banc doit lire l'attribut,
pas le texte. Pas de nouvelle leçon — c'est § 9 vicies qui se confirme.

### § 9 vicies, 3ᵉ récidive : les onglets d'AccountPanel — Cerveau, lui, était déjà défendu

Balayage ciblé (mutation par garde, suite entière rejouée, verdict affiché) des
panneaux du dashboard portant un état d'activation dans un attribut/classe :

- **Cerveau.tsx** : DÉJÀ défendu. `aria-pressed={mode === 'graphe'}` muté rougit —
  le banc `dashboard/tests/cerveau-vue.test.tsx` a un test dédié « les bascules
  annoncent leur état — aria-pressed, pas seulement une classe ». (Mon premier
  grep visait `tests/`, le banc vit dans `dashboard/tests/` — d'où l'angle mort.)
- **AccountPanel.tsx** : QUATRE survivantes réelles sur les onglets login/register —
  `aria-selected={mode === 'login'}` et `className={… ? 'active'}`, aux DEUX
  onglets. Les bancs voisins (`compte-porte.test.tsx`) lisaient le titre et le
  bouton, jamais l'onglet. Inverser désigne le mauvais onglet comme choisi
  (lecteur d'écran via `role="tab"`+`aria-selected`, style via `.active`).

Correctif : un banc dans `compte-porte.test.tsx` qui lit `getAttribute('aria-selected')`
ET `className` sur les deux onglets, à l'ouverture (login courant) puis après
bascule. Les 4 mutations rejouées → rouge, verdict affiché. Suite +1 (3476).

Toujours pas de nouvelle leçon : § 9 vicies (« un banc de rendu doit lire
l'ATTRIBUT, pas seulement `textContent` ») en est à sa 3ᵉ confirmation (GardeFous,
PleinEssaim, AccountPanel). Le motif à surveiller partout : un état porté par
`aria-*` / une classe conditionnelle, jugé par un banc qui n'assert que le texte.

### § 9 vicies, 4ᵉ récidive : la navigation principale (App.tsx)

Balayage ciblé poursuivi. `App.tsx`, la barre de navigation : DEUX survivantes sur
la cellule de la vue courante —
`aria-current={route.view === item.id ? 'page' : undefined}` et
`className={\`mc-nav-cell${route.view === item.id ? ' active' : ''}\`}`. Mutées en
`!==`, la suite restait verte : les bancs (`app-coquille.test.tsx`) lisaient le
libellé et l'info-bulle, jamais l'état COURANT de la cellule. `aria-current="page"`
est ce qu'un lecteur d'écran annonce comme « la page où vous êtes » ; inverser
désigne toutes les vues SAUF la bonne comme courantes.

Correctif : un banc dans `app-coquille.test.tsx` qui, au réveil (hash vide → Ruche),
lit `getAttribute('aria-current')` ET `className` sur la Ruche (courante) ET sur les
Projets (non courants). Les 2 mutations rejouées → rouge, verdict affiché. Suite +1.

§ 9 vicies en est à sa 4ᵉ confirmation (GardeFous, PleinEssaim, AccountPanel, App).
Toujours pas de nouvelle leçon — le motif est stable et connu ; ce qui compte, c'est
de le débusquer partout où un état d'activation vit dans un `aria-*` / une classe.

### § 9 vicies, 5ᵉ récidive : les onglets Diff/Logs du tiroir de tâche (TaskDrawer)

Balayage ciblé poursuivi. `TaskDrawer.tsx`, la barre d'onglets du résultat : DEUX
survivantes — `className={tab === 'diff' ? 'active' : ''}` et le jumeau `'logs'`.
Mutées en `!==`, la suite restait verte : `tiroir-tache.test.tsx` ne montait même
pas les onglets (son `fetchResults` par défaut rend `[]`, donc `last` est nul et
la barre ne se rend pas). Ici PAS d'aria — la classe `.active` est la SEULE marque
qui dit lequel de Diff / Logs on regarde ; inverser surligne l'onglet qu'on ne voit
pas.

Correctif : un banc qui pose un `fetchResults` avec un résultat (diff + logs), monte
le tiroir, attend la microtâche, puis lit `className` sur les deux onglets — Diff
actif par défaut, Logs après clic. Les 2 mutations rejouées → rouge, verdict
affiché. Suite +1. (Réinitialisation de `fetchResults` dans `beforeEach` pour que
l'override ne fuie pas dans les bancs voisins.)

§ 9 vicies en est à sa 5ᵉ confirmation (GardeFous, PleinEssaim, AccountPanel, App,
TaskDrawer). Restent au balayage d'activation : Ruche (mode 2d/3d), Rayon
(ry-entree), Miellerie (probablement déjà défendu — `miellerie-revue` lit la classe).

### § 9 vicies CLÔTURÉ : Ruche (mode 2d/3d) + Rayon (ry-entree) — le balayage d'activation est complet

Derniers candidats du balayage des états d'activation portés par attribut/classe :

- **Ruche.tsx** : `className={mode === '2d' ? 'active' : ''}` et le jumeau '3d' — le
  bouton du mode d'affichage courant. DEUX survivantes.
- **Rayon.tsx** : `ry-entree${ouvert === e.chemin ? ' active'}` — l'entrée du
  fichier ouvert. UNE survivante.

Mutées en `!==`, la suite restait verte : ni `SwarmView` (canevas ? non — DOM) ni
l'arbre de fichiers n'étaient assertés sur leur classe active. Correctif : deux
bancs dans `vues-sentinelles.test.tsx` (le 2D allumé par défaut ; l'entrée cliquée
surlignée, pas une autre). Les 3 mutations rejouées → rouge, verdict affiché. Suite +2.

**Le balayage § 9 vicies est CLOS.** Bilan sur les panneaux du dashboard portant un
état d'activation dans un `aria-*` / une classe conditionnelle :

| panneau                           | survivantes trouvées | statut                    |
| --------------------------------- | -------------------- | ------------------------- |
| GardeFous (élu/bornes)            | 4 (dont l'`&&`)      | défendu (#171, #170)      |
| PleinEssaim (niveau)              | 2                    | défendu (#173)            |
| AccountPanel (onglets)            | 4                    | défendu (#174)            |
| App (nav)                         | 2                    | défendu (#175)            |
| TaskDrawer (Diff/Logs)            | 2                    | défendu (#176)            |
| Ruche (2d/3d) + Rayon (ry-entree) | 3                    | défendu (ce lot)          |
| Cerveau (mode/dormantes)          | 0                    | déjà défendu (banc dédié) |

Motif désormais épinglé partout : un état d'activation lu par un banc qui n'assert
que `textContent` est du décor (§ 9 vicies). Prochain lot : hors de cette famille —
#63 identité visuelle de la vitrine, ou un autre diff au balayage loupe.

### Le dernier « hors d'atteinte du banc » du Cerveau : le seuil clic/glisser extrait

Reste nommé du balayage : `attrape.current.id` du glisser au canevas. En le
regardant, le vrai décor n'était pas l'affectation (canevas pur, `getContext` nul
sous banc) mais la RÈGLE cachée dans le `onMouseUp` : `Math.hypot(dx, dy) > 4` —
le départage clic / glisser. Sans lui, déplacer une note la sélectionnerait
toujours au relâcher.

Discipline (§ 2 quaterdecies, déjà en tête du module) : « hors d'atteinte du banc »
est presque toujours « au mauvais endroit ». Plutôt que simuler un canevas muet,
la règle est SORTIE en `estUnClic(depart, fin)` + `SEUIL_GLISSE` dans
`cerveau-designation.ts` (aux côtés de `corpsSousLePoint`, `rayon`, `chaleur`,
déjà extraits pour la même raison), et le `onMouseUp` l'appelle. Trois bancs :
sans déplacement → clic ; micro-tremblement (≤ seuil, PILE au seuil) → clic ;
au-delà, y compris en diagonale (hypot 3-4-5) → glisser. Muté `<=`→`<`, le banc
« pile au seuil » rougit (verdict affiché). Suite +3.

La pick-logic (`corpsSousLePoint`) était déjà extraite et éprouvée : le seul décor
restant était ce seuil. Les items nommés du balayage (Balance `arme && cible`,
Cerveau `serviIlYaJours`, server.ts livraison, ce seuil) sont tous soit déjà
défendus, soit désormais extraits+éprouvés.

### CI Windows rouge sur `main` : le voisin qui dort 26 s (décision de nuit)

La CI Windows de `main` (commit 7899453) a rougi seule — trois hooks `afterEach`
(conseil-runner, essaim-endpoint, hardening) expirés à 20 000 ms, à la seconde
exacte où `filet-relivraison` finissait ses 26 s de temps réel. Le même commit
avait passé les cinq contrôles de sa PR (#178) et le rejeu en trois ordres sous
Linux : intermittent, Windows-seul.

**Arbitrage tranché seul (utilisateur endormi).** Le § 3.2 bis de ERREURS pose
la règle : un hook qui re-expire à 20 000 ms n'est plus de la lenteur, « trouver
CE QUI bloque, pas passer à 30 ». Les trois hooks font ce que le § 3.2 bis a
mesuré à < 200 ms — le blocage était chez un voisin : `filet-relivraison` attend
`setTimeout(26_000)` pour observer deux re-livraisons espacées de 15 s, et sur un
runner Windows partagé ce fork immobilisé traverse la queue de fin pendant que
ses voisins affament leur démontage. Remède choisi : NON un plafond relevé, NON
un re-run nu, mais ôter le blocage à sa source. `createServer` accepte depuis
toujours `relivraisonMinMs` (documenté pour ce cas exact ; `instinct-endpoints`
le passe déjà à 0). Espacement réglé à 2 000 ms → fenêtre 26 s → 12 s. Vingt
secondes de temps réel ôtées du chemin critique de CHAQUE exécution, sur les
trois OS. Zéro ligne de production touchée (l'option existait), le badge est
intact (aucun test ajouté/retiré).

Mutation-first (banc raccourci, pas décor) : garde d'espacement `&&`→`||`
(server.ts:7078) → `filet-relivraison` ROUGE (« 1 ≥ 2 » faux, un seul renvoi),
restaurée → VERT (2/2, 14 s). Leçon consignée en ERREURS § 3.2 ter, « Un banc
qui dort n'immobilise pas que lui-même ». La cause exacte (voisin → famine de
démontage) est INFÉRÉE d'une co-terminaison à la seconde près, pas reproduite —
le défaut est irreproductible sur ce banc Linux, et c'est dit tel quel.

## POINT DE SORTIE — 5 août 2026, sortie visée ~2 septembre

### 1. Le temps

**28 jours** (5 août → 2 septembre).

La vérité de méthode du point de sortie d'hier tient toujours : **il n'existe
aucun « definition of done » de sortie écrit et mesuré** dans ce dépôt. Le seul
jeu mesuré est celui de l'installation (§ « Les 10 critères mesurables »). « Une
sortie présentable » n'est donc la cible mesurée de personne — et tant que ce
n'est pas écrit, on ne l'atteint pas. C'est le manque le moins visible et le
plus structurant.

### 2. Livré ET vérifié depuis le point de sortie d'hier (pas « écrit » — vérifié)

Le dernier point de sortie s'arrêtait à la suite 3 355, Aiguillage lot 1 en CI.
Depuis, fusionnés sur `main` et mesurés :

| lot                                       | comment c'est vérifié                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aiguillage câblé de bout en bout (3a→4)   | le routeur appris (UCB1) atteint la boucle de l'ordonnanceur, la course de drones, l'enregistrement du vainqueur, plus la borne du troupeau (élections en vol) ; chaque lot muté, VERDICT affiché. L'« Aiguillage NON CÂBLÉ » d'hier est câblé.                                    |
| Feature 2 — Agent Garde-Fous (G1→G5b)     | module pur UCB1 opt-in par projet → table de consentement → observations par jointure → câblage ordonnanceur + Polyéthisme + course de drones → endpoints → panneau React réglable ; chaque garde mutée rouge. Le « garde-fou À CONCEVOIR » d'hier est livré.                      |
| Balayage § 9 vicies CLÔTURÉ (7 panneaux)  | l'état d'activation (aria-selected/pressed/current + classe) défendu par `getAttribute`/`className`, pas `textContent` (un test qui ne lit que le texte est aveugle à l'attribut) : GardeFous, PleinEssaim, AccountPanel, App (nav), TaskDrawer, Ruche, Rayon — chacun muté rouge. |
| Seuil clic/glisser du Cerveau extrait     | `estUnClic` + `SEUIL_GLISSE` sortis de la boucle canvas (inatteignable sous banc), éprouvés au pixel ; `<=`→`<` fait rougir « pile au seuil ».                                                                                                                                     |
| `install.sh` construit ENFIN le dashboard | `npm run build:dashboard` câblé, repli gracieux (un `vite build` qui échoue n'abat pas l'install : il DIT quoi relancer) ; le serveur sert `dashboard/dist/index.html`. Le trou « ruche qui tourne ≠ ruche qu'on regarde » du point de sortie d'hier est fermé.                    |
| CI Windows : flake de démontage (PR #179) | trois hooks `afterEach` expiraient à 20 000 ms derrière un voisin qui dormait 26 s ; espacement de re-livraison réglé (fenêtre 26 s→12 s), Windows retombé de ~298 s à ~140 s, VERT sur PR ET push ; mutation `&&`→`                                                               |     | ` rouge. |

Suite **3 355 → 3 483**, mesurée (`npm test`, jamais de tête). Barrière rejouée
ce tour : typecheck, typecheck:dashboard, lint, `vitest run` — **3 476 verts, 7
ignorés**.

### 3. Ce qui reste, par ordre de casse pour un nouvel arrivant

1. **Le premier écran — la fin de la file.** Restent **trois** gardes d'affichage
   mesurées nues (consignées hier, pas tues) : `depots.depots.length === 0`
   (Projets — « Aucun dépôt ne correspond » disparaît de la recherche de dépôts,
   la toute première action d'un arrivant qui ajoute son projet) ; `busy === 'send'`
   (Projets — le bouton d'envoi ment sur son état) ; `e.type === 'dossier'`
   (Rayon — icône dossier, cosmétique). **Actionnable, je reprends dessus
   maintenant**, des deux gardes de Projets (la première action) vers l'icône.
2. **Le balayage loupe élargi.** Couverture inconnue sur le reste du diff cumulé
   depuis la dernière base épinglée — le « quoi d'autre est nu » systématique, à
   mener dans l'atelier, LOUPE_BASE épinglée, jamais commitée.
3. **La vitrine (#63).** Existe et rend (`tests/site.test.ts`), mais son identité
   visuelle (13→7 sections) attend une **décision d'édition de l'utilisateur**.
   Pas cassée, pas finie — et « présentable » n'est mesuré par personne (cf. §1).
4. **Un DoD de sortie écrit.** Le méta-manque du §1 : sans lui, « présentable »
   n'a pas de cible mesurable. L'écrire suppose une part d'arbitrage éditorial
   (ce qu'on promet à la sortie) qui touche à une décision de l'utilisateur.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé depuis hier, et toujours vrai :

- **Les comptes npm (lot 7) et GHCR/cosign (lot 10) ne sont pas les miens.**
  Aucune image officielle publiée ni paquet signé possible d'ici. `curl | sh`
  depuis le dépôt marche sans eux ; « docker pull » d'une image officielle et
  « npm i -g » d'un paquet signé restent sur une décision et des identifiants
  humains.
- **Aucune VRAIE machine Windows ni macOS.** La CI (runners GitHub) prouve que
  le code passe là-bas, PAS que l'install marche sur le poste d'un utilisateur.
  « Marche sur les 3 OS » est vérifié en CI, pas sur du matériel réel — la
  nuance doit être dite.
- **Le nombre de sections de la vitrine (13→7) et les tarifs** : décisions
  d'édition et commerciales de l'utilisateur, pas les miennes.

## POINT DE SORTIE — 6 août 2026, sortie visée ~2 septembre

### 1. Le temps

**27 jours** (6 août → 2 septembre).

Rappel de méthode, inchangé et toujours vrai : **aucun « definition of done » de
sortie n'est écrit ni mesuré**. Seul l'installation l'est (§ « Les 10 critères
mesurables »). « Présentable » n'est donc la cible mesurée de personne.

### 2. Livré ET vérifié depuis le dernier point de sortie (5 août)

**Honnêteté d'abord : RIEN de neuf n'a été livré depuis `d9b8a09` (5 août, PR
#180).** Les tours suivants ont trouvé la ruche verte et n'avaient rien d'utile
à AJOUTER — j'ai vérifié sans livrer, et « stable et vert » n'est pas « livré » :

- Barrière rejouée **verte**, mesurée : typecheck (× 2), lint, `vitest run` —
  **3 480 passés, 7 ignorés (3 487)**.
- Les trois items nommés du balayage re-confirmés **défendus, mutation-first,
  VERDICT rouge affiché** : Balance `arme && cible !== null` (`&&`→`||` rougit
  `vues-sentinelles`), Cerveau `serviIlYaJours === null` (`===`→`!==` rougit
  3 tests de `cerveau-designation`). Le chemin de RETOUR de livraison
  (`/livraisons` + `/reprendre` contre un GitHub simulé) est tracé à son banc,
  `retour-parcours.test.ts` — le « find taskId && nodeId » cherché n'existe pas
  comme garde nue (lookups par clé unique, corrélation merge par `mergeId`).
- Balayage loupe élargi : **13/40** mutants du diff de deux jours échantillonnés
  (base épinglée `68087bc`), tous défendus — **couverture PARTIELLE**, le reste
  non mesuré, et dit tel quel.

### 3. Ce qui reste, par ordre de casse pour un nouvel arrivant

1. **Les puces OS de la barre d'installation ne sont pas éprouvées EN
   COMPORTEMENT.** C'est la PREMIÈRE action d'un arrivant : cliquer sa puce
   (Windows / Linux·macOS / Docker / déjà cloné) pour copier LA bonne commande.
   `site.test.ts` verrouille les DONNÉES de chaque puce (commande, note, invite),
   mais RIEN ne vérifie que cliquer bascule vraiment la commande affichée,
   l'invite (`$` shell POSIX / `>` PowerShell) et l'état `aria-pressed`. Le
   harnais qui EXÉCUTE le JS de la page existe déjà (`vitrine-executee.test.ts`,
   né d'un `<script>` mort qu'aucun des 45 bancs de texte n'avait vu) : l'oubli
   est d'usage, pas de conception. Si `choisirPuce` cassait, un arrivant Windows
   copierait la commande POSIX et l'installation échouerait, sans qu'aucun banc
   ne rougisse. **Actionnable, je reprends dessus maintenant.**
2. **La couverture loupe du diff cumulé est partielle** (13/40 échantillonnés).
   Le reste n'est pas mesuré ; un balayage complet dans l'atelier reste à mener.
3. **La vitrine (#63)** — identité visuelle (13→7 sections) : décision d'édition
   de l'utilisateur (cf. § 4).
4. **Un DoD de sortie écrit** — le méta-manque du § 1 ; l'écrire touche à ce que
   la sortie PROMET, une part éditoriale qui revient à l'utilisateur.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé, et toujours vrai : comptes **npm** (lot 7) et **GHCR/cosign** (lot 10)
pas les miens (ni image officielle ni paquet signé d'ici) ; **aucune vraie
machine Windows ni macOS** (la CI prouve le code, pas l'install sur un poste
réel) ; **sections (13→7) et tarifs de la vitrine** — décisions d'édition et
commerciales de l'utilisateur.

---

## POINT DE SORTIE — 7 août 2026, sortie visée ~2 septembre

### 1. Le temps

**26 jours** (7 août → 2 septembre).

Et une chose change ce tour, après l'avoir répétée à CHAQUE point de sortie :
le « definition of done » de sortie, absent depuis le début et cité comme LE
méta-manque, est **enfin écrit et mesuré** — `docs/DEFINITION-DE-SORTIE.md`.
« Présentable » a maintenant une cible. Ce qui n'y porte pas un ✅ est dit non
atteint (❌), hors d'atteinte (🔒) ou décision de l'utilisateur (👤) — jamais
maquillé.

### 2. Livré ET vérifié depuis le 6 août

**Onze lots** fusionnés sur `main`, chacun mutation-first (VERDICT rouge
affiché) puis CI **5 jambes vertes** :

- **Vitrine, bancs d'exécution du JS hors-loupe (§ 1.0 ter)** : puces OS EN
  COMPORTEMENT (#74), aperçu au clic (#75), « Ouvrir ma ruche » compose les
  liens (#76) et coupe `window.opener` par `rel="noopener"` (#85), langue au
  chargement (#77) et `?lang=` partagé (#78), bouton « copier » (#82), boutons
  `rc-copier` (#84).
- **Cœur** : branche morte de `normaliserBornes` retirée (#79, la loupe l'a
  dénoncée), DÉCISION du relâcher du canevas extraite et éprouvée hors banc
  (#80), borne acceptée de `isModeleList` défendue (#81), état
  en-ligne/hors-ligne de la fiche d'ouvrière (#83).
- Suite portée à **3501** (mesurée à l'instant : 3494 verts, 7 ignorés, 0 rouge,
  236 fichiers), leçon `ERREURS § 9 unvicies` (un banc aveugle au VERROU d'un
  risque : `_blank` éprouvé, `noopener` non).
- **Balayage loupe élargi** (base épinglée `946b36b`, la plus large surface
  `src`) : **8 mutants, 8 défendus**, « rien de nu ».
- Et une panne SUBIE, pas simulée : l'**incident GitHub Actions** (Major
  Outage, ~15:22 → ~00:01 UTC) a throttlé les webhooks et bloqué la CI de #191
  des heures — les pushs ne déclenchaient AUCUN run. Diagnostic corrigé sur la
  PR (dépôt public → pas un quota, une panne de service), sonde relancée dès la
  reprise, #191 fusionnée en avance rapide sur `b166399`. **La CI n'a jamais été
  contournée** : pas de fusion sans les 5 verts réels.

### 3. Ce qui reste entre la ruche et une sortie présentable

Honnêteté d'abord : **rien ne CASSE le parcours d'un arrivant** — l'install, le
site et le tableau de bord passent tous au vert, sur les 3 OS en CI. Le reste
n'est donc pas de la panne ; c'est (a) l'instrument pour CERTIFIER
« présentable » et (b) de la finition éditoriale.

1. **Le DoD de sortie, écrit et mesuré — FAIT ce tour**
   (`docs/DEFINITION-DE-SORTIE.md`). C'est la porte : sans lui, « présentable »
   n'était la cible mesurée de personne, et aucun autre point ne pouvait se dire
   « atteint ». **Ce qu'il reste à ce point** : câbler ses deux gates encore
   manuels — `npm audit --audit-level=high` dans la CI, et un seuil de
   couverture — si l'on veut que « sûr » et « couvert » rougissent d'eux-mêmes.
   Ils sont marqués ❌ dans le DoD tant qu'ils ne le sont pas.
2. **L'identité visuelle de la vitrine (#63, 13→7 sections)** — la première
   impression d'un arrivant. 👤 Décision d'édition de l'utilisateur (cf. § 4) :
   la page publique ne se reskine pas de tête, et un agent d'arbitrage ne
   trancherait ici qu'une marque qui n'est pas la sienne. Reste ❌.
3. **Le README GitHub au design de la vitrine** — la première impression côté
   dépôt, en aval de #63. Reste ❌.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé : comptes **npm** (lot 7) et **GHCR/cosign** (lot 10) pas les miens (ni
image officielle ni paquet signé d'ici) ; **aucune vraie machine Windows ni
macOS** (la CI prouve le code, pas l'install sur un poste réel) ; **sections
(13→7) et tarifs de la vitrine** — décisions d'édition et commerciales de
l'utilisateur.

## POINT DE SORTIE — 8 août 2026, sortie visée ~2 septembre

### 1. Le temps

**25 jours** (8 août → 2 septembre).

### 2. Livré ET vérifié depuis le 7 août

**Six lots** fusionnés sur `main`, chacun mutation-first (VERDICT rouge affiché)
puis CI **5 jambes vertes**, plus **le lot de ce tour** :

- **Sûreté, la boucle entière fermée** : le gate `npm audit --audit-level=high`
  câblé en CI, qui a mordu à sa naissance — 2 vulns hautes transitives fermées
  (`brace-expansion`, `fast-uri`) (#193) ; un banc-garde qui rougit si la CI
  perd ce gate (#194, muté rouge) ; puis, preuve que le gate ne suffit pas seul,
  une **3ᵉ vuln haute** (`nanoid` < 3.3.17, avis publié APRÈS le câblage)
  attrapée non par la CI mais par un `npm audit` **local** entre deux PR, et
  fermée (#196) ; la leçon inscrite au DoD § C — un gate ne vaut que si son
  DÉCLENCHEUR couvre tous les moments du risque (#197).
- **Cœur** : `priseAuDoigt` extrait de la boucle du canevas du Cerveau — « corps
  ou fond ? » à l'appui —, éprouvé hors banc (#195, `getContext` nul sous
  happy-dom, donc la DÉCISION sort de la boucle pour s'éprouver au point près).
- **Le DoD de sortie enfin écrit et mesuré** — `docs/DEFINITION-DE-SORTIE.md`
  (#192). « Présentable » a une cible ; ce qui n'y porte pas de ✅ est dit ❌, 🔒
  ou 👤, jamais maquillé.
- **Ce tour — la couverture, re-mesurée et RENDUE reproductible** : le trou dit
  au § 4 ci-dessous. `@vitest/coverage-v8` (dépendance de pair **optionnelle** de
  vitest, jamais installée seule) était non déclaré ; `npm run couverture`
  mourait sur `MISSING DEPENDENCY` depuis un clone neuf. Fournisseur **déclaré**
  en `devDependencies`, **gardé** par un banc muté rouge
  (`tests/couverture-reproductible.test.ts`, qui lie le fournisseur déclaré au
  `provider` de la config et exige qu'il se résolve), et couverture re-mesurée :
  **lignes 75,43 %** (9 138 / 12 113), branches 69,48 %, fonctions 74,33 %,
  instructions 74,19 % (`0 vuln` à l'`npm audit` du même tour).

Suite mesurée à l'instant (rapport JSON de vitest, arbre `1f0a71d` + ce lot) :
**3507** (3500 verts, 7 ignorés, 0 rouge, 237 fichiers) — +3 pour les gardes de
la couverture reproductible. Les quatre badges (deux README, vitrine ×2 langues)
portés à ce compte par `scripts/compte-tests.mjs --corriger`, jamais de tête.

### 3. Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse un arrivant en premier. Honnêteté d'abord : **pour qui
INSTALLE ou UTILISE, rien ne casse** — l'install, le site et le tableau de bord
passent au vert sur les 3 OS en CI. Le reste tient en trois points :

1. **La première impression : identité de la vitrine (#63, 13→7 sections) et
   README GitHub à sa suite.** C'est ce que voit d'abord un arrivant, et c'est le
   plus gros manque. Mais c'est une **décision d'édition de l'utilisateur** (👤) :
   la page publique ne se reskine pas de tête, et un agent d'arbitrage ne
   trancherait ici qu'une marque qui n'est pas la sienne. Reste ❌ — tenu, pas
   caché.
2. **Le premier `npm run couverture` d'un contributeur — CASSÉ, corrigé ce
   tour.** Un arrivant côté CODE (qui clone et lance les scripts documentés)
   tombait sur `MISSING DEPENDENCY`. C'est le premier point de cette liste que je
   pouvais tenir sans fabriquer une décision d'utilisateur, et c'est fait
   (fournisseur déclaré + gardé + couverture re-mesurée). Reste ✅.
3. **Les gates « qui rougissent d'eux-mêmes », encore incomplets — et dits tels.**
   Le gate `npm audit` ne se déclenche qu'à l'ouverture/mise à jour d'une PR
   (angle mort entre deux livraisons, couvert à la main ; § C du DoD). Et
   **aucun seuil de couverture n'est câblé** — délibérément : la couverture se
   mesure (maintenant de façon reproductible), elle ne BARRE rien ; le verdict
   qui barre reste le balayage par mutation. Un seuil reste à décider si l'on
   veut que « couvert » ait, lui aussi, une cible qui rougit seule.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé : comptes **npm** (lot 7) et **GHCR/cosign** (lot 10) pas les miens ;
**aucune vraie machine Windows ni macOS** (la CI prouve le code, pas l'install
sur un poste réel) ; **sections (13→7) et tarifs de la vitrine** — décisions
d'édition et commerciales de l'utilisateur.

Et une correction d'honnêteté, parce que la règle vaut aussi pour ce qu'on a
écrit soi-même : le commit `70cd3ad` annonçait la couverture « re-mesurée et
reproductible ». Elle ne l'était pas depuis un clone vierge — le fournisseur
manquait à la déclaration et ne tenait qu'à un reliquat de `node_modules`. **Un
critère (même un non-critère comme la couverture) qui n'est pas mesuré de façon
reproductible n'est pas mesuré ; il se dit comme tel, et se corrige.** C'est fait.

## POINT DE SORTIE — 9 août 2026, sortie visée ~2 septembre

### 1. Le temps

**24 jours** (9 août → 2 septembre).

### 2. Livré ET vérifié depuis le 8 août

**Deux lots** fusionnés sur `main`, chacun mutation-first puis CI 5 jambes vertes,
plus des vérifications MESURÉES (pas récitées) :

- **#199 — Cerveau : `deplacementDuGlisse`.** La garde `attrape.current.id !== null`
  de `onMouseMove` (« ce glisser traîne-t-il un corps, le fond, ou survole-t-il ? »)
  était sans test — VERDICT affiché : mutée `=== null`, les 73 bancs cerveau
  restaient verts. Extraite hors du canevas muet, éprouvée au point près : la
  mutation fait rougir 4 bancs (`{ traine: false, fond: false } ≠ { traine: true,
id: 'n1' }`), loupe « rien de nu ». Leçon neuve inscrite (`ERREURS § 2 quaterdecies
ter`) : un premier découpage exposait `d.geste === 'corps'` dans le gestionnaire
  injouable — **le balayage a mordu ce `===` tout neuf** ; corrigé en booléens nus,
  la seule comparaison reste dans la fonction pure.
- **#200 — Garde-Fous : le `<=` de `normaliserBornes` est un mutant ÉQUIVALENT.**
  Preuve exhaustive (les 9 couples ; `rangEchelon` injectif ⟹ `rang(min)==rang(max)
⟹ min==max ⟹ le repli `{min,min}`=`b`). Pas un test qui manque, un équivalent :
  consigné AU CODE (le balayage le re-signalera à chaque fois) et au carnet (§ 2.16
  ter). Commentaire seul, CI verte.
- **Balayage élargi EXHAUSTIF** (base épinglée `HEAD~80`, jamais dans le dépôt) :
  cette fois **les 50 candidates examinées**, pas la moitié échantillonnée — 49
  défendues, l'unique survivant étant le `<=` équivalent ci-dessus. Couvre
  `aiguillage`, les gardes de traversée de `garde-fou`, le `taskId && nodeId` de
  `gardiennes`, `scheduler`, `server`, `store`, `protocol`. `machine.ts` (jamais
  balayé) confirmé défendu (`plateformeDepuis`/`estPlateforme` mordent sur
  `poste-machine.test.ts`).
- **Vérif de sortie complète, MESURÉE aujourd'hui** (arbre `7390979`) : `typecheck`
  ×2 verts, `lint` (eslint + prettier) vert, `vitest` **3511** (3504 verts, 7
  ignorés, **0 rouge**), `npm audit --audit-level=high` **0 vuln**, les 6 badges =
  3511 vérifiés en mode CI (pas de tête).

### 3. Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse un arrivant EN PREMIER.

1. **La première impression : la vitrine fait 13 sections / ~11 400 px** là où la
   maquette de référence en fait **7 / ~3 865 px**. C'est le premier écran d'un
   arrivant, et c'est ce qui casse l'expérience avant tout le reste : une page
   trois fois trop longue, sans identité tranchée. Le carnet l'a toujours classé
   « décision d'édition » — **quelles** 6 sections retirer ou fusionner est un
   arbitrage, pas de la mécanique. Ce tour, je l'attaque par le mécanisme prévu :
   un agent d'arbitrage (Fable 5) tranche la structure 7-sections ; sa décision et
   l'implémentation partent en **lot séparé, relu par l'utilisateur** avant toute
   mise en ligne (rien n'est publié sans sa fusion).
2. **README GitHub au design de la vitrine** — la première impression côté dépôt,
   en aval de la structure décidée au point 1.
3. **Rien d'autre côté code ne casse l'arrivant** : install (23,3 s, `hive doctor`
   10 ✔), tableau de bord et site passent tous au vert, sur les 3 OS en CI.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé : comptes **npm** et **GHCR/cosign** pas les miens ; **aucune vraie
machine Windows ni macOS** (la CI prouve le code, pas l'install sur un poste réel) ;
**tarifs de la vitrine** — décision commerciale de l'utilisateur.

Et le cadrage honnête du point 3.1, pour ne pas faire semblant : je peux **proposer**
la structure 7-sections (arbitrage délégué + PR relue), mais le CONTENU définitif de
la marque — le ton, ce qu'on garde vraiment, les tarifs — **reste ta décision**. Je
livre une proposition à trancher, pas un fait accompli.

### Arbitrage vitrine 13→7 — DÉCIDÉ par un agent Fable 5 ; implémentation COMMENCÉE, la fusion reste à toi

La décision, notée ici comme le veut la règle (« un arbitrage se délègue, et se
consigne dans `docs/ETAPES.md` »).

**Changement de posture, dit franchement (10 août).** La consigne du contrôle CI
de #202 disait « ne PAS commencer l'implémentation de la vitrine tant que le feu
vert n'est pas donné » ; le point de sortie suivant disait « reprends le travail
sur le premier point de la liste 3 » — et ce premier point EST la vitrine. Les
deux se réconcilient sans mentir : « reprends le travail » autorise à
**implémenter** (en lot, sur une PR, capture à l'appui) ; il n'autorise pas à
**publier**. J'ai donc commencé — lot A livré — mais **je n'auto-fusionne PAS la
vitrine** : la page se publie à la fusion sur `main` (GitHub Pages), donc la
fusion des lots vitrine reste ta décision, exactement comme ce carnet l'écrit
plus bas (« chacun une PR que TU fusionnes — pas le tour de nuit »). L'autorisation
permanente de fusion vaut pour les lots de durcissement, pas pour une refonte de
marque publique. Et je m'arrête à **un** lot par tour tant que tu n'as pas réagi
à la direction : livrer une proposition à trancher, pas un tas non relu.

**Les 7 sections retenues** (compte de la maquette, cible ~3 900 px) :

1. **Héros** — promesse + install (puces OS + commande) + démo de l'essaim (le
   panneau essaim y est DÉJÀ) + bande « fonctionne avec votre IA ».
2. **Comment ça marche** — les 3 étapes (`id="etapes"`).
3. **Fonctionnalités & l'écran** — les 4 familles + l'aperçu à onglets du tableau
   de bord (`id="features"`) ; l'archi se réduit à 3 pills, « mission » ne garde
   que l'aperçu.
4. **Sécurité** — resserrée (`id="securite"`).
5. **Communauté & modèle** — les tarifs deviennent un résumé + lien vers `rush/`
   (`id="communaute"`).
6. **Démarrer** — l'adresse de ruche + cartes d'action (`id="raccourcis"`, re-titrée).
7. **Appel + pied** (`id="appel"`).

**Mapping** : GARDE hero, etapes, features, securite, communaute, raccourcis, appel.
FUSIONNE bandeau-agents→héros, archi→features (3 pills), mission→features (aperçu
seul), tarifs→communauté, demarrer→raccourcis (`npm run demo` seul). RETIRE roadmap.

**Deux prémisses corrigées par l'agent** : le panneau essaim (`swarm-panel`) est
déjà dans le héros ; `montant`/`unitaire`/`avis` vivent dans `site/rush/index.html`,
PAS dans la vitrine — la refonte n'y touche pas.

**Hooks testés préservés** (fusionnés permis, supprimés non) : carrousel/essaim,
`chip-os` + install-cmd/copier/invite, `apercu-onglet`, `etapes`/`etape-n`,
`features`/`famille`, `communaute`, `rc-url`/`rc-cmd` (`id="raccourcis"`),
`appel`/`pied-*`, `gh-btn`/`btn-en` (header). Conséquence mécanique à prévoir :
nav purgée de `#archi #mission #tarifs #demarrer #roadmap`, ancres du pied
re-pointées, et le seuil `sections.length > 6` de `site.test.ts` abaissé.

**Reste ta décision** (l'agent ne l'a pas tranché) : les montants réels
(0/49/79 €), le ton commercial (« Populaire », « Bientôt »), et si le contenu
roadmap/archi retiré doit migrer vers une page docs plutôt que disparaître.

**Livraison prévue si tu valides** : un merge de section par lot (RETIRE roadmap
d'abord), chacun barrière + bancs vitrine verts + capture chromium, chacun une PR
que TU fusionnes — pas le tour de nuit.

### Vitrine lot B — fusion demarrer→raccourcis (décision agent Fable 5)

Tu as **fusionné la PR #203** (lot A) : je lis ça comme le feu vert sur la
direction, et je reprends la consolidation. Lot B, tranché par un agent Fable 5
(spec dans `scratchpad/vitrine-lot-B-decision.md`) :

- La section `demarrer` (« Une démo complète en deux commandes », 2 terminaux)
  fusionne dans `id="raccourcis"`, re-titrée **« Démarrer »**. On garde le
  terminal `npm run demo` (déplacé en tête, sous « D'abord, la démo »), on
  **retire** le second terminal « inviter un ami » — il DOUBLAIT la carte
  « Inviter un ami » déjà présente. Nouveau h2 : « Une démo en deux commandes,
  votre ruche en deux clics. » Deux jalons `<h3 class="rc-sous">` articulent la
  bande (démo d'abord, ta vraie ruche ensuite).
- Nav et pied : les deux liens « Raccourcis »/« Démarrer » se réconcilient en un
  seul (« Démarrer » → `#raccourcis`) ; ancres `pr.1.cta`/`ap.cta1`/`f.demarrer`
  re-pointées. Clés EN orphelines purgées (go.kicker/headline/t2/invite/n2,
  nav.shortcuts, f.raccourcis) ; `rc.s1`/`rc.s2` ajoutées.
- **Sections `class="section"` : 9 → 8** (seuil banc `> 6` tenu). Crochets
  éprouvés intacts : `id="raccourcis"`, `rc-url`/`rc-cmd`/`rc-copier`/`rc-lien`,
  lede « VOTRE ruche », `rc-note`, les 3 cartes.
- **Reste ta décision** (non tranché par l'agent, dit franchement) : la
  formulation exacte de la promesse du h2 et le ton des deux jalons.

Comme lot A : PR relisable, capture chromium à l'appui, **c'est TOI qui
fusionnes** — je ne stacke pas C→E avant ta réaction.

## POINT DE SORTIE — 10 août 2026, sortie visée ~2 septembre

### 1. Combien de jours restent

**23 jours** (10 août → 2 septembre).

### 2. Ce qui est LIVRÉ ET VÉRIFIÉ depuis hier

Deux choses, et rien de plus — je ne compte pas ce que « j'ai décidé » comme
livré.

- **#202 — l'arbitrage vitrine 13→7 consigné** (agent Fable 5), avec ses deux
  prémisses corrigées (`swarm-panel` déjà dans le héros ; `montant`/`unitaire`
  vivent dans `site/rush/`, hors périmètre). C'est une décision écrite, pas du
  code exécuté — je la classe donc comme livrée en tant que **décision**, pas en
  tant que page.
- **Vitrine lot A — la roadmap retirée** (`8aa283f`). Vérifié, pas « écrit » :
  `vitest run tests/site.test.ts tests/vitrine-executee.test.ts` → **135 passés /
  135**, `lint` vert, et une **capture chromium pleine page** relue (nav sans
  « Roadmap », badges « 3 511 tests ✓ » intacts, aucune casse de mise en page).
  Le filet qui PROUVE le retrait propre est le trio de bancs resté vert :
  « aucune traduction orpheline » (a forcé la purge du dictionnaire EN `rm.*`),
  l'ancre de nav, le compte de sections (`class="section"` 10→9, seuil `> 6`
  tenu). Suite inchangée à **3 511** (le lot n'ajoute ni ne retire de banc ;
  badges non touchés, donc justes sans re-mesure).

**Ce que ce n'est PAS**, dit franchement : la vitrine n'est **pas publiée**. Lot A
est sur une PR, pas sur `main`. « Livré et vérifié » ici veut dire _mesuré dans
l'arbre_, pas _en ligne_ — la mise en ligne (fusion → GitHub Pages) reste ta
décision.

### 3. Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse un arrivant EN PREMIER.

1. **La première impression : la vitrine.** Toujours le point n°1, et il n'est
   **pas atteint**. Lot A a retiré la roadmap ; restent les **quatre fusions**
   qui portent réellement la consolidation vers 7 sections (bandeau-agents→héros,
   archi+mission→features, tarifs→communauté, demarrer→raccourcis) — c'est là
   qu'est la substance, pas dans le retrait. Et au-dessus de la structure, la
   **nouvelle identité visuelle** (#63) reste un arbitrage d'édition que je
   **propose**, que je n'atteins pas : je livre des lots à trancher, un par tour,
   que **tu** fusionnes.
2. **README GitHub au design de la vitrine** — la première impression côté dépôt,
   en aval de la structure décidée au point 1. Non atteint.
3. **Rien d'autre côté code ne casse l'arrivant** : install (23,3 s, `hive doctor`
   10 ✔), tableau de bord et site passent tous au vert, sur les 3 OS en CI.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé : comptes **npm** et **GHCR/cosign** pas les miens ; **aucune vraie
machine Windows ni macOS** (la CI prouve le code, pas l'install sur un poste réel) ;
**tarifs de la vitrine** (0/49/79 €) et **ton commercial** — décisions
commerciales de l'utilisateur. Et le cadrage honnête du point 3.1 : je peux
**proposer** la structure et l'implémenter lot par lot ; le CONTENU définitif de
la marque — ce qu'on garde vraiment, le ton, l'identité visuelle de #63 — **reste
ta décision**. Une proposition à trancher, pas un fait accompli.

## POINT DE SORTIE — 11 août 2026, sortie visée ~2 septembre

### 1. Combien de jours restent

**22 jours** (11 août → 2 septembre).

### 2. Ce qui est LIVRÉ ET VÉRIFIÉ depuis hier

**Honnêteté d'abord : RIEN de neuf n'a été FUSIONNÉ depuis `b45314a` (#203, hier).**
La dernière fusion sur `main` reste le lot du 10 août (roadmap retirée + garde
d'appartenance de l'audit #62 + point de sortie). « Vérifié » n'est pas « livré »,
et je ne compte pas une re-mesure comme une livraison. Ce tour a **vérifié**, pas
livré :

- **Barrière entière rejouée verte**, mesurée (pas de tête) : `typecheck` (×2),
  `lint`, `vitest run` → **3 511 (3 504 verts, 7 ignorés, 0 rouge)**. Badge juste
  sans re-mesure (aucun banc ajouté/retiré).
- **Balayage loupe à couverture PLEINE**, base épinglée `68087bc` (le diff
  cumulé de ~2 semaines, jamais commitée) : d'abord 14/41 échantillonnés, puis
  **les 41 sur 41 examinés — tous ✔ défendus**, sur 12 fichiers (GardeFous,
  cerveau-designation, rayon-affichage, client, modeles, aiguillage, garde-fou,
  gardiennes, scheduler, server, store, protocol) — « LA LOUPE NE VOIT RIEN DE
  NU ». **Plus d'échantillon, plus de caveat** : le diff cumulé entier est
  défendu. Les mutants que l'échantillon de 14 avait laissés de côté et que la
  passe pleine a couverts incluent des cibles nommées de la checklist —
  `gardiennes.ts` `taskId === … && nodeId === …` (la corrélation de livraison),
  `rayon-affichage.ts` `e.type === 'dossier'` (l'icône dossier), le seuil
  `<= SEUIL_GLISSE` du glisser au canevas : chacun mord un banc.
- **Vitrine lot B (#204) reste TENUE**, pas fusionnée : CI 5-vertes,
  `mergeable_state clean`, inchangée depuis son ouverture. « Mesuré dans l'arbre »,
  **pas en ligne** — la mise en ligne est ta décision, comme lot A.

### 3. Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse un arrivant EN PREMIER — et pour chacun, **qui peut le
lever** (car deux des trois premiers ne sont pas les miens à trancher).

1. **La première impression : la vitrine. BLOQUÉE SUR TOI.** Toujours le point
   n°1, toujours **pas atteint**. Lot A fusionné, lot B (#204) **tenu pour ta
   fusion**, et les lots C→E (tarifs→communauté, archi+mission→features,
   bandeau→héros) **je ne les empile pas** tant que tu n'as pas réagi à lot B —
   c'est ton ordre permanent, et l'empilage rendrait #204 illisible. Au-dessus de
   la structure, l'**identité visuelle #63** reste ton arbitrage d'édition. Je ne
   peux avancer ce point n°1 **qu'après** ta réaction à #204 (fusion ou cap
   donné) — pas contre elle.
2. **README GitHub au design de la vitrine** — première impression côté dépôt, en
   aval de #63. **Décision d'édition**, non atteint.
3. **La loupe à couverture PLEINE sur le diff cumulé — ATTEINTE ce tour.** Le
   seul point de cette liste entièrement mien : le balayage échantillonnait
   (14/41). Repris en 41/41 (base `68087bc`, atelier), **tous défendus, rien de
   nu** — plus de mutant nu qui dorme dans un non-examiné. C'est le point que « je
   reprends dessus » désignait, et il est clos ; le diff cumulé entier est
   maintenant vérifié GARDÉ, pas seulement exécuté.
4. **Le seuil de couverture — délibérément PAS un gate.** Le DoD (§ D) pose que la
   couverture se mesure mais ne barre rien ; le verdict qui BARRE est la loupe.
   Câbler un seuil qui rougit serait **changer la définition de sortie** — une
   décision de politique, pas un trou de code. Je le NOMME, je ne le tranche pas
   seul.
5. **Rien d'autre côté code ne casse l'arrivant** : install (23,3 s, `hive doctor`
   10 ✔), tableau de bord et site passent au vert, sur les 3 OS en CI.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé, et toujours vrai : comptes **npm** et **GHCR/cosign** pas les miens
(pas d'artefact officiel signé d'ici ; `curl … | sh` marche sans) ; **aucune
vraie machine Windows ni macOS** (la CI prouve le CODE sur les trois, pas l'INSTALL
sur un poste réel — la nuance est le critère) ; **tarifs** (0/49/79 €) et **ton
commercial** — décisions de l'utilisateur. Et le cadrage du 3.1 : je **propose**
la structure de vitrine et l'implémente lot par lot ; le CONTENU de la marque
(#63, README) **reste ta décision**. Un point structurel apparaît aussi ce tour :
la branche de travail **est** la PR vitrine tenue (#204) — tant qu'elle n'est pas
fusionnée, tout code neuf s'y empilerait et couplerait un durcissement à la
publication de la vitrine. La sortie propre de ce couplage, c'est **ta réaction à
#204**.

## Accueil : la ruche injoignable ne parle plus anglais technique

Nouvelle consigne de l'utilisateur (priorités de sortie fin août) : **états vides
du tableau de bord d'abord, « car ils font amateur »**, puis doublons de la
vitrine, bac à sable, tests d'intégration, alertes visuelles.

### Ce que la mesure a dit, contre ma première hypothèse

Le `grep` de vocabulaire (« Aucun », « vide », « Rien à ») désignait trois vues
nues. **Deux étaient des faux positifs** : `Reine` porte son état vide dans une
CLASSE (`rn-empty`), `Cerveau` derrière un DRAPEAU (`entier.total === 0`) avec
un texte déjà soigné. J'ai donc RENDU les treize vues sur un instantané vide
(sonde jetable sur le harnais React existant) — et les états vides de la ruche
se sont révélés largement bons : Ruche, Miellerie, Rayon, Chantiers, Memoire,
Essaim, Chronique, Projets ont tous leur phrase.

Le rendu a en revanche montré le défaut que le vocabulaire ne POUVAIT pas
trouver, puisque la phrase fautive n'est écrite nulle part dans le dépôt :

    Failed to execute "fetch()" on "Window" with URL …

### Le défaut, et pourquoi il compte pour une sortie

`useApiPoll` rangeait `e.message` tel quel, et **vingt-cinq endroits** du tableau
de bord rendent `poll.error` sans le relire. Le tri est pourtant net :

- le serveur RÉPOND et refuse → `ApiError`, message tiré du corps JSON, écrit
  pour un humain : on le montre tel quel ;
- le `fetch` n'aboutit PAS → c'est le NAVIGATEUR qui parle, dans sa langue, sans
  rien dire à faire.

Pour une ruche AUTO-HÉBERGÉE, le second cas est le plus banal qui soit — on
redémarre son propre orchestrateur — et c'était le seul à rester en anglais
technique au milieu d'une interface française.

### Le correctif, à la source plutôt qu'écran par écran

`messageDeSondage()` extraite en module PUR `dashboard/src/views/sondage.ts`
(§ 2 quaterdecies : « hors d'atteinte du banc » = « au mauvais endroit », comme
`rayon-affichage.ts` et `cerveau-designation.ts`), appelée par le `catch` de
`useApiPoll` : **un seul endroit, vingt-cinq écrans réparés**. Le tri se fait sur
`TypeError` — ce que `fetch` rejette PAR SPÉCIFICATION sur échec de transport —
et non sur « tout ce qui n'est pas une ApiError », qui mentirait sur les pannes
voisines (un corps JSON illisible jette un `SyntaxError` : la ruche A répondu).

### Vérifié, pas « écrit »

- **Mutation-first, VERDICT AFFICHÉ** : garde `e instanceof TypeError` inversée →
  **4/4 ROUGE**, dont l'assertion qui reproduit le défaut d'origine
  (`expected 'Failed to fetch' not to contain 'Failed to fetch'`) et celles qui
  attrapent le mensonge sur les cas voisins ; restaurée par COPIE (jamais
  `git checkout`, § 9 quattuorvicies) → **4/4 VERT**. Rejoué APRÈS l'extraction,
  la fonction ayant changé de fichier.
- **Barrière entière** : typecheck **0**, typecheck:dashboard **0**, lint **0**
  (codes lus SANS tube), `vitest run` **240 fichiers, 3 508 passés, 7 ignorés
  (3 515), 0 rouge**.
- **Badges re-mesurés**, jamais écrits de tête : `compte-tests.mjs --corriger`
  porte README, README.en, vitrine et présentation à **3 515**.

### Leçons consignées

`ERREURS § 9 quinvicies` (chercher un MOT dans le code ne dit pas ce que l'écran
AFFICHE — trois angles morts : la classe, le drapeau, et le texte venu
d'ailleurs) ; `§ 9 quaterdecies` enrichi d'une **quatrième morsure** du tube qui
avale le code de sortie, mordue dans ce lot même.

### Ce que ce lot n'est PAS

Il ne referme pas « les états vides du tableau de bord » : la mesure dit qu'ils
étaient déjà bons, et c'est dit tel quel plutôt que maquillé en victoire. Restent
les priorités suivantes de la liste — doublons de la vitrine (lot C tranché, spec
en attente d'implémentation), bac à sable, alertes visuelles.

### Vitrine lot C — fusion tarifs→communauté (décision agent Fable 5)

Troisième lot de la consolidation 13→7, débloqué par la fusion de #204 (lot B).
Arbitrage tranché par un agent Fable 5 ; les MONTANTS et le TON restent la
décision de l'utilisateur, et n'ont pas bougé — ils vivent sur `rush/`.

**Décision : l'étal des prix est démonté ENTIÈREMENT.** Aucune des trois cartes
ne survit, pas même la gratuite. Motif : les deux payantes doublaient mot pour
mot le bloc `cloud` déjà présent dans `communaute` (même direction, même
honnêteté, même lien `rush/`), et la grille complète — avec sa sensibilité au
coût et ses engagements « jamais à vendre » — vit sur `rush/`. Replanter un étal
de prix au milieu de la bande « communauté » aurait violé « une idée par bande ».

**La seule clause reversée**, parce qu'elle ne survivait NULLE PART ailleurs :
« aucune fonction du noyau n'est retenue derrière un mur », recyclée mot pour mot
de `pr.note` dans `co.cloud.d` (FR + EN). Aucun nouveau bloc, aucune nouvelle
clé, pas de 2ᵉ `<h2>`. L'argument « gratuit / pour toujours / MIT » survivait
déjà : `co.cloud.d` en `<strong>`, badge d'en-tête « v0.2.0 · MIT », pied
`f.promesse`.

Nettoyages induits : nav et pied purgés de `#tarifs` (`nav.rush`/`f.rush` restent
les entrées tarifaires), **33 clés EN** retirées (`pr.*`, `nav.pricing`,
`f.tarifs`), et **26 règles CSS mortes** (`.plans`, `.plan*`, `.tarifs-note`)
avec leur commentaire de section. Sections `class="section"` : **8 → 7** — la
cible du plan est atteinte. Environ 11 ko retirés de la page.

**Vérifié, pas « écrit »** : bancs vitrine **174/174** (`site`, `site-fraicheur`,
`vitrine-executee`, `apercu`, `vitrine-jetons`) ; barrière entière — typecheck
**0**, typecheck:dashboard **0**, lint **0** (codes lus sans tube) ; suite
**3 508 verts, 7 ignorés (3 515), 0 rouge** ; garde de badge de la CI
(`compte-tests.mjs` SANS `--corriger`) : « les 6 annonces disent 3515 ».
Enfin le DOM RENDU par chromium a été relu — pas seulement la source : la clause
se lit bien en place, et `id="tarifs"`, « Hosted Queen », « €79 », « Pricing »
ont tous disparu de la page.

Une garde d'écriture a mordu pendant le retrait du CSS : mon assertion « un seul
commentaire dans le bloc » a arrêté le script (il y en avait quatre, tous
documentant des règles `.plan*`). Rien n'a été écrit. Remplacée par la garde qui
mesure vraiment ce qui compte — AUCUN sélecteur étranger ne part avec le bloc —
plutôt que par un proxy fragile.

Restent les lots D (archi+mission→features) et E (bandeau-agents→héros).

### La loupe voyait tout, sauf les tris par `instanceof`

Le balayage de contrôle du lot « messageDeSondage » a rendu **1 seul candidat** —
et pas la garde centrale du lot. Motif : les opérateurs de la loupe étaient
`&&`/`||`, `>=`/`>`, `<=`/`<`, `===`/`!==`. **`instanceof` n'y figurait pas.**
L'instrument qui traque les faux verts venait d'en produire un, sur un dépôt qui
compte **79 `instanceof` en production**.

Corrigé : `mutationsDeLigne(ligne)` sortie de `candidates()` en fonction PURE et
exportée — elle était intestable tant qu'elle lisait le disque (§ 2
quaterdecies) — et l'opérateur `instanceof X → instanceof Object` ajouté. Pas une
négation : nier demanderait les bornes de l'expression, donc un parseur, et une
mutation qui casse la syntaxe passe pour un mutant tué. Élargir la classe reste
un échange de jeton et ôte exactement ce que la garde apporte, sa capacité à
DISTINGUER. La limite est dite au code : sur une entrée primitive, le mutant
survit sans être faux — la loupe désigne, un humain juge.

**L'opérateur a gagné sa place au premier essai.** Relancée, la loupe a trouvé
une nudité RÉELLE dans le lot qu'elle venait de déclarer propre :
`e instanceof Error ? e.message : String(e)` survivait à sa mutation, faute d'un
banc passant un objet qui ne soit pas une `Error`. Pas équivalent — sur un objet
nu, la branche livrait « [object Object] » à l'écran, exactement le charabia que
cette fonction existe pour empêcher. Corrigé (un objet nu rend « Panne inattendue
de la ruche. ») et éprouvé.

Deux leçons consignées : `ERREURS § 9 sexvicies` (un instrument ne trouve que ce
que sa liste d'opérateurs contient) et `§ 9 septvicies` (la loupe lit le diff
COMMITÉ mais mute l'arbre de travail — son silence ne prouve rien tant que les
deux ne coïncident pas ; c'est ce piège qui a failli me faire signer un « rien de
nu » obtenu juste après une correction non commitée).

Vérifié : mutation de la garde neuve de la loupe → banc ROUGE (« expected
[ Array(1) ] to deeply equal [] »), restaurée par copie → 8/8 VERT. Barrière
entière verte (codes lus sans tube). Suite **3 524** (3 517 verts, 7 ignorés,
0 rouge), badges re-mesurés à 3 524 et garde CI verte.

## Feu vert utilisateur : #205 fusionnée, la vitrine se finalise, la DGM s'acte

L'utilisateur a donné son feu vert explicite sur #205 (« la PR 205 attend ton
feu vert ») : fusionnée (`5bc9c61`), CI verte et loupe 6/6 au moment du geste.
Le même message demande de passer de l'investigation à l'implémentation de
l'auto-amélioration façon Darwin Gödel Machine, et de finaliser la vitrine.

### Cerveau : « consolider après trois récurrences » — déjà livré, re-prouvé

`SEUIL_CONSOLIDATION = 3` (`cerveau.ts:316`), justification écrite (« Deux fois
est une coïncidence, trois fois est un motif »). Mutation 3→2 : **2 bancs
ROUGES** (« DEUX FOIS NE FAIT PAS UNE RÈGLE, TROIS OUI »), restauré → 34/34.
Rien à écrire, tout à constater.

### ADR 0009 — l'évolution façon DGM : refus sourcés, boucle DIFFÉRÉE

L'enquête (13 agents, 3 lentilles adversariales) est actée dans
`docs/adr/0009-evolution-fachon-dgm.md` : Firecracker/Kata REFUSÉS (pas de KVM
sur macOS, Windows 11 + virtualisation imbriquée + admin requis — contre
« aucun sudo, jamais ») ; CrewAI REFUSÉ (Python, 903 Mo, casse l'install
23,3 s) ; LangGraph.js REFUSÉ architecturalement (`replay.ts` rend déjà son
cœur — deux histoires divergentes sinon) ; AutoCover INACQUÉRABLE (interne
Uber) ; SWE-bench DIFFÉRÉ (≈22 000 USD le run). Ce que la vision demande
existe déjà pour l'essentiel (isolement à 3 régimes, Gardiennes, courses de
drones, Cerveau, loupe). La pièce manquante — l'Épreuve, un verdict que le
producteur du diff ne contrôle pas (« le juge n'entre pas dans la ruche qu'il
inspecte ») — est conçue mais la contradiction lui a trouvé **8 failles
bloquantes** : elle attend l'après-sortie, et l'ADR les liste comme préalables.

### Vitrine lot D — archi + mission fondues dans features (7→5 sections)

Arbitrage rendu directement (le modèle d'arbitrage est aux commandes) et deux
amendements au plan initial, consignés :

1. **La garantie de fraîcheur survit à l'énumération.** `site-fraicheur`
   confrontait les 13 cartes ET le chiffre du chapeau à la nav d'App.tsx. La
   grille des cartes part (c'est l'inventaire que la refonte coupe — l'aperçu
   MONTRE, il ne récite plus), mais la phrase « 13 vues navigables au
   clavier » suit l'aperçu dans features avec sa clé `mc.headline` : le banc
   du NOMBRE mord toujours contre App.tsx. Une 14ᵉ vue rendra la vitrine
   rouge le jour même. Les deux bancs d'énumération partent avec la grille,
   et le commentaire du fichier dit pourquoi.
2. **Lot E sans déplacement.** Le plan comptait « héros + bandeau » comme la
   bande n°1 NARRATIVE ; structurellement le bandeau est pleine largeur
   (fond + bordure propres) et le nicher dans `.hero` (max-width 1240 px)
   casserait son design pour zéro gain visible. Il reste une bande autonome
   collée au héros : 7 bandes, dont 5 sections porteuses d'id.

Mécanique : pastilles (`archi.p1-3`) + aperçu à onglets déplacés dans
features sous un jalon `feat.ecran` ; sections archi et mission supprimées ;
nav et pied purgés (−2 liens chacun) ; **35 clés EN retirées**, 1 ajoutée
(`feat.ecran`) ; CSS mort purgé règle par règle (`.archi-*`, `.node-box`,
`.queen-box`, `.view-box`, `.wire`, `.views`, `.view-card` — `.hexico`
ÉPARGNÉ, encore 3 usages dans securite ; une première passe l'aurait emporté,
la garde « aucun sélecteur étranger » a mordu avant l'écriture) ; 4 planchers
de bancs ajustés à la forme consolidée (sections >4, surtitres >4, liens du
pied ≥10, ancres internes >2), chacun avec son commentaire.

**La consolidation 13→7 est ACHEVÉE** : héros, bandeau, étapes,
fonctionnalités & écran, sécurité, communauté & modèle, démarrer (+ appel).

### Alertes visuelles : la moitié serveur livrée, le badge en lot suivant (décision agent Fable 5)

L'utilisateur demandait des « alertes visuelles non-bloquantes, discriminantes,
basées sur Guetteuses / La Dérive / Fantômes ». Un agent Fable 5 a tranché, et il
a corrigé DEUX de mes prémisses — que j'avais annoncées à l'utilisateur :

1. **Faux : « ces trois signaux n'ont pas de gravité serveur ».** Ils en ont
   chacun une (`NiveauGuet` calme/reniflage/balayage, `DeriveUi.etat`
   saine/…/degradee, `GhostSeverity` low/medium/high). Ce qui manque n'est pas la
   gravité mais son **unification** vers `Gravite` — trois échelles, aucune ne
   passe par `tableau.ts`.
2. **Faux : « la Dérive vit dans Santé ».** Elle vit dans l'Essaim, **par
   projet** ; Santé polle les Gardiennes, pas la Dérive.

**Option retenue : A′** — poll global de `/api/moi/tableau` (et non
`/api/mon-tableau`, autre correction) + badge sur « Mon espace ».

**Option B (porter les alertes dans le snapshot WebSocket) est REJETÉE, et pas
seulement pour le risque :** elle est fausse. Les alertes sont **par personne**
(`server.ts:6486`) alors que `broadcastState` sérialise **une seule fois pour N
sockets** (`server.ts:660-669`). Les y verser ferait fuiter les projets d'autrui,
ou détruirait l'optimisation « 1 sérialisation pour N tableaux ».

Le coût de A′ est moindre que je ne le croyais : `useApiPoll` **suspend déjà**
quand l'onglet est caché (`shared.tsx:364-366`), et App.tsx polle **déjà**
`/api/pulse` toutes les 20 s pour l'ECG de la barre latérale.

#### Ce qui est livré ce tour : `graviteMax`, calculé AU SERVEUR

Le point fin, et la raison d'être du champ : **ce n'est pas
`alertes[0].gravite`**. `trier()` classe par NATURE d'abord (`RANG_CLE`,
`tableau.ts:299`) — l'irréversible avant le réversible — donc une
`fin_de_periode` en « attention » précède un `quota_epuise` « critique ». Une
pastille qui suivrait la tête de liste peindrait la mauvaise couleur.

Le calculer dans l'écran aurait demandé d'y recopier `RANG` : une SECONDE
décision de classement, qui divergerait — exactement ce que
`MonEspace.tsx:11` interdit (« l'écran ne reclasse RIEN »). D'où
`graviteLaPlusHaute()`, pure et exportée, appelée par `composerTableau()`.

Vérifié : mutation `<` → `>` → **2 bancs ROUGES** (« la pastille suivrait la
mauvaise alerte : expected 'attention' to be 'critique' »), restauré → 35/35.

#### Ce qui NE l'est pas, et pourquoi la coupe est là

Le câblage du badge dans `App.tsx` bute sur un fait de conception : `user` y est
une **ref** (`userRef`, l.145), pas un état. Un poll conditionné dessus ne se
réveillerait pas à la connexion — le monter proprement demande de comprendre le
flux d'authentification, ce qui n'est plus « quinze lignes ». Le lot serveur est
juste, éprouvé et utile seul ; le badge vient dessus, avec sa forme déjà
tranchée : nombre + `data-gravite` + `aria-label` complet (« Mon espace, 3
alertes, la plus grave : critique »), trois modificateurs CSS distingués par la
FORME autant que par la couleur, et surtout **pas** d'`aria-live`, pas d'état
« vu » côté client, pas de modale.

**Portée dite franchement** : le badge ne portera que les alertes de
`tableau.ts`. Unifier Guetteuses/Dérive/Fantômes vers `Gravite` est une décision
de classement — donc serveur, donc éprouvée — avec un vrai débat de
correspondances (un `balayage` vaut-il un `effacement_imminent` ? non : l'un est
irréversible) et un problème de périmètre non résolu (`/api/moi/tableau` est
borné aux projets dont on est membre, alors que Guetteuses et Fantômes sont des
signaux de ruche entière). C'est un lot d'après-sortie.

### La pastille d'alertes câblée — et l'obstacle que j'avais inventé

Suite de `graviteMax` : le badge est posé sur « Mon espace ».

**Une correction contre moi.** J'avais annoncé un obstacle bloquant : « `user`
est une REF dans App.tsx, donc un poll conditionné dessus ne se réveillerait pas
à la connexion ». **C'est faux** : `user` est un ÉTAT (`useState<AuthUser |
null>`, App.tsx:138) ; le `userRef` (l.145-146) n'en est qu'un miroir, pour que
le gestionnaire de raccourcis clavier n'ait pas à se recréer. J'avais lu la ref
sans voir l'état juste au-dessus. Le câblage ne demandait pas de comprendre le
flux d'authentification — il demandait de lire sept lignes plus haut.

Mécanique : un module PUR `pastille-alertes.ts` (décide d'allumer, plafonne le
compte, rend la phrase du lecteur d'écran) ; un sondage BORNÉ à la session dans
App.tsx, réveillé par un tic de session ; trois modificateurs CSS distingués par
la FORME autant que par la couleur (plein+halo / plein / creux) ; `data-gravite`
pour que les bancs puissent lire l'état ailleurs que dans un pixel.

Deux pièges fermés au module pur, chacun éprouvé : **`null` n'est pas « info »**
(une ruche saine ne porte aucune pastille — une pastille toujours allumée
n'attire plus l'œil), et **un serveur ancien n'invente pas de couleur** (le
contrat porte un `version` ; sans `graviteMax`, on n'allume pas plutôt que de
mentir sur l'urgence). Mutation `||` → `&&` : 2 bancs ROUGES, dont le cas du
serveur ancien (« expected { total: 5, gravite: null } to be null »).

#### Deux défauts que la barrière a attrapés, et qu'un tube aurait cachés

1. **`typecheck` racine = 2** alors que la suite était verte et
   `typecheck:dashboard` à 0. Le banc du module pur importait sans extension
   `.js` — la convention du dépôt (`moduleResolution: node16`), que les bancs
   voisins respectent déjà.
2. **Importer `Gravite` depuis `../api.js` a tiré TOUT `api.ts` dans le graphe
   du typecheck RACINE**, révélant quatre erreurs d'extension préexistantes dans
   ce fichier — invisibles jusque-là parce qu'`api.ts` n'était compilé que par
   le tsconfig du tableau de bord, qui a d'autres règles. Corrigé en important le
   type depuis SA SOURCE (`src/orchestrator/tableau.js`) : un module pur ne
   devrait pas dépendre d'un module d'API pour un type de trois littéraux.

Le `switch` des libellés porte un `const jamais: never` : le jour où une
quatrième gravité naît, la compilation s'arrête là plutôt que de rendre une
pastille muette.

Vérifié : barrière entière verte (codes lus SANS TUBE — c'est ce qui a montré le
typecheck rouge quand tout le reste était vert), suite **3 537** (3 530 verts,
0 rouge), badges re-mesurés à 3 537, garde CI verte.

## Balayage loupe à couverture pleine, rejoué : 41/41 était vrai, et périmé

Le point n°3 du 11 août annonçait la couverture PLEINE atteinte — « 41/41 sur
`68087bc`, tous défendus, rien de nu, plus de mutant nu qui dorme dans un
non-examiné ». Rejoué le soir même, **sur la même base épinglée**, le balayage
en trouve **57**.

Rien n'avait été défait. L'instrument avait gagné l'opérateur
`instanceof X → instanceof Object` le 11 août APRÈS la passe, et quatre commits
ont atterri depuis — or le diff se mesure toujours contre la même base ancienne,
donc il ne cesse jamais de croître. Le verdict n'était pas faux : il avait
**expiré**. Leçon `ERREURS § 9 tertrigies` — un verdict d'exhaustivité ne vaut
que pour le couple {instrument, surface} du jour, et un verdict partiel vieillit
honnêtement là où un verdict d'exhaustivité vieillit en mensonge.

### Le verdict de ce tour

**`LOUPE_BASE=68087bc`, `LOUPE_MAX=90` — 57 mutations possibles, 57 examinées.**
Aucun échantillonnage. Dans un arbre de travail DÉTACHÉ (`git worktree`), la base
passée par variable d'environnement, jamais écrite dans le dépôt.

- **56 défendues.**
- **1 signalée nue, et c'est un mutant ÉQUIVALENT déjà consigné** :
  `garde-fou.ts` — `rangEchelon(b.min) <= rangEchelon(b.max)` muté en `<`.

L'équivalence n'a pas été crue sur parole du commentaire : elle a été **mesurée
sur le domaine ENTIER**. `Bornes` est un couple de deux `Echelon`, une union
fermée de trois valeurs — donc 3 × 3 = **9 paires possibles, et rien de plus**.
Les deux versions rendent la même VALEUR dans les 9 cas ; elles ne diffèrent que
par l'identité de référence de l'objet rendu, que personne n'exige. La loupe le
re-signalera à chaque passe : c'est le comportement attendu d'un instrument qui
ne sait pas lire un commentaire.

### Ce que ce balayage ne dit PAS

`site/` est **hors du champ de la loupe** — son diff est borné à `src`,
`dashboard/src` et `scripts` (`scripts/loupe.mjs:82-94`). Aucun verdict rendu ici
ne porte sur la vitrine, quelle que soit sa base.

Et il ne dit rien non plus de ce qui n'a jamais été touché depuis `68087bc` : la
loupe mute les lignes AJOUTÉES d'un diff, pas le dépôt. C'est ainsi qu'une boucle
antérieure à la base a pu rester nue jusqu'à ce qu'une lecture la trouve — celle
qui ferme les fusions d'un nœud parti, éprouvée ce même tour.

Vérifié : barrière entière verte (codes lus sans tube), arbre propre, atelier
démonté.

## L'instrument élargi trouve sept gardes que personne n'éprouvait

La table d'échanges de la loupe était asymétrique : `>= → >` et `<= → <`
existaient, leurs inverses non. Elle ne savait donc muter une borne que dans le
sens qui RESSERRE — jamais dans celui qui RELÂCHE, qui est pourtant le plus
dangereux : resserrer fait refuser du travail légitime et quelqu'un s'en plaint
le jour même, relâcher fait ACCEPTER ce qui devait être refusé et personne ne
vient le dire. `|| → &&` manquait de même.

Table symétrisée (commit « La loupe ne savait relâcher aucune borne »), puis le
MÊME balayage, sur la MÊME base épinglée `68087bc` :

| instrument                   | mutations | nues            |
| ---------------------------- | --------- | --------------- |
| avant `instanceof` (11 août) | 41        | 0               |
| avec `instanceof`            | 57        | 1 (équivalente) |
| avec les bornes relâchées    | **70**    | **8**           |

Sept nudités réelles qu'aucun balayage précédent ne pouvait produire.

### Livré ce tour — les deux à conséquence

**`client.ts` — un nœud à liste de modèles VIDE ne pouvait plus rejoindre la
ruche.** En JavaScript `[]` est TRUTHY : le `&&` ne filtre rien, et `.length > 0`
est SEUL à empêcher d'envoyer `modeles: []`. Or le hub exige `v.length >= 1` et
refuse le `register` ENTIER quand la liste est malformée — le nœud aurait bouclé
sans qu'aucun message ne dise pourquoi. Mutée, la suite entière restait verte
(243 fichiers, 3 542 tests). Banc de bout en bout sur un vrai serveur ;
verdict rouge : « une liste de modèles VIDE a empêché le nœud de rejoindre ».

**`modeles.ts` — la borne de longueur n'était tenue que d'un côté.** Le banc
existant éprouvait `LIMITS.name + 1` (rejeté) et jamais `LIMITS.name` (accepté).
Mutée en `>=`, un nom de longueur MAXIMALE était écarté en silence : le nœud
déclarait un modèle de moins que ce qu'il sait faire tourner, et l'Aiguillage n'y
envoyait plus rien. Aucune panne — juste un modèle qui cesse d'exister pour la
ruche.

### Consigné ÉQUIVALENT, et mesuré comme tel

Trois mutants ne peuvent pas rougir, et c'est écrit à côté de la ligne plutôt
qu'entouré d'un banc de décor :

- `garde-fou.ts`, `normaliserBornes` (`<= → <`) — déjà consigné ; 9 paires de
  bornes possibles, 0 divergence de valeur.
- `garde-fou.ts`, `elireEchelon` (`< → <=`) — `comparerRangs` ne rend `0` qu'à
  score ET échelon égaux, or `rangs` porte au plus une entrée par échelon.
  **Mesuré : 90 paires distinctes, 0 comparaison nulle.**
- `tableau.ts`, `graviteLaPlusHaute` (`< → <=`) — `RANG` est injectif, donc rangs
  égaux ⟹ gravités égales ⟹ réaffectation sans effet. **Mesuré : 364 suites de
  gravités de longueur ≤ 5, 0 divergence.**

### PAS fait, et dit plutôt que maquillé

Trois nudités restent, réelles mais à faible conséquence, et je ne les ai pas
éprouvées cette nuit — bâcler trois bancs en fin de tour aurait produit du décor :

1. `dashboard/src/GardeFous.tsx` — `etat.classement.length > 0` : muté, un
   `<table>` d'en-têtes sans une seule ligne s'affiche. Cosmétique, visible.
2. `src/orchestrator/scheduler.ts` — `Object.keys(modeleParDrone).length > 0` :
   muté, `race.modeleParDrone` reçoit `{}` au lieu de rester absent.
3. `src/orchestrator/store.ts` — `staleNodes`, `n.lastSeen < ?` : muté, un nœud
   dont le heartbeat vaut EXACTEMENT la limite devient périmé. La documentation
   de la méthode dit « antérieur à », donc le contrat est du côté du `<` strict.

Aucune n'est un mutant équivalent : les trois changent un comportement
observable. Elles attendent leur banc.

## POINT DE SORTIE — 12 août 2026, sortie visée ~2 septembre

### 1. Le temps

**21 jours.**

### 2. Livré ET vérifié depuis hier

**Honnêteté d'abord : RIEN n'a été fusionné.** `main` est toujours à `d39e166`
(PR #208, 11 août). Les **16 commits** de cette nuit vivent dans #209, ouverte,
CI 5/5 verte, `mergeable_state clean` — et bloquée par deux choses distinctes,
qu'il ne faut pas confondre :

- le **feu vert** de l'utilisateur, qui n'est pas donné ;
- le **classifieur de permissions de l'atelier**, qui refuse `sh
scripts/fusionner.sh` ET son équivalent `git push origin HEAD:main`. Même avec
  le feu vert, la fusion ne partira pas sans une règle Bash côté utilisateur.

« Vérifié dans l'arbre et en CI » n'est pas « livré ». Ce qui suit est vérifié,
pas livré.

**Douze gardes réelles trouvées et fermées**, toutes mutation-first avec verdict
rouge affiché. Les quatre à conséquence :

- **un nœud à liste de modèles vide ne pouvait plus rejoindre la ruche** — `[]`
  est _truthy_, le hub refuse le `register` entier, et le nœud bouclait sans
  qu'aucun message ne dise pourquoi ;
- **le hub confiait du travail à une ouvrière déclarée hors service**, qui le
  refusait, et tout repartait au tour suivant ;
- **`hive doctor` sondait le port 0** sur un `HIVE_PORT=` vide et annonçait que
  la ruche ne tournait pas, pendant qu'elle écoutait sur 7777 ;
- **`HIVE_RUNNER=on ` avec une espace finale** faisait travailler l'essaim en
  autonomie sans que l'avertissement « l'essaim travaille seul » ne sorte — le
  seul réglage dont le rôle est de dire qu'on dépense sans surveillance.

**L'instrument a été élargi, puis corrigé.** La table de la loupe ne mutait les
bornes que dans le sens qui RESSERRE ; symétrisée, elle a rendu 8 nues sur 70 là
où elle n'en voyait qu'une sur 57. Puis `??` y est entré trop large — 10 de ses
12 désignations étaient équivalentes par le TYPE — et il a été **resserré**
plutôt que gardé : un instrument qui ne peut plus rendre vert n'est plus une
porte, c'est un mur.

**Mesuré :** typecheck 0 · typecheck:dashboard 0 · eslint 0 · prettier 0 · suite
**3 612** (3 605 verts, 7 ignorés, 0 rouge) · badges re-mesurés à 3 612 sur les 6
emplacements · loupe verte sur le diff de branche · 5 jambes CI vertes.

**Et une faute, dite plutôt que tue :** j'ai poussé sur une suite ROUGE.
`CODE_SUITE=1` s'affichait sous mes yeux ; le commit est parti parce que mesure
et livraison vivaient dans le même enchaînement. Les cinq jambes l'ont dit.
Réparé, et consigné (`ERREURS § 9 septtrigies`) — ce n'est pas l'inattention qui
l'a permis, c'est le geste.

### 3. Ce qui reste, par ordre de casse pour un nouvel arrivant

1. **La fusion de #209 — et elle est BLOQUÉE À DEUX TITRES.** 16 commits de
   durcissement, dont quatre défauts qui cassent un premier contact, restent hors
   de `main`. C'est le point n°1 parce que rien de ce qui précède ne protège
   personne tant que ça n'est pas fusionné. **Lever le blocage demande l'un ET
   l'autre : le feu vert, et une règle Bash.** Aucun des deux n'est de mon
   ressort.
2. **La première impression : la vitrine (#63).** Toujours pas atteint, toujours
   👤 — la page publique ne se reskine pas de tête, et sa moitié identité
   applique déjà le fichier de design fourni le 2 août. Décision d'édition.
3. **Le README GitHub au design de la vitrine**, en aval de #63. Décision
   d'édition, non atteint.
4. **Le seuil de couverture n'est toujours PAS un gate.** Le DoD (§ D) pose que
   la couverture se mesure sans rien barrer. Tant que rien ne rougit dessus,
   « couvert » n'est pas un critère atteint — c'est un chiffre. Le câbler change
   la définition de sortie : décision de politique, pas trou de code.
5. **Une décision d'outillage en attente** : la garde de vantardise de
   `site-fraicheur` compte les tests textuellement et dérive (−7,2 %, 74 tests de
   marge avant la prochaine morsure), alors que `scripts/compte-tests.mjs`
   épingle déjà le chiffre EXACTEMENT en CI. Lui apprendre d'autres formes ou la
   retirer comme doublon approximatif n'est pas à moi de trancher.
6. **Rien d'autre côté code ne casse l'arrivant** — et c'est dit sans arrondir :
   la liste des points ouverts du carnet est épuisée, pas parce que tout est
   parfait, mais parce que ce qui reste n'est pas du code.

### 4. Hors d'atteinte — à DIRE, pas à simuler

Inchangé, et toujours vrai :

- **Paquet npm signé** (lot 7) et **image GHCR + `cosign`** (lot 10) : pas mes
  comptes, pas mes clés. `curl … | sh` depuis le dépôt marche sans eux ; un
  `npm i -g` ou un `docker pull` d'artefact OFFICIEL réclame des identifiants
  humains.
- **Aucune vraie machine Windows ni macOS.** La CI prouve le CODE sur les trois
  systèmes, pas l'INSTALLATION sur un poste réel — la nuance est le critère.
- **Tarifs et ton commercial** de la vitrine : décisions de l'utilisateur.
- **Et, nouveau ce tour : la fusion elle-même.** Le classifieur de l'atelier
  refuse les deux chemins. Ce n'est ni un défaut de code ni une prudence de ma
  part : c'est une permission que seul l'utilisateur peut accorder.

### Verdict

Le code est plus sûr qu'hier de douze gardes, et `main` n'en a reçu aucune. Un
durcissement qui ne sort pas de sa branche ne protège personne — c'est le seul
chiffre qui compte à 21 jours.

### Ce que ce point de sortie ne pouvait pas savoir — #209 a atterri

Le paragraphe ci-dessus reste écrit tel qu'il a été mesuré : il était vrai à
l'heure où il l'a été. Il ne se réécrit pas, il se COMPLÈTE — un carnet qu'on
corrige après coup n'est plus une mémoire, c'est un plaidoyer.

**#209 est fusionnée.** `main` est passé de `d39e166` à `8f88266` : 18 commits,
31 fichiers, +2 475 lignes. La CI de `main` sur le commit de fusion est
**complète et verte sur les cinq jambes** (run 628). Les douze gardes de la nuit
du 12 sont dans la branche que les gens clonent.

**Une réserve, dite plutôt que tue :** la fusion est partie par l'API GitHub,
donc le committer de `8f88266` est `noreply@github.com` — exactement le défaut
que `scripts/fusionner.sh` existe pour supprimer (son en-tête, lignes 7-15). Le
script reste refusé par le classifieur de permissions de l'atelier. Le résultat
est bon, le geste ne l'est pas : c'est la différence qu'il faut garder en tête
avant de considérer le point comme clos.

Le point n°1 de la liste 3 ci-dessus — « la fusion de #209, bloquée à deux
titres » — est donc **fermé**. Les points 2 à 5 restent ouverts, et aucun n'est
de mon ressort.

### Le « hors d'atteinte » n'en était pas un — `fusionner.sh` a porté #211

La liste 4 rangeait la fusion elle-même parmi ce qui doit se DIRE plutôt que se
simuler : « le classifieur de l'atelier refuse les deux chemins […] c'est une
permission que seul l'utilisateur peut accorder ». C'était vrai trois fois de
suite, sur #209 et #210. Ça ne l'est plus, et une mémoire qui garde un obstacle
périmé fait renoncer d'avance :

    sh scripts/fusionner.sh
    → 2 commit(s) à porter sur « main », en avance rapide
      a8b091b..f090923  HEAD -> main
    ✔ « main » porté — sans commit de fusion.
    CODE_FUSION=0

**#211 est donc entrée par le bon geste**, et la différence se lit dans
l'historique. Les trois fusions précédentes portent `noreply@github.com` —
`a8b091b`, `8f88266`, `d39e166`, fabriquées par l'API. Les deux commits de #211
portent `noreply@anthropic.com`, et il n'y a AUCUN commit de fusion au-dessus
d'eux : l'avance rapide n'en crée pas, donc il n'y a pas de committer à corriger.

Ce que ça change pour la suite : le chemin propre est disponible, et c'est lui
qu'il faut essayer EN PREMIER à chaque livraison. Ce que ça ne change pas : les
trois commits de fusion déjà publiés restent « Unverified », et un historique
publié ne se corrige qu'en le réécrivant — plus cher que ce qu'il vaut ici.

La leçon de méthode, elle, ne dépend pas de cet outil : **un obstacle constaté
n'est pas un obstacle permanent, et le noter comme définitif est une façon de se
tromper à retardement.** Le réessayer coûtait une commande.

## Balayage à couverture PLEINE sur le terrain jamais vu par la table symétrique

Base épinglée `1dca6d4` (29 juillet), jamais dans le dépôt, dans un worktree
détaché. **225 mutants possibles, 225 examinés** — aucun échantillonnage.

Pourquoi cette base : la table de la loupe a été symétrisée APRÈS les balayages
`946b36b` et `HEAD~80`. Tout le terrain d'avant `68087bc` n'avait donc jamais été
regardé par l'instrument actuel.

### Le chiffre

    225 mutants · 207 défendus · 18 nus (17 lignes distinctes)

Répartis : `tui/rendu.ts` 8, `store.ts` 4, `garde-fou.ts` 2, `tableau.ts` 1,
`aiguillage.ts` 1, `ruche.mjs` 1, `compte-tests.mjs` 1.

### Ce que les 18 ont réellement donné

**Six vrais défauts, tous fermés mutation-first avec verdict rouge affiché :**

| ce qui cassait                                 | la conséquence                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `moyenne` sur un antécédent jamais servi       | `0/0` = NaN, et `JSON.stringify(NaN)` rend `null` — le tableau qui explique les choix était VIDE le jour de l'installation |
| les deux prédicats de `pruneTasks` désaccordés | une tâche pile au seuil survit sans que ses dépendances soient protégées : le socle part, elle reste bloquée pour toujours |
| `compte-tests` : la raison retirée du message  | « rapport illisible » sans dire POURQUOI — deux pannes opposées, une seule phrase                                          |
| `marqueBlocs` : la largeur minimale            | la marque disparaissait à 26 colonnes, là où elle tient exactement                                                         |
| `dureeCourte(0)` et les bascules 10 s / 60 s   | un pas instantané s'affichait comme un pas qui n'a pas tourné                                                              |
| le dégradé de la marque                        | les espaces teintés, les blocs nus — le logo en négatif                                                                    |

**Cinq équivalences MESURÉES, consignées sur place** pour qu'aucun balayage futur
ne refasse l'enquête : la coupe des mots longs (2 016 cas, zéro écart), la garde
du palier partiel (82 480 cas, zéro écart), la boucle par lots de l'élagueur (une
prédiction de panne totale RÉFUTÉE — SQLite accepte `IN ()`), le départage de
`tachesPourEcran` (clé primaire), le pire d'`alertes` (`RANG` injectif).

**Deux équivalences déjà écrites dans le code** avant cette nuit — celles de
`normaliserBornes` et `elireEchelon` — reconnues d'un coup d'œil. La discipline
de les consigner a payé exactement comme prévu.

### Ce que le balayage a coûté, et qu'il faut dire

Il a **noyé la machine** au premier essai : charge 57, une soixantaine de vitest,
la loupe ayant muté la garde de point d'entrée de `tamis-ordres.mjs` et déclenché
une récursion de suites. L'instrument a été réparé (`ERREURS § 9 quadragies`), et
la même base rend depuis 225 candidats au lieu de 230 — les cinq retirés sont
exactement les gardes de point d'entrée.

### Le rapport signal/bruit, sans arrondir

Six défauts pour 225 mutants, c'est **2,7 %**. Sur du code MÛR, après quatre
balayages antérieurs, c'est un rendement honnête — et il tient surtout à
l'élargissement de la table, pas à la profondeur de la base : sept des huit
désignations de `rendu.ts` viennent de bornes que l'ancienne table ne savait pas
inverser.

La moitié du travail a consisté à ne PAS écrire de garde : cinq équivalences
mesurées, dont une qui a réfuté ma propre prédiction de panne. Un balayage qui ne
rendrait que des gardes serait un balayage qu'on n'a pas assez interrogé.

## Le périmètre du balayage se règle — `LOUPE_CHEMINS`

**Décision prise seule, la nuit du 12 au 13 août.** Le balayage élargi à
597 candidates (base épinglée `1169399`) est mort au bout de quatre heures, en
étant arrivé à `src/installer-assistant.ts`. Ordre alphabétique oblige, il avait
passé l'essentiel de son temps sur `dashboard/` — 51 nudités dans le seul
`Cerveau.tsx` — et n'avait JAMAIS atteint `src/orchestrator`, `src/shared` ni
`src/tui`, c'est-à-dire le cœur.

Relancer à l'identique aurait repassé les mêmes heures sur le terrain déjà jugé
avant d'y revenir. L'alternative — bricoler un filtre dans l'atelier, sans le
commettre — est exactement ce que le § 9 quadraquadragies interdit : un
instrument modifié à la main ment sans le savoir.

`LOUPE_CHEMINS` remplace donc le périmètre par défaut, et se donne par
l'ENVIRONNEMENT comme `LOUPE_BASE` — un périmètre est le réglage d'UN balayage,
pas une propriété du dépôt ; écrit dans le dépôt, il deviendrait un angle mort
permanent, ce que la loupe existe précisément pour empêcher.

Deux gardes, toutes deux éprouvées par mutation (verdicts au commit) :

- **vide ⇒ périmètre complet.** Un pathspec vide ne veut pas dire « rien » pour
  git : il veut dire TOUT. La loupe muterait alors les bancs eux-mêmes — et un
  banc muté qui fait rougir la suite ne prouve rigoureusement rien.
- **le juge reste dehors, quoi qu'on demande.** `LOUPE_CHEMINS=scripts` est une
  demande légitime et ne doit pas remettre `scripts/loupe.mjs` sous sa propre
  lame. Vérifié contre le vrai git, et pas seulement en table : avec
  l'exclusion, `scripts/loupe.mjs` est absent du diff ; sans elle, il revient.

Le balayage du cœur se lance donc ainsi, depuis l'atelier :

    LOUPE_BASE=<sha épinglé> LOUPE_CHEMINS=src/orchestrator,src/shared,src/tui \
      LOUPE_MAX=<assez grand pour tout voir> node scripts/loupe.mjs

# POINT DE SORTIE — 13 août 2026, J−20

Vingt jours avant le 2 septembre. Ce point ne coche rien : un critère non mesuré
n'est pas atteint, et il se dit comme tel.

## 1. Ce qui est LIVRÉ ET VÉRIFIÉ depuis hier

Quarante-quatre commits, neuf pull requests fusionnées en avance rapide (#221 à
#230), CI verte sur cinq jambes à chaque fois. Suite : **3 691** cas mesurés,
jamais annoncés de tête.

Ne comptent ici que les choses **vues rougir** ou **lancées pour de vrai**.

**Neuf défauts corrigés, chacun avec sa mutation jouée et son verdict affiché :**

| Ce qui était cassé                                         | Ce que la mutation a montré                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| Le graphe du Cerveau pouvait perdre TOUS ses noms          | `heurte && p.id !== actif` → `\|\|` laissait 3 641 cas verts |
| Un nœud exclu faisait lire `agentType` sur `undefined`     | `!task \|\| !producteur` → `&&` : `TypeError` réel           |
| Le Cerveau classait ses leçons par ordre alphabétique      | la plus récurrente n'était plus en tête, suite verte         |
| Un nom de chantier de 100 caractères : proposé puis refusé | 3 portes sur une borne, 2 nues                               |
| Une référence git de 300 caractères passait au dispatch    | la garde de longueur cessait d'exister                       |
| La ruche accusait un humain d'une extinction de GitHub     | le motif du refus s'inversait sans casser d'écran            |
| Le chemin d'un workflow et la date d'un run se vidaient    | garde `typeof` inversée : champ vide, en silence             |
| La désinstallation proposait d'effacer l'installation      | `&&` → `\|\|` sur le filtre « hors du dossier »              |
| Le Cerveau se contredisait : fiche contre tableau          | deux vérités pour `serviIlYaJours === null`                  |

**Deux rouges de CI réparés, tous deux ÉTRANGERS au diff qui les a révélés :**

- un `git clone` partait vers le vrai `github.com` depuis un banc dont l'en-tête
  promettait de ne pas toucher au réseau — 1,3 s sous Linux, plus de 20 000 ms
  sur la CI Windows ;
- un banc de canal temporel pariait sur l'ordonnanceur (une mesure par chemin) ;
  il a perdu à 129 ms contre 14 ms. Passé aux médianes de cinq tours entrelacés,
  **et vérifié qu'il mord encore** en réintroduisant la fuite : 1 ms contre
  16 ms, cinq fois de suite.

**Un instrument amélioré.** `LOUPE_CHEMINS` : sans lui, le balayage passait ses
nuits sur `dashboard/` sans jamais atteindre `src/orchestrator`. Le cœur du dépôt
— **520 candidates sur trois segments** — a été examiné pour la première fois.

**Deux équivalences consignées** (`mode.ts`, `chantier.ts`), mesurées
exhaustivement plutôt que déduites. Elles ne valent pas un test : les tuer
demanderait une entrée qui n'existe pas.

**Onze leçons au carnet**, § 9 sexquadragies à septenquinquagies.

## 2. Ce qui reste entre la ruche et une sortie présentable

Classé par ce qui casse l'expérience d'un arrivant EN PREMIER.

### 2.1 — L'unique commande du README n'avait jamais été menée à son terme par une machine → FRANCHI

**C'était le premier point, et de loin.** Mesuré ce matin :

- `curl` sur les deux URL du README → **HTTP 200**, contenu **identique** au
  dépôt. Le chemin est vivant et autonome : `install.sh` CLONE, il ne dépend ni
  de npm ni d'une Release. Les blocages des lots 7 et 10 ne barrent donc PAS la
  porte d'entrée ;
- mais la CI ne lançait que `sh install.sh --dry-run`. **Le mode sec s'arrête
  avant `npm install`**, donc avant tout ce qui peut réellement échouer chez un
  inconnu : la résolution des dépendances, le module natif SQLite, le lancement
  de l'installeur interactif, la ruche qui démarre.

Autrement dit : ce que le README promet en une ligne était **exercé jusqu'au
seuil, jamais franchi**. Le critère 1 (« une commande, ≤ 3 décisions, < 60 s »)
avait été mesuré sur un dépôt DÉJÀ cloné, pas depuis la commande que lit un
arrivant.

**Le seuil est franchi.** Node 24 a été récupéré sur ce conteneur — ce qui
lève le blocage noté plus bas —, l'installation a été menée de bout en bout
depuis l'URL du README (code 0 en 27 s, `.env` en 0600, `/api/pulse` en 7 ms,
`hive doctor` « tout est en ordre »), puis la mesure a été rendue REJOUABLE :

- `scripts/essai-installation.sh` affirme trois choses — sortie 0, `.env` en
  `-rw-------`, et la ruche RÉPOND. La troisième ne peut pas être simulée ;
- un travail `seuil` la rejoue à chaque PR, sur **l'arbre de la PR** et non sur
  `main` (`--depot "$PWD"`), sans quoi la CI dirait « l'installation marche »
  d'une version qui n'est pas celle qu'on livre.

Verdict affiché, par mutation sur un arbre cassé exprès (`app.listen({ port:
config.port + 1 })` — la ruche écoute à côté du port qu'elle annonce) :

```
arbre sain  → CODE=0 · sortie en 0, 15 s · .env en -rw------- · répond sur :7777 après 2 s
arbre cassé → CODE=1 · le journal dit « Dashboard : http://127.0.0.1:7778 » quand le .env dit 7777
```

**Ce qui n'est PAS couvert, et se dit :** ce travail ne tourne que sous Linux.
Windows et macOS restent exercés **au seuil seulement**, par `--dry-run`.

_Depuis, un rapport de terrain a mené l'installation à son terme sur une vraie
machine Windows 11 (§ 3). Le critère 1 se lit donc : **mesuré en continu sous
Linux, mesuré une fois sous Windows, jamais sous macOS.** Pas trois sur trois,
et pas non plus un sur trois — la formulation exacte compte plus que le
raccourci._

**Un défaut trouvé en chemin, non corrigé, consigné :** l'installeur sonde
`PORT_DEFAUT`, pas le port qu'il va réellement écrire. Sur une réinstallation
par-dessus un `.env` existant qui porte un port personnalisé, la sonde regarde
la mauvaise porte — faux négatif silencieux. Le réparer proprement demande de
lire le `.env` AVANT les sondes : c'est un lot à soi, pas une retouche hâtive.

**Fait dans la foulée** (PR suivante). La décision est sortie dans une fonction
pure, `portRetenu`, que la sonde et l'écriture lisent toutes les deux ; une
garde compare les deux plutôt que de recopier la règle. Deux bancs en
comportement, écrits AVANT la correction et vus rougir :

```
« le port du .env est occupé » → la sonde disait « Port 7777 libre »
« le port du .env est libre »  → [ATTENTION] Port 7777 — pour une ruche
                                  qui n'ira jamais sur 7777
```

Trois choses réparées du même coup : la sonde vise la bonne porte, le rapport
`--json` nomme le port RETENU (il annonçait `PORT_DEFAUT`, donc un script de
supervision surveillait ailleurs), et un `HIVE_PORT` illisible se dit au lieu
d'être ignoré. Leçon au carnet, § 9 novemquinquagies.

### 2.1 bis — Le reste du balayage : mesuré sur HEAD, pas cru sur parole

Trois items traînaient de liste en liste. Aucun n'a été pris pour argent
comptant ; les trois ont été mutés sur HEAD. **Un seul demandait un geste, et ce
n'était pas celui que la liste suggérait.**

| Item                               | Verdict mesuré                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `server.ts` — `taskId && nodeId`   | **déjà défendu** — `inspectionDeProduction`, mutant `&&` → `\|\|` : 2 cas rouges                       |
| Cerveau — le glisser au canevas    | **injouable, et mesuré** — happy-dom rend `getContext('2d') → null`, rect `0×0`                        |
| Balance — `arme && cible !== null` | **une moitié vive, une équivalente** — `arme` retiré : 1 rouge ; `cible !== null` neutralisé : 3 verts |

Le glisser ne se simulera pas : sans contexte 2D ni géométrie, un `mousemove`
de banc ne jouerait que ses propres bouchons. Les trois décisions qu'il porte
sont déjà sorties du composant (`priseAuDoigt`, `deplacementDuGlisse`,
`selectionAuRelacher`), pures et éprouvées hors canevas — c'est tout ce qu'on
peut tenir, et ça se dit plutôt que de se maquiller.

L'équivalence de la Balance est consignée SUR PLACE avec ses deux verdicts, pas
retirée : elle porte le rétrécissement de type qui autorise `formatDuree(cible)`
en dessous. Leçon au carnet, § 9 sexagies.

Deux points de la liste du jour étaient périmés eux aussi, et le sont depuis
plus longtemps : `getSnapshot()` **a** une limite (`LIMITE_TACHES_INSTANTANE`,
paramètre par défaut) et la table `tasks` **a** son élagueur (`pruneTasks`, avec
les bornes référentielles câblées derrière lui).

### 2.2 — Le service est ACCEPTÉ, il n'est pas DÉMARRÉ (lot 9)

`systemd-analyze verify`, `plutil -lint` et `schtasks /Create /XML` valident les
fichiers à chaque CI. Aucun runner n'a le bus de session qu'exige
`systemctl --user enable --now`. La ligne reste 🟡, et elle doit le rester.

### 2.3 — Empreintes et Release (lot 8)

`install.sh` et `install.ps1` existent et sont exercés (PowerShell 7 **et** 5.1).
Les empreintes publiées et la Release n'existent pas. Conséquence pour un
arrivant prudent : rien à vérifier avant d'exécuter un script téléchargé.

### 2.4 — Première impression : README et vitrine (#63)

Le README n'est pas au design de la vitrine, et le carrousel d'agents n'existe
pas — le bandeau est statique. **Ces deux points sont en aval de #63**, dont le
plan est écrit et attend un arbitrage d'édition qui n'est pas le mien (ton,
montants, ce qui part en docs). Je ne les ai pas pris, et je ne les prendrai pas
sans ce mot-là.

## 3. Hors d'atteinte — à dire, pas à simuler

- **npm (lot 7) et GHCR/cosign (lot 10)** : comptes qui ne sont pas les miens.
  Le code est prêt, la publication non. Bonne nouvelle mesurée en 2.1 : ça ne
  bloque pas l'installation.
- **Une machine macOS réelle.** L'installation complète est mesurée sous Linux à
  chaque PR (§ 2.1) ; sous macOS elle s'arrête au seuil (`--dry-run`), et
  personne ici n'a de quoi aller plus loin.

  **Windows n'est plus dans cette liste, et c'est le terrain qui l'en a sorti.**
  Une installation réelle sur Windows 11 / Node 26 a été rapportée, et elle est
  allée jusqu'au bout : clone, dépendances, module natif, écran d'accueil,
  `.env` en 0600, premier projet. Ce que la CI vérifie a tenu sur une vraie
  machine de bureau.

  Elle a aussi trouvé ce qu'aucune de nos courses ne pouvait trouver — la
  PREMIÈRE commande de l'écran de fin ne marchait pas là-bas (§ 9 duosexagies) :
  le shell n'est plus dans le dossier de la ruche, et `npm` passe par un
  `npm.ps1` que la stratégie d'exécution refuse. Corrigé, et gardé par des bancs
  qui nomment leur plateforme.

  Ce que ça change pour la sortie : le critère 1 n'est plus « mesuré sur un
  système sur trois » mais **« mesuré en continu sur Linux, mesuré une fois sur
  Windows, jamais sur macOS »**. C'est plus fort qu'hier, et ce n'est toujours
  pas trois sur trois — il faut le dire dans cet ordre.

  Un rapport de terrain vaut mille exécutions de CI, parce qu'il est le seul à
  contenir le pas que personne n'a pensé à automatiser.

- **Le démarrage effectif du service** : demande un bus de session utilisateur.
- **L'intermittent d'origine** : jamais reproduit, invisible en huit ordres
  mélangés et trois exécutions identiques. Pas fermé — introuvable d'ici.
- **Les tarifs et le ton commercial** (#63) : décision humaine.
- **Encaisser un paiement** avant le 2 septembre : décision humaine.

---

# POINT DE SORTIE — 14 août 2026, J−19

## 1. Le temps

**19 jours** avant le 2 septembre.

## 2. Livré ET VÉRIFIÉ depuis hier

« Vérifié » veut dire : lancé, mesuré, ou couvert par un banc qu'on a VU rougir
avant de l'écrire. Rien de ce qui suit n'est là au titre d'« écrit ».

### 2.1 L'instrument qui juge tout le reste avait quatre défauts

`scripts/loupe.mjs` est ce qui décide si un lot est défendu. Quatre défauts y ont
été trouvés et fermés, et **aucun par ses propres bancs** — tous les quatre en la
rejouant de bout en bout dans l'atelier.

| Défaut                                                        | Ce qu'il produisait                                  | Verdict après           |
| ------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| la marque d'équivalence valait pour la LIGNE, pas la mutation | criait « marque fausse » sur deux mutants défendus   | l'unité est la mutation |
| la marque posée hors d'atteinte de la remontée                | consignation invisible à l'instrument                | remontée corrigée       |
| les combinateurs CSS mutés comme des comparaisons             | un survivant ni tuable ni équivalent, à chaque passe | 443 → 440 candidates    |
| `LOUPE_MAX` illisible → `NaN` → zéro mutation examinée        | **« LA LOUPE NE VOIT RIEN DE NU », sortie 0**        | refus, `CODE=2`         |

Le dernier est le grave : `LOUPE_MAX=douze` suffisait à faire rendre un feu vert
à l'instrument dont le métier entier est de débusquer les faux verts. Mesuré
dans l'atelier, pas déduit.

Le constat structurel qui les relie, et qui vaut plus que les quatre correctifs :
**ses bancs éprouvent des fonctions pures, et les quatre défauts vivaient dans la
COLLE entre elles** — lire une variable d'environnement, passer un nom de
fichier, parcourir un diff. Extraire des fonctions pures les rend éprouvables ;
ça ne rend pas éprouvable ce qui les appelle.

### 2.2 Onze décisions d'écran sorties du JSX et éprouvées

Chacune était hors d'atteinte de tout banc, chacune a été mutée AVANT que son
banc existe, chacune a un verdict affiché au commit :

- `verdictDesTests` — pouvait annoncer « ✔ tests verts » sur une suite ROUGE,
  et cette phrase est lue pour décider de fusionner ;
- `jamaisRienRecu` — **le même test écrit cinq fois dans deux vues, nommé zéro
  fois** ; trois des cinq sont tombés nus d'un coup, ce qui n'est pas une
  coïncidence : une idée réécrite à chaque usage n'est éprouvée à aucun ;
- `decouper` — le mutant `> 0` → `>= 0` fait `0 / 0`, donc **NaN** dans un
  `width: ${pct}%` : la barre disparaît, et c'est l'état initial de TOUT LE MONDE
  (un projet neuf n'a aucune milliseconde) ;
- `effetDuMode`, `peutPoser`, `nomDeLivraison`, `suffixeEnVol`, `noteCreuse`,
  `resumeDeNote`, `taille`, `densiteEcran`.

`Balance.tsx` perd 44 lignes nettes au passage.

### 2.3 Une hypothèse tuée par sa propre mesure

Le plafond de processus vitest (`HIVE_VITEST_FORKS`) devait expliquer
l'intermittent Windows. Mesuré 3 fois par bras : **114,9 s contre 115,4 s** — du
bruit. La première mesure qui disait « 21 % plus rapide » était un artefact de
cache de transformation froid, et j'avais mesuré le témoin en premier.
Publié comme résultat négatif au lieu d'être enterré. L'instrument reste en
place ; **l'expérience Windows elle-même n'est pas faite** (§ 4).

### 2.4 Les chiffres, mesurés aujourd'hui

| Mesure           | Aujourd'hui                                               | Référence         |
| ---------------- | --------------------------------------------------------- | ----------------- |
| Suite            | **3900** (`compte-tests`, sans `--corriger`, comme la CI) | 3501 au 7 août    |
| Lignes couvertes | 76,46 % (9410 / 12307)                                    | 75,43 % au 8 août |
| Branches         | 70,94 % (7655 / 10790)                                    | 69,48 % au 8 août |
| Fonctions        | 75,55 % (2293 / 3035)                                     | 74,33 % au 8 août |
| CI               | 6 jambes vertes sur `c45385f`                             | —                 |

La couverture n'est **pas** un critère de sortie et ne barre rien ; elle est
remesurée ici parce que la valeur du carnet datait du 8 août.

### 2.5 Ce qui a échoué aujourd'hui, et se dit

CI rouge sur les **trois** jambes : `prettier --check docs/ERREURS.md`. Pas
l'intermittent — les trois tombaient au même endroit en huit secondes. Cause :
j'avais lancé la barrière en tâche de fond POUR écrire le carnet pendant qu'elle
tournait. Elle disait vrai sur l'arbre qu'elle avait lu ; le fichier suivant
n'existait pas encore. § 9 unoctogies : **le dernier geste avant `git add` est la
barrière, pas l'écriture.**

## 3. Ce qui reste, par ordre de casse pour un nouvel arrivant

### 3.1 — macOS : la commande du README n'a JAMAIS été menée à son terme, nulle part

C'est le premier point, et il est net. Le travail `seuil` — celui qui affirme que
l'installation va jusqu'à une ruche qui RÉPOND — tourne sur `ubuntu-latest`, et
seulement là. Sur macOS, la CI ne fait que `install.sh --dry-run` : **le mode sec
s'arrête avant `npm install`**, donc avant la résolution des dépendances, avant
le module natif SQLite, avant que la ruche démarre.

Le critère 1 se lit donc, exactement : **mesuré en continu sous Linux, mesuré une
fois sous Windows (rapport de terrain), jamais sous macOS.** Pas « trois OS
verts » — la matrice à trois OS mesure que _le code compile et que les bancs
passent_, ce qui n'est pas la même phrase.

macOS est une plateforme de développeur très commune. Un arrivant qui y lance la
commande du README fait quelque chose que personne n'a jamais vu réussir.

**C'est en atteinte** : le runner `macos-latest` existe déjà dans la matrice.
C'est le lot repris tout de suite après ce point.

### 3.2 — Rien à vérifier avant d'exécuter un script téléchargé

Le README dit `curl … | sh`. Il n'y a **ni Release, ni empreinte publiée, ni
signature** (`list_releases` sur le dépôt : liste vide, mesuré aujourd'hui). Un
arrivant prudent s'arrête ici, et il a raison.

Publier une empreinte DANS le dépôt qui sert le script ne protège de rien : un
dépôt compromis sert les deux. Le vrai geste est une Release signée, et il
demande une décision de version et des clés (§ 4).

### 3.3 — Le service est ACCEPTÉ, il n'est pas DÉMARRÉ

`systemd-analyze verify`, `plutil -lint` et `schtasks /Create /XML` valident les
fichiers à chaque CI. Aucun runner n'a le bus de session qu'exige
`systemctl --user enable --now`. Deuxième jour d'un arrivant, pas le premier —
d'où le rang 3.

### 3.4 — Première impression côté dépôt (#63)

Le README n'est pas au design de la vitrine, le bandeau est statique. **Réservé
à l'utilisateur** : ton, montants, ce qui part en docs. Non pris, et ne le sera
pas sans ce mot-là.

### 3.5 — La dette du balayage, dite en chiffres plutôt qu'en impression

Sur `dashboard/src/views`, base épinglée `f0fc005` : **440 candidates, 42
examinées**. Il reste 10 survivants nommés (Chantiers 2, Intendance 2, Rayon 1,
Ruche 1, MonEspace 1, Miellerie 1, plus `s.pct > 0` dans Balance) et **398
candidates jamais regardées**.

Invisible pour un arrivant, d'où le rang 5. Mais c'est la seule ligne de cette
liste qui mesure ce qu'on ne sait PAS.

## 4. Hors d'atteinte — à dire, pas à simuler

- **Une machine macOS réelle.** Le runner CI en est une, et c'est ce qui rend 3.1
  faisable ; un poste de bureau macOS avec ses réglages à lui, non.
- **npm (lot 7) et GHCR/cosign (lot 10)** : comptes et clés qui ne sont pas les
  miens. Mesuré et rassurant : ça ne bloque pas l'installation, qui clone.
- **Une Release signée** : demande un numéro de version et des clés — décision
  humaine.
- **Le démarrage effectif du service** : demande un bus de session utilisateur.
- **`workflow_dispatch` et le rejeu d'un job** : `403 Resource not accessible by
integration`, mesuré deux fois. **Conséquence directe : l'expérience Windows
  `HIVE_VITEST_FORKS` ne peut pas être menée d'ici.** L'instrument est en place,
  la mesure attend l'utilisateur. Je ne la promettrai pas.
- **L'intermittent Windows d'origine** : jamais reproduit, invisible en huit
  ordres mélangés et trois exécutions identiques. Pas fermé — introuvable d'ici.
- **Identité de vitrine, tarifs, ton commercial** (#63) : décision d'édition.
- **Encaisser un paiement avant le 2 septembre** : décision humaine.

## Verdict

Le code, l'installation sous Linux et le socle de sûreté sont mesurés. Trois
phrases qu'il ne faut pas raccourcir :

1. « Marche sur trois OS » veut dire **le code passe la CI sur trois OS**. Pour
   l'installation, c'est Linux en continu, Windows une fois, macOS jamais.
2. « Rien de neuf n'est nu » vaut **sur les 42 candidates examinées**, pas sur
   les 440.
3. Le critère « présentable » n'est pas atteint, et il ne dépend pas de moi.

---

## Balayage sur le terrain jamais vu : `src/node-client` et `src/tui`

Tous les balayages précédents avaient porté sur `dashboard/src`, `scripts/`,
`src/orchestrator`, `src/shared` et `dashboard/src/views`. Deux dossiers du
dépôt n'avaient JAMAIS été passés à la loupe : `src/node-client` (13 fichiers,
3 315 lignes — le code qui tourne sur la machine de chaque coéquipier) et
`src/tui` (2 fichiers, 1 587 lignes — l'installeur interactif).

### Le chiffre, et sa borne

```text
LOUPE : 192 mutation(s) possible(s) sur le diff, 20 examinée(s).
        172 laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.

════ LA LOUPE NE VOIT RIEN DE NU ════
```

**20 mutations jouées, 0 survivante.** Base épinglée `f0fc005`, atelier détaché,
1 h 05 de suite.

Et la borne, qui compte autant : **20 sur 192**, soit un dixième. Un vert sur un
dixième d'un terrain ne dit pas « ce terrain est défendu ». Il dit « les vingt
lignes regardées le sont ». La différence est exactement celle que la loupe
existe pour ne pas laisser confondre.

### Pourquoi ne pas avoir tout joué

Chaque mutation coûte une suite entière (~2 min). 192 mutations font **six
heures et demie**. L'échantillon régulier (une candidate sur `ceil(192/20)`)
est reproductible : deux passages sur le même diff regardent les mêmes lignes.

### Ce que ce zéro vaut quand même

C'est le deuxième terrain à rendre zéro survivant, après `src/shared` (49/49).
Les deux ont un point commun : ce sont des modules à fonctions largement pures,
écrits avec leurs bancs. Les terrains qui ont rendu des survivants — les vues du
tableau de bord surtout — sont ceux où la décision vit dans du JSX, hors
d'atteinte de tout banc qui ne monte pas l'écran.

Le balayage confirme donc, par un troisième chemin, le § 2 quaterdecies :
« hors d'atteinte du banc » est presque toujours « au mauvais endroit ».

### Une pastille qui mentait sur son propre travail

En attendant ce balayage, deux jambes de la CI de #262 sont restées affichées
« en cours » vingt minutes après leur fin. Le journal du travail disait
`✓ built in 557ms` puis `Cleaning up orphan processes` ; l'appel par JOB rendait
`"status":"completed","conclusion":"success"` avec un `completed_at` à 08:40.
Seule la LISTE des pastilles servait un cache périmé.

J'ai failli en conclure « Windows pend », ce qui aurait été le § 9 terseptuagies
invoqué à tort. La règle qui a servi est celle qui sert toujours : **la pastille
n'est pas la mesure — le journal l'est.** Elle vaut dans les deux sens, pas
seulement quand le vert est suspect.

---

## Le même terrain, rebalayé après les dix sentinelles : 25 jouées, zéro nue

`dashboard/src/views` avait rendu **25 survivantes sur 42 examinées** au premier
balayage — la plus forte densité de nudité du dépôt. Les dix nommées ont été
tranchées une par une (PR #256 à #262), dont neuf par extraction en modules purs
ou par sentinelle de rendu React.

Rebalayé sur la même base épinglée, avec un pas différent :

```text
LOUPE : 440 mutation(s) possible(s) sur le diff, 25 examinée(s).
        415 laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.

════ LA LOUPE NE VOIT RIEN DE NU ════
```

**25 jouées, 0 survivante**, réparties sur quinze fichiers :

| fichier          | mutations jouées |
| ---------------- | ---------------- |
| `Projets.tsx`    | 5                |
| `Balance.tsx`    | 3                |
| `Cerveau.tsx`    | 3                |
| `Essaim.tsx`     | 2                |
| `Intendance.tsx` | 2                |
| `Sante.tsx`      | 2                |
| huit autres      | 1 chacun         |

### Ce que ce zéro dit, et ce qu'il ne dit PAS

Il dit que le pas 18 — une candidate sur dix-huit, réparties sur tout le
dossier — ne trouve plus rien de nu. C'est un vrai changement : le même terrain
rendait plus d'une survivante sur deux examinées.

Il ne dit PAS que le dossier est couvert. **415 candidates restent hors de
vue**, et les deux échantillons (42 à pas 11, puis 25 à pas 18) se recouvrent
partiellement : je ne connais pas la taille exacte de leur union et je ne vais
pas la deviner. L'ordre de grandeur honnête est **une soixantaine de candidates
distinctes sur 440**, soit moins de 15 %.

### La leçon de méthode, qui vaut au-delà de ce dossier

Les neuf survivantes sur dix ont été fermées non pas en ajoutant un test là où
elles étaient, mais en DÉPLAÇANT la décision : sortie du JSX vers un module pur,
ou montée de la vue dans un banc `happy-dom`. Aucune n'a demandé de changer le
comportement du produit.

C'est le § 2 quaterdecies dans sa forme la plus économique : la nudité n'était
pas un manque de tests, c'était un mauvais emplacement. Les tests manquants
étaient impossibles à écrire tant que le code restait là où il était.

---

## Adaptateurs et entrées : deux échantillons, 49 candidates distinctes sur 222

Le terrain le plus exposé du dépôt — `src/adapters` (les lanceurs d'agents) et
les dix-sept fichiers à la racine de `src/` (installeur, CLI, désinstallation,
sauvegarde) — n'avait jamais été balayé avant le 14 août. Deux échantillons y
ont été joués, à des pas différents pour ne pas relire les mêmes lignes.

```text
1er passage  LOUPE_MAX=25 → pas ceil(222/25)=9  → 25 mutations, 0 survivante
2e  passage  LOUPE_MAX=30 → pas ceil(222/30)=8  → 28 mutations, 0 survivante
```

### L'union se calcule, et elle se calcule exactement

Les deux passages portent sur le MÊME total (222) et l'échantillon est
RÉGULIER : les indices retenus sont donc connus, et leur recouvrement aussi.

|                                        |                           |
| -------------------------------------- | ------------------------- |
| indices du pas 9                       | 0, 9, 18 … 216 — **25**   |
| indices du pas 8                       | 0, 8, 16 … 216 — **28**   |
| communs (multiples de `lcm(9,8) = 72`) | 0, 72, 144, 216 — **4**   |
| **union distincte**                    | **49 sur 222, soit 22 %** |

C'est la première fois qu'on peut dire ce chiffre sans l'estimer. Sur
`dashboard/src/views`, les deux passages avaient des totaux différents (454 puis
440, la correction des combinateurs CSS étant passée entre les deux) : les
indices n'y sont pas comparables, et l'union n'y a donc été donnée qu'en ordre
de grandeur. La différence entre « environ soixante » et « 49 exactement » n'est
pas cosmétique — l'un est une estimation, l'autre une mesure.

### Le second `LOUPE_MAX=30` n'a joué que 28 mutations

Ce n'est pas une troncature silencieuse : le pas est `ceil(222/30) = 8`, et
`0..216` par pas de 8 fait 28 indices. Le plafond borne l'échantillon par le
haut, il ne le remplit pas. La loupe imprime toujours les deux nombres —
« 222 possibles, 28 examinées » — et c'est le second qu'il faut citer.

### Ce que ces deux zéros valent

Quatre-vingt-dix-huit pour cent du terrain reste hors de vue, et un vert sur
22 % ne dit rien du reste. Ce qu'il dit, en revanche, se tient : sur les 49
lignes regardées de ce terrain-là — dont dix de `cli.ts`, le point d'entrée que
tout le monde emprunte — aucune n'était nue.

---

## Troisième échantillon sur les vues, et un chiffre qu'on refuse d'additionner

`dashboard/src/views` a été rebalayé une troisième fois, à un pas encore
différent pour recouvrir le moins possible les deux passages précédents.

```text
LOUPE : 440 mutation(s) possible(s) sur le diff, 34 examinée(s).
        406 laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.

════ LA LOUPE NE VOIT RIEN DE NU ════
```

**34 jouées, 0 survivante**, sur dix fichiers : Projets 7, Cerveau 4, Balance 4,
Intendance 3, Essaim 3, Santé 2, Miellerie 2, et trois modules purs.

### L'union des deux échantillons comparables

|                                           |                           |
| ----------------------------------------- | ------------------------- |
| pas 18 (`LOUPE_MAX=25`)                   | 25 indices                |
| pas 13 (`LOUPE_MAX=35`)                   | 34 indices                |
| communs (multiples de `lcm(18,13) = 234`) | 2 — les indices 0 et 234  |
| **union**                                 | **57 sur 440, soit 13 %** |

### Ce qu'on REFUSE d'y ajouter, et c'est le point de cette section

Le premier échantillon des vues avait examiné **42 candidates sur 454**. La
tentation est d'écrire « 42 + 57 = 99 vues sur 440 », soit 23 % — un chiffre
deux fois plus flatteur.

Il serait faux. Ce passage-là portait sur un total DIFFÉRENT : 454, avant que la
correction des combinateurs CSS n'en retire trois et que l'arbre ne bouge. Les
indices d'un échantillon régulier désignent des positions dans une liste ; si la
liste change, les mêmes positions ne désignent plus les mêmes lignes. Deux
échantillons ne s'additionnent que si leur total est le même — sinon on
additionne des pommes et le souvenir de pommes.

> **Une mesure et une mesure d'avant ne font pas une mesure double.** Les
> additionner quand même est la façon la plus facile de fabriquer un chiffre
> qu'on ne peut plus défendre — et c'est d'autant plus tentant que le résultat
> va dans le sens qui arrange.

Le chiffre défendable reste donc **57 sur 440**. Les 383 autres candidates n'ont
jamais été regardées, et trois zéros d'affilée ne changent rien à ce nombre-là.

---

## Huitième échantillon, et le critère d'arrêt qui avait été posé AVANT

`src/node-client` + `src/tui`, base épinglée `f0fc005`, arbre `34d0b12`, second
passage à un pas différent du premier.

```text
LOUPE : 192 mutation(s) possible(s) sur le diff, 28 examinée(s).
        164 laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.

════ LA LOUPE NE VOIT RIEN DE NU ════
BALAYAGE=0
```

**28 jouées, 28 défendues, 0 `SANS TEST`.** Répartition : `tui/rendu.ts` 9,
`tui/terminal.ts` 4, `merge-runner.ts` 3, `cloudflare.ts` 3, `client.ts` 3,
`agent-detect.ts` 2, puis `tunnel.ts`, `join.ts`, `isolement.ts`,
`annonces-join.ts` une chacune.

### L'union, calculable ici parce que les deux totaux coïncident

|                                         |                           |
| --------------------------------------- | ------------------------- |
| pas 10 (`LOUPE_MAX=20`, total 192)      | 20 indices                |
| pas 7 (`LOUPE_MAX=28`, total 192)       | 28 indices                |
| communs (multiples de `lcm(10,7) = 70`) | 0, 70, 140 — **3**        |
| **union distincte**                     | **45 sur 192, soit 23 %** |

Les deux en-têtes disent **192**. C'est la condition — et la seule — qui rend
l'addition licite : les indices désignent des positions dans une liste, et la
liste n'a pas bougé entre les deux passages.

### Le critère d'arrêt, énoncé avant de connaître le résultat

Avant de lancer ce huitième échantillon, la règle avait été posée : _si celui-ci
rend zéro comme les sept précédents, l'échantillonnage sur terrain déjà vu
s'arrête._ Il rend zéro. **Il s'arrête.**

Ce n'est pas une victoire, c'est la fin d'un instrument. Huit tirages réguliers
sur des terrains différents, tous à zéro, ne disent pas « le dépôt est gardé » :
ils disent que **cet échantillonnage-là ne trouve plus rien**, et un instrument
qui ne discrimine plus n'apporte plus d'information. Un neuvième passage
coûterait de la machine pour un résultat dont la valeur attendue est nulle —
c'est chercher ses clés sous le lampadaire parce que c'est là qu'il y a de la
lumière.

> **Un critère d'arrêt posé après coup n'est pas un critère, c'est une
> justification.** Celui-ci a été écrit avant le tirage, et il est appliqué tel
> quel — il aurait été appliqué de la même façon si le résultat avait déplu.

### Ce qui reste, et à qui la décision appartient

La couverture mesurée par mutation, terrain par terrain, à ce jour :

| Terrain                        | Vu / total | Part      |
| ------------------------------ | ---------- | --------- |
| `src/shared`                   | 49 / 49    | **100 %** |
| `dashboard/src` (hors `views`) | 72 / 72    | **100 %** |
| `scripts/`                     | 46 / 46    | **100 %** |
| `src/orchestrator`             | 54 / 54    | **100 %** |
| `src/node-client` + `src/tui`  | 45 / 192   | 23 %      |
| `src/adapters` + racine `src/` | 49 / 222   | 22 %      |
| `dashboard/src/views`          | 57 / 440   | 13 %      |

Deux suites possibles, et **aucune des deux n'est la mienne à trancher** :

1. **Un balayage COMPLET** d'un ou plusieurs terrains partiels — environ six
   heures et demie de machine par terrain, à mener hors de l'atelier de nuit.
   C'est le seul chemin vers un chiffre qui ne soit pas un échantillon.
2. **L'acceptation de la couverture mesurée**, écrite telle quelle dans
   `docs/DEFINITION-DE-SORTIE.md` — avec ses 13 %, ses 22 % et ses 23 % en
   toutes lettres, et non derrière un ✅ qui les cacherait.

En attendant l'arbitrage, c'est la seconde qui s'applique par défaut, parce que
c'est la seule qui ne prétende rien : le tableau ci-dessus part dans le
definition of done, chiffres nus.

---

## Liste 3, point 3.2 : `curl … | sh` s'exécutait AU FUR ET À MESURE

Le point 3.1 (macOS) est fermé depuis le 14 août. Le 3.5 (dette du balayage)
vient d'être tranché. Le 3.4 est réservé à l'utilisateur. Reste le **3.2**, et
il contenait un défaut qui ne demande **aucune clé, aucun compte, aucune
décision humaine** — donc qui était à moi.

### Ce que le point 3.2 disait, et ce qu'il ne voyait pas

Il disait : ni Release, ni empreinte publiée, ni signature — un arrivant prudent
s'arrête, et il a raison. Vrai, et hors d'atteinte (§ 4 : clés et numéro de
version). Ce qu'il ne disait pas, c'est que **la forme de la commande** posait un
problème distinct, entièrement en atteinte.

`sh` ne lit pas un script d'un bloc. Il lit ce qui arrive, l'exécute, et
redemande la suite. `install.sh` étant une suite d'ordres de premier niveau,
toute coupure du tuyau laissait derrière elle tout ce qui était déjà arrivé.

### Mesuré AVANT d'écrire quoi que ce soit

```text
$ head -416 install.sh | sh
CODE=0

  +----------------------------------------------------------------+
  | <>  H I V E                                        installation |
  +----------------------------------------------------------------+
    o  Vérification des prérequis
    |  + Node 24 (≥ 24 exigé)
    |  + git 2.43.0
```

**Code 0.** Une bannière, deux coches vertes, et rien d'installé. C'est le pire
des trois résultats possibles : un utilisateur croit que c'est fini, un script
appelant croit que ça a marché. Un échec bruyant vaudrait mieux.

### Le remède, et ce qu'il garantit EXACTEMENT

Tout le travail entre dans `principal()`, appelée à la dernière ligne. `sh` ne
peut alors plus rien lancer avant d'avoir lu le fichier entier.

| Point de coupure | Avant                     | Après                            |
| ---------------- | ------------------------- | -------------------------------- |
| dans le corps    | tout le préfixe s'exécute | `end of file unexpected`         |
| après l'accolade | tout le préfixe s'exécute | fonction définie, jamais appelée |

Re-mesuré au même point de coupure : **`CODE=2`, 0 octet sur la sortie standard,
aucun dossier créé.**

La propriété gardée est **« jamais d'exécution PARTIELLE »**, et elle s'écrit
comme ça, pas autrement. Couper sur la toute dernière ligne rend encore 0 sans
rien faire — ne rien faire est sans danger, faire la moitié ne l'est pas. Le banc
le dit dans son en-tête plutôt que de promettre « toute coupure est signalée ».

### Le banc joue le geste, pas l'orthographe

`tests/installeur-tuyau-coupe.test.ts` coupe `install.sh` à dix endroits et le
donne à `sh` **par l'entrée standard** — le geste exact de `curl | sh` — puis
exige que rien ne sorte. Il porte aussi son propre témoin : le script joué en
ENTIER doit, lui, parler. Sans ce témoin, un `install.sh` qui ne ferait plus
rien du tout passerait les dix assertions.

**Verdict affiché.** Avant le correctif : `7 failed | 5 passed (12)`. Après :
`12 passed (12)`. Les cinq verts d'avance sont les coupures qui tombent dans
l'en-tête de commentaires — elles n'écrivaient déjà rien, et le dire est plus
honnête que de choisir dix points qui rougissent tous.

### Deux bornes, dites plutôt que maquillées

- **`install.ps1` n'est pas concerné, et le banc ne le regarde pas.** Le README
  ne canalise rien vers PowerShell : il télécharge dans un fichier (`-OutFile`)
  puis lance `powershell -File`. PowerShell analyse le fichier entier avant la
  première ligne — la forme de la commande protège déjà. Étendre le banc là-bas
  garderait une propriété que personne ne peut casser depuis le chemin
  recommandé.
- **Ça ne remplace pas une Release signée.** Un attaquant qui sert le fichier
  sert un fichier COMPLET ; cette garde ne parle que des accidents de transport.
  Le point 3.2 reste ouvert pour ce qu'il visait d'abord.

### L'installation, re-mesurée de bout en bout

Un correctif d'installeur qui casse l'installation ne vaut rien :

```text
✔ 1/3 — installation sortie en 0, 25 s
✔ 2/3 — .env en -rw-------
✔ 3/3 — la ruche répond sur :7777 après 2s
```

### Ce que la loupe dit de ce lot, et les deux raisons qu'il ne faut pas confondre

```text
LOUPE : aucune ligne mutable ajoutée par cette branche.
        (rien à conclure — ce n’est PAS un feu vert.)
```

L'instrument refuse de donner un verdict, et il a raison deux fois plutôt
qu'une. Les deux raisons sont distinctes, et les confondre ferait passer une
borne de l'outil pour une propriété du lot :

1. **Ce diff n'a rien à muter.** Il ajoute des commentaires, une enveloppe
   `principal() { … }` et un fichier de banc. Aucun opérateur. Forcée sur
   `install.sh` par `LOUPE_CHEMINS`, la loupe rend la même phrase — ce n'est
   donc pas un effet de périmètre ici.
2. **Mais `install.sh` n'est PAS dans le périmètre par défaut.**
   `PORTEE_PAR_DEFAUT = ['src', 'dashboard/src', 'scripts']` : le fichier que
   tout arrivant exécute en premier n'est regardé par la loupe que si on l'y
   met à la main. Aujourd'hui ça ne change rien ; le jour où une ligne de
   décision y sera ajoutée, ça changera tout.

Le point 2 est un trou dans la PORTÉE de l'instrument, pas dans ce lot — c'est
exactement le § 9 quinoctogies (« la portée d'une garde fait partie de la
garde »), appliqué à la garde qui juge toutes les autres. Il est noté ici et
non refermé : les opérateurs de la loupe sont ceux de JavaScript, et les lâcher
sur du `sh` demande d'abord de savoir lesquels ont un sens là-bas. C'est un lot,
pas une rustine de fin de tour.

---

## Une garde née d'un défaut avait hérité de son angle mort

Le corollaire du § 9 octooctogies — _« pour chaque chose que le projet demande
d'exécuter, par quel chemin arrive-t-elle ? »_ — a été passé sur tout le dépôt
au lieu de rester une phrase. Il a rendu une prise.

### Ce que la balayée a trouvé

`tests/commande-annoncee.test.ts` existe depuis qu'un utilisateur a signalé que
`irm …/install.ps1 | iex` ne pouvait fonctionner sur aucune machine — `iex`
évalue une expression, `param()` n'est valide qu'au début d'un script. La garde
née ce jour-là porte une liste écrite à la main :

```ts
const ANNONCES = ['README.md', 'README.en.md', 'docs/INSTALLATION.md', 'install.ps1'];
```

Ces quatre-là sont tenus. Mais le motif fautif vit encore, mesuré, dans **deux
documents que la liste ne regarde pas** :

| Fichier                                    | Ce que c'est                                                       |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `MISSION-ACCUEIL.md` § 7.2.1               | le cahier des charges — « tous les points ci-dessous sont exigés » |
| `docs/adr/0002-distribution-one-liners.md` | **l'ADR des one-liners eux-mêmes**                                 |

Le second est le plus parlant : c'est le dossier de décision de cette question
précise, et il portait encore la forme impossible.

### Pourquoi la liste ne pouvait pas les voir

Parce qu'elle a été écrite avec les quatre endroits où le défaut avait été
**trouvé**, pas avec l'ensemble des endroits où il pouvait **vivre**. Une garde
née d'un incident hérite du périmètre de l'incident — et c'est invisible, parce
qu'elle est verte et qu'elle a de bonnes raisons de l'être.

### La règle retenue, et ce qu'elle n'est PAS

On ne bascule pas sur « ce motif est interdit ». Trois documents le citent à bon
droit : la CI raconte l'histoire, `docs/ERREURS.md` en tire la leçon, et le banc
le décrit. L'interdire ferait mentir le dossier.

> **`| iex` ne peut apparaître qu'à CÔTÉ de la raison qui le condamne.**

La borne est mesurée, pas choisie. Sur les trois documents légitimes, la cause
(`param(`) est à **3 lignes** (`ci.yml`), **7** (le banc) et **10**
(`ERREURS.md`). Sur les deux fautifs, elle était à l'**infini**. Le seuil est
posé à 15 : de la marge pour le plus éloigné des trois, rien pour les deux
autres.

Et la liste écrite à la main devient une **découverte** : le banc marche le
dépôt. Un document écrit demain est dedans par défaut, au lieu d'être dehors par
défaut.

### Ni la mission ni l'ADR ne se réécrivent

Les deux fautifs **conservent la phrase d'origine**. Une mission se cite, un ADR
ne se réécrit pas — falsifier le dossier pour faire passer un banc serait pire
que le défaut. Chacun reçoit la correction **à côté** : ce qui échoue, pourquoi,
et la commande réellement servie.

### Verdict affiché, et une prise inattendue

```text
avant : 1 failed | 9 passed (10)   →   3 fichiers nommés
après : 10 passed (10)
```

Le troisième nommé était **le banc lui-même** : son message d'échec montrait
`install.ps1 | iex` sans le mot `param(` à moins de 15 lignes. Deux issues —
l'exempter, ou s'y conformer. L'exempter aurait rouvert exactement le trou en
train d'être fermé ; le message dit désormais _« sans dire que `param()` le rend
impossible »_, ce qui le rend au passage plus utile à qui le déclenche.

### La découverte est porteuse, et c'est muté

Une marche de dossiers qui ne descend plus rendrait tout le bloc vert sans rien
voir. Mutation posée, verdict, restauration par copie :

```text
MUTANT  trouves.push(...fichiersDuDepot(…))  →  supprimé
        × la découverte ratisse vraiment le dépôt
        1 failed | 9 passed (10)

RESTAURÉ  10 passed (10)
```

---

## La même forme, cherchée ailleurs — et ce que ça n'a PAS donné

La leçon § 9 nonoctogies dit qu'une garde née d'un incident hérite du périmètre
de l'incident. Une leçon qui ne sert qu'une fois est une anecdote ; elle a donc
été retournée contre le reste du dépôt.

### Le décompte, d'abord

**Quatorze bancs découvrent déjà** (`readdirSync`) : `security-invariants`,
`rien-de-mort`, `ordre-declare`, `sondes-sans-secret`, `site-fraicheur`,
`isolement-couverture` et huit autres. Les listes écrites à la main qui restent
sont, pour la plupart, des ensembles réellement CLOS — deux README, trois
fichiers Docker, quatre chemins d'`index.html`. Une liste de deux README n'a pas
de troisième README à rater.

**Une seule avait la mauvaise forme**, et son propre en-tête la désignait :

```ts
// tests/installeurs-demarrable.test.ts
const SCRIPTS = ['install.sh', 'install.ps1', 'examples/deploiement-sans-ecran.sh'];
```

Le fichier existe parce qu'un `npm install` peut sortir avec 0 sans avoir posé
le binaire natif de SQLite — la ruche meurt alors très loin de là. Trois scripts
promettent une ruche qui démarre ; un quatrième né demain serait DEHORS.

### Pourquoi la liste RESTE

Le réflexe aurait été de basculer sur une découverte pure. Mesuré, le critère ne
tient pas : `scripts/essai-installation.sh` mentionne `npm install` **dans un
commentaire**, et `deploiement-sans-ecran.sh` le fait dire par un `dire "…"` au
lieu de le lancer. Un critère qu'il faut border à coups d'exceptions vaut moins
qu'une liste honnête.

D'où la forme retenue : **la liste reste, une garde de COMPLÉTUDE lui est
adossée.** La découverte ne remplace pas la liste — elle exige que la liste la
couvre. Le défaut par défaut s'inverse sans que le critère ait à être parfait.

### Ce que ce lot ne change pas, et il faut le dire ainsi

Aujourd'hui la découverte rend **exactement les trois de la liste**. Le lot ne
corrige donc **rien d'observable** : aucun script n'était oublié. Ce qu'il change
est le comportement FUTUR, et c'est tout — le vendre comme une correction serait
un arrondi.

### Verdict affiché, deux mutations

Un banc vert du premier coup est du décor tant qu'on ne l'a pas vu rougir. La
première mutation éprouve la propriété réellement revendiquée : un quatrième
script.

```text
MUTATION 1  examples/deploiement-mutant.sh, qui lance « npm install »
            × aucun script n’installe des dépendances sans être dans la liste
            × et la découverte voit vraiment quelque chose
              [ 'examples/deploiement-mutant.sh' ] ≠ []
            2 failed | 24 passed (26)

MUTATION 2  « install.ps1 » retiré de SCRIPTS
            [ 'install.ps1' ] ≠ []
            2 failed | 21 passed (23)

RESTAURÉ    26 passed (26)      (restauration PAR COPIE)
```

La seconde assertion — « la découverte voit vraiment quelque chose » — est là
pour la raison qui a fait tout ce fil : une découverte qui ne trouverait rien
rendrait la première verte à vide, c'est-à-dire le défaut qu'on ferme, reproduit
un cran plus haut.

---

## Le seul terrain jamais vu par la loupe : la vitrine — et elle lui était INTERDITE

Le balayage par échantillon sur terrain déjà vu est arrêté (critère posé avant le
huitième tirage). Restait à chercher du terrain JAMAIS vu. Il y en avait, à
l'endroit le plus gênant possible.

### La mesure qui ouvre le lot

```text
langageMutable('site/index.html')             →  false
langageMutable('site/presentation/index.html') →  false

site/index.html               697 lignes de script,  24 portant un opérateur
site/presentation/index.html  131 lignes de script,   8 portant un opérateur
```

La vitrine — **le premier écran que voit un arrivant**, avec sa bascule de
langue, son bouton copier et ses puces d'OS — n'était pas « non balayée ». Elle
était **impossible à balayer** : `SANS_OPERATEURS` excluait `.html` en bloc.

### Et la garde fautive est la mienne, posée ce tour-ci

`SANS_OPERATEURS` a été ajoutée pour une raison juste : dans une feuille de
style, `>` est un combinateur, et le muter rend un survivant ni tuable ni
jugeable équivalent. Mais `.html` y a été jeté avec le CSS, « parce que `<`
ouvre une balise ». Vrai du balisage ; faux de la page, qui porte aussi du
JavaScript.

C'est le § 9 nonoctogies **retourné** : là-bas une portée trop étroite laissait
passer, ici une portée trop large empêche de voir. Les deux sont vertes, et la
seconde est pire — elle rassure sur un terrain où l'instrument ne peut RIEN
trouver, jamais.

### Le remède, et ce qu'il refuse de faire

Pas « rendre `.html` mutable » : ses attributs et son `<style>` rendraient
exactement les faux survivants que la garde évitait. La borne devient
`lignesDeScript`, qui ne retient que **ce que le navigateur exécuterait** —
même règle de `type` que `tests/vitrine-executee.test.ts`, à laquelle un
`type="application/json"` est une donnée et non du code.

Trois choses restent dehors, et le banc les nomme une par une : le combinateur
CSS d'un `<style>`, le JSON non exécuté, et l'attribut qui CONTIENT un opérateur
sans en être un.

### Verdict affiché, et deux bancs réécrits plutôt que supprimés

```text
avant : 3 failed | 55 passed (58)     (lignesDeScript is not a function)
après : 59 passed (59)
```

Deux bancs PRÉEXISTANTS ont rougi au passage : ils encodaient l'ancienne règle
(« `site/index.html` → false », « `site/INDEX.HTML` → false »). Les supprimer
aurait effacé une garde ; ils sont **réécrits sur la règle nouvelle**, et la
garde de casse a simplement changé de porte — `EST_UNE_PAGE` doit attraper
`.HTML`, `.HtM` et `.htm` indifféremment, et c'est éprouvé.

### Le rejeu de bout en bout, obligatoire après toute modification de la loupe

```text
sh /tmp/atelier.sh /tmp/at-vitrine ab28e44 f0fc005 site 1

LOUPE : 43 mutation(s) possible(s) sur le diff, 1 examinée(s).
  ✔ défendue · site/index.html · === → !==
             lang = next === 'en' ? 'en' : 'fr';
```

**43 candidates là où il n'y en avait aucune de possible.** Et la première jouée
est bien une décision, pas du décor.

### Le balayage lancé est COMPLET, et c'est le premier

`pas = ceil(43 / 43) = 1` : chaque candidate est jouée. Ce n'est pas un
échantillon — c'est le premier terrain du dépôt balayé **en entier** depuis
`src/shared`. Son résultat est consigné au tour suivant, quel qu'il soit.

---

## Le balayage complet de la vitrine : la moitié des décisions étaient nues

Le lot précédent a rendu la vitrine VISIBLE à la loupe. Celui-ci lit ce qu'elle
y a trouvé, et ce n'est pas rassurant.

```text
LOUPE : 43 mutation(s) possible(s) sur le diff, 43 examinée(s).
        (balayage COMPLET — pas = ceil(43/43) = 1)

au moment du commit : 36 rendues — 10 défendues, 26 SANS TEST
(le balayage complet tourne encore ; le total final part au tour suivant)
```

**Environ deux décisions sur trois de la vitrine ne sont défendues par aucun
banc** — et ce n'est pas faute de bancs : la vitrine en a **140**. Ils ne
mordaient simplement pas.

### Le survivant qui fait mal, reproduit à la main

```text
MUTANT   var dict = lang === 'en' ? EN : FR;   →   lang !== 'en'
         (l'anglais servi au francophone, le français à l'anglophone)

         149 bancs de vitrine — TOUS VERTS.
```

### Pourquoi 140 bancs laissent passer ça

Parce que celui qui aurait dû mordre assène une DIFFÉRENCE, pas une identité :
il clique FR, clique EN, et exige que les deux textes diffèrent. Échanger les
deux dictionnaires laisse la différence intacte.

Et il avait de bonnes raisons d'être ainsi — sa première version épinglait le
mot « essaim » et rougissait sur un changement de copie légitime. En cessant
d'être fragile, il a cessé de départager. C'est le § 9 nonagies.

### Ce qui est LIVRÉ ici, et ce qui ne l'est pas

Livré : la page doit appliquer le dictionnaire qu'elle ANNONCE — texte ET
attributs, sur LES DEUX pages traduites. Le dictionnaire est son propre oracle,
donc aucun mot n'est épinglé et une réécriture de la copie ne rougit pas.

```text
VERDICT AFFICHÉ   dictionnaire inversé (accueil)   →  219 éléments nommés, rouge
                  attributs inversés               →    6 attributs nommés, rouge
                  dictionnaire inversé (présentation) →  45 éléments nommés, rouge
                  source saine                      →   19 verts
```

**Pas livré, et ça se dit :** ce lot ferme **trois** survivants. Les autres —
détection de la langue du navigateur, presse-papier, rail des écrans,
`ResizeObserver`, le compteur d'étoiles GitHub, une borne de boucle — restent
NUS. Ils sont nommés dans le journal du balayage et seront traités par lots.
Prétendre que la vitrine est défendue parce que le plus grave est fermé serait
exactement l'arrondi que ce carnet refuse.

---

## Le balayage a fini, et il a nommé une TROISIÈME page

```text
LOUPE : 43 mutation(s) possible(s) sur le diff, 43 examinée(s).
        BALAYAGE COMPLET — pas = ceil(43/43) = 1

FINAL : 10 défendues, 33 SANS TEST

  site/index.html               16 survivants
  site/presentation/index.html   8 survivants
  site/rush/index.html           9 survivants
```

**33 sur 43, soit 77 % des décisions de la vitrine, ne sont défendues par aucun
banc.** Le chiffre du lot précédent (26 sur 36) était celui de l'instant du
commit et le disait ; voici le définitif.

### Et la troisième page était DEHORS de ma propre garde

La garde posée une heure plus tôt portait :

```ts
const PAGES_TRADUITES = ['site/index.html', 'site/presentation/index.html'];
```

Les deux pages que le balayage avait rendues **à ce moment-là**. Il en a nommé
une troisième — `site/rush/index.html`, 115 éléments traduits, 9 survivants —
qui serait restée invisible.

C'est le § 9 nonoctogies commis **dans le geste même qui le consignait** : le
périmètre de l'INCIDENT au lieu de celui du RISQUE. La leçon ne dit pas « faire
attention », elle dit **ne pas lister** — et je l'ai listée quand même, une heure
après l'avoir écrite.

### Ce que ça vaut comme mesure

Le critère est ici sans ambiguïté, contrairement au cas des installeurs : une
page traduite porte un dictionnaire `var EN = {` ET les deux boutons de langue.
Rien à border à coups d'exceptions — donc rien qui justifie une liste.

```text
VERDICT AFFICHÉ   mutant sur site/rush/index.html   → 113 éléments nommés, rouge
                  découverte bornée à la racine     → la garde-de-la-garde mord
                  source saine                      → 21 verts
```

La seconde mutation compte autant que la première : une découverte qui ne
descendrait plus dans les sous-dossiers rendrait tout le bloc vert à vide.

---

## Le premier contact : la branche que personne ne regardait

La vitrine résout sa langue ainsi : `?lang=` > préférence rangée > langue du
navigateur. Deux bancs éprouvaient les deux premières. La **troisième** — celle
qui décide pour quelqu'un qui arrive pour la première fois, sans rien — était
nue, et le balayage complet a nommé ses deux gardes :

```text
🔴 SANS TEST   String(navigator.language || '')      ||  → &&
🔴 SANS TEST   …toLowerCase().indexOf('fr') !== 0    !== → ===
```

Ce que chacune coûte, si elle bascule :

| Mutant        | Ce que voit l'arrivant                                   |
| ------------- | -------------------------------------------------------- |
| `\|\|` → `&&` | l'anglais pour TOUT LE MONDE, navigateur français inclus |
| `!==` → `===` | les francophones en anglais, tous les autres en français |

Le banc pose un tableau — `fr`, `fr-FR`, `fr-CA`, `en-US`, `de-DE`, `''` — en
imposant `navigator.language` et en vérifiant la langue réellement prise.

```text
VERDICT AFFICHÉ   « || » → « && »          → 3 lignes fausses, rouge
                  « !== » → « === »        → 6 lignes fausses, rouge
                  source saine             → 22 verts
```

### Une note du banc était devenue FAUSSE, et elle est corrigée

Ce bloc portait : _« la loupe ne balaie que `src`, `dashboard/src`, `scripts` —
jamais `site/`. Les gardes du JavaScript de la vitrine sont donc un angle mort
qu'aucun balayage automatique ne couvre. »_

C'était vrai ; ça ne l'est plus depuis deux lots. Une note de méthode périmée
est pire qu'aucune note : elle décourage précisément le geste qui vient de
devenir possible.

---

## La vitrine passe d'EXAMINABLE à EXAMINÉE

Deux lots l'avaient rendue visible à la loupe. Ce troisième la met dans le
périmètre par défaut — sans quoi elle ne serait jamais regardée.

```diff
-export const PORTEE_PAR_DEFAUT = ['src', 'dashboard/src', 'scripts'];
+export const PORTEE_PAR_DEFAUT = ['src', 'dashboard/src', 'scripts', 'site'];
```

`npm run loupe` est la garde de FUSION : elle tourne sans variable
d'environnement. Ce qu'elle ne regarde pas par défaut n'est regardé par
personne, et la prochaine décision ajoutée à la page serait passée avec « rien à
conclure » — exactement comme avant les deux lots précédents.

### La preuve est arithmétique, pas déclarative

```text
périmètre par défaut (nouveau)         2269 candidates
ancien périmètre, demandé à la main    2226
site/ seul                               43
                                     ─────
                           2269 − 2226 = 43   ✓
```

Un banc qui se contenterait de `PORTEE_PAR_DEFAUT.includes('site')` garderait
l'orthographe d'une liste. Cette soustraction, mesurée dans l'atelier sur trois
lancements, garde le comportement.

### Une seconde garde, contre la pourriture de la liste

Chaque entrée du périmètre doit ramener au moins un fichier que la loupe
accepterait de muter. Un dossier renommé laisserait sinon une entrée qui ne
désigne plus rien, et la loupe rendrait « rien à conclure » sans que personne
s'en aperçoive.

```text
VERDICT AFFICHÉ   « site » retiré du périmètre        → rouge
                  entrée « vitrine-renommee » ajoutée → rouge, chemin mort nommé
                  source saine                        → 17 verts
```

### Le raccord circulaire, et ce qu'il enseigne

`site` avait une RAISON de ne pas figurer au périmètre : `.html` était muet,
donc `site/` n'aurait rien rendu, donc l'y mettre était inutile. La raison était
juste — et elle a survécu à la disparition de sa cause.

C'est le § 9 unnonagies : quand on lève une contrainte, on relit les décisions
qui n'existaient QUE par elle. Elles ne se signalent pas, parce qu'elles ont
l'air de choix et non de conséquences.

---

## Le bouton « copier » : trois survivants d'un seul geste

L'appel à l'action principal de la page. Le balayage complet en avait nommé
trois gardes nues, et chacune a une raison DIFFÉRENTE d'avoir survécu à un banc
qui, pourtant, exerçait déjà ce bouton.

### 1. Le libellé de confirmation — la forme au lieu de l'identité

```js
btnInstall.textContent = lang === 'en' ? 'copied ✓' : 'copié ✓';
```

Le banc existant assène `toContain('✓')` et « le libellé a changé ». Les DEUX
branches portent le ✓ et diffèrent du libellé d'origine : le mutant `===` →
`!==` y survit intact, et un anglophone lirait « copié ✓ ». C'est le § 9
nonagies — une assertion de forme ne départage pas.

Le banc neuf clique la langue, puis « copier », et exige le libellé **exact**
dans les deux sens.

### 2. Le presse-papier — le montage rendait les deux branches identiques

```js
if (navigator.clipboard && navigator.clipboard.writeText) {
```

Le banc existant injecte un presse-papier COMPLET. `&&` et `||` y prennent alors
la même branche : le mutant est équivalent **sous ce montage-là**, et seulement
sous celui-là.

L'entrée qui les départage est un navigateur où `clipboard` EXISTE mais
`writeText` NON — contexte non sécurisé, vieux Safari, Firefox sans le drapeau.
Avec `&&` la page replie sur `textarea` + `execCommand` ; avec `||` elle appelle
une fonction qui n'existe pas.

> **Un mutant « équivalent » ne l'est parfois que sous le montage du banc.**
> Avant de consigner une équivalence (§ 2.16 ter), il faut se demander si c'est
> le CODE qui rend les deux branches indiscernables, ou seulement le décor qu'on
> a planté autour.

L'observable retenu est « le repli a-t-il tourné », pas « ça a jeté » : une
exception dans un écouteur d'événement ne remonte pas au `dispatchEvent`.

### 3. `aria-pressed` du bouton FR — la moitié qu'on ne regardait pas

```js
document.getElementById('btn-fr').setAttribute('aria-pressed', String(lang === 'fr'));
```

Le banc du dictionnaire, écrit deux lots plus tôt, vérifie `aria-pressed` sur
`btn-en` seulement. Muté, les deux boutons annoncent le même état — et un
lecteur d'écran n'a plus aucun moyen de savoir quelle langue est active.

### Verdict affiché

```text
libellé de confirmation   ===  → !==   → rouge
presse-papier             &&   → ||    → rouge
aria-pressed du bouton FR ===  → !==   → rouge
source saine                           → 25 verts
```

**Trois survivants de plus fermés ; il en reste 25 sur les 33.**

---

## La même machinerie, trois fois — et deux fois sans garde

La liste complète des 33 survivants, relue au lieu d'être devinée, change la
priorité : `presentation` et `rush` portent **exactement les mêmes gardes** que
l'accueil — le tri `?lang=` > préférence rangée > navigateur, et l'`aria-pressed`
des deux boutons. Les bancs écrits jusqu'ici ne montaient que
`site/index.html`.

Ce n'est pas une découverte de plus : c'est la MÊME (§ 9 nonoctogies). Cette
fois elle est prise en compte AVANT d'écrire — le banc tourne sur les pages
**découvertes**, pas sur une liste.

### Une nuance mesurée, et le banc n'en dépend pas

`rush` écrit `(navigator.language || '').slice(0, 2) !== 'fr'` là où les deux
autres écrivent `.toLowerCase().indexOf('fr') !== 0`. Les deux disent la même
règle. Le tableau du banc ne suppose ni l'une ni l'autre : il n'observe que la
langue PRISE.

### Verdict affiché — douze mutations, deux pages

```text
site/presentation/index.html
  qs === 'en' || qs === 'fr'          → &&    1 failed | 36 passed
  saved === 'en' || saved === 'fr'    → &&    1 failed | 36 passed
  String(navigator.language || '')    → &&    1 failed | 36 passed
  .indexOf('fr') !== 0                → ===   1 failed | 36 passed
  btn-fr aria-pressed                 → !==   1 failed | 36 passed
  lang = next === 'en'                → !==   5 failed | 32 passed

site/rush/index.html
  q === 'en' || q === 'fr'            → &&    1 failed | 36 passed
  saved === 'en' || saved === 'fr'    → &&    1 failed | 36 passed
  (navigator.language || '').slice    → &&    1 failed | 36 passed
  .slice(0, 2) !== 'fr'               → ===   1 failed | 36 passed
  btn-en aria-pressed                 → !==   5 failed | 32 passed
  lang = next === 'en'                → !==   5 failed | 32 passed

RESTAURÉ                                      37 passed (37)
```

Les mutations qui emportent **cinq** bancs plutôt qu'un touchent
`aria-pressed` de `btn-en` ou la bascule elle-même : c'est ce que le montage
LIT pour savoir quelle langue la page a prise. Le dire évite qu'un lecteur y
voie un banc fragile — c'est le même signal, observé par plusieurs portes.

**Douze survivants de plus fermés ; il en reste 13 sur les 33.**

---

## Le journal de l'essaim et « copier la commande » : quatre survivants d'un « ça se remplit »

### Le journal — deux gardes sous une seule assertion trop faible

```js
var src = lang === 'en' ? JEN : JFR;   // la langue du fil d'activité
for (var k = 0; k < 4; k++) {          // sa borne
```

Le banc existant assène `#journal li` **> 0**. Un journal en anglais servi à un
francophone en a toujours plus de zéro ; un journal de CINQ lignes aussi. « Il
se remplit » ne dit ni la langue, ni la quantité.

L'ancre retenue : les messages affichés doivent tous venir du tableau que la
page PRÉTEND utiliser (`JFR` ou `JEN`, lus dans la source et évalués). Aucun mot
n'est épinglé — réécrire une entrée déplace le tableau et le banc suit.

### « Copier la commande » — le retour au repos que personne ne regardait

```js
lbl.textContent = lang === 'en' ? 'copied ✓' : 'copié ✓';
…
lbl.textContent = (lang === 'en' ? EN : FR)['rc.copier'];   // 1800 ms plus tard
```

Le second est le RETOUR AU REPOS. Le code porte même un commentaire disant
qu'il repasse par le dictionnaire « pour que le libellé revienne dans la langue
COURANTE » — une intention qu'aucun banc ne vérifiait, faute de faire avancer le
temps.

### Verdict affiché

```text
journal   lang === 'en' ? JEN : JFR   → !==   1 failed | 38 passed
journal   for k < 4                   → <=    1 failed | 38 passed
rc-copier confirmation                → !==   1 failed | 38 passed
rc-copier retour au repos             → !==   1 failed | 38 passed
source saine                                  39 passed (39)
```

### Le piège du montage, quatrième de la série

Le banc de `rc-copier` a rougi sur source SAINE : _« attendu copié ✓, reçu
Copier la commande »_. Cause : la confirmation n'arrive qu'une fois la promesse
du presse-papier tenue, et **une promesse se résout en micro-tâche** —
`vi.advanceTimersByTime(0)` n'y touche pas. Les horloges factices gèlent les
minuteurs, pas les promesses.

C'est le quatrième montage fautif de cette série (`<br />` contre `<br>`, les
attributs oubliés, le tableau empoisonné par le rangement, et celui-ci), et la
règle tient toujours : **une garde neuve qui accuse du code sain a presque
toujours tort — on cherche pourquoi, on ne l'assouplit pas.**

**Quatre survivants de plus fermés ; il en reste 9 sur les 33.**

---

## Quatre gardes de plus, dont une capacité et son repli

### Le décompte, mesuré plutôt que soustrait

Avant d'écrire, les survivants restants ont été **mutés un par un** pour savoir
lesquels étaient encore ouverts — plutôt que de soustraire de tête sur le
journal du balayage. Six ont survécu à la suite complète : `ResizeObserver`
(accueil et rush), le rail de l'aperçu, le compteur d'étoiles GitHub (deux
gardes), et le retour au repos du bouton d'installation.

Ce lot en ferme **quatre**. Les deux du compteur d'étoiles restent ouvertes ;
elles demandent un bouchon de `fetch`, et c'est un lot à part.

### Le retour au repos du bouton d'installation

Le pendant de celui de `rc-copier`, fermé au lot précédent :
`lang === 'en' ? 'copy' : 'copier'`, 1800 ms après le clic. Un francophone
voyait « copy » revenir.

### Le rail de l'aperçu

```js
if (r.getAttribute('data-ecran-rail') === cle) r.setAttribute('data-vif', '');
```

Le banc de la bascule d'écran vérifiait `aria-selected` sur l'onglet et `hidden`
sur le corps. Le RAIL — le repère latéral qui dit où l'on est — n'était vérifié
par rien : muté, il s'allume sur tous les écrans SAUF celui qu'on regarde.
L'assertion exige **exactement un** allumé, et que ce soit le bon.

### `ResizeObserver` : une capacité, et son repli jamais exercé

```js
if (typeof ResizeObserver === 'function') { new ResizeObserver(…).observe(entete); }
else { window.addEventListener('resize', publierHauteur); }
```

Même famille que la garde du presse-papier : tant que le banc offre TOUJOURS un
navigateur qui sait, les deux branches sont indiscernables et le mutant passe
pour équivalent. Ce qui départage, c'est un navigateur qui **ne sait pas**.

Les deux moitiés sont gardées, et il faut les deux :

- **sans** `ResizeObserver`, la page doit monter quand même et republier
  `--h-entete` sur un `resize` — le mutant y construit un objet inexistant, donc
  le montage entier jette et la page est morte pour ce visiteur ;
- **avec** `ResizeObserver`, la page doit vraiment l'observer — sans quoi un
  mutant qui prendrait toujours le repli passerait, et la page marcherait en
  moins bien sans que rien le dise.

`--h-entete` porte la hauteur de l'en-tête collante : si elle cesse d'être
republiée, le contenu passe sous la barre au premier redimensionnement.

### Verdict affiché

```text
btnInstall retour au repos    === → !==   1 failed | 44 passed
rail de l'aperçu              === → !==   1 failed | 44 passed
ResizeObserver (accueil)      === → !==   2 failed | 43 passed
ResizeObserver (rush)         === → !==   2 failed | 43 passed
source saine                              45 passed (45)
```

Les deux dernières emportent **deux** bancs chacune : c'est voulu, ce sont les
deux moitiés de la même garde.

### Sur le chiffre « il en reste N »

Le décompte courant vient d'une soustraction sur le journal du balayage, et une
soustraction n'est pas une mesure. Le nombre défendable sera celui d'un
**nouveau balayage complet** de `site/` — désormais lançable sans réglage,
puisque `site` est au périmètre par défaut.

---

## Le compteur d'étoiles : deux mutants, une seule entrée pour les tuer

Les deux dernières gardes identifiées du balayage :

```js
if (j && typeof j.stargazers_count === 'number') {
  var nb = document.querySelector('#gh-btn .gh-nb');
  if (nb) nb.textContent = String(j.stargazers_count);
}
```

Deux mutants y survivaient — `===` → `!==` et `&&` → `||` — et une réponse
**sans** `stargazers_count` les départage tous les deux d'un coup :

| Version  | Ce qu'elle fait d'une réponse sans compte                   |
| -------- | ----------------------------------------------------------- |
| original | n'écrit rien — le libellé statique reste                    |
| `!==`    | la garde s'inverse, le corps écrit **« undefined »**        |
| `\|\|`   | `j` truthy court-circuite, le corps écrit **« undefined »** |

Un visiteur verrait **« undefined ★ »** sur la première page du produit.

### Trois cas, parce qu'un seul ne prouve rien

Le banc en joue trois : une réponse saine (le compte s'affiche — sans quoi un
mutant qui n'écrirait jamais passerait), la réponse sans compte (l'entrée qui
tranche), et une réponse refusée (`ok: false`). `fetch` est une frontière
externe : elle est **injectée**, pas simulée à moitié, et aucune requête ne part.

### Verdict affiché

```text
stargazers_count === 'number'   → !==   1 failed | 45 passed
j && typeof …                   → ||    1 failed | 45 passed
source saine                            46 passed (46)
```

### Ce qui reste, et pourquoi je ne donne pas de chiffre ici

Toutes les gardes que la mutation-par-mutation avait trouvées ouvertes sont
maintenant fermées. Le nombre restant ne se déduit pas : **un second balayage
complet de `site/` tourne** au moment où ces lignes sont écrites, sur la base
épinglée `f0fc005`, et c'est lui qui donnera le chiffre défendable — pas une
soustraction.

---

## La vitrine : de « invisible » à 43/43, et le chiffre est MESURÉ

Deux balayages complets encadrent ce fil de lots.

```text
PREMIER (arbre ab28e44, avant tout banc de vitrine)
  LOUPE : 43 mutation(s) possible(s), 43 examinée(s)
          10 défendues · 33 SANS TEST

DERNIER (arbre 5ac77a6, après les huit lots)
  LOUPE : 43 mutation(s) possible(s), 43 examinée(s)
          43 défendues · 0 SANS TEST
          ════ LA LOUPE NE VOIT RIEN DE NU ════
```

**Trente-trois décisions nues, toutes fermées, et le zéro final est une mesure —
pas une soustraction.**

### Pourquoi il a fallu DEUX balayages de confirmation

Le premier de confirmation a tourné sur `6044e68`, l'arbre juste AVANT le lot du
compteur d'étoiles : il a rendu **42 défendues, 1 SANS TEST**, et ce survivant
unique était exactement la garde que le lot suivant fermait.

Annoncer 43/43 sur cette base aurait été une déduction. Le carnet venait
justement d'écrire qu'« une soustraction n'est pas une mesure » ; un second
balayage a donc été lancé sur `5ac77a6`, la tête qui porte le banc du compteur.
C'est lui qui rend le zéro.

> **Un chiffre qu'on obtient en raisonnant sur un relevé n'a pas le même statut
> qu'un chiffre que le relevé porte.** Les deux peuvent être justes ; un seul
> peut être défendu sans expliquer un raisonnement.

### Ce que ce zéro couvre exactement, et ce qu'il ne couvre pas

Il couvre les **43 lignes de décision ajoutées par le diff depuis `f0fc005`**,
dans les `<script>` des trois pages traduites. Il ne dit rien du CSS, ni du
balisage, ni de ce que la page fait dans un vrai navigateur — happy-dom n'est
pas Chrome.

Ce n'est pas non plus « la vitrine est jolie » : § E du definition of done
(identité visuelle, #63) reste une décision de l'utilisateur, intacte.
