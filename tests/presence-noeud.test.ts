// « Présence sans production » — la règle pure, et les deux gardes.
//
// Un poste sans agent réel rejoignait la ruche en mourant : `process.exit(2)`.
// Il la rejoint maintenant pour de bon, mais SANS produire. Ces bancs tiennent
// la seule chose qui rend ce changement acceptable — qu'un nœud présent ne
// travaille jamais, et qu'il DISE pourquoi.

import { describe, expect, it } from 'vitest';
import {
  entreeEnRuche,
  motifRefusPresence,
  refuseParPresence,
} from '../src/shared/presence-noeud.js';

describe('le mode d’entrée dans la ruche', () => {
  it('UN AGENT RÉEL ⇒ production, sans motif à afficher', () => {
    const e = entreeEnRuche({ agentReel: true, simulationVoulue: false });
    expect(e.mode).toBe('production');
    // Pas de motif : un nœud qui travaille n'a rien à expliquer.
    expect(e.motif).toBeNull();
  });

  it('AUCUN AGENT RÉEL ⇒ présence, ET la raison est DITE', () => {
    const e = entreeEnRuche({ agentReel: false, simulationVoulue: false });
    expect(e.mode).toBe('presence');
    expect(e.motif).not.toBeNull();
    // Les deux moitiés de la phrase : qu'il est là, et qu'il ne travaillera pas.
    expect(e.motif).toContain('rejoint la ruche');
    expect(e.motif).toContain('aucune tâche');
  });

  it('LA SIMULATION VOULUE L’EMPORTE — refuser une démo casserait la démo', () => {
    // `HIVE_SIMULATION=1` / `HIVE_AGENT=shell` : quelqu'un qui pose ça sait ce
    // qu'il fait et attend une ruche qui BOUGE. Sans cette priorité, ce lot
    // aurait éteint toutes les démonstrations du dépôt.
    const e = entreeEnRuche({ agentReel: false, simulationVoulue: true });
    expect(e.mode).toBe('production');
    expect(e.motif).toBeNull();
  });

  it('les quatre combinaisons, énumérées — aucune n’est laissée au hasard', () => {
    const attendu: [boolean, boolean, string][] = [
      [true, true, 'production'],
      [true, false, 'production'],
      [false, true, 'production'],
      [false, false, 'presence'],
    ];
    for (const [agentReel, simulationVoulue, mode] of attendu) {
      expect(
        entreeEnRuche({ agentReel, simulationVoulue }).mode,
        `agentReel=${String(agentReel)} simulationVoulue=${String(simulationVoulue)}`,
      ).toBe(mode);
    }
  });

  it('le motif existe dans LES DEUX langues, et ne se recopie pas d’une à l’autre', () => {
    const fr = entreeEnRuche({ agentReel: false, simulationVoulue: false }, 'fr').motif;
    const en = entreeEnRuche({ agentReel: false, simulationVoulue: false }, 'en').motif;
    expect(fr).not.toBeNull();
    expect(en).not.toBeNull();
    expect(en).not.toBe(fr);
    expect(en).toContain('joined the hive');
  });
});

describe('la seconde garde — le nœud refuse, même si le hub insiste', () => {
  it('un nœud en PRÉSENCE refuse ; un nœud en PRODUCTION accepte', () => {
    expect(refuseParPresence('presence')).toBe(true);
    expect(refuseParPresence('production')).toBe(false);
  });

  it('le refus porte un motif LISIBLE, dans les deux langues', () => {
    // Il remonte dans la chronique : « tâche refusée » sans raison ressemble à
    // une panne, et on cherche une panne qui n'existe pas.
    expect(motifRefusPresence('fr')).toContain('aucun agent de codage réel');
    expect(motifRefusPresence('en')).toContain('no real coding agent');
    expect(motifRefusPresence('fr')).not.toBe(motifRefusPresence('en'));
  });
});
