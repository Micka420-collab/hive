// L'AIGUILLAGE APPRIS — la ruche envoie chaque genre au modèle qui l'a fait le
// mieux, sans cesser d'essayer les autres.
//
// Ce que ce banc protège, en une phrase : « garder le meilleur SANS se figer ».
// Les deux moitiés sont éprouvées séparément, parce qu'un module qui n'aurait
// que la première (toujours le meilleur connu) se verrouillerait sur un premier
// gagnant chanceux, et un module qui n'aurait que la seconde (toujours essayer)
// n'apprendrait jamais rien.

import { describe, expect, it } from 'vitest';
import {
  C_EXPLORATION,
  CORPUS_AIGUILLAGE,
  MASSE_A_PRIORI,
  MOYENNE_NEUTRE,
  aiguillerNoeuds,
  antecedentsDuVecu,
  bornesWilson,
  categoriser,
  choisirBras,
  classer,
  cle,
  cleBras,
  injecterEnVol,
  moyenne,
  recompenseDe,
  replierAntecedents,
  repriseHorsEchecs,
  scoreUCB,
  type Bras,
  type Observation,
  type VecuAiguillage,
} from '../src/orchestrator/aiguillage.js';
import type { Effort } from '../src/shared/effort.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';

/**
 * Fabrique une observation, pour ne pas répéter la forme. Par défaut : sous
 * Claude Code, sans effort commandé, sans coût déclaré.
 */
function obs(
  categorie: string,
  modele: string,
  suite: Suite,
  bras: { harness?: string | null; effort?: Effort | null; cout?: number | null } = {},
): Observation {
  return {
    categorie: categorie as Observation['categorie'],
    modele,
    harness: bras.harness === undefined ? 'claude-code' : bras.harness,
    effort: bras.effort ?? null,
    suite,
    coutUsd: bras.cout ?? null,
  };
}

/** Un bras, Claude Code et sans effort par défaut. */
function b(modele: string, harness = 'claude-code', effort: Effort | null = null): Bras {
  return { modele, harness, effort };
}

describe('categoriser — ranger une tâche par son genre', () => {
  it('RECONNAÎT CHAQUE GENRE sur un exemple clair, FR et EN', () => {
    expect(categoriser('Propose des pistes', 'brainstorm sur le modèle économique')).toBe(
      'ideation',
    );
    expect(categoriser('Ajoute un endpoint', 'implémente la nouvelle fonction')).toBe('code');
    expect(categoriser('Corrige le crash', 'la ruche plante au démarrage')).toBe('correction');
    expect(categoriser('Refactor', 'simplifie et déduplique ce module')).toBe('refactorisation');
    expect(categoriser('Coverage', 'ajoute des tests vitest et un banc')).toBe('test');
    expect(categoriser('README', 'documente la procédure et écris le guide')).toBe('documentation');
  });

  it('CE QUI NE RESSEMBLE À RIEN TOMBE DANS « autre » — jamais un genre inventé', () => {
    // La case fourre-tout DOIT exister : sans elle, une tâche muette serait
    // rangée de force dans un genre au hasard, et polluerait ses antécédents.
    expect(categoriser('', '')).toBe('autre');
    expect(categoriser('Réunion', 'point d’avancement hebdomadaire')).toBe('autre');
  });

  it('À ÉGALITÉ, LE PLUS SPÉCIFIQUE GAGNE — « corriger le test qui échoue » est une correction', () => {
    // LA garde de la précédence. Le geste (réparer) prime sur le décor (un
    // test). Sans l'ordre de précédence, ce cas basculerait au hasard.
    expect(categoriser('Corrige le test qui échoue', 'la correction du banc')).toBe('correction');
  });

  it('LE PLUS FOURNI L’EMPORTE — une allusion isolée ne détourne pas le classement', () => {
    // « ajoute un test au nouveau module » : `code` est cité deux fois
    // (ajoute, module), `test` une. C'est du code, avec un test.
    expect(categoriser('Ajoute un test au nouveau module', 'crée la fonction')).toBe('code');
  });

  it('LA CASSE NE CHANGE RIEN', () => {
    expect(categoriser('CORRIGE LE BUG', 'FIX THE CRASH')).toBe('correction');
  });
});

