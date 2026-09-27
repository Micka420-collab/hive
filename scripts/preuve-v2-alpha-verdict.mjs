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
//
// Et une troisième, qui tient la preuve à l'abri du hasard : un critère n'est
// `prouve` que sur le fait EXACT qu'il nomme. Une décision de l'Evaluator
// quelconque n'est pas une évaluation acceptée ; un bac déclaré par le seul
// producteur ne dit rien du relecteur qui a lu le même code hors du bac.

/** @typedef {'prouve' | 'inconnu' | 'echec'} Etat */
/** @typedef {{ critere: string, libelle: string, etat: Etat, detail: string }} Verdict */

/** L'adaptateur `shell` est une simulation : ni un agent, ni un relecteur. */
export const AGENTS_SIMULES = new Set(['shell']);

/** Les quatre validations que l'Evaluator exige pour `accepted`. */
export const VALIDATIONS = ['tests', 'typecheck', 'build', 'lint'];

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
 * `executants` : chaque nœud qui a exécuté la mission (producteur et
 * relecteurs, relus au journal) ; à défaut, le seul nœud producteur.
 *
 * @param {{
 *   noeud?: any, executants?: any[], tache?: any, resultats?: any[], routage?: any,
 *   chronologie?: any, evaluation?: any, genome?: any, workers?: any, attendu?: RegExp
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

  const bac = jugerBac(faits.executants ?? (noeud ? [noeud] : []));
  dire('A-bac', 'Bac à sable', bac.etat, bac.detail);

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
  //
  // L'affectation qui a PRODUIT : la dernière vers le nœud de la production
  // retenue. La première raconterait une tentative que l'Evaluator a
  // renvoyée, peut-être sur un autre nœud et un autre modèle.
  const affectations = Array.isArray(faits.routage?.affectations) ? faits.routage.affectations : [];
  const affectation = noeud ? affectations.findLast((a) => a?.nodeId === noeud.id) : undefined;
  const modele = affectation?.modele ?? null;
  if (!affectation) {
    dire(
      'G',
      'Routage expliqué',
      'inconnu',
      affectations.length > 0
        ? 'aucune affectation consignée pour le nœud qui a produit'
        : 'aucune affectation consignée',
    );
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
  const evaluation = jugerEvaluation(faits.evaluation);
  dire('Evaluator', 'Évaluation', evaluation.etat, evaluation.detail);

  return verdicts;
}

/**
 * Le bac à sable de CHAQUE nœud qui a exécuté la mission — producteur et
 * relecteurs. Un relecteur est un agent lancé sur le même code : s'il tourne
 * hors du bac, la mission n'a pas tourné dans un bac, quel que soit le
 * producteur.
 *
 * `prouve` exige un conteneur ET son moteur : « conteneur » sans moteur est
 * précisément la déclaration que `isolementDeclareDe` refuse de faire, donc
 * un fait qu'on ne sait pas lire. Un `processus` l'emporte sur un inconnu :
 * il suffit d'une exécution hors du bac pour que le critère soit contredit.
 */
export function jugerBac(executants) {
  const nom = (n) => n?.name ?? n?.id ?? '?';
  const liste = Array.isArray(executants) ? executants : [];
  if (liste.length === 0) {
    return { etat: 'inconnu', detail: 'aucune exécution consignée : aucun bac à juger' };
  }
  const nus = liste.filter((n) => n?.isolement && n.isolement.niveau !== 'conteneur');
  if (nus.length > 0) {
    const qui = nus.map((n) => `${nom(n)} « ${n.isolement.niveau} »`).join(', ');
    return { etat: 'echec', detail: `${qui} seulement — pas un conteneur` };
  }
  const muets = liste.filter((n) => !n?.isolement?.fournisseur);
  if (muets.length > 0) {
    const qui = muets.map(nom).join(', ');
    return {
      etat: 'inconnu',
      detail: `${qui} : bac non déclaré, ou « conteneur » sans moteur`,
    };
  }
  if (liste.length === 1) {
    return {
      etat: 'prouve',
      detail: `conteneur (${liste[0].isolement.fournisseur}), déclaré par le nœud`,
    };
  }
  const qui = liste.map((n) => `${nom(n)} (${n.isolement.fournisseur})`).join(', ');
  return { etat: 'prouve', detail: `conteneur déclaré par chaque nœud : ${qui}` };
}

const SIGNE_VALIDATION = { passed: '✔', failed: '✘' };

/**
 * `prouve` pour `accepted` avec les quatre validations passées — et pour rien
 * d'autre. Une décision est un fait : `rejected` ou `correction_required` (ou
 * une validation en échec) contredisent le critère ; `human_review_required`
 * et `additional_test_required` sont l'Evaluator qui dit lui-même qu'il lui
 * manque une preuve : on ne conclut pas à sa place.
 */
export function jugerEvaluation(evaluation) {
  const decision = evaluation?.decision;
  if (typeof decision !== 'string' || decision.length === 0) {
    return { etat: 'inconnu', detail: 'aucune décision rendue' };
  }
  const etats = VALIDATIONS.map((k) => evaluation.evidence?.[k] ?? 'missing');
  const validations = VALIDATIONS.map((k, i) => `${k} ${SIGNE_VALIDATION[etats[i]] ?? '?'}`);
  const raison = Array.isArray(evaluation.reasons) && evaluation.reasons[0];
  const dit = `décision « ${decision} » · ${validations.join(' ')}${raison ? ` — ${raison}` : ''}`;
  if (decision === 'accepted' && etats.every((e) => e === 'passed')) {
    const fusion = evaluation.canMerge === true ? '' : ', fusion après geste humain';
    return { etat: 'prouve', detail: `décision « accepted » · ${validations.join(' ')}${fusion}` };
  }
  if (decision === 'rejected' || decision === 'correction_required' || etats.includes('failed')) {
    return { etat: 'echec', detail: dit };
  }
  return { etat: 'inconnu', detail: dit };
}

/**
 * La livraison Git, quand la mission a un dépôt (`--depot`).
 *
 * `livraisons` : une entrée par tâche confiée, telle que `POST /api/livraison`
 * l'a rendue. Sans dépôt, rien n'a été demandé : c'est `inconnu`, pas un échec.
 * Une PR sans numéro ou sans commit n'est pas une livraison traçable.
 */
export function jugerLivraison(livraisons) {
  const verdict = (etat, detail) => ({ critere: 'Git', libelle: 'Livraison Git', etat, detail });
  if (!Array.isArray(livraisons)) {
    return verdict('inconnu', 'sans --depot, la mission n’a pas de dépôt : rien à livrer');
  }
  if (livraisons.length === 0) return verdict('echec', 'aucune tâche à livrer');
  const tracee = (l) =>
    (l?.status === 200 || l?.status === 201) &&
    Number.isSafeInteger(l.corps?.pr) &&
    l.corps.pr > 0 &&
    typeof l.corps?.commitSha === 'string' &&
    l.corps.commitSha.length > 0;
  const ratee = livraisons.find((l) => !tracee(l));
  if (ratee) {
    const motif = ratee.corps?.error ?? ratee.texte ?? '';
    return verdict(
      'echec',
      `${ratee.taskId} non livrée (${ratee.status})${motif ? ` : ${motif}` : ''}`,
    );
  }
  return verdict(
    'prouve',
    livraisons
      .map(
        (l) => `PR #${l.corps.pr} (${l.corps.branche ?? '?'} @ ${l.corps.commitSha.slice(0, 7)})`,
      )
      .join(' · '),
  );
}

/**
 * La mission réelle est-elle prouvée ? Agent réel ET travail produit — et,
 * sous `--exige-bac`, un bac conteneur pour chaque nœud qui l'a exécutée.
 */
export function missionReelleProuvee(verdicts, { exigeBac = false } = {}) {
  const etat = (c) => verdicts.find((v) => v.critere === c)?.etat;
  return (
    etat('A-agent') === 'prouve' &&
    etat('A-diff') === 'prouve' &&
    (!exigeBac || etat('A-bac') === 'prouve')
  );
}

const SIGNE = { prouve: '✔', inconnu: '?', echec: '✘' };

/** Le rapport lisible, une ligne par critère, les identifiants alignés. */
export function rapportV2Alpha(verdicts) {
  const largeur = Math.max(9, ...verdicts.map((v) => v.critere.length));
  return verdicts
    .map((v) => `${SIGNE[v.etat]} ${v.critere.padEnd(largeur)} ${v.libelle} — ${v.detail}`)
    .join('\n');
}
