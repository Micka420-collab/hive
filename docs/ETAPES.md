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
