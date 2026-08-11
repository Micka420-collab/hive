// Le README, CONFRONTÉ au dépôt.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Un README ne casse jamais. Il ne fait pas rougir la CI, personne ne le relit
// en entier, et il continue d'affirmer des choses longtemps après qu'elles ont
// cessé d'être vraies. C'est la forme de mensonge la plus durable d'un dépôt :
// celle que tout le monde lit et que rien ne vérifie.
//
// Deux exemples MESURÉS dans ce dépôt, pas hypothétiques :
//
//   · le badge annonçait « 2310 tests » quand il y en avait 2590 ;
//   · le tableau des adaptateurs annonçait `shell` comme le DÉFAUT. C'était
//     exact — et c'était le défaut lui-même : sur la machine de celui qui
//     installe la ruche, un Claude Code installé n'était jamais employé.
//
// ─── LA LEÇON QUI A DONNÉ CE FICHIER SA FORME ────────────────────────────────
//
// En corrigeant ce tableau, j'ai corrigé le README FRANÇAIS. L'anglais a gardé
// l'affirmation démentie, et je ne l'ai vu qu'en allant regarder — rien ne me
// l'aurait dit. Deux documents qui font la même promesse dérivent, et le second
// dérive en silence parce qu'on ne relit que le premier.
//
// D'où la garde centrale ici : **les deux READMEs sont CONFRONTÉS l'un à
// l'autre**, pas seulement vérifiés chacun de son côté.
//
// ─── CE QUE CE FICHIER NE FAIT PAS ───────────────────────────────────────────
//
// Il ne vérifie pas la prose, et ne le peut pas. Il vérifie ce qui est
// VÉRIFIABLE : des liens qui résolvent, des adaptateurs qui existent, deux
// documents qui disent la même chose. Le reste demande un humain, et prétendre
// le contraire donnerait une fausse assurance — ce qui est pire que rien.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getAdapter } from '../src/adapters/index.js';
import type { Releve } from '../src/shared/doctor.js';
import { diagnostiquer } from '../src/shared/doctor.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/**
 * Un relevé quelconque — il ne sert qu'à COMPTER les diagnostics rendus.
 *
 * Aucune valeur n'y est significative : `diagnostiquer` rend toujours la liste
 * complète, chaque entrée portant son verdict. C'est délibérément un relevé
 * bancal (Node trop vieux, jeton absent) pour qu'on ne soit pas tenté d'y lire
 * autre chose qu'une longueur.
 */
const RELEVE_QUELCONQUE: Releve = {
  nodeMajeur: 18,
  fichierEnv: { present: false, lisible: false, permissions: null },
  secretSession: { utilisable: false, longueur: 0, publie: false, simulation: false },
  jeton: { present: false, longueur: 0, trivial: false },
  port: { numero: 7777, libre: true, parNous: null },
  moteur: { manquants: [], raison: null },
  base: { presente: false, integre: false, inscriptible: false },
  dashboardConstruit: false,
  agent: 'shell',
  isolement: 'aucun',
  wsJoignable: false,
  reglages: { runner: 'off', bindPublic: false, gardiennes: 'strict', corsOuvert: false },
  espace: { octetsLibres: 0, inscriptible: false },
};
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

const FR = lire('README.md');
const EN = lire('README.en.md');

/** Les fichiers du dépôt qu'un README prétend pouvoir ouvrir. */
function liens(source: string): string[] {
  const trouves = source.matchAll(/\]\((docs\/[A-Za-z0-9./-]+\.md|[A-Z][A-Z.]*\.md)\)/g);
  return [...new Set([...trouves].map((m) => m[1]!))];
}

/**
 * Les adaptateurs qu'un README annonce, lus dans SA section — et pas ailleurs.
 *
 * Le dépôt a d'autres tableaux dont la première colonne est un `code` : les
 * niveaux d'autonomie (`off`, `propose`…), les genres du Cerveau. Ratisser tout
 * le fichier les ramasserait et ferait échouer la garde sur du texte juste —
 * une garde qui accuse à tort finit désactivée, et c'est pire que pas de garde.
 */
function adaptateurs(source: string, titre: RegExp): string[] {
  const debut = source.search(titre);
  if (debut < 0) return [];
  const suite = source.slice(debut);
  const fin = suite.indexOf('\n## ', 1);
  const section = fin > 0 ? suite.slice(0, fin) : suite;
  return [...section.matchAll(/^\| `([a-z-]+)`/gm)].map((m) => m[1]!);
}

