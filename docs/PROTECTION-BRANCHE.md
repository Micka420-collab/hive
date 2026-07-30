# Protéger `main` — les réglages exacts

> Ce document existe parce qu'une PR a atteint `main` sans que sa CI ait pu la
> rejeter, et a laissé la branche par défaut **non compilable**. Les réglages
> ci-dessous auraient arrêté exactement ça.

## Ce qui s'est passé, en une ligne

La PR #92 a été fusionnée avant que ses quatre pattes ne rendent leur verdict.
Elle supprimait 861 lignes de `src/cli.ts`, cassait dix chaînes de caractères
(`Unterminated string literal`), et renommait deux commandes par faute de frappe
— `livrer` → `liverer`, `conseil` → `consiel`. `main` ne compilait plus.

Rien de tout cela n'était subtil : la CI l'aurait dit en trois minutes.

## Les six réglages

**GitHub → Settings → Branches → Add branch protection rule**

| Réglage                                          | Valeur | Ce que ça empêche                                                                       |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| Branch name pattern                              | `main` | —                                                                                       |
| Require a pull request before merging            | ✅     | un `push` direct qui contourne toute vérification                                       |
| Require status checks to pass before merging     | ✅     | **le défaut de #92**                                                                    |
| Require branches to be up to date before merging | ✅     | deux PR vertes séparément et rouges ensemble                                            |
| Do not allow bypassing the above settings        | ✅     | sinon la règle ne s'applique pas à l'administrateur, c'est-à-dire à vous                |
| Allow force pushes / deletions                   | ❌     | un historique publié qu'on réécrit est un historique perdu pour tous ceux qui l'avaient |

### Les quatre contrôles à exiger, au caractère près

GitHub les identifie par leur **nom exact**. Une lettre de travers et le
contrôle n'est jamais exigé — la protection a l'air posée et ne garde rien.
C'est le même mode d'échec que tout le reste de ce journal : quelque chose qui
paraît en place et que personne ne vérifie.

```
ubuntu-latest · Node 24 · Lint · Typecheck · Tests · Build
windows-latest · Node 24 · Lint · Typecheck · Tests · Build
macos-latest · Node 24 · Lint · Typecheck · Tests · Build
L'image se construit, et la ruche y démarre
```

Les séparateurs sont des **points médians** (`·`, U+00B7), pas des points. Le
plus simple est de les copier depuis ce fichier, ou de les choisir dans la liste
que GitHub propose après un premier passage de CI.

## Comment vérifier que la protection MARCHE

Un réglage qu'on n'a pas vu refuser quelque chose est une intention, pas une
protection. La vérification tient en une PR :

1. ouvrez une PR quelconque ;
2. avant la fin de la CI, le bouton _Merge_ doit être **grisé**, avec
   « Required statuses must pass before merging » ;
3. si le bouton reste cliquable, un des quatre noms est faux.

## Et la fusion, alors ?

Une fois la protection posée, deux chemins :

**`npm run fusionner`** — porte la branche sur `main` en avance rapide. Aucun
commit de fusion n'est fabriqué, donc aucun commit ne porte un committer que
personne n'a choisi. Le script refuse plutôt que de forcer : arbre sale, base
qui a bougé, committer inattendu.

**Le bouton _Merge_ de GitHub** — fonctionne aussi, mais GitHub fabrique le
commit de fusion côté serveur, avec `noreply@github.com` comme committer. C'est
sans conséquence sur le code ; ça rend simplement chaque fusion « Unverified »,
et ce n'est pas corrigeable après coup sans réécrire `main`.

## Ce que la protection ne fait PAS

Elle n'empêche pas une PR **verte** d'être mauvaise. #92 aurait été arrêtée
parce qu'elle ne compilait pas — mais une réécriture qui compile et qui renomme
`livrer` en `liverer` passerait. Ce qui attrape celle-là, c'est la relecture du
diff : **861 lignes supprimées sous un titre qui annonce une validation de trois
lignes** est un signal en soi, indépendamment de la CI.
