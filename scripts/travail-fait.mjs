// LE PAS 7/7 — « la ruche a-t-elle réellement travaillé ? », en décisions pures.
//
// ─── LE TROU QUE CE FICHIER SERT À FERMER ────────────────────────────────────
//
// Le parcours de seuil comptait six pas, et s'arrêtait un cran trop tôt :
//
//     1/3  l'installation sort en 0
//     2/3  le .env est écrit
//     3/3  la ruche répond
//     4/5  le tableau est servi et charge son paquet
//     5/5  un premier projet est créé, et visible
//     6/6  un invité colle la commande, et il est dans la ruche
//
// Six affirmations, et pas une qui mène une tâche jusqu'à un résultat.
// L'arrivant y est à sa troisième minute, et c'est la SEULE chose que Hive
// promet : qu'une ouvrière prenne un travail et rende quelque chose. Si ce
// chemin cassait dans une version publiée, rien en CI ne le verrait.
//
// ─── POURQUOI LES DÉCISIONS SONT ICI, ET PAS DANS LE COUREUR ─────────────────
//
// Même raison que `entree-invite.mjs` et `premier-quart-heure.mjs` : un verdict
// enfoui dans un script qui lance des processus ne s'éprouve qu'en installant
// une ruche. Sorti ici, il se mute et se rejoue en millisecondes — et c'est LUI
// qui décide, pas le décor autour.
//
// ─── CE QU'UN « FAIT » DOIT PROUVER, ET QUE « done » NE PROUVE PAS ───────────
//
// Un statut `done` est déclaratif : c'est la ruche qui parle d'elle-même. Quatre
// choses de plus séparent « la ruche dit qu'elle a fini » de « la ruche a
// travaillé », et chacune a déjà sa façon de casser en silence :
//
//   · un résultat est RANGÉ           sinon `done` n'est appuyé sur rien ;
//   · l'un d'eux est en SUCCÈS        un échec fini est fini, pas réussi ;
//   · il porte un DIFF non vide       « produit quelque chose » est la promesse ;
//   · son nœud est CONNU de la ruche  sinon le travail est mis au compte d'un
//                                     fantôme, et le tableau montrera un nom
//                                     qui ne désigne personne.

/** Ce que le pas peut conclure de l'état d'une tâche. */
export const EN_COURS = 'en-cours';
export const FAITE = 'faite';
export const RATEE = 'ratee';
export const DISPARUE = 'disparue';

/**
 * L'état d'une tâche, tel que l'instantané que LIT LE TABLEAU le montre.
 *
 * `DISPARUE` n'est pas un détail : `getSnapshot()` porte une `LIMIT`, donc une
 * tâche peut sortir du champ. La confondre avec `EN_COURS` ferait attendre le
 * pas jusqu'à sa patience entière, puis rendre « rien n'a bougé » — un rouge qui
 * accuse l'ouvrière alors que c'est la fenêtre qui a glissé.
 */
export function etatDeLaTache(instantane, taskId) {
  const taches = Array.isArray(instantane?.tasks) ? instantane.tasks : [];
  const tache = taches.find((t) => t?.id === taskId);
  if (!tache) return DISPARUE;
  if (tache.status === 'done') return FAITE;
  if (tache.status === 'failed') return RATEE;
  return EN_COURS;
}

/** Les identifiants des nœuds que la ruche connaît. */
export function noeudsDe(instantane) {
  const noeuds = Array.isArray(instantane?.nodes) ? instantane.nodes : [];
  return new Set(noeuds.map((n) => n?.id).filter((id) => typeof id === 'string' && id !== ''));
}

/**
 * Ce qui manque à un travail pour être prouvé, ou `null` s'il ne manque rien.
 *
 * Rend une PHRASE, jamais un booléen : c'est elle qu'un lecteur de journal de CI
 * verra, et « faux » ne lui apprendrait pas où regarder.
 */
export function defautDuTravail(lignes, noeudsConnus) {
  const rangees = Array.isArray(lignes) ? lignes : [];
  if (rangees.length === 0) {
    return 'la tâche est déclarée faite, mais aucun résultat n’est rangé — « done » n’appuie sur rien';
  }
  const gagnante = rangees.find((r) => r?.success === true);
  if (!gagnante) {
    return `aucun des ${rangees.length} résultat(s) n’est un succès — la tâche a fini, elle n’a pas abouti`;
  }
  if (typeof gagnante.diff !== 'string' || gagnante.diff.trim() === '') {
    return 'le résultat en succès ne porte aucun diff — la ruche a fini sans rien produire';
  }
  if (!noeudsConnus.has(gagnante.nodeId)) {
    return `le travail est mis au compte de « ${gagnante.nodeId} », que la ruche ne connaît pas`;
  }
  return null;
}
