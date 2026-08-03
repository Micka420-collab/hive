// « Installé » ne veut pas dire « démarrable » — et les trois scripts doivent le savoir.
//
// ─── LE DÉFAUT, MESURÉ CHEZ UN UTILISATEUR ───────────────────────────────────
//
// Installation Windows parfaitement réussie, avec ceci au passage :
//
//     npm warn allow-scripts 2 packages have install scripts not yet covered:
//     npm warn allow-scripts   better-sqlite3@12.11.1 (install: prebuild-install…)
//
// npm ≥ 11.17 bloque les scripts d'installation par défaut. Le binaire natif de
// `better-sqlite3` n'est donc pas récupéré — et `npm install` sort avec **0**,
// parce que la dépendance est OPTIONNELLE. L'installeur affiche « dépendances
// installées », écrit une configuration, et la ruche mourra au démarrage, très
// loin de là, sur un message que rien ne relie à ce moment-là.
//
// ─── CE QUI REND CE DÉFAUT INSTRUCTIF ────────────────────────────────────────
//
// **Le remède était déjà écrit.** `examples/deploiement-sans-ecran.sh` le porte,
// avec son commentaire : « un code 0 dit que l'installeur n'a pas échoué. Il ne
// dit pas que la ruche peut démarrer — c'est la leçon de l'image qui naissait
// morte ».
//
// La leçon était apprise, écrite, et appliquée — à UN endroit, celui que
// personne ne traverse en installant. Les deux scripts que tout le monde lance
// ne l'avaient pas.
//
// ─── D'OÙ LA FORME DE CE FICHIER ─────────────────────────────────────────────
//
// Il ne garde pas « install.ps1 contient une vérification ». Il garde que les
// TROIS scripts la portent — c'est la seule formulation qui aurait montré le
// trou, puisque chacun pris séparément avait l'air complet.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CODE } from '../src/codes-sortie.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

/** Les scripts qui installent ou déploient — donc qui promettent une ruche qui démarre. */
const SCRIPTS = ['install.sh', 'install.ps1', 'examples/deploiement-sans-ecran.sh'] as const;

