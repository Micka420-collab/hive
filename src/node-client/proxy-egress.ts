// Le proxy d'egress du nœud — le SEUL chemin par lequel un bac filtré joint
// le réseau, et le seul endroit où les vrais identifiants du modèle existent.
//
// Portions of this file are derived from anthropics/sandbox-runtime
// (https://github.com/anthropics/sandbox-runtime, commit 4ab96555, files
// src/sandbox/http-proxy.ts, domain-pattern.ts, address.ts,
// resolved-address-guard.ts and credential-sentinel.ts).
//
//   Copyright 2025 Anthropic PBC
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.
//
// Modified by the Hive contributors (2026): condensed to the CONNECT tunnel,
// the plain-HTTP forward and the resolved-address guard; one listener per task
// on a Unix socket instead of a TCP port; private ranges (RFC 1918, CGNAT,
// ULA) denied by default; a reverse gateway for model APIs replaces TLS
// termination for credential substitution; identifiers and messages in French.
// See THIRD_PARTY_NOTICES.md.
//
// ─── LA FORME ────────────────────────────────────────────────────────────────
//
//     bac (réseau coupé)                          nœud (hors du bac)
//     ─────────────────────                        ──────────────────────────
//     agent ── HTTPS_PROXY ──▶ 127.0.0.1:3128      proxy de la tâche
//           ── ANTHROPIC_BASE_URL ─┘   │            ├ CONNECT hôte:443 → liste
//                          relais (Node, r.cjs)     │   blanche + garde DNS
//                                  │                ├ GET http://… → idem
//                     socket Unix `s` (monté ro) ──▶└ /hive-api/<famille>/… →
//                                                     passerelle : le leurre
//                                                     devient la vraie clé
//
// Le bac n'a QUE la boucle locale (`bwrap --unshare-net`, `--network=none`).
// Le relais (`SOURCE_RELAIS`) y écoute sur 127.0.0.1 et recopie chaque octet
// vers le socket de la tâche, que le nœud a monté en lecture seule. Tout ce
// qui sort passe donc ici, et rien ici ne vient du bac sans être jugé.
//
// ─── LES IDENTIFIANTS RESTENT DEHORS ─────────────────────────────────────────
//
// Dans le bac, `ANTHROPIC_API_KEY` (ou `CLAUDE_CODE_OAUTH_TOKEN`,
// `CODEX_API_KEY`…) vaut un LEURRE (`masquerIdentifiants`). L'agent parle à
// son API par la passerelle en HTTP clair — sur la boucle du bac, puis le
// socket : rien ne traverse un réseau en clair —, et la passerelle remplace le
// leurre par la vraie valeur dans les en-têtes, vers l'hôte de CETTE famille
// seulement : un leurre envoyé ailleurs reste un leurre. La vraie clé n'est
// dans aucun `/proc/*/environ` du bac ; une injection de prompt qui la
// chercherait n'y trouverait que `…hive-leurre-…`.
//
// Pourquoi une passerelle et pas la terminaison TLS de srt : une passerelle
// n'exige ni autorité de certification à installer dans le bac ni confiance
// de chaque outil envers elle, et Claude Code comme Codex savent viser une
// base d'API (`ANTHROPIC_BASE_URL`, `openai_base_url`). La terminaison TLS
// reste la voie pour les autres familles (suite nommée dans la PR).
//
// ─── CE QUE LE PROXY REFUSE, ET COMMENT IL LE DIT ────────────────────────────
//
//   · un hôte hors de la liste blanche de la tâche (`politique-reseau.ts`) ;
//   · une adresse IP littérale : la liste ne nomme que des hôtes ;
//   · un port autre que 80 et 443 ;
//   · un nom permis qui se RÉSOUT vers la boucle, le réseau local (RFC 1918,
//     CGNAT, ULA), le lien local et les métadonnées de nuage, ou une adresse
//     de la machine elle-même — la garde anti-rebond DNS : qui tient les
//     enregistrements d'un nom permis ne décide pas pour autant de ce que le
//     nœud compose.
//
// Chaque refus répond 403 avec `X-Hive-Reseau: refus` et une phrase lisible
// PAR LE MODÈLE (ce qui est refusé, pourquoi, ce qui est permis, qui peut
// élargir), et part au journal de la tâche (`surRefus`).

import { randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { writeFileSync } from 'node:fs';
import { createServer, request as requeteHttp } from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, Server } from 'node:http';
import { request as requeteHttps } from 'node:https';
import { BlockList, connect, isIP } from 'node:net';
import type { LookupFunction, Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { NiveauReseau } from '../shared/reseau.js';

/** Le port du relais DANS le bac. Fixe : la boucle du bac n'appartient qu'à lui. */
export const PORT_RELAIS = 3128;
/** Le relais, écrit dans le dossier de la session à côté du socket. */
export const NOM_RELAIS = 'r.cjs';
/** Le préfixe de chemin des passerelles d'API : `/hive-api/<famille>/…`. */
export const PREFIXE_PASSERELLE = '/hive-api/';
/** Seuls ports qui sortent du bac : HTTP et HTTPS. */
const PORTS_PERMIS: ReadonlySet<number> = new Set([80, 443]);
/** L'en-tête qui signe un refus du proxy (la sonde de démarrage le lit). */
export const ENTETE_REFUS = 'x-hive-reseau';

/** Les refus gardés par session : au-delà, un compteur, pas un journal sans fin. */
const REFUS_MAX = 50;

// ─── Le relais du bac ────────────────────────────────────────────────────────

/**
 * Le programme que le bac lance AVANT l'agent : `node r.cjs <port> <socket>
 * -- <agent> <args…>`. Il écoute sur la boucle du bac, recopie chaque
 * connexion vers le socket de la tâche, puis lance l'agent et rend son code.
 *
 * CommonJS, sans dépendance, en Node de l'hôte (bubblewrap) ou de l'image
 * (conteneur) : il n'a besoin que de `net` et `child_process`. L'agent ne
 * démarre qu'une fois l'écoute ouverte — sinon ses premières requêtes
 * partiraient dans le vide. Les signaux de Hive (délai, annulation) sont
 * relayés à l'agent ; son code de sortie devient celui du relais.
 */
export const SOURCE_RELAIS = `'use strict';
// Relais du bac à sable de Hive — voir src/node-client/proxy-egress.ts.
const net = require('node:net');
const { spawn } = require('node:child_process');
const { constants } = require('node:os');
const [port, socket, sep, bin, ...args] = process.argv.slice(2);
if (sep !== '--' || !bin) {
  process.stderr.write('[hive] relais réseau : usage r.cjs <port> <socket> -- <commande>\\n');
  process.exit(125);
}
const serveur = net.createServer((client) => {
  const amont = net.connect(socket);
  client.on('error', () => amont.destroy());
  amont.on('error', () => client.destroy());
  client.pipe(amont);
  amont.pipe(client);
});
serveur.on('error', (e) => {
  process.stderr.write('[hive] relais réseau indisponible : ' + e.message + '\\n');
  process.exit(125);
});
serveur.listen(Number(port), '127.0.0.1', () => {
  const enfant = spawn(bin, args, { stdio: 'inherit', shell: false });
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => enfant.kill(s));
  enfant.on('error', (e) => {
    process.stderr.write('[hive] ' + bin + ' : ' + e.message + '\\n');
    process.exit(127);
  });
  enfant.on('exit', (code, signal) =>
    process.exit(code ?? 128 + (constants.signals[signal] ?? 1)),
  );
});
`;

/** Écrit le relais dans le dossier (privé) de la session. */
export function ecrireRelais(dossier: string): string {
  const chemin = path.join(dossier, NOM_RELAIS);
  writeFileSync(chemin, SOURCE_RELAIS, { mode: 0o600 });
  return chemin;
}

// ─── Les noms ────────────────────────────────────────────────────────────────

/**
 * L'hôte tel que la liste le compare : minuscules, sans point final ni
 * crochets. `null` pour ce qui n'est ni un nom d'hôte DNS ni une IP : un `%`
 * (zone IPv6), une espace ou un `@` n'a rien à faire dans une destination.
 */
export function hoteCanonique(hote: string): string | null {
  const brut = hote
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.$/, '');
  if (brut === '') return null;
  if (isIP(brut)) return brut;
  return /^[a-z0-9]([a-z0-9-]{0,62}\.)*[a-z0-9-]{1,63}$/.test(brut) ? brut : null;
}

/**
 * Un hôte contre un motif de la liste : `*.exemple.org` pour les sous-domaines
 * STRICTS, tout autre motif exactement. Jamais de joker sur une IP : un
 * suffixe ne dit rien d'une adresse (motif `matchesDomainPattern` de srt).
 */
