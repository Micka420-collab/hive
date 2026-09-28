// LE PILOTE D'UNE EXÉCUTION — Sandbox Live, côté nœud.
//
// ─── CE QU'IL POSSÈDE ────────────────────────────────────────────────────────
//
// Une instance par tâche en cours (`client.ts`). Elle tient ce que l'écran voit
// d'une exécution vivante, et ce qu'il peut y faire :
//
//   · la PHASE (préparation → agent → validations) et la COMMANDE courante ;
//   · le PROCESSUS de l'agent, que `exec.ts` lui attache au lancement
//     (`attacher`) — et, s'il tourne dans un conteneur, le nom du conteneur ;
//   · la MESURE de ce processus, relevée toutes les `INTERVALLE_METRIQUES_MS`
//     (`mesure-processus.ts`) ;
//   · la PAUSE, et les HORLOGES qu'elle doit suspendre.
//
// ─── LA PAUSE, ET POURQUOI ELLE ARRÊTE AUSSI LES HORLOGES ────────────────────
//
// Suspendre l'agent, c'est :
//
//   · POSIX, hors conteneur (processus, bubblewrap) : SIGSTOP à tout l'arbre,
//     du haut vers le bas, jusqu'à ce qu'aucun nouveau descendant n'apparaisse
//     — un parent arrêté ne peut plus rien lancer. SIGCONT à la reprise, à
//     chacun de ceux qu'on a arrêtés ;
//   · un conteneur (Podman, Docker) : `pause` / `unpause` du moteur, qui gèle
//     tout le conteneur par son cgroup — l'arbre de l'hôte n'y voit que le
//     client `docker run`, qu'arrêter ne gèlerait rien ;
//   · Windows hors conteneur : IMPOSSIBLE sans outil tiers. `pausable: false`,
//     et l'écran CACHE le bouton plutôt que d'offrir un geste qui échoue.
//
// Le délai dur de l'agent et le budget d'un enfant délégué sont des
// `MinuteurSuspendable` créés PAR le pilote (`minuteur`) : suspendus avec
// l'agent, repris avec lui. Sans cela, une pause de dix minutes volait dix
// minutes au budget — ou l'agent était tué pendant qu'il dormait.
//
// ─── UNE PAUSE N'EMPÊCHE JAMAIS UN ARRÊT ─────────────────────────────────────
//
// Un processus arrêté ne traite pas SIGTERM ; un conteneur en pause ne reçoit
// pas le signal que `docker run` lui relaie. Toute annulation reprend donc
// l'agent D'ABORD (`reprendre`), puis l'arrête — c'est l'ordre que suit le
// client (`annulerTache`, `stop`).

import { creerMinuteurSuspendable } from '../shared/minuteur-suspendable.js';
import type { MinuteurSuspendable } from '../shared/minuteur-suspendable.js';
import { INTERVALLE_METRIQUES_MS } from '../shared/bac-direct.js';
import type {
  EtatControleDirect,
  EtatDirect,
  MetriquesDirect,
  PhaseDirect,
} from '../shared/bac-direct.js';
import type { ValidationKey } from '../shared/validations-bac.js';
import {
  descendance,
  FORMAT_STATS_MOTEUR,
  lancerBorne,
  lireStatsMoteur,
  MesureArbre,
  tableDesProcessus,
} from './mesure-processus.js';
import type { ProcessusVu } from './mesure-processus.js';

/** Un conteneur à piloter par son moteur : le client, son nom, son environnement. */
export interface ConteneurPilote {
  bin: string;
  nom: string;
  env: NodeJS.ProcessEnv;
}

/** Ce que `exec.ts` attache au pilote quand il lance un processus. */
export interface ProcessusAttache {
  pid: number;
  /** La commande lancée, AVANT caviardage : le client caviarde ce qui part. */
  commande: string;
  conteneur?: ConteneurPilote;
}

/**
 * La face du pilote que voit un adaptateur (`AdapterContext.pilote`) : attacher
 * son processus, et armer un délai qui se suspend avec lui.
 */
export interface PiloteProcessus {
  /** Rend la fonction qui détache le processus (à sa sortie). */
  attacher(p: ProcessusAttache): () => void;
  minuteur(delaiMs: number, declencher: () => void): MinuteurSuspendable;
}

/** Ce que le pilote demande au système — injectable pour les bancs. */
export interface SondesPilote {
  plateforme: NodeJS.Platform;
  table(): Promise<ProcessusVu[] | null>;
  signaler(pid: number, signal: 'SIGSTOP' | 'SIGCONT'): void;
  moteur(
    bin: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ): Promise<{ code: number | null; sortie: string }>;
  maintenant(): number;
}

