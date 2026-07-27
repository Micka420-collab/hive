// Cloudflare : le module qui traduit une plateforme en commandes.
//
// Ce qui est testé ici est ce qu'un utilisateur VERRA. Une URL de binaire fausse
// donne un 404 et fait croire que Hive est cassé ; une méthode d'installation
// marquée « automatisable » à tort ferait lancer un `sudo` par surprise ; un nom
// d'hôte accepté à tort n'échoue que trois commandes plus loin, avec un message
// de Cloudflare que personne ne relie à sa frappe.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  artefactCloudflared,
  diagnosticContenu,
  enTeteAttendu,
  enTeteValide,
  estArchive,
  etapesTunnelNomme,
  hoteValide,
  methodesInstallation,
  urlStable,
  urlTelechargement,
} from '../src/node-client/cloudflare.js';
import type { Plateforme } from '../src/node-client/cloudflare.js';

const linux: Plateforme = { os: 'linux', arch: 'x64' };
const linuxArm: Plateforme = { os: 'linux', arch: 'arm64' };
const mac: Plateforme = { os: 'darwin', arch: 'arm64' };
const win: Plateforme = { os: 'win32', arch: 'x64' };

describe('l’artefact publié par Cloudflare', () => {
  it('nomme le bon binaire par OS et architecture', () => {
    expect(artefactCloudflared(linux)).toBe('cloudflared-linux-amd64');
    expect(artefactCloudflared(linuxArm)).toBe('cloudflared-linux-arm64');
    expect(artefactCloudflared(win)).toBe('cloudflared-windows-amd64.exe');
    expect(artefactCloudflared(mac)).toBe('cloudflared-darwin-arm64.tgz');
  });

  it('rend null sur une plateforme non couverte, plutôt qu’une approximation', () => {
    // Une valeur approximative produirait un 404 au téléchargement, et
    // l'utilisateur croirait que Hive est cassé alors que sa plateforme n'est
    // simplement pas prévue.
    expect(artefactCloudflared({ os: 'linux', arch: 'ia32' })).toBeNull();
    expect(artefactCloudflared({ os: 'freebsd', arch: 'x64' })).toBeNull();
    expect(urlTelechargement({ os: 'aix', arch: 'ppc64' })).toBeNull();
  });

  it('l’URL pointe sur les releases officielles de Cloudflare', () => {
    const url = urlTelechargement(linux)!;
    expect(url.startsWith('https://github.com/cloudflare/cloudflared/releases/')).toBe(true);
    expect(url.endsWith('cloudflared-linux-amd64')).toBe(true);
  });

  it('sait quelles plateformes livrent une ARCHIVE', () => {
    // macOS n'est publié qu'en .tgz : l'installation locale y demande une étape
    // de plus, ce qui change l'ordre des méthodes recommandées.
    expect(estArchive(mac)).toBe(true);
    expect(estArchive(linux)).toBe(false);
    expect(estArchive(win)).toBe(false);
  });
});

describe('les méthodes d’installation', () => {
  it('sur Linux et Windows, le binaire local passe DEVANT — il n’exige aucun sudo', () => {
    // Demander les droits administrateur pour « faire tourner un agent avec un
    // ami » est un obstacle sans rapport avec le besoin, et c'est là que la
    // plupart des gens abandonnent.
    expect(methodesInstallation(linux)[0]?.cle).toBe('local');
    expect(methodesInstallation(win)[0]?.cle).toBe('local');
    expect(methodesInstallation(linux)[0]?.privilegie).toBe(false);
  });

  it('sur macOS, Homebrew passe devant (l’artefact y est une archive)', () => {
    expect(methodesInstallation(mac)[0]?.cle).toBe('brew');
    expect(methodesInstallation(mac).map((m) => m.cle)).toContain('local');
  });

  it('« automatisable » n’est vrai QUE si Hive peut le faire seul, sans sudo', () => {
    // Cette propriété décide si la commande agit ou se contente d'afficher.
    // Un faux positif ferait lancer un sudo par surprise.
    for (const p of [linux, linuxArm, mac, win]) {
      for (const m of methodesInstallation(p)) {
        if (m.automatisable) expect(m.privilegie, `${p.os}/${m.cle}`).toBe(false);
      }
    }
    // L'archive macOS n'est pas automatisable : décompression requise.
    expect(methodesInstallation(mac).find((m) => m.cle === 'local')?.automatisable).toBe(false);
    expect(methodesInstallation(linux).find((m) => m.cle === 'local')?.automatisable).toBe(true);
  });

  it('toute méthode privilégiée est signalée comme telle', () => {
    const apt = methodesInstallation(linux).find((m) => m.cle === 'apt');
    expect(apt?.privilegie).toBe(true);
    expect(apt?.commande).toContain('sudo');
    const winget = methodesInstallation(win).find((m) => m.cle === 'winget');
    expect(winget?.privilegie).toBe(true);
  });

  it('la commande .deb suit l’architecture', () => {
    expect(methodesInstallation(linuxArm).find((m) => m.cle === 'apt')?.commande).toContain(
      'arm64.deb',
    );
    expect(methodesInstallation(linux).find((m) => m.cle === 'apt')?.commande).toContain(
      'amd64.deb',
    );
  });

  it('une plateforme non couverte ne propose pas de binaire fantôme', () => {
    const m = methodesInstallation({ os: 'freebsd', arch: 'x64' });
    expect(m.find((x) => x.cle === 'local')).toBeUndefined();
  });
});

