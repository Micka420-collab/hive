// LA SORTIE EN DIRECT, BORNÉE ET CADENCÉE — ce que l'adaptateur laisse partir.
//
// Deux bornes (4 Kio par morceau, un morceau par 250 ms donc ≤ 4 par seconde),
// une promesse (une ligne n'est jamais coupée entre deux morceaux), et un aveu
// (ce qui est omis est compté et annoncé). Horloge simulée : le banc pilote le
// temps, il ne l'attend pas.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
import type { AdapterProgress } from '../src/adapters/index.js';
import {
  createSortieDirecte,
  SORTIE_INTERVALLE_MS,
  SORTIE_MORCEAU_MAX_OCTETS,
  type HorlogeSortie,
} from '../src/adapters/sortie-directe.js';
import { MARQUE_LIGNE_TRONQUEE } from '../src/shared/caviardage.js';

/** Horloge manuelle : `avancer` déclenche les minuteurs échus, dans l'ordre. */
function horlogeManuelle() {
  let maintenant = 1_000_000;
  let minuteurs: Array<{ echeance: number; fn: () => void }> = [];
  const horloge: HorlogeSortie = {
    maintenant: () => maintenant,
    planifier: (fn, ms) => {
      const m = { echeance: maintenant + ms, fn };
      minuteurs.push(m);
      return () => {
        minuteurs = minuteurs.filter((x) => x !== m);
      };
    },
  };
  const avancer = (ms: number): void => {
    const fin = maintenant + ms;
    for (;;) {
      const prochain = minuteurs
        .filter((m) => m.echeance <= fin)
        .sort((a, b) => a.echeance - b.echeance)[0];
      if (!prochain) break;
      minuteurs = minuteurs.filter((m) => m !== prochain);
      maintenant = prochain.echeance;
      prochain.fn();
    }
    maintenant = fin;
  };
  return { horloge, avancer, instant: () => maintenant };
}

const octets = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('createSortieDirecte — bornes et cadence', () => {
  it('COALESCE une rafale : jamais plus d’un morceau par 250 ms, jamais plus de 4 Kio', () => {
    const { horloge, avancer, instant } = horlogeManuelle();
    const departs: Array<{ t: number; morceau: string }> = [];
    const sortie = createSortieDirecte(
      (morceau) => departs.push({ t: instant(), morceau }),
      horloge,
    );

    // 2 secondes à 1 000 lignes par seconde : ~60 Kio/s, bien au-delà des
    // 16 Kio/s que la cadence laisse passer.
    for (let i = 0; i < 2_000; i += 1) {
      sortie.ecrire(`ligne ${i} ${'x'.repeat(50)}\n`);
      avancer(1);
    }
    avancer(1_000);
    sortie.terminer();

    expect(departs.length).toBeGreaterThan(5);
    for (const d of departs)
      expect(octets(d.morceau)).toBeLessThanOrEqual(SORTIE_MORCEAU_MAX_OCTETS);
    for (let i = 1; i < departs.length; i += 1) {
      expect(departs[i]!.t - departs[i - 1]!.t).toBeGreaterThanOrEqual(SORTIE_INTERVALLE_MS);
    }
    // Sur n'importe quelle seconde glissante : au plus 4 morceaux.
    for (const d of departs) {
      expect(departs.filter((x) => x.t >= d.t && x.t < d.t + 1_000).length).toBeLessThanOrEqual(4);
    }
    // Le surplus n'est pas retenu en silence : il est annoncé.
    expect(departs.some((d) => /^\[… \d+ octets omis\]\n/.test(d.morceau))).toBe(true);
  });

  it('le premier morceau part sans attendre, une ligne entière à la fois', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    sortie.ecrire('début de lig');
    avancer(0);
    expect(departs).toEqual([]);
    sortie.ecrire('ne\nsuite');
    avancer(0);
    expect(departs).toEqual(['début de ligne\n']);
    sortie.terminer();
    expect(departs).toEqual(['début de ligne\n']);
    avancer(SORTIE_INTERVALLE_MS);
  });

  it('une ligne trop longue est TRONQUÉE et marquée, jamais coupée entre deux morceaux', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    const longue = 'é'.repeat(10_000); // 20 000 octets, caractères de 2 octets
    sortie.ecrire(`${longue}\n`);
    avancer(0);
    sortie.ecrire('courte\n');
    avancer(SORTIE_INTERVALLE_MS * 3);
    sortie.terminer();

    const tout = departs.join('');
    expect(tout).toContain(MARQUE_LIGNE_TRONQUEE);
    expect(tout).not.toContain('�');
    expect(tout).toContain('courte\n');
    for (const m of departs) expect(octets(m)).toBeLessThanOrEqual(SORTIE_MORCEAU_MAX_OCTETS);
  });

  it('une ligne sans fin (barre de progression) ne grossit pas sans borne', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    for (let i = 0; i < 1_000; i += 1) sortie.ecrire('\r[#####     ] 50 %');
    sortie.ecrire(' fin\n');
    avancer(SORTIE_INTERVALLE_MS);
    sortie.ecrire('ligne suivante\n');
    avancer(SORTIE_INTERVALLE_MS * 4);
    sortie.terminer();

    const tout = departs.join('');
    expect(tout).toContain(MARQUE_LIGNE_TRONQUEE);
    // La suite de la ligne tronquée est comptée, pas recollée comme une ligne neuve.
    expect(tout).not.toMatch(/^ fin$/m);
    expect(tout).toMatch(/octets omis/);
    expect(tout).toContain('ligne suivante\n');
  });

  it('terminer() vide ce qui attend quand la cadence le permet, et plus rien ensuite', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    sortie.ecrire('a\n');
    avancer(0);
    avancer(SORTIE_INTERVALLE_MS);
    sortie.ecrire('dernière ligne sans retour');
    sortie.terminer();
    sortie.ecrire('après la fin\n');
    avancer(SORTIE_INTERVALLE_MS * 2);
    expect(departs).toEqual(['a\n', 'dernière ligne sans retour\n']);
  });
});

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')(
  'runCommand — tout agent réel diffuse sa sortie',
  () => {
    it('la sortie standard arrive EN DIRECT par onProgress({ sortie }), avant la fin', async () => {
      const dossier = mkdtempSync(path.join(tmpdir(), 'hive-sortie-directe-'));
      aNettoyer.push(dossier);
      const bin = path.join(dossier, 'agent');
      writeFileSync(
        bin,
        "#!/usr/bin/env node\n'use strict';\n" +
          "process.stdout.write('premier pas\\n');\n" +
          "process.stderr.write('bruit de diagnostic\\n');\n" +
          "setTimeout(() => process.stdout.write('second pas\\n'), 400);\n",
      );
      chmodSync(bin, 0o755);
      const progres: Array<{ t: number; p: AdapterProgress }> = [];
      const debut = Date.now();

      const r = await runCommand(bin, [], {
        cwd: dossier,
        env: { PATH: process.env.PATH ?? '' },
        attempt: 1,
        signal: new AbortController().signal,
        onProgress: (p) => progres.push({ t: Date.now() - debut, p }),
      });
      const fin = Date.now() - debut;

      expect(r.success).toBe(true);
      const sorties = progres.filter((x) => x.p.sortie !== undefined);
      expect(sorties.map((x) => x.p.sortie).join('')).toBe('premier pas\nsecond pas\n');
      // Le premier morceau est parti bien avant la fin du processus.
      expect(sorties[0]!.t).toBeLessThan(fin - 200);
    });
  },
);
