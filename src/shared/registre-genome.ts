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
//
// ─── TROIS RÈGLES DE LECTURE ─────────────────────────────────────────────────
//
//   1. L'ABSENCE RESTE ABSENTE. Une affectation sans modèle déclaré n'est pas
//      rangée sous un modèle « par défaut » : elle va dans `sansModele`. Une
//      issue dont l'affectation est sortie de la fenêtre du journal n'est
//      attribuée à personne. Le coût fournisseur n'est jamais estimé : aucun
//      fournisseur ne le transmet aujourd'hui, il vaut `'inconnu'`.
//   2. AUCUN CLASSEMENT. Les lignes sortent triées par nom de modèle puis par
//      catégorie. Classer demanderait une pondération entre ces faits — une
//      décision produit, pas une lecture.
//   3. UN FAIT, UNE ATTRIBUTION. Une issue Worker va à l'affectation en cours
//      sur ce nœud ; une correction, un avis ou une revue humaine vont à la
//      DERNIÈRE production rendue. Un avis qui prouve le modèle exact
//      (`producteurModele`) l'emporte sur le modèle commandé.
//
// LIMITE CONNUE : dans une course de drones, `task_assigned` ne porte que le
// modèle du primaire. Une victoire d'un autre drone n'est donc attribuée à
// aucun modèle — mieux vaut un rendu manquant qu'un rendu mal rangé.
//
// Le module est pur : il replie des événements déjà journalisés. Il ne touche
// ni au routing, ni à la récompense de l'Aiguillage.

import type { Categorie } from '../orchestrator/aiguillage.js';
import type { HiveEvent } from './types.js';

export const TYPES_REGISTRE_GENOME = [
  'task_assigned',
  'task_done',
  'task_retry',
  'task_failed',
  'task_rejected',
  'task_requeued',
  'task_cancelled',
  'contre_expertise_verdict',
  'task_reviewed',
] as const;

/** Les faits d'un modèle dans une catégorie — des comptes, jamais une note. */
export interface FaitsGenome {
  /** Affectations reçues (chaque tentative compte). */
  affectations: number;
  /** Le Worker a rendu un résultat accepté par l'ordonnanceur. */
  rendus: number;
  /** Le Worker a échoué et la tâche a été relancée. */
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
  /** Aucun fournisseur ne transmet son coût : jamais estimé. */
  coutFournisseur: 'inconnu';
}

export interface LigneGenome extends FaitsGenome {
  modele: string;
  categorie: Categorie;
}

export interface RegistreGenome {
  lignes: LigneGenome[];
  /** Affectations faites sans modèle déclaré, toutes catégories confondues. */
  sansModele: FaitsGenome;
  /** Fenêtre réellement lue : le journal est borné par sa rétention. */
  fenetre: { evenements: number; depuis: number | null; tronquee: boolean };
}

interface Accumulateur {
  faits: Omit<FaitsGenome, 'dureeMedianeMs' | 'coutFournisseur'>;
  durees: number[];
}

interface Production {
  modele: string | null;
  categorie: Categorie;
}

interface EtatTache {
  courante: (Production & { nodeId: string | null }) | null;
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
  };
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

function figer(acc: Accumulateur): FaitsGenome {
  return {
    ...acc.faits,
    avis: { ...acc.faits.avis },
    humain: { ...acc.faits.humain },
    dureeMedianeMs: mediane(acc.durees),
    coutFournisseur: 'inconnu',
  };
}

/**
 * Replie le journal en registre. `categorieDe` rend la catégorie d'une tâche
 * encore connue, `null` sinon : un événement d'une tâche disparue est ignoré.
 * `borne` est la limite de lecture appliquée par l'appelant — l'atteindre
 * signale une fenêtre tronquée.
 */
export function registreGenomeDepuisEvenements(
  evenements: readonly HiveEvent[],
  categorieDe: (taskId: string) => Categorie | null,
  borne = Number.POSITIVE_INFINITY,
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
    let etat = taches.get(taskId);
    if (!etat) {
      etat = { courante: null, derniere: null, revue: null };
      taches.set(taskId, etat);
    }
    const courante = etat.courante;
    const nodeId = texte(p.nodeId);
    // Une issue Worker ne vaut que pour l'affectation en cours sur CE nœud.
    const issueDeLaCourante = courante !== null && (nodeId === null || nodeId === courante.nodeId);

    switch (ev.type) {
      case 'task_assigned': {
        etat.courante = { modele: texte(p.modele), categorie, nodeId };
        accumulateur(etat.courante).faits.affectations += 1;
        break;
      }
      case 'task_done': {
        if (!issueDeLaCourante) break;
        const acc = accumulateur(courante);
        acc.faits.rendus += 1;
        const duree = p.durationMs;
        if (typeof duree === 'number' && Number.isFinite(duree) && duree >= 0) {
          acc.durees.push(duree);
        }
        solderRevue(etat);
        etat.derniere = { modele: courante.modele, categorie: courante.categorie };
        etat.courante = null;
        break;
      }
      case 'task_retry': {
        if (p.source === 'evaluator') {
          if (etat.derniere) accumulateur(etat.derniere).faits.corrections += 1;
          // La revue humaine est remise à zéro par la correction elle-même.
          etat.revue = null;
          break;
        }
        if (!issueDeLaCourante) break;
        accumulateur(courante).faits.reprises += 1;
        etat.courante = null;
        break;
      }
      case 'task_failed': {
        if (!issueDeLaCourante) break;
        accumulateur(courante).faits.echecs += 1;
        etat.courante = null;
        break;
      }
      case 'task_rejected': {
        if (!issueDeLaCourante) break;
        accumulateur(courante).faits.refus += 1;
        etat.courante = null;
        break;
      }
      case 'task_requeued':
      case 'task_cancelled': {
        if (!issueDeLaCourante) break;
        accumulateur(courante).faits.interrompues += 1;
        etat.courante = null;
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
      tronquee: evenements.length >= borne,
    },
  };
}
