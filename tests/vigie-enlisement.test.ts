// G13 — LA VIGIE : un agent qui tourne en rond, un fournisseur qui ne sert plus.
//
// ─── D'OÙ VIENNENT LES FIXTURES (tests/fixtures/enlisement) ──────────────────
//
// ENREGISTRÉES sur les vrais binaires branchés sur un faux fournisseur local
// (aucun crédit dépensé), assainies comme `tests/fixtures/budget` : chemin de
// travail, identifiants de session, ligne `init` réduite ; le reste intact.
//
//   · `claude-429` : Claude Code 2.1.289 (`claude -p --output-format
//     stream-json --verbose`, clé d'API), chaque requête en 429
//     `rate_limit_error` : dix `api_retry` (`max_retries: 10`, `error:
//     "rate_limit"`), puis l'erreur finale (`api_error_status: 429`) — 183 s ;
//   · `claude-529` : idem en 529 `overloaded_error` — 217 s, et l'erreur finale
//     « API Error: 529 Overloaded… » que `INFRA_FAILURE_RE` ne reconnaît pas :
//     un échec du MODÈLE avant la vigie ;
//   · `claude-529-watchdog` : idem sous `CLAUDE_CODE_RETRY_WATCHDOG=1` —
//     `max_retries: 300` —, coupé par `timeout` : le CLI attendait encore ;
//   · `codex-usage`, `codex-429`, `codex-503`, `codex-500` : codex-cli 0.156.0
//     (`model_providers`, HTTPS), le fournisseur rendant un 429
//     `usage_limit_reached`, un 429 ordinaire, un 503 `server_is_overloaded`,
//     un 500 (cinq « Reconnecting... n/5 » avant l'échec) ;
//   · `codex-injoignable` : codex-cli 0.156.0 sur un port fermé —
//     « Reconnecting... waiting for network » sans fin, coupé par `timeout`.
//
// CONSTRUITE d'après le contrat, faute de compte claude.ai sur la machine
// d'enregistrement — suivi nommé « preuve réelle » :
//
//   · `claude-limite-abonnement.contrat` : la ligne `init` et le résultat
//     d'erreur de `claude-429`, le message « You've hit your session limit ·
//     resets 3:45pm » (code.claude.com/docs/en/errors), et un
//     `rate_limit_event` à la forme de `SDKRateLimitEvent` (SDK 0.3.289) :
//     `status: rejected`, `rateLimitType: five_hour`, `resetsAt` en SECONDES.
//
// Les boucles d'outils de Claude Code reprennent, ligne pour ligne, la forme
// des `tool_use` / `tool_result` ENREGISTRÉS (tests/fixtures/texte-final/
// claude-echec-api-400.stream.jsonl) ; celles de Codex, la forme de ses
// `command_execution` et `file_change` (tests/fixtures/flux-codex).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLecteurFluxCodex } from '../src/adapters/flux-codex.js';
import {
  createVigie,
  ERREURS_ENLISEMENT,
  evenementsClaude,
  evenementsCodex,
  OSCILLATION_ENLISEMENT,
  RELANCES_BORNEES_CLAUDE,
  RELANCES_BORNEES_CODEX,
  REPETITIONS_ENLISEMENT,
  resultatSelonVigie,
  type EvenementVigie,
} from '../src/adapters/vigie-enlisement.js';
import { direArret, type ArretVigie } from '../src/shared/enlisement.js';
import { parseClientMessage } from '../src/shared/protocol.js';

const fixture = (dossier: string, nom: string): string[] =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', dossier, nom), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

/** Ce que la vigie rend sur un flux, et à quelle ligne, et sur quel genre d'événement. */
function suivre(
  lignes: readonly string[],
  lire: (ligne: string) => EvenementVigie[],
  borne: number,
): { arret: ArretVigie; ligne: number; genre: EvenementVigie['genre'] } | undefined {
  const vigie = createVigie(borne);
  for (const [i, ligne] of lignes.entries()) {
    for (const e of lire(ligne)) {
      const arret = vigie.observer(e);
      if (arret) return { arret, ligne: i, genre: e.genre };
    }
  }
  return undefined;
}
const claude = (lignes: readonly string[]) =>
  suivre(lignes, evenementsClaude, RELANCES_BORNEES_CLAUDE);
