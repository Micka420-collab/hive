// Les validations du bac, côté nœud — lancer ce que le projet déclare, dans le
// répertoire et le bac à sable où la production vient d'être faite.
//
// Les DÉCISIONS vivent dans `shared/validations-bac.ts` (pur, testé seul) ; ce
// fichier ne fait que les trois gestes impurs : lire le dépôt, préparer
// l'environnement, lancer. Il ne lève JAMAIS : une validation qui plante ne doit
// pas emporter la production qu'elle vérifie — elle devient `missing`, raison à
// l'appui, et le résultat part quand même.
//
// ─── CE QUI TOURNE, ET AVEC QUOI ─────────────────────────────────────────────
//
//   · les commandes : `npm run <script>` (`argvDe`, le même argv que les
//     Chantiers), jugé par `jugerCommandeTest` comme toute commande de test
//     lancée sur la machine d'un membre ;
//   · le lieu : le répertoire de la tâche, dans le MÊME bac que l'agent
//     (`runProc` enveloppe, exactement comme pour un merge ou un chantier) —
//     et JAMAIS hors d'un bac : sans lui, ces commandes, qui exécutent du code
//     écrit par l'agent, tourneraient sur l'hôte nu (`sans_bac`) ;
//   · l'environnement : `buildSandboxEnv` SANS les variables de l'agent, plus
//     `CI=true` — la seule variable que le bac relaie, pour qu'un runner qui
//     surveille par défaut (`react-scripts test`) tourne une fois et rende la
//     main. Les commandes du projet n'ont pas besoin de la clé d'API du
//     modèle : elles reçoivent moins que la production, jamais plus ;
//   · les bornes : un délai par commande, que `runProc` tient contre toute la
//     descendance, une sortie plafonnée dont seule la fin remonte au hub
//     (`EXTRAIT_MAX`).
//
// ─── CE QUI EST JUGÉ : LA BASE, PLUS LE DIFF — RIEN D'AUTRE ──────────────────
//
// Une livraison ou un merge appliquent le diff sur la base. Le bac juge donc
// cela, et pas le répertoire tel que l'agent l'a laissé :
//
//   · la base est le commit CLONÉ (`Workspace.baseSha`), épinglé avant l'agent
//     — pas HEAD, qu'un `git commit` de l'agent déplace ;
//   · tout ce que git ignore est retiré avant de lancer quoi que ce soit
//     (`retirerFichiersIgnores`) : un `node_modules` ou un `.npmrc` laissés
//     par l'agent ne sont dans aucun diff, donc sous les yeux de personne ;
//   · les dépendances déclarées sont réinstallées depuis le lockfile. Sans
//     lockfile, rien ne peut être reconstruit à l'identique : `missing`.
//
// ─── LES TESTS EN ÉCHEC, COMPARÉS À LA BASE REJOUÉE (G11b) ───────────────────
//
// Un test déjà rouge à la base bloquait `accepted` : le verdict se lisait sur
// le code de sortie du script. Quand les tests échouent ET que leur sortie se
// lit test par test (`shared/lecture-tests.ts`), chaque échec est désormais
// comparé à la BASE, rejouée À PART (`comparerALaBaseRejouee`) : un dépôt neuf
// à côté de la tâche (`extraireBase` — par `fetch`, jamais en lisant les
// objets que l'agent a pu forger), une installation FRAÎCHE depuis le lockfile
// de la base, son build s'il est déclaré, puis le même script de test, dans le
// même bac. Rien de ce que la production a touché n'y entre — pas même son
// `node_modules`, partagé quand le lockfile n'a pas bougé comme le suggérait
// la carte : les tests de la production l'avaient monté en écriture, et une
// base qui en hériterait jugerait avec des dépendances que la production a pu
// réécrire. Le prix : une installation de plus.
//
// Ce que ça coûte est ANNONCÉ dans la ligne de progression, avant de lancer :
// l'exécution est doublée — jusqu'à `DELAI_PREPARATION_MS` d'installation puis
// le délai d'une commande pour le build et pour les tests — et, pour écarter
// l'instabilité, une seconde exécution de chaque côté (`OBSERVATIONS`) quand
// une régression reste possible. Rien de tout ça quand les tests passent : seule
// une tête en échec se compare. Une base qui ne se rejoue pas (installation,
// build, sortie illisible) rend le verdict du script, tel qu'avant.
//
// ─── LA MÉMOIRE DES BASES ─────────────────────────────────────────────────────
//
// Les échecs d'une base ne dépendent que de son commit — l'arbre, le lockfile,
// les scripts — et du bac du nœud. `MemoireDesBases` les garde donc, par
// `baseSha`. Où, et pourquoi là :
//
//   · PAR NŒUD : un test rouge à cause du bac d'un nœud (une mémoire, un outil
//     absent) excuserait, rangé à la Reine, l'échec d'un autre nœud ;
//   · EN MÉMOIRE, le temps de vie du nœud : la réutilisation qui compte est
//     courte — une correction relancée, les tâches sœurs d'une mission, qui
//     partent du même commit tant que la branche n'a pas bougé. La garder sur
//     disque ajouterait un magasin chez le membre (`empreinte.ts`) pour des
//     bases déjà dépassées au redémarrage ;
//   · BORNÉE : `BASES_EN_MEMOIRE` commits au plus, `OBSERVATIONS` exécutions
//     par commit, et une exécution de plus de `ECHECS_EN_MEMOIRE_MAX` échecs
//     n'est pas gardée ;
//   · REMPLIE seulement par des bases rejouées à part : aucune tâche ne peut
//     y glisser de quoi excuser la régression d'une autre.
//
// ─── CE QUE ÇA NE PROUVE PAS, ET IL FAUT LE DIRE ─────────────────────────────
//
// Ce bac n'est pas un runner de CI propre : il tourne sur la machine du membre,
// après l'agent, dans son répertoire. Il ferme le raccourci le plus direct — la
// production qui réécrit la commande qui la juge (`planDeValidation`, et
// `.npmrc` ici, qui règle la façon dont npm lance un script). Il ne prétend pas
// voir un test vidé, une configuration de test assouplie, ni une dépendance
// ajoutée dont l'installation exécute du code : ceux-là sont DANS le diff, et
// c'est la contre-revue et la revue humaine qui les lisent. D'où la provenance
// `hive_sandbox`, toujours affichée — jamais confondue avec la CI.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { argvDe } from '../shared/chantier.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { OBSERVATIONS, comparerALaBase, lireSortieDeTest } from '../shared/lecture-tests.js';
import type { FormatDeTest, ObservationDeTests } from '../shared/lecture-tests.js';
import { jugerPreparation } from '../shared/preparation.js';
import {
  ORDRE_DE_LANCEMENT,
  VALIDATION_KEYS,
  controleApresLancement,
  controleCompare,
  declareDesDependances,
  extraitDe,
  planDeValidation,
  preparationDepuisLockfile,
  scriptsDe,
} from '../shared/validations-bac.js';
import type {
  Arret,
  ControleBac,
  Etape,
  RaisonControle,
  ValidationKey,
  ValidationsBac,
} from '../shared/validations-bac.js';
import { extraireBase } from './git-hote.js';
import type { BacExecution } from './isolement.js';
import { runProc } from './merge-runner.js';
import { gitHote } from '../shared/git-protege.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import { buildSandboxEnv, dossierDeBase, retirerFichiersIgnores } from './workspace.js';

