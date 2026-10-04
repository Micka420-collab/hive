# Le banc d'ombre — comparer deux modèles sur la même petite tâche

L'Aiguillage apprend quel modèle sert le mieux chaque genre de tâche, mais il
n'apprend que de ce qu'il a **choisi** : deux modèles ne se mesurent jamais sur
la **même** tâche. Le banc d'ombre fait cette expérience contrôlée. Une petite
tâche testable, tirée au sort, est rejouée telle quelle par un **second
modèle**, dans son propre atelier. Cette « ombre » **ne se livre jamais**. Les
deux productions passent par le chemin qui juge toute production : validations
du bac, Gardiennes, contre-revue et Evaluator. Les **tests du projet**
départagent les deux, jamais la préférence d'un modèle.

Le banc est **éteint par défaut** et s'allume **par projet** : chaque ombre est
un vrai appel de modèle, payé par l'hôte.

## Allumer le banc

Dans ⬡ Projets, panneau **Banc d'ombre** (sous l'Agent Garde-Fous) : cochez
« Actif », réglez l'échantillon et le budget, puis **Appliquer**. Le panneau
montre ce que le banc a dépensé sur les 24 dernières heures, et ce qui
l'arrête s'il est arrêté.

<p align="center">
  <img src="images/banc-ombre/panneau-projet.png" width="360" alt="Panneau Banc d'ombre d'un projet : actif, échantillon, budget sur 24 h, deux exécutions sans coût déclaré, les deux dernières ombres terminées.">
</p>

Par l'API, avec le jeton de ruche (projet orphelin) ou le compte du
propriétaire ou d'un administrateur :

```bash
curl -X POST http://localhost:7777/api/projects/<projet>/banc-ombre \
  -H "x-hive-token: $HIVE_TOKEN" -H 'content-type: application/json' \
  -d '{"actif": true, "tauxPourMille": 50, "executionsParJour": 3, "plafondCoutUsd": 1}'
curl http://localhost:7777/api/projects/<projet>/banc-ombre -H "x-hive-token: $HIVE_TOKEN"
```

| Champ               | Sens                                                             | Bornes            |
| ------------------- | ---------------------------------------------------------------- | ----------------- |
| `actif`             | Le banc tourne-t-il pour ce projet ?                             | —                 |
| `tauxPourMille`     | Part des tâches tirées au sort, en ‰. Défaut **50** (5 %).       | 1 à 1000          |
| `executionsParJour` | Ombres lancées au plus par **24 h glissantes**. Exigé.           | 1 à 50            |
| `plafondCoutUsd`    | Coût **déclaré** au plus par 24 h glissantes, en dollars. Exigé. | plus de 0 à 1 000 |

Le budget est exigé pour **allumer**. Pour **éteindre**, `{"actif": false}`
suffit : c'est le geste qui arrête la dépense, et un champ de budget mal tapé
ne doit jamais le retenir. Le budget rangé est gardé pour le prochain allumage.

Régler le banc est un geste de **qui répond du projet** : un membre reçoit
403, comme pour l'autonomie, le Garde-Fous ou le plafond de la Balance. Le
lire (`GET`) demande d'être membre du projet : un compte tiers reçoit 404.
Chaque réglage est journalisé (`shadow_bench_set`), avec le compte qui l'a
posé (`definiPar`, absent sous le jeton de ruche), comme le plafond de la
Balance.

## Quelles tâches sont rejouées

Le tirage est un hachage de l'identifiant de la tâche : la même tâche est
toujours dans l'échantillon, ou toujours hors de lui. Une tâche hors
échantillon, ou d'un projet dont le banc est éteint, ne produit **aucun**
événement. C'est l'immense majorité des tâches.

Le banc décide sur la **première production** de la tâche : il compare un
premier essai à un premier essai. Une tâche tirée au sort puis écartée le dit
(`shadow_bench_skipped`, avec son motif), dans cet ordre :

| Motif                 | La tâche est écartée quand…                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `non_testable`        | sa production n'a pas de verdict de tests du bac (pas de bac, aucun script `test`, délai…) : rien ne départagerait                                                                         |
| `trop_grande`         | prompt de plus de 4 000 caractères, diff de plus de 200 lignes ou de 5 fichiers, ou plus de 15 min d'exécution                                                                             |
| `action_externe`      | le titre ou le prompt demande un geste externe ou irréversible : déployer, publier, pousser, ouvrir une PR ou une issue, écrire à un tiers (API en écriture, stockage distant, messagerie) |
| `delegation`          | c'est une tâche déléguée, ou elle a délégué                                                                                                                                                |
| `modele_inconnu`      | aucun modèle n'a été commandé à la production : on ne saurait pas qui comparer                                                                                                             |
| `ombre_en_vol`        | une autre ombre du projet est encore en vol                                                                                                                                                |
| `budget_executions`   | `executionsParJour` est atteint                                                                                                                                                            |
| `budget_cout`         | le coût déclaré des 24 dernières heures atteint `plafondCoutUsd`                                                                                                                           |
| `aucun_second_modele` | aucune ouvrière en ligne n'offre un **autre** modèle                                                                                                                                       |
| `aucun_bac_isole`     | un autre modèle est offert, mais seulement par des ouvrières **sans bac isolé** (voir plus bas)                                                                                            |

