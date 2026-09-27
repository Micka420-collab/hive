// LES CAPTURES D'ÉCRAN DE MISSION CONTROL — chaque vue, sur bureau et sur
// mobile, photographiée sur une vraie ruche.
//
//   npm run captures                                  → captures-ecran/fr/
//   npm run captures -- --langue en                   → captures-ecran/en/
//   npm run captures -- --sortie docs/images/captures
//
// Une fois par machine, le navigateur — que `npm ci` ne télécharge JAMAIS :
//
//   npx playwright install --only-shell chromium
//
// ─── POURQUOI CE SCRIPT EXISTE ──────────────────────────────────────────────
//
// Les cartes de l'interface (Mission Control, Sandbox Live, responsive et
// accessibilité) demandent une PREUVE VISUELLE, et le dépôt n'avait aucun
// moyen de la produire : les trois captures du README ont été prises à la main,
// un jour d'août, sur une ruche qu'on ne peut plus reconstituer. Une capture
// qu'on ne sait pas refaire ne prouve que le jour où elle a été prise.
//
// Celle-ci se refait en une commande, sur l'arbre courant, et dit d'où elle
// vient (le manifeste porte le commit et l'état de l'arbre).
//
// ─── CE QU'IL FAIT, DANS L'ORDRE ────────────────────────────────────────────
//
//   1. Il CONSTRUIT l'écran (`vite build dashboard`, moins d'une seconde) :
//      photographier un `dashboard/dist` d'hier, c'est photographier du code
//      qui n'existe plus.
//   2. Il lance le NAVIGATEUR avant la ruche : s'il manque, la phrase qui dit
//      quoi taper arrive tout de suite, sans deux serveurs démarrés pour rien.
//   3. Il monte la ruche de laboratoire et la remplit par l'API
//      (`captures-ecran-ruche.mjs` : dossier jetable, port choisi par le
//      système, agent simulé, rien du `.env` de l'opérateur).
//   4. Pour chaque format : CHAQUE case de la barre de navigation, cliquée —
//      la barre fait foi, et une vue ajoutée demain sera photographiée sans
//      toucher à ce fichier —, la Chambre de l'ouvrière, et le tiroir d'une
//      tâche qui a connu un échec puis une reprise.
//   5. EN VOL : un lot est confié, et la Ruche puis la Chambre sont
//      photographiées PENDANT que les sous-agents travaillent. Un état stable
//      ne montre jamais un agent au travail.
//   6. Un manifeste (`captures.json`) : pour chaque image, le débordement
//      horizontal mesuré et les erreurs de console survenues pendant la vue.
//
// ─── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────
//
// Il ne tourne ni sous `npm test`, ni en CI : c'est un outil qu'on lance,
// pas une garde. Une garde en pixels rougirait à chaque changement de police
// et apprendrait à tout le monde à la relancer sans lire.
//
// Il ne JUGE pas l'image. Il mesure deux faits qu'un humain rate à l'œil — une
// page plus large que l'écran, une erreur que la console seule a vue — et il
// les écrit. Le reste se regarde.

// Les fonctions passées à `page.evaluate` et `addInitScript` ne tournent PAS
// ici : Playwright les sérialise et les exécute DANS LA PAGE. Les globales du
// navigateur qu'elles lisent sont donc déclarées, pour elles seules.
/* global document, location, localStorage, window, HTMLElement */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { exigerAmorce } from './amorce.mjs';
import {
  FORMATS,
  MANIFESTE,
  estNotreCapture,
  nomCapture,
  optionsDepuisArgv,
} from './captures-ecran-sortie.mjs';

// `fileURLToPath`, jamais `.pathname` : sous Windows ce dernier rend `/D:/…`
// (§ 6.1 du journal).
const RACINE = fileURLToPath(new URL('..', import.meta.url));

const OK = 0;
const ECHEC = 1;
const PREREQUIS = 2;
const MAL_APPELE = 64;

const USAGE = 'usage : npm run captures -- [--langue fr|en] [--sortie <dossier du dépôt>]';

/** Ce qui doit être rendu, quoi qu'il arrive — y compris sur ^C. */
const aRendre = [];

async function toutRendre() {
  for (const rendre of aRendre.splice(0).reverse()) {
    try {
      await rendre();
    } catch {
      // Un nettoyage qui échoue ne doit pas empêcher les suivants.
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`\n⏹  ${signal} — la ruche de laboratoire s'arrête…`);
    void toutRendre().then(() => process.exit(130));
  });
}

