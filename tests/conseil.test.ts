// Le Conseil des Éclaireuses — le protocole de délibération.
//
// Ces tests ne vérifient pas « ça calcule un score ». Ils vérifient que le
// protocole résiste aux QUATRE PIÈGES qui ruinent une délibération d'agents et
// qui, sans garde explicite, se produisent tous par défaut :
//
//   1. la première idée gagne par accumulation ;
//   2. dix clones d'accord passent pour dix avis ;
//   3. une éclaireuse s'approuve elle-même ;
//   4. le débat ne s'arrête jamais.
//
// Chacun a son test nommé. Si l'un tombe, le conseil ne délibère plus : il
// entérine.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DIVERSITE_MIN,
  LENTILLES,
  POIDS_ARRET,
  QUESTION_DEFAUT,
  QUORUM_ECLAIREUSES,
  TOURS_MAX,
  TOURS_SECS,
  VERSION_CONSEIL,
  decroissance,
  encoreUnTour,
  evaluerConseil,
} from '../src/orchestrator/conseil.js';
import type { Avis, EtatConseil, Proposition } from '../src/orchestrator/conseil.js';

const prop = (p: Partial<Proposition> = {}): Proposition => ({
  id: 'P1',
  eclaireuse: 'alice',
  famille: 'claude-code',
  titre: 'Idée',
  qualite: 7,
  tour: 1,
  ...p,
});

const avis = (a: Partial<Avis> = {}): Avis => ({
  propositionId: 'P1',
  eclaireuse: 'bob',
  famille: 'codex',
  type: 'soutien',
  force: 8,
  tour: 1,
  ...a,
});

/** Trois soutiens de familles diverses : le minimum pour un quorum. */
function troisSoutiens(propositionId = 'P1', tour = 1): Avis[] {
  return [
    avis({ propositionId, eclaireuse: 'bob', famille: 'codex', tour }),
    avis({ propositionId, eclaireuse: 'carol', famille: 'claude-code', tour }),
    avis({ propositionId, eclaireuse: 'dave', famille: 'hermes', tour }),
  ];
}

describe('piège n° 1 — la première idée ne gagne pas par ancienneté', () => {
  it('une danse non renforcée S’ÉTEINT', () => {
    // Sans décroissance, un soutien du tour 1 pèserait encore au tour 5 : la
    // proposition arrivée en premier accumulerait du soutien par sa seule
    // ancienneté, et aucune idée ultérieure ne pourrait la rattraper.
    expect(decroissance(1, 1)).toBe(1);
    expect(decroissance(1, 2)).toBe(0.5);
    expect(decroissance(1, 3)).toBe(0.25);
    expect(decroissance(1, 5)).toBeLessThan(0.1);
  });

  it('une vieille proposition largement soutenue passe DERRIÈRE une neuve re-défendue', () => {
    const etat: EtatConseil = {
      tour: 4,
      propositions: [
        prop({ id: 'ANCIENNE', tour: 1 }),
        prop({ id: 'NEUVE', eclaireuse: 'zoe', tour: 4 }),
      ],
      avis: [
        // L'ancienne : quatre soutiens forts… mais tous du tour 1.
        ...troisSoutiens('ANCIENNE', 1),
        avis({ propositionId: 'ANCIENNE', eclaireuse: 'erin', famille: 'codex', tour: 1 }),
        // La neuve : deux soutiens, mais de maintenant.
        avis({ propositionId: 'NEUVE', eclaireuse: 'bob', famille: 'codex', tour: 4, force: 7 }),
        avis({ propositionId: 'NEUVE', eclaireuse: 'carol', famille: 'hermes', tour: 4, force: 7 }),
      ],
    };
    const v = evaluerConseil(etat);
    expect(v.danses[0]?.proposition.id).toBe('NEUVE');
  });

  it('le soutien le PLUS RÉCENT d’une éclaireuse remplace le précédent', () => {
    // Sinon une éclaireuse insistante pèserait autant que plusieurs.
    const etat: EtatConseil = {
      tour: 2,
      propositions: [prop()],
      avis: [
        avis({ eclaireuse: 'bob', force: 9, tour: 1 }),
        avis({ eclaireuse: 'bob', force: 1, tour: 2 }), // il a changé d'avis
      ],
    };
    const d = evaluerConseil(etat).danses[0]!;
    expect(d.soutiens).toEqual(['bob']); // compté UNE fois
    expect(d.intensite).toBe(1); // la valeur récente, pas 9 ni 9×0.5+1
  });
});

