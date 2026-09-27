// LES BUTOIRS DU NŒUD, ET LES DÉLAIS QUE LE HUB EN DÉRIVE.
//
// ─── DEUX HORLOGES, UNE SEULE SOURCE ──────────────────────────────────────────
//
// Un travail confié à un nœud hors des tâches — merge, chantier, pose d'outil —
// tourne CHEZ LE NŒUD sous des butoirs : chaque étape qui peut pendre (un clone
// sur un dépôt injoignable, une installation sur un registre muet, un script
// qui boucle) est tuée au-delà du sien. Le hub, lui, déclare PERDU un travail
// qui ne revient pas — sinon un nœud connecté mais muet laissait l'écran sur le
// verdict précédent, pour toujours.
//
// Les deux horloges ne sont pas indépendantes. Un délai du hub PLUS COURT que
// ce que le nœud a le droit de prendre déclare perdu un travail qui tourne
// encore, et écarte ensuite son vrai résultat comme orphelin. C'est arrivé :
// le hub abandonnait un merge au bout de dix minutes quand le nœud pouvait en
// passer quinze à préparer puis tester, clone non compris.
//
// D'où ce module : les butoirs du nœud vivent ICI, le nœud les applique, et le
// hub en DÉRIVE ses délais — jamais un nombre choisi à côté. Changer un butoir
// déplace le délai du hub avec lui.

/**
 * Le clone superficiel d'un merge ou d'un chantier.
 *
 * Il n'avait AUCUN butoir : un dépôt qui accepte la connexion puis se tait —
 * ou, sous Windows, un gestionnaire d'identifiants qui attend une fenêtre que
 * personne ne verra — laissait le travail pendre chez le nœud, et le hub ne
 * pouvait qu'en deviner la durée. Dix minutes pour un clone `--depth 1` : bien
 * au-delà d'un vrai dépôt sur un vrai lien, bien en deçà de « jamais ».
 */
export const CLONE_MS = 10 * 60_000;

/** La préparation d'un chantier (une installation peut pendre sur un registre injoignable). */
export const CHANTIER_PREPARATION_MS = 10 * 60_000;

/** Le script du chantier lui-même. */
export const CHANTIER_EXECUTION_MS = 15 * 60_000;

/**
 * La préparation d'un merge. Plus large que ses tests : une installation
 * complète télécharge, et une machine de membre n'est pas une machine
 * d'intégration continue.
 */
export const MERGE_PREPARATION_MS = 10 * 60_000;

/** La commande de test d'un merge. */
export const MERGE_TESTS_MS = 5 * 60_000;

/** Une pose d'outil. Une installation plus longue que ça a un vrai problème. */
export const POSE_DELAI_MS = 10 * 60_000;

/**
 * Ce que le hub accorde au-delà des butoirs : le transport du résultat, et ce
 * qui n'est pas borné mais reste LOCAL et bref — appliquer des diffs, effacer
 * un répertoire de travail, tuer un arbre de processus.
 */
export const MARGE_RETOUR_NOEUD_MS = 5 * 60_000;

/** Au-delà, le hub déclare perdu un merge sans résultat : clone, préparation, tests. */
export const MERGE_TIMEOUT_MS =
  CLONE_MS + MERGE_PREPARATION_MS + MERGE_TESTS_MS + MARGE_RETOUR_NOEUD_MS;

/** Au-delà, le hub déclare perdu un chantier sans résultat : clone, préparation, script. */
export const CHANTIER_TIMEOUT_MS =
  CLONE_MS + CHANTIER_PREPARATION_MS + CHANTIER_EXECUTION_MS + MARGE_RETOUR_NOEUD_MS;

/** Au-delà, le hub déclare perdue une pose sans résultat. */
export const POSE_TIMEOUT_MS = POSE_DELAI_MS + MARGE_RETOUR_NOEUD_MS;
