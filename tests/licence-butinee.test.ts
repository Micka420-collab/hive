// LA LICENCE D'UN BUTIN — le seul risque du butinage qui ne se rattrape pas.
//
// Un fichier trop gros se re-télécharge ; un condensat faux se signale ; un
// code hostile se retire. Intégrer du copyleft fort dans un produit qu'on
// distribue autrement ne se retire PAS : l'obligation naît de la distribution,
// elle est rétroactive, et la seule réparation est juridique.

import { describe, expect, it } from 'vitest';
import { jugerLicence } from '../src/shared/licence-butinee.js';

describe('les familles que la ruche sait trancher', () => {
  it('les permissives passent SANS décision humaine', () => {
    for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', '0BSD']) {
      const v = jugerLicence(l);
      expect(v.famille, l).toBe('permissive');
      expect(v.integrableSansDecision, l).toBe(true);
    }
  });

  it('MÊME PERMISSIVE, le message rappelle que c’est une DÉCLARATION', () => {
    // ─── LA LIMITE QUI DOIT SURVIVRE AU VERDICT LE PLUS FAVORABLE ───────────
    //
    // Un champ de manifeste n'établit pas sous quelle licence le code est
    // publié. Il peut être absent, faux, obsolète, ou contredit par un fichier
    // `LICENSE`. Un « permissive » qui se lirait « vous avez le droit » serait
    // exactement le raccourci que ce module existe pour empêcher.
    expect(jugerLicence('MIT').pourquoi).toContain('DÉCLARE');
    expect(jugerLicence('MIT').pourquoi).toContain('pas une garantie');
  });

  it('le copyleft FORT demande une décision, et dit ce qu’il coûte', () => {
    for (const l of ['GPL-3.0-only', 'AGPL-3.0', 'GPL-2.0-or-later']) {
      const v = jugerLicence(l);
      expect(v.famille, l).toBe('copyleft_fort');
      expect(v.integrableSansDecision, l).toBe(false);
    }
    // Le message décrit la CONSÉQUENCE, pas la règle : c'est ce qui permet de
    // décider. « Contient GPL » n'apprend rien.
    expect(jugerLicence('AGPL-3.0').pourquoi).toContain('distribution');
    expect(jugerLicence('AGPL-3.0').pourquoi).toContain('ne se retire pas');
  });

  it('le copyleft FAIBLE est distingué du fort', () => {
    // Les confondre ferait refuser des paquets parfaitement intégrables — et à
    // force de refus injustifiés, la garde finit contournée.
    for (const l of ['LGPL-3.0', 'MPL-2.0', 'EPL-2.0']) {
      expect(jugerLicence(l).famille, l).toBe('copyleft_faible');
    }
  });

  it('les licences RESTREINTES ne sont pas de simples inconnues', () => {
    // « Non commercial », « source disponible » : ce ne sont pas des licences
    // libres. Les ranger avec les fautes de frappe ferait croire à un problème
    // de catalogue là où il y a une interdiction d'usage.
    for (const l of ['CC-BY-NC-4.0', 'SSPL-1.0', 'BUSL-1.1', 'UNLICENSED', 'proprietary']) {
      expect(jugerLicence(l).famille, l).toBe('restreinte');
    }
  });

  it('UNLICENSE ET UNLICENSED SONT DEUX CHOSES OPPOSÉES', () => {
    // Un caractère d'écart, et le sens s'inverse : `Unlicense` est un abandon
    // au domaine public, `UNLICENSED` est un refus de licence. Les confondre
    // rendrait le plus permissif des verdicts sur le plus fermé des paquets.
    expect(jugerLicence('Unlicense').famille).toBe('permissive');
    expect(jugerLicence('UNLICENSED').famille).toBe('restreinte');
  });

  it('UN IDENTIFIANT INCONNU EST DIT INCONNU, jamais deviné', () => {
    expect(jugerLicence('Licence-de-la-maison-1.0').famille).toBe('inconnue');
    expect(jugerLicence('Licence-de-la-maison-1.0').integrableSansDecision).toBe(false);
  });

  it('AUCUNE LICENCE N’EST UN REFUS PAR DÉFAUT, pas une permission', () => {
    for (const rien of [undefined, null, '', '   ', 42]) {
      const v = jugerLicence(rien);
      expect(v.famille, String(rien)).toBe('absente');
      expect(v.integrableSansDecision, String(rien)).toBe(false);
    }
    expect(jugerLicence('').pourquoi).toContain('refus par défaut');
  });

  it('le suffixe « + » ne change pas la famille', () => {
    // `GPL-2.0+` est la même famille que `GPL-2.0` — le sauter en ferait un
    // identifiant inconnu, donc une lecture humaine pour rien.
    expect(jugerLicence('GPL-2.0+').famille).toBe('copyleft_fort');
    expect(jugerLicence('Apache-2.0+').famille).toBe('permissive');
  });
});

