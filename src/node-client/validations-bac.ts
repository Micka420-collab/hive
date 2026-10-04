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
// lit test par test, complète et cohérente (`shared/lecture-tests.ts` : cette
// sortie est en partie écrite par le code de l'agent, et le lecteur refuse au
// moindre doute), chaque échec est comparé à la BASE, rejouée À PART
// (`comparerALaBaseRejouee`) : un dépôt neuf à côté de la tâche
// (`extraireBase` — par `fetch`, jamais en lisant les objets que l'agent a pu
// forger), une installation FRAÎCHE depuis le lockfile de la base, son build
// s'il est déclaré, puis le même script de test, dans le même bac. Rien de ce
// que la production a touché n'y entre — pas même son `node_modules`, partagé
// quand le lockfile n'a pas bougé comme le suggérait la carte : les tests de
// la production l'avaient monté en écriture, et une base qui en hériterait
// jugerait avec des dépendances que la production a pu réécrire.
//
// Une SECONDE exécution de la production, quand une régression reste possible,
// ne repart pas du répertoire de la tâche : la première y a tourné, et ce
// qu'elle y a laissé (un marqueur, un cache, un fichier réécrit) ferait passer
// la seconde — une instabilité fabriquée. Elle rejoue l'arbre LIVRÉ, figé
// avant toute validation (`figerArbreLivre`), extrait à part comme la base
// (`extraireLivre`), installé et construit de neuf. Dans le bac, rien d'autre
// ne survit d'une exécution à l'autre : chaque commande a son conteneur, et
// son `/tmp` en mémoire.
//
// Une exécution qui porte une panne du bac (`signatureEnvironnement` :
// mémoire, disque, DNS…) ne compte pas : à la base, ses rouges excuseraient ;
// à la tête, elle fausserait la comparaison. Le verdict du script reste.
//
// Ce que ça coûte est ANNONCÉ dans la ligne de progression, avant de lancer,
// au pire cas réel (`surcoutMaxMs`) : chaque rejeu à part — extraction
// (`DELAI_EXTRACTION_MS`), installation (`DELAI_PREPARATION_MS`), build et
// tests (le délai d'une commande chacun) —, la base d'abord, puis, si une
// régression reste possible, la production depuis son arbre livré, puis une
// seconde exécution de la base (`OBSERVATIONS`). Rien de tout ça quand les
// tests passent : seule une tête en échec se compare. Ce qui ne se rejoue pas,
// ne se lit pas ou ne se compare pas rend le verdict du script, tel qu'avant.
//
// ─── LA MÉMOIRE DES BASES ─────────────────────────────────────────────────────
//
// Ce qu'une base dit de ses tests ne dépend que de son commit — l'arbre, le
// lockfile, les scripts — et du bac du nœud. `MemoireDesBases` le garde donc,
// par `baseSha`. Où, et pourquoi là :
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
//     ou de `NOMS_EN_MEMOIRE_MAX` noms n'est pas gardée ;
//   · REMPLIE seulement par des bases rejouées à part, sans panne, et dont les
//     exécutions s'accordent : une base qui a vacillé ne s'en porte garante
//     pour personne, et aucune tâche ne peut y glisser de quoi excuser la
//     régression d'une autre.
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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { argvDe } from '../shared/chantier.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { OBSERVATIONS, comparerALaBase, lireSortieDeTest } from '../shared/lecture-tests.js';
import type {
  FormatDeTest,
  IssueDeComparaison,
  LectureDeTests,
  ObservationDeTests,
} from '../shared/lecture-tests.js';
import { jugerPreparation } from '../shared/preparation.js';
import {
  ORDRE_DE_LANCEMENT,
  PREPARATIONS_PAR_LOCKFILE,
  VALIDATION_KEYS,
  controleApresLancement,
  controleCompare,
  declareDesDependances,
  extraitDe,
  planDeValidation,
  preparationDepuisLockfile,
  reglesAutorisationDepot,
  scriptsDe,
  signatureEnvironnement,
} from '../shared/validations-bac.js';
import type {
  Arret,
  ControleBac,
  Etape,
  RaisonControle,
  ValidationKey,
  ValidationsBac,
} from '../shared/validations-bac.js';
import { BaseFalsifiee, lireFichierDeBaseVerifie } from './base-verifiee.js';
import { DELAI_EXTRACTION_MS, extraireBase, extraireLivre, figerArbreLivre } from './git-hote.js';
import { MONTAGE } from './isolement.js';
import type { BacExecution } from './isolement.js';
import { runProc } from './merge-runner.js';
import { gitHote } from '../shared/git-protege.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import {
  buildSandboxEnv,
  dossierDeBase,
  dossierDeTete,
  effacerRejeu,
  retirerFichiersIgnores,
} from './workspace.js';

