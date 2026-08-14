// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// ─── POURQUOI CETTE DIRECTIVE, ET POURQUOI ICI SEULEMENT ─────────────────────
//
// `tsconfig.json` déclare `lib: ["ES2024"]` et `types: ["node"]`, sans `dom` —
// et c'est VOULU : `src/` tourne dans Node, et un `document` qui compile
// tranquillement dans un fichier de serveur est une panne qu'on découvre en
// production. Ajouter `dom` à la racine pour arranger CE fichier ouvrirait la
// porte partout ailleurs.
//
// La directive n'ajoute les types du navigateur qu'ici, où ils décrivent la
// réalité : ce test monte une page.
//
// LA VITRINE, EXÉCUTÉE — le test que quarante-cinq autres ne faisaient pas.
//
// ─── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ───────────────────────────────────────
//
// Le 1er août 2026, un mois avant la sortie, la page publique du projet portait
// ceci dans son dictionnaire anglais :
//
//     'mc.12.d':
//     'mc.13.t': 'h · Works',
//
// `mc.12.d` avait perdu sa valeur — mangée par une retouche —, si bien que
// l'analyseur lisait `'mc.12.d': 'mc.13.t'` puis butait sur le `:` suivant :
//
//     Uncaught SyntaxError: Unexpected token ':'
//
// Un script qui ne s'analyse pas ne s'exécute PAS DU TOUT. Sur la vitrine en
// ligne, cela voulait dire : le basculement FR/EN mort, le bouton « copier »
// mort, le journal de l'essaim vide, le décalage des ancres jamais appliqué.
// Tout, depuis la première ligne, sur la page que les visiteurs voient.
//
// ─── POURQUOI QUARANTE-CINQ TESTS N'ONT RIEN VU ──────────────────────────────
//
// Parce qu'ils lisaient tous le HTML COMME DU TEXTE. `tests/site.test.ts`
// vérifie même que « chaque clé du HTML a une traduction anglaise » — et cette
// garde-là passait au vert, parce que sa régulière trouvait bien `'mc.12.d':`
// dans le fichier. Elle cherchait une CLÉ ; il manquait une VALEUR.
//
// C'est le défaut signature de ce dépôt, dans sa forme la plus pure : un chemin
// que personne n'exécute et que tout le monde croit bon. La différence entre
// lire et exécuter n'est pas une nuance de rigueur : c'est la seule chose qui
// sépare une suite verte d'une page morte.
//
// ─── CE QUE CE FICHIER FAIT, DANS L'ORDRE DE CE QU'IL COÛTE ──────────────────
//
// 1. Il COMPILE chaque script que le navigateur exécuterait. Déterministe,
//    instantané, sans navigateur — c'est la garde qui aurait mordu.
// 2. Il ÉVALUE le dictionnaire anglais au lieu de le lire, ce qui rend une clé
//    sans valeur impossible à confondre avec une traduction.
// 3. Il MONTE la page et clique, parce qu'un script qui s'analyse peut encore
//    ne rien faire.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── POURQUOI `process.cwd()` ET NON `import.meta.url` ───────────────────────
//
// Sous l'environnement `happy-dom`, `import.meta.url` devient une URL `http:`
// — le module se croit chargé par un navigateur — et `readFileSync` refuse :
// « The URL must be of scheme file ». Le reste du dépôt lit par `import.meta.url`
// et a raison de le faire ; ici c'est la seule ligne qui ne le peut pas.
// `vitest` pose son répertoire courant à la racine du projet.
const VITRINE = readFileSync(path.resolve(process.cwd(), 'site/index.html'), 'utf8');

interface BlocScript {
  readonly type: string;
  readonly code: string;
  readonly ligne: number;
}

/**
 * Les scripts que le NAVIGATEUR exécuterait — et eux seuls.
 *
 * `type="application/ld+json"` est une donnée : le navigateur ne l'exécute
 * jamais. La compiler ici échouerait à tous les coups et il faudrait alors
 * désarmer la garde entière — c'est ainsi qu'on perd un test.
 */
function scriptsExecutes(html: string): BlocScript[] {
  const blocs: BlocScript[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attributs = m[1] ?? '';
    const type = /type\s*=\s*"([^"]+)"/.exec(attributs)?.[1] ?? 'text/javascript';
    if (!/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    blocs.push({ type, code: m[2] ?? '', ligne: html.slice(0, m.index).split('\n').length });
  }
  return blocs;
}

describe('CHAQUE SCRIPT DE LA VITRINE S’ANALYSE', () => {
  it('il y a bien un script à analyser — sinon la garde ne garde rien', () => {
    // Sans cette borne, un jour où le `<script>` change de forme, la boucle
    // ci-dessous tournerait à vide et rendrait un vert parfaitement creux.
    const blocs = scriptsExecutes(VITRINE);
    expect(blocs.length, 'aucun script exécutable trouvé dans la vitrine').toBeGreaterThan(0);
    const gros = blocs.reduce((a, b) => (a.code.length > b.code.length ? a : b));
    expect(gros.code.length, 'le script principal a maigri de façon suspecte').toBeGreaterThan(
      10_000,
    );
  });

  for (const bloc of scriptsExecutes(VITRINE)) {
    it(`le script de la ligne ${String(bloc.ligne)} se compile`, () => {
      // ─── L'ASSERTION QUI AURAIT MORDU ────────────────────────────────────
      //
      // `new Function` fait exactement ce que fait le navigateur au chargement :
      // il ANALYSE. Il n'exécute pas — on ne veut ni `document` ni minuterie
      // ici, seulement savoir si le fichier est du JavaScript valide.
      expect(() => new Function(bloc.code)).not.toThrow();
    });
  }
});

/**
 * Le dictionnaire anglais, ÉVALUÉ.
 *
 * `tests/site.test.ts` en lit les clés à la régulière. C'est ce qui a laissé
 * passer une clé sans valeur : la régulière voyait `'mc.12.d':` et concluait
 * « traduite ». Un objet, lui, ne peut pas avoir une clé sans valeur.
 */
