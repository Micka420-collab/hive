// LE LIEN TÂCHE→MODÈLE DE L'AIGUILLAGE, CÔTÉ STORE.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// L'Aiguillage appris (`aiguillage.ts`, pur) replie des `Observation[]`. Le
// seul fait qui n'existe nulle part ailleurs — quel modèle a produit quelle
// tâche — vit dans une table LATÉRALE `aiguillage_modeles` (règle 2 du dépôt :
// aucune colonne sur une table existante). Tout le reste est RECONSTRUIT par
// jointure, sans rien recopier :
//
//   · le verdict (`suite`) reste dans `contre_visites` ;
//   · la catégorie n'est pas stockée — `categoriser` la recalcule à la lecture.
//
// Les trois propriétés qui comptent, et que ce banc tient :
//   1. une observation n'apparaît QUE si l'on connaît À LA FOIS le modèle ET le
//      verdict (jointure interne) — un demi-fait ne fausse pas la mémoire ;
//   2. la reconstruction est bornée et rendue en ordre chronologique, tel que
//      `replierAntecedents` l'attend ;
//   3. la borne d'élagage retire les liens dont la tâche a disparu.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';

describe('HiveStore — le lien tâche→modèle de l’Aiguillage', () => {
  let store: HiveStore;
  beforeEach(() => {
    store = new HiveStore(':memory:');
  });
  afterEach(() => store.close());

  /** Crée une tâche réelle (projet + tâche), rend son id. */
  function tache(title: string, prompt: string): string {
    const p = store.createProject({ name: 'Rucher' });
    return store.createTask({ projectId: p.id, title, prompt }).id;
  }
  function verdict(taskId: string, suite: Suite, now: number): void {
    store.enregistrerContreVisite({
      productionTaskId: taskId,
      suite,
      raison: '',
      visiteurNodeId: 'n-visiteur',
      visiteurAgent: 'claude-code',
      now,
    });
  }

  it('UNE OBSERVATION APPARAÎT QUAND LE MODÈLE ET LE VERDICT SONT CONNUS', () => {
    const t = tache('Corrige le crash', 'la ruche plante');
    store.poserModeleAiguillage(t, 'claude-opus-5', 1_000);
    verdict(t, 'appliquer', 2_000);

    const obs = store.observationsAiguillage();
    expect(obs).toHaveLength(1);
    // On rend de quoi `categoriser` à la lecture (title + prompt), le modèle et
    // le verdict — jamais la catégorie figée.
    expect(obs[0]).toMatchObject({
      title: 'Corrige le crash',
      prompt: 'la ruche plante',
      modele: 'claude-opus-5',
      suite: 'appliquer',
    });
  });

  it('SANS LE MODÈLE, RIEN — un verdict seul ne suffit pas', () => {
    // Une tâche relue mais dont on ne sait pas quel modèle l'a produite (ex.
    // une tâche d'avant l'Aiguillage) : elle ne doit pas entrer dans la mémoire,
    // sinon on attribuerait son verdict à un modèle inconnu.
    const t = tache('Ajoute un endpoint', 'implémente');
    verdict(t, 'refaire', 2_000);
    expect(store.observationsAiguillage(), 'pas de modèle, pas d’observation').toEqual([]);
  });

  it('SANS LE VERDICT, RIEN — un modèle choisi mais pas encore jugé', () => {
    // La tâche vient d'être assignée à un modèle, mais la contre-visite n'est
    // pas revenue : il n'y a encore rien à apprendre.
    const t = tache('Refactor', 'simplifie');
    store.poserModeleAiguillage(t, 'claude-fable-5', 1_000);
    expect(store.observationsAiguillage(), 'pas de verdict, pas d’observation').toEqual([]);
  });

  it('ORDRE CHRONOLOGIQUE ET BORNE — les plus récentes, du plus ancien au plus neuf', () => {
    // Trois verdicts à des instants croissants. Avec une borne de 2, on garde
    // les DEUX plus récents (renduA 2000 et 3000), rendus dans l'ordre du temps.
    const a = tache('A', 'a');
    const b = tache('B', 'b');
    const c = tache('C', 'c');
    store.poserModeleAiguillage(a, 'm-a', 10);
    store.poserModeleAiguillage(b, 'm-b', 10);
    store.poserModeleAiguillage(c, 'm-c', 10);
    verdict(a, 'appliquer', 1_000);
    verdict(b, 'ameliorer', 2_000);
    verdict(c, 'refaire', 3_000);

    const obs = store.observationsAiguillage(2);
    expect(
      obs.map((o) => o.modele),
      'les 2 plus récents, chronologiques',
    ).toEqual(['m-b', 'm-c']);
  });

  it('INSERT OR REPLACE : la DERNIÈRE assignation gagne', () => {
    // Une tâche ré-assignée à un autre modèle : c'est le dernier qui a produit
    // le verdict, donc le seul qui compte.
    const t = tache('T', 't');
    store.poserModeleAiguillage(t, 'm-premier', 1_000);
    store.poserModeleAiguillage(t, 'm-dernier', 2_000);
    verdict(t, 'appliquer', 3_000);

    const obs = store.observationsAiguillage();
    expect(obs).toHaveLength(1);
    expect(obs[0]?.modele, 'la dernière assignation').toBe('m-dernier');
  });

  it('LA BORNE ÉLAGUE LES LIENS ORPHELINS — une tâche disparue emporte son lien', () => {
    // Le lien d'une tâche qui n'existe plus (élaguée) ne doit pas s'accumuler.
    // On pose un lien pour un id qui n'a jamais été une tâche : c'est un
    // orphelin, et `pruneAiguillageModeles` le retire. Le lien d'une vraie
    // tâche, lui, survit.
    const vivant = tache('Vivante', 'v');
    store.poserModeleAiguillage(vivant, 'm-vivant', 1_000);
    store.poserModeleAiguillage('tache-fantome', 'm-fantome', 1_000);

    expect(store.pruneAiguillageModeles(), 'un seul orphelin retiré').toBe(1);
    // Le lien vivant tient : reposer son verdict le fait réapparaître.
    verdict(vivant, 'appliquer', 2_000);
    expect(store.observationsAiguillage().map((o) => o.modele)).toEqual(['m-vivant']);
  });
});

