// LA LOUPE — ce qu'on regarde avant de fusionner.
//
// ─── POURQUOI LA BARRIÈRE NE SUFFIT PAS ──────────────────────────────────────
//
// `typecheck`, `lint`, `vitest`, `build` répondent tous à la même question :
// « est-ce que ça marche ? ». Aucun ne répond à celle qui compte au moment de
// fusionner :
//
//     LE CODE QUE JE VIENS D'ÉCRIRE EST-IL DÉFENDU PAR MES PROPRES TESTS ?
//
// Une suite verte le reste quand on ajoute du code que rien ne vérifie. C'est
// le mode d'échec le plus courant et le plus discret : on livre une garde, elle
// est juste, et personne ne s'aperçoit le jour où quelqu'un la retire.
//
// ─── CE QUE FAIT LA LOUPE ────────────────────────────────────────────────────
//
// Elle prend les lignes que la branche AJOUTE au code source, en tire des
// mutations sûres, et vérifie que la suite ROUGIT sur chacune. Une mutation qui
// survit désigne du code neuf que rien ne défend.
//
// C'est la méthode qui a trouvé neuf défauts réels cette nuit, appliquée à
// l'endroit où elle rapporte le plus : sur le diff, avant qu'il n'entre.
//
// ─── CE QU'ELLE NE FAIT PAS, ET IL FAUT LE DIRE ──────────────────────────────
//
// · Elle ne remplace pas la barrière : elle vient APRÈS, et suppose tout vert.
// · Elle échantillonne. Au-delà de MAX_MUTATIONS, elle DIT ce qu'elle a laissé
//   de côté — une troncature silencieuse se lirait comme « tout est couvert ».
// · Un mutant qui survit n'est pas toujours un défaut : il peut être ÉQUIVALENT
//   (aucune entrée ne distingue les deux versions). La loupe ne tranche pas
//   cela — elle désigne, un humain juge.
// · Elle ne mute que des OPÉRATEURS. Une mutation qui casserait la syntaxe
//   ferait échouer toute la suite et passerait pour un mutant tué : la loupe
//   mentirait dans le sens rassurant, le pire des deux.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, jamais `.pathname` : ce dernier rend `/D:/dépôt/` sous
// Windows, et tout ce qui s'y concatène pointe alors dans le vide. C'est le
// § 6.1 du journal, déjà recommis trois fois — et la loupe, qui existe pour
// débusquer ce genre de chose, le portait elle-même.
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.LOUPE_BASE ?? 'origin/main';

/** Au-delà, on échantillonne — et on le dit. */
const MAX_MUTATIONS = Number(process.env.LOUPE_MAX ?? 12);

/**
 * Les échanges d'opérateurs, sûrs par construction.
 *
 * Chacun change le SENS sans toucher à la forme : le fichier reste analysable,
 * donc un échec de la suite est bien un test qui a mordu, pas un parseur qui a
 * renoncé.
 */
const ECHANGES = [
  [' && ', ' || '],
  [' >= ', ' > '],
  [' <= ', ' < '],
  [' === ', ' !== '],
  [' !== ', ' === '],
];

/**
 * Les lignes AJOUTÉES par la branche, fichier par fichier.
 *
 * ─── POURQUOI `scripts/` EN FAIT PARTIE ──────────────────────────────────────
 *
 * La loupe n'a longtemps regardé que `src` et `dashboard/src`. Le jour où
 * `scripts/amorce.mjs` est arrivé — le code qui décide si la ruche démarre du
 * tout, donc le plus exposé du dépôt —, elle a répondu « aucune ligne mutable
 * ajoutée par cette branche » sur un diff qui en ajoutait deux cents.
 *
 * Un outil qui existe pour débusquer le code que rien ne défend ne peut pas
 * avoir d'angle mort sur le chemin que TOUT LE MONDE emprunte en premier.
 *
 * `scripts/loupe.mjs` reste dehors, et c'est le seul : muter le juge pendant
 * qu'il juge rend un verdict dont on ne saurait pas ce qu'il mesure.
 */
