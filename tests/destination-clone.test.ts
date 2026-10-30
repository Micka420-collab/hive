// Les destinations de clonage (#521) — la partie PURE : lire une URL, classer
// une adresse, juger, épingler. Ce que git fait de l'épinglage est éprouvé
// avec un vrai git dans `miroir-destinations.test.ts`.

import { describe, expect, it } from 'vitest';
import {
  DestinationRefusee,
  POLITIQUE_LIBRE,
  SANS_EPINGLAGE,
  lireDestination,
  lireDestinationsClone,
  octetsIPv6,
  plageInterne,
  verifierDestination,
  type PolitiqueDestinations,
  type Resolveur,
} from '../src/shared/destination-clone.js';

const FILTREE: PolitiqueDestinations = { mode: 'filtrees', hotes: [] };

/** Un DNS de banc : chaque nom rend les adresses qu'on lui donne, les autres échouent. */
const dns =
  (table: Record<string, readonly string[]>): Resolveur =>
  async (hote) => {
    const r = table[hote];
    if (r === undefined) throw new Error(`ENOTFOUND ${hote}`);
    return r;
  };

/** Le motif d'un refus, ou `'PASSE'`. */
async function motif(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'PASSE';
  } catch (e) {
    if (e instanceof DestinationRefusee) return e.motif;
    throw e;
  }
}

describe('lireDestination — une seule lecture possible', () => {
  it.each([
    ['https://github.com/x/y.git', 'https', 'github.com', 443],
    ['http://forge.exemple.org:8080/x', 'http', 'forge.exemple.org', 8080],
    ['git://forge.exemple.org/x', 'git', 'forge.exemple.org', 9418],
    ['ssh://git@forge.exemple.org:2222/x', 'ssh', 'forge.exemple.org', 2222],
    ['git@github.com:x/y.git', 'ssh', 'github.com', 22],
    ['https://user:jeton@GitHub.com/x', 'https', 'github.com', 443],
    ['https://[2606:4700::1111]/x', 'https', '2606:4700::1111', 443],
    ['https://dev.azure.com/org/Mon%20Projet/_git/depot', 'https', 'dev.azure.com', 443],
    ['https://github.com?@127.0.0.1/', 'https', 'github.com', 443],
    ['https://1password.com/x', 'https', '1password.com', 443],
  ])('%s → %s %s:%i', (url, transport, hote, port) => {
    expect(lireDestination(url)).toEqual({ transport, hote, port });
  });

  it.each([
    ['IPv4 hexadécimale', 'https://0x7f.1/x'],
    ['IPv4 en un seul entier', 'https://2130706433/x'],
    ['IPv4 octale', 'https://0177.0.0.1/x'],
    ['octet à zéro de tête', 'https://010.0.0.1/x'],
    ['deux @', 'https://a@b@127.0.0.1/'],
    ['barre oblique inverse', 'https://github.com\\@127.0.0.1/'],
    ['hôte encodé', 'https://%6cocalhost/x'],
    ['utilisateur encodé', 'https://a%40b@github.com/x'],
    ['point final', 'https://localhost./x'],
    ['tiret de tête (option ssh)', 'ssh://-oProxyCommand=id/x'],
    ['port nul', 'https://github.com:0/x'],
    ['port hors bornes', 'https://github.com:99999/x'],
    ['IPv4 entre crochets', 'https://[127.0.0.1]/x'],
    ['zone IPv6', 'ssh://[fe80::1%25eth0]/x'],
    ['espace', 'https://github.com /x'],
    ['caractère de contrôle', 'https://github.com\t/x'],
    ['schéma inconnu', 'ftp://github.com/x'],
    ['chemin local', '/srv/depots/x'],
  ])('refuse : %s', (_quoi, url) => {
    expect(lireDestination(url)).toBeNull();
  });
});

describe('plageInterne — tout ce qui n’est pas l’Internet public', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // métadonnées AWS / GCP / Azure
    '100.100.100.200', // métadonnées Alibaba (CGNAT)
    '192.0.0.192', // métadonnées Oracle
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '198.18.0.1',
    '::1',
    '::',
    '::7f00:1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1', // NAT64 de 10.0.0.1
    '64:ff9b:1::1',
    '2001::1', // Teredo
    '2002:7f00:1::', // 6to4 de 127.0.0.1
    '2001:db8::1',
    '3fff::1',
    'fd00:ec2::254', // métadonnées AWS IPv6
    'fc00::1',
    'fe80::1',
    'fe80::1%eth0',
    'fec0::1',
    'ff02::1',
  ])('%s est interne', (adresse) => {
    expect(plageInterne(adresse)).not.toBeNull();
  });

  it.each([
    '8.8.8.8',
    '140.82.112.3',
    '172.32.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2606:4700::1111',
    '2001:4860:4860::8888',
  ])('%s est publique', (adresse) => {
    expect(plageInterne(adresse)).toBeNull();
  });

  it('octetsIPv6 lit la compression et la queue IPv4', () => {
    expect(octetsIPv6('::ffff:127.0.0.1')).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1,
    ]);
    expect(octetsIPv6('2001:db8::1').slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(octetsIPv6('1:2:3:4:5:6:7:8')).toHaveLength(16);
  });
});

