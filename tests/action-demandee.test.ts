// LA REINE RÉPOND À CÔTÉ QUAND ON LUI DEMANDE D'AGIR.
//
// La capture de l'utilisateur montrait la scène : il demande de SUPPRIMER un
// projet, et reçoit un bilan d'activité — « 0 nœud(s) actif(s) ». Pas un refus,
// pas une explication : un hors-sujet.
//
// Ces bancs tiennent la reconnaissance, et surtout ce qu'elle NE devient pas.

import { describe, expect, it } from 'vitest';
import { detecterAction, direAction, type ActionDemandee } from '../src/shared/action-demandee.js';

describe('reconnaître une demande d’action', () => {
  it('LA PHRASE DE LA CAPTURE est reconnue', () => {
    expect(detecterAction('supprime le projet Rucher')).toBe('supprimer');
    expect(detecterAction('tu peux supprimer ce projet ?')).toBe('supprimer');
    expect(detecterAction('efface tout ça')).toBe('supprimer');
  });

  it('les sept gestes, dans les deux langues', () => {
    const cas: [string, ActionDemandee][] = [
      ['supprime le projet', 'supprimer'],
      ['delete this project', 'supprimer'],
      ['arrête la tâche en cours', 'arreter'],
      ['stop the running task', 'arreter'],
      ['fusionne la branche', 'fusionner'],
      ['merge it please', 'fusionner'],
      ['renomme ce projet', 'renommer'],
      ['rename the project', 'renommer'],
      ['invite un collègue', 'inviter'],
      ['revoke his access', 'inviter'],
      ['créer un nouveau projet', 'creer'],
      ['create a project for me', 'creer'],
      ['lancer les tâches', 'lancer'],
      ['run the tasks now', 'lancer'],
    ];
    for (const [phrase, attendu] of cas) {
      expect(detecterAction(phrase), phrase).toBe(attendu);
    }
  });

  it('LE GESTE LE PLUS LOURD L’EMPORTE dans une phrase qui en mêle deux', () => {
    // « supprime ce projet et recrée-le » : c'est la suppression que
    // l'utilisateur a le plus besoin d'entendre qu'elle ne se fera pas seule.
    expect(detecterAction('supprime ce projet et crée-en un neuf')).toBe('supprimer');
    expect(detecterAction('arrête la tâche puis relance-la')).toBe('arreter');
  });

  it('LES ACCENTS ET LA CASSE NE CHANGENT RIEN', () => {
    expect(detecterAction('SUPPRIME LE PROJET')).toBe('supprimer');
    expect(detecterAction('arrête')).toBe('arreter');
    expect(detecterAction('arrete')).toBe('arreter');
    expect(detecterAction('Créé un projet')).toBe('creer');
  });
});

describe('ce qui n’est PAS une demande d’action — la condition pour ne rien casser', () => {
  it('les questions de consultation passent leur chemin', () => {
    // Si ce module répondait `non-null` ici, il volerait leur réponse à toutes
    // les questions que le concierge sait déjà traiter. C'est la garde qui
    // permet de le poser en BOUT de chaîne sans rien changer d'existant.
    for (const q of [
      'où en est le projet ?',
      'quelles ouvrières sont en ligne ?',
      'comment démarrer une course ?',
      'la ruche est-elle en bonne santé ?',
      'montre-moi les tâches récentes',
      'what happened recently?',
      'how is the swarm doing?',
    ]) {
      expect(detecterAction(q), q).toBeNull();
    }
  });

  it('LES FAUX AMIS ne déclenchent rien — les motifs sont bornés au début de mot', () => {
    // Sans la frontière, `cree` matcherait « décrété », « accrédité »,
    // « recrudescence » ; `stop` matcherait « stopover ».
    for (const q of [
      'le budget a été décrété la semaine dernière',
      'ce nœud est accrédité',
      'y a-t-il une recrudescence d’échecs ?',
      'raconte-moi le stopover de la dernière course',
    ]) {
      expect(detecterAction(q), q).toBeNull();
    }
  });

  it('un message VIDE ou anodin ne demande rien', () => {
    expect(detecterAction('')).toBeNull();
    expect(detecterAction('bonjour')).toBeNull();
    expect(detecterAction('merci !')).toBeNull();
  });
});

