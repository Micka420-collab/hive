// Faire tourner un conseil — la partie qui touche au monde.
//
// `conseil.ts` décide (pur), `eclaireuse.ts` parle aux agents (pur) ; ce
// fichier-ci est le seul à écrire en base et à créer des tâches. La séparation
// n'est pas cosmétique : le protocole de délibération doit rester REJOUABLE à
// l'identique pour qu'on puisse répondre, dans trois ans, à « sur quoi la ruche
// s'est-elle fondée pour recommander ça ? ».
//
// ─── POURQUOI UN SCRUTATEUR, ET PAS UN BRANCHEMENT DANS LE SCHEDULER ─────────
//
// La tentation était d'accrocher le conseil à `handleTaskResult` : le résultat
// arrive, on le dépouille aussitôt. Refusé pour deux raisons.
//
// D'abord `handleTaskResult` est le chemin CHAUD du scheduler, protégé par un
// harnais de rejeu qui exige une trace d'événements identique au caractère
// près ; y greffer des écritures de conseil, c'était risquer une régression
// silencieuse sur tout le reste de la ruche pour une fonctionnalité annexe.
//
// Ensuite, un conseil avance par TOURS : il ne se passe rien tant que TOUTES
// les tâches d'un tour ne sont pas retombées. Réagir tâche par tâche aurait
// obligé à re-tester la complétude du tour à chaque résultat — c'est-à-dire à
// faire du scrutin, mais sur le chemin chaud. On scrute donc à part.

import { randomUUID } from 'node:crypto';
import {
  LENTILLES,
  QUESTION_DEFAUT,
  VERSION_CONSEIL,
  encoreUnTour,
  evaluerConseil,
} from './conseil.js';
import type { Avis, Proposition, Verdict } from './conseil.js';
import { lireAvis, lireProposition, promptExploration, promptVerification } from './eclaireuse.js';
import type { PropositionRapportee } from './eclaireuse.js';
import type { HiveStore, PropositionRangee, SessionRangee } from './store.js';

/** Nombre de sessions closes conservées avant élagage. */
export const CONSEILS_CONSERVES = 50;

/**
 * Vérificatrices sollicitées par proposition et par tour.
 *
 * Trois, exactement le quorum : en demander moins rendrait le quorum
 * inatteignable en un tour, en demander plus multiplierait le coût en
 * temps-ouvrière sans rien changer à la décision.
 */
export const VERIFICATRICES_PAR_PROPOSITION = 3;

/** Ce dont le runner a besoin du monde extérieur. Injectable pour les tests. */
export interface DependancesConseil {
  store: HiveStore;
  /** Crée une tâche d'ouvrière et rend son id. */
  creerTache(input: { projectId: string; title: string; prompt: string }): { id: string };
  /** Journalise un fait typé. */
  emettre(type: string, payload: Record<string, unknown>): void;
  now?: () => number;
}

/** Un résultat d'ouvrière, réduit à ce que le conseil en a besoin. */
export interface ResultatOuvriere {
  nodeId: string;
  agentType: string;
  success: boolean;
  logs: string;
  diff: string;
}

/** Le conseil lit la sortie de l'agent : logs d'abord, diff en secours. */
function sortieDe(r: ResultatOuvriere): string {
  return `${r.logs}\n${r.diff}`;
}

/**
 * Ouvre une session et lance le premier tour d'exploration.
 *
 * Une lentille = une tâche = une éclaireuse. La diversité des angles est ce qui
 * empêche cinq agents de rendre cinq variantes de la même réponse.
 */
