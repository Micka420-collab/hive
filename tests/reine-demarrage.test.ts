// `npm run dev` — la Reine démarre, annonce, et s'arrête proprement.
//
// ─── CE QUE LES 29 LIGNES À 0 % DE `orchestrator/main.ts` PORTENT ────────────
//
// `createServer` est couvert par des dizaines de tests. Ce que PERSONNE ne
// lançait, c'est l'enveloppe : le `.env` chargé depuis le répertoire courant
// (le piège que `src/shared/service.ts` documente sur trois paragraphes), la
// bannière qui dit où est l'écran et où est la base, et l'arrêt propre sur
// signal — celui que `systemd` enverra à chaque redémarrage de la machine.
//
// `HIVE_PORT=0` passe la validation de `loadConfigFromEnv` (`port >= 0`) et
// demande un port éphémère au système : deux exécutions concurrentes de la
// suite ne peuvent pas se marcher dessus.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const MAIN = path.join(RACINE, 'src', 'orchestrator', 'main.ts');
const TSX = path.join(RACINE, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const POSIX = process.platform !== 'win32';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossier(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ruche-reine-'));
  aNettoyer.push(d);
  return d;
}

interface Issue {
  code: number | null;
  signal: NodeJS.Signals | null;
  sortie: string;
}

/**
 * Démarre la Reine, attend sa bannière, envoie un signal, recueille la fin.
 *
 * Tout est borné : si la bannière ne vient pas en 30 s ou si l'arrêt ne vient
 * pas en 15 s, on tue et on échoue avec la sortie en main — un test suspendu
 * n'apprend rien.
 */
function demarrerPuisArreter(
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: NodeJS.Signals,
): Promise<Issue> {
  return new Promise((resoudre, rejeter) => {
    const proc = spawn(process.execPath, [TSX, MAIN], {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    let arme = false;
    const boucher = setTimeout(() => {
      proc.kill('SIGKILL');
      rejeter(new Error(`la Reine n'a jamais annoncé « en ligne » :\n${sortie}`));
    }, 30_000);
    boucher.unref?.();
    const lire = (morceau: Buffer): void => {
      sortie += morceau.toString('utf8');
      if (!arme && sortie.includes('en ligne')) {
        arme = true;
        clearTimeout(boucher);
        // Le signal part APRÈS la bannière : l'envoyer pendant le démarrage
        // testerait la course, pas l'arrêt.
        setTimeout(() => proc.kill(signal), 150);
        const boucherArret = setTimeout(() => {
          proc.kill('SIGKILL');
          rejeter(new Error(`la Reine ignore ${signal} :\n${sortie}`));
        }, 15_000);
        boucherArret.unref?.();
      }
    };
    proc.stdout.on('data', lire);
    proc.stderr.on('data', lire);
    proc.on('error', rejeter);
    proc.on('close', (code, sig) => resoudre({ code, signal: sig, sortie }));
  });
}

function envReine(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  return {
    ...env,
    HIVE_PORT: '0',
    HIVE_TOKEN: 'jeton-de-demarrage-suffisamment-long-pour-le-test',
    HIVE_JWT_SECRET: 'secret-de-session-suffisamment-long-pour-le-test',
    ...extra,
  };
}

describe('la Reine — démarrage, bannière, arrêt', () => {
  it.runIf(POSIX)(
    'SIGTERM ARRÊTE PROPREMENT — c’est le signal que systemd enverra',
    async () => {
      // La bannière d'abord (l'écran, la base), puis l'arrêt DIT et code 0.
      // Un service qui meurt en silence ou en erreur ferait redémarrer
      // systemd en boucle (`Restart=on-failure`) sur un arrêt volontaire.
      const cwd = dossier();
      const db = path.join(cwd, 'donnees', 'ruche.db');
      const r = await demarrerPuisArreter(cwd, envReine({ HIVE_DB: db }), 'SIGTERM');
      expect(r.sortie).toContain('orchestrateur (Queen) en ligne');
      expect(r.sortie, 'la bannière ne dit plus où est l’écran').toContain('Dashboard :');
      expect(r.sortie, 'la bannière ne dit plus où vit la base').toContain(db);
      // Apostrophe DROITE : c'est celle que `main.ts` imprime réellement —
      // la typographique d'à côté a fait rougir la première version d'ici.
      expect(r.sortie, 'l’arrêt doit se dire — pas seulement se produire').toContain(
        "arrêt de l'orchestrateur",
      );
      expect(r.code, `un arrêt demandé n’est pas un échec :\n${r.sortie}`).toBe(0);
    },
    60_000,
  );

  it.runIf(POSIX)(
    'LE .env DU RÉPERTOIRE COURANT EST LU — le piège documenté par service.ts',
    async () => {
      // `main.ts` fait `loadEnvFile('.env')` en RELATIF et avale l'échec. Un
      // service lancé du mauvais répertoire démarre « avec succès » sans ses
      // secrets — c'est LA panne que les plans de service verrouillent avec
      // leur WorkingDirectory. Ici, la preuve directe que le bon répertoire
      // suffit : la base annoncée dans la bannière vient du .env posé au cwd,
      // par aucun autre canal.
      const cwd = dossier();
      const db = path.join(cwd, 'depuis-le-env.db');
      writeFileSync(
        path.join(cwd, '.env'),
        `HIVE_DB=${db}\nHIVE_PORT=0\n` +
          `HIVE_TOKEN=jeton-du-env-suffisamment-long-pour-le-test\n` +
          `HIVE_JWT_SECRET=secret-du-env-suffisamment-long-pour-le-test\n`,
        'utf8',
      );
      // AUCUN HIVE_* dans l'environnement : tout doit venir du fichier.
      const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
      for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
      const r = await demarrerPuisArreter(cwd, env, 'SIGINT');
      expect(r.sortie, 'le .env du cwd n’a pas été lu').toContain(db);
      expect(r.code).toBe(0);
    },
    60_000,
  );
});
