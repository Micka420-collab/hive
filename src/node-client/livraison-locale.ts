// La livraison locale, côté nœud : commiter l'arbre intégré d'une mission, le
// ranger dans un dépôt qui survit au clone jetable, et le pousser si c'est
// demandé ET consenti. Le pourquoi est en tête de `shared/livraison-locale.ts`.
//
// ─── CE QUI EST COMMITÉ, EXACTEMENT ──────────────────────────────────────────
//
// Un ARBRE git capturé par `runMerge` juste après l'application des diffs,
// AVANT la préparation et les tests : `npm ci` ne glisse pas ses
// `node_modules` dans la livraison, et un test qui réécrit un fichier ne la
// modifie pas. Le commit est composé par la plomberie (`commit-tree`) : aucun
// crochet du dépôt ni de l'opérateur ne s'exécute, aucune signature n'est
// tentée — un programme GPG qui attend une phrase secrète figerait le nœud.
//
// ─── CE QUI N'ARRIVE JAMAIS ──────────────────────────────────────────────────
//
//   · une poussée FORCÉE : la référence de destination est nommée sans `+`,
//     une branche qui existe déjà là-bas fait échouer la poussée, et c'est dit ;
//   · une autre référence que `hive/mission-<projectId>-<n>` : le nom est
//     composé ICI, depuis un `projectId` validé par le protocole ;
//   · une poussée sans le consentement de l'opérateur du nœud : le hub peut
//     le prétendre, le nœud relit le sien ;
//   · un identifiant dans un message : tout ce qui remonte au hub est lavé
//     (`laverIdentifiantsDuTexte`), et le dépôt durable ne garde que l'URL
//     lavée du dépôt du projet.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  CONSENTEMENT_POUSSEE,
  brancheDeMission,
  messageDeMission,
  numeroSuivant,
} from '../shared/livraison-locale.js';
import type {
  DemandeLivraisonLocale,
  RapportDuNoeud,
  TestsLivres,
} from '../shared/livraison-locale.js';
import { laverIdentifiants, laverIdentifiantsDuTexte } from '../shared/projet-public.js';
import { LIMITS } from '../shared/protocol.js';

/**
 * L'identité des commits de mission : la RUCHE, pas l'opérateur du nœud.
 *
 * Le code vient des agents, l'intégration de la ruche ; l'attribuer à la
 * personne qui prête sa machine serait faux, et dépendre de SA configuration
 * git ferait échouer la livraison sur un poste où `user.email` n'est pas
 * réglé. `.invalid` est le domaine réservé qui ne répond jamais (RFC 2606) :
 * l'adresse ne prétend pas être une boîte aux lettres.
 */
const IDENTITE_RUCHE = {
  GIT_AUTHOR_NAME: 'Hive',
  GIT_AUTHOR_EMAIL: 'hive@hive.invalid',
  GIT_COMMITTER_NAME: 'Hive',
  GIT_COMMITTER_EMAIL: 'hive@hive.invalid',
} as const;

/** Ce que le nœud apporte à une livraison, en plus de la demande du hub. */
export interface LivraisonDuNoeud {
  demande: DemandeLivraisonLocale;
  /** Dépôt nu DURABLE du projet sur ce nœud (`<workRoot>/livraisons/<id>.git`). */
  depotLocal: string;
  /** L'opérateur de CE nœud a-t-il consenti à pousser ? Relu ici, jamais cru du hub. */
  pousseeConsentie: boolean;
  /** L'environnement de transport du clone (`envTransportGit`) : mêmes identifiants. */
  envTransport: NodeJS.ProcessEnv;
}

/** Un motif qui remonte au hub : lavé de tout identifiant, borné. */
export function motifLave(texte: string): string {
  return laverIdentifiantsDuTexte(texte).trim().slice(0, LIMITS.arg) || 'échec sans message';
}

/**
 * Commite l'arbre intégré sur la prochaine branche de mission, la range dans
 * le dépôt durable du nœud, puis la pousse si c'est demandé et consenti.
 *
 * Ne lève pas : chaque issue est un rapport, et un échec porte son motif.
 */
