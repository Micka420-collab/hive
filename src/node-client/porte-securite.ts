// La porte de sécurité, côté nœud — Betterleaks et osv-scanner sur ce que la
// production AJOUTE, rapportés avec le résultat.
//
// Les DÉCISIONS vivent dans `shared/porte-securite.ts` (pur, testé seul) ; ce
// fichier fait les gestes impurs : écrire le miroir, lancer, relire. Il ne
// lève JAMAIS : une porte qui plante ne doit pas emporter la production —
// elle devient `non_verifie`, raison à l'appui, et le résultat part quand même.
//
// ─── QUAND, ET SUR QUOI ──────────────────────────────────────────────────────
//
// AVANT les validations du bac, sur l'arbre tel que l'agent l'a laissé — celui
// dont le diff vient d'être calculé. Après, ce serait juger autre chose : les
// validations exécutent les tests du dépôt, que l'agent a pu écrire, et un
// test qui réécrirait `package-lock.json` au passage ferait lire à la porte un
// lockfile assaini pendant que le diff, lui, livrerait le vulnérable.
//
// Les secrets se cherchent dans les LIGNES AJOUTÉES du diff brut — celles que
// `Caviardeur.diff` réécrirait, lues par le même lecteur (`lireDiff`) —, pas
// dans les fichiers : seul ce que la production apporte compte, et c'est le
// diff, pas le disque, qui part au hub.
//
// ─── OÙ, ET POURQUOI CE N'EST PAS UNE VALIDATION ─────────────────────────────
//
// Les outils tournent là où tournent les validations : dans le bac du nœud
// quand il en a un — l'image du bac les épingle (`docker/agents/Dockerfile`),
// bubblewrap monte ceux de l'hôte (`hive doctor` les cherche). Sans bac, ils
// tournent sur l'hôte, et c'est la différence avec les validations : celles-ci
// exécutent le code de l'agent (`npm run`), la porte n'exécute RIEN de la
// production — deux binaires épinglés qui LISENT un miroir que Hive a écrit,
// configurés par drapeaux plutôt que par ce qu'ils trouveraient dans le dépôt.
//
// ─── LE MIROIR, ET CE QU'IL DÉSAMORCE ────────────────────────────────────────
//
// Un dossier neuf dans la tâche (le seul que le bac monte), retiré à la fin :
//   · `secrets/<k>/<nom>` : les lignes ajoutées du k-ième fichier, à LEUR
//     numéro (les autres lignes vides) — un constat de l'outil s'y lit à la
//     ligne du fichier livré ;
//   · `dependances/{base,tete}/<k>/<lockfile>` : chaque lockfile touché, au
//     commit de base (lu par le registre, `fichierDeBase`) et tel que livré ;
//   · `regles/` : la configuration que la porte IMPOSE.
// Mesuré sur Betterleaks 1.9.0 : sans `--config`, un `.betterleaks.toml` à la
// racine scannée REMPLACE les règles ; sans `--gitleaks-ignore-path`, un
// `.gitleaksignore` du répertoire courant — celui de la tâche, que l'agent
// écrit — efface un constat par son empreinte ; sans `--ignore-gitleaks-allow`,
// un commentaire `gitleaks:allow` sur la ligne suffit. Les trois sont fermés.

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { lireDiff } from '../shared/caviardage.js';
import type { Caviardeur, FichierDuDiff, LigneAjoutee } from '../shared/caviardage.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import {
  BORNES_PORTE,
  LOCKFILES_SURVEILLES,
  REGLE_CAVIARDAGE_HIVE,
  lireRapportBetterleaks,
  lireRapportOsv,
  nomDansLeMiroir,
  nomDeFichier,
  texteAffichable,
  valeurDuSecret,
  versionDeSortie,
  voletAvec,
  voletSans,
  vulnerabilitesIntroduites,
} from '../shared/porte-securite.js';
import type {
  ConstatDependance,
  ConstatSecret,
  OutilPorte,
  PorteSecurite,
  PositionSecret,
  RaisonPorte,
  SourceLue,
  Volet,
} from '../shared/porte-securite.js';
import { surLePath, type BacExecution } from './isolement.js';
import { runProc } from './merge-runner.js';
import { fichierDeBase } from './validations-bac.js';
import { buildSandboxEnv } from './workspace.js';

