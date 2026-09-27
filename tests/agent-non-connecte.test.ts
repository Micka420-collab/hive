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

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectBestAgent,
  inventaireAgents,
  nonConnecte,
  refusNonConnecte,
  requisitionSiCredentialsManquantes,
  sessionDeLAgent,
  STATUT_MAX_MS,
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

/** Répond à `--version`, et à la commande de statut par `statut` (corps shell). */
const cli = (statut: string): string =>
  `if [ "$1" = "--version" ]; then echo "1.0.0"; exit 0; fi\n${statut}`;

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
    'PAS DE RÉPONSE : le délai tranche en « inconnue », et la détection reste bornée',
    async () => {
      const d = fauxCli({ 'cursor-agent': cli('exec sleep 30') });
      const debut = Date.now();
      expect(await sessionDeLAgent('cursor', [path.join(d, 'cursor-agent')])).toBe('inconnue');
      expect(Date.now() - debut).toBeLessThan(STATUT_MAX_MS + 2_000);
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

/** Un lanceur de statut qui rend ces réponses, par binaire. */
function statuts(reponses: Record<string, { code: number; sortie: string }>): LanceurStatut {
  return (commande) => Promise.resolve(reponses[commande[0] ?? ''] ?? null);
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
