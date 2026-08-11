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
