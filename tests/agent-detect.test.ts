// La détection d'agent — et la branche Windows que rien n'exerçait.
//
// ─── POURQUOI CE FICHIER N'EXISTAIT PAS, ET POURQUOI C'EST LE PROBLÈME ───────
//
// `agent-detect.ts` est le module qui décide si le membre a un vrai agent de
// codage ou s'il faut retomber sur l'adaptateur `shell`, qui est SIMULÉ. Se
// tromper là, c'est envoyer du vrai travail à un binaire qui produit des diffs
// vides — ou refuser un agent parfaitement installé.
//
// Il n'avait aucun test. Aucun. Et sa fonction `candidates()` lisait
// `process.platform` directement, donc sa branche Windows n'était vérifiable
// que sur une machine Windows — c'est-à-dire nulle part, jusqu'à ce que la CI
// y tourne.
//
// C'est comme ça qu'une variante impossible a survécu : la liste commençait par
// `bin.cmd`, alors que `spawn(..., { shell: false })` ne PEUT PAS lancer un
// `.cmd` sous Windows. La ligne avait l'air de couvrir un cas ; elle échouait à
// tous les coups.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  candidates,
  cheminsNatifs,
  detectBestAgent,
  requisitionSiCredentialsManquantes,
} from '../src/node-client/agent-detect.js';

describe('LES VARIANTES DE BINAIRE, PAR PLATEFORME', () => {
  it('sur un système POSIX, le nom est pris tel quel', () => {
    for (const p of ['linux', 'darwin', 'freebsd']) {
      expect(candidates('claude', p), p).toEqual(['claude']);
    }
  });

  it('SOUS WINDOWS, `.exe` D’ABORD — la seule que `spawn` sait lancer', () => {
    expect(candidates('claude', 'win32')).toEqual(['claude.exe', 'claude']);
  });

  it('ET `.cmd` N’Y EST PLUS : il ne pouvait pas aboutir', () => {
    // La garde qui compte. Node refuse d'exécuter un `.cmd` sans interpréteur
    // de commandes — documenté, et durci depuis la CVE-2024-27980. Le remettre
    // rendrait la liste plus longue et pas plus capable : une couverture
    // apparente, qui échoue à tous les coups.
    //
    // Si quelqu'un le rajoute un jour, que ce soit en sachant pourquoi.
    expect(candidates('claude', 'win32')).not.toContain('claude.cmd');
    expect(candidates('codex', 'win32')).not.toContain('codex.cmd');
  });

  it('la plateforme est un PARAMÈTRE, pas une lecture cachée', () => {
    // Sans ce paramètre, tout ce fichier serait impossible : la branche win32
    // ne serait vérifiable que sur Windows. C'est précisément ce qui a laissé
    // la variante `.cmd` en place sans que personne la mette en doute.
    expect(candidates('x', 'win32')).not.toEqual(candidates('x', 'linux'));
  });
});

