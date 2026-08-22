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

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { analyser, nonInteractif, type Forme } from './args.js';
import { type ReglagePropose } from './assistant.js';
import { CODE, legendeCodes } from './codes-sortie.js';
import { MODE_SECRET, ecrireAtomique } from './ecriture-atomique.js';
import { assistant } from './installer-assistant.js';
import { detectBestAgent } from './node-client/agent-detect.js';
import { decider, modeDepuisEnv, trouverFournisseur } from './node-client/isolement.js';
import {
  NODE_MIN,
  PORT_DEFAUT,
  avertissements,
  completerEnv,
  composerReglages,
  conseilServeur,
  lireEnv,
  messagePrerequisNode,
  nodeSuffisant,
  portRetenu,
  prochainesEtapes,
  rendreEnv,
} from './installer.js';
import {
  banniere,
  constat,
  constatEnroule,
  encadreJeton,
  espacer,
  panneau,
  railPas,
  recapEcritures,
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
  `  ${legendeCodes()}`,
];

// `ecrireAtomique` vit dans `src/ecriture-atomique.ts` : ce fichier-ci
// s'exécute à l'import (`main().catch(…)` en dernière ligne), donc aucun banc
// ne pouvait l'éprouver — et il porte la seule bonne façon d'écrire un secret.

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
  // ─── UN ^C HORS QUESTION PASSE PAR LE SIGNAL, PAS PAR LE CLAVIER ───────────
  //
  // Pendant une question, l'entrée est en mode brut : le `^C` arrive comme un
  // octet, `choisir` le reconnaît et lève `Interrompu`. Pendant une ATTENTE,
  // l'entrée est normale : le `^C` est un signal, et sans ce gestionnaire Node
  // tue le processus séance tenante — en laissant le curseur caché par le
  // spinner. Le shell rendu ensuite n'a plus de caret. Trouvé en interrompant
  // une vraie installation, pas en relisant le code.
  process.on('SIGINT', () => {
    t.restaurer();
    process.stdout.write('\nAnnulé.\n');
    process.exit(CODE.INTERROMPU);
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

  // ─── ON LIT LE `.env` AVANT DE SONDER, ET C'EST TOUT LE POINT ──────────────
  //
  // L'installeur n'écrase jamais un `.env` : le port qu'il retiendra est celui
  // du fichier existant. Sonder `PORT_DEFAUT` sans condition — ce qu'on faisait
  // — revient à répondre sur une porte que la ruche n'ouvrira pas dès qu'on
  // réinstalle par-dessus un port personnalisé. La décision vit dans
  // `portRetenu`, pure et éprouvée ; ici on ne fait que la respecter.
  const existant = existsSync(CHEMIN_ENV) ? lireEnv(readFileSync(CHEMIN_ENV, 'utf8')) : new Map();
  const portVise = portRetenu(existant);

  // Les trois sondes lancent des binaires ; les faire en parallèle plutôt
  // qu'à la queue leu leu économise plusieurs secondes sur une machine où
  // aucun n'est installé (chaque sonde a son propre délai d'attente).
  const departSondes = Date.now();
  // ─── L'ATTENTE SE VOIT ────────────────────────────────────────────────────
  //
  // Ces quatre sondes lancent de vrais binaires ; sur une machine où aucun
  // agent n'est installé, elles tiennent l'écran plusieurs secondes sans qu'une
  // ligne bouge. Un premier écran figé se lit comme un plantage, et la réaction
  // est `^C` — sur l'installeur, donc avant même la première impression.
  //
  // La ligne d'attente s'efface d'elle-même : le pas définitif, avec sa durée,
  // prend exactement sa place.
  const sondes = Promise.all([
    portVise === null ? Promise.resolve(false) : portLibre(portVise),
    espaceLibreGo(),
    detectBestAgent().catch(() => null),
    modeDepuisEnv(process.env) === 'off' ? Promise.resolve(null) : trouverFournisseur(),
  ]);
  // `caps`, pas `t.caps` : `--json` et `--non-interactive` retirent
  // l'interactivité même sur un vrai terminal, et une animation au milieu d'une
  // sortie machine la rendrait inanalysable.
  const [libre, go, agentDetecte, fournisseur] = caps.interactif
    ? await t.patienter('Vérifications', sondes)
    : await sondes;

  const agent = agentDetecte && agentDetecte.agent !== 'shell' ? agentDetecte.label : null;
  const isolement = decider(modeDepuisEnv(process.env), fournisseur);

  const verifs: Verification[] = [
    { etat: 'fait', libelle: `Node ${process.version}`, note: `(${NODE_MIN} minimum)` },
    // Une valeur illisible n'est ni « libre » ni « occupé » : la taire ferait
    // démarrer une ruche sur un port que personne n'a choisi.
    portVise === null
      ? {
          etat: 'alerte',
          libelle: `HIVE_PORT=${existant.get('HIVE_PORT') ?? ''}`,
          valeur: 'valeur illisible',
        }
      : libre
        ? { etat: 'fait', libelle: `Port ${portVise} libre` }
        : { etat: 'alerte', libelle: `Port ${portVise}`, valeur: 'déjà occupé' },
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
  fait.port = { numero: portVise ?? PORT_DEFAUT, libre };
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
    // Le texte vit dans `installer.ts` (pur) : ici, `main()` court à l'import
    // et aucun test ne peut le lire — c'est là que le `&&` du conseil avait
    // survécu au balayage, invisible.
    bloc(conseilServeur());
    return;
  }

  // ─── 3. Chemin A : ouvrir sa propre ruche ─────────────────────────────────
  // `existant` a été lu avant les sondes (voir plus haut) : le relire ici
  // ouvrirait la porte à deux vérités pour un même fichier.
  const neuf = !existsSync(CHEMIN_ENV);
  const reglages = composerReglages(existant, undefined, undefined, {
    sansAgentReel: !agent,
  });
  const ajoutees = reglages.filter((r) => !existant.has(r.cle)).map((r) => r.cle);

  fait.env = {
    chemin: path.relative(process.cwd(), CHEMIN_ENV),
    action: neuf ? 'cree' : ajoutees.length === 0 ? 'inchange' : 'complete',
    clesAjoutees: ajoutees,
  };

  // Le rail ne s'arrête pas après les vérifications : chaque phase porte sa
  // perle, sinon la colonne se rompt au moment où l'installation commence
  // vraiment — et une colonne qui se rompt ne dit plus où l'on en est.
  if (caps.interactif) bloc(railPas({ nom: 'Votre ruche', etat: 'curseur' }, caps));

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

  // ─── LES AVERTISSEMENTS S'ENROULENT, ILS NE SE COUPENT PLUS ───────────────
  //
  // `constat` coupe à la largeur du terminal. Les deux avertissements de
  // sécurité font 178 et 281 caractères pour une largeur de 76 : 102 et 205
  // caractères perdus, et à chaque fois la moitié qui DIT QUOI FAIRE. On
  // alertait quelqu'un sur le secret qui protège sa ruche en lui coupant la
  // parole au milieu.
  for (const a of avertissements(reglages)) {
    bloc(constatEnroule({ etat: 'alerte', libelle: a }, caps));
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
  // MÊME VOIE que le chemin principal, et pas un `writeFileSync` direct.
  //
  // C'est le chemin INTERACTIF — celui où l'on appuie sur `^C` —, et il écrit
  // le fichier qui porte `HIVE_TOKEN` et `HIVE_JWT_SECRET`. La voie directe y
  // perdait deux choses : l'atomicité (un `^C` laisse un `.env` tronqué), et
  // surtout les DROITS — `mode` n'est honoré qu'à la création, donc un `.env`
  // déjà présent en 644 (ce que produit le `cp .env.example .env` que le
  // docteur conseille) le restait, secrets compris. Mesuré, pas supposé.
  ecrireAtomique(CHEMIN_ENV, contenu, MODE_SECRET);
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
