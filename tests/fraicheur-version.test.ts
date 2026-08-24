// SUIS-JE À JOUR ? — les bancs de la comparaison.
//
// Ce module ne touche ni au réseau ni au disque : il reçoit deux chaînes et
// rend un verdict. Tout y est donc éprouvable par un argument, ce qui est
// exactement pourquoi il a été séparé de ce qui va CHERCHER la dernière
// version (§ 9 duooctogicenties : une décision soudée à sa lecture est hors
// d'atteinte des bancs).

import { describe, expect, it } from 'vitest';
import {
  direFraicheur,
  fraicheur,
  laPlusRecente,
  lireVersion,
  ordonner,
} from '../src/shared/fraicheur-version.js';

describe('lire une version', () => {
  it('avec ou sans le « v » de tête', () => {
    expect(lireVersion('v0.3.0')).toEqual({ majeur: 0, mineur: 3, correctif: 0 });
    expect(lireVersion('0.3.0')).toEqual({ majeur: 0, mineur: 3, correctif: 0 });
  });

  it('les espaces autour ne trompent pas', () => {
    expect(lireVersion('  v1.2.3\n')).toEqual({ majeur: 1, mineur: 2, correctif: 3 });
  });

  it('CE QUI N’EST PAS TROIS NOMBRES N’EST PAS UNE VERSION', () => {
    // Le piège que ces cas ferment : lire `v1.2` comme `1.2.0`, ou
    // `v1.0.0-beta` comme `1.0.0`. Les deux SUPPOSENT, et une supposition ici
    // se traduit par « vous êtes à jour » adressé à quelqu'un qui ne l'est
    // pas — la seule réponse vraiment nuisible de ce module.
    expect(lireVersion('v1.2')).toBeNull();
    expect(lireVersion('v1.0.0-beta')).toBeNull();
    expect(lireVersion('v1.2.3.4')).toBeNull();
    expect(lireVersion('essai-du-mardi')).toBeNull();
    expect(lireVersion('')).toBeNull();
    expect(lireVersion(null)).toBeNull();
    expect(lireVersion('inconnue')).toBeNull();
  });

  it('un zéro est un nombre comme un autre', () => {
    expect(lireVersion('v0.0.0')).toEqual({ majeur: 0, mineur: 0, correctif: 0 });
  });
});

describe('ordonner deux versions', () => {
  const V = (s: string) => lireVersion(s)!;

  it('LE MAJEUR PRIME SUR TOUT LE RESTE', () => {
    // Sans ce cas, comparer champ par champ dans le mauvais ordre passerait :
    // 1.0.0 contre 0.99.99 doit rendre « plus récente » malgré un mineur et
    // un correctif écrasants en face.
    expect(ordonner(V('1.0.0'), V('0.99.99'))).toBe(1);
    expect(ordonner(V('0.99.99'), V('1.0.0'))).toBe(-1);
  });

  it('puis le mineur, puis le correctif', () => {
    expect(ordonner(V('0.3.0'), V('0.2.9'))).toBe(1);
    expect(ordonner(V('0.3.1'), V('0.3.2'))).toBe(-1);
  });

  it('égales rend 0, et dans les deux sens', () => {
    expect(ordonner(V('1.2.3'), V('1.2.3'))).toBe(0);
    expect(ordonner(V('0.0.0'), V('0.0.0'))).toBe(0);
  });
});

describe('la plus récente d’une liste', () => {
  it('l’ordre de la liste ne décide de rien', () => {
    expect(laPlusRecente(['v0.1.0', 'v0.3.0', 'v0.2.0'])).toBe('v0.3.0');
    expect(laPlusRecente(['v0.3.0', 'v0.2.0', 'v0.1.0'])).toBe('v0.3.0');
  });

  it('LES ÉTIQUETTES ILLISIBLES SONT ÉCARTÉES, PAS FATALES', () => {
    // Un dépôt réel porte des étiquettes qui ne sont pas des versions. Les
    // laisser tout casser rendrait « je ne sais pas » sur un dépôt qui sait
    // parfaitement.
    expect(laPlusRecente(['essai-du-mardi', 'v0.3.0', 'brouillon'])).toBe('v0.3.0');
  });

  it('rien de lisible ⇒ rien d’inventé', () => {
    expect(laPlusRecente([])).toBeNull();
    expect(laPlusRecente(['essai', 'brouillon'])).toBeNull();
  });

  it('la forme rendue est celle qui était DANS la liste', () => {
    // On rend l'étiquette telle qu'elle existe côté dépôt, pas une
    // reconstruction : c'est elle qu'on ira chercher ensuite.
    expect(laPlusRecente(['0.3.0'])).toBe('0.3.0');
    expect(laPlusRecente(['v0.3.0'])).toBe('v0.3.0');
  });
});

