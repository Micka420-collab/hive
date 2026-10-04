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
//     (`mesure-processus.ts`) — et son BILAN (`ressources`), ce que le
//     résultat de la tâche porte : la même mesure, cumulée, jamais celle du
//     processus du nœud ;
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
// pas le signal que `docker run` lui relaie. Toute fin d'exécution passe donc
// par `arreter` (annulation, arrêt du nœud, budget épuisé, drone perdant : le
// client l'accroche au signal d'annulation) ou par le détachement (sortie,
// délai dépassé) — et les deux RELANCENT ce qu'une pause a arrêté.
//
// Le piège est la pause EN VOL : ses tours de SIGSTOP (ou le `pause` du
// moteur) sont attendus, et l'arrêt peut tomber entre deux. Relancer « si
// `enPause` » ne voyait pas cette pause-là : elle concluait APRÈS, et l'arbre
// restait gelé pour toujours, SIGTERM en souffrance. D'où deux règles :
// `arreter` ferme la porte aux pauses (drapeau `arret`) et attend le geste en
// vol ; un geste qui conclut sur une exécution arrêtée ou détachée DÉFAIT ce
// qu'il vient de faire.
//
// ─── APRÈS UNE COUPURE, L'ÉTAT ENTIER ────────────────────────────────────────
//
// Le pilote n'envoie que ce qui change ; la Reine, elle, oublie l'état d'une
// tâche que la coupure d'un nœud a remise en file, puis la ré-adopte. Le
// pilote garde donc ce qu'il a dit (`connu`) et le redit en entier
// (`instantane`) à chaque inscription du nœud : sans lui, un agent en pause
// perdait son « en pause » et son bouton Reprendre — gelé pour de bon,
// horloges suspendues.

import { readFile } from 'node:fs/promises';
import { creerMinuteurSuspendable } from '../shared/minuteur-suspendable.js';
import type { MinuteurSuspendable } from '../shared/minuteur-suspendable.js';
import { fusionnerDirect, INTERVALLE_METRIQUES_MS } from '../shared/bac-direct.js';
import type {
  DirectTache,
  EtatControleDirect,
  EtatDirect,
  MetriquesDirect,
  PhaseDirect,
} from '../shared/bac-direct.js';
import type { RessourcesExecution } from '../shared/types.js';
import type { ValidationKey } from '../shared/validations-bac.js';
import {
  cpuDuCgroup,
  descendance,
  dossierCgroup,
  FORMAT_INSPECT_CGROUP,
  FORMAT_STATS_MOTEUR,
  lancerBorne,
  lireInspect,
  lireStatsMoteur,
  MesureArbre,
  picDuCgroup,
  relireArbreProc,
  tableDesProcessus,
} from './mesure-processus.js';
import type { BilanReleves, ProcessusVu } from './mesure-processus.js';

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
  /**
   * Relit un arbre parents d'abord (`relireArbreProc`), pour que le cumul de
   * son CPU ne compte personne deux fois. Absente : la table fait foi — sous
   * `ps`, aucun CPU ne passe d'un processus à l'autre.
   */
  relire?(arbre: readonly ProcessusVu[]): Promise<ProcessusVu[]>;
  /** Lit un petit fichier de l'hôte (`/proc`, `/sys/fs/cgroup`). Absente : aucun cgroup lu. */
  lireFichier?(chemin: string): Promise<string>;
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
  // `/proc` et `/sys/fs/cgroup` : Linux seulement.
  ...(process.platform === 'linux'
    ? { relire: relireArbreProc, lireFichier: (chemin: string) => readFile(chemin, 'utf8') }
    : {}),
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
  /** Un conteneur : ce que ses relevés ont vu (CPU du cgroup, mémoire du `stats`). */
  bilan: BilanReleves;
  /** Le plus haut `memory.peak` lu : le pic tenu par le noyau. */
  picNoyau?: number;
  /** Son dossier cgroup v2 : à chercher (`undefined`), introuvable ici (`null`), ou trouvé. */
  cgroup?: string | null;
}

