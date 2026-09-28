// Le registre Genome : ce que chaque modèle a RÉELLEMENT fait, par catégorie.
//
// L'Aiguillage apprend d'un seul signal — la suite de contre-visite — et c'est
// voulu : une récompense qui mélangerait tout deviendrait illisible. Mais une
// seule moyenne ne dit pas POURQUOI un modèle réussit ou non. Ce registre
// garde les faits séparés, sans rien noter ni classer :
//
//   · le Worker a-t-il rendu, dû reprendre, échoué, refusé, été interrompu ?
//   · l'Evaluator a-t-il demandé une correction ?
//   · les relectrices ont-elles contesté ou validé ?
//   · un humain a-t-il approuvé ou rejeté la dernière production ?
//   · combien de temps a pris une réussite, côté Worker ?
//   · qu'ont DÉCLARÉ les CLI des agents : coût, temps modèle, modèles exacts,
//     jetons ?
//
// ─── TROIS RÈGLES DE LECTURE ─────────────────────────────────────────────────
//
//   1. L'ABSENCE RESTE ABSENTE. Une affectation sans modèle déclaré n'est pas
//      rangée sous un modèle « par défaut » : elle va dans `sansModele`. Une
//      issue dont l'affectation est sortie de la fenêtre du journal n'est
//      attribuée à personne. Le coût fournisseur, le temps modèle et les
//      jetons ne viennent que de la déclaration du CLI de l'agent, sommés avec
//      leur couverture (tentatives déclarées / tentatives rendues) ; sans
//      aucune déclaration ils valent `'inconnu'` — jamais estimés, et le coût
//      jamais tiré des jetons.
//   2. AUCUN CLASSEMENT. Les lignes sortent triées par nom de modèle puis par
//      catégorie. Classer demanderait une pondération entre ces faits — une
//      décision produit, pas une lecture.
//   3. UN FAIT, UNE ATTRIBUTION. Une issue Worker va à l'affectation en cours
//      sur ce nœud ; une correction, un avis ou une revue humaine vont à la
//      DERNIÈRE production rendue. Un avis qui prouve le modèle exact
//      (`producteurModele`) l'emporte sur le modèle commandé.
//
// UNE COURSE DE DRONES, C'EST UNE AFFECTATION PAR DRONE. `task_assigned` n'y
// nomme que le primaire ; le modèle de chaque drone vient du
// `drone_race_started` qui le précède. Chaque drone rend compte de SON issue,
// une seule fois : la victoire (`task_done`) au modèle du vainqueur — primaire
// ou non —, l'échec d'un drone pendant que d'autres volent (`drone_failed` sans
// motif) en reprise, son refus en refus, sa perte (`drone_failed` motivé) ou
// son annulation après la victoire d'un autre en interruption. Une course
// arrêtée d'un bloc (reprise au boot, annulation humaine) interrompt chaque
// drone encore en vol.
//
// Le module est pur : il replie des événements déjà journalisés. Il ne touche
// ni au routing, ni à la récompense de l'Aiguillage. Le coût déclaré que
// l'Aiguillage pèse (v3) ne passe PAS par ici : il est rangé avec le bras qui
// l'a produit (`aiguillage_bras`), sous la même règle — jamais estimé, jamais
// tiré des jetons, et un coût inconnu n'est pas un zéro.

import type { Categorie } from '../orchestrator/aiguillage.js';
import { declarationDe, sommeDeclaree } from './declaration-fournisseur.js';
import type { SommeDeclaree } from './declaration-fournisseur.js';
import type { HiveEvent } from './types.js';

export const TYPES_REGISTRE_GENOME = [
  'task_assigned',
  'task_done',
  'task_retry',
  'task_failed',
  'task_rejected',
  'task_requeued',
  'task_cancelled',
  'drone_race_started',
  'drone_failed',
  'drone_rejected',
  'drone_cancelled',
  'contre_expertise_verdict',
  'task_reviewed',
] as const;