/**
 * Attend que plus aucune requête HTTP ne soit en vol depuis `calmeMs`.
 *
 * `waitForLoadState('networkidle')` ne sert à rien ici : c'est un état de
 * CHARGEMENT, atteint une fois pour toutes au premier affichage. Une vue
 * ouverte ensuite par la barre fait ses propres requêtes, et celles-là, il
 * faut les compter soi-même. Le WebSocket n'est pas une requête : ses messages
 * continuels ne retardent rien.
 *
 * ─── LE CALME SE COMPTE À PARTIR DE L'APPEL, PAS DE LA DERNIÈRE REQUÊTE ─────
 *
 * Première version : « aucune requête depuis `calmeMs` ». Juste après un clic,
 * la dernière requête datait souvent de la vue PRÉCÉDENTE — le calme était donc
 * déjà acquis, avant même que le morceau de la nouvelle vue ne soit demandé.
 * Mesuré : `sante.bureau.png` montrait « Chargement de la vue… », avec la
 * hauteur de page de l'Essaim. On exige désormais `calmeMs` de silence APRÈS
 * l'appel : le morceau paresseux et les lectures de la vue ont le temps de
 * partir, donc d'être comptés.
 */
function suivreReseau(page) {
  let enVol = 0;
  let dernier = 0;
  const bouger = (delta) => {
    enVol = Math.max(0, enVol + delta);
    dernier = Date.now();
  };
  page.on('request', () => bouger(1));
  page.on('requestfinished', () => bouger(-1));
  page.on('requestfailed', () => bouger(-1));
  return async (calmeMs = 500, plafondMs = 8_000) => {
    const debut = Date.now();
    while (Date.now() - debut < plafondMs) {
      if (enVol === 0 && Date.now() - Math.max(dernier, debut) >= calmeMs) return;
      await page.waitForTimeout(50);
    }
  };
}

/** Les erreurs de la page depuis la dernière capture — attribuées à la vue qui les a vues naître. */
function suivreErreurs(page) {
  let erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(m.text());
  });
  return () => {
    const vues = erreurs.map((e) => e.split('\n')[0].slice(0, 240));
    erreurs = [];
    return vues;
  };
}

/** Le commit photographié, et si l'arbre a bougé depuis — `null` quand git ne sait pas le dire. */
function provenance() {
  const git = (args) => spawnSync('git', args, { cwd: RACINE, encoding: 'utf8', shell: false });
  const tete = git(['rev-parse', '--short', 'HEAD']);
  const etat = git(['status', '--porcelain', '--untracked-files=no']);
  return {
    commit: tete.status === 0 ? tete.stdout.trim() : null,
    arbreModifie: etat.status === 0 ? etat.stdout.trim() !== '' : null,
  };
}

