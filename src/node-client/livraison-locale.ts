// La livraison locale, côté nœud : commiter l'arbre intégré d'une mission, le
// ranger dans un dépôt qui survit au clone jetable, et le pousser si c'est
// demandé ET consenti. Le pourquoi est en tête de `shared/livraison-locale.ts`.
//
// ─── DEUX TEMPS, ET UNE FRONTIÈRE ENTRE LES DEUX ─────────────────────────────
//
// La préparation et les tests exécutent le code DU DÉPÔT — écrit par des
// agents — dans le clone jetable. Sous bac à sable, ce clone est le seul
// chemin inscriptible, `.git` compris. Après eux, la configuration du clone
// (`origin`, `core.sshCommand`, un assistant d'identifiants), ses crochets et
// son HEAD sont ce que le code testé a voulu qu'ils soient. Un git lancé là
// après les tests, sur l'hôte et avec les identifiants du nœud, exécuterait
// ce code HORS du bac, pousserait ailleurs que vers le dépôt du projet, et
// commiterait sur un parent choisi par lui. Une relecture l'a démontré sur un
// vrai git, les trois à la fois.
//
// D'où deux temps, et plus aucune commande dans le clone après les tests :
//
//   1. `composerMission`, AVANT la préparation et les tests, quand le clone
//      n'a vu que `git clone` et `git apply` (qui refuse tout chemin sous
//      `.git`) : le parent est lu, le numéro choisi, le commit composé, puis
//      copié dans un dépôt nu de TRANSIT, hors du clone — le bac ne le voit
//      pas ;
//   2. `garderMission`, APRÈS, et seulement si la préparation et les tests
//      n'ont rien contredit : la branche naît dans le dépôt durable depuis le
//      transit, et la poussée part du dépôt durable vers le `repoUrl` que le
//      hub a envoyé. Deux dépôts dont seul le nœud écrit la configuration.
//
// ─── CE QUI EST COMMITÉ, EXACTEMENT ──────────────────────────────────────────
//
// L'ARBRE git capturé par `runMerge` juste après l'application des diffs :
// `npm ci` ne glisse pas ses `node_modules` dans la livraison, et un test qui
// réécrit un fichier ne la modifie pas. Le commit est composé par la
// plomberie (`commit-tree`) : aucun crochet du dépôt ne s'exécute, aucune
// signature n'est tentée — un programme GPG qui attend une phrase secrète
// figerait le nœud.
//
// Le trailer `Hive-Tests` s'écrit donc AVANT les tests. Il dit ce qui sera
// vrai si le commit est gardé — et il ne l'est que si la commande de test,
// quand il y en a une, a rendu 0 (`merge-runner.ts`). Un commit composé puis
// contredit ne quitte jamais le transit, effacé avec le clone.
//
// ─── CE QUI N'ARRIVE JAMAIS ──────────────────────────────────────────────────
//
//   · une poussée FORCÉE : la référence de destination est nommée sans `+`,
//     une branche qui existe déjà là-bas fait échouer la poussée, et c'est dit ;
//   · un écrasement sur le nœud : la branche naît par `update-ref` avec une
//     ancienne valeur VIDE — si elle existe déjà, c'est un refus ;
//   · une autre référence que `hive/mission-<projectId>-<n>` : le nom est
//     composé ICI, depuis un `projectId` validé par le protocole ;
//   · une poussée vers une autre adresse que le `repoUrl` du hub, validé par
//     le protocole (`isValidRepoUrl`) — jamais l'`origin` que le clone dirait ;
//   · une poussée sans le consentement de l'opérateur du nœud : le hub peut
//     le prétendre, le nœud relit le sien ;
//   · un identifiant dans un message : tout ce qui remonte au hub est lavé
//     (`laverIdentifiantsDuTexte`), et le dépôt durable ne garde que l'URL
//     lavée du dépôt du projet.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DELAI_RESEAU_MS } from '../shared/butoirs-noeud.js';
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
import { EchecGitHote, commandeSshDuMembre, gitHote } from '../shared/git-protege.js';
import type { DepotEpingle, IdentiteCommit } from '../shared/git-protege.js';

