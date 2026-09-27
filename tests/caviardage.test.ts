// LE CAVIARDAGE AU NŒUD — ce qui ne doit jamais quitter la machine du membre.
//
// `creerCaviardeur` tient deux frontières : le TEXTE (logs, sortie en direct,
// réponse finale), où tous les motifs connus de la ruche s'appliquent, et le
// DIFF, que Honeycomb Merge appliquera ensuite, où seuls les formats littéraux
// de jetons et les valeurs exactes s'appliquent — `token: string` est du code.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../src/adapters/exec.js';
import { borneTexteFinal } from '../src/adapters/texte-final.js';
import { lireAvis, lireProposition } from '../src/orchestrator/eclaireuse.js';
import { analyserRustine, appliquerRustine } from '../src/orchestrator/rustine.js';
import {
  creerCaviardeur,
  MARQUE_LIGNE_TRONQUEE,
  SECRET_CAVIARDE,
  valeursSecretes,
} from '../src/shared/caviardage.js';
import { texteDEchec } from '../src/shared/texte-d-echec.js';

const CLE = 'cle-du-fournisseur-inconnu-0123456789';

describe('valeursSecretes — les variables d’identification, pas les chemins', () => {
  it('garde les clés et jetons, écarte HOME, les URL de base et les dossiers', () => {
    expect(
      valeursSecretes({
        HOME: '/home/membre',
        APPDATA: 'C:\\Users\\membre\\AppData',
        ANTHROPIC_BASE_URL: 'https://proxy.local',
        GROK_HOME: '/home/membre/.grok',
        ANTHROPIC_API_KEY: 'a-1',
        CLAUDE_CODE_OAUTH_TOKEN: 'a-2',
        ANTHROPIC_AUTH_TOKEN: 'a-3',
        CURSOR_API_KEY: 'a-4',
        VIDE: undefined,
      }).sort(),
    ).toEqual(['a-1', 'a-2', 'a-3', 'a-4']);
  });

  it('lit le DERNIER segment du nom : un auteur Git ou une socket SSH ne sont pas des secrets', () => {
    expect(
      valeursSecretes({
        GIT_AUTHOR_NAME: 'Claude Code (Opus 5.5)',
        GIT_AUTHOR_EMAIL: 'noreply@anthropic.com',
        SSH_AUTH_SOCK: '/run/user/1000/ssh-agent.sock',
        GIT_ASKPASS: '/usr/lib/git-core/askpass',
        PASSWORD_STORE_DIR: '/home/membre/.password-store',
        AWS_SECRET_ACCESS_KEY: 'a-5',
        GH_PAT: 'a-6',
        OPENAI_API_KEY_2: 'a-7',
      }).sort(),
    ).toEqual(['a-5', 'a-6', 'a-7']);
  });

  it('une clé sur plusieurs lignes est reconnue échappée en JSON, et ligne par ligne', () => {
    const pem =
      '-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nk4Zp0q1w2e3r4t5y6u7i8o9p\n-----END KEY-----';
    const c = creerCaviardeur(valeursSecretes({ SERVICE_PRIVATE_KEY: pem }));
    // Le stream-json de Claude recopie le fichier en chaîne JSON.
    const journal = JSON.stringify({ type: 'tool_result', content: `cat cle.pem\n${pem}` });
    expect(c.texte(journal)).not.toMatch(/MIIEvQ|k4Zp0q/);
    // Et un morceau en direct peut s'arrêter entre deux lignes de la clé.
    expect(c.texte('k4Zp0q1w2e3r4t5y6u7i8o9p\n')).toBe(`${SECRET_CAVIARDE}\n`);
  });
});

describe('creerCaviardeur — texte', () => {
  it('remplace la valeur EXACTE d’une clé qu’aucun motif ne reconnaît', () => {
    const c = creerCaviardeur([CLE]);
    expect(c.texte(`auth avec ${CLE} puis ${CLE}`)).toBe(
      `auth avec ${SECRET_CAVIARDE} puis ${SECRET_CAVIARDE}`,
    );
  });

  it('applique aussi les motifs connus de la ruche (jetons GitHub, Bearer, URL)', () => {
    const c = creerCaviardeur([]);
    const sortie = c.texte(
      'ghp_abcdefghij0123 Bearer eyJhbGciOi https://moi:motdepasse@github.com/o/d.git',
    );
    expect(sortie).not.toMatch(/ghp_|eyJ|motdepasse/);
  });

  it('un JWT de session (`~/.codex/auth.json` lu par un outil) ne part pas en clair', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtZW1icmUifQ.c2lnbmF0dXJlLWR1LWpldG9u';
    expect(creerCaviardeur([]).texte(`{"access_token":"${jwt}"}`)).toBe(
      `{"access_token":"${SECRET_CAVIARDE}"}`,
    );
  });

  it('ignore une « valeur » trop courte pour être un identifiant', () => {
    expect(creerCaviardeur(['1', 'true']).texte('exit 1 : true')).toBe('exit 1 : true');
  });

  it('une valeur qui en contient une autre disparaît ENTIÈRE, sans laisser ses bords', () => {
    const courte = 'secretcourt';
    const longue = `prefixe-${courte}-suffixe`;
    expect(creerCaviardeur([courte, longue]).texte(longue)).toBe(SECRET_CAVIARDE);
  });

  it('masque un DÉBUT de clé coupé net par la marque de ligne tronquée', () => {
    const coupee = `… ${CLE.slice(0, 20)}${MARQUE_LIGNE_TRONQUEE}`;
    const sortie = creerCaviardeur([CLE]).texte(coupee);
    expect(sortie).not.toContain(CLE.slice(0, 20));
    expect(sortie).toBe(`… ${SECRET_CAVIARDE}${MARQUE_LIGNE_TRONQUEE}`);
  });
});