describe('les expressions SPDX — `OR` et `AND` ne se valent pas', () => {
  it('`OR` OFFRE UN CHOIX : la MOINS contraignante décide', () => {
    // ─── LA MOITIÉ QUI TUE « prendre toujours la plus grave » ────────────────
    //
    // `(MIT OR GPL-3.0)` laisse prendre MIT et ignorer le reste. Traiter cette
    // expression comme du copyleft ferait refuser un paquet parfaitement
    // intégrable — et une garde qui refuse à tort finit par être contournée.
    const v = jugerLicence('(MIT OR GPL-3.0)');
    expect(v.famille).toBe('permissive');
    expect(v.integrableSansDecision).toBe(true);
  });

  it('`AND` IMPOSE LES DEUX : la PLUS contraignante décide', () => {
    // Et l'erreur inverse est bien pire : croire avoir le choix là où les deux
    // s'appliquent laisserait passer une obligation de publication.
    const v = jugerLicence('MIT AND GPL-3.0');
    expect(v.famille).toBe('copyleft_fort');
    expect(v.integrableSansDecision).toBe(false);
  });

  it('`OR` entre deux non-permissives retient quand même la moins grave', () => {
    // La borne du côté où ça compte : l'ordre de gravité doit être un ordre,
    // pas seulement un test « est-ce permissif ».
    expect(jugerLicence('AGPL-3.0 OR LGPL-3.0').famille).toBe('copyleft_faible');
    expect(jugerLicence('SSPL-1.0 OR GPL-3.0').famille).toBe('copyleft_fort');
  });

  it('`AND` entre deux permissives reste permissif', () => {
    expect(jugerLicence('MIT AND Apache-2.0').integrableSansDecision).toBe(true);
  });

  it('MÊLER `OR` ET `AND` RENVOIE À L’HUMAIN', () => {
    // La portée dépend de parenthèses que ce module ne résout pas. Une lecture
    // humaine coûte moins qu'une priorité mal devinée — et deviner ici, c'est
    // exactement le service dont personne ne veut.
    const v = jugerLicence('(MIT OR GPL-3.0) AND CC-BY-NC-4.0');
    expect(v.famille).toBe('inconnue');
    expect(v.integrableSansDecision).toBe(false);
    expect(v.pourquoi).toContain('parenthèses');
  });

  it('les opérateurs se lisent quelle que soit la casse', () => {
    expect(jugerLicence('MIT or GPL-3.0').famille).toBe('permissive');
    expect(jugerLicence('MIT and GPL-3.0').famille).toBe('copyleft_fort');
  });

  it('« or » DANS un identifiant n’est pas un opérateur', () => {
    // La moitié qui tue un découpage sans frontières de mot : `Sendmail` ou
    // `Motosoto` contiennent des lettres, pas des opérateurs. Un découpage
    // brutal fabriquerait deux jetons illisibles à partir d'un nom valide.
    const v = jugerLicence('Corporate-License-1.0');
    expect(v.declaree).toBe('Corporate-License-1.0');
    expect(v.famille).toBe('inconnue');
  });

  it('L’ORDRE DES OPÉRANDES NE CHANGE RIEN — la prémisse de l’équivalence', () => {
    // ─── CE QUE CE BANC GARDE, ET POURQUOI IL N'EST PAS LÀ POUR UN MUTANT ───
    //
    // Le balayage a rendu nues les deux comparaisons de gravité (`<` et `>`).
    // Elles sont ÉQUIVALENTES, et c'est prouvé plutôt que supposé : les deux
    // mutants ne diffèrent que sur une ÉGALITÉ de gravité, or chaque famille a
    // une gravité distincte — donc l'égalité n'arrive qu'entre une famille et
    // elle-même, et les deux branches rendent la même chaîne. Mesuré sur les 25
    // couples × 2 opérateurs : zéro désaccord.
    //
    // Ce banc ne défend donc pas la borne : il défend la PRÉMISSE. Le jour où
    // quelqu'un donnera à une nouvelle famille une gravité déjà prise, le
    // verdict se mettrait à dépendre de l'ordre d'écriture des licences — deux
    // manifestes identiques au mot près rendraient deux décisions. C'est cela
    // qu'il faut voir rougir.
    const parFamille = ['MIT', 'Licence-maison-1.0', 'LGPL-3.0', 'GPL-3.0', 'SSPL-1.0'];
    for (const a of parFamille) {
      for (const b of parFamille) {
        for (const op of ['OR', 'AND']) {
          expect(
            jugerLicence(`${a} ${op} ${b}`).famille,
            `${a} ${op} ${b} ne rend pas comme ${b} ${op} ${a}`,
          ).toBe(jugerLicence(`${b} ${op} ${a}`).famille);
        }
      }
    }
  });

  it('UNE FAMILLE CONFRONTÉE À ELLE-MÊME SE REND ELLE-MÊME', () => {
    // L'autre moitié de la prémisse : sur l'égalité, le choix de branche ne
    // doit rien changer. Si un jour il changeait quelque chose, l'équivalence
    // consignée au-dessus cesserait d'être vraie — et ce banc le dirait.
    for (const id of ['MIT', 'GPL-3.0', 'SSPL-1.0']) {
      const attendu = jugerLicence(id).famille;
      expect(jugerLicence(`${id} OR ${id}`).famille, id).toBe(attendu);
      expect(jugerLicence(`${id} AND ${id}`).famille, id).toBe(attendu);
    }
  });

  it('l’expression rendue est celle qu’on a déclarée', () => {
    // Le verdict doit pouvoir être relu contre sa source : rendre une forme
    // reconstruite obligerait à faire confiance au module sur ce point aussi.
    expect(jugerLicence('  (MIT OR Apache-2.0)  ').declaree).toBe('(MIT OR Apache-2.0)');
  });
});
