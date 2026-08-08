# Definition of Done — la sortie de Hive

> Chaque point de sortie du carnet (`docs/ETAPES.md`) répète la même phrase :
> _« aucun definition of done de sortie n'est écrit ni mesuré ; seul
> l'installation l'est »_. Ce fichier est cet instrument manquant.
>
> **La règle qu'il tient : un critère qui n'est pas MESURÉ n'est pas ATTEINT, et
> il se dit comme tel.** Un ✅ ici veut dire qu'une commande ou un banc a rendu
> le verdict — pas qu'on le croit. Le reste porte son vrai visage :
>
> - ✅ **atteint** — mesuré, la preuve est nommée ;
> - ❌ **non atteint** — pas encore fait, ou pas encore mesuré ;
> - 🔒 **hors d'atteinte** — dépend de comptes ou de machines qui ne sont pas
>   les miens ; à DIRE, jamais à simuler ;
> - 👤 **décision de l'utilisateur** — un arbitrage d'édition ou de commerce qui
>   ne se tranche pas depuis le code.
>
> On ne coche rien de tête. Les chiffres de cette page sont ceux d'une mesure
> datée ; quand la mesure vieillit, on la refait avant de s'y fier.

## A. Le code tient — ✅ mesuré (arbre `b166399`, 7 août 2026)

| Critère                  | Comment on le mesure                                     | Verdict                                            |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| Typage (hub + tableau)   | `npm run typecheck` && `npm run typecheck:dashboard`     | ✅ vert / vert                                     |
| Qualité (style + format) | `npm run lint` (eslint + `prettier --check`)             | ✅ vert                                            |
| Suite de bancs           | `npm test` (vitest run)                                  | ✅ **3501** (3494 verts, 7 ignorés, **0 rouge**)   |
| Trois OS × Node 24       | matrice CI `ubuntu` / `windows` / `macos`                | ✅ 5 jambes vertes (run `31133288061`)             |
| L'image démarre          | jambe CI « L'image se construit, et la ruche y démarre » | ✅ verte                                           |
| Rien de neuf n'est nu    | `npm run loupe` (mutation sur le diff ajouté)            | ✅ « rien de nu » (base `946b36b`, 8 mutants tués) |

## B. On l'installe — ✅ mesuré, avec une réserve DITE

