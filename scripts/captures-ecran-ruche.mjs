// LA RUCHE DE LABORATOIRE DES CAPTURES — une vraie Reine, une vraie ouvrière,
// un état jetable, et rien de la machine de celui qui la lance.
//
// Module de `scripts/captures-ecran.mjs`. Il ne photographie rien : il MONTE la
// ruche que les captures regardent, la remplit par l'API, et la démonte.
//
// ─── POURQUOI PAS `npm run ruche` TEL QUEL ──────────────────────────────────
//
// Le lanceur fait exactement ce qu'on veut pour un humain, et trois choses
// qu'on ne veut pas ici :
//
//   1. Il lance ses enfants DANS LA RACINE DU DÉPÔT. La Reine y charge le `.env`
//      (`chargerEnvQueen`) et le nœud aussi (`process.loadEnvFile`) : clés
//      d'API, jeton GitHub, URL publique — tout ce que l'opérateur y a posé
//      entrerait dans la ruche photographiée. Au mieux la capture dépend de la
//      machine ; au pire elle montre ce que l'opérateur a configuré.
//   2. Son écran Vite écoute :5173 et relaie vers :7777, ÉCRITS EN DUR
//      (`dashboard/vite.config.ts`). Sur la machine de quelqu'un dont la ruche
//      tourne, les captures photographieraient SA ruche, ou échoueraient sur
//      « port occupé ».
//   3. `HIVE_PORT=0` y est un piège : la Reine choisit un port que l'ouvrière
//      ignore. Elle retombe sur `ws://localhost:7777/ws` — la ruche de
//      l'opérateur, s'il y en a une, avec un jeton qui n'est pas le sien.
//
// On reprend donc SA composition — `pieces()` de `src/shared/demarrage.ts`, le
// même lanceur, les mêmes points d'entrée, dans le même ordre — et on change
// trois choses : le dossier de travail est un dossier jetable (aucun `.env` à
// y lire), l'environnement est reconstruit sur liste blanche, et l'ouvrière ne
// part qu'APRÈS que la Reine a dit sur quel port elle écoute.
//
// L'écran n'est pas son affaire : le coureur le construit dans le dossier
// jetable et le fournit lui-même au navigateur — `dashboard/dist`, que sert
// peut-être la ruche de l'opérateur depuis ce même dépôt, n'est pas touché.
//
// ─── CHARGÉ APRÈS TSX, JAMAIS AVANT ──────────────────────────────────────────
//
// L'import de `demarrage.ts` ci-dessous est un import de TypeScript. Il ne
// marche que parce que le coureur enregistre tsx AVANT d'importer ce module
// (même ordre que `ruche.mjs`), et parce que vitest compile ses bancs.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { URLSearchParams } from 'node:url';
// Explicites : ESLint ne déclare pas les globales de minuterie dans `scripts/*.mjs`
// (cf. `ruche.mjs`).
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as patienter } from 'node:timers/promises';
import { pieces } from '../src/shared/demarrage.ts';

/** Windows n'a pas de groupes de processus POSIX — `detached` y signifie autre chose. */
const POSIX = process.platform !== 'win32';

// ─── CE QUI PASSE DE LA MACHINE À LA RUCHE DE LABORATOIRE ───────────────────
//
// Une LISTE BLANCHE, et pas une liste noire de secrets : on ne peut pas
// énumérer les secrets de quelqu'un d'autre. `ANTHROPIC_API_KEY` se retire
// facilement ; `MON_PROXY_TOKEN` ou un `HIVE_*` ajouté l'an prochain, non.
//
// Ne passe que ce sans quoi Node ne tourne pas : trouver des exécutables
// (`PATH`, `PATHEXT`), un dossier personnel et un dossier temporaire (tsx y
// met son cache), et sous Windows les variables système sans lesquelles la
// cryptographie et le réseau échouent (`SYSTEMROOT`). Comparées sans casse :
// Windows écrit `Path`, POSIX `PATH`.
const HERITEES = new Set([
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
]);

/** Le nom de l'ouvrière photographiée — une démo, jamais le nom de la machine. */
export const NOM_OUVRIERE = 'atelier-demo';

/**
 * La relectrice de démonstration (`scripts/captures-relectrice.mjs`) : une
 * seconde famille d'agent, le temps du débat que la War Room photographie.
 */
