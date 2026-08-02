// LE COMPTE DE TESTS ANNONCÉ AU PUBLIC, CONFRONTÉ AU COMPTE RÉEL.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Le même nombre est écrit à QUATRE endroits que rien ne reliait : les badges
// des deux README, et le bandeau de la vitrine dans ses deux langues. Il a
// annoncé « 2310 » pour 2590, puis « 2730 » pour 2820, puis « 2 600 » pour
// 2 846 sur la page d'accueil. Trois fois le même défaut, trois fois corrigé à
// la main — donc trois fois reparti pour dériver au commit suivant.
//
// Les gardes existantes comparaient les copies ENTRE ELLES : les deux badges
// l'un à l'autre, les deux langues l'une à l'autre. Utile, et insuffisant —
// deux copies peuvent être d'accord et fausses ensemble, ce qui est exactement
// ce que produit un seul geste de correction.
//
// Le compte réel n'existe qu'APRÈS l'exécution de la suite. Une garde écrite
// dans la suite elle-même ne peut donc pas le connaître : c'est structurel, pas
// un oubli. D'où cet outil, qui tourne après, lit le rapport JSON de vitest, et
// n'a rien à deviner.
//
// ─── DEUX MODES, ET POURQUOI LE SECOND EXISTE ────────────────────────────────
//
// Sans `--corriger`, il CONSTATE et sort en 1 : c'est ce que fait la CI.
// Avec `--corriger`, il ÉCRIT le bon chiffre : c'est ce qu'on lance chez soi.
//
// Un outil qui ne sait que refuser se fait contourner à la troisième fois. Un
// outil qui répare tout seul en CI cache le problème. Les deux gestes existent,
// et ils sont dans des mains différentes.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Un nombre avec ses milliers séparés — « 2846 » → « 2 846 » ou « 2,846 ».
 *
 * Chaque endroit garde SA mise en forme : le français sépare par une espace,
 * l'anglais par une virgule, et l'URL d'un badge n'accepte ni l'une ni l'autre.
 * Réécrire un chiffre sans respecter ça donnerait un texte faux dans une langue
 * — une correction qui casse ce qu'elle prétend réparer.
 */
export function groupe(n, separateur) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, separateur);
}

/**
 * Les quatre endroits où le compte est annoncé au public.
 *
 * `motif` capture en trois morceaux — ce qui précède, LE CHIFFRE, ce qui suit —
 * pour qu'une réécriture ne puisse toucher que le second. Deux cibles peuvent
 * viser le même fichier : c'est le cas de la vitrine, qui l'écrit une fois en
 * français dans son HTML et une fois en anglais dans son dictionnaire.
 */
export const CIBLES = [
  {
    nom: 'README.md',
    fichier: 'README.md',
    motif: /(tests-)(\d+)(%20passing)/,
    separateur: '',
  },
  {
    nom: 'README.en.md',
    fichier: 'README.en.md',
    motif: /(tests-)(\d+)(%20passing)/,
    separateur: '',
  },
  {
    nom: 'site/index.html (FR)',
    fichier: 'site/index.html',
    motif: /(data-i18n="badge\.tests"\s*>)([\d  ,]+)( tests ✓)/,
    separateur: ' ',
  },
  {
    nom: 'site/index.html (EN)',
    fichier: 'site/index.html',
    motif: /('badge\.tests': ')([\d  ,]+)( tests ✓')/,
    separateur: ',',
  },
  // La présentation imprimable annonce le même compte, dans ses deux langues.
  // Elle le porte SANS la coche de la vitrine : les motifs s'arrêtent donc à
  // « tests », et ne peuvent pas mordre sur le fichier d'au-dessus.
  {
    nom: 'site/presentation/index.html (FR)',
    fichier: 'site/presentation/index.html',
    motif: /(data-i18n="badge\.tests"\s*>)([\d  ,]+)( tests<)/,
    separateur: ' ',
  },
  {
    nom: 'site/presentation/index.html (EN)',
    fichier: 'site/presentation/index.html',
    motif: /('badge\.tests': ')([\d  ,]+)( tests')/,
    separateur: ',',
  },
];

/**
 * Le chiffre annoncé par une cible, ou `null` si elle n'est plus là.
 *
 * `null` n'est PAS zéro : un fichier dont le badge a disparu est une anomalie
 * de forme, pas un fichier qui annonce zéro test. Les confondre ferait
 * « corriger » un document dont la structure est cassée.
 */
export function lire(source, cible) {
  const m = cible.motif.exec(source);
  if (m === null) return null;
  const chiffres = (m[2] ?? '').replace(/[^\d]/g, '');
  return chiffres === '' ? null : Number(chiffres);
}

/** La même source, avec le seul chiffre de cette cible remplacé. */
export function reecrire(source, cible, reel) {
  return source.replace(
    cible.motif,
    (_, avant, __, apres) => `${avant}${groupe(reel, cible.separateur)}${apres}`,
  );
}

