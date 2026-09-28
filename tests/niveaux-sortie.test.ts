// LE NIVEAU DE CHAQUE LIGNE DE LA SORTIE EN DIRECT — lu à la source, au nœud.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Le morceau de sortie mêlait stdout et stderr dans un seul texte : à l'écran,
// un filtre « erreurs » n'aurait eu que le TEXTE pour juger. Ici, on vérifie
// que le niveau vient d'un vrai signal, à chaque étage :
//
//   · le flux du processus (`sortie-directe.ts`, puis `exec.ts` sur un VRAI
//     processus qui écrit sur ses deux flux) ;
//   · la gravité que le flux STRUCTURÉ de l'agent déclare : les événements de
//     Codex `--json` (enregistrés sur le vrai binaire) et du stream-json de
//     Claude Code (enregistré contre un faux serveur rendant un 400) ;
//   · le fil : des niveaux qui ne tombent pas juste sur les lignes du texte
//     font tomber le message — ils décaleraient sinon tous les niveaux.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand, runCommandStreaming } from '../src/adapters/exec.js';
import type { AdapterProgress } from '../src/adapters/index.js';
import { createLecteurFluxCodex } from '../src/adapters/flux-codex.js';
import { createSortieDirecte, type HorlogeSortie } from '../src/adapters/sortie-directe.js';
import { graviteStreamJson } from '../src/adapters/texte-final.js';
import {
  compterLignes,
  niveauxValides,
  type BlocSortie,
  type NiveauSortie,
} from '../src/shared/niveaux-sortie.js';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const fixture = (...p: string[]): string[] =>
  readFileSync(path.join(FIXTURES, ...p), 'utf8')
    .split('\n')
    .filter(Boolean);

/** Horloge immobile : un départ ne part qu'à `terminer()`, en un seul morceau. */
const horlogeFigee: HorlogeSortie = { maintenant: () => 0, planifier: () => () => {} };

/** Chaque ligne d'une suite de blocs, avec son niveau. */
const lignesDe = (blocs: readonly BlocSortie[]): Array<[NiveauSortie, string]> =>
  blocs.flatMap((b) =>
    b.texte
      .replace(/\n$/, '')
      .split('\n')
      .map((l): [NiveauSortie, string] => [b.niveau, l]),
  );

describe('le fil — des niveaux qui tombent juste, ou rien', () => {
  it('compte les lignes comme l’écran les découpe', () => {
    expect(compterLignes('')).toBe(0);
    expect(compterLignes('a\n')).toBe(1);
    expect(compterLignes('a\nb')).toBe(2);
    expect(compterLignes('a\n\nb\n')).toBe(3);
  });

  it('refuse un décompte faux, un niveau inconnu, un segment vide', () => {
    expect(
      niveauxValides(
        [
          ['stdout', 2],
          ['stderr', 1],
        ],
        'a\nb\nc\n',
      ),
    ).toBe(true);
    expect(niveauxValides([['stdout', 2]], 'a\nb\nc\n')).toBe(false);
    expect(niveauxValides([['stdout', 4]], 'a\nb\nc\n')).toBe(false);
    expect(niveauxValides([['debug', 3]], 'a\nb\nc\n')).toBe(false);
    expect(
      niveauxValides(
        [
          ['stdout', 0],
          ['stderr', 3],
        ],
        'a\nb\nc\n',
      ),
    ).toBe(false);
    expect(niveauxValides([], 'a\n')).toBe(false);
  });

  it('task_update et task_output : des niveaux faux font tomber le message', () => {
    const maj = { type: 'task_update', taskId: 'tache-1', status: 'running', sortie: 'a\nb\n' };
    expect(
      parseClientMessage(
        JSON.stringify({
          ...maj,
          niveaux: [
            ['stdout', 1],
            ['stderr', 1],
          ],
        }),
      ),
    ).toMatchObject({
      niveaux: [
        ['stdout', 1],
        ['stderr', 1],
      ],
    });
    expect(parseClientMessage(JSON.stringify({ ...maj, niveaux: [['stdout', 1]] }))).toBeNull();
    // Des niveaux sans texte ne décrivent rien.
    expect(
      parseClientMessage(
        JSON.stringify({ type: 'task_update', taskId: 'tache-1', status: 'running', niveaux: [] }),
      ),
    ).toBeNull();

    const sortie = { type: 'task_output', taskId: 'tache-1', nodeId: 'noeud-1', sortie: 'a\n' };
    expect(parseServerMessage(JSON.stringify({ ...sortie, niveaux: [['erreur', 1]] }))).toEqual({
      ...sortie,
      niveaux: [['erreur', 1]],
    });
    expect(parseServerMessage(JSON.stringify({ ...sortie, niveaux: [['erreur', 2]] }))).toBeNull();
    // Un nœud d'avant ce contrat : pas de niveaux, et le morceau passe.
    expect(parseServerMessage(JSON.stringify(sortie))).toEqual(sortie);
  });
});

