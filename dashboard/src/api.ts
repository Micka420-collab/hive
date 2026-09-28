// Liaison temps réel avec l'orchestrateur : le dashboard s'abonne au flux
// WebSocket (snapshots d'état + journal d'événements). Le token est mémorisé
// localement ; en mode simulation, la valeur par défaut suffit.

import { t as tNow } from './i18n';
import {
  CODE_TABLEAU_TROP_LENT,
  EVENEMENTS_NON_DIFFUSES,
  parseServerMessage,
} from '../../src/shared/protocol';
import type { HiveEvent, Project, StateSnapshot, Task, TaskResult } from '../../src/shared/types';
import type { DirectTache } from '../../src/shared/bac-direct';
import type { Graphe } from '../../src/shared/cerveau-graphe.js';
import type { DecisionConseil, Desaccord, EntreeWarRoom } from '../../src/shared/war-room.js';
export type { DecisionConseil, Desaccord, EntreeWarRoom } from '../../src/shared/war-room.js';
import type { WorkerSnapshot } from '../../src/orchestrator/workers.js';
import type { JournalOuvriere } from '../../src/orchestrator/journal-ouvriere.js';
import type { RapportLivraisonLocale } from '../../src/shared/livraison-locale.js';
import type {
  EvaluationResult,
  ValidationEvidence,
  ValidationProvenance,
} from '../../src/orchestrator/evaluator.js';

const TOKEN_KEY = 'hive.token';
export const DEFAULT_TOKEN = 'change-me';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? DEFAULT_TOKEN;
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Erreur API porteuse du statut HTTP (0 = réseau) — permet de distinguer un
 * échec transitoire (réseau, 5xx) d'un échec définitif (404 tâche disparue). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Marche à suivre renvoyée par le serveur (501 GitHub, 401 jeton…), jamais le secret. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Assemble le texte montré à l'humain : l'erreur courte, puis le détail s'il
 * apporte autre chose. Sans ça, un 501 GitHub ne montrait que « GitHub non
 * connecté » et cachait la marche à suivre (`detail`) déjà écrite côté serveur.
 */
export function messageApi(
  body: {
    error?: string;
    message?: string;
    detail?: string;
  },
  statut: number,
): { message: string; detail?: string } {
  const court = body.message ?? body.error ?? tNow(`Erreur ${statut}`, `Error ${statut}`);
  const detail =
    typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : undefined;
  if (!detail || detail === court) return detail ? { message: court, detail } : { message: court };
  return { message: `${court} — ${detail}`, detail };
}

// ─── Le lien de partage, côté porteur ───────────────────────────────────────
//
// ─── POURQUOI `sessionStorage` ET PAS `localStorage` ────────────────────────
//
// Un lien de partage circule : on le colle dans une conversation, on l'ouvre
// sur un poste qui n'est pas le sien, on le montre à quelqu'un. Le ranger dans
// `localStorage` le laisserait derrière soi — l'onglet fermé, le suivant qui
// ouvre le tableau de bord sur cette machine repartirait en lecture du projet
// de quelqu'un d'autre. `sessionStorage` meurt avec l'onglet, ce qui est
// exactement la durée de vie d'un lien qu'on vous a montré.
//
// Il est AUSSI cloisonné par onglet : une personne peut lire un partage dans
// un onglet et rester connectée à son propre compte dans l'autre, sans que
// l'un contamine l'autre.

const PARTAGE_KEY = 'hive.partage';

export function getPartage(): string | null {
  try {
    return sessionStorage.getItem(PARTAGE_KEY);
  } catch {
    // Navigateur en mode restreint : on lit sans partage plutôt que de tomber.
    return null;
  }
}

export function savePartage(jeton: string): void {
  try {
    sessionStorage.setItem(PARTAGE_KEY, jeton);
  } catch {
    /* rien à faire : la lecture se fera sans mémoire */
  }
}

export function clearPartage(): void {
  try {
    sessionStorage.removeItem(PARTAGE_KEY);
  } catch {
    /* idem */
  }
}

/**
 * fetch authentifié qui lève une ApiError lisible sur réponse non-OK.
 *
 * ─── LE COMPTE PART AVEC CHAQUE APPEL, PAS SEULEMENT AVEC CERTAINS ──────────
 *
 * Cette fonction n'envoyait que le jeton de ruche. Depuis l'ADR 0007, un acte
 * qui ENGAGE un projet appartenant à un compte — créer des tâches, lancer un
 * merge, prendre une issue, reprendre une livraison, lancer un chantier ou un
 * workflow — exige ce compte : le jeton, que toute machine membre détient, n'y
 * suffit plus. Et `createProject` attribue le projet à la session dès qu'il y
 * en a une. Résultat : la personne connectée recevait « 404 projet inconnu »
 * sur SON projet, à commencer par `addTasks` juste après sa création.
 *
 * Joindre le JWT à chaque appel est sûr parce que le serveur l'AJOUTE sans
 * rien retirer : un engagement essaie le compte, puis le jeton sur un projet
 * orphelin ; les lectures gardées par `lectureProjetPermise` acceptent encore
 * le jeton en premier (celles du Rayon, elles, exigeaient déjà le compte ou un
 * lien). Sans session rien ne change, et un JWT périmé est traité par la Reine
 * comme absent. La CLI fait déjà ainsi (`HIVE_JWT`, `src/cli.ts`).
 *
 * Une session qui expire PENDANT que l'onglet vit est traitée ici même, au
 * point où chaque refus arrive : voir « LA SESSION QUI EXPIRE » plus bas.
 *
 * `path` est TOUJOURS une route de la Reine (`/api/…`, même origine) : cette
 * identité ne part jamais chez un tiers. La garde de
 * `tests/dashboard-contrat-compte.test.tsx` le vérifie à chaque appel.
 *
 * `identite` n'existe que pour UNE exception : la lecture par lien de partage
 * (`apiLecture`), qui part avec le lien SEUL. Retirer cette valeur par défaut
 * rouvre le 404 ; le même banc le rejoue contre une vraie Reine.
 */
async function api<T>(
  path: string,
  init?: RequestInit,
  identite: Record<string, string> = enTetesRuche(),
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...identite, ...init?.headers },
  });
  if (!res.ok) {
    let message = tNow(`Erreur ${res.status}`, `Error ${res.status}`);
    let detail: string | undefined;
    try {
      // Endpoints custom → { error } (déjà précis). Validation de schéma Fastify
      // → { message } détaillé + { error: "Bad Request" } générique : le message
      // est alors le plus utile, on le préfère quand il est présent.
      // `detail` porte la marche à suivre (501 GitHub, 401 jeton de ruche) :
      // l'omettre laissait l'écran muet sur ce qu'il fallait faire.
      const body = (await res.json()) as { error?: string; message?: string; detail?: string };
      const assemble = messageApi(body, res.status);
      message = assemble.message;
      detail = assemble.detail;
    } catch {
      /* corps non-JSON */
    }
    const jwt = jwtPorte(identite);
    if (jwt && (await sessionRefusee(path, res.status, jwt, identite))) {
      const expiree = expirerSession(jwt);
      if (expiree) throw expiree;
    }
    throw new ApiError(message, res.status, detail);
  }
  return (await res.json()) as T;
}

// ─── LA SESSION QUI EXPIRE PENDANT QUE L'ONGLET VIT ─────────────────────────
//
// Un JWT dure sept jours ; un onglet de tableau de bord, bien plus. Passé
// l'échéance, la Reine traite le JWT comme ABSENT — c'est sa règle, et elle
// est juste. Mais côté écran, « absent » voulait dire l'ancien chemin, en
// silence :
//
//   · « 404 projet inconnu » sur SON PROPRE projet — les engagements ont la
//     forme de l'inexistence pour qui n'y a pas droit (ADR 0007), et un jeton
//     de ruche seul n'a pas droit à un projet qui appartient à un compte ;
//   · 401 sur `createProject`, qui prend la porte du compte dès qu'un JWT est
//     rangé ;
//   · et pendant ce temps, la barre du haut affichait toujours le nom de la
//     personne. Chaque geste échouait, et l'écran ne disait jamais pourquoi.
//
// ─── LE REFUS NE SUFFIT PAS À CONCLURE : ON DEMANDE À LA REINE ───────────────
//
// Un 404 peut être vrai (le projet d'autrui, une tâche disparue) et un 401 peut
// viser le jeton de RUCHE, pas le compte. Deviner l'un de l'autre sur la forme
// du refus, c'est déconnecter quelqu'un pour une faute qui n'est pas la
// sienne. On repose donc la seule question qui tranche — `/api/auth/me`, que la
// Reine juge sur le JWT SEUL — avec l'identité même qui vient d'échouer :
//
//   · refusée (401, ou 404 : le compte n'existe plus) → la session est morte.
//     Le JWT est purgé, l'écran est prévenu (`surSessionExpiree`) et l'appel
//     échoue en le DISANT : « Session expirée — reconnectez-vous » ;
//   · acceptée → le refus d'origine était vrai, il remonte intact ;
//   · injoignable, 5xx → on ne sait pas. Inconnu reste inconnu : on ne purge
//     rien, le refus d'origine remonte.
//
// ─── CE QU'ON NE FAIT JAMAIS : REJOUER SANS LE COMPTE ────────────────────────
//
// La tentation serait de relancer l'appel au jeton de ruche seul, « pour que
// ça marche ». Sur `createProject`, cela fabriquerait un projet ORPHELIN, que
// la personne ne possède pas et dont elle ne pourrait ni lire le code ni
// admettre quiconque — exactement le défaut que `/api/projects/user` a fermé.
// L'appel échoue, la personne se reconnecte, et c'est ELLE qui refait le geste.

/** Le JWT que CET appel a présenté — pas celui du stockage, qui a pu changer depuis. */
function jwtPorte(identite: Record<string, string>): string | null {
  const bearer = identite.authorization;
  return bearer?.startsWith('Bearer ') ? bearer.slice(7) : null;
}

/**
 * Ce refus peut-il venir d'une session morte ?
 *
 * Seuls deux refus en ont la forme : 401, et 404 sur une route de projet ou de
 * tâche (la forme de l'inexistence des engagements). `/api/auth/login` et
 * `/register` en sont exclues : leur 401 dit « identifiants invalides », et le
 * transformer en « session expirée » mentirait à qui se trompe de mot de passe.
 */
function refusDeSession(path: string, statut: number): boolean {
  if (path.startsWith('/api/auth/')) return false;
  if (statut === 401) return true;
  return statut === 404 && (path.startsWith('/api/projects/') || path.startsWith('/api/tasks/'));
}

/**
 * Vérifications en vol, par JWT. Dix panneaux qui échouent ensemble ne doivent
 * pas poser dix fois la même question à la Reine : sans ce partage, un seul
 * JWT périmé déclenchait autant de `/api/auth/me` que d'appels en échec.
 */
const verifications = new Map<string, Promise<boolean>>();

/**
 * Le dernier « vivante » de la Reine, et quand. Un vrai 404 (une tâche
 * disparue qu'un panneau interroge en boucle) ne doit pas DOUBLER chaque
 * requête contre la limite REST par IP : la réponse vaut quelques secondes.
 * Borné à un JWT et à `VIVANTE_MS` — une session qui meurt juste après est
 * reconnue au premier refus suivant, pas perdue.
 */
let derniereVivante: { jwt: string; a: number } | null = null;
const VIVANTE_MS = 10_000;

/** Vrai si la Reine confirme que la session de CET appel est morte. */
async function sessionRefusee(
  path: string,
  statut: number,
  jwt: string,
  identite: Record<string, string>,
): Promise<boolean> {
  // `/api/auth/me` EST l'oracle : son propre refus n'a pas à être revérifié.
  if (path === '/api/auth/me') return statut === 401 || statut === 404;
  if (!refusDeSession(path, statut)) return false;
  // Déjà tranché pendant que cet appel était en route : la session est morte
  // (purgée, marque posée — ici ou dans un autre onglet), ou une AUTRE session
  // a pris sa place, et son refus d'origine remonte tel quel.
  const courant = getJwt();
  if (courant !== jwt) return courant === null && sessionEstExpiree();
  if (derniereVivante?.jwt === jwt && Date.now() - derniereVivante.a < VIVANTE_MS) return false;
  const enVol = verifications.get(jwt);
  if (enVol) return enVol;
  // Le rappel passe par `api()` avec la MÊME identité : la garde de
  // `tests/dashboard-contrat-compte.test.tsx` s'applique donc à lui aussi, et
  // son refus déclenche lui-même `expirerSession` (idempotent, voir plus bas).
  const verification = api<AuthUser>('/api/auth/me', undefined, identite).then(
    () => {
      derniereVivante = { jwt, a: Date.now() };
      return false;
    },
    (e: unknown) => e instanceof SessionExpireeError,
  );
  verifications.set(jwt, verification);
  try {
    return await verification;
  } finally {
    verifications.delete(jwt);
  }
}

/**
 * L'échec d'un appel dont la session est morte. C'est une `ApiError` 401 comme
 * une autre — chaque écran qui affiche `e.message` dit donc déjà la bonne
 * chose — mais elle se reconnaît, pour qui doit la distinguer.
 */
export class SessionExpireeError extends ApiError {
  constructor() {
    super(tNow('Session expirée — reconnectez-vous', 'Session expired — sign in again'), 401);
    this.name = 'SessionExpireeError';
  }
}

const ecouteursSession = new Set<() => void>();

