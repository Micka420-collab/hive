// Ce que « lancer la ruche » veut dire — MODULE PUR.
//
// (Nommé `demarrage` et non `essaim` : `src/orchestrator/essaim.ts` existe déjà
// et parle d'autre chose — le runner d'autonomie. Deux fichiers homonymes dans
// un même dépôt sont deux occasions de lire le mauvais.)
//
// ─── LE DÉFAUT QUE CE MODULE RETIRE ─────────────────────────────────────────
//
// Faire tourner une ruche demandait TROIS terminaux, et l'écran final de
// l'installeur listait cinq commandes sans dire lesquelles vont ensemble :
//
//     npm run dev              l'orchestrateur
//     npm run node             le nœud, qui exécute vraiment
//     npm run dev:dashboard    l'écran, sur un autre port
//
// Quelqu'un qui n'en lance qu'une voit une ruche qui « ne fait rien » — sans
// nœud, aucune tâche n'est exécutée — ou un écran vide. Les trois pièces sont
// nécessaires et rien ne le disait.
//
// ─── POURQUOI ON NE PASSE PAS PAR `npm` ─────────────────────────────────────
//
// Sous Windows, `npm` est `npm.cmd`, et `spawn(…, { shell: false })` ne sait
// pas lancer un `.cmd` — c'est le § 6.2 du journal, et le même défaut a déjà
// mordu deux fois dans ce dépôt. On vise donc le SCRIPT RÉEL de chaque outil et
// on lance Node dessus, exactement comme `agent-windows.ts` le fait pour Claude
// Code.
//
// C'est plus strict que d'autoriser un interpréteur, pas moins : on sait
// précisément quel fichier s'exécute.
//
// ─── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
//
// Il ne lance rien. Il CALCULE les trois commandes. C'est ce qui rend la
// composition — donc la partie où l'on se trompe de chemin ou d'ordre —
// vérifiable sans démarrer un serveur, sur les trois plateformes, depuis
// n'importe laquelle.
//
// ─── UNE OUVRIÈRE PAR AGENT, ET POURQUOI C'EST LE DÉFAUT ────────────────────
//
// Un nœud fait tourner UN agent. La ruche d'une commande ne lançait donc
// qu'une famille — Claude Code, sur une machine qui porte aussi Codex et
// Cursor — et la contre-expertise, qui exige un modèle DIFFÉRENT en ligne
// (`choisirCritiques`), rendait son refus à chaque production : aucune
// relecture croisée, aucun verdict, et un Aiguillage qui n'apprend jamais
// rien, puisqu'il n'apprend QUE des verdicts. Ce qui distingue une ruche d'un
// agent seul était éteint sur le chemin par défaut.
//
// Dès que la machine porte deux familles RÉELLES ou plus, `planOuvrieres`
// compose donc une ouvrière par famille. Sa documentation dit ce que chacune
// reçoit, et les trois façons de revenir à une seule.

import path from 'node:path';
import { libelleAgent } from './agent-libelle.js';
import { estAgentSimule } from './agent-production.js';
import { RELECTEURS_PAR_PRODUCTION } from './contre-expertise.js';
import { type AdresseRuche, adresseLocale, PORT_PAR_DEFAUT, portDepuisEnv } from './port.js';

/** Un membre de l'essaim à démarrer. */
export interface Piece {
  /** Nom court affiché en tête de chaque ligne de sa sortie. */
  readonly nom: string;
  /** L'exécutable — toujours un vrai binaire, jamais un shim. */
  readonly bin: string;
  /** Ses arguments, en TABLEAU : rien n'est redécoupé par un interpréteur. */
  readonly argv: readonly string[];
  /** Ce qu'on en attend, dit à l'humain au démarrage. */
  readonly role: string;
  /**
   * Les variables posées pour CE processus, par-dessus l'environnement hérité.
   * Absent : il hérite tel quel — le cas de toute pièce qui n'est pas une
   * ouvrière de l'essaim par agent.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Vraie pour une ouvrière AJOUTÉE par l'essaim par agent : sa mort se dit,
   * et n'emporte pas la ruche (voir `OuvriereAgent.ajoutee`). Absente partout
   * ailleurs, où la règle du lanceur tient : la mort d'un seul emporte les
   * autres.
   */
  readonly facultative?: boolean;
  /**
   * Son lien à la Reine que CETTE ruche lance (`LienReine`). Absent : aucune
   * Reine n'est lancée ici, et la pièce démarre aussitôt avec ce qu'elle a.
   */
  readonly reine?: LienReine;
}

