// LES FAUX OUTILS DE LA PORTE, ÉPROUVÉS CONTRE LES VRAIS.
//
// Les bancs de la porte de sécurité ne lancent pas betterleaks ni
// osv-scanner : ils lancent les faux de `fixtures/faux-outils-porte.ts`. Un
// faux plus complaisant que le vrai — qui ne préfiltrerait pas, n'ignorerait
// aucune confiance, lirait un lockfile cassé — rendrait ces bancs verts pour
// de mauvaises raisons. Ce banc rejoue, sur les faux, ce que les VRAIS outils
// ont rendu le 4 octobre (betterleaks 1.9.0, osv-scanner 2.6.0) : colonnes,
// confiance, préfiltre, extraction, échec global. POSIX seulement : les faux
// sont des scripts à shebang.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_BETTERLEAKS } from '../src/shared/porte-securite.js';
import { fauxOutilsPorte } from './fixtures/faux-outils-porte.js';
import { VERROUS } from './fixtures/verrous-porte.js';

const POSIX = process.platform !== 'win32';
const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un dossier de banc, avec des fichiers. */
function poser(fichiers: Record<string, string>): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-fidele-'));
  dossiers.push(d);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(d, nom)), { recursive: true });
    writeFileSync(path.join(d, nom), contenu);
  }
  return d;
}

/** La ligne réelle de `dashboard/src/AccountPanel.tsx` que l'outil lisait comme un mot de passe. */
const PANNEAU = "            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}";

describe.runIf(POSIX)('le faux Betterleaks rejoue le vrai', () => {
  const lancer = (
    dossier: string,
    drapeaux: string[],
  ): { code: number; rapport: Record<string, unknown>[] } => {
    const outils = fauxOutilsPorte(dossiers);
    const rapport = path.join(dossier, 'rapport.json');
    const r = spawnSync(
      path.join(outils.dossier, 'betterleaks'),
      ['dir', path.join(dossier, 'm'), '--redact', '--report-path', rapport, ...drapeaux],
      { encoding: 'utf8' },
    );
    return {
      code: r.status ?? -1,
      rapport: JSON.parse(readFileSync(rapport, 'utf8')) as Record<string, unknown>[],
    };
  };

  it('SANS `--confidence high`, la règle générique lit `new-password` — aux colonnes MESURÉES sur l’outil réel', () => {
    const d = poser({ 'm/0/AccountPanel.tsx': `${'\n'.repeat(6)}${PANNEAU}\n` });
    const { code, rapport } = lancer(d, []);
    expect(code).toBe(1);
    // Mesuré sur betterleaks 1.9.0 : ligne 7, colonnes 55 à 81, confiance basse.
    expect(rapport).toMatchObject([
      {
        RuleID: 'generic-password',
        StartLine: 7,
        StartColumn: 55,
        EndColumn: 81,
        Match: "password' : 'REDACTED'}",
        Attributes: { confidence: 'low' },
      },
    ]);
    // Avec la confiance que la porte impose : rien, sortie 0 — comme le vrai.
    expect(lancer(d, ['--confidence', 'high'])).toEqual({ code: 0, rapport: [] });
  });

  it('LE PRÉFILTRE PAR DÉFAUT écarte un lockfile, une image, un `go.sum` — sauf configuration qui l’éteint', () => {
    const stripe = ['sk', 'live', 'J7SvJhSALZpqZR3XuCpbmm1G'].join('_');
    const d = poser({
      'm/0/package-lock.json': `{ "k": "${stripe}" }\n`,
      'm/1/logo.svg': `<svg><!-- ${stripe} --></svg>\n`,
      'm/2/go.sum': `x v1 h1:${stripe}\n`,
      'm/3/app.js': `const k = '${stripe}';\n`,
      'defaut.toml': '[extend]\nuseDefault = true\n',
      'porte.toml': CONFIG_BETTERLEAKS,
    });
    // Mesuré sur 1.9.0 : avec le préfiltre, seul `app.js` est lu.
    const avec = lancer(d, ['--config', path.join(d, 'defaut.toml')]);
    expect(avec.rapport.map((t) => path.basename(String(t.File)))).toEqual(['app.js']);
    const sans = lancer(d, ['--config', path.join(d, 'porte.toml')]);
    expect(sans.rapport.map((t) => path.basename(String(t.File)))).toEqual([
      'package-lock.json',
      'logo.svg',
      'go.sum',
      'app.js',
    ]);
  });
});

