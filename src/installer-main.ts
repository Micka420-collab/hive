// `npm run install:hive` — la partie qui touche au disque et parle à l'humain.
//
// La logique vit dans `installer.ts` (pure, testée) et le dessin dans
// `tui/rendu.ts` (pur, testé). Ce fichier ne fait que lire, écrire, sonder,
// et enchaîner. La séparation permet de tester ce qui décide sans jamais
// risquer d'écraser un `.env` pendant une suite de tests.
//
// ─── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────────
//
// L'installeur affichait une liste : l'utilisateur ne choisissait rien, il
// subissait. Il choisit maintenant son chemin d'entrée, et surtout :
//
//   RIEN N'EST ÉCRIT AVANT UN RÉCAPITULATIF qui nomme les fichiers touchés.
//   C'est ce qui rend un installeur lançable sans peur — et un installeur
//   qu'on n'ose pas lancer n'installe rien.
//
// Les invariants d'avant tiennent tous : aucun `sudo`, rien hors du dossier du
// projet, et un `.env` existant COMPLÉTÉ, jamais écrasé — écraser un jeton en
// service couperait tous les nœuds déjà connectés.

import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { analyser, nonInteractif, type Forme } from './args.js';
import { type ReglagePropose } from './assistant.js';
import { CODE } from './codes-sortie.js';
import { assistant } from './installer-assistant.js';
import { detectBestAgent } from './node-client/agent-detect.js';
import { decider, modeDepuisEnv, trouverFournisseur } from './node-client/isolement.js';
import {
  NODE_MIN,
  PORT_DEFAUT,
  avertissements,
  completerEnv,
  composerReglages,
  lireEnv,
  messagePrerequisNode,
  nodeSuffisant,
  prochainesEtapes,
  rendreEnv,
} from './installer.js';
import {
  banniere,
  constat,
  encadreJeton,
  espacer,
  panneau,
  railPas,
  recapEcritures,
  titreSection,
  type Verification,
} from './tui/rendu.js';
import { Interrompu, ReponseManquante, creerTerminal } from './tui/terminal.js';

const CHEMIN_ENV = path.resolve(process.cwd(), '.env');
const VERSION = '0.2.0';

/** Les drapeaux acceptés. Tout le reste est une erreur, jamais un silence. */
const DRAPEAUX: Record<string, Forme> = {
  yes: 'booleen',
  'dry-run': 'booleen',
  'non-interactive': 'booleen',
  json: 'booleen',
  help: 'booleen',
};

const AIDE = [
  '  npm run install:hive -- [options]',
  '',
  '  --dry-run           montre ce qui serait écrit, n’écrit RIEN',
  '  --yes               ne demande aucune confirmation',
  '  --non-interactive   ne pose AUCUNE question (implicite si CI est posée)',
  '  --json              sortie machine, pour Ansible ou un Makefile',
  '  --help              cette aide',
  '',
  `  Codes de sortie : 0 succès · ${CODE.PREREQUIS} prérequis · ` +
    `${CODE.REPONSE_MANQUANTE} réponse manquante · ${CODE.PORT_OCCUPE} port occupé · ` +
    `${CODE.REFUS_SECURITE} refus de sécurité · ${CODE.INTERROMPU} interrompu.`,
];

/**
 * Écrit un fichier ATOMIQUEMENT : temporaire, puis `rename`.
 *
 * `rename` sur le même système de fichiers est atomique — le lecteur voit
 * l'ancien fichier ou le nouveau, jamais un `.env` à moitié écrit. Sans cela,
 * un `^C` au mauvais moment, ou un disque plein, laisserait une configuration
 * TRONQUÉE : un jeton coupé en deux, une ruche qui refuse de démarrer, et
 * aucune trace de ce qui s'est passé.
 */
