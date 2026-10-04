# Débat, critique et arbitrage — le protocole de la ruche

> Ce que la ruche fait quand deux agents ne sont pas d'accord, qui tranche, et
> ce qui arrive à une objection. Deux protocoles coexistent, parce qu'il y a
> deux questions : **« va-t-on dans la bonne direction ? »** (le Conseil) et
> **« cette production est-elle bonne ? »** (contre-expertise + Evaluator). La
> War Room les relit ensemble ; l'humain tranche.
>
> **Ce document ne peut pas dériver du code.** Chaque tableau encadré par un
> commentaire `verifie:…` est relu par `tests/protocole-debat.test.ts` : les
> constantes contre leurs valeurs dans le code, les règles de l'Evaluator
> contre `evaluate()` lui-même, scénario par scénario, les refus, les portes et
> les événements contre leurs listes exhaustives. Une constante changée, une
> règle déplacée, un refus ajouté sans être décrit ici : la suite rougit. La
> version anglaise, [PROTOCOLE-DEBAT.en.md](PROTOCOLE-DEBAT.en.md), est tenue
> par le même banc.

## La règle commune

**Aucun agent ne décide seul de ce qui entre dans `main`.** Le Conseil propose
à un humain ; la contre-expertise objecte ; l'Evaluator juge une qualité, pas
une autorisation ; le merge d'une pull request exige toujours une approbation
humaine (`canMerge` n'est vrai que sur `accepted` **et** revue humaine
`approved`, `src/orchestrator/evaluator.ts`).

## Qui décide quoi

| Qui                               | Ce qu'il décide                                                                                                                                        | Ce qu'il ne décide jamais                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Le Conseil des Éclaireuses        | Une **recommandation** (issue `quorum`) — ou l'aveu qu'il n'a pas convergé.                                                                            | Rien n'est appliqué : ni tâche créée, ni dépôt touché.                                            |
| La contre-expertise               | `valide` ou `conteste`, avec des objections. Une contestation, toutes relectures closes, demande une correction automatique.                           | Elle ne suffit jamais à fusionner, ni ne relance le producteur pour la panne de son relecteur.    |
| L'Evaluator                       | Un verdict de qualité sur le résultat exact ; `correction_required` et `rejected` **arrêtent** livraison et fusion.                                    | Il n'autorise aucun merge ; `human_review_required` et `additional_test_required` n'arrêtent pas. |
| L'humain (propriétaire du projet) | Trancher un Conseil clos, approuver ou rejeter une production (avec sa raison), **forcer** l'Evaluator avec une raison obligatoire, livrer, fusionner. | —                                                                                                 |

« Propriétaire du projet » : son propriétaire ou un administrateur — ou le
jeton de ruche sur un projet sans propriétaire (#467, `proprieteProjetPermise`,
`src/orchestrator/server.ts`). Un membre réunit le Conseil comme il ajoute une
tâche ; il ne tranche pas.

## Les constantes

<!-- verifie:constantes -->

