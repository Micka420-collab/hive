// La ruche de l'app : préparer son dossier, lancer la Reine et les ouvrières
// avec LE superviseur de Hive (`src/ruche-superviseur.ts`), relancer une Reine
// tombée, et dire tout ça à l'état de l'app.
//
// Rien ici ne décide de la composition : `pieces()` en mode `compile`,
// `planOuvrieres()` (une ouvrière par famille d'agent CONNECTÉE, #492) et la
// règle des morts sont ceux de `npm run ruche`. L'app ajoute seulement ce qui
// lui est propre — le dossier, le port gardé, l'amorce `piece.cjs`, les
// journaux par pièce, la politique de relance (ADR 0013 § 2).

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import type { Hive, PieceHive } from './contrat-hive.js';
import { type AgentVu, etat, majEtat } from './etat.js';
import { journal, journalDePiece } from './journaux.js';
import {
  NOTIFICATION_REINE_ARRETEE,
  notificationMortOuvriere,
  type NotificationRuche,
} from './notifications.js';
import { choisirPort, portGarde } from './port.js';
import { type CheminsRuche, envDeLaRuche, envDesEnfants } from './reglages.js';
import { prochaineRelance } from './relance.js';

/** Les dernières lignes gardées par pièce, pour l'écran d'erreur. */
const LIGNES_GARDEES = 40;

export interface OptionsRucheBureau {
  readonly hive: Hive;
  readonly chemins: CheminsRuche;
  /** `resources/hive/piece.cjs` : l'amorce qui retire `ELECTRON_RUN_AS_NODE` avant l'entrée. */
  readonly piece: string;
  /** L'environnement hérité (celui du shell de connexion, déjà fusionné). */
  readonly envHerite: () => NodeJS.ProcessEnv;
  readonly notifier: (n: NotificationRuche) => void;
}

type Lancee = ReturnType<Hive['superviseur']['lancerRuche']>;

export class RucheBureau {
  private lancee: Lancee | null = null;
  /** Le démarrage en cours : un second `demarrer()` l'attend au lieu d'en lancer un autre. */
  private demarrage: Promise<void> | null = null;
  private arretDemande = false;
  private relances: number[] = [];
  private minuteurRelance: NodeJS.Timeout | null = null;
  private readonly dernieres = new Map<string, string[]>();

  constructor(private readonly o: OptionsRucheBureau) {}

  /**
   * Lance la ruche. Résolue une fois les pièces parties — pas une fois la Reine
   * en ligne. UN démarrage à la fois : la sonde des agents et le port prennent
   * des secondes, et deux `demarrer()` croisés (la barre système pendant le
   * premier lancement) laissaient deux superviseurs, dont un que `arreter()`
   * ne voyait plus.
   */
  demarrer(): Promise<void> {
    this.demarrage ??= this.lancer().finally(() => {
      this.demarrage = null;
    });
    return this.demarrage;
  }

