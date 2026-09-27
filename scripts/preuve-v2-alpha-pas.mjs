// LA SÉQUENCE DE LA PREUVE V2 ALPHA — une vraie mission, confiée à une vraie
// ouvrière, puis relue critère par critère.
//
// La séquence reçoit sa ruche (le transport) et ne décide rien d'elle-même :
// le verdict est dans `preuve-v2-alpha-verdict.mjs`. Elle est donc jouable
// contre une ruche de laboratoire ET contre une vraie Reine.
//
// ─── CE QU'ELLE REFUSE DE FAIRE SANS QU'ON LE LUI DISE ──────────────────────
//
// Confier la mission fait travailler un VRAI agent : cela consomme les crédits
// de son compte. Sans `creer: true` (le drapeau `--oui` du coureur), la
// séquence s'arrête après avoir dit ce qu'elle ferait et avec qui.

import { creationAcceptee, identifiantCree } from './travail-fait.mjs';

const AGENTS_SIMULES = new Set(['shell']);
const FINS = new Set(['done', 'failed', 'cancelled']);

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

const rate = (raison) => ({ ok: false, raison });

/** Les ouvrières en ligne dont l'agent n'est pas une simulation. */
export function ouvrieresReelles(instantane) {
  const noeuds = Array.isArray(instantane?.nodes) ? instantane.nodes : [];
  return noeuds.filter((n) => n?.status === 'online' && !AGENTS_SIMULES.has(n?.agentType));
}

/**
 * `ruche` porte le transport, et rien d'autre :
 *   · `instantane()`              → `{ status, corps }`
 *   · `creerProjet(corps)`        → `{ status, corps, texte }`
 *   · `creerTache(projetId, t)`   → `{ status, corps, texte }`
 *   · `lire(chemin)`              → `{ status, corps }` (GET authentifié)
 *   · `patienter(ms)`             → une promesse
 *
 * Rend `{ ok: true, taskId, faits }` quand la mission est terminée et relue,
 * `{ ok: false, plan: true, message }` sans `creer`, `{ ok: false, raison }`
 * sinon. Le JUGEMENT des faits n'est pas ici.
 */
export async function menerLaPreuve(ruche, { creer = false, patienceS = PATIENCE_S } = {}) {
  const debut = await ruche.instantane();
  if (debut.status !== 200) return rate(`l’instantané rend ${debut.status}`);
  const reelles = ouvrieresReelles(debut.corps);
  if (reelles.length === 0) {
    return rate(
      'aucune ouvrière avec un agent réel en ligne — lancez un nœud dont l’agent ' +
        '(Claude Code, Codex, Cline…) est installé et authentifié ; l’adaptateur « shell » est une simulation',
    );
  }
  const liste = reelles.map((n) => `${n.name ?? n.id} (${n.agentType})`).join(', ');
  if (!creer) {
    return {
      ok: false,
      plan: true,
      message:
        `prête : ${reelles.length} ouvrière(s) réelle(s) — ${liste}. ` +
        'Relancez avec --oui pour confier la mission : elle fait travailler un vrai agent, ' +
        'donc consomme des crédits de son compte.',
    };
  }

  const projet = await ruche.creerProjet({
    name: `Preuve V2 Alpha ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
  });
  const projetId = projet.corps?.id;
  if (projet.status !== 201 || typeof projetId !== 'string') {
    return rate(`la ruche refuse le projet (${projet.status}) : ${projet.texte ?? ''}`);
  }
  const creation = await ruche.creerTache(projetId, MISSION);
  const taskId = identifiantCree(creation.corps);
  if (!creationAcceptee(creation.status) || taskId === null) {
    return rate(`la ruche refuse la mission (${creation.status}) : ${creation.texte ?? ''}`);
  }

  let instantane = debut.corps;
  let tache = null;
  for (let i = 0; i < patienceS; i++) {
    await ruche.patienter(1000);
    const tour = await ruche.instantane();
    if (tour.status !== 200) return rate(`l’instantané rend ${tour.status} pendant la mission`);
    instantane = tour.corps;
    tache = (instantane?.tasks ?? []).find((t) => t?.id === taskId) ?? null;
    if (tache && FINS.has(tache.status)) break;
  }
  if (!tache || !FINS.has(tache.status)) {
    return rate(`la mission ${taskId} n’est pas terminée après ${patienceS} s`);
  }

  const lire = async (chemin) => {
    const r = await ruche.lire(chemin);
    return r.status === 200 ? r.corps : null;
  };
  const id = encodeURIComponent(taskId);
  const resultats = (await lire(`/api/tasks/${id}/results`)) ?? [];
  const retenue = [...resultats].reverse().find((r) => r?.success === true) ?? resultats.at(-1);
  const nodeId = retenue?.nodeId ?? tache.result?.nodeId ?? null;
  const noeud = (instantane?.nodes ?? []).find((n) => n?.id === nodeId) ?? null;

  return {
    ok: true,
    taskId,
    faits: {
      noeud,
      tache,
      resultats,
      routage: await lire(`/api/tasks/${id}/routage`),
      chronologie: (await lire(`/api/tasks/${id}/chronologie`))?.chronologie ?? null,
      evaluation: await lire(`/api/tasks/${id}/evaluation`),
      genome: await lire('/api/genome'),
      workers: await lire('/api/workers'),
      attendu: ATTENDU,
    },
  };
}