/**
 * Le lien d'une pièce à la Reine que la ruche lance.
 *
 *   · `annonce`   — c'est elle. Lancée avec un canal IPC, elle y dit son
 *                   adresse dès que son port est ouvert (`AnnonceReine`).
 *   · `HIVE_URL`  — une ouvrière. Elle ne démarre qu'à cette annonce, avec
 *                   l'URL WebSocket annoncée dans cette variable.
 *   · `HIVE_HTTP` — l'écran. De même, avec l'origine HTTP, que son proxy vise.
 */
export type LienReine = 'annonce' | 'HIVE_URL' | 'HIVE_HTTP';

/** Ce qu'on veut démarrer. Tout est facultatif : le défaut est « tout ». */
export interface Voeu {
  /** L'orchestrateur — la Reine, qui garde projets, tâches et journal. */
  readonly hub?: boolean;
  /** Le nœud, qui exécute réellement le travail avec votre agent. */
  readonly noeud?: boolean;
  /** L'écran de développement (Vite), sur son propre port. */
  readonly ecran?: boolean;
}

/**
 * Les scripts réels des outils, relatifs à la racine du dépôt.
 *
 * Écrits une fois ici plutôt que dispersés : le jour où `tsx` change de chemin
 * d'entrée, il y a UN endroit à corriger, et un test qui vérifie que ces
 * fichiers existent vraiment sur le disque.
 */
export const SCRIPTS = {
  /**
   * Le lanceur maison : il enregistre tsx DANS le processus, puis importe
   * l'entrée. C'était `node_modules/tsx/dist/cli.mjs`, qui lance un SECOND
   * processus Node et lui relaie les signaux — en n'attendant que 30 ms
   * l'accusé de réception de l'enfant avant de le tuer en SIGKILL et de sortir
   * en 130. Sous charge (mesuré sur un runner macOS de la CI), la Reine avait
   * reçu son SIGINT et commencé son arrêt propre (« SIGINT reçu, arrêt de
   * l'orchestrateur… ») quand elle a été tuée net. Un seul processus : le
   * signal va directement à celui qui sait s'arrêter.
   */
  lanceur: path.join('scripts', 'lancer.mjs'),
  vite: path.join('node_modules', 'vite', 'bin', 'vite.js'),
} as const;

/** Les points d'entrée de la ruche, relatifs à la racine du dépôt. */
export const ENTREES = {
  hub: path.join('src', 'orchestrator', 'main.ts'),
  noeud: path.join('src', 'node-client', 'main.ts'),
} as const;

/**
 * Les pièces à lancer, dans l'ordre où elles doivent démarrer.
 *
 * L'ORDRE COMPTE : le nœud se connecte au hub. Le lancer en premier lui fait
 * manquer sa cible, il reconnecte — ça marche, mais l'humain lit une erreur de
 * connexion au démarrage de sa toute première ruche, ce qui est le pire moment
 * pour en voir une.
 *
 * L'ordre de la liste ne suffisait pourtant pas : les trois `spawn` partaient
 * ensemble, et rien ne disait aux ouvrières OÙ la Reine écoutait. Quand la
 * ruche lance sa Reine, les pièces qui la rejoignent portent donc un
 * `LienReine` : le lanceur ne les démarre qu'à son annonce, avec l'adresse
 * qu'elle a réellement ouverte (`adresseAnnoncee`, `envDePiece`).
 *
 * `node` est `process.execPath` chez l'appelant : le Node qui tourne DÉJÀ. Pas
 * celui du PATH, qui peut être un autre — et pas un shim, donc lançable sans
 * interpréteur sur les trois plateformes.
 *
 * `plan` absent, ou `une` : l'ouvrière unique d'avant, qui choisit son agent
 * elle-même. `par-agent` : une ouvrière par famille, dans l'ordre du plan.
 */
