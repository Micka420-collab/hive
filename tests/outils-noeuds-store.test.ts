// LES CONSTATS D'OUTILS, CÔTÉ HUB — de l'inscription à la relecture.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// Le nœud dit ce qu'il VOIT sur sa machine : tel binaire est là, telle clé est
// lisible. Le hub RANGE ce constat et le rend tel quel — il n'en tire aucune
// conclusion, parce que la conclusion (« la ruche sait-elle s'en servir ? »)
// dépend du catalogue, qui vit ailleurs et bouge à son rythme.
//
// La table est LATÉRALE (règle 2 : aucune colonne ajoutée à `nodes`) et bornée
// par sa clé primaire (règle 3 : une ligne par nœud, jamais plus).
//
// Les quatre propriétés que ce banc tient :
//   1. un constat déclaré revient tel qu'il est parti ;
//   2. une ré-inscription SANS constat n'efface pas ce qu'on savait, une
//      ré-inscription AVEC constat écrase ;
//   3. un nœud qui n'a rien déclaré n'a pas d'`outils: []` inventé ;
//   4. une ligne illisible vaut « rien de connu », jamais une exception qui
//      ferait tomber toute la lecture des nœuds.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import type { OutilConstate } from '../src/shared/protocol.js';

const PROFIL = { name: 'poste-1', ownerName: 'mika', agentType: 'claude-code', maxConcurrency: 2 };