/**
 * La marque « session expirée, pas encore résolue » — dans le STOCKAGE, à côté
 * du JWT, et non dans la mémoire du module.
 *
 * ─── POURQUOI PAS UNE VARIABLE ───────────────────────────────────────────────
 *
 * Le JWT vit dans `localStorage`, que tous les onglets partagent ; une
 * variable de module, elle, est à UN onglet. Première version : l'onglet A
 * constatait l'expiration, purgeait le JWT commun et levait SON drapeau.
 * L'onglet B, drapeau baissé et JWT disparu, affichait toujours le nom de la
 * personne — et son « + Projet » prenait la porte du jeton de ruche : un
 * projet ORPHELIN, créé en silence, exactement ce que ce module interdit. La
 * garde vit donc là où vit ce qu'elle protège : chaque onglet la LIT au moment
 * du geste, sans dépendre d'un évènement qui pourrait arriver après le clic.
 */
const CLE_SESSION_EXPIREE = 'hive.jwt.expiree';

/**
 * Purge la session morte, pose la marque et prévient l'écran — UNE fois.
 *
 * Idempotent parce que la vérification passe elle-même par `api()` : l'appel
 * d'origine et son rappel concluent tous deux. Et on ne purge que le JWT qui a
 * échoué : si la personne s'est reconnectée entre-temps (un autre onglet), le
 * nouveau JWT n'a rien fait pour mériter d'être effacé — et l'appel rend alors
 * `null` : son refus d'origine remonte, au lieu d'annoncer « session expirée »
 * à une session qui vit.
 */
function expirerSession(jwt: string): SessionExpireeError | null {
  const courant = getJwt();
  if (courant === jwt) {
    clearJwt();
    localStorage.setItem(CLE_SESSION_EXPIREE, '1');
    for (const ecouteur of ecouteursSession) ecouteur();
  } else if (courant !== null) {
    return null;
  }
  return new SessionExpireeError();
}

/**
 * S'abonner à l'expiration de la session — celle que CET onglet constate, et
 * celle qu'un AUTRE onglet a constatée (l'évènement `storage` ne part que vers
 * les autres onglets, d'où les deux sources). Rend la désinscription.
 *
 * `reprise` : un AUTRE onglet a levé la marque (reconnexion, ou « Continuer
 * sans compte »). La garde de `gardeSession` tombe ici aussi, puisqu'elle lit
 * le stockage commun ; sans ce rappel, le bandeau de cet onglet continuait
 * d'affirmer « aucun n'est rejoué sans compte » pendant que « + Projet »
 * repartait au jeton de ruche — l'écran disait l'inverse de ce qu'il faisait.
 */
export function surSessionExpiree(ecouteur: () => void, reprise?: () => void): () => void {
  const ailleurs = (e: StorageEvent) => {
    if (e.key !== CLE_SESSION_EXPIREE) return;
    if (e.newValue !== null) ecouteur();
    else reprise?.();
  };
  ecouteursSession.add(ecouteur);
  window.addEventListener('storage', ailleurs);
  return () => {
    ecouteursSession.delete(ecouteur);
    window.removeEventListener('storage', ailleurs);
  };
}

/**
 * Un AUTRE onglet a changé le JWT : connexion, déconnexion, purge. Sans ça,
 * la barre de cet onglet gardait un nom que plus rien ne porte.
 */
export function surJwtAilleurs(ecouteur: () => void): () => void {
  const ailleurs = (e: StorageEvent) => {
    if (e.key === JWT_KEY) ecouteur();
  };
  window.addEventListener('storage', ailleurs);
  return () => window.removeEventListener('storage', ailleurs);
}

/**
 * La session a-t-elle expiré, sans que la personne se soit reconnectée ni ait
 * choisi de continuer sans compte — dans cet onglet ou dans un autre ? Tant
 * que oui, les créations qui attribuent un propriétaire (`createProject`,
 * `importerDepotGithub`) refusent sans rien envoyer : voir `gardeSession`.
 */
export function sessionEstExpiree(): boolean {
  return localStorage.getItem(CLE_SESSION_EXPIREE) !== null;
}

/** « Continuer sans compte » : un choix EXPLICITE, qui rend la porte du jeton. */
export function oublierSessionExpiree(): void {
  localStorage.removeItem(CLE_SESSION_EXPIREE);
}

/**
 * La garde des gestes qui FONT NAÎTRE un projet. Session tout juste expirée :
 * le JWT est purgé, et sans elle le geste suivant — le même bouton, dans la
 * même fenêtre encore ouverte, ou dans un autre onglet — partirait au jeton de
 * ruche seul et ferait naître en silence un projet ORPHELIN, que la personne
 * croirait à elle. On refuse sans rien envoyer, jusqu'à ce qu'elle se
 * reconnecte ou choisisse de continuer sans compte (`oublierSessionExpiree`).
 */
function gardeSession(): Promise<never> | null {
  return sessionEstExpiree() ? Promise.reject(new SessionExpireeError()) : null;
}

