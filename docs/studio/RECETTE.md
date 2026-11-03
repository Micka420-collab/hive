# Recette de Hive Studio — ce qui a été exécuté, et ce qui ne l'a pas été

Ce document consigne la recette de la refonte (#579) sur l'arbre de la branche
`feat/hive-studio`. Il ne dit « vérifié » que de ce qui a tourné.

## Le scénario d'acceptation, sur une vraie ouvrière

`node scripts/essai-studio.mjs --agents <agent>` monte une Reine jetable, un
dépôt de test (une calculette dont `add` soustrait), l'ouvrière réelle demandée
et un navigateur sur l'accueil. Brief saisi dans l'accueil : « Dans calc.js, la
fonction add soustrait au lieu d'additionner : corrige-la, puis lance npm test
pour vérifier. »

Résultat avec **Codex** (`codex-cli 0.154.0`, modèle déclaré par
`HIVE_MODELES=gpt-5.6-luna`), 3 novembre 2026, Windows 11 :

| #   | Pas de la directive (§ 9)                             | Constat                                                                 |
| --- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | La mission est créée                                  | plan d'UNE tâche proposé, rien d'écrit avant « Lancer », puis créée     |
| 2   | L'agent reçoit les instructions                       | tâche confiée à `poste-codex`                                           |
| 3   | L'interface affiche son état réel                     | carte « En exécution », agent « à pleine charge » sur la tâche          |
| 4   | Les fichiers sont modifiés dans l'environnement prévu | diff de 171 octets dans le clone de la tâche : `- a - b` / `+ a + b`    |
| 5   | Les modifications sont visibles dans le tableau       | diff affiché dans le panneau Code de l'accueil                          |
| 6   | Les tests sont exécutés                               | `npm test` lancé par l'agent : `ok`, code 0 (journaux de la production) |
| 7   | Le résultat est consultable                           | onglet Résultats : diff, journaux                                       |
| 8   | Une validation peut être demandée                     | « À valider », puis « Approuver » enregistré par la Reine               |
| 9   | L'historique est conservé                             | la mission reste listée (`GET /api/projects/:id/missions`)              |
| 10  | Une reconnexion ne perd pas le contexte               | page rechargée : liaison rétablie, mission et verdict toujours là       |

Aucune erreur de console pendant le parcours.

## Ce que la recette a trouvé, et ce qui a été corrigé

| Défaut constaté en exécution réelle                                                                                                                       | Correction                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Un brief de correction partait en « Échafauder le projet » + « Interface » (« puis » contient « ui ») + « Tests »                                         | `planner.ts` : mots-clés en début de mot, brief de maintenance = une tâche                                                     |
| Claude Code : écritures refusées par les réglages du membre (`"ask": ["Edit","Write"]`), diff vide, tâche **réussie** et mission « terminée avec succès » | `claude-code.ts` : un refus d'écriture fait échouer la tâche, avec la raison et le remède ; avertissement au démarrage du nœud |
| La mission tout juste lancée affichait « depuis 0 ms »                                                                                                    | « à l'instant », écoulé lu au rendu                                                                                            |
| « Approuver » n'existait que dans la conversation, pas à côté du diff                                                                                     | le verdict se pose aussi dans les résultats                                                                                    |
| La barre du haut se chevauchait à 1366 et 1024 px ; la page débordait de 16 à 112 px à 375 px                                                             | règles de rétrécissement de la barre, onglets qui défilent dans leur boîte                                                     |
| La CI Windows rougissait sur un test différent à chaque tentative                                                                                         | deux processus vitest sous Windows (mesuré : vert, et plus court) — PR #580                                                    |

## Deux agents réels en même temps

`node scripts/essai-studio.mjs --agents codex,codex --deux` : deux ouvrières
Codex (deux noms, deux ateliers), un dépôt à deux défauts dans deux fichiers
(`calc.js`, `geo.js`), deux briefs saisis l'un après l'autre dans l'accueil.
Résultat du 3 novembre 2026 : **tous les pas réussis**.

- Le second brief, lancé pendant que la première tâche tournait, rejoint la
  mission ouverte du projet (règle du moteur : `missionOuverte`) — une mission,
  deux tâches.
- Observé en direct : deux tâches `running` au même instant, sur deux nœuds ;
  l'accueil affiche « 0/2 tâches · 2 en cours », chaque poste « à pleine
  charge 1/1 » avec SA tâche, et l'activité dit à qui chaque tâche a été confiée.
- Deux diffs réels, chacun dans son clone : `- a - b / + a + b` et
  `- l + h / + l * h`, produits par deux ouvrières différentes.
- Deux verdicts posés depuis les résultats ; aucune erreur de console.

Limite lue dans le code (non exécutée) : chaque tâche part d'une branche neuve
`hive/<tâche>` créée sur la branche par défaut (`workspace.ts`). Une tâche qui
DÉPEND d'une autre ne reçoit donc pas son diff : les productions ne se
rejoignent qu'à l'intégration de fin de mission (`assign_merge`). Le parallèle
est sûr sur des fichiers disjoints ; un enchaînement « A puis B sur le travail
de A » confié à deux ouvrières reste à éprouver.

## L'invitation entre deux environnements

`node scripts/essai-invitation.mjs` : une Reine, l'hôte dans un navigateur,
l'invité dans un AUTRE contexte de navigateur, et des machines invitées dans des
dossiers et des profils (`HOME`) distincts. Résultat : **24 pas réussis, 2 en
échec** — les deux échecs sont le même défaut, décrit plus bas.

| Pas                                                    | Constat                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| « Inviter → Une machine » compose un lien de porte     | `http://…/r/<billet>#hive2_…`, sans le jeton de la ruche                                                         |
| L'invité ouvre le lien dans un autre navigateur        | la porte : « Rejoindre « Ruche Hive » », ce que fera la machine                                                  |
| L'hôte voit le lien ouvert, puis la machine entrer     | « Lien ouvert à 22:00 », puis « machine-invitee est entrée »                                                     |
| La machine apparaît dans la colonne des agents         | oui                                                                                                              |
| Le même lien rejoué par une autre machine              | refusé en 1 s : « Ce billet a déjà servi… »                                                                      |
| Un lien expiré                                         | refusé en 1 s : « Ce billet a expiré… »                                                                          |
| Un lien révoqué d'un geste dans l'Intendance           | refusé en 1 s : « L'hôte de la ruche a révoqué ce billet… »                                                      |
| Machine coupée puis relancée SANS lien                 | revient avec la même identité, un seul nœud à ce nom                                                             |
| Un compte non admis lit l'équipe d'un projet privé     | 404 — indistinguable d'un projet inexistant                                                                      |
| « Inviter → Une personne » : admission par identifiant | admise ; elle lit alors l'équipe (200) et s'y trouve                                                             |
| Journal                                                | `invite_created`, `porte_ouverte`, `node_joined`, `invite_rejected`, `invite_revoked`, `project_member_admitted` |

**Défaut ouvert (P1)** — une personne admise, dans son propre navigateur, se
heurte au mur « Jeton refusé : collez ici la valeur exacte de HIVE_TOKEN ».
`GET /api/state` et le flux temps réel n'acceptent que le jeton de la ruche ;
le compte membre ouvre les routes du projet, pas l'écran. Lui donner le jeton
lui ouvrirait TOUTE la ruche : l'invitation d'une personne n'est donc pas
utilisable de bout en bout aujourd'hui. Correction proposée, à faire dans sa
propre PR : un état de compte filtré par projet (projets lisibles, leurs
tâches et missions, les nœuds qui y travaillent) et un flux d'événements filtré
de même, avec ses bancs d'accès.

Ce que l'essai a corrigé sur lui-même : la Reine borne la durée de vie d'un
billet à une minute au moins (`bornerTtl`) — un billet demandé à 1 ms vivait
60 s ; l'essai attend désormais l'échéance que la Reine a fixée.

## Ce qui n'est PAS vérifié

- **Claude Code jusqu'au bout** sur cette machine : les réglages personnels du
  membre (`~/.claude/settings.json`, `"ask": ["Edit", "Write"]`) bloquent toute
  écriture en `claude -p`. Hive le dit désormais (tâche en échec, raison en tête
  des journaux, avertissement au démarrage) ; il ne modifie pas ces réglages.
- **Codex avec sa configuration par défaut** : `~/.codex/config.toml` désigne
  un modèle que le compte ChatGPT n'a pas (`model_not_found`) ; les essais ont
  dû déclarer `HIVE_MODELES`. Hive rapporte l'échec tel que le fournisseur le
  formule.
- **L'invitation à travers Internet** (deux machines, NAT, tunnel, `wss://`) :
  l'essai relie deux environnements par la boucle locale.
- **Une tâche dépendante sur une autre ouvrière** (voir plus haut).
- **Lecteur d'écran réel** (NVDA, VoiceOver) : non passé ; l'accessibilité est
  tenue par les bancs (repères, `aria-current`, combobox) et les contrastes
  calculés.

## Les six largeurs

`npm run captures -- --formats grille` photographie chaque page à 1920 × 1080,
1440 × 900, 1366 × 768, 1024 × 768, 768 px et 375 px. Le manifeste
(`captures.json`) dit, pour chaque image, le débordement horizontal mesuré et
les erreurs de console. Les seules erreurs de console relevées sont des
réponses 409/501 de la ruche de laboratoire dans « Code » et « Chantiers »
(projets sans dépôt), que ces pages expliquent elles-mêmes.
