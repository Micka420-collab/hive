// LE VERDICT DE LA PREUVE V2 ALPHA — critère par critère, depuis ce que la
// Reine a RÉELLEMENT consigné.
//
// Ce module ne parle à personne : il reçoit les faits relus par l'API
// (instantané, résultats, routage, chronologie, évaluation, Genome, Workers)
// et rend, pour chaque critère du handoff V2 Alpha, un des trois états :
//
//   · `prouve`  — le fait est là, et il dit ce que le critère demande ;
//   · `inconnu` — le fait manque (non déclaré, non mesuré) : on ne conclut pas ;
//   · `echec`   — le fait est là, et il dit le contraire.
//
// Deux règles tiennent tout le reste :
//   1. Un fait DÉCLARÉ est dit déclaré (agent, bac, coût viennent du nœud ou de
//      son CLI) — la Reine ne peut pas les constater chez lui.
//   2. L'absence reste absence : rien n'est estimé, un critère sans fait est
//      `inconnu`, jamais `prouve` par défaut.

/** @typedef {'prouve' | 'inconnu' | 'echec'} Etat */
/** @typedef {{ critere: string, libelle: string, etat: Etat, detail: string }} Verdict */

const AGENTS_SIMULES = new Set(['shell']);

/** Le résultat retenu : la production réussie la plus récente. */
export function productionRetenue(resultats) {
  const reussies = (Array.isArray(resultats) ? resultats : []).filter((r) => r?.success === true);
  return reussies.at(-1) ?? null;
}