export interface NewTaskInput {
  id?: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

/**
 * Crée un projet — ATTRIBUÉ À SON CRÉATEUR quand il y a un compte.
 *
 * ─── LE DÉFAUT QUE CETTE FONCTION FERMAIT MAL ────────────────────────────────
 *
 * `POST /api/projects` s'authentifie par le JETON DE RUCHE. Il n'a donc
 * personne à qui attribuer le projet, et `createProject` range par défaut
 * `visibility: 'private'`, `ownerId: null`. Autrement dit : TOUT projet créé
 * depuis le bouton « + Projet » naissait privé et orphelin.
 *
 * Une fois le contrôle d'accès posé, la conséquence est absurde — la personne
 * qui vient de créer le projet ne peut ni en lire le code, ni y admettre
 * quelqu'un, ni le partager, sauf si elle est administratrice. C'est le
 * parcours le PLUS courant du produit.
 *
 * `POST /api/projects/user` existait pour ça depuis le début : il attribue le
 * projet au compte appelant et l'inscrit comme membre `owner`. Personne ne
 * l'appelait. Le défaut n'était donc dans aucune route — il était dans ce
 * qu'aucune ne faisait, exactement comme pour l'adoption.
 *
 * Sans compte, on retombe sur l'ancienne porte : le tableau de bord s'utilise
 * sans compte, et un projet orphelin reste adoptable par un administrateur.
 */
export function createProject(input: {
  name: string;
  repoUrl?: string;
  description?: string;
  visibility?: 'public' | 'private';
}): Promise<Project> {
  const refus = gardeSession();
  if (refus) return refus;
  if (getJwt()) {
    return apiCompte<Project>('/api/projects/user', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  return api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

// ─── Le Conseil des Éclaireuses ─────────────────────────────────────────────
//
// Le Conseil ne change RIEN : son verdict est une PROPOSITION À UN HUMAIN. Un
// mécanisme dont la sortie EST une proposition à un humain, et que cet humain
// ne peut lire qu'en ligne de commande, est le cas le plus net de « mécanisme
// sans écran » — plus net encore que Les Guetteuses, dont la sortie était au
// moins une alerte.

/** Ce que devient un conseil. `quorum` est le seul cas qui recommande. */
export type IssueConseil = 'quorum' | 'depart' | 'sans_quorum' | 'epuise' | 'vide';

export interface DanseConseil {
  id: string;
  titre: string;
  corps: string;
  /** AFFICHÉES, jamais suivies par la ruche. */
  sources: string[];
  eclaireuse: string;
  famille: string;
  qualite: number;
  intensite: number;
  soutiens: string[];
  arrets: string[];
  familles: string[];
  quorum: boolean;
  autoSoutienIgnore: boolean;
  raisons: { type: 'soutien' | 'arret'; raison?: string; eclaireuse: string }[];
}

export interface SessionConseil {
  id: string;
  question: string;
  projectId: string;
  etat: string;
  tour: number;
  issue: IssueConseil;
  motif?: string;
  createdAt: number;
  closedAt?: number | null;
  enVol: number;
  danses: DanseConseil[];
  /** L'identifiant de la danse retenue, ou `null` si rien n'a convergé. */
  retenue: string | null;
  /**
   * La décision humaine COURANTE, ou `null` tant que personne n'a tranché.
   * OPTIONNELLE : une Reine d'avant ce lot ne la rend pas — l'écran le lit
   * comme « pas de décision », ce qui est exactement ce qu'elle savait.
   */
  decision?: DecisionConseil | null;
}

export interface ConseilResume {
  id: string;
  question: string;
  projectId: string;
  etat: string;
  tour: number;
  issue: IssueConseil | null;
  createdAt: number;
  closedAt?: number | null;
  decision?: DecisionConseil | null;
}

export function fetchConseils(): Promise<{ conseils: ConseilResume[] }> {
  return api<{ conseils: ConseilResume[] }>('/api/conseils');
}

export function fetchConseil(sessionId: string): Promise<SessionConseil> {
  return api<SessionConseil>(`/api/conseil/${encodeURIComponent(sessionId)}`);
}

// Réunir et trancher ENGAGENT le projet (ADR 0007) : sur un projet qui a un
// propriétaire, la Reine exige le COMPTE, et c'est aussi le compte qu'elle
// inscrit comme auteur de la décision. D'où `enTetesRuche()` — le jeton ET le
// compte s'il y en a un. Sans lui, la personne connectée recevrait « projet
// inconnu » sur son propre projet, et sa décision serait rangée anonyme.

/** Réunit un Conseil sur un projet. 409 si un conseil y délibère déjà. */
export function reunirConseil(projectId: string, question: string): Promise<SessionConseil> {
  const q = question.trim();
  return api<SessionConseil>(`/api/projects/${encodeURIComponent(projectId)}/conseil`, {
    method: 'POST',
    headers: enTetesRuche(),
    body: JSON.stringify(q ? { question: q } : {}),
  });
}

/**
 * Tranche un Conseil clos. `precedente` nomme la décision qu'on remplace
 * (`null` pour la première) : 409 si quelqu'un a tranché entre-temps.
 */
export function trancherConseil(
  sessionId: string,
  decision: { propositionId: string | null; justification: string; precedente: number | null },
): Promise<SessionConseil> {
  return api<SessionConseil>(`/api/conseil/${encodeURIComponent(sessionId)}/decision`, {
    method: 'POST',
    headers: enTetesRuche(),
    body: JSON.stringify(decision),
  });
}

/** Le fil de la War Room (cf. `src/shared/war-room.ts`). */
export interface VueWarRoom {
  projectId: string | null;
  taskId: string | null;
  /** Du plus ancien au plus récent, bornées à `limite`. */
  entrees: EntreeWarRoom[];
  /** Vrai quand des entrées plus anciennes existent au-delà de `limite`. */
  tronque: boolean;
  desaccords: Desaccord[];
  taches: Record<string, { titre: string; projectId: string }>;
  conseils: Record<string, { question: string; projectId: string | null }>;
  /** Le journal a déjà perdu des lignes : ce fil n'est pas toute l'histoire. */
  journalElague: boolean;
}

export function fetchWarRoom(
  filtre: { projectId?: string | null; taskId?: string | null; limite?: number } = {},
): Promise<VueWarRoom> {
  const q = new URLSearchParams();
  if (filtre.projectId) q.set('projectId', filtre.projectId);
  if (filtre.taskId) q.set('taskId', filtre.taskId);
  if (filtre.limite !== undefined) q.set('limite', String(filtre.limite));
  const qs = q.toString();
  // Lecture de projet : le compte ouvre les projets qui ont un propriétaire.
  return api<VueWarRoom>(`/api/war-room${qs ? `?${qs}` : ''}`, { headers: enTetesRuche() });
}

// ─── Connecter un dépôt GitHub ──────────────────────────────────────────────
//
// Ces deux routes vivaient depuis le début sans aucun écran : connecter un
// dépôt se faisait en ligne de commande, alors que c'est le tout premier geste
// de quelqu'un qui découvre la ruche.
//
// Le jeton GitHub, lui, ne passe JAMAIS par ici. Il vit dans l'environnement de
// l'orchestrateur (`HIVE_GITHUB_TOKEN`), en mémoire, le temps du processus —
// le tableau de bord demande « mes dépôts » et reçoit une liste, sans jamais
// voir de quoi la fabriquer. Un écran qui collecterait le jeton en ferait une
// valeur qui traverse le navigateur, l'historique et le presse-papiers.

/** État de la connexion GitHub côté orchestrateur — jamais le secret lui-même. */
export interface StatutGithub {
  /** `true` si l'orchestrateur a un jeton GitHub en mémoire. */
  configure: boolean;
  /** Marche à suivre quand `configure` est faux (même texte que le 501). */
  detail?: string;
}

/** Sonde légère : GitHub est-il branché sur l'orchestrateur ? */
export function fetchStatutGithub(): Promise<StatutGithub> {
  return api<StatutGithub>('/api/github/status');
}

export interface DepotGithub {
  fullName: string;
  nom: string;
  description: string;
  prive: boolean;
  cloneUrl: string;
  htmlUrl: string;
  langage: string;
  pousseA: number;
  archive: boolean;
  /** Déjà connecté à la ruche : deux projets sur un même dépôt, c'est deux
   *  plans de merge concurrents sur les mêmes fichiers. */
  importe: boolean;
}

export interface DepotsGithub {
  depots: DepotGithub[];
  total: number;
  tronque?: boolean;
}

export function fetchDepotsGithub(q = ''): Promise<DepotsGithub> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiCompte<DepotsGithub>(`/api/github/repos${query}`);
}

/**
 * Connecte un dépôt à la ruche.
 *
 * Signé par le COMPTE en plus du jeton de ruche : le serveur attribue alors le
 * projet à l'appelant. Sans compte (la voie CLI), le projet naît orphelin et
 * doit être adopté — ce qui était le seul comportement possible jusqu'ici.
 */
export function importerDepotGithub(fullName: string): Promise<{ projet: Project }> {
  // Même garde que `createProject` : un import sans le compte naîtrait orphelin.
  const refus = gardeSession();
  if (refus) return refus;
  return apiCompte<{ projet: Project }>('/api/github/import', {
    method: 'POST',
    body: JSON.stringify({ fullName }),
  });
}

/**
 * Demande à un nœud de POSER un outil sur sa machine.
 *
 * ─── LA REQUÊTE NE PORTE PAS DE COMMANDE ────────────────────────────────────
 *
 * Deux identifiants dans le chemin, un corps vide. C'est délibéré, et c'est ce
 * qui borne la fonctionnalité : le navigateur ne choisit pas ce qui s'exécute,
 * il désigne un outil du catalogue. Ajouter ici un champ « commande » — même
 * par commodité — transformerait ce bouton en exécution de code à distance.
 *
 * Rend `202` : la ruche a TRANSMIS la demande. Ce que le nœud en fait arrive
 * ensuite, par le journal (`outil_pose_rendue`).
 */
export function poserOutilSurNoeud(
  nodeId: string,
  outilId: string,
): Promise<{ poseId: string; nodeId: string; outilId: string }> {
  return apiCompte<{ poseId: string; nodeId: string; outilId: string }>(
    `/api/nodes/${encodeURIComponent(nodeId)}/outils/${encodeURIComponent(outilId)}/poser`,
    { method: 'POST' },
  );
}

/** Ajoute un lot de tâches (DAG) à un projet. */
export function addTasks(projectId: string, tasks: NewTaskInput[]): Promise<Task[]> {
  return api<Task[]>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

export interface PlanResponse {
  tasks: NewTaskInput[];
  source: 'heuristic' | 'llm';
  note?: string;
  /**
   * La Balance (prévoir) : devis indicatif du DAG proposé. `undefined` sur un
   * orchestrateur plus ancien (la route ne le renvoyait pas), `null` quand
   * aucun domaine n'atteint l'échantillon minimal — les deux se lisent de la
   * même façon à l'affichage : SILENCE, jamais « 0 ».
   */
  devis?: DevisPlan | null;
}

/** Queen Bee : génère un DAG de tâches à partir d'un brief (Palier 2). */
export function planBrief(
  brief: string,
  mode: 'auto' | 'heuristic' | 'llm' = 'auto',
): Promise<PlanResponse> {
  return api<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify({ brief, mode }) });
}

/** Résultats (diff/logs) d'une tâche, pour revue humaine. */
export function fetchResults(taskId: string): Promise<TaskResult[]> {
  return api<TaskResult[]>(`/api/tasks/${taskId}/results`);
}

/** Graphe Hive réellement persisté pour le tiroir Mission Control. */
export interface DelegationGraphNode {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  depth: number;
  status: Task['status'];
  origine: 'hive' | 'native';
}

export interface DelegationRecord {
  childTaskId: string;
  parentTaskId: string;
  rootTaskId: string;
  depth: number;
  origine: 'hive' | 'native';
  durationMs: number;
  costMicros: number;
  resourceUnits: number;
  preferredAgent?: string | null;
  preferredModel?: string | null;
  title: string;
  prompt: string;
  createdAt: number;
}

export interface DelegationEvent {
  id: number;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface TaskDelegationGraph {
  taskId: string;
  rootTaskId: string;
  graph: DelegationGraphNode[];
  delegations: DelegationRecord[];
  events: DelegationEvent[];
}

/** Lecture authentifiée du graphe et de l’activité de délégation réelle. */
export function fetchDelegationGraph(taskId: string): Promise<TaskDelegationGraph> {
  return api<TaskDelegationGraph>(`/api/tasks/${encodeURIComponent(taskId)}/delegation`);
}

export interface Memory {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
  score: number | null;
}

/** Hive Mind : souvenirs pertinents (avec `q`) ou récents. */
export function fetchMemories(
  q?: string,
  limit = 8,
): Promise<{ total: number; memories: Memory[] }> {
  const query =
    q && q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=${limit}` : `?limit=${limit}`;
  return api<{ total: number; memories: Memory[] }>(`/api/hive-mind${query}`);
}

export interface Conflict {
  a: string;
  b: string;
  severity: 'high' | 'low';
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Sting Detector : conflits potentiels d'un projet. */
export function fetchConflicts(projectId: string): Promise<{ conflicts: Conflict[] }> {
  return api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`);
}

/** Annule une tâche (le nœud abandonne). */
export function cancelTask(taskId: string): Promise<Task> {
  return api<Task>(`/api/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' });
}

/**
 * Sandbox Live : suspendre / reprendre l'agent d'une tâche. La Reine ne fait
 * que TRANSMETTRE (202) : ce qui a vraiment eu lieu revient par l'état en
 * direct (`task_direct`, `enPause`) — jamais supposé depuis le clic.
 */
export function pauseTask(taskId: string, reprendre: boolean): Promise<{ transmis: true }> {
  const geste = reprendre ? 'resume' : 'pause';
  return api(`/api/tasks/${encodeURIComponent(taskId)}/${geste}`, { method: 'POST', body: '{}' });
}

/** Le diff d'une exécution EN COURS, demandé à l'ouvrière (borné, caviardé). */
export interface DiffDirect {
  taskId: string;
  nodeId: string;
  diff: string;
  tronque: boolean;
  erreur?: string;
}

export function fetchDiffDirect(taskId: string): Promise<DiffDirect> {
  return api<DiffDirect>(`/api/tasks/${encodeURIComponent(taskId)}/diff-direct`);
}

/** Drone Wars : course compétitive sur une tâche prête (2-5 nœuds, 1er succès gagne). */
export function raceTask(
  taskId: string,
  factor = 3,
): Promise<{ taskId: string; drones: string[] }> {
  return api<{ taskId: string; drones: string[] }>(`/api/tasks/${taskId}/race`, {
    method: 'POST',
    body: JSON.stringify({ factor }),
  });
}

export type { DroneRace } from '../../src/orchestrator/drone-wars';
import type { DroneRace } from '../../src/orchestrator/drone-wars';

/** Issue d'une course tranchée, reconstruite depuis le journal (drone_won). */
export interface RaceVictory {
  nodeId: string;
  cancelled: number;
}

/** Course en vol d'une tâche (null si aucune) + victoire passée éventuelle. */
export function fetchRace(
  taskId: string,
): Promise<{ race: DroneRace | null; victory?: RaceVictory | null }> {
  return api<{ race: DroneRace | null; victory?: RaceVictory | null }>(`/api/tasks/${taskId}/race`);
}

/** Toutes les courses en vol (Drone Wars) — pour le badge ⚔ de l'Essaim. */
export function fetchRaces(): Promise<{ races: DroneRace[] }> {
  return api<{ races: DroneRace[] }>('/api/races');
}

export interface InviteResponse {
  invite: string;
  url: string;
  label: string;
  joinCommand: string;
  /**
   * LA commande d'entrée, une par système — installe si besoin, puis rejoint.
   *
   * `joinCommand` suppose Hive déjà installé ET le terminal déjà dans le bon
   * dossier : deux choses qu'un invité n'a pas. Celles-ci ne demandent rien
   * d'autre que le billet, qui porte déjà l'adresse de la ruche.
   *
   * `null` si la ruche a refusé de composer la commande — un billet qui n'est
   * pas collable tel quel dans un shell n'est pas échappé, il est refusé.
   */
  entree?: { posix: string | null; windows: string | null };
  note: string;
  /** Présent quand la ruche n'écoute pas sur l'adresse annoncée (voir `shared/joignable`). */
  injoignable?: string;
}

/** Demande une invitation à l'orchestrateur (URL WS optionnelle à annoncer). */
export async function fetchInvite(url?: string): Promise<InviteResponse> {
  const query = url ? `?url=${encodeURIComponent(url)}` : '';
  return apiCompte<InviteResponse>(`/api/invite${query}`);
}

// ─── Mission Control : endpoints d'observation et d'action ──────────────────

export type { HivePulse } from '../../src/orchestrator/pulse';
export type { WaggleBoard, NodeNectar } from '../../src/orchestrator/waggle';
export type { Ghost, GhostReport } from '../../src/orchestrator/ghost';
export type { ReplayFrame, ReplayResult, TaskCounts } from '../../src/orchestrator/replay';
export type { ProjectReport } from '../../src/orchestrator/project-report';
export type { Faction, Verdict } from '../../src/orchestrator/parliament';
export type { MergeConflict, MergePlan } from '../../src/orchestrator/honeycomb';
export type { Domaine, TraceePheromone } from '../../src/orchestrator/pheromones';
export type { BandeThermo, LectureThermo } from '../../src/orchestrator/thermo';
export type { Compte, DecisionPlafond, Devis, Pesee, Poste } from '../../src/orchestrator/balance';
export type { WorkerSnapshot } from '../../src/orchestrator/workers';

import type { HivePulse } from '../../src/orchestrator/pulse';
import type { WaggleBoard } from '../../src/orchestrator/waggle';
import type { GhostReport } from '../../src/orchestrator/ghost';
import type { ReplayResult } from '../../src/orchestrator/replay';
import type { ProjectReport } from '../../src/orchestrator/project-report';
import type { Verdict } from '../../src/orchestrator/parliament';
import type { MergePlan } from '../../src/orchestrator/honeycomb';
import type { Domaine, TraceePheromone } from '../../src/orchestrator/pheromones';
import type { BandeThermo, LectureThermo } from '../../src/orchestrator/thermo';
import type { DecisionPlafond, Devis, Pesee } from '../../src/orchestrator/balance';

/** Hive Pulse : signes vitaux agrégés (débit, latences, taux de succès). */
export function fetchPulse(): Promise<HivePulse> {
  return api<HivePulse>('/api/pulse');
}

/** Waggle Board : classement de contribution des nœuds (nectar). */
export function fetchWaggle(): Promise<WaggleBoard> {
  return api<WaggleBoard>('/api/waggle');
}

/** Ghost in the Hive : anomalies détectées dans le journal. */
export function fetchGhosts(): Promise<GhostReport> {
  return api<GhostReport>('/api/ghost');
}

/**
 * Thermorégulation : `instantane` est la température lue dans la fenêtre de
 * 10 minutes, `applique` l'état HYSTÉRÉSÉ réellement en vigueur dans le
 * scheduler — les deux divergent le temps d'une confirmation, et c'est
 * exactement ce que l'opérateur doit voir. Deux noms pour deux sémantiques :
 * `bande` figurait auparavant des deux côtés avec deux sens différents.
 */
export interface ThermoState {
  instantane: LectureThermo;
  applique: { bande: BandeThermo; facteur: number };
}

/** Thermorégulation : température de la ruche et ventilation appliquée. */
export function fetchThermo(): Promise<ThermoState> {
  return api<ThermoState>('/api/thermo');
}

/**
 * Proposer une retouche : la modification part comme TÂCHE, jamais comme
 * écriture dans le miroir.
 *
 * Le Rayon est un clone jetable. Écrire dedans ferait croire à une correction
 * qui disparaîtrait au prochain rafraîchissement, sans rien dire.
 */
export function proposerRetouche(
  projectId: string,
  corps: { chemin: string; avant: string; apres: string; note?: string },
): Promise<{ task: { id: string; title: string } }> {
  return apiCompte(`/api/projects/${encodeURIComponent(projectId)}/rayon/retouche`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
}

/**
 * L'Aperçu — le site du projet, replié en UN document auto-suffisant.
 *
 * Ce document s'injecte dans une `<iframe sandbox>` SANS `allow-same-origin`.
 * Le serveur renvoie le `sandbox` attendu avec le document : le poser en dur
 * côté client laisserait les deux valeurs diverger sans que personne ne s'en
 * aperçoive, et c'est exactement l'attribut qu'il ne faut pas se tromper.
 */
export interface ApercuProjet {
  html: string;
  entree: string;
  inlines: string[];
  sandbox: string;
}

export function fetchApercu(projectId: string): Promise<ApercuProjet> {
  return apiLecture(`/api/projects/${encodeURIComponent(projectId)}/apercu`);
}

/**
 * Les Guetteuses — ce que la ruche a vu passer sur ses leurres.
 *
 * ─── POURQUOI CETTE FONCTION MANQUAIT, ET CE QUE ÇA COÛTAIT ─────────────────
 *
 * `GET /api/guet` existait côté serveur, et AUCUN écran ne l'appelait. Un
 * mécanisme de détection sans écran est pire qu'une absence de détection : on
 * croit surveillé ce qui ne l'est pas. Le seul signal qui sortait était une
 * ligne brute au journal — sans niveau, sans conseil, sans la liste de ce
 * qu'on avait cherché chez vous.
 */
export type NiveauGuet = 'calme' | 'reniflage' | 'balayage';

export interface VerdictGuet {
  niveau: NiveauGuet;
  passages: number;
  sources: number;
  appats: string[];
  conseil: string;
  /** Sans l'adresse de chaque passage : l'orchestrateur la garde pour lui (`/api/guet`). */
  derniers: { chemin: string; appat: string; quand: number }[];
}

export function fetchGuet(): Promise<VerdictGuet> {
  return api<VerdictGuet>('/api/guet');
}

/**
 * Les Gardiennes — le contrôle d'entrée du nectar.
 *
 * `GET /api/gardiennes` était servi et n'avait, lui non plus, aucun écran.
 * C'est pourtant une donnée de DÉCISION directe : savoir quel nœud rend des
 * diffs vides, ou annonce des fichiers qu'il ne touche pas, c'est savoir sur
 * qui compter. Sans écran, le seul moyen de l'apprendre était de lire le
 * journal ligne à ligne.
 */
export type VerdictGardienne = 'clean' | 'suspect' | 'hollow';

export interface VueGardiennes {
  version: number;
  inspections: number;
  verdicts: Record<VerdictGardienne, number>;
  /** Combien ont RÉELLEMENT été refusées (mode strict seulement). */
  refusees: number;
  griefs: { code: string; occurrences: number }[];
  recentes: {
    id: number;
    taskId: string;
    nodeId: string;
    verdict: VerdictGardienne;
    score: number;
    applique: boolean;
    griefs: { code: string; detail?: string }[];
    createdAt: number;
  }[];
  mode: 'off' | 'consultatif' | 'strict';
}

export function fetchGardiennes(): Promise<VueGardiennes> {
  return api<VueGardiennes>('/api/gardiennes');
}

/** Phéromones : affinité apprise nœud × domaine (30 meilleures traces). */
export function fetchPheromones(): Promise<{ traces: TraceePheromone[] }> {
  return api<{ traces: TraceePheromone[] }>('/api/pheromones');
}

/** Caste d'une ouvrière : nourrice (encadrée) → bâtisseuse → butineuse (relit). */
export type Caste = 'nourrice' | 'batisseuse' | 'butineuse';

export interface OuvrierePolyethisme {
  nodeId: string;
  name: string;
  agentType: string;
  caste: Caste;
  /** Productions observées : le dénominateur de tout le reste. */
  productions: number;
  /** Jugées creuses par les Gardiennes — le grief le plus lourd. */
  creuses: number;
  /** Jugées suspectes : signal réel, mais heuristique. */
  suspectes: number;
  /** Entre 0 et 1, déjà arrondie au centième côté serveur. */
  fiabilite: number;
}

/**
 * Le polyéthisme — chaque ouvrière au travail que son expérience permet.
 *
 * `mode` est celui qui S'APPLIQUE, `modeDemande` celui qu'on a réglé : les deux
 * diffèrent quand les Gardiennes sont éteintes, puisque sans source de qualité
 * aucune caste ne peut se gagner. Afficher le seul mode demandé laisserait
 * croire à un encadrement qui ne tourne pas.
 */
export interface VuePolyethisme {
  mode: 'off' | 'consignes' | 'strict';
  modeDemande: 'off' | 'consignes' | 'strict';
  /** Taille du corpus d'inspections sur lequel les castes sont calculées. */
  fenetre: number;
  seuils: { batisseuse: number; butineuse: number };
  noeuds: OuvrierePolyethisme[];
}

export function fetchPolyethisme(): Promise<VuePolyethisme> {
  return api<VuePolyethisme>('/api/polyethisme');
}

/**
 * La Balance — le pèse-ruche. Deux lectures de natures DIFFÉRENTES cohabitent
 * dans cette réponse, et l'affichage ne doit jamais les confondre :
 *  - `pesee` : l'imputation (utile / reprise / échec / rebuté), recalculée à la
 *    demande sur une FENÊTRE bornée (`fenetre` derniers résultats) ;
 *  - `soldes` : le grand livre, dépense TOTALE par projet depuis toujours —
 *    additive, jamais révisée. `aJour: false` ⇒ son rattrapage n'est pas fini
 *    et les soldes sont encore incomplets : c'est à montrer, pas à masquer.
 *
 * `mode: 'off'` ⇒ le grand livre ne tourne pas du tout : `soldes` reste vide et
 * `aJour` faux. Ce n'est pas une panne, et « 0 » serait un mensonge.
 *
 * L'unité est la SECONDE-OUVRIÈRE : du temps machine prêté par les membres,
 * jamais une somme d'argent — aucun tarif n'existe côté serveur (`enEuros` y
 * est une projection d'affichage qui exige un tarif fourni par l'appelant).
 */
export interface BalanceState {
  version: number;
  mode: 'off' | 'observation' | 'strict';
  aJour: boolean;
  pesee: Pesee;
  soldes: SoldeProjet[];
  /** Taille du corpus lu par l'imputation (CORPUS_BALANCE côté serveur). */
  fenetre: number;
}

/**
 * Le solde d'UN projet au grand livre : ce qu'il a dépensé, ET l'intention
 * humaine qui le borne. Forme LOCALE au serveur (le type vit inline dans
 * `Scheduler.balance`, il n'est exporté par aucun module pur) : on la
 * reconstruit ici depuis `DecisionPlafond`, exporté par balance.ts — même motif
 * que `DevisPlan`, pour que le typecheck du dashboard casse si le verdict bouge.
 *
 * `plafondMs` / `etat` / `bloque` sont OPTIONNELS, et seulement ici : le serveur
 * les envoie toujours, un orchestrateur d'AVANT le geste « borner » ne les
 * connaît pas. Absents ⇒ le dashboard se lit exactement comme avant, sans
 * inventer un « pas de plafond » qui serait une affirmation non vérifiée.
 *
 * Distinguer `etat` de `bloque` est essentiel et n'est pas un doublon :
 * `etat: 'bloque'` est le VERDICT (la dépense a rejoint le plafond), `bloque`
 * dit si l'assignation est RÉELLEMENT arrêtée — c'est-à-dire verdict `bloque`
 * ET ruche en mode `strict`. En `observation`, le premier est vrai et le second
 * faux : la ruche continue de butiner, et l'écran doit le dire.
 */
export interface SoldeProjet {
  projectId: string;
  depenseMs: number;
  tentatives: number;
  /** Plafond posé à la main, en ms. `null` = aucun plafond (l'état normal). */
  plafondMs?: number | null;
  etat?: DecisionPlafond;
  bloque?: boolean;
}

/**
 * La Balance d'UN projet — réponse de `GET` et de `PUT
 * /api/projects/:id/balance`. Elle ajoute au solde la TRACE du geste humain :
 * qui a posé le plafond (`definiPar`, un userId — jamais une autorisation, la
 * garde reste le token de ruche) et quand (`updatedAt`). Les deux valent `null`
 * quand aucun plafond n'est posé, ou quand il l'a été sans session identifiée.
 *
 * La route sert aussi `compte` (la tranche de pesée du projet) et `fenetre` :
 * la carte projet les tient déjà de `/api/balance`, qui couvre toute la ruche en
 * un seul relevé — inutile de les retyper pour les ignorer.
 */
export interface BalanceProjetState extends SoldeProjet {
  version: number;
  mode: BalanceState['mode'];
  aJour: boolean;
  definiPar?: string | null;
  updatedAt?: number | null;
}

/** La Balance d'un projet : son solde, son plafond, et qui l'a posé. */
export function fetchProjectBalance(projectId: string): Promise<BalanceProjetState> {
  return api<BalanceProjetState>(`/api/projects/${projectId}/balance`);
}

/**
 * Pose (ou retire, avec `null`) le plafond de dépense d'un projet.
 *
 * C'est le SEUL geste du dashboard qui peut arrêter la ruche pour cause
 * d'économie, et le seul qui peut la redémarrer : la ruche ne se ré-autorise
 * jamais elle-même à dépenser. `0` est licite et veut dire « ce projet ne
 * dépense plus rien » ; la borne haute est celle du schéma serveur, qui reste
 * l'autorité et refuse le reste avec un message lisible.
 */
export function setProjectPlafond(
  projectId: string,
  plafondMs: number | null,
): Promise<BalanceProjetState> {
  return api<BalanceProjetState>(`/api/projects/${projectId}/balance`, {
    method: 'PUT',
    body: JSON.stringify({ plafondMs }),
  });
}

/** La Balance : où est passé le temps-ouvrière emprunté par la ruche. */
// ─── Le Plein Essaim : l'autonomie d'un projet ──────────────────────────────

/** Un pas que la ruche prendrait maintenant. Miroir de `Pas` (essaim.ts). */
export type PasEssaim =
  | 'inerte'
  | 'halte'
  | 'plafond'
  | 'deliberer'
  | 'planifier'
  | 'butiner'
  | 'corriger'
  | 'livrer'
  | 'fusionner';

export type NiveauEssaim = 'off' | 'propose' | 'gouverne' | 'plein';

export interface LeconEssaim {
  signature: string;
  noeuds: number;
  taches: number;
  occurrences: number;
  portee: 'isolee' | 'confirmee' | 'systemique';
  confiance: number;
  extrait: string;
  vueA: number;
}

export interface IndicateurDerive {
  cle: 'qualite' | 'entropie' | 'repetition' | 'solitude';
  etat: 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';
  valeur: number;
  unite: 'points' | 'part' | 'jours';
  seuil: number;
  constat: string;
}

export interface DeriveUi {
  etat: 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';
  indicateurs: IndicateurDerive[];
  echantillon: number;
  solitudeJours: number;
  motif: string;
}

/**
 * Ce que le RUNNER fait de la décision — à ne pas confondre avec le verdict.
 *
 * OPTIONNEL : un orchestrateur d'avant le runner ne l'envoie pas. Absent, on
 * n'affiche rien plutôt que d'affirmer « éteint », ce qui serait une
 * information inventée.
 */
export interface RunnerUi {
  mode: 'off' | 'on';
  enPause: boolean;
  echecs: number;
  /** Fin du dernier cycle, ou `0` s'il n'a jamais tourné. */
  dernierTourA: number;
}

/** Checklist « prêt pour l'autonomie réelle » — calculée côté Queen. */
export interface PretEssaimUi {
  runner: boolean;
  gouvernantes: boolean;
  noeudsEnLigne: boolean;
  agentsReels: boolean;
  depot: boolean;
  derive: boolean;
  plafond: boolean;
  repo: boolean;
}

export interface CycleEssaimUi {
  ts: number;
  projectId?: string;
  pas?: string;
  motif?: string;
  issue?: string;
  detail?: string;
}

export interface EtatEssaimUi {
  niveau: NiveauEssaim;
  runner?: RunnerUi;
  pret?: PretEssaimUi;
  derive: DeriveUi;
  decision: { pas: PasEssaim; motif: string; gouvernantes: string[] };
  gouvernantes: Array<{ nodeId: string; nom: string }>;
  gouvernantesRequises: number;
  depotInscrit: boolean;
  plafond: 'passe' | 'alerte' | 'bloque';
  lecons: LeconEssaim[];
  niveaux: NiveauEssaim[];
}

export function fetchEssaim(projectId: string): Promise<EtatEssaimUi> {
  return api<EtatEssaimUi>(`/api/projects/${projectId}/essaim`);
}

/** Projection authentifiée des nœuds Worker et du vécu Aiguillage. */
export function fetchWorkers(): Promise<{ workers: WorkerSnapshot[] }> {
  return api<{ workers: WorkerSnapshot[] }>('/api/workers');
}

export function fetchEssaimCycles(
  projectId: string,
  limit = 12,
): Promise<{ cycles: CycleEssaimUi[] }> {
  return api(`/api/projects/${projectId}/essaim/cycles?limit=${limit}`);
}

/**
 * Règle l'autonomie. `depotInscrit` est l'autorisation de fusionner, donnée
 * une seule fois pour ce dépôt — distincte du niveau, et exigée avec lui.
 */
export function setEssaim(
  projectId: string,
  niveau: NiveauEssaim,
  depotInscrit: boolean,
): Promise<{ niveau: NiveauEssaim; depotInscrit: boolean }> {
  return api(`/api/projects/${projectId}/essaim`, {
    method: 'POST',
    body: JSON.stringify({ niveau, depotInscrit }),
  });
}

// ─── L'Agent Garde-Fous : le réglage appris du trou de vol d'un projet ──────

/** Un échelon de garde-fous. Miroir de `Echelon` (garde-fou.ts). */
export type EchelonUi = 'leger' | 'standard' | 'strict';

/** Une ligne du classement d'un échelon. Miroir de `RangGardeFou`. */
export interface RangGardeFouUi {
  echelon: EchelonUi;
  essais: number;
  moyenne: number;
  score: number;
}

/**
 * Ce que le GET `/garde-fou` rend : le CONSENTEMENT humain (opt-in + bornes) ET
 * ce que la ruche a appris (le classement des échelons permis, le premier est
 * l'élu). Miroir de la RÉPONSE du server, tenu à la main comme `EtatEssaimUi`.
 */
export interface EtatGardeFouUi {
  actif: boolean;
  bornes: { min: EchelonUi; max: EchelonUi } | null;
  definiPar: string | null;
  echelonElu: EchelonUi | null;
  classement: RangGardeFouUi[];
  echelons: EchelonUi[];
  reglages: Record<EchelonUi, { gardiennes: string; polyethisme: string }>;
}

export function fetchGardeFou(projectId: string): Promise<EtatGardeFouUi> {
  return api<EtatGardeFouUi>(`/api/projects/${projectId}/garde-fou`);
}

/**
 * Règle l'Agent Garde-Fous — geste HUMAIN. `actif` est l'opt-in ; `borneMin`/
 * `borneMax` bornent l'échelle dans laquelle la ruche a le droit d'élire (elle
 * n'élargit jamais sa propre latitude).
 */
export function reglerGardeFou(
  projectId: string,
  reglage: { actif: boolean; borneMin: EchelonUi; borneMax: EchelonUi },
): Promise<{
  actif: boolean;
  bornes: { min: EchelonUi; max: EchelonUi };
  echelonElu: EchelonUi | null;
}> {
  return api(`/api/projects/${projectId}/garde-fou`, {
    method: 'POST',
    body: JSON.stringify(reglage),
  });
}

export function fetchBalance(): Promise<BalanceState> {
  return api<BalanceState>('/api/balance');
}

/**
 * Devis d'un lot de tâches proposées, joint à `POST /api/plan` et à
 * `POST /api/projects/:id/brief`. Le serveur garde cette forme LOCALE (elle
 * n'est pas exportée par balance.ts) : on la reconstruit ici à partir des types
 * exportés du module pur, pour que le typecheck du dashboard casse si `Devis`
 * bouge.
 *
 * `totalP90Ms` est la SOMME des p90, pas le p90 de la somme : une borne
 * pessimiste qui suppose que toutes les tâches ont un mauvais jour en même
 * temps. Cette nuance doit rester visible à l'écran.
 */
export interface DevisPlan {
  parTache: Array<{ title: string; domaine: Domaine } & Devis>;
  totalMedianeMs: number;
  totalP90Ms: number;
}

/** Time-Lapse Replay : frise chronologique du journal. */
export function fetchReplay(since = 0): Promise<ReplayResult> {
  return api<ReplayResult>(`/api/replay?since=${since}`);
}

/**
 * Rapport d'avancement d'un projet.
 *
 * Passe par `apiLecture` : c'est l'acte `voir_avancement` du lien de partage,
 * déclaré depuis toujours et qu'aucune route n'utilisait — un lien « voir
 * l'avancement » ne montrait donc jamais d'avancement.
 */
export function fetchReport(projectId: string): Promise<ProjectReport> {
  return apiLecture<ProjectReport>(`/api/projects/${projectId}/report`);
}

/** Honeycomb Merge : plan d'intégration (advisory) d'un projet. */
export function fetchMergePlan(projectId: string): Promise<MergePlan> {
  return api<MergePlan>(`/api/projects/${projectId}/merge`);
}

export interface MergeRunStart {
  mergeId: string;
  nodeId: string;
  order: string[];
}

/**
 * Déclenche l'exécution réelle du merge sur un nœud (asynchrone).
 *
 * - `prepareCommand` : prépare l'environnement AVANT les tests (`npm ci`…).
 *   Sans elle, `npm test` sur un clone frais échoue faute de dépendances.
 * - `taskIds` : sélection de revue (Miellerie) — seules ces tâches sont
 *   intégrées.
 *
 * Un objet plutôt que des positions : trois options optionnelles à la suite,
 * c'est un `runMerge(id, undefined, undefined, x)` qui finit par se tromper de
 * rang un jour.
 */
export function runMerge(
  projectId: string,
  opts: { testCommand?: string[]; prepareCommand?: string[]; taskIds?: string[] } = {},
): Promise<MergeRunStart> {
  return api<MergeRunStart>(`/api/projects/${projectId}/merge/run`, {
    method: 'POST',
    body: JSON.stringify({
      ...(opts.prepareCommand?.length ? { prepareCommand: opts.prepareCommand } : {}),
      ...(opts.testCommand?.length ? { testCommand: opts.testCommand } : {}),
      ...(opts.taskIds?.length ? { taskIds: opts.taskIds } : {}),
    }),
  });
}

export interface MergeRunResult {
  mergeId: string;
  applied: string[];
  conflicts: { taskId: string; reason: string }[];
  mergedDiff: string;
  testsRun: boolean;
  testsPassed: boolean | null;
  /**
   * Verdict de la préparation : absent/`null` si aucune n'a été demandée.
   *
   * `false` veut dire que l'environnement ne s'est pas installé — et non que le
   * code est cassé. C'est pour ça qu'il est distinct de `testsPassed`.
   */
  preparedOk?: boolean | null;
  logs: string;
  /**
   * Présent quand le merge n'a PAS EU LIEU — refusé, clone impossible, nœud
   * perdu — et c'est sa raison. Sans lui, un échec se lisait « 0 diff(s)
   * appliqué(s), 0 conflit(s) » : un succès vide.
   */
  refused?: string;
  /** Ce qu'est devenue la livraison de mission demandée avec ce merge, s'il y en avait une. */
  livraison?: RapportLivraisonLocale;
}

/** Ce que la Reine rend quand une livraison de mission part vers une ouvrière. */
export interface DepartLivraison {
  mergeId: string;
  nodeId: string;
  /** Le nom de l'ouvrière — c'est chez elle que la branche sera rangée. */
  noeud: string;
  order: string[];
  pousser: boolean;
  /** Tâches que l'Evaluator arrêtait et qu'un forçage journalisé a laissé partir. */
  forcees: string[];
}

/**
 * Le refus d'une livraison, avec ce que l'écran doit pouvoir LIRE — pas
 * seulement afficher.
 *
 * `code` distingue « l'Evaluator arrête » (un forçage signé devient possible)
 * de « aucune ouvrière n'a consenti à pousser » ou « une livraison est déjà en
 * cours », où proposer de forcer n'aurait aucun sens. `bloquees` nomme les
 * tâches arrêtées et leur verdict.
 */
export class RefusLivraison extends ApiError {
  constructor(
    message: string,
    status: number,
    readonly code?: string,
    readonly bloquees: readonly { taskId: string; decision: string | null }[] = [],
  ) {
    super(message, status);
    this.name = 'RefusLivraison';
  }
}

/**
 * Livre la mission SANS GitHub : merge sur une ouvrière, puis commit sur
 * `hive/mission-<projectId>-<n>`. `pousser` : vers le dépôt du projet, avec
 * les identifiants git de l'ouvrière — si son opérateur y a consenti.
 *
 * Son propre `fetch` (avec `enTetesRuche`, qui porte aussi le compte : livrer
 * est un geste de propriétaire) : la réponse de refus se LIT — `code`,
 * `bloquees`, `conseil` —, ce que `api()` réduit à une phrase.
 */
export async function livrerLocalement(
  projectId: string,
  opts: {
    pousser?: boolean;
    testCommand?: string[];
    prepareCommand?: string[];
    forcer?: { raison: string };
  } = {},
): Promise<DepartLivraison> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/livraison-locale`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...enTetesRuche() },
    body: JSON.stringify({
      ...(opts.pousser ? { pousser: true } : {}),
      ...(opts.prepareCommand?.length ? { prepareCommand: opts.prepareCommand } : {}),
      ...(opts.testCommand?.length ? { testCommand: opts.testCommand } : {}),
      ...(opts.forcer ? { forcer: opts.forcer } : {}),
    }),
  });
  let corps: Record<string, unknown> = {};
  try {
    corps = (await res.json()) as Record<string, unknown>;
  } catch {
    /* corps non-JSON : le statut parlera seul */
  }
  if (!res.ok) {
    const texte = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const { message } = messageApi(
      {
        ...(texte(corps.error) ? { error: texte(corps.error) } : {}),
        ...(texte(corps.message) ? { message: texte(corps.message) } : {}),
        // Le `conseil` de la Reine EST la marche à suivre : on le montre.
        ...(texte(corps.conseil) ? { detail: texte(corps.conseil) } : {}),
      },
      res.status,
    );
    const bloquees = Array.isArray(corps.bloquees)
      ? (corps.bloquees as { taskId: string; decision: string | null }[])
      : [];
    throw new RefusLivraison(message, res.status, texte(corps.code), bloquees);
  }
  return corps as unknown as DepartLivraison;
}

