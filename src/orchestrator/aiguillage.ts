// L'Aiguillage appris — la ruche envoie chaque genre de travail au modèle qui,
// jusqu'ici, l'a fait le mieux — sans jamais cesser d'essayer les autres.
//
// ─── LE PROBLÈME, DIT PAR L'UTILISATEUR ──────────────────────────────────────
//
// « Une fois connectée, la ruche doit pouvoir dire : mhmh, Fable 5 n'est
// peut-être pas mal pour de l'idéation ; Opus 5 était meilleur que lui sur
// cette tâche-là la dernière fois. Elle teste, elle garde en mémoire, et elle
// réutilise ce qui produit le meilleur code. »
//
// Aujourd'hui, le Scheduler assigne au premier nœud libre, et un nœud ne
// déclare qu'un `agentType` — jamais un modèle précis. Rien n'apprend, rien ne
// se souvient : Opus 5 et Fable 5 sont interchangeables aux yeux de la ruche.
//
// ─── CE QUE FAIT CE MODULE, ET CE QU'IL NE FAIT PAS ──────────────────────────
//
// Il tient une MÉMOIRE : pour chaque BRAS (genre de tâche × modèle × harness ×
// effort), combien de fois il a servi, quelle NOTE il y a récoltée et, quand le
// CLI le déclare, ce qu'il a coûté. La note ne vient pas d'un succès/échec
// binaire mais du verdict de CONTRE-VISITE du Polyéthisme (`appliquer` /
// `améliorer` / `refaire`) — une note de QUALITÉ, donc, pas seulement « ça
// compile ».
//
// À partir de cette mémoire, il CHOISIT — et c'est là que se joue « garder le
// meilleur SANS se figer ». Un choix purement glouton (« toujours le meilleur
// jusqu'ici ») se verrouille sur le premier modèle qui a eu de la chance, et
// n'essaie jamais celui qui aurait fait mieux. La règle est donc celle des
// bandits manchots : on prend le meilleur score, mais un bras PEU ESSAYÉ reçoit
// un optimisme qui décroît à mesure qu'on le connaît. Jusqu'à la v2, un modèle
// jamais essayé valait `+∞` et raflait d'office la tâche suivante de chaque
// genre ; depuis la v3, il part d'un A PRIORI de masse fixe (`classer`) et
// n'est essayé que quand son optimisme dépasse le meilleur connu. Un bras neuf
// d'un modèle CONNU (autre effort, autre harness) hérite de ce que ce modèle a
// montré sur le genre : la mise en commun hiérarchique.
//
// Ce module NE CHOISIT PAS le nœud, NE lance rien, N'écrit nulle part : il
// répond à « quel bras, pour ce genre-là ? » à partir d'antécédents qu'on lui
// donne. Le câblage — déclarer les modèles et efforts d'un nœud, porter le
// bras choisi dans l'assignation, enregistrer le verdict — vit dans
// l'ordonnanceur et le store.
//
// MODULE PUR — famille de balance.ts, acces.ts, polyethisme.ts, conseil.ts.
// Aucune I/O, aucune horloge, et SURTOUT aucun aléa : le score est déterministe, ce
// qui est à la fois une nécessité (ce dépôt interdit `Math.random`) et une
// vertu (deux ruches avec le même vécu font le même choix, et le choix
// s'éprouve sans tirer au sort).

import { rangEffort, type Effort } from '../shared/effort.js';
import type { Suite } from './polyethisme.js';

/**
 * Version du calcul de l'Aiguillage : taxonomie (`categoriser`), repli des
 * antécédents et format du classement (`Rang`). Relevée à chaque changement.
 *
 * Elle est FIGÉE dans `task_assigned` (`versionAiguillage`) à côté de la raison
 * du choix : une raison relue des semaines plus tard dit sous quel calcul elle a
 * été prise, et le lecteur (`routage-vue.ts`) sait comment lire ses lignes. Sans
 * ce tampon, un classement d'avant un changement se lirait avec les règles
 * d'après — exactement la confusion que la raison figée doit éviter.
 *
 *   · v1 — `essais` mêlait verdicts reçus et élections en vol, `moyenne` en
 *          était diluée : un modèle neuf en vol se lisait « 1 essai, moyenne 0 ».
 *   · v2 — `essais` et `moyenne` ne parlent QUE des verdicts reçus ; les
 *          élections en vol sont comptées à part (`enVol`).
 *   · v3 — le classement porte des BRAS (modèle × `harness` × `effort`), un
 *          `intervalle` de Wilson et un `cout` déclaré ; le score est toujours
 *          fini (a priori de masse fixe au lieu de `+∞`), et l'affectation dit
 *          l'état de la décision (`decisionAiguillage`).
 */
export const VERSION_AIGUILLAGE = 3;

// ─── Les genres de tâche ──────────────────────────────────────────────────────
//
// Volontairement PEU nombreux. Une taxonomie fine se paie deux fois : elle
// éparpille les antécédents (chaque case a moins d'exemples, donc apprend plus
// lentement), et elle multiplie les cas où le classement se trompe. Sept cases,
// dont un vrai fourre-tout, suffisent à distinguer ce qui appelle des forces
// différentes — idéer n'est pas coder, corriger n'est pas documenter.

export const CATEGORIES = [
  'ideation',
  'code',
  'correction',
  'refactorisation',
  'test',
  'documentation',
  'autre',
] as const;
export type Categorie = (typeof CATEGORIES)[number];

/**
 * Les mots qui trahissent un genre, en français ET en anglais — un prompt peut
 * être écrit dans l'une ou l'autre langue, et refuser d'en reconnaître une
 * rangerait la moitié des tâches dans « autre ».
 *
 * Le rapprochement se fait par SOUS-CHAÎNE, à dessein : « corrige », « corriger »
 * et « correction » partagent `corrig`, et lister chaque flexion serait un
 * oubli garanti. Le prix est quelques faux positifs rares (`test` vit dans
 * `contest`), que la PRÉCÉDENCE plus bas absorbe.
 *
 * `autre` n'a pas de mots : c'est ce qui reste quand aucun autre n'a mordu.
 */
