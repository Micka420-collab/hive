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
  aiguillerNoeuds,
  categoriser,
  choisirModele,
  classer,
  cle,
  moyenne,
  recompenseDe,
  replierAntecedents,
  scoreUCB,
  type Observation,
} from '../src/orchestrator/aiguillage.js';
import type { Suite } from '../src/orchestrator/polyethisme.js';

/** Fabrique une observation, pour ne pas répéter la forme. */
function obs(categorie: string, modele: string, suite: Suite): Observation {
  return { categorie: categorie as Observation['categorie'], modele, suite };
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

describe('replierAntecedents — la mémoire, et l’oubli', () => {
  it('COMPTE LES ESSAIS ET SOMME LES NOTES, par couple (genre × modèle)', () => {
    const m = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'ameliorer'),
      obs('code', 'fable', 'refaire'),
    ]);
    expect(m.get(cle('code', 'opus'))).toEqual({ essais: 2, recompenseTotale: 1.5 });
    expect(m.get(cle('code', 'fable'))).toEqual({ essais: 1, recompenseTotale: 0 });
  });

  it('NE MÉLANGE JAMAIS DEUX GENRES NI DEUX MODÈLES', () => {
    // La clé sépare `code|opus` de `test|opus` et de `code|fable`. Un mélange
    // ferait juger un modèle sur un genre qu'il n'a pas fait.
    const m = replierAntecedents([
      obs('code', 'opus', 'appliquer'),
      obs('test', 'opus', 'refaire'),
    ]);
    expect(moyenne(m.get(cle('code', 'opus'))!)).toBe(1);
    expect(moyenne(m.get(cle('test', 'opus'))!)).toBe(0);
  });

  it('OUBLIE AU-DELÀ DU CORPUS — un modèle n’est pas jugé sur ce qu’il n’est plus', () => {
    // On empile CORPUS+50 échecs anciens, puis 3 réussites récentes : seules
    // les dernières comptent. Sans l'oubli, le vieux vécu écraserait le neuf.
    const vieux = Array.from({ length: CORPUS_AIGUILLAGE + 50 }, () =>
      obs('code', 'opus', 'refaire'),
    );
    const neuf = [
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'appliquer'),
      obs('code', 'opus', 'appliquer'),
    ];
    const m = replierAntecedents([...vieux, ...neuf]);
    const a = m.get(cle('code', 'opus'))!;
    expect(a.essais, 'la fenêtre est bornée').toBe(CORPUS_AIGUILLAGE);
    // Les 3 dernières sont des réussites, donc la moyenne penche vers le haut,
    // et surtout PAS vers 0 comme le voudrait le vieux vécu intégral.
    expect(a.recompenseTotale, 'les réussites récentes survivent').toBeGreaterThan(0);
  });
});

describe('scoreUCB — exploiter le meilleur, explorer l’inconnu', () => {
  it('UN MODÈLE JAMAIS ESSAYÉ VAUT L’INFINI — « inconnu » n’est pas « mauvais »', () => {
    expect(scoreUCB({ essais: 0, recompenseTotale: 0 }, 100)).toBe(Number.POSITIVE_INFINITY);
  });

  it('LE BONUS D’EXPLORATION DÉCROÎT QUAND ON CONNAÎT MIEUX', () => {
    // Même moyenne (0.5), mais l'un a 2 essais et l'autre 20 : le peu-essayé
    // reçoit un plus gros bonus. C'est ce qui pousse à ré-essayer les
    // prometteurs sans s'y enfermer.
    const peu = scoreUCB({ essais: 2, recompenseTotale: 1 }, 100);
    const beaucoup = scoreUCB({ essais: 20, recompenseTotale: 10 }, 100);
    expect(peu).toBeGreaterThan(beaucoup);
  });

  it('LE BONUS UTILISE LA CONSTANTE D’EXPLORATION — pas une valeur codée en dur', () => {
    // Vérifie la formule, pour qu'un changement de `C_EXPLORATION` se répercute
    // vraiment plutôt que de laisser une constante fantôme.
    const a = { essais: 4, recompenseTotale: 2 };
    const attendu = 0.5 + C_EXPLORATION * Math.sqrt(Math.log(16) / 4);
    expect(scoreUCB(a, 16)).toBeCloseTo(attendu, 10);
  });
});