async function principal() {
  const options = optionsDepuisArgv(process.argv.slice(2), RACINE);
  if (options.erreur) {
    console.error(`✘ ${options.erreur}\n${USAGE}`);
    return MAL_APPELE;
  }
  const { langue, sortie } = options;

  // Du Node nu jusqu'ici : si les dépendances manquent, l'amorce le dit en
  // clair plutôt qu'une trace de résolution de module (cf. `ruche.mjs`).
  exigerAmorce(RACINE);
  const { register } = await import('tsx/esm/api');
  register();
  const { SCRIPTS } = await import('../src/shared/demarrage.ts');
  const labo = await import('./captures-ecran-ruche.mjs');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      '✘ Playwright est absent : installez les dépendances de développement (npm install).',
    );
    return PREREQUIS;
  }

  // ─── 1. L'ÉCRAN, CONSTRUIT DEPUIS L'ARBRE COURANT ──────────────────────────
  const construction = spawnSync(process.execPath, [SCRIPTS.vite, 'build', 'dashboard'], {
    cwd: RACINE,
    encoding: 'utf8',
    shell: false,
  });
  if (construction.status !== 0) {
    console.error(
      `✘ La construction de l'écran a échoué :\n${construction.stdout}${construction.stderr}`,
    );
    return ECHEC;
  }
  console.log('✔ écran construit (dashboard/dist)');

  // ─── 2. LE NAVIGATEUR, AVANT LA RUCHE ──────────────────────────────────────
  let navigateur;
  try {
    navigateur = await chromium.launch();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/Executable doesn't exist|playwright install/i.test(message)) throw e;
    console.error(
      '✘ Le navigateur des captures n’est pas installé sur cette machine.\n\n' +
        '    npx playwright install --only-shell chromium\n\n' +
        '  (≈ 110 Mo, une fois par machine. Sous Linux, s’il manque des bibliothèques\n' +
        '   système : npx playwright install-deps chromium.)',
    );
    return PREREQUIS;
  }
  aRendre.push(() => navigateur.close());

  // ─── 3. LA RUCHE DE LABORATOIRE ─────────────────────────────────────────────
  const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-captures-'));
  aRendre.push(() => rmSync(dossier, { recursive: true, force: true, maxRetries: 3 }));
  const ruche = await labo.lancerRucheIsolee({ racine: RACINE, dossier });
  aRendre.push(() => ruche.arreter());
  console.log(`✔ ruche de laboratoire en ligne (${ruche.http}, ouvrière ${labo.NOM_OUVRIERE})`);
  const { jwt, projets } = await labo.amorcerRuche(ruche);
  console.log(`✔ ruche remplie : ${projets.length} projets, toutes les tâches terminées`);

  // Les captures d'une exécution précédente : SEULEMENT celles que ce script a
  // pu écrire (`estNotreCapture`) — le reste du dossier n'est pas à nous.
  mkdirSync(sortie, { recursive: true });
  for (const f of readdirSync(sortie)) if (estNotreCapture(f)) rmSync(path.join(sortie, f));

  const captures = [];
  const echecs = [];
  const stockage = {
    'hive.token': ruche.entetes['x-hive-token'],
    'hive.jwt': jwt,
    'hive.lang': langue,
  };

  /**
   * Un navigateur par format, déjà connecté et authentifié, et sa façon de
   * photographier. Ouverts d'abord, servis ensuite en DEUX PHASES : toutes les
   * vues au repos pour tous les formats, PUIS le vol. Dans l'autre ordre, le
   * lot confié pendant le vol du bureau apparaissait dans toutes les captures
   * mobiles (13 tâches au lieu de 7) : deux formats, deux ruches différentes.
   */
  const ouvrir = async (format) => {
    const contexte = await navigateur.newContext({
      viewport: format.viewport,
      deviceScaleFactor: format.deviceScaleFactor,
      isMobile: format.isMobile,
      hasTouch: format.hasTouch,
      locale: langue === 'fr' ? 'fr-FR' : 'en-US',
      colorScheme: 'light',
      // Les animations figées : deux exécutions photographient la même image,
      // et un sous-agent à mi-battement ne se lit pas comme un défaut.
      reducedMotion: 'reduce',
    });
    aRendre.push(() => contexte.close());
    // Posé avant tout script de la page, à chaque chargement : le tableau lit
    // son jeton, sa session et sa langue dans `localStorage` au démarrage.
    await contexte.addInitScript((valeurs) => {
      for (const [cle, valeur] of Object.entries(valeurs)) localStorage.setItem(cle, valeur);
    }, stockage);
    const page = await contexte.newPage();
    const calme = suivreReseau(page);
    const erreursVues = suivreErreurs(page);

    /** Une capture ; son échec est consigné, jamais avalé, et n'arrête pas les suivantes. */
    const photographier = async (
      vue,
      preparer,
      { tiroir = false, calmeMs = 500, plafondMs = 8_000 } = {},
    ) => {
      try {
        await preparer();
        // Le calme D'ABORD : c'est lui qui laisse au morceau paresseux de la vue
        // le temps d'être demandé. Attendre la disparition du « Chargement de
        // la vue… » avant qu'il soit seulement apparu ne prouvait rien.
        await calme(calmeMs, plafondMs);
        await page.locator('.mc-view-loading').waitFor({ state: 'detached', timeout: 15_000 });
        await page.evaluate(() => document.fonts.ready);
        // Ni survol ni anneau de focus : la case cliquée en dernier restait
        // éclairée sur la capture suivante, comme si c'était la vue ouverte.
        // Et le HAUT de la page : la navigation par ancre garde le défilement
        // de la vue précédente, et la barre et l'en-tête, collants, étaient
        // alors peints au milieu de la page entière (`chambre-en-vol.mobile`).
        await page.mouse.move(1, format.viewport.height - 2);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        const mesure = await page.evaluate(() => ({
          debordement: Math.max(
            0,
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          hauteur: document.documentElement.scrollHeight,
        }));
        const fichier = nomCapture(vue, format.nom);
        await page.screenshot({
          path: path.join(sortie, fichier),
          // Un tiroir est fixé à l'écran : sa page entière ne montrerait rien de plus.
          fullPage: format.pleinePage && !tiroir,
          animations: 'disabled',
          caret: 'hide',
        });
        captures.push({ fichier, vue, format: format.nom, ...mesure, erreurs: erreursVues() });
      } catch (e) {
        const raison = (e instanceof Error ? e.message : String(e)).split('\n')[0];
        echecs.push({ vue, format: format.nom, raison });
        erreursVues();
      }
    };

    await page.goto(`${ruche.http}/#/ruche`);
    await page.locator('.conn.online').waitFor({ timeout: 30_000 });
    // La SESSION avant de compter les cases : les vues d'administration
    // n'entrent dans la barre qu'une fois `/api/auth/me` revenu. Compter plus
    // tôt les ferait manquer en silence.
    await page.locator('.mc-account-name').waitFor({ timeout: 15_000 });
    await calme();
    const naviguer = (hash) => page.evaluate((h) => (location.hash = h), hash);
    return { format, page, photographier, naviguer };
  };

  const chambre = `#/chambre/${encodeURIComponent(ruche.noeudId)}`;
  const postes = [];
  for (const format of FORMATS) postes.push(await ouvrir(format));

  // ─── 4. AU REPOS ────────────────────────────────────────────────────────────
  for (const { page, photographier, naviguer } of postes) {
    const cases = page.locator('.mc-nav-cell');
    const nombre = await cases.count();
    for (let i = 0; i < nombre; i++) {
      await cases.nth(i).click();
      const vue = await page.evaluate(() => location.hash.replace(/^#\/?/, '').split('/')[0]);
      await photographier(vue, async () => {});
    }

    // La Chambre n'a pas de case (ADR 0010) : on y entre par l'ouvrière.
    await photographier('chambre', () => naviguer(chambre));

    // Le tiroir de la tâche qui a échoué puis repris. On essaie chaque filtre
    // des missions plutôt que d'en supposer l'ordre ou le libellé.
    await photographier(
      'tache',
      async () => {
        const tache = page.locator('.ch-tache', { hasText: labo.TACHE_RACONTEE }).first();
        const filtres = page.locator('[data-testid="chambre-filtres-taches"] button');
        for (let i = 0; i < (await filtres.count()) && !(await tache.isVisible()); i++) {
          await filtres.nth(i).click();
        }
        await tache.click({ timeout: 5_000 });
        await page.locator('.drawer[role="dialog"]').waitFor();
      },
      { tiroir: true },
    );
    await page.keyboard.press('Escape');
  }

  // ─── 5. EN VOL ──────────────────────────────────────────────────────────────
  //
  // Un lot par format, et on photographie dès que le travail SE VOIT — pas au
  // bout d'une attente fixe : l'adaptateur simulé finit une tâche en deux ou
  // trois secondes, et une attente trop longue photographierait une ruche au
  // repos sous le nom « en vol ». Le calme réseau y est court pour la même
  // raison : pendant un vol, le tableau relit sans cesse.
  for (const { page, photographier, naviguer } of postes) {
    await labo.confierLot(ruche, projets[0]);
    await photographier(
      'ruche-en-vol',
      async () => {
        await naviguer('#/ruche');
        await page.locator('.badge.running').first().waitFor({ timeout: 15_000 });
      },
      { calmeMs: 150, plafondMs: 1_500 },
    );
    await photographier(
      'chambre-en-vol',
      async () => {
        await naviguer(chambre);
        await page.locator('.ch-taches .ch-tache').first().waitFor({ timeout: 15_000 });
      },
      { calmeMs: 150, plafondMs: 1_500 },
    );
    await labo.attendreTerminees(ruche);
  }

  // ─── 6. LE MANIFESTE ───────────────────────────────────────────────────────
  //
  // Passé par prettier : s'il est versé dans le dépôt (`--sortie docs/…`), il
  // doit tenir `npm run lint` sans qu'on y repasse à la main.
  const manifeste = {
    genere: new Date().toISOString(),
    ...provenance(),
    langue,
    formats: FORMATS.map((f) => ({
      nom: f.nom,
      largeur: f.viewport.width,
      hauteur: f.viewport.height,
      densite: f.deviceScaleFactor,
    })),
    captures,
    echecs,
  };
  const fichierManifeste = path.join(sortie, MANIFESTE);
  const prettier = await import('prettier');
  const reglage = (await prettier.resolveConfig(fichierManifeste)) ?? {};
  writeFileSync(
    fichierManifeste,
    await prettier.format(JSON.stringify(manifeste), { ...reglage, filepath: fichierManifeste }),
  );

  // ─── LE COMPTE RENDU ───────────────────────────────────────────────────────
  const relatif = path.relative(RACINE, sortie);
  console.log(`\n${captures.length} capture(s) dans ${relatif}/`);
  for (const c of captures) {
    const signes = [
      c.debordement > 0 ? `⚠ déborde de ${c.debordement} px` : '',
      c.erreurs.length > 0 ? `⚠ ${c.erreurs.length} erreur(s) de console` : '',
    ].filter(Boolean);
    console.log(`  ${c.fichier.padEnd(28)} ${signes.join(' · ')}`);
  }
  for (const e of echecs) console.error(`  ✘ ${nomCapture(e.vue, e.format)} — ${e.raison}`);
  console.log(`\nManifeste : ${path.join(relatif, MANIFESTE)}`);
  return echecs.length === 0 ? OK : ECHEC;
}

// `process.exitCode`, jamais `process.exit()` sur le chemin nominal : couper la
// boucle avec un `fetch` en vol fait abandonner libuv sous Windows (cf.
// `essai-parcours.mjs`). Le nettoyage passe AVANT, et quoi qu'il arrive.
try {
  process.exitCode = await principal();
} catch (e) {
  console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = ECHEC;
} finally {
  await toutRendre();
}
