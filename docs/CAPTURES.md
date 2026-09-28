# Les captures de Mission Control

Chaque vue de la barre de navigation, la Chambre d'une ouvrière et le tiroir
d'une tâche, sur bureau et sur mobile, photographiés sur une **vraie** ruche —
une Reine et une ouvrière lancées pour l'occasion, remplies par l'API — et
refaits en une commande sur l'arbre courant.

Une capture qu'on ne sait pas refaire ne prouve que le jour où elle a été
prise. Celles-ci se refont, et disent d'où elles viennent.

## Lancer

```
npx playwright install --only-shell chromium     # une fois par machine, ≈ 110 Mo
npm run captures                                 # → captures-ecran/fr/
npm run captures -- --langue en                  # → captures-ecran/en/
npm run captures -- --theme sombre               # → captures-ecran/fr-sombre/
npm run captures -- --vues ruche,tache.mobile    # seulement celles-là
```

`--vues` retient une vue (`ruche` : tous les formats) ou une image
(`ruche.mobile`). Une vue demandée que la ruche ne montre jamais — une faute de
frappe, une vue renommée — est un échec, pas une exécution vide.

`npm ci` n'installe que la bibliothèque Playwright (dépendance de
développement), **jamais le navigateur** : ni `npm test` ni la CI n'en ont
besoin. Sous Linux, s'il manque des bibliothèques système :
`npx playwright install-deps chromium`.

`captures-ecran/` est ignoré par git. La sortie doit rester **dans le dépôt** ;
avant d'écrire, le script efface ses propres captures de l'exécution
précédente — et seulement elles (`<vue>.<format>.png`, `captures.json`). Le
dossier dit donc toujours UNE exécution : celle que décrit son manifeste.

Codes de sortie : `0` tout est photographié · `1` au moins une capture a
échoué (elles sont listées) · `2` Playwright ou son navigateur manque · `64`
ligne de commande fautive · `128 + n` interrompu par un signal (^C : `130`),
ruche arrêtée et dossier jetable effacé.