export async function commiterMission(opts: {
  /** Le clone jetable du merge, `origin` = dépôt du projet, HEAD = base intégrée. */
  cloneDir: string;
  /** L'arbre capturé après application des diffs, avant préparation et tests. */
  arbre: string;
  livraison: LivraisonDuNoeud;
  tests: TestsLivres;
}): Promise<RapportDuNoeud> {
  const { demande, depotLocal, envTransport } = opts.livraison;
  const clone = simpleGit({ baseDir: opts.cloneDir }).env({ ...envTransport, ...IDENTITE_RUCHE });
  let branche: string;
  let commit: string;
  try {
    // ─── LE DÉPÔT DURABLE ──────────────────────────────────────────────────
    // Nu : aucune copie de travail à salir, et l'opérateur s'en sert comme
    // d'un distant (`git fetch <chemin> hive/mission-…`, ou `git -C <chemin>
    // push origin hive/mission-…`). Son `origin` est l'URL LAVÉE : les
    // identifiants restent à l'assistant de l'opérateur, pas dans un fichier.
    mkdirSync(path.dirname(depotLocal), { recursive: true });
    if (!existsSync(path.join(depotLocal, 'HEAD'))) {
      await simpleGit().env(envTransport).raw(['init', '--bare', '--quiet', depotLocal]);
    }
    const depot = simpleGit({ baseDir: depotLocal }).env(envTransport);
    const origine = laverIdentifiants((await clone.raw(['remote', 'get-url', 'origin'])).trim());
    if (origine) await depot.raw(['config', 'remote.origin.url', origine]);

    // ─── LE NUMÉRO : ni une branche d'ici, ni une branche de là-bas ─────────
    // `ls-remote` après un clone réussi n'échoue qu'en cas de vraie panne ; on
    // ne devine pas alors un numéro qui pourrait déjà être pris là-bas.
    const locales = await depot.raw(['for-each-ref', '--format=%(refname)', 'refs/heads/hive/']);
    const distantes = (await clone.raw(['ls-remote', '--heads', 'origin']))
      .split('\n')
      .map((l) => l.split('\t')[1] ?? '');
    const n = numeroSuivant(demande.projectId, [...locales.split('\n'), ...distantes]);
    branche = brancheDeMission(demande.projectId, n);

    // ─── LE COMMIT ─────────────────────────────────────────────────────────
    // Un dépôt VIDE n'a pas de HEAD : la livraison y devient le premier commit.
    // `rev-parse -q` rend une sortie vide sans lever — c'est la sortie qu'on lit.
    const parent = (await clone.raw(['rev-parse', '--verify', '-q', 'HEAD^{commit}'])).trim();
    // Le message s'écrit DANS le dépôt git du clone jetable, jamais dans le
    // dossier temporaire du système : il part avec le clone, et l'empreinte de
    // Hive sur la machine (`shared/empreinte.ts`) n'y gagne pas un lieu de plus.
    const dossierGit = (await clone.raw(['rev-parse', '--absolute-git-dir'])).trim();
    const fichierMessage = path.join(dossierGit, 'HIVE_MESSAGE_MISSION');
    writeFileSync(fichierMessage, messageDeMission(demande, n, opts.tests));
    commit = (
      await clone.raw([
        'commit-tree',
        '--no-gpg-sign',
        opts.arbre,
        ...(parent ? ['-p', parent] : []),
        '-F',
        fichierMessage,
      ])
    ).trim();
    // `git branch` refuse une branche qui existe : jamais d'écrasement.
    await clone.raw(['branch', '--no-track', branche, commit]);

    // ─── LE RANGEMENT : la branche doit survivre au clone ──────────────────
    // `--update-shallow` n'est pas une option de confort. Depuis un clone
    // superficiel, sans lui, git REFUSE la référence… et sort en 0, un simple
    // avertissement à l'appui. D'où la relecture qui suit : c'est elle qui
    // prouve que la branche est rangée, pas le code de sortie.
    await depot.raw([
      'fetch',
      '--update-shallow',
      '--no-tags',
      '--quiet',
      opts.cloneDir,
      `refs/heads/${branche}:refs/heads/${branche}`,
    ]);
    const rangee = (
      await depot.raw(['rev-parse', '--verify', '-q', `refs/heads/${branche}`])
    ).trim();
    if (rangee !== commit) {
      return {
        etat: 'non_commitee',
        motif: `la branche ${branche} n’a pas pu être rangée dans le dépôt de livraison du nœud`,
      };
    }
  } catch (err) {
    return {
      etat: 'non_commitee',
      motif: motifLave(
        `livraison impossible : ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }

  // ─── LA POUSSÉE : demandée, PUIS consentie ───────────────────────────────
  if (!demande.pousser) return { etat: 'commitee', branche, commit, poussee: 'non_demandee' };
  if (!opts.livraison.pousseeConsentie) {
    return { etat: 'commitee', branche, commit, poussee: 'refusee', motif: CONSENTEMENT_POUSSEE };
  }
  try {
    await clone.raw([
      'push',
      '--no-verify',
      'origin',
      `refs/heads/${branche}:refs/heads/${branche}`,
    ]);
    return { etat: 'commitee', branche, commit, poussee: 'poussee' };
  } catch (err) {
    // La branche reste rangée sur le nœud : la livraison n'est pas perdue, sa
    // poussée a échoué — et le motif dit pourquoi, identifiants lavés.
    return {
      etat: 'commitee',
      branche,
      commit,
      poussee: 'echec',
      motif: motifLave(err instanceof Error ? err.message : String(err)),
    };
  }
}