/** Le délai de chaque analyse : un outil qui lit des fichiers, pas une suite de tests. */
export const DELAI_PORTE_MS = 2 * 60_000;
/** `<outil> --version` : un conteneur froid peut mettre quelques secondes à démarrer. */
const DELAI_SONDE_MS = 60_000;
/** Au-delà, un lockfile ou un rapport n'est pas lu : la porte le dit. */
const LECTURE_MAX_OCTETS = 64 * 1024 * 1024;

export interface OptionsPorte {
  /** Répertoire de la tâche, tel que l'agent l'a laissé. */
  cwd: string;
  /** Le diff BRUT de la production — avant tout caviardage. */
  diff: string;
  /** Le dépôt épinglé et son commit de base (`Workspace`) ; `null` sans dépôt. */
  depot: { depot: DepotEpingle; baseSha: string } | null;
  /** Le bac du nœud ; absent, les outils tournent sur l'hôte (voir l'en-tête). */
  bac?: BacExecution;
  signal?: AbortSignal;
  /** Une ligne de progrès, relayée au hub : des comptes et des états, jamais une valeur. */
  surEtape?: (ligne: string) => void;
  /** Le caviardeur du nœud AVANT la porte : ce qu'il réécrirait en silence devient un constat. */
  caviardeur: Caviardeur;
}

export interface PassagePorte {
  rapport: PorteSecurite;
  /**
   * Les VALEURS des secrets trouvés, relues dans le diff : à caviarder partout
   * où elles partiraient au hub — jamais à envoyer.
   */
  valeurs: string[];
}

/** Lance un outil de la porte avec ses arguments — résolu par `lanceur`, jamais par son appelant. */
type Lancer = (
  outil: OutilPorte,
  args: readonly string[],
  delaiMs: number,
) => ReturnType<typeof runProc>;

