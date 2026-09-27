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
// Il tient une MÉMOIRE : pour chaque couple (genre de tâche × modèle), combien
// de fois ce modèle a servi sur ce genre, et quelle NOTE il y a récoltée. La
// note ne vient pas d'un succès/échec binaire mais du verdict de CONTRE-VISITE
// du Polyéthisme (`appliquer` / `améliorer` / `refaire`) — une note de QUALITÉ,
// donc, pas seulement « ça compile ».
//
// À partir de cette mémoire, il CHOISIT — et c'est là que se joue « garder le
// meilleur SANS se figer ». Un choix purement glouton (« toujours le meilleur
// jusqu'ici ») se verrouille sur le premier modèle qui a eu de la chance, et
// n'essaie jamais celui qui aurait fait mieux. La règle est donc celle des
// bandits manchots — UCB1 : on prend le meilleur score, mais un modèle PEU
// ESSAYÉ reçoit un bonus qui décroît à mesure qu'on le connaît. Résultat : tout
// modèle neuf est essayé au moins une fois, les prometteurs sont ré-essayés,
// et un mauvais confirmé est délaissé.
//
// Ce module NE CHOISIT PAS le nœud, NE lance rien, N'écrit nulle part : il
// répond à « quel modèle, pour ce genre-là ? » à partir d'antécédents qu'on lui
// donne. Le câblage — déclarer les modèles d'un nœud, porter le modèle choisi
// dans l'assignation, enregistrer le verdict — est un lot séparé.
//
// MODULE PUR — famille de balance.ts, acces.ts, polyethisme.ts, conseil.ts.
// Aucune I/O, aucune horloge, et SURTOUT aucun aléa : UCB est déterministe, ce
// qui est à la fois une nécessité (ce dépôt interdit `Math.random`) et une
// vertu (deux ruches avec le même vécu font le même choix, et le choix
// s'éprouve sans tirer au sort).

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
 */
export const VERSION_AIGUILLAGE = 2;

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

// ─── Les antécédents ──────────────────────────────────────────────────────────

/** Une observation : ce modèle, sur ce genre, a récolté ce verdict. */
export interface Observation {
  categorie: Categorie;
  modele: string;
  suite: Suite;
}

/** Le vécu accumulé d'un couple (genre × modèle). */
export interface Antecedent {
  /** Combien de fois ce modèle a servi sur ce genre — élections en vol comprises. */
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
}

/**
 * Combien d'observations récentes on garde. Au-delà, les plus vieilles sont
 * OUBLIÉES — un modèle s'améliore (ou se dégrade), et une ruche qui traînerait
 * mille verdicts d'il y a six mois jugerait un modèle sur ce qu'il n'est plus.
 * L'oubli est lent (le corpus est grand), mais il existe.
 */
export const CORPUS_AIGUILLAGE = 300;

/** La clé d'un couple dans la mémoire. `|` ne peut pas apparaître dans un genre. */
export function cle(categorie: Categorie, modele: string): string {
  return `${categorie}|${modele}`;
}

/**
 * Replie une liste d'observations en mémoire (genre × modèle) → antécédent.
 *
 * Seules les `CORPUS_AIGUILLAGE` DERNIÈRES comptent : les observations arrivent
 * dans l'ordre du temps, et l'on garde la queue. C'est ici, et nulle part
 * ailleurs, que se fait l'oubli.
 */
export function replierAntecedents(observations: readonly Observation[]): Map<string, Antecedent> {
  const recentes = observations.slice(-CORPUS_AIGUILLAGE);
  const memoire = new Map<string, Antecedent>();
  for (const o of recentes) {
    const k = cle(o.categorie, o.modele);
    const a = memoire.get(k) ?? { essais: 0, recompenseTotale: 0 };
    a.essais += 1;
    a.recompenseTotale += recompenseDe(o.suite);
    memoire.set(k, a);
  }
  return memoire;
}

/** La note moyenne d'un antécédent, ou 0 s'il n'a jamais servi. */
export function moyenne(a: Antecedent): number {
  return a.essais > 0 ? a.recompenseTotale / a.essais : 0;
}

/**
 * Compte les élections EN VOL comme des essais SANS note, DANS les antécédents.
 *
 * ─── POURQUOI CETTE INJECTION EXISTE ─────────────────────────────────────────
 *
 * `scoreUCB` rend `+∞` pour un modèle jamais essayé, et cet infini tient jusqu'au
 * premier VERDICT — pas jusqu'au premier LANCEMENT. Un modèle neuf resterait donc
 * à `+∞` le temps que les contre-visites reviennent (des minutes), et pendant ce
 * temps il raflerait toutes les tâches prêtes de son genre : le TROUPEAU.
 *
 * En ajoutant un `essai` (à récompense NULLE) par élection en vol, on éteint
 * l'infini dès le premier lancement : `essais` passe à > 0, `scoreUCB` devient
 * fini, et la moyenne est TEMPORAIREMENT pessimiste (0) puis se corrige quand les
 * vrais verdicts tombent. Tout reste déterministe — les ex æquo restent
 * départagés par le nom, comme avant.
 *
 * Mute la carte EN PLACE (elle vient d'être bâtie par `replierAntecedents`, on ne
 * la partage pas). Une élection en vol dont on connaît DÉJÀ un verdict passé
 * n'écrase rien : elle s'ajoute, alourdissant `essais` sans toucher la note — ce
 * qui pèse un peu plus pessimiste tant que la production en cours n'a pas rendu.
 *
 * Chaque essai injecté est AUSSI compté dans `enVol` : le score doit le voir,
 * l'explication doit le distinguer. Sans ce second compte, `classer` rendrait
 * « 1 essai, moyenne 0 » pour un modèle qui n'a jamais été jugé — un modèle
 * « à explorer » affiché comme un modèle mauvais.
 */
