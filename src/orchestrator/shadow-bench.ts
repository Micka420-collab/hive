// Le banc d'ombre — faire refaire une petite tâche par un SECOND modèle, pour
// comparer les deux sur des preuves, sans jamais rien livrer de la seconde.
//
// ─── LE PROBLÈME ─────────────────────────────────────────────────────────────
//
// L'Aiguillage (aiguillage.ts) apprend quel modèle sert le mieux chaque genre
// de tâche, mais il n'apprend que de ce qu'il a CHOISI : un modèle écarté par
// UCB n'est jamais revu sur les tâches où l'autre a été élu, et deux modèles
// ne se mesurent jamais sur la MÊME tâche. Le registre Genome montre des
// faits par modèle, mais sur des tâches différentes — une moyenne de Fable sur
// les tâches faciles ne se compare pas à celle d'Opus sur les difficiles.
//
// Le banc d'ombre fait l'expérience contrôlée qui manque : une tâche admise
// est rejouée, telle quelle, par un second modèle éligible, dans son propre
// atelier (`hive/<id>`, le bac de son nœud). Cette « ombre » ne se livre, ne se
// fusionne et ne se compte jamais comme travail du projet. Les deux productions
// passent par le chemin qui juge déjà toute production — validations du bac,
// Gardiennes, contre-revue, Evaluator — et ce sont les TESTS du projet qui
// départagent, jamais la préférence d'un modèle pour l'une ou l'autre.
//
// ─── CE QUE CE MODULE DÉCIDE, ET CE QU'IL NE FAIT PAS ────────────────────────
//
// Il répond à trois questions, à partir de faits qu'on lui donne :
//
//   · cette tâche est-elle ADMISE au banc (`jugerAdmissionOmbre`) — et par
//     quel second modèle ?
//   · qu'a donné chaque côté (`issueDeCote`) ?
//   · que dit la comparaison, et avec quelle confiance (`comparerOmbre`) ?
//
// Il ne lance rien, ne lit ni n'écrit aucune base. Le hub (server.ts) crée
// l'ombre, le planificateur (scheduler.ts) l'épingle à son modèle, le registre
// Genome (shared/registre-genome.ts) replie les comparaisons du journal.
//
// ─── DÉCISION PRODUIT, ÉCRITE ICI POUR QU'ON NE LA PERDE PAS ─────────────────
//
// Les comparaisons NE CHANGENT PAS les poids de l'Aiguillage — ni sa
// récompense, ni ses élections en vol, ni les phéromones, ni l'apprentissage
// des Garde-Fous. Une ombre n'entre dans aucun de ces signaux (scheduler.ts,
// store.ts : chaque exclusion y est nommée). Faire entrer ces faits dans le
// routing demande une pondération entre « un verdict de contre-visite » et
// « une comparaison de tests », que personne n'a encore choisie : c'est la
// décision que le README range dans « Reste à prouver ». Tant qu'elle n'est
// pas prise, le banc MESURE et le registre MONTRE ; rien d'autre ne bouge.
//
// MODULE PUR — famille d'aiguillage.ts, balance.ts, garde-fou.ts. Aucune I/O,
// aucune horloge, aucun aléa : l'échantillonnage est un hachage de
// l'identifiant de la tâche (ce dépôt interdit `Math.random`), donc la même
// tâche est toujours dans l'échantillon, ou toujours hors de lui.

import { classer } from './aiguillage.js';
import type { Antecedent, Categorie } from './aiguillage.js';
import type { ValidationState } from '../shared/validations-bac.js';

// ─── Le consentement du projet ────────────────────────────────────────────────

/**
 * Ce qu'un humain pose sur un projet — et rien d'autre. Éteint tant qu'aucune
 * ligne n'existe (`banc_ombre`, store.ts) : le banc coûte de vrais appels de
 * modèle, il ne s'allume jamais tout seul.
 */
export interface ReglageBancOmbre {
  actif: boolean;
  /**
   * Part des tâches échantillonnées, en POUR MILLE. Un entier : un taux en
   * virgule flottante se relirait `0.05000000000000001` et se comparerait mal.
   */
  tauxPourMille: number;
  /** Ombres lancées au plus par fenêtre glissante de 24 h. */
  executionsParJour: number;
  /** Coût DÉCLARÉ par les CLI au-delà duquel le banc s'arrête, par 24 h glissantes. */
  plafondCoutUsd: number;
}