export function ouvrirConseil(
  dep: DependancesConseil,
  opts: { question?: string; projectId: string; contexteProjet?: string },
): SessionRangee {
  const now = (dep.now ?? Date.now)();
  const id = `conseil-${randomUUID()}`;
  const question = (opts.question ?? '').trim() || QUESTION_DEFAUT;

  dep.store.creerSession({
    id,
    question,
    projectId: opts.projectId,
    version: VERSION_CONSEIL,
    now,
  });

  for (const lentille of LENTILLES) {
    const tache = dep.creerTache({
      projectId: opts.projectId,
      title: `🔭 Éclaireuse — ${lentille.cle}`,
      prompt: promptExploration({
        question,
        lentille: lentille.cle,
        ...(opts.contexteProjet ? { contexteProjet: opts.contexteProjet } : {}),
        tour: 1,
      }),
    });
    dep.store.lierTache({
      taskId: tache.id,
      sessionId: id,
      role: 'exploration',
      lentille: lentille.cle,
      tour: 1,
    });
  }

  dep.emettre('council_opened', { sessionId: id, lentilles: LENTILLES.length, tour: 1 });
  return dep.store.getSession(id)!;
}

/** Ce qu'une passe de scrutin a changé, pour que l'appelant puisse en rendre compte. */
export interface Avancement {
  sessionId: string;
  depouillees: number;
  propositions: number;
  avis: number;
  /** Vrai si le tour s'est achevé et qu'on a évalué. */
  tourClos: boolean;
  verdict: Verdict | null;
}

/**
 * Fait avancer UNE session : dépouille ce qui est revenu, et si le tour est
 * complet, évalue puis enchaîne.
 *
 * `tachesTerminales` dit quelles tâches ne bougeront plus (succès ou échec
 * définitif). Une tâche d'éclaireuse qui échoue n'est pas un drame : c'est une
 * éclaireuse qui n'est pas revenue. Le conseil continue sans elle — bloquer le
 * tour sur elle laisserait une session ouverte pour toujours.
 */
export function avancerConseil(
  dep: DependancesConseil,
  session: SessionRangee,
  tachesTerminales: Map<string, ResultatOuvriere | null>,
): Avancement {
  const now = (dep.now ?? Date.now)();
  const avancement: Avancement = {
    sessionId: session.id,
    depouillees: 0,
    propositions: 0,
    avis: 0,
    tourClos: false,
    verdict: null,
  };

  const enAttente = dep.store.tachesADepouiller(session.id);
  for (const t of enAttente) {
    if (!tachesTerminales.has(t.taskId)) continue;
    const res = tachesTerminales.get(t.taskId) ?? null;
    avancement.depouillees += 1;
    dep.store.marquerDepouillee(t.taskId);
    if (!res || !res.success) continue; // éclaireuse non revenue : on continue sans elle

    if (t.role === 'exploration') {
      const p = lireProposition(sortieDe(res), {
        id: `prop-${randomUUID()}`,
        eclaireuse: res.nodeId,
        famille: res.agentType,
        tour: t.tour,
      });
      if (!p) continue;
      dep.store.ajouterProposition({ ...p, sessionId: session.id, now });
      avancement.propositions += 1;
      dep.emettre('council_proposal', {
        sessionId: session.id,
        propositionId: p.id,
        nodeId: res.nodeId,
        tour: t.tour,
      });
    } else if (t.propositionId) {
      const a = lireAvis(sortieDe(res), {
        propositionId: t.propositionId,
        eclaireuse: res.nodeId,
        famille: res.agentType,
        tour: t.tour,
      });
      if (!a) continue;
      dep.store.ajouterAvis({ ...a, sessionId: session.id, now });
      avancement.avis += 1;
      dep.emettre('council_review', {
        sessionId: session.id,
        propositionId: t.propositionId,
        nodeId: res.nodeId,
        type: a.type,
        tour: t.tour,
      });
    }
  }

  // Le tour n'est clos que quand PLUS RIEN n'est en attente.
  if (dep.store.tachesADepouiller(session.id).length > 0) return avancement;
  avancement.tourClos = true;

  const propositions = dep.store.listPropositions(session.id);
  const verdict = evaluerConseil({
    tour: session.tour,
    propositions: propositions.map(versProposition),
    avis: dep.store.listAvis(session.id).map(versAvis),
  });
  avancement.verdict = verdict;

  if (!verdict.continuer) {
    clore(dep, session, verdict, now);
    return avancement;
  }

  // Un tour de plus : d'abord faire vérifier ce qui n'a pas encore été jugé,
  // sinon rien ne peut jamais atteindre le quorum.
  const aVerifier = propositions.filter(
    (p) => !dep.store.listAvis(session.id).some((a) => a.propositionId === p.id),
  );
  const neuves = propositions.filter((p) => p.tour === session.tour).length;
  const toursSecs = neuves > 0 ? 0 : session.toursSecs + 1;
  const tourSuivant = session.tour + 1;

  if (!encoreUnTour(tourSuivant, toursSecs)) {
    clore(
      dep,
      session,
      {
        ...verdict,
        issue: 'epuise',
        continuer: false,
        motif: `exploration épuisée après ${toursSecs} tour(s) sans proposition neuve`,
      },
      now,
    );
    return avancement;
  }

  let lancees = 0;
  for (const p of aVerifier) {
    for (let i = 0; i < VERIFICATRICES_PAR_PROPOSITION; i++) {
      const tache = dep.creerTache({
        projectId: session.projectId!,
        title: `🔎 Vérification — ${p.titre.slice(0, 60)}`,
        prompt: promptVerification({ question: session.question, proposition: versRapportee(p) }),
      });
      dep.store.lierTache({
        taskId: tache.id,
        sessionId: session.id,
        role: 'verification',
        propositionId: p.id,
        tour: tourSuivant,
      });
      lancees += 1;
    }
  }

  if (lancees === 0) {
    // Rien à vérifier et rien de neuf : le conseil a fait ce qu'il pouvait.
    clore(dep, session, { ...verdict, continuer: false }, now);
    return avancement;
  }

  dep.store.majSession(session.id, { etat: 'verification', tour: tourSuivant, toursSecs });
  dep.emettre('council_round', { sessionId: session.id, tour: tourSuivant, taches: lancees });
  return avancement;
}

