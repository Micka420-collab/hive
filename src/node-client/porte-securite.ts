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
// Sur TOUT résultat porteur d'un diff, réussi ou en échec, et AVANT les
// validations du bac, sur l'arbre tel que l'agent l'a laissé — celui dont le
// diff vient d'être calculé. Après, ce serait juger autre chose : les
// validations exécutent les tests du dépôt, que l'agent a pu écrire, et un
// test qui réécrirait `package-lock.json` au passage ferait lire à la porte un
// lockfile assaini pendant que le diff, lui, livrerait le vulnérable.
//
// Les secrets se cherchent dans les LIGNES AJOUTÉES du diff brut — celles que
// `Caviardeur.diff` réécrirait, lues par le même lecteur (`lireDiff`) —, pas
// dans les fichiers : seul ce que la production apporte compte, et c'est le
// diff, pas le disque, qui part au hub. Les dépendances, elles, se lisent dans
// l'arbre : pour une production réussie dont le diff est celui de l'arbre.
//
// ─── OÙ, ET POURQUOI CE N'EST PAS UNE VALIDATION ─────────────────────────────
//
// Les outils tournent là où tournent les validations : dans le bac du nœud
// quand il en a un — l'image du bac les épingle (`docker/agents/Dockerfile`),
// bubblewrap monte ceux de l'hôte. Sans bac, ils tournent sur l'hôte, et c'est
// la différence avec les validations : celles-ci exécutent le code de l'agent
// (`npm run`), la porte n'exécute RIEN de la production — deux binaires
// épinglés, résolus par leur chemin absolu (`lanceur`), qui LISENT un miroir
// que Hive a écrit, configurés par drapeaux plutôt que par ce qu'ils
// trouveraient dans le dépôt. `hive doctor` les éprouve par le même chemin.
//
// ─── SON RÉSEAU, PAS CELUI DE LA TÂCHE ───────────────────────────────────────
//
// Dans un bac qui filtre (G03), la porte n'emprunte pas le réseau de la tâche :
// sa liste blanche ne connaît pas osv.dev (chaque interrogation y mourait en
// « injoignable »), et ses refus y entraient au bilan de la tâche, imputés au
// producteur. Betterleaks et l'extraction tournent réseau COUPÉ — ils n'ont
// rien à joindre ; l'interrogation passe par une session à elle, qui ne joint
// qu'api.osv.dev:443 (`ouvrirReseauPorte`), et ses refus ne vont qu'au nœud.
//
// ─── LE MIROIR, ET CE QU'IL DÉSAMORCE ────────────────────────────────────────
//
// Un dossier neuf dans la tâche (le seul que le bac monte), retiré à la fin :
//   · `secrets/<k>/<nom>` : les lignes ajoutées du k-ième fichier, à LEUR
//     numéro (les autres lignes vides) — un constat de l'outil s'y lit à la
//     ligne du fichier livré ;
//   · `dependances/{base,tete}/<k>/<lockfile>` : chaque lockfile touché, au
//     commit de base (lu par le registre, `fichierDeBase`) et tel que livré ;
//     `extractions/` : ce qu'osv-scanner en a extrait, hors ligne ;
//   · `sboms/{base,tete}/<k>/bom.cdx.json` : les SEULS paquets qui partent à
//     osv.dev (`shared/porte-securite-dependances.ts`) ;
//   · `regles/` : la configuration que la porte IMPOSE (Betterleaks : règles
//     par défaut, confiance haute, sans préfiltre).
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
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { formesDuSecret, lireDiff } from '../shared/caviardage.js';
import { effacerDossier } from '../shared/effacement.js';
import type { Caviardeur, FichierDuDiff, LigneAjoutee } from '../shared/caviardage.js';
import { gitHote } from '../shared/git-protege.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import {
  BORNES_PORTE,
  CONFIANCE_BETTERLEAKS,
  CONFIG_BETTERLEAKS,
  REGLE_CAVIARDAGE_HIVE,
  formeCaviardable,
  lireRapportBetterleaks,
  lireRapportOsv,
  nomDansLeMiroir,
  texteAffichable,
  valeurDuSecret,
  versionDeSortie,
  voletAvec,
  voletSans,
  vulnerabilitesIntroduites,
} from '../shared/porte-securite.js';
import {
  LOCKFILE_MAL_FORME,
  aInterroger,
  estFichierDeDependances,
  lireExtraction,
  nomDeFichier,
  paquetsPublics,
  sbomDe,
  type PaquetExtrait,
} from '../shared/porte-securite-dependances.js';
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
import { surLePath, VARIABLES_PROXY, type BacExecution, type ReseauBac } from './isolement.js';
import { runProc } from './merge-runner.js';
import type { RefusReseau } from './proxy-egress.js';
import type { ReservationPont } from './rendez-vous-pont.js';
import { HOTE_OSV, ouvrirReseauPorte } from './reseau-tache.js';
import { BaseFalsifiee } from './base-verifiee.js';
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
  /**
   * Le volet dépendances LIT L'ARBRE de la tâche (ses lockfiles d'après) : il
   * ne juge qu'une production RÉUSSIE dont le diff est celui de cet arbre.
   * Sinon il n'est pas examiné, et sa raison le dit (`production_en_echec`,
   * `diff_hors_arbre`). Le volet secrets, lui, lit le diff qui part au hub,
   * quel qu'il soit — il n'exécute rien. Défaut : `examiner`.
   */
  dependances?: 'examiner' | 'production_en_echec' | 'diff_hors_arbre';
  /**
   * Le réseau de LA PORTE, sur un nœud dont le bac filtre — jamais celui de la
   * tâche (voir l'en-tête) : les passes hors ligne réseau coupé, l'interrogation
   * par une session ouverte pour elle (`ouvrirReseauPorte`, api.osv.dev:443) et
   * refermée aussitôt ; ses refus ne vont qu'à `surRefus`. Absent (pas de bac,
   * ou un bac qui ne filtre pas) : le réseau de l'hôte, et l'interrogation
   * reçoit son proxy standard.
   */
  reseau?: { reservation: ReservationPont; surRefus?: (refus: RefusReseau) => void };
}