/** 5 % : assez pour mesurer en quelques jours, assez peu pour rester un sondage. */
export const TAUX_DEFAUT_POUR_MILLE = 50;

/**
 * Ce que l'écran PROPOSE quand on allume le banc — jamais appliqué sans le
 * geste : la route exige le budget explicitement (seul le taux a un défaut).
 * Trois ombres et un dollar déclaré par jour : de quoi voir venir un modèle
 * en une semaine sans qu'une nuit de banc coûte plus qu'une tâche ordinaire.
 */
export const REGLAGE_PROPOSE: Omit<ReglageBancOmbre, 'actif'> = {
  tauxPourMille: TAUX_DEFAUT_POUR_MILLE,
  executionsParJour: 3,
  plafondCoutUsd: 1,
};

/**
 * Les bornes que le schéma de la route applique. Ici, à côté de la politique,
 * pour que l'écran et le serveur ne divergent pas sur ce qu'on peut régler.
 */
export const BORNES_REGLAGE = {
  tauxPourMille: { min: 1, max: 1000 },
  executionsParJour: { min: 1, max: 50 },
  /** Strictement positif : un plafond nul serait un banc éteint déguisé. */
  plafondCoutUsd: { max: 1000 },
} as const;

/** La fenêtre du budget : 24 h GLISSANTES, pas un jour civil — pas de fuseau à deviner. */
export const FENETRE_BUDGET_MS = 24 * 60 * 60_000;

/**
 * Une seule ombre en vol par projet.
 *
 * Le coût d'une exécution n'est connu qu'APRÈS elle : trois tâches admises à
 * la suite lanceraient trois ombres avant que la première ait déclaré ce
 * qu'elle a coûté, et le plafond serait franchi de deux exécutions sans avoir
 * rien pu arrêter. « En vol » couvre l'ombre ET ses relectures
 * (`HiveStore.usageBancOmbre`) : elles partent quand l'ombre est rendue, et
 * leur coût s'ajoute au sien à leur retour — une ombre rendue mais encore
 * relue n'a pas fini de dépenser. Le dépassement du plafond est ainsi borné
 * à UNE ombre et ses relectures, jamais à la suivante.
 */
export const OMBRES_EN_VOL_MAX = 1;

/**
 * « Petite » tâche, mesurée sur la production ORIGINALE — le seul fait qui
 * existe avant de lancer l'ombre. Au-delà, rejouer coûte cher et compare mal :
 * deux grandes productions diffèrent sur tant de points que les tests ne
 * disent plus lequel a fait la tâche.
 */
export const BORNES_PETITE_TACHE = {
  promptMax: 4_000,
  lignesMax: 200,
  fichiersMax: 5,
  dureeMaxMs: 15 * 60_000,
} as const;

// ─── L'échantillon ────────────────────────────────────────────────────────────

/**
 * La tâche est-elle dans l'échantillon ? FNV-1a 32 bits de l'identifiant,
 * ramené dans [0, 1000).
 *
 * Déterministe à dessein : le même identifiant rend toujours la même réponse,
 * donc une tâche relue après un redémarrage n'est pas retirée au sort une
 * seconde fois, et un banc peut prouver le taux sans tirer de hasard.
 */
export function echantillonnee(taskId: string, tauxPourMille: number): boolean {
  let h = 0x811c9dc5;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 1000 < tauxPourMille;
}

// ─── L'admission ──────────────────────────────────────────────────────────────

/**
 * Pourquoi une tâche ÉCHANTILLONNÉE n'est pas rejouée. Journalisé
 * (`shadow_bench_skipped`) : une tâche tirée au sort puis laissée sans ombre
 * sans un mot se confondrait avec un banc éteint.
 */
