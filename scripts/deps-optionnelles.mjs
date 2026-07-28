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

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Ce dont la ruche COMPLÈTE a besoin, et dont un nœud seul peut se passer. */
const OPTIONNELLES = ['fastify', '@fastify/cors', '@fastify/static', 'better-sqlite3'];

const absentes = [];
console.log('Dépendances optionnelles (ruche complète) :');
for (const nom of OPTIONNELLES) {
  try {
    require.resolve(nom);
    console.log(`  ✔ ${nom}`);
  } catch (e) {
    absentes.push(nom);
    console.log(`  ✘ ${nom} — ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}

if (absentes.length > 0) {
  console.log('');
  console.log('⚠ Ces paquets manquent. `npm ci` a réussi QUAND MÊME : c’est ce que');
  console.log('  « optionnel » veut dire, et c’est pour ça que ce script existe.');
  console.log('');
  console.log('  Un NŒUD seul fonctionne sans eux. Une RUCHE COMPLÈTE, non :');
  console.log('  l’orchestrateur ne démarrera pas, et les tests qui le montent');
  console.log('  échoueront à l’import — sans jamais dire pourquoi.');
  console.log('');
  console.log('  Pour voir la vraie erreur : npm ci --foreground-scripts');
}

// On sort TOUJOURS en 0 : ce script RAPPORTE, il ne décide pas. C'est aux tests
// de dire si l'absence casse quelque chose — et ils le disent très bien.
process.exit(0);