// Le hub RELIT ce que le nœud caviarde : le texte final d'une éclaireuse
// (`HIVE_PROPOSITION {…}`, `HIVE_AVIS {…}`) et les enregistrements d'erreur JSON
// des logs (`texteDEchec`). Un remplacement qui avale un `"` fermant rend la
// ligne illisible — la proposition, ou un veto, disparaît sans un mot.
describe('creerCaviardeur — ce que le hub relit reste lisible', () => {
  const meta = { id: 'p-1', eclaireuse: 'e-1', famille: 'claude', tour: 1 };

  it('une proposition qui parle de « Basic auth » est toujours lue, et intacte', () => {
    const finalText =
      'HIVE_PROPOSITION {"titre":"Auth","corps":"Remplacer le login par Basic auth","qualite":7,"sources":[]}';
    const lue = lireProposition(creerCaviardeur([CLE]).reponse(finalText), meta);
    expect(lue?.corps).toBe('Remplacer le login par Basic auth');
  });

  it('un avis qui dit « Bearer token » est toujours lu — un veto reste un veto', () => {
    const finalText = 'HIVE_AVIS {"type":"arret","force":6,"raison":"pas de Bearer token"}';
    const lu = lireAvis(creerCaviardeur([CLE]).reponse(finalText), {
      propositionId: 'p-1',
      eclaireuse: 'e-2',
      famille: 'codex',
      tour: 1,
    });
    expect(lu?.type).toBe('arret');
  });

  it('un enregistrement d’erreur JSON des logs reste un JSON valide, sa valeur caviardée', () => {
    const logs = '{"type":"error","message":"requires Basic dXNlcjpwYXNz"}\n';
    const caviarde = creerCaviardeur([]).texte(logs);
    expect(JSON.parse(caviarde.trim())).toEqual({ type: 'error', message: 'requires [secret]' });
    expect(texteDEchec(caviarde)).toContain('requires [secret]');
    // Même échappé dans une chaîne JSON, le guillemet de la chaîne survit.
    const echappe = JSON.stringify({ log: 'Authorization: Bearer abc"def' });
    expect(() => JSON.parse(creerCaviardeur([]).texte(echappe))).not.toThrow();
  });
});

