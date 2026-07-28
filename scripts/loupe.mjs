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

const RACINE = new URL('..', import.meta.url).pathname;
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

/** Les lignes AJOUTÉES par la branche, fichier par fichier. */
function lignesAjoutees() {
  const diff = execFileSync(
    'git',
    ['diff', '-U0', `${BASE}...HEAD`, '--', 'src', 'dashboard/src'],
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

function suiteRougit() {
  try {
    execFileSync('npx', ['vitest', 'run', '--bail', '1'], {
      cwd: RACINE,
      stdio: 'pipe',
      timeout: 900_000,
    });
    return false;
  } catch {
    return true;
  }
}

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
