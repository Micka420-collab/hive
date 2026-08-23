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

**L'alerte hors-domaine est câblée** dans le tick. À chaque passe, la ruche
regarde les tâches encore en vol : celles qui courent depuis plus longtemps que
_tout_ ce qu'elle a observé émettent `duree_hors_domaine`. Elles ne sont pas
« presque finies » — il n'existe plus une seule observation comparable.

L'instant de l'assignation vient de `annonces_duree.faiteA`, écrit par
`envoyerTache` dans le même geste que l'envoi. Plus juste qu'un `updatedAt`, qui
bouge à chaque changement et confondrait « assignée il y a deux heures » avec
« statut retouché il y a deux minutes ».

**Une seule fois par tâche.** Le tick repasse toutes les quelques secondes ;
sans mémoire, la même tâche noierait la Chronique sous un seul avertissement —
un signal répété cesse d'être un signal. Et cette mémoire est **purgée** des
tâches qui ont atterri : la doctrine des bornes vaut aussi pour ce qui vit en
mémoire, dans un processus qui tourne des mois.

## Ce qui s'affiche, et pourquoi le verdict est la pièce maîtresse

L'annonce se lit dans le **tiroir de tâche**, avec son `n` :

> **Annoncé** — 7 min à 25 min — 8 fois sur 10 (12 obs.)

Jamais l'intervalle seul. Sur 5 observations et sur 400, il ne se planifie pas
pareil, et un intervalle sans son socle invite à une confiance qu'il n'a pas
méritée.

### Le verdict, sur chaque tâche finie

> **Annonce tenue** — 15 min pour un plafond annoncé de 25 min.

C'est **la seule ligne de l'écran qui rende l'horloge réfutable**. Une annonce
qu'on n'oppose jamais à ce qui est arrivé ne coûte rien à faire et ne vaut rien :
personne ne peut dire si elle valait quelque chose. `calibrer()` fait ce travail
en gros, sur des dizaines d'annonces ; le verdict le fait au cas par cas, sous
les yeux de qui ouvre la tâche.

### Deux refus, et c'est là qu'est le fond

**Sur socle `aucun`, aucun verdict.** `p80Ms` y vaut 0 — la ruche a dit « je ne
sais pas encore ». Comparer le réel à ce 0 rendrait « débordée » sur chacune de
ces tâches : on noterait comme une prédiction ratée un **refus de prédire**.
L'effet à trois semaines est mécanique — on annonce n'importe quoi plutôt que de
porter un rouge imérité, et le verdict finit par mesurer l'inverse de ce qu'il
prétend.

**« Débordée » reste en ambre, jamais en rouge**, et la phrase porte sa propre
statistique : _une annonce sur cinq est censée déborder — c'est leur RÉPÉTITION
qui accuse l'horloge, pas celle-ci._ Peindre une débordée comme une panne pousse
à annoncer large pour n'être jamais pris en défaut. Plus dur à prendre en défaut
n'est pas plus juste.

### Sans annonce dans la fenêtre : rien du tout

Pas un « — ». Le journal est élagué : une annonce assez vieille n'y est plus. Un
tiret se lirait « la ruche n'avait rien annoncé » quand la vérité est « le
journal ne s'en souvient plus » — deux faits opposés qu'un tiret confondrait.

C'est la même raison qui rend les **deux moitiés indépendantes** : l'alerte hors
domaine s'affiche même quand l'annonce a disparu. La tâche la plus longue est
celle dont l'annonce a eu le plus de temps pour sortir de la fenêtre, et la seule
pour qui l'alerte compte.

### D'où viennent les chiffres

Du **flux**, pas d'une route neuve. `duree_annoncee` et `duree_hors_domaine`
arrivent déjà dans le journal que le tableau de bord reçoit ; `annoncesDepuisEvenements`
les replie par tâche. Ouvrir un endpoint pour relire `annonces_duree`
ajouterait un aller-retour, un cache à invalider et une seconde vérité à tenir
d'accord avec la première.

### Une famille à part dans la Chronique

Les deux événements tombent sous la puce **Horloge**, pas sous « Autres ».
« Autres » est la case qu'on décoche en premier quand le journal déborde : ce
qu'on ne peut pas isoler ne se surveille pas, et une horloge qu'on ne surveille
pas redevient un chiffre auquel on croit sur parole.

## L'horloge se note, et la note est à l'écran

C'est la troisième promesse du module, et la dernière à avoir été câblée.
`calibrer()` existait, éprouvé, et **personne ne l'appelait** — exactement la
surface du lot 46 (« trois bornes écrites, jamais appelées »).

Le tick la recalcule toutes les **cinq minutes** (une dérive se mesure en jours,
pas en secondes) et n'émet `horloge_calibration` que sur **changement de
verdict**, ou au **rappel de six heures**. Les deux moitiés sont nécessaires :

- sans le changement, un verdict identique toutes les cinq minutes noierait la
  Chronique — un signal répété cesse d'être un signal ;
- sans le rappel, un verdict stable une semaine sortirait de la fenêtre du
  journal et n'y reviendrait jamais. L'écran afficherait « rien » sur une
  horloge parfaitement notée, et « rien » se lit « personne ne surveille ».

La tuile **Horloge tenue** de la vue Ruche montre la part tenue, la visée de
80 % et le socle. `optimiste` est le **seul** verdict peint en alerte, et
l'asymétrie est voulue : l'horloge promet alors plus court que la réalité, et
tout ce qui se planifie dessus déborde. `pessimiste` coûte de l'attente ;
`optimiste` coûte des promesses tenues par personne.

### Le défaut que ce lot a trouvé — mesuré, pas supposé

`annoncesJugees` ne filtrait pas le socle. Or `aucun` est enregistré avec
`p80Ms = 0` : la ruche n'a rien promis, elle a dit « je ne sais pas encore ».
Comme `calibrer` compte une annonce tenue quand `reelMs <= p80Ms`, **aucune** de
ces lignes ne tenait jamais.

Sonde sur cinq tâches toutes annoncées `aucun`, toutes réussies :

```
{ n: 5, partTenue: 0, ecart: -0.8, verdict: 'optimiste' }
```

La pire note du barème, sur une ruche qui n'a fait aucune prédiction. Et c'est
le cas du **démarrage** : une ruche neuve n'a pas d'historique, donc ses
premières annonces sont toutes `aucun`. L'horloge se serait déclarée menteuse
dès son premier jour, **en punition d'avoir été honnête**.

C'est le même piège que celui fermé à l'affichage (`verdictAnnonce`), rencontré
une seconde fois à l'autre bout de la chaîne : comparer un réel à un plafond que
personne n'a promis.

## Ce qui reste à brancher

- **Plein Essaim** — l'annonce sur les tâches en vol, pour n'avoir pas à ouvrir
  chaque tiroir.

### Et ce que je n'inventerai pas

Le socle `exact` demande un **genre** de tâche. Cette donnée n'existe pas dans
la ruche. L'inventer — par mots-clés du titre, par exemple — donnerait un
étiquetage plausible et faux, et l'horloge se spécialiserait sur des catégories
qui ne veulent rien dire.

Le socle `exact` restera donc inatteignable tant que le genre n'aura pas une
définition que la ruche **mesure**. C'est écrit ici plutôt que contourné par une
heuristique : l'horloge parle sur socle `caste` ou `global`, et elle le dit.
