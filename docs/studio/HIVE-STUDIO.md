# Hive Studio — l'interface de pilotage

Hive Studio est la refonte du tableau de bord demandée par l'issue #579 (et
cadrée par #578). Sa référence visuelle est la maquette validée,
[`docs/maquettes/hive-studio/dashboard-reference.png`](../maquettes/hive-studio/dashboard-reference.png) ;
l'audit qui l'a précédée est [`AUDIT.md`](AUDIT.md).

Elle ne remplace aucune fonction : chaque page de l'ancien « Mission Control »
existe toujours, à la même adresse (`#/miellerie/<id>`) et sous la même touche.
Ce qui change, c'est la façon de les trouver, et l'écran par lequel on entre.

## Ce que l'écran doit dire

La règle de #579 : chaque élément visible répond à au moins une de ces quatre
questions — **où suis-je**, **que se passe-t-il**, **que puis-je faire
maintenant**, **qu'est-ce qui demande mon attention**. Ce qui ne répond à
aucune est rangé dans un menu, pas supprimé.

| Zone             | Où suis-je                       | Que se passe-t-il                       | Que faire                             | Attention                                 |
| ---------------- | -------------------------------- | --------------------------------------- | ------------------------------------- | ----------------------------------------- |
| Rail (gauche)    | la section allumée               | le pouls de la ruche (débit, réussite)  | changer de section, favoris           | pastille d'alertes, productions à valider |
| Barre du haut    | le projet actif, le fil d'Ariane | liaison avec la ruche, IA en ligne      | rechercher (Ctrl/Cmd + K), actions    | la cloche : ce qui attend une décision    |
| Accueil (centre) | le projet, la mission en cours   | les tâches de la mission, leur état     | décrire une mission, arrêter, valider | les productions à valider de la mission   |
| Colonne (droite) | —                                | les agents et leur tâche réelle, le fil | inviter une machine ou une personne   | une machine hors ligne, un échec          |

## La navigation : sept sections, les pages en onglets

Le rail porte sept sections. Une section ouvre sa première page ; ses autres
pages sont des onglets en tête de la zone centrale. Les pages renommées gardent
leur **ancien nom** dans l'infobulle de leur onglet et dans la recherche :
« Miellerie » trouve toujours la Validation.

| Section         | Pages (touche)                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Accueil         | Accueil (`s`)                                                                                                                                |
| Projets         | Projets (`4`), Code — ex-Rayon (`9`)                                                                                                         |
| Missions        | Vue d'ensemble — ex-Ruche (`1`), Validation — ex-Miellerie (`3`), Historique — ex-Chronique (`7`), Débats — ex-War Room (`w`)                |
| Agents          | Machines — ex-Essaim (`5`), Reine (`2`), Santé (`6`), Mémoire (`8`), Cerveau (`c`, admin) ; la Chambre d'une machine s'ouvre depuis sa fiche |
| Équipe          | Mon espace (`0`), Intendance (`i`, admin)                                                                                                    |
| Automatisations | Chantiers (`h`)                                                                                                                              |
| Marketplace     | Projets ouverts (`m`)                                                                                                                        |

`NAV` dans `dashboard/src/App.tsx` reste la source de vérité des pages et de
leurs touches ; `dashboard/src/studio/navigation.ts` les **range** en sections.
Un banc (`tests/studio-modules.test.ts`) lit `NAV` dans la source et rougit si
une page n'a pas de section, ou si une section range une page inconnue.

Les touches restent actives hors des champs de saisie et des dialogues ; sur un
clavier AZERTY, la rangée du haut marche sans Maj (`e.code`). `?` ouvre la
liste des raccourcis ; `Ctrl/Cmd + K` ouvre la recherche depuis n'importe où.

Sur un écran étroit (≤ 768 px), le rail devient un tiroir (bouton menu de la
barre, Échap ou un clic dehors le referment). Sur un écran large, il se replie
en icônes, et le choix se retient.

## L'accueil

1. **Le panorama** — l'image `mountain-sunset` des assets, en WebP (1280 px ou
   2172 px de large selon l'écran), avec l'illustration SVG en repli.
   Il est posé en fond CSS d'une zone de hauteur fixe : il ne décale jamais la
   mise en page, et un dégradé le fond dans la page sous le texte. Il se
   masque dans les Réglages.
2. **La saisie de mission** — en langage naturel. « Préparer le plan » demande
   un plan à la Reine (`POST /api/plan` : tâches, dépendances, agents, devis) ;
   **rien n'est écrit** tant que la personne n'a pas cliqué « Lancer la
   mission », qui crée les tâches (`POST /api/projects/:id/tasks`). Une
   question (« où en est… ? ») part, elle, au chat de la Reine (`POST /api/chat`).
   Les suggestions ne font que remplir le brouillon.
3. **La mission en cours** — lue dans la liste des missions que la Reine tient
   elle-même (`GET /api/projects/:id/missions`) ; à défaut, ce qui vole
   (tâches en file ou en cours du projet). Elle montre le compte de tâches
   terminées sur le total, le temps écoulé et les agents qui y travaillent.
   **Pas d'estimation de fin** (la ruche n'en calcule pas) et **pas de bouton
   Pause** (le moteur ne suspend pas une tâche) : « Arrêter » annule les
   tâches en vol, après confirmation.
