// Sur quelle IA la ruche est-elle branchée ?
//
// Le voyant « connecté / hors ligne » de l'en-tête parle de la CONNEXION AU
// HUB. Une ruche peut être verte et n'avoir aucune ouvrière : c'est ce qui
// s'est produit — « 0 nœud(s) actif(s) » dans la réponse de la Reine, et rien
// à l'écran pour le dire. Ces bancs tiennent les quatre états.

import { describe, expect, it } from 'vitest';
import {
  aUneIaReelle,
  agentsConnectes,
  etatBandeau,
  type NoeudVu,
} from '../src/shared/agents-connectes.js';

function n(agentType: string, status: string): NoeudVu {
  return { agentType, status };
}

describe('agentsConnectes', () => {
  it('sans le moindre nœud, la liste est vide', () => {
    expect(agentsConnectes([])).toEqual([]);
  });

  it('compte séparément les en ligne et les muets du même agent', () => {
    const a = agentsConnectes([
      n('claude-code', 'online'),
      n('claude-code', 'offline'),
      n('claude-code', 'online'),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ agentType: 'claude-code', enLigne: 2, horsLigne: 1 });
  });

  it('seul « online » compte comme en ligne — tout autre statut est muet', () => {
    const a = agentsConnectes([n('codex', 'draining'), n('codex', 'dead')]);
    expect(a[0]).toMatchObject({ enLigne: 0, horsLigne: 2 });
  });

  it('donne le nom lisible, pas la clé de protocole', () => {
    const a = agentsConnectes([n('claude-code', 'online')]);
    expect(a[0]!.libelle).toBe('Claude Code');
  });

  it('marque « shell » comme simulé, et « claude-code » comme réel', () => {
    const a = agentsConnectes([n('shell', 'online'), n('claude-code', 'online')]);
    expect(a.find((x) => x.agentType === 'shell')!.simule).toBe(true);
    expect(a.find((x) => x.agentType === 'claude-code')!.simule).toBe(false);
  });

  it('le plus présent passe devant', () => {
    const a = agentsConnectes([
      n('codex', 'online'),
      n('claude-code', 'online'),
      n('claude-code', 'online'),
    ]);
    expect(a.map((x) => x.agentType)).toEqual(['claude-code', 'codex']);
  });

  it('à présence égale, l’ordre suit le libellé — jamais celui de la Map', () => {
    const versUn = agentsConnectes([n('codex', 'online'), n('claude-code', 'online')]);
    const versLautre = agentsConnectes([n('claude-code', 'online'), n('codex', 'online')]);
    expect(versUn.map((x) => x.agentType)).toEqual(['claude-code', 'codex']);
    expect(versLautre.map((x) => x.agentType)).toEqual(['claude-code', 'codex']);
  });

  it('un agent inconnu garde sa clé brute plutôt qu’un nom inventé', () => {
    const a = agentsConnectes([n('kimi', 'online')]);
    expect(a[0]!.libelle).toBe('kimi');
    expect(a[0]!.simule).toBe(false);
  });
});

describe('aUneIaReelle', () => {
  it('un shell EN LIGNE ne compte pas — c’est tout le piège', () => {
    expect(aUneIaReelle(agentsConnectes([n('shell', 'online')]))).toBe(false);
  });

  it('un Claude Code HORS LIGNE ne compte pas non plus', () => {
    expect(aUneIaReelle(agentsConnectes([n('claude-code', 'offline')]))).toBe(false);
  });

  it('un seul agent réel en ligne suffit', () => {
    expect(aUneIaReelle(agentsConnectes([n('shell', 'online'), n('codex', 'online')]))).toBe(true);
  });

  it('aucun nœud : aucune IA réelle', () => {
    expect(aUneIaReelle([])).toBe(false);
  });
});

describe('etatBandeau', () => {
  it('aucun nœud inscrit → « aucun_noeud »', () => {
    expect(etatBandeau(agentsConnectes([]))).toBe('aucun_noeud');
  });

  it('des nœuds inscrits mais tous muets → « aucune_ia »', () => {
    expect(etatBandeau(agentsConnectes([n('claude-code', 'offline')]))).toBe('aucune_ia');
  });

  it('un shell en ligne et rien d’autre → « simulee »', () => {
    expect(etatBandeau(agentsConnectes([n('shell', 'online')]))).toBe('simulee');
  });

  it('un agent réel en ligne → « reelle », même à côté d’un shell', () => {
    expect(etatBandeau(agentsConnectes([n('shell', 'online'), n('claude-code', 'online')]))).toBe(
      'reelle',
    );
  });

  it('un agent réel hors ligne ET un shell en ligne → « simulee », pas « reelle »', () => {
    expect(etatBandeau(agentsConnectes([n('claude-code', 'offline'), n('shell', 'online')]))).toBe(
      'simulee',
    );
  });
});