describe('verifierDestination — le jugement', () => {
  const publique = dns({
    'github.com': ['140.82.112.3'],
    'double.exemple.org': ['140.82.112.3', '2606:4700::1111'],
    'piege.exemple.org': ['140.82.112.3', '10.0.0.5'],
    'interne.exemple.org': ['169.254.169.254'],
    'v6.exemple.org': ['::ffff:127.0.0.1'],
    vide: [],
  });

  it('LIBRE sans liste : rien n’est résolu, rien n’est épinglé — le comportement d’avant', async () => {
    let appels = 0;
    const compteur: Resolveur = async () => {
      appels++;
      return ['127.0.0.1'];
    };
    await expect(
      verifierDestination('http://127.0.0.1/x', POLITIQUE_LIBRE, { resoudre: compteur }),
    ).resolves.toBe(SANS_EPINGLAGE);
    expect(appels).toBe(0);
  });

  it('refuse une adresse interne écrite en clair, sans même résoudre', async () => {
    for (const url of [
      'http://127.0.0.1:7777/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://[::ffff:127.0.0.1]/x',
      'git@10.0.0.1:x/y.git',
    ]) {
      expect(await motif(verifierDestination(url, FILTREE, { resoudre: publique })), url).toBe(
        'interne',
      );
    }
  });

  it('refuse un nom qui résout vers l’intérieur — y compris en IPv6 mappée', async () => {
    expect(
      await motif(
        verifierDestination('https://interne.exemple.org/x', FILTREE, { resoudre: publique }),
      ),
    ).toBe('interne');
    expect(
      await motif(verifierDestination('https://v6.exemple.org/x', FILTREE, { resoudre: publique })),
    ).toBe('interne');
  });

  it('UNE seule adresse interne parmi plusieurs suffit à refuser', async () => {
    expect(
      await motif(
        verifierDestination('https://piege.exemple.org/x', FILTREE, { resoudre: publique }),
      ),
    ).toBe('interne');
  });

  it('un nom qui ne se résout pas, ou ne rend rien, est refusé', async () => {
    expect(
      await motif(
        verifierDestination('https://inconnu.exemple.org/x', FILTREE, { resoudre: publique }),
      ),
    ).toBe('introuvable');
    expect(
      await motif(verifierDestination('https://vide/x', FILTREE, { resoudre: publique })),
    ).toBe('introuvable');
  });

  it('un DNS muet est borné : refusé au délai, pas attendu pour toujours', async () => {
    const muet: Resolveur = () => new Promise(() => undefined);
    expect(
      await motif(
        verifierDestination('https://github.com/x', FILTREE, { resoudre: muet, delaiMs: 20 }),
      ),
    ).toBe('introuvable');
  });

  it('git:// est refusé en mode filtré, une forme ambiguë aussi', async () => {
    expect(
      await motif(verifierDestination('git://github.com/x', FILTREE, { resoudre: publique })),
    ).toBe('transport');
    expect(
      await motif(verifierDestination('https://0x7f.1/x', FILTREE, { resoudre: publique })),
    ).toBe('illisible');
  });

  it('le message ne dit JAMAIS l’adresse résolue ; le détail, si', async () => {
    try {
      await verifierDestination('https://interne.exemple.org/x', FILTREE, { resoudre: publique });
      expect.unreachable();
    } catch (e) {
      const refus = e as DestinationRefusee;
      expect(refus.message).not.toMatch(/169\.254/);
      expect(refus.detail).toMatch(/169\.254\.169\.254/);
    }
  });

  it('HTTPS : épingle TOUTES les adresses jugées et coupe les redirections', async () => {
    const e = await verifierDestination('https://double.exemple.org/x', FILTREE, {
      resoudre: publique,
    });
    expect(e.configGit).toEqual([
      '-c',
      'http.followRedirects=false',
      '-c',
      'http.curloptResolve=double.exemple.org:443:140.82.112.3,[2606:4700::1111]',
    ]);
    expect(e.optionsSsh).toBe('');
  });

  it('HTTP sur un port : l’épinglage porte le port', async () => {
    const e = await verifierDestination('http://github.com:8080/x', FILTREE, {
      resoudre: publique,
    });
    expect(e.configGit).toContain('http.curloptResolve=github.com:8080:140.82.112.3');
  });

  it('une IP publique littérale ne s’épingle pas, mais les redirections restent coupées', async () => {
    const e = await verifierDestination('https://140.82.112.3/x', FILTREE, { resoudre: publique });
    expect(e.configGit).toEqual(['-c', 'http.followRedirects=false']);
  });

  it('SSH : HostName impose l’adresse, HostKeyAlias garde la clé d’hôte du NOM', async () => {
    for (const url of ['git@github.com:x/y.git', 'ssh://git@github.com/x/y.git']) {
      const e = await verifierDestination(url, FILTREE, { resoudre: publique });
      expect(e.optionsSsh).toBe('-o HostName=140.82.112.3 -o HostKeyAlias=github.com');
      expect(e.configGit).toEqual([]);
    }
  });

  it('les options ssh ne portent que des caractères sûrs pour un shell', async () => {
    const e = await verifierDestination('git@github.com:x/y.git', FILTREE, { resoudre: publique });
    expect(e.optionsSsh).toMatch(/^[A-Za-z0-9 =._:-]+$/);
  });

  it('la liste d’hôtes s’applique dans les DEUX modes ; *. couvre les sous-domaines seulement', async () => {
    const liste = (mode: 'libres' | 'filtrees'): PolitiqueDestinations => ({
      mode,
      hotes: ['github.com', '*.gitlab.com'],
    });
    const r = dns({ 'github.com': ['140.82.112.3'], 'eu.gitlab.com': ['172.65.251.78'] });
    for (const mode of ['libres', 'filtrees'] as const) {
      expect(
        await motif(verifierDestination('https://github.com/x', liste(mode), { resoudre: r })),
      ).toBe('PASSE');
      expect(
        await motif(verifierDestination('https://eu.gitlab.com/x', liste(mode), { resoudre: r })),
      ).toBe('PASSE');
      expect(
        await motif(verifierDestination('https://gitlab.com/x', liste(mode), { resoudre: r })),
      ).toBe('hote_hors_liste');
      expect(
        await motif(verifierDestination('https://evilgithub.com/x', liste(mode), { resoudre: r })),
      ).toBe('hote_hors_liste');
    }
  });
});

