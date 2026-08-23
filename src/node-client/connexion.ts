// Croiser le BINAIRE et la CLÉ — ce que personne ne faisait.
//
// ─── LE DÉFAUT, DIT PAR L'UTILISATEUR ────────────────────────────────────────
//
// « mets un bouton pour connecter automatiquement Claude ou autre s'ils ne sont
// pas trouvés par la ruche », puis « le secret pour se connecter
// automatiquement, le secret qu'il y a dans .env ».
//
// Les deux phrases nomment ensemble un défaut réel. `detectAllAgents` cherche
// un BINAIRE. `requisitionSiCredentialsManquantes` cherche une CLÉ. Les deux
// fonctions existaient, aucune ne parlait à l'autre — et le cas qui tombe entre
// les deux est précisément le plus fréquent chez qui débute : la clé est dans
// le `.env`, la ligne de commande n'est pas installée. Le nœud meurt alors
// (`main.ts`, `process.exit(2)`) sur un message générique, la ruche affiche
// « 0 nœud actif », et rien ne dit qu'il ne manquait qu'un `npm install`.
//
// Ce fichier ne fait que la COMPOSITION : il interroge les deux sources et
// passe le résultat à `connexion-agent.ts`, qui juge. Il ne lit jamais la
// VALEUR d'une clé — seulement sa présence.

import {
  detectAllAgents,
  requisitionSiCredentialsManquantes,
  type AgentType,
} from './agent-detect.js';
import { estAgentSimule } from '../shared/agent-production.js';
import { juger, type EtatAgent } from '../shared/connexion-agent.js';
import { libelleAgent } from '../shared/agent-libelle.js';

/** Les agents qu'on interroge. `shell` et `custom` n'ont ni binaire à installer
 *  ni clé à porter : les inclure ne produirait que du bruit. */
const INTERROGES: readonly AgentType[] = ['claude-code', 'cursor', 'codex', 'grok'];

export interface OutilsConnexion {
  /** Les agents dont le BINAIRE a été trouvé sur ce poste. */
  agentsPresents?: () => Promise<AgentType[]>;
  /** L'environnement où chercher les clés — `.env` est déjà chargé dedans. */
  env?: NodeJS.ProcessEnv;
  existe?: (chemin: string) => boolean;
  plateforme?: string;
}

/**
 * L'état de chaque agent connu : binaire, clé, et ce que la ruche peut poser.
 *
 * Trié : ce qui est prêt d'abord, puis ce qui se répare seul, puis le reste.
 * Ordre TOTAL (le rang, puis le nom) — deux appels sur le même poste rendent la
 * même liste, ce qui rend l'affichage et les bancs reproductibles.
 */
export async function diagnostiquerAgents(outils: OutilsConnexion = {}): Promise<EtatAgent[]> {
  const env = outils.env ?? process.env;
  const presents = new Set(await (outils.agentsPresents ?? (() => detectAllAgents(env)))());
  const etats = INTERROGES.map((agent) =>
    juger({
      agent,
      binaire: presents.has(agent),
      // `null` = rien ne manque, donc la clé (ou la session locale) est là.
      cle:
        requisitionSiCredentialsManquantes(agent, env, {
          ...(outils.existe ? { existe: outils.existe } : {}),
          ...(outils.plateforme ? { plateforme: outils.plateforme } : {}),
        }) === null,
    }),
  );
  const rang = (e: EtatAgent): number =>
    e.verdict === 'pret' ? 0 : e.poseAutomatique ? 1 : e.verdict === 'binaire_manquant' ? 2 : 3;
  return etats.sort((a, b) => rang(a) - rang(b) || a.agent.localeCompare(b.agent));
}

/**
 * Le conseil à imprimer quand aucun agent réel ne répond — `null` s'il n'y a
 * rien d'utile à dire.
 *
 * Il ne propose QUE ce qui est vrai. Un poste sans clé ne se voit pas promettre
 * une installation qui ne servirait à rien : installer la ligne de commande de
 * Claude sans identifiants donne un binaire qui refuse de travailler, et
 * l'utilisateur aurait suivi le conseil pour rien.
 */
export function conseilDemarrage(
  etats: readonly EtatAgent[],
  lang: 'fr' | 'en' = 'fr',
): string | null {
  const posable = etats.find((e) => e.poseAutomatique);
  if (!posable) return null;
  const nom = libelleAgent(posable.agent, lang === 'en');
  const commande = posable.installation!.join(' ');
  return lang === 'en'
    ? `The key for ${nom} is already here — only its CLI is missing.\n  One command fixes it:  ${commande}`
    : `La clé de ${nom} est déjà là — il ne manque que sa ligne de commande.\n  Une seule commande suffit :  ${commande}`;
}

/** Un agent réel est-il utilisable MAINTENANT sur ce poste ? */
export function unAgentEstPret(etats: readonly EtatAgent[]): boolean {
  return etats.some((e) => e.verdict === 'pret' && !estAgentSimule(e.agent));
}
