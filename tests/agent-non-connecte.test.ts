// INSTALLÉ N'EST PAS CONNECTÉ — la détection demande au CLI s'il l'est.
//
// ─── LE DÉFAUT, MESURÉ PENDANT LA PREUVE V2 ALPHA ────────────────────────────
//
// Sur la machine de la preuve, `cursor-agent status` répondait « Not logged
// in ». La ruche lançait pourtant une ouvrière Cursor, l'inscrivait, et la
// preuve la comptait parmi ses « 3 ouvrières réelles » : la détection ne
// demandait que `--version`, et les identifiants comptaient le dossier
// `~/.cursor`, que le CLI crée dès son installation. Chaque tâche confiée à
// cette ouvrière aurait échoué « non authentifié ».
//
// ─── CE QUE CE BANC TIENT ────────────────────────────────────────────────────
//
// Les quatre réponses qu'un CLI peut faire à sa commande de statut — connecté,
// non connecté, commande inconnue (un CLI plus ancien), pas de réponse (délai)
// — jouées par de FAUX CLI, de vrais exécutables lancés par le vrai lanceur
// (POSIX : un script `#!/bin/sh`). Les formats sont ceux mesurés le 27
// septembre 2026 sur les CLI réels (`agent-detect.ts`). Aucun crédit ne peut
// partir d'ici : les faux CLI ne parlent à personne.
//
// Puis la règle, pure : un agent n'est écarté que sur SA parole, jamais sur une
// supposition — et une clé posée l'en dispense.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeInvite } from '../src/shared/invite.js';
import {
  detectBestAgent,
  inventaireAgents,
  nonConnecte,
  refusNonConnecte,
  requisitionSiCredentialsManquantes,
  sessionDeLAgent,
  STATUT_MAX_MS,
  fournisseurCodexTiers,
  versionAuMoins,
  type LanceurStatut,
  type Sonde,
} from '../src/node-client/agent-detect.js';

const POSIX = process.platform !== 'win32';

const aNettoyer: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un dossier de faux CLI : `nom` → le corps d'un script shell. */
function fauxCli(scripts: Record<string, string>): string {
  const dossier = mkdtempSync(path.join(tmpdir(), 'hive-faux-cli-'));
  aNettoyer.push(dossier);
  for (const [nom, corps] of Object.entries(scripts)) {
    const f = path.join(dossier, nom);
    writeFileSync(f, `#!/bin/sh\n${corps}\n`);
    chmodSync(f, 0o755);
  }
  return dossier;
}

/**
 * Répond à `--version` (la première version de Claude Code qui connaît
 * `auth status`, voir `versionMin`), et à la commande de statut par `statut`.
 */
const cli = (statut: string, version = '2.1.40 (Claude Code)'): string =>
  `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\n${statut}`;

const CURSOR_NON_CONNECTE = cli(
  'echo \'{"status":"unauthenticated","isAuthenticated":false,"message":"Not logged in"}\'',
);
const CLAUDE_CONNECTE = cli('echo \'{"loggedIn": true, "authMethod": "claude.ai"}\'');
const CODEX_NON_CONNECTE = cli('echo "Not logged in" >&2; exit 1');

