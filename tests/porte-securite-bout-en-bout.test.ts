// LA PORTE DE SÉCURITÉ, DE BOUT EN BOUT : un vrai nœud (HiveNodeClient), une
// vraie Reine, un vrai dépôt git local — et les faux outils de
// `fixtures/faux-outils-porte.ts` en tête du PATH, qui rejouent les sorties
// réelles de betterleaks 1.9.0 et d'osv-scanner 2.6.0.
//
// ─── LE CRITÈRE DE PREUVE DE LA CARTE (G10), VU DE L'EVALUATOR ───────────────
//
//   · une clé AWS factice et une dépendance vulnérable ajoutées → le verdict
//     est `correction_required` ; il cite la règle et la ligne, l'avis et son
//     CVE — et AUCUNE valeur : ni dans le verdict, ni dans le diff rangé, ni
//     dans le journal ;
//   · des outils absents → la porte est « non vérifiée », raison à l'appui,
//     jamais « rien trouvé » ; en polyéthisme `strict`, la production attend
//     un humain ;
//   · un résultat qui n'apporte AUCUN rapport (un nœud antérieur à la porte,
//     une production simulée) → « non vérifiée » aussi, jamais verte.
//
// Le nœud n'a pas de bac : les validations y sont `sans_bac` (rien du code de
// l'agent ne tourne sur l'hôte), la porte, elle, tourne — elle n'exécute rien
// de la production. POSIX seulement : les faux outils sont des scripts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { SECRET_CAVIARDE } from '../src/shared/caviardage.js';
import { fauxOutilsPorte, type FauxOutils } from './fixtures/faux-outils-porte.js';

const JETON = 'jeton-porte-securite-suffisamment-long';
const POSIX = process.platform !== 'win32';

/** Assemblées à l'exécution : en clair, la protection des secrets de GitHub refuserait la poussée. */
const ID_AWS = ['AKIA', 'Z7Q4XWERT2LMNOPQ'].join('');
const SECRETE_AWS = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYzq9Lr3Tn8v'].join('/');

const verrou = (deps: Record<string, string>): string =>
  JSON.stringify(
    {
      name: 'projet-local',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'projet-local', version: '1.0.0', dependencies: deps },
        ...Object.fromEntries(
          Object.entries(deps).map(([nom, version]) => [
            `node_modules/${nom}`,
            { version, resolved: `https://registry.npmjs.org/${nom}/-/${nom}-${version}.tgz` },
          ]),
        ),
      },
    },
    null,
    2,
  ) + '\n';

const CONFIG_BASE = "export const region = 'eu-west-3';\n";

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let outils: FauxOutils;
const dossiers: string[] = [];
const PATH_AVANT = process.env.PATH;

beforeEach(() => {
  outils = fauxOutilsPorte(dossiers);
  process.env.PATH = `${outils.dossier}${path.delimiter}${PATH_AVANT ?? ''}`;
});

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  process.env.PATH = PATH_AVANT;
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/** L'agent du banc, selon le titre de la tâche — il écrit dans l'arbre, comme un vrai. */
const agentDuBanc: AgentAdapter = {
  name: 'banc',
  run(task, ctx) {
    if (task.title.startsWith('Configurer')) {
      writeFileSync(
        path.join(ctx.cwd, 'src', 'config.ts'),
        CONFIG_BASE +
          `export const awsAccessKeyId = '${ID_AWS}';\n` +
          `export const awsSecretAccessKey = '${SECRETE_AWS}';\n`,
      );
      writeFileSync(
        path.join(ctx.cwd, 'package-lock.json'),
        verrou({ lodash: '4.17.20', minimist: '1.2.0' }),
      );
      return Promise.resolve({ success: true, diff: '', logs: 'configuré', subAgents: [] });
    }
    // Un adaptateur qui rend son propre diff, sans rien écrire : la porte ne
    // juge pas un arbre que la production n'a pas touché — aucun rapport.
    if (task.title.startsWith('Simuler')) {
      return Promise.resolve({
        success: true,
        diff: "diff --git a/src/config.ts b/src/config.ts\n+export const region = 'eu-west-1';",
        logs: 'simulé',
        subAgents: [],
      });
    }
    if (task.title.startsWith('Régionaliser')) {
      writeFileSync(
        path.join(ctx.cwd, 'src', 'config.ts'),
        "export const region = 'eu-west-1';\nexport const zone = 'b';\n",
      );
      return Promise.resolve({ success: true, diff: '', logs: 'région', subAgents: [] });
    }
    // Toute autre tâche (une contre-visite) ne change rien.
    return Promise.resolve({ success: true, diff: '', logs: 'rien à changer', subAgents: [] });
  },
};

