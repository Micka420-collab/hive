// LA BOUCLE HIVE → HIVE (V3) — Hive se confie une mission sur SON PROPRE dépôt,
// la fait passer par des ouvrières isolées, et ouvre une pull request portant
// son rapport de risques. Jamais plus.
//
// ─── LE PARCOURS ────────────────────────────────────────────────────────────
//
//   mission (l'humain)
//     │
//     ├─ 1. ARCHITECTURE    une ouvrière étudie le dépôt, écrit une note
//     ├─ 2. IMPLÉMENTATION  une autre l'implémente, tests compris, sur son clone
//     │        └─ relecture croisée par une AUTRE famille (contre-expertise)
//     ├─ 3. QA              une troisième rejoue le diff, lance les validations,
//     │                     écrit ce qu'elle a vu
//     ├─ 4. PORTE           changements sensibles ⇒ ARRÊT, validation humaine
//     ├─ 5. LIVRAISON       branche `hive/<tâche>` + PR vers main, par la Reine
//     └─ 6. RAPPORT         commentaire de la PR : risques, preuves, verdicts
//
// Chaque ouvrière travaille sur un clone neuf, dans son atelier, sur sa
// branche (`workspace.ts`) : rien n'est poussé sur main, et la Reine livre par
// l'API Git Data sans jamais cloner (`livraison.ts`). Les phases se suivent
// parce que chacune LIT la précédente : la note d'architecture entre dans le
// prompt de l'implémentation, le diff de l'implémentation dans celui de la QA —
// en bloc de données, jamais comme consigne (`donnees-non-fiables.ts`).
//
// ─── CE QUE LA BOUCLE NE PEUT PAS FAIRE ─────────────────────────────────────
//
// Elle ne FUSIONNE jamais : son transport n'a pas de méthode de fusion. Elle
// n'ÉLARGIT jamais ses permissions : elle ne règle pas l'autonomie, ne touche
// pas aux revues, et refuse de continuer si le projet est au-delà de
// `propose` (à `gouverne`, la Reine livrerait seule une production approuvée,
// hors de la porte). Elle ne PASSE jamais OUTRE : aucun `forcer` sur un refus
// de l'Evaluator, et un refus humain arrête la production pour de bon. Le
// transport lui-même le porte (`RucheBoucle`) : ce qu'il n'expose pas, la
// boucle ne peut pas le demander, et un banc relit la source du coureur.
//
// ─── ELLE NE DÉPENSE PAS SANS QU'ON LE LUI DISE ─────────────────────────────
//
// Sans `creer` (le `--oui` du coureur), elle ne fait que LIRE : l'état de la
// ruche, sa capacité à livrer, et ce qu'elle ferait. Chaque écriture — projet,
// tâche, livraison — exige `--oui`, reprise comprise. Ce qui rendrait la
// mission impossible (une seule famille d'agents : pas de relecture croisée ;
// aucun jeton GitHub : ni livraison ni rapport) se dit AVANT de dépenser.
//
// ─── ELLE S'ARRÊTE, ET SE REPREND ───────────────────────────────────────────
//
// Arrêtée à la porte, elle rend la main : l'humain relit la production dans la
// Miellerie, l'approuve ou la refuse, puis relance avec `--reprendre <projet>`.
// La reprise retrouve les phases par leurs identifiants (`v3-<graine>-<rôle>`),
// ne recrée rien de ce qui existe, et rejuge tout — la porte comprise.

import { randomUUID } from 'node:crypto';
import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { analyserRustine } from '../orchestrator/rustine.js';
import { depotDepuisUrl } from '../orchestrator/livraison.js';
import type { Caviardeur } from '../shared/caviardage.js';
import { SURFACES_SENSIBLES, jugerDiff, porteDeLivraison, validationHumaine } from './garde.js';
import type { EvenementJournal, VerdictGarde } from './garde.js';
import { lireEvaluation, rapportDeRisques } from './rapport.js';
import type { EvaluationLue, PhaseRapportee } from './rapport.js';
import {
  CATEGORIES,
  MISSION_MAX,
  MISSION_MIN,
  PREFIXE_MISSION,
  noteDe,
  promptArchitecture,
  promptImplementation,
  promptQa,
} from './prompts.js';

/** Le dépôt de Hive : la cible par défaut d'une boucle qui améliore Hive. */
export const DEPOT_HIVE = 'https://github.com/Micka420-collab/hive';