Le filtre des gestes externes est volontairement large : un faux positif
retire une tâche de l'échantillon, un faux négatif ferait refaire un geste
qu'on ne défait pas. Il lit des **tournures** bornées, pas des sous-chaînes
nues : « push » en fin de titre est pris, « prompt » n'est pas une PR, un
`curl` qui lit n'écrit chez personne.

Le **second modèle** est le mieux classé par l'Aiguillage parmi ceux qu'une
ouvrière en ligne **isolée** offre, sauf celui qui a produit l'originale,
classé au niveau du modèle (tous agents et efforts confondus). Depuis
l'Aiguillage v3, un modèle jamais jugé sur ce genre part d'un a priori fini : il
passe devant un modèle connu quand l'optimisme de son ignorance l'emporte, pas
d'office. Le classement est **lu**, pas écrit : le banc ne pose aucune élection.

## Le budget

- **Une ombre en vol à la fois** par projet. Le coût d'une exécution n'est
  connu qu'après elle, et trois ombres lancées d'un coup franchiraient le
  plafond de deux exécutions sans rien pouvoir arrêter. Une ombre rendue mais
  encore **relue** reste en vol : le coût de ses relectures n'est pas encore
  arrivé.
- Le coût compté est celui que **déclarent les CLI** des agents, pour l'ombre
  **et ses relectures**. Une exécution qui ne déclare rien (Codex ne déclare que
  ses jetons) est comptée **muette** et affichée comme telle, jamais estimée.
  Le plafond de coût ne la voit pas, et c'est `executionsParJour` qui la
  borne.
- Chaque résultat d'une exécution du banc est compté, **même écarté** : une
  ombre remise en file par un nœud tombé puis rejouée ailleurs a été payée
  deux fois. Le coût est rangé dans la même transaction que le résultat.
- Le budget se lit dans l'état courant (`GET …/banc-ombre`, champ
  `budget.arret`), pas seulement dans un événement que l'élagage emportera.

## Ce que fait une ombre, et ce qu'elle ne fait jamais

L'ombre est une tâche du même projet, avec le **même prompt**. Son titre
commence par « Ombre — » : c'est ainsi qu'elle se reconnaît dans les listes de
tâches. Elle est annoncée par `shadow_bench_started`.

- Elle part **chez une ouvrière isolée qui déclare son modèle**, avec ce
  modèle, et nulle part ailleurs. Isolée veut dire un bac de niveau
  `conteneur` (bubblewrap, podman ou docker) : ni le HOME ni les identifiants
  git et `gh` de l'hôte n'y sont montés. Le filtre de texte écarte ce qui
  **demande** un geste externe ; le bac borne ce qu'un agent ferait sans qu'on
  le lui demande. Une ouvrière sans bac (`processus`) ne porte jamais d'ombre. Si aucune ne l'offre, `shadow_bench_waiting` le dit une
  fois, puis l'ombre échoue au bout de 5 minutes (`modele_ombre_absent`).
  Elle n'est jamais relancée sur un autre modèle.
- Elle n'a **qu'un essai**. Un échec la clôt. Une contre-revue qui la conteste
  ne la relance pas : `evaluator_retry_skipped` le journalise, motif
  `shadow_task`.
- Elle **ne se livre jamais**. La route de livraison la refuse
  (`409 tache_ombre`), et la réservation de livraison la refuse aussi, pour
  toutes les voies, autonome comprise. Elle n'entre ni dans le merge, ni dans
  la livraison de mission, ni dans le rapport d'avancement, ni dans les
  décisions du Plein Essaim. Mission Control la montre là où elle **tourne**
  (la Chambre de son ouvrière, la file, la charge), mais jamais dans la file
  de revue de la Miellerie, sa coulée, ni les compteurs du travail des
  projets.
- Elle **ne se court pas** et **ne délègue pas**.
- Elle ne retient pas les productions du projet derrière elle : le Sting
  Detector ne la compte pas.
- Elle ne reçoit pas le **souvenir de son originale** en contexte. Sinon, on
  lui soufflerait la réponse de l'autre modèle.
