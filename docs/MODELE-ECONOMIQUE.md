# Modèle économique de Hive

> Ce document décrit un modèle **proposé**, pas une offre en service. Aucun
> paiement n'est encaissé aujourd'hui. Les chiffres de coût sont des hypothèses
> explicitement datées ; la méthode pour les corriger est donnée en §4.

---

## 1. Ce qui ne se vend pas, et pourquoi ce n'est pas de la charité

Hive reste **gratuit, open source et auto-hébergeable**. Votre Queen tourne chez
vous, vos clés d'API ne quittent pas votre machine, vos nœuds sont les machines
de vos amis. Zéro euro, pour toujours.

Ce n'est pas une concession, c'est le produit. Une ruche n'a de valeur que si
elle a des membres, et un membre arrive parce qu'il peut essayer sans rien
donner. Le noyau gratuit est le canal d'acquisition ; le faire payer reviendrait
à acheter de la publicité pour vendre à personne.

La conséquence est stricte : **aucune fonctionnalité du noyau ne doit être
dégradée pour vendre autre chose.** Pas de limite artificielle de nœuds, pas de
retenue de fonctionnalité derrière un mur. Le jour où on le fait, l'argument
ci-dessus tombe et on n'a plus qu'un logiciel mutilé.

## 2. Ce qui se vend : l'heure-ouvrière hébergée

Une ruche a besoin de machines allumées. C'est là — et seulement là — qu'il y a
un coût réel à couvrir, et donc quelque chose à vendre.

> **Un Rush = un plafond d'heures-ouvrières, payé d'avance, exécuté sur des
> nœuds que nous hébergeons, sur l'objectif que vous fixez.**

Vous n'avez pas de machine à prêter, ou pas assez, ou pas maintenant. Vous
achetez du temps d'ouvrière. La ruche travaille, ouvre des pull requests sur
**votre** dépôt, et s'arrête net quand le plafond est atteint.

Ce qui est vendu est donc une **capacité bornée**, pas une promesse de résultat.
C'est une distinction commerciale importante et elle doit rester lisible sur la
page de vente : promettre « votre projet sera fini » est invendable et
malhonnête ; vendre « 50 heures d'essaim, encadrées, avec un devis fondé sur
l'historique » est tenable.

## 3. Pourquoi Hive peut vendre ça alors que le modèle tue la plupart des offres IA

Le mode d'échec classique d'un service d'agents IA facturé au forfait est
toujours le même : **un agent s'emballe, brûle des jetons sans produire, et la
marge part avec.** Le vendeur ne s'en aperçoit qu'à la facture du fournisseur.

Hive a déjà, en code testé, les trois organes qui bornent ce risque —
`src/orchestrator/balance.ts`, écrit bien avant qu'on pense à vendre quoi que ce
soit :

| Verbe de La Balance | Fonction         | Rôle économique                                                                                                                                                         |
| ------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Peser**           | `peserLaRuche()` | Impute chaque seconde-ouvrière à une cause. C'est le relevé de consommation, et il est déjà ventilé par projet et par poste.                                            |
| **Prévoir**         | `estimerCout()`  | Rend un devis (médiane + p90) à partir de tâches **comparables réellement mesurées**. Il se tait sous 3 échantillons plutôt que d'annoncer une précision qu'il n'a pas. |
| **Borner**          | `jugerPlafond()` | `passe` / `alerte` à 80 % / `bloque`. Le Scheduler cesse d'assigner quand le plafond est atteint.                                                                       |

Autrement dit : le devis n'est pas une estimation commerciale, c'est une
**statistique sur l'historique de la ruche**, et le plafond n'est pas une
promesse, c'est une **porte dans le Scheduler**.

C'est ce qui rend la marge calculable au lieu d'espérée.

### 3.1 La faille à fermer avant d'encaisser le premier euro

`jugerPlafond` porte cet avertissement dans son propre code :

> ⚠ Ce n'est pas une frontière de sécurité. `durationMs` est une donnée
> d'agent : un nœud hostile peut déclarer 24 h par résultat.

Tant que Hive est gratuit et entre amis, c'est acceptable — un membre n'a rien à
gagner à mentir. **Dès qu'on facture, ça ne l'est plus** : un client paie au
plafond et un nœud qui sur-déclare consomme le plafond d'un autre.

Règle non négociable : **la facturation ne lit jamais `durationMs`.** Sur les
nœuds hébergés, l'horloge qui compte est celle de l'hébergeur, mesurée hors du
processus de l'agent. `durationMs` reste ce qu'il est — un signal d'ordonnancement
et d'observabilité, pas une unité monétaire.

## 4. Structure de coût

Coût marginal d'une heure-ouvrière hébergée :

```
coût_heure = machine + jetons
           = (VM 2 vCPU / 4 Go, mutualisée)  +  (consommation modèle de l'agent)
           ≈ 0,05 – 0,15 €                   +  2 – 6 €
```

Deux faits dominent tout le reste :

1. **Les jetons écrasent la machine** d'un facteur ~30. Optimiser l'infra est une
   perte de temps ; encadrer la consommation modèle est _tout_ le sujet.