const MOTS: Record<Exclude<Categorie, 'autre'>, readonly string[]> = {
  correction: [
    'bug',
    'corrig',
    'fix',
    'faille',
    'régress',
    'regress',
    'casse',
    'échou',
    'echou',
    'erreur',
    'crash',
    'plante',
    'répar',
    'repar',
    'defect',
  ],
  test: ['test', 'banc', 'couverture', 'coverage', 'vitest', 'mutation', 'assertion', 'spec'],
  refactorisation: [
    'refactor',
    'simplifi',
    'nettoi',
    'nettoy',
    'extrai',
    'renomm',
    'dédupli',
    'dedupli',
    'restructur',
    'clean up',
    'cleanup',
  ],
  documentation: [
    'document',
    'readme',
    'commentaire',
    'explique',
    'explain',
    'guide',
    'tutoriel',
    'tutorial',
  ],
  ideation: [
    'idée',
    'idee',
    'idéation',
    'ideation',
    'propose',
    'conçoi',
    'concoi',
    'imagine',
    'brainstorm',
    'explore',
    'options',
    'pistes',
    'stratégie',
    'strategie',
  ],
  code: [
    'implément',
    'implement',
    'ajoute',
    'crée',
    'cree',
    'create',
    'écris',
    'ecris',
    'build',
    'feature',
    'fonctionnalité',
    'endpoint',
    'composant',
    'component',
    'fonction',
    'function',
    'module',
  ],
};

/**
 * L'ordre qui départage un ex æquo — le PLUS SPÉCIFIQUE gagne.
 *
 * Une tâche « corriger le test qui échoue » touche `correction` ET `test`. On
 * la range en `correction` : c'est la nature du geste (réparer), pas son décor
 * (un test), qui appelle le bon modèle. `code`, le plus générique, perd tous
 * les départages — il n'attrape que ce qu'aucun autre n'a reconnu.
 */
const PRECEDENCE: readonly Exclude<Categorie, 'autre'>[] = [
  'correction',
  'test',
  'refactorisation',
  'documentation',
  'ideation',
  'code',
];

/**
 * Range une tâche dans un genre, d'après son titre et son prompt.
 *
 * On COMPTE les mots reconnus par genre, et le plus fourni gagne ; à égalité,
 * la précédence tranche ; à zéro partout, c'est `autre`. Compter (plutôt que
 * s'arrêter au premier mot vu) rend le classement robuste à une allusion
 * isolée : « ajoute un test au nouveau module » cite `test` une fois et `code`
 * deux — c'est du code, avec un test, et non l'inverse.
 */
export function categoriser(titre: string, prompt: string): Categorie {
  const texte = `${titre} ${prompt}`.toLowerCase();
  let meilleure: Exclude<Categorie, 'autre'> | null = null;
  let meilleurCompte = 0;
  // On parcourt `PRECEDENCE` DANS L'ORDRE, et l'on ne remplace que sur un compte
  // STRICTEMENT supérieur. La précédence en découle sans bookkeeping : à égalité,
  // le premier vu — donc le plus spécifique — reste en place, un suivant ne le
  // déloge pas. Une première version tenait en plus un `meilleurRang` pour
  // départager les ex æquo ; le rejeu a montré que sa branche ne se déclenchait
  // JAMAIS (le rang ne fait que croître, jamais < au meilleur déjà retenu), et
  // un `<` muté en `<=` y survivait. Du décor : retiré (§ carnet, une garde
  // qu'aucune entrée ne distingue est un mutant équivalent, on la nomme et on
  // l'enlève).
  for (const cat of PRECEDENCE) {
    const compte = MOTS[cat].reduce((n, mot) => (texte.includes(mot) ? n + 1 : n), 0);
    if (compte > meilleurCompte) {
      meilleure = cat;
      meilleurCompte = compte;
    }
  }
  return meilleure ?? 'autre';
}

// ─── La note apprise ──────────────────────────────────────────────────────────

/**
 * Ce que vaut un verdict de contre-visite, entre 0 et 1.
 *
 *   · `appliquer`  — la production part telle quelle : la meilleure note.
 *   · `améliorer`  — juste, mais on peut faire mieux : à mi-chemin.
 *   · `refaire`    — à jeter : zéro.
 *
 * Le milieu n'est pas décoratif. Sans lui, « améliorer » compterait comme un
 * échec, et un modèle qui produit du correct-mais-perfectible serait puni comme
 * celui qui produit du faux — la ruche préférerait alors un modèle qui rate à
 * moitié moins souvent mais complètement. C'est l'inverse de ce qu'on veut.
 */
export const RECOMPENSE: Record<Suite, number> = {
  appliquer: 1,
  ameliorer: 0.5,
  refaire: 0,
};

export function recompenseDe(suite: Suite): number {
  return RECOMPENSE[suite];
}

// ─── Les bras ─────────────────────────────────────────────────────────────────
//
// Un BRAS est ce que l'Aiguillage commande vraiment : un modèle, SOUS un
// harness (l'agent qui le fait tourner : `claude-code`, `codex`, `cursor`…),
// À un effort. Le même nom de modèle déclaré par deux agents n'est pas le même
// bras : Arena mesure le harness surtout sur le COÛT (Claude Code ≈ 2× Pi sur
// SWE-bench Lite, à ±2 % de succès près), et une clé `catégorie|modèle` les
// confondait. L'effort, lui, n'existe que là où le CLI le documente
// (`shared/effort.ts`) ; `null` veut dire « aucun effort commandé » — le défaut
// du CLI, que Hive ne connaît pas et ne nomme donc pas.

/** Ce que l'Aiguillage commande : un modèle, sous un harness, à un effort. */
export interface Bras {
  modele: string;
  /** L'`agentType` du nœud qui le fait tourner. */
  harness: string;
  /** `null` : aucun effort commandé, le CLI garde son défaut. */
  effort: Effort | null;
}

// ─── Les antécédents ──────────────────────────────────────────────────────────

/**
 * Une observation : ce bras, sur ce genre, a récolté ce verdict.
 *
 * `harness` et `effort` sont `null` quand le bras n'a pas été rangé (verdicts
 * d'avant la v3, ou production sans élection) : l'observation nourrit alors le
 * niveau MODÈLE — l'a priori de tous ses bras — sans être attribuée à l'un
 * d'eux par supposition. `coutUsd` : le coût DÉCLARÉ par le CLI pour la
 * production jugée, `null` s'il n'a rien déclaré — jamais estimé, jamais 0.
 */
export interface Observation {
  categorie: Categorie;
  modele: string;
  harness: string | null;
  effort: Effort | null;
  suite: Suite;
  coutUsd: number | null;
}

