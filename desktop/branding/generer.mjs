// LE GÉNÉRATEUR DE LA MARQUE — `npm --prefix desktop run marque`.
//
// Il rend, depuis `branding/<thème>/` (marque.json + icone.svg +
// barre-systeme.svg + gabarits), TOUT ce que l'app et ses installeurs
// montrent, dans `branding/<thème>/sorties/` :
//
//   icon.png (1024)          icônes/NxN.png (16 → 1024, Linux)
//   icon.ico (16 → 256)      icon.icns (16 → 1024, dont les @2x)
//   tray.png / tray@2x.png   trayTemplate.png / @2x (modèle macOS, noir)
//   installerSidebar.bmp     uninstallerSidebar.bmp   (164 × 314, 24 bits)
//   installerHeader.bmp      (150 × 57, 24 bits)
//   background.png / @2x     (fond du DMG, 540 × 380)
//   marque.css + polices/    (l'accueil de l'app)
//
// ─── POURQUOI DANS ELECTRON, ET SANS AUCUNE DÉPENDANCE D'IMAGE ───────────────
//
// Electron est déjà là (c'est l'app) et porte Chromium : il sait rendre un SVG
// et du HTML avec les vraies polices, au pixel. Les formats que Chromium ne
// sait pas écrire — ICO, ICNS, BMP — sont de simples conteneurs, écrits ici en
// quelques lignes. Les sorties sont VERSIONNÉES : la CI n'a pas besoin d'écran
// pour les produire, et un changement de marque se relit dans un diff.
//
// Lancement : `electron branding/generer.mjs` (sous Linux sans écran :
// `xvfb-run -a`). `HIVE_BRANDING=<thème>` remplace `branding/actif`.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const theme =
  (process.env.HIVE_BRANDING ?? '').trim() ||
  readFileSync(path.join(ICI, 'actif'), 'utf8').trim() ||
  'neutre';
const DOSSIER = path.join(ICI, theme);
const SORTIES = path.join(DOSSIER, 'sorties');
const marque = JSON.parse(readFileSync(path.join(DOSSIER, 'marque.json'), 'utf8'));

/** Le gabarit du thème s'il en a un, le gabarit commun sinon. */
function gabarit(nom) {
  const propre = path.join(DOSSIER, 'gabarits', nom);
  return readFileSync(existsSync(propre) ? propre : path.join(ICI, 'gabarits', nom), 'utf8');
}

/** `{{cle}}` → valeur ; une clé inconnue fait ÉCHOUER (un gabarit troué ne se publie pas). */
function remplir(texte, valeurs) {
  return texte.replace(/\{\{([\w-]+)\}\}/g, (_m, cle) => {
    if (!(cle in valeurs)) throw new Error(`gabarit : jeton inconnu {{${cle}}} (thème ${theme})`);
    return valeurs[cle];
  });
}

const couleurs = marque.couleurs;
const svgIcone = remplir(readFileSync(path.join(DOSSIER, 'icone.svg'), 'utf8'), couleurs);
const enDonnees = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const police = (cle) => pathToFileURL(path.resolve(DOSSIER, marque.polices[cle].fichier)).href;
const valeurs = {
  ...couleurs,
  nom: marque.nom,
  accroche: marque.accroche,
  icone: enDonnees(svgIcone),
  'police-titre': police('titre'),
  'police-texte': police('texte'),
};

// ─── Les conteneurs ──────────────────────────────────────────────────────────

