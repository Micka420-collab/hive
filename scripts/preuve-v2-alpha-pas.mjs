// LA SÉQUENCE DE LA PREUVE V2 ALPHA — une vraie mission, confiée à de vraies
// ouvrières, puis relue critère par critère.
//
// La séquence reçoit sa ruche (le transport) et ne décide rien d'elle-même :
// le verdict est dans `preuve-v2-alpha-verdict.mjs` (une mission) et
// `preuve-v2-alpha-essaim.mjs` (plusieurs ouvrières). Elle est donc jouable
// contre une ruche de laboratoire ET contre une vraie Reine.
//
// ─── CE QU'ELLE REFUSE DE FAIRE SANS QU'ON LE LUI DISE ──────────────────────
//
// Confier la mission fait travailler de VRAIS agents : cela consomme les
// crédits de leurs comptes. Sans `creer: true` (le drapeau `--oui` du
// coureur), la séquence s'arrête après avoir dit ce qu'elle ferait et avec
// qui. C'est le SEUL drapeau qui dépense : `--workers`, `--exige-bac` et
// `--depot` disent quoi exiger, jamais « vas-y ».
//
// Et ce qu'une exigence rend impossible se dit AVANT de dépenser, jamais
// après : une ouvrière hors conteneur sous `--exige-bac`, aucun adaptateur
// capable de déléguer sous `--workers`, un `--depot` que la Reine ne saurait
// pas livrer (URL hors GitHub, aucun jeton). Le découvrir au rapport, c'est
// avoir payé trente minutes d'agents pour un échec écrit d'avance.
//
// ─── ELLE NE LIT PAS AVANT QUE LA MISSION SOIT RÉGLÉE ───────────────────────
//
// « Terminée » ne suffit pas : une production `done` attend encore ses
// relecteurs, et une objection peut la renvoyer en correction. Les faits ne
// sont relus qu'une fois chaque production RÉGLÉE (cf. `attenteDe`, dans
// `preuve-v2-alpha-journal.mjs`).

import { randomUUID } from 'node:crypto';
import { creationAcceptee } from './travail-fait.mjs';
import { FAMILLES_DELEGANTES } from './preuve-v2-alpha-essaim.mjs';
import {
  attenteDe,
  lecteurJournal,
  productionsDe,
  relecturesDe,
} from './preuve-v2-alpha-journal.mjs';
import { AGENTS_SIMULES, productionRetenue } from './preuve-v2-alpha-verdict.mjs';

/** La mission : petite, vérifiable, sans dépôt (l'atelier part vide). */
export const MISSION = {
  title: 'Preuve V2 Alpha — une fonction et son test',
  prompt:
    'Crée un fichier `somme.mjs` qui exporte une fonction `somme(a, b)` renvoyant a + b, ' +
    'et un fichier `somme.test.mjs` qui vérifie, avec `node:test` et `node:assert/strict`, ' +
    'que somme(2, 3) vaut 5. Ne crée ni ne modifie aucun autre fichier.',
};

/** Ce que le diff doit contenir pour être le travail demandé. */
export const ATTENDU = /somme/;

/** Un vrai agent peut prendre du temps : quinze minutes par défaut. */
export const PATIENCE_S = 900;

/** Un essaim délègue, se relit et se reprend : trente minutes par défaut. */
export const PATIENCE_ESSAIM_S = 1800;

/**
 * Les bornes de `--workers`. Trois est le jalon V2 Alpha ; au-delà de huit,
 * une faute de frappe (`--workers 30`) ferait travailler trente agents payants
 * d'un coup — la borne est une ceinture, pas un choix de produit.
 */
export const OUVRIERES_MIN = 3;
export const OUVRIERES_MAX = 8;

/**
 * Les outils MCP que le pont de délégation expose au CLI (cf.
 * `HIVE_DELEGATE_TOOL` et `HIVE_WAIT_TOOL`, `src/adapters/delegation-bridge.ts`).
 * Recopiés parce que ce script tourne en Node nu, sans TypeScript ; un banc
 * les confronte aux constantes pour qu'ils ne puissent pas diverger en silence.
 */
export const OUTIL_DELEGUER = 'hive_delegate';
export const OUTIL_ATTENDRE = 'hive_wait_for_delegation_result';

const rate = (raison) => ({ ok: false, raison });