describe('recompenseDe — le verdict de contre-visite devient une note', () => {
  it('appliquer > améliorer > refaire, et bornée à [0,1]', () => {
    expect(recompenseDe('appliquer')).toBe(1);
    expect(recompenseDe('refaire')).toBe(0);
    // Le milieu n'est ni 0 ni 1 : « juste mais perfectible » n'est ni un échec
    // ni un sans-faute. C'est la valeur qui empêche de punir l'à-peu-près comme
    // le faux.
    expect(recompenseDe('ameliorer')).toBeGreaterThan(recompenseDe('refaire'));
    expect(recompenseDe('ameliorer')).toBeLessThan(recompenseDe('appliquer'));
  });
});

describe('replierAntecedents — la mémoire à deux niveaux, et l’oubli', () => {
  it('COMPTE LES ESSAIS ET SOMME LES NOTES, par bras ET par modèle', () => {
    const v = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'ameliorer', { effort: 'high' }),
      obs('code', 'fable', 'refaire'),
    ]);
    expect(v.bras.get(cleBras('code', b('opus')))).toEqual({ essais: 1, recompenseTotale: 1 });
    expect(v.bras.get(cleBras('code', b('opus', 'claude-code', 'high')))).toEqual({
      essais: 1,
      recompenseTotale: 0.5,
    });
    // Le niveau modèle réunit les deux efforts : c'est l'a priori de leurs frères.
    expect(v.modeles.get(cle('code', 'opus'))).toEqual({ essais: 2, recompenseTotale: 1.5 });
    expect(v.modeles.get(cle('code', 'fable'))).toEqual({ essais: 1, recompenseTotale: 0 });
  });

  it('NE MÉLANGE JAMAIS DEUX GENRES, DEUX MODÈLES NI DEUX HARNESS', () => {
    // Le même nom de modèle sous deux agents : deux bras. Les confondre
    // attribuait à Claude Code ce que Cline avait fait (G07).
    const v = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'refaire', { harness: 'cline' }),
      obs('test', 'opus', 'refaire'),
    ]);
    expect(moyenne(v.bras.get(cleBras('code', b('opus')))!)).toBe(1);
    expect(moyenne(v.bras.get(cleBras('code', b('opus', 'cline')))!)).toBe(0);
    expect(moyenne(v.modeles.get(cle('test', 'opus'))!)).toBe(0);
  });

  it('UN VERDICT SANS BRAS CONNU NOURRIT LE MODÈLE, JAMAIS UN BRAS PAR SUPPOSITION', () => {
    // Un verdict d'avant la v3 : on sait quel modèle, pas sous quel harness.
    const v = replierAntecedents([obs('code', 'opus', 'appliquer', { harness: null })]);
    expect(v.modeles.get(cle('code', 'opus'))).toEqual({ essais: 1, recompenseTotale: 1 });
    expect(v.bras.size, 'aucun bras inventé').toBe(0);
  });

  it('LE COÛT DÉCLARÉ SE SOMME AVEC SA COUVERTURE — un coût absent n’est pas un zéro', () => {
    const v = replierAntecedents([
      obs('code', 'opus', 'appliquer', { cout: 0.2 }),
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'appliquer', { cout: 0.4 }),
    ]);
    const a = v.bras.get(cleBras('code', b('opus')))!;
    expect(a.coutsDeclares, 'deux verdicts sur trois déclarent').toBe(2);
    expect(a.coutTotal).toBeCloseTo(0.6, 10);
  });

  it('OUBLIE AU-DELÀ DU CORPUS — un modèle n’est pas jugé sur ce qu’il n’est plus', () => {
    const vieux = Array.from({ length: CORPUS_AIGUILLAGE + 50 }, () =>
      obs('code', 'opus', 'refaire'),
    );
    const neuf = Array.from({ length: 3 }, () => obs('code', 'opus', 'appliquer'));
    const v = replierAntecedents([...vieux, ...neuf]);
    const a = v.bras.get(cleBras('code', b('opus')))!;
    expect(a.essais, 'la fenêtre est bornée').toBe(CORPUS_AIGUILLAGE);
    expect(a.recompenseTotale, 'les réussites récentes survivent').toBe(3);
    expect(v.modeles.get(cle('code', 'opus'))?.essais, 'les deux niveaux oublient ensemble').toBe(
      CORPUS_AIGUILLAGE,
    );
  });
});

