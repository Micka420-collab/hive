// `--diagnostic=<fichier>` : l'app se lance, prouve qu'elle marche, l'écrit,
// et s'arrête.
//
// C'est le banc de fumée des paquets (ADR 0013, Conséquences) : en CI sur
// Windows, macOS et Linux, et à la main ici, l'artefact INSTALLÉ est lancé
// avec ce drapeau. Le rapport dit si la Reine s'est annoncée, si
// `/api/health` répond `{ ok: true }`, si la fenêtre est sur l'origine de la
// Reine avec l'écran rendu, s'il y a eu des violations de CSP — et porte une
// capture de la fenêtre. Le verdict est `defautsDuRapport`, le même que relit
// `scripts/fumee.mjs`.

import { writeFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import { type RapportDiagnostic, defautsDuRapport } from './diagnostic-verdict.js';
import { etat } from './etat.js';
import { journal } from './journaux.js';

/** Au-delà, le diagnostic rend ce qu'il a — une ruche qui ne démarre pas est un verdict. */
const DELAI_MS = 150_000;
/** Le temps que l'écran se connecte et se rende après son chargement. */
const RENDU_MS = 4_000;

export function argumentDiagnostic(argv: readonly string[]): string | null {
  const a = argv.find((x) => x.startsWith('--diagnostic='));
  return a === undefined ? null : a.slice('--diagnostic='.length) || null;
}

const attendre = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Attend que la Reine soit en ligne ET que la fenêtre ait fini de charger son
 * origine. Sondé, pas écouté : `did-finish-load` tire quand `isLoading()` est
 * encore vrai (mesuré), et une attente sur événement manquerait sa fin.
 */
async function ecranCharge(fenetre: BrowserWindow, delaiMs: number): Promise<void> {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    const o = etat().origine;
    const url = fenetre.webContents.getURL();
    if (o !== null && url.startsWith(`${o}/`) && !fenetre.webContents.isLoading()) return;
    await attendre(250);
  }
  throw new Error(`rien d’utilisable en ${String(delaiMs / 1000)} s (reine : ${etat().reine})`);
}

export async function executerDiagnostic(
  fichier: string,
  fenetre: BrowserWindow,
  version: string,
): Promise<number> {
  const rapport: {
    -readonly [K in keyof RapportDiagnostic]: RapportDiagnostic[K];
  } = {
    version,
    plateforme: `${process.platform}-${process.arch}`,
    reine: { enLigne: false, origine: null },
    sante: { statut: null, corps: null },
    ecran: { url: null, rendu: false, titre: null },
    csp: { posee: false, violations: [] },
    ouvrieres: 0,
    capture: null,
    erreur: null,
  };
  try {
    await ecranCharge(fenetre, DELAI_MS);
    await attendre(RENDU_MS);

    const e = etat();
    rapport.reine = { enLigne: e.reine === 'en-ligne', origine: e.origine };
    rapport.ouvrieres = e.ouvrieres;
    if (e.origine !== null) {
      const r = await fetch(`${e.origine}/api/health`);
      rapport.sante = { statut: r.status, corps: (await r.json()) as unknown };
    }
    const vu = (await fenetre.webContents.executeJavaScript(
      `({ rendu: (document.querySelector('#root')?.childElementCount ?? 0) > 0, titre: document.title })`,
    )) as { rendu: boolean; titre: string };
    rapport.ecran = { url: fenetre.webContents.getURL(), rendu: vu.rendu, titre: vu.titre };
    // La CSP est-elle POSÉE ? `eval` est refusé par `script-src 'self'` : s'il
    // passe, l'en-tête n'a pas atteint la page. Sondé APRÈS avoir relevé les
    // violations — la sonde en provoque une, voulue.
    const violations = [...etat().cspViolations];
    const posee = (await fenetre.webContents.executeJavaScript(
      `(() => { try { return eval('1') !== 1; } catch { return true; } })()`,
    )) as boolean;
    rapport.csp = { posee, violations };

    const image = await fenetre.webContents.capturePage();
    const png = `${fichier.replace(/\.json$/, '')}.png`;
    writeFileSync(png, image.toPNG());
    rapport.capture = png;
  } catch (e) {
    rapport.erreur = e instanceof Error ? e.message : String(e);
    // Ce qu'on sait quand même : un rapport d'échec doit dire OÙ ça s'est arrêté.
    const e2 = etat();
    rapport.reine = { enLigne: e2.reine === 'en-ligne', origine: e2.origine };
    rapport.ecran = { ...rapport.ecran, url: fenetre.webContents.getURL() };
  }
  const defauts = defautsDuRapport(rapport);
  writeFileSync(fichier, `${JSON.stringify({ ...rapport, defauts }, null, 2)}\n`);
  journal.info(`diagnostic : ${defauts.length === 0 ? 'vert' : defauts.join(' ; ')}`);
  return defauts.length === 0 ? 0 : 1;
}
