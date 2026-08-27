// L'HORLOGE, CÔTÉ ÉCRAN — ce que la ruche a annoncé, replié depuis le flux.
//
// ─── POURQUOI PAS UN ENDPOINT ────────────────────────────────────────────────
//
// L'annonce est DÉJÀ dans le flux : `envoyerTache` émet `duree_annoncee` au
// moment exact où elle est posée, et le tick émet `duree_hors_domaine` quand la
// tâche sort du domaine connu. Ouvrir une route pour relire la table
// `annonces_duree` ajouterait un aller-retour, un cache à invalider et une
// seconde vérité à tenir d'accord avec la première. Le flux suffit, et il
// arrive déjà.
//
// ─── CE QUE CE REPLI PROMET, ET CE QU'IL NE PROMET PAS ───────────────────────
//
// Le journal est BORNÉ (`pruneEvents`). Une annonce assez vieille n'est plus
// dans la fenêtre : ce module rend alors « rien » pour cette tâche, et l'écran
// n'affiche rien. C'est juste — une annonce qu'on ne peut plus produire ne doit
// pas être reconstituée de mémoire.
//
// D'où les DEUX moitiés INDÉPENDANTES de `VueHorloge` : l'avertissement
// « hors domaine » arrive parfois alors que l'annonce, elle, est déjà sortie de
// la fenêtre. Exiger l'annonce pour afficher l'alerte ferait taire le signal
// précisément sur les tâches les plus longues — celles qui ont eu le plus de
// temps pour perdre leur annonce, et les seules pour qui l'alerte compte.

import type { HiveEvent } from '../../src/shared/types.js';
import type { Calibration, Socle } from '../../src/shared/horloge-chantier.js';

/** L'annonce telle qu'elle a été posée, avec la taille de son socle. */
export interface AnnonceVue {
  readonly socle: Socle;
  readonly n: number;
  readonly p50Ms: number;
  readonly p80Ms: number;
}

export interface VueHorloge {
  /** Absente si l'annonce est sortie de la fenêtre du journal. */
  readonly annonce?: AnnonceVue;
  /** Présent si la ruche a signalé la sortie du domaine connu. */
  readonly horsDomaine?: { readonly ecouleMs: number; readonly recordMs: number };
}

const SOCLES: readonly Socle[] = ['exact', 'caste', 'global', 'aucun'];

