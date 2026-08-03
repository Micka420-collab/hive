// LE TUNNEL — 50 lignes à 0 %, et ce sont des clés qui y transitent.
//
// ─── POURQUOI CE FICHIER, ET POURQUOI MAINTENANT ─────────────────────────────
//
// L'analyse du dépôt entier (3 août) a montré `src/node-client/tunnel.ts`
// jamais exécuté par un test. Or ce module fait exactement les deux gestes
// qu'on ne veut pas voir improvisés :
//
//   · il SPAWN des binaires trouvés dans le PATH (`cloudflared`,
//     `localtunnel`) — le terrain de chasse d'un homonyme malveillant ;
//   · il fabrique l'URL `wss://` que l'invitation annoncera — une erreur ici
//     et c'est du clair qui se présente comme du chiffré.
//
// ─── COMMENT ON TESTE UN SPAWN SANS INSTALLER CLOUDFLARE ─────────────────────
//
// Même méthode que le faux paquet de `agent-windows-spawn.test.ts` : on ne
// simule pas le spawn, on lui donne un VRAI binaire à lancer.
//
//   · pour `ouvrirTunnel`, un `Fournisseur` fabriqué dont le binaire est
//     `process.execPath` — Node lui-même — et dont les arguments impriment (ou
//     n'impriment pas) une URL. Le vrai `spawn`, les vrais flux, le vrai
//     minuteur ;
//   · pour `trouverFournisseur`, un faux `cloudflared` posé dans un dossier
//     et un PATH réduit à ce dossier. Sur POSIX, il en profite pour DÉVERSER
//     SON ENVIRONNEMENT dans un fichier : c'est la seule preuve directe que
//     les secrets ne partent pas au binaire sondé.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FOURNISSEURS,
  type Fournisseur,
  ouvrirTunnel,
  trouverFournisseur,
  urlRucheDepuisTunnel,
} from '../src/node-client/tunnel.js';

const POSIX = process.platform !== 'win32';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function dossier(prefixe: string): string {
  const d = mkdtempSync(path.join(tmpdir(), prefixe));
  aNettoyer.push(d);
  return d;
}

/** Un fournisseur dont le « binaire » est Node : le spawn est réel, l'URL est à nous. */
function fournisseurFactice(script: string): Fournisseur {
  return {
    bin: process.execPath,
    nom: 'fournisseur-factice',
    args: () => ['-e', script],
    extraireUrl: (l) => l.match(/https:\/\/[a-z0-9-]+\.exemple\.test/i)?.[0] ?? null,
    installation: 'aucune',
  };
}

describe('urlRucheDepuisTunnel — la promesse « chiffré » ne se contourne pas', () => {
  it('https devient wss, chemin /ws, hôte conservé', () => {
    expect(urlRucheDepuisTunnel('https://abc-def.trycloudflare.com')).toBe(
      'wss://abc-def.trycloudflare.com/ws',
    );
    // Le port fait partie de l'hôte : le perdre enverrait l'invité ailleurs.
    expect(urlRucheDepuisTunnel('https://ruche.exemple.com:8443')).toBe(
      'wss://ruche.exemple.com:8443/ws',
    );
  });

  it('http EST REFUSÉ — tout l’objet de la commande est d’obtenir du chiffré', () => {
    expect(urlRucheDepuisTunnel('http://abc.trycloudflare.com')).toBeNull();
  });

  it('une chaîne qui n’est pas une URL rend null, sans lancer', () => {
    expect(urlRucheDepuisTunnel('pas une url du tout')).toBeNull();
    expect(urlRucheDepuisTunnel('')).toBeNull();
  });
});