| Constante                        | Valeur                                           | Où                                   | Ce qu'elle règle                                                                          |
| -------------------------------- | ------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `VERSION_CONSEIL`                | 1                                                | `src/orchestrator/conseil.ts`        | Version du protocole de délibération, rangée avec chaque session.                         |
| `QUORUM_ECLAIREUSES`             | 3                                                | `src/orchestrator/conseil.ts`        | Soutiens distincts (autrice exclue) pour qu'une proposition converge.                     |
| `DIVERSITE_MIN`                  | 2                                                | `src/orchestrator/conseil.ts`        | Familles d'agent distinctes parmi ces soutiens.                                           |
| `POIDS_ARRET`                    | 1.5                                              | `src/orchestrator/conseil.ts`        | Poids d'un signal d'arrêt face à un soutien.                                              |
| `DEMI_VIE_TOURS`                 | 1                                                | `src/orchestrator/conseil.ts`        | Tours au bout desquels une danse non renforcée perd la moitié de son intensité.           |
| `TOURS_MAX`                      | 5                                                | `src/orchestrator/conseil.ts`        | Tours au plus ; au-delà, le Conseil s'arrête (`epuise`).                                  |
| `TOURS_SECS`                     | 2                                                | `src/orchestrator/conseil.ts`        | Tours sans proposition neuve avant de clore l'exploration.                                |
| `LENTILLES`                      | utilite, concurrence, faiblesse, levier, abandon | `src/orchestrator/conseil.ts`        | Les angles d'exploration, dont deux adverses.                                             |
| `VERIFICATRICES_PAR_PROPOSITION` | 3                                                | `src/orchestrator/conseil-runner.ts` | Vérificatrices sollicitées par proposition et par tour — exactement le quorum.            |
| `CONSEILS_CONSERVES`             | 50                                               | `src/orchestrator/conseil-runner.ts` | Sessions closes conservées ; leur décision humaine vit aussi longtemps qu'elles.          |
| `JUSTIFICATION_MAX`              | 1000                                             | `src/shared/war-room.ts`             | Caractères de la justification obligatoire d'une décision de Conseil.                     |
| `RELECTEURS_PAR_PRODUCTION`      | 2                                                | `src/shared/contre-expertise.ts`     | Relecteurs au plus par production, un par famille, jamais celle du producteur.            |
| `AGENTS_SANS_AVIS`               | shell                                            | `src/shared/contre-expertise.ts`     | Familles qui ne relisent jamais (le `shell` simulé).                                      |
| `OBJECTIONS_MAX`                 | 20                                               | `src/shared/contre-expertise.ts`     | Objections lues au plus dans un verdict de relecteur.                                     |
| `ATTENTE_RELECTEUR_ABSENT_MS`    | 300000                                           | `src/orchestrator/scheduler.ts`      | Attente d'une famille relectrice hors ligne (5 minutes) avant `relecteur_absent`.         |
| `MAX_ATTEMPTS`                   | 3                                                | `src/shared/types.ts`                | Le compteur d'essais d'une tâche, que partagent échecs Worker et corrections.             |
| `VERSION_EVALUATOR`              | 1                                                | `src/orchestrator/evaluator.ts`      | Version des règles de l'Evaluator.                                                        |
| `BORNES_CRITIQUE.objections`     | 8                                                | `src/orchestrator/brood.ts`          | Objections figées au plus dans la critique d'une correction.                              |
| `BORNES_CRITIQUE.objection`      | 300                                              | `src/orchestrator/brood.ts`          | Caractères par objection figée.                                                           |
| `BORNES_CRITIQUE.raisons`        | 3                                                | `src/orchestrator/brood.ts`          | Motifs de l'Evaluator figés au plus.                                                      |
| `BORNES_CRITIQUE.raison`         | 400                                              | `src/orchestrator/brood.ts`          | Caractères par motif figé.                                                                |
| `BORNES_CRITIQUE.note`           | 1000                                             | `src/orchestrator/brood.ts`          | Caractères de la raison humaine jointe à la critique.                                     |
| `BUDGET_CRITIQUE`                | 2000                                             | `src/orchestrator/server.ts`         | Caractères du bloc « critique » dans le contexte de l'ouvrière.                           |
| `RAISON_REVUE_MAX`               | 1000                                             | `src/shared/war-room.ts`             | Caractères de la raison d'une revue humaine, à l'entrée de la route comme à la relecture. |

<!-- /verifie:constantes -->

---

## 1. Le débat stratégique — le Conseil des Éclaireuses