  private async lancer(): Promise<void> {
    if (this.lancee !== null) return;
    this.arretDemande = false;
    const { hive, chemins } = this.o;
    majEtat({ reine: 'demarrage', erreur: null, origine: null });

    // ─── Le dossier : privé, et le `.env` en 0600 ──────────────────────────
    this.preparerDossier();
    const existant = existsSync(chemins.env) ? readFileSync(chemins.env, 'utf8') : null;
    const avant = existant === null ? {} : parseEnv(existant);

    // ─── Le port : gardé, 7777 d'abord ──────────────────────────────────────
    const garde = portGarde(avant.HIVE_PORT);
    const { port, decision } = await choisirPort(garde);
    if (decision.genre === 'tirer' && decision.motif === 'occupe') {
      journal.warn(`port ${String(garde)} occupé : la ruche prend ${String(port)}`);
      majEtat({ portChange: port });
    }

    // ─── Les agents : une sonde, dont on tire le plan ET l'accueil ─────────
    const envEnfants = envDesEnfants(this.o.envHerite(), chemins, port);
    const inventaire = await hive.agents.inventaireAgents({ ...avant, ...envEnfants });
    const agents: AgentVu[] = [
      ...inventaire.tous
        .filter((a) => a !== 'shell')
        .map((a) => ({ agent: a, libelle: hive.libelles.libelleAgent(a), nonConnecte: null })),
      ...inventaire.nonConnectes.map((n) => ({
        agent: n.agent,
        libelle: hive.libelles.libelleAgent(n.agent),
        nonConnecte: n.detail,
      })),
    ];
    majEtat({ agents });

    // ─── Le `.env` : la recette de l'installeur, au port retenu ─────────────
    const contenu = envDeLaRuche(existant, port, hive.installeur);
    if (contenu !== existant) {
      hive.ecriture.ecrireAtomique(chemins.env, contenu, hive.ecriture.MODE_SECRET);
    }
    const envFichier = parseEnv(contenu);
    majEtat({ jeton: envFichier.HIVE_TOKEN ?? null });
    // Sans agent réel, la démo simulée vaut pour CE lancement — jamais écrite
    // dans le `.env` : une sonde qui n'a rien trouvé un jour (PATH d'un
    // lanceur, agent pas encore installé) ne condamne pas les lancements
    // suivants aux diffs simulés. Un `HIVE_SIMULATION` écrit à la main l'emporte.
    const sansAgentReel = !inventaire.tous.some((a) => a !== 'shell');
    const envLancement =
      sansAgentReel && envFichier.HIVE_SIMULATION === undefined
        ? { ...envEnfants, HIVE_SIMULATION: '1' }
        : envEnfants;

    // ─── La composition : celle de `npm run ruche`, en JavaScript compilé ───
    const plan = await hive.demarrage.planOuvrieres({
      argv: [],
      env: { ...envFichier, ...envLancement },
      hote: hostname(),
      detecter: () => Promise.resolve(inventaire.tous),
    });
    const liste = hive.demarrage
      .pieces(process.execPath, { hub: true, noeud: true }, port, plan, 'compile')
      .map((p) => this.amorcee(p));
    const nbOuvrieres = liste.filter((p) => p.ouvriere).length;
    let ouvrieresVivantes = nbOuvrieres;
    journal.info(`ruche : ${liste.map((p) => p.nom).join(', ')} · port ${String(port)}`);

    this.dernieres.clear();
    const lancee = hive.superviseur.lancerRuche({
      liste,
      cwd: chemins.ruche,
      env: envLancement,
      ligne: ({ piece, flux, texte }) => {
        const nom = piece?.nom ?? 'ruche';
        const j = piece === null ? journal : journalDePiece(nom);
        if (flux === 'stderr') j.warn(texte);
        else j.info(texte);
        const l = this.dernieres.get(nom) ?? [];
        l.push(texte);
        if (l.length > LIGNES_GARDEES) l.shift();
        this.dernieres.set(nom, l);
      },
      adresse: (a) => {
        journal.info(`la Reine s’est annoncée : ${a.http}`);
        majEtat({ reine: 'en-ligne', origine: a.http, ouvrieres: ouvrieresVivantes });
      },
      mort: (p, suite) => {
        journal.warn(`${p.nom} : ${suite.message}`);
        if (p.ouvriere) {
          ouvrieresVivantes -= 1;
          majEtat({ ouvrieres: ouvrieresVivantes });
          if (!suite.arreter) this.o.notifier(notificationMortOuvriere(p.nom, suite.message));
        }
      },
    });
    this.lancee = lancee;
    void lancee.fini.then((code) => {
      if (this.lancee === lancee) this.lancee = null;
      this.apresLaFin(code);
    });
  }

  /** Arrête la ruche proprement ; résolue quand la dernière pièce est sortie. */
  async arreter(): Promise<void> {
    this.arretDemande = true;
    if (this.minuteurRelance !== null) clearTimeout(this.minuteurRelance);
    this.minuteurRelance = null;
    // Un démarrage en vol finit d'abord : ses pièces sont à arrêter aussi.
    await this.demarrage?.catch(() => undefined);
    const l = this.lancee;
    if (l === null) return;
    l.arreter(0);
    await l.fini;
    majEtat({ reine: 'arretee', origine: null, ouvrieres: 0 });
  }