/** Délai de chaque commande de validation — celui des tests d'un merge. */
export const DELAI_VALIDATION_MS = 5 * 60_000;
/** Une installation complète télécharge : même marge que la préparation d'un merge. */
export const DELAI_PREPARATION_MS = 10 * 60_000;
/** `npm --version` : un conteneur froid peut mettre quelques secondes à démarrer. */
const DELAI_SONDE_MS = 60_000;
/** Combien de bases un nœud garde en mémoire (voir l'en-tête). */
export const BASES_EN_MEMOIRE = 8;
/** Au-delà, les échecs d'une exécution de base servent une fois, sans être gardés. */
const ECHECS_EN_MEMOIRE_MAX = 1_000;

/** Les tests rouges de chaque exécution d'une base, gardés par `baseSha`. */
export interface MemoireDesBases {
  lire(baseSha: string): readonly ReadonlySet<string>[];
  ranger(baseSha: string, executions: readonly ReadonlySet<string>[]): void;
}

/** La mémoire des bases d'UN nœud, la moins récemment servie oubliée d'abord. */
export function memoireDesBases(capacite = BASES_EN_MEMOIRE): MemoireDesBases {
  const bases = new Map<string, readonly ReadonlySet<string>[]>();
  return {
    lire(baseSha) {
      const executions = bases.get(baseSha);
      if (!executions) return [];
      bases.delete(baseSha);
      bases.set(baseSha, executions);
      return executions;
    },
    ranger(baseSha, executions) {
      if (executions.some((echecs) => echecs.size > ECHECS_EN_MEMOIRE_MAX)) return;
      bases.delete(baseSha);
      bases.set(baseSha, executions.slice(0, OBSERVATIONS));
      for (const plusAncienne of bases.keys()) {
        if (bases.size <= capacite) break;
        bases.delete(plusAncienne);
      }
    },
  };
}

