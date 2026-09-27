// L'isolement durci.
//
// Ce module construit la ligne de commande qui décide si l'agent d'un inconnu
// peut lire votre disque. Les tests vérifient donc les arguments EXACTS —
// pas « ça contient à peu près les bons flags », mais chaque garde nommément,
// parce qu'un flag oublié ne se voit pas à l'exécution : tout marche, et rien
// n'est isolé.
//
// Et une propriété qui compte autant que les autres : le module ne doit JAMAIS
// prétendre protéger ce qu'il ne protège pas. Une interface qui afficherait
// « isolé ✓ » sans dire que le réseau reste ouvert ferait prendre un risque à
// quelqu'un qui croit ne pas en prendre.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as agentWindows from '../src/shared/agent-windows.js';
import {
  CPU_MAX,
  FOURNISSEURS,
  HOME_CONTENEUR,
  IMAGE_DEFAUT,
  MEMOIRE_MAX,
  MODES,
  MONTAGE,
  PROCESSUS_MAX,
  VARIABLES_CHEMIN_HOTE,
  constat,
  decider,
  envelopper,
  fournisseurParNom,
  installationHote,
  modeDepuisEnv,
  racineDePaquet,
  type ContexteHote,
} from '../src/node-client/isolement.js';
import type { Fournisseur } from '../src/node-client/isolement.js';
import { runCommand, runCommandStreaming } from '../src/adapters/exec.js';

const PODMAN = fournisseurParNom('podman') as Fournisseur;
const DOCKER = fournisseurParNom('docker') as Fournisseur;
const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;
const CWD = '/home/membre/.hive/taches/t-42';

/**
 * Un hôte où rien n'est installé hors du système : les arguments de bubblewrap
 * ne dépendent alors pas des agents présents sur la machine qui fait tourner
 * le banc. Ceux qui éprouvent l'installation fabriquent la leur.
 */
const HOTE_NU: ContexteHote = { chemin: '', interdits: [] };

/** Enveloppe d'une commande d'agent typique. */
function enveloppe(f: Fournisseur, variables: string[] = ['ANTHROPIC_API_KEY']) {
  return envelopper('claude', ['-p', 'corriger le bug'], {
    fournisseur: f,
    cwdHote: CWD,
    variables,
    hote: HOTE_NU,
  });
}

describe('isolement — les fournisseurs', () => {
  it('podman passe AVANT docker', () => {
    // Podman tourne sans démon privilégié. Docker exige un démon root, ce qui
    // déplace le risque plutôt que de le réduire.
    const noms = FOURNISSEURS.map((f) => f.nom);
    expect(noms.indexOf('podman')).toBeLessThan(noms.indexOf('docker'));
  });

  it('chacun dit comment l’obtenir', () => {
    for (const f of FOURNISSEURS) {
      expect(f.installation.length, f.nom).toBeGreaterThan(10);
      expect(f.garanties.length, f.nom).toBeGreaterThan(1);
    }
  });

  it('les garanties nomment aussi les défauts', () => {
    // Docker : démon root. Bubblewrap : pas de cgroups. Une liste de garanties
    // qui ne dirait que le bon serait de la publicité, pas de la doc.
    expect(DOCKER.garanties.join(' ')).toMatch(/démon Docker tourne en root/);
    expect(BWRAP.garanties.join(' ')).toMatch(/ne borne NI la mémoire NI le CPU/);
  });
});