/** Le vécu accumulé d'un bras (ou d'un modèle, tous bras confondus). */
export interface Antecedent {
  /**
   * Combien de fois ce bras a servi sur ce genre — élections en vol comprises.
   * Au niveau MODÈLE : verdicts seuls (les élections en vol n'y sont que dans
   * `enVol`, cf. `injecterEnVol`).
   */
  essais: number;
  /** Somme des notes récoltées — la moyenne s'en déduit. */
  recompenseTotale: number;
  /**
   * Parmi `essais`, les élections EN VOL (`injecterEnVol`) : lancées, pas encore
   * jugées. Absent : aucune. Le score les compte (c'est la borne du troupeau) ;
   * le classement les montre à part, pour qu'aucun écran ne les lise comme des
   * verdicts nuls.
   */
  enVol?: number;
  /** Somme des coûts DÉCLARÉS (USD) sur les verdicts qui en portent un. */
  coutTotal?: number;
  /** Combien de verdicts portent un coût déclaré. Absent : aucun. */
  coutsDeclares?: number;
}

/**
 * Le vécu de l'Aiguillage, sur DEUX niveaux — la mise en commun hiérarchique.
 *
 *   · `bras` : par (genre × modèle × harness × effort), verdicts ET élections
 *     en vol. C'est ce que le score lit en propre.
 *   · `modeles` : par (genre × modèle), tous harness et efforts confondus,
 *     VERDICTS SEULS (y compris ceux dont le bras est inconnu). C'est l'a
 *     priori dont hérite chaque bras de ce modèle.
 *
 * Pourquoi deux niveaux : découper en harness × modèle × effort multiplie les
 * cases (sept genres × cinq efforts × chaque harness) dans une fenêtre de 300
 * verdicts — l'éparpillement que la taxonomie courte ci-dessus s'interdit. Un
 * bras neuf d'un modèle CONNU n'est donc pas un inconnu : il part de ce que le
 * modèle a montré sur ce genre, et ses propres verdicts l'en écartent.
 */
export interface VecuAiguillage {
  bras: Map<string, Antecedent>;
  modeles: Map<string, Antecedent>;
}

/**
 * Combien d'observations récentes on garde. Au-delà, les plus vieilles sont
 * OUBLIÉES — un modèle s'améliore (ou se dégrade), et une ruche qui traînerait
 * mille verdicts d'il y a six mois jugerait un modèle sur ce qu'il n'est plus.
 * L'oubli est lent (le corpus est grand), mais il existe. C'est aussi ce qui
 * distingue ce routeur de celui de LiteLLM, qui n'oublie rien (`SAMPLE_CAP`
 * JETTE les mises à jour au-delà de 200) : ici la dérive d'un modèle se suit.
 */
export const CORPUS_AIGUILLAGE = 300;

/**
 * La clé d'un couple (genre × modèle) — le niveau supérieur. En JSON, et non
 * par concaténation : un nom de modèle est une chaîne libre (`HIVE_MODELES`),
 * et un séparateur qu'il pourrait contenir rendrait deux clés égales.
 */
export function cle(categorie: Categorie, modele: string): string {
  return JSON.stringify([categorie, modele]);
}

/** La clé d'un bras, même encodage que `cle`. */
export function cleBras(
  categorie: Categorie,
  bras: { modele: string; harness: string; effort: Effort | null },
): string {
  return JSON.stringify([categorie, bras.modele, bras.harness, bras.effort]);
}

const vide = (): Antecedent => ({ essais: 0, recompenseTotale: 0 });

function ajouterVerdict(a: Antecedent, recompense: number, coutUsd: number | null): void {
  a.essais += 1;
  a.recompenseTotale += recompense;
  if (coutUsd !== null) {
    a.coutTotal = (a.coutTotal ?? 0) + coutUsd;
    a.coutsDeclares = (a.coutsDeclares ?? 0) + 1;
  }
}

/**
 * Replie une liste d'observations en vécu à deux niveaux.
 *
 * Seules les `CORPUS_AIGUILLAGE` DERNIÈRES comptent : les observations arrivent
 * dans l'ordre du temps, et l'on garde la queue. C'est ici, et nulle part
 * ailleurs, que se fait l'oubli — pour les deux niveaux à la fois.
 */
export function replierAntecedents(observations: readonly Observation[]): VecuAiguillage {
  const vecu: VecuAiguillage = { bras: new Map(), modeles: new Map() };
  for (const o of observations.slice(-CORPUS_AIGUILLAGE)) {
    const recompense = recompenseDe(o.suite);
    const km = cle(o.categorie, o.modele);
    const m = vecu.modeles.get(km) ?? vide();
    ajouterVerdict(m, recompense, o.coutUsd);
    vecu.modeles.set(km, m);
    if (o.harness === null) continue;
    const kb = cleBras(o.categorie, { modele: o.modele, harness: o.harness, effort: o.effort });
    const b = vecu.bras.get(kb) ?? vide();
    ajouterVerdict(b, recompense, o.coutUsd);
    vecu.bras.set(kb, b);
  }
  return vecu;
}

/** La note moyenne d'un antécédent, ou 0 s'il n'a jamais servi. */
export function moyenne(a: Antecedent): number {
  return a.essais > 0 ? a.recompenseTotale / a.essais : 0;
}

/**
 * Compte les élections EN VOL comme des essais SANS note, dans le niveau BRAS,
 * et les dénombre au niveau MODÈLE.
 *
 * ─── POURQUOI CETTE INJECTION EXISTE ─────────────────────────────────────────
 *
 * Un bras qui gagne l'élection garde son score tant que son verdict n'est pas
 * revenu (des minutes) : sans cette injection, il raflerait TOUTES les tâches
 * prêtes de son genre dans l'intervalle — le TROUPEAU. Un essai à récompense
 * NULLE par élection en vol fait baisser son score dès le lancement ; la
 * moyenne, temporairement pessimiste, se corrige quand les vrais verdicts
 * tombent. Tout reste déterministe.
 *
 * LA BORNE EST PAR MODÈLE, pas seulement par bras. Un nœud Claude Code offre
 * chaque modèle à six efforts (le défaut du CLI, puis low → max) : bornés bras
 * par bras, les frères intacts d'un modèle jamais jugé gardaient leur a priori
 * vierge, et ce modèle raflait six tâches du genre avant son premier verdict.
 * Le niveau MODÈLE compte donc ses élections en vol (`enVol`, JAMAIS dans
 * `essais` ni dans la récompense : un zéro qui n'a jamais été prononcé ne doit
 * pas rester dans l'a priori une fois le verdict tombé), et `classer` les pèse
 * sur chaque bras frère comme des essais à note nulle. Une élection dont le bras
 * est inconnu (`harness` null, rangée avant la v3) n'est attribuée à aucun bras.
 *
 * Mute le vécu EN PLACE (il vient d'être bâti par `replierAntecedents`, on ne
 * le partage pas). Chaque essai injecté est AUSSI compté dans `enVol` : le
 * score doit le voir, l'explication doit le distinguer — sans ce second
 * compte, un bras jamais jugé se lirait « 1 essai, moyenne 0 ».
 */
