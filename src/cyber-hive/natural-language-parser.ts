// Parseur d'input en langage naturel pour Cyber Hive.
// Permet de donner une cible en langage naturel : IP, URL, domaine, ou phrase.
// Ex : "scan 192.168.1.1", "teste la sécurité de example.com", "pentest https://target.com:8443"

import type { CiblePentest } from './types.js';

// Regex pour extraire les cibles
const REGEX_IP = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g;
const REGEX_URL = /https?:\/\/[^\s<>"']+/gi;
const REGEX_DOMAIN = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\b/g;
const REGEX_PORT = /(?:port\s*[:#]?\s*|:)(\d{1,5})\b/gi;
const REGEX_SCOPE = /(bug\s*bounty|ctf|red\s*team|audit|full\s*scan|quick\s*scan|deep\s*scan|reconnaissance|exploitation|défense|defense)/gi;

// Mots-clés d'action
const MOTS_CLES_SCAN = ['scan', 'scanne', 'scanner', 'teste', 'test', 'pentest', 'audit', 'analyse', 'vérifie', 'verifie', 'inspecte', 'inspect'];
const MOTS_CLES_PROFOND = ['profond', 'deep', 'complet', 'full', 'exhaustif', 'approfondi', 'en profondeur', 'à fond', 'a fond', 'ultra'];
const MOTS_CLES_RAPIDE = ['rapide', 'quick', 'express', 'léger', 'leger', 'surface'];
const MOTS_CLES_ATTAQUE = ['attaque', 'attack', 'exploit', 'exploitation', 'brute', 'force', 'intrusion'];
const MOTS_CLES_DEFENSE = ['défense', 'defense', 'protection', 'sécurise', 'securise', 'durci', 'durcir', 'hardening'];
const MOTS_CLES_TRACE = ['trace', 'anti-trace', 'anti-tracage', 'anti-traçage', 'forensic', 'furtif', 'stealth', 'anonyme', 'invisible'];

export interface ResultatParse {
  cible: CiblePentest;
  intention: 'scan' | 'attaque' | 'defense' | 'reconnaissance' | 'full-pentest';
  profondeur: 'surface' | 'standard' | 'profond';
  options: {
    antiTrace: boolean;
    scopeAuth: string[];
    portsSpecifies: number[];
  };
  texteOriginal: string;
  confiance: number;
}

/**
 * Parse une entrée en langage naturel et extrait la cible + options.
 */
export function parserInputNaturel(input: string): ResultatParse {
  const texte = input.trim().toLowerCase();
  const texteOriginal = input.trim();
  let confiance = 0.5;

  // Détection de l'intention
  let intention: ResultatParse['intention'] = 'scan';
  const aMotAttaque = MOTS_CLES_ATTAQUE.some(m => texte.includes(m));
  const aMotDefense = MOTS_CLES_DEFENSE.some(m => texte.includes(m));
  const aMotScan = MOTS_CLES_SCAN.some(m => texte.includes(m));
  const aMotProfond = MOTS_CLES_PROFOND.some(m => texte.includes(m));

  if (aMotAttaque && aMotDefense) {
    intention = 'full-pentest';
    confiance += 0.3;
  } else if (aMotAttaque) {
    intention = 'attaque';
    confiance += 0.2;
  } else if (aMotDefense) {
    intention = 'defense';
    confiance += 0.2;
  } else if (aMotScan) {
    intention = 'scan';
    confiance += 0.15;
  }

  if (aMotProfond) {
    intention = 'full-pentest';
    confiance += 0.2;
  }

  // Détection de la profondeur
  let profondeur: ResultatParse['profondeur'] = 'standard';
  if (MOTS_CLES_PROFOND.some(m => texte.includes(m))) {
    profondeur = 'profond';
    confiance += 0.1;
  } else if (MOTS_CLES_RAPIDE.some(m => texte.includes(m))) {
    profondeur = 'surface';
    confiance += 0.05;
  }

  // Extraction de la cible
  let cible: CiblePentest | null = null;

  // Tentative URL d'abord
  const urlMatch = input.match(REGEX_URL);
  if (urlMatch) {
    const url = urlMatch[0];
    let hote = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    const portMatch = url.match(/:(\d{2,5})/);
    const ports = portMatch ? [parseInt(portMatch[1])] : undefined;
    cible = {
      hote,
      url,
      ports,
      type: detecterTypeCible(hote),
      scopeAutorise: extraireScope(texte),
    };
    confiance += 0.3;
  }

  // Tentative IP
  if (!cible) {
    const ipMatch = input.match(REGEX_IP);
    if (ipMatch) {
      const hote = ipMatch[0];
      const ports = extrairePorts(input);
      cible = {
        hote,
        ports: ports.length > 0 ? ports : undefined,
        type: detecterTypeCible(hote),
        scopeAutorise: extraireScope(texte),
      };
      confiance += 0.3;
    }
  }

  // Tentative domaine
  if (!cible) {
    const domainMatches = input.match(REGEX_DOMAIN);
    if (domainMatches) {
      // Filtrer les faux positifs (mots communs)
      const hote = domainMatches[0];
      const ports = extrairePorts(input);
      cible = {
        hote,
        url: hote.startsWith('http') ? hote : `https://${hote}`,
        ports: ports.length > 0 ? ports : undefined,
        type: detecterTypeCible(hote),
        scopeAutorise: extraireScope(texte),
      };
      confiance += 0.25;
    }
  }

  // Fallback : utiliser tout le texte nettoyé comme hôte
  if (!cible) {
    const nettoye = texte
      .replace(/(scan|scanne|tester|teste|pentest|audit|analyse|vérifie|verifie|la|le|les|du|de|sur|sécurité|securite|de)\b/gi, '')
      .trim();
    if (nettoye && nettoye.length > 2) {
      cible = {
        hote: nettoye.split(/\s+/)[0],
        type: 'web',
        scopeAutorise: extraireScope(texte),
      };
      confiance = Math.max(confiance, 0.4);
    }
  }

  if (!cible) {
    throw new Error(`Impossible d'extraire une cible de l'input : "${input}"`);
  }

  // Détection anti-trace
  const antiTrace = MOTS_CLES_TRACE.some(m => texte.includes(m)) || aMotAttaque;

  // Ports spécifiés
  const portsSpecifies = extrairePorts(input);

  return {
    cible,
    intention,
    profondeur,
    options: {
      antiTrace,
      scopeAuth: cible.scopeAutorise,
      portsSpecifies,
    },
    texteOriginal,
    confiance: Math.min(confiance, 1),
  };
}

function detecterTypeCible(hote: string): CiblePentest['type'] {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hote)) {
    return 'reseau';
  }
  if (/api\./i.test(hote)) return 'api';
  if (/m\.|mobile/i.test(hote)) return 'mobile';
  return 'web';
}

function extrairePorts(texte: string): number[] {
  const ports: number[] = [];
  const matches = texte.matchAll(REGEX_PORT);
  for (const match of matches) {
    const port = parseInt(match[1]);
    if (port > 0 && port <= 65535) {
      ports.push(port);
    }
  }
  return [...new Set(ports)];
}

function extraireScope(texte: string): string[] {
  const scope: string[] = [];
  if (/bug\s*bounty/i.test(texte)) scope.push('bug-bounty');
  if (/ctf/i.test(texte)) scope.push('ctf');
  if (/red\s*team/i.test(texte)) scope.push('red-team');
  if (/audit/i.test(texte)) scope.push('audit');
  if (scope.length === 0) scope.push('pentest');
  return scope;
}

/**
 * Génère un résumé lisible de l'interprétation.
 */
export function resumerInterpretation(resultat: ResultatParse): string {
  const parts: string[] = [];
  parts.push(`Cible : ${resultat.cible.hote}`);
  if (resultat.cible.url) parts.push(`URL : ${resultat.cible.url}`);
  if (resultat.cible.ports?.length) parts.push(`Ports : ${resultat.cible.ports.join(', ')}`);
  parts.push(`Intention : ${resultat.intention}`);
  parts.push(`Profondeur : ${resultat.profondeur}`);
  parts.push(`Anti-trace : ${resultat.options.antiTrace ? 'activé' : 'désactivé'}`);
  parts.push(`Confiance : ${(resultat.confiance * 100).toFixed(0)}%`);
  return parts.join(' | ');
}