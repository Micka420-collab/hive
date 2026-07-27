// Le Plein Essaim — la ruche se gouverne elle-même.
//
// Chez l'abeille, personne ne commande. La reine ne décide de rien : elle pond.
// Ce qui ressemble à une décision — essaimer, changer de site, abandonner un
// rayon — ÉMERGE de milliers d'interactions locales entre ouvrières qui n'ont
// aucune vue d'ensemble. C'est ce mode-là qu'on cherche ici : pas un pilote
// automatique qui exécute un plan, une colonie qui trouve son propre plan.
//
// ─── CE QUE CE MODULE DÉCIDE, ET CE QU'IL NE DÉCIDE PAS ──────────────────────
//
// Il décide TOUT le travail : ce sur quoi la ruche se penche, dans quel ordre,
// quand elle s'arrête, quand elle recommence, quand elle se critique, et ce
// qu'elle retient de ses erreurs. Aucun humain n'est consulté à aucun de ces
// tours. C'est l'objet de la fonctionnalité et il n'y a rien à négocier là.
//
// Il ne décide PAS de fusionner dans un dépôt que l'humain n'a pas inscrit une
// fois pour toutes. La distinction n'est pas de la timidité : une ruche Hive
// est COMMUNAUTAIRE, et un projet proposé par un membre appartient à quelqu'un
// d'autre. Fusionner chez un tiers sans qu'il l'ait jamais autorisé n'est pas
// de l'autonomie, c'est un accès en écriture non consenti. L'inscription est
// donc UNE autorisation, donnée une fois, par dépôt — et ensuite la ruche
// fusionne seule, cycle après cycle, sans plus rien demander.
//
// ─── QUI GOUVERNE ────────────────────────────────────────────────────────────
//
// Les meilleures ouvrières présentes, et elles seules : les BUTINEUSES au sens
// du polyéthisme, c'est-à-dire la caste qui s'est gagnée sur des antécédents
// observés (polyethisme.ts, règle 1 — une caste ne se déclare jamais).
//
// Conséquence, assumée et importante : une ruche où aucune ouvrière n'a fait
// ses preuves NE PEUT PAS se gouverner. `gouvernantes()` rend une liste vide,
// le cycle rend `inerte`, et rien ne démarre. Ce n'est pas une limitation
// contournable, c'est la propriété centrale : l'autonomie d'un essaim de
// modèles médiocres produirait vite beaucoup de code médiocre, et le
// mécanisme même qui l'empêche est celui qui mesure la qualité.
//
// ─── LA CRITIQUE EST STRUCTURELLE, PAS FACULTATIVE ───────────────────────────
//
// Une ruche autonome qui ne se critique pas dérive. Deux organes déjà écrits
// s'en chargent, et le cycle les rend OBLIGATOIRES plutôt qu'optionnels :
//   · le Conseil (`conseil.ts`) délibère à travers cinq lentilles dont deux
//     franchement adverses — `faiblesse` et `abandon`, celle qui demande s'il
//     ne faudrait pas tout arrêter ;
//   · la contre-visite (`polyethisme.ts`) demande, sur chaque production, non
//     pas « est-ce juste » mais « peut-on faire mieux ».
// Un cycle qui sauterait l'un des deux n'est pas un cycle plus rapide, c'est
// une ruche qui a cessé de se relire.
//
// ─── APPRENDRE DES AUTRES, ET NON DE SOI ─────────────────────────────────────
//
// La demande — « si elles font des erreurs la ruche apprend des autres, plus
// les agents interagissent plus ils apprennent » — a une traduction technique
// précise, et c'est le cœur de ce fichier.
//
// La Couveuse (`brood.ts`) apprend déjà des échecs D'UNE TÂCHE. C'est utile et
// c'est myope : la même erreur commise sur cinq tâches différentes y reste
// cinq incidents isolés. Ici, les échecs sont regroupés par SIGNATURE — la
// classe d'erreur, normalisée — à travers toutes les tâches et tous les nœuds.
//
// Et la confiance qu'on accorde à une leçon croît avec le nombre de NŒUDS
// DISTINCTS qui l'ont rencontrée, jamais avec le nombre de répétitions. Se
// tromper cinq fois sur la même machine enseigne quelque chose sur la machine ;
// se tromper une fois sur cinq machines enseigne quelque chose sur le CODE.
// C'est la seule lecture qui rende la phrase « plus les agents interagissent,
// plus ils apprennent » vraie plutôt que jolie.
//
// MODULE PUR — aucune I/O, aucun aléa, aucune horloge implicite. `essaim-runner`
// est le seul à toucher au monde.

