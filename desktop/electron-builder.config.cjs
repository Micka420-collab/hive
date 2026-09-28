// LA CONFIGURATION DES PAQUETS DE L'APPLICATION DE BUREAU (ADR 0013).
//
//   Windows  NSIS assisté, par utilisateur, français + anglais, pages à la
//            marque, options (session, raccourci) et désinstallation qui garde
//            les données par défaut (`build/installer.nsh`)
//   macOS    DMG à fond dessiné, arm64 et x64
//   Linux    AppImage et .deb (catégorie Development, association hive://)
//
// ─── LA SIGNATURE EST PRÊTE, ET ÉTEINTE ──────────────────────────────────────
//
// Sans certificat, rien n'est signé et tout marche : macOS en signature ad hoc
// (`identity: '-'`, obligatoire sur Apple Silicon), Windows sans Authenticode.
// Chaque signature s'allume DÈS QUE ses secrets existent dans l'environnement
// du build — aucun autre changement (docs/APPLICATION.md § Signature) :
//
//   macOS    CSC_LINK + CSC_KEY_PASSWORD             → signe, hardened runtime
//            APPLE_API_KEY + _KEY_ID + _ISSUER       → notarise ; mises à jour auto
//   Windows  WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD     → Authenticode (.pfx)
//            ou AZURE_TENANT_ID/_CLIENT_ID/_CLIENT_SECRET
//               + AZURE_SIGN_ENDPOINT/_ACCOUNT/_PROFILE/_PUBLISHER → Trusted Signing
//
// ─── LA MARQUE VIENT D'UN SEUL DOSSIER ───────────────────────────────────────
//
// Icônes, bitmaps NSIS et fond du DMG : `branding/<thème>/sorties/`, thème
// nommé par `branding/actif` ou `HIVE_BRANDING`. Voir branding/LISEZMOI.md.

'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

const env = process.env;
const present = (...noms) => noms.every((n) => (env[n] ?? '').trim() !== '');

const theme =
  (env.HIVE_BRANDING ?? '').trim() ||
  readFileSync(path.join(__dirname, 'branding', 'actif'), 'utf8').trim() ||
  'neutre';
const marque = (fichier) => path.join('branding', theme, 'sorties', fichier);

// La version de l'app EST celle de Hive : un seul numéro par release
// (docs/RELEASING.md), lu dans le package.json de la racine.
const versionHive = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
).version;

