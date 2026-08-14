// CE QUE LA LOUPE SAIT MUTER — ET CE QU'ELLE NE VOYAIT PAS.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// La loupe ne mutait que des opérateurs binaires de comparaison (`&&`, `>=`,
// `<=`, `===`, `!==`). Un lot dont la garde centrale était
//
//     if (e instanceof TypeError)
//
// — le tri entre « le serveur a répondu et refusé » et « personne n'a répondu »
// — lui a donc rendu UN SEUL candidat, et pas celui-là. Elle a imprimé « LA
// LOUPE NE VOIT RIEN DE NU » sur un diff dont la seule vraie décision n'avait
// jamais été mutée.
//
// C'est le défaut que la loupe existe pour traquer, commis par la loupe : un
// verdict rassurant rendu sans avoir regardé. Et l'angle mort n'était pas
// anecdotique — le dépôt compte 79 `instanceof` en production.
//
// ─── POURQUOI CETTE LOGIQUE EST DEVENUE UNE FONCTION EXPORTÉE ────────────────
//
// Elle vivait enfouie dans `candidates()`, qui lit le disque et le dépôt : donc
// intestable sans monter un faux dépôt. « Hors d'atteinte du banc » est presque
// toujours « au mauvais endroit » (§ 2 quaterdecies). Sortie en
// `mutationsDeLigne(ligne)`, PURE, elle s'éprouve ligne par ligne — et la règle
// de sûreté qui compte (ne jamais muter une ligne ambiguë) s'éprouve avec elle.

import { describe, expect, it } from 'vitest';
import { mutationsDeLigne } from '../scripts/loupe.mjs';

/** Les libellés des mutations proposées pour une ligne. */
const quoi = (ligne) => mutationsDeLigne(ligne).map((m) => m.quoi);

describe('la loupe sait muter un tri par `instanceof`', () => {
  it('l’angle mort d’origine est fermé : la garde du sondage produit un candidat', () => {
    // La ligne EXACTE qui n'avait produit aucun candidat.
    const ligne = '  if (e instanceof TypeError) {';
    const m = mutationsDeLigne(ligne);
    expect(m.length, 'aucune mutation proposée — l’angle mort est rouvert').toBe(1);
    expect(m[0].apres).toBe('  if (e instanceof Object) {');
    expect(m[0].quoi).toBe('instanceof TypeError → instanceof Object');
  });

  it('la mutation ÔTE le tri, elle ne casse pas la forme', () => {
    // Ce qu'on mesure : la garde cesse de DISTINGUER (tout objet passe), sans
    // qu'un caractère de syntaxe bouge. Une mutation qui casserait la syntaxe
    // ferait échouer toute la suite et passerait pour un mutant tué.
    const ligne = '    return e instanceof Error ? e.message : String(e);';
    const [m] = mutationsDeLigne(ligne);
    expect(m.apres).toBe('    return e instanceof Object ? e.message : String(e);');
  });

  it('une garde DÉJÀ la plus large ne se mute pas — le mutant serait identique', () => {
    // `instanceof Object` → `instanceof Object` ne changerait rien : un mutant
    // qui ne peut pas rougir est du décor, exactement ce que la loupe traque.
    expect(quoi('  if (v instanceof Object) {')).toEqual([]);
  });

  it('deux `instanceof` sur une ligne : on s’abstient plutôt que de deviner', () => {
    // La règle de sûreté de la loupe : si l'on ne sait pas LEQUEL on a muté, le
    // verdict porterait sur autre chose que ce qu'on croit.
    expect(quoi('  const x = a instanceof Foo && b instanceof Bar;')).toEqual(['&& → ||']);
  });

  it('un mot qui CONTIENT « instanceof » ne déclenche rien', () => {
    // Sans les espaces autour, `monInstanceofBidon` serait une cible : la loupe
    // muterait un identifiant et casserait le fichier.
    expect(quoi('  const monInstanceofBidon = 1;')).toEqual([]);
  });
});

