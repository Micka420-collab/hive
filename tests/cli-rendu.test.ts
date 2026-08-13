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
  depuis,
  lignesMembres,
  lignesReponseReine,
  lignesSauvegarde,
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

describe('« depuis » — quatre seuils, et chacun a deux côtés', () => {
  // L'horloge est un PARAMÈTRE : sans lui, aucune de ces bornes ne pourrait
  // être éprouvée sans parier sur la vitesse de la machine.
  const MAINTENANT = Date.parse('2026-08-13T09:00:00Z');
  const jours = (n: number): number => MAINTENANT - n * 86_400_000;

  it('une date absente ne s’invente pas', () => {
    // Un dépôt jamais poussé n'a pas de date. « il y a 20 000 j » serait pire
    // que le tiret.
    expect(depuis(0, MAINTENANT)).toBe('—');
  });

  it('aujourd’hui / hier : la première borne, des deux côtés', () => {
    expect(depuis(jours(0), MAINTENANT)).toBe("aujourd'hui");
    expect(depuis(jours(1), MAINTENANT), '1 jour est « hier », pas « il y a 1 j »').toBe('hier');
    expect(depuis(jours(2), MAINTENANT), 'et 2 jours retombe dans le compte').toBe('il y a 2 j');
  });

  it('une date dans le FUTUR rend « aujourd’hui », jamais un nombre négatif', () => {
    // Horloge de travers, fuseau mal lu : ça arrive, et « il y a -3 j » n'aide
    // personne.
    expect(depuis(MAINTENANT + 86_400_000, MAINTENANT)).toBe("aujourd'hui");
  });

  it('le seuil du mois : 29 jours se comptent en jours, 30 en mois', () => {
    expect(depuis(jours(29), MAINTENANT)).toBe('il y a 29 j');
    expect(depuis(jours(30), MAINTENANT)).toBe('il y a 1 mois');
  });

  it('le seuil de l’an : 364 jours se comptent en mois, 365 en années', () => {
    expect(depuis(jours(364), MAINTENANT)).toBe('il y a 12 mois');
    expect(depuis(jours(365), MAINTENANT)).toBe('il y a 1 an(s)');
  });
});

describe('la réponse de la Reine', () => {
  it('LE BADGE DISTINGUE UNE MESURE D’UNE INVENTION', () => {
    // « état réel » est calculé sur la ruche ; « IA » est engendré par un
    // modèle. Confondre les deux ferait prendre une invention pour une mesure,
    // et c'est toute la valeur de cette commande.
    expect(
      lignesReponseReine({ reply: 'x', source: 'live', suggestions: [] }).join('\n'),
    ).toContain('📡 état réel');
    expect(lignesReponseReine({ reply: 'x', source: 'llm', suggestions: [] }).join('\n')).toContain(
      '✨ IA',
    );
  });

  it('SANS SUGGESTION, PAS D’INVITATION VIDE', () => {
    // « À demander ensuite : » suivi de rien laisse croire que la Reine a été
    // interrompue. C'est le mutant `> 0` → `>= 0` du balayage.
    const lignes = lignesReponseReine({ reply: 'x', source: 'live', suggestions: [] }).join('\n');
    expect(lignes).not.toContain('À demander ensuite');
  });

  it('avec des suggestions, elles sont là et séparées', () => {
    const lignes = lignesReponseReine({
      reply: 'x',
      source: 'live',
      suggestions: ['où en est la tâche 3 ?', 'qui butine le plus ?'],
    }).join('\n');
    expect(lignes).toContain('où en est la tâche 3 ? · qui butine le plus ?');
  });

  it('la réponse est INDENTÉE ligne à ligne — pas seulement la première', () => {
    // Une réponse multi-lignes dont seule la première est décalée se lit comme
    // deux blocs différents.
    const lignes = lignesReponseReine({
      reply: 'première\nseconde',
      source: 'live',
      suggestions: [],
    }).join('\n');
    expect(lignes).toContain('  première');
    expect(lignes).toContain('  seconde');
  });
});

