// Tests du Parlement des Agents (palier 4) : consensus par vote. Module pur —
// on vérifie la signature stable, le regroupement en factions, le quorum et le
// départage par diversité d'agents.
//
// ─── CE QUE CE FICHIER NE FAISAIT PAS, ET QUI A COÛTÉ CHER ───────────────────
//
// `signatureOf` n'a jamais reçu autre chose que `'x'`, `'a\nb'` et `'diff A'`.
// Jamais un diff. La fonction est pourtant appelée sur `r.diff` en production,
// et c'est là que sa promesse s'effondre : deux agents qui font EXACTEMENT la
// même correction ne rendent pas les mêmes octets.
//
// Un test qui n'essaie jamais la donnée réelle ne prouve rien de la production.
// Les cas « sur du vrai code » plus bas existent pour ça.

import { describe, expect, it } from 'vitest';
import { signatureOf, tally } from '../src/orchestrator/parliament.js';
import type { Ballot } from '../src/orchestrator/parliament.js';

const ballot = (
  nodeId: string,
  agentType: string,
  signature: string,
  success = true,
  fichiers: string[] = ['src/a.ts'],
): Ballot => ({
  nodeId,
  agentType,
  success,
  signature,
  fichiers,
});

describe('signatureOf', () => {
  it('ignore fins de ligne, espaces de fin et lignes vides de bord', () => {
    expect(signatureOf('a\r\nb')).toBe(signatureOf('a\nb'));
    expect(signatureOf('a  \nb\t')).toBe(signatureOf('a\nb'));
    expect(signatureOf('\n\na\nb\n\n')).toBe(signatureOf('a\nb'));
  });

  it('distingue des contenus réellement différents', () => {
    expect(signatureOf('diff A')).not.toBe(signatureOf('diff B'));
  });

  it('est déterministe et de forme hex 32 bits', () => {
    expect(signatureOf('x')).toBe(signatureOf('x'));
    expect(signatureOf('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('tally', () => {
  it('élit la faction majoritaire quand le quorum est atteint', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'codex', 'AAA'),
      ballot('n3', 'custom', 'BBB'),
    ]);
    expect(v.outcome).toBe('elected');
    expect(v.winner?.signature).toBe('AAA');
    expect(v.winner?.votes).toBe(2);
    expect(v.winner?.diversity).toBe(2);
  });

  it('pas de consensus si aucune faction n’atteint le quorum', () => {
    const v = tally([ballot('n1', 'claude-code', 'AAA'), ballot('n2', 'codex', 'BBB')]);
    expect(v.outcome).toBe('no_quorum');
    expect(v.winner).toBeNull();
    expect(v.factions).toHaveLength(2);
  });

  it('ne compte que les succès (un échec ne vote pas)', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'codex', 'AAA', false), // échec : ignoré
    ]);
    expect(v.outcome).toBe('no_quorum'); // une seule voix valide < quorum 2
    expect(v.factions[0]?.votes).toBe(1);
  });

  it('un même nœud ne pèse qu’une voix même s’il rend deux fois la même sortie', () => {
    const v = tally([ballot('n1', 'claude-code', 'AAA'), ballot('n1', 'claude-code', 'AAA')], {
      quorum: 1,
    });
    expect(v.factions[0]?.votes).toBe(1);
    expect(v.outcome).toBe('elected');
  });

  it('départage les égalités de voix par diversité d’agents', () => {
    // Deux factions à 2 voix : celle avec 2 types d'agents distincts l'emporte.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA'),
      ballot('n2', 'claude-code', 'AAA'), // faction AAA : 2 voix, 1 type
      ballot('n3', 'claude-code', 'BBB'),
      ballot('n4', 'codex', 'BBB'), // faction BBB : 2 voix, 2 types
    ]);
    expect(v.factions[0]?.signature).toBe('BBB');
    expect(v.winner?.signature).toBe('BBB');
  });

  it('aucun bulletin valide → no_ballots', () => {
    expect(tally([]).outcome).toBe('no_ballots');
    expect(tally([ballot('n1', 'x', 'AAA', false)]).outcome).toBe('no_ballots');
  });

  it('respecte un quorum explicite', () => {
    const three = [ballot('n1', 'a', 'AAA'), ballot('n2', 'b', 'AAA'), ballot('n3', 'c', 'AAA')];
    expect(tally(three, { quorum: 3 }).outcome).toBe('elected');
    expect(tally(three.slice(0, 2), { quorum: 3 }).outcome).toBe('no_quorum');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** Le même correctif, écrit par deux agents. Rien ici n'est un désaccord. */
const DIFF_CLAUDE = `diff --git a/src/auth.ts b/src/auth.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -42,6 +42,9 @@ export function verifier(jeton: string): boolean {
   const parts = jeton.split('.');
+  if (parts.length !== 3) {
+    return false;
+  }
   return controler(parts);
 }`;

const DIFF_CODEX = `diff --git a/src/auth.ts b/src/auth.ts
index 1a2b3c4..9f8e7d6 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -42,6 +42,9 @@ export function verifier(jeton: string): boolean {
   const parts = jeton.split('.');
+  if (parts.length !== 3) {
+    return false; // un JWT a exactement trois segments
+  }
   return controler(parts);
 }`;

describe('SUR DU VRAI CODE — ce que l’identité textuelle ne peut pas mesurer', () => {
  it('DEUX AGENTS QUI FONT LA MÊME CORRECTION N’ONT PAS LA MÊME SIGNATURE', () => {
    // Le défaut, nu. Un commentaire de plus suffit ; en pratique s'y ajoutent
    // les noms de variables et le `index <blob>..<blob>` qui dépend du contenu.
    expect(signatureOf(DIFF_CLAUDE)).not.toBe(signatureOf(DIFF_CODEX));
  });

  it('…donc le Parlement rend « pas de quorum » sur un accord réel', () => {
    // Ce n'est PAS un désaccord constaté, c'est l'absence de mesure. L'écran de
    // la Miellerie affichait « arbitrage humain » à quelqu'un dont les deux
    // agents avaient écrit la même chose.
    const v = tally([
      {
        nodeId: 'n1',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf(DIFF_CLAUDE),
        fichiers: ['src/auth.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'codex',
        success: true,
        signature: signatureOf(DIFF_CODEX),
        fichiers: ['src/auth.ts'],
      },
    ]);
    expect(v.outcome).toBe('no_quorum');
    expect(v.factions, 'deux factions d’une voix').toHaveLength(2);
  });

  it('MAIS LA SURFACE, ELLE, LES RÉUNIT', () => {
    // Le signal qui fonctionne : ils sont allés au même endroit. Ça ne dit pas
    // qu'ils ont écrit la même chose — et le champ est séparé pour qu'on ne
    // puisse pas le lire comme un consensus.
    const v = tally([
      {
        nodeId: 'n1',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf(DIFF_CLAUDE),
        fichiers: ['src/auth.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'codex',
        success: true,
        signature: signatureOf(DIFF_CODEX),
        fichiers: ['src/auth.ts'],
      },
    ]);
    expect(v.surfaces).toHaveLength(1);
    expect(v.surfaces[0]?.votes).toBe(2);
    expect(v.surfaces[0]?.diversity, 'deux IA différentes au même endroit').toBe(2);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/auth.ts']);
    expect(v.outcome, 'la surface ne devient JAMAIS un consensus').toBe('no_quorum');
  });

  it('l’identité textuelle reste juste là où la sortie est COURTE et CANONIQUE', () => {
    // Ce pour quoi le mécanisme est bon : une décision, une réponse, une option.
    // Deux agents qui rendent le même verdict rendent les mêmes octets.
    const v = tally([
      ballot('n1', 'claude-code', signatureOf('REFUSER')),
      ballot('n2', 'codex', signatureOf('REFUSER')),
    ]);
    expect(v.outcome).toBe('elected');
    expect(v.winner?.diversity).toBe(2);
  });
});

describe('LES SURFACES — l’accord sur le lieu, et surtout le désaccord', () => {
  it('DEUX ENDROITS DIFFÉRENTS SE VOIENT — c’est là qu’est la valeur', () => {
    // L'identité textuelle noyait cette divergence : tout lui paraissait déjà
    // divergent, donc « ils ne sont pas d'accord sur OÙ » n'était pas lisible.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/auth.ts']),
      ballot('n2', 'codex', 'BBB', true, ['src/server.ts', 'src/auth.ts']),
    ]);
    expect(v.surfaces).toHaveLength(2);
    expect(v.surfaces.map((s) => s.fichiers)).toEqual([
      ['src/auth.ts'],
      ['src/auth.ts', 'src/server.ts'],
    ]);
  });

  it('L’ORDRE DES FICHIERS N’EST PAS UNE OPINION', () => {
    // Deux agents qui touchent les mêmes fichiers dans un ordre différent sont
    // allés au même endroit. L'ordre vient de la marche du diff, pas d'un choix.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/b.ts', 'src/a.ts']),
      ballot('n2', 'codex', 'BBB', true, ['src/a.ts', 'src/b.ts']),
    ]);
    expect(v.surfaces, 'un seul lieu').toHaveLength(1);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('un doublon dans la liste ne fait pas deux endroits', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/a.ts', 'src/a.ts']),
      ballot('n2', 'codex', 'BBB', true, ['src/a.ts']),
    ]);
    expect(v.surfaces).toHaveLength(1);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/a.ts']);
  });

  it('UNE SURFACE ILLISIBLE N’EST PAS UN ACCORD — elle est comptée à part', () => {
    // Deux diffs qu'on n'a pas su lire ne sont pas d'accord : ON NE SAIT PAS.
    // Les fondre en une surface « vide » fabriquerait un accord de rien.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, []),
      ballot('n2', 'codex', 'BBB', true, []),
      ballot('n3', 'custom', 'CCC', true, ['src/a.ts']),
    ]);
    expect(v.surfaces, 'seule la surface lisible existe').toHaveLength(1);
    expect(v.surfaces[0]?.fichiers).toEqual(['src/a.ts']);
    expect(v.sansSurface, 'et l’abstention SE VOIT').toBe(2);
  });

  it('un même nœud ne pèse qu’une voix sur une surface', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/a.ts']),
      ballot('n1', 'claude-code', 'BBB', true, ['src/a.ts']),
    ]);
    expect(v.surfaces[0]?.votes).toBe(1);
  });

  it('un ÉCHEC ne compte pas plus sur la surface que sur la faction', () => {
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/a.ts']),
      ballot('n2', 'codex', 'BBB', false, ['src/a.ts']),
    ]);
    expect(v.surfaces[0]?.votes).toBe(1);
    expect(v.sansSurface, 'un échec n’est pas une abstention de surface').toBe(0);
  });

  it('les surfaces sont triées, et le tri est STABLE à égalité', () => {
    // Sans départage stable, deux surfaces à égalité changeraient de place d'un
    // appel à l'autre et l'écran clignoterait.
    const bulletins: Ballot[] = [
      ballot('n1', 'a', 'S1', true, ['src/z.ts']),
      ballot('n2', 'b', 'S2', true, ['src/a.ts']),
    ];
    const un = tally(bulletins).surfaces.map((s) => s.fichiers.join());
    const deux = tally([...bulletins].reverse()).surfaces.map((s) => s.fichiers.join());
    expect(un).toEqual(deux);
    expect(un).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('sans bulletin, il n’y a ni surface ni abstention', () => {
    const v = tally([]);
    expect(v.outcome).toBe('no_ballots');
    expect(v.surfaces).toEqual([]);
    expect(v.sansSurface).toBe(0);
  });

  it('QUAND LE CONSENSUS EST ATTEINT, la surface est là quand même', () => {
    // Forme uniforme : le lecteur n'a pas à savoir quand le champ existe.
    const v = tally([
      ballot('n1', 'claude-code', 'AAA', true, ['src/a.ts']),
      ballot('n2', 'codex', 'AAA', true, ['src/a.ts']),
    ]);
    expect(v.outcome).toBe('elected');
    expect(v.surfaces[0]?.votes).toBe(2);
  });
});
