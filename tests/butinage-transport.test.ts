// LE TRAJET — ce qui se décide entre « l'adresse est permise » et « le contenu
// est lisible ». Module pur : aucun réseau, et c'est ce qui rend éprouvables
// des gardes qu'on ne peut pas mettre en défaut autrement.

import { describe, expect, it } from 'vitest';
import {
  BUTIN_DELAI_MS,
  depasseLePlafond,
  jugerEnTetes,
  nomDeQuarantaine,
  verifierCondensat,
} from '../src/shared/butinage-transport.js';

const PLAFOND = 25 * 1024 * 1024;
const TGZ = 'application/gzip';

describe('jugerEnTetes — la réponse avant d’en lire un octet', () => {
  it('200 + type d’archive : on peut lire', () => {
    expect(jugerEnTetes(200, TGZ, null, PLAFOND)).toEqual({ ok: true });
  });

  it('UNE REDIRECTION EST UN REFUS À PART, jamais une étape', () => {
    // ─── LA GARDE QUI TIENT TOUTE LA LISTE BLANCHE ──────────────────────────
    //
    // Un hôte permis qui répond « 302 → http://169.254.169.254/… » renvoie vers
    // une adresse que la porte 1 n'a jamais vue. Suivre, c'est rendre la liste
    // blanche décorative — la forme canonique du SSRF.
    //
    // Motif DISTINCT d'un 404 : au journal, « le serveur nous envoie ailleurs »
    // et « la ressource n'existe pas » ne demandent pas la même enquête.
    for (const s of [301, 302, 303, 307, 308]) {
      const v = jugerEnTetes(s, TGZ, null, PLAFOND);
      expect(v.ok, `statut ${s}`).toBe(false);
      expect(v.ok === false && v.motif).toBe('redirection');
    }
  });

  it('LES BORNES DE LA REDIRECTION, dans les deux sens', () => {
    // 299 et 400 ne sont pas des redirections : les prendre pour telles
    // brouillerait le motif au journal, et les manquer laisserait passer 300.
    const av = jugerEnTetes(299, TGZ, null, PLAFOND);
    expect(av.ok === false && av.motif).toBe('statut_refuse');
    const bas = jugerEnTetes(300, TGZ, null, PLAFOND);
    expect(bas.ok === false && bas.motif).toBe('redirection');
    const haut = jugerEnTetes(399, TGZ, null, PLAFOND);
    expect(haut.ok === false && haut.motif).toBe('redirection');
    const ap = jugerEnTetes(400, TGZ, null, PLAFOND);
    expect(ap.ok === false && ap.motif).toBe('statut_refuse');
  });

  it('SEUL 200 est lu — 204 et 206 aussi sont refusés', () => {
    // Un 206 « partial content » rendrait un fichier tronqué dont le condensat
    // serait faux de toute façon ; le refuser ici le dit franchement.
    for (const s of [204, 206, 404, 500]) {
      const v = jugerEnTetes(s, TGZ, null, PLAFOND);
      expect(v.ok === false && v.motif, `statut ${s}`).toBe('statut_refuse');
    }
  });

  it('UN type::HTML LÀ OÙ ON ATTEND UNE ARCHIVE EST REFUSÉ, et le DÉTAIL le nomme', () => {
    // Portail captif, page d'erreur rendue en 200, redirection déguisée : trois
    // façons de recevoir du HTML à la place d'un paquet, et aucune ne se
    // déballe.
    //
    // Le détail nomme le type REÇU, et « absent » quand il n'y en a pas. Les
    // deux assertions ensemble tuent l'inversion de ce ternaire : muté, le
    // message dirait « absent » sur un `text/html` et « vide » sur une absence
    // — soit exactement l'inverse de ce que celui qui enquête a besoin de lire.
    const v = jugerEnTetes(200, 'text/html', null, PLAFOND);
    expect(v.ok === false && v.motif).toBe('type_refuse');
    expect(v.ok === false && v.detail, 'le type reçu doit être nommé').toContain('text/html');
    expect(v.ok === false && v.detail).not.toContain('absent');

    const vide = jugerEnTetes(200, null, null, PLAFOND);
    expect(vide.ok === false && vide.motif).toBe('type_refuse');
    expect(vide.ok === false && vide.detail, 'une absence se dit « absent »').toContain('absent');
  });

  it('LE PARAMÈTRE APRÈS LE POINT-VIRGULE NE FAIT PAS PARTIE DU TYPE', () => {
    // La moitié qui tue une comparaison sur la chaîne ENTIÈRE : elle refuserait
    // des réponses parfaitement valides, et le refus serait attribué au serveur.
    expect(jugerEnTetes(200, 'application/gzip; charset=binary', null, PLAFOND)).toEqual({
      ok: true,
    });
    expect(jugerEnTetes(200, '  APPLICATION/GZIP  ', null, PLAFOND)).toEqual({ ok: true });
  });

  it('UNE ANNONCE DE TAILLE AU-DESSUS DU PLAFOND : refus sans rien lire', () => {
    const v = jugerEnTetes(200, TGZ, String(PLAFOND + 1), PLAFOND);
    expect(v.ok === false && v.motif).toBe('annonce_trop_grosse');
  });

  it('PILE SUR LE PLAFOND : l’annonce passe', () => {
    // `>` et non `>=` : un fichier qui fait exactement le plafond est permis.
    expect(jugerEnTetes(200, TGZ, String(PLAFOND), PLAFOND)).toEqual({ ok: true });
  });

  it('ANNONCE ABSENTE OU ILLISIBLE : ce n’est PAS un refus', () => {
    // ─── POURQUOI ON NE L'EXIGE PAS ─────────────────────────────────────────
    //
    // Beaucoup de serveurs légitimes n'annoncent rien en `chunked`. Exiger
    // l'en-tête refuserait des sources valides pour un gain nul : l'annonce ne
    // prouve rien, c'est le compteur du flux qui garde.
    expect(jugerEnTetes(200, TGZ, null, PLAFOND)).toEqual({ ok: true });
    expect(jugerEnTetes(200, TGZ, '', PLAFOND)).toEqual({ ok: true });
    expect(jugerEnTetes(200, TGZ, 'beaucoup', PLAFOND)).toEqual({ ok: true });
  });

  it('le délai est une constante nommée, pas un nombre posé là', () => {
    expect(BUTIN_DELAI_MS).toBeGreaterThan(0);
  });
});

