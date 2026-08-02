// CHAQUE VUE DU TABLEAU DE BORD A SA LIGNE DANS LES DEUX DOCUMENTS.
//
// ─── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ───────────────────────────────────────
//
// « Les Chantiers », l'écran livré au lot 14 et marqué ✅ dans le carnet des
// étapes, n'apparaissait dans AUCUN des deux tableaux de vues. Les deux
// annonçaient même « touches 1-9, 0 » alors que le dashboard en expose treize
// — les trois dernières sur `h`, `i` et `c`.
//
// Le README renvoie à ces documents pour « chaque partie en détail », et
// `docs/ETAPES.md` se félicitait, dans la même phrase : « Et il a un écran :
// Les Chantiers (touche h) […] Un mécanisme sans écran n'existe pas. »
//
// L'écran existait. Sa mention n'existait pas. Une fonctionnalité qu'on ne
// trouve pas dans la documentation est, pour qui découvre le projet, une
// fonctionnalité qui n'existe pas.
//
// ─── POURQUOI LA GARDE LIT LE CODE ET NON UNE LISTE ──────────────────────────
//
// La source de vérité est `dashboard/src/App.tsx` : c'est elle qui décide de ce
// que le clavier ouvre. Recopier les treize vues ici ferait une TROISIÈME liste
// à tenir à jour, qui dériverait à son tour — et cette garde-là existerait pour
// se vérifier elle-même.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const APP = readFileSync(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8');

interface Vue {
  readonly id: string;
  readonly label: string;
  readonly labelEn: string;
  readonly key: string;
}

/**
 * Les vues déclarées par le tableau de bord, LUES DANS SA SOURCE.
 *
 * Le littéral s'écrit sur une ligne pour les dix premières et sur plusieurs
 * pour celles qui portent une condition d'affichage : on lit donc les champs
 * un par un plutôt que ligne par ligne.
 */
function vues(): Vue[] {
  const out: Vue[] = [];
  for (const bloc of APP.matchAll(/\{\s*id:\s*'([a-z]+)',[\s\S]{0,400}?key:\s*'([^']+)'/g)) {
    const corps = bloc[0];
    const label = /label:\s*'((?:[^'\\]|\\.)*)'/.exec(corps)?.[1];
    const labelEn = /labelEn:\s*'((?:[^'\\]|\\.)*)'/.exec(corps)?.[1];
    if (label === undefined || labelEn === undefined) continue;
    out.push({ id: bloc[1]!, label, labelEn, key: bloc[2]! });
  }
  return out;
}

describe('LES DEUX DOCUMENTS LISTENT TOUTES LES VUES', () => {
  it('il y a bien des vues à confronter — sinon la garde est creuse', () => {
    // Sans cette borne, un changement de forme dans `App.tsx` ferait tourner la
    // boucle à vide et rendrait un vert parfaitement creux.
    expect(vues().length, 'aucune vue lue dans App.tsx').toBeGreaterThan(10);
  });

  for (const [chemin, champ] of [
    ['../docs/FONCTIONNALITES.md', 'label'],
    ['../docs/FEATURES.en.md', 'labelEn'],
  ] as const) {
    const doc = readFileSync(new URL(chemin, import.meta.url), 'utf8');
    const nom = chemin.replace('../', '');

    it(`${nom} : chaque vue a sa ligne`, () => {
      // On cherche le libellé DANS un passage en gras, pas une égalité stricte :
      // le document anglais écrit « **The Comb** » là où l'application dit
      // « Comb ». L'article est de la prose légitime, et une garde qui rougit
      // dessus se fait désarmer plutôt que corriger. Le gras reste exigé — il
      // ancre la trouvaille à une cellule de tableau et non à une phrase.
      const manquantes = vues()
        .map((v) => v[champ])
        .filter(
          (libelle) =>
            !new RegExp(
              `\\*\\*[^*]*${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^*]*\\*\\*`,
            ).test(doc),
        );
      expect(
        manquantes,
        'vue(s) livrée(s) et absente(s) du document que le README présente comme la liste complète',
      ).toEqual([]);
    });

    it(`${nom} : la liste des touches annoncées est la VRAIE`, () => {
      // Les deux documents annonçaient « 1-9, 0 » et le dashboard en expose
      // treize. Une phrase d'introduction qui compte faux est plus trompeuse
      // qu'une absence : elle donne l'impression d'avoir tout vu.
      const alpha = vues()
        .map((v) => v.key)
        .filter((k) => !/^[0-9]$/.test(k));
      expect(alpha.length, 'aucune touche alphabétique : le cas n’existe plus').toBeGreaterThan(0);
      for (const k of alpha) {
        expect(doc, `la touche « ${k} » n’est pas annoncée`).toContain(`\`${k}\``);
      }
    });
  }
});
