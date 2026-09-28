// Ce que Cursor et Cline CHARGENT d'un dépôt, rejoué sans leur binaire.
//
// Le vrai `cursor-agent` s'arrête à l'authentification avant ses hooks, et le
// binaire de Cline exige AVX2 : ni l'un ni l'autre ne tourne sur la CI. Ce
// module rejoue leur DÉCOUVERTE telle que leurs sources la décrivent, et
// exécute ce qu'elle trouve — exactement ce qu'un dépôt piégé obtiendrait :
//
//   · Cursor 2026.09.02 (paquet installé, `190.index.js`) : `.cursor/hooks.json`
//     (`projectConfigPath`), puis au format Claude `.claude/settings.json` et
//     `.claude/settings.local.json` (`claudeProjectConfigPath`,
//     `claudeProjectLocalConfigPath`) — `hooks.<Événement>[].command` d'un côté,
//     `hooks.<Événement>[].hooks[].command` de l'autre ;
//   · Cline 3.0.65 (`@cline/shared` 0.0.86, `resolveHooksConfigSearchPaths`,
//     `resolvePluginConfigSearchPaths`) : les fichiers d'événement de
//     `.clinerules/hooks/` et `.cline/hooks/`, puis les modules de
//     `.cline/plugins/`, chargés comme du code.
//
// Usage : `node chargeurs-config-agent.mjs <cursor|cline> [racine]`. Les
// témoins s'écrivent dans `HIVE_TEMOINS`. Avec `HIVE_PRODUIRE=1`, il produit
// aussi comme un agent (une ligne ajoutée à `src/a.txt`), puis rend la ligne
// finale que l'adaptateur lit.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [, , agent, racineArg] = process.argv;
const racine = racineArg ?? process.cwd();

/** `node <script>` d'une commande de hook, relative à la racine du projet. */
function scriptDe(commande) {
  const [, script] = commande.trim().split(/\s+/);
  return script;
}

function lireJson(relatif) {
  const chemin = path.join(racine, relatif);
  if (!existsSync(chemin)) return undefined;
  return JSON.parse(readFileSync(chemin, 'utf8'));
}

function hooksCursor() {
  const scripts = [];
  const cursor = lireJson('.cursor/hooks.json');
  for (const entrees of Object.values(cursor?.hooks ?? {})) {
    for (const e of entrees) scripts.push(scriptDe(e.command));
  }
  for (const relatif of ['.claude/settings.json', '.claude/settings.local.json']) {
    const claude = lireJson(relatif);
    for (const groupes of Object.values(claude?.hooks ?? {})) {
      for (const g of groupes) for (const h of g.hooks) scripts.push(scriptDe(h.command));
    }
  }
  return scripts;
}

function fichiersDe(relatif) {
  const dossier = path.join(racine, relatif);
  if (!existsSync(dossier) || !statSync(dossier).isDirectory()) return [];
  return readdirSync(dossier)
    .sort()
    .map((nom) => path.join(relatif, nom));
}

function hooksCline() {
  return [
    ...fichiersDe('.clinerules/hooks'),
    ...fichiersDe('.cline/hooks'),
    ...fichiersDe('.cline/plugins'),
  ];
}

const scripts = agent === 'cursor' ? hooksCursor() : agent === 'cline' ? hooksCline() : null;
if (scripts === null) {
  console.error(`agent inconnu : ${agent}`);
  process.exit(2);
}
for (const script of scripts) {
  execFileSync(process.execPath, [path.join(racine, script)], { cwd: racine, stdio: 'inherit' });
}
console.error(`chargés : ${scripts.join(', ') || 'aucun'}`);
if (process.env.HIVE_PRODUIRE === '1') {
  appendFileSync(path.join(racine, 'src', 'a.txt'), 'ligne de l’agent\n');
  const fin =
    agent === 'cursor'
      ? { type: 'result', subtype: 'success', is_error: false, result: 'fait' }
      : { type: 'run_result', text: 'fait' };
  console.log(JSON.stringify(fin));
}