/** Fait passer la porte à une production. Ne lève jamais. */
export async function passerLaPorte(opts: OptionsPorte): Promise<PassagePorte> {
  const lu = lireDiff(opts.diff);
  const valeurs: string[] = [];
  // Créé au premier besoin : une production qui n'ajoute rien et ne touche
  // aucun lockfile ne lance aucun outil et n'écrit rien.
  const miroir: { chemin: string | null } = { chemin: null };
  const dossier = (): string => (miroir.chemin ??= creerMiroir(opts.cwd));
  const lancer = lanceur(opts.cwd, buildSandboxEnv(opts.cwd), opts.bac, opts.signal);
  try {
    const secrets = await voletSecrets(lu.ajoutees, opts, dossier, lancer, valeurs);
    const dependances = await voletDependances(lu.fichiers, opts, dossier, lancer);
    return { rapport: { secrets, dependances }, valeurs };
  } finally {
    if (miroir.chemin !== null) {
      try {
        rmSync(miroir.chemin, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // Fichier verrouillé (Windows) : le nettoyage de la tâche l'emportera.
      }
    }
  }
}

function creerMiroir(cwd: string): string {
  const miroir = mkdtempSync(path.join(cwd, '.hive-porte-'));
  mkdirSync(path.join(miroir, 'regles'));
  // Les règles PAR DÉFAUT de l'outil, nommées — voir l'en-tête.
  writeFileSync(path.join(miroir, 'regles', 'betterleaks.toml'), '[extend]\nuseDefault = true\n');
  // Vide : aucun avis ignoré, quoi que dise un `osv-scanner.toml` du dépôt.
  writeFileSync(path.join(miroir, 'regles', 'osv-scanner.toml'), '');
  return miroir;
}

/**
 * Le lancement des outils : celui des validations (`runProc`, dans le bac
 * s'il y en a un, l'arbre entier tué au délai), sans aucune variable de
 * l'agent — ni relayée dans le bac, ni présente sur l'hôte.
 *
 * ─── L'OUTIL, PAR SON CHEMIN ABSOLU ──────────────────────────────────────────
 *
 * Sur l'hôte et sous bubblewrap, chaque outil est résolu UNE fois dans le PATH
 * de l'hôte (`surLePath` : entrées relatives écartées), puis lancé par son
 * chemin. Lancé par son NOM depuis le répertoire de la tâche, il était cherché
 * par `execvp` jusque dans une entrée vide du PATH (`PATH=/usr/bin:/bin:`) ou
 * `.` — la tâche elle-même, où l'agent pouvait poser un `betterleaks` à lui :
 * exécuté hors du bac, et libre de répondre « rien trouvé ». Dans un
 * conteneur, l'outil est celui de l'IMAGE : son nom s'y résout par le PATH que
 * l'image déclare, pas par celui de l'hôte.
 */
function lanceur(
  cwd: string,
  env: NodeJS.ProcessEnv,
  bac?: BacExecution,
  signal?: AbortSignal,
): Lancer {
  const dansLImage = bac !== undefined && bac.fournisseur.bin !== 'bwrap';
  const chemins = new Map<OutilPorte, string | null>();
  return (outil, args, delaiMs) => {
    if (!chemins.has(outil)) chemins.set(outil, dansLImage ? outil : surLePath(outil, env.PATH));
    const bin = chemins.get(outil);
    if (!bin) {
      const introuvable: Awaited<ReturnType<Lancer>> = {
        code: null,
        output: `[hive] ${outil} : introuvable dans le PATH de l’hôte`,
        arret: 'lancement',
      };
      return Promise.resolve(introuvable);
    }
    return runProc(
      [bin, ...args],
      cwd,
      env,
      delaiMs,
      signal,
      bac ? { ...bac, variables: [] } : undefined,
    );
  };
}

/**
 * L'outil répond-il, et en quelle version ? Un outil qui ne dit pas sa version
 * n'est pas celui qu'on croit lancer : `outil_absent`, comme un binaire
 * introuvable — sous bubblewrap, un `execvp` raté rend 1, pas 127.
 */
async function sonder(
  outil: OutilPorte,
  lancer: Lancer,
  delaiMs = DELAI_SONDE_MS,
): Promise<{ nom: OutilPorte; version: string } | { raison: 'annule' | 'delai' | 'outil_absent' }> {
  const r = await lancer(outil, ['--version'], delaiMs);
  if (r.arret === 'annule' || r.arret === 'delai') return { raison: r.arret };
  const version = r.code === 0 ? versionDeSortie(r.output) : null;
  return version ? { nom: outil, version } : { raison: 'outil_absent' };
}

/**
 * La version que la porte TROUVERAIT sur cet hôte (`hive doctor`), ou `null`.
 *
 * Pas une sonde à côté : celle de la porte (`sonder`), par son lanceur —
 * même résolution dans le PATH, même `runProc`, donc même refus sous Windows
 * (`shared/lanceur.ts`). Le docteur disait « ok » d'un outil que son propre
 * `execFile` trouvait, pendant que la porte, elle, le voyait absent. Son
 * environnement : le PATH et ce qu'exige Windows, aucun secret du nœud.
 */
export async function versionPourLaPorte(
  outil: OutilPorte,
  delaiMs = 4_000,
): Promise<string | null> {
  const env: NodeJS.ProcessEnv = {};
  for (const nom of ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE']) {
    if (process.env[nom] !== undefined) env[nom] = process.env[nom];
  }
  const r = await sonder(outil, lanceur(process.cwd(), env), delaiMs);
  return 'raison' in r ? null : r.version;
}

/** Un rapport écrit par un outil dans le miroir, relu sans suivre de lien. */
function lireRapport<T>(fichier: string, lire: (texte: string) => T | null): T | null {
  try {
    const etat = lstatSync(fichier);
    if (!etat.isFile() || etat.size > LECTURE_MAX_OCTETS) return null;
    return lire(readFileSync(fichier, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Un fichier de la tâche, tel que livré — `null` s'il n'est pas un fichier
 * ordinaire DANS la tâche : un lien (vers `/etc/shadow`), un dossier-lien qui
 * sort de l'arbre. Le chemin vient du diff, donc de l'agent.
 */
function lireDansLaTache(cwd: string, chemin: string): string | null {
  try {
    const racine = realpathSync(cwd);
    const cible = path.resolve(racine, ...chemin.split('/'));
    if (!lstatSync(cible).isFile()) return null;
    const reel = realpathSync(cible);
    if (!reel.startsWith(racine + path.sep)) return null;
    if (lstatSync(reel).size > LECTURE_MAX_OCTETS) return null;
    return readFileSync(reel, 'utf8');
  } catch {
    return null;
  }
}

// ─── Les secrets ─────────────────────────────────────────────────────────────

/**
 * Ce qu'il faut caviarder pour une correspondance : sa valeur, relue aux
 * colonnes (`valeurDuSecret`) — ou, si les colonnes ne se relisent pas, ses
 * LIGNES ENTIÈRES. Un caviardage de trop, jamais une clé qui part.
 */
function valeursAuxColonnes(lignes: ReadonlyMap<number, string>, p: PositionSecret): string[] {
  const valeur = valeurDuSecret(lignes, p);
  if (valeur !== null) return [valeur];
  const entieres: string[] = [];
  for (let n = p.debutLigne; n <= p.finLigne; n++) {
    const ligne = lignes.get(n)?.trim();
    if (ligne) entieres.push(ligne);
  }
  return entieres;
}

async function voletSecrets(
  ajoutees: readonly LigneAjoutee[],
  opts: OptionsPorte,
  dossier: () => string,
  lancer: Lancer,
  valeurs: string[],
): Promise<Volet<ConstatSecret>> {
  if (ajoutees.length === 0) return voletSans('aucun_ajout');
  const nomme = (fichier: string | null): string =>
    texteAffichable(opts.caviardeur.texte(fichier ?? ''), BORNES_PORTE.fichier) || '(sans nom)';
  // CE QUE LE NŒUD RÉÉCRIVAIT EN SILENCE devient un constat : un jeton que
  // Hive reconnaît (`ghp_…`, `sk-…`), ou la valeur d'un identifiant transmis à
  // l'agent. Il ne demande aucun outil : il compte même sans Betterleaks.
  const hive: ConstatSecret[] = ajoutees
    .filter((a) => opts.caviardeur.code(a.texte) !== a.texte)
    .map((a) => ({ regle: REGLE_CAVIARDAGE_HIVE, fichier: nomme(a.fichier), ligne: a.numero }));
  const sans = (
    raison: Exclude<RaisonPorte, 'trouve'>,
    outil?: { nom: OutilPorte; version: string },
  ) => (hive.length > 0 ? voletAvec(hive) : voletSans<ConstatSecret>(raison, outil));
  try {
    const sonde = await sonder('betterleaks', lancer);
    if ('raison' in sonde) return sans(sonde.raison);

    // Le miroir : un fichier par fichier du diff, chaque ligne à son numéro.
    const parFichier = new Map<string | null, number>();
    const lignes: Map<number, string>[] = [];
    const noms: (string | null)[] = [];
    for (const a of ajoutees) {
      let k = parFichier.get(a.fichier);
      if (k === undefined) {
        k = lignes.length;
        parFichier.set(a.fichier, k);
        lignes.push(new Map());
        noms.push(a.fichier);
      }
      lignes[k]?.set(a.numero, a.texte);
    }
    const racine = dossier();
    for (const [k, carte] of lignes.entries()) {
      let derniere = 0;
      for (const n of carte.keys()) derniere = Math.max(derniere, n);
      const texte = Array.from({ length: derniere }, (_, i) => carte.get(i + 1) ?? '').join('\n');
      const ou = path.join(racine, 'secrets', String(k));
      mkdirSync(ou, { recursive: true });
      writeFileSync(path.join(ou, nomDansLeMiroir(noms[k] ?? '')), `${texte}\n`);
    }

    opts.surEtape?.(
      `porte de sécurité : betterleaks ${sonde.version} sur ${ajoutees.length} ligne(s) ajoutée(s)…`,
    );
    // Relatifs à la tâche, en `/` : valables sur l'hôte comme dans le bac.
    const rel = path.basename(racine);
    const r = await lancer(
      'betterleaks',
      [
        'dir',
        `${rel}/secrets`,
        '--config',
        `${rel}/regles/betterleaks.toml`,
        '--gitleaks-ignore-path',
        `${rel}/regles`,
        '--ignore-gitleaks-allow',
        // La valeur ne sort jamais de l'outil : son rapport est écrit dans la
        // tâche. Le nœud la relit dans SA copie du diff (`valeurDuSecret`).
        '--redact',
        // Le miroir n'est que du texte : aucune archive à ouvrir.
        '--max-archive-depth',
        '0',
        '--no-banner',
        '--no-color',
        '--log-level',
        'error',
        '--report-format',
        'json',
        '--report-path',
        `${rel}/secrets.json`,
        '--exit-code',
        '1',
      ],
      DELAI_PORTE_MS,
    );
    if (r.arret) return sans(r.arret === 'lancement' ? 'outil_absent' : r.arret, sonde);
    const trouvailles = lireRapport(path.join(racine, 'secrets.json'), lireRapportBetterleaks);
    // Le CODE décide, le rapport détaille : 0 sans rien, 1 avec quelque chose.
    // Un désaccord entre les deux (configuration refusée, rapport tronqué)
    // n'est pas un « rien trouvé ».
    if (trouvailles === null || (r.code !== 0 && r.code !== 1)) {
      return sans('outil_en_echec', sonde);
    }
    if ((r.code === 1) !== trouvailles.length > 0) return sans('outil_en_echec', sonde);

    const constats: ConstatSecret[] = [];
    const vues = new Set<string>();
    const ajouter = (c: ConstatSecret): void => {
      const cle = `${c.regle}\u0000${c.fichier}\u0000${c.ligne}`;
      if (vues.has(cle)) return;
      vues.add(cle);
      constats.push(c);
    };
    for (const t of trouvailles) {
      const k = /(?:^|[\\/])secrets[\\/](\d+)[\\/][^\\/]+$/.exec(t.fichier)?.[1];
      const carte = k === undefined ? undefined : lignes[Number(k)];
      // Un fichier que la porte n'a pas écrit : l'outil n'a pas lu le miroir.
      if (k === undefined || !carte) return sans('outil_en_echec', sonde);
      const fichier = nomme(noms[Number(k)] ?? null);
      // Le constat ET ses composants : la clé secrète d'une paire AWS est un
      // composant, sur sa propre ligne (voir `TrouvailleSecret`).
      for (const p of [t, ...t.composants]) {
        valeurs.push(...valeursAuxColonnes(carte, p));
        ajouter({ regle: p.regle, fichier, ligne: p.debutLigne });
      }
    }
    // Un jeton que Betterleaks a déjà nommé, à la même ligne, n'est pas compté deux fois.
    const lignesVues = new Set(constats.map((c) => `${c.fichier}\u0000${c.ligne}`));
    for (const c of hive) if (!lignesVues.has(`${c.fichier}\u0000${c.ligne}`)) ajouter(c);
    return constats.length > 0 ? voletAvec(constats, sonde) : voletSans('analyse_propre', sonde);
  } catch {
    return sans('interrompue');
  }
}

// ─── Les dépendances ─────────────────────────────────────────────────────────

const estLockfile = (chemin: string | null): chemin is string =>
  chemin !== null && LOCKFILES_SURVEILLES.has(nomDeFichier(chemin));

async function voletDependances(
  fichiers: readonly FichierDuDiff[],
  opts: OptionsPorte,
  dossier: () => string,
  lancer: Lancer,
): Promise<Volet<ConstatDependance>> {
  const touches = fichiers.filter((f) => estLockfile(f.avant) || estLockfile(f.apres));
  if (touches.length === 0) return voletSans('aucun_lockfile');
  try {
    const { depot } = opts;
    if (!depot && touches.some((f) => estLockfile(f.avant))) return voletSans('sans_base');
    // Tout se LIT avant de lancer quoi que ce soit : un lockfile illisible ne
    // coûte pas un conteneur.
    const lus: { k: number; role: 'base' | 'tete'; chemin: string; contenu: string }[] = [];
    for (const [k, f] of touches.entries()) {
      if (estLockfile(f.avant) && depot) {
        const contenu = await fichierDeBase(depot.depot, depot.baseSha, f.avant);
        if (contenu === null) return voletSans('lockfile_illisible');
        lus.push({ k, role: 'base', chemin: f.avant, contenu });
      }
      if (estLockfile(f.apres)) {
        const contenu = lireDansLaTache(opts.cwd, f.apres);
        if (contenu === null) return voletSans('lockfile_illisible');
        lus.push({ k, role: 'tete', chemin: f.apres, contenu });
      }
    }
    const sonde = await sonder('osv-scanner', lancer);
    if ('raison' in sonde) return voletSans(sonde.raison);

    const racine = dossier();
    const rel = path.basename(racine);
    const lockfiles: string[] = [];
    for (const l of lus) {
      const ou = path.join(racine, 'dependances', l.role, String(l.k));
      mkdirSync(ou, { recursive: true });
      // Le NOM du lockfile, tel quel : c'est lui qui dit à osv-scanner comment le lire.
      writeFileSync(path.join(ou, nomDeFichier(l.chemin)), l.contenu);
      lockfiles.push('-L', `${rel}/dependances/${l.role}/${l.k}/${nomDeFichier(l.chemin)}`);
    }
    opts.surEtape?.(
      `porte de sécurité : osv-scanner ${sonde.version} sur ${touches.length} lockfile(s), ` +
        'base et tête — interroge osv.dev…',
    );
    const r = await lancer(
      'osv-scanner',
      [
        'scan',
        'source',
        ...lockfiles,
        '--format',
        'json',
        '--output-file',
        `${rel}/dependances.json`,
        '--config',
        `${rel}/regles/osv-scanner.toml`,
        // Ni résolution transitive (deps.dev, Maven Central), ni analyse
        // d'appels (qui lancerait des scripts de build) : osv.dev seul.
        '--no-resolve',
        '--no-call-analysis=all',
        '--allow-no-lockfiles',
        '--verbosity',
        'error',
      ],
      DELAI_PORTE_MS,
    );
    if (r.arret) {
      return r.arret === 'lancement' ? voletSans('outil_absent') : voletSans(r.arret, sonde);
    }
    // MESURÉ : osv.dev injoignable, l'outil sort en 127 avec un rapport VIDE
    // et valide. Seuls 0 (rien de vulnérable) et 1 (du vulnérable) jugent.
    if (r.code !== 0 && r.code !== 1) return voletSans('outil_en_echec', sonde);
    const sources = lireRapport(path.join(racine, 'dependances.json'), lireRapportOsv);
    if (sources === null) return voletSans('outil_en_echec', sonde);
    const vulnerable = sources.some((s) => s.paquets.some((p) => p.vulnerabilites.length > 0));
    if ((r.code === 1) !== vulnerable) return voletSans('outil_en_echec', sonde);

    const base: SourceLue[] = [];
    const tete: { fichier: string; source: SourceLue }[] = [];
    for (const source of sources) {
      const m = /[\\/]dependances[\\/](base|tete)[\\/](\d+)[\\/][^\\/]+$/.exec(source.chemin);
      const lu = m && lus.find((l) => l.role === m[1] && l.k === Number(m[2]));
      if (!lu) return voletSans('outil_en_echec', sonde);
      if (lu.role === 'base') base.push(source);
      else tete.push({ fichier: opts.caviardeur.texte(lu.chemin), source });
    }
    const introduites = vulnerabilitesIntroduites(base, tete);
    return introduites.length > 0
      ? voletAvec(introduites, sonde)
      : voletSans('analyse_propre', sonde);
  } catch {
    return voletSans('interrompue');
  }
}
