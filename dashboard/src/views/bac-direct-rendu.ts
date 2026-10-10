// Sandbox Live — les décisions d'affichage, PURES et testées à part de React.
//
// Tout ce que la vue montre se décide ici : l'arbre des sous-agents, les étapes
// d'une exécution, les mesures (et quand elles sont « inconnues »), les gestes
// offerts. Rien n'y est estimé : une valeur absente reste absente, et le texte
// le dit.

import type {
  DirectTache,
  EtatControleDirect,
  MetriquesDirect,
  PhaseDirect,
} from '../../../src/shared/bac-direct.js';
import type { PresenceFichier } from '../../../src/shared/presence.js';
import type { HiveEvent, SubAgent, Task } from '../../../src/shared/types.js';
import { VALIDATION_KEYS } from '../../../src/shared/validations-bac.js';
import type { ValidationKey } from '../../../src/shared/validations-bac.js';

/** Un sous-agent et ceux qu'il a lancés. */
export interface NoeudSousAgent {
  agent: SubAgent;
  enfants: NoeudSousAgent[];
}

/**
 * L'arbre des sous-agents d'une exécution.
 *
 * Un parent INCONNU (hors de la liste — un nœud d'avant `parentId`, une borne
 * atteinte) place le sous-agent à la racine : l'arbre ne lie jamais ce que le
 * nœud n'a pas lié. Un cycle (un nœud qui mentirait) est coupé au premier
 * retour : chaque sous-agent paraît une fois.
 */
export function arbreSousAgents(agents: readonly SubAgent[]): NoeudSousAgent[] {
  const parId = new Map(agents.map((a) => [a.id, a]));
  const enfants = new Map<string, SubAgent[]>();
  const racines: SubAgent[] = [];
  for (const a of agents) {
    const parent = a.parentId !== undefined && a.parentId !== a.id ? parId.get(a.parentId) : null;
    if (!parent) {
      racines.push(a);
      continue;
    }
    const liste = enfants.get(parent.id) ?? [];
    liste.push(a);
    enfants.set(parent.id, liste);
  }
  const places = new Set<string>();
  const construire = (a: SubAgent): NoeudSousAgent => {
    places.add(a.id);
    return {
      agent: a,
      enfants: (enfants.get(a.id) ?? []).filter((e) => !places.has(e.id)).map(construire),
    };
  };
  const arbre = racines.map(construire);
  // Ce qu'aucune racine n'atteint vit dans un cycle : montré à la racine.
  for (const a of agents) if (!places.has(a.id)) arbre.push(construire(a));
  return arbre;
}

/** Les étapes affichées, dans l'ordre ; `fin` n'est jamais « en cours » ici. */
export const ETAPES = ['preparation', 'agent', 'validations'] as const;

export type EtatEtape = 'faite' | 'en_cours' | 'a_venir';

/**
 * L'état de chaque étape. Sans phase connue (un nœud d'avant Sandbox Live, ou
 * l'état pas encore arrivé), aucune étape n'est « en cours » : on ne devine pas.
 */
export function etatsDesEtapes(phase: PhaseDirect | undefined): Record<PhaseDirect, EtatEtape> {
  const i = phase === undefined ? -1 : ETAPES.indexOf(phase);
  return {
    preparation: i < 0 ? 'a_venir' : i === 0 ? 'en_cours' : 'faite',
    agent: i < 1 ? 'a_venir' : i === 1 ? 'en_cours' : 'faite',
    validations: i < 2 ? 'a_venir' : 'en_cours',
  };
}

/** Octets lisibles : « 312 Mio » en français, « 312 MiB » en anglais. */
export function octetsLisibles(n: number, lang: 'fr' | 'en' = 'fr'): string {
  if (n < 1024) return lang === 'fr' ? `${n} o` : `${n} B`;
  const unites = lang === 'fr' ? ['Kio', 'Mio', 'Gio', 'Tio'] : ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < unites.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${unites[u]}`;
}

/**
 * Les trois mesures, chacune lisible ou `null` (« inconnu » à l'écran) — et
 * QUELLE mémoire c'est (`natureMemoire`), telle que le nœud l'a dite.
 */
export function mesuresLisibles(
  direct: DirectTache | undefined,
  lang: 'fr' | 'en' = 'fr',
): {
  cpu: string | null;
  memoire: string | null;
  natureMemoire: NonNullable<MetriquesDirect['memoire']> | null;
  processus: string | null;
  source: 'arbre' | 'conteneur' | null;
} {
  const m = direct?.metriques;
  return {
    cpu: m?.cpuPct !== undefined ? `${m.cpuPct.toFixed(m.cpuPct >= 100 ? 0 : 1)} %` : null,
    memoire: m?.memoireOctets !== undefined ? octetsLisibles(m.memoireOctets, lang) : null,
    natureMemoire: m?.memoireOctets !== undefined ? (m.memoire ?? null) : null,
    processus: m?.processus !== undefined ? String(m.processus) : null,
    source: m?.source ?? null,
  };
}

/**
 * Le geste de pause offert : `pause`, `reprendre`, ou rien. Rien tant que le
 * nœud n'a pas DIT qu'il savait suspendre (`pausable`) — le bouton ne
 * s'affiche jamais pour un geste qui échouerait (Windows hors conteneur).
 * Une exécution en pause offre toujours de reprendre.
 */
export function gestePause(direct: DirectTache | undefined): 'pause' | 'reprendre' | null {
  if (direct?.enPause === true) return 'reprendre';
  return direct?.pausable === true ? 'pause' : null;
}

/** Les validations à afficher, dans l'ordre de #475 ; absentes si aucune n'a commencé. */
export function controlesAffiches(
  direct: DirectTache | undefined,
): Array<{ cle: ValidationKey; etat: EtatControleDirect | null }> {
  const c = direct?.controles;
  if (!c || Object.keys(c).length === 0) return [];
  return VALIDATION_KEYS.map((cle) => ({ cle, etat: c[cle] ?? null }));
}

/** Les exécutions vivantes (assignées ou en cours), la plus récente d'abord. */
export function executionsVivantes(tasks: readonly Task[]): Task[] {
  return tasks
    .filter((t) => t.status === 'assigned' || t.status === 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Les fichiers ouverts constatés d'une tâche : le DERNIER instantané de
 * présences journalisé pour elle (`task_progress`). Absent : rien de constaté.
 */
export function presencesDe(events: readonly HiveEvent[], taskId: string): PresenceFichier[] {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type !== 'task_progress' || ev.payload.taskId !== taskId) continue;
    if (Array.isArray(ev.payload.presences)) return ev.payload.presences as PresenceFichier[];
  }
  return [];
}
