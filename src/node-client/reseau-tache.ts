// Le réseau d'UNE tâche, du côté du nœud : ouvrir son proxy, masquer ses
// identifiants, dire ce qui a été refusé — ou dire, en clair, pourquoi elle
// tourne sans filtre.
//
// ─── LES TROIS ISSUES, ET AUCUNE N'EST MUETTE ────────────────────────────────
//
//   · `filtre` — le bac du nœud sait filtrer (sondé au démarrage,
//     `sonderReseauFiltre`) et le projet n'est pas `ouvert` : la tâche a son
//     proxy, ses leurres, sa liste blanche. Chaque refus part au journal de la
//     tâche au moment où il arrive, et le bilan précède ses logs.
//   · `libre` — le projet est `ouvert`, ou le nœud ne sait pas filtrer (sandbox
//     de processus, moteur dans une VM). La tâche tourne comme avant, et
//     `note` le DIT dans son journal : un réseau non filtré n'est jamais tu.
//   · `impossible` — le nœud sait filtrer, le projet le demande, et le proxy ne
//     s'ouvre pas. La tâche NE TOURNE PAS sans filtre : le nœud la refuse avec
//     ce motif (un autre nœud peut réussir), jamais il ne la lance ouverte.
//
// `HIVE_ISOLEMENT=exige` va plus loin (`refusExige`) : le membre a exigé un
// réseau filtré ; un projet `ouvert` n'y tourne pas, et un nœud qui ne sait
// pas filtrer ne démarre même pas (`preparerBac`).

import { rmSync } from 'node:fs';
import type { NiveauReseau } from '../shared/reseau.js';
import { estAgentType } from './agent-detect.js';
import type { ReseauBac } from './isolement.js';
import {
  PORT_RELAIS,
  PREFIXE_PASSERELLE,
  ecrireRelais,
  masquerIdentifiants,
  ouvrirSessionReseau,
} from './proxy-egress.js';
import type { Passerelle, RefusReseau } from './proxy-egress.js';
import { PASSERELLES, politiqueTache } from './politique-reseau.js';
import type { ReservationPont } from './rendez-vous-pont.js';

/** Ce que le nœud sait de son réseau, décidé une fois au démarrage (`bac.ts`). */
export interface CapaciteReseau {
  /** Le bac filtre-t-il le réseau ? Mesuré, jamais supposé. */
  filtre: boolean;
  /** `HIVE_ISOLEMENT=exige` : un réseau non filtré est refusé. */
  exige: boolean;
  /** Ce que la sonde a dit — cité quand le réseau n'est pas filtré. */
  motif: string;
}

export type ReseauTache =
  | {
      etat: 'filtre';
      reseau: ReseauBac;
      /** L'environnement de l'agent, identifiants remplacés par des leurres. */
      env: NodeJS.ProcessEnv;
      note: string;
      refus: () => RefusReseau[];
      fermer: () => Promise<void>;
    }
  | { etat: 'libre'; env: NodeJS.ProcessEnv; note: string | null; fermer: () => Promise<void> }
  | { etat: 'impossible'; motif: string };

/** L'adresse du proxy dans le bac, que le relais y écoute. */
const PROXY = `http://127.0.0.1:${PORT_RELAIS}`;

/**
 * Ce que les outils du bac lisent pour trouver le proxy. Les deux casses : curl
 * et Python lisent les minuscules, Go et npm les majuscules. `NODE_USE_ENV_PROXY`
 * fait suivre le proxy au `fetch` de Node (24+). La boucle reste directe : c'est
 * là qu'écoutent le relais et les passerelles.
 */
function variablesProxy(): Record<string, string> {
  const variables: Record<string, string> = { NODE_USE_ENV_PROXY: '1' };
  for (const nom of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    variables[nom] = PROXY;
    variables[nom.toLowerCase()] = PROXY;
  }
  variables.NO_PROXY = 'localhost,127.0.0.1,::1';
  variables.no_proxy = variables.NO_PROXY;
  return variables;
}

/** Le refus d'un nœud `exige` pour un projet `ouvert`, ou `null`. */
export function refusExige(niveau: NiveauReseau, capacite?: CapaciteReseau): string | null {
  if (!capacite?.exige || niveau !== 'ouvert') return null;
  return 'réseau ouvert refusé : ce nœud exige un réseau filtré (HIVE_ISOLEMENT=exige)';
}

