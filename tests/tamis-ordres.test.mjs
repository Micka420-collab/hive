// LE TAMIS DES ORDRES, ÉPROUVÉ SANS LANCER LA SUITE.
//
// `scripts/tamis-ordres.mjs` rejoue la suite entière plusieurs fois. Un test
// qui l'exécuterait pour de bon relancerait donc la suite DEPUIS la suite —
// d'où l'injection du lanceur : on lui donne une fonction qui rend un code de
// sortie, et on vérifie ce que le script en fait.
//
// Ce qu'il faut vraiment tenir ici, c'est la SORTIE EN ÉCHEC. Un tamis qui
// rendrait 0 sur un ordre rouge serait pire qu'absent : la CI resterait verte
// en affichant les échecs, et on apprendrait à ne plus les lire.

import { describe, expect, it } from 'vitest';
import { GRAINES, codeDeSortie, principal } from '../scripts/tamis-ordres.mjs';

/** Un lanceur qui note ce qu'on lui demande et rend les codes prévus. */
function lanceur(codes) {
  const vues = [];
  return {
    vues,
    lancer: async (graine) => {
      vues.push(graine);
      return codes[graine] ?? 0;
    },
  };
}

describe('le code de sortie d’un ordre — zéro est un SUCCÈS', () => {
  // ─── LA GARDE QUE LE BALAYAGE A TROUVÉE NUE ─────────────────────────────────
  //
  // `resolve(code ?? 1)` vivait dans le rappel de `spawn` : hors d'atteinte,
  // puisque l'éprouver aurait demandé de relancer la suite DEPUIS la suite.
  // Mutée en `code || 1`, la suite ENTIÈRE est restée verte — 244 fichiers,
  // 3 559 tests — alors que le tamis rapportait un ÉCHEC pour chaque ordre qui
  // passait.
  //
  // Le dégât n'est pas d'être rouge : c'est d'être rouge SANS RAISON. Une CI qui
  // barre une suite verte s'apprend à ne plus être crue, puis se fait désarmer
  // par lassitude — et le jour où elle a raison, personne ne l'écoute.

  it('ZÉRO RESTE ZÉRO — un ordre qui passe n’est pas un ordre rouge', () => {
    expect(codeDeSortie(0)).toBe(0);
  });

  it('TUÉ PAR UN SIGNAL (null) ⇒ échec — on ne conclut rien de bon d’un mort', () => {
    expect(codeDeSortie(null)).toBe(1);
  });

  it('un code d’échec traverse tel quel, il ne se normalise pas', () => {
    // Sans ce banc, une implémentation qui rendrait toujours 0 ou toujours 1
    // satisferait les deux du dessus.
    expect(codeDeSortie(2)).toBe(2);
    expect(codeDeSortie(130)).toBe(130);
  });
});

describe('le tamis des ordres', () => {
  it('SANS ARGUMENT, IL REJOUE LES GRAINES ÉCRITES', async () => {
    const { vues, lancer } = lanceur({});
    const code = await principal([], lancer, () => undefined);
    expect(code).toBe(0);
    expect(vues).toEqual(GRAINES);
  });

  it('UN SEUL ORDRE ROUGE REND LA CI ROUGE', async () => {
    // La propriété qui porte tout le reste.
    const { lancer } = lanceur({ [GRAINES[1]]: 1 });
    expect(await principal([], lancer, () => undefined)).toBe(1);
  });

  it('IL LES ESSAIE TOUTES, MÊME APRÈS UN ÉCHEC', async () => {
    // S'arrêter au premier rouge transformerait trois diagnostics en un seul —
    // c'est le raisonnement de `fail-fast: false` dans la CI.
    const { vues, lancer } = lanceur({ [GRAINES[0]]: 1 });
    await principal([], lancer, () => undefined);
    expect(vues).toEqual(GRAINES);
  });

  it('LE MESSAGE D’ÉCHEC DONNE LA COMMANDE QUI REJOUE L’ORDRE', async () => {
    // Un échec qu'on ne sait pas rejouer se relance au lieu de se lire.
    const dit = [];
    await principal([], lanceur({ [GRAINES[2]]: 1 }).lancer, (t) => dit.push(t));
    const tout = dit.join('\n');
    expect(tout).toContain(`--sequence.seed=${GRAINES[2]}`);
    expect(tout, 'le geste attendu doit être nommé').toContain('poser sa propre prémisse');
  });

  it('ON PEUT LUI DONNER SES PROPRES GRAINES', async () => {
    // C'est comme ça qu'on rejoue un ordre trouvé ailleurs avant de l'ajouter
    // à la liste.
    const { vues, lancer } = lanceur({});
    await principal(['4242', '7'], lancer, () => undefined);
    expect(vues).toEqual([4242, 7]);
  });

  it('UNE GRAINE NULLE OU NÉGATIVE N’EST PAS UN ORDRE', async () => {
    // La loupe a trouvé ce trou : `Number.isInteger(n) && n > 0` muté en `||`
    // survivait, parce que tous mes cas étaient soit des entiers positifs, soit
    // du texte. Ni l'un ni l'autre ne distingue les deux opérateurs — il
    // fallait un nombre ENTIER qui ne soit pas un ordre valable.
    const { vues, lancer } = lanceur({});
    await principal(['0', '-5'], lancer, () => undefined);
    expect(vues, 'zéro et les négatifs ne sont pas des graines').toEqual(GRAINES);
  });

  it('…mais une graine valable au milieu du bruit est bien retenue', async () => {
    // L'autre moitié : un filtre qui rejetterait TOUT rendrait le test
    // ci-dessus vert pour la mauvaise raison.
    const { vues, lancer } = lanceur({});
    await principal(['0', '99', '-3'], lancer, () => undefined);
    expect(vues).toEqual([99]);
  });

  it('UNE GRAINE ILLISIBLE NE FAIT PAS SILENCIEUSEMENT ZÉRO ORDRE', async () => {
    // `Number('abc')` rend NaN. Sans filtre, le script aurait rejoué « NaN » ;
    // avec un filtre mais sans repli, il n'aurait rejoué RIEN — et rendu 0.
    // Une CI verte qui n'a rien essayé est le pire des deux.
    const { vues, lancer } = lanceur({});
    await principal(['pas-un-nombre'], lancer, () => undefined);
    expect(vues).toEqual(GRAINES);
  });

  it('LES GRAINES ÉCRITES SONT DISTINCTES — sinon le tamis a moins de mailles qu’il n’annonce', () => {
    expect(new Set(GRAINES).size).toBe(GRAINES.length);
    expect(GRAINES.length).toBeGreaterThanOrEqual(3);
  });
});
