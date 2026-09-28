// LE PROCESSUS PRINCIPAL DE L'APPLICATION DE BUREAU (ADR 0013).
//
// Il ne fait tourner ni la Reine ni les ouvrières : il les LANCE, avec le
// superviseur de Hive, comme `npm run ruche` — mais sans terminal, sans Node
// installé, avec une fenêtre, une barre système et des mises à jour. L'ordre
// de ce fichier est l'ordre du démarrage :
//
//   1. avant `ready` : dossier de données, instance unique, liens `hive://`,
//      journaux, rapports de plantage (jamais envoyés) ;
//   2. l'environnement du shell de connexion (macOS, Linux) ;
//   3. la fenêtre sur l'accueil, la barre système ;
//   4. au premier lancement, la reprise d'une ruche installée par git ;
//   5. la sauvegarde si la version a changé, puis la ruche ;
//   6. l'écran de la Reine dès qu'elle répond, les notifications, les mises à jour.

import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  session,
  shell,
} from 'electron';
import { shellEnv } from 'shell-env';
import { ARGUMENT_SESSION, poserSession, sessionActive } from './autostart.js';
import { creerBarre } from './barre.js';
import { cheminsApp, metaApp } from './chemins.js';
import { chargerHive } from './contrat-hive.js';
import { argumentDiagnostic, executerDiagnostic } from './diagnostic.js';
import { etat, etatPourAccueil, majEtat, surEtat } from './etat.js';
import { creerFenetre, marquerQuitter, ramener, verrouillerSession } from './fenetre.js';
import { journal, journalDePiece, ouvrirJournaux } from './journaux.js';
import { brancherMisesAJour, chercherMiseAJour } from './mises-a-jour.js';
import { lienDansArgv, pageVoulue, routeDepuisLien, URL_ACCUEIL } from './navigation.js';
import {
  declarerSchemaCoquille,
  garderApercu,
  servirApercus,
  servirCoquille,
  TAILLE_MAX_APERCU,
} from './protocole.js';
import { ecouterLaRuche, notifierNatif } from './notifieur.js';
import { chargerPreferences, poserPreferences, preferences } from './preferences.js';
import { cheminsRuche } from './reglages.js';
import {
  copiesHiveWork,
  dossiersCandidats,
  envImporte,
  lireSource,
  type SourceReprise,
} from './reprise.js';
import { RucheBureau } from './superviseur-bureau.js';

// ─── 1. AVANT `ready` ────────────────────────────────────────────────────────

// `HIVE_BUREAU_DONNEES` déplace le dossier de l'app — bancs de fumée, support.
// Rien d'autre : la ruche vit TOUJOURS dans `<données>/ruche/` (ADR 0013 § 4).
const donneesForcees = (process.env.HIVE_BUREAU_DONNEES ?? '').trim();
if (donneesForcees !== '') app.setPath('userData', path.resolve(donneesForcees));
const DONNEES = app.getPath('userData');
app.setAppLogsPath(path.join(DONNEES, 'logs'));
app.setPath('crashDumps', path.join(DONNEES, 'crashDumps'));

const DIAGNOSTIC = argumentDiagnostic(process.argv);
const DEV = !app.isPackaged;
const LANCE_PAR_LA_SESSION = process.argv.includes(ARGUMENT_SESSION);

// Les captures du diagnostic sont instables avec le GPU sous un écran virtuel
// (`UnknownVizError`, mesuré sous xvfb) : le diagnostic rend en logiciel.
if (DIAGNOSTIC !== null) app.disableHardwareAcceleration();

// Les minidumps restent sur le poste : Hive n'émet aucune télémétrie.
crashReporter.start({ uploadToServer: false });

// `--quitter` : la désinstallation et la réinstallation Windows demandent à
// l'app EN COURS de s'arrêter proprement (`build/installer.nsh`) avant que
// NSIS ne tue ce qui reste — la ruche d'abord, ses agents avec elle.
const QUITTER = process.argv.includes('--quitter');