describe('une borne se mute DANS LES DEUX SENS — resserrer ET relâcher', () => {
  // ─── L'ASYMÉTRIE QUE CE BANC FERME ──────────────────────────────────────────
  //
  // La table allait dans un seul sens : `>=` → `>` et `<=` → `<`, qui RESSERRENT
  // une borne. Les échanges inverses — ceux qui la RELÂCHENT — n'existaient pas,
  // alors que `===` ↔ `!==` était bien symétrique.
  //
  // Ce n'est pas une lacune théorique. Le carnet raconte `aSupprimer`, le geste
  // le plus irréversible du dépôt (il appelle le fournisseur pour effacer une
  // machine) : `s.arreteA > 0` muté en `>= 0` faisait entrer une ligne
  // incohérente — état « arrêté », aucune date d'arrêt — dans les candidates à
  // l'effacement DÉFINITIF, et immédiatement, puisque `now - 0` dépasse toute
  // rétention. Cette mutation-là a été posée À LA MAIN : la loupe ne savait pas
  // la produire, et ne le saurait toujours pas.
  //
  // Le sens qui relâche est le plus dangereux des deux. Resserrer une borne fait
  // refuser du travail légitime — ça se voit. La relâcher fait ACCEPTER ce qui
  // devait être refusé, et personne ne vient s'en plaindre.

  it('`>` se relâche en `>=` — le sens qui laisse passer', () => {
    expect(quoi('    if (s.arreteA > 0) {')).toEqual(['> → >=']);
  });

  it('`<` se relâche en `<=` — l’écart d’une unité des boucles et des plafonds', () => {
    expect(quoi('    for (let i = 0; i < n; i++) {')).toEqual(['< → <=']);
  });

  it('`||` se resserre en `&&`, comme `&&` se relâche en `||`', () => {
    // Un refus écrit `if (a || b) refuser` ne refuserait plus que sur les DEUX
    // à la fois : une porte qui s'entrouvre sans que la forme bouge.
    expect(quoi('  if (a || b) {')).toEqual(['|| → &&']);
  });

  it('les bornes déjà larges ne produisent QU’UN candidat, pas une boucle', () => {
    // `>= → >` puis `> → >=` reviendrait au point de départ. Chaque ligne ne doit
    // proposer qu'un seul échange par opérateur présent, sinon la loupe
    // mesurerait deux fois la même chose et gonflerait son propre verdict.
    expect(quoi('  if (a >= b) {')).toEqual(['>= → >']);
    expect(quoi('  if (a <= b) {')).toEqual(['<= → <']);
  });

  it('`=>` n’est PAS un `>` — une flèche ne se mute pas', () => {
    // Piège de forme : sans l'espace à gauche, `=> ` contiendrait la cible et la
    // loupe transformerait toutes les fonctions fléchées en code invalide. Une
    // mutation qui casse la syntaxe fait échouer la suite entière et passe pour
    // un mutant tué — la loupe mentirait dans le sens rassurant.
    expect(quoi('  const f = (x) => x;')).toEqual([]);
  });

  it('`>=` n’est pas lu comme un `>` — sinon l’un mangerait l’autre', () => {
    // ` >= ` ne contient pas ` > ` (le `>` y est suivi d'un `=`, pas d'un
    // espace). Si c'était le cas, une même ligne rendrait deux mutations dont
    // l'une casserait la syntaxe (`a >== b`).
    const m = mutationsDeLigne('  if (a >= b) {');
    expect(m.length).toBe(1);
    expect(m[0].apres).toBe('  if (a > b) {');
  });
});