describe('piège n° 2 — dix clones ne font pas dix avis', () => {
  it('le quorum exige des FAMILLES d’agent distinctes', () => {
    const memeFamille: Avis[] = [
      avis({ eclaireuse: 'a1', famille: 'claude-code' }),
      avis({ eclaireuse: 'a2', famille: 'claude-code' }),
      avis({ eclaireuse: 'a3', famille: 'claude-code' }),
      avis({ eclaireuse: 'a4', famille: 'claude-code' }),
      avis({ eclaireuse: 'a5', famille: 'claude-code' }),
    ];
    const v = evaluerConseil({ tour: 1, propositions: [prop()], avis: memeFamille });
    // Cinq soutiens — plus que le quorum — mais une seule famille.
    expect(v.danses[0]?.soutiens).toHaveLength(5);
    expect(v.danses[0]?.familles).toEqual(['claude-code']);
    expect(v.danses[0]?.quorum).toBe(false);
    expect(v.issue).toBe('sans_quorum');
  });

  it('trois éclaireuses de deux familles suffisent', () => {
    const v = evaluerConseil({ tour: 1, propositions: [prop()], avis: troisSoutiens() });
    expect(v.danses[0]?.quorum).toBe(true);
    expect(v.issue).toBe('quorum');
    expect(v.retenue?.proposition.id).toBe('P1');
  });

  it('la même éclaireuse ne compte qu’une fois, même sous deux familles', () => {
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop()],
      avis: [
        avis({ eclaireuse: 'bob', famille: 'codex' }),
        avis({ eclaireuse: 'bob', famille: 'hermes' }), // même personne
        avis({ eclaireuse: 'carol', famille: 'claude-code' }),
      ],
    });
    expect(v.danses[0]?.soutiens).toEqual(['bob', 'carol']);
    expect(v.danses[0]?.quorum).toBe(false); // 2 < QUORUM_ECLAIREUSES
  });
});

describe('piège n° 3 — une éclaireuse ne s’approuve pas elle-même', () => {
  it('l’auto-soutien est IGNORÉ, et signalé', () => {
    // Il n'apporte aucune information : elle répète ce qu'elle a déjà dit en
    // proposant. Le signaler permet de le voir sans le compter.
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop({ eclaireuse: 'alice' })],
      avis: [avis({ eclaireuse: 'alice', famille: 'claude-code', force: 10 })],
    });
    const d = v.danses[0]!;
    expect(d.autoSoutienIgnore).toBe(true);
    expect(d.soutiens).toEqual([]);
    expect(d.intensite).toBe(0);
    expect(d.quorum).toBe(false);
  });

  it('une proposition auto-soutenue ne franchit JAMAIS le quorum grâce à ça', () => {
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop({ eclaireuse: 'alice' })],
      avis: [
        avis({ eclaireuse: 'alice', famille: 'claude-code' }), // ignoré
        avis({ eclaireuse: 'bob', famille: 'codex' }),
        avis({ eclaireuse: 'carol', famille: 'hermes' }),
      ],
    });
    expect(v.danses[0]?.soutiens).toEqual(['bob', 'carol']); // 2, pas 3
    expect(v.danses[0]?.quorum).toBe(false);
  });

  it('la qualité auto-évaluée n’entre PAS dans le quorum', () => {
    // Une éclaireuse qui note sa trouvaille 10/10 ne se hisse pas au quorum.
    const v = evaluerConseil({ tour: 1, propositions: [prop({ qualite: 10 })], avis: [] });
    expect(v.danses[0]?.intensite).toBe(0);
    expect(v.issue).toBe('sans_quorum');
  });
});

