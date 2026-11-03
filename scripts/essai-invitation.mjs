// L'ESSAI DE L'INVITATION — deux environnements distincts, un lien, aucune IA.
//
//   node scripts/essai-invitation.mjs
//
// ─── CE QU'IL PROUVE ────────────────────────────────────────────────────────
//
// Le parcours « Inviter » de la directive Hive Studio (§ 5) et son scénario
// « invitation entre deux environnements distincts » (§ 9), sur une vraie
// Reine, de vrais processus et un vrai navigateur — rien de simulé, sauf
// l'agent de la machine invitée (`HIVE_AGENT=shell`) : l'invitation est le
// sujet, pas l'agent, et l'essai ne coûte aucun crédit.
//
//   · l'hôte ouvre l'accueil, clique « Inviter », choisit « Une machine » : un
//     lien de porte, qui ne contient pas le jeton de la ruche ;
//   · l'invité ouvre ce lien dans un AUTRE navigateur (contexte vierge, sans
//     compte ni jeton) : il voit la porte, et l'hôte voit « lien ouvert » ;
//   · la machine invitée — un autre dossier, un autre profil (`HOME`), une
//     autre identité — entre avec `hive join <lien>` : l'hôte la voit entrer,
//     puis dans la colonne des agents ;
//   · le même lien rejoué par une troisième machine, un lien expiré, un lien
//     révoqué depuis l'Intendance : trois refus ;
//   · la machine invitée est coupée, puis relancée SANS lien : elle revient
//     avec la même identité, sans doublon ;
//   · une personne : un second compte, qui ne lit rien du projet privé tant
//     qu'il n'est pas admis, l'est depuis « Inviter → Une personne », puis le
//     voit dans son propre navigateur ;
//   · le journal garde la trace des gestes.
//
// Chaque pas est écrit, réussi ou non, dans `captures-ecran/<sortie>/
// rapport.json`, avec ses captures. Un pas qui échoue est un ✘ — c'est le
// rapport qu'on lit.
//
// ─── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────
//
// Deux environnements sur UNE machine, reliés par la boucle locale : ni NAT, ni
// pare-feu, ni TLS. Le passage par Internet (tunnel, `wss://`) reste à éprouver
// entre deux machines réelles. Variables : `E2E_PORT` (7795), `E2E_SORTIE`
// (`essai-invitation`).

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

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 7795);
const SORTIE = path.join(RACINE, 'captures-ecran', process.env.E2E_SORTIE ?? 'essai-invitation');
mkdirSync(SORTIE, { recursive: true });
const D = mkdtempSync(path.join(os.tmpdir(), 'hive-invitation-'));
const JETON = randomBytes(24).toString('hex');
const HTTP = `http://127.0.0.1:${PORT}`;
// L'adresse que les billets annoncent : sans elle, la Reine annoncerait son
// adresse de réseau local, sur laquelle elle n'écoute pas (`HIVE_HOST`).
const WS = `ws://127.0.0.1:${PORT}/ws`;

const rapport = { debut: new Date().toISOString(), etapes: [] };
const vivants = new Set();

