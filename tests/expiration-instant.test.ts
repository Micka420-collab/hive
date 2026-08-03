// L'INSTANT EXACT OÙ UN ACCÈS MEURT — les deux juges, à la milliseconde.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage du plan de nuit a rendu SANS TEST la garde
// `if (etat.expireA <= maintenant) return { ok: false, refus: 'expire' }` de
// `jugerBillet`. Mutée en `<`, un billet dont l'instant d'expiration est
// EXACTEMENT l'instant courant reste accepté : la porte de la ruche s'ouvre
// une dernière fois après l'heure annoncée.
//
// La faute n'était pas dans l'idée du test, elle était dans son ÉTAGE :
// `jugerBillet` n'avait aucun banc à lui. Il était éprouvé par le HTTP
// (`billet-motifs.test.ts`), avec un billet périmé depuis 1970 — à des années
// de la borne, donc incapable de la départager. Un cas loin de la frontière ne
// dit rien de la frontière, et c'est la même leçon que le 18ᵉ lot (« 1 Mo pile
// s'affichait 1024 ko ») appliquée à un ACCÈS plutôt qu'à un affichage.
//
// `jugerPartage` porte la garde JUMELLE, écrite dans le même esprit et pour le
// même motif (`expireA <= maintenant`). Les deux sont gardées ici, ensemble :
// une famille de règles se protège en famille, sinon la jumelle non testée
// dérive à la première retouche.
//
// ─── LA PROPRIÉTÉ, EN UNE PHRASE ─────────────────────────────────────────────
//
//   À L'INSTANT ANNONCÉ, C'EST FINI. Pas une milliseconde de sursis, et pas
//   une milliseconde volée non plus : à `expireA - 1`, l'accès vit encore.

import { describe, expect, it } from 'vitest';
import { jugerBillet } from '../src/shared/acces.js';
import type { EtatBillet } from '../src/shared/acces.js';
import { jugerPartage, partageVivant } from '../src/shared/partage.js';
import type { Partage } from '../src/shared/partage.js';

/** Un instant quelconque, mais FIXE : une horloge réelle rendrait ce banc muet. */
const MAINTENANT = 1_800_000_000_000;

function billet(over: Partial<EtatBillet> = {}): EtatBillet {
  return { expireA: MAINTENANT + 60_000, usagesRestants: 3, revoqueA: null, ...over };
}

function partage(over: Partial<Partage> = {}): Partage {
  return {
    id: 'pa-1',
    projectId: 'p1',
    secretHash: 'x',
    expireA: MAINTENANT + 60_000,
    revoqueA: 0,
    creeA: MAINTENANT - 1_000,
    ...over,
  } as unknown as Partage;
}

describe('jugerBillet — l’instant exact de l’expiration', () => {
  it('UNE MILLISECONDE AVANT, le billet vit encore', () => {
    const j = jugerBillet(billet({ expireA: MAINTENANT + 1 }), MAINTENANT);
    expect(j.ok, 'la borne ne vole pas de temps à personne').toBe(true);
  });

  it('À L’INSTANT PILE, il est expiré — pas de sursis d’une milliseconde', () => {
    // La moitié qui tue `<=` → `<`. Le seul cas d'expiration éprouvé jusqu'ici
    // vivait à `expiresAt: 1` (janvier 1970) : à des décennies de la borne, il
    // laissait passer la mutation sans un bruit.
    const j = jugerBillet(billet({ expireA: MAINTENANT }), MAINTENANT);
    expect(j.ok, 'à l’instant annoncé, c’est fini').toBe(false);
    expect(j.ok === false && j.refus).toBe('expire');
  });

  it('UNE MILLISECONDE APRÈS, il est expiré aussi — la borne ne s’inverse pas', () => {
    const j = jugerBillet(billet({ expireA: MAINTENANT - 1 }), MAINTENANT);
    expect(j.ok).toBe(false);
    expect(j.ok === false && j.refus).toBe('expire');
  });

  it('L’ORDRE DES REFUS TIENT : révoqué passe devant expiré, expiré devant épuisé', () => {
    // Un billet à la fois révoqué, expiré et épuisé ne doit pas raconter
    // n'importe laquelle de ses trois morts : l'ordre est délibéré (la
    // révocation est le geste HUMAIN, c'est lui qu'on doit apprendre).
    const mort = billet({ expireA: MAINTENANT, usagesRestants: 0, revoqueA: MAINTENANT - 10 });
    expect(jugerBillet(mort, MAINTENANT)).toEqual({ ok: false, refus: 'revoque' });
    const expireEtEpuise = billet({ expireA: MAINTENANT, usagesRestants: 0 });
    expect(jugerBillet(expireEtEpuise, MAINTENANT)).toEqual({ ok: false, refus: 'expire' });
  });

  it('UN BILLET SANS USAGE RESTANT est épuisé, à zéro exactement', () => {
    expect(jugerBillet(billet({ usagesRestants: 0 }), MAINTENANT)).toEqual({
      ok: false,
      refus: 'epuise',
    });
    expect(jugerBillet(billet({ usagesRestants: 1 }), MAINTENANT).ok, 'un usage suffit').toBe(true);
  });

  it('UN BILLET INCONNU se refuse sans rien révéler d’autre', () => {
    expect(jugerBillet(null, MAINTENANT)).toEqual({ ok: false, refus: 'inconnu' });
  });
});

describe('jugerPartage — la garde JUMELLE, même borne, même instant', () => {
  it('À L’INSTANT PILE, le lien de partage est mort', () => {
    const j = jugerPartage(partage({ expireA: MAINTENANT }), 'p1', MAINTENANT);
    expect(j.ok, 'un lien de lecture meurt à l’heure dite').toBe(false);
    expect(j.ok === false && j.motif).toBe('expire');
  });

  it('…et une milliseconde avant, il ouvre encore', () => {
    expect(jugerPartage(partage({ expireA: MAINTENANT + 1 }), 'p1', MAINTENANT).ok).toBe(true);
  });

  it('LE LIEN RESTE LIÉ À SON PROJET — même vivant, il n’ouvre pas le voisin', () => {
    // La garde la plus chère du fichier : sans elle, un lien donné pour
    // montrer UN projet ouvrirait tous les autres, privés compris.
    const j = jugerPartage(partage(), 'un-autre-projet', MAINTENANT);
    expect(j.ok).toBe(false);
    expect(j.ok === false && j.motif).toBe('hors_projet');
  });

  it('« VIVANT » DIT LA MÊME CHOSE QUE LE JUGE — l’affichage ne ment pas au juge', () => {
    // `partageVivant` sert l'écran et l'élagage ; s'il divergeait du juge, on
    // afficherait « actif » un lien que le serveur refuse — ou pire, on
    // élaguerait un lien encore valide.
    for (const delta of [-1, 0, 1]) {
      const p = partage({ expireA: MAINTENANT + delta });
      expect(partageVivant(p, MAINTENANT), `delta ${delta}`).toBe(
        jugerPartage(p, 'p1', MAINTENANT).ok,
      );
    }
  });
});
