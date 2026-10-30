// Garde de la coquille du dashboard.
//
// Mission Control est du React typé et testé, mais sa MISE EN PAGE tient dans
// une feuille de style que rien ne vérifie : ni `tsc`, ni ESLint, ni Vitest ne
// lisent une cascade CSS. Une règle qui en écrase silencieusement une autre
// passe donc toute la CI en vert et ne se voit qu'à l'écran.
//
// C'est exactement ce qui était arrivé : l'élément racine porte DEUX classes,
// `app` et `mc-app`. La première déclare `flex-direction: column` ; la seconde
// déclarait `display: flex` sans jamais reparler de la direction. Comme c'était
// la seule déclaration de cette propriété, elle l'emportait : la barre de
// navigation, haute de 100 vh, se posait AU-DESSUS du contenu, et il fallait
// faire défiler un écran entier de vide avant d'apercevoir la moindre vue.
//
// Ce fichier ne teste pas un comportement : il verrouille les quelques
// propriétés de la coquille qu'on ne peut pas se permettre de reperdre.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLES_ALERTE } from '../src/orchestrator/tableau.js';

const CSS = readFileSync(new URL('../dashboard/src/styles.css', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8');

/** Corps d'une règle CSS de premier niveau, commentaires retirés. */
function regle(selecteur: string): string {
  const i = CSS.indexOf(`\n${selecteur} {`);
  expect(i, `règle « ${selecteur} » introuvable`).toBeGreaterThanOrEqual(0);
  const debut = i + selecteur.length + 3;
  const fin = CSS.indexOf('\n}', debut);
  return CSS.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('coquille du dashboard', () => {
  it('la racine porte BIEN les deux classes qui se disputent la cascade', () => {
    // Si un jour la coquille ne portait plus « app », le test suivant
    // continuerait de passer en gardant une propriété devenue inutile — et le
    // commentaire qui l'explique deviendrait un mensonge.
    expect(APP).toContain('className="app mc-app"');
  });

  it('LA BARRE EST À CÔTÉ DU CONTENU, PAS AU-DESSUS', () => {
    // `.app` déclare `column`. Sans déclaration concurrente dans `.mc-app`,
    // c'est elle qui s'applique, et toute l'application se replie.
    expect(regle('.app')).toMatch(/flex-direction:\s*column/);
    expect(regle('.mc-app')).toMatch(/flex-direction:\s*row/);
  });

  it('la barre reste étroite et à demeure', () => {
    // La VALEUR de la largeur n'est pas la propriété à tenir — elle a déjà
    // bougé une fois (84 px → 214 px, quand les libellés sont passés à côté
    // de l'icône au lieu de dessous). Ce qu'on ne peut pas se permettre de
    // reperdre, c'est qu'elle soit BORNÉE : une barre en pourcentage ou en
    // `auto` reprendrait toute la largeur et repousserait la vue hors écran.
    const barre = regle('.mc-sidebar');
    const largeur = /width:\s*(\d+)px/.exec(barre);
    expect(largeur, 'la barre n’a plus de largeur fixe en pixels').not.toBeNull();
    expect(Number(largeur?.[1]), 'la barre mange la moitié de l’écran').toBeLessThanOrEqual(320);
    expect(barre).toMatch(/position:\s*sticky/);
  });
});

describe('« + Projet » ne suit pas les treize vues', () => {
  // ─── CE QUE LA LOUPE A NOMMÉ ───────────────────────────────────────────────
  //
  // Le bouton vivait dans l'en-tête COMMUN : il suivait les treize vues et
  // proposait de créer un projet depuis la Santé ou le Rayon — une action sans
  // rapport avec ce qu'on regarde. La refonte l'a conditionné, et personne ne
  // gardait la condition : `&&` muté en `||` survivait, et le bouton reparaît
  // partout sans qu'un test bronche.

  /** Le bloc des actions de l'en-tête, là où le bouton vit. */
  const actions = (): string => {
    const i = APP.indexOf('topbar-actions');
    expect(i, 'le bloc d’actions de l’en-tête a disparu').toBeGreaterThan(-1);
    return APP.slice(i, i + 900);
  };

  /**
   * Le texte qui précède le BOUTON, commentaire compris.
   *
   * On vise l'appel JSX `t('+ Projet'` et non la chaîne nue : le commentaire
   * juste au-dessus nomme lui aussi « + Projet », et découper dessus plaçait
   * la condition APRÈS la coupe — le test cherchait la garde dans un morceau
   * qui ne pouvait pas la contenir, et rougissait sur du code correct.
   */
  const avantLeBouton = (): string => {
    const bloc = actions();
    const i = bloc.indexOf("t('+ Projet'");
    expect(i, 'le bouton « + Projet » a disparu de l’en-tête').toBeGreaterThan(-1);
    return bloc.slice(0, i);
  };

  it('LE RELEVÉ TROUVE LE BOUTON — sinon tout ce qui suit est creux', () => {
    expect(actions()).toContain("t('+ Projet'");
  });

  it('IL EST CONDITIONNÉ À LA VUE « projets », ET PAR UN ET', () => {
    // `||` rendrait la condition toujours vraie : c'est exactement le mutant
    // qui survivait. On exige la conjonction, pas seulement la mention.
    const avant = avantLeBouton();
    expect(avant, 'le bouton n’est plus conditionné à la vue').toMatch(
      /route\.view === 'projets'\s*&&/,
    );
    expect(avant, 'un OU rendrait la condition toujours vraie').not.toMatch(
      /route\.view === 'projets'\s*\|\|/,
    );
  });

  it('…ET C’EST BIEN « projets », pas une autre vue', () => {
    // Un test qui accepterait n'importe quelle vue laisserait le bouton
    // atterrir sur la Santé sans rougir.
    const vues = [...avantLeBouton().matchAll(/route\.view === '([a-z]+)'/g)].map((m) => m[1]);
    expect(vues).toContain('projets');
    expect(
      vues.filter((v) => v !== 'projets'),
      'une autre vue s’est glissée dans la garde',
    ).toEqual([]);
  });
});

describe('les alertes du tableau de bord se traduisent', () => {
  // Le serveur envoie une CLÉ ; la phrase se compose côté navigateur, dans la
  // langue de l'interface. Une clé ajoutée au module pur sans son cas dans la
  // vue ne casserait RIEN : elle retomberait silencieusement sur le message
  // français de repli, et cette ligne resterait en français sur une interface
  // anglaise — sans qu'aucun test ne s'en aperçoive. D'où cette garde.

  it('CHAQUE clé d’alerte a son cas dans la vue', () => {
    const vue = readFileSync(
      new URL('../dashboard/src/views/MonEspace.tsx', import.meta.url),
      'utf8',
    );
    expect(CLES_ALERTE.length).toBeGreaterThan(0);
    for (const cle of CLES_ALERTE) {
      expect(vue, `clé « ${cle} » sans traduction dans MonEspace.tsx`).toContain(`case '${cle}'`);
    }
  });

  it('le repli existe toujours — un client plus ancien affiche une phrase, pas du vide', () => {
    const vue = readFileSync(
      new URL('../dashboard/src/views/MonEspace.tsx', import.meta.url),
      'utf8',
    );
    expect(vue).toMatch(/default:\s*\n?\s*return a\.message;/);
  });
});

describe('le tiroir de navigation du téléphone', () => {
  // Rien de ce qui suit ne se voit en jsdom/happy-dom, qui n'applique pas les
  // `@media` : le comportement du tiroir (dialogue, focus, Échap) est tenu par
  // tests/app-tiroir-parametres.test.tsx, sa FORME ici.

  /** Le bloc `@media (max-width: 560px)` qui dessine le tiroir. */
  const blocTiroir = (): string => {
    const motif = /@media \(max-width: (\d+)px\) \{\n {2}\.mc-burger \{/;
    const m = motif.exec(CSS);
    expect(m, 'le bloc média du tiroir a disparu de styles.css').not.toBeNull();
    const debut = m!.index;
    // Le bloc finit à la première accolade fermante en colonne 0.
    return CSS.slice(debut, CSS.indexOf('\n}\n', debut)).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  /** Corps d'une règle à l'intérieur du bloc (indentée de deux espaces). */
  const dansLeBloc = (selecteur: string): string => {
    const bloc = blocTiroir();
    const i = bloc.indexOf(`\n  ${selecteur} {`);
    expect(i, `règle « ${selecteur} » introuvable dans le bloc du tiroir`).toBeGreaterThan(-1);
    return bloc.slice(i, bloc.indexOf('\n  }', i));
  };

  it('LA BORNE DE LA FEUILLE EST CELLE QUE LA COQUILLE SURVEILLE', () => {
    // Désaccordées, un tiroir ouvert survivrait à un élargissement de la
    // fenêtre : focus prisonnier d'une barre redevenue ordinaire.
    const largeur = /@media \(max-width: (\d+)px\) \{\n {2}\.mc-burger \{/.exec(CSS)?.[1];
    expect(APP).toContain(`const REQUETE_TIROIR = '(max-width: ${largeur}px)'`);
  });

  it('FERMÉ, LE TIROIR SORT DU FLUX ET N’EST NI TABULABLE NI LU', () => {
    const barre = dansLeBloc('.mc-sidebar');
    // Hors du flux : le contenu reprend toute la largeur de l'écran.
    expect(barre).toMatch(/position:\s*fixed/);
    expect(barre).toMatch(/transform:\s*translateX\(-100%\)/);
    // Décalée seulement, la barre garderait ses cases dans l'ordre de Tab.
    expect(barre).toMatch(/visibility:\s*hidden/);
    expect(dansLeBloc('.mc-sidebar--ouverte')).toMatch(/visibility:\s*visible/);
  });

  it('LE ☰ N’EXISTE QU’AU FORMAT TÉLÉPHONE', () => {
    expect(regle('.mc-burger')).toMatch(/display:\s*none/);
    expect(dansLeBloc('.mc-burger')).toMatch(/display:\s*inline-flex/);
  });
});

describe('le fil des décisions de l’accueil — une liste, à côté du Journal devenu Terminal', () => {
  // `DecisionsRecentes` (l'accueil, #504) dit chaque décision comme le Journal
  // (`ligneDuJournal`), dans une liste : `ul.journal > li.jrow`, icône, texte,
  // heure. Le Journal vit désormais dans le Terminal (#523), qui a emporté les
  // règles de cette liste : l'accueil retombait en puces, l'icône, le texte et
  // l'heure collés sur une ligne, et la liste débordait de sa carte.
  const DECISIONS = readFileSync(
    new URL('../dashboard/src/DecisionsRecentes.tsx', import.meta.url),
    'utf8',
  );

  it('LE FIL EST BIEN CETTE LISTE — sinon la garde qui suit est creuse', () => {
    expect(DECISIONS).toContain('<ul className="journal">');
    expect(DECISIONS).toContain('className={`jrow ');
    expect(DECISIONS).toContain('className="jicon"');
  });

  it('SANS PUCES, UNE GRILLE PAR DÉCISION, QUI DÉFILE DANS SA CARTE — sans toucher au Terminal', () => {
    expect(regle('ul.journal')).toMatch(/list-style:\s*none/);
    expect(regle('.panel ul.journal')).toMatch(/overflow-y:\s*auto/);
    const decision = regle('ul.journal > .jrow');
    expect(decision).toMatch(/display:\s*grid/);
    expect(decision).toMatch(/grid-template-columns:/);
    expect(regle('.jicon')).toMatch(/text-align:\s*center/);
    // Le Terminal porte aussi `journal` (sa zone) et `jrow` (ses lignes,
    // placées une à une) : une règle nue sur l'un ou l'autre les déplacerait.
    expect(CSS).not.toMatch(/\n\.journal \{/);
    expect(CSS).not.toMatch(/\n\.jrow \{/);
  });
});
