# ADR 0007 — Ce que le jeton de ruche ouvre, et ce qu'il ne devrait pas

**Statut : OUVERT — décision de l'hôte, non tranchée.**

Cet ADR ne fige rien. Il écrit un constat pour qu'il cesse d'être invisible, et
pose les trois voies possibles avec leur coût. Le trancher change le contrat du
produit ; ce n'est pas un correctif qu'on glisse dans un lot.

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

## Recommandation

**(c) à terme, (a) tout de suite** si l'on veut un geste court : c'est
l'écriture qui a des conséquences, et `POST /merge/run` est la plus lourde —
elle fait travailler la machine de quelqu'un d'autre.

La décision revient à l'hôte.
