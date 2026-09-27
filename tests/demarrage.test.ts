// « Lancer la ruche » — la composition, éprouvée sans démarrer un serveur.
//
// ─── LE DÉFAUT QUE ÇA RETIRE ────────────────────────────────────────────────
//
// Faire tourner une ruche demandait TROIS terminaux, et l'écran final de
// l'installeur listait cinq commandes sans dire lesquelles vont ensemble.
// Quelqu'un qui n'en lance qu'une voit une ruche qui « ne fait rien » — sans
// nœud, aucune tâche n'est exécutée — ou un écran vide.
//
// ─── POURQUOI CE FICHIER PEUT EXISTER ───────────────────────────────────────
//
// Parce que `demarrage.ts` ne lance rien : il CALCULE les commandes. La partie
// où l'on se trompe — un chemin, un ordre, un shim Windows — devient donc
// vérifiable sans ouvrir un port, depuis n'importe quelle plateforme.
//
// La garde qui compte est la dernière : les scripts visés doivent EXISTER sur
// le disque. Un chemin faux ne se voit qu'au `spawn`, par un ENOENT laconique
// noyé dans la sortie des processus qui, eux, ont démarré.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectAllAgents, detectBestAgent } from '../src/node-client/agent-detect.js';
import {
  DRAPEAU_UNE_OUVRIERE,
  ENTREES,
  type Piece,
  type PlanOuvrieres,
  SCRIPTS,
  annonceOuvrieres,
  decouperLignes,
  entreesAbsentes,
  largeurEtiquettes,
  pieces,
  planOuvrieres,
  portAnnonce,
  prefixe,
  reliquat,
  veutOuvriere,
  voeuDepuisArgv,
} from '../src/shared/demarrage.js';
import { PORT_PAR_DEFAUT } from '../src/shared/port.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const NODE = '/usr/bin/node';

describe('CE QU’ON LANCE, ET DANS QUEL ORDRE', () => {
  it('SANS DRAPEAU : les trois pièces — c’est tout l’objet de la commande', () => {
    const noms = pieces(NODE).map((p) => p.nom);
    expect(noms).toHaveLength(3);
    expect(noms).toContain('reine');
    expect(noms).toContain('ouvrière');
    expect(noms).toContain('écran');
  });

  it('LA REINE DÉMARRE AVANT L’OUVRIÈRE', () => {
    // ─── LA SEULE SUBTILITÉ DE CE MODULE ───────────────────────────────────
    //
    // Le nœud se connecte au hub. Le lancer en premier lui fait manquer sa
    // cible : il reconnecte, donc ça marche — mais l'humain lit une erreur de
    // connexion au démarrage de sa toute première ruche, ce qui est le pire
    // moment possible pour en voir une.
    const noms = pieces(NODE).map((p) => p.nom);
    expect(noms.indexOf('reine')).toBeLessThan(noms.indexOf('ouvrière'));
  });

  it('AUCUNE PIÈCE NE PASSE PAR `npm`, `npx` NI UN `.cmd`', () => {
    // ─── LE DÉFAUT QUI A DÉJÀ MORDU DEUX FOIS ──────────────────────────────
    //
    // Sous Windows `npm` est `npm.cmd`, et `spawn(…, { shell: false })` ne sait
    // pas lancer un `.cmd`. C'est le § 6.2 du journal. Viser le script réel et
    // lancer Node dessus est PLUS strict qu'autoriser un interpréteur, pas
    // moins : on sait quel fichier s'exécute.
    for (const p of pieces(NODE)) {
      expect(p.bin, `${p.nom} doit être lancé par le Node courant`).toBe(NODE);
      const tout = [p.bin, ...p.argv].join(' ');
      expect(tout, `${p.nom} ne doit pas viser un shim`).not.toMatch(/\.cmd\b|\bnpx\b|\bnpm run\b/);
    }
  });

  it('LA REINE ET L’OUVRIÈRE TOURNENT DANS UN SEUL PROCESSUS — pas derrière le CLI de tsx', () => {
    // Le CLI de tsx lance un second Node et lui relaie les signaux en
    // n'attendant que 30 ms l'accusé de l'enfant avant un SIGKILL (sortie 130).
    // Mesuré sur un runner macOS de la CI : la Reine, qui avait reçu son SIGINT
    // et commencé à s'arrêter proprement, a été tuée net. Le lanceur maison
    // enregistre tsx DANS le processus : le signal va à qui sait s'arrêter.
    for (const p of pieces(NODE).filter((x) => x.nom !== 'écran')) {
      expect(p.argv[0], p.nom).toBe(SCRIPTS.lanceur);
      expect(p.argv.join(' '), p.nom).not.toMatch(/tsx[\\/]dist[\\/]cli/);
    }
  });

  it('L’ARGV EST UN TABLEAU — c’est ce qui fait tenir `shell: false`', () => {
    // Un chemin qui contient une espace — `C:\Users\Jean Dupont\…` est banal
    // sous Windows — traverserait un interpréteur en DEUX arguments.
    for (const p of pieces(NODE)) {
      expect(Array.isArray(p.argv)).toBe(true);
      for (const a of p.argv) expect(typeof a).toBe('string');
    }
  });

  it('chaque pièce DIT ce qu’elle fait', () => {
    // Trois processus dans un terminal sans rien qui les présente, c'est trois
    // sources de bruit. Le rôle est ce qui les rend lisibles.
    for (const p of pieces(NODE)) expect(p.role.length, p.nom).toBeGreaterThan(10);
  });
});

