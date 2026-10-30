// LA VIGIE NE JUGE PAS UN AGENT EN PAUSE — le temps qu'elle mesure est celui
// que le run a COURU (train 9 : G13 × #562, sur la pause de Sandbox Live).
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Une seule règle de la vigie (G13) se mesure en DURÉE : l'attente du réseau
// SANS borne de Codex (« Reconnecting... waiting for network »), arrêtée en
// vol au-delà d'`ATTENTE_RESEAU_MAX_MS` — dix minutes, les deux tiers du délai
// dur. Elle courait en temps MUR, alors que ce délai dur est une horloge du
// run qu'une pause SUSPEND (#526), mesurée en temps monotone (#562). Après une
// pause plus longue que ce qui restait, Codex repris était arrêté « fournisseur
// injoignable » à son avis suivant, au bout de quelques secondes d'attente
// réelle — la tentative réaffectée, ce qu'elle avait écrit perdu. Une veille,
// une VM reprise ou un pas de NTP faisaient de même, sans pause.
//
//   · une pause de onze minutes au milieu d'une attente : Codex repris n'est
//     pas arrêté — il conclut ;
//   · un saut du temps mur, sans pause : rien n'a couru, rien n'est arrêté ;
//   · les mêmes onze minutes COURUES : arrêté en vol, comme avant — la règle
//     tient ;
//   · l'horloge elle-même (`PiloteExecution.tempsCouru`) : monotone, figée en
//     pause, et la pause se referme quel que soit son geste de fin (reprise,
//     arrêt, sortie de l'agent).
//
// Le vrai adaptateur Codex, son vrai lecteur de flux et sa vigie, le vrai
// pilote qui gèle l'arbre (SIGSTOP) ; seul le CLI est faux, et il écrit ce
// que codex-cli 0.156.0 a écrit (tests/fixtures/enlisement/
// codex-injoignable.json.stdout.jsonl). Le temps est simulé en déplaçant ce
// qu'on LIT des horloges, jamais les minuteurs réels.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodexAdapter } from '../src/adapters/codex.js';
import type { AdapterContext } from '../src/adapters/index.js';
import { ATTENTE_RESEAU_MAX_MS } from '../src/adapters/vigie-enlisement.js';
import { PiloteExecution, SONDES_REELLES } from '../src/node-client/pilote-execution.js';
import type { SondesPilote } from '../src/node-client/pilote-execution.js';
import type { ArretVigie } from '../src/shared/enlisement.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-de-ruche-suffisamment-long';
/** L'avis que codex-cli 0.156.0 répète tant qu'il attend le réseau, sans borne (enregistré). */
const AVIS =
  '{"type":"error","message":"Reconnecting... waiting for network (Connection failed: error sending request)"}';
/** Au-delà de la borne de la vigie : en temps mur, l'avis suivant arrêtait Codex. */
const ONZE_MINUTES = ATTENTE_RESEAU_MAX_MS + 60_000;
/** L'heure monotone VRAIE, prise avant tout banc : les attentes s'y bornent. */
const monotoneReel = performance.now.bind(performance);

const dossiers: string[] = [];
const pilotes: PiloteExecution[] = [];

