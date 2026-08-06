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

import { readFileSync } from 'node:fs';
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
function dictionnaireAnglais(): Record<string, unknown> {
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
