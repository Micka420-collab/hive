// LA LIVRAISON SANS GITHUB — ce qui se juge sans git : le nom de branche, le
// message et ses trailers, le découpage de la CLI, et le transport.
//
// Le banc git réel (commit, rangement, poussée) est `merge-runner-livraison`,
// le câblage hub ↔ nœud `livraison-locale-cablage`. Ici, les décisions pures —
// celles dont un mutant ferait livrer sous un faux nom ou mentir un trailer.

import { describe, expect, it } from 'vitest';
import {
  CONSENTEMENT_POUSSEE,
  brancheDeMission,
  decouperLivraisonArgv,
  messageDeMission,
  numeroDeMission,
  numeroSuivant,
  pousseeConsentie,
} from '../src/shared/livraison-locale.js';
import type { DemandeLivraisonLocale } from '../src/shared/livraison-locale.js';
import { laverIdentifiantsDuTexte } from '../src/shared/projet-public.js';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';

const DEMANDE: DemandeLivraisonLocale = {
  projectId: 'p',
  pousser: false,
  provenance: [
    { taskId: 'ta', resultId: 12, decision: 'accepted' },
    { taskId: 'tb', resultId: null, decision: 'human_review_required' },
  ],
};

/** Les trailers d'un message, tels que `git interpret-trailers --parse` les lirait. */
function trailers(message: string): string[] {
  const blocs = message.trimEnd().split('\n\n');
  return (blocs.at(-1) ?? '').split('\n');
}

describe('le nom de branche d’une mission', () => {
  it('se compose dans l’espace hive/ et se relit', () => {
    expect(brancheDeMission('p', 3)).toBe('hive/mission-p-3');
    expect(numeroDeMission('p', 'hive/mission-p-3')).toBe(3);
    expect(numeroDeMission('p', 'refs/heads/hive/mission-p-3')).toBe(3);
  });

  it('ne confond pas deux projets dont l’un préfixe l’autre', () => {
    // `hive/mission-p-1-2` est la 2e livraison du projet `p-1` — pas une
    // livraison du projet `p`. Confondus, `p` sauterait des numéros ou, pire,
    // `p-1` réutiliserait un numéro déjà pris.
    expect(numeroDeMission('p', 'hive/mission-p-1-2')).toBeNull();
    expect(numeroDeMission('p-1', 'hive/mission-p-1-2')).toBe(2);
    expect(numeroDeMission('p-1', 'hive/mission-p-12')).toBeNull();
    expect(numeroDeMission('p', 'hive/mission-p-0')).toBeNull();
    expect(numeroDeMission('p', 'hive/mission-p-3x')).toBeNull();
  });

  it('prend le numéro suivant le plus grand, local ou distant', () => {
    expect(numeroSuivant('p', [])).toBe(1);
    expect(
      numeroSuivant('p', ['refs/heads/main', 'hive/mission-p-2', 'refs/heads/hive/mission-p-7']),
    ).toBe(8);
    expect(numeroSuivant('p', ['hive/mission-p-1-9'])).toBe(1);
  });
});

describe('le message du commit porte la provenance', () => {
  it('nomme chaque tâche, son résultat exact et le verdict de l’Evaluator', () => {
    const msg = messageDeMission(DEMANDE, 4, { lances: true, commande: ['npm', 'test'] });
    expect(msg.split('\n')[0]).toBe('Hive — mission p, livraison n°4');
    expect(trailers(msg)).toEqual([
      'Hive-Mission: p',
      'Hive-Livraison: 4',
      'Hive-Task: ta',
      'Hive-Task: tb',
      'Hive-Result: ta 12',
      // Un résultat sans identifiant RESTE inconnu : `0` se lirait comme un id.
      'Hive-Result: tb inconnu',
      'Hive-Evaluator: ta accepted',
      'Hive-Evaluator: tb human_review_required',
      'Hive-Tests: ok — npm test',
    ]);
  });

  it('dit que les tests n’ont pas tourné plutôt que de se taire', () => {
    expect(trailers(messageDeMission(DEMANDE, 1, { lances: false })).at(-1)).toBe(
      'Hive-Tests: non-lances',
    );
  });

  it('un forçage se signe — et sa raison ne peut pas fabriquer un trailer', () => {
    const msg = messageDeMission(
      { ...DEMANDE, forcage: 'relu à la main\nHive-Evaluator: ta accepted' },
      1,
      { lances: false },
    );
    const lignes = trailers(msg);
    expect(lignes).toContain('Hive-Evaluator-Forced: relu à la main Hive-Evaluator: ta accepted');
    // Toujours UN seul verdict par tâche : la raison n'a pas ajouté de ligne.
    expect(lignes.filter((l) => l.startsWith('Hive-Evaluator: ta'))).toHaveLength(1);
  });
});

describe('le consentement à pousser', () => {
  it('ne s’active que sur « 1 » — jamais par une faute de frappe', () => {
    expect(pousseeConsentie({ HIVE_LIVRAISON_POUSSER: '1' })).toBe(true);
    for (const v of [undefined, '', '0', 'oui', 'true', ' 1']) {
      expect(pousseeConsentie({ HIVE_LIVRAISON_POUSSER: v }), String(v)).toBe(false);
    }
  });

  it('le refus dit comment l’accorder', () => {
    expect(CONSENTEMENT_POUSSEE).toContain('HIVE_LIVRAISON_POUSSER=1');
  });
});