export function pieces(
  noeud: string,
  voeu: Voeu = {},
  port: number = PORT_PAR_DEFAUT,
  plan?: PlanOuvrieres,
): Piece[] {
  const veut = (cle: keyof Voeu): boolean => voeuVeut(voeu, cle);
  // Une pièce ne rejoint la Reine que si CETTE ruche la lance. Sans elle
  // (`{ noeud: true }` seul), l'ouvrière garde son `HIVE_URL` : elle vise la
  // ruche que l'opérateur a désignée, et rien ne l'attend ici.
  const rejoint = (variable: 'HIVE_URL' | 'HIVE_HTTP'): { reine?: LienReine } =>
    veut('hub') ? { reine: variable } : {};

  const liste: Piece[] = [];
  if (veut('hub')) {
    liste.push({
      nom: 'reine',
      bin: noeud,
      argv: [SCRIPTS.lanceur, ENTREES.hub],
      reine: 'annonce',
      // Le port 0 veut dire « le système en choisira un » : personne ne le
      // connaît encore, pas même la Reine. Écrire `http://127.0.0.1:0` serait
      // remplacer un lien mort par un autre — on dit donc ce qu'on sait, à
      // savoir qu'il faut attendre deux lignes.
      role:
        port === 0
          ? 'projets, tâches, journal · adresse annoncée au démarrage'
          : `projets, tâches, journal · http://127.0.0.1:${port}`,
    });
  }
  if (veut('noeud') && plan?.mode === 'par-agent') {
    for (const o of plan.ouvrieres) {
      liste.push({
        nom: `ouvrière ${o.agent}`,
        bin: noeud,
        argv: [SCRIPTS.lanceur, ENTREES.noeud],
        role: `exécute le travail avec ${libelleAgent(o.agent)}`,
        env: o.env,
        ...(o.ajoutee ? { facultative: true } : {}),
        ...rejoint('HIVE_URL'),
      });
    }
  } else if (veut('noeud')) {
    liste.push({
      nom: 'ouvrière',
      bin: noeud,
      argv: [SCRIPTS.lanceur, ENTREES.noeud],
      role: 'exécute le travail avec votre agent',
      ...rejoint('HIVE_URL'),
    });
  }
  if (veut('ecran')) {
    liste.push({
      nom: 'écran',
      bin: noeud,
      argv: [SCRIPTS.vite, 'dashboard'],
      role: 'Mission Control · http://localhost:5173',
      ...rejoint('HIVE_HTTP'),
    });
  }
  return liste;
}

/**
 * Ce que la Reine dit à son lanceur, par le canal IPC, dès que son port est
 * ouvert.
 *
 * ─── LE DÉFAUT QUE CETTE ANNONCE RETIRE ─────────────────────────────────────
 *
 * Le lanceur ne disait rien de la Reine à ses ouvrières : elles visaient
 * `ws://localhost:7777/ws`, le défaut de `node-client/main.ts`. Mesuré sur une
 * ruche à `HIVE_PORT=40253` : la Reine en ligne sur :40253, l'ouvrière en
 * « connexion perdue — nouvel essai » sans fin. Aucune erreur — une ruche qui
 * a l'air de tourner et n'exécute rien ; et sur une machine qui porte une
 * autre ruche sur 7777, des ouvrières qui frappent chez elle. L'écran, lui,
 * relayait `/api` vers :7777 : une page qui s'affiche et dont chaque appel
 * échoue.
 *
 * ─── POURQUOI LA REINE LE DIT, AU LIEU QUE LE LANCEUR LE DEVINE ─────────────
 *
 * Le lanceur ne peut pas recalculer ce port : `HIVE_PORT=0` n'est connu que de
 * la Reine une fois ouvert, et un `HIVE_ENV_FILE` peut le poser là où le
 * lanceur ne lit pas. Le port réellement ouvert est un FAIT : il se consigne
 * là où il naît, et se lit là où l'on en a besoin.
 */
export interface AnnonceReine {
  readonly type: 'reine-en-ligne';
  /** L'hôte d'ÉCOUTE (`HIVE_HOST`) — pas forcément une adresse où se connecter. */
  readonly hote: string;
  /** Le port RÉELLEMENT ouvert : celui qu'a tiré le système quand on demandait 0. */
  readonly port: number;
}

/**
 * L'adresse, vue de cette machine, que porte l'annonce de la Reine — ou `null`
 * si ce message n'en est pas une. Le lanceur n'attend qu'elle : tout autre
 * message du canal est ignoré plutôt que pris pour une adresse.
 */
export function adresseAnnoncee(message: unknown): AdresseRuche | null {
  const a = message as Partial<AnnonceReine> | null | undefined;
  if (a?.type !== 'reine-en-ligne' || typeof a.hote !== 'string') return null;
  // Les bornes de `portDepuisEnv`, moins le 0 : une fois ouvert, un port n'est
  // plus « au hasard », et hors de [1, 65535] ce n'est pas une adresse.
  if (typeof a.port !== 'number' || !Number.isInteger(a.port)) return null;
  if (a.port < 1 || a.port > 65_535) return null;
  return adresseLocale(a.hote, a.port);
}

/** La pièce attend-elle l'annonce de la Reine pour démarrer ? */
export function attendLaReine(p: Piece): boolean {
  return p.reine === 'HIVE_URL' || p.reine === 'HIVE_HTTP';
}