describe('classer / choisirModele — le choix, et sa reproductibilité', () => {
  const MODELES = ['opus', 'fable', 'sonnet'];

  it('SANS MODÈLE DISPONIBLE, on ne choisit RIEN — pas un modèle inventé', () => {
    expect(choisirModele('code', [], new Map())).toBeNull();
  });

  it('UN MODÈLE NEUF EST ESSAYÉ AVANT UN BON MODÈLE CONNU — sinon on ne l’apprendrait jamais', () => {
    // opus a un excellent vécu ; fable n'a jamais été essayé sur ce genre. UCB
    // envoie d'abord fable : c'est l'exploration, la moitié qu'un choix glouton
    // n'a pas.
    const memoire = replierAntecedents(
      Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
    );
    expect(choisirModele('code', ['opus', 'fable'], memoire)).toBe('fable');
  });

  it('À VÉCU COMPARABLE, LE MEILLEUR L’EMPORTE — l’exploitation', () => {
    // Les deux ont été essayés autant, mais opus récolte mieux. Une fois
    // l'inconnu levé, c'est la moyenne qui décide.
    const memoire = replierAntecedents([
      ...Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 10 }, () => obs('code', 'fable', 'refaire')),
    ]);
    expect(choisirModele('code', ['opus', 'fable'], memoire)).toBe('opus');
  });

  it('UN MAUVAIS CONFIRMÉ EST DÉLAISSÉ, MAIS PAS ABANDONNÉ POUR TOUJOURS', () => {
    // fable a beaucoup raté ; opus réussit. Sur beaucoup d'essais, opus gagne —
    // mais le score de fable reste fini et non nul : la porte n'est pas murée.
    const memoire = replierAntecedents([
      ...Array.from({ length: 50 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 50 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const rangs = classer('code', ['opus', 'fable'], memoire);
    expect(rangs[0]?.modele).toBe('opus');
    expect(Number.isFinite(rangs[1]?.score ?? Infinity), 'fable garde un score fini').toBe(true);
  });

  it('LE HASARD DE L’ORDRE NE CHANGE PAS LE CHOIX — reproductible d’une ruche à l’autre', () => {
    // Deux modèles jamais essayés (tous deux à +∞) : sans départage par le nom,
    // le choix dépendrait de l'ordre du tableau, et deux ruches au même vécu
    // divergeraient. On éprouve les six ordres possibles.
    const permutations = [
      ['opus', 'fable', 'sonnet'],
      ['fable', 'opus', 'sonnet'],
      ['sonnet', 'fable', 'opus'],
      ['opus', 'sonnet', 'fable'],
      ['fable', 'sonnet', 'opus'],
      ['sonnet', 'opus', 'fable'],
    ];
    const choix = permutations.map((p) => choisirModele('code', p, new Map()));
    expect(new Set(choix).size, 'un seul choix, quel que soit l’ordre').toBe(1);
    // Et ce choix est le nom le plus petit — déterministe et vérifiable.
    expect(choix[0]).toBe('fable');
  });

  it('classer RÉCITE TOUS LES MODÈLES, du meilleur au moins bon, avec leur vécu', () => {
    const memoire = replierAntecedents([
      ...Array.from({ length: 5 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 5 }, () => obs('code', 'fable', 'ameliorer')),
      ...Array.from({ length: 5 }, () => obs('code', 'sonnet', 'refaire')),
    ]);
    const rangs = classer('code', MODELES, memoire);
    expect(
      rangs.map((r) => r.modele),
      'trié par mérite : opus (1.0) > fable (0.5) > sonnet (0.0)',
    ).toEqual(['opus', 'fable', 'sonnet']);
    expect(rangs[0]).toMatchObject({ modele: 'opus', essais: 5, moyenne: 1 });
  });
});

describe('aiguillerNoeuds — du modèle élu aux nœuds qui savent le faire tourner', () => {
  // Un nœud réduit à ce que la fonction lit : son id (pour se distinguer) et ses
  // modèles. Le vrai HiveNode en porte davantage ; la fonction n'y touche pas.
  const noeud = (id: string, modeles?: string[]) => ({ id, modeles });

  it('ÉLIT LE MEILLEUR MODÈLE SUR L’UNION, et ne rend que les nœuds qui l’offrent', () => {
    // opus vit sur n1, fable sur n2 ; opus a le meilleur vécu sur « code ». La
    // ruche doit élire opus ET n'orienter que vers son porteur — envoyer la tâche
    // à n2 lui ferait tourner fable, pas le modèle choisi.
    const memoire = replierAntecedents([
      ...Array.from({ length: 4 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 4 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const route = aiguillerNoeuds('code', [noeud('n1', ['opus']), noeud('n2', ['fable'])], memoire);
    expect(route?.modele, 'opus a la meilleure moyenne sur ce genre').toBe('opus');
    expect(
      route?.noeuds.map((n) => n.id),
      'seul le porteur d’opus est rendu',
    ).toEqual(['n1']);
  });

  it('NO-OP quand AUCUN éligible ne déclare de modèle — l’appelant ne touche à rien', () => {
    // Une flotte d'avant l'Aiguillage (aucun `modeles`) ou aux listes vides : la
    // fonction rend `null`, signal à l'appelant de garder son ordonnancement.
    expect(
      aiguillerNoeuds('code', [noeud('n1'), noeud('n2', [])], new Map()),
      'rien à aiguiller',
    ).toBeNull();
  });

  it('EXPLORE : un modèle JAMAIS essayé (+∞) l’emporte sur un bon connu, et son porteur est rendu', () => {
    // opus a un vécu parfait ; grok n'a aucun vécu → score +∞ → il DOIT être
    // essayé avant qu'on prétende le connaître. La route mène alors à son porteur.
    const memoire = replierAntecedents(
      Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
    );
    const route = aiguillerNoeuds('code', [noeud('n1', ['opus']), noeud('n2', ['grok'])], memoire);
    expect(route?.modele, 'l’inconnu passe avant le bon connu').toBe('grok');
    expect(route?.noeuds.map((n) => n.id)).toEqual(['n2']);
  });

  it('PLUSIEURS PORTEURS de l’élu : tous rendus, dans l’ordre d’entrée (le départage de charge suit)', () => {
    // n1 et n3 offrent tous deux opus ; l'appelant a déjà trié par charge (n1
    // avant n3). La fonction préserve cet ordre — c'est lui qui départage ensuite.
    const memoire = replierAntecedents([
      ...Array.from({ length: 4 }, () => obs('code', 'opus', 'appliquer')),
      ...Array.from({ length: 4 }, () => obs('code', 'fable', 'refaire')),
    ]);
    const route = aiguillerNoeuds(
      'code',
      [noeud('n1', ['opus']), noeud('n2', ['fable']), noeud('n3', ['opus'])],
      memoire,
    );
    expect(route?.modele).toBe('opus');
    expect(
      route?.noeuds.map((n) => n.id),
      'les deux porteurs d’opus, ordre d’entrée préservé',
    ).toEqual(['n1', 'n3']);
  });

  it('N’INVENTE JAMAIS un modèle hors des éligibles — l’union se limite à ce qu’ils OFFRENT', () => {
    // opus a un vécu superbe, mais aucun éligible ne le propose : la ruche ne
    // peut pas l'exécuter, donc il n'entre pas dans l'union et n'est pas élu.
    // C'est le cœur de « union sur les éligibles » : la mémoire ne suffit pas,
    // il faut un porteur atteignable.
    const memoire = replierAntecedents(
      Array.from({ length: 10 }, () => obs('code', 'opus', 'appliquer')),
    );
    const route = aiguillerNoeuds('code', [noeud('n1', ['fable'])], memoire);
    expect(route?.modele, 'seul un modèle atteignable est élu').toBe('fable');
    expect(route?.noeuds.map((n) => n.id)).toEqual(['n1']);
  });
});