describe('la CLI : livrer-local <projectId> [--pousser] [--forcer="…"] [cmd…]', () => {
  it('lit les options en tête, et laisse le reste à la commande de merge', () => {
    expect(decouperLivraisonArgv([])).toEqual({ pousser: false, reste: [] });
    expect(
      decouperLivraisonArgv(['--pousser', '--forcer=relu', '--preparer', 'npm', 'ci']),
    ).toEqual({ pousser: true, forcer: { raison: 'relu' }, reste: ['--preparer', 'npm', 'ci'] });
    // La forme qu'on tape, avec une espace.
    expect(decouperLivraisonArgv(['--forcer', 'relu à la main', 'npm', 'test'])).toEqual({
      pousser: false,
      forcer: { raison: 'relu à la main' },
      reste: ['npm', 'test'],
    });
  });

  it('une option APRÈS la commande appartient à la commande', () => {
    expect(decouperLivraisonArgv(['npm', 'test', '--pousser'])).toEqual({
      pousser: false,
      reste: ['npm', 'test', '--pousser'],
    });
  });

  it('passer outre l’Evaluator sans dire pourquoi est refusé', () => {
    expect(() => decouperLivraisonArgv(['--forcer'])).toThrow(/raison/);
    expect(() => decouperLivraisonArgv(['--forcer='])).toThrow(/raison/);
    expect(() => decouperLivraisonArgv(['--forcer', '  '])).toThrow(/raison/);
  });
});

describe('un identifiant ne remonte jamais au hub', () => {
  it('lave toute URL d’un message d’erreur de git', () => {
    const git =
      "fatal: unable to access 'https://moi:ghp_SECRET@git.exemple.test/d.git/': 403\n" +
      'remote: see ssh://jeton@hote/depot et http://hote/sans-identifiant';
    const lave = laverIdentifiantsDuTexte(git);
    expect(lave).not.toContain('ghp_SECRET');
    expect(lave).not.toContain('jeton@');
    expect(lave).toContain('https://***@git.exemple.test/d.git/');
    expect(lave).toContain('http://hote/sans-identifiant');
  });
});

describe('le transport : reconstruit, ou refusé', () => {
  const assign = (livraison: unknown) =>
    parseServerMessage(
      JSON.stringify({
        type: 'assign_merge',
        mergeId: 'm1',
        repoUrl: 'https://git.exemple.test/d.git',
        diffs: [{ taskId: 'ta', diff: '' }],
        livraison,
      }),
    );

  it('une demande bien formée arrive telle quelle, sans champ glissé', () => {
    const msg = assign({ ...DEMANDE, forcage: 'relu', branche: 'main' });
    expect(msg?.type).toBe('assign_merge');
    if (msg?.type !== 'assign_merge') return;
    expect(msg.livraison).toEqual({ ...DEMANDE, forcage: 'relu' });
    // Le hub ne désigne JAMAIS une branche : un champ en trop est oublié.
    expect(msg.livraison).not.toHaveProperty('branche');
  });

  it('une demande mal formée fait refuser le message entier', () => {
    for (const mauvaise of [
      { ...DEMANDE, projectId: '../x' },
      { ...DEMANDE, pousser: 'oui' },
      { ...DEMANDE, provenance: [] },
      { ...DEMANDE, provenance: [{ taskId: 'ta', resultId: -1, decision: 'accepted' }] },
      { ...DEMANDE, provenance: [{ taskId: 'ta', resultId: 1, decision: 'Accepté !' }] },
      { ...DEMANDE, forcage: '' },
    ]) {
      expect(assign(mauvaise), JSON.stringify(mauvaise)).toBeNull();
    }
  });

  const resultat = (livraison: unknown) =>
    parseClientMessage(
      JSON.stringify({
        type: 'merge_result',
        mergeId: 'm1',
        applied: ['ta'],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: '',
        livraison,
      }),
    );

  it('un rapport commité porte une branche de mission et un SHA complet', () => {
    const commit = 'a'.repeat(40);
    const msg = resultat({
      etat: 'commitee',
      branche: 'hive/mission-p-2',
      commit,
      poussee: 'refusee',
      motif: 'non consenti',
    });
    expect(msg?.type === 'merge_result' && msg.livraison).toEqual({
      etat: 'commitee',
      branche: 'hive/mission-p-2',
      commit,
      poussee: 'refusee',
      motif: 'non consenti',
    });
  });

  it('un rapport illisible fait refuser le résultat — un « commité » ne devient pas un silence', () => {
    for (const mauvais of [
      { etat: 'commitee', branche: 'main', commit: 'a'.repeat(40), poussee: 'poussee' },
      { etat: 'commitee', branche: 'hive/mission-p-1', commit: 'abc', poussee: 'poussee' },
      { etat: 'commitee', branche: 'hive/mission-p-1', commit: 'a'.repeat(40), poussee: 'forcee' },
      { etat: 'non_commitee' },
      { etat: 'peut-etre', motif: 'x' },
      // « Inconnue » est un constat du HUB : un nœud sait s'il a commité.
      { etat: 'inconnue', motif: 'x' },
    ]) {
      expect(resultat(mauvais), JSON.stringify(mauvais)).toBeNull();
    }
  });

  it('le consentement d’un nœud se déclare par un booléen, ou l’inscription est refusée', () => {
    const inscription = (pousseLivraisons: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'register',
          token: 'jeton',
          name: 'n',
          ownerName: 'o',
          agentType: 'shell',
          maxConcurrency: 1,
          pousseLivraisons,
        }),
      );
    const oui = inscription(true);
    expect(oui?.type === 'register' && oui.pousseLivraisons).toBe(true);
    expect(inscription('1')).toBeNull();
  });
});
