# ADR 0010 — La Chambre : poste de travail d'une ouvrière baptisée

- **Statut** : **accepté**
- **Date** : 2026-08-21
- **Décision** : accepté (validation humaine déléguée au maintainer via agent
  cloud, 21 août 2026) — lots 0–6 + UI constatés ; lots 7–10 en consolidation.

## Pourquoi cet ADR existe avant l'écran

Parce qu'un tableau de bord qui **invente** un nom, un métier ou un fichier
ouvert est pire qu'un écran vide. La Chambre ne montre que du **constaté**. Si
le modèle (baptême, métier de cycle, présence Rayon) n'est pas d'abord pur et
testé, l'UI fabriquera du théâtre — exactement le défaut que ce dépôt refuse
(ADR 0008 : pas de bureau simulé ; ADR 0009 : pas de garde qui ment).

Cet ADR tranche l'architecture. Le code suit en lots numérotés ; l'UI (lot 5)
n'ouvre qu'après les lots 1–3 verts.

## Ce que l'humain doit voir

Comme dans un éditeur + le poste d'un collègue :

- qui planifie, qui édite, qui relit, qui teste ;
- le **nom baptisé** de chaque ouvrière — donné par la Reine, pas
  « claude-code » ni un prénom inventé par le nœud ;
- un journal d'activité **par** ouvrière nommée ;
- un flux long terme qui crée de la valeur (pas un DAG de 12 tâches puis le
  silence) ;
- la capacité de travailler sur tout (jeux, 3D, SaaS, sites, B2B/B2C, outils) ;
- des agents qui déterminent seuls leurs besoins (MCP, clés, binaires) et
  **demandent** à l'humain ;
- s'il manque un logiciel, la possibilité d'en **fabriquer** un dans le dépôt
  (revue + merge, puis Chantiers le voit parce qu'il est déclaré).

## Écran cible — quatre zones

1. **Gauche — identité** : nom baptisé, caste, métier du cycle, machine,
   marche/arrêt réel (`online`/`offline`). Onglets Fiche / Travail /
   Intégrations / Suivi. Pas de faux mail, visio, téléphone, portrait stock.
2. **Centre — journal daté** de CETTE ouvrière (plan, diffs, logs, captures),
   pas le chat Reine.
3. **Droite haut — Missions** filtrées (En cours / En pause / Terminées /
   Échecs) sur les `TaskStatus` de **cette** ouvrière seulement + horodatage.
4. **Droite bas — Ordinateur** = l'Atelier existant (noVNC). S'il est éteint,
   le **dire**. Interdit d'inventer un faux bureau.

Entrée : fiche `NodesPanel` → « Ouvrir la Chambre » ; carte **Essaim** ;
curseur **Rayon**. Hash `#/chambre/<nodeId>`.
Rayon : présence fichier (qui édite quel path), constatée depuis les outils
Read/Edit/Write — jamais du théâtre. Depuis la Chambre, **Voir le Rayon** (et
un clic sur un chemin) posent un focus fichier ; sans présence / sans projet →
silence, pas d'invention.

## Trois axes distincts (ne pas les fusionner)

| Axe                 | Source                                                                                      | Ce qu'il n'est pas                       |
| ------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Baptême**         | La Reine nomme ; persisté orchestrateur ; collision refusée                                 | Un champ protocole que le nœud enverrait |
| **Caste**           | Déjà dans `polyethisme.ts` (qualité observée)                                               | Un « métier » déclaré                    |
| **Métier de cycle** | `planifie \| edite \| relit \| teste \| filme \| sculpte \| outille` — assigné Reine/essaim | La caste                                 |

Le nœud **ne peut pas** s'auto-nommer ni s'auto-attribuer un métier via le
protocole (même doctrine que « une caste ne se déclare pas »).

## Long terme — trois mécanismes, un ordre

1. **Ledger d'horizon** (idée Magentic-One) : faits ≠ hypothèses à l'écran ;
   stall (`derive.ts`) → halte, pas butiner en silence. Queen Bee reste le lot
   **court** ; l'horizon n'injecte pas 10 000 tâches dans l'instantané.
2. **Réquisition** : l'agent émet un besoin (`cle_api` \| `mcp` \| `binaire` \|
   `atelier` \| `logiciel`). La Reine demande à l'humain **une** fois, en clair.
   Clé dans l'env Queen / Intendance. **Jamais** dans le nœud, jamais dans
   l'Atelier (`SECRETS` / `outil.ts`). MCP près de la Queen. Le nœud reçoit un
   artefact ou un refus.
