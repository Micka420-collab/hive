// Parseur de cible en langage naturel pour Cyber Hive.
// Accepte une IP, URL, domaine ou description libre en entrée.
// Extrait hôte, ports, scope, type de cible et options.

import type { CiblePentest } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Patterns de reconnaissance
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

const REGEX_IP = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const REGEX_IP_PORT = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)\b/;
const REGEX_URL = /\bhttps?:\/\/([^\s/:]+)(?::(\d+))?(\/[^\s]*)?/i;
const REGEX_DOMAIN = /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?)\b/i;
const REGEX_PORT = /\bport[s]?\s*(\d+(?:\s*,\s*\d+)*)/i;
const REGEX_RANGE = /\bports?\s+(\d+)\s*[-à]\s*(\d+)/i;

/** Résultat du parsing en langage naturel. */
export interface ResultatParsing {
  cible: CiblePentest;
  confiance: number;
  explication: string;
  suggestions: string[];
}

/**
 * Parse une entrée en langage naturel et produit une cible de pentest structurée.
 * Accepte : "scan 192.168.1.1", "https://example.com", "test le site example.com sur les ports 80,443",
 * "192.168.1.0/24", "check example.com:8080", etc.
 */
export function parserCibleNaturelle(entree: string): ResultatParsing {
  const texte = entree.trim().toLowerCase();
  const suggestions: string[] = [];
  let hote = '';
  let ports: number[] | undefined;
  let url: string | undefined;
  let type: CiblePentest['type'] = 'reseau';
  let scopeAutorise: string[] = [];
  let confiance = 0.5;

  // 1. URL complète (http/https)
  const matchUrl = texte.match(REGEX_URL);
  if (matchUrl) {
    hote = matchUrl[1];
    const port = matchUrl[2];
    if (port) ports = [parseInt(port, 10)];
    url = matchUrl[0];
    type = 'web';
    confiance = 0.95;
    scopeAutorise.push(url);
  }

  // 2. IP avec port (192.168.1.1:8080)
  if (!hote) {
    const matchIpPort = texte.match(REGEX_IP_PORT);
    if (matchIpPort) {
      hote = matchIpPort[1];
      ports = [parseInt(matchIpPort[2], 10)];
      type = 'reseau';
      confiance = 0.9;
    }
  }

  // 3. IP simple ou avec CIDR
  if (!hote) {
    const matchIp = texte.match(REGEX_IP);
    if (matchIp) {
      hote = matchIp[1];
      type = 'reseau';
      confiance = 0.85;
      // Détecter CIDR
      const matchCidr = texte.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d+)\b/);
      if (matchCidr) {
        scopeAutorise.push(`${matchCidr[1]}/${matchCidr[2]}`);
        suggestions.push(`Plage CIDR détectée : ${matchCidr[1]}/${matchCidr[2]}. Scan de sous-réseau.`);
      }
    }
  }

  // 4. Domaine simple
  if (!hote) {
    const matchDomain = texte.match(REGEX_DOMAIN);
    if (matchDomain) {
      hote = matchDomain[1];
      type = hote.startsWith('www.') || !hote.match(/^\d/) ? 'web' : 'reseau';
      confiance = 0.8;
      // Si pas d'URL explicite, construire
      if (!url) {
        url = `https://${hote}`;
        scopeAutorise.push(url);
      }
    }
  }

  // 5. Ports explicites
  const matchPorts = texte.match(REGEX_PORT);
  if (matchPorts && !ports) {
    ports = matchPorts[1].split(',').map((p) => parseInt(p.trim(), 10));
  }

  // 6. Range de ports
  const matchRange = texte.match(REGEX_RANGE);
  if (matchRange && !ports) {
    const debut = parseInt(matchRange[1], 10);
    const fin = parseInt(matchRange[2], 10);
    ports = [];
    for (let p = debut; p <= fin && p <= 65535; p++) ports.push(p);
    if (ports.length > 100) {
      suggestions.push(`Range de ${ports.length} ports. Utilisation de masscan recommandée.`);
    }
  }

  // 7. Détection du type par mots-clés
  if (texte.includes('api') || texte.includes('rest') || texte.includes('graphql')) {
    type = 'api';
    scopeAutorise.push(`${url ?? hote}/api`);
    suggestions.push('Cible API détectée. Ajout de /api au scope.');
  }
  if (texte.includes('mobile') || texte.includes('android') || texte.includes('ios')) {
    type = 'mobile';
    suggestions.push('Cible mobile détectée. Frida sera nécessaire.');
  }
  if (texte.includes('interne') || texte.includes('lan') || texte.includes('réseau interne')) {
    type = 'interne';
    suggestions.push('Cible interne. Pas de routage TOR nécessaire.');
  }

  // 8. Détection du scope d'autorisation
  if (texte.includes('bug bounty') || texte.includes('autorise')) {
    scopeAutorise.push(hote);
    suggestions.push('Scope bug bounty détecté. Respect strict du périmètre.');
  }
  if (texte.includes('tout') || texte.includes('profond') || texte.includes('deep')) {
    suggestions.push('Mode approfondi activé : scan complet, tous les outils enchaînés.');
  }

  // 9. Si rien trouvé
  if (!hote) {
    return {
      cible: {
        hote: texte.replace(/[^a-z0-9.\-:/]/g, ''),
        type: 'reseau',
        scopeAutorise: [],
      },
      confiance: 0.2,
      explication: `Entrée non reconnue. Tentative d'utilisation brute : "${texte}".`,
      suggestions: [
        'Formats acceptés : IP (192.168.1.1), URL (https://example.com), domaine (example.com), IP:port',
        'Exemple : "scan 192.168.1.1 ports 80,443" ou "test https://example.com en profondeur"',
      ],
    };
  }

  const explication = `Cible identifiée : ${hote}${ports ? ` sur les ports ${ports.join(', ')}` : ''} (type: ${type}).`;

  return {
    cible: {
      hote,
      ports,
      url,
      type,
      scopeAutorise: scopeAutorise.length ? scopeAutorise : undefined,
    },
    confiance,
    explication,
    suggestions,
  };
}

/** Valide qu'une cible est bien formée. */
export function validerCible(cible: CiblePentest): { valide: boolean; erreurs: string[] } {
  const erreurs: string[] = [];

  if (!cible.hote || cible.hote.length < 2) {
    erreurs.push('Hôte manquant ou trop court.');
  }

  if (cible.ports) {
    for (const p of cible.ports) {
      if (p < 1 || p > 65535) {
        erreurs.push(`Port invalide : ${p}.`);
      }
    }
  }

  if (cible.type === 'web' && !cible.url) {
    erreurs.push('Type web mais aucune URL fournie.');
  }

  return { valide: erreurs.length === 0, erreurs };
}