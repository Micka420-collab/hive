// LA SORTIE EN DIRECT, BORNÉE ET CADENCÉE — ce que l'adaptateur laisse partir.
//
// Deux bornes (4 Kio par morceau, un morceau par 250 ms donc ≤ 4 par seconde),
// une promesse (une ligne n'est jamais coupée entre deux morceaux), et un aveu
// (ce qui est omis est compté et annoncé). Horloge simulée : le banc pilote le
// temps, il ne l'attend pas.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
import {
  cadenceDe,
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

describe('createSortieDirecte — deux flux, une cadence par tâche, des omissions sobres', () => {
  it('stdout et stderr gardent chacun leur ligne en cours : aucun collage à mi-ligne', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    sortie.ecrire('début stdout', 'stdout');
    sortie.ecrire('ligne stderr\n', 'stderr');
    sortie.ecrire(' fin stdout\n', 'stdout');
    avancer(SORTIE_INTERVALLE_MS * 2);
    sortie.terminer();
    expect(departs.join('').split('\n').filter(Boolean).sort()).toEqual([
      'début stdout fin stdout',
      'ligne stderr',
    ]);
  });

  it('la cadence est celle de la TÂCHE : un second processus attend le tour du premier', () => {
    const { horloge, avancer, instant } = horlogeManuelle();
    const departs: number[] = [];
    const tache = {};
    const premier = createSortieDirecte(() => departs.push(instant()), horloge, cadenceDe(tache));
    premier.ecrire('a\n');
    avancer(0);
    premier.terminer();
    // Relance immédiate de l'agent par l'adaptateur : nouveau `spawn`, même tâche.
    const second = createSortieDirecte(() => departs.push(instant()), horloge, cadenceDe(tache));
    second.ecrire('b\n');
    avancer(SORTIE_INTERVALLE_MS * 2);
    second.terminer();
    expect(departs).toHaveLength(2);
    expect(departs[1]! - departs[0]!).toBeGreaterThanOrEqual(SORTIE_INTERVALLE_MS);
  });

  it('une barre de progression qui tourne n’émet pas d’omission à chaque tour', () => {
    const { horloge, avancer } = horlogeManuelle();
    const departs: string[] = [];
    const sortie = createSortieDirecte((m) => departs.push(m), horloge);
    // Deux secondes de `\r` sans retour à la ligne, bien au-delà d'un morceau.
    for (let i = 0; i < 2_000; i += 1) {
      sortie.ecrire('\r[#####     ] 50 %');
      avancer(1);
    }
    sortie.ecrire(' fin\n');
    avancer(SORTIE_INTERVALLE_MS * 2);
    sortie.terminer();
    const omissionsSeules = departs.filter((m) => /^\[… \d+ octets omis\]\n$/.test(m));
    expect(omissionsSeules.length).toBeLessThanOrEqual(1);
    expect(departs.join('')).toMatch(/octets omis/);
  });
});

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Un vrai processus, lancé par `process.execPath` (pas de shebang ni de chmod) :
// le même banc passe sur les trois OS de la CI, là où `shared/agent-windows.ts`
// résout les binaires. Aucune fenêtre de temps : le faux agent ATTEND un
// fichier témoin que le banc ne pose qu'après avoir VU sa sortie en direct —
// si elle n'arrivait qu'à la fin, il ne finirait jamais (délai dur de 10 s).
describe('runCommand — tout agent réel diffuse sa sortie, stdout ET stderr', () => {
  it('le progrès écrit sur STDERR (forme de `codex exec`) arrive avant la fin', async () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'hive-sortie-directe-'));
    aNettoyer.push(dossier);
    const temoin = path.join(dossier, 'vu');
    const script = path.join(dossier, 'agent.js');
    writeFileSync(
      script,
      "'use strict';\nconst fs = require('node:fs');\n" +
        "process.stdout.write('premier pas\\n');\n" +
        // Codex : commandes et raisonnement sur stderr, le message final seul sur stdout.
        "process.stderr.write('exec: npm test\\n');\n" +
        `const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(temoin)})) {\n` +
        "  clearInterval(t); process.stdout.write('message final\\n');\n" +
        // Vivant au-delà d'un intervalle : le dernier morceau part avant la fin.
        '  setTimeout(() => {}, 2 * 250); } }, 20);\n',
    );
    const sorties: string[] = [];

    const r = await runCommand(
      process.execPath,
      [script],
      {
        cwd: dossier,
        env: { ...process.env },
        attempt: 1,
        signal: new AbortController().signal,
        onProgress: (p) => {
          if (p.sortie === undefined) return;
          sorties.push(p.sortie);
          if (sorties.join('').includes('exec: npm test')) writeFileSync(temoin, '');
        },
      },
      10_000,
    );

    expect(r.success).toBe(true);
    const vu = sorties.join('');
    expect(vu).toContain('premier pas\n');
    expect(vu).toContain('exec: npm test\n');
    expect(vu).toContain('message final\n');
  });
});
