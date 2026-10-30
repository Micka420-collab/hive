// Les skills d'agent de la ruche — une source, deux outils, aucune confiance
// prêtée.
//
// ─── UNE SOURCE, DEUX OUTILS ─────────────────────────────────────────────────
//
// Codex lit `.agents/skills/` ; Claude Code lit `.claude/skills/`. Les deux
// suivent le même standard (agentskills.io : un dossier, un `SKILL.md`, un
// frontmatter `name` + `description`). La source est `.agents/skills/` ;
// `.claude/skills/` en est une COPIE générée, commitée, et la suite vitest
// rougit si elles divergent (`tests/skills-gouvernance.test.mjs`).
//
// Pourquoi une copie et pas un lien : sous Windows, git ne recrée un lien
// symbolique que si `core.symlinks=true` ET le mode développeur — sinon le
// lien devient un fichier texte et le skill disparaît sans un mot. Et la
// ruche refuse déjà de suivre les liens des consignes d'un dépôt (#520).
//
// ─── AUCUNE CONFIANCE PRÊTÉE ─────────────────────────────────────────────────
//
// Un skill est du texte qu'un agent prend pour des ordres, souvent avec des
// scripts à côté. L'étude ToxicSkills (Snyk, février 2026) en a trouvé 13 %
// avec une faille critique et 76 charges malveillantes confirmées ; Trail of
// Bits a contourné les scanners des catalogues en moins d'une heure. Les
// skills TIERS ne sont donc jamais copiés dans le dépôt (licences mêlées, et
// on n'y met pas ce qu'on n'a pas écrit) : `skills.lock.json` les ÉPINGLE à un
// commit, avec l'empreinte de leur arbre, leur licence et qui les a lus.
// `installer` les pose chez un contributeur — après avoir refait l'empreinte
// et l'audit, et refusé tout écart.
//
// Usage :
//   node scripts/skills.mjs synchroniser            .agents/skills → .claude/skills
//   node scripts/skills.mjs verifier                écart de copie, conformité, audit
//   node scripts/skills.mjs auditer <dossier>...    heuristiques anti-injection
//   node scripts/skills.mjs empreinte <dossier>     l'empreinte d'un arbre
//   node scripts/skills.mjs installer [--dossier <maison>] [--seulement a,b]
//                                     [--sans-liens] [--remplacer]
//   node scripts/skills.mjs relever <source> <commit> <chemin>
//                                     empreinte, écarts et audit d'un skill
//                                     tiers, pour écrire (ou réviser) son
//                                     entrée du verrou — APRÈS l'avoir lu
//
// Sans dépendance : il doit tourner sur une machine qui n'a que Node et git.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RACINE = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE = path.join(RACINE, '.agents', 'skills');
export const COPIE = path.join(RACINE, '.claude', 'skills');
export const VERROU = path.join(RACINE, 'skills.lock.json');
export const EXCEPTIONS = path.join(SOURCE, '.audit-exceptions.json');

/** Ce qu'un `installer` dépose dans chaque skill qu'il pose : la provenance. */
export const MARQUE = '.hive-skill.json';

// ─── Le standard ─────────────────────────────────────────────────────────────

/** agentskills.io : 1 à 64 caractères, minuscules, chiffres, tirets isolés. */
export const MOTIF_NOM = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;

/** Les clés du standard. Toute autre clé rend un skill non portable. */
export const CLES_STANDARD = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

/**
 * Lit le frontmatter d'un `SKILL.md` : le sous-ensemble de YAML qu'un skill
 * emploie — `clé: valeur` (guillemets simples ou doubles retirés) et un bloc
 * `metadata:` de paires indentées. Rend `null` sans frontmatter.
 */