/** Dernier résultat de merge d'un projet (null tant qu'aucun n'a abouti). */
export function fetchMergeResult(projectId: string): Promise<{ result: MergeRunResult | null }> {
  return api<{ result: MergeRunResult | null }>(`/api/projects/${projectId}/merge/result`);
}

/** Parlement des Agents : verdict de consensus sur les résultats d'une tâche. */
export function fetchConsensus(taskId: string): Promise<Verdict> {
  return api<Verdict>(`/api/tasks/${taskId}/consensus`);
}

/** Verdict indépendant : preuves Worker, Gardiennes, validations et relecture. */
export function fetchEvaluation(taskId: string): Promise<EvaluationResult> {
  return api<EvaluationResult>(`/api/tasks/${taskId}/evaluation`);
}

/**
 * Lit les contrôles GitHub de la PR rangée et les attache au résultat exact.
 * Le serveur vérifie la branche et le commit avant de persister la preuve.
 */
export function recordEvaluationCi(
  taskId: string,
  resultId: number,
): Promise<{
  taskId: string;
  resultId: number;
  validation: ValidationEvidence;
  provenance: ValidationProvenance;
  evaluation: EvaluationResult;
}> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/evaluation/ci`, {
    method: 'POST',
    body: JSON.stringify({ resultId }),
  });
}

export type ReviewVerdict = 'approved' | 'rejected';

/** Toutes les revues humaines (taskId → verdict), partagées entre opérateurs. */
export function fetchReviews(): Promise<{
  reviews: Record<string, ReviewVerdict>;
  updatedAt?: Record<string, number>;
}> {
  return api<{ reviews: Record<string, ReviewVerdict>; updatedAt?: Record<string, number> }>(
    '/api/reviews',
  );
}

/**
 * Enregistre (ou efface avec null) le verdict de revue d'une tâche.
 * `clientId` : identité d'onglet, échouée dans task_reviewed — permet de
 * distinguer nos propres échos WS de ceux des autres opérateurs.
 */
export function postReview(
  taskId: string,
  state: ReviewVerdict | null,
  clientId?: string,
  raison?: string,
): Promise<{ taskId: string; state: ReviewVerdict | null }> {
  return api<{ taskId: string; state: ReviewVerdict | null }>(`/api/tasks/${taskId}/review`, {
    method: 'POST',
    body: JSON.stringify({
      state,
      ...(clientId ? { clientId } : {}),
      // Jamais jointe à un effacement : le serveur la refuserait (400).
      ...(raison && state !== null ? { raison } : {}),
    }),
  });
}

/** La critique figée d'une correction (voir `blocCritique`, brood.ts). */
export interface CritiqueReprise {
  source: 'contre_revue' | 'revue_humaine' | 'evaluator';
  objections: string[];
  raisons: string[];
  noteHumaine?: string;
}

/**
 * Ce qu'une tâche a reçu comme critique : la raison du verdict humain courant
 * et la critique transmise aux reprises depuis la tentative `tentative` (la
 * première à l'avoir reçue ; les suivantes la gardent jusqu'à une nouvelle
 * correction).
 */
export function fetchCritique(taskId: string): Promise<{
  taskId: string;
  raisonRevue: string | null;
  reprise: { tentative: number | null; ts: number; critique: CritiqueReprise } | null;
}> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/critique`);
}

