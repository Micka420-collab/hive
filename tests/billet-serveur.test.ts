// Le billet d'un serveur provisionné — et pourquoi il ne se range pas.
//
// ─── LA FUITE ────────────────────────────────────────────────────────────────
//
// Les instructions du fournisseur manuel contiennent le billet de rattachement :
// c'est leur raison d'être, l'humain doit pouvoir coller la commande. Elles
// étaient rangées telles quelles dans `serveurs.motif` :
//
//     transiter(base, 'provisionnement', machine.instructions.join(' ⏎ '), now)
//
// Or un billet porte le SECRET EN CLAIR — `hive2_…` est un base64url lisible,
// pas un chiffrement. Toute la précaution prise à côté était donc annulée par
// cette ligne : la table `billets` ne range qu'une empreinte PBKDF2
// (`secretHash`), et le secret en clair dormait juste à côté dans `serveurs`,
// durablement, sans aucune borne liée à sa péremption. Un billet à usage
// unique consommé il y a trois mois y était encore lisible.
//
// `motif` est un champ d'ÉTAT. Personne ne s'attend à y trouver un
// identifiant : il s'affiche dans une page d'administration, se copie dans un
// fil de support, se lit dans une sauvegarde.

import { describe, expect, it } from 'vitest';
import {
  BILLET_CAVIARDE,
  FOURNISSEUR_MANUEL,
  caviarderBillet,
} from '../src/orchestrator/serveurs.js';
import { PREFIXE_BILLET, encoderBillet } from '../src/shared/acces.js';

const BILLET = encoderBillet({
  url: 'ws://ruche.exemple:7777/ws',
  id: 'bil-abcdef',
  secret: 'SECRET-QUI-NE-DOIT-JAMAIS-ETRE-RANGE',
  label: 'serveur de test',
});

describe('le billet porte bien le secret en clair — d’où le problème', () => {
  it('un billet est LISIBLE, ce n’est pas un chiffrement', () => {
    // Si ce test tombe un jour parce que le format devient opaque, la fuite
    // change de nature : autant que ce soit dit ici, noir sur blanc.
    expect(BILLET.startsWith(PREFIXE_BILLET)).toBe(true);
    const clair = Buffer.from(BILLET.slice(PREFIXE_BILLET.length), 'base64url').toString('utf8');
    expect(clair).toContain('SECRET-QUI-NE-DOIT-JAMAIS-ETRE-RANGE');
  });

  it('les instructions du fournisseur manuel le contiennent, par construction', async () => {
    const m = await FOURNISSEUR_MANUEL.demarrer({
      gabarit: 'petit',
      billet: BILLET,
      urlRuche: 'ws://ruche.exemple:7777/ws',
    });
    expect(m.instructions.join(' ')).toContain(BILLET);
  });
});

describe('caviarderBillet — ce qui sera rangé n’en porte plus la trace', () => {
  it('LE BILLET DISPARAÎT DES INSTRUCTIONS RANGÉES', async () => {
    const m = await FOURNISSEUR_MANUEL.demarrer({
      gabarit: 'petit',
      billet: BILLET,
      urlRuche: 'ws://ruche.exemple:7777/ws',
    });
    const range = caviarderBillet(m.instructions, BILLET).join(' ⏎ ');
    expect(range).not.toContain(BILLET);
    expect(range, 'même un fragment du secret ne doit pas subsister').not.toContain(
      'SECRET-QUI-NE-DOIT-JAMAIS-ETRE-RANGE',
    );
    expect(range).toContain(BILLET_CAVIARDE);
  });

  it('LE RESTE DES INSTRUCTIONS SURVIT — sinon l’admin ne sait plus quoi faire', () => {
    // Caviarder ne doit pas rendre le motif inutile : c'est encore la seule
    // chose que l'administrateur lit pour comprendre où en est sa machine.
    const range = caviarderBillet(
      ['Louez un VPS.', `  npm run join ${BILLET}`, '(la ruche est joignable sur ws://x)'],
      BILLET,
    );
    expect(range[0]).toBe('Louez un VPS.');
    expect(range[2]).toContain('joignable');
    expect(range).toHaveLength(3);
  });

  it('plusieurs occurrences sont toutes retirées', () => {
    const range = caviarderBillet([`${BILLET} et encore ${BILLET}`], BILLET);
    expect(range[0]).not.toContain(BILLET);
    expect(range[0]!.split(BILLET_CAVIARDE)).toHaveLength(3);
  });

  it('UN BILLET VIDE NE CAVIARDE RIEN — le piège du remplacement universel', () => {
    // `''.split('')` remplacerait chaque intervalle entre caractères : le
    // motif deviendrait illisible, donc inutile, sur un cas d'erreur — c'est
    // à dire précisément quand on en a besoin.
    expect(caviarderBillet(['a', 'b'], '')).toEqual(['a', 'b']);
  });

  it('un billet absent des instructions les laisse intactes', () => {
    expect(caviarderBillet(['rien à voir'], BILLET)).toEqual(['rien à voir']);
  });
});