/** Combien de temps le lanceur laisse la Reine s'annoncer avant de le DIRE. */
export const DELAI_ANNONCE_REINE_MS = 30_000;

/**
 * Ce que le lanceur imprime quand la Reine ne s'est toujours pas annoncée — ou
 * `null` s'il n'y a rien à dire : la ruche s'arrête déjà, ou tout le monde est
 * parti.
 *
 * Ce silence n'arrive pas aujourd'hui : la Reine s'annonce dans la foulée de
 * son `listen`. Mais une Reine vivante qui ne s'annonce JAMAIS — un refactor de
 * `orchestrator/main.ts` qui perd le `process.send` — laisserait ouvrières et
 * écran non lancés sans une ligne : une ruche qui a l'air de tourner et n'a
 * personne pour travailler. Ce message est la seule issue visible de ce cas ;
 * sorti du `.mjs` pour qu'un test tienne qu'il nomme ceux qui attendent.
 */
export function silenceDeLaReine(
  enAttente: readonly Pick<Piece, 'nom'>[],
  onFerme: boolean,
): string | null {
  if (onFerme || enAttente.length === 0) return null;
  const qui = enAttente.map((q) => q.nom).join(', ');
  const secondes = DELAI_ANNONCE_REINE_MS / 1_000;
  return `  ⚠  La Reine ne s'est pas annoncée après ${String(secondes)} s : ${qui} attendent toujours.`;
}

/**
 * Les variables posées pour une pièce au moment de la lancer : les siennes, et,
 * si elle rejoint la Reine, l'adresse que celle-ci a annoncée.
 *
 * Posée PAR-DESSUS l'hérité, elle l'emporte aussi sur le `.env`, que le nœud
 * charge sans jamais écraser une variable présente : un `HIVE_URL` figé sur
 * 7777 — celui de `.env.example` — ne détourne plus une ouvrière de la Reine
 * que sa ruche vient de lancer.
 */
export function envDePiece(
  p: Piece,
  reine: AdresseRuche | null,
): Readonly<Record<string, string>> | undefined {
  if (reine === null || !attendLaReine(p)) return p.env;
  return p.reine === 'HIVE_URL'
    ? { ...p.env, HIVE_URL: reine.ws }
    : { ...p.env, HIVE_HTTP: reine.http };
}

/**
 * Le port que la BANNIÈRE doit annoncer, sachant ce que dit le `.env` et ce que
 * dit l'environnement.
 *
 * ─── POURQUOI CE CALCUL NE PEUT PAS ÊTRE DEVINÉ ────────────────────────────
 *
 * Le lanceur ne charge pas le `.env` — c'est la Reine qui le fait, dans son
 * propre processus, par `process.loadEnvFile`. Le lanceur, lui, doit ANNONCER
 * l'adresse avant que la Reine n'ait dit un mot. Il lui faut donc rejouer la
 * règle exactement, et « exactement » a un piège :
 *
 *     `loadEnvFile` n'écrase JAMAIS une variable déjà posée dans
 *     l'environnement.
 *
 * MESURÉ, pas lu dans une documentation : `CIBLE_A=de_l_environnement node`
 * sur un `.env` qui dit `CIBLE_A=du_fichier` laisse `de_l_environnement`. La
 * précédence est donc l'environnement AU-DESSUS du fichier, et l'ordre de ce
 * `{ ...fichier, ...env }` est la règle elle-même, pas une commodité.
 *
 * Inversé, on retomberait dans le défaut d'origine d'un cran plus bas : la
 * bannière annoncerait le port du fichier pendant que la ruche écoute celui de
 * l'environnement. Plus rare, donc plus long à croire.
 *
 * Le reste — vide, faute de frappe, hors bornes — n'est PAS retranché ici :
 * `portDepuisEnv` porte déjà cette garde, et la réécrire est précisément la
 * divergence qui avait fait mentir `hive doctor`.
 */
export function portAnnonce(
  fichier: NodeJS.ProcessEnv,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return portDepuisEnv({ ...fichier, ...env });
}

/**
 * Lit les drapeaux de la ligne de commande.
 *
 * Sans drapeau, on lance TOUT — c'est la demande d'origine : une commande, une
 * ruche complète. Les drapeaux servent à en retirer, jamais à en ajouter, parce
 * qu'une ruche incomplète est un choix qu'on doit énoncer.
 */