describe('lireDestinationsClone — HIVE_CLONE_DESTINATIONS / HIVE_CLONE_HOTES', () => {
  it('défaut : filtrées en Cloud, libres en Community', () => {
    expect(lireDestinationsClone({}, 'cloud')).toEqual({ valeur: FILTREE, refus: null });
    expect(lireDestinationsClone({}, 'community')).toEqual({
      valeur: POLITIQUE_LIBRE,
      refus: null,
    });
  });

  it('l’hôte peut choisir, dans les deux sens', () => {
    expect(
      lireDestinationsClone({ HIVE_CLONE_DESTINATIONS: 'filtrees' }, 'community').valeur.mode,
    ).toBe('filtrees');
    expect(
      lireDestinationsClone({ HIVE_CLONE_DESTINATIONS: ' Filtrées ' }, 'community').valeur.mode,
    ).toBe('filtrees');
    expect(lireDestinationsClone({ HIVE_CLONE_DESTINATIONS: 'libres' }, 'cloud').valeur.mode).toBe(
      'libres',
    );
  });

  it('UNE FAUTE DE FRAPPE EST UN REFUS, et la valeur retombe sur le filtre — jamais sur libres', () => {
    const lu = lireDestinationsClone({ HIVE_CLONE_DESTINATIONS: 'filtrés' }, 'community');
    expect(lu.refus).toMatch(/HIVE_CLONE_DESTINATIONS/);
    expect(lu.valeur.mode).toBe('filtrees');
  });

  it('lit la liste d’hôtes, en minuscules, et refuse ce qui n’est pas un nom', () => {
    expect(
      lireDestinationsClone({ HIVE_CLONE_HOTES: 'GitHub.com, *.gitlab.com ,' }, 'cloud').valeur
        .hotes,
    ).toEqual(['github.com', '*.gitlab.com']);
    for (const faux of ['https://github.com', 'github.com:443', '*', 'git hub.com', '-x.org']) {
      expect(lireDestinationsClone({ HIVE_CLONE_HOTES: faux }, 'cloud').refus, faux).toMatch(
        /HIVE_CLONE_HOTES/,
      );
    }
  });
});
