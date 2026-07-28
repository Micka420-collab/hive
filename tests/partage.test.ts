// Le partage en lecture — un lien qui montre un projet sans donner la ruche.
//
// ─── LES TROIS FAÇONS DE SE TROMPER ──────────────────────────────────────────
//
// Toutes les trois ont été des failles réelles dans de vrais produits, et ce
// fichier vérifie qu'aucune n'est possible ici :
//
//   1. Réutiliser le JETON DE SESSION dans le lien — celui qui le reçoit EST
//      vous, et l'URL survit dans l'historique, le presse-papiers, le fil de
//      discussion.
//   2. Réutiliser le JETON DE RUCHE — il vaut participation à l'essaim : le
//      mettre dans un lien public invite des inconnus à exécuter du code chez
//      vos amis.
//   3. Faire un jeton dédié… QUI OUVRE TOUT. Un lien donné pour montrer un
//      projet ouvrirait alors tous les autres, privés compris.
//
// Le test le plus important du fichier est celui du projet : `hors_projet`.
// C'est lui qui empêche la troisième, et c'est la seule ligne du module qui,
// retirée, transformerait une fonctionnalité en fuite générale.

import { describe, expect, it } from 'vitest';
import {
  ACTES_PARTAGES,
  PREFIXE_PARTAGE,
  TTL_PARTAGE_MAX_MS,
  TTL_PARTAGE_MS,
  actePartage,
  bornerTtlPartage,
  decoderPartage,
  encoderPartage,
  jugerPartage,
  partageVivant,
  type Partage,
} from '../src/shared/partage.js';
import { PREFIXE_BILLET } from '../src/shared/acces.js';

const T = 1_000_000;

const partage = (extra: Partial<Partage> = {}): Partage => ({
  id: 'par-abc',
  projectId: 'projet-1',
  secretHash: 'empreinte',
  label: 'pour le client',
  creePar: 'la-reine',
  creeA: T - 1000,
  expireA: T + TTL_PARTAGE_MS,
  revoqueA: 0,
  vuA: 0,
  ...extra,
});