3. **Fabrique** (idée Voyager pliée à Hive) : écrire le pont/script/MCP **dans**
   le repo → Miellerie → merge → Chantiers. Interdit d'exécuter une commande non
   déclarée. Ordre imposé : pas de chantier avant merge.
4. **Motifs inter-projets** : procédures (« jeu-3d : blender/fabrique AVANT les
   assets »), pas le diff d'un dépôt privé collé dans un autre.

## Invariants (ne pas casser)

- Clés chez l'hôte.
- Merge humain sauf essaim autonome + dépôt inscrit.
- Caste non déclarée par le nœud ; baptême / métier non déclarés par le nœud.
- `donnees-non-fiables` pour tout flux agent.
- `shell: false`.
- Chantiers : pas de commande inventée.
- Instantané borné.
- i18n FR/EN ; clavier (Échap, `useDialog`).
- **0 nouvelle dépendance runtime serveur.**
- Pas de thème sombre Delos ; pas de DGM (ADR 0009) ; pas de Blender dans le
  Dockerfile Atelier par défaut.
- Lien de partage : **jamais** d'identités qui travaillent (lecture seule).

## Options écartées

| Option                                                | Pourquoi non                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Clone cosmétique Delos                                | Marque / faux mail / faux bureau Google — théâtre              |
| CrewAI / LangGraph                                    | ADR 0009 — déjà refusé                                         |
| Auto-nommage nœud (`RegisterMsg.name` comme identité) | Contredit le baptême Reine ; collision et usurpation           |
| Métier = caste                                        | Orthogonal : la caste est une qualité ; le métier est un cycle |
| UI avant le modèle                                    | Invente ce qui n'est pas constaté                              |

## Lots d'implémentation (ordre imposé)

0. Cet ADR + ligne dans `docs/adr/README.md` (**accepté**).
1. `bapteme.ts` pur + store + tests. Aucun CSS.
2. `metier.ts` pur + tests d'absence de champ protocole.
3. Présence Rayon (événement constaté) + parser de flux.
4. API lecture (`/api/chambre/:nodeId`, `/api/presences`, `/api/baptemes`). Lien
   de partage : toujours sans identités actives.
5. Vue Chambre 4 zones.
6. Curseurs Rayon.
7. Réquisitions + exemple Seedance. _(consolidé : protocole WS + grant `cle_api` → `.env` Queen)_
8. Fabrique (pas de chantier avant merge). _(consolidé : pilotage consultatif Chambre — proposer / juger / lancer)_
9. `horizon.ts` + branchement essaim. _(consolidé : faits auto + contexte ouvrière)_
10. Motifs inter-projets. _(consolidé : catalogue + procédures perso projet)_
11. Docs `FONCTIONNALITES` + README + CHANGELOG.

**Règle d'or :** un écran qui invente un nom, un métier ou un fichier ouvert est
pire qu'un écran vide. Si un arbitrage visuel bloque (14ᵉ case nav, portrait),
**STOP** et demander. N'inventer pas de prénom type « Adrien ».

## Conséquences

- `nodes.name` (aujourd'hui recopié depuis `RegisterMsg.name`) cesse d'être
  l'identité affichée ; le baptême vit en **table latérale** (règle store 2).
- Le protocole n'acquiert **aucun** champ pour que le nœud pose son baptême ou
  son métier.
- L'Atelier (ADR 0008) reste le seul « Ordinateur » de la Chambre ; éteint =
  message clair, pas de simulacre.
