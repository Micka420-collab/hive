# Fonctionnalités — le détail

> Le [README](../README.md) dit ce qu'est Hive et comment le lancer. Ce
> fichier-ci dit ce que chaque partie fait, et **pourquoi elle est faite comme
> ça** — les arbitrages, les limites assumées, et ce qui a été mesuré plutôt
> que supposé.
>
> Il est volontairement long. Un README qui contient tout n'est lu par
> personne ; une référence qu'on ouvre quand on en a besoin, si.

---

## 🎛️ Mission Control — l'interface de pilotage

Le dashboard (servi sur `:7777`) est une application complète de gestion de la
ruche, navigable au clavier (touches **1-9**, `0`, `h`, `i`, `c`) via une sidebar alvéolaire :

| Vue               | Ce qu'on y fait                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐝 **Ruche**      | Vue d'ensemble : Swarm View 2D/3D, KPIs, **pouls Plein Essaim** (niveau / pause / dérive → Projets), rayon de miel cliquable, file d'attente, journal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 👑 **Reine**      | Dialoguer avec la ruche dans **votre langue** : avancement, santé, classement, aide au cadrage de brief. **Flux SSE** (texte progressif), contexte multi-agents / Plein Essaim en lecture, tokens Anthropic, modes Chat / Plan / Autonomie / Sauvegardes, puce **Restaurer…**.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🍯 **Miellerie**  | **Revoir ce que les IA ont produit** : diffs par fichier, logs, verdict du Parlement **et surface — deux agents allés au même endroit, ou pas**, approbation (a) ou rejet (x) au clavier, puis merge Honeycomb.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ⬡ **Projets**     | Connecter un dépôt GitHub, rapports d'avancement, atelier brief→DAG (Queen Bee), plan et lancement de merge, conflits Sting, équipe, partage en lecture, Conseil des Éclaireuses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🐝 **Rayon**      | **Le code du projet, lisible** : arbre de fichiers, éditeur coloré, aperçu du site produit, retouche → tâche (avec filet `avant_retouche`), et **timeline de sauvegardes** (voir le patch, restaurer ouvre une tâche).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🕺 **Essaim**     | Cartes des nœuds membres + Waggle Board (podium nectar).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 💓 **Santé**      | Pouls de la ruche (débit, latences p50/p95, succès) + anomalies Ghost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 📜 **Chronique**  | Journal filtrable + Time-Lapse Replay (mode sépia « vous regardez le passé »).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 🧠 **Mémoire**    | Recherche dans le savoir de la ruche (Hive Mind) + bibliothèque scientifique OpenAlex.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🏗 **Chantiers**   | **Les travaux que le dépôt DÉCLARE**, à un clic : ses scripts sur un nœud de la ruche, ses workflows sur GitHub. La ruche choisit dans cette liste et n'invente jamais une commande — et ce qui SORT de la machine porte la raison pour laquelle il faut un humain.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 🪪 **Mon espace** | Le tableau de bord d'une personne : ses projets, son quota, ses abonnements, ses machines — et ce qui réclame son attention, classé par urgence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 🖥 **Intendance**  | _Administrateurs seulement._ Les machines démarrées pour les abonnés, les comptes de la ruche, et **les clés** : qui a une clé de votre ruche, et de quoi la révoquer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 🧠 **Cerveau**    | _Administrateurs seulement._ Le savoir de la ruche en **graphe vivant**, à la manière d'Obsidian : les notes se repoussent, les liens les rapprochent, un halo respire sur ce qui a servi récemment. Un point **creux** n'a jamais servi — c'est du savoir stocké sans usage. Les liens morts sont listés mais **jamais dessinés** : les tracer vers le vide inventerait une note qui n'existe pas. Lecture seule. **S'explore** : recherche insensible aux accents, filtres par genre, filtre « dorment », zoom, déplacement, et une vue **liste** — un vrai tableau navigable au clavier, parce qu'un écran qui n'existerait qu'en pixels serait le seul endroit où `NO_COLOR` et `TERM=dumb` s'arrêteraient. |

