# Décisions d'architecture (ADR)

Une décision structurante par fichier, dans l'ordre où elle a été prise, au
format **contexte / options pesées / décision / conséquences**.

Ce qu'un ADR sert à empêcher : qu'un choix soit refait six mois plus tard par
quelqu'un qui n'en connaît pas le prix, ou défait à la première difficulté
parce qu'il ressemblait à une contrainte arbitraire. Un ADR dit **ce qu'on a
écarté et pourquoi** — c'est la partie qui a de la valeur.

Un ADR ne se réécrit pas : il se remplace par un suivant qui le mentionne.

| #                                                       | Décision                                                                                                | Statut      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| [0001](0001-nom-du-paquet-npm.md)                       | Le paquet npm s'appelle `@micka420/hive`                                                                | accepté     |
| [0002](0002-distribution-one-liners.md)                 | Les scripts d'installation sont servis par GitHub Pages ; la confiance tient à l'empreinte, pas à l'URL | accepté     |
| [0003](0003-conteneur-orchestrateur-seul.md)            | Une image pour l'orchestrateur, aucune pour le nœud ; socle Node 22, plancher 20                        | accepté     |
| [0004](0004-politique-de-service-et-desinstallation.md) | Le service est opt-in au niveau utilisateur ; la désinstallation ne touche jamais à l'état              | accepté     |
| [0005](0005-motifs-de-refus-d-un-billet.md)             | Un billet refusé dit pourquoi, mais seulement quand le porteur connaissait déjà le secret               | accepté     |
| [0006](0006-tui-sans-dependance.md)                     | Le TUI s'écrit à la main : c'est le premier code qu'on exécute avant de faire confiance au projet       | accepté     |
| [0007](0007-portee-du-jeton-de-ruche.md)                | Le jeton de ruche est une clé maîtresse : ce qu'il ouvre, et ce qu'un billet ouvre à sa place           | accepté     |
| [0008](0008-l-atelier-un-bureau-pour-l-ouvriere.md)     | L'Atelier : un bureau que l'ouvrière peut allumer — cinq décisions de sécurité à trancher               | **proposé** |

Les **0001 à 0006** viennent du lot 0 de `MISSION-ACCUEIL.md`. Le **0007** est
venu ensuite, avec le partage par billets. Le **0008** n'est pas encore tranché :
il attend une validation humaine, et son statut le dit.

Le **0005** a été accepté en dernier, et séparément : c'était le seul à demander
de toucher à l'orchestrateur, ce que le §16 de la mission met hors périmètre.
Une entorse à une règle qu'on s'est donnée ne se prend pas en silence parce
qu'elle arrange — celle-ci a attendu, puis a été tranchée **après lecture du
code**, qui a montré que l'arbitrage supposé n'était pas le bon : l'oracle que
le §16 semblait protéger était déjà ouvert, et mesurable au chronomètre.
