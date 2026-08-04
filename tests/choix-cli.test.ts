// DEUX BORNES DE SAISIE EN LIGNE DE COMMANDE — touchées des deux côtés.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Deux survivantes du balayage de nuit, toutes deux dans `src/cli.ts` — qui se
// termine par un `try { … } catch` de tête, donc S'EXÉCUTE à l'import. Aucun
// banc ne pouvait les appeler (§ 2.8 du carnet).
//
// Nudité vérifiée contre la SUITE ENTIÈRE avant d'écrire une ligne — pas
// contre un fichier choisi au hasard (§ 2 septdecies) : 3 256 tests verts avec
// chacune des deux mutations en place.
//
// ─── CE QUE CHACUNE PROTÈGE ──────────────────────────────────────────────────
//
// `iSetup >= 0` : `indexOf` rend **0** quand le drapeau est le PREMIER
// argument — c'est-à-dire dans l'invocation que la documentation montre,
// `hive cloudflare --setup ma-ruche.exemple.fr`. Sur `> 0`, celle-là perd son
// argument en silence. Zéro est une position, pas une absence : c'est le même
// piège que le `-1` d'`indexOf`, vu par l'autre bout.
//
// `n <= taille` : sur `<`, le DERNIER dépôt de la liste devient inchoisissable,
// et le refus se contredit lui-même — « n'est pas un numéro de la liste
// (1 à 12) » quand l'utilisateur vient de taper 12, qu'il a lu à l'écran. Une
// erreur qui nie ce qu'elle affiche ne s'attribue à rien : on se croit fou
// avant de croire à un défaut.

import { describe, expect, it } from 'vitest';
import { aLeDrapeau, choisirParNumero, valeurApres } from '../src/choix-cli.js';

describe('la valeur qui suit un drapeau', () => {
  it('LE DRAPEAU EN PREMIÈRE POSITION EST TROUVÉ — zéro est une POSITION', () => {
    // LA garde. C'est l'invocation que la documentation montre.
    expect(valeurApres(['--setup', 'ruche.exemple.fr'], '--setup')).toBe('ruche.exemple.fr');
  });

  it('AILLEURS AUSSI — la borne ne mord pas plus loin', () => {
    expect(valeurApres(['tunnel', '--setup', 'ruche.exemple.fr'], '--setup')).toBe(
      'ruche.exemple.fr',
    );
    expect(valeurApres(['a', 'b', '--setup', 'x'], '--setup')).toBe('x');
  });

  it('DRAPEAU ABSENT : RIEN — et c’est le seul cas d’absence', () => {
    expect(valeurApres(['tunnel', 'ruche.exemple.fr'], '--setup')).toBeUndefined();
    expect(valeurApres([], '--setup')).toBeUndefined();
  });

  it('DRAPEAU EN DERNIER : RIEN APRÈS LUI, DONC RIEN', () => {
    // Rendre la chaîne vide ferait prendre une valeur absente pour une réponse.
    expect(valeurApres(['--setup'], '--setup')).toBeUndefined();
    expect(valeurApres(['tunnel', '--setup'], '--setup')).toBeUndefined();
  });

  it('LA PRÉSENCE ET LA VALEUR SONT DEUX QUESTIONS DISTINCTES', () => {
    // Un `--setup` seul est PRÉSENT sans valeur. Les confondre ferait suivre le
    // chemin « pas de tunnel nommé » au lieu de refuser un nom d'hôte manquant :
    // un silence là où l'utilisateur attend une explication.
    expect(aLeDrapeau(['--setup'], '--setup'), 'présent').toBe(true);
    expect(valeurApres(['--setup'], '--setup'), 'mais sans valeur').toBeUndefined();
    expect(aLeDrapeau(['tunnel'], '--setup'), 'absent').toBe(false);
    // Et la présence se voit AUSSI en position zéro.
    expect(aLeDrapeau(['--setup', 'x'], '--setup')).toBe(true);
  });
});

describe('le choix d’un dépôt par son numéro', () => {
  it('LA BORNE BASSE TOMBE PILE — touchée des deux côtés', () => {
    expect(choisirParNumero('0', 3), 'zéro ne désigne rien : la liste part de 1').toBeNull();
    expect(choisirParNumero('1', 3), 'un désigne le premier').toBe(0);
    expect(choisirParNumero('-1', 3), 'un négatif non plus').toBeNull();
  });

  it('LA BORNE HAUTE TOMBE PILE — c’est celle qui rendait le DERNIER inchoisissable', () => {
    expect(choisirParNumero('2', 3), 'sous le plafond').toBe(1);
    // LA garde. Sur `<`, ce cas-ci rendrait `null` — et le message d'erreur
    // annoncerait « (1 à 3) » à quelqu'un qui vient de taper 3.
    expect(choisirParNumero('3', 3), 'PILE au plafond : le dernier se choisit').toBe(2);
    expect(choisirParNumero('4', 3), 'au-dessus, rien').toBeNull();
  });

  it('UNE LISTE D’UN SEUL DÉPÔT SE CHOISIT — les deux bornes se touchent', () => {
    // Le cas où la borne basse et la borne haute désignent le même élément :
    // une mutation de l'une OU de l'autre le rend inatteignable.
    expect(choisirParNumero('1', 1)).toBe(0);
    expect(choisirParNumero('2', 1)).toBeNull();
    expect(choisirParNumero('0', 1)).toBeNull();
  });

  it('UNE LISTE VIDE NE DÉSIGNE RIEN — jamais un index négatif', () => {
    // Sans la borne basse, `Number('0') - 1` rendrait `-1`, et `depots[-1]`
    // vaut `undefined` : le refus arriverait par accident plutôt que par règle.
    expect(choisirParNumero('1', 0)).toBeNull();
    expect(choisirParNumero('0', 0)).toBeNull();
  });

  it('CE QUI N’EST PAS UN ENTIER NE DÉSIGNE RIEN — y compris ce qui y ressemble', () => {
    for (const saisie of ['2.5', 'deux', '', '   ', '1e3', 'NaN', '+', '3px']) {
      expect(choisirParNumero(saisie, 5), `« ${saisie} »`).toBeNull();
    }
  });

  it('LES ESPACES AUTOUR NE FONT PAS ÉCHOUER UN CHOIX VALIDE', () => {
    // Un humain qui tape dans un terminal laisse traîner une espace : refuser
    // pour ça ferait passer un défaut de saisie pour un numéro invalide.
    expect(choisirParNumero('  2  ', 3)).toBe(1);
    expect(choisirParNumero('\t3\n', 3)).toBe(2);
  });
});