export function lireFrontmatter(texte) {
  const lignes = texte.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lignes[0] !== '---') return null;
  const fin = lignes.indexOf('---', 1);
  if (fin === -1) return null;
  const champs = {};
  let bloc = null;
  for (const ligne of lignes.slice(1, fin)) {
    if (ligne.trim() === '' || ligne.trimStart().startsWith('#')) continue;
    const indentee = /^\s+/.test(ligne);
    const m = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(ligne);
    if (!m) return { ...champs, __illisible: ligne };
    const [, cle, brut] = m;
    const valeur = brut.replace(/^(['"])(.*)\1$/, '$2');
    if (indentee && bloc) {
      champs[bloc][cle] = valeur;
    } else if (valeur === '') {
      bloc = cle;
      champs[cle] = {};
    } else {
      bloc = null;
      champs[cle] = valeur;
    }
  }
  return { champs, corps: lignes.slice(fin + 1).join('\n') };
}

/**
 * Les écarts d'un dossier de skill au standard, en phrases. Vide : conforme.
 * `nomAttendu` : le nom du dossier (le standard exige qu'ils coïncident).
 */
export function ecartsAuStandard(dossier, nomAttendu = path.basename(dossier)) {
  const fichier = path.join(dossier, 'SKILL.md');
  if (!existsSync(fichier)) return ['SKILL.md absent'];
  const lu = lireFrontmatter(readFileSync(fichier, 'utf8'));
  if (lu === null) return ['frontmatter absent (le fichier doit commencer par ---)'];
  if (lu.__illisible !== undefined) return [`frontmatter illisible : « ${lu.__illisible} »`];
  const { champs, corps } = lu;
  const ecarts = [];
  if (typeof champs.name !== 'string' || !MOTIF_NOM.test(champs.name)) {
    ecarts.push(
      `name « ${champs.name ?? ''} » hors du standard (a-z, 0-9, tirets isolés, 64 au plus)`,
    );
  } else if (champs.name !== nomAttendu) {
    ecarts.push(`name « ${champs.name} » ≠ dossier « ${nomAttendu} »`);
  }
  const description = typeof champs.description === 'string' ? champs.description : '';
  if (description.length < 1 || description.length > 1024) {
    ecarts.push(`description de ${description.length} caractères (1 à 1024)`);
  }
  if (typeof champs.compatibility === 'string' && champs.compatibility.length > 500) {
    ecarts.push('compatibility au-delà de 500 caractères');
  }
  for (const cle of Object.keys(champs)) {
    if (!CLES_STANDARD.has(cle)) ecarts.push(`clé « ${cle} » hors du standard`);
  }
  const lignesCorps = corps.split('\n').length;
  if (lignesCorps > 500) ecarts.push(`corps de ${lignesCorps} lignes (500 au plus recommandé)`);
  return ecarts;
}

// ─── L'empreinte d'un arbre ──────────────────────────────────────────────────

function fichiersDe(dossier, ignorer = new Set()) {
  const trouves = [];
  const parcourir = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (ignorer.has(e.name)) continue;
      const chemin = path.join(d, e.name);
      if (e.isDirectory()) parcourir(chemin);
      else if (e.isFile()) trouves.push(chemin);
      else throw new Error(`${chemin} : ni fichier ni dossier (lien ?) — refusé`);
    }
  };
  parcourir(dossier);
  return trouves.map((f) => path.relative(dossier, f).split(path.sep).join('/')).sort();
}

/**
 * L'empreinte SHA-256 d'un arbre : chemins relatifs triés (séparateur `/`)
 * et contenus, chacun suivi d'un octet nul. Un lien symbolique est REFUSÉ —
 * il pourrait désigner n'importe quoi hors de l'arbre. `ignorer` : des noms
 * de fichiers à laisser de côté (la marque d'installation, `.git`).
 */
export function empreinteArbre(dossier, ignorer = new Set([MARQUE, '.git'])) {
  const h = createHash('sha256');
  for (const relatif of fichiersDe(dossier, ignorer)) {
    h.update(relatif);
    h.update('\0');
    h.update(readFileSync(path.join(dossier, ...relatif.split('/'))));
    h.update('\0');
  }
  return h.digest('hex');
}

