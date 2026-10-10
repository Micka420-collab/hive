// Supprimer un projet dont le miroir garde un fichier TENU : la Reine répond
// dans le budget d'`effacerDossier`, et DIT ce qui reste sur son disque.
//
// ─── LA PANNE QUE CE BANC TIENT FERMÉE ───────────────────────────────────────
//
// `Miroir.effacer` effaçait le miroir d'un projet supprimé avec `fs.rm({
// recursive, maxRetries: 10 })`. Le rimraf de Node relance ses reprises à
// CHAQUE niveau (`_rmchildren` rappelle `rimraf`) : un fichier tenu à la
// profondeur p y coûte 11^p essais. Sous Windows, où un fichier tenu rend
// EBUSY — repris —, un pack tenu sous `.git/objects/pack/` faisait attendre
// `DELETE /api/projects/:id` près de 25 heures : la requête pendue, rien sur
// la sortie de la Reine. Le nœud avait le même piège (#538, mesuré) ; les deux
// passent désormais par `shared/effacement.ts`.
//
// ─── UNE TENUE SIMULÉE, SUR LE VRAI CHEMIN ───────────────────────────────────
//
// Sous POSIX, la seule tenue qu'un banc sait poser — un dossier sans droit
// d'écriture — rend EACCES, que Node ne reprend pas : elle ne voit pas la
// multiplication (`suppression-projet.test.ts` l'éprouve pour ce qu'elle
// montre : un refus qui se dit). Ce banc rend donc EBUSY, ce que libuv rend
// sous Windows pour une violation de partage, au seul `unlink` du fichier
// tenu. Tout le reste est vrai : la route, `Miroir.effacer`, `effacerDossier`
// et le rimraf de Node — qui lit `fs.unlink` UNE fois, à son chargement.
// L'interception est donc posée au chargement de ce fichier (d'où un fichier
// à part), avant tout effacement, et elle dort hors de ses cas ; chaque cas
// PROUVE d'abord que la tenue prend, avec le moteur même de la Reine.