describe('piège n° 4 — le débat s’arrête', () => {
  it('au-delà de TOURS_MAX, le conseil rend « épuisé » et le dit', () => {
    const v = evaluerConseil({
      tour: TOURS_MAX,
      propositions: [prop()],
      avis: [avis({ eclaireuse: 'bob' })],
    });
    expect(v.issue).toBe('epuise');
    expect(v.continuer).toBe(false);
    expect(v.motif).toMatch(/temps-ouvrière/);
  });

  it('l’exploration s’arrête après TOURS_SECS tours sans rien de neuf', () => {
    // Un conseil qui tourne à vide coûte du temps-ouvrière réel, que La Balance
    // compterait en « utile » — faussant le rendement de la ruche.
    expect(encoreUnTour(1, 0)).toBe(true);
    expect(encoreUnTour(1, TOURS_SECS)).toBe(false);
    expect(encoreUnTour(TOURS_MAX, 0)).toBe(false);
  });

  it('un conseil vide le dit franchement plutôt que de rendre un vainqueur', () => {
    const v = evaluerConseil({ tour: 1, propositions: [], avis: [] });
    expect(v.issue).toBe('vide');
    expect(v.retenue).toBeNull();
    expect(v.danses).toEqual([]);
  });
});

describe('le signal d’arrêt', () => {
  it('inhibe une danse, et pèse plus qu’un soutien', () => {
    // Émettre un signal d'arrêt est un acte coûteux : on l'écoute davantage.
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop()],
      avis: [
        avis({ eclaireuse: 'bob', type: 'soutien', force: 5 }),
        avis({ eclaireuse: 'carol', type: 'arret', force: 5 }),
      ],
    });
    expect(POIDS_ARRET).toBeGreaterThan(1);
    expect(v.danses[0]?.intensite).toBe(0); // 5 − 5×1.5 = −2.5, borné à 0
    expect(v.danses[0]?.arrets).toEqual(['carol']);
  });

  it('UN SEUL arrêt suffit à barrer le quorum, même avec beaucoup de soutiens', () => {
    // C'est délibéré : une objection vérifiée mérite d'être levée avant
    // d'avancer, pas noyée sous le nombre. Une majorité qui écrase une
    // objection sérieuse est exactement ce qu'on veut éviter.
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop()],
      avis: [
        ...troisSoutiens(),
        avis({
          propositionId: 'P1',
          eclaireuse: 'erin',
          famille: 'codex',
          type: 'arret',
          force: 1,
        }),
      ],
    });
    expect(v.danses[0]?.soutiens).toHaveLength(3);
    expect(v.danses[0]?.quorum).toBe(false);
    expect(v.issue).toBe('sans_quorum');
  });

  it('une proposition abattue vaut ZÉRO, jamais moins que rien', () => {
    // Sinon une proposition examinée puis rejetée passerait DERRIÈRE une
    // proposition que personne n'a même regardée — alors qu'avoir été examinée
    // n'est pas pire que n'avoir intéressé personne.
    const v = evaluerConseil({
      tour: 1,
      propositions: [prop({ id: 'ABATTUE' }), prop({ id: 'IGNOREE', eclaireuse: 'zoe' })],
      avis: [
        avis({ propositionId: 'ABATTUE', eclaireuse: 'b', type: 'arret', force: 10 }),
        avis({ propositionId: 'ABATTUE', eclaireuse: 'c', type: 'arret', force: 10 }),
      ],
    });
    for (const d of v.danses) expect(d.intensite).toBeGreaterThanOrEqual(0);
  });
});

