// L'ESSAI DE HIVE STUDIO — le scénario d'acceptation, sur une VRAIE ouvrière.
//
//   node scripts/essai-studio.mjs --agents codex
//   E2E_MODELES=gpt-5.6-luna node scripts/essai-studio.mjs --agents codex
//   node scripts/essai-studio.mjs --agents claude-code,codex
//
// ─── CE QU'IL PROUVE ────────────────────────────────────────────────────────
//
// Le parcours de la directive Hive Studio (§ 9), de bout en bout, sans rien
// simuler : une Reine sur un port à elle et une base jetable, un dépôt de test
// (une calculette dont `add` soustrait), l'ouvrière RÉELLE demandée
// (`--agents`), un vrai navigateur sur l'accueil. Il décrit la mission dans
// la saisie, vérifie que le plan n'écrit rien avant « Lancer », lance, regarde
// l'agent recevoir la tâche, attend la fin, lit le CHAMP `diff` (pas les
// journaux, où l'agent peut citer une correction qu'il n'a pas pu appliquer),
// approuve depuis les résultats, recharge la page et relit les missions.
//
// Chaque pas est écrit, réussi ou non, dans `captures-ecran/<sortie>/
// rapport.json`, avec une capture par étape. Un pas qui échoue est un ✘, pas
// un arrêt silencieux : c'est le rapport qu'on lit.
//
// ─── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────
//
// Il ne tourne ni sous `npm test`, ni en CI : il appelle de vrais agents, sur
// le compte de l'opérateur, et coûte ce qu'ils coûtent. Il ne touche ni à
// `.env`, ni aux réglages des agents (`~/.claude`, `~/.codex`) : si ceux-ci
// empêchent l'agent d'écrire, l'essai le CONSTATE — c'est précisément ce que
// le produit doit dire à l'écran.
//
// Variables : `E2E_PORT` (7791), `E2E_SORTIE` (`essai-studio`), `E2E_MODELES`
// (déclarés par l'ouvrière, `HIVE_MODELES` — l'Aiguillage choisit parmi eux).

// Les fonctions passées à `addInitScript` tournent DANS la page.
/* global localStorage */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
// Explicites : ESLint ne déclare pas les globales de minuterie dans `scripts/*.mjs`.
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SORTIE = path.join(RACINE, 'captures-ecran', process.env.E2E_SORTIE ?? 'essai-studio');
mkdirSync(SORTIE, { recursive: true });

const argAgents = process.argv.indexOf('--agents');
const AGENTS = (argAgents > 0 ? process.argv[argAgents + 1] : 'claude-code').split(',');
const PORT = Number(process.env.E2E_PORT ?? 7791);
const JETON = randomBytes(24).toString('hex');
const D = mkdtempSync(path.join(os.tmpdir(), 'hive-e2e-'));
const rapport = { debut: new Date().toISOString(), agents: AGENTS, etapes: [] };
const vivants = [];

function etape(nom, ok, detail = '') {
  rapport.etapes.push({ nom, ok, detail, a: new Date().toISOString() });
  console.log(`${ok ? '✔' : '✘'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`);
  return r.stdout.trim();
}

// ─── 1. Le dépôt de test : une calculette dont `add` soustrait ──────────────
const source = path.join(D, 'source');
mkdirSync(source);
writeFileSync(path.join(source, 'calc.js'), 'export function add(a, b) {\n  return a - b;\n}\n');
writeFileSync(
  path.join(source, 'test.js'),
  "import assert from 'node:assert/strict';\nimport { add } from './calc.js';\n\nassert.equal(add(2, 3), 5);\nconsole.log('ok');\n",
);
writeFileSync(
  path.join(source, 'package.json'),
  JSON.stringify(
    { name: 'calc-e2e', private: true, type: 'module', scripts: { test: 'node test.js' } },
    null,
    2,
  ) + '\n',
);
git(['init', '-q', '-b', 'main'], source);
git(['add', '.'], source);
git(
  ['-c', 'user.name=E2E', '-c', 'user.email=e2e@exemple.invalid', 'commit', '-q', '-m', 'init'],
  source,
);
const depot = path.join(D, 'depot.git');
git(['clone', '-q', '--bare', source, depot], D);
etape('dépôt de test créé', true, depot);

