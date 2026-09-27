// LE PROTOCOLE PUBLIÉ NE PEUT PAS DÉRIVER DU CODE.
//
// `docs/PROTOCOLE-DEBAT.md` (et sa version anglaise) dit à un opérateur qui
// tranche quoi, avec quels seuils, et ce que devient une objection. Écrit à la
// main, un tel document ment dès le premier changement de constante : son
// prédécesseur, `PROTOCOLE-CRITIQUE.md`, comptait treize règles d'Evaluator
// quand le code en appliquait quatorze (la relecture impossible de #484 n'y
// était pas), et disait « l'Evaluator attend un avis humain » d'une relecture
// absente que la ruche remplace désormais par un secours.
//
// Chaque tableau encadré par `<!-- verifie:<bloc> -->` est donc relu ICI,
// contre le code lui-même — jamais contre une copie :
//
//   · `constantes` : chaque valeur contre la constante exportée ;
//   · `issues`     : chaque issue du Conseil, et qui la tranche ;
//   · `evaluator`  : chaque règle JOUÉE par `evaluate()`, un scénario par
//                    ligne — le rang, la décision, le renvoi ;
//   · `portes`     : les sources de critique, exhaustives ;
//   · `refus`      : les refus du scheduler, exhaustifs, et lesquels ouvrent
//                    un désaccord ;
//   · `journal`    : les événements que la War Room lit, et leur voix.
//
// Les deux langues sont tenues par le MÊME banc : une version anglaise restée
// à l'ancienne valeur serait le même mensonge, dans une autre langue.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BORNES_CRITIQUE, SOURCES_CRITIQUE } from '../src/orchestrator/brood.js';
import {
  DEMI_VIE_TOURS,
  DIVERSITE_MIN,
  LENTILLES,
  POIDS_ARRET,
  QUORUM_ECLAIREUSES,
  TOURS_MAX,
  TOURS_SECS,
  VERSION_CONSEIL,
} from '../src/orchestrator/conseil.js';
import {
  CONSEILS_CONSERVES,
  VERIFICATRICES_PAR_PROPOSITION,
} from '../src/orchestrator/conseil-runner.js';
import { VERSION_EVALUATOR, evaluate } from '../src/orchestrator/evaluator.js';
import type { CrossReviewEvidence, EvaluatorInput } from '../src/orchestrator/evaluator.js';
import { signatureOf, tally } from '../src/orchestrator/parliament.js';
import { ATTENTE_RELECTEUR_ABSENT_MS } from '../src/orchestrator/scheduler.js';
import { BUDGET_CRITIQUE } from '../src/orchestrator/server.js';
import {
  AGENTS_SANS_AVIS,
  OBJECTIONS_MAX,
  RELECTEURS_PAR_PRODUCTION,
} from '../src/shared/contre-expertise.js';
import { MAX_ATTEMPTS } from '../src/shared/types.js';
import type { HiveEvent, TaskResult } from '../src/shared/types.js';
import {
  ISSUES_A_TRANCHER,
  ISSUES_CONSEIL,
  JUSTIFICATION_MAX,
  RAISON_REVUE_MAX,
  RAISONS_EN_SUSPENS,
  RAISONS_REFUS_RENVOI,
  TYPES_WAR_ROOM,
  entreesWarRoom,
  familleDe,
} from '../src/shared/war-room.js';

const DOCUMENTS = {
  fr: new URL('../docs/PROTOCOLE-DEBAT.md', import.meta.url),
  en: new URL('../docs/PROTOCOLE-DEBAT.en.md', import.meta.url),
} as const;

/** Les lignes d'un tableau encadré, en cellules — en-tête et séparateur retirés. */
function bloc(doc: string, nom: string): string[][] {
  const debut = doc.indexOf(`<!-- verifie:${nom} -->`);
  const fin = doc.indexOf(`<!-- /verifie:${nom} -->`);
  if (debut < 0 || fin < debut) throw new Error(`bloc « ${nom} » absent ou mal fermé`);
  const lignes = doc
    .slice(debut, fin)
    .split('\n')
    .filter((l) => l.trim().startsWith('|'));
  return lignes.slice(2).map((l) =>
    l
      .trim()
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim()),
  );
}

/** `nom` entre accents graves → `nom`. Une cellule sans eux reste telle quelle. */
const code = (cellule: string): string => cellule.replace(/^`(.*)`$/, '$1');

/** oui/yes → vrai, non/no → faux ; tout autre mot est une faute du document. */
function booleen(cellule: string): boolean {
  if (cellule === 'oui' || cellule === 'yes') return true;
  if (cellule === 'non' || cellule === 'no') return false;
  throw new Error(`« ${cellule} » n'est ni oui/yes ni non/no`);
}

