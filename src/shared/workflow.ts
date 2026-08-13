// Les workflows GitHub — lire ce que l'API DÉCLARE, et rien d'autre.
//
// ─── LA MÊME FRONTIÈRE QU'AILLEURS, POUR LA MÊME RAISON ──────────────────────
//
// `chantier.ts` dit : « la ruche choisit dans ce que le DÉPÔT déclare, elle
// n'invente jamais une commande ». `preparation.ts` dit : « la préparation
// installe ce que le dépôt déclare, jamais ce que la commande nomme ». Les deux
// ont été écrites en fermant de vraies failles, pas par précaution théorique.
//
// Ici la frontière prend une forme précise, et elle mérite d'être dite parce
// que l'API GitHub tend un piège :
//
//   POST /repos/{o}/{r}/actions/workflows/{id_ou_nom_de_fichier}/dispatches
//
// **Ce segment accepte un ID NUMÉRIQUE _ou_ un nom de fichier.** Accepter le
// nom de fichier reviendrait à laisser un appelant écrire un morceau d'URL —
// et le premier `../..` transformerait l'appel en « n'importe quel endpoint de
// l'API GitHub, avec le jeton de l'hôte ». Ce jeton est, de loin, le secret le
// plus puissant qui approche une ruche.
//
// Donc : **un entier, et un entier qui figure dans la liste que l'API vient de
// rendre.** Pas un nom, pas un chemin, pas une chaîne « validée par regex ».
// Une regex sur un chemin est une garde qu'on contourne ; une appartenance à
// une liste, non.
//
// ─── CE QUI VIENT DE GITHUB EST DONNÉE ───────────────────────────────────────
//
// Le nom d'un workflow est écrit dans le dépôt, par quiconque peut y pousser.
// Il traverse ensuite un événement, un écran, un journal. Il est aplati et
// borné à l'entrée, comme les descriptions de dépôts et les titres d'issues.
//
// Module PUR : aucune I/O. Il lit du JSON déjà reçu et rend des décisions.

import { champSurUneLigne } from './donnees-non-fiables.js';

/** Au-delà, un nom de workflow n'est plus un nom. */
export const MAX_NOM_WORKFLOW = 140;

/** Le chemin du fichier, affiché pour que l'humain sache CE qu'il lance. */
export const MAX_CHEMIN_WORKFLOW = 300;

/**
 * L'état d'un workflow, tel que GitHub le donne.
 *
 * `active` est le seul qui puisse être lancé. Les autres existent et refusent —
 * et refuser LOCALEMENT vaut mieux qu'un 403 dont personne ne déduira
 * « ce workflow est désactivé depuis six mois pour inactivité ».
 */
export type EtatWorkflow = 'actif' | 'desactive_a_la_main' | 'desactive_inactivite' | 'inconnu';

function etatDe(v: unknown): EtatWorkflow {
  if (v === 'active') return 'actif';
  if (v === 'disabled_manually') return 'desactive_a_la_main';
  if (v === 'disabled_inactivity') return 'desactive_inactivite';
  return 'inconnu';
}

export interface Workflow {
  /** L'identifiant NUMÉRIQUE. C'est la seule chose qu'on renvoie à l'API. */
  readonly id: number;
  readonly nom: string;
  /** `.github/workflows/ci.yml` — affiché, jamais réinjecté dans une URL. */
  readonly chemin: string;
  readonly etat: EtatWorkflow;
  readonly htmlUrl: string;
}

/**
 * Un identifiant de workflow utilisable.
 *
 * Entier strictement positif et sûr. `Number.isSafeInteger` refuse `1.5`,
 * `NaN`, `Infinity` et les entiers au-delà de 2⁵³ — au-delà desquels deux ids
 * distincts peuvent devenir égaux, ce qui ferait passer la vérification
 * d'appartenance pour un autre workflow.
 */
export function estIdWorkflow(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

/** Lit un workflow, ou rend `null` si l'objet n'en est pas un. */
export function lireWorkflow(brut: unknown): Workflow | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  if (!estIdWorkflow(o.id)) return null;
  const nom = champSurUneLigne(typeof o.name === 'string' ? o.name : '', MAX_NOM_WORKFLOW);
  if (nom === '') return null;
  return {
    id: o.id,
    nom,
    chemin: champSurUneLigne(typeof o.path === 'string' ? o.path : '', MAX_CHEMIN_WORKFLOW),
    etat: etatDe(o.state),
    htmlUrl: typeof o.html_url === 'string' && o.html_url.startsWith('https://') ? o.html_url : '',
  };
}

export type VerdictWorkflow =
  | { readonly ok: true; readonly workflow: Workflow }
  | { readonly ok: false; readonly motif: string };

/**
 * Ce workflow peut-il être lancé, et est-il bien l'un de ceux que l'API a rendus ?
 *
 * `declares` vient de `listerWorkflows`, donc de GitHub — jamais de l'appelant.
 * C'est cette liste qui est la source de vérité, exactement comme le bloc
 * `scripts` du `package.json` l'est pour `jugerChantier`.
 */