export function hoteCorrespond(hote: string, motif: string): boolean {
  if (motif.startsWith('*.')) {
    if (isIP(hote)) return false;
    return hote.endsWith(`.${motif.slice(2)}`);
  }
  return hote === motif;
}

// ─── Les adresses qu'un nom permis ne peut pas désigner ──────────────────────

/**
 * Les classes d'adresses REFUSÉES à la résolution, dans l'ordre où un refus
 * les nomme. srt refuse les quatre premières et les métadonnées ; Hive refuse
 * AUSSI le réseau privé : un agent n'a rien à faire sur l'imprimante, le NAS
 * ou la box du membre, et c'est précisément ce qu'un rebond DNS viserait.
 */
const CLASSES_REFUSEES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['la boucle locale', ['127.0.0.0/8', '::1/128']],
  ['une adresse non spécifiée', ['0.0.0.0/8', '::/128']],
  ['le lien local (métadonnées de nuage comprises)', ['169.254.0.0/16', 'fe80::/10']],
  [
    'un service de métadonnées de nuage',
    [
      '100.100.100.200/32',
      '168.63.129.16/32',
      '192.0.0.192/32',
      'fd00:ec2::/32',
      'fd20:ce::254/128',
      'fd00:c1::a9fe:a9fe/128',
      'fd00:42::42/128',
      'fd00:a9fe:a9fe::1/128',
      'fd00:100::100:200/128',
    ],
  ],
  [
    'le réseau local',
    ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', 'fc00::/7'],
  ],
  ['une adresse de diffusion', ['224.0.0.0/4', 'ff00::/8', '255.255.255.255/32']],
];

function listeDe(plages: readonly string[]): BlockList {
  const liste = new BlockList();
  for (const plage of plages) {
    const [adresse = '', prefixe = ''] = plage.split('/');
    const famille = isIP(adresse) === 6 ? 'ipv6' : 'ipv4';
    liste.addSubnet(adresse, Number(prefixe), famille);
  }
  return liste;
}

const LISTES_REFUSEES = CLASSES_REFUSEES.map(
  ([classe, plages]) => [classe, listeDe(plages)] as const,
);

/** Les huit groupes de 16 bits d'une IPv6, ou `undefined`. */
function groupesIpv6(adresse: string): number[] | undefined {
  let hote: string;
  try {
    hote = new URL(`http://[${adresse}]/`).hostname.slice(1, -1);
  } catch {
    return undefined;
  }
  const [tete = '', queue] = hote.split('::');
  const avant = tete ? tete.split(':') : [];
  const apres = queue ? queue.split(':') : [];
  const trou = queue === undefined ? 0 : 8 - avant.length - apres.length;
  if (trou < 0 || avant.length + trou + apres.length !== 8) return undefined;
  return [...avant, ...Array<string>(trou).fill('0'), ...apres].map((g) => parseInt(g, 16));
}

/**
 * L'IPv4 qu'une IPv6 porte vers le même destinataire : mappée et compatible
 * (`::ffff:a.b.c.d`, `::a.b.c.d`), traduite, NAT64 bien connu (`64:ff9b::/96`)
 * et 6to4 (`2002::/16`) — motif `embeddedIPv4` de srt. Chaque refus IPv4
 * s'applique aussi à ces formes : sinon `::ffff:192.168.1.1` passait.
 */
export function ipv4Embarquee(adresse: string): string | undefined {
  if (isIP(adresse) !== 6) return undefined;
  const g = groupesIpv6(adresse);
  if (!g) return undefined;
  const quad = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const nuls = (de: number, a: number): boolean => g.slice(de, a).every((x) => x === 0);
  if (g[0] === 0x2002) return quad(g[1] ?? 0, g[2] ?? 0);
  const bas = quad(g[6] ?? 0, g[7] ?? 0);
  if (g[0] === 0x64 && g[1] === 0xff9b && nuls(2, 6)) return bas;
  if (nuls(0, 5) && (g[5] === 0 || g[5] === 0xffff)) return bas;
  if (nuls(0, 4) && g[4] === 0xffff && g[5] === 0) return bas;
  return undefined;
}

function dansListe(liste: BlockList, adresse: string): boolean {
  const famille = isIP(adresse);
  if (famille === 0) return false;
  return liste.check(adresse, famille === 6 ? 'ipv6' : 'ipv4');
}