/** Délai de chaque commande de validation — celui des tests d'un merge. */
export const DELAI_VALIDATION_MS = 5 * 60_000;
/** Une installation complète télécharge : même marge que la préparation d'un merge. */
export const DELAI_PREPARATION_MS = 10 * 60_000;
/** `npm --version` : un conteneur froid peut mettre quelques secondes à démarrer. */
const DELAI_SONDE_MS = 60_000;
/** Combien de bases un nœud garde en mémoire (voir l'en-tête). */
export const BASES_EN_MEMOIRE = 8;
/** Au-delà, une exécution de base sert une fois, sans être gardée. */
const ECHECS_EN_MEMOIRE_MAX = 1_000;
const NOMS_EN_MEMOIRE_MAX = 10_000;

/**
 * Le pire cas d'un rejeu à part (voir l'en-tête) : l'extraction, l'installation,
 * le build et les tests, chacun à son délai.
 */
export function rejeuMaxMs(delaiMs = DELAI_VALIDATION_MS): number {
  return DELAI_EXTRACTION_MS + DELAI_PREPARATION_MS + 2 * delaiMs;
}

/**
 * Le pire cas de la comparaison à la base, au-delà de la première exécution des
 * tests : la base rejouée, la production rejouée depuis son arbre livré, et une
 * seconde exécution de la base — 55 min aux délais par défaut. C'est ce que la
 * ligne de progression annonce, et ce dont un parent qui attend un enfant
 * délégué doit tenir compte (`client.ts`).
 */
export function surcoutMaxMs(delaiMs = DELAI_VALIDATION_MS): number {
  return 2 * rejeuMaxMs(delaiMs) + delaiMs;
}

/** Ce que chaque exécution d'une base a dit de ses tests, gardé par `baseSha`. */
export interface MemoireDesBases {
  /** Les exécutions gardées, si elles ont été lues dans le même format. */
  lire(baseSha: string, format: FormatDeTest): readonly ObservationDeTests[];
  ranger(baseSha: string, format: FormatDeTest, executions: readonly ObservationDeTests[]): void;
}