/** Une phase peut faire travailler un vrai agent longtemps : trente minutes. */
export const PATIENCE_PHASE_S = 1800;

/** Un relevé toutes les cinq secondes : une phase dure des minutes. */
export const PAS_RELEVE_MS = 5000;

/** Au-delà, le diff ne tient pas dans le prompt de la QA (`LIMITS.prompt`, 100 000). */
export const DIFF_QA_MAX = 60_000;

/** Borne de la note d'architecture recopiée dans le prompt de l'implémentation. */
export const NOTE_MAX = 8_000;

/** Pages de journal lues au plus pour chercher une validation (1 000 événements chacune). */
const PAGES_JOURNAL_MAX = 200;

export type Role = 'architecture' | 'implementation' | 'qa';

/** L'identifiant d'une phase : c'est lui qui la retrouve à la reprise. */
export const idPhase = (graine: string, role: Role) => `v3-${graine}-${role}`;

/** Une réponse de la ruche : un statut 0 dit que la ruche n'a pas répondu. */
export interface Reponse {
  status: number;
  corps: unknown;
  texte: string;
}

export interface TacheACreer {
  id: string;
  title: string;
  prompt: string;
}

/**
 * Tout ce que la boucle peut demander à la ruche — et RIEN d'autre. Pas de
 * fusion, pas de revue, pas d'autonomie, pas de forçage : ce qui n'est pas
 * ici n'existe pas pour elle.
 */
export interface RucheBoucle {
  /** GET /api/state */
  instantane(): Promise<Reponse>;
  /** Un GET authentifié. */
  lire(chemin: string): Promise<Reponse>;
  /** POST /api/projects */
  creerProjet(corps: { name: string; repoUrl: string }): Promise<Reponse>;
  /** POST /api/projects/:projectId/tasks — une tâche à la fois. */
  creerTache(projetId: string, tache: TacheACreer): Promise<Reponse>;
  /** POST /api/livraison `{ taskId, resultId }` — la production EXACTE jugée. */
  livrer(taskId: string, resultId: number): Promise<Reponse>;
  patienter(ms: number): Promise<void>;
}

/** Le rapport part en commentaire de la PR — la seule écriture GitHub de la boucle. */
export interface GithubBoucle {
  commenter(depot: string, pr: number, corps: string): Promise<{ status: number }>;
}

export interface OptionsBoucle {
  creer: boolean;
  depot: string;
  mission?: string;
  reprendre?: string;
  patienceS?: number;
  graine?: string;
}

export type IssueBoucle =
  | { issue: 'plan'; message: string }
  | { issue: 'echec'; raison: string; projetId?: string }
  | {
      issue: 'validation_requise';
      projetId: string;
      taskId: string;
      garde: VerdictGarde;
      message: string;
    }
  | { issue: 'refus_humain'; projetId: string; taskId: string; message: string }
  | {
      issue: 'livree';
      projetId: string;
      pr: number;
      urlPr: string;
      rapport: string;
      commentaire: 'attache' | 'echoue';
      detail: string;
    };

const echec = (raison: string, projetId?: string): IssueBoucle => ({
  issue: 'echec',
  raison,
  ...(projetId ? { projetId } : {}),
});

const enregistrement = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const liste = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(enregistrement) : [];

// ─── Les drapeaux ─────────────────────────────────────────────────────────────

const DRAPEAUX = new Map<string, boolean>([
  ['--racine', true],
  ['--mission', true],
  ['--oui', false],
  ['--depot', true],
  ['--patience', true],
  ['--reprendre', true],
]);

export type ArgumentsBoucle = (OptionsBoucle & { racine: string }) | { erreur: string };

/**
 * Les options de la boucle, lues dans `argv`. Un drapeau inconnu est une
 * erreur : `--ouii` ignoré en silence ferait croire à une mission confiée.
 */
