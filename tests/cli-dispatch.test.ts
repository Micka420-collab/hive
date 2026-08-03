// LA TABLE DE DISPATCH DU CLI — quarante commandes, trois testées.
//
// ─── CE QUE LA COUVERTURE A MONTRÉ, CHIFFRÉ ──────────────────────────────────
//
// Première mesure de couverture jamais faite sur ce dépôt (3 août) :
// `src/cli.ts` = 728 lignes, 0 % en v8. Le zéro est trompeur — le CLI est
// exercé en SOUS-PROCESSUS, invisible pour v8 — mais l'inventaire réel n'est
// guère meilleur : sur les 40 commandes du dispatch, les tests en lançaient
// TROIS (`replay`, `events`, `mode`). La porte d'entrée du produit reposait sur
// trente-sept branches que rien n'avait jamais empruntées.
//
// ─── CE QUE CE FICHIER GARDE, ET POURQUOI C'EST TESTABLE SANS SERVEUR ────────
//
// 1. LA TABLE ↔ L'USAGE. Le dispatch (chaîne de `else if`) et la ligne
//    « Usage : … » sont DEUX sources indépendantes, maintenues à la main, à
//    trente lignes l'une de l'autre. C'est exactement la paire qui diverge en
//    silence : une commande ajoutée au dispatch et pas à l'usage devient une
//    commande secrète ; retirée du dispatch et pas de l'usage, une promesse
//    morte. On compare la table PARSÉE DE LA SOURCE à l'usage IMPRIMÉ PAR LE
//    PROCESSUS — pas la source à elle-même (§ 2 undecies : une garde dont les
//    deux membres viennent de la même source ne garde rien).
//
//    L'usage portait d'ailleurs un défaut en arrivant : `revoquer <billetId]>`,
//    un crochet à la place du chevron. HONNÊTETÉ DUE : c'est une RELECTURE qui
//    l'a vu, pas ce test — la bijection extrait les noms et ignore les
//    délimiteurs. La garde d'équilibre ci-dessous existe pour que la prochaine
//    fois, ce soit le test ; la mutation nº 5 lui redonne ce crochet et exige
//    qu'elle rougisse.
//
// 2. LES GARDES D'ARGUMENTS. `stings` sans identifiant doit tomber sur l'usage
//    SANS TENTER LE RÉSEAU. La distinction est observable : `HIVE_HTTP` pointe
//    sur un port injoignable, donc si le `&& a1` sautait, la commande partirait
//    en requête et rendrait « Erreur : fetch failed » au lieu de l'usage. Les
//    deux issues s'impriment différemment — c'est ce qui rend la garde
//    mutable-détectable, pas seulement présente.
//
// 3. LE CODE DE SORTIE. Une commande inconnue rend 1. Un script qui enchaîne
//    `hive …` s'appuie là-dessus ; un `exitCode = 0` dans la branche d'erreur
//    ferait passer les fautes de frappe pour des succès.

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join('src', 'cli.ts');

