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
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
 *
 * ─── LA TABLE ÉTAIT ASYMÉTRIQUE, ET DU MAUVAIS CÔTÉ ──────────────────────────
 *
 * `===` ↔ `!==` allait dans les deux sens. Les bornes, non : `>=` → `>` et
 * `<=` → `<` RESSERRENT, et leurs inverses — ceux qui RELÂCHENT — manquaient.
 *
 * Le sens absent était le plus dangereux des deux. Resserrer une borne fait
 * refuser du travail légitime : quelqu'un s'en plaint le jour même. La relâcher
 * fait ACCEPTER ce qui devait être refusé, et personne ne vient le dire.
 *
 * Ce n'était pas théorique : le carnet raconte `aSupprimer`, le geste le plus
 * irréversible du dépôt — `s.arreteA > 0` muté en `>= 0` faisait entrer une
 * ligne incohérente (état « arrêté », aucune date d'arrêt) dans les candidates à
 * l'effacement DÉFINITIF, immédiatement, puisque `now - 0` dépasse toute
 * rétention. Cette mutation-là avait été posée À LA MAIN, faute que la loupe
 * sache la produire.
 *
 * ─── POURQUOI CES ÉCHANGES NE SE MARCHENT PAS DESSUS ─────────────────────────
 *
 * Chaque motif porte ses espaces : ` >= ` ne contient pas ` > ` (le `>` y est
 * suivi d'un `=`), et ` => ` non plus (le `>` y est précédé d'un `=`). Sans
 * cette précaution, une même ligne rendrait deux mutations dont l'une casserait
 * la syntaxe — `a >== b`, ou toutes les fonctions fléchées du fichier — et un
 * fichier qui ne s'analyse plus fait échouer la suite entière : le mutant
 * passerait pour tué, et la loupe mentirait dans le sens rassurant.
 *
 * `??` ne figure PAS dans cette table : il a sa propre règle, plus étroite, juste
 * en dessous.
 */
const ECHANGES = [
  [' && ', ' || '],
  [' || ', ' && '],
  [' >= ', ' > '],
  [' > ', ' >= '],
  [' <= ', ' < '],
  [' < ', ' <= '],
  [' === ', ' !== '],
  [' !== ', ' === '],
];

/**
 * `?? repli` → `|| repli`, mais SEULEMENT quand le repli est un littéral TRUTHY.
 *
 * ─── POURQUOI PAS TOUS LES `??` : C'EST MESURÉ, PAS SUPPOSÉ ──────────────────
 *
 * `a ?? b` ne prend `b` que si `a` est `null`/`undefined` ; `a || b` le prend
 * AUSSI sur `0`, `''`, `false`. Le premier jet mutait donc tous les `??`.
 *
 * Un balayage à base épinglée a rendu son verdict : 12 désignations neuves, dont
 * DIX ÉQUIVALENTES — parce que le TYPE interdisait le cas. `get(k) ?? {…}` (un
 * objet n'est jamais falsy), `n.modeles ?? []`, `row?.echelon ?? null` (union de
 * littéraux non vides), `essais ?? 0` et `c?.actif ?? false` (la valeur falsy
 * possible EST le repli).
 *
 * La loupe ne voit pas les types : elle aurait re-désigné ces dix à CHAQUE passe,
 * et son verdict serait rouge à perpétuité. Or un instrument qui ne peut plus
 * rendre vert n'est plus une porte, c'est un mur — et un mur ne se lit pas.
 * L'en-tête met en garde contre le faux vert rassurant ; le faux rouge permanent
 * est l'autre façon de n'être plus écouté.
 *
 * ─── CE QUE LA RESTRICTION GARDE ─────────────────────────────────────────────
 *
 * Avec un repli truthy, une valeur « fausse mais présente » à gauche est
 * remplacée par quelque chose de DIFFÉRENT : la mutation mord toujours.
 *
 *     nodeOnShift.get(n.id) ?? true   une ouvrière HORS SERVICE redevient
 *                                     disponible — la garde échoue en S'OUVRANT
 *     opts.uid ?? 1000                `uid` 0 est ROOT : le conteneur changerait
 *                                     d'utilisateur, en silence
 *     code ?? 1                       un code de sortie 0 (succès) devient 1
 *     config.tickMs ?? 2_000          un 0 explicite écrasé par le défaut
 *
 * ─── CE QU'ELLE PERD, ET IL FAUT LE DIRE ─────────────────────────────────────
 *
 * `x ?? null` mord VRAIMENT si `x` peut être la chaîne vide — mais seul le type
 * le dit. On préfère rater ce cas plutôt que noyer chaque passe sous 107
 * désignations qu'on ne saurait pas trancher. Un repli `0.5` est perdu aussi
 * (le motif exige un premier chiffre non nul).
 *
 * Le motif porte ses espaces, comme les autres : ` ??= ` ne contient pas ` ?? `
 * (le second `?` y est suivi d'un `=`). Sans cela la loupe écrirait `a ||= b` —
 * du JavaScript VALIDE, donc silencieux, et le verdict porterait sur autre chose
 * que ce qu'on croit mesurer.
 */
const REPLI_QUI_MORD = /^(?:true\b|[1-9][\d_]*\b)/;

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

/**
 * La classe de droite d'un `instanceof`, remplacée par la plus large qui soit.
 *
 * ─── L'ANGLE MORT QUI A DONNÉ CETTE RÈGLE ────────────────────────────────────
 *
 * La loupe ne mutait que des opérateurs BINAIRES DE COMPARAISON. Un lot dont la
 * garde centrale était `if (e instanceof TypeError)` — le tri entre « le serveur
 * a refusé » et « personne n'a répondu » — lui a donc rendu ZÉRO candidat, et
 * elle a imprimé « LA LOUPE NE VOIT RIEN DE NU » sur un diff dont la seule vraie
 * décision n'avait jamais été mutée. Son en-tête met en garde contre le faux
 * vert rassurant ; elle en produisait un. Le dépôt compte 79 `instanceof` en
 * production : l'angle mort n'était pas une curiosité.
 *
 * ─── POURQUOI `Object` PLUTÔT QU'UNE NÉGATION ────────────────────────────────
 *
 * Nier (`!(x instanceof Y)`) demanderait de connaître les BORNES de l'expression
 * — donc un parseur. Sans lui, on poserait des parenthèses au jugé, et une
 * mutation qui casse la syntaxe fait échouer toute la suite : elle passerait
 * pour un mutant tué, et la loupe mentirait dans le sens rassurant, le pire des
 * deux (voir l'en-tête).
 *
 * Remplacer la classe par `Object` reste un échange de JETON — la forme ne bouge
 * pas, `Object` est toujours dans la portée — et il ôte exactement ce que la
 * garde apporte : sa capacité à DISTINGUER. Un banc qui sépare `TypeError` de
 * `SyntaxError` rougit ; un banc qui ne fait que suivre le chemin heureux, non.
 * C'est bien ce qu'on veut mesurer.
 *
 * Ce que cette mutation NE voit pas, et il faut le dire : sur une entrée
 * PRIMITIVE, `'x' instanceof Object` et `'x' instanceof String` valent tous deux
 * `false` — le mutant survit alors sans être faux. La loupe DÉSIGNE, un humain
 * juge : c'est déjà son contrat.
 */
const CLASSE_LA_PLUS_LARGE = 'Object';

/**
 * Une ligne qui décide « SUIS-JE LE FICHIER QU'ON A LANCÉ ? ».
 *
 * ─── LA MUTATION QUI A NOYÉ LA MACHINE ───────────────────────────────────────
 *
 * `scripts/tamis-ordres.mjs` termine sur la garde qui l'empêche de s'exécuter à
 * l'import :
 *
 *     if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(…))
 *
 * La loupe l'a mutée en `||`. Sous vitest, `process.argv[1]` est toujours vrai :
 * la garde tire donc À L'IMPORT. Or le test qui importe `principal` fait alors
 * ce que ce fichier fait — RELANCER LA SUITE ENTIÈRE TROIS FOIS. Chacune des
 * trois réimporte le même module muté, et en relance trois autres.
 *
 * Mesuré : charge moyenne 57, une soixantaine de vitest vivants, des processus
 * de onze minutes. Le butoir de 15 minutes de `suiteRougit` n'y peut rien —
 * `timeout` d'`execFileSync` tue l'enfant DIRECT, jamais sa descendance.
 *
 * ─── POURQUOI C'EST UNE RÈGLE, PAS UN RUSTINE SUR UN FICHIER ─────────────────
 *
 * Trois fichiers du dépôt portent cette garde, sous trois formes. Muter l'une
 * d'elles n'éprouve AUCUN comportement du programme : ça change si le module
 * S'EXÉCUTE À L'IMPORT, ce qui est une propriété du harnais, pas du code sous
 * examen. Le mutant n'est jamais un signal utile — au mieux il tue le worker et
 * passe pour « défendu », au pire il fait s'appeler la suite elle-même.
 *
 * C'est le même raisonnement qui garde `scripts/loupe.mjs` hors du champ, étendu
 * à ce qu'il aurait dû couvrir dès le départ : on ne mute pas ce qui décide
 * QU'ON S'EXÉCUTE.
 *
 * ─── CE QUE CETTE RÈGLE COÛTE, ET IL FAUT LE DIRE ────────────────────────────
 *
 * `MOI` et `LANCE` sont la convention de nommage de ce dépôt pour les deux côtés
 * de la comparaison. Les renommer rendrait cette garde aveugle sans que rien ne
 * le signale. Le couplage est réel : il est écrit ici plutôt que caché.
 */
export function estGardeDePointDEntree(ligne) {
  if (ligne.includes('import.meta.url') || ligne.includes('process.argv[1]')) return true;
  // La forme en deux temps : `const MOI = …` / `const LANCE = …` puis la
  // comparaison, qui ne porte plus aucun des deux marqueurs ci-dessus.
  return /\bMOI\b/.test(ligne) && /\bLANCE\b/.test(ligne);
}

/**
 * Les mutations d'UNE ligne. PURE, donc éprouvable — et elle l'est
 * (`tests/loupe-mutations.test.mjs`), ce qui n'était pas le cas tant qu'elle
 * vivait enfouie dans `candidates()`.
 */
export function mutationsDeLigne(ligne) {
  const out = [];
  // Une garde de point d'entrée ne se mute pas : voir `estGardeDePointDEntree`.
  if (estGardeDePointDEntree(ligne)) return out;
  for (const [de, vers] of ECHANGES) {
    if (!ligne.includes(de)) continue;
    // Une seule occurrence de l'opérateur : sinon on ne saurait pas laquelle on
    // a mutée, et le verdict porterait sur autre chose que ce qu'on croit.
    if (ligne.split(de).length - 1 !== 1) continue;
    out.push({
      avant: ligne,
      apres: ligne.replace(de, vers),
      quoi: `${de.trim()} → ${vers.trim()}`,
    });
  }
  // `??` : le repli sur ABSENCE devient un repli sur FAUSSETÉ — mais seulement
  // là où les deux peuvent différer (voir `REPLI_QUI_MORD`).
  if (ligne.split(' ?? ').length - 1 === 1) {
    const apresRepli = ligne.slice(ligne.indexOf(' ?? ') + 4);
    if (REPLI_QUI_MORD.test(apresRepli)) {
      out.push({
        avant: ligne,
        apres: ligne.replace(' ?? ', ' || '),
        quoi: '?? → ||',
      });
    }
  }
  // `instanceof` : la classe de droite s'élargit, la garde cesse de trier.
  const m = / instanceof ([A-Za-z_$][\w$]*)/.exec(ligne);
  if (m !== null && ligne.split(' instanceof ').length - 1 === 1 && m[1] !== CLASSE_LA_PLUS_LARGE) {
    out.push({
      avant: ligne,
      apres: ligne.replace(` instanceof ${m[1]}`, ` instanceof ${CLASSE_LA_PLUS_LARGE}`),
      quoi: `instanceof ${m[1]} → instanceof ${CLASSE_LA_PLUS_LARGE}`,
    });
  }
  return out;
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
      for (const m of mutationsDeLigne(ligne)) out.push({ fichier, ...m });
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
// ─── L'EXCLUSIVITÉ, ET POURQUOI ELLE EST CÂBLÉE PLUTÔT QUE PROMISE ───────────
//
// La loupe MUTE l'arbre : elle écrit une ligne fausse, lance la suite, restaure.
// Deux loupes dans le même atelier se marchent donc littéralement dessus —
// l'une restaure pendant que l'autre mesure — et les verdicts des DEUX perdent
// toute valeur. Pas « à moitié faux » : sans valeur, puisqu'on ne sait plus
// quelle version du fichier a été éprouvée.
//
// C'est au carnet (§ 2 unvicies) depuis qu'une première collision a fait jeter
// un balayage entier : refaits seuls, les chiffres différaient (26 contre 30,
// 1 contre 2).
//
// La règle était donc connue, écrite, et chèrement apprise. Elle a quand même
// été enfreinte le soir même — un balayage large lancé en tâche de fond, puis
// une seconde loupe dans le même atelier pour valider une PR, parce qu'entre
// les deux on ne pense plus au processus qu'on ne voit pas.
//
// C'est le motif que ce dépôt passe la nuit à corriger ailleurs : UNE RÈGLE QUE
// RIEN N'APPLIQUE FINIT PAR ÊTRE ENFREINTE, et la discipline de celui qui l'a
// écrite n'y change rien — elle rend seulement la faute plus vexante. On ne se
// promet donc pas de faire attention : on câble la garde.

/**
 * L'âge au-delà duquel un verrou est réputé ABANDONNÉ.
 *
 * Un verrou sans péremption est pire que pas de verrou : une loupe tuée au
 * clavier bloquerait l'atelier jusqu'à ce que quelqu'un devine qu'il faut
 * supprimer un fichier dont il ignore l'existence.
 *
 * Deux heures : très au-delà du balayage le plus long observé (une quinzaine de
 * minutes), très en-deçà d'une session de travail.
 */
export const VERROU_PERIME_MS = 2 * 60 * 60 * 1000;

/**
 * Le verrou est-il libre ?
 *
 * `vivant` est INJECTÉ plutôt que lu : savoir si un pid tourne est un accès
 * système, et le passer en paramètre est ce qui permet d'éprouver les quatre
 * branches sans jamais lancer — ni tuer — un vrai processus.
 *
 * L'ÂGE EST JUGÉ AVANT LE PID, et l'ordre compte : un pid RECYCLÉ par le
 * système désignerait un processus étranger bien vivant, et l'atelier resterait
 * bloqué sur un verrou que plus personne ne tient.
 */
export function jugerVerrou(brut, maintenant, vivant) {
  if (brut === null || brut.trim() === '') return { libre: true };
  let v;
  try {
    v = JSON.parse(brut);
  } catch {
    return { libre: true, motif: 'illisible' };
  }
  if (typeof v !== 'object' || v === null) return { libre: true, motif: 'illisible' };
  const { pid, depuis } = v;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { libre: true, motif: 'illisible' };
  }
  if (typeof depuis !== 'number' || !Number.isFinite(depuis)) {
    return { libre: true, motif: 'illisible' };
  }
  if (maintenant - depuis > VERROU_PERIME_MS) return { libre: true, motif: 'perime', pid };
  return vivant(pid) ? { libre: false, motif: 'tenu', pid } : { libre: true, motif: 'perime', pid };
}

/**
 * Ce qu'on dit à celui qui arrive second.
 *
 * Un refus qui ne dit pas quoi faire transforme une garde en énigme : le
 * réflexe suivant serait de supprimer le fichier au hasard, ce qui rétablit
 * exactement le défaut que le verrou existe pour empêcher.
 */
export function refusExclusivite(pid) {
  return (
    `LOUPE : une autre loupe tourne déjà dans cet atelier (pid ${pid}).\n` +
    '        Deux loupes qui mutent le même arbre ne rendent AUCUN verdict\n' +
    '        valable : l’une restaure pendant que l’autre mesure (§ 2 unvicies).\n' +
    '        Attendez qu’elle finisse, ou arrêtez-la, puis relancez.'
  );
}

/** Le contenu du verrou. Sérialisé ici pour que le format ait UN seul auteur. */
export function contenuVerrou(pid, maintenant) {
  return JSON.stringify({ pid, depuis: maintenant });
}

/** Le pid tourne-t-il ? `kill(pid, 0)` ne tue rien : il teste l'existence. */
function pidVivant(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = il existe mais ne nous appartient pas. Il est donc VIVANT.
    return e?.code === 'EPERM';
  }
}

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
  // LA GARDE, CÂBLÉE. Voir l'en-tête de `jugerVerrou` : la règle existait déjà
  // au carnet et a quand même été enfreinte, faute de quoi que ce soit pour
  // l'appliquer.
  const verrou = path.join(RACINE, '.loupe-verrou');
  let brut = null;
  try {
    brut = readFileSync(verrou, 'utf8');
  } catch {
    // Pas de verrou : personne ne tient l'atelier.
  }
  const v = jugerVerrou(brut, Date.now(), pidVivant);
  if (!v.libre) {
    console.error(refusExclusivite(v.pid));
    process.exit(2);
  }
  writeFileSync(verrou, contenuVerrou(process.pid, Date.now()));
  // Retiré quoi qu'il arrive — y compris sur `process.exit()`, que ce script
  // appelle à chaque issue. `unlinkSync` peut échouer si quelqu'un l'a déjà
  // supprimé : ce n'est pas une raison de faire échouer la loupe.
  process.on('exit', () => {
    try {
      unlinkSync(verrou);
    } catch {
      /* déjà parti */
    }
  });

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