export const MOTIFS_REFUS_OMBRE = [
  /** La production originale n'a pas de verdict de tests du bac : rien ne départagerait. */
  'non_testable',
  /** Prompt, diff, fichiers ou durée au-delà de `BORNES_PETITE_TACHE`. */
  'trop_grande',
  /** Le texte demande un geste externe ou irréversible (voir `MOTIFS_ACTION_EXTERNE`). */
  'action_externe',
  /** Une tâche déléguée, ou qui a délégué : son travail ne tient pas dans une seule production. */
  'delegation',
  /** Aucun modèle commandé à l'originale : on ne saurait pas QUI comparer. */
  'modele_inconnu',
  /** Une autre ombre du projet est encore en vol (`OMBRES_EN_VOL_MAX`). */
  'ombre_en_vol',
  /** `executionsParJour` atteint sur les 24 dernières heures. */
  'budget_executions',
  /** Coût déclaré des 24 dernières heures au plafond. */
  'budget_cout',
  /** Aucun AUTRE modèle n'est offert par une ouvrière en ligne. */
  'aucun_second_modele',
  /**
   * Un autre modèle est offert, mais seulement par des ouvrières SANS bac
   * isolé (`bacIsole`). Dit à part : « installez bubblewrap ou un moteur de
   * conteneurs » n'est pas la même réponse que « branchez un autre modèle ».
   */
  'aucun_bac_isole',
] as const;
export type MotifRefusOmbre = (typeof MOTIFS_REFUS_OMBRE)[number];

/**
 * Les tournures qui trahissent un geste EXTERNE ou IRRÉVERSIBLE : livrer,
 * pousser, ouvrir une PR, publier, écrire chez un tiers (un connecteur, une
 * API en écriture, un stockage distant), toucher la production.
 *
 * Rejouer une telle tâche, c'est risquer de faire le geste DEUX fois — l'ombre
 * ne livre rien, mais son agent tourne avec les outils de son nœud. Le filtre
 * est volontairement LARGE : un faux positif retire une tâche de
 * l'échantillon (on mesure un peu moins), un faux négatif ferait refaire un
 * geste qu'on ne défait pas. L'asymétrie décide.
 *
 * Des EXPRESSIONS, pas des sous-chaînes nues : la première version cherchait
 * `'push '` avec son espace, et « commit and push » en fin de titre — suivi
 * du `\n` qui le sépare du prompt — passait. `\b` borne les mots anglais
 * courts (`pr`, `gh`, `curl`) sans attraper leurs voisins : `prompt` n'est
 * pas une PR. Le texte est déjà en minuscules : `-X POST` se lit `-x post`.
 *
 * Deux mots manquent à dessein, NUS : « notion » et « production » sont du
 * français courant (« ajoute la notion de priorité », « la production de
 * l'agent »), et les retirer tous deux vidait l'échantillon d'un projet
 * francophone. On garde leurs tournures qui ne trompent pas (`en production`).
 *
 * Ce filtre est la PREMIÈRE barrière, pas la seule : une ombre ne part que
 * dans un bac isolé (`bacIsole`), où ni le HOME ni les identifiants git/gh de
 * l'hôte ne sont montés.
 */
