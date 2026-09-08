// Tests pour le module de déchiffrement universel.
// Vérifie les encodages simples, les algorithmes symétriques,
// la détection automatique et les cas d'erreur.
import { describe, it, expect } from 'vitest';
import {
  dechiffrer,
  dechiffrerAuto,
  detecterFormat,
  detecterAlgorithme,
  listerAlgorithmes,
} from '../dechiffreur';
import { createCipheriv, randomBytes } from 'node:crypto';

describe('dechiffreur — détection de format', () => {
  it('détecte le Base64 standard', () => {
    const encoded = Buffer.from('hello world').toString('base64');
    expect(detecterFormat(encoded)).toBe('base64');
  });

  it('détecte le Base64URL', () => {
    const encoded = Buffer.from('hello world').toString('base64url');
    expect(detecterFormat(encoded)).toBe('base64url');
  });

  it('détecte l\'hexadécimal', () => {
    const encoded = Buffer.from('test').toString('hex');
    expect(detecterFormat(encoded)).toBe('hex');
  });

  it('détecte le texte simple', () => {
    expect(detecterFormat('Ceci est du texte simple')).toBe('texte');
  });

  it('détecte le binaire (Buffer)', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detecterFormat(buf)).toBe('binaire');
  });
});

describe('dechiffreur — détection d\'algorithme', () => {
  it('détecte RSA quand une clé PEM est fournie', () => {
    const result = detecterAlgorithme({ clePriveePem: '-----BEGIN PRIVATE KEY-----' });
    expect(result).toBe('rsa-oaep');
  });

  it('détecte AES-256-GCM quand un tag est présent (IV 16)', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(32),
      iv: randomBytes(16),
      tag: randomBytes(16),
    });
    expect(result).toBe('aes-256-gcm');
  });

  it('détecte ChaCha20-Poly1305 quand un tag est présent (IV 12)', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(32),
      iv: randomBytes(12),
      tag: randomBytes(16),
    });
    expect(result).toBe('chacha20-poly1305');
  });

  it('détecte AES-256-CBC quand IV 16 et clé 32', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(32),
      iv: randomBytes(16),
    });
    expect(result).toBe('aes-256-cbc');
  });

  it('détecte AES-128-CBC quand IV 16 et clé 16', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(16),
      iv: randomBytes(16),
    });
    expect(result).toBe('aes-128-cbc');
  });

  it('détecte 3DES-CBC quand IV 8 et clé 16-24', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(24),
      iv: randomBytes(8),
    });
    expect(result).toBe('3des-cbc');
  });

  it('détecte Blowfish-CBC quand IV 8 et clé courte', () => {
    const result = detecterAlgorithme({
      cle: randomBytes(8),
      iv: randomBytes(8),
    });
    expect(result).toBe('blowfish-cbc');
  });
});

describe('dechiffreur — Base64', () => {
  it('déchiffre le Base64 standard', () => {
    const original = 'Document secret';
    const encoded = Buffer.from(original).toString('base64');
    const result = dechiffrer(encoded, { algorithme: 'base64' });
    expect(result.succes).toBe(true);
    expect(result.contenu).toBe(original);
  });

  it('déchiffre le Base64URL', () => {
    const original = 'Document secret';
    const encoded = Buffer.from(original).toString('base64url');
    const result = dechiffrer(encoded, { algorithme: 'base64url' });
    expect(result.succes).toBe(true);
    expect(result.contenu).toBe(original);
  });
});

describe('dechiffreur — Hex', () => {
  it('déchiffre l\'hexadécimal', () => {
    const original = 'test';
    const encoded = Buffer.from(original).toString('hex');
    const result = dechiffrer(encoded, { algorithme: 'hex' });
    expect(result.succes).toBe(true);
    expect(result.contenu).toBe(original);
  });
});

describe('dechiffreur — XOR', () => {
  it('déchiffre XOR avec une clé simple', () => {
    const original = Buffer.from('Secret data');
    const key = Buffer.from('key');
    const encrypted = Buffer.alloc(original.length);
    for (let i = 0; i < original.length; i++) {
      encrypted[i] = original[i] ^ key[i % key.length];
    }
    const result = dechiffrer(encrypted, { algorithme: 'xor', cle: key });
    expect(result.succes).toBe(true);
    expect(result.contenu).toBe(original);
  });
});

describe('dechiffreur — ROT13', () => {
  it('applique ROT13 correctement', () => {
    const original = 'Hello World';
    const rot13 = original.replace(/[a-zA-Z]/g, (char) => {
      const code = char.charCodeAt(0);
      const base = code >= 65 && code <= 90 ? 65 : 97;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    });
    const result = dechiffrer(rot13, { algorithme: 'rot13' });
    expect(result.succes).toBe(true);
    expect(result.contenu).toBe(original);
  });
});

describe('dechiffreur — AES-256-GCM', () => {
  it('déchiffre AES-256-GCM avec clé, IV et tag', () => {
    const cle = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = Buffer.from('Document militaire top secret');

    const cipher = createCipheriv('aes-256-gcm', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: 'aes-256-gcm',
      cle,
      iv,
      tag,
      encodageSortie: 'utf8',
    });

    expect(result.succes).toBe(true);
    expect(result.contenu).toBe('Document militaire top secret');
  });

  it('échoue avec un mauvais tag', () => {
    const cle = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = Buffer.from('test');

    const cipher = createCipheriv('aes-256-gcm', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const badTag = randomBytes(16);

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: 'aes-256-gcm',
      cle,
      iv,
      tag: badTag,
    });

    expect(result.succes).toBe(false);
    expect(result.erreur).toBeDefined();
  });
});

