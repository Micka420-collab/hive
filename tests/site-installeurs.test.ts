// ADR 0002 — Pages sert les installeurs ; le workflow les COPIE, il ne les
// duplique pas dans `site/` (deux copies dérivent). Les scripts affichent leur
// empreinte SHA-256 avant d'agir quand ils tournent comme fichier.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string) => readFileSync(path.join(RACINE, f), 'utf8');

describe('Pages publie les installeurs (ADR 0002)', () => {
  it('le workflow Site copie install.sh et install.ps1 dans site/', () => {
    const wf = lire('.github/workflows/pages.yml');
    expect(wf).toContain('cp install.sh install.ps1 site/');
    expect(wf).toMatch(/paths:[\s\S]*install\.sh/);
    expect(wf).toMatch(/paths:[\s\S]*install\.ps1/);
    expect(wf).toContain('install.sha256');
  });

  it('README FR et EN annoncent la variante prudente Windows + Pages', () => {
    // Sans ça, Linux a le pipe prudent documenté et Windows reste « irm | run »
    // sans manifeste — le défaut que le lot 8 (empreintes Pages) devait fermer.
    for (const f of ['README.md', 'README.en.md'] as const) {
      const txt = lire(f);
      expect(txt).toContain('micka420-collab.github.io/hive/install.ps1');
      expect(txt).toContain('install.sha256');
      expect(txt).toMatch(/Get-FileHash|sha256sum/);
    }
  });

  it('INSTALLATION.md ne promet plus une Release pour l’empreinte', () => {
    // Le manifeste vit sur Pages ; une Release signée reste 🔒. Dire « Release /
    // install.sha256 » laisse croire qu’un tag signé existe déjà.
    const txt = lire('docs/INSTALLATION.md');
    expect(txt).toContain('micka420-collab.github.io/hive/install.sha256');
    expect(txt).toContain('Get-FileHash');
    expect(txt).toMatch(/Release GitHub signée|signed GitHub Release/i);
    expect(txt).not.toMatch(/publié avec la Release\s*\/\s*`?site\/install\.sha256/);
  });

  it('install.sh et install.ps1 annoncent l’empreinte dans le source', () => {
    const sh = lire('install.sh');
    expect(sh).toContain('annoncer_empreinte');
    expect(sh).toContain('Empreinte SHA-256');
    expect(sh).toContain('Tuyau curl|sh');
    // Hasher via stdin : sous Windows, `sha256sum "$0"` préfixait le condensé
    // de `\\` (chemin). La garde refuse le retour à `"$0"` comme seul argument.
    expect(sh).toMatch(/sha256sum\s*<\s*"\$0"/);
    expect(lire('install.ps1')).toContain('Get-FileHash');
    expect(lire('install.ps1')).toContain('Empreinte SHA-256');
  });
});

describe('install.sh annonce son empreinte', () => {
  it('affiche le SHA-256 quand lancé comme fichier (--dry-run)', () => {
    // Sous Windows, git peut convertir les fins de ligne : le hash Node ≠
    // sha256sum du fichier sur disque. On vérifie la présence de la ligne ;
    // l'égalité octet-à-octet reste la garde Linux/macOS.
    const script = path.join(RACINE, 'install.sh');
    const attendu = createHash('sha256').update(readFileSync(script)).digest('hex');
    const out = execFileSync('sh', [script, '--dry-run', `--dir=/tmp/hive-empreinte-test-$$`], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NO_COLOR: '1',
        TERM: 'dumb',
        HIVE_DEPOT: RACINE,
      },
      timeout: 60_000,
    });
    expect(out).toMatch(/Empreinte SHA-256 : [0-9a-f]{64}/);
    if (process.platform !== 'win32') {
      expect(out).toContain(`Empreinte SHA-256 : ${attendu}`);
    }
  });
});
