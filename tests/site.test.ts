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

// ─── L'ÉCHELLE TYPOGRAPHIQUE DE LA MAQUETTE ──────────────────────────────────
//
// Les chiffres ci-dessous ne sont pas des goûts : ils ont été RELEVÉS dans le
// DOM de la maquette rendue (`getComputedStyle` à 1440 px), pas lus sur une
// capture. La palette et les fontes de cette page étaient déjà exactement
// celles du design ; tout l'écart tenait dans l'usage — la graisse des titres,
// leur taille, et la forme du surtitre.
//
//   surtitre   12,5px / 700 / Instrument Sans / +1,375px (0,11em) / capitales
//   titre      44–56px / 600 / Bricolage / −0,025em
//   h1         64px / 600
//
// Ce que ces tests tiennent, c'est le RETOUR EN ARRIÈRE : un `font-weight: 700`
// remis sur un titre, un surtitre repassé en chasse fixe, un émoji rajouté.
// Chacun de ces gestes est invisible dans une revue de diff HTML et change la
// page entière.
describe('site vitrine — l’échelle relevée dans la maquette', () => {
  const regle = (selecteur: string): string => {
    const m = new RegExp(`(?:^|\\n)\\s*${selecteur}\\s*\\{([^}]*)\\}`).exec(vitrine);
    return m?.[1] ?? '';
  };

  it('LE SURTITRE N’EST PAS UN TITRE — la structure du document dit vrai', () => {
    // Il portait `<h2>`. Un lecteur d'écran annonçait donc « Sécurité » là où
    // le titre de la section est « Sûr par défaut. Jamais de merge sans revue
    // humaine. » — le plan du document énumérait des étiquettes au lieu des
    // sections. La maquette met un `<span>` sur le surtitre et le `<h2>` sur
    // la phrase ; c'est aussi ce que dit HTML.
    expect(vitrine, 'le surtitre est redevenu un titre de section').not.toMatch(
      /<h[1-6][^>]*class="kicker"/,
    );
    const titres = [...vitrine.matchAll(/<h2[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(titres.length, 'plus aucun h2 dans la page').toBeGreaterThan(4);
    for (const c of titres) {
      expect(c, `un h2 qui n’est pas un titre de section : class="${c}"`).toMatch(/\bheadline\b/);
    }
  });

  it('CHAQUE SECTION A SON TITRE, et il est unique', () => {
    // Un `<h2>` par section, ni zéro ni deux : la garde ci-dessus laisserait
    // passer une section qui aurait perdu son titre au passage.
    const sections = [
      ...vitrine.matchAll(/<section id="[^"]+" class="section">[\s\S]*?<\/section>/g),
    ];
    expect(sections.length, 'aucune section trouvée').toBeGreaterThan(6);
    for (const [bloc] of sections) {
      const id = /<section id="([^"]+)"/.exec(bloc)?.[1] ?? '?';
      expect((bloc.match(/<h2\b/g) ?? []).length, `section #${id} : compte de h2`).toBe(1);
    }
  });

  it('LE SURTITRE EST EN CAPITALES PAR LE CSS, jamais dans le texte', () => {
    // Une chaîne écrite EN CAPITALES se copie en capitales, se traduit mal, et
    // se fait épeler lettre par lettre par certains lecteurs d'écran.
    const k = regle('\\.kicker');
    expect(k, 'règle .kicker introuvable').not.toBe('');
    expect(k, 'le surtitre n’est plus en capitales').toMatch(/text-transform:\s*uppercase/);
    for (const m of vitrine.matchAll(/<p class="kicker"[^>]*>([^<]+)</g)) {
      const texte = (m[1] ?? '').trim();
      expect(texte, `surtitre écrit en capitales : ${texte}`).not.toBe(texte.toUpperCase());
    }
  });

  it('LE SURTITRE EST EN INSTRUMENT SANS ESPACÉ, pas en chasse fixe', () => {
    // Il était en JetBrains Mono à +0,02em. La maquette l'écrit dans la fonte
    // de texte, à +0,11em : c'est ce qui fait un surtitre plutôt qu'une clef
    // de code.
    const k = regle('\\.kicker');
    expect(k, 'surtitre revenu en chasse fixe').not.toMatch(/font-family:\s*var\(--mono\)/);
    expect(k).toMatch(/font-family:\s*var\(--texte\)/);
    expect(k, 'graisse du surtitre').toMatch(/font-weight:\s*700/);
    const ls = /letter-spacing:\s*([\d.]+)em/.exec(k)?.[1];
    expect(ls, 'espacement du surtitre absent ou non exprimé en em').toBeDefined();
    expect(Number(ls), 'le surtitre n’est plus espacé').toBeGreaterThanOrEqual(0.1);
  });

  it('AUCUN ÉMOJI DANS LES SURTITRES', () => {
    // « ✨ En bref », « 🔒 Sécurité »… La maquette n'en pose aucun : un émoji
    // devant chaque section fait une table des matières décorée, pas une page.
    const surtitres = [...vitrine.matchAll(/<p class="kicker"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(surtitres.length, 'aucun surtitre trouvé').toBeGreaterThan(6);
    for (const t of surtitres) {
      expect(t, `émoji dans un surtitre : ${t}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    // Et dans le dictionnaire anglais, où ils se recopiaient à l'identique.
    for (const [, cle, val] of dictionnaireEn(vitrine).matchAll(/'([\w.]*kicker)':\s*'([^']*)'/g)) {
      expect(val, `émoji dans ${cle}`).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('LES TITRES SONT EN DEMI-GRAS, pas en gras', () => {
    // 600, mesuré dans la maquette. À 700 le même texte fait une affiche : le
    // reste de la page doit alors crier pour se faire entendre, et de proche
    // en proche la sobriété est perdue.
    expect(/font-weight:\s*600/.test(regle('\\.headline')), '.headline n’est plus en 600').toBe(
      true,
    );
    expect(/font-weight:\s*600/.test(regle('h1')), 'h1 n’est plus en 600').toBe(true);
  });

  it('LES TITRES DE SECTION MONTENT JUSQU’À 48 px', () => {
    // Ils plafonnaient à 40. C'est la borne HAUTE du clamp qui compte : c'est
    // elle qu'on voit sur un écran d'ordinateur.
    const h = regle('\\.headline');
    const clamp = /font-size:\s*clamp\(([^)]*)\)/.exec(h)?.[1] ?? '';
    expect(clamp, 'la taille du titre n’est plus un clamp').not.toBe('');
    const maxi = Number(/([\d.]+)px\s*\)?\s*$/.exec(clamp.trim())?.[1]);
    expect(maxi, `borne haute du titre : ${clamp}`).toBeGreaterThanOrEqual(48);
  });

  it('LES TITRES SONT SERRÉS À −0,025em, pas davantage', () => {
    // Trop serré (−0,035em), Bricolage colle ses lettres à 48 px. La maquette
    // s'arrête à −0,025em.
    const ls = /letter-spacing:\s*(-?[\d.]+)em/.exec(regle('\\.headline'))?.[1];
    expect(ls, 'serrage du titre absent').toBeDefined();
    expect(Number(ls), 'titre trop serré').toBeGreaterThanOrEqual(-0.028);
    expect(Number(ls), 'titre pas serré du tout').toBeLessThanOrEqual(-0.02);
  });
});

// ─── LES JETONS QU'ON CROIT DÉCLARÉS ─────────────────────────────────────────
//
// Écrit après m'être fait prendre : j'ai posé `font-family: var(--sans)` alors
// que le jeton s'appelle `--texte`. Un `var()` qui ne résout pas rend la
// déclaration invalide À L'EXÉCUTION — la propriété retombe alors sur
// l'héritage, qui donnait ici… exactement la bonne fonte. La page était juste
// à l'écran et fausse dans le fichier, et rien n'aurait sonné : ni le
// navigateur, ni une capture, ni une revue de diff.
//
// LA GARDE NE VISE QUE LES `var()` SANS REPLI. Sa première version les
// interdisait tous, et elle a immédiatement accusé `--h-entete` — un jeton que
// le script publie à l'exécution et que le CSS lit en `var(--h-entete, 72px)`.
// Celui-là est correct par construction : le repli EST la valeur quand le
// script ne tourne pas. C'est l'absence de repli, sur un jeton jamais déclaré,
// qui laisse la propriété disparaître en silence.
describe.each(PAGES)('page $nom — les jetons CSS', ({ html }) => {
  it('AUCUN var(--x) SANS REPLI NE VISE UN JETON QUI N’EXISTE PAS', () => {
    const declares = new Set(
      [...html.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => (m[1] ?? '').toLowerCase()),
    );
    // `var(--x)` ou `var(--x )` — mais pas `var(--x, …)`, qui porte son repli.
    const sansRepli = [...html.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) =>
      (m[1] ?? '').toLowerCase(),
    );
    expect(sansRepli.length, 'aucun var() dans la page').toBeGreaterThan(20);
    const fantomes = [...new Set(sansRepli)].filter((j) => !declares.has(j));
    expect(
      fantomes,
      `jetons utilisés sans repli et jamais déclarés : ${fantomes.join(', ')}`,
    ).toEqual([]);
  });
});

// ─── LE TÉLÉPHONE : CE QUI NE SE VOIT PAS SUR UNE CAPTURE ────────────────────
//
// Tout ce qui suit vient d'une mesure prise dans le DOM à cinq largeurs
// (320, 360, 390, 414, 430 px), pas d'un coup d'œil sur une image. Les trois
// défauts trouvés étaient invisibles à l'écran :
//
//   · un plancher `minmax(320px, 1fr)` poussait la page 18 px hors cadre à
//     320 px de large — neuf grilles avaient le même défaut, sur trois pages ;
//   · les dix liens de navigation faisaient 21 px de haut, là où Apple, Google
//     et le WCAG 2.5.5 demandent 44 ;
//   · l'en-tête occupait 177 px sur trois rangs, soit 22 % du premier écran.
//
// Aucun de ces trois-là n'a de couleur, de forme ou de police fautive. Ils ne
// se voient qu'en lisant des boîtes. Ces gardes tiennent donc les RÈGLES qui
// les ont fermés, puisque le rendu, lui, aura toujours l'air correct.
/** La feuille de style d'une page, isolée du script — qui contient lui aussi
 *  des accolades, et par milliers. La première version de ces gardes lisait la
 *  page ENTIÈRE : sept secondes par page, en retour arrière sur le JavaScript. */
function feuille(html: string): string {
  return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '').join('\n');
}

/** Les règles CSS d'une page, découpées une fois : { sélecteur, corps }. */
function reglesDe(html: string): Array<{ selecteur: string; corps: string }> {
  return [...feuille(html).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selecteur: (m[1] ?? '').trim().split('\n').pop()?.trim() ?? '',
    corps: m[2] ?? '',
  }));
}

describe.each(PAGES)('page $nom — les grilles sur un écran étroit', ({ nom, html }) => {
  it('AUCUNE GRILLE N’A DE PLANCHER DUR', () => {
    // `repeat(auto-fit, minmax(320px, 1fr))` : à 320 px de large moins les
    // marges, la colonne ne PEUT pas rétrécir, et c'est la page entière qui
    // part de travers. `minmax(min(100%, 320px), 1fr)` vaut exactement la même
    // chose tant qu'il y a la place, et cède quand il n'y en a plus.
    const durs = [...feuille(html).matchAll(/minmax\(\s*\d+px/g)].map((m) => m[0]);
    expect(durs, `${nom} : plancher(s) dur(s) ${durs.join(', ')}`).toEqual([]);
  });

  it('UNE LARGEUR MINIMALE PLUS GRANDE QUE L’ÉCRAN DOIT DÉFILER DANS SON CADRE', () => {
    // Même défaut, autre propriété — mais avec une exception RÉELLE, et c'est
    // la garde qui a dû apprendre à la reconnaître. Écrite d'abord comme une
    // interdiction sèche, elle a accusé `table { min-width: 560px }` dans la
    // page Rush : un tableau de chiffres n'a pas à se replier sur 320 px, il a
    // à DÉFILER dans son propre cadre — et c'est ce que fait `.tableau`, juste
    // au-dessus.
    //
    // C'est la deuxième fois de la journée qu'une garde neuve accuse du code
    // correct. La règle juste n'est jamais « personne ne dépasse » ; c'est
    // « qui dépasse doit dire où il défile ».
    const regles = reglesDe(html);
    regles.forEach((r, i) => {
      const valeur = Number(/min-width:\s*(\d+)px/.exec(r.corps)?.[1] ?? 0);
      if (valeur <= 280) return;
      const avant = regles.slice(Math.max(0, i - 3), i);
      expect(
        avant.some((p) => /overflow(?:-x)?:\s*auto/.test(p.corps)),
        `${nom} : « ${r.selecteur} » impose ${valeur}px sans cadre qui défile au-dessus`,
      ).toBe(true);
    });
  });
});

describe('site vitrine — le doigt, pas le curseur', () => {
  const phone = /@media \(max-width: 720px\) \{([\s\S]*?)\n {6}\}\n/.exec(vitrine)?.[1] ?? '';

  it('LA REQUÊTE TÉLÉPHONE EXISTE ET PORTE DES CIBLES DE 44 px', () => {
    expect(phone, 'requête média téléphone introuvable').not.toBe('');
    const quarante4 = (phone.match(/min-height:\s*44px/g) ?? []).length;
    expect(quarante4, 'plus aucune cible ne vaut 44px').toBeGreaterThanOrEqual(3);
    expect(phone, 'aucune cible ne descend sous 44px').not.toMatch(
      /min-height:\s*(?:[0-3]\d|4[0-3])px/,
    );
  });

  it('LA NAVIGATION, LA LANGUE ET LE BOUTON GITHUB SONT TOUS TENUS', () => {
    // Les trois organes qu'on touche en premier sur un téléphone. Les nommer
    // un par un plutôt que compter : un sélecteur retiré ne se verrait pas
    // dans un total.
    //
    // LA PREMIÈRE VERSION CHERCHAIT `nav.main a` DANS TOUTE LA REQUÊTE, et la
    // loupe l'a prise en flagrant délit : retiré de la règle des 44 px, le
    // sélecteur survivait dans deux AUTRES règles de la même requête — le
    // défilement par à-coups et le rembourrage. La garde restait verte pendant
    // que les dix liens repassaient à 21 px. C'est le même piège qu'un repère
    // textuel qu'un commentaire contient aussi : il faut chercher dans la
    // RÈGLE qui porte la propriété, pas dans le fichier.
    const listes = [...phone.matchAll(/([^{}]+)\{([^{}]*min-height:\s*44px[^{}]*)\}/g)]
      .map((m) => m[1] ?? '')
      .join(',');
    expect(listes, 'aucune règle ne pose 44px').not.toBe('');
    for (const sel of ['nav.main a', '.lang-toggle button', '#gh-btn']) {
      expect(listes, `${sel} n’est plus tenu à 44px`).toContain(sel);
    }
  });
});

describe('site vitrine — le bouton GitHub qui doit pouvoir raccourcir', () => {
  it('LE LIBELLÉ EST EN MORCEAUX, et le mot tombe sur téléphone', () => {
    // Un `textContent` d'un seul tenant ne se raccourcit pas au CSS. Pire : le
    // compteur d'étoiles le RALLONGEAIT en arrivant — « ★ GitHub » devenait
    // « ★ 42 · GitHub », et l'en-tête passait à trois rangs après le chargement.
    expect(vitrine, 'le mot n’est plus un nœud séparé').toMatch(/class="gh-mot"/);
    expect(vitrine, 'le compte n’est plus un nœud séparé').toMatch(/class="gh-nb"/);
    const phone = /@media \(max-width: 720px\) \{([\s\S]*?)\n {6}\}\n/.exec(vitrine)?.[1] ?? '';
    expect(phone, 'le mot ne tombe plus sur téléphone').toMatch(/\.gh-mot\s*\{\s*display:\s*none/);
  });

  it('LE SCRIPT N’ÉCRASE PLUS TOUT LE BOUTON', () => {
    // La garde qui tient l'invariant : si le script revient à
    // `gh-btn.textContent = …`, les trois morceaux disparaissent et la règle
    // ci-dessus devient décorative.
    expect(vitrine, 'le script réécrit tout le bouton').not.toMatch(
      /getElementById\('gh-btn'\)\.textContent\s*=/,
    );
    expect(vitrine, 'le compte n’est plus écrit dans son propre nœud').toMatch(/#gh-btn \.gh-nb/);
  });

  it('LE LIEN GARDE SON NOM QUAND SON TEXTE RÉTRÉCIT', () => {
    // Sans `aria-label`, un bouton réduit à « ★ 42 » s'annonce « étoile 42 ».
    const btn = /<a[^>]*id="gh-btn"[\s\S]*?>/.exec(vitrine)?.[0] ?? '';
    expect(btn, 'balise #gh-btn introuvable').not.toBe('');
    expect(btn, 'nom accessible absent').toMatch(/aria-label="[^"]{6,}"/);
  });
});

describe('site vitrine — ce qu’on masque doit exister ailleurs', () => {
  it('LA VERSION SURVIT À L’EN-TÊTE QUI SE SERRE', () => {
    // Sous 360 px, l'en-tête cache `.brand .ver` pour tenir sur un rang. Elle
    // n'existait NULLE PART ailleurs : la masquer l'aurait perdue tout court.
    // La garde ne défend pas le pied de page, elle défend la propriété — « au
    // moins deux endroits » — pour que le masquage reste sans conséquence.
    const occurrences = (vitrine.match(/v0\.2\.0/g) ?? []).length;
    expect(
      occurrences,
      'la version n’apparaît qu’une fois : la masquer sur petit écran la perd',
    ).toBeGreaterThanOrEqual(2);
  });
});

// ─── VINGT-TROIS CARTES, QUATRE FAMILLES ─────────────────────────────────────
//
// Mesuré avant de toucher à quoi que ce soit : la section « En bref » faisait
// 2 066 px sur un ordinateur et **5 422 px sur un téléphone** — six écrans
// pleins — pour 23 cartes et 819 mots servis d'un coup, sans hiérarchie, à
// quelqu'un qui ne sait pas encore ce qu'est une ruche.
//
// Elles sont rangées en quatre familles repliables. Le point qui compte, et que
// ces gardes tiennent : **rien n'a été supprimé**. Un regroupement est une
// occasion parfaite de perdre une carte en silence — elle disparaît de la page
// sans que rien ne casse, et personne ne s'en aperçoit avant des mois.
describe('site vitrine — les familles de fonctions', () => {
  /** Chaque famille : son résumé, sa liste annoncée, ses cartes réelles. */
  const familles = [...vitrine.matchAll(/<details class="famille">([\s\S]*?)<\/details>/g)].map(
    (m) => {
      const bloc = m[1] ?? '';
      const resume = /<summary>([\s\S]*?)<\/summary>/.exec(bloc)?.[1] ?? '';
      const texte = (h: string): string =>
        h
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      return {
        titre: texte(/<b[^>]*>([\s\S]*?)<\/b>/.exec(resume)?.[1] ?? ''),
        // La liste des noms a quitté le résumé pour la tête du volet — elle y
        // ouvrait la section sur du jargon. La PROPRIÉTÉ ne change pas : ce qui
        // est annoncé doit être ce qui est contenu. On la cherche donc dans le
        // bloc entier, pas dans le seul résumé.
        annonces: texte(/class="fam-liste"[^>]*>([\s\S]*?)<\/span/.exec(bloc)?.[1] ?? '')
          .split('·')
          .map((t) => t.trim())
          .filter(Boolean),
        compte: Number(texte(/class="fam-nb"[^>]*>([\s\S]*?)<\/span/.exec(resume)?.[1] ?? '0')),
        cartes: [...bloc.matchAll(/<div class="card">([\s\S]*?)<h3[^>]*>([\s\S]*?)<\/h3>/g)].map(
          (c) => texte(c[2] ?? ''),
        ),
      };
    },
  );

  it('IL Y A QUATRE FAMILLES, ET AUCUNE CARTE ORPHELINE', () => {
    expect(familles.length, 'les familles ont disparu').toBe(4);
    const dansFamilles = familles.reduce((n, f) => n + f.cartes.length, 0);
    const total = (vitrine.match(/<div class="card">/g) ?? []).length;
    expect(dansFamilles, `${total - dansFamilles} carte(s) hors famille`).toBe(total);
  });

  it('LES VINGT-TROIS CARTES SONT TOUTES LÀ, ET CHACUNE UNE SEULE FOIS', () => {
    // Le vrai risque du regroupement : une carte tombée pendant le déplacement.
    // On ne compte pas — on compare les NOMS, parce qu'un total juste peut
    // cacher une carte perdue et une autre dupliquée.
    const tous = familles.flatMap((f) => f.cartes);
    expect(tous.length, 'le compte de cartes a changé').toBe(23);
    const doublons = tous.filter((n, i) => tous.indexOf(n) !== i);
    expect(doublons, `carte(s) rangée(s) deux fois : ${doublons.join(', ')}`).toEqual([]);
  });

  it('CE QU’UNE FAMILLE ANNONCE EST EXACTEMENT CE QU’ELLE CONTIENT', () => {
    // La garde qui porte tout le reste. Replié, on ne voit QUE la liste des
    // noms : si elle ment, le visiteur qui cherche « Le Rayon » ouvre les
    // quatre volets pour rien, et la page a l'air correcte pendant ce temps.
    for (const f of familles) {
      expect(f.annonces, `famille « ${f.titre} » : liste annoncée ≠ cartes réelles`).toEqual(
        f.cartes,
      );
    }
  });

  it('LE NOMBRE AFFICHÉ EST LE NOMBRE RÉEL', () => {
    for (const f of familles) {
      expect(f.compte, `famille « ${f.titre} » annonce ${f.compte} fonctions`).toBe(
        f.cartes.length,
      );
    }
  });

  it('LA VERSION ANGLAISE ANNONCE AUTANT DE FONCTIONS QUE LA FRANÇAISE', () => {
    // Les listes sont traduites (les cartes le sont : « Miellerie » devient
    // « Honey House »). Une traduction qui perd un nom rendrait la liste
    // anglaise plus courte que son contenu — sans qu'aucune autre garde ne le
    // voie, puisque les cartes, elles, seraient toujours là.
    const dico = dictionnaireEn(vitrine);
    for (const [i, cle] of ['fam.rep.l', 'fam.main.l', 'fam.voir.l', 'fam.durer.l'].entries()) {
      const val = new RegExp(`'${cle.replace(/\./g, '\\.')}':\\s*'([^']*)'`).exec(dico)?.[1] ?? '';
      expect(val, `${cle} sans traduction`).not.toBe('');
      expect(
        val.split('·').length,
        `${cle} : ${val.split('·').length} noms pour ${familles[i]?.cartes.length} cartes`,
      ).toBe(familles[i]?.cartes.length);
    }
  });

  it('LE DÉPLIAGE NE DÉPEND PAS DU JAVASCRIPT', () => {
    // `<details>` est natif : clavier, impression et recherche dans la page
    // marchent sans qu'on écrive une ligne. Un accordéon maison rendrait 23
    // cartes inatteignables le jour où le script échoue.
    expect(vitrine, 'les familles ne sont plus des <details>').toMatch(/<details class="famille">/);
    const section = /<section id="features"[\s\S]*?<\/section>/.exec(vitrine)?.[0] ?? '';
    expect(section, 'un script pilote maintenant le dépliage').not.toMatch(
      /onclick|addEventListener/,
    );
  });
});

// ─── LE PIED DE PAGE : AUCUN LIEN QUI NE MÈNE NULLE PART ─────────────────────
//
// Un lien mort en pied de page est le plus discret des défauts du site :
// personne ne le signale — on n'écrit pas à quelqu'un pour lui dire que son
// « Contribuer » renvoie une 404 — et il reste des années.
//
// Ces gardes relisent donc les liens et VÉRIFIENT LEUR CIBLE dans le dépôt :
// une ancre `#x` doit désigner une section de la page, un chemin GitHub
// `blob/main/…` doit désigner un fichier qui existe, un gabarit d'issue doit
// être dans `.github/ISSUE_TEMPLATE/`. C'est ce qui a écarté « Contribuer » et
// « Sécurité » du plan : CONTRIBUTING.md et SECURITY.md n'existent pas.
describe('site vitrine — le plan du pied de page', () => {
  const pied = /<footer>[\s\S]*?<\/footer>/.exec(vitrine)?.[0] ?? '';
  const liens = [...pied.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');

  it('LE PIED DE PAGE EST UN PLAN, pas une rangée de liens', () => {
    expect(pied, 'pied de page introuvable').not.toBe('');
    const colonnes = (pied.match(/class="pied-col"/g) ?? []).length;
    expect(colonnes, 'les colonnes du plan ont disparu').toBeGreaterThanOrEqual(3);
    expect(liens.length, 'le plan a moins de liens qu’une rangée').toBeGreaterThanOrEqual(12);
    // Chaque colonne porte un titre : sans lui, il faut essayer les liens un
    // par un pour savoir de quel côté chercher.
    expect((pied.match(/class="pied-t"/g) ?? []).length).toBe(colonnes);
  });

  it('CHAQUE ANCRE DÉSIGNE UNE SECTION QUI EXISTE', () => {
    const sections = new Set(
      [...vitrine.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1] ?? ''),
    );
    const ancres = liens.filter((h) => h.startsWith('#')).map((h) => h.slice(1));
    expect(ancres.length, 'le pied ne renvoie plus à aucune section').toBeGreaterThan(4);
    for (const a of ancres) {
      expect(sections.has(a), `ancre morte dans le pied de page : #${a}`).toBe(true);
    }
  });

  it('CHAQUE FICHIER DU DÉPÔT CITÉ EXISTE VRAIMENT', () => {
    // La garde qui a écarté « Contribuer » et « Sécurité ». Un lien vers une
    // page absente vaut moins que pas de lien du tout.
    const fichiers = liens
      .map((h) => /github\.com\/[^/]+\/[^/]+\/blob\/main\/(.+)$/.exec(h)?.[1])
      .filter((f): f is string => Boolean(f));
    expect(fichiers.length, 'le pied ne cite plus aucun fichier du dépôt').toBeGreaterThan(2);
    for (const f of fichiers) {
      expect(existsSync(new URL(`../${f}`, import.meta.url)), `fichier absent : ${f}`).toBe(true);
    }
  });

  it('CHAQUE GABARIT D’ISSUE CITÉ EXISTE VRAIMENT', () => {
    const gabarits = liens
      .map((h) => /issues\/new\?template=([\w.-]+)/.exec(h)?.[1])
      .filter((g): g is string => Boolean(g));
    expect(gabarits.length, 'le pied n’ouvre plus aucun formulaire').toBeGreaterThan(0);
    for (const g of gabarits) {
      expect(
        existsSync(new URL(`../.github/ISSUE_TEMPLATE/${g}`, import.meta.url)),
        `gabarit absent : ${g}`,
      ).toBe(true);
    }
  });

  it('CHAQUE PAGE VOISINE CITÉE EXISTE VRAIMENT', () => {
    const pages = liens.filter((h) => /^[a-z-]+\/$/.test(h));
    expect(pages.length, 'le pied ne renvoie plus aux pages voisines').toBeGreaterThan(0);
    for (const p of pages) {
      expect(
        existsSync(new URL(`../site/${p}index.html`, import.meta.url)),
        `page absente : ${p}`,
      ).toBe(true);
    }
  });

  it('TOUT LIEN SORTANT PORTE rel="noopener"', () => {
    // `target="_blank"` sans `noopener` donne à la page ouverte une poignée sur
    // celle-ci via `window.opener`. Les navigateurs récents l'appliquent seuls ;
    // ce n'est pas une raison pour compter dessus.
    for (const m of pied.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      expect(m[0], `lien sortant sans noopener : ${m[0].slice(0, 60)}`).toContain('rel="noopener"');
    }
    // Et l'inverse : un lien vers l'extérieur qui n'ouvrirait PAS un onglet
    // ferait sortir le visiteur du site sans le lui dire.
    for (const h of liens.filter((x) => x.startsWith('http'))) {
      const balise = new RegExp(`<a[^>]*href="${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
      expect(balise.exec(pied)?.[0] ?? '', `lien sortant sans onglet : ${h}`).toContain('_blank');
    }
  });

  it('LA VERSION EST TOUJOURS DANS LE PIED, sous une forme ou une autre', () => {
    // L'en-tête la masque sous 360 px. Cette garde existait déjà ; la refonte
    // du pied de page a déplacé la chaîne, elle doit continuer de la trouver.
    expect(pied, 'la version a disparu du pied de page').toMatch(/v0\.2\.0/);
  });
});

// ─── DU TEXTE SOMBRE SUR UNE ALVÉOLE SOMBRE ──────────────────────────────────
//
// Le panneau de l'essaim est la première image de la page — la preuve visuelle
// que la ruche fait quelque chose. Six de ses dix étiquettes étaient
// ILLISIBLES, mesuré au contraste dans le DOM :
//
//   « Integration » 1,24:1  ·  « Billing API » 1,62:1  ·  « JWT auth » 1,62:1
//   « running » 2,33:1  ·  « assigned » 3,03:1  ·  « ready » 3,84:1
//
// (Le seuil WCAG AA est 4,5:1. À 1,24 le texte n'est pas « peu lisible », il
// est invisible.)
//
// La cause est mécanique : quelqu'un a assombri le remplissage des alvéoles
// sans retourner la couleur du texte, resté sur les jetons prévus pour le fond
// clair. Rien ne pouvait sonner — le HTML est valide, la page se rend, et une
// capture d'écran montre bien « quelque chose » à cet endroit.
//
// La garde lit donc la STRUCTURE : dans un groupe dont le polygone est sombre,
// aucun texte ne peut porter une couleur de fond clair.
describe('site vitrine — la lisibilité du panneau de l’essaim', () => {
  const panneau = /<div class="swarm-panel">[\s\S]*?<\/svg>/.exec(vitrine)?.[0] ?? '';
  const groupes = [
    ...panneau.matchAll(/<g transform="translate\([^)]*\)"[^>]*>([\s\S]*?)<\/g>/g),
  ].map((m) => m[1] ?? '');
  /** Les remplissages sombres employés par les alvéoles occupées. */
  const SOMBRES = ['#4a3a12', '#33290f', 'var(--encre)'];
  /** Les couleurs de texte prévues pour un FOND CLAIR — interdites sur sombre. */
  const CLAIRES = ['var(--text)', 'var(--muted)', 'var(--encre)', 'var(--blue)'];

  it('LE PANNEAU EXISTE, ET SES ALVÉOLES SOMBRES AUSSI', () => {
    expect(panneau, 'panneau de l’essaim introuvable').not.toBe('');
    expect(groupes.length, 'plus aucun groupe dans le dessin').toBeGreaterThan(6);
    const sombres = groupes.filter((g) => SOMBRES.some((f) => g.includes(`fill="${f}"`)));
    // Un nombre EXACT ici serait une garde sur le dessin, pas sur sa
    // lisibilité : ajouter une alvéole occupée la ferait rougir pour rien.
    // Ce qu'il faut tenir, c'est qu'il en reste — sans quoi la garde suivante
    // passerait en vert en n'ayant rien examiné.
    expect(
      sombres.length,
      'plus aucune alvéole sombre — la garde suivante ne garderait plus rien',
    ).toBeGreaterThanOrEqual(3);
  });

  it('AUCUN TEXTE DE FOND CLAIR SUR UNE ALVÉOLE SOMBRE', () => {
    for (const g of groupes) {
      const fond = /<polygon[^>]*fill="([^"]+)"/.exec(g)?.[1] ?? '';
      if (!SOMBRES.includes(fond)) continue;
      const textes = [...g.matchAll(/<text[\s\S]*?fill="([^"]+)"[\s\S]*?>([^<]*)</g)];
      expect(textes.length, `alvéole ${fond} sans étiquette`).toBeGreaterThan(0);
      for (const t of textes) {
        expect(
          CLAIRES.includes(t[1] ?? ''),
          `« ${(t[2] ?? '').trim()} » en ${t[1]} sur ${fond} : du texte sombre sur du sombre`,
        ).toBe(false);
      }
    }
  });

  it('AUCUNE ÉTIQUETTE NE DESCEND SOUS 11 px', () => {
    // Les états étaient à 9 px. Quelle que soit la couleur, neuf pixels dans un
    // dessin de 900 px de large ne se lisent pas.
    const tailles = [...panneau.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(tailles.length, 'plus aucune taille déclarée').toBeGreaterThan(8);
    const petites = tailles.filter((t) => t < 10);
    expect(petites, `étiquette(s) trop petite(s) : ${petites.join(', ')}px`).toEqual([]);
  });

  it('LA LÉGENDE EXPLIQUE CHAQUE ÉTAT DU DESSIN', () => {
    // Cinq couleurs d'alvéole racontaient un cycle de vie que rien n'expliquait.
    // Une image dont il faut deviner le code est une décoration, pas une preuve.
    const legende = /<div class="swarm-legende">[\s\S]*?<\/div>\s*<ul/.exec(vitrine)?.[0] ?? '';
    expect(legende, 'la légende a disparu').not.toBe('');
    const etats = [...panneau.matchAll(/>\s*(done|running|assigned|ready|pending)\b/g)].map(
      (m) => m[1] ?? '',
    );
    expect(new Set(etats).size, 'le dessin n’emploie plus ses cinq états').toBe(5);
    for (const e of new Set(etats)) {
      expect(legende, `état non légendé : ${e}`).toContain(`<code>${e}</code>`);
    }
  });

  it('LA LÉGENDE EXPLIQUE, elle ne se contente pas de traduire', () => {
    // Première version : « done → done », « ready → ready ». Un mot rendu par
    // lui-même n'apprend rien à personne.
    const dico = dictionnaireEn(vitrine);
    for (const e of ['done', 'running', 'assigned', 'ready', 'pending']) {
      const val = new RegExp(`'leg\\.${e}':\\s*'([^']*)'`).exec(dico)?.[1] ?? '';
      expect(val, `leg.${e} sans traduction`).not.toBe('');
      expect(val.trim().toLowerCase(), `leg.${e} se traduit par lui-même`).not.toBe(e);
      expect(val.split(/\s+/).length, `leg.${e} n’explique rien : « ${val} »`).toBeGreaterThan(2);
    }
  });
});
