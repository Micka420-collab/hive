// `npm run ruche` — le lanceur, et ses deux promesses de vie et de mort.
//
// ─── CE QUE `demarrage.ts` NE POUVAIT PAS PROUVER ────────────────────────────
//
// La composition (quelles pièces, quels chemins) est pure et éprouvée. Ce que
// personne n'avait jamais lancé, ce sont les deux promesses IMPURES de
// `scripts/ruche.mjs`, celles qui font la différence entre un outil et un
// piège :
//
//   1. « ^C arrête tout » — sans elle, un hub reste accroché à son port et le
//      démarrage suivant échoue sur « port occupé », une panne qu'on met dix
//      minutes à relier à sa cause ;
//   2. « la mort d'un seul emporte les autres » — sans elle, une ruche au hub
//      mort laisse une ouvrière reconnecter dans le vide et croire que ça
//      tourne.
//
// On lance donc LE VRAI FICHIER, en Node nu — c'est son mode d'emploi — sur la
// Reine seule (`--sans-ecran --sans-noeud`) : la promesse ne dépend pas du
// nombre d'enfants, et Vite coûterait dix secondes par test pour ne rien
// prouver de plus.
//
// POSIX seulement : les deux tests parlent en signaux, et sous Windows
// `kill('SIGINT')` termine sans passer par les gestionnaires — on y mesurerait
// notre coup de grâce, pas l'arrêt du lanceur (même raison que
// `reine-demarrage.test.ts`).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const LANCEUR = path.join(RACINE, 'scripts', 'ruche.mjs');
const POSIX = process.platform !== 'win32';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Issue {
  code: number | null;
  sortie: string;
}

/**
 * Lance la ruche, attend un marqueur, exécute `alors`, recueille la fin.
 *
 * Tout est borné : marqueur sous 30 s, fin sous 15 s après le geste — un
 * lanceur qui ne meurt pas est précisément la panne qu'on cherche.
 */
