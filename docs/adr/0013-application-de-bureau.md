# ADR 0013 — L'application de bureau : Electron porte la Reine, l'installeur a une vraie figure

- **Statut** : accepté sur le principe (demande du propriétaire : « une vraie
  app pour Hive avec un vrai design d'install — un exe ou ce qui te paraît le
  mieux ») ; **identité visuelle en attente** (« Cadran de ruche » ou
  « Registre » : l'application part avec une marque neutre, interchangeable)
- **Date** : 2026-09-28
- **Concerne** : `desktop/` (nouveau), `src/shared/demarrage.ts`,
  `src/adapters/delegation-bridge.ts`, `src/shared/version-ruche.ts`,
  `package.json` (`better-sqlite3`), `.github/workflows/app-bureau.yml` (nouveau),
  `docs/RELEASING.md`, `docs/INSTALLATION.md`

## Contexte

Hive s'installe aujourd'hui par un terminal : `install.sh` / `install.ps1`
exigent **Node ≥ 24**, clonent le dépôt dans `~/hive`, puis `npm run ruche`
lance la Reine, une ouvrière par agent connecté et l'écran Vite. C'est juste
pour qui a déjà Node et un terminal ouvert ; c'est un mur pour tous les autres,
et c'est ce que la demande vise.

Ce que la Reine suppose, relu dans le code (et qui décide de tout le reste) :

- elle lit le `.env` du **dossier courant** (`chargerEnvQueen`, `process.cwd()`)
  et y **écrit** les clés posées depuis la Chambre (`POST /api/queen/cles`,
  `cheminEnvQueen`) ; sa base est `HIVE_DB`, défaut `./data/hive.db`, et tout
  l'état vit à côté (`cerveau/`, `rayons/`, `sauvegardes/`, `.reine.lock`) ;
- elle sert l'écran depuis `dist/orchestrator/../../dashboard/dist` ;
- elle s'annonce à son lanceur par **`process.send`** (`AnnonceReine`) et
  s'arrête sur `ORDRE_ARRET` reçu par le même canal — c'est le seul arrêt
  propre sous Windows (`scripts/ruche.mjs`, `demarrage.ts`) ;
- l'ouvrière range son identité sous `.hive-work/<nom>/` **relatif au dossier
  courant** ; l'agent qu'elle lance démarre le pont de délégation MCP avec
  **`process.execPath --eval …`** (`delegation-bridge.ts`) ;
- `better-sqlite3` est natif ; la version verrouillée (12.11.1) ne publie de
  binaire Electron que jusqu'à l'ABI 146 (Electron 42).

## Options pesées — le socle

**A. Un `.exe` qui emballe l'installeur actuel** (Inno/NSIS qui installe Node
puis clone). Rien ne change pour l'utilisateur après l'installation : toujours
un terminal, toujours `npm`. Écarté : ce n'est pas une application.

**B. Tauri.** Binaire léger, mais la Reine est du Node : il faudrait livrer un
Node à part (sidecar par plateforme), une couche Rust pour le superviser, et
un WebView système différent par OS (WebKitGTK sous Linux, qui n'est pas
Chromium : l'écran n'y est éprouvé nulle part). Deux runtimes et trois moteurs
de rendu pour gagner ~80 Mo. Écarté.

**C. Electron + electron-builder.** Electron **contient Node** : le même
binaire lance la fenêtre et, avec `ELECTRON_RUN_AS_NODE=1`, la Reine et les
ouvrières. Un seul moteur de rendu (Chromium) sur les trois systèmes.
electron-builder produit NSIS, DMG, AppImage et `.deb` depuis une config, et
electron-updater se branche sur les Releases GitHub. Prix : ~100 Mo par
plateforme.

## Décision

**C.** Les points ci-dessous sont tranchés ; chacun dit ce qu'il écarte.

### 1. Versions

