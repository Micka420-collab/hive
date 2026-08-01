// L'AMORCE — le seul code de ce dépôt qui doit tourner quand RIEN n'est installé.
//
// ─── LE DÉFAUT QU'ELLE RÉPARE ────────────────────────────────────────────────
//
// `scripts/ruche.mjs` contenait déjà, dès sa première version, un contrôle
// soigneux de ce qui manque, placé « AVANT de lancer quoi que ce soit ». Il
// n'a jamais pu s'afficher une seule fois.
//
// La raison tient dans la ligne qui le lançait :
//
//     node --import tsx scripts/ruche.mjs
//
// `--import tsx` est résolu par Node AVANT la première instruction du fichier.
// Sur une copie où les dépendances manquent, Node meurt à la résolution, et le
// message soigné se trouve derrière la porte qu'il était censé garder :
//
//     Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from
//     C:\Users\micki\Desktop\hive-main\
//
// Le même piège tenait `hive doctor` — l'outil dont le métier ENTIER est de
// dire ce qui manque — puisque `npm run cli` invoquait le binaire `tsx` :
//
//     'tsx' n'est pas reconnu en tant que commande interne ou externe
//
// Un diagnostic qui exige que tout aille bien pour pouvoir s'exécuter ne
// diagnostique rien. C'est le § 9 bis du journal sous un nouveau visage : un
// chemin que personne n'exécute et que tout le monde croit bon.
//
// ─── D'OÙ LES DEUX RÈGLES DE CE FICHIER ──────────────────────────────────────
//
// 1. ZÉRO DÉPENDANCE, et du JavaScript nu. Pas de TypeScript, donc pas de tsx ;
//    pas d'import d'un module du dépôt. Ce fichier doit s'exécuter sur une
//    archive fraîchement dézippée où `node_modules` n'existe pas.
// 2. LE VERDICT EST PUR. `verdict()` ne lit ni disque ni environnement : on lui
//    passe l'état. Les cas « Node trop vieux », « rien d'installé », « seules
//    les dépendances de développement manquent » deviennent donc des
//    assertions, sur une machine où tout est justement installé.

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * La version de Node en dessous de laquelle on refuse de démarrer.
 *
 * Elle DOIT valoir ce que `engines.node` annonce dans `package.json` : npm
 * n'impose ce champ que si l'on a demandé `engine-strict`, personne ne l'a
 * demandé, et une installation sous une version trop ancienne « réussit » en
 * laissant une ruche qui casse plus tard, sur une erreur de syntaxe qui ne
 * nomme pas Node. `tests/amorce.test.mjs` confronte les trois énoncés de cette
 * même exigence : ici, `engines.node`, et `NODE_MINIMUM` du médecin.
 */
export const NODE_MINIMAL = 24;

/**
 * Le numéro majeur d'une version de Node, ou `null` si la chaîne est illisible.
 *
 * `null` ne bloque PAS : refuser de démarrer parce qu'on n'a pas su lire un
 * numéro de version serait transformer une incertitude en panne. On préfère
 * essayer et échouer plus loin, sur la vraie cause.
 */
export function majeure(version) {
  const m = /^v?(\d+)\./.exec(String(version));
  return m === null ? null : Number(m[1]);
}

/**
 * Ce qui manque, dit à l'humain — ou `null` si la porte est ouverte.
 *
 * ─── CE QUI ARRÊTE ET CE QUI AVERTIT, ET POURQUOI CE N'EST PAS PAREIL ────────
 *
 * Une dépendance absente rend l'exécution IMPOSSIBLE : plus rien ne démarre, et
 * s'arrêter ne coûte donc aucun diagnostic.
 *
 * Une version de Node trop ancienne la rend seulement INCERTAINE — et parmi ce
 * qui tourne encore il y a `hive doctor`, qui nomme cette cause parmi douze
 * autres et donne la commande `nvm`. S'ARRÊTER LÀ SERAIT REFAIRE LE DÉFAUT QUE
 * CE FICHIER RÉPARE, d'un cran plus haut : un garde qui empêche son propre
 * médecin d'entrer. On avertit, et on laisse passer.
 *
 * L'avertissement vient EN PREMIER quand les deux tombent : installer sous une
 * version trop ancienne produit un `node_modules` qu'il faudra refaire.
 *
 * @param {{versionNode: string, racine: string, modules: boolean, tsx: boolean}} etat
 * @returns {{arret: boolean, message: string}|null}
 */
