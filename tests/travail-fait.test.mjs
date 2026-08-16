// LE PAS 7/7, en décisions — « la ruche a-t-elle réellement travaillé ? »
//
// ─── CE QUE CE BANC DÉFEND, ET POURQUOI IL EXISTE ────────────────────────────
//
// Le parcours de seuil comptait six pas et s'arrêtait un cran trop tôt : aucun
// ne menait une tâche jusqu'à un résultat. `scripts/travail-fait.mjs` porte les
// décisions du septième, et ce banc les tient.
//
// Six mutants posés ensemble, chacun vérifié posé, suite ENTIÈRE verte —
// 292 fichiers, 4 203 tests. Un module neuf est nu par construction ; la mesure
// est faite quand même, parce que « par construction » est un raisonnement et
// pas un verdict.
//
// ─── LA DISTINCTION QUI PORTE LE FICHIER ─────────────────────────────────────
//
// `done` est DÉCLARATIF : c'est la ruche qui parle d'elle-même. Quatre choses
// de plus séparent « elle dit qu'elle a fini » de « elle a travaillé », et
// chacune casse en silence :
//
//     aucun résultat rangé      →  « done » n'appuie sur rien
//     que des échecs            →  fini n'est pas abouti
//     un diff vide              →  fini sans rien produire
//     un nœud inconnu           →  le travail au compte d'un fantôme
//
// Un pas de seuil qui gobe l'un de ces quatre passe au VERT sur une ruche qui
// n'a rien fait — c'est-à-dire précisément le contraire de ce qu'on lui demande.

import { describe, expect, it } from 'vitest';
import {
  DISPARUE,
  EN_COURS,
  FAITE,
  RATEE,
  creationAcceptee,
  defautDuTravail,
  doitAttendre,
  etatDeLaTache,
  gagnanteDe,
  identifiantCree,
  noeudsDe,
  racineDemandee,
  refusDeLEtat,
} from '../scripts/travail-fait.mjs';

/** Un instantané réduit à ce dont les décisions dépendent. */
const instantane = (tasks = [], nodes = []) => ({ tasks, nodes, projects: [], tasksTotal: 0 });

const tache = (id, status) => ({ id, status });

/** Une ligne de la table `results`, à la forme que le store rend. */
const resultat = (over = {}) => ({
  nodeId: 'n-ouvriere',
  success: true,
  diff: '--- a/miel.txt\n+++ b/miel.txt\n@@ -1 +1 @@\n-cire\n+miel\n',
  ...over,
});

const CONNUS = new Set(['n-ouvriere', 'n-reine']);

describe('l’état d’une tâche, vu depuis l’instantané que lit le tableau', () => {
  it('UNE TÂCHE TERMINÉE SE DIT FAITE — sinon rien ici ne mesure rien', () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    expect(etatDeLaTache(instantane([tache('t-1', 'done')]), 't-1')).toBe(FAITE);
  });

  it('UNE TÂCHE RATÉE N’EST PAS UNE TÂCHE FAITE', () => {
    // `failed` et `done` sont deux fins, pas la même. Confondues, le pas 7/7
    // passe au vert sur une ruche dont l'ouvrière s'est plantée — et l'arrivant
    // découvre à la main ce que la CI aurait dû lui dire.
    expect(
      etatDeLaTache(instantane([tache('t-1', 'failed')]), 't-1'),
      'un échec fini compte pour un succès',
    ).toBe(RATEE);
  });

  it('CE QUI COURT ENCORE SE DIT EN COURS — et rien d’autre', () => {
    for (const encore of ['queued', 'assigned', 'running']) {
      expect(etatDeLaTache(instantane([tache('t-1', encore)]), 't-1'), encore).toBe(EN_COURS);
    }
  });

  it('UNE TÂCHE SORTIE DE LA FENÊTRE SE DIT DISPARUE — pas « en cours »', () => {
    // ─── LA DISTINCTION QUI COÛTE LE PLUS CHER À CONFONDRE ─────────────────
    //
    // `getSnapshot()` porte une `LIMIT` : une tâche PEUT sortir du champ. Lue
    // « en cours », le pas attendrait sa patience entière — puis rendrait
    // « rien n'a bougé », un rouge qui accuse l'ouvrière alors que c'est la
    // fenêtre qui a glissé. Une heure perdue à chercher au mauvais endroit.
    expect(
      etatDeLaTache(instantane([tache('t-autre', 'running')]), 't-1'),
      'une tâche hors du champ se lit « en cours »',
    ).toBe(DISPARUE);
    expect(etatDeLaTache(instantane([]), 't-1'), 'un instantané vide').toBe(DISPARUE);
  });

  it('UN INSTANTANÉ MALFORMÉ NE FAIT PAS JETER LE PAS', () => {
    // Le pas interroge une ruche vivante : elle peut rendre autre chose que ce
    // qu'on attend. Une exception ici donnerait une pile Node là où il faut une
    // phrase.
    for (const tordu of [null, undefined, {}, { tasks: null }, { tasks: 'non' }]) {
      expect(etatDeLaTache(tordu, 't-1')).toBe(DISPARUE);
    }
  });
});

