// La transition des tâches DIFFÉRÉES — la survivante nº 4 du balayage, tuée.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu `ev.type === 'task_conflict_deferred'`
// SANS TEST : inverser ce `===` aurait mis TOUTES les tâches en « différées »
// sauf celles en conflit — l'écran aurait menti à chaque événement, et rien
// n'aurait rougi. La logique était enfouie dans un `useEffect` de `App.tsx` ;
// elle vit désormais dans `differees.ts`, pure, et ce fichier la tient.
//
// ─── LE CONTRAT D'IDENTITÉ N'EST PAS UN DÉTAIL ───────────────────────────────
//
// `setDeferred(prev => …)` avec LA MÊME référence est un non-geste pour React.
// Un jeu recréé à chaque événement re-rendrait l'écran au rythme du flux — des
// dizaines d'événements par seconde en plein essaim. Les tests d'identité
// (`toBe`, pas `toEqual`) gardent cette promesse-là : elle est invisible à
// l'œil et coûteuse à perdre.

import { describe, expect, it } from 'vitest';
import { EVENEMENTS_QUI_LIBERENT, transitionDifferees } from '../dashboard/src/differees.js';

describe('la transition des différées', () => {
  it('UN CONFLIT AJOUTE LA TÂCHE — et n’écrase pas les autres', () => {
    const apres = transitionDifferees(new Set(['t1']), 'task_conflict_deferred', 't2');
    expect([...apres].sort()).toEqual(['t1', 't2']);
  });

  it('CHACUN DES CINQ ÉVÉNEMENTS LIBÉRATEURS RETIRE LA TÂCHE', () => {
    // Les cinq, pas un échantillon : retirer un membre de la liste doit
    // rougir ICI, nommément.
    expect(EVENEMENTS_QUI_LIBERENT).toEqual([
      'task_assigned',
      'task_done',
      'task_failed',
      'task_cancelled',
      'task_requeued',
    ]);
    for (const ev of EVENEMENTS_QUI_LIBERENT) {
      const apres = transitionDifferees(new Set(['t1', 't2']), ev, 't1');
      expect([...apres], `« ${ev} » n’a pas libéré la tâche`).toEqual(['t2']);
    }
  });

  it('UN ÉVÉNEMENT ÉTRANGER REND prev LUI-MÊME — la référence, pas une copie', () => {
    // `task_progress` arrive des dizaines de fois par seconde en plein
    // essaim : une copie ici et l'écran se re-rend au rythme du flux.
    const prev = new Set(['t1']);
    expect(transitionDifferees(prev, 'task_progress', 't1')).toBe(prev);
    expect(transitionDifferees(prev, 'task_created', 't9')).toBe(prev);
  });

  it('LIBÉRER UNE TÂCHE ABSENTE REND AUSSI prev LUI-MÊME', () => {
    // Le cas de loin le plus fréquent : presque aucune tâche n'est différée,
    // et chaque fin de tâche passe par ici. Sans cette identité, chaque
    // `task_done` de la ruche re-rendrait l'écran.
    const prev = new Set(['t1']);
    expect(transitionDifferees(prev, 'task_done', 'tâche-jamais-différée')).toBe(prev);
  });

  it('la transition ne MUTE jamais son entrée', () => {
    // `prev` appartient à React : le muter en place fausserait la comparaison
    // de rendu suivante. Les deux chemins qui écrivent passent par une copie.
    const prev = new Set(['t1']);
    transitionDifferees(prev, 'task_conflict_deferred', 't2');
    transitionDifferees(prev, 'task_done', 't1');
    expect([...prev]).toEqual(['t1']);
  });

  it('conflit puis libération : aller-retour complet', () => {
    const a = transitionDifferees(new Set(), 'task_conflict_deferred', 't1');
    const b = transitionDifferees(a, 'task_assigned', 't1');
    expect(b.size).toBe(0);
  });
});
