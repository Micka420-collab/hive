// LE VERDICT DE L'ESSAIM — ce que plusieurs ouvrières ont RÉELLEMENT fait
// ensemble, relu dans le journal de la Reine.
//
// Le verdict d'une mission (`preuve-v2-alpha-verdict.mjs`) juge chaque tâche
// seule. Le jalon V2 Alpha demande en plus des faits qui n'existent qu'à
// PLUSIEURS : des ouvrières de familles différentes qui travaillent en même
// temps, une qui délègue une sous-tâche, une qui relit l'autre, et une
// production reprise après une objection.
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

/**
 * Les familles dont l'adaptateur donne au CLI les outils du pont de délégation
 * (`createDelegationBridge`, `src/adapters/`). Les autres n'ont AUCUN moyen de
 * déléguer : une tâche qui délègue tombée chez elles ne dit rien de la
 * délégation, et reprocher à l'agent de « ne pas avoir appelé l'outil »
 * serait faux. Recopiée pour Node nu ; un banc la confronte aux adaptateurs.
 */
export const FAMILLES_DELEGANTES = new Set(['claude-code', 'codex']);

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
 *   independantes?: string[], deleguante?: string, evenements?: any[]
 * }} faits
 *   `productions` : les tâches confiées et leurs sous-tâches déléguées ;
 *   `independantes` : les tâches confiées SANS lien entre elles ;
 *   `deleguante` : la tâche confiée qui doit déléguer ;
 *   `taches` : l'instantané final ; `noeuds` : chaque nœud vu pendant la
 *   mission ; `evenements` : le journal gardé depuis l'amorce.
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
  const reel = (id) => noeuds.has(id) && !AGENTS_SIMULES.has(agent(id));
  const qui = (id) => `${nom(id)} (${agent(id)})`;
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
  const reelles = rendeurs.filter(reel);
  const familles = new Set(reelles.map(agent));
  const liste = reelles.map(qui).join(', ');
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
  //
  // Sur les seules tâches INDÉPENDANTES, et sur de vrais agents. Une tâche qui
  // délègue reste `running` tant qu'elle attend son enfant : sa fenêtre
  // enveloppe celle de l'enfant par construction. Les compter ensemble faisait
  // de toute délégation vers un autre nœud un « parallélisme », même si les
  // tâches indépendantes s'étaient toutes succédé.
  const fenetres = fenetresDe(faits.independantes ?? [], evenements).filter((f) => reel(f.nodeId));
  const simultanees = simultaneiteMax(fenetres);
  if (fenetres.length < 2) {
    dire(
      'Parallèle',
      'Travail en parallèle',
      'inconnu',
      'moins de deux exécutions de tâches indépendantes mesurées',
    );
  } else if (simultanees >= 2) {
    dire(
      'Parallèle',
      'Travail en parallèle',
      'prouve',
      `jusqu’à ${simultanees} ouvrières en même temps sur les tâches indépendantes ` +
        '(démarrage → fin, horloge de la Reine)',
    );
  } else {
    dire(
      'Parallèle',
      'Travail en parallèle',
      'echec',
      'les tâches indépendantes se sont succédé : aucune ne chevauche celle d’une autre ouvrière',
    );
  }

  // ─── La délégation : une arête, et une sous-tâche rendue par un vrai agent ─
  //
  // Une arête et un enfant `done` ne suffisent pas : il faut SAVOIR qui a
  // rendu l'enfant, et que ce soit un agent réel. Où il a tourné, en
  // revanche, n'est pas exigé — seulement DIT : la Reine ne sait pas épingler
  // l'enfant, et l'Aiguillage peut le rendre au nœud même du parent (vu sur
  // une vraie Reine : le modèle élu n'était offert que par lui et par une
  // ouvrière plus chargée). Exiger une autre ouvrière ferait échouer la
  // preuve au hasard du routage, sans rien apprendre de plus sur la
  // délégation elle-même : l'enfant est une autre tâche, un autre atelier, un
  // autre processus d'agent.
  const aretes = du('delegation_created', (p) => productions.has(p.parentTaskId));
  /** Le nœud qui exécutait le parent quand il a délégué, et celui qui a rendu l'enfant. */
  const cote = (arete) => {
    const { parentTaskId, childTaskId } = charge(arete);
    const depart = du('task_started', (p) => p.taskId === parentTaskId)
      .filter((e) => e.id < arete.id)
      .at(-1);
    const fin = du('task_done', (p) => p.taskId === childTaskId).at(-1);
    return {
      parentTaskId,
      childTaskId,
      parent: depart ? charge(depart).nodeId : undefined,
      enfant: fin ? charge(fin).nodeId : undefined,
    };
  };
  const rendues = aretes
    .filter((e) => taches.get(charge(e).childTaskId)?.status === 'done')
    .map(cote);
  // Une délégation vers une AUTRE ouvrière se dit en premier, si l'essaim en a une.
  const parAgents = rendues.filter((r) => reel(r.enfant));
  const prouvee =
    parAgents.find((r) => r.parent !== undefined && r.parent !== r.enfant) ?? parAgents[0];
  /** Où l'enfant a tourné, par rapport au parent — dit, jamais exigé. */
  const ou = (r) =>
    r.parent === undefined
      ? ''
      : r.parent === r.enfant
        ? ', sur l’ouvrière même de la tâche parente (la Reine ne l’épingle pas)'
        : ` pour ${qui(r.parent)}`;
  if (prouvee) {
    dire(
      'Délégation',
      'Délégation',
      'prouve',
      `« ${titre(prouvee.parentTaskId)} » → ${prouvee.childTaskId}, rendue par ` +
        `${qui(prouvee.enfant)}${ou(prouvee)}`,
    );
  } else if (rendues.length > 0) {
    const r = rendues[0];
    const [etat, pourquoi] =
      r.enfant === undefined
        ? ['inconnu', 'rendue, mais son rendu n’est pas au journal']
        : noeuds.has(r.enfant)
          ? ['echec', `rendue par ${qui(r.enfant)}, une simulation`]
          : ['inconnu', `rendue par ${r.enfant}, nœud jamais vu : agent inconnu`];
    dire('Délégation', 'Délégation', etat, `sous-tâche ${r.childTaskId} ${pourquoi}`);
  } else if (aretes.length > 0) {
    const enfant = charge(aretes[0]).childTaskId;
    const statut = taches.get(enfant)?.status ?? 'absente';
    dire('Délégation', 'Délégation', 'echec', `sous-tâche ${enfant} ${statut}, jamais rendue`);
  } else {
    const refus = du('delegation_rejected', (p) => productions.has(p.parentTaskId)).at(-1);
    // Qui a pris la tâche qui délègue : si AUCUN de ses nœuds n'a le pont,
    // l'agent n'avait pas l'outil — ce n'est pas lui qui a manqué.
    const porteurs = [
      ...new Set(
        du('task_started', (p) => p.taskId === faits.deleguante).map((e) => charge(e).nodeId),
      ),
    ];
    const sansPont =
      porteurs.length > 0 && porteurs.every((id) => !FAMILLES_DELEGANTES.has(agent(id)));
    if (refus) {
      dire(
        'Délégation',
        'Délégation',
        'echec',
        `délégation refusée par la Reine : ${charge(refus).code} — ${charge(refus).message}`,
      );
    } else if (sansPont) {
      dire(
        'Délégation',
        'Délégation',
        'inconnu',
        `la tâche qui délègue a tourné sur ${porteurs.map(qui).join(', ')} : adaptateur sans pont ` +
          `de délégation (seuls ${[...FAMILLES_DELEGANTES].join(', ')} en ont un)`,
      );
    } else {
      dire(
        'Délégation',
        'Délégation',
        'echec',
        'aucune sous-tâche créée : l’agent n’a pas appelé l’outil de délégation',
      );
    }
  }

  // ─── La relecture par une AUTRE famille ─────────────────────────────────────
  //
  // La famille est celle du nœud qui a RENDU la relecture (son `task_done`),
  // établie ici sans passer par le verdict. Le hub en répond déjà : le verdict
  // nomme le nœud qui le rend (`reviewerNodeId`), une relecture remise en file
  // ne repart que vers la famille désignée, et un avis rendu par une autre
  // famille n'est pas un verdict (`famille_non_designee`). La preuve recoupe
  // quand même, en défense en profondeur : elle ne certifie pas une relecture
  // croisée sur la seule parole du hub qu'elle vérifie.
  const avis = du(
    'contre_expertise_verdict',
    (p) => p.source === 'hive_counter_review' && productions.has(p.taskId),
  ).map(charge);
  const familleDuRendu = (relecture) => {
    const fin = du('task_done', (q) => q.taskId === relecture).at(-1);
    const id = fin ? charge(fin).nodeId : undefined;
    return reel(id) ? agent(id) : null;
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