import fs, { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

/** Le fichier que le banc tient, et combien d'essais il refuse avant de partir. */
let tenu: { chemin: string; refus: number } | null = null;
/** Les `unlink` qu'a reçus le fichier tenu : un par essai d'effacement. */
let essais = 0;

// L'objet `fs` de Node lui-même — celui que son rimraf lit en se chargeant.
const fsDeNode = fs as { unlink: typeof fs.unlink };
const vraiUnlink = fs.unlink;
fsDeNode.unlink = ((chemin: fs.PathLike, rappel: fs.NoParamCallback): void => {
  if (tenu === null || path.resolve(String(chemin)) !== tenu.chemin || essais++ >= tenu.refus) {
    vraiUnlink(chemin, rappel);
    return;
  }
  const occupe = Object.assign(
    new Error(`EBUSY: resource busy or locked, unlink '${String(chemin)}'`),
    { code: 'EBUSY', syscall: 'unlink', path: String(chemin) },
  );
  process.nextTick(rappel, occupe);
}) as typeof fs.unlink;

/** Tient `fichier` pendant `refus` essais — après avoir prouvé que la tenue prend. */
async function tenir(fichier: string, refus: number): Promise<void> {
  tenu = { chemin: path.resolve(fichier), refus: Infinity };
  // Un rimraf chargé AVANT l'interception effacerait le fichier : un vert
  // sans tenue. La preuve passe par `fs.promises.rm`, le moteur de la Reine.
  await expect(
    rm(fichier),
    'la tenue simulée ne prend pas — le rimraf de Node s’est chargé avant elle',
  ).rejects.toMatchObject({ code: 'EBUSY' });
  essais = 0;
  tenu = { chemin: path.resolve(fichier), refus };
}

const TOKEN = 'jeton-de-ruche-miroir-tenu-assez-long';

describe('un miroir qui garde un fichier tenu ne fige pas la suppression du projet', () => {
  let server: HiveServer;
  let dir: string;
  let entetes: Record<string, string>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-miroir-tenu-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    // Le premier inscrit est administrateur : le jeton de ruche seul ne
    // supprime aucun projet (#527).
    const inscription = await fetch(`http://127.0.0.1:${server.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-assez-long-42',
        displayName: 'Admin',
      }),
    });
    const { token } = (await inscription.json()) as { token: string };
    entetes = { 'x-hive-token': TOKEN, authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    tenu = null;
    fsDeNode.unlink = vraiUnlink;
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Un projet et son miroir sur le disque de la Reine, un fichier posé à `relatif`. */
  const projetAvecMiroir = (
    relatif: readonly string[],
  ): { projet: string; miroir: string; fichier: string } => {
    const projet = server.store.createProject({ name: `Miroir tenu ${relatif.at(-1) ?? ''}` }).id;
    const miroir = path.join(dir, 'rayons', projet);
    const fichier = path.join(miroir, ...relatif);
    mkdirSync(path.dirname(fichier), { recursive: true });
    mkdirSync(path.join(miroir, '.git'), { recursive: true });
    writeFileSync(fichier, 'objet\n');
    return { projet, miroir, fichier };
  };

  const supprimer = async (
    projet: string,
  ): Promise<{ statut: number; miroir: string; ms: number }> => {
    const debut = performance.now();
    const r = await fetch(`http://127.0.0.1:${server.port}/api/projects/${projet}`, {
      method: 'DELETE',
      headers: entetes,
    });
    const { miroir } = (await r.json()) as { miroir: string };
    return { statut: r.status, miroir, ms: performance.now() - debut };
  };

  it.each([
    ['à la racine du miroir', ['tenu.txt']],
    [
      'sous .git/objects/pack — là où git laisse ses packs',
      ['.git', 'objects', 'pack', 'pack-tenu.pack'],
    ],
  ])(
    'tenu %s : onze essais, pas onze puissance la profondeur — puis l’échec se DIT',
    async (_ou, relatif) => {
      const { projet, miroir, fichier } = projetAvecMiroir(relatif);
      await tenir(fichier, Infinity);
      const dits = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { statut, miroir: issue, ms } = await supprimer(projet);
        expect(statut, 'la suppression est rangée : le disque ne la défait pas').toBe(200);
        expect(issue).toBe('echec');
        // L'effacement entier, repris dix fois au sommet : 11 essais à toute
        // profondeur. Les `maxRetries` d'avant en faisaient 11 puissance la
        // profondeur — 161 051 sous `.git/objects/pack/`, près de 25 heures.
        expect(essais, 'essais d’effacement du fichier tenu').toBe(11);
        expect(
          ms,
          'le budget d’effacerDossier (5,5 s d’attente), pas une attente muette',
        ).toBeLessThan(15_000);
        const sortie = dits.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
        expect(sortie, 'l’hôte saurait quoi effacer, et pourquoi').toContain(miroir);
        expect(sortie).toContain('EBUSY');
      } finally {
        dits.mockRestore();
        tenu = null;
      }
      expect(server.store.getProject(projet)).toBeUndefined();
      expect(existsSync(fichier), 'ce que la Reine dit rester est bien resté').toBe(true);
    },
    30_000,
  );

  it('un verrou passager — un antivirus, un git qui se termine — est absorbé, et le miroir part', async () => {
    const { projet, miroir, fichier } = projetAvecMiroir([
      '.git',
      'objects',
      'pack',
      'pack-lache.pack',
    ]);
    await tenir(fichier, 3);
    try {
      const { statut, miroir: issue } = await supprimer(projet);
      expect(statut).toBe(200);
      expect(issue).toBe('efface');
      expect(essais, 'lâché au quatrième essai').toBe(4);
    } finally {
      tenu = null;
    }
    expect(existsSync(miroir)).toBe(false);
  }, 30_000);
});
