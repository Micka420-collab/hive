// LE PILOTE D'UNE EXÉCUTION — Sandbox Live, côté nœud, contre de VRAIS processus.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · la mesure porte sur l'ARBRE de l'agent (petit-enfant compris), relevée à
//   intervalle, et le CPU n'apparaît qu'au second relevé — jamais un 0 inventé ;
// · la pause gèle TOUT l'arbre (SIGSTOP), la reprise le relance (SIGCONT), et
//   l'horloge de la tâche (délai dur, budget) est suspendue pendant la pause,
//   puis rend exactement le temps qui restait ;
// · Windows hors conteneur : pas de table, pas de pause — `pausable: false` et
//   aucune mesure, plutôt qu'un geste qui échoue ou un nombre inventé ;
// · un conteneur se suspend et se mesure par son MOTEUR (`pause`, `stats`),
//   et un moteur qui refuse laisse l'exécution « pas en pause », dit tel quel ;
// · un agent qui sort pendant une pause rend son horloge à la suite de la tâche ;
// · une pause EN VOL (ses tours de SIGSTOP sont attendus) que croise un arrêt —
//   annulation, délai dépassé — ne laisse RIEN gelé : le geste se défait ;
// · le délai dur de `runCommand` passe VRAIMENT par le pilote : une pause plus
//   longue que lui ne tue pas l'agent, qui retrouve le temps qui lui restait ;
// · après une coupure, `instantane` redit l'état entier — pause comprise.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
import type { EtatDirect } from '../src/shared/bac-direct.js';
import type { ProcessusVu } from '../src/node-client/mesure-processus.js';
import { PiloteExecution, SONDES_REELLES } from '../src/node-client/pilote-execution.js';
import type { SondesPilote } from '../src/node-client/pilote-execution.js';

let dossier = '';
const enfants: ChildProcess[] = [];

