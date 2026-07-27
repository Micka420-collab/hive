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
}

const PAGES: Page[] = [
  {
    nom: 'vitrine',
    html: readFileSync(new URL('../site/index.html', import.meta.url), 'utf8'),
    prefixe: '',
  },
  {
    nom: 'rush',
    html: readFileSync(new URL('../site/rush/index.html', import.meta.url), 'utf8'),
    prefixe: '../',
  },
];

const vitrine = PAGES[0]?.html ?? '';
const rush = PAGES[1]?.html ?? '';

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

describe.each(PAGES)('page $nom — les boutons mènent quelque part', ({ html }) => {
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

  it('chaque lien relatif interne pointe vers un fichier livré', () => {
    // Une page en sous-dossier casse silencieusement ses liens relatifs : c'est
    // le mode d'échec numéro un d'un site statique à plusieurs pages.
    const liens = [...html.matchAll(/href="((?:\.\.\/|\.\/)[^"#?]*)"/g)].map((m) => m[1] ?? '');
    for (const lien of new Set(liens)) {
      // Un lien vers un dossier est servi par son index.html.
      const cible = lien.endsWith('/') ? `${lien}index.html` : lien;
      const nomPage = html === rush ? 'site/rush/' : 'site/';
      const resolu = new URL(cible, new URL(nomPage, `file://${RACINE}`));
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

describe.each(PAGES)('page $nom — ancres', ({ html }) => {
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