/** Une commande du moteur (`pause`, `stats`) : quinze secondes, puis on cesse d'attendre. */
const DELAI_MOTEUR_MS = 15_000;
/** Tours de SIGSTOP au plus : chaque tour arrête ce que le précédent a vu naître. */
const TOURS_ARRET_MAX = 8;

export const SONDES_REELLES: SondesPilote = {
  plateforme: process.platform,
  table: () => tableDesProcessus(process.platform),
  signaler: (pid, signal) => process.kill(pid, signal),
  moteur: (bin, args, env) => lancerBorne(bin, args, env, DELAI_MOTEUR_MS),
  maintenant: () => Date.now(),
};

interface Attache {
  p: ProcessusAttache;
  mesure: MesureArbre;
  minuteur: NodeJS.Timeout;
  /** Une mesure en vol : la suivante attend (un moteur lent ne s'empile pas). */
  enMesure: boolean;
}

export class PiloteExecution implements PiloteProcessus {
  private attache: Attache | null = null;
  private pause = false;
  /** Les pid arrêtés par SIGSTOP : exactement ceux que la reprise doit relancer. */
  private readonly arretes = new Set<number>();
  private readonly minuteurs = new Set<MinuteurSuspendable>();
  /** Une pause ou une reprise en cours : la suivante attend qu'elle ait conclu. */
  private geste: Promise<unknown> = Promise.resolve();
  private ferme = false;

  constructor(
    private readonly envoyer: (etat: EtatDirect) => void,
    private readonly sondes: SondesPilote = SONDES_REELLES,
    private readonly intervalleMs: number = INTERVALLE_METRIQUES_MS,
  ) {}

  get enPause(): boolean {
    return this.pause;
  }

  /** La pause est-elle possible pour ce qui tourne maintenant ? */
  private pausable(): boolean {
    if (!this.attache) return false;
    return this.attache.p.conteneur !== undefined || this.sondes.plateforme !== 'win32';
  }

  phase(phase: PhaseDirect, commande?: string): void {
    if (this.ferme) return;
    this.envoyer({ phase, ...(commande !== undefined ? { commande } : {}) });
  }

  controle(cle: ValidationKey, etat: EtatControleDirect): void {
    if (this.ferme) return;
    this.envoyer({ controles: { [cle]: etat } });
  }

  minuteur(delaiMs: number, declencher: () => void): MinuteurSuspendable {
    let m: MinuteurSuspendable | null = null;
    m = creerMinuteurSuspendable(delaiMs, () => {
      if (m) this.minuteurs.delete(m);
      declencher();
    });
    const suivi = m;
    // Né pendant une pause (un budget armé après coup) : il attend la reprise.
    if (this.pause) suivi.suspendre();
    this.minuteurs.add(suivi);
    return {
      suspendre: () => suivi.suspendre(),
      reprendre: () => suivi.reprendre(),
      annuler: () => {
        suivi.annuler();
        this.minuteurs.delete(suivi);
      },
      restant: () => suivi.restant(),
    };
  }

  attacher(p: ProcessusAttache): () => void {
    if (this.ferme) return () => undefined;
    this.detacher();
    const minuteur = setInterval(() => void this.mesurer(), this.intervalleMs);
    minuteur.unref?.();
    const attache: Attache = { p, mesure: new MesureArbre(p.pid), minuteur, enMesure: false };
    this.attache = attache;
    this.envoyer({ commande: p.commande, pausable: this.pausable(), enPause: false });
    // Une première mesure tout de suite : la mémoire se lit dès le premier
    // relevé (le CPU, lui, attend le second — voir `MesureArbre`).
    void this.mesurer();
    return () => {
      if (this.attache === attache) this.detacher();
    };
  }

  private detacher(): void {
    const a = this.attache;
    if (!a) return;
    clearInterval(a.minuteur);
    this.attache = null;
    this.arretes.clear();
    // Sorti pendant une pause (tué par un tiers) : le budget, lui, court encore
    // pour la suite de la tâche — validations comprises.
    if (this.pause) for (const m of this.minuteurs) m.reprendre();
    this.pause = false;
    if (!this.ferme) this.envoyer({ pausable: false, enPause: false, metriques: null });
  }

  private async mesurer(): Promise<void> {
    const a = this.attache;
    if (!a || a.enMesure) return;
    a.enMesure = true;
    let m: MetriquesDirect | null;
    try {
      if (a.p.conteneur) {
        const { bin, nom, env } = a.p.conteneur;
        const r = await this.sondes.moteur(
          bin,
          ['stats', '--no-stream', '--format', FORMAT_STATS_MOTEUR, nom],
          env,
        );
        m = r.code === 0 ? lireStatsMoteur(r.sortie) : null;
      } else {
        const table = await this.sondes.table();
        m = table ? a.mesure.relever(table, this.sondes.maintenant()) : null;
      }
    } catch {
      m = null;
    } finally {
      a.enMesure = false;
    }
    // Détaché entre-temps : la mesure d'un processus sorti ne s'affiche pas.
    if (this.attache !== a || this.ferme) return;
    // Rien de mesurable : « inconnu », jamais un zéro.
    this.envoyer({ metriques: m });
  }

