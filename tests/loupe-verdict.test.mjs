// LA LOUPE, ÉPROUVÉE — parce qu'elle était elle-même un faux vert.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// `suiteRougit()` enveloppait le lancement de vitest dans un `catch` qui
// attrapait TOUT et rendait « la suite a rougi ». Il ne distinguait pas
//
//     les tests ont mordu        ← un verdict
//     les tests n'ont pas tourné ← une panne
//
// Sous Windows, `npx` est `npx.cmd` et `spawn` sans interpréteur ne sait pas le
// lancer. Chaque mutant y partait en ENOENT — trois millisecondes — était compté
// « ✔ défendue », et la loupe imprimait « LA LOUPE NE VOIT RIEN DE NU » puis
// sortait en 0, **sans avoir exécuté un seul test**.
//
// C'est le pire endroit du dépôt où placer ce défaut : la loupe est l'outil dont
// le métier ENTIER est de débusquer les faux verts, et ses verdicts sont cités
// comme preuve dans une trentaine de commentaires — « la loupe l'a montré
// équivalent », « 17 mutants, 17 morts ». Sur une machine Windows, aucune de ces
// phrases n'avait de sens.
//
// ─── POURQUOI CE FICHIER EST EN JAVASCRIPT NU ────────────────────────────────
//
// Comme `amorce.test.mjs`, et pour une raison voisine : la loupe est un outil
// autonome en `.mjs`. L'éprouver depuis du TypeScript ajouterait une couche que
// l'outil lui-même n'a pas.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { verdictDeLErreur } from '../scripts/loupe.mjs';

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');

describe('UN VERDICT N’EST RENDU QUE SI VITEST A VRAIMENT TOURNÉ', () => {
  it('rien de jeté : la suite est passée', () => {
    expect(verdictDeLErreur(null)).toEqual({ regarde: true, rouge: false });
    expect(verdictDeLErreur(undefined)).toEqual({ regarde: true, rouge: false });
  });

  it('un code de sortie NON NUL : le mutant a été tué', () => {
    // C'est le seul cas où « rouge » veut dire ce qu'on croit : vitest a
    // tourné, a compté, et a rendu un verdict.
    expect(verdictDeLErreur({ status: 1 })).toEqual({ regarde: true, rouge: true });
    expect(verdictDeLErreur({ status: 137 })).toEqual({ regarde: true, rouge: true });
  });

  it('un code de sortie NUL malgré une exception : la suite est passée', () => {
    expect(verdictDeLErreur({ status: 0 })).toEqual({ regarde: true, rouge: false });
  });

  it('ENOENT N’EST PAS UN ROUGE — c’est un « je n’ai pas pu regarder »', () => {
    // ─── L'ASSERTION QUI AURAIT SAUVÉ TOUTES LES AUTRES ────────────────────
    //
    // C'est exactement ce qui arrivait sur chaque machine Windows, à chaque
    // mutant, en trois millisecondes.
    const v = verdictDeLErreur({ code: 'ENOENT', path: 'npx' });
    expect(v.regarde, 'un binaire introuvable ne défend rien').toBe(false);
    expect(v.cause).toContain('npx');
  });

  it('un signal n’est pas un rouge non plus', () => {
    // Un `timeout` dépassé tue le processus par SIGTERM et ne pose AUCUN
    // `status`. Une machine chargée aurait donc vu ses mutants « défendus ».
    const v = verdictDeLErreur({ signal: 'SIGTERM' });
    expect(v.regarde).toBe(false);
    expect(v.cause).toContain('SIGTERM');
  });

  it('une erreur inconnue non plus — le doute ne se lit jamais comme un vert', () => {
    const v = verdictDeLErreur({ code: 'EACCES', message: 'permission refusée' });
    expect(v.regarde).toBe(false);
    expect(v.cause).toContain('EACCES');
  });
});

describe('LA LOUPE NE PASSE PLUS PAR UN SHIM', () => {
  const source = lire('../scripts/loupe.mjs');

  it('elle vise le script RÉEL de vitest, lancé par le Node courant', () => {
    // `scripts/ruche.mjs` et `src/shared/demarrage.ts` prennent déjà ce soin,
    // pour la raison exacte qui a cassé celle-ci (§ 6.2 du journal).
    expect(source).toContain("path.join('node_modules', 'vitest', 'vitest.mjs')");
    expect(source).toContain('execFileSync(process.execPath');
  });

  it('ELLE N’INVOQUE PLUS `npx`, NI AUCUN AUTRE SHIM', () => {
    // `npm`, `npx`, `tsx` : sous Windows, tous des `.cmd`. La garde vise la
    // FORME de l'appel, parce que c'est elle qui décide, pas l'intention.
    expect(source, 'un shim est revenu dans un execFileSync').not.toMatch(
      /execFileSync\(\s*['"](npx|npm|tsx)['"]/,
    );
  });

  it('L’IMPORTER NE DÉCLENCHE AUCUNE CAMPAGNE DE MUTATION', () => {
    // ─── CE FICHIER EN A FAIT LES FRAIS ────────────────────────────────────
    //
    // Sa première version importait la loupe pour éprouver une fonction pure de
    // vingt lignes. L'import a lancé une campagne complète : mutation de
    // sources, vitest, restauration. Je l'ai interrompue, et `src/tui/rendu.ts`
    // est resté MUTÉ dans l'arbre.
    //
    // C'est le § 2.8 du journal — un fichier qui s'exécute à l'import est un
    // angle mort — et le § 5.2 — une loupe interrompue laisse sa mutation —
    // dans le même geste. Le fait que ce test-ci s'exécute prouve déjà que le
    // corps ne tourne plus ; cette assertion nomme la garde pour qu'on ne la
    // retire pas par mégarde.
    expect(source, 'le corps doit être derrière une garde de point d’entrée').toContain(
      'if (MOI !== LANCE)',
    );
  });

  it('quand elle n’a pas pu regarder, elle SORT EN ERREUR', () => {
    // Le contraire — continuer en comptant « défendue » — est précisément le
    // défaut. Un outil qui n'a pas pu regarder ne dit pas « c'est défendu ».
    expect(source).toContain('LA LOUPE N’A PAS PU REGARDER');
    expect(source).toContain('process.exit(2)');
  });
});