Une capture **échoue** aussi quand la vue lève une exception dans la page,
tombe (l'écran « Cette vue n'a pas pu s'afficher ») ou emporte la barre avec
elle : l'image est gardée, elle montre la panne, et le code est `1`. Les
erreurs de console ordinaires (une ressource en 409 que la vue explique) restent
des avertissements.

## La ruche de laboratoire

- **Rien de la machine.** Dossier jetable, port choisi par le système et appris
  de la Reine, environnement reconstruit sur liste blanche (`PATH`, dossier
  personnel, dossier temporaire) : ni le `.env` de l'opérateur, ni ses clés,
  ni ses `HIVE_*` n'entrent. Jeton et secret de session tirés au sort — les
  gardes de démarrage de la Reine s'appliquent.
- **Rien n'est laissé à la machine.** L'écran est construit depuis l'arbre
  courant **dans le dossier jetable** — `dashboard/dist` n'est pas touché :
  une ruche qui tourne depuis ce dépôt garde l'écran qu'elle sert, et ses
  onglets ouverts leurs morceaux. Le navigateur des captures reçoit cet écran
  du script, et la Reine de laboratoire répond au reste (API, WebSocket). ^C,
  `kill` ou le terminal qu'on ferme, à n'importe quel moment — démarrage
  compris : la ruche est arrêtée, le dossier effacé.
- **Aucun agent réel.** L'adaptateur `shell` simulé : aucun crédit consommé,
  des diffs factices, et l'écran le dit (« simulé — aucune IA »).
  `HIVE_ISOLEMENT=off` : le bac déclaré est « processus », quelle que soit la
  machine.
- **Des noms de démonstration** : ouvrière `atelier-demo`, propriétaire
  « Démo », compte « Reine Démo » (`reine@exemple.invalid`), premier compte
  donc administrateur — sans lui, Intendance et Cerveau manqueraient.
- **Remplie par l'API**, comme le ferait le tableau : deux projets, sept
  tâches, une dépendance en chaîne, et une tâche qui échoue puis reprend.

## Ce qui est photographié

| Format   | Fenêtre           | Capture      |
| -------- | ----------------- | ------------ |
| `bureau` | 1440 × 900        | l'écran      |
| `mobile` | 390 × 844, dens.2 | page entière |

- **chaque case de la barre de navigation**, cliquée : la barre fait foi (la
  case dit sa vue, `data-vue`), une vue ajoutée demain est photographiée sans
  toucher au script ;
- la **Chambre** de l'ouvrière et le **tiroir** de la tâche reprise ;
- **en vol** : un lot est confié, la Ruche et la Chambre sont photographiées
  pendant que les sous-agents travaillent ;
- `captures.json` : pour chaque image, le **débordement horizontal** mesuré,
  la hauteur de page et les **erreurs de console** survenues pendant la vue —
  plus le commit photographié et l'état de l'arbre.

Animations figées (`prefers-reduced-motion`). Thème clair par défaut ;
`--theme sombre` photographie le thème sombre dans `captures-ecran/<langue>-sombre/`
— par la **préférence du système** (`colorScheme: 'dark'`), sans choix mémorisé :
c'est le chemin que voit un opérateur qui n'a jamais touché au menu du thème. Le
script ne juge pas l'image : il mesure ce qu'un œil rate, et le reste se regarde.

### Ce qui n'est pas photographié

La page de **Partage** (un lien porteur, rendue à la place de l'App), l'écran de
**connexion** et le **premier lancement** (`onboarding.css`), les **modales**
(Inviter, Nouveau projet). Elles demandent un autre état de la ruche — un lien
de partage, une ruche sans compte — que le script ne monte pas encore.

## Première série

Dans `docs/images/captures/`, avec son manifeste (`captures.json` : le commit
photographié, l'arbre propre ou non, et les mesures de chaque image). Elle se
refait, à l'identique de sa sélection, par :

```
npm run captures -- --sortie docs/images/captures --vues ruche.bureau,ruche-en-vol.bureau,chambre-en-vol.bureau,tache.bureau,essaim.bureau,ruche.mobile,miellerie.mobile
```

<p align="center">
  <img src="images/captures/ruche.bureau.png" width="840" alt="Ruche au repos : 7 tâches terminées, l'ouvrière atelier-demo, la file vide.">
</p>
<p align="center">
  <img src="images/captures/ruche-en-vol.bureau.png" width="840" alt="Ruche en vol : deux tâches en cours reliées à l'ouvrière, file d'attente et journal en direct.">
</p>
<p align="center">
  <img src="images/captures/chambre-en-vol.bureau.png" width="840" alt="Chambre de l'ouvrière pendant un vol : deux missions en cours, journal des événements.">
</p>
<p align="center">
  <img src="images/captures/tache.bureau.png" width="840" alt="Tiroir de tâche : une reprise, où est passé le temps, pourquoi ce Worker.">
</p>
<p align="center">
  <img src="images/captures/essaim.bureau.png" width="840" alt="Essaim : la fiche de l'ouvrière, bac déclaré processus seul, Waggle Board, phéromones.">
</p>
<p align="center">
  <img src="images/captures/ruche.mobile.png" width="300" alt="Ruche sur mobile, page entière.">
  <img src="images/captures/miellerie.mobile.png" width="300" alt="Miellerie sur mobile, page entière.">
</p>

### Sandbox Live, sur un vrai processus

`images/captures/sandbox-live.bureau.png` n'est PAS de la série ci-dessus :
l'agent simulé du laboratoire ne lance aucun processus, et ses mesures restent
« inconnu » (c'est exact, et c'est ce que montre `sandbox-en-vol`). Celle-ci
photographie un vrai `node` qui travaille, lancé par une ouvrière en mode
processus, puis MIS EN PAUSE : le CPU de l'arbre gelé tombe à 0 %, la mémoire
reste, le diff a été demandé et « Expliquer » relit l'état consigné. Même
exécution, même pause, au format mobile (`sandbox-live.mobile.png`, page
entière : sous 760 px la liste passe au-dessus du détail) ; les jumelles
sombres — bureau et mobile, en pause elles aussi — vivent dans
`images/theme-sombre/`.

<p align="center">
  <img src="images/captures/sandbox-live.bureau.png" width="840" alt="Sandbox Live : une exécution réelle mise en pause — CPU à 0 % sur l’arbre gelé, commande, diff demandé, explication relue.">
</p>

<p align="center">
  <img src="images/captures/sandbox-live.mobile.png" width="300" alt="Sandbox Live sur mobile, en pause : boutons Reprendre et Arrêter, bandeau « En pause », CPU à 0 %.">
</p>

## Ce que la première exécution a trouvé

- **La Chambre rendait tout le tableau blanc** — corrigé avec ce script.
  `Chambre.tsx` importait une fonction pure depuis un module de la Reine qui
  tire `node:crypto` ; dans le navigateur, ce module est vide, le morceau de
  la vue levait au chargement, et React démontait tout. La règle vit
  désormais dans `src/shared/nom-env.ts`, et
  `tests/paquet-navigateur.test.ts` refuse qu'un module de Node reparte au
  navigateur. **La famille est fermée aussi** : le tableau n'avait aucune
  frontière d'erreur, et n'importe quelle vue qui tombe — un morceau en 404
  après une reconstruction sous un onglet ouvert, une exception au rendu —
  rendait le même écran blanc. `FiletDeSecurite` (ui.tsx, posé sous chaque
  vue par App.tsx) remplace désormais la seule vue tombée par un message qui
  dit pourquoi ; la barre reste (`tests/app-filet.test.tsx`,
  `tests/app-vue-en-panne.test.tsx`).
- **Miellerie, mobile** : les onglets du panneau de revue (Diff · Logs ·
  Consensus · Evaluator) débordent de 11 px.
- **Ruche, le rayon 2D** : la barre « N/M tâches butinées » recouvre la
  dernière rangée d'alvéoles — un défaut de la mise en page du rayon, **pas
  seulement du mobile** : sur bureau, dès qu'une cinquième rangée existe
  (`ruche-en-vol.bureau.png` : pendant un vol, la barre « 7/13 » couvre T13).
  Sur mobile, le rayon est de plus réduit au point que les alvéoles ne se
  lisent plus, et sa dernière rangée vient buter contre la barre dès le repos
  (`ruche.mobile.png`).
- **Cerveau** : les chiffres des quatre tuiles d'en-tête étaient sombres sur
  fond sombre — `.cerveau-tuile` héritait (`color: inherit`) le texte de la
  page claire. Corrigé avec le thème sombre : la tuile prend la couleur de la
  carte nocturne.
- **Rayon et Chantiers** : la console relève des réponses 409 et 501 pour un
  projet sans dépôt et un GitHub non connecté. Ce sont des états attendus, que
  la vue explique elle-même ; le navigateur les compte comme des ressources en
  échec.

## Ce qui reste

- **Les vues non photographiées** (ci-dessus) : Partage, connexion, premier
  lancement, modales.
- **`npm run ruche` ne dit pas son port à l'ouvrière.** Le lanceur ne pose pas
  `HIVE_URL`, et l'ouvrière retombe sur `ws://localhost:7777/ws`
  (`src/node-client/main.ts`) : un `.env` qui dit `HIVE_PORT=7911` sans
  `HIVE_URL` donne une Reine sur 7911 et une ouvrière qui appelle 7777 — une
  autre ruche, ou personne. La ruche de laboratoire le contourne (elle lit
  l'adresse annoncée) ; le lanceur, non.