export interface PassagePorte {
  rapport: PorteSecurite;
  /**
   * Les secrets trouvés, relus dans le diff, sous les seules formes que le
   * nœud peut caviarder partout où elles partiraient au hub sans toucher une
   * ligne légitime (`formeCaviardable`) — jamais à envoyer.
   */
  valeurs: string[];
}

/**
 * Lance un outil de la porte avec ses arguments — résolu par `lanceur`, jamais
 * par son appelant. `sortie` : l'interrogation d'osv.dev, la seule qui sorte —
 * par la session de la porte (`ReseauBac`), ou par le proxy standard de l'hôte
 * (`'hote'`) sur un nœud qui ne filtre pas.
 */
type Lancer = (
  outil: OutilPorte,
  args: readonly string[],
  delaiMs: number,
  sortie?: ReseauBac | 'hote',
) => ReturnType<typeof runProc>;

/** Fait passer la porte à une production. Ne lève jamais. */
export async function passerLaPorte(opts: OptionsPorte): Promise<PassagePorte> {
  const lu = lireDiff(opts.diff);
  const valeurs: string[] = [];
  // Créé au premier besoin : une production qui n'ajoute rien et ne touche
  // aucun lockfile ne lance aucun outil et n'écrit rien.
  const miroir: { chemin: string | null } = { chemin: null };
  const dossier = (): string => (miroir.chemin ??= creerMiroir(opts.cwd));
  const lancer = lanceur(
    opts.cwd,
    buildSandboxEnv(opts.cwd),
    opts.bac,
    opts.signal,
    opts.reseau !== undefined,
  );
  try {
    const secrets = await voletSecrets(lu.ajoutees, opts, dossier, lancer, valeurs);
    const examen = opts.dependances ?? 'examiner';
    const dependances =
      examen === 'examiner'
        ? await voletDependances(lu.fichiers, opts, dossier, lancer)
        : voletSans<ConstatDependance>(examen);
    return { rapport: { secrets, dependances }, valeurs };
  } finally {
    // Par la porte unique (`effacerDossier`). Un fichier encore verrouillé
    // (Windows) au bout de ses reprises : le nettoyage de la tâche l'emportera.
    if (miroir.chemin !== null) await effacerDossier(miroir.chemin).catch(() => undefined);
  }
}