export interface OptionsValidation {
  /** Répertoire de la tâche, tel que l'agent l'a laissé. */
  cwd: string;
  /**
   * Le dépôt cloné, ÉPINGLÉ sur le registre de la ruche (`Workspace.depot`),
   * et son commit de base (`Workspace.baseSha`) ; `null` sans dépôt ou sans
   * commit — rien n'est alors déclaré. Jamais le `.git` de la tâche : ces
   * git tournent sur l'hôte APRÈS l'agent, qui a pu y poser crochets,
   * moniteur et filtres (`git-hote.ts`).
   */
  depot: { depot: DepotEpingle; baseSha: string } | null;
  /** Le bac du nœud ; absent, RIEN ne tourne (`sans_bac`). */
  bac?: BacExecution;
  /** Le signal de la tâche : une annulation arrête aussi ses validations. */
  signal?: AbortSignal;
  /** Une ligne de progrès, relayée au hub pendant que les commandes tournent. */
  surEtape?: (ligne: string) => void;
  /** Délai de chaque commande (défaut `DELAI_VALIDATION_MS`). */
  delaiMs?: number;
  /**
   * Le caviardage du nœud (`shared/caviardage.ts`), appliqué à la sortie ENTIÈRE
   * de chaque commande AVANT qu'on n'en garde la fin (`extraitDe`) : l'extrait
   * part au hub, et une coupe faite avant laisserait la moitié d'une clé qu'un
   * test aurait imprimée — lue dans un fichier où l'agent l'avait écrite.
   */
  caviarder?: (texte: string) => string;
  /**
   * La mémoire des bases du nœud (voir l'en-tête) ; absente, chaque comparaison
   * rejoue sa base.
   */
  memoire?: MemoireDesBases;
}

/**
 * Lit un fichier du commit de base ; `null` s'il n'y existe pas. Partagé avec
 * la porte de sécurité, qui y relit les lockfiles d'avant la production.
 */
export async function fichierDeBase(
  depot: DepotEpingle,
  baseSha: string,
  fichier: string,
): Promise<string | null> {
  try {
    // `cat-file blob` : les octets du commit, sans filtre ni `textconv`.
    return await gitHote(['cat-file', 'blob', `${baseSha}:${fichier}`], depot);
  } catch {
    return null;
  }
}

function fichierDeTravail(cwd: string, fichier: string): string | null {
  try {
    return readFileSync(path.join(cwd, fichier), 'utf8');
  } catch {
    return null;
  }
}

function manifeste(texte: string | null): unknown {
  if (texte === null) return null;
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    return null;
  }
}

/**
 * La production a-t-elle touché `.npmrc` ? C'est GIT qui le dit, pas une
 * comparaison d'octets : sous Windows, `core.autocrlf` extrait le fichier en
 * CRLF quand le blob est en LF, et une comparaison brute accusait la
 * production de l'avoir réécrit à chaque tâche. Un `.npmrc` ignoré n'est pas
 * vu ici — il est retiré avant le lancement.
 */
async function npmrcModifie(depot: DepotEpingle, baseSha: string): Promise<boolean> {
  await gitHote(['add', '--all', '--intent-to-add'], depot);
  const modifies = await gitHote(
    ['diff', '--no-ext-diff', '--no-textconv', '--name-only', baseSha, '--', '.npmrc'],
    depot,
  );
  return modifies.trim() !== '';
}

/**
 * Lance ce que la base du dépôt déclare, et rend un constat par validation.
 * Ne lève jamais.
 */
