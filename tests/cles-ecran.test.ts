// LES CLÉS DE LA RUCHE ONT UN ÉCRAN — et les deux gestes n'y sont pas
// interchangeables.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Révoquer une clé compromise est l'archétype de la décision d'administration.
// Elle n'existait qu'en ligne de commande : le tableau de bord montrait le
// pouls, les anomalies, les castes, les comptes — et pas « qui a une clé de ma
// ruche ». Un tableau de bord qui ne permet pas de décider ce qui compte le
// jour où ça compte n'en est pas un.
//
// ─── LA DISTINCTION QUE L'ÉCRAN DOIT PORTER ──────────────────────────────────
//
// Une CLÉ appartient à une machine et vaut participation à l'essaim : la
// révoquer déconnecte cette machine, tout de suite.
//
// Un BILLET ne vaut rien par lui-même : il sert à OBTENIR une clé, à usage
// compté et daté. Le révoquer ne déconnecte PERSONNE — il empêche seulement
// d'en obtenir une nouvelle.
//
// Confondre les deux, c'est croire avoir exclu quelqu'un en révoquant le billet
// par lequel il est entré. C'est la propriété que ce fichier vérifie, et elle
// ne se voit qu'en faisant les deux gestes à la suite sur la même ruche.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-cles-suffisamment-long-42';

describe('révoquer une clé, révoquer un billet', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let billet = '';
  let billetId = '';

  const hive = () => ({ 'content-type': 'application/json', 'x-hive-token': TOKEN });

  const rejoindre = (nodeId: string, label: string) =>
    fetch(`${base}/api/rejoindre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billet, nodeId, label }),
    });

  const cles = async (): Promise<{
    noeuds: { nodeId: string; label: string | null; revoque: boolean }[];
    billets: { id: string; etat: string }[];
  }> => (await (await fetch(`${base}/api/membres`, { headers: hive() })).json()) as never;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-cles-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;

    // L'URL est explicite et locale : la ruche REFUSE d'émettre un billet vers
    // une adresse publique en clair, parce qu'un `ws://` exposerait le billet
    // et tout le trafic. Le refus est correct ; c'est au test de s'y plier.
    const res = await fetch(`${base}/api/billets`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({
        url: `ws://127.0.0.1:${server.port}/ws`,
        label: 'pour l’atelier',
        uses: 5,
      }),
    });
    const corps = (await res.json()) as { billet: string; id: string };
    billet = corps.billet;
    billetId = corps.id;
    expect(billet, 'sans billet, tout le fichier serait creux').toBeTruthy();
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('deux machines entrent avec le même billet', async () => {
    expect((await rejoindre('noeud-lea', 'Portable de Léa')).status).toBe(201);
    expect((await rejoindre('noeud-tom', 'Tour de Tom')).status).toBe(201);
    const c = await cles();
    expect(c.noeuds.map((n) => n.nodeId).sort()).toEqual(['noeud-lea', 'noeud-tom']);
    expect(c.billets[0]?.etat).toBe('vivant');
  });

  it('RÉVOQUER UNE CLÉ N’EN RÉVOQUE QU’UNE', async () => {
    const res = await fetch(`${base}/api/membres/noeud-lea`, {
      method: 'DELETE',
      headers: hive(),
    });
    expect(res.status).toBe(200);
    const c = await cles();
    expect(c.noeuds.find((n) => n.nodeId === 'noeud-lea')?.revoque).toBe(true);
    expect(c.noeuds.find((n) => n.nodeId === 'noeud-tom')?.revoque).toBe(false);
  });

  it('RÉVOQUER LE BILLET NE DÉCONNECTE PERSONNE', async () => {
    // C'est LA confusion à éviter : croire avoir exclu quelqu'un en révoquant
    // le billet par lequel il est entré. Sa clé, elle, vit sa propre vie.
    const res = await fetch(`${base}/api/billets/${billetId}`, {
      method: 'DELETE',
      headers: hive(),
    });
    expect(res.status).toBe(200);
    const c = await cles();
    expect(c.billets[0]?.etat).toBe('revoque');
    expect(c.noeuds.find((n) => n.nodeId === 'noeud-tom')?.revoque).toBe(false);
  });

  it('…mais il n’ouvre plus rien', async () => {
    expect((await rejoindre('noeud-tiers', 'Machine tierce')).status).not.toBe(201);
  });

  it('les empreintes ne sortent jamais', async () => {
    // La liste nomme des machines ; elle n'a aucune raison de publier de quoi
    // tenter un cassage hors ligne.
    const texte = await (await fetch(`${base}/api/membres`, { headers: hive() })).text();
    for (const interdit of ['secretHash', 'empreinte', 'hash']) {
      expect(texte, interdit).not.toContain(interdit);
    }
  });
});

describe('l’écran des clés', () => {
  const VUE = (() => {
    const brut = readFileSync(
      fileURLToPath(new URL('../dashboard/src/views/Intendance.tsx', import.meta.url)),
      'utf8',
    );
    // Dépouillé : l'en-tête EXPLIQUE la distinction clé/billet, il ne l'affiche
    // pas — une garde qui lit le fichier brut accuse la phrase qui protège.
    return brut.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
  })();

  it('LES DEUX RÉVOCATIONS SONT ATTEIGNABLES', () => {
    expect(VUE).toContain('revoquerNoeud');
    expect(VUE).toContain('revoquerBillet');
  });

  it('L’ÉCRAN DIT QUE RÉVOQUER UNE CLÉ DÉCONNECTE, ET UN BILLET NON', () => {
    // Sans ces deux phrases, l'administrateur choisit au hasard entre deux
    // boutons qui se ressemblent et n'ont pas les mêmes conséquences.
    expect(VUE).toMatch(/déconnecte cette machine/);
    expect(VUE).toMatch(/ne déconnecte personne/);
  });

  it('un état révoqué reste VISIBLE', () => {
    // Savoir qu'on a exclu quelqu'un fait partie du suivi : une ligne qui
    // disparaît laisserait croire que la clé n'a jamais existé.
    expect(VUE).toContain('in-cle-morte');
  });
});