2. **La variance est le vrai risque**, pas la moyenne. Une heure peut coûter
   2 € comme 6 € selon la taille du contexte et le nombre de reprises.

D'où deux leviers, tous deux déjà présents ou en cours dans le code :

- le **plafond par projet** (`jugerPlafond`) borne l'exposition totale ;
- le **polyéthisme** (`polyethisme.ts`) route le travail cadré vers des modèles
  moins chers et ne convoque une ouvrière expérimentée que pour la contre-visite.
  Une contre-visite coûte une fraction d'une reprise complète.

> **Hypothèse de travail retenue : 3,50 € l'heure-ouvrière, tout compris.**
> Elle n'est pas mesurée — elle est à confirmer sur les 100 premières heures
> réellement exécutées. Toute la grille du §5 se recalcule à partir d'elle ; la
> sensibilité est donnée pour qu'on voie tout de suite ce qui casse.

## 5. Grille proposée

| Offre               | Contenu                    | Prix           | Prix / h | Marge brute à 3,50 €/h | Marge à 5 €/h |
| ------------------- | -------------------------- | -------------- | -------: | ---------------------: | ------------: |
| **Ruche libre**     | Auto-hébergée, illimitée   | **0 €**        |        — |                      — |             — |
| **Rush Éclaireuse** | 10 h-ouvrières, 1 objectif | **79 €**       |   7,90 € |                   56 % |          37 % |
| **Rush Essaim**     | 50 h-ouvrières, 1 sprint   | **299 €**      |   5,98 € |                   41 % |          16 % |
| **Rush Colonie**    | 200 h/mois, continu        | **990 €/mois** |   4,95 € |                   29 % |          −1 % |
| **Queen hébergée**  | Orchestrateur managé       | **+49 €/mois** |        — |                  ~85 % |         ~85 % |

Lecture de la dernière colonne : **si le coût réel s'avère être 5 €/h, l'offre
Colonie est à perte.** C'est le chiffre à surveiller, et c'est pour ça qu'il est
dans le tableau plutôt que dans une note de bas de page. Deux réponses possibles
le jour où ça arrive — baisser le volume inclus, ou remonter le prix — et une
seule qui est un piège : rogner sur la qualité du modèle, qui fait chuter le taux
de réussite et donc _augmente_ le coût par livrable.

**La Queen hébergée est l'offre la plus saine du tableau** : coût quasi fixe
(un petit process, une base SQLite), marge élevée, revenu récurrent, et elle
s'adresse à ceux qui ont déjà des nœuds. C'est probablement par là qu'il faut
commencer, pas par les Rushes.

### Règles de vente

- **Le crédit non consommé se reporte** (90 jours). Un plafond non atteint n'est
  pas une punition ; et c'est peu coûteux, une part expire toujours.
- **Pas de reconduction tacite** sur les Rushes. Le mode d'échec qui détruit la
  confiance dans ce marché est le prélèvement qu'on n'avait pas vu venir.
- **Le devis avant l'achat**, rendu par `estimerCout` sur des tâches comparables,
  ou l'aveu qu'on n'a pas assez d'historique pour se prononcer.
- **Aucun paiement ne débloque un merge.** L'approbation reste un geste humain
  du propriétaire du dépôt. Vendre l'automatisation du merge reviendrait à
  vendre le contournement de la seule garantie que Hive donne.

## 6. Les trois risques qui tuent ce modèle

| Risque                       | Ce qui se passe                              | Ce qui le borne                                                                                            |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Emballement des jetons**   | Un agent boucle, la marge disparaît          | `jugerPlafond` (codé, testé) + plafond obligatoire sur tout projet payant                                  |
| **Sur-déclaration du temps** | Le client paie du temps qui n'a pas eu lieu  | Facturation sur l'horloge de l'hébergeur, jamais sur `durationMs` (§3.1)                                   |
| **Production creuse**        | On facture des heures qui n'ont rien produit | Les Gardiennes (`gardiennes.ts`) : un `success: true` à diff vide est déjà détecté et n'entre pas au rayon |

Le troisième est le plus intéressant commercialement : Hive sait déjà distinguer
une heure **utile** d'une heure **dépensée**. C'est la base d'un engagement que
peu de concurrents peuvent tenir — _les heures jugées creuses par les Gardiennes
ne sont pas décomptées de votre plafond._

## 7. Ce qu'il reste à brancher de ton côté

Le compteur d'heures **côté hébergeur**, l'alignement Stripe → abonnement, l'édition `HIVE_EDITION=cloud` et le compose (`docker-compose.cloud.yml`) sont dans le dépôt. Voir `docs/CLOUD.md`.

Ce qui reste **à toi**, pas au code :

1. **Compte Stripe** — produits, webhook, clés. Hive n'encaisse rien tant qu'elles ne sont pas posées.
2. **Domaine + VPS** — DNS vers tes serveurs, `Caddyfile.cloud` avec ton hostname.
3. **Checkout depuis le tableau de bord** — aujourd'hui le client paie sur Stripe, le webhook active le plan.
4. **Provisionnement automatique de machines** — le fournisseur livré est encore manuel (billet + instructions).