// ─── Comptes utilisateurs (JWT — indépendant du token de ruche) ──────────────
// Le token de ruche (x-hive-token) protège l'accès à l'orchestrateur ; le JWT
// identifie une PERSONNE (register/login). Le dashboard reste pleinement
// utilisable sans compte : la session ne fait qu'ajouter l'identité.

const JWT_KEY = 'hive.jwt';

export function getJwt(): string | null {
  return localStorage.getItem(JWT_KEY);
}

/**
 * Où est passé le temps d'une tâche : phases relues dans le journal (cf.
 * `src/shared/chronologie-tache.ts`) ; latence du modèle et coût fournisseur
 * « inconnu ».
 */
export function fetchChronologie(
  taskId: string,
): Promise<{ taskId: string; chronologie: ChronologieTache }> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/chronologie`);
}

/**
 * « Pourquoi ce Worker ? Pourquoi ce modèle ? » pour une tâche : les
 * affectations relues dans le journal (raison figée à la décision, jamais
 * recalculée — cf. `src/shared/routage-vue.ts`).
 */
export function fetchRoutage(
  taskId: string,
): Promise<{ taskId: string; affectations: AffectationVue[] }> {
  return api(`/api/tasks/${encodeURIComponent(taskId)}/routage`);
}

/**
 * Registre Genome : les faits de chaque modèle par catégorie, repliés du
 * journal retenu (cf. `src/shared/registre-genome.ts`). Aucune note, aucun
 * classement, coût fournisseur `inconnu`.
 */
export function fetchGenome(): Promise<RegistreGenome> {
  return api<RegistreGenome>('/api/genome');
}

/**
 * Les en-têtes qui disent « je suis de la ruche » : le jeton, et le compte s'il
 * y en a un. C'est l'identité que `api()` joint à CHAQUE appel ; elle est
 * exportée pour les rares appels qui gardent leur propre `fetch` (ils lisent
 * eux-mêmes la réponse) — sans elle, une route réservée répond 401 ou 404 et
 * le panneau croit à une panne.
 */
export function enTetesRuche(): Record<string, string> {
  const jwt = getJwt();
  return { 'x-hive-token': getToken(), ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) };
}

export function saveJwt(token: string): void {
  localStorage.setItem(JWT_KEY, token);
  // Une nouvelle session clôt l'expiration de la précédente.
  oublierSessionExpiree();
}

export function clearJwt(): void {
  localStorage.removeItem(JWT_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt?: number;
  /**
   * `admin` ou `membre`. OPTIONNEL : un orchestrateur d'avant les rôles ne le
   * renvoie pas. Absent ⇒ traité comme `membre` — le défaut sûr : au pire
   * l'écran d'intendance reste caché à quelqu'un qui y aurait droit, alors que
   * l'inverse afficherait des boutons que le serveur refusera de toute façon.
   */
  role?: Role;
}

export type { Role } from '../../src/orchestrator/comptes';
import type { Role } from '../../src/orchestrator/comptes';

/** L'appelant est-il administrateur ? Un `role` absent n'est jamais un oui. */
export function estAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin';
}

/** Une adhésion à un projet. `displayName` vient de la jointure sur les comptes. */
export interface MembreProjet {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName?: string;
}

export function fetchMembresProjet(projectId: string): Promise<MembreProjet[]> {
  return apiCompte<MembreProjet[]>(`/api/projects/${projectId}/members`);
}

/**
 * Se déclarer propriétaire d'un projet ORPHELIN.
 *
 * Un dépôt importé depuis GitHub n'a pas de propriétaire : l'import
 * s'authentifie par le jeton de ruche, qui n'est le compte de personne. Sans
 * adoption, il n'a personne pour y admettre des ouvrières.
 */
export function adopterProjet(projectId: string): Promise<{ adopted: boolean }> {
  return apiCompte<{ adopted: boolean }>(`/api/projects/${projectId}/adopter`, { method: 'POST' });
}

export function admettreMembre(
  projectId: string,
  userId: string,
): Promise<{ admitted: boolean; userId: string }> {
  return apiCompte<{ admitted: boolean; userId: string }>(`/api/projects/${projectId}/membres`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

// ─── Les liens de partage en lecture ────────────────────────────────────────

export interface LienPartage {
  id: string;
  label: string;
  creeA: number;
  expireA: number;
  revoqueA: number | null;
  vuA: number | null;
  /** Ni révoqué ni expiré — le seul champ qui décide de ce qu'on affiche. */
  vivant: boolean;
}

/**
 * Le lien fraîchement créé. `jeton` et `lien` ne sont rendus QU'ICI, une seule
 * fois : la liste ne les montrera jamais. C'est ce qui fait qu'un lien perdu se
 * remplace au lieu de se retrouver.
 */
export interface PartageCree {
  id: string;
  jeton: string;
  expireA: number;
  lien: string;
}

export function creerPartage(
  projectId: string,
  opts: { label?: string; ttlMs?: number } = {},
): Promise<PartageCree> {
  return apiCompte<PartageCree>(`/api/projects/${projectId}/partages`, {
    method: 'POST',
    body: JSON.stringify({
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.ttlMs ? { ttlMs: opts.ttlMs } : {}),
    }),
  });
}

export function fetchPartages(projectId: string): Promise<LienPartage[]> {
  return apiCompte<LienPartage[]>(`/api/projects/${projectId}/partages`);
}

export function revoquerPartage(projectId: string, partageId: string): Promise<{ ok: boolean }> {
  return apiCompte<{ ok: boolean }>(`/api/projects/${projectId}/partages/${partageId}`, {
    method: 'DELETE',
  });
}

export function retirerMembre(
  projectId: string,
  userId: string,
): Promise<{ removed: boolean; userId: string }> {
  return apiCompte<{ removed: boolean; userId: string }>(
    `/api/projects/${projectId}/membres/${userId}`,
    { method: 'DELETE' },
  );
}

export function authRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<{ token: string }> {
  return api<{ token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export function authLogin(email: string, password: string): Promise<{ token: string }> {
  return api<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Profil de la session courante. Un refus (401, ou 404 : compte disparu) purge
 * le JWT et prévient l'écran — c'est `api()` qui le fait, pour cet appel comme
 * pour les autres ; l'échec est alors une `SessionExpireeError`.
 */
export function authMe(): Promise<AuthUser> {
  return apiCompte<AuthUser>('/api/auth/me');
}

/**
 * Appel qui EXIGE le COMPTE, pas seulement la ruche.
 *
 * Le jeton de ruche est distribué à chaque nœud membre : s'en servir comme
 * preuve d'administration donnerait les pleins pouvoirs à toute machine qui
 * butine. Le serveur le refuse (401).
 *
 * `api()` joint désormais le JWT à tout appel : ce helper n'ajoute donc plus
 * d'en-tête. Il NOMME la porte au point d'appel — une route qu'aucun lien de
 * partage n'ouvre, et qui ne doit jamais glisser vers `apiLecture`. C'est ce
 * nom que `tests/partage-endpoint.test.ts` vérifie sur la retouche et les
 * liens.
 */
function apiCompte<T>(path: string, init?: RequestInit): Promise<T> {
  return api<T>(path, init);
}

/**
 * Appel de LECTURE : par le lien de partage s'il y en a un, par le compte sinon.
 *
 * ─── POURQUOI UN SEUL HELPER, ET PAS DEUX CHEMINS PARALLÈLES ────────────────
 *
 * Le serveur a exactement cette forme : `projetLisible()` accepte deux portes —
 * un compte qui a affaire au projet, ou un lien valide pour CE projet. Écrire
 * ici deux familles de fonctions (`fetchRayon` et `fetchRayonPartage`…)
 * donnerait deux listes à tenir d'accord, et c'est toujours celle qu'on oublie
 * qui décide. Une seule fonction, qui choisit son en-tête, ne peut pas diverger
 * d'elle-même.
 *
 * Ce helper n'est utilisé QUE par les lectures que le serveur a déclarées
 * accessibles à un lien. Un appel d'écriture qui passerait par ici recevrait
 * 401 côté serveur — la retouche, elle, exige un compte, et c'est le point.
 *
 * ─── AVEC UN LIEN, LE LIEN PART SEUL ────────────────────────────────────────
 *
 * Le JWT et le jeton de ruche vivent dans `localStorage`, commun à tous les
 * onglets ; le lien, dans l'onglet qui l'a ouvert. Le serveur essaie le lien
 * d'abord, puis une autre porte : le COMPTE pour les lectures du Rayon
 * (`projetLisible`), le JETON DE RUCHE pour le rapport d'avancement. Joindre
 * l'une ou l'autre au lien ferait qu'un lien révoqué ou expiré retomberait en
 * silence sur les droits de ce navigateur. L'hôte qui vérifie son propre lien
 * avant de l'envoyer le verrait s'ouvrir — alors que chez l'invité il ne mène
 * nulle part, et l'écran `Partage` ne dirait jamais « ce lien ne donne accès à
 * rien ». La vue du porteur ne demande rien d'autre au serveur : `main.tsx`
 * l'aiguille avant `App`, sans flux ni relevé à la ruche. C'est la seule
 * identité que `api()` ne choisit pas lui-même.
 */
function apiLecture<T>(path: string, init?: RequestInit): Promise<T> {
  const jeton = getPartage();
  if (!jeton) return api<T>(path, init);
  return api<T>(path, init, { 'x-hive-partage': jeton });
}

// ─── Les issues, et ce que devient le travail livré ─────────────────────────
//
// Les deux API existaient et rien ne les montrait. Un travail invisible est un
// travail qui n'a pas été fait, du point de vue de qui regarde l'écran.

export interface IssueVue {
  numero: number;
  titre: string;
  corps: string;
  etat: string;
  auteur: string;
  etiquettes: string[];
  htmlUrl: string;
  verrouillee: boolean;
  commentaires: number;
  majA: number;
}

/**
 * Les issues ouvertes du dépôt d'un projet.
 *
 * LECTURE PAYANTE : chaque appel consomme le quota GitHub de l'hôte. C'est
 * pour cela que le serveur la range parmi les ENGAGEMENTS (ADR 0007), et pour
 * cela que l'écran ne la sonde pas en boucle — elle se demande, elle ne se
 * surveille pas.
 */
export function fetchIssues(
  projectId: string,
): Promise<{ depot: string; issues: IssueVue[]; tronque: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/issues`);
}

