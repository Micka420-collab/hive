// L'ENTRÉE D'UN INVITÉ — les décisions du seul parcours qu'on ne jouait jamais.
//
// ─── LE TROU QUE CE MODULE COMBLE ────────────────────────────────────────────
//
// La commande d'entrée en un geste est livrée : `commande-entree.ts` la compose,
// `installeurs-jumeaux` garde la parité de `rejoindre.sh` et `rejoindre.ps1`,
// `invite-panneau` éprouve le bouton qui la remet. Trois bancs, et pas un seul
// qui joue le geste :
//
//     je colle cette commande sur un poste, et j'entre dans la ruche.
//
// C'est la forme EXACTE du trou qu'était le pas 4/5 avant qu'on l'écrive — et
// celui-là a trouvé un défaut réel (`install.ps1` ne construisait pas l'écran)
// à sa toute première exécution sous Windows.
//
// ─── CE QUI EST MESURÉ, ET CE QUI NE L'EST PAS ───────────────────────────────
//
// Mesuré : la ruche remet des commandes d'entrée UTILISABLES, le script d'entrée
// reconnaît une installation déjà là, et l'invité APPARAÎT dans la ruche.
//
// PAS mesuré, et il faut le dire : l'installation depuis zéro par le chemin de
// l'invité. Le dossier d'invité est fabriqué par copie, donc le script prend sa
// branche « déjà installé ». Installer une seconde fois demanderait plusieurs
// minutes et TIRERAIT DU DÉPÔT PUBLIC — c'est-à-dire qu'on mesurerait le code de
// `main`, pas celui qu'on est en train de livrer. Cette moitié-là est déjà tenue
// par les pas 1 à 3, qui installent pour de vrai depuis l'arbre sous essai.
//
// ─── POURQUOI CES DÉCISIONS VIVENT ICI ───────────────────────────────────────
//
// Le module est PUR : il ne connaît ni le réseau ni le disque. C'est ce qui
// permet de le MUTER — un essai de bout en bout, lui, ne se mute pas : on ne
// peut pas fabriquer à volonté une ruche qui refuse un billet ou un script
// d'entrée qui réinstalle par surprise.

/** Ce que le script d'entrée a FAIT, lu dans ce qu'il a dit. */
export const RAISON_ENTREE = {
  rejoint: 'l’installation en place a été reconnue — rien n’a été réinstallé',
  reinstalle:
    'le script a REINSTALLÉ : il tire alors le dépôt public, donc l’essai mesure `main` et non l’arbre livré',
  inconnu: 'le script d’entrée n’a dit ni l’un ni l’autre — on ne sait pas ce qu’il a fait',
};

/**
 * Le script d'entrée a-t-il rejoint, ou tout réinstallé ?
 *
 * ─── POURQUOI CETTE QUESTION N'EST PAS COSMÉTIQUE ──────────────────────────
 *
 * `rejoindre.sh` promet qu'une ruche déjà installée n'est pas refaite sous les
 * pieds de son propriétaire. Mais pour l'ESSAI, l'enjeu est plus dur : la
 * branche « installer » va chercher `install.sh` SUR LE DÉPÔT PUBLIC. Prise par
 * accident — un `node_modules` oublié dans le dossier d'invité suffit — l'essai
 * durerait des minutes et mesurerait le code de `main` au lieu de celui qu'on
 * livre, en restant parfaitement VERT.
 *
 * Un essai qui mesure la mauvaise version sans le dire est pire qu'un essai
 * absent : il porte un verdict qu'on croit.
 *
 * Les deux marqueurs cherchés sont ceux que les DEUX jumeaux impriment — le
 * PowerShell écrit sans accents (§ le mojibake de la console Windows), donc on
 * ne cherche que des mots qui survivent aux deux graphies.
 *
 * @param {string} sortie ce que le script d'entrée a imprimé
 * @returns {'rejoint'|'reinstalle'|'inconnu'}
 */
export function verdictEntree(sortie) {
  const dit = String(sortie ?? '');
  // L'ordre compte : la branche « installer » imprime sa ligne PUIS rejoint. Un
  // texte qui porte les deux marqueurs a donc bien réinstallé, et c'est ce
  // verdict-là qui doit l'emporter.
  if (dit.includes('Installation de Hive')) return 'reinstalle';
  if (dit.includes('on rejoint directement')) return 'rejoint';
  return 'inconnu';
}

