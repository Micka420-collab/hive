// LE PLAFOND DE PROCESSUS — un instrument qui refuse plutôt que de deviner.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// `HIVE_VITEST_FORKS` existe pour rendre MESURABLE l'hypothèse de la
// sur-souscription (§ 9 terseptuagies) : rejouer le même arbre avec et sans
// plafond, et comparer des temps plutôt que des intuitions.
//
// Un instrument de mesure a une exigence que le code ordinaire n'a pas : il
// doit être INCAPABLE de mentir sur ce qu'il a mesuré. Une valeur illisible qui
// retomberait en silence sur le défaut ferait croire à une expérience « avec
// plafond » qui n'en avait aucun — et la conclusion « le plafond ne change
// rien » serait tirée d'une mesure qui ne l'a jamais appliqué.
//
// C'est pourquoi le cas central de ce banc n'est pas le chemin heureux : c'est
// le REFUS.

import { describe, expect, it } from 'vitest';
import { reglageDesForks } from '../scripts/vitest-forks.mjs';

describe('rien de demandé ⇒ vitest décide, et on ne fige pas son défaut', () => {
  it('absent, vide ou blanc rendent `null` — PAS un objet « équivalent au défaut »', () => {
    // Le défaut de vitest dépend de la machine. Le recopier ici le rendrait
    // faux ailleurs, et l'absence de réglage est justement le témoin auquel on
    // veut comparer le plafond.
    expect(reglageDesForks(undefined)).toBeNull();
    expect(reglageDesForks('')).toBeNull();
    expect(reglageDesForks('   ')).toBeNull();
  });
});

describe('un plafond demandé est appliqué, plancher compris', () => {
  it('le plafond arrive AVEC un plancher à 1', () => {
    // Sans `minForks`, le plancher par défaut de vitest peut DÉPASSER le
    // plafond qu'on vient de poser : la configuration serait contradictoire et
    // c'est le plancher qui gagnerait — un plafond qui ne plafonne pas.
    expect(reglageDesForks('2')).toEqual({
      pool: 'forks',
      poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    });
  });

  it('les espaces autour du nombre ne gênent pas', () => {
    expect(reglageDesForks('  3  ')).toEqual({
      pool: 'forks',
      poolOptions: { forks: { maxForks: 3, minForks: 1 } },
    });
  });

  it('un seul processus est un réglage LÉGITIME — c’est le témoin le plus dur', () => {
    expect(reglageDesForks('1')?.poolOptions.forks.maxForks).toBe(1);
  });
});

describe('LE CŒUR DU BANC : un instrument cassé refuse, il ne devine pas', () => {
  it('une valeur illisible fait ÉCHOUER le démarrage, elle ne retombe pas au défaut', () => {
    // Si ceci rendait `null`, on mesurerait sans plafond en croyant en avoir un.
    expect(() => reglageDesForks('abc')).toThrow(/n'est pas un nombre/);
  });

  it('une lecture PARTIELLE est refusée aussi — `parseInt` aurait lu 12', () => {
    // `Number('12abc')` rend NaN, mais `parseInt('12abc')` rend 12. Retenir 12
    // serait appliquer un plafond que personne n'a écrit.
    expect(() => reglageDesForks('12abc')).toThrow();
  });

  it('zéro et négatif sont refusés : « aucun processus » n’est pas une mesure', () => {
    expect(() => reglageDesForks('0')).toThrow();
    expect(() => reglageDesForks('-2')).toThrow();
  });

  it('le refus DIT la valeur reçue et ce qui était attendu', () => {
    // Un refus qui ne nomme pas la valeur fautive oblige à deviner où elle a
    // été posée — variable d'environnement, entrée de workflow, script local.
    expect(() => reglageDesForks('deux')).toThrow(/deux/);
    expect(() => reglageDesForks('deux')).toThrow(/entier ≥ 1/);
  });
});
