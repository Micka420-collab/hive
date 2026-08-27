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
  AGENTS_A_IDENTIFIANTS_CONNUS,
  detectAllAgents,
  requisitionSiCredentialsManquantes,
  type AgentType,
} from './agent-detect.js';
import { estAgentSimule } from '../shared/agent-production.js';
import { juger, type EtatAgent, type EtatCle } from '../shared/connexion-agent.js';
import { libelleAgent } from '../shared/agent-libelle.js';
import type { OutilConstate } from '../shared/protocol.js';

/** Les agents qu'on interroge. `shell` et `custom` n'ont ni binaire à installer
 *  ni clé à porter : les inclure ne produirait que du bruit. */
const INTERROGES: readonly AgentType[] = ['claude-code', 'cursor', 'cline', 'codex', 'grok'];

export interface OutilsConnexion {
  /** Les agents dont le BINAIRE a été trouvé sur ce poste. */
  agentsPresents?: () => Promise<AgentType[]>;
  /** L'environnement où chercher les clés — `.env` est déjà chargé dedans. */
  env?: NodeJS.ProcessEnv;
  existe?: (chemin: string) => boolean;
  plateforme?: string;
}

/**
 * Ce que la ruche peut CONSTATER des identifiants d'un agent.
 *
 * ─── LE PIÈGE QUE CETTE FONCTION ÉVITE ──────────────────────────────────────
 *
 * `requisitionSiCredentialsManquantes` rend `null` pour tout agent qu'elle ne
 * connaît pas, et `null` veut dire « rien ne manque ». Lu naïvement, c'est
 * indiscernable de « la clé est là ».
 *
 * La première version de ce module faisait exactement cette lecture. En
 * ajoutant Cline — qui range ses identifiants dans SA propre configuration de
 * fournisseur, que Hive n'a aucun moyen documenté de lire — elle aurait annoncé
 * sa clé présente, puis proposé une installation automatique sur la foi d'une
 * clé jamais vue.
 *
 * On ne demande donc son avis à la fonction QUE pour les agents dont elle a une
 * branche à elle. Pour les autres, la seule réponse honnête est « inconnue ».
 */
function etatCle(agent: AgentType, env: NodeJS.ProcessEnv, outils: OutilsConnexion): EtatCle {
  if (!AGENTS_A_IDENTIFIANTS_CONNUS.includes(agent)) return 'inconnue';
  const manque = requisitionSiCredentialsManquantes(agent, env, {
    ...(outils.existe ? { existe: outils.existe } : {}),
    ...(outils.plateforme ? { plateforme: outils.plateforme } : {}),
  });
  return manque === null ? 'presente' : 'absente';
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
      cle: etatCle(agent, env, outils),
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
  // loupe : équivalent — `lang === 'en'` muté en `lang !== 'en'` ne change RIEN,
  // et c'est mesuré, pas supposé. Seuls les agents du catalogue `PAQUETS`
  // atteignent cette ligne (c'est `poseAutomatique` qui l'exige), et leurs
  // libellés sont des NOMS DE MARQUE, identiques dans les deux langues :
  //
  //     claude-code   fr="Claude Code"   en="Claude Code"
  //     codex         fr="Codex"         en="Codex"
  //
  // L'argument reste POSÉ malgré tout : le jour où le catalogue accueille un
  // agent dont le nom se traduit, le retirer serait un défaut. Et pour que ce
  // jour-là ne passe pas en silence, `connexion-noeud.test.ts` tient que TOUT
  // agent de `PAQUETS` porte un libellé indépendant de la langue — l'ajout
  // d'un nom traduisible fait rougir ce banc-là, pas celui-ci.
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

/**
 * Les constats à envoyer au hub à l'inscription.
 *
 * On ne transmet que ce que le nœud a CONSTATÉ : le binaire est-il là, la clé
 * est-elle lisible. Ni le verdict, ni la commande d'installation, ni le
 * `poseAutomatique` ne partent — ce sont des CONCLUSIONS, et une conclusion
 * transportée est une conclusion qui dérive : le jour où la règle change d'un
 * côté, l'autre continue d'afficher l'ancienne.
 *
 * Le hub rejuge donc à partir des mêmes constats, avec la MÊME fonction
 * (`juger`, dans le module pur partagé). C'est aussi ce que le validateur du
 * protocole impose : il reconstruit ces trois champs et refuse le reste.
 */
export function constatsPourLeHub(etats: readonly EtatAgent[]): OutilConstate[] {
  return etats.map((e) => ({ agent: e.agent, binaire: e.binaire, cle: e.cle }));
}
