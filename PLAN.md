# PLAN — Mission « L'ACCUEIL »

> Lot 0 de `MISSION-ACCUEIL.md`. Découpage, ordre, et ce que chaque lot rend
> vérifiable. **Rien n'est codé avant validation de ce document** (§17.1).

---

## 0. Ce que la lecture du dépôt a changé au plan

La mission suppose plusieurs choses qui ne sont pas vraies aujourd'hui. Les
dire maintenant coûte une page ; les découvrir au lot 7 coûterait le lot 7.

### 0.1 Il n'y a pas de `dist/`, et rien ne transpile

`tsconfig.json` et `dashboard/tsconfig.json` portent **tous les deux
`noEmit: true`**. Le seul artefact construit du dépôt est `dashboard/dist/`,
par Vite. Le code serveur et la CLI ne sont **jamais** compilés : tout tourne
via `tsx` depuis les sources TypeScript.

Conséquence directe : `bin: { hive: "./dist/cli.js" }` (§7.1) ne décrit pas un
réglage à poser, mais **une chaîne de compilation à construire** — un troisième
tsconfig émetteur, un `outDir`, un `files`, et le retrait de `tsx` du chemin
d'exécution (c'est une `devDependency` ; un paquet installé ne peut pas s'y
fier). C'est un lot à part entière, et c'est le vrai préalable des lots 7 et 8.

### 0.2 Le paquet, tel quel, est impubliable

`dependencies` contient les 18 paquets du **front** : React, React-DOM,
React-Router, six paquets CodeMirror, et Galacean (le bundle de rendu 3D pèse
1,15 Mo à lui seul). Un `npx @micka420/hive` téléchargerait aujourd'hui toute
la chaîne graphique pour afficher un menu de terminal.

Trier `dependencies` / `devDependencies` est donc un préalable de publication,
pas une coquetterie. Le dashboard est **construit** puis servi en statique :
ses paquets sont des dépendances de build.

### 0.3 `join.ts` ne câble AUCUN isolement

`src/node-client/main.ts:33-55` décide l'isolement (`modeDepuisEnv` →
`trouverFournisseur` → `decider`), refuse de démarrer en `exige` sans moteur, et
passe `bac: { fournisseur, variables }` au client. **`join.ts` ne fait rien de
tout cela** : aucun import de `isolement.js`, aucune option `bac`.

Un nœud lancé par `npm run join` tourne donc **toujours** en sandbox de
processus, jamais en conteneur — et `HIVE_ISOLEMENT=exige` y est sans effet.
Or `join` est précisément le chemin que cette mission veut rendre principal
pour les amis, c'est-à-dire **pour les machines de gens qui ne liront pas
`.env.example`**. Le lot 3 ne peut pas se contenter de « brancher le billet » :
il doit aligner `join` sur `main`.

### 0.4 La ruche ne dit jamais POURQUOI un billet est refusé

`server.ts:1272-1275` répond `401 { error: 'billet refusé' }` pour **tous** les
motifs. `acces.ts` en distingue six (`inconnu`, `revoque`, `expire`, `epuise`,
`secret_invalide`, `course_perdue`) mais ils ne partent qu'au journal, via
`emitEvent('invite_rejected')`.

La mission exige (§5 B) : « Si le billet est expiré/consommé, dis-le **en
clair** avec la marche à suivre — c'est le cas d'échec le plus fréquent et le
plus vexant. » **C'est impossible côté client.** Il faut une modification du
serveur — petite, mais qui touche l'orchestrateur, que §16 met hors périmètre.
Et le flou actuel n'est pas un oubli : distinguer « inconnu » d'« expiré » est
un oracle, même modeste. Voir l'ADR 0005 : la décision proposée est de
distinguer **uniquement** les motifs qui n'apprennent rien à un attaquant
(`expire`, `epuise`, `revoque` — tous supposent un billet **authentifié**),
et de laisser `inconnu` et `secret_invalide` indiscernables.

### 0.5 Trois trous de permissions, tous dans le périmètre du §7.2.5

1. `join.ts:42` écrit `node-id.txt` **sans mode** (0666 & umask).
2. `installer-main.ts:56` complète un `.env` **existant** avec `mode: 0o600` —
   or `mode` ne s'applique qu'à la **création**. Un `.env` écrit à la main garde
   donc ses permissions d'origine, quelles qu'elles soient.
