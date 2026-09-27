# Les captures de Mission Control

Chaque vue du tableau de bord, sur bureau et sur mobile, photographiée sur
une **vraie** ruche — une Reine et une ouvrière lancées pour l'occasion,
remplies par l'API — et refaites en une commande sur l'arbre courant.

Une capture qu'on ne sait pas refaire ne prouve que le jour où elle a été
prise. Celles-ci se refont, et disent d'où elles viennent.

## Lancer

```
npx playwright install --only-shell chromium     # une fois par machine, ≈ 110 Mo
npm run captures                                 # → captures-ecran/fr/
npm run captures -- --langue en                  # → captures-ecran/en/
npm run captures -- --sortie docs/images/captures
```

`npm ci` n'installe que la bibliothèque Playwright (dépendance de
développement), **jamais le navigateur** : ni `npm test` ni la CI n'en ont
besoin. Sous Linux, s'il manque des bibliothèques système :
`npx playwright install-deps chromium`.

`captures-ecran/` est ignoré par git. La sortie doit rester **dans le dépôt** ;
avant d'écrire, le script efface ses propres captures de l'exécution
précédente — et seulement elles (`<vue>.<format>.png`, `captures.json`).

Codes de sortie : `0` tout est photographié · `1` au moins une capture a
échoué (elles sont listées) · `2` Playwright ou son navigateur manque · `64`
ligne de commande fautive.

## La ruche de laboratoire

- **Rien de la machine.** Dossier jetable, port choisi par le système et appris
  de la Reine, environnement reconstruit sur liste blanche (`PATH`, dossier
  personnel, dossier temporaire) : ni le `.env` de l'opérateur, ni ses clés,
  ni ses `HIVE_*` n'entrent. Jeton et secret de session tirés au sort — les
  gardes de démarrage de la Reine s'appliquent.
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

- **chaque case de la barre de navigation**, cliquée : la barre fait foi, une
  vue ajoutée demain est photographiée sans toucher au script ;
- la **Chambre** de l'ouvrière et le **tiroir** de la tâche reprise ;
- **en vol** : un lot est confié, la Ruche et la Chambre sont photographiées
  pendant que les sous-agents travaillent ;
- `captures.json` : pour chaque image, le **débordement horizontal** mesuré,
  la hauteur de page et les **erreurs de console** survenues pendant la vue —
  plus le commit photographié et l'état de l'arbre.

Animations figées (`prefers-reduced-motion`), thème clair. Le script ne juge
pas l'image : il mesure ce qu'un œil rate, et le reste se regarde.

## Première série

Dans `docs/images/captures/` — prise le jour où ce script est arrivé, sur l'arbre
de sa branche (base `7b80ccc`).

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

## Ce que la première exécution a trouvé

- **La Chambre rendait tout le tableau blanc** — corrigé avec ce script.
  `Chambre.tsx` importait une fonction pure depuis un module de la Reine qui
  tire `node:crypto` ; dans le navigateur, ce module est vide, le morceau de
  la vue levait au chargement, et React démontait tout. La règle vit
  désormais dans `src/shared/nom-env.ts`, et
  `tests/paquet-navigateur.test.ts` refuse qu'un module de Node reparte au
  navigateur.
- **Miellerie, mobile** : les onglets du panneau de revue (Diff · Logs ·
  Consensus · Evaluator) débordent de 11 px.
- **Ruche, mobile** : le rayon 2D est réduit au point que les alvéoles ne se
  lisent plus, et la barre « 7/7 tâches butinées » recouvre leur dernière
  rangée.
- **Cerveau** : les chiffres des quatre tuiles d'en-tête sont sombres sur fond
  sombre — `.cerveau-tuile` hérite (`color: inherit`) le texte de la page
  claire.
- **Rayon et Chantiers** : la console relève des réponses 409 et 501 pour un
  projet sans dépôt et un GitHub non connecté. Ce sont des états attendus, que
  la vue explique elle-même ; le navigateur les compte comme des ressources en
  échec.