describe('scoreUCB — le moteur UCB1 que garde le Garde-Fous', () => {
  it('UN ÉCHELON JAMAIS ESSAYÉ VAUT L’INFINI — trois échelons, trois essais forcés', () => {
    expect(scoreUCB({ essais: 0, recompenseTotale: 0 }, 100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('LE BONUS UTILISE LA CONSTANTE D’EXPLORATION — pas une valeur codée en dur', () => {
    const a = { essais: 4, recompenseTotale: 2 };
    const attendu = 0.5 + C_EXPLORATION * Math.sqrt(Math.log(16) / 4);
    expect(scoreUCB(a, 16)).toBeCloseTo(attendu, 10);
  });
});

describe('bornesWilson — l’intervalle qui ne ment pas sur peu d’essais', () => {
  it('RESTE DANS [0, 1] ET GARDE DE LA LARGEUR À 3 SUR 3', () => {
    // L'intervalle normal (p ± z·σ) serait NUL ici : σ = 0 quand p = 1.
    const { bas, haut } = bornesWilson(1, 3, 1.96);
    expect(haut).toBe(1);
    expect(bas).toBeGreaterThan(0.4);
    expect(bas).toBeLessThan(0.5);
  });

  it('SE RESSERRE AVEC LES ESSAIS, autour de la proportion', () => {
    const peu = bornesWilson(0.5, 4, 1.96);
    const beaucoup = bornesWilson(0.5, 400, 1.96);
    expect(beaucoup.haut - beaucoup.bas).toBeLessThan(peu.haut - peu.bas);
    expect(beaucoup.bas).toBeLessThan(0.5);
    expect(beaucoup.haut).toBeGreaterThan(0.5);
  });
});

describe('classer / choisirBras — le choix, et sa reproductibilité', () => {
  const vide = (): VecuAiguillage => ({ bras: new Map(), modeles: new Map() });

  it('SANS BRAS DISPONIBLE, on ne choisit RIEN — pas un bras inventé', () => {
    expect(choisirBras('code', [], vide())).toBeNull();
  });

  it('UN MODÈLE NEUF N’EST PLUS CHOISI D’OFFICE devant un bon modèle connu (plus de +∞)', () => {
    // Jusqu'à la v2, fable, jamais essayé, valait +∞ et raflait la tâche
    // suivante quel que soit le vécu d'opus. Il part désormais de 0,5 avec
    // l'incertitude de dix verdicts : vingt « appliquer » d'opus l'emportent.
    const vecu = replierAntecedents(
      Array.from({ length: 20 }, () => obs('code', 'opus', 'appliquer')),
    );
    expect(choisirBras('code', [b('opus'), b('fable')], vecu)).toEqual(b('opus'));
    const fable = classer('code', [b('opus'), b('fable')], vecu).rang.find(
      (r) => r.modele === 'fable',
    );
    expect(Number.isFinite(fable?.score), 'le score de l’inconnu est fini').toBe(true);
  });

  it('MAIS IL EST ESSAYÉ QUAND LE CONNU DÉÇOIT — l’exploration survit à la fin de l’infini', () => {
    // opus ne réussit qu'une fois sur quatre : l'optimisme dû à l'ignorance de
    // fable dépasse ce qu'on sait d'opus.
    const vecu = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      ...Array.from({ length: 3 }, () => obs('code', 'opus', 'refaire')),
    ]);
    expect(choisirBras('code', [b('opus'), b('fable')], vecu)?.modele).toBe('fable');
  });

  it('ET TOUT BRAS FINIT PAR ÊTRE RÉESSAYÉ — l’optimisme croît avec le total du genre', () => {
    // fable a raté deux fois ; opus réussit souvent mais pas toujours. Tant que
    // le genre a peu servi, opus garde la main ; plus le total grandit, plus la
    // borne haute d'un bras délaissé monte : la porte n'est jamais murée.
    const rate = [obs('code', 'fable', 'refaire'), obs('code', 'fable', 'refaire')];
    const opus = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        obs('code', 'opus', i % 3 === 0 ? 'ameliorer' : 'appliquer'),
      );
    const tot = (n: number) =>
      classer('code', [b('opus'), b('fable')], replierAntecedents([...rate, ...opus(n)])).rang.find(
        (r) => r.modele === 'fable',
      )!.score;
    expect(tot(200)).toBeGreaterThan(tot(10));
  });

  it('À VÉCU COMPARABLE, LE MEILLEUR L’EMPORTE — l’exploitation', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 10 }, () => obs('code', 'fable', 'refaire')),
    ]);
    expect(choisirBras('code', [b('opus'), b('fable')], vecu)?.modele).toBe('opus');
  });

  it('LE MÊME VÉCU DONNE LE MÊME CHOIX — quel que soit l’ordre des bras et des verdicts', () => {
    // Le déterminisme n'est pas une coquetterie : ce dépôt interdit
    // `Math.random`, et deux ruches au même vécu doivent faire le même choix.
    const verdicts = [
      obs('code', 'opus', 'appliquer'),
      obs('code', 'fable', 'ameliorer', { effort: 'low' }),
      obs('code', 'sonnet', 'refaire', { harness: 'cline' }),
      obs('code', 'opus', 'ameliorer', { effort: 'max' }),
    ];
    const bras = [
      b('opus'),
      b('opus', 'claude-code', 'max'),
      b('fable', 'claude-code', 'low'),
      b('sonnet', 'cline'),
      b('grok', 'grok'),
    ];
    const reference = classer('code', bras, replierAntecedents(verdicts));
    for (let i = 1; i < bras.length; i++) {
      const tourne = [...bras.slice(i), ...bras.slice(0, i)];
      expect(classer('code', tourne, replierAntecedents(verdicts))).toEqual(reference);
    }
    expect(classer('code', [...bras].reverse(), replierAntecedents(verdicts))).toEqual(reference);
  });

  it('À ÉGALITÉ PARFAITE, LE DÉPARTAGE EST TOTAL : modèle, harness, puis le moindre effort', () => {
    // Une ruche neuve : tous les bras se valent. Le plus petit nom de modèle
    // gagne ; entre deux efforts du même modèle, le moins coûteux.
    const bras = [
      b('opus', 'claude-code', 'max'),
      b('opus', 'claude-code', 'low'),
      b('opus', 'claude-code', 'high'),
      b('sonnet', 'claude-code', 'low'),
    ];
    const rang = classer('code', bras, vide()).rang;
    expect(rang.map((r) => r.effort)).toEqual(['low', 'high', 'max', 'low']);
    expect(rang[0]?.modele).toBe('opus');
  });

  it('classer RÉCITE TOUS LES BRAS, du meilleur au moins bon, avec leur vécu', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 5 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 5 }, () => obs('code', 'fable', 'ameliorer')),
      ...Array.from({ length: 5 }, () => obs('code', 'sonnet', 'refaire')),
    ]);
    const { rang } = classer('code', [b('opus'), b('fable'), b('sonnet')], vecu);
    expect(rang.map((r) => r.modele)).toEqual(['opus', 'fable', 'sonnet']);
    expect(rang[0]).toMatchObject({
      modele: 'opus',
      harness: 'claude-code',
      essais: 5,
      moyenne: 1,
    });
  });
});