3. Aucune ACL Windows nulle part : sur Windows, `0o600` est décoratif.

### 0.6 L'idempotence exigée au §12 n'est pas vraie aujourd'hui

`installer-main.ts:56` régénère le fichier **entier** via `rendreEnv` quand une
clé manque : les valeurs sont préservées, mais l'ordre, les commentaires et la
mise en forme de l'humain sont remplacés. Un `.env` écrit à la main n'est donc
pas « identique octet pour octet » après passage. Le test du §12 échouerait —
à raison. Le lot 4 doit compléter **par ajout en fin de fichier**, sans toucher
à ce qui précède.

### 0.7 Le `.env` de la CLI est chargé trop tard

`cli.ts:48-52` appelle `process.loadEnvFile('.env')` avant le second bloc
d'`import`, **textuellement**. En ESM les imports sont hissés et évalués
d'abord : tout module qui lit `process.env` au moment de son évaluation ne voit
pas le `.env`. Ça ne se voit pas aujourd'hui (les lectures sont paresseuses),
mais `hive doctor` et le mode non-interactif vont en dépendre.

### 0.8 Détail sans conséquence

Le §2 de la mission donne `src/installer.ts` à 217 lignes et les README à 538 ;
ils font aujourd'hui 251 et 549/536. Rien à faire, c'est noté pour que personne
ne croie lire un autre dépôt.

---

## 1. Les lots

Chaque lot est **un commit atomique** et laisse le dépôt vert (`lint`,
`typecheck`, `typecheck:dashboard`, `test`, `build`). L'ordre est celui du §18,
réordonné par les dépendances réelles trouvées ci-dessus.

> **Note de procédure.** La mission dit « un lot = une PR » (§17.3). Cette
> session travaille sur une branche imposée ; les lots y seront donc des
> **commits atomiques successifs**, et la PR regroupera les lots livrés. Le
> découpage en commits reste celui du tableau : chacun est relisible seul.

| Lot    | Contenu                                                                                                                                                                                | Rend vérifiable                                                                                                  | Dépend de |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| **0**  | Ce plan, `MISSION-ACCUEIL.md`, ADR 0001-0006.                                                                                                                                          | Le plan.                                                                                                         | —         |
| **1**  | `src/tui/rendu.ts` — pur. Cadres, listes, badges, spinner (frames), largeur, dégradations.                                                                                             | Snapshots FR : couleur / `NO_COLOR` / non-TTY / 60 / 80 / 200 colonnes. Aucune I/O.                              | 0         |
| **2**  | `src/tui/terminal.ts` — impur : raw mode, flèches, `^C` → 130, restauration en `finally`. Refonte de `installer-main.ts` sur le chemin A.                                              | Chemin A de bout en bout, jeton montré une fois, récapitulatif avant écriture.                                   | 1         |
| **3**  | Chemin B (billet) + **alignement de `join.ts` sur l'isolement** (§0.3) + motifs de refus lisibles (§0.4, ADR 0005).                                                                    | Un ami rejoint sans éditer un fichier ; `HIVE_ISOLEMENT=exige` refuse aussi en `join` ; un billet expiré le dit. | 2         |
| **4**  | `src/args.ts` pur (drapeaux, `--x=v` **et** `--x v`), `--non-interactive`, `--dry-run`, `--json`, `--yes`, codes de sortie, **écriture atomique + complétion par ajout** (§0.5, §0.6). | Script serveur reproductible dans `examples/` ; un test par code de sortie ; `.env` idempotent octet pour octet. | 2         |
| **5**  | `src/doctor.ts` pur (verdicts) + sondes injectées, `hive doctor --json`.                                                                                                               | 11 diagnostics, chacun testé en panne **et** sain.                                                               | 4         |
| **6**  | ACL Windows (`icacls`), chemins (`path.join`, espaces, accents), matrice CI 3 OS × Node 20/22.                                                                                         | CI verte sur ubuntu / windows / macos.                                                                           | 4         |
| **7**  | **Chaîne de compilation** : `tsconfig.build.json` émetteur, `dist/`, tri `dependencies`/`devDependencies`, `files`, `bin`.                                                             | `node dist/cli.js --help` marche sans `tsx`.                                                                     | 4         |
| **8**  | Publication npm : `private` retiré, nom (ADR 0001), `npm publish --provenance` via OIDC.                                                                                               | `npx @micka420/hive@latest` affiche l'écran du §6.2.                                                             | 7         |
| **9**  | `site/install.sh` + `site/install.ps1` (ADR 0002), empreintes SHA-256 publiées dans la Release.                                                                                        | Les deux one-liners, empreinte vérifiable.                                                                       | 8         |
| **10** | Service : systemd `--user`, tâche planifiée Windows, `launchd`. `hive service install\|status\|logs\|uninstall`.                                                                       | `install` puis `uninstall` sans résidu.                                                                          | 6         |
| **11** | Dockerfile multi-stage non-root, `compose.yaml`, GHCR signé cosign, sauvegarde `VACUUM INTO`.                                                                                          | `docker compose up` ; `HEALTHCHECK` vert.                                                                        | 7         |
| **12** | `docs/INSTALLATION.md`, README FR/EN (installation en tête), `CHANGELOG.md`.                                                                                                           | Revue.                                                                                                           | tous      |