/** Le bilan d'un conteneur : le pic du noyau, s'il a été lu, l'emporte sur les relevés. */
function bilanConteneur(a: Attache): BilanReleves {
  return a.picNoyau === undefined ? a.bilan : { ...a.bilan, picOctets: a.picNoyau, picNoyau: true };
}

export class PiloteExecution implements PiloteProcessus {
  private attache: Attache | null = null;
  /** Tout ce qui a été attaché, dans l'ordre : le bilan les additionne. */
  private readonly passages: Attache[] = [];
  private pause = false;
  /** Les pid arrêtés par SIGSTOP : exactement ceux que la reprise doit relancer. */
  private readonly arretes = new Set<number>();
  private readonly minuteurs = new Set<MinuteurSuspendable>();
  /** Une pause ou une reprise en cours : la suivante attend qu'elle ait conclu. */
  private geste: Promise<unknown> = Promise.resolve();
  private ferme = false;
  /** L'exécution est arrêtée (annulée, nœud arrêté…) : plus aucune pause. */
  private arret = false;
  /** Tout ce que le pilote a dit, fusionné comme la Reine le fait : `instantane` le redit. */
  private connu: DirectTache = { taskId: '', nodeId: '', majA: 0 };

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
    if (!this.attache || this.arret) return false;
    return this.attache.p.conteneur !== undefined || this.sondes.plateforme !== 'win32';
  }

  /** Envoie une mise à jour, et la retient pour `instantane`. */
  private emettre(maj: EtatDirect): void {
    if (this.ferme) return;
    this.connu = fusionnerDirect(this.connu, '', '', maj, 0);
    this.envoyer(maj);
  }

  phase(phase: PhaseDirect, commande?: string): void {
    this.emettre({ phase, ...(commande !== undefined ? { commande } : {}) });
  }

  controle(cle: ValidationKey, etat: EtatControleDirect): void {
    this.emettre({ controles: { [cle]: etat } });
  }

  /**
   * L'état ENTIER de l'exécution, redit d'un bloc — à chaque (ré)inscription
   * du nœud (voir l'en-tête). `pausable` et `enPause` sont relus maintenant,
   * pas recopiés : c'est ce qui est vrai à l'instant qui compte.
   */
  instantane(): void {
    if (this.ferme) return;
    const { phase, commande, metriques, controles } = this.connu;
    this.envoyer({
      ...(phase !== undefined ? { phase } : {}),
      ...(commande !== undefined ? { commande } : {}),
      pausable: this.pausable(),
      enPause: this.pause,
      ...(metriques !== undefined ? { metriques } : {}),
      ...(controles !== undefined ? { controles } : {}),
    });
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
    const attache: Attache = {
      p,
      mesure: new MesureArbre(p.pid),
      minuteur,
      enMesure: false,
      bilan: { releves: 0 },
    };
    this.attache = attache;
    this.passages.push(attache);
    this.emettre({ commande: p.commande, pausable: this.pausable(), enPause: false });
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
    // Détaché (sorti, délai dépassé, remplacé) : ce qu'une pause a arrêté est
    // RELANCÉ, jamais oublié — un petit-enfant orphelin resterait gelé, et
    // l'agent tué pendant sa pause ne traiterait pas son SIGTERM.
    this.relancerArbre();
    if (this.pause && a.p.conteneur) void this.gesteMoteur(a.p.conteneur, 'unpause');
    // Sorti pendant une pause (tué par un tiers) : le budget, lui, court encore
    // pour la suite de la tâche — validations comprises.
    if (this.pause) for (const m of this.minuteurs) m.reprendre();
    this.pause = false;
    this.emettre({ pausable: false, enPause: false, metriques: null });
  }

  private async mesurer(): Promise<void> {
    const a = this.attache;
    if (!a || a.enMesure) return;
    a.enMesure = true;
    let m: MetriquesDirect | null;
    try {
      if (a.p.conteneur) {
        const { bin, nom, env } = a.p.conteneur;
        const [r, cgroupLu] = await Promise.all([
          this.sondes.moteur(
            bin,
            ['stats', '--no-stream', '--format', FORMAT_STATS_MOTEUR, nom],
            env,
          ),
          this.releverCgroup(a),
        ]);
        m = r.code === 0 ? lireStatsMoteur(r.sortie) : null;
        // Le `stats` n'a pas de cumul : son CPU est un pourcentage de l'instant.
        // Sa mémoire, si, entre au bilan — un pic échantillonné.
        if (m?.rssOctets !== undefined) {
          a.bilan.picOctets = Math.max(a.bilan.picOctets ?? 0, m.rssOctets);
        }
        if (cgroupLu || m?.rssOctets !== undefined) a.bilan.releves += 1;
      } else {
        const table = await this.sondes.table();
        const arbre =
          table && this.sondes.relire
            ? await this.sondes.relire(descendance(table, a.p.pid))
            : table;
        m = arbre ? a.mesure.relever(arbre, this.sondes.maintenant()) : null;
      }
    } catch {
      m = null;
    } finally {
      a.enMesure = false;
    }
    // Détaché entre-temps : la mesure d'un processus sorti ne s'affiche pas.
    if (this.attache !== a || this.ferme) return;
    // Rien de mesurable : « inconnu », jamais un zéro.
    this.emettre({ metriques: m });
  }

  /**
   * Le cgroup v2 d'un conteneur — Linux, moteur local : trouvé une fois par
   * `inspect`, puis relu à chaque relevé (`mesure-processus.ts`). Vrai s'il a
   * rendu un nombre. Ne lève jamais : un cgroup absent laisse le `stats` seul.
   */
  private async releverCgroup(a: Attache): Promise<boolean> {
    const lire = this.sondes.lireFichier;
    const c = a.p.conteneur;
    if (!lire || !c || a.cgroup === null) return false;
    try {
      if (a.cgroup === undefined) {
        const r = await this.sondes.moteur(
          c.bin,
          ['inspect', '--format', FORMAT_INSPECT_CGROUP, c.nom],
          c.env,
        );
        // Pas encore lancé (ou déjà reparti) : le relevé suivant réessaiera.
        const vu = r.code === 0 ? lireInspect(r.sortie) : null;
        if (!vu) return false;
        // Un cgroup qui ne porte pas son identifiant n'est pas le sien : on
        // cesse de chercher, plutôt que de lire celui d'un inconnu.
        a.cgroup = dossierCgroup(vu.id, await lire(`/proc/${vu.pid}/cgroup`));
        if (a.cgroup === null) return false;
      }
      const dossier = a.cgroup;
      const [cpu, pic] = await Promise.all([
        lire(`${dossier}/cpu.stat`).then(cpuDuCgroup, () => null),
        lire(`${dossier}/memory.peak`).then(picDuCgroup, () => null),
      ]);
      if (cpu !== null) a.bilan.cpuMs = Math.max(a.bilan.cpuMs ?? 0, cpu);
      if (pic !== null) a.picNoyau = Math.max(a.picNoyau ?? 0, pic);
      return cpu !== null || pic !== null;
    } catch {
      return false;
    }
  }

  /**
   * Les ressources de l'AGENT pour cette exécution : le bilan des relevés de
   * tout ce qui a été attaché — ou POURQUOI rien ne se mesure, jamais un
   * nombre d'autre chose. Lu par le client quand l'agent a rendu, avant les
   * validations : comme sa durée, il décrit l'agent.
   *
   * Une exécution a UNE portée : le bac du nœud vaut pour toutes les commandes
   * de l'adaptateur (`exec.ts`).
   */
  ressources(): RessourcesExecution {
    if (this.passages.length === 0) return { portee: 'aucune', raison: 'aucun_processus' };
    const conteneur = this.passages.some((a) => a.p.conteneur !== undefined);
    if (!conteneur && this.sondes.plateforme === 'win32') {
      return { portee: 'aucune', raison: 'plateforme' };
    }
    let releves = 0;
    let cpuMs: number | undefined;
    let picOctets: number | undefined;
    let picNoyau = true;
    for (const a of this.passages) {
      const b = a.p.conteneur ? bilanConteneur(a) : a.mesure.bilan();
      if (b.releves === 0) continue;
      releves += b.releves;
      if (b.cpuMs !== undefined) cpuMs = (cpuMs ?? 0) + b.cpuMs;
      if (b.picOctets !== undefined) {
        picOctets = Math.max(picOctets ?? 0, b.picOctets);
        picNoyau &&= b.picNoyau === true;
      }
    }
    if (cpuMs === undefined && picOctets === undefined) {
      return { portee: 'aucune', raison: 'aucun_releve' };
    }
    return {
      portee: conteneur ? 'conteneur' : 'arbre',
      releves,
      ...(cpuMs !== undefined ? { cpuMs } : {}),
      ...(picOctets !== undefined ? { picOctets } : {}),
      ...(picOctets !== undefined && picNoyau ? { picNoyau: true as const } : {}),
    };
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
        this.emettre({ pausable: this.pausable(), enPause: this.pause });
        return false;
      }
      if (this.pause) return true;
      const ok = a.p.conteneur
        ? await this.gesteMoteur(a.p.conteneur, 'pause')
        : await this.arreterArbre(a);
      // Arrêtée, sortie ou détachée PENDANT le geste : il ne doit rien rester
      // en pause. Ce que ce geste vient d'arrêter est défait ici — personne
      // d'autre ne le relancera (voir l'en-tête).
      if (this.arret || this.attache !== a) {
        if (ok && a.p.conteneur) await this.gesteMoteur(a.p.conteneur, 'unpause');
        else this.relancerArbre();
        return false;
      }
      if (ok) {
        this.pause = true;
        for (const m of this.minuteurs) m.suspendre();
      }
      this.emettre({ enPause: this.pause });
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
      if (this.attache === a) this.emettre({ enPause: this.pause });
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
  private async arreterArbre(a: Attache): Promise<boolean> {
    const racine = a.p.pid;
    try {
      this.sondes.signaler(racine, 'SIGSTOP');
      this.arretes.add(racine);
    } catch {
      return false; // sorti : il n'y a rien à suspendre
    }
    for (let tour = 0; tour < TOURS_ARRET_MAX; tour += 1) {
      const table = await this.sondes.table();
      // Arrêtée ou détachée entre deux tours : on n'arrête plus rien de neuf
      // (`suspendre` relance ce qui l'a déjà été).
      if (this.arret || this.attache !== a) break;
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

  /** SIGCONT à chacun de ceux qu'on a arrêtés. Synchrone : `arreter` s'en sert sur-le-champ. */
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
   * L'exécution s'arrête (annulation, arrêt du nœud, budget épuisé) : plus
   * aucune pause possible, et ce qui dort est relancé SUR-LE-CHAMP — SIGCONT
   * est synchrone, et c'est ce qu'il faut à `stop()` du nœud, qui n'attend
   * rien. La promesse rendue attend en plus le `unpause` d'un conteneur et le
   * geste en vol, qui se défait de lui-même : qui l'attend (`annulerTache`)
   * n'envoie son SIGTERM qu'à un agent éveillé. Idempotent.
   */
  arreter(): Promise<void> {
    const dejaArrete = this.arret;
    this.arret = true;
    const a = this.attache;
    let reveil: Promise<unknown> = Promise.resolve();
    if (a && this.pause) {
      if (a.p.conteneur) reveil = this.gesteMoteur(a.p.conteneur, 'unpause');
      else this.relancerArbre();
      this.pause = false;
      for (const m of this.minuteurs) m.reprendre();
    }
    if (a && !dejaArrete) this.emettre({ pausable: false, enPause: false });
    return Promise.all([reveil, this.enchainer(() => Promise.resolve())]).then(() => undefined);
  }

  /** Fin de l'exécution : plus de mesure, plus d'envoi, plus d'horloge suivie. */
  fermer(): void {
    // Fermé D'ABORD : l'exécution a rendu son résultat, plus rien ne part.
    this.ferme = true;
    void this.arreter();
    this.detacher();
    this.minuteurs.clear();
  }
}
