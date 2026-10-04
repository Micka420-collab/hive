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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
import type { EtatDirect } from '../src/shared/bac-direct.js';
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
    const battement = (qui: string) =>
      `let n = 0; setInterval(() => require('node:fs').writeFileSync(` +
      `${JSON.stringify(path.join(dossier, `hb-${qui}`))}, String(++n)), 20);\n`;
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
    expect(m.rssOctets).toBeGreaterThan(1024 * 1024);
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