export async function validerProduction(opts: OptionsValidation): Promise<ValidationsBac> {
  const { depot, cwd } = opts;
  const base = depot ? await fichierDeBase(depot.depot, depot.baseSha, 'package.json') : null;
  const produit = fichierDeTravail(cwd, 'package.json');
  const plan = planDeValidation(scriptsDe(manifeste(base)), scriptsDe(manifeste(produit)));
  const rapport = (controles: Record<ValidationKey, ControleBac>): ValidationsBac => ({
    ...(depot ? { baseSha: depot.baseSha } : {}),
    controles,
  });

  try {
    // `.npmrc` règle la façon dont npm lance un script (`script-shell`…) et
    // d'où il installe (`registry`). Réécrit par la production, il jugerait
    // à la place des scripts : même règle que pour eux.
    if (depot && (await npmrcModifie(depot.depot, depot.baseSha))) {
      return rapport(manquantes(plan, 'npmrc_reecrit'));
    }
    return rapport(await lancerLePlan(plan, opts, manifeste(produit)));
  } catch (err) {
    // Un défaut du nœud, pas du projet : dit tel quel dans l'extrait, pour
    // qu'on le trouve — et surtout pas pris pour un verdict.
    const message = err instanceof Error ? err.message : String(err);
    return rapport(manquantes(plan, 'interrompue', opts.caviarder?.(message) ?? message));
  }
}

/** Le même constat `missing` pour tout ce que le plan voulait lancer. */
function manquantes(
  plan: Record<ValidationKey, Etape>,
  raison: RaisonControle,
  sortie = '',
): Record<ValidationKey, ControleBac> {
  const controles = {} as Record<ValidationKey, ControleBac>;
  for (const cle of VALIDATION_KEYS) {
    const etape = plan[cle];
    controles[cle] =
      etape.genre === 'constat'
        ? etape.controle
        : { etat: 'missing', raison, script: etape.script, ...extraitDe(sortie) };
  }
  return controles;
}

/** Ce que rend une commande lancée dans le bac, sortie déjà caviardée. */
interface Execution {
  code: number | null;
  output: string;
  arret?: Arret;
  tronquee?: true;
}

/** Lance `argv` dans le bac, dans le répertoire `ou` (la tâche, ou sa base rejouée). */
type Executer = (argv: string[], ou: string, delaiMs: number) => Promise<Execution>;

