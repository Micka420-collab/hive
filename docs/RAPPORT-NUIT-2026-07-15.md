# 🌙 Rapport de nuit — 14→15 juillet 2026

Travail autonome mené pendant la nuit sur Hive (orchestration multi-agents,
revues adversariales entre chaque étape). Tout est sur `main`, CI verte.

## 1. Intégration : 12 PRs fusionnées + réconciliation de deux lignées

- **PRs #1 → #12** fusionnées séquentiellement (conflits résolus dans
  `cli.ts`/`server.ts` principalement) : Palier 2 (Queen Bee, Hive Mind,
  Sting Detector), Palier 3 (Honeycomb Merge réel, token-failover,
  sous-agents, adaptateur commande libre, Time-Lapse Replay), Palier 4
  (Drone Wars, Waggle Board, Parlement, Ghost, Night Shift), innovations
  (Hive Pulse, rapport projet), garde des invariants de sécurité (§5).
- **Réconciliation** avec la lignée poussée en parallèle sur `main`
  (auth JWT + marketplace, OpenAlex, Queen Bee OpenRouter, adaptateur
  Hermes) : doublons tranchés, le Hive Mind BM25 câblé de bout en bout est
  conservé, les deux backends de planification coexistent.

## 2. Mission Control : l'interface de pilotage (v0.2.0)

Dashboard refondu en application 8 vues (sidebar alvéolaire, navigation par
hash, touches 1-8, chunks lazy par vue) :

| Vue          | Rôle                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 🐝 Ruche     | Cockpit temps réel (Swarm 2D/3D, rayon de miel cliquable)                                                    |
| 👑 Reine     | **Parler à la ruche dans sa langue** — avancement, santé, aide au brief                                      |
| 🍯 Miellerie | **Revue des productions IA** : diff par fichier, consensus du Parlement, approbation clavier, coulée du miel |
| ⬡ Projets    | Rapports, atelier brief→DAG, plan/lancement de merge, conflits                                               |
| 🕺 Essaim    | Nœuds + Waggle Board (podium nectar)                                                                         |
| 💓 Santé     | Pouls (latences, débit) + anomalies Ghost                                                                    |
| 📜 Chronique | Journal filtrable + Time-Lapse sépia                                                                         |
| 🧠 Mémoire   | Hive Mind pleine page + OpenAlex                                                                             |

## 3. La Reine (concierge) — mondiale par construction

- `POST /api/chat` + CLI `ask` + vue dédiée : réponses composées depuis
  l'**état réel** (rapports, pouls, nectar, anomalies, mémoire, revues),
  100 % hors-ligne par défaut ; mode IA optionnel (clé locale à la Queen),
  qui répond **dans la langue du message** (fr/en natifs en mode live).
- Aide au cadrage pour le donneur d'ordre : bonnes pratiques par type de
  projet + structure de brief efficace.
- Prompt durci : données non fiables délimitées et normalisées
  (anti-injection via noms de projets du marketplace).

## 4. Revue humaine partagée + merge sélectif

- Verdicts **côté serveur** (`POST /api/tasks/:id/review`, `GET /api/reviews`,
  événement `task_reviewed`) : tous les opérateurs voient les mêmes
  approbations en temps réel. 409 sur la pré-approbation d'une tâche non
  terminée.
- **Une tâche rejetée en revue ne coule jamais dans le miel** : le serveur
  (source de vérité) la refuse nominativement dans une sélection et l'exclut
  d'office du repli « tout le terminé ».
- Client convergent : hydratation fencée, POSTs sérialisés par tâche,
  événements WS différés puis rejoués, outbox persistée avec détection de
  conflit (le geste le plus récent gagne), bandeau « revues non
  synchronisées ».

## 5. Night Shift réellement câblé

- `HIVE_SHIFT` agit : hors heures de service, le nœud refuse tâches **et
  merges** (aucune tentative brûlée) avec `retryAfterMs` — le hub ne le
  re-sollicite pas en boucle (cooldown proportionnel, borné 24 h, purgé à la
  ré-inscription). Config malformée = refus propre, jamais de tâche otage.

## 6. Qualité

- **4 vagues de revue adversariale** (56 agents vérificateurs) :
  **43 défauts confirmés et corrigés** avant l'aube (21, puis 10, puis 8, puis 4).
- 268 tests vitest verts (dont intégration serveur+nœud réels), TypeScript
  strict, ESLint + Prettier zéro erreur, CI GitHub verte sur chaque push.

## Reste à faire (proposé)

- **Vérification visuelle** du Mission Control (l'extension Chrome n'était
  pas connectée cette nuit) : `npm run demo` → http://localhost:7777.
- Sélection de nœud pour le merge : ignorer d'office les nœuds hors service
  (état de shift dans le register/heartbeat).
- i18n complète de l'interface (la Reine est déjà multilingue).
- Compare-and-set serveur sur les revues (`updatedAt`) pour le multi-opérateur
  intensif ; identité d'auteur (`clientId`) dans `task_reviewed`.
- Drone Wars : câblage du moteur de redondance compétitive dans le scheduler.