function clore(
  dep: DependancesConseil,
  session: SessionRangee,
  verdict: Verdict,
  now: number,
): void {
  dep.store.majSession(session.id, {
    etat: 'clos',
    issue: verdict.issue,
    motif: verdict.motif,
    closedAt: now,
  });
  // Faits typés uniquement : le motif est une phrase, mais elle est produite par
  // le module PUR à partir de l'état — donc reconstructible, pas figée par un
  // humain. On la range pour l'archive, pas pour l'affichage bilingue.
  dep.emettre('council_closed', {
    sessionId: session.id,
    issue: verdict.issue,
    retenue: verdict.retenue?.proposition.id ?? null,
    danses: verdict.danses.length,
    tour: session.tour,
  });
}

// ─── Conversions ──────────────────────────────────────────────────────────────

export function versProposition(p: PropositionRangee): Proposition {
  return {
    id: p.id,
    eclaireuse: p.eclaireuse,
    famille: p.famille,
    titre: p.titre,
    qualite: p.qualite,
    tour: p.tour,
  };
}

function versRapportee(p: PropositionRangee): PropositionRapportee {
  let sources: string[] = [];
  try {
    const brut: unknown = JSON.parse(p.sources);
    if (Array.isArray(brut)) sources = brut.filter((s): s is string => typeof s === 'string');
  } catch {
    // Colonne difforme : on préfère une proposition sans source à une exception
    // qui bloquerait tout le conseil.
  }
  return { ...versProposition(p), corps: p.corps, sources };
}

function versAvis(a: {
  propositionId: string;
  eclaireuse: string;
  famille: string;
  type: string;
  force: number;
  tour: number;
}): Avis {
  return {
    propositionId: a.propositionId,
    eclaireuse: a.eclaireuse,
    famille: a.famille,
    type: a.type === 'arret' ? 'arret' : 'soutien',
    force: a.force,
    tour: a.tour,
  };
}
