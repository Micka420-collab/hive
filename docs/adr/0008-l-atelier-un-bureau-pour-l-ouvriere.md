# ADR 0008 — L'Atelier : un bureau que l'ouvrière peut allumer

- **Statut** : **proposé — en attente de validation humaine**
- **Date** : 2026-07-30
- **Demande** : « pouvoir créer son propre PC pour naviguer dedans, exécuter le
  code, le tester », sur le modèle de Manus et du mode workers de Delos.

## Pourquoi cet ADR existe avant le code

Parce que c'est la première fonctionnalité de ce dépôt qui donne à un agent **un
ordinateur, un écran, un navigateur et le réseau, en même temps et de façon
persistante**. Tout le reste — le bac à sable, les Gardiennes, les billets
révocables — a été construit pour restreindre ce qu'une ouvrière peut atteindre.
L'Atelier va dans l'autre sens.

Ce n'est pas une raison de refuser : c'est une raison de **décider**, par écrit,
ce qu'on ouvre et ce qu'on garde fermé. Une contrainte subie se contourne à la
première difficulté (ADR 0006). Une contrainte motivée tient.

## Ce que la demande veut vraiment

Aujourd'hui l'agent travaille **en aveugle** : il écrit des fichiers, la ruche
calcule un diff. Il ne peut pas ouvrir son propre travail. Concrètement, il ne
peut pas :

- lancer le serveur de développement et **regarder la page** ;
- cliquer dans son interface pour voir si le bouton marche ;
- lire une erreur de console qui n'apparaît qu'au navigateur ;
- itérer sur du visuel — un CSS ne se vérifie pas par un test unitaire.

C'est le manque le plus concret de la ruche, et aucune quantité de tests ne le
comble : **un test vérifie ce qu'on a pensé à vérifier.**

## Ce qu'on construirait

Un conteneur par tâche, éphémère, contenant :

| Pièce                             | Rôle                                              |
| --------------------------------- | ------------------------------------------------- |
| `Xvfb`                            | un écran, sans carte graphique                    |
| un gestionnaire de fenêtres léger | pour que les fenêtres existent                    |
| Chromium                          | le navigateur que l'agent pilote                  |
| `x11vnc` + `noVNC`                | l'écran, visible **en lecture** dans le dashboard |
| le workspace de la tâche          | monté comme aujourd'hui                           |

Et deux capacités données à l'agent : **une capture d'écran** et **un geste**
(clic, frappe). Rien de plus. Pas de « contrôle du bureau » générique.

L'humain, lui, voit l'écran en direct dans une vue du dashboard — comme
« L'Aperçu », mais pour un bureau entier.

## Les cinq décisions qui demandent votre accord

Ce sont elles qui font que cet ADR n'est pas du code.

### 1. Le réseau : fermé par défaut, et c'est douloureux

Un bureau sans réseau ne peut pas `npm install`. Un bureau **avec** réseau
permet à l'agent d'atteindre n'importe quoi, et d'y envoyer ce qu'il a lu du
dépôt. Le bac actuel laisse déjà passer le réseau, et le DIT (`bac.ts` :
« l'agent peut envoyer ailleurs ce qu'il a lu du dépôt »).

**Proposition** : `localhost` et le miroir du dépôt seulement, par défaut. Une
liste d'autorisation explicite pour le reste. `--reseau-ouvert` existe, s'annonce
en gros, et n'est jamais le défaut.

### 2. L'écran est en LECTURE SEULE pour l'humain distant

Un `noVNC` en écriture exposé par un tunnel, c'est un bureau à la disposition de
qui trouve l'URL. Le partage en lecture existe déjà dans la ruche
(`shared/partage.ts`, jeton distinct et révocable) : l'Atelier s'y branche, il
n'invente pas sa propre porte.

### 3. Aucun identifiant de l'humain n'entre dans l'Atelier

Ni `XAI_API_KEY`, ni `ANTHROPIC_API_KEY`, ni le jeton de la ruche. Un bureau
avec un navigateur est l'endroit le plus facile du monde pour exfiltrer un
secret — il suffit de le taper dans une barre d'adresse.

L'agent parle au modèle **depuis l'extérieur** du bureau ; le bureau n'est qu'un
outil qu'il actionne. C'est la même séparation que « L'Aperçu » : voir ce que
l'IA construit **sans lui donner la session**.

### 4. Éphémère, et détruit à la fin de la tâche

Un bureau persistant accumule : un `~/.ssh` qui traîne, un cookie de session, un
paquet installé à la main que personne ne retrouvera. Une tâche, un bureau, une
destruction. Le workspace git reste la seule chose qui survit.

### 5. Ça ne marchera pas partout, et il faut le dire

Sans `docker` ni `podman`, **pas d'Atelier**. Pas de repli : un « bureau simulé »
serait exactement le défaut § 9 bis de `docs/ERREURS.md` — un simulacre qui a
l'air de travailler. Le nœud dira « Atelier indisponible : aucun moteur de
conteneur », et l'agent travaillera en aveugle comme aujourd'hui.

Sur la machine de la personne qui a demandé cette fonctionnalité, `docker`
**était absent** (`hive doctor` : « aucun moteur — sandbox de processus »). C'est
donc le premier prérequis, avant toute ligne de code.

## Ce que ça coûte

Une image de plusieurs centaines de mégaoctets, quelques centaines de mégaoctets
de mémoire par bureau, et un module de plus à maintenir. À mettre en face du
gain : un agent qui **voit** ce qu'il fabrique.

## Ce que je ne ferai pas sans validation

Écrire le code. Pas par prudence excessive : parce que les cinq décisions
ci-dessus changent l'architecture, et qu'en trancher une de travers donne une
fonctionnalité qu'il faudra défaire. Ce dépôt a déjà payé pour savoir qu'un
chemin qu'on n'exécute pas et qu'on croit bon coûte plus cher que du travail
reporté.

## Suite proposée

1. **Vous validez ou corrigez les cinq décisions.**
2. Lot 1 : l'image et le module PUR qui compose la commande de démarrage —
   éprouvable sans lancer un conteneur, comme `demarrage.ts`.
3. Lot 2 : capture d'écran et geste, avec leurs refus.
4. Lot 3 : la vue dans le dashboard, branchée sur le partage en lecture.

Chaque lot passe la barrière et la loupe avant le suivant.

**Lot recette (2026-08)** : un profil compose persistant (`/workspace`) s'ajoute
à l'isolement des tâches, il ne le remplace pas. Voir `docs/ATELIER.md`.
