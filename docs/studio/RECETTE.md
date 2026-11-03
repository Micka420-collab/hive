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

## Ce qui n'est PAS vérifié

- **Claude Code jusqu'au bout** sur cette machine : les réglages personnels du
  membre (`~/.claude/settings.json`, `"ask": ["Edit", "Write"]`) bloquent toute
  écriture en `claude -p`. Hive le dit désormais (tâche en échec, raison en tête
  des journaux, avertissement au démarrage) ; il ne modifie pas ces réglages.
- **Codex avec sa configuration par défaut** : `~/.codex/config.toml` désigne
  un modèle que le compte ChatGPT n'a pas (`model_not_found`) ; l'essai a dû
  déclarer `HIVE_MODELES`. Hive rapporte l'échec tel que le fournisseur le
  formule.
- **Deux agents sur une même mission**, et **l'invitation entre deux
  environnements distincts** : non exécutés pendant cette recette.
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
