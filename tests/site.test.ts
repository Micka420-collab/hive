// Test de garde des pages du site (site/index.html et site/rush/index.html).
//
// Ces pages sont du HTML autonome, sans build ni framework : rien ne les
// typecheck, rien ne les lint au-delà du formatage. Une clé de traduction
// oubliée, une fonte repartie chez Google, un bouton pointant vers un
// formulaire supprimé — tout cela passerait la CI et n'apparaîtrait qu'en
// production, sur les seules pages que voient les gens qui découvrent le projet.
//
// Ce fichier ne teste donc pas un comportement : il VERROUILLE les propriétés
// des pages qu'on ne peut pas se permettre de perdre par inadvertance. Les
// gardes communes tournent sur CHAQUE page (describe.each) pour qu'une page
// ajoutée demain hérite du filet sans qu'on ait à y penser.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Une page du site, avec la profondeur qui préfixe ses chemins relatifs. */
interface Page {
  nom: string;
  html: string;
  /** Préfixe des URL relatives vers site/ (« » à la racine, « ../ » dans rush/). */
  prefixe: string;
  /** Le dossier QUI CONTIENT la page — c'est lui qui résout ses chemins relatifs. */
  dossier: string;
}

const PAGES: Page[] = [
  {
    nom: 'vitrine',
    html: readFileSync(new URL('../site/index.html', import.meta.url), 'utf8'),
    prefixe: '',
    dossier: 'site/',
  },
  {
    nom: 'rush',
    html: readFileSync(new URL('../site/rush/index.html', import.meta.url), 'utf8'),
    prefixe: '../',
    dossier: 'site/rush/',
  },
  {
    nom: 'présentation',
    html: readFileSync(new URL('../site/presentation/index.html', import.meta.url), 'utf8'),
    prefixe: '../',
    dossier: 'site/presentation/',
  },
];

const vitrine = PAGES[0]?.html ?? '';
const rush = PAGES[1]?.html ?? '';

// ─── LES GARDES QUI NE VALENT QUE POUR CERTAINES PAGES ───────────────────────
//
// Les gardes communes (bilinguisme, vie privée, ressources) valent pour TOUTE
// page. D'autres décrivent un ORGANE que toutes n'ont pas : un en-tête collant,
// un bouton qui ouvre un formulaire d'issue. La présentation imprimable n'a ni
// l'un ni l'autre — c'est un document, pas une page de navigation.
//
// Les exiger partout accuserait une page de ne pas être une autre. On filtre
// donc sur la PRÉSENCE de l'organe, et un test plus bas vérifie que ces listes
// ne sont pas vides : sans lui, une régression qui supprimerait tous les
// en-têtes ferait passer la garde en la vidant.
const PAGES_FORMULAIRE = PAGES.filter((p) => /issues\/new\?template=/.test(p.html));
const PAGES_NAV = PAGES.filter((p) => p.html.includes('<header>'));

/** Le dictionnaire anglais, isolé du reste du script. */
function dictionnaireEn(html: string): string {
  const debut = html.indexOf('var EN = {');
  expect(debut, 'dictionnaire EN introuvable').toBeGreaterThan(-1);
  // Le littéral se ferme sur la première ligne « }; » à son niveau d'indentation.
  const fin = html.indexOf('\n        };', debut);
  expect(fin, 'fin du dictionnaire EN introuvable').toBeGreaterThan(debut);
  return html.slice(debut, fin);
}

/** Toutes les clés référencées par le HTML, y compris celles de data-i18n-attr. */
function clesUtilisees(html: string): Set<string> {
  const cles = new Set<string>();
  for (const m of html.matchAll(/data-i18n(?:-attr)?="([^"]+)"/g)) {
    const brut = m[1] ?? '';
    // `data-i18n-attr` porte des paires « attribut:clé », séparées par des virgules.
    if (/^[a-z-]+:/.test(brut)) {
      for (const paire of brut.split(',')) {
        const cle = paire.split(':')[1]?.trim();
        if (cle) cles.add(cle);
      }
    } else {
      cles.add(brut);
    }
  }
  return cles;
}

