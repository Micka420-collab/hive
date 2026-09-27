// OÙ VONT LES CAPTURES, ET SOUS QUEL NOM — module pur de `captures-ecran.mjs`.
//
// ─── POURQUOI CE PETIT MODULE EST À PART ─────────────────────────────────────
//
// Le coureur EFFACE les captures de l'exécution précédente avant d'écrire les
// nouvelles : une vue retirée ou renommée laisserait sinon sa vieille image à
// côté des neuves, et une capture périmée se lit comme une preuve.
//
// Effacer dans un dossier que l'appelant choisit est exactement le genre de
// geste qu'on veut pouvoir éprouver sans lancer de navigateur. Pointé par
// `--sortie docs/images` sur les images du README, le coureur ne doit toucher
// qu'aux fichiers qu'IL a nommés — c'est `estNotreCapture` qui le garantit, et
// elle est testée seule (`tests/captures-ecran.test.mjs`).

import path from 'node:path';

/** Le dossier par défaut, relatif à la racine du dépôt — et ignoré par git. */
export const SORTIE_PAR_DEFAUT = 'captures-ecran';

/**
 * Les deux formats photographiés.
 *
 * `bureau` reprend la taille des captures déjà publiées (`docs/images/*.png`,
 * 1440 × 900) et photographie L'ÉCRAN — ce qu'on voit en ouvrant la vue.
 * `mobile` prend un téléphone courant, à densité 2, et photographie la PAGE
 * ENTIÈRE : c'est à cette largeur que les panneaux s'empilent, se chevauchent
 * ou débordent (`styles.css`, paliers 900 et 560 px), et ça se passe sous le
 * premier écran. La barre latérale, collante et haute de 100vh, s'y arrête à la
 * hauteur d'un écran : c'est la capture, pas un défaut de mise en page.
 */
export const FORMATS = [
  {
    nom: 'bureau',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    pleinePage: false,
  },
  {
    nom: 'mobile',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    pleinePage: true,
  },
];

/** Les langues de l'interface (`dashboard/src/i18n.ts`). */
export const LANGUES = ['fr', 'en'];

/** Le manifeste d'une exécution : ce qui a été photographié, et ce qui a été mesuré. */
export const MANIFESTE = 'captures.json';

/** Le fichier d'une capture : `<vue>.<format>.png`, par exemple `ruche.mobile.png`. */
export function nomCapture(vue, format) {
  return `${vue}.${format}.png`;
}

/**
 * Ce fichier est-il une capture que ce script a pu écrire ?
 *
 * Le motif est celui de `nomCapture`, avec les SEULS formats connus : un
 * `banniere-clair.png` ou un `dashboard-ruche.png` n'y ressemblent pas, et ne
 * seront jamais effacés.
 */
export function estNotreCapture(nom) {
  const formats = FORMATS.map((f) => f.nom).join('|');
  return (
    nom === MANIFESTE || new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*\\.(?:${formats})\\.png$`).test(nom)
  );
}

/**
 * Lit la ligne de commande : `--langue fr|en`, `--sortie <dossier>`.
 *
 * La sortie est RELATIVE À LA RACINE DU DÉPÔT et doit y rester : c'est là que
 * `.gitignore` peut la couvrir, et c'est ce qui borne l'effacement ci-dessus à
 * un endroit qu'on voit dans `git status`. Défaut : `captures-ecran/<langue>`.
 *
 * Rend `{ langue, sortie }` (sortie absolue), ou `{ erreur }`.
 */
export function optionsDepuisArgv(argv, racine) {
  let langue = 'fr';
  let demandee = null;
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = argv[i + 1];
    if (cle === '--langue' || cle === '--sortie') {
      if (valeur === undefined || valeur.startsWith('--'))
        return { erreur: `${cle} attend une valeur` };
      if (cle === '--langue') langue = valeur;
      else demandee = valeur;
      i++;
    } else {
      return { erreur: `option inconnue : ${cle}` };
    }
  }
  if (!LANGUES.includes(langue)) return { erreur: `langue inconnue : ${langue} (fr ou en)` };

  const sortie = path.resolve(racine, demandee ?? path.join(SORTIE_PAR_DEFAUT, langue));
  const relative = path.relative(racine, sortie);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { erreur: `--sortie doit désigner un dossier DANS le dépôt : ${demandee}` };
  }
  return { langue, sortie };
}
