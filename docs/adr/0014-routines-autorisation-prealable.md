# ADR 0014 — Une routine budgétée vaut autorisation humaine préalable

- **Statut** : accepté (décision du propriétaire : une routine appartient au
  compte qui la crée et part avec l'autorité de ce compte ; les créneaux
  manqués se rattrapent une fois par défaut ; un déclenchement pendant que le
  travail vole encore le rejoint par défaut)
- **Date** : 2026-09-28
- **Concerne** : `src/orchestrator/routines.ts`, `cron.ts`, `server.ts`
  (routes `/api/projects/:projectId/routines…`), `store.ts` (tables
  `routines`, `routines_runs`), `dashboard/src/views/RoutinesProjet.tsx`

## Contexte

Presque tous les outils d'agents de 2026 lancent du travail sans clic : dette
nocturne, montées de dépendances, tri d'issues étiquetées, CI de `main` rouge
(analyse concurrentielle, écart G04). Hive n'agissait que si quelqu'un
cliquait.

Et c'était écrit comme une doctrine, dans le chemin de retour des livraisons
(`server.ts`) : « la ruche ne se remet pas au travail toute seule sur la foi
d'un webhook : ce serait la seule dépense qu'aucun humain n'aurait demandée ».
Ajouter des déclencheurs sans trancher ce point, c'était soit contredire la
doctrine en silence, soit ne rien livrer.

## Options pesées

**A. Garder la doctrine telle quelle.** Aucune routine. Écarté : c'est l'écart
lui-même.

**B. Un webhook générique qui lance du travail.** Le plus court à écrire, et
précisément ce que la doctrine refusait : une dépense déclenchée par un
tiers, au nom de personne. Écarté.

**C. Une routine est une autorisation préalable, rattachée à un compte.**
Quelqu'un qui répond du projet (propriétaire, administrateur, ou le jeton de
ruche sur un projet orphelin) crée la routine : ce geste AUTORISE la dépense à
l'avance. La routine part ensuite avec l'autorité de ce compte, relue à chaque
déclenchement. Retenu.

## Décision

1. **Créer, mettre en pause, supprimer une routine, régénérer sa clé : un
   RÉGLAGE** (`proprieteProjetPermise`), comme le plafond de La Balance ou le
   banc d'ombre. Un membre ajoute du travail ; il ne décide pas de ce que le
   projet dépensera sans qu'on le lui redemande. **Lancer une routine
   maintenant : un ENGAGEMENT**, comme poser une tâche à la main.
2. **La routine appartient au compte qui la crée** (`creePar` ; `null` pour le
   jeton de ruche) et **part avec son autorité**, relue à chaque
   déclenchement : compte supprimé, compte qui ne répond plus du projet,
   projet orphelin adopté — le déclenchement est rangé `refusee` et la
   routine se met en pause. Reprendre une routine ne transfère pas cette
   autorité : si son créateur ne répond plus du projet, elle se recrée.
3. **Le travail lancé est une tâche ordinaire du projet** : même file, même
   plafond, même Evaluator, même relecture croisée, même porte de livraison.
   Une routine ne fusionne jamais rien.
4. **Chaque déclenchement laisse une ligne**, même quand rien ne part :
   `lancee`, `fusionnee`, `sautee`, `manquee`, `ignoree` (hors heures, en
   pause), `refusee`.
5. **Défauts** : concurrence `coalesce_if_active` (un déclenchement pendant
   que le travail précédent vole encore le rejoint) ; rattrapage `skip_missed`
   (une Reine éteinte deux jours lance UN run pour tout le retard, et dit les
   créneaux manqués). `always_enqueue`, `skip_if_active` et
   `enqueue_missed_with_cap` (plafonné à 25) restent au choix.
6. **Le webhook ne porte jamais le jeton de ruche** : il est signé (HMAC,
   fenêtre de cinq minutes, même vérification que le webhook d'abonnement)
   avec une clé propre à la routine, remise une fois, révocable en la
   régénérant. Une livraison rejouée (même `x-hive-delivery`) ne relance pas.

## Conséquences

- La phrase de la doctrine reste vraie et gagne une précision, écrite à son
  endroit dans `server.ts` : une routine est une dépense qu'un humain a
  demandée **à l'avance**.
- Une ruche strictement locale ne reçoit pas d'appel entrant : ses routines
  utiles sont le cron et la CI rouge, qui SONDENT depuis la ruche. Le webhook
  sert les modes Cloud, tunnel ou proxy.
- `POST /api/plan` n'est pas un déclencheur : il propose un DAG et ne lance
  rien. L'Action d'exemple (`examples/github-actions/hive-dispatch.yml`)
  appelle donc le webhook d'une routine, pas cette route.
- Laissé pour plus tard, et nommé : la porte `require_external_activity` (ne
  rien lancer si le dépôt n'a pas bougé), les notes gardées d'un run à
  l'autre, une boîte « Planifié » dans Mission Control, et un budget par
  routine (G09) au-delà du plafond du projet.