4. **L'espace de travail** — deux panneaux redimensionnables (souris, doigt ou
   flèches du clavier sur le séparateur ; la taille se retient), chacun
   agrandissable. À gauche : conversation avec la Reine, plan de la mission,
   fichiers du dépôt (lus par le Rayon, éditeur en lecture seule). À droite :
   les résultats — diff et journaux de chaque production, et le verdict
   (valider ou rejeter) qui se pose sur place, comme dans la Validation
   (`POST /api/tasks/:id/review`). Le raisonnement interne des modèles n'est
   jamais affiché : seulement ce que les agents produisent et déclarent.

## La colonne des agents

- **Agents** : chaque machine connectée, son **outil déclaré** (Claude Code,
  Codex, Gemini CLI…, jamais un rôle inventé), sa disponibilité (libre,
  occupée, pleine, hors ligne) et la tâche qu'elle tient réellement.
  « Simulé » est dit comme tel, et passe après les vraies IA.
- **Activité** : les faits du journal (tâche confiée, terminée, en échec,
  mission ouverte ou close, machine connectée), filtrés sur le projet actif,
  chacun menant à sa tâche.
- **Collaborer** : le bouton **Inviter**, qui ouvre l'invitation.
- **Le guide de démarrage** — trois étapes (un projet, une IA, une mission),
  cochées sur des **faits** de la ruche et pas sur des clics. Il s'ignore et se
  rejoue depuis les Réglages.

Sur l'accueil d'un écran large (≥ 1280 px), la colonne est posée et repliable.
Ailleurs, elle s'ouvre en tiroir à la demande : elle ne prend jamais la place
d'une page dense.

## Inviter

Deux invitations distinctes, dans le même dialogue :

- **Une machine** (un agent de plus) : le lien de porte de la ruche (#575) —
  un billet à usage unique, valable 24 h, révocable, qui ne contient jamais le
  jeton maître. L'hôte voit l'invité arriver : le lien ouvert, puis la machine
  entrée (`porte_ouverte`, `node_joined`).
- **Une personne** : par l'**identifiant de son compte** (pas par courriel —
  la ruche ne révèle pas qui a un compte) ; le propriétaire du projet l'y
  admet comme membre. Ou un lien de partage, en lecture seule et sans compte,
  expirable et révocable.

## Réglages, thème, préférences

Le thème est **sombre par défaut**, clair ou automatique dans les Réglages. Il
est posé avant la première peinture par `dashboard/public/theme-init.js` — un
fichier et non un script en ligne, parce que l'application de bureau impose
`script-src 'self'`. Les jetons de couleur de Hive Studio sont des noms de rôle
qui renvoient aux jetons existants de `styles.css` ; le style des composants
vit dans `dashboard/src/studio/studio.css`.

Toutes les préférences d'affichage restent **dans ce navigateur**
(`localStorage`), aucune route n'a été ajoutée pour elles :

| Clé                    | Contenu                                         |
| ---------------------- | ----------------------------------------------- |
| `hive.theme`           | `sombre`, `clair` ou `auto`                     |
| `hive.studio.banniere` | panorama affiché ou non                         |
| `hive.studio.colonne`  | colonne des agents posée ou repliée             |
| `hive.studio.rail`     | rail déplié ou en icônes                        |
| `hive.studio.guide`    | guide de démarrage nouveau ou ignoré            |
| `hive.studio.projet`   | projet actif choisi                             |
| `hive.studio.favoris`  | projets épinglés dans le rail                   |
| `hive.studio.partage`  | taille des deux panneaux de l'espace de travail |
| `hive.studio.onglet`   | onglet ouvert de l'espace de travail            |
| `hive.studio.briefs`   | le texte des dernières missions lancées d'ici   |

Une valeur illisible n'est jamais crue : elle retombe sur le défaut
(`studio/preferences.ts`, bancs dans `tests/studio-modules.test.ts`). La
conversation de l'accueil vit en `sessionStorage`, par projet (60 messages au
plus).

## Accessibilité

- Lien « Aller au contenu » en premier arrêt de Tab ; un seul repère `main`.
- `aria-current="page"` sur la section et sur l'onglet courants.
- La recherche est une combobox (`aria-activedescendant`), entièrement au
  clavier ; les dialogues piègent le focus et se ferment à Échap.
- Contrastes des jetons sombres mesurés au-dessus de WCAG AA pour le texte
  (texte principal, atténué et discret sur le fond et les panneaux).
- `prefers-reduced-motion` : la garde globale de `styles.css` couvre aussi les
  animations de Hive Studio.

## Vérifier

```
npm run typecheck:dashboard
npx vitest run tests/studio-modules.test.ts tests/app-*.test.tsx
npm run captures -- --formats grille     # les six largeurs de la recette (#579 § 8)
```

`--formats grille` photographie chaque page à 1920 × 1080, 1440 × 900,
1366 × 768, 1024 × 768, 768 px et 375 px, sur une ruche de laboratoire
(voir [`../CAPTURES.md`](../CAPTURES.md)) ; le manifeste dit, pour chaque image,
si la page déborde de l'écran et quelles erreurs la console a vues.

## Ce qui n'est pas pris en charge

Dit plutôt que simulé :

- **La recherche** cherche dans ce que l'écran connaît déjà (projets, tâches,
  machines, pages, commandes) ; le contenu des fichiers se cherche dans « Code ».
- **Les panneaux** se redimensionnent et s'agrandissent ; ils ne se
  réordonnent pas par glisser-déposer.
- **Le terminal** n'est pas dans l'accueil : les journaux d'une production se
  lisent dans ses résultats, et la console en direct d'une machine dans sa
  Chambre.
- **La Marketplace** montre les projets ouverts réels et la porte pour les
  rejoindre — pas de catalogue d'agents ni de modèles payants : la ruche n'en a
  pas.