export function voeuDepuisArgv(argv: readonly string[]): Voeu {
  const a = new Set(argv);

  // ─── SOUSTRACTIFS, ET DONC CUMULABLES ──────────────────────────────────────
  //
  // La première version était un aiguillage à retours successifs :
  //
  //     if (a.has('--sans-ecran')) return { hub: true, noeud: true };
  //     if (a.has('--sans-noeud')) return { hub: true, ecran: true };
  //
  // `--sans-ecran --sans-noeud` — les deux drapeaux documentés côte à côte, la
  // combinaison naturelle pour « la Reine SEULE » — rendait au PREMIER testé.
  // L'ouvrière démarrait quand même : celle qui exécute du code avec votre
  // agent, sur votre machine, alors qu'on venait de demander qu'elle ne
  // démarre pas.
  //
  // Le commentaire deux lignes plus haut disait pourtant déjà la règle : « les
  // drapeaux servent à en RETIRER ». Il décrivait une intention, le code
  // faisait un aiguillage. On part donc de tout, et on éteint.
  const v = { hub: true, noeud: true, ecran: true };
  if (a.has('--sans-ecran')) v.ecran = false;
  if (a.has('--sans-noeud')) v.noeud = false;
  // `--ecran-seul` reste un cas à part : il ne retire pas une pièce, il en
  // désigne une. C'est le seul drapeau ADDITIF, et il le dit dans son nom.
  if (a.has('--ecran-seul')) return { ecran: true };
  // Aucun drapeau : on rend le vœu VIDE, que `pieces` lit comme « tout ». Rendre
  // `{hub:true,noeud:true,ecran:true}` serait équivalent aujourd'hui et
  // masquerait demain la distinction entre « je n'ai rien demandé » et « j'ai
  // demandé les trois ».
  if (v.hub && v.noeud && v.ecran) return {};
  return v;
}

/** Le vœu demande-t-il cette pièce ? Un vœu VIDE les demande toutes. */
function voeuVeut(voeu: Voeu, cle: keyof Voeu): boolean {
  const tout = voeu.hub === undefined && voeu.noeud === undefined && voeu.ecran === undefined;
  return tout || voeu[cle] === true;
}

/**
 * Faut-il des ouvrières ? La question que le lanceur pose AVANT de sonder les
 * agents : une ruche lancée sans nœud n'a aucune raison de lancer un
 * `--version` sur chaque agent connu.
 */
export function veutOuvriere(voeu: Voeu): boolean {
  return voeuVeut(voeu, 'noeud');
}

/**
 * Le drapeau qui ramène la ruche à UNE ouvrière — le comportement d'avant.
 * Soustractif, comme les autres : il retire des ouvrières, il n'ajoute rien.
 */
export const DRAPEAU_UNE_OUVRIERE = '--une-ouvriere';

/** Une ouvrière de l'essaim par agent : sa famille, et ce qu'on lui pose. */
export interface OuvriereAgent {
  /** La famille d'agent (`claude-code`, `codex`…) qu'elle fait tourner. */
  readonly agent: string;
  /** Les variables posées dans SON environnement, par-dessus l'hérité. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * Fausse pour la PREMIÈRE famille — l'ouvrière que la ruche lançait déjà
   * seule —, vraie pour chacune de celles qu'on ajoute à côté.
   *
   * La mort d'une ajoutée n'emporte pas la ruche, et c'est une décision, pas
   * une indulgence : sous `HIVE_ISOLEMENT=exige`, une famille absente de
   * l'image fait REFUSER son nœud au démarrage. Emporter la ruche pour ça,
   * c'est casser, chez qui exige un bac, la ruche d'une famille qui marchait
   * hier — pour une ouvrière qu'il n'a jamais demandée. La première, elle,
   * garde la règle d'avant : sans elle, la ruche n'a plus rien de ce qu'on lui
   * connaissait.
   */
  readonly ajoutee: boolean;
}

/** Pourquoi la ruche garde une seule ouvrière. */
export type MotifUneOuvriere =
  /** `HIVE_AGENT` fixe l'agent : l'opérateur a choisi, on ne sonde même pas. */
  | 'agent-fixe'
  /** `HIVE_AGENT_CMD` : une commande libre, qui prime sur toute détection. */
  | 'commande'
  /** `--une-ouvriere`, demandé sur la ligne de commande. */
  | 'drapeau'
  /** Moins de deux familles réelles : il n'y a rien à croiser. */
  | 'une-famille';

/** Les ouvrières que la ruche lancera — une forme FERMÉE, pas deux champs à tenir d'accord. */
export type PlanOuvrieres =
  | { readonly mode: 'une'; readonly motif: MotifUneOuvriere }
  | {
      readonly mode: 'par-agent';
      readonly ouvrieres: readonly OuvriereAgent[];
      /** La famille à qui va `HIVE_MODELES`, ou `null` si l'opérateur n'en déclare pas. */
      readonly modelesDeclaresPar: string | null;
    };