/**
 * Ce qui manque à un billet fraîchement frappé pour être COLLABLE, ou `null`.
 *
 * ─── CE QUE LA RUCHE VIVANTE PEUT SEULE PROUVER ────────────────────────────
 *
 * `commande-entree.ts` est éprouvé sur des billets fabriqués à la main. Ce qu'un
 * banc pur ne peut pas dire, c'est que la ROUTE remet vraiment ces commandes :
 * `POST /api/billets` pourrait cesser de les composer — un champ renommé, une
 * réponse recopiée d'une version antérieure — sans qu'aucun test unitaire ne
 * bouge. Le panneau retomberait alors sur `joinCommand`, et l'invité se
 * retrouverait devant le parcours en deux temps qu'on vient de retirer.
 *
 * On exige donc les deux systèmes, et que chacun PORTE le billet : une commande
 * qui ne le contient pas est une commande qui n'ouvre rien.
 *
 * @param {unknown} reponse le corps de `POST /api/billets`
 * @returns {string|null} la phrase du défaut, ou `null` si tout est là
 */
export function defautDuBillet(reponse) {
  const r = reponse ?? {};
  const billet = r.billet;
  if (typeof billet !== 'string' || !billet.startsWith('hive2_')) {
    return 'la ruche n’a pas remis de billet `hive2_…`';
  }
  const entree = r.entree;
  if (entree === null || typeof entree !== 'object') {
    return 'la ruche remet un billet SANS commandes d’entrée — l’invité retombe sur le parcours en deux temps';
  }
  for (const systeme of ['posix', 'windows']) {
    const commande = entree[systeme];
    if (typeof commande !== 'string' || commande === '') {
      return `la commande d’entrée ${systeme} est absente`;
    }
    if (!commande.includes(billet)) {
      return `la commande d’entrée ${systeme} ne porte pas le billet — elle n’ouvre rien`;
    }
  }
  // Deux systèmes, deux invocations. Le jour où l'on factorise, rien ne doit
  // rendre la même chaîne des deux côtés : un invité Windows à qui l'on donne la
  // commande POSIX n'a aucun moyen de le savoir avant de l'avoir collée.
  if (entree.posix === entree.windows) {
    return 'les deux commandes d’entrée sont identiques — l’une des deux ne marchera nulle part';
  }
  return null;
}

/**
 * L'identifiant d'un nœud que la ruche ne connaissait PAS avant, ou `null`.
 *
 * ─── POURQUOI « AU MOINS UN NŒUD » NE MESURERAIT RIEN ──────────────────────
 *
 * L'essai de seuil lance `npm run ruche` sans drapeau : la Reine, UNE OUVRIÈRE,
 * et l'écran. Il y a donc déjà un nœud connecté quand l'invité arrive. Une garde
 * qui compterait les nœuds serait verte AVANT même que le script d'entrée ne
 * soit lancé — un test qui ne peut pas rougir est du décor.
 *
 * On relève donc les nœuds AVANT, et on cherche celui qui n'y était pas.
 *
 * @param {unknown} instantane le corps de `GET /api/state`
 * @param {Set<string>|string[]} dejaVus les identifiants relevés avant l'entrée
 * @returns {string|null}
 */
export function nouveauNoeud(instantane, dejaVus) {
  const noeuds = instantane?.nodes;
  if (!Array.isArray(noeuds)) return null;
  const avant = dejaVus instanceof Set ? dejaVus : new Set(dejaVus ?? []);
  for (const n of noeuds) {
    const id = n?.id;
    if (typeof id === 'string' && id !== '' && !avant.has(id)) return id;
  }
  return null;
}

/**
 * Les identifiants des nœuds d'un instantané — le relevé d'AVANT.
 *
 * Rendu comme un `Set` parce que c'est ainsi qu'il sera interrogé, et vide
 * plutôt que `null` quand la ruche n'en a aucun : « je n'ai vu personne » et
 * « je n'ai pas pu regarder » se distinguent chez l'appelant, qui sait, lui, si
 * sa requête a abouti.
 */
export function noeudsConnus(instantane) {
  const noeuds = instantane?.nodes;
  if (!Array.isArray(noeuds)) return new Set();
  return new Set(noeuds.map((n) => n?.id).filter((id) => typeof id === 'string' && id !== ''));
}
