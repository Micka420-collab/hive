// Module de déchiffrement universel pour Cyber Hive.
// Permet à l'IA d'orchestrateur de déchiffrer tout type de document
// chiffré ou encodé, avec détection automatique du format.
//
// Algorithmes supportés :
//   ─ Standards civils ─
//   - AES-256-GCM (avec tag d'authentification)
//   - AES-256-CBC / AES-128-CBC (avec IV)
//   - ChaCha20-Poly1305 (avec tag)
//   - 3DES-CBC (Triple DES)
//   - Blowfish-CBC
//   - RSA-OAEP / RSA-PKCS1 (clé publique/privée)
//   - Base64 (standard, URL-safe)
//   - Hexadécimal
//   - XOR (clé simple)
//   - ROT13 (texte seulement)
//
//   ─ Militaires / Gouvernementaux ─
//   - AES-256-CCM (mode AEAD, FIPS-140, NSA Suite B)
//   - AES-256-XTS (chiffrement de stockage, NIST SP 800-38E)
//   - DES-CBC (historique, FIPS 46-3, déprécié)
//   - Camellia-256-CBC (standard japonais/EU, ISO/IEC 18033-3)
//   - Cascade cipher (chiffrement en cascade multi-algorithmes)
//   - Stéganographie LSB (extraction de données cachées dans images)
//   - Brute-force XOR (test de toutes les clés 1-octet)
//
// Utilise exclusivement le module `crypto` natif de Node.js,
// aucune dépendance externe requise.

import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  publicDecrypt,
  privateDecrypt,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Types
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Algorithme de chiffrement reconnu par le déchiffreur. */
export type AlgorithmeDechiffrement =
  | 'aes-256-gcm'
  | 'aes-256-cbc'
  | 'aes-128-cbc'
  | 'chacha20-poly1305'
  | '3des-cbc'
  | 'blowfish-cbc'
  | 'rsa-oaep'
  | 'rsa-pkcs1'
  | 'base64'
  | 'base64url'
  | 'hex'
  | 'xor'
  | 'rot13'
  // Algorithmes militaires / gouvernementaux
  | 'aes-256-ccm'
  | 'aes-256-xts'
  | 'des-cbc'
  | 'camellia-256-cbc'
  | 'cascade'
  | 'steganographie-lsb'
  | 'brute-force-xor'
  | 'auto';

/** Format d'encodage détecté pour l'entrée. */
export type FormatDetecte =
  | 'base64'
  | 'base64url'
  | 'hex'
  | 'binaire'
  | 'texte';

/** Étape d'une cascade de chiffrement. */
export interface EtapeCascade {
  algorithme: 'aes-256-gcm' | 'aes-256-cbc' | 'chacha20-poly1305' | 'aes-128-cbc';
  cle: Buffer | string;
  iv: Buffer | string;
  tag?: Buffer | string;
}

/** Options de déchiffrement. */
export interface OptionsDechiffrement {
  /** Algorithme à utiliser ('auto' pour détection automatique). */
  algorithme?: AlgorithmeDechiffrement;
  /** Clé de déchiffrement (Buffer ou string, encodée en UTF-8 si string). */
  cle?: Buffer | string;
  /** Vecteur d'initialisation (16 ou 12 octets selon l'algorithme). */
  iv?: Buffer | string;
  /** Tag d'authentification pour les modes AEAD (GCM, ChaCha20-Poly1305, CCM). */
  tag?: Buffer | string;
  /** Clé privée PEM pour RSA. */
  clePriveePem?: string;
  /** Clé publique PEM pour RSA (déchiffrement côté émetteur). */
  clePubliquePem?: string;
  /** Mot de passe pour dériver la clé (PBKDF2). */
  motDePasse?: string;
  /** Sel pour la dérivation de clé. */
  sel?: Buffer | string;
  /** Longueur de clé dérivée en octets (défaut : 32 pour AES-256). */
  longueurCle?: number;
  /** Nombre d'itérations PBKDF2 (défaut : 100000). */
  iterations?: number;
  /** Encodage de sortie ('utf8' pour texte, 'buffer' pour binaire). */
  encodageSortie?: 'utf8' | 'buffer';
  /** Indique si l'entrée est un fichier binaire (Buffer) ou texte. */
  formatEntree?: FormatDetecte;
  /** Étapes pour le déchiffrement en cascade (du plus externe au plus interne). */
  cascade?: EtapeCascade[];
  /** Longueur du tag pour AES-CCM (défaut : 16). */
  longueurTag?: number;
  /** Longueur de l'IV pour AES-CCM (7, 8, 9, 10, 11, 12 ou 13). */
  longueurIvCcm?: number;
}