describe('le verdict', () => {
  it('DEUX propositions au quorum : le conseil REFUSE de trancher', () => {
    // Ce n'est pas une indécision de l'algorithme, c'est une information : il y
    // a deux bonnes directions. Trancher au hasard donnerait l'illusion d'une
    // décision fondée.
    const v = evaluerConseil({
      tour: 2,
      propositions: [prop({ id: 'A' }), prop({ id: 'B', eclaireuse: 'zoe' })],
      avis: [...troisSoutiens('A', 2), ...troisSoutiens('B', 2)],
    });
    expect(v.issue).toBe('depart');
    expect(v.retenue).toBeNull();
    expect(v.motif).toMatch(/humain/);
  });

  it('le classement est TOTAL : deux danses identiques s’ordonnent par id', () => {
    // Un verdict qui dépendrait de l'ordre d'insertion ne serait pas auditable.
    const faire = (ordre: string[]): string[] =>
      evaluerConseil({
        tour: 1,
        propositions: ordre.map((id) => prop({ id, eclaireuse: `auteur-${id}` })),
        avis: [],
      }).danses.map((d) => d.proposition.id);
    expect(faire(['B', 'A'])).toEqual(faire(['A', 'B']));
  });

  it('est DÉTERMINISTE : deux appels rendent exactement la même chose', () => {
    const etat: EtatConseil = {
      tour: 3,
      propositions: [prop({ id: 'A' }), prop({ id: 'B', eclaireuse: 'zoe' })],
      avis: [...troisSoutiens('A', 2), avis({ propositionId: 'B', eclaireuse: 'x', tour: 3 })],
    };
    expect(evaluerConseil(etat)).toEqual(evaluerConseil(etat));
  });

  it('n’altère jamais son entrée', () => {
    const etat: EtatConseil = {
      tour: 2,
      propositions: [prop()],
      avis: troisSoutiens('P1', 1),
    };
    const copie = structuredClone(etat);
    evaluerConseil(etat);
    expect(etat).toEqual(copie);
  });

  it('porte sa version : une archive reste lisible quand le protocole évolue', () => {
    expect(evaluerConseil({ tour: 1, propositions: [], avis: [] }).version).toBe(VERSION_CONSEIL);
  });

  it('donne toujours un motif lisible, y compris quand il continue', () => {
    for (const etat of [
      { tour: 1, propositions: [], avis: [] },
      { tour: 1, propositions: [prop()], avis: [] },
      { tour: 1, propositions: [prop()], avis: troisSoutiens() },
      { tour: TOURS_MAX, propositions: [prop()], avis: [] },
    ] as EtatConseil[]) {
      const v = evaluerConseil(etat);
      expect(v.motif.length, v.issue).toBeGreaterThan(15);
    }
  });
});

describe('les lentilles', () => {
  it('sont diverses, et DEUX sont adverses', () => {
    // Cinq agents à qui l'on pose la même question rendent cinq variantes de la
    // même réponse. Et un conseil sans lentille adverse ne produit que des
    // encouragements.
    expect(LENTILLES.length).toBeGreaterThanOrEqual(4);
    const cles = LENTILLES.map((l) => l.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(cles).toContain('faiblesse');
    expect(cles).toContain('abandon');
    expect(LENTILLES.find((l) => l.cle === 'faiblesse')?.angle).toMatch(/pas.*encourageant/i);
  });

  it('une lentille demande explicitement de chercher sur le web', () => {
    expect(LENTILLES.some((l) => /web/i.test(l.angle))).toBe(true);
  });

  it('la question par défaut porte sur la viabilité ET sur l’amélioration', () => {
    expect(QUESTION_DEFAUT).toMatch(/viable/i);
    expect(QUESTION_DEFAUT).toMatch(/changer|mieux|davantage/i);
  });
});

describe('les réglages', () => {
  it('le quorum est de trois, pas deux : deux avis concordants arrivent par hasard', () => {
    expect(QUORUM_ECLAIREUSES).toBeGreaterThanOrEqual(3);
    expect(DIVERSITE_MIN).toBeGreaterThanOrEqual(2);
    expect(DIVERSITE_MIN).toBeLessThanOrEqual(QUORUM_ECLAIREUSES);
  });
});

describe('invariants de source', () => {
  it('le module est PUR : aucune I/O, aucune horloge, aucun aléa', () => {
    // Un conseil doit être REJOUABLE à l'identique pour être auditable : « sur
    // quoi la ruche s'est-elle fondée pour recommander ça ? » doit avoir une
    // réponse dans trois ans.
    const src = readFileSync(
      fileURLToPath(new URL('../src/orchestrator/conseil.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/from '\.\/store\.js'/);
    expect(src).not.toMatch(/node:fs|node:child_process|better-sqlite3|fetch\(/);
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(/);
  });
});