export function injecterEnVol(
  vecu: VecuAiguillage,
  enVol: readonly {
    categorie: Categorie;
    modele: string;
    harness: string | null;
    effort: Effort | null;
  }[],
): void {
  for (const e of enVol) {
    if (e.harness === null) continue;
    const km = cle(e.categorie, e.modele);
    const m = vecu.modeles.get(km) ?? vide();
    m.enVol = (m.enVol ?? 0) + 1;
    vecu.modeles.set(km, m);
    const k = cleBras(e.categorie, { modele: e.modele, harness: e.harness, effort: e.effort });
    const a = vecu.bras.get(k) ?? vide();
    a.essais += 1;
    a.enVol = (a.enVol ?? 0) + 1;
    vecu.bras.set(k, a);
  }
}

/** Un verdict de contre-visite relu du store, avec la tâche qu'il juge. */
export interface VerdictAiguillage {
  title: string;
  prompt: string;
  /** Modèle COMMANDÉ à la tâche (`aiguillage_modeles`). */
  modele: string;
  /** Modèle PROUVÉ par la contre-revue (`producteurModele`), quand elle l'a tracé. */
  modeleExact?: string;
  /** Harness du bras commandé (`aiguillage_bras`) ; absent : bras inconnu. */
  harness?: string;
  /** Effort commandé ; absent : aucun, ou bras inconnu. */
  effort?: Effort;
  /** Coût déclaré par le CLI pour la production jugée ; absent : non déclaré. */
  coutUsd?: number;
  suite: Suite;
}

/** Une élection en vol relue du store : tâche active, bras commandé, pas de verdict. */
export interface ElectionEnVol {
  title: string;
  prompt: string;
  modele: string;
  harness?: string;
  effort?: Effort;
}

/**
 * LE vécu de l'Aiguillage, depuis ce que le store relit : les verdicts
 * (repliés) PLUS les élections en vol (la borne du troupeau).
 *
 * UNE seule fonction, pour l'ordonnanceur qui CHOISIT et pour `/api/workers`
 * qui MONTRE. Deux replis écrits à la main avaient divergé : l'écran rangeait
 * chaque verdict sous le modèle COMMANDÉ, l'ordonnanceur sous le modèle PROUVÉ —
 * Mission Control montrait un modèle devant quand le routing le classait
 * derrière.
 *
 * Le modèle prouvé (`modeleExact`) l'emporte quand il existe : une
 * réassignation peut avoir remplacé `aiguillage_modeles` depuis la production
 * relue, et le verdict juge CE QUI A PRODUIT, pas ce qui est commandé
 * aujourd'hui. Les verdicts historiques sans cette preuve retombent sur le
 * modèle commandé. La catégorie n'est jamais stockée : elle est RECALCULÉE ici,
 * pour que la taxonomie du jour s'applique au vécu ancien.
 */
export function antecedentsDuVecu(
  verdicts: readonly VerdictAiguillage[],
  enVol: readonly ElectionEnVol[],
): VecuAiguillage {
  const vecu = replierAntecedents(
    verdicts.map((v) => ({
      categorie: categoriser(v.title, v.prompt),
      modele: v.modeleExact ?? v.modele,
      harness: v.harness ?? null,
      effort: v.effort ?? null,
      suite: v.suite,
      coutUsd: v.coutUsd ?? null,
    })),
  );
  injecterEnVol(
    vecu,
    enVol.map((e) => ({
      categorie: categoriser(e.title, e.prompt),
      modele: e.modele,
      harness: e.harness ?? null,
      effort: e.effort ?? null,
    })),
  );
  return vecu;
}

// ─── Le choix : exploiter le meilleur, explorer le reste ──────────────────────

/**
 * La constante d'exploration d'UCB1. `√2` est la valeur classique : plus elle
 * est grande, plus on insiste à ré-essayer les bras peu connus ; plus elle est
 * petite, plus on se fie vite à la moyenne. L'Aiguillage ne l'emploie plus
 * (cf. `scoreBras`) ; le Garde-Fous (`garde-fou.ts`), qui n'a que trois
 * échelons, garde UCB1 tel quel.
 */
export const C_EXPLORATION = Math.SQRT2;

/**
 * Le score UCB1 d'un bras : sa moyenne, plus un bonus d'autant plus gros qu'il
 * a été PEU essayé au regard de l'ensemble ; `+∞` s'il n'a jamais servi.
 *
 * GARDÉ POUR LE GARDE-FOUS, qui le réutilise sur trois échelons bornés — trois
 * essais forcés y sont un prix connu. L'Aiguillage, lui, ne l'emploie plus :
 * son `+∞` commandait à l'aveugle chaque modèle cher jamais tenté, dans chaque
 * genre, et aucune pondération ne survivait à l'infini (docs/ETAPES.md).
 */
export function scoreUCB(a: Antecedent, totalGenre: number): number {
  if (a.essais === 0) return Number.POSITIVE_INFINITY;
  return moyenne(a) + C_EXPLORATION * Math.sqrt(Math.log(Math.max(totalGenre, 1)) / a.essais);
}

/**
 * La MASSE de l'a priori : combien de verdicts « vaut » ce qu'on croit d'un bras
 * avant de l'avoir vu. Reprise de LiteLLM (`COLD_START_MASS`, adaptive_router,
 * MIT, Copyright (c) 2023 Berri AI) : une dizaine de vrais verdicts suffisent à
 * déplacer la croyance nettement. C'est elle qui remplace le `+∞` : un inconnu
 * a une note plausible et une incertitude FINIE, donc il est essayé quand son
 * optimisme dépasse le meilleur connu — plus d'office.
 */
export const MASSE_A_PRIORI = 10;

/**
 * La croyance sur un MODÈLE jamais jugé sur ce genre : le milieu de l'échelle
 * de récompense. Ni le meilleur connu (ce serait rendre l'infini par un autre
 * chemin), ni zéro (inconnu n'est pas mauvais). Un palier par fournisseur ou
 * une calibration (G24) le remplaceront quand ils existeront — aucun n'existe
 * aujourd'hui, et Hive n'invente pas le mérite d'un modèle.
 */
export const MOYENNE_NEUTRE = 0.5;

/** Le risque d'erreur de l'état « décidé » : 5 %. */
export const DELTA_DECISION = 0.05;
/** Quantile bilatéral de la loi normale à `DELTA_DECISION` (95 %). */
const Z_DECISION = 1.959963984540054;

