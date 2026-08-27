// Point d'entrée d'un nœud membre : `npm run node`.
// Configuration par variables d'environnement (voir .env.example).
// Le membre garde le contrôle : rien ne s'exécute sans lancer ce client.

import os from 'node:os';
import path from 'node:path';
import { bornerConcurrence, identiteStable } from './identite-noeud.js';
import { agentCredentialEnv, detectAllAgents, messageAgent } from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { resoudreAgentAuDemarrage } from './choisir-agent.js';
import { resoudreModelesAuDemarrage } from './choisir-modele.js';
import { libelleAgent } from '../shared/agent-libelle.js';
import { demarrageNoeudAutorise, messageRefusShellProduction } from '../shared/agent-production.js';
import { conseilDemarrage, constatsPourLeHub, diagnostiquerAgents } from './connexion.js';
import { entreeEnRuche } from '../shared/presence-noeud.js';
import { HiveNodeClient } from './client.js';
import { optionBac, preparerBac } from './bac.js';
import { inventorierModelesLocaux } from './modeles-locaux.js';
import { ecrirePreferencesIA, lirePreferencesIA } from './preferences-ia.js';
import { createInterface } from 'node:readline/promises';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : les valeurs par défaut / variables d'environnement s'appliquent.
}

// La MÊME borne que l'autre porte (`join.ts`). Elle existait déjà et disait
// pourquoi : un `NaN` propagé jusqu'à la boucle de travail donnerait un nœud
// connecté qui n'accepte jamais rien, et l'invité verrait « ✔ Nœud démarré »
// sans qu'il ne se passe jamais rien. Cette porte-ci ne l'avait jamais reçue.
const maxConcurrency = bornerConcurrence(process.env.HIVE_MAX_CONCURRENCY);

// L'agent réel doit retrouver sa config/clé API dans la sandbox ; on fusionne
// avec un éventuel HIVE_KEEP_ENV explicite. Le shell simulé ne reçoit rien.
const extraKeep = (process.env.HIVE_KEEP_ENV ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const name = process.env.HIVE_NODE_NAME ?? os.hostname();
const workRoot =
  process.env.HIVE_WORKDIR ?? path.join('.hive-work', name.replace(/[^A-Za-z0-9_-]+/g, '_'));
const reconfigurerIA = process.argv.includes('--configurer-ia');
const preferencesIA = lirePreferencesIA(workRoot);

// ─── L'isolement ───────────────────────────────────────────────────────────
//
// Décidé, annoncé et appliqué par `bac.ts`, qui sert AUSSI à `join.ts`. Le
// code vivait ici seul, et `join.ts` — le chemin des amis — n'en avait aucune
// copie : un nœud rejoint tournait toujours sans conteneur.
const bac = await preparerBac();
for (const l of bac.lignes) console.log(l);

if (bac.refuse) {
  console.error('✘ Ce nœud ne démarre pas.\n');
  // `bac.codeSortie`, jamais un `1` écrit à la main : un refus de sécurité a
  // son propre code, et c'est ce qui permet à un superviseur de s'arrêter au
  // lieu de relancer sans fin une machine qui ne pourra jamais travailler.
  process.exit(bac.codeSortie);
}

// ─── QUEL AGENT, ET POURQUOI CE N'EST PLUS « shell » PAR DÉFAUT ─────────────
//
// Cette ligne disait : `const agentType = process.env.HIVE_AGENT ?? 'shell'`.
//
// Conséquence mesurée : sur la machine de celui qui INSTALLE la ruche — donc
// le cas de tout le monde au premier essai — `npm run node` tournait en
// SIMULÉ. L'installeur n'écrit pas `HIVE_AGENT` dans `.env` ; rien ne venait
// donc jamais le mettre à autre chose, et un Claude Code parfaitement
// installé n'était jamais utilisé. La ruche avait l'air de travailler et
// rendait de faux diffs.
//
// Le plus révélateur : `join.ts` — le chemin de l'AMI qu'on invite — détecte
// automatiquement depuis toujours. L'invité avait donc un vrai agent, et
// l'hôte un simulacre. Exactement l'inverse de ce qu'on attend.
//
// La détection vient APRÈS le bac à sable : un nœud que l'isolement refuse
// n'a pas à sonder quoi que ce soit, et l'humain lit d'abord ce qui l'arrête.
//
// `HIVE_AGENT` garde le dernier mot. S'il est absent et que PLUSIEURS agents
// réels sont là (Claude, Cursor, Codex…), on DEMANDE lequel retenir — sauf
// hors TTY, où l'ordre de préférence de `detectBestAgent` s'applique.
const interactif = Boolean(
  process.stdin.isTTY && (process.stdout.isTTY || process.env.HIVE_TTY_ASSISTE === '1'),
);
const demanderChoix = interactif
  ? async (question: string): Promise<string> => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    }
  : undefined;

