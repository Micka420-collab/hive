# ADR 0009 — L'évolution du code façon Darwin Gödel Machine : ce qu'on prend, ce qu'on refuse, ce qu'on diffère

**Statut : accepté (direction) — implémentation de la boucle DIFFÉRÉE après la
sortie du 2 septembre 2026.**

## Contexte

La demande : transformer Hive en plateforme d'évolution de code
auto-améliorante inspirée de la Darwin Gödel Machine (Sakana AI) — une
POPULATION de nœuds qui fait évoluer le code collectivement — en s'appuyant sur
Firecracker/Kata pour l'isolement, LangGraph/CrewAI pour l'orchestration,
AutoCover pour les tests, et une validation sur SWE-bench.

Cette décision s'appuie sur un relevé exhaustif du dépôt (6 domaines), une
enquête sourcée sur chaque brique nommée, une conception complète, puis une
CONTRADICTION adversariale à trois lentilles qui a trouvé **8 failles
bloquantes** dans le mécanisme de validation proposé. Le verdict des trois
lentilles converge : « excellente analyse d'architecture, mauvais plan de
sortie — ce qui tient : les refus ». On acte donc ici les refus (solides), la
carte de l'existant (mesurée), et l'on DIFFÈRE la boucle (défectueuse en
l'état) plutôt que de livrer un mécanisme de sûreté troué à 22 jours d'une
sortie.

## Ce que la ruche possède DÉJÀ (ne pas réinventer)

| Brique demandée              | Ce qui existe, où                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bac à sable                  | `src/node-client/isolement.ts` : podman > docker > bubblewrap, `--cap-drop=ALL`, un seul volume, secrets par NOM seul ; 3 régimes `HIVE_ISOLEMENT` (off/auto/**exige** = refus de travailler) ; garde structurelle anti-oubli (`tests/isolement-couverture.test.ts`) |
| Peer-review entre nœuds      | Les Gardiennes (`gardiennes.ts`, inspection par tâche×nœud), le conseil multi-modèles (critique croisée), les courses de drones (variantes en compétition, vainqueur enregistré)                                                                                     |
| Leçons évolutives            | Le Cerveau : épisodes → **consolidation à 3 récurrences** (`SEUIL_CONSOLIDATION = 3`, `cerveau.ts:316`, mutation 3→2 = 2 bancs rouges) ; invariants/leçons/décisions ne s'élaguent jamais                                                                            |
| Rôles d'agents               | Le Polyéthisme (`polyethisme.ts`) : castes gagnées sur pièces, pas déclarées                                                                                                                                                                                         |
| Autonomie bornée             | Plein Essaim (gouverné par les meilleures ouvrières) + La Dérive (borne la dégradation)                                                                                                                                                                              |
| Validation empirique         | La barrière (typecheck ×2, lint, 3 500+ bancs, CI 3 OS) + **la loupe** (mutation sur le diff) — c'est déjà le principe DGM « toute modification se valide empiriquement »                                                                                            |
| Exécution de vrais chantiers | `Chantiers` : la ruche lance les travaux DÉCLARÉS d'un dépôt, en local et sur GitHub                                                                                                                                                                                 |

**Auto-correction pilotée par un verdict indépendant : ZÉRO.** Le seul
« succès » d'une tâche est un booléen déclaré par le nœud lui-même. C'est le
vrai manque — et le cœur du travail d'après-sortie.

## Les refus, avec la raison (enquête sourcée, trois lentilles d'accord)

- **Firecracker : REFUS.** Exige KVM — macOS n'en a pas (incompatibilité
  totale, Intel comme Apple silicon) ; sous Windows il faut Windows 11 +
  virtualisation imbriquée + droits admin ; le jailer et `/dev/kvm`
  contredisent « aucun sudo, jamais » d'`install.sh`. Un moteur microVM
  pourra un jour s'ajouter DERRIÈRE le contrat `isolement.ts`, opt-in, hôtes
  Linux/KVM seulement — jamais comme palier par défaut.
- **Kata Containers : REFUS.** Même exclusion matérielle, et un plan de
  contrôle que Hive n'a pas (voie officielle : Kubernetes).
- **CrewAI : REFUS.** Python (903 Mo, 91 binaires natifs, fenêtre 3.10–3.13),
  casse l'installation en une commande (23,3 s mesurées) ; portages JS morts.
  N'apporte rien que le Polyéthisme ne fasse déjà.
- **LangGraph.js : REFUS architectural.** Techniquement propre, mais son cœur
  (persistance reprenable, voyage dans le temps) est déjà rendu par
  `replay.ts` — cohabiter produirait deux histoires divergentes de la ruche.
- **AutoCover : INACQUÉRABLE.** Système interne Uber, couplé Bazel, aucun
  code/paquet/service public. On reprend le PATRON (générer → exécuter →
  valider par mutation → réparer), pas l'outil : la loupe et les Chantiers en
  sont déjà les deux moitiés.
- **SWE-bench comme validation : DIFFÉRÉ (hors d'atteinte en service).** Un
  run DGM ≈ 22 000 USD et deux semaines. La validation empirique de la ruche
  est SA barrière + SA loupe sur SES chantiers. Un échantillon SWE-bench-lite
  pourra servir d'étalonnage ponctuel après la sortie.
- **Couverture 90 % comme gate : REFUS.** Position écrite du DoD : la
  couverture se mesure et ne barre rien ; le gate est la mutation. Changer
  cela = changer la définition de sortie, décision de l'utilisateur.
- **Auto-fusion sans revue humaine : REFUS.** `aLivrer` exige `approved` ;
  une contre-expertise ARME la revue, elle ne la remplace pas.
- **Boucle d'exploration auto-modifiable : REFUS.** Les auteurs de la DGM
  gardent eux-mêmes l'archive et la sélection hors de portée de l'agent.

## La direction acceptée (après la sortie)

La boucle évolutive réutilise le moteur qui existe (courses de drones =
génération de variantes ; Cerveau = archive ; Gardiennes/conseil = revue par
les pairs) et ajoute LA pièce manquante : **l'Épreuve** — un verdict de
validation que le producteur du diff ne contrôle pas, sous l'invariant
central « **le juge n'entre pas dans la ruche qu'il inspecte** » (la commande
de test est lue sur la BASE, avant patch — transfert littéral de la doctrine
de `loupe.mjs`). C'est la parade au défaut documenté de la DGM elle-même
(annexe H, nœud 114 : l'agent qui supprime les marqueurs de détection pour
atteindre un score parfait).

**Pourquoi différé :** la contradiction a montré 8 failles bloquantes dans le
mécanisme tel que conçu — entre autres : la préparation du patch exécute du
code AVANT le bac ; le fait d'Épreuve n'a pas de canal de retour typé
(`merge_result` jette les champs inconnus en silence) ; « Épreuve absente ⇒
refaire » met une ruche mono-nœud en refaire perpétuel ; la métrique
`bancsAvant/bancsApres` n'a aucun producteur. Chacune est une porte ouverte ou
un blocage de service. On ne livre pas un organe de sûreté avec des trous
connus : le lot d'après-sortie COMMENCE par fermer ces huit points, puis
implémente l'Épreuve en déclenchement manuel, et seulement ensuite la relie
aux courses et au Cerveau.

## Conséquences immédiates (avant la sortie)

Rien de la boucle n'entre avant le 2 septembre. Les 22 jours restent sur ce
qui ferme des ❌ du DoD : la vitrine consolidée, l'accueil du tableau de bord,
et les gardes déjà en chantier. Ce document est la référence : toute PR qui
invoque « l'évolution DGM » doit citer l'invariant qu'elle sert et la faille
bloquante qu'elle ferme.
