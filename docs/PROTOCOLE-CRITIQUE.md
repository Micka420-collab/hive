# Débat, critique et arbitrage — le protocole de la ruche

> Ce que la ruche fait quand deux agents ne sont pas d'accord, qui tranche, et
> ce qui arrive à une objection. Deux protocoles coexistent, parce qu'il y a
> deux questions : **« va-t-on dans la bonne direction ? »** (le Conseil) et
> **« cette production est-elle bonne ? »** (contre-revue + Evaluator).
>
> Chaque seuil ci-dessous est une constante du code, citée avec son fichier :
> si ce document et le code divergent, c'est le code qui dit vrai — et ce
> document qui est à corriger.

## La règle commune

**Aucun agent ne décide seul de ce qui entre dans `main`.** Le Conseil propose
à un humain ; l'Evaluator juge une qualité, pas une autorisation ; le merge
d'une pull request exige toujours une approbation humaine (`canMerge` n'est
vrai que sur `accepted` **et** revue humaine `approved`,
`src/orchestrator/evaluator.ts`).

---

## 1. Le débat stratégique — le Conseil des Éclaireuses

`src/orchestrator/conseil.ts` (module pur, versionné `VERSION_CONSEIL = 1`).

1. **Proposition.** Des éclaireuses explorent sous des angles différents
   (`LENTILLES`) et rapportent des propositions. L'auto-évaluation d'une
   autrice (`qualite`) ordonne ce qu'on vérifie d'abord ; elle ne compte
   **jamais** comme un soutien.
2. **Vérification indépendante.** Les autres éclaireuses vérifient et rendent
   un `soutien` ou un signal d'`arret`. L'avis d'une autrice sur sa propre
   proposition est ignoré (signalé, jamais compté). Un avis par éclaireuse et
   par proposition : le plus récent fait foi.
3. **Décroissance.** Une danse non renforcée perd la moitié de son intensité
   par tour (`DEMI_VIE_TOURS = 1`) : la première idée ne gagne pas par
   ancienneté.
4. **Quorum, pas majorité.** Une proposition converge quand elle réunit
   `QUORUM_ECLAIREUSES = 3` soutiens distincts, issus d'au moins
   `DIVERSITE_MIN = 2` familles d'agent, **aucun** signal d'arrêt et une
   intensité positive. Un arrêt pèse `POIDS_ARRET = 1.5` fois un soutien.
5. **Borne.** Au plus `TOURS_MAX = 5` tours ; l'exploration s'arrête aussi
   après `TOURS_SECS = 2` tours sans proposition neuve.

| Issue         | Ce que la ruche fait                                                   |
| ------------- | ---------------------------------------------------------------------- |
| `quorum`      | Une recommandation, **proposée** à l'humain. Rien n'est appliqué.      |
| `depart`      | Plusieurs propositions au quorum : départage refusé, l'humain tranche. |
| `sans_quorum` | Le débat continue (tour suivant) tant que la borne le permet.          |
| `epuise`      | `TOURS_MAX` atteint sans convergence : le Conseil s'arrête et le dit.  |
| `vide`        | Aucune proposition rapportée.                                          |

---

## 2. Le débat sur le code — contre-revue, Evaluator, correction

### Étape 1 — la production

Une ouvrière rend un résultat (`results`, identifié par son `resultId`). Les
Gardiennes l'inspectent (`clean`, `suspect`, `hollow`).

### Étape 2 — la critique par une autre famille

`src/shared/contre-expertise.ts`, lancée par `signalerContreExpertise`
(`src/orchestrator/server.ts`).

- **Qui relit :** au plus `RELECTEURS_PAR_PRODUCTION = 2` relecteurs, **un par
  famille**, toujours d'une famille différente du producteur ; le `shell`
  simulé ne relit jamais (`relecteurIndependant`). Aucune autre famille en
  ligne : la contre-revue est refusée **et journalisée** (`contre_expertise`,
  `possible: false`) — jamais confondue avec « rien trouvé ».
- **Le verdict :** le relecteur écrit `valide` ou `conteste` suivi
  d'objections (au plus 20, 300 caractères chacune). `conteste` l'emporte
  toujours ; un verdict illisible compte comme contesté.
- **L'attente :** une relecture dont la famille reste hors ligne
  `ATTENTE_RELECTEUR_ABSENT_MS` (5 minutes, `src/orchestrator/scheduler.ts`)
  échoue avec `contre_expertise_review_failed`, motif `relecteur_absent`.