// ─── L'audit ─────────────────────────────────────────────────────────────────

/**
 * Les motifs qui n'ont rien à faire dans un skill — ou alors à voix haute, et
 * inscrits dans les exceptions. Une heuristique ne PROUVE rien : elle force à
 * regarder. La lecture humaine reste l'audit ; ceci attrape ce que l'œil ne
 * voit pas (Unicode invisible) et ce qu'il laisse filer à la vingtième page.
 */
export const REGLES = [
  {
    regle: 'unicode-invisible',
    motif: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/u,
    pourquoi: 'caractère invisible ou de direction : du texte qu’un humain ne lit pas',
  },
  {
    regle: 'tuyau-vers-shell',
    motif:
      /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)\b|\bInvoke-Expression\b/i,
    pourquoi: 'exécute ce qu’un serveur renvoie',
  },
  {
    regle: 'base64-execute',
    motif: /base64\s+(?:-d|--decode)[^\n]*\|\s*(?:ba)?sh\b|\beval\s*\(\s*(?:atob|Buffer\.from)\b/i,
    pourquoi: 'exécute un contenu masqué',
  },
  {
    regle: 'ordre-a-l-agent',
    motif:
      /ignore (?:all |any )?(?:previous|prior|above|earlier) (?:instructions|prompts)|\bdeveloper mode\b|do not (?:tell|inform|mention (?:this )?to) the user|without (?:telling|asking|informing) the user|ignore (?:tes|vos|les) (?:consignes|instructions) (?:précédentes|antérieures)/i,
    pourquoi: 'formule d’injection de prompt',
  },
  {
    regle: 'secret',
    motif:
      /~\/\.ssh\b|\bid_(?:rsa|ed25519|ecdsa)\b|\.aws\/credentials|\b(?:ANTHROPIC|OPENAI|CODEX)_API_KEY\b|\bCLAUDE_CODE_OAUTH_TOKEN\b|\bHIVE_(?:TOKEN|JWT_SECRET|WEBHOOK_SECRET)\b/,
    pourquoi: 'désigne un secret',
  },
  {
    regle: 'outils-larges',
    motif: /^allowed-tools:.*(?:\bBash\(\s*\*\s*\)|\bBash\b(?!\())/m,
    pourquoi: 'pré-autorise tout le shell',
  },
];

/** Les fichiers qu'on ne lit pas comme du texte. */
const BINAIRE = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip|gz)$/i;

/**
 * Les trouvailles d'un dossier : `{ fichier, ligne, regle, pourquoi }`.
 * `exceptions` : `[{ fichier, regle, raison }]`, chemins relatifs au dossier
 * audité — une trouvaille qui y figure est ACCEPTÉE (relue, raison écrite).
 */
export function auditer(dossier, exceptions = []) {
  const trouvailles = [];
  for (const relatif of fichiersDe(dossier, new Set([MARQUE, '.git']))) {
    if (BINAIRE.test(relatif)) continue;
    const texte = readFileSync(path.join(dossier, ...relatif.split('/')), 'utf8');
    for (const { regle, motif, pourquoi } of REGLES) {
      const global = new RegExp(motif.source, `${motif.flags.replace('g', '')}g`);
      for (const m of texte.matchAll(global)) {
        const accepte = exceptions.some((x) => x.fichier === relatif && x.regle === regle);
        if (accepte) continue;
        const ligne = texte.slice(0, m.index).split('\n').length;
        trouvailles.push({ fichier: relatif, ligne, regle, pourquoi });
      }
    }
  }
  return trouvailles;
}