describe('`??` ne se mute QUE là où il peut mordre — un repli TRUTHY', () => {
  // ─── L'OPÉRATEUR A D'ABORD ÉTÉ TROP LARGE, ET ÇA S'EST MESURÉ ───────────────
  //
  // `a ?? b` ne prend `b` que si `a` est `null`/`undefined` ; `a || b` le prend
  // AUSSI sur `0`, `''`, `false`. Le premier jet mutait donc TOUS les `??`.
  //
  // Résultat mesuré sur un balayage à base épinglée : 12 désignations neuves,
  // dont DIX équivalentes — parce que le TYPE interdisait le cas :
  //
  //     antecedents.get(k) ?? { … }   un objet n'est jamais falsy
  //     n.modeles ?? []               un tableau non plus
  //     row?.echelon ?? null          l'union de trois littéraux non vides
  //     essais ?? 0                   la valeur falsy possible EST le repli
  //     c?.actif ?? false             `false || false` vaut `false`
  //
  // La loupe ne voit pas les types : elle aurait re-désigné ces dix à CHAQUE
  // passe, et son verdict serait rouge pour toujours. Un instrument qui ne peut
  // plus rendre vert n'est plus une porte, c'est un mur — et personne ne lit un
  // mur (voir son en-tête : le pire mensonge est celui qui rassure, mais un
  // verdict qui crie sans cesse ne se lit plus du tout).
  //
  // ─── LA RESTRICTION, ET POURQUOI ELLE EST SÛRE ──────────────────────────────
  //
  // On ne mute que si le repli est un littéral TRUTHY primitif : `true`, ou un
  // nombre non nul. Là, une valeur « fausse mais présente » à gauche est
  // remplacée par quelque chose de DIFFÉRENT, donc la mutation mord toujours.
  //
  // Ce que ça garde, sur ce dépôt (707 `??` en production) :
  //
  //     nodeOnShift.get(n.id) ?? true   une ouvrière HORS SERVICE redevient
  //                                     disponible — la garde échoue en
  //                                     s'OUVRANT ;
  //     opts.uid ?? 1000                `uid` 0 est ROOT : le conteneur
  //                                     changerait d'utilisateur en silence ;
  //     code ?? 1                       un code de sortie 0 (succès) devient
  //                                     1 (échec) — famille § 9 quaterdecies ;
  //     config.tickMs ?? 2_000          un 0 explicite écrasé par le défaut.
  //
  // ─── CE QU'ELLE PERD, ET IL FAUT LE DIRE ────────────────────────────────────
  //
  // `x ?? null` mord VRAIMENT si `x` peut être la chaîne vide — mais seul le
  // type le dit, et la loupe ne l'a pas. On préfère rater ce cas plutôt que
  // noyer chaque passe sous 107 désignations dont on ne saura rien. Un repli
  // `0.5` est perdu aussi (le motif exige un premier chiffre non nul).

  it('`?? true` se mute — la garde qui échoue en s’ouvrant', () => {
    expect(quoi('    const service = nodeOnShift.get(id) ?? true;')).toEqual(['?? → ||']);
  });

  it('un repli NOMBRE NON NUL se mute — le zéro explicite écrasé par le défaut', () => {
    expect(quoi('  const limite = req.query.limit ?? 200;')).toEqual(['?? → ||']);
    // Les séparateurs de milliers ne doivent pas casser la reconnaissance.
    expect(quoi('  const tick = config.tickMs ?? 2_000;')).toEqual(['?? → ||']);
  });

  it('la mutation garde la forme : un seul jeton change', () => {
    const [m] = mutationsDeLigne('    `--user=${opts.uid ?? 1000}`,');
    expect(m.apres).toBe('    `--user=${opts.uid || 1000}`,');
  });

  it('LES REPLIS QUI NE PEUVENT PAS MORDRE NE SONT PAS DÉSIGNÉS', () => {
    // Chacun a été mesuré équivalent sur un vrai balayage ; les re-désigner à
    // chaque passe ne coûterait pas seulement du bruit, ça rendrait le verdict
    // rouge à perpétuité.
    expect(quoi('  const a = antecedents.get(k) ?? { essais: 0 };'), 'objet').toEqual([]);
    expect(quoi('  for (const m of n.modeles ?? []) union.add(m);'), 'tableau').toEqual([]);
    expect(quoi('  return row?.echelon ?? null;'), 'null').toEqual([]);
    expect(quoi('  const n = a?.essais ?? 0;'), 'zéro = le repli').toEqual([]);
    expect(quoi('  actif: c?.actif ?? false,'), 'faux ou faux').toEqual([]);
    expect(quoi('  const s = brut ?? autreChose;'), 'expression : type inconnu').toEqual([]);
  });

  it('`??=` n’est PAS un `??` — l’affectation ne se mute pas', () => {
    // Piège de forme : ` ??= ` ne contient pas ` ?? ` (le second `?` y est suivi
    // d'un `=`). Sans cette précaution la loupe écrirait `a ||= b` — valide en
    // JavaScript, donc SILENCIEUX, et le verdict porterait sur autre chose.
    expect(quoi('  compteurs[cle] ??= 1;')).toEqual([]);
  });

  it('deux `??` sur une ligne : on s’abstient, comme partout ailleurs', () => {
    expect(quoi('  const x = a ?? 1 ?? 2;')).toEqual([]);
  });
});

