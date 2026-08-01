// L'AMORCE — le garde qui doit tenir quand rien n'est installé.
//
// ─── POURQUOI CE FICHIER EST EN JAVASCRIPT NU ────────────────────────────────
//
// C'est le seul test `.mjs` du dépôt, et c'est délibéré : le module qu'il
// éprouve doit s'exécuter sur une archive dézippée où `node_modules` n'existe
// pas. L'écrire en TypeScript exigerait `tsx` pour le lire — donc exactement la
// dépendance dont ce module est chargé de constater l'absence.
//
// ─── CE QUE CES ASSERTIONS DÉFENDENT ─────────────────────────────────────────
//
// Un défaut mesuré sur une vraie machine, le 1er août 2026 :
//
//     PS C:\Users\micki\Desktop\hive-main> npm run ruche
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from
//     C:\Users\micki\Desktop\hive-main\
//
//     PS C:\Users\micki\Desktop\hive-main> npm run cli -- doctor
//     'tsx' n’est pas reconnu en tant que commande interne ou externe
//
// `scripts/ruche.mjs` contenait pourtant, depuis sa première version, un
// contrôle de ce qui manque placé « AVANT de lancer quoi que ce soit ». Il était
// inatteignable : le fichier était lancé par `node --import tsx`, et ce drapeau
// est résolu par Node avant la première instruction du fichier.
//
// Le dernier bloc de ce fichier — « LA PORTE UNIQUE » — est celui qui aurait
// mordu. Il relit `package.json` et refuse qu'un point d'entrée humain
// contourne l'amorce.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NODE_MINIMAL, annoncer, majeure, verdict } from '../scripts/amorce.mjs';

/** Relu depuis une URL, jamais depuis un chemin recomposé (§ 6.1 du journal). */
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const paquet = JSON.parse(lire('../package.json'));

/** Une copie en bon état : tout ce qui suit part de là et casse UNE chose. */
const SAIN = {
  versionNode: `v${String(NODE_MINIMAL)}.18.0`,
  racine: 'C:\\Users\\micki\\Desktop\\hive-main',
  modules: true,
  tsx: true,
};

describe('quand tout va bien, l’amorce se tait', () => {
  it('ne dit RIEN — un garde bavard finit ignoré', () => {
    expect(verdict(SAIN)).toBeNull();
  });

  it('une version PLUS récente que le minimum passe', () => {
    // Le défaut qu'une comparaison de chaînes produirait : « v9 » > « v24 ».
    expect(verdict({ ...SAIN, versionNode: 'v26.4.0' })).toBeNull();
    expect(verdict({ ...SAIN, versionNode: 'v100.0.0' })).toBeNull();
  });
});

describe('CE QUI ARRÊTE, ET CE QUI SE CONTENTE D’AVERTIR', () => {
  it('UNE DÉPENDANCE ABSENTE ARRÊTE', () => {
    // Plus rien ne peut démarrer : s'arrêter ne coûte aucun diagnostic.
    expect(verdict({ ...SAIN, modules: false, tsx: false }).arret).toBe(true);
    expect(verdict({ ...SAIN, tsx: false }).arret).toBe(true);
  });

  it('UN NODE TROP ANCIEN N’ARRÊTE PAS', () => {
    // ─── L'ASSERTION QUI EMPÊCHE DE REFAIRE LE MÊME DÉFAUT PLUS HAUT ────────
    //
    // `hive doctor` tourne encore sous un Node trop ancien, et nomme cette
    // cause parmi douze autres avec la commande `nvm` qui la lève. S'arrêter
    // ici serait un garde qui interdit l'entrée à son propre médecin — la
    // forme exacte du défaut que ce fichier répare.
    const v = verdict({ ...SAIN, versionNode: 'v20.11.0' });
    expect(v.arret).toBe(false);
    expect(v.message).toContain('doctor');
  });

  it('quand les deux tombent, ça arrête — et l’avertissement est dit AUSSI', () => {
    const v = verdict({ ...SAIN, versionNode: 'v20.11.0', modules: false, tsx: false });
    expect(v.arret).toBe(true);
    expect(v.message, 'la version').toContain('v20.11.0');
    expect(v.message, 'et les dépendances').toContain('les dépendances ne sont pas');
  });
});

