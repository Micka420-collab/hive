# Hive Studio — assets visuels (référence validée)

Maquette de référence : **Hive Studio v1.0**, thème sombre et accents orange. Ne pas utiliser la maquette générique ni la v2.0 surchargée.

## Fichiers
- `mountain-sunset.svg` : bannière montagne/coucher de soleil vectorielle légère, **interprétation simplifiée** du panorama, et non reproduction pixel à pixel.
- Le panorama photoréaliste généré est fourni séparément dans le pack de conversation ; il devra être ajouté en WebP après validation.

## Placement
Bannière décorative dans l'en-tête central, sous la barre supérieure et derrière la salutation ; ne jamais couvrir la saisie de mission. Utiliser `background-size:cover; background-position:center;` avec un dégradé sombre garantissant le contraste du texte. L'image doit être décorative (`aria-hidden`), avec repli couleur unie si chargement impossible.

## Contrat UX
Une seule navigation à gauche. En haut : projet actif, statut, recherche, actions et aide. Au centre : mission, progression, conversation/plan et éditeur. À droite : agents, activité et bouton « Inviter ». Panneau droit repliable. Aucun dock de raccourcis, graphique gratuit ou métrique fictive.

## Implémentation
Auditer les composants et les flux existants avant intégration ; ne pas remplacer le protocole d'invitation existant. Tester clavier, mobile, états vides et contrastes WCAG AA. Voir issue #579.


## Maquette validée — 03 novembre 2026
La capture de référence approuvée est **Hive Studio v1.0**, avec sidebar sombre à gauche, projet NextendoDrop en haut, bannière montagne derrière le titre, saisie de mission, suivi Shopify, conversation et éditeur côte à côte, agents/activité/collaboration à droite. Ne pas utiliser une refonte surchargée.

### Ressources binaires à intégrer
- `dashboard/public/assets/hive-studio/dashboard-reference.png` : rendu visuel haute résolution, **référence de conception uniquement**, non fonctionnelle.
- `dashboard/public/assets/hive-studio/mountain-sunset.webp` : panorama haute qualité optimisé pour le web ; PNG source conservé pour réexport.
- Ne pas confondre `mountain-sunset.svg` (version vectorielle simplifiée déjà présente) avec la photographie panoramique WebP.

### Critères d'intégration
Conserver les proportions, la hiérarchie, les labels et les interactions de la capture ; utiliser de vrais composants accessibles, responsive, et de vraies données. L'image de référence ne doit jamais être utilisée comme fond de tout le dashboard. La bannière, elle, est décorative et peut être intégrée en CSS avec dégradé de lisibilité.

**Statut des binaires :** préparés hors dépôt ; leur ajout doit être confirmé séparément. Ne pas supposer qu'ils sont déjà commités.