**Mon espace** répond à une seule question : _qu'est-ce qui va me coûter quelque
chose si je ne fais rien aujourd'hui ?_ Les alertes passent donc avant les
cartes, et leur ordre est une prise de position — ce qui est **irréversible**
(des données sur le point d'être effacées) prime ce qui coupe le service, qui
prime un quota qui se vide. Une facture se règle après coup ; des données
effacées ne reviennent pas.

**L'Intendance** exige un COMPTE administrateur, jamais le seul jeton de ruche :
celui-ci est distribué à chaque nœud membre, et s'en servir comme preuve
donnerait les pleins pouvoirs à toute machine qui butine. Le premier compte créé
est administrateur, et le dernier ne peut pas se retirer.

Les décisions de revue sont **partagées entre tous les opérateurs** (stockées
côté orchestrateur, synchronisées en temps réel via WebSocket ; repli
localStorage hors-ligne). « Couler le miel » n'intègre que les productions
**approuvées** — le merge reste toujours un geste humain explicite.

## 🐝 Le Rayon — voir le code, voir l'IA travailler

Ce que les membres voyaient jusqu'ici, c'étaient des **tâches** : des titres,
des états, des diffs. Jamais le code. On travaillait sur un projet sans pouvoir
l'ouvrir — comme aider à réparer un moteur sans avoir le droit de soulever le
capot. Le Rayon ouvre le capot.

| Ce qu'on y trouve      | Pour qui                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Arbre + éditeur**    | Toute abeille qui a accès au projet. Coloration pour 16 langages, fichiers bornés à 512 Ko.                                                            |
| **L'Aperçu**           | Le site que l'IA vient d'écrire, **rendu** — pas seulement son diff.                                                                                   |
| **La retouche**        | La Reine seulement. Corriger une ligne à l'écran crée une **tâche**, jamais une écriture. Filet `avant_retouche` (patch inverse) avant la proposition. |
| **Sauvegardes**        | Timeline d’étapes (diff capturé) ; **voir / copier le patch** ; restaurer ouvre une **tâche** puis raccourci Miellerie.                                |
| **Le lien de partage** | Montrer l'avancement et le code **sans donner la ruche** : jeton distinct, expirable, révocable.                                                       |

**Le hub tient son propre miroir** : un clone superficiel en lecture seule par
projet (`data/rayons/<id>`), rafraîchi au plus une fois par minute. Passer par
l'API GitHub aurait exigé le **jeton de l'hôte** — montrer le code à une abeille
dépenserait pour elle un droit qui n'est pas le sien. **`.git` n'est jamais
servi** : il contient `config`, donc l'URL distante, donc les identifiants du
dépôt privé ; ni `.env`, `.npmrc`, `id_rsa` et les extensions de clés.

**La retouche ne s'enregistre pas — elle se propose.** Le miroir est une copie
jetable : y écrire donnerait l'illusion d'avoir corrigé quelque chose, jusqu'au
prochain rafraîchissement qui effacerait tout en silence. Une modification
devient donc une **tâche** avec le contexte du fichier, qui passe par la revue
comme n'importe quelle production. Un porteur de lien de partage **lit** ; il ne
fabrique pas de travail pour l'essaim de quelqu'un d'autre.

**L'Aperçu s'exécute dans une origine opaque.** Prévisualiser un site que l'agent
vient d'écrire, c'est exécuter dans votre navigateur du HTML et du JavaScript que
personne n'a relus : servi en même origine que le tableau de bord, trois lignes
suffiraient à envoyer votre jeton de session ailleurs. Le document est donc replié
en un seul fichier auto-suffisant et affiché dans une `<iframe sandbox>` **sans
`allow-same-origin`** — le cadre ne lit ni le `localStorage`, ni les cookies — avec
une `Content-Security-Policy` qui coupe le réseau (`connect-src 'none'`,
`form-action 'none'`) et sans aucune navigation possible.

**Faire entrer une ouvrière dans un projet privé** se fait depuis le panneau
« Équipe » de la vue Projets. Un dépôt importé de GitHub arrive **sans
propriétaire** — l'import s'authentifie par le jeton de ruche, qui n'est le
compte de personne : un administrateur l'**adopte** d'abord, puis admet qui il
veut. On admet par **identifiant de compte**, jamais par courriel : le courriel
ferait de cette route un oracle « ce courriel a-t-il un compte ici ? »
interrogeable par tout propriétaire de projet. Chacun lit son propre
identifiant sur cette même carte, et le donne comme on se passe un billet.

**Partager en lecture** se fait depuis le panneau « Partage en lecture » de la
vue Projets, et donne une URL à coller :

```
https://<votre-tunnel>/#/rayon/<projet>?partage=hive3_…
```

Celui qui l'ouvre n'a **ni compte ni jeton de ruche** : il arrive sur un écran
dépouillé qui dit ce qu'il est (lecture seule), montre l'avancement et le code,
et rien d'autre — pas de barre latérale, pas d'essaim, pas de journal, et aucun
bouton de retouche. Il ne voit pas non plus **qui** travaille : les identifiants
de nœuds nomment les machines de gens qui n'ont pas consenti à figurer dans un
lien qu'on fait circuler. Le jeton voyage après le `#` — donc il n'apparaît dans
aucun journal d'accès — et il est retiré de la barre d'adresse dès qu'il est
rangé.

Le jeton de partage n'est **pas** le jeton de ruche : il porte deux actes
seulement (voir l'avancement, lire le code), vaut pour **un** projet, expire
(7 jours par défaut, 90 au plus) et se révoque un par un sans toucher aux
autres.

## 📦 L'environnement — l'agent installe ce dont il a besoin

`npm test` sur un clone frais échoue faute de `node_modules`. Le merge accepte
donc une **préparation** avant les tests :

```bash
npm run cli -- merge-run <projectId> -- --preparer npm ci --tester npm test
# ou les deux champs du panneau « Plan de merge » dans ⬡ Projets
```

**La préparation installe ce que le DÉPÔT déclare, jamais ce que la COMMANDE
nomme.** `npm ci` lit le `package-lock.json` du dépôt ; `npm install lodash`
laisse le hub choisir ce qui s'exécute sur la machine d'un membre. Sont donc
refusés : les binaires qui n'installent rien (`sh`, `curl`, `make`), les
sous-commandes qui ne sont pas des installations (`npm run deploy`), les
arguments qui nomment un paquet, et les drapeaux qui déplacent la **source**
(`--index-url`, `--registry`, `--userconfig`…). La préparation passe par le bac
à sable du nœud, comme les tests.

Si l'installation échoue — machine hors ligne, registre injoignable, lockfile
désaccordé — **les tests ne sont pas lancés** et le rapport le dit : « environnement
non préparé ». Un `✘ tests rouges` vous aurait envoyé chercher une régression
dans du code qui va très bien.

## 👑 La Reine répond — parler à la ruche

Chaque membre (donneur d'ordre comme porteur de nœud) peut interroger la ruche
en langage naturel — la langue du message est détectée et la réponse arrive
dans cette langue :

```bash
npm run cli -- ask "Où en est le projet ?"
npm run cli -- ask "Which node works best?"
# ou : POST /api/chat { "message": "…", "projectId"?: "…", "stream"?: true }
#     · Accept: text/event-stream → deltas puis done
#     · vue 👑 Reine et `hive ask` (même chemin SSE progressif)
```

Deux modes, jamais bloquants : **état réel** (réponses déterministes composées
depuis les rapports, le pouls, le nectar, les anomalies et la mémoire — 100 %
hors-ligne) et **IA** (si `ANTHROPIC_API_KEY` est définie côté Queen :
`HIVE_CHAT_MODEL`, défaut `claude-haiku-4-5` ; la clé ne quitte jamais
l'orchestrateur, et le modèle ne reçoit que les chiffres réels de la ruche).
État réel comme IA **fluxent** en SSE quand le client le demande (`stream:
true` ou `Accept: text/event-stream`) — la bulle Reine du dashboard et
`npm run cli -- ask` partagent ce chemin. Quitter la vue, **Effacer**, ou
**Ctrl+C** sur `hive ask` coupe le flux (pas de bulle d’erreur /
`(interrompu)`). Le prompt voit aussi, en lecture seule, le **travail en
cours**, les **sous-agents** et l’état **Plein Essaim** — la Reine n’élève
jamais l’autonomie ni ne réécrit git. La Reine guide aussi le donneur d'ordre :
bonnes pratiques par type de projet (web, API, mobile, data, e-commerce, CLI)
et structure de brief efficace. En mode IA, le décompte de **tokens** Anthropic
s’affiche sur chaque réponse (et en session). La barre de modes relie Chat →
Plan (Projets / Queen Bee) → Autonomie (Plein Essaim sur le projet) →
Sauvegardes (Rayon). S’il y a des échecs récents et une étape, la Reine propose
une puce **Restaurer…** qui ouvre la timeline du Rayon.

## 🪑 Chambre — poste d’ouvrière (ADR 0010)

Depuis la **fiche d’un nœud** (vue Ruche) → **Ouvrir le poste**
(`#/chambre/<nodeId>`) : identité baptisée, métier de cycle, caste, fichiers
ouverts **constatés** (Read/Edit/Write), **Journal** et **Missions** de **cette**
ouvrière, et l’**Ordinateur** = Atelier noVNC (ou « éteint » — pas de faux
bureau). Sur le **Rayon**, des curseurs montrent qui lit/édite quel chemin
(baptême, sinon silence) — un clic ouvre la **Chambre** de cette ouvrière ;
le bandeau **En train de…** liste les présences même si le miroir du dépôt
est vide. Les **réquisitions** (clé API, MCP, binaire, atelier,
logiciel) s’accordent ou se refusent depuis la Chambre — les secrets restent
chez la Queen. Un lien de partage **ne voit jamais** ces identités.

La **fabrique** propose un outil (script npm, pont, MCP) comme tâche → revue →
merge ; Chantiers ne peut le lancer qu’**après** merge et déclaration dans
`package.json`. L’**horizon** tient un carnet faits ≠ hypothèses (sans gonfler
l’instantané). Les **motifs** inter-projets (ex. jeu-3d : fabrique avant assets)
créent des tâches ordonnées — jamais le diff d’un autre dépôt.

À l’écran : bandeau **À trancher** (réquisitions), **Journal** avec
**flux outils** constatés, **Missions** filtrées, onglets Fiche / Travail /
Intégrations / Suivi (horizon + fabrique). Maquette : `docs/maquettes/chambre/`.

## 🧠 Queen Bee — du brief au DAG (Palier 2)

Dans **« Nouveau projet »**, décrivez l'objectif en langage naturel et cliquez
**« ✨ Générer les tâches »** : Hive propose un graphe de tâches, éditable avant
lancement. En terminal : `POST /api/plan { "brief": "…" }`.

Le planner est **pluggable**, avec repli automatique — jamais bloquant :

| Mode            | Quand                                          | Coût / clé                |
| --------------- | ---------------------------------------------- | ------------------------- |
| **Heuristique** | Défaut. Découpage déterministe par mots-clés.  | Hors-ligne, gratuit       |
| **IA (Claude)** | Si `ANTHROPIC_API_KEY` est définie côté Queen. | Clé **locale** à la Queen |

```bash
# Activer le planner IA (facultatif) — la clé ne quitte jamais l'orchestrateur.
ANTHROPIC_API_KEY=sk-ant-…            # présence → mode IA, sinon heuristique
HIVE_PLANNER_MODEL=claude-haiku-4-5   # défaut rapide/économique ; opus pour + de finesse
```

## 🧩 Hive Mind — la ruche apprend (Palier 2)

La ruche garde une **mémoire partagée** : chaque tâche réussie laisse un
_souvenir_ (ce qui a été fait + un extrait des logs). Avant d'assigner une
nouvelle tâche, l'orchestrateur récupère les souvenirs les plus pertinents et
**les injecte dans le prompt de l'ouvrière** — les tâches suivantes profitent du
travail déjà accompli.

La récupération est **100 % hors-ligne** (scoring lexical type BM25, sans
embeddings ni API), donc déterministe et sans coût. Le dashboard affiche un
**panneau Hive Mind** (recherche + souvenirs récents, en direct). Interrogez la
mémoire :

```bash
npm run cli -- mind "authentification jwt"   # souvenirs les plus pertinents
npm run cli -- mind                          # souvenirs récents
# ou : GET /api/hive-mind?q=…
```

## 🛡️ Sting Detector — prévention de conflits (Palier 2)

Deux tâches qui pourraient tourner **en même temps** (aucun ordre de dépendance
entre elles) et qui **touchent le même fichier** risquent de se marcher dessus.
Le Sting Detector les repère — analyse hors-ligne des titres/prompts, sans
exécuter d'agent :

- **Conflit fort** (même fichier cité) → l'ordonnanceur **diffère** l'une des
  deux jusqu'à ce que l'autre se termine (sérialisation, prévention effective).
- **Conflit faible** (fort recouvrement de vocabulaire) → simple **avertissement**
  dans le journal, jamais bloquant.

Un **panneau Conflits** apparaît dans le dashboard dès qu'un conflit est détecté,
les tâches retenues par sérialisation sont **marquées ⏸** dans la table, et les
événements défilent dans le Journal en temps réel.

```bash
npm run cli -- stings <projectId>            # conflits potentiels du projet
# ou : GET /api/projects/:id/conflicts
```

## 🤝 Inviter un ami (connecter son IA en 30 s)

1. **Vous (hôte)** — lancez l'orchestrateur avec un vrai token (`npm run dev`),
   puis créez un **billet** :

   ```bash
   npm run cli -- invite                    # sur le réseau local
   npm run cli -- tunnel                    # depuis n'importe où, en wss:// chiffré
   npm run cli -- invite --uses 3 --hours 2 # 3 machines, valable 2 h
   ```

   Vous obtenez une commande unique à envoyer :

   ```
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   ```

2. **Votre ami** — récupère Hive, lance `npm install`, puis **colle la commande**.
   Son Claude Code / Codex est détecté automatiquement, et sa clé de nœud est
   mémorisée pour les reconnexions.

   ```bash
   npm run join -- hive2_eyJ2IjoyLCJ1cmwiOiJ3c3M6…
   # 🐝 Connexion à : wss://…/ws  (« Ruche de Micka »)
   #    🔑 Clé de nœud obtenue et mémorisée — les redémarrages ne redemanderont rien.
   # ✔ Nœud démarré — vous butinez pour la ruche.
   ```

### Ce qu'un billet est, et ce qu'il n'est pas

Un billet **ne donne aucun pouvoir sur la ruche** : il ne sert qu'à obtenir une
**clé propre à la machine** de votre ami. C'est ce qui rend possible ce qui ne
l'était pas :

|                            |                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| **Éphémère**               | 24 h par défaut (`--hours`), puis il ne vaut plus rien                                           |
| **À usage compté**         | une seule machine par défaut (`--uses`)                                                          |
| **Révocable**              | `npm run cli -- revoquer <billetId>`                                                             |
| **Exclusion individuelle** | `npm run cli -- exclure <nodeId>` coupe **une** personne, immédiatement, sans toucher aux autres |
| **Rien en clair en base**  | seules des empreintes PBKDF2 sont rangées : une base volée ne donne aucun accès                  |

```bash
npm run cli -- membres        # qui a les clés, quels billets circulent encore
npm run cli -- exclure node-…  # sa clé ne vaut plus rien, sa connexion est coupée
```

> Un membre exclu **ne peut pas revenir avec le token maître** : ni sous son
> identifiant, ni sous un autre. Dès qu'une ruche a exclu quelqu'un, le token
> maître n'enregistre plus de machine inconnue — les nouvelles entrent par
> billet. Les machines déjà connues, elles, ne sont pas dérangées.
>
> Le résidu, dit franchement : le porteur du token maître peut encore se faire
> passer pour une machine **déjà connue**. Ce geste-là ne passe pas inaperçu, il
> coupe la connexion de la vraie machine — mais si votre token a fuité, changez-le
> plutôt que de compter sur l'exclusion.

### Se connecter depuis l'extérieur

Par défaut, la ruche n'est joignable que sur le réseau local. Pour un ami
ailleurs, `npm run cli -- tunnel` ouvre un tunnel sortant chiffré et émet le
billet dessus — **aucun port à ouvrir sur la box, aucun VPN, aucun domaine** :

```bash
npm run cli -- tunnel
# 🌍 Ouverture d'un tunnel via Cloudflare Quick Tunnel…
#    ✔ https://xyz.trycloudflare.com  →  wss://xyz.trycloudflare.com/ws
```

Pas de `cloudflared` ? Une commande vous dit quoi faire sur **votre** machine :

```bash
npm run cli -- cloudflare            # diagnostic + prochaines étapes
npm run cli -- cloudflare --install  # binaire local, AUCUN sudo
```

Hive n'embarque **aucune dépendance de tunnel** : la commande détecte un
`cloudflared` (ou `localtunnel`) que vous avez installé vous-même. Faire
transiter le code source de tous les membres par un tiers doit être votre choix,
pas un effet de bord d'un `npm install`.

> ⚠️ **`ws://` vers une adresse publique est refusé par défaut.** Ce n'est pas
> seulement le billet qui fuiterait, mais **tout le trafic** : prompts, logs et
> **diffs de code source**. Utilisez `wss://`, ou `--insecure` en connaissance de
> cause.

#### URL stable — pour une ruche qui dure

L'URL d'un tunnel rapide **change à chaque redémarrage**. Les nœuds mémorisent
leur clé et survivent aux relances, mais l'URL qu'ils ont apprise meurt avec le
tunnel : il faudrait réémettre un billet à **chaque membre, à chaque relance**.

Avec un compte Cloudflare (gratuit) et un domaine, dix minutes une fois suffisent
à obtenir une adresse définitive :

```bash
npm run cli -- cloudflare --setup ruche.mondomaine.com
```

La commande énumère les quatre étapes (`login`, `create`, `route dns`, `run`),
**dit pourquoi chacune existe**, signale celle qui ouvre un navigateur, et donne
la ligne à poser dans votre `.env` :

```
HIVE_PUBLIC_URL=wss://ruche.mondomaine.com/ws
```

Elle n'exécute rien à votre place : vous devez pouvoir lire ce qui va être fait
sur votre compte Cloudflare avant que ça arrive.

**Autres options d'adresse** : `HIVE_PUBLIC_URL=wss://mondomaine/ws`, ou
`npm run cli -- invite wss://mondomaine/ws`.

<details>
<summary>Ancien format <code>hive1_</code></summary>

Les invitations `hive1_` contiennent le **token maître** : accès total, sans
expiration ni révocation individuelle. Elles restent acceptées pour ne pas
déconnecter les ruches existantes, mais `npm run join` affiche un avertissement.
Émettez un billet dès que possible.

</details>
