// Ce que la CLI affiche — les décisions, éprouvées hors de la CLI.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// `src/cli.ts` n'exporte rien : ses commandes appellent l'API puis
// `console.log`, et aucun banc ne peut les interroger. Un balayage élargi (base
// épinglée sur le commit d'origine, `LOUPE_CHEMINS=src/adapters,src/cli.ts`) a
// montré deux gardes d'affichage qu'on pouvait inverser sans qu'une assertion
// bouge :
//
//     if (board.nodes.length === 0)   muté en `!==`
//     if (v.sansSurface > 0)          muté en `>= 0`
//
// Le premier est le plus grave : inversé, un tableau PLEIN affiche « aucune
// contribution encore » et rend la main — tout le travail de l'essaim disparaît
// de l'écran, sans que rien ne signale la disparition.
//
// Les décisions sont descendues dans `shared/cli-rendu.ts` (§ 2 quaterdecies),
// et ce fichier les tient.

import { describe, expect, it } from 'vitest';
import {
  lignesSurfaces,
  lignesWaggle,
  type LigneNectar,
  type SurfaceVotee,
} from '../src/shared/cli-rendu.js';

function ouvriere(p: Partial<LigneNectar> = {}): LigneNectar {
  return {
    name: 'butineuse-1',
    agentType: 'claude-code',
    score: 30,
    tasksDone: 3,
    tasksFailed: 0,
    raceWins: 0,
    successRate: 1,
    avgDurationMs: 12_000,
    ...p,
  };
}

describe('le Waggle Board — ce qui s’affiche, et ce qui se dit quand il n’y a rien', () => {
  it('UN TABLEAU VIDE DIT POURQUOI IL EST VIDE — il ne rend pas un écran nu', () => {
    // Un écran nu se lit comme une panne, et la première réaction est de
    // relancer la commande.
    const lignes = lignesWaggle({ nodes: [], totalTasksDone: 0, totalTasksFailed: 0 });

    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain('Aucune contribution encore');
  });

  it('UN TABLEAU PLEIN NE DIT JAMAIS « aucune contribution » — la garde, dans l’autre sens', () => {
    // C'est CE cas que le mutant `=== 0` → `!== 0` faisait disparaître : le
    // classement entier remplacé par une phrase qui dit le contraire de la
    // vérité. Les deux sens comptent, et le second est le dangereux.
    const lignes = lignesWaggle({
      nodes: [ouvriere({ name: 'reine-nord' })],
      totalTasksDone: 3,
      totalTasksFailed: 0,
    });

    expect(lignes.join('\n'), 'un tableau plein ne peut pas se dire vide').not.toContain(
      'Aucune contribution',
    );
    expect(lignes.join('\n')).toContain('reine-nord');
    expect(lignes[0]).toContain('3 tâche(s) butinée(s)');
  });

  it('les trois premières portent une médaille, la quatrième un rang', () => {
    const lignes = lignesWaggle({
      nodes: [1, 2, 3, 4].map((i) => ouvriere({ name: `n${i}` })),
      totalTasksDone: 12,
      totalTasksFailed: 0,
    });

    const corps = lignes.slice(2);
    expect(corps[0]).toContain('🥇');
    expect(corps[1]).toContain('🥈');
    expect(corps[2]).toContain('🥉');
    expect(corps[3], 'au-delà du podium, un rang chiffré').toContain('4.');
    expect(corps[3], 'et surtout pas une médaille de plus').not.toMatch(/[🥇🥈🥉]/u);
  });

  it('une durée moyenne de 0 se dit « — », jamais « 0.0s/tâche »', () => {
    // Zéro n'est pas « instantané », c'est « on ne sait pas encore ». L'afficher
    // comme une durée annoncerait une performance que personne n'a mesurée.
    const inconnue = lignesWaggle({
      nodes: [ouvriere({ avgDurationMs: 0 })],
      totalTasksDone: 1,
      totalTasksFailed: 0,
    }).join('\n');
    expect(inconnue).toContain('—');
    expect(inconnue).not.toContain('0.0s');

    const connue = lignesWaggle({
      nodes: [ouvriere({ avgDurationMs: 1_000 })],
      totalTasksDone: 1,
      totalTasksFailed: 0,
    }).join('\n');
    expect(connue, 'une durée réelle, elle, s’affiche').toContain('1.0s/tâche');
  });

  it('les victoires de course ne s’affichent QUE s’il y en a', () => {
    const sans = lignesWaggle({
      nodes: [ouvriere({ raceWins: 0 })],
      totalTasksDone: 1,
      totalTasksFailed: 0,
    }).join('\n');
    expect(sans).not.toContain('⚔');

    const avec = lignesWaggle({
      nodes: [ouvriere({ raceWins: 2 })],
      totalTasksDone: 1,
      totalTasksFailed: 0,
    }).join('\n');
    expect(avec).toContain('⚔2');
  });
});

describe('le Parlement — le bloc des surfaces', () => {
  const surface = (p: Partial<SurfaceVotee> = {}): SurfaceVotee => ({
    votes: 2,
    agentTypes: ['claude-code', 'codex'],
    fichiers: ['src/a.ts'],
    ...p,
  });

  it('SANS RIEN À DIRE, LE BLOC N’EXISTE PAS — pas même son titre', () => {
    // Un en-tête sans contenu laisse croire qu'on a mesuré et qu'il n'y avait
    // rien ; la vérité est qu'on n'a rien pu mesurer.
    expect(lignesSurfaces({ surfaces: [], sansSurface: 0 })).toEqual([]);
  });

  it('« 0 bulletin sans diff lisible » NE S’ÉCRIT JAMAIS — ce serait une phrase fausse', () => {
    // La garde mutée en `>= 0` annonçait un rebut là où il n'y en avait pas eu.
    const lignes = lignesSurfaces({ surfaces: [surface()], sansSurface: 0 }).join('\n');

    expect(lignes).toContain('📍 Où le changement a été fait');
    expect(lignes, 'aucun bulletin écarté : rien à en dire').not.toContain('sans diff lisible');
  });

  it('un bulletin illisible est COMPTÉ et DIT — écarté, jamais pris pour un accord', () => {
    const lignes = lignesSurfaces({ surfaces: [surface()], sansSurface: 1 }).join('\n');

    expect(lignes).toContain('1 bulletin(s) sans diff lisible');
    expect(lignes).toContain('pas comptés comme d’accord');
  });

  it('l’avertissement de désaccord tient à DEUX surfaces, pas à une', () => {
    // Une seule surface votée est un accord. C'est à partir de la deuxième que
    // les agents se contredisent sur l'ENDROIT.
    const une = lignesSurfaces({ surfaces: [surface()], sansSurface: 0 }).join('\n');
    expect(une, 'une surface unique n’est pas un désaccord').not.toContain('pas d’accord');

    const deux = lignesSurfaces({
      surfaces: [surface(), surface({ fichiers: ['src/b.ts'] })],
      sansSurface: 0,
    }).join('\n');
    expect(deux).toContain('pas d’accord sur l’ENDROIT');
  });

  it('le bloc existe même sans AUCUNE surface, dès qu’un bulletin a été écarté', () => {
    // Sinon la seule information disponible — « on n'a rien pu lire » —
    // disparaîtrait de l'écran.
    const lignes = lignesSurfaces({ surfaces: [], sansSurface: 3 }).join('\n');
    expect(lignes).toContain('📍');
    expect(lignes).toContain('3 bulletin(s) sans diff lisible');
  });
});
