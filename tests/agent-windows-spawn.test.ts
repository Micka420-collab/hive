// LE SPAWN QUE PERSONNE N'AVAIT JAMAIS LANCÉ.
//
// ─── LA LIGNE QUE J'AI RÉPÉTÉE TOUTE LA JOURNÉE ──────────────────────────────
//
// « Le chemin `spawn` de l'agent sous un vrai Windows n'est pas éprouvé. La
// logique l'est ; le `spawn` final, non. Aucune machine Windows ici, et la CI
// n'y installe pas Claude Code. »
//
// C'était vrai pour la logique et FAUX pour la conclusion. `argvAgent` est pur
// et couvert ; ce qui manquait, c'est la preuve que
// `spawn('node', [chemin], { shell: false })` lance vraiment quelque chose sur
// Windows. Et cette preuve ne demande pas Claude Code : elle demande **un
// fichier à la bonne place**.
//
// `prefixeNpmWindows` lit `npm_config_prefix` AVANT `APPDATA`. On plante donc
// un faux paquet dans un dossier temporaire, on pointe le préfixe dessus, et on
// lance pour de bon. Si Windows refuse ce `spawn`, ce fichier rougit — sur la
// CI Windows, sans qu'aucune clé d'API n'entre nulle part.
//
// ─── POURQUOI UN FAUX PAQUET N'EST PAS UNE SIMULATION ────────────────────────
//
// La question posée n'est pas « Claude Code répond-il ? » — ça, c'est le
// travail de Claude Code. Elle est : « Node, lancé SANS interpréteur de
// commandes, sur un chemin Windows composé par nous, exécute-t-il le script
// qui s'y trouve ? » Le contenu du script n'a aucune importance ; sa PLACE et
// son lancement sont tout le sujet.
//
// ─── CE QUI EMPÊCHE CETTE GARDE DE S'ÉTEINDRE EN SILENCE ─────────────────────
//
// Un `runIf(win32)` ne s'exécute nulle part ailleurs. Si `PAQUETS_AGENTS`
// changeait, le test Windows continuerait de planter son faux paquet à
// l'ancienne place et vérifierait un chemin que le code n'emprunte plus — vert,
// et sans objet. Le dernier test de ce fichier tourne donc PARTOUT et compare
// la disposition que le faux paquet imite à celle que le code déclare.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PAQUETS_AGENTS, argvAgent, scriptAgentWindows } from '../src/shared/agent-windows.js';

const WINDOWS = process.platform === 'win32';

/** Le marqueur que le faux agent imprime — il ne peut venir que de lui. */
const MARQUE = 'ruche-agent-lance-pour-de-vrai';

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Plante un faux agent npm global et rend le préfixe qui le contient.
 *
 * La disposition imite CELLE QUE LE CODE DÉCLARE (`PAQUETS_AGENTS`), pas une
 * disposition écrite à la main : la garde du bas vérifie que les deux ne
 * divergent pas.
 */
function planterFauxAgent(bin: string): string {
  const paquet = PAQUETS_AGENTS[bin];
  if (!paquet) throw new Error(`aucun paquet déclaré pour « ${bin} »`);
  const prefixe = mkdtempSync(path.join(tmpdir(), 'ruche-npm-'));
  aNettoyer.push(prefixe);
  const racine = path.join(prefixe, 'node_modules', ...paquet.paquet.split('/'));
  const script = path.join(racine, paquet.entree);
  mkdirSync(path.dirname(script), { recursive: true });
  // Le script imprime son marqueur ET ses arguments : on veut savoir que les
  // arguments de la tâche traversent, pas seulement que Node a démarré.
  writeFileSync(
    script,
    `process.stdout.write('${MARQUE}:' + process.argv.slice(2).join(','));\n`,
    'utf8',
  );
  return prefixe;
}