/**
 * `owner/repo` d'une URL de dépôt, par la règle même de la livraison
 * (`depotDepuisUrl`, `src/orchestrator/livraison.ts`) — ou `null`.
 *
 * La Reine accepte au projet bien plus d'URL qu'elle ne sait en livrer
 * (`git@github.com:…`, GitLab, un chemin local) : sa route de livraison ne
 * connaît que `https://github.com/<owner>/<repo>`. Laisser passer le reste,
 * c'était lire son 409 APRÈS la mission. Recopiée parce que ce script tourne
 * en Node nu ; un banc la confronte à l'original, cas par cas.
 */
export function depotGithub(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const segments = u.pathname
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (segments.length !== 2) return null;
  const plein = segments.join('/');
  return /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(plein) && !plein.includes('..')
    ? plein
    : null;
}

/**
 * L'URL sans ses identifiants (`https://moi:jeton@github.com/…`, que la Reine
 * accepte pour cloner un dépôt privé). Le texte de la preuve est fait pour
 * être collé dans une carte : un jeton n'a rien à y faire — la Reine lave
 * pareillement chaque URL qu'elle montre (`laverIdentifiants`).
 */
function sansIdentifiants(url) {
  const u = new URL(url);
  u.username = '';
  u.password = '';
  return u.toString();
}

/** Les drapeaux du coureur ; `true` : le drapeau prend une valeur. */
const DRAPEAUX = new Map([
  ['--racine', true],
  ['--oui', false],
  ['--patience', true],
  ['--exige-bac', false],
  ['--workers', true],
  ['--depot', true],
]);

/**
 * Les options de la preuve, lues dans `argv` — ou `{ erreur }`.
 *
 * ─── UN DRAPEAU INCONNU EST UNE ERREUR, PAS UN BRUIT ─────────────────────────
 *
 * `--exige-bacs` ignoré en silence ferait passer une preuve SANS l'exigence
 * que son auteur croit avoir posée : exactement « prouvé par accident ». Tout
 * ce qui n'est pas reconnu arrête donc le coureur avant la moindre requête.
 */