describe('runCommand — les logs du résultat ne coupent jamais une ligne entre deux flux', () => {
  it('une lecture de stderr au milieu d’une clé écrite sur stdout ne la fend pas', async () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'hive-caviardage-flux-'));
    try {
      const script = path.join(dossier, 'agent.js');
      // La clé part en deux écritures de stdout, une ligne de stderr entre les
      // deux — et assez espacées pour que le nœud les lise séparément.
      writeFileSync(
        script,
        "'use strict';\n" +
          `process.stdout.write('cle=${CLE.slice(0, 15)}');\n` +
          "setTimeout(() => process.stderr.write('bruit de stderr\\n'), 80);\n" +
          `setTimeout(() => process.stdout.write('${CLE.slice(15)} fin\\n'), 160);\n`,
      );
      const r = await runCommand(
        process.execPath,
        [script],
        {
          cwd: dossier,
          env: { ...process.env },
          attempt: 1,
          signal: new AbortController().signal,
          onProgress: () => {},
        },
        10_000,
      );
      expect(r.logs).toContain(`cle=${CLE} fin`);
      const caviarde = creerCaviardeur([CLE]).texte(r.logs);
      expect(caviarde).not.toContain(CLE.slice(0, 15));
      expect(caviarde).not.toContain(CLE.slice(15));
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe('creerCaviardeur — diff', () => {
  it('remplace une clé écrite dans un fichier, et les formats littéraux de jetons', () => {
    const c = creerCaviardeur([CLE]);
    const diff = `@@ -0,0 +1,2 @@\n+const cle = '${CLE}';\n+const gh = 'ghp_abcdefghij0123456789ab';\n`;
    expect(c.diff(diff)).toBe(
      `@@ -0,0 +1,2 @@\n+const cle = '${SECRET_CAVIARDE}';\n+const gh = '${SECRET_CAVIARDE}';\n`,
    );
  });

  it('ne réécrit PAS le code ordinaire que les motifs d’affectation reconnaîtraient', () => {
    const code =
      '@@ -0,0 +1,3 @@\n' +
      "+  token: string;\n+  headers: { authorization: 'Bearer ' + jeton },\n" +
      '+  const url = `https://${user}:${pass}@github.com/o/d.git`;\n';
    expect(creerCaviardeur([CLE]).diff(code)).toBe(code);
    // Le même texte, traité comme un log, serait caviardé : c'est bien la
    // frontière qui protège le patch.
    expect(creerCaviardeur([CLE]).texte(code)).not.toBe(code);
  });
});

describe('creerCaviardeur — un diff caviardé s’applique TOUJOURS', () => {
  // Le hub applique le diff au contexte exact (rustine.ts, `git apply`) :
  // réécrire une ligne de contexte ou une ligne retirée refuserait une
  // livraison légitime. Ces lignes sont déjà dans le dépôt ; seules les lignes
  // AJOUTÉES peuvent y apporter une clé.
  const base =
    '// Apache 2.0 (github.com/xai-org/grok-build)\n' +
    `const locale = 'sk-SK'; // pip install xai-sdk, fixture 'sk-test-key'\n` +
    `const deja = '${CLE}';\n` +
    '-- ancien commentaire sql\n' +
    'const x = 1;\n';
  const diff =
    'diff --git a/f.ts b/f.ts\n' +
    '--- a/f.ts\n' +
    '+++ b/f.ts\n' +
    '@@ -1,5 +1,7 @@\n' +
    ' // Apache 2.0 (github.com/xai-org/grok-build)\n' +
    ` const locale = 'sk-SK'; // pip install xai-sdk, fixture 'sk-test-key'\n` +
    ` const deja = '${CLE}';\n` +
    // Dans un hunk, `--- …` est une ligne retirée et `+++ …` une ligne ajoutée.
    '--- ancien commentaire sql\n' +
    '+++ sk-proj-abcdefghijklmnopqrstuvwx\n' +
    `+const cle = '${CLE}';\n` +
    "+const gh = 'ghp_abcdefghij0123456789abcd';\n" +
    ' const x = 1;\n';

  it('le contexte et les lignes retirées passent intacts, le patch s’applique', () => {
    const caviarde = creerCaviardeur([CLE]).diff(diff);
    const [ecriture] = appliquerRustine(analyserRustine(caviarde), new Map([['f.ts', base]]));
    expect(ecriture?.contenu).toBe(
      '// Apache 2.0 (github.com/xai-org/grok-build)\n' +
        `const locale = 'sk-SK'; // pip install xai-sdk, fixture 'sk-test-key'\n` +
        `const deja = '${CLE}';\n` +
        `++ ${SECRET_CAVIARDE}\n` +
        `const cle = '${SECRET_CAVIARDE}';\n` +
        `const gh = '${SECRET_CAVIARDE}';\n` +
        'const x = 1;\n',
    );
  });

  it('et `git apply --check` (Honeycomb Merge, merge-runner.ts) l’accepte aussi', () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'hive-caviardage-diff-'));
    try {
      writeFileSync(path.join(dossier, 'f.ts'), base);
      const caviarde = creerCaviardeur([CLE]).diff(diff);
      expect(() =>
        execFileSync('git', ['apply', '--check', '-'], { cwd: dossier, input: caviarde }),
      ).not.toThrow();
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('les en-têtes de fichier, hors hunk, ne sont jamais réécrits', () => {
    const entete =
      '--- a/sk-proj-abcdefghijklmnopqrstuvwx.ts\n+++ b/sk-proj-abcdefghijklmnopqrstuvwx.ts\n';
    expect(creerCaviardeur([]).diff(entete)).toBe(entete);
  });
});

describe('creerCaviardeur — les bords qu’une coupe laisse d’un secret', () => {
  it('de part et d’autre de la coupure du texte final (borneTexteFinal)', () => {
    // La clé tombe PILE sur la coupe : sa moitié avant, sa moitié après.
    const tete = 'a'.repeat(2_000 - 20) + CLE;
    const texte = tete + 'b'.repeat(20_000) + CLE + 'c'.repeat(5_000);
    const borne = borneTexteFinal(texte) ?? '';
    for (const sortie of [
      creerCaviardeur([CLE]).texte(borne),
      creerCaviardeur([CLE]).reponse(borne),
    ]) {
      expect(sortie).not.toContain(CLE.slice(0, 20));
      expect(sortie).not.toContain(CLE.slice(-15));
    }
  });

  it('en tête d’une fenêtre qui a commencé au milieu d’une clé', () => {
    expect(creerCaviardeur([CLE]).texte(`${CLE.slice(12)} puis la suite`)).toBe(
      `${SECRET_CAVIARDE} puis la suite`,
    );
  });

  it('des identifiants d’URL coupés avant leur @ par la marque de ligne tronquée', () => {
    const sortie = creerCaviardeur([]).texte(
      `clone https://moi:motdepasse-tres-l${MARQUE_LIGNE_TRONQUEE}`,
    );
    expect(sortie).not.toContain('motdepasse');
  });
});