/**
 * L'identité des commits de mission : la RUCHE, pas l'opérateur du nœud.
 *
 * Le code vient des agents, l'intégration de la ruche ; l'attribuer à la
 * personne qui prête sa machine serait faux, et dépendre de SA configuration
 * git ferait échouer la livraison sur un poste où `user.email` n'est pas
 * réglé. `.invalid` est le domaine réservé qui ne répond jamais (RFC 2606) :
 * l'adresse ne prétend pas être une boîte aux lettres.
 */
const IDENTITE_RUCHE: IdentiteCommit = {
  GIT_AUTHOR_NAME: 'Hive',
  GIT_AUTHOR_EMAIL: 'hive@hive.invalid',
  GIT_COMMITTER_NAME: 'Hive',
  GIT_COMMITTER_EMAIL: 'hive@hive.invalid',
};

/**
 * La référence qui porte le commit d'un dépôt à l'autre — jamais une branche.
 * `fetch` ne transporte que ce qu'une référence nomme ; celle-ci n'est pas
 * sous `refs/heads/`, donc aucune branche n'existe avant que la mission ne
 * soit GARDÉE.
 */
const REF_TRANSIT = 'refs/hive/livraison';

/** Ce que le nœud apporte à une livraison, en plus de la demande du hub. */
export interface LivraisonDuNoeud {
  demande: DemandeLivraisonLocale;
  /**
   * L'adresse du dépôt du projet : le `repoUrl` du message `assign_merge`,
   * validé par le protocole — celui-là même qui a été cloné. C'est la SEULE
   * adresse vers laquelle on liste et on pousse (cf. en-tête).
   */
  depotProjet: string;
  /** Dépôt nu DURABLE du projet sur ce nœud (`<workRoot>/livraisons/<id>.git`). */
  depotLocal: string;
  /** L'opérateur de CE nœud a-t-il consenti à pousser ? Relu ici, jamais cru du hub. */
  pousseeConsentie: boolean;
}

/** La mission composée AVANT les tests : il ne reste qu'à la garder, ou à l'oublier. */
export interface MissionComposee {
  etat: 'composee';
  branche: string;
  commit: string;
  /** Le dépôt nu de transit qui porte le commit, hors du clone (`runMerge` l'efface). */
  transit: string;
}

/** Un motif qui remonte au hub : lavé de tout identifiant, borné. */
export function motifLave(texte: string): string {
  return laverIdentifiantsDuTexte(texte).trim().slice(0, LIMITS.arg) || 'échec sans message';
}

const messageDe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Une commande git qui parle au dépôt distant, plafonnée à `DELAI_RESEAU_MS`.
 *
 * Lancée dans `baseDir` — le transit ou le dépôt durable, jamais le clone —
 * pour que git n'y lise que la configuration écrite par le nœud. Par
 * `gitHote`, comme le clone : mêmes identifiants, même `ssh` du membre en mode
 * lot — une poussée SSH qui attendrait une phrase de passe figerait le merge.
 * Le plafond atteint devient une phrase qui dit quoi faire, pas un signal.
 */
async function auDepotDistant(baseDir: string, args: string[]): Promise<string> {
  const ssh = await commandeSshDuMembre(baseDir);
  try {
    return await gitHote(args, baseDir, { ssh, delaiMs: DELAI_RESEAU_MS });
  } catch (err) {
    if (!(err instanceof EchecGitHote && err.delaiDepasse)) throw err;
    throw new Error(
      `le dépôt du projet n’a pas répondu en ${DELAI_RESEAU_MS / 1000} s (git ${args[0]}) — ` +
        'des identifiants attendus sur ce nœud ? Enregistrez-les dans son assistant git, puis relancez',
      { cause: err },
    );
  }
}

/**
 * Où la référence de transit pointe dans le dépôt nu `ou` — vide si elle n'y
 * est pas (`rev-parse -q` : code 1, sans un mot). C'est cette relecture, pas
 * le code de sortie d'un `fetch`, qui prouve qu'un commit est à l'abri.
 */
async function refDe(ou: string): Promise<string> {
  try {
    return (await gitHote(['rev-parse', '--verify', '-q', REF_TRANSIT], ou)).trim();
  } catch (e) {
    if (e instanceof EchecGitHote && e.code === 1) return '';
    throw e;
  }
}