### Ce que chaque lot ajoute en tests

- **1** — `tests/tui-rendu.test.ts` : rendu pur, une assertion par dégradation
  du §6.4. Le test le plus important : **aucun code ANSI ne sort quand
  `NO_COLOR` est posé** — c'est la garantie qu'on peut brancher la sortie sur
  un fichier de log.
- **2** — restauration du terminal : un `^C` simulé pendant une question doit
  rendre le curseur et sortir en 130. Testé sur l'objet terminal injecté, pas
  sur un vrai TTY.
- **3** — `join` refuse en `exige` sans moteur ; chaque motif de refus lisible
  produit son message ; un billet valide passe (contrôle négatif).
- **4** — un test par code de sortie (0/1/2/3/4/5/130) ; idempotence octet pour
  octet sur un `.env` écrit à la main ; `--dry-run` n'écrit rien (vérifié par
  `mtime` inchangée) ; **un secret n'apparaît jamais dans `argv` ni dans une
  sortie** — ce dernier va dans `tests/security-invariants.test.ts`, qui existe.
- **5** — 11 diagnostics × 2 (panne / sain) = 22 cas, tous sur des sondes
  injectées.
- **6** — chemins Windows : espaces, accents, `C:\Users\Jean Dupont\…`.
- **7** — le paquet publié ne contient ni `tests/`, ni `dashboard/src/`, ni le
  `.env` de personne : un test qui lit le `files` résolu.
- **9** — les scripts servis par `site/` sont du POSIX `sh` sans bashisme
  (vérifié par lecture, pas par exécution) et n'appellent jamais `sudo`.

---

## 2. Ce que je ne ferai pas sans un mot de plus

Trois points où la mission demande quelque chose que je ne peux pas décider
seul, parce que la décision engage des comptes ou de l'argent.

1. **Publier sur npm** (lot 8) suppose un compte npm, un scope, et un secret
   OIDC côté dépôt. Je prépare tout jusqu'au `npm publish --dry-run` ; le
   premier vrai `publish` demande votre feu vert.
2. **Publier sur GHCR et signer avec cosign** (lot 11) : même chose, le
   workflow sera prêt et vérifiable, le premier push d'image est votre geste.
3. **Le manifeste winget** (§7.2.2) exige une PR sur un dépôt tiers
   (`microsoft/winget-pkgs`) et n'a de sens qu'une fois le paquet npm publié et
   stable. Je le prépare au lot 8, je ne le soumets pas.

---

## 3. Les questions du §19, tranchées

Chacune a son ADR. Résumé :