function dictionnaireAnglais(source: string = VITRINE): Record<string, unknown> {
  const VITRINE = source;
  const debut = VITRINE.indexOf('var EN = {');
  expect(debut, 'dictionnaire EN introuvable').toBeGreaterThan(-1);
  const ouvrante = VITRINE.indexOf('{', debut);
  let profondeur = 0;
  let fin = -1;
  let dansChaine: string | null = null;
  for (let i = ouvrante; i < VITRINE.length; i++) {
    const c = VITRINE[i];
    if (dansChaine !== null) {
      if (c === '\\') i++;
      else if (c === dansChaine) dansChaine = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') dansChaine = c;
    else if (c === '{') profondeur++;
    else if (c === '}') {
      profondeur--;
      if (profondeur === 0) {
        fin = i;
        break;
      }
    }
  }
  expect(fin, 'accolade fermante du dictionnaire EN introuvable').toBeGreaterThan(ouvrante);
  const litteral = VITRINE.slice(ouvrante, fin + 1);
  return new Function(`return ${litteral}`)() as Record<string, unknown>;
}

describe('LE DICTIONNAIRE ANGLAIS EST UN OBJET, PAS DU TEXTE', () => {
  it('il s’évalue, et il est copieux', () => {
    const en = dictionnaireAnglais();
    expect(Object.keys(en).length, 'dictionnaire anglais suspicieusement maigre').toBeGreaterThan(
      100,
    );
  });

  it('AUCUNE CLÉ N’A PERDU SA VALEUR', () => {
    // Le défaut exact : `'mc.12.d':` suivi de `'mc.13.t': …` donnait, pour qui
    // lisait le texte, deux clés traduites ; pour l'analyseur, une erreur de
    // syntaxe. Ici, une valeur mangée devient soit une exception à
    // l'évaluation, soit une valeur qui ressemble à une clé — les deux mordent.
    const en = dictionnaireAnglais();
    const suspectes: string[] = [];
    for (const [cle, valeur] of Object.entries(en)) {
      if (typeof valeur !== 'string' || valeur.trim() === '') suspectes.push(`${cle} → vide`);
      // Une valeur qui a la forme d'une CLÉ du dictionnaire est le signe que la
      // vraie valeur a été mangée et que la clé suivante a glissé à sa place.
      else if (Object.prototype.hasOwnProperty.call(en, valeur))
        suspectes.push(`${cle} → « ${valeur} », qui est une autre clé`);
    }
    expect(suspectes, 'clé(s) dont la valeur a été mangée').toEqual([]);
  });
});

describe('LA PAGE MONTÉE FAIT CE QU’ELLE PROMET', () => {
  // Un script peut s'analyser et ne rien faire. Ces trois-là sont les gestes
  // que la page propose au visiteur ; ils passent par le même script.

  beforeEach(() => {
    document.documentElement.innerHTML = VITRINE.replace(/^[\s\S]*?<html[^>]*>/, '').replace(
      /<\/html>[\s\S]*$/,
      '',
    );
    // happy-dom n'exécute pas les scripts insérés par `innerHTML` : on prend
    // donc le script principal et on le lance nous-mêmes, ce qui est exactement
    // ce que fait le navigateur une fois le document analysé.
    const principal = scriptsExecutes(VITRINE).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();
  });

  /** Clique un bouton de langue et rend le titre qui en résulte. */
  function basculer(bouton: 'btn-fr' | 'btn-en'): string {
    document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
    return (document.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  it('LE BASCULEMENT CHANGE VRAIMENT LE TEXTE, DANS LES DEUX SENS', () => {
    // ─── ON NE SUPPOSE PAS LA LANGUE DE DÉPART ────────────────────────────
    //
    // La page choisit sa langue d'après celle du navigateur, et `happy-dom`
    // démarre en anglais comme Chromium. Une première version de ce test
    // affirmait « au départ, c'est du français » : elle a rougi tout de suite,
    // et elle aurait rougi pareil dans un navigateur configuré en anglais —
    // c'est-à-dire chez la moitié des visiteurs. On CLIQUE d'abord.
    expect(document.querySelector('h1'), 'pas de titre principal').not.toBeNull();

    const fr = basculer('btn-fr');
    const en = basculer('btn-en');

    // ─── ON N'ÉPINGLE PLUS UN MOT DE LA COPIE ──────────────────────────────
    //
    // Cette assertion exigeait le mot « essaim » dans le titre français. Elle a
    // rougi le jour où le titre est passé à « Faites coder plusieurs IA sur
    // votre projet » — sur un changement de copie parfaitement légitime, et
    // même souhaitable : le nouveau titre dit un BÉNÉFICE là où l'ancien
    // nommait une métaphore.
    //
    // Un test qui interdit d'améliorer un texte ne protège rien ; il se fait
    // désarmer. Ce qu'il doit prouver, c'est que la bascule CHANGE le contenu —
    // et ça se vérifie sans connaître un seul mot :
    expect(en, 'le clic sur EN n’a rien changé').not.toBe(fr);
    expect(fr.length, 'le français est vide').toBeGreaterThan(20);
    expect(en.length, 'l’anglais est vide').toBeGreaterThan(20);

    // Et pour être sûr que ce n'est pas la MÊME phrase à une virgule près, on
    // exige que les deux versions diffèrent substantiellement.
    const communs = new Set(
      fr
        .toLowerCase()
        .split(/\W+/)
        .filter((m) => m.length > 3),
    );
    const distincts = en
      .toLowerCase()
      .split(/\W+/)
      .filter((m) => m.length > 3 && !communs.has(m));
    expect(
      distincts.length,
      'les deux langues se ressemblent trop pour être deux langues',
    ).toBeGreaterThan(2);
  });

  it('LA PAGE APPLIQUE LE DICTIONNAIRE QU’ELLE PRÉTEND APPLIQUER', () => {
    // ─── LE TROU QUE LE BALAYAGE PAR MUTATION A OUVERT ─────────────────────
    //
    // Le test au-dessus assène que les deux langues DIFFÈRENT. C'était un bon
    // choix — il remplaçait une assertion qui épinglait le mot « essaim » et
    // rougissait sur un changement de copie légitime.
    //
    // Mais « différent » est SYMÉTRIQUE. Le mutant qui échange les deux
    // dictionnaires…
    //
    //     var dict = lang === 'en' ? EN : FR;   →   lang !== 'en'
    //
    // …montre l'anglais au francophone et le français à l'anglophone, et il
    // laissait 149 bancs verts (mesuré à la main, mutant posé puis restauré).
    // Les deux textes diffèrent toujours, sont toujours longs, et partagent
    // toujours peu de mots : rien de ce qui était assené ne pouvait les
    // DÉPARTAGER.
    //
    // ─── CE QUI DÉPARTAGE SANS ÉPINGLER LA COPIE ───────────────────────────
    //
    // Le dictionnaire lui-même est l'oracle. On n'exige aucun mot choisi par
    // nous : on exige que la page, quand elle dit « je suis en anglais »,
    // affiche EXACTEMENT ce que `EN` contient pour cette clé. Un changement de
    // copie déplace les deux ensemble et ce banc suit ; une inversion des
    // dictionnaires les sépare et il mord.
    const en = dictionnaireAnglais();

    // ─── ON COMPARE APRÈS LE MÊME ALLER-RETOUR, ET C'EST MESURÉ ────────────
    //
    // Le dictionnaire écrit `<br />` ; une fois posé dans le DOM et relu,
    // `innerHTML` rend `<br>`. Mesuré :
    //
    //     '<span class="p">a </span>b<br />c'  →  '<span class="p">a </span>b<br>c'
    //
    // La première rédaction de ce banc a rougi là-dessus, sur `go.demo`, et
    // c'était la garde qui avait tort — pas la page. Normaliser les DEUX côtés
    // par le même chemin n'affaiblit rien : ça compare du contenu au lieu de
    // comparer la façon dont un analyseur écrit une balise vide.
    const normaliser = (html: string): string => {
      const bac = document.createElement('div');
      bac.innerHTML = html;
      return bac.innerHTML.trim();
    };

    /** La valeur anglaise d'une clé, ou rien — le dictionnaire est typé `unknown`. */
    const anglais = (cle: string | null | undefined): string | undefined => {
      if (cle == null) return undefined;
      const v = en[cle];
      return typeof v === 'string' && v.trim() !== '' ? v : undefined;
    };

    // Une clé qui existe VRAIMENT dans la page, sinon on garderait le vide.
    const porteuses = [...document.querySelectorAll('[data-i18n]')].filter(
      (el) => anglais(el.getAttribute('data-i18n')) !== undefined,
    );
    expect(porteuses.length, 'aucun élément traduit — la garde ne garderait rien').toBeGreaterThan(
      5,
    );

    basculer('btn-en');
    // Le bouton PRÉTEND l'anglais…
    expect(
      document.getElementById('btn-en')?.getAttribute('aria-pressed'),
      'le bouton EN ne s’annonce pas pressé',
    ).toBe('true');

    // …et le texte doit le TENIR, sur chaque élément traduit.
    const menteuses = porteuses
      .filter(
        (el) =>
          normaliser(el.innerHTML) !== normaliser(anglais(el.getAttribute('data-i18n')) ?? ''),
      )
      .map((el) => el.getAttribute('data-i18n'));
    expect(
      menteuses.slice(0, 5),
      `la page annonce l’anglais et affiche autre chose (${String(menteuses.length)} élément(s))`,
    ).toEqual([]);

    // ─── LES ATTRIBUTS AUSSI, ET C'EST UN SECOND SURVIVANT ─────────────────
    //
    // `data-i18n-attr="attr:cle"` traduit un `title`, un `aria-label`, un
    // `placeholder` — ce que lisent une infobulle et un lecteur d'écran. La
    // première rédaction de ce banc ne regardait que le TEXTE, et le mutant
    //
    //     var val = lang === 'en' ? EN[spec[1]] : ATTR_FR[spec[1]];   →   !==
    //
    // lui a survécu : 17 verts. Un lecteur d'écran anglophone se serait fait
    // annoncer les libellés en français sans qu'un seul banc s'en aperçoive.
    const attrs = [...document.querySelectorAll('[data-i18n-attr]')]
      .map((el) => {
        const [ou, cle] = (el.getAttribute('data-i18n-attr') ?? '').split(':');
        return { el, ou, attendu: anglais(cle), nom: `${ou ?? '?'}:${cle ?? '?'}` };
      })
      .filter(
        (a): a is typeof a & { ou: string; attendu: string } =>
          a.ou !== undefined && a.attendu !== undefined,
      );
    expect(attrs.length, 'aucun attribut traduit — la garde ne garderait rien').toBeGreaterThan(0);

    const attrsMenteurs = attrs
      .filter(({ el, ou, attendu }) => el.getAttribute(ou) !== attendu)
      .map(({ nom }) => nom);
    expect(
      attrsMenteurs.slice(0, 5),
      `l’anglais est annoncé, l’attribut dit autre chose (${String(attrsMenteurs.length)})`,
    ).toEqual([]);

    // Et le sens inverse, sans quoi un mutant qui figerait TOUT sur l'anglais
    // passerait : en français, ces mêmes éléments ne doivent PLUS dire l'anglais.
    basculer('btn-fr');
    const restees = porteuses.filter(
      (el) => normaliser(el.innerHTML) === normaliser(anglais(el.getAttribute('data-i18n')) ?? ''),
    );
    expect(restees.length, 'le retour en français laisse tout le monde en anglais').toBeLessThan(
      porteuses.length,
    );
  });

  it('et le retour en FR remet EXACTEMENT le français d’origine', () => {
    // Le français n'est PAS dans le dictionnaire : il est capturé du HTML au
    // chargement. Un aller-retour est le seul moyen de vérifier que la capture
    // a eu lieu — un aller simple passerait même si elle manquait.
    const depart = basculer('btn-fr');
    basculer('btn-en');
    expect(basculer('btn-fr'), 'le français a été perdu en route').toBe(depart);
  });

  it('le journal de l’essaim se remplit — il était VIDE quand le script mourait', () => {
    expect(document.querySelectorAll('#journal li').length).toBeGreaterThan(0);
  });

  /**
   * Un tableau littéral du script, ÉVALUÉ — même technique que le dictionnaire.
   *
   * `JFR` et `JEN` sont les entrées du journal de l'essaim dans chaque langue.
   * Les lire permet d'ancrer le banc sur la SOURCE que la page prétend utiliser,
   * sans épingler un seul mot de la copie.
   */
  function tableauDuScript(nom: string): { i: string; t: string; c: string }[] {
    const debut = VITRINE.indexOf(`var ${nom} = [`);
    expect(debut, `tableau ${nom} introuvable`).toBeGreaterThan(-1);
    const ouvrante = VITRINE.indexOf('[', debut);
    let profondeur = 0;
    let fin = -1;
    let dansChaine: string | null = null;
    for (let i = ouvrante; i < VITRINE.length; i++) {
      const c = VITRINE[i];
      if (dansChaine !== null) {
        if (c === '\\') i++;
        else if (c === dansChaine) dansChaine = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') dansChaine = c;
      else if (c === '[') profondeur++;
      else if (c === ']') {
        profondeur--;
        if (profondeur === 0) {
          fin = i;
          break;
        }
      }
    }
    expect(fin, `crochet fermant de ${nom} introuvable`).toBeGreaterThan(ouvrante);
    return new Function(`return ${VITRINE.slice(ouvrante, fin + 1)}`)() as {
      i: string;
      t: string;
      c: string;
    }[];
  }

  it('LE JOURNAL DE L’ESSAIM PARLE LA LANGUE DE LA PAGE, ET TIENT SA BORNE', () => {
    // ─── DEUX SURVIVANTS D'UN SEUL BLOC ────────────────────────────────────
    //
    //     var src = lang === 'en' ? JEN : JFR;      ===  →  !==
    //     for (var k = 0; k < 4; k++) {             <    →  <=
    //
    // Le banc voisin assène `#journal li` > 0. Un journal en anglais servi à un
    // francophone en a toujours plus de zéro ; un journal de CINQ lignes aussi.
    // « Il se remplit » ne dit ni la langue ni la quantité.
    //
    // L'ancre : les messages affichés doivent tous venir du tableau que la page
    // PRÉTEND utiliser. Aucun mot n'est épinglé — réécrire une entrée déplace
    // le tableau et le banc suit.
    const par = { fr: tableauDuScript('JFR'), en: tableauDuScript('JEN') } as const;
    expect(par.fr.length, 'journal français vide').toBeGreaterThan(3);
    expect(par.en.length, 'journal anglais vide').toBeGreaterThan(3);

    for (const [bouton, langue] of [
      ['btn-fr', 'fr'],
      ['btn-en', 'en'],
    ] as const) {
      document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
      const lignes = [...document.querySelectorAll('#journal li')];
      // LA BORNE : quatre lignes, ni trois ni cinq.
      expect(lignes.length, `${langue} : le journal ne montre pas 4 lignes`).toBe(4);

      const attendus = new Set(par[langue].map((e) => e.t));
      const etrangeres = lignes
        .map((li) => li.querySelector('.msg')?.textContent?.trim() ?? '')
        .filter((t) => !attendus.has(t));
      expect(
        etrangeres.slice(0, 3),
        `${langue} : ces lignes ne viennent pas du journal ${langue.toUpperCase()}`,
      ).toEqual([]);
    }
  });

  it('« COPIER LA COMMANDE » CONFIRME, PUIS REVIENT AU REPOS, DANS LA BONNE LANGUE', async () => {
    // ─── LES DEUX DERNIERS LIBELLÉS NUS ────────────────────────────────────
    //
    //     lbl.textContent = lang === 'en' ? 'copied ✓' : 'copié ✓';
    //     lbl.textContent = (lang === 'en' ? EN : FR)['rc.copier'];
    //
    // Le second est le RETOUR AU REPOS, 1800 ms après le clic. Le code porte
    // même un commentaire disant qu'il repasse par le dictionnaire « pour que le
    // libellé revienne dans la langue COURANTE » — une intention qu'aucun banc
    // ne vérifiait, faute de faire avancer le temps.
    const en = dictionnaireAnglais();
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    try {
      for (const [bouton, confirme, repos] of [
        ['btn-fr', 'copié ✓', 'fr'],
        ['btn-en', 'copied ✓', 'en'],
      ] as const) {
        document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
        const btn = document.querySelector('.rc-copier');
        const lbl = btn?.querySelector('span');
        btn?.dispatchEvent(new Event('click', { bubbles: true }));
        // ─── LES HORLOGES FACTICES NE GÈLENT PAS LES PROMESSES ────────────
        //
        // La confirmation n'arrive qu'une fois la promesse du presse-papier
        // tenue, et une promesse se résout en MICRO-TÂCHE :
        // `advanceTimersByTime(0)` n'y touche pas. Première rédaction de ce
        // banc : rouge sur source saine, « attendu copié ✓, reçu Copier la
        // commande ». C'était le montage, pas la page.
        await Promise.resolve();
        await Promise.resolve();
        expect(lbl?.textContent, `${bouton} : confirmation attendue`).toBe(confirme);

        // ET LE RETOUR AU REPOS, que personne ne regardait.
        vi.advanceTimersByTime(1800);
        const attendu = repos === 'en' ? (en['rc.copier'] as string) : 'Copier la commande';
        expect(lbl?.textContent, `${bouton} : retour au repos attendu`).toBe(attendu);
      }
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.useRealTimers();
    }
  });

  it('LE BOUTON D’INSTALLATION REVIENT AU REPOS DANS LA BONNE LANGUE', async () => {
    // Le pendant du retour au repos de `rc-copier`, sur le bouton de la barre
    // d'installation : `lang === 'en' ? 'copy' : 'copier'`, 1800 ms après le
    // clic. Nu jusqu'ici — un francophone voyait « copy » revenir.
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    try {
      for (const [bouton, repos] of [
        ['btn-fr', 'copier'],
        ['btn-en', 'copy'],
      ] as const) {
        document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
        const b = document.getElementById('install-copier');
        b?.dispatchEvent(new Event('click', { bubbles: true }));
        // Micro-tâches d'abord, minuteurs ensuite (§ 9 nonagies).
        await Promise.resolve();
        await Promise.resolve();
        vi.advanceTimersByTime(1800);
        expect(b?.textContent, `${bouton} : retour au repos attendu`).toBe(repos);
      }
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
      vi.useRealTimers();
    }
  });

  it('LE RAIL DE L’APERÇU ALLUME L’ÉCRAN CHOISI — un seul, et le bon', () => {
    // ─── CE QUE LE BANC DES ONGLETS NE REGARDAIT PAS ───────────────────────
    //
    //     if (r.getAttribute('data-ecran-rail') === cle) r.setAttribute('data-vif', '');
    //
    // Le banc de la bascule d'écran vérifie `aria-selected` sur l'onglet et
    // `hidden` sur le corps. Le RAIL — le repère latéral qui dit où l'on est —
    // n'était vérifié par rien : muté, il s'allume sur tous les écrans SAUF
    // celui qu'on regarde.
    const onglets = [...document.querySelectorAll('.apercu-onglet')];
    expect(onglets.length, 'aucun onglet d’aperçu').toBeGreaterThan(1);

    for (const onglet of onglets) {
      const cle = onglet.getAttribute('data-ecran');
      onglet.dispatchEvent(new Event('click', { bubbles: true }));
      const allumes = [...document.querySelectorAll('[data-ecran-rail]')]
        .filter((r) => r.hasAttribute('data-vif'))
        .map((r) => r.getAttribute('data-ecran-rail'));
      expect(allumes, `écran « ${cle ?? '?'} » : le rail n’allume pas exactement le bon`).toEqual([
        cle,
      ]);
    }
  });

  it('LE COMPTEUR D’ÉTOILES N’ÉCRIT QUE DES NOMBRES — et rien du tout sinon', async () => {
    // ─── LES DEUX DERNIÈRES GARDES DU BALAYAGE, ET UNE SEULE ENTRÉE LES TUE ─
    //
    //     if (j && typeof j.stargazers_count === 'number') {
    //
    // Deux mutants y survivaient : `===` → `!==` et `&&` → `||`. Une réponse
    // SANS `stargazers_count` les départage tous les deux d'un coup :
    //
    //   · l'original n'écrit rien — le libellé statique reste ;
    //   · avec `!==`, la garde s'inverse et le corps écrit « undefined » ;
    //   · avec `||`, `j` truthy court-circuite et le corps écrit « undefined ».
    //
    // Un visiteur verrait « undefined ★ » sur la première page du produit.
    //
    // `fetch` est une frontière externe : on l'INJECTE, on ne la simule pas à
    // moitié. Aucune requête ne part.
    const avantFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    async function monterAvecReponse(corps: unknown, ok = true): Promise<string> {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: () => Promise.resolve({ ok, json: () => Promise.resolve(corps) }),
      });
      document.documentElement.innerHTML = VITRINE.replace(/^[\s\S]*?<html[^>]*>/, '').replace(
        /<\/html>[\s\S]*$/,
        '',
      );
      const principal = scriptsExecutes(VITRINE).reduce((a, b) =>
        a.code.length > b.code.length ? a : b,
      );
      new Function(principal.code)();
      // Deux promesses enchaînées (`.then().then()`) : on vide assez de
      // micro-tâches pour que l'écriture ait eu lieu si elle doit avoir lieu.
      for (let i = 0; i < 6; i++) await Promise.resolve();
      return document.querySelector('#gh-btn .gh-nb')?.textContent ?? '';
    }

    try {
      // 1. Une réponse SAINE : le compte s'affiche.
      expect(await monterAvecReponse({ stargazers_count: 1234 }), 'le compte ne s’écrit pas').toBe(
        '1234',
      );

      // 2. L'ENTRÉE QUI TRANCHE : pas de `stargazers_count`.
      const sansCompte = await monterAvecReponse({});
      expect(sansCompte, 'une réponse sans compte a quand même écrit').not.toContain('undefined');
      expect(sansCompte, 'une réponse sans compte a quand même écrit').not.toBe('NaN');

      // 3. Et une réponse refusée n'écrit rien non plus.
      const refusee = await monterAvecReponse(null, false);
      expect(refusee, 'une réponse refusée a quand même écrit').not.toContain('undefined');
    } finally {
      if (avantFetch) Object.defineProperty(globalThis, 'fetch', avantFetch);
      else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'fetch');
    }
  });

  /** Une puce de système, retrouvée par son libellé. */
  function puce(libelle: string): HTMLElement | undefined {
    return [...document.querySelectorAll('.chip-os')].find((b) =>
      (b.textContent ?? '').includes(libelle),
    ) as HTMLElement | undefined;
  }

  it('LA PUCE OS BASCULE LA COMMANDE À COPIER — Windows n’est pas Linux', () => {
    // ─── LA PREMIÈRE ACTION D'UN ARRIVANT ─────────────────────────────────
    //
    // Il clique SA puce pour copier LA bonne commande. `site.test.ts` verrouille
    // les DONNÉES de chaque puce (sa commande, sa note, son invite) ; il ne peut
    // pas voir que le CLIC les met vraiment dans la barre, parce qu'il lit le
    // HTML comme du texte. Ici la page est MONTÉE et le script LANCÉ : on clique,
    // et on regarde ce qui s'affiche — donc ce qui sera copié, la barre lisant le
    // nœud qu'elle montre.
    //
    // Ce qu'un `choisirPuce` cassé produirait : un arrivant Windows copiant la
    // commande POSIX (`curl … | sh`) dans PowerShell, et une installation qui
    // échoue à la toute première ligne, sans qu'aucun banc ne rougisse.
    const cmd = () => document.getElementById('install-cmd')?.textContent ?? '';
    const invite = () => document.getElementById('install-invite')?.textContent ?? '';
    const win = puce('Windows');
    const unix = puce('Linux · macOS');
    expect(win && unix, 'les puces Windows et Linux·macOS doivent exister').toBeTruthy();

    win?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(cmd(), 'la puce Windows sert la commande PowerShell').toContain('install.ps1');
    expect(cmd(), 'et jamais la commande POSIX en même temps').not.toContain('install.sh');
    expect(invite(), 'PowerShell s’annonce par « > », jamais « $ »').toBe('>');
    expect(win?.getAttribute('aria-pressed'), 'la puce cliquée est enfoncée').toBe('true');
    expect(unix?.getAttribute('aria-pressed'), 'l’autre est relâchée').toBe('false');

    unix?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(cmd(), 'la puce Linux·macOS sert la commande POSIX').toContain('install.sh');
    expect(invite(), 'un shell POSIX s’annonce par « $ »').toBe('$');
    expect(unix?.getAttribute('aria-pressed'), 'la puce cliquée est enfoncée').toBe('true');
    expect(win?.getAttribute('aria-pressed'), 'l’autre est relâchée').toBe('false');
  });

  it('LE BOUTON « COPIER » MET AU PRESSE-PAPIER LA COMMANDE AFFICHÉE, ET CONFIRME', async () => {
    // ─── LE GESTE QUI SUIT LE CHOIX DE LA PUCE ────────────────────────────
    //
    // L'arrivant a choisi sa puce ; il clique « copier » et colle dans son
    // terminal. Ce qui compte n'est pas que LA BARRE montre la bonne commande
    // (la puce s'en charge, éprouvé au banc d'au-dessus) mais que le CLIC prenne
    // CELLE-LÀ — la commande VIVE, pas une figée dans le code. Un « copier » qui
    // enverrait la POSIX pendant que la barre montre PowerShell ferait coller
    // `curl … | sh` dans PowerShell : un geste réussi EN APPARENCE (le bouton
    // dit quand même « copié ✓ ») dont la première ligne échoue chez l'arrivant.
    //
    // Le presse-papier est une frontière externe qu'on INJECTE plutôt que de
    // simuler — happy-dom n'en a pas. `copier` s'en sert s'il existe : c'est le
    // chemin d'un vrai navigateur, et `writeText` capture la chaîne au moment
    // MÊME de l'appel (avant que sa promesse tienne).
    let capture: string | null = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (s: string) => {
          capture = s;
          return Promise.resolve();
        },
      },
    });
    try {
      puce('Windows')?.dispatchEvent(new Event('click', { bubbles: true }));
      const affichee = document.getElementById('install-cmd')?.textContent ?? '';
      const bouton = document.getElementById('install-copier');
      const avant = bouton?.textContent ?? '';
      bouton?.dispatchEvent(new Event('click', { bubbles: true }));

      expect(capture, 'le clic de copie n’a rien mis au presse-papier').not.toBeNull();
      expect(capture, 'la commande copiée est bien celle de Windows').toContain('install.ps1');
      expect(capture, 'et jamais la POSIX en même temps').not.toContain('install.sh');
      // La barre et le presse-papier ne divergent pas : c'est LA commande
      // affichée qui part, aux espaces près (le bouton replie le multi-ligne).
      expect(capture, 'le presse-papier suit la barre').toBe(affichee.trim().replace(/\s+/g, ' '));

      // La confirmation n'est due qu'à une copie RÉELLE (la promesse a tenu) :
      // « copié ✓ » sur un presse-papier vide ferait coller du vide.
      await Promise.resolve();
      await Promise.resolve();
      expect(bouton?.textContent, 'le bouton confirme la copie').toContain('✓');
      expect(bouton?.textContent, 'et le libellé a bien changé').not.toBe(avant);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('LA CONFIRMATION DE COPIE EST DANS LA LANGUE DE LA PAGE', async () => {
    // ─── CE QUE LE BALAYAGE A TROUVÉ NU ────────────────────────────────────
    //
    //     btnInstall.textContent = lang === 'en' ? 'copied ✓' : 'copié ✓';
    //
    // Le banc au-dessus assène `toContain('✓')` et « le libellé a changé ». Les
    // DEUX branches portent le ✓ et diffèrent du libellé d'origine : le mutant
    // `===` → `!==` y survit intact, et un anglophone lirait « copié ✓ ».
    // C'est le § 9 nonagies encore — une assertion de forme ne départage pas.
    // On COLLECTE au lieu de remettre à zéro : « une copie de plus à ce tour »
    // est plus strict que « la dernière capture n'est pas nulle », et ça évite
    // une affectation que rien ne relit.
    const captures: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          captures.push(t);
          return Promise.resolve();
        },
      },
    });
    try {
      const cas = [
        ['btn-fr', 'copié ✓'],
        ['btn-en', 'copied ✓'],
      ] as const;
      for (const [i, [bouton, attendu]] of cas.entries()) {
        document.getElementById(bouton)?.dispatchEvent(new Event('click', { bubbles: true }));
        const b = document.getElementById('install-copier');
        b?.dispatchEvent(new Event('click', { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
        expect(captures.length, `${bouton} : ce clic n’a rien copié`).toBe(i + 1);
        expect(b?.textContent, `confirmation attendue « ${attendu} »`).toBe(attendu);
      }
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('UN PRESSE-PAPIER SANS `writeText` REPLIE — il n’explose pas', () => {
    // ─── L'AUTRE SURVIVANT DU MÊME GESTE ───────────────────────────────────
    //
    //     if (navigator.clipboard && navigator.clipboard.writeText) {
    //
    // Le banc voisin injecte un presse-papier COMPLET : `&&` et `||` y prennent
    // la même branche, donc le mutant survit. L'entrée qui les départage est un
    // navigateur où `clipboard` EXISTE mais `writeText` NON — contexte non
    // sécurisé, vieux Safari, Firefox sans le drapeau. Avec `&&` la page replie
    // sur le `textarea` + `execCommand` ; avec `||` elle appelle une fonction
    // qui n'existe pas.
    //
    // L'observable est donc « le repli a-t-il tourné », pas « ça a jeté » : une
    // exception dans un écouteur d'événement ne remonte pas au `dispatchEvent`.
    let repliJoue = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {}, // il existe, il ne sait pas écrire
    });
    const execAvant = (document as unknown as { execCommand?: unknown }).execCommand;
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        repliJoue = true;
        return true;
      },
    });
    try {
      document
        .getElementById('install-copier')
        ?.dispatchEvent(new Event('click', { bubbles: true }));
      expect(repliJoue, 'le repli n’a pas tourné : la copie est perdue en silence').toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
      if (execAvant === undefined) Reflect.deleteProperty(document, 'execCommand');
      else Object.defineProperty(document, 'execCommand', { configurable: true, value: execAvant });
    }
  });

  it('LES DEUX BOUTONS DE LANGUE S’ANNONCENT, ET JAMAIS LES DEUX ENSEMBLE', () => {
    // Le balayage a nommé nu `String(lang === 'fr')` sur le bouton FR. Muté, les
    // deux boutons annoncent le même état à un lecteur d'écran — qui n'a plus
    // aucun moyen de savoir quelle langue est active.
    for (const [clic, presse, relache] of [
      ['btn-fr', 'btn-fr', 'btn-en'],
      ['btn-en', 'btn-en', 'btn-fr'],
    ] as const) {
      document.getElementById(clic)?.dispatchEvent(new Event('click', { bubbles: true }));
      expect(
        document.getElementById(presse)?.getAttribute('aria-pressed'),
        `${clic} : ${presse} devrait s’annoncer pressé`,
      ).toBe('true');
      expect(
        document.getElementById(relache)?.getAttribute('aria-pressed'),
        `${clic} : ${relache} devrait s’annoncer relâché`,
      ).toBe('false');
    }
  });

  it('« OUVRIR MA RUCHE » : CHAQUE BOUTON COPIE SA PROPRE COMMANDE, ET CONFIRME', async () => {
    // La section « Ouvrir ma ruche » offre plusieurs gestes (github, invite,
    // installer-et-lancer) ; chacun a SA commande, dans son `data-cmd`. Un
    // handler qui copierait une commande FIXE — ou toujours celle du premier
    // bouton — enverrait le nouveau venu lancer le mauvais geste, et le bouton
    // dirait quand même « copié ✓ ». Comme la barre d'installation, le
    // presse-papier est INJECTÉ, pas simulé.
    let capture: string | null = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (s: string) => {
          capture = s;
          return Promise.resolve();
        },
      },
    });
    try {
      const boutons = [...document.querySelectorAll('.rc-copier')] as HTMLElement[];
      expect(
        boutons.length,
        'la section « Ouvrir ma ruche » offre plusieurs copies',
      ).toBeGreaterThan(1);
      const vues = new Set<string>();
      for (const b of boutons) {
        const attendu = b.getAttribute('data-cmd') ?? '';
        expect(attendu, 'un bouton de copie sans commande').not.toBe('');
        b.dispatchEvent(new Event('click', { bubbles: true }));
        expect(capture, 'le bouton n’a pas copié SA commande').toBe(attendu);
        // La confirmation vit dans le libellé DE CE bouton, pas d'un autre.
        await Promise.resolve();
        await Promise.resolve();
        expect(b.querySelector('span')?.textContent, 'ce bouton-ci confirme la copie').toContain(
          '✓',
        );
        vues.add(attendu);
      }
      // Chaque bouton a bien sa PROPRE commande — sinon « copie la sienne » ne
      // veut rien dire.
      expect(vues.size, 'deux boutons copient la même commande').toBe(boutons.length);
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  /** Un onglet d'aperçu, retrouvé par l'écran qu'il désigne. */
  function onglet(ecran: string): HTMLElement | null {
    return document.querySelector(`.apercu-onglet[data-ecran="${ecran}"]`);
  }
  /** Le corps de l'écran désigné. */
  function corps(ecran: string): HTMLElement | null {
    return document.querySelector(`[data-ecran-corps="${ecran}"]`);
  }

  it('L’APERÇU CHANGE D’ÉCRAN AU CLIC — l’onglet choisi s’allume, son écran se montre', () => {
    // Même patron que les puces de système : un visiteur qui veut voir « Les
    // ordinateurs » clique l'onglet, et doit tomber DESSUS — pas rester sur
    // « Les tâches ». `site.test.ts` verrouille les DONNÉES des onglets ; ici on
    // MONTE la page et on CLIQUE, en éprouvant les DEUX sens pour ne rien
    // supposer de l'écran de départ (la moitié des visiteurs arrive autrement).
    const taches = onglet('taches');
    const ordis = onglet('ordinateurs');
    expect(
      taches && ordis,
      'les onglets « taches » et « ordinateurs » doivent exister',
    ).toBeTruthy();

    ordis?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(ordis?.getAttribute('aria-selected'), 'l’onglet cliqué s’allume').toBe('true');
    expect(taches?.getAttribute('aria-selected'), 'l’onglet d’avant s’éteint').toBe('false');
    expect(corps('ordinateurs')?.hidden, 'l’écran choisi se montre').toBe(false);
    expect(corps('taches')?.hidden, 'l’écran d’avant se cache').toBe(true);

    taches?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(taches?.getAttribute('aria-selected'), 'le retour rallume le premier').toBe('true');
    expect(ordis?.getAttribute('aria-selected'), 'et éteint le second').toBe('false');
    expect(corps('taches')?.hidden, 'son écran revient').toBe(false);
    expect(corps('ordinateurs')?.hidden, 'l’autre se cache').toBe(true);
  });

  /** Un lien « Ouvrir ma ruche », retrouvé par la vue qu'il vise. */
  function rcLien(vue: string): HTMLElement | null {
    return document.querySelector(`.rc-lien[data-vue="${vue}"]`);
  }
  /** Saisit une adresse dans le champ et déclenche la mise à jour des liens. */
  function saisirAdresse(valeur: string): void {
    const champ = document.getElementById('rc-url') as HTMLInputElement | null;
    if (champ) {
      champ.value = valeur;
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  it('« OUVRIR MA RUCHE » COMPOSE LE LIEN — et n’en laisse jamais un MORT', () => {
    // Le port se règle, une ruche prêtée tourne parfois sur une autre machine :
    // les liens se COMPOSENT depuis le champ. `site.test.ts` prouve qu'aucun href
    // n'est figé et que le code de composition existe ; il ne peut pas prouver
    // qu'il MARCHE. Ici on saisit une adresse, et on regarde les href.
    //
    // La règle qui décide : une adresse VIDE ⇒ AUCUN href. Un lien mort qui a
    // l'air vivant est pire qu'un bouton visiblement inactif — un visiteur
    // cliquerait dans le vide sans comprendre pourquoi.
    const projets = rcLien('#/projets');
    const racine = rcLien('');
    expect(projets && racine, 'les liens « ouvrir ma ruche » doivent exister').toBeTruthy();

    saisirAdresse('');
    expect(projets?.hasAttribute('href'), 'adresse vide ⇒ pas de lien mort').toBe(false);

    saisirAdresse('http://192.168.1.10:8080/');
    expect(projets?.getAttribute('href'), 'le lien vise la machine SAISIE, slash de fin ôté').toBe(
      'http://192.168.1.10:8080#/projets',
    );
    expect(racine?.getAttribute('href'), 'la racine mène à l’adresse nue').toBe(
      'http://192.168.1.10:8080',
    );
    expect(projets?.getAttribute('target'), 'la ruche s’ouvre dans un nouvel onglet').toBe(
      '_blank',
    );
  });

  it('LE LIEN OUVERT NE REND PAS LA MAIN SUR LA VITRINE — rel="noopener"', () => {
    // Un lien `target="_blank"` SANS `rel="noopener"` laisse la page qu'il OUVRE
    // (le tableau de bord de la ruche) garder une poignée `window.opener` vers la
    // vitrine, et la faire naviguer ailleurs à sa guise : c'est le « reverse
    // tabnabbing », une porte d'hameçonnage silencieuse. La composition pose bien
    // `noopener` — mais RIEN ne le gardait. Le banc voisin vérifie `_blank` (la
    // condition qui REND la faille possible) sans jamais vérifier le verrou qui la
    // ferme : ôter la seule ligne `rel` ne faisait alors rougir aucun banc.
    const projets = rcLien('#/projets');
    saisirAdresse('http://192.168.1.10:8080');
    expect(projets?.getAttribute('target'), 'le lien s’ouvre dans un nouvel onglet').toBe('_blank');
    expect(
      projets?.getAttribute('rel'),
      'un onglet ouvert par `_blank` doit couper `window.opener`',
    ).toBe('noopener');
  });
});

describe('LA LANGUE INITIALE SUIT LA PRÉFÉRENCE ENREGISTRÉE', () => {
  // Le premier contact d'un visiteur qui REVIENT : sa langue doit être celle
  // qu'il a choisie la dernière fois — rangée dans `localStorage` —, pas celle
  // de son navigateur. `site.test.ts` ne peut PAS voir cette résolution : elle
  // arrive au CHARGEMENT du script, avant tout clic. Ici on range une
  // préférence, on MONTE la page, et on regarde quelle langue elle a prise.
  //
  // Note de méthode, CORRIGÉE : cette remarque disait « la loupe ne balaie que
  // `src`, `dashboard/src`, `scripts` — jamais `site/` », et c'était vrai. Ça ne
  // l'est plus : `.html` était exclu EN BLOC de la loupe, il ne l'est plus, et
  // seul son `<script>` est mutable. Le premier balayage complet de la vitrine a
  // aussitôt rendu 43 candidates dont 33 SANS TEST — dont, précisément, la
  // branche que ce bloc-ci NE couvrait PAS : la langue du NAVIGATEUR.

  /** Monte la page dans l'état courant (query + préférence rangée) et rend la langue prise. */
  function langueAuChargement(): string {
    document.documentElement.innerHTML = VITRINE.replace(/^[\s\S]*?<html[^>]*>/, '').replace(
      /<\/html>[\s\S]*$/,
      '',
    );
    const principal = scriptsExecutes(VITRINE).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();
    // `setLang` pose `aria-pressed` sur les deux boutons de langue : c'est le
    // signe le plus direct de la langue que la page a RÉELLEMENT prise.
    return document.getElementById('btn-en')?.getAttribute('aria-pressed') === 'true' ? 'en' : 'fr';
  }

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    // Ni la query ni la préférence rangée ne doivent fuir vers les bancs voisins.
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('« en » enregistré ouvre en anglais ; « fr » ouvre en français', () => {
    // Sans la garde `saved === 'en' || saved === 'fr'`, la page retomberait sur
    // la langue du NAVIGATEUR (anglais sous happy-dom, comme Chromium) et
    // ignorerait le choix rangé — un visiteur francophone reverrait l'anglais à
    // chaque visite malgré son clic de la dernière fois.
    localStorage.setItem('hive.lang', 'en');
    expect(langueAuChargement(), 'préférence « en » ignorée au chargement').toBe('en');

    localStorage.clear();
    localStorage.setItem('hive.lang', 'fr');
    expect(langueAuChargement(), 'préférence « fr » ignorée au chargement').toBe('fr');
  });

  it('un lien partagé « ?lang=en » impose l’anglais malgré la préférence « fr » rangée', () => {
    // Le partage : quelqu'un envoie « …/?lang=en » à un ami francophone. Ce lien
    // doit s'ouvrir en anglais même si l'ami avait choisi le français la dernière
    // fois. Sans la garde `qs === 'en' || qs === 'fr'`, la query serait ignorée
    // et la page retomberait sur la préférence rangée — le partageur perdrait le
    // contrôle de la langue qu'il montre.
    localStorage.setItem('hive.lang', 'fr');
    window.history.replaceState(null, '', '/?lang=en');
    expect(langueAuChargement(), '« ?lang=en » n’a pas imposé l’anglais').toBe('en');
  });

  /** Joue `faire()` avec une langue de navigateur imposée, puis la rend. */
  function avecLangueDuNavigateur(valeur: string, faire: () => void): void {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    Object.defineProperty(window.navigator, 'language', { value: valeur, configurable: true });
    try {
      faire();
    } finally {
      if (original) Object.defineProperty(window.navigator, 'language', original);
      else Reflect.deleteProperty(window.navigator, 'language');
    }
  }

  it('SANS RIEN DE RANGÉ, c’est la langue du NAVIGATEUR qui tranche', () => {
    // ─── LA BRANCHE QUE LE BALAYAGE A TROUVÉE NUE ──────────────────────────
    //
    // Les deux bancs au-dessus éprouvent la query et la préférence rangée. La
    // TROISIÈME branche — celle qui décide pour quelqu'un qui arrive pour la
    // première fois, sans rien — n'était éprouvée par rien. Le balayage complet
    // de la vitrine a nommé ses deux gardes :
    //
    //     String(navigator.language || '')     ||  →  &&
    //     …toLowerCase().indexOf('fr') !== 0   !== →  ===
    //
    // Le premier rend `''` pour tout le monde, donc TOUS les arrivants voient
    // l'anglais, y compris avec un navigateur en français. Le second inverse la
    // règle : les francophones ont l'anglais et tous les autres le français.
    // Aucun banc ne s'en apercevait.
    const attendus: readonly (readonly [string, string])[] = [
      ['fr', 'fr'],
      ['fr-FR', 'fr'],
      ['fr-CA', 'fr'],
      ['en-US', 'en'],
      ['de-DE', 'en'],
      ['', 'en'],
    ];
    const rendus: string[] = [];
    for (const [navigateur, attendu] of attendus) {
      avecLangueDuNavigateur(navigateur, () => {
        // ─── LE PIÈGE DU MONTAGE, MESURÉ ───────────────────────────────────
        //
        // La page RANGE sa langue au chargement. Sans ce vidage, le premier
        // tour (« fr ») écrivait `hive.lang=fr`, et les cinq suivants lisaient
        // une PRÉFÉRENCE au lieu de la langue du navigateur : tout le tableau
        // rendait « fr », y compris `en-US`. Le banc accusait la page d'un
        // défaut qui était le sien.
        localStorage.clear();
        const pris = langueAuChargement();
        rendus.push(`${navigateur || '(vide)'} → ${pris} (attendu ${attendu})`);
      });
    }
    const ecarts = attendus
      .map(([navigateur, attendu], i) => ({ navigateur, attendu, ligne: rendus[i] ?? '' }))
      .filter(({ ligne, attendu }) => !ligne.includes(`→ ${attendu} `));
    expect(
      ecarts.map((e) => e.ligne),
      'la langue du navigateur n’est pas respectée au premier contact',
    ).toEqual([]);
  });

  it('« ?lang=fr » impose le français malgré la préférence « en » rangée', () => {
    // La symétrie : le lien prime dans les deux sens. Un francophone qui partage
    // « …/?lang=fr » impose sa langue à un visiteur dont la dernière visite était
    // en anglais.
    localStorage.setItem('hive.lang', 'en');
    window.history.replaceState(null, '', '/?lang=fr');
    expect(langueAuChargement(), '« ?lang=fr » n’a pas imposé le français').toBe('fr');
  });
});

// ─── ET LA SECONDE PAGE, PARCE QUE LE BALAYAGE L'A NOMMÉE AUSSI ──────────────
//
// Le balayage complet de `site/` a rendu le MÊME survivant sur
// `site/presentation/index.html` : son dictionnaire s'inverse sans qu'un banc
// bronche. N'en garder qu'une des deux aurait été refaire, le soir même, la
// faute que § 9 nonoctogies vient de consigner — garder les endroits où le
// défaut a été TROUVÉ plutôt que ceux où il peut VIVRE.
//
// La page de présentation n'a pas d'attribut traduit (`data-i18n-attr` : 0) ;
// la garde le constate au lieu de l'exiger, sans quoi elle rougirait sur une
// page parfaitement saine.

// ─── ET CETTE LISTE-CI ÉTAIT ÉCRITE À LA MAIN, UNE HEURE PLUS TÔT ───────────
//
// Elle a nommé `site/index.html` et `site/presentation/index.html` : les deux
// pages que le balayage avait rendues à ce moment-là. Le balayage a fini, et il
// en a nommé une TROISIÈME — `site/rush/index.html`, 115 éléments traduits, 9
// survivants — qui serait restée dehors.
//
// C'est le § 9 nonoctogies commis DANS le geste qui le consignait : le
// périmètre de l'incident, pas celui du risque. La leçon ne dit pas « faire
// attention » ; elle dit NE PAS LISTER.
//
// Le critère est ici sans ambiguïté, contrairement au cas des installeurs : une
// page traduite est une page qui porte un dictionnaire `var EN = {` ET les deux
// boutons de langue. Pas d'exception à border.

function pagesTraduites(): string[] {
  const trouvees: string[] = [];
  const marcher = (dossier: string): void => {
    for (const e of readdirSync(path.resolve(process.cwd(), dossier), { withFileTypes: true })) {
      const rel = `${dossier}/${e.name}`;
      if (e.isDirectory()) marcher(rel);
      else if (/\.html?$/i.test(e.name)) {
        const src = readFileSync(path.resolve(process.cwd(), rel), 'utf8');
        if (src.includes('var EN = {') && src.includes('id="btn-en"')) trouvees.push(rel);
      }
    }
  };
  marcher('site');
  return trouvees.sort();
}

const PAGES_TRADUITES = pagesTraduites();

describe('CHAQUE PAGE TRADUITE APPLIQUE LE DICTIONNAIRE QU’ELLE ANNONCE', () => {
  it('la découverte trouve les pages connues — sinon elle ne garde rien', () => {
    // Une découverte qui ne ramènerait rien rendrait tout ce bloc vert à vide :
    // le défaut qu'on ferme, reproduit un cran plus haut.
    expect(PAGES_TRADUITES).toEqual([
      'site/index.html',
      'site/presentation/index.html',
      'site/rush/index.html',
    ]);
  });

  it.each(PAGES_TRADUITES)('%s', (chemin) => {
    const source = readFileSync(path.resolve(process.cwd(), chemin), 'utf8');
    document.documentElement.innerHTML = source
      .replace(/^[\s\S]*?<html[^>]*>/, '')
      .replace(/<\/html>[\s\S]*$/, '');
    const principal = scriptsExecutes(source).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();

    const en = dictionnaireAnglais(source);
    const normaliser = (html: string): string => {
      const bac = document.createElement('div');
      bac.innerHTML = html;
      return bac.innerHTML.trim();
    };

    const anglais = (cle: string | null | undefined): string | undefined => {
      if (cle == null) return undefined;
      const v = en[cle];
      return typeof v === 'string' && v.trim() !== '' ? v : undefined;
    };
    const porteuses = [...document.querySelectorAll('[data-i18n]')].filter(
      (el) => anglais(el.getAttribute('data-i18n')) !== undefined,
    );
    expect(porteuses.length, `${chemin} : aucun élément traduit`).toBeGreaterThan(5);

    document.getElementById('btn-en')?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(
      document.getElementById('btn-en')?.getAttribute('aria-pressed'),
      `${chemin} : le bouton EN ne s’annonce pas pressé`,
    ).toBe('true');

    const menteuses = porteuses
      .filter(
        (el) =>
          normaliser(el.innerHTML) !==
          normaliser(en[el.getAttribute('data-i18n') as string] as string),
      )
      .map((el) => el.getAttribute('data-i18n'));
    expect(
      menteuses.slice(0, 5),
      `${chemin} : annonce l’anglais et affiche autre chose (${String(menteuses.length)})`,
    ).toEqual([]);
  });
});

// ─── LA MÊME MACHINERIE, TROIS FOIS — ET DEUX FOIS SANS GARDE ────────────────
//
// Le balayage complet a nommé, sur `presentation` et `rush`, EXACTEMENT les
// mêmes gardes que sur l'accueil : le tri `?lang=` > préférence > navigateur, et
// l'`aria-pressed` des deux boutons. Les bancs écrits jusqu'ici ne montaient que
// `site/index.html` ; les deux autres pages portaient la même logique, non
// gardée.
//
// Ce n'est pas une découverte de plus : c'est la MÊME (§ 9 nonoctogies), et
// cette fois elle est prise en compte AVANT d'écrire plutôt qu'après. Le banc
// tourne sur les pages DÉCOUVERTES, pas sur une liste.
//
// Une nuance mesurée : `rush` écrit `(navigator.language || '').slice(0, 2) !==
// 'fr'` là où les deux autres écrivent `.toLowerCase().indexOf('fr') !== 0`. Les
// deux disent la même règle, et le tableau ci-dessous ne suppose ni l'une ni
// l'autre — il n'observe que la langue PRISE.

describe.each(PAGES_TRADUITES)('%s — le tri des trois sources de langue', (chemin) => {
  const source = readFileSync(path.resolve(process.cwd(), chemin), 'utf8');

  /** Monte la page dans l'état courant et rend la langue qu'elle a prise. */
  function languePrise(): string {
    document.documentElement.innerHTML = source
      .replace(/^[\s\S]*?<html[^>]*>/, '')
      .replace(/<\/html>[\s\S]*$/, '');
    const principal = scriptsExecutes(source).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();
    return document.getElementById('btn-en')?.getAttribute('aria-pressed') === 'true' ? 'en' : 'fr';
  }

  /** Remet à zéro TOUT ce que la page écrit — sans quoi un cas empoisonne le suivant. */
  function neuf(query = '', range: string | null = null): void {
    localStorage.clear();
    window.history.replaceState(null, '', query === '' ? '/' : `/?${query}`);
    if (range !== null) localStorage.setItem('hive.lang', range);
  }

  afterEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('le lien partagé « ?lang= » prime sur tout le reste', () => {
    for (const [q, range, attendu] of [
      ['lang=en', 'fr', 'en'],
      ['lang=fr', 'en', 'fr'],
    ] as const) {
      neuf(q, range);
      expect(languePrise(), `${chemin} : ?${q} ignoré malgré « ${range} » rangé`).toBe(attendu);
    }
  });

  it('sans query, la PRÉFÉRENCE rangée décide', () => {
    for (const range of ['en', 'fr']) {
      neuf('', range);
      expect(languePrise(), `${chemin} : préférence « ${range} » ignorée`).toBe(range);
    }
  });

  it('sans query ni préférence, c’est la langue du NAVIGATEUR', () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    try {
      for (const [navigateur, attendu] of [
        ['fr-FR', 'fr'],
        ['en-US', 'en'],
        ['de-DE', 'en'],
      ] as const) {
        Object.defineProperty(window.navigator, 'language', {
          value: navigateur,
          configurable: true,
        });
        neuf();
        expect(languePrise(), `${chemin} : navigateur « ${navigateur} »`).toBe(attendu);
      }
    } finally {
      if (original) Object.defineProperty(window.navigator, 'language', original);
      else Reflect.deleteProperty(window.navigator, 'language');
    }
  });

  it('les deux boutons s’annoncent, et jamais ensemble', () => {
    neuf();
    languePrise();
    for (const [clic, presse, relache] of [
      ['btn-fr', 'btn-fr', 'btn-en'],
      ['btn-en', 'btn-en', 'btn-fr'],
    ] as const) {
      document.getElementById(clic)?.dispatchEvent(new Event('click', { bubbles: true }));
      expect(
        document.getElementById(presse)?.getAttribute('aria-pressed'),
        `${chemin} · ${clic} : ${presse} devrait être pressé`,
      ).toBe('true');
      expect(
        document.getElementById(relache)?.getAttribute('aria-pressed'),
        `${chemin} · ${clic} : ${relache} devrait être relâché`,
      ).toBe('false');
    }
  });
});