Les **10 critères mesurables de l'installation** (`docs/ETAPES.md § « Les 10
critères mesurables »`) sont tenus et éprouvés : `installer-assistant.test.ts`,
`installer.test.ts` (27 bancs), `deploiement-sans-ecran.test.ts` (8 bancs, loupe
7/7), `tui-terminal.test.ts`, `tui-rendu.test.ts`, `paquet.test.ts`. Mesure de
bout en bout : `sh install.sh` sur Node 24 dans un dossier vide → **23,3 s,
code 0**, `.env` en 0600, `hive doctor` rend **10 ✔** ; **3** décisions en
interactif, **0** avec `--non-interactive`.

- 🔒 **Réserve, à ne pas maquiller** : le banc du critère 1 est un conteneur
  Linux Node 24, **PAS une VM Windows ni macOS vierge**. « Marche sur les 3 OS »
  veut dire _le code passe la CI sur les trois_, **pas** _l'installation réussit
  sur le poste réel d'un utilisateur_. La nuance est le critère, pas une note en
  bas de page.

## C. C'est défendu — ✅ mesuré et gardé (le gate a mordu à sa naissance)

Livré et couvert par des bancs : **Les Gardiennes** (contrôle d'entrée du
nectar), les audits adversariaux de nuit, les failles fermées (injection Hive
Mind, secret de session `HIVE_JWT_SECRET`, import d'un chemin absolu sous
Windows).

- ✅ **Gate câblé** : `npm audit --audit-level=high` est désormais une étape de
  la CI (jambe `ubuntu`, `.github/workflows/ci.yml`). Il a trouvé **2 vulns
  hautes le jour où il est né** — `brace-expansion` (DoS, `GHSA-rgw5-rvv9-x895`)
  et `fast-uri` (host confusion, `GHSA-7p8r-x3mc-p8w7`), toutes deux
  transitives —, fermées par `npm audit fix` (`package-lock.json` seul). Mesure
  après fix : **0 vulnérabilité**. Coût assumé et voulu : un avis publié demain
  sur une transitive rougira la CI sans changement de code — une vuln haute qui
  dort est pire qu'une CI qui la nomme.
- ⚠️ **L'angle mort du DÉCLENCHEUR, et comment on le couvre** : ce gate ne tourne
  qu'à l'ouverture ou la mise à jour d'une PR. Un avis publié ENTRE deux
  livraisons reste donc invisible en CI jusqu'au prochain push. Ce n'est pas une
  vue de l'esprit : `nanoid` < 3.3.17 (boucle infinie quand `size` vaut zéro,
  `GHSA-2v37-7h3g-55p8`) est tombé après le câblage, et c'est un `npm audit`
  **local** périodique — pas la CI — qui l'a attrapé et fermé (#196). Leçon
  générale : câbler une garde ne suffit pas si son **déclencheur** ne couvre pas
  tous les moments où le risque survient. Tant qu'aucune exécution **planifiée**
  ne double ce gate, « gardé » vaut **à la livraison** ; entre deux livraisons,
  ça tient à l'habitude d'auditer localement.

## D. Couverture — ❌ pas un critère, mais enfin RE-MESURÉE et REPRODUCTIBLE

**Le trou trouvé et fermé ce tour :** `npm run couverture` (`vitest run
--coverage`) exige un fournisseur, `@vitest/coverage-v8`, qui est une dépendance
de pair **optionnelle** de vitest — il n'entre PAS avec lui. Il n'était **pas
déclaré** dans `devDependencies` ; un `npm ci` propre ne l'installait donc
jamais, et la commande mourait sur `MISSING DEPENDENCY  Cannot find dependency
'@vitest/coverage-v8'`. Le « re-mesurée et reproductible » du commit `70cd3ad`
tenait à un reliquat dans `node_modules`, pas à une dépendance déclarée : depuis
un clone vierge, l'instrument ne se relançait pas. Corrigé : le fournisseur est
désormais **déclaré** (`@vitest/coverage-v8` en `devDependencies`) et **gardé**
par un banc (`tests/couverture-reproductible.test.ts`, muté rouge : il lie le
fournisseur déclaré au `provider` de `vitest.config.ts` et exige qu'il se
résolve).

**Mesure datée, depuis le fournisseur fraîchement installé (8 août 2026,
arbre `1f0a71d` + ce lot) :**

| Dimension    | Couverture  | Détail          |
| ------------ | ----------- | --------------- |
| Lignes       | **75,43 %** | 9 138 / 12 113  |
| Branches     | 69,48 %     | 7 402 / 10 652  |
| Fonctions    | 74,33 %     | 2 207 / 2 969   |
| Instructions | 74,19 %     | 10 384 / 13 995 |

**Aucun seuil de couverture n'est défini comme condition de sortie.** La
couverture n'est pas un gate : elle se mesure (et le fait, maintenant, de façon
reproductible), elle ne barre rien. Le verdict qui BARRE reste le balayage par
mutation (`npm run loupe`), qui dit ce qui est GARDÉ là où la couverture ne dit
que ce qui est EXÉCUTÉ.

## E. Présentable — ❌ / 🔒 / 👤 : ce qui n'est pas du code

- 👤 ❌ **Identité visuelle de la vitrine** (#63, 13→7 sections) : la première
  impression d'un arrivant. Décision d'édition de l'utilisateur — la page
  publique ne se reskine pas de tête. Non atteint.
- ❌ **README GitHub au design de la vitrine** : la première impression côté
  dépôt, en aval de #63. Non atteint.
- 🔒 **Paquet npm signé** (lot 7), **image officielle GHCR + `cosign`** (lot 10) :
  pas mes comptes ni mes clés. `curl … | sh` depuis le dépôt marche sans eux ;
  « `npm i -g` » et « `docker pull` » d'un artefact officiel restent une décision
  et des identifiants humains.
- 👤 **Tarifs de la vitrine** : décision commerciale de l'utilisateur.

## Verdict honnête

Le **code**, l'**installation** (en CI) et le **socle de sûreté** — désormais
gardé par `npm audit --audit-level=high` en CI — sont mesurés et tenus. Ce qui
manque à une sortie « présentable » n'est pas du code : c'est **(1)** une
identité de vitrine tranchée, **(2)** des artefacts publiés sous des comptes qui
ne sont pas les miens, et **(3)** UN gate encore non câblé — un seuil de
couverture — si l'on veut que « couvert » ait, lui aussi, une cible qui rougit
d'elle-même. Aucun de ces manques n'est caché derrière un ✅.