// ─── 2. La Reine ─────────────────────────────────────────────────────────────
const HERITEES = [
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'USERNAME',
  'CLAUDE_CODE_GIT_BASH_PATH',
];
const base = {};
for (const [k, v] of Object.entries(process.env)) {
  if (HERITEES.includes(k.toUpperCase())) base[k] = v;
}

function lancer(nom, entree, env) {
  const proc = spawn(process.execPath, [path.join(RACINE, 'scripts', 'lancer.mjs'), entree], {
    cwd: D,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lignes = [];
  for (const f of [proc.stdout, proc.stderr]) {
    f.setEncoding('utf8');
    f.on('data', (b) => {
      for (const l of b.split('\n')) if (l.trim()) lignes.push(`${nom} │ ${l}`);
      if (lignes.length > 400) lignes.splice(0, lignes.length - 400);
    });
  }
  vivants.push(proc);
  return { proc, journal: () => lignes.join('\n') };
}

const envReine = {
  ...base,
  HIVE_HOST: '127.0.0.1',
  HIVE_PORT: String(PORT),
  HIVE_TOKEN: JETON,
  HIVE_JWT_SECRET: randomBytes(32).toString('hex'),
  HIVE_DB: path.join(D, 'hive.db'),
};
const reine = lancer('reine', 'src/orchestrator/main.ts', envReine);
const HTTP = `http://127.0.0.1:${PORT}`;
const ENTETES = { 'x-hive-token': JETON, 'content-type': 'application/json' };

async function api(chemin, { method = 'GET', corps, jwt } = {}) {
  const r = await fetch(HTTP + chemin, {
    method,
    headers: { ...ENTETES, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* texte brut */
  }
  if (!r.ok) throw new Error(`${method} ${chemin} → ${r.status} ${texte.slice(0, 300)}`);
  return json;
}

async function attendre(fn, ms, quoi) {
  const fin = Date.now() + ms;
  let dernier;
  while (Date.now() < fin) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      dernier = e;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${quoi} : rien après ${ms / 1000} s${dernier ? ` (${dernier.message})` : ''}`);
}

let navigateur;
let code = 0;
try {
  await attendre(() => api('/api/pulse'), 60_000, 'la Reine ne répond pas');
  etape('Reine en ligne', true, HTTP);

  const compte = await api('/api/auth/register', {
    method: 'POST',
    corps: {
      email: 'e2e@exemple.invalid',
      displayName: 'Micka E2E',
      password: randomBytes(16).toString('hex'),
    },
  });
  const jwt = compte.token;
  etape('compte créé (premier = administrateur)', true, compte.user?.role ?? '?');

  const projet = await api('/api/projects/user', {
    method: 'POST',
    jwt,
    corps: { name: 'Calculette E2E', repoUrl: depot, description: 'Dépôt de test du scénario E2E' },
  });
  etape('projet isolé créé sur le dépôt local', true, projet.id);

  // ─── 3. Les ouvrières RÉELLES ──────────────────────────────────────────────
  for (const agent of AGENTS) {
    lancer(`noeud-${agent}`, 'src/node-client/main.ts', {
      ...base,
      HIVE_URL: `ws://127.0.0.1:${PORT}/ws`,
      HIVE_TOKEN: JETON,
      HIVE_AGENT: agent,
      HIVE_NODE_NAME: `poste-${agent}`,
      HIVE_OWNER_NAME: 'Micka',
      HIVE_WORKDIR: path.join(D, `work-${agent}`),
      HIVE_MAX_CONCURRENCY: '1',
      HIVE_ISOLEMENT: 'off',
      ...(process.env.E2E_MODELES ? { HIVE_MODELES: process.env.E2E_MODELES } : {}),
    });
  }
  const noeuds = await attendre(
    async () => {
      const s = await api('/api/state');
      const enLigne = s.nodes.filter((n) => n.status === 'online');
      return enLigne.length >= AGENTS.length ? enLigne : null;
    },
    90_000,
    'les ouvrières ne se connectent pas',
  );
  etape(
    'ouvrière(s) réelle(s) connectée(s)',
    true,
    noeuds.map((n) => `${n.name}:${n.agentType}`).join(', '),
  );

  // ─── 4. Le navigateur : l'accueil de Hive Studio ───────────────────────────
  navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'fr-FR',
    colorScheme: 'dark',
  });
  await contexte.addInitScript(
    (v) => {
      for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x);
    },
    { 'hive.token': JETON, 'hive.jwt': jwt, 'hive.lang': 'fr' },
  );
  const page = await contexte.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(m.text().slice(0, 240));
  });
  const photo = async (nom) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SORTIE, `${nom}.png`) });
  };

  await page.goto(`${HTTP}/#/studio`);
  await page
    .locator('[data-testid="mc-liaison"][data-etat="connecte"]')
    .waitFor({ timeout: 30_000 });
  await page.locator('.mc-account-name').waitFor({ state: 'attached', timeout: 15_000 });
  const iaMot = await page.locator('[data-testid="mc-ia-mot"]').textContent();
  etape('accueil ouvert, liaison « connecté »', true, `IA : ${iaMot}`);
  await photo('01-accueil');

  // La saisie de mission.
  const MISSION =
    'Dans calc.js, la fonction add soustrait au lieu d’additionner : corrige-la, puis lance npm test pour vérifier.';
  await page.locator('#hs-saisie').fill(MISSION);
  await page.getByRole('button', { name: 'Préparer la mission' }).click();
  await page.getByRole('button', { name: 'Lancer la mission' }).waitFor({ timeout: 60_000 });
  const tachesAvant = (await api('/api/state')).tasks.length;
  etape('plan proposé, rien encore créé', tachesAvant === 0, `${tachesAvant} tâche(s) côté Reine`);
  const lignesPlan = await page.locator('.hs-apercu li, .hs-plan li').allTextContents();
  etape('le plan proposé', true, lignesPlan.map((l) => l.trim().slice(0, 80)).join(' | '));
  await photo('02-plan');

  await page.getByRole('button', { name: 'Lancer la mission' }).click();
  const creees = await attendre(
    async () => {
      const s = await api('/api/state');
      return s.tasks.length > 0 ? s.tasks : null;
    },
    30_000,
    'aucune tâche créée après « Lancer »',
  );
  etape(
    'mission lancée → tâches créées',
    true,
    creees.map((t) => `${t.title} [${t.status}]`).join(' | '),
  );

  // L'agent reçoit et travaille : on photographie l'état « en cours ».
  await attendre(
    async () => {
      const s = await api('/api/state');
      return s.tasks.some((t) => ['assigned', 'running'].includes(t.status));
    },
    120_000,
    'aucune tâche confiée à une ouvrière',
  );
  const enCours = (await api('/api/state')).tasks.find((t) =>
    ['assigned', 'running'].includes(t.status),
  );
  etape('l’agent a reçu la tâche', true, `${enCours.title} → ${enCours.assignedNodeId}`);
  await page.waitForTimeout(2500);
  await photo('03-en-cours');

  const finies = await attendre(
    async () => {
      const s = await api('/api/state');
      const toutes = s.tasks.filter((t) => !t.ombre);
      return toutes.length > 0 &&
        toutes.every((t) => ['done', 'failed', 'cancelled'].includes(t.status))
        ? toutes
        : null;
    },
    15 * 60_000,
    'la mission ne se termine pas',
  );
  etape(
    'mission terminée',
    finies.every((t) => t.status === 'done'),
    finies.map((t) => `${t.title} [${t.status}]`).join(' | '),
  );
  await page.waitForTimeout(2000);
  await photo('04-terminee');

  // Le résultat : diff de calc.js.
  const resultats = [];
  for (const t of finies) {
    try {
      const r = await api(`/api/tasks/${t.id}/results`, { jwt });
      resultats.push(r);
    } catch (e) {
      resultats.push({ erreur: e.message });
    }
  }
  writeFileSync(path.join(SORTIE, 'resultats.json'), JSON.stringify(resultats, null, 2));
  // Le champ `diff` LUI-MÊME — pas le texte des journaux, où l'agent peut citer
  // la correction qu'il n'a pas pu appliquer (faux positif du premier essai).
  const productions = resultats.flat().filter((r) => r && typeof r === 'object');
  const diffs = productions.map((r) => (typeof r.diff === 'string' ? r.diff : '')).join('\n');
  etape(
    'le diff (champ diff) corrige calc.js',
    /calc\.js/.test(diffs) && /\+\s*return a \+ b/.test(diffs),
    diffs ? `${diffs.length} octets de diff` : 'diff vide',
  );
  for (const r of productions.filter((x) => x.success === false)) {
    etape(
      'raison d’échec rendue par l’ouvrière',
      true,
      String(r.logs ?? '')
        .split('\n')[0]
        .slice(0, 220),
    );
  }

  // L'onglet Résultats de l'espace de travail.
  const ongletResultats = page
    .locator('[data-onglet="resultats"], button:has-text("Résultats")')
    .first();
  if (await ongletResultats.count()) {
    await ongletResultats.click();
    await page.waitForTimeout(1500);
  }
  await photo('05-resultats');
  const diffVisible = await page.locator('text=calc.js').count();
  etape(
    'le diff est visible dans l’accueil',
    diffVisible > 0,
    `${diffVisible} mention(s) de calc.js`,
  );

  // La validation, posée depuis l'accueil : on ouvre le diff d'une production.
  const boutonDiff = page.getByRole('button', { name: 'Diff' }).first();
  if (await boutonDiff.count()) {
    await boutonDiff.click();
    await page.waitForTimeout(1500);
    await photo('05b-diff');
  }
  const approuver = page.getByRole('button', { name: /^Approuver/ }).first();
  if (await approuver.count()) {
    await approuver.click();
    const revue = await attendre(
      async () => {
        const r = await api('/api/reviews');
        const v = Object.values(r.reviews ?? {});
        return v.length > 0 ? r.reviews : null;
      },
      20_000,
      'la validation n’arrive pas à la Reine',
    );
    etape('validation enregistrée côté Reine', true, JSON.stringify(revue).slice(0, 160));
  } else {
    etape('validation enregistrée côté Reine', false, 'aucun bouton « Approuver » visible');
  }
  await photo('06-valide');

  // Reconnexion : on recharge, le contexte doit tenir (mission, historique).
  await page.reload();
  await page
    .locator('[data-testid="mc-liaison"][data-etat="connecte"]')
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await photo('07-apres-rechargement');
  const missions = await api(`/api/projects/${projet.id}/missions`, { jwt });
  etape(
    'historique conservé après rechargement',
    (missions.missions ?? []).length > 0,
    `${(missions.missions ?? []).length} mission(s)`,
  );

  await page.goto(`${HTTP}/#/chronique`);
  await page.waitForTimeout(2500);
  await photo('08-historique');
  etape(
    'erreurs de console pendant le parcours',
    erreurs.length === 0,
    erreurs.slice(0, 5).join(' / '),
  );
} catch (e) {
  code = 1;
  etape('ÉCHEC', false, e instanceof Error ? e.message : String(e));
  rapport.journalReine = reine.journal().split('\n').slice(-80);
} finally {
  rapport.fin = new Date().toISOString();
  writeFileSync(path.join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));
  if (navigateur) await navigateur.close();
  for (const p of vivants) {
    try {
      p.kill('SIGTERM');
    } catch {
      /* déjà mort */
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
  for (const p of vivants) {
    try {
      p.kill('SIGKILL');
    } catch {
      /* déjà mort */
    }
  }
  console.log(`\nDossier de travail : ${D}\nRapport : ${path.join(SORTIE, 'rapport.json')}`);
  process.exitCode = code;
}
