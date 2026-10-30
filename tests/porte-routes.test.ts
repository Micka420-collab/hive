// La porte, servie par une VRAIE Reine (la page ouverte dans un navigateur de
// banc est dans `porte-page.test.ts`, qui ne charge pas la Reine : sous
// l'environnement happy-dom, Vite réécrit `import.meta.url` et `server.ts` ne
// se charge pas — voir `session-expiree-ecran.test.tsx`).
//
// Deux étages :
//   · la route `GET /r/<id>` : même page pour un billet connu ou inconnu, CSP
//     à nonce, aucun secret dedans, et l'ouverture JOURNALISÉE pour l'hôte ;
//   · `POST /api/billets/:id/etat` : ne parle qu'au porteur du SECRET, dit
//     l'état et les machines entrées, refuse à l'identique un billet inconnu
//     et un secret faux, et compte les échecs par IP ;
//   · la page, SCRIPT EXÉCUTÉ dans happy-dom : elle lit le fragment, compose
//     la commande à l'octet près comme la ruche, pose le lien profond, lit
//     l'état, puis voit la machine entrer.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { cspPorte, pagePorte } from '../src/orchestrator/porte-page.js';
import { encoderBillet, type Billet } from '../src/shared/acces.js';
import { billetDuLien } from '../src/shared/porte.js';

const TOKEN = 'jeton-porte-assez-long-pour-la-ruche-42';

