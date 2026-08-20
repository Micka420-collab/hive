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

  it('install.sh et install.ps1 annoncent l’empreinte dans le source', () => {
    expect(lire('install.sh')).toContain('annoncer_empreinte');
    expect(lire('install.sh')).toContain('Empreinte SHA-256');
    expect(lire('install.sh')).toContain('Tuyau curl|sh');
    expect(lire('install.ps1')).toContain('Get-FileHash');
    expect(lire('install.ps1')).toContain('Empreinte SHA-256');
  });
});

describe('install.sh annonce son empreinte', () => {
  it('affiche le SHA-256 quand lancé comme fichier (--dry-run)', () => {
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
    expect(out).toContain(`Empreinte SHA-256 : ${attendu}`);
  });
});