if (!app.requestSingleInstanceLock() || QUITTER) {
  // Une autre instance tient la ruche : elle recevra notre ligne de commande
  // (`second-instance`) et viendra devant — ou s'arrêtera. Seule, `--quitter`
  // n'a rien à arrêter.
  app.exit(0);
}

// Les notifications, le regroupement dans la barre des tâches et l'entrée de
// session se rattachent à l'AUMID des raccourcis de l'installeur (`appId`).
if (process.platform === 'win32') app.setAppUserModelId(metaApp().idApp);

// `hive://` — en développement, l'enregistrer viserait `electron` nu : on ne
// l'enregistre que dans l'app installée (le `.deb`, l'AppImage et NSIS le
// déclarent aussi, `protocols` dans `electron-builder.config.cjs`).
if (!DEV) app.setAsDefaultProtocolClient('hive');
declarerSchemaCoquille();

ouvrirJournaux(app.getPath('logs'), DEV);
chargerPreferences(DONNEES);
journal.info(`Hive ${app.getVersion()} · ${process.platform}-${process.arch} · données ${DONNEES}`);

process.on('uncaughtException', (e) => {
  journal.error('exception non rattrapée :', e);
  if (DIAGNOSTIC === null && app.isReady()) {
    dialog.showErrorBox(
      'Hive a rencontré une erreur',
      `${e.message}\n\nLes journaux : ${app.getPath('logs')}`,
    );
  }
});
process.on('unhandledRejection', (r) => journal.error('rejet non géré :', r));

const CHEMINS = cheminsApp();
const RUCHE = cheminsRuche(DONNEES);

let fenetre: BrowserWindow | null = null;
let ruche: RucheBureau | null = null;
/** La route (`#/…`) demandée avant que l'écran soit prêt — un lien `hive://`, une notification. */
let routeEnAttente = '#/';
/** L'origine que la fenêtre affiche (ou charge) — `null` : elle est sur l'accueil. */
let origineMontree: string | null = null;
/** La personne a quitté l'accueil d'elle-même : il ne la retient plus (`pageVoulue`). */
let accueilLu = false;
/** Vrai une fois la reprise tranchée et la ruche de l'app lancée : avant, « Redémarrer » n'a rien à redémarrer. */
let rucheLancee = false;
/** L'environnement des enfants : celui du shell de connexion, sous celui du processus. */
let envHerite: NodeJS.ProcessEnv = { ...process.env };

// ─── 2. L'ENVIRONNEMENT DU SHELL DE CONNEXION ────────────────────────────────
//
// Ouverte depuis le Finder ou un lanceur, l'app n'a pas le `PATH` du shell :
// `claude` introuvable, la ruche retomberait en diffs simulés (ADR 0013 § 7).
// On le lit une fois, borné ; échec ou délai : l'environnement du lanceur.
async function lireEnvDuShell(): Promise<void> {
  if (process.platform === 'win32') return;
  const delai = new Promise<null>((r) => setTimeout(() => r(null), 5_000).unref());
  try {
    const lu = await Promise.race([shellEnv(), delai]);
    if (lu === null) {
      journal.warn('environnement du shell : délai dépassé — celui du lanceur est gardé');
      return;
    }
    // SOUS celui du processus : ce que le lanceur a posé explicitement l'emporte.
    envHerite = { ...lu, ...process.env, PATH: lu.PATH ?? process.env.PATH };
    // Et le PATH du processus LUI-MÊME : les sondes d'agents (`inventaireAgents`)
    // font `spawn(bin, …)` sur le PATH réel du processus, pas sur celui qu'on
    // leur passe — sans cette ligne, un `codex` installé par npm ou Homebrew
    // reste introuvable quand l'app est ouverte depuis le Finder.
    if (lu.PATH !== undefined && lu.PATH !== '') process.env.PATH = lu.PATH;
  } catch (e) {
    journal.warn(`environnement du shell illisible : ${String(e)}`);
  }
}

