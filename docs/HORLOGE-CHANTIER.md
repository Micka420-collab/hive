# L'horloge du chantier — annoncer un temps de codage sans mentir

> `src/shared/horloge-chantier.ts` — module pur.
> Bancs : `tests/horloge-chantier.test.ts` (27), rejeu **TENUS 12 sur 12**.

## La promesse qu'il ne faut pas faire

« Un temps qui reflète à la perfection la réalité » n'existe pas, et il faut le
dire avant d'écrire la première ligne.

La durée d'une tâche de codage dépend de ce qu'on découvre **en la faisant** :
un test qui révèle un défaut voisin, une dépendance qui ne compile pas, un
modèle qui part en boucle. Une prédiction exacte demanderait de connaître le
futur du travail avant de l'avoir fait.

Et viser cette perfection produit toujours la même chose : **un chiffre unique,
faux, que plus personne ne croit au bout de trois fois.** Le pire des mondes —
on a payé le coût de l'annonce sans en tirer le bénéfice.

## Ce que l'horloge promet à la place

Trois choses, et chacune est mesurable.

### 1. Elle apprend de ce qui s'est passé, pas de ce qu'un agent croit

Les `durationMs` que la ruche enregistre déjà dans `results`. **Jamais**
l'auto-estimation d'un modèle : un agent qui s'estime décrit son intention, pas
son historique — c'est le plus mauvais estimateur du lot.

### 2. Elle annonce un intervalle, jamais un point

> « 7 min à 25 min — 8 fois sur 10 (10 obs.) »

se planifie. « 12 minutes » ne se planifie pas, parce que c'est faux presque à
coup sûr. L'annonce porte **toujours** sa confiance _et_ la taille de son socle :
un intervalle sans son `n` invite à une confiance qu'il n'a pas méritée.

**Quantiles, pas moyenne.** Les durées ne sont pas symétriques : on ne finit pas
en moins de zéro, mais on peut toujours rater plus longtemps. Sur l'historique
d'exemple, la moyenne dépasse **six** des dix observations — elle décrit une
tâche qui n'existe pas. Le quantile empirique ne suppose rien sur la forme.

### 3. Elle se note elle-même

`calibrer()` compare les annonces passées au réel. Si 80 % des annonces à 80 %
sont tombées dedans, l'horloge est honnête ; si 40 % le sont, elle est
**optimiste** et le dit.

C'est la pièce qui rend tout le reste utilisable. Sans elle, un intervalle n'est
qu'un chiffre plus large — donc plus difficile à prendre en défaut, ce qui n'est
pas la même chose qu'être juste. L'écart **négatif** est le plus coûteux :
l'horloge promet plus court que la réalité, et tout ce qui s'appuie dessus
déborde.

## Ce qui la sépare d'un compte à rebours

Un compte à rebours **soustrait** : il annonce 12 min, puis 11, puis 10, et
reste bloqué sur « bientôt » pendant une heure. Il traite le temps écoulé comme
une _déduction_.

Le temps déjà passé est une **information** — la meilleure qu'on ait. Une tâche
qui dure depuis 30 minutes n'est plus une tâche moyenne, c'est une tâche
**difficile**. `resteEstime()` ne garde donc que les observations qui ont, elles
aussi, dépassé le temps écoulé, et regarde combien il leur restait à ce
moment-là.

Conséquence assumée : **l'estimation du reste peut augmenter.** Sur l'historique
d'exemple, le reste médian passe de 5 min à 20 min une fois 20 minutes écoulées.
C'est juste qu'elle le puisse — dans la vraie vie, plus ça traîne, plus il en
reste.

### Le zéro qu'il ne faut surtout pas afficher

Quand le temps écoulé dépasse la plus longue durée jamais vue, il ne reste
**aucune** observation comparable. Répondre « 0 » serait le mensonge le plus
coûteux du module : il ferait croire à une fin imminente **au moment précis où
la tâche part en vrille** — l'instant où un humain a le plus besoin d'être
alerté.

L'horloge rend `hors_domaine`, avec le record. C'est un signal, pas une
estimation.

## Quand elle se tait

En dessous de `OBSERVATIONS_MIN` (5), le socle vaut `aucun` et l'annonce dit
« pas encore d'estimation — 3 observation(s), il en faut 5 ».

Ce n'est pas une panne : c'est la réponse juste d'une horloge neuve. Un chiffre
inventé serait cru.

Le socle s'élargit par paliers — `exact` (même caste, même genre) → `caste` →
`global` → `aucun` —, et chaque palier est éprouvé **pile au seuil**. Le rejeu a
montré pourquoi : testés seulement à 10 et à 4, les trois seuils pouvaient
monter d'un cran sans qu'une assertion bouge.

## Ce qui est branché

**L'annonce est enregistrée** à chaque assignation, dans `envoyerTache` — la
porte **unique** vers les ouvrières. C'est la règle que cette fonction porte
déjà pour le cadre du polyéthisme et le contexte du Cerveau : _deux portes,
c'est une porte qu'on oublie de garder_. Un banc vérifie qu'il n'existe qu'un
seul site d'appel.

La caste y est **figée**, jamais relue plus tard. Le socle `aucun` est
enregistré comme les autres : savoir que la ruche n'avait rien à dire ce
jour-là fait partie de son histoire, et c'est ce qui permettra de dater le
moment où elle a commencé à savoir.

**L'historique se lit** depuis `results`, en `LEFT JOIN` sur les annonces : les
tâches d'avant l'horloge comptent encore, sans caste, et nourrissent le socle
`global`. Un `INNER JOIN` aurait jeté tout le passé de la ruche le jour de la
mise en service.

**La table est bornée** — `pruneAnnonces`, câblée dans le tick, comme la
doctrine l'exige pour toute table qui grossit sous la machine.

`tests/horloge-wiring.test.ts` défend le défaut que ce dépôt a déjà commis :
« trois bornes écrites, jamais appelées » (lot 46). Il lit la source **sans ses
commentaires** — un appel commenté n'appelle rien, et une garde qui lit le texte
brut rassure précisément quand quelqu'un vient de désactiver l'appel à la main.
Rejeu : commenter l'appel fait rougir.

## Ce qui reste à brancher

- **l'afficher** dans la Chronique et Plein Essaim, avec son `n` — l'événement
  `duree_annoncee` est déjà émis, il n'attend qu'un écran ;
- **alerter** sur `hors_domaine` plutôt que le rendre en silence : c'est le
  signal qu'une tâche est sortie du domaine connu ;
- **surveiller** le verdict de calibration dans le temps — une horloge qui
  glisse vers `optimiste` signale que les tâches changent de nature.

### Et ce que je n'inventerai pas

Le socle `exact` demande un **genre** de tâche. Cette donnée n'existe pas dans
la ruche. L'inventer — par mots-clés du titre, par exemple — donnerait un
étiquetage plausible et faux, et l'horloge se spécialiserait sur des catégories
qui ne veulent rien dire.

Le socle `exact` restera donc inatteignable tant que le genre n'aura pas une
définition que la ruche **mesure**. C'est écrit ici plutôt que contourné par une
heuristique : l'horloge parle sur socle `caste` ou `global`, et elle le dit.