/**
 * Le compte réel, lu dans le rapport JSON de vitest.
 *
 * On exige un ENTIER POSITIF plutôt que « ce qui est là » : un rapport tronqué
 * rendrait `undefined`, `Number(undefined)` rend `NaN`, et toute comparaison
 * avec `NaN` est fausse — la garde passerait au vert sur un rapport illisible.
 * C'est la forme de faux vert que ce dépôt connaît le mieux.
 */
export function compteReel(rapport) {
  const n = rapport?.numTotalTests;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Le verdict, PUR : ce qu'on a lu d'un côté, ce qu'on a compté de l'autre.
 *
 * @param {number|null} reel
 * @param {Array<{nom: string, annonce: number|null}>} annonces
 * @returns {{ok: boolean, message: string, aCorriger: string[]}}
 */
export function verdict(reel, annonces) {
  if (reel === null) {
    return {
      ok: false,
      aCorriger: [],
      message:
        'rapport vitest illisible : « numTotalTests » absent ou nul.\n' +
        'Relancer avec --reporter=json --outputFile.json=<chemin>.',
    };
  }
  const introuvables = annonces.filter((a) => a.annonce === null).map((a) => a.nom);
  if (introuvables.length > 0) {
    return {
      ok: false,
      aCorriger: [],
      message: `compte introuvable dans : ${introuvables.join(', ')}`,
    };
  }
  const faux = annonces.filter((a) => a.annonce !== reel);
  if (faux.length === 0) {
    return { ok: true, aCorriger: [], message: `les ${annonces.length} annonces disent ${reel}.` };
  }
  return {
    ok: false,
    aCorriger: faux.map((a) => a.nom),
    message:
      `la suite rend ${reel} tests, on annonce ` +
      `${faux.map((a) => `${a.nom} → ${a.annonce}`).join(', ')}.\n` +
      'Chez soi : npm run compte-tests -- --corriger',
  };
}

/**
 * Le geste impur : lire, décider, écrire ou refuser.
 *
 * ─── POURQUOI IL EST EXPORTÉ ─────────────────────────────────────────────────
 *
 * Première version : `principal` était privée, et les fonctions pures au-dessus
 * étaient testées seules. La loupe a rendu **trois survivants**, tous ici —
 * l'absence d'argument, la porte de `--corriger`, et la garde du point d'entrée.
 * Trois branches que rien n'exerçait, dans la seule partie du fichier qui ÉCRIT
 * dans des fichiers.
 *
 * Ses quatre effets sont déjà des paramètres. Il n'y avait donc rien à
 * découper : il suffisait de l'exposer. « Impur » ne veut pas dire
 * « intestable » — ça veut dire « dont les effets se passent en argument ».
 */
export function principal(argv, racine, ecrire, sortir) {
  const corriger = argv.includes('--corriger');
  const chemin = argv.find((a) => !a.startsWith('--'));
  if (chemin === undefined) {
    ecrire('usage : node scripts/compte-tests.mjs <rapport.json> [--corriger]\n');
    sortir(2);
    return;
  }

  let rapport;
  try {
    rapport = JSON.parse(readFileSync(path.resolve(racine, chemin), 'utf8'));
  } catch (e) {
    ecrire(`rapport illisible (${chemin}) : ${e instanceof Error ? e.message : String(e)}\n`);
    sortir(2);
    return;
  }

  // Un fichier lu UNE fois, même s'il porte deux cibles : sans ça, la seconde
  // écriture repartirait du contenu d'avant la première et l'effacerait.
  const sources = new Map();
  for (const c of CIBLES) {
    if (!sources.has(c.fichier)) {
      sources.set(c.fichier, readFileSync(path.join(racine, c.fichier), 'utf8'));
    }
  }

  const reel = compteReel(rapport);
  const v = verdict(
    reel,
    CIBLES.map((c) => ({ nom: c.nom, annonce: lire(sources.get(c.fichier) ?? '', c) })),
  );

  if (v.ok) {
    ecrire(`${v.message}\n`);
    return;
  }
  if (corriger && v.aCorriger.length > 0) {
    for (const c of CIBLES.filter((c) => v.aCorriger.includes(c.nom))) {
      sources.set(c.fichier, reecrire(sources.get(c.fichier) ?? '', c, reel));
      ecrire(`${c.nom} : porté à ${groupe(reel, c.separateur)}\n`);
    }
    for (const [fichier, contenu] of sources) {
      writeFileSync(path.join(racine, fichier), contenu, 'utf8');
    }
    return;
  }
  ecrire(`${v.message}\n`);
  sortir(1);
}

// ─── LA GARDE DU POINT D'ENTRÉE ──────────────────────────────────────────────
//
// Sans elle, importer ce fichier pour en tester les fonctions pures LANCERAIT
// la comparaison — et, avec `--corriger`, réécrirait les README et la vitrine
// pendant une campagne de mutation. La loupe s'est déjà fait piéger comme ça.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (MOI === LANCE) {
  principal(
    process.argv.slice(2),
    fileURLToPath(new URL('..', import.meta.url)),
    (s) => process.stdout.write(s),
    (c) => process.exit(c),
  );
}