export function argumentsDeLaBoucle(argv: readonly string[]): ArgumentsBoucle {
  const vus = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const drapeau = argv[i] ?? '';
    const prendValeur = DRAPEAUX.get(drapeau);
    if (prendValeur === undefined) return { erreur: `argument inconnu : ${drapeau}` };
    if (!prendValeur) {
      vus.set(drapeau, true);
      continue;
    }
    const valeur = argv[i + 1];
    if (valeur === undefined || valeur.startsWith('--')) {
      return { erreur: `${drapeau} attend une valeur` };
    }
    vus.set(drapeau, valeur);
    i++;
  }
  const texte = (d: string) => {
    const v = vus.get(d);
    return typeof v === 'string' ? v : undefined;
  };
  const racine = texte('--racine');
  if (!racine) return { erreur: '--racine est obligatoire' };
  // Sur UNE ligne : la reprise relit la mission dans le prompt, ligne par ligne.
  const brute = texte('--mission');
  const mission = brute === undefined ? undefined : champSurUneLigne(brute, MISSION_MAX + 1).trim();
  const reprendre = texte('--reprendre');
  if (mission !== undefined && reprendre !== undefined) {
    return { erreur: '--mission et --reprendre s’excluent : une reprise garde sa mission' };
  }
  if (reprendre === undefined) {
    if (mission === undefined) return { erreur: '--mission (ou --reprendre) est obligatoire' };
    if (mission.length < MISSION_MIN || mission.length > MISSION_MAX) {
      return { erreur: `--mission attend de ${MISSION_MIN} à ${MISSION_MAX} caractères` };
    }
  }
  const depot = texte('--depot') ?? DEPOT_HIVE;
  // L'URL refusée n'est pas recopiée : elle peut porter un jeton.
  if (depotDepuisUrl(depot) === null) {
    return {
      erreur: '--depot attend l’URL https d’un dépôt GitHub (https://github.com/<owner>/<repo>)',
    };
  }
  const patience = texte('--patience');
  const patienceS = patience === undefined ? undefined : Number(patience);
  if (patienceS !== undefined && (!Number.isFinite(patienceS) || patienceS <= 0)) {
    return { erreur: '--patience attend un nombre de secondes positif' };
  }
  return {
    racine,
    creer: vus.has('--oui'),
    depot,
    ...(mission !== undefined ? { mission } : {}),
    ...(reprendre !== undefined ? { reprendre } : {}),
    ...(patienceS !== undefined ? { patienceS } : {}),
  };
}

// ─── Lire la ruche ────────────────────────────────────────────────────────────

/**
 * Les ouvrières en ligne dont l'agent n'est ni une simulation, ni un agent
 * que son nœud dit non connecté (même règle que la preuve V2 Alpha,
 * `scripts/preuve-v2-alpha-pas.mjs`).
 */
export function ouvrieresReelles(instantane: unknown): Record<string, unknown>[] {
  return liste(enregistrement(instantane).nodes).filter((n) => {
    const nonConnecte = liste(n.outils).some(
      (o) => o.agent === n.agentType && o.binaire === true && o.cle === 'absente',
    );
    return n.status === 'online' && n.agentType !== 'shell' && !nonConnecte;
  });
}

/**
 * L'autonomie du projet est-elle bornée à `off` ou `propose` ? Au-delà, la
 * Reine livre (`gouverne`) ou fusionne (`plein`) seule une production
 * approuvée — hors de cette porte. Illisible : on ne suppose pas.
 */
async function autonomieBornee(ruche: RucheBoucle, projetId: string): Promise<string | null> {
  const r = await ruche.lire(`/api/projects/${encodeURIComponent(projetId)}/essaim`);
  const e = enregistrement(r.corps);
  if (r.status !== 200 || typeof e.niveau !== 'string') {
    return `autonomie du projet illisible (${r.status}) : la boucle ne suppose pas qu’elle est bornée`;
  }
  if ((e.niveau !== 'off' && e.niveau !== 'propose') || e.depotInscrit === true) {
    return (
      `le projet ${projetId} est réglé « ${e.niveau} »${e.depotInscrit === true ? ', dépôt inscrit' : ''} : ` +
      'la Reine y livrerait seule, hors de la porte des changements sensibles. Ramenez-le à « off » ' +
      'ou « propose » — la boucle ne règle jamais l’autonomie elle-même'
    );
  }
  return null;
}