describe('createSortieDirecte — chaque ligne garde son flux', () => {
  it('stdout, stderr et gravité déclarée : un bloc par série, dans l’ordre', () => {
    const departs: BlocSortie[][] = [];
    const sortie = createSortieDirecte((_t, blocs) => departs.push(blocs), horlogeFigee);
    sortie.ecrire('lecture\nécriture\n');
    // Un fragment de stderr au milieu d'une ligne de stdout ne s'y colle pas.
    sortie.ecrire('début de ');
    sortie.ecrire('npm WARN deprecated\n', 'stderr');
    sortie.ecrire('ligne\n');
    sortie.ecrire('┊ erreur signalée : 401\n', 'stdout', 'erreur');
    sortie.terminer();

    expect(departs).toHaveLength(1);
    expect(lignesDe(departs[0]!)).toEqual([
      ['stdout', 'lecture'],
      ['stdout', 'écriture'],
      ['stderr', 'npm WARN deprecated'],
      ['stdout', 'début de ligne'],
      ['erreur', '┊ erreur signalée : 401'],
    ]);
  });

  it('l’annonce d’une omission est une ligne de HIVE, pas de l’agent', () => {
    const departs: BlocSortie[][] = [];
    const sortie = createSortieDirecte((_t, blocs) => departs.push(blocs), horlogeFigee);
    for (let i = 0; i < 200; i += 1) sortie.ecrire(`${'x'.repeat(60)}\n`, 'stderr');
    sortie.terminer();
    const [premiere, ...suite] = lignesDe(departs[0]!);
    expect(premiere?.[0]).toBe('hive');
    expect(premiere?.[1]).toMatch(/^\[… \d+ octets omis\]$/);
    expect(suite.every(([n]) => n === 'stderr')).toBe(true);
  });
});

describe('la gravité que l’agent déclare — ses événements, jamais son texte', () => {
  it('stream-json de Claude Code : le message d’erreur d’API et le `result` à `is_error`', () => {
    const lignes = fixture('texte-final', 'claude-echec-api-400.stream.jsonl');
    const graves = lignes.map((l) => [JSON.parse(l).type, graviteStreamJson(l)]);
    // init, outil, résultat d'outil : rien ; le message à `error` et le
    // résultat à `is_error` : des erreurs.
    expect(graves).toEqual([
      ['system', undefined],
      ['assistant', undefined],
      ['user', undefined],
      ['assistant', 'erreur'],
      ['result', 'erreur'],
    ]);
    // Une requête que Claude Code va REFAIRE avertit (`SDKAPIRetryMessage`).
    const retry = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      max_retries: 10,
      retry_delay_ms: 500,
      error_status: 529,
      error: 'overloaded',
    });
    expect(graviteStreamJson(retry)).toBe('avertissement');
    // Un outil en échec n'est pas une erreur de l'agent, ni un texte qui en parle.
    const outil = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: 'error: x' }] },
    });
    expect(graviteStreamJson(outil)).toBeUndefined();
    const parle = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'the "error" is fixed' }] },
    });
    expect(graviteStreamJson(parle)).toBeUndefined();
  });

  it('Codex `--json` : erreur signalée, avertissement non fatal, tentative refaite', () => {
    const lecteur = createLecteurFluxCodex();
    const graves = fixture('flux-codex', 'echec-401.json.stdout.jsonl')
      .map((l) => lecteur.lire(l))
      .filter((r) => r !== undefined)
      .map((r) => r.gravite);
    // L'élément `error` (métadonnées du modèle) avertit ; l'`error` du 401
    // est une erreur ; raisonnement, message, commande : rien.
    expect(graves).toEqual(['avertissement', undefined, undefined, undefined, undefined, 'erreur']);
    const refaite = createLecteurFluxCodex().lire(
      JSON.stringify({ type: 'error', message: 'Reconnecting... 2/5 (unexpected status 429)' }),
    );
    expect(refaite?.gravite).toBe('avertissement');
  });

  it('Codex `turn.failed` sans `error` avant lui : la seule erreur du tour, dite en direct', () => {
    // Codex tire la raison de `turn.error` avant la dernière erreur vue
    // (event_processor_with_jsonl_output.rs) : un tour échoue sans `error`.
    const echec = JSON.stringify({ type: 'turn.failed', error: { message: 'quota épuisé' } });
    const seul = createLecteurFluxCodex().lire(echec);
    expect(seul?.gravite).toBe('erreur');
    expect(seul?.texte).toContain('quota épuisé');
    // Déjà dite par un `error` au même message : pas de doublon.
    const lecteur = createLecteurFluxCodex();
    lecteur.lire(JSON.stringify({ type: 'error', message: 'quota épuisé' }));
    expect(lecteur.lire(echec)).toBeUndefined();
  });
});