/**
 * PREMIER TEMPS, avant la préparation et les tests : compose le commit de la
 * mission et le met à l'abri dans le dépôt de transit.
 *
 * Ne lève pas : un échec est un rapport `non_commitee` qui porte son motif.
 */
export async function composerMission(opts: {
  /**
   * Le clone jetable du merge, ÉPINGLÉ (`epinglerClone`), HEAD = base
   * intégrée — que seuls `clone` et `apply` ont touché. Par `gitHote` : lancé
   * DEPUIS son arbre, un git de Windows prendrait le `git.exe` qu'un diff y
   * aurait livré, et un `core.hooksPath` relatif du membre y trouverait le
   * `reference-transaction` qu'un diff y aurait posé (`update-ref`).
   */
  clone: DepotEpingle;
  /** L'arbre capturé après application des diffs. */
  arbre: string;
  /** Où créer le dépôt nu de transit — HORS du clone. */
  transit: string;
  livraison: LivraisonDuNoeud;
  /** Ce que `Hive-Tests` dira si le commit est gardé (cf. en-tête). */
  tests: TestsLivres;
}): Promise<MissionComposee | RapportDuNoeud> {
  const { demande, depotLocal, depotProjet } = opts.livraison;
  const { clone } = opts;
  try {
    await gitHote(['init', '--bare', '--quiet', opts.transit], path.dirname(opts.transit));

    // ─── LE NUMÉRO : ni d'ici, ni de là-bas, ni du journal du hub ──────────
    // `ls-remote` vise le `repoUrl` du hub, depuis le transit : jamais l'`origin`
    // du clone. Après un clone réussi, il n'échoue qu'en cas de vraie panne ;
    // on ne devine pas alors un numéro qui pourrait déjà être pris là-bas.
    const locales = existsSync(path.join(depotLocal, 'HEAD'))
      ? await gitHote(['for-each-ref', '--format=%(refname)', 'refs/heads/hive/'], depotLocal)
      : '';
    const distantes = (await auDepotDistant(opts.transit, ['ls-remote', '--heads', depotProjet]))
      .split('\n')
      .map((l) => l.split('\t')[1] ?? '');
    const n = Math.max(
      demande.numeroMin ?? 1,
      numeroSuivant(demande.projectId, [...locales.split('\n'), ...distantes]),
    );
    const branche = brancheDeMission(demande.projectId, n);

    // ─── LE COMMIT, tant que le clone n'a vu que `clone` et `apply` ─────────
    // Un dépôt VIDE n'a pas de HEAD : la livraison y devient le premier commit.
    // `rev-parse -q` rend une sortie vide sans lever — c'est la sortie qu'on lit.
    const parent = (
      await gitHote(['rev-parse', '--verify', '-q', 'HEAD^{commit}'], clone).catch((e: unknown) => {
        // `-q` sur un dépôt vide : code 1, sans un mot — c'est « pas de parent ».
        if (e instanceof EchecGitHote && e.code === 1) return '';
        throw e;
      })
    ).trim();
    // Le message s'écrit dans le TRANSIT, jamais dans le dossier temporaire du
    // système : il part avec lui, et l'empreinte de Hive sur la machine
    // (`shared/empreinte.ts`) n'y gagne pas un lieu de plus.
    const fichierMessage = path.join(opts.transit, 'HIVE_MESSAGE_MISSION');
    writeFileSync(fichierMessage, messageDeMission(demande, n, opts.tests));
    const commit = (
      await gitHote(
        [
          'commit-tree',
          '--no-gpg-sign',
          opts.arbre,
          ...(parent ? ['-p', parent] : []),
          '-F',
          fichierMessage,
        ],
        clone,
        { identite: IDENTITE_RUCHE },
      )
    ).trim();
    await gitHote(['update-ref', REF_TRANSIT, commit], clone);

    // ─── L'ABRI : le commit quitte le clone AVANT que le code n'y tourne ────
    // `--update-shallow` n'est pas une option de confort. Depuis un clone
    // superficiel, sans lui, git REFUSE la référence… et sort en 0, un simple
    // avertissement à l'appui. D'où la relecture qui suit : c'est elle qui
    // prouve que le commit est à l'abri, pas le code de sortie.
    await gitHote(
      [
        'fetch',
        '--update-shallow',
        '--no-tags',
        '--quiet',
        clone.gitDir,
        `${REF_TRANSIT}:${REF_TRANSIT}`,
      ],
      opts.transit,
    );
    const abrite = await refDe(opts.transit);
    if (abrite !== commit) {
      return {
        etat: 'non_commitee',
        motif: 'le commit de la mission n’a pas pu quitter le clone jetable',
      };
    }
    return { etat: 'composee', branche, commit, transit: opts.transit };
  } catch (err) {
    return { etat: 'non_commitee', motif: motifLave(`livraison impossible : ${messageDe(err)}`) };
  }
}

