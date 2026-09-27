# ADR 0012 — Une seule Reine par base, et c'est le système qui la tient

- **Statut** : accepté (décision du propriétaire : interdire deux Reines sur une
  base par un verrou posé à côté d'elle, ET rendre les réclamations de tâches
  conditionnelles, en défense en profondeur)
- **Date** : 2026-09-27
- **Concerne** : `src/orchestrator/verrou-reine.ts`, `store.ts`
  (`reclamerTache`, réglages de la base), `scheduler.ts`, `server.ts`

## Contexte

L'ordonnanceur est écrit pour un **écrivain unique**. Il lit une tâche, décide,
puis écrit, en plusieurs appels au store. Sous une seule Reine c'est sûr :
better-sqlite3 est synchrone, rien ne s'intercale entre la lecture et
l'écriture.

Rien n'empêchait pourtant une **seconde** Reine d'ouvrir la même base. Et la
première chose que fait une Reine au démarrage est `recoverOrphanTasks`, qui
requalifie en `ready` toute tâche `assigned`/`running` et passe tous les nœuds
`offline`. Rejoué sur `main`, la démo simulée en Reine A et
`src/orchestrator/main.ts` en Reine B, sur la même base :

```
avant la Reine B : running 1, pending 6 — nœuds ruche-alpha/ruche-beta en ligne
Reine B : « 🐝 Hive — orchestrateur (Queen) en ligne »          (elle démarre)
journal : boot_recovery {"requeued":2}, 2 × task_requeued reason=boot_recovery
Reine A : « résultat de 5d811fff… écarté : tâche inconnue ou assignation périmée » (×2)
```

Les ouvrières de A ont fini ces deux tâches ; leurs résultats ont été jetés
comme périmés, et les tâches sont reparties une seconde fois.

## Options pesées

**A. Rendre chaque écriture concurrente-sûre (plusieurs Reines permises).**
Des `UPDATE … WHERE` partout ne suffisent pas : la récupération du démarrage
devrait distinguer SES orphelines des travaux en vol d'une autre Reine, donc un
bail par tâche et par Reine, donc une refonte de l'ordonnanceur et du protocole
des nœuds. Écarté : aucun besoin produit ne demande deux Reines sur une base.

**B. Un fichier de pid, jugé « périmé si… ».** La première version de ce lot :
`{ pid, hôte, démarrage }` créé en exclusif, et repris quand on pouvait
« prouver » la mort du tenant (même hôte et pid disparu, pid égal au nôtre ou à
celui du parent, `boot_id` différent). Deux relectures indépendantes l'ont
démonté sur le code :

- hors Linux, l'instant de démarrage se déduit de l'horloge
  (`maintenant − os.uptime()`) : un recalage de plus de deux minutes faisait
  passer une Reine **vivante** pour redémarrée, et la seconde lui volait ses
  travaux — le défaut même que le verrou devait empêcher ;
- Docker : le nom d'hôte est l'id du conteneur, la Reine y est pid 1. Recréé
  après un `kill` ou un OOM, le conteneur changeait de nom, le verrou était
  jugé « d'une autre machine », et la Reine refusait à chaque redémarrage
  (`restart: unless-stopped`) ;
- deux espaces de pid qui partagent un nom d'hôte (`network_mode: host`, un
  `hostname:` fixe) prenaient le pid 1 de l'autre pour le leur, ou le jugeaient
  mort faute de le voir ;
- Windows recycle vite un pid mort : un verrou orphelin refusait tant qu'un
  autre programme portait ce numéro ;
- `writeFileSync(…, { flag: 'wx' })` crée PUIS écrit : un disque plein laissait
  un verrou vide, « illisible », qui refusait jusqu'à suppression à la main.

Chaque indice ment quelque part, et le module devait deviner la mort d'un
processus que le système, lui, connaît.

**C. Un bail rafraîchi.** Le tenant réécrit le verrou toutes les N secondes ;
un verrou pas rafraîchi depuis M secondes est périmé. Plus d'hôte ni de pid à
croire, mais une horloge et un délai à la place : une Reine relancée après un
plantage attend M secondes, et une boucle d'événements bloquée plus de M
secondes (pause du ramasse-miettes, fsync lent, portable en veille) laisse
entrer une seconde Reine pendant que la première vit. Écarté.

**D. Un verrou tenu par le système, porté par SQLite.** Node n'expose ni
`flock` ni `LockFileEx`, mais better-sqlite3 est déjà là et pose ces verrous du
système pour son propre compte. Retenu.

## Décision

`<base>.reine.lock` est une toute petite base SQLite à côté de la base. La
Reine y inscrit qui elle est (pid, hôte, depuis), puis y garde une transaction
d'écriture **ouverte** (`BEGIN IMMEDIATE`) toute sa vie. Le verrou d'octets de
cette transaction (fcntl sous POSIX, LockFileEx sous Windows) appartient au
système, qui le rend quand le processus meurt, **de quelque façon qu'il
meure**. Une seconde Reine reçoit `SQLITE_BUSY` et refuse de démarrer, avec le
nom de celle qui tient la base, lu dans le fichier. Aucune horloge, aucun nom
d'hôte, aucun test de pid n'entre dans la décision.

Trois règles tiennent ce verrou, et chacune a un défaut en face :