describe('les nœuds que la ruche connaît', () => {
  it('LES IDENTIFIANTS SE RELÈVENT — et les vides ne comptent pas', () => {
    const vus = noeudsDe(instantane([], [{ id: 'n-1' }, { id: '' }, {}, { id: 'n-2' }]));
    expect([...vus].sort(), 'un identifiant vide entre dans l’ensemble').toEqual(['n-1', 'n-2']);
    expect(noeudsDe(null).size, 'un instantané absent fait jeter').toBe(0);
  });
});

describe('ce qui manque à un travail pour être PROUVÉ', () => {
  it('UN TRAVAIL COMPLET NE MANQUE DE RIEN — sinon rien ici ne mesure rien', () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER ──────────────────────────────────
    expect(defautDuTravail([resultat()], CONNUS)).toBeNull();
  });

  it('« DONE » SANS AUCUN RÉSULTAT RANGÉ N’APPUIE SUR RIEN', () => {
    // Le statut est déclaratif : c'est la ruche qui parle d'elle-même. Sans une
    // ligne rangée en face, le pas croirait la ruche sur parole — et un
    // orchestrateur qui marque `done` sans jamais recevoir de résultat est
    // exactement le défaut qu'on veut attraper.
    const defaut = defautDuTravail([], CONNUS);
    expect(defaut, 'une tâche faite sans résultat passe').not.toBeNull();
    expect(defaut, 'le défaut ne dit pas ce qui manque').toContain('aucun résultat');
  });

  it('QUE DES ÉCHECS : FINI N’EST PAS ABOUTI', () => {
    // Deux résultats, aucun en succès — le cas d'une tâche disputée que deux
    // ouvrières ratent. La ligne existe, elle est rangée, et elle ne prouve
    // rien de ce qu'on affirme.
    const defaut = defautDuTravail(
      [resultat({ success: false }), resultat({ success: false, nodeId: 'n-reine' })],
      CONNUS,
    );
    expect(defaut, 'un résultat en échec vaut succès').not.toBeNull();
    expect(defaut, 'le compte des résultats n’est pas dit').toContain('2 résultat(s)');
  });

  it('UN SUCCÈS SANS DIFF N’A RIEN PRODUIT — et le vide de blancs non plus', () => {
    // ─── LA BORNE DU « QUELQUE CHOSE » ─────────────────────────────────────
    //
    // « Produire quelque chose » est la promesse entière du produit. Un diff
    // absent la casse, et un diff fait de blancs la casse EXACTEMENT PAREIL —
    // c'est la seule entrée qui départage `!== 'string'` de `.trim() === ''`.
    // Le `not.toBeNull()` d'abord, et ce n'est pas de la décoration : sur un
    // mutant qui laisse passer, `toContain` reçoit `null` et rend « the given
    // combination of arguments is invalid » — un verdict qui parle de
    // l'assertion et pas du défaut. Le rouge doit nommer ce qui a cassé.
    for (const [diff, quoi] of [
      ['', 'un diff vide passe'],
      ['   \n\t  ', 'un diff de blancs passe pour du travail'],
      [null, 'un diff absent passe'],
    ]) {
      const defaut = defautDuTravail([resultat({ diff })], CONNUS);
      expect(defaut, quoi).not.toBeNull();
      expect(defaut, 'le défaut ne dit pas que le diff manque').toContain('aucun diff');
    }
  });

  it('UN TRAVAIL AU COMPTE D’UN FANTÔME EST REFUSÉ', () => {
    // Le nœud du résultat doit être un nœud que la ruche connaît. Sinon le
    // tableau affichera un nom qui ne désigne personne, et le Waggle Board
    // classera une ouvrière qui n'existe pas.
    const defaut = defautDuTravail([resultat({ nodeId: 'n-fantome' })], CONNUS);
    expect(defaut, 'un nœud inconnu passe').not.toBeNull();
    expect(defaut, 'le défaut ne nomme pas le fantôme').toContain('n-fantome');
  });

  it('LA GAGNANTE EST CHERCHÉE, PAS PRISE AU HASARD DU RANG', () => {
    // Une course de drones range l'échec AVANT le succès. Prendre la première
    // ligne venue déclarerait la tâche non aboutie alors qu'une ouvrière a
    // gagné — un rouge sur un produit sain, ce qui apprend à ne plus croire les
    // rouges.
    expect(
      defautDuTravail([resultat({ success: false, diff: '' }), resultat()], CONNUS),
      'la première ligne décide au lieu de la gagnante',
    ).toBeNull();
  });
});