### Étape 3 — les preuves et l'Evaluator

`src/orchestrator/evaluator.ts` compose les faits du **résultat exact** :
résultat, Gardiennes, Parlement, revue humaine, contre-revue, validations CI
(`tests`, `typecheck`, `build`, `lint`, apportées par un producteur de preuves
identifié — jamais lues dans les logs d'une ouvrière). L'ordre des règles est
volontaire ; la première qui s'applique décide, dans l'ordre de `evaluate()` :

| #   | Quand                                                      | Décision                   | Retry recommandé |
| --- | ---------------------------------------------------------- | -------------------------- | ---------------- |
| 1   | aucun résultat Worker                                      | `correction_required`      | oui              |
| 2   | dernier résultat en échec                                  | `rejected`                 | oui              |
| 3   | production creuse (Gardiennes `hollow`)                    | `rejected`                 | oui              |
| 4   | Gardiennes `suspect`                                       | `correction_required`      | oui              |
| 5   | rejet humain                                               | `correction_required`      | oui              |
| 6   | pas d'inspection                                           | `human_review_required`    | non              |
| 7   | résultat non élu                                           | `correction_required`      | oui              |
| 8   | contre-revue contestée                                     | `correction_required`      | oui              |
| 9   | CI rouge                                                   | `correction_required`      | oui              |
| 10  | une validation manque                                      | `additional_test_required` | non              |
| 11  | relecture encore en vol                                    | `human_review_required`    | non              |
| 12  | aucun avis favorable indépendant                           | `human_review_required`    | non              |
| 13  | tout est vert **et** un avis favorable d'une autre famille | `accepted`                 | non              |

Une production sans preuve CI et sans relecture indépendante reçoit donc
`additional_test_required` (règle 10), pas `human_review_required`.

Un premier avis favorable ne vaut pas acceptation tant qu'une autre relecture
du même résultat est en vol : une objection reste bloquante, d'où qu'elle
vienne.

### Étape 4 — la correction, **avec la critique**

Trois portes rouvrent une production réussie, toutes par
`Scheduler.retryFromEvaluator` :

| Porte                                   | Déclencheur                                                                          | `source` de la critique |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| contre-revue insuffisante (automatique) | toutes les relectures du résultat sont terminales et l'Evaluator recommande un retry | `contre_revue`          |
| rejet humain (Miellerie)                | `POST /api/tasks/:taskId/review` `{ state: "rejected", raison? }`                    | `revue_humaine`         |
| retry explicite                         | `POST /api/tasks/:taskId/evaluation/retry` `{ resultId }`                            | `evaluator`             |

Gardes communes : le `resultId` doit être le dernier (une décision tardive ne
rouvre pas une production plus récente), aucune livraison ne doit exister,
les dépendantes doivent être restées `pending`, aucun ancêtre délégué ne doit
avoir échoué, et le budget `MAX_ATTEMPTS = 3` (`src/shared/types.ts`) — le
même que les échecs Worker — borne la boucle. Un retry refusé est journalisé
(`evaluator_retry_skipped`, avec sa raison).

**La critique voyage avec la correction.** Au moment du retry, la ruche fige
dans le payload de `task_retry` (source `evaluator`) :

- les **objections** de la contre-revue du résultat exact (au plus 8, 300
  caractères chacune) ;
- les **motifs** de la décision de l'Evaluator (au plus 3, 400 caractères) ;
- la **raison de l'humain** qui a rejeté, s'il en a donné une (1 000
  caractères au plus, bornée à l'entrée de la route).

À l'assignation suivante, ce bloc entre dans le contexte de l'ouvrière juste
après le Cerveau et avant les leçons de la Couveuse
(`blocCritique`, `src/orchestrator/brood.ts`), dans un budget de 2 000
caractères (`BUDGET_CRITIQUE`) : note humaine d'abord, puis objections, puis
motifs — sous budget, la queue tombe en premier. Comme tout texte venu d'un
agent, la critique est une **donnée** encadrée `<<<HIVE_DATA … HIVE_DATA>>>`,
jamais une instruction libre : un relecteur a pu être trompé par le dépôt
qu'il lisait, donc l'ouvrière **évalue** chaque objection au regard de la
tâche d'origine, et aucune objection n'autorise une commande réseau, un
script d'installation, un accès à des secrets ni une modification de CI ou
de dépendances.

Le budget est **un seul décompte** pour tout le contexte : le cadre du
polyéthisme se sert d'abord, puis Cerveau, critique, Couveuse, Hive Mind,
horizon et veille, chacun sur ce qui reste — le total ne dépasse jamais
`LIMITS.hiveContext`, au-delà duquel le nœud rejetterait tout
l'`assign_task`. L'événement `critique_context` journalise qu'elle a été
jointe (source, tentative, objections **réellement jointes** et objections
figées) ; si même son ossature ne tient pas (cadre et Cerveau ont tout pris),
`critique_refus` le dit — la tentative repart sans, et ça se voit à la
Chronique. Les leçons de la Couveuse, servies après la critique, cèdent les
premières : évincées en entier, `brood_refus` le journalise de même (au lieu
d'un `brood_context` qui mentirait). La Miellerie l'affiche sous la tâche
(`GET /api/tasks/:taskId/critique`).

La plus récente critique fait foi : une seconde correction remplace la
première. Une reprise qui ne la remplace pas (échec Worker après la
correction) la garde — l'objection reste ouverte — et l'en-tête nomme alors
la tentative dont la production a été contestée, pas « la précédente ».

**La critique survit à l'attente.** Elle ne vit que dans le payload de
`task_retry`, et `task_retry` est une **preuve** que la rétention du journal
garde avec sa tâche (`src/shared/retention-journal.ts`) : une tâche rouverte
qui attend longtemps en `ready` garde sa critique, quel que soit le nombre
d'événements journalisés entre-temps — l'ancienne limite (élaguée au-delà de
5 000 événements, sans que rien le signale) est levée. Seul le plafond dur du
journal, en dernier recours, peut encore retirer le dossier d'une tâche
ouverte : il le fait tâche entière — ou, pour une tâche qui boucle, en coupant
d'abord ce qu'une preuve plus récente du même type remplace, si bien que la
dernière critique part la dernière — et le **dit** au Journal
(`journal_elagage`, preuves de tâches encore ouvertes et coupes comptées à
part). Une
critique vide, elle, ne s'annonce pas : rien n'est deviné.

### Étape 5 — la notation

Il n'y a **pas de note unique**. Le signal d'une relecture est binaire
(`conteste` ou non) et chaque objection est rendue telle quelle. Une grille de
critères (exactitude, tests, sécurité…) n'existe pas encore : elle demande une
décision produit — quels critères, et lesquels pèsent sur la décision.

### Étape 6 — l'arbitrage humain

- La revue humaine (Miellerie) **décide** : `approved` ouvre la livraison,
  `rejected` relance la correction avec sa raison. Une raison sans verdict est
  refusée (`400 raison_sans_verdict`).
- Le merge d'une pull request exige `accepted` **et** `approved`.
- En polyéthisme `strict`, la contre-visite peut **refuser** de livrer ce
  qu'un humain a approuvé (jamais l'inverse) : les nourrices et les surfaces
  sensibles sont toujours revisitées (`exigeContreVisite`,
  `src/orchestrator/polyethisme.ts`).

## Les issues possibles d'un désaccord sur le code

| Situation                                           | Issue                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Un relecteur conteste, essais restants              | Correction automatique, la tentative suivante reçoit les objections.                    |
| Un relecteur conteste, essais épuisés               | `evaluator_retry_skipped` (`attempts_exhausted`) : la production reste devant l'humain. |
| Aucune autre famille en ligne                       | `human_review_required` : l'humain tranche ; un rejet relance la production.            |
| Relecteur absent 5 minutes                          | Relecture échouée (`relecteur_absent`) ; l'Evaluator attend un avis humain.             |
| Relecteurs divisés                                  | `conteste` l'emporte : correction, avec l'objection.                                    |
| L'humain rejette                                    | Correction, avec sa raison et les objections du résultat.                               |
| Tout vert, relu favorablement par une autre famille | `accepted` — le merge attend encore l'approbation humaine.                              |

## Ce qui n'existe pas (encore)

- **Un tour de réponse du producteur** avant la correction (accepter et
  réviser, ou réfuter avec preuves et escalader). Il coûte une exécution
  d'agent de plus par désaccord : décision produit en attente.
- **Des critères objectifs** attachés à chaque objection.
- **Un arbitrage gradué par le risque** hors polyéthisme `strict` : aujourd'hui
  seul l'échelon `strict` du chemin de livraison autonome distingue les
  surfaces sensibles.