`src/orchestrator/conseil.ts` décide (module pur), `conseil-runner.ts` le fait
tourner. Un Conseil ne s'ouvre que sur un geste humain (`POST
/api/projects/:projectId/conseil`, ou « Réunir le Conseil » en War Room) :
il crée de vraies tâches d'ouvrières, donc consomme le temps prêté par les
membres.

1. **Proposition.** Une éclaireuse par lentille explore et rapporte
   `HIVE_PROPOSITION {…}` en réponse finale. L'auto-évaluation d'une autrice
   (`qualite`) ordonne ce qu'on vérifie d'abord ; elle ne compte **jamais**
   comme un soutien.
2. **Vérification indépendante.** Les autres éclaireuses vont voir et rendent
   `HIVE_AVIS {"type":"soutien|arret",…}`. L'avis d'une autrice sur sa propre
   proposition est ignoré (signalé, jamais compté). Un avis par éclaireuse et
   par proposition : le plus récent fait foi.
3. **Décroissance.** Une danse non renforcée perd la moitié de son intensité
   tous les `DEMI_VIE_TOURS` tours : la première idée ne gagne pas par
   ancienneté.
4. **Quorum, pas majorité.** `QUORUM_ECLAIREUSES` soutiens distincts, issus
   d'au moins `DIVERSITE_MIN` familles, **aucun** signal d'arrêt, une intensité
   positive. Un arrêt pèse `POIDS_ARRET` soutien.
5. **Borne.** `TOURS_MAX` tours ; l'exploration s'arrête aussi après
   `TOURS_SECS` tours sans proposition neuve.

<!-- verifie:issues -->

| Issue         | À trancher par un humain | Ce que la ruche fait                                                  |
| ------------- | ------------------------ | --------------------------------------------------------------------- |
| `quorum`      | non                      | Une recommandation, **proposée** à l'humain. Rien n'est appliqué.     |
| `depart`      | oui                      | Plusieurs propositions à égalité au quorum : départage refusé.        |
| `sans_quorum` | oui                      | Du débat, rien de convergé, plus rien à vérifier.                     |
| `epuise`      | oui                      | `TOURS_MAX` atteint sans convergence : le Conseil s'arrête et le dit. |
| `vide`        | non                      | Aucune proposition rapportée : il n'y a rien à départager.            |

<!-- /verifie:issues -->

**La décision humaine est rangée (#478).** `POST
/api/conseil/:sessionId/decision` consigne `council_decided` : la piste
retenue — ou `null`, « aucune piste », qui est une décision aussi —, une
justification obligatoire (`JUSTIFICATION_MAX` caractères, jamais tronquée en
silence), et **qui** : le compte, avec son nom figé au geste, ou l'aveu
`jeton_de_ruche` (le jeton est partagé, il ne désigne personne). On ne tranche
pas un Conseil qui délibère (409). Revenir sur une décision exige de nommer
celle qu'on remplace (`precedente`) : deux opérateurs qui tranchent ensemble ne
s'écrasent pas en silence. La décision courante survit à l'élagage du journal
aussi longtemps que son Conseil est conservé (`pruneEvents`).

---

## 2. Le débat sur le code — contre-expertise, Evaluator, correction

### Étape 1 — la production

Une ouvrière rend un résultat (`results`, identifié par son `resultId`). Les
Gardiennes l'inspectent (`clean`, `suspect`, `hollow`).

### Étape 2 — la critique par une autre famille

`src/shared/contre-expertise.ts`, lancée par `signalerContreExpertise`
(`src/orchestrator/server.ts`).

- **Qui relit :** au plus `RELECTEURS_PAR_PRODUCTION` relecteurs, **un par
  famille**, jamais la famille du producteur ni une famille de
  `AGENTS_SANS_AVIS`. Aucune autre famille en ligne : la contre-expertise est
  refusée **et journalisée** (`contre_expertise`, `possible: false`) — jamais
  confondue avec « rien trouvé ».
- **Le verdict :** le relecteur répond `valide` ou `conteste`, puis une
  objection par ligne (`OBJECTIONS_MAX` au plus, 300 caractères chacune), dans
  sa **réponse finale** — jamais lue dans ses logs —, et **termine** par une
  ligne `HIVE_CRITIQUE` (`src/shared/critique-structuree.ts`) :

  ```text
  HIVE_CRITIQUE {"verdict":"valide|conteste","findings":[{"severite":"…","critere":"…","fichier":"…","preuve":"…","proposition":"…"}]}
  ```

  - `severite` ∈ `bloquant`, `majeur`, `mineur`, `info` ; `critere` ∈
    `correction`, `securite`, `tests`, `performance`, `lisibilite`,
    `conformite` (accents et majuscules tolérés) ; chaque constat porte sa
    `preuve`.
  - **Un constat `bloquant` ou `majeur` conteste**, même sous `valide` — il
    devient une objection. **`mineur` et `info` ne bloquent jamais** : ce sont
    des remarques, affichées et transmises, qui ne rouvrent pas la production.
    Un `conteste` écrit reste une contestation.
  - Le marqueur n'est lu **qu'en dernière ligne non vide** (une clôture de
    bloc, une puce ou des accents graves autour sont tolérés). Une autre ligne
    `HIVE_CRITIQUE` — citée d'un diff qui en contenait une toute prête — ne
    décide jamais : plus d'une ligne-marqueur, et le marqueur est illisible.
    Lu, il décide ; la prose n'est plus lue, sauf un `conteste` en **première
    ligne** : sous un marqueur `valide` sans constat bloquant, la réponse
    contradictoire est contestée. Une contestation garde toujours un motif :
    ses constats bloquants, sinon les objections de la prose.
  - Un marqueur mal formé (JSON cassé, valeur hors grille, preuve absente,
    plus d'une ligne, coupé par un texte trop long) est écarté **en entier** —
    jamais lu à moitié — et l'avis est **contesté** (`marqueur: "illisible"`) :
    le marqueur écarté portait peut-être le seul défaut majeur.
  - **Sans marqueur**, la lecture libre s'applique : `conteste` l'emporte
    toujours, et **une objection suffit** — écrite sous `valide`, elle compte
    comme une contestation (`agreger`). Un verdict illisible compte aussi
    comme contesté.

- **La notation :** il n'y a **pas de note unique** — elle cacherait _quel_
  critère a péché. Les constats sont **comptés par critère et par sévérité**
  (`compterParCritere`), ce que montrent la Miellerie (« Constats par
  critère ») et la War Room (sous chaque avis). La sévérité décide, pas le
  critère ; une production `accepted` avec des remarques le dit dans ses
  motifs.
- **L'attente :** une relecture ne part qu'à sa famille. Une famille absente
  `ATTENTE_RELECTEUR_ABSENT_MS` échoue la relecture avec
  `contre_expertise_review_failed`, motif `relecteur_absent`.

### Étape 2 bis — la relecture impossible (#484)

Une relecture peut se clore **sans avis** : famille absente, relecteur en
échec au-delà de ses essais, réponse finale absente, relecture annulée par un
humain. Quand c'est la dernière relecture en vol de ce résultat et qu'aucun
avis n'est arrivé :

1. **Un secours**, une fois, par une famille indépendante du producteur qui
   n'a pas encore été engagée sur ce résultat (`contre_expertise` avec
   `secours: true`).
2. Sinon — aucune famille de secours, secours déjà tenté, ou relecture
   **annulée** (on ne rachète pas une relecture qu'un humain vient
   d'arrêter) — la ruche consigne `contre_expertise_impossible` avec sa
   cause, et l'Evaluator répond `human_review_required` : « relecture
   impossible : _cause_ ».

**Le producteur n'est jamais relancé pour la panne de son relecteur.** Si un
autre relecteur a déjà rendu un avis, c'est cet avis qui décide, une fois
toutes les relectures closes.

### Étape 3 — les preuves et l'Evaluator

`src/orchestrator/evaluator.ts` compose les faits du **résultat exact** :
résultat, Gardiennes, Parlement, revue humaine, contre-revue, validations
(`tests`, `typecheck`, `build`, `lint`, apportées par un producteur de preuves
identifié — bac Hive ou CI GitHub — jamais lues dans les logs d'une ouvrière).
La première règle qui s'applique décide, dans l'ordre de `evaluate()`. Le
banc compte les sorties de `evaluate()` dans sa source, joue chaque ligne, et
exige que son motif (le début de `reasons[0]`) ne désigne qu'elle :

<!-- verifie:evaluator -->

| #   | Quand                                                                          | Décision                   | Renvoi recommandé | Motif rendu (extrait)              |
| --- | ------------------------------------------------------------------------------ | -------------------------- | ----------------- | ---------------------------------- |
| 1   | aucun résultat Worker                                                          | `correction_required`      | oui               | `aucun résultat Worker`            |
| 2   | dernier résultat en échec                                                      | `rejected`                 | oui               | `le dernier résultat a échoué`     |
| 3   | production creuse (Gardiennes `hollow`)                                        | `rejected`                 | oui               | `production creuse`                |
| 4   | la porte de sécurité a trouvé un secret ajouté ou une vulnérabilité introduite | `correction_required`      | oui               | `la porte de sécurité a trouvé`    |
| 5   | Gardiennes `suspect`                                                           | `correction_required`      | oui               | `signal suspect`                   |
| 6   | rejet humain                                                                   | `correction_required`      | oui               | `la revue humaine a rejeté`        |
| 7   | pas d'inspection des Gardiennes                                                | `human_review_required`    | non               | `aucune inspection indépendante`   |
| 8   | le résultat n'est pas celui que le Parlement a élu                             | `correction_required`      | oui               | `faction élue`                     |
| 9   | contre-revue contestée                                                         | `correction_required`      | oui               | `demande une amélioration`         |
| 10  | une validation en échec                                                        | `correction_required`      | oui               | `en échec`                         |
| 11  | relecture impossible, sans aucun avis ni relecture en vol                      | `human_review_required`    | non               | `relecture impossible :`           |
| 12  | porte de sécurité non vérifiée, en polyéthisme `strict`                        | `human_review_required`    | non               | `non vérifiée, polyéthisme strict` |
| 13  | une validation manque (ou les tests ne sont pas déclarés)                      | `additional_test_required` | non               | `preuves manquantes`               |
| 14  | une relecture de ce résultat est encore en vol                                 | `human_review_required`    | non               | `contre-revue en cours`            |
| 15  | aucun avis favorable d'une autre famille                                       | `human_review_required`    | non               | `aucune contre-revue`              |
| 16  | tout est vert **et** un avis favorable indépendant                             | `accepted`                 | non               | `contre-revue favorable`           |

<!-- /verifie:evaluator -->

La relecture impossible (11) passe **avant** les preuves absentes : aucune CI
ne ferait `accepted` sans avis indépendant, et « tests supplémentaires
requis » enverrait l'opérateur chercher une preuve qui ne débloquerait rien.
Un premier avis favorable ne vaut pas acceptation tant qu'une autre relecture
du même résultat est en vol (14) : une objection reste bloquante, d'où qu'elle
vienne.

Les **tests du bac en échec se comparent à la base**, test par test
(`src/shared/lecture-tests.ts`, G11b) — quand leur sortie par défaut se lit
(vitest, jest, `node --test`, TAP), sans rien ajouter au script déclaré, et
qu'elle est **complète et cohérente** : elle est en partie écrite par le code
de l'agent, et une ligne collée, un résumé qui ne compte pas tout, un nom en
double ou un échec que le runner ne redit pas rendent le verdict du script —
jamais un vert de plus. La base est rejouée à part, dans le bac : un dépôt neuf
tiré du registre par `fetch` (jamais en lisant les objets que l'agent a pu
forger), une installation fraîche depuis son lockfile, son build, le même
script. Une **régression** (rouge à chaque exécution de la production, à aucune
de la base) reste la règle 10, et ses motifs la **nomment** ; des tests **déjà
rouges à la base**, du même échec (le message que le runner imprime, et son
fichier), ne bloquent plus — `accepted` (16) les **dit** ; un test
**instable** (vu rouge à une exécution et vert à une autre, de la production
ou de la base) n'est ni l'un ni l'autre : preuve manquante (13). Chaque côté
est vu jusqu'à deux fois, paresseusement, et la seconde exécution de la
production rejoue son arbre LIVRÉ, à part — ce que la première a laissé dans
le répertoire ne la fait pas passer —, portage de la logique FAIL_TO_PASS /
PASS_TO_PASS de SWE-bench (`grading.py`, MIT), la base pour référence. Une
sortie illisible, coupée, une exécution en panne d'environnement, un côté qui
ne se rejoue pas, ou des exécutions qui ne se comparent pas rendent le verdict
du script. Le surcoût — seulement quand les tests échouent, au pire 55 min :
deux rejeux à part (extraction, installation, build, tests) et une seconde
exécution de la base — est annoncé dans la ligne de progression ; chaque nœud
garde en mémoire les bases qu'il a rejouées, sauf celles qui ont vacillé.

La **porte de sécurité** (`src/shared/porte-securite.ts`) n'est pas une
cinquième validation : le nœud la joint à son résultat (`porteSecurite`,
rangée en `security_gate_recorded`), volet par volet — secrets (Betterleaks,
confiance haute, lignes ajoutées seulement, sur TOUT résultat porteur d'un
diff, échecs compris) et dépendances (osv-scanner, vulnérabilités INTRODUITES
par rapport à la base, pour une production réussie de l'arbre de la tâche ;
ce qui en part à osv.dev : `src/shared/porte-securite-dependances.ts`). La
Reine revalide chaque volet SEUL : un volet mal formé devient
`rapport_rejete`, journalisé (`security_gate_rejected`), sans emporter
l'autre. Un constat (4) passe avant tout ce qui appelle un humain :
`human_review_required` n'arrête pas la livraison, et une approbation ne doit
pas laisser partir une clé ; sur un résultat en échec (2), les constats
suivent le motif, pour que la critique les porte. Non vérifiée (outil absent,
en échec, osv.dev injoignable, nœud antérieur à la porte), elle n'est
**jamais comptée verte** — `accepted` le dit dans ses motifs, comme les
paquets introduits qui n'ont pas pu être interrogés (« passée en partie ») —
et ne retient la production qu'en polyéthisme `strict` (12) : comme une
contre-visite manquante, la production attend alors un humain
(`human_review_required`, sans renvoi — le producteur n'installe pas l'outil
du nœud). Ce que cela change, et rien de plus : la livraison exigeait déjà
une approbation humaine, que ce verdict ne bloque pas ; l'Evaluator n'accepte
plus seul (pas de souvenir retenu au Hive Mind sans humain, pas de production
« jugée » dans la qualité des ouvrières). Un rejet humain relance la
production, et la porte avec elle.

### Étape 4 — la correction, avec la critique (#488)

Trois portes rouvrent une production réussie, toutes par
`Scheduler.retryFromEvaluator` ; chacune fige sa **source** dans la critique :

<!-- verifie:portes -->

| Source          | Porte                                   | Déclencheur                                                                       |
| --------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `contre_revue`  | contre-revue insuffisante (automatique) | toutes les relectures du résultat sont closes et l'Evaluator recommande un renvoi |
| `revue_humaine` | rejet humain (Miellerie)                | `POST /api/tasks/:taskId/review` `{ state: "rejected", raison? }`                 |
| `evaluator`     | renvoi explicite                        | `POST /api/tasks/:taskId/evaluation/retry` `{ resultId }`                         |

<!-- /verifie:portes -->

Gardes communes : le `resultId` doit être le dernier, aucune livraison ne doit
exister, les dépendantes doivent être restées `pending`, aucun ancêtre délégué
ne doit avoir échoué, et le compteur d'essais — celui des échecs Worker —
borne la boucle : un renvoi est refusé (`attempts_exhausted`) dès que la tâche
a atteint `MAX_ATTEMPTS`.

**Limite connue — la borne n'a pas le même point de départ.** Un échec Worker
incrémente le compteur et fait échouer la tâche quand il atteint
`MAX_ATTEMPTS` : trois exécutions au plus. Un renvoi en correction, lui, est
accordé tant que le compteur est **sous** `MAX_ATTEMPTS`, et la première
production ne l'a pas incrémenté : une production contestée à chaque fois
s'exécute quatre fois avant `attempts_exhausted` (mesuré sur la ruche de
laboratoire des captures). Aligner les deux voies changerait la borne d'un
comportement livré : c'est laissé à une décision explicite.

**La critique voyage avec la correction.** Au moment du renvoi, la ruche fige
dans le payload de `task_retry` (`source: "evaluator"`, `critique.source` =
la porte) : les **objections** de la contre-revue du résultat exact
(`BORNES_CRITIQUE.objections` × `BORNES_CRITIQUE.objection`), les **motifs**
de l'Evaluator (`BORNES_CRITIQUE.raisons` × `BORNES_CRITIQUE.raison`), la
**raison de l'humain** qui a rejeté (`BORNES_CRITIQUE.note`), et les
**remarques** de la contre-revue — ses constats `mineur` ou `info` (les
bloquants y sont déjà, en objections). À l'assignation suivante, ce bloc entre
dans le contexte de l'ouvrière, dans un budget de `BUDGET_CRITIQUE`
caractères : note humaine d'abord, puis objections, puis motifs, puis
remarques — sous budget, la queue tombe. Comme tout texte venu d'un agent, la
critique est une **donnée** encadrée `<<<HIVE_DATA … HIVE_DATA>>>`, jamais une
instruction libre. `critique_context` journalise qu'elle a été jointe ;
`critique_refus` dit qu'elle n'a pas tenu dans le budget — la tentative
repart sans, et ça se voit.

**La critique survit à l'attente.** Elle ne vit que dans le payload de
`task_retry`, et `task_retry` est une **preuve** que la rétention du journal
garde avec sa tâche (`src/shared/retention-journal.ts`) : une tâche rouverte
qui attend longtemps en `ready` garde sa critique, quel que soit le nombre
d'événements journalisés entre-temps. Seul le plafond dur du journal, en
dernier recours, peut encore retirer le dossier d'une tâche ouverte — tâche
entière, ou pour une tâche qui boucle en coupant d'abord ce qu'une preuve plus
récente du même type remplace — et il le **dit** au Journal
(`journal_elagage`).

### Étape 5 — les refus de renvoi, et ce qui reste à trancher

Un renvoi refusé est journalisé (`evaluator_retry_skipped`, avec sa raison
**et sa source** : `contre_revue` ou `revue_humaine`) :

<!-- verifie:refus -->

| Refus                        | Ouvre un désaccord | Ce qu'il dit                                                                  |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `attempts_exhausted`         | oui                | Les essais sont épuisés : l'objection reste sans suite.                       |
| `root_cost_budget_exhausted` | oui                | La racine déléguée n'a plus de budget coût : la correction ne sera pas payée. |
| `delivery_exists`            | oui                | La production est déjà livrée : elle ne se relance plus.                      |
| `dependent_progressed`       | oui                | Des tâches dépendantes ont déjà bâti dessus.                                  |
| `stale_result`               | non                | Une production plus récente existe : la contestation est caduque.             |
| `task_not_done`              | non                | La tâche n'est plus terminée.                                                 |
| `ancestor_failed`            | non                | Un ancêtre délégué a échoué : personne ne lirait la correction.               |
| `invalid_result_id`          | non                | Le résultat nommé n'appartient pas à la tâche.                                |
| `unknown_task`               | non                | La tâche n'existe plus.                                                       |
| `shadow_task`                | non                | Une ombre du banc n'a qu'un essai : elle se compare, elle ne se corrige pas.  |

<!-- /verifie:refus -->

« Ouvre un désaccord » ne vaut que pour la source `contre_revue` : après un
**rejet humain**, l'humain a déjà tranché — la War Room dit « rejet humain
sans correction », sans le compter à trancher (ni approuver contre son avis ni
rejeter à nouveau ne le lèverait). Un refus journalisé avant ce champ, sans
source, reste lu comme une contestation : inconnu, donc montré plutôt que tu —
sauf si un rejet humain de cette production est rangé : la route rangeait le
rejet avant de journaliser le refus, et « une revue après le refus » ne l'aurait
jamais levé.

### Étape 6 — l'arbitrage humain

- La revue humaine (Miellerie) **décide** : `approved` ouvre la livraison,
  `rejected` relance la correction avec sa raison (`RAISON_REVUE_MAX`
  caractères). Une raison sans verdict est refusée (`400
