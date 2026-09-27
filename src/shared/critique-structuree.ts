// La critique STRUCTURÉE — ce qu'un relecteur a trouvé, rangé par gravité et
// par critère, au lieu d'une liste de phrases.
//
// ─── CE QUE LA CRITIQUE LIBRE NE SAVAIT PAS DIRE ─────────────────────────────
//
// La relecture libre (« valide » ou « conteste », puis une objection par ligne,
// `lireAvis`) ne rend qu'un booléen. Deux défauts en découlaient :
//
//   · toute ligne à puce était une OBJECTION, et une objection conteste. Un
//     relecteur qui validait en signalant une coquille relançait le
//     producteur : un vrai appel de modèle, un essai de `maxAttempts` brûlé,
//     pour une remarque que personne ne jugeait bloquante ;
//   · rien ne distinguait une faille de sécurité d'un nom de variable. Ni
//     l'Evaluator, ni l'humain de la Miellerie, ni la tentative suivante ne
//     savaient par quoi commencer, ni sur quel critère la production pèche.
//
// ─── LE MARQUEUR ─────────────────────────────────────────────────────────────
//
// Le relecteur TERMINE sa réponse par une ligne :
//
//   HIVE_CRITIQUE {"verdict":"valide|conteste","findings":[{"severite":…,
//                  "critere":…,"fichier":…,"preuve":…,"proposition":…}]}
//
// De la même famille que `HIVE_PROPOSITION` / `HIVE_AVIS` du Conseil
// (eclaireuse.ts) : une ligne JSON, en tout dernier, et la DERNIÈRE ligne qui
// commence par le marqueur fait foi. Pas la dernière LISIBLE : un marqueur
// cité plus haut — recopié d'un diff hostile qui en contenait un tout prêt,
// « valide » et sans constat — ne remplace jamais celui que le relecteur a
// raté en dernier.
//
// Il n'est lu QUE dans le texte final du relecteur (`finalText`), jamais dans
// ses logs : Codex y répète la consigne, qui contient un exemple de marqueur.
//
// ─── CE QUI BLOQUE ───────────────────────────────────────────────────────────
//
// Décision produit : un constat `bloquant` ou `majeur` FORCE la contestation,
// même sous un verdict « valide » — le relecteur a trouvé un défaut, et c'est
// le défaut qui compte, pas la case cochée. `mineur` et `info` ne bloquent
// JAMAIS : ce sont des remarques, affichées et transmises à la tentative
// suivante, qui ne rouvrent pas une production. Un « conteste » écrit reste une
// contestation : Hive ne transforme jamais en feu vert un verdict qui demande
// de regarder.
//
// ─── ILLISIBLE ⇒ TEXTE LIBRE, JAMAIS UNE EXCEPTION ──────────────────────────
//
// Un marqueur mal formé (JSON cassé, sévérité ou critère hors grille, preuve
// absente…) n'est pas lu à moitié : il est écarté EN ENTIER, et la réponse se
// lit comme une critique libre, avec les règles d'avant. Garder les constats
// valides d'un marqueur en partie faux perdrait en silence celui qui ne
// l'était pas — peut-être le seul majeur. L'écart est consigné
// (`marqueur: 'illisible'` dans le verdict) : une critique retombée en texte
// libre se voit.
//
// Module PUR, sans I/O : la Reine lit et agrège, le dashboard compte les
// critères, avec les mêmes fonctions.

import { champSurUneLigne } from './donnees-non-fiables.js';

/** Du plus grave au plus léger : l'ordre d'affichage et de survie aux bornes. */
export const SEVERITES = ['bloquant', 'majeur', 'mineur', 'info'] as const;
export type Severite = (typeof SEVERITES)[number];

/** La grille des critères, fermée : un critère inventé rend le marqueur illisible. */
export const CRITERES = [
  'correction',
  'securite',
  'tests',
  'performance',
  'lisibilite',
  'conformite',
] as const;
export type Critere = (typeof CRITERES)[number];

/** Les sévérités qui forcent la contestation — et elles seules. */
const SEVERITES_BLOQUANTES: ReadonlySet<Severite> = new Set<Severite>(['bloquant', 'majeur']);

