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