describe('la mise en commun hiérarchique — un bras neuf d’un modèle connu n’est pas un inconnu', () => {
  it('UN EFFORT NEUF HÉRITE DE SON MODÈLE : bon modèle, bon a priori', () => {
    // opus a réussi vingt fois sans effort commandé ; le nœud déclare désormais
    // des efforts. Son bras « high », jamais jugé, part de ce qu'opus a montré ;
    // celui de fable, modèle raté, part de ce que fable a montré.
    const vecu = replierAntecedents([
      ...Array.from({ length: 20 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 20 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const { rang } = classer(
      'code',
      [b('opus', 'claude-code', 'high'), b('fable', 'claude-code', 'high')],
      vecu,
    );
    expect(rang[0]?.modele).toBe('opus');
    expect(rang[0]).toMatchObject({ essais: 0, intervalle: null });
  });

  it('LES VERDICTS DU BRAS NE COMPTENT PAS DEUX FOIS — l’a priori les retire du modèle', () => {
    // Seul bras du modèle : son a priori revient à la croyance neutre, et son
    // score ne dépend que de ses propres verdicts.
    const seul = classer('code', [b('opus')], replierAntecedents([obs('code', 'opus', 'refaire')]));
    const n = MASSE_A_PRIORI + 1;
    const attendu = bornesWilson((MASSE_A_PRIORI * MOYENNE_NEUTRE) / n, n, 0).haut;
    expect(seul.rang[0]?.score).toBeCloseTo(attendu, 12);
  });
});

describe('l’intervalle et l’état « décidé à δ » — un affichage, jamais un arrêt', () => {
  it('UN BRAS JAMAIS JUGÉ N’A PAS D’INTERVALLE, et l’élu d’une ruche neuve « explore »', () => {
    const { rang, etat } = classer('code', [b('opus'), b('fable')], {
      bras: new Map(),
      modeles: new Map(),
    });
    expect(rang.every((r) => r.intervalle === null)).toBe(true);
    expect(etat).toBe('explore');
  });

  it('DÉCIDÉ quand la borne basse de l’élu dépasse la borne haute de chaque rival jugé', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 40 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 40 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const c = classer('code', [b('opus'), b('fable')], vecu);
    expect(c.etat).toBe('decide');
    expect(c.rang[0]?.intervalle?.bas).toBeGreaterThan(c.rang[1]?.intervalle?.haut ?? 1);
  });

  it('UN RIVAL JAMAIS JUGÉ SUFFIT À « EXPLORE » — on n’a pas décidé contre un inconnu', () => {
    const vecu = replierAntecedents(
      Array.from({ length: 40 }, () => obs('code', 'opus', 'appliquer')),
    );
    expect(classer('code', [b('opus'), b('fable')], vecu).etat).toBe('explore');
  });

  it('DES INTERVALLES QUI SE CHEVAUCHENT RESTENT « EXPLORE »', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 3 }, () => obs('code', 'opus', 'appliquer')),
      obs('code', 'fable', 'appliquer'),
      obs('code', 'fable', 'refaire'),
    ]);
    expect(classer('code', [b('opus'), b('fable')], vecu).etat).toBe('explore');
  });

  it('UN SEUL BRAS EN LICE : « seul », il n’y a rien à départager', () => {
    expect(classer('code', [b('opus')], replierAntecedents([])).etat).toBe('seul');
  });

  it('DÉCIDÉ N’ARRÊTE PAS L’EXPLORATION — le rival garde un score fini qui monte', () => {
    const avec = (n: number) =>
      classer(
        'code',
        [b('opus'), b('fable')],
        replierAntecedents([
          ...Array.from({ length: n }, () => obs('code', 'opus', 'appliquer')),
          ...Array.from({ length: 40 }, () => obs('code', 'fable', 'refaire')),
        ]),
      );
    const fable = (n: number) => avec(n).rang.find((r) => r.modele === 'fable')!.score;
    expect(avec(200).etat).toBe('decide');
    expect(fable(200)).toBeGreaterThan(0);
    expect(fable(200), 'plus le genre sert, plus l’optimisme du délaissé grandit').toBeGreaterThan(
      fable(40),
    );
  });
});