  /** Les gestes s'enchaînent : une reprise attend la pause qui la précède. */
  private enchainer<T>(geste: () => Promise<T>): Promise<T> {
    const suite = this.geste.then(geste, geste);
    this.geste = suite.catch(() => undefined);
    return suite;
  }

  /** Suspend l'agent. Rend ce qui a VRAIMENT eu lieu, et le dit à l'écran. */
  suspendre(): Promise<boolean> {
    return this.enchainer(async () => {
      const a = this.attache;
      if (this.ferme || !a || !this.pausable()) {
        if (!this.ferme) this.envoyer({ pausable: this.pausable(), enPause: this.pause });
        return false;
      }
      if (this.pause) return true;
      const ok = a.p.conteneur
        ? await this.gesteMoteur(a.p.conteneur, 'pause')
        : await this.arreterArbre(a.p.pid);
      // Sorti ou détaché pendant le geste : il n'y a plus rien en pause.
      if (this.attache !== a) return false;
      if (ok) {
        this.pause = true;
        for (const m of this.minuteurs) m.suspendre();
      }
      this.envoyer({ enPause: this.pause });
      return ok;
    });
  }

  /** Reprend l'agent — et ses horloges. Sans effet s'il ne dormait pas. */
  reprendre(): Promise<boolean> {
    return this.enchainer(async () => {
      const a = this.attache;
      if (!a || !this.pause) return !this.pause;
      const ok = a.p.conteneur
        ? await this.gesteMoteur(a.p.conteneur, 'unpause')
        : this.relancerArbre();
      if (ok) {
        this.pause = false;
        for (const m of this.minuteurs) m.reprendre();
      }
      if (!this.ferme && this.attache === a) this.envoyer({ enPause: this.pause });
      return ok;
    });
  }

  private async gesteMoteur(c: ConteneurPilote, geste: 'pause' | 'unpause'): Promise<boolean> {
    try {
      return (await this.sondes.moteur(c.bin, [geste, c.nom], c.env)).code === 0;
    } catch {
      return false;
    }
  }

  /**
   * SIGSTOP du haut vers le bas, par tours : ce qu'un tour arrête ne lance
   * plus rien ; ce qu'il n'avait pas vu, le tour suivant l'arrête. Sans table
   * lisible, la racine seule — mieux que rien, et dit tel quel par l'arbre
   * mesuré.
   */
  private async arreterArbre(racine: number): Promise<boolean> {
    try {
      this.sondes.signaler(racine, 'SIGSTOP');
      this.arretes.add(racine);
    } catch {
      return false; // sorti : il n'y a rien à suspendre
    }
    for (let tour = 0; tour < TOURS_ARRET_MAX; tour += 1) {
      const table = await this.sondes.table();
      if (!table) break;
      const nouveaux = descendance(table, racine).filter((p) => !this.arretes.has(p.pid));
      if (nouveaux.length === 0) break;
      for (const p of nouveaux) {
        try {
          this.sondes.signaler(p.pid, 'SIGSTOP');
          this.arretes.add(p.pid);
        } catch {
          /* sorti entre la table et le signal */
        }
      }
    }
    return true;
  }

  /** SIGCONT à chacun de ceux qu'on a arrêtés. Synchrone : `stop()` du nœud s'en sert. */
  private relancerArbre(): boolean {
    for (const pid of this.arretes) {
      try {
        this.sondes.signaler(pid, 'SIGCONT');
      } catch {
        /* sorti pendant la pause (tué par un tiers) : plus rien à relancer */
      }
    }
    this.arretes.clear();
    return true;
  }

  /**
   * Reprise IMMÉDIATE, sans attendre : ce qu'on peut relancer sur-le-champ
   * (SIGCONT) l'est, un conteneur reçoit son `unpause` sans qu'on l'attende.
   * Pour l'arrêt du nœud, qui n'attend rien.
   */
  reprendreSansAttendre(): void {
    const a = this.attache;
    if (!a || !this.pause) return;
    if (a.p.conteneur) void this.gesteMoteur(a.p.conteneur, 'unpause');
    else this.relancerArbre();
    this.pause = false;
    for (const m of this.minuteurs) m.reprendre();
  }

  /** Fin de l'exécution : plus de mesure, plus d'envoi, plus d'horloge suivie. */
  fermer(): void {
    this.reprendreSansAttendre();
    this.ferme = true;
    this.detacher();
    this.minuteurs.clear();
  }
}