/** Résultat d'une opération de déchiffrement. */
export interface ResultatDechiffrement {
  /** true si le déchiffrement a réussi. */
  succes: boolean;
  /** Contenu déchiffré (string si encodageSortie='utf8', Buffer sinon). */
  contenu: string | Buffer;
  /** Algorithme utilisé (détecté ou explicite). */
  algorithme: AlgorithmeDechiffrement;
  /** Format d'encodage détecté en entrée. */
  formatEntree: FormatDetecte;
  /** Message d'erreur en cas d'échec. */
  erreur?: string;
  /** Métadonnées supplémentaires (taille originale, taille déchiffrée, etc.). */
  metadonnees?: {
    tailleEntree: number;
    tailleSortie: number;
    dureeMs: number;
  };
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Détection automatique de format
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Détecte le format d'encodage d'une chaîne d'entrée.
 * Ordre de détection : Base64URL > Base64 > Hex > Binaire > Texte.
 */
export function detecterFormat(entree: string | Buffer): FormatDetecte {
  const str = typeof entree === 'string' ? entree : entree.toString('utf8');

  // Base64URL : caractères A-Za-z0-9-_ sans padding, longueur multiple de 4
  if (/^[A-Za-z0-9_-]+={0,2}$/.test(str) && str.length % 4 === 0 && str.length >= 4) {
    try {
      Buffer.from(str, 'base64url');
      return 'base64url';
    } catch {
      // ignore
    }
  }

  // Base64 standard : caractères A-Za-z0-9+/ avec padding optionnel
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(str) && str.length % 4 === 0 && str.length >= 4) {
    try {
      Buffer.from(str, 'base64');
      return 'base64';
    } catch {
      // ignore
    }
  }

  // Hexadécimal : caractères 0-9a-fA-F, longueur paire
  if (/^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0 && str.length >= 2) {
    return 'hex';
  }

  // Binaire : contient des caractères non-imprimables
  if (typeof entree === 'object') {
    return 'binaire';
  }

  // Vérifier si la chaîne contient des octets non-imprimables
  for (let i = 0; i < Math.min(str.length, 100); i++) {
    const code = str.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return 'binaire';
    }
  }

  return 'texte';
}

/**
 * Détecte l'algorithme de chiffrement probable à partir des métadonnées
 * (taille de la clé, présence d'un IV, d'un tag, etc.).
 */
export function detecterAlgorithme(options: OptionsDechiffrement): AlgorithmeDechiffrement {
  const cle = options.cle;
  const iv = options.iv;
  const tag = options.tag;
  const clePriveePem = options.clePriveePem;

  // Cascade si des étapes sont fournies
  if (options.cascade && options.cascade.length > 0) {
    return 'cascade';
  }

  // RSA si une clé PEM est fournie
  if (clePriveePem || options.clePubliquePem) {
    return 'rsa-oaep';
  }

  // AEAD si un tag est présent
  if (tag) {
    const ivLen = typeof iv === 'string' ? Buffer.from(iv).length : iv?.length ?? 0;
    if (ivLen === 12) return 'chacha20-poly1305';
    // AES-CCM utilise aussi des IV courts (7-13 octets)
    if (ivLen >= 7 && ivLen <= 13 && ivLen !== 12) return 'aes-256-ccm';
    return 'aes-256-gcm';
  }

  // CBC si un IV est présent
  if (iv) {
    const ivLen = typeof iv === 'string' ? Buffer.from(iv).length : iv.length;
    if (ivLen === 8) {
      // IV de 8 octets : 3DES, Blowfish ou DES
      const cleLen = typeof cle === 'string' ? Buffer.from(cle).length : cle?.length ?? 0;
      if (cleLen === 8) return 'des-cbc';
      if (cleLen >= 16 && cleLen <= 24) return '3des-cbc';
      return 'blowfish-cbc';
    }
    if (ivLen === 16) {
      const cleLen = typeof cle === 'string' ? Buffer.from(cle).length : cle?.length ?? 0;
      if (cleLen === 16) return 'aes-128-cbc';
      if (cleLen === 32) return 'aes-256-cbc';
      // Camellia utilise aussi un IV de 16 octets
      if (cleLen === 32) return 'camellia-256-cbc';
      return 'aes-256-cbc';
    }
  }

  // Par défaut, tenter Base64
  return 'base64';
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Utilitaires internes
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Convertit une entrée en Buffer. */
function versBuffer(entree: Buffer | string, encodage?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(entree)) return entree;
  return Buffer.from(entree, encodage ?? 'utf8');
}

