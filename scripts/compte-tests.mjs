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
//
// ─── ET UN TROISIÈME LIEU, QU'ON NE CORRIGE SURTOUT PAS ──────────────────────
//
// Le tableau A de `docs/DEFINITION-DE-SORTIE.md` annonce lui aussi un compte —
// et c'est le SEUL document du dépôt dont le sujet soit la mesure. Il a pourtant
// été le dernier que la mesure ne touchait pas : le 16 août il annonçait encore
// 4071 bancs quand la suite en rendait 4249. Daté, relu, et faux (§ 9
// duoquadragicenties : une précaution qui repose sur la vigilance du lecteur est
// une dette, pas une garde).
//
// Il est donc CONSTATÉ ici, jamais RÉÉCRIT — et la distinction est le cœur du
// lot, pas un détail d'implémentation :
//
//   · un badge est un nombre qui doit SUIVRE la suite ; le corriger tout seul
//     est exactement ce qu'on attend de lui ;
//   · le tableau A est une MESURE DATÉE — son titre nomme un arbre et une
//     heure. En réécrire les chiffres sans retoucher cette provenance
//     produirait un tableau qui suit HEAD sous un titre qui nomme un autre
//     commit : le défaut d'origine, en pire, parce que l'outil l'AURAIT SIGNÉ.
//
// `--corriger` ne le répare donc pas. Il refuse, et il dit quoi refaire à la
// main : re-mesurer, réécrire les quatre nombres, et re-dater le titre.

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

/** Le seul fichier qu'on CONSTATE sans jamais le corriger. */
export const DEFINITION = 'docs/DEFINITION-DE-SORTIE.md';

/**
 * Les quatre nombres du tableau A, et le champ du rapport que chacun annonce.
 *
 * Ils se lisent avec la même mécanique que les badges — trois groupes, le
 * chiffre au milieu — mais ils ne partagent PAS leur liste : deux choses qui se
 * lisent pareil et s'écrivent différemment finissent par se corriger pareil.
 * `CIBLES` est ce qu'on répare, `CONSTATS` est ce qu'on refuse.
 *
 * Les ancres mordent sur la ligne du tableau, pas sur la prose : le document
 * raconte aussi ses anciens comptes (« 4071 sur l'arbre 90c1694 ») et une
 * couverture de « 10 803 / 14 250 ». Un motif plus lâche corrigerait l'histoire
 * du défaut en croyant corriger le défaut — chacun est vérifié UNIQUE par
 * `tests/compte-tests.test.mjs` (§ 9 unquadragicenties : un mutant s'était déjà
 * posé dans un commentaire faute d'ancre unique).
 */
