// Les paliers.
//
// Deux garanties à verrouiller, et elles tirent en sens contraire :
//
//   · FERMÉ PAR DÉFAUT — aucun plan n'ouvre une capacité d'équipe qu'il n'a
//     pas explicitement, et un plan inconnu n'ouvre RIEN ;
//   · JAMAIS BRIDÉ — Community garde des sièges illimités, parce que le cœur
//     ne se dégrade pas pour vendre un palier (docs/MODELE-ECONOMIQUE.md).
//
// Le test le plus important est le dernier : chaque capacité déclarée doit
// être portée par au moins un palier payant, sinon la liste blanche contient
// une promesse que personne ne peut acheter.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAPACITES_EQUIPE,
  SIEGES_INCLUS_CLOUD,
  capaciteOuverte,
  palierDuPlan,
} from '../src/shared/paliers.js';
import { PLANS } from '../src/orchestrator/abonnement.js';

describe('paliers — jamais bridé', () => {
  it('Community (libre) a des sièges ILLIMITÉS', () => {
    // Une ruche auto-hébergée invite qui elle veut. Le jour où ce test casse,
    // quelqu'un a bridé le cœur pour vendre Team — c'est exactement ce que le
    // modèle interdit.
    expect(palierDuPlan('libre').siegesMax).toBeNull();
  });

  it('aucun palier ne RETIRE quoi que ce soit : les capacités sont additives', () => {
    // Enterprise contient tout Team ; passer au palier supérieur n'enlève rien.
    const team = palierDuPlan('team').capacites;
    const enterprise = palierDuPlan('enterprise').capacites;
    for (const c of team) expect(enterprise, `Enterprise a perdu « ${c} »`).toContain(c);
  });
});

describe('paliers — fermé par défaut', () => {
  it('un plan inconnu n’ouvre RIEN, pas même les sièges Cloud', () => {
    const p = palierDuPlan('plan-invente');
    expect(p.capacites).toHaveLength(0);
    expect(p.siegesMax).toBe(0);
  });

  it('les plans Cloud individuels n’ouvrent aucune capacité d’équipe', () => {
    for (const cle of ['queen', 'eclaireuse', 'essaim', 'colonie']) {
      expect(palierDuPlan(cle).capacites, cle).toHaveLength(0);
      expect(palierDuPlan(cle).siegesMax, cle).toBe(SIEGES_INCLUS_CLOUD);
    }
  });

  it('le SSO est réservé à Enterprise — pas à Team', () => {
    expect(capaciteOuverte('enterprise', 'sso').ouverte).toBe(true);
    expect(capaciteOuverte('team', 'sso').ouverte).toBe(false);
    expect(capaciteOuverte('libre', 'sso').ouverte).toBe(false);
  });

  it('un refus dit POURQUOI, sans jargon', () => {
    const v = capaciteOuverte('queen', 'roles_fins');
    expect(v.ouverte).toBe(false);
    expect(v.motif).toMatch(/Team ou Enterprise/);
    expect(v.motif).toContain('queen');
  });
});

describe('paliers — cohérence avec les plans', () => {
  it('Team ouvre les fonctions d’équipe et l’illimité en sièges', () => {
    const p = palierDuPlan('team');
    expect(p.siegesMax).toBeNull();
    for (const c of ['roles_fins', 'quotas_par_membre', 'projets_organisation'] as const) {
      expect(capaciteOuverte('team', c).ouverte, c).toBe(true);
    }
  });

  it('chaque capacité déclarée est portée par au moins un palier payant', () => {
    // Une liste blanche qui contient une capacité que personne n'ouvre est
    // une promesse que personne ne peut acheter.
    for (const c of CAPACITES_EQUIPE) {
      const portee = PLANS.some((p) => palierDuPlan(p.cle).capacites.includes(c));
      expect(portee, `« ${c} » n'est portée par aucun plan`).toBe(true);
    }
  });

  it('chaque plan déclaré a un palier DÉLIBÉRÉ, pas le défaut fermé', () => {
    // Le défaut (siegesMax: 0) est réservé aux plans inconnus. Un plan de la
    // grille qui y tombe a été ajouté à PLANS sans passer par ici.
    for (const p of PLANS) {
      expect(palierDuPlan(p.cle).siegesMax, `plan « ${p.cle} » oublié dans paliers.ts`).not.toBe(0);
    }
  });

  it('le SSO non implémenté est dit noir sur blanc dans le module', () => {
    // La porte existe, l'implémentation SAML/OIDC non. Tant que c'est vrai,
    // ça doit être écrit — une porte qui ment est pire qu'une porte absente.
    const source = readFileSync(new URL('../src/shared/paliers.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/TODO\(sso\)/);
  });
});
