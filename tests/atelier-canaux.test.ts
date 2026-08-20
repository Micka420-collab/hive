// Les trois canaux de l'Atelier, sans allumer Docker.

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { jugerSocketCdp, pagePrincipale, urlCdp, versionCdp } from '../src/atelier/cdp.js';
import {
  atelierDepuisEnv,
  envComposeAtelier,
  moteurAtelier,
  planComposeArret,
  planComposeAtelier,
} from '../src/atelier/lancement.js';
import {
  COMMANDES,
  demarrerOutil,
  envOutil,
  jugerOrdre,
  traiterRequete,
} from '../src/atelier/outil.js';
import { jugerCrochet } from '../src/atelier/reveil.js';

describe('canal système — liste d’autorisation', () => {
  it('refuse le shell libre, sudo, et docker', () => {
    expect(jugerOrdre({ argv: ['bash', '-c', 'id'] }).ok).toBe(false);
    expect(jugerOrdre({ argv: ['sudo', 'ls'] }).ok).toBe(false);
    expect(jugerOrdre({ argv: ['docker', 'ps'] }).ok).toBe(false);
  });

  it('accepte un binaire de la liste, sous /workspace', () => {
    const j = jugerOrdre({ argv: ['python3', 'test.py'], cwd: '/workspace/app' });
    expect(j.ok).toBe(true);
    if (j.ok) expect(j.cwd).toBe('/workspace/app');
  });

  it('refuse -c / --eval : ce serait un interpréteur de chaîne', () => {
    expect(jugerOrdre({ argv: ['python3', '-c', 'print(1)'] }).ok).toBe(false);
    expect(jugerOrdre({ argv: ['node', '--eval', '1'] }).ok).toBe(false);
  });

  it('refuse un cwd qui fuit', () => {
    expect(jugerOrdre({ argv: ['ls'], cwd: '/etc' }).ok).toBe(false);
    expect(jugerOrdre({ argv: ['ls'], cwd: '/workspace/../etc' }).ok).toBe(false);
  });

  it('AUCUN SECRET DE L’HÔTE ne passe à l’agent', () => {
    const vu = envOutil({
      HIVE_TOKEN: 'secret',
      ANTHROPIC_API_KEY: 'sk',
      AWS_SECRET_ACCESS_KEY: 'x',
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
    });
    expect(vu).toEqual({ PATH: '/usr/bin', LANG: 'C.UTF-8' });
    expect(COMMANDES.length).toBeGreaterThan(5);
  });

  it('GET /sante répond sans spawn', async () => {
    const req = Object.assign(new EventEmitter(), {
      method: 'GET',
      url: '/sante',
    }) as IncomingMessage;
    const morceaux: Buffer[] = [];
    const res = {
      statusCode: 200,
      setHeader() {},
      end(s: string) {
        morceaux.push(Buffer.from(s));
      },
    } as unknown as ServerResponse;
    await traiterRequete(req, res);
    expect(Buffer.concat(morceaux).toString()).toMatch(/"ok":true/);
  });
});

describe('canal web — CDP', () => {
  it('l’URL reste sur 127.0.0.1', () => {
    expect(urlCdp(9222)).toBe('http://127.0.0.1:9222');
  });

  it('un socket hors machine est refusé', () => {
    expect(jugerSocketCdp('ws://8.8.8.8:9222/devtools').ok).toBe(false);
    expect(jugerSocketCdp('ws://127.0.0.1:9222/devtools').ok).toBe(true);
  });

  it('découvre la version via fetch mocké', async () => {
    const fetchFn = async () =>
      new Response(
        JSON.stringify({ Browser: 'Chromium', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/x' }),
        {
          status: 200,
        },
      );
    const v = await versionCdp(9222, fetchFn);
    expect(v.Browser).toMatch(/Chromium/);
  });

  it('retient une page, pas un worker', () => {
    const p = pagePrincipale([
      { id: 'w', type: 'service_worker', url: 'chrome://' },
      { id: 'p', type: 'page', url: 'http://127.0.0.1:5173/' },
    ]);
    expect(p?.id).toBe('p');
  });
});

describe('canal visuel — compose ne quitte pas la boucle locale', () => {
  it('le plan nomme le profil et le service, pas un simulacre', () => {
    const p = planComposeAtelier('docker');
    expect(p.ok && p.argv).toEqual(['compose', '--profile', 'atelier', 'up', '-d', 'atelier']);
    expect(planComposeAtelier(null).ok).toBe(false);
    expect(planComposeArret('docker').ok).toBe(true);
    if (planComposeArret('docker').ok) {
      expect(planComposeArret('docker')).toMatchObject({
        argv: ['compose', '--profile', 'atelier', 'stop', 'atelier'],
      });
    }
  });
});

describe('réveil — uniquement des crochets honnêtes', () => {
  const hive = 10001;
  it('refuse un uid étranger, un non-exécutable, un chemin fuyant', () => {
    expect(
      jugerCrochet(
        { chemin: '/workspace/.wake-hooks/x', mode: 0o755, uid: 0, estFichier: true },
        hive,
      ).ok,
    ).toBe(false);
    expect(
      jugerCrochet(
        { chemin: '/workspace/.wake-hooks/x', mode: 0o644, uid: hive, estFichier: true },
        hive,
      ).ok,
    ).toBe(false);
    expect(
      jugerCrochet({ chemin: '/tmp/evil', mode: 0o755, uid: hive, estFichier: true }, hive).ok,
    ).toBe(false);
  });

  it('accepte un fichier à lui, exécutable, sous .wake-hooks', () => {
    const j = jugerCrochet(
      { chemin: '/workspace/.wake-hooks/apres', mode: 0o755, uid: hive, estFichier: true },
      hive,
    );
    expect(j.ok).toBe(true);
  });
});

describe('lancement Queen — secrets hors du CLI compose', () => {
  it('HIVE_TOKEN ne part pas avec docker compose', () => {
    const vu = envComposeAtelier({
      PATH: '/bin',
      HIVE_TOKEN: 'secret-de-ruche',
      ANTHROPIC_API_KEY: 'sk',
      SystemRoot: 'C:\\Windows',
    });
    expect(vu.HIVE_TOKEN).toBeUndefined();
    expect(vu.ANTHROPIC_API_KEY).toBeUndefined();
    expect(vu.PATH).toBe('/bin');
    expect(vu.SystemRoot).toBe('C:\\Windows');
  });

  it('le défaut est off — une faute ne allume pas le bureau', () => {
    expect(atelierDepuisEnv({})).toBe('off');
    expect(atelierDepuisEnv({ HIVE_ATELIER: 'ON' })).toBe('off');
    expect(atelierDepuisEnv({ HIVE_ATELIER: 'auto' })).toBe('auto');
    expect(moteurAtelier({ HIVE_ATELIER_MOTEUR: 'podman' })).toBe('podman');
  });
});

describe('démon HTTP réel (sans Docker)', () => {
  it('écoute, répond /sante, refuse un ordre hors liste', async () => {
    const srv = demarrerOutil({ port: 0, env: { PATH: '/usr/bin' } });
    if (!srv.listening) await new Promise<void>((r) => srv.once('listening', r));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const sante = await fetch(`http://127.0.0.1:${String(port)}/sante`);
    expect(((await sante.json()) as { ok: boolean }).ok).toBe(true);
    const refus = await fetch(`http://127.0.0.1:${String(port)}/exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ argv: ['sudo', 'ls'] }),
    });
    expect(refus.status).toBe(403);
    await new Promise<void>((r) => srv.close(() => r()));
  });
});