afterEach(() => {
  for (const e of enfants.splice(0)) {
    try {
      // Relancé puis tué : un processus arrêté laissé par un test raté ne
      // traiterait pas le SIGKILL de son groupe… mais SIGKILL passe toujours.
      if (e.pid) process.kill(-e.pid, 'SIGKILL');
    } catch {
      /* déjà sorti */
    }
  }
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string, delai = 10_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(message);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tout ce que le pilote a envoyé, fusionné comme le ferait le hub (dernier mot). */
function recueil() {
  const envois: EtatDirect[] = [];
  const dernier = <K extends keyof EtatDirect>(cle: K): EtatDirect[K] | undefined => {
    for (let i = envois.length - 1; i >= 0; i -= 1) if (cle in envois[i]!) return envois[i]![cle];
    return undefined;
  };
  return { envois, envoyer: (e: EtatDirect) => void envois.push(e), dernier };
}

describe.skipIf(process.platform === 'win32')('le pilote — un vrai arbre de processus', () => {
  it('MESURE l’arbre, le GÈLE en pause avec son horloge, et le RELANCE', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'pilote-execution-'));
    // Écrit À CÔTÉ, puis renommé : `writeFileSync` tronque avant d'écrire, et
    // une lecture tombée entre les deux — juste après SIGCONT, quand les
    // battements en retard partent tous — lisait un fichier vide, donc 0 : un
    // arbre repris passait pour un arbre resté gelé.
    const battement = (qui: string) => {
      const fichier = JSON.stringify(path.join(dossier, `hb-${qui}`));
      const brouillon = JSON.stringify(path.join(dossier, `hb-${qui}.tmp`));
      return (
        `let n = 0; setInterval(() => { require('node:fs').writeFileSync(${brouillon}, ` +
        `String(++n)); require('node:fs').renameSync(${brouillon}, ${fichier}); }, 20);\n`
      );
    };
    const petit = path.join(dossier, 'petit.js');
    // Le petit-enfant BRÛLE du CPU : la mesure doit le voir, pas seulement le parent.
    writeFileSync(
      petit,
      battement('petit') +
        'setInterval(() => { const f = Date.now() + 15; while (Date.now() < f) {} }, 20);\n',
    );
    const parent = path.join(dossier, 'parent.js');
    writeFileSync(
      parent,
      "const { spawn } = require('node:child_process');\n" +
        `spawn(process.execPath, [${JSON.stringify(petit)}], { stdio: 'ignore' });\n` +
        battement('parent'),
    );
    // Son propre groupe : `afterEach` tue tout l'arbre d'un coup, même raté.
    const agent = spawn(process.execPath, [parent], { stdio: 'ignore', detached: true });
    enfants.push(agent);
    const lire = (qui: string): number => {
      try {
        return Number(readFileSync(path.join(dossier, `hb-${qui}`), 'utf8')) || 0;
      } catch {
        return 0;
      }
    };
    await attendre(() => lire('petit') > 2, 'le petit-enfant ne bat pas');

    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, SONDES_REELLES, 150);
    const detacher = pilote.attacher({ pid: agent.pid!, commande: 'node parent.js' });
    expect(r.envois[0]).toMatchObject({
      commande: 'node parent.js',
      pausable: true,
      enPause: false,
    });

    // ── La mesure : l'arbre entier, le CPU au second relevé ─────────────────
    await attendre(() => r.envois.some((e) => e.metriques), 'aucune mesure');
    const premiere = r.envois.find((e) => e.metriques)!.metriques!;
    expect(premiere.source).toBe('arbre');
    expect(premiere.cpuPct, 'le premier relevé n’a pas de fenêtre : pas de CPU').toBeUndefined();
    await attendre(
      () => r.envois.some((e) => e.metriques?.cpuPct !== undefined && e.metriques.processus! >= 2),
      'le CPU de l’arbre (petit-enfant compris) n’est jamais mesuré',
    );
    const m = r.envois.filter((e) => e.metriques?.cpuPct !== undefined).at(-1)!.metriques!;
    expect(m.processus).toBeGreaterThanOrEqual(2);
    expect(m.memoireOctets).toBeGreaterThan(1024 * 1024);
    expect(m.memoire, 'sous Linux, le Pss de l’arbre ; ailleurs, la somme de ses RSS').toBe(
      process.platform === 'linux' ? 'pss' : 'somme_rss',
    );
    expect(m.cpuPct).toBeGreaterThan(0);

    // ── La pause : l'arbre gèle, l'horloge aussi ────────────────────────────
    let declenche = false;
    const delai = pilote.minuteur(400, () => {
      declenche = true;
    });
    expect(await pilote.suspendre()).toBe(true);
    expect(r.dernier('enPause')).toBe(true);
    expect(pilote.enPause).toBe(true);
    await dormir(100);
    const geleParent = lire('parent');
    const gelePetit = lire('petit');
    const restantEnPause = delai.restant();
    await dormir(700);
    expect(lire('parent'), 'le parent bat en pause').toBe(geleParent);
    expect(lire('petit'), 'le petit-enfant bat en pause').toBe(gelePetit);
    expect(declenche, 'le délai a couru pendant la pause').toBe(false);
    expect(delai.restant()).toBe(restantEnPause);

    // ── La reprise : l'arbre repart, le délai rend ce qui restait ───────────
    expect(await pilote.reprendre()).toBe(true);
    expect(r.dernier('enPause')).toBe(false);
    await attendre(() => lire('petit') > gelePetit + 2, 'le petit-enfant ne repart pas');
    expect(lire('parent')).toBeGreaterThan(geleParent);
    await attendre(() => declenche, 'le délai repris ne déclenche jamais', 2_000);

    // ── Sortie : plus de mesure, plus de pause offerte ──────────────────────
    detacher();
    expect(r.envois.at(-1)).toEqual({ pausable: false, enPause: false, metriques: null });
    const n = r.envois.length;
    await dormir(400);
    expect(r.envois.length, 'un processus détaché est encore mesuré').toBe(n);
    pilote.fermer();
  });
});

/** Le pid est-il encore un processus vivant (ni sorti, ni zombie) ? `'T'` : arrêté. */
function etatDe(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.charAt(0);
  } catch {
    return null;
  }
}

/** Un agent qui bat sans fin, dans son groupe ; tué avec son signal d'annulation. */
function agentSansFin(signal?: AbortSignal): ChildProcess {
  const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 20)'], {
    stdio: 'ignore',
    detached: true,
    ...(signal ? { signal } : {}),
  });
  agent.on('error', () => undefined); // l'annulation rejette par `error`
  enfants.push(agent);
  return agent;
}

const sortiDe = (agent: ChildProcess): Promise<void> =>
  new Promise((ok) => {
    if (agent.exitCode !== null || agent.signalCode !== null) ok();
    else agent.once('exit', () => ok());
  });

/**
 * Des sondes RÉELLES dont la table est lente : les tours de SIGSTOP d'une
 * pause sont attendus (un `ps` sous macOS, un `/proc` chargé) — c'est la
 * fenêtre où un arrêt tombe entre la racine arrêtée et `enPause`.
 */