describe('la sauvegarde — ne jamais annoncer un ménage qu’on n’a pas fait', () => {
  const base = { fichier: 'hive-2026-08-13.db', taille: '4,2 Mo' };

  it('RIEN D’ÉLAGUÉ, RIEN DE DIT', () => {
    // « 0 plus ancienne(s) retirée(s) » décrit un ménage qui n'a pas eu lieu.
    // Sur une commande dont le rôle est de dire ce qui a été FAIT au disque,
    // annoncer un geste qu'on n'a pas fait est pire qu'un silence.
    const lignes = lignesSauvegarde({ ...base, elaguees: [], restes: [] }, 7).join('\n');

    expect(lignes).toContain('hive-2026-08-13.db');
    expect(lignes).not.toContain('plus ancienne');
    expect(lignes).not.toContain('reste(s)');
  });

  it('ce qui A ÉTÉ élagué se dit, avec sa borne', () => {
    const lignes = lignesSauvegarde({ ...base, elaguees: ['a', 'b'], restes: ['c'] }, 7).join('\n');

    expect(lignes).toContain('2 plus ancienne(s) retirée(s) — borne : 7');
    expect(lignes).toContain('1 reste(s)');
  });
});

describe('« qui peut entrer » — les deux listes, et leurs deux vides', () => {
  const date = (ms: number): string => `le ${ms}`;
  const membre = { nodeId: 'n1', label: 'poste-lea', lastSeenAt: 42, revoque: false };
  const billet = { id: 'b1', etat: 'vivant', usesLeft: 2, expiresAt: 99 };

  it('SANS CLÉ DE NŒUD, on dit la CONSÉQUENCE — pas juste « aucun »', () => {
    // Pas de clé par nœud veut dire que tout le monde entre encore avec le
    // jeton maître, celui qui ne se révoque pas individuellement.
    const lignes = lignesMembres([], [billet], date).join('\n');
    expect(lignes).toContain('token maître');
  });

  it('UNE LISTE PLEINE NE PORTE JAMAIS « — aucun. » — on lit la phrase, on referme', () => {
    // C'est le mutant du balayage : `r.billets.length === 0` inversé mettait
    // « — aucun. » au-dessus d'une liste de billets bien vivants.
    const lignes = lignesMembres([membre], [billet], date).join('\n');

    expect(lignes, 'aucune des deux listes ne se dit vide').not.toContain('— aucun');
    expect(lignes).toContain('poste-lea');
    expect(lignes).toContain('b1');
  });

  it('les deux vides sont INDÉPENDANTS', () => {
    const sansBillet = lignesMembres([membre], [], date).join('\n');
    expect(sansBillet).toContain('— aucun.');
    expect(sansBillet, 'la liste des nœuds, elle, est pleine').not.toContain('token maître');
  });

  it('un nœud RÉVOQUÉ se voit — c’est toute l’utilité de la liste', () => {
    const lignes = lignesMembres([{ ...membre, revoque: true }], [], date).join('\n');
    expect(lignes).toContain('⛔');
    expect(lignes).toContain('(RÉVOQUÉ)');
  });

  it('un nœud jamais vu le dit, plutôt qu’une date inventée', () => {
    const lignes = lignesMembres([{ ...membre, lastSeenAt: null }], [], date).join('\n');
    expect(lignes).toContain('vu jamais');
  });

  it('chaque état de billet a son icône, et l’inconnu a la sienne', () => {
    const etats = ['vivant', 'expire', 'epuise', 'revoque', 'martien'];
    const lignes = lignesMembres(
      [],
      etats.map((etat, i) => ({ ...billet, id: `b${i}`, etat })),
      date,
    ).join('\n');

    expect(lignes).toContain('✔ b0');
    expect(lignes).toContain('⌛ b1');
    expect(lignes).toContain('∅ b2');
    expect(lignes).toContain('⛔ b3');
    expect(lignes, 'un état inconnu ne se déguise pas en état connu').toContain('? b4');
  });
});