describe('LE LIEN N’OUVRE QU’UN SEUL PROJET', () => {
  it('il passe sur son projet', () => {
    expect(jugerPartage(partage(), 'projet-1', T)).toEqual({ ok: true });
  });

  it('IL EST REFUSÉ SUR TOUT AUTRE PROJET', () => {
    // Sans cette ligne, un lien donné pour montrer un projet ouvrirait tous
    // les autres, privés compris. C'est le test qui fait tenir la
    // fonctionnalité entière.
    const v = jugerPartage(partage(), 'projet-2', T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('hors_projet');
  });
});

describe('révocable et expirant — sinon on n’ose pas l’envoyer', () => {
  it('un lien révoqué ne passe plus', () => {
    const v = jugerPartage(partage({ revoqueA: T - 1 }), 'projet-1', T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('revoque');
  });

  it('un lien expiré ne passe plus', () => {
    const v = jugerPartage(partage({ expireA: T - 1 }), 'projet-1', T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('expire');
  });

  it('RÉVOQUÉ L’EMPORTE SUR EXPIRÉ — le motif doit être celui qu’on attend', () => {
    // Quelqu'un qui vient de révoquer veut lire « révoqué ». Lui dire
    // « expiré » lui ferait croire que sa révocation n'a pas pris, et il
    // chercherait le problème ailleurs.
    const v = jugerPartage(partage({ revoqueA: T - 10, expireA: T - 5 }), 'projet-1', T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('revoque');
  });

  it('l’expiration est stricte à la milliseconde près', () => {
    expect(jugerPartage(partage({ expireA: T + 1 }), 'projet-1', T).ok).toBe(true);
    expect(jugerPartage(partage({ expireA: T }), 'projet-1', T).ok).toBe(false);
  });

  it('un lien inconnu se dit inconnu', () => {
    const v = jugerPartage(undefined, 'projet-1', T);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('inconnu');
  });

  it('partageVivant suit les mêmes règles', () => {
    expect(partageVivant(partage(), T)).toBe(true);
    expect(partageVivant(partage({ revoqueA: 1 }), T)).toBe(false);
    expect(partageVivant(partage({ expireA: T - 1 }), T)).toBe(false);
  });
});

describe('LA LISTE DES ACTES EST BLANCHE, PAS NOIRE', () => {
  it('les deux actes de lecture passent', () => {
    expect(actePartage('voir_avancement')).toBe(true);
    expect(actePartage('lire_code')).toBe(true);
  });

  it('TOUT LE RESTE EST REFUSÉ, y compris ce qui n’existe pas encore', () => {
    // C'est la propriété qui compte : une route ajoutée demain n'est pas
    // ouverte au public par le simple fait d'exister.
    for (const acte of [
      'creer_projet',
      'supprimer_projet',
      'changer_role',
      'gerer_serveurs',
      'lancer_merge',
      'route_inventee_demain',
      '',
      'lire_code ',
      'LIRE_CODE',
    ]) {
      expect(actePartage(acte), acte).toBe(false);
    }
  });

  it('aucun acte d’écriture ne s’est glissé dans la liste', () => {
    // Ce test est pour le futur : ajouter un acte d'écriture ici ouvrirait le
    // partage en une ligne, sans qu'aucun autre test ne bronche.
    for (const a of ACTES_PARTAGES) {
      expect(a.startsWith('voir_') || a.startsWith('lire_'), a).toBe(true);
    }
  });
});

describe('la durée de vie est bornée des deux côtés', () => {
  it('sans demande, sept jours', () => {
    expect(bornerTtlPartage(undefined)).toBe(TTL_PARTAGE_MS);
  });

  it('UNE DEMANDE DÉMESURÉE EST RAMENÉE AU PLAFOND', () => {
    // Un lien de trois ans n'est plus un partage, c'est un accès.
    expect(bornerTtlPartage(1_000 * TTL_PARTAGE_MAX_MS)).toBe(TTL_PARTAGE_MAX_MS);
    expect(bornerTtlPartage(Number.MAX_SAFE_INTEGER)).toBe(TTL_PARTAGE_MAX_MS);
  });

  it('une demande absurde retombe sur le défaut, sans lever', () => {
    for (const absurde of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(bornerTtlPartage(absurde), String(absurde)).toBe(TTL_PARTAGE_MS);
    }
  });

  it('une demande raisonnable est respectée', () => {
    expect(bornerTtlPartage(3600_000)).toBe(3600_000);
  });
});

describe('le lien lui-même', () => {
  it('fait l’aller-retour', () => {
    const lien = encoderPartage({ id: 'par-xyz', secret: 'un-secret' });
    expect(decoderPartage(lien)).toEqual({ id: 'par-xyz', secret: 'un-secret' });
  });

  it('SON PRÉFIXE EST DISTINCT DE CELUI D’UN BILLET', () => {
    // Un lien de partage et un billet de nœud n'accordent pas du tout la même
    // chose. Les confondre à l'œil serait déjà une erreur ; les confondre au
    // décodage en serait une bien pire.
    expect(PREFIXE_PARTAGE).not.toBe(PREFIXE_BILLET);
    expect(encoderPartage({ id: 'a', secret: 'b' }).startsWith(PREFIXE_PARTAGE)).toBe(true);
  });

  it('UN BILLET NE SE DÉCODE PAS COMME UN PARTAGE', () => {
    expect(decoderPartage('hive2_eyJ2IjoyfQ')).toBeNull();
    expect(decoderPartage('hive1_quelquechose')).toBeNull();
  });

  it('tout ce qui est difforme rend null, jamais un objet à moitié rempli', () => {
    for (const tordu of [
      '',
      '   ',
      'hive3_',
      'hive3_pas-du-base64!!',
      `${PREFIXE_PARTAGE}${Buffer.from('{}').toString('base64url')}`,
      `${PREFIXE_PARTAGE}${Buffer.from('{"v":2,"id":"a","s":"b"}').toString('base64url')}`,
      `${PREFIXE_PARTAGE}${Buffer.from('{"v":3,"id":"","s":"b"}').toString('base64url')}`,
      `${PREFIXE_PARTAGE}${Buffer.from('{"v":3,"id":"a"}').toString('base64url')}`,
      `${PREFIXE_PARTAGE}${Buffer.from('[1,2,3]').toString('base64url')}`,
      `${PREFIXE_PARTAGE}${Buffer.from('null').toString('base64url')}`,
    ]) {
      expect(decoderPartage(tordu), JSON.stringify(tordu.slice(0, 40))).toBeNull();
    }
  });

  it('UN JETON DÉMESURÉ EST REFUSÉ AVANT D’ÊTRE DÉCODÉ', () => {
    // Décoder d'abord reviendrait à allouer un mégaoctet sur la foi d'une
    // chaîne qu'on n'a pas encore lue — sur une route publique, par
    // construction.
    expect(decoderPartage(PREFIXE_PARTAGE + 'A'.repeat(100_000))).toBeNull();
  });

  it('UN JETON N’A QU’UNE SEULE ÉCRITURE', () => {
    // Le décodage base64url est laxiste : selon la longueur, des caractères
    // ajoutés à la fin sont ignorés, et deux chaînes différentes rendent alors
    // le MÊME droit. Ce n'est pas une faille — il faut déjà détenir un jeton
    // valide — mais un même droit qui s'écrit d'une infinité de façons est un
    // piège pour tout ce qui compte les chaînes plutôt que les identités :
    // limitation de débit par jeton, liste de blocage, corrélation de journaux.
    const lien = encoderPartage({ id: 'par-canonique', secret: 'un-secret-de-test' });
    expect(decoderPartage(lien)).not.toBeNull();
    for (const variante of [`${lien}x`, `${lien}==`, `${lien}A`, lien.slice(0, -1)]) {
      expect(decoderPartage(variante), variante.slice(-8)).toBeNull();
    }
  });

  it('…mais un jeton collé avec un espace ou un retour à la ligne marche encore', () => {
    // La forme canonique ne doit pas punir un copier-coller : c'est le geste
    // même qu'on demande à l'utilisateur de faire.
    const lien = encoderPartage({ id: 'par-colle', secret: 'secret' });
    expect(decoderPartage(`  ${lien}\n`)).toEqual({ id: 'par-colle', secret: 'secret' });
  });

  it('les champs démesurés sont refusés aussi', () => {
    const gros = `${PREFIXE_PARTAGE}${Buffer.from(
      JSON.stringify({ v: 3, id: 'a'.repeat(200), s: 'b' }),
    ).toString('base64url')}`;
    expect(decoderPartage(gros)).toBeNull();
  });
});