/** ICO : un répertoire d'images PNG (accepté depuis Windows Vista). */
function ico(pngs) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);
  entete.writeUInt16LE(pngs.length, 4);
  let decalage = 6 + 16 * pngs.length;
  const entrees = pngs.map(({ taille, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(taille >= 256 ? 0 : taille, 0);
    e.writeUInt8(taille >= 256 ? 0 : taille, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(decalage, 12);
    decalage += png.length;
    return e;
  });
  return Buffer.concat([entete, ...entrees, ...pngs.map((p) => p.png)]);
}

/** ICNS : des blocs `type + longueur + PNG` (types PNG acceptés depuis macOS 10.7). */
function icns(blocs) {
  const corps = blocs.map(({ type, png }) => {
    const t = Buffer.alloc(8);
    t.write(type, 0, 'ascii');
    t.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([t, png]);
  });
  const total = 8 + corps.reduce((n, b) => n + b.length, 0);
  const t = Buffer.alloc(8);
  t.write('icns', 0, 'ascii');
  t.writeUInt32BE(total, 4);
  return Buffer.concat([t, ...corps]);
}

/** BMP 24 bits, lignes de bas en haut — ce que NSIS exige pour ses bitmaps. */
function bmp(image) {
  const { width: l, height: h } = image.getSize();
  const bgra = image.toBitmap();
  const ligne = Math.ceil((l * 3) / 4) * 4;
  const donnees = Buffer.alloc(ligne * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const s = (y * l + x) * 4;
      const d = (h - 1 - y) * ligne + x * 3;
      donnees[d] = bgra[s];
      donnees[d + 1] = bgra[s + 1];
      donnees[d + 2] = bgra[s + 2];
    }
  }
  const t = Buffer.alloc(54);
  t.write('BM', 0, 'ascii');
  t.writeUInt32LE(54 + donnees.length, 2);
  t.writeUInt32LE(54, 10);
  t.writeUInt32LE(40, 14);
  t.writeInt32LE(l, 18);
  t.writeInt32LE(h, 22);
  t.writeUInt16LE(1, 26);
  t.writeUInt16LE(24, 28);
  t.writeUInt32LE(donnees.length, 34);
  t.writeInt32LE(2835, 38);
  t.writeInt32LE(2835, 42);
  return Buffer.concat([t, donnees]);
}

// ─── Le rendu ────────────────────────────────────────────────────────────────

/** Rend un SVG en PNG à chaque taille demandée, par un canevas : transparence exacte. */
async function svgEnPng(fenetre, svg, tailles) {
  const script = `(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(enDonnees(svg))};
    await img.decode();
    const sorties = {};
    for (const t of ${JSON.stringify(tailles)}) {
      const c = document.createElement('canvas');
      c.width = t; c.height = t;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, t, t);
      sorties[t] = c.toDataURL('image/png').split(',')[1];
    }
    return sorties;
  })()`;
  const sorties = await fenetre.webContents.executeJavaScript(script);
  return Object.fromEntries(
    Object.entries(sorties).map(([t, b64]) => [Number(t), Buffer.from(b64, 'base64')]),
  );
}

/** Rend un gabarit HTML à sa taille exacte (× échelle) et rend l'image. */
async function htmlEnImage(html, largeur, hauteur, echelle = 1) {
  const f = new BrowserWindow({
    width: largeur,
    height: hauteur,
    useContentSize: true,
    show: false,
    frame: false,
    webPreferences: { offscreen: true, zoomFactor: echelle },
  });
  f.setContentSize(largeur * echelle, hauteur * echelle);
  const fichier = path.join(SORTIES, `.gabarit-${String(Date.now())}.html`);
  writeFileSync(fichier, html);
  try {
    await f.loadFile(fichier);
    await f.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await new Promise((r) => setTimeout(r, 300));
    let image = await f.webContents.capturePage({
      x: 0,
      y: 0,
      width: largeur * echelle,
      height: hauteur * echelle,
    });
    const { width, height } = image.getSize();
    if (width !== largeur * echelle || height !== hauteur * echelle) {
      image = image.resize({
        width: largeur * echelle,
        height: hauteur * echelle,
        quality: 'best',
      });
    }
    return image;
  } finally {
    rmSync(fichier, { force: true });
    f.destroy();
  }
}

