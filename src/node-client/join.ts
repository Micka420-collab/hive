// `npm run join <invitation>` — la façon la plus simple de rejoindre une ruche.
//
// Un ami reçoit une invitation (une longue chaîne « hive1_… »). Il lance :
//     npm run join -- hive1_eyJ2Ijox...
// et c'est tout : le token et l'URL sont dans l'invitation, son agent IA
// (Claude Code / Codex) est détecté automatiquement, son identité de nœud est
// mémorisée pour les reconnexions. Aucun fichier de config à éditer.
//
// Sans argument, l'invitation est demandée de façon interactive.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { agentCredentialEnv, detectAllAgents, detectBestAgent } from './agent-detect.js';
import { optionBac, preparerBac } from './bac.js';
import type { AgentType } from './agent-detect.js';
import { HiveNodeClient } from './client.js';
import { decodeInvite } from '../shared/invite.js';
import { decoderBillet, encoderBillet, jugerTransport, urlHttpDeRuche } from '../shared/acces.js';
import type { Billet } from '../shared/acces.js';
import { ID_PATTERN, LIMITS } from '../shared/protocol.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : tout vient de l'invitation et des valeurs par défaut.
}

/** Identité de nœud stable, mémorisée localement pour garder sa place à la reconnexion. */
function stableNodeId(workRoot: string): string {
  const file = path.join(workRoot, 'node-id.txt');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (ID_PATTERN.test(existing)) return existing;
  } catch {
    // premier lancement
  }
  const id = `node-${randomUUID()}`.slice(0, 64);
  try {
    mkdirSync(workRoot, { recursive: true });
    writeFileSync(file, id, 'utf8');
  } catch {
    // impossible d'écrire : on garde l'id en mémoire pour cette session
  }
  return id;
}

/**
 * Clé propre du nœud, mémorisée à côté de son identité.
 *
 * INDISPENSABLE, pas une optimisation : un billet est à usage UNIQUE. Sans
 * cette mémoire, le premier redémarrage du nœud redemanderait un échange avec
 * un billet déjà consommé — et l'ami se retrouverait dehors sans comprendre
 * pourquoi, en ayant tout fait correctement.
 *
 * Fichier en 0600 : sur une machine partagée, une clé lisible par tous les
 * comptes vaudrait la même clé pour personne.
 */
function cheminCle(workRoot: string): string {
  return path.join(workRoot, 'node-key.txt');
}