describe('les échanges d’origine tiennent toujours', () => {
  it('les cinq opérateurs binaires sont toujours proposés', () => {
    expect(quoi('  if (a && b) {')).toEqual(['&& → ||']);
    expect(quoi('  if (a >= b) {')).toEqual(['>= → >']);
    expect(quoi('  if (a <= b) {')).toEqual(['<= → <']);
    expect(quoi('  if (a === b) {')).toEqual(['=== → !==']);
    expect(quoi('  if (a !== b) {')).toEqual(['!== → ===']);
  });

  it('un opérateur présent DEUX fois ne se mute pas', () => {
    expect(quoi('  if (a === b && c === d) {')).toEqual(['&& → ||']);
  });

  it('une ligne sans opérateur connu ne propose rien', () => {
    expect(quoi('  const x = 1;')).toEqual([]);
  });
});

// ─── CE QU'ELLE REFUSE DE MUTER, ET POURQUOI ELLE A DÛ L'APPRENDRE ────────────
//
// Un balayage a muté la garde de point d'entrée de `scripts/tamis-ordres.mjs` —
// celle qui empêche le fichier de s'exécuter à l'import :
//
//     if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(…))
//
// `&&` devenu `||`, et sous vitest `process.argv[1]` est toujours vrai : la
// garde tire À L'IMPORT. Le test qui importe `principal` a donc fait ce que ce
// fichier fait — relancer la suite ENTIÈRE trois fois — et chacune des trois a
// réimporté le même module muté.
//
// Mesuré : charge moyenne 57, une soixantaine de vitest vivants, des processus
// de onze minutes. Le butoir de 15 minutes de la loupe n'y peut rien : le
// `timeout` d'`execFileSync` tue l'enfant DIRECT, jamais sa descendance.
//
// La règle qui en sort n'est pas « exclure ce fichier » mais « ne pas muter ce
// qui décide QU'ON S'EXÉCUTE » — c'est une propriété du harnais, pas du code
// sous examen, et le mutant n'est jamais un signal utile.

describe('LA LOUPE NE MUTE PAS CE QUI DÉCIDE QU’ON S’EXÉCUTE', () => {
  it('la ligne EXACTE qui a noyé la machine ne produit plus rien', () => {
    expect(
      quoi(
        'if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {',
      ),
    ).toEqual([]);
  });

  it('la forme en deux temps du dépôt — `MOI` contre `LANCE` — est refusée aussi', () => {
    // `compte-tests.mjs` et `loupe.mjs` s'écrivent ainsi. La comparaison seule
    // ne porte NI `import.meta.url` NI `process.argv[1]` : sans cette seconde
    // règle, elles resteraient mutables.
    expect(quoi('if (MOI === LANCE) {')).toEqual([]);
    expect(quoi('if (MOI !== LANCE) {')).toEqual([]);
  });

  it('les deux LIGNES DE DÉFINITION de la garde sont refusées avec elle', () => {
    // Muter `LANCE` changerait la même décision par un autre bout.
    expect(
      quoi("const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);"),
    ).toEqual([]);
  });

  it('LE REFUS RESTE ÉTROIT : une ligne ordinaire garde ses candidats', () => {
    // Une garde trop large désarmerait la loupe en silence — c'est le défaut
    // qu'elle existe pour trouver. `MOI` seul, ou `LANCE` seul, ne suffit pas.
    expect(quoi('  if (moi === lance) {')).toEqual(['=== → !==']);
    expect(quoi('  if (MOI === autre) {')).toEqual(['=== → !==']);
    expect(quoi('  if (a === b) {')).toEqual(['=== → !==']);
  });
});