/** Les adresses des interfaces de la machine — un service lié à 0.0.0.0 y répond. */
export function adressesDeLaMachine(): string[] {
  try {
    return Object.values(networkInterfaces())
      .flat()
      .flatMap((i) => (i ? [i.address.replace(/%.*$/, '')] : []));
  } catch {
    return [];
  }
}

/**
 * Pourquoi un nom permis ne peut pas désigner `adresse` — ou `null` s'il le
 * peut. `locales` : les adresses de la machine, lues à l'instant du refus.
 */
export function adresseRefusee(adresse: string, locales: readonly string[]): string | null {
  const nue = adresse.replace(/%.*$/, '');
  if (!isIP(nue)) return 'une adresse illisible';
  const v4 = ipv4Embarquee(nue);
  for (const [classe, liste] of LISTES_REFUSEES) {
    if (dansListe(liste, nue) || (v4 !== undefined && dansListe(liste, v4))) return classe;
  }
  if (locales.some((l) => l === nue || (v4 !== undefined && l === v4))) {
    return 'une adresse de cette machine';
  }
  return null;
}

/** Ce que `dns.lookup` sait faire, pour qu'un banc le remplace. */
export type Resolveur = (
  hote: string,
  options: LookupAllOptions,
  rappel: (err: NodeJS.ErrnoException | null, adresses: LookupAddress[]) => void,
) => void;

/** Le refus d'une résolution : la CLASSE, jamais l'adresse — le bac n'a pas à l'apprendre. */
class AdresseRefusee extends Error {
  constructor(readonly classe: string) {
    super(`résolu vers ${classe}`);
  }
}

/**
 * Le `lookup` d'une connexion sortante : résout UNE fois, écarte les adresses
 * refusées, et compose la première qui reste — l'adresse jugée est l'adresse
 * composée, sans seconde résolution entre les deux (le rebond DNS vit
 * précisément dans cet intervalle).
 */
function lookupGarde(resoudre: Resolveur, locales: () => readonly string[]): LookupFunction {
  return (hote, options, rappel) => {
    resoudre(hote, { ...options, all: true }, (err, adresses) => {
      if (err) {
        rappel(err, []);
        return;
      }
      const ici = locales();
      const gardees: LookupAddress[] = [];
      let classe: string | null = null;
      for (const a of adresses) {
        const pourquoi = adresseRefusee(a.address, ici);
        if (pourquoi === null) gardees.push(a);
        else classe ??= pourquoi;
      }
      const premiere = gardees[0];
      if (!premiere) {
        const echec = classe
          ? Object.assign(new AdresseRefusee(classe), { code: 'EHIVEREFUS' })
          : Object.assign(new Error(`getaddrinfo ENOTFOUND ${hote}`), { code: 'ENOTFOUND' });
        rappel(echec, []);
        return;
      }
      if (options.all) rappel(null, gardees);
      else rappel(null, premiere.address, premiere.family);
    });
  };
}

// ─── Les leurres ─────────────────────────────────────────────────────────────

/**
 * Les préfixes PUBLICS des jetons, gardés dans le leurre : un CLI qui lit le
 * préfixe pour choisir sa voie d'authentification (`sk-ant-oat01-` : un jeton
 * d'abonnement) doit la choisir pareil. Un préfixe documenté n'est pas un
 * secret ; la partie aléatoire, elle, n'est JAMAIS recopiée.
 */
const PREFIXES_PUBLICS = [
  'sk-ant-oat01-',
  'sk-ant-api03-',
  'sk-ant-admin01-',
  'sk-ant-',
  'sk-proj-',
  'sk-svcacct-',
  'sk-',
];

/** Un leurre neuf pour `reelle` : son préfixe public, puis `hive-leurre-` et 32 hex. */
export function leurrePour(reelle: string): string {
  const prefixe = PREFIXES_PUBLICS.find((p) => reelle.startsWith(p)) ?? '';
  return `${prefixe}hive-leurre-${randomUUID().replaceAll('-', '')}`;
}

/**
 * L'environnement du bac avec, pour chaque variable NOMMÉE, un leurre à la
 * place de la vraie valeur — et les paires leurre → valeur que la passerelle
 * substituera. Une variable absente ou vide reste ce qu'elle est.
 */
