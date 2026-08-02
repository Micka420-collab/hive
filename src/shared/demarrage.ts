// Ce que « lancer la ruche » veut dire — MODULE PUR.
//
// (Nommé `demarrage` et non `essaim` : `src/orchestrator/essaim.ts` existe déjà
// et parle d'autre chose — le runner d'autonomie. Deux fichiers homonymes dans
// un même dépôt sont deux occasions de lire le mauvais.)
//
// ─── LE DÉFAUT QUE CE MODULE RETIRE ─────────────────────────────────────────
//
// Faire tourner une ruche demandait TROIS terminaux, et l'écran final de
// l'installeur listait cinq commandes sans dire lesquelles vont ensemble :
//
//     npm run dev              l'orchestrateur
//     npm run node             le nœud, qui exécute vraiment
//     npm run dev:dashboard    l'écran, sur un autre port
//
// Quelqu'un qui n'en lance qu'une voit une ruche qui « ne fait rien » — sans
// nœud, aucune tâche n'est exécutée — ou un écran vide. Les trois pièces sont
// nécessaires et rien ne le disait.
//
// ─── POURQUOI ON NE PASSE PAS PAR `npm` ─────────────────────────────────────
//
// Sous Windows, `npm` est `npm.cmd`, et `spawn(…, { shell: false })` ne sait
// pas lancer un `.cmd` — c'est le § 6.2 du journal, et le même défaut a déjà
// mordu deux fois dans ce dépôt. On vise donc le SCRIPT RÉEL de chaque outil et
// on lance Node dessus, exactement comme `agent-windows.ts` le fait pour Claude
// Code.
//
// C'est plus strict que d'autoriser un interpréteur, pas moins : on sait
// précisément quel fichier s'exécute.
//
// ─── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
//
// Il ne lance rien. Il CALCULE les trois commandes. C'est ce qui rend la
// composition — donc la partie où l'on se trompe de chemin ou d'ordre —
// vérifiable sans démarrer un serveur, sur les trois plateformes, depuis
// n'importe laquelle.

import path from 'node:path';

/** Un membre de l'essaim à démarrer. */
export interface Piece {
  /** Nom court affiché en tête de chaque ligne de sa sortie. */
  readonly nom: string;
  /** L'exécutable — toujours un vrai binaire, jamais un shim. */
  readonly bin: string;
  /** Ses arguments, en TABLEAU : rien n'est redécoupé par un interpréteur. */
  readonly argv: readonly string[];
  /** Ce qu'on en attend, dit à l'humain au démarrage. */
  readonly role: string;
}

/** Ce qu'on veut démarrer. Tout est facultatif : le défaut est « tout ». */
export interface Voeu {
  /** L'orchestrateur — la Reine, qui garde projets, tâches et journal. */
  readonly hub?: boolean;
  /** Le nœud, qui exécute réellement le travail avec votre agent. */
  readonly noeud?: boolean;
  /** L'écran de développement (Vite), sur son propre port. */
  readonly ecran?: boolean;
}

/**
 * Les scripts réels des outils, relatifs à la racine du dépôt.
 *
 * Écrits une fois ici plutôt que dispersés : le jour où `tsx` change de chemin
 * d'entrée, il y a UN endroit à corriger, et un test qui vérifie que ces
 * fichiers existent vraiment sur le disque.
 */
export const SCRIPTS = {
  tsx: path.join('node_modules', 'tsx', 'dist', 'cli.mjs'),
  vite: path.join('node_modules', 'vite', 'bin', 'vite.js'),
} as const;

/** Les points d'entrée de la ruche, relatifs à la racine du dépôt. */
export const ENTREES = {
  hub: path.join('src', 'orchestrator', 'main.ts'),
  noeud: path.join('src', 'node-client', 'main.ts'),
} as const;

/**
 * Les pièces à lancer, dans l'ordre où elles doivent démarrer.
 *
 * L'ORDRE COMPTE, et c'est la seule subtilité de ce module : le nœud se
 * connecte au hub. Le lancer en premier lui fait manquer sa cible, il
 * reconnecte — ça marche, mais l'humain lit une erreur de connexion au
 * démarrage de sa toute première ruche, ce qui est le pire moment pour en voir
 * une.
 *
 * `node` est `process.execPath` chez l'appelant : le Node qui tourne DÉJÀ. Pas
 * celui du PATH, qui peut être un autre — et pas un shim, donc lançable sans
 * interpréteur sur les trois plateformes.
 */