function ecrireAtomique(chemin: string, contenu: string, mode: number): void {
  const temporaire = `${chemin}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaire, contenu, { mode });
    renameSync(temporaire, chemin);
  } catch (err) {
    // Ne pas laisser de temporaire derrière soi, même quand ça tourne mal.
    try {
      unlinkSync(temporaire);
    } catch {
      /* le temporaire n'existait pas : rien à nettoyer */
    }
    throw err;
  }
}

/**
 * Le port est-il libre ?
 *
 * Sonder AVANT d'écrire quoi que ce soit : découvrir que le port est pris
 * après avoir engendré un jeton et écrit un fichier, c'est faire porter à
 * l'utilisateur une conséquence qu'on pouvait lui éviter.
 */
async function portLibre(port: number): Promise<boolean> {
  return new Promise((resoudre) => {
    const serveur = createServer();
    serveur.once('error', () => resoudre(false));
    serveur.once('listening', () => serveur.close(() => resoudre(true)));
    serveur.listen(port, '127.0.0.1');
  });
}

/** L'espace libre, en gigaoctets, ou `null` si le système ne sait pas dire. */
async function espaceLibreGo(): Promise<number | null> {
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs(process.cwd());
    return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
  } catch {
    return null;
  }
}

/** Les trois intentions du §5. Un seul programme, trois chemins. */
const CHEMINS = [
  { libelle: 'Ouvrir ma propre ruche', aide: 'orchestrateur + dashboard' },
  { libelle: 'Rejoindre une ruche', aide: 'j’ai reçu un billet' },
  { libelle: 'Installer sur un serveur', aide: 'sans écran' },
];

async function main(): Promise<void> {
  const args = analyser(process.argv.slice(2), DRAPEAUX);
  if (args.erreur) {
    process.stderr.write(`\n✘ ${args.erreur.message}\n\n${AIDE.join('\n')}\n`);
    process.exitCode = args.erreur.code;
    return;
  }
  if (args.drapeaux.has('help')) {
    process.stdout.write(`\n${AIDE.join('\n')}\n`);
    return;
  }
  const simulation = args.drapeaux.has('dry-run');
  const sansQuestion = args.drapeaux.has('yes');
  const json = args.drapeaux.has('json');
  // `--json` implique le silence : mêler des questions à une sortie machine
  // n'a pas de sens, et une sortie machine mêlée de prose n'est plus machine.
  const muet = nonInteractif(args, process.env) || json;

  /** Ce que `--json` rendra. Rempli au fil de l'eau, écrit une seule fois. */
  const fait: Record<string, unknown> = { version: VERSION, dryRun: simulation };

  const t = creerTerminal({
    entree: process.stdin,
    sortie: process.stdout,
    env: process.env,
  });
  // `--non-interactive` et `CI` retirent l'interactivité même sur un vrai
  // terminal : c'est ce qui rend l'installeur scriptable depuis un poste.
  const caps = muet ? { ...t.caps, interactif: false, cadres: false } : t.caps;

  // « Une ligne vide avant et après chaque bloc. La densité, c'est du bruit. »
  // (§6.1) `espacer` sépare à l'intérieur d'un bloc ; ce helper sépare les
  // blocs entre eux, y compris quand ils sont écrits par des appels distincts.
  // En `--json`, la prose est supprimée : la sortie doit être analysable par
  // `jq` sans filtre préalable.
  const bloc = (...morceaux: string[][]): void => {
    if (!json) t.ecrire(['', ...espacer(...morceaux)]);
  };

  bloc(banniere(VERSION, caps));

  // ─── 1. Les prérequis ──────────────────────────────────────────────────────
  // On refuse tôt et on dit quoi faire : un plantage de `tsx` trois étapes
  // plus loin n'apprendrait rien à personne.
  if (!nodeSuffisant(process.version)) {
    bloc([
      constat(
        { etat: 'echec', libelle: `Node ${process.version}`, note: `(${NODE_MIN} minimum)` },
        caps,
      ),
      '',
      // Le texte vit dans le module pur : c'était le dernier endroit où le
      // plancher de Node était écrit en dur, et le seul que la personne
      // bloquée COPIE. Voir `messagePrerequisNode`.
      ...messagePrerequisNode(process.version)
        .slice(1)
        .map((l) => `  ${l}`),
    ]);
    process.exitCode = CODE.PREREQUIS;
    return;
  }

  // Les trois sondes lancent des binaires ; les faire en parallèle plutôt
  // qu'à la queue leu leu économise plusieurs secondes sur une machine où
  // aucun n'est installé (chaque sonde a son propre délai d'attente).
  const departSondes = Date.now();
  const [libre, go, agentDetecte, fournisseur] = await Promise.all([
    portLibre(PORT_DEFAUT),
    espaceLibreGo(),
    detectBestAgent().catch(() => null),
    modeDepuisEnv(process.env) === 'off' ? Promise.resolve(null) : trouverFournisseur(),
  ]);

  const agent = agentDetecte && agentDetecte.agent !== 'shell' ? agentDetecte.label : null;
  const isolement = decider(modeDepuisEnv(process.env), fournisseur);

  const verifs: Verification[] = [
    { etat: 'fait', libelle: `Node ${process.version}`, note: `(${NODE_MIN} minimum)` },
    libre
      ? { etat: 'fait', libelle: `Port ${PORT_DEFAUT} libre` }
      : { etat: 'alerte', libelle: `Port ${PORT_DEFAUT}`, valeur: 'déjà occupé' },
    ...(go === null
      ? []
      : [{ etat: 'fait' as const, libelle: 'Espace disque', valeur: `${go.toFixed(1)} Go` }]),
    agent
      ? { etat: 'fait', libelle: 'Agent de codage', valeur: agent }
      : { etat: 'avenir', libelle: 'Agent de codage', valeur: 'aucun — mode simulé, sûr' },
    {
      etat: isolement.isole ? 'fait' : 'avenir',
      libelle: 'Bac à sable',
      valeur: isolement.isole
        ? (fournisseur?.nom ?? 'actif')
        : 'aucun moteur — sandbox de processus',
    },
  ];

  // ─── LE RAIL, ICI AUSSI ────────────────────────────────────────────────────
  //
  // Les deux scripts d'installation portent une colonne continue depuis leur
  // première ligne ; celui-ci se contentait d'un intertitre atténué. Trois
  // fichiers pour un même accueil, trois présentations : c'est le § 9 bis, et
  // c'est le chemin le mieux testé qui était le plus pauvre.
  //
  // Le chrono n'est pas une coquetterie : les quatre sondes lancent de vrais
  // binaires, et sur une machine où aucun n'est installé elles prennent
  // plusieurs secondes. Sans durée affichée, l'écran a l'air figé.
  bloc([
    ...railPas({ nom: 'Vérifications', etat: 'fait', duree: Date.now() - departSondes }, caps),
    ...verifs.map((v) => constat(v, caps)),
  ]);

  // Un port occupé n'empêche pas d'écrire un `.env`, mais un script doit
  // pouvoir le savoir sans lire la sortie. Le code est posé ici et n'annule
  // rien : la suite reste utile.
  if (!libre) process.exitCode = CODE.PORT_OCCUPE;

  fait.node = process.version;
  fait.port = { numero: PORT_DEFAUT, libre };
  fait.agent = agent;
  fait.isolement = { isole: isolement.isole, moteur: fournisseur?.nom ?? null };

  // ─── 2. Le chemin ──────────────────────────────────────────────────────────
  // Hors terminal, le défaut est « ouvrir ma propre ruche » : c'est ce que
  // faisait l'installeur avant, et c'est ce qu'un `npm run setup` scripté
  // attend. Documenté, donc — pas deviné.
  // Un pas EN COURS : c'est exactement ce qu'il est — on attend une réponse.
  if (caps.interactif) bloc(railPas({ nom: 'Que voulez-vous faire ?', etat: 'curseur' }, caps));
  const chemin = await t.choisir(CHEMINS, {
    quoi: 'le chemin d’entrée (--role queen | node | serveur)',
    defautNonInteractif: 0,
  });

  if (chemin === 1) {
    bloc([
      '  Collez votre billet dans cette commande — tout est dedans, il n’y a',
      '  aucun fichier à éditer :',
      '',
      '      npm run join -- hive2_votre-billet',
      '',
      '  Pas encore de billet ? Demandez-en un à l’hôte de la ruche. Un billet',
      '  est éphémère, à usage compté et révocable — contrairement au jeton,',
      '  qui ne se partage plus.',
    ]);
    return;
  }

  if (chemin === 2) {
    bloc([
      '  Sur un serveur, l’installeur ne pose aucune question et rend un code',
      '  de sortie exploitable :',
      '',
      '      HIVE_TOKEN=… HIVE_JWT_SECRET=… npm run install:hive',
      '      npm run build:dashboard && npm run dev',
      '',
      '  Les secrets passent par l’environnement, jamais en argument : ' + '`/proc/*/cmdline`',
      '  et l’historique du shell sont lisibles par d’autres.',
      '',
      `  Codes de sortie : 0 succès · ${CODE.PREREQUIS} prérequis · ` +
        `${CODE.REPONSE_MANQUANTE} réponse manquante · ${CODE.PORT_OCCUPE} port occupé · ` +
        `${CODE.REFUS_SECURITE} refus de sécurité · ${CODE.INTERROMPU} interrompu.`,
    ]);
    return;
  }

  // ─── 3. Chemin A : ouvrir sa propre ruche ─────────────────────────────────
  const existant = existsSync(CHEMIN_ENV) ? lireEnv(readFileSync(CHEMIN_ENV, 'utf8')) : new Map();
  const neuf = !existsSync(CHEMIN_ENV);
  const reglages = composerReglages(existant);
  const ajoutees = reglages.filter((r) => !existant.has(r.cle)).map((r) => r.cle);

  fait.env = {
    chemin: path.relative(process.cwd(), CHEMIN_ENV),
    action: neuf ? 'cree' : ajoutees.length === 0 ? 'inchange' : 'complete',
    clesAjoutees: ajoutees,
  };

  if (!neuf && ajoutees.length === 0) {
    bloc([constat({ etat: 'fait', libelle: '.env déjà complet — rien touché' }, caps)]);
  } else {
    // LE RÉCAPITULATIF, AVANT L'ÉCRITURE. Il nomme le fichier et dit ce qui
    // lui arrive : « créé » et « complété de trois clés » ne se valent pas.
    bloc(
      recapEcritures(
        [
          neuf
            ? `${path.relative(process.cwd(), CHEMIN_ENV)} — créé (permissions 0600)`
            : `${path.relative(process.cwd(), CHEMIN_ENV)} — complété : ${ajoutees.join(', ')}`,
        ],
        caps,
      ),
    );

    if (simulation) {
      bloc([constat({ etat: 'avenir', libelle: '--dry-run : rien n’a été écrit.' }, caps)]);
      if (json) process.stdout.write(`${JSON.stringify(fait, null, 2)}\n`);
      return;
    }

    // Sur un `.env` EXISTANT, le défaut prudent est de ne rien faire : on
    // touche à la configuration de quelqu'un. Sur un fichier neuf, il n'y a
    // rien à perdre — la question serait une friction sans contrepartie.
    if (!neuf && caps.interactif && !sansQuestion) {
      const suite = await t.choisir(
        [{ libelle: 'Ne rien changer', aide: 'défaut' }, { libelle: 'Compléter le fichier' }],
        { quoi: 'la confirmation d’écriture', defautNonInteractif: 0 },
      );
      if (suite === 0) {
        bloc([constat({ etat: 'avenir', libelle: 'Rien écrit.' }, caps)]);
        return;
      }
    }

    // COMPLÉTÉ, pas régénéré : les commentaires, l'ordre et la mise en forme
    // de l'humain survivent. Régénérer préservait les valeurs mais effaçait
    // tout le reste — et rendait fausse l'idempotence octet pour octet.
    ecrireAtomique(
      CHEMIN_ENV,
      neuf ? rendreEnv(reglages) : completerEnv(readFileSync(CHEMIN_ENV, 'utf8'), reglages),
      0o600,
    );
    bloc([
      constat(
        {
          etat: 'fait',
          libelle: neuf ? '.env créé' : '.env complété',
          valeur: neuf ? 'jeton et secret engendrés au hasard' : 'vos valeurs sont intactes',
        },
        caps,
      ),
    ]);
  }

  // Le jeton n'est montré QU'UNE FOIS, et seulement s'il vient d'être
  // engendré. Le ré-afficher à chaque installation en ferait une chose banale
  // qu'on laisse traîner dans un scrollback.
  if (neuf) {
    const jeton = reglages.find((r) => r.cle === 'HIVE_TOKEN')?.valeur ?? '';
    if (jeton !== '') bloc(encadreJeton(jeton, caps));
  }

  for (const a of avertissements(reglages)) {
    bloc([constat({ etat: 'alerte', libelle: a }, caps)]);
  }

  // ─── 4. L'assistant : la mise en ligne, puis le premier projet ────────────
  //
  // Il ne tourne qu'en interactif. Hors terminal, poser des questions n'a pas
  // de sens et deviner des réponses en aurait encore moins : `npm run setup`
  // scripté s'arrête ici, exactement comme avant.
  //
  // Le déroulé vit dans `installer-assistant.ts` — pas par goût du rangement :
  // ce fichier-ci LANCE l'installeur dès qu'on l'importe, donc rien de ce qu'il
  // contient n'est atteignable par un test. C'est exactement pour ça qu'une
  // quatrième décision a pu s'y installer sans que rien ne rougisse.
  if (caps.interactif && !simulation) {
    await assistant({ t, bloc, caps, reglages, neuf, scribe: ecrireReglages });
  }

  // ─── LA RÉPONSE À « ET MAINTENANT ? » NE SE CHERCHE PAS DANS LE DÉFILEMENT ──
  //
  // Une installation qui se termine laisse la personne devant une question. Un
  // intertitre atténué se perd dans la remontée d'écran ; un cadre est le seul
  // endroit qui survit au coup d'œil.
  bloc(panneau('Et maintenant', prochainesEtapes(agent), caps), [
    '  Votre code et vos clés d’API restent sur cette machine.',
  ]);

  if (json) {
    fait.code = process.exitCode ?? CODE.SUCCES;
    process.stdout.write(`${JSON.stringify(fait, null, 2)}\n`);
  }
}

/**
 * Écrit des réglages dans le `.env` SANS toucher au reste.
 *
 * Les valeurs existantes sont remplacées sur place, les nouvelles ajoutées en
 * fin de fichier : les commentaires, l'ordre et la mise en forme de l'humain
 * survivent. Régénérer le fichier entier les effacerait — ce qui reste à
 * corriger dans le chemin principal (lot 4).
 */
function ecrireReglages(reglages: readonly ReglagePropose[]): void {
  let contenu = existsSync(CHEMIN_ENV) ? readFileSync(CHEMIN_ENV, 'utf8') : '';
  const ajouts: string[] = [];
  for (const r of reglages) {
    const motif = new RegExp(`^\\s*(?:export\\s+)?${r.cle}\\s*=.*$`, 'm');
    if (motif.test(contenu)) contenu = contenu.replace(motif, `${r.cle}=${r.valeur}`);
    else ajouts.push(`# ${r.pourquoi}`, `${r.cle}=${r.valeur}`, '');
  }
  if (ajouts.length > 0) {
    contenu = `${contenu.replace(/\s*$/, '')}\n\n# ─── Posé par l’assistant ───\n${ajouts.join('\n')}`;
  }
  writeFileSync(CHEMIN_ENV, contenu, { mode: 0o600 });
}

main().catch((err: unknown) => {
  // Un `^C` n'est pas un échec : c'est une réponse. Le confondre avec une
  // erreur ferait réessayer un script de supervision.
  if (err instanceof Interrompu) {
    process.stdout.write('\nAnnulé. Rien n’a été écrit.\n');
    process.exitCode = CODE.INTERROMPU;
    return;
  }
  if (err instanceof ReponseManquante) {
    process.stderr.write(`\n${err.message}\n`);
    process.exitCode = CODE.REPONSE_MANQUANTE;
    return;
  }
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = CODE.ERREUR;
});
