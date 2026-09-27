// LE COMPAGNON À SOI — l'image apportée est une donnée non fiable, et le
// stockage qui la garde peut manquer.
//
// Deux familles de défauts, et un cas par mensonge possible :
//
//   · une image qui n'en est pas une — un SVG (du XML qui porte du script),
//     une page HTML renommée en `.png`, un fichier démesuré — doit être
//     refusée sur ses OCTETS, pas sur son nom ni sur son type annoncé ;
//   · un stockage absent, plein, bloqué ou trafiqué ne doit JAMAIS faire
//     tomber l'écran : au pire, le compagnon ne survit pas à l'onglet.

import { describe, expect, it } from 'vitest';

import {
  cleDuCompagnon,
  ecrireReglages,
  lireReglages,
  nombreImages,
  nomPropre,
  REGLAGES_PAR_DEFAUT,
  TAILLE_MAX_OCTETS,
  typeReconnu,
  urlDeDonnees,
  urlImageSure,
  verifierImage,
} from '../dashboard/src/compagnon-perso.js';
import type { ReglagesCompagnon } from '../dashboard/src/compagnon-perso.js';

const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);
const WEBP_ENTETE = new TextEncoder().encode('RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00');
const texte = (s: string) => new TextEncoder().encode(s);

describe('verifierImage — les octets décident, pas l’étiquette', () => {
  it('PNG et WebP sont reconnus à leur signature', () => {
    expect(verifierImage(PNG_1PX)).toEqual({ ok: true, type: 'image/png' });
    expect(verifierImage(WEBP_ENTETE)).toEqual({ ok: true, type: 'image/webp' });
  });

  it.each([
    [
      'un SVG',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
    ],
    ['un SVG précédé d’une déclaration XML', '<?xml version="1.0"?><svg/>'],
    ['une page HTML', '<!doctype html><html><body><script>alert(1)</script></body></html>'],
    ['du HTML précédé d’un BOM et d’espaces', '\ufeff  <html></html>'],
    ['un GIF', 'GIF89a\x01\x00\x01\x00'],
    ['un RIFF qui n’est pas du WebP (WAV)', 'RIFF\x24\x00\x00\x00WAVEfmt '],
  ])('REFUSE %s, même nommé .png', (_nom, contenu) => {
    expect(verifierImage(texte(contenu))).toEqual({ ok: false, refus: 'format' });
    expect(typeReconnu(texte(contenu))).toBeNull();
  });

  it('REFUSE un fichier vide, et un fichier au-delà du plafond — même une vraie image', () => {
    expect(verifierImage(new Uint8Array(0))).toEqual({ ok: false, refus: 'vide' });
    const lourd = new Uint8Array(TAILLE_MAX_OCTETS + 1);
    lourd.set(PNG_1PX);
    expect(verifierImage(lourd)).toEqual({ ok: false, refus: 'trop_lourd' });
    const juste = new Uint8Array(TAILLE_MAX_OCTETS);
    juste.set(PNG_1PX);
    expect(verifierImage(juste)).toEqual({ ok: true, type: 'image/png' });
  });
});

