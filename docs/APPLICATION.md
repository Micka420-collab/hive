# L'application de bureau Hive

> Hive dans une fenêtre : la Reine, une ouvrière par agent connecté et Mission
> Control, **sans Node à installer ni terminal à ouvrir**. Décision et
> raisons : [ADR 0013](adr/0013-application-de-bureau.md).
>
> _English summary at the end of this page._

---

## Installer

Les paquets sont attachés à chaque [version publiée](https://github.com/Micka420-collab/hive/releases)
(une étiquette `vX.Y.Z`, voir [RELEASING.md](RELEASING.md)).

| Système | Fichier                                    | Où l'app s'installe                                   |
| ------- | ------------------------------------------ | ----------------------------------------------------- |
| Windows | `Hive-Setup-X.Y.Z.exe`                     | `%LOCALAPPDATA%\Programs\Hive` (pour vous seul)       |
| macOS   | `Hive-X.Y.Z-arm64.dmg` / `-x64.dmg`        | `Applications` (glisser l'icône)                      |
| Linux   | `hive_X.Y.Z_amd64.deb` (conseillé)         | `/opt/Hive`, menu Développement                       |
| Linux   | `Hive-X.Y.Z-x86_64.AppImage` (sans droits) | là où vous posez le fichier (`chmod +x`, double-clic) |

Tant que les paquets **ne sont pas signés** (voir [Signature](#signature)),
Windows et macOS préviennent au premier lancement. C'est attendu, et voici
comment passer :

**Windows — SmartScreen.** « Windows a protégé votre ordinateur » :
cliquez **Informations complémentaires**, puis **Exécuter quand même**.
L'installeur est assisté : accueil, licence MIT, dossier (modifiable), options,
installation. Aucun droit administrateur n'est demandé.

**macOS — Gatekeeper.** Au premier lancement, macOS refuse d'ouvrir Hive :
Apple n'a pas pu vérifier l'absence de logiciel malveillant (en anglais :
_“Hive” Not Opened — Apple could not verify “Hive” is free of malware that may
harm your Mac or compromise your privacy._). Fermez la boîte (**Terminé**, pas
**Placer dans la corbeille**), ouvrez **Réglages Système → Confidentialité et
sécurité**, puis **Ouvrir quand même** en bas de la page, et confirmez avec
votre mot de passe. Depuis macOS 15 Sequoia, le clic droit → **Ouvrir** ne
contourne plus cette vérification : seul ce chemin marche.

Si macOS dit que Hive « est endommagé » (une copie téléchargée non signée peut
le déclencher), retirez l'attribut de quarantaine — **seulement pour un DMG
téléchargé depuis les Releases de ce dépôt** : la commande retire la
vérification de Gatekeeper pour cette app.

```sh
xattr -dr com.apple.quarantine /Applications/Hive.app
```

Prenez le DMG `arm64` pour un Mac Apple Silicon (M1 et suivants), `x64` pour
un Mac Intel.

**Linux.** Le `.deb` s'installe par `sudo apt install ./hive_X.Y.Z_amd64.deb`
et garde le bac à sable de Chromium. **Sous Ubuntu 24.04 et suivants, préférez
le `.deb`** : Ubuntu y interdit les espaces de noms aux AppImages, qui tournent
alors avec `--no-sandbox` (outillage par défaut d'electron-builder). L'AppImage
reste le choix sans droits administrateur.

### Les options de l'installeur Windows

- **Lancer Hive à l'ouverture de session** — _décochée_ par défaut, comme le
  service (ADR 0004). Se change ensuite depuis l'icône de la barre des tâches.
- **Créer un raccourci sur le bureau** — cochée. Le raccourci du menu Démarrer
  est toujours créé.

Installation silencieuse : `Hive-Setup-X.Y.Z.exe /S` (options par défaut).
Réinstaller ou désinstaller pendant que Hive tourne lui demande d'abord de
quitter proprement (la ruche et ses agents s'arrêtent), puis seulement arrête
ce qui resterait.

## Premier lancement

L'app prépare **sa** ruche, puis ouvre Mission Control :

1. elle crée le dossier de la ruche (privé : `0700` hors Windows) et son
   `.env` (`0600`) avec un jeton et un secret de session tirés comme par
   l'installeur ;
2. elle détecte vos agents de code — Claude Code, Codex, Cursor… — et dit
   lesquels sont **connectés** ; un agent installé mais non connecté est
   nommé avec la commande qui le connecte. Sans agent connecté, la ruche
   démarre en démonstration simulée, et l'écran le dit ;
3. elle lance la Reine (port **7777** s'il est libre, sinon un port libre,
   gardé ensuite), puis une ouvrière par famille d'agent connectée ;
4. elle ouvre Mission Control, **déjà connecté** : le jeton est posé pour
   vous. L'assistant de première arrivée de l'écran prend la suite quand la
   ruche n'a jamais été configurée.

Quand l'accueil a quelque chose à dire — **aucun agent connecté** (la commande
qui connecte chacun, la démonstration simulée) ou **un port changé** —, il
reste affiché : **Ouvrir Mission Control** quand vous l'avez lu, **Relancer la
détection** une fois un agent connecté. Les commandes se sélectionnent et se
copient.

### Le bac à sable des agents

L'app écrit `HIVE_ISOLEMENT=auto` : chaque ouvrière isole ses agents avec
**Podman ou Docker** (s'ils ont l'image des agents, construite par
`npm run bac:image` — l'app ne la construit pas encore) ou **bubblewrap**
(Linux). Sur un poste Windows ou macOS sans rien de tout ça, les agents
travaillent **sans bac à sable**, avec vos droits d'utilisateur : ils peuvent
lire et écrire ce que vous pouvez lire et écrire. L'ouvrière le dit dans son
journal, et la vue **Essaim** de Mission Control montre, pour chaque ouvrière,
l'isolement qu'elle a obtenu. `HIVE_ISOLEMENT=exige` dans `ruche/.env` refuse
de travailler sans bac à sable — le réglage à choisir si la machine est
prêtée.

L'app lit l'environnement de votre shell de connexion (macOS, Linux) : un
`claude` installé dans `~/.local/bin` ou des clés posées dans `~/.zshrc` sont
vus même quand Hive est ouvert depuis le Dock ou un lanceur.

### Une ruche existe déjà (installation par git)

Si `~/hive` (ou `HIVE_DIR`) porte déjà une ruche, l'app propose, au premier
lancement :

- **Ouvrir cette ruche** — si sa Reine tourne : l'app l'affiche sans rien
  lancer ;
- **Importer une copie** — la base (copie cohérente par `hive sauvegarde`,
  même Reine allumée), la mémoire (`cerveau/`), l'identité des nœuds et les
  clés du `.env` (jeton et secret de session compris : les ouvrières invitées
  et les comptes suivent) ;
- **Commencer une ruche neuve.**

**La ruche d'origine n'est jamais modifiée**, quel que soit le choix.

## Où vivent les données

| Système | Dossier de l'app                     | La ruche               |
| ------- | ------------------------------------ | ---------------------- |
| Windows | `%APPDATA%\Hive`                     | `%APPDATA%\Hive\ruche` |
| macOS   | `~/Library/Application Support/Hive` | `…/Hive/ruche`         |
| Linux   | `~/.config/Hive`                     | `~/.config/Hive/ruche` |

Dans `ruche/` : `.env` (jeton, secret, clés d'API posées depuis la Chambre),
`data/hive.db` et ses voisins, `.hive-work/` (identité des ouvrières). Les
journaux sont dans `logs/` : `bureau.log` (l'app), `reine.log`,
`ouvriere-<agent>.log` — 5 Mo × 3 par fichier. Les rapports de plantage restent
dans `crashDumps/` : **rien n'est envoyé**, Hive n'a aucune télémétrie.

La ruche de l'app se règle par **son** `.env` : une variable `HIVE_*` exportée
dans votre shell n'y entre pas (elle donnerait à la Reine un jeton que l'écran
n'a pas). L'app impose `HIVE_HOST=127.0.0.1` : elle n'expose rien sur le
réseau — invitez des amis par un billet (`hive invite`, `hive tunnel`).

`HIVE_BUREAU_DONNEES=<dossier>` déplace le dossier de l'app (bancs d'essai,
support).

## La barre système

L'icône dit l'état (« Reine en ligne · 2 ouvrières ») et porte : Ouvrir Hive,
Redémarrer la ruche, Lancer à l'ouverture de session, Rechercher une mise à
jour, Journaux, Quitter. **Windows et macOS** : fermer la fenêtre la cache, la
ruche continue (une notification le dit la première fois). **Linux** : fermer
quitte — cochez « Garder en arrière-plan à la fermeture » pour l'autre
comportement (GNOME n'affiche pas d'icône de barre sans extension).

Les **notifications** du système disent ce qui attend un humain : un agent qui
réclame un identifiant, une relecture devenue impossible, une livraison à
reprendre, une fusion refusée, un plafond de dépense atteint, une ouvrière qui
s'arrête. Un clic ouvre la bonne vue.

Les liens `hive://ouvrir/<vue>` (par exemple `hive://ouvrir/sante`) ouvrent
une vue de l'écran. Rien d'autre n'est accepté.

## Mettre à jour

- **Windows et macOS signés** : la nouvelle version se télécharge en
  arrière-plan ; une boîte propose **Redémarrer maintenant** ou **Plus tard**
  (elle s'installe alors quand vous quittez Hive).
- **Windows non signé, AppImage, `.deb`** : une boîte propose **Télécharger et
  installer** — rien ne se télécharge ni ne s'installe sans ce clic. Le `.deb`
  demande votre mot de passe (`pkexec`). Une installation qui n'aboutit pas
  (mot de passe refusé, fichier manquant) le dit et relance la ruche.
- **macOS non signé** : Apple n'autorise pas la mise à jour automatique d'une
  app non signée ; l'app ouvre la page de la version.

**Jamais de redémarrage dans votre dos** : la ruche est arrêtée proprement
avant l'installation. Pendant un téléchargement, l'icône de la barre des
tâches (ou du Dock) montre l'avancement.

L'app cherche une mise à jour une minute après le démarrage, puis toutes les
6 h, et sur « Rechercher une mise à jour ». Avant chaque changement de version,
elle fait une **sauvegarde** de la base (`hive sauvegarde`, 7 gardées dans
`ruche/data/sauvegardes/`). Pas de retour arrière automatique : une base migrée en
avant ne se relit pas sous l'ancien code. Revenir en arrière = installer
l'ancienne version depuis les Releases, puis restaurer cette sauvegarde.

## Désinstaller

Vos données **restent** par défaut, sur les trois systèmes : réinstaller Hive
retrouve votre ruche.

- **Windows** : Paramètres → Applications → Hive → Désinstaller. Une page
  propose, **décochée**, « Supprimer aussi mes données Hive (base, clés,
  journaux) ». Une désinstallation silencieuse (`/S`) et une mise à jour
  gardent toujours tout.
- **macOS** : glisser Hive à la corbeille. Pour tout effacer :
  `~/Library/Application Support/Hive`.
- **Linux** : `sudo apt remove hive` (le dossier personnel n'est pas touché),
  ou supprimer l'AppImage. Pour tout effacer : `~/.config/Hive`, et
  `~/.config/autostart/hive.desktop` si le lancement à l'ouverture de session
  était coché.

## Signature

Les paquets sont construits **non signés** tant qu'aucun certificat n'existe —
et tout marche (SmartScreen et Gatekeeper préviennent, voir plus haut ; macOS
reçoit une signature _ad hoc_, obligatoire sur Apple Silicon). La
configuration (`desktop/electron-builder.config.cjs`) allume chaque signature
**dès que ses secrets existent** dans le dépôt GitHub (Settings → Secrets and
variables → Actions), sans autre changement :

| Plateforme | Secrets (ou variables `vars.*`)                                                                                                                                      | Effet                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| macOS      | `CSC_LINK` (certificat « Developer ID Application » `.p12` en base64), `CSC_KEY_PASSWORD`                                                                            | signe, hardened runtime                                   |
| macOS      | `APPLE_API_KEY` (le **contenu** de la clé `.p8` d'App Store Connect), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`                                                         | notarise ; les mises à jour macOS deviennent automatiques |
| Windows    | `WIN_CSC_LINK` (certificat OV `.pfx` en base64), `WIN_CSC_KEY_PASSWORD`                                                                                              | Authenticode ; SmartScreen se calme avec la réputation    |
| Windows    | ou `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` + variables `AZURE_SIGN_ENDPOINT`, `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_PUBLISHER` | Azure Trusted Signing (`win.azureSignOptions`)            |

Seul le travail `publier` du flux `app-bureau.yml` (sur une étiquette) reçoit
ces secrets ; les paquets de PR ne sont jamais signés. Il passe au banc de
fumée **les paquets qu'il vient de signer** — sous macOS notarisé, avec
l'attribut de quarantaine, `codesign --verify` et `spctl --assess` —, puis
téléverse **ces fichiers-là** dans la Release brouillon. Un certificat `.p12`
ou `.pfx` se passe en base64 : `base64 -w0 certificat.p12`.

**Tant que rien n'est signé, le droit de publier une Release est la seule
racine de confiance des mises à jour.** electron-updater ne vérifie alors que
l'empreinte sha512 de `latest*.yml`, publiée dans la même Release que
l'installeur : qui peut publier (un jeton volé) peut livrer son code. C'est
pourquoi aucune mise à jour non signée ne s'installe sans un clic (voir
[Mettre à jour](#mettre-à-jour)) : protégez l'accès en écriture au dépôt
(double authentification, jetons à portée minimale). Une fois `WIN_CSC_LINK`
(ou Azure) posé, l'installeur Windows téléchargé est vérifié par sa signature
Authenticode (`publisherName`) avant de s'installer, et l'installation
redevient automatique.

## Construire l'app soi-même

```sh
npm ci && npm run build          # la ruche que l'app embarque
npm ci --prefix desktop          # Electron et electron-builder (projet à part)
npm run app:dev                  # l'app, depuis le dépôt
npm run app:dist:linux           # AppImage + .deb dans desktop/release/
npm run app:dist:win             # sous Windows : Hive-Setup-X.Y.Z.exe
npm run app:dist:mac             # sous macOS : DMG arm64 et x64
npm run app:fumee -- desktop/release/Hive-X.Y.Z-x86_64.AppImage   # banc de fumée
```

`desktop/` est un projet npm séparé, avec son propre verrou : le paquet de
Hive ne télécharge jamais Electron. Le banc de fumée installe le paquet,
lance l'app avec `--diagnostic=<rapport.json>` (Reine en ligne,
`/api/health`, écran rendu sous CSP, capture) et relit le rapport. La
marque — icônes, bitmaps de l'installeur, fond du DMG — vit dans
[`desktop/branding/`](../desktop/branding/LISEZMOI.md).

---

## English summary

**Hive desktop app** — the Queen, one worker per signed-in coding agent, and
Mission Control in one window; no Node install, no terminal.

- **Install**: `Hive-Setup-X.Y.Z.exe` (Windows, per-user, no admin),
  `Hive-X.Y.Z-arm64.dmg` / `-x64.dmg` (macOS), `hive_X.Y.Z_amd64.deb`
  (recommended on Ubuntu 24+) or `Hive-X.Y.Z-x86_64.AppImage` (Linux), from
  the [Releases](https://github.com/Micka420-collab/hive/releases).
- **Unsigned builds**: Windows SmartScreen → _More info_ → _Run anyway_;
  macOS Gatekeeper → _System Settings → Privacy & Security → Open Anyway_
  (right-click → Open no longer works on macOS 15+); if macOS says the app
  “is damaged”, `xattr -dr com.apple.quarantine /Applications/Hive.app`.
- **Data**: `%APPDATA%\Hive`, `~/Library/Application Support/Hive`,
  `~/.config/Hive` (the hive itself under `ruche/`); kept on uninstall unless
  you tick the (unticked) box in the Windows uninstaller.
- **Updates**: signed Windows/macOS builds download in the background and
  install only when you click _Restart now_ or quit; unsigned Windows,
  AppImage and `.deb` ask before downloading (`.deb` asks for your password);
  unsigned macOS opens the release page. Until builds are signed, the right
  to publish a GitHub Release is the only trust root for updates. A database
  backup is taken before every version change.
- **Sandbox**: agents are isolated with Podman/Docker (with the agents image)
  or bubblewrap when present; otherwise they run unsandboxed with your user's
  rights — the Essaim view shows what each worker got.
- **Signing**: off until secrets exist — `CSC_LINK`/`CSC_KEY_PASSWORD`,
  `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` (macOS),
  `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` or Azure Trusted Signing (Windows).