export function verdict(etat) {
  const morceaux = [];
  let arret = false;

  const maj = majeure(etat.versionNode);
  if (maj !== null && maj < NODE_MINIMAL) {
    morceaux.push(
      [
        '',
        `  ⚠  Node est trop ancien : ${etat.versionNode} — la ruche en exige ${String(NODE_MINIMAL)} ou plus.`,
        '',
        "     La Reine, le nœud et l'installeur s'appuient sur des fonctions qui",
        "     n'existent pas avant. On continue quand même — « npm run cli -- doctor »",
        '     dira ce qui casse — mais attendez-vous à une panne sans rapport apparent.',
        '',
        '         https://nodejs.org   (choisir « LTS »)',
        '',
        '     Après un changement de version, REFAIRE l’installation : un',
        '     `node_modules` bâti sous l’ancienne garde des binaires natifs',
        '     liés à la mauvaise ABI.',
        '',
        '         npm install --no-fund --no-audit',
        '',
      ].join('\n'),
    );
  }

  // ─── RIEN N'EST INSTALLÉ ───────────────────────────────────────────────────
  //
  // Le cas de l'archive ZIP téléchargée depuis GitHub : le dépôt est là,
  // `node_modules` non. C'est la panne la plus fréquente, et celle dont le
  // message d'origine — une trace de résolution de module ESM — ne disait rien.
  if (!etat.modules) {
    arret = true;
    morceaux.push(
      [
        '',
        '  ✘  La ruche ne peut pas démarrer : les dépendances ne sont pas installées.',
        '',
        `     Dossier : ${etat.racine}`,
        '',
        '     Une seule commande, à cet endroit :',
        '',
        '         npm install --no-fund --no-audit',
        '',
        '     Puis relancer la même commande qu’à l’instant.',
        '',
      ].join('\n'),
    );
    return { arret, message: morceaux.join('\n') };
  }

  // ─── INSTALLÉ, MAIS SANS LES OUTILS DE DÉVELOPPEMENT ───────────────────────
  //
  // `tsx` est une dépendance de développement, et TOUT lancement de ce dépôt le
  // traverse : les sources sont en TypeScript et ne sont pas compilées avant
  // `npm run build`. Une installation faite avec `--omit=dev`, `--production`,
  // ou un `NODE_ENV=production` hérité de l'environnement, donne un
  // `node_modules` d'apparence complète où plus rien ne démarre.
  //
  // Le message doit donc NOMMER cette cause : conseiller `npm install` tout
  // court à quelqu'un dont l'environnement porte `NODE_ENV=production` le ferait
  // tourner en rond.
  if (!etat.tsx) {
    arret = true;
    morceaux.push(
      [
        '',
        '  ✘  Il manque « tsx », que tous les lancements de ce dépôt traversent.',
        '',
        `     Dossier : ${etat.racine}`,
        '',
        '     Les dépendances ont été installées SANS celles de développement',
        '     (`--omit=dev`, `--production`, ou `NODE_ENV=production` hérité).',
        '     Les sources sont en TypeScript : sans « tsx », rien ne démarre.',
        '',
        '         npm install --include=dev --no-fund --no-audit',
        '',
      ].join('\n'),
    );
  }

  return morceaux.length === 0 ? null : { arret, message: morceaux.join('\n') };
}

/**
 * L'état réel de la copie — la seule fonction impure du fichier.
 *
 * On regarde `tsx/package.json`, et non le dossier `tsx` : une installation
 * interrompue laisse des dossiers vides que `existsSync` déclarerait présents,
 * et le démarrage échouerait ensuite sur une trace de résolution — exactement
 * ce que cette amorce existe pour éviter.
 */
export function etatReel(racine) {
  return {
    versionNode: process.version,
    racine,
    modules: existsSync(path.join(racine, 'node_modules')),
    tsx: existsSync(path.join(racine, 'node_modules', 'tsx', 'package.json')),
  };
}

/**
 * Le garde : dit ce qui manque, s'arrête si rien ne peut tourner, et se tait
 * quand la porte est ouverte.
 *
 * Code 2 — le même que `install.sh` et `install.ps1` pour « prérequis absent »,
 * distinct de 1 qui veut dire « ça a planté ».
 */
export function exigerAmorce(racine) {
  const v = verdict(etatReel(racine));
  if (v === null) return;
  process.stderr.write(`${v.message}\n`);
  if (v.arret) process.exit(2);
}
