// La porte — rejoindre en ouvrant UN lien (`shared/porte.ts`, la partie pure).
//
// Ce qu'on prouve ici sans réseau : un lien se compose et se relit sans
// perte ; un lien bricolé (chemin et fragment qui désignent deux billets,
// schéma inconnu, fragment tronqué) n'est PAS un lien ; le lien profond de
// l'application n'ouvre que `hive://rejoindre/…` ; et la commande composée par
// la page est, caractère pour caractère, celle que la ruche compose.

import { describe, expect, it } from 'vitest';
import { PREFIXE_BILLET, encoderBillet, tirerSecret, type Billet } from '../src/shared/acces.js';
import { commandeEntree } from '../src/shared/commande-entree.js';
import {
  CHEMIN_PORTE,
  billetDuLien,
  billetDuLienProfond,
  estLienDePorte,
  lienDePorte,
  lienProfond,
  systemeDepuisUserAgent,
} from '../src/shared/porte.js';

const LIMITES = { id: 80, nom: 200 };

const billet = (surcharge: Partial<Billet> = {}): Billet => ({
  url: 'wss://ruche.exemple.org/ws',
  id: 'bil-0f3c7e2a-9b1d-4c6e-8a5f-1234567890ab',
  secret: tirerSecret(),
  label: 'Ruche de Micka',
  ...surcharge,
});

describe('le lien de porte', () => {
  it('se compose depuis l’adresse HTTP de la ruche, le billet ENTIER dans le fragment', () => {
    const b = billet();
    const lien = lienDePorte(b);
    expect(lien).toBe(`https://ruche.exemple.org${CHEMIN_PORTE}${b.id}#${encoderBillet(b)}`);
    // Rien du secret avant le `#` : ce qui part au serveur s'arrête à l'identifiant.
    expect(lien!.split('#')[0]).not.toContain(b.secret);
    expect(lien!.split('#')[0]).not.toContain(PREFIXE_BILLET);
  });

  it('suit le transport : ws:// donne http://, un port reste', () => {
    const b = billet({ url: 'ws://192.168.1.10:7777/ws' });
    expect(lienDePorte(b)).toMatch(/^http:\/\/192\.168\.1\.10:7777\/r\//);
  });

  it('se RELIT : le billet revient identique, libellé compris', () => {
    const b = billet();
    expect(billetDuLien(lienDePorte(b), LIMITES)).toEqual(b);
    expect(estLienDePorte(lienDePorte(b))).toBe(true);
  });

  it('accepte une base explicite (la Reine derrière un autre nom)', () => {
    const b = billet();
    expect(lienDePorte(b, 'https://hive.interne/')).toBe(
      `https://hive.interne/r/${b.id}#${encoderBillet(b)}`,
    );
  });

  it.each([
    ['un identifiant hors grammaire', { id: 'bil/../x' }],
    ['une URL de ruche illisible', { url: 'https://pas-un-ws' }],
  ])('refuse %s', (_quoi, surcharge) => {
    expect(lienDePorte(billet(surcharge as Partial<Billet>))).toBeNull();
  });

  it('REFUSE un lien dont le chemin et le fragment désignent deux billets', () => {
    const a = billet();
    const b = billet({ id: 'bil-autre' });
    const bricole = `https://ruche.exemple.org/r/${a.id}#${encoderBillet(b)}`;
    expect(billetDuLien(bricole, LIMITES)).toBeNull();
  });

  it.each([
    ['sans fragment', 'https://ruche.exemple.org/r/bil-x'],
    ['fragment tronqué', 'https://ruche.exemple.org/r/bil-x#hive2_abc'],
    ['fragment qui n’est pas un billet', 'https://ruche.exemple.org/r/bil-x#secret'],
    ['autre chemin', 'https://ruche.exemple.org/rejoindre/bil-x#hive2_abc'],
    ['schéma ftp', 'ftp://ruche.exemple.org/r/bil-x#hive2_abc'],
    ['pas une URL', 'bil-x#hive2_abc'],
    ['vide', ''],
  ])('n’est pas un lien : %s', (_quoi, texte) => {
    expect(billetDuLien(texte, LIMITES)).toBeNull();
    expect(estLienDePorte(texte)).toBe(false);
  });

  it('un lien de 5 000 caractères est jeté sans être lu', () => {
    expect(billetDuLien(`https://x/r/a#${'A'.repeat(5_000)}`, LIMITES)).toBeNull();
  });
});

describe('le lien profond de l’application', () => {
  it('`hive://rejoindre/<billet>` : composé et relu sans perte', () => {
    const b = billet();
    const lien = lienProfond(b);
    expect(lien).toBe(`hive://rejoindre/${encoderBillet(b)}`);
    expect(billetDuLienProfond(lien, LIMITES)).toEqual(b);
  });

  it.each([
    ['l’hôte de la navigation', 'hive://ouvrir/projets'],
    ['un paramètre', `hive://rejoindre/${encoderBillet(billet())}?x=1`],
    ['un fragment', `hive://rejoindre/${encoderBillet(billet())}#x`],
    ['un billet hors alphabet', 'hive://rejoindre/hive2_abc;rm -rf'],
    ['un autre schéma', `https://rejoindre/${encoderBillet(billet())}`],
    ['rien', 'hive://rejoindre/'],
  ])('refuse %s', (_quoi, lien) => {
    expect(billetDuLienProfond(lien, LIMITES)).toBeNull();
  });
});

describe('la commande de la page est celle de la ruche', () => {
  it('les deux systèmes, caractère pour caractère', () => {
    // La page compose la commande en JavaScript à partir du fragment ; ce test
    // fixe la référence côté ruche que `porte-page.test.ts` compare à la page.
    const b = encoderBillet(billet());
    expect(commandeEntree(b, 'posix')).toBe(
      `curl -fsSL https://raw.githubusercontent.com/Micka420-collab/hive/main/rejoindre.sh | sh -s -- ${b}`,
    );
    expect(commandeEntree(b, 'windows')).toContain(`-Billet ${b}`);
  });
});

describe('le système d’après le User-Agent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', 'linux'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', 'autre'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari', 'autre'],
    ['', 'autre'],
    [undefined, 'autre'],
  ])('%s → %s', (ua, attendu) => {
    expect(systemeDepuisUserAgent(ua)).toBe(attendu);
  });
});