/** Prend une issue : la ruche la découpe en tâches. */
export function prendreIssue(
  projectId: string,
  numero: number,
): Promise<{ issue: IssueVue; taches: { id: string; title: string }[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/issues/${numero}`, {
    method: 'POST',
  });
}

export interface LivraisonVue {
  taskId: string;
  depot: string;
  pr: number;
  branche: string;
  titre?: string;
  etat?: string;
  dit?: string;
  reprenable?: boolean;
  /** Présent quand la pull request n'a pas pu être lue — le dire vaut mieux. */
  illisible?: string;
}

/** Ce que deviennent les pull requests ouvertes par la ruche. */
export function fetchLivraisons(projectId: string): Promise<{ livraisons: LivraisonVue[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/livraisons`);
}

/** Reprend une livraison : la CI ou la revue redeviennent du travail. */
export function reprendreLivraison(
  projectId: string,
  taskId: string,
): Promise<{ tache: { id: string; title: string }; etat: string; dit: string }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/livraisons/${encodeURIComponent(taskId)}/reprendre`,
    { method: 'POST' },
  );
}

// ─── L'intendance : les serveurs et les membres ─────────────────────────────
// Réservée aux administrateurs. Cacher les boutons n'est PAS la sécurité — le
// serveur tranche seul, et un membre qui tape l'URL reçoit 403. Ce qui suit
// n'est qu'une manière de ne pas proposer des gestes voués à être refusés.

export type { EtatServeur } from '../../src/orchestrator/serveurs';
import type { EtatServeur, VueServeurs } from '../../src/orchestrator/serveurs';
import type { Serveur } from '../../src/orchestrator/serveurs';

/**
 * Un serveur tel que l'intendance le voit. Étend `Serveur` (le type du module
 * pur — le typecheck casse si un champ y bouge) de trois lectures calculées
 * côté serveur :
 *  - `projet` : le nom, parce qu'un identifiant ne dit pas ce qu'on éteint ;
 *  - `joursAvantSuppression` : `-1` quand la machine n'est pas concernée ;
 *  - `transitions` : les gestes que le serveur ACCEPTERA. L'écran n'en propose
 *    pas d'autres, et il ne recopie pas la matrice — elle dériverait.
 */
export interface ServeurAdmin extends Serveur {
  projet: string;
  joursAvantSuppression: number;
  transitions: EtatServeur[];
}

export interface IntendanceServeurs {
  vue: VueServeurs;
  serveurs: ServeurAdmin[];
  fournisseur: string;
  retentionJours: number;
  serveursMax: number;
}

export function fetchServeurs(): Promise<IntendanceServeurs> {
  return apiCompte<IntendanceServeurs>('/api/admin/serveurs');
}

/**
 * Change l'état d'une machine. `change: false` = l'état demandé était déjà le
 * sien (rejeu, double-clic) : ce n'est pas une erreur, et ça ne doit pas
 * s'afficher comme telle.
 */
export function setServeurEtat(
  id: string,
  etat: EtatServeur,
  motif?: string,
): Promise<{ id: string; etat: EtatServeur; change: boolean }> {
  return apiCompte(`/api/admin/serveurs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ etat, ...(motif ? { motif } : {}) }),
  });
}

// ─── Le Rayon : lire le code du projet ──────────────────────────────────────

export type { Entree as EntreeRayon } from '../../src/shared/rayon';
import type { Entree as EntreeRayon } from '../../src/shared/rayon';

export interface FichierRayon {
  chemin: string;
  contenu: string;
  langage: string;
  taille: number;
  tronque: boolean;
}

/**
 * Le contenu d'un dossier du rayon. `chemin` vide = la racine.
 *
 * Signé par le COMPTE : le serveur décide seul qui lit quel dépôt, et un jeton
 * de ruche — partagé avec chaque nœud — ne prouve rien à ce sujet.
 */
export function fetchRayon(
  projectId: string,
  chemin = '',
): Promise<{ chemin: string; entrees: EntreeRayon[] }> {
  const q = chemin === '' ? '' : `?chemin=${encodeURIComponent(chemin)}`;
  return apiLecture(`/api/projects/${encodeURIComponent(projectId)}/rayon${q}`);
}

export function fetchFichierRayon(projectId: string, chemin: string): Promise<FichierRayon> {
  return apiLecture(
    `/api/projects/${encodeURIComponent(projectId)}/rayon/fichier?chemin=${encodeURIComponent(chemin)}`,
  );
}

// ─── Timeline de sauvegardes (code récupérable) ──────────────────────────────
//
// Lecture via `apiLecture` (compte ou lien de partage « lire_code »). Écriture
// et restauration exigent un COMPTE : on ne laisse pas un porteur de lien
// ouvrir des tâches dans l'essaim de quelqu'un d'autre.

export type GenreSauvegardeUi = 'etape' | 'manuel' | 'avant_retouche';

export interface SauvegardeResumeUi {
  id: string;
  projectId: string;
  resultId: number | null;
  taskId: string | null;
  label: string;
  kind: GenreSauvegardeUi;
  taille: number;
  createdAt: number;
}

export interface SauvegardeUi extends Omit<SauvegardeResumeUi, 'taille'> {
  patch: string;
}

export function fetchSauvegardes(
  projectId: string,
  limit = 50,
): Promise<{ sauvegardes: SauvegardeResumeUi[] }> {
  return apiLecture(
    `/api/projects/${encodeURIComponent(projectId)}/sauvegardes?limit=${Math.min(200, Math.max(1, limit))}`,
  );
}

export function fetchSauvegarde(
  projectId: string,
  sauvegardeId: string,
): Promise<{ sauvegarde: SauvegardeUi }> {
  return apiLecture(
    `/api/projects/${encodeURIComponent(projectId)}/sauvegardes/${encodeURIComponent(sauvegardeId)}`,
  );
}