// ─── L'ÉCRAN ─────────────────────────────────────────────────────────────────

/** Ouvre l'écran de la Reine sur une route, dès qu'elle répond. */
async function montrerEcran(route: string = routeEnAttente): Promise<void> {
  const o = etat().origine;
  if (fenetre === null || o === null) {
    routeEnAttente = route;
    return;
  }
  origineMontree = o;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${o}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) break;
    } catch {
      // Pas encore : la Reine vient de s'annoncer, le port s'ouvre.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (etat().origine !== o) return;
  routeEnAttente = '#/';
  journal.info(`écran : ${o}/${route}`);
  await fenetre.loadURL(`${o}/${route}`).catch((e: unknown) => {
    journal.warn(`écran : chargement de ${o} interrompu — ${String(e)}`);
  });
}

function montrerAccueil(): void {
  if (fenetre === null) return;
  origineMontree = null;
  if (surAccueil()) return;
  void fenetre.loadURL(URL_ACCUEIL);
}

/** Un geste qui demande l'écran (notification, lien, bouton de l'accueil) : l'accueil ne retient plus. */
function allerALEcran(route: string): void {
  accueilLu = true;
  if (fenetre !== null) ramener(fenetre);
  void montrerEcran(route);
}

function ouvrirRoute(route: string): void {
  allerALEcran(route === '' ? '#/' : `#/${route}`);
}

function suivreLien(lien: string): void {
  const route = routeDepuisLien(lien);
  if (route === null) {
    journal.warn(`lien refusé : ${lien}`);
    return;
  }
  allerALEcran(route);
}

/** « Redémarrer » (barre, accueil) : rien avant que la reprise ait décidé quelle ruche lancer. */
async function redemarrerLaRuche(): Promise<boolean> {
  if (!rucheLancee || ruche === null) return false;
  await ruche.redemarrer();
  return true;
}

app.on('second-instance', (_e, argv) => {
  if (argv.includes('--quitter')) {
    journal.info('arrêt demandé par l’installeur');
    app.quit();
    return;
  }
  const lien = lienDansArgv(argv);
  if (lien !== null) suivreLien(lien);
  else if (fenetre !== null) ramener(fenetre);
});
app.on('open-url', (e, lien) => {
  e.preventDefault();
  suivreLien(lien);
});

// ─── LES APPELS DE LA PAGE — chacun revérifie qui appelle ───────────────────

const depuisAccueil = (e: IpcMainInvokeEvent | IpcMainEvent): boolean =>
  e.senderFrame?.url.split('#')[0] === URL_ACCUEIL;
/** La fenêtre montre-t-elle l'accueil (et non l'écran de la Reine) ? */
const surAccueil = (): boolean =>
  fenetre !== null && fenetre.webContents.getURL().split('#')[0] === URL_ACCUEIL;
const depuisEcran = (e: IpcMainInvokeEvent | IpcMainEvent): boolean => {
  const o = etat().origine;
  try {
    return o !== null && e.senderFrame !== null && new URL(e.senderFrame.url).origin === o;
  } catch {
    return false;
  }
};

let choixReprise: ((c: 'ouvrir' | 'importer' | 'neuve') => void) | null = null;