const tousAgents = await detectAllAgents();
const preferenceAgentApplicable = Boolean(
  !reconfigurerIA && preferencesIA && tousAgents.includes(preferencesIA.agent),
);
if (
  preferencesIA &&
  !tousAgents.includes(preferencesIA.agent) &&
  !(process.env.HIVE_AGENT ?? '').trim()
) {
  console.log(
    `   ⚠ Préférence ${libelleAgent(preferencesIA.agent)} ignorée : application absente de ce poste.`,
  );
}
const detecte = await resoudreAgentAuDemarrage({
  agentsDetectes: tousAgents,
  ...(preferencesIA ? { preferenceAgent: preferencesIA.agent } : {}),
  reconfigurer: reconfigurerIA,
  stdinEstTty: interactif,
  demander: demanderChoix,
});
const agentType: AgentType = detecte.agent;
const candidatsModeles = inventorierModelesLocaux(agentType);
const modelesDeclares = await resoudreModelesAuDemarrage({
  agent: agentType,
  candidats: candidatsModeles,
  stdinEstTty: interactif,
  demander: demanderChoix,
  reconfigurer: reconfigurerIA,
  ...(preferencesIA?.agent === agentType ? { preference: preferencesIA.modeles } : {}),
});

if (
  interactif &&
  agentType !== 'shell' &&
  !(process.env.HIVE_AGENT ?? '').trim() &&
  !(process.env.HIVE_MODELES ?? '').trim() &&
  (reconfigurerIA || !preferenceAgentApplicable)
) {
  const fichier = ecrirePreferencesIA(workRoot, {
    version: 1,
    agent: agentType,
    modeles: modelesDeclares ?? null,
  });
  console.log(`   ✓ Choix mémorisé dans ${fichier}. Reconfigurer : npm run configurer:ia\n`);
}

// Le diagnostic croisé, fait UNE fois : il sonde le PATH et l'environnement,
// et deux sondages successifs coûteraient deux fois pour la même réponse. Il
// sert ensuite à deux choses très différentes — le conseil au refus juste en
// dessous, et le constat envoyé au hub à l'inscription.
const etatsOutils = await diagnostiquerAgents();

// ─── PRÉSENCE SANS PRODUCTION ───────────────────────────────────────────────
//
// Ici, ce nœud faisait `process.exit(2)`. Il imprimait un bon conseil dans un
// terminal qu'on referme, et le tableau de bord ne montrait RIEN — pas
// « machine sans outil », rien du tout, ce qui se lit « personne n'a essayé ».
// C'était le tout premier lancement de quelqu'un qui débute, et le moment où la
// ruche était la plus muette.
//
// Il REJOINT désormais la ruche, et n'y travaille pas. La fiche de l'ouvrière
// dira ce que porte sa machine et ce qui lui manque, avec la commande exacte.
//
// Deux gardes tiennent la promesse « n'y travaille pas », une de chaque côté :
// le hub n'assigne pas (`assignationProductionAutorisee`, désormais sur les
// DEUX voies), et le nœud refuse s'il est tout de même sollicité
// (`presenceSeule` plus bas). Une seule suffirait tant que l'autre côté est
// correct — c'est précisément pourquoi il en faut deux.
const entree = entreeEnRuche({
  agentReel: demarrageNoeudAutorise(agentType),
  // `demarrageNoeudAutorise` rend déjà `true` quand la simulation est voulue :
  // la question est donc déjà tranchée par lui, et la repasser ici en ferait
  // une seconde source de vérité. On lui laisse le dernier mot.
  simulationVoulue: false,
});