// ─── CE QUE LA LOUPE NE DOIT PAS MUTER : SA PROPRE PROSE ─────────────────────
//
// Un mutant posé dans un COMMENTAIRE ne peut pas être tué — le texte ne
// s'exécute pas. La suite reste verte, et la loupe imprime « CODE NEUF QUE RIEN
// NE DÉFEND » sur une phrase française. C'est le mensonge ALARMANT : il ne
// cache rien, mais il coûte une exécution de suite entière par occurrence et il
// salit un verdict qu'on lit pour décider de fusionner.
//
// LE FILTRE RATAIT LA FORME LA PLUS COURANTE DU TABLEAU DE BORD. Mesuré le
// 13 août sur `dashboard/src` (72 candidates, 72 examinées) : sur dix
// survivants, TROIS étaient des lignes de commentaire JSX de `Balance.tsx` —
// et précisément les trois lignes qui CONSIGNENT une équivalence trouvée par un
// balayage précédent. La loupe s'est dénoncée en relisant sa propre note.

import { ligneMutable } from '../scripts/loupe.mjs';

describe('la loupe ne mute pas les commentaires — y compris ceux du JSX', () => {
  it('LE CAS QUI A ÉTÉ MESURÉ : `{/*` ouvre un commentaire JSX, pas du code', () => {
    // Les trois lignes RÉELLES rendues survivantes par le balayage du 13 août.
    expect(
      ligneMutable('          {/* ─── ÉQUIVALENCE CONSIGNÉE : `cible !== null` ne peut pas'),
      'la ligne d’ouverture d’un commentaire JSX ne doit jamais être mutée',
    ).toBe(false);
  });

  it('les formes déjà connues restent refusées — la garde ne s’est pas déplacée', () => {
    expect(ligneMutable('  // un commentaire de ligne')).toBe(false);
    expect(ligneMutable('   * une continuation de bloc')).toBe(false);
    expect(ligneMutable('  /* un bloc ouvert */')).toBe(false);
    expect(ligneMutable('   ')).toBe(false);
    expect(ligneMutable('')).toBe(false);
  });

  it('LE REFUS RESTE ÉTROIT : du code qui commence par `{` garde sa place', () => {
    // Une garde trop large écarterait du code RÉEL — le mensonge rassurant,
    // celui qui cache. `{` seul ne dit rien ; c'est `{/*` qui tranche.
    expect(ligneMutable('  { valeur: a === b },')).toBe(true);
    expect(ligneMutable('  if (a === b) {')).toBe(true);
    expect(ligneMutable('  {liste.map((x) => x.id === actif && <li />)}')).toBe(true);
  });
});

// ─── LE MARQUEUR DE COMMENTAIRE DÉPEND DU LANGAGE ────────────────────────────
//
// La garde `{/*` ci-dessus a été posée en regardant du JSX. Le balayage suivant,
// sur `scripts/` (46 candidates, 46 examinées), a rendu une ligne de commentaire
// SHELL comme « code neuf que rien ne défend » :
//
//     # < 60 s ») avait été mesuré sur un dépôt DÉJÀ cloné
//
// `scripts/` est dans le périmètre par défaut depuis toujours, et il contient du
// shell. Le filtre n'avait jamais connu qu'une famille de langages : la première
// correction réparait l'instance sous les yeux, pas la classe.
//
// LES DEUX SENS DE L'ERREUR SONT ÉPROUVÉS ICI, et ce n'est pas symétrique :
// rater un commentaire shell coûte une suite entière pour rien (mensonge
// ALARMANT) ; écarter un champ privé `#compteur` cacherait une garde réelle
// (mensonge RASSURANT, le pire). Le second banc est donc le plus important.

