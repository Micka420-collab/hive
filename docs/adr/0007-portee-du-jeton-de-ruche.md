# ADR 0007 — Ce que le jeton de ruche ouvre, et ce qu'il ne devrait pas

**Statut : ACCEPTÉ — (a) resserrée par la propriété, avec (c) pour cible.**

L'hôte a demandé que la décision soit prise. Elle l'est, et elle est écrite ici
avec ce qu'elle coûte. La section « Les trois voies » est conservée telle
quelle : c'est le raisonnement qui a mené au choix, et le relire doit rester
possible sans reconstituer l'état d'esprit du moment.

## Le constat

Onze routes de l'espace projet se gardent par le **seul jeton de ruche**, sans
aucune règle par projet :

```
abonnement · balance · brief · conflicts · conseil · essaim
merge · merge/result · merge/run · report · tasks
```

Or le README l'écrit noir sur blanc :

> `HIVE_TOKEN` se recopie sur **chaque machine membre**.

Donc **toute abeille qui prête sa machine** peut, sur n'importe quel projet de
la ruche — privé compris, et dont elle n'est pas membre :

- lire le plan de merge, la balance, les tâches, le rapport d'avancement ;
- **créer des tâches** (`POST /tasks`) ;
- **déclencher un merge** (`POST /merge/run`), ce qui fait exécuter la commande
  de test du dépôt **sur la machine d'un autre membre**.

L'isolement par projet bâti pour Le Rayon (`peutLireCode`, refus indistinguable
de l'inexistence, deux gardes indépendantes) n'existe donc **que là**. À côté,
la même information sort par une porte qui ne demande rien de plus que d'avoir
un jour prêté sa machine.

Ce n'est pas une faille d'implémentation : chaque route fait exactement ce que
son test demande. C'est une frontière de confiance qui n'a jamais été écrite,
et deux parties du produit en ont supposé deux versions différentes.

## Ce qui a déjà été fait, et qui ne suffit pas

Les **lectures** acceptent désormais AUSSI un compte ayant affaire au projet
(`lectureProjetPermise`). C'est une **ouverture stricte** : elle supprime
l'absurdité d'un compte qui recevait 401 sur le rapport de son propre projet,
et ne retire aucune porte existante.

Elle ne touche pas au fond. Tant que la porte du jeton reste ouverte sur ces
routes, le constat ci-dessus tient mot pour mot.

`tests/lecture-projet-compte.test.ts` porte un test qui **constate** l'état
actuel et qui **échouera** le jour où quelqu'un resserre — pour que la décision
soit prise sciemment plutôt que découverte.

> _Depuis la décision ci-dessous : les écritures ont été resserrées, et ce
> constat n'a pas rougi — il ne porte que les **lectures**, restées ouvertes.
> C'est voulu, et c'est expliqué dans « Ce que ça ne fait pas »._

## Pourquoi on ne resserre pas unilatéralement

Deux usages **documentés** cassent net :

- **La CLI** ne s'authentifie que par le jeton de ruche. Elle n'a aucune notion
  de compte : `merge-run`, `tasks`, `brief`, `conseil` deviendraient
  inutilisables.