/** Lance le CLI pour de vrai, réseau condamné. */
async function lancer(...args: string[]): Promise<{ code: number; sortie: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', CLI, ...args],
      {
        cwd: RACINE,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          NO_COLOR: '1',
          HIVE_TOKEN: 'jeton-test-suffisamment-long',
          // Port injoignable : toute tentative de requête échoue NETTEMENT,
          // et « Erreur : … » remplace alors l'usage. C'est le témoin qui
          // distingue « la garde a arrêté » de « la garde a laissé passer ».
          HIVE_HTTP: 'http://127.0.0.1:1',
        },
      },
    );
    return { code: 0, sortie: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/**
 * Les commandes que le dispatch reconnaît, lues dans la source.
 *
 * Le repère est COMPTÉ avant d'être cru (§ 2 duodecies, quatre occurrences du
 * contraire en une journée) : chaque `cmd === '…'` du fichier doit être
 * capturé par l'expression, sans doublon. Si le dispatch changeait de forme —
 * un `switch`, une table — ce test rougirait au lieu de parser du vide.
 */
function commandesDuDispatch(): string[] {
  const source = readFileSync(path.join(RACINE, CLI), 'utf8');
  const brutes = source.match(/cmd === '/g) ?? [];
  const noms = [...source.matchAll(/cmd === '([a-z][a-z-]*)'/g)].map((m) => m[1] as string);
  if (noms.length !== brutes.length) {
    throw new Error(`ancre non exhaustive : ${noms.length} noms pour ${brutes.length} repères`);
  }
  if (new Set(noms).size !== noms.length) {
    throw new Error(`doublon dans le dispatch : ${noms.join(', ')}`);
  }
  if (noms.length < 30) {
    throw new Error(`${noms.length} commandes trouvées — le dispatch a changé de forme, relire`);
  }
  return noms;
}

/**
 * Les commandes que l'usage IMPRIMÉ annonce.
 *
 * On découpe sur ` | ` puis on ne retient que les segments qui COMMENCENT par
 * un nom de commande : `cloudflare [--install | --setup <hote>]` contient un
 * ` | ` à l'intérieur de ses crochets, et son second segment commence par
 * `--setup` — qui n'est pas un nom, et se filtre par la forme.
 */
function commandesDeLUsage(sortie: string): string[] {
  const ligne = sortie.split('\n').find((l) => l.includes('Usage :'));
  if (!ligne) throw new Error(`aucune ligne « Usage : » dans :\n${sortie}`);
  const noms: string[] = [];
  for (const segment of ligne.split(' | ')) {
    const m = /(?:^|[<\s])([a-z][a-z-]*)(?:\s|$|\])/.exec(
      segment.replace(/^Usage : npm run cli -- </, ''),
    );
    if (m) noms.push(m[1] as string);
  }
  return noms;
}

/**
 * Les commandes GARDÉES, ÉCRITES EN TOUTES LETTRES.
 *
 * ─── LA PREMIÈRE VERSION S'ADAPTAIT À LA MUTATION QU'ELLE DEVAIT ATTRAPER ────
 *
 * Elle parsait `cmd === 'x' && a1` dans la source et lançait CETTE liste-là.
 * Retirer `&& a1` de `stings` retirait donc `stings` de la liste : la garde
 * tombée, le test cessait de la chercher — vert, mutation survivante, mesuré.
 * Une liste qui vient de la source qu'elle surveille ne surveille rien
 * (§ 2 undecies) ; celle-ci est donc littérale, comme la table de
 * `agent-windows-spawn.test.ts` après la même faute.
 *
 * Le test la confronte quand même à la source : si les deux divergent, l'une a
 * bougé — soit une garde est tombée (le vrai danger), soit une commande neuve
 * mérite sa ligne ici. Dans les deux cas, quelqu'un doit relire.
 */
const GARDEES = [
  'stings',
  'plan',
  'project',
  'brief',
  'tasks',
  'watch',
  'cancel',
  'merge',
  'merge-run',
  'consensus',
  'report',
  'ask',
  'race',
  'conseil',
  'conseil-voir',
  'github-import',
  'livrer',
  'fusionner',
  'exclure',
  'revoquer',
] as const;

function commandesGardeesDansLaSource(): string[] {
  const source = readFileSync(path.join(RACINE, CLI), 'utf8');
  return [...source.matchAll(/cmd === '([a-z][a-z-]*)' && a1/g)].map((m) => m[1] as string);
}

describe('LE DISPATCH DU CLI — la porte d’entrée, enfin empruntée', () => {
  it('UNE COMMANDE INCONNUE REND L’USAGE ET LE CODE 1 — pas une erreur réseau', async () => {
    const r = await lancer('commande-qui-nexiste-pas');
    expect(r.code, 'une faute de frappe doit rendre 1 — un script qui enchaîne s’y fie').toBe(1);
    expect(r.sortie, 'l’usage doit s’afficher').toContain('Usage :');
    expect(r.sortie, 'aucune requête ne doit partir pour une commande inconnue').not.toContain(
      'Erreur :',
    );
  });

  it('AUCUNE COMMANDE DU TOUT : même réponse', async () => {
    const r = await lancer();
    expect(r.code).toBe(1);
    expect(r.sortie).toContain('Usage :');
  });

  it('CE QUE LE DISPATCH RECONNAÎT EST EXACTEMENT CE QUE L’USAGE ANNONCE', async () => {
    // Les deux côtés : la table, parsée de la source ; l'usage, imprimé par le
    // VRAI processus — pas relu dans le même fichier.
    const table = commandesDuDispatch();
    const { sortie } = await lancer('commande-qui-nexiste-pas');
    const usage = commandesDeLUsage(sortie);

    const annonce = new Set(usage);
    const reconnue = new Set(table);
    const secretes = table.filter((c) => !annonce.has(c));
    const mortes = usage.filter((c) => !reconnue.has(c));

    expect(secretes, `commande(s) du dispatch ABSENTES de l’usage : ${secretes.join(', ')}`) //
      .toEqual([]);
    expect(
      mortes,
      `commande(s) de l’usage que le dispatch NE RECONNAÎT PAS : ${mortes.join(', ')}`,
    ).toEqual([]);
    // Et le compte, pour que le parseur ne puisse pas s'éteindre en silence :
    // s'il ne captait plus rien, deux listes vides seraient « égales ».
    expect(table.length, 'le parseur du dispatch ne voit plus rien').toBeGreaterThanOrEqual(30);
    expect(usage.length, 'le parseur de l’usage ne voit plus rien').toBeGreaterThanOrEqual(30);
  });

  it('LES DÉLIMITEURS DE L’USAGE S’ÉQUILIBRENT — le crochet de « billetId » ne revient pas', async () => {
    // Le défaut d'origine : `revoquer <billetId]>` — un `]` orphelin, un `<`
    // jamais refermé. La bijection ne le voyait pas : elle extrait les noms et
    // ignore les délimiteurs. Un placeholder mal fermé est pourtant le genre de
    // détail qu'un nouvel arrivant lit comme « logiciel bâclé », sur la ligne
    // même qui répond à sa première erreur.
    const { sortie } = await lancer('commande-qui-nexiste-pas');
    const ligne = sortie.split('\n').find((l) => l.includes('Usage :')) ?? '';
    const compter = (c: string): number => ligne.split(c).length - 1;
    expect(compter('['), 'crochets déséquilibrés dans l’usage').toBe(compter(']'));
    expect(compter('<'), 'chevrons déséquilibrés dans l’usage').toBe(compter('>'));
  });

  it('LA LISTE DES GARDÉES D’ICI EST CELLE DE LA SOURCE — sinon une garde est tombée', () => {
    // Le désaccord se lit dans les deux sens : une garde retirée de la source
    // rougit ICI (et pas seulement dans le test d'à côté, qui aurait cessé de
    // la chercher) ; une commande gardée toute neuve rougit aussi, pour forcer
    // sa ligne dans la liste littérale.
    expect([...commandesGardeesDansLaSource()].sort()).toEqual([...GARDEES].sort());
  });

  it('CHAQUE COMMANDE GARDÉE, LANCÉE SANS ARGUMENT, S’ARRÊTE À L’USAGE — jamais au réseau', async () => {
    // Le témoin : HIVE_HTTP est injoignable. Si un `&& a1` sautait, la commande
    // partirait en requête et « Erreur : … » remplacerait l'usage. Les vingt
    // sous-processus partent ENSEMBLE — séquentiels, ce test coûterait 30 s.
    // La liste est la LITTÉRALE : elle ne peut pas s'adapter à la mutation.
    const issues = await Promise.all(GARDEES.map(async (c) => ({ c, r: await lancer(c) })));
    for (const { c, r } of issues) {
      expect(r.code, `« ${c} » sans argument doit rendre 1`).toBe(1);
      expect(r.sortie, `« ${c} » sans argument doit rendre l’usage`).toContain('Usage :');
      expect(
        r.sortie,
        `« ${c} » sans argument a TENTÉ LE RÉSEAU — sa garde d’arguments a sauté`,
      ).not.toContain('Erreur :');
    }
  }, 120_000);

  it('« cloudflare » SANS LE BINAIRE : la liste des méthodes, pas « aucune méthode »', async () => {
    // Le balayage du soir : `methodes.length === 0` muté en `!==` inverse le
    // diagnostic — la machine qui A des méthodes d'installation s'entendrait
    // dire « Aucune méthode connue », et l'impasse réelle listerait du vide.
    // Le PATH du sous-processus est NEUTRALISÉ pour que `cloudflared` soit
    // introuvable sur les trois systèmes, machine du développeur comprise :
    // c'est ce qui rend le chemin « pas installé » déterministe (le spawn de
    // `versionCloudflared` rend null sur ENOENT). Les trois plateformes de la
    // CI ont toutes au moins une méthode (apt, winget, brew, binaire local).
    const env: Record<string, string | undefined> = {
      ...process.env,
      NO_COLOR: '1',
      HIVE_TOKEN: 'jeton-test-suffisamment-long',
      HIVE_HTTP: 'http://127.0.0.1:1',
    };
    // Windows nomme la variable `Path` (ou autre casse) : on retire TOUTES
    // ses graphies avant d'en poser une vide, sinon la vraie survivrait.
    for (const cle of Object.keys(env)) if (/^path$/i.test(cle)) delete env[cle];
    env.PATH = '';
    const { code, sortie } = await new Promise<{ code: number; sortie: string }>((resolve) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', CLI, 'cloudflare'],
        { cwd: RACINE, encoding: 'utf8', timeout: 30_000, env },
        (e, stdout, stderr) => {
          const err = e as { code?: number } | null;
          resolve({ code: err?.code ?? 0, sortie: `${stdout}${stderr}` });
        },
      );
    });
    expect(sortie, 'le chemin « pas installé » doit être pris').toContain('Installer cloudflared');
    expect(sortie, 'les méthodes existent : elles se listent').toContain(
      'Puis relancez cette commande',
    );
    expect(sortie, 'une machine outillée ne s’entend pas dire le contraire').not.toContain(
      'Aucune méthode connue',
    );
    expect(code).toBe(0);
  }, 60_000);
});