describe('le marqueur de commentaire suit le langage du fichier', () => {
  it('LE CAS MESURÉ : `#` commente en shell — la ligne n’est pas mutable', () => {
    const ligne = '# < 60 s ») avait été mesuré sur un dépôt DÉJÀ cloné';
    expect(ligneMutable(ligne, 'scripts/essai-installation.sh')).toBe(false);
    expect(ligneMutable('  # commentaire indenté', 'scripts/x.ps1')).toBe(false);
    expect(ligneMutable('# clé: valeur', '.github/workflows/ci.yml')).toBe(false);
  });

  it('L’AUTRE SENS, CELUI QUI CACHE : `#` porte du CODE en TypeScript', () => {
    // `#compteur` est un champ privé. L’écarter tairait une garde réelle —
    // exactement le mensonge rassurant que la loupe existe pour empêcher.
    expect(ligneMutable('  #total = a === b;', 'src/orchestrator/store.ts')).toBe(true);
    expect(ligneMutable('  #total = a === b;', 'dashboard/src/api.ts')).toBe(true);
  });

  it('un fichier INCONNU retombe sur la famille C/JS, la plus prudente', () => {
    // Sans extension connue, on ne suppose pas que `#` commente.
    expect(ligneMutable('  #champ = 1;', 'scripts/machin')).toBe(true);
    expect(ligneMutable('  // vrai commentaire', 'scripts/machin')).toBe(false);
  });

  it('la garde JSX tient toujours, quel que soit le fichier', () => {
    expect(ligneMutable('  {/* consigné */}', 'dashboard/src/views/Balance.tsx')).toBe(false);
    expect(ligneMutable('  if (a === b) {', 'scripts/essai-installation.sh')).toBe(true);
  });
});

// ─── UNE ÉQUIVALENCE DÉJÀ TRANCHÉE NE SE REJUGE PAS À CHAQUE PASSE ───────────
//
// Un balayage de `src/orchestrator` (54 candidates, 54 examinées) a rendu SIX
// survivants. Les six étaient déjà tranchés et consignés sur place, avec leur
// raisonnement mesuré — et quatre fichiers portaient littéralement la même
// phrase : « un balayage élargi le re-signalera sans test à chaque fois ».
//
// La connaissance existait, au bon endroit, et l'instrument ne savait pas la
// lire. Chaque passe redemandait donc six jugements humains identiques.
//
// CE N'EST PAS UNE LISTE D'EXCLUSION, et les bancs ci-dessous sont écrits pour
// que ça reste vrai : la mutation est jouée quand même (la marque épargne le
// jugement, pas la mesure), et une marque fausse se dénonce toute seule. La
// marque ne peut donc rendre un verdict que PLUS alarmant, jamais plus
// rassurant — le sens de l'erreur est choisi, pas subi.

import { marqueeEquivalente } from '../scripts/loupe.mjs';