describe('urlDeDonnees / urlImageSure — l’URL rangée ne peut désigner qu’une image matricielle', () => {
  it('le type de l’URL vient de la signature, et l’aller-retour garde les octets', () => {
    const url = urlDeDonnees(PNG_1PX, 'image/png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(urlImageSure(url)).toBe(true);
    const relus = Uint8Array.from(atob(url.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
    expect([...relus]).toEqual([...PNG_1PX]);
  });

  it('une planche au plafond s’encode sans faire sauter la pile', () => {
    const grand = new Uint8Array(TAILLE_MAX_OCTETS);
    grand.set(PNG_1PX);
    const url = urlDeDonnees(grand, 'image/png');
    expect(urlImageSure(url)).toBe(true);
  });

  it.each([
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:text/html;base64,PGh0bWw+PC9odG1sPg==',
    'data:image/png,<svg onload=alert(1)>',
    'data:image/png;base64,AAAA"><script>',
    'javascript:alert(1)',
    'https://exemple.test/abeille.png',
    'blob:https://exemple.test/uuid',
  ])('REFUSE à l’affichage : %s', (url) => {
    expect(urlImageSure(url)).toBe(false);
  });
});

describe('nom et nombre d’images', () => {
  it('le nom perd ses caractères de contrôle et de direction, et reste borné', () => {
    expect(nomPropre('  Maya\u202e\u0007  la\nbelle ')).toBe('Maya la belle');
    expect(nomPropre('x'.repeat(80))).toHaveLength(24);
    expect(nomPropre('\u200b\u0000')).toBe('');
  });

  it('le nombre d’images est facultatif (1), entier, de 1 à 24', () => {
    expect(nombreImages('')).toBe(1);
    expect(nombreImages('6')).toBe(6);
    expect(nombreImages(24)).toBe(24);
    for (const mauvais of ['0', '25', '2.5', '-1', 'abc', null]) {
      expect(nombreImages(mauvais), String(mauvais)).toBeNull();
    }
  });
});

// ─── Le stockage ─────────────────────────────────────────────────────────────

/** Un `Storage` minimal, dont chaque méthode peut être rendue hostile. */
function stockage(
  depart: Record<string, string> = {},
  panne: { lire?: boolean; ecrire?: boolean } = {},
): Storage & { donnees: Record<string, string> } {
  const donnees = { ...depart };
  return {
    donnees,
    get length() {
      return Object.keys(donnees).length;
    },
    clear: () => Object.keys(donnees).forEach((k) => delete donnees[k]),
    key: (i: number) => Object.keys(donnees)[i] ?? null,
    getItem: (k: string) => {
      if (panne.lire) throw new DOMException('refusé', 'SecurityError');
      return donnees[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (panne.ecrire) throw new DOMException('plein', 'QuotaExceededError');
      donnees[k] = v;
    },
    removeItem: (k: string) => {
      delete donnees[k];
    },
  };
}

const AVEC_PERSO: ReglagesCompagnon = {
  choix: 'perso-maya',
  range: false,
  perso: [{ id: 'perso-maya', nom: 'Maya', image: urlDeDonnees(PNG_1PX, 'image/png'), images: 4 }],
};

describe('le rangement — par personne, et jamais une panne', () => {
  it('la clé est propre à chaque compte, `anonyme` sans session', () => {
    expect(cleDuCompagnon('u-1')).not.toBe(cleDuCompagnon('u-2'));
    expect(cleDuCompagnon(null)).toBe('hive.compagnon.v1.anonyme');
  });

  it('ce qui est écrit se relit tel quel', () => {
    const s = stockage();
    expect(ecrireReglages('k', AVEC_PERSO, s)).toBe(true);
    expect(lireReglages('k', s)).toEqual(AVEC_PERSO);
  });

  it('UN QUOTA PLEIN rend `false`, sans lever', () => {
    expect(ecrireReglages('k', AVEC_PERSO, stockage({}, { ecrire: true }))).toBe(false);
    expect(ecrireReglages('k', AVEC_PERSO, null)).toBe(false);
  });

  it('UN STOCKAGE BLOQUÉ, VIDE OU ILLISIBLE → les réglages par défaut, sans lever', () => {
    expect(lireReglages('k', stockage({}, { lire: true }))).toEqual(REGLAGES_PAR_DEFAUT);
    expect(lireReglages('k', stockage())).toEqual(REGLAGES_PAR_DEFAUT);
    expect(lireReglages('k', stockage({ k: '{pas du json' }))).toEqual(REGLAGES_PAR_DEFAUT);
    expect(lireReglages('k', stockage({ k: 'null' }))).toEqual(REGLAGES_PAR_DEFAUT);
    expect(lireReglages('k', null)).toEqual(REGLAGES_PAR_DEFAUT);
  });

  it('CE QUI A ÉTÉ TRAFIQUÉ DANS LE STOCKAGE EST REVALIDÉ — une image SVG n’y survit pas', () => {
    const trafique = {
      choix: 'perso-piege',
      range: 'oui',
      perso: [
        {
          id: 'perso-piege',
          nom: 'Piège',
          image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
          images: 1,
        },
        {
          id: 'perso-html',
          nom: 'Page',
          image: 'data:text/html,<script>alert(1)</script>',
          images: 1,
        },
        { id: '"><img>', nom: 'Id', image: AVEC_PERSO.perso[0]?.image, images: 1 },
        { id: 'perso-ok', nom: ' Ok\u202e ', image: AVEC_PERSO.perso[0]?.image, images: 99 },
        { id: 'perso-bon', nom: 'Bon', image: AVEC_PERSO.perso[0]?.image, images: 2 },
      ],
    };
    const lu = lireReglages('k', stockage({ k: JSON.stringify(trafique) }));
    expect(lu.perso.map((p) => p.id)).toEqual(['perso-bon']);
    // Le choix désignait une entrée écartée : retour au défaut, pas à un fantôme.
    expect(lu.choix).toBe('abeille');
    expect(lu.range).toBe(false);
  });

  it('au plus trois compagnons personnels sont relus', () => {
    const image = AVEC_PERSO.perso[0]?.image;
    const perso = [1, 2, 3, 4, 5].map((i) => ({
      id: `perso-${i}`,
      nom: `N${i}`,
      image,
      images: 1,
    }));
    const lu = lireReglages('k', stockage({ k: JSON.stringify({ choix: 'bourdon', perso }) }));
    expect(lu.perso).toHaveLength(3);
    expect(lu.choix).toBe('bourdon');
  });
});