/** Les exceptions de `.agents/skills/.audit-exceptions.json`, relatives à `.agents/skills`. */
export function lireExceptions(fichier = EXCEPTIONS) {
  if (!existsSync(fichier)) return [];
  const brut = JSON.parse(readFileSync(fichier, 'utf8'));
  if (!Array.isArray(brut)) throw new Error(`${fichier} : un tableau est attendu`);
  for (const x of brut) {
    if (
      typeof x.fichier !== 'string' ||
      typeof x.regle !== 'string' ||
      typeof x.raison !== 'string' ||
      x.raison.trim().length < 10
    ) {
      throw new Error(`${fichier} : chaque exception porte fichier, regle et une raison écrite`);
    }
  }
  return brut;
}

// ─── La copie .agents → .claude ──────────────────────────────────────────────

/** Les skills d'un dossier source : ses sous-dossiers, triés. */
export function skillsDe(dossier = SOURCE) {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Les écarts entre la source et sa copie : skills manquants, différents ou
 * orphelins. Vide : la copie est fidèle.
 */
export function ecartsDeCopie(source = SOURCE, copie = COPIE) {
  const ecarts = [];
  const sources = skillsDe(source);
  const copies = new Set(skillsDe(copie));
  for (const nom of sources) {
    if (!copies.has(nom)) ecarts.push(`${nom} : absent de la copie`);
    else if (empreinteArbre(path.join(source, nom)) !== empreinteArbre(path.join(copie, nom))) {
      ecarts.push(`${nom} : diffère de la source`);
    }
    copies.delete(nom);
  }
  for (const orphelin of copies) ecarts.push(`${orphelin} : orphelin (absent de la source)`);
  return ecarts;
}

/** Refait la copie là où elle diverge. Rend les noms réécrits ou retirés. */
export function synchroniser(source = SOURCE, copie = COPIE) {
  const touches = [];
  mkdirSync(copie, { recursive: true });
  const sources = new Set(skillsDe(source));
  for (const nom of sources) {
    const de = path.join(source, nom);
    const vers = path.join(copie, nom);
    if (existsSync(vers) && empreinteArbre(de) === empreinteArbre(vers)) continue;
    rmSync(vers, { recursive: true, force: true });
    cpSync(de, vers, { recursive: true });
    touches.push(nom);
  }
  for (const nom of skillsDe(copie)) {
    if (sources.has(nom)) continue;
    rmSync(path.join(copie, nom), { recursive: true, force: true });
    touches.push(nom);
  }
  return touches;
}

// ─── Le verrou des skills tiers ──────────────────────────────────────────────

const SHA_GIT = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const SOURCE_GIT = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Lit et VALIDE `skills.lock.json`. Lève à la première entrée fautive : un
 * verrou à moitié valide est un verrou qu'on contourne.
 */
export function lireVerrou(fichier = VERROU) {
  const brut = JSON.parse(readFileSync(fichier, 'utf8'));
  if (brut.version !== 1 || !Array.isArray(brut.skills)) {
    throw new Error(`${fichier} : { "version": 1, "skills": [...] } attendu`);
  }
  const vus = new Set();
  for (const s of brut.skills) {
    const ou = `${fichier} → ${s.nom ?? '?'}`;
    if (typeof s.nom !== 'string' || !MOTIF_NOM.test(s.nom))
      throw new Error(`${ou} : nom hors du standard`);
    if (vus.has(s.nom)) throw new Error(`${ou} : nom en double`);
    vus.add(s.nom);
    if (!SOURCE_GIT.test(s.source ?? ''))
      throw new Error(`${ou} : source https://github.com/<org>/<dépôt> attendue`);
    if (!SHA_GIT.test(s.commit ?? ''))
      throw new Error(`${ou} : commit = SHA complet de 40 caractères (jamais une branche)`);
    if (
      typeof s.chemin !== 'string' ||
      s.chemin.split('/').some((p) => p === '' || p === '..' || p === '.')
    ) {
      throw new Error(`${ou} : chemin relatif sans « .. » attendu`);
    }
    if (!SHA_256.test(s.empreinte ?? ''))
      throw new Error(`${ou} : empreinte SHA-256 de l’arbre attendue`);
    if (typeof s.licence !== 'string' || s.licence === '')
      throw new Error(`${ou} : licence attendue`);
    if (typeof s.scripts !== 'boolean') throw new Error(`${ou} : scripts (booléen) attendu`);
    const a = s.audit ?? {};
    if (
      typeof a.par !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(a.le ?? '') ||
      typeof a.notes !== 'string'
    ) {
      throw new Error(`${ou} : audit { par, le (AAAA-MM-JJ), notes } attendu`);
    }
    if (!Array.isArray(a.exceptions ?? []))
      throw new Error(`${ou} : audit.exceptions doit être un tableau`);
  }
  return brut.skills;
}

// ─── L'installation chez un contributeur ─────────────────────────────────────

/**
 * git SANS rien de ce que le dépôt récupéré pourrait apporter : ni crochet,
 * ni moniteur, ni filtre (`info/attributes`), ni invite d'identifiants. Même
 * politique que `src/shared/git-protege.ts`, en JavaScript nu.
 */
function gitNu(args, cwd) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=' + path.join(process.execPath, 'aucun-crochet'),
      '-c',
      'core.autocrlf=false',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
      windowsHide: true,
    },
  );
}