const codex = (lignes: readonly string[]) =>
  suivre(
    lignes,
    (l) => evenementsCodex(JSON.parse(l) as Record<string, unknown>),
    RELANCES_BORNEES_CODEX,
  );

// ─── Une boucle d'outils de Claude Code, à la forme enregistrée ─────────────

const [, APPEL_REEL, RETOUR_REEL] = fixture('texte-final', 'claude-echec-api-400.stream.jsonl');
let suivant = 0;

/** Un `tool_use` puis son `tool_result`, à la forme enregistrée sur 2.1.289. */
function outil(
  nom: string,
  input: Record<string, unknown>,
  retour: string,
  opts: { erreur?: boolean; agent?: string } = {},
): string[] {
  suivant += 1;
  const id = `toolu_banc_${suivant}`;
  const appel = JSON.parse(APPEL_REEL!) as Record<string, any>;
  appel.message.content = [{ type: 'tool_use', id, name: nom, input }];
  appel.parent_tool_use_id = opts.agent ?? null;
  const resultat = JSON.parse(RETOUR_REEL!) as Record<string, any>;
  resultat.message.content = [
    {
      tool_use_id: id,
      type: 'tool_result',
      content: retour,
      ...(opts.erreur ? { is_error: true } : {}),
    },
  ];
  resultat.parent_tool_use_id = opts.agent ?? null;
  return [JSON.stringify(appel), JSON.stringify(resultat)];
}
const fois = (n: number, f: (i: number) => string[]): string[] =>
  Array.from({ length: n }, (_, i) => f(i)).flat();

