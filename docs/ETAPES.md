# Carnet des étapes

> L'état RÉEL du projet face à ses propres promesses — pas ce qu'on aimerait
> cocher.
>
> Deux sources : les **11 lots** de `MISSION-ACCUEIL.md` §13, et les **10
> critères** du definition of done (§4). Une ligne ne passe à ✅ que si quelque
> chose la VÉRIFIE : un test, une CI, une mesure. « Le code existe » ne suffit
> pas — c'est exactement comme ça qu'on se retrouve avec une règle écrite et un
> câblage absent.

---

## Les 10 critères mesurables

| #   | Critère                                                                  | État | Ce qui le vérifie, ou ce qui manque                                                                                                                          |
| --- | ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Machine nue → ruche qui tourne en **une commande**, **≤ 3 décisions**    | ⛔   | Aucun `install.sh` / `install.ps1`. La commande unique n'existe pas encore.                                                                                  |
| 2   | **< 60 s** hors téléchargement npm                                       | ⛔   | Jamais chronométré. L'installeur a `--timings`, personne ne l'a mesuré.                                                                                      |
| 3   | **0 nouvelle dépendance runtime** — TUI en ANSI à la main                | ✅   | `tests/paquet.test.ts` : `dependencies` = `['simple-git', 'ws']`, point.                                                                                     |
| 4   | Relançable **n fois** sans effet de bord                                 | ✅   | `tests/installer.test.ts` (27 tests) : « préserve chaque valeur existante », « complète les clés absentes sans toucher aux autres ».                         |
| 5   | Fonctionne **sans TTY** (CI, ssh, pipe)                                  | ✅   | `tests/tui-terminal.test.ts`.                                                                                                                                |
| 6   | `NO_COLOR=1`, `TERM=dumb`, 80 colonnes                                   | ✅   | `tests/tui-rendu.test.ts` + `tests/reglages-documentes.test.ts`, sur un module pur.                                                                          |
| 7   | **CI verte sur `ubuntu-latest` ET `windows-latest`**                     | ✅   | Atteint. macOS reste à ouvrir (lot 6 en demande 3).                                                                                                          |
| 8   | `hive doctor` diagnostique **10 causes** + quoi faire                    | ✅   | **12** diagnostics, un test par cas, panne **et** sain.                                                                                                      |
| 9   | Déploiement **sans écran** : `--non-interactive` + env + codes de sortie | 🟡   | Drapeaux et codes existent (`src/args.ts`, `src/codes-sortie.ts`). **`examples/` ne contient que `projet-exemple.json`** — le script de bout en bout manque. |
| 10  | README **FR et EN** + `CHANGELOG.md` à jour                              | ✅   | Les trois existent et sont tenus.                                                                                                                            |

**4 critères sur 10 ne sont pas tenus** (1, 2, 9 partiellement) — et les deux
premiers sont la porte d'entrée du projet.

---

## Les 11 lots

| #   | Lot                                                                  | État | Détail                                                                                     |
| --- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| 0   | Plan + ADR de cadrage                                                | ✅   |                                                                                            |
| 1   | `src/tui/rendu.ts` pur + tests de rendu                              | ✅   | 42 tests, aucune I/O.                                                                      |
| 2   | `terminal.ts` + installeur interactif                                | ✅   | Chemin A (Reine locale).                                                                   |
| 3   | Chemin B (billet) branché sur `join.ts`                              | ✅   | Un ami rejoint sans éditer un fichier.                                                     |
| 4   | Mode non-interactif, drapeaux, codes de sortie, `--dry-run`          | 🟡   | Implémenté et testé (`tests/args.test.ts`) ; pas de script reproductible dans `examples/`. |
| 5   | `hive doctor` + `--json`                                             | ✅   | 12 diagnostics.                                                                            |
| 6   | ACL Windows, chemins, **matrice CI 3 OS**                            | 🟡   | Windows fait et vert. **macOS absent.**                                                    |
| 7   | Paquet npm + `bin` + provenance                                      | 🚫   | **Bloqué** — compte npm de l'utilisateur.                                                  |
| 8   | `install.ps1`, `install.sh`, empreintes, Release                     | ⛔   | **Rien n'existe.**                                                                         |
| 9   | Service (systemd user / tâche planifiée / launchd) + désinstallation | ⛔   | **Rien n'existe.**                                                                         |
| 10  | Dockerfile, compose, GHCR signé, sauvegarde SQLite                   | 🟡   | GHCR/cosign **bloqués** ; Dockerfile et compose, non — et absents.                         |
| 11  | Docs FR/EN, CHANGELOG, `docs/INSTALLATION.md`                        | 🟡   | READMEs et CHANGELOG ✅. `docs/INSTALLATION.md` absent.                                    |

Légende — ✅ tenu et vérifié · 🟡 partiel · ⛔ à faire · 🚫 bloqué hors de mon
périmètre (comptes de l'utilisateur).

---

## Ordre de travail retenu, et pourquoi

1. **macOS dans la CI.** Meilleur rapport valeur/effort de la liste : une ligne
   de matrice, et c'est la plateforme où `launchd`, les chemins et les
   permissions diffèrent. La CI Windows a rendu **cinq défauts réels dont une
   perte de données** en s'ouvrant ; il n'y a aucune raison que macOS soit
   différent. Et ça débloque le lot 9 (launchd), qu'on écrirait à l'aveugle
   sinon.
2. **`install.sh` + `install.ps1` + `docs/INSTALLATION.md`.** C'est la promesse
   d'entrée — « une commande » — et elle n'est pas tenue. Sans eux, les critères
   1 et 2 sont invérifiables, pas seulement non vérifiés.
3. **Désinstallation + service.** Installer sans pouvoir désinstaller
   proprement, c'est ce qui fait qu'on n'essaie pas un outil. La désinstallation
   passe **avant** le service : elle est plus rassurante et plus simple à
   garantir.
4. **Dockerfile + compose + sauvegarde SQLite.** Faisable malgré le blocage
   GHCR. `docker compose up` doit marcher.
5. **Mesurer les critères 1 et 2.** En dernier, parce que ça n'a de sens
   qu'une fois l'installeur en place — et alors c'est une mesure, pas une
   affirmation.

---

## Ce qui restera hors d'atteinte, et qu'il faut dire

- **Lot 7 (npm)** et **la partie GHCR/cosign du lot 10** dépendent de comptes
  qui ne sont pas les miens. Le code peut être prêt ; la publication non.
- **Le critère 1 mesuré « sur VM propre Windows 11 + Ubuntu 24.04 »** au sens
  strict demande deux machines vierges. Ce qu'on peut faire ici : mesurer dans
  un conteneur propre, et **dire** que ce n'est pas la même chose.

---

## Dette connue, assumée, non bloquante

- Cinq lectures trient sur un horodatage seul (`listPartages`,
  `listLivraisons`, billets d'invitation, clés de nœud, sessions de conseil) :
  l'ordre entre deux lignes de même milliseconde est indéfini. **Rien ne se
  perd** — c'est un rang d'affichage. Les trois bornes qui SUPPRIMENT ont été
  départagées, et c'était la seule classe dangereuse.
- Un agent installé par npm reste **indétectable sous Windows** (`claude.cmd`,
  que `spawn` ne peut pas lancer sans interpréteur). `hive doctor` le dit sous
  la clé `agent`, donc ce n'est pas silencieux — mais ce n'est pas satisfaisant.
  Corriger demanderait de lancer autre chose que le shim, ce que la contrainte
  §5.1 rend délibérément difficile.
