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
// CONSTRUITES d'après le contrat, faute de compte claude.ai sur la machine
// d'enregistrement — suivi nommé « preuve réelle » :
//
//   · `claude-limite-abonnement.contrat` : la ligne `init` et le résultat
//     d'erreur de `claude-429`, le message « You've hit your session limit ·
//     resets 3:45pm » (code.claude.com/docs/en/errors), et un
//     `rate_limit_event` à la forme de `SDKRateLimitEvent` (SDK 0.3.289) :
//     `status: rejected`, `rateLimitType: five_hour`, `resetsAt` en SECONDES ;
//   · le travail de fond : `system/background_tasks_changed` à la forme de
//     `SDKBackgroundTasksChangedMessage` (SDK 0.3.289 — « a level signal »,
//     l'ensemble des tâches vivantes, `ambient` exclu de l'activité) ;
//   · le rejet d'un appel par le cadre : `<tool_use_error>…</tool_use_error>`,
//     le motif par lequel le binaire 2.1.289 reconnaît ses propres erreurs
//     d'outil ; la sortie d'une commande en échec : « Exit code N » et sa
//     sortie, SANS cette enveloppe (même binaire).
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
  ATTENTE_RESEAU_MAX_MS,
  createVigie,
  ERREURS_ENLISEMENT,
  evenementsClaude,
  evenementsCodex,
  OSCILLATION_ENLISEMENT,
  REPETITIONS_ENLISEMENT,
  resultatSelonVigie,
  type EvenementVigie,
} from '../src/adapters/vigie-enlisement.js';
import {
  direArret,
  direRemise,
  epuisementDepuis,
  type ArretVigie,
} from '../src/shared/enlisement.js';
import { parseClientMessage } from '../src/shared/protocol.js';

const fixture = (dossier: string, nom: string): string[] =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', dossier, nom), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');

/** L'horloge des bancs : juste avant la remise à zéro de la fixture de contrat (19:15 UTC). */
const T0 = 1_791_140_000_000;

/**
 * Ce que la vigie fait d'un flux : l'arrêt EN VOL (sa ligne, le genre de
 * l'événement), et l'ISSUE rendue une fois le CLI sorti. `pas` : l'écart
 * d'horloge entre deux lignes.
 */
function suivre(
  lignes: readonly string[],
  lire: (ligne: string) => EvenementVigie[],
  pas = 0,
): {
  enVol?: { arret: ArretVigie; ligne: number; genre: EvenementVigie['genre'] };
  issue?: ArretVigie;
} {
  const vigie = createVigie();
  let enVol: { arret: ArretVigie; ligne: number; genre: EvenementVigie['genre'] } | undefined;
  for (const [i, ligne] of lignes.entries()) {
    for (const e of lire(ligne)) {
      const arret = vigie.observer(e, T0 + i * pas);
      if (arret) enVol = { arret, ligne: i, genre: e.genre };
    }
  }
  const issue = vigie.issue();
  return { ...(enVol ? { enVol } : {}), ...(issue ? { issue } : {}) };
}
const claude = (lignes: readonly string[], pas = 0) => suivre(lignes, evenementsClaude, pas);
const codex = (lignes: readonly string[], pas = 0) =>
  suivre(lignes, (l) => evenementsCodex(JSON.parse(l) as Record<string, unknown>), pas);

// ─── Une boucle d'outils de Claude Code, à la forme enregistrée ─────────────

const [, APPEL_REEL, RETOUR_REEL] = fixture('texte-final', 'claude-echec-api-400.stream.jsonl');
let suivant = 0;

/** Ce qu'on récrit d'une ligne enregistrée : ses blocs, et le sous-agent qui l'émet. */
interface LigneOutil {
  message: { content: unknown[] };
  parent_tool_use_id: string | null;
}