export const NOM_RELECTRICE = 'relectrice-demo';

/**
 * Ce qui fait de l'ouvrière du laboratoire une RELECTRICE : l'adaptateur
 * « commande libre », pointé sur le script de démonstration.
 *
 * `HIVE_AGENT_CMD` est découpé sur les espaces, sans shell (`custom.ts`, §5.1) :
 * un chemin qui en contient se couperait en deux arguments, et la relectrice
 * lancerait un programme qui n'existe pas. On le REFUSE ici, dit, plutôt que
 * de photographier une War Room vide sans savoir pourquoi.
 */
export function envRelectrice(env, { racine, ws, node = process.execPath }) {
  const commande = [node, path.join(racine, 'scripts', 'captures-relectrice.mjs'), '{prompt}'];
  const espace = commande.find((morceau) => /\s/.test(morceau));
  if (espace) {
    throw new Error(
      `la relectrice de démonstration exige un chemin sans espace (HIVE_AGENT_CMD est découpé sur les espaces) : « ${espace} »`,
    );
  }
  return {
    ...env,
    HIVE_URL: ws,
    HIVE_AGENT: 'custom',
    HIVE_AGENT_CMD: commande.join(' '),
    HIVE_NODE_NAME: NOM_RELECTRICE,
    HIVE_MAX_CONCURRENCY: '1',
  };
}

/**
 * L'environnement des deux processus de la ruche de laboratoire.
 *
 * `parent` est l'environnement de celui qui lance ; seules les variables de
 * `HERITEES` en sortent. Tout le reste est posé ici, explicitement :
 *
 *   · `HIVE_PORT=0` — le système choisit ; la Reine l'annonce (`adresseAnnoncee`) ;
 *   · jeton et secret de session TIRÉS AU SORT — la garde de démarrage de la
 *     Reine s'applique, on ne passe pas par `HIVE_SIMULATION` qui la relâche ;
 *   · `HIVE_AGENT=shell` — l'adaptateur simulé : aucun agent réel, aucun crédit
 *     consommé, et la Reine lui confie du travail (`shellForce`, server.ts) ;
 *   · `HIVE_ISOLEMENT=off` — sinon la capture dépendrait de la présence de
 *     Docker ou de Podman sur la machine ; le bac déclaré reste « processus »,
 *     ce qui est vrai ;
 *   · les noms — l'ouvrière porterait sinon le nom d'hôte de la machine, et son
 *     propriétaire le nom de session de l'opérateur, jusque dans les images.
 */
export function envIsole(parent, { dossier, jeton, secret }) {
  const env = {};
  for (const [cle, valeur] of Object.entries(parent)) {
    if (valeur !== undefined && HERITEES.has(cle.toUpperCase())) env[cle] = valeur;
  }
  return {
    ...env,
    NO_COLOR: '1',
    HIVE_HOST: '127.0.0.1',
    HIVE_PORT: '0',
    HIVE_TOKEN: jeton,
    HIVE_JWT_SECRET: secret,
    HIVE_DB: path.join(dossier, 'hive.db'),
    HIVE_AGENT: 'shell',
    HIVE_ISOLEMENT: 'off',
    HIVE_MAX_CONCURRENCY: '2',
    HIVE_NODE_NAME: NOM_OUVRIERE,
    HIVE_OWNER_NAME: 'Démo',
  };
}

/**
 * L'adresse que la Reine annonce en démarrant, ou `null` tant qu'elle ne l'a
 * pas dite.
 *
 * C'est la seule façon de connaître un port choisi par le système : personne ne
 * le sait avant elle (cf. `pieces`, « adresse annoncée au démarrage »). Les deux
 * lignes lues sont celles de `src/orchestrator/main.ts` :
 *
 *     Dashboard : http://127.0.0.1:41873
 *     WebSocket : ws://127.0.0.1:41873/ws
 *
 * On exige les DEUX, et sur le même port : l'une sans l'autre veut dire que la
 * bannière est encore en train d'arriver, ou qu'elle a changé de forme — et
 * deviner l'adresse de l'ouvrière à partir de celle de l'écran referait, en
 * plus discret, le piège du port écrit en dur.
 */