describe('LA BANNIÈRE ANNONCE LE PORT OÙ LA RUCHE ÉCOUTE VRAIMENT', () => {
  // ─── LE DÉFAUT, MESURÉ SUR UNE RUCHE VIVANTE ───────────────────────────────
  //
  // Le rôle de la Reine portait `http://127.0.0.1:7777` ÉCRIT EN DUR. Sur un
  // `.env` qui dit autre chose, la sortie de démarrage se contredisait
  // elle-même, à cinq lignes d'intervalle :
  //
  //     reine  projets, tâches, journal · http://127.0.0.1:7777   ← la bannière
  //     reine │    Dashboard : http://127.0.0.1:7911              ← la ruche
  //
  // Mesuré, `.env` à `HIVE_PORT=7911` : `:7911` rend 200, `:7777` refuse la
  // connexion. La PREMIÈRE ligne — la grande, celle qu'on lit — était la
  // fausse. Un lien mort au démarrage envoie chercher une panne inexistante ;
  // c'est le même défaut que le docteur qui se trompait de patient, et pour
  // lequel `portDepuisEnv` avait justement été écrit.
  //
  // La règle vit désormais à un seul endroit, et la bannière la LIT.

  it('LE PORT ANNONCÉ EST CELUI DU `.env`, PAS 7777 EN DUR', () => {
    const reine = (port?: number) => pieces(NODE, {}, port).find((p) => p.nom === 'reine');
    expect(reine(7911)?.role, 'la bannière annonce un port qu’elle n’écoute pas').toContain(
      ':7911',
    );
    expect(reine(7911)?.role, 'le port codé en dur survit').not.toContain('7777');
  });

  it('sans rien de demandé, c’est le port par défaut — et il est NOMMÉ', () => {
    // Le défaut n'est pas « 7777 partout » : c'est `PORT_PAR_DEFAUT`, la même
    // constante que lit la ruche. Les deux ne peuvent plus diverger.
    expect(pieces(NODE).find((p) => p.nom === 'reine')?.role).toContain(`:${PORT_PAR_DEFAUT}`);
  });

  it('L’ENVIRONNEMENT PRIME SUR LE FICHIER — la règle de la ruche, pas une autre', () => {
    // ─── CE QUI SE PASSERAIT SI ON LES INVERSAIT ─────────────────────────────
    //
    // La ruche lit son `.env` par `process.loadEnvFile`, qui — MESURÉ, pas
    // supposé — n'écrase JAMAIS une variable déjà posée dans l'environnement.
    // Un `HIVE_PORT=8080 npm run ruche` sur un `.env` qui dit 7911 fait donc
    // écouter la ruche sur 8080.
    //
    // La bannière doit trancher pareil. Inversée, elle annoncerait 7911 pendant
    // que la ruche écoute sur 8080 — le défaut d'origine, déplacé d'un cran et
    // devenu invisible : il ne se voit plus qu'en posant la variable à la main.
    expect(portAnnonce({ HIVE_PORT: '7911' }, { HIVE_PORT: '8080' })).toBe(8080);
    expect(portAnnonce({ HIVE_PORT: '7911' }, {})).toBe(7911);
    expect(portAnnonce({}, {})).toBe(PORT_PAR_DEFAUT);
  });

  it('PORT 0 : on n’invente pas une adresse que personne ne connaît encore', () => {
    // ─── LE PIÈGE DE LA CORRECTION ELLE-MÊME ─────────────────────────────────
    //
    // `HIVE_PORT=0` est accepté EXPRÈS — c'est « tire-m'en un au hasard », et
    // les bancs de la ruche s'en servent. Passer ce zéro tel quel au gabarit
    // aurait rendu `http://127.0.0.1:0` : un lien mort, remplaçant l'autre.
    //
    // La Reine, elle, annonce son vrai port dès qu'elle l'a. La bannière dit
    // donc d'attendre plutôt que de mentir plus discrètement.
    const reine0 = pieces(NODE, {}, 0).find((p) => p.nom === 'reine');
    expect(reine0?.role, 'la bannière annonce le port 0 comme une adresse').not.toContain(':0');
    expect(reine0?.role).toContain('annoncée au démarrage');
  });

  it('un `.env` illisible ou absurde ne DÉPLACE pas la ruche en silence', () => {
    // `portDepuisEnv` porte déjà cette garde et elle est éprouvée chez elle. Ce
    // qu'on tient ici, c'est que la bannière PASSE PAR elle plutôt que de
    // refaire un `Number()` de son côté — la divergence exacte qui avait fait
    // mentir le docteur.
    expect(portAnnonce({ HIVE_PORT: '' }, {})).toBe(PORT_PAR_DEFAUT);
    expect(portAnnonce({ HIVE_PORT: '7911abc' }, {})).toBe(PORT_PAR_DEFAUT);
    expect(portAnnonce({ HIVE_PORT: '99999' }, {})).toBe(PORT_PAR_DEFAUT);
  });
});

