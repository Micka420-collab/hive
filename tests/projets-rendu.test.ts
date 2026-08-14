// CE QUE L'ÉCRAN DES PROJETS DIT — et pourquoi chacune de ces phrases compte.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// Un balayage échantillonné sur `dashboard/src/views` (base épinglée `f0fc005`,
// 454 candidates, 42 examinées) a rendu CINQ survivants dans `Projets.tsx` —
// plus que dans n'importe quelle autre vue. Le fichier fait 1 600 lignes et
// n'exportait aucune de ses décisions : elles vivaient dans du JSX, donc hors
// d'atteinte de tout banc qui ne monte pas la vue entière.
//
// Trois étaient de vraies décisions. Les voici, sorties et éprouvées.

import { describe, expect, it } from 'vitest';
import {
  nomDeLivraison,
  suffixeEnVol,
  verdictDesTests,
} from '../dashboard/src/views/projets-rendu.js';

const fr = (f: string) => f;
const en = (_f: string, e: string) => e;

describe('verdictDesTests — cinq issues, et le mutant le plus grave ment sur du rouge', () => {
  it('LE CAS QUI TRANCHE : tests ROUGES ne doit jamais s’annoncer vert', () => {
    // `testsPassed === true` muté en `!==` fait afficher « ✔ tests verts » sur
    // une suite rouge. Ce message est lu pour décider de FUSIONNER.
    const rouge = { preparedOk: true, testsRun: true, testsPassed: false };
    expect(verdictDesTests(rouge, fr)).toBe('✘ tests rouges');
    expect(verdictDesTests(rouge, en)).toBe('✘ tests red');
  });

  it('tests VERTS le disent, dans les deux langues', () => {
    const vert = { preparedOk: true, testsRun: true, testsPassed: true };
    expect(verdictDesTests(vert, fr)).toBe('✔ tests verts');
    expect(verdictDesTests(vert, en)).toBe('✔ tests green');
  });

  it('UN ENVIRONNEMENT EN ÉCHEC N’EST PAS UN TEST ROUGE — et il dit pourquoi', () => {
    // Sans cette distinction, on part chercher une régression dans du code qui
    // va très bien. C'est la raison d'être de la première branche.
    const casse = { preparedOk: false, testsRun: false };
    expect(verdictDesTests(casse, fr)).toBe('environnement non préparé — tests non lancés');
    expect(verdictDesTests(casse, fr)).not.toBe('tests non lancés');
  });

  it('l’environnement prime même si les tests ont tourné et sont rouges', () => {
    // L'ordre des branches est une décision : préparation cassée d'abord.
    expect(
      verdictDesTests({ preparedOk: false, testsRun: true, testsPassed: false }, fr),
    ).toContain('environnement');
  });

  it('TROIS ÉTATS, pas deux : `null` n’est pas `false`', () => {
    // Le protocole type `preparedOk` en `boolean | null | undefined`. `null` et
    // `undefined` veulent dire « on n'en sait rien » — un merge d'avant ce
    // champ, un lanceur muet. Les traiter comme un échec accuserait
    // l'environnement sans preuve. La comparaison STRICTE à `false` est la garde.
    expect(verdictDesTests({ preparedOk: null, testsRun: true, testsPassed: true }, fr)).toBe(
      '✔ tests verts',
    );
    expect(verdictDesTests({ testsRun: true, testsPassed: true }, fr)).toBe('✔ tests verts');
  });

  it('SANS VERDICT n’est pas ROUGE — une panne d’outillage n’accuse pas le code', () => {
    expect(verdictDesTests({ preparedOk: true, testsRun: true }, fr)).toBe('tests sans verdict');
    expect(verdictDesTests({ preparedOk: true, testsRun: true, testsPassed: null }, fr)).toBe(
      'tests sans verdict',
    );
  });

  it('tests NON LANCÉS, environnement sain : on le dit sans inventer de cause', () => {
    expect(verdictDesTests({ preparedOk: true, testsRun: false }, fr)).toBe('tests non lancés');
  });
});

describe('nomDeLivraison — une ligne muette est pire qu’un identifiant laid', () => {
  it('LE CAS QUI TRANCHE : sans titre, l’identifiant de tâche prend le relais', () => {
    // Le mutant `||` → `&&` rend une chaîne VIDE : la ligne existe, elle est
    // stylée, et on voit une livraison sans savoir laquelle.
    expect(nomDeLivraison({ taskId: 't-42' })).toBe('t-42');
    expect(nomDeLivraison({ titre: '', taskId: 't-42' })).toBe('t-42');
  });

  it('avec un titre, c’est le titre — l’identifiant reste caché', () => {
    expect(nomDeLivraison({ titre: 'Fermer la faille du jeton', taskId: 't-42' })).toBe(
      'Fermer la faille du jeton',
    );
  });
});

describe('suffixeEnVol — ne pas annoncer une activité qui n’existe plus', () => {
  it('LE CAS QUI TRANCHE : zéro en vol ⇒ AUCUN suffixe', () => {
    // Le mutant `&&` → `||` affiche « · 0 en vol » sur une session terminée.
    expect(suffixeEnVol(0, fr)).toBe('');
  });

  it('des tâches en vol le disent, dans les deux langues', () => {
    expect(suffixeEnVol(3, fr)).toBe(' · 3 en vol');
    expect(suffixeEnVol(3, en)).toBe(' · 3 in flight');
  });

  it('une seule en vol compte aussi — la borne est à zéro, pas à un', () => {
    expect(suffixeEnVol(1, fr)).toBe(' · 1 en vol');
  });
});