function brancherAppels(): void {
  ipcMain.on('hive:ecran', (e) => {
    const s = etat();
    e.returnValue =
      depuisEcran(e) && s.jeton !== null ? { jeton: s.jeton, version: app.getVersion() } : null;
  });
  ipcMain.on('hive:apercu', (e, html: unknown) => {
    e.returnValue =
      depuisEcran(e) && typeof html === 'string' && html.length <= TAILLE_MAX_APERCU
        ? garderApercu(html)
        : null;
  });
  ipcMain.on('hive:csp', (e, violation: unknown) => {
    if (!depuisEcran(e) || typeof violation !== 'string') return;
    journal.warn(`CSP : ${violation}`);
    majEtat({ cspViolations: [...etat().cspViolations, violation].slice(-50) });
  });
  ipcMain.handle('hive:accueil:etat', (e) => (depuisAccueil(e) ? etatPourAccueil(etat()) : null));
  ipcMain.handle('hive:accueil:choix', (e, choix: unknown) => {
    if (!depuisAccueil(e) || choixReprise === null) return false;
    if (choix !== 'ouvrir' && choix !== 'importer' && choix !== 'neuve') return false;
    choixReprise(choix);
    return true;
  });
  // « Réessayer » et « Relancer la détection » : le même geste — la sonde des
  // agents se refait à chaque démarrage.
  ipcMain.handle('hive:accueil:reessayer', (e) => depuisAccueil(e) && redemarrerLaRuche());
  ipcMain.handle('hive:accueil:ecran', (e) => {
    if (!depuisAccueil(e) || etat().origine === null) return false;
    allerALEcran(routeEnAttente);
    return true;
  });
  ipcMain.handle('hive:accueil:journaux', async (e) => {
    if (!depuisAccueil(e)) return false;
    await shell.openPath(app.getPath('logs'));
    return true;
  });
  ipcMain.handle('hive:accueil:session', (e, actif: unknown) => {
    if (!depuisAccueil(e) || typeof actif !== 'boolean') return false;
    poserSession(actif);
    majEtat({ session: sessionActive() });
    return true;
  });
  // L'accueil suit l'état en direct.
  surEtat((s) => {
    if (fenetre !== null && surAccueil()) {
      fenetre.webContents.send('hive:accueil:maj', etatPourAccueil(s));
    }
  });
}

// ─── 4. LA REPRISE D'UNE RUCHE INSTALLÉE PAR GIT ─────────────────────────────

async function repond(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${String(port)}/api/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const lireTexte = (f: string): string | null => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};

function sourceTrouvee(): SourceReprise | null {
  for (const d of dossiersCandidats(process.env, homedir())) {
    const s = lireSource(d, lireTexte, existsSync);
    if (s !== null) return s;
  }
  return null;
}

/**
 * Au premier lancement (aucun `.env` dans la ruche de l'app), ou quand la ruche
 * « ouverte » n'est plus là : proposer les trois choix. Rend `true` si l'app
 * doit lancer SA ruche, `false` si elle affiche une ruche externe.
 */
async function reprendre(): Promise<boolean> {
  const externe = preferences().externe;
  if (existsSync(RUCHE.env) && externe === null) return true;
  const source = externe !== null ? lireSource(externe, lireTexte, existsSync) : sourceTrouvee();
  if (source === null) {
    if (externe !== null) poserPreferences({ externe: null });
    return true;
  }
  const enLigne = await repond(source.port);
  if (externe !== null && enLigne) return ouvrirExterne(source);
  majEtat({ reprise: { ...source, repond: enLigne } });
  const choix = await new Promise<'ouvrir' | 'importer' | 'neuve'>((r) => {
    choixReprise = r;
  });
  choixReprise = null;
  journal.info(`reprise de ${source.dossier} : ${choix}`);
  if (choix === 'ouvrir' && (await repond(source.port))) {
    majEtat({ reprise: null });
    poserPreferences({ externe: source.dossier });
    return ouvrirExterne(source);
  }
  poserPreferences({ externe: null });
  if (choix === 'importer') await importer(source);
  majEtat({ reprise: null });
  return true;
}

function ouvrirExterne(source: SourceReprise): false {
  majEtat({
    reine: 'externe',
    origine: `http://127.0.0.1:${String(source.port)}`,
    jeton: source.jeton,
  });
  return false;
}

/**
 * Importer une COPIE : la base par `hive sauvegarde` (`VACUUM INTO`, cohérent
 * même Reine allumée — jamais `cp`), `cerveau/`, l'identité des nœuds, et le
 * `.env` moins ce que l'app possède. La source n'est jamais modifiée.
 */