describe('LES DRAPEAUX RETIRENT, JAMAIS N’AJOUTENT', () => {
  const noms = (argv: string[]): string[] => pieces(NODE, voeuDepuisArgv(argv)).map((p) => p.nom);

  it('`--sans-ecran` : le cas d’un serveur', () => {
    expect(noms(['--sans-ecran'])).toEqual(['reine', 'ouvrière']);
  });

  it('`--sans-noeud` : observer sans exécuter', () => {
    expect(noms(['--sans-noeud'])).toEqual(['reine', 'écran']);
  });

  it('`--ecran-seul` : le hub tourne déjà ailleurs', () => {
    expect(noms(['--ecran-seul'])).toEqual(['écran']);
  });

  it('un drapeau inconnu ne retire RIEN — il ne mutile pas en silence', () => {
    // Une faute de frappe qui retirerait le nœud donnerait une ruche qui
    // n'exécute rien, sans le dire. Le défaut « tout » est le seul sûr.
    expect(noms(['--sans-ecrans'])).toHaveLength(3);
    expect(noms([])).toHaveLength(3);
  });
});

describe('LES CHEMINS VISÉS EXISTENT VRAIMENT', () => {
  it('LES SCRIPTS DES OUTILS SONT SUR LE DISQUE', () => {
    // ─── LA GARDE QUI PORTE LE FICHIER ─────────────────────────────────────
    //
    // Le jour où `tsx` ou `vite` change son point d'entrée, ce test rougit ici,
    // en une seconde. Sans lui, le défaut n'apparaît qu'au `spawn` d'un
    // utilisateur, par un ENOENT noyé dans la sortie des processus qui, eux,
    // ont démarré.
    for (const [nom, rel] of Object.entries(SCRIPTS)) {
      expect(existsSync(path.join(RACINE, rel)), `${nom} : ${rel} est introuvable`).toBe(true);
    }
  });

  it('LES POINTS D’ENTRÉE DE LA RUCHE AUSSI', () => {
    for (const [nom, rel] of Object.entries(ENTREES)) {
      expect(existsSync(path.join(RACINE, rel)), `${nom} : ${rel} est introuvable`).toBe(true);
    }
  });

  it('les chemins sont RELATIFS — le lanceur fixe le `cwd`', () => {
    // Un chemin absolu calculé ici serait celui de la machine qui a écrit le
    // module, pas celle qui l'exécute.
    for (const rel of [...Object.values(SCRIPTS), ...Object.values(ENTREES)]) {
      expect(path.isAbsolute(rel), rel).toBe(false);
    }
  });
});