if (entree.mode === 'presence') {
  console.error(`✘ ${messageRefusShellProduction('fr')}\n`);
  // Le message ci-dessus est le même pour tout le monde. Or les postes ne sont
  // pas dans le même état : celui qui porte DÉJÀ sa clé dans `.env` n'a qu'un
  // paquet à installer, et rien ne le lui disait.
  //
  // `conseilDemarrage` ne parle QUE si c'est vrai : pas de clé, pas de
  // conseil — installer une ligne de commande sans identifiants donne un agent
  // qui refuse de travailler, et l'utilisateur aurait suivi le conseil pour
  // rien.
  const conseil = conseilDemarrage(etatsOutils);
  if (conseil) console.error(`${conseil}\n`);
  console.error(`${entree.motif ?? ''}\n`);
}

console.log(`   Agents détectés : ${tousAgents.map((a) => libelleAgent(a)).join(', ')}`);
console.log(`   Agent utilisé   : ${detecte.label}`);
console.log(
  `   Modèle(s)       : ${modelesDeclares?.join(', ') ?? 'automatique (choix de l’application)'}`,
);
// Le dire ICI, et pas seulement dans `hive doctor` : personne ne lance le
// docteur avant de voir sa ruche « travailler ». Un simulacre silencieux
// coûte une soirée à qui croit que ça tourne.
//
// Le CHOIX de la phrase vit dans `messageAgent`, pur et éprouvé : la loupe a
// montré qu'ici, inversé, rien ne rougissait.
const aDire = messageAgent(agentType, tousAgents);
if (aDire) console.log(aDire);

const variables = [...new Set([...agentCredentialEnv(agentType), ...extraKeep])];

// L'identité survit au redémarrage — même mécanisme que `join.ts`
// (`identite-noeud.ts`). Sans elle, chaque lancement de `npm run node`
// mintait un nouvel id et laissait le précédent affiché « hors ligne »
// pour toujours dans le dashboard : un fantôme par redémarrage.
const nodeId = identiteStable(workRoot);

const client = new HiveNodeClient({
  url: process.env.HIVE_URL ?? 'ws://localhost:7777/ws',
  token: process.env.HIVE_TOKEN ?? 'change-me',
  name,
  ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
  agentType,
  maxConcurrency: Number.isInteger(maxConcurrency) ? Math.min(Math.max(maxConcurrency, 1), 16) : 2,
  workRoot,
  nodeId,
  keepEnv: variables,
  // Les modèles que l'opérateur déclare (HIVE_MODELES), pour l'Aiguillage appris.
  ...(modelesDeclares ? { modeles: modelesDeclares } : {}),
  ...optionBac(bac, variables),
  // La seconde garde. `presenceSeule` n'est POSÉ que dans ce mode : un nœud de
  // production ne porte pas le champ du tout, et ne peut donc pas se le voir
  // basculer par accident.
  ...(entree.mode === 'presence' ? { presenceSeule: true } : {}),
});

// ─── CE QUE LE NŒUD A VU, LE HUB DOIT L'APPRENDRE ───────────────────────────
//
// `setOutilsConstates` existait déjà, avec son champ de protocole, son
// validateur et ses bancs — et PERSONNE ne l'appelait. Un demi-câblage : le
// message savait porter les constats, le nœud n'en mettait jamais dedans, et
// le tableau de bord affichait donc une ruche sans outils sur des machines qui
// en portaient quatre.
//
// L'appel se fait AVANT `start()` : le register part à la première connexion,
// et des constats posés après seraient arrivés au deuxième essai — c'est-à-dire
// jamais, sur un réseau qui marche.
client.setOutilsConstates(constatsPourLeHub(etatsOutils));

client.start();
console.log(
  entree.mode === 'presence'
    ? '🐝 Nœud Hive présent — visible dans la ruche, mais SANS produire. Ctrl+C pour quitter.'
    : '🐝 Nœud Hive démarré — Ctrl+C pour quitter la ruche.',
);

process.on('SIGINT', () => {
  client.stop();
  process.exit(0);
});

// Dernier recours : un imprévu ne doit pas tuer le nœud en silence et perdre la
// reconnexion. On journalise et on laisse le client continuer/reconnecter.
process.on('uncaughtException', (err) => {
  console.error('[hive] exception non catchée (nœud) :', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[hive] rejet de promesse non géré (nœud) :', reason);
});