/** Récupère `source` au `commit` exact dans un dossier jetable. Rend son chemin. */
export function recuperer(source, commit, temp) {
  const d = mkdtempSync(path.join(temp, 'skill-'));
  gitNu(['init', '-q', '--template=', d], temp);
  mkdirSync(path.join(d, '.git', 'info'), { recursive: true });
  writeFileSync(
    path.join(d, '.git', 'info', 'attributes'),
    '* -filter -text -ident -working-tree-encoding\n',
  );
  gitNu(['remote', 'add', 'origin', source], d);
  gitNu(['fetch', '-q', '--depth', '1', '--no-tags', 'origin', commit], d);
  gitNu(['-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD'], d);
  const tete = gitNu(['rev-parse', 'HEAD'], d).trim();
  if (tete !== commit) throw new Error(`${source} : HEAD ${tete} ≠ ${commit}`);
  return d;
}

/**
 * Pose un lien de dossier : jonction NTFS sous Windows (sans droits
 * administrateur ni mode développeur), lien symbolique ailleurs. Un chemin
 * déjà occupé par AUTRE CHOSE qu'un lien vers `cible` n'est pas touché.
 */
function lier(cible, lien) {
  if (existsSync(lien) || lstatExiste(lien)) {
    const st = lstatSync(lien);
    if (
      st.isSymbolicLink() &&
      path.resolve(path.dirname(lien), readlinkSync(lien)) === path.resolve(cible)
    ) {
      return 'deja';
    }
    if (st.isSymbolicLink()) {
      rmSync(lien, { force: true });
    } else {
      return 'occupe';
    }
  }
  symlinkSync(cible, lien, process.platform === 'win32' ? 'junction' : 'dir');
  return 'lie';
}

