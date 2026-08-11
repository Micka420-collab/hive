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

describe('`??` n’est pas `||` — le repli sur ABSENCE, muté en repli sur FAUSSETÉ', () => {
  // ─── POURQUOI CET OPÉRATEUR MÉRITE SA PLACE ─────────────────────────────────
  //
  // `a ?? b` ne prend `b` que si `a` est `null` ou `undefined`. `a || b` le prend
  // aussi quand `a` vaut `0`, `''` ou `false`. L'échange est donc un vrai
  // changement de sens — et un sens qui se casse en silence, puisqu'il ne se
  // manifeste que sur les valeurs « fausses mais présentes ».
  //
  // Le dépôt compte 652 `??` en production, et plusieurs portent des décisions :
  //
  //     (nodeOnShift.get(n.id) ?? true)      un nœud HORS SERVICE (false)
  //                                          redeviendrait de service ;
  //     MATRICE[role]?.includes(action) ?? false
  //                                          une permission refusée resterait
  //                                          refusée, mais la table devient
  //                                          indistinguable d'une absence.
  //
  // Aucun n'était mutable jusqu'ici : la loupe rendait ZÉRO candidat sur ces
  // lignes, et imprimait son verdict rassurant par-dessus.

  it('`??` se relâche en `||` — le repli mord alors sur zéro, vide et faux', () => {
    expect(quoi('    const service = nodeOnShift.get(id) ?? true;')).toEqual(['?? → ||']);
  });

  it('la mutation garde la forme : un seul jeton change', () => {
    const [m] = mutationsDeLigne('  return MATRICE[role]?.includes(action) ?? false;');
    expect(m.apres).toBe('  return MATRICE[role]?.includes(action) || false;');
  });

  it('`??=` n’est PAS un `??` — l’affectation ne se mute pas', () => {
    // Piège de forme : ` ??= ` ne contient pas ` ?? ` (le second `?` y est suivi
    // d'un `=`). Sans cette précaution la loupe écrirait `a ||= b` — valide en
    // JavaScript, donc SILENCIEUX, et le verdict porterait sur autre chose.
    expect(quoi('  compteurs[cle] ??= 0;')).toEqual([]);
  });

  it('deux `??` sur une ligne : on s’abstient, comme partout ailleurs', () => {
    expect(quoi('  const x = a ?? b ?? c;')).toEqual([]);
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