describe('le verdict', () => {
  it('mêmes versions ⇒ à jour', () => {
    expect(fraicheur('v0.3.0', 'v0.3.0')).toBe('a-jour');
    expect(fraicheur('0.3.0', 'v0.3.0')).toBe('a-jour');
  });

  it('plus ancienne ⇒ en retard', () => {
    expect(fraicheur('v0.2.0', 'v0.3.0')).toBe('en-retard');
  });

  it('EN AVANCE N’EST NI « À JOUR » NI « EN RETARD »', () => {
    // Quelqu'un qui développe tourne après la dernière étiquette. « À jour »
    // serait faux dans le sens rassurant ; « en retard » l'enverrait se
    // mettre à jour VERS UNE VERSION PLUS ANCIENNE, donc perdre son travail.
    expect(fraicheur('v0.4.0', 'v0.3.0')).toBe('en-avance');
  });

  it('une version illisible d’un côté OU DE L’AUTRE ⇒ inconnue', () => {
    expect(fraicheur(null, 'v0.3.0')).toBe('inconnue');
    expect(fraicheur('v0.3.0', null)).toBe('inconnue');
    expect(fraicheur('inconnue', 'v0.3.0')).toBe('inconnue');
    expect(fraicheur('v0.3.0', 'brouillon')).toBe('inconnue');
    expect(fraicheur(null, null)).toBe('inconnue');
  });
});

describe('ce que la ruche en dit', () => {
  it('chaque verdict a sa phrase, et elles diffèrent', () => {
    const phrases = new Set([
      direFraicheur('a-jour', 'v0.3.0', 'v0.3.0'),
      direFraicheur('en-retard', 'v0.2.0', 'v0.3.0'),
      direFraicheur('en-avance', 'v0.4.0', 'v0.3.0'),
      direFraicheur('inconnue', null, null),
    ]);
    expect(phrases.size, 'deux verdicts rendraient la même phrase').toBe(4);
  });

  it('EN RETARD NOMME LA VERSION À PRENDRE', () => {
    // Sans le numéro visé, la phrase dit « mettez-vous à jour » sans dire
    // vers quoi — l'utilisateur devrait aller le chercher lui-même.
    const fr = direFraicheur('en-retard', 'v0.2.0', 'v0.3.0');
    expect(fr).toContain('v0.3.0');
    expect(fr).toContain('v0.2.0');
  });

  it('EN AVANCE DIT QU’IL N’Y A RIEN À FAIRE', () => {
    expect(direFraicheur('en-avance', 'v0.4.0', 'v0.3.0')).toContain('Rien à mettre à jour');
    expect(direFraicheur('en-avance', 'v0.4.0', 'v0.3.0', 'en')).toContain('Nothing to update');
  });

  it('l’aveu n’encombre pas sa phrase de numéros absents', () => {
    // « je ne sais pas » suivi de « la dernière est null » serait du bruit
    // ajouté à un aveu déjà clair.
    const fr = direFraicheur('inconnue', null, null);
    expect(fr).not.toContain('null');
    expect(fr).toContain('ne peut pas dire');
  });

  it('LES DEUX LANGUES, DANS LES DEUX SENS', () => {
    // Affirmer la forme attendue ne suffit pas : il faut nier celle de
    // l'autre langue, sinon un `lang === 'en'` inversé reste vert.
    const fr = direFraicheur('a-jour', 'v0.3.0', 'v0.3.0', 'fr');
    const en = direFraicheur('a-jour', 'v0.3.0', 'v0.3.0', 'en');
    expect(fr).toContain('dernière version publiée');
    expect(fr).not.toContain('latest published');
    expect(en).toContain('latest published');
    expect(en).not.toContain('dernière version publiée');
  });

  it('le français est le défaut', () => {
    expect(direFraicheur('a-jour', 'v0.3.0', 'v0.3.0')).toBe(
      direFraicheur('a-jour', 'v0.3.0', 'v0.3.0', 'fr'),
    );
  });
});
