// LE CLONE D'UN MERGE OU D'UN CHANTIER A UN BUTOIR — ET GIT EST TUÉ À SON TERME.
//
// ─── LE TROU QUE CE BANC FERME ───────────────────────────────────────────────
//
// `cloneRepo` ouvre chaque merge et chaque chantier d'un nœud, et n'avait
// AUCUNE borne. Un dépôt qui accepte la connexion puis se tait laissait le
// travail pendre chez le nœud : ni résultat, ni échec, jamais. Le hub, qui
// dérive ses délais des butoirs du nœud (`butoirs-noeud.ts`), ne pouvait que
// DEVINER la durée du clone — et déclarer perdu un chantier qui tournait
// encore, ou attendre pour toujours un travail qui ne rendrait rien.
//
// ─── CE QUE LE BANC EXIGE ────────────────────────────────────────────────────
//
// Un vrai serveur TCP qui accepte et se tait, servi en `git://` (protocole
// admis par `GIT_ALLOW_PROTOCOL`) : git envoie sa demande et attend une
// réponse qui ne viendra pas. Le clone doit ÉCHOUER peu après son butoir, en
// le disant — partout. Et git doit être TUÉ, pas seulement abandonné : sa
// connexion se ferme. Un `Promise.race` rendrait la main en laissant le
// processus pendre.
//
// ─── SAUF SOUS WINDOWS : L'EFFET EST MESURÉ, LA CAUSE PROBABLE ───────────────
//
// Sur la CI Windows (run 36298800994), le clone échoue bien à son butoir, mais
// la connexion reste ouverte. L'explication la plus probable : le `git` du PATH
// y est le LANCEUR de Git for Windows (`cmd\git.exe`), qui démarre le vrai
// git ; tuer le lanceur laisse l'autre vivre jusqu'à ce que le dépôt ferme.
// C'est la limite de tout `child.kill()` du nœud (`runProc`, `exec.ts`) :
// aucun ne tue un ARBRE de processus. Le travail, lui, ne pend plus — c'est la
// promesse du premier banc, tenue sur les trois systèmes. Le second ne tourne
// que là où tuer le processus lancé tue git.

import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneRepo } from '../src/node-client/workspace.js';

const aFermer: (() => void)[] = [];

afterEach(() => {
  for (const fermer of aFermer.splice(0)) fermer();
});

/** Ce qu'une promesse est devenue au bout de `ms` — sans jamais l'attendre plus. */
async function issueSous(
  p: Promise<unknown>,
  ms: number,
): Promise<{ etat: 'tenue' } | { etat: 'rejetee'; motif: string } | { etat: 'pendante' }> {
  return Promise.race([
    p.then(
      () => ({ etat: 'tenue' as const }),
      (e: unknown) => ({ etat: 'rejetee' as const, motif: e instanceof Error ? e.message : '' }),
    ),
    new Promise<{ etat: 'pendante' }>((r) => setTimeout(() => r({ etat: 'pendante' }), ms)),
  ]);
}

/**
 * Un dépôt qui accepte et se tait, et un clone lancé contre lui avec un butoir
 * d'une demi-seconde. Rend l'issue du clone et de quoi savoir si git est mort.
 */
async function cloneContreUnMuet(): Promise<{
  issue: Awaited<ReturnType<typeof issueSous>>;
  connexions: net.Socket[];
  fermees: Promise<void>[];
}> {
  const connexions: net.Socket[] = [];
  const fermees: Promise<void>[] = [];
  const muet = net.createServer((c) => {
    connexions.push(c);
    fermees.push(new Promise((r) => c.once('close', () => r())));
    c.on('error', () => {});
    // Accepter, lire la demande de git… et ne jamais répondre. Lire vraiment :
    // une socket en pause ne verrait jamais la fin que git envoie en mourant.
    c.resume();
  });
  await new Promise<void>((r) => muet.listen(0, '127.0.0.1', () => r()));
  aFermer.push(() => {
    for (const c of connexions) c.destroy();
    muet.close();
  });
  const { port } = muet.address() as net.AddressInfo;
  const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-clone-borne-'));
  aFermer.push(() =>
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  );
  const clone = cloneRepo(path.join(racine, 'clone'), `git://127.0.0.1:${port}/depot`, 500);
  return { issue: await issueSous(clone, 10_000), connexions, fermees };
}

describe('le clone d’un travail de nœud', () => {
  it('UN DÉPÔT MUET NE FAIT PAS PENDRE LE TRAVAIL — le clone échoue à son butoir, en le disant', async () => {
    const { issue, connexions } = await cloneContreUnMuet();
    expect(issue, 'le clone d’un dépôt muet pend encore — le travail ne rendra jamais').toEqual({
      etat: 'rejetee',
      motif: expect.stringMatching(/clone abandonné après/),
    });
    // Git a bien parlé au dépôt muet — c'est lui, pas un refus local, qui a pendu.
    expect(connexions.length).toBeGreaterThan(0);
  });

  it(
    'À SON BUTOIR, GIT EST TUÉ — sa connexion tombe avec lui',
    { skip: process.platform === 'win32' },
    async () => {
      const { issue, fermees } = await cloneContreUnMuet();
      expect(issue.etat).toBe('rejetee');
      const tombee = await issueSous(Promise.all(fermees), 5_000);
      expect(tombee.etat, 'git survit à son butoir, connexion ouverte').toBe('tenue');
    },
  );
});
