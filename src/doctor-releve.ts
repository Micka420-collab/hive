// `hive doctor` — le relevé des faits. La moitié IMPURE.
//
// ─── LA SÉPARATION, ET CE QU'ELLE ACHÈTE ─────────────────────────────────────
//
// `src/shared/doctor.ts` juge ; ce fichier-ci regarde. Le partage n'est pas
// esthétique : c'est ce qui rend testables les cas « JE NE SAIS PAS ».
//
// Aucun test ne peut fabriquer un disque non interrogeable, un port tenu par un
// processus dont on n'a pas le droit de lire le propriétaire, ou un Windows qui
// ne rend pas de bits POSIX. En sortant ces mesures du module de jugement, on
// peut les LUI DONNER — et vérifier que `null` produit bien `inconnu`, jamais
// `ok`.
//
// ─── LA RÈGLE DE CE FICHIER ──────────────────────────────────────────────────
//
//     UNE MESURE QUI ÉCHOUE REND `null`. ELLE N'INVENTE JAMAIS.
//
// Chaque `try` ici se termine par `null`, pas par une valeur par défaut. Un
// défaut serait une mesure inventée, et elle traverserait le module pur
// jusqu'à un verdict rassurant. C'est exactement ce contre quoi tout `doctor`
// existe : le silence qui a l'air d'aller bien ne se corrige jamais.
//
// ─── AUCUN SHELL ─────────────────────────────────────────────────────────────
//
// Invariant du dépôt (MISSION-ACCUEIL §11.1) : aucun `shell: true`, aucune
// concaténation dans une commande.
//
// CE QUE CETTE NOTE DISAIT DE FAUX, et qui a tenu jusqu'au 14 août : « ce
// fichier n'exécute d'ailleurs AUCUN binaire externe ». Il en exécutait un —
// la sonde d'isolement, un `execFile` à lui. Elle vit désormais avec le nœud
// (`moteursJoignables`, `isolement.ts`) : c'est la question du preflight, et
// un docteur qui posait la sienne concluait « aucun bac à sable » sur un
// bubblewrap qui isolait très bien (`bwrap info` lance un programme `info`).
// Une prose qui survit au code qu'elle décrit est un mensonge à retardement.

import { accessSync, constants, existsSync, statfsSync, statSync } from 'node:fs';
import { createServer as creerServeurTcp } from 'node:net';
import path from 'node:path';
import { DEFAULT_TOKEN } from './shared/types.js';
import type { Releve } from './shared/doctor.js';
import { RUCHE_COMPLETE } from './shared/doctor.js';
import { adresseLocale, hoteDeConnexion, portDepuisEnv } from './shared/port.js';
import { gardiennesDepuisEnv } from './shared/reglages.js';
import { boucleLocale } from './shared/joignable.js';
import { modeRunnerDepuisEnv } from './orchestrator/essaim-runner.js';
import { inventaireAgents, type InventaireAgents } from './node-client/agent-detect.js';
import {
  commandeImage,
  IMAGE_DEFAUT,
  imageDepuisEnv,
  inspecterImage,
  moteurPret,
  moteursJoignables,
  type EtatImage,
  type Fournisseur,
} from './node-client/isolement.js';
import { SECRET_JWT_INTERDIT, secretJwtDepuisEnv } from './orchestrator/auth.js';

/** Où la ruche range ses affaires, vu depuis la racine du dépôt. */
export interface Emplacements {
  racine: string;
  env: string;
  base: string;
  dashboard: string;
  travail: string;
}

export function emplacements(racine: string, env: NodeJS.ProcessEnv = process.env): Emplacements {
  return {
    racine,
    env: path.join(racine, '.env'),
    base: env.HIVE_DB ?? path.join(racine, 'data', 'hive.db'),
    dashboard: path.join(racine, 'dashboard', 'dist', 'index.html'),
    travail: env.HIVE_WORKDIR ?? path.join(racine, '.hive-work'),
  };
}

