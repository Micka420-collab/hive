// LE PAS 7/7, SA SÉQUENCE — le chef d'orchestre, séparé de son transport.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Le coureur `essai-travail.mjs` déclarait ne garder que l'impur. La loupe l'a
// démenti deux fois de suite : d'abord six DÉCISIONS (descendues dans
// `travail-fait.mjs`), puis quatre lignes de CÂBLAGE — celles qui relient une
// décision à un refus :
//
//     if (r.status !== 200) rate(…)                        l'instantané refusé
//     if (noeudsDe(avant).size === 0) { … }                aucune ouvrière
//     for (… && doitAttendre(etat); i++)                   la patience
//     if (defaut !== null) rate(…)                         le verdict IGNORÉ
//
// Aucune n'est équivalente. La dernière est la pire : inversée, **le pas ignore
// son propre verdict** — il constate le défaut et annonce quand même le succès.
// C'est l'instrument qui ment, le défaut contre lequel ce pas a été écrit.
//
// ─── CE QUI LES RENDAIT INÉPROUVABLES, ET CE QUI CHANGE ──────────────────────
//
// Elles étaient soudées à `fetch`. Les jouer demandait une ruche installée, un
// port libre et quatre-vingt-dix secondes — c'est-à-dire qu'on ne les jouait
// pas. Ici la SÉQUENCE reçoit sa ruche : un banc lui en donne une de laboratoire
// qui refuse, qui n'a pas d'ouvrière, qui ne finit jamais, ou qui rend un
// travail sans preuve.
//
// Le coureur, lui, n'a plus que trois choses : lire le `.env`, fabriquer la
// vraie ruche, imprimer. Cette fois, c'est la loupe qui le dira.
//
// ─── CE QUE LA SÉQUENCE REND, ET POURQUOI PAS UNE EXCEPTION ──────────────────
//
// `{ ok: true, message }` ou `{ ok: false, raison }`. Une exception donnerait
// une trace de pile là où il faut une phrase — le reproche que ce dépôt fait
// depuis `essai-parcours.mjs`, et qui vaut autant pour une séquence testable :
// un banc qui doit attraper pour juger lit moins bien qu'un banc qui compare.

import {
  EN_COURS,
  creationAcceptee,
  defautDuTravail,
  doitAttendre,
  etatDeLaTache,
  gagnanteDe,
  identifiantCree,
  noeudsDe,
  refusDeLEtat,
} from './travail-fait.mjs';

/** Le travail qu'on confie. Nommé ici : le banc et le coureur en parlent. */
export const TRAVAIL = {
  title: 'Le premier travail de la ruche',
  prompt: 'Remplacer la cire par du miel dans le fichier d’essai.',
};

/** Combien de tours d'une seconde on laisse à l'ouvrière. */
export const PATIENCE_S = 90;

const rate = (raison) => ({ ok: false, raison });

/**
 * Mène le pas de bout en bout.
 *
 * `ruche` porte le transport, et rien d'autre :
 *   · `instantane()`            → `{ status, corps }`
 *   · `creerTache(projetId, t)` → `{ status, corps, texte }`
 *   · `resultats(taskId)`       → `{ status, corps }`
 *   · `patienter(ms)`           → une promesse qui se résout
 */
export async function menerLePas(ruche, patienceS = PATIENCE_S) {
  const lire = async () => {
    const r = await ruche.instantane();
    if (r.status !== 200) return rate(`l’instantané rend ${r.status}`);
    return { ok: true, corps: r.corps };
  };

  const debut = await lire();
  if (!debut.ok) return debut;
  const avant = debut.corps;

  // ─── LE PROJET DU PAS 5/5 ──────────────────────────────────────────────────
  //
  // On réutilise celui que le parcours vient de créer plutôt que d'en faire un
  // autre : c'est le projet de l'arrivant, et confier le travail ailleurs
  // mesurerait un chemin que personne n'emprunte.
  const projet = (avant?.projects ?? [])[0];
  if (!projet?.id) return rate('aucun projet dans la ruche : le pas 5/5 aurait dû en laisser un');

  // ─── ET UNE OUVRIÈRE POUR LE PRENDRE ───────────────────────────────────────
  //
  // Vérifié AVANT de confier quoi que ce soit. Sans ouvrière, la tâche resterait
  // en file jusqu'à la patience entière, et le refus dirait « rien n'a bougé » —
  // en accusant l'exécution alors que personne n'était là pour exécuter.
  if (noeudsDe(avant).size === 0) {
    return rate('aucune ouvrière dans la ruche : personne ne peut prendre le travail');
  }

  const creation = await ruche.creerTache(projet.id, TRAVAIL);
  if (!creationAcceptee(creation.status)) {
    return rate(`la ruche refuse la tâche (${creation.status}) : ${creation.texte ?? ''}`);
  }
  const taskId = identifiantCree(creation.corps);
  if (taskId === null) {
    return rate(
      `la ruche accepte la tâche sans rendre d’identifiant : ${JSON.stringify(creation.corps)}`,
    );
  }

  // ─── ON REGARDE, ON NE DORT PAS UN TEMPS FIXE ──────────────────────────────
  //
  // Une attente en dur est un pari sur la vitesse de la machine (§ 9
  // octoquadragies). On interroge la ruche jusqu'à ce que la tâche ait FINI —
  // d'une façon ou d'une autre.
  let etat = EN_COURS;
  let vu = avant;
  for (let i = 0; i < patienceS && doitAttendre(etat); i++) {
    await ruche.patienter(1000);
    const tour = await lire();
    if (!tour.ok) return tour;
    vu = tour.corps;
    etat = etatDeLaTache(vu, taskId);
  }

  const refus = refusDeLEtat(etat, taskId, patienceS);
  if (refus !== null) return rate(refus);

  // ─── « FAITE » NE SUFFIT PAS : ON DEMANDE LA PREUVE ────────────────────────
  //
  // Le statut est déclaratif. Ce qui prouve le travail, c'est le résultat rangé :
  // un succès, un diff non vide, et un nœud que la ruche connaît.
  const resultats = await ruche.resultats(taskId);
  if (resultats.status !== 200) {
    return rate(`les résultats de la tâche rendent ${resultats.status}`);
  }
  const lignes = resultats.corps;
  const defaut = defautDuTravail(lignes, noeudsDe(vu));
  if (defaut !== null) return rate(defaut);

  const gagnante = gagnanteDe(lignes);
  return {
    ok: true,
    message:
      `une tâche a été confiée, exécutée par ${gagnante.nodeId} ` +
      `et rendue avec ${gagnante.diff.length} signes de diff (${taskId.slice(0, 8)}…)`,
  };
}