describe('HiveStore — les modèles déclarés d’un nœud (ce que l’Aiguillage lira)', () => {
  let store: HiveStore;
  beforeEach(() => {
    store = new HiveStore(':memory:');
  });
  afterEach(() => store.close());

  const base = {
    name: 'ouvrière',
    ownerName: 'membre',
    agentType: 'claude-code',
    maxConcurrency: 2,
  };

  it('UN NŒUD QUI DÉCLARE SES MODÈLES LES VOIT RESSORTIR — au retour ET à la relecture', () => {
    // Le champ que l'Aiguillage lira pour choisir. Un champ rangé mais qui ne
    // ressort pas ne servirait à rien ; on le vérifie par les TROIS chemins de
    // lecture (retour d'inscription, getNode, listNodes), qui passent tous par
    // la même relecture JSON — un seul cassé les casse tous.
    const n = store.registerNode({
      ...base,
      nodeId: 'n1',
      modeles: ['claude-opus-5', 'claude-fable-5'],
    });
    expect(n.modeles).toEqual(['claude-opus-5', 'claude-fable-5']);
    expect(store.getNode('n1')?.modeles).toEqual(['claude-opus-5', 'claude-fable-5']);
    expect(store.listNodes()[0]?.modeles).toEqual(['claude-opus-5', 'claude-fable-5']);
  });

  it('UN NŒUD SANS MODÈLES N’EN INVENTE AUCUN — le champ reste ABSENT, jamais `[]`', () => {
    // Un agent à modèle unique, ou un nœud d'avant l'Aiguillage : `modeles`
    // absent veut dire « je n'ai rien déclaré », pas « je déclare une liste
    // vide ». L'Aiguillage retombe alors sur l'ordonnancement d'avant.
    const n = store.registerNode({ ...base, nodeId: 'n1' });
    expect(n.modeles, 'ni [] ni liste inventée').toBeUndefined();
    expect(store.getNode('n1')?.modeles).toBeUndefined();
  });

  it('LA RÉ-INSCRIPTION REMPLACE la liste — la dernière déclaration gagne', () => {
    store.registerNode({ ...base, nodeId: 'n1', modeles: ['a'] });
    store.registerNode({ ...base, nodeId: 'n1', modeles: ['b', 'c'] });
    expect(store.getNode('n1')?.modeles).toEqual(['b', 'c']);
  });

  it('UNE RÉ-INSCRIPTION SANS MODÈLES N’EFFACE PAS ce qu’on savait', () => {
    // Même règle que `plateforme` : un client d'une version antérieure qui se
    // reconnecte sans déclarer ne doit pas effacer une liste déjà apprise.
    store.registerNode({ ...base, nodeId: 'n1', modeles: ['a', 'b'] });
    store.registerNode({ ...base, nodeId: 'n1' });
    expect(store.getNode('n1')?.modeles).toEqual(['a', 'b']);
  });
});