/** Les constantes que le protocole cite, telles que le code les porte. */
const CONSTANTES: Record<string, string> = {
  VERSION_CONSEIL: String(VERSION_CONSEIL),
  QUORUM_ECLAIREUSES: String(QUORUM_ECLAIREUSES),
  DIVERSITE_MIN: String(DIVERSITE_MIN),
  POIDS_ARRET: String(POIDS_ARRET),
  DEMI_VIE_TOURS: String(DEMI_VIE_TOURS),
  TOURS_MAX: String(TOURS_MAX),
  TOURS_SECS: String(TOURS_SECS),
  LENTILLES: LENTILLES.map((l) => l.cle).join(', '),
  VERIFICATRICES_PAR_PROPOSITION: String(VERIFICATRICES_PAR_PROPOSITION),
  CONSEILS_CONSERVES: String(CONSEILS_CONSERVES),
  JUSTIFICATION_MAX: String(JUSTIFICATION_MAX),
  RELECTEURS_PAR_PRODUCTION: String(RELECTEURS_PAR_PRODUCTION),
  AGENTS_SANS_AVIS: AGENTS_SANS_AVIS.join(', '),
  OBJECTIONS_MAX: String(OBJECTIONS_MAX),
  ATTENTE_RELECTEUR_ABSENT_MS: String(ATTENTE_RELECTEUR_ABSENT_MS),
  MAX_ATTEMPTS: String(MAX_ATTEMPTS),
  VERSION_EVALUATOR: String(VERSION_EVALUATOR),
  'BORNES_CRITIQUE.objections': String(BORNES_CRITIQUE.objections),
  'BORNES_CRITIQUE.objection': String(BORNES_CRITIQUE.objection),
  'BORNES_CRITIQUE.raisons': String(BORNES_CRITIQUE.raisons),
  'BORNES_CRITIQUE.raison': String(BORNES_CRITIQUE.raison),
  'BORNES_CRITIQUE.note': String(BORNES_CRITIQUE.note),
  BUDGET_CRITIQUE: String(BUDGET_CRITIQUE),
  RAISON_REVUE_MAX: String(RAISON_REVUE_MAX),
};

// ─── Les règles de l'Evaluator, jouées ────────────────────────────────────────

const resultat = (success = true): TaskResult => ({
  taskId: 't',
  nodeId: 'n1',
  diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-a\n+b',
  logs: '',
  success,
  durationMs: 12,
  subAgents: [],
});

const contreRevue = (decision: 'appliquer' | 'ameliorer'): CrossReviewEvidence => ({
  source: 'hive_counter_review',
  taskId: 't',
  resultId: 1,
  status: decision === 'ameliorer' ? 'improvement_required' : 'applied',
  decision,
  reviewers: [
    {
      relectureTaskId: 'r-1',
      reviewerNodeId: 'n2',
      reviewerAgent: 'codex',
      producerAgent: 'claude-code',
      decision,
      reason: decision === 'ameliorer' ? 'le cas vide n’est pas traité' : '',
      recordedAt: 1,
    },
  ],
  objections: decision === 'ameliorer' ? ['le cas vide n’est pas traité'] : [],
  reviewerCount: 1,
  contestingReviewers: decision === 'ameliorer' ? 1 : 0,
  approvingReviewers: decision === 'appliquer' ? 1 : 0,
  recordedAt: 1,
});

const VALIDATIONS = {
  tests: 'passed',
  typecheck: 'passed',
  build: 'passed',
  lint: 'passed',
} as const;

/** La production que tout accepte : chaque scénario en retire UNE chose. */
const accepte: EvaluatorInput = {
  taskId: 't',
  taskStatus: 'done',
  results: [resultat()],
  inspection: { verdict: 'clean', score: 0, griefs: [] },
  validation: VALIDATIONS,
  crossReview: contreRevue('appliquer'),
};

/** Deux familles ont élu une AUTRE production que celle qu'on juge. */
const autreElue = tally(
  ['codex', 'hermes-agent'].map((agentType, i) => ({
    nodeId: `v${i}`,
    agentType,
    success: true,
    signature: signatureOf('une autre production'),
    fichiers: ['src/a.ts'],
  })),
);

/** Une entrée par ligne du tableau, dans l'ordre de `evaluate()`. */
const SCENARIOS: readonly EvaluatorInput[] = [
  { ...accepte, results: [] },
  { ...accepte, results: [resultat(false)] },
  { ...accepte, inspection: { verdict: 'hollow', score: 3, griefs: [] } },
  { ...accepte, inspection: { verdict: 'suspect', score: 1, griefs: [] } },
  { ...accepte, humanReview: 'rejected' },
  { ...accepte, inspection: undefined },
  { ...accepte, consensus: autreElue },
  { ...accepte, crossReview: contreRevue('ameliorer') },
  { ...accepte, validation: { ...VALIDATIONS, tests: 'failed' } },
  // Sans avis, sans preuve : la relecture impossible passe AVANT les preuves.
  { ...accepte, crossReview: undefined, validation: undefined, crossReviewImpossible: 'annulée' },
  { ...accepte, validation: { ...VALIDATIONS, lint: undefined } },
  { ...accepte, crossReviewPending: 1 },
  { ...accepte, crossReview: undefined },
  accepte,
];

// ─── Le journal : une ligne lisible par type ─────────────────────────────────