/** Les faits d'un modèle dans une catégorie — des comptes, jamais une note. */
export interface FaitsGenome {
  /** Affectations reçues (chaque tentative compte). */
  affectations: number;
  /** Le Worker a rendu un résultat accepté par l'ordonnanceur. */
  rendus: number;
  /** Le Worker a échoué et la tâche a continué : relancée, ou course encore en vol. */
  reprises: number;
  /** Le Worker a échoué sur la dernière tentative autorisée. */
  echecs: number;
  /** Le nœud a refusé la tâche avant de l'exécuter. */
  refus: number;
  /** Interrompue sans verdict sur le modèle (nœud perdu, annulation, reprise au boot). */
  interrompues: number;
  /** L'Evaluator a renvoyé la production en correction. */
  corrections: number;
  /** Avis des relectrices croisées sur les productions de ce modèle. */
  avis: { valides: number; contestes: number; modeleProuve: number };
  /** Dernière revue humaine de chaque production. */
  humain: { approuvees: number; rejetees: number };
  /** Médiane des durées Worker des rendus ; `null` sans rendu mesuré. */
  dureeMedianeMs: number | null;
  /** Coût déclaré par le CLI (USD), sur les tentatives rendues — jamais estimé. */
  coutFournisseur: SommeDeclaree | 'inconnu';
  /** Temps passé dans les appels au modèle, déclaré par le CLI. */
  dureeModele: SommeDeclaree | 'inconnu';
  /** Jetons d'entrée déclarés par le CLI, sur les tentatives rendues. */
  jetonsEntree: SommeDeclaree | 'inconnu';
  /** Jetons de sortie déclarés par le CLI, sur les tentatives rendues. */
  jetonsSortie: SommeDeclaree | 'inconnu';
  /** Modèles exacts nommés par le CLI (la version derrière le modèle commandé). */
  modelesExacts: string[];
}

export interface LigneGenome extends FaitsGenome {
  modele: string;
  categorie: Categorie;
}

export interface RegistreGenome {
  lignes: LigneGenome[];
  /** Affectations faites sans modèle déclaré, toutes catégories confondues. */
  sansModele: FaitsGenome;
  /**
   * Fenêtre réellement lue : le journal est borné par sa rétention.
   * `tronquee` : des faits plus anciens ONT PU manquer — la lecture a atteint
   * sa borne, OU le journal a déjà été élagué. Le second cas est le courant :
   * l'élagage garde les derniers événements de TOUS types, et les faits Genome
   * en sortent bien avant que leurs seuls types remplissent la borne. Drapeau
   * CONSERVATEUR : le type des événements élagués est perdu avec eux, donc un
   * élagage qui n'a ôté que des battements de cœur l'allume aussi. L'écran dit
   * « ont pu », jamais « sont » — inconnu reste inconnu.
   */
  fenetre: { evenements: number; depuis: number | null; tronquee: boolean };
}

interface Accumulateur {
  faits: Omit<
    FaitsGenome,
    | 'dureeMedianeMs'
    | 'coutFournisseur'
    | 'dureeModele'
    | 'jetonsEntree'
    | 'jetonsSortie'
    | 'modelesExacts'
  >;
  durees: number[];
  /** Une entrée par tentative rendue ; `null` quand le CLI n'a rien déclaré. */
  couts: (number | null)[];
  dureesModele: (number | null)[];
  jetonsEntree: (number | null)[];
  jetonsSortie: (number | null)[];
  modelesExacts: Set<string>;
}

interface Production {
  modele: string | null;
  categorie: Categorie;
}

interface EtatTache {
  courante: (Production & { nodeId: string | null }) | null;
  /**
   * Course portée par l'affectation en cours : la production de chaque drone
   * dont l'issue n'est pas encore comptée. `null` hors course. Un drone en sort
   * au premier fait qui le concerne — une perte suivie de la remise en file
   * de la tâche ne se compte pas deux fois.
   */
  drones: Map<string, Production> | null;
  /** Drones du dernier `drone_race_started`, pour l'affectation qui le suit. */
  dronesEnAttente: Map<string, Production>;
  derniere: Production | null;
  revue: 'approved' | 'rejected' | null;
}

function vide(): Accumulateur {
  return {
    faits: {
      affectations: 0,
      rendus: 0,
      reprises: 0,
      echecs: 0,
      refus: 0,
      interrompues: 0,
      corrections: 0,
      avis: { valides: 0, contestes: 0, modeleProuve: 0 },
      humain: { approuvees: 0, rejetees: 0 },
    },
    durees: [],
    couts: [],
    dureesModele: [],
    jetonsEntree: [],
    jetonsSortie: [],
    modelesExacts: new Set(),
  };
}

/** Consigne la déclaration d'une tentative rendue (réussie, reprise, échouée). */
function consignerDeclaration(acc: Accumulateur, payload: Record<string, unknown>): void {
  const declaration = declarationDe(payload);
  acc.couts.push(declaration.coutUsd);
  acc.dureesModele.push(declaration.dureeApiMs);
  acc.jetonsEntree.push(declaration.jetonsEntree);
  acc.jetonsSortie.push(declaration.jetonsSortie);
  for (const m of declaration.modeles) acc.modelesExacts.add(m);
}