describe('la vigie — un agent qui tourne en rond (règles portées d’OpenHands)', () => {
  it('les seuils sont ceux du StuckDetector d’OpenHands, et ceux de chaque CLI par défaut', () => {
    // `StuckDetectionThresholds` : action_observation 4, action_error 3 (> 3),
    // alternating_pattern 6. `CLAUDE_CODE_MAX_RETRIES` 10, `DEFAULT_STREAM_MAX_RETRIES` 5.
    expect([REPETITIONS_ENLISEMENT, ERREURS_ENLISEMENT, OSCILLATION_ENLISEMENT]).toEqual([4, 4, 6]);
    expect([RELANCES_BORNEES_CLAUDE, RELANCES_BORNEES_CODEX]).toEqual([10, 5]);
  });

  it('MÊME APPEL, MÊME RÉSULTAT : arrêté au 4e — jamais au 3e', () => {
    const lire = (n: number) =>
      claude(
        fois(n, () =>
          outil('Read', { file_path: '/travail/tasks/tache-hive/auth.ts' }, 'export {}'),
        ),
      );
    expect(lire(3)).toBeUndefined();
    expect(lire(4)).toMatchObject({
      arret: { issue: 'enlisement', motif: 'repetition', fois: 4, outil: 'Read' },
      ligne: 7,
    });
  });

  it('MÊME APPEL EN ÉCHEC, quel que soit le message : arrêté au 4e (OpenHands : au-delà de 3)', () => {
    // Le message d'échec change à chaque fois (une durée, un horodatage) : la
    // règle ne compare QUE l'appel, comme `_action_error_streak` — rien n'a été
    // fait ENTRE les quatre essais, qui n'ont donc aucune raison de réussir.
    // Compromis assumé, celui d'OpenHands : attendre quelque chose en relançant
    // quatre fois de suite la même commande qui échoue se lit comme une boucle.
    const echoue = (n: number) =>
      fois(n, (i) =>
        outil('Bash', { command: 'npm test' }, `FAIL après ${100 + i} ms`, { erreur: true }),
      );
    expect(claude(echoue(3))).toBeUndefined();
    expect(claude(echoue(4))?.arret).toEqual({
      issue: 'enlisement',
      motif: 'erreurs',
      fois: 4,
      outil: 'Bash',
    });
  });

  it('OSCILLATION A→B→A→B→A→B : arrêtée au 6e appel, jamais au 5e', () => {
    const cycle = (i: number) =>
      i % 2 === 0
        ? outil('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, 'ok')
        : outil('Edit', { file_path: 'a.ts', old_string: 'y', new_string: 'x' }, 'ok');
    expect(claude(fois(5, cycle))).toBeUndefined();
    expect(claude(fois(6, cycle))?.arret).toMatchObject({
      motif: 'oscillation',
      fois: 6,
      outil: 'Edit',
    });
  });

  it('UN AGENT QUI PROGRESSE N’EST JAMAIS ENLISÉ — tests qui changent, fichiers neufs, corrections différentes', () => {
    // Une correction, puis les tests : leur sortie change d'un tour à l'autre.
    expect(
      claude(
        fois(40, (i) => [
          ...outil(
            'Edit',
            { file_path: 'a.ts', old_string: `v${i}`, new_string: `v${i + 1}` },
            'ok',
          ),
          ...outil('Bash', { command: 'npm test' }, `${40 - i} échecs`, { erreur: i < 39 }),
        ]),
      ),
    ).toBeUndefined();
    // La même commande quarante fois, sa sortie RÉUSSIE change (un journal qui
    // grandit pendant qu'un travail tourne) : ce n'est pas une boucle.
    expect(
      claude(fois(40, (i) => outil('Bash', { command: 'tail -n 1 build.log' }, `étape ${i}`))),
    ).toBeUndefined();
    // Une correction DIFFÉRENTE entre deux relances identiques du même test rouge.
    expect(
      claude(
        fois(30, (i) => [
          ...outil(
            'Edit',
            { file_path: 'a.ts', old_string: `v${i}`, new_string: `v${i + 1}` },
            'ok',
          ),
          ...outil('Bash', { command: 'npm test' }, '1 échec : a.test.ts', { erreur: true }),
        ]),
      ),
    ).toBeUndefined();
    // Cent fichiers neufs lus ou écrits.
    expect(
      claude(fois(100, (i) => outil('Write', { file_path: `f${i}.ts`, content: 'x' }, 'ok'))),
    ).toBeUndefined();
    // Trois répétitions, un fichier neuf, trois répétitions : la boucle est rompue.
    const ls = () => outil('Bash', { command: 'ls' }, 'a.ts');
    expect(
      claude([
        ...fois(3, ls),
        ...outil('Write', { file_path: 'neuf.ts', content: '1' }, 'ok'),
        ...fois(3, ls),
      ]),
    ).toBeUndefined();
  });

  it('CHAQUE SOUS-AGENT A SON FIL : leurs appels mêlés ne font pas une boucle, la boucle de l’un est vue', () => {
    // Deux sous-agents lancent chacun deux fois le même appel, entrelacés :
    // quatre appels identiques dans le flux, deux par fil — personne n'est enlisé.
    const meme = (agent: string) => outil('Grep', { pattern: 'TODO' }, 'a.ts:1', { agent });
    expect(
      claude([
        ...meme('toolu_sa_1'),
        ...meme('toolu_sa_2'),
        ...meme('toolu_sa_1'),
        ...meme('toolu_sa_2'),
      ]),
    ).toBeUndefined();
    // Un sous-agent tourne en rond pendant que l'agent principal avance.
    const boucle = fois(4, (i) => [
      ...meme('toolu_sa_1'),
      ...outil('Write', { file_path: `p${i}.ts`, content: 'x' }, 'ok'),
    ]);
    expect(claude(boucle)?.arret).toMatchObject({ motif: 'repetition', outil: 'Grep' });
  });

  it('rendu UNE fois, l’état borné : un retour sans appel, ou d’un appel oublié, ne compte pas', () => {
    const vigie = createVigie(RELANCES_BORNEES_CLAUDE);
    // Dix mille appels jamais rendus : la mémoire des appels en vol reste bornée,
    // et le retour du tout premier, oublié, ne s'apparie plus à rien.
    for (let i = 0; i < 10_000; i += 1) {
      vigie.observer({
        genre: 'appel',
        id: `a${i}`,
        agent: 'principal',
        outil: 'Read',
        empreinte: 'x',
      });
    }
    for (let i = 0; i < 4; i += 1) {
      expect(
        vigie.observer({ genre: 'retour', id: 'a0', empreinte: 'y', erreur: false }),
      ).toBeUndefined();
    }
    const v = createVigie(RELANCES_BORNEES_CLAUDE);
    const arrets = fois(8, () => outil('Read', { file_path: 'a.ts' }, 'x'))
      .flatMap(evenementsClaude)
      .map((e) => v.observer(e))
      .filter(Boolean);
    expect(arrets).toHaveLength(1);
  });
});

describe('la vigie — Claude Code 2.1.289 face à un fournisseur épuisé (flux enregistrés)', () => {
  it('429 EN SÉRIE : le CLI relance dix fois (sa borne), puis conclut — la vigie ne le devance pas, et range une LIMITE', () => {
    const flux = fixture('enlisement', 'claude-429.stream.jsonl');
    expect(flux.filter((l) => l.includes('"subtype":"api_retry"'))).toHaveLength(10);
    const vu = claude(flux);
    // Sur la DERNIÈRE ligne — l'erreur finale —, jamais pendant les relances.
    expect(vu).toMatchObject({ genre: 'fin', ligne: flux.length - 1 });
    expect(vu?.arret).toEqual({ issue: 'epuisement_fournisseur', cause: 'limite' });
  });

  it('529 EN SÉRIE : « API Error: 529 Overloaded… » est une SURCHARGE, pas un échec du modèle', () => {
    const flux = fixture('enlisement', 'claude-529.stream.jsonl');
    const vu = claude(flux);
    expect(vu).toMatchObject({ genre: 'fin', ligne: flux.length - 1 });
    expect(vu?.arret).toEqual({ issue: 'epuisement_fournisseur', cause: 'surcharge' });
  });

  it('SOUS LE CHIEN DE GARDE (`max_retries: 300`), la 11e relance arrête l’agent EN VOL', () => {
    const flux = fixture('enlisement', 'claude-529-watchdog.stream.jsonl');
    const relances = flux.filter((l) => l.includes('"subtype":"api_retry"'));
    expect(relances.length).toBeGreaterThan(RELANCES_BORNEES_CLAUDE);
    expect(relances[0]).toContain('"max_retries":300');
    const vu = claude(flux);
    expect(vu).toMatchObject({ genre: 'relance', arret: { cause: 'surcharge' } });
    expect(flux[vu!.ligne]).toContain(`"attempt":${RELANCES_BORNEES_CLAUDE + 1},`);
  });

  it('LIMITE D’ABONNEMENT (contrat) : arrêtée dès l’événement, avec sa remise à zéro déclarée', () => {
    const flux = fixture('enlisement', 'claude-limite-abonnement.contrat.stream.jsonl');
    const vu = claude(flux);
    expect(vu).toMatchObject({ genre: 'epuise', ligne: 1 });
    expect(vu?.arret).toEqual({
      issue: 'epuisement_fournisseur',
      cause: 'limite',
      remiseA: 1_791_141_300_000,
    });
    expect(
      direArret(
        vu!.arret,
        (fr) => fr,
        (ms) => new Date(ms).toISOString().slice(11, 16),
      ),
    ).toBe('fournisseur épuisé : limite atteinte, remise à zéro à 19:15');
  });

  it('une limite qui n’arrête pas TOUS les modèles, un dépassement payant permis, un avertissement : rien', () => {
    const evenement = (info: Record<string, unknown>) =>
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { resetsAt: 1_791_141_300, ...info },
      });
    for (const info of [
      { status: 'rejected', rateLimitType: 'seven_day_opus' },
      { status: 'rejected', rateLimitType: 'seven_day_sonnet' },
      { status: 'rejected', rateLimitType: 'five_hour', overageStatus: 'allowed' },
      { status: 'rejected', rateLimitType: 'seven_day', overageStatus: 'allowed_warning' },
      { status: 'allowed_warning', rateLimitType: 'five_hour' },
      { status: 'rejected' },
    ]) {
      expect(evenementsClaude(evenement(info)), JSON.stringify(info)).toEqual([]);
    }
    expect(evenementsClaude(evenement({ status: 'rejected', rateLimitType: 'seven_day' }))).toEqual(
      [{ genre: 'epuise', cause: 'limite', remiseA: 1_791_141_300_000 }],
    );
  });

  it('une réponse du fournisseur remet la série à zéro ; une erreur d’identifiants n’est pas un épuisement', () => {
    const relance = (statut: number | null) =>
      JSON.stringify({ type: 'system', subtype: 'api_retry', error_status: statut });
    const reponse = outil('Read', { file_path: 'x' }, 'x').slice(0, 1);
    expect(
      claude([...fois(8, () => [relance(529)]), ...reponse, ...fois(8, () => [relance(529)])]),
    ).toBeUndefined();
    expect(claude(fois(30, () => [relance(401)]))).toBeUndefined();
    expect(claude(fois(11, () => [relance(null)]))?.arret).toEqual({
      issue: 'epuisement_fournisseur',
      cause: 'injoignable',
    });
  });
});