/**
 * Une ouvrière par famille d'agent réelle, ou une seule — et pourquoi.
 *
 * `env` est la FUSION du `.env` et de l'environnement, l'environnement
 * au-dessus : la règle de `portAnnonce`, et pour la même raison — chaque
 * ouvrière chargera le `.env` sans jamais écraser ce qu'elle a reçu.
 *
 * ─── CE QUE CHAQUE OUVRIÈRE REÇOIT, ET CE QUI CASSE SANS ─────────────────────
 *
 *   · `HIVE_AGENT`, sa famille. La détection est faite ici, une fois ; deux
 *     ouvrières qui détecteraient chacune pour soi retiendraient la MÊME
 *     famille — l'ordre de préférence —, et l'essaim ne croiserait rien.
 *   · `HIVE_MAX_CONCURRENCY=1`. Le défaut (2) — ou la valeur du `.env` — était
 *     écrit pour UNE ouvrière ; trois familles à deux tâches chacune, c'est
 *     six agents de front sur une machine qui en menait deux.
 *
 * ─── LA PREMIÈRE GARDE SON IDENTITÉ ──────────────────────────────────────────
 *
 * Elle ne reçoit ni nom, ni dossier, ni modèles : exactement ceux d'hier. Or
 * l'identité d'un nœud vit dans son dossier (`identiteStable(workRoot)`) :
 * lui en changer, c'était laisser un fantôme « hors ligne » dans la ruche et
 * repartir d'une réputation vierge.
 *
 * Les AJOUTÉES prennent `<nom>-<famille>` — le nom étant celui que le nœud se
 * donnerait (`HIVE_NODE_NAME`, sinon la machine). Leur dossier se déduit de ce
 * nom (`.hive-work/<nom>`), donc distinct ; quand l'opérateur a fixé
 * `HIVE_WORKDIR`, elles prennent `<dossier>/<famille>`. Chacune garde ainsi
 * SA identité d'un démarrage à l'autre.
 *
 * DEDANS, et pas à côté : c'est le dossier que l'opérateur a désigné pour le
 * travail de Hive — celui que la désinstallation relève (`empreinte.ts`) et
 * que `.gitignore` écarte. `<dossier>-<famille>` à côté, c'était, sur le
 * `HIVE_WORKDIR=./.hive-work` de `.env.example`, un `.hive-work-codex` à la
 * racine du dépôt : suivi par git, et oublié par la désinstallation avec
 * l'identité qu'il porte. Sous sa racine, un nœud n'écrit que `node-id.txt`,
 * `tasks/`, `merges/` et `chantiers/` (`client.ts`) : aucun nom de famille
 * (`claude-code`, `codex`, `cursor`…) ne tombe sur l'un d'eux, donc une
 * famille logée à côté ne marche sur rien.
 *
 * « Fixé » au sens du nœud, pas de la vérité : `HIVE_WORKDIR=` VIDE est un
 * dossier pour lui (`??`, `node-client/main.ts`) — la racine courante. Le lire
 * ici comme absent laissait les ajoutées sans dossier propre : toutes
 * retombaient sur le même `node-id.txt`, s'inscrivaient sous le MÊME nœud, et
 * la ruche ne voyait plus qu'une famille pendant que la bannière en annonçait
 * trois.
 *
 * ─── `HIVE_MODELES` N'EST QU'À LA PREMIÈRE ───────────────────────────────────
 *
 * Les modèles déclarés sont ceux d'UN agent : celui qui tournait seul, donc
 * la première famille. Les déclarer pour Codex ferait élire `claude-opus-5`
 * sur un nœud qui le passerait à `codex --model` — un échec à chaque tâche.
 * Les ajoutées reçoivent donc un `HIVE_MODELES` VIDE, et vide POSÉ :
 * `loadEnvFile` n'écrase jamais une variable présente, même vide (mesuré), là
 * où une variable absente lui laisserait rendre celle du `.env`.
 *
 * ─── AU REPOS, ELLES NE COÛTENT RIEN ─────────────────────────────────────────
 *
 * Une ouvrière n'appelle son agent que pour une tâche assignée ; au repos elle
 * n'envoie que ses battements au hub. Ce qui se paie, ce sont les relectures :
 * chaque production est relue par chacune des autres familles, jusqu'à
 * `RELECTEURS_PAR_PRODUCTION`, et une relecture est une vraie tâche.
 *
 * ─── TROIS FAÇONS D'EN GARDER UNE ────────────────────────────────────────────
 *
 * `HIVE_AGENT` (l'opérateur a choisi son agent), `HIVE_AGENT_CMD` (une
 * commande libre prime sur toute détection), `--une-ouvriere`. Toutes trois
 * se lisent AVANT de sonder : `detecter` lance un binaire par agent connu, et
 * ne sert à rien quand la réponse est déjà donnée.
 */
