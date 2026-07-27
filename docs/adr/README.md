# Décisions d'architecture (ADR)

Une décision structurante par fichier, dans l'ordre où elle a été prise, au
format **contexte / options pesées / décision / conséquences**.

Ce qu'un ADR sert à empêcher : qu'un choix soit refait six mois plus tard par
quelqu'un qui n'en connaît pas le prix, ou défait à la première difficulté
parce qu'il ressemblait à une contrainte arbitraire. Un ADR dit **ce qu'on a
écarté et pourquoi** — c'est la partie qui a de la valeur.

Un ADR ne se réécrit pas : il se remplace par un suivant qui le mentionne.

| #                                                       | Décision                                                                                                | Statut  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| [0001](0001-nom-du-paquet-npm.md)                       | Le paquet npm s'appelle `@micka420/hive`                                                                | proposé |
| [0002](0002-distribution-one-liners.md)                 | Les scripts d'installation sont servis par GitHub Pages ; la confiance tient à l'empreinte, pas à l'URL | proposé |
| [0003](0003-conteneur-orchestrateur-seul.md)            | Une image pour l'orchestrateur, aucune pour le nœud ; socle Node 22, plancher 20                        | proposé |
| [0004](0004-politique-de-service-et-desinstallation.md) | Le service est opt-in au niveau utilisateur ; la désinstallation ne touche jamais à l'état              | proposé |
| [0005](0005-motifs-de-refus-d-un-billet.md)             | Un billet refusé dit pourquoi, mais seulement quand le porteur connaissait déjà le secret               | proposé |
| [0006](0006-tui-sans-dependance.md)                     | Le TUI s'écrit à la main : c'est le premier code qu'on exécute avant de faire confiance au projet       | proposé |

Les six premiers viennent du lot 0 de `MISSION-ACCUEIL.md`. Ils passeront
d'« proposé » à « accepté » à la validation du `PLAN.md`.