describe('la vigie — Codex 0.156.0 (flux enregistrés)', () => {
  it.each([
    ['codex-usage.json.stdout.jsonl', 'limite'],
    ['codex-429.json.stdout.jsonl', 'limite'],
    ['codex-503.json.stdout.jsonl', 'surcharge'],
    ['codex-500.json.stdout.jsonl', 'surcharge'],
  ])(
    '%s : l’erreur finale est un épuisement (%s), rangé sans arrêter le CLI qui conclut',
    (nom, cause) => {
      const flux = fixture('enlisement', nom);
      expect(codex(flux)).toMatchObject({
        genre: 'fin',
        arret: { issue: 'epuisement_fournisseur', cause },
      });
    },
  );

  it('« waiting for network » sans fin : arrêté à la 6e relance, au-delà de la borne de Codex', () => {
    const flux = fixture('enlisement', 'codex-injoignable.json.stdout.jsonl');
    const vu = codex(flux);
    expect(vu).toMatchObject({ genre: 'relance', arret: { cause: 'injoignable' } });
    expect(flux.slice(0, vu!.ligne + 1).filter((l) => l.includes('Reconnecting...'))).toHaveLength(
      RELANCES_BORNEES_CODEX + 1,
    );
  });

  it('LA MÊME COMMANDE, LA MÊME SORTIE : enlisé ; des correctifs entre deux relances : jamais', () => {
    let n = 0;
    const commande = (cmd: string, sortie: string, code = 0) => {
      n += 1;
      const item = {
        id: `item_${n}`,
        type: 'command_execution',
        command: cmd,
        aggregated_output: sortie,
        exit_code: code,
        status: code === 0 ? 'completed' : 'failed',
      };
      return [JSON.stringify({ type: 'item.completed', item })];
    };
    const correctif = () => {
      n += 1;
      const item = {
        id: `item_${n}`,
        type: 'file_change',
        changes: [{ path: '/travail/a.ts', kind: 'update' }],
        status: 'completed',
      };
      return [JSON.stringify({ type: 'item.completed', item })];
    };
    const ls = () => commande("/bin/bash -lc 'ls'", 'a.ts\n');
    expect(codex(fois(4, ls))?.arret).toEqual({
      issue: 'enlisement',
      motif: 'repetition',
      fois: 4,
      outil: 'commande',
    });
    // Le contenu d'un correctif n'est pas dans le flux : il compte comme du
    // progrès, et l'agent qui corrige puis relance les tests n'est jamais arrêté.
    expect(
      codex(fois(30, () => [...correctif(), ...commande('npm test', '1 failed', 1)])),
    ).toBeUndefined();
  });

  it('PAR LE VRAI LECTEUR DU FLUX : l’arrêt en vol part au nœud, l’erreur finale reste rangée sans arrêt', () => {
    const lire = (nom: string) => {
      const arrets: ArretVigie[] = [];
      const lecteur = createLecteurFluxCodex({ surArret: (a) => arrets.push(a) });
      for (const ligne of fixture('enlisement', nom)) lecteur.lire(ligne);
      return { enVol: arrets, rangee: lecteur.arret() };
    };
    expect(lire('codex-injoignable.json.stdout.jsonl')).toEqual({
      enVol: [{ issue: 'epuisement_fournisseur', cause: 'injoignable' }],
      rangee: { issue: 'epuisement_fournisseur', cause: 'injoignable' },
    });
    expect(lire('codex-503.json.stdout.jsonl')).toEqual({
      enVol: [],
      rangee: { issue: 'epuisement_fournisseur', cause: 'surcharge' },
    });
  });
});