describe('ce que la Reine RÉPOND — et ce qu’elle ne propose jamais', () => {
  const ACTIONS: ActionDemandee[] = [
    'supprimer',
    'arreter',
    'fusionner',
    'renommer',
    'inviter',
    'creer',
    'lancer',
  ];

  it('elle NOMME ce qu’elle a compris — sinon on ne sait pas si on a été entendu', () => {
    expect(direAction('supprimer')).toContain('supprimer quelque chose');
    expect(direAction('supprimer', 'en')).toContain('delete something');
  });

  it('elle DIT qu’elle ne le fait pas, sans détour', () => {
    for (const a of ACTIONS) {
      expect(direAction(a), a).toContain('ne le fais pas depuis cette conversation');
      expect(direAction(a, 'en'), a).toContain('cannot do it from this conversation');
    }
  });

  it('elle DIT où le geste se trouve — on n’est pas renvoyé les mains vides', () => {
    for (const a of ACTIONS) {
      const fr = direAction(a);
      // Trois paragraphes : compris / limite / où.
      expect(fr.split('\n\n'), a).toHaveLength(3);
      expect(fr.split('\n\n')[2]!.length, a).toBeGreaterThan(30);
    }
  });

  it('LA SENTINELLE : elle ne propose JAMAIS de le faire quand même', () => {
    // « Voulez-vous que je le fasse ? » laisserait croire qu'un « oui »
    // suffirait — et il ne suffit pas, parce que rien n'est branché derrière.
    // Une question de ce genre serait une promesse que le code ne tient pas.
    for (const lang of ['fr', 'en'] as const) {
      for (const a of ACTIONS) {
        const texte = direAction(a, lang).toLowerCase();
        for (const promesse of [
          'voulez-vous que je',
          'souhaitez-vous que je',
          'je peux le faire',
          'do you want me to',
          'shall i',
          'i can do it',
        ]) {
          expect(texte, `${a}/${lang} : « ${promesse} »`).not.toContain(promesse);
        }
      }
    }
  });

  it('LA SENTINELLE : la suppression ne renvoie vers AUCUN raccourci', () => {
    // Le pire service qu'on puisse rendre ici : « cliquez là pour supprimer ».
    // Le tableau de bord demande une confirmation explicite sur l'objet nommé
    // (`GesteIrreversible`), et la réponse doit le DIRE plutôt que de router
    // vers un bouton comme si c'était une formalité.
    const fr = direAction('supprimer');
    expect(fr).toContain('confirmation explicite');
    expect(fr.toLowerCase()).not.toContain('cliquez ici');
    expect(direAction('supprimer', 'en')).toContain('explicit confirmation');
  });

  it('les deux langues diffèrent VRAIMENT — pas une copie du français', () => {
    for (const a of ACTIONS) {
      expect(direAction(a, 'en'), a).not.toBe(direAction(a, 'fr'));
    }
  });
});

// ─── LE FIL ENTIER : de la phrase de l'utilisateur à la réponse de la Reine ──
//
// Le module pur ci-dessus peut être parfait et ne servir à personne. Ce bloc
// passe par `answerLive`, c'est-à-dire par le vrai chemin : détection de
// langue, détection d'intention, choix de la réponse, puces de suivi.

import { answerLive } from '../src/orchestrator/concierge.js';
import type { ConciergeContext } from '../src/orchestrator/concierge.js';

/** Un contexte minimal : ce banc parle de l'INTENTION, pas de l'état. */
const CTX = {
  projects: [
    {
      id: 'p1',
      name: 'Rucher',
      repoUrl: null,
      description: null,
      visibility: 'private',
      ownerId: null,
      createdAt: 1,
    },
  ],
  nodes: [],
  reports: [],
  // Un VRAI tableau, pas `null` : le type `ConciergeContext` déclare `waggle`
  // non nullable et le serveur le construit toujours. Le `null` recopié d'un
  // banc voisin ne passait que par le `as unknown as` — un mensonge au typage
  // qui faisait planter `nodesReply` ici, sur un défaut qui n'existe pas en
  // production. On corrige le banc, pas le code.
  waggle: { nodes: [], totalTasksDone: 0, totalTasksFailed: 0, topNodeId: null },
  finishedTasks: [],
  enCours: [],
  sousAgents: [],
  races: [],
  memories: [],
  events: [],
} as unknown as ConciergeContext;