const EXEMPLES: Record<(typeof TYPES_WAR_ROOM)[number], Record<string, unknown>> = {
  council_opened: { sessionId: 's' },
  council_proposal: { sessionId: 's', propositionId: 'p', nodeId: 'n', tour: 1 },
  council_review: { sessionId: 's', propositionId: 'p', nodeId: 'n', type: 'soutien', tour: 1 },
  council_round: { sessionId: 's', tour: 1, taches: 3 },
  council_closed: { sessionId: 's', issue: 'depart' },
  council_decided: {
    sessionId: 's',
    propositionId: null,
    justification: 'aucune piste ne tient',
    par: { genre: 'jeton_de_ruche' },
  },
  contre_expertise: { taskId: 't', possible: false },
  contre_expertise_verdict: { taskId: 't', relecteur: 'codex', conteste: false },
  contre_expertise_review_failed: { taskId: 't', relecteur: 'codex', terminal: true },
  contre_expertise_impossible: { taskId: 't', cause: 'plus aucune famille' },
  task_retry: { taskId: 't', source: 'evaluator', decision: 'correction_required' },
  evaluator_retry_skipped: { taskId: 't', reason: 'attempts_exhausted' },
  task_reviewed: { taskId: 't', state: 'approved' },
  evaluator_overridden: { taskId: 't', geste: 'fusion', raison: 'relu', parUserId: null },
};

describe.each(Object.entries(DOCUMENTS))('docs/PROTOCOLE-DEBAT — %s', (_langue, fichier) => {
  const doc = readFileSync(fichier, 'utf8');

  it('CHAQUE CONSTANTE CITÉE A LA VALEUR DU CODE — et aucune ne manque', () => {
    const lues = Object.fromEntries(
      bloc(doc, 'constantes').map(([nom, valeur]) => [code(nom!), valeur]),
    );
    expect(lues).toEqual(CONSTANTES);
  });

  it('CHAQUE ISSUE DU CONSEIL EST NOMMÉE, avec qui la tranche', () => {
    const lues = new Map(
      bloc(doc, 'issues').map(([issue, humain]) => [code(issue!), booleen(humain!)]),
    );
    expect([...lues.keys()].sort()).toEqual([...ISSUES_CONSEIL].sort());
    for (const [issue, humain] of lues) {
      expect(humain, issue).toBe(ISSUES_A_TRANCHER.has(issue as (typeof ISSUES_CONSEIL)[number]));
    }
  });

  it('CHAQUE RÈGLE DE L’EVALUATOR EST JOUÉE : son rang, sa décision, son renvoi', () => {
    const regles = bloc(doc, 'evaluator');
    expect(regles.map(([rang]) => Number(rang))).toEqual(SCENARIOS.map((_, i) => i + 1));
    regles.forEach(([rang, quand, decision, renvoi], i) => {
      const verdict = evaluate(SCENARIOS[i]!);
      expect(
        { decision: verdict.decision, renvoi: verdict.retryRecommended },
        `règle ${rang} — ${quand}`,
      ).toEqual({
        decision: code(decision!),
        renvoi: booleen(renvoi!),
      });
    });
  });

  it('LES PORTES DE CORRECTION SONT LES SOURCES DE LA CRITIQUE — toutes', () => {
    expect(
      bloc(doc, 'portes')
        .map(([source]) => code(source!))
        .sort(),
    ).toEqual([...SOURCES_CRITIQUE].sort());
  });

  it('CHAQUE REFUS DU SCHEDULER EST DIT, et seuls ceux qui laissent l’objection ouvrent un désaccord', () => {
    const lus = new Map(
      bloc(doc, 'refus').map(([refus, ouvre]) => [code(refus!), booleen(ouvre!)]),
    );
    expect([...lus.keys()].sort()).toEqual([...RAISONS_REFUS_RENVOI].sort());
    for (const [refus, ouvre] of lus) {
      expect(ouvre, refus).toBe((RAISONS_EN_SUSPENS as ReadonlySet<string>).has(refus));
    }
  });

  it('CHAQUE ÉVÉNEMENT QUE LA WAR ROOM LIT EST DIT, avec sa voix', () => {
    const lus = bloc(doc, 'journal').map(([type, , voix]) => [code(type!), code(voix!)] as const);
    expect(lus.map(([type]) => type).sort()).toEqual([...TYPES_WAR_ROOM].sort());
    let id = 1;
    for (const [type, voix] of lus) {
      const exemple: HiveEvent = {
        id: id++,
        ts: 1,
        type,
        payload: EXEMPLES[type as keyof typeof EXEMPLES],
      };
      const [entree] = entreesWarRoom([exemple]);
      expect(entree, `${type} : l’exemple du banc doit être lisible`).toBeDefined();
      expect(familleDe(entree!), type).toBe(voix);
    }
  });
});

it('LA RAISON D’UNE REVUE A UNE SEULE BORNE — à la route, dans la critique, à la relecture', () => {
  // La route borne à `RAISON_REVUE_MAX` (alias `MAX_RAISON_REVUE`, server.ts),
  // la critique figée à `BORNES_CRITIQUE.note` : deux bornes différentes
  // tronqueraient en silence la raison d'un humain entre l'écran et l'ouvrière.
  expect(BORNES_CRITIQUE.note).toBe(RAISON_REVUE_MAX);
});
