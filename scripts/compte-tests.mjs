// LE COMPTE DE TESTS ANNONCÉ PAR LES BADGES, CONFRONTÉ AU COMPTE RÉEL.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Les badges des deux READMEs ont annoncé « 2310 tests » quand il y en avait
// 2590, puis « 2730 » quand il y en avait 2820. Deux fois le même défaut, et à
// chaque fois corrigé à la main — donc à chaque fois reparti pour dériver au
// commit suivant.
//
// `tests/readme.test.ts` garde déjà que les DEUX badges portent le même
// chiffre. C'est utile et ça ne suffit pas : deux badges peuvent être d'accord
// et faux ensemble, ce qui est exactement ce qui s'est produit.
//
// Le compte réel n'existe qu'APRÈS l'exécution de la suite. Une garde écrite
// dans la suite elle-même ne peut donc pas le connaître — d'où cet outil, qui
// tourne après, lit le rapport JSON de vitest, et n'a rien à deviner.
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

/** Le motif du badge, unique et partagé — deux copies dériveraient. */
export const MOTIF_BADGE = /(tests-)(\d+)(%20passing)/;

/**
 * Le chiffre annoncé par un badge, ou `null` si le fichier n'en porte pas.
 *
 * `null` n'est PAS zéro : un README sans badge est une anomalie de forme, pas
 * un README qui annonce zéro test. Les confondre ferait passer un fichier
 * mutilé pour un fichier en retard.
 */
export function nombreDuBadge(source) {
  const m = MOTIF_BADGE.exec(source);
  return m === null ? null : Number(m[2]);
}

/** Le même source, avec le chiffre du badge remplacé. */
export function badgeCorrige(source, reel) {
  return source.replace(MOTIF_BADGE, (_, avant, __, apres) => `${avant}${reel}${apres}`);
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
 * @param {Array<{nom: string, annonce: number|null}>} badges
 * @returns {{ok: boolean, message: string, aCorriger: string[]}}
 */
export function verdict(reel, badges) {
  if (reel === null) {
    return {
      ok: false,
      aCorriger: [],
      message:
        'rapport vitest illisible : « numTotalTests » absent ou nul.\n' +
        'Relancer avec --reporter=json --outputFile.json=<chemin>.',
    };
  }
  const sansBadge = badges.filter((b) => b.annonce === null).map((b) => b.nom);
  if (sansBadge.length > 0) {
    return {
      ok: false,
      aCorriger: [],
      message: `badge introuvable dans : ${sansBadge.join(', ')}`,
    };
  }
  const faux = badges.filter((b) => b.annonce !== reel);
  if (faux.length === 0) {
    return { ok: true, aCorriger: [], message: `badges à jour : ${reel} tests.` };
  }
  return {
    ok: false,
    aCorriger: faux.map((b) => b.nom),
    message:
      `la suite rend ${reel} tests, les badges annoncent ` +
      `${faux.map((b) => `${b.nom} → ${b.annonce}`).join(', ')}.\n` +
      'Chez soi : npm run compte-tests -- --corriger',
  };
}

export const READMES = ['README.md', 'README.en.md'];

/** Le geste impur : lire, décider, écrire ou refuser. */
function principal(argv, racine, ecrire, sortir) {
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

  const sources = new Map(READMES.map((f) => [f, readFileSync(path.join(racine, f), 'utf8')]));
  const reel = compteReel(rapport);
  const v = verdict(
    reel,
    READMES.map((nom) => ({ nom, annonce: nombreDuBadge(sources.get(nom) ?? '') })),
  );

  if (v.ok) {
    ecrire(`${v.message}\n`);
    return;
  }
  if (corriger && v.aCorriger.length > 0) {
    for (const nom of v.aCorriger) {
      writeFileSync(path.join(racine, nom), badgeCorrige(sources.get(nom) ?? '', reel), 'utf8');
      ecrire(`${nom} : badge porté à ${reel}\n`);
    }
    return;
  }
  ecrire(`${v.message}\n`);
  sortir(1);
}

// ─── LA GARDE DU POINT D'ENTRÉE ──────────────────────────────────────────────
//
// Sans elle, importer ce fichier pour en tester les fonctions pures LANCERAIT
// la comparaison — et, avec `--corriger`, réécrirait les READMEs pendant une
// campagne de mutation. La loupe s'est déjà fait piéger exactement comme ça.
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