// ─── LES DÉCISIONS DESCENDUES DU COUREUR ─────────────────────────────────────
//
// La loupe a rendu SEPT lignes « SANS TEST » dans `scripts/essai-travail.mjs`.
// Six étaient des DÉCISIONS qui n'avaient rien à faire dans un coureur : elles
// sont descendues dans le module pur, et ce sont ces cas-là qui les tiennent.
//
// La septième — la borne `i < argv.length` — est un mutant ÉQUIVALENT, consigné
// à la ligne dans le module : `<=` ajoute un tour où `argv[i]` vaut `undefined`,
// qui ne correspond à aucun drapeau connu.
//
// CE QUI ÉTAIT DÉJÀ TENU : `gagnanteDe`. Le crible en lot a rougi, et
// l'attribution mutant par mutant a montré que c'était la seule — elle est
// tenue par ricochet, `defautDuTravail` s'en servant. Non rejouée ici, mais
// NOMMÉE, pour que le prochain lot ne refasse pas le doublon
// (§ 9 septentrigicenties).

describe('la lecture des arguments du coureur', () => {
  it('LA RACINE SE LIT APRÈS SON DRAPEAU — sinon rien ici ne mesure rien', () => {
    expect(racineDemandee(['--racine', '/la/ruche'])).toBe('/la/ruche');
  });

  it('SANS DRAPEAU, RIEN — et un drapeau nu ne rend pas le mot suivant', () => {
    expect(racineDemandee([]), 'une ligne vide invente une racine').toBeNull();
    expect(racineDemandee(['/la/ruche']), 'un mot seul passe pour une racine').toBeNull();
    expect(
      racineDemandee(['--racine']),
      'un drapeau sans valeur rend autre chose que null',
    ).toBeNull();
    expect(racineDemandee(null), 'un argv absent fait jeter').toBeNull();
  });
});

describe('la ruche a-t-elle ACCEPTÉ la tâche', () => {
  it('201 EST L’ACCEPTATION, 200 EST TOLÉRÉ — sinon rien ici ne mesure rien', () => {
    expect(creationAcceptee(201), '201 est refusé').toBe(true);
    expect(creationAcceptee(200), '200 est refusé').toBe(true);
  });

  it('TOUT LE RESTE EST UN REFUS — bornes comprises', () => {
    // ─── LA GARDE LA PLUS CHÈRE DU PAS, ET SES DEUX BORNES ─────────────────
    //
    // Sans elle, un `500` passerait pour une création réussie et l'instrument
    // de seuil déclarerait vert un produit qui vient de refuser. Un instrument
    // qui ment est pire que pas d'instrument.
    //
    // `199` et `202` sont les valeurs ÉGALES aux bornes de l'intervalle : une
    // acceptation écrite `>= 200 && <= 202` ne se départage QUE là.
    expect(creationAcceptee(199), '199 passe pour une acceptation').toBe(false);
    expect(creationAcceptee(202), '202 passe pour une acceptation').toBe(false);
    expect(creationAcceptee(500), 'un refus du serveur passe pour une création').toBe(false);
    expect(creationAcceptee(404), 'un projet inconnu passe pour une création').toBe(false);
  });
});