/**
 * Le poids du coût dans le score, quand il y entre. Repris de LiteLLM
 * (`DEFAULT_COST_WEIGHT`, adaptive_router/config.py, MIT, Copyright (c) 2023
 * Berri AI), qui les annote lui-même « UNVALIDATED — calibrated against [0]
 * sessions » : ce sont des premiers pas, pas une mesure.
 */
export const POIDS_COUT = 0.3;
const POIDS_QUALITE = 1 - POIDS_COUT;

/**
 * Les bornes de Wilson d'une proportion `p` sur `n` essais, au quantile `z`.
 *
 * Wilson, et pas la moyenne ± z·écart-type : près de 0 ou de 1 et sur peu
 * d'essais, l'intervalle normal sort de [0, 1] et se resserre à tort (un bras à
 * 3 sur 3 aurait un intervalle nul). Wilson reste dans [0, 1] et garde de la
 * largeur. Les notes à mi-chemin (`améliorer` vaut 0,5) y entrent comme une
 * proportion : une approximation, dite, du modèle de Bernoulli.
 */
export function bornesWilson(p: number, n: number, z: number): { bas: number; haut: number } {
  const z2n = (z * z) / n;
  const centre = p + z2n / 2;
  const marge = z * Math.sqrt((p * (1 - p)) / n + z2n / (4 * n));
  return {
    bas: Math.max(0, (centre - marge) / (1 + z2n)),
    haut: Math.min(1, (centre + marge) / (1 + z2n)),
  };
}

/**
 * Le coût déclaré mis dans [0, 1] : 1 pour le moins cher, 0 pour le plus cher,
 * 0,5 quand tous se valent. Porté de LiteLLM (`normalized_cost`,
 * adaptive_router/bandit.py, MIT, Copyright (c) 2023 Berri AI).
 */
function coutNormalise(cout: number, tous: readonly number[]): number {
  const bas = Math.min(...tous);
  const haut = Math.max(...tous);
  return haut === bas ? 0.5 : 1 - (cout - bas) / (haut - bas);
}

/**
 * Ce qu'on rend pour la transparence : le score de chaque bras, expliqué.
 *
 * `essais` et `moyenne` ne parlent QUE des verdicts reçus PAR CE BRAS ; `enVol`
 * compte à part les élections lancées et pas encore jugées. Le `score`, lui,
 * compte les deux (une élection en vol y pèse comme un essai à note nulle) et
 * l'a priori hérité du modèle : c'est lui qui décide, le reste l'explique.
 */
export interface Rang {
  modele: string;
  harness: string;
  /** `null` : aucun effort commandé (défaut du CLI). */
  effort: Effort | null;
  /** Verdicts reçus. 0 : jamais jugé sous ce bras — « à explorer », pas « mauvais ». */
  essais: number;
  /** Élections en vol, sans verdict encore. */
  enVol: number;
  /** Moyenne des seuls verdicts reçus ; 0 sans verdict (jamais `NaN`). */
  moyenne: number;
  /** Intervalle de Wilson à 95 % sur les verdicts reçus ; `null` sans verdict. */
  intervalle: { bas: number; haut: number } | null;
  /** Coût moyen DÉCLARÉ (USD) par production jugée ; `null` : jamais déclaré. */
  cout: number | null;
  /** Toujours fini : il n'y a plus d'infini à exporter. */
  score: number;
  /**
   * Le modèle que la tâche PARENTE a dit préférer (délégation). Présent sur sa
   * seule ligne : c'est la trace que la préférence a été lue — et, si cette
   * ligne est en tête alors qu'un ex æquo la précédait par le nom, qu'elle a
   * départagé.
   */
  preferee?: true;
}

/**
 * Où en est le choix, pour l'affichage — JAMAIS pour arrêter d'explorer.
 *
 *   · `decide`  : l'élu a des verdicts, et la borne basse de son intervalle
 *     dépasse la borne haute de CHACUN des autres, tous jugés. À `δ` près, il
 *     est le meilleur de ceux qu'on a vus.
 *   · `explore` : ce n'est pas encore le cas — un rival n'a jamais été jugé, ou
 *     les intervalles se chevauchent.
 *   · `seul`    : un seul bras en lice ; il n'y a rien à départager.
 *
 * Le Track-and-Stop de TensorZero ARRÊTE d'explorer une fois décidé ; ici non.
 * Un modèle change (le fournisseur le remplace sous le même nom), et une ruche
 * qui aurait cessé de regarder ne le verrait jamais : le score garde son
 * bonus, la fenêtre glissante oublie, et « décidé » peut redevenir « explore ».
 */
export type EtatDecision = 'decide' | 'explore' | 'seul';

export interface Classement {
  rang: Rang[];
  etat: EtatDecision;
  /**
   * Le coût est-il entré dans les scores ? Seulement quand TOUS les bras
   * comparés en déclarent un. Codex ne déclare que des jetons, et Hive ne tire
   * jamais un coût des jetons : pondérer le coût « quand il est connu »
   * pénaliserait celui qui le déclare face à celui qui se tait. Un coût
   * inconnu n'est ni zéro ni une moyenne — il éteint le terme pour tous.
   */
  coutPondere: boolean;
}

/**
 * Ordre par unités de code, et NON `localeCompare` : celui-ci suit la locale ICU
 * du processus, et deux ruches (ou les trois OS de la CI) pourraient départager
 * autrement deux noms libres — « même vécu, même choix » ne tiendrait plus.
 */