export function jugerWorkflow(declares: readonly Workflow[], id: unknown): VerdictWorkflow {
  if (!estIdWorkflow(id)) {
    return {
      ok: false,
      motif:
        'Un workflow se désigne par son identifiant numérique, jamais par un nom ' +
        'de fichier : ce segment d’URL accepte les deux, et accepter le nom ' +
        'laisserait un appelant écrire un morceau d’URL de l’API GitHub.',
    };
  }

  const w = declares.find((x) => x.id === id);
  if (!w) {
    const proposes = declares
      .slice(0, 10)
      .map((x) => `${x.nom} (${x.id})`)
      .join(', ');
    return {
      ok: false,
      motif:
        `Ce dépôt ne déclare aucun workflow ${id}. La ruche choisit dans ce que ` +
        'l’API déclare, elle n’invente pas d’identifiant. ' +
        (proposes === '' ? 'Ce dépôt n’en déclare aucun.' : `Déclarés : ${proposes}.`),
    };
  }

  if (w.etat !== 'actif') {
    // Refuser ICI plutôt que de laisser GitHub répondre 403 : personne ne
    // déduit « désactivé pour inactivité depuis soixante jours » d'un 403.
    const pourquoi =
      w.etat === 'desactive_inactivite'
        ? 'GitHub l’a désactivé après une longue inactivité du dépôt'
        : w.etat === 'desactive_a_la_main'
          ? 'quelqu’un l’a désactivé à la main'
          : 'GitHub le rapporte dans un état que la ruche ne connaît pas';
    return {
      ok: false,
      motif: `« ${w.nom} » n’est pas actif : ${pourquoi}. Réactivez-le dans l’onglet Actions du dépôt.`,
    };
  }

  return { ok: true, workflow: w };
}

/**
 * Une référence git plausible — branche ou tag.
 *
 * Elle ne voyage PAS dans l'URL (elle part dans le corps JSON du dispatch),
 * donc ce n'est pas une garde contre la traversée de chemin. C'est une garde
 * contre le reste : une référence avec un saut de ligne fabrique une fausse
 * entrée de journal, et une référence vide produit un 422 illisible.
 *
 * Les règles suivent `git check-ref-format` sans prétendre le réimplémenter :
 * ce qui passe ici est un sous-ensemble sûr, pas l'ensemble exact des refs
 * légales. Un nom de branche exotique sera refusé — c'est le bon sens de
 * l'erreur.
 */
/**
 * Longueur maximale d'une référence git acceptée ici.
 *
 * Exportée pour que le banc ne la recopie pas : une borne écrite deux fois est
 * une seconde source de vérité, libre de dériver de la première
 * (§ 9 unquinquagies du carnet).
 */
export const REF_MAX = 255;

export function estRefPlausible(ref: string): boolean {
  if (ref === '' || ref.length > REF_MAX) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) return false;
  // `..` sert à git pour les plages de révisions, et `.lock` est réservé.
  if (ref.includes('..') || ref.endsWith('.lock')) return false;
  // Ni au début ni à la fin : `/branche` et `branche/` ne sont pas des refs.
  if (ref.startsWith('/') || ref.endsWith('/')) return false;
  if (ref.startsWith('.') || ref.endsWith('.')) return false;
  return true;
}

/** L'issue d'un run, telle qu'on la montre. */
export type ConclusionRun =
  | 'succes'
  | 'echec'
  | 'annule'
  | 'ignore'
  | 'expire'
  | 'action_requise'
  | 'neutre'
  | 'en_cours'
  | 'inconnue';

function conclusionDe(statut: unknown, conclusion: unknown): ConclusionRun {
  // Un run non terminé n'a PAS de conclusion — `conclusion` y vaut `null`.
  // La confondre avec « inconnue » ferait afficher un échec pour un run qui
  // démarre, ce qui est la pire des deux erreurs possibles.
  if (statut !== 'completed') return 'en_cours';
  switch (conclusion) {
    case 'success':
      return 'succes';
    case 'failure':
      return 'echec';
    case 'cancelled':
      return 'annule';
    case 'skipped':
      return 'ignore';
    case 'timed_out':
      return 'expire';
    case 'action_required':
      return 'action_requise';
    case 'neutral':
      return 'neutre';
    default:
      return 'inconnue';
  }
}

export interface RunWorkflow {
  readonly id: number;
  /** L'id du workflow dont ce run est une exécution. */
  readonly workflowId: number;
  readonly nom: string;
  readonly numero: number;
  readonly conclusion: ConclusionRun;
  /** La ref sur laquelle il a tourné, telle que GitHub la rapporte. */
  readonly branche: string;
  readonly htmlUrl: string;
  /** Début, en ms. Sert au tri : le plus récent d'abord. */
  readonly demarreA: number;
}

function msDe(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

export function lireRun(brut: unknown): RunWorkflow | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  if (!estIdWorkflow(o.id)) return null;
  return {
    id: o.id,
    workflowId: estIdWorkflow(o.workflow_id) ? o.workflow_id : 0,
    nom: champSurUneLigne(typeof o.name === 'string' ? o.name : '', MAX_NOM_WORKFLOW),
    numero:
      typeof o.run_number === 'number' && Number.isSafeInteger(o.run_number) ? o.run_number : 0,
    conclusion: conclusionDe(o.status, o.conclusion),
    branche: champSurUneLigne(typeof o.head_branch === 'string' ? o.head_branch : '', 255),
    htmlUrl: typeof o.html_url === 'string' && o.html_url.startsWith('https://') ? o.html_url : '',
    demarreA: msDe(o.run_started_at ?? o.created_at),
  };
}

/**
 * Les workflows dans un ordre TOTAL.
 *
 * Par nom, puis par id — sans le second critère, deux workflows homonymes
 * (deux fichiers, même `name:`) s'ordonneraient au hasard de la réponse HTTP,
 * et deux ruches regardant le même dépôt afficheraient des listes différentes.
 */
export function pourChoisir(workflows: readonly Workflow[]): Workflow[] {
  return [...workflows].sort((a, b) => a.nom.localeCompare(b.nom) || a.id - b.id);
}

/** Les runs, du plus récent au plus ancien, l'id départageant les ex æquo. */
export function pourAfficher(runs: readonly RunWorkflow[]): RunWorkflow[] {
  return [...runs].sort((a, b) => b.demarreA - a.demarreA || b.id - a.id);
}
