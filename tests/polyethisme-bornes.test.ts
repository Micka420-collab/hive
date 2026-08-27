// LE POLYÉTHISME — six gardes nues sur ce qu'une ouvrière LIT et sur ce qui
// décide du sort de sa production.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage élargi de `src/orchestrator/polyethisme.ts`, base épinglée
// `04bdaad` : **28 mutations, 28 examinées, 22 défendues, 6 NUES**.
//
// Le module décide de deux choses : la CONSIGNE qu'une ouvrière reçoit selon
// son expérience, et le SORT d'une production après contre-visite. Une garde
// nue y donne soit la mauvaise consigne à la bonne ouvrière, soit le mauvais
// motif à une décision qu'un humain relira.
//
// Les six, et ce que chacune coûte :
//
//   · `cadre.caste === 'batisseuse'` → `!==`
//     Les castes ÉCHANGENT leur consigne : une bâtisseuse reçoit le cadre de
//     l'ouvrière expérimentée (« le périmètre est indicatif »), et une
//     butineuse celui de la confirmée. Le texte reste plausible ; c'est la
//     mauvaise personne qui le lit.
//
//   · `perimetre.length > 0` → `>=`   et   `sensibles.length > 0` → `>=` (×2)
//     Un en-tête sans contenu. « PÉRIMÈTRE ANNONCÉ : » suivi de rien, ou pire,
//     « SURFACE SENSIBLE » annoncé sur une tâche qui n'en touche aucune —
//     l'avertissement le plus fort du module, crié à vide. Un avertissement
//     qui se déclenche sans motif cesse d'être lu.
//
//   · `typeof brut !== 'object' || brut === null` → `&&`
//     SONDÉE, et ce n'en est PAS une : la garde est inatteignable. Le regex
//     `HIVE_CONTRE_VISITE[ \t]+(\{.*\})` n'accepte qu'une charge entre
//     accolades, et une charge de cette forme ou bien lève dans `JSON.parse`
//     (rattrapée), ou bien rend un objet non nul. Aucune entrée n'atteint le
//     `return null` de cette ligne. Marquée dans le code, pas éprouvée ici —
//     un test qui ne peut pas rougir est du décor.
//
//   · `cv.raison || \`contre-visite : ${cv.suite}\`` → `&&`
//     Le motif RENDU à l'humain. Avec `&&`, une raison fournie est REMPLACÉE
//     par le gabarit générique — la ruche jette l'explication de la
//     contre-visiteuse et affiche « contre-visite : refaire » à la place.

import { describe, expect, it } from 'vitest';
import { consignes, promptContreVisite, trancher } from '../src/orchestrator/polyethisme.js';

/** Un chemin que `surfacesSensibles` ne retient pas. */
const BANAL = 'src/ui/bouton.ts';

describe('consignes — chaque caste reçoit LA SIENNE', () => {
  // MUTANT : `=== 'batisseuse'` → `!==`. Les deux textes s'échangent.
  //
  // Le départage se lit sur une phrase que l'une porte et l'autre pas :
  // la confirmée s'entend dire « Reste dans le périmètre annoncé », alors que
  // l'expérimentée s'entend dire que « le périmètre est indicatif ». Ce sont
  // des consignes CONTRAIRES : les confondre, c'est autoriser une sortie de
  // périmètre à qui on la refuse.
  it('une BÂTISSEUSE lit le cadre de l’ouvrière confirmée', () => {
    const texte = consignes({ caste: 'batisseuse', perimetre: [BANAL] });
    expect(texte).toContain('ouvrière confirmée');
    expect(texte).not.toContain('le périmètre est indicatif');
  });

  it('une BUTINEUSE lit le cadre de l’ouvrière expérimentée', () => {
    // Une butineuse sans surface sensible sort tôt avec une consigne vide :
    // il faut donc une surface sensible pour atteindre le bloc de caste.
    const texte = consignes({ caste: 'butineuse', perimetre: ['src/auth/session.ts'] });
    expect(texte).toContain('Le périmètre est indicatif');
    expect(texte).not.toContain('ouvrière confirmée');
  });
});

describe('consignes — un en-tête ne s’écrit pas sans son contenu', () => {
  // MUTANT : `perimetre.length > 0` → `>=`. À zéro chemin, l'en-tête sort seul.
  it('SANS périmètre, la section « PÉRIMÈTRE ANNONCÉ » n’apparaît pas', () => {
    expect(consignes({ caste: 'nourrice', perimetre: [] })).not.toContain('PÉRIMÈTRE ANNONCÉ');
  });

  it('AVEC un périmètre, elle apparaît et porte le chemin', () => {
    const texte = consignes({ caste: 'nourrice', perimetre: [BANAL] });
    expect(texte).toContain('PÉRIMÈTRE ANNONCÉ');
    expect(texte).toContain(BANAL);
  });

  // MUTANT : `sensibles.length > 0` → `>=`. L'avertissement le plus fort du
  // module, crié sur une tâche qui ne touche rien de sensible.
  it('SANS surface sensible, l’avertissement ne se déclenche pas', () => {
    expect(consignes({ caste: 'nourrice', perimetre: [BANAL] })).not.toContain('SURFACE SENSIBLE');
  });

  it('AVEC une surface sensible, il se déclenche et nomme le fichier', () => {
    const texte = consignes({ caste: 'nourrice', perimetre: ['src/auth/session.ts'] });
    expect(texte).toContain('SURFACE SENSIBLE');
    expect(texte).toContain('src/auth/session.ts');
  });
});

describe('promptContreVisite — la même borne, dans le prompt de la relectrice', () => {
  const socle = {
    titre: 'une tâche',
    diff: 'diff --git a/x b/x',
    casteAuteur: 'nourrice' as const,
    verdict: 'clean' as const,
  };

  // MUTANT : `...(sensibles.length > 0 ? [...] : [])` → `>=`.
  it('SANS chemin sensible, le bloc « SURFACE SENSIBLE » est absent', () => {
    expect(promptContreVisite({ ...socle, chemins: [BANAL] })).not.toContain('SURFACE SENSIBLE');
  });

  it('AVEC un chemin sensible, il est présent et nomme le fichier', () => {
    const texte = promptContreVisite({ ...socle, chemins: ['src/auth/session.ts'] });
    expect(texte).toContain('SURFACE SENSIBLE');
    expect(texte).toContain('src/auth/session.ts');
  });
});

describe('trancher — le motif rendu est CELUI de la contre-visiteuse', () => {
  const socle = {
    exigee: true,
    casteAuteur: 'nourrice' as const,
    casteVisiteur: 'butineuse' as const,
  };

  // MUTANT : `cv.raison || gabarit` → `&&`. Une raison fournie est REMPLACÉE
  // par le gabarit : la ruche jette l'explication et affiche « contre-visite :
  // refaire » à l'humain qui doit décider.
  it('garde la raison DONNÉE quand il y en a une', () => {
    const v = trancher({
      ...socle,
      contreVisite: { suite: 'refaire', raison: 'le test ne teste rien', mieux: 'x', force: 9 },
    });
    expect(v.motif).toBe('le test ne teste rien');
  });

  it('retombe sur le gabarit quand la raison est vide', () => {
    const v = trancher({
      ...socle,
      contreVisite: { suite: 'refaire', raison: '', mieux: 'x', force: 9 },
    });
    expect(v.motif).toBe('contre-visite : refaire');
  });
});