describe('la marque d’équivalence nomme SA mutation, pas seulement sa ligne', () => {
  it('LE DÉFAUT QUI A ÉTÉ MESURÉ : une ligne porte PLUSIEURS mutants', () => {
    // `tableau.ts` en porte trois : `||`, `<`, `===`. La consignation n'en juge
    // qu'un équivalent ; les deux autres sont tués par la suite, ce qui est
    // sain. Une marque de LIGNE les couvrait tous et faisait crier au loup sur
    // deux mutants défendus. L'unité de jugement est la MUTATION.
    const ligne = '  for (const a of alertes) if (pire === null || RANG[a] < RANG[pire]) pire = a;';
    const contenu = ['  // loupe : équivalent — < → <=', ligne].join('\n');
    expect(marqueeEquivalente(contenu, ligne, '< → <='), 'le mutant NOMMÉ est couvert').toBe(true);
    expect(marqueeEquivalente(contenu, ligne, '|| → &&'), 'les autres ne le sont PAS').toBe(false);
    expect(marqueeEquivalente(contenu, ligne, '=== → !=='), 'les autres ne le sont PAS').toBe(
      false,
    );
  });

  it('sans marque, une ligne reste un survivant ordinaire', () => {
    const contenu = [
      '  // un commentaire qui explique autre chose',
      '  if (a === b) return 1;',
    ].join('\n');
    expect(marqueeEquivalente(contenu, '  if (a === b) return 1;', '=== → !==')).toBe(false);
  });

  it('LA REMONTÉE S’ARRÊTE AU PREMIER CODE — une marque ne couvre pas un bloc', () => {
    // Sans cet arrêt, une garde neuve insérée sous une consignation naîtrait
    // marquée sans que personne l'ait jugée. C'est la porte par laquelle une
    // vraie nudité entrerait pour de bon.
    const contenu = [
      '  // loupe : équivalent — === → !==',
      '  const x = a === b;',
      '  if (c === d) return 2;',
    ].join('\n');
    expect(marqueeEquivalente(contenu, '  const x = a === b;', '=== → !==')).toBe(true);
    expect(
      marqueeEquivalente(contenu, '  if (c === d) return 2;', '=== → !=='),
      'la seconde ligne n’est PAS couverte',
    ).toBe(false);
  });

  it('une ligne VIDE coupe aussi la remontée', () => {
    const ligne = '  if (a === b) return 1;';
    const contenu = ['  // loupe : équivalent — === → !==', '', ligne].join('\n');
    expect(marqueeEquivalente(contenu, ligne, '=== → !==')).toBe(false);
  });

  it('une ligne INTROUVABLE n’est jamais réputée marquée', () => {
    // Ne pas retrouver la ligne est déjà anormal ; répondre « marquée » sur une
    // inconnue serait la pire des deux réponses possibles.
    expect(marqueeEquivalente('  if (a === b) return 1;', '  absente();', '=== → !==')).toBe(false);
  });

  it('un libellé de mutant ABSENT ne peut rien couvrir', () => {
    const ligne = '  if (a === b) return 1;';
    const contenu = ['  // loupe : équivalent — === → !==', ligne].join('\n');
    expect(marqueeEquivalente(contenu, ligne, ''), 'chaîne vide').toBe(false);
    expect(marqueeEquivalente(contenu, ligne, undefined), 'rien du tout').toBe(false);
  });

  it('la marque tolère la casse et les espaces, pas l’à-peu-près', () => {
    const ligne = '  if (a === b) return 1;';
    const marquee = (tete) => marqueeEquivalente([tete, ligne].join('\n'), ligne, '=== → !==');
    expect(marquee('  // LOUPE:ÉQUIVALENT — === → !==')).toBe(true);
    expect(marquee('  // loupe   :   équivalent — === → !==')).toBe(true);
    expect(marquee('  // ce mutant est équivalent — === → !=='), 'le mot seul ne suffit pas').toBe(
      false,
    );
    expect(marquee('  // loupe : équivalent'), 'nommer l’instrument ne suffit pas non plus').toBe(
      false,
    );
  });
});

describe('la marque voyage avec le LANGAGE du fichier, pas seulement le texte', () => {
  const LIGNE = 'tail -30 "$CIBLE/ruche.log" >&2 2>/dev/null || true';
  const CONTENU = ['# loupe : équivalent — || → &&', LIGNE].join('\n');

  it('LE CAS MESURÉ : dans un `.sh`, `#` commente — la remontée le traverse', () => {
    // Sans le nom du fichier, `#` passe pour du code et la remontée s'arrête
    // SUR la marque qu'elle cherche. La marque était donc inopérante en shell,
    // et `scripts/` est dans le périmètre par défaut depuis le premier jour.
    expect(marqueeEquivalente(CONTENU, LIGNE, '|| → &&', 'scripts/essai-installation.sh')).toBe(
      true,
    );
  });

  it('sans le nom du fichier, la marque shell reste hors d’atteinte — et c’est normal', () => {
    // On ne DEVINE pas le langage : un `#` en tête de ligne porte du code dans
    // la famille C/JS (`#compteur` est un champ privé). Le défaut est prudent.
    expect(marqueeEquivalente(CONTENU, LIGNE, '|| → &&')).toBe(false);
  });

  it('et un `#` dans un fichier TypeScript ne devient pas un commentaire par magie', () => {
    const ligne = '  if (a === b) return 1;';
    const contenu = ['  #loupe : équivalent — === → !==', ligne].join('\n');
    expect(marqueeEquivalente(contenu, ligne, '=== → !==', 'src/x.ts')).toBe(false);
  });
});