/** Dérive une clé à partir d'un mot de passe via PBKDF2. */
function deriverCle(
  motDePasse: string,
  sel: Buffer,
  longueur: number,
  iterations: number,
): Buffer {
  const { pbkdf2Sync } = require('node:crypto');
  return pbkdf2Sync(motDePasse, sel, iterations, longueur, 'sha256');
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Déchiffreurs par algorithme — Standards civils
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Déchiffre AES-256-GCM. */
function dechiffrerAESGCM(
  donnees: Buffer,
  cle: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', cle, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/** Déchiffre AES-CBC (128 ou 256). */
function dechiffrerAESCBC(
  donnees: Buffer,
  cle: Buffer,
  iv: Buffer,
  tailleCle: 128 | 256,
): Buffer {
  const algo = `aes-${tailleCle}-cbc`;
  const decipher = createDecipheriv(algo, cle, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/** Déchiffre ChaCha20-Poly1305. */
function dechiffrerChaCha20(
  donnees: Buffer,
  cle: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  const decipher = createDecipheriv('chacha20-poly1305', cle, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/** Déchiffre 3DES-CBC. */
function dechiffrer3DES(donnees: Buffer, cle: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('des-ede3-cbc', cle, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/** Déchiffre Blowfish-CBC. */
function dechiffrerBlowfish(donnees: Buffer, cle: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('bf-cbc', cle, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/** Déchiffre RSA (OAEP ou PKCS1). */
function dechiffrerRSA(
  donnees: Buffer,
  clePem: string,
  oaep: boolean,
): Buffer {
  const key = createPrivateKey(clePem);
  if (oaep) {
    return privateDecrypt(
      { key, padding: 1 /* RSA_PKCS1_OAEP_PADDING */, oaepHash: 'sha256' },
      donnees,
    );
  }
  return privateDecrypt(key, donnees);
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Déchiffreurs — Algorithmes militaires / gouvernementaux
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Déchiffre AES-256-CCM (Counter with CBC-MAC).
 * Mode AEAD utilisé dans FIPS-140 et NSA Suite B.
 * L'IV doit faire entre 7 et 13 octets, le tag entre 4 et 16 octets.
 */
function dechiffrerAESCCM(
  donnees: Buffer,
  cle: Buffer,
  iv: Buffer,
  tag: Buffer,
  longueurTag: number,
): Buffer {
  const decipher = createDecipheriv('aes-256-ccm', cle, iv, {
    authTagLength: longueurTag,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/**
 * Déchiffre AES-256-XTS (XEX-based Tweaked-codebook mode).
 * Utilisé pour le chiffrement de stockage (BitLocker, FileVault, LUKS).
 * NIST SP 800-38E. La clé doit faire 64 octets (2 x 32 pour deux clés).
 */
function dechiffrerAESXTS(
  donnees: Buffer,
  cle: Buffer,
  iv: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-xts', cle, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/**
 * Déchiffre DES-CBC (Data Encryption Standard).
 * Historique, FIPS 46-3, déprécié. Clé de 8 octets, IV de 8 octets.
 * Conservé pour la rétrocompatibilité et l'analyse forensique.
 */
function dechiffrerDES(donnees: Buffer, cle: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('des-cbc', cle, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/**
 * Déchiffre Camellia-256-CBC.
 * Standard de chiffrement japonais et européen, ISO/IEC 18033-3.
 * Alternative à AES, utilisé dans TLS et IPsec.
 */
function dechiffrerCamellia(donnees: Buffer, cle: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv('camellia-256-cbc', cle, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(donnees), decipher.final()]);
}

/**
 * Déchiffre une cascade de chiffrements.
 * Applique chaque étape dans l'ordre inverse du chiffrement
 * (du plus externe au plus interne).
 */
function dechiffrerCascade(donnees: Buffer, etapes: EtapeCascade[]): Buffer {
  let resultat = donnees;
  for (const etape of etapes) {
    const cle = versBuffer(etape.cle);
    const iv = versBuffer(etape.iv);
    const tag = etape.tag ? versBuffer(etape.tag) : undefined;

    switch (etape.algorithme) {
      case 'aes-256-gcm':
        if (!tag) throw new Error('AES-256-GCM en cascade nécessite un tag.');
        resultat = dechiffrerAESGCM(resultat, cle, iv, tag);
        break;
      case 'aes-256-cbc':
        resultat = dechiffrerAESCBC(resultat, cle, iv, 256);
        break;
      case 'aes-128-cbc':
        resultat = dechiffrerAESCBC(resultat, cle, iv, 128);
        break;
      case 'chacha20-poly1305':
        if (!tag) throw new Error('ChaCha20-Poly1305 en cascade nécessite un tag.');
        resultat = dechiffrerChaCha20(resultat, cle, iv, tag);
        break;
      default:
        throw new Error(`Algorithme non supporté en cascade : ${etape.algorithme}`);
    }
  }
  return resultat;
}

/**
 * Extrait des données cachées par stéganographie LSB (Least Significant Bit)
 * dans une image (Buffer PNG/BMP/RAW).
 * Parcourt les octets et extrait le bit de poids faible de chaque octet
 * pour reconstruire le message caché.
 *
 * @param donnees - Buffer de l'image contenant les données cachées
 * @param longueurMax - Longueur maximale du message à extraire (défaut : 4096 octets)
 * @returns Buffer contenant le message extrait
 */
function extraireSteganographieLSB(
  donnees: Buffer,
  longueurMax: number = 4096,
): Buffer {
  // Sauter l'en-tête PNG (24 octets minimum) ou BMP (54 octets)
  let offset = 0;

  // Détection d'en-tête PNG
  if (donnees.length > 8 && donnees[0] === 0x89 && donnees[1] === 0x50) {
    offset = 24; // Sauter la signature IHDR
  }
  // Détection d'en-tête BMP
  else if (donnees.length > 2 && donnees[0] === 0x42 && donnees[1] === 0x4d) {
    offset = 54;
  }

  const bits: number[] = [];
  const maxBits = longueurMax * 8;

  for (let i = offset; i < donnees.length && bits.length < maxBits; i++) {
    bits.push(donnees[i] & 1);
  }

  // Reconstruire les octets à partir des bits
  const octets: number[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let octet = 0;
    for (let j = 0; j < 8; j++) {
      octet = (octet << 1) | bits[i + j];
    }
    octets.push(octet);
  }

  return Buffer.from(octets);
}

/**
 * Brute-force XOR avec des clés d'un octet (0-255).
 * Tente chaque clé possible et retourne le premier résultat
 * qui produit du texte lisible (caractères ASCII imprimables).
 *
 * @param donnees - Données chiffrées par XOR
 * @returns Buffer déchiffré ou null si aucune clé ne produit du texte lisible
 */
function bruteForceXOR(donnees: Buffer): { cle: number; contenu: Buffer } | null {
  for (let cle = 0; cle < 256; cle++) {
    const resultat = Buffer.alloc(donnees.length);
    let lisible = true;

    for (let i = 0; i < donnees.length; i++) {
      const dec = donnees[i] ^ cle;
      resultat[i] = dec;
      // Vérifier si le caractère est imprimable (ASCII 32-126 + sauts de ligne)
      if (dec < 9 || (dec > 13 && dec < 32) || dec > 126) {
        if (i < 20) {
          // Les 20 premiers octets doivent être lisibles
          lisible = false;
          break;
        }
      }
    }

    if (lisible) {
      return { cle, contenu: resultat };
    }
  }
  return null;
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   Décodeurs simples
// ╚══════════════════════════════════════════════════════════════════════════╝

/** Décode Base64. */
function decoderBase64(donnees: string, urlSafe: boolean): Buffer {
  if (urlSafe) {
    // Convertir URL-safe vers standard
    const standard = donnees.replace(/-/g, '+').replace(/_/g, '/');
    const padding = standard.length % 4 === 0 ? '' : '='.repeat(4 - (standard.length % 4));
    return Buffer.from(standard + padding, 'base64');
  }
  return Buffer.from(donnees, 'base64');
}

/** Décode Hex. */
function decoderHex(donnees: string): Buffer {
  return Buffer.from(donnees, 'hex');
}

/** Déchiffre XOR avec une clé simple. */
function dechiffrerXOR(donnees: Buffer, cle: Buffer): Buffer {
  const resultat = Buffer.alloc(donnees.length);
  for (let i = 0; i < donnees.length; i++) {
    resultat[i] = donnees[i] ^ cle[i % cle.length];
  }
  return resultat;
}

/** Applique ROT13 (texte seulement). */
function dechiffrerROT13(donnees: string): string {
  return donnees.replace(/[a-zA-Z]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code >= 65 && code <= 90 ? 65 : 97;
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

// ╔══════════════════════════════════════════════════════════════════════════╗
//   API publique
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * Déchiffre un document chiffré ou encodé.
 *
 * @param entree - Données chiffrées (string ou Buffer)
 * @param options - Options de déchiffrement (algorithme, clé, IV, tag, etc.)
 * @returns Résultat du déchiffrement avec contenu, algorithme utilisé et métadonnées
 *
 * @example
 * ```ts
 * // Déchiffrement AES-256-GCM
 * const resultat = dechiffrer(donneesChiffrees, {
 *   algorithme: 'aes-256-gcm',
 *   cle: Buffer.from('ma-cle-de-32-octets-1234567890ab'),
 *   iv: Buffer.from('iv-12-octets'),
 *   tag: Buffer.from('tag-16-octets'),
 * });
 * ```
 */
export function dechiffrer(
  entree: string | Buffer,
  options: OptionsDechiffrement = {},
): ResultatDechiffrement {
  const debut = Date.now();
  const tailleEntree = typeof entree === 'string' ? entree.length : entree.length;
  const formatEntree = options.formatEntree ?? detecterFormat(entree);

  // Déterminer l'algorithme
  const algorithme: AlgorithmeDechiffrement =
    options.algorithme && options.algorithme !== 'auto'
      ? options.algorithme
      : detecterAlgorithme(options);

  try {
    let contenuDechiffre: Buffer | string;

    // Préparation de la clé (dérivation si mot de passe fourni)
    let cleBuffer: Buffer | undefined;
    if (options.motDePasse) {
      const sel = versBuffer(options.sel ?? randomBytes(16));
      const longueur = options.longueurCle ?? 32;
      const iterations = options.iterations ?? 100_000;
      cleBuffer = deriverCle(options.motDePasse, sel, longueur, iterations);
    } else if (options.cle) {
      cleBuffer = versBuffer(options.cle);
    }

    switch (algorithme) {
      case 'aes-256-gcm': {
        if (!cleBuffer || cleBuffer.length !== 32) {
          throw new Error('AES-256-GCM nécessite une clé de 32 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const tag = versBuffer(options.tag ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerAESGCM(donnees, cleBuffer, iv, tag);
        break;
      }

      case 'aes-256-cbc': {
        if (!cleBuffer || cleBuffer.length !== 32) {
          throw new Error('AES-256-CBC nécessite une clé de 32 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerAESCBC(donnees, cleBuffer, iv, 256);
        break;
      }

      case 'aes-128-cbc': {
        if (!cleBuffer || cleBuffer.length !== 16) {
          throw new Error('AES-128-CBC nécessite une clé de 16 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerAESCBC(donnees, cleBuffer, iv, 128);
        break;
      }

      case 'chacha20-poly1305': {
        if (!cleBuffer || cleBuffer.length !== 32) {
          throw new Error('ChaCha20-Poly1305 nécessite une clé de 32 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const tag = versBuffer(options.tag ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerChaCha20(donnees, cleBuffer, iv, tag);
        break;
      }

      case '3des-cbc': {
        if (!cleBuffer || cleBuffer.length < 16 || cleBuffer.length > 24) {
          throw new Error('3DES-CBC nécessite une clé de 16 à 24 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrer3DES(donnees, cleBuffer, iv);
        break;
      }

      case 'blowfish-cbc': {
        if (!cleBuffer || cleBuffer.length < 4) {
          throw new Error('Blowfish-CBC nécessite une clé d\'au moins 4 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerBlowfish(donnees, cleBuffer, iv);
        break;
      }

      case 'rsa-oaep': {
        if (!options.clePriveePem) {
          throw new Error('RSA-OAEP nécessite une clé privée PEM.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerRSA(donnees, options.clePriveePem, true);
        break;
      }

      case 'rsa-pkcs1': {
        if (!options.clePriveePem) {
          throw new Error('RSA-PKCS1 nécessite une clé privée PEM.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerRSA(donnees, options.clePriveePem, false);
        break;
      }

      // ── Algorithmes militaires / gouvernementaux ──

      case 'aes-256-ccm': {
        if (!cleBuffer || cleBuffer.length !== 32) {
          throw new Error('AES-256-CCM nécessite une clé de 32 octets.');
        }
        const ivLen = options.longueurIvCcm ?? 12;
        const iv = versBuffer(options.iv ?? '');
        if (iv.length < 7 || iv.length > 13) {
          throw new Error('AES-256-CCM nécessite un IV de 7 à 13 octets.');
        }
        const tag = versBuffer(options.tag ?? '');
        const longueurTag = options.longueurTag ?? 16;
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerAESCCM(donnees, cleBuffer, iv, tag, longueurTag);
        break;
      }

      case 'aes-256-xts': {
        if (!cleBuffer || cleBuffer.length !== 64) {
          throw new Error('AES-256-XTS nécessite une clé de 64 octets (2 x 32).');
        }
        const iv = versBuffer(options.iv ?? '');
        if (iv.length !== 16) {
          throw new Error('AES-256-XTS nécessite un IV de 16 octets.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerAESXTS(donnees, cleBuffer, iv);
        break;
      }

      case 'des-cbc': {
        if (!cleBuffer || cleBuffer.length !== 8) {
          throw new Error('DES-CBC nécessite une clé de 8 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        if (iv.length !== 8) {
          throw new Error('DES-CBC nécessite un IV de 8 octets.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerDES(donnees, cleBuffer, iv);
        break;
      }

      case 'camellia-256-cbc': {
        if (!cleBuffer || cleBuffer.length !== 32) {
          throw new Error('Camellia-256-CBC nécessite une clé de 32 octets.');
        }
        const iv = versBuffer(options.iv ?? '');
        if (iv.length !== 16) {
          throw new Error('Camellia-256-CBC nécessite un IV de 16 octets.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerCamellia(donnees, cleBuffer, iv);
        break;
      }

      case 'cascade': {
        if (!options.cascade || options.cascade.length === 0) {
          throw new Error('Cascade nécessite au moins une étape.');
        }
        const donnees = versBuffer(entree, 'base64');
        contenuDechiffre = dechiffrerCascade(donnees, options.cascade);
        break;
      }

      case 'steganographie-lsb': {
        const donnees = versBuffer(entree);
        contenuDechiffre = extraireSteganographieLSB(donnees);
        break;
      }

      case 'brute-force-xor': {
        const donnees = versBuffer(entree);
        const resultat = bruteForceXOR(donnees);
        if (resultat === null) {
          throw new Error('Aucune clé XOR d\'un octet ne produit du texte lisible.');
        }
        contenuDechiffre = resultat.contenu;
        break;
      }

      // ── Encodages simples ──

      case 'base64': {
        const donnees = typeof entree === 'string' ? entree : entree.toString('utf8');
        contenuDechiffre = decoderBase64(donnees, false);
        break;
      }

      case 'base64url': {
        const donnees = typeof entree === 'string' ? entree : entree.toString('utf8');
        contenuDechiffre = decoderBase64(donnees, true);
        break;
      }

      case 'hex': {
        const donnees = typeof entree === 'string' ? entree : entree.toString('utf8');
        contenuDechiffre = decoderHex(donnees);
        break;
      }

      case 'xor': {
        if (!cleBuffer) {
          throw new Error('XOR nécessite une clé.');
        }
        const donnees = versBuffer(entree);
        contenuDechiffre = dechiffrerXOR(donnees, cleBuffer);
        break;
      }

      case 'rot13': {
        const donnees = typeof entree === 'string' ? entree : entree.toString('utf8');
        contenuDechiffre = dechiffrerROT13(donnees);
        break;
      }

      default:
        throw new Error(`Algorithme non supporté : ${algorithme}`);
    }

    const dureeMs = Date.now() - debut;
    const tailleSortie = Buffer.isBuffer(contenuDechiffre)
      ? contenuDechiffre.length
      : contenuDechiffre.length;

    // Conversion de sortie
    const contenuFinal: string | Buffer =
      options.encodageSortie === 'utf8' && Buffer.isBuffer(contenuDechiffre)
        ? contenuDechiffre.toString('utf8')
        : contenuDechiffre;

    return {
      succes: true,
      contenu: contenuFinal,
      algorithme,
      formatEntree,
      metadonnees: {
        tailleEntree,
        tailleSortie,
        dureeMs,
      },
    };
  } catch (erreur) {
    return {
      succes: false,
      contenu: '',
      algorithme,
      formatEntree,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
      metadonnees: {
        tailleEntree,
        tailleSortie: 0,
        dureeMs: Date.now() - debut,
      },
    };
  }
}

/**
 * Déchiffre un fichier depuis un chemin local.
 * Lit le fichier, détecte le format et déchiffre.
 *
 * @param cheminFichier - Chemin absolu du fichier chiffré
 * @param options - Options de déchiffrement
 * @returns Résultat du déchiffrement
 */
export async function dechiffrerFichier(
  cheminFichier: string,
  options: OptionsDechiffrement = {},
): Promise<ResultatDechiffrement> {
  const { readFile } = require('node:fs/promises');
  const donnees = await readFile(cheminFichier);
  return dechiffrer(donnees, options);
}

/**
 * Tente le déchiffrement automatique en essayant plusieurs algorithmes.
 * Utile quand le format exact est inconnu.
 *
 * @param entree - Données chiffrées
 * @param cles - Liste de clés à essayer
 * @returns Premier résultat réussi ou dernier échec
 */
export function dechiffrerAuto(
  entree: string | Buffer,
  cles: Array<{ cle?: Buffer | string; iv?: Buffer | string; tag?: Buffer | string }> = [],
): ResultatDechiffrement {
  // Phase 1 : encodages simples sans clé
  const encodagesSimples: AlgorithmeDechiffrement[] = [
    'base64',
    'base64url',
    'hex',
    'rot13',
  ];

  for (const algo of encodagesSimples) {
    const resultat = dechiffrer(entree, { algorithme: algo });
    if (resultat.succes) return resultat;
  }

  // Phase 2 : brute-force XOR (clé 1 octet)
  const resultatXor = dechiffrer(entree, { algorithme: 'brute-force-xor' });
  if (resultatXor.succes) return resultatXor;

  // Phase 3 : stéganographie LSB (si données binaires)
  if (typeof entree === 'object' || detecterFormat(entree) === 'binaire') {
    const resultatSteg = dechiffrer(entree, { algorithme: 'steganographie-lsb' });
    if (resultatSteg.succes) return resultatSteg;
  }

  // Phase 4 : algorithmes symétriques avec chaque clé fournie
  const algosAvecCle: AlgorithmeDechiffrement[] = [
    'aes-256-gcm',
    'aes-256-cbc',
    'aes-128-cbc',
    'chacha20-poly1305',
    'aes-256-ccm',
    'aes-256-xts',
    'camellia-256-cbc',
    '3des-cbc',
    'des-cbc',
    'blowfish-cbc',
    'xor',
  ];

  for (const tentative of cles) {
    for (const algo of algosAvecCle) {
      const resultat = dechiffrer(entree, {
        algorithme: algo,
        cle: tentative.cle,
        iv: tentative.iv,
        tag: tentative.tag,
      });
      if (resultat.succes) return resultat;
    }
  }

  return {
    succes: false,
    contenu: '',
    algorithme: 'auto',
    formatEntree: detecterFormat(entree),
    erreur: 'Aucun algorithme n\'a permis de déchiffrer les données.',
  };
}

/**
 * Liste tous les algorithmes supportés par le déchiffreur.
 */
export function listerAlgorithmes(): AlgorithmeDechiffrement[] {
  return [
    // Standards civils
    'aes-256-gcm',
    'aes-256-cbc',
    'aes-128-cbc',
    'chacha20-poly1305',
    '3des-cbc',
    'blowfish-cbc',
    'rsa-oaep',
    'rsa-pkcs1',
    'base64',
    'base64url',
    'hex',
    'xor',
    'rot13',
    // Militaires / gouvernementaux
    'aes-256-ccm',
    'aes-256-xts',
    'des-cbc',
    'camellia-256-cbc',
    'cascade',
    'steganographie-lsb',
    'brute-force-xor',
  ];
}