// Le réseau FILTRÉ dans l'enveloppe du bac : les arguments exacts, pour
// bubblewrap comme pour les conteneurs. Un flag oublié ne se voit pas à
// l'exécution — tout marche, et le réseau reste ouvert.
//
// Le chemin conteneur n'a pas de moteur sur la machine où ce lot a été écrit :
// il est éprouvé ICI, sur ses arguments ; celui de bubblewrap l'est en plus en
// vrai (`reseau-bac.integration.test.ts`).

import { describe, expect, it } from 'vitest';
import {
  MONTAGE_RESEAU,
  constat,
  envelopper,
  fournisseurParNom,
  optionsEnveloppe,
  type ContexteHote,
  type Fournisseur,
  type ReseauBac,
} from '../src/node-client/isolement.js';
import { NOM_RELAIS, PORT_RELAIS } from '../src/node-client/proxy-egress.js';
import { argvCodex } from '../src/adapters/codex.js';

const PODMAN = fournisseurParNom('podman') as Fournisseur;
const DOCKER = fournisseurParNom('docker') as Fournisseur;
const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;
const CWD = '/home/membre/.hive/taches/t-42';
const HOTE_NU: ContexteHote = { chemin: '', interdits: [] };

const RESEAU: ReseauBac = {
  dossier: '/tmp/hive-pont-42-AbCdEf/Reseau',
  socket: '/tmp/hive-pont-42-AbCdEf/Reseau/s',
  interprete: '/opt/node-24/bin/node',
  variables: {
    HTTPS_PROXY: `http://127.0.0.1:${PORT_RELAIS}`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT_RELAIS}/hive-api/anthropic`,
  },
};

function enveloppe(f: Fournisseur, reseau?: ReseauBac) {
  return envelopper('claude', ['-p', 'corriger le bug'], {
    fournisseur: f,
    cwdHote: CWD,
    variables: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'],
    hote: HOTE_NU,
    ...(reseau ? { reseau } : {}),
  });
}

/** Ce que le bac lance, après le séparateur de bubblewrap ou l'image. */
const RELAIS = [
  `${MONTAGE_RESEAU}/${NOM_RELAIS}`,
  String(PORT_RELAIS),
  `${MONTAGE_RESEAU}/s`,
  '--',
  'claude',
  '-p',
  'corriger le bug',
];

describe('bubblewrap — réseau filtré', () => {
  it('COUPE LE RÉSEAU : pas de `--share-net` quand la tâche a un réseau filtré', () => {
    const { args } = enveloppe(BWRAP, RESEAU);
    expect(args).toContain('--unshare-all');
    expect(args).not.toContain('--share-net');
  });

  it('sans réseau filtré (projet « ouvert »), le réseau de l’hôte, comme avant', () => {
    expect(enveloppe(BWRAP).args).toContain('--share-net');
  });

  it('monte le dossier de la session en LECTURE SEULE et l’interpréteur du relais, seul', () => {
    const { args } = enveloppe(BWRAP, RESEAU);
    const texte = args.join('\n');
    expect(texte).toContain(['--ro-bind', RESEAU.dossier, MONTAGE_RESEAU].join('\n'));
    expect(texte).toContain(['--ro-bind', RESEAU.interprete, RESEAU.interprete].join('\n'));
    // Jamais le dossier de Node entier.
    expect(texte).not.toContain(['--ro-bind', '/opt/node-24/bin', '/opt/node-24/bin'].join('\n'));
  });

  it('pose le proxy par `--setenv` et lance le RELAIS devant l’agent', () => {
    const { args } = enveloppe(BWRAP, RESEAU);
    const texte = args.join('\n');
    expect(texte).toContain(['--setenv', 'HTTPS_PROXY', RESEAU.variables.HTTPS_PROXY].join('\n'));
    const apres = args.slice(args.indexOf('--') + 1);
    expect(apres).toEqual([RESEAU.interprete, ...RELAIS]);
  });
});

describe.each([PODMAN, DOCKER])('$nom — réseau filtré', (f) => {
  it('`--network=none` et le dossier de la session monté en lecture seule', () => {
    const { args } = enveloppe(f, RESEAU);
    expect(args).toContain('--network=none');
    expect(args).toContain(`--volume=${RESEAU.dossier}:${MONTAGE_RESEAU}:ro`);
  });

  it('sans réseau filtré, aucun `--network` : le réseau du moteur, comme avant', () => {
    expect(enveloppe(f).args.some((a) => a.startsWith('--network'))).toBe(false);
  });

  it('les variables du réseau par VALEUR, et elles priment sur le nom homonyme de l’hôte', () => {
    const { args } = enveloppe(f, RESEAU);
    expect(args).toContain(`--env=ANTHROPIC_BASE_URL=${RESEAU.variables.ANTHROPIC_BASE_URL}`);
    // Le nom seul hériterait de la base du membre, que le bac ne joint plus.
    expect(args).not.toContain('--env=ANTHROPIC_BASE_URL');
    // Le secret, lui, passe toujours par son NOM seul.
    expect(args).toContain('--env=ANTHROPIC_API_KEY');
  });

  it('lance le relais sous le `node` de l’image, derrière l’image', () => {
    const { args } = enveloppe(f, RESEAU);
    const image = args.findIndex((a) => a.includes('hive-agent'));
    expect(args.slice(image + 1)).toEqual(['node', ...RELAIS]);
  });
});

// Train 7 — le réseau COUPÉ des passes hors ligne de la porte de sécurité :
// la boucle seule, ni relais, ni proxy, ni dossier de session.
describe.each([BWRAP, PODMAN, DOCKER])('$nom — réseau coupé (`reseauCoupe`)', (f) => {
  const coupe = () =>
    envelopper('betterleaks', ['dir', 'miroir'], {
      fournisseur: f,
      cwdHote: CWD,
      variables: [],
      hote: HOTE_NU,
      reseauCoupe: true,
    });

  it('aucun réseau de l’hôte ni du moteur — et rien d’autre que la commande', () => {
    const { args } = coupe();
    const texte = args.join('\n');
    if (f.bin === 'bwrap') {
      expect(args).toContain('--unshare-all');
      expect(args).not.toContain('--share-net');
      expect(args.slice(args.indexOf('--') + 1)).toEqual(['betterleaks', 'dir', 'miroir']);
    } else {
      expect(args).toContain('--network=none');
      const image = args.findIndex((a) => a.includes('hive-agent'));
      expect(args.slice(image + 1)).toEqual(['betterleaks', 'dir', 'miroir']);
    }
    expect(texte).not.toContain(MONTAGE_RESEAU);
    expect(texte).not.toContain('HTTPS_PROXY');
  });

  it('optionsEnveloppe le transmet ; filtré, le réseau de la session l’emporte', () => {
    const opts = optionsEnveloppe(
      { fournisseur: f, image: 'x', variables: [], reseauCoupe: true },
      CWD,
    );
    expect(opts.reseauCoupe).toBe(true);
    const filtre = envelopper('claude', [], { ...opts, reseau: RESEAU, hote: HOTE_NU }).args;
    expect(filtre.join('\n')).toContain(MONTAGE_RESEAU);
  });
});

describe('le réseau voyage avec le bac de la tâche', () => {
  it('optionsEnveloppe transmet le réseau de l’exécution — validations comprises', () => {
    const opts = optionsEnveloppe(
      { fournisseur: BWRAP, image: 'x', variables: [], reseau: RESEAU },
      CWD,
    );
    expect(opts.reseau).toBe(RESEAU);
  });
});

describe('ce que l’isolement dit de lui-même', () => {
  it('un bac qui filtre le DIT, et dit encore ce qui passe', () => {
    const c = constat('conteneur', BWRAP, true);
    expect(c.protege.join(' ')).toMatch(/réseau sortant filtré/);
    expect(c.protege.join(' ')).toMatch(/leurres/);
    expect(c.laissePasser.join(' ')).toMatch(/hôtes permis/);
  });

  it('un bac qui ne sait pas filtrer ne le cache pas', () => {
    expect(constat('conteneur', PODMAN, false).laissePasser.join(' ')).toMatch(
      /ne sait pas le filtrer/,
    );
  });
});

describe('Codex vise la passerelle par sa configuration, pas par l’environnement', () => {
  it('`-c openai_base_url=…` quand le bac est filtré, rien sinon', () => {
    const execution = { sandbox: 'danger-full-access', depot: '/hive/tache' } as const;
    const base = `http://127.0.0.1:${PORT_RELAIS}/hive-api/openai`;
    const argv = argvCodex('fais', execution, undefined, undefined, undefined, base);
    expect(argv.join(' ')).toContain(`-c openai_base_url="${base}"`);
    // Avant le séparateur : une option, pas un morceau du prompt.
    const i = argv.findIndex((a) => a.startsWith('openai_base_url='));
    expect(argv[i - 1]).toBe('-c');
    expect(i).toBeLessThan(argv.indexOf('--'));
    expect(argvCodex('fais', execution).join(' ')).not.toContain('openai_base_url');
  });
});