function ordreBrut(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Départage total et INDÉPENDANT de l'ordre d'entrée. */
function departager(x: Rang, y: Rang): number {
  if (y.score !== x.score) return y.score - x.score;
  return (
    ordreBrut(x.modele, y.modele) ||
    ordreBrut(x.harness, y.harness) ||
    // À mérite égal, le moindre effort : le défaut, puis low → max.
    rangEffort(x.effort) - rangEffort(y.effort)
  );
}

/**
 * Classe les bras disponibles pour un genre, du plus au moins recommandé.
 *
 * ─── LE SCORE ─────────────────────────────────────────────────────────────────
 *
 * Pour chaque bras : une croyance a priori (moyenne μ, masse `MASSE_A_PRIORI`),
 * mise à jour par ses propres essais — la moyenne a posteriori p sur
 * n = masse + essais. Le score est la BORNE HAUTE de Wilson de p sur n, à un
 * quantile z = √(2·ln N) qui croît avec N, le total des essais du genre sur
 * les bras en lice : c'est l'optimisme d'UCB1, mais porté par l'incertitude
 * réelle d'une proportion. Déterministe de bout en bout — ce dépôt interdit
 * `Math.random`, d'où Wilson plutôt que l'échantillonnage de Thompson de
 * LiteLLM.
 *
 * μ vient du niveau MODÈLE (tous ses bras, verdicts seuls), SANS les verdicts du
 * bras lui-même — sinon ils compteraient deux fois —, lui-même tiré vers
 * `MOYENNE_NEUTRE` par la même masse. Les élections EN VOL des bras FRÈRES
 * entrent dans n comme des essais à note nulle : la borne du troupeau vaut par
 * modèle, pas par effort (cf. `injecterEnVol`). Un modèle neuf part donc de 0,5 avec
 * l'incertitude de dix verdicts : il ne passe devant un modèle connu et bon que
 * quand l'optimisme dû à son ignorance l'emporte. Et tout bras finit par être
 * réessayé : z croît sans borne, la borne haute d'un bras délaissé tend vers 1.
 *
 * ─── LE COÛT ─────────────────────────────────────────────────────────────────
 *
 * Quand TOUS les bras en lice déclarent un coût (cf. `Classement.coutPondere`)
 * — un bras ne le « déclare » que si CHACUN de ses verdicts en porte un : une
 * moyenne tirée des seuls verdicts chiffrés mêlerait, à l'intérieur du bras,
 * le déclaré et l'inconnu que la règle interdit de mêler entre bras —,
 * score = 0,7 · qualité + 0,3 · coût normalisé (le moins cher vaut 1). Sinon,
 * score = qualité — et c'est le même ordre pour tout le monde.
 *
 * Départage déterministe et INDÉPENDANT de l'ordre d'entrée : score
 * décroissant, puis modèle, harness, effort (le moindre d'abord).
 */
export function classer(
  categorie: Categorie,
  brasDispo: readonly Bras[],
  vecu: VecuAiguillage,
): Classement {
  const propres = brasDispo.map((b) => vecu.bras.get(cleBras(categorie, b)) ?? vide());
  const total = propres.reduce((n, a) => n + a.essais, 0);
  const z = Math.sqrt(2 * Math.log(Math.max(total, 1)));
  const couts = propres.map((a) => {
    const juges = a.essais - (a.enVol ?? 0);
    return juges > 0 && a.coutsDeclares === juges ? (a.coutTotal ?? 0) / juges : null;
  });
  const declares = couts.filter((c): c is number => c !== null);
  const coutPondere = brasDispo.length >= 2 && declares.length === brasDispo.length;
  const rang = brasDispo
    .map((b, i): Rang => {
      const a = propres[i]!;
      const enVol = a.enVol ?? 0;
      const juges = a.essais - enVol;
      const m = vecu.modeles.get(cle(categorie, b.modele)) ?? vide();
      const priori =
        (MASSE_A_PRIORI * MOYENNE_NEUTRE + m.recompenseTotale - a.recompenseTotale) /
        (MASSE_A_PRIORI + m.essais - juges);
      // Les élections en vol des FRÈRES (même modèle, autre bras) : des essais
      // à note nulle pour ce bras aussi, sans quoi chaque effort d'un modèle
      // jamais jugé raflerait sa tâche avant le premier verdict.
      const freres = (m.enVol ?? 0) - enVol;
      const n = MASSE_A_PRIORI + a.essais + freres;
      const qualite = bornesWilson((MASSE_A_PRIORI * priori + a.recompenseTotale) / n, n, z).haut;
      const cout = couts[i] ?? null;
      return {
        modele: b.modele,
        harness: b.harness,
        effort: b.effort,
        essais: juges,
        enVol,
        // Les élections en vol n'ont récolté aucune note : la moyenne affichée
        // est celle des VERDICTS, pas diluée de zéros jamais prononcés.
        moyenne: juges > 0 ? a.recompenseTotale / juges : 0,
        intervalle: juges > 0 ? bornesWilson(a.recompenseTotale / juges, juges, Z_DECISION) : null,
        cout,
        score:
          coutPondere && cout !== null
            ? POIDS_QUALITE * qualite + POIDS_COUT * coutNormalise(cout, declares)
            : qualite,
      };
    })
    .sort(departager);
  return { rang, etat: etatDe(rang), coutPondere };
}

function etatDe(rang: readonly Rang[]): EtatDecision {
  const [elu, ...autres] = rang;
  if (!elu || autres.length === 0) return 'seul';
  if (!elu.intervalle) return 'explore';
  const bas = elu.intervalle.bas;
  return autres.every((r) => r.intervalle !== null && r.intervalle.haut < bas)
    ? 'decide'
    : 'explore';
}

/**
 * Classe des MODÈLES, tous bras confondus — pour qui choisit un modèle sans
 * savoir encore sous quel harness il tournera : le banc d'ombre
 * (shadow-bench.ts), dont l'ombre part chez n'importe quelle ouvrière isolée
 * qui déclare ce modèle, et sans effort commandé.
 *
 * Le MÊME score que `classer`, porté au niveau modèle : chaque modèle y est un
 * bras unique dont le vécu propre est celui du modèle entier (ses verdicts, et
 * ses élections en vol comptées comme essais à note nulle). Il n'hérite donc de
 * rien d'autre que de la moyenne neutre : un modèle jamais jugé part de 0,5
 * avec l'incertitude de `MASSE_A_PRIORI` verdicts, et ne passe devant un
 * modèle connu que quand l'optimisme de son ignorance l'emporte. Rien n'est
 * écrit dans `vecu`.
 */
export function classerModeles(
  categorie: Categorie,
  modeles: readonly string[],
  vecu: VecuAiguillage,
): Rang[] {
  const offerts: Bras[] = [...new Set(modeles)].map((modele) => ({
    modele,
    harness: '',
    effort: null,
  }));
  const auNiveauModele: VecuAiguillage = { bras: new Map(), modeles: new Map() };
  for (const b of offerts) {
    const m = vecu.modeles.get(cle(categorie, b.modele));
    if (!m) continue;
    auNiveauModele.modeles.set(cle(categorie, b.modele), m);
    auNiveauModele.bras.set(cleBras(categorie, b), { ...m, essais: m.essais + (m.enVol ?? 0) });
  }
  return classer(categorie, offerts, auNiveauModele).rang;
}

/**
 * LE choix : quel bras pour ce genre, parmi ceux que le nœud sait faire
 * tourner ? `null` si la liste est vide — l'appelant retombe alors sur son
 * comportement d'avant (le nœud choisit lui-même), plutôt que sur un bras
 * inventé.
 *
 * La forme la plus courte de la règle, gardée comme référence de la doctrine
 * (bancs, `docs/ETAPES.md`). L'ordonnanceur, lui, passe par `aiguillerNoeuds`
 * — la course comme la boucle principale — parce qu'il lui faut aussi le
 * classement entier, qui est la RAISON du choix, et les porteurs de l'élu.
 */
export function choisirBras(
  categorie: Categorie,
  brasDispo: readonly Bras[],
  vecu: VecuAiguillage,
): Bras | null {
  const elu = classer(categorie, brasDispo, vecu).rang[0];
  return elu ? { modele: elu.modele, harness: elu.harness, effort: elu.effort } : null;
}

// ─── Du bras élu aux nœuds qui savent le faire tourner ────────────────────────
//
// Le Scheduler ne choisit pas un bras dans le vide : les bras sont
// PARTITIONNÉS par nœud (un nœud claude-code ne lance pas Grok, et un nœud
// n'offre que les efforts qu'il a déclarés). Cette fonction
// fait le pont, et son parti pris est décisif — l'union se calcule sur les seuls
// nœuds ÉLIGIBLES (déjà filtrés par l'appelant : en ligne, non saturés, hors
// cooldown de refus). Un modèle dont l'unique porteur est saturé n'entre donc
// jamais dans l'union : la famine « le meilleur modèle vit sur un nœud plein »
// est tuée par construction, pas rattrapée après coup.
//
// L'ordre est LEXICOGRAPHIQUE et il se lit de gauche à droite : l'appelant a déjà
// trié `eligibles` par charge (et phéromones), on élit le modèle sur l'union,
// puis on REND la sous-liste des offrants DANS CET ORDRE — le départage par
// charge de l'appelant s'applique ensuite tel quel, sur la seule liste
// restreinte. Le modèle domine donc la charge PARMI les éligibles (c'est le but :
// piloter réellement le travail), sans jamais franchir le filtre de capacité qui
// reste en amont, chez l'appelant.

/** Ce que l'Aiguillage lit d'un nœud pour savoir quels bras il porte. */
export interface NoeudPorteur {
  readonly agentType: string;
  readonly modeles?: readonly string[] | null;
  readonly efforts?: readonly Effort[] | null;
}

/**
 * Les bras qu'un nœud sait faire tourner : chacun de ses modèles, sous SON
 * harness, SANS effort commandé (le défaut du CLI) PUIS à chacun des efforts
 * qu'il a déclarés. Un nœud qui n'en déclare aucun (agent sans effort
 * documenté, ou nœud d'avant la v3 : lui envoyer un effort, qu'il ignorerait,
 * rangerait son verdict sous un effort qui n'a jamais tourné) n'offre que le
 * premier.
 *
 * LE BRAS SANS EFFORT RESTE TOUJOURS OFFERT. C'est sous lui qu'est rangé tout le
 * vécu d'avant la v3 et tout ce qu'ont appris les nœuds sans effort : le
 * retirer aux nœuds qui en déclarent rendait ce vécu inéligible (il ne
 * nourrissait plus que l'a priori), et, à mérite égal, le départage envoyait
 * `--effort low` — en dessous du défaut que l'opérateur n'a jamais changé.
 */
export function brasDuNoeud(n: NoeudPorteur): Bras[] {
  const efforts: readonly (Effort | null)[] = [null, ...(n.efforts ?? [])];
  return (n.modeles ?? []).flatMap((modele) =>
    efforts.map((effort) => ({ modele, harness: n.agentType, effort })),
  );
}

const porte = (n: NoeudPorteur, b: Bras): boolean =>
  n.agentType === b.harness &&
  (n.modeles ?? []).includes(b.modele) &&
  (b.effort === null || (n.efforts ?? []).includes(b.effort));

/**
 * Le bras élu pour ce genre, et les nœuds éligibles qui le portent — ou `null`
 * si AUCUN éligible ne déclare de modèle. Le `null` est le NO-OP : l'appelant
 * garde alors exactement son ordonnancement d'avant, sans rien restreindre ni
 * enregistrer. `eligibles` est supposé déjà filtré ET trié par l'appelant ; la
 * sous-liste rendue préserve cet ordre.
 */
export function aiguillerNoeuds<N extends NoeudPorteur>(
  categorie: Categorie,
  eligibles: readonly N[],
  vecu: VecuAiguillage,
  /**
   * Le modèle préféré par une tâche parente (délégation), s'il y en a un :
   * un DÉPARTAGE entre ex æquo au meilleur score, jamais une exclusion levée —
   * un modèle absent des éligibles, ou moins bien classé, n'y gagne rien.
   */
  preferenceModele?: string,
): ({ bras: Bras; noeuds: N[]; departageParPreference: boolean } & Classement) | null {
  // Une `Map` par clé de bras déduplique par CONSTRUCTION : le même bras offert
  // par deux nœuds ne doit compter qu'une fois pour `classer`, sinon le total
  // du genre est doublé et l'optimisme faussé. Aucun prédicat de dédup à part —
  // c'est la structure qui le tient, pas une ligne qu'on pourrait muter seule.
  const union = new Map<string, Bras>();
  for (const n of eligibles) for (const b of brasDuNoeud(n)) union.set(cleBras(categorie, b), b);
  // On CLASSE une seule fois : le premier est l'élu, et le classement entier
  // est la RAISON du choix — celle que Mission Control montrera (« pourquoi ce
  // modèle »). Recalculer un second classement pour l'explication le ferait
  // diverger du choix ; c'est le même `Rang[]` qui décide et qui s'explique.
  // Union vide (aucun éligible ne déclare de modèle) : `rang` est vide, l'élu
  // est `null`, et ce `null` EST le no-op — l'appelant garde son ordonnancement.
  const classement = classer(categorie, [...union.values()], vecu);
  const { rang, departageParPreference } = departagerParPreference(
    classement.rang,
    preferenceModele,
  );
  const elu = rang[0];
  if (!elu) return null;
  const bras: Bras = { modele: elu.modele, harness: elu.harness, effort: elu.effort };
  // L'état se relit sur le rang DÉPARTAGÉ : c'est son premier qui est l'élu.
  return {
    bras,
    noeuds: eligibles.filter((n) => porte(n, bras)),
    ...classement,
    rang,
    etat: etatDe(rang),
    departageParPreference,
  };
}

/**
 * La préférence d'une tâche parente, appliquée au seul endroit où elle a le
 * droit de peser : l'ÉGALITÉ au meilleur score. `classer` départage les ex
 * æquo par modèle, harness puis effort — un ordre arbitraire mais
 * reproductible ; la préférence le remplace, et seulement lui. Depuis la v3,
 * la ligne lue est le MEILLEUR bras du modèle préféré (le premier du rang) :
 * la préférence nomme un modèle, jamais un effort. Le classement reste celui
 * que l'Aiguillage a calculé : aucune note ne bouge, la ligne préférée est
 * seulement remontée parmi ses égales, et marquée (`preferee`) pour que la
 * raison le dise.
 */
function departagerParPreference(
  rang: Rang[],
  preferenceModele: string | undefined,
): { rang: Rang[]; departageParPreference: boolean } {
  const index = preferenceModele ? rang.findIndex((l) => l.modele === preferenceModele) : -1;
  if (index < 0) return { rang, departageParPreference: false };
  const marque = rang.map((l, i) => (i === index ? { ...l, preferee: true as const } : l));
  const tete = marque[0];
  const preferee = marque[index];
  if (index === 0 || !tete || !preferee || preferee.score !== tete.score) {
    return { rang: marque, departageParPreference: false };
  }
  return {
    rang: [preferee, ...marque.filter((_, i) => i !== index)],
    departageParPreference: true,
  };
}

// ─── La reprise d'une tâche : sans les modèles qui y ont planté ───────────────
//
// Un modèle qui a planté sur une tâche (délai, erreur du CLI, refus
// d'infrastructure — cf. `Scheduler.modelesEchoues`) n'est pas ré-élu pour ses
// reprises : jamais jugé, il gardait l'optimisme de l'inconnu (`+∞` jusqu'à la
// v2), revenait en tête et brûlait toutes les tentatives. Et ce plantage n'entre JAMAIS dans les antécédents : ce
// n'était pas un essai loyal, il ne dit rien de la qualité du modèle.
//
// Tout le parti pris tient dans CONTRE QUOI l'écart se décide : l'OFFRE de la
// ruche pour cette tâche — les nœuds qui pourraient la porter, charge ignorée —
// et non les seuls éligibles du tick. Décidé contre les libres, « tous les
// modèles offerts ont échoué » devenait vrai dès que le porteur sain était
// occupé, ou que l'alternative était un nœud sans modèle déclaré : le modèle
// tombé reprenait les trois tentatives, et la tâche échouait pour de bon à côté
// d'une ouvrière saine — justement sur une ruche chargée, là où les reprises
// s'accumulent. La charge passe ; une reprise l'attend comme toute tâche en file.

/** Ce que l'Aiguillage lit d'un nœud : les modèles qu'il déclare savoir lancer. */
type NoeudOffrant = { readonly modeles?: readonly string[] | null };

/**
 * Les nœuds qui portent encore la tâche SANS un modèle qui y a planté, chacun
 * privé de ces modèles. Un nœud qui n'offrait QUE des modèles tombés n'en porte
 * plus : gardé sans modèle, il lancerait son défaut — peut-être celui-là même.
 * Un nœud qui ne déclare aucun modèle reste porteur : son défaut est inconnu,
 * pas tombé.
 */
function porteursHorsEchecs<N extends NoeudOffrant>(
  noeuds: readonly N[],
  echoues: ReadonlySet<string>,
): N[] {
  const porteurs: N[] = [];
  for (const n of noeuds) {
    const modeles = n.modeles ?? [];
    const restants = modeles.filter((m) => !echoues.has(m));
    if (modeles.length === 0) porteurs.push(n);
    else if (restants.length > 0) porteurs.push({ ...n, modeles: restants });
  }
  return porteurs;
}

/**
 * La reprise d'une tâche : les éligibles à soumettre à `aiguillerNoeuds`, et
 * les modèles de l'offre que la raison dira écartés.
 *
 * `offre` : les nœuds qui pourraient porter la tâche, CHARGE IGNORÉE (en ligne,
 * autorisés à produire, hors cooldown de refus pour elle) ; `eligibles` en est
 * la part libre, filtrée et triée par l'appelant — l'ordre est préservé.
 *
 * Tant qu'un nœud de l'offre porte la tâche sans modèle tombé, les modèles
 * tombés sont écartés : les éligibles sont réduits à leurs porteurs, et la
 * liste rendue peut être VIDE — la tâche attend alors qu'un porteur se libère.
 * Plus aucun porteur dans toute l'offre (une ruche à modèle unique) : les
 * modèles tombés concourent de nouveau, et c'est à l'appelant de dire qu'il en
 * re-commande un — sans quoi la tâche attendrait à jamais.
 *
 * Un nœud qui a REFUSÉ cette tâche n'est pas dans l'offre, par choix : il a dit
 * lui-même qu'il ne la prendrait pas maintenant, et un nœud hors service peut
 * le dire pour vingt-quatre heures (Night Shift). L'attendre bloquerait la
 * reprise des heures durant quand une ouvrière est libre ; on accepte qu'un
 * refus de saturation de quelques secondes laisse passer une ré-admission,
 * dite comme telle.
 */
export function repriseHorsEchecs<N extends NoeudOffrant>(
  eligibles: readonly N[],
  offre: readonly NoeudOffrant[],
  echoues: ReadonlySet<string> | undefined,
): { eligibles: N[]; ecartes: string[] } {
  if (!echoues || echoues.size === 0 || porteursHorsEchecs(offre, echoues).length === 0) {
    return { eligibles: [...eligibles], ecartes: [] };
  }
  // Un `Set` : le même modèle offert par deux nœuds n'est nommé qu'une fois.
  const offerts = new Set(offre.flatMap((n) => n.modeles ?? []));
  return {
    eligibles: porteursHorsEchecs(eligibles, echoues),
    ecartes: [...offerts].filter((m) => echoues.has(m)).sort(),
  };
}

// ─── Le modèle IMPOSÉ d'un rejeu de mission ──────────────────────────────────
//
// Un rejeu (`shared/mission-rejouable.ts`) peut demander « la même mission,
// mais avec CE modèle ». Ce n'est pas une préférence que l'Aiguillage pèserait
// contre son vécu : c'est la question que pose le rejeu, et y répondre avec un
// autre modèle rendrait la comparaison fausse sans le dire.

/**
 * Les nœuds qui offrent `modele`, chacun réduit à CE seul modèle : l'Aiguillage
 * ne peut plus élire que lui, et le nœud le lancera (`--model`). Aucun nœud ne
 * l'offre : liste vide — la tâche attend, elle ne part pas sur un autre modèle.
 */
export function porteursDuModele<N extends NoeudOffrant>(
  noeuds: readonly N[],
  modele: string,
): N[] {
  return noeuds
    .filter((n) => (n.modeles ?? []).includes(modele))
    .map((n) => ({ ...n, modeles: [modele] }));
}
