// Les plafonds de délai de la suite elle-même.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `testTimeout` et `hookTimeout` sont DEUX réglages distincts chez vitest, et
// relever le premier laisse le second à ses 10 000 ms par défaut. C'est
// exactement ce qui s'est produit : le plafond des tests avait été porté à
// 20 s après une longue analyse — documentée dans `vitest.config.ts` — et les
// hooks étaient restés à 10.
//
// L'écart est mal placé, parce que le raisonnement qui justifiait les 20 s
// décrit ce que font les HOOKS : c'est `beforeEach` qui monte un vrai serveur
// Fastify sur une vraie base SQLite, et `afterEach` qui l'arrête et efface
// l'arborescence. Les corps de test, eux, interrogent un serveur déjà prêt.
// On donnait donc le plafond large au travail léger, et le plafond serré au
// travail lourd.
//
// La facture est tombée sous Windows, sur `main` :
//
//     tests/billet-motifs.test.ts:48     beforeEach  Hook timed out in 10000ms
//     tests/tableau-endpoint.test.ts:45  afterEach   Hook timed out in 10000ms
//
// Rien ne pouvait le signaler : un réglage ABSENT n'a pas de valeur fausse à
// relire, il a juste un défaut silencieux. La garde ci-dessous exige que les
// deux soient écrits, et qu'ils ne divergent pas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = readFileSync(path.join(RACINE, 'vitest.config.ts'), 'utf8');

/** Sans les commentaires — et SANS avaler les chaînes (un glob `/**` n'est pas un commentaire). */
const nu = (s: string): string => {
  let out = '';
  let i = 0;
  let etat: 'code' | 's' | 'd' | 'ligne' | 'bloc' = 'code';
  while (i < s.length) {
    const c = s[i]!;
    const n = s[i + 1];
    if (etat === 'code') {
      if (c === '/' && n === '/') {
        etat = 'ligne';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        etat = 'bloc';
        i += 2;
        continue;
      }
      if (c === "'") {
        etat = 's';
        out += c;
        i += 1;
        continue;
      }
      if (c === '"' || c === '`') {
        etat = 'd';
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (etat === 's' || etat === 'd') {
      if (c === '\\') {
        out += c + (n ?? '');
        i += 2;
        continue;
      }
      if (etat === 's' && c === "'") etat = 'code';
      else if (etat === 'd' && (c === '"' || c === '`')) etat = 'code';
      out += c;
      i += 1;
      continue;
    }
    if (etat === 'ligne') {
      if (c === '\n') {
        etat = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (c === '*' && n === '/') {
      etat = 'code';
      i += 2;
      continue;
    }
    i += 1;
  }
  return out;
};
const CONFIG_NU = nu(CONFIG);

/** `20_000` → 20000. Le séparateur numérique de TypeScript n'est pas un chiffre. */
const valeur = (cle: string): number | null => {
  const m = new RegExp(`${cle}\\s*:\\s*([\\d_]+)`).exec(CONFIG_NU);
  return m ? Number(m[1]!.replace(/_/g, '')) : null;
};

describe('LES DEUX PLAFONDS DE DÉLAI NE DIVERGENT PAS', () => {
  it('les deux sont ÉCRITS — un réglage absent est un défaut silencieux', () => {
    // C'est le cœur du défaut : `hookTimeout` n'était pas faux, il était
    // ABSENT. Une relecture ne voit pas ce qui n'est pas écrit.
    expect(valeur('testTimeout'), 'testTimeout absent de vitest.config.ts').not.toBeNull();
    expect(
      valeur('hookTimeout'),
      'hookTimeout absent : vitest retombe à 10 000 ms pendant que les tests en ont 20 000, ' +
        'or ce sont les hooks qui montent les serveurs',
    ).not.toBeNull();
  });

  it('le hook a AU MOINS le plafond du test — c’est lui qui fait le gros du travail', () => {
    const test = valeur('testTimeout')!;
    const hook = valeur('hookTimeout')!;
    expect(
      hook,
      `hookTimeout (${hook} ms) est sous testTimeout (${test} ms) : on donne le plafond ` +
        'large à l’interrogation d’un serveur déjà prêt, et le plafond serré à sa construction',
    ).toBeGreaterThanOrEqual(test);
  });

  it('le plafond reste un plafond, pas une éternité', () => {
    // ─── CE QUE CETTE BORNE PROTÈGE ────────────────────────────────────────
    //
    // Le § 3.1 du journal raconte trois relèvements successifs qui n'ont fait
    // que déplacer la panne sur les voisins. Le discriminant du § 3.2 tient
    // toujours — un test qui ATTEND colle à son plafond, un test lent finit
    // avant — mais il ne sert que si le plafond reste assez bas pour qu'on le
    // touche dans la vie d'un run.
    //
    // Un cycle complet `createServer` → `stop` → `rmSync` a été mesuré entre
    // 70 et 200 ms sous Linux. À 20 s on tolère déjà cent fois ce coût. Au
    // delà, on ne mesure plus une lenteur, on attend un blocage.
    for (const cle of ['testTimeout', 'hookTimeout']) {
      const v = valeur(cle)!;
      expect(
        v,
        `${cle} = ${v} ms : au-delà d’une minute, ce n’est plus un plafond`,
      ).toBeLessThanOrEqual(60_000);
    }
  });
});