export function creerSauvegardeManuelle(
  projectId: string,
  corps: { label: string; patch?: string },
): Promise<{ sauvegarde: SauvegardeResumeUi }> {
  return apiCompte(`/api/projects/${encodeURIComponent(projectId)}/sauvegardes`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
}

/** Ouvre une tâche « Restaurer — … » ; jamais un rewrite silencieux du dépôt. */
export function restaurerSauvegarde(
  projectId: string,
  sauvegardeId: string,
): Promise<{ task: { id: string; title: string }; sauvegardeId: string }> {
  return apiCompte(
    `/api/projects/${encodeURIComponent(projectId)}/sauvegardes/${encodeURIComponent(sauvegardeId)}/restaurer`,
    { method: 'POST', body: '{}' },
  );
}

/**
 * Le billet de rattachement d'une machine — REMIS UNE SEULE FOIS.
 *
 * Il était auparavant lisible dans `motif`, en clair, durablement. Il vit
 * maintenant en mémoire côté hub et disparaît dès qu'on l'a lu : l'appelant
 * doit donc le GARDER, et l'écran doit le dire. Un second appel rend 404, ce
 * qui n'est pas une panne — c'est le contrat.
 */
export function billetServeur(id: string): Promise<{ billet: string; commande: string }> {
  return apiCompte(`/api/admin/serveurs/${encodeURIComponent(id)}/billet`);
}

export interface MembreAdmin {
  id: string;
  email: string;
  displayName: string;
  /**
   * `string`, et pas `Role` : la base rend ce qui y est rangé, et rien ne
   * garantit à la compilation que ce soit un rôle connu. `roleConnu` tranche à
   * l'affichage plutôt que de mentir dans le type.
   */
  role: string;
  createdAt: number;
}

/** Rôle sûr à afficher. Tout ce qui n'est pas reconnu retombe sur `membre`. */
export function roleConnu(brut: string): Role {
  return brut === 'admin' ? 'admin' : 'membre';
}

export interface IntendanceMembres {
  membres: MembreAdmin[];
  admins: number;
  inscription: { mode: ModeInscription; avertissement: string };
}

export type { ModeInscription } from '../../src/orchestrator/comptes';
import type { ModeInscription } from '../../src/orchestrator/comptes';

export function fetchMembres(): Promise<IntendanceMembres> {
  return apiCompte<IntendanceMembres>('/api/admin/membres');
}

export function setMembreRole(userId: string, role: Role): Promise<{ userId: string; role: Role }> {
  return apiCompte(`/api/admin/membres/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

// ─── Les CLÉS de la ruche — distinctes des comptes ──────────────────────────
//
// Ne pas confondre avec `/api/admin/membres`, qui liste les COMPTES. Ici ce
// sont les clés des MACHINES : une par nœud, plus les billets d'invitation qui
// servent à en obtenir une.
//
// Révoquer une clé compromise est l'archétype de la décision d'administration,
// et elle n'existait qu'en ligne de commande. Un tableau de bord qui montre le
// pouls, les anomalies et les castes, mais pas « qui a une clé de ma ruche »,
// ne permet pas de décider ce qui compte le jour où ça compte.

export interface CleNoeud {
  nodeId: string;
  label: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revoque: boolean;
}

export type EtatBillet = 'vivant' | 'revoque' | 'expire' | 'epuise';

export interface BilletRuche {
  id: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  usesLeft: number;
  usesTotal: number;
  etat: EtatBillet;
}

export interface ClesRuche {
  noeuds: CleNoeud[];
  billets: BilletRuche[];
}

export function fetchCles(): Promise<ClesRuche> {
  return apiCompte<ClesRuche>('/api/membres');
}

/** Exclure une machine. La révocation MORD tout de suite : le nœud est déconnecté. */
export function revoquerNoeud(nodeId: string): Promise<{ ok: boolean }> {
  return apiCompte<{ ok: boolean }>(`/api/membres/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });
}

/** Révoquer un billet : il ne sert plus à obtenir de clé, même s'il reste des usages. */
export function revoquerBillet(billetId: string): Promise<{ ok: boolean }> {
  return apiCompte<{ ok: boolean }>(`/api/billets/${encodeURIComponent(billetId)}`, {
    method: 'DELETE',
  });
}

// ─── Mon tableau de bord ────────────────────────────────────────────────────
// Un seul appel : l'écran doit pouvoir dire d'un bloc « voici ce qui va vous
// coûter quelque chose si vous ne faites rien ». Enchaîner une requête par
// projet ferait apparaître les alertes dans l'ordre des latences plutôt que
// dans celui de l'urgence.

export type { Gravite, ProjetRendu, Tableau } from '../../src/orchestrator/tableau';
import type { Alerte as AlerteServeur, Tableau } from '../../src/orchestrator/tableau';

/**
 * Une alerte TELLE QU'ELLE ARRIVE, `details` compris comme facultatif.
 *
 * Le type du serveur le déclare obligatoire, et il l'est — pour le serveur
 * d'aujourd'hui. Mais le dashboard est servi en fichiers statiques : un
 * navigateur qui a déjà le nouveau bundle peut très bien interroger un
 * orchestrateur qui n'a pas encore redémarré. Ce cas n'est pas théorique, il
 * s'est produit en développement, et il faisait planter la vue entière sur un
 * `a.details.serveur` — toute la page blanche pour une phrase manquante.
 *
 * Le type dit donc la vérité du CÂBLE, pas celle du serveur courant.
 */
export type Alerte = Omit<AlerteServeur, 'details'> & {
  details?: AlerteServeur['details'];
};

export interface MonTableau extends Omit<Tableau, 'alertes'> {
  alertes: Alerte[];
  /** `false` ⇒ le grand livre rattrape encore : les dépenses sont incomplètes. */
  balanceAJour: boolean;
  balanceMode: 'off' | 'observation' | 'strict';
}

export function fetchMonTableau(): Promise<MonTableau> {
  return apiCompte<MonTableau>('/api/moi/tableau');
}

export interface FeedHandlers {
  onState: (snapshot: StateSnapshot) => void;
  onEvent: (event: HiveEvent) => void;
  /** Un morceau de sortie en direct d'un agent (éphémère, jamais rejoué). */
  onSortie?: (taskId: string, nodeId: string, sortie: string) => void;
  /**
   * L'état en direct d'une exécution (Sandbox Live) ; `null` : elle est finie.
   * Rendu par la Reine à chaque (re)connexion — jamais rejoué du journal.
   */
  onDirect?: (taskId: string, direct: DirectTache | null) => void;
  /**
   * `connected` : le socket est ouvert **et** le hub a accepté le jeton.
   * `meta.authError` : fermeture 4401 « token invalide » — le champ Jeton ne
   * correspond pas à `HIVE_TOKEN` de l'orchestrateur.
   * `meta.tropLent` : fermeture `CODE_TABLEAU_TROP_LENT` — cet écran lisait
   * moins vite que la Reine n'écrivait ; il se reconnecte seul.
   */
  onStatus: (
    connected: boolean,
    meta?: { authError?: boolean; tropLent?: boolean; reason?: string },
  ) => void;
  /**
   * Le rattrapage a trouvé un TROU : `manquants` événements émis pendant la
   * coupure étaient déjà élagués par la Reine (elle ne garde que ses derniers
   * événements). Le trou ne se comble plus ; il se DIT, pour que le Journal ne
   * passe pas pour complet.
   */
  onJournalIncomplet?: (manquants: number) => void;
}

export interface HiveFeed {
  close(): void;
}

/**
 * Une page du journal, après l'événement `depuis`. 1000 est le plafond de la
 * route : une page pleine veut dire qu'il en reste peut-être d'autres.
 */
const PAGE_RATTRAPAGE = 1000;

/**
 * Ce qu'une page de rattrapage peut prendre. Sans borne, une lecture qui ne
 * revenait pas — un proxy qui garde la réponse, des connexions HTTP toutes
 * prises par d'autres longues requêtes — laissait l'écran « connecté », son
 * instantané à jour, et TOUT le direct retenu derrière elle : un Journal gelé
 * sans un mot. Au-delà, la lecture échoue et prend le chemin de tout échec de
 * rattrapage.
 */
const RATTRAPAGE_DELAI_MS = 30_000;

function fetchEvenementsDepuis(depuis: number, signal: AbortSignal): Promise<HiveEvent[]> {
  return api<HiveEvent[]>(`/api/events?since=${depuis}&limit=${PAGE_RATTRAPAGE}`, { signal });
}

/**
 * Connexion WebSocket auto-reconnectante au flux d'état de la ruche.
 *
 * ─── L'ÉTAT SE RESYNCHRONISAIT, LE JOURNAL NON ──────────────────────────────
 *
 * Chaque connexion commence par un instantané complet : l'état se rattrape
 * tout seul. Le journal, lui, ne se rattrapait pas — un événement émis pendant
 * une coupure (onglet en veille, Wi-Fi qui décroche, Reine redémarrée) n'était
 * jamais rejoué, et le Journal, les tiroirs et l'horloge des chantiers
 * racontaient une histoire trouée sans le savoir. La route `?since=` existait ;
 * personne ne l'appelait.
 *
 * Désormais chaque événement du journal est livré à `onEvent` UNE fois, dans
 * l'ordre de ses ids. À la reconnexion, le flux relit le journal depuis le
 * dernier événement livré ; le direct reçu pendant ce rattrapage attend son
 * tour. Le dédoublonnage tient sur UN nombre, `curseur`, parce que la Reine
 * journalise PUIS diffuse dans le même tour synchrone : les ids arrivent
 * croissants, et un id déjà dépassé a déjà été livré.
 *
 * Limite, DITE à l'écran : le journal ne garde que ses derniers événements
 * (`EVENT_RETENTION` côté Reine). Une coupure plus longue laisse un trou que
 * personne ne peut combler — mais qui se VOIT : les ids du journal se suivent
 * sans trou sauf là où la Reine a élagué, et le rattrapage le signale
 * (`onJournalIncomplet`) au lieu de présenter la fin comme toute l'histoire.
 */
export function connectFeed(handlers: FeedHandlers): HiveFeed {
  let ws: WebSocket | null = null;
  let closed = false;
  let retryMs = 1_000;
  let timer: number | undefined;
  /** Tant que le hub n'a pas renvoyé d'`state`, on n'est pas vraiment connecté. */
  let authentifie = false;
  /**
   * La connexion a SERVI : premier instantané reçu et journal rattrapé. Seule
   * une connexion saine ramène le recul à une seconde (voir `onclose`).
   */
  let sain = false;
  /**
   * Le dernier événement livré — ou, avant le tout premier, celui que reflétait
   * le premier instantané. `null` tant qu'aucune connexion n'a abouti.
   */
  let curseur: number | null = null;
  /** Le direct reçu PENDANT un rattrapage, livré après lui. `null` hors rattrapage. */
  let enAttente: HiveEvent[] | null = null;

  const livrer = (ev: HiveEvent): void => {
    // Le même événement peut venir du rattrapage ET du direct : une fois suffit.
    if (curseur !== null && ev.id <= curseur) return;
    curseur = ev.id;
    // Le curseur avance, mais ce que le direct ne porte jamais reste tu.
    if (!EVENEMENTS_NON_DIFFUSES.has(ev.type)) handlers.onEvent(ev);
  };

  const rattraper = async (socket: WebSocket, depuis: number): Promise<void> => {
    let apres = depuis;
    /** Le prochain id du journal : un id plus grand dit un trou élagué. */
    let attendu = depuis + 1;
    try {
      for (;;) {
        const ctrl = new AbortController();
        const butoir = window.setTimeout(() => ctrl.abort(), RATTRAPAGE_DELAI_MS);
        let page: HiveEvent[];
        try {
          page = await fetchEvenementsDepuis(apres, ctrl.signal);
        } finally {
          window.clearTimeout(butoir);
        }
        // Une autre connexion a pris la main, ou l'écran a fermé le flux.
        if (closed || socket !== ws) return;
        let manquants = 0;
        for (const ev of page) {
          if (ev.id > attendu) manquants += ev.id - attendu;
          attendu = ev.id + 1;
          livrer(ev);
        }
        if (manquants > 0) handlers.onJournalIncomplet?.(manquants);
        const fin = page.at(-1)?.id;
        // Une page qui n'avance pas arrête la boucle : sans ça, un serveur qui
        // ignorerait `since` la ferait tourner pour toujours.
        if (page.length < PAGE_RATTRAPAGE || fin === undefined || fin <= apres) break;
        apres = fin;
      }
    } catch {
      // Livrer le direct maintenant rendrait le trou définitif. On referme :
      // la reconnexion retentera depuis le même curseur — et comme cette
      // connexion n'a jamais été saine, son recul grandit à chaque échec.
      if (!closed && socket === ws) socket.close();
      return;
    }
    const direct = enAttente ?? [];
    enAttente = null;
    sain = true;
    for (const ev of direct) livrer(ev);
  };

  const open = (): void => {
    if (closed) return;
    authentifie = false;
    sain = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    ws = socket;

    socket.onopen = () => {
      // Pas encore `onStatus(true)` : le hub peut fermer en 4401 juste après
      // le `subscribe`. On attend le premier `state` (ou on signale l'échec).
      socket.send(JSON.stringify({ type: 'subscribe', token: getToken() }));
    };

    socket.onmessage = (e: MessageEvent) => {
      const msg = parseServerMessage(typeof e.data === 'string' ? e.data : '');
      if (!msg) return;
      if (msg.type === 'state') {
        if (!authentifie) {
          authentifie = true;
          handlers.onStatus(true);
          const reprise = msg.dernierEvenementId;
          if (curseur !== null && reprise > curseur) {
            // Le journal a avancé pendant la coupure : on relit ce qui manque.
            enAttente = [];
            void rattraper(socket, curseur);
          } else {
            // Premier contact — l'instantané est à jour, rien à relire — ou
            // journal reparti de zéro (base remplacée) : l'ancien curseur ne
            // désigne plus rien, et le garder ferait taire tout ce qui suit.
            curseur = reprise;
            sain = true;
          }
        }
        handlers.onState(msg.snapshot);
      } else if (msg.type === 'event') {
        if (enAttente) enAttente.push(msg.event);
        else livrer(msg.event);
      } else if (msg.type === 'task_output') {
        // Le direct n'est ni rangé ni rejoué (`task_output`) : il passe tout
        // de suite, rattrapage ou pas.
        handlers.onSortie?.(msg.taskId, msg.nodeId, msg.sortie);
      } else if (msg.type === 'task_direct') {
        // Comme la sortie : un état, pas une histoire — il passe tout de suite.
        handlers.onDirect?.(msg.taskId, msg.direct);
      }
    };

    socket.onclose = (ev: CloseEvent) => {
      // Le direct retenu est dans le journal : le prochain rattrapage le relira.
      enAttente = null;
      const authError = ev.code === 4401 || /token invalide/i.test(ev.reason ?? '');
      const tropLent = ev.code === CODE_TABLEAU_TROP_LENT;
      handlers.onStatus(false, {
        authError,
        ...(tropLent ? { tropLent } : {}),
        ...(ev.reason ? { reason: ev.reason } : {}),
      });
      if (closed) return;
      // ─── LE RECUL NE REPART D'UNE SECONDE QU'APRÈS UNE CONNEXION QUI A SERVI ─
      //
      // Remis à zéro à chaque OUVERTURE, il bouclait à 1 Hz sur un rattrapage
      // qui échoue toujours : chaque tour, un instantané complet, une relecture
      // de toutes les vues, un voyant qui clignote — et assez de requêtes pour
      // épuiser le quota REST de l'adresse, donc faire échouer le rattrapage
      // suivant. Un jeton refusé bouclait de même. Et un écran coupé pour
      // lenteur ne se reconnecte pas plus vite qu'il ne sait lire.
      if (sain && !tropLent) retryMs = 1_000;
      timer = window.setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 15_000);
    };
  };

  open();
  return {
    close(): void {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      ws?.close();
    },
  };
}

