// DE FAUX BETTERLEAKS ET OSV-SCANNER, POUR LES BANCS DE LA PORTE DE SÉCURITÉ.
//
// Les bancs n'ont pas les vrais binaires (24 et 57 Mo, et osv-scanner
// interroge osv.dev). Ces deux faux se posent en tête du PATH et REJOUENT les
// sorties des vrais : les champs, leurs formes, les colonnes en octets et les
// codes de sortie sont ceux MESURÉS sur betterleaks 1.9.0 et osv-scanner 2.6.0
// (rapports réels relus champ par champ, le 4 octobre) ; les avis cités sont
// de VRAIS avis d'osv.dev à cette date — identifiants, alias, résumés,
// gravités et plages de versions affectées.
//
// Ils LISENT ce que la porte leur donne — le miroir des lignes ajoutées, les
// lockfiles de la base et de la tête, les SBOM qu'elle écrit : une trouvaille
// n'est rapportée que si elle est dans le fichier, à la colonne où elle est,
// comme l'outil réel. Et ils font ce que l'outil réel fait AVANT de chercher,
// qui décide de ce qu'il voit : le préfiltre et la confiance de Betterleaks,
// l'échec global d'osv-scanner sur un seul fichier illisible. Chaque
// lancement laisse sa ligne de commande (`appelsDesOutils`) ; ce qu'osv-scanner
// « envoie » est consigné (`requetesEnvoyees`), et le proxy qu'il reçoit
// (`proxysRecus`). Un fichier `mode-<outil>` à côté d'eux en change le
// comportement :
//
//   · betterleaks `plante`  — sort en 2 sans rapport ;
//   · betterleaks `menteur` — trouve, mais sort en 0 (code et rapport en désaccord) ;
//   · betterleaks `decale`  — rapporte des colonnes qui ne se relisent pas ;
//   · betterleaks `sans-confiance` — n'applique pas la confiance demandée ;
//   · osv-scanner `hors-ligne` — osv.dev injoignable : rapport VIDE et valide,
//     sortie 127, le message réel sur stderr (mesuré, `node-client/porte-securite.ts`).
//
// SURFACE PROTÉGÉE (`src/boucle-v3/garde.ts`) : un faux plus complaisant que
// le vrai — qui ne préfiltrerait pas, n'ignorerait aucune confiance, lirait un
// lockfile cassé — rendrait verts des bancs que l'outil réel ferait rougir.
//
// POSIX seulement : un script à shebang ne se lance pas sans shell sous
// Windows — même limite, et même raison, que `faux-bac.ts`.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Les avis réels (osv.dev, 4 octobre) que le faux osv-scanner sait servir —
 * réduits aux champs qu'il rend, `details` et `references` abrégés.
 * `score` : le `max_severity` du groupe d'alias, tel que l'outil le calcule ;
 * `plages` : TOUTES les plages SEMVER affectées du paquet, `[introduit, corrigé)`
 * — l'avis de minimist GHSA-vh95-rmgr-6w4m en a deux, et 1.2.0 tombe dans la
 * seconde.
 */