  async redemarrer(): Promise<void> {
    await this.arreter();
    this.relances = [];
    await this.demarrer();
  }

  /** Les dernières lignes d'une pièce — l'écran d'erreur les cite. */
  dernieresLignes(nom: string): readonly string[] {
    return this.dernieres.get(nom) ?? [];
  }

  /**
   * Le dossier de la ruche, créé privé (0700 hors Windows). Avant TOUT enfant :
   * un `spawn` dont le `cwd` n'existe pas échoue en ENOENT sur le BINAIRE — le
   * message accuse l'app, pas le dossier (mesuré sur l'import d'une ruche).
   */
  private preparerDossier(): void {
    mkdirSync(path.join(this.o.chemins.ruche, 'data'), { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(this.o.chemins.ruche, 0o700);
  }

  /** Lance un outil de la CLI de Hive (`hive sauvegarde`…) en mode Node, dans la ruche. */
  cli(
    args: readonly string[],
    envEnPlus: NodeJS.ProcessEnv = {},
  ): Promise<{ code: number; sortie: string }> {
    this.preparerDossier();
    const env = {
      ...envDesEnfants(this.o.envHerite(), this.o.chemins, 0),
      ...envEnPlus,
    };
    return lancerCli(this.o.piece, this.o.hive.fichiers.cli, args, this.o.chemins.ruche, env);
  }

  /** Pose l'amorce devant l'entrée compilée, en chemins absolus. */
  private amorcee(p: PieceHive): PieceHive {
    return {
      ...p,
      argv: [this.o.piece, ...p.argv.map((a) => path.resolve(this.o.hive.racine, a))],
    };
  }

  /** La ruche s'est arrêtée sans qu'on le demande : relancer, ou dire pourquoi. */
  private apresLaFin(code: number): void {
    if (this.arretDemande) return;
    const maintenant = Date.now();
    const delai = prochaineRelance(this.relances, maintenant);
    const lignes = this.dernieresLignes('reine');
    if (delai === null) {
      journal.error(`la ruche s’est arrêtée (code ${String(code)}) : plus de relance`);
      majEtat({
        reine: 'arretee',
        origine: null,
        ouvrieres: 0,
        erreur: {
          titre: 'La Reine s’est arrêtée, et ne redémarre pas.',
          lignes: lignes.slice(-20),
        },
      });
      // La fenêtre est souvent cachée dans la barre : l'écran d'erreur seul
      // passerait inaperçu.
      this.o.notifier(NOTIFICATION_REINE_ARRETEE);
      return;
    }
    this.relances.push(maintenant);
    journal.warn(
      `la ruche s’est arrêtée (code ${String(code)}) : relance dans ${String(delai)} ms`,
    );
    majEtat({ reine: 'relance', origine: null, ouvrieres: 0 });
    this.minuteurRelance = setTimeout(() => {
      this.minuteurRelance = null;
      if (this.arretDemande || etat().reine !== 'relance') return;
      this.demarrer().catch((e: unknown) => {
        journal.error(e);
        majEtat({
          reine: 'arretee',
          erreur: { titre: 'La ruche n’a pas pu redémarrer.', lignes: [String(e)] },
        });
      });
    }, delai);
  }
}

/** `hive <args>` par le binaire de l'app en mode Node, sortie recueillie. */
export function lancerCli(
  piece: string,
  cli: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; sortie: string }> {
  return new Promise((resoudre) => {
    const enfant = spawn(process.execPath, [piece, cli, ...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let sortie = '';
    enfant.stdout.setEncoding('utf8').on('data', (d: string) => (sortie += d));
    enfant.stderr.setEncoding('utf8').on('data', (d: string) => (sortie += d));
    enfant.on('error', (e) => resoudre({ code: 1, sortie: `${sortie}${e.message}` }));
    enfant.on('close', (code) => resoudre({ code: code ?? 1, sortie }));
  });
}