describe('exec — un vrai processus, ses deux flux, ses événements', () => {
  const aNettoyer: string[] = [];
  afterEach(() => {
    for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const lancer = async (
    source: string,
    via: 'texte' | 'stream-json',
  ): Promise<Array<[NiveauSortie, string]>> => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'hive-niveaux-'));
    aNettoyer.push(dossier);
    const script = path.join(dossier, 'agent.js');
    writeFileSync(script, source);
    const vus: BlocSortie[] = [];
    const ctx = {
      cwd: dossier,
      env: { ...process.env },
      attempt: 1,
      signal: new AbortController().signal,
      onProgress: (p: AdapterProgress) => vus.push(...(p.sortie ?? [])),
    };
    const r =
      via === 'texte'
        ? await runCommand(process.execPath, [script], ctx, 10_000)
        : await runCommandStreaming(
            process.execPath,
            [script],
            ctx,
            (l) => graviteStreamJson(l),
            10_000,
          );
    expect(r.logs).not.toContain('[hive] échec du lancement');
    return lignesDe(vus);
  };

  it('stderr reste stderr jusqu’au morceau qui part au nœud', async () => {
    const lignes = await lancer(
      "process.stdout.write('compilation\\n');\n" +
        // Deux tubes, deux événements : arrivée dans le même intervalle de
        // cadence que stdout, la ligne de stderr attendait le suivant, et la
        // fin du processus la taisait (voulu : `SortieDirecte.terminer`) —
        // le banc échouait sous charge. Écrite au-delà de l'intervalle.
        "setTimeout(() => process.stderr.write('warning: x est inutilisé\\n'), 400);\n",
      'texte',
    );
    expect(lignes).toContainEqual(['stdout', 'compilation']);
    expect(lignes).toContainEqual(['stderr', 'warning: x est inutilisé']);
  });

  it('une ligne de stream-json qui DÉCLARE une erreur part au niveau « erreur »', async () => {
    const [, , , erreur, resultat] = fixture('texte-final', 'claude-echec-api-400.stream.jsonl');
    const lignes = await lancer(
      `process.stdout.write(${JSON.stringify(`{"type":"system","subtype":"init"}\n${erreur}\n`)});\n` +
        // La DERNIÈRE ligne, sans retour final : elle partait après la fin
        // de la sortie en direct, et l'écran ne la voyait jamais. Écrite
        // au-delà d'un intervalle de cadence : sinon c'est la cadence, à
        // raison, qui la tairait.
        `setTimeout(() => process.stdout.write(${JSON.stringify(resultat)}), 400);\n`,
      'stream-json',
    );
    expect(lignes.map(([n]) => n)).toEqual(['stdout', 'erreur', 'erreur']);
  });
});