async function lancerLePlan(
  plan: Record<ValidationKey, Etape>,
  opts: OptionsValidation,
  manifesteProduit: unknown,
): Promise<Record<ValidationKey, ControleBac>> {
  const { cwd, depot } = opts;
  // Tout ce qui doit être lancé part `annule` : une annulation en cours de route
  // laisse ainsi les validations qu'on n'a pas lancées dire pourquoi. Sans rien
  // à lancer, ce sont les constats du plan, rendus tels quels.
  const controles = manquantes(plan, 'annule');
  const aLancer = ORDRE_DE_LANCEMENT.filter((cle) => plan[cle].genre === 'lancer');
  // `depot` est toujours là quand quelque chose est à lancer (sans lui, tout
  // est `sans_manifeste`) ; le tester ici le dit au typage.
  if (aLancer.length === 0 || !depot || opts.signal?.aborted) return controles;
  // HORS BAC, RIEN NE TOURNE — voir `shared/validations-bac.ts`. Pas même la
  // préparation : `npm ci` exécute les scripts de cycle de vie du projet.
  if (!opts.bac) return manquantes(plan, 'sans_bac');

  // La base plus le diff, rien d'autre : ce que git ignore (dépendances
  // installées par l'agent, `.npmrc` ignoré, sorties de build) disparaît
  // AVANT tout lancement — y compris pour un projet sans dépendances, dont
  // les scripts trouveraient sinon `node_modules/.bin` en tête du PATH.
  await retirerFichiersIgnores(depot.depot);

  // Le bac ne relaie que `CI` : les variables de l'agent (sa clé d'API) ne
  // sont de toute façon pas dans `env`, et rien d'autre n'a à traverser.
  const bac = { ...opts.bac, variables: ['CI'] };
  const caviarder = opts.caviarder ?? ((texte: string) => texte);
  const executer: Executer = async (argv, ou, delaiMs) => {
    const env = { ...buildSandboxEnv(ou), CI: 'true' };
    const r = await runProc(argv, ou, env, delaiMs, opts.signal, bac);
    return { ...r, output: caviarder(r.output) };
  };
  const lancer = (argv: string[], delaiMs: number) => executer(argv, cwd, delaiMs);

  // npm se lance-t-il DANS CE BAC ? Sans cette sonde, un bac qui ne voit pas
  // npm rendrait quatre `code 1` — le moteur qui échoue à exécuter l'invité
  // répond comme un script en échec —, lus comme quatre échecs de la
  // production.
  const sonde = await lancer(['npm', '--version'], DELAI_SONDE_MS);
  if (sonde.code !== 0 || sonde.arret) {
    return manquantes(plan, opts.signal?.aborted ? 'annule' : 'npm_indisponible', sonde.output);
  }

  if (declareDesDependances(manifesteProduit)) {
    const preparation = preparationDepuisLockfile((f) => existsSync(path.join(cwd, f)));
    if (!preparation) return manquantes(plan, 'sans_lockfile');
    // Garde redite au lancement, comme pour un merge : la préparation vient
    // d'une table de ce dépôt-ci, et la table pourrait un jour s'élargir.
    const garde = jugerPreparation(preparation);
    if (!garde.ok) return manquantes(plan, 'preparation_echouee', garde.motif);
    opts.surEtape?.(`validations : préparation « ${preparation.join(' ')} »…`);
    const prep = await lancer(preparation, DELAI_PREPARATION_MS);
    if (prep.code !== 0 || prep.arret) {
      return manquantes(
        plan,
        prep.arret === 'annule' ? 'annule' : 'preparation_echouee',
        // La commande EN DERNIER : l'extrait garde la fin de la sortie.
        `${prep.output}\n[hive] ${preparation.join(' ')} → ${prep.arret ?? `code ${String(prep.code)}`}`,
      );
    }
  }

  const delaiMs = opts.delaiMs ?? DELAI_VALIDATION_MS;
  for (const cle of aLancer) {
    const etape = plan[cle];
    if (etape.genre !== 'lancer' || opts.signal?.aborted) continue;
    const argv = argvDe(etape.script);
    // La garde des commandes de test lancées sur la machine d'un membre, redite
    // ici : `argvDe` rend toujours `npm run …`, et c'est ce qui doit le rester.
    const garde = jugerCommandeTest(argv);
    if (!garde.ok) {
      controles[cle] = {
        etat: 'missing',
        raison: 'lancement',
        script: etape.script,
        extrait: garde.motif,
      };
      continue;
    }
    opts.surEtape?.(`validation ${cle} : ${argv.join(' ')}…`);
    const debut = Date.now();
    const r = await lancer(argv, delaiMs);
    const premier = {
      script: etape.script,
      code: r.code,
      ...(r.arret ? { arret: r.arret } : {}),
      dureeMs: Date.now() - debut,
      sortie: r.output,
    };
    let controle = controleApresLancement(premier);
    // G11b : des tests en échec — un verdict du script — se comparent à la
    // base quand leur sortie se lit test par test. `null` : la comparaison
    // n'a pas pu se faire, et le verdict du script reste, exactement.
    if (cle === 'tests' && controle.etat === 'failed' && controle.raison === 'termine') {
      const compare = await comparerALaBaseRejouee({
        opts,
        depot,
        plan,
        argv,
        delaiMs,
        executer,
        premiere: r,
        constat: { ...premier, code: controle.code ?? 1 },
      });
      controle = compare ?? controle;
    }
    controles[cle] = controle;
    // La panne reconnue se dit dès cette ligne : « missing (environnement :
    // memoire, code 137) » renvoie l'opérateur vers le nœud, pas vers le code.
    opts.surEtape?.(`validation ${cle} : ${controle.etat} (${resumeDuControle(controle)})`);
  }
  return controles;
}

/** La raison d'un constat en quelques mots, pour la ligne de progression. */
function resumeDuControle(controle: ControleBac): string {
  const precisions: string[] = [];
  if (controle.panne !== undefined) precisions.push(controle.panne);
  const c = controle.comparaison;
  if (c) {
    if (c.regressions.total > 0) precisions.push(`${c.regressions.total} régression(s)`);
    if (c.instables.total > 0) precisions.push(`${c.instables.total} instable(s)`);
    if (c.dejaRouges.total > 0) precisions.push(`${c.dejaRouges.total} déjà rouge(s) à la base`);
  }
  const code = controle.code === undefined ? '' : `, code ${controle.code}`;
  return `${controle.raison}${precisions.length > 0 ? ` : ${precisions.join(', ')}` : ''}${code}`;
}