async function importer(source: SourceReprise): Promise<void> {
  if (ruche === null) return;
  majEtat({ importEnCours: true });
  try {
    const data = path.dirname(RUCHE.db);
    const r = await ruche.cli(['sauvegarde', source.dossier, `--vers=${data}`, '--json'], {
      HIVE_DB: source.db,
    });
    const fichier =
      r.code === 0 ? (JSON.parse(r.sortie) as { fichier?: string }).fichier : undefined;
    if (fichier === undefined) throw new Error(`hive sauvegarde : ${r.sortie.trim().slice(-400)}`);
    renameSync(fichier, RUCHE.db);
    const cerveau = path.join(source.dossier, 'cerveau');
    if (existsSync(cerveau))
      cpSync(cerveau, path.join(RUCHE.ruche, 'cerveau'), { recursive: true });
    const hiveWork = path.join(source.dossier, '.hive-work');
    const noeuds = existsSync(hiveWork)
      ? readdirSync(hiveWork, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      : [];
    for (const c of copiesHiveWork(source.dossier, RUCHE.ruche, noeuds)) {
      if (existsSync(c.de)) cpSync(c.de, c.vers, { recursive: true });
    }
    const hive = await chargerHive(CHEMINS.racineHive);
    hive.ecriture.ecrireAtomique(
      RUCHE.env,
      envImporte(readFileSync(path.join(source.dossier, '.env'), 'utf8')),
      hive.ecriture.MODE_SECRET,
    );
    journal.info(`ruche importée depuis ${source.dossier}`);
  } catch (e) {
    journal.error('import :', e);
    // Rien de partiel ne reste : on repart sur une ruche neuve, et on le dit.
    rmSync(RUCHE.db, { force: true });
    rmSync(RUCHE.env, { force: true });
    void dialog.showMessageBox({
      type: 'warning',
      title: 'Import de la ruche',
      message: 'L’import n’a pas abouti : Hive démarre une ruche neuve.',
      detail: `${e instanceof Error ? e.message : String(e)}\n\nLa ruche d’origine n’a pas été modifiée.`,
    });
  } finally {
    majEtat({ importEnCours: false });
  }
}

// ─── 5. LA SAUVEGARDE D'AVANT CHANGEMENT DE VERSION ──────────────────────────

async function sauvegarderSiNouvelleVersion(): Promise<void> {
  const avant = preferences().derniereVersion;
  const maintenant = app.getVersion();
  if (avant === maintenant) return;
  if (avant !== null && existsSync(RUCHE.db) && ruche !== null) {
    const r = await ruche.cli(['sauvegarde', RUCHE.ruche, '--json']);
    if (r.code === 0)
      journal.info(`sauvegarde avant ${avant} → ${maintenant} : ${r.sortie.trim()}`);
    else journal.warn(`sauvegarde avant changement de version impossible : ${r.sortie.trim()}`);
  }
  poserPreferences({ derniereVersion: maintenant });
}

// ─── LA SORTIE ───────────────────────────────────────────────────────────────

let sortieEnCours = false;
async function arreterLaRuche(): Promise<void> {
  if (ruche !== null) await ruche.arreter();
}

app.on('before-quit', (e) => {
  marquerQuitter();
  if (sortieEnCours || ruche === null || etat().reine === 'externe') return;
  e.preventDefault();
  sortieEnCours = true;
  journal.info('arrêt de la ruche…');
  void arreterLaRuche().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
});

// ─── 3, 4, 5, 6 — le démarrage ───────────────────────────────────────────────

async function demarrer(): Promise<void> {
  await lireEnvDuShell();
  verrouillerSession(session.defaultSession);
  servirCoquille(session.defaultSession, CHEMINS.coquille);
  servirApercus(session.defaultSession);
  brancherAppels();
  majEtat({ session: sessionActive() });

  const montrer = DIAGNOSTIC !== null || !LANCE_PAR_LA_SESSION || process.platform === 'linux';
  const coquille = JSON.parse(readFileSync(path.join(CHEMINS.marque, 'coquille.json'), 'utf8')) as {
    fond: string;
  };
  fenetre = creerFenetre({
    preload: CHEMINS.preload,
    icone: path.join(CHEMINS.marque, 'icon.png'),
    fond: coquille.fond,
    montrer,
    fermerCache: () => process.platform !== 'linux' || preferences().garderEnArrierePlan,
    surCachee: () => {
      if (preferences().fermetureDite) return;
      poserPreferences({ fermetureDite: true });
      notifier({
        titre: 'Hive continue en arrière-plan',
        corps: 'La ruche tourne toujours. Quittez-la depuis l’icône de la barre système.',
        route: '',
      });
    },
  });

  const notifier = notifierNatif(ouvrirRoute);
  if (DIAGNOSTIC === null) {
    creerBarre(CHEMINS.marque, {
      ouvrir: () => fenetre !== null && ramener(fenetre),
      redemarrer: () => void redemarrerLaRuche(),
      session: sessionActive,
      poserSession: (actif) => {
        poserSession(actif);
        majEtat({ session: sessionActive() });
      },
      arrierePlan: process.platform === 'linux' ? () => preferences().garderEnArrierePlan : null,
      poserArrierePlan: (actif) => poserPreferences({ garderEnArrierePlan: actif }),
      miseAJour: chercherMiseAJour,
      journaux: () => void shell.openPath(app.getPath('logs')),
      quitter: () => app.quit(),
    });
  }

  const hive = await chargerHive(CHEMINS.racineHive);
  ruche = new RucheBureau({
    hive,
    chemins: RUCHE,
    piece: CHEMINS.piece,
    envHerite: () => envHerite,
    notifier,
    journal,
    journalDePiece,
  });

  // L'écran suit la Reine : ouvert dès qu'elle s'annonce — sauf si l'accueil a
  // encore à dire (le diagnostic ne s'y arrête jamais) —, l'accueil et son
  // écran d'erreur dès qu'il y a une erreur (`pageVoulue`).
  surEtat((s) => {
    // La Reine partie, l'origine affichée ne vaut plus : la même, revenue
    // (relance sur le même port), se recharge.
    if (s.origine === null) origineMontree = null;
    const page = pageVoulue(s, origineMontree, accueilLu || DIAGNOSTIC !== null);
    if (page === 'accueil') montrerAccueil();
    else if (page === 'ecran') void montrerEcran();
  });
  ecouterLaRuche(notifier);

  const lienDeDepart = lienDansArgv(process.argv);
  if (lienDeDepart !== null) routeEnAttente = routeDepuisLien(lienDeDepart) ?? '#/';

  const lancer = DIAGNOSTIC !== null ? true : await reprendre();
  if (lancer) {
    await sauvegarderSiNouvelleVersion();
    rucheLancee = true;
    await ruche.demarrer();
  }

  if (DIAGNOSTIC !== null) {
    const code = await executerDiagnostic(path.resolve(DIAGNOSTIC), fenetre, app.getVersion());
    await arreterLaRuche();
    sortieEnCours = true;
    app.exit(code);
    return;
  }
  brancherMisesAJour({
    avantInstallation: arreterLaRuche,
    apresEchec: async () => {
      await ruche?.demarrer();
    },
    progression: (f) => fenetre?.setProgressBar(f ?? -1),
  });
}

void app.whenReady().then(() =>
  demarrer().catch((e: unknown) => {
    journal.error('démarrage :', e);
    if (DIAGNOSTIC !== null) {
      // Un rapport même ici : le banc doit lire POURQUOI, pas deviner d'un code.
      const erreur = e instanceof Error ? e.message : String(e);
      writeFileSync(
        path.resolve(DIAGNOSTIC),
        `${JSON.stringify({ erreur, defauts: [`erreur : ${erreur}`] }, null, 2)}\n`,
      );
      app.exit(2);
      return;
    }
    dialog.showErrorBox(
      'Hive ne démarre pas',
      `${e instanceof Error ? e.message : String(e)}\n\nLes journaux : ${app.getPath('logs')}`,
    );
    app.exit(1);
  }),
);