/** Un fichier est-il lisible ? Toute erreur vaut « non », jamais « oui ». */
function lisible(chemin: string): boolean {
  try {
    accessSync(chemin, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function inscriptible(chemin: string): boolean {
  try {
    accessSync(chemin, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bits de permission POSIX, ou `null` là où ils ne veulent rien dire.
 *
 * Windows range ses droits en ACL : `statSync().mode` y rend une valeur
 * plausible et FAUSSE. Rendre cette valeur ferait dire au docteur « .env est
 * privé » alors qu'il n'a rien vérifié — le mensonge rassurant, exactement.
 */
function permissions(chemin: string, plateforme: string): number | null {
  if (plateforme === 'win32') return null;
  try {
    return statSync(chemin).mode & 0o777;
  } catch {
    return null;
  }
}

/** Le port est-il libre ? On essaie de l'écouter — la seule réponse honnête. */
export async function portLibre(port: number, hote = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const s = creerServeurTcp();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, hote);
  });
}

/**
 * Le port occupé l'est-il par NOUS ?
 *
 * On le demande à ce qui répond : `GET /api/health` rend `{ ok: true }` sur une
 * ruche, et n'importe quoi d'autre ailleurs. C'est le seul moyen portable —
 * lire le propriétaire d'une socket demande des droits qu'on n'a pas toujours,
 * et n'existe pas de la même façon sur les trois plateformes.
 *
 * `null` quand on ne peut pas conclure : rien n'a répondu à temps, ou la
 * réponse n'était pas du JSON. Cette distinction évite d'envoyer quelqu'un
 * tuer sa propre ruche.
 */
export async function portTenuParNous(
  port: number,
  hote = '127.0.0.1',
  delaiMs = 1_500,
): Promise<boolean | null> {
  const arret = AbortSignal.timeout(delaiMs);
  try {
    // `adresseLocale` et non un gabarit : `http://::1:7777` n'est pas une URL.
    // `fetch` la refusait, et une ruche liée à `::` passait pour « pas nous ».
    const r = await fetch(`${adresseLocale(hote, port).http}/api/health`, { signal: arret });
    if (!r.ok) return false;
    const corps = (await r.json()) as { ok?: unknown };
    return corps.ok === true;
  } catch (e) {
    // Un refus de connexion ou un corps illisible dit « pas une ruche ».
    // Un dépassement de délai ne dit RIEN — quelque chose écoute et se tait.
    return e instanceof Error && e.name === 'TimeoutError' ? null : false;
  }
}

/**
 * Le WebSocket répond-il ?
 *
 * C'EST LE POINT DE PANNE QUI NE SE VOIT PAS : l'API répond, l'écran
 * s'affiche, et rien ne bouge jamais. Un proxy qui ne relaie pas l'`Upgrade`
 * produit exactement cela, et on cherche du côté du code pendant une heure.
 *
 * On ne monte pas une vraie session : une poignée de main refusée suffit à
 * distinguer les deux cas. `null` si la ruche n'écoute pas — on ne conclut pas
 * d'un silence attendu.
 */
export async function wsRepond(
  port: number,
  hote = '127.0.0.1',
  delaiMs = 1_500,
): Promise<boolean | null> {
  const { default: WebSocket } = await import('ws');
  return new Promise((resolve) => {
    let fini = false;
    const finir = (v: boolean | null): void => {
      if (fini) return;
      fini = true;
      resolve(v);
    };
    const minuteur = setTimeout(() => finir(null), delaiMs);
    let ws: InstanceType<typeof WebSocket>;
    try {
      ws = new WebSocket(adresseLocale(hote, port).ws);
    } catch {
      clearTimeout(minuteur);
      finir(null);
      return;
    }
    ws.on('open', () => {
      clearTimeout(minuteur);
      ws.close();
      finir(true);
    });
    ws.on('error', () => {
      clearTimeout(minuteur);
      // On ne peut pas distinguer ici « ruche éteinte » de « Upgrade coupé » :
      // c'est l'appelant, qui sait si le port répond en HTTP, qui tranche.
      finir(false);
    });
  });
}

/**
 * Intégrité SQLite, ou `null` si on n'a pas pu ouvrir la base.
 *
 * ─── LE DÉFAUT QUE LA PREMIÈRE VERSION AVAIT, ET QU'AUCUNE LECTURE N'AURAIT VU
 *
 * Elle appelait `require('better-sqlite3')`. Ce fichier est un module ESM :
 * `require` n'y existe pas. L'appel levait donc une `ReferenceError`, le `try`
 * l'attrapait, et la fonction rendait `null` — TOUJOURS.
 *
 * Le diagnostic disait « intégrité non vérifiable (fichier verrouillé ?) » sur
 * une base parfaitement lisible, et rien ne le trahissait : `null` est une
 * réponse LÉGITIME de cette fonction, et le verdict qui en découle a l'air
 * réfléchi. Un docteur définitivement aveugle sur un point, qui le dit d'un ton
 * mesuré.
 *
 * Trouvé en LANÇANT la commande, pas en la relisant. C'est le genre de défaut
 * qu'aucune relecture n'attrape, parce que le code se lit juste.
 *
 * L'import reste PARESSEUX : `hive doctor` doit pouvoir tourner là où le module
 * natif n'a pas été compilé — c'est même un cas de panne fréquent, et il ne
 * doit pas faire tomber le docteur entier.
 */
export async function baseIntegre(chemin: string): Promise<boolean | null> {
  try {
    const { default: Database } = (await import('better-sqlite3')) as unknown as {
      default: new (
        p: string,
        o?: { readonly?: boolean },
      ) => {
        pragma(s: string): unknown;
        close(): void;
      };
    };
    const db = new Database(chemin, { readonly: true });
    try {
      const r = db.pragma('integrity_check') as { integrity_check?: string }[];
      return r[0]?.integrity_check === 'ok';
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Lesquels des paquets de la ruche complète ne se chargent pas, et pourquoi.
 *
 * ─── POURQUOI ON IMPORTE VRAIMENT AU LIEU DE REGARDER `node_modules/` ────────
 *
 * Un dossier `better-sqlite3/` présent ne prouve rien : npm le crée AVANT de
 * lancer la compilation, et il le laisse en place quand `node-gyp` échoue.
 * Ce qui casse `hive start`, c'est l'`import` — donc c'est l'`import` qu'on
 * fait ici. La seule question à laquelle il faut répondre est « est-ce que ce
 * paquet se charge sur cette machine », et un seul geste y répond.
 *
 * L'échec est ATTENDU et sans conséquence : on ne fait qu'importer, et le
 * catch ne laisse rien passer. C'est la même paresse que `baseIntegre()`, pour
 * la même raison — le docteur doit tourner là où le module natif manque.
 */
export async function moteurManquant(
  paquets: readonly string[] = RUCHE_COMPLETE,
): Promise<{ manquants: string[]; raison: string | null }> {
  const manquants: string[] = [];
  let raison: string | null = null;
  for (const nom of paquets) {
    try {
      const module = (await import(nom)) as { default: unknown };
      // `better-sqlite3` ne charge son binaire qu'au premier `new Database` :
      // l'`import` réussit sans lui — plateforme sans prébuilt, glibc trop
      // vieille. Ouvrir une base en mémoire est le seul geste qui le prouve.
      if (nom === 'better-sqlite3') {
        const Database = module.default as new (chemin: string) => { close(): void };
        new Database(':memory:').close();
      }
    } catch (e) {
      manquants.push(nom);
      // La PREMIÈRE raison seulement, et sa première ligne : une trace
      // `node-gyp` complète fait cinquante lignes et noierait les onze autres
      // diagnostics. Le geste qui donne le détail est dans `reparation`.
      raison ??= e instanceof Error ? (e.message.split('\n')[0] ?? null) : String(e);
    }
  }
  return { manquants, raison };
}

/**
 * La glibc qui exécute ce Node (« 2.36 »), lue dans le rapport de diagnostic
 * de Node ; `null` hors Linux et sous musl, où le rapport ne la donne pas.
 */
export function glibcVersion(): string | null {
  const rapport = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return rapport.header?.glibcVersionRuntime ?? null;
}

/** Place libre sur un chemin, ou `null` si le système ne répond pas. */
export function octetsLibres(chemin: string): number | null {
  try {
    const s = statfsSync(chemin);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/**
 * L'image que le nœud utiliserait (`imageDepuisEnv`), cherchée par la MÊME
 * règle que lui (`moteurPret`) dans les moteurs joignables — `null` s'il n'y
 * en a aucun. Voir le diagnostic `isolement`.
 */
export async function imageDuBac(
  env: NodeJS.ProcessEnv,
  moteurs: readonly Fournisseur[],
  inspecter: (f: Fournisseur, image: string) => Promise<EtatImage> = (f, image) =>
    inspecterImage(f, image, 5_000),
): Promise<Releve['imageBac']> {
  if (moteurs.length === 0) return null;
  const image = imageDepuisEnv(env);
  const { pret, absente } = await moteurPret(moteurs, image, inspecter);
  return {
    image,
    dans: pret?.nom ?? null,
    absenteDe: absente?.nom ?? null,
    construire: !pret && absente && image === IMAGE_DEFAUT ? commandeImage(absente) : null,
  };
}

/**
 * Le relevé complet.
 *
 * Rien n'est jugé ici — c'est `diagnostiquer()` qui le fait, sur ces faits.
 */
export async function relever(
  racine: string,
  env: NodeJS.ProcessEnv = process.env,
  plateforme: string = process.platform,
  // La détection d'agent sonde le PATH RÉEL de la machine (`spawn`), qu'aucune
  // variable d'environnement ne détourne. Sans cette couture, la règle
  // « `shell` vaut aucun agent » ne serait vérifiable que sur une machine où
  // rien n'est installé — c'est-à-dire nulle part en pratique.
  inventorier: (e: NodeJS.ProcessEnv) => Promise<InventaireAgents> = inventaireAgents,
): Promise<Releve> {
  const lieux = emplacements(racine, env);
  // MÊME règle que la ruche (`shared/port.ts`) : un docteur qui sonderait un
  // autre port que celui où elle écoute enverrait chercher une panne inventée.
  const port = portDepuisEnv(env);
  const hote = env.HIVE_HOST ?? '127.0.0.1';
  const sondage = hoteDeConnexion(hote);

  const envPresent = existsSync(lieux.env);
  const libre = await portLibre(port, sondage);
  // On ne sonde la ruche QUE si le port est pris : interroger un port libre
  // ferait attendre le délai complet pour apprendre ce qu'on sait déjà.
  const parNous = libre ? null : await portTenuParNous(port, sondage);
  // Et le WebSocket seulement si c'est bien notre ruche : sur un port tenu par
  // autre chose, un refus d'`Upgrade` ne dirait rien de la ruche.
  const ws = parNous === true ? await wsRepond(port, sondage) : null;

  const basePresente = existsSync(lieux.base);
  const jeton = env.HIVE_TOKEN ?? '';
  const moteur = await moteurManquant();
  // UNE passe de sondes : l'agent que le nœud retiendrait (le premier
  // utilisable — la règle de `detectBestAgent`) et ceux qu'il écarte.
  const agents = await inventorier(env).catch((): InventaireAgents => ({
    tous: ['shell'],
    nonConnectes: [],
    presents: [],
  }));
  // Sondés UNE fois : le nom du premier et l'image du bac en découlent.
  const joignables = await moteursJoignables().catch((): Fournisseur[] => []);

  return {
    versionNode: process.versions.node,
    glibc: glibcVersion(),
    fichierEnv: {
      present: envPresent,
      // MUTANT NON TESTÉ, ET C'EST ÉCRIT PLUTÔT QUE TU. Remplacer ce `&&` par
      // `||` ne se voit que sur un fichier qui EXISTE et qu'on NE PEUT PAS
      // lire : absent, les deux formes rendent `false`. Fabriquer un tel
      // fichier suppose de ne pas être root — et une suite de tests dont le
      // résultat dépend du compte qui la lance ment un jour sur deux.
      //
      // La garde reste juste : `lisible()` rend `false` sur toute erreur, donc
      // le `&&` ne fait qu'éviter un appel inutile quand le fichier est absent.
      lisible: envPresent && lisible(lieux.env),
      permissions: envPresent ? permissions(lieux.env, plateforme) : null,
    },
    jeton: {
      present: jeton !== '',
      longueur: jeton.length,
      trivial: jeton === DEFAULT_TOKEN,
    },
    // Le secret de session, relevé avec la MÊME fonction que la garde du
    // serveur : `secretJwtDepuisEnv` rend la chaîne vide dès qu'il est
    // inutilisable. Réécrire la règle ici la ferait diverger le jour où l'une
    // des deux bouge — et un docteur qui applique une règle approchante donne
    // un avis sur un autre programme que celui qui va tourner.
    secretSession: {
      // ─── `env`, ET SURTOUT PAS `process.env` ────────────────────────────────
      //
      // La première version de ces quatre lignes lisait `process.env`. Elles
      // marchaient — et elles étaient INÉPROUVABLES : tout ce fichier reçoit son
      // environnement en PARAMÈTRE pour que les tests puissent le composer, et
      // ces quatre-là passaient à côté de la couture.
      //
      // La loupe l'a montré en faisant survivre trois mutants d'affilée ici :
      // inverser `!== ''`, `=== SECRET_JWT_INTERDIT` et `=== '1'` ne faisait
      // rougir personne, parce qu'aucun test ne pouvait atteindre ces branches.
      // Ce n'était pas un test manquant, c'était une couture contournée.
      utilisable: secretJwtDepuisEnv(env) !== '',
      longueur: (env.HIVE_JWT_SECRET ?? '').trim().length,
      publie: (env.HIVE_JWT_SECRET ?? '').trim() === SECRET_JWT_INTERDIT,
      simulation: (env.HIVE_SIMULATION ?? '') === '1',
    },
    port: { numero: port, libre, parNous },
    moteur,
    base: {
      presente: basePresente,
      integre: basePresente ? await baseIntegre(lieux.base) : null,
      inscriptible: basePresente
        ? inscriptible(lieux.base)
        : inscriptible(path.dirname(lieux.base)),
    },
    dashboardConstruit: existsSync(lieux.dashboard),
    // L'inventaire NE REND JAMAIS VIDE : faute de mieux, il retombe sur
    // l'adaptateur `shell`, qui est SIMULÉ. Le rapporter comme un agent détecté
    // dirait « tout va bien » à qui n'a rien d'installé, et son nœud
    // produirait des diffs vides sans que personne comprenne pourquoi.
    //
    // Pour le docteur, `shell` vaut donc « aucun agent » — c'est ce que la
    // personne a besoin d'entendre.
    agent: agents.tous[0] === 'shell' ? null : (agents.tous[0] ?? null),
    // Installé n'est pas connecté : ces agents n'auront pas d'ouvrière, et le
    // docteur le dit avec le remède plutôt que de les taire.
    agentsNonConnectes: agents.nonConnectes,
    isolement: joignables[0]?.nom ?? null,
    // Une inspection qui plante n'est ni « présente » ni « absente » : inconnue.
    imageBac: await imageDuBac(env, joignables).catch(() =>
      joignables.length === 0
        ? null
        : { image: imageDepuisEnv(env), dans: null, absenteDe: null, construire: null },
    ),
    wsJoignable: ws,
    reglages: {
      // MÊMES règles que la ruche : un docteur qui annonce autre chose que ce
      // qui tourne est pire qu'un docteur muet, parce qu'on le croit.
      runner: modeRunnerDepuisEnv(env),
      bindPublic: (env.HIVE_HOST ?? '127.0.0.1') === '0.0.0.0',
      gardiennes: gardiennesDepuisEnv(env),
      corsOuvert: (env.HIVE_CORS_ORIGIN ?? '') === '*',
    },
    espace: {
      // On mesure le dossier PARENT quand l'espace de travail n'existe pas
      // encore : c'est là qu'il sera créé, donc c'est sa place qui compte.
      octetsLibres: octetsLibres(existsSync(lieux.travail) ? lieux.travail : racine),
      inscriptible: existsSync(lieux.travail) ? inscriptible(lieux.travail) : inscriptible(racine),
    },
    // Les MÊMES lectures que la ruche et le nœud : seul « 1 » allume.
    decouverte: {
      ruche: env.HIVE_DECOUVERTE === '1',
      machine: env.HIVE_DECOUVRABLE === '1',
      ecouteLocale: boucleLocale(env.HIVE_HOST ?? '127.0.0.1'),
    },
  };
}
