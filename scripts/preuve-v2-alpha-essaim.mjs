// LE VERDICT DE L'ESSAIM — ce que plusieurs ouvrières ont RÉELLEMENT fait
// ensemble, relu dans le journal de la Reine.
//
// Le verdict d'une mission (`preuve-v2-alpha-verdict.mjs`) juge chaque tâche
// seule. Le jalon V2 Alpha demande en plus des faits qui n'existent qu'à
// PLUSIEURS : des ouvrières de familles différentes qui travaillent en même
// temps, une qui délègue à une autre, une qui relit l'autre, et une production
// reprise après une objection.
//
// Mêmes règles que le verdict d'une mission : `prouve` seulement sur le fait
// exact, `inconnu` quand le fait manque, `echec` quand il dit le contraire.
// Rien ici ne vient du récit d'un agent : chaque critère se lit dans les
// événements que la Reine a consignés, horodatés par SA propre horloge.

import { relecturesDe } from './preuve-v2-alpha-journal.mjs';
import { AGENTS_SIMULES } from './preuve-v2-alpha-verdict.mjs';

/** Ce qui clôt une exécution commencée par `task_started`. */
const FINS_EXECUTION = new Set([
  'task_done',
  'task_failed',
  'task_retry',
  'task_requeued',
  'task_cancelled',
]);

const charge = (e) => (e && typeof e.payload === 'object' && e.payload !== null ? e.payload : {});
const court = (texte, max = 120) => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);

/**
 * Les fenêtres d'exécution des tâches `ids` : du `task_started` au premier
 * événement qui clôt cette exécution. Une fenêtre sans fin consignée n'est pas
 * mesurable — elle est écartée plutôt que prolongée jusqu'à l'infini, ce qui
 * la ferait chevaucher tout ce qui suit.
 */
export function fenetresDe(ids, evenements) {
  const voulues = new Set(ids);
  const fenetres = [];
  for (const debut of evenements) {
    const p = charge(debut);
    if (debut.type !== 'task_started' || !voulues.has(p.taskId)) continue;
    const fin = evenements.find(
      (e) => e.id > debut.id && FINS_EXECUTION.has(e.type) && charge(e).taskId === p.taskId,
    );
    if (fin) fenetres.push({ taskId: p.taskId, nodeId: p.nodeId, debut: debut.ts, fin: fin.ts });
  }
  return fenetres;
}

/**
 * Le plus grand nombre d'ouvrières DISTINCTES en train d'exécuter au même
 * instant. Il suffit de regarder chaque début : un maximum de simultanéité
 * est toujours atteint au début d'une des fenêtres.
 */
export function simultaneiteMax(fenetres) {
  let max = 0;
  for (const f of fenetres) {
    const actives = new Set(
      fenetres.filter((g) => g.debut <= f.debut && f.debut < g.fin).map((g) => g.nodeId),
    );
    max = Math.max(max, actives.size);
  }
  return max;
}

/**
 * @param {{
 *   requis: number, noeuds?: any[], taches?: any[], productions?: string[],
 *   evenements?: any[]
 * }} faits
 *   `productions` : les tâches confiées et leurs sous-tâches déléguées ;
 *   `taches` et `noeuds` : l'instantané final ; `evenements` : le journal
 *   gardé depuis l'amorce.
 */
