# ADR 0002 — Où servir les scripts d'installation, et à quoi tient leur confiance

- **Statut** : accepté (lot 0 de la mission « L'ACCUEIL », validé le 2026-07-27)
- **Date** : 2026-07-27
- **Concerne** : §7.2.1, §7.3.1, §11.6 et §19.2 de `MISSION-ACCUEIL.md`

## Contexte

La mission demande deux one-liners :

```
irm https://hive.<domaine>/install.ps1 | iex          # Windows
curl -fsSL https://hive.<domaine>/install.sh | sh     # Linux, macOS
```

Il n'existe aujourd'hui aucun domaine `hive.*`. Le dépôt publie déjà une
vitrine statique sur GitHub Pages (`micka420-collab.github.io/hive/`), déployée
par `.github/workflows/pages.yml` depuis le dossier `site/`, qui ne contient
aucun script.

## Options pesées

**A. Domaine acheté (`hive.<quelquechose>`).** URL courte et mémorable, et
surtout un **ancrage de confiance indépendant** : le domaine n'appartient qu'à
nous. Coût : un achat, un renouvellement à ne pas oublier, une configuration
DNS et TLS. Un domaine expiré qui sert un `install.sh` est un scénario de
compromission, pas un incident cosmétique.

**B. GitHub Pages existant.** Gratuit, déjà déployé, TLS fourni, aucun secret à
garder. URL longue, et le sous-domaine `github.io` est **partagé avec tous les
utilisateurs de GitHub** : il n'atteste de rien à lui seul.

**C. `raw.githubusercontent.com`.** Sert la branche vivante — donc ce que sert
l'URL change au prochain commit, sans version ni immuabilité. Écarté.

## Décision

**GitHub Pages existant** — `site/install.sh` et `site/install.ps1`, servis
depuis le déploiement déjà en place.

Et, plus important que le choix d'hébergeur : **la confiance ne repose pas sur
l'URL, mais sur l'empreinte**. Chaque Release GitHub publie le SHA-256 des deux
scripts. Le README montre systématiquement, à côté du one-liner, la variante en
trois gestes :

```sh
curl -fsSLO https://micka420-collab.github.io/hive/install.sh
sha256sum install.sh          # comparer à l'empreinte de la Release
less install.sh               # le lire
sh install.sh
```

Le `curl | sh` reste proposé parce que le refuser ne fait pas disparaître
l'usage — il fait juste partir les gens. Mais il n'est jamais présenté seul, et
le script lui-même **affiche son empreinte** avant d'agir.

## Conséquences

- `pages.yml` déploie déjà `site/**` : les scripts sont publiés sans nouveau
  workflow, mais le filtre `paths` les couvre déjà.
- Le job de Release (lot 8) calcule et attache les deux empreintes.
- Le domaine propre reste possible plus tard : un `CNAME` dans `site/` suffit,
  et les anciennes URL continueraient de fonctionner par redirection. **Migrer
  vers A depuis B est facile ; l'inverse casse les liens publiés.** C'est
  l'argument qui fait choisir B maintenant.
- Aucun des deux scripts n'appelle `sudo`, n'installe Node, ni ne modifie le
  `PATH` : ils détectent, expliquent, et donnent la commande (§7.5).
- Limite assumée : GitHub Pages ne permet pas de fixer les en-têtes de réponse.
  On ne peut donc pas garantir un `Content-Type` particulier. Ça n'a pas
  d'incidence sur `curl | sh`, qui ne le regarde pas.