/** Ce qu'un relecteur a trouvé, une chose à la fois. */
export interface Constat {
  readonly severite: Severite;
  readonly critere: Critere;
  /** Le fichier visé ; `null` quand le constat ne tient pas à un fichier. */
  readonly fichier: string | null;
  /** Ce que le relecteur a VU — sans preuve, ce n'est pas un constat. */
  readonly preuve: string;
  /** Ce qu'il propose ; vide quand il ne propose rien. */
  readonly proposition: string;
}

/**
 * Les bornes d'un constat, et de leur nombre.
 *
 * Le marqueur doit tenir dans la FIN que garde un texte final coupé
 * (`borneTexteFinal` garde les 2 000 premiers caractères et les ~6 000
 * derniers) : la consigne demande donc au plus 8 constats d'une phrase. Les
 * bornes ci-dessous sont celles de la LECTURE, plus larges — un constat trop
 * long est tronqué, pas refusé.
 */
export const BORNES_CONSTAT = {
  /** Au-delà, les moins graves tombent (voir `ordonnerConstats`). */
  nombre: 20,
  fichier: 200,
  preuve: 300,
  proposition: 300,
} as const;

/** Un constat qui force la contestation. */
export function constatBloquant(constat: Constat): boolean {
  return SEVERITES_BLOQUANTES.has(constat.severite);
}

/**
 * La forme nue d'un mot de la grille : sans accent ni majuscule. « Sécurité »
 * et « Majeur » disent `securite` et `majeur` — la grille est une consigne,
 * pas une garantie de casse ; la décomposer (NFD) puis retirer les marques
 * combinantes suffit, parce qu'aucun mot de la grille n'en porte.
 */
function motNu(v: unknown): string {
  return typeof v === 'string'
    ? v.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase()
    : '';
}

/** Un champ texte facultatif : absent ou `null` ⇒ vide, autre chose qu'un texte ⇒ illisible. */
function texteFacultatif(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? champSurUneLigne(v, max).trim() : null;
}

/** Un constat lu, ou `null` s'il ne respecte pas la grille. */
function lireConstat(brut: unknown): Constat | null {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return null;
  const o = brut as Record<string, unknown>;
  const severite = SEVERITES.find((s) => s === motNu(o.severite));
  const critere = CRITERES.find((c) => c === motNu(o.critere));
  const preuve = texteFacultatif(o.preuve, BORNES_CONSTAT.preuve);
  const fichier = texteFacultatif(o.fichier, BORNES_CONSTAT.fichier);
  const proposition = texteFacultatif(o.proposition, BORNES_CONSTAT.proposition);
  if (!severite || !critere || !preuve || fichier === null || proposition === null) return null;
  return { severite, critere, fichier: fichier || null, preuve, proposition };
}

/**
 * Dédoublonne, trie du plus grave au plus léger (stable), et borne.
 *
 * Le tri PRÉCÈDE la borne : quand il faut en laisser tomber, ce sont les
 * remarques, jamais un constat bloquant — qui disparaîtrait de la preuve
 * qu'un humain relit alors qu'il a contesté la production.
 */
export function ordonnerConstats(constats: readonly Constat[]): Constat[] {
  const vus = new Set<string>();
  const uniques: Constat[] = [];
  for (const c of constats) {
    const cle = JSON.stringify([c.severite, c.critere, c.fichier, c.preuve, c.proposition]);
    if (vus.has(cle)) continue;
    vus.add(cle);
    uniques.push(c);
  }
  return uniques
    .map((c, i) => ({ c, i }))
    .sort((a, b) => SEVERITES.indexOf(a.c.severite) - SEVERITES.indexOf(b.c.severite) || a.i - b.i)
    .slice(0, BORNES_CONSTAT.nombre)
    .map(({ c }) => c);
}

/**
 * Des constats venus d'ailleurs que de ce module — le marqueur d'un relecteur,
 * un payload du journal — relus à la grille. Tout ou rien : un seul constat
 * hors grille rend `null` (voir l'en-tête). Ordonnés et bornés.
 */
export function lireConstats(brut: unknown): Constat[] | null {
  if (!Array.isArray(brut)) return null;
  const constats: Constat[] = [];
  for (const b of brut as unknown[]) {
    const c = lireConstat(b);
    if (!c) return null;
    constats.push(c);
  }
  return ordonnerConstats(constats);
}

