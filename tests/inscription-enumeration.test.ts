// L'annuaire des inscrits que `/api/auth/register` donnait gratuitement.
//
// ─── L'ASYMÉTRIE QUI TRAHISSAIT LE PROBLÈME ──────────────────────────────────
//
// `/api/auth/login` se donne beaucoup de mal pour ne PAS dire si une adresse est
// inscrite : même message, même code, que le compte existe ou non. Son propre
// commentaire dit pourquoi — « distinguer les deux offrirait un annuaire des
// inscrits ».
//
// `/api/auth/register` rendait ce même annuaire sans effort, avec son 409
// « Email déjà utilisé ». Sous la seule limite globale (400 requêtes / 10 s),
// cela faisait 2 400 adresses testées par minute et par IP. Le soin pris sur
// `login` ne servait donc à rien : il suffisait de frapper à l'autre porte.
//
// Soit la menace est réelle, et il faut fermer les deux ; soit elle ne l'est
// pas, et le soin pris sur `login` est du décor. C'est la première.
//
// ─── CE QUE CE CORRECTIF NE FERME PAS ────────────────────────────────────────
//
// Le 409 subsiste : sans lui, personne ne comprendrait pourquoi son inscription
// échoue. Une énumération LENTE reste donc possible. La fermer tout à fait
// demanderait de confirmer l'adresse par courriel avant de répondre quoi que ce
// soit — la ruche n'envoie aucun courriel, et prétendre le contraire serait
// pire que le trou.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('énumération d’adresses par l’inscription', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  const TOKEN = 'jeton-inscription-suffisamment-long';

  const inscrire = (email: string) =>
    fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'motdepasse-assez-long-42',
        displayName: 'Quelquun',
      }),
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-enum-'));
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
    expect((await inscrire('connu@exemple.test')).status).toBe(200);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('DÉROULER UNE LISTE D’ADRESSES S’ARRÊTE VITE', () => {
    // On ne teste pas « le 409 a disparu » — il est encore là, et c'est
    // assumé. On teste que l'IP cesse d'apprendre quoi que ce soit.
    return (async () => {
      let dernier = 0;
      for (let i = 0; i < 12; i++) dernier = (await inscrire('connu@exemple.test')).status;
      expect(dernier, 'l’énumération devrait être coupée').toBe(429);
    })();
  });

  it('UNE FOIS COUPÉE, ELLE N’APPREND RIEN SUR UNE ADRESSE LIBRE NON PLUS', async () => {
    // C'est le point qui compte : si une adresse libre passait encore, le 429
    // deviendrait lui-même l'oracle — « 429 = prise, 200 = libre ».
    const res = await inscrire('jamais-vue@exemple.test');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after'), 'un refus sans délai est un mur muet').not.toBeNull();
  });

  it('LES INSCRIPTIONS RÉUSSIES NE SONT PAS COMPTÉES', async () => {
    // Un atelier de dix personnes derrière une seule IP publique (le NAT d'un
    // bureau, d'une école) doit pouvoir créer dix comptes. Compter les
    // réussites aurait cassé exactement l'usage qu'on veut servir.
    const frais = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'atelier.db'),
      simulation: false,
      tickMs: 60_000,
    });
    try {
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`http://127.0.0.1:${frais.port}/api/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: `collegue${i}@atelier.test`,
            password: 'motdepasse-assez-long-42',
            displayName: `Collègue ${i}`,
          }),
        });
        expect(res.status, `le compte n°${i} du même bureau doit passer`).toBe(200);
      }
    } finally {
      await frais.stop();
    }
  });
});