afterEach(() => {
  for (const p of pilotes.splice(0)) p.fermer();
  vi.restoreAllMocks();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * Les deux horloges du processus, déplaçables : le temps MUR (`Date.now`) et
 * le temps MONOTONE (`performance.now`), celui où tirent les minuteurs. Le
 * temps qui passe vraiment les avance ensemble (`ecouler`) ; une veille, une
 * VM reprise ou un pas de NTP ne déplacent que le mur (`sauterMur`).
 */
function horloges(): { ecouler(ms: number): void; sauterMur(ms: number): void } {
  const mur = Date.now.bind(Date);
  let decalageMur = 0;
  let decalageMonotone = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => mur() + decalageMur);
  vi.spyOn(performance, 'now').mockImplementation(() => monotoneReel() + decalageMonotone);
  return {
    ecouler: (ms) => {
      decalageMur += ms;
      decalageMonotone += ms;
    },
    sauterMur: (ms) => {
      decalageMur += ms;
    },
  };
}

/** Attente bornée sur l'heure monotone VRAIE : celle du processus saute pendant le banc. */
async function attendre<T>(lire: () => T | undefined, message: string, delai = 10_000): Promise<T> {
  const fin = monotoneReel() + delai;
  while (monotoneReel() < fin) {
    const vu = lire();
    if (vu !== undefined) return vu;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(message);
}

const tache = (): Task => ({
  id: 'tache-vigie-pause',
  projectId: 'p',
  title: 'Attendre le réseau',
  prompt: 'Corrige le test qui échoue.',
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'n',
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
});

/**
 * Un faux `codex` sur le PATH : il ouvre son tour, écrit un premier avis
 * d'attente du réseau, puis attend que le banc pose `go` — gelé, il ne le voit
 * pas — pour écrire le second avis, la réponse et la fin du tour.
 */
function codexQuiAttendLeReseau(pilote: PiloteExecution): {
  ctx: AdapterContext;
  arrets: ArretVigie[];
  avisLus: () => number;
  go: () => void;
} {
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-vigie-pause-'));
  dossiers.push(dossier);
  const bin = path.join(dossier, 'codex');
  writeFileSync(
    bin,
    [
      '#!/usr/bin/env node',
      "'use strict';",
      // La sonde du bac de Codex (`codex sandbox … -- true`) : un hôte où il démarre.
      "if (process.argv[2] === 'sandbox') process.exit(0);",
      "const fs = require('node:fs');",
      "const ecrire = (l) => process.stdout.write(l + '\\n');",
      'ecrire(\'{"type":"thread.started","thread_id":"01a00000-0000-7000-8000-000000000001"}\');',
      'ecrire(\'{"type":"turn.started"}\');',
      `ecrire(${JSON.stringify(AVIS)});`,
      'const t = setInterval(() => {',
      `  if (!fs.existsSync(${JSON.stringify(path.join(dossier, 'go'))})) return;`,
      '  clearInterval(t);',
      `  ecrire(${JSON.stringify(AVIS)});`,
      '  ecrire(\'{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"fait"}}\');',
      '  ecrire(\'{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}\');',
      '  process.exitCode = 0;',
      '}, 20);',
    ].join('\n'),
  );
  chmodSync(bin, 0o755);
  const arrets: ArretVigie[] = [];
  let sortie = '';
  const ctx: AdapterContext = {
    cwd: dossier,
    env: { PATH: `${dossier}${path.delimiter}${process.env.PATH ?? ''}` },
    attempt: 1,
    signal: new AbortController().signal,
    pilote,
    onProgress: (p) => {
      if (p.arret) arrets.push(p.arret);
      for (const bloc of p.sortie ?? []) sortie += bloc.texte;
    },
  };
  return {
    ctx,
    arrets,
    avisLus: () => sortie.split('waiting for network').length - 1,
    go: () => writeFileSync(path.join(dossier, 'go'), ''),
  };
}

describe.skipIf(process.platform === 'win32')(
  'la vigie de Codex, sous le vrai pilote : elle mesure le temps COURU',
  () => {
    it(
      'UNE PAUSE de onze minutes au milieu d’une attente du réseau : repris, Codex n’est pas arrêté — il conclut',
      { timeout: 20_000 },
      async () => {
        const h = horloges();
        const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 60_000);
        pilotes.push(pilote);
        const codex = codexQuiAttendLeReseau(pilote);
        const fin = createCodexAdapter(TOKEN).run(tache(), codex.ctx);
        await attendre(() => (codex.avisLus() >= 1 ? true : undefined), 'aucun avis lu');
        expect(await pilote.suspendre()).toBe(true);
        h.ecouler(ONZE_MINUTES);
        expect(await pilote.reprendre()).toBe(true);
        codex.go();
        const r = await fin;
        expect(codex.avisLus(), 'le second avis doit avoir été lu, après la reprise').toBe(2);
        expect(codex.arrets, 'la pause a été comptée comme une attente du réseau').toEqual([]);
        expect(r.success, r.logs).toBe(true);
      },
    );

    it(
      'un SAUT du temps mur (veille, VM reprise, pas de NTP), sans pause : rien n’a couru, rien n’est arrêté',
      { timeout: 20_000 },
      async () => {
        const h = horloges();
        const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 60_000);
        pilotes.push(pilote);
        const codex = codexQuiAttendLeReseau(pilote);
        const fin = createCodexAdapter(TOKEN).run(tache(), codex.ctx);
        await attendre(() => (codex.avisLus() >= 1 ? true : undefined), 'aucun avis lu');
        h.sauterMur(ONZE_MINUTES);
        codex.go();
        const r = await fin;
        expect(codex.avisLus()).toBe(2);
        expect(codex.arrets, 'un saut du mur a été compté comme une attente').toEqual([]);
        expect(r.success, r.logs).toBe(true);
      },
    );

    it(
      'les mêmes onze minutes COURUES, sans pause : arrêté en vol, fournisseur injoignable — la règle tient',
      { timeout: 20_000 },
      async () => {
        const h = horloges();
        const pilote = new PiloteExecution(() => undefined, SONDES_REELLES, 60_000);
        pilotes.push(pilote);
        const codex = codexQuiAttendLeReseau(pilote);
        const fin = createCodexAdapter(TOKEN).run(tache(), codex.ctx);
        await attendre(() => (codex.avisLus() >= 1 ? true : undefined), 'aucun avis lu');
        h.ecouler(ONZE_MINUTES);
        codex.go();
        await fin;
        expect(codex.arrets).toEqual([{ issue: 'epuisement_fournisseur', cause: 'injoignable' }]);
      },
    );
  },
);