describe('depasseLePlafond — la garde du flux, celle qui compte vraiment', () => {
  it('PILE SUR LE PLAFOND : on ne dépasse pas', () => {
    expect(depasseLePlafond(PLAFOND - 10, 10, PLAFOND)).toBe(false);
  });

  it('UN OCTET DE PLUS : on dépasse', () => {
    // La borne, dans les deux sens. `>` muté en `>=` couperait une lecture
    // parfaitement légitime au dernier octet.
    expect(depasseLePlafond(PLAFOND - 10, 11, PLAFOND)).toBe(true);
  });

  it('elle tient compte de CE QUI EST DÉJÀ LU, pas du seul morceau', () => {
    // La moitié qui tue « ne regarder que le morceau » : mille morceaux de
    // 1 Mio passeraient un à un tout en faisant un gigaoctet.
    expect(depasseLePlafond(0, 1_000, PLAFOND)).toBe(false);
    expect(depasseLePlafond(PLAFOND, 1_000, PLAFOND)).toBe(true);
  });
});

describe('nomDeQuarantaine — le nom ne vient JAMAIS d’en face', () => {
  const CONDENSAT = 'a'.repeat(64);

  it('rend un nom sans séparateur de chemin ni point d’échappement', () => {
    const n = nomDeQuarantaine(CONDENSAT);
    expect(n).not.toContain('/');
    expect(n).not.toContain('\\');
    expect(n).not.toContain('..');
    expect(n).toMatch(/^butin-[0-9a-f]{32}\.bin$/);
  });

  it('TOUT CE QUI N’EST PAS HEXADÉCIMAL EST JETÉ', () => {
    // ─── LE DÉFAUT QUE CETTE LIGNE EMPÊCHE ──────────────────────────────────
    //
    // Si un jour quelqu'un passe ici autre chose qu'un condensat — un nom de
    // fichier venu de `Content-Disposition`, par exemple — le filtre garantit
    // qu'il n'en sort ni `../`, ni `C:\`, ni octet nul. La garde ne suppose pas
    // que l'appelant a bien fait son travail.
    const n = nomDeQuarantaine('../../etc/passwd' + CONDENSAT);
    expect(n).toMatch(/^butin-[0-9a-f]{32}\.bin$/);
    expect(n).not.toContain('passwd');
  });

  it('UN CONDENSAT TROP COURT FAIT ÉCHOUER, il ne fabrique pas un nom bancal', () => {
    // Échouer FERMÉ : rendre « butin-.bin » ferait écrire tous les butins par
    // dessus le même fichier, et personne ne s'en apercevrait.
    expect(() => nomDeQuarantaine('abc')).toThrow(/trop court/);
    expect(() => nomDeQuarantaine('')).toThrow();
  });

  it('PILE À SEIZE : la borne est franchie, pas atteinte', () => {
    // La moitié qui tue `<` → `<=`. Seize chiffres hexadécimaux font 64 bits de
    // distinction — assez pour nommer sans collision. Refuser à l'égalité
    // rejetterait un condensat parfaitement suffisant, et l'échec serait
    // attribué à l'appelant.
    expect(() => nomDeQuarantaine('0123456789abcdef')).not.toThrow();
    expect(nomDeQuarantaine('0123456789abcdef')).toBe('butin-0123456789abcdef.bin');
    expect(() => nomDeQuarantaine('0123456789abcde')).toThrow(/trop court/);
  });

  it('LE MÊME CONDENSAT REND LE MÊME NOM', () => {
    expect(nomDeQuarantaine(CONDENSAT)).toBe(nomDeQuarantaine(CONDENSAT.toUpperCase()));
  });
});

describe('verifierCondensat — l’adresse dit OÙ, le condensat dit QUOI', () => {
  const A = 'f'.repeat(64);
  const B = 'e'.repeat(64);

  it('égalité : accord, quelle que soit la casse', () => {
    expect(verifierCondensat(A.toUpperCase(), A)).toEqual({ ok: true });
    expect(verifierCondensat(`  ${A}  `, A)).toEqual({ ok: true });
  });

  it('DIFFÉRENCE : refus nommé, et le détail donne les DEUX valeurs', () => {
    const v = verifierCondensat(A, B);
    expect(v.ok === false && v.motif).toBe('condensat_faux');
    expect(v.ok === false && v.detail).toContain(A);
    expect(v.ok === false && v.detail).toContain(B);
  });

  it('ABSENT OU MAL FORMÉ : refus distinct — ce n’est pas la même panne', () => {
    // « pas de condensat » et « mauvais condensat » demandent deux gestes
    // différents : compléter la demande, ou enquêter sur la source.
    for (const mauvais of [undefined, null, '', 'oui', 'f'.repeat(63), 'g'.repeat(64), 42]) {
      const v = verifierCondensat(mauvais, A);
      expect(v.ok === false && v.motif, String(mauvais)).toBe('condensat_absent');
    }
  });
});