- **Electron 44.4.x** (stable courante, Node **24.21.0** embarqué, ABI 149 ;
  44.0.0 du 2026-08-24, donc supportée jusqu'à la sortie de la 47). Node 24
  est le plancher de Hive (`NODE_MINIMUM`) : 42 et moins (Node 22) sont exclus.
- **`better-sqlite3` ^13.0.3 pour tout le dépôt** (préalable, PR séparée).
  La 13 passe à N-API et livre ses binaires **dans le paquet npm**
  (`prebuilds/<os>-<arch>.node`, aucun script d'installation) : le même
  fichier sert Node 24, la CI, l'image Docker et Electron. Mesuré ici :
  `ELECTRON_RUN_AS_NODE=1 electron@44.4.5` charge `better-sqlite3@13.0.3`
  (N-API 10, SQLite 3.53.4), et un `utilityProcess` aussi.
  _Écarté_ : garder la 12 et recompiler pour Electron (`@electron/rebuild`) —
  deux binaires du même moteur, un pour le dépôt et un pour l'app, c'est une
  panne « marche en dev, casse dans l'app » qui attend son heure.
  _Plan B_ si la 13 régresse sur la suite complète : Electron **43.7.x** +
  `better-sqlite3` **12.12.0**, dont la release porte `electron-v148`.

### 2. Qui fait tourner la Reine et les ouvrières

Des **processus enfants** du processus principal, lancés comme `ruche.mjs` les
lance : `spawn(process.execPath, [entrée compilée], { env: { …,
ELECTRON_RUN_AS_NODE: '1' }, stdio: [..., 'ipc'] })`. Le protocole existant
(`AnnonceReine`, `ORDRE_ARRET`, `suiteDUneMort`) s'applique tel quel — **aucun
changement** dans `orchestrator/main.ts` ni `node-client/main.ts`.

- _Écarté : la Reine dans le processus principal._ Une requête SQLite longue
  gèlerait les menus ; une exception de la Reine tuerait la fenêtre ; et le
  verrou « une seule Reine » (ADR 0012) serait tenu par l'interface.
- _Écarté : `utilityProcess`._ Il parle par `process.parentPort`, pas
  `process.send` : il faudrait réécrire l'annonce et l'arrêt dans le cœur. Et
  il ne règle pas le point suivant.
- **Conséquence imposée : le fusible `runAsNode` reste ACTIVÉ.** L'agent lancé
  par une ouvrière démarre le pont MCP avec `process.execPath`, qui est ici le
  binaire de l'app. Sans ce fusible, ce binaire ouvrirait… une seconde
  fenêtre. Le pont reçoit donc `ELECTRON_RUN_AS_NODE=1` **dans sa config MCP**
  (`env` de `mcpServers` pour Claude, `mcp_servers.<nom>.env.ELECTRON_RUN_AS_NODE`
  en clé pointée pour Codex — relu tel quel par `codex mcp list --json`
  0.156) quand `process.versions.electron` existe. Un amorçage propre à
  l'app (`desktop/app/piece.cjs`) retire la variable de `process.env` avant
  d'importer l'entrée : ni l'agent ni ses sous-processus n'en héritent.
- _Le prix de ce fusible, au-delà de l'intégrité de l'asar :_ `runAsNode`
  allumé, `ELECTRON_RUN_AS_NODE=1 /Applications/Hive.app/Contents/MacOS/Hive
x.js` exécute n'importe quel script **sous l'identité de Hive**. Signée et
  notarisée, l'app prête alors sa signature — et les autorisations TCC que la
  personne lui a données (accès complet au disque, Documents, caméra…) — à du
  code qui n'est pas le sien : un chemin d'abus connu des apps Electron. Et le
  code hors asar (`resources/hive/`) n'est couvert par le fusible d'intégrité
  que tant que le sceau de la signature macOS est vérifié. D'où, le jour où la
  signature s'allume (§ 14) : des droits du hardened runtime **minimaux** (ni
  `allow-jit` au-delà de ce qu'Electron exige, ni `disable-library-validation`),
  et la consigne, dans la doc, de n'accorder à Hive **aucune** autorisation
  TCC large — il n'en demande aucune : la ruche vit dans son propre dossier.
- _Ajouté à l'implémentation, mesuré :_ une app tuée net (SIGKILL, plantage
  de GTK) laissait la Reine et les ouvrières orphelines — port et verrou de
  la base tenus —, et une ouvrière orpheline tournait à 100 % d'un cœur : ses
  écritures vers le tuyau mort levaient EPIPE, que son gestionnaire
  d'exceptions réécrivait sur le même tuyau. `piece.cjs` transforme donc la
  fermeture du canal (`disconnect`) en ordre d'arrêt de la ruche
  (`ORDRE_ARRET`, le chemin propre qu'elles connaissent) et fait taire les
  erreurs de ses propres flux de sortie. Toutes les pièces sortent en moins
  de 5 s après la mort de l'app.
- La composition reste celle de `demarrage.ts` : `pieces()` gagne un mode
  « compilé » (`dist/…/main.js` au lieu de `scripts/lancer.mjs src/…ts`),
  `planOuvrieres()` décide une ouvrière par famille d'agent **connectée**
  (#492, `inventaireAgents`), l'écran Vite n'est jamais lancé (la Reine sert
  `dashboard/dist`). La partie impure de `ruche.mjs` (spawn, préfixage,
  arrêt en arbre) est extraite dans un module compilé que `ruche.mjs` et l'app
  appellent tous deux : **un seul superviseur**.
- La Reine meurt : relance avec recul (1 s, 5 s, 30 s), au plus 3 fois en
  5 min, puis écran d'erreur avec les dernières lignes de son journal et le
  bouton « Ouvrir les journaux ». Une ouvrière meurt : notification avec sa
  dernière phrase (`suiteDUneMort`), la ruche continue.

### 3. Ce que l'app embarque, et où

- `app.asar` : le code de la coquille seulement (processus principal,
  préchargement, écran d'accueil, marque).
- _Amendé à l'implémentation :_ l'accueil est servi par un protocole propre
  (`bureau://app/…`, `protocol.handle`), pas par `file://` — le fusible
  `grantFileProtocolExtraPrivileges` éteint (§ 13) refuse à `file://` la
  lecture de l'asar (mesuré : `ERR_FILE_NOT_FOUND` dans l'AppImage), et c'est
  la pratique que recommande Electron. Le protocole ne sert que `accueil/` et
  `marque/`, sans remontée ni encodage hostile (`fichierDeCoquille`, éprouvé).
- `resources/hive/` (**hors asar**, `extraResources`) : `dist/` compilé sans
  `__tests__`, `dashboard/dist`, `package.json`, `LICENSE`, et un
  `node_modules` de production (`ws`, `fastify`, `@fastify/*`,
  `better-sqlite3` réduit au binaire de la cible), installé `--omit=dev --ignore-scripts` depuis le `package-lock.json` du dépôt. Préparé dans
  `desktop/build/hive/` et copié depuis `build/` : electron-builder écarte
  sans exception le `node_modules` situé à la RACINE d'une source
  `extraResources` (mesuré : « @fastify/cors est absent » au démarrage de la
  Reine).
  _Écarté : tout dans l'asar._ Des enfants en mode Node qui importent de
  l'ESM, servent des fichiers en flux (`@fastify/static`), chargent un `.node`
  et donnent des chemins à `git` : chaque point est une exception asar à
  tenir. L'intégrité est assurée par la signature du paquet (macOS scelle tout
  le `.app`) ; le fusible d'intégrité asar ne couvre que la coquille.

### 4. Où vivent les données

- `app.getPath('userData')` (`%APPDATA%\Hive`, `~/Library/Application Support/Hive`, `~/.config/Hive`) contient Chromium ; **la ruche vit dans
  `<userData>/ruche/`** : `.env`, `data/hive.db` et ses voisins,
  `.hive-work/`. Les enfants ont `cwd = ruche/` et `HIVE_DB` absolu. Le
  dossier est créé en `0700` hors Windows.
- `HIVE_BUREAU_DONNEES` déplace `userData` (bancs, support) — rien d'autre.
- **Reprise d'une installation par git.** Au premier lancement, l'app cherche
  `~/hive` (et `HIVE_DIR`) : un `.env` et une base. Elle propose alors, sans
  rien toucher à la source :
  1. **Ouvrir cette ruche** si sa Reine répond (`/api/health` sur son port,
     jeton lu dans son `.env`) : l'app ne lance rien, elle affiche cette
     ruche-là. Deux Reines sur une base sont déjà interdites (ADR 0012) ;
  2. **Importer une copie** : la base par `hive sauvegarde <source> --vers=<ruche>/data --json` (`VACUUM INTO`, cohérent même à chaud —
     jamais `cp`), `cerveau/`, les `node-id.txt`, `join/` et `livraisons/`
     de `.hive-work/`, et le `.env` **moins** ce que l'app possède
     (`HIVE_DB`, `HIVE_HOST`, `HIVE_PORT`, `HIVE_HTTP`, `HIVE_WORKDIR`,
     `HIVE_ENV_FILE`). Jeton et secret de session sont gardés : les ouvrières
     invitées et les comptes suivent ;
  3. **Commencer une ruche neuve.**
- _Écarté : faire tourner l'app directement sur `~/hive`._ Une app plus
  récente migrerait la base sous le code plus ancien du clone.
- La première arrivée **produit** (agents, comptes, premier projet) reste
  celle de l'écran (#525) : l'accueil de l'app ne traite que ce qui est propre
  à la machine — dossier, reprise, port — puis passe la main à `#/`.

### 5. Port, instance unique, CLI déjà lancée

- `app.requestSingleInstanceLock()` : un second lancement ramène la fenêtre
  (et lui passe son lien `hive://`).
- Premier lancement : **7777 s'il est libre**, sinon un port libre tiré par
  le système. Le port est **écrit dans le `.env` de la ruche** et gardé :
  l'origine de l'écran (`http://127.0.0.1:<port>`) porte son `localStorage`
  (jeton, thème), qu'un port changeant ferait perdre à chaque lancement.
- Port gardé mais occupé au lancement : l'app prend un port libre, le
  réécrit, et le dit une fois (l'accueil). Si l'occupant est une Reine sur
  NOTRE base, c'est la Reine lancée ensuite qui le dit — elle refuse de
  démarrer (verrou de l'ADR 0012) avec le pid qu'elle lit dans le verrou, et
  l'écran d'erreur cite cette ligne. _Amendé à l'implémentation :_ lire le
  verrou depuis la coquille aurait ouvert SQLite dans le processus principal
  pour DEVINER ce que la Reine constate elle-même ; le fait se lit là où il
  naît. Et une app tuée net n'en laisse plus : chaque pièce s'arrête quand son
  canal IPC se ferme (`desktop/app/piece.cjs`, § 2).
- `HIVE_HOST=127.0.0.1` imposé : l'app n'expose rien sur le réseau. Les
  ouvrières d'amis passent par le tunnel existant (`cloudflare.ts`) et les
  billets.

### 6. Secrets

**Fichier `.env` en `0600`** dans `ruche/`, écrit par `ecrireAtomique`
(`MODE_SECRET`) avec `composerReglages` — les mêmes jeton (32) et secret de
session (64) que l'installeur, `HIVE_SIMULATION=1` seulement si aucun agent
réel n'est détecté.
_Écarté : `safeStorage`/trousseau._ La Reine **lit** ce fichier par
`process.loadEnvFile` et y **écrit** les clés d'API ; un trousseau imposerait
de déchiffrer vers un fichier ou de réécrire le cœur. Sous Linux sans service
de secrets, `safeStorage` retombe sur `basic_text`, une clé connue : du
maquillage. Le modèle de menace reste celui de l'installation par git
(ADR 0007) : le jeton est une clé maîtresse rangée dans le profil de
l'utilisateur, lisible par lui seul. Le jeton atteint l'écran par le
préchargement, qui l'écrit dans `localStorage['hive.token']` **seulement**
si la page est l'origine de la Reine.

### 7. Agents lancés depuis une icône

Une app ouverte depuis le Finder ou un lanceur n'a pas le `PATH` du shell
(`/usr/bin:/bin:/usr/sbin:/sbin` sous macOS) ni ses variables (clés d'API
posées dans `.zshrc`) : `claude` introuvable, la ruche retomberait en diffs
simulés — le symptôme déjà vu (« il détecte mal Claude Code »). Sous macOS et
Linux, l'app lit **une fois au démarrage** l'environnement du shell de
connexion (`shell-env`, `$SHELL -ilc`, délai borné) et le pose **sous**
l'environnement du processus pour les enfants ; `cheminsNatifs` continue de
sonder `~/.local/bin` et `~/.claude/local`. Échec ou délai dépassé :
l'environnement du lanceur, et une ligne dans l'état de l'app. Windows lit le
`PATH` du registre de l'utilisateur : rien à faire.

### 8. Bac à sable

Inchangé : `HIVE_ISOLEMENT=auto` (podman, docker, bubblewrap s'il y en a un ;
sinon travail « processus », dit). L'image des agents se construit par
`npm run bac:image`, qui n'existe pas dans l'app : tant qu'elle n'est pas
proposée par l'app (suite nommée plus bas), Docker/Podman sans image
retombent sur bubblewrap ou « processus », et l'écran le montre déjà.

### 9. Fenêtre, barre système, démarrage, liens

- **Barre système** : état (« Reine en ligne · 2 ouvrières »), Ouvrir Hive,
  Redémarrer la ruche, Lancer à l'ouverture de session, Rechercher une mise à
  jour, Journaux, Quitter. Fermer la fenêtre la cache (Windows, macOS ; une
  notification le dit la première fois) ; **sous Linux, fermer quitte** tant
  que l'option « garder en arrière-plan » n'est pas cochée — GNOME n'affiche
  pas d'icône de barre sans extension, et une ruche invisible sans moyen de
  l'arrêter serait le pire des cas.
- **Démarrage avec la session : désactivé par défaut**, comme le service
  (ADR 0004) ; case dans la barre système et dans l'accueil.
  `setLoginItemSettings` (Windows, macOS), `~/.config/autostart/hive.desktop`
  (Linux, chemin `$APPIMAGE` pour l'AppImage).
- **Notifications** (natives, `Notification` du processus principal) : le
  processus principal s'abonne au WebSocket de la Reine comme un écran et
  notifie `requisition_ouverte` (un agent attend un identifiant),
  `contre_expertise_impossible` (relecture humaine requise),
  `delivery_recovery_required`, `merge_failed`, `balance_cap_reached`, et la
  mort d'une ouvrière. La correspondance vit dans un module pur éprouvé. Le
  verdict `human_review_required` de l'Évaluateur n'est aujourd'hui **pas
  journalisé** comme événement : suite nommée (le consigner à la Reine), pas
  une déduction côté app.
- **Liens `hive://`** : `hive://ouvrir/<route>` ouvre `#/<route>` (routes de
  l'écran seulement). Rien d'autre n'est accepté.

### 10. Mises à jour

- electron-updater, fournisseur **GitHub Releases**, canal `latest` seul
  (RELEASING.md n'a pas de préversions), vérification au démarrage puis
  toutes les 6 h.
- **Windows (NSIS) et AppImage** : téléchargement en arrière-plan,
  installation à la sortie ou sur « Redémarrer pour mettre à jour ».
- **`.deb`** : notification, puis installation sur geste explicite (`pkexec`
  demande le mot de passe) — jamais en silence.
- **macOS non signé** : Squirrel.Mac exige une signature ; l'app **notifie et
  ouvre la page de la version**. Automatique dès que la signature existe.
- **Pas de retour arrière automatique** (`allowDowngrade: false`) : une base
  migrée en avant ne se relit pas sous l'ancien code. À chaque changement de
  version, avant de lancer la Reine, l'app fait **`hive sauvegarde`** (même
  élagage, 7 gardées). Revenir en arrière = installer l'ancienne version
  depuis les Releases + restaurer cette sauvegarde ; une mauvaise version se
  corrige par une version suivante.
- `HIVE_POSE=bureau` est passé aux enfants : `/api/version` dit
  « application de bureau, mise à jour automatique » au lieu de la marche
  `git pull` (`Pose` gagne `'bureau'`).

### 11. Désinstallation

Les données **restent** par défaut, sur les trois systèmes (ADR 0004).
L'installeur NSIS propose une case **décochée** « Supprimer aussi mes données
Hive (base, clés, journaux) » (page posée par `customUnWelcomePage` de
`desktop/build/installer.nsh`, juste APRÈS l'accueil du désinstalleur :
`customUninstallPage` est insérée par electron-builder après la
désinstallation, quand il est trop tard pour demander), ignorée pendant une mise à jour
(`${isUpdated}` : l'ancien désinstalleur tourne à chaque mise à jour) et en
désinstallation silencieuse (`/S` garde tout ; `--delete-app-data` reste le
geste explicite d'electron-builder). macOS : glisser l'app à la
corbeille, les données restent (chemin dans la doc). `.deb` : `apt remove`
ne touche pas au dossier personnel. AppImage : supprimer le fichier.

### 12. Journaux et pannes

`app.getPath('logs')` : `bureau.log` (coquille), `reine.log`,
`ouvriere-<agent>.log` ; 5 Mo × 3 par fichier (electron-log). `crashReporter`
**sans envoi** (`uploadToServer: false`) : les minidumps restent dans
`crashDumps`. Hive n'émet aucune télémétrie ; l'app non plus.
`render-process-gone` recharge la page ; une exception du processus principal
est journalisée puis dite dans une boîte de dialogue.

### 13. Sécurité de la coquille

- Fenêtre : `contextIsolation`, `sandbox`, `nodeIntegration: false`,
  `webSecurity`, pas de `webviewTag`.
- Navigation **verrouillée à l'origine de la Reine** (et à la page d'accueil
  locale) : `will-navigate`/`will-redirect` refusés ailleurs ;
  `setWindowOpenHandler` refuse tout, les `https:` partent au navigateur par
  `shell.openExternal`.
- **CSP** posée par la coquille sur les réponses de la Reine
  (`onHeadersReceived`) : `default-src 'self'`, `connect-src 'self' ws://127.0.0.1:<port>`, `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'` (CodeMirror injecte ses styles), `worker-src 'self' blob:`,
  `object-src 'none'`, `frame-ancestors 'none'`. Toute violation relevée au
  banc de fumée le fait échouer. La porter ensuite par la Reine elle-même
  (utile aux navigateurs aussi) est une suite nommée.
- Permissions : tout refusé sauf `clipboard-sanitized-write`.
- IPC minimal, chaque gestionnaire vérifie `senderFrame.url` : sur l'écran,
  le préchargement n'expose que `window.hiveBureau = { version, pose: 'bureau' }` ; sur l'accueil, les trois choix du §4, « réessayer », « ouvrir
  les journaux » et la case de session. _Amendé :_ UN préchargement
  (`desktop/app/preload.cjs`) qui se règle sur la page où il tombe — une
  fenêtre n'a qu'un préchargement, et elle montre tour à tour l'accueil et
  l'écran ; la frontière reste la vérification d'origine du processus
  principal.
- Fusibles : `runAsNode` **on** (§2), `enableCookieEncryption` on,
  `enableNodeOptionsEnvironmentVariable` off, `enableNodeCliInspectArguments`
  off, `onlyLoadAppFromAsar` on, `enableEmbeddedAsarIntegrityValidation` on,
  `grantFileProtocolExtraPrivileges` off.
- AppImage : electron-builder (outillage par défaut) lance avec
  `--no-sandbox` (Ubuntu 24+ interdit les espaces de noms aux AppImages) ; le
  `.deb` garde le bac à sable de Chromium (profil AppArmor posé à
  l'installation). La doc conseille le `.deb` sur Ubuntu.

### 14. Signature : prête, éteinte

Sans certificat, rien n'est signé et tout marche : macOS en signature
_ad hoc_ (`identity: "-"`, obligatoire sur Apple Silicon ; hardened runtime
éteint), Windows sans Authenticode (SmartScreen avertit ; la doc montre
« Informations complémentaires → Exécuter quand même »), Linux n'en demande
pas. La config (`electron-builder.config.cjs`) allume chaque signature **dès
que ses secrets existent**, sans autre changement :

| Plateforme | Secrets GitHub Actions                                                                                                                                               | Effet                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| macOS      | `CSC_LINK` (.p12 « Developer ID Application » en base64), `CSC_KEY_PASSWORD`                                                                                         | signe, hardened runtime                  |
| macOS      | `APPLE_API_KEY` (.p8, écrit en fichier par le job), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`                                                                           | notarise ; mises à jour automatiques     |
| Windows    | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (certificat OV .pfx)                                                                                                          | Authenticode                             |
| Windows    | ou `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` + variables `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` | Trusted Signing (`win.azureSignOptions`) |

Tant que rien n'est signé, **le droit de publier une Release est la seule
racine de confiance des mises à jour** : electron-updater ne vérifie qu'un
sha512 lu dans la même Release que l'installeur (sans `publisherName`, pas de
contrôle Authenticode). Aucune mise à jour non signée ne s'installe donc sans
un clic (`hiveSigne`, `extraMetadata`, relu par `mises-a-jour.ts`) ; le
téléchargement en arrière-plan et l'installation à la sortie ne s'allument
qu'avec la signature. Le job `publier` passe au banc de fumée les paquets
qu'il vient de signer, et téléverse ceux-là.

### 15. L'installeur a une figure — et elle se change en un dossier

- Windows : NSIS **assisté** (pas « un clic »), par utilisateur, sans droits
  administrateur (`%LOCALAPPDATA%\Programs\Hive`), dossier modifiable, pages
  en français (et anglais), barre latérale et en-tête à l'image de la marque,
  licence MIT affichée, raccourcis bureau et menu Démarrer, « Lancer Hive » à
  la fin.
- macOS : DMG avec fond dessiné (flèche vers Applications), 1× et 2×.
- Linux : AppImage et `.deb` (catégorie Development, entrée de bureau,
  association `hive://`).
- **Tout ce qui se voit vit dans `desktop/branding/<thème>/`** : `marque.json`
  (nom affiché, couleurs, polices), les sources (`icone.svg`,
  `barre-systeme.svg`, gabarits HTML de la barre NSIS, de l'en-tête et du fond
  DMG) et les sorties générées (`icon.png` 1024, `tray*.png`,
  `installerSidebar.bmp` 164×314, `installerHeader.bmp` 150×57,
  `background.png` + `@2x`). Le générateur (`desktop/branding/generer.mjs`)
  rend les gabarits dans Electron lui-même (aucune dépendance d'image) ; les
  sorties sont versionnées, donc la CI n'a pas besoin d'écran pour les
  produire. `desktop/branding/actif` nomme le thème ; `HIVE_BRANDING=<thème>`
  le remplace pour un build.
- Thème par défaut **`neutre`** : les jetons sombres de #515 (`--bg #0c0d10`,
  `--panel #15171d`, `--border #262a33`, `--text #eeebe5`, `--muted #a9abb2`,
  miel `#f6c445` → `#e08a14` en remplissage seulement), fontes OFL déjà dans
  `site/fonts`. Choisir « Cadran » ou « Registre » = copier `neutre/`,
  changer `marque.json` et les SVG, `npm --prefix desktop run marque`,
  changer `actif`. Les couleurs de l'**écran** restent celles du dashboard
  (#515) : la marque de l'app habille la coquille, pas les vues.

## Conséquences

- Hive se publie désormais aussi en **binaires** : RELEASING.md §2 (« rien
  d'autre n'est publié ») change. Une étiquette `vX.Y.Z` déclenche
  `app-bureau.yml`, qui construit sur les trois systèmes et dépose les fichiers
  dans une Release **brouillon** ; la publier (geste humain) est ce qui
  déclenche les mises à jour chez les utilisateurs.
- L'app est Community (`HIVE_EDITION` par défaut) ; rien du modèle
  économique ne change.
- ~100 Mo par plateforme ; la mémoire d'Electron s'ajoute à celle de la Reine.
- La preuve se fait sur de vrais paquets : AppImage et `.deb` construits et
  lancés sous `xvfb-run` en local ; en CI, sur `ubuntu-latest`,
  `windows-latest` et `macos-latest`, l'artefact installé est lancé avec
  `--diagnostic=<fichier>` (Reine démarrée, `/api/health`, écran chargé,
  capture), et sous Windows la désinstallation silencieuse doit laisser les
  données en place.

### Suites nommées (hors de ce lot)

1. Journaliser le verdict de l'Évaluateur (`evaluation_rendue`) à la Reine,
   pour que la décision humaine en attente se notifie depuis un fait.
2. Construire l'image du bac depuis l'app (Dockerfile embarqué, bouton).
3. CSP servie par la Reine elle-même.
4. `hive` en ligne de commande depuis l'app (lien dans le `PATH`).
5. Linux arm64, macOS universel, Windows arm64.
6. `hive desinstaller` : connaître l'empreinte de l'app de bureau.
7. `node-client/main.ts` : son gestionnaire d'exceptions réécrit sur un
   tuyau mort (EPIPE) et boucle — la même panne attend `npm run ruche` si son
   lanceur est tué net. L'app s'en garde dans `piece.cjs` ; la réparer au
   nœud reste à faire.