function lstatExiste(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installe les skills tiers du verrou dans `<maison>/.agents/skills/<nom>`
 * (Codex) et les lie dans `<maison>/.claude/skills/<nom>` (Claude Code).
 *
 * Refuse — skill par skill, sans rien poser — une empreinte qui diffère du
 * verrou, une trouvaille d'audit non inscrite, un `SKILL.md` hors standard.
 * N'écrase JAMAIS un skill que l'utilisateur a posé lui-même (sans marque
 * d'installation), sauf `remplacer`.
 */
export function installer({
  maison = os.homedir(),
  seulement = null,
  liens = true,
  remplacer = false,
  verrou = lireVerrou(),
  journal = console.log,
} = {}) {
  const choisis = verrou.filter((s) => seulement === null || seulement.includes(s.nom));
  if (seulement !== null) {
    const inconnus = seulement.filter((n) => !verrou.some((s) => s.nom === n));
    if (inconnus.length > 0) throw new Error(`absents du verrou : ${inconnus.join(', ')}`);
  }
  const canon = path.join(maison, '.agents', 'skills');
  const claude = path.join(maison, '.claude', 'skills');
  mkdirSync(canon, { recursive: true });
  if (liens) mkdirSync(claude, { recursive: true });
  const temp = mkdtempSync(path.join(os.tmpdir(), 'hive-skills-'));
  const cache = new Map();
  const bilan = { poses: [], refuses: [] };
  try {
    for (const s of choisis) {
      const refuser = (raison) => {
        bilan.refuses.push({ nom: s.nom, raison });
        journal(`✘ ${s.nom} : ${raison}`);
      };
      const cle = `${s.source}@${s.commit}`;
      let depot = cache.get(cle);
      try {
        if (!depot) {
          depot = recuperer(s.source, s.commit, temp);
          cache.set(cle, depot);
        }
      } catch (e) {
        refuser(`récupération impossible — ${String(e.message ?? e).split('\n')[0]}`);
        continue;
      }
      const dossier = path.join(depot, ...s.chemin.split('/'));
      if (!existsSync(dossier)) {
        refuser(`${s.chemin} absent au commit ${s.commit.slice(0, 12)}`);
        continue;
      }
      const empreinte = empreinteArbre(dossier);
      if (empreinte !== s.empreinte) {
        refuser(
          `empreinte ${empreinte.slice(0, 12)}… ≠ verrou ${s.empreinte.slice(0, 12)}… — l’arbre n’est pas celui qui a été lu`,
        );
        continue;
      }
      const ecarts = ecartsAuStandard(dossier, s.nom);
      if (ecarts.length > 0) {
        refuser(`hors standard — ${ecarts.join(' ; ')}`);
        continue;
      }
      const trouvailles = auditer(dossier, s.audit.exceptions ?? []);
      if (trouvailles.length > 0) {
        refuser(
          `audit — ${trouvailles.map((t) => `${t.fichier}:${t.ligne} ${t.regle}`).join(', ')}`,
        );
        continue;
      }
      const vers = path.join(canon, s.nom);
      if (existsSync(vers) && !existsSync(path.join(vers, MARQUE)) && !remplacer) {
        refuser(`${vers} existe et n’a pas été posé par ce script (--remplacer pour l’écraser)`);
        continue;
      }
      rmSync(vers, { recursive: true, force: true });
      cpSync(dossier, vers, { recursive: true });
      writeFileSync(
        path.join(vers, MARQUE),
        `${JSON.stringify({ source: s.source, commit: s.commit, chemin: s.chemin, empreinte: s.empreinte, licence: s.licence }, null, 2)}\n`,
      );
      let lien = 'sans lien';
      if (liens) lien = lier(vers, path.join(claude, s.nom));
      bilan.poses.push({ nom: s.nom, lien });
      journal(
        `✔ ${s.nom} (${s.licence}${s.scripts ? ', avec scripts' : ''}) → ${vers}${lien === 'occupe' ? ' — ~/.claude/skills/' + s.nom + ' est déjà pris, non lié' : ''}`,
      );
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return bilan;
}

// ─── La ligne de commande ────────────────────────────────────────────────────

/**
 * L'audit des skills du dépôt, skill par skill. Les exceptions sont écrites
 * relativement à `.agents/skills` (`nom/fichier`) : on les ramène à chaque
 * dossier. Les fichiers posés à la racine (les exceptions elles-mêmes) ne sont
 * pas des skills et ne s'auditent pas.
 */
export function auditerSource(source = SOURCE, exceptions = lireExceptions()) {
  const trouvailles = [];
  for (const nom of skillsDe(source)) {
    const siennes = exceptions
      .filter((x) => x.fichier.startsWith(`${nom}/`))
      .map((x) => ({ ...x, fichier: x.fichier.slice(nom.length + 1) }));
    for (const t of auditer(path.join(source, nom), siennes)) {
      trouvailles.push({ ...t, fichier: `${nom}/${t.fichier}` });
    }
  }
  return trouvailles;
}

function verifier() {
  const ecarts = [];
  for (const nom of skillsDe(SOURCE)) {
    for (const e of ecartsAuStandard(path.join(SOURCE, nom))) ecarts.push(`${nom} : ${e}`);
  }
  ecarts.push(...ecartsDeCopie());
  for (const t of auditerSource())
    ecarts.push(`${t.fichier}:${t.ligne} ${t.regle} — ${t.pourquoi}`);
  lireVerrou();
  return ecarts;
}

function option(args, nom) {
  const i = args.indexOf(nom);
  return i === -1 ? undefined : args[i + 1];
}

export function main(args = process.argv.slice(2)) {
  const [commande, ...reste] = args;
  switch (commande) {
    case 'synchroniser': {
      const touches = synchroniser();
      console.log(
        touches.length === 0 ? '.claude/skills est à jour.' : `Réécrits : ${touches.join(', ')}`,
      );
      return 0;
    }
    case 'verifier': {
      const ecarts = verifier();
      for (const e of ecarts) console.error(`✘ ${e}`);
      if (ecarts.length === 0)
        console.log('Skills conformes, copie fidèle, audit propre, verrou valide.');
      else
        console.error(
          '\nCorrigez la source (.agents/skills), puis : node scripts/skills.mjs synchroniser',
        );
      return ecarts.length === 0 ? 0 : 1;
    }
    case 'auditer': {
      let total = 0;
      for (const d of reste) {
        for (const t of auditer(path.resolve(d))) {
          console.log(`${d}/${t.fichier}:${t.ligne}  ${t.regle} — ${t.pourquoi}`);
          total++;
        }
      }
      return total === 0 ? 0 : 1;
    }
    case 'empreinte': {
      for (const d of reste) console.log(`${empreinteArbre(path.resolve(d))}  ${d}`);
      return 0;
    }
    case 'installer': {
      const seulement =
        option(reste, '--seulement')
          ?.split(',')
          .map((s) => s.trim())
          .filter(Boolean) ?? null;
      const bilan = installer({
        maison: option(reste, '--dossier') ?? os.homedir(),
        seulement,
        liens: !reste.includes('--sans-liens'),
        remplacer: reste.includes('--remplacer'),
      });
      console.log(
        `\n${bilan.poses.length} posé(s), ${bilan.refuses.length} refusé(s). Relancez Claude Code et Codex, puis /skills.`,
      );
      return bilan.refuses.length === 0 ? 0 : 1;
    }
    case 'relever': {
      const [source, commit, chemin] = reste;
      if (!SOURCE_GIT.test(source ?? '') || !SHA_GIT.test(commit ?? '') || !chemin) {
        console.error(
          'Usage : node scripts/skills.mjs relever https://github.com/<org>/<dépôt> <sha40> <chemin>',
        );
        return 2;
      }
      const temp = mkdtempSync(path.join(os.tmpdir(), 'hive-skills-'));
      try {
        const dossier = path.join(recuperer(source, commit, temp), ...chemin.split('/'));
        console.log(`empreinte  ${empreinteArbre(dossier)}`);
        for (const e of ecartsAuStandard(dossier)) console.log(`écart      ${e}`);
        for (const t of auditer(dossier))
          console.log(`audit      ${t.fichier}:${t.ligne} ${t.regle} — ${t.pourquoi}`);
        const scripts = fichiersDe(dossier).filter((f) =>
          /\.(?:py|sh|ps1|js|mjs|cjs|ts|rb|pl|bat|cmd)$/i.test(f),
        );
        console.log(`scripts    ${scripts.length === 0 ? 'aucun' : scripts.join(', ')}`);
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
      return 0;
    }
    default:
      console.error(
        'Usage : node scripts/skills.mjs <synchroniser|verifier|auditer|empreinte|installer|relever> …',
      );
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