describe('LE PRÉFIXAGE DE LA SORTIE', () => {
  it('ALIGNE les étiquettes — c’est ce qui permet de suivre une colonne', () => {
    const liste = pieces(NODE);
    const l = largeurEtiquettes(liste);
    const largeurs = liste.map((p) => [...prefixe(p.nom, l)].length);
    expect(new Set(largeurs).size, 'toutes les étiquettes doivent faire la même largeur').toBe(1);
  });

  it('compte les POINTS DE CODE, pas les unités UTF-16', () => {
    // « ouvrière » porte un accent. Compter en unités UTF-16 déborderait sur un
    // nom contenant un caractère hors du plan de base, et l'alignement — la
    // seule raison d'être de cette fonction — sauterait.
    expect(largeurEtiquettes([{ nom: 'écran', bin: 'x', argv: [], role: 'r' }])).toBe(5);
    expect(largeurEtiquettes([{ nom: 'ouvrière', bin: 'x', argv: [], role: 'r' }])).toBe(8);
  });

  it('une liste vide ne casse pas le calcul', () => {
    expect(largeurEtiquettes([])).toBe(0);
  });
});

describe('LES DRAPEAUX SE CUMULENT — ils retirent, ils n’aiguillent pas', () => {
  // ─── LE DÉFAUT QUE L'AUDIT A TROUVÉ ────────────────────────────────────────
  //
  // `voeuDepuisArgv` était un aiguillage à retours successifs. Les deux
  // drapeaux documentés côte à côte dans l'en-tête de `scripts/ruche.mjs` —
  // la combinaison naturelle pour « la Reine SEULE » — rendaient au PREMIER
  // testé, et l'OUVRIÈRE démarrait quand même.
  //
  // Ce n'est pas un détail d'ergonomie : l'ouvrière est la pièce qui exécute du
  // code avec votre agent, sur votre machine. Elle démarrait alors qu'on venait
  // d'écrire, explicitement, qu'elle ne devait pas.

  it('« --sans-ecran --sans-noeud » ne laisse QUE la Reine', () => {
    const liste = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-ecran', '--sans-noeud']));
    expect(liste.map((p) => p.nom)).toEqual(['reine']);
  });

  it('l’ordre des drapeaux ne change rien', () => {
    // C'était toute la faute : le premier testé gagnait.
    const a = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-noeud', '--sans-ecran']));
    const b = pieces('/usr/bin/node', voeuDepuisArgv(['--sans-ecran', '--sans-noeud']));
    expect(a.map((p) => p.nom)).toEqual(b.map((p) => p.nom));
  });

  it('chacun seul retire bien SA pièce, et elle seule', () => {
    expect(pieces('/n', voeuDepuisArgv(['--sans-ecran'])).map((p) => p.nom)).toEqual([
      'reine',
      'ouvrière',
    ]);
    expect(pieces('/n', voeuDepuisArgv(['--sans-noeud'])).map((p) => p.nom)).toEqual([
      'reine',
      'écran',
    ]);
  });

  it('sans drapeau, les trois pièces démarrent', () => {
    expect(pieces('/n', voeuDepuisArgv([])).map((p) => p.nom)).toEqual([
      'reine',
      'ouvrière',
      'écran',
    ]);
  });

  it('« --ecran-seul » reste le seul drapeau qui DÉSIGNE au lieu de retirer', () => {
    // Il ne se cumule pas avec les autres, et son nom le dit.
    expect(pieces('/n', voeuDepuisArgv(['--ecran-seul'])).map((p) => p.nom)).toEqual(['écran']);
    expect(
      pieces('/n', voeuDepuisArgv(['--sans-noeud', '--ecran-seul'])).map((p) => p.nom),
    ).toEqual(['écran']);
  });
});

// ─── CE QUI VIVAIT DANS LE LANCEUR, ET Y ÉTAIT NU ──────────────────────────────
//
// Deux décisions dormaient dans `scripts/ruche.mjs`, entre un `spawn` et un
// gestionnaire d'événement. Le balayage loupe les a désignées, et les trois
// bancs du lanceur — qui lancent pourtant le VRAI fichier — sont restés verts
// sur chacune : mesuré, verdicts affichés.
//
// Ils ne pouvaient pas les voir. Le premier cas demande un dépôt SANS
// dépendances, qu'on ne peut pas fabriquer sans désinstaller le dépôt sous les
// pieds du banc ; le second demande un enfant qui meurt en écrivant sa dernière
// phrase SANS retour à la ligne, alors que tous leurs marqueurs en portent un.
//
// « Hors d'atteinte du banc » est presque toujours « au mauvais endroit »
// (§ 2 quaterdecies). Sorties d'ici, les deux s'éprouvent pour rien.

