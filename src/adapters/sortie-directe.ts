// La sortie standard de l'agent, remontée EN DIRECT — bornée et cadencée.
//
// ─── CE QUE L'ÉCRAN NE VOYAIT PAS ───────────────────────────────────────────
//
// Pendant une exécution, le tableau de bord recevait une ligne (« claude -p
// démarré »), puis des sous-agents et des fichiers ouverts, puis — quinze
// minutes plus tard — le résultat. Entre les deux, rien : l'agent pouvait
// tourner en rond, attendre un réseau ou écrire le bon correctif, l'opérateur
// ne le voyait qu'à la fin. La sortie était pourtant là, ligne à ligne, dans
// `exec.ts` ; elle ne partait que dans le log final.
//
// ─── LES DEUX BORNES, ET CE QUI CASSE SANS ELLES ────────────────────────────
//
//   · un morceau pèse au plus `SORTIE_MORCEAU_MAX_OCTETS` (4 Kio) : un agent
//     bavard (le stream-json de Claude recopie des fichiers entiers) saturerait
//     sinon la socket du nœud, que le hub ferme au-delà de 100 messages/s ;
//   · un morceau part au plus toutes les `SORTIE_INTERVALLE_MS` (250 ms, soit
//     4 par seconde et par tâche) : ce qui arrive entre deux départs est
//     COALESCÉ dans le suivant. Au-delà de 4 Kio en attente, le surplus est
//     compté et annoncé (« […] octets omis »), jamais retenu sans fin — la
//     sortie en direct est un aperçu, le log complet reste dans le résultat.
//
// Une ligne n'est JAMAIS coupée entre deux morceaux : trop longue, elle est
// tronquée et marquée (`MARQUE_LIGNE_TRONQUEE`). C'est ce qui permet au nœud de
// caviarder une clé exactement (`shared/caviardage.ts`) : coupée en deux
// morceaux, aucune des deux moitiés ne serait égale à la valeur.

import { MARQUE_LIGNE_TRONQUEE } from '../shared/caviardage.js';

/** Poids maximal d'un morceau de sortie en direct, en octets UTF-8. */
export const SORTIE_MORCEAU_MAX_OCTETS = 4 * 1024;
/** Écart minimal entre deux morceaux d'une même tâche (≤ 4 par seconde). */
export const SORTIE_INTERVALLE_MS = 250;

const octets = (s: string): number => Buffer.byteLength(s, 'utf8');

/**
 * Tronque `s` à `max` octets UTF-8 sans couper un caractère : un octet de
 * tête orphelin redevient « � » au décodage, et on le retire.
 */
function tronquerOctets(s: string, max: number): string {
  if (octets(s) <= max) return s;
  return Buffer.from(s, 'utf8').subarray(0, max).toString('utf8').replace(/�+$/, '');
}

/** Une ligne, marquée et tronquée si elle dépasse ce qu'un morceau peut porter. */
function ligneBornee(ligne: string, max: number): string {
  if (octets(ligne) <= max) return ligne;
  return tronquerOctets(ligne, max - octets(MARQUE_LIGNE_TRONQUEE)) + MARQUE_LIGNE_TRONQUEE;
}

export interface SortieDirecte {
  /** Un fragment de stdout, tel que le processus l'a écrit. */
  ecrire(fragment: string): void;
  /**
   * Fin du processus : vide ce qui attend, si la cadence le permet encore.
   * Sinon ce reste est abandonné — il est dans le log du résultat, qui part
   * juste après ; un morceau émis APRÈS lui serait ignoré par le hub.
   */
  terminer(): void;
}

export interface HorlogeSortie {
  maintenant(): number;
  planifier(fn: () => void, ms: number): () => void;
}

const horlogeReelle: HorlogeSortie = {
  maintenant: () => Date.now(),
  planifier: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  },
};

export function createSortieDirecte(
  emettre: (morceau: string) => void,
  horloge: HorlogeSortie = horlogeReelle,
): SortieDirecte {
  // Réserve pour l'annonce d'omission : un morceau, annonce comprise, reste
  // sous le plafond.
  const budgetLignes = SORTIE_MORCEAU_MAX_OCTETS - 64;
  let ligneEnCours = '';
  let attente = '';
  let omis = 0;
  let dernierDepart = -Infinity;
  let annuler: (() => void) | null = null;
  let fini = false;
  let debordement = false;

  const empiler = (ligne: string): void => {
    // `- 1` : le retour à la ligne compte aussi — sans lui, une ligne tronquée
    // pile au budget ne tenait jamais, même seule, et partait « omise ».
    const bornee = ligneBornee(ligne, budgetLignes - 1) + '\n';
    if (octets(attente) + octets(bornee) <= budgetLignes) attente += bornee;
    else omis += octets(ligne) + 1;
  };

  const partir = (): void => {
    annuler = null;
    if (attente === '' && omis === 0) return;
    const annonce = omis > 0 ? `[… ${omis} octets omis]\n` : '';
    const morceau = annonce + attente;
    attente = '';
    omis = 0;
    dernierDepart = horloge.maintenant();
    emettre(morceau);
  };

  const programmer = (): void => {
    if (annuler || fini) return;
    const delai = Math.max(0, dernierDepart + SORTIE_INTERVALLE_MS - horloge.maintenant());
    annuler = horloge.planifier(partir, delai);
  };

  return {
    ecrire(fragment) {
      if (fini) return;
      let texte = fragment;
      if (debordement) {
        const fin = texte.indexOf('\n');
        omis += octets(fin < 0 ? texte : texte.slice(0, fin));
        texte = fin < 0 ? '' : texte.slice(fin + 1);
        debordement = fin < 0;
      }
      const lignes = (ligneEnCours + texte).split('\n');
      ligneEnCours = lignes.pop() ?? '';
      // Une ligne sans fin (barre de progression, `\r` répétés) ne grossit pas
      // sans borne : au-delà d'un morceau, elle part tronquée, et la suite de
      // la même ligne, jusqu'à son retour, est comptée comme omise.
      if (octets(ligneEnCours) > budgetLignes) {
        lignes.push(ligneEnCours);
        ligneEnCours = '';
        debordement = true;
      }
      for (const ligne of lignes) empiler(ligne);
      if (attente !== '' || omis > 0) programmer();
    },
    terminer() {
      if (fini) return;
      fini = true;
      annuler?.();
      annuler = null;
      if (ligneEnCours !== '') empiler(ligneEnCours);
      ligneEnCours = '';
      if (horloge.maintenant() - dernierDepart >= SORTIE_INTERVALLE_MS) partir();
    },
  };
}