describe.runIf(POSIX)('le faux osv-scanner rejoue le vrai', () => {
  const extraire = (
    fichiers: string[],
  ): { code: number; sortie: string; paquets: string[] | null } => {
    const outils = fauxOutilsPorte(dossiers);
    const d = poser({});
    const rapport = path.join(d, 'extraction.json');
    const r = spawnSync(
      path.join(outils.dossier, 'osv-scanner'),
      [
        'scan',
        'source',
        ...fichiers.flatMap((f) => ['-L', f]),
        '--output-file',
        rapport,
        '--experimental-disable-plugins',
        'vulnmatch/osvdev',
        '--all-packages',
      ],
      { encoding: 'utf8' },
    );
    let paquets: string[] | null = null;
    try {
      const lu = JSON.parse(readFileSync(rapport, 'utf8')) as {
        results: { packages: { package: Record<string, string> }[] }[];
      };
      paquets = lu.results
        .flatMap((s) => s.packages.map((p) => p.package))
        .map((p) => `${p.ecosystem} ${p.name}@${p.version}`)
        .sort();
    } catch {
      // aucun rapport écrit
    }
    return { code: r.status ?? -1, sortie: `${r.stdout}${r.stderr}`, paquets };
  };

  it('L’EXTRACTION d’un package-lock rend ce que l’outil réel en a extrait — registre privé, git et `file:` compris', () => {
    const v = VERROUS['npm-v3']!;
    const d = poser({ [v.nom]: v.contenu });
    const { code, paquets } = extraire([path.join(d, v.nom)]);
    expect(code).toBe(0);
    expect(paquets).toEqual(v.extraction.map(([e, n, ver]) => `${e} ${n}@${ver}`).sort());
  });

  it('UN SEUL FICHIER ILLISIBLE fait échouer TOUT le passage (sortie 127, « could not extract ») — comme le vrai', () => {
    const v = VERROUS['npm-v3']!;
    const d = poser({ 'a/package-lock.json': v.contenu, 'b/package-lock.json': '{ "packages": {' });
    const { code, sortie, paquets } = extraire([
      path.join(d, 'a/package-lock.json'),
      path.join(d, 'b/package-lock.json'),
    ]);
    expect(code).toBe(127);
    expect(sortie).toMatch(/could not extract/);
    expect(sortie).toMatch(/extraction failed on specified lockfile/);
    expect(paquets).toBeNull();
  });

  it('`requirements.txt` : la BORNE BASSE d’une contrainte, comme le vrai (`flask>=0.1` → flask 0.1)', () => {
    const d = poser({ 'requirements.txt': 'flask>=0.1\ndjango==1.11.0\n' });
    expect(extraire([path.join(d, 'requirements.txt')]).paquets).toEqual([
      'PyPI django@1.11.0',
      'PyPI flask@0.1',
    ]);
    // Le vrai, mesuré sur la fixture `pip` : `flask 0.1` aussi.
    expect(VERROUS.pip?.extraction).toContainEqual(['PyPI', 'flask', '0.1']);
  });

  it('`--version` dit ce que le vrai dit', () => {
    const outils = fauxOutilsPorte(dossiers);
    expect(
      execFileSync(path.join(outils.dossier, 'osv-scanner'), ['--version'], { encoding: 'utf8' }),
    ).toMatch(/^osv-scanner version: 2\.6\.0\n/);
    expect(
      execFileSync(path.join(outils.dossier, 'betterleaks'), ['--version'], { encoding: 'utf8' }),
    ).toBe('betterleaks version 1.9.0\n');
  });
});