export function argumentsDeLaPreuve(argv) {
  const vus = new Map();
  for (let i = 0; i < argv.length; i++) {
    const drapeau = argv[i];
    if (!DRAPEAUX.has(drapeau)) return { erreur: `argument inconnu : ${drapeau}` };
    if (!DRAPEAUX.get(drapeau)) {
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
  const racine = vus.get('--racine');
  if (typeof racine !== 'string') return { erreur: '--racine est obligatoire' };
  const patienceS = vus.has('--patience') ? Number(vus.get('--patience')) : undefined;
  if (patienceS !== undefined && (!Number.isFinite(patienceS) || patienceS <= 0)) {
    return { erreur: '--patience attend un nombre de secondes positif' };
  }
  const ouvrieres = vus.has('--workers') ? Number(vus.get('--workers')) : 0;
  if (
    vus.has('--workers') &&
    (!Number.isInteger(ouvrieres) || ouvrieres < OUVRIERES_MIN || ouvrieres > OUVRIERES_MAX)
  ) {
    return { erreur: `--workers attend un entier de ${OUVRIERES_MIN} à ${OUVRIERES_MAX}` };
  }
  // L'URL refusée n'est pas recopiée dans l'erreur : elle peut porter un jeton.
  const depot = vus.get('--depot') ?? null;
  if (depot !== null && depotGithub(depot) === null) {
    return {
      erreur:
        '--depot attend l’URL https d’un dépôt GitHub (https://github.com/<owner>/<repo>) : ' +
        'la Reine ne livre que là',
    };
  }
  return {
    racine,
    creer: vus.has('--oui'),
    exigeBac: vus.has('--exige-bac'),
    ouvrieres,
    depot,
    ...(patienceS === undefined ? {} : { patienceS }),
  };
}

/** Les ouvrières en ligne dont l'agent n'est pas une simulation. */
export function ouvrieresReelles(instantane) {
  const noeuds = Array.isArray(instantane?.nodes) ? instantane.nodes : [];
  return noeuds.filter((n) => n?.status === 'online' && !AGENTS_SIMULES.has(n?.agentType));
}

/**
 * Les tâches de l'essaim : `n` indépendantes (chacune son fichier, pour
 * qu'elles puissent tourner en même temps sans se marcher dessus), puis une
 * qui délègue. `graine` rend l'identifiant de la sous-tâche unique dans la
 * ruche : c'est l'agent qui le transmet, et la Reine refuse un id déjà pris.
 */
export function missionsEssaim(n, graine) {
  const independantes = Array.from({ length: n }, (_, i) => {
    const k = i + 1;
    return {
      role: 'independante',
      tache: {
        title: `Preuve V2 Alpha — ajoute${k}`,
        prompt:
          `Crée un fichier \`ajoute-${k}.mjs\` qui exporte une fonction \`ajoute${k}(x)\` ` +
          `renvoyant x + ${k}, et un fichier \`ajoute-${k}.test.mjs\` qui vérifie, avec ` +
          `\`node:test\` et \`node:assert/strict\`, que ajoute${k}(2) vaut ${2 + k}. ` +
          'Ne crée ni ne modifie aucun autre fichier.',
      },
      attendu: new RegExp(`ajoute${k}\\b`),
    };
  });
  const enfant = `v2a-${graine}-double`;
  const note = `delegation-${graine}.md`;
  const deleguante = {
    role: 'deleguante',
    tache: {
      title: 'Preuve V2 Alpha — délégation',
      prompt: [
        'Cette tâche prouve la DÉLÉGATION d’une sous-tâche. Fais-la dans cet ordre :',
        `1. Appelle l’outil MCP \`${OUTIL_DELEGUER}\` avec childTaskId « ${enfant} », ` +
          'title « Preuve V2 Alpha — double », reason « prouver la délégation », ' +
          'durationMs 600000, costMicros 1000000, resourceUnits 1, et pour prompt : ' +
          '« Crée un fichier `double.mjs` qui exporte une fonction `double(x)` renvoyant 2 * x, ' +
          'et un fichier `double.test.mjs` qui vérifie, avec `node:test` et `node:assert/strict`, ' +
          'que double(4) vaut 8. Ne crée ni ne modifie aucun autre fichier. »',
        `2. Attends son résultat avec l’outil MCP \`${OUTIL_ATTENDRE}\` (childTaskId « ${enfant} »).`,
        `3. Crée un fichier \`${note}\` d’une seule ligne : « ${enfant} » suivi de l’issue ` +
          'rendue (réussie ou échouée). Ne crée ni ne modifie aucun autre fichier.',
        `Si l’outil \`${OUTIL_DELEGUER}\` n’existe pas dans ta session, ne crée rien et ` +
          'termine en disant « délégation impossible ».',
      ].join('\n'),
    },
    attendu: new RegExp(`delegation-${graine}\\.md`),
  };
  return [...independantes, deleguante];
}

/** Le bac déclaré est-il un conteneur, moteur nommé ? (cf. `jugerBac`) */
const enConteneur = (n) => n?.isolement?.niveau === 'conteneur' && !!n.isolement.fournisseur;

/**
 * La déclaration de bac la plus FAIBLE qu'un nœud a faite pendant la mission :
 * hors conteneur d'abord, puis muette (aucun bac, ou « conteneur » sans
 * moteur — `null`), sinon la dernière.
 *
 * Un nœud qui se réinscrit en cours de route (autre `HIVE_ISOLEMENT`) serait
 * sinon jugé sur sa seule DERNIÈRE déclaration, pas sur celle sous laquelle il
 * a travaillé. La preuve ne sait pas dater une exécution entre deux relevés :
 * il suffit d'un relevé hors du bac pour que le nœud ait pu y travailler.
 */
export function bacLePlusFaible(declarations) {
  const nue = declarations.find((d) => d && d.niveau !== 'conteneur');
  if (nue) return nue;
  if (declarations.some((d) => !d?.fournisseur)) {
    return declarations.find((d) => d?.niveau === 'conteneur' && !d.fournisseur) ?? null;
  }
  return declarations.at(-1) ?? null;
}

/**
 * `ruche` porte le transport, et rien d'autre :
 *   · `instantane()`               → `{ status, corps }`
 *   · `creerProjet(corps)`         → `{ status, corps, texte }`
 *   · `creerTaches(projetId, ts)`  → `{ status, corps, texte }` (un seul lot)
 *   · `livrer(taskId)`             → `{ status, corps, texte }` (POST /api/livraison)
 *   · `lire(chemin)`               → `{ status, corps }` (GET authentifié)
 *   · `patienter(ms)`              → une promesse
 *
 * Options : `creer` (`--oui`), `patienceS`, `exigeBac` (`--exige-bac`),
 * `ouvrieres` (`--workers`, 0 = une seule mission), `depot` (`--depot`).
 *
 * Rend, quand tout est réglé et relu :
 *   · une mission : `{ ok: true, mode: 'mission', taskId, faits, livraisons }` ;
 *   · un essaim   : `{ ok: true, mode: 'essaim', projetId, missions, essaim, livraisons }` ;
 * `{ ok: false, plan: true, message }` sans `creer`, `{ ok: false, raison }`
 * sinon. Le JUGEMENT des faits n'est pas ici.
 */
export async function menerLaPreuve(
  ruche,
  {
    creer = false,
    patienceS,
    exigeBac = false,
    ouvrieres = 0,
    depot = null,
    graine = randomUUID().slice(0, 8),
  } = {},
) {
  const essaim = ouvrieres > 0;
  const patience = patienceS ?? (essaim ? PATIENCE_ESSAIM_S : PATIENCE_S);
  const debut = await ruche.instantane();
  if (debut.status !== 200) return rate(`l’instantané rend ${debut.status}`);
  const reelles = ouvrieresReelles(debut.corps);
  if (reelles.length === 0) {
    return rate(
      'aucune ouvrière avec un agent réel en ligne — lancez un nœud dont l’agent ' +
        '(Claude Code, Codex, Cline…) est installé et authentifié ; l’adaptateur « shell » est une simulation',
    );
  }
  const nommer = (noeuds) => noeuds.map((n) => `${n.name ?? n.id} (${n.agentType})`).join(', ');
  const liste = nommer(reelles);
  const familles = new Set(reelles.map((n) => n.agentType)).size;
  if (essaim && (reelles.length < ouvrieres || familles < 2)) {
    return rate(
      `--workers ${ouvrieres} : il faut ${ouvrieres} ouvrières réelles en ligne de 2 familles ` +
        `au moins ; en ligne : ${reelles.length} de ${familles} famille(s) — ${liste}`,
    );
  }
  // Seuls certains adaptateurs donnent à leur CLI les outils du pont : sans
  // aucun d'eux en ligne, la tâche qui délègue ne peut QUE tomber à côté.
  const pontes = reelles.filter((n) => FAMILLES_DELEGANTES.has(n.agentType));
  if (essaim && pontes.length === 0) {
    return rate(
      `--workers ${ouvrieres} : aucune ouvrière en ligne dont l’adaptateur porte le pont de ` +
        `délégation (${[...FAMILLES_DELEGANTES].join(', ')}) — la délégation serait impossible ; ` +
        `en ligne : ${liste}`,
    );
  }
  // La Reine ne sait pas épingler une tâche sur un nœud : sous `--exige-bac`,
  // une seule ouvrière hors conteneur peut prendre la mission ou la relire.
  // Mieux vaut le dire AVANT de dépenser que de le constater après.
  const horsBac = reelles.filter((n) => !enConteneur(n));
  if (exigeBac && horsBac.length > 0) {
    const qui = horsBac
      .map((n) => `${n.name ?? n.id} (${n.isolement?.niveau ?? 'bac non déclaré'})`)
      .join(', ');
    return rate(
      `--exige-bac : ces ouvrières réelles ne déclarent pas de bac conteneur — ${qui}. ` +
        'Relancez-les avec HIVE_ISOLEMENT=exige, ou arrêtez-les : la Reine ne peut pas ' +
        'réserver la mission aux autres',
    );
  }
  // Sans jeton GitHub, la Reine refuse toute livraison (501) — mais seulement
  // au moment de livrer, donc APRÈS la mission. Sa sonde ne dépense rien et ne
  // révèle jamais le jeton. Illisible, elle ne permet pas de promettre une
  // livraison : on s'arrête aussi.
  if (depot) {
    const github = await ruche.lire('/api/github/status');
    if (github.status !== 200 || github.corps?.configure !== true) {
      return rate(
        github.status === 200
          ? '--depot : la Reine n’a pas de jeton GitHub — définissez HIVE_GITHUB_TOKEN dans ' +
              'son environnement et relancez-la, sinon aucune tâche ne serait livrée'
          : `--depot : impossible de savoir si la Reine peut livrer (/api/github/status rend ${github.status})`,
      );
    }
  }

  const missions = essaim
    ? missionsEssaim(ouvrieres, graine)
    : [{ role: 'mission', tache: MISSION, attendu: ATTENDU }];
  if (!creer) {
    const quoi = essaim
      ? `${missions.length} tâches (${ouvrieres} indépendantes, 1 qui délègue)`
      : 'la mission';
    const sansPont = essaim ? reelles.filter((n) => !FAMILLES_DELEGANTES.has(n.agentType)) : [];
    const avertir =
      sansPont.length > 0
        ? ` La tâche qui délègue peut échoir à ${nommer(sansPont)}, ` +
          'sans pont de délégation : la Délégation serait alors inconnue.'
        : '';
    return {
      ok: false,
      plan: true,
      message:
        `prête : ${reelles.length} ouvrière(s) réelle(s) — ${liste}. ` +
        `Relancez avec --oui pour confier ${quoi}` +
        `${depot ? ` sur ${sansIdentifiants(depot)}, puis la livrer` : ''} : ` +
        `elle fait travailler de vrais agents, donc consomme des crédits de leurs comptes.${avertir}`,
    };
  }

  const journal = lecteurJournal(ruche);
  if (!(await journal.amorcer())) {
    return rate('le journal de la Reine (/api/events) est illisible : rien ne serait vérifiable');
  }
  const projet = await ruche.creerProjet({
    name: `Preuve V2 Alpha ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    ...(depot ? { repoUrl: depot } : {}),
  });
  const projetId = projet.corps?.id;
  if (projet.status !== 201 || typeof projetId !== 'string') {
    return rate(`la ruche refuse le projet (${projet.status}) : ${projet.texte ?? ''}`);
  }
  const creation = await ruche.creerTaches(
    projetId,
    missions.map((m) => m.tache),
  );
  const creees = Array.isArray(creation.corps) ? creation.corps : [];
  const ids = creees.map((t) => t?.id).filter((id) => typeof id === 'string' && id !== '');
  if (!creationAcceptee(creation.status) || ids.length !== missions.length) {
    return rate(`la ruche refuse la mission (${creation.status}) : ${creation.texte ?? ''}`);
  }
  const confiees = missions.map((m, i) => ({ ...m, taskId: ids[i] }));
  const qui = essaim ? `l’essaim du projet ${projetId}` : `la mission ${ids[0]}`;

  // ─── ATTENDRE QUE TOUT SOIT RÉGLÉ ───────────────────────────────────────────
  //
  // L'instantané d'abord, le journal ensuite : un événement lu est donc au
  // moins aussi récent que les statuts qu'il complète (cf. `attenteDe`).
  //
  // Chaque relevé garde aussi le DERNIER état connu de chaque nœud et TOUTES
  // ses déclarations de bac (cf. `bacLePlusFaible`) : un nœud arrivé en cours
  // de route, ou reparti, reste nommé avec ce qu'il a déclaré.
  const vus = new Map();
  const releverNoeuds = (corps) => {
    for (const n of Array.isArray(corps?.nodes) ? corps.nodes : []) {
      if (typeof n?.id !== 'string') continue;
      const vu = vus.get(n.id) ?? { noeud: n, declarations: [] };
      const cle = JSON.stringify(n.isolement ?? null);
      if (!vu.declarations.some((d) => JSON.stringify(d ?? null) === cle)) {
        vu.declarations.push(n.isolement ?? null);
      }
      vus.set(n.id, { ...vu, noeud: n });
    }
  };
  releverNoeuds(debut.corps);
  let instantane = debut.corps;
  let evenements = [];
  let attentes = ['aucun tour encore'];
  for (let i = 0; i < patience && attentes.length > 0; i++) {
    await ruche.patienter(1000);
    const tour = await ruche.instantane();
    if (tour.status !== 200) return rate(`l’instantané rend ${tour.status} pendant la mission`);
    const releve = await journal.relever();
    if (releve === null) return rate('le journal de la Reine est devenu illisible');
    releverNoeuds(tour.corps);
    instantane = tour.corps;
    evenements = releve;
    const taches = new Map((instantane?.tasks ?? []).map((t) => [t?.id, t]));
    attentes = productionsDe(ids, evenements)
      .map((id) => attenteDe(id, taches, evenements))
      .filter((a) => a !== null);
  }
  if (attentes.length > 0) {
    const plus = attentes.length > 1 ? ` (et ${attentes.length - 1} autre(s))` : '';
    return rate(`${qui} n’est pas réglée après ${patience} s — ${attentes[0]}${plus}`);
  }

  // ─── RELIRE ─────────────────────────────────────────────────────────────────
  const lire = async (chemin) => {
    const r = await ruche.lire(chemin);
    return r.status === 200 ? r.corps : null;
  };
  const taches = Array.isArray(instantane?.tasks) ? instantane.tasks : [];
  const genome = await lire('/api/genome');
  const workers = await lire('/api/workers');
  const noeudDe = (id) => vus.get(id)?.noeud ?? null;
  // Un exécutant est jugé sur le bac le plus faible qu'il a déclaré ; jamais
  // vu, il reste nommé, sans bac — donc inconnu.
  const executantDe = (id) => {
    const vu = vus.get(id);
    return vu ? { ...vu.noeud, isolement: bacLePlusFaible(vu.declarations) } : { id };
  };

  const faitsDe = async (m) => {
    const id = encodeURIComponent(m.taskId);
    const tache = taches.find((t) => t?.id === m.taskId) ?? null;
    const resultats = (await lire(`/api/tasks/${id}/results`)) ?? [];
    // La production que la Reine garde, par SA règle (cf. `productionRetenue`).
    const retenue = productionRetenue(resultats);
    // Qui a EXÉCUTÉ : tout l'arbre de la tâche — elle, les sous-tâches que son
    // agent a déléguées (à toute profondeur), et chaque relecture de l'une ou
    // l'autre —, lu au journal. Une sous-tâche est un agent lancé pour cette
    // mission : si elle tourne hors du bac, la mission n'a pas tourné dans un
    // bac, et c'est justement le nœud arrivé en cours de route, que la
    // vérification d'avant la mission n'a pas vu, qui la prend.
    const arbre = productionsDe([m.taskId], evenements);
    const lancees = new Set([...arbre, ...arbre.flatMap((t) => relecturesDe(t, evenements))]);
    const executants = [
      ...new Set(
        evenements
          .filter((e) => e.type === 'task_started' && lancees.has(e.payload?.taskId))
          .map((e) => e.payload.nodeId),
      ),
    ].map(executantDe);
    return {
      noeud: noeudDe(retenue?.nodeId ?? tache?.result?.nodeId ?? null),
      executants,
      tache,
      resultats,
      routage: await lire(`/api/tasks/${id}/routage`),
      chronologie: (await lire(`/api/tasks/${id}/chronologie`))?.chronologie ?? null,
      evaluation: await lire(`/api/tasks/${id}/evaluation`),
      genome,
      workers,
      attendu: m.attendu,
    };
  };
  const relues = [];
  for (const m of confiees) {
    relues.push({ taskId: m.taskId, role: m.role, titre: m.tache.title, faits: await faitsDe(m) });
  }

  // ─── LIVRER, SEULEMENT SI UN DÉPÔT A ÉTÉ DONNÉ ──────────────────────────────
  //
  // APRÈS le réglage : une livraison rangée interdit à l'Evaluator de relancer
  // la tâche, elle ne doit donc jamais devancer une contre-revue. Séquentiel,
  // comme la Reine le fait elle-même avec GitHub (limite secondaire).
  //
  // CHAQUE production, sous-tâches déléguées comprises : le diff d'un enfant
  // ne revient à son parent que comme TEXTE d'outil (le pont ne l'applique pas
  // à l'atelier du parent), et la tâche qui délègue n'écrit que sa note. Ne
  // livrer que les tâches confiées laissait donc le travail délégué hors de
  // toute PR, sous une ligne Git ✔.
  const productions = productionsDe(ids, evenements);
  let livraisons = null;
  if (depot) {
    livraisons = [];
    for (const taskId of productions) {
      const r = await ruche.livrer(taskId);
      livraisons.push({ taskId, status: r.status, corps: r.corps, texte: r.texte });
    }
  }

  if (!essaim) {
    return { ok: true, mode: 'mission', taskId: ids[0], faits: relues[0].faits, livraisons };
  }
  const deRole = (role) => confiees.filter((m) => m.role === role).map((m) => m.taskId);
  return {
    ok: true,
    mode: 'essaim',
    projetId,
    missions: relues,
    essaim: {
      requis: ouvrieres,
      noeuds: [...vus.values()].map((v) => v.noeud),
      // Relectures et sous-tâches déléguées naissent dans le projet de la mission.
      taches: taches.filter((t) => t?.projectId === projetId),
      productions,
      independantes: deRole('independante'),
      deleguante: deRole('deleguante')[0],
      evenements,
    },
    livraisons,
  };
}