const macSigne = present('CSC_LINK');
const macNotarise = macSigne && present('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER');
const azure =
  present('AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET') &&
  present(
    'AZURE_SIGN_ENDPOINT',
    'AZURE_SIGN_ACCOUNT',
    'AZURE_SIGN_PROFILE',
    'AZURE_SIGN_PUBLISHER',
  );

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.micka420collab.hive',
  productName: 'Hive',
  copyright: 'Copyright © Micka420-collab — MIT',
  directories: { output: 'release', buildResources: 'build' },
  extraMetadata: {
    version: versionHive,
    // Le nom de l'entrée de bureau que le .deb et l'AppImage installent : les
    // environnements de bureau y rattachent la fenêtre (WM_CLASS).
    desktopName: 'hive.desktop',
    // Lu par `mises-a-jour.ts` : macOS ne met à jour tout seul qu'une app signée.
    hiveSigne: macSigne,
  },
  files: [
    'dist/**/*',
    'app/preload.cjs',
    'accueil/**/*',
    'marque/**/*',
    'package.json',
    '!**/*.map',
  ],
  // Hors asar : la Reine et les ouvrières sont des enfants en mode Node qui
  // importent de l'ESM, servent des fichiers en flux et chargent un `.node`
  // (ADR 0013 § 3). `scripts/preparer-ruche.mjs` remplit `build/hive/`.
  //
  // Copié depuis `build/`, PAS depuis `build/hive/` : electron-builder écarte
  // SANS EXCEPTION le `node_modules` situé à la racine d'une source
  // (`createFilter`, app-builder-lib 26), filtre ou pas — et la Reine mourait
  // sur « @fastify/cors est absent » (mesuré). Un niveau plus bas, il passe.
  extraResources: [{ from: 'build', to: '.', filter: ['hive/**/*'] }],
  asar: true,
  electronFuses: {
    // ALLUMÉ, et c'est voulu : la Reine, les ouvrières et le pont MCP sont ce
    // binaire en mode Node (`ELECTRON_RUN_AS_NODE=1`, ADR 0013 § 2).
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  protocols: [{ name: 'Hive', schemes: ['hive'] }],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: marque('icon.ico'),
    ...(azure
      ? {
          azureSignOptions: {
            publisherName: env.AZURE_SIGN_PUBLISHER,
            endpoint: env.AZURE_SIGN_ENDPOINT,
            codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
            certificateProfileName: env.AZURE_SIGN_PROFILE,
          },
        }
      : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    installerLanguages: ['fr_FR', 'en_US'],
    language: '1036',
    multiLanguageInstaller: true,
    displayLanguageSelector: false,
    license: '../LICENSE',
    installerIcon: marque('icon.ico'),
    uninstallerIcon: marque('icon.ico'),
    installerHeaderIcon: marque('icon.ico'),
    installerSidebar: marque('installerSidebar.bmp'),
    uninstallerSidebar: marque('uninstallerSidebar.bmp'),
    installerHeader: marque('installerHeader.bmp'),
    // Le raccourci du bureau est une CASE de l'installeur (installer.nsh),
    // pas un geste imposé ; celui du menu Démarrer reste.
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'Hive',
    uninstallDisplayName: 'Hive',
    runAfterFinish: true,
    // Les données RESTENT par défaut (ADR 0004, 0013 § 11) : la case de
    // l'installeur, décochée, est le seul geste qui les efface.
    deleteAppDataOnUninstall: false,
    include: 'build/installer.nsh',
    artifactName: 'Hive-Setup-${version}.${ext}',
  },

  mac: {
    target: macSigne ? ['dmg', 'zip'] : ['dmg'],
    category: 'public.app-category.developer-tools',
    icon: marque('icon.icns'),
    // Sans certificat : signature ad hoc (Apple Silicon refuse un binaire non
    // signé du tout), sans hardened runtime ni notarisation.
    identity: macSigne ? undefined : '-',
    hardenedRuntime: macSigne,
    gatekeeperAssess: false,
    notarize: macNotarise,
  },
  dmg: {
    title: 'Hive ${version}',
    background: marque('background.png'),
    icon: marque('icon.icns'),
    iconSize: 100,
    window: { width: 540, height: 380 },
    // Les positions du fond (`gabarits/fond-dmg.html`) : elles bougent ensemble.
    contents: [
      { x: 140, y: 190, type: 'file' },
      { x: 400, y: 190, type: 'link', path: '/Applications' },
    ],
    artifactName: 'Hive-${version}-${arch}.${ext}',
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Development',
    icon: marque('icones'),
    executableName: 'hive',
    maintainer: 'Micka420-collab <Micka420-collab@users.noreply.github.com>',
    vendor: 'Micka420-collab',
    synopsis: 'La ruche de vos agents de code',
    description:
      'Hive orchestre vos agents de code (Claude Code, Codex, Cursor…) en local : ' +
      'une Reine, des ouvrières, et Mission Control dans une fenêtre.',
    desktop: {
      entry: {
        Name: 'Hive',
        Comment: 'La ruche de vos agents de code',
        Categories: 'Development;',
        StartupWMClass: 'Hive',
      },
    },
  },
  appImage: { artifactName: 'Hive-${version}-${arch}.${ext}' },
  deb: { artifactName: 'hive_${version}_${arch}.${ext}' },

  // Les Releases GitHub : electron-builder y dépose les paquets et les
  // `latest*.yml` que lit electron-updater — dans une Release BROUILLON. La
  // publier est un geste humain, et c'est lui qui déclenche les mises à jour
  // chez les utilisateurs (docs/RELEASING.md).
  publish: {
    provider: 'github',
    owner: 'Micka420-collab',
    repo: 'hive',
    releaseType: 'draft',
  },
};