async function generer() {
  mkdirSync(path.join(SORTIES, 'icones'), { recursive: true });
  const toile = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await toile.loadURL('data:text/html,<!doctype html><title>toile</title>');

  // ─── Les icônes ────────────────────────────────────────────────────────────
  const tailles = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const icones = await svgEnPng(toile, svgIcone, tailles);
  writeFileSync(path.join(SORTIES, 'icon.png'), icones[1024]);
  for (const t of tailles) writeFileSync(path.join(SORTIES, 'icones', `${t}x${t}.png`), icones[t]);
  writeFileSync(
    path.join(SORTIES, 'icon.ico'),
    ico([16, 24, 32, 48, 64, 128, 256].map((taille) => ({ taille, png: icones[taille] }))),
  );
  writeFileSync(
    path.join(SORTIES, 'icon.icns'),
    icns([
      { type: 'icp4', png: icones[16] },
      { type: 'icp5', png: icones[32] },
      { type: 'icp6', png: icones[64] },
      { type: 'ic07', png: icones[128] },
      { type: 'ic08', png: icones[256] },
      { type: 'ic09', png: icones[512] },
      { type: 'ic10', png: icones[1024] },
      { type: 'ic11', png: icones[32] },
      { type: 'ic12', png: icones[64] },
      { type: 'ic13', png: icones[256] },
      { type: 'ic14', png: icones[512] },
    ]),
  );

  // ─── La barre système ──────────────────────────────────────────────────────
  const barre = readFileSync(path.join(DOSSIER, 'barre-systeme.svg'), 'utf8');
  const couleur = await svgEnPng(
    toile,
    remplir(barre, { trait: couleurs.texte, coeur: couleurs.miel }),
    [32, 64],
  );
  writeFileSync(path.join(SORTIES, 'tray.png'), couleur[32]);
  writeFileSync(path.join(SORTIES, 'tray@2x.png'), couleur[64]);
  const modele = await svgEnPng(
    toile,
    remplir(barre, { trait: '#000000', coeur: '#000000' }),
    [16, 32],
  );
  writeFileSync(path.join(SORTIES, 'trayTemplate.png'), modele[16]);
  writeFileSync(path.join(SORTIES, 'trayTemplate@2x.png'), modele[32]);
  toile.destroy();

  // ─── L'installeur Windows ──────────────────────────────────────────────────
  const laterale = await htmlEnImage(remplir(gabarit('barre-laterale.html'), valeurs), 164, 314);
  writeFileSync(path.join(SORTIES, 'installerSidebar.bmp'), bmp(laterale));
  writeFileSync(path.join(SORTIES, 'uninstallerSidebar.bmp'), bmp(laterale));
  const tete = await htmlEnImage(remplir(gabarit('en-tete.html'), valeurs), 150, 57);
  writeFileSync(path.join(SORTIES, 'installerHeader.bmp'), bmp(tete));

  // ─── Le DMG ────────────────────────────────────────────────────────────────
  const fond = remplir(gabarit('fond-dmg.html'), valeurs);
  writeFileSync(path.join(SORTIES, 'background.png'), (await htmlEnImage(fond, 540, 380)).toPNG());
  writeFileSync(
    path.join(SORTIES, 'background@2x.png'),
    (await htmlEnImage(fond, 540, 380, 2)).toPNG(),
  );

  // ─── L'accueil de l'app : jetons CSS et polices ────────────────────────────
  mkdirSync(path.join(SORTIES, 'polices'), { recursive: true });
  const faces = [];
  for (const [cle, p] of Object.entries(marque.polices)) {
    const nom = path.basename(p.fichier);
    copyFileSync(path.resolve(DOSSIER, p.fichier), path.join(SORTIES, 'polices', nom));
    faces.push(
      `@font-face {\n  font-family: '${p.famille}';\n  src: url('polices/${nom}') format('woff2');\n` +
        `  font-weight: ${p.graisse};\n  font-display: swap;\n}\n/* ${cle} */`,
    );
  }
  const css = [
    `/* Généré par branding/generer.mjs depuis ${theme}/marque.json — ne pas éditer. */`,
    ...faces,
    ':root {',
    `  --fond: ${couleurs.fond};`,
    `  --panneau: ${couleurs.panneau};`,
    `  --bordure: ${couleurs.bordure};`,
    `  --texte: ${couleurs.texte};`,
    `  --attenue: ${couleurs.attenue};`,
    `  --miel: ${couleurs.miel};`,
    `  --miel-fonce: ${couleurs.mielFonce};`,
    `  --sur-miel: ${couleurs.surMiel};`,
    `  --succes: ${couleurs.succes};`,
    `  --alerte: ${couleurs.alerte};`,
    `  --halo: ${couleurs.halo};`,
    `  --police-titre: '${marque.polices.titre.famille}', system-ui, sans-serif;`,
    `  --police-texte: '${marque.polices.texte.famille}', system-ui, sans-serif;`,
    `  --police-code: '${marque.polices.code.famille}', ui-monospace, monospace;`,
    '}',
    '',
  ].join('\n');
  writeFileSync(path.join(SORTIES, 'marque.css'), css);
  console.log(
    `marque « ${theme} » générée dans ${path.relative(process.cwd(), SORTIES) || SORTIES}`,
  );
}

app.disableHardwareAcceleration();
// Sans cet écouteur, fermer la toile des icônes — la seule fenêtre ouverte à
// cet instant — quitterait l'app avant les gabarits.
app.on('window-all-closed', () => undefined);
app
  .whenReady()
  .then(generer)
  .then(
    () => app.exit(0),
    (e) => {
      console.error(e);
      app.exit(1);
    },
  );
