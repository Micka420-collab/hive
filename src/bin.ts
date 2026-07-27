#!/usr/bin/env node
// Le point d'entrée unique — celui qu'on lance sans avoir cloné le dépôt.
//
// ─── LE PROBLÈME QU'IL RÉSOUT ────────────────────────────────────────────────
//
// Prêter du temps-machine à la ruche d'un ami demandait, jusqu'ici :
//
//     git clone …           puis
//     npm install           218 Mo, 279 paquets, dont un moteur 3D de 27 Mo,
//                           React, et six paquets d'éditeur de code — tout
//                           cela pour un dashboard que le nœud n'ouvre JAMAIS
//     npm run join -- hive2_…
//
// C'est disproportionné au point d'être dissuasif, et ça se voit : on ne
// demande pas ça à quelqu'un qui rend un service.
//
// Avec ce fichier, un `bin` dans le `package.json` et le tri des dépendances,
// la même chose devient UNE commande, sans clone et sans dashboard.
//
// ─── POURQUOI IL RÉÉCRIT `process.argv` ──────────────────────────────────────
//
// Les points d'entrée existants (`join.ts`, `installer-main.ts`) sont des
// SCRIPTS : ils lisent `process.argv.slice(2)` et s'exécutent à l'import. Les
// transformer en fonctions exportées serait plus propre, mais toucherait du
// code éprouvé — dont `join.ts`, qui manipule des secrets — pour un gain de
// forme. On retire donc le nom de la sous-commande d'`argv` avant de les
// charger, ce qui leur présente exactement ce qu'ils attendaient. C'est le
// SEUL endroit du dépôt qui se permet ça, et c'est écrit ici pour que
// personne ne le découvre par surprise.

const SOUS_COMMANDES = ['join', 'install', 'cli', 'node'] as const;
type SousCommande = (typeof SOUS_COMMANDES)[number];

const AIDE = [
  '',
  '  hive — orchestration communautaire d’agents IA',
  '',
  '  hive join <billet>    rejoindre une ruche avec un billet d’invitation',
  '  hive install          installer et configurer sa propre ruche',
  '  hive node             démarrer un nœud déjà configuré (.env)',
  '  hive cli <commande>   piloter une ruche depuis le terminal',
  '',
  '  Sans argument, « hive » installe et configure. Un billet suffit pour',
  '  rejoindre : il contient l’adresse de la ruche et de quoi obtenir une clé.',
  '',
];

function estSousCommande(v: string | undefined): v is SousCommande {
  return typeof v === 'string' && (SOUS_COMMANDES as readonly string[]).includes(v);
}

const premier = process.argv[2];

if (premier === '--help' || premier === '-h' || premier === 'help') {
  process.stdout.write(`${AIDE.join('\n')}\n`);
} else if (estSousCommande(premier)) {
  // Retire la sous-commande : les scripts appelés lisent `argv.slice(2)`.
  process.argv = [process.argv[0]!, process.argv[1]!, ...process.argv.slice(3)];
  const chemins: Record<SousCommande, string> = {
    join: './node-client/join.js',
    install: './installer-main.js',
    node: './node-client/main.js',
    cli: './cli.js',
  };
  await import(chemins[premier]);
} else if (premier === undefined || premier.startsWith('-')) {
  // Pas de sous-commande : on installe. C'est ce que quelqu'un qui tape
  // « hive » tout court veut presque toujours dire, et les drapeaux éventuels
  // (`--dry-run`, `--json`…) sont ceux de l'installeur.
  await import('./installer-main.js');
} else {
  process.stderr.write(`\n✘ commande inconnue : ${premier}\n${AIDE.join('\n')}\n`);
  process.exitCode = 1;
}
