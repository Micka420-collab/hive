# ADR 0011 — La ruche coordonne les outils IA déjà installés

- **Statut** : **proposé** — analyse rendue, aucune ligne de code écrite
- **Date** : 2026-08-23
- **Décision attendue de l'humain** : le niveau d'intégration retenu par outil,
  et le modèle de travail (§ 8) — les deux ont des conséquences irréversibles.

## Ce que la mission demande

Faire de Hive « la couche qui permet à ces outils de travailler ensemble » —
Claude Code, Cursor, Windsurf, Cline d'abord, d'autres ensuite. Pas un IDE de
plus. Une couche d'orchestration.

L'ordre était explicite : **analyser avant d'implémenter**, et ne jamais
inventer une API. Ce document est cette analyse. Il dit aussi, en clair, les
trois endroits où la vision se heurte à ce qui existe.

---

## 1. Architecture actuelle de Hive

### La bonne nouvelle, et elle change le plan

**Le système d'adaptateurs demandé au § 5 existe déjà.**

`src/adapters/index.ts` définit `AgentAdapter`, et l'orchestrateur ne connaît
jamais l'outil qui exécute :

```ts
export interface AgentAdapter {
  name: string;
  run(task: Task, ctx: AdapterContext): Promise<AdapterResult>;
}
```

Sept adaptateurs l'implémentent : `claude-code`, `cursor`, `codex`, `grok`,
`hermes-agent`, `custom`, `shell`. Le contrat porte déjà ce qui compte pour
l'orchestration réelle — répertoire isolé, environnement épuré, `AbortSignal`
d'annulation, remontée de progrès, et surtout `infra?: boolean`, qui distingue
« la tâche a échoué » de « l'agent est injoignable ou non authentifié ». Cette
distinction-là est exactement le § 17 (robustesse) : un échec d'infrastructure
ne brûle pas une tentative, il redemande une réaffectation.

**Conséquence sur le plan :** il n'y a pas d'architecture d'adaptateurs à
construire. Il y a un contrat à **élargir**, et deux listes fermées à ouvrir.

### La cartographie, point par point (§ 19)

| #   | Ce qui est demandé | Où ça vit                                                                                  | État                                                    |
| --- | ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | Architecture       | hub-and-spoke : orchestrateur Fastify + WS, nœuds, tableau de bord React                   | mûr                                                     |
| 2   | La Queen           | `concierge.ts` (chat), `planner.ts`, `queen-bee.ts`, `queen-intelligence-core.ts`          | chat **en lecture seule** — 9 intentions, aucune action |
| 3   | Les agents         | `src/adapters/*`, `agent-detect.ts`                                                        | contrat à une seule méthode                             |
| 4   | Protocole          | `src/shared/protocol.ts` — `register`, `assign_task`, `task_result`, `requisition_*`       | extensible, versionné par champs optionnels             |
| 5   | Projets            | `store.ts` (SQLite), table `projects`                                                      | mûr                                                     |
| 6   | Fichiers           | `rayon.ts` (sûreté des chemins), `miroir.ts` (clone en lecture seule)                      | mûr                                                     |
| 7   | Git                | `livraison.ts`, `github.ts`, `merge-runner.ts`, `scripts/fusionner.sh`                     | mûr, **mono-branche par tâche**                         |
| 8   | Tâches             | `scheduler.ts` — promotion par dépendances, assignation, reprises                          | mûr                                                     |
| 9   | Mémoire            | `hive-mind.ts`, `cerveau.ts`, `horizon.ts`, `motifs.ts`                                    | mûr                                                     |
| 10  | Mission Control    | `dashboard/src/` — 13 vues                                                                 | mûr                                                     |
| 11  | Sécurité           | `auth.ts`, `acces.ts`, `isolement.ts`, `bac.ts`, `gardiennes.ts`, `donnees-non-fiables.ts` | **le point fort du dépôt**                              |
| 12  | Points d'extension | `getAdapter()`, `AGENT_TYPES`, `HIVE_AGENT_CMD`                                            | **fermés** — voir ci-dessous                            |

### Le défaut structurel, mesuré

`getAdapter()` est un `switch`, `AGENT_TYPES` est un tuple `as const`. Un
recensement automatique montre qu'ils ne coïncident pas :

```
adaptateurs : shell, claude-code, cursor, codex, custom, grok, hermes-agent
détectables : claude-code, cursor, codex, grok, custom, shell

ADAPTATEUR SANS DÉTECTION : hermes-agent
```

**Correction apportée à ce document après relecture du code.** J'avais d'abord
écrit que `hermes-agent` était « inatteignable ». C'est faux, et
`tests/agent-type-garde.test.ts` le dit en toutes lettres : l'écart est
**délibéré et gardé**. `getAdapter()` accepte une chaîne libre, donc
`HIVE_AGENT=hermes-agent` l'assigne très bien. `AGENT_TYPES` ne liste pas les
agents _exécutables_ — il liste ceux dont Hive sait **provisionner les
identifiants**.