export const MOTIFS_ACTION_EXTERNE: readonly RegExp[] = [
  // Livrer, publier, pousser, fusionner.
  /deploy|d[ée]ploi|d[ée]ploy/,
  /publish|publie/,
  /\bpush|pousse/,
  /merge|fusionne/,
  /release/,
  // Une PR ou une issue, par ses mots ou par `gh`.
  /pull request|merge request|\bprs?\b/,
  /\bgh\s+(pr|issue|release|repo|api|gist|workflow|secret)\b/,
  /(cr[ée]er?|ouvr(e|ir)|open|create|file)\s+(une\s+|an?\s+|the\s+)?(nouvelle\s+|new\s+)?(issue|ticket)/,
  /comment(e|er)?\s+(on|sur)\s+(the\s+|l['’]\s*)?(issue|ticket)/,
  /\bgit\s+tag\b/,
  // Une API tierce en ÉCRITURE, un stockage ou une infrastructure distants.
  /\bcurl\b[^\n]*(-x\s*(post|put|patch|delete)|--data|--form|--upload|\s-[dft]\s)/,
  /\bwget\b[^\n]*--post/,
  /upload|t[ée]l[ée]vers/,
  /\b(kubectl|helm)\s+(apply|create|delete|install|upgrade|rollout|scale)\b/,
  /\bterraform\s+(apply|destroy|import)\b/,
  /\b(aws|gcloud|gsutil|az)\s+[a-z]/,
  /\b(ssh|scp|rsync|sftp)\b/,
  // Les connecteurs et les messages envoyés à quelqu'un.
  /webhook|slack|discord|jira|stripe|paiement|payment|tweet|\bsms\b/,
  /e-?mail|courriel|envoie un|envoyer un|send an?\b/,
  // La production, et les gestes qu'on ne défait pas.
  /en production|in production|to production|\b(en|in|to) prod\b/,
  /drop (table|database)|rm -rf/,
];

/** La première tournure d'action externe reconnue dans le texte, ou `null`. */
export function actionExterne(texte: string): string | null {
  const bas = texte.toLowerCase();
  for (const motif of MOTIFS_ACTION_EXTERNE) {
    const trouve = motif.exec(bas);
    if (trouve) return trouve[0];
  }
  return null;
}

/**
 * L'ouvrière porte-t-elle un VRAI bac à sable ? Seul le niveau `conteneur`
 * en est un (node-client/isolement.ts) : `processus` est le nom honnête d'un
 * dossier et d'un environnement épurés, qui laisse l'agent lire le HOME —
 * clés SSH, identifiants `gh` et `git` compris.
 *
 * Une ombre ne part QUE là. Le filtre de texte (`actionExterne`) écarte ce
 * qui DEMANDE un geste externe ; le bac borne ce qu'un agent pourrait faire
 * sans qu'on le lui demande : sans les identifiants de l'hôte, une poussée
 * ou une PR refaite par l'ombre échoue au lieu de partir. L'isolement est
 * DÉCLARÉ par le nœud (shared/types.ts) : cette exigence RESTREINT où une
 * ombre peut aller, elle n'accorde rien à qui se déclare isolé — un nœud qui
 * ment n'expose que sa propre machine.
 */
export function bacIsole(n: { isolement?: { niveau: string } | undefined }): boolean {
  return n.isolement?.niveau === 'conteneur';
}

/** Ce que le banc a déjà dépensé pour un projet, sur la fenêtre du budget. */
export interface UsageBancOmbre {
  /** Ombres lancées dans la fenêtre. */
  executions: number;
  /** Ombres encore en vol (toutes, fenêtre ou pas). */
  enVol: number;
  /** Somme des coûts DÉCLARÉS par les CLI (l'ombre et ses relectures). */
  coutDeclareUsd: number;
  /**
   * Exécutions qui n'ont RIEN déclaré de leur coût (Codex ne déclare que ses
   * jetons). Comptées et montrées, jamais estimées : le plafond de coût ne les
   * voit pas, et c'est `executionsParJour` qui les borne.
   */
  executionsMuettes: number;
}

/**
 * Le budget arrête-t-il le banc pour ce projet ? `null` : il reste de quoi
 * lancer une ombre. L'ordre dit la cause la plus immédiate d'abord.
 */
export function arretBudget(
  reglage: Pick<ReglageBancOmbre, 'executionsParJour' | 'plafondCoutUsd'>,
  usage: UsageBancOmbre,
): Extract<MotifRefusOmbre, 'ombre_en_vol' | 'budget_executions' | 'budget_cout'> | null {
  if (usage.enVol >= OMBRES_EN_VOL_MAX) return 'ombre_en_vol';
  if (usage.executions >= reglage.executionsParJour) return 'budget_executions';
  if (usage.coutDeclareUsd >= reglage.plafondCoutUsd) return 'budget_cout';
  return null;
}

/** Les faits de la production ORIGINALE (sa première) et de la ruche, à l'instant de décider. */
export interface FaitsAdmission {
  titre: string;
  prompt: string;
  categorie: Categorie;
  /** État `tests` des validations de CETTE production ; `null` sans validation rangée. */
  tests: ValidationState | null;
  lignesModifiees: number;
  fichiersTouches: number;
  dureeMs: number;
  /** Tâche enfant d'une délégation, ou qui a elle-même délégué. */
  delegation: boolean;
  /** Le modèle COMMANDÉ à cette production par l'Aiguillage ; `null` sans élection. */
  modeleOriginal: string | null;
  reglage: ReglageBancOmbre;
  usage: UsageBancOmbre;
  /**
   * Modèles déclarés par les ouvrières en ligne autorisées à produire ET
   * isolées (`bacIsole`) — les seules où une ombre peut partir (doublons admis).
   */
  modelesOfferts: readonly string[];
  /** Modèles offerts par les AUTRES ouvrières en ligne, sans bac : pour dire pourquoi, jamais pour lancer. */
  modelesHorsBac: readonly string[];
  /** Les antécédents de l'Aiguillage — pour CHOISIR le second modèle, jamais pour les modifier. */
  antecedents: Map<string, Antecedent>;
}

export type AdmissionOmbre =
  | { admise: true; modeleOriginal: string; modeleOmbre: string }
  | { admise: false; motif: MotifRefusOmbre };

/**
 * Le second modèle : le mieux classé par l'Aiguillage parmi ceux qu'une
 * ouvrière en ligne offre, SAUF celui qui a produit l'originale.
 *
 * Emprunter le classement d'UCB n'est pas un raccourci : un modèle jamais
 * essayé sur ce genre y vaut `+∞`, donc le banc essaie d'abord les modèles
 * qu'on ne connaît pas — exactement l'exploration qui manque à l'Aiguillage.
 * Le classement est LU, jamais écrit : le choix de l'ombre ne pose aucune
 * élection (voir l'en-tête).
 */
export function choisirModeleOmbre(
  categorie: Categorie,
  modeleOriginal: string,
  modelesOfferts: readonly string[],
  antecedents: Map<string, Antecedent>,
): string | null {
  const autres = [...new Set(modelesOfferts)].filter((m) => m !== modeleOriginal);
  return classer(categorie, autres, antecedents)[0]?.modele ?? null;
}

/**
 * LA décision d'admission, pour une tâche déjà échantillonnée d'un projet
 * dont le banc est actif (l'appelant vérifie les deux avant de rassembler les
 * faits : 95 % des tâches n'en paient pas la lecture).
 *
 * L'ordre des refus va du plus STRUCTUREL au plus conjoncturel : une tâche
 * non testable le restera, un budget épuisé se reconstitue — le motif
 * journalisé dit donc ce qui empêcherait encore le banc demain.
 */
export function jugerAdmissionOmbre(f: FaitsAdmission): AdmissionOmbre {
  const refus = (motif: MotifRefusOmbre): AdmissionOmbre => ({ admise: false, motif });
  // Les TESTS décident de la comparaison : sans verdict de tests sur
  // l'originale, les deux côtés ne pourraient être départagés que par
  // l'opinion d'un modèle — ce que le banc s'interdit.
  if (f.tests !== 'passed' && f.tests !== 'failed') return refus('non_testable');
  const b = BORNES_PETITE_TACHE;
  if (
    f.prompt.length > b.promptMax ||
    f.lignesModifiees > b.lignesMax ||
    f.fichiersTouches > b.fichiersMax ||
    f.dureeMs > b.dureeMaxMs
  ) {
    return refus('trop_grande');
  }
  if (actionExterne(`${f.titre}\n${f.prompt}`) !== null) return refus('action_externe');
  if (f.delegation) return refus('delegation');
  if (f.modeleOriginal === null) return refus('modele_inconnu');
  const arret = arretBudget(f.reglage, f.usage);
  if (arret) return refus(arret);
  const modeleOmbre = choisirModeleOmbre(
    f.categorie,
    f.modeleOriginal,
    f.modelesOfferts,
    f.antecedents,
  );
  if (modeleOmbre !== null) return { admise: true, modeleOriginal: f.modeleOriginal, modeleOmbre };
  const horsBac = choisirModeleOmbre(
    f.categorie,
    f.modeleOriginal,
    [...f.modelesOfferts, ...f.modelesHorsBac],
    f.antecedents,
  );
  return refus(horsBac === null ? 'aucun_second_modele' : 'aucun_bac_isole');
}

// ─── La comparaison ───────────────────────────────────────────────────────────

/**
 * Ce qu'a donné un côté, du pire au meilleur :
 *
 *   · `echec`        — la production a échoué (agent en échec, production
 *                      creuse refusée) : rien à tester ;
 *   · `tests_rouges` — les tests déclarés par le projet ont échoué ;
 *   · `tests_verts`  — ils sont passés ;
 *   · `sans_preuve`  — la production existe, mais aucun verdict de tests
 *                      (pas de bac, délai, déclaration réécrite…) : ce côté
 *                      ne se classe pas.
 */
export type IssueCote = 'echec' | 'tests_rouges' | 'tests_verts' | 'sans_preuve';

export function issueDeCote(succes: boolean, tests: ValidationState | null): IssueCote {
  if (!succes) return 'echec';
  if (tests === 'passed') return 'tests_verts';
  if (tests === 'failed') return 'tests_rouges';
  return 'sans_preuve';
}

/** L'avis de la contre-revue sur CE côté : une objection suffit à le dire contesté. */
export type RevueCote = 'validee' | 'contestee' | 'absente';

export interface CoteComparee {
  modele: string;
  issue: IssueCote;
  revue: RevueCote;
  /** Le commit de base sur lequel les tests ont tourné ; `null` s'il n'est pas connu. */
  baseSha: string | null;
}

export type VerdictOmbre = 'ombre_meilleure' | 'originale_meilleure' | 'egalite' | 'indecis';
export type ConfianceOmbre = 'haute' | 'moyenne' | 'faible';

const RANG: Record<Exclude<IssueCote, 'sans_preuve'>, number> = {
  echec: 0,
  tests_rouges: 1,
  tests_verts: 2,
};

/**
 * Le verdict — rendu par les TESTS seuls — et la confiance qu'on peut lui
 * accorder.
 *
 * Deux productions vertes font une ÉGALITÉ, même si une relectrice a préféré
 * l'une : départager au goût d'un modèle, c'est la « préférence de modèle »
 * que le banc exclut. La contre-revue sert ailleurs — à la CONFIANCE : des
 * tests verts sur un diff qui ne fait rien restent verts, et c'est l'avis
 * indépendant qui dit que chaque production a réellement fait la tâche.
 *
 *   · `faible`  — un côté ne se classe pas (`indecis`), ou a échoué avant
 *                 tout test : un délai, un plantage d'agent disent peu du code ;
 *                 ou les deux ont tourné sur des commits de base CONNUS et
 *                 DIFFÉRENTS (`indecis`) : l'ombre clone la branche du jour, et
 *                 si l'originale — ou sa reprise — a été fusionnée entre-temps,
 *                 elle trouve la solution déjà écrite et passe ses tests sans
 *                 rien faire. Les tests ne comparent que sur la même base ;
 *                 ou une relectrice CONTESTE un côté : elle dit que cette
 *                 production n'a pas fait la tâche, et ses tests — verts sur
 *                 un diff qui ne fait rien — ne prouvent alors plus rien. Le
 *                 verdict reste celui des tests ; c'est sa confiance qui tombe ;
 *   · `haute`   — les deux côtés ont un verdict de tests sur le MÊME commit de
 *                 base connu, et chacun a été VALIDÉ par une relectrice — un
 *                 avis rendu ne suffit pas, c'est ce qu'il dit qui compte ;
 *   · `moyenne` — le reste : des tests comparables, mais une base inconnue
 *                 d'un côté, ou une relecture qui manque encore.
 */
export function comparerOmbre(
  original: CoteComparee,
  ombre: CoteComparee,
): { verdict: VerdictOmbre; confiance: ConfianceOmbre } {
  if (original.issue === 'sans_preuve' || ombre.issue === 'sans_preuve') {
    return { verdict: 'indecis', confiance: 'faible' };
  }
  const ecart = RANG[ombre.issue] - RANG[original.issue];
  const verdict: VerdictOmbre =
    ecart > 0 ? 'ombre_meilleure' : ecart < 0 ? 'originale_meilleure' : 'egalite';
  if (original.issue === 'echec' || ombre.issue === 'echec')
    return { verdict, confiance: 'faible' };
  const basesConnues = original.baseSha !== null && ombre.baseSha !== null;
  if (basesConnues && original.baseSha !== ombre.baseSha) {
    return { verdict: 'indecis', confiance: 'faible' };
  }
  if (original.revue === 'contestee' || ombre.revue === 'contestee') {
    return { verdict, confiance: 'faible' };
  }
  const memeBase = basesConnues && original.baseSha === ombre.baseSha;
  const validees = original.revue === 'validee' && ombre.revue === 'validee';
  return { verdict, confiance: memeBase && validees ? 'haute' : 'moyenne' };
}
