# ADR 0001 — Le nom du paquet npm

- **Statut** : proposé (lot 0 de la mission « L'ACCUEIL »)
- **Date** : 2026-07-27
- **Concerne** : §7.1 et §19.1 de `MISSION-ACCUEIL.md`

## Contexte

Hive doit s'installer par `npx …`, sans clone préalable. Il lui faut donc un
nom sur le registre npm. `hive` y est pris ; `package.json` porte
aujourd'hui `private: true` et aucun champ `bin`.

Le nom n'est pas cosmétique. Quelqu'un qui lance `npx quelquechose` exécute du
code arbitraire **avant** d'avoir décidé de faire confiance au projet. Le nom
est la seule chose qu'il lit à ce moment-là.

## Options pesées

**A. `hive-ruche` (nom court, non scopé).** Lisible, mais il faut vérifier sa
disponibilité, et un nom non scopé reste exposé au typosquat de voisinage
(`hive-ruches`, `hiveruche`). Surtout, il ne dit **rien** de qui le publie.

**B. `hivectl`.** Convention d'outil en ligne de commande, très probablement
libre. Même défaut sur la provenance, et il oriente vers « client d'une chose
distante » alors que la commande installe et fait tourner la ruche elle-même.

**C. `@micka420/hive` (scopé).** Un scope appartient à son compte : il n'est
pas squattable, et la disponibilité du nom à l'intérieur est garantie. Le nom
complet **dit d'où vient le code**. Coût : `npm publish --access public` est
obligatoire (le défaut d'un scope est privé — une erreur classique), et la
commande est plus longue à taper.

## Décision

**`@micka420/hive`.**

Le raisonnement décisif est celui de l'exécution à l'aveugle. `npx
@micka420/hive` nomme le publieur dans la commande elle-même ; combiné à
l'attestation de provenance (`npm publish --provenance`, §7.1), quelqu'un peut
vérifier que le paquet a bien été construit par le dépôt GitHub annoncé, sans
nous croire sur parole. Un nom court fait gagner huit caractères et perd cette
propriété.

Le champ `name` du `package.json` change ; le nom du **projet**, de la
commande (`hive`) et du dépôt ne change pas.

## Conséquences

- `private: true` est retiré, `publishConfig: { access: "public" }` est ajouté
  — sans quoi la première publication échoue ou, pire, réussit en privé.
- `bin: { hive: "./dist/cli.js" }` : la commande reste `hive`, quel que soit le
  nom du paquet.
- La disponibilité de `hive` sur le registre n'a plus besoin d'être vérifiée :
  la décision la rend sans objet.
- Un renommage ultérieur vers un nom court reste possible (npm gère les alias
  de dépréciation), l'inverse ne l'est pas.
- **Non tranché ici** : le compte npm et le secret OIDC du dépôt. La première
  publication réelle demande un geste humain (voir `PLAN.md` §2).