export function injecterEnVol(
  antecedents: Map<string, Antecedent>,
  enVol: readonly { categorie: Categorie; modele: string }[],
): void {
  for (const e of enVol) {
    const k = cle(e.categorie, e.modele);
    const a = antecedents.get(k) ?? { essais: 0, recompenseTotale: 0 };
    a.essais += 1;
    a.enVol = (a.enVol ?? 0) + 1;
    antecedents.set(k, a);
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
  suite: Suite;
}

/** Une élection en vol relue du store : tâche active, modèle commandé, pas de verdict. */
export interface ElectionEnVol {
  title: string;
  prompt: string;
  modele: string;
}

/**
 * LES antécédents de l'Aiguillage, depuis ce que le store relit : les verdicts
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
): Map<string, Antecedent> {
  const antecedents = replierAntecedents(
    verdicts.map((v) => ({
      categorie: categoriser(v.title, v.prompt),
      modele: v.modeleExact ?? v.modele,
      suite: v.suite,
    })),
  );
  injecterEnVol(
    antecedents,
    enVol.map((e) => ({ categorie: categoriser(e.title, e.prompt), modele: e.modele })),
  );
  return antecedents;
}

// ─── Le choix : exploiter le meilleur, explorer le reste ──────────────────────

/**
 * La constante d'exploration d'UCB1. `√2` est la valeur classique : plus elle
 * est grande, plus la ruche insiste à ré-essayer les modèles peu connus ; plus
 * elle est petite, plus elle se fie vite à la moyenne. `√2` équilibre les deux
 * et n'a aucune raison d'être touché sans mesure à l'appui.
 */
export const C_EXPLORATION = Math.SQRT2;

/**
 * Le score UCB d'un modèle sur un genre : sa moyenne, plus un bonus d'autant
 * plus gros qu'il a été PEU essayé au regard de l'ensemble.
 *
 * Un modèle JAMAIS essayé sur ce genre vaut `+∞` : il DOIT être tenté avant
 * qu'on prétende le connaître. C'est la différence entre « mauvais » et
 * « inconnu », que le Polyéthisme fait déjà pour les nœuds (§ 2 de sa
 * doctrine) et que l'on refait ici pour les modèles.
 */
export function scoreUCB(a: Antecedent, totalGenre: number): number {
  if (a.essais === 0) return Number.POSITIVE_INFINITY;
  return moyenne(a) + C_EXPLORATION * Math.sqrt(Math.log(Math.max(totalGenre, 1)) / a.essais);
}

/**
 * Ce qu'on rend pour la transparence : le score de chaque modèle, expliqué.
 *
 * `essais` et `moyenne` ne parlent QUE des verdicts reçus ; `enVol` compte à
 * part les élections lancées et pas encore jugées. Le `score`, lui, compte les
 * deux (une élection en vol y pèse comme un essai à note nulle, cf.
 * `injecterEnVol`) : c'est lui qui décide, les trois autres l'expliquent.
 */
export interface Rang {
  modele: string;
  /** Verdicts reçus. 0 : jamais jugé sur ce genre — « à explorer », pas « mauvais ». */
  essais: number;
  /** Élections en vol, sans verdict encore. */
  enVol: number;
  /** Moyenne des seuls verdicts reçus ; 0 sans verdict (jamais `NaN`). */
  moyenne: number;
  score: number;
}

/**
 * Classe les modèles disponibles pour un genre, du plus au moins recommandé.
 *
 * Sert autant à CHOISIR (le premier est le choix) qu'à MONTRER pourquoi — un
 * tableau de bord qui affiche « Opus 5 : 0.82 sur 14 essais / Fable 5 : 0.71
 * sur 9 » rend la décision lisible, et une décision qu'on ne peut pas relire
 * n'inspire pas confiance.
 *
 * Départage déterministe et INDÉPENDANT de l'ordre d'entrée : score décroissant,
 * puis nom croissant. Sans le second critère, deux modèles à `+∞` (jamais
 * essayés) seraient départagés par le hasard de l'ordre du tableau — et le
 * choix cesserait d'être reproductible.
 */
export function classer(
  categorie: Categorie,
  modelesDispo: readonly string[],
  antecedents: Map<string, Antecedent>,
): Rang[] {
  const totalGenre = modelesDispo.reduce(
    (n, m) => n + (antecedents.get(cle(categorie, m))?.essais ?? 0),
    0,
  );
  return modelesDispo
    .map((modele) => {
      const a = antecedents.get(cle(categorie, modele)) ?? { essais: 0, recompenseTotale: 0 };
      const enVol = a.enVol ?? 0;
      // Les élections en vol n'ont récolté aucune note : les retirer d'`essais`
      // rend la moyenne des VERDICTS, là où `moyenne(a)` la diluerait de zéros
      // qui n'ont jamais été prononcés.
      const juges = { essais: a.essais - enVol, recompenseTotale: a.recompenseTotale };
      return {
        modele,
        essais: juges.essais,
        enVol,
        moyenne: moyenne(juges),
        score: scoreUCB(a, totalGenre),
      };
    })
    .sort((x, y) => (y.score !== x.score ? y.score - x.score : x.modele.localeCompare(y.modele)));
}

/**
 * LE choix : quel modèle pour ce genre, parmi ceux que le nœud sait faire
 * tourner ? `null` si la liste est vide — l'appelant retombe alors sur son
 * comportement d'avant (le nœud choisit lui-même), plutôt que sur un modèle
 * inventé.
 */
export function choisirModele(
  categorie: Categorie,
  modelesDispo: readonly string[],
  antecedents: Map<string, Antecedent>,
): string | null {
  if (modelesDispo.length === 0) return null;
  return classer(categorie, modelesDispo, antecedents)[0]?.modele ?? null;
}

// ─── Du modèle élu aux nœuds qui savent le faire tourner ──────────────────────
//
// Le Scheduler ne choisit pas un modèle dans le vide : les modèles sont
// PARTITIONNÉS par nœud (un nœud claude-code ne lance pas Grok). Cette fonction
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

/**
 * Le modèle élu pour ce genre, et les nœuds éligibles qui l'offrent — ou `null`
 * si AUCUN éligible ne déclare de modèle. Le `null` est le NO-OP : l'appelant
 * garde alors exactement son ordonnancement d'avant, sans rien restreindre ni
 * enregistrer. `eligibles` est supposé déjà filtré ET trié par l'appelant ; la
 * sous-liste rendue préserve cet ordre.
 *
 * `echoues` : les modèles qui ont déjà échoué sur CETTE tâche (plantage, délai,
 * erreur du CLI — cf. `Scheduler.modelesEchoues`). Ils sont retirés du concours
 * tant qu'il reste un autre modèle, et rendus dans `ecartes` pour que la raison
 * le dise. Sans ce retrait, un modèle cassé, jamais jugé donc à `+∞`, était
 * ré-élu à chaque reprise : il brûlait toutes les tentatives de chaque tâche de
 * son genre. Si TOUS ont échoué, ils concourent de nouveau, comme avant : un
 * écart qui laisserait la tâche sans porteur la ferait attendre à jamais — la
 * même famine que l'union sur les seuls éligibles tue déjà. L'échec ne touche
 * JAMAIS aux antécédents : un plantage n'est pas un essai loyal, il n'a rien
 * dit de la qualité du modèle.
 */
export function aiguillerNoeuds<N extends { readonly modeles?: readonly string[] | null }>(
  categorie: Categorie,
  eligibles: readonly N[],
  antecedents: Map<string, Antecedent>,
  echoues: ReadonlySet<string> = new Set(),
): { modele: string; noeuds: N[]; rang: Rang[]; ecartes: string[] } | null {
  // Un `Set` déduplique par CONSTRUCTION : le même modèle offert par deux nœuds
  // ne doit compter qu'une fois pour `classer`, sinon le total du genre est
  // doublé et le bonus d'exploration faussé. Aucun prédicat de dédup à part —
  // c'est la structure qui le tient, pas une ligne qu'on pourrait muter seule.
  const union = new Set<string>();
  for (const n of eligibles) for (const m of n.modeles ?? []) union.add(m);
  const restants = [...union].filter((m) => !echoues.has(m));
  const enLice = restants.length > 0 ? restants : [...union];
  // On CLASSE une seule fois : le premier est l'élu, et le classement entier
  // est la RAISON du choix — celle que Mission Control montrera (« pourquoi ce
  // modèle »). Recalculer un second classement pour l'explication le ferait
  // diverger du choix ; c'est le même `Rang[]` qui décide et qui s'explique.
  // Union vide (aucun éligible ne déclare de modèle) : `rang` est vide, l'élu
  // est `null`, et ce `null` EST le no-op — l'appelant garde son ordonnancement.
  const rang = classer(categorie, enLice, antecedents);
  const modele = rang[0]?.modele ?? null;
  if (modele === null) return null;
  const noeuds = eligibles.filter((n) => (n.modeles ?? []).includes(modele));
  const ecartes = [...union].filter((m) => !enLice.includes(m)).sort();
  return { modele, noeuds, rang, ecartes };
}
