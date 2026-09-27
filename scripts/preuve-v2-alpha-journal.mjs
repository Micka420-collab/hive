// LE JOURNAL DE LA REINE, LU PAR LA PREUVE V2 ALPHA — ce qui dit qu'une
// mission est RÉGLÉE, et pas seulement « terminée ».
//
// ─── POURQUOI « TERMINÉE » NE SUFFISAIT PAS ─────────────────────────────────
//
// Une production passe `done` AVANT que sa contre-revue commence : le même
// geste de la Reine range le résultat, puis lance les relectures. Lire les
// faits à ce moment-là, c'était juger une évaluation qui n'avait encore
// entendu aucun relecteur — et une objection arrivée ensuite pouvait renvoyer
// la tâche en correction APRÈS que le rapport l'avait déclarée prouvée.
//
// Une production est donc RÉGLÉE quand :
//   · elle a échoué (rien ne la relancera sans geste humain) ; ou
//   · elle est `done`, et chaque relecture lancée pour CETTE production est
//     terminale (`done` ou `failed`) dans le MÊME instantané.
//
// Le second point porte aussi « aucun retry de l'Evaluator en attente » : le
// retry automatique est décidé dans le geste même qui termine la dernière
// relecture. Un instantané où la production est encore `done` alors que toutes
// ses relectures sont terminales a donc déjà vu cette décision — et elle n'a
// pas relancé. Une relance, elle, repasse la tâche en `ready`, donc non réglée.
//
// ─── POURQUOI LE JOURNAL, ET LU PAR MORCEAUX ────────────────────────────────
//
// Le lien « cette relecture vise CETTE production » n'existe que dans
// l'événement de lancement (`contre_expertise`, émis dans le même geste que le
// `task_done` qui le précède). La preuve le lit par `/api/events`, en avançant
// un curseur posé au bout du journal AVANT la création de la mission : elle ne
// relit jamais l'historique de la ruche, et garde en mémoire ce qu'elle a vu
// même si la Reine élague ensuite ses vieux événements.

/** Les événements que la preuve garde — les autres (progrès, logs…) passent. */
export const TYPES_RETENUS = new Set([
  'task_started',
  'task_done',
  'task_failed',
  'task_retry',
  'task_requeued',
  'task_cancelled',
  'contre_expertise',
  'contre_expertise_verdict',
  'contre_expertise_review_failed',
  'evaluator_retry_skipped',
  'delegation_created',
  'delegation_rejected',
]);

/** Le plafond d'une page de `/api/events` (`store.listEvents` borne à 1000). */
export const PAGE_JOURNAL = 1000;

const TERMINAUX = new Set(['done', 'failed']);

/**
 * Un lecteur incrémental du journal, au-dessus de `ruche.lire`.
 *
 *   · `amorcer()` pose le curseur au bout du journal existant, sans rien garder ;
 *   · `relever()` lit ce qui est arrivé depuis, garde les `TYPES_RETENUS`, et
 *     rend TOUT ce qui a été gardé depuis l'amorce (ou `null` si la lecture
 *     échoue : un journal illisible n'est pas un journal vide).
 */
export function lecteurJournal(ruche) {
  let curseur = 0;
  const gardes = [];
  const tirer = async (garder) => {
    for (;;) {
      const r = await ruche.lire(`/api/events?since=${curseur}&limit=${PAGE_JOURNAL}`);
      if (r.status !== 200 || !Array.isArray(r.corps)) return false;
      const avant = curseur;
      for (const e of r.corps) {
        if (typeof e?.id !== 'number' || e.id <= curseur) continue;
        curseur = e.id;
        if (garder && TYPES_RETENUS.has(e.type)) gardes.push(e);
      }
      if (r.corps.length < PAGE_JOURNAL) return true;
      // Une page pleine qui n'avance pas bouclerait à jamais : c'est une
      // réponse incohérente, dite comme un échec de lecture.
      if (curseur === avant) return false;
    }
  };
  return {
    amorcer: () => tirer(false),
    relever: async () => ((await tirer(true)) ? gardes : null),
  };
}

const charge = (e) => (e && typeof e.payload === 'object' && e.payload !== null ? e.payload : {});

/**
 * Les productions de la mission : les tâches confiées, plus les sous-tâches
 * que leurs ouvrières ont déléguées (à toute profondeur). Les relectures n'en
 * sont pas — elles se règlent avec la production qu'elles relisent.
 */
export function productionsDe(confiees, evenements) {
  const ids = new Set(confiees);
  let grandi = true;
  while (grandi) {
    grandi = false;
    for (const e of evenements) {
      if (e.type !== 'delegation_created') continue;
      const { parentTaskId, childTaskId } = charge(e);
      if (ids.has(parentTaskId) && typeof childTaskId === 'string' && !ids.has(childTaskId)) {
        ids.add(childTaskId);
        grandi = true;
      }
    }
  }
  return [...ids];
}

/** Toutes les relectures jamais lancées pour cette tâche, toutes tentatives confondues. */
export function relecturesDe(taskId, evenements) {
  const ids = [];
  for (const e of evenements) {
    const p = charge(e);
    if (e.type !== 'contre_expertise' || p.taskId !== taskId || !Array.isArray(p.relectures)) {
      continue;
    }
    for (const id of p.relectures) if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Ce qu'on attend encore de cette production, ou `null` quand elle est RÉGLÉE.
 *
 * `taches` est l'instantané (Map id → tâche) lu AVANT `evenements` : le journal
 * est donc au moins aussi frais que les statuts, et une relecture lancée après
 * l'instantané y manque — elle compte alors comme en vol, jamais comme finie.
 */
export function attenteDe(taskId, taches, evenements) {
  const tache = taches.get(taskId);
  if (!tache) return `${taskId} absente de l’instantané`;
  if (tache.status === 'failed') return null;
  if (tache.status !== 'done') return `${taskId} ${tache.status}`;

  let fin = null;
  for (const e of evenements) {
    if (e.type === 'task_done' && charge(e).taskId === taskId) fin = e;
  }
  if (!fin) return `${taskId} done, mais sa fin n’est pas au journal`;

  // Le lancement de CETTE production suit son `task_done` : ils sont émis dans
  // le même geste. Un lancement antérieur visait une tentative précédente.
  const lancement = evenements.find(
    (e) => e.id > fin.id && e.type === 'contre_expertise' && charge(e).taskId === taskId,
  );
  if (!lancement || charge(lancement).possible === false) return null;
  const relectures = Array.isArray(charge(lancement).relectures)
    ? charge(lancement).relectures.filter((id) => typeof id === 'string')
    : [];
  const enVol = relectures.filter((id) => !TERMINAUX.has(taches.get(id)?.status));
  if (enVol.length === 0) return null;
  return `${taskId} : contre-revue en cours (${relectures.length - enVol.length}/${relectures.length} rendue(s))`;
}