describe('le coût — seulement quand TOUS les bras comparés le déclarent', () => {
  // Deux bras de même vécu : seule la pondération du coût peut les séparer.
  const verdicts = (coutOpus: number | null, coutFable: number | null) =>
    replierAntecedents([
      ...Array.from({ length: 6 }, () => obs('code', 'opus', 'appliquer', { cout: coutOpus })),
      ...Array.from({ length: 6 }, () => obs('code', 'fable', 'appliquer', { cout: coutFable })),
    ]);

  it('TOUS DÉCLARÉS : le moins cher passe devant, à qualité égale', () => {
    const c = classer('code', [b('opus'), b('fable')], verdicts(2, 0.5));
    expect(c.coutPondere).toBe(true);
    expect(c.rang[0]?.modele, 'fable coûte quatre fois moins').toBe('fable');
    expect(c.rang.find((r) => r.modele === 'opus')?.cout).toBe(2);
  });

  it('UN SEUL COÛT INCONNU ÉTEINT LE TERME POUR TOUS — jamais un mélange', () => {
    // Codex ne déclare que des jetons. Pondérer « quand c'est connu » ferait
    // payer à Claude Code sa transparence : le bras muet paraîtrait gratuit.
    const c = classer('code', [b('opus'), b('fable', 'codex')], verdicts(2, null));
    expect(c.coutPondere).toBe(false);
    const sansCout = classer('code', [b('opus'), b('fable', 'codex')], verdicts(null, null));
    expect(
      c.rang.map((r) => [r.modele, r.score]),
      'mêmes scores que si personne ne déclarait',
    ).toEqual(sansCout.rang.map((r) => [r.modele, r.score]));
  });

  it('UN BRAS NEUF (sans coût encore) ÉTEINT AUSSI LE TERME', () => {
    const c = classer('code', [b('opus'), b('fable'), b('sonnet')], verdicts(2, 0.5));
    expect(c.coutPondere).toBe(false);
  });
});