export function adresseAnnoncee(texte) {
  const http = /Dashboard\s*:\s*(http:\/\/[^\s/]+:(\d+))\s*$/m.exec(String(texte ?? ''));
  const ws = /WebSocket\s*:\s*(ws:\/\/[^\s/]+:(\d+)\/ws)\s*$/m.exec(String(texte ?? ''));
  if (!http || !ws || http[2] !== ws[2] || Number(http[2]) === 0) return null;
  return { http: http[1], ws: ws[1], port: Number(http[2]) };
}

/** Un secret tiré au sort, assez long pour passer les gardes de la Reine. */
function tirage() {
  return randomBytes(24).toString('base64url');
}

/**
 * Lance un processus dans son PROPRE groupe, sorties tuyautées.
 *
 * Le groupe est ce qui permet de tout emporter d'un seul signal (cf.
 * `tests/harnais-processus.ts`, où le trou « on tue le père, les enfants
 * survivent » a été mesuré : quarante processus orphelins en une nuit).
 */
function lancerEnGroupe(bin, argv, options) {
  return spawn(bin, argv, {
    ...options,
    shell: false,
    windowsHide: true,
    detached: POSIX,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Frappe le groupe entier (POSIX), ou le processus seul à défaut. */
function frapper(proc, signal) {
  const pid = proc.pid;
  if (typeof pid !== 'number' || proc.exitCode !== null || proc.signalCode !== null) return;
  if (POSIX) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // pas de groupe à ce nom : on retombe sur le processus seul
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // déjà mort — c'est le résultat recherché
  }
}

/**
 * Attend la fin d'un processus, bornée ; rend `true` s'il est bien mort.
 *
 * Le minuteur de la borne est ANNULÉ dès que le processus meurt : laissé armé,
 * il retenait la boucle — donc la sortie du coureur — jusqu'à cinq secondes
 * après un arrêt pourtant déjà fini.
 */
async function attendreFin(proc, ms) {
  if (proc.exitCode !== null || proc.signalCode !== null) return true;
  let minuteur;
  return Promise.race([
    new Promise((resoudre) => proc.once('exit', () => resoudre(true))),
    new Promise((resoudre) => {
      minuteur = setTimeout(() => resoudre(false), ms);
    }),
  ]).finally(() => clearTimeout(minuteur));
}

/** Les 200 dernières lignes des deux processus — ce qu'on montre quand ça casse. */
function journalBorne() {
  const lignes = [];
  return {
    brancher(proc, etiquette) {
      for (const flux of [proc.stdout, proc.stderr]) {
        flux.setEncoding('utf8');
        flux.on('data', (bout) => {
          for (const l of bout.split('\n')) if (l.trim() !== '') lignes.push(`${etiquette} │ ${l}`);
          if (lignes.length > 200) lignes.splice(0, lignes.length - 200);
        });
      }
    },
    texte: () => lignes.join('\n'),
  };
}

/**
 * Monte la ruche de laboratoire : la Reine, puis — une fois son adresse
 * connue — l'ouvrière, puis attend que l'ouvrière soit EN LIGNE.
 *
 * `lancer` est remplaçable pour que le banc passe par son harnais de processus
 * (qui reprend tout en `afterEach`, même quand un test échoue) ; le coureur
 * garde le défaut. Rend `{ http, ws, port, entetes, noeudId, journal, arreter }`.
 *
 * ─── L'ARRÊT EST REMIS AVANT LE PREMIER PROCESSUS ───────────────────────────
 *
 * `enregistrer(arreter)` est appelé AVANT que la Reine ne parte. Le coureur y
 * range l'arrêt parmi ce qu'il rend sur ^C, et c'est la seule place qui tienne :
 * rangé au RETOUR de cette fonction, il manquait pendant tout le démarrage —
 * une à trois secondes d'ordinaire, jusqu'à deux minutes sur une machine
 * chargée. Un ^C tombé là effaçait le dossier, fermait le navigateur, et
 * laissait la Reine (puis l'ouvrière) tourner : elles sont dans leur propre
 * groupe, le ^C du terminal ne les atteint pas. Mesuré en revue, trois fois sur
 * trois : une Reine orpheline, toujours à l'écoute, dans un dossier effacé, à
 * 100 % d'un cœur. `tests/captures-ecran.test.mjs` l'arrête en plein
 * démarrage, à chacune des deux étapes.
 *
 * Arrêtée, la ruche ne lance plus RIEN : un processus démarré après l'arrêt
 * serait un orphelin par construction. Les deux attentes du démarrage lâchent
 * aussitôt, au lieu de guetter jusqu'à leur échéance une ruche qu'on a tuée.
 */
export async function lancerRucheIsolee({
  racine,
  dossier,
  lancer = lancerEnGroupe,
  enregistrer = () => {},
}) {
  const jeton = tirage();
  const env = envIsole(process.env, { dossier, jeton, secret: tirage() });
  const journal = journalBorne();
  const vivants = [];
  const abandon = new AbortController();

  // Une seule promesse d'arrêt, que chacun attend : le ^C du coureur et le
  // `catch` ci-dessous arrivent ensemble, et le second ne doit pas rendre la
  // main — donc laisser effacer le dossier — avant que le premier ait fini.
  let arret = null;
  const arreter = () =>
    (arret ??= (async () => {
      abandon.abort(new Error('ruche de laboratoire arrêtée pendant son démarrage'));
      // SIGTERM d'abord : la Reine ferme alors sa base proprement, et le dossier
      // jetable s'efface sans « fichier occupé » sous Windows. SIGKILL ensuite,
      // pour ce qui n'a pas voulu partir — et on attend encore qu'il soit
      // mort : le coureur efface le dossier juste après.
      for (const p of vivants) frapper(p, 'SIGTERM');
      const morts = await Promise.all(vivants.map((p) => attendreFin(p, 5_000)));
      const tetus = vivants.filter((_, i) => !morts[i]);
      for (const p of tetus) frapper(p, 'SIGKILL');
      await Promise.all(tetus.map((p) => attendreFin(p, 2_000)));
    })());
  enregistrer(arreter);

  // Les chemins de `pieces` sont relatifs à la racine du dépôt, et nos enfants
  // tournent AILLEURS : on résout le lanceur ici. Le point d'entrée, lui, est
  // résolu par `scripts/lancer.mjs` contre sa propre racine.
  const demarrer = (voeu, envPiece) => {
    abandon.signal.throwIfAborted();
    const [piece] = pieces(process.execPath, voeu);
    const [lanceur, ...reste] = piece.argv;
    const proc = lancer(piece.bin, [path.join(racine, lanceur), ...reste], {
      cwd: dossier,
      env: envPiece,
    });
    // Rangé AVANT tout `await` : un arrêt qui tombe ensuite le voit.
    vivants.push(proc);
    journal.brancher(proc, piece.nom);
    return proc;
  };

  try {
    const reine = demarrer({ hub: true }, env);
    const adresse = await attendreAdresse(reine, journal, abandon.signal);
    const entetes = { 'x-hive-token': jeton };
    demarrer({ noeud: true }, { ...env, HIVE_URL: adresse.ws });
    const noeudId = await attendreOuvriere(adresse.http, entetes, journal, abandon.signal);
    // La relectrice part par le MÊME lanceur que les deux autres : rangée dans
    // `vivants`, un ^C l'emporte avec la ruche, même en plein débat.
    const ajouterRelectrice = async () => {
      const proc = demarrer({ noeud: true }, envRelectrice(env, { racine, ws: adresse.ws }));
      const id = await attendreOuvriere(
        adresse.http,
        entetes,
        journal,
        abandon.signal,
        NOM_RELECTRICE,
      );
      return {
        noeudId: id,
        arreter: async () => {
          frapper(proc, 'SIGTERM');
          if (!(await attendreFin(proc, 5_000))) {
            frapper(proc, 'SIGKILL');
            await attendreFin(proc, 2_000);
          }
        },
      };
    };
    return { ...adresse, entetes, noeudId, journal: journal.texte, arreter, ajouterRelectrice };
  } catch (e) {
    await arreter();
    // Arrêtée de l'extérieur : c'est CETTE raison qu'on rend, pas l'« operation
    // was aborted » anonyme de l'attente qu'elle a interrompue.
    throw abandon.signal.aborted ? abandon.signal.reason : e;
  }
}

/**
 * Lit la sortie de la Reine jusqu'à son adresse ; échoue si elle meurt, se
 * tait, ou si la ruche est arrêtée entre-temps.
 *
 * Une fois l'adresse lue, le lecteur se DÉBRANCHE : resté en place, il
 * accumulait toute la sortie de la Reine pendant l'exécution entière, et
 * repassait deux expressions régulières sur un texte qui ne cessait de grandir.
 */
function attendreAdresse(reine, journal, signal, patienceMs = 60_000) {
  return new Promise((resoudre, rejeter) => {
    let lu = '';
    const finir = (erreur, adresse) => {
      clearTimeout(minuteur);
      reine.stdout.off('data', lire);
      reine.off('exit', mort);
      signal.removeEventListener('abort', surAbandon);
      if (erreur) rejeter(erreur);
      else resoudre(adresse);
    };
    const minuteur = setTimeout(() => {
      finir(
        new Error(
          `la Reine n'a pas annoncé son adresse en ${patienceMs / 1000} s\n${journal.texte()}`,
        ),
      );
    }, patienceMs);
    const lire = (bout) => {
      lu += bout;
      const adresse = adresseAnnoncee(lu);
      if (adresse) finir(null, adresse);
    };
    const mort = (code, sig) => {
      finir(
        new Error(
          `la Reine s'est arrêtée au démarrage (${sig ?? `code ${code}`})\n${journal.texte()}`,
        ),
      );
    };
    const surAbandon = () => finir(signal.reason);
    reine.stdout.on('data', lire);
    reine.once('exit', mort);
    signal.addEventListener('abort', surAbandon, { once: true });
  });
}

/** Une requête à la ruche ; le corps JSON, ou une erreur qui dit la route et le statut. */
async function demander(base, chemin, options = {}) {
  const r = await fetch(base + chemin, options);
  const texte = await r.text();
  if (!r.ok)
    throw new Error(`${options.method ?? 'GET'} ${chemin} → ${r.status} : ${texte.slice(0, 300)}`);
  return texte === '' ? null : JSON.parse(texte);
}

async function attendreOuvriere(
  base,
  entetes,
  journal,
  signal,
  nom = NOM_OUVRIERE,
  patienceMs = 60_000,
) {
  const fin = Date.now() + patienceMs;
  while (Date.now() < fin) {
    signal.throwIfAborted();
    const etat = await demander(base, '/api/state', { headers: entetes, signal }).catch(() => null);
    const noeud = (etat?.nodes ?? []).find((n) => n?.name === nom && n?.status === 'online');
    if (noeud) return noeud.id;
    await patienter(250, undefined, { signal });
  }
  throw new Error(
    `l'ouvrière ${nom} n'est pas en ligne après ${patienceMs / 1000} s\n${journal.texte()}`,
  );
}

// ─── CE QUE LA RUCHE PHOTOGRAPHIÉE CONTIENT ─────────────────────────────────
//
// De quoi remplir chaque vue sans rien inventer : deux projets, un petit graphe
// de dépendances, une tâche qui RATE sa première tentative et réussit à la
// seconde (le marqueur `[flaky]` de l'adaptateur simulé, cf. src/adapters/shell.ts).
// Sans elle, la chronologie, la santé et la réputation ne montreraient jamais
// qu'un chemin heureux.
//
// Le marqueur est posé sur la DERNIÈRE tâche à tourner, et ce n'est pas un
// détail : la Reine joint à chaque tâche les souvenirs Hive Mind des tâches
// déjà réussies, prompt compris (`construireHiveContext`, server.ts), et
// l'adaptateur simulé lit le prompt ainsi composé. Posé sur « Tests du
// panier », le marqueur voyageait dans le souvenir jusqu'à la documentation,
// qui échouait à son tour — mesuré au premier essai : deux tâches réessayées
// au lieu d'une. Sur la feuille, son souvenir n'existe qu'une fois tout le
// reste fini.
//
// Tout passe par l'API publique, comme le ferait le tableau — pas d'écriture
// directe en base : une capture d'un état que l'API ne sait pas produire ne
// prouverait rien.
export const PLAN_DEMO = [
  {
    name: 'Boutique — panier d’achat',
    description: 'Démonstration : un chantier découpé en tâches dépendantes.',
    tasks: [
      {
        id: 'panier-modele',
        title: 'Modèle de données du panier',
        prompt: 'Définir le type Panier, ses lignes et le calcul du total.',
      },
      {
        id: 'panier-api',
        title: 'API du panier',
        prompt: 'Exposer ajouter, retirer et vider sur le modèle du panier.',
        dependsOn: ['panier-modele'],
      },
      {
        id: 'panier-page',
        title: 'Page du panier',
        prompt: 'Afficher les lignes, le total et le bouton de commande.',
        dependsOn: ['panier-api'],
      },
      {
        id: 'panier-tests',
        title: 'Tests du panier',
        prompt: 'Couvrir ajouter, retirer et le total.',
        dependsOn: ['panier-api'],
      },
      {
        id: 'panier-doc',
        title: 'Documentation du panier',
        prompt:
          'Décrire l’API du panier et un exemple d’usage. [flaky] — marqueur de ' +
          'démonstration : la première tentative échoue, la ruche réessaie.',
        dependsOn: ['panier-page', 'panier-tests'],
      },
    ],
  },
  {
    name: 'Site vitrine',
    description: 'Démonstration : deux tâches indépendantes.',
    tasks: [
      {
        id: 'vitrine-accueil',
        title: 'Page d’accueil',
        prompt: 'Écrire la page d’accueil avec son titre et son appel à l’action.',
      },
      {
        id: 'vitrine-contact',
        title: 'Formulaire de contact',
        prompt: 'Écrire le formulaire de contact et sa validation.',
      },
    ],
  },
];

/** La tâche dont on ouvre le tiroir : celle qui a DEUX tentatives à raconter. */
export const TACHE_RACONTEE = 'Documentation du panier';

/**
 * Le lot confié pendant qu'on photographie « en vol ». Six tâches sans
 * dépendance pour une ouvrière à deux places : de quoi garder des sous-agents
 * en l'air pendant quelques secondes.
 */
export const LOT_EN_VOL = [
  'Relecture du panier',
  'Traductions de la vitrine',
  'Accessibilité du formulaire',
  'Performances de la page',
  'Journal des commandes',
  'Nettoyage des styles',
].map((title) => ({ title, prompt: `${title} — tâche de démonstration.` }));

const TERMINALES = new Set(['done', 'failed']);

/**
 * Remplit la ruche par l'API : le premier compte (qui devient administrateur,
 * cf. `roleALaCreation`), puis les projets et leurs tâches — et attend que
 * TOUTES soient terminées, pour photographier un état stable.
 *
 * Rend `{ jwt, projets }` ; `jwt` est la session à poser dans le navigateur,
 * sans laquelle les vues d'administration n'apparaissent pas dans la barre.
 */
export async function amorcerRuche(ruche, plan = PLAN_DEMO, patienceMs = 120_000) {
  const json = { ...ruche.entetes, 'content-type': 'application/json' };
  const poster = (chemin, corps) =>
    demander(ruche.http, chemin, { method: 'POST', headers: json, body: JSON.stringify(corps) });

  const compte = await poster('/api/auth/register', {
    email: 'reine@exemple.invalid',
    displayName: 'Reine Démo',
    // Jamais affiché, jamais réutilisé : la session suffit aux captures.
    password: tirage(),
  });

  // La configuration initiale est ARRÊTÉE, par l'administratrice : sans elle,
  // l'assistant de première arrivée s'ouvrirait par-dessus chaque vue et
  // chaque capture photographierait le même dialogue. Les choix sont ceux
  // d'une ruche de laboratoire : tout sur la machine, rien ne sort.
  await demander(ruche.http, '/api/configuration-initiale/terminer', {
    method: 'POST',
    headers: { ...json, authorization: `Bearer ${compte.token}` },
    body: JSON.stringify({ mode: 'local', secrets: 'sessions_cli', git: 'local', connecteurs: [] }),
  });

  const projets = [];
  for (const p of plan) {
    const projet = await poster('/api/projects', { name: p.name, description: p.description });
    await poster(`/api/projects/${encodeURIComponent(projet.id)}/tasks`, { tasks: p.tasks });
    projets.push(projet.id);
  }
  await attendreTerminees(ruche, patienceMs);
  return { jwt: compte.token, projets };
}

/** Confie un lot au premier projet, SANS attendre : c'est le vol qu'on veut voir. */
export async function confierLot(ruche, projetId, lot = LOT_EN_VOL) {
  await demander(ruche.http, `/api/projects/${encodeURIComponent(projetId)}/tasks`, {
    method: 'POST',
    headers: { ...ruche.entetes, 'content-type': 'application/json' },
    body: JSON.stringify({ tasks: lot }),
  });
}

/** Attend que plus aucune tâche ne soit en attente ni en cours. */
export async function attendreTerminees(ruche, patienceMs = 120_000) {
  const fin = Date.now() + patienceMs;
  let restantes = [];
  while (Date.now() < fin) {
    const etat = await demander(ruche.http, '/api/state', { headers: ruche.entetes });
    const taches = etat?.tasks ?? [];
    restantes = taches.filter((t) => !TERMINALES.has(t?.status));
    if (taches.length > 0 && restantes.length === 0) return taches;
    await patienter(250);
  }
  throw new Error(
    `${restantes.length} tâche(s) toujours en cours après ${patienceMs / 1000} s : ` +
      restantes.map((t) => `${t.title} (${t.status})`).join(', '),
  );
}

// ─── LE DÉBAT QUE LA WAR ROOM PHOTOGRAPHIE ──────────────────────────────────
//
// La War Room ne montre que des faits journalisés par les VRAIS producteurs :
// on ne les écrit donc pas, on les PROVOQUE. Une seconde famille — la
// relectrice de démonstration, `scripts/captures-relectrice.mjs` — relit les
// productions du `shell`, et chaque tâche ci-dessous emprunte un chemin
// différent du protocole (`docs/PROTOCOLE-DEBAT.md`) :
//
//   · « Validation des montants » : contestée à chaque essai — la ruche
//     relance le producteur avec la critique jusqu'à épuiser ses essais, et
//     la contestation reste EN TÊTE, à trancher ;
//   · « Arrondi des taxes » : la relectrice se tait, aucune autre famille pour
//     le secours — relecture impossible, l'Evaluator appelle un humain ;
//   · « Export CSV des paiements » : validée, rejetée par un humain avec sa
//     raison (la correction part avec elle), revalidée, puis approuvée ;
//   · deux Conseils : le premier tranché par un humain, le second laissé tel
//     qu'il se clôt — s'il n'a pas convergé, il attend quelqu'un.
//
// Les tâches passent UNE À UNE, et chacune va au bout de son chemin avant la
// suivante : deux productions en vol mêleraient leurs relectures, et le
// producteur ne serait plus forcément l'ouvrière `shell` (à charge égale, la
// file départage par le nom — `atelier-demo` passe avant `relectrice-demo`).
//
// La relectrice est ARRÊTÉE à la fin : laissée en ligne, elle prendrait des
// productions du lot « en vol » et y répondrait par une production vide. Les
// vues la montrent donc hors ligne — ce qui est vrai.

export const PROJET_DEBAT = {
  name: 'Paiement — revue croisée',
  description: 'Démonstration : une seconde famille relit, conteste, se tait ; un humain tranche.',
};

/** Le rejet humain de la démonstration, et la raison qui part avec la correction. */
export const RAISON_REJET_DEMO =
  'Les en-têtes doivent suivre le modèle comptable : date, montant, devise.';

/** La question des deux Conseils de la démonstration. */
export const QUESTION_DEBAT = 'Que faut-il changer en premier dans le module de paiement ?';

/**
 * Attend qu'une condition sur le fil d'une tâche soit vraie, et rend ce fil.
 * Le fil vient de `GET /api/war-room` : on attend ce que l'écran montrera.
 */
async function attendreFil(ruche, filtre, condition, quoi, patienceMs = 180_000) {
  const fin = Date.now() + patienceMs;
  let vue = null;
  while (Date.now() < fin) {
    vue = await demander(ruche.http, `/api/war-room?${new URLSearchParams(filtre)}&limite=500`, {
      headers: ruche.entetes,
    });
    if (condition(vue)) return vue;
    await patienter(250);
  }
  // Le fil ENTIER, borné : c'est lui qui dit pourquoi le chemin a bifurqué
  // (une relecture close sans avis nomme son motif, un refus sa raison).
  const fil = JSON.stringify(vue?.entrees ?? []).slice(0, 4_000);
  throw new Error(`jamais arrivé en ${patienceMs / 1000} s : ${quoi}\nfil : ${fil}`);
}

const aLeGenre =
  (genre, n = 1) =>
  (vue) =>
    (vue?.entrees ?? []).filter((e) => e.genre === genre).length >= n;

async function attendreConseilClos(ruche, sessionId, patienceMs = 240_000) {
  const fin = Date.now() + patienceMs;
  while (Date.now() < fin) {
    const session = await demander(ruche.http, `/api/conseil/${encodeURIComponent(sessionId)}`, {
      headers: ruche.entetes,
    });
    if (session?.etat === 'clos') return session;
    await patienter(500);
  }
  throw new Error(`le Conseil ${sessionId} n'est pas clos après ${patienceMs / 1000} s`);
}

/**
 * Joue le débat sur la ruche de laboratoire, relectrice comprise, et l'arrête.
 * Rend `{ projetId, conseils }` — `conseils[i].issue` dit comment chaque
 * Conseil s'est clos, puisque la démonstration ne le décide pas.
 */
export async function amorcerDebat(ruche, { verdicts }) {
  const json = { ...ruche.entetes, 'content-type': 'application/json' };
  const poster = (chemin, corps) =>
    demander(ruche.http, chemin, { method: 'POST', headers: json, body: JSON.stringify(corps) });
  const [contestee, muette] = Object.keys(verdicts);
  if (!contestee || !muette)
    throw new Error('la relectrice doit contester une tâche et en taire une');

  const relectrice = await ruche.ajouterRelectrice();
  try {
    const projet = await poster('/api/projects', PROJET_DEBAT);
    const creer = async (title, prompt) => {
      const [tache] = await poster(`/api/projects/${encodeURIComponent(projet.id)}/tasks`, {
        tasks: [{ title, prompt }],
      });
      const id = tache?.id;
      if (!id) throw new Error(`la tâche « ${title} » n'a pas été créée`);
      return id;
    };
    const revoir = (taskId, corps) =>
      poster(`/api/tasks/${encodeURIComponent(taskId)}/review`, corps);

    const t1 = await creer(
      contestee,
      'Refuser les montants négatifs et fixer la devise par défaut.',
    );
    await attendreFil(
      ruche,
      { taskId: t1 },
      aLeGenre('renvoi_refuse'),
      'la contestation sans renvoi',
    );

    const t2 = await creer(
      muette,
      'Arrondir les taxes au centime, montants à trois décimales compris.',
    );
    await attendreFil(
      ruche,
      { taskId: t2 },
      aLeGenre('contre_impossible'),
      'la relecture impossible',
    );

    const t3 = await creer(
      'Export CSV des paiements',
      'Exporter les paiements du mois au format CSV.',
    );
    await attendreFil(ruche, { taskId: t3 }, aLeGenre('contre_verdict'), 'la première relecture');
    await attendreTerminees(ruche);
    await revoir(t3, { state: 'rejected', raison: RAISON_REJET_DEMO });
    await attendreFil(
      ruche,
      { taskId: t3 },
      aLeGenre('contre_verdict', 2),
      'la relecture de la correction',
    );
    await attendreTerminees(ruche);
    await revoir(t3, { state: 'approved' });

    const conseils = [];
    for (const tranche of [true, false]) {
      const ouvert = await poster(`/api/projects/${encodeURIComponent(projet.id)}/conseil`, {
        question: QUESTION_DEBAT,
      });
      const clos = await attendreConseilClos(ruche, ouvert.id);
      if (tranche) {
        const piste = clos.danses?.[0] ?? null;
        await poster(`/api/conseil/${encodeURIComponent(clos.id)}/decision`, {
          propositionId: piste?.id ?? null,
          justification: piste
            ? 'Démonstration : la piste la mieux vérifiée, à confier à une tâche.'
            : 'Démonstration : aucune piste ne tient, on ne change rien pour l’instant.',
        });
      }
      conseils.push({ id: clos.id, issue: clos.issue, tranche });
      await attendreTerminees(ruche);
    }
    return { projetId: projet.id, conseils };
  } finally {
    await relectrice.arreter();
  }
}