describe('LE CHOIX DE L’AGENT', () => {
  it('HIVE_AGENT_CMD PRIME SUR TOUT — c’est un choix explicite du membre', async () => {
    const vu = await detectBestAgent({ HIVE_AGENT_CMD: 'mon-ia --run' });
    expect(vu.agent).toBe('custom');
  });

  it('une commande faite d’espaces ne compte pas pour un choix', async () => {
    // `''.trim()` est vide, `'   '.trim()` aussi : une variable posée par
    // accident ne doit pas détourner la détection vers une commande vide.
    const vu = await detectBestAgent({ HIVE_AGENT_CMD: '   ' });
    expect(vu.agent).not.toBe('custom');
  });

  it('AUCUN AGENT INSTALLÉ ⇒ `shell`, et son libellé dit qu’il est SIMULÉ', async () => {
    // Ce libellé n'est pas décoratif : `hive doctor` s'en sert pour ne PAS
    // compter `shell` comme un agent détecté. Quelqu'un qui n'a rien installé
    // doit l'entendre, sinon son nœud produit des diffs vides sans que personne
    // comprenne pourquoi.
    //
    // ─── CE CHEMIN N'ÉTAIT ATTEIGNABLE PAR AUCUN TEST ────────────────────────
    //
    // `env` ne sert QU'À lire `HIVE_AGENT_CMD` ; la sonde interrogeait le PATH
    // RÉEL. Sur une machine de développement, `claude` est installé, donc la
    // détection le trouvait TOUJOURS. Ma première version passait `{ PATH: '' }`
    // en croyant forcer le repli, et elle a échoué. On s'était rabattu sur une
    // garde qui lisait la source — un pis-aller, écrit comme tel.
    //
    // La sonde est maintenant injectable. Le repli se vérifie pour de vrai.
    const vu = await detectBestAgent({}, async () => false);
    expect(vu.agent).toBe('shell');
    expect(vu.label).toContain('simulé');
  });

  it('CLAUDE CODE EST PRÉFÉRÉ À CODEX quand les deux sont là', async () => {
    // L'ordre de préférence est une décision, pas un hasard de boucle : il
    // décide quel agent reçoit le travail — et le jeton — du membre.
    const vu = await detectBestAgent({}, async () => true);
    expect(vu.agent).toBe('claude-code');
  });

  it('faute de Claude Code, Cursor est pris avant Codex', async () => {
    const vu = await detectBestAgent({}, async (argv) => {
      const b = argv[0] ?? '';
      return b.startsWith('agent') || b.startsWith('cursor-agent');
    });
    expect(vu.agent).toBe('cursor');
  });

  it('faute de Claude Code et Cursor, Codex est pris — pas le repli simulé', async () => {
    const vu = await detectBestAgent({}, async (argv) => (argv[0] ?? '').startsWith('codex'));
    expect(vu.agent).toBe('codex');
  });

  it('LA SONDE VOIT LES VARIANTES DE LA PLATEFORME QU’ON LUI DONNE', async () => {
    // La couture porte aussi la plateforme : sous Windows la sonde doit être
    // interrogée sur `claude.exe`, pas seulement sur `claude`. Sans ça, la
    // branche win32 resterait invérifiable — ce qui l'avait laissée contenir
    // une variante `.cmd` que `spawn` ne peut pas lancer.
    const vus: string[] = [];
    await detectBestAgent(
      {},
      async (argv) => {
        vus.push(argv.join(' '));
        return false;
      },
      'win32',
    );
    expect(vus).toContain('claude.exe');
    expect(vus).toContain('codex.exe');
    expect(vus, 'aucune variante .cmd ne doit être sondée').not.toContain('claude.cmd');
  });

  it('SOUS WINDOWS, UN AGENT INSTALLÉ PAR NPM EST ENFIN TROUVÉ', async () => {
    // ─── LE DÉFAUT QUE CE TEST FERME ───────────────────────────────────────
    //
    // npm n'expose sous Windows qu'un shim `claude.cmd`, que `spawn` sans shell
    // ne peut pas lancer. La sonde échouait donc TOUJOURS, et le nœud retombait
    // sur l'adaptateur `shell` — qui est SIMULÉ. La ruche avait l'air de
    // tourner et produisait de faux diffs.
    //
    // La loupe a montré que RIEN ne testait le correctif : le retirer laissait
    // trente tests verts. C'est ce test-là qui manquait — pas un test de plus
    // sur `argvAgent`, mais la preuve que la DÉTECTION s'en sert.
    const APPDATA = 'C:\\Users\\moi\\AppData\\Roaming';
    const CLI = path.win32.join(
      APPDATA,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'cli.js',
    );
    // Une machine où AUCUN exécutable ne répond — seul le script est là.
    const sonde = async (argv: readonly string[]): Promise<boolean> =>
      argv[0] === 'node' && argv[1] === CLI;

    const trouve = await detectBestAgent({ APPDATA }, sonde, 'win32', (c) => c === CLI);
    expect(trouve.agent, 'un vrai agent, pas le repli simulé').toBe('claude-code');

    // ET LA MOITIÉ QUI GARDE LA PROMESSE : si le script n'est pas là, on
    // retombe exactement où on était. Le correctif ne fabrique pas d'agent.
    const absent = await detectBestAgent({ APPDATA }, sonde, 'win32', () => false);
    expect(absent.agent).toBe('shell');
  });

  it('L’INSTALLEUR NATIF EST TROUVÉ MÊME QUAND LE PATH L’IGNORE', async () => {
    // ─── LE DÉFAUT QUE CE TEST FERME ───────────────────────────────────────
    //
    // L'installeur natif de Claude Code pose son binaire dans `~/.local/bin` et
    // n'ajoute ce dossier qu'au PATH du shell de connexion. Un nœud lancé
    // autrement ne le voit pas : `spawn('claude')` rend ENOENT, la détection
    // conclut « aucun agent », et la ruche simule — sur une machine où l'agent
    // est pourtant installé.
    const NATIF = path.posix.join('/home/moi', '.local', 'bin', 'claude');
    const sonde = async (argv: readonly string[]): Promise<boolean> => argv[0] === NATIF;

    const trouve = await detectBestAgent({ HOME: '/home/moi' }, sonde, 'linux', (c) => c === NATIF);
    expect(trouve.agent, 'un vrai agent, pas le repli simulé').toBe('claude-code');

    // Et la promesse tenue : sans le fichier, rien n'est inventé.
    const absent = await detectBestAgent({ HOME: '/home/moi' }, sonde, 'linux', () => false);
    expect(absent.agent).toBe('shell');
  });

  it('les chemins natifs suivent la plateforme, et se taisent sans maison', () => {
    expect(cheminsNatifs('claude', { HOME: '/home/moi' }, 'linux')).toEqual([
      '/home/moi/.local/bin/claude',
      '/home/moi/.claude/local/claude',
    ]);
    expect(cheminsNatifs('claude', { USERPROFILE: 'C:\\Users\\moi' }, 'win32')).toContain(
      'C:\\Users\\moi\\.local\\bin\\claude.exe',
    );
    // Sans HOME (service, conteneur épuré), on ne fabrique pas un `/…` bancal.
    expect(cheminsNatifs('claude', {}, 'linux')).toEqual([]);
  });

  it('HIVE_AGENT_CMD court-circuite la sonde — elle n’est même pas appelée', async () => {
    // Un choix explicite du membre ne doit pas déclencher de `spawn` inutile :
    // sonder coûte jusqu'à 4 secondes par binaire absent.
    let appels = 0;
    const vu = await detectBestAgent({ HIVE_AGENT_CMD: 'mon-ia --run' }, async () => {
      appels += 1;
      return false;
    });
    expect(vu.agent).toBe('custom');
    expect(appels, 'la sonde ne doit pas tourner quand le membre a choisi').toBe(0);
  });
});

