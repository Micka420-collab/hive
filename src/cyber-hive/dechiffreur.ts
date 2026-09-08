// Module de déchiffrement universel pour Cyber Hive.
// Permet à l'IA d'orchestrateur de déchiffrer tout type de document
// chiffré ou encodé, avec détection automatique du format.
//
// Algorithmes supportés :
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
  | 'auto';

/** Format d'encodage détecté pour l'entrée. */
export type FormatDetecte =
  | 'base64'
  | 'base64url'
  | 'hex'
  | 'binaire'
  | 'texte';

/** Options de déchiffrement. */
export interface OptionsDechiffrement {
  /** Algorithme à utiliser ('auto' pour détection automatique). */
  algorithme?: AlgorithmeDechiffrement;
  /** Clé de déchiffrement (Buffer ou string, encodée en UTF-8 si string). */
  cle?: Buffer | string;
  /** Vecteur d'initialisation (16 ou 12 octets selon l'algorithme). */
  iv?: Buffer | string;
  /** Tag d'authentification pour les modes AEAD (GCM, ChaCha20-Poly1305). */
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

  // RSA si une clé PEM est fournie
  if (clePriveePem || options.clePubliquePem) {
    return 'rsa-oaep';
  }

  // AEAD si un tag est présent
  if (tag) {
    const ivLen = typeof iv === 'string' ? Buffer.from(iv).length : iv?.length ?? 0;
    if (ivLen === 12) return 'chacha20-poly1305';
    return 'aes-256-gcm';
  }

  // CBC si un IV est présent
  if (iv) {
    const ivLen = typeof iv === 'string' ? Buffer.from(iv).length : iv.length;
    if (ivLen === 8) {
      // IV de 8 octets : 3DES ou Blowfish
      const cleLen = typeof cle === 'string' ? Buffer.from(cle).length : cle?.length ?? 0;
      if (cleLen >= 16 && cleLen <= 24) return '3des-cbc';
      return 'blowfish-cbc';
    }
    if (ivLen === 16) {
      const cleLen = typeof cle === 'string' ? Buffer.from(cle).length : cle?.length ?? 0;
      if (cleLen === 16) return 'aes-128-cbc';
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
//   Déchiffreurs par algorithme
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
  const algorithmes: AlgorithmeDechiffrement[] = [
    'base64',
    'base64url',
    'hex',
    'rot13',
  ];

  // Essayer d'abord les encodages simples sans clé
  for (const algo of algorithmes) {
    const resultat = dechiffrer(entree, { algorithme: algo });
    if (resultat.succes) return resultat;
  }

  // Essayer avec chaque clé fournie
  for (const tentative of cles) {
    const algosAvecCle: AlgorithmeDechiffrement[] = [
      'aes-256-gcm',
      'aes-256-cbc',
      'aes-128-cbc',
      'chacha20-poly1305',
      '3des-cbc',
      'blowfish-cbc',
      'xor',
    ];
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
  ];
}