/** Les clés déclarées dans EN — citées ('nav.x') ou nues (skip). */
function clesTraduites(html: string): string[] {
  const dict = dictionnaireEn(html);
  return [...dict.matchAll(/^\s{10}(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

describe.each(PAGES)('page $nom — bilinguisme', ({ html }) => {
  it('chaque clé du HTML a une traduction anglaise', () => {
    const traduites = new Set(clesTraduites(html));
    const manquantes = [...clesUtilisees(html)].filter((c) => !traduites.has(c)).sort();
    expect(manquantes, `clés sans traduction EN : ${manquantes.join(', ')}`).toEqual([]);
  });

  it('aucune clé anglaise en double', () => {
    // Un doublon est silencieux en JS — la seconde écrase la première. Deux
    // valeurs divergentes donneraient un texte anglais imprévisible.
    const cles = clesTraduites(html);
    const doublons = [...new Set(cles.filter((c, i) => cles.indexOf(c) !== i))].sort();
    expect(doublons, `clés EN déclarées deux fois : ${doublons.join(', ')}`).toEqual([]);
  });

  it('aucune traduction orpheline', () => {
    // Une clé traduite mais plus référencée signale un bout de page supprimé
    // à moitié — le mort-bois d'aujourd'hui est la confusion de demain.
    const utilisees = clesUtilisees(html);
    const orphelines = clesTraduites(html)
      .filter((c) => !utilisees.has(c))
      .sort();
    expect(orphelines, `traductions inutilisées : ${orphelines.join(', ')}`).toEqual([]);
  });
});

describe.each(PAGES)('page $nom — vie privée', ({ html, prefixe }) => {
  it('ne charge aucune fonte depuis un tiers', () => {
    // Une page qui va chercher sa fonte chez Google transmet à Google l'IP de
    // chaque visiteur, sans qu'il l'ait demandé. Les fichiers sont dans le dépôt.
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(html).toMatch(/@font-face/);
  });

  it('les fichiers de fonte référencés existent', () => {
    const motif = new RegExp(`url\\('${prefixe}(fonts/[^']+\\.woff2)'\\)`, 'g');
    const refs = [...html.matchAll(motif)].map((m) => m[1]);
    expect(refs.length, 'aucune fonte auto-hébergée référencée').toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(existsSync(new URL(`../site/${ref}`, import.meta.url)), `absent : ${ref}`).toBe(true);
    }
  });

  it("n'appelle aucun tiers hors l'API GitHub publique", () => {
    // Seul appel réseau toléré : le compteur d'étoiles, en amélioration
    // progressive (la page reste entière s'il échoue).
    const appels = [...html.matchAll(/fetch\(\s*'(https?:\/\/[^']+)'/g)].map((m) => m[1] ?? '');
    for (const url of appels) {
      expect(new URL(url).host, `appel réseau inattendu : ${url}`).toBe('api.github.com');
    }
  });
});

describe('fontes — licence', () => {
  it('la SIL OFL et les avis de copyright accompagnent les fichiers', () => {
    // La OFL autorise la redistribution embarquée À CONDITION que l'avis de
    // copyright et la licence accompagnent les fichiers.
    const licence = readFileSync(new URL('../site/fonts/LICENSE.txt', import.meta.url), 'utf8');
    expect(licence).toMatch(/SIL Open Font License/);
    expect(licence).toMatch(/Space Grotesk/);
    expect(licence).toMatch(/JetBrains Mono/);
  });
});

/**
 * Un attribut HTML, quel que soit son délimiteur.
 *
 * Prettier écrit `attr="valeur"` — sauf si la valeur contient un guillemet,
 * auquel cas il bascule en `attr='valeur'`. C'est le cas de la commande
 * Windows, qui met ses chemins entre guillemets. Une garde qui n'accepte que
 * les guillemets doubles accuse alors un attribut parfaitement valide.
 */
const ATTRIBUT = (nom: string): RegExp => new RegExp(`${nom}=("[^"]+"|'[^']+')`);

/** La valeur de chaque occurrence d'un attribut dans une source. */
function valeursDe(source: string, nom: string): string[] {
  return [...source.matchAll(new RegExp(`${nom}=(?:"([^"]*)"|'([^']*)')`, 'g'))].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

/** Le label posé par un gabarit d'issue, tel que GitHub l'appliquera. */
function labelDuGabarit(fichier: string): string {
  const gabarit = readFileSync(
    new URL(`../.github/ISSUE_TEMPLATE/${fichier}`, import.meta.url),
    'utf8',
  );
  const label = gabarit.match(/labels:\s*\['([^']+)'\]/)?.[1];
  expect(label, `label absent du gabarit ${fichier}`).toBeTruthy();
  return label ?? '';
}

// ─── LES RESSOURCES QUE LE CSS VA CHERCHER ───────────────────────────────────
//
// La garde des fontes ci-dessus ne regardait QUE `fonts/*.woff2`. Le jour où la
// coulée de miel du titre est devenue un fichier (`site/miel.svg`), plus rien ne
// vérifiait son existence : le supprimer aurait laissé la CI verte et le titre
// nu, sur la seule page que voient les gens qui découvrent le projet.
//
// Une garde nommée d'après UNE ressource aurait eu le même défaut à la ressource
// suivante. Celle-ci lit les `url()` du document et exige que chacune existe —
// elle couvre donc aussi ce qu'on ajoutera demain sans y penser.
describe.each(PAGES)('page $nom — les ressources locales', ({ html, dossier }) => {
  it('chaque url() du CSS pointe vers un fichier livré', () => {
    const refs = [...html.matchAll(/url\(\s*'([^']+)'\s*\)/g)]
      .map((m) => m[1] ?? '')
      // `data:` est embarqué, `#` vise un filtre du document lui-même, et les
      // adresses absolues sont déjà couvertes par la garde « aucun tiers ».
      .filter((u) => !/^(data:|#|https?:|\/\/)/.test(u));
    expect(refs.length, 'aucune ressource locale : la garde tournerait à vide').toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      const resolu = new URL(ref, new URL(dossier, `file://${RACINE}`));
      expect(existsSync(resolu), `ressource absente : ${ref}`).toBe(true);
    }
  });
});

// ─── LE MIEL DU TITRE ────────────────────────────────────────────────────────
//
// Le surlignage du titre a été, dans l'ordre : un aplat, puis un pseudo-élément
// en position absolue, puis un fond. Les deux premiers sont morts sur le même
// défaut, et c'est lui que cette garde retient.
//
// Un élément en position absolue posé sur un INLINE QUI SE COUPE se dessine sur
// la boîte englobante de tous ses fragments. Dès que le titre passait à la ligne
// — c'est-à-dire sur tout mobile — un filet vertical reliait les deux lignes.
//
// Le correctif tient en une déclaration, `box-decoration-break: clone`, et son
// absence ne casse RIEN de visible sur un écran large : c'est exactement le
// genre de ligne qu'une retouche ultérieure supprime en croyant nettoyer.
describe('site vitrine — la coulée de miel', () => {
  const grad = /\.grad\s*\{([^}]*)\}/.exec(vitrine)?.[1] ?? '';

  it('la règle .grad existe et porte un fond', () => {
    expect(grad, 'règle .grad introuvable').not.toBe('');
    expect(grad, 'le miel n’est plus une image de fond').toMatch(/background-image:\s*url\(/);
  });

  it('le fond se recopie sur CHAQUE fragment de ligne', () => {
    // Sans le préfixe, Safari — donc l'essentiel du mobile, donc le cas où le
    // titre se coupe le plus souvent — retombe sur le défaut.
    expect(grad, 'box-decoration-break absent').toMatch(
      /(?<!-webkit-)box-decoration-break:\s*clone/,
    );
    expect(grad, 'la forme -webkit- manque : Safari garde le défaut').toMatch(
      /-webkit-box-decoration-break:\s*clone/,
    );
  });

  it('aucun pseudo-élément ne redessine le miel par-dessus', () => {
    // La cause du défaut, interdite à la racine plutôt que corrigée à chaque
    // retour : si `.grad::before` réapparaît, le filet vertical revient avec.
    expect(vitrine, '.grad::before ou ::after est de retour').not.toMatch(
      /\.grad::(?:before|after)/,
    );
  });
});

// ─── LE HAUT DE PAGE REPRIS DU DESIGN ────────────────────────────────────────
//
// Trois pièces sont arrivées ensemble : les puces de système, la barre
// d'installation, et le bandeau des agents. Chacune AFFIRME quelque chose de
// vérifiable ailleurs dans le dépôt, et c'est cela qu'on garde — pas leur
// apparence, qu'aucun test ne saurait juger.
describe('site vitrine — les puces de système et la barre', () => {
  const puces = [...vitrine.matchAll(/<button\b[\s\S]*?<\/button>/g)]
    .map((m) => m[0])
    .filter((b) => b.includes('class="chip-os"'));

  it('il y a bien des puces, et chacune porte SA commande et SA note', () => {
    expect(puces.length, 'aucune puce de système lue').toBeGreaterThan(2);
    for (const p of puces) {
      // Le délimiteur n'est pas le nôtre : Prettier bascule en apostrophes dès
      // que la valeur contient un guillemet — ce que fait la commande Windows,
      // avec ses chemins entre guillemets. Une garde qui n'accepte qu'un seul
      // délimiteur accuse un attribut parfaitement valide.
      expect(p, `puce sans commande : ${p.slice(0, 80)}`).toMatch(ATTRIBUT('data-install-cmd'));
      expect(p, `puce sans note : ${p.slice(0, 80)}`).toMatch(ATTRIBUT('data-install-note'));
    }
  });

  it('LA COMMANDE AFFICHÉE EST CELLE QU’ON COPIE — le même nœud', () => {
    // ─── POURQUOI CETTE GARDE, ET PAS « la commande est affichée » ──────────
    //
    // La garde des raccourcis exige qu'une commande copiée figure aussi dans un
    // `<code>` de la page : deux endroits, tenus d'accord. Ici on a mieux, et
    // c'est la seule chose à protéger — le script LIT le nœud affiché. Les deux
    // ne peuvent pas diverger puisqu'il n'y en a qu'un.
    //
    // Ce que ce test empêche, c'est le retour en arrière : quelqu'un remet une
    // table des commandes dans le script « pour simplifier », et la barre se
    // remet à pouvoir montrer autre chose que ce qu'elle colle.
    expect(vitrine, 'la barre n’a plus de nœud identifiable').toMatch(/id="install-cmd"/);
    expect(vitrine, 'le bouton ne lit plus le texte affiché').toMatch(
      /copier\(\s*barreCmd\.textContent/,
    );
    // Et la première commande est écrite EN DUR dans le HTML : une page dont le
    // script n'a pas tourné doit encore montrer quelque chose d'utilisable.
    const affichee = /<code id="install-cmd"\s*>([\s\S]*?)<\/code/.exec(vitrine)?.[1] ?? '';
    expect(affichee.replace(/\s+/g, ' ').trim(), 'la barre naît vide').toMatch(/^curl -fsSL http/);
  });

  it('les puces n’inventent pas de système : AUCUN script ne connaît de table', () => {
    // Tout vient des attributs. Une table des systèmes dans le script serait
    // une seconde source, qui dériverait du HTML au premier ajout.
    //
    // ─── DEUX FAÇONS DONT CETTE GARDE A ÉTÉ CREUSE ─────────────────────────
    //
    // 1. Elle cherchait la fin de la tranche AVANT son début : « Raccourcis »
    //    apparaît d'abord dans un commentaire de la feuille de style, 3 000
    //    lignes plus haut. La tranche sortait vide — donc verte, sans avoir lu
    //    une ligne.
    //
    // 2. Corrigée, elle ne regardait plus QU'APRÈS `var barreCmd`. Une mutation
    //    posant la constante trois lignes AU-DESSUS a survécu. Une garde
    //    ancrée sur une variable ne protège que ce qui la suit — et rien
    //    n'oblige un futur auteur à écrire sa table là.
    //
    // On lit donc TOUT ce que le navigateur exécute, et on n'ancre plus rien.
    const scripts = [...vitrine.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1] ?? '',
    );
    expect(scripts.length, 'aucun script lu dans la page').toBeGreaterThan(0);
    const total = scripts.join('\n');
    expect(total.length, 'les scripts lus sont vides').toBeGreaterThan(2000);
    expect(total, 'une commande d’installation est codée en dur dans un script').not.toMatch(
      /curl -fsSL|docker compose|irm https?:/,
    );
  });
});

describe('site vitrine — le bandeau des agents', () => {
  /** Les clés d'agent que `getAdapter` sait vraiment construire. */
  function adaptateursReels(): string[] {
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    const debut = source.indexOf('export function getAdapter');
    const corps = source.slice(debut, source.indexOf('\n}', debut));
    return [...corps.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1] ?? '');
  }

  it('chaque nom annoncé correspond à un adaptateur qui existe', () => {
    // Annoncer un agent retiré enverrait quelqu'un poser `HIVE_AGENT` sur une
    // valeur que la ruche refuse — au moment précis où il essaie de démarrer.
    const annonces = [...new Set([...vitrine.matchAll(/data-agent="([^"]+)"/g)].map((m) => m[1]))];
    expect(annonces.length, 'aucun agent lu dans le bandeau').toBeGreaterThan(2);
    const reels = adaptateursReels();
    expect(reels.length, 'aucun `case` lu dans getAdapter').toBeGreaterThan(3);
    for (const a of annonces) {
      expect(reels, `agent annoncé et inexistant : ${a}`).toContain(a);
    }
  });

  it('« shell » n’est PAS annoncé — c’est un simulacre', () => {
    // Il existe dans `getAdapter`, donc la garde ci-dessus l'accepterait. Mais
    // il ne lance AUCUN processus et rend de faux diffs : le mettre sur la
    // ligne « fonctionne avec l'IA que vous utilisez déjà » serait un mensonge.
    const bandeau = /<section class="bandeau-agents">[\s\S]*?<\/section>/.exec(vitrine)?.[0] ?? '';
    expect(bandeau, 'bandeau introuvable').not.toBe('');
    expect(bandeau, '`shell` est annoncé comme un agent utilisable').not.toMatch(
      /data-agent="shell"/,
    );
  });

  it('la piste défile en double — sinon la boucle saute', () => {
    // L'animation translate de −50 % : la seconde moitié doit prendre
    // exactement la place de la première. Une liste écrite une seule fois
    // donnerait un saut visible à chaque cycle.
    const piste = /<div class="piste"[\s\S]*?<\/div>/.exec(vitrine)?.[0] ?? '';
    const noms = [...piste.matchAll(/data-agent="([^"]+)"/g)].map((m) => m[1]);
    expect(noms.length, 'piste vide').toBeGreaterThan(3);
    expect(noms.length % 2, 'la liste n’est pas écrite un nombre pair de fois').toBe(0);
    expect(noms.slice(0, noms.length / 2), 'les deux moitiés diffèrent').toEqual(
      noms.slice(noms.length / 2),
    );
  });

  it('la liste VRAIE est lisible par un lecteur d’écran', () => {
    // La piste est `aria-hidden` — elle défile et se répète. Sans la liste hors
    // écran, l'information n'existerait que pour ceux qui voient.
    expect(vitrine).toMatch(/class="sr-only" data-i18n="agents\.liste"/);
    expect(vitrine, 'la piste n’est pas masquée aux lecteurs d’écran').toMatch(
      /<div class="piste" aria-hidden="true">/,
    );
  });
});

describe('les listes filtrées ne sont pas vides', () => {
  it('au moins une page porte un formulaire, au moins une porte une nav', () => {
    // Une liste vide rendrait `describe.each` muet : zéro cas, zéro échec, et
    // une garde qui a l'air verte parce qu'elle n'a rien regardé.
    expect(PAGES_FORMULAIRE.length, 'plus aucun lien vers un formulaire').toBeGreaterThan(0);
    expect(PAGES_NAV.length, 'plus aucune page avec en-tête').toBeGreaterThan(0);
  });
});

describe.each(PAGES_FORMULAIRE)('page $nom — les formulaires', ({ html }) => {
  it('chaque lien « ouvrir un formulaire » vise un gabarit qui existe', () => {
    const gabarits = [...html.matchAll(/issues\/new\?template=([\w.-]+\.yml)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(gabarits.length, 'aucun lien vers un formulaire').toBeGreaterThan(0);
    for (const nom of new Set(gabarits)) {
      const chemin = `.github/ISSUE_TEMPLATE/${nom}`;
      expect(existsSync(new URL(chemin, `file://${RACINE}`)), `gabarit absent : ${chemin}`).toBe(
        true,
      );
    }
  });
});

// ─── LE DOCUMENT IMPRIMABLE NE PEUT PAS INVENTER UNE COMMANDE ────────────────
//
// La présentation réécrit les trois commandes d'installation de la vitrine.
// Deux copies, et l'une des deux part sur papier — c'est-à-dire dans une main
// où plus aucune correction ne la rattrape. Une URL d'installeur qui change
// laisserait donc traîner un PDF qui fait exécuter la MAUVAISE commande.
//
// La vitrine reste la source : chaque commande imprimée doit se retrouver, au
// caractère près, dans une de ses puces de système.
describe('site vitrine — l’aperçu du tableau de bord', () => {
  const page = PAGES.find((p) => p.nom === 'vitrine');
  const vitrine = page?.html ?? '';

  it('LE RELEVÉ TROUVE LA VITRINE — sans elle, tout ce fichier serait vert et vide', () => {
    expect(page, 'la page « vitrine » a disparu de PAGES').toBeDefined();
    expect(vitrine.length).toBeGreaterThan(1000);
  });

  /** Les écrans déclarés par les onglets. */
  const ecrans = [...vitrine.matchAll(/data-ecran="([a-z]+)"/g)].map((m) => m[1]!);

  it('IL Y A BIEN DES ÉCRANS — sinon tout ce qui suit est creux', () => {
    // La garde qui empêche les suivantes d'être vertes sur du vide. Ce piège a
    // déjà été pris deux fois dans ce dépôt.
    expect(ecrans.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ecrans).size, 'deux onglets ne peuvent pas désigner le même écran').toBe(
      ecrans.length,
    );
  });

  it('CHAQUE ONGLET OUVRE UN CORPS QUI EXISTE', () => {
    // Un onglet sans corps est un bouton mort : il se surligne et ne montre
    // rien. C'est exactement la panne que le script ne peut pas voir tout seul.
    const corps = new Set([...vitrine.matchAll(/data-ecran-corps="([a-z]+)"/g)].map((m) => m[1]!));
    const orphelins = ecrans.filter((e) => !corps.has(e));
    expect(orphelins, 'onglets sans écran').toEqual([]);
  });

  it('…ET UNE ENTRÉE DE BARRE LATÉRALE, sinon la barre ment sur la vue ouverte', () => {
    const rail = new Set([...vitrine.matchAll(/data-ecran-rail="([a-z]+)"/g)].map((m) => m[1]!));
    expect(
      ecrans.filter((e) => !rail.has(e)),
      'écrans absents de la barre',
    ).toEqual([]);
  });

  it('UN SEUL ÉCRAN EST OUVERT AU CHARGEMENT', () => {
    // Deux corps visibles empileraient deux tableaux de bord l'un sous l'autre.
    const visibles = [...vitrine.matchAll(/data-ecran-corps="[a-z]+"(\s*hidden)?/g)].filter(
      (m) => !m[1],
    );
    expect(visibles).toHaveLength(1);
    const choisis = [...vitrine.matchAll(/aria-selected="true"/g)];
    expect(choisis).toHaveLength(1);
  });

  it('…ET `hidden` EST RÉELLEMENT HONORÉ — la garde ci-dessus ne peut pas le voir', () => {
    // Le test du dessus lit le HTML : l'attribut `hidden` y est, il est donc
    // vert. Mais `display: grid` sur `.apercu-corps` bat le `display: none`
    // que le navigateur attache à `hidden` — sa feuille de style est la moins
    // prioritaire de toutes. Les cinq écrans s'empilaient, et aucun test ne
    // pouvait le dire.
    //
    // Une garde qui lit la structure ne voit pas la présentation qui la
    // défait. Celle-ci exige la règle qui rétablit l'ordre.
    expect(vitrine, 'sans cette règle, les cinq écrans s’empilent').toMatch(
      /\.apercu-corps\[hidden\]\s*\{[^}]*display:\s*none/,
    );
  });

  it('L’APERÇU N’INVENTE AUCUN ÉCRAN : le script ne connaît pas leurs noms', () => {
    // Même règle que pour les puces de système. Une liste d'écrans recopiée
    // dans le script divergerait du HTML sans que rien ne rougisse.
    const scripts = [...vitrine.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1] ?? '',
    );
    expect(
      scripts.some((s) => s.trim() !== ''),
      'aucun script lu : le relevé est cassé',
    ).toBe(true);
    for (const e of ecrans) {
      for (const s of scripts) {
        expect(s, `le script nomme l’écran « ${e} »`).not.toContain(`'${e}'`);
      }
    }
  });

  it('LES CHIFFRES SONT ANNONCÉS COMME UN EXEMPLE', () => {
    // Un tableau de bord d'illustration qui passerait pour une mesure serait la
    // première promesse fausse du site.
    const legende = /data-i18n="ap\.legende">([\s\S]*?)</.exec(vitrine)?.[1] ?? '';
    expect(legende.length, 'aucune légende').toBeGreaterThan(20);
    expect(legende.toLowerCase()).toMatch(/exemple/);
  });
});

describe('site vitrine — la version téléphone', () => {
  const page = PAGES.find((p) => p.nom === 'vitrine');
  const vitrine = page?.html ?? '';

  /** Le bloc de règles qui ne s'applique qu'aux petits écrans. */
  const petitEcran = (): string => {
    const i = vitrine.indexOf('@media (max-width: 720px)');
    expect(i, 'aucun point de rupture téléphone').toBeGreaterThan(-1);
    // On s'arrête à la fermeture du bloc média, repérée par l'indentation.
    const fin = vitrine.indexOf('\n      }', i);
    return vitrine.slice(i, fin);
  };

  it('LE POINT DE RUPTURE EXISTE ET N’EST PAS VIDE', () => {
    // Sans ça, tout ce qui suit chercherait dans une chaîne vide et serait
    // vert sans rien avoir regardé.
    expect(petitEcran().length).toBeGreaterThan(200);
  });

  it('LA NAVIGATION TIENT SUR UNE LIGNE QUI GLISSE', () => {
    // Mesuré à 390 px : les dix liens s'étalaient sur TROIS lignes avant le
    // premier mot du pitch. On faisait lire un sommaire à quelqu'un qui ne
    // sait pas encore ce qu'est la ruche.
    const bloc = petitEcran();
    expect(bloc, 'la nav doit cesser de passer à la ligne').toMatch(/flex-wrap:\s*nowrap/);
    expect(bloc, 'et défiler à la place').toMatch(/overflow-x:\s*auto/);
  });

  it('…ET ELLE DIT QU’ELLE GLISSE, DANS LES DEUX ÉCRITURES', () => {
    // Un lien coupé net se lit comme un défaut, pas comme une invitation.
    //
    // La loupe a montré que ce test était trop lâche : `/mask-image:/` attrape
    // aussi `-webkit-mask-image`, si bien qu'il restait vert avec le seul
    // préfixe — c'est-à-dire cassé partout sauf chez WebKit. Safari exige
    // encore le préfixe, Firefox ne connaît QUE la forme standard : il faut
    // les deux, et le test le dit maintenant.
    const bloc = petitEcran();
    expect(bloc, 'sans la forme préfixée, Safari ne fond pas le bord').toMatch(
      /-webkit-mask-image:\s*linear-gradient/,
    );
    expect(bloc, 'sans la forme standard, Firefox ne fond pas le bord').toMatch(
      /(?<!-)\bmask-image:\s*linear-gradient/,
    );
  });

  it('LES CIBLES TACTILES NE DESCENDENT PAS SOUS 42 px', () => {
    // Apple comme Google donnent 44 px comme plancher confortable. En dessous,
    // on vise au pixel près avec un pouce.
    const bloc = petitEcran();
    const hauteurs = [...bloc.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(hauteurs.length, 'aucune cible tactile élargie').toBeGreaterThan(0);
    for (const h of hauteurs) expect(h).toBeGreaterThanOrEqual(42);
  });

  it('LA PAGE DÉCLARE SON VIEWPORT — sans quoi le téléphone dézoome tout', () => {
    // Sans cette balise, Safari et Chrome mobile rendent la page à 980 px de
    // large puis la réduisent : le point de rupture ci-dessus ne se
    // déclencherait JAMAIS, et tout ce fichier serait vert pour rien.
    expect(vitrine).toMatch(/<meta[^>]+name="viewport"[^>]+width=device-width/);
  });
});

describe('présentation — les commandes viennent de la vitrine', () => {
  /** Un texte de commande, espaces normalisés — le HTML plie les longues lignes. */
  const normalise = (s: string): string => s.replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

  it('chaque commande imprimée existe telle quelle sur la vitrine', () => {
    const doc = PAGES.find((p) => p.nom === 'présentation')?.html ?? '';
    const imprimees = [...doc.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code/g)]
      .map((m) => normalise(m[1] ?? ''))
      // L'invite du terminal (`$` ou `>`) est un ornement, pas la commande.
      .map((c) => c.replace(/^[$>] /, ''));
    expect(imprimees.length, 'aucune commande lue dans la présentation').toBeGreaterThan(2);

    const vitrineCmds = new Set(valeursDe(vitrine, 'data-install-cmd').map(normalise));
    expect(vitrineCmds.size, 'la vitrine n’a plus de puce de système').toBeGreaterThan(2);
    for (const cmd of imprimees) {
      expect(vitrineCmds, `commande absente de la vitrine : ${cmd}`).toContain(cmd);
    }
  });
});

describe.each(PAGES)('page $nom — les boutons mènent quelque part', ({ html, dossier }) => {
  it('chaque lien relatif interne pointe vers un fichier livré', () => {
    // Une page en sous-dossier casse silencieusement ses liens relatifs : c'est
    // le mode d'échec numéro un d'un site statique à plusieurs pages.
    const liens = [...html.matchAll(/href="((?:\.\.\/|\.\/)[^"#?]*)"/g)].map((m) => m[1] ?? '');
    for (const lien of new Set(liens)) {
      // Un lien vers un dossier est servi par son index.html.
      const cible = lien.endsWith('/') ? `${lien}index.html` : lien;
      const resolu = new URL(cible, new URL(dossier, `file://${RACINE}`));
      expect(existsSync(resolu), `lien relatif mort : ${lien}`).toBe(true);
    }
  });
});

describe('site vitrine — section communauté', () => {
  it('le lien « voir les projets » filtre sur le label posé par le gabarit', () => {
    const label = labelDuGabarit('proposer-un-projet.yml');
    // Le lien du site doit filtrer sur CE label, sinon il rend une liste vide.
    // On lit `q` comme GitHub le lira : en paramètre de requête, où « + » vaut
    // espace — d'où URLSearchParams plutôt qu'un decodeURIComponent.
    const lien = vitrine.match(/https:\/\/github\.com\/[^"]*issues\?q=[^"]+/)?.[0] ?? '';
    const q = new URL(lien).searchParams.get('q') ?? '';
    expect(q, `requête du lien : ${q}`).toContain(`label:"${label}"`);
  });

  it('la section est atteignable depuis la navigation', () => {
    expect(vitrine).toMatch(/<a href="#communaute"/);
    expect(vitrine).toMatch(/<section id="communaute"/);
  });

  it('le bloc Hive Cloud dit clairement qu’il n’existe pas encore', () => {
    // Annoncer une offre payante sur une page publique sans dire qu'elle n'est
    // pas disponible, c'est promettre. On ne promet pas.
    const bloc = vitrine.match(/<div class="cloud">[\s\S]*?<\/div>\s*<\/section>/)?.[0] ?? '';
    expect(bloc, 'bloc cloud introuvable').not.toBe('');
    expect(bloc).toMatch(/cloud-honest/);
    expect(bloc).toMatch(/n’existe pas encore|n'existe pas encore/);
    // …et il mène à la page qui détaille l'offre.
    expect(bloc, 'le bloc cloud ne renvoie pas vers /rush/').toMatch(/href="rush\/"/);
  });
});

describe('page rush — ce qui ne doit jamais glisser', () => {
  it('la page dit, avant tout le reste, que rien n’est en vente', () => {
    // Une grille tarifaire sans cet avertissement est une offre. Il doit être
    // AVANT le premier prix dans le DOM, pas relégué en bas de page.
    const avis = rush.indexOf('class="avis"');
    const premierPrix = rush.indexOf('class="montant"');
    expect(avis, 'bandeau d’avertissement absent').toBeGreaterThan(-1);
    expect(premierPrix).toBeGreaterThan(-1);
    expect(avis, 'l’avertissement doit précéder le premier prix').toBeLessThan(premierPrix);
    expect(rush).toMatch(/Rien n’est en vente aujourd’hui|Rien n'est en vente aujourd'hui/);
  });

  it('les engagements « jamais à vendre » sont présents et intacts', () => {
    // Ce sont des promesses publiques. Les retirer doit coûter un test rouge,
    // pas un simple coup de ciseaux dans le HTML.
    const bloc = rush.match(/<div class="jamais">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(bloc, 'bloc des engagements introuvable').not.toBe('');
    expect(bloc, 'l’engagement sur le merge humain a disparu').toMatch(
      /[Aa]ucun paiement ne débloque un merge/,
    );
    expect(bloc, 'l’engagement sur le noyau gratuit a disparu').toMatch(
      /noyau ne sera retenue derrière un mur/,
    );
    expect(bloc.match(/<li/g)?.length, 'quatre engagements attendus').toBe(4);
  });

  it('la grille tarifaire montre le cas où la marge devient négative', () => {
    // Publier une sensibilité au coût des jetons est l'argument de crédibilité
    // de la page. Une grille qui ne montrerait que le beau temps la trahirait.
    expect(rush, 'colonne de sensibilité absente').toMatch(/Marge si 5 €\/h/);
    expect(rush, 'aucune marge négative affichée').toMatch(/class="num neg"/);
  });

  it('le prix affiché et le prix unitaire sont cohérents', () => {
    // Un prix de pack modifié sans son prix horaire est une faute qu'aucune
    // relecture ne rattrape — on la fait rattraper par l'arithmétique.
    const offres = [
      ...rush.matchAll(
        /<div class="montant">([\s\S]*?)<\/div>[\s\S]*?<p class="unitaire"[^>]*>([^<]*)</g,
      ),
    ];
    const chiffres = offres
      .map(([, montant = '', unitaire = '']) => {
        // Le montant peut porter un « / mois » dans un <span> — dont les
        // attributs contiennent des chiffres. On dépouille les balises d'abord.
        const prix = Number(montant.replace(/<[^>]*>/g, '').replace(/[^\d]/g, ''));
        const m = unitaire.match(/(\d+)\s*h-ouvrières\s*·\s*([\d,]+)\s*€\/h/);
        if (!m) return null;
        return { prix, heures: Number(m[1]), horaire: Number((m[2] ?? '').replace(',', '.')) };
      })
      .filter((v): v is { prix: number; heures: number; horaire: number } => v !== null);
    expect(chiffres.length, 'aucune offre horaire lisible').toBeGreaterThan(2);
    for (const { prix, heures, horaire } of chiffres) {
      const attendu = Math.round((prix / heures) * 100) / 100;
      expect(Math.abs(attendu - horaire), `${prix} € / ${heures} h ≠ ${horaire} €/h`).toBeLessThan(
        0.01,
      );
    }
  });

  it('le document du modèle économique existe et reste prudent', () => {
    const doc = readFileSync(new URL('../docs/MODELE-ECONOMIQUE.md', import.meta.url), 'utf8');
    expect(doc).toMatch(/pas une offre en service/);
    // La règle qui protège la facturation d'une donnée d'agent (cf. balance.ts).
    expect(doc, 'la règle « ne jamais facturer durationMs » a disparu').toMatch(
      /facturation ne lit jamais `durationMs`/,
    );
  });
});

describe.each(PAGES_NAV)('page $nom — ancres', ({ html }) => {
  it('chaque lien de navigation vise une section réelle', () => {
    const nav = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
    const cibles = [...nav.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    expect(cibles.length).toBeGreaterThan(3);
    for (const id of cibles) {
      expect(html, `ancre morte dans la nav : #${id}`).toMatch(
        new RegExp(`id="${id}"[\\s>]|id='${id}'[\\s>]`),
      );
    }
  });

  it("le décalage des ancres suit la hauteur mesurée de l'en-tête", () => {
    // L'en-tête est collant et sa hauteur varie du simple au double selon que
    // la nav tient sur une ligne (72 px) ou passe à la ligne (jusqu'à 176 px).
    // Une valeur en dur y laissait les titres de section cachés derrière la
    // barre sur mobile ; le décalage doit rester lié à la mesure.
    expect(html).toMatch(/scroll-margin-top:\s*calc\(var\(--h-entete/);
    expect(html).toMatch(/setProperty\(\s*'--h-entete'/);
  });
});

describe('site vitrine — les raccourcis', () => {
  // Ces boutons promettent des gestes CONCRETS. Une commande mal orthographiée
  // ou une portée de jeton trop large sur une page d'accueil, c'est pire
  // qu'aucun bouton : la personne suit l'instruction et se retrouve avec une
  // erreur, ou avec un jeton qui peut réécrire ses workflows CI.

  /** Les commandes que les boutons « copier » mettent dans le presse-papier. */
  function commandesCopiees(): string[] {
    return [...vitrine.matchAll(/data-cmd="([^"]+)"/g)].map((m) => m[1] ?? '');
  }

  it('chaque commande copiée existe VRAIMENT dans package.json', () => {
    // Le mode d'échec le plus bête et le plus probable : un script renommé, et
    // la page d'accueil continue d'annoncer l'ancien nom.
    //
    // Les commandes des puces de système (`data-install-cmd`) entrent ici
    // aussi : « Déjà cloné » copie `npm run setup`, et rien d'autre ne
    // vérifierait que ce script existe encore.
    const scripts = Object.keys(
      (
        JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts,
    );
    const cmds = [...commandesCopiees(), ...valeursDe(vitrine, 'data-install-cmd')];
    expect(cmds.length, 'aucun bouton « copier »').toBeGreaterThan(0);
    for (const cmd of cmds) {
      // « npm run setup && npm run dev » → ['setup', 'dev'] ; le « -- … » qui
      // suit un script est un argument passé à la CLI, pas un nom de script.
      for (const m of cmd.matchAll(/npm run ([\w:]+)/g)) {
        expect(scripts, `script inconnu dans « ${cmd} » : ${m[1]}`).toContain(m[1]);
      }
    }
  });

  it('les sous-commandes de la CLI existent', () => {
    const cli = readFileSync(new URL('../src/cli.ts', import.meta.url), 'utf8');
    const sous = commandesCopiees()
      .map((c) => c.match(/npm run cli -- ([\w-]+)/)?.[1])
      .filter((s): s is string => Boolean(s));
    expect(sous.length, 'aucune sous-commande CLI annoncée').toBeGreaterThan(0);
    for (const nom of sous) {
      expect(cli, `sous-commande absente de la CLI : ${nom}`).toContain(`'${nom}'`);
    }
  });

  it('LE JETON DEMANDÉ NE PEUT PAS TOUCHER AUX WORKFLOWS', () => {
    // `livraison.ts` documente le choix : une portée `repo` suffit, `workflow`
    // n'est PAS demandée — la ruche n'a pas à modifier la CI du dépôt qu'elle
    // sert. Le lien de la page doit demander exactement cela.
    const lien = vitrine.match(/https:\/\/github\.com\/settings\/tokens\/new\?[^"]+/)?.[0] ?? '';
    expect(lien, 'lien de création de jeton absent').not.toBe('');
    const scopes = new URL(lien.replace(/&amp;/g, '&')).searchParams.get('scopes') ?? '';
    expect(scopes.split(',')).toEqual(['repo']);
  });

  it('« ouvrir ma ruche » ne code PAS l’adresse en dur', () => {
    // Le port se règle par HIVE_PORT et une ruche prêtée tourne parfois sur une
    // autre machine : un href figé mènerait au vide chez tous ceux qui ont
    // changé quelque chose. Les liens sont composés depuis le champ.
    const liens = [...vitrine.matchAll(/class="btn ghost rc-lien"[^>]*>/g)].map((m) => m[0]);
    expect(liens.length, 'aucun lien « ouvrir ma ruche »').toBeGreaterThan(0);
    for (const l of liens) expect(l, `href figé : ${l}`).not.toMatch(/href=/);
    expect(vitrine, 'les liens ne sont jamais composés').toMatch(/a\.setAttribute\('href'/);
  });

  it('la page DIT que ces boutons visent la machine du visiteur', () => {
    // Sans cette phrase, un bouton « Ouvrir ma ruche » qui ne fait rien passe
    // pour un site cassé alors que c'est simplement la ruche qui ne tourne pas.
    const bloc = vitrine.match(/<section id="raccourcis"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(bloc, 'section des raccourcis introuvable').not.toBe('');
    expect(bloc).toMatch(/votre propre machine|VOTRE<\/strong> ruche/);
    expect(bloc).toMatch(/rc-note/);
  });

  it('la commande copiée est LISIBLE avant le clic', () => {
    // Un bouton « copier » qui ne montre pas ce qu'il copie demande une
    // confiance gratuite — et personne ne colle une commande à l'aveugle.
    for (const cmd of commandesCopiees()) {
      const attendu = cmd.replace(/&/g, '&amp;');
      expect(vitrine, `commande non affichée : ${cmd}`).toContain(
        `<code class="rc-cmd">${attendu}`,
      );
    }
  });
});