describe('HiveStore — les outils constatés par un nœud', () => {
  let store: HiveStore;
  beforeEach(() => {
    store = new HiveStore(':memory:');
  });
  afterEach(() => store.close());

  const constats: OutilConstate[] = [
    { agent: 'claude-code', binaire: true, cle: 'presente' },
    { agent: 'cursor', binaire: false, cle: 'absente' },
    { agent: 'windsurf', binaire: true, cle: 'inconnue' },
  ];

  it('UN CONSTAT DÉCLARÉ REVIENT TEL QU’IL EST PARTI', () => {
    const n = store.registerNode({ ...PROFIL, outils: constats });
    expect(n.outils).toEqual(constats);
    // Et il survit à la relecture depuis la base, pas seulement au retour direct.
    expect(store.getNode(n.id)?.outils).toEqual(constats);
    expect(store.listNodes()[0]?.outils).toEqual(constats);
  });

  it('UNE RÉ-INSCRIPTION SANS CONSTAT N’EFFACE RIEN', () => {
    // Le cas réel : un membre met à jour son nœud vers une version plus
    // ANCIENNE, ou lance un client qui ne sait pas encore déclarer. Effacer ici
    // ferait disparaître de l'écran des outils toujours installés.
    const n = store.registerNode({ ...PROFIL, outils: constats });
    const rebis = store.registerNode({ ...PROFIL, nodeId: n.id });
    expect(rebis.outils).toEqual(constats);
  });

  it('UNE RÉ-INSCRIPTION AVEC CONSTAT ÉCRASE — la dernière déclaration gagne', () => {
    // L'autre moitié de la règle. Quelqu'un qui désinstalle Cursor doit voir
    // l'écran le refléter : sans écrasement, le hub garderait un outil parti.
    const n = store.registerNode({ ...PROFIL, outils: constats });
    const apres: OutilConstate[] = [{ agent: 'claude-code', binaire: true, cle: 'presente' }];
    const rebis = store.registerNode({ ...PROFIL, nodeId: n.id, outils: apres });
    expect(rebis.outils).toEqual(apres);
    // La borne structurelle : une ligne par nœud, jamais deux.
    expect(store.getNode(n.id)?.outils).toHaveLength(1);
  });

  it('UN NŒUD QUI N’A RIEN DÉCLARÉ N’A PAS D’`outils: []` INVENTÉ', () => {
    // La distinction que l'écran doit pouvoir faire : « je ne sais pas » n'est
    // pas « aucun outil ». Un tableau qui affiche une liste vide pour un nœud
    // d'avant cette version accuse une machine nue qui ne l'est pas.
    const n = store.registerNode(PROFIL);
    expect(n.outils).toBeUndefined();
    expect(store.getNode(n.id)?.outils).toBeUndefined();
  });

  it('UNE LISTE VIDE DÉCLARÉE RESTE « rien de connu », pas une liste vide', () => {
    // `outils: []` est un constat légitime — la machine ne porte rien. Mais il
    // se relit comme l'absence de déclaration, et c'est VOULU : les deux se
    // disent pareil à l'écran (« on ne montre rien »), et distinguer deux
    // riens compliquerait la lecture sans rien apprendre.
    const n = store.registerNode({ ...PROFIL, outils: [] });
    expect(store.getNode(n.id)?.outils).toBeUndefined();
  });

  it('UNE LIGNE ILLISIBLE VAUT « rien de connu », jamais une exception', () => {
    // Base éditée à la main, version future, colonne tronquée : la lecture des
    // nœuds ne doit pas tomber pour autant. Tout le tableau de bord passe par
    // `listNodes`.
    const n = store.registerNode({ ...PROFIL, outils: constats });
    const db = (store as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } })
      .db;
    db.prepare('UPDATE outils_noeuds SET outils = ? WHERE nodeId = ?').run('{pas du json', n.id);
    expect(() => store.listNodes()).not.toThrow();
    expect(store.getNode(n.id)?.outils).toBeUndefined();
  });

  it('LES ENTRÉES MAL FORMÉES SONT ÉCARTÉES, PAS RÉPARÉES', () => {
    const n = store.registerNode({ ...PROFIL, outils: constats });
    const db = (store as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } })
      .db;
    db.prepare('UPDATE outils_noeuds SET outils = ? WHERE nodeId = ?').run(
      JSON.stringify([
        { agent: 'cline', binaire: true, cle: 'presente' }, // bonne
        { agent: '', binaire: true, cle: 'presente' }, // nom vide
        { agent: 'x', binaire: 'oui', cle: 'presente' }, // binaire pas booléen
        { binaire: true, cle: 'presente' }, // pas de nom
        null,
        'cursor',
      ]),
      n.id,
    );
    expect(store.getNode(n.id)?.outils).toEqual([
      { agent: 'cline', binaire: true, cle: 'presente' },
    ]);
  });

  it('UNE CLÉ INCONNUE DE LA RUCHE SE RELIT « inconnue », JAMAIS « absente »', () => {
    // Le tri-état existe pour une raison : conseiller de poser une clé DÉJÀ
    // posée est le pire conseil possible. Une valeur qu'on ne sait pas lire
    // doit donc retomber sur « je ne sais pas », pas sur « il n'y en a pas ».
    const n = store.registerNode({ ...PROFIL, outils: constats });
    const db = (store as unknown as { db: { prepare(s: string): { run(...a: unknown[]): void } } })
      .db;
    db.prepare('UPDATE outils_noeuds SET outils = ? WHERE nodeId = ?').run(
      JSON.stringify([
        { agent: 'a', binaire: true, cle: 'peut-être' },
        { agent: 'b', binaire: true, cle: 42 },
        { agent: 'c', binaire: true, cle: 'absente' },
      ]),
      n.id,
    );
    expect(store.getNode(n.id)?.outils).toEqual([
      { agent: 'a', binaire: true, cle: 'inconnue' },
      { agent: 'b', binaire: true, cle: 'inconnue' },
      { agent: 'c', binaire: true, cle: 'absente' },
    ]);
  });

  it('LES CONSTATS N’EMPORTENT NI LA PLATEFORME NI LES MODÈLES', () => {
    // Trois tables latérales, trois écritures indépendantes. Une seule
    // instruction qui les mélangerait ferait perdre l'une en déclarant l'autre.
    const n = store.registerNode({
      ...PROFIL,
      plateforme: 'linux',
      modeles: ['claude-opus-5'],
      outils: constats,
    });
    const relu = store.registerNode({ ...PROFIL, nodeId: n.id, outils: [constats[0]!] });
    expect(relu.plateforme).toBe('linux');
    expect(relu.modeles).toEqual(['claude-opus-5']);
    expect(relu.outils).toEqual([constats[0]]);
  });
});
