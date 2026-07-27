// `npm run install:hive` — la partie qui touche au disque.
//
// La logique vit dans `installer.ts` (pure, testée). Ce fichier ne fait que
// lire, écrire et parler. La séparation permet de tester ce qui décide sans
// jamais risquer d'écraser un `.env` pendant une suite de tests.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectBestAgent } from './node-client/agent-detect.js';
import {
  NODE_MIN,
  avertissements,
  composerReglages,
  lireEnv,
  nodeSuffisant,
  prochainesEtapes,
  rendreEnv,
} from './installer.js';

const CHEMIN_ENV = path.resolve(process.cwd(), '.env');

function dire(ligne = ''): void {
  process.stdout.write(`${ligne}\n`);
}

async function main(): Promise<void> {
  dire();
  dire('🐝  Installation de votre ruche Hive');
  dire('    ────────────────────────────────');
  dire();

  // 1. Node. On refuse tôt et on dit quoi faire — un plantage de `tsx` trois
  //    étapes plus loin n'apprendrait rien à personne.
  if (!nodeSuffisant(process.version)) {
    dire(`✘  Node ${process.version} : il en faut au moins ${NODE_MIN}.`);
    dire();
    dire('   Installez une version récente depuis https://nodejs.org, puis relancez.');
    dire('   (Sur macOS/Linux, « nvm install 20 » suffit si vous avez nvm.)');
    dire();
    process.exitCode = 1;
    return;
  }
  dire(`✔  Node ${process.version}`);

  // 2. La configuration. On COMPLÈTE, on n'écrase jamais : écraser un jeton en
  //    service couperait tous les nœuds déjà connectés.
  const existant = existsSync(CHEMIN_ENV) ? lireEnv(readFileSync(CHEMIN_ENV, 'utf8')) : new Map();
  const neuf = !existsSync(CHEMIN_ENV);
  const reglages = composerReglages(existant);
  const ajoutees = reglages.filter((r) => !existant.has(r.cle)).map((r) => r.cle);

  if (neuf) {
    writeFileSync(CHEMIN_ENV, rendreEnv(reglages), { mode: 0o600 });
    dire('✔  .env créé, avec un jeton engendré aléatoirement');
  } else if (ajoutees.length > 0) {
    writeFileSync(CHEMIN_ENV, rendreEnv(reglages), { mode: 0o600 });
    dire(`✔  .env complété (${ajoutees.join(', ')}) — vos valeurs existantes sont intactes`);
  } else {
    dire('✔  .env déjà complet — rien touché');
  }

  // 3. L'agent. Purement informatif : la ruche tourne sans, en mode simulé.
  let agent: string | null = null;
  try {
    const detecte = await detectBestAgent();
    agent = detecte.agent === 'shell' ? null : detecte.label;
  } catch {
    // La détection lance un binaire ; si elle échoue, ce n'est pas grave —
    // c'est exactement le cas que le mode simulé couvre.
  }
  dire(
    agent
      ? `✔  Agent détecté : ${agent}`
      : 'ℹ  Aucun agent de codage détecté — la ruche tournera en mode simulé (sûr, et suffisant pour essayer)',
  );

  for (const a of avertissements(reglages)) {
    dire();
    dire(`⚠  ${a}`);
  }

  dire();
  dire('    Et maintenant :');
  dire();
  for (const etape of prochainesEtapes(agent)) dire(`      ${etape}`);
  dire();
  dire('    Votre code et vos clés d’API restent sur cette machine.');
  dire();
}

main().catch((err: unknown) => {
  dire();
  dire(`✘  ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