- **Le tableau de bord sans compte** est un mode annoncé (« le dashboard
  s'utilise sans compte »).

Un resserrement est donc un **changement de contrat**, pas une correction.

## Les trois voies

### (a) Resserrer les ÉCRITURES seulement

`tasks`, `brief`, `merge/run`, `conseil` exigent un compte membre du projet ;
les lectures gardent les deux portes.

- **Pour** : ferme ce qui a des conséquences (faire tourner du code sur la
  machine d'autrui, dépenser du temps-ouvrière) sans toucher au reste.
- **Contre** : la CLI perd ses commandes d'écriture tant qu'elle n'a pas de
  compte. Les lectures restent ouvertes à tout l'essaim.

### (b) Tout resserrer, et donner un compte à la CLI

La CLI se connecte (`login`) et range un JWT comme le tableau de bord.

- **Pour** : une seule règle pour tout l'espace projet, celle du Rayon.
- **Contre** : le plus de travail, et un pas de plus pour l'hôte qui scripte.

### (c) Séparer les deux rôles du jeton

Acter que `HIVE_TOKEN` est un jeton d'**opérateur** (celui qui tient le hub) et
donner aux machines membres une **clé de nœud** distincte — le mécanisme existe
déjà (billets `hive2_`, clés par nœud, révocation individuelle) mais le jeton
partagé reste accepté partout, y compris pour les anciennes invitations.

- **Pour** : corrige la cause plutôt que les symptômes ; la révocation par
  machine, déjà construite, prend enfin tout son sens.
- **Contre** : migration des ruches existantes ; il faut décider du sort du
  jeton partagé (période de grâce, refus, avertissement au démarrage).

## La décision

**Aucune des trois telle quelle : (a) resserrée par la PROPRIÉTÉ, avec (c) pour
cible et l'adoption comme chemin.**

La frontière retenue n'est pas « lire ou écrire ». C'est :

> **Ce projet vous regarde-t-il ?**

Un acte qui ENGAGE un projet — créer des tâches, découper un brief, lancer un
merge, convoquer le Conseil — exige donc l'un des deux :

- un **compte** qui a affaire au projet : propriétaire, membre, ou
  administrateur de la ruche ;
- ou que le projet n'ait **pas de propriétaire**. Il n'appartient alors qu'à la
  ruche, et le jeton de ruche _est_ la ruche.

### Pourquoi cette forme-là plutôt que (a) sèche

(a) sèche casse la CLI sur **tous** les projets. Cette version n'en casse
**aucun** de ceux que la CLI crée : `createProject` par le jeton ne pose pas
d'`ownerId`, donc ses projets restent ouverts au jeton. Le mode « tableau de
bord sans compte » vit de la même façon.

Ce qui se ferme, ce sont les projets **qui appartiennent à un compte** — et
c'était très exactement le constat : une abeille qui a reçu `HIVE_TOKEN` parce
qu'elle prête sa machine ne peut plus faire travailler l'essaim au nom du projet
d'un autre.

`visibility` n'entre pas dans la décision, et c'est délibéré : un projet
**public** se lit par tout le monde, il n'est pas pour autant un chantier où le
premier venu ajoute du travail. « On peut regarder » et « on peut faire faire »
sont deux phrases différentes.

### Ce que ça ne fait pas, et il faut le dire

Les **lectures** gardent leurs deux portes. Le mode « tableau de bord sans
compte » est annoncé ; le resserrer serait le retirer sans prévenir. Le constat
de cet ADR tient donc encore, mot pour mot, **pour les lectures** — plan de
merge, balance, rapport et tâches restent visibles de tout l'essaim.

Le déséquilibre est assumé : c'est l'écriture qui a des conséquences. Les
lectures se fermeront quand les comptes seront la norme, et
`tests/lecture-projet-compte.test.ts` continue de porter le constat qui
échouera ce jour-là.

### Le chemin vers (c)

(c) reste la bonne cible : `HIVE_TOKEN` conflate « j'opère cette ruche » et « je
prête ma machine », et c'est la cause. Mais un basculement d'un bloc migre toutes
les ruches existantes d'un coup.

Cette décision fournit le chemin, et il passe par une fonctionnalité qui existe
déjà : **adopter un projet le soustrait au jeton que tout l'essaim détient.**
L'hôte protège ses projets un par un, quand il veut, avec un geste qu'il
comprend, sans que personne soit coupé du jour au lendemain. Quand plus aucun
projet n'est orphelin, le jeton partagé n'ouvre plus rien dans l'espace projet —
et (c) n'est plus qu'un ménage.

`tests/engagement-projet.test.ts` tient la décision, et son dernier test tient
la migration.

### Ce que ça a coûté

Une seule route a changé de code de retour : le refus d'un engagement prend
désormais la forme **exacte de l'inexistence** (404, mêmes octets), au lieu de
laisser passer. Le 401 reste réservé à qui ne présente aucune identité valide —
là, le refus ne dit rien du projet, il dit que l'appelant n'est personne.

Aucun test de la suite n'a rougi lors du resserrement, et c'est précisément
pourquoi `tests/engagement-projet.test.ts` a été écrit : une garde qu'aucun test
ne voit mordre est une garde qu'on retirera un jour sans s'en apercevoir.