export const CONSTATS = [
  {
    nom: 'DEFINITION-DE-SORTIE.md (total)',
    fichier: DEFINITION,
    motif: /(✅ \*\*)(\d[\d  ,]*)(\*\* \()/,
    champ: 'numTotalTests',
  },
  {
    nom: 'DEFINITION-DE-SORTIE.md (verts)',
    fichier: DEFINITION,
    motif: /(\*\* \()(\d[\d  ,]*)( verts,)/,
    champ: 'numPassedTests',
  },
  {
    nom: 'DEFINITION-DE-SORTIE.md (ignorés)',
    fichier: DEFINITION,
    motif: /( verts, )(\d[\d  ,]*)( ignorés)/,
    champ: 'numPendingTests',
  },
  {
    nom: 'DEFINITION-DE-SORTIE.md (rouges)',
    fichier: DEFINITION,
    motif: /( ignorés, \*\*)(\d[\d  ,]*)( rouge\*\*)/,
    champ: 'numFailedTests',
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
 * Les champs du rapport qu'on sait lire, et le PLANCHER de chacun.
 *
 * Le plancher n'est pas décoratif : il sépare « le rapport ne porte pas ce
 * nombre » de « ce nombre vaut zéro ». Une suite qui rend zéro test total est un
 * rapport cassé ; une suite qui rend zéro ÉCHEC est une suite verte. Les
 * confondre — un unique `> 0` pour tout le monde — ferait déclarer illisible le
 * seul rapport qu'on espère lire, et le « 0 rouge » du tableau A ne pourrait
 * jamais être gardé.
 */
export const COMPTES = {
  numTotalTests: 1,
  numPassedTests: 1,
  numPendingTests: 0,
  numFailedTests: 0,
};

/**
 * Le compte réel, lu dans le rapport JSON de vitest.
 *
 * On exige un ENTIER au-dessus de son plancher plutôt que « ce qui est là » : un
 * rapport tronqué rendrait `undefined`, `Number(undefined)` rend `NaN`, et toute
 * comparaison avec `NaN` est fausse — la garde passerait au vert sur un rapport
 * illisible. C'est la forme de faux vert que ce dépôt connaît le mieux.
 *
 * ─── UN CHAMP INCONNU JETTE, ET C'EST VOULU ─────────────────────────────────
 *
 * Première version : elle rendait `null`. La loupe a montré que la garde ne
 * gardait RIEN — sans elle, `plancher` vaut `undefined`, `n >= undefined` est
 * faux pour tout `n`, et la fonction rendait `null` par le chemin d'à côté.
 * Mutant équivalent, donc ligne décorative (§ 2.16 ter).
 *
 * Sauf que le `null` silencieux était lui-même le défaut : une faute de frappe
 * dans une cible se lisait « rapport vitest incomplet », c'est-à-dire un refus
 * JUSTE pour une raison FAUSSE, qui envoie chercher la panne dans le rapport
 * quand elle est dans la liste. C'est le défaut du docteur qui sondait le port 0,
 * et celui du client pris pour un service (§ 9 novemtrigicenties).
 *
 * Un champ absent de `COMPTES` n'est pas une donnée douteuse, c'est une faute de
 * programmation : elle se signale là où elle se corrige, tout de suite et fort.
 */
export function compteReel(rapport, champ = 'numTotalTests') {
  const plancher = COMPTES[champ];
  if (plancher === undefined) {
    throw new TypeError(
      `champ de rapport inconnu : « ${champ} » — les champs connus sont ${Object.keys(COMPTES).join(', ')}`,
    );
  }
  const n = rapport?.[champ];
  return Number.isInteger(n) && n >= plancher ? n : null;
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
 * Le verdict du tableau daté, PUR — et sans `aCorriger`, parce qu'il n'y a rien
 * à corriger : la seule issue est une re-mesure à la main.
 *
 * Le message ne dit pas « chiffre faux » mais ce qu'il faut REFAIRE, provenance
 * comprise. Un refus qui n'énonce que l'écart ferait retoucher les quatre
 * nombres et laisserait le titre nommer l'arbre précédent — le tableau
 * redeviendrait faux à l'endroit exact que ce lot ferme.
 *
 * @param {Array<{nom: string, annonce: number|null, reel: number|null}>} releves
 * @returns {{ok: boolean, message: string, aRemesurer: string[]}}
 */
export function verdictDesConstats(releves) {
  const illisibles = releves.filter((r) => r.reel === null).map((r) => r.nom);
  if (illisibles.length > 0) {
    return {
      ok: false,
      aRemesurer: [],
      message:
        `rapport vitest incomplet pour : ${illisibles.join(', ')}.\n` +
        'Le tableau A ne peut pas être confronté à un rapport qui ne porte pas ses quatre nombres.',
    };
  }
  const introuvables = releves.filter((r) => r.annonce === null).map((r) => r.nom);
  if (introuvables.length > 0) {
    return {
      ok: false,
      aRemesurer: [],
      message:
        `compte introuvable dans : ${introuvables.join(', ')}.\n` +
        `La ligne « Suite de bancs » de ${DEFINITION} a changé de forme.`,
    };
  }
  const faux = releves.filter((r) => r.annonce !== r.reel);
  if (faux.length === 0) {
    return { ok: true, aRemesurer: [], message: `le tableau A de ${DEFINITION} dit la mesure.` };
  }
  return {
    ok: false,
    aRemesurer: faux.map((r) => r.nom),
    message:
      `${DEFINITION} — le tableau A n’est plus une mesure :\n` +
      `${faux.map((r) => `  ${r.nom} : annoncé ${r.annonce}, mesuré ${r.reel}`).join('\n')}\n` +
      'À REFAIRE À LA MAIN, et « --corriger » ne le fera pas :\n' +
      '  1. réécrire les quatre nombres de la ligne « Suite de bancs » ;\n' +
      '  2. re-dater le titre de la section A, ARBRE COMPRIS.\n' +
      'Le second point est la raison du premier : des chiffres frais sous une\n' +
      'provenance périmée se lisent comme une mesure, et n’en sont pas une.',
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
  for (const c of [...CIBLES, ...CONSTATS]) {
    if (!sources.has(c.fichier)) {
      sources.set(c.fichier, readFileSync(path.join(racine, c.fichier), 'utf8'));
    }
  }

  const reel = compteReel(rapport);
  const v = verdict(
    reel,
    CIBLES.map((c) => ({ nom: c.nom, annonce: lire(sources.get(c.fichier) ?? '', c) })),
  );

  let mauvais = false;
  if (v.ok) {
    ecrire(`${v.message}\n`);
  } else if (corriger && v.aCorriger.length > 0) {
    for (const c of CIBLES.filter((c) => v.aCorriger.includes(c.nom))) {
      sources.set(c.fichier, reecrire(sources.get(c.fichier) ?? '', c, reel));
      ecrire(`${c.nom} : porté à ${groupe(reel, c.separateur)}\n`);
    }
    // ─── ON N'ÉCRIT QUE LES FICHIERS DES BADGES ──────────────────────────────
    //
    // loupe : équivalent — écrire toutes les `sources` rend les mêmes octets.
    //
    // La définition de sortie est lue mais jamais modifiée : la réécrire la
    // recopierait à l'identique, et aucun banc ne peut distinguer les deux
    // versions par le CONTENU. Consigné ici plutôt que défendu par un cas
    // (§ 2.16 ter) — un banc sur l'horodatage du fichier mesurerait la
    // granularité de l'horloge, pas la garde.
    //
    // La ligne reste écrite ainsi pour ce qu'elle empêche DEMAIN : le jour où
    // une cible corrigeable partagera un fichier avec un constat, « écrire tout
    // ce qu'on a lu » posera la main de `--corriger` sur le seul fichier auquel
    // il ne doit pas toucher.
    const corriges = new Set(
      CIBLES.filter((c) => v.aCorriger.includes(c.nom)).map((c) => c.fichier),
    );
    for (const fichier of corriges) {
      writeFileSync(path.join(racine, fichier), sources.get(fichier) ?? '', 'utf8');
    }
  } else {
    ecrire(`${v.message}\n`);
    mauvais = true;
  }

  // ─── ET LE TABLEAU DATÉ, QUI SE CONSTATE APRÈS COUP ────────────────────────
  //
  // Après les badges, et sans jamais dépendre d'eux : un tableau A périmé doit
  // barrer la livraison même quand les six badges sont justes — c'est
  // exactement la situation du 16 août, où ils l'étaient.
  const vc = verdictDesConstats(
    CONSTATS.map((c) => ({
      nom: c.nom,
      annonce: lire(sources.get(c.fichier) ?? '', c),
      reel: compteReel(rapport, c.champ),
    })),
  );
  // On l'écrit MÊME quand il passe : un contrôle dont le succès est invisible
  // est un contrôle dont on ne remarquera pas la disparition. Le journal de CI
  // doit montrer que le tableau a été regardé, pas seulement qu'il n'a pas crié.
  ecrire(`${vc.message}\n`);
  if (!vc.ok) mauvais = true;

  if (mauvais) sortir(1);
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