/**
 * SECOND TEMPS, après des tests qui n'ont rien contredit : range la branche
 * dans le dépôt durable du nœud, puis la pousse si c'est demandé et consenti.
 *
 * Aucune commande ici ne touche le clone. Ne lève pas : chaque issue est un
 * rapport, et un échec porte son motif.
 */
export async function garderMission(
  mission: MissionComposee,
  livraison: LivraisonDuNoeud,
): Promise<RapportDuNoeud> {
  const { demande, depotLocal, depotProjet } = livraison;
  const { branche, commit } = mission;
  try {
    // ─── LE DÉPÔT DURABLE ──────────────────────────────────────────────────
    // Nu : aucune copie de travail à salir, et l'opérateur s'en sert comme
    // d'un distant (`git fetch <chemin> hive/mission-…`, ou `git -C <chemin>
    // push origin hive/mission-…`). Son `origin` est le `repoUrl` du hub,
    // LAVÉ : les identifiants restent à l'assistant de l'opérateur, pas dans
    // un fichier — et une adresse que le code testé aurait écrite dans le
    // clone n'y entre jamais, pas même pour une poussée faite à la main.
    mkdirSync(path.dirname(depotLocal), { recursive: true });
    if (!existsSync(path.join(depotLocal, 'HEAD'))) {
      await gitHote(['init', '--bare', '--quiet', depotLocal], path.dirname(depotLocal));
    }
    const origine = laverIdentifiants(depotProjet);
    if (origine) await gitHote(['config', 'remote.origin.url', origine], depotLocal);

    // ─── LE RANGEMENT : la branche doit survivre au clone ──────────────────
    // Même `--update-shallow`, même relecture qu'à l'abri. Le `+` ne vise que
    // la référence de transit : un reste d'une livraison interrompue ne doit
    // pas bloquer les suivantes, et ce n'est jamais une branche.
    await gitHote(
      [
        'fetch',
        '--update-shallow',
        '--no-tags',
        '--quiet',
        mission.transit,
        `+${REF_TRANSIT}:${REF_TRANSIT}`,
      ],
      depotLocal,
    );
    const rangee = await refDe(depotLocal);
    if (rangee !== commit) {
      return {
        etat: 'non_commitee',
        motif: `la branche ${branche} n’a pas pu être rangée dans le dépôt de livraison du nœud`,
      };
    }
    // Ancienne valeur VIDE : « cette branche ne doit pas exister ». Jamais
    // d'écrasement — une branche déjà là fait échouer, et c'est dit.
    await gitHote(['update-ref', `refs/heads/${branche}`, commit, ''], depotLocal);
    // Un reste de transit ne livre rien, et la prochaine livraison l'écrase :
    // son effacement raté ne doit pas faire dire « non commitée » à une
    // branche qui existe.
    await gitHote(['update-ref', '-d', REF_TRANSIT], depotLocal).catch(() => undefined);
  } catch (err) {
    return { etat: 'non_commitee', motif: motifLave(`livraison impossible : ${messageDe(err)}`) };
  }

  // ─── LA POUSSÉE : demandée, PUIS consentie ───────────────────────────────
  if (!demande.pousser) return { etat: 'commitee', branche, commit, poussee: 'non_demandee' };
  if (!livraison.pousseeConsentie) {
    return { etat: 'commitee', branche, commit, poussee: 'refusee', motif: CONSENTEMENT_POUSSEE };
  }
  try {
    await auDepotDistant(depotLocal, [
      'push',
      '--no-verify',
      depotProjet,
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
      motif: motifLave(messageDe(err)),
    };
  }
}