describe('isolement — les arguments d’un conteneur', () => {
  it('ne monte QUE le répertoire de la tâche', () => {
    // Le test central : ni $HOME, ni ~/.ssh, ni la socket du démon.
    const { args } = enveloppe(PODMAN);
    const montages = args.filter((a) => a.startsWith('--volume='));
    expect(montages).toEqual([`--volume=${CWD}:${MONTAGE}:rw`]);
  });

  it.each([DOCKER, PODMAN])('normalise le chemin Windows pour $nom', (fournisseur) => {
    const { args } = envelopper('claude', ['--version'], {
      fournisseur,
      cwdHote: String.raw`C:\Users\Alice Smith\hive`,
      variables: [],
    });
    expect(args).toContain('--volume=C:/Users/Alice Smith/hive:/hive/tache:rw');
  });

  it('ne monte JAMAIS la socket d’un démon de conteneurs', () => {
    // Monter docker.sock dans un conteneur donne la machine entière : c'est
    // l'évasion la plus simple qui existe.
    const { args } = enveloppe(DOCKER);
    expect(args.join(' ')).not.toMatch(/docker\.sock|podman\.sock|\/var\/run/);
  });

  it('pose toutes les gardes, nommément', () => {
    const { args } = enveloppe(PODMAN);
    for (const garde of [
      '--read-only', // la racine n'est pas réinscriptible
      '--cap-drop=ALL', // aucune capacité privilégiée
      '--security-opt=no-new-privileges', // pas d'élévation par setuid
      '--rm', // rien ne survit à la tâche
    ]) {
      expect(args, `garde absente : ${garde}`).toContain(garde);
    }
  });

  it('tourne sous un utilisateur non privilégié', () => {
    const { args } = enveloppe(PODMAN);
    expect(args.some((a) => a.startsWith('--user='))).toBe(true);
    expect(args).not.toContain('--user=0:0');
    const uid =
      typeof process.getuid === 'function' && process.getuid() > 0 ? process.getuid() : 1000;
    expect(args).toContain(`--user=${uid}:${uid}`);
  });

  it('borne mémoire, processus et CPU', () => {
    // Une bombe à fork ne doit pas emporter la machine du membre.
    const { args } = enveloppe(PODMAN);
    expect(args).toContain(`--memory=${MEMOIRE_MAX}`);
    expect(args).toContain(`--pids-limit=${PROCESSUS_MAX}`);
    expect(args).toContain(`--cpus=${CPU_MAX}`);
  });

  it('donne un /tmp inscriptible, mais en mémoire et non exécutable', () => {
    // Sans /tmp, la moitié des outils échouent ; avec un /tmp exécutable, on
    // rouvre la porte qu'on vient de fermer avec --read-only.
    const tmpfs = enveloppe(PODMAN).args.find((a) => a.startsWith('--tmpfs='));
    expect(tmpfs).toBeDefined();
    expect(tmpfs).toMatch(/noexec/);
    expect(tmpfs).toMatch(/nosuid/);
  });

  it("ne transmet pas le HOME de l'hôte au conteneur", () => {
    const { args } = envelopper('claude', ['--version'], {
      fournisseur: PODMAN,
      cwdHote: CWD,
      variables: ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME', 'ANTHROPIC_API_KEY'],
    });

    expect(args).toContain(`--env=HOME=${HOME_CONTENEUR}`);
    expect(args).not.toContain('--env=HOME');
    expect(args).not.toContain('--env=USERPROFILE');
    expect(args).not.toContain('--env=APPDATA');
    expect(args).not.toContain('--env=XDG_CONFIG_HOME');
    expect(args).toContain('--env=ANTHROPIC_API_KEY');
  });

  it('LE SECRET NE PASSE JAMAIS PAR LA LIGNE DE COMMANDE', () => {
    // `-e CLE=valeur` écrirait le secret dans la table des processus, lisible
    // par `ps` pour tout utilisateur de la machine. Le nom seul le fait
    // hériter de l'environnement de l'appelant.
    const { args } = enveloppe(PODMAN, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    expect(args).toContain('--env=ANTHROPIC_API_KEY');
    expect(args).toContain('--env=OPENAI_API_KEY');
    // Aucun « = » de plus : pas de valeur.
    for (const a of args.filter((x) => x.startsWith('--env=') && !x.startsWith('--env=HOME='))) {
      expect(a.split('=').length, `valeur exposée dans « ${a} »`).toBe(2);
    }
  });

  it('place l’image puis la commande, dans cet ordre', () => {
    const { bin, args } = enveloppe(PODMAN);
    expect(bin).toBe('podman');
    const i = args.indexOf(IMAGE_DEFAUT);
    expect(i).toBeGreaterThan(0);
    expect(args.slice(i + 1)).toEqual(['claude', '-p', 'corriger le bug']);
  });

  it('rend un TABLEAU d’arguments, jamais une chaîne', () => {
    // Une chaîne exigerait un shell pour être découpée, et rouvrirait
    // l'injection que le dépôt ferme partout ailleurs (§5.1).
    const { args } = enveloppe(PODMAN);
    expect(Array.isArray(args)).toBe(true);
    for (const a of args) expect(typeof a).toBe('string');
  });

  it('un argument d’agent hostile reste UN argument', () => {
    // Il ne peut pas se scinder en options du moteur de conteneurs.
    const { args } = envelopper('claude', ['-p', '; rm -rf / --volume=/:/hote'], {
      fournisseur: PODMAN,
      cwdHote: CWD,
      variables: [],
    });
    expect(args.filter((a) => a.startsWith('--volume='))).toHaveLength(1);
    expect(args).toContain('; rm -rf / --volume=/:/hote');
  });

  it('docker et podman partagent la même grammaire', () => {
    const p = enveloppe(PODMAN);
    const d = enveloppe(DOCKER);
    expect(p.args).toEqual(d.args);
    expect(p.bin).toBe('podman');
    expect(d.bin).toBe('docker');
  });
});

describe('isolement — bubblewrap', () => {
  it('n’ouvre en écriture que le répertoire de la tâche', () => {
    const { args } = enveloppe(BWRAP);
    // Un seul --bind (écriture) ; tout le reste est --ro-bind.
    const ecritures = args.filter((a, i) => a === '--bind' && args[i + 1] !== undefined);
    expect(ecritures).toHaveLength(1);
    expect(args[args.indexOf('--bind') + 1]).toBe(CWD);
  });

  it('monte le système de l’hôte en LECTURE SEULE', () => {
    const { args } = enveloppe(BWRAP);
    for (const chemin of ['/usr', '/bin', '/lib']) {
      const i = args.indexOf(chemin);
      expect(args[i - 1], `${chemin} n’est pas en lecture seule`).toBe('--ro-bind');
    }
  });

  it('tolère l’absence des chemins optionnels', () => {
    // /lib64 n'existe pas partout ; `--ro-bind-try` ne fait pas échouer le
    // lancement, là où `--ro-bind` refuserait de démarrer.
    const { args } = enveloppe(BWRAP);
    expect(args[args.indexOf('/lib64') - 1]).toBe('--ro-bind-try');
  });

  it('meurt avec son parent et n’hérite d’aucune session', () => {
    const { args } = enveloppe(BWRAP);
    expect(args).toContain('--die-with-parent');
    expect(args).toContain('--new-session');
    expect(args).toContain('--unshare-all');
  });

  it('garde le réseau — et c’est délibéré', () => {
    // Un agent de codage doit joindre l'API de son modèle.
    expect(enveloppe(BWRAP).args).toContain('--share-net');
  });

  it('sépare la commande par « -- »', () => {
    // Sans ça, la commande de l'agent serait lue comme des options de bwrap.
    const { args } = enveloppe(BWRAP);
    const i = args.indexOf('--');
    expect(i).toBeGreaterThan(0);
    expect(args.slice(i + 1)).toEqual(['claude', '-p', 'corriger le bug']);
  });

  it('dit au processus OÙ il est : HOME éphémère, TMPDIR et tâche DANS le bac', () => {
    // Ces trois variables pointaient vers des chemins de l'HÔTE que le bac ne
    // monte pas : `mktemp` y rendait 1, et l'agent n'avait aucun HOME où écrire.
    const { args } = enveloppe(BWRAP);
    const poses = new Map<string, string>();
    args.forEach((a, i) => {
      if (a === '--setenv') poses.set(args[i + 1]!, args[i + 2]!);
    });
    expect(Object.fromEntries(poses)).toEqual({
      HOME: HOME_CONTENEUR,
      TMPDIR: '/tmp',
      HIVE_TASK_CWD: MONTAGE,
    });
    // Le HOME existe réellement, et dans le tmpfs : effacé à l'arrêt.
    expect(args.indexOf('--dir')).toBeGreaterThan(args.indexOf('--tmpfs'));
    expect(args[args.indexOf('--dir') + 1]).toBe(HOME_CONTENEUR);
  });

  it('AUCUN chemin de l’hôte ne traverse — TEMP, TMP, et les dossiers de session', () => {
    const { args } = enveloppe(BWRAP);
    const retires = args.flatMap((a, i) => (a === '--unsetenv' ? [args[i + 1]] : []));
    for (const v of ['TEMP', 'TMP', ...VARIABLES_CHEMIN_HOTE.filter((x) => x !== 'HOME')]) {
      expect(retires, v).toContain(v);
    }
    // `GROK_HOME` en est : la session de navigateur de Grok est un dossier de
    // l'hôte, que le bac ne monte pas.
    expect(retires).toContain('GROK_HOME');
  });

  it('les outils ordinaires y trouvent leur /etc — sans jamais /etc/shadow', () => {
    const { args } = enveloppe(BWRAP);
    for (const f of [
      '/etc/passwd',
      '/etc/group',
      '/etc/hosts',
      '/etc/nsswitch.conf',
      '/etc/alternatives',
    ]) {
      const i = args.indexOf(f);
      expect(args[i - 1], f).toBe('--ro-bind-try');
      expect(args[i + 1], f).toBe(f);
    }
    expect(args.join(' ')).not.toContain('shadow');
    expect(args.join(' ')).not.toMatch(/--bind(-try)? \/etc/);
  });

  it('aucune valeur secrète n’entre dans argv, même quand l’environnement en porte', () => {
    // bubblewrap fait HÉRITER l'environnement de la tâche : ses clés n'ont
    // aucune raison de passer par `--setenv`, où `ps` les lirait.
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-oat01-ne-doit-pas-fuir');
    vi.stubEnv('CODEX_API_KEY', 'sk-codex-ne-doit-pas-fuir');
    try {
      const { args } = envelopper('claude', ['-p', 'x'], {
        fournisseur: BWRAP,
        cwdHote: CWD,
        variables: ['CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_API_KEY'],
        hote: HOTE_NU,
      });
      expect(args.join(' ')).not.toContain('ne-doit-pas-fuir');
      expect(args).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
      expect(args).not.toContain('CODEX_API_KEY');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ─── BUBBLEWRAP ET L'AGENT QUE LE MEMBRE A RÉELLEMENT INSTALLÉ ───────────────
//
// Mesuré sur un hôte réel : le preflight bubblewrap passait pour `git` et
// échouait pour `claude`, `codex`, `cursor-agent` et `node`, tous installés
// sous `$HOME` que le bac ne montait pas. Ces bancs fabriquent de VRAIES
// installations (fichiers, liens, préfixe Node) et regardent ce qui est monté.
// Bubblewrap n'existe que sous Linux ; les liens symboliques de Windows
// exigent des droits que le runner n'a pas.
describe.skipIf(process.platform === 'win32')('isolement — bubblewrap monte l’installation', () => {
  let racine = '';
  afterEach(() => {
    if (racine) rmSync(racine, { recursive: true, force: true });
    racine = '';
  });

  /** Un exécutable réel, au chemin demandé. */
  const executable = (chemin: string, contenu = '#!/bin/sh\nexit 0\n'): string => {
    mkdirSync(path.dirname(chemin), { recursive: true });
    writeFileSync(chemin, contenu);
    chmodSync(chemin, 0o755);
    return chemin;
  };
  const lien = (cible: string, chemin: string): void => {
    mkdirSync(path.dirname(chemin), { recursive: true });
    symlinkSync(cible, chemin);
  };
  // `realpath` : sous macOS, le dossier temporaire est un lien vers /private.
  const hoteFactice = (): string =>
    (racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-hote-'))));

  it('installeur natif : la version installée, et le lien du PATH recréé — pas ~/.local/bin', () => {
    const maison = path.join(hoteFactice(), 'home');
    const version = executable(path.join(maison, '.local/share/agent/versions/1.0.0'));
    lien(version, path.join(maison, '.local/bin/agent'));
    executable(path.join(maison, '.local/bin/autre-outil'));

    const r = installationHote('agent', {
      chemin: path.join(maison, '.local/bin'),
      interdits: [maison],
    });
    expect(r.racines).toEqual([path.join(maison, '.local/share/agent/versions')]);
    expect(r.liens).toEqual([{ lien: path.join(maison, '.local/bin/agent'), cible: version }]);
    // Le reste de ~/.local/bin n'est PAS monté : le lien suffit au nom logique.
    expect(r.racines.some((d) => d.endsWith('.local/bin'))).toBe(false);
  });

  it('paquet npm : le PAQUET entier (binaire natif compris), et le préfixe de Node', () => {
    const prefixe = path.join(hoteFactice(), 'node');
    executable(path.join(prefixe, 'bin/node'));
    const lanceur = executable(
      path.join(prefixe, 'lib/node_modules/@openai/codex/bin/codex.js'),
      '#!/usr/bin/env node\n',
    );
    lien('../lib/node_modules/@openai/codex/bin/codex.js', path.join(prefixe, 'bin/codex'));

    const r = installationHote('codex', { chemin: path.join(prefixe, 'bin'), interdits: [] });
    // `bin/` pour `node` lui-même, `lib/` pour npm et les CLI globaux — et le
    // paquet de Codex, dessous, n'est pas monté deux fois.
    expect(r.racines).toEqual([path.join(prefixe, 'bin'), path.join(prefixe, 'lib')]);
    // `bin/codex` est déjà visible dans le préfixe monté : rien à recréer.
    expect(r.liens).toEqual([]);
    expect(racineDePaquet(lanceur)).toBe(path.join(prefixe, 'lib/node_modules/@openai/codex'));
  });

  it('le `node` du PATH vient avec toute commande : pont MCP, `#!/usr/bin/env node`', () => {
    const base = hoteFactice();
    executable(path.join(base, 'nvm/versions/node/v24/bin/node'));
    lien(path.join(base, 'nvm/versions/node/v24/bin/node'), path.join(base, 'bin/node'));
    executable(path.join(base, 'outils/agent'));

    const r = installationHote('agent', {
      chemin: [path.join(base, 'bin'), path.join(base, 'outils')].join(path.delimiter),
      interdits: [],
    });
    // Ce préfixe n'a pas de `lib/` : une racine absente n'est pas montée
    // (`--ro-bind` refuserait de démarrer).
    expect(r.racines).toEqual([
      path.join(base, 'outils'),
      path.join(base, 'nvm/versions/node/v24/bin'),
    ]);
    expect(r.liens).toEqual([
      {
        lien: path.join(base, 'bin/node'),
        cible: path.join(base, 'nvm/versions/node/v24/bin/node'),
      },
    ]);
  });

  it('JAMAIS le HOME, ni un de ses parents : la commande reste invisible', () => {
    // Un binaire posé à même le HOME donnerait le HOME entier comme racine —
    // clés SSH comprises. On préfère un preflight qui échoue et le dit.
    const maison = path.join(hoteFactice(), 'home');
    executable(path.join(maison, 'agent'));
    const r = installationHote('agent', { chemin: maison, interdits: [maison] });
    expect(r.racines).toEqual([]);
  });

  it('jamais l’installation de Hive ni le répertoire des tâches', () => {
    const hive = path.join(hoteFactice(), 'hive');
    executable(path.join(hive, 'agent'));
    const tache = path.join(hive, '.hive-work/n/tasks/t-1');
    mkdirSync(tache, { recursive: true });
    const { args } = envelopper('agent', [], {
      fournisseur: BWRAP,
      cwdHote: tache,
      variables: [],
      hote: { chemin: hive, interdits: [] },
    });
    // Le seul montage de `hive` est la tâche elle-même, sur le point de montage.
    expect(args.filter((a) => a.startsWith(hive))).toEqual([tache]);
  });

  it('une entrée relative du PATH ne résout rien — elle viserait le cwd de Hive', () => {
    const base = hoteFactice();
    executable(path.join(base, 'agent'));
    // Relative au cwd du banc, cette entrée ATTEINT l'agent : seule la règle
    // « jamais d'entrée relative » l'empêche d'être résolue et montée.
    const relative = path.relative(process.cwd(), base);
    expect(path.isAbsolute(relative)).toBe(false);
    expect(installationHote('agent', { chemin: relative, interdits: [] })).toEqual({
      racines: [],
      liens: [],
    });
  });

  it('ce que le système monte déjà n’est pas remonté', () => {
    // `/bin/sh` existe sur tout hôte POSIX ; sa vraie place est sous /usr ou /bin.
    const r = installationHote('sh', { chemin: '/bin:/usr/bin', interdits: [] });
    expect(r.racines).toEqual([]);
    expect(r.liens).toEqual([]);
  });

  it('l’enveloppe monte ce qu’elle a trouvé, en LECTURE SEULE, et lance le NOM logique', () => {
    const maison = path.join(hoteFactice(), 'home');
    const version = executable(path.join(maison, '.local/share/agent/versions/1.0.0'));
    lien(version, path.join(maison, '.local/bin/agent'));
    const { args } = envelopper('agent', ['--version'], {
      fournisseur: BWRAP,
      cwdHote: CWD,
      variables: [],
      hote: { chemin: path.join(maison, '.local/bin'), interdits: [maison] },
    });
    const dossier = path.join(maison, '.local/share/agent/versions');
    const i = args.indexOf(dossier);
    expect(args.slice(i - 1, i + 2)).toEqual(['--ro-bind', dossier, dossier]);
    // Monté APRÈS le tmpfs de /tmp : une installation sous /tmp resterait visible.
    expect(i).toBeGreaterThan(args.indexOf('--tmpfs'));
    const j = args.indexOf('--symlink');
    expect(args.slice(j, j + 3)).toEqual([
      '--symlink',
      version,
      path.join(maison, '.local/bin/agent'),
    ]);
    // Toujours un seul chemin inscriptible.
    expect(args.filter((a) => a === '--bind')).toHaveLength(1);
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['agent', '--version']);
  });
});

describe('isolement — ne jamais prétendre plus qu’on ne fait', () => {
  it('même au meilleur niveau, dit ce qui passe encore', () => {
    // C'est la propriété qui distingue une doc honnête d'un argument de vente.
    const c = constat('conteneur', PODMAN);
    expect(c.laissePasser.length).toBeGreaterThan(0);
    expect(c.laissePasser.join(' ')).toMatch(/réseau/);
  });

  it('la sandbox de processus ne se présente PAS comme une isolation', () => {
    const c = constat('processus', null);
    expect(c.laissePasser.join(' ')).toMatch(/DISQUE ENTIER/);
    expect(c.laissePasser.join(' ')).toMatch(/clés SSH/);
  });

  it('« aucun » ne protège rien, et le dit', () => {
    const c = constat('aucun', null);
    expect(c.protege).toEqual([]);
    expect(c.laissePasser.length).toBeGreaterThan(0);
  });
});

describe('isolement — la décision du nœud', () => {
  it('avec un moteur, on isole', () => {
    const d = decider('auto', PODMAN);
    expect(d.isole).toBe(true);
    expect(d.niveau).toBe('conteneur');
    expect(d.refuse).toBe(false);
  });

  it('en « auto » sans moteur, on travaille MAIS on le dit', () => {
    // Ne pas bloquer une ruche entre amis ; ne pas mentir non plus.
    const d = decider('auto', null);
    expect(d.isole).toBe(false);
    expect(d.refuse).toBe(false);
    expect(d.niveau).toBe('processus');
    expect(d.motif).toMatch(/aucun moteur/);
    expect(d.motif, 'le motif doit dire quoi faire').toMatch(/podman/);
  });

  it('en « exige » sans moteur, le nœud REFUSE de travailler', () => {
    // Le mode de quiconque prête sa machine à des inconnus : mieux vaut un
    // nœud qui ne prend pas de tâche qu'un nœud qui en prend une sans bac à
    // sable en croyant le contraire.
    const d = decider('exige', null);
    expect(d.refuse).toBe(true);
    expect(d.niveau).toBe('aucun');
    expect(d.motif).toMatch(/refuse de travailler/);
    // Et il dit comment s'en sortir.
    for (const f of FOURNISSEURS) expect(d.motif).toContain(f.nom);
  });

  it('en « exige » AVEC un moteur, tout va bien', () => {
    expect(decider('exige', PODMAN).refuse).toBe(false);
  });

  it('« off » n’isole pas et ne refuse rien', () => {
    const d = decider('off', PODMAN);
    expect(d.isole).toBe(false);
    expect(d.refuse).toBe(false);
    expect(d.motif).toMatch(/désactivé/);
  });

  it('aucun mode ne mène à « isolé » sans moteur', () => {
    // Balayage exhaustif : la garantie ne doit pas dépendre d'un cas oublié.
    for (const mode of MODES) expect(decider(mode, null).isole, mode).toBe(false);
  });
});

describe('isolement — le mode lu de l’environnement', () => {
  it('défaut « auto » : améliore sans bloquer', () => {
    expect(modeDepuisEnv({})).toBe('auto');
    expect(modeDepuisEnv({ HIVE_ISOLEMENT: '' })).toBe('auto');
  });

  it('une faute de frappe retombe sur le défaut, jamais sur « off »', () => {
    // Se tromper de valeur ne doit pas pouvoir DÉSACTIVER une protection.
    expect(modeDepuisEnv({ HIVE_ISOLEMENT: 'offf' })).toBe('auto');
    expect(modeDepuisEnv({ HIVE_ISOLEMENT: 'OFF' })).toBe('auto');
    expect(modeDepuisEnv({ HIVE_ISOLEMENT: 'nope' })).toBe('auto');
  });

  it('lit les valeurs déclarées', () => {
    for (const mode of MODES) expect(modeDepuisEnv({ HIVE_ISOLEMENT: mode })).toBe(mode);
  });
});

describe('isolement — câblage : l’enveloppe atteint vraiment le spawn', () => {
  // Un module d'isolement que personne n'appelle est une décoration
  // dangereuse : il donne l'impression que le problème est réglé. On lance
  // donc un VRAI processus et on regarde ce qu'il a reçu.
  //
  // Le faux fournisseur pointe sur `echo`, qui réimprime ses arguments : la
  // sortie EST la ligne de commande qu'un vrai moteur aurait reçue.
  const ECHO: Fournisseur = {
    nom: 'echo-de-test',
    bin: 'echo',
    niveau: 'conteneur',
    installation: 'aucune',
    garanties: [],
  };

  const ctx = (bac?: { fournisseur: Fournisseur; variables: readonly string[] }) => ({
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    attempt: 1,
    signal: new AbortController().signal,
    onProgress: () => {},
    ...(bac ? { bac: { ...bac, image: IMAGE_DEFAUT } } : {}),
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['classique', 'flux'] as const)(
    'résout le lanceur hôte uniquement hors du bac — %s',
    async (mode) => {
      // Imite le contrat du lanceur Windows ; le processus enfant reste réel.
      vi.spyOn(agentWindows, 'argvAgent').mockReturnValue([
        process.execPath,
        '-e',
        'console.log("lanceur-hote")',
      ]);
      const lancer = (contexte: ReturnType<typeof ctx>) =>
        mode === 'classique'
          ? runCommand('claude', [], contexte)
          : runCommandStreaming('claude', [], contexte, () => {});

      const hote = await lancer(ctx());
      expect(hote.success).toBe(true);
      expect(hote.logs.trim()).toBe('lanceur-hote');

      const bac = await lancer(ctx({ fournisseur: ECHO, variables: [] }));
      expect(bac.success).toBe(true);
      expect(bac.logs.trim().endsWith(`${IMAGE_DEFAUT} claude`)).toBe(true);
      expect(bac.logs).not.toContain('lanceur-hote');
    },
  );

  it('sans bac, la commande part telle quelle', async () => {
    const r = await runCommand('echo', ['bonjour'], ctx());
    expect(r.logs.trim()).toBe('bonjour');
  });

  it('AVEC un bac, la commande est enveloppée avant d’être lancée', async () => {
    const r = await runCommand('claude', ['-p', 'test'], ctx({ fournisseur: ECHO, variables: [] }));
    // `echo` a reçu les arguments du moteur : la commande de l'agent a bien
    // été enveloppée, et non lancée directement.
    expect(r.logs).toContain('run');
    expect(r.logs).toContain('--read-only');
    expect(r.logs).toContain('--cap-drop=ALL');
    expect(r.logs).toContain(`--volume=${process.cwd().replaceAll('\\', '/')}:${MONTAGE}:rw`);
    // …et la commande de l'agent est à la fin, intacte.
    expect(r.logs.trim().endsWith('claude -p test')).toBe(true);
  });

  it('le mode FLUX est enveloppé lui aussi', async () => {
    // Sans ça, l'isolement sauterait pour l'agent le plus courant.
    const lignes: string[] = [];
    const r = await runCommandStreaming(
      'claude',
      ['-p', 'test'],
      ctx({ fournisseur: ECHO, variables: [] }),
      (l) => lignes.push(l),
    );
    expect(r.logs).toContain('--cap-drop=ALL');
    expect(lignes.join('\n')).toContain('--read-only');
  });

  it.each(['classique', 'flux'] as const)(
    'l’entrée de l’agent est FERMÉE : un CLI qui lit stdin jusqu’au bout ne bloque pas — %s',
    async (mode) => {
      // `codex exec` ajoute au prompt ce qu'il lit sur une entrée qui n'est pas
      // un terminal, jusqu'à la fin de fichier. Un tube ouvert que Hive
      // n'écrit jamais le laissait attendre jusqu'au délai dur : 15 minutes par
      // tâche. Ce faux agent fait exactement la même lecture.
      const lecteur = [
        '-e',
        "process.stdin.resume(); process.stdin.on('end', () => console.log('fin-de-l-entree'));",
      ];
      const r =
        mode === 'classique'
          ? await runCommand(process.execPath, lecteur, ctx(), 5_000)
          : await runCommandStreaming(process.execPath, lecteur, ctx(), () => {}, 5_000);
      expect(r.logs).not.toContain('timeout');
      expect(r.success, r.logs).toBe(true);
      expect(r.logs.trim()).toBe('fin-de-l-entree');
    },
  );

  it('le secret passe par son NOM, jusque dans le processus lancé', async () => {
    const r = await runCommand(
      'claude',
      ['-p', 'test'],
      ctx({ fournisseur: ECHO, variables: ['ANTHROPIC_API_KEY'] }),
    );
    expect(r.logs).toContain('--env=ANTHROPIC_API_KEY');
    // Aucune valeur : `ps` ne verrait jamais le secret.
    expect(r.logs).not.toMatch(/--env=ANTHROPIC_API_KEY=/);
  });
});