/** La mémoire des bases d'UN nœud, la moins récemment servie oubliée d'abord. */
export function memoireDesBases(capacite = BASES_EN_MEMOIRE): MemoireDesBases {
  const bases = new Map<
    string,
    { format: FormatDeTest; executions: readonly ObservationDeTests[] }
  >();
  return {
    lire(baseSha, format) {
      const gardee = bases.get(baseSha);
      if (!gardee || gardee.format !== format) return [];
      bases.delete(baseSha);
      bases.set(baseSha, gardee);
      return gardee.executions;
    },
    ranger(baseSha, format, executions) {
      const tropGrande = (o: ObservationDeTests) =>
        o.echecs.size > ECHECS_EN_MEMOIRE_MAX ||
        o.echecs.size + o.succes.size > NOMS_EN_MEMOIRE_MAX;
      if (executions.length === 0 || executions.some(tropGrande)) return;
      bases.delete(baseSha);
      bases.set(baseSha, { format, executions: executions.slice(0, OBSERVATIONS) });
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
 * Lit un fichier du commit de base, par la SEULE porte vérifiée
 * (`base-verifiee.ts`) ; `null` s'il n'y existe pas. Partagé avec la porte de
 * sécurité, qui y relit les lockfiles d'avant la production.
 *
 * Lève `BaseFalsifiee` si un objet git du chemin ne correspond pas à son
 * empreinte : git ne vérifie pas ce qu'il lit, l'agent a pu forger l'objet
 * d'un fichier de la base dans le `.git` de sa tâche (`alternates`), et une
 * lecture directe (`cat-file blob <base>:<fichier>`) rendait alors le contenu
 * FORGÉ — un `"test":"exit 0"` glissé sous le `package.json` de base, une
 * vulnérabilité maquillée en « déjà présente ». Jamais une lecture silencieuse :
 * l'appelant REJETTE la production en le disant.
 */
export async function fichierDeBase(
  depot: DepotEpingle,
  baseSha: string,
  fichier: string,
): Promise<string | null> {
  return lireFichierDeBaseVerifie(depot, baseSha, fichier);
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
 * Les règles d'autorisation compilées depuis le commit de BASE du clone —
 * `reglesAutorisationDepot` (pur) alimenté par les trois mêmes gestes impurs
 * que `validerProduction` : le `package.json` de la base, lu par la porte
 * VÉRIFIÉE (`fichierDeBase` → `base-verifiee.ts`, jamais l'arbre que l'agent
 * réécrit), et la présence d'un lockfile À LA BASE (même raison : un lockfile
 * posé par l'agent n'autorise pas son installation).
 *
 * Calculées AVANT l'agent (G12) : elles entrent dans le `--settings` imposé de
 * Claude Code pour que le `npm test` déclaré tourne sans rien demander. Ne
 * lève jamais — sans dépôt ou sans manifeste lisible, aucune règle. Une base
 * que la porte vérifiée refuse (un objet forgé, `BaseFalsifiee` ; ou git en
 * panne pendant la vérification) n'en compile AUCUNE non plus — fermé : rien
 * n'est pré-autorisé, chaque action passe par la décision — et `surRefus` le
 * dit, une fois.
 */
export async function reglesAutorisationDeBase(
  depot: { depot: DepotEpingle; baseSha: string } | null,
  surRefus?: (motif: string) => void,
): Promise<string[]> {
  if (!depot) return [];
  try {
    const base = manifeste(await fichierDeBase(depot.depot, depot.baseSha, 'package.json'));
    if (base === null) return [];
    const lockfiles = new Set<string>();
    // Les lockfiles ne servent qu'à la règle d'installation : sans dépendances
    // déclarées, aucune sonde git n'est payée.
    if (declareDesDependances(base)) {
      for (const { fichier } of PREPARATIONS_PAR_LOCKFILE) {
        if ((await fichierDeBase(depot.depot, depot.baseSha, fichier)) !== null) {
          lockfiles.add(fichier);
          break;
        }
      }
    }
    return reglesAutorisationDepot(base, (fichier) => lockfiles.has(fichier));
  } catch (err) {
    surRefus?.(
      err instanceof BaseFalsifiee
        ? err.message
        : `base illisible (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }
}

/**
 * L'arbre livré, figé avant que rien ne tourne (`figerArbreLivre`) — et la
 * production a-t-elle touché `.npmrc` ? C'est GIT qui le dit, pas une
 * comparaison d'octets : sous Windows, `core.autocrlf` extrait le fichier en
 * CRLF quand le blob est en LF, et une comparaison brute accusait la
 * production de l'avoir réécrit à chaque tâche. Un `.npmrc` ignoré n'est pas
 * vu ici — il est retiré avant le lancement.
 */
async function arbreLivre(
  depot: DepotEpingle,
  baseSha: string,
): Promise<{ arbre: string; npmrcModifie: boolean }> {
  const arbre = await figerArbreLivre(depot);
  const modifies = await gitHote(
    ['diff', '--no-ext-diff', '--no-textconv', '--name-only', baseSha, '--', '.npmrc'],
    depot,
  );
  return { arbre, npmrcModifie: modifies.trim() !== '' };
}

/**
 * Lance ce que la base du dépôt déclare, et rend un constat par validation.
 * Ne lève jamais.
 */
export async function validerProduction(opts: OptionsValidation): Promise<ValidationsBac> {
  const { depot, cwd } = opts;
  const rapport = (controles: Record<ValidationKey, ControleBac>): ValidationsBac => ({
    ...(depot ? { baseSha: depot.baseSha } : {}),
    controles,
  });

  let base: string | null;
  try {
    base = depot ? await fichierDeBase(depot.depot, depot.baseSha, 'package.json') : null;
  } catch (err) {
    // La base relue est falsifiée : l'agent a forgé l'objet git du
    // `package.json` de base (`base-verifiee.ts`). On ne lit pas les scripts
    // d'un manifeste forgé, et aucune validation ne passe — la raison le dit,
    // caviardée comme tout ce qui part au hub.
    if (!(err instanceof BaseFalsifiee)) throw err;
    const sortie = opts.caviarder?.(err.message) ?? err.message;
    const controles = {} as Record<ValidationKey, ControleBac>;
    for (const cle of VALIDATION_KEYS) {
      controles[cle] = { etat: 'missing', raison: 'base_falsifiee', ...extraitDe(sortie) };
    }
    return rapport(controles);
  }
  const produit = fichierDeTravail(cwd, 'package.json');
  const plan = planDeValidation(scriptsDe(manifeste(base)), scriptsDe(manifeste(produit)));

  try {
    // `.npmrc` règle la façon dont npm lance un script (`script-shell`…) et
    // d'où il installe (`registry`). Réécrit par la production, il jugerait
    // à la place des scripts : même règle que pour eux.
    const livre = depot ? await arbreLivre(depot.depot, depot.baseSha) : null;
    if (livre?.npmrcModifie) return rapport(manquantes(plan, 'npmrc_reecrit'));
    return rapport(await lancerLePlan(plan, opts, manifeste(produit), livre?.arbre ?? null));
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
  /** L'arbre livré, figé (`arbreLivre`) ; `null` sans dépôt. */
  livre: string | null,
): Promise<Record<ValidationKey, ControleBac>> {
  const { cwd, depot } = opts;
  // Tout ce qui doit être lancé part `annule` : une annulation en cours de route
  // laisse ainsi les validations qu'on n'a pas lancées dire pourquoi. Sans rien
  // à lancer, ce sont les constats du plan, rendus tels quels.
  const controles = manquantes(plan, 'annule');
  const aLancer = ORDRE_DE_LANCEMENT.filter((cle) => plan[cle].genre === 'lancer');
  // `depot` (et l'arbre livré) sont toujours là quand quelque chose est à
  // lancer — sans lui, tout est `sans_manifeste` ; le tester ici le dit au typage.
  if (aLancer.length === 0 || !depot || livre === null || opts.signal?.aborted) return controles;
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
        livre,
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

/** Un nom de test dans une ligne de progression : une donnée du dépôt, bornée. */
const cite = (nom: string): string => `« ${nom.length > 120 ? `${nom.slice(0, 119)}…` : nom} »`;

/**
 * La sortie d'une exécution, lue test par test — ou pourquoi pas. Les chemins
 * absolus du répertoire où elle a tourné sont ramenés au montage du bac : la
 * base, la tête et son rejeu ne tournent pas au même endroit de l'hôte, et un
 * message d'échec qui cite son fichier doit garder la même empreinte.
 */
function lireExecution(
  r: Execution,
  racine: string,
): { lecture: LectureDeTests } | { raison: string; verte: boolean } {
  if (r.arret || r.code === null) return { raison: 'arrêtée', verte: false };
  // `runProc` le dit : un échec a pu tomber dans le milieu omis.
  if (r.tronquee) return { raison: 'sortie coupée', verte: false };
  if (r.code === 126 || r.code === 127) return { raison: `code ${r.code}`, verte: false };
  const panne = signatureEnvironnement(r.code, r.output);
  if (panne) return { raison: `panne d’environnement (${panne})`, verte: false };
  const issue = lireSortieDeTest(r.output.replaceAll(racine, MONTAGE));
  // Illisible mais VERTE (code 0) : aucun test rouge — et aucun vu vert.
  if (!issue.lisible) return { raison: issue.raison, verte: r.code === 0 };
  // En échec sans nommer de test : SWE-bench (`get_logs_eval`), le journal ne
  // décrit pas ce qui s'est passé. Vert en en nommant un rouge : non plus.
  if ((r.code === 0) !== (issue.lecture.echecs.size === 0)) {
    const raison = r.code === 0 ? 'code 0 et des tests rouges' : 'aucun test nommé en échec';
    return { raison, verte: false };
  }
  return { lecture: issue.lecture };
}

/** Pourquoi la comparaison s'arrête, en une ligne de progression. */
function direIncomparable(issue: Exclude<IssueDeComparaison, { comparable: true }>): string {
  const t = cite(issue.test);
  switch (issue.motif) {
    case 'vert_disparu':
      return `${t}, vu vert à la base, n’est pas vu à la production : elle n’a pas tout exécuté`;
    case 'rouge_disparu':
      return `${t}, rouge à une exécution de la production, n’est pas vu à l’autre`;
    case 'base_incertaine':
      return `${t}, rouge à une exécution de la base, n’est pas vu à l’autre`;
    case 'autre_echec':
      return `${t} est rouge à la base, mais pas du même échec`;
  }
}

/** Les exécutions d'une base s'accordent-elles sur ses tests rouges ? */
const sAccordent = (bases: readonly ObservationDeTests[]): boolean =>
  bases.every((b) =>
    bases.every(
      (autre) =>
        b.echecs.size === autre.echecs.size &&
        [...b.echecs].every(([test, empreinte]) => autre.echecs.get(test) === empreinte),
    ),
  );

/** Ce que les côtés rejoués à part partagent. */
interface ContexteRejeu {
  opts: OptionsValidation;
  depot: { depot: DepotEpingle; baseSha: string };
  /** L'arbre livré, figé avant toute validation. */
  livre: string;
  plan: Record<ValidationKey, Etape>;
  argv: string[];
  delaiMs: number;
  executer: Executer;
}

/**
 * Les tests en échec d'une production, comparés test par test à sa base
 * rejouée à part (voir l'en-tête) — ou `null` : la sortie ne se lit pas, un
 * côté ne se rejoue pas, les exécutions ne se comparent pas, la tâche est
 * annulée. Le verdict reste alors celui du script, et la ligne de progression
 * dit pourquoi.
 *
 * PARESSEUSE, parce que chaque rejeu coûte jusqu'à `rejeuMaxMs` : la base
 * d'abord (ou sa mémoire) — si chaque échec y était déjà rouge, du même
 * échec, c'est fini ; sinon la production rejouée depuis son arbre livré, et
 * si une régression reste encore possible, une seconde exécution de la base
 * (`OBSERVATIONS`).
 */
async function comparerALaBaseRejouee(
  ctx: ContexteRejeu & {
    premiere: Execution;
    constat: { script: string; code: number; dureeMs: number; sortie: string };
  },
): Promise<ControleBac | null> {
  const { opts, depot, delaiMs } = ctx;
  const etape = (ligne: string) => opts.surEtape?.(`validation tests : ${ligne}`);
  // La comparaison s'arrête, et le verdict reste celui du script — la ligne
  // dit pourquoi, et d'abord quand c'est la tâche qu'on annule.
  const abandon = (ligne: string): null => {
    const annulee = 'tâche annulée pendant la comparaison à la base — verdict du script';
    etape(opts.signal?.aborted ? annulee : ligne);
    return null;
  };
  const lue = lireExecution(ctx.premiere, opts.cwd);
  if (!('lecture' in lue)) {
    etape(`sortie non lue test par test (${lue.raison}) — verdict du script`);
    return null;
  }
  const { lecture } = lue;
  const sha = depot.baseSha.slice(0, 8);
  const debut = Date.now();
  const base = rejeuAPart(ctx, 'base', lecture.format);
  const tete = rejeuAPart(ctx, 'tete', lecture.format);
  try {
    const enMemoire = opts.memoire?.lire(depot.baseSha, lecture.format) ?? [];
    const bases: ObservationDeTests[] = [];
    const tetes: ObservationDeTests[] = [lecture];
    const premiereBase = enMemoire[0];
    if (premiereBase) {
      etape(
        `${lecture.echecs.size} test(s) en échec — base ${sha} déjà rejouée sur ce nœud (mémoire)`,
      );
      bases.push(premiereBase);
    } else {
      etape(
        `${lecture.echecs.size} test(s) en échec — comparaison à la base ${sha}, rejouée à part ` +
          `(extraction, installation, build, tests : jusqu’à ${enClair(rejeuMaxMs(delaiMs))}) ; ` +
          'si une régression reste possible, la production est rejouée de même depuis son ' +
          `arbre livré, puis la base une seconde fois — au pire ${enClair(surcoutMaxMs(delaiMs))} de plus…`,
      );
      const vue = await base.executer();
      if (!vue) return abandon('pas de comparaison à la base — verdict du script');
      bases.push(vue);
    }
    let issue = comparerALaBase(tetes, bases);
    const regressionsPossibles = () =>
      issue.comparable && issue.comparaison.regressions.length > 0 && !opts.signal?.aborted
        ? issue.comparaison.regressions.length
        : 0;
    let possibles = regressionsPossibles();
    if (possibles > 0) {
      etape(
        `${possibles} test(s) rouge(s) à la tête et pas à la base — la production est rejouée à part, ` +
          `depuis son arbre livré, pour écarter l’instabilité (jusqu’à ${enClair(rejeuMaxMs(delaiMs))})…`,
      );
      // Illisible ou en panne, la seconde exécution n'apprend rien : la première tient.
      const vue = await tete.executer();
      if (vue) {
        tetes.push(vue);
        issue = comparerALaBase(tetes, bases);
      }
    }
    possibles = regressionsPossibles();
    if (possibles > 0) {
      const memorisee = enMemoire[1];
      if (!memorisee) {
        etape(
          `${possibles} régression(s) possible(s) — seconde exécution de la base ${sha}, pour ` +
            `écarter l’instabilité (jusqu’à ${enClair(base.aTourne() ? delaiMs : rejeuMaxMs(delaiMs))})…`,
        );
      }
      const vue = memorisee ?? (await base.executer());
      if (vue) {
        bases.push(vue);
        issue = comparerALaBase(tetes, bases);
      }
    }
    if (opts.signal?.aborted) return abandon('');
    // Une base rejouée ici, sans panne et d'accord avec elle-même, sert aux
    // tâches suivantes du nœud — quoi que la tête en ait fait.
    if (base.aTourne() && sAccordent(bases)) {
      opts.memoire?.ranger(depot.baseSha, lecture.format, bases);
    }
    if (!issue.comparable) {
      return abandon(`${direIncomparable(issue)} — pas de comparaison, verdict du script`);
    }
    return controleCompare({
      ...ctx.constat,
      format: lecture.format,
      comparaison: issue.comparaison,
      executions: { tete: tetes.length, base: bases.length },
      memoire: enMemoire.length > 0,
      surcoutMs: Date.now() - debut,
    });
  } finally {
    await Promise.all([base.nettoyer(), tete.nettoyer()]);
  }
}

/**
 * Un côté de la tâche rejoué À PART — extrait, installé et construit à la
 * PREMIÈRE exécution demandée, une fois : sa `base` (le commit cloné), ou sa
 * `tete` (l'arbre livré, figé avant toute validation). Chaque exécution rend
 * ce qu'elle dit de ses tests, ou `null` (et dit pourquoi) : le côté ne se
 * rejoue pas, ou sa sortie ne se lit pas test par test, dans le format de la
 * première exécution.
 */
function rejeuAPart(
  ctx: ContexteRejeu,
  cote: 'base' | 'tete',
  format: FormatDeTest,
): {
  executer(): Promise<ObservationDeTests | null>;
  aTourne(): boolean;
  nettoyer(): Promise<void>;
} {
  const { opts, depot, plan, delaiMs } = ctx;
  const dossier = cote === 'base' ? dossierDeBase(opts.cwd) : dossierDeTete(opts.cwd);
  const nom =
    cote === 'base' ? `base ${depot.baseSha.slice(0, 8)}` : 'production (arbre livré, à part)';
  // Une ligne de progrès part au hub : ce qu'elle cite (le message d'un git en
  // échec) passe par le caviardage du nœud, comme les extraits.
  const caviarder = opts.caviarder ?? ((texte: string) => texte);
  const dire = (ligne: string) =>
    opts.surEtape?.(`validation tests : ${nom} — ${caviarder(ligne)}`);
  let prete: Promise<string | null> | null = null;
  let executions = 0;

  /** Extraire, installer, construire : `null` si tout est prêt, sinon pourquoi pas. */
  const preparer = async (): Promise<string | null> => {
    try {
      if (cote === 'base') await extraireBase(depot.depot, depot.baseSha, dossier);
      else await extraireLivre(depot.depot, ctx.livre, dossier);
    } catch (err) {
      return `extraction impossible (${err instanceof Error ? err.message : String(err)})`;
    }
    const manifesteRejoue = manifeste(fichierDeTravail(dossier, 'package.json'));
    if (declareDesDependances(manifesteRejoue)) {
      const preparation = preparationDepuisLockfile((f) => existsSync(path.join(dossier, f)));
      if (!preparation) return 'aucun lockfile';
      const garde = jugerPreparation(preparation);
      if (!garde.ok) return garde.motif;
      dire(`installation « ${preparation.join(' ')} »…`);
      const prep = await ctx.executer(preparation, dossier, DELAI_PREPARATION_MS);
      if (prep.code !== 0 || prep.arret) {
        return `installation en échec (${prep.arret ?? `code ${String(prep.code)}`})`;
      }
    }
    // Des tests lisent parfois ce que le build produit (`ORDRE_DE_LANCEMENT`) :
    // chaque côté se construit comme la tête l'a été, et un côté qui ne se
    // construit pas ne se compare pas — ses tests échoueraient tous.
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
        dire(`pas rejouée : ${empechement}`);
        return null;
      }
      dire(`${ctx.argv.join(' ')}…`);
      const lue = lireExecution(await ctx.executer(ctx.argv, dossier, delaiMs), dossier);
      if (!('lecture' in lue)) {
        if (lue.verte) {
          executions += 1;
          return { echecs: new Map(), succes: new Set(), nommeLesVerts: false };
        }
        dire(`sortie non retenue (${lue.raison})`);
        return null;
      }
      if (lue.lecture.format !== format) {
        dire(`sortie non retenue (format ${lue.lecture.format}, pas ${format})`);
        return null;
      }
      executions += 1;
      return lue.lecture;
    },
    aTourne: () => executions > 0,
    nettoyer: () => effacerRejeu(dossier),
  };
}
