// LA PREUVE — ce que la ruche peut montrer, chiffres à l'appui, qu'un agent
// seul ne peut pas.
//
// ─── LA THÈSE DU PRODUIT, ET CE QUE CE MODULE EN FAIT ────────────────────────
//
// Hive prétend développer un projet PLUS SÛREMENT qu'un agent isolé : chaque
// production est relue par un agent d'une AUTRE famille, exécutée dans un bac,
// validée (tests, types, build, lint) avant d'être livrée, et son coût est
// déclaré, jamais estimé. Tant que ces quatre gestes ne sont que des
// fonctionnalités dans une liste, c'est une promesse. Ce module les COMPTE,
// sur le journal réel, et les rend au cockpit : combien de productions, combien
// relues par une autre famille, combien contestées, combien reprises après
// relecture, combien validées dans un bac, quelle part du coût est connue.
//
// ─── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
//
// Il ne compare pas Hive à un agent seul — personne ici n'a fait tourner l'agent
// seul. Il ne pondère pas, n'interpole pas, et ne devine rien : une production
// dont la relecture n'est pas au journal est « sans relecture », pas « relue
// probablement ». Un journal élagué le DIT (`fenetre.elague`) : les nombres
// portent alors sur ce qui reste, et le cockpit l'écrit.
//
// Module PUR : des évènements et des nœuds en entrée, un relevé en sortie.

import type { HiveEvent, HiveNode } from '../shared/types.js';
import { libelleAgent } from '../shared/agent-libelle.js';

/** Les types d'évènements que la preuve relit — la requête du store les filtre. */
export const TYPES_PREUVE = [
  'task_done',
  'task_retry',
  'task_failed',
  'contre_expertise_verdict',
  'contre_expertise_impossible',
  'validation_recorded',
  'security_gate_recorded',
  'council_decided',
] as const;

export interface Preuve {
  /** La fenêtre lue : le plus ancien fait relu, combien, et si le journal a été élagué. */
  fenetre: { depuis: number | null; evenements: number; elague: boolean };
  productions: {
    /** Productions rendues (`task_done`), par résultat distinct. */
    rendues: number;
    /** Dont relues par une autre famille d'agent (un verdict de contre-expertise). */
    reluesParAutreFamille: number;
    /** Dont relues par la MÊME famille (un verdict, mais le relecteur est du même sang). */
    reluesParMemeFamille: number;
    /** Dont contestées par au moins un relecteur. */
    contestees: number;
    /** Renvoyées en correction par l'Evaluator (`task_retry`, source `evaluator`), par résultat distinct. */
    reprisesApresRelecture: number;
    /** Relecture demandée et impossible (aucune autre famille en ligne). */
    relectureImpossible: number;
  };
  bac: {
    /** Productions dont le bac a fait tourner au moins un contrôle (tests, types, build, lint). */
    validees: number;
    /** Dont TOUS les contrôles applicables sont passés. */
    toutPasse: number;
    /** Dont au moins un contrôle a échoué — et la ruche l'a vu avant la livraison. */
    unEchec: number;
    /** Portes de sécurité enregistrées (`security_gate_recorded`). */
    portes: number;
  };
  cout: {
    /** Tentatives (réussies ou reprises) dont le CLI a déclaré son coût. */
    declarees: number;
    /** Tentatives sans coût déclaré — « inconnu », jamais estimé. */
    inconnues: number;
    /** Somme des coûts déclarés, en USD. */
    totalUsd: number;
  };
  /** Les familles d'agents ayant produit ou relu dans la fenêtre, par libellé. */
  familles: string[];
  /** Désaccords tranchés par un humain (Conseil). */
  decisionsHumaines: number;
  noeuds: {
    total: number;
    enLigne: number;
    /** Nœuds qui déclarent un bac conteneur ou processus. */
    isoles: number;
    /** Dont conteneur (podman, docker). */
    conteneur: number;
  };
}

const chaine = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Le coût déclaré d'une tentative, ou `null` : le fait porte `fournisseur.coutUsd` quand le CLI l'a dit. */
function coutDeclare(payload: Record<string, unknown>): number | null {
  const f = payload.fournisseur;
  if (typeof f !== 'object' || f === null) return null;
  return nombre((f as Record<string, unknown>).coutUsd);
}

/**
 * Le relevé. `evenements` : ceux de `TYPES_PREUVE`, dans n'importe quel ordre ;
 * `noeuds` : la liste courante ; `journalElague` : ce que le store sait de son
 * propre élagage.
 */