/** Une durée de délai, dite en minutes ou en secondes. */
const enClair = (ms: number): string =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`;

/**
 * Ce qu'une exécution des tests dit de ses tests, ou `null` si elle ne se lit
 * pas test par test : arrêtée, coupée au milieu, d'un format inconnu, ou en
 * échec sans nommer aucun test — SWE-bench (`get_logs_eval`) : la sortie ne
 * décrit alors pas ce qui s'est passé. Une exécution qui rend 0 n'a, elle,
 * aucun test rouge, quoi qu'elle imprime.
 */
function observer(r: Execution): (ObservationDeTests & { format?: FormatDeTest }) | null {
  if (r.arret || r.code === null || r.tronquee) return null;
  const issue = lireSortieDeTest(r.output);
  if (r.code === 0) {
    return { echecs: new Set(), succes: issue.lisible ? issue.lecture.succes : new Set() };
  }
  if (!issue.lisible || issue.lecture.echecs.size === 0) return null;
  return issue.lecture;
}

/**
 * Les tests en échec d'une production, comparés test par test à sa base
 * rejouée à part (voir l'en-tête) — ou `null` : la sortie ne se lit pas, la
 * base ne se rejoue pas, la tâche est annulée. Le verdict reste alors celui du
 * script.
 *
 * PARESSEUSE, parce que chaque exécution coûte jusqu'au délai d'une commande :
 * la base d'abord (ou sa mémoire) — si chaque échec y était déjà rouge, c'est
 * fini ; sinon une seconde exécution de la tête, et si une régression reste
 * encore possible, une seconde exécution de la base (`OBSERVATIONS`).
 */
async function comparerALaBaseRejouee(ctx: {
  opts: OptionsValidation;
  depot: { depot: DepotEpingle; baseSha: string };
  plan: Record<ValidationKey, Etape>;
  argv: string[];
  delaiMs: number;
  executer: Executer;
  premiere: Execution;
  constat: { script: string; code: number; dureeMs: number; sortie: string };
}): Promise<ControleBac | null> {
  const { opts, depot, delaiMs } = ctx;
  const lecture = observer(ctx.premiere);
  if (!lecture?.format || lecture.echecs.size === 0) return null;
  const sha = depot.baseSha.slice(0, 8);
  const etape = (ligne: string) => opts.surEtape?.(`validation tests : ${ligne}`);
  const debut = Date.now();
  const base = baseRejouee(ctx);
  try {
    const enMemoire = opts.memoire?.lire(depot.baseSha) ?? [];
    const rougesALaBase: ReadonlySet<string>[] = enMemoire.slice(0, 1);
    if (rougesALaBase.length > 0) {
      etape(
        `${lecture.echecs.size} test(s) en échec — base ${sha} déjà rejouée sur ce nœud (mémoire)`,
      );
    } else {
      etape(
        `${lecture.echecs.size} test(s) en échec — comparaison à la base ${sha}, rejouée à part : ` +
          `exécution doublée, jusqu'à ${enClair(DELAI_PREPARATION_MS)} d'installation puis ` +
          `${enClair(delaiMs)} par commande (build, tests)…`,
      );
      const premiere = await base.executer();
      if (!premiere) return null;
      rougesALaBase.push(premiere);
    }
    const tete: ObservationDeTests[] = [lecture];
    let comparaison = comparerALaBase(tete, rougesALaBase);
    if (comparaison.regressions.length > 0 && !opts.signal?.aborted) {
      etape(
        `${comparaison.regressions.length} test(s) rouge(s) à la tête et pas à la base — ` +
          `seconde exécution, pour écarter l'instabilité (jusqu'à ${enClair(delaiMs)})…`,
      );
      // Illisible, la seconde exécution n'apprend rien : la première tient.
      const seconde = observer(await ctx.executer(ctx.argv, opts.cwd, delaiMs));
      if (seconde) tete.push(seconde);
      comparaison = comparerALaBase(tete, rougesALaBase);
    }
    if (comparaison.regressions.length > 0 && !opts.signal?.aborted) {
      const memorisee = enMemoire[1];
      if (!memorisee) {
        etape(
          `${comparaison.regressions.length} régression(s) possible(s) — seconde exécution de la ` +
            `base ${sha}, pour écarter l'instabilité (jusqu'à ${enClair(delaiMs)})…`,
        );
      }
      const seconde = memorisee ?? (await base.executer());
      if (seconde) rougesALaBase.push(seconde);
      comparaison = comparerALaBase(tete, rougesALaBase);
    }
    if (opts.signal?.aborted) return null;
    if (base.aTourne()) opts.memoire?.ranger(depot.baseSha, rougesALaBase);
    return controleCompare({
      ...ctx.constat,
      format: lecture.format,
      comparaison,
      executions: { tete: tete.length, base: rougesALaBase.length },
      memoire: enMemoire.length > 0,
      surcoutMs: Date.now() - debut,
    });
  } finally {
    base.nettoyer();
  }
}

/**
 * La base de la tâche, rejouée à part — extraite, installée et construite à la
 * PREMIÈRE exécution demandée, une fois. Chaque exécution rend les tests rouges
 * de la base, ou `null` (et dit pourquoi) : la base ne se rejoue pas, ou sa
 * sortie ne se lit pas test par test.
 */
function baseRejouee(ctx: {
  opts: OptionsValidation;
  depot: { depot: DepotEpingle; baseSha: string };
  plan: Record<ValidationKey, Etape>;
  argv: string[];
  delaiMs: number;
  executer: Executer;
}): { executer(): Promise<ReadonlySet<string> | null>; aTourne(): boolean; nettoyer(): void } {
  const { opts, depot, plan, delaiMs } = ctx;
  const dossier = dossierDeBase(opts.cwd);
  const sha = depot.baseSha.slice(0, 8);
  const dire = (ligne: string) => opts.surEtape?.(`validation tests : base ${sha} — ${ligne}`);
  let prete: Promise<string | null> | null = null;
  let executions = 0;

  /** Extraire, installer, construire : `null` si tout est prêt, sinon pourquoi pas. */
  const preparer = async (): Promise<string | null> => {
    try {
      await extraireBase(depot.depot, depot.baseSha, dossier);
    } catch (err) {
      return `extraction impossible (${err instanceof Error ? err.message : String(err)})`;
    }
    const manifesteDeBase = manifeste(fichierDeTravail(dossier, 'package.json'));
    if (declareDesDependances(manifesteDeBase)) {
      const preparation = preparationDepuisLockfile((f) => existsSync(path.join(dossier, f)));
      if (!preparation) return 'aucun lockfile à la base';
      const garde = jugerPreparation(preparation);
      if (!garde.ok) return garde.motif;
      dire(`installation « ${preparation.join(' ')} »…`);
      const prep = await ctx.executer(preparation, dossier, DELAI_PREPARATION_MS);
      if (prep.code !== 0 || prep.arret) {
        return `installation en échec (${prep.arret ?? `code ${String(prep.code)}`})`;
      }
    }
    // Des tests lisent parfois ce que le build produit (`ORDRE_DE_LANCEMENT`) :
    // la base se construit comme la tête l'a été, et une base qui ne se
    // construit pas ne se compare pas — ses tests échoueraient tous, et
    // excuseraient tout.
    const build = plan.build;
    if (build.genre === 'lancer') {
      const argv = argvDe(build.script);
      const garde = jugerCommandeTest(argv);
      if (!garde.ok) return garde.motif;
      dire(`${argv.join(' ')}…`);
      const construit = await ctx.executer(argv, dossier, delaiMs);
      if (construit.code !== 0 || construit.arret) {
        return `build en échec (${construit.arret ?? `code ${String(construit.code)}`})`;
      }
    }
    return null;
  };

  return {
    async executer() {
      if (opts.signal?.aborted) return null;
      prete ??= preparer();
      const empechement = await prete;
      if (empechement !== null) {
        dire(`pas rejouée : ${empechement} — verdict du script`);
        return null;
      }
      dire(`${ctx.argv.join(' ')}…`);
      const lue = observer(await ctx.executer(ctx.argv, dossier, delaiMs));
      if (!lue) {
        dire('sa sortie ne se lit pas test par test — verdict du script');
        return null;
      }
      executions += 1;
      return lue.echecs;
    },
    aTourne: () => executions > 0,
    nettoyer() {
      const options = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
      try {
        rmSync(dossier, options);
        rmSync(`${dossier}.tmp`, options);
      } catch {
        // Fichier verrouillé : `prepareWorkspace` et `cleanup` le retrouveront.
      }
    },
  };
}
