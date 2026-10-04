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
// (eclaireuse.ts) : une ligne JSON, EN TOUT DERNIER. Seule la dernière ligne
// non vide fait foi (une clôture de bloc « ``` » qui la suit est tolérée, comme
// la puce ou les accents graves dont un modèle l'habille). Une ligne-marqueur
// ailleurs — citée d'un diff hostile qui en contenait une toute prête,
// « valide » et sans constat — ne décide JAMAIS, ni à la place du marqueur
// du relecteur ni À CÔTÉ de lui (citée dans un bloc après le sien) : une
// réponse qui porte plus d'une ligne-marqueur est `illisible`, lue en texte
// libre, et contestée. Prendre « la dernière ligne qui commence par
// le marqueur » laissait un relecteur qui CITAIT l'injection, écrivait
// « conteste » et oubliait son propre marqueur… approuver la production.
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
// libre se voit. Et elle n'APPROUVE jamais (`lireAvis`) : le marqueur écarté
// portait peut-être le seul majeur — une sévérité en anglais (« major »), un
// critère hors grille — et la prose « valide » qui l'accompagne ne dit rien de
// lui. Pire, le JSON écarté contient lui-même le mot « valide » : lu en texte
// libre, il approuvait la production qu'il contestait.
//
// ─── LE SCHÉMA : LE MÊME AVIS, IMPOSÉ PAR LE CLI ─────────────────────────────
//
// Un CLI relecteur qui sait contraindre sa réponse finale reçoit cette grille
// en JSON Schema (`SCHEMA_AVIS`) : Claude Code par `--json-schema`, Codex par
// `--output-schema` (adapters/). L'avis qu'il rend est alors un OBJET, que le
// nœud écrit en ligne-marqueur (`ligneAvis`) : il n'y a qu'UNE lecture, celle
// d'ici, que l'avis vienne d'un schéma ou d'une ligne écrite par le modèle. Un
// avis structuré hors grille est donc illisible comme un marqueur hors grille
// — contesté, et dit — jamais un feu vert.
//
// Module PUR, sans I/O : la Reine lit et agrège, le dashboard compte les
// critères, avec les mêmes fonctions.

import { champSurUneLigne } from './donnees-non-fiables.js';
import { COUPURE_TEXTE_FINAL } from './protocol.js';

/** Les deux verdicts qu'un relecteur peut écrire — fermés, comme la grille. */
export const VERDICTS = ['valide', 'conteste'] as const;

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
  /**
   * Un marqueur est là mais ne décide pas : mal formé, hors grille, pas en
   * dernière ligne, ou coupé avec le texte. La réponse est lue en texte libre.
   */
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
const LIGNE_MARQUEUR = new RegExp(`^${MARQUEUR_CRITIQUE}[ \\t]+(\\{[\\s\\S]*\\})$`);