/** Ce que le marqueur final a donné. */
export type LectureMarqueur =
  /** Aucune ligne ne commence par le marqueur : une critique libre. */
  | { readonly etat: 'absent' }
  /** La dernière ligne-marqueur ne respecte pas le contrat : lue en texte libre. */
  | { readonly etat: 'illisible' }
  | {
      readonly etat: 'lu';
      /** Vrai si le relecteur a écrit « conteste » OU relevé un constat bloquant. */
      readonly conteste: boolean;
      readonly constats: readonly Constat[];
    };

export const MARQUEUR_CRITIQUE = 'HIVE_CRITIQUE';

// `[\s\S]` et non `.` : `.` ne traverse ni U+2028 ni U+2029, qu'un modèle
// peut écrire bruts dans une chaîne JSON — le marqueur serait lu illisible
// pour un séparateur invisible (voir la même leçon dans `lireAvis`).
const LIGNE_MARQUEUR = new RegExp(`^\\s*${MARQUEUR_CRITIQUE}[ \\t]+(\\{[\\s\\S]*\\})\\s*$`);

/**
 * Lit le marqueur final d'une réponse de relecteur. Ne lève jamais.
 *
 * `findings` absent vaut une liste vide : « valide » sans rien à signaler est
 * la réponse la plus naturelle, et elle est complète.
 */
export function lireMarqueurCritique(texte: string): LectureMarqueur {
  const lignes = texte.split(/\r?\n/);
  let derniere: string | undefined;
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (lignes[i]!.trimStart().startsWith(MARQUEUR_CRITIQUE)) {
      derniere = lignes[i]!;
      break;
    }
  }
  if (derniere === undefined) return { etat: 'absent' };
  const illisible = { etat: 'illisible' } as const;
  const m = LIGNE_MARQUEUR.exec(derniere);
  if (!m) return illisible;
  let brut: unknown;
  try {
    brut = JSON.parse(m[1]!);
  } catch {
    return illisible;
  }
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return illisible;
  const o = brut as Record<string, unknown>;
  const verdict = motNu(o.verdict);
  if (verdict !== 'valide' && verdict !== 'conteste') return illisible;
  const constats = o.findings === undefined ? [] : lireConstats(o.findings);
  if (constats === null) return illisible;
  return {
    etat: 'lu',
    conteste: verdict === 'conteste' || constats.some(constatBloquant),
    constats,
  };
}

/**
 * Un constat en une ligne, bornée comme une objection libre (300) : c'est
 * sous cette forme qu'un constat bloquant devient une OBJECTION — lue par
 * l'Evaluator, la War Room, la contre-visite et la tentative suivante, qui
 * n'ont pas à connaître la grille pour le montrer.
 */
export function texteConstat(c: Constat): string {
  const lieu = c.fichier ? `${c.fichier} — ` : '';
  const suite = c.proposition ? ` → ${c.proposition}` : '';
  return champSurUneLigne(`[${c.severite} · ${c.critere}] ${lieu}${c.preuve}${suite}`, 300).trim();
}

/** Combien de constats un critère a reçus, par sévérité. */
export interface CompteCritere {
  readonly critere: Critere;
  readonly total: number;
  /** Toutes les sévérités, zéros compris : l'écran choisit ce qu'il tait. */
  readonly parSeverite: Readonly<Record<Severite, number>>;
}

/**
 * Les constats comptés par critère — dans l'ordre de la grille, seulement les
 * critères touchés. Des comptes, pas une note : une note unique cacherait
 * QUEL critère a péché, c'est-à-dire la seule chose utile.
 */
export function compterParCritere(constats: readonly Constat[]): CompteCritere[] {
  return CRITERES.flatMap((critere) => {
    const siens = constats.filter((c) => c.critere === critere);
    if (siens.length === 0) return [];
    const parSeverite = Object.fromEntries(
      SEVERITES.map((s) => [s, siens.filter((c) => c.severite === s).length]),
    ) as Record<Severite, number>;
    return [{ critere, total: siens.length, parSeverite }];
  });
}
