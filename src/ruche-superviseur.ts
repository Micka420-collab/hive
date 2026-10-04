// LE SUPERVISEUR DE LA RUCHE — la partie impure de `npm run ruche`, en module.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `scripts/ruche.mjs` lançait, préfixait, écoutait les morts et arrêtait les
// pièces, dans un script qui s'exécute à l'import. L'application de bureau
// (ADR 0013 § 2) doit faire EXACTEMENT la même chose — même annonce de la
// Reine, même ordre d'arrêt sous Windows, même règle de mort (`suiteDUneMort`).
// Une seconde copie dans l'app, c'était deux superviseurs qui divergent au
// premier correctif : celui de la ligne perdue sans `\n`, celui du code de
// sortie rendu 0 sur une ruche amputée, celui des agents orphelins sous
// Windows — trois défauts déjà payés, chacun dans UN des deux.
//
// Il n'y a donc qu'UN superviseur. `ruche.mjs` l'appelle depuis un terminal,
// l'app depuis son processus principal ; ce qui diffère — où vont les lignes,
// que faire d'une mort, quand sortir — passe en rappels.
//
// ─── CE QU'IL NE DÉCIDE PAS ──────────────────────────────────────────────────
//
// La composition (quelles pièces, quel ordre, quel lien à la Reine) et chaque
// règle de mort vivent dans `shared/demarrage.ts`, pur et éprouvé. Ici : le
// `spawn`, les tuyaux, les signaux, les minuteurs.

import { type ChildProcess, spawn } from 'node:child_process';
import { GRACE_ARRET_MS, emporterArbre } from './shared/arbre-processus.js';
import {
  DELAI_ANNONCE_REINE_MS,
  ORDRE_ARRET,
  type Piece,
  type SuiteDUneMort,
  aUnCanal,
  adresseAnnoncee,
  attendLaReine,
  decouperLignes,
  derniereLigne,
  envDePiece,
  largeurEtiquettes,
  prefixe,
  reliquat,
  silenceDeLaReine,
  suiteDUneMort,
} from './shared/demarrage.js';
import type { AdresseRuche } from './shared/port.js';

/** Le flux d'où vient une ligne : la sortie d'un enfant, ou le superviseur lui-même. */
export type FluxRuche = 'stdout' | 'stderr';

/** Ce que l'appelant fournit au superviseur. */
export interface OptionsRuche {
  /** Les pièces, dans l'ordre de `pieces()`. */
  readonly liste: readonly Piece[];
  /** Le dossier courant des enfants : c'est là que la Reine lit son `.env`. */
  readonly cwd: string;
  /** L'environnement de base des enfants (défaut : celui de ce processus). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Chaque ligne ENTIÈRE d'un enfant, déjà préfixée (`etiquette`). Le
   * superviseur y dit aussi ses propres messages (morts, silence de la Reine),
   * avec `piece: null` — hors d'un enfant, rien ne doit se perdre.
   */
  readonly ligne: (l: {
    readonly piece: Piece | null;
    readonly flux: FluxRuche;
    readonly etiquette: string;
    readonly texte: string;
  }) => void;
  /** L'adresse que la Reine a annoncée — une fois. */
  readonly adresse?: (adresse: AdresseRuche) => void;
  /** Une pièce est morte sans qu'on l'ait arrêtée, et ce que la ruche en fait. */
  readonly mort?: (piece: Piece, suite: SuiteDUneMort) => void;
}

/** La ruche lancée. */
export interface RucheLancee {
  /**
   * Arrête tout, une seule fois, et rend le code DEMANDÉ quand la dernière
   * pièce est sortie — ou au bout de la grâce, les retardataires emportés.
   */
  readonly arreter: (code: number) => void;
  /** Résolue une fois la ruche arrêtée, par `arreter` ou par une mort fatale. */
  readonly fini: Promise<number>;
  /** Les enfants lancés — pour un appelant qui voudrait les compter. */
  readonly enfants: readonly ChildProcess[];
}

/** Windows n'a ni signaux qu'un gestionnaire reçoive, ni groupes de processus. */
const WINDOWS = process.platform === 'win32';

/**
 * Lance la ruche : la Reine d'abord, puis, à SON annonce, ceux qui la rejoignent.
 *
 * Les règles sont celles qu'écrivait `ruche.mjs` et que ses commentaires
 * justifient : une ligne n'est rendue qu'entière (`decouperLignes`), la
 * dernière sans `\n` n'est pas perdue (`reliquat`), une mort se tranche une
 * fois le tuyau d'erreur vidé (une seconde au plus), et l'arrêt passe par le
 * canal IPC sous Windows (`ORDRE_ARRET`).
 */