export function masquerIdentifiants(
  env: NodeJS.ProcessEnv,
  noms: readonly string[],
): { env: NodeJS.ProcessEnv; substitutions: Array<readonly [string, string]> } {
  const masque: NodeJS.ProcessEnv = { ...env };
  const substitutions: Array<readonly [string, string]> = [];
  for (const nom of noms) {
    const reelle = env[nom];
    if (!reelle) continue;
    const leurre = leurrePour(reelle);
    masque[nom] = leurre;
    substitutions.push([leurre, reelle]);
  }
  return { env: masque, substitutions };
}

// ─── La session d'une tâche ──────────────────────────────────────────────────

/** Une passerelle d'API : `/hive-api/<nom>/…` → `amont`, leurres substitués. */
export interface Passerelle {
  nom: string;
  /** La base d'API réelle, composée par le NŒUD (jamais choisie par le bac). */
  amont: URL;
  /** Leurre → vraie valeur, substitués dans les en-têtes vers `amont` seulement. */
  substitutions: ReadonlyArray<readonly [string, string]>;
}

/** Ce qu'une tâche a le droit de joindre. */
export interface PolitiqueSession {
  niveau: Exclude<NiveauReseau, 'ouvert'>;
  /** Motifs d'hôtes permis (`api.anthropic.com`, `*.crates.io`). */
  hotes: readonly string[];
  passerelles: readonly Passerelle[];
}

/** Un refus, tel qu'il part au journal. */
export interface RefusReseau {
  hote: string;
  port: number;
  /** La phrase donnée au bac (et au modèle). */
  motif: string;
  /** Combien de fois ce même refus s'est répété. */
  fois: number;
}

export interface OptionsSession {
  /** Chemin du socket Unix sur lequel écouter (dossier privé 0700). */
  socket: string;
  politique: PolitiqueSession;
  /** Appelé au PREMIER refus de chaque hôte:port — le journal, pas un flot. */
  surRefus?: (refus: RefusReseau) => void;
  /** Résolution des noms — `dns.lookup` par défaut, un banc la remplace. */
  resoudre?: Resolveur;
  /** Adresses de la machine — `adressesDeLaMachine` par défaut. */
  adressesLocales?: () => readonly string[];
}

export interface SessionReseau {
  /** Les refus vus, dans l'ordre, bornés à `REFUS_MAX`. */
  refus(): RefusReseau[];
  /** Ferme l'écoute et coupe les tunnels ouverts. Ne lève jamais. */
  fermer(): Promise<void>;
}

/** Les en-têtes qui ne traversent jamais un proxy (RFC 9110 §7.6.1). */
const SAUT_PAR_SAUT = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