describe('la commande de statut de chaque CLI, jouée par un faux CLI', () => {
  it.runIf(POSIX)('CONNECTÉ : Claude Code dit `"loggedIn": true`', async () => {
    const d = fauxCli({ claude: CLAUDE_CONNECTE });
    expect(await sessionDeLAgent('claude-code', [path.join(d, 'claude')])).toBe('connectee');
  });

  it.runIf(POSIX)(
    'NON CONNECTÉ : Cursor le dit en JSON — et rend 0, le code ne dit donc rien',
    async () => {
      const d = fauxCli({ 'cursor-agent': CURSOR_NON_CONNECTE });
      expect(await sessionDeLAgent('cursor', [path.join(d, 'cursor-agent')])).toBe('non_connectee');
    },
  );

  it.runIf(POSIX)('NON CONNECTÉ : Codex le dit en texte, code 1', async () => {
    const d = fauxCli({ codex: CODEX_NON_CONNECTE });
    expect(await sessionDeLAgent('codex', [path.join(d, 'codex')])).toBe('non_connectee');
    const connecte = fauxCli({ codex: cli('echo "Logged in using ChatGPT"') });
    expect(await sessionDeLAgent('codex', [path.join(connecte, 'codex')])).toBe('connectee');
  });

  it.runIf(POSIX)(
    'COMMANDE INCONNUE (un CLI plus ancien) : « inconnue », jamais « non connecté »',
    async () => {
      const d = fauxCli({
        claude: cli('echo "error: unknown command \'auth\'" >&2; exit 1'),
      });
      expect(await sessionDeLAgent('claude-code', [path.join(d, 'claude')])).toBe('inconnue');
    },
  );

  it.runIf(POSIX)(
    'PAS DE RÉPONSE : le délai tranche en « inconnue », borné — et l’ARBRE entier est abattu',
    async () => {
      // `cursor-agent` est un script qui lance Node : le faux lance lui aussi
      // un petit-enfant, et note son pid. Tuer le seul script le laissait vivre.
      const d = fauxCli({
        'cursor-agent': cli('sleep 30 & echo $! > "$(dirname "$0")/petit"; wait'),
      });
      const debut = Date.now();
      expect(await sessionDeLAgent('cursor', [path.join(d, 'cursor-agent')])).toBe('inconnue');
      expect(Date.now() - debut).toBeLessThan(STATUT_MAX_MS + 2_000);
      const petit = Number(readFileSync(path.join(d, 'petit'), 'utf8'));
      const vivant = (): boolean => {
        try {
          process.kill(petit, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 40 && vivant(); i++) await new Promise((r) => setTimeout(r, 50));
      expect(vivant(), 'le petit-enfant de la sonde survit à son délai').toBe(false);
    },
    STATUT_MAX_MS + 10_000,
  );

  it.runIf(POSIX)(
    'LA MACHINE DE LA PREUVE, REJOUÉE DE BOUT EN BOUT — vraies sondes, faux CLI sur le PATH',
    async () => {
      // Claude Code connecté, Cursor non connecté, Codex non connecté mais sa
      // clé posée. Le PATH ne contient QUE les faux : un vrai CLI installé sur
      // la machine du banc ne doit pas s'inviter.
      const d = fauxCli({
        claude: CLAUDE_CONNECTE,
        'cursor-agent': CURSOR_NON_CONNECTE,
        codex: CODEX_NON_CONNECTE,
      });
      vi.stubEnv('PATH', d);
      const env = { HOME: d, CODEX_API_KEY: 'cle-de-banc' };
      const inventaire = await inventaireAgents(env, undefined, 'linux', () => false);
      expect(inventaire.tous).toEqual(['claude-code', 'codex', 'shell']);
      expect(inventaire.nonConnectes.map((n) => n.agent)).toEqual(['cursor']);
      expect(inventaire.nonConnectes[0]?.detail).toContain('`cursor-agent login`');
      expect(inventaire.nonConnectes[0]?.detail).toContain('CURSOR_API_KEY');
    },
    30_000,
  );
});

/** Une sonde de présence qui trouve exactement ces binaires. */
const presents =
  (...bins: string[]): Sonde =>
  (argv) =>
    Promise.resolve(bins.includes(argv[0] ?? ''));

/** Un lanceur de statut qui rend ces réponses, par binaire — et une version récente à `--version`. */
function statuts(reponses: Record<string, { code: number; sortie: string }>): LanceurStatut {
  return (commande, args) =>
    Promise.resolve(
      args[0] === '--version'
        ? { code: 0, sortie: '2.1.40 (Claude Code)' }
        : (reponses[commande[0] ?? ''] ?? null),
    );
}

const CURSOR_DIT_NON = { code: 0, sortie: '{"isAuthenticated": false}' };
const CLAUDE_DIT_NON = { code: 1, sortie: '{"loggedIn": false}' };

describe('la règle : écarté sur SA parole, jamais sur une supposition', () => {
  it('UN CURSOR NON CONNECTÉ N’EST NI CHOISI NI ANNONCÉ — le Codex qui suit l’est', async () => {
    const sonde = presents('cursor-agent', 'codex');
    const statut = statuts({ 'cursor-agent': CURSOR_DIT_NON });
    expect((await detectBestAgent({}, sonde, 'linux', () => false, statut)).agent).toBe('codex');
    const inventaire = await inventaireAgents({}, sonde, 'linux', () => false, statut);
    expect(inventaire.tous).toEqual(['codex', 'shell']);
    expect(inventaire.nonConnectes.map((n) => n.agent)).toEqual(['cursor']);
  });

  it('UNE CLÉ POSÉE EN DISPENSE — CURSOR_API_KEY, et Cursor redevient utilisable', async () => {
    const inventaire = await inventaireAgents(
      { CURSOR_API_KEY: 'cle' },
      presents('cursor-agent'),
      'linux',
      () => false,
      statuts({ 'cursor-agent': CURSOR_DIT_NON }),
    );
    expect(inventaire.tous).toEqual(['cursor', 'shell']);
    expect(inventaire.nonConnectes).toEqual([]);
  });

  it('UNE SONDE INJECTÉE NE LANCE AUCUN STATUT — la session reste inconnue, l’agent reste', async () => {
    // Même règle que la signature : un banc qui injecte sa sonde décide seul.
    // Sans elle, un banc qui simule `cursor-agent` interrogerait le VRAI CLI
    // de la machine qui le fait tourner.
    const inventaire = await inventaireAgents({}, presents('cursor-agent'), 'linux', () => false);
    expect(inventaire.tous).toEqual(['cursor', 'shell']);
  });

  it('`~/.cursor` EXISTE, LE CLI DIT « NON CONNECTÉ » : c’est le CLI qui a raison', () => {
    // LE défaut, à la source : le dossier existe dès l'installation. Sur le
    // code d'avant, ce poste avait une « session » Cursor.
    const existe = (): boolean => true;
    const env = { HOME: '/home/abeille' };
    const req = requisitionSiCredentialsManquantes('cursor', env, {
      existe,
      plateforme: 'linux',
      session: 'non_connectee',
    });
    expect(req, 'un dossier ~/.cursor vaut encore une session').not.toBeNull();
    expect(req?.detail).toContain('non connecté');
    // Et la parole du CLI vaut dans l'autre sens : connecté sans dossier visible.
    expect(
      requisitionSiCredentialsManquantes('claude-code', env, {
        existe: () => false,
        plateforme: 'linux',
        session: 'connectee',
      }),
    ).toBeNull();
    // Inconnue : la règle d'avant, le dossier décide.
    expect(
      requisitionSiCredentialsManquantes('cursor', env, { existe, plateforme: 'linux' }),
    ).toBeNull();
  });

  it('DANS LE BAC, la parole du CLI ne compte pas : sa session de l’hôte n’y entre pas', () => {
    const req = requisitionSiCredentialsManquantes(
      'claude-code',
      { HOME: '/home/abeille' },
      { existe: () => true, plateforme: 'linux', sessionsHote: false, session: 'connectee' },
    );
    expect(req?.detail).toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('non connecté SANS statut connu : jamais — Cline, Grok n’en ont pas', () => {
    expect(nonConnecte({ agent: 'grok', session: 'inconnue' }, {})).toBeNull();
    expect(nonConnecte({ agent: 'claude-code', session: 'non_connectee' }, {})).toContain(
      '`claude login`',
    );
    expect(
      nonConnecte({ agent: 'claude-code', session: 'non_connectee' }, { ANTHROPIC_API_KEY: 'k' }),
    ).toBeNull();
  });

  it('UN NŒUD À QUI L’ON IMPOSE UN AGENT NON CONNECTÉ REFUSE — et nomme le remède', async () => {
    const inventaire = await inventaireAgents(
      {},
      presents('claude'),
      'linux',
      () => false,
      statuts({ claude: CLAUDE_DIT_NON }),
    );
    const refus = refusNonConnecte('claude-code', inventaire);
    expect(refus).toContain('Claude Code est installé mais non connecté');
    expect(refus).toContain('HIVE_AGENT=claude-code');
    expect(refusNonConnecte('codex', inventaire)).toBeNull();
  });
});

describe('ce que la review a relevé', () => {
  it.runIf(POSIX)(
    'UN CLAUDE CODE D’AVANT 2.1.40 N’EST PAS QUESTIONNÉ — `auth status` y serait un prompt facturé',
    async () => {
      // Mesuré sur les paquets npm, HOME vide : 2.1.39 prend « auth status »
      // pour un prompt (« Not logged in · Please run /login »), 2.1.40 rend le
      // JSON. Le faux note chaque appel : seul `--version` doit y être.
      const note = 'echo "$@" >> "$(dirname "$0")/appels"';
      const d = fauxCli({
        claude: `${note}\n${cli('echo \'{"loggedIn": false}\'', '2.1.39 (Claude Code)')}`,
      });
      expect(await sessionDeLAgent('claude-code', [path.join(d, 'claude')])).toBe('inconnue');
      expect(readFileSync(path.join(d, 'appels'), 'utf8').trim().split('\n')).toEqual([
        '--version',
      ]);
      expect(versionAuMoins('2.1.40 (Claude Code)', [2, 1, 40])).toBe(true);
      expect(versionAuMoins('2.2.0', [2, 1, 40])).toBe(true);
      expect(versionAuMoins('1.0.128 (Claude Code)', [2, 1, 40])).toBe(false);
      expect(versionAuMoins('illisible', [2, 1, 40])).toBe(false);
    },
  );

  it('UN CODEX SUR UN AUTRE FOURNISSEUR N’EST PAS « NON CONNECTÉ » — il tourne sans session OpenAI', async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), 'hive-codex-home-'));
    aNettoyer.push(codexHome);
    const env = { CODEX_HOME: codexHome, HOME: '/nulle-part' };
    const ecrire = (toml: string): void => writeFileSync(path.join(codexHome, 'config.toml'), toml);
    const lancer = statuts({ codex: { code: 1, sortie: 'Not logged in' } });
    const inventaire = () => inventaireAgents(env, presents('codex'), 'linux', () => false, lancer);

    // Le fournisseur par défaut : sa parole vaut, il est écarté.
    expect(fournisseurCodexTiers(env)).toBeNull();
    expect((await inventaire()).nonConnectes.map((n) => n.agent)).toEqual(['codex']);

    // `model_provider = "ollama"` : « Not logged in » ne dit plus rien.
    ecrire(
      'model = "qwen"\nmodel_provider = "ollama"\n\n[model_providers.ollama]\nname = "Ollama"\n',
    );
    expect(fournisseurCodexTiers(env)).toBe('ollama');
    expect((await inventaire()).tous).toEqual(['codex', 'shell']);

    // Le fournisseur du PROFIL retenu compte, pas celui d'un autre profil.
    ecrire(
      'profile = "local"\n[profiles.local]\nmodel_provider = "azure"\n[profiles.x]\nmodel_provider = "openai"\n',
    );
    expect(fournisseurCodexTiers(env)).toBe('azure');
    ecrire('[profiles.local]\nmodel_provider = "azure"\n');
    expect(fournisseurCodexTiers(env), 'un profil non retenu ne compte pas').toBeNull();
    ecrire('model_provider = "openai"\n');
    expect(fournisseurCodexTiers(env)).toBeNull();

    // Sans CODEX_HOME : `~/.codex`, le dossier que Codex lit.
    mkdirSync(path.join(codexHome, '.codex'));
    writeFileSync(path.join(codexHome, '.codex', 'config.toml'), 'model_provider = "ollama"\n');
    expect(fournisseurCodexTiers({ HOME: codexHome })).toBe('ollama');
  });

  it('DES LIGNES AVANT LE JSON SONT TOLÉRÉES — un avertissement ne rend pas la réponse illisible', async () => {
    // Codex imprime déjà un `WARNING:` avant sa réponse (HOME vide) ; un CLI
    // qui fait de même avant son JSON doit rester lu. Un `JSON.parse` strict
    // lirait « inconnue », et ce Cursor non connecté serait annoncé.
    const inventaire = await inventaireAgents(
      {},
      presents('cursor-agent'),
      'linux',
      () => false,
      statuts({
        'cursor-agent': {
          code: 0,
          sortie: 'WARNING: proxy ignoré\n{"isAuthenticated": false}\n',
        },
      }),
    );
    expect(inventaire.nonConnectes.map((n) => n.agent)).toEqual(['cursor']);
  });
});

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Lance un point d'entrée réel du nœud, un faux Cursor non connecté seul sur le PATH. */
function lancerNoeud(entree: string, extra: NodeJS.ProcessEnv = {}) {
  const d = fauxCli({ 'cursor-agent': CURSOR_NON_CONNECTE });
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('HIVE_') && !/KEY|TOKEN|SECRET/.test(k)) env[k] = v;
  }
  return spawnSync(process.execPath, [path.join(RACINE, 'scripts', 'lancer.mjs'), entree], {
    // Un dossier vide : aucun `.env` du poste ne s'invite.
    cwd: d,
    env: {
      ...env,
      PATH: d,
      HOME: d,
      HIVE_AGENT: 'cursor',
      HIVE_WORKDIR: path.join(d, 'travail'),
      HIVE_ISOLEMENT: 'off',
      ...extra,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('un nœud à qui l’on impose un agent non connecté ne démarre pas', () => {
  it.runIf(POSIX)(
    '`npm run node` : exit 2, et le remède sur la sortie d’erreur',
    () => {
      const r = lancerNoeud(path.join(RACINE, 'src', 'node-client', 'main.ts'), {
        HIVE_URL: 'ws://127.0.0.1:9/ws',
      });
      expect(r.stderr).toContain(
        '✘ Ce nœud ne démarre pas : Cursor est installé mais non connecté',
      );
      expect(r.stderr).toContain('`cursor-agent login`');
      expect(r.stderr).toContain('HIVE_AGENT=cursor');
      expect(r.status, r.stdout + r.stderr).toBe(2);
    },
    60_000,
  );

  it.runIf(POSIX)(
    '`hive join` : la même règle sur le chemin des amis',
    () => {
      const r = lancerNoeud(path.join(RACINE, 'src', 'node-client', 'join.ts'), {
        HIVE_INVITE: encodeInvite({
          url: 'ws://127.0.0.1:9/ws',
          token: 'jeton-de-banc-assez-long-0123',
        }),
      });
      expect(r.stderr).toContain(
        '✘ Ce nœud ne démarre pas : Cursor est installé mais non connecté',
      );
      expect(r.status, r.stdout + r.stderr).toBe(2);
    },
    60_000,
  );
});