const sondesLentes = (): SondesPilote => ({
  ...SONDES_REELLES,
  table: async () => {
    await dormir(200);
    return SONDES_REELLES.table();
  },
});

describe.runIf(process.platform === 'linux')(
  'le pilote — un arrêt qui croise une pause EN VOL',
  () => {
    it('ANNULÉE pendant la pause en vol (`arreter`, puis SIGTERM) : l’agent meurt, rien ne reste gelé', async () => {
      const ctrl = new AbortController();
      const agent = agentSansFin(ctrl.signal);
      const pilote = new PiloteExecution(() => undefined, sondesLentes(), 60_000);
      pilote.attacher({ pid: agent.pid!, commande: 'agent' });
      const pause = pilote.suspendre();
      await dormir(50);
      expect(etatDe(agent.pid!), 'la racine doit déjà être arrêtée').toBe('T');
      expect(pilote.enPause, 'la pause est encore en vol').toBe(false);
      // Exactement `annulerTache` : réveiller, PUIS signaler.
      await pilote.arreter();
      ctrl.abort();
      expect(await pause, 'une pause croisée par un arrêt ne se conclut pas').toBe(false);
      await sortiDe(agent);
      expect(pilote.enPause).toBe(false);
      pilote.fermer();
    });

    it('DÉTACHÉ pendant la pause en vol (délai dépassé) : l’arbre est relancé, le SIGTERM passe', async () => {
      // Ni `arreter` ni annulation : le seul détachement (`surDelai` d'exec.ts)
      // doit relancer ce que la pause en vol a arrêté — avant, il l'oubliait.
      const agent = agentSansFin();
      const pilote = new PiloteExecution(() => undefined, sondesLentes(), 60_000);
      const detacher = pilote.attacher({ pid: agent.pid!, commande: 'agent' });
      const pause = pilote.suspendre();
      await dormir(50);
      expect(etatDe(agent.pid!)).toBe('T');
      detacher();
      agent.kill('SIGTERM');
      expect(await pause).toBe(false);
      await sortiDe(agent);
      pilote.fermer();
    });

    it('APRÈS un arrêt, plus aucune pause : le geste est refusé et le bouton caché', async () => {
      const agent = agentSansFin();
      const r = recueil();
      const pilote = new PiloteExecution(r.envoyer, SONDES_REELLES, 60_000);
      pilote.attacher({ pid: agent.pid!, commande: 'agent' });
      await pilote.arreter();
      expect(r.dernier('pausable')).toBe(false);
      expect(await pilote.suspendre()).toBe(false);
      expect(etatDe(agent.pid!), 'un agent qu’on arrête ne se gèle plus').not.toBe('T');
      pilote.fermer();
    });
  },
);

describe.skipIf(process.platform === 'win32')('le pilote — le délai dur de runCommand', () => {
  it('une pause PLUS LONGUE que le délai ne tue pas l’agent : il retrouve le temps qui restait', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'pilote-delai-'));
    // ~600 ms de travail ACTIF (30 battements de 20 ms), sous un délai de 1,5 s.
    const script =
      'let n = 0; const t = setInterval(() => { if (++n >= 30) { clearInterval(t); ' +
      "console.log('fini'); process.exit(0); } }, 20);";
    const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 60_000);
    const fin = runCommand(
      process.execPath,
      ['-e', script],
      {
        cwd: dossier,
        env: { PATH: process.env.PATH ?? '' },
        attempt: 1,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        pilote,
      },
      1_500,
    );
    await dormir(150);
    expect(await pilote.suspendre()).toBe(true);
    // Deux secondes de pause : un délai qui courait aurait tué l'agent.
    await dormir(2_000);
    expect(await pilote.reprendre()).toBe(true);
    const r = await fin;
    expect(r.success, r.logs).toBe(true);
    expect(r.logs).toContain('fini');
    pilote.fermer();
  }, 15_000);
});

describe('le pilote — l’état entier, redit après une coupure', () => {
  it('`instantane` redit phase, commande, mesure, validations — et la pause, relue maintenant', async () => {
    const b = sondesDeBanc();
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    pilote.phase('agent');
    pilote.attacher({ pid: 77, commande: 'claude -p' });
    expect(await pilote.suspendre()).toBe(true);
    pilote.controle('tests', 'en_cours');
    r.envois.length = 0;

    pilote.instantane();

    expect(r.envois).toEqual([
      {
        phase: 'agent',
        commande: 'claude -p',
        pausable: true,
        enPause: true,
        controles: { tests: 'en_cours' },
      },
    ]);
    pilote.fermer();
    pilote.instantane();
    expect(r.envois, 'un pilote fermé se tait').toHaveLength(1);
  });
});

