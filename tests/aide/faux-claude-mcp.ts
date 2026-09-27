// Un faux `claude` qui éprouve le pont de délégation comme le vrai s'en sert.
//
// Le vrai Claude Code lit `--mcp-config`, lance le serveur stdio qui y est
// déclaré, l'initialise puis liste ses outils. Ce faux fait EXACTEMENT ce
// chemin, et rien d'autre : la réponse `initialize` du pont n'arrive qu'une
// fois son socket joint et le jeton accepté par le nœud (`parentReady` dans
// `DELEGATION_BRIDGE_SOURCE`). Une réussite prouve donc que le rendez-vous est
// atteignable depuis là où le CLI tourne — l'hôte, ou le bac à sable.
//
// La réponse sort dans une ligne `result` du stream-json : `success` avec la
// liste des outils, ou `error` (sortie 1) avec la raison que le pont a donnée.
// `#!/usr/bin/env node` : dans un bac bubblewrap, c'est le `node` du PATH monté
// en lecture seule, comme pour Codex.

export const FAUX_CLAUDE_MCP = [
  '#!/usr/bin/env node',
  "'use strict';",
  "const fs = require('node:fs');",
  "const { spawn } = require('node:child_process');",
  'const fin = (ok, texte) => {',
  "  const ligne = { type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok, result: texte };",
  "  process.stdout.write(JSON.stringify(ligne) + '\\n', () => process.exit(ok ? 0 : 1));",
  '};',
  "const i = process.argv.indexOf('--mcp-config');",
  "if (i < 0) fin(false, 'pas de --mcp-config');",
  'else {',
  "  const config = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));",
  '  const serveur = Object.values(config.mcpServers)[0];',
  "  const mcp = spawn(serveur.command, serveur.args, { stdio: ['pipe', 'pipe', 'inherit'] });",
  "  mcp.on('error', (e) => fin(false, 'serveur MCP non lancé : ' + e.message));",
  "  const delai = setTimeout(() => fin(false, 'pont muet'), 15000);",
  "  let tampon = '';",
  '  const reponses = [];',
  "  mcp.stdout.on('data', (morceau) => {",
  '    tampon += morceau;',
  '    let n;',
  "    while ((n = tampon.indexOf('\\n')) >= 0) {",
  '      reponses.push(JSON.parse(tampon.slice(0, n)));',
  '      tampon = tampon.slice(n + 1);',
  '    }',
  '    if (reponses.length === 1) {',
  '      if (reponses[0].error) {',
  '        clearTimeout(delai);',
  "        fin(false, 'pont injoignable : ' + reponses[0].error.message);",
  '        return;',
  '      }',
  "      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\\n');",
  '    }',
  '    if (reponses.length === 2) {',
  '      clearTimeout(delai);',
  '      mcp.stdin.end();',
  "      fin(true, 'outils du pont : ' + reponses[1].result.tools.map((t) => t.name).join(','));",
  '    }',
  '  });',
  "  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\\n');",
  '}',
].join('\n');
