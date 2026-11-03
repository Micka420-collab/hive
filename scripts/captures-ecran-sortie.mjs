// OÙ VONT LES CAPTURES, SOUS QUEL NOM, LESQUELLES — module pur de `captures-ecran.mjs`.
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
 * Tous les formats que le coureur sait photographier.
 *
 * `bureau` reprend la taille des captures déjà publiées (`docs/images/*.png`,
 * 1440 × 900) et photographie L'ÉCRAN — ce qu'on voit en ouvrant la vue.
 * `mobile` prend un téléphone courant, à densité 2, et photographie la PAGE
 * ENTIÈRE : c'est à cette largeur que les panneaux s'empilent, se chevauchent
 * ou débordent (`styles.css`, paliers 900 et 560 px), et ça se passe sous le
 * premier écran. La barre latérale, collante et haute de 100vh, s'y arrête à la
 * hauteur d'un écran : c'est la capture, pas un défaut de mise en page.
 *
 * ─── LA GRILLE DE RECETTE DE HIVE STUDIO (#579, § 8) ────────────────────────
 *
 * Les cinq autres ne servent qu'à la demande (`--formats grille`) : avec
 * `bureau`, ce sont les six largeurs où la refonte doit tenir — 1920 × 1080,
 * 1440 × 900, 1366 × 768, 1024 × 768, 768 px et 375 px. Elles ne sont PAS dans
 * la série par défaut : la série publiée (docs/CAPTURES.md) ne change pas de
 * taille parce qu'on a recetté une refonte, et sept fois plus d'images à
 * chaque exécution apprendraient à ne plus les regarder.
 *
 * Les deux portraits photographient la page entière, comme `mobile` : c'est
 * sous le premier écran qu'une colonne empilée déborde.
 */
export const TOUS_LES_FORMATS = [
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
  {
    nom: 'large',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    pleinePage: false,
  },
  {
    nom: 'portable',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    pleinePage: false,
  },
  {
    nom: 'tablette',
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
    pleinePage: false,
  },
  {
    nom: 'tablette-portrait',
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    pleinePage: true,
  },
  {
    nom: 'telephone',
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    pleinePage: true,
  },
];

/** Les formats photographiés par défaut : la série publiée. */
export const FORMATS = TOUS_LES_FORMATS.filter((f) => f.nom === 'bureau' || f.nom === 'mobile');

/** `--formats grille` : les six largeurs de la recette de Hive Studio (#579, § 8). */
export const GRILLE = ['large', 'bureau', 'portable', 'tablette', 'tablette-portrait', 'telephone'];

/** Les langues de l'interface (`dashboard/src/i18n.ts`). */
export const LANGUES = ['fr', 'en'];

/** Le manifeste d'une exécution : ce qui a été photographié, et ce qui a été mesuré. */
export const MANIFESTE = 'captures.json';

/**
 * Ce qu'une vue a le droit de s'appeler : minuscules, chiffres, tirets.
 *
 * UN SEUL MOTIF pour NOMMER et pour EFFACER. Le nom d'une vue vient de la page
 * (l'identifiant de sa case) ; si `nomCapture` acceptait un nom que
 * `estNotreCapture` ne reconnaît pas — `war_room`, une majuscule, un accent —,
 * l'image serait écrite mais jamais effacée, et survivrait aux exécutions
 * suivantes : exactement la capture périmée que l'effacement existe pour
 * empêcher.
 */
const MOTIF_VUE = '[a-z0-9]+(?:-[a-z0-9]+)*';
const VUE = new RegExp(`^${MOTIF_VUE}$`);
// TOUS les formats, et pas seulement ceux du jour : une image `ruche.large.png`
// laissée par une recette doit être reconnue — donc effacée — par l'exécution
// ordinaire suivante, sinon elle survivrait à côté de la série neuve.
const NOMS_FORMATS = TOUS_LES_FORMATS.map((f) => f.nom).join('|');

/**
 * Le fichier d'une capture : `<vue>.<format>.png`, par exemple `ruche.mobile.png`.
 *
 * LÈVE sur un nom hors motif : le coureur l'appelle dans son `try`, la vue est
 * alors consignée en échec — jamais écrite sous un nom que personne n'effacera.
 */
export function nomCapture(vue, format) {
  if (!VUE.test(vue)) throw new Error(`nom de vue hors motif (${MOTIF_VUE}) : « ${vue} »`);
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
  return nom === MANIFESTE || new RegExp(`^${MOTIF_VUE}\\.(?:${NOMS_FORMATS})\\.png$`).test(nom);
}

/**
 * Lit la ligne de commande : `--langue fr|en`, `--sortie <dossier>`,
 * `--vues <liste>`, `--formats <liste>|grille`.
 *
 * La sortie est RELATIVE À LA RACINE DU DÉPÔT et doit y rester : c'est là que
 * `.gitignore` peut la couvrir, et c'est ce qui borne l'effacement ci-dessus à
 * un endroit qu'on voit dans `git status`. Défaut : `captures-ecran/<langue>`.
 *
 * `--vues` restreint ce qui est photographié : `ruche` (tous les formats) ou
 * `ruche.mobile` (un seul), séparés par des virgules. C'est ce qui rend la série
 * PUBLIÉE (`docs/images/captures/`, sept images choisies) refaisable par une
 * commande, au lieu de trente-quatre images à trier à la main (cf.
 * docs/CAPTURES.md).
 *
 * `--formats` choisit les formats (`TOUS_LES_FORMATS`), séparés par des
 * virgules, dans l'ordre donné ; `grille` vaut les six de la recette. Défaut :
 * la série publiée, `bureau` puis `mobile`.
 *
 * Rend `{ langue, sortie, vues, formats }` (sortie absolue ; `vues` : `null` =
 * tout ; `formats` : les objets de `TOUS_LES_FORMATS`), ou `{ erreur }`.
 */
export function optionsDepuisArgv(argv, racine) {
  let langue = 'fr';
  let demandee = null;
  let vues = null;
  let noms = null;
  for (let i = 0; i < argv.length; i++) {
    const cle = argv[i];
    const valeur = argv[i + 1];
    if (cle === '--langue' || cle === '--sortie' || cle === '--vues' || cle === '--formats') {
      if (valeur === undefined || valeur.startsWith('--'))
        return { erreur: `${cle} attend une valeur` };
      if (cle === '--langue') langue = valeur;
      else if (cle === '--sortie') demandee = valeur;
      else if (cle === '--formats')
        noms = valeur === 'grille' ? GRILLE : valeur.split(',').map((v) => v.trim());
      else vues = valeur.split(',').map((v) => v.trim());
      i++;
    } else {
      return { erreur: `option inconnue : ${cle}` };
    }
  }
  if (!LANGUES.includes(langue)) return { erreur: `langue inconnue : ${langue} (fr ou en)` };

  const selection = new RegExp(`^${MOTIF_VUE}(?:\\.(?:${NOMS_FORMATS}))?$`);
  const fautive = vues?.find((v) => !selection.test(v));
  if (fautive !== undefined) {
    return { erreur: `--vues : « ${fautive} » n'est ni <vue> ni <vue>.<${NOMS_FORMATS}>` };
  }

  // Un format inconnu est une ERREUR, pas un format ignoré : « --formats
  // tabelette » qui photographierait en silence zéro image finirait en code 0.
  const inconnu = noms?.find((n) => !TOUS_LES_FORMATS.some((f) => f.nom === n));
  if (inconnu !== undefined) {
    return { erreur: `--formats : « ${inconnu} » n'est ni grille ni un de ${NOMS_FORMATS}` };
  }
  const formats = noms
    ? [...new Set(noms)].map((n) => TOUS_LES_FORMATS.find((f) => f.nom === n))
    : FORMATS;

  const sortie = path.resolve(racine, demandee ?? path.join(SORTIE_PAR_DEFAUT, langue));
  const relative = path.relative(racine, sortie);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { erreur: `--sortie doit désigner un dossier DANS le dépôt : ${demandee}` };
  }
  return { langue, sortie, vues, formats };
}

/** La vue `vue`, au format `format`, est-elle demandée ? (`vues` : `null` = tout.) */
export function vueRetenue(vues, vue, format) {
  return vues === null || vues.includes(vue) || vues.includes(`${vue}.${format}`);
}

/**
 * Le fichier de l'écran construit qui répond à cette URL, ou `null`.
 *
 * Le coureur construit l'écran dans son dossier JETABLE et le sert lui-même au
 * navigateur (cf. `captures-ecran.mjs`, « l'écran ») : `/` est `index.html`, le
 * reste est cherché dans le dossier — et n'en sort JAMAIS. Un `..%2F` décodé
 * remonterait sinon d'un cran vers le disque de l'opérateur ; `null` renvoie la
 * requête à la Reine, qui répond ce qu'elle répondrait.
 */
export function fichierDeLEcran(ecran, url) {
  let chemin;
  try {
    chemin = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  const fichier = path.resolve(ecran, `.${chemin === '/' ? '/index.html' : chemin}`);
  const relatif = path.relative(ecran, fichier);
  if (relatif === '' || relatif.startsWith('..') || path.isAbsolute(relatif)) return null;
  return fichier;
}