// ─── LE LANGAGE AVANT LA LIGNE ───────────────────────────────────────────────
//
// Un balayage de `dashboard/src/views` a rendu ceci parmi ses survivants :
//
//     🔴 SANS TEST · dashboard/src/views/balance.css · > → >=
//                  .bal-noeuds > summary {
//
// En CSS, `>` est le COMBINATEUR ENFANT, pas une comparaison. Muté en `>=`, le
// sélecteur ne s'analyse plus et le navigateur jette la règle — la FORME casse,
// or l'en-tête de la loupe garantit l'inverse. Et comme aucun banc ne lit de
// feuille de style, rien ne rougit : le mutant n'est ni tué ni tuable.
//
// La § 2.16 ter ne laisse que deux issues à un survivant — écrire le test, ou
// consigner l'équivalence. Celui-ci n'a ni l'une (vitest ne lit pas le CSS) ni
// l'autre (la règle disparaît vraiment). Un survivant sans issue revient à
// chaque passe et ne s'éteint jamais : c'est le faux rouge perpétuel.

import { langageMutable } from '../scripts/loupe.mjs';

describe('la loupe ne mute que les langages où ces jetons sont des opérateurs', () => {
  it('LE CAS QUI TRANCHE : une feuille de style n’est pas mutée', () => {
    // `.bal-noeuds > summary` muté en `>=` casse le sélecteur. Le mutant
    // survivrait à jamais, sans qu'aucune des deux issues soit ouverte.
    expect(langageMutable('dashboard/src/views/balance.css')).toBe(false);
    expect(langageMutable('dashboard/src/views/partage.css')).toBe(false);
  });

  it('LE SECOND CAS QUI TRANCHE : le code, lui, reste sous la lame', () => {
    // La garde est un REFUS, pas une admission. Si elle s'inversait, elle
    // écarterait tout le code du dépôt en rendant la loupe silencieusement
    // verte — le mensonge rassurant, celui que ce fichier existe pour empêcher.
    expect(langageMutable('src/orchestrator/server.ts')).toBe(true);
    expect(langageMutable('dashboard/src/views/Balance.tsx')).toBe(true);
    expect(langageMutable('scripts/amorce.mjs')).toBe(true);
    expect(langageMutable('scripts/essai-installation.sh')).toBe(true);
  });

  it('UN LANGAGE INCONNU EST MUTÉ — la liste refuse, elle n’admet pas', () => {
    // C'est la décision de conception, et son sens d'erreur est choisi : une
    // liste d'ADMISSION rendrait un `.py` ajouté demain invisible à la loupe,
    // sans rien dire et pour toujours. Une liste de REFUS le mute et rend un
    // survivant bruyant — qui se voit en dix secondes.
    expect(langageMutable('scripts/outil.py')).toBe(true);
    expect(langageMutable('src/moteur.rb')).toBe(true);
    expect(langageMutable('scripts/lanceur')).toBe(true);
  });

  it('les autres langages sans ces opérateurs sont nommés eux aussi', () => {
    // `>` cite en Markdown, `<` ouvre une balise en HTML/SVG, et JSON n'a aucun
    // opérateur du tout : muter n'y change jamais un SENS.
    for (const f of ['docs/A.md', 'site/index.html', 'src/x.json', 'site/logo.svg']) {
      expect(langageMutable(f), f).toBe(false);
    }
  });

  it('la casse de l’extension ne fait pas passer un fichier sous la lame', () => {
    expect(langageMutable('site/INDEX.HTML')).toBe(false);
    expect(langageMutable('dashboard/src/A.CSS')).toBe(false);
  });

  it('l’extension se lit à la FIN, pas au milieu du chemin', () => {
    // Un dossier nommé `css` ne fait pas de son contenu une feuille de style.
    expect(langageMutable('dashboard/src/css/theme.ts')).toBe(true);
    expect(langageMutable('src/md/rendu.tsx')).toBe(true);
  });
});