export async function planOuvrieres(entree: {
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** Le nom de la machine (`os.hostname()` chez l'appelant). */
  readonly hote: string;
  /** Les agents présents (`detectAllAgents`), dans l'ordre de préférence. */
  readonly detecter: () => Promise<readonly string[]>;
}): Promise<PlanOuvrieres> {
  const { argv, env, hote, detecter } = entree;
  if ((env.HIVE_AGENT ?? '').trim()) return { mode: 'une', motif: 'agent-fixe' };
  if ((env.HIVE_AGENT_CMD ?? '').trim()) return { mode: 'une', motif: 'commande' };
  if (argv.includes(DRAPEAU_UNE_OUVRIERE)) return { mode: 'une', motif: 'drapeau' };

  // Le `shell` simulé n'est pas une famille : il ne relit personne
  // (`AGENTS_SANS_AVIS`) et ne produit que de faux diffs.
  const familles = (await detecter()).filter((a) => !estAgentSimule(a));
  const [premiere] = familles;
  if (premiere === undefined || familles.length < 2) return { mode: 'une', motif: 'une-famille' };

  // Le nom que le nœud se donnerait lui-même — la règle de `node-client/main.ts`.
  const nom = env.HIVE_NODE_NAME ?? hote;
  const dossier = env.HIVE_WORKDIR;
  const ajoutee = (agent: string): Record<string, string> => ({
    HIVE_NODE_NAME: `${nom}-${agent}`,
    ...(dossier !== undefined ? { HIVE_WORKDIR: path.join(dossier, agent) } : {}),
    HIVE_MODELES: '',
  });
  return {
    mode: 'par-agent',
    modelesDeclaresPar: (env.HIVE_MODELES ?? '').trim() ? premiere : null,
    ouvrieres: familles.map((agent) => ({
      agent,
      ajoutee: agent !== premiere,
      env: {
        HIVE_AGENT: agent,
        HIVE_MAX_CONCURRENCY: '1',
        ...(agent === premiere ? {} : ajoutee(agent)),
      },
    })),
  };
}

/**
 * Ce que la ruche dit de ses ouvrières au démarrage — rien quand il n'y en a
 * qu'une.
 *
 * Une seule ouvrière, c'est ce que la ruche faisait déjà, et le nœud dit
 * lui-même quel agent il emploie. Ce qui CHANGE se dit en une ligne, avec son
 * prix et la façon d'y renoncer ; ce qui ne change pas n'ajoute pas de bruit.
 *
 * Le prix est COMPTÉ, pas résumé : `choisirCritiques` prend un relecteur par
 * autre famille en ligne, jusqu'à `RELECTEURS_PAR_PRODUCTION`. Sur Claude Code,
 * Codex et Cursor, c'est DEUX relectures par production — trois exécutions
 * d'agent là où il y en avait une. « Relue par une autre famille » disait la
 * moitié de la facture, sur la seule ligne écrite pour l'annoncer.
 */
export function annonceOuvrieres(plan: PlanOuvrieres | undefined): string[] {
  if (plan?.mode !== 'par-agent') return [];
  const familles = plan.ouvrieres.map((o) => libelleAgent(o.agent)).join(', ');
  const relectures = Math.min(RELECTEURS_PAR_PRODUCTION, plan.ouvrieres.length - 1);
  const relue =
    relectures === 1
      ? 'une autre famille (une tâche de relecture en plus)'
      : `${relectures} autres familles (${relectures} tâches de relecture en plus)`;
  const lignes = [
    `Une ouvrière par agent détecté (${familles}) : une tâche à la fois chacune, ` +
      `chaque production relue par ${relue}, aucun crédit dépensé au repos. ` +
      `Une seule : npm run ruche -- ${DRAPEAU_UNE_OUVRIERE}`,
  ];
  if (plan.modelesDeclaresPar !== null) {
    lignes.push(
      `HIVE_MODELES ne vaut que pour ${libelleAgent(plan.modelesDeclaresPar)} : ` +
        'ce sont les modèles d’un seul agent.',
    );
  }
  return lignes;
}

/**
 * Le préfixe d'une ligne de sortie, aligné sur la plus longue étiquette.
 *
 * Trois processus qui écrivent dans le même terminal sans préfixe donnent un
 * journal illisible où l'on ne sait plus qui se plaint. L'alignement n'est pas
 * cosmétique : c'est ce qui permet de suivre une colonne du regard.
 */
export function prefixe(nom: string, largeurNom: number): string {
  return `${nom.padEnd(largeurNom)} │ `;
}

/** La largeur d'étiquette à retenir pour un lot de pièces. */
export function largeurEtiquettes(liste: readonly Piece[]): number {
  return liste.reduce((m, p) => Math.max(m, [...p.nom].length), 0);
}

/**
 * Les points d'entrée qui MANQUENT sur le disque, avant qu'on lance quoi que ce soit.
 *
 * ─── POURQUOI CE CONTRÔLE EXISTE ─────────────────────────────────────────────
 *
 * Un `spawn` sur un fichier absent échoue par un ENOENT laconique, plusieurs
 * lignes plus bas, mêlé à la sortie des processus qui, eux, ont démarré. Sur une
 * copie fraîche sans `npm install`, c'est le premier écran qu'on voit — et il ne
 * dit pas ce qui manque. Regarder d'abord permet de dire la seule phrase utile :
 * « les dépendances ne sont pas installées ».
 *
 * ─── POURQUOI IL VIT ICI, ET PAS DANS LE LANCEUR ─────────────────────────────
 *
 * Il y vivait, et il était NU : muté en `f === undefined`, la liste des absents
 * devenait toujours vide, le contrôle ne trouvait plus jamais rien, et les trois
 * bancs du lanceur restaient VERTS — ils tournent sur un dépôt installé, où il
 * n'y a rien à trouver. Le seul cas qui distingue est celui qu'on ne peut pas
 * fabriquer sans désinstaller le dépôt sous les pieds du banc.
 *
 * « Hors d'atteinte du banc » est presque toujours « au mauvais endroit »
 * (§ 2 quaterdecies). La présence sur le disque se passe en ARGUMENT : la
 * décision devient pure, et le cas « un fichier manque » s'éprouve pour rien.
 *
 * Chaque fichier n'est nommé qu'UNE fois : les ouvrières d'un essaim par agent
 * partagent le même lanceur, et le message ne doit pas le répéter par famille.
 */
export function entreesAbsentes(
  liste: readonly Piece[],
  estPresent: (fichier: string) => boolean,
): string[] {
  const entrees = new Set(liste.map((p) => p.argv[0]).filter((f) => f !== undefined));
  return [...entrees].filter((f) => !estPresent(f));
}

/** Ce qu'un morceau de flux libère de lignes ENTIÈRES, et ce qu'il laisse en tampon. */
export interface Debit {
  /** Les lignes complètes, sans leur `\n`. */
  readonly lignes: string[];
  /** Le début de ligne qui n'est pas encore terminé. */
  readonly reste: string;
}

/**
 * Le découpage d'un flux en lignes, morceau par morceau.
 *
 * `stdout` arrive en fragments qui ne s'alignent pas sur les fins de ligne :
 * préfixer les morceaux couperait des lignes en deux et en collerait d'autres.
 * On ne rend donc que ce qui est terminé, et on garde le reste pour le morceau
 * suivant.
 */
export function decouperLignes(tampon: string, bout: string): Debit {
  const morceaux = (tampon + bout).split('\n');
  const reste = morceaux.pop() ?? '';
  return { lignes: morceaux, reste };
}

/**
 * Ce qu'il reste à écrire quand le flux se ferme.
 *
 * ─── LA LIGNE QU'ON PERDAIT EST LA PLUS IMPORTANTE ───────────────────────────
 *
 * Un processus qui meurt écrit souvent sa dernière phrase SANS `\n` final — une
 * trace d'exception tronquée, un « command not found », un prompt resté ouvert.
 * Cette phrase-là dort dans le tampon, et c'est précisément celle qu'on cherche
 * quand on remonte une panne.
 *
 * La garde `reste !== ''` existe pour ne pas imprimer une étiquette toute seule
 * quand le flux se termine proprement sur un `\n`. Mutée en `===`, elle inverse
 * exactement les deux : la dernière ligne est PERDUE, et une étiquette vide est
 * imprimée à sa place. Les trois bancs du lanceur y restaient verts — ils lisent
 * des marqueurs qui, eux, sont suivis d'un retour à la ligne.
 */
export function reliquat(tampon: string): string[] {
  return tampon === '' ? [] : [tampon];
}