describe('CE QU’ON FAIT DU VERDICT — écrire, et s’arrêter ou non', () => {
  // ─── LE BLOC QUE LA LOUPE A RÉCLAMÉ ────────────────────────────────────────
  //
  // Ces trois lignes n'étaient éprouvées par rien, et le mutant qui rend le
  // garde MUET — `if (v !== null) return` — a survécu sur une machine en
  // Node 22 tout en mourant en CI sous Node 24. Un mutant dont le sort dépend
  // de la version de Node de la machine ne mesure rien : d'où les deux effets
  // passés en paramètres, et ces trois cas qui tiennent partout.

  /** Un bloc-notes à la place du vrai processus. */
  function espion() {
    const dit = [];
    const sorties = [];
    return { dit, sorties, ecrire: (t) => dit.push(t), sortir: (c) => sorties.push(c) };
  }

  it('RIEN À DIRE : le garde se tait ET ne sort pas', () => {
    const e = espion();
    annoncer(null, e.ecrire, e.sortir);
    expect(e.dit).toEqual([]);
    expect(e.sorties).toEqual([]);
  });

  it('AVERTISSEMENT : ça s’écrit, et surtout ça N’ARRÊTE PAS', () => {
    const e = espion();
    annoncer({ arret: false, message: 'Node est trop ancien' }, e.ecrire, e.sortir);
    expect(e.dit.join('')).toContain('Node est trop ancien');
    expect(e.sorties, 'un avertissement qui arrête n’est pas un avertissement').toEqual([]);
  });

  it('BLOCAGE : ça s’écrit, PUIS ça sort en 2', () => {
    // Le 2 est le code « prérequis absent » de `install.sh` et `install.ps1`,
    // distinct du 1 qui veut dire « ça a planté ». Un script d'intégration qui
    // les confond ne peut plus distinguer les deux.
    const e = espion();
    annoncer({ arret: true, message: 'dépendances absentes' }, e.ecrire, e.sortir);
    expect(e.dit.join('')).toContain('dépendances absentes');
    expect(e.sorties).toEqual([2]);
  });

  it('le message est écrit AVANT la sortie, sinon personne ne le lit', () => {
    const ordre = [];
    annoncer(
      { arret: true, message: 'x' },
      () => ordre.push('écrit'),
      () => ordre.push('sorti'),
    );
    expect(ordre).toEqual(['écrit', 'sorti']);
  });
});

describe('LE NUMÉRO DE VERSION', () => {
  it('se lit avec ou sans « v »', () => {
    expect(majeure('v26.4.0')).toBe(26);
    expect(majeure('24.18.0')).toBe(24);
    expect(majeure('v8.9.0')).toBe(8);
  });

  it('ILLISIBLE NE BLOQUE PAS', () => {
    // Refuser de démarrer parce qu'on n'a pas su lire un numéro de version,
    // ce serait transformer une incertitude en panne. On préfère laisser
    // essayer et échouer plus loin, sur la vraie cause.
    expect(majeure('inconnu')).toBeNull();
    expect(majeure('')).toBeNull();
    expect(verdict({ ...SAIN, versionNode: 'inconnu' })).toBeNull();
    // Et surtout : ça n'arrête pas non plus quand le reste va bien.
    expect(verdict({ ...SAIN, versionNode: 'inconnu', tsx: false }).arret).toBe(true);
  });
});

describe('NODE TROP ANCIEN', () => {
  it('nomme la version vue ET celle qu’il faut', () => {
    const { message } = verdict({ ...SAIN, versionNode: 'v20.11.0' });
    expect(message, 'la version que l’humain a').toContain('v20.11.0');
    expect(message, 'et celle qu’il lui faut').toContain(String(NODE_MINIMAL));
    expect(message, 'et où la prendre').toContain('nodejs.org');
  });

  it('la borne est un « strictement en dessous », pas un « ou égal »', () => {
    expect(verdict({ ...SAIN, versionNode: `v${String(NODE_MINIMAL)}.0.0` })).toBeNull();
    expect(verdict({ ...SAIN, versionNode: `v${String(NODE_MINIMAL - 1)}.99.0` })).not.toBeNull();
  });

  it('IL DIT AUSSI DE REFAIRE L’INSTALLATION', () => {
    // Un `node_modules` bâti sous l'ancienne version garde des binaires natifs
    // liés à la mauvaise ABI. Changer de Node sans réinstaller déplace la panne
    // au lieu de la lever — le dépôt a déjà payé ça avec better-sqlite3.
    expect(verdict({ ...SAIN, versionNode: 'v20.11.0' }).message).toContain('npm install');
  });

  it('L’AVERTISSEMENT VIENT EN PREMIER quand les deux tombent', () => {
    // Installer sous la mauvaise version produit un `node_modules` qu'il faudra
    // refaire : lire « npm install » avant « changez de Node » fait perdre les
    // deux gestes.
    const { message } = verdict({ ...SAIN, versionNode: 'v20.11.0', modules: false, tsx: false });
    expect(message.indexOf('v20.11.0')).toBeLessThan(message.indexOf('ne sont pas installées'));
  });

  it('le minimum annoncé est CELUI DE package.json', () => {
    // Deux endroits énoncent la même exigence. Sans cette confrontation, l'un
    // des deux dérive en silence et le message ment.
    expect(paquet.engines.node).toBe(`>=${String(NODE_MINIMAL)}`);
  });

  it('ET CELUI DU MÉDECIN', async () => {
    // Troisième énoncé de la même exigence : `hive doctor` en fait une de ses
    // douze causes de panne. Deux minima différents donneraient une amorce qui
    // laisse passer ce que le médecin condamne, ou l'inverse.
    const { NODE_MINIMUM } = await import('../src/shared/doctor.js');
    expect(NODE_MINIMUM).toBe(NODE_MINIMAL);
  });
});