- Elle ne laisse **aucun souvenir**, et son échec n'entre pas au Cerveau.
- Son échec ne fait pas monter la **température** de la ruche : la
  thermorégulation ne lit que la production.
- Ses **relectures** servent le banc elles aussi : payées par son budget, elles
  ne posent aucune élection de l'Aiguillage et ne comptent pas dans les lignes
  de production du Genome.

## La comparaison

Chaque côté donne une **issue** : `echec` (production en échec),
`tests_rouges`, `tests_verts`, ou `sans_preuve` (aucun verdict de tests). Le
**verdict** est rendu par les tests seuls : `ombre_meilleure`,
`originale_meilleure`, `egalite` ou `indecis`. Deux productions vertes font une
égalité, même si une relectrice en préfère une. Deux commits de base
**connus et différents** rendent le verdict `indecis` : l'ombre clone la
branche du jour, et si l'originale a été fusionnée entre-temps, elle trouve la
solution déjà écrite.

La contre-revue sert à la **confiance**. Des tests verts sur un diff qui ne
fait rien restent verts. C'est l'avis indépendant qui dit que chaque
production a vraiment fait la tâche.

| Confiance | Quand                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `faible`  | un côté n'a pas de verdict de tests (`indecis`), a échoué avant tout test, les bases diffèrent, ou une relectrice **conteste** un côté |
| `haute`   | les deux côtés ont un verdict de tests sur le **même commit de base** connu, et une relectrice a **validé** chacun                     |
| `moyenne` | le reste : une base inconnue d'un côté, ou une relecture qui manque encore                                                             |

Une relecture contestée ne change pas le verdict, qui reste celui des tests.
Elle dit que cette production n'a pas fait la tâche : ses tests verts ne
prouvent alors plus grand-chose, et la confiance tombe.

## Où le lire

Dans l'Essaim, le **registre Genome** a une section **Banc d'ombre**, de
provenance `shadow`. Elle est tenue **à part** des lignes de production :
l'ombre rejoue une tâche déjà comptée. On y trouve :

- par modèle et catégorie, les comparaisons tranchées de **son point de vue**
  (mieux, égal, moins bien, indécis) et leur confiance, sans note ni classement ;
- les dernières ombres : en vol, abandonnées ou comparées, avec l'issue de
  chaque côté.

Les deux côtés de chaque comparaison sont **rangés** avec l'ombre
(`taches_ombre`) : le côté original à l'ouverture, le côté ombre à son rendu,
l'avis de la contre-revue à chaque verdict. Le banc a payé chaque
comparaison, et le journal tourne à 5 000 événements : les relire de là,
c'était les perdre en une nuit sur une ruche occupée. Elles vivent aussi
longtemps que leurs tâches (30 jours).

<p align="center">
  <img src="images/banc-ombre/registre-genome.png" width="420" alt="Registre Genome : sous les lignes de production, la section Banc d'ombre de provenance shadow, deux modèles comparés sur deux tâches — une égalité de confiance haute, et une originale meilleure de confiance faible, l'ombre ayant été contestée.">
</p>

Captures prises sur une vraie Reine : deux nœuds WebSocket déclarent leurs
modèles (agents factices) et rendent de vrais résultats, avec leurs
validations et leurs avis.

`GET /api/genome` rend la même chose sous `ombre`. Le Journal dit chaque
réglage, chaque ombre lancée, et chaque tâche tirée au sort puis écartée.

## Décision : le banc ne change pas encore le routing

Les comparaisons **n'entrent dans aucun poids** : ni la récompense de
l'Aiguillage, ni ses élections en vol, ni les phéromones, ni l'apprentissage
des Garde-Fous. Le modèle d'une ombre n'est jamais rangé comme une élection de
l'Aiguillage. Les requêtes qui nourrissent les phéromones, la
thermorégulation, les leçons d'échec et le Garde-Fous excluent les ombres (et,
pour les phéromones et la température, leurs relectures), et des tests
tiennent chacune de ces exclusions.

Pour faire entrer ces faits dans le routing, il faut choisir leur poids face
aux verdicts de contre-visite. Personne ne l'a encore choisi. D'ici là, le banc
**mesure** et le registre **montre**.

## Limites connues

- L'ombre part **après** la première production de l'originale. Le dépôt a pu
  bouger entre-temps. Le commit de base de chaque côté est comparé, et une base
  différente rend la comparaison indécise.
- Le filtre des gestes externes lit le texte de la tâche. Il ne voit pas ce
  qu'un agent déciderait de lui-même. C'est le rôle du bac isolé, déclaré par
  le nœud : un nœud qui se dirait isolé sans l'être n'exposerait que sa propre
  machine.
- Seule la première production d'une tâche est candidate. Une tâche dont le
  premier essai n'a rien testé n'est pas rejouée plus tard.