import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { lignesDeLogs } from './brood.js';
import { SOLITUDE_JOURS } from './derive.js';
import type { Derive } from './derive.js';
import { evaluerCaste } from './polyethisme.js';
import type { Antecedents, Caste } from './polyethisme.js';

/** Version de l'algorithme de gouvernance. Motif VERSION_BALANCE. */
export const VERSION_ESSAIM = 1;

/**
 * Les quatre positions de l'interrupteur, de l'inerte au plein.
 *
 * - `off`      : la ruche attend qu'on lui dise quoi faire. Défaut.
 * - `propose`  : elle décide seule quoi faire et crée les tâches. Elle ne
 *                livre rien.
 * - `gouverne` : elle décide, produit, se critique et OUVRE les pull requests.
 *                Rien n'est fusionné.
 * - `plein`    : tout ce qui précède, et elle fusionne — uniquement sur les
 *                dépôts inscrits, et seulement quand la contre-visite conclut
 *                « appliquer ».
 *
 * Le saut qui compte est `gouverne` → `plein`, et il est le seul qui demande
 * une inscription explicite par dépôt.
 */
export const NIVEAUX = ['off', 'propose', 'gouverne', 'plein'] as const;
export type NiveauAutonomie = (typeof NIVEAUX)[number];

/** Rang d'un niveau, pour comparer sans dépendre de l'ordre du tableau. */
export function rangNiveau(n: NiveauAutonomie): number {
  return NIVEAUX.indexOf(n);
}

// ─── Qui gouverne ────────────────────────────────────────────────────────────

/** Caste minimale pour siéger. Les meilleures ouvrières, et elles seules. */
export const CASTE_GOUVERNANTE: Caste = 'butineuse';

/**
 * Nombre minimal de gouvernantes pour qu'une décision soit une décision.
 *
 * Deux, et pas une : une ouvrière seule qui se gouverne n'est pas une
 * gouvernance, c'est un agent en boucle. Il faut au moins deux points de vue
 * pour qu'une critique existe — et c'est aussi ce qui empêche un nœud unique,
 * fût-il excellent, de piloter la ruche entière tout seul.
 */
export const GOUVERNANTES_MIN = 2;

export interface NoeudObserve {
  nodeId: string;
  nom: string;
  enLigne: boolean;
  antecedents: Antecedents;
}

/**
 * Les ouvrières habilitées à gouverner : en ligne, et de caste butineuse.
 *
 * Triées par fiabilité décroissante puis par identifiant — ordre TOTAL, pour
 * qu'un même état rende toujours la même liste. Une gouvernance qui changerait
 * d'avis selon l'ordre d'un `Map` ne serait pas rejouable, et une ruche
 * autonome non rejouable est une ruche dont on ne peut pas expliquer les actes.
 */
export function gouvernantes(noeuds: readonly NoeudObserve[]): NoeudObserve[] {
  return noeuds
    .filter((n) => n.enLigne && evaluerCaste(n.antecedents) === CASTE_GOUVERNANTE)
    .sort(
      (a, b) =>
        b.antecedents.productions - a.antecedents.productions || a.nodeId.localeCompare(b.nodeId),
    );
}

/** La ruche peut-elle se gouverner ? */
export function peutGouverner(noeuds: readonly NoeudObserve[]): boolean {
  return gouvernantes(noeuds).length >= GOUVERNANTES_MIN;
}

// ─── Apprendre des autres ────────────────────────────────────────────────────

/** Longueur maximale d'une signature. Ce sont des clés, pas des documents. */
const MAX_SIGNATURE = 160;
/** Longueur maximale de l'extrait cité par une leçon. */
const MAX_EXTRAIT = 240;

/** Nœuds distincts à partir desquels une leçon est jugée SYSTÉMIQUE. */
export const NOEUDS_SYSTEMIQUE = 3;

/** Leçons croisées rendues au plus. Un prompt n'est pas une encyclopédie. */
export const MAX_LECONS = 8;

const MOTIF_ERREUR = /error|erreur|échec|echec|failed|exception|traceback|assert/i;

/**
 * Normalise une ligne d'erreur en SIGNATURE — ce qui reste quand on retire
 * tout ce qui change d'une occurrence à l'autre.
 *
 * Sont effacés : les nombres (numéros de ligne, ports, durées, tailles), les
 * chemins absolus, les identifiants hexadécimaux et les UUID. Ce qui reste est
 * la forme de l'erreur. Sans cette normalisation, « TypeError at line 42 » et
 * « TypeError at line 87 » seraient deux leçons distinctes vues une fois
 * chacune — c'est-à-dire aucune leçon.
 */