describe('l’agent npm sous Windows — le spawn réel', () => {
  it.runIf(WINDOWS)('LE CHEMIN COMPOSÉ DÉSIGNE LE FICHIER QU’ON VIENT D’ÉCRIRE', () => {
    // Premier maillon : ce que le module calcule existe vraiment sur le disque.
    // Sans ça, le lancement plus bas testerait la gestion d'une absence.
    const prefixe = planterFauxAgent('claude');
    const script = scriptAgentWindows('claude', { npm_config_prefix: prefixe }, 'win32');
    expect(script, 'aucun chemin composé alors que le préfixe est explicite').not.toBeNull();
    expect(existsSync(script as string), `chemin composé introuvable : ${script}`).toBe(true);
  });

  it.runIf(WINDOWS)('WINDOWS LANCE CE SPAWN, SANS INTERPRÉTEUR DE COMMANDES', () => {
    // LA propriété du fichier. `shell: false` est explicite : c'est la
    // contrainte §5.1, et c'est aussi ce qui rendait le shim `.cmd`
    // inlançable — d'où tout ce correctif.
    const prefixe = planterFauxAgent('claude');
    const argv = argvAgent('claude', { npm_config_prefix: prefixe }, 'win32', existsSync);
    expect(argv[0], 'on ne lance plus Node : le shim est revenu').toBe('node');

    const [bin = 'node', ...args] = argv;
    const r = spawnSync(bin, [...args, '--porte', 'ouverte'], {
      shell: false,
      encoding: 'utf8',
      timeout: 30_000,
    });

    expect(r.error, `spawn refusé par Windows : ${r.error?.message ?? ''}`).toBeUndefined();
    expect(r.status, `code de sortie ${r.status} — sortie : ${r.stderr}`).toBe(0);
    expect(r.stdout, 'le script n’a pas tourné').toContain(MARQUE);
    // Les arguments de la tâche doivent traverser : un lancement qui les perdrait
    // ferait travailler l'agent sur autre chose que ce qu'on lui demande.
    expect(r.stdout, 'les arguments n’ont pas traversé').toContain('--porte,ouverte');
  });

  it.runIf(WINDOWS)('UN PAQUET ABSENT NE FAIT PAS INVENTER UN CHEMIN', () => {
    // Le pendant : sans fichier, on retombe sur `[bin]` — le comportement
    // d'avant, à l'identique. Une garde qui ne tiendrait que le cas favorable
    // laisserait passer un chemin fabriqué vers rien.
    const vide = mkdtempSync(path.join(tmpdir(), 'ruche-npm-vide-'));
    aNettoyer.push(vide);
    expect(argvAgent('claude', { npm_config_prefix: vide }, 'win32', existsSync)).toEqual([
      'claude',
    ]);
  });

  it('LA DISPOSITION IMITÉE EST CELLE QUI EST ÉCRITE ICI, pas celle du code', () => {
    // Ce test-ci tourne PARTOUT, et c'est sa raison d'être : les trois du dessus
    // ne s'exécutent que sous Windows. Si `PAQUETS_AGENTS` changeait, ils
    // continueraient de planter leur faux paquet à la nouvelle place et
    // vérifieraient un chemin que personne n'a relu — verts, et sans objet.
    //
    // SA PREMIÈRE VERSION ÉTAIT TAUTOLOGIQUE, et la mutation l'a montré : elle
    // plantait le faux paquet DEPUIS la table, puis comparait à un chemin
    // calculé DEPUIS LA MÊME TABLE. Changer `cli.js` en `index.js` déplaçait
    // les deux côtés ensemble et la comparaison tenait toujours. Une garde dont
    // les deux membres viennent de la même source ne garde rien.
    //
    // La valeur attendue est donc ÉCRITE ICI, en toutes lettres. Le jour où le
    // paquet change pour de bon, ce test rougit — et c'est exactement ce qu'on
    // veut : quelqu'un doit alors aller relire les trois tests Windows, que
    // personne ne verra jamais tourner en local.
    expect(PAQUETS_AGENTS.claude, 'l’agent « claude » a disparu de la table').toEqual({
      paquet: '@anthropic-ai/claude-code',
      entree: 'cli.js',
    });

    // Et la FORME du chemin composé, qui est ce que le faux paquet imite :
    // `<préfixe>/node_modules/<paquet>/<entrée>`.
    const prefixe = mkdtempSync(path.join(tmpdir(), 'ruche-forme-'));
    aNettoyer.push(prefixe);
    const compose = scriptAgentWindows('claude', { npm_config_prefix: prefixe }, 'win32');
    expect(compose, 'le module ne compose plus de chemin').not.toBeNull();
    const normaliser = (p: string): string => p.replace(/\\/g, '/');
    expect(normaliser(compose as string)).toBe(
      `${normaliser(prefixe)}/node_modules/@anthropic-ai/claude-code/cli.js`,
    );
  });
});