raison_sans_verdict`). Un renvoi efface le verdict : une approbation ne
  fuit pas vers la production suivante.
- `correction_required` et `rejected` **arrêtent** la livraison et la fusion.
  Passer outre demande une raison (`forcer: { raison }`), et le geste est
  journalisé (`evaluator_overridden` : qui, pourquoi, contre quel verdict) au
  moment où il s'engage.
- Le merge d'une pull request exige `accepted` **et** `approved`.
- En polyéthisme `strict`, la contre-visite peut **refuser** de livrer ce
  qu'un humain a approuvé (jamais l'inverse) : les nourrices et les surfaces
  sensibles sont toujours revisitées (`exigeContreVisite`,
  `src/orchestrator/polyethisme.ts`).

---

## 3. La War Room — tout relire au même endroit

`GET /api/war-room` (`src/shared/war-room.ts`, vue `dashboard/src/views/WarRoom.tsx`)
replie ces faits en un fil, par projet et par tâche, **sans rien recalculer** ;
sa seule écriture est la décision sur un Conseil.

**En tête, ce qui attend quelqu'un** — calculé sur tout le fil retenu, jamais
caché par un filtre :

| Ce qui attend                                     | Ce qui le lève                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| un Conseil clos `depart`, `sans_quorum`, `epuise` | une décision humaine, « aucune piste » comprise                                                                  |
| une contestation dont le renvoi a été refusé      | une revue humaine posée **après** le refus (approuver ou rejeter), un forçage de l'Evaluator, ou un nouvel essai |
| une relecture impossible                          | la revue humaine qui manque (quel que soit son moment), un forçage, ou un nouvel essai                           |

Le forçage (`evaluator_overridden`) tranche : c'est la décision finale d'un
humain sur cette production, et le seul geste qui fasse partir une production
contestée aux essais épuisés — après sa livraison, un rejet est refusé
(`delivery_exists`) et ne lèverait plus rien. Une relecture impossible n'y
prête aucun verdict à l'Evaluator : la War Room dit le fait journalisé (aucun
avis indépendant ne viendra), pas ce que l'Evaluator en conclut — une règle
antérieure, une CI rouge par exemple, peut répondre autre chose que
`human_review_required`.

**Le fil**, du plus récent au plus ancien, se filtre par **voix** — le
`famille` de la route — et chaque événement lu y a exactement une :

<!-- verifie:journal -->

| Événement                        | Qui l'écrit                                  | Voix        |
| -------------------------------- | -------------------------------------------- | ----------- |
| `council_opened`                 | le Conseil                                   | `conseil`   |
| `council_proposal`               | une éclaireuse                               | `conseil`   |
| `council_review`                 | une vérificatrice                            | `conseil`   |
| `council_round`                  | le Conseil                                   | `conseil`   |
| `council_closed`                 | le Conseil                                   | `conseil`   |
| `contre_expertise`               | le lancement (ou son refus, ou un secours)   | `relecture` |
| `contre_expertise_verdict`       | un relecteur d'une autre famille             | `relecture` |
| `contre_expertise_review_failed` | une relecture close sans avis                | `relecture` |
| `contre_expertise_impossible`    | la fin d'une contre-revue sans aucun avis    | `relecture` |
| `task_retry`                     | un renvoi en correction (source `evaluator`) | `evaluator` |
| `evaluator_retry_skipped`        | un renvoi refusé                             | `evaluator` |
| `council_decided`                | un humain qui tranche un Conseil             | `humain`    |
| `task_reviewed`                  | un humain qui revoit une production          | `humain`    |
| `evaluator_overridden`           | un humain qui passe outre l'Evaluator        | `humain`    |

<!-- /verifie:journal -->

Les reprises après panne de Worker partagent `task_retry` ; elles ne sont pas
un désaccord, et la War Room ne les montre pas. Le journal est élagué : quand
il a déjà perdu des lignes, le fil le **dit**. Ce qui doit survivre à
l'élagage y survit — la décision courante de chaque Conseil conservé, et les
**preuves** d'une tâche (refus de renvoi, forçages, relectures, leur
impossibilité), gardées avec elle tant que la ruche peut encore en décider
quelque chose, puis trente jours après sa clôture
(`src/shared/retention-journal.ts`) — et ce qui lève un désaccord se relit
aussi dans les tables rangées (revue courante, dernier résultat).

## Ce qui n'existe pas (encore)

- **Un tour de réponse du producteur** avant la correction (accepter et
  réviser, ou réfuter avec preuves et escalader). Il coûte une exécution
  d'agent de plus par désaccord : décision produit en attente.
- **Un arbitrage gradué par le risque** hors polyéthisme `strict`.
