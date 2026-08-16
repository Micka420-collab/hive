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
  const gagnante = gagnanteDe(rangees);
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

// ─── CE QUE LA LOUPE A RENVOYÉ ICI, ET POURQUOI ──────────────────────────────
//
// Le coureur `essai-travail.mjs` a d'abord gardé six décisions que ce module
// aurait dû porter. La loupe les a toutes nommées « SANS TEST » — sept lignes,
// dont l'acceptation de la tâche. Elles sont descendues ici, où elles se mutent
// et se rejouent en millisecondes.
//
// La septième — la borne `i < argv.length` d'une boucle de lecture d'arguments —
// est un mutant ÉQUIVALENT, déjà mesuré sous cette forme dans
// `essai-parcours.mjs` : `<=` ajoute un tour où `argv[i]` vaut `undefined`, qui
// ne correspond à aucun drapeau. Consigné à la ligne, pas défendu par un cas.

/** La racine demandée en ligne de commande, ou `null` si elle manque. */
export function racineDemandee(argv) {
  const vus = Array.isArray(argv) ? argv : [];
  let racine = null;
  // loupe : équivalent — < → <=
  // Un tour de plus lit `argv[i] === undefined`, qui n'est aucun drapeau connu.
  for (let i = 0; i < vus.length; i++) {
    if (vus[i] === '--racine') racine = vus[i + 1] ?? null;
  }
  return racine;
}

/**
 * La ruche a-t-elle ACCEPTÉ la tâche ?
 *
 * `201` est ce que la route rend ; `200` est toléré parce qu'un intermédiaire
 * peut le normaliser. Tout le reste est un refus — et c'est la garde la plus
 * chère du pas : sans elle, un `500` passerait pour une création réussie, et
 * l'instrument de seuil déclarerait vert un produit qui vient de refuser.
 */
export function creationAcceptee(status) {
  return status === 200 || status === 201;
}

/**
 * L'identifiant de la tâche créée, ou `null` si la réponse n'en porte pas.
 *
 * La route rend le TABLEAU des tâches (`reply.code(201).send(created)`), pas un
 * objet qui les enveloppe. Lu sur le contrat : une enveloppe supposée aurait
 * rendu `undefined` et fait échouer le pas sur sa propre lecture, en accusant la
 * ruche.
 */
export function identifiantCree(corps) {
  if (!Array.isArray(corps)) return null;
  const id = corps[0]?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Le résultat en succès, ou `undefined` — la ligne qui PROUVE le travail. */
export function gagnanteDe(lignes) {
  return (Array.isArray(lignes) ? lignes : []).find((r) => r?.success === true);
}

/** Faut-il continuer d'attendre ? Seul `EN_COURS` le justifie. */
export function doitAttendre(etat) {
  return etat === EN_COURS;
}

/**
 * Ce qu'un état de FIN interdit de conclure, ou `null` si l'on peut poursuivre.
 *
 * Trois fins distinctes, trois phrases distinctes. Les confondre ferait chercher
 * la panne au mauvais endroit : « court encore » accuse la lenteur, « a quitté
 * l'instantané » accuse la fenêtre, « l'a raté » accuse l'ouvrière.
 */
export function refusDeLEtat(etat, taskId, patienceS) {
  const court = typeof taskId === 'string' ? taskId.slice(0, 8) : '?';
  if (etat === EN_COURS) return `la tâche ${court}… court encore après ${patienceS} s`;
  if (etat === DISPARUE) return `la tâche ${court}… a quitté l’instantané sans jamais y finir`;
  if (etat === RATEE) return `la ruche a pris le travail et l’a raté (${court}…)`;
  return null;
}