describe('ouvrirTunnel — le vrai spawn, un vrai minuteur, nos URL', () => {
  it('L’URL ANNONCÉE SUR STDOUT EST RENDUE, et le processus nous appartient', async () => {
    const t = await ouvrirTunnel(
      fournisseurFactice(
        `console.log('bruit'); console.log('https://a1.exemple.test prêt'); setInterval(() => {}, 1000);`,
      ),
      7777,
    );
    try {
      expect(t.url).toBe('https://a1.exemple.test');
      expect(t.fournisseur).toBe('fournisseur-factice');
      expect(t.process.pid, 'pas de processus à tuer — le tunnel serait incoupable').toBeTruthy();
    } finally {
      t.process.kill();
    }
  });

  it('L’URL SUR STDERR COMPTE AUSSI — c’est là que cloudflared annonce la sienne', async () => {
    // Retirer l'écoute de stderr ne casserait AUCUN autre test : celui-ci est
    // la seule chose qui distingue « stdout suffit » de « cloudflared marche ».
    const t = await ouvrirTunnel(
      fournisseurFactice(
        `console.error('https://err2.exemple.test'); setInterval(() => {}, 1000);`,
      ),
      7777,
    );
    try {
      expect(t.url).toBe('https://err2.exemple.test');
    } finally {
      t.process.kill();
    }
  });

  it('un fournisseur qui SORT sans URL rejette, avec son code de sortie', async () => {
    await expect(ouvrirTunnel(fournisseurFactice(`process.exit(7);`), 7777)).rejects.toThrow(
      /code 7.*sans annoncer d'URL/,
    );
  });

  it('un fournisseur MUET est coupé au délai — pas de terminal figé', async () => {
    // Le minuteur est une garde d'accueil : sans lui, l'hôte regarde un prompt
    // silencieux sans savoir s'il faut attendre ou abandonner.
    await expect(
      ouvrirTunnel(fournisseurFactice(`setInterval(() => {}, 1000);`), 7777, 400),
    ).rejects.toThrow(/n'a annoncé aucune URL/);
  });
});

describe('trouverFournisseur — le PATH réel, et ce qui part au binaire sondé', () => {
  it.runIf(POSIX)(
    'UN CLOUDFLARED DU PATH EST TROUVÉ, ET LES SECRETS NE LUI PARVIENNENT PAS',
    async () => {
      // ─── LA GARDE QUI COMPTE DANS CE FICHIER ───────────────────────────────
      //
      // La sonde lance `cloudflared --version` avec `envSonde(process.env)`.
      // Le faux cloudflared déverse l'environnement qu'il REÇOIT : si un jour
      // quelqu'un remplace `envSonde(process.env)` par `process.env` — la
      // régression exacte que le commentaire du module raconte —, le jeton
      // apparaît dans le déversoir et cette assertion rougit.
      const bacASable = dossier('ruche-path-');
      const deversoir = path.join(bacASable, 'env-recu.txt');
      const faux = path.join(bacASable, 'cloudflared');
      // `/usr/bin/env` en ABSOLU : le PATH du test est réduit au bac à sable,
      // et un `env` nu y est introuvable — première version, déversoir vide.
      writeFileSync(faux, `#!/bin/sh\n/usr/bin/env > "${deversoir}"\nexit 0\n`, { mode: 0o755 });

      const avant = {
        PATH: process.env.PATH,
        HIVE_TOKEN: process.env.HIVE_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      };
      process.env.PATH = bacASable;
      process.env.HIVE_TOKEN = 'jeton-sentinelle-qui-ne-doit-pas-fuir';
      process.env.ANTHROPIC_API_KEY = 'cle-sentinelle-qui-ne-doit-pas-fuir';
      try {
        const f = await trouverFournisseur();
        expect(f?.bin, 'le cloudflared du PATH n’a pas été trouvé').toBe('cloudflared');

        const recu = readFileSync(deversoir, 'utf8');
        expect(recu, 'le déversoir est vide — la sonde n’a pas tourné').toContain('PATH=');
        expect(recu, 'HIVE_TOKEN EST PARTI AU BINAIRE SONDÉ').not.toContain(
          'jeton-sentinelle-qui-ne-doit-pas-fuir',
        );
        expect(recu, 'ANTHROPIC_API_KEY EST PARTIE AU BINAIRE SONDÉ').not.toContain(
          'cle-sentinelle-qui-ne-doit-pas-fuir',
        );
      } finally {
        process.env.PATH = avant.PATH;
        if (avant.HIVE_TOKEN === undefined) delete process.env.HIVE_TOKEN;
        else process.env.HIVE_TOKEN = avant.HIVE_TOKEN;
        if (avant.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = avant.ANTHROPIC_API_KEY;
      }
    },
  );

  it.runIf(POSIX)('AUCUN FOURNISSEUR DANS LE PATH → null, jamais un ENOENT brut', async () => {
    const vide = dossier('ruche-path-vide-');
    const avant = process.env.PATH;
    process.env.PATH = vide;
    try {
      expect(await trouverFournisseur()).toBeNull();
    } finally {
      process.env.PATH = avant;
    }
  });

  it.runIf(POSIX)(
    'cloudflared passe AVANT localtunnel — le seul sans compte ni config',
    async () => {
      // L'ordre est une promesse d'accueil : le premier de la liste est le seul
      // dont le mode « quick tunnel » ne demande aucun compte. On plante les
      // DEUX et on exige que le premier gagne.
      const bacASable = dossier('ruche-path-ordre-');
      for (const bin of ['cloudflared', 'localtunnel']) {
        writeFileSync(path.join(bacASable, bin), `#!/bin/sh\nexit 0\n`, { mode: 0o755 });
      }
      const avant = process.env.PATH;
      process.env.PATH = bacASable;
      try {
        expect((await trouverFournisseur())?.bin).toBe('cloudflared');
      } finally {
        process.env.PATH = avant;
      }
    },
  );

  it('la table des fournisseurs reste celle qu’on documente', () => {
    // Écrite en toutes lettres (§ 2 undecies) : le jour où un fournisseur
    // entre ou sort, ce test rougit et force la relecture des sondes.
    expect(FOURNISSEURS.map((f) => f.bin)).toEqual(['cloudflared', 'localtunnel']);
  });

  it('l’extraction cloudflared reconnaît la ligne réelle, bordures comprises', () => {
    // La ligne telle que cloudflared l'imprime, encadrée d'ASCII : si le motif
    // se resserrait trop, le tunnel réel ne serait plus jamais détecté.
    const ligne = '2026-08-03T11:00:00Z INF |  https://abc-def-ghi.trycloudflare.com  |';
    expect(FOURNISSEURS[0]?.extraireUrl(ligne)).toBe('https://abc-def-ghi.trycloudflare.com');
    expect(FOURNISSEURS[0]?.extraireUrl('aucune url ici')).toBeNull();
  });
});