/** Une clôture de bloc de code seule sur sa ligne — tolérée APRÈS le marqueur. */
const CLOTURE_DE_BLOC = /^\s*(?:`{3,}|~{3,})\s*$/;

/**
 * La ligne sans l'habillage qu'un modèle lui met : puce ou numéro de liste,
 * accents graves de code en ligne. `HIVE_CRITIQUE {…}` entre accents graves
 * est un marqueur ; sans ce retrait il était ABSENT — ses constats majeurs
 * perdus sans que rien (ni `illisible`, ni la War Room) ne le signale.
 */
function sansHabillage(ligne: string): string {
  return ligne
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^`+|`+$/g, '')
    .trim();
}

/** Une ligne qui SE DONNE pour un marqueur, qu'elle soit lisible ou non. */
export function estLigneMarqueur(ligne: string): boolean {
  return sansHabillage(ligne).startsWith(MARQUEUR_CRITIQUE);
}

/**
 * La dernière ligne d'un texte coupé (`borneTexteFinal`) commence juste après
 * la coupe et porte une clé du contrat : la coupe a traversé un marqueur trop
 * long, dont la tête est perdue. Ce n'est pas « aucun marqueur » — ses
 * constats, peut-être majeurs, sont là, illisibles.
 */
function marqueurCoupe(lignes: readonly string[], derniere: number): boolean {
  return (
    derniere > 0 &&
    lignes[derniere - 1]!.trim() === COUPURE_TEXTE_FINAL &&
    /"(?:verdict|findings|severite|critere|preuve)"\s*:/.test(lignes[derniere]!)
  );
}

/**
 * Lit le marqueur final d'une réponse de relecteur. Ne lève jamais.
 *
 * `findings` absent vaut une liste vide : « valide » sans rien à signaler est
 * la réponse la plus naturelle, et elle est complète.
 */
export function lireMarqueurCritique(texte: string): LectureMarqueur {
  const lignes = texte.split(/\r?\n/);
  let i = lignes.length - 1;
  while (i >= 0 && (lignes[i]!.trim() === '' || CLOTURE_DE_BLOC.test(lignes[i]!))) i--;
  const illisible = { etat: 'illisible' } as const;
  const derniere = i >= 0 ? sansHabillage(lignes[i]!) : '';
  if (!derniere.startsWith(MARQUEUR_CRITIQUE)) {
    // Un marqueur AILLEURS qu'en dernière ligne ne décide pas — mais il se
    // voit : `illisible`, pas `absent`.
    return lignes.some(estLigneMarqueur) || marqueurCoupe(lignes, i)
      ? illisible
      : { etat: 'absent' };
  }
  // UNE seule ligne-marqueur : une seconde, n'importe où plus haut, dit qu'un
  // marqueur a été CITÉ — le relecteur a recopié celui, tout prêt, d'un diff
  // hostile, puis l'a refermé dans un bloc de code après le sien. Lequel est
  // le sien ne se devine pas : aucun ne décide, et l'avis illisible conteste.
  if (lignes.slice(0, i).some(estLigneMarqueur)) return illisible;
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
  const verdict = VERDICTS.find((v) => v === motNu(o.verdict));
  if (!verdict) return illisible;
  const constats = o.findings === undefined ? [] : lireConstats(o.findings);
  if (constats === null) return illisible;
  return {
    etat: 'lu',
    conteste: verdict === 'conteste' || constats.some(constatBloquant),
    constats,
  };
}

/** Un objet FERMÉ dont chaque champ est requis : la forme stricte, voir `SCHEMA_AVIS`. */
const objetStrict = (proprietes: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties: proprietes,
  required: Object.keys(proprietes),
  additionalProperties: false,
});

/**
 * La grille du marqueur en JSON Schema — ce que Hive IMPOSE à la réponse finale
 * d'un CLI relecteur qui sait la contraindre (voir l'en-tête).
 *
 * Dérivé des constantes de la grille : un schéma recopié à la main dériverait
 * de ce que `lireMarqueurCritique` accepte. Forme STRICTE — chaque objet fermé,
 * chaque champ requis, `fichier` et `proposition` vides plutôt qu'absents :
 * Codex l'envoie en `strict: true` (codex-rs/exec/tests/suite/output_schema.rs,
 * tag rust-v0.156.0), forme que le convertisseur strict du SDK OpenAI impose
 * lui-même (openai-python, src/openai/lib/_pydantic.py,
 * `_ensure_strict_json_schema`). Aucun mot-clé de borne : la lecture borne déjà
 * (`BORNES_CONSTAT`), et une preuve vide y rend l'avis illisible.
 */
export const SCHEMA_AVIS: Readonly<Record<string, unknown>> = objetStrict({
  verdict: { type: 'string', enum: [...VERDICTS] },
  findings: {
    type: 'array',
    items: objetStrict({
      severite: { type: 'string', enum: [...SEVERITES] },
      critere: { type: 'string', enum: [...CRITERES] },
      fichier: { type: 'string' },
      preuve: { type: 'string' },
      proposition: { type: 'string' },
    }),
  },
});

/**
 * L'avis qu'un CLI a rendu au schéma, écrit en ligne-marqueur : la Reine le lit
 * alors comme tout marqueur (`lireMarqueurCritique`), grille comprise.
 *
 * `sortie` est ce que le CLI DÉCLARE : un objet (Claude Code,
 * `structured_output`) ou son texte JSON (Codex, dernier `agent_message`). Un
 * texte qui ne se lit pas en JSON reste tel quel, sur UNE ligne : le marqueur
 * est illisible — l'avis contesté, et dit —, jamais réécrit en un avis qu'il
 * n'était pas.
 */
export function ligneAvis(sortie: unknown): string {
  if (typeof sortie !== 'string') return `${MARQUEUR_CRITIQUE} ${JSON.stringify(sortie)}`;
  try {
    return `${MARQUEUR_CRITIQUE} ${JSON.stringify(JSON.parse(sortie))}`;
  } catch {
    return `${MARQUEUR_CRITIQUE} ${sortie.replace(/\s+/g, ' ').trim()}`;
  }
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