/** Un `tool_use` puis son `tool_result`, à la forme enregistrée sur 2.1.289. */
function outil(
  nom: string,
  input: Record<string, unknown>,
  retour: string,
  opts: { erreur?: boolean; agent?: string } = {},
): string[] {
  suivant += 1;
  const id = `toolu_banc_${suivant}`;
  const appel = JSON.parse(APPEL_REEL!) as LigneOutil;
  appel.message.content = [{ type: 'tool_use', id, name: nom, input }];
  appel.parent_tool_use_id = opts.agent ?? null;
  const resultat = JSON.parse(RETOUR_REEL!) as LigneOutil;
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
/** Le travail de fond vivant, tel que le CLI le redit à chaque changement. */
const fond = (taches: Array<{ ambient?: boolean }>): string =>
  JSON.stringify({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: taches.map((t, i) => ({
      task_id: `b${i}`,
      task_type: 'local_bash',
      description: 'npm run build',
      ...t,
    })),
  });

describe('la vigie — un agent qui tourne en rond (règles portées d’OpenHands)', () => {
  it('les seuils sont ceux du StuckDetector d’OpenHands ; l’attente sans borne du réseau, 10 min', () => {
    // `StuckDetectionThresholds` : action_observation 4, action_error 3 (> 3),
    // alternating_pattern 6.
    expect([REPETITIONS_ENLISEMENT, ERREURS_ENLISEMENT, OSCILLATION_ENLISEMENT]).toEqual([4, 4, 6]);
    expect(ATTENTE_RESEAU_MAX_MS).toBe(10 * 60_000);
  });

  it('MÊME APPEL, MÊME RÉSULTAT : arrêté au 4e — jamais au 3e', () => {
    const lire = (n: number) =>
      claude(
        fois(n, () =>
          outil('Read', { file_path: '/travail/tasks/tache-hive/auth.ts' }, 'export {}'),
        ),
      );
    expect(lire(3)).toEqual({});
    expect(lire(4).enVol).toMatchObject({
      arret: { issue: 'enlisement', motif: 'repetition', fois: 4, outil: 'Read' },
      ligne: 7,
    });
  });

  it('LA MÊME COMMANDE EN ÉCHEC, SORTIE CHAQUE FOIS DIFFÉRENTE : jamais enlisée — c’est une sortie, pas un rejet du cadre', () => {
    // La forme d'un `Bash` qui sort en 1 (binaire 2.1.289 : « Exit code N »,
    // puis la sortie), `is_error` sans `<tool_use_error>` : chez OpenHands
    // aussi, une observation ordinaire. Sa durée change d'une fois à l'autre.
    const echoue = (n: number) =>
      fois(n, (i) =>
        outil(
          'Bash',
          { command: 'npm test' },
          `Exit code 1\n FAIL  a.test.ts\n Duration  ${578 + i * 53}ms`,
          { erreur: true },
        ),
      );
    expect(claude(echoue(12))).toEqual({});
    // La MÊME sortie quatre fois : la règle de répétition la prend.
    const meme = fois(4, () =>
      outil('Bash', { command: 'npm test' }, 'Exit code 1\n FAIL  a.test.ts', { erreur: true }),
    );
    expect(claude(meme).enVol?.arret).toMatchObject({ motif: 'repetition', outil: 'Bash' });
  });

  it('LE MÊME APPEL REJETÉ PAR LE CADRE, message changeant : arrêté au 4e (OpenHands : au-delà de 3)', () => {
    // Le texte du rejet change (un nombre, une liste) : la règle ne compare
    // QUE l'appel, comme `_action_error_streak` sur ses `AgentErrorEvent`.
    const rejete = (n: number) =>
      fois(n, (i) =>
        outil(
          'Edit',
          { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
          `<tool_use_error>String to replace not found in file (${i + 3} near matches)</tool_use_error>`,
          { erreur: true },
        ),
      );
    expect(claude(rejete(3))).toEqual({});
    expect(claude(rejete(4)).enVol?.arret).toEqual({
      issue: 'enlisement',
      motif: 'erreurs',
      fois: 4,
      outil: 'Edit',
    });
  });

  it('UNE PERMISSION REFUSÉE est un rejet du cadre : annoncée par `system/permission_denied` (SDK 0.3.289), même si son message change', () => {
    // Le message rendu au modèle porte la raison du refus, qui peut changer :
    // seule l'annonce du CLI en fait un rejet du cadre — pas le texte.
    const refusee = (annoncee: boolean) =>
      fois(4, (i) => {
        const [appel, retour] = outil(
          'Bash',
          { command: 'rm -rf build' },
          `Permission to use Bash has been denied. (essai ${i})`,
          { erreur: true },
        );
        const blocs = (JSON.parse(appel!) as LigneOutil).message.content as Array<{ id: string }>;
        const annonce = JSON.stringify({
          type: 'system',
          subtype: 'permission_denied',
          tool_name: 'Bash',
          tool_use_id: blocs[0]!.id,
          decision_reason_type: 'mode',
          message: `Permission to use Bash has been denied. (essai ${i})`,
        });
        return annoncee ? [appel!, annonce, retour!] : [appel!, retour!];
      });
    expect(claude(refusee(true)).enVol?.arret).toEqual({
      issue: 'enlisement',
      motif: 'erreurs',
      fois: 4,
      outil: 'Bash',
    });
    // Sans l'annonce, ce n'est que la sortie d'un appel qui change : rien.
    expect(claude(refusee(false))).toEqual({});
  });

  it('OSCILLATION A→B→A→B→A→B : arrêtée au 6e appel, jamais au 5e', () => {
    const cycle = (i: number) =>
      i % 2 === 0
        ? outil('Edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }, 'ok')
        : outil('Edit', { file_path: 'a.ts', old_string: 'y', new_string: 'x' }, 'ok');
    expect(claude(fois(5, cycle))).toEqual({});
    expect(claude(fois(6, cycle)).enVol?.arret).toMatchObject({
      motif: 'oscillation',
      fois: 6,
      outil: 'Edit',
    });
  });

  it('UN AGENT QUI PROGRESSE N’EST JAMAIS ENLISÉ — tests qui changent, fichiers neufs, corrections différentes', () => {
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
    ).toEqual({});
    expect(
      claude(fois(40, (i) => outil('Bash', { command: 'tail -n 1 build.log' }, `étape ${i}`))),
    ).toEqual({});
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
    ).toEqual({});
    expect(
      claude(fois(100, (i) => outil('Write', { file_path: `f${i}.ts`, content: 'x' }, 'ok'))),
    ).toEqual({});
    const ls = () => outil('Bash', { command: 'ls' }, 'a.ts');
    expect(
      claude([
        ...fois(3, ls),
        ...outil('Write', { file_path: 'neuf.ts', content: '1' }, 'ok'),
        ...fois(3, ls),
      ]),
    ).toEqual({});
  });

  it('ATTENDRE DU TRAVAIL DE FOND n’est pas tourner en rond — la répétition reprend quand il s’arrête', () => {
    // La sortie d'une commande de fond, relue tant qu'elle tourne : le CLI
    // répond chaque fois la même chose. Et l'agent principal qui liste ses
    // agents pendant qu'un sous-agent de fond avance.
    const relire = () =>
      outil(
        'Read',
        { file_path: '/tmp/bash-1.out' },
        'Wasted call — file unchanged since your last Read.',
      );
    const lister = () => outil('ListAgents', {}, '1 agent : build (running)');
    expect(claude([fond([{}]), ...fois(10, relire)])).toEqual({});
    expect(claude([fond([{}]), ...fois(10, lister)])).toEqual({});
    // Une tâche `ambient` (une veille) n'est pas de l'activité : la règle tient.
    expect(claude([fond([{ ambient: true }]), ...fois(4, relire)]).enVol?.arret).toMatchObject({
      motif: 'repetition',
    });
    // Le fond fini (ensemble vide), quatre relectures identiques : enlisé — et
    // celles d'avant ne comptent pas dans la fenêtre.
    const apres = claude([fond([{}]), ...fois(3, relire), fond([]), ...fois(3, relire)]);
    expect(apres).toEqual({});
    expect(
      claude([fond([{}]), ...fois(3, relire), fond([]), ...fois(4, relire)]).enVol?.arret,
    ).toMatchObject({ motif: 'repetition', outil: 'Read' });
  });

  it('CHAQUE SOUS-AGENT A SON FIL : leurs appels mêlés ne font pas une boucle, la boucle de l’un est vue', () => {
    const meme = (agent: string) => outil('Grep', { pattern: 'TODO' }, 'a.ts:1', { agent });
    expect(
      claude([
        ...meme('toolu_sa_1'),
        ...meme('toolu_sa_2'),
        ...meme('toolu_sa_1'),
        ...meme('toolu_sa_2'),
      ]),
    ).toEqual({});
    const boucle = fois(4, (i) => [
      ...meme('toolu_sa_1'),
      ...outil('Write', { file_path: `p${i}.ts`, content: 'x' }, 'ok'),
    ]);
    expect(claude(boucle).enVol?.arret).toMatchObject({ motif: 'repetition', outil: 'Grep' });
  });

  it('rendu UNE fois, l’état borné : un retour sans appel, ou d’un appel oublié, ne compte pas', () => {
    const vigie = createVigie();
    for (let i = 0; i < 10_000; i += 1) {
      vigie.observer(
        { genre: 'appel', id: `a${i}`, agent: 'principal', outil: 'Read', empreinte: 'x' },
        T0,
      );
    }
    for (let i = 0; i < 4; i += 1) {
      expect(
        vigie.observer({ genre: 'retour', id: 'a0', empreinte: 'y', cadre: false }, T0),
      ).toBeUndefined();
    }
    const v = createVigie();
    const arrets = fois(8, () => outil('Read', { file_path: 'a.ts' }, 'x'))
      .flatMap(evenementsClaude)
      .map((e) => v.observer(e, T0))
      .filter(Boolean);
    expect(arrets).toHaveLength(1);
  });

  it('UN AVIS AU SCHÉMA que le CLI refuse (StructuredOutput, G15a) ne compte pas : le CLI borne ces relances lui-même — l’enregistrement va à son terme', () => {
    // Claude Code 2.1.289 sous `--json-schema` : cinq appels identiques hors
    // schéma, cinq refus identiques, puis `error_max_structured_output_retries`.
    // Arrêtée au 4e, une relecture devançait la borne que le CLI applique.
    const horsSchema = fixture('avis-structure', 'claude-hors-schema.stream.jsonl');
    expect(horsSchema.filter((l) => l.includes('"name":"StructuredOutput"'))).toHaveLength(5);
    expect(horsSchema.at(-1)).toContain('"subtype":"error_max_structured_output_retries"');
    expect(claude(horsSchema)).toEqual({});
    // Le même refus répété par un VRAI outil reste une boucle : arrêté au 4e.
    const outilReel = horsSchema.map((l) =>
      l.replaceAll('"name":"StructuredOutput"', '"name":"Bash"'),
    );
    expect(claude(outilReel).enVol?.arret).toEqual({
      issue: 'enlisement',
      motif: 'repetition',
      fois: REPETITIONS_ENLISEMENT,
      outil: 'Bash',
    });
  });
});

describe('la vigie — Claude Code 2.1.289 face à un fournisseur épuisé : elle ne devance jamais le CLI', () => {
  it('429 EN SÉRIE : dix relances (sa borne), puis il conclut — aucun arrêt en vol, l’issue est une LIMITE', () => {
    const flux = fixture('enlisement', 'claude-429.stream.jsonl');
    expect(flux.filter((l) => l.includes('"subtype":"api_retry"'))).toHaveLength(10);
    expect(claude(flux)).toEqual({ issue: { issue: 'epuisement_fournisseur', cause: 'limite' } });
  });

  it('529 EN SÉRIE : « API Error: 529 Overloaded… » est une SURCHARGE, pas un échec du modèle', () => {
    expect(claude(fixture('enlisement', 'claude-529.stream.jsonl'))).toEqual({
      issue: { issue: 'epuisement_fournisseur', cause: 'surcharge' },
    });
  });

  it('LA BORNE DÉCLARÉE EST RESPECTÉE : chien de garde (`max_retries: 300`), 20 relances déclarées — jamais d’arrêt en vol', () => {
    const watchdog = fixture('enlisement', 'claude-529-watchdog.stream.jsonl');
    expect(watchdog.find((l) => l.includes('api_retry'))).toContain('"max_retries":300');
    // Tué sans issue finale (le délai dur) pendant la série : un épuisement.
    expect(claude(watchdog, 60_000)).toEqual({
      issue: { issue: 'epuisement_fournisseur', cause: 'surcharge' },
    });
    const relance = (attempt: number) =>
      JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt,
        max_retries: 20,
        retry_delay_ms: 40_000,
        error_status: 529,
        error: 'overloaded',
      });
    const vu = claude(
      fois(20, (i) => [relance(i + 1)]),
      60_000,
    );
    expect(vu.enVol).toBeUndefined();
  });

  it('UNE LIMITE D’ABONNEMENT (contrat) : jamais d’arrêt en vol sur l’événement — l’issue finale la range, avec sa remise à zéro', () => {
    const flux = fixture('enlisement', 'claude-limite-abonnement.contrat.stream.jsonl');
    expect(claude(flux)).toEqual({
      issue: { issue: 'epuisement_fournisseur', cause: 'limite', remiseA: 1_791_141_300_000 },
    });
    // Un `rate_limit_event` FORGÉ (une commande de l'agent qui écrit sur la
    // sortie du CLI) sans issue finale en erreur : rien n'est rangé.
    const [init, evenement] = flux;
    const reussi = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
    });
    expect(claude([init!, evenement!, reussi])).toEqual({});
  });

  it('UNE REMISE À ZÉRO ABERRANTE est ignorée : 9e15 s, ou au-delà de 8 jours, ne fait ni attendre ni lever', () => {
    const [init, evenement, assistant, resultat] = fixture(
      'enlisement',
      'claude-limite-abonnement.contrat.stream.jsonl',
    );
    for (const resetsAt of [9e15, 1_791_140_000 + 9 * 86_400, -5, 1.5]) {
      const forge = evenement!.replace('"resetsAt":1791141300', `"resetsAt":${resetsAt}`);
      expect(claude([init!, forge, assistant!, resultat!]).issue, String(resetsAt)).toEqual({
        issue: 'epuisement_fournisseur',
        cause: 'limite',
      });
    }
    // Le protocole aussi, à la réception ; et la phrase ne lève jamais.
    expect(epuisementDepuis({ cause: 'limite', remiseA: 9e18 }, T0)).toEqual({ cause: 'limite' });
    expect(epuisementDepuis({ cause: 'limite', remiseA: T0 + 9 * 86_400_000 }, T0)).toEqual({
      cause: 'limite',
    });
    expect(
      direRemise(
        9e18,
        T0,
        () => 'h',
        () => 'd',
      ),
    ).toBe('?');
    // Au-delà d'un jour, la DATE avec l'heure.
    const iso = (d: Date) => d.toISOString().slice(0, 16);
    const heure = (d: Date) => d.toISOString().slice(11, 16);
    expect(direRemise(T0 + 3_600_000, T0, heure, iso)).toBe('19:53');
    expect(direRemise(T0 + 3 * 86_400_000, T0, heure, iso)).toBe('2026-10-07T18:53');
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
      [{ genre: 'limite', remiseA: 1_791_141_300_000 }],
    );
  });

  it('LE 502 D’UNE PASSERELLE (celle de Hive comprise) est un fournisseur INJOIGNABLE, jamais une surcharge', () => {
    const fin = (statut: number | null) =>
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: statut,
      });
    expect(claude([fin(502)]).issue).toEqual({
      issue: 'epuisement_fournisseur',
      cause: 'injoignable',
    });
    expect(claude([fin(504)]).issue).toMatchObject({ cause: 'injoignable' });
    expect(claude([fin(503)]).issue).toMatchObject({ cause: 'surcharge' });
    // Une erreur d'identifiants, ou pas d'erreur d'API du tout : rien.
    expect(claude([fin(401)])).toEqual({});
    expect(claude([fin(null)])).toEqual({});
  });

  it('une réponse du fournisseur clôt la série : une erreur ordinaire ensuite n’est pas un épuisement', () => {
    const relance = JSON.stringify({
      type: 'system',
      subtype: 'api_retry',
      attempt: 1,
      error_status: 529,
    });
    const reponse = outil('Read', { file_path: 'x' }, 'x').slice(0, 1);
    expect(claude([relance, ...reponse])).toEqual({});
    expect(claude([relance]).issue).toMatchObject({ cause: 'surcharge' });
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
      expect(codex(fixture('enlisement', nom))).toEqual({
        issue: { issue: 'epuisement_fournisseur', cause },
      });
    },
  );

  it('« waiting for network » : bornée en DURÉE (10 min), jamais en nombre — l’enregistrement (6 avis en 153 s) ne l’arrête pas', () => {
    const flux = fixture('enlisement', 'codex-injoignable.json.stdout.jsonl');
    // Les avis espacés comme sur le vrai binaire : pas d'arrêt, et tué sans
    // issue finale, la série en cours se range en fournisseur injoignable.
    expect(codex(flux, 30_000)).toEqual({
      issue: { issue: 'epuisement_fournisseur', cause: 'injoignable' },
    });
    // La même attente sur plus de dix minutes : arrêtée en vol.
    const vu = codex(flux, 3 * 60_000);
    expect(vu.enVol).toMatchObject({ genre: 'relance', arret: { cause: 'injoignable' } });
    // « Reconnecting... 6/10 » : une borne déclarée — jamais devancée, même longue.
    const declaree = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        type: 'error',
        message: `Reconnecting... ${i + 1}/10 (We’re currently experiencing high demand, which may cause temporary errors.)`,
      }),
    );
    expect(codex(declaree, 5 * 60_000).enVol).toBeUndefined();
  });

  it('un 502 de Codex (passerelle) est injoignable', () => {
    const echec = JSON.stringify({
      type: 'turn.failed',
      error: { message: 'unexpected status 502 Bad Gateway: Hive : l’API openai ne répond pas.' },
    });
    expect(codex([echec]).issue).toMatchObject({ cause: 'injoignable' });
  });

  it('LA MÊME COMMANDE, LA MÊME SORTIE : enlisé ; le CADRE qui la rejette : enlisé ; un code 1 aux sorties changeantes, ou des correctifs entre deux relances : jamais', () => {
    let n = 0;
    const commande = (
      cmd: string,
      sortie: string,
      code = 0,
      statut = code === 0 ? 'completed' : 'failed',
    ) => {
      n += 1;
      const item = {
        id: `item_${n}`,
        type: 'command_execution',
        command: cmd,
        aggregated_output: sortie,
        exit_code: code,
        status: statut,
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
    expect(codex(fois(4, () => commande("/bin/bash -lc 'ls'", 'a.ts\n'))).enVol?.arret).toEqual({
      issue: 'enlisement',
      motif: 'repetition',
      fois: 4,
      outil: 'commande',
    });
    // Rejetée par le cadre (`ToolEventFailure::Rejected` : code -1, `declined`),
    // le message changeant : la règle des rejets la prend.
    const refusee = (i: number) =>
      commande('rm -rf build', `rejected by policy (${i})`, -1, 'declined');
    expect(codex(fois(4, refusee)).enVol?.arret).toMatchObject({ motif: 'erreurs', fois: 4 });
    // Lancée, elle sort en 1 avec une sortie qui change : jamais.
    expect(codex(fois(12, (i) => commande('npm test', `Duration ${600 + i}ms`, 1)))).toEqual({});
    expect(codex(fois(30, () => [...correctif(), ...commande('npm test', '1 failed', 1)]))).toEqual(
      {},
    );
  });

  it('QUATRE RECHERCHES WEB n’en font pas une boucle — leurs deux `id` aplatis ne les rendent pas identiques', () => {
    // `WebSearchItem` porte son `id`, aplati dans `ThreadItem` : deux clés
    // `id`, et `JSON.parse` garde la dernière — la même à chaque fois.
    const recherche = (i: number) => [
      `{"type":"item.completed","item":{"id":"item_${i}","type":"web_search","id":"search-1","query":"vitest retry","action":{"type":"search"}}}`,
    ];
    expect(codex(fois(6, recherche))).toEqual({});
  });

  it('PAR LE VRAI LECTEUR DU FLUX : l’arrêt en vol part au nœud, l’issue finale reste rangée sans arrêt', () => {
    const lire = (nom: string) => {
      const arrets: ArretVigie[] = [];
      const lecteur = createLecteurFluxCodex({ surArret: (a) => arrets.push(a) });
      for (const ligne of fixture('enlisement', nom)) lecteur.lire(ligne);
      return { enVol: arrets, rangee: lecteur.arret() };
    };
    expect(lire('codex-injoignable.json.stdout.jsonl')).toEqual({
      enVol: [],
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
    ).toEqual({ ...echec, infra: true, epuisement: { cause: 'limite', remiseA: 5 } });
    const enlise = resultatSelonVigie(
      { ...echec, infra: true },
      { issue: 'enlisement', motif: 'erreurs', fois: 4, outil: 'Bash' },
    );
    expect(enlise).toEqual({ ...echec, enlisement: { motif: 'erreurs', fois: 4, outil: 'Bash' } });
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

  it('la phrase d’un rejet du cadre le nomme ainsi', () => {
    expect(
      direArret(
        { issue: 'enlisement', motif: 'erreurs', fois: 4, outil: 'Edit' },
        (fr) => fr,
        String,
      ),
    ).toBe('enlisé : même appel d’outil rejeté par le CLI 4 fois de suite (Edit)');
  });

  it('le protocole lit les faits — et ce qu’a coûté une tentative épuisée —, et laisse tomber SEUL ce qui est mal formé', () => {
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
    expect(
      refus({
        infra: true,
        epuisement: { cause: 'surcharge' },
        durationMs: 217_000,
        fournisseur: { source: 'claude-code', coutUsd: 0 },
      }),
    ).toMatchObject({
      infra: true,
      epuisement: { cause: 'surcharge' },
      durationMs: 217_000,
      fournisseur: { source: 'claude-code', coutUsd: 0 },
    });
    // Sans `infra`, un épuisement ne se croit pas : ce serait une saturation ;
    // sans le fait, ni durée ni coût.
    expect(refus({ epuisement: { cause: 'limite' } })).not.toHaveProperty('epuisement');
    expect(refus({ infra: true, durationMs: 5 })).not.toHaveProperty('durationMs');
    expect(refus({ infra: true, epuisement: { cause: 'fatigue' } })).not.toHaveProperty(
      'epuisement',
    );
    expect(refus({ infra: true, epuisement: { cause: 'limite', remiseA: -1 } })).toMatchObject({
      epuisement: { cause: 'limite' },
    });
    expect(
      refus({ infra: true, epuisement: { cause: 'limite' }, durationMs: -3 }),
    ).not.toHaveProperty('durationMs');
  });
});