| #   | Question               | Décision                                                                                                                                                                                                                                      | ADR  |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Nom du paquet npm      | **`@micka420/hive`** — un scope n'est jamais squatté, et il nomme la provenance à qui lance un `npx` à l'aveugle.                                                                                                                             | 0001 |
| 2   | Domaine des one-liners | **GitHub Pages existant** (`micka420-collab.github.io/hive/install.sh`). Gratuit, déjà déployé, TLS. Le vrai ancrage de confiance n'est pas le domaine mais **l'empreinte publiée dans la Release**.                                          | 0002 |
| 3   | Image du nœud          | **Non.** Le nœud doit voir l'agent de codage et l'espace de travail de son hôte ; le conteneuriser oblige à monter le `$HOME`, ce qui annule le bénéfice. Seul l'orchestrateur est imagé.                                                     | 0003 |
| 4   | Node de l'image        | **22** pour l'image (LTS active), **`>=20`** reste le plancher supporté, CI teste les deux.                                                                                                                                                   | 0003 |
| 5   | `hive uninstall`       | **Le service oui, l'état non.** `service uninstall` retire tout ce que `service install` a posé. Rien ne supprime `.env` ni la base : la base est la mémoire de la ruche et le `.env` porte un jeton dont la perte déconnecte tous les nœuds. | 0004 |

Deux décisions supplémentaires que la lecture a rendues nécessaires :

| #   | Question                    | Décision                                                                                                                                                                                      | ADR  |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 6   | TUI sans dépendance         | **Confirmé, et c'est une décision, pas une contrainte subie** : la valeur du zéro-dépendance ici est la surface d'attaque d'un outil qu'on lance en `npx` avant de faire confiance au projet. | 0006 |
| 7   | Motifs de refus d'un billet | **Distinguer uniquement les motifs qui supposent un billet authentifié** (`expire`, `epuise`, `revoque`). `inconnu` et `secret_invalide` restent indiscernables.                              | 0005 |

---

## 4. Ce que je vérifierai à la fin, dans l'ordre

Reprise littérale du §4, avec la façon dont je le mesure ici (pas de VM
Windows dans cet environnement — je le dis plutôt que de le prétendre) :

| #   | Critère                              | Mesure réelle possible ici                                                                 |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | Une commande, ≤ 3 décisions          | Comptage des questions dans le chemin A. **Le chrono sur VM propre est à faire par vous.** |
| 2   | < 60 s                               | `--timings` mesuré et affiché ; la mesure hors npm est instrumentée.                       |
| 3   | 0 dépendance runtime nouvelle        | Diff de `dependencies` dans la PR.                                                         |
| 4   | Relançable n fois                    | Test d'idempotence octet pour octet.                                                       |
| 5   | Sans TTY                             | Test avec `isTTY: false` injecté.                                                          |
| 6   | `NO_COLOR`, `TERM=dumb`, 80 colonnes | Snapshots de rendu pur.                                                                    |
| 7   | CI verte ubuntu + windows            | Matrice CI — **vérifiable ici**, c'est GitHub qui l'exécute.                               |
| 8   | `doctor` : 10 causes                 | 11 diagnostics, un test par cas.                                                           |
| 9   | Serveur sans écran                   | Script de bout en bout dans `examples/`, exécuté en CI Linux.                              |
| 10  | README FR/EN + CHANGELOG             | Revue.                                                                                     |

**Ce que je ne pourrai pas prouver moi-même** : le rendu réel sur Windows
Terminal, ConHost et VS Code (§7.2.6), et le chrono sur VM propre (§4.1). La CI
Windows prouvera que le code **tourne** ; elle ne prouvera pas qu'il est
**joli**. Les captures demandées au §17.4 pour Windows devront venir de vous,
ou du lot 6 sous forme de sortie texte capturée en CI — ce qui n'est pas la
même chose, et je ne l'appellerai pas autrement.

---

## 5. Ordre de démarrage proposé

Lots **1 → 2 → 3 → 4 → 5**, puis **6 → 7 → 8 → 9**, puis **10 → 11 → 12**.

Le premier bloc rend l'accueil **réel** pour quelqu'un qui a cloné le dépôt.
Le deuxième le rend **atteignable** sans cloner. Le troisième le rend
**exploitable** sur un serveur.

Si vous ne validez qu'une chose : validez les lots 1 à 5. Ils ne dépendent
d'aucun compte externe, ils tiennent dans le périmètre du §16, et ils règlent
les quatre trous trouvés en §0.3 à §0.6 — dont un qui touche la sûreté des
machines de vos amis.