// ─── Rejoindre un projet ouvert ─────────────────────────────────────────────
//
// ─── LA PORTE QUI N'AVAIT PAS DE POIGNÉE ────────────────────────────────────
//
// `GET /api/projects/public`, `POST /api/projects/:id/join` et
// `GET /api/user/projects` existaient depuis longtemps. Le refus de `join` est
// soigneusement écrit — il prend la forme EXACTE de l'inexistence, pour qu'une
// liste d'identifiants ne dessine pas la carte des projets privés de la ruche —
// et sa garde `peutRejoindre` est un module pur bien testé.
//
// **Aucun écran ne les appelait.** Ni la CLI. Sur une plateforme
// d'orchestration COMMUNAUTAIRE, « découvrir un projet ouvert et le rejoindre »
// est le parcours qui donne son sens au reste, et il avait un serveur sans
// porte. C'est le même défaut que `POST /api/projects/user` quelques centaines
// de lignes plus haut : le défaut n'est dans aucune route, il est dans ce que
// rien ne fait.

import type { ProjetPublic as ProjetPublicVue } from '../../src/shared/projet-public';
import type { AffectationVue } from '../../src/shared/routage-vue';
import type { ChronologieTache } from '../../src/shared/chronologie-tache';
import type { RegistreGenome } from '../../src/shared/registre-genome';
export type { ProjetPublic as ProjetPublicVue } from '../../src/shared/projet-public';

/**
 * Le catalogue des projets ouverts. SANS authentification — c'est voulu.
 *
 * La réponse est la projection `vuePublique`, jamais la ligne de base : ni
 * `repoUrl` porteur d'identifiants, ni `ownerId` qui désignerait une cible.
 */
export function fetchProjetsOuverts(): Promise<ProjetPublicVue[]> {
  return api<ProjetPublicVue[]>('/api/projects/public');
}

/**
 * Rejoindre un projet ouvert. Exige un COMPTE — le jeton de ruche ne dit pas
 * qui vous êtes, et on ne peut pas inscrire « le jeton » comme membre.
 *
 * Un refus arrive en 404, indistinguable d'un projet qui n'existe pas. C'est
 * délibéré côté serveur, et l'appelant NE DOIT PAS le retraduire en « vous
 * n'avez pas le droit » : ce serait reconstruire l'information que le serveur
 * a tue.
 */
export function rejoindreProjet(projectId: string): Promise<{ joined: boolean }> {
  return apiCompte<{ joined: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/join`, {
    method: 'POST',
  });
}

// ─── Le Cerveau, vu comme un graphe ─────────────────────────────────────────
//
// Les types sont RÉUTILISÉS depuis le module partagé plutôt que recopiés ici :
// un graphe redéclaré côté navigateur dérive du serveur au premier champ
// ajouté, et c'est le genre d'écart qui ne se voit qu'à l'écran.

export type { Graphe, NoeudGraphe, AreteGraphe } from '../../src/shared/cerveau-graphe.js';

/** Le graphe, plus le dossier d'où il sort (utile quand il est vide). */
export type CerveauGraphe = Graphe & { dossier: string };

export function fetchCerveau(): Promise<CerveauGraphe> {
  return apiCompte<CerveauGraphe>('/api/admin/cerveau');
}

// ─── Les Chantiers et les workflows ─────────────────────────────────────────
//
// Les types viennent des modules partagés, pas d'une redéclaration : un
// `Chantier` recopié ici dériverait du serveur au premier champ ajouté, et
// c'est l'écart qui ne se voit qu'à l'écran.

export type { Chantier, Nature } from '../../src/shared/chantier.js';
export type { RunWorkflow, Workflow } from '../../src/shared/workflow.js';

import type { Chantier } from '../../src/shared/chantier.js';
import type { RunWorkflow, Workflow } from '../../src/shared/workflow.js';

/** Ce qu'un nœud a rapporté du dernier chantier lancé. */
export interface VerdictChantier {
  nom: string;
  code: number | null;
  sortie: string;
  ok: boolean;
  refused?: string;
}

export function fetchChantiers(projectId: string): Promise<{ chantiers: Chantier[] }> {
  return api<{ chantiers: Chantier[] }>(`/api/projects/${encodeURIComponent(projectId)}/chantiers`);
}

export function fetchVerdictChantier(
  projectId: string,
): Promise<{ resultat: VerdictChantier | null }> {
  return api<{ resultat: VerdictChantier | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/chantiers/result`,
  );
}

export function lancerChantier(
  projectId: string,
  nom: string,
): Promise<{ chantierId: string; nodeId: string; nom: string }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/chantiers/${encodeURIComponent(nom)}/run`,
    { method: 'POST', body: '{}' },
  );
}

export function fetchWorkflows(
  projectId: string,
): Promise<{ workflows: Workflow[]; tronque: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows`);
}

export function fetchRuns(projectId: string): Promise<{ runs: RunWorkflow[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows/runs`);
}

/**
 * Lance un workflow. L'identifiant est un NOMBRE — jamais un nom de fichier.
 *
 * Le typage porte la règle : `POST …/actions/workflows/{id_ou_nom}/dispatches`
 * accepte les deux côté GitHub, et accepter le nom laisserait écrire un
 * morceau d'URL de son API. Ici, on ne peut pas s'y tromper.
 */
export function lancerWorkflowGithub(
  projectId: string,
  workflowId: number,
  ref: string,
): Promise<{ workflow: Workflow; ref: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows/${String(workflowId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}

export interface EtatAtelier {
  mode: 'off' | 'auto' | 'on';
  actif: boolean;
  ecran: string;
  cdp: string;
  outil: string;
  raison?: string;
}

export function fetchAtelier(): Promise<EtatAtelier> {
  return api<EtatAtelier>('/api/atelier');
}

export function demarrerAtelier(): Promise<{ ok: boolean; plan?: string[] }> {
  return apiCompte('/api/atelier/demarrer', { method: 'POST', body: '{}' });
}

export function arreterAtelier(): Promise<{ ok: boolean }> {
  return apiCompte('/api/atelier/arreter', { method: 'POST', body: '{}' });
}

/** Réponse de `GET /api/chambre/:nodeId` — absences = null / [] (pas de théâtre). */
export interface ChambrePoste {
  nodeId: string;
  bapteme: { nom: string; baptiseA: number } | null;
  metier: { metier: string; assigneA: number } | null;
  caste: string;
  /** Projet dominant (dernière tâche) — pour horizon / fabrique. */
  projectId?: string | null;
  node: {
    id: string;
    status: string;
    plateforme: string | null;
    agentType: string;
    ownerName: string;
    running: number;
    maxConcurrency: number;
    lastSeen: number | null;
    nameTechnique: string;
  };
  presences: Array<{
    toolUseId: string;
    chemin: string;
    outil: string;
    taskId: string | null;
    constateA: number;
  }>;
  tasks: Task[];
  /** Fenêtre durable relue par le serveur ; absent sur un hub plus ancien. */
  journal?: JournalOuvriere[];
  requisitions?: RequisitionPoste[];
  horizon?: {
    faits: Array<{ id: string; texte: string; source: string; creeA: number }>;
    hypotheses: Array<{ id: string; texte: string; source: string; creeA: number }>;
  } | null;
  fabriques?: Array<{
    id: string;
    genre: string;
    libelle: string;
    nomScript: string | null;
    statut: string;
    creeA: number;
  }>;
  atelier: EtatAtelier;
}

export function fetchChambre(nodeId: string): Promise<ChambrePoste> {
  return api<ChambrePoste>(`/api/chambre/${encodeURIComponent(nodeId)}`);
}

/** Curseur Rayon — présence + baptême (null = silence, pas de prénom inventé). */
export interface PresenceCurseur {
  nodeId: string;
  bapteme: string | null;
  chemin: string;
  outil: string;
  toolUseId: string;
  taskId: string | null;
  constateA: number;
}

/** Jeton de ruche seulement — pas via partage. */
export function fetchPresences(): Promise<{ presences: PresenceCurseur[] }> {
  return api<{ presences: PresenceCurseur[] }>('/api/presences');
}

/** Baptêmes constatés — jeton de ruche seulement (pas via partage). */
export function fetchBaptemes(): Promise<{
  baptemes: Array<{ nodeId: string; nom: string; baptiseA: number }>;
}> {
  return api('/api/baptemes');
}

export function baptiserOuvriere(
  nodeId: string,
  nom: string,
): Promise<{ ok: boolean; nom: string }> {
  return apiCompte('/api/baptemes', {
    method: 'POST',
    body: JSON.stringify({ nodeId, nom }),
  });
}

export function debaptiserOuvriere(nodeId: string): Promise<{ ok: boolean }> {
  return apiCompte(`/api/baptemes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
}

export function assignerMetierOuvriere(
  nodeId: string,
  metier: string,
): Promise<{ ok: boolean; metier: string }> {
  return apiCompte('/api/metiers', {
    method: 'POST',
    body: JSON.stringify({ nodeId, metier }),
  });
}

export interface RequisitionPoste {
  id: string;
  nodeId: string;
  genre: string;
  libelle: string;
  detail: string | null;
  statut: 'ouverte' | 'accordee' | 'refusee';
  creeA: number;
  closA: number | null;
  bapteme?: string | null;
}

export function fetchRequisitions(opts?: {
  nodeId?: string;
  statut?: string;
}): Promise<{ requisitions: RequisitionPoste[] }> {
  const q = new URLSearchParams();
  if (opts?.nodeId) q.set('nodeId', opts.nodeId);
  if (opts?.statut) q.set('statut', opts.statut);
  const s = q.toString();
  return api(`/api/requisitions${s ? `?${s}` : ''}`);
}

export function repondreRequisition(
  id: string,
  decision: 'accordee' | 'refusee',
  opts?: { secret?: string; envVar?: string },
): Promise<{ ok: boolean; statut: string; envVar?: string }> {
  return apiCompte(`/api/requisitions/${encodeURIComponent(id)}/repondre`, {
    method: 'POST',
    body: JSON.stringify({
      decision,
      ...(opts?.secret ? { secret: opts.secret } : {}),
      ...(opts?.envVar ? { envVar: opts.envVar } : {}),
    }),
  });
}

export interface FournisseurCleApi {
  id: string;
  libelleFr: string;
  libelleEn: string;
  envVar: string;
  hintFr: string;
  hintEn: string;
}

export function fetchQueenCles(): Promise<{
  fournisseurs: FournisseurCleApi[];
  presence: Array<{ id: string; envVar: string; presente: boolean }>;
}> {
  return api('/api/queen/cles');
}

export function poserQueenCle(body: {
  secret: string;
  envVar: string;
  libelle?: string;
}): Promise<{ ok: boolean; envVar: string }> {
  return apiCompte('/api/queen/cles', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface MotifCatalogue {
  id: string;
  domaine: string;
  libelleFr: string;
  libelleEn: string;
  etapes: Array<{ id: string; titreFr: string; titreEn: string }>;
}

export function fetchMotifs(): Promise<{ motifs: MotifCatalogue[] }> {
  return api('/api/motifs');
}

export function appliquerMotif(
  projectId: string,
  motifId: string,
  opts?: { lang?: 'fr' | 'en' },
): Promise<{ ok: boolean; motifId: string; taskIds: string[]; titres: string[] }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/motifs/${encodeURIComponent(motifId)}/appliquer`,
    {
      method: 'POST',
      body: JSON.stringify({ lang: opts?.lang ?? 'fr' }),
    },
  );
}

export interface MotifPerso {
  id: string;
  libelle: string;
  etapes: string[];
  creeA: number;
}

export function fetchMotifsPerso(projectId: string): Promise<{ motifs: MotifPerso[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/motifs/perso`);
}

export function creerMotifPerso(
  projectId: string,
  body: { libelle: string; etapes: string[] },
): Promise<{ ok: boolean; id: string; libelle: string; etapes: string[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/motifs/perso`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function appliquerMotifPerso(
  projectId: string,
  motifId: string,
): Promise<{ ok: boolean; motifId: string; taskIds: string[]; titres: string[] }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/motifs/perso/${encodeURIComponent(motifId)}/appliquer`,
    { method: 'POST', body: '{}' },
  );
}

export function ouvrirFabrique(
  projectId: string,
  body: {
    genre: string;
    libelle: string;
    nomScript?: string;
    nodeId?: string;
    creerTache?: boolean;
  },
): Promise<{ ok: boolean; id: string; taskId?: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/fabriques`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function poserStatutFabrique(
  projectId: string,
  fabriqueId: string,
  statut: 'en_revue' | 'mergee' | 'refusee',
): Promise<{ ok: boolean; statut: string }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/fabriques/${encodeURIComponent(fabriqueId)}/statut`,
    { method: 'POST', body: JSON.stringify({ statut }) },
  );
}

export function jugerFabriqueChantier(
  projectId: string,
  nomScript: string,
): Promise<{ ok: boolean; motif?: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/fabriques/juger-chantier`, {
    method: 'POST',
    body: JSON.stringify({ nomScript }),
  });
}

export function ajouterHorizon(
  projectId: string,
  kind: 'fait' | 'hypothese',
  texte: string,
): Promise<{ ok: boolean; entree: { id: string; kind: string; texte: string } }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/horizon`, {
    method: 'POST',
    body: JSON.stringify({ kind, texte, source: 'chambre' }),
  });
}
