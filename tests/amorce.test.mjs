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
import { NODE_MINIMAL, majeure, verdict } from '../scripts/amorce.mjs';

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