Le vrai défaut est plus fin, et il n'en est pas moins réel. Ajouter un outil
demande aujourd'hui de toucher **six endroits** :

| #   | fichier                                  | ce qu'on y ajoute                  |
| --- | ---------------------------------------- | ---------------------------------- |
| 1   | `adapters/<outil>.ts`                    | l'adaptateur                       |
| 2   | `adapters/index.ts`                      | une branche du `switch`            |
| 3   | `agent-detect.ts` → `PROBES`             | comment le détecter                |
| 4   | `agent-detect.ts` → `AGENT_TYPES`        | s'il faut lui provisionner une clé |
| 5   | `agent-detect.ts` → `agentCredentialEnv` | quelles variables                  |
| 6   | `agent-libelle.ts` → `MARQUES`           | son nom lisible                    |

Une seule paire est gardée (`getAdapter` ↔ `AGENT_TYPES`). Les quatre autres
peuvent diverger en silence — et c'est ce qui rend le § 18 (« ajouter dix
outils sans modifier la Queen ») coûteux là où il devrait être trivial.

### Ce que la Queen ne sait pas faire, et qui bloque le § 11

`concierge.ts:184` :

```ts
export type Intent =
  'progress' | 'recent' | 'nodes' | 'races' | 'health' | 'memory' | 'review' | 'brief' | 'help';
```

Neuf intentions, **toutes en lecture seule**. La Queen d'aujourd'hui _raconte_
la ruche ; elle ne la _dirige_ pas. Le § 11 (« Analyse → Décomposition →
Sélection → Exécution ») demande une Queen qui agit. La décomposition existe
ailleurs (`planner.ts`) mais n'est pas reliée au chat.

---

## 2. Le comparatif des intégrations — vérifié, pas supposé

C'est la section où je devais ne rien inventer. Chaque ligne est vérifiée sur
la documentation officielle de l'éditeur, sources en bas.

| Outil           | Agent pilotable sans interface ? | Mécanisme officiel                                                               | Niveau atteignable |
| --------------- | -------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| **Claude Code** | **oui**                          | `claude -p` + SDK + hooks + MCP                                                  | **4–5**            |
| **Cursor**      | **oui**                          | `cursor-agent -p --force --output-format stream-json`                            | **3–4**            |
| **Cline**       | **oui**                          | `cline --json "tâche"`, `--auto-approve`, API gRPC, SDK Node                     | **3–4**            |
| **Windsurf**    | **non**                          | _aucune API publique de pilotage_ ; MCP entrant via `~/.codeium/mcp_config.json` | **1–2**            |

### Ce que ça change, et c'est le cœur de l'analyse

**Trois des quatre outils s'orchestrent avec le contrat qui existe déjà.**
Claude Code et Cursor sont branchés. **Cline est un ajout quasi mécanique** —
`cline --json` a exactement la forme de `claude -p` et de `agent -p` : une
commande, un prompt en dernier argument, du NDJSON en sortie. C'est un
adaptateur de 60 lignes, pas un chantier.

**Windsurf est d'une autre nature, et il faut le dire franchement.** Il n'expose
aucun moyen documenté de lui confier une tâche depuis l'extérieur. Toute
tentative passerait par du pilotage de fenêtres ou des fichiers internes — ce
que le § 4 de la mission interdit, et avec raison.

Mais l'intégration n'est pas impossible : **elle est inversée**. Windsurf sait
se connecter à des serveurs MCP (stdio, HTTP, SSE), et `~/.codeium/mcp_config.json`
est un fichier de configuration **documenté**. Hive peut donc exposer un serveur
MCP que Cascade appelle. Ce n'est pas Hive qui pilote Windsurf ; c'est Windsurf
qui vient chercher du travail dans la ruche.

Cette inversion vaut aussi pour Cline (MCP) et Claude Code (`.mcp.json`), et
c'est **la vraie réponse au § 18** : les dix outils suivants seront très
majoritairement des IDE sans API sortante, et l'entrée MCP les accueille tous
sans que la Queen change d'une ligne.

### Deux directions, pas une

```
SORTANTE — la ruche appelle l'outil        ENTRANTE — l'outil appelle la ruche
  Hive → cline --json "…"                    Windsurf/Cascade → MCP → Hive
  Hive → claude -p "…"                       Cline            → MCP → Hive
  Hive → cursor-agent -p "…"                 Claude Code      → MCP → Hive
  ⇒ la Queen choisit et impose               ⇒ l'humain déclenche depuis son IDE
  ⇒ niveaux 3 à 5                            ⇒ niveaux 1 à 3
```