describe('de bout en bout — la scène de la capture ne se reproduit plus', () => {
  it('DEMANDER DE SUPPRIMER NE REND PLUS UN BILAN D’ACTIVITÉ', () => {
    // Le défaut d'origine, mot pour mot : la réponse parlait de nœuds actifs à
    // quelqu'un qui demandait de supprimer un projet.
    const r = answerLive('supprime le projet Rucher', CTX);
    expect(r.reply).toContain('supprimer quelque chose');
    expect(r.reply).toContain('ne le fais pas depuis cette conversation');
    expect(r.reply, 'plus de bilan d’activité hors sujet').not.toContain('nœud(s) actif');
  });

  it('ET LA RÉPONSE PART DANS LA LANGUE DU MESSAGE', () => {
    const r = answerLive('delete this project please', CTX);
    expect(r.lang).toBe('en');
    expect(r.reply).toContain('delete something');
    expect(r.reply).toContain('cannot do it from this conversation');
  });

  it('LES PUCES PROPOSENT CE QUE LE FIL SAIT VRAIMENT FAIRE', () => {
    // On refuse, mais on ne laisse pas en plan.
    const r = answerLive('supprime tout', CTX);
    expect(r.suggestions.length).toBeGreaterThan(0);
    for (const s2 of r.suggestions) {
      expect(s2.toLowerCase(), 'aucune puce ne propose un geste').not.toMatch(
        /supprim|efface|cree|lance|arrete/,
      );
    }
  });

  it('LA SENTINELLE : les questions de consultation gardent leur réponse', () => {
    // La reconnaissance est posée en BOUT de chaîne. Si elle passait devant,
    // « comment démarrer une course ? » deviendrait une demande de lancement,
    // et « crée-moi un brief » cesserait d'être un brief. Ce banc est la
    // condition qui autorisait ce lot à exister.
    expect(answerLive('comment démarrer une course ?', CTX).reply).not.toContain(
      'ne le fais pas depuis cette conversation',
    );
    expect(answerLive('où en est le projet ?', CTX).reply).not.toContain(
      'ne le fais pas depuis cette conversation',
    );
    expect(answerLive('quelles ouvrières sont en ligne ?', CTX).reply).not.toContain(
      'ne le fais pas depuis cette conversation',
    );
  });

  it('LA SENTINELLE : `creer` et `lancer` RESTENT EN QUEUE, et ça se voit', () => {
    // Ces deux verbes appartiennent pour de bon au vocabulaire de
    // consultation. Les faire passer devant, comme les cinq autres, volerait
    // leur réponse à des questions que le concierge sert déjà bien — et cette
    // mutation-là ne rougissait nulle part avant ce banc.
    const brief = answerLive('aide-moi à créer un bon brief', CTX);
    expect(brief.reply, 'un brief reste un brief').not.toContain(
      'ne le fais pas depuis cette conversation',
    );
    const course = answerLive('comment lancer une course ?', CTX);
    expect(course.reply, 'une question de course reste une question').not.toContain(
      'ne le fais pas depuis cette conversation',
    );
  });

  it('…ET POURTANT ILS SONT BIEN LÀ, en dernier recours', () => {
    // L'autre moitié : sans le filet de queue, « lance ça » retomberait sur le
    // bilan d'activité. Les deux bancs ensemble tiennent la POSITION du filet,
    // pas seulement son existence.
    for (const q of ['crée-moi ça', 'lance ça', 'lance les tâches']) {
      expect(answerLive(q, CTX).reply, q).toContain('ne le fais pas depuis cette conversation');
    }
  });

  it('LA LIMITE CONNUE, écrite plutôt que tue : « créer un NOUVEAU PROJET »', () => {
    // Mesuré : `progress`. Le nom « projet » l'emporte, comme il l'emportait
    // pour « supprime le projet » avant ce lot. La différence est assumée —
    // `creer` reste en queue parce que le faire passer devant coûterait les
    // deux bancs du dessus, et parce qu'une création manquée n'est pas une
    // suppression manquée.
    //
    // Ce banc n'approuve pas ce comportement : il le DATE. Le jour où on le
    // corrige, il rougit et rappelle ce qu'il faudra reprendre.
    const r = answerLive('créer un nouveau projet', CTX);
    expect(r.reply, 'aujourd’hui, cette phrase part encore vers l’avancement').not.toContain(
      'ne le fais pas depuis cette conversation',
    );
  });

  it('LA SENTINELLE : la Reine reste en LECTURE SEULE — rien n’est branché derrière', () => {
    // `answerLive` est pure par contrat (« jamais d'invention, jamais d'appel
    // réseau »). Ce banc tient que le lot n'a rien changé à ça : la réponse
    // d'action est du TEXTE, et le contexte reçu n'est pas touché.
    const avant = JSON.stringify(CTX);
    answerLive('supprime le projet Rucher', CTX);
    answerLive('arrête tout et relance', CTX);
    expect(JSON.stringify(CTX), 'le contexte ne doit pas bouger d’un octet').toBe(avant);
  });
});