function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 1
    ? triees[milieu]!
    : Math.round((triees[milieu - 1]! + triees[milieu]!) / 2);
}

function texte(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
}

/** Les drones d'un `drone_race_started`, chacun avec le modèle qui lui a été commandé. */
function dronesDe(p: Record<string, unknown>, categorie: Categorie): Map<string, Production> {
  const modeles =
    typeof p.modeles === 'object' && p.modeles !== null
      ? (p.modeles as Record<string, unknown>)
      : {};
  const drones = new Map<string, Production>();
  for (const brut of Array.isArray(p.drones) ? p.drones : []) {
    const nodeId = texte(brut);
    if (nodeId !== null) drones.set(nodeId, { modele: texte(modeles[nodeId]), categorie });
  }
  return drones;
}

function figer(acc: Accumulateur): FaitsGenome {
  return {
    ...acc.faits,
    avis: { ...acc.faits.avis },
    humain: { ...acc.faits.humain },
    dureeMedianeMs: mediane(acc.durees),
    coutFournisseur: sommeDeclaree(acc.couts),
    dureeModele: sommeDeclaree(acc.dureesModele),
    jetonsEntree: sommeDeclaree(acc.jetonsEntree),
    jetonsSortie: sommeDeclaree(acc.jetonsSortie),
    modelesExacts: [...acc.modelesExacts].sort(),
  };
}

/**
 * Replie le journal en registre. `categorieDe` rend la catégorie d'une tâche
 * encore connue, `null` sinon : un événement d'une tâche disparue est ignoré.
 * `borne` est la limite de lecture appliquée par l'appelant — l'atteindre
 * signale une fenêtre tronquée. `journalElague` dit si le journal a déjà
 * perdu des événements (`HiveStore.journalElague`) : un fait que les
 * événements lus ne peuvent pas révéler, puisque ce sont les absents.
 */