describe('l’issue rangée, et ce qu’elle devient sur le fil', () => {
  const echec = { success: false, diff: '', logs: 'x', subAgents: [] };

  it('un épuisement prend le chemin des pannes d’infrastructure ; un enlisement reste un échec ; une réussite reste une réussite', () => {
    expect(
      resultatSelonVigie(echec, { issue: 'epuisement_fournisseur', cause: 'limite', remiseA: 5 }),
    ).toEqual({
      ...echec,
      infra: true,
      epuisement: { cause: 'limite', remiseA: 5 },
    });
    const enlise = resultatSelonVigie(echec, {
      issue: 'enlisement',
      motif: 'erreurs',
      fois: 4,
      outil: 'Bash',
    });
    expect(enlise).toEqual({ ...echec, enlisement: { motif: 'erreurs', fois: 4, outil: 'Bash' } });
    expect(enlise.infra).toBeUndefined();
    const reussie = { ...echec, success: true };
    expect(
      resultatSelonVigie(reussie, {
        issue: 'enlisement',
        motif: 'erreurs',
        fois: 4,
        outil: 'Bash',
      }),
    ).toBe(reussie);
  });

  it('le protocole lit le fait, et le laisse tomber SEUL quand il est mal formé', () => {
    const resultat = (enlisement: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: false,
          diff: '',
          logs: '',
          durationMs: 5,
          subAgents: [],
          enlisement,
        }),
      );
    expect(resultat({ motif: 'oscillation', fois: 6, outil: 'Edit' })).toMatchObject({
      enlisement: { motif: 'oscillation', fois: 6, outil: 'Edit' },
    });
    for (const faux of [
      { motif: 'monologue', fois: 3, outil: 'x' },
      { motif: 'repetition', fois: 0, outil: 'x' },
      'enlisé',
    ]) {
      const lu = resultat(faux);
      expect(lu).not.toBeNull();
      expect(lu).not.toHaveProperty('enlisement');
    }
    const refus = (champs: Record<string, unknown>) =>
      parseClientMessage(
        JSON.stringify({ type: 'task_reject', taskId: 't1', reason: 'r', ...champs }),
      );
    expect(refus({ infra: true, epuisement: { cause: 'surcharge' } })).toMatchObject({
      infra: true,
      epuisement: { cause: 'surcharge' },
    });
    // Sans `infra`, un épuisement ne se croit pas : ce serait une saturation.
    expect(refus({ epuisement: { cause: 'limite' } })).not.toHaveProperty('epuisement');
    expect(refus({ infra: true, epuisement: { cause: 'fatigue' } })).not.toHaveProperty(
      'epuisement',
    );
    expect(refus({ infra: true, epuisement: { cause: 'limite', remiseA: -1 } })).toMatchObject({
      epuisement: { cause: 'limite' },
    });
  });
});
