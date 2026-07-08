// Invitation Hive : une chaîne unique et copiable qui encode tout ce dont un
// ami a besoin pour rejoindre la ruche (URL WebSocket + token partagé + libellé
// optionnel). On l'envoie à un ami ; il la colle dans `npm run join <invitation>`
// et il est connecté — aucune édition de fichier de config.
//
// ⚠ L'invitation CONTIENT le token partagé : elle est SECRÈTE. La transmettre à
// quelqu'un lui donne le droit de rejoindre la ruche. À n'envoyer qu'à des
// membres de confiance, par un canal privé.

import { LIMITS } from './protocol.js';

/** Préfixe de version — permet de faire évoluer le format sans ambiguïté. */
const PREFIX = 'hive1_';

export interface Invite {
  /** URL WebSocket de l'orchestrateur, ex. ws://192.168.1.20:7777/ws */
  url: string;
  /** Token partagé de la ruche (secret). */
  token: string;
  /** Libellé lisible affiché à l'ami (ex. « Ruche de Micka »). */
  label?: string;
}

/**
 * Vrai si la chaîne contient un caractère de contrôle (codes < 0x20 ou 0x7f) —
 * ESC, CR, LF, etc. Interdits dans un libellé affiché en terminal : ils
 * permettraient une injection ANSI (réécriture/effacement de lignes) pour
 * masquer l'URL réelle de connexion (hameçonnage).
 */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function base64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Encode une invitation en une chaîne copiable unique. */
export function encodeInvite(invite: Invite): string {
  const payload = JSON.stringify({
    v: 1,
    url: invite.url,
    token: invite.token,
    ...(invite.label ? { label: invite.label } : {}),
  });
  return PREFIX + base64urlEncode(payload);
}

/**
 * Décode et valide une invitation. Retourne null si la chaîne est absente,
 * mal formée, ou si l'URL/token sont invalides. Tolère les espaces autour et
 * un éventuel préfixe `hive://` collé par erreur.
 */
export function decodeInvite(raw: unknown): Invite | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith('hive://')) s = s.slice('hive://'.length);
  if (!s.startsWith(PREFIX)) return null;
  const b64 = s.slice(PREFIX.length);
  let data: unknown;
  try {
    data = JSON.parse(base64urlDecode(b64));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  const url = d.url;
  const token = d.token;
  if (typeof url !== 'string' || !isWsUrl(url)) return null;
  if (typeof token !== 'string' || token.length === 0 || token.length > LIMITS.token) return null;
  const label =
    typeof d.label === 'string' &&
    d.label.length > 0 &&
    d.label.length <= LIMITS.name &&
    !hasControlChars(d.label)
      ? d.label
      : undefined;

  return { url, token, ...(label ? { label } : {}) };
}

/** Une URL de ruche doit être un WebSocket ws:// ou wss:// bien formé. */
export function isWsUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}