/** Les événements qui décident d'une validation humaine, lus depuis le début du journal. */
async function lireJournal(ruche: RucheBoucle): Promise<EvenementJournal[] | null> {
  const gardes: EvenementJournal[] = [];
  let curseur = 0;
  for (let page = 0; page < PAGES_JOURNAL_MAX; page++) {
    const r = await ruche.lire(`/api/events?since=${curseur}&limit=1000`);
    if (r.status !== 200 || !Array.isArray(r.corps)) return null;
    const avant = curseur;
    for (const brut of r.corps) {
      const e = enregistrement(brut);
      if (typeof e.id !== 'number' || e.id <= curseur || typeof e.type !== 'string') continue;
      curseur = e.id;
      if (e.type === 'task_done' || e.type === 'task_reviewed') {
        gardes.push({ id: e.id, type: e.type, payload: e.payload });
      }
    }
    if (r.corps.length < 1000) return gardes;
    if (curseur === avant) return null;
  }
  return null;
}

type Reglee =
  | { etat: 'reglee'; statut: 'done' | 'failed'; evaluation: EvaluationLue | null }
  | { etat: 'attente'; pourquoi: string }
  | { etat: 'absente' };

/**
 * Une phase est RÉGLÉE quand elle a échoué, ou quand elle est `done` sans
 * relecture en vol pour sa production (`crossReviewPending` de l'Evaluator —
 * la relecture est lancée dans le geste même qui la termine, et un retry la
 * repasse en `ready`).
 */
async function releverPhase(
  ruche: RucheBoucle,
  taskId: string,
): Promise<Reglee | { erreur: string }> {
  const etat = await ruche.instantane();
  if (etat.status !== 200) return { erreur: `l’instantané rend ${etat.status}` };
  const tache = liste(enregistrement(etat.corps).tasks).find((t) => t.id === taskId);
  if (!tache) return { etat: 'absente' };
  const evaluation = lireEvaluation(
    (await ruche.lire(`/api/tasks/${encodeURIComponent(taskId)}/evaluation`)).corps,
  );
  if (tache.status === 'failed') return { etat: 'reglee', statut: 'failed', evaluation };
  if (tache.status !== 'done')
    return { etat: 'attente', pourquoi: `${taskId} ${String(tache.status)}` };
  if (!evaluation) return { etat: 'attente', pourquoi: `${taskId} : évaluation illisible` };
  if (evaluation.relecturesEnVol > 0) {
    return {
      etat: 'attente',
      pourquoi: `${taskId} : ${evaluation.relecturesEnVol} relecture(s) en vol`,
    };
  }
  return { etat: 'reglee', statut: 'done', evaluation };
}

/** La dernière production de la tâche — celle que la Reine livrerait. */
async function derniereProduction(
  ruche: RucheBoucle,
  taskId: string,
): Promise<{ resultId: number; diff: string } | null> {
  const r = await ruche.lire(`/api/tasks/${encodeURIComponent(taskId)}/results`);
  const derniere = Array.isArray(r.corps) ? enregistrement(r.corps.at(-1)) : {};
  if (
    derniere.success !== true ||
    typeof derniere.resultId !== 'number' ||
    typeof derniere.diff !== 'string' ||
    derniere.diff.trim() === ''
  ) {
    return null;
  }
  return { resultId: derniere.resultId, diff: derniere.diff };
}

/** Les lignes AJOUTÉES du fichier `chemin` dans `diff` — la note d'une ouvrière. */
export function noteDansDiff(diff: string, chemin: string): string | null {
  try {
    const fichier = analyserRustine(diff).fichiers.find((f) => f.chemin === chemin);
    if (!fichier) return null;
    const texte = fichier.hunks
      .flatMap((h) => h.lignes)
      .filter((l) => l.signe === '+')
      .map((l) => l.texte)
      .join('\n')
      .trim();
    return texte === '' ? null : texte;
  } catch {
    return null;
  }
}

// ─── La séquence ──────────────────────────────────────────────────────────────

/** Les verdicts de l'Evaluator qui arrêtent une production (cf. `VERDICTS_BLOQUANTS`, server.ts). */
const BLOQUANTS = new Set(['correction_required', 'rejected']);