describe('le nom d’hôte du tunnel nommé', () => {
  it('accepte un sous-domaine qualifié', () => {
    for (const h of ['ruche.exemple.com', 'hive.mondomaine.fr', 'a.b.c.exemple.org']) {
      expect(hoteValide(h), h).toBe(true);
    }
  });

  it('REFUSE tout de suite ce qui échouerait trois commandes plus loin', () => {
    // Une faute ici ne se voit qu'à l'étape DNS, avec un message de Cloudflare
    // que personne ne relie à sa frappe.
    for (const h of [
      '',
      'exemple', // pas de TLD
      'https://ruche.exemple.com', // URL collée au lieu du nom
      'ruche.exemple.com/ws', // chemin collé
      'ruche exemple.com', // espace
      '-ruche.exemple.com', // label commençant par un tiret
      'ruche-.exemple.com',
      'r'.repeat(64) + '.exemple.com', // label trop long
      'x'.repeat(254),
    ]) {
      expect(hoteValide(h), JSON.stringify(h)).toBe(false);
    }
  });
});

describe('les étapes du tunnel nommé', () => {
  const etapes = etapesTunnelNomme('ruche', 'hive.exemple.com', 7777);

  it('sont dans l’ordre : login, create, dns, run', () => {
    expect(etapes.map((e) => e.cle)).toEqual(['login', 'create', 'dns', 'run']);
  });

  it('portent le nom et l’hôte demandés, et le bon port', () => {
    expect(etapes[1]?.commande).toBe('cloudflared tunnel create ruche');
    expect(etapes[2]?.commande).toBe('cloudflared tunnel route dns ruche hive.exemple.com');
    expect(etapes[3]?.commande).toContain('http://127.0.0.1:7777');
  });

  it('marquent l’étape INTERACTIVE : elle seule ouvre un navigateur', () => {
    // Sans ce marquage, une exécution enchaînée resterait bloquée sans
    // expliquer qu'elle attend une action humaine.
    expect(etapes.filter((e) => e.interactive).map((e) => e.cle)).toEqual(['login']);
  });

  it('chaque étape dit POURQUOI elle existe — on l’affiche, on ne la cache pas', () => {
    for (const e of etapes) expect(e.pourquoi.length).toBeGreaterThan(30);
    // L'étape DNS doit nommer l'enjeu : c'est elle qui rend l'URL stable.
    expect(etapes[2]?.pourquoi).toMatch(/stable/i);
  });

  it('l’URL stable est celle que les invitations pourront contenir', () => {
    expect(urlStable('hive.exemple.com')).toBe('wss://hive.exemple.com/ws');
  });
});

describe('l’intégrité de ce qui est téléchargé', () => {
  it('reconnaît l’en-tête attendu par plateforme', () => {
    expect(enTeteAttendu(linux)?.quoi).toBe('ELF');
    expect(enTeteAttendu(win)?.quoi).toBe('PE (MZ)');
    expect(enTeteAttendu(mac)?.quoi).toBe('gzip (.tgz)');
    expect(enTeteAttendu({ os: 'freebsd', arch: 'x64' })).toBeNull();
  });

  it('accepte un vrai binaire, refuse tout le reste', () => {
    expect(enTeteValide(linux, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02]))).toBe(true);
    expect(enTeteValide(win, new Uint8Array([0x4d, 0x5a, 0x90]))).toBe(true);
    expect(enTeteValide(mac, new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true);
    // Un ELF servi à Windows, et réciproquement.
    expect(enTeteValide(win, new Uint8Array([0x7f, 0x45, 0x4c, 0x46]))).toBe(false);
    expect(enTeteValide(linux, new Uint8Array([0x4d, 0x5a]))).toBe(false);
    // Vide ou tronqué.
    expect(enTeteValide(linux, new Uint8Array([]))).toBe(false);
    expect(enTeteValide(linux, new Uint8Array([0x7f, 0x45]))).toBe(false);
  });

  it('sur une plateforme inconnue, n’invente pas un refus', () => {
    // Faute de savoir ce qu'on attend, bloquer serait arbitraire — et
    // empêcherait une plateforme future de fonctionner sans raison.
    expect(enTeteValide({ os: 'sunos', arch: 'x64' }, new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('LE mode d’échec réel : une page HTML servie en HTTP 200', () => {
    // Portail captif Wi-Fi, proxy d'entreprise, blocage réseau. Écrire ce
    // fichier puis le rendre exécutable produirait une erreur incompréhensible
    // au premier lancement — le message doit nommer la vraie cause.
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>Connexion requise');
    expect(enTeteValide(linux, html)).toBe(false);
    expect(diagnosticContenu(html)).toMatch(/portail captif|proxy/i);
  });

  it('nomme aussi le cas JSON (message d’erreur d’API)', () => {
    const json = new TextEncoder().encode('{"message":"Not Found"}');
    expect(diagnosticContenu(json)).toMatch(/JSON/i);
  });

  it('reste prudent quand il ne sait pas', () => {
    expect(diagnosticContenu(new Uint8Array([0, 1, 2, 3]))).toMatch(/n’est pas un exécutable/);
  });
});

describe('invariants de source', () => {
  it('le module est PUR : il décrit des commandes, il n’en exécute aucune', () => {
    // L'hôte doit pouvoir LIRE ce qu'on s'apprête à faire sur son compte
    // Cloudflare avant que ça arrive. Un spawn glissé ici retirerait ce contrôle.
    const src = readFileSync(
      fileURLToPath(new URL('../src/node-client/cloudflare.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/spawn|exec\(|node:child_process/);
    expect(src).not.toMatch(/fetch\(|node:fs|writeFileSync/);
  });
});