export function registreGenomeDepuisEvenements(
  evenements: readonly HiveEvent[],
  categorieDe: (taskId: string) => Categorie | null,
  borne = Number.POSITIVE_INFINITY,
  journalElague = false,
): RegistreGenome {
  const parCle = new Map<string, { modele: string; categorie: Categorie; acc: Accumulateur }>();
  const sansModele = vide();
  const taches = new Map<string, EtatTache>();

  const accumulateur = (p: Production): Accumulateur => {
    if (p.modele === null) return sansModele;
    const cle = `${p.modele}\u0000${p.categorie}`;
    let ligne = parCle.get(cle);
    if (!ligne) {
      ligne = { modele: p.modele, categorie: p.categorie, acc: vide() };
      parCle.set(cle, ligne);
    }
    return ligne.acc;
  };

  // La revue humaine porte sur une production précise : elle est comptée
  // quand cette production est remplacée, ou à la fin de la lecture.
  const solderRevue = (etat: EtatTache): void => {
    if (etat.derniere && etat.revue) {
      const humain = accumulateur(etat.derniere).faits.humain;
      if (etat.revue === 'approved') humain.approuvees += 1;
      else humain.rejetees += 1;
    }
    etat.revue = null;
  };

  const ordonnes = [...evenements].sort((a, b) => a.id - b.id);
  for (const ev of ordonnes) {
    const p = ev.payload;
    const taskId = texte(p.taskId);
    if (taskId === null) continue;
    const categorie = categorieDe(taskId);
    if (categorie === null) continue;
    const etat: EtatTache = taches.get(taskId) ?? {
      courante: null,
      drones: null,
      dronesEnAttente: new Map(),
      derniere: null,
      revue: null,
    };
    taches.set(taskId, etat);
    const courante = etat.courante;
    const nodeId = texte(p.nodeId);
    // L'affectation dont parle une issue Worker : en course, celle du drone
    // qui la rend, s'il n'a pas déjà rendu compte ; sinon la courante, sur CE
    // nœud seulement.
    const issue: Production | null = etat.drones
      ? ((nodeId === null ? null : etat.drones.get(nodeId)) ?? null)
      : courante !== null && (nodeId === null || nodeId === courante.nodeId)
        ? courante
        : null;
    // Une issue de TÂCHE clôt l'affectation ; le drone qui l'a rendue a compté.
    const solder = (): void => {
      etat.courante = null;
      if (nodeId !== null) etat.drones?.delete(nodeId);
    };

    switch (ev.type) {
      case 'drone_race_started': {
        etat.dronesEnAttente = dronesDe(p, categorie);
        break;
      }
      case 'task_assigned': {
        etat.courante = { modele: texte(p.modele), categorie, nodeId };
        const drones = etat.dronesEnAttente;
        etat.dronesEnAttente = new Map();
        etat.drones = nodeId !== null && drones.has(nodeId) ? drones : null;
        for (const affectee of etat.drones ? etat.drones.values() : [etat.courante]) {
          accumulateur(affectee).faits.affectations += 1;
        }
        break;
      }
      case 'task_done': {
        if (!issue) break;
        const acc = accumulateur(issue);
        acc.faits.rendus += 1;
        const duree = p.durationMs;
        if (typeof duree === 'number' && Number.isFinite(duree) && duree >= 0) {
          acc.durees.push(duree);
        }
        consignerDeclaration(acc, p);
        solderRevue(etat);
        etat.derniere = { modele: issue.modele, categorie: issue.categorie };
        solder();
        break;
      }
      case 'task_retry': {
        if (p.source === 'evaluator') {
          if (etat.derniere) accumulateur(etat.derniere).faits.corrections += 1;
          // La revue humaine est remise à zéro par la correction elle-même.
          etat.revue = null;
          break;
        }
        if (!issue) break;
        accumulateur(issue).faits.reprises += 1;
        consignerDeclaration(accumulateur(issue), p);
        solder();
        break;
      }
      case 'task_failed': {
        if (!issue) break;
        accumulateur(issue).faits.echecs += 1;
        consignerDeclaration(accumulateur(issue), p);
        solder();
        break;
      }
      case 'task_rejected': {
        if (!issue) break;
        accumulateur(issue).faits.refus += 1;
        solder();
        break;
      }
      case 'task_requeued':
      case 'task_cancelled': {
        // En course, ce fait de TÂCHE arrête tous les drones encore en vol,
        // qu'il n'en nomme aucun (reprise au boot) ou le seul primaire
        // (annulation humaine) : chacun est interrompu, une fois. Sans ce
        // solde, les autres gardaient une affectation sans issue.
        if (etat.drones) {
          for (const drone of etat.drones.values()) accumulateur(drone).faits.interrompues += 1;
          etat.drones.clear();
          etat.courante = null;
          break;
        }
        if (!issue) break;
        accumulateur(issue).faits.interrompues += 1;
        solder();
        break;
      }
      // Le sort d'UN drone, la course continuant (ou venant d'être gagnée par
      // un autre) : il ne clôt pas l'affectation de la tâche.
      case 'drone_failed':
      case 'drone_rejected':
      case 'drone_cancelled': {
        if (!issue || !etat.drones || nodeId === null) break;
        const acc = accumulateur(issue);
        if (ev.type === 'drone_rejected') acc.faits.refus += 1;
        else if (ev.type === 'drone_cancelled' || texte(p.reason) !== null) {
          acc.faits.interrompues += 1;
        } else {
          acc.faits.reprises += 1;
          consignerDeclaration(acc, p);
        }
        etat.drones.delete(nodeId);
        break;
      }
      case 'contre_expertise_verdict': {
        if (p.source !== 'hive_counter_review') break;
        const prouve = texte(p.producteurModele);
        const cible: Production | null = prouve ? { modele: prouve, categorie } : etat.derniere;
        if (!cible || typeof p.conteste !== 'boolean') break;
        const avis = accumulateur(cible).faits.avis;
        if (p.conteste) avis.contestes += 1;
        else avis.valides += 1;
        if (prouve) avis.modeleProuve += 1;
        break;
      }
      case 'task_reviewed': {
        if (p.state === 'approved' || p.state === 'rejected') etat.revue = p.state;
        else if (p.state === null) etat.revue = null;
        break;
      }
    }
  }
  for (const etat of taches.values()) solderRevue(etat);

  const lignes: LigneGenome[] = [...parCle.values()]
    .sort((a, b) =>
      a.modele === b.modele
        ? a.categorie.localeCompare(b.categorie)
        : a.modele.localeCompare(b.modele),
    )
    .map(({ modele, categorie, acc }) => ({ modele, categorie, ...figer(acc) }));

  return {
    lignes,
    sansModele: figer(sansModele),
    fenetre: {
      evenements: evenements.length,
      depuis: ordonnes[0]?.ts ?? null,
      tronquee: journalElague || evenements.length >= borne,
    },
  };
}
