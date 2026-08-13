// LES DÉPENDANCES OPTIONNELLES ONT-ELLES ATTERRI ?
//
// ─── POURQUOI CE SCRIPT EXISTE ───────────────────────────────────────────────
//
// `fastify`, `@fastify/cors`, `@fastify/static` et `better-sqlite3` sont
// déclarés OPTIONNELS, et c'est délibéré : un membre qui fait seulement tourner
// un nœud n'a besoin d'aucun des quatre. Le README le documente —
// `npm install -g … --omit=optional` retire Fastify et SQLite, « dont SEULE la
// ruche complète a besoin ».
//
// Mais « optionnel » a une conséquence que personne ne voit passer : **si leur
// installation échoue, npm continue en silence et sort en 0.** On se retrouve
// avec un `npm ci` vert et une ruche qui ne peut pas démarrer.
//
// C'est exactement ce qui est arrivé à la première CI Windows : l'installation
// a réussi en 49 secondes, et 68 fichiers de test sur 135 ont échoué à
// l'import. Le vrai message — pourquoi le module natif n'a pas pu s'installer —
// n'apparaissait NULLE PART.
//
// Ce script le dit. Il ne juge pas : il rapporte ce qui est là et ce qui ne
// l'est pas, pour que la ligne suivante du journal explique les 68 échecs
// plutôt que de les laisser inexpliqués.
//
// ─── POURQUOI LA DÉCISION D'AFFICHAGE EST SORTIE DU CORPS DU SCRIPT ──────────
//
// Tout vivait au niveau du module : rien d'exporté, donc rien d'éprouvable, et
// un balayage loupe sur `scripts/` (46 candidates, 46 examinées) a rendu ceci :
//
//     🔴 SANS TEST · scripts/deps-optionnelles.mjs · > → >=
//                if (absentes.length > 0) {
//
// Le mutant n'est pas cosmétique. Avec `>=`, une installation PARFAITEMENT
// SAINE affiche « ⚠ Ces paquets manquent » et conseille de relancer `npm ci
// --foreground-scripts`. Un avertissement qui crie sur une machine en bon état
// apprend à ne plus le lire — et le jour où il dit vrai, plus personne
// n'écoute. C'est le pire mode de panne d'un diagnostic.
//
// « Hors d'atteinte du banc » est presque toujours « au mauvais endroit »
// (§ 2 quaterdecies). La décision est donc PURE ici, et le script ne fait plus
// que la lire.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ce dont la ruche COMPLÈTE a besoin, et dont un nœud seul peut se passer. */
export const OPTIONNELLES = ['fastify', '@fastify/cors', '@fastify/static', 'better-sqlite3'];

/**
 * La première ligne du message d'une erreur de résolution — ou l'objet tel
 * quel s'il n'en est pas une.
 *
 * Le `instanceof Error` a survécu au balayage, muté en `instanceof Object`. Il
 * est ÉQUIVALENT SUR LE CHEMIN RÉEL : `require.resolve` ne lance que des
 * `Error` (`MODULE_NOT_FOUND`), et un `Error` est aussi un `Object`, donc les
 * deux versions rendent le même texte. Il ne l'est PAS sur une entrée
 * quelconque, et c'est ce que le banc épingle : une valeur qui n'est pas une
 * erreur doit ressortir telle quelle, jamais en `undefined`. Écrire ce banc
 * coûte trois lignes ; supposer l'équivalence coûterait un `undefined` affiché
 * le jour où quelqu'un lance autre chose.
 */
export function premiereLigne(e) {
  return e instanceof Error ? e.message.split('\n')[0] : String(e);
}

/**
 * Ce qu'on imprime quand des paquets manquent — et RIEN quand tout est là.
 *
 * La borne est ici, seule et éprouvée : une liste VIDE ne produit aucune ligne.
 */
export function lignesAbsences(absentes) {
  if (absentes.length === 0) return [];
  return [
    '',
    '⚠ Ces paquets manquent. `npm ci` a réussi QUAND MÊME : c’est ce que',
    '  « optionnel » veut dire, et c’est pour ça que ce script existe.',
    '',
    '  Un NŒUD seul fonctionne sans eux. Une RUCHE COMPLÈTE, non :',
    '  l’orchestrateur ne démarrera pas, et les tests qui le montent',
    '  échoueront à l’import — sans jamais dire pourquoi.',
    '',
    '  Pour voir la vraie erreur : npm ci --foreground-scripts',
  ];
}

/**
 * Le relevé complet : une ligne par paquet, puis l'avertissement s'il y a lieu.
 *
 * `resoudre` est passé plutôt que pris dans le module : c'est la seule I/O du
 * script, et l'injecter rend le relevé entier éprouvable sans désinstaller
 * quoi que ce soit sur la machine qui lance le banc.
 */
export function releve(noms, resoudre) {
  const absentes = [];
  const lignes = ['Dépendances optionnelles (ruche complète) :'];
  for (const nom of noms) {
    try {
      resoudre(nom);
      lignes.push(`  ✔ ${nom}`);
    } catch (e) {
      absentes.push(nom);
      lignes.push(`  ✘ ${nom} — ${premiereLigne(e)}`);
    }
  }
  return { lignes: [...lignes, ...lignesAbsences(absentes)], absentes };
}

// La garde du § 9 duodecies : importer ce fichier pour en éprouver les
// fonctions pures ne doit PAS lancer le relevé. `MOI` contre `LANCE`, chemins
// réels des deux côtés.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
if (MOI === LANCE) {
  const require = createRequire(import.meta.url);
  for (const ligne of releve(OPTIONNELLES, (nom) => require.resolve(nom)).lignes) {
    console.log(ligne);
  }
  // On sort TOUJOURS en 0 : ce script RAPPORTE, il ne décide pas. C'est aux
  // tests de dire si l'absence casse quelque chose — et ils le disent très bien.
  process.exit(0);
}