describe('RIEN N’EST INSTALLÉ — le cas de l’archive ZIP', () => {
  const { message } = verdict({ ...SAIN, modules: false, tsx: false });

  it('donne LA commande, exécutable telle quelle', () => {
    expect(message).toContain('npm install --no-fund --no-audit');
  });

  it('DIT OÙ, parce que la panne la plus proche est le mauvais dossier', () => {
    expect(message).toContain(SAIN.racine);
  });

  it('ne parle pas de tsx à quelqu’un qui n’a rien installé', () => {
    // Nommer une dépendance de développement à qui n'a pas encore installé
    // enverrait sur une fausse piste.
    expect(message).not.toContain('--include=dev');
  });
});

describe('INSTALLÉ SANS LES OUTILS DE DÉVELOPPEMENT', () => {
  const { message } = verdict({ ...SAIN, modules: true, tsx: false });

  it('NOMME LA CAUSE, pas seulement le symptôme', () => {
    // `npm install` tout court ne répare pas un environnement qui porte
    // `NODE_ENV=production` : npm y omet les dépendances de développement à
    // chaque fois, et l'humain tourne en rond.
    expect(message).toContain('--include=dev');
    expect(message).toMatch(/omit=dev|production/);
  });

  it('dit ce que tsx fait là, sinon le conseil paraît arbitraire', () => {
    expect(message).toContain('tsx');
    expect(message).toContain('TypeScript');
  });
});

describe('LA PORTE UNIQUE — aucun point d’entrée humain ne contourne l’amorce', () => {
  // ─── LE BLOC QUI AURAIT MORDU ──────────────────────────────────────────────
  //
  // Chaque script de `package.json` invoquait `tsx` pour son compte. Chacun
  // était donc une occasion d'oublier le contrôle, et tous l'avaient oublié.

  /** Ce qu'un humain qui découvre le dépôt tape. Le reste est du développement. */
  const HUMAINS = ['ruche', 'cli', 'node', 'join', 'demo', 'install:hive'];

  for (const nom of HUMAINS) {
    it(`« npm run ${nom} » traverse un lanceur qui amorce`, () => {
      const cmd = paquet.scripts[nom];
      expect(cmd, `le script « ${nom} » a disparu`).toBeTypeOf('string');
      expect(cmd).toMatch(/^node scripts\/(lancer|ruche)\.mjs\b/);
    });
  }

  it('AUCUN script n’emploie `--import tsx`', () => {
    // La forme exacte du défaut : Node résout `--import` AVANT la première
    // instruction du fichier lancé. Un contrôle écrit dans ce fichier ne peut
    // pas s'exécuter — le garde est derrière la porte qu'il garde.
    for (const [nom, cmd] of Object.entries(paquet.scripts)) {
      expect(String(cmd), `script « ${nom} »`).not.toContain('--import tsx');
    }
  });

  it('les points d’entrée humains n’appellent pas le BINAIRE tsx', () => {
    // Absent, il rend « 'tsx' n’est pas reconnu en tant que commande interne »
    // — un message qui ne nomme ni le dépôt, ni `npm install`.
    for (const nom of HUMAINS) {
      expect(String(paquet.scripts[nom]), `script « ${nom} »`).not.toMatch(/(^|[\s|&])tsx\s/);
    }
  });

  it('LES TROIS FICHIERS D’AMORÇAGE N’IMPORTENT RIEN QU’ILS N’AIENT', () => {
    // Le cœur de l'affaire : ces fichiers tournent quand `node_modules` n'existe
    // pas. Un seul `import` statique vers une dépendance les rendrait aussi
    // silencieux que ce qu'ils remplacent — les imports statiques sont hissés,
    // donc résolus avant la première instruction, garde compris.
    for (const f of ['../scripts/amorce.mjs', '../scripts/lancer.mjs', '../scripts/ruche.mjs']) {
      const source = lire(f);
      const statiques = [...source.matchAll(/^import\s[^\n]*?from\s+'([^']+)'/gm)].map((x) => x[1]);
      expect(statiques.length, `${f} : aucun import statique lu`).toBeGreaterThan(0);
      for (const spec of statiques) {
        expect(spec.startsWith('node:') || spec.startsWith('./'), `${f} importe « ${spec} »`).toBe(
          true,
        );
      }
    }
  });

  for (const f of ['../scripts/lancer.mjs', '../scripts/ruche.mjs']) {
    it(`${f.slice(3)} ne charge tsx QU’EN DYNAMIQUE, donc après l’amorce`, () => {
      const source = lire(f);
      // Les deux présences AVANT la comparaison : `indexOf` rend −1 pour ce qui
      // manque, et −1 est plus petit que tout. Un garde SUPPRIMÉ passerait donc
      // l'assertion d'ordre — le test aurait menti dans le sens rassurant.
      expect(source, 'le garde doit exister').toContain('exigerAmorce(RACINE)');
      expect(source, 'l’appel doit exister').toContain("await import('tsx/esm/api')");
      expect(source.indexOf('exigerAmorce(RACINE)'), 'le garde vient AVANT').toBeLessThan(
        source.indexOf("await import('tsx/esm/api')"),
      );
    });
  }
});

