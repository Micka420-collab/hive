# Hive Studio — assets visuels (référence validée)

Maquette de référence : **Hive Studio v1.0**, thème sombre et accents orange. Ne pas utiliser la maquette générique ni la v2.0 surchargée.

## Fichiers

| Fichier                                              | Rôle                                                                                                                         | Livré avec l'application |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `mountain-sunset.webp`                               | Panorama 2172 × 724 (208 Ko), bannière de l'accueil sur grand écran.                                                         | oui                      |
| `mountain-sunset-1280.webp`                          | Même panorama, 1280 × 427 (59 Ko), servi aux écrans de 1280 px et moins via `image-set()`.                                   | oui                      |
| `mountain-sunset.svg`                                | Interprétation vectorielle simplifiée (1 Ko) : **repli graphique** si le WebP ne charge pas.                                 | oui                      |
| `docs/maquettes/hive-studio/dashboard-reference.png` | Capture haute résolution de la maquette validée — **référence de conception uniquement**, jamais affichée par l'application. | non                      |
| `docs/maquettes/hive-studio/mountain-sunset.png`     | Source PNG du panorama, conservée pour réexport.                                                                             | non                      |

Les deux PNG (3,9 Mo à eux deux) vivent dans `docs/maquettes/hive-studio/` et non ici : tout ce qui est dans `dashboard/public/` est recopié dans chaque build, donc dans le paquet npm, les installeurs de l'application de bureau et l'image Docker. Une référence de conception n'a rien à y faire.

## Placement

Bannière décorative dans l'en-tête central, sous la barre supérieure et derrière la salutation ; ne jamais couvrir la saisie de mission. `background-size: cover`, cadrage sur le sommet et le soleil, avec un dégradé sombre garantissant le contraste du texte. L'image est décorative (`aria-hidden`), avec repli couleur unie si le chargement échoue, et elle se masque dans **Réglages → Bannière**.

## Contrat UX

Une seule navigation à gauche. En haut : projet actif, statut, recherche, actions et aide. Au centre : mission, progression, conversation/plan et éditeur. À droite : agents, activité et bouton « Inviter ». Panneau droit repliable. Aucun dock de raccourcis, graphique gratuit ou métrique fictive.

## Implémentation

Auditer les composants et les flux existants avant intégration ; ne pas remplacer le protocole d'invitation existant. Tester clavier, mobile, états vides et contrastes WCAG AA. Voir issue #579 et `docs/studio/AUDIT.md`.

## Maquette validée — 03 novembre 2026

La capture de référence approuvée est **Hive Studio v1.0**, avec sidebar sombre à gauche, projet NextendoDrop en haut, bannière montagne derrière le titre, saisie de mission, suivi Shopify, conversation et éditeur côte à côte, agents/activité/collaboration à droite. Ne pas utiliser une refonte surchargée.

### Critères d'intégration

Conserver les proportions, la hiérarchie, les labels et les interactions de la capture ; utiliser de vrais composants accessibles, responsive, et de vraies données. L'image de référence ne doit jamais être utilisée comme fond de tout le dashboard. La bannière, elle, est décorative et peut être intégrée en CSS avec dégradé de lisibilité.

Les données de la capture (NextendoDrop, Shopify, 72 %, ETA, avatars, stockage) sont **fictives** : l'application affiche les projets, missions, agents et événements réels de la ruche, ou un état vide qui le dit.

**Statut des binaires :** ajoutés le 03/11/2026 depuis le pack `hive-studio-github-ready.zip`, aux emplacements ci-dessus.
