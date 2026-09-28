# La marque de l'application de bureau

Tout ce que l'app et ses installeurs **montrent** vient de ce dossier : l'icône
(Windows, macOS, Linux, toutes tailles), l'icône de la barre système, les
bitmaps de l'installeur Windows (barre latérale, en-tête), le fond du DMG
macOS, et les couleurs et polices de l'écran d'accueil de l'app. Les couleurs
de **Mission Control** restent celles du tableau de bord (#515) : la marque
habille la coquille, pas les vues.

```
branding/
  actif                  le thème utilisé (une ligne : « neutre »)
  generer.mjs            le générateur (tourne dans Electron)
  gabarits/              gabarits HTML communs : barre latérale NSIS (164×314),
                         en-tête NSIS (150×57), fond du DMG (540×380, et @2x)
  neutre/
    marque.json          nom, accroche, couleurs, polices
    icone.svg            l'icône (tuile 1024, marges d'Apple : 824 px utiles)
    barre-systeme.svg    l'icône de la barre ({{trait}}, {{coeur}})
    gabarits/            (facultatif) remplace un gabarit commun pour CE thème
    sorties/             GÉNÉRÉ et versionné — ne pas éditer à la main
```

Les sorties sont versionnées : la CI n'a pas besoin d'écran pour construire
les paquets, et un changement de marque se relit dans un diff.

## Le thème par défaut : « neutre »

Les jetons sombres de #515 (`dashboard/src/styles.css`) : fond `#0c0d10`,
panneau `#15171d`, bordure `#262a33`, texte `#eeebe5`, atténué `#a9abb2`, et
le miel `#f6c445` → `#e08a14` **en remplissage seulement** (jamais en texte
sur fond clair). Polices OFL déjà dans `site/fonts` : Bricolage Grotesque
(titres), Instrument Sans (texte), JetBrains Mono (code). L'icône est une
alvéole ouverte sur un cœur de miel — ni l'aiguille de « Cadran de ruche » ni
le sceau de « Registre » : elle ne préjuge pas du choix.

## Changer de marque

1. **Copier** le thème neutre :

   ```sh
   cp -r desktop/branding/neutre desktop/branding/cadran
   rm -r desktop/branding/cadran/sorties
   ```

2. **Changer `marque.json`** — les couleurs et les polices de l'identité
   choisie. Les deux prototypes donnent les valeurs :

   | Jeton       | « Cadran de ruche » (`final/identite-hive.md`) | « Registre » (`dir-D/brand-guide.md`) |
   | ----------- | ---------------------------------------------- | ------------------------------------- |
   | `fond`      | `#07090C` (`--surface-0`)                      | `#0E0F12` (`--encre`)                 |
   | `panneau`   | `#11151B` (`--surface-2`)                      | `#17191E` (`--carte`)                 |
   | `bordure`   | `#1E2430` (`--surface-4`)                      | `#1C1F25` (`--carte-2`)               |
   | `texte`     | `#ECEFF3` (`--text-1`)                         | `#ECEAE4` (`--papier`)                |
   | `attenue`   | `#B3BAC5` (`--text-2`)                         | `#A8A49C` (`--papier-2`)              |
   | `miel`      | `#F2B544` (`--accent`)                         | `#E9B94D` (`--cire`)                  |
   | `mielFonce` | `#E9A92E`                                      | `#E9B94D` (la cire est plate)         |
   | `surMiel`   | `#1A1204` (`--on-accent`)                      | `#0E0F12` (`--sur-cire`)              |
   | `succes`    | `#7FCBA6` (`--status-ok`)                      | `#4FD1B5` (`--vert-de-gris`)          |
   | `alerte`    | `#F28B7D` (`--status-fail`)                    | `#F27E76` (`--corail`)                |

   Une police qui n'est pas dans `site/fonts` se dépose dans le thème et se
   nomme par son chemin relatif (`"fichier": "polices/ma-police.woff2"`) — une
   police OFL ou équivalente, jamais une police sous licence d'usage restreint.

3. **Remplacer les deux SVG** : `icone.svg` (le logo de l'identité posé sur une
   tuile 1024 — « L'Aiguille ouverte » pour Cadran, le sceau hexagonal pour
   Registre, tous deux donnés en SVG dans leur guide) et `barre-systeme.svg`
   (le même signe, monochrome : `{{trait}}` et `{{coeur}}` y sont remplacés
   par la couleur du texte et du miel, ou par du noir pour le modèle macOS).
   Les jetons `{{fond}}`, `{{miel}}`… de `marque.json` sont utilisables dans
   `icone.svg` ; un jeton inconnu fait échouer le générateur.

4. **Générer** puis **activer** :

   ```sh
   echo cadran > desktop/branding/actif
   npm --prefix desktop run marque          # sous Linux sans écran : xvfb-run -a …
   npm run app:dist:linux                   # ou :win, :mac
   ```

   `HIVE_BRANDING=cadran` choisit un thème pour UN build sans toucher à
   `actif`. Relisez `sorties/` (icônes, `installerSidebar.bmp`,
   `background.png`) avant de commiter.

Les positions de l'icône et du raccourci « Applications » dans le DMG vivent à
deux endroits qui bougent ensemble : `gabarits/fond-dmg.html` (la flèche) et
`dmg.contents` dans `desktop/electron-builder.config.cjs`.

`npm run marque` lance Electron avec `--no-sandbox` : c'est un outil de build
qui ne rend que les gabarits de ce dossier, et les machines de build Linux
n'ont souvent pas de `chrome-sandbox` setuid.