function lireCle(workRoot: string): string | null {
  try {
    const v = readFileSync(cheminCle(workRoot), 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function rangerCle(workRoot: string, cle: string): void {
  try {
    mkdirSync(workRoot, { recursive: true });
    writeFileSync(cheminCle(workRoot), cle, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Impossible d'écrire : le nœud tourne quand même pour cette session, mais
    // il faudra un nouveau billet au prochain démarrage. On le dit plus bas.
  }
}

/**
 * Échange un billet contre la clé du nœud, en HTTP(S), AVANT d'ouvrir le
 * WebSocket. Rend `null` si la ruche refuse — l'appelant doit alors s'arrêter
 * net plutôt que de tenter une connexion qui échouera de toute façon.
 */
async function echangerBillet(
  billet: Billet,
  nodeId: string,
  label: string,
): Promise<string | null> {
  const base = urlHttpDeRuche(billet.url);
  if (!base) return null;
  try {
    const rep = await fetch(`${base}/api/rejoindre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billet: encoderBillet(billet), nodeId, label }),
    });
    if (!rep.ok) {
      const detail = (await rep.json().catch(() => null)) as { error?: string } | null;
      console.error(
        `\n✘ La ruche a refusé ce billet (${rep.status}${detail?.error ? ` — ${detail.error}` : ''}).\n` +
          '  Un billet est éphémère et souvent à usage unique : demandez-en un nouveau à l’hôte\n' +
          '  (`npm run cli -- invite`).',
      );
      return null;
    }
    const data = (await rep.json()) as { cle?: unknown };
    return typeof data.cle === 'string' && data.cle.length > 0 ? data.cle : null;
  } catch (err) {
    console.error(
      `\n✘ Ruche injoignable à ${base} : ${err instanceof Error ? err.message : String(err)}\n` +
        '  Vérifiez que l’hôte a bien lancé la ruche et que l’URL du billet est atteignable.',
    );
    return null;
  }
}

async function askInvite(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('🐝 Collez votre invitation Hive puis Entrée :\n> ')).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const raw =
    process.argv.slice(2).join(' ').trim() || process.env.HIVE_INVITE || (await askInvite());

  // Deux formats, deux modèles de sécurité :
  //   • `hive2_` — un BILLET. Éphémère et révocable, échangé contre une clé
  //     propre à ce nœud. C'est le chemin normal.
  //   • `hive1_` — l'ancienne invitation, qui CONTIENT le token maître. Toujours
  //     acceptée (des ruches tournent avec), mais on le dit franchement.
  const billet = decoderBillet(raw, { id: LIMITS.id, nom: LIMITS.name });
  const invite = billet ? null : decodeInvite(raw);
  if (!billet && !invite) {
    console.error(
      '✘ Invitation invalide. Demandez à l’hôte de la ruche une nouvelle invitation\n' +
        '  (dans le dashboard : « Inviter un ami », ou `npm run cli -- invite`).',
    );
    process.exit(1);
  }
  const url = billet ? billet.url : invite!.url;
  const label = billet ? billet.label : invite!.label;

  // Choix de l'agent : HIVE_AGENT force le choix, sinon détection automatique.
  // IMPORTANT : la détection sonde des binaires du PATH (spawn `--version`) ; on
  // ne met PAS le token dans l'environnement avant, sinon un binaire homonyme
  // malveillant (claude.cmd déposé en tête de PATH) l'hériterait. Le token n'est
  // exposé qu'ensuite, pour le seul adaptateur choisi.
  const forced = process.env.HIVE_AGENT as AgentType | undefined;
  const detected = forced ? { agent: forced, label: forced } : await detectBestAgent();
  const allAgents = await detectAllAgents();

  const workRoot = process.env.HIVE_WORKDIR ?? path.join('.hive-work', 'join');
  const maxConcurrency = clampConcurrency(process.env.HIVE_MAX_CONCURRENCY);
  const nodeId = stableNodeId(workRoot);

  const hasRealAgent = allAgents.some((a) => a !== 'shell');
  // Toujours afficher l'URL RÉELLE de connexion, jamais masquée par le libellé :
  // c'est là que part le token, l'utilisateur doit pouvoir la vérifier.
  console.log(`\n🐝 Connexion à : ${url}${label ? `  (« ${label} »)` : ''}`);
  const transport = jugerTransport(url);
  if (transport === 'clair_public') {
    // On ne bloque pas — c'est la machine de l'invité, et l'hôte a pu vouloir
    // ce montage. Mais il doit savoir que ce n'est pas seulement sa clé qui
    // voyage en clair : c'est tout le code source qui transitera ensuite.
    console.log(
      '   ⚠ Transport EN CLAIR vers une adresse publique : votre clé, les prompts,\n' +
        '     les logs et les diffs de code circuleront sans chiffrement. Demandez à\n' +
        '     l’hôte une URL wss:// (`npm run cli -- tunnel`).',
    );
  } else if (transport === 'clair_prive') {
    console.log('   ℹ Transport en clair sur réseau privé (usuel en local).');
  }
  console.log(`   Agents détectés : ${allAgents.join(', ')}`);
  console.log(`   Agent utilisé   : ${detected.label}`);
  if (detected.agent === 'shell' && !hasRealAgent) {
    console.log(
      '   ℹ Aucun agent IA détecté : mode « shell simulé » (sûr, sans exécution réelle).\n' +
        '     Installez Claude Code ou Codex, ou définissez HIVE_AGENT, pour du vrai travail.',
    );
  } else if (detected.agent === 'shell' && hasRealAgent) {
    console.log(
      '   ℹ Agent « shell simulé » forcé (HIVE_AGENT) alors que des agents réels sont disponibles.',
    );
  }

  // ─── Le secret avec lequel ce nœud se présentera ────────────────────────────
  // Billet : on réutilise la clé déjà obtenue si elle existe (un billet est à
  // usage unique, le redemander échouerait), sinon on l'échange une fois.
  // Ancien format : le token maître, tel quel.
  let secret: string;
  if (billet) {
    const dejaLa = lireCle(workRoot);
    if (dejaLa) {
      secret = dejaLa;
      console.log('   🔑 Clé de nœud déjà obtenue — le billet n’est pas redemandé.');
    } else {
      const nom = process.env.HIVE_NODE_NAME ?? os.hostname();
      const obtenue = await echangerBillet(billet, nodeId, nom);
      if (!obtenue) process.exit(1);
      rangerCle(workRoot, obtenue);
      secret = obtenue;
      const persistee = lireCle(workRoot) !== null;
      console.log(
        persistee
          ? '   🔑 Clé de nœud obtenue et mémorisée — les redémarrages ne redemanderont rien.'
          : '   ⚠ Clé obtenue mais NON mémorisée (écriture impossible) : il faudra un\n' +
              '     nouveau billet au prochain démarrage.',
      );
    }
  } else {
    console.log(
      '   ⚠ Ancienne invitation (hive1_) : elle contient le token MAÎTRE de la ruche.\n' +
        '     Accès total, sans expiration ni révocation individuelle. Demandez à l’hôte\n' +
        '     un billet récent (`npm run cli -- invite`) dès que possible.',
    );
    secret = invite!.token;
  }

  // Le secret sert aussi de garde-fou aux adaptateurs réels (claude-code/codex
  // refusent un token trivial). On ne l'expose qu'ICI, après la détection des
  // binaires : sinon un homonyme malveillant en tête de PATH en hériterait.
  process.env.HIVE_TOKEN = secret;

  // L'agent réel doit retrouver sa config et sa clé API dans la sandbox
  // (fusionnées avec un éventuel HIVE_KEEP_ENV fourni par l'utilisateur).
  const extraKeep = (process.env.HIVE_KEEP_ENV ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const keepEnv = [...new Set([...agentCredentialEnv(detected.agent), ...extraKeep])];

  // ─── Le bac à sable ────────────────────────────────────────────────────────
  //
  // Ce bloc n'existait PAS. Un nœud rejoint par un billet tournait donc
  // toujours en sandbox de processus, jamais en conteneur — et
  // `HIVE_ISOLEMENT=exige`, le réglage qu'on pose précisément quand on prête
  // sa machine à des inconnus, y était sans le moindre effet.
  //
  // C'était le pire endroit possible pour ce trou : `join` est le chemin des
  // AMIS, c'est-à-dire de gens qui n'ont pas lu `.env.example` et qui font
  // confiance à celui qui leur a envoyé le billet. La décision passe
  // maintenant par le même `bac.ts` que `main.ts` — un seul code, donc plus
  // de dérive possible entre les deux chemins de démarrage.
  const bac = await preparerBac();
  for (const l of bac.lignes) console.log(l);
  if (bac.refuse) {
    console.error('✘ Ce nœud ne démarre pas.\n');
    process.exit(1);
  }

  const client = new HiveNodeClient({
    url,
    token: secret,
    name: process.env.HIVE_NODE_NAME ?? os.hostname(),
    ownerName: process.env.HIVE_OWNER_NAME ?? os.userInfo().username,
    agentType: detected.agent,
    maxConcurrency,
    workRoot,
    nodeId,
    keepEnv,
    ...optionBac(bac, keepEnv),
  });

  client.start();
  console.log('\n✔ Nœud démarré — vous butinez pour la ruche. Ctrl+C pour quitter.\n');

  process.on('SIGINT', () => {
    console.log('\nDéconnexion de la ruche…');
    client.stop();
    process.exit(0);
  });
  process.on('uncaughtException', (err) => console.error('[hive] exception non catchée :', err));
  process.on('unhandledRejection', (reason) => console.error('[hive] rejet non géré :', reason));
}

function clampConcurrency(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '2', 10);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), 16) : 2;
}

await main();
