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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  // Note de méthode : la loupe ne balaie que `src`, `dashboard/src`, `scripts` —
  // jamais `site/`. Les gardes du JavaScript de la vitrine (celle-ci comprise)
  // sont donc un angle mort qu'aucun balayage automatique ne couvre ; elles ne
  // tiennent que par des bancs comme celui-ci.

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