export function lancerRuche(o: OptionsRuche): RucheLancee {
  const largeur = largeurEtiquettes(o.liste);
  const envBase = o.env ?? process.env;
  const enfants: ChildProcess[] = [];
  /** Ceux qui n'ont pas encore rendu leur `exit` — la ruche finit quand il n'y en a plus. */
  const vivants = new Set<ChildProcess>();
  let onFerme = false;
  let codeDemande = 0;
  let ouvrieresEnPlace = o.liste.filter((p) => p.ouvriere).length;
  const aLAnnonce = o.liste.filter(attendLaReine);

  let resoudre: (code: number) => void = () => undefined;
  const fini = new Promise<number>((r) => {
    resoudre = r;
  });
  let resolu = false;
  const terminer = (): void => {
    if (resolu) return;
    resolu = true;
    resoudre(codeDemande);
  };

  const dire = (texte: string): void =>
    o.ligne({ piece: null, flux: 'stderr', etiquette: '', texte });

  function brancher(
    p: Piece,
    flux: NodeJS.ReadableStream | null,
    nom: FluxRuche,
    etiquette: string,
    retenir: (lignes: readonly string[]) => void = () => undefined,
  ): void {
    if (flux === null) return;
    let reste = '';
    flux.setEncoding('utf8');
    flux.on('data', (bout: string) => {
      const debit = decouperLignes(reste, bout);
      reste = debit.reste;
      retenir(debit.lignes);
      for (const texte of debit.lignes) o.ligne({ piece: p, flux: nom, etiquette, texte });
    });
    flux.on('end', () => {
      const fin = reliquat(reste);
      retenir(fin);
      for (const texte of fin) o.ligne({ piece: p, flux: nom, etiquette, texte });
    });
  }

  function lancer(p: Piece, reine: AdresseRuche | null): void {
    if (onFerme) return;
    const pose = envDePiece(p, reine);
    const enfant = spawn(p.bin, [...p.argv], {
      cwd: o.cwd,
      shell: false,
      windowsHide: true,
      // Un canal IPC pour la Reine (elle s'y annonce) et les ouvrières : c'est
      // par lui qu'elles reçoivent l'ordre d'arrêt sous Windows.
      stdio: aUnCanal(p) ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      env: pose ? { ...envBase, ...pose } : envBase,
    });
    enfants.push(enfant);
    vivants.add(enfant);
    const etiquette = prefixe(p.nom, largeur);
    // Sa dernière phrase d'erreur, pour la citer s'il meurt.
    let derniere: string | null = null;
    brancher(p, enfant.stdout, 'stdout', etiquette);
    brancher(p, enfant.stderr, 'stderr', etiquette, (lignes) => {
      derniere = derniereLigne(lignes, derniere);
    });

    enfant.on('error', (e) => {
      // Un `spawn` impossible (binaire absent) : `exit` ne viendra jamais.
      vivants.delete(enfant);
      dire(`${etiquette}✘ ${e.message}`);
      arreter(1);
      if (vivants.size === 0) terminer();
    });

    // La mort d'une pièce se tranche une fois sa dernière phrase LUE : `exit`
    // peut tirer avant que le tuyau soit vidé. Une seconde au plus — un
    // petit-enfant qui garderait le tuyau ouvert ne retient pas la décision.
    enfant.on('exit', (code, signal) => {
      vivants.delete(enfant);
      let tranche = false;
      const trancher = (): void => {
        if (tranche) return;
        tranche = true;
        if (onFerme) {
          if (vivants.size === 0) terminer();
          return;
        }
        if (p.ouvriere) ouvrieresEnPlace -= 1;
        const suite = suiteDUneMort({
          piece: p,
          code,
          signal,
          ouvrieresRestantes: ouvrieresEnPlace,
          derniere,
        });
        o.mort?.(p, suite);
        dire(`${etiquette}${suite.message}`);
        if (suite.arreter) arreter(suite.code);
        if (vivants.size === 0 && onFerme) terminer();
      };
      if (enfant.stderr === null || enfant.stderr.readableEnded) return trancher();
      enfant.stderr.once('end', trancher);
      setTimeout(trancher, 1_000).unref();
    });

    if (p.reine === 'annonce') {
      enfant.on('message', (message: unknown) => {
        const adresse = adresseAnnoncee(message);
        if (adresse === null || onFerme) return;
        o.adresse?.(adresse);
        // `splice` vide la file : une seconde annonce ne relance personne.
        for (const q of aLAnnonce.splice(0)) lancer(q, adresse);
      });
    }
  }

  /**
   * Demande à UNE pièce de s'arrêter, comme elle sait l'entendre : SIGTERM sous
   * POSIX ; sous Windows, où `kill('SIGTERM')` est un `TerminateProcess`,
   * l'ordre d'arrêt par le canal — et l'arbre emporté si le canal est fermé.
   */
  function demanderArret(e: ChildProcess): void {
    if (!WINDOWS) {
      e.kill('SIGTERM');
      return;
    }
    if (!e.connected) {
      emporterArbre(e, 'SIGKILL');
      return;
    }
    e.send(ORDRE_ARRET, (erreur) => {
      if (erreur) emporterArbre(e, 'SIGKILL');
    });
  }

  function arreter(code: number): void {
    if (onFerme) return;
    onFerme = true;
    codeDemande = code;
    // Ceux qui attendaient l'annonce ne partiront plus.
    aLAnnonce.splice(0);
    if (vivants.size === 0) {
      terminer();
      return;
    }
    for (const e of vivants) demanderArret(e);
    // La même attente que `ruche.mjs` : la grâce des agents d'une ouvrière
    // (`GRACE_ARRET_MS`), plus une seconde pour sortir. Au-delà, ce qui vit
    // encore part — sous Windows comme un ARBRE (ses agents avec lui), sous
    // POSIX par SIGKILL : une Reine restée derrière garderait le verrou de sa
    // base, et le prochain démarrage échouerait sur « base déjà tenue ».
    setTimeout(() => {
      for (const e of vivants) {
        if (WINDOWS) emporterArbre(e, 'SIGKILL');
        else e.kill('SIGKILL');
      }
      terminer();
    }, GRACE_ARRET_MS + 1_000).unref();
  }

  for (const p of o.liste) if (!attendLaReine(p)) lancer(p, null);

  // Une Reine vivante qui ne s'annonce jamais laisserait ouvrières et écran
  // non lancés sans une ligne : le minuteur les nomme (`silenceDeLaReine`).
  if (aLAnnonce.length > 0) {
    setTimeout(() => {
      const message = silenceDeLaReine(aLAnnonce, onFerme);
      if (message !== null) dire(message);
    }, DELAI_ANNONCE_REINE_MS).unref();
  }

  if (o.liste.length === 0) {
    onFerme = true;
    terminer();
  }

  return { arreter, fini, enfants };
}