export function signatureEchec(logs: string): string {
  const lignes = lignesDeLogs(logs);
  const candidates = lignes.filter((l) => MOTIF_ERREUR.test(l));
  const ligne = candidates[0] ?? lignes[lignes.length - 1] ?? '';
  const normalisee = ligne
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<hex>')
    .replace(/(?:[A-Za-z]:)?[/\\][\w.\-/\\]+/g, '<chemin>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return champSurUneLigne(normalisee, MAX_SIGNATURE);
}

/** Un échec observé, réduit à ce qui sert à apprendre. */
export interface EchecObserve {
  nodeId: string;
  taskId: string;
  logs: string;
  createdAt: number;
}

/** Ce que la ruche a appris d'une classe d'erreur, à travers ses membres. */
export interface LeconCroisee {
  signature: string;
  /** Nœuds DISTINCTS qui l'ont rencontrée. C'est le chiffre qui compte. */
  noeuds: number;
  /** Tâches DISTINCTES concernées — une erreur qui ne touche qu'une tâche est locale. */
  taches: number;
  occurrences: number;
  /** `isolee` | `confirmee` | `systemique`, selon les nœuds distincts. */
  portee: 'isolee' | 'confirmee' | 'systemique';
  /** Dans [0, 1]. Croît avec les NŒUDS distincts, jamais avec les répétitions. */
  confiance: number;
  /** Extrait le plus récent, déjà neutralisé. */
  extrait: string;
  /** Horodatage de la dernière occurrence. */
  vueA: number;
}

/**
 * Regroupe des échecs par signature, à travers les tâches ET les nœuds.
 *
 * LA RÈGLE, une fois pour toutes : la confiance ne dépend QUE du nombre de
 * nœuds distincts. Les occurrences n'entrent que dans le tri, à confiance
 * égale. Une ouvrière qui bute vingt fois sur la même chose n'apprend rien à la
 * ruche que la première fois n'ait déjà dit ; deux ouvrières différentes qui
 * butent sur la même chose, si.
 */
export function leconsCroisees(echecs: readonly EchecObserve[], max = MAX_LECONS): LeconCroisee[] {
  interface Accu {
    noeuds: Set<string>;
    taches: Set<string>;
    occurrences: number;
    extrait: string;
    vueA: number;
  }
  const parSignature = new Map<string, Accu>();

  for (const e of echecs) {
    const signature = signatureEchec(e.logs);
    if (signature === '') continue;
    const a = parSignature.get(signature) ?? {
      noeuds: new Set<string>(),
      taches: new Set<string>(),
      occurrences: 0,
      extrait: '',
      vueA: 0,
    };
    a.noeuds.add(e.nodeId);
    a.taches.add(e.taskId);
    a.occurrences += 1;
    // Le plus RÉCENT extrait fait foi : c'est celui qui décrit l'état actuel
    // du code, pas celui d'il y a trois semaines.
    if (e.createdAt >= a.vueA) {
      a.vueA = e.createdAt;
      a.extrait = champSurUneLigne(extraitCourt(e.logs), MAX_EXTRAIT);
    }
    parSignature.set(signature, a);
  }

  const lecons: LeconCroisee[] = [];
  for (const [signature, a] of parSignature) {
    const noeuds = a.noeuds.size;
    lecons.push({
      signature,
      noeuds,
      taches: a.taches.size,
      occurrences: a.occurrences,
      portee: noeuds >= NOEUDS_SYSTEMIQUE ? 'systemique' : noeuds >= 2 ? 'confirmee' : 'isolee',
      confiance: Math.min(1, noeuds / NOEUDS_SYSTEMIQUE),
      extrait: a.extrait,
      vueA: a.vueA,
    });
  }
  // Ordre TOTAL : confiance, puis tâches touchées, puis occurrences, puis la
  // signature elle-même — deux ruches au même état rendent la même liste.
  return lecons
    .sort(
      (x, y) =>
        y.confiance - x.confiance ||
        y.taches - x.taches ||
        y.occurrences - x.occurrences ||
        x.signature.localeCompare(y.signature),
    )
    .slice(0, max);
}

/** Les dernières lignes qui crient, jointes — version courte d'extraitDesLogs. */
function extraitCourt(logs: string): string {
  const lignes = lignesDeLogs(logs);
  const erreurs = lignes.filter((l) => MOTIF_ERREUR.test(l));
  return (erreurs.length > 0 ? erreurs : lignes).slice(-2).join(' ⏎ ');
}

// ─── Le cycle ────────────────────────────────────────────────────────────────

/**
 * Ce que la ruche fait au tour suivant. Un seul pas à la fois : une gouvernance
 * qui déciderait dix choses d'un coup ne pourrait pas apprendre de la première
 * avant d'engager la dixième.
 */
export type Pas =
  /** Aucune gouvernante : la ruche ne peut pas se gouverner. */
  | 'inerte'
  /** La ruche se dégrade : elle s'arrête d'elle-même (derive.ts). */
  | 'halte'
  /** Le plafond de dépense est atteint. */
  | 'plafond'
  /** Ouvrir un conseil : décider quoi faire ensuite. */
  | 'deliberer'
  /** Transformer le verdict d'un conseil en tâches. */
  | 'planifier'
  /** Le travail est en cours ; laisser les ouvrières travailler. */
  | 'butiner'
  /** Corriger ce que les leçons croisées désignent comme systémique. */
  | 'corriger'
  /** Ouvrir les pull requests des productions prêtes. */
  | 'livrer'
  /** Fusionner ce qui est relu et autorisé. */
  | 'fusionner';

/** L'état observé de la ruche, réduit aux faits qui décident. */
export interface EtatEssaim {
  niveau: NiveauAutonomie;
  noeuds: readonly NoeudObserve[];
  /** Tâches ni terminées ni échouées. */
  tachesEnCours: number;
  /** Tâches prêtes mais non encore assignées. */
  tachesPretes: number;
  /** Un conseil est ouvert et n'a pas conclu. */
  conseilEnCours: boolean;
  /** Un conseil a conclu et son verdict n'a pas encore été transformé en tâches. */
  verdictANourrir: boolean;
  /** Productions réussies, relues, et pas encore livrées. */
  productionsALivrer: number;
  /** Pull requests ouvertes par la ruche, contre-visitées « appliquer ». */
  prAFusionner: number;
  /** Le dépôt du projet est-il inscrit pour la fusion autonome ? */
  depotInscrit: boolean;
  /** Leçons croisées en vigueur. */
  lecons: readonly LeconCroisee[];
  /** Verdict du plafond de dépense (La Balance). */
  plafond: 'passe' | 'alerte' | 'bloque';
  /**
   * Verdict de La Dérive — la seule chose qui rende une autonomie de
   * plusieurs semaines défendable : la ruche sait reconnaître qu'elle se
   * dégrade, et s'arrêter avant d'avoir pourri le projet.
   */
  derive: Derive;
}

export interface Decision {
  pas: Pas;
  /** Pourquoi, en une phrase. Destiné au Journal, jamais au prompt d'un agent. */
  motif: string;
  /** Gouvernantes qui portent la décision. */
  gouvernantes: string[];
}

/**
 * Le pas suivant, déduit de l'état et de rien d'autre.
 *
 * PURE et TOTALE : même état, même décision. C'est ce qui rend une ruche
 * autonome explicable — on peut rejouer l'état d'hier et retrouver pourquoi
 * elle a fait ce qu'elle a fait.
 *
 * L'ORDRE DES PORTES EST LA POLITIQUE. Les trois premières sont des arrêts :
 * pas de gouvernantes, plus de budget, rien n'est engagé. Vient ensuite la
 * CORRECTION — avant toute nouvelle idée, parce qu'une ruche qui empile des
 * fonctionnalités sur une erreur systémique accélère vers le mur. Puis le
 * travail en cours, puis seulement la délibération.
 */
export function deciderPas(etat: EtatEssaim): Decision {
  const gouv = gouvernantes(etat.noeuds);
  const noms = gouv.map((g) => g.nodeId);
  const decision = (pas: Pas, motif: string): Decision => ({ pas, motif, gouvernantes: noms });

  if (etat.niveau === 'off') return decision('inerte', 'autonomie désactivée');
  if (gouv.length < GOUVERNANTES_MIN) {
    return decision(
      'inerte',
      `${gouv.length} ouvrière(s) de caste gouvernante, ${GOUVERNANTES_MIN} requises`,
    );
  }
  // LA HALTE, avant toute autre considération de travail. Une ruche qui se
  // dégrade ne doit pas continuer à produire, même si elle a du budget et des
  // tâches prêtes — c'est précisément dans ce cas-là qu'elle ferait le plus de
  // dégâts, parce que rien d'autre ne l'arrêterait.
  //
  // NUANCE D'AMORÇAGE, et elle est nécessaire : `indeterminee` ne halte PAS
  // une ruche neuve. Une ruche qui n'a encore rien produit est non mesurée,
  // pas aveugle — la halter interdirait à toute autonomie de jamais démarrer.
  // En revanche, ne toujours pas pouvoir mesurer APRÈS des semaines de
  // solitude ne veut plus dire « je suis neuve », cela veut dire que la source
  // de mesure est cassée. Là, on s'arrête.
  if (etat.derive.etat === 'degradee') {
    return decision('halte', etat.derive.motif || 'la ruche se dégrade');
  }
  if (etat.derive.etat === 'indeterminee' && etat.derive.solitudeJours >= SOLITUDE_JOURS) {
    return decision(
      'halte',
      `dérive non mesurable après ${Math.round(etat.derive.solitudeJours)} jour(s) sans regard humain : ${etat.derive.motif}`,
    );
  }

  if (etat.plafond === 'bloque') return decision('plafond', 'plafond de dépense atteint');

  // Corriger AVANT d'inventer. Une leçon systémique — la même erreur sur trois
  // machines différentes — est un fait sur le code, pas sur une machine.
  const systemique = etat.lecons.find((l) => l.portee === 'systemique');
  if (systemique) {
    return decision(
      'corriger',
      `leçon systémique sur ${systemique.noeuds} nœuds : ${systemique.signature}`,
    );
  }

  // Fusionner ce qui est relu, si et seulement si le niveau ET l'inscription
  // du dépôt l'autorisent. Les deux, jamais l'un sans l'autre.
  if (etat.prAFusionner > 0) {
    if (etat.niveau === 'plein' && etat.depotInscrit) {
      return decision('fusionner', `${etat.prAFusionner} pull request(s) relue(s) et autorisée(s)`);
    }
    // Sinon on ne bloque pas la ruche : elle continue son travail, les PR
    // attendent l'humain. Ce n'est pas un arrêt, c'est une file d'attente.
  }

  if (etat.productionsALivrer > 0 && rangNiveau(etat.niveau) >= rangNiveau('gouverne')) {
    return decision('livrer', `${etat.productionsALivrer} production(s) prête(s) à livrer`);
  }

  if (etat.conseilEnCours) return decision('butiner', 'un conseil délibère');
  if (etat.verdictANourrir) return decision('planifier', 'un verdict de conseil attend son plan');
  if (etat.tachesEnCours > 0) return decision('butiner', `${etat.tachesEnCours} tâche(s) en vol`);
  if (etat.tachesPretes > 0) return decision('butiner', `${etat.tachesPretes} tâche(s) prête(s)`);

  // Plus rien en vol, plus rien à livrer : c'est le moment de se demander quoi
  // faire ensuite. C'est le seul endroit d'où naît une idée neuve.
  return decision('deliberer', 'rien en vol — la ruche se demande quoi faire ensuite');
}

// ─── Ce que la ruche dit à ses ouvrières ─────────────────────────────────────

/**
 * Le bloc de leçons croisées à joindre au travail d'une ouvrière.
 *
 * Ce n'est PAS le bloc de la Couveuse, qui parle des échecs de LA tâche en
 * cours. Celui-ci parle de ce que la ruche entière a appris — et il dit
 * explicitement combien de machines différentes l'ont confirmé, parce que
 * c'est cette information-là qui permet à l'ouvrière de pondérer.
 *
 * Les leçons sont des données dérivées de logs d'agents : elles sont aplaties
 * et bornées. Elles ne vont pas dans un bloc `HIVE_DATA` ici parce qu'elles
 * n'entrent pas dans un prompt telles quelles — c'est l'appelant qui les
 * emballe, avec le reste de son contexte.
 */
export function resumeLecons(lecons: readonly LeconCroisee[]): string {
  if (lecons.length === 0) return '';
  const lignes = [
    'CE QUE LA RUCHE A APPRIS DE SES ERREURS',
    '',
    'Ces erreurs ont déjà été rencontrées par d’autres ouvrières, sur d’autres',
    'machines. Le nombre de machines compte : une erreur vue sur plusieurs',
    'machines vient du CODE, une erreur vue sur une seule vient peut-être de',
    'cette machine-là.',
    '',
  ];
  for (const l of lecons) {
    const portee =
      l.portee === 'systemique'
        ? `⚠ SYSTÉMIQUE — ${l.noeuds} machines`
        : l.portee === 'confirmee'
          ? `confirmée — ${l.noeuds} machines`
          : 'isolée — 1 machine';
    lignes.push(`  · [${portee}] ${l.extrait}`);
  }
  return lignes.join('\n');
}
