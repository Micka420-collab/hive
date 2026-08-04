// `npm run join <invitation>` — la façon la plus simple de rejoindre une ruche.
//
// Un ami reçoit une invitation (une longue chaîne « hive1_… »). Il lance :
//     npm run join -- hive1_eyJ2Ijox...
// et c'est tout : le token et l'URL sont dans l'invitation, son agent IA
// (Claude Code / Codex) est détecté automatiquement, son identité de nœud est
// mémorisée pour les reconnexions. Aucun fichier de config à éditer.
//
// Sans argument, l'invitation est demandée de façon interactive.

import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { agentCredentialEnv, detectAllAgents, detectBestAgent } from './agent-detect.js';
import { optionBac, preparerBac } from './bac.js';
import { CODE } from '../codes-sortie.js';
import type { AgentType } from './agent-detect.js';
import { HiveNodeClient } from './client.js';
import { decodeInvite } from '../shared/invite.js';
import { decoderBillet, encoderBillet, jugerTransport, urlHttpDeRuche } from '../shared/acces.js';
import type { Billet } from '../shared/acces.js';
import { LIMITS } from '../shared/protocol.js';
import { bornerConcurrence, identiteStable, lireCle, rangerCle } from './identite-noeud.js';
import { annonceAgent, avertissementTransport } from './annonces-join.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Pas de .env : tout vient de l'invitation et des valeurs par défaut.
}

// L'identité du nœud, sa clé et la borne de concurrence vivent dans
// `identite-noeud.ts` : ce fichier-ci finit par `await main()`, donc aucun
// test ne peut l'importer sans ouvrir un WebSocket (§ 2.8 du carnet). Ce qui
// ne dépend ni du réseau ni des signaux en sort pour être éprouvé.

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
      const corps = (await rep.json().catch(() => null)) as {
        error?: string;
        motif?: string;
        detail?: string;
      } | null;

      // La ruche dit désormais POURQUOI quand elle le peut : expiré, épuisé,
      // révoqué. Ces trois-là ne s'apprennent qu'avec le bon secret en main,
      // donc les afficher n'apprend rien à qui ne l'avait pas — et les taire
      // laissait la personne sans savoir s'il fallait redemander un billet ou
      // vérifier sa connexion. C'était le cas d'échec le plus fréquent de ce
      // chemin, et le plus vexant.
      if (corps?.motif) {
        console.error(`\n✘ ${corps.error ?? 'Billet refusé.'}\n`);
        console.error('  L’hôte le crée en une commande : `npm run cli -- invite`.');
        return null;
      }

      // Le `detail` du 409 (« identifiant de nœud déjà utilisé ») était lu
      // puis JETÉ : il porte pourtant la seule marche à suivre utile.
      console.error(
        `\n✘ La ruche a refusé ce billet (${rep.status}${corps?.error ? ` — ${corps.error}` : ''}).`,
      );
      if (corps?.detail) console.error(`  ${corps.detail}`);
      else
        console.error(
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

/**
 * Demande le billet à l'humain.
 *
 * HORS TERMINAL, ON NE DEMANDE PAS — on échoue en le disant. Sans cette garde,
 * `hive join` sans argument dans un script, un pipe ou une CI attendait une
 * réponse que personne ne viendrait donner : le processus restait figé
 * jusqu'au délai d'attente de l'appelant, sans un mot d'explication. Un
 * blocage silencieux est le pire mode d'échec d'un outil qu'on automatise.
 */
async function askInvite(): Promise<string> {
  if (process.stdin.isTTY !== true) {
    console.error(
      '\n✘ Aucun billet fourni, et pas de terminal pour le demander.\n' +
        '  Passez-le en argument : `hive join hive2_…`\n' +
        '  ou par l’environnement : `HIVE_INVITE=hive2_… hive join`.',
    );
    process.exit(CODE.REPONSE_MANQUANTE);
  }
  return askInviteInteractif();
}

async function askInviteInteractif(): Promise<string> {
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
  const maxConcurrency = bornerConcurrence(process.env.HIVE_MAX_CONCURRENCY);
  const nodeId = identiteStable(workRoot);

  // Toujours afficher l'URL RÉELLE de connexion, jamais masquée par le libellé :
  // c'est là que part le token, l'utilisateur doit pouvoir la vérifier.
  console.log(`\n🐝 Connexion à : ${url}${label ? `  (« ${label} »)` : ''}`);
  // Les DEUX annonces vivent dans `annonces-join.ts`, pur et éprouvé : ce
  // fichier-ci court à l'import, et c'est précisément là que le balayage avait
  // trouvé « transport === 'clair_public' » sans aucune garde.
  const avertissement = avertissementTransport(jugerTransport(url));
  if (avertissement) console.log(avertissement);
  console.log(`   Agents détectés : ${allAgents.join(', ')}`);
  console.log(`   Agent utilisé   : ${detected.label}`);
  const motAgent = annonceAgent(detected.agent, allAgents);
  if (motAgent) console.log(motAgent);

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
    // Voir `main.ts` : le code du refus vient de la décision, pas d'un `1`
    // recopié — c'est le duplicata entre les deux chemins qui avait déjà
    // coûté l'absence totale de bac à sable sur celui-ci.
    process.exit(bac.codeSortie);
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

await main();