/** La source SANS ses commentaires — la prose ne doit rien prouver (§ 2.3). */
function nu(source: string): string {
  return source.replace(/^\s*#.*$/gm, '');
}

describe('LES TROIS SCRIPTS VÉRIFIENT QUE LA RUCHE PEUT DÉMARRER', () => {
  it.each(SCRIPTS)('%s charge les deux dépendances optionnelles pour de vrai', (f) => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Charger, pas compter sur un code de sortie. `better-sqlite3` et `fastify`
    // sont OPTIONNELLES : npm a le droit de les écarter, ou de refuser leur
    // script d'installation, et de réussir quand même.
    const source = nu(lire(f));
    expect(source, `${f} ne charge pas better-sqlite3`).toMatch(
      /require\(['"]better-sqlite3['"]\)/,
    );
    expect(source, `${f} ne charge pas fastify`).toMatch(/require\(['"]fastify['"]\)/);
  });

  it.each(SCRIPTS)('%s traite l’échec comme un PRÉREQUIS manquant, pas une erreur vague', (f) => {
    // Le code 2 se lit : « il manque quelque chose sur cette machine, et
    // réessayer n'y changera rien ». C'est exactement la situation. Un code 1
    // enverrait chercher une panne d'installation là où il n'y a qu'un binaire
    // absent.
    const source = nu(lire(f));
    const codeAttendu = String(CODE.PREREQUIS);
    expect(source, `${f} devrait sortir en ${codeAttendu}`).toMatch(
      new RegExp(`exit (\\$CODE_PREREQUIS|${codeAttendu})`),
    );
  });

  it.each(SCRIPTS)('%s nomme le geste exact, pas « réinstallez »', (f) => {
    // Un diagnostic sans commande à taper laisse l'utilisateur exactement où il
    // était. Ici la cause la plus fréquente est le verrou `allow-scripts` de
    // npm, et sa levée a un nom.
    expect(nu(lire(f)), `${f} devrait nommer la commande de réparation`).toMatch(
      /npm (install|rebuild|approve-scripts)/,
    );
  });

  it.each(['install.sh', 'install.ps1'] as const)(
    '%s conseille `rebuild`, PAS `install` seul',
    (f) => {
      // ─── LE MAUVAIS CONSEIL, MESURÉ ────────────────────────────────────────
      //
      // La première version de ce message disait « npm install ». Chez un
      // utilisateur, ça ne réparait rien :
      //
      //     Error: le module better_sqlite3.node a été compilé pour
      //     NODE_MODULE_VERSION 137. Cette version de Node exige 147.
      //
      // Le paquet ÉTAIT là, à la bonne version ; c'est son binaire natif qui ne
      // correspondait pas à l'ABI du Node utilisé. `npm install` ne touche pas à
      // un paquet déjà installé à la bonne version : il rend 0, et la panne
      // reste entière. C'est le pire genre de conseil — il consomme la
      // confiance de celui qui le suit.
      //
      // Seul `rebuild` refait le binaire.
      expect(nu(lire(f)), `${f} doit conseiller npm rebuild better-sqlite3`).toMatch(
        /npm rebuild better-sqlite3/,
      );
    },
  );

  it.each(['install.sh', 'install.ps1'] as const)('%s ne conseille RIEN qui ne fasse rien', (f) => {
    // ─── DEUX COMMANDES, DONT UNE INUTILE ──────────────────────────────────
    //
    // Ce message en listait deux. La trace d'un utilisateur montre la première
    // ne rien faire :
    //
    //     PS> npm approve-scripts --allow-scripts-pending
    //     2 packages have install scripts not yet covered by allowScripts: …
    //     Run `npm approve-scripts <pkg>` to allow…
    //
    // `--allow-scripts-pending` LISTE, il n'autorise pas. Et la ligne suivante
    // de la même trace montre `npm rebuild better-sqlite3` réussissant SEUL,
    // verrou toujours en place.
    //
    // Une commande qui ne fait rien dans une liste de réparation est pire
    // qu'absente : c'est une occasion de croire qu'on a essayé.
    const source = nu(lire(f));
    expect(source, `${f} conseille une commande qui ne fait que lister`).not.toMatch(
      /allow-scripts-pending/,
    );
  });
});

describe('CE QUE L’INSTALLEUR WINDOWS DIT DE LA POLITIQUE D’EXÉCUTION', () => {
  // ─── LE SECOND DÉFAUT DU MÊME ESSAI ────────────────────────────────────────
  //
  // Toujours chez le même utilisateur, juste après une installation réussie :
  //
  //     npm : Impossible de charger le fichier C:\…\npm.ps1, car l'exécution de
  //           scripts est désactivée sur ce système.
  //
  // Sous Windows, `npm` EST un script PowerShell. Sur une machine en
  // `Restricted` — le défaut de Windows client — les cinq commandes que
  // l'installeur affiche à la fin échouent toutes, alors que l'installation a
  // parfaitement réussi. C'est le pire moment pour buter.
  //
  // Le script lui-même tourne avec `-ExecutionPolicy Bypass` : il ne pouvait
  // donc PAS rencontrer ce mur, et c'est pour ça que ni la CI ni aucun essai ne
  // l'avaient vu. Il faut regarder la politique du SHELL DE L'UTILISATEUR, qui
  // n'est pas la sienne.
  const PS1 = lire('install.ps1');

  it('il la REGARDE', () => {
    expect(PS1).toMatch(/Get-ExecutionPolicy/);
  });

  it('il nomme les deux politiques qui bloquent, et pas une seule', () => {
    // `AllSigned` bloque tout autant que `Restricted` — un `npm.ps1` non signé
    // n'y passe pas. N'en traiter qu'une laisserait la moitié des machines
    // concernées sans avertissement.
    expect(PS1).toMatch(/Restricted/);
    expect(PS1).toMatch(/AllSigned/);
  });

  it('il AVERTIT sans rien changer à la place de l’utilisateur', () => {
    // Changer la politique d'exécution d'une machine n'est pas à nous, et un
    // installeur qui le ferait en silence serait bien plus grave que le mur
    // qu'il évite. On donne la commande ; la personne décide.
    expect(PS1, 'la commande doit être donnée à lire').toMatch(
      /Set-ExecutionPolicy -Scope CurrentUser RemoteSigned/,
    );
    // Elle ne doit pas être EXÉCUTÉE. On cherche un appel, pas la chaîne de
    // caractères qu'on affiche : `Ecrire '…'` et `Dire '…'` sont de l'affichage.
    const executions = [...PS1.matchAll(/^\s*Set-ExecutionPolicy\b/gm)];
    expect(executions, 'l’installeur ne doit PAS changer la politique lui-même').toEqual([]);
  });

  it('il donne la porte de sortie qui ne change rien du tout', () => {
    // `npm.cmd` n'est pas soumis à la politique d'exécution. C'est la réponse
    // pour qui ne veut rien modifier sur sa machine — et elle marche tout de
    // suite, sans redémarrer de terminal.
    expect(PS1).toMatch(/npm\.cmd/);
  });
});

// ─── UNE RUCHE INSTALLÉE MAIS SANS ÉCRAN ─────────────────────────────────────
//
// Mesuré sur un clone vierge le 3 août : l'installation réussit, et
// `hive doctor` ne reproche plus qu'UNE chose — « tableau de bord non
// construit ». Celui qui suit la consigne (`npm run dev`, puis son navigateur)
// recevait alors :
//
//     {"hive":"orchestrateur en ligne","hint":"Dashboard non construit : …"}
//
// Le premier contact avec le produit était un texte de débogage, sur une ruche
// dont toute la promesse est un tableau de bord.
//
// Deux corrections, et donc deux propriétés à tenir : l'installeur CONSTRUIT
// l'écran (1,9 s mesurées, contre ≈ 20 s de `npm install` juste avant), et le
// serveur sert une PAGE plutôt qu'un objet à celui qui arrive quand même sans.
describe('l’écran après une installation', () => {
  const install = readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  const serveur = readFileSync(new URL('../src/orchestrator/server.ts', import.meta.url), 'utf8');

  it('L’INSTALLEUR CONSTRUIT L’ÉCRAN, et APRÈS avoir configuré', () => {
    // L'ordre compte : construire avant que `.env` existe ferait tourner Vite
    // pour une ruche qui n'est peut-être pas configurée.
    // LES DEUX REPÈRES DOIVENT ÊTRE UNIQUES, et ma première version ne l'a pas
    // vérifié : `npm run install:hive --` et `npm run build:dashboard`
    // apparaissent AUSSI dans le bloc `--dry-run` et dans la ligne de conseil.
    // `indexOf` pointait donc sur ces occurrences-là, et déplacer réellement la
    // construction avant la configuration laissait la garde verte. Mesuré :
    // le mutant a survécu.
    //
    // On vise donc les deux APPELS, à leur forme exacte, et on exige leur
    // unicité avant de comparer quoi que ce soit.
    const APPEL_CONFIG = 'npm run install:hive -- $POUR_INSTALLEUR';
    const APPEL_ECRAN = 'npm run build:dashboard >/dev/null';
    const compter = (aiguille: string): number => install.split(aiguille).length - 1;
    expect(compter(APPEL_CONFIG), `repère non unique : ${APPEL_CONFIG}`).toBe(1);
    expect(compter(APPEL_ECRAN), `repère non unique : ${APPEL_ECRAN}`).toBe(1);
    expect(
      install.indexOf(APPEL_ECRAN),
      'l’écran se construit AVANT la configuration',
    ).toBeGreaterThan(install.indexOf(APPEL_CONFIG));
  });

  it('UN ÉCHEC DE CONSTRUCTION N’ANNULE PAS L’INSTALLATION', () => {
    // La ruche TOURNE sans écran : orchestrateur, API, nœuds. Un `vite build`
    // qui échoue ne doit pas transformer une installation réussie en échec —
    // et `set -eu` le ferait sans le `|| CODE=$?`.
    expect(install, 'set -eu a disparu : tout le raisonnement ci-dessous tombe').toMatch(
      /^set -eu$/m,
    );
    // On vise L'APPEL, pas la ligne de conseil : le fichier contient les deux,
    // et découper le script sur un repère approximatif — ma première version
    // coupait sur « accent( », défini cent lignes plus haut — vise à côté.
    const ligne = /^.*npm run build:dashboard\s*>.*$/m.exec(install)?.[0] ?? '';
    expect(ligne, 'appel à build:dashboard introuvable').not.toBe('');
    expect(ligne, 'un échec de construction ferait mourir l’installeur').toMatch(/\|\|\s*\w+=\$\?/);
    // Et il doit DIRE quoi faire, sans quoi l'utilisateur reste avec une ruche
    // muette et aucune piste.
    expect(install, 'l’échec ne redonne pas le geste').toMatch(
      /npm run build:dashboard[\s\S]{0,400}?cd \$DOSSIER && npm run build:dashboard/,
    );
  });

  it('SANS ÉCRAN, LE SERVEUR SERT UNE PAGE — pas un objet JSON', () => {
    // La consigne était déjà là, mot pour mot, dans le JSON. Ce n'est pas
    // l'information qui manquait, c'est la forme : un navigateur affiche
    // l'objet tel quel.
    expect(serveur, 'le repli est redevenu du JSON').not.toMatch(
      /app\.get\('\/', async \(\) => \(\{\s*hive:/,
    );
    expect(serveur, 'le repli ne se déclare plus comme du HTML').toMatch(
      /reply\.type\('text\/html; charset=utf-8'\)/,
    );
    expect(serveur, 'la page de repli ne dit plus la commande').toMatch(
      /<code>npm run build:dashboard<\/code>/,
    );
  });

  it('LA PAGE DE REPLI N’APPELLE PERSONNE À L’EXTÉRIEUR', () => {
    // Une ruche n'émet aucune requête sortante. Une page de secours qui irait
    // chercher une fonte ou une feuille de style trahirait l'adresse de la
    // machine au premier démarrage — c'est-à-dire au pire moment.
    const page = /const PAGE_SANS_ECRAN = `([\s\S]*?)`;/.exec(serveur)?.[1] ?? '';
    expect(page, 'page de repli introuvable').not.toBe('');
    expect(page, 'la page de repli va chercher quelque chose dehors').not.toMatch(
      /https?:\/\/|src=|<link\b/,
    );
    // Et elle doit rester lisible sur un téléphone : c'est une page d'erreur,
    // pas une maquette, mais elle se lit sur ce qu'on a sous la main.
    expect(page, 'pas de viewport : illisible sur téléphone').toMatch(/name="viewport"/);
  });
});