describe('LA PORTE, TRAVERSÉE POUR DE VRAI', () => {
  // ─── POURQUOI CE BLOC LANCE AU LIEU DE LIRE ────────────────────────────────
  //
  // Tout ce qui précède relit du texte. Ça suffit à empêcher un script de
  // revenir au binaire `tsx`, et ça ne dit RIEN de ce que le lanceur fait une
  // fois lancé. Deux défauts vivent exactement là :
  //
  // 1. L'argv. `src/cli.ts` lit `process.argv.slice(2)` ; sans réécriture il y
  //    trouverait `['src/cli.ts', 'doctor']`, et la commande tapée serait
  //    toujours avalée par le nom du fichier.
  //
  // 2. LE CHEMIN ABSOLU SOUS WINDOWS. `import()` prend un spécificateur, pas un
  //    chemin : `C:\…\cli.ts` est lu comme une URL de schéma `c:` et refusé.
  //
  //        ERR_UNSUPPORTED_ESM_URL_SCHEME — Received protocol 'c:'
  //
  //    Sous Linux et macOS, un chemin absolu commence par `/` et passe. Deux
  //    systèmes sur trois seraient donc VERTS pendant que la ruche serait morte
  //    chez tous les utilisateurs de Windows — c'est-à-dire celui qui a signalé
  //    la panne d'origine. Aucune relecture ne distingue les deux cas ; seul un
  //    lancement le fait, et la CI en fait un sur les trois systèmes.

  const RACINE = fileURLToPath(new URL('..', import.meta.url));

  /** Lance le lanceur pour de bon, et rend ce qu'il a imprimé sur stdout. */
  function lancer(args) {
    return execFileSync(process.execPath, ['scripts/lancer.mjs', ...args], {
      cwd: RACINE,
      encoding: 'utf8',
      // stderr séparé : l'amorce peut y écrire un avertissement de version, et
      // il n'a rien à faire dans ce qu'on compare.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  it('CHARGE UN `.ts` ET LUI DONNE L’ARGV QUE `tsx` LUI AURAIT DONNÉ', () => {
    const sortie = lancer(['tests/fixtures/echo-argv.ts', 'doctor', '--json']);
    expect(JSON.parse(sortie.trim())).toEqual(['doctor', '--json']);
  });

  it('IL IMPORTE UNE URL, PAS UN CHEMIN — la seule garde visible depuis Linux', () => {
    // Le test précédent ne peut PAS attraper le défaut Windows : sous Linux et
    // macOS, un chemin absolu commence par `/` et `import()` l'accepte. Il n'y
    // rougirait jamais, et le lancement sous Windows n'a lieu qu'en CI.
    //
    // Cette assertion-ci n'est donc pas un doublon : c'est ce qui reste quand la
    // seule machine où le défaut existe n'est pas celle qui exécute le test.
    const source = lire('../scripts/lancer.mjs');
    expect(source, 'la conversion chemin → URL doit être explicite').toContain(
      'await import(pathToFileURL(cible).href)',
    );
  });

  it('sans argument, il n’y a pas de commande à taper', () => {
    // Le mutant `entree !== undefined` faisait passer un `undefined` à
    // `path.resolve`, qui jette un TypeError laconique bien plus loin.
    let code = 0;
    let err = '';
    try {
      lancer([]);
    } catch (e) {
      code = e.status;
      err = String(e.stderr);
    }
    expect(code, 'un usage manquant s’arrête').toBe(2);
    expect(err).toContain('usage');
  });

  it('un point d’entrée qui n’existe pas est NOMMÉ, pas deviné', () => {
    let code = 0;
    let err = '';
    try {
      lancer(['src/ce-fichier-n-existe-pas.ts']);
    } catch (e) {
      code = e.status;
      err = String(e.stderr);
    }
    expect(code).toBe(2);
    expect(err).toContain('ce-fichier-n-existe-pas.ts');
  });
});