export function releverPreuve(
  evenements: readonly HiveEvent[],
  noeuds: readonly HiveNode[],
  journalElague: boolean,
): Preuve {
  const rendues = new Set<string>();
  const relues = new Map<string, { autre: boolean; contestee: boolean }>();
  const reprises = new Set<string>();
  const impossibles = new Set<string>();
  const validees = new Map<string, { passe: boolean; echec: boolean }>();
  const portes = new Set<string>();
  const familles = new Set<string>();
  let declarees = 0;
  let inconnues = 0;
  let totalUsd = 0;
  let decisionsHumaines = 0;
  let depuis: number | null = null;

  const cleResultat = (p: Record<string, unknown>): string | null => {
    const taskId = chaine(p.taskId);
    if (taskId === null) return null;
    const resultId = nombre(p.resultId);
    return resultId === null ? taskId : `${taskId}#${resultId}`;
  };

  for (const e of evenements) {
    if (depuis === null || e.ts < depuis) depuis = e.ts;
    const p = e.payload;
    switch (e.type) {
      case 'task_done': {
        const cle = cleResultat(p);
        if (cle) rendues.add(cle);
        const cout = coutDeclare(p);
        if (cout === null) inconnues += 1;
        else {
          declarees += 1;
          totalUsd += cout;
        }
        break;
      }
      case 'task_retry':
      case 'task_failed': {
        if (p.source === 'evaluator') {
          const cle = cleResultat(p);
          if (cle) reprises.add(cle);
          break;
        }
        const cout = coutDeclare(p);
        if (cout === null) inconnues += 1;
        else {
          declarees += 1;
          totalUsd += cout;
        }
        break;
      }
      case 'contre_expertise_verdict': {
        const cle = cleResultat(p);
        if (!cle) break;
        const producteur = chaine(p.producteur);
        const relecteur = chaine(p.relecteur);
        if (producteur) familles.add(producteur);
        if (relecteur) familles.add(relecteur);
        const autre = producteur !== null && relecteur !== null && producteur !== relecteur;
        const vu = relues.get(cle) ?? { autre: false, contestee: false };
        relues.set(cle, {
          autre: vu.autre || autre,
          contestee: vu.contestee || p.conteste === true,
        });
        break;
      }
      case 'contre_expertise_impossible': {
        const cle = cleResultat(p);
        if (cle) impossibles.add(cle);
        break;
      }
      case 'validation_recorded': {
        const cle = cleResultat(p);
        const v = p.validation;
        if (!cle || typeof v !== 'object' || v === null) break;
        const etats = Object.values(v as Record<string, unknown>).filter(
          (x): x is string => typeof x === 'string',
        );
        const lances = etats.filter((x) => x === 'passed' || x === 'failed');
        if (lances.length === 0) break;
        validees.set(cle, {
          passe: lances.every((x) => x === 'passed'),
          echec: lances.some((x) => x === 'failed'),
        });
        break;
      }
      case 'security_gate_recorded': {
        const cle = cleResultat(p);
        if (cle) portes.add(cle);
        break;
      }
      case 'council_decided':
        decisionsHumaines += 1;
        break;
      default:
        break;
    }
  }

  let parAutre = 0;
  let parMeme = 0;
  let contestees = 0;
  for (const r of relues.values()) {
    if (r.autre) parAutre += 1;
    else parMeme += 1;
    if (r.contestee) contestees += 1;
  }
  let toutPasse = 0;
  let unEchec = 0;
  for (const v of validees.values()) {
    if (v.passe) toutPasse += 1;
    if (v.echec) unEchec += 1;
  }

  const isoles = noeuds.filter(
    (n) => n.isolement !== undefined && n.isolement.niveau !== 'aucun',
  ).length;
  const conteneur = noeuds.filter((n) => n.isolement?.niveau === 'conteneur').length;

  return {
    fenetre: { depuis, evenements: evenements.length, elague: journalElague },
    productions: {
      rendues: rendues.size,
      reluesParAutreFamille: parAutre,
      reluesParMemeFamille: parMeme,
      contestees,
      reprisesApresRelecture: reprises.size,
      relectureImpossible: impossibles.size,
    },
    bac: { validees: validees.size, toutPasse, unEchec, portes: portes.size },
    cout: { declarees, inconnues, totalUsd: Math.round(totalUsd * 10_000) / 10_000 },
    familles: [...familles].sort().map((f) => libelleAgent(f)),
    decisionsHumaines,
    noeuds: {
      total: noeuds.length,
      enLigne: noeuds.filter((n) => n.status === 'online').length,
      isoles,
      conteneur,
    },
  };
}