describe('le temps COURU du run (`tempsCouru`) : l’horloge de la vigie', () => {
  /** Des sondes de banc : rien ne touche la machine. */
  const sondes: SondesPilote = {
    plateforme: 'linux',
    table: () => Promise.resolve(null),
    signaler: () => undefined,
    moteur: () => Promise.resolve({ code: 0, sortie: '' }),
    maintenant: () => Date.now(),
  };
  /** Ce qui a couru depuis `depuis`, à la seconde près : le vrai temps passe aussi. */
  const couru = (pilote: PiloteExecution, depuis: number): number =>
    Math.round((pilote.tempsCouru() - depuis) / 1_000) * 1_000;

  it('monotone, figé en pause ; la pause se referme à la reprise, à l’arrêt, à la sortie de l’agent', async () => {
    const h = horloges();
    const pilote = new PiloteExecution(() => undefined, sondes, 60_000);
    pilotes.push(pilote);
    const t0 = pilote.tempsCouru();
    h.ecouler(5_000);
    expect(couru(pilote, t0)).toBe(5_000);
    h.sauterMur(ONZE_MINUTES);
    expect(couru(pilote, t0), 'un saut du mur n’est pas du temps couru').toBe(5_000);

    // Reprise.
    let detacher = pilote.attacher({ pid: 4242, commande: 'agent' });
    expect(await pilote.suspendre()).toBe(true);
    const fige = pilote.tempsCouru();
    h.ecouler(ONZE_MINUTES);
    expect(pilote.tempsCouru(), 'la pause ne court pas').toBe(fige);
    expect(await pilote.reprendre()).toBe(true);
    h.ecouler(2_000);
    expect(couru(pilote, t0)).toBe(7_000);

    // L'agent sort pendant sa pause (tué par un tiers) : elle est close.
    expect(await pilote.suspendre()).toBe(true);
    h.ecouler(ONZE_MINUTES);
    detacher();
    h.ecouler(3_000);
    expect(couru(pilote, t0)).toBe(10_000);

    // L'exécution est arrêtée pendant la pause (annulation, vigie) : close aussi.
    detacher = pilote.attacher({ pid: 4243, commande: 'agent' });
    expect(await pilote.suspendre()).toBe(true);
    h.ecouler(ONZE_MINUTES);
    await pilote.arreter();
    h.ecouler(4_000);
    expect(couru(pilote, t0)).toBe(14_000);
    detacher();
  });
});