describe('l’identifiant de la tâche créée', () => {
  it('LE TABLEAU REND SON PREMIER IDENTIFIANT — sinon rien ici ne mesure rien', () => {
    expect(identifiantCree([{ id: 't-1' }, { id: 't-2' }])).toBe('t-1');
  });

  it('UNE RÉPONSE QUI N’EN PORTE PAS REND NULL — la chaîne vide comprise', () => {
    // La route rend un TABLEAU. Une enveloppe `{tasks:[…]}` supposée aurait
    // rendu `undefined` et fait échouer le pas sur sa propre lecture, en
    // accusant la ruche.
    expect(identifiantCree({ tasks: [{ id: 't-1' }] }), 'une enveloppe est acceptée').toBeNull();
    expect(identifiantCree([]), 'un tableau vide rend un identifiant').toBeNull();
    expect(identifiantCree([{ id: '' }]), 'la chaîne vide passe pour un identifiant').toBeNull();
    expect(identifiantCree([{}]), 'une tâche sans id passe').toBeNull();
    expect(identifiantCree(null), 'une réponse absente fait jeter').toBeNull();
  });
});

describe('faut-il continuer d’attendre', () => {
  it('SEUL « EN COURS » JUSTIFIE L’ATTENTE', () => {
    // Muté en « tout état fait attendre », la boucle irait au bout de sa
    // patience sur une tâche DÉJÀ finie — 90 s perdues à chaque exécution, et
    // un verdict rendu longtemps après qu'il était connu.
    expect(doitAttendre(EN_COURS), 'une tâche en cours n’est pas attendue').toBe(true);
    for (const fini of [FAITE, RATEE, DISPARUE]) {
      expect(doitAttendre(fini), `« ${fini} » fait encore attendre`).toBe(false);
    }
  });
});

describe('ce qu’un état de fin interdit de conclure', () => {
  it('UNE TÂCHE FAITE NE REFUSE RIEN — sinon rien ici ne mesure rien', () => {
    expect(refusDeLEtat(FAITE, 't-abcdef01-2345', 90)).toBeNull();
  });

  it('TROIS FINS, TROIS PHRASES — les confondre fait chercher au mauvais endroit', () => {
    // « court encore » accuse la lenteur ; « a quitté l'instantané » accuse la
    // fenêtre ; « l'a raté » accuse l'ouvrière. Une seule phrase pour les trois
    // enverrait chercher la panne là où elle n'est pas.
    const id = 't-abcdef01-2345';
    expect(refusDeLEtat(EN_COURS, id, 90), 'la lenteur ne se dit pas').toContain('court encore');
    expect(refusDeLEtat(EN_COURS, id, 90), 'la patience n’est pas chiffrée').toContain('90 s');
    expect(refusDeLEtat(DISPARUE, id, 90), 'la fenêtre qui glisse ne se dit pas').toContain(
      'quitté l’instantané',
    );
    expect(refusDeLEtat(RATEE, id, 90), 'l’échec de l’ouvrière ne se dit pas').toContain('raté');

    // Les trois sont DISTINCTES : un mutant qui les fusionne doit rougir.
    const dits = [EN_COURS, DISPARUE, RATEE].map((e) => refusDeLEtat(e, id, 90));
    expect(new Set(dits).size, 'deux fins rendent la même phrase').toBe(3);
  });

  it('LA TÂCHE EST NOMMÉE, ÉCOURTÉE — un uuid entier noie le verdict', () => {
    expect(refusDeLEtat(RATEE, 't-abcdef01-2345', 90)).toContain('t-abcdef');
    expect(refusDeLEtat(RATEE, null, 90), 'un identifiant absent fait jeter').toContain('?');
  });
});

describe('la gagnante — DÉJÀ TENUE, rejouée pour mémoire du lien', () => {
  it('c’est le SUCCÈS qui gagne, et `defautDuTravail` s’en sert', () => {
    // Ce cas ne ferme rien de neuf : `gagnanteDe` est la seule des sept lignes
    // que le crible a trouvée déjà défendue. Il ancre le LIEN — une seule
    // définition de « la gagnante » pour le module et pour le coureur.
    const perdue = { nodeId: 'n-1', success: false, diff: '' };
    const gagne = { nodeId: 'n-2', success: true, diff: 'd' };
    expect(gagnanteDe([perdue, gagne])).toBe(gagne);
    expect(gagnanteDe([perdue]), 'un échec devient la gagnante').toBeUndefined();
    expect(gagnanteDe(null), 'une liste absente fait jeter').toBeUndefined();
  });
});
