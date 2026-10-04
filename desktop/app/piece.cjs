// L'AMORCE D'UNE PIÈCE DE LA RUCHE DANS L'APPLICATION DE BUREAU.
//
// L'app lance la Reine, les ouvrières et `hive sauvegarde` avec SON binaire
// (Electron) en mode Node : `ELECTRON_RUN_AS_NODE=1` (ADR 0013 § 2). Cette
// variable ne doit PAS descendre plus bas : un agent lancé par une ouvrière,
// ou n'importe lequel de ses sous-processus, qui serait lui-même une app
// Electron démarrerait en Node nu au lieu de s'ouvrir. On la retire donc ici,
// avant la première ligne de Hive, puis on importe l'entrée demandée — et on
// lui présente `process.argv` comme si `node <entrée> …` l'avait lancée.
//
// Le pont de délégation, qui a besoin du mode Node, le reçoit par la
// configuration MCP de l'agent (`envDuPont`, `src/adapters/delegation-bridge.ts`).
//
// CommonJS, pas ESM : ce fichier doit tourner tel quel, sans chargeur, et
// `import()` dynamique suffit à charger l'entrée ESM de Hive.
'use strict';

const { pathToFileURL } = require('node:url');

delete process.env.ELECTRON_RUN_AS_NODE;

const entree = process.argv[2];
if (!entree) {
  process.stderr.write('piece.cjs : aucune entrée à lancer\n');
  process.exit(2);
}
// [binaire, piece.cjs, entrée, …args] → [binaire, entrée, …args]
process.argv.splice(1, 1);

// ─── L'APP MORTE EMPORTE SES PIÈCES ─────────────────────────────────────────
//
// Mesuré : une app tuée net (plantage de GTK, SIGKILL) laissait la Reine et
// les ouvrières orphelines — le port 7777 tenu, le verrou de la base tenu, et
// au lancement suivant une Reine refusée « base déjà tenue ». Le canal IPC se
// ferme quand l'app meurt (`disconnect`) : la pièce reçoit alors l'ordre
// d'arrêt de la ruche (`ORDRE_ARRET`, `src/shared/demarrage.ts`), le chemin
// PROPRE qu'elle connaît déjà — base fermée, agents arrêtés —, sur les trois
// systèmes. Sans canal (`hive sauvegarde`), rien ne change.
process.once('disconnect', () => {
  process.emit('message', { type: 'arret' });
});

// Ses tuyaux de sortie mènent alors à un processus mort : chaque écriture
// échoue en EPIPE, émis comme `error` sur le flux. Non écouté, il devient une
// exception, que le gestionnaire d'exceptions de l'ouvrière ÉCRIT… sur le même
// tuyau : mesuré, une ouvrière orpheline à 100 % d'un cœur, qui ne sortait
// jamais. Une pièce sans parent n'a plus personne à qui parler : on se tait.
for (const flux of [process.stdout, process.stderr]) flux.on('error', () => undefined);

import(pathToFileURL(entree).href).catch((erreur) => {
  process.stderr.write(`${erreur && erreur.stack ? erreur.stack : String(erreur)}\n`);
  process.exit(1);
});