function texte(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * Un nombre utilisable, ou rien.
 *
 * `Number.isFinite` et pas `typeof === 'number'` : `NaN` est un `number`, et
 * un `NaN` qui traverse rendrait « NaN min » à l'écran plutôt qu'un silence.
 */
function nombre(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function socleDe(v: unknown): Socle | null {
  const s = texte(v);
  return s !== null && (SOCLES as readonly string[]).includes(s) ? (s as Socle) : null;
}

/**
 * Le repli du journal en annonces, par tâche.
 *
 * ─── LA DERNIÈRE ANNONCE GAGNE, ET C'EST VOULU ───────────────────────────────
 *
 * Une tâche re-livrée (nœud muet, filet de re-livraison) est ré-annoncée : la
 * ruche a repris l'historique du moment. Garder la première ferait afficher une
 * annonce que la tâche en vol ne suit plus. Les événements arrivent dans
 * l'ordre du journal, donc écraser suffit — pas de comparaison d'horodatage à
 * tenir juste.
 *
 * L'alerte hors domaine, elle, ne s'écrase pas d'une annonce : elle est émise
 * UNE SEULE FOIS PAR TÂCHE côté serveur, et une re-livraison qui la ferait
 * disparaître de l'écran effacerait le seul signal qu'on avait.
 */
export function annoncesDepuisEvenements(
  events: readonly HiveEvent[],
): ReadonlyMap<string, VueHorloge> {
  const par = new Map<string, VueHorloge>();
  for (const ev of events) {
    if (ev.type !== 'duree_annoncee' && ev.type !== 'duree_hors_domaine') continue;
    const taskId = texte(ev.payload.taskId);
    if (taskId === null || taskId === '') continue;
    const avant = par.get(taskId);

    if (ev.type === 'duree_annoncee') {
      const socle = socleDe(ev.payload.socle);
      const n = nombre(ev.payload.n);
      const p50Ms = nombre(ev.payload.p50Ms);
      const p80Ms = nombre(ev.payload.p80Ms);
      if (socle === null || n === null || p50Ms === null || p80Ms === null) continue;
      par.set(taskId, { ...avant, annonce: { socle, n, p50Ms, p80Ms } });
      continue;
    }

    const ecouleMs = nombre(ev.payload.ecouleMs);
    const recordMs = nombre(ev.payload.recordMs);
    if (ecouleMs === null || recordMs === null) continue;
    par.set(taskId, { ...avant, horsDomaine: { ecouleMs, recordMs } });
  }
  return par;
}

/**
 * L'annonce, confrontée à ce qui est arrivé.
 *
 * ─── LA PIÈCE SANS LAQUELLE TOUT LE RESTE EST DU DÉCOR ───────────────────────
 *
 * Une annonce qu'on n'oppose jamais au réel ne coûte rien à faire et ne vaut
 * rien : personne ne peut dire si elle valait quelque chose. C'est ce verdict,
 * lisible sur chaque tâche finie, qui rend l'horloge réfutable à l'œil nu —
 * la même chose que `calibrer()` fait en gros, rendue au cas par cas.
 *
 * ─── ET LE PIÈGE QU'IL FAUT REFUSER ──────────────────────────────────────────
 *
 * Sur socle `aucun`, `p80Ms` vaut 0 : la ruche n'a RIEN annoncé, elle a dit
 * « je ne sais pas encore ». Comparer le réel à ce 0 rendrait « débordée » sur
 * TOUTES ces tâches — on noterait comme une prédiction ratée un refus de
 * prédire. C'est exactement l'incitation qu'il ne faut pas créer : elle pousse
 * à chiffrer coûte que coûte pour ne plus avoir l'air d'échouer.
 */
export type VerdictAnnonce = 'tenue' | 'debordee' | 'sans_objet';

export function verdictAnnonce(annonce: AnnonceVue | undefined, reelMs: number): VerdictAnnonce {
  if (annonce === undefined || annonce.socle === 'aucun') return 'sans_objet';
  if (!Number.isFinite(reelMs) || reelMs < 0) return 'sans_objet';
  return reelMs <= annonce.p80Ms ? 'tenue' : 'debordee';
}

/** La note de l'horloge, telle que le tick l'a inscrite. */
export interface NoteVue {
  readonly verdict: Calibration['verdict'];
  readonly n: number;
  readonly partTenue: number;
  readonly ecart: number;
}

const VERDICTS: readonly Calibration['verdict'][] = [
  'honnete',
  'optimiste',
  'pessimiste',
  'trop_peu',
];

/**
 * La DERNIÈRE note inscrite dans la fenêtre du journal.
 *
 * ─── LA DERNIÈRE, ET RIEN QUE LA DERNIÈRE ────────────────────────────────────
 *
 * Une note n'est pas un événement qui s'accumule : c'est un ÉTAT. Les
 * précédentes sont de l'histoire, lisible dans la Chronique — l'écran, lui, ne
 * doit montrer que celle qui vaut maintenant. Afficher une note périmée à côté
 * d'une plus fraîche serait pire que ne rien afficher.
 *
 * Rien dans la fenêtre ⇒ rien à l'écran. C'est le même refus que pour l'annonce
 * absente : « le journal ne s'en souvient plus » ne se dit pas « la ruche ne
 * s'est pas notée ».
 */
export function calibrationDepuisEvenements(events: readonly HiveEvent[]): NoteVue | undefined {
  let vue: NoteVue | undefined;
  for (const ev of events) {
    if (ev.type !== 'horloge_calibration') continue;
    const brut = texte(ev.payload.verdict);
    const verdict = VERDICTS.find((v) => v === brut);
    const n = nombre(ev.payload.n);
    const partTenue = nombre(ev.payload.partTenue);
    const ecart = nombre(ev.payload.ecart);
    if (verdict === undefined || n === null || partTenue === null || ecart === null) continue;
    vue = { verdict, n, partTenue, ecart };
  }
  return vue;
}

/** La note, dite comme un humain la lit. */
export function direNote(note: NoteVue, lang: 'fr' | 'en' = 'fr'): string {
  if (note.verdict === 'trop_peu') {
    return lang === 'en'
      ? `not enough judged announcements (${note.n})`
      : `pas assez d’annonces jugées (${note.n})`;
  }
  const part = `${Math.round(note.partTenue * 100)} %`;
  if (lang === 'en') {
    const mot =
      note.verdict === 'honnete'
        ? 'honest'
        : note.verdict === 'optimiste'
          ? 'optimistic'
          : 'pessimistic';
    return `${mot} — ${part} held, aim 80 % (${note.n} obs.)`;
  }
  const mot =
    note.verdict === 'honnete'
      ? 'honnête'
      : note.verdict === 'optimiste'
        ? 'optimiste'
        : 'pessimiste';
  return `${mot} — ${part} tenues, visée 80 % (${note.n} obs.)`;
}
