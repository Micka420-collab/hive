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
import { jugerPreparation } from '../shared/preparation.js';
import {
  ORDRE_DE_LANCEMENT,
  VALIDATION_KEYS,
  controleApresLancement,
  declareDesDependances,
  extraitDe,
  planDeValidation,
  preparationDepuisLockfile,
  scriptsDe,
} from '../shared/validations-bac.js';
import type {
  ControleBac,
  Etape,
  RaisonControle,
  ValidationKey,
  ValidationsBac,
} from '../shared/validations-bac.js';
import type { Fournisseur } from './isolement.js';
import { runProc } from './merge-runner.js';
import { gitHote } from './git-hote.js';
import type { DepotEpingle } from './git-hote.js';
import { buildSandboxEnv, retirerFichiersIgnores } from './workspace.js';

/** Délai de chaque commande de validation — celui des tests d'un merge. */
export const DELAI_VALIDATION_MS = 5 * 60_000;
/** Une installation complète télécharge : même marge que la préparation d'un merge. */
export const DELAI_PREPARATION_MS = 10 * 60_000;
/** `npm --version` : un conteneur froid peut mettre quelques secondes à démarrer. */
const DELAI_SONDE_MS = 60_000;

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
  bac?: { fournisseur: Fournisseur; variables: readonly string[]; image: string };
  /** Le signal de la tâche : une annulation arrête aussi ses validations. */
  signal?: AbortSignal;
  /** Une ligne de progrès, relayée au hub pendant que les commandes tournent. */
  surEtape?: (ligne: string) => void;
  /** Délai de chaque commande (défaut `DELAI_VALIDATION_MS`). */
  delaiMs?: number;
}

/** Lit un fichier du commit de base ; `null` s'il n'y existe pas. */
async function fichierDeBase(
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
    return rapport(
      manquantes(plan, 'interrompue', err instanceof Error ? err.message : String(err)),
    );
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
  const env = { ...buildSandboxEnv(cwd), CI: 'true' };
  const bac = { ...opts.bac, variables: ['CI'] };
  const lancer = (argv: string[], delaiMs: number) =>
    runProc(argv, cwd, env, delaiMs, opts.signal, bac);

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
    const controle = controleApresLancement({
      script: etape.script,
      code: r.code,
      ...(r.arret ? { arret: r.arret } : {}),
      dureeMs: Date.now() - debut,
      sortie: r.output,
    });
    controles[cle] = controle;
    opts.surEtape?.(
      `validation ${cle} : ${controle.etat} (${controle.raison}` +
        `${controle.code === undefined ? '' : `, code ${controle.code}`})`,
    );
  }
  return controles;
}