/** Des sondes de banc : rien ne touche la machine, chaque appel est consigné. */
function sondesDeBanc(sur: Partial<SondesPilote> = {}) {
  const signaux: Array<[number, string]> = [];
  const moteur: string[][] = [];
  const sondes: SondesPilote = {
    plateforme: 'linux',
    table: () => Promise.resolve(null),
    signaler: (pid, signal) => void signaux.push([pid, signal]),
    moteur: (_bin, args) => {
      moteur.push([...args]);
      return Promise.resolve({ code: 0, sortie: '' });
    },
    maintenant: () => Date.now(),
    ...sur,
  };
  return { sondes, signaux, moteur };
}

describe('le pilote — là où il ne sait pas, et le conteneur', () => {
  it('WINDOWS hors conteneur : ni pause offerte, ni signal, ni mesure inventée', async () => {
    const b = sondesDeBanc({ plateforme: 'win32' });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    pilote.attacher({ pid: 4242, commande: 'claude -p' });
    expect(r.envois[0]).toMatchObject({ pausable: false, enPause: false });
    expect(await pilote.suspendre()).toBe(false);
    expect(b.signaux).toEqual([]);
    expect(pilote.enPause).toBe(false);
    expect(r.dernier('enPause')).toBe(false);
    // La table est illisible ici : la mesure dit « plus mesurable », pas zéro.
    await attendre(() => r.envois.some((e) => 'metriques' in e), 'aucun relevé tenté');
    expect(r.envois.find((e) => 'metriques' in e)?.metriques).toBeNull();
    pilote.fermer();
  });

  it('CONTENEUR : pause, mesure et reprise par le moteur — même sous Windows', async () => {
    const b = sondesDeBanc({
      plateforme: 'win32',
      moteur: (_bin, args) => {
        b.moteur.push([...args]);
        return Promise.resolve(
          args[0] === 'stats'
            ? { code: 0, sortie: '12.5%|200MiB / 8GiB|7\n' }
            : { code: 0, sortie: '' },
        );
      },
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    const conteneur = { bin: 'podman', nom: 'hive-t1-abcd', env: {} };
    pilote.attacher({ pid: 99, commande: 'podman run …', conteneur });
    expect(r.envois[0]).toMatchObject({ pausable: true });
    await attendre(() => r.envois.some((e) => e.metriques), 'aucune mesure du moteur');
    expect(r.envois.find((e) => e.metriques)!.metriques).toMatchObject({
      source: 'conteneur',
      cpuPct: 12.5,
      processus: 7,
    });
    expect(b.moteur[0]?.[0]).toBe('stats');
    expect(b.moteur[0]?.at(-1)).toBe('hive-t1-abcd');

    expect(await pilote.suspendre()).toBe(true);
    expect(b.moteur.at(-1)).toEqual(['pause', 'hive-t1-abcd']);
    expect(b.signaux, 'un conteneur ne se gèle pas par l’arbre de l’hôte').toEqual([]);
    expect(await pilote.reprendre()).toBe(true);
    expect(b.moteur.at(-1)).toEqual(['unpause', 'hive-t1-abcd']);
    expect(r.dernier('enPause')).toBe(false);
    pilote.fermer();
  });

  it('un moteur qui REFUSE la pause : l’exécution n’est pas dite en pause, l’horloge court', async () => {
    const b = sondesDeBanc({ moteur: () => Promise.resolve({ code: 125, sortie: '' }) });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    pilote.attacher({
      pid: 99,
      commande: 'docker run',
      conteneur: { bin: 'docker', nom: 'c', env: {} },
    });
    const delai = pilote.minuteur(60_000, () => undefined);
    expect(await pilote.suspendre()).toBe(false);
    expect(pilote.enPause).toBe(false);
    expect(r.dernier('enPause')).toBe(false);
    const avant = delai.restant();
    await dormir(30);
    expect(delai.restant(), 'l’horloge ne doit pas s’arrêter sans pause réelle').toBeLessThan(
      avant,
    );
    delai.annuler();
    pilote.fermer();
  });

  it('un agent SORTI en pause rend son horloge ; un délai armé en pause attend la reprise', async () => {
    const b = sondesDeBanc();
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    const detacher = pilote.attacher({ pid: 1234, commande: 'agent' });
    const budget = pilote.minuteur(60_000, () => undefined);
    expect(await pilote.suspendre()).toBe(true);
    expect(b.signaux[0]).toEqual([1234, 'SIGSTOP']);
    // Armé pendant la pause : il ne court pas.
    const tardif = pilote.minuteur(60_000, () => undefined);
    const figes = [budget.restant(), tardif.restant()];
    await dormir(30);
    expect([budget.restant(), tardif.restant()]).toEqual(figes);
    // L'agent sort (tué par un tiers) : la suite de la tâche retrouve son horloge.
    detacher();
    expect(pilote.enPause).toBe(false);
    await dormir(30);
    expect(budget.restant()).toBeLessThan(figes[0]!);
    expect(tardif.restant()).toBeLessThan(figes[1]!);
    budget.annuler();
    tardif.annuler();
    pilote.fermer();
  });
});

describe('le pilote — le BILAN que porte le résultat : l’agent, ou pourquoi rien', () => {
  const ID = 'c'.repeat(64);
  const DOSSIER = `/sys/fs/cgroup/system.slice/docker-${ID}.scope`;

  it('rien de lancé, Windows hors conteneur, aucun relevé : la RAISON, jamais un zéro', async () => {
    expect(
      new PiloteExecution(() => undefined, sondesDeBanc().sondes, 60_000).ressources(),
    ).toEqual({ portee: 'aucune', raison: 'aucun_processus' });

    const windows = new PiloteExecution(
      () => undefined,
      sondesDeBanc({ plateforme: 'win32' }).sondes,
      60_000,
    );
    windows.attacher({ pid: 4242, commande: 'claude -p' })();
    expect(windows.ressources()).toEqual({ portee: 'aucune', raison: 'plateforme' });

    // POSIX, mais la racine n'a jamais été vue (sortie avant le premier relevé).
    const r = recueil();
    const bref = new PiloteExecution(
      r.envoyer,
      sondesDeBanc({ table: async () => [] }).sondes,
      60_000,
    );
    const detacher = bref.attacher({ pid: 77, commande: 'agent' });
    await attendre(() => r.envois.some((e) => 'metriques' in e), 'aucun relevé tenté');
    detacher();
    expect(bref.ressources()).toEqual({ portee: 'aucune', raison: 'aucun_releve' });
    for (const p of [windows, bref]) p.fermer();
  });

  it('plusieurs processus attachés l’un après l’autre : leurs CPU s’ajoutent, le pic est le plus haut', async () => {
    let table: ProcessusVu[] = [];
    const r = recueil();
    const pilote = new PiloteExecution(
      r.envoyer,
      sondesDeBanc({ table: async () => table }).sondes,
      60_000,
    );
    const relevesFaits = () => r.envois.filter((e) => e.metriques).length;
    table = [{ pid: 1, ppid: 0, cpuMs: 200, cpuEnfantsMs: 100, rssOctets: 5_000 }];
    const premier = pilote.attacher({ pid: 1, commande: 'preparer' });
    await attendre(() => relevesFaits() === 1, 'premier relevé');
    premier();
    table = [{ pid: 2, ppid: 0, cpuMs: 50, cpuEnfantsMs: 0, rssOctets: 9_000 }];
    const second = pilote.attacher({ pid: 2, commande: 'agent' });
    await attendre(() => relevesFaits() === 2, 'second relevé');
    second();
    expect(pilote.ressources()).toEqual({
      portee: 'arbre',
      releves: 2,
      cpuMs: 350,
      picOctets: 9_000,
      memoire: 'somme_rss',
    });
    pilote.fermer();
  });

  it('CONTENEUR sans cgroup lisible : le pic du `stats` (échantillonné), et PAS de CPU inventé', async () => {
    const b = sondesDeBanc({
      plateforme: 'darwin',
      moteur: (_bin, args) =>
        Promise.resolve(
          args[0] === 'stats'
            ? { code: 0, sortie: '180.00%|1.5GiB / 8GiB|9\n' }
            : { code: 0, sortie: '' },
        ),
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    const detacher = pilote.attacher({
      pid: 99,
      commande: 'docker run',
      conteneur: { bin: 'docker', nom: 'hive-t-1', env: {} },
    });
    await attendre(() => r.envois.some((e) => e.metriques), 'aucune mesure du moteur');
    detacher();
    expect(pilote.ressources()).toEqual({
      portee: 'conteneur',
      releves: 1,
      picOctets: 1.5 * 1024 ** 3,
      memoire: 'moteur',
    });
    pilote.fermer();
  });

  it('CONTENEUR, Linux : le cgroup du conteneur — CPU de TOUT ce qui y a tourné, pic du noyau', async () => {
    const lus: string[] = [];
    const fichiers: Record<string, string> = {
      '/proc/4242/cgroup': `0::/system.slice/docker-${ID}.scope\n`,
      [`${DOSSIER}/cpu.stat`]: 'usage_usec 2500000\nuser_usec 2000000\nsystem_usec 500000\n',
      [`${DOSSIER}/memory.peak`]: `${700 * 1024 * 1024}\n`,
    };
    const b = sondesDeBanc({
      moteur: (_bin, args) => {
        b.moteur.push([...args]);
        if (args[0] === 'inspect') return Promise.resolve({ code: 0, sortie: `${ID} 4242\n` });
        return Promise.resolve({ code: 0, sortie: '50.00%|300MiB / 8GiB|4\n' });
      },
      lireFichier: (chemin) => {
        lus.push(chemin);
        const contenu = fichiers[chemin];
        return contenu === undefined
          ? Promise.reject(new Error(`ENOENT ${chemin}`))
          : Promise.resolve(contenu);
      },
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    const detacher = pilote.attacher({
      pid: 99,
      commande: 'docker run',
      conteneur: { bin: 'docker', nom: 'hive-t-2', env: {} },
    });
    await attendre(() => r.envois.some((e) => e.metriques), 'aucune mesure');
    detacher();
    expect(b.moteur).toContainEqual(['inspect', '--format', '{{.Id}} {{.State.Pid}}', 'hive-t-2']);
    expect(lus).toContain(`${DOSSIER}/cpu.stat`);
    // Le pic du noyau (700 Mio) l'emporte sur le relevé du moteur (300 Mio).
    expect(pilote.ressources()).toEqual({
      portee: 'conteneur',
      releves: 1,
      cpuMs: 2_500,
      picOctets: 700 * 1024 * 1024,
      memoire: 'noyau',
    });
    pilote.fermer();
  });

  it('un cgroup qui ne porte PAS l’identifiant du conteneur n’est pas lu — ni recherché à chaque relevé', async () => {
    let inspects = 0;
    const lus: string[] = [];
    const b = sondesDeBanc({
      moteur: (_bin, args) => {
        if (args[0] === 'inspect') {
          inspects += 1;
          return Promise.resolve({ code: 0, sortie: `${ID} 31\n` });
        }
        return Promise.resolve({ code: 0, sortie: '1.00%|64MiB / 8GiB|2\n' });
      },
      // Le pid 31 de la VM du moteur est, sur l'hôte, un processus quelconque.
      lireFichier: (chemin) => {
        lus.push(chemin);
        return Promise.resolve('0::/user.slice/user-1000.slice/session-2.scope\n');
      },
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 20);
    const detacher = pilote.attacher({
      pid: 99,
      commande: 'docker run',
      conteneur: { bin: 'docker', nom: 'hive-t-3', env: {} },
    });
    await attendre(() => r.envois.filter((e) => e.metriques).length >= 3, 'trois relevés');
    detacher();
    expect(inspects).toBe(1);
    expect(lus).toEqual(['/proc/31/cgroup']);
    const bilan = pilote.ressources();
    expect(bilan).toMatchObject({
      portee: 'conteneur',
      picOctets: 64 * 1024 * 1024,
      memoire: 'moteur',
    });
    expect(bilan).not.toHaveProperty('cpuMs');
    pilote.fermer();
  });

  it('un pid sans `/proc` ici (VM, moteur distant) : `inspect` une fois, jamais à chaque relevé', async () => {
    let inspects = 0;
    const b = sondesDeBanc({
      moteur: (_bin, args) => {
        if (args[0] === 'inspect') {
          inspects += 1;
          return Promise.resolve({ code: 0, sortie: `${ID} 77\n` });
        }
        return Promise.resolve({ code: 0, sortie: '1.00%|64MiB / 8GiB|2\n' });
      },
      lireFichier: (chemin) => Promise.reject(new Error(`ENOENT ${chemin}`)),
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 20);
    const detacher = pilote.attacher({
      pid: 99,
      commande: 'docker run',
      conteneur: { bin: 'docker', nom: 'hive-t-4', env: {} },
    });
    await attendre(() => r.envois.filter((e) => e.metriques).length >= 4, 'quatre relevés');
    detacher();
    expect(inspects, 'un `inspect` par relevé, sur un moteur qui n’est pas ici').toBe(1);
    pilote.fermer();
  });

  it('PODMAN : son `stats` porte le CPU CUMULÉ (`.CPUNano`) — gardé sans cgroup', async () => {
    const formats: string[] = [];
    const b = sondesDeBanc({
      plateforme: 'darwin',
      moteur: (_bin, args) => {
        formats.push(args[3] ?? '');
        return Promise.resolve({ code: 0, sortie: '50.00%|300MiB / 8GiB|4|1234567890\n' });
      },
    });
    const r = recueil();
    const pilote = new PiloteExecution(r.envoyer, b.sondes, 60_000);
    const detacher = pilote.attacher({
      pid: 99,
      commande: 'podman run',
      conteneur: { bin: 'podman', nom: 'hive-t-5', env: {} },
    });
    await attendre(() => r.envois.some((e) => e.metriques), 'aucune mesure');
    detacher();
    expect(formats[0]).toContain('{{.CPUNano}}');
    expect(pilote.ressources()).toEqual({
      portee: 'conteneur',
      releves: 1,
      cpuMs: 1_234,
      picOctets: 300 * 1024 * 1024,
      memoire: 'moteur',
    });
    pilote.fermer();
  });
});

describe.runIf(process.platform === 'linux')(
  'le pilote — la mémoire et le CPU VRAIS de l’arbre',
  () => {
    /** Rss et Pss, en octets, d'un processus vivant (`smaps_rollup`). */
    const memoireDe = (pid: number): { rss: number; pss: number } => {
      const t = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const kio = (cle: string) =>
        Number(new RegExp(`^${cle}:\\s+(\\d+) kB`, 'm').exec(t)![1]) * 1024;
      return { rss: kio('Rss'), pss: kio('Pss') };
    };

    it('un parent et trois enfants inactifs PARTAGEANT leurs pages : le Pss, pas la somme des RSS', async () => {
      dossier = mkdtempSync(path.join(os.tmpdir(), 'pilote-pss-'));
      const pids = path.join(dossier, 'pids');
      // La forme de Claude Code et de ses serveurs MCP : des `node` qui ne font rien.
      const racine = spawn(
        process.execPath,
        [
          '-e',
          "const { spawn } = require('node:child_process'); const e = [1, 2, 3].map(() => " +
            "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })); " +
            `require('node:fs').writeFileSync(${JSON.stringify(pids)}, [process.pid, ...e.map((x) => x.pid)].join(' ')); ` +
            'setInterval(() => {}, 1000);',
        ],
        { stdio: 'ignore', detached: true },
      );
      enfants.push(racine);
      await attendre(() => {
        try {
          return readFileSync(pids, 'utf8').split(' ').length === 4;
        } catch {
          return false;
        }
      }, 'les enfants ne démarrent pas');
      await dormir(300);
      const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 100);
      const detacher = pilote.attacher({ pid: racine.pid!, commande: 'node' });
      await attendre(() => {
        const r = pilote.ressources();
        return r.portee === 'arbre' && r.releves >= 3;
      }, 'aucun relevé de l’arbre');
      const vus = readFileSync(pids, 'utf8').split(' ').map(Number).map(memoireDe);
      const sommeRss = vus.reduce((t, m) => t + m.rss, 0);
      const sommePss = vus.reduce((t, m) => t + m.pss, 0);
      detacher();
      const bilan = pilote.ressources();
      expect(bilan).toMatchObject({ portee: 'arbre', memoire: 'pss' });
      if (bilan.portee !== 'arbre') return;
      // L'ancien calcul rendait la somme des RSS (~3 fois le Pss pour des `node`).
      expect(bilan.picOctets, `Pss ${sommePss}, somme des RSS ${sommeRss}`).toBeLessThan(
        sommeRss * 0.6,
      );
      expect(bilan.picOctets).toBeGreaterThan(sommePss * 0.5);
      pilote.fermer();
    });

    it('un ZOMBIE dans l’arbre (un parent qui ne moissonne pas) est SORTI — le Pss tient', async () => {
      // `sleep 0.2 &` puis `exec sleep 30` : le `sh` devient `sleep`, qui ne
      // moissonne jamais — son enfant mort reste zombie tant qu'il vit. Son
      // `smaps_rollup` répond ESRCH : le prendre pour « Pss illisible » faisait
      // tomber CHAQUE relevé, et le pic, à la somme des RSS.
      const racine = spawn('sh', ['-c', 'sleep 0.2 & exec sleep 30'], {
        stdio: 'ignore',
        detached: true,
      });
      enfants.push(racine);
      const zombie = (): boolean =>
        readdirSync('/proc')
          .filter((e) => /^\d+$/.test(e))
          .some((e) => {
            try {
              const t = readFileSync(`/proc/${e}/stat`, 'utf8');
              const champs = t
                .slice(t.lastIndexOf(')') + 1)
                .trim()
                .split(/\s+/);
              return champs[0] === 'Z' && Number(champs[1]) === racine.pid;
            } catch {
              return false;
            }
          });
      await attendre(zombie, 'l’enfant de `sleep` n’est jamais zombie');
      const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 50);
      const detacher = pilote.attacher({ pid: racine.pid!, commande: 'sleep 30' });
      await attendre(() => {
        const r = pilote.ressources();
        return r.portee === 'arbre' && r.releves >= 3;
      }, 'aucun relevé de l’arbre');
      expect(zombie(), 'le zombie doit avoir été là à chaque relevé').toBe(true);
      detacher();
      expect(pilote.ressources()).toMatchObject({ portee: 'arbre', memoire: 'pss' });
      pilote.fermer();
    });

    it('un ÉCHAPPÉ double-forké (`cmd &` d’un `sh` mort) est mesuré — et jamais SUR-estimé', async () => {
      dossier = mkdtempSync(path.join(os.tmpdir(), 'pilote-echappe-'));
      const signal = path.join(dossier, 'fin');
      const cpuRacine = path.join(dossier, 'cpu-racine');
      const cpuEchappe = path.join(dossier, 'cpu-echappe');
      const brule = path.join(dossier, 'brule.js');
      // Chacun écrit son CPU TOTAL à la fin : la borne haute de ce qu'on mesure.
      const finir = (sortie: string) =>
        `const fin = () => { const u = process.cpuUsage(); require('node:fs').writeFileSync(` +
        `${JSON.stringify(sortie)}, String((u.user + u.system) / 1000)); process.exit(0); }; ` +
        `setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(signal)})) fin(); }, 50);`;
      writeFileSync(
        brule,
        'const d = process.cpuUsage(); const ms = () => { const u = process.cpuUsage(d); ' +
          'return (u.user + u.system) / 1000; }; while (ms() < 300) {}\n' +
          finir(cpuEchappe),
      );
      const racine = spawn(
        process.execPath,
        [
          '-e',
          // `sh` lance le brûleur en arrière-plan et meurt : reparenté à init,
          // l'échappé quitte l'arbre des parents — pas la session.
          `require('node:child_process').spawn('sh', ['-c', ${JSON.stringify(`"${process.execPath}" "${brule}" &`)}], { stdio: 'ignore' }); ` +
            finir(cpuRacine),
        ],
        { stdio: 'ignore', detached: true },
      );
      enfants.push(racine);
      const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 100);
      const detacher = pilote.attacher({ pid: racine.pid!, commande: 'node' });
      await attendre(
        () => {
          const r = pilote.ressources();
          return r.portee === 'arbre' && (r.cpuMs ?? 0) >= 280;
        },
        'le CPU de l’échappé n’est jamais compté',
        15_000,
      );
      writeFileSync(signal, '');
      await attendre(
        () =>
          [cpuRacine, cpuEchappe].every((f) => {
            try {
              return readFileSync(f, 'utf8').length > 0;
            } catch {
              return false;
            }
          }),
        'les deux ne finissent pas',
      );
      detacher();
      const bilan = pilote.ressources();
      if (bilan.portee !== 'arbre') throw new Error(JSON.stringify(bilan));
      const vrai =
        Number(readFileSync(cpuRacine, 'utf8')) + Number(readFileSync(cpuEchappe, 'utf8'));
      expect(bilan.cpuMs).toBeGreaterThanOrEqual(280);
      // Jamais plus que le vrai : la racine, l'échappé, et le `sh` éphémère.
      expect(bilan.cpuMs, `vrai ${vrai} ms`).toBeLessThanOrEqual(vrai + 50);
      pilote.fermer();
    }, 30_000);
  },
);