export function pieces(noeud: string, voeu: Voeu = {}): Piece[] {
  const tout = voeu.hub === undefined && voeu.noeud === undefined && voeu.ecran === undefined;
  const veut = (q: boolean | undefined): boolean => (tout ? true : q === true);

  const liste: Piece[] = [];
  if (veut(voeu.hub)) {
    liste.push({
      nom: 'reine',
      bin: noeud,
      argv: [SCRIPTS.tsx, ENTREES.hub],
      role: 'projets, tâches, journal · http://127.0.0.1:7777',
    });
  }
  if (veut(voeu.noeud)) {
    liste.push({
      nom: 'ouvrière',
      bin: noeud,
      argv: [SCRIPTS.tsx, ENTREES.noeud],
      role: 'exécute le travail avec votre agent',
    });
  }
  if (veut(voeu.ecran)) {
    liste.push({
      nom: 'écran',
      bin: noeud,
      argv: [SCRIPTS.vite, 'dashboard'],
      role: 'Mission Control · http://localhost:5173',
    });
  }
  return liste;
}

/**
 * Lit les drapeaux de la ligne de commande.
 *
 * Sans drapeau, on lance TOUT — c'est la demande d'origine : une commande, une
 * ruche complète. Les drapeaux servent à en retirer, jamais à en ajouter, parce
 * qu'une ruche incomplète est un choix qu'on doit énoncer.
 */
export function voeuDepuisArgv(argv: readonly string[]): Voeu {
  const a = new Set(argv);

  // ─── SOUSTRACTIFS, ET DONC CUMULABLES ──────────────────────────────────────
  //
  // La première version était un aiguillage à retours successifs :
  //
  //     if (a.has('--sans-ecran')) return { hub: true, noeud: true };
  //     if (a.has('--sans-noeud')) return { hub: true, ecran: true };
  //
  // `--sans-ecran --sans-noeud` — les deux drapeaux documentés côte à côte, la
  // combinaison naturelle pour « la Reine SEULE » — rendait au PREMIER testé.
  // L'ouvrière démarrait quand même : celle qui exécute du code avec votre
  // agent, sur votre machine, alors qu'on venait de demander qu'elle ne
  // démarre pas.
  //
  // Le commentaire deux lignes plus haut disait pourtant déjà la règle : « les
  // drapeaux servent à en RETIRER ». Il décrivait une intention, le code
  // faisait un aiguillage. On part donc de tout, et on éteint.
  const v = { hub: true, noeud: true, ecran: true };
  if (a.has('--sans-ecran')) v.ecran = false;
  if (a.has('--sans-noeud')) v.noeud = false;
  // `--ecran-seul` reste un cas à part : il ne retire pas une pièce, il en
  // désigne une. C'est le seul drapeau ADDITIF, et il le dit dans son nom.
  if (a.has('--ecran-seul')) return { ecran: true };
  // Aucun drapeau : on rend le vœu VIDE, que `pieces` lit comme « tout ». Rendre
  // `{hub:true,noeud:true,ecran:true}` serait équivalent aujourd'hui et
  // masquerait demain la distinction entre « je n'ai rien demandé » et « j'ai
  // demandé les trois ».
  if (v.hub && v.noeud && v.ecran) return {};
  return v;
}

/**
 * Le préfixe d'une ligne de sortie, aligné sur la plus longue étiquette.
 *
 * Trois processus qui écrivent dans le même terminal sans préfixe donnent un
 * journal illisible où l'on ne sait plus qui se plaint. L'alignement n'est pas
 * cosmétique : c'est ce qui permet de suivre une colonne du regard.
 */
export function prefixe(nom: string, largeurNom: number): string {
  return `${nom.padEnd(largeurNom)} │ `;
}

/** La largeur d'étiquette à retenir pour un lot de pièces. */
export function largeurEtiquettes(liste: readonly Piece[]): number {
  return liste.reduce((m, p) => Math.max(m, [...p.nom].length), 0);
}