export function jugerEssaim(faits) {
  const verdicts = [];
  const dire = (critere, libelle, etat, detail) =>
    verdicts.push({ critere, libelle, etat, detail });
  const noeuds = new Map((faits.noeuds ?? []).map((n) => [n.id, n]));
  const taches = new Map((faits.taches ?? []).map((t) => [t.id, t]));
  const evenements = Array.isArray(faits.evenements) ? faits.evenements : [];
  const productions = new Set(faits.productions ?? []);
  const relectures = new Set([...productions].flatMap((id) => relecturesDe(id, evenements)));
  const nom = (id) => noeuds.get(id)?.name ?? id;
  const agent = (id) => noeuds.get(id)?.agentType ?? 'inconnu';
  const titre = (id) => taches.get(id)?.title ?? id;
  const du = (type, filtre = () => true) =>
    evenements.filter((e) => e.type === type && filtre(charge(e)));

  // ─── Les ouvrières qui ont RENDU du travail ─────────────────────────────────
  //
  // Être en ligne ne compte pas : seul un `task_done` (production ou
  // relecture) dit qu'une ouvrière a travaillé pour cette mission.
  const rendeurs = [
    ...new Set(
      du('task_done', (p) => productions.has(p.taskId) || relectures.has(p.taskId)).map(
        (e) => charge(e).nodeId,
      ),
    ),
  ];
  const reelles = rendeurs.filter((id) => noeuds.has(id) && !AGENTS_SIMULES.has(agent(id)));
  const familles = new Set(reelles.map(agent));
  const liste = reelles.map((id) => `${nom(id)} (${agent(id)})`).join(', ');
  const ouvrieres = `${reelles.length} ouvrière(s) réelle(s) de ${familles.size} famille(s)`;
  if (reelles.length >= faits.requis && familles.size >= 2) {
    dire(
      'Ouvrières',
      'Ouvrières réelles',
      'prouve',
      `${ouvrieres} ont rendu du travail : ${liste}`,
    );
  } else {
    dire(
      'Ouvrières',
      'Ouvrières réelles',
      'echec',
      `${ouvrieres}${liste ? ` (${liste})` : ''} — il en faut ${faits.requis} de 2 familles au moins`,
    );
  }

  // ─── Le parallélisme, mesuré par l'horloge de la Reine ─────────────────────
  const fenetres = fenetresDe([...productions], evenements);
  const simultanees = simultaneiteMax(fenetres);
  if (fenetres.length < 2) {
    dire('Parallèle', 'Travail en parallèle', 'inconnu', 'moins de deux exécutions mesurées');
  } else if (simultanees >= 2) {
    dire(
      'Parallèle',
      'Travail en parallèle',
      'prouve',
      `jusqu’à ${simultanees} ouvrières en même temps (démarrage → fin, horloge de la Reine)`,
    );
  } else {
    dire(
      'Parallèle',
      'Travail en parallèle',
      'echec',
      'les productions se sont succédé : aucune ne chevauche celle d’une autre ouvrière',
    );
  }

  // ─── La délégation : une arête, et une sous-tâche rendue ────────────────────
  const aretes = du('delegation_created', (p) => productions.has(p.parentTaskId));
  const rendue = aretes.find((e) => taches.get(charge(e).childTaskId)?.status === 'done');
  if (rendue) {
    const { parentTaskId, childTaskId } = charge(rendue);
    const fin = du('task_done', (p) => p.taskId === childTaskId).at(-1);
    const par = fin ? ` par ${nom(charge(fin).nodeId)} (${agent(charge(fin).nodeId)})` : '';
    dire(
      'Délégation',
      'Délégation',
      'prouve',
      `« ${titre(parentTaskId)} » → ${childTaskId}, rendue${par}`,
    );
  } else if (aretes.length > 0) {
    const enfant = charge(aretes[0]).childTaskId;
    const statut = taches.get(enfant)?.status ?? 'absente';
    dire('Délégation', 'Délégation', 'echec', `sous-tâche ${enfant} ${statut}, jamais rendue`);
  } else {
    const refus = du('delegation_rejected', (p) => productions.has(p.parentTaskId)).at(-1);
    dire(
      'Délégation',
      'Délégation',
      'echec',
      refus
        ? `délégation refusée par la Reine : ${charge(refus).code} — ${charge(refus).message}`
        : 'aucune sous-tâche créée : l’agent n’a pas appelé l’outil de délégation',
    );
  }

  // ─── La relecture par une AUTRE famille ─────────────────────────────────────
  //
  // La famille est celle du nœud qui a RENDU la relecture (son `task_done`),
  // pas celle que le verdict nomme. Le verdict reprend le relecteur choisi au
  // lancement ; or une relecture remise en file (nœud saturé, échec
  // intermédiaire) repart vers n'importe quel nœud — la même famille que le
  // producteur comprise. Se fier au nom inscrit ferait passer une relecture
  // par soi-même pour une relecture croisée.
  const avis = du(
    'contre_expertise_verdict',
    (p) => p.source === 'hive_counter_review' && productions.has(p.taskId),
  ).map(charge);
  const familleDuRendu = (relecture) => {
    const fin = du('task_done', (q) => q.taskId === relecture).at(-1);
    const id = fin ? charge(fin).nodeId : undefined;
    return noeuds.has(id) && !AGENTS_SIMULES.has(agent(id)) ? agent(id) : null;
  };
  const croises = avis
    .map((p) => ({ p, famille: familleDuRendu(p.relecture) }))
    .filter(({ p, famille }) => famille !== null && famille !== p.producteur);
  if (croises.length > 0) {
    const paires = new Map();
    for (const { p, famille } of croises) {
      const cle = `${famille} relit ${p.producteur}`;
      paires.set(cle, (paires.get(cle) ?? 0) + 1);
    }
    dire(
      'Relecture',
      'Relecture croisée',
      'prouve',
      [...paires].map(([cle, n]) => `${cle} ×${n}`).join(', '),
    );
  } else {
    const refus = du('contre_expertise', (p) => productions.has(p.taskId) && p.possible === false);
    const pannes = du('contre_expertise_review_failed', (p) => productions.has(p.taskId));
    dire(
      'Relecture',
      'Relecture croisée',
      'echec',
      avis.length > 0
        ? 'aucun avis rendu par un nœud d’une autre famille que le producteur'
        : refus.length > 0
          ? 'aucun modèle d’une autre famille en ligne pour relire'
          : pannes.length > 0
            ? 'relectures lancées, aucune n’a rendu d’avis'
            : 'aucune contre-revue lancée',
    );
  }

  // ─── La reprise après une objection ─────────────────────────────────────────
  //
  // Une objection ne se provoque pas : si tous les relecteurs approuvent, il
  // n'y a rien à reprendre, et c'est `inconnu`. La Reine ne consigne pas ce
  // qu'elle remet à la tentative suivante : que l'objection l'ait atteinte
  // n'est donc pas vérifiable ici, et la ligne le dit au lieu de le supposer.
  const contestees = new Map();
  for (const p of avis) {
    if (p.conteste === true && Number.isSafeInteger(p.resultId)) {
      const cle = `${p.taskId}:${p.resultId}`;
      if (!contestees.has(cle)) contestees.set(cle, p);
    }
  }
  const reprises = [];
  const restees = [];
  for (const p of contestees.values()) {
    const vise = (q) => q.taskId === p.taskId && q.resultId === p.resultId;
    const retry = du('task_retry', (q) => q.source === 'evaluator' && vise(q)).at(-1);
    if (retry) reprises.push({ p, retry: charge(retry) });
    else restees.push({ p, refus: du('evaluator_retry_skipped', vise).at(-1) });
  }
  const objection = (p) =>
    Array.isArray(p.objections) && typeof p.objections[0] === 'string'
      ? ` « ${court(p.objections[0])} »`
      : '';
  const reste = restees
    .map(({ p, refus }) =>
      refus ? `${titre(p.taskId)} : ${charge(refus).reason}` : `${titre(p.taskId)} : aucun retry`,
    )
    .join(', ');
  if (contestees.size === 0) {
    dire(
      'Reprise',
      'Reprise après objection',
      'inconnu',
      'aucune objection levée : rien à reprendre',
    );
  } else if (reprises.length > 0) {
    const { p, retry } = reprises[0];
    dire(
      'Reprise',
      'Reprise après objection',
      'prouve',
      `« ${titre(p.taskId)} » reprise après l’objection${objection(p)} (essai ${retry.attempt}/${retry.maxAttempts})` +
        `${reste ? ` ; sans reprise : ${reste}` : ''} — la transmission de l’objection à la tentative n’est pas consignée`,
    );
  } else {
    dire('Reprise', 'Reprise après objection', 'echec', `objection sans reprise — ${reste}`);
  }

  return verdicts;
}

/** Les critères d'essaim sans lesquels le jalon n'est pas atteint. */
export const EXIGES_ESSAIM = ['Ouvrières', 'Parallèle', 'Délégation', 'Relecture'];

/** L'essaim est-il prouvé ? Chaque critère exigé doit être `prouve`. */
export function essaimProuve(verdicts) {
  return EXIGES_ESSAIM.every((c) => verdicts.find((v) => v.critere === c)?.etat === 'prouve');
}