describe('CE QUI MANQUE SE DIT AVANT DE LANCER', () => {
  const piece = (nom: string, entree: string): Piece => ({
    nom,
    bin: '/n',
    argv: [entree],
    role: 'pour le banc',
  });

  it('nomme les entrées absentes, et ELLES SEULES', () => {
    const liste = [piece('reine', 'a.js'), piece('ouvrière', 'b.js'), piece('écran', 'c.js')];
    // La présence passe en argument : le banc décide quel monde il éprouve.
    expect(entreesAbsentes(liste, (f) => f !== 'b.js')).toEqual(['b.js']);
  });

  it('un dépôt complet ne fait accuser PERSONNE', () => {
    // Le faux positif serait pire que le silence : il enverrait réinstaller un
    // dépôt qui va bien, à chaque démarrage.
    const liste = [piece('reine', 'a.js'), piece('ouvrière', 'b.js')];
    expect(entreesAbsentes(liste, () => true)).toEqual([]);
  });

  it('un dépôt SANS DÉPENDANCES les nomme toutes', () => {
    // C'est le premier écran d'une copie fraîche : le contrôle doit rendre la
    // liste entière, pas la première trouvée.
    const liste = [piece('reine', 'a.js'), piece('ouvrière', 'b.js'), piece('écran', 'c.js')];
    expect(entreesAbsentes(liste, () => false)).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('une pièce SANS entrée n’est pas comptée comme absente', () => {
    // `argv[0]` peut manquer ; ce n'est pas un fichier introuvable, c'est
    // l'absence de fichier à chercher. Les confondre ferait accuser le disque
    // d'une pièce qui ne demandait rien.
    const liste: Piece[] = [{ nom: 'vide', bin: '/n', argv: [], role: 'pour le banc' }];
    expect(entreesAbsentes(liste, () => false)).toEqual([]);
  });

  it('un lanceur PARTAGÉ par plusieurs ouvrières n’est nommé qu’une fois', () => {
    // Trois ouvrières, un seul `scripts/lancer.mjs` : le message qui dit quoi
    // réinstaller ne doit pas le répéter par famille.
    const liste = [piece('reine', 'l.mjs'), piece('ouvrière a', 'l.mjs'), piece('écran', 'v.js')];
    expect(entreesAbsentes(liste, () => false)).toEqual(['l.mjs', 'v.js']);
  });
});

describe('LE PRÉFIXAGE PAR LIGNE, MORCEAU PAR MORCEAU', () => {
  it('ne rend que les lignes TERMINÉES, et garde le début de la suivante', () => {
    expect(decouperLignes('', 'une\ndeux\ntro')).toEqual({
      lignes: ['une', 'deux'],
      reste: 'tro',
    });
  });

  it('recolle un morceau au tampon qui le précède', () => {
    // Le cas qui casse un flux mal recollé : la ligne arrive en DEUX bouts.
    expect(decouperLignes('tro', 'is\n')).toEqual({ lignes: ['trois'], reste: '' });
  });

  it('un morceau sans aucun `\\n` ne rend RIEN et grossit le tampon', () => {
    // Rendre ici couperait la ligne en deux dans le terminal, avec une étiquette
    // au milieu — exactement ce que le tampon existe pour empêcher.
    expect(decouperLignes('a', 'bc')).toEqual({ lignes: [], reste: 'abc' });
  });

  it('LA DERNIÈRE PHRASE D’UN MOURANT SORT, MÊME SANS RETOUR À LA LIGNE', () => {
    // ─── LA LIGNE QU'ON PERDAIT EST CELLE QU'ON CHERCHE ──────────────────
    //
    // Un processus qui meurt écrit souvent sa dernière phrase sans `\n` : une
    // trace tronquée, un « command not found », un prompt resté ouvert. Elle
    // dort dans le tampon, et c'est précisément celle qu'on lit pour comprendre.
    expect(reliquat('Error: EADDRINUSE')).toEqual(['Error: EADDRINUSE']);
  });

  it('un flux qui se termine PROPREMENT n’imprime pas d’étiquette toute seule', () => {
    // L'autre moitié de la même garde. Sans elle, chaque processus laisserait
    // une ligne vide préfixée derrière lui — trois pièces, trois faux départs.
    expect(reliquat('')).toEqual([]);
  });
});

// ─── UNE OUVRIÈRE PAR AGENT DÉTECTÉ ────────────────────────────────────────────
//
// Une machine qui porte Claude Code, Codex et Cursor lançait UNE ouvrière :
// aucune relecture croisée n'était possible (`choisirCritiques` exige un autre
// modèle en ligne), donc aucun verdict, donc un Aiguillage qui n'apprenait
// rien. Ces bancs tiennent la composition qui l'ouvre — et les trois portes qui
// la referment.

/** Une sonde qui ne répond « présent » que pour ces binaires. */
const sondeDe =
  (...presents: string[]) =>
  async (argv: readonly string[]): Promise<boolean> =>
    presents.includes(path.basename(argv[0] ?? ''));

/** Le plan d'une machine qui porte ces agents, sous cet environnement. */
async function planPour(
  agents: readonly string[],
  env: NodeJS.ProcessEnv = {},
  argv: readonly string[] = [],
): Promise<PlanOuvrieres> {
  return planOuvrieres({ argv, env, hote: 'poste', detecter: async () => agents });
}

/** Les ouvrières d'un plan par agent — le banc échoue s'il n'en est pas un. */
function ouvrieresDe(plan: PlanOuvrieres) {
  if (plan.mode !== 'par-agent') throw new Error(`une seule ouvrière (${plan.motif})`);
  return plan.ouvrieres;
}

describe('UNE OUVRIÈRE PAR AGENT DÉTECTÉ — la relecture croisée sur le chemin par défaut', () => {
  it('DEUX FAMILLES RÉELLES : une ouvrière chacune, SA famille épinglée, une tâche à la fois', async () => {
    const ouvrieres = ouvrieresDe(await planPour(['claude-code', 'codex', 'cursor', 'shell']));
    expect(ouvrieres.map((o) => o.agent)).toEqual(['claude-code', 'codex', 'cursor']);
    for (const o of ouvrieres) {
      // Épinglée : deux ouvrières qui détecteraient chacune pour soi
      // retiendraient la même famille, et l'essaim ne croiserait rien.
      expect(o.env.HIVE_AGENT, o.agent).toBe(o.agent);
      expect(o.env.HIVE_MAX_CONCURRENCY, o.agent).toBe('1');
    }
  });

  it('LE SHELL SIMULÉ N’EST PAS UNE FAMILLE — une famille réelle et lui, c’est UNE ouvrière', async () => {
    // Le shell ne relit personne et ne produit que de faux diffs : lui donner
    // une ouvrière annoncerait une relecture croisée qui n'aura jamais lieu.
    expect(await planPour(['claude-code', 'shell'])).toEqual({ mode: 'une', motif: 'une-famille' });
    expect(await planPour(['shell'])).toEqual({ mode: 'une', motif: 'une-famille' });
  });

  it('LES TROIS PORTES DE SORTIE — et aucune ne sonde les binaires', async () => {
    // Quand l'opérateur a répondu, lancer un `--version` par agent connu ne
    // sert à rien : la sonde n'est même pas appelée.
    const cas: Array<[NodeJS.ProcessEnv, string[], string]> = [
      [{ HIVE_AGENT: 'codex' }, [], 'agent-fixe'],
      [{ HIVE_AGENT_CMD: 'aider --yes' }, [], 'commande'],
      [{}, [DRAPEAU_UNE_OUVRIERE], 'drapeau'],
    ];
    for (const [env, argv, motif] of cas) {
      let sondee = false;
      const plan = await planOuvrieres({
        argv,
        env,
        hote: 'poste',
        detecter: async () => {
          sondee = true;
          return ['claude-code', 'codex'];
        },
      });
      expect(plan, motif).toEqual({ mode: 'une', motif });
      expect(sondee, `${motif} : la sonde a tourné pour rien`).toBe(false);
    }
  });

  it('UN `HIVE_AGENT` VIDE N’EST PAS UN CHOIX — il ne ferme pas l’essaim', async () => {
    // `HIVE_AGENT=` laissé vide dans un `.env` est l'absence de réponse, comme
    // le lit le nœud lui-même (`resoudreAgentAuDemarrage` fait `.trim()`).
    const plan = await planPour(['claude-code', 'codex'], { HIVE_AGENT: '  ', HIVE_AGENT_CMD: '' });
    expect(plan.mode).toBe('par-agent');
  });

  it('LA PREMIÈRE OUVRIÈRE EST CELLE QUI TOURNAIT SEULE — même agent que la détection hors TTY', async () => {
    // L'identité d'un nœud vit dans son dossier ; la première ouvrière garde
    // nom et dossier. Elle doit donc faire tourner l'agent que le nœud unique
    // aurait retenu, sinon l'historique de Claude passerait à Codex.
    const sonde = sondeDe('codex', 'claude');
    const env = { HOME: '' } as NodeJS.ProcessEnv;
    const plan = await planOuvrieres({
      argv: [],
      env,
      hote: 'poste',
      detecter: () => detectAllAgents(env, sonde, 'linux', () => false),
    });
    const seul = await detectBestAgent(env, sonde, 'linux', () => false);
    expect(ouvrieresDe(plan)[0]?.agent).toBe(seul.agent);
  });

  it('LA PREMIÈRE GARDE SON IDENTITÉ ; les ajoutées prennent `<nom>-<famille>`', async () => {
    const [premiere, ...ajoutees] = ouvrieresDe(await planPour(['claude-code', 'codex', 'cursor']));
    // Ni nom, ni dossier, ni modèles : exactement ceux d'hier. Un nom neuf,
    // c'était un fantôme « hors ligne » et une réputation repartie de zéro.
    expect(premiere?.ajoutee).toBe(false);
    expect(Object.keys(premiere?.env ?? {}).sort()).toEqual(['HIVE_AGENT', 'HIVE_MAX_CONCURRENCY']);

    expect(ajoutees.map((o) => o.ajoutee)).toEqual([true, true]);
    // Le nom que le nœud se donnerait (la machine, ici), suffixé : deux
    // ajoutées ne peuvent pas se confondre, ni se confondre avec la première.
    expect(ajoutees.map((o) => o.env.HIVE_NODE_NAME)).toEqual(['poste-codex', 'poste-cursor']);
    // Sans `HIVE_WORKDIR`, le nœud déduit son dossier de son NOM : des noms
    // distincts suffisent, et le poser ici recopierait la règle du nœud.
    for (const o of ajoutees) expect(o.env.HIVE_WORKDIR, o.agent).toBeUndefined();
  });

  it('`HIVE_NODE_NAME` fixé : c’est LUI la base, pas la machine', async () => {
    const ouvrieres = ouvrieresDe(
      await planPour(['claude-code', 'codex'], { HIVE_NODE_NAME: 'atelier' }),
    );
    expect(ouvrieres[1]?.env.HIVE_NODE_NAME).toBe('atelier-codex');
  });

  it('`HIVE_WORKDIR` fixé : les ajoutées travaillent DEDANS, jamais à côté', async () => {
    // À côté, le `HIVE_WORKDIR=./.hive-work` de `.env.example` donnait un
    // `.hive-work-codex` à la racine du dépôt : hors de `.gitignore`, hors de
    // ce que la désinstallation relève — une identité de nœud laissée derrière.
    // Dedans, tout le travail de Hive reste là où l'opérateur l'a mis.
    const ouvrieres = ouvrieresDe(
      await planPour(['claude-code', 'codex'], { HIVE_WORKDIR: path.join('.', '.hive-work') }),
    );
    expect(ouvrieres[1]?.env.HIVE_WORKDIR).toBe(path.join('.hive-work', 'codex'));
    expect(ouvrieres[0]?.env.HIVE_WORKDIR, 'la première garde le sien').toBeUndefined();
  });

  it('`HIVE_MODELES` NE VA QU’À LA PREMIÈRE — et les ajoutées le reçoivent VIDE, pas absent', async () => {
    // Les modèles déclarés sont ceux de l'agent qui tournait seul. Transmis à
    // Codex, `claude-opus-5` finirait en `codex --model claude-opus-5`.
    //
    // VIDE et non absent : `loadEnvFile` n'écrase jamais une variable
    // présente, même vide — une variable ABSENTE, il la remplirait depuis le
    // `.env`, et les modèles de Claude reviendraient à Codex par la fenêtre.
    const plan = await planPour(['claude-code', 'codex'], { HIVE_MODELES: 'claude-opus-5' });
    const [premiere, codex] = ouvrieresDe(plan);
    expect(premiere?.env).not.toHaveProperty('HIVE_MODELES');
    expect(codex?.env).toHaveProperty('HIVE_MODELES', '');
    expect(plan.mode === 'par-agent' && plan.modelesDeclaresPar).toBe('claude-code');

    const sans = await planPour(['claude-code', 'codex']);
    expect(sans.mode === 'par-agent' && sans.modelesDeclaresPar).toBeNull();
  });
});

describe('UNE OUVRIÈRE PAR AGENT — ce que le lanceur en fait', () => {
  it('UNE PIÈCE PAR OUVRIÈRE, nommée par sa famille, entre la Reine et l’écran', async () => {
    const plan = await planPour(['claude-code', 'codex']);
    const liste = pieces(NODE, {}, PORT_PAR_DEFAUT, plan);
    expect(liste.map((p) => p.nom)).toEqual([
      'reine',
      'ouvrière claude-code',
      'ouvrière codex',
      'écran',
    ]);
    for (const p of liste.filter((x) => x.nom.startsWith('ouvrière'))) {
      expect(p.argv, p.nom).toEqual([SCRIPTS.lanceur, ENTREES.noeud]);
      expect(p.env?.HIVE_AGENT, `${p.nom} : sa famille ne lui parvient pas`).toBe(
        p.nom.replace('ouvrière ', ''),
      );
    }
    expect(liste.find((p) => p.nom === 'ouvrière codex')?.role).toContain('Codex');
  });

  it('SEULE L’AJOUTÉE EST FACULTATIVE — la Reine, la première, l’écran emportent toujours la ruche', async () => {
    const liste = pieces(NODE, {}, PORT_PAR_DEFAUT, await planPour(['claude-code', 'codex']));
    expect(liste.filter((p) => p.facultative === true).map((p) => p.nom)).toEqual([
      'ouvrière codex',
    ]);
  });

  it('UNE OUVRIÈRE, c’est la pièce d’avant — sans environnement posé', async () => {
    // L'ouvrière unique choisit son agent elle-même, comme hier : rien ne doit
    // s'être glissé dans son environnement.
    const liste = pieces(NODE, {}, PORT_PAR_DEFAUT, await planPour(['claude-code']));
    const ouvriere = liste.find((p) => p.nom === 'ouvrière');
    expect(ouvriere).toBeDefined();
    expect(ouvriere?.env).toBeUndefined();
    expect(ouvriere?.facultative).toBeUndefined();
  });

  it('`--sans-noeud` L’EMPORTE SUR LE PLAN — et le lanceur ne sonde même pas', async () => {
    const plan = await planPour(['claude-code', 'codex']);
    const voeu = voeuDepuisArgv(['--sans-noeud']);
    expect(pieces(NODE, voeu, PORT_PAR_DEFAUT, plan).map((p) => p.nom)).toEqual(['reine', 'écran']);
    expect(veutOuvriere(voeu)).toBe(false);
    expect(veutOuvriere(voeuDepuisArgv(['--ecran-seul']))).toBe(false);
    expect(veutOuvriere(voeuDepuisArgv([]))).toBe(true);
    expect(veutOuvriere(voeuDepuisArgv(['--sans-ecran']))).toBe(true);
  });

  it('LES ÉTIQUETTES S’ALIGNENT sur la plus longue famille', async () => {
    const liste = pieces(NODE, {}, PORT_PAR_DEFAUT, await planPour(['claude-code', 'codex']));
    const l = largeurEtiquettes(liste);
    expect(new Set(liste.map((p) => [...prefixe(p.nom, l)].length)).size).toBe(1);
  });

  it('LA LIGNE QUI LE DIT : les familles, le prix, et comment n’en garder qu’une', async () => {
    const [ligne, ...reste] = annonceOuvrieres(await planPour(['claude-code', 'codex']));
    expect(ligne).toContain('Claude Code, Codex');
    expect(ligne, 'au repos, rien ne se paie — et il faut le dire').toContain('aucun crédit');
    expect(ligne, 'la façon d’y renoncer').toContain(`npm run ruche -- ${DRAPEAU_UNE_OUVRIERE}`);
    expect(reste, 'sans HIVE_MODELES, une seule ligne').toEqual([]);

    const avecModeles = annonceOuvrieres(
      await planPour(['claude-code', 'codex'], { HIVE_MODELES: 'claude-opus-5' }),
    );
    expect(avecModeles[1]).toContain('HIVE_MODELES ne vaut que pour Claude Code');
  });

  it('UNE SEULE OUVRIÈRE NE S’ANNONCE PAS — c’est ce que la ruche faisait déjà', async () => {
    expect(annonceOuvrieres(await planPour(['claude-code']))).toEqual([]);
    expect(
      annonceOuvrieres(await planPour(['claude-code', 'codex'], {}, [DRAPEAU_UNE_OUVRIERE])),
    ).toEqual([]);
    expect(annonceOuvrieres(undefined)).toEqual([]);
  });
});