async function demarrer(polyethisme?: 'strict'): Promise<{
  s: HiveServer;
  produire: (title: string) => Promise<{
    tacheId: string;
    diff: string;
    evaluation: {
      decision: string;
      retryRecommended: boolean;
      reasons: string[];
      evidence: { securite: Record<string, Record<string, unknown>>; securiteNodeId?: string };
    };
    brut: string;
  }>;
}> {
  const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-porte-e2e-'));
  dossiers.push(racine);
  const depot = path.join(racine, 'depot');
  mkdirSync(path.join(depot, 'src'), { recursive: true });
  writeFileSync(path.join(depot, 'src', 'config.ts'), CONFIG_BASE);
  writeFileSync(path.join(depot, 'package-lock.json'), verrou({ lodash: '4.17.20' }));
  const git = simpleGit({ baseDir: depot });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');

  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(racine, 'hive.db'),
    simulation: false,
    tickMs: 40,
    ...(polyethisme ? { polyethisme } : {}),
  });
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${serveur.port}/ws`,
    token: JETON,
    name: 'ouvriere-porte',
    ownerName: 'banc',
    agentType: 'claude-code',
    nodeId: 'noeud-porte',
    maxConcurrency: 1,
    workRoot: path.join(racine, 'travail'),
    adapter: agentDuBanc,
    quiet: true,
  });
  client.start();
  const s = serveur;
  await attendre(
    () => s.store.listNodes().some((n) => n.id === 'noeud-porte' && n.status === 'online'),
    'le nœud ne rejoint pas la ruche',
  );
  const projet = s.store.createProject({ name: 'Projet local', repoUrl: depot });
  const produire = async (title: string) => {
    const tache = s.store.createTask({
      projectId: projet.id,
      title,
      prompt: 'Configurer src/config.ts pour la région et le compte du projet.',
    });
    s.store.patchTask(tache.id, { status: 'ready' });
    await attendre(() => s.store.resultsForTask(tache.id).length > 0, `${title} : pas de résultat`);
    const reponse = await fetch(`http://127.0.0.1:${s.port}/api/tasks/${tache.id}/evaluation`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(reponse.status).toBe(200);
    const brut = await reponse.text();
    return {
      tacheId: tache.id,
      diff: s.store.resultsForTask(tache.id).at(-1)?.diff ?? '',
      evaluation: JSON.parse(brut) as Awaited<ReturnType<typeof produire>>['evaluation'],
      brut,
    };
  };
  return { s, produire };
}