L'architecture doit porter **les deux**. Ne porter que la sortante exclut
Windsurf et tous ses semblables ; ne porter que l'entrante retire à la Queen le
pouvoir de décider.

---

## 3. Architecture cible

### Ce qui ne bouge pas

Le hub-and-spoke, le protocole, le scheduler, le modèle de sécurité. Ils
tiennent. Les refondre pour cette mission serait détruire ce qui marche.

### Les quatre changements, et leur justification

**A. Un catalogue, six lectures.** Les six endroits ci-dessus deviennent des
VUES d'une seule déclaration par outil — `PROBES`, `AGENT_TYPES`, les variables
d'identifiants, le libellé, le paquet d'installation et la table des fabriques
s'en dérivent. Ajouter un outil redevient l'ajout d'une entrée.

L'écart voulu ne disparaît pas pour autant : une entrée déclare `identifiants:
null` quand Hive ne sait pas provisionner sa clé, et `AGENT_TYPES` l'exclut
comme aujourd'hui. La différence est qu'elle est alors **dite** plutôt que
subie.

**B. Le contrat déclare ses capacités.** `AgentAdapter` gagne un
`capabilities()` — ce que l'outil sait _réellement_ faire :

```ts
interface Capacites {
  readonly executionTache: boolean; // peut recevoir une tâche
  readonly flux: boolean; // rend du progrès en continu
  readonly annulation: boolean; // honore l'AbortSignal
  readonly injectionContexte: boolean; // accepte un contexte en entrée
  readonly extractionContexte: boolean; // rend ce qu'il a compris
  readonly modeleChoisi: boolean; // accepte --model
  readonly niveau: 0 | 1 | 2 | 3 | 4 | 5;
}
```

**Rien n'est forcé.** Windsurf déclarera `executionTache: false`, et la Queen ne
lui demandera jamais une tâche — au lieu de la lui demander et d'échouer.

**C. Une porte entrante MCP.** Un serveur MCP exposant un petit nombre d'outils
— `taches_du_projet`, `prendre_une_tache`, `rendre_le_resultat`,
`contexte_pour` — que Windsurf, Cline et Claude Code atteignent par leur
configuration MCP documentée.

**D. La Queen agit.** Une intention `mission` qui relie le chat à `planner.ts`,
et rend la décomposition **visible et validable** avant exécution.

---

## 4. Modèle de travail : la comparaison demandée (§ 8)

|             | Dossier partagé         | Branche par agent | Worktree par agent     | Hybride |
| ----------- | ----------------------- | ----------------- | ---------------------- | ------- |
| Sécurité    | ✗ écrasements           | ~                 | **✓ isolation réelle** | ✓       |
| Simplicité  | **✓**                   | ~                 | ~                      | ✗       |
| Conflits    | ✗ constants             | ~ au merge        | ~ au merge             | ~       |
| Isolation   | ✗ nulle                 | ~ logique         | **✓ physique**         | ✓       |
| Coût disque | **✓ nul**               | ✓ nul             | ✗ un arbre par agent   | ~       |
| Merge       | ✗ impossible à arbitrer | ✓                 | ✓                      | ✓       |

**Recommandation : worktree par tâche, pas par agent.**

Le dossier partagé est à écarter sans hésiter : deux agents qui écrivent le même
fichier produisent un résultat que personne ne peut arbitrer _après coup_.

Entre branche et worktree, le worktree gagne pour une raison que ce dépôt
connaît déjà : **le nœud isole déjà chaque tâche dans son propre répertoire**
(`AdapterContext.cwd`, `isolement.ts`, `bac.ts`). Le worktree n'est pas une
couche nouvelle, c'est la couche existante rendue git-consciente.

« Par tâche » et non « par agent » parce que l'unité de conflit est la tâche :
un agent qui enchaîne trois tâches sur trois zones du code n'a aucune raison de
partager un arbre entre elles.

---

## 5. Contexte : ce que je conteste dans la vision

Le § 9 demande de synchroniser « contexte, objectifs, tâches, état, fichiers,
décisions, résultats, erreurs, contraintes, historique ». Le § 10 tempère
aussitôt : n'envoyer que le nécessaire.

**Le § 10 a raison contre le § 9, et il faut choisir le § 10 dès maintenant.**

Envoyer un contexte large à un agent n'est pas neutre : c'est du budget de
contexte dépensé, du coût, et surtout de la **surface d'injection**. Ce dépôt a
déjà fermé une faille d'injection dans Hive Mind et maintient
`donnees-non-fiables.ts` : tout ce qui vient d'un agent est une donnée, jamais
une instruction. Diffuser à trois agents ce qu'un quatrième a produit, c'est
offrir à un agent compromis un canal vers les trois autres — le § 15 le nomme
lui-même, « agent-to-agent attacks ».

**Le contexte doit être tiré, pas poussé.** L'agent demande ce dont il a besoin
par la porte MCP entrante ; la Queen décide ce qu'elle accorde. C'est le
« Context Router » du § 10, et c'est aussi le modèle le plus sûr.

---

## 6. Modèle de sécurité (§ 14 et § 15)

Le § 14 est **déjà tenu** par l'architecture existante, et c'est important :
les clés vivent sur le poste de leur propriétaire, jamais dans le hub. Le
protocole n'a aucun champ par lequel un secret voyagerait. `agent-detect.ts`
porte `SECRETS_JAMAIS_SONDES`. Un utilisateur qui prête un agent ne prête pas
ses identifiants.

Ce que la mission ajoute et qui demande du travail neuf :

| Risque                                      | Réponse                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- |
| Un agent lit le travail d'un autre          | contexte **tiré**, jamais diffusé                                |
| Un IDE se fait passer pour la ruche via MCP | jeton par outil, révocable, portée par projet                    |
| Injection par le résultat d'un agent        | `donnees-non-fiables.ts` étendu à la porte MCP                   |
| Une tâche malveillante                      | la porte entrante ne **crée** jamais de tâche, elle en **prend** |
| Chaîne d'approvisionnement                  | catalogue d'installation **fermé et gelé** — déjà en place       |

**Une décision de conception, à valider par vous :** la porte MCP entrante doit
être en **lecture + prise de travail**, jamais en création. Un IDE qui pourrait
créer des tâches dans la ruche donnerait à n'importe quelle invite malveillante
lue par cet IDE un moyen d'ordonner du travail à toute l'équipe.

---

## 7. Le MVP (§ 21)

Le plus petit système qui rend le scénario du § 22 **vrai**, sans rien simuler :

1. **Ouvrir le registre** + la sentinelle d'accord. `hermes-agent` redevient
   atteignable. _(aucune capacité nouvelle, un défaut fermé)_
2. **Adaptateur Cline.** `cline --json`, sur le modèle exact de `cursor.ts`.
3. **`capabilities()` sur le contrat**, avec le niveau déclaré par outil.
4. **Détection élargie** : Cline et Windsurf s'ajoutent au diagnostic qui
   croise déjà binaire et clé.
5. **L'écran de choix** du § 2 — cases à cocher sur ce qui est _constaté_.

À ce point : trois agents réels orchestrés, Windsurf **détecté et affiché
honnêtement au niveau 1**. Le scénario du § 22 tient, sans mentir sur Windsurf.

Ensuite seulement : porte MCP entrante (6), worktrees (7), intention `mission`
de la Queen (8), contexte tiré (9).

---

## 8. Les trois choses que je conteste

**Le tableau du § 2 promet plus que ce qui est possible.** « ✓ Windsurf » à côté
de « ✓ Claude Code » laisse croire à deux agents équivalents. Ils ne le sont
pas. L'écran doit afficher le **niveau**, sinon Hive ment dès le premier écran —
et c'est exactement ce que le § 20 cherche à éviter.

**« Hive détecte automatiquement » a une limite dure.** Détecter qu'un binaire
existe est fiable. Détecter qu'il est _authentifié_ ne l'est pas toujours sans
le lancer. La ruche doit distinguer « trouvé » de « utilisable » — le diagnostic
qui croise binaire et clé le fait déjà, et il faut l'étendre plutôt que
promettre une détection parfaite.

**Le § 11 suppose que la Queen sait décomposer une mission.** Elle sait
planifier (`planner.ts`), elle ne sait pas _converser puis agir_ : son chat est
en lecture seule. C'est un lot à part entière, pas un câblage — et le sous-estimer
donnerait une démonstration qui marche une fois.

---

## 9. Ce que ce document ne tranche pas

Deux décisions vous appartiennent, parce qu'elles sont difficiles à défaire :

1. **Le niveau visé pour Windsurf.** Niveau 1 honnête (détecté, affiché, non
   orchestré) ou effort sur la porte MCP entrante dès le MVP ?
2. **Le modèle de travail.** Je recommande le worktree par tâche. Il coûte du
   disque et complique la livraison ; le dossier partagé ne coûte rien et perd
   du travail. C'est un arbitrage, pas une évidence.

---

## Sources

Vérifié le 23 août 2026, documentation officielle des éditeurs :

- Cursor CLI, mode headless — <https://cursor.com/docs/cli/headless>
- Cursor CLI, formats de sortie — <https://cursor.com/docs/cli/reference/output-format>
- Cline CLI, prise en main — <https://docs.cline.bot/cline-cli/getting-started>
- Cline, dépôt et SDK — <https://github.com/cline/cline>
- Windsurf, intégration MCP de Cascade — <https://docs.windsurf.com/plugins/cascade/mcp>
