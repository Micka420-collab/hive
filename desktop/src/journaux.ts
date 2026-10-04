// Les journaux de l'app : `bureau.log` (la coquille), `reine.log`,
// `ouvriere-<agent>.log` — 5 Mo × 3 par fichier (ADR 0013 § 12).
//
// Une ruche lancée depuis une icône n'a pas de terminal : ces fichiers sont
// sa seule mémoire. La barre système les ouvre (« Journaux ») et l'écran
// d'erreur cite leurs dernières lignes.

import { existsSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main.js';

export const TAILLE_MAX = 5 * 1024 * 1024;
/** Le fichier courant plus deux archives : trois fichiers, 15 Mo au plus. */
export const ARCHIVES = 2;

type Journal = typeof log;

/** `x.log` → `x.1.log` → `x.2.log` ; la plus ancienne tombe. */
function archiver(fichier: string): void {
  const nom = (i: number): string => fichier.replace(/\.log$/, `.${String(i)}.log`);
  try {
    rmSync(nom(ARCHIVES), { force: true });
    for (let i = ARCHIVES - 1; i >= 1; i--) if (existsSync(nom(i))) renameSync(nom(i), nom(i + 1));
    renameSync(fichier, nom(1));
  } catch {
    // Un journal qu'on ne peut pas faire tourner continue de grossir : c'est
    // moins grave qu'une app qui s'arrête pour un fichier de journal.
  }
}

function regler(j: Journal, dossier: string, fichier: string, console: boolean): Journal {
  j.transports.file.resolvePathFn = () => path.join(dossier, fichier);
  j.transports.file.maxSize = TAILLE_MAX;
  j.transports.file.archiveLogFn = (ancien) => archiver(ancien.path);
  j.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  j.transports.console.level = console ? 'info' : false;
  return j;
}

let dossierJournaux = '';
const parPiece = new Map<string, Journal>();

/** Règle le journal de la coquille ; rend le dossier des journaux. */
export function ouvrirJournaux(dossier: string, dev: boolean): Journal {
  dossierJournaux = dossier;
  return regler(log, dossier, 'bureau.log', dev);
}

export const journal: Journal = log;

/** Le nom de fichier d'une pièce : `reine.log`, `ouvriere-claude-code.log`… */
export function fichierDePiece(nom: string): string {
  const court = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${court || 'piece'}.log`;
}

/** Le journal d'une pièce, créé à sa première ligne. */
export function journalDePiece(nom: string): Journal {
  const deja = parPiece.get(nom);
  if (deja) return deja;
  const j = regler(
    log.create({ logId: `piece-${nom}` }),
    dossierJournaux,
    fichierDePiece(nom),
    false,
  );
  parPiece.set(nom, j);
  return j;
}

/** Le chemin du journal d'une pièce — pour en citer la fin sur l'écran d'erreur. */
export function cheminJournalDePiece(nom: string): string {
  return path.join(dossierJournaux, fichierDePiece(nom));
}