describe('LA PORTE (#lien)', () => {
  let server: HiveServer;
  let base: string;
  let dir: string;
  let lien: string;
  let billet: Billet;
  let billetEncode: string;
  let id: string;
  let admin: Record<string, string>;

  const poster = (route: string, corps: object, entetes: Record<string, string> = {}) =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify(corps),
    });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-porte-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    // Le PREMIER compte est administrateur : émettre un billet l'exige.
    const inscription = await poster(
      '/api/auth/register',
      { email: 'micka@hive.test', password: 'mot-de-passe-test', displayName: 'Micka' },
      { 'x-hive-token': TOKEN },
    );
    expect(inscription.status).toBe(200);
    admin = { authorization: `Bearer ${((await inscription.json()) as { token: string }).token}` };
    const res = await poster(
      '/api/billets',
      { url: `ws://127.0.0.1:${server.port}/ws`, label: 'Ruche de Micka', uses: 2 },
      admin,
    );
    expect(res.status).toBe(201);
    const corps = (await res.json()) as { lien: string; billet: string; id: string };
    lien = corps.lien;
    billetEncode = corps.billet;
    id = corps.id;
    billet = billetDuLien(lien, { id: 80, nom: 200 })!;
    expect(billet).not.toBeNull();
    expect(encoderBillet(billet)).toBe(billetEncode);
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('POST /api/billets remet le lien', () => {
    it('le lien pointe la ruche en HTTP, porte l’identifiant dans le chemin et le billet dans le fragment', () => {
      expect(lien).toBe(`${base}/r/${id}#${billetEncode}`);
    });
  });

  describe('GET /r/<id>', () => {
    it('sert la page avec une CSP à nonce, sans cache, et SANS le moindre secret', async () => {
      const res = await fetch(`${base}/r/${id}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      const csp = res.headers.get('content-security-policy') ?? '';
      const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
      expect(nonce).toBeDefined();
      expect(csp).toBe(cspPorte(nonce!));
      const html = await res.text();
      expect(html).toContain(`nonce="${nonce}"`);
      expect(html).not.toContain(billet.secret);
      expect(html).not.toContain(billetEncode);
      expect(html).toContain('Télécharger Hive pour <span id="os-nom">Windows</span>');
      expect(html).toContain('"id":"' + id + '"');
    });

    it('un billet INCONNU reçoit la même page, au nonce près', async () => {
      const [a, b] = await Promise.all([
        fetch(`${base}/r/${id}`).then((r) => r.text()),
        fetch(`${base}/r/bil-inconnu`).then((r) => r.text()),
      ]);
      const neutre = (s: string) =>
        s.replace(/nonce-[A-Za-z0-9_-]+/g, 'N').replace(/nonce="[A-Za-z0-9_-]+"/g, 'N');
      expect(neutre(a).replace(id, 'ID')).toBe(neutre(b).replace('bil-inconnu', 'ID'));
    });

    it('deux nonces, deux réponses : jamais le même', async () => {
      const [a, b] = await Promise.all([
        fetch(`${base}/r/${id}`).then((r) => r.headers.get('content-security-policy')),
        fetch(`${base}/r/${id}`).then((r) => r.headers.get('content-security-policy')),
      ]);
      expect(a).not.toBe(b);
    });

    it('l’OUVERTURE est journalisée pour l’hôte, et comptée dans /api/membres', async () => {
      const avant = (
        (await (await fetch(`${base}/api/membres`, { headers: admin })).json()) as {
          billets: { id: string; ouvertures: number }[];
        }
      ).billets.find((b) => b.id === id)!.ouvertures;
      await fetch(`${base}/r/${id}`);
      const membres = (await (await fetch(`${base}/api/membres`, { headers: admin })).json()) as {
        billets: { id: string; ouvertures: number; derniereOuverture: number }[];
      };
      const b = membres.billets.find((x) => x.id === id)!;
      expect(b.ouvertures).toBe(avant + 1);
      expect(b.derniereOuverture).toBeGreaterThan(0);
      const evenements = (await (
        await fetch(`${base}/api/events?limit=50`, { headers: { 'x-hive-token': TOKEN } })
      ).json()) as { type: string; payload: { ticketId?: string } }[];
      expect(evenements.some((e) => e.type === 'porte_ouverte' && e.payload.ticketId === id)).toBe(
        true,
      );
      // Un identifiant inconnu n'est pas compté : on ne journalise pas le bruit.
      await fetch(`${base}/r/bil-qui-nexiste-pas`);
      const apres = (await (
        await fetch(`${base}/api/events?limit=50`, { headers: { 'x-hive-token': TOKEN } })
      ).json()) as { type: string; payload: { ticketId?: string } }[];
      expect(apres.some((e) => e.payload.ticketId === 'bil-qui-nexiste-pas')).toBe(false);
    });

    it('un identifiant hors grammaire est servi comme inconnu, jamais reflété', async () => {
      const res = await fetch(`${base}/r/${encodeURIComponent('<script>alert(1)</script>')}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('"id":"inconnu"');
    });
  });

  describe('POST /api/billets/:id/etat', () => {
    it('dit l’état au porteur du secret, et rien d’autre', async () => {
      const res = await poster(`/api/billets/${id}/etat`, { secret: billet.secret });
      expect(res.status).toBe(200);
      const corps = (await res.json()) as Record<string, unknown>;
      expect(corps).toMatchObject({
        etat: 'vivant',
        label: 'Ruche de Micka',
        usesLeft: 2,
        usesTotal: 2,
        arrivees: [],
      });
      expect(typeof corps.expiresAt).toBe('number');
      expect(JSON.stringify(corps)).not.toMatch(/secretHash|keyHash|nodeId/);
    });

    it('un secret FAUX et un billet INCONNU : même réponse, à l’octet près', async () => {
      const faux = await poster(`/api/billets/${id}/etat`, { secret: 'x'.repeat(43) });
      const inconnu = await poster(`/api/billets/bil-inconnu/etat`, { secret: billet.secret });
      expect(faux.status).toBe(401);
      expect(inconnu.status).toBe(401);
      expect(await faux.text()).toBe(await inconnu.text());
    });

    it('voit la machine ENTRER, et le billet passer à épuisé au dernier usage', async () => {
      // SON billet : la suite tourne dans plusieurs ordres (tamis-ordres), et
      // consommer le billet partagé ici rendrait « vivant, deux places » faux
      // pour le banc d'à côté selon qui passe le premier.
      const deuxPlaces = (await (
        await poster(
          '/api/billets',
          { url: `ws://127.0.0.1:${server.port}/ws`, label: 'Ruche de Micka', uses: 2 },
          admin,
        )
      ).json()) as { id: string; lien: string; billet: string };
      const secret = billetDuLien(deuxPlaces.lien, { id: 80, nom: 200 })!.secret;
      const entree = await poster('/api/rejoindre', {
        billet: deuxPlaces.billet,
        nodeId: 'noeud-porte-1',
        label: 'PC-Léa',
      });
      expect(entree.status).toBe(201);
      let corps = (await (
        await poster(`/api/billets/${deuxPlaces.id}/etat`, { secret })
      ).json()) as { etat: string; usesLeft: number; arrivees: { label: string; quand: number }[] };
      expect(corps.etat).toBe('vivant');
      expect(corps.usesLeft).toBe(1);
      expect(corps.arrivees).toHaveLength(1);
      expect(corps.arrivees[0]!.label).toBe('PC-Léa');

      await poster('/api/rejoindre', {
        billet: deuxPlaces.billet,
        nodeId: 'noeud-porte-2',
        label: 'Mac',
      });
      corps = (await (
        await poster(`/api/billets/${deuxPlaces.id}/etat`, { secret })
      ).json()) as typeof corps;
      expect(corps.etat).toBe('epuise');
      expect(corps.arrivees.map((a) => a.label)).toEqual(['Mac', 'PC-Léa']);
    });

    it('un billet RÉVOQUÉ le dit à son porteur', async () => {
      const autre = (await (
        await poster('/api/billets', { url: `ws://127.0.0.1:${server.port}/ws` }, admin)
      ).json()) as { id: string; lien: string };
      const b = billetDuLien(autre.lien, { id: 80, nom: 200 })!;
      await fetch(`${base}/api/billets/${autre.id}`, {
        method: 'DELETE',
        headers: admin,
      });
      const corps = (await (
        await poster(`/api/billets/${autre.id}/etat`, { secret: b.secret })
      ).json()) as { etat: string };
      expect(corps.etat).toBe('revoque');
    });

    it('refuse un corps sans secret, ou un secret trop court', async () => {
      expect((await poster(`/api/billets/${id}/etat`, {})).status).toBe(400);
      expect((await poster(`/api/billets/${id}/etat`, { secret: 'court' })).status).toBe(400);
    });
  });

  describe('pagePorte, la fonction', () => {
    it('refuse un identifiant hors grammaire plutôt que de l’écrire dans la page', () => {
      expect(() =>
        pagePorte({ id: '<x>', nonce: 'n', systeme: 'linux', releases: 'https://r' }),
      ).toThrow();
    });

    it('échappe ce qui vient du dehors', () => {
      const html = pagePorte({
        id: 'bil-x',
        nonce: 'n',
        systeme: 'linux',
        releases: 'https://r/"><script>alert(1)</script>',
        version: '0.5.0<b>',
      });
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;b&gt;');
      expect(html).toContain('nonce="n"');
    });
  });
});