describe('aiguillerNoeuds — du bras élu aux nœuds qui savent le faire tourner', () => {
  const noeud = (
    id: string,
    modeles?: string[],
    agentType = 'claude-code',
    efforts?: Effort[],
  ) => ({ id, agentType, modeles, ...(efforts ? { efforts } : {}) });

  it('ÉLIT LE MEILLEUR BRAS SUR L’UNION, et ne rend que les nœuds qui le portent', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 4 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 4 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const route = aiguillerNoeuds('code', [noeud('n1', ['opus']), noeud('n2', ['fable'])], vecu);
    expect(route?.bras).toEqual(b('opus'));
    expect(route?.noeuds.map((n) => n.id)).toEqual(['n1']);
    expect(route?.rang[0]?.modele, 'l’élu est en tête du classement').toBe('opus');
  });

  it('LE MÊME MODÈLE SOUS DEUX HARNESS : deux bras, et seul le porteur du bon harness', () => {
    // opus a réussi sous Claude Code et raté sous Cline : les confondre enverrait
    // la tâche au nœud Cline sur la foi du vécu de Claude Code.
    const vecu = replierAntecedents([
      ...Array.from({ length: 6 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 6 }, () => obs('code', 'opus', 'refaire', { harness: 'cline' })),
    ]);
    const route = aiguillerNoeuds(
      'code',
      [noeud('cline', ['opus'], 'cline'), noeud('cc', ['opus'])],
      vecu,
    );
    expect(route?.bras.harness).toBe('claude-code');
    expect(route?.noeuds.map((n) => n.id)).toEqual(['cc']);
  });

  it('UN NŒUD QUI DÉCLARE DES EFFORTS N’OFFRE QUE CEUX-LÀ — jamais un effort à qui n’en déclare pas', () => {
    const route = aiguillerNoeuds(
      'code',
      [noeud('n1', ['opus'], 'claude-code', ['low', 'max']), noeud('n2', ['opus'], 'codex')],
      { bras: new Map(), modeles: new Map() },
    );
    const offerts = route?.rang.map((r) => `${r.harness}:${r.effort ?? '-'}`).sort();
    expect(offerts).toEqual(['claude-code:low', 'claude-code:max', 'codex:-']);
    for (const r of route?.rang ?? []) {
      if (r.harness === 'codex') expect(r.effort, 'Codex ne documente aucun effort').toBeNull();
    }
  });

  it('NO-OP quand AUCUN éligible ne déclare de modèle — l’appelant ne touche à rien', () => {
    expect(
      aiguillerNoeuds('code', [noeud('n1'), noeud('n2', [])], {
        bras: new Map(),
        modeles: new Map(),
      }),
    ).toBeNull();
  });

  it('PLUSIEURS PORTEURS de l’élu : tous rendus, dans l’ordre d’entrée (le départage de charge suit)', () => {
    const vecu = replierAntecedents([
      ...Array.from({ length: 4 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 4 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const route = aiguillerNoeuds(
      'code',
      [noeud('n1', ['opus']), noeud('n2', ['fable']), noeud('n3', ['opus'])],
      vecu,
    );
    expect(route?.noeuds.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('N’INVENTE JAMAIS un bras hors des éligibles', () => {
    const vecu = replierAntecedents(
      Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
    );
    const route = aiguillerNoeuds('code', [noeud('n1', ['fable'])], vecu);
    expect(route?.bras.modele).toBe('fable');
  });
});

describe('repriseHorsEchecs — un modèle qui a planté sur une tâche n’en reprend pas les tentatives', () => {
  const noeud = (id: string, modeles?: string[]) => ({ id, agentType: 'claude-code', modeles });

  it('ÉCARTE LES MODÈLES TOMBÉS — chaque éligible en est privé, dans l’ordre de charge, et qui n’offrait qu’eux ne porte plus', () => {
    const offre = [
      noeud('n2', ['grok', 'opus']),
      noeud('n1', ['fable', 'opus']),
      noeud('n3', ['grok']),
    ];
    const reprise = repriseHorsEchecs(offre, offre, new Set(['grok', 'fable', 'mistral']));
    expect(reprise.eligibles, 'n3, qui n’offrait que grok, ne porte plus la tâche').toEqual([
      noeud('n2', ['opus']),
      noeud('n1', ['opus']),
    ]);
    // `mistral` a planté, mais plus aucun nœud ne l'offre : il n'est pas dit
    // écarté — rien, dans le classement, ne manque à cause de lui.
    expect(reprise.ecartes, 'triés, pour une raison reproductible').toEqual(['fable', 'grok']);
    expect(
      aiguillerNoeuds('code', reprise.eligibles, replierAntecedents([]))?.rang.map((r) => r.modele),
    ).toEqual(['opus']);
  });

  it('DÉCIDE CONTRE L’OFFRE, PAS CONTRE LES LIBRES — un porteur sain occupé fait attendre la reprise', () => {
    // Seul le porteur de fable est libre ; celui d'opus travaille. Décidé
    // contre les libres, « tout ce qui est offert a planté » ré-élisait fable
    // jusqu'à épuiser les tentatives.
    const a = noeud('a', ['fable']);
    const reprise = repriseHorsEchecs([a], [a, noeud('b', ['opus'])], new Set(['fable']));
    expect(reprise).toEqual({ eligibles: [], ecartes: ['fable'] });
  });

  it('UN NŒUD SANS MODÈLE DÉCLARÉ PORTE LA TÂCHE — son défaut est inconnu, pas tombé', () => {
    const offre = [noeud('libre'), noeud('b', ['fable'])];
    const reprise = repriseHorsEchecs(offre, offre, new Set(['fable']));
    expect(reprise.eligibles.map((n) => n.id)).toEqual(['libre']);
    expect(
      aiguillerNoeuds('code', reprise.eligibles, replierAntecedents([])),
      'aucun modèle à commander',
    ).toBe(null);
  });

  it('PLUS AUCUN PORTEUR DANS TOUTE L’OFFRE — les modèles tombés concourent de nouveau, rien n’est dit écarté', () => {
    // Une ruche à modèle unique : l'écarter ferait attendre la tâche à jamais.
    // C'est à l'appelant de dire qu'il re-commande un modèle déjà tombé.
    const offre = [noeud('seule', ['fable'])];
    expect(repriseHorsEchecs(offre, offre, new Set(['fable']))).toEqual({
      eligibles: offre,
      ecartes: [],
    });
    expect(repriseHorsEchecs(offre, offre, undefined), 'rien n’a planté : rien ne change').toEqual({
      eligibles: offre,
      ecartes: [],
    });
  });
});

describe('injecterEnVol — le troupeau borné : un bras élu baisse dès son lancement', () => {
  it('UNE ÉLECTION EN VOL EST UN ESSAI SANS NOTE, compté à part, dans le seul niveau bras', () => {
    const v = replierAntecedents(Array.from({ length: 4 }, () => obs('code', 'opus', 'appliquer')));
    injecterEnVol(v, [{ categorie: 'code', modele: 'opus', harness: 'claude-code', effort: null }]);
    expect(v.bras.get(cleBras('code', b('opus')))).toEqual({
      essais: 5,
      recompenseTotale: 4,
      enVol: 1,
    });
    // Le niveau modèle n'en reçoit pas : un zéro jamais prononcé ne déprime pas
    // l'a priori des bras frères.
    expect(v.modeles.get(cle('code', 'opus'))).toEqual({ essais: 4, recompenseTotale: 4 });
  });

  it('LE BRAS ÉLU PERD DU TERRAIN DÈS LE LANCEMENT — sans quoi il raflerait tout le genre', () => {
    const avant = replierAntecedents([]);
    const apres = replierAntecedents([]);
    injecterEnVol(apres, [
      { categorie: 'code', modele: 'fable', harness: 'claude-code', effort: null },
    ]);
    const score = (v: VecuAiguillage) =>
      classer('code', [b('fable'), b('opus')], v).rang.find((r) => r.modele === 'fable')!.score;
    expect(score(apres)).toBeLessThan(score(avant));
    expect(
      choisirBras('code', [b('fable'), b('opus')], apres)?.modele,
      'l’autre passe devant',
    ).toBe('opus');
  });

  it('LE CLASSEMENT SÉPARE LE JUGÉ DE L’EN-VOL — un bras neuf en vol reste « à explorer »', () => {
    const v = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'appliquer'),
    ]);
    injecterEnVol(v, [{ categorie: 'code', modele: 'grok', harness: 'grok', effort: null }]);
    const grok = classer('code', [b('opus'), b('grok', 'grok')], v).rang.find(
      (r) => r.modele === 'grok',
    );
    expect(grok).toMatchObject({ essais: 0, enVol: 1, moyenne: 0, intervalle: null });
  });

  it('UNE ÉLECTION SANS BRAS CONNU N’EST ATTRIBUÉE À PERSONNE', () => {
    const v = replierAntecedents([]);
    injecterEnVol(v, [{ categorie: 'code', modele: 'opus', harness: null, effort: null }]);
    expect(v.bras.size).toBe(0);
  });
});

describe('UNE RUCHE SANS PASSÉ AFFICHE ZÉRO, JAMAIS NaN', () => {
  it('la moyenne d’un antécédent JAMAIS SERVI vaut 0', () => {
    expect(moyenne({ essais: 0, recompenseTotale: 0 })).toBe(0);
  });

  it('LE TABLEAU DE TRANSPARENCE D’UNE RUCHE NEUVE EST LISIBLE, scores finis compris', () => {
    const { rang } = classer('code', [b('opus'), b('sonnet'), b('grok', 'grok')], {
      bras: new Map(),
      modeles: new Map(),
    });
    expect(rang.length).toBe(3);
    for (const r of rang) {
      expect(r.moyenne, `${r.modele} : une moyenne sans vécu doit être 0`).toBe(0);
      expect(Number.isFinite(r.score), `${r.modele} : un score fini, sérialisable`).toBe(true);
    }
  });
});

describe('antecedentsDuVecu — le repli unique, pour qui choisit et pour qui montre', () => {
  it('LE MODÈLE PROUVÉ L’EMPORTE SUR LE COMMANDÉ — bras, coût et élections en vol suivent', () => {
    const tache = { title: 'Ajoute un endpoint', prompt: 'implémente la fonction' };
    const v = antecedentsDuVecu(
      [
        {
          ...tache,
          modele: 'opus',
          modeleExact: 'opus',
          harness: 'claude-code',
          suite: 'appliquer',
          coutUsd: 0.3,
        },
        {
          ...tache,
          modele: 'opus',
          modeleExact: 'fable',
          harness: 'claude-code',
          suite: 'refaire',
        },
        { ...tache, modele: 'fable', suite: 'appliquer' },
      ],
      [{ ...tache, modele: 'opus', harness: 'claude-code' }],
    );
    expect(v.bras.get(cleBras('code', b('opus')))).toEqual({
      essais: 2,
      recompenseTotale: 1,
      enVol: 1,
      coutTotal: 0.3,
      coutsDeclares: 1,
    });
    expect(v.bras.get(cleBras('code', b('fable')))).toEqual({ essais: 1, recompenseTotale: 0 });
    // Le verdict sans bras (fable, d'avant la v3) nourrit le seul niveau modèle.
    expect(v.modeles.get(cle('code', 'fable'))).toEqual({ essais: 2, recompenseTotale: 1 });
  });
});