describe('réquisition si credentials manquantes', () => {
  it('shell et custom : rien à demander', () => {
    expect(requisitionSiCredentialsManquantes('shell', {})).toBeNull();
    expect(requisitionSiCredentialsManquantes('custom', {})).toBeNull();
  });

  it('codex sans OPENAI_API_KEY → réquisition cle_api', () => {
    const r = requisitionSiCredentialsManquantes('codex', {});
    expect(r?.genre).toBe('cle_api');
    expect(r?.libelle).toMatch(/OpenAI/i);
  });

  it('claude-code avec clé env → silence', () => {
    expect(
      requisitionSiCredentialsManquantes('claude-code', { ANTHROPIC_API_KEY: 'sk-x' }),
    ).toBeNull();
  });

  it('claude-code avec ~/.claude → silence même sans clé env', () => {
    const existe = (p: string) => /[/\\]\.claude$/.test(p);
    expect(
      requisitionSiCredentialsManquantes(
        'claude-code',
        { HOME: '/home/moi' },
        { existe, plateforme: 'linux' },
      ),
    ).toBeNull();
    expect(
      requisitionSiCredentialsManquantes(
        'claude-code',
        { USERPROFILE: 'C:\\Users\\moi' },
        { existe, plateforme: 'win32' },
      ),
    ).toBeNull();
  });

  it('cursor sans clé ni ~/.cursor → réquisition', () => {
    const r = requisitionSiCredentialsManquantes(
      'cursor',
      { HOME: '/home/moi' },
      { existe: () => false },
    );
    expect(r?.genre).toBe('cle_api');
    expect(r?.libelle).toMatch(/Cursor/i);
  });

  it('cursor avec CURSOR_API_KEY → silence', () => {
    expect(requisitionSiCredentialsManquantes('cursor', { CURSOR_API_KEY: 'key' })).toBeNull();
  });

  it('cursor avec ~/.cursor → silence même sans clé env', () => {
    const existe = (p: string) => /[/\\]\.cursor$/.test(p);
    expect(
      requisitionSiCredentialsManquantes(
        'cursor',
        { HOME: '/home/moi' },
        { existe, plateforme: 'linux' },
      ),
    ).toBeNull();
  });
});