const AVIS = [
  {
    id: 'GHSA-29mw-wpgm-hmr9',
    summary: 'Regular Expression Denial of Service (ReDoS) in lodash',
    aliases: ['CVE-2020-28500'],
    severite: 'MODERATE',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L',
    score: '5.3',
    ecosysteme: 'npm',
    paquet: 'lodash',
    plages: [['4.0.0', '4.17.21']],
  },
  {
    id: 'GHSA-35jh-r3h4-6jhm',
    summary: 'Command Injection in lodash',
    aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-r5fr-rjxr-66jc'],
    severite: 'HIGH',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H',
    score: '8.1',
    ecosysteme: 'npm',
    paquet: 'lodash',
    plages: [['0', '4.17.21']],
  },
  {
    id: 'GHSA-f23m-r3pf-42rh',
    summary:
      'lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit`',
    aliases: ['CVE-2025-13465', 'CVE-2026-2950', 'GHSA-xxjr-mmjv-4gpg'],
    severite: 'MODERATE',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L',
    score: '6.9',
    ecosysteme: 'npm',
    paquet: 'lodash',
    plages: [['0', '4.18.0']],
  },
  {
    id: 'GHSA-r5fr-rjxr-66jc',
    summary: 'lodash vulnerable to Code Injection via `_.template` imports key names',
    aliases: ['CVE-2021-23337', 'CVE-2026-4800', 'GHSA-35jh-r3h4-6jhm'],
    severite: 'HIGH',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H',
    score: '8.1',
    ecosysteme: 'npm',
    paquet: 'lodash',
    plages: [['4.0.0', '4.18.0']],
  },
  {
    id: 'GHSA-xxjr-mmjv-4gpg',
    summary: 'Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions',
    aliases: ['CVE-2025-13465', 'CVE-2026-2950', 'GHSA-f23m-r3pf-42rh'],
    severite: 'MODERATE',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L',
    score: '6.9',
    ecosysteme: 'npm',
    paquet: 'lodash',
    plages: [['4.0.0', '4.17.23']],
  },
  {
    id: 'GHSA-vh95-rmgr-6w4m',
    summary: 'Prototype Pollution in minimist',
    aliases: ['CVE-2020-7598'],
    severite: 'MODERATE',
    cvss: 'CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:L',
    score: '5.6',
    ecosysteme: 'npm',
    paquet: 'minimist',
    plages: [
      ['0', '0.2.1'],
      ['1.0.0', '1.2.3'],
    ],
  },
  {
    id: 'GHSA-xvch-5gv4-984h',
    summary: 'Prototype Pollution in minimist',
    aliases: ['CVE-2021-44906'],
    severite: 'CRITICAL',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    score: '9.8',
    ecosysteme: 'npm',
    paquet: 'minimist',
    plages: [
      ['1.0.0', '1.2.6'],
      ['0', '0.2.4'],
    ],
  },
  // Relus sur api.osv.dev le 4 octobre : Log4Shell, et un avis de Flask qui
  // touche la « version » 0.1 qu'osv-scanner lit dans `flask>=0.1`.
  {
    id: 'GHSA-jfh8-c2jp-5v3q',
    summary: 'Remote code injection in Log4j',
    aliases: ['CVE-2021-44228'],
    severite: 'CRITICAL',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H/E:H',
    score: '10.0',
    ecosysteme: 'Maven',
    paquet: 'org.apache.logging.log4j:log4j-core',
    plages: [
      ['2.13.0', '2.15.0'],
      ['2.0', '2.3.1'],
      ['2.4', '2.12.2'],
    ],
  },
  {
    id: 'GHSA-562c-5r94-xh97',
    summary: 'Flask is vulnerable to Denial of Service via incorrect encoding of JSON data',
    aliases: ['CVE-2018-1000656', 'PYSEC-2018-66'],
    severite: 'HIGH',
    cvss: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    score: '7.5',
    ecosysteme: 'PyPI',
    paquet: 'flask',
    plages: [['0', '0.12.3']],
  },
] as const;

/**
 * Le faux Betterleaks : `--version`, et `dir <chemin> …` sur les fichiers qu'on
 * lui donne — avec ce que l'outil réel fait AVANT de chercher, et qui décide de
 * ce qu'il voit :
 *
 *   · le PRÉFILTRE par défaut (mesuré sur 1.9.0) : un fichier nommé comme un
 *     lockfile, `go.mod`/`go.sum`, une image, un `*.min.js` connu n'est pas
 *     lu — sauf si la configuration passée (`--config`) l'éteint ;
 *   · la CONFIANCE (`--confidence`) : sans elle, les règles génériques de
 *     confiance basse parlent aussi — `generic-password` lit le
 *     `'new-password'` d'un `autoComplete`, comme l'outil réel sur
 *     `dashboard/src/AccountPanel.tsx`.
 *
 * Les règles rejouées, regex comprises, sont celles de la configuration par
 * défaut de 1.9.0 : la paire AWS (composite, la clé secrète en composant), la
 * clé privée PEM, le jeton GitHub, la clé Stripe — confiance haute — et
 * `generic-password`, confiance basse.
 */