export async function menerLaBoucle(
  ruche: RucheBoucle,
  github: GithubBoucle | null,
  caviardeur: Caviardeur,
  options: OptionsBoucle,
): Promise<IssueBoucle> {
  const depot = depotDepuisUrl(options.depot);
  if (!depot) return echec('dépôt hors GitHub : la Reine ne livre que là');
  const patience = options.patienceS ?? PATIENCE_PHASE_S;

  // ─── AVANT DE DÉPENSER : ce qui rendrait la mission impossible ─────────────
  const debut = await ruche.instantane();
  if (debut.status !== 200) return echec(`l’instantané rend ${debut.status} : ${debut.texte}`);
  const reelles = ouvrieresReelles(debut.corps);
  const familles = new Set(reelles.map((n) => String(n.agentType)));
  const nommees = reelles
    .map((n) => `${String(n.name ?? n.id)} (${String(n.agentType)})`)
    .join(', ');
  if (familles.size < 2) {
    return echec(
      `il faut des ouvrières réelles de 2 familles au moins — la relecture croisée en dépend ; ` +
        `en ligne : ${nommees || 'aucune'}`,
    );
  }
  const statutGithub = await ruche.lire('/api/github/status');
  if (statutGithub.status !== 200 || enregistrement(statutGithub.corps).configure !== true) {
    return echec(
      'la Reine ne peut pas livrer : définissez HIVE_GITHUB_TOKEN dans son environnement et relancez-la',
    );
  }
  if (!github) {
    return echec(
      'la boucle ne pourrait pas joindre son rapport de risques à la PR : HIVE_GITHUB_TOKEN ' +
        'absent de son environnement et du .env de la ruche',
    );
  }

  // ─── LE PROJET : neuf, ou repris ────────────────────────────────────────────
  let projetId: string;
  let graine: string;
  let mission: string;
  const taches = liste(enregistrement(debut.corps).tasks);
  if (options.reprendre) {
    projetId = options.reprendre;
    const projet = liste(enregistrement(debut.corps).projects).find((p) => p.id === projetId);
    if (!projet) return echec(`projet ${projetId} inconnu de la ruche`);
    const archi = taches.find(
      (t) => t.projectId === projetId && /^v3-[0-9a-f]{8}-architecture$/.test(String(t.id)),
    );
    if (!archi)
      return echec(`le projet ${projetId} n’est pas une boucle V3 (aucune phase d’architecture)`);
    graine = String(archi.id).slice(3, 11);
    // La mission ENTIÈRE est dans le prompt de l'architecte (le titre est borné).
    const ligneMission = String(archi.prompt)
      .split('\n')
      .find((l) => l.startsWith(PREFIXE_MISSION));
    if (!ligneMission) return echec(`la phase ${String(archi.id)} ne dit plus sa mission`);
    mission = ligneMission.slice(PREFIXE_MISSION.length);
    const bornee = await autonomieBornee(ruche, projetId);
    if (bornee) return echec(bornee, projetId);
  } else {
    graine = options.graine ?? randomUUID().replaceAll('-', '').slice(0, 8);
    mission = options.mission ?? '';
    if (!options.creer) {
      return {
        issue: 'plan',
        message:
          `prête : ${reelles.length} ouvrière(s) réelle(s) de ${familles.size} famille(s) — ${nommees}. ` +
          `Relancez avec --oui pour confier la mission sur ${depot} : architecture, implémentation ` +
          '(relue par une autre famille), QA, puis la porte des changements sensibles ' +
          `(${SURFACES_SENSIBLES.length} surfaces : ${CATEGORIES}) avant toute pull request. ` +
          'Elle fait travailler de vrais agents, donc consomme des crédits de leurs comptes. ' +
          'La boucle ne fusionne jamais.',
      };
    }
    const projet = await ruche.creerProjet({
      name: `Boucle V3 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      repoUrl: options.depot,
    });
    const id = enregistrement(projet.corps).id;
    if (projet.status !== 201 || typeof id !== 'string') {
      return echec(`la ruche refuse le projet (${projet.status}) : ${projet.texte}`);
    }
    projetId = id;
    const bornee = await autonomieBornee(ruche, projetId);
    if (bornee) return echec(bornee, projetId);
  }
  const reprise = ` — reprenez avec --reprendre ${projetId}`;

  /** Confie la phase si elle n'existe pas, puis attend qu'elle soit réglée. */
  const phase = async (
    role: Role,
    prompt: () => string,
  ): Promise<{ statut: 'done' | 'failed'; evaluation: EvaluationLue | null } | IssueBoucle> => {
    const taskId = idPhase(graine, role);
    let releve = await releverPhase(ruche, taskId);
    if ('erreur' in releve) return echec(releve.erreur + reprise, projetId);
    if (releve.etat === 'absente') {
      if (!options.creer) {
        return {
          issue: 'plan',
          message: `phase ${role} à confier sur le projet ${projetId} : relancez avec --oui --reprendre ${projetId}`,
        };
      }
      const cree = await ruche.creerTache(projetId, {
        id: taskId,
        title: `Boucle V3 — ${role} : ${mission}`.slice(0, 200),
        prompt: prompt(),
      });
      if (cree.status !== 201 && cree.status !== 200) {
        return echec(`la ruche refuse la phase ${role} (${cree.status}) : ${cree.texte}`, projetId);
      }
    }
    for (let attendu = 0; ; attendu += PAS_RELEVE_MS / 1000) {
      releve = await releverPhase(ruche, taskId);
      if ('erreur' in releve) return echec(releve.erreur + reprise, projetId);
      if (releve.etat === 'absente')
        return echec(`phase ${role} absente de l’instantané${reprise}`, projetId);
      if (releve.etat === 'reglee') return { statut: releve.statut, evaluation: releve.evaluation };
      if (attendu >= patience) {
        return echec(
          `phase ${role} non réglée après ${patience} s — ${releve.pourquoi}${reprise}`,
          projetId,
        );
      }
      await ruche.patienter(PAS_RELEVE_MS);
    }
  };
  const estIssue = (v: object): v is IssueBoucle => 'issue' in v;

  // ─── 1. ARCHITECTURE ────────────────────────────────────────────────────────
  const archi = await phase('architecture', () => promptArchitecture(mission, graine));
  if (estIssue(archi)) return archi;
  const idArchi = idPhase(graine, 'architecture');
  const prodArchi = archi.statut === 'done' ? await derniereProduction(ruche, idArchi) : null;
  const note = prodArchi ? noteDansDiff(prodArchi.diff, noteDe(graine, 'architecture')) : null;
  if (!note) {
    return echec(
      `l’architecte n’a pas rendu sa note (${noteDe(graine, 'architecture')}, phase ${archi.statut}) : ` +
        'rien à implémenter',
      projetId,
    );
  }

  // ─── 2. IMPLÉMENTATION ──────────────────────────────────────────────────────
  const impl = await phase('implementation', () =>
    promptImplementation(mission, note.slice(0, NOTE_MAX)),
  );
  if (estIssue(impl)) return impl;
  const idImpl = idPhase(graine, 'implementation');
  const production = impl.statut === 'done' ? await derniereProduction(ruche, idImpl) : null;
  if (!production) {
    return echec(
      `l’implémentation n’a rendu aucune production réussie (phase ${impl.statut})`,
      projetId,
    );
  }
  if (impl.evaluation && BLOQUANTS.has(impl.evaluation.decision)) {
    return echec(
      `l’Evaluator arrête l’implémentation (« ${impl.evaluation.decision} ») : la boucle ne passe ` +
        'jamais outre — faites-la corriger, puis reprenez',
      projetId,
    );
  }

  // ─── 3. QA ──────────────────────────────────────────────────────────────────
  let qa: PhaseRapportee;
  if (production.diff.length > DIFF_QA_MAX) {
    qa = {
      taskId: null,
      statut: 'non_lancee',
      evaluation: null,
      note: null,
      pourquoi: `diff de ${production.diff.length} signes, au-delà de ce qu’un prompt de QA porte (${DIFF_QA_MAX})`,
    };
  } else {
    const idQa = idPhase(graine, 'qa');
    const fin = await phase('qa', () => promptQa(mission, graine, production.diff));
    if (estIssue(fin)) return fin;
    const prodQa = fin.statut === 'done' ? await derniereProduction(ruche, idQa) : null;
    qa = {
      taskId: idQa,
      statut: fin.statut,
      evaluation: fin.evaluation,
      note: prodQa ? noteDansDiff(prodQa.diff, noteDe(graine, 'qa')) : null,
    };
  }

  // ─── 4. LA PORTE DES CHANGEMENTS SENSIBLES ──────────────────────────────────
  //
  // Relue ICI, après la QA : une revue humaine a pu tomber pendant ce temps.
  // Et la production jugée est RELUE, pas reprise d'avant la QA : c'est celle
  // que la Reine livrera, liée par son `resultId`.
  // Une revue humaine qui la refuse relance l'implémentation (retry de
  // l'Evaluator) : la porte ne juge qu'une production RÉGLÉE.
  const encore = await releverPhase(ruche, idImpl);
  if ('erreur' in encore || encore.etat !== 'reglee' || encore.statut !== 'done') {
    return echec(`l’implémentation n’est plus réglée au moment de la porte${reprise}`, projetId);
  }
  const jugee = await derniereProduction(ruche, idImpl);
  if (!jugee) return echec('la production de l’implémentation a disparu avant la porte', projetId);
  const garde = jugerDiff(jugee.diff);
  const evaluationImpl = lireEvaluation(
    (await ruche.lire(`/api/tasks/${encodeURIComponent(idImpl)}/evaluation`)).corps,
  );
  const journal = await lireJournal(ruche);
  const validation = journal
    ? validationHumaine(idImpl, journal, evaluationImpl?.revueHumaine)
    : evaluationImpl?.revueHumaine === 'rejected'
      ? 'refusee'
      : 'absente';
  const porte = porteDeLivraison(garde, validation);
  if (porte === 'refus_humain') {
    return {
      issue: 'refus_humain',
      projetId,
      taskId: idImpl,
      message:
        `un humain a refusé la production ${idImpl} : elle ne sera pas livrée. La boucle ne ` +
        'contourne jamais un refus — confiez une nouvelle mission si le besoin demeure.',
    };
  }
  if (porte === 'validation_requise') {
    const quoi =
      garde.etat === 'illisible'
        ? `diff illisible par la porte (${garde.motif ?? 'inconnu'})`
        : garde.touches.map((t) => `${t.chemin} [${t.categorie}]`).join(', ');
    return {
      issue: 'validation_requise',
      projetId,
      taskId: idImpl,
      garde,
      message:
        `ARRÊT à la porte des changements sensibles — ${quoi}. Relisez la production ${idImpl} ` +
        'dans la Miellerie et approuvez-la (ou refusez-la) : le geste est consigné au journal ' +
        `(task_reviewed). Puis relancez avec --oui --reprendre ${projetId}.` +
        (journal
          ? ''
          : ' Le journal de la Reine est illisible : aucune validation ne peut y être lue.'),
    };
  }

  // ─── 5. LIVRER ──────────────────────────────────────────────────────────────
  if (!options.creer) {
    return {
      issue: 'plan',
      message: `la production ${idImpl} passe la porte : relancez avec --oui --reprendre ${projetId} pour ouvrir la PR`,
    };
  }
  const encoreBornee = await autonomieBornee(ruche, projetId);
  if (encoreBornee) return echec(encoreBornee, projetId);
  const livree = await ruche.livrer(idImpl, jugee.resultId);
  const l = enregistrement(livree.corps);
  if (
    livree.status !== 201 ||
    typeof l.pr !== 'number' ||
    typeof l.urlPr !== 'string' ||
    typeof l.branche !== 'string' ||
    typeof l.commitSha !== 'string'
  ) {
    const code = typeof l.code === 'string' ? `${l.code} — ` : '';
    const erreur = typeof l.error === 'string' ? l.error : livree.texte;
    return echec(
      `la Reine refuse la livraison (${livree.status}) : ${code}${erreur}. La boucle ne force ` +
        'jamais : corrigez la cause, puis reprenez',
      projetId,
    );
  }

  // ─── 6. LE RAPPORT DE RISQUES ───────────────────────────────────────────────
  const rapport = rapportDeRisques(
    {
      mission,
      projetId,
      architecture: { taskId: idArchi, statut: archi.statut, evaluation: archi.evaluation, note },
      implementation: {
        taskId: idImpl,
        statut: 'done',
        evaluation: evaluationImpl,
        note: null,
        resultId: jugee.resultId,
        diff: jugee.diff,
      },
      qa,
      garde,
      validation,
      livraison: { pr: l.pr, urlPr: l.urlPr, branche: l.branche, commitSha: l.commitSha },
    },
    caviardeur,
  );
  const commentaire = await github.commenter(depot, l.pr, rapport);
  const attache = commentaire.status === 201;
  return {
    issue: 'livree',
    projetId,
    pr: l.pr,
    urlPr: l.urlPr,
    rapport,
    commentaire: attache ? 'attache' : 'echoue',
    detail: attache
      ? `rapport de risques joint à la PR #${l.pr}`
      : `la PR #${l.pr} est ouverte, mais GitHub refuse le rapport (${commentaire.status}) : ` +
        'collez-le à la main (ci-dessous)',
  };
}