function creerMiroir(cwd: string): string {
  const miroir = mkdtempSync(path.join(cwd, '.hive-porte-'));
  mkdirSync(path.join(miroir, 'regles'));
  // Les règles PAR DÉFAUT de l'outil, nommées, sans leur préfiltre — voir
  // l'en-tête et `CONFIG_BETTERLEAKS`.
  writeFileSync(path.join(miroir, 'regles', 'betterleaks.toml'), CONFIG_BETTERLEAKS);
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
  /** Le bac filtre : ce qui ne sort pas tourne réseau COUPÉ. */
  coupe = false,
): Lancer {
  const dansLImage = bac !== undefined && bac.fournisseur.bin !== 'bwrap';
  // Le réseau d'une TÂCHE n'est jamais celui de la porte : chaque lancement
  // dit le sien, ci-dessous.
  const bacDeLaPorte = bac && { ...bac, reseau: undefined };
  const chemins = new Map<OutilPorte, string | null>();
  // Le proxy sortant de l'hôte, s'il en a un : à l'interrogation d'osv.dev
  // seulement — ni à Betterleaks, ni à l'extraction, qui ne sortent pas. Dans
  // un conteneur, par leur NOM (`--env`), comme toute variable du bac.
  const proxy: NodeJS.ProcessEnv = {};
  for (const nom of VARIABLES_PROXY) {
    if (process.env[nom] !== undefined) proxy[nom] = process.env[nom];
  }
  return (outil, args, delaiMs, sortie) => {
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
    const viaHote = sortie === 'hote';
    // Hors ligne : coupé quand le bac filtre. L'interrogation : la session de
    // la porte, ou le proxy de l'hôte — par son NOM (`--env`), comme toute
    // variable du bac.
    const reseau =
      sortie === undefined ? { reseauCoupe: coupe } : viaHote ? {} : { reseau: sortie };
    return runProc(
      [bin, ...args],
      cwd,
      viaHote ? { ...env, ...proxy } : env,
      delaiMs,
      signal,
      bacDeLaPorte
        ? { ...bacDeLaPorte, ...reseau, variables: viaHote ? Object.keys(proxy) : [] }
        : undefined,
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

export interface JoignabiliteOsv {
  joignable: boolean;
  /** Le proxy éprouvé, `hôte:port` sans identifiants ; `null` : en direct. */
  proxy: string | null;
}

/** L'hôte que l'interrogation joint — et le seul que `joindreOsv` éprouve. */
const OSV = { hote: HOTE_OSV, port: 443 };

/** Le proxy qu'osv-scanner (Go, `http.ProxyFromEnvironment`) prendrait pour `hote`, ou `null`. */
function proxyPour(hote: string, env: NodeJS.ProcessEnv): URL | null {
  const brut = env.HTTPS_PROXY ?? env.https_proxy;
  if (!brut) return null;
  const exclus = (env.NO_PROXY ?? env.no_proxy ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  if (exclus.some((e) => e === '*' || hote === e || hote.endsWith(`.${e}`))) return null;
  try {
    return new URL(brut.includes('://') ? brut : `http://${brut}`);
  } catch {
    return null;
  }
}

/**
 * api.osv.dev est-il joignable d'ici, par le chemin qu'osv-scanner prendrait —
 * le proxy standard que la porte lui transmet, sinon en direct (`hive
 * doctor`) ? Une CONNEXION, rien d'autre : un `CONNECT` au proxy, ou une
 * connexion TCP directe, aussitôt refermés — aucune requête, aucun paquet,
 * aucune donnée de la ruche. Borné : `delaiMs`.
 */
export function joindreOsv(
  env: NodeJS.ProcessEnv = process.env,
  delaiMs = 3_000,
  cible: { hote: string; port: number } = OSV,
): Promise<JoignabiliteOsv> {
  const proxy = proxyPour(cible.hote, env);
  const dit = proxy
    ? `${proxy.hostname}:${proxy.port || (proxy.protocol === 'https:' ? 443 : 80)}`
    : null;
  return new Promise((resolve) => {
    let fini = false;
    const finir = (joignable: boolean, fermer: () => void): void => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      fermer();
      resolve({ joignable, proxy: dit });
    };
    let fermer: () => void = () => {};
    const minuteur = setTimeout(() => finir(false, fermer), delaiMs);
    minuteur.unref?.();
    try {
      if (!proxy) {
        const socket = net.connect({ host: cible.hote, port: cible.port });
        fermer = () => socket.destroy();
        socket.once('connect', () => finir(true, fermer));
        socket.once('error', () => finir(false, fermer));
        return;
      }
      const identifiants = proxy.username
        ? {
            'proxy-authorization': `Basic ${Buffer.from(
              `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
            ).toString('base64')}`,
          }
        : {};
      const requete = (proxy.protocol === 'https:' ? https : http).request({
        host: proxy.hostname,
        port: Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80),
        method: 'CONNECT',
        path: `${cible.hote}:${cible.port}`,
        headers: { host: `${cible.hote}:${cible.port}`, ...identifiants },
      });
      fermer = () => requete.destroy();
      requete.once('connect', (reponse, socket) => {
        socket.destroy();
        finir(reponse.statusCode === 200, fermer);
      });
      requete.once('response', () => finir(false, fermer));
      requete.once('error', () => finir(false, fermer));
      requete.end();
    } catch {
      finir(false, fermer);
    }
  });
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
 * Ce que le nœud caviardera d'une correspondance : les formes de sa VALEUR,
 * relue exactement aux colonnes (`valeurDuSecret`), qu'il peut réécrire
 * partout sans toucher une ligne légitime (`formeCaviardable`).
 *
 * La porte ne réécrit JAMAIS du code sur la seule foi d'un constat : une
 * valeur qui ne se relit pas n'est plus remplacée par ses lignes entières —
 * elles partaient en `[secret]` dans chaque ligne identique du diff, des logs
 * et du texte final. Le constat, lui, reste, et demande la correction.
 */
function formesACaviarder(lignes: ReadonlyMap<number, string>, p: PositionSecret): string[] {
  const valeur = valeurDuSecret(lignes, p);
  return valeur === null ? [] : formesDuSecret(valeur).filter(formeCaviardable);
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
        // Les règles génériques (mots de passe, URL à identifiants) lisaient
        // du code sain comme des secrets : voir `CONFIANCE_BETTERLEAKS`.
        '--confidence',
        CONFIANCE_BETTERLEAKS,
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
    // Chaque trouvaille dans un fichier que la porte a écrit, et de la seule
    // confiance demandée — sinon l'outil n'a pas lu le miroir, ou pas avec la
    // configuration imposée : rien de son rapport n'est cru, rien n'est caviardé.
    const situees = trouvailles.map((t) => {
      const k = /(?:^|[\\/])secrets[\\/](\d+)[\\/][^\\/]+$/.exec(t.fichier)?.[1];
      const carte = k === undefined ? undefined : lignes[Number(k)];
      return carte && t.confiance === CONFIANCE_BETTERLEAKS ? { t, k: Number(k), carte } : null;
    });
    if (situees.some((s) => s === null)) return sans('outil_en_echec', sonde);

    const constats: ConstatSecret[] = [];
    const vues = new Set<string>();
    const ajouter = (c: ConstatSecret): void => {
      const cle = `${c.regle}\u0000${c.fichier}\u0000${c.ligne}`;
      if (vues.has(cle)) return;
      vues.add(cle);
      constats.push(c);
    };
    for (const s of situees) {
      if (!s) continue;
      const fichier = nomme(noms[s.k] ?? null);
      // Le constat ET ses composants : la clé secrète d'une paire AWS est un
      // composant, sur sa propre ligne (voir `TrouvailleSecret`).
      for (const p of [s.t, ...s.t.composants]) {
        valeurs.push(...formesACaviarder(s.carte, p));
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

const estSurveille = (chemin: string | null): chemin is string =>
  chemin !== null && estFichierDeDependances(chemin);

/**
 * Les fichiers de dépendances de la TÊTE, énumérés depuis l'index du registre
 * (`ls-files`) — rempli par le `git add --all` du diff (`diffContreBase`) AVANT
 * la porte : il voit chaque fichier non ignoré de l'arbre, les nouveaux
 * compris, et JAMAIS un chemin ignoré (`node_modules`…). Non forgeable : l'agent
 * ne peut pas cacher un lockfile de l'index (un `.gitignore` qui l'exclurait
 * l'exclut aussi du diff livré et des validations — il n'est alors ni livré ni
 * jugé). C'est l'énumération que `git diff <baseSha>` ne peut pas tronquer par
 * une base forgée.
 */
async function cheminsDeDependancesTete(depot: DepotEpingle): Promise<string[]> {
  const sortie = await gitHote(['ls-files', '-z'], depot);
  return sortie.split('\0').filter((c) => c !== '' && estFichierDeDependances(c));
}

/** Une paire base/tête d'un fichier de dépendances touché, lue. */
interface Paire {
  k: number;
  /** Le nom du fichier d'après (d'avant s'il est supprimé), tel que le rapport le cite. */
  fichier: string;
  base: { chemin: string; contenu: string } | null;
  tete: { chemin: string; contenu: string };
}

/** Ce que la passe 1 dit d'un fichier : ses paquets, ou pourquoi elle n'en dit rien. */
type Extraction =
  { paquets: PaquetExtrait[] } | { mal_forme: true } | { raison: Exclude<RaisonPorte, 'trouve'> };

/** Le volet, avec son compte de paquets non interrogés quand il y en a. */
function avecNonInterroges(v: Volet<ConstatDependance>, n: number): Volet<ConstatDependance> {
  return n > 0 ? { ...v, nonInterroges: n } : v;
}

/**
 * Le volet dépendances, en deux passes (`shared/porte-securite-dependances.ts`
 * dit pourquoi) : chaque fichier touché, base et tête, extrait HORS LIGNE et un
 * par un — un fichier illisible n'aveugle plus les autres ; puis UNE
 * interrogation d'osv.dev, sur les SBOM que la porte a écrits.
 */
async function voletDependances(
  fichiers: readonly FichierDuDiff[],
  opts: OptionsPorte,
  dossier: () => string,
  lancer: Lancer,
): Promise<Volet<ConstatDependance>> {
  const touches = fichiers.filter((f) => estSurveille(f.avant) || estSurveille(f.apres));
  const { depot } = opts;
  // Sans dépôt, aucune base à vérifier : comportement d'avant, à la lettre.
  if (!depot) {
    if (touches.length === 0) return voletSans('aucun_lockfile');
    if (touches.some((f) => estSurveille(f.avant))) return voletSans('sans_base');
  }
  // AVEC dépôt, on ne s'arrête PAS à un diff vide : un lockfile de la tête que
  // la base forgée cache du diff se trouve par la réénumération vérifiée plus
  // bas (`cheminsDeDependancesTete`). L'« aucun lockfile » se décide à la fin,
  // quand rien — ni touché, ni caché — n'a été trouvé.
  try {
    // Les lockfiles que la production laisse illisibles d'abord : ce sont ses
    // défauts, et la borne du protocole ne doit pas les faire tomber.
    const illisibles: ConstatDependance[] = [];
    const nonVerifiables: Exclude<RaisonPorte, 'trouve'>[] = [];
    // Tout se LIT avant de lancer quoi que ce soit : un lockfile illisible ne
    // coûte pas un conteneur.
    const paires: Paire[] = [];
    for (const [k, f] of touches.entries()) {
      const fichier = texteAffichable(
        opts.caviardeur.texte(f.apres ?? f.avant ?? ''),
        BORNES_PORTE.fichier,
      );
      let base: Paire['base'] = null;
      if (estSurveille(f.avant) && depot) {
        let falsifiee = false;
        let contenu: string | null = null;
        try {
          contenu = await fichierDeBase(depot.depot, depot.baseSha, f.avant);
        } catch (err) {
          // La base relue est falsifiée : l'agent a forgé l'objet git du
          // lockfile de base pour faire passer une vulnérabilité qu'il
          // introduit pour « déjà présente » (`base-verifiee.ts`). On ne
          // compare pas à un contenu forgé — la base reste ABSENTE, donc tout
          // ce que la tête porte reste INTRODUIT —, et la falsification est un
          // constat bloquant, nommé et journalisé. La tête se lit normalement
          // ci-dessous : comparée à rien, elle n'excuse rien.
          if (!(err instanceof BaseFalsifiee)) throw err;
          illisibles.push({ genre: 'lockfile_illisible', fichier, motif: 'base_falsifiee' });
          falsifiee = true;
        }
        // Base illisible (absente, mal formée) SANS falsification : rien à quoi
        // comparer, le fichier est écarté — son constat `non_verifie` le dit.
        if (contenu === null && !falsifiee) {
          nonVerifiables.push('lockfile_illisible');
          continue;
        }
        base = contenu === null ? null : { chemin: f.avant, contenu };
      }
      // Un fichier supprimé n'introduit rien : rien à extraire.
      if (!estSurveille(f.apres)) continue;
      const contenu = lireDansLaTache(opts.cwd, f.apres);
      if (contenu === null) {
        illisibles.push({ genre: 'lockfile_illisible', fichier, motif: 'pas_un_fichier' });
        continue;
      }
      paires.push({ k, fichier, base, tete: { chemin: f.apres, contenu } });
    }
    // ─── AUCUN LOCKFILE DE LA TÊTE CACHÉ PAR UNE BASE FORGÉE ──────────────────
    //
    // `touches` vient du diff (`git diff <baseSha>`), qui lit l'objet de base
    // SANS vérifier son empreinte (git ne la vérifie jamais, mesuré 2.53) :
    // forger le lockfile de base pour qu'il soit IDENTIQUE au livré rend le diff
    // muet sur ce fichier — il sort des `touches`, la porte ne le lit jamais, et
    // la vulnérabilité passe `analyse_propre`. On RÉÉNUMÈRE donc les lockfiles de
    // la tête depuis l'index (`cheminsDeDependancesTete`, non forgeable), et pour
    // chacun que le diff n'a pas montré on relit la base par la porte VÉRIFIÉE :
    // forgée ⇒ constat `base_falsifiee` (jamais excusée) ; vraiment inchangée ⇒
    // rien à juger. L'énumération ne peut plus être aveuglée par une base forgée.
    if (depot) {
      const vusDuDiff = new Set(
        touches.flatMap((f) => [f.avant, f.apres]).filter((c): c is string => estSurveille(c)),
      );
      let kCache = touches.length;
      for (const chemin of await cheminsDeDependancesTete(depot.depot)) {
        if (vusDuDiff.has(chemin)) continue;
        const fichier = texteAffichable(opts.caviardeur.texte(chemin), BORNES_PORTE.fichier);
        let baseContenu: string | null;
        try {
          baseContenu = await fichierDeBase(depot.depot, depot.baseSha, chemin);
        } catch (err) {
          if (!(err instanceof BaseFalsifiee)) throw err;
          illisibles.push({ genre: 'lockfile_illisible', fichier, motif: 'base_falsifiee' });
          continue;
        }
        const teteContenu = lireDansLaTache(opts.cwd, chemin);
        // Lien/dossier (pas un fichier), ou base vraiment identique : rien à juger.
        if (teteContenu === null || baseContenu === teteContenu) continue;
        // Base vérifiée, non forgée, mais différente du livré et pourtant hors du
        // diff : anomalie — on la juge comme introduite, à part (jamais excusée).
        paires.push({
          k: kCache,
          fichier,
          base: baseContenu === null ? null : { chemin, contenu: baseContenu },
          tete: { chemin, contenu: teteContenu },
        });
        kCache += 1;
      }
    }
    const conclure = (
      constats: readonly ConstatDependance[],
      nonInterroges: number,
      outil?: { nom: OutilPorte; version: string },
      interroge = true,
    ): Volet<ConstatDependance> => {
      if (constats.length > 0) return avecNonInterroges(voletAvec(constats, outil), nonInterroges);
      const raison = nonVerifiables[0];
      if (raison) return avecNonInterroges(voletSans(raison, outil), nonInterroges);
      if (nonInterroges > 0 && !interroge) {
        return avecNonInterroges(voletSans('sources_non_publiques', outil), nonInterroges);
      }
      return avecNonInterroges(voletSans('analyse_propre', outil), nonInterroges);
    };
    // Rien touché au diff, rien caché à la réénumération vérifiée : aucun
    // lockfile en jeu (le diff vide ne l'a pas décidé seul — la base l'a confirmé).
    if (
      touches.length === 0 &&
      paires.length === 0 &&
      illisibles.length === 0 &&
      nonVerifiables.length === 0
    ) {
      return voletSans('aucun_lockfile');
    }
    if (paires.length === 0) return conclure(illisibles, 0);
    const sonde = await sonder('osv-scanner', lancer);
    if ('raison' in sonde) {
      nonVerifiables.push(sonde.raison);
      return conclure(illisibles, 0);
    }

    const racine = dossier();
    const rel = path.basename(racine);
    const ecrire = (relatif: string, contenu: string): string => {
      const ou = path.join(racine, ...relatif.split('/'));
      mkdirSync(path.dirname(ou), { recursive: true });
      writeFileSync(ou, contenu);
      return `${rel}/${relatif}`;
    };
    const communs = [
      '--format',
      'json',
      '--config',
      `${rel}/regles/osv-scanner.toml`,
      // Ni résolution transitive (deps.dev, Maven Central), ni analyse
      // d'appels (qui lancerait des scripts de build).
      '--no-resolve',
      '--no-call-analysis=all',
      '--verbosity',
      'error',
    ];
    // PASSE 1 — l'extraction, HORS LIGNE : sans `vulnmatch/osvdev`, l'outil
    // n'ouvre aucune connexion (mesuré). Un fichier à la fois.
    const extraire = async (
      role: 'base' | 'tete',
      p: Paire,
      lu: { chemin: string; contenu: string },
    ): Promise<Extraction> => {
      // Le NOM du fichier, tel quel : c'est lui qui dit à osv-scanner comment le lire.
      const fichier = ecrire(`dependances/${role}/${p.k}/${nomDeFichier(lu.chemin)}`, lu.contenu);
      const sortie = `extractions/${role}-${p.k}.json`;
      mkdirSync(path.join(racine, 'extractions'), { recursive: true });
      const r = await lancer(
        'osv-scanner',
        [
          'scan',
          'source',
          '-L',
          fichier,
          '--output-file',
          `${rel}/${sortie}`,
          '--experimental-disable-plugins',
          'vulnmatch/osvdev',
          '--all-packages',
          '--allow-no-lockfiles',
          ...communs,
        ],
        DELAI_PORTE_MS,
      );
      if (r.arret) return { raison: r.arret === 'lancement' ? 'outil_absent' : r.arret };
      // MESURÉ : un fichier qu'il ne sait pas lire sort en 127, « could not extract ».
      if (r.code === 127 && LOCKFILE_MAL_FORME.test(r.output)) return { mal_forme: true };
      const paquets = r.code === 0 ? lireRapport(path.join(racine, sortie), lireExtraction) : null;
      return paquets ? { paquets } : { raison: 'outil_en_echec' };
    };

    let nonInterroges = 0;
    let interroges = 0;
    const sboms: string[] = [];
    for (const p of paires) {
      const tete = await extraire('tete', p, p.tete);
      if ('mal_forme' in tete) {
        illisibles.push({ genre: 'lockfile_illisible', fichier: p.fichier, motif: 'mal_forme' });
        continue;
      }
      if ('raison' in tete) {
        nonVerifiables.push(tete.raison);
        continue;
      }
      const base: Extraction = p.base ? await extraire('base', p, p.base) : { paquets: [] };
      if (!('paquets' in base)) {
        // La base, elle, n'est pas l'œuvre de la production : rien à quoi comparer.
        nonVerifiables.push('raison' in base ? base.raison : 'lockfile_illisible');
        continue;
      }
      const choix = aInterroger(
        base.paquets,
        tete.paquets,
        p.base ? paquetsPublics(p.base.chemin, p.base.contenu) : new Set(),
        paquetsPublics(p.tete.chemin, p.tete.contenu),
      );
      nonInterroges += choix.nonInterroges;
      if (choix.tete.length === 0) continue;
      interroges += choix.tete.length;
      sboms.push('-L', ecrire(`sboms/tete/${p.k}/bom.cdx.json`, sbomDe(choix.tete)));
      if (choix.base.length > 0) {
        sboms.push('-L', ecrire(`sboms/base/${p.k}/bom.cdx.json`, sbomDe(choix.base)));
      }
    }
    if (sboms.length === 0) return conclure(illisibles, nonInterroges, sonde, false);

    // PASSE 2 — l'interrogation : les SEULS paquets des SBOM partent à osv.dev.
    opts.surEtape?.(
      `porte de sécurité : osv-scanner ${sonde.version} — interroge osv.dev sur ` +
        `${interroges} paquet(s) introduit(s)` +
        (nonInterroges > 0
          ? ` (${nonInterroges} non public(s) ou non épinglé(s) : non envoyés)…`
          : '…'),
    );
    // Par le réseau de LA PORTE quand le bac filtre (voir l'en-tête) : une
    // session ouverte pour cette seule interrogation, refermée aussitôt.
    const reseauPorte = opts.reseau ? await ouvrirReseauPorte(opts.reseau) : null;
    if (reseauPorte?.etat === 'impossible') {
      opts.surEtape?.(`porte de sécurité : ${reseauPorte.motif} — dépendances non vérifiées`);
      nonVerifiables.push('interrompue');
      return conclure(illisibles, nonInterroges, sonde);
    }
    let r: Awaited<ReturnType<Lancer>>;
    try {
      r = await lancer(
        'osv-scanner',
        ['scan', 'source', ...sboms, '--output-file', `${rel}/dependances.json`, ...communs],
        DELAI_PORTE_MS,
        reseauPorte ? reseauPorte.reseau : 'hote',
      );
    } finally {
      await reseauPorte?.fermer();
    }
    const interrogation = ((): SourceLue[] | Exclude<RaisonPorte, 'trouve'> => {
      if (r.arret) return r.arret === 'lancement' ? 'outil_absent' : r.arret;
      // MESURÉ : osv.dev injoignable, l'outil sort en 127 — avec un rapport VIDE
      // et valide, que seul le code de sortie dément — et nomme l'hôte.
      if (r.code === 127 && /vulnmatch\/osvdev|api\.osv\.dev|querybatch/.test(r.output)) {
        return 'osv_injoignable';
      }
      if (r.code !== 0 && r.code !== 1) return 'outil_en_echec';
      const sources = lireRapport(path.join(racine, 'dependances.json'), lireRapportOsv);
      if (sources === null) return 'outil_en_echec';
      const vulnerable = sources.some((s) => s.paquets.some((q) => q.vulnerabilites.length > 0));
      return (r.code === 1) === vulnerable ? sources : 'outil_en_echec';
    })();
    if (!Array.isArray(interrogation)) {
      nonVerifiables.push(interrogation);
      return conclure(illisibles, nonInterroges, sonde);
    }
    const base: SourceLue[] = [];
    const tete: { fichier: string; source: SourceLue }[] = [];
    for (const source of interrogation) {
      const m = /[\\/]sboms[\\/](base|tete)[\\/](\d+)[\\/]bom\.cdx\.json$/.exec(source.chemin);
      const paire = m && paires.find((p) => p.k === Number(m[2]));
      // Une source que la porte n'a pas écrite : l'outil n'a pas lu ses SBOM.
      if (!m || !paire) {
        nonVerifiables.push('outil_en_echec');
        return conclure(illisibles, nonInterroges, sonde);
      }
      if (m[1] === 'base') base.push(source);
      else tete.push({ fichier: paire.fichier, source });
    }
    return conclure(
      [...illisibles, ...vulnerabilitesIntroduites(base, tete)],
      nonInterroges,
      sonde,
    );
  } catch {
    return voletSans('interrompue');
  }
}
