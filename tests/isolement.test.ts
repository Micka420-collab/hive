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

import { describe, expect, it } from 'vitest';
import {
  CPU_MAX,
  FOURNISSEURS,
  IMAGE_DEFAUT,
  MEMOIRE_MAX,
  MODES,
  MONTAGE,
  PROCESSUS_MAX,
  constat,
  decider,
  envelopper,
  fournisseurParNom,
  modeDepuisEnv,
} from '../src/node-client/isolement.js';
import type { Fournisseur } from '../src/node-client/isolement.js';
import { runCommand, runCommandStreaming } from '../src/adapters/exec.js';

const PODMAN = fournisseurParNom('podman') as Fournisseur;
const DOCKER = fournisseurParNom('docker') as Fournisseur;
const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;
const CWD = '/home/membre/.hive/taches/t-42';

/** Enveloppe d'une commande d'agent typique. */
function enveloppe(f: Fournisseur, variables: string[] = ['ANTHROPIC_API_KEY']) {
  return envelopper('claude', ['-p', 'corriger le bug'], {
    fournisseur: f,
    cwdHote: CWD,
    variables,
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

  it('LE SECRET NE PASSE JAMAIS PAR LA LIGNE DE COMMANDE', () => {
    // `-e CLE=valeur` écrirait le secret dans la table des processus, lisible
    // par `ps` pour tout utilisateur de la machine. Le nom seul le fait
    // hériter de l'environnement de l'appelant.
    const { args } = enveloppe(PODMAN, ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']);
    expect(args).toContain('--env=ANTHROPIC_API_KEY');
    expect(args).toContain('--env=OPENAI_API_KEY');
    // Aucun « = » de plus : pas de valeur.
    for (const a of args.filter((x) => x.startsWith('--env='))) {
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
    ...(bac ? { bac } : {}),
  });

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
    expect(r.logs).toContain(`--volume=${process.cwd()}:${MONTAGE}:rw`);
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