const usd = (v) =>
  `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const couverture = (s) =>
  s.declarees === s.tentatives ? '' : ` (${s.declarees}/${s.tentatives} tentatives déclarées)`;

/**
 * @param {{
 *   noeud?: any, tache?: any, resultats?: any[], routage?: any, chronologie?: any,
 *   evaluation?: any, genome?: any, workers?: any, attendu?: RegExp
 * }} faits
 * @returns {Verdict[]}
 */
export function jugerV2Alpha(faits) {
  const verdicts = [];
  const dire = (critere, libelle, etat, detail) =>
    verdicts.push({ critere, libelle, etat, detail });
  const noeud = faits.noeud ?? null;
  const production = productionRetenue(faits.resultats);

  // ─── A. Mission réelle ─────────────────────────────────────────────────────
  if (!noeud) {
    dire('A-agent', 'Agent réel', 'inconnu', 'aucun nœud relié à la production');
  } else if (AGENTS_SIMULES.has(noeud.agentType)) {
    dire(
      'A-agent',
      'Agent réel',
      'echec',
      `agent « ${noeud.agentType} » : simulation, pas un agent`,
    );
  } else {
    dire(
      'A-agent',
      'Agent réel',
      'prouve',
      `agent déclaré « ${noeud.agentType} » par le nœud ${noeud.name ?? noeud.id}`,
    );
  }

  if (!production) {
    const statut = faits.tache?.status ?? 'inconnu';
    dire('A-diff', 'Travail produit', 'echec', `aucune production réussie (tâche ${statut})`);
  } else if (typeof production.diff !== 'string' || production.diff.trim() === '') {
    dire('A-diff', 'Travail produit', 'echec', 'production réussie mais diff vide');
  } else if (faits.attendu && !faits.attendu.test(production.diff)) {
    dire('A-diff', 'Travail produit', 'echec', 'le diff ne contient pas ce qui était demandé');
  } else {
    dire('A-diff', 'Travail produit', 'prouve', `diff de ${production.diff.length} signes`);
  }

  const isolement = noeud?.isolement;
  if (!isolement) {
    dire('A-bac', 'Bac à sable', 'inconnu', 'le nœud n’a pas déclaré son bac à sable');
  } else if (isolement.niveau === 'conteneur') {
    const moteur = isolement.fournisseur ? ` (${isolement.fournisseur})` : '';
    dire('A-bac', 'Bac à sable', 'prouve', `conteneur${moteur}, déclaré par le nœud`);
  } else {
    dire('A-bac', 'Bac à sable', 'echec', `« ${isolement.niveau} » seulement — pas un conteneur`);
  }

  // ─── B. Coût fournisseur ───────────────────────────────────────────────────
  const cout = faits.chronologie?.coutFournisseur;
  if (cout && cout !== 'inconnu' && typeof cout.total === 'number') {
    const pre = cout.declarees === cout.tentatives ? '' : '≥ ';
    dire(
      'B',
      'Coût fournisseur',
      'prouve',
      `${pre}${usd(cout.total)} déclarés par le CLI${couverture(cout)}`,
    );
  } else {
    dire('B', 'Coût fournisseur', 'inconnu', 'le CLI de l’agent n’a déclaré aucun coût');
  }

  // ─── C. Latence ventilée ───────────────────────────────────────────────────
  const c = faits.chronologie;
  if (
    c &&
    c.attenteWorkerMs !== null &&
    c.attenteWorkerMs !== undefined &&
    c.dureeWorkerTotaleMs !== null &&
    c.dureeWorkerTotaleMs !== undefined
  ) {
    const modele =
      c.dureeModele && c.dureeModele !== 'inconnu'
        ? ` · modèle ${ms(c.dureeModele.total)}${couverture(c.dureeModele)}`
        : ' · temps modèle non déclaré';
    dire(
      'C',
      'Latence ventilée',
      'prouve',
      `attente ${ms(c.attenteWorkerMs)} · Worker ${ms(c.dureeWorkerTotaleMs)}${modele}`,
    );
  } else {
    dire('C', 'Latence ventilée', 'inconnu', 'phases non mesurées');
  }

  // ─── D. Ressources, sans confusion avec le coût ────────────────────────────
  const usage = faits.tache?.result?.usage;
  if (usage && typeof usage.maxRssBytes === 'number') {
    const cpu = (usage.userCpuMicros + usage.systemCpuMicros) / 1000;
    dire(
      'D',
      'Ressources du Worker',
      'prouve',
      `${ms(cpu)} CPU · ${(usage.maxRssBytes / 1048576).toFixed(1)} MiB RSS (processus Worker)`,
    );
  } else {
    dire('D', 'Ressources du Worker', 'inconnu', 'le Worker n’a pas mesuré ses ressources');
  }

  // ─── G. Routage expliqué (avant E : le Genome se lit sous le modèle élu) ──
  const affectation = faits.routage?.affectations?.[0];
  const modele = affectation?.modele ?? null;
  if (!affectation) {
    dire('G', 'Routage expliqué', 'inconnu', 'aucune affectation consignée');
  } else if (!modele) {
    dire(
      'G',
      'Routage expliqué',
      'inconnu',
      'le nœud ne déclare aucun modèle (HIVE_MODELES) : rien à expliquer',
    );
  } else {
    const n = Array.isArray(affectation.raisonModele) ? affectation.raisonModele.length : 0;
    dire(
      'G',
      'Routage expliqué',
      n > 0 ? 'prouve' : 'inconnu',
      n > 0
        ? `« ${modele} », classement de ${n} modèle(s) consigné`
        : `« ${modele} » sans classement consigné`,
    );
  }

  // ─── E. Genome ─────────────────────────────────────────────────────────────
  const lignes = Array.isArray(faits.genome?.lignes) ? faits.genome.lignes : [];
  const siennes = modele ? lignes.filter((l) => l.modele === modele) : [];
  const rendus = siennes.reduce((n, l) => n + (l.rendus ?? 0), 0);
  if (!modele) {
    dire(
      'E',
      'Genome',
      'inconnu',
      'sans modèle déclaré, les faits ne se rangent sous aucun modèle',
    );
  } else if (rendus > 0) {
    const exacts = [...new Set(siennes.flatMap((l) => l.modelesExacts ?? []))];
    dire(
      'E',
      'Genome',
      'prouve',
      `${rendus} rendu(s) rangé(s) sous « ${modele} »${exacts.length ? ` (exact : ${exacts.join(', ')})` : ''}`,
    );
  } else {
    dire('E', 'Genome', 'inconnu', `aucun rendu encore rangé sous « ${modele} »`);
  }

  // ─── F. Réputation contextualisée ──────────────────────────────────────────
  const worker = (faits.workers?.workers ?? []).find((w) => w.id === noeud?.id);
  const categories = worker?.reputationParCategorie ?? {};
  const jugees = Object.entries(categories).filter(([, r]) => (r?.essais ?? 0) > 0);
  if (jugees.length > 0) {
    dire(
      'F',
      'Réputation par catégorie',
      'prouve',
      jugees.map(([cat, r]) => `${cat} ${r.essais} jugement(s)`).join(' · '),
    );
  } else {
    dire(
      'F',
      'Réputation par catégorie',
      'inconnu',
      'aucune contre-visite encore : il faut une seconde ouvrière pour relire',
    );
  }

  // ─── L'Evaluator ───────────────────────────────────────────────────────────
  const decision = faits.evaluation?.decision;
  if (typeof decision === 'string' && decision.length > 0) {
    dire(
      'Evaluator',
      'Évaluation',
      'prouve',
      `décision « ${decision} »${faits.evaluation.canMerge === false ? ', fusion non autorisée sans geste humain' : ''}`,
    );
  } else {
    dire('Evaluator', 'Évaluation', 'inconnu', 'aucune décision rendue');
  }

  return verdicts;
}

/** La mission réelle est-elle prouvée ? (agent réel ET travail produit) */
export function missionReelleProuvee(verdicts) {
  const etat = (c) => verdicts.find((v) => v.critere === c)?.etat;
  return etat('A-agent') === 'prouve' && etat('A-diff') === 'prouve';
}

const SIGNE = { prouve: '✔', inconnu: '?', echec: '✘' };

/** Le rapport lisible, une ligne par critère. */
export function rapportV2Alpha(verdicts) {
  return verdicts
    .map((v) => `${SIGNE[v.etat]} ${v.critere.padEnd(9)} ${v.libelle} — ${v.detail}`)
    .join('\n');
}