function lancerRuche(
  args: string[],
  env: NodeJS.ProcessEnv,
  marqueur: string,
  alors: (pid: number) => void,
): Promise<Issue> {
  return new Promise((resoudre, rejeter) => {
    const proc = spawn(process.execPath, [LANCEUR, ...args], {
      cwd: RACINE,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    let fini = false;
    let vu = false;
    const finir = (v: Issue | null, e?: Error): void => {
      if (fini) return;
      fini = true;
      if (e) rejeter(e);
      else resoudre(v as Issue);
    };
    const boucherMarqueur = setTimeout(() => {
      proc.kill('SIGKILL');
      finir(null, new Error(`marqueur « ${marqueur} » jamais vu :\n${sortie}`));
    }, 30_000);
    boucherMarqueur.unref?.();
    const lire = (m: Buffer): void => {
      sortie += m.toString('utf8');
      if (!vu && sortie.includes(marqueur)) {
        vu = true;
        clearTimeout(boucherMarqueur);
        alors(proc.pid as number);
        const boucherFin = setTimeout(() => {
          proc.kill('SIGKILL');
          finir(null, new Error(`le lanceur ne meurt pas après le geste :\n${sortie}`));
        }, 15_000);
        boucherFin.unref?.();
      }
    };
    proc.stdout.on('data', lire);
    proc.stderr.on('data', lire);
    proc.on('error', (e) => finir(null, e));
    proc.on('close', (code) => finir({ code, sortie }));
  });
}

function envRuche(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  const donnees = mkdtempSync(path.join(tmpdir(), 'ruche-lanceur-'));
  aNettoyer.push(donnees);
  return {
    ...env,
    HIVE_PORT: '0',
    HIVE_DB: path.join(donnees, 'ruche.db'),
    HIVE_TOKEN: 'jeton-du-lanceur-suffisamment-long-pour-le-test',
    HIVE_JWT_SECRET: 'secret-du-lanceur-suffisamment-long-pour-le-test',
    ...extra,
  };
}

describe('le lanceur de la ruche — vie et mort', () => {
  it.runIf(POSIX)(
    '^C ARRÊTE TOUT — bannière, Reine en ligne, arrêt dit, code 0',
    async () => {
      // Le marqueur est la bannière du HUB, préfixée par le lanceur : elle
      // prouve à la fois que l'enfant a démarré ET que le préfixage par ligne
      // fonctionne (un flux recollé au mauvais endroit couperait la phrase).
      const r = await lancerRuche(['--sans-ecran', '--sans-noeud'], envRuche(), 'en ligne', (pid) =>
        process.kill(pid, 'SIGINT'),
      );
      expect(r.sortie).toContain('La ruche démarre');
      expect(r.sortie, 'l’arrêt doit se dire').toContain('Arrêt de la ruche…');
      expect(r.code, `un ^C n’est pas un échec :\n${r.sortie}`).toBe(0);
    },
    60_000,
  );

  it.runIf(POSIX)(
    'LA MORT DU HUB EMPORTE LA RUCHE — dite, et en code non nul',
    async () => {
      // On occupe un port et on l'impose au hub : il meurt à l'allumage. Le
      // lanceur doit LE DIRE (« la ruche s'arrête »), mourir lui-même — le
      // boucher de 15 s ferait échouer un lanceur qui survivrait à son hub —
      // et rendre un code non nul : pour un superviseur, une ruche amputée
      // n'est pas un succès.
      const bouchon: Server = createServer();
      await new Promise<void>((resoudre, rejeter) => {
        bouchon.once('error', rejeter);
        bouchon.listen(0, '127.0.0.1', resoudre);
      });
      const porte = (bouchon.address() as { port: number }).port;
      try {
        const r = await lancerRuche(
          ['--sans-ecran', '--sans-noeud'],
          envRuche({ HIVE_PORT: String(porte) }),
          // Apostrophe DROITE : c'est celle que ruche.mjs imprime. La première
          // version portait la courbe — un marqueur qui ne pouvait pas matcher,
          // et le test ne se résolvait que par la mort du lanceur (le boucher
          // de 30 s aurait masqué un lanceur qui ne meurt pas en panne vague).
          "la ruche s'arrête",
          () => {
            /* rien : la mort du hub EST le geste */
          },
        );
        expect(r.sortie).toContain('arrêté');
        expect(r.code, `une ruche amputée n’est pas un succès :\n${r.sortie}`).not.toBe(0);
      } finally {
        await new Promise((resoudre) => bouchon.close(resoudre));
      }
    },
    60_000,
  );

  it.runIf(POSIX)(
    'UNE REINE QUI SORT EN 0 N’EST PAS UN SUCCÈS DE RUCHE — le lanceur rend non nul',
    async () => {
      // La survivante du balayage loupe du 3 août : `arreter(code === 0 ? 1 :
      // (code ?? 1))` mutée en `!==`. Le test voisin (port occupé) ne la voit
      // pas : son hub meurt en 1, et `1 → 1` des deux côtés du miroir. La
      // branche qui distingue est celle du hub qui sort PROPREMENT (code 0)
      // sans qu'on ait demandé l'arrêt de la ruche : pour un superviseur, une
      // ruche qui perd sa Reine — même poliment — n'est pas un succès. Mutée,
      // le lanceur rendrait 0 et rien ne redémarrerait jamais.
      const r = await lancerRuche(
        ['--sans-ecran', '--sans-noeud'],
        envRuche(),
        'en ligne',
        (pid) => {
          // SIGINT à L'ENFANT seul, pas au lanceur : `pkill -P` vise les enfants
          // directs, et la Reine est le seul ici. Son gestionnaire SIGINT sort
          // en `process.exit(0)` — c'est précisément la prémisse qu'on veut.
          spawn('pkill', ['-INT', '-P', String(pid)], { shell: false });
        },
      );
      // La prémisse est VÉRIFIÉE, pas supposée : mort par code 0, pas par
      // signal — tuée par signal, `code` serait null et `null ?? 1` rendrait 1
      // des deux côtés de la mutation : un test vert pour la mauvaise porte.
      expect(r.sortie, 'la Reine doit être sortie en 0 (prémisse)').toContain('arrêté (code 0)');
      expect(r.sortie).toContain("la ruche s'arrête");
      expect(r.code, `une ruche sans Reine n’est pas un succès :\n${r.sortie}`).not.toBe(0);
    },
    60_000,
  );
});