function entetesTransmis(
  entetes: IncomingHttpHeaders,
  substituer?: (valeur: string) => string,
): OutgoingHttpHeaders {
  const nommesParConnection = new Set(
    String(entetes.connection ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const sortie: OutgoingHttpHeaders = {};
  for (const [nom, valeur] of Object.entries(entetes)) {
    if (valeur === undefined || SAUT_PAR_SAUT.has(nom) || nommesParConnection.has(nom)) continue;
    if (!substituer) sortie[nom] = valeur;
    else sortie[nom] = Array.isArray(valeur) ? valeur.map(substituer) : substituer(valeur);
  }
  return sortie;
}

/** Le corps d'un refus : une phrase, en texte, pour le bac et pour le modèle. */
function reponseRefus(motif: string): { entete: string; corps: Buffer } {
  const corps = Buffer.from(`${motif}\n`, 'utf8');
  return {
    entete:
      'HTTP/1.1 403 Forbidden\r\n' +
      `${ENTETE_REFUS}: refus\r\n` +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${corps.length}\r\n` +
      'Connection: close\r\n\r\n',
    corps,
  };
}

/**
 * Ouvre le proxy d'UNE tâche sur son socket. Rend quand il écoute ; rejette
 * s'il ne le peut pas (et l'appelant fait échouer la tâche, jamais la lancer
 * sans filtre).
 */
export async function ouvrirSessionReseau(opts: OptionsSession): Promise<SessionReseau> {
  const { politique } = opts;
  const resoudre = opts.resoudre ?? (dnsLookup as unknown as Resolveur);
  const locales = opts.adressesLocales ?? adressesDeLaMachine;
  const lookup = lookupGarde(resoudre, locales);
  const vus = new Map<string, RefusReseau>();
  const ouverts = new Set<Socket | Duplex>();

  const permis = politique.hotes.length > 0 ? politique.hotes.join(', ') : 'aucun hôte';
  const conseil =
    'Un propriétaire du projet peut élargir le réseau des agents dans Mission Control ' +
    '(Projets → Réseau des agents).';

  const refuser = (hote: string, port: number, motif: string): string => {
    const cle = `${hote}:${port}`;
    const deja = vus.get(cle);
    if (deja) {
      deja.fois += 1;
      return deja.motif;
    }
    if (vus.size < REFUS_MAX) {
      const refus = { hote, port, motif, fois: 1 };
      vus.set(cle, refus);
      opts.surRefus?.({ ...refus });
    }
    return motif;
  };

  /** L'hôte canonique si la destination est permise, sinon le motif du refus. */
  const juger = (hoteBrut: string, port: number): { hote: string } | { motif: string } => {
    const hote = hoteCanonique(hoteBrut);
    const nom = hote ?? hoteBrut.slice(0, 80);
    if (!hote) {
      return { motif: refuser(nom, port, `Hive : destination illisible « ${nom} » — refusée.`) };
    }
    if (isIP(hote)) {
      return {
        motif: refuser(
          hote,
          port,
          `Hive : connexion refusée vers l'adresse ${hote} — le réseau de ce projet ne permet ` +
            `que des hôtes nommés (niveau « ${politique.niveau} » ; permis : ${permis}). ${conseil}`,
        ),
      };
    }
    if (!PORTS_PERMIS.has(port)) {
      return {
        motif: refuser(
          hote,
          port,
          `Hive : port ${port} refusé vers ${hote} — seuls 80 et 443 sortent du bac. ${conseil}`,
        ),
      };
    }
    if (!politique.hotes.some((m) => hoteCorrespond(hote, m))) {
      return {
        motif: refuser(
          hote,
          port,
          `Hive : ${hote} n'est pas dans la liste blanche du réseau de ce projet ` +
            `(niveau « ${politique.niveau} » ; permis : ${permis}). ${conseil}`,
        ),
      };
    }
    return { hote };
  };

  const refusResolution = (hote: string, port: number, err: unknown): string | null =>
    err instanceof AdresseRefusee
      ? refuser(
          hote,
          port,
          `Hive : ${hote} se résout vers ${err.classe} — refusé (garde anti-rebond DNS : ` +
            `le bac ne joint ni le réseau local, ni les métadonnées, ni la machine hôte).`,
        )
      : null;

  const serveur: Server = createServer();
  serveur.on('clientError', (_err, socket) => {
    socket.on('error', () => {});
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  // ─── CONNECT hôte:port — le tunnel HTTPS ────────────────────────────────
  serveur.on('connect', (req: IncomingMessage, client: Duplex, tete: Buffer) => {
    ouverts.add(client);
    client.on('error', () => client.destroy());
    client.on('close', () => ouverts.delete(client));
    const cible = /^\[?([^\]]*?)\]?:(\d{1,5})$/.exec(req.url ?? '');
    const port = Number(cible?.[2] ?? 0);
    const verdict = cible ? juger(cible[1] ?? '', port) : { motif: 'Hive : CONNECT illisible.' };
    if ('motif' in verdict) {
      const r = reponseRefus(verdict.motif);
      client.end(Buffer.concat([Buffer.from(r.entete), r.corps]));
      return;
    }
    const amont = connect({ host: verdict.hote, port, lookup });
    ouverts.add(amont);
    let etabli = false;
    amont.on('close', () => ouverts.delete(amont));
    amont.once('connect', () => {
      etabli = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (tete.length > 0) amont.write(tete);
      amont.pipe(client);
      client.pipe(amont);
    });
    amont.on('error', (err) => {
      // Tunnel établi : les octets du client sont déjà partis, un statut HTTP
      // atterrirait DANS le flux chiffré. On coupe.
      if (etabli || !client.writable) {
        client.destroy();
        return;
      }
      const motif = refusResolution(verdict.hote, port, err);
      if (motif) {
        const r = reponseRefus(motif);
        client.end(Buffer.concat([Buffer.from(r.entete), r.corps]));
      } else {
        client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
    });
  });

  // ─── Requêtes HTTP : passerelle d'API, ou proxy en clair ────────────────
  serveur.on('request', (req, res) => {
    const url = req.url ?? '';
    const refuserHttp = (motif: string): void => {
      res.writeHead(403, {
        [ENTETE_REFUS]: 'refus',
        'content-type': 'text/plain; charset=utf-8',
        connection: 'close',
      });
      res.end(`${motif}\n`);
    };
    const echouer = (code: number, texte: string): void => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
      res.end(`${texte}\n`);
    };

    if (url.startsWith(PREFIXE_PASSERELLE)) {
      const reste = url.slice(PREFIXE_PASSERELLE.length);
      const nom = reste.split(/[/?]/, 1)[0] ?? '';
      const passerelle = politique.passerelles.find((p) => p.nom === nom);
      const suite = reste.slice(nom.length);
      if (!passerelle || suite.includes('..')) {
        refuserHttp(`Hive : passerelle d'API inconnue « ${nom.slice(0, 40)} ».`);
        return;
      }
      // L'amont se RECOPIE, et seuls son chemin et sa requête changent : jamais
      // `new URL(suite, amont)`, où un chemin `//exfil.example.org/…` (protocole
      // relatif) aurait changé d'HÔTE — avec la vraie clé substituée.
      const [chemin = '', ...requete] = suite.split('?');
      const cible = new URL(passerelle.amont);
      cible.pathname =
        passerelle.amont.pathname.replace(/\/$/, '') +
        (chemin.startsWith('/') ? chemin : `/${chemin}`);
      cible.search = requete.length > 0 ? `?${requete.join('?')}` : '';
      // Le leurre ne devient la vraie valeur QUE vers l'hôte de sa famille :
      // envoyé ailleurs (proxy en clair, tunnel), il reste un leurre.
      const substituer = (valeur: string): string =>
        passerelle.substitutions.reduce(
          (v, [leurre, reelle]) => v.replaceAll(leurre, reelle),
          valeur,
        );
      const entetes = entetesTransmis(req.headers, substituer);
      entetes.host = cible.host;
      const envoyer = cible.protocol === 'https:' ? requeteHttps : requeteHttp;
      const amont = envoyer(cible, { method: req.method ?? 'GET', headers: entetes }, (reponse) => {
        res.writeHead(reponse.statusCode ?? 502, entetesTransmis(reponse.headers));
        reponse.pipe(res);
        reponse.on('error', () => res.destroy());
      });
      amont.on('error', (err) =>
        echouer(502, `Hive : l'API ${passerelle.nom} ne répond pas (${err.message}).`),
      );
      req.pipe(amont);
      return;
    }

    // Proxy en clair : forme absolue `http://hôte[:port]/…` seulement.
    let cible: URL;
    try {
      cible = new URL(url);
    } catch {
      refuserHttp(
        `Hive : requête sans destination — le bac ne joint que ses passerelles et son proxy.`,
      );
      return;
    }
    if (cible.protocol !== 'http:') {
      refuserHttp(`Hive : schéma ${cible.protocol} refusé par le proxy en clair.`);
      return;
    }
    const port = Number(cible.port || 80);
    const verdict = juger(cible.hostname, port);
    if ('motif' in verdict) {
      refuserHttp(verdict.motif);
      return;
    }
    const entetes = entetesTransmis(req.headers);
    entetes.host = cible.host;
    const amont = requeteHttp(
      {
        host: verdict.hote,
        port,
        path: `${cible.pathname}${cible.search}`,
        method: req.method ?? 'GET',
        headers: entetes,
        lookup,
      },
      (reponse) => {
        res.writeHead(reponse.statusCode ?? 502, entetesTransmis(reponse.headers));
        reponse.pipe(res);
        reponse.on('error', () => res.destroy());
      },
    );
    amont.on('error', (err) => {
      const motif = refusResolution(verdict.hote, port, err);
      if (motif && !res.headersSent) refuserHttp(motif);
      else echouer(502, `Hive : ${verdict.hote} ne répond pas.`);
    });
    req.pipe(amont);
  });

  await new Promise<void>((resolve, reject) => {
    serveur.once('error', reject);
    serveur.listen(opts.socket, () => {
      serveur.off('error', reject);
      resolve();
    });
  });

  return {
    refus: () => [...vus.values()].map((r) => ({ ...r })),
    fermer: () =>
      new Promise<void>((resolve) => {
        for (const s of ouverts) s.destroy();
        ouverts.clear();
        serveur.closeAllConnections();
        serveur.close(() => resolve());
      }),
  };
}