function lignesAjoutees() {
  const diff = execFileSync(
    'git',
    [
      'diff',
      '-U0',
      `${BASE}...HEAD`,
      '--',
      'src',
      'dashboard/src',
      'scripts',
      ':(exclude)scripts/loupe.mjs',
    ],
    {
      cwd: RACINE,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const par = new Map();
  let fichier = null;
  for (const ligne of diff.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(ligne);
    if (m) {
      fichier = m[1];
      continue;
    }
    if (!fichier || !ligne.startsWith('+') || ligne.startsWith('+++')) continue;
    const texte = ligne.slice(1);
    // Les commentaires ne s'exécutent pas : les muter ne prouverait rien.
    if (/^\s*(\/\/|\*|\/\*)/.test(texte) || texte.trim() === '') continue;
    if (!par.has(fichier)) par.set(fichier, []);
    par.get(fichier).push(texte);
  }
  return par;
}

/** Les mutations candidates, une par (fichier, ligne, échange). */
function candidates() {
  const out = [];
  for (const [fichier, lignes] of lignesAjoutees()) {
    const source = readFileSync(RACINE + fichier, 'utf8');
    for (const ligne of lignes) {
      // La ligne doit être PRÉSENTE UNE SEULE FOIS dans le fichier final :
      // sinon on ne saurait pas laquelle on a mutée, et le verdict porterait
      // sur autre chose que ce qu'on croit.
      if (source.split(ligne).length - 1 !== 1) continue;
      for (const [de, vers] of ECHANGES) {
        if (!ligne.includes(de)) continue;
        // Une seule occurrence de l'opérateur, même raison.
        if (ligne.split(de).length - 1 !== 1) continue;
        out.push({
          fichier,
          avant: ligne,
          apres: ligne.replace(de, vers),
          quoi: `${de.trim()} → ${vers.trim()}`,
        });
      }
    }
  }
  return out;
}

/**
 * Le verdict tiré de ce que `execFileSync` a jeté. PUR, donc éprouvable.
 *
 * ─── LE FAUX VERT DANS L'OUTIL QUI TRAQUE LES FAUX VERTS ─────────────────────
 *
 * Le `catch` d'origine attrapait TOUT et rendait « la suite a rougi ». Il ne
 * distinguait pas « les tests ont mordu » de « les tests n'ont jamais tourné ».
 *
 * Sous Windows, `npx` est `npx.cmd`, et `spawn` sans interpréteur ne sait pas le
 * lancer (§ 6.2 du journal, déjà mordu trois fois). Chaque mutant y partait donc
 * en ENOENT immédiat — trois millisecondes — était compté « ✔ défendue », et la
 * loupe imprimait « LA LOUPE NE VOIT RIEN DE NU » sans avoir exécuté un seul
 * test. Sur la machine de quelqu'un d'autre, le seul outil du dépôt dont le
 * métier ENTIER est de débusquer les faux verts en était un.
 *
 * Le même piège guette ailleurs : un dépassement de `timeout`, un signal, une
 * mémoire épuisée. Aucun de ces trois n'est un test qui a mordu.
 *
 * Un `status` NUMÉRIQUE est la seule preuve que vitest a tourné et rendu un
 * verdict. Tout le reste est un « je n'ai pas pu regarder », et ça se DIT.
 */
export function verdictDeLErreur(e) {
  if (e === null || e === undefined) return { regarde: true, rouge: false };
  if (typeof e.status === 'number') return { regarde: true, rouge: e.status !== 0 };
  const cause =
    e.code === 'ENOENT'
      ? `binaire introuvable (${String(e.path ?? 'inconnu')})`
      : e.signal !== null && e.signal !== undefined
        ? `tué par le signal ${String(e.signal)}`
        : `${String(e.code ?? 'erreur')} — ${String(e.message ?? '').slice(0, 120)}`;
  return { regarde: false, cause };
}

/**
 * Le chemin RÉEL de vitest, jamais son shim.
 *
 * `scripts/ruche.mjs` et `src/shared/demarrage.ts` prennent déjà ce soin, et
 * pour la raison exacte qui a cassé celui-ci. La loupe mettait en garde en tête
 * de fichier contre `.pathname` — l'autre piège Windows — et passait à côté de
 * celui-là.
 */
const VITEST = path.join('node_modules', 'vitest', 'vitest.mjs');

function suiteRougit() {
  let jete = null;
  try {
    execFileSync(process.execPath, [VITEST, 'run', '--bail', '1'], {
      cwd: RACINE,
      stdio: 'pipe',
      timeout: 900_000,
    });
  } catch (e) {
    jete = e;
  }
  const v = verdictDeLErreur(jete);
  if (!v.regarde) {
    console.error('');
    console.error(`✘ LA LOUPE N’A PAS PU REGARDER : ${v.cause}`);
    console.error('');
    console.error('  Aucun verdict n’est rendu — un outil qui n’a pas pu regarder');
    console.error('  ne dit PAS « c’est défendu ». Le fichier muté a été restauré.');
    console.error('');
    process.exit(2);
  }
  return v.rouge;
}

// ─── LE CORPS NE S'EXÉCUTE QUE SI ON A LANCÉ CE FICHIER ─────────────────────
//
// Sans cette garde, `import('scripts/loupe.mjs')` — depuis un test, depuis un
// outil — DÉCLENCHE une campagne de mutation complète : le fichier mute des
// sources, lance vitest, restaure. Un test qui voulait éprouver une fonction
// pure de vingt lignes se mettait donc à muter le dépôt, et l'interrompre
// laissait une mutation derrière lui.
//
// Mesuré, et pas qu'une fois : le premier `import` depuis `loupe-verdict.test.mjs`
// a lancé la loupe, je l'ai tuée, et `src/tui/rendu.ts` est resté muté. C'est le
// § 2.8 du journal — un fichier qui s'exécute à l'import est un angle mort — et
// le § 5.2 — une loupe interrompue laisse sa mutation — dans le même geste.
//
// `process.argv[1]` est le script que Node a réellement lancé. On compare les
// chemins RÉELS des deux côtés : `fileURLToPath` d'un côté, `realpath` de
// l'autre, parce qu'un lien symbolique ou un `./scripts/loupe.mjs` relatif
// donnerait deux chaînes différentes pour le même fichier.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (MOI !== LANCE) {
  // Importée : on n'expose que les fonctions, on ne mute rien.
} else {
  principal();
}

function principal() {
  const toutes = candidates();
  if (toutes.length === 0) {
    console.log('LOUPE : aucune ligne mutable ajoutée par cette branche.');
    console.log('        (rien à conclure — ce n’est PAS un feu vert.)');
    process.exit(0);
  }

  // Échantillon RÉGULIER plutôt qu'aléatoire : deux passages sur le même diff
  // doivent regarder les mêmes lignes, sinon un verdict n'est pas reproductible.
  const pas = Math.max(1, Math.ceil(toutes.length / MAX_MUTATIONS));
  const retenues = toutes.filter((_, i) => i % pas === 0).slice(0, MAX_MUTATIONS);

  console.log(
    `LOUPE : ${toutes.length} mutation(s) possible(s) sur le diff, ${retenues.length} examinée(s).`,
  );
  if (retenues.length < toutes.length) {
    console.log(
      `        ${toutes.length - retenues.length} laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.`,
    );
  }
  console.log('');

  const survivants = [];
  for (const m of retenues) {
    const chemin = RACINE + m.fichier;
    const original = readFileSync(chemin, 'utf8');
    writeFileSync(chemin, original.replace(m.avant, m.apres));
    let mord;
    try {
      mord = suiteRougit();
    } finally {
      writeFileSync(chemin, original);
    }
    const etiquette = mord ? '  ✔ défendue' : '🔴 SANS TEST';
    console.log(`${etiquette} · ${m.fichier} · ${m.quoi}`);
    console.log(`             ${m.avant.trim().slice(0, 100)}`);
    if (!mord) survivants.push(m);
  }

  console.log('');
  if (survivants.length === 0) {
    console.log('════ LA LOUPE NE VOIT RIEN DE NU ════');
    console.log('Chaque ligne examinée est défendue par au moins un test.');
    process.exit(0);
  }

  console.log('════ CODE NEUF QUE RIEN NE DÉFEND ════');
  for (const s of survivants) {
    console.log(`· ${s.fichier} — ${s.quoi}`);
    console.log(`    ${s.avant.trim().slice(0, 120)}`);
  }
  console.log('');
  console.log('Deux issues, et il faut CHOISIR, pas ignorer :');
  console.log('  · écrire le test qui manque ; ou');
  console.log('  · constater que le mutant est ÉQUIVALENT — et le dire par écrit,');
  console.log('    parce qu’un test qui ne peut pas rougir n’est pas de la couverture.');
  process.exit(1);
}
