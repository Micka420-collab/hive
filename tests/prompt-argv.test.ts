// Un prompt de tâche ne doit jamais pouvoir devenir une OPTION de l'agent.
//
// ─── L'INJECTION, MESURÉE SUR LE VRAI BINAIRE ────────────────────────────────
//
//     $ claude -p '--version' --output-format stream-json --verbose
//     2.1.220 (Claude Code)
//
// La CLI n'a jamais vu de prompt : elle a lu une option, l'a exécutée, et est
// sortie. Avec `--` posé au bon endroit, la même chaîne redevient du texte et la
// session démarre normalement.
//
// ─── LA TAILLE EXACTE DE LA FAILLE ───────────────────────────────────────────
//
// Un nœud accepte déjà d'exécuter l'agent sur des prompts venus du hub : ce
// n'est donc PAS « de l'exécution de code là où il n'y en avait pas », et le
// dire serait exagérer. Ce que l'injection ajoute, c'est le contrôle des
// OPTIONS de l'agent — donc de quoi désarmer les garde-fous que le membre a
// posés sur SA machine. Il croit prêter un agent bridé ; il prête l'agent que
// le hub configure.
//
// Et le prompt n'est pas toujours écrit par un humain : le planificateur, la
// Reine et le runner d'essaim en fabriquent. Il suffit qu'un modèle produise
// une ligne qui commence par un tiret.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { texteNonOption } from '../src/adapters/prompt-argv.js';

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('les adaptateurs à CLI connue posent le terminateur `--`', () => {
  it('claude-code : le prompt est le DERNIER argument, derrière `--`', () => {
    const src = lire('../src/adapters/claude-code.ts');
    // La forme exacte compte : `--` doit précéder immédiatement le prompt, et
    // TOUTES les options doivent être avant — y compris `--model` de l'Aiguillage
    // et `--permission-mode` (sans lequel `claude -p` refuse tout Edit/Write en
    // silence, cf. le commentaire d'`argvClaude`). La construction vit dans
    // `argvClaude` (pur) : `...drapeauxModele` (les options du modèle) PUIS `--`
    // PUIS le prompt. Cet ordre précis est ce qui empêche le prompt — ou un nom
    // de modèle — d'être lu comme une option. Prettier étale le tableau sur
    // plusieurs lignes (au-delà de son print width) : la chaîne cherchée suit
    // exactement cette mise en forme plutôt qu'une ligne unique.
    expect(src).toContain("...drapeauxModele,\n    '--',\n    prompt,");
    expect(src, "le prompt ne doit plus suivre '-p' directement").not.toContain("'-p', prompt");
  });

  it('codex : `--` sépare la sous-commande du prompt', () => {
    const src = lire('../src/adapters/codex.ts');
    expect(src).toContain("'exec', '--', task.prompt");
    expect(src).not.toContain("'exec', task.prompt");
  });

  it('custom : la CLI est inconnue, donc c’est le TEXTE qu’on neutralise', () => {
    // Injecter un `--` dans la commande d'un opérateur casserait les CLI qui ne
    // le comprennent pas — le remède serait pire que le mal.
    const src = lire('../src/adapters/custom.ts');
    expect(src).toContain('texteNonOption');
    expect(src, 'le prompt brut ne doit plus atteindre argv').not.toContain('...rest, task.prompt');
  });
});

describe('texteNonOption — ne suppose rien de la CLI, ne retire rien au texte', () => {
  it('un texte ordinaire n’est pas touché', () => {
    for (const t of ['corrige le bug', 'Fix #12', '  déjà espacé', 'a-b-c', '']) {
      expect(texteNonOption(t), t).toBe(t);
    }
  });

  it('CE QUI COMMENCE PAR UN TIRET CESSE D’ÊTRE UNE OPTION', () => {
    for (const t of ['--version', '-p', '--dangerously-skip-permissions', '--mcp-config=/x']) {
      const sorti = texteNonOption(t);
      expect(sorti.startsWith('-'), t).toBe(false);
      expect(sorti.trim(), 'le texte lui-même reste intact').toBe(t);
    }
  });

  it('UNE LISTE MARKDOWN RESTE LISIBLE — le cas légitime qu’un refus aurait cassé', () => {
    // C'est la raison pour laquelle on neutralise au lieu de refuser : un prompt
    // qui commence par « - » est parfaitement ordinaire.
    const liste = '- corriger le bug\n- ajouter un test';
    expect(texteNonOption(liste)).toBe(` ${liste}`);
    expect(texteNonOption(liste).trim()).toBe(liste);
  });

  it('est idempotent — l’appliquer deux fois n’ajoute pas deux espaces', () => {
    expect(texteNonOption(texteNonOption('--x'))).toBe(' --x');
  });
});