describe('dechiffreur — AES-256-CBC', () => {
  it('déchiffre AES-256-CBC avec clé et IV', () => {
    const cle = randomBytes(32);
    const iv = randomBytes(16);
    const plaintext = Buffer.from('Document chiffré en CBC');

    const cipher = createCipheriv('aes-256-cbc', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: 'aes-256-cbc',
      cle,
      iv,
      encodageSortie: 'utf8',
    });

    expect(result.succes).toBe(true);
    expect(result.contenu).toBe('Document chiffré en CBC');
  });
});

describe('dechiffreur — ChaCha20-Poly1305', () => {
  it('déchiffre ChaCha20-Poly1305 avec clé, IV et tag', () => {
    const cle = randomBytes(32);
    const iv = randomBytes(12);
    const plaintext = Buffer.from('ChaCha20 test data');

    const cipher = createCipheriv('chacha20-poly1305', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: 'chacha20-poly1305',
      cle,
      iv,
      tag,
      encodageSortie: 'utf8',
    });

    expect(result.succes).toBe(true);
    expect(result.contenu).toBe('ChaCha20 test data');
  });
});

describe('dechiffreur — 3DES-CBC', () => {
  it('déchiffre 3DES-CBC avec clé 24 octets et IV 8', () => {
    const cle = randomBytes(24);
    const iv = randomBytes(8);
    const plaintext = Buffer.from('3DES secret data');

    const cipher = createCipheriv('des-ede3-cbc', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: '3des-cbc',
      cle,
      iv,
      encodageSortie: 'utf8',
    });

    expect(result.succes).toBe(true);
    expect(result.contenu).toBe('3DES secret data');
  });
});

describe('dechiffreur — Blowfish-CBC', () => {
  it('déchiffre Blowfish-CBC avec clé et IV', () => {
    const cle = randomBytes(16);
    const iv = randomBytes(8);
    const plaintext = Buffer.from('Blowfish test');

    const cipher = createCipheriv('bf-cbc', cle, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    const result = dechiffrer(encrypted.toString('base64'), {
      algorithme: 'blowfish-cbc',
      cle,
      iv,
      encodageSortie: 'utf8',
    });

    expect(result.succes).toBe(true);
    expect(result.contenu).toBe('Blowfish test');
  });
});

describe('dechiffreur — détection automatique (dechiffrerAuto)', () => {
  it('détecte automatiquement le Base64', () => {
    const original = 'Auto-detect me';
    const encoded = Buffer.from(original).toString('base64');
    const result = dechiffrerAuto(encoded);
    expect(result.succes).toBe(true);
    expect(result.algorithme).toBe('base64');
  });

  it('détecte automatiquement l\'hex', () => {
    const original = 'hex auto';
    const encoded = Buffer.from(original).toString('hex');
    const result = dechiffrerAuto(encoded);
    expect(result.succes).toBe(true);
    expect(result.algorithme).toBe('hex');
  });

  it('retourne un échec si aucun algorithme ne fonctionne', () => {
    const random = randomBytes(64).toString('utf8');
    const result = dechiffrerAuto(random);
    expect(result.succes).toBe(false);
  });
});

describe('dechiffreur — métadonnées', () => {
  it('retourne les métadonnées (tailles, durée)', () => {
    const encoded = Buffer.from('test metadata').toString('base64');
    const result = dechiffrer(encoded, { algorithme: 'base64' });
    expect(result.succes).toBe(true);
    expect(result.metadonnees).toBeDefined();
    expect(result.metadonnees!.tailleEntree).toBe(encoded.length);
    expect(result.metadonnees!.tailleSortie).toBeGreaterThan(0);
    expect(result.metadonnees!.dureeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('dechiffreur — listerAlgorithmes', () => {
  it('retourne la liste complète des algorithmes', () => {
    const algos = listerAlgorithmes();
    expect(algos).toContain('aes-256-gcm');
    expect(algos).toContain('aes-256-cbc');
    expect(algos).toContain('chacha20-poly1305');
    expect(algos).toContain('3des-cbc');
    expect(algos).toContain('blowfish-cbc');
    expect(algos).toContain('rsa-oaep');
    expect(algos).toContain('base64');
    expect(algos).toContain('hex');
    expect(algos).toContain('xor');
    expect(algos).toContain('rot13');
    expect(algos.length).toBeGreaterThanOrEqual(13);
  });
});

describe('dechiffreur — gestion d\'erreurs', () => {
  it('retourne une erreur pour un algorithme inconnu explicite', () => {
    const result = dechiffrer('test', { algorithme: 'aes-256-gcm' as any });
    expect(result.succes).toBe(false);
    expect(result.erreur).toBeDefined();
  });

  it('retourne une erreur si la clé est manquante pour AES', () => {
    const result = dechiffrer('dGVzdA==', { algorithme: 'aes-256-gcm' });
    expect(result.succes).toBe(false);
    expect(result.erreur).toContain('clé');
  });
});