// ─── LA GARDE DE CAPACITÉ, ET SON REPLI QUE PERSONNE N'EXERÇAIT ──────────────
//
//     if (typeof ResizeObserver === 'function') {
//       new ResizeObserver(publierHauteur).observe(entete);
//     } else {
//       window.addEventListener('resize', publierHauteur);
//     }
//
// Même famille que la garde du presse-papier : tant que le banc offre TOUJOURS
// un navigateur qui sait, les deux branches sont indiscernables et le mutant
// passe pour équivalent. Ce qui départage, c'est un navigateur qui NE SAIT PAS.
//
// `--h-entete` porte la hauteur de l'en-tête collante ; si elle cesse d'être
// republiée, le contenu passe sous la barre au premier redimensionnement.

describe.each(
  PAGES_TRADUITES.filter((p) =>
    readFileSync(path.resolve(process.cwd(), p), 'utf8').includes('ResizeObserver'),
  ),
)('%s — la hauteur d’en-tête survit à un navigateur sans ResizeObserver', (chemin) => {
  const source = readFileSync(path.resolve(process.cwd(), chemin), 'utf8');

  function monter(): void {
    document.documentElement.innerHTML = source
      .replace(/^[\s\S]*?<html[^>]*>/, '')
      .replace(/<\/html>[\s\S]*$/, '');
    const principal = scriptsExecutes(source).reduce((a, b) =>
      a.code.length > b.code.length ? a : b,
    );
    new Function(principal.code)();
  }

  it('sans ResizeObserver, la page monte quand même ET replie sur « resize »', () => {
    const avant = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'ResizeObserver');
    try {
      // Le mutant `!==` construirait un `ResizeObserver` qui n'existe pas : le
      // montage entier jetterait, et la page serait morte pour ce visiteur.
      expect(() => {
        monter();
      }, 'la page ne monte pas sans ResizeObserver').not.toThrow();

      document.documentElement.style.removeProperty('--h-entete');
      window.dispatchEvent(new Event('resize'));
      expect(
        document.documentElement.style.getPropertyValue('--h-entete'),
        'le repli « resize » ne republie pas la hauteur d’en-tête',
      ).not.toBe('');
    } finally {
      if (avant) Object.defineProperty(globalThis, 'ResizeObserver', avant);
    }
  });

  it('avec ResizeObserver, la page l’OBSERVE vraiment', () => {
    // L'autre moitié : sans elle, un mutant qui prendrait toujours le repli
    // passerait — la page marcherait, en moins bien, sans que rien le dise.
    const observes: unknown[] = [];
    const avant = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe(cible: unknown): void {
          observes.push(cible);
        }
        unobserve(): void {}
        disconnect(): void {}
      },
    });
    try {
      monter();
      expect(observes.length, 'ResizeObserver existe mais la page ne s’en sert pas').toBe(1);
    } finally {
      if (avant) Object.defineProperty(globalThis, 'ResizeObserver', avant);
      else
        Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, 'ResizeObserver');
    }
  });
});