const ADAPTATEURS_FR = adaptateurs(FR, /## .*Agents et mod/);
const ADAPTATEURS_EN = adaptateurs(EN, /## .*Agents and models/);

describe('LES LIENS DU README RÉSOLVENT', () => {
  it.each([
    ['README.md', FR],
    ['README.en.md', EN],
  ])('%s ne renvoie vers aucun fichier absent', (nom, source) => {
    // Un lien mort est la forme la plus banale de pourriture, et la plus
    // humiliante : il suffit de renommer un fichier.
    const morts = liens(source).filter((f) => !existsSync(path.join(RACINE, f)));
    expect(morts, `lien(s) mort(s) dans ${nom}`).toEqual([]);
  });
});

/**
 * Les adaptateurs que `getAdapter` sait vraiment construire.
 *
 * ─── POURQUOI ON NE LE DEMANDE PAS À `getAdapter` LUI-MÊME ───────────────────
 *
 * Première version : appeler `getAdapter(nom)` et regarder s'il jette. Elle
 * accusait les QUATRE vrais adaptateurs d'être inexistants.
 *
 * Ils existent. Ils REFUSENT de se construire sans un `HIVE_TOKEN` solide —
 * une garde de sécurité, et une bonne. Ma sonde confondait deux échecs que
 * tout sépare : « cet adaptateur n'existe pas » et « cet adaptateur refuse de
 * travailler dans ces conditions ». Elle aurait laissé passer un adaptateur
 * supprimé le jour où le jeton de test aurait été faible.
 *
 * On lit donc les `case` du `switch` : c'est le COMPORTEMENT, pas un message
 * qui le raconte.
 */
function adaptateursReels(): string[] {
  const source = lire('src/adapters/index.ts');
  const debut = source.indexOf('export function getAdapter');
  expect(debut, '`getAdapter` est introuvable — la garde ne sait plus où regarder').toBeGreaterThan(
    -1,
  );
  const corps = source.slice(debut, source.indexOf('\n}', debut));
  return [...corps.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
}

describe('LES ADAPTATEURS ANNONCÉS EXISTENT VRAIMENT', () => {
  it('la garde sait de quoi elle parle', () => {
    // ─── UNE GARDE QUI ACCUSE DOIT D'ABORD SAVOIR DE QUOI ELLE PARLE ───────
    //
    // Une garde écrite dans ce dépôt a déjà accusé un fichier à tort, faute de
    // savoir le reconnaître. Si une extraction rend une liste vide, tout le
    // reste passe au vert sans rien vérifier — le pire des deux mondes.
    expect(ADAPTATEURS_FR.length, 'aucun adaptateur lu dans le README FR').toBeGreaterThan(3);
    expect(ADAPTATEURS_EN.length, 'aucun adaptateur lu dans le README EN').toBeGreaterThan(3);
    expect(adaptateursReels().length, 'aucun `case` lu dans `getAdapter`').toBeGreaterThan(3);
  });

  it('LES DEUX LISTES COÏNCIDENT — dans les DEUX sens', () => {
    // Un adaptateur annoncé et absent envoie l'utilisateur sur une commande
    // qui échoue. Un adaptateur présent et jamais documenté n'existe pour
    // personne. Les deux dérives comptent, et une seule assertion les prend.
    expect([...ADAPTATEURS_FR].sort()).toEqual([...adaptateursReels()].sort());
  });

  it('`getAdapter` ne se contredit pas lui-même', () => {
    // Son message d'erreur ÉNUMÈRE les adaptateurs disponibles. C'est une
    // seconde liste, écrite à la main, qui peut dériver du `switch` juste
    // au-dessus — et alors elle enverrait chercher un adaptateur qui n'existe
    // plus, au moment précis où l'on est déjà perdu.
    let message = '';
    try {
      getAdapter('un-adaptateur-qui-n-existe-pas');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message, 'un nom inconnu doit être refusé comme INCONNU').toMatch(/inconnu/i);
    const manquants = adaptateursReels().filter((a) => !message.includes(a));
    expect(manquants, 'adaptateur(s) réel(s) absent(s) du message d’aide').toEqual([]);
  });
});

describe('LES DEUX READMES DISENT LA MÊME CHOSE', () => {
  it('LA MÊME LISTE D’ADAPTATEURS, DANS LE MÊME ORDRE', () => {
    // ─── LA GARDE QUI M'AURAIT ÉVITÉ DE PASSER À CÔTÉ ──────────────────────
    //
    // J'ai corrigé « `shell` est le défaut » dans le README français ; l'anglais
    // a gardé l'affirmation démentie, et rien ne me l'aurait dit. La moitié
    // anglophone des lecteurs serait restée sur ce qui venait d'être mesuré
    // faux.
    //
    // L'ORDRE compte aussi : c'est lui qui porte le message. `shell` en
    // dernier, après les agents réels, dit que c'est le repli — le mettre en
    // tête dirait l'inverse sans qu'un mot change.
    expect(ADAPTATEURS_EN).toEqual(ADAPTATEURS_FR);
  });

  it('NI L’UN NI L’AUTRE NE PRÉSENTE `shell` COMME LE DÉFAUT', () => {
    // C'est l'affirmation exacte qui était vraie, et qui était le défaut :
    // le nœud simulait alors qu'un vrai agent était installé. Elle ne doit
    // pas revenir — dans aucune des deux langues.
    const section = (s: string, t: RegExp): string => {
      const d = s.search(t);
      return d < 0 ? '' : s.slice(d, d + 1500);
    };
    expect(section(FR, /## .*Agents et mod/), 'README FR').not.toMatch(/`shell`.*par défaut/);
    expect(section(EN, /## .*Agents and models/), 'README EN').not.toMatch(/`shell`.*the default/);
  });

  it('LE MÊME COMPTE DE TESTS DANS LES DEUX BADGES', () => {
    // ─── UN CHIFFRE ÉCRIT DEUX FOIS DÉRIVE TOUJOURS ────────────────────────
    //
    // Le badge annonçait « 2310 tests » quand il y en avait 2590. En le
    // corrigeant, j'ai trouvé le MÊME chiffre recopié dans le tableau des
    // commandes, périmé lui aussi — et je ne l'avais pas vu.
    //
    // Ce doublon-là a été SUPPRIMÉ plutôt que gardé synchronisé : on ne met
    // pas une garde sur une duplication qu'on peut effacer. Reste celui qu'on
    // ne peut pas effacer, puisque les deux READMEs sont deux fichiers — et
    // c'est celui-ci qu'on garde.
    const badge = (s: string): string | undefined => /tests-(\d+)%20passing/.exec(s)?.[1];
    expect(badge(FR), 'badge introuvable dans le README FR').toBeDefined();
    expect(badge(EN), 'les deux badges ont divergé').toBe(badge(FR));
  });

  it('LE COMPTE DE TESTS N’EST ÉCRIT QU’UNE FOIS PAR README', () => {
    // La duplication qu'on vient de supprimer ne doit pas revenir : c'est elle
    // qui a permis au chiffre d'être faux à un endroit et juste à l'autre.
    for (const [nom, source] of [
      ['README.md', FR],
      ['README.en.md', EN],
    ] as const) {
      // ─── LE MOTIF A ÉTÉ ÉLARGI DEUX FOIS, POUR DEUX RAISONS ────────────────
      //
      // 1. Il ne connaissait que l'espace (`2 310`), pas la VIRGULE anglaise.
      //    `README.en.md` a donc pu annoncer « 2,310 tests » pendant que la
      //    suite en comptait 3 522 : le banc regardait, et ne voyait rien.
      //
      // 2. Il était indexé sur `2\d{3}` — la valeur du jour où il fut écrit.
      //    Le jour où la suite passe 4 000, un tel motif devient aveugle SANS
      //    que rien ne rougisse. Une garde qui expire en silence est pire que
      //    pas de garde : elle rassure.
      //
      // On accepte donc n'importe quel millier, quel que soit son séparateur.
      const comptes = [...source.matchAll(/\b\d{1,2}[  ,]?\d{3}\b\s+tests?\b/gi)];
      expect(
        comptes.map((m) => m[0]),
        `${nom} répète le compte de tests`,
      ).toEqual([]);
    }
  });

  it('CHAQUE COMMANDE CITÉE EXISTE VRAIMENT DANS package.json', () => {
    // ─── LE TROU QUE CE BANC FERME ─────────────────────────────────────────
    //
    // La table des commandes est ce qu'un arrivant COPIE. Rien ne la recoupait
    // contre les scripts réels : un script renommé, et le README envoie taper
    // une commande qui n'existe pas — sans qu'aucun banc ne rougisse.
    //
    // Mesuré : la table anglaise avait DEUX lignes de moins que la française
    // (`ruche` — « tout en une commande », l'entrée principale du produit — et
    // `fusionner`). Aucune garde ne l'a vu, parce qu'aucune ne regardait.
    //
    // On lit `npm run X` ET `npm test` (qui n'est pas un `run`), puis on exige
    // que chaque nom soit un script déclaré. Ce qui suit un `--` est un
    // ARGUMENT (`npm run cli -- doctor`), pas un script : on ne retient que le
    // premier mot.
    const scripts = new Set(
      Object.keys(
        (
          JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')) as {
            scripts?: Record<string, unknown>;
          }
        ).scripts ?? {},
      ),
    );
    expect(scripts.size, 'aucun script lu dans package.json').toBeGreaterThan(5);

    for (const [nom, source] of [
      ['README.md', FR],
      ['README.en.md', EN],
    ] as const) {
      const cites = new Set(
        [...source.matchAll(/`npm run ([a-z][\w:-]*)/g)].map((m) => m[1] ?? ''),
      );
      // `npm test` est le seul script qu'on n'invoque pas par `run`.
      if (/`npm test`/.test(source)) cites.add('test');

      expect(cites.size, `${nom} ne cite aucune commande npm`).toBeGreaterThan(5);
      const fantomes = [...cites].filter((c) => !scripts.has(c));
      expect(fantomes, `${nom} cite des commandes qui n’existent pas`).toEqual([]);
    }
  });

  it('LES DEUX TABLES DE COMMANDES CITENT LES MÊMES SCRIPTS', () => {
    // La parité de STRUCTURE ne suffit pas : c'est le contenu qui envoie
    // l'anglophone taper la bonne commande. Une entrée présente d'un seul côté
    // est une fonctionnalité invisible pour la moitié des lecteurs — ici,
    // `npm run ruche`, c'est-à-dire la façon dont on démarre le produit.
    const dansTable = (source: string): string[] =>
      [...source.matchAll(/^\| `npm (?:run )?([a-z][\w:-]*)[^|]*\|/gm)]
        .map((m) => m[1] ?? '')
        .sort();
    expect(dansTable(FR), 'la table FR est vide').not.toEqual([]);
    expect(dansTable(EN), 'les deux tables divergent').toEqual(dansTable(FR));
  });

  it('LES DEUX RENVOIENT VERS LE MÊME NOMBRE DE DOCUMENTS', () => {
    // Un document ajouté d'un seul côté est un document que la moitié des
    // lecteurs ne trouvera jamais.
    expect(liens(EN).length, 'un README renvoie vers plus de documents que l’autre').toBe(
      liens(FR).length,
    );
  });

  it('LE NOMBRE DE DIAGNOSTICS ANNONCÉ EST CELUI QUE LE DOCTEUR REND', () => {
    // ─── UN CHIFFRE ANNONCÉ NE VIEILLIT PAS AVEC SON CODE ──────────────────
    //
    // Les deux READMEs promettaient « 12 causes de panne ». Le docteur en
    // rendait TREIZE depuis qu'on lui a ajouté le secret de session — celui
    // dont l'absence tuait la Reine à la seconde, précisément le diagnostic
    // qu'un nouveau venu a le plus besoin de trouver annoncé.
    //
    // Le chiffre n'a pas menti longtemps parce qu'il était faux : il a menti
    // parce que RIEN ne le reliait à la liste. On le relie.
    const rendus = diagnostiquer(RELEVE_QUELCONQUE).length;
    expect(
      rendus,
      'la liste des diagnostics est vide : la garde tournerait à vide',
    ).toBeGreaterThan(5);
    for (const [nom, source, motif] of [
      ['README.md', FR, /\*\*Le docteur\*\* — (\d+) causes de panne/],
      ['README.en.md', EN, /\*\*The doctor\*\* — (\d+) failure causes/],
    ] as const) {
      const annonce = motif.exec(source)?.[1];
      expect(annonce, `${nom} : la ligne du docteur a changé de forme`).toBeDefined();
      expect(
        Number(annonce),
        `${nom} annonce ${annonce} diagnostics, le code en rend ${rendus}`,
      ).toBe(rendus);
    }
  });
});