const BETTERLEAKS = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const ici = path.dirname(fs.realpathSync(process.argv[1]));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(ici, 'appels'), ['betterleaks', ...args].join(' ') + '\n');
fs.appendFileSync(path.join(ici, 'proxys'), 'betterleaks ' + (process.env.HTTPS_PROXY ?? '-') + '\n');
let mode = '';
try { mode = fs.readFileSync(path.join(ici, 'mode-betterleaks'), 'utf8').trim(); } catch {}
if (args[0] === '--version') { process.stdout.write('betterleaks version 1.9.0\n'); process.exit(0); }
if (args[0] !== 'dir') { process.stderr.write('Error: unknown command\n'); process.exit(126); }
if (mode === 'plante') { process.stderr.write('panic: runtime error: index out of range\n'); process.exit(2); }
const valeur = (drapeau) => { const i = args.indexOf(drapeau); return i < 0 ? undefined : args[i + 1]; };
const caviarde = args.includes('--redact');
// « sans-confiance » : un outil qui n'appliquerait pas la confiance demandée.
const RANG = { low: 0, medium: 1, high: 2 };
const plancher = mode === 'sans-confiance' ? 0 : (RANG[valeur('--confidence')] ?? 0);
const config = valeur('--config') ? fs.readFileSync(valeur('--config'), 'utf8') : '';
const prefiltreEteint = /^prefilter = '''false'''$/m.test(config);
// Un extrait du préfiltre par défaut de 1.9.0, motif pour motif.
const PREFILTRE = [
  /(?:^|\/)(?:deno\.lock|npm-shrinkwrap\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /go\.(?:mod|sum|work(?:\.sum)?)$/,
  /(?:^|\/)(?:Pipfile|poetry)\.lock$/,
  /(?:^|\/)gradle\.lockfile$/,
  /\.(?:bmp|gif|jpe?g|png|svg|tiff?)$/i,
  /(?:^|\/)(?:angular|bootstrap|jquery(?:-?ui)?|plotly|swagger-?ui)[a-zA-Z0-9.-]*(?:\.min)?\.js(?:\.map)?$/,
  /gitleaks\.toml/,
];
const fichiers = [];
const parcourir = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) parcourir(p); else fichiers.push(p);
  }
};
parcourir(args[1]);
const octets = (s) => Buffer.byteLength(s, 'utf8');
const commun = (f, regle, ligne, confiance) => ({
  Attributes: { confidence: confiance, path: f, resource: 'fs.content' },
  Tags: [],
  Fingerprint: f + ':' + regle + ':' + ligne,
  File: f, SymlinkFile: '', Commit: '', Entropy: 4.121928, Author: '', Email: '', Date: '', Message: '',
});
// Une correspondance d'une ligne : ses colonnes en OCTETS, le secret caviardé dans Match.
const position = (lignes, i, m, secret) => {
  const de = octets(lignes[i].slice(0, m.index)) + 1;
  return {
    StartLine: i + 1, EndLine: i + 1, StartColumn: de, EndColumn: de + octets(m[0]) - 1,
    Match: caviarde ? m[0].replace(secret, 'REDACTED') : m[0], Secret: caviarde ? 'REDACTED' : secret,
  };
};
const trouvailles = [];
const trouver = (f, regle, confiance, description, champs) => {
  if (RANG[confiance] < plancher) return;
  trouvailles.push({ RuleID: regle, Description: description, ...champs, ...commun(f, regle, champs.StartLine, confiance) });
};
const SIMPLES = [
  { regle: 'github-pat', regex: /ghp_[0-9a-zA-Z]{36}/g, groupe: 0,
    description: 'Uncovered a GitHub Personal Access Token, potentially leading to unauthorized repository access and sensitive content exposure.' },
  { regle: 'stripe-access-token', regex: /\b((?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99})(?:\\?['"\x60]|[\s;]|\\[nr]|$)/g, groupe: 1,
    description: 'Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data.' },
];
const MOT_DE_PASSE = /(?:passw(?:or)?d|psw|[_.-]pw)\b[ \t'"\\]{0,3}(?:=>|:=|=|:)[ \t]{0,5}(?:"((?:\\.|[^"\\\r\n]){5,250})"|'((?:\\.|[^'\\\r\n]){5,250})')(?:[ \t]*[,;)}\]]|[ \t]*$)/i;
for (const f of fichiers.sort()) {
  if (!prefiltreEteint && PREFILTRE.some((m) => m.test(f))) continue;
  const lignes = fs.readFileSync(f, 'utf8').split('\n');
  // aws-access-token : une règle COMPOSITE — l'identifiant n'est signalé
  // qu'apparié à sa clé secrète, rapportée en composant (mesuré sur 1.9.0).
  const ID = /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/;
  const SECRETE = /(?:secret|access|key|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}([A-Za-z0-9/+=]{40})(?:\\?['"\x60]|[\s;]|\\[nr]|$)/i;
  const i = lignes.findIndex((l) => ID.test(l));
  const j = lignes.findIndex((l) => SECRETE.test(l));
  if (i >= 0 && j >= 0) {
    const m = ID.exec(lignes[i]);
    const s = SECRETE.exec(lignes[j]);
    trouver(f, 'aws-access-token', 'high',
      'Identified an AWS access key ID paired with a secret access key, which together can provide full access to AWS services.',
      { ...position(lignes, i, m, m[1]),
        ComponentSets: [{ components: [{ RuleID: 'aws-secret-access-key', Optional: false, ...position(lignes, j, s, s[1]) }] }] });
  }
  // private-key : sur plusieurs lignes, de l'en-tête au pied (mesuré : SC 1, EC = le pied).
  const debut = lignes.findIndex((l) => /^-----BEGIN [A-Z ]*PRIVATE KEY-----$/.test(l));
  const fin = lignes.findIndex((l, k) => k > debut && /^-----END [A-Z ]*PRIVATE KEY-----$/.test(l));
  if (debut >= 0 && fin > debut) {
    const bloc = lignes.slice(debut, fin + 1).join('\n');
    trouver(f, 'private-key', 'high',
      'Identified a Private Key, which may compromise cryptographic security and sensitive data encryption.',
      { StartLine: debut + 1, EndLine: fin + 1, StartColumn: 1, EndColumn: octets(lignes[fin]),
        Match: caviarde ? 'REDACTED' : bloc, Secret: caviarde ? 'REDACTED' : bloc });
  }
  lignes.forEach((ligne, k) => {
    for (const r of SIMPLES) {
      for (const m of ligne.matchAll(r.regex)) trouver(f, r.regle, 'high', r.description, position(lignes, k, m, m[r.groupe]));
    }
    const mdp = MOT_DE_PASSE.exec(ligne);
    if (mdp) trouver(f, 'generic-password', 'low',
      'Detected a potential hardcoded password literal, which may expose account credentials.',
      position(lignes, k, mdp, mdp[1] ?? mdp[2]));
  });
}
// « decale » : des colonnes qui ne se relisent plus dans le fichier.
if (mode === 'decale') {
  for (const t of trouvailles) {
    for (const p of [t, ...(t.ComponentSets ?? []).flatMap((e) => e.components)]) { p.StartColumn += 1000; p.EndColumn += 1000; }
  }
}
fs.writeFileSync(valeur('--report-path'), JSON.stringify(trouvailles, null, 1));
if (mode === 'menteur') process.exit(0);
process.exit(trouvailles.length > 0 ? Number(valeur('--exit-code') ?? '1') : 0);
`;

/**
 * Le faux osv-scanner : `--version`, et `scan source -L <fichier>… --output-file <f>`,
 * comme la porte l'appelle — et comme l'outil réel se comporte (mesuré sur
 * 2.6.0) :
 *
 *   · EXTRACTION (`--experimental-disable-plugins vulnmatch/osvdev`) : il lit
 *     chaque fichier par son NOM et rend ses paquets, sans rien interroger ;
 *   · INTERROGATION (sans ce drapeau) : il interroge pour chaque paquet lu —
 *     ce qu'il « envoie » est consigné dans `requetes` (une ligne JSON par
 *     paquet), de quoi prouver ce qui part, et ce qui ne part pas ;
 *   · un fichier qu'il ne sait pas lire fait échouer TOUT le passage : sortie
 *     127, « could not extract » — un seul lockfile mal formé aveuglait ainsi
 *     un passage qui les lisait tous ensemble ;
 *   · `hors-ligne` : osv.dev injoignable — rapport VIDE et valide, sortie 127,
 *     le message réel sur stderr.
 *
 * Il lit `package-lock.json` (v1 et v3 : registre, git, `file:`), les
 * `requirements*.txt` (la BORNE BASSE d'une contrainte, comme l'outil : `flask>=0.1`
 * est lu « flask 0.1 »), `gradle.lockfile` et les SBOM CycloneDX
 * (`bom.cdx.json`). Le proxy reçu par chaque lancement est consigné dans `proxys`.
 */
const OSV_SCANNER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const ici = path.dirname(fs.realpathSync(process.argv[1]));
const args = process.argv.slice(2);
fs.appendFileSync(path.join(ici, 'appels'), ['osv-scanner', ...args].join(' ') + '\n');
let mode = '';
try { mode = fs.readFileSync(path.join(ici, 'mode-osv-scanner'), 'utf8').trim(); } catch {}
if (args[0] === '--version') {
  process.stdout.write('osv-scanner version: 2.6.0\nosv-scalibr version: 0.5.2\ncommit: e840a6e8adb14b7777c78e26cfbf6e2abc1d1fc6\nbuilt at: 2026-09-14T01:44:58Z\n');
  process.exit(0);
}
const extraction = args.join(' ').includes('--experimental-disable-plugins vulnmatch/osvdev');
fs.appendFileSync(path.join(ici, 'proxys'), (extraction ? 'extraction ' : 'interrogation ') + (process.env.HTTPS_PROXY ?? '-') + '\n');
const AVIS = JSON.parse(fs.readFileSync(path.join(ici, 'avis.json'), 'utf8'));
const valeur = (drapeau) => { const i = args.indexOf(drapeau); return i < 0 ? undefined : args[i + 1]; };
const vide = { results: [], experimental_config: { licenses: { summary: false, allowlist: null } } };
const fichiers = args.flatMap((a, i) => (a === '-L' ? [args[i + 1]] : []));
const PURL = { npm: 'npm', pypi: 'PyPI', maven: 'Maven', cargo: 'crates.io', gem: 'RubyGems', composer: 'Packagist', golang: 'Go', nuget: 'NuGet' };
// Un fichier, lu comme l'outil le lit : par son NOM.
const lire = (f) => {
  const nom = path.basename(f);
  const texte = fs.readFileSync(f, 'utf8');
  if (nom === 'package-lock.json' || nom === 'npm-shrinkwrap.json') {
    let v;
    try { v = JSON.parse(texte); } catch (e) { return { erreur: 'javascript/packagelockjson', motif: 'unexpected end of JSON input' }; }
    const paquets = [];
    const un = (nomP, p) => {
      const git = typeof p.resolved === 'string' ? /^git\+[a-z]+:\/\/(?:git@)?([^#]+?)(?:\.git)?#([0-9a-f]{40})$/.exec(p.resolved) : null;
      if (git) paquets.push({ name: 'https://' + git[1].replace(':', '/'), version: p.version ?? '', ecosystem: 'GIT', commit: git[2] });
      else paquets.push({ name: nomP, version: p.link ? '' : (p.version ?? ''), ecosystem: 'npm' });
    };
    for (const [cle, p] of Object.entries(v.packages ?? {})) {
      if (cle === '') continue;
      un(p.name ?? cle.slice(cle.lastIndexOf('node_modules/') + 'node_modules/'.length), p);
    }
    const arbre = (deps) => { for (const [n, d] of Object.entries(deps ?? {})) { un(n, d); arbre(d.dependencies); } };
    if (!v.packages) arbre(v.dependencies);
    return { paquets };
  }
  if (/requirements.*\.txt$/.test(nom)) {
    const paquets = [];
    for (const l of texte.split('\n')) {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:==|>=|~=|<=)\s*([0-9][^\s;,]*)/.exec(l.trim());
      if (m) paquets.push({ name: m[1].toLowerCase(), version: m[2], ecosystem: 'PyPI' });
    }
    return { paquets };
  }
  if (nom === 'gradle.lockfile') {
    const paquets = [];
    for (const m of texte.matchAll(/^([^#\s:=]+):([^\s:=]+):([^\s:=]+)=/gm)) paquets.push({ name: m[1] + ':' + m[2], version: m[3], ecosystem: 'Maven' });
    return { paquets };
  }
  if (nom === 'bom.cdx.json') {
    const paquets = [];
    for (const c of JSON.parse(texte).components ?? []) {
      const type = /^pkg:([a-z]+)\//.exec(c.purl ?? '')?.[1];
      if (PURL[type]) paquets.push({ name: c.name, version: c.version, ecosystem: PURL[type] });
    }
    return { paquets, sbom: true };
  }
  return { erreur: 'inconnu', motif: 'could not determine extractor' };
};
const lus = fichiers.map((f) => ({ f, ...lire(f) }));
const casse = lus.find((l) => l.erreur);
if (casse) {
  process.stderr.write('Error during extraction: (extracting as ' + casse.erreur + ') ' + path.resolve(casse.f).slice(1) + ': could not extract: ' + casse.motif + '\nextraction failed on specified lockfile\n');
  process.exit(127);
}
const source = (l) => ({ path: path.resolve(l.f), type: l.sbom ? 'sbom' : 'lockfile' });
if (extraction) {
  const results = lus.filter((l) => l.paquets.length > 0).map((l) => ({ source: source(l), packages: l.paquets.map((p) => ({ package: p })) }));
  fs.writeFileSync(valeur('--output-file'), JSON.stringify({ ...vide, results }, null, 2));
  process.exit(0);
}
if (mode === 'hors-ligne') {
  fs.writeFileSync(valeur('--output-file'), JSON.stringify(vide, null, 2));
  process.stderr.write('Error during extraction: (extracting as vulnmatch/osvdev) max retries exceeded: attempt 4: request failed: Post "https://api.osv.dev/v1/querybatch": dial tcp: lookup api.osv.dev: no such host\n');
  process.exit(127);
}
// Ce qui PART : une requête par paquet lu — par commit pour une source git.
for (const l of lus) for (const p of l.paquets) {
  fs.appendFileSync(path.join(ici, 'requetes'), JSON.stringify(p.ecosystem === 'GIT' ? { commit: p.commit } : { version: p.version, package: { name: p.name, ecosystem: p.ecosystem } }) + '\n');
}
const champs = (v) => v.split('.').map(Number);
const avant = (a, b) => { const x = champs(a), y = champs(b); for (let k = 0; k < 3; k++) { if ((x[k] ?? 0) !== (y[k] ?? 0)) return (x[k] ?? 0) < (y[k] ?? 0); } return false; };
const touche = (avis, version) => avis.plages.some(([de, a]) => !avant(version, de) && avant(version, a));
const enregistrement = (a) => ({
  modified: '2026-09-10T03:49:04Z', published: '2021-05-06T16:05:51Z', schema_version: '1.9.0',
  id: a.id, aliases: a.aliases, summary: a.summary, details: a.summary + '.',
  affected: a.plages.map(([de, corrige]) => ({ package: { ecosystem: a.ecosysteme, name: a.paquet },
    ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: de }, { fixed: corrige }] }] })),
  references: [{ type: 'ADVISORY', url: 'https://github.com/advisories/' + a.id }],
  database_specific: { github_reviewed: true, severity: a.severite },
  severity: [{ type: 'CVSS_V3', score: a.cvss }],
});
const results = [];
for (const l of lus) {
  const packages = [];
  for (const p of l.paquets) {
    const vulns = AVIS.filter((a) => a.ecosysteme === p.ecosystem && a.paquet === p.name && touche(a, p.version));
    if (vulns.length === 0) continue;
    // Les groupes d'alias, comme l'outil : deux avis qui se nomment l'un l'autre n'en font qu'un.
    const groupes = [];
    for (const a of vulns) {
      const g = groupes.find((x) => x.ids.some((id) => a.aliases.includes(id)));
      if (g) { g.ids.push(a.id); g.aliases = [...new Set([...g.aliases, ...a.aliases, a.id])].sort(); }
      else groupes.push({ ids: [a.id], aliases: [...new Set([...a.aliases, a.id])].sort(), max_severity: a.score });
    }
    packages.push({ package: { name: p.name, version: p.version, ecosystem: p.ecosystem }, groups: groupes, vulnerabilities: vulns.map(enregistrement) });
  }
  if (packages.length > 0) results.push({ source: source(l), packages });
}
fs.writeFileSync(valeur('--output-file'), JSON.stringify({ ...vide, results }, null, 2));
process.exit(results.length > 0 ? 1 : 0);
`;

export interface FauxOutils {
  /** Le dossier à mettre en tête du PATH. */
  dossier: string;
  /** Change le comportement d'un outil (voir l'en-tête), ou le rend absent (`absent`). */
  mode(outil: 'betterleaks' | 'osv-scanner', mode: string): void;
}

/**
 * Pose les deux faux dans un dossier temporaire HORS du dépôt éprouvé, inscrit
 * dans `dossiers` pour que le banc l'efface.
 */
export function fauxOutilsPorte(dossiers: string[]): FauxOutils {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-outils-porte-'));
  dossiers.push(dossier);
  // `process.execPath` en dur : le PATH du banc peut ne pas nommer `node`.
  const poser = (nom: string, corps: string): void => {
    const fichier = path.join(dossier, nom);
    writeFileSync(fichier, `#!${process.execPath}\n${corps}`);
    chmodSync(fichier, 0o755);
  };
  poser('betterleaks', BETTERLEAKS);
  poser('osv-scanner', OSV_SCANNER);
  writeFileSync(path.join(dossier, 'avis.json'), JSON.stringify(AVIS));
  return {
    dossier,
    mode(outil, mode) {
      // Un outil absent du PATH : on retire le script, pas le dossier.
      if (mode === 'absent') return rmSync(path.join(dossier, outil), { force: true });
      writeFileSync(path.join(dossier, `mode-${outil}`), mode);
    },
  };
}

/** Les lignes de commande reçues par les faux outils, une par lancement. */
export function appelsDesOutils(outils: FauxOutils): string[] {
  const journal = path.join(outils.dossier, 'appels');
  return existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [];
}

/** Oublie les appels passés — un banc qui compte ceux d'UNE production. */
export function effacerAppels(outils: FauxOutils): void {
  writeFileSync(path.join(outils.dossier, 'appels'), '');
}

/** Ce que le faux osv-scanner a « envoyé à osv.dev » : une requête par paquet interrogé. */
export function requetesEnvoyees(outils: FauxOutils): Record<string, unknown>[] {
  const journal = path.join(outils.dossier, 'requetes');
  if (!existsSync(journal)) return [];
  return readFileSync(journal, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Le `HTTPS_PROXY` que chaque lancement d'osv-scanner a reçu (`-` : aucun), passe par passe. */
export function proxysRecus(outils: FauxOutils): string[] {
  const journal = path.join(outils.dossier, 'proxys');
  return existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [];
}