function etape(nom, ok, detail = '') {
  rapport.etapes.push({ nom, ok, detail, a: new Date().toISOString() });
  console.log(`${ok ? '✔' : '✘'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

const HERITEES = [
  'PATH',
  'PATHEXT',
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
];
const base = {};
for (const [k, v] of Object.entries(process.env)) {
  if (HERITEES.includes(k.toUpperCase())) base[k] = v;
}

/** Un processus de la ruche (`scripts/lancer.mjs`), ce qu'il dit, et sa fin. */
function lancer(nom, entree, { env, cwd = D, args = [] }) {
  const proc = spawn(
    process.execPath,
    [path.join(RACINE, 'scripts', 'lancer.mjs'), entree, ...args],
    { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const lignes = [];
  for (const f of [proc.stdout, proc.stderr]) {
    f.setEncoding('utf8');
    f.on('data', (b) => {
      for (const l of b.split('\n')) if (l.trim()) lignes.push(l.trim());
      if (lignes.length > 300) lignes.splice(0, lignes.length - 300);
    });
  }
  vivants.add(proc);
  const fin = new Promise((r) =>
    proc.on('exit', (code) => {
      vivants.delete(proc);
      r(code);
    }),
  );
  return { nom, proc, fin, journal: () => lignes.join('\n') };
}

/** Tuer un processus ET ses enfants : sous Windows, `kill` n'atteint pas l'arbre. */
function tuer(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    proc.kill('SIGTERM');
  }
}

/** La fin d'un processus, bornée : un refus doit être RAPIDE, pas une attente. */
async function issue(p, ms) {
  const code = await Promise.race([p.fin, new Promise((r) => setTimeout(() => r('délai'), ms))]);
  if (code === 'délai') tuer(p.proc);
  return code;
}

/** Ce que le processus a dit de plus parlant : sa dernière ligne d'échec. */
function motif(p) {
  const lignes = p.journal().split('\n').filter(Boolean);
  const echec = lignes.filter((l) => /^✘/.test(l));
  return (echec.at(-1) ?? lignes.at(-1) ?? '').slice(0, 220);
}

async function requete(chemin, { method = 'GET', corps, jwt, jeton = true } = {}) {
  const headers = {};
  if (corps !== undefined) headers['content-type'] = 'application/json';
  if (jeton) headers['x-hive-token'] = JETON;
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const r = await fetch(HTTP + chemin, {
    method,
    headers,
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null;
  try {
    json = JSON.parse(texte);
  } catch {
    /* texte brut */
  }
  return { status: r.status, json, texte };
}

async function api(chemin, options = {}) {
  const r = await requete(chemin, options);
  if (r.status >= 400) {
    throw new Error(`${options.method ?? 'GET'} ${chemin} → ${r.status} ${r.texte.slice(0, 300)}`);
  }
  return r.json;
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

/** Un environnement d'invité : son dossier, son profil, son atelier — rien de partagé. */
function environnement(nom) {
  const dossier = path.join(D, nom);
  const profil = path.join(dossier, 'profil');
  mkdirSync(profil, { recursive: true });
  return {
    nom,
    dossier,
    env: {
      ...base,
      HOME: profil,
      USERPROFILE: profil,
      HIVE_AGENT: 'shell',
      HIVE_NODE_NAME: nom,
      HIVE_OWNER_NAME: 'Invitée',
      HIVE_WORKDIR: path.join(dossier, 'atelier'),
      HIVE_MAX_CONCURRENCY: '1',
      HIVE_ISOLEMENT: 'off',
    },
  };
}

const rejoindre = (envt, args) =>
  lancer(`join-${envt.nom}`, 'src/node-client/join.ts', {
    env: envt.env,
    cwd: envt.dossier,
    args,
  });

const noeudsNommes = async (nom) => (await api('/api/state')).nodes.filter((n) => n.name === nom);

/** Un lien refusé : le processus d'entrée doit s'arrêter seul, en échec, sans nœud. */
async function refuse(nomEtape, envt, lien) {
  const debut = Date.now();
  const p = rejoindre(envt, [lien]);
  const code = await issue(p, 60_000);
  const entre = (await noeudsNommes(envt.nom)).length > 0;
  rapport.journaux ??= {};
  rapport.journaux[envt.nom] = p.journal().split('\n').slice(-25);
  etape(
    nomEtape,
    code !== 0 && code !== 'délai' && !entre,
    `code ${code} en ${Math.round((Date.now() - debut) / 1000)} s — ${motif(p)}`,
  );
}

const reine = lancer('reine', 'src/orchestrator/main.ts', {
  env: {
    ...base,
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? D,
    USERPROFILE: process.env.USERPROFILE ?? process.env.HOME ?? D,
    HIVE_HOST: '127.0.0.1',
    HIVE_PORT: String(PORT),
    HIVE_TOKEN: JETON,
    HIVE_JWT_SECRET: randomBytes(32).toString('hex'),
    HIVE_DB: path.join(D, 'hive.db'),
    HIVE_PUBLIC_URL: WS,
  },
});

let navigateur;
let code = 0;
const pages = [];
try {
  await attendre(() => api('/api/pulse'), 60_000, 'la Reine ne répond pas');
  etape('Reine en ligne', true, HTTP);

  const hote = await api('/api/auth/register', {
    method: 'POST',
    corps: {
      email: 'hote@exemple.invalid',
      displayName: 'Micka Hôte',
      password: randomBytes(16).toString('hex'),
    },
  });
  const jwtHote = hote.token;
  const projet = await api('/api/projects/user', {
    method: 'POST',
    jwt: jwtHote,
    corps: { name: 'Projet privé', description: 'Essai de l’invitation' },
  });
  etape('hôte (premier compte, administrateur) et projet privé créés', true, projet.id);

  navigateur = await chromium.launch();
  const ouvrir = async (nom, stockage) => {
    const contexte = await navigateur.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'fr-FR',
      colorScheme: 'dark',
    });
    if (stockage) {
      await contexte.addInitScript((v) => {
        for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x);
      }, stockage);
    }
    const page = await contexte.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') erreurs.push(m.text().slice(0, 240));
    });
    pages.push({ nom, erreurs });
    return page;
  };
  const photo = async (page, nom) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SORTIE, `${nom}.png`) });
  };
  const accueil = async (page) => {
    await page.goto(`${HTTP}/#/studio`);
    await page
      .locator('[data-testid="mc-liaison"][data-etat="connecte"]')
      .waitFor({ timeout: 30_000 });
  };
  const ouvrirInviter = async (page, genre) => {
    await page.getByRole('button', { name: 'Inviter', exact: true }).first().click();
    await page.getByRole('button', { name: genre }).click();
  };
  const attendreTexte = async (nomEtape, locator) => {
    try {
      await locator.waitFor({ timeout: 20_000 });
      etape(nomEtape, true, ((await locator.textContent()) ?? '').trim().slice(0, 160));
    } catch (e) {
      etape(nomEtape, false, String(e.message).split('\n')[0]);
    }
  };

  // ─── 1. L'hôte : Inviter → Une machine ────────────────────────────────────
  const A = await ouvrir('hôte', { 'hive.token': JETON, 'hive.jwt': jwtHote, 'hive.lang': 'fr' });
  await accueil(A);
  await ouvrirInviter(A, /Une machine/);
  const champ = A.locator('.porte-lien-champ');
  await champ.waitFor({ timeout: 20_000 });
  const lien = await champ.inputValue();
  etape(
    '« Inviter → Une machine » compose un lien de porte',
    /#hive2_/.test(lien),
    lien.replace(/#.*/, '#…'),
  );
  etape('le lien ne contient pas le jeton de la ruche', !lien.includes(JETON));
  await photo(A, '01-lien-machine');

  // ─── 2. L'invité ouvre le lien dans un AUTRE navigateur ───────────────────
  const B = await ouvrir('invité (porte)', null);
  await B.goto(lien);
  await B.waitForTimeout(2500);
  const texte = await B.locator('body').innerText();
  etape(
    'l’invité voit la porte (autre navigateur, sans compte ni jeton)',
    texte.trim().length > 0,
    texte
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' · ')
      .slice(0, 220),
  );
  etape('la porte ne montre pas le jeton de la ruche', !(await B.content()).includes(JETON));
  await photo(B, '02-porte-vue-par-invite');
  await attendreTexte(
    'l’hôte voit que le lien a été ouvert',
    A.locator('[data-testid="porte-arrivee"]', { hasText: 'Lien ouvert' }),
  );

  // ─── 3. La machine invitée entre ──────────────────────────────────────────
  const envB = environnement('machine-invitee');
  let invitee = rejoindre(envB, [lien]);
  let noeudB;
  try {
    noeudB = await attendre(
      async () => (await noeudsNommes(envB.nom)).find((n) => n.status === 'online') ?? null,
      90_000,
      'la machine invitée n’entre pas',
    );
  } catch (e) {
    etape('la machine invitée entre avec le lien', false, `${e.message} — ${motif(invitee)}`);
    throw e;
  }
  etape(
    'la machine invitée entre avec le lien (autre dossier, autre profil)',
    true,
    `${noeudB.name} · ${noeudB.agentType} · ${noeudB.id}`,
  );
  await attendreTexte(
    'l’hôte la voit entrer, dans la fenêtre d’invitation',
    A.locator('[data-testid="porte-arrivee"]', { hasText: 'est entrée' }),
  );
  await photo(A, '03-entree-vue-par-hote');
  await A.keyboard.press('Escape');
  await A.waitForTimeout(1500);
  const mentions = await A.getByText(envB.nom).count();
  etape('elle apparaît dans la colonne des agents', mentions > 0, `${mentions} mention(s)`);
  await photo(A, '04-colonne-agents');

  // ─── 4. Trois liens refusés : rejoué, expiré, révoqué ─────────────────────
  await refuse(
    'le même lien, rejoué par une autre machine, est refusé',
    environnement('machine-intruse'),
    lien,
  );

  // La Reine borne la durée de vie d'un billet à une minute au moins
  // (`bornerTtl`) : on attend l'échéance qu'ELLE a fixée, pas celle demandée.
  const expire = await api('/api/billets', {
    method: 'POST',
    jwt: jwtHote,
    corps: { label: 'billet-expire', ttlMs: 60_000 },
  });
  const attente = Math.max(0, (expire.expiresAt ?? Date.now() + 60_000) - Date.now()) + 1500;
  etape(
    'billet d’une minute émis — on attend son échéance',
    true,
    `${Math.round(attente / 1000)} s`,
  );
  await new Promise((r) => setTimeout(r, attente));
  await refuse(
    'un lien expiré est refusé',
    environnement('machine-en-retard'),
    expire.lien ?? expire.billet,
  );

  const arevoquer = await api('/api/billets', {
    method: 'POST',
    jwt: jwtHote,
    corps: { label: 'billet-a-revoquer' },
  });
  await A.goto(`${HTTP}/#/intendance`);
  const ligne = A.locator('li', { hasText: 'billet-a-revoquer' });
  try {
    await ligne.getByRole('button', { name: 'Révoquer' }).click({ timeout: 20_000 });
    await ligne.getByRole('button', { name: 'Révoquer' }).waitFor({
      state: 'detached',
      timeout: 15_000,
    });
    etape('révoqué d’un geste dans l’Intendance', true, (await ligne.innerText()).slice(0, 120));
  } catch (e) {
    etape('révoqué d’un geste dans l’Intendance', false, String(e.message).split('\n')[0]);
    await api(`/api/billets/${encodeURIComponent(arevoquer.id)}`, {
      method: 'DELETE',
      jwt: jwtHote,
    });
  }
  await photo(A, '05-intendance-revoque');
  await refuse(
    'un lien révoqué est refusé',
    environnement('machine-revoquee'),
    arevoquer.lien ?? arevoquer.billet,
  );

  // ─── 5. Coupée, puis relancée SANS lien ───────────────────────────────────
  tuer(invitee.proc);
  await invitee.fin;
  await attendre(
    async () => {
      const n = (await noeudsNommes(envB.nom)).find((x) => x.id === noeudB.id);
      return !n || n.status !== 'online';
    },
    60_000,
    'la Reine ne voit pas la coupure',
  );
  etape('la coupure de la machine invitée est vue par la Reine', true);
  invitee = rejoindre(envB, []);
  try {
    const memes = await attendre(
      async () => {
        const n = await noeudsNommes(envB.nom);
        return n.some((x) => x.status === 'online') ? n : null;
      },
      90_000,
      'la machine invitée ne revient pas',
    );
    const enLigne = memes.find((x) => x.status === 'online');
    etape(
      'relancée sans lien, elle revient avec la même identité, sans doublon',
      enLigne.id === noeudB.id && memes.length === 1,
      `${enLigne.id} · ${memes.length} nœud(s) à ce nom`,
    );
  } catch (e) {
    etape('relancée sans lien, elle revient', false, `${e.message} — ${motif(invitee)}`);
  }

  // ─── 6. Une personne : un second compte, admis depuis « Inviter » ─────────
  const personne = await api('/api/auth/register', {
    method: 'POST',
    corps: {
      email: 'camille@exemple.invalid',
      displayName: 'Camille Invitée',
      password: randomBytes(16).toString('hex'),
    },
  });
  const jwtP = personne.token;
  const moi = await api('/api/auth/me', { jwt: jwtP, jeton: false });
  const idP = moi?.id;
  etape('second compte créé', Boolean(jwtP && idP), `rôle ${moi?.role ?? personne.role ?? '?'}`);
  // Les lectures de la personne passent par SON compte seul : jamais par le
  // jeton de la ruche, qui ouvrirait tout et rendrait l'épreuve vide.
  const avant = await requete(`/api/projects/${projet.id}/members`, { jwt: jwtP, jeton: false });
  etape(
    'avant d’être admise, la personne ne lit rien du projet privé',
    avant.status === 404 || avant.status === 403,
    `HTTP ${avant.status}`,
  );

  await accueil(A);
  await ouvrirInviter(A, /Une personne/);
  await A.getByLabel('Identifiant du compte').fill(idP);
  await A.getByRole('button', { name: 'Admettre' }).click();
  await attendreTexte(
    'l’hôte l’admet depuis « Inviter → Une personne »',
    A.locator('.modal, [role="dialog"]').getByText('Camille Invitée').first(),
  );
  await photo(A, '06-personne-admise');
  const apres = await requete(`/api/projects/${projet.id}/members`, { jwt: jwtP, jeton: false });
  etape(
    'admise, elle lit l’équipe du projet — et s’y trouve',
    apres.status === 200 && JSON.stringify(apres.json).includes(idP),
    `HTTP ${apres.status}`,
  );

  const P = await ouvrir('personne admise', { 'hive.jwt': jwtP, 'hive.lang': 'fr' });
  await P.goto(`${HTTP}/#/studio`);
  await P.waitForTimeout(5000);
  const voit = await P.getByText('Projet privé').count();
  const mur = await P.getByText(/Jeton refusé|HIVE_TOKEN/).count();
  etape(
    'dans son propre navigateur, la personne admise voit le projet',
    voit > 0,
    voit > 0
      ? `${voit} mention(s)`
      : mur > 0
        ? 'le tableau de bord exige le jeton de la ruche (HIVE_TOKEN) : un compte membre n’y suffit pas'
        : 'aucune mention du projet',
  );
  await photo(P, '07-vue-de-la-personne');

  // ─── 7. Le journal ────────────────────────────────────────────────────────
  const evenements = await api('/api/events?since=0&limit=1000');
  const liste = Array.isArray(evenements) ? evenements : (evenements?.events ?? []);
  const types = [...new Set(liste.map((e) => e.type))];
  const gestes = types.filter((t) =>
    /invite|porte|node_joined|node_left|member|membre|billet/.test(t),
  );
  etape(
    'le journal garde la trace des gestes',
    ['porte_ouverte', 'node_joined', 'invite_revoked'].every((t) => types.includes(t)),
    gestes.join(', '),
  );

  for (const p of pages) {
    etape(
      `erreurs de console — ${p.nom}`,
      p.erreurs.length === 0,
      p.erreurs.slice(0, 4).join(' / '),
    );
  }
} catch (e) {
  code = 1;
  etape('ÉCHEC', false, e instanceof Error ? e.message : String(e));
  rapport.journalReine = reine.journal().split('\n').slice(-60);
} finally {
  rapport.fin = new Date().toISOString();
  rapport.reussis = rapport.etapes.filter((x) => x.ok).length;
  rapport.echoues = rapport.etapes.filter((x) => !x.ok).length;
  if (rapport.echoues > 0) code = 1;
  writeFileSync(path.join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));
  if (navigateur) await navigateur.close();
  for (const p of vivants) tuer(p);
  await new Promise((r) => setTimeout(r, 1500));
  console.log(
    `\n${rapport.reussis} pas réussis, ${rapport.echoues} en échec.` +
      `\nDossier de travail : ${D}\nRapport : ${path.join(SORTIE, 'rapport.json')}`,
  );
  process.exitCode = code;
}