1. **On ne supprime jamais le fichier.** Une Reine qui l'aurait ouvert juste
   avant la suppression tiendrait un verrou sur un fichier disparu, et la
   suivante en créerait un neuf : deux Reines.
2. **On ne l'ouvre jamais par `fs` dans le processus de la Reine.** Sous POSIX,
   fermer n'importe quel descripteur d'un fichier rend tous les verrous fcntl
   du processus sur lui ; mesuré, un seul `readFileSync` laissait entrer une
   seconde Reine. SQLite s'en garde pour ses propres connexions seulement.
3. **Le module retient la connexion qui tient le verrou.** better-sqlite3 ferme
   une connexion que le ramasse-miettes collecte ; un appelant qui laisserait
   tomber l'objet rendrait le verrou sans un mot.

Les réclamations `→ assigned` passent en plus par `store.reclamerTache` :
`UPDATE tasks SET status='assigned', … WHERE id = ? AND status = ? RETURNING *`,
au tick (`ready`), au départ d'une course (`ready`) et pour une relecture de
contre-expertise (`pending`). Elle n'écrit que les colonnes de la réclamation,
et ne réécrit donc jamais des `attempts` lus trop tôt.

## La revue des séquences d'écriture à plusieurs instructions

Aucune de ces séquences ne tourne dans une transaction. Leurs entrelacements
possibles :

| Séquence                         | Lit, puis écrit                                                   | Dans une Reine                                       | Entre deux Reines                                    |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `recoverOrphanTasks` (démarrage) | `tasksByStatus` → `patchTask`×N, nœuds `offline`                  | une fois, avant l'écoute                             | **vole les travaux en vol** → interdit par le verrou |
| `promotePendingTasks`            | tâches `pending` + statuts des dépendances → `patchTask`          | synchrone, sans rendre la main                       | écrasement possible → verrou                         |
| `assignReadyTasks`               | liste `ready` du début de passe → réclamation tâche par tâche     | `onAssign` rend la main au serveur entre deux tâches | **réclamation conditionnelle** (+ verrou)            |
| `startRace`                      | `getTask` (`ready`) → liste des candidats → réclamation           | synchrone                                            | **conditionnelle** (+ verrou)                        |
| contre-expertise (`server.ts`)   | `createTask` → `inscrireRelecture` → réclamation depuis `pending` | même tour synchrone                                  | **conditionnelle** (+ verrou)                        |
| `reconcileNode`                  | `getTask` → ré-adoption (`running`@nœud) ou requalification       | synchrone                                            | verrou                                               |
| `handleTaskResult`               | `getTask` + gardes → `insertResult` → `patchTask` (`attempts`+1)  | synchrone                                            | verrou                                               |

Dans une Reine, chaque séquence est synchrone. Les seules mains rendues sont
les rappels synchrones `onAssign`/`onEvent`, et `envoyerTache` ne rappelle
jamais l'ordonnanceur. Entre deux Reines, le verrou est la garantie ; les
réclamations conditionnelles sont la couche en plus.

Un plantage ENTRE deux instructions d'une séquence (par exemple entre
`insertResult` et `patchTask`) laisse la tâche `running`. La récupération du
démarrage la requalifie : le résultat est **une ré-exécution au moins une fois,
jamais une tâche perdue**.

## Les réglages de la base

Écrits dans le constructeur du store au lieu d'être hérités du build de
better-sqlite3 :

- `synchronous = FULL` — la durabilité d'abord : un COMMIT rendu est sur le
  disque. Ce n'était **pas** le réglage en marche : le build pose
  `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, et la base tombait en NORMAL dès sa
  première écriture en WAL (`docs/ERREURS.md` § 9 novemoctogicenties). Le prix
  est un fsync par COMMIT (0,02 ms → 6 ms sur disque réel) ; le schéma est donc
  posé en une transaction (une base neuve : 525 ms → 70 ms).
- `foreign_keys = ON` — déjà armé par le build (`SQLITE_DEFAULT_FOREIGN_KEYS=1`)
  depuis le premier commit ; aucune base existante ne peut donc casser. Vérifié
  sur cinq bases réelles de la démo (terminée, relancée, tuée en vol, avant et
  après ce lot) : `foreign_key_check` vide, `integrity_check` à `ok`.
- `busy_timeout = 5000` — un écrivain concurrent fait attendre au lieu de faire
  échouer.

## Conséquences

- `<base>.reine.lock` reste en place d'un démarrage à l'autre ; il figure dans
  `empreinte()`, donc dans `hive desinstaller`. Après un arrêt brutal, la Reine
  suivante démarre seule et journalise le nom de la précédente.
- Un refus de démarrer est une `RefusDemarrage` : `main.ts` imprime le texte
  seul, en code 1, sans pile de Node.
- Une base partagée entre **machines** (NFS, SMB) n'a pas de verrou fiable ;
  elle n'a pas de base fiable non plus, SQLite excluant le mode WAL sur un
  système de fichiers réseau.
- **Pas encore conditionnelles** : la promotion `pending → ready`, la
  ré-adoption et le traitement d'un résultat passent par `patchTask`. Le verrou
  les couvre ; les rendre conditionnelles touche les mêmes transitions
  terminales qu'un autre chantier en vol, et attend qu'il ait atterri.