export async function ouvrirReseauTache(opts: {
  niveau: NiveauReseau;
  /** Absent : le nœud n'a pas de bac (sandbox de processus). */
  capacite?: CapaciteReseau;
  agent: string;
  repoUrl: string | null;
  cwd: string;
  /** L'environnement épuré de la tâche, VRAIS identifiants compris. */
  env: NodeJS.ProcessEnv;
  /** L'environnement du nœud : une base d'API qu'y pose le membre reste l'amont. */
  envHote?: NodeJS.ProcessEnv;
  reservation: ReservationPont;
  surRefus: (refus: RefusReseau) => void;
}): Promise<ReseauTache> {
  const rien = async (): Promise<void> => {};
  if (opts.niveau === 'ouvert') {
    return { etat: 'libre', env: opts.env, note: null, fermer: rien };
  }
  if (!opts.capacite?.filtre) {
    const pourquoi = opts.capacite ? opts.capacite.motif : 'ce nœud n’a pas de bac à sable';
    return {
      etat: 'libre',
      env: opts.env,
      note: `[hive] réseau NON filtré (niveau « ${opts.niveau} » demandé) : ${pourquoi}.`,
      fermer: rien,
    };
  }

  const agent = estAgentType(opts.agent) ? opts.agent : 'custom';
  let dossier: string | null = null;
  try {
    const emplacement = opts.reservation.reserver();
    dossier = emplacement.dossier;
    ecrireRelais(dossier);
    const politique = politiqueTache({
      niveau: opts.niveau,
      agent,
      repoUrl: opts.repoUrl,
      cwd: opts.cwd,
    });
    const declaree = PASSERELLES[agent];
    const masque = declaree
      ? masquerIdentifiants(opts.env, declaree.identifiants)
      : { env: opts.env, substitutions: [] };
    const passerelles: Passerelle[] = declaree
      ? [
          {
            nom: declaree.nom,
            amont: new URL(declaree.amont(opts.envHote ?? process.env)),
            substitutions: masque.substitutions,
          },
        ]
      : [];
    const variables = variablesProxy();
    if (declaree) variables[declaree.variable] = `${PROXY}${PREFIXE_PASSERELLE}${declaree.nom}`;
    // Claude Code se tait vers ses services annexes (télémétrie, rapports) :
    // hors de la liste blanche, ils ne feraient que des refus au journal.
    if (agent === 'claude-code') variables.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';

    const session = await ouvrirSessionReseau({
      socket: emplacement.extremite,
      politique: { niveau: politique.niveau, hotes: politique.hotes, passerelles },
      surRefus: opts.surRefus,
    });
    const aEffacer = dossier;
    return {
      etat: 'filtre',
      reseau: {
        dossier,
        socket: emplacement.extremite,
        interprete: process.execPath,
        variables,
      },
      env: masque.env,
      note:
        `[hive] réseau filtré (niveau « ${politique.niveau} ») : ` +
        `${politique.hotes.length > 0 ? politique.hotes.join(', ') : 'aucun hôte'}` +
        (declaree ? ` ; identifiants ${declaree.nom} remplacés par des leurres dans le bac` : '') +
        '.',
      refus: session.refus,
      fermer: async () => {
        await session.fermer();
        rmSync(aEffacer, { recursive: true, force: true });
      },
    };
  } catch (err) {
    if (dossier) rmSync(dossier, { recursive: true, force: true });
    return {
      etat: 'impossible',
      motif: `réseau filtré impossible : ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** L'hôte que la porte de sécurité interroge (osv-scanner) — le SEUL que son réseau joint. */
export const HOTE_OSV = 'api.osv.dev';

export type ReseauPorte =
  | { etat: 'filtre'; reseau: ReseauBac; fermer: () => Promise<void> }
  | { etat: 'impossible'; motif: string };

/**
 * Le réseau de LA PORTE DE SÉCURITÉ (G10), à elle — jamais celui de la tâche.
 *
 * La porte lit ce que la production ajoute, mais n'est pas la production : la
 * liste blanche du projet ne lui sert à rien, et ses refus n'ont rien à faire
 * au bilan de la tâche, qui les imputerait au producteur. Sa session ne joint
 * qu'`api.osv.dev:443` — l'interrogation d'osv-scanner, derrière le relais du
 * bac comme celle d'un agent ; ses passes hors ligne, elles, tournent réseau
 * COUPÉ (`BacExecution.reseauCoupe`). Chaque refus va à `surRefus`, et à lui
 * seul. Seulement sur un nœud dont le bac filtre : ailleurs, la porte garde
 * le réseau de l'hôte, comme la tâche.
 */
export async function ouvrirReseauPorte(opts: {
  reservation: ReservationPont;
  surRefus?: (refus: RefusReseau) => void;
}): Promise<ReseauPorte> {
  let dossier: string | null = null;
  try {
    const emplacement = opts.reservation.reserver();
    dossier = emplacement.dossier;
    ecrireRelais(dossier);
    const session = await ouvrirSessionReseau({
      socket: emplacement.extremite,
      politique: { niveau: 'integrations', hotes: [HOTE_OSV], ports: [443], passerelles: [] },
      ...(opts.surRefus ? { surRefus: opts.surRefus } : {}),
    });
    const aEffacer = dossier;
    return {
      etat: 'filtre',
      reseau: {
        dossier,
        socket: emplacement.extremite,
        interprete: process.execPath,
        variables: variablesProxy(),
      },
      fermer: async () => {
        await session.fermer();
        rmSync(aEffacer, { recursive: true, force: true });
      },
    };
  } catch (err) {
    if (dossier) rmSync(dossier, { recursive: true, force: true });
    return {
      etat: 'impossible',
      motif: `réseau de la porte impossible : ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Le bilan des refus d'une tâche, en tête de ses logs — `null` s'il n'y en a pas. */
export function bilanRefus(refus: readonly RefusReseau[]): string | null {
  if (refus.length === 0) return null;
  const lignes = refus.map(
    (r) => `  · ${r.hote}:${r.port}${r.fois > 1 ? ` (×${r.fois})` : ''} — ${r.motif}`,
  );
  return `[hive] réseau : ${refus.length} destination(s) refusée(s) par le proxy du nœud\n${lignes.join('\n')}`;
}