describe.runIf(POSIX)('la porte de sécurité — du nœud producteur jusqu’à l’Evaluator', () => {
  it(
    'UNE CLÉ AWS ET UNE DÉPENDANCE VULNÉRABLE AJOUTÉES : correction demandée, valeurs caviardées, avis cité',
    { timeout: 60_000 },
    async () => {
      const { s, produire } = await demarrer();
      const { tacheId, diff, evaluation, brut } = await produire('Configurer le compte AWS');

      expect(evaluation.decision).toBe('correction_required');
      expect(evaluation.retryRecommended).toBe(true);
      expect(evaluation.reasons[0]).toBe(
        'la porte de sécurité a trouvé 2 secret(s) ajouté(s), 2 vulnérabilité(s) introduite(s) ' +
          '(nœud noeud-porte) — retirez chaque secret du code et lisez-le de l’environnement ; ' +
          'passez chaque dépendance à une version corrigée',
      );
      const motifs = evaluation.reasons.join('\n');
      expect(motifs).toContain('aws-access-token src/config.ts:2');
      expect(motifs).toContain('aws-secret-access-key src/config.ts:3');
      expect(motifs).toContain(
        'minimist@1.2.0 (npm) GHSA-xvch-5gv4-984h (CVE-2021-44906, CRITICAL) dans package-lock.json',
      );
      expect(motifs).toContain('GHSA-vh95-rmgr-6w4m (CVE-2020-7598, MODERATE)');
      // lodash 4.17.20 porte cinq avis — mais la base les avait déjà.
      expect(motifs).not.toContain('lodash');
      expect(evaluation.evidence.securiteNodeId).toBe('noeud-porte');

      // AUCUNE VALEUR, nulle part : ni dans le verdict, ni dans le diff rangé
      // (caviardé au nœud — la clé secrète comprise, que rien chez Hive ne
      // reconnaissait), ni dans le journal.
      for (const valeur of [ID_AWS, SECRETE_AWS]) {
        expect(brut).not.toContain(valeur);
        expect(diff).not.toContain(valeur);
        expect(JSON.stringify(s.store.listEvents(0, 5_000))).not.toContain(valeur);
      }
      expect(diff).toContain(`+export const awsSecretAccessKey = '${SECRET_CAVIARDE}';`);
      expect(diff).toContain('"minimist"');

      // Le fait rangé : lié au résultat exact et au nœud qui l'a vu.
      const [fait] = s.store.evenementsDeTache(tacheId, ['security_gate_recorded']);
      const resultId = s.store.resultsForTask(tacheId).at(-1)?.resultId;
      expect(fait?.payload).toMatchObject({
        taskId: tacheId,
        resultId,
        nodeId: 'noeud-porte',
        porte: {
          secrets: { etat: 'constat', outil: { nom: 'betterleaks', version: '1.9.0' }, total: 2 },
          dependances: {
            etat: 'constat',
            outil: { nom: 'osv-scanner', version: '2.6.0' },
            total: 2,
          },
        },
      });
    },
  );

  it(
    'OUTILS ABSENTS, POLYÉTHISME STRICT : « non vérifiée » avec sa raison, et la production attend un humain',
    { timeout: 60_000 },
    async () => {
      outils.mode('betterleaks', 'absent');
      outils.mode('osv-scanner', 'absent');
      const { produire } = await demarrer('strict');
      const { evaluation } = await produire('Régionaliser la configuration');

      expect(evaluation.evidence.securite.secrets).toEqual({
        etat: 'non_verifie',
        raison: 'outil_absent',
        constats: [],
        total: 0,
      });
      expect(evaluation.decision).toBe('human_review_required');
      expect(evaluation.retryRecommended).toBe(false);
      expect(evaluation.reasons[0]).toBe(
        'porte de sécurité non vérifiée, polyéthisme strict : secrets — outil absent (betterleaks)',
      );
      expect(evaluation.reasons[1]).toContain('rendez-la vérifiable sur le nœud noeud-porte');
      expect(evaluation.reasons[1]).toContain('hive doctor');
    },
  );

  it(
    'UN RÉSULTAT SANS RAPPORT (nœud antérieur, production simulée) : « non vérifiée », jamais verte',
    { timeout: 60_000 },
    async () => {
      const { produire } = await demarrer('strict');
      const { evaluation, tacheId } = await produire('Simuler la configuration');
      for (const volet of ['secrets', 'dependances']) {
        expect(evaluation.evidence.securite[volet]).toEqual({
          etat: 'non_verifie',
          raison: 'rapport_absent',
          constats: [],
          total: 0,
        });
      }
      expect(evaluation.evidence.securiteNodeId).toBeUndefined();
      expect(evaluation.decision).toBe('human_review_required');
      expect(evaluation.reasons[0]).toContain('porte de sécurité non vérifiée, polyéthisme strict');
      expect(evaluation.reasons[0]).toContain('aucun rapport du nœud');
      expect(evaluation.reasons[1]).toContain('le nœud producteur');
      expect(serveur?.store.evenementsDeTache(tacheId, ['security_gate_recorded'])).toEqual([]);
    },
  );
});
