// Le superviseur de la ruche — éprouvé avec de VRAIS processus.
//
// `src/ruche-superviseur.ts` est le seul superviseur : `npm run ruche` et
// l'application de bureau l'appellent tous deux (ADR 0013 § 2). Ses règles —
// qui démarre quand, qui meurt comment, qui arrête qui — ne se voient qu'avec
// des processus réels : un faux `spawn` prouverait le faux.
//
// Les pièces sont de petits scripts Node écrits pour le banc : une « Reine »
// qui s'annonce par son canal IPC comme `orchestrator/main.ts`, des
// « ouvrières » qui disent l'adresse qu'elles ont reçue et s'arrêtent sur
// SIGTERM ou sur l'ordre d'arrêt, comme `node-client/main.ts`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lancerRuche, type RucheLancee } from '../src/ruche-superviseur.js';
import type { Piece, SuiteDUneMort } from '../src/shared/demarrage.js';

const POSIX = process.platform !== 'win32';

let dossier = '';
const ruches: RucheLancee[] = [];

beforeEach(() => {
  dossier = mkdtempSync(path.join(tmpdir(), 'hive-superviseur-'));
});

afterEach(async () => {
  for (const r of ruches.splice(0)) {
    r.arreter(0);
    await r.fini;
  }
  rmSync(dossier, { recursive: true, force: true });
});

/** Écrit un script de pièce et rend son chemin. */
function script(nom: string, corps: string): string {
  const f = path.join(dossier, `${nom}.mjs`);
  writeFileSync(f, corps);
  return f;
}

/** Une Reine : s'annonce sur un port donné, s'arrête sur SIGTERM ou l'ordre d'arrêt. */
const REINE = `
const arret = () => { console.log('reine arrêtée'); process.exit(0); };
process.on('SIGTERM', arret);
process.on('message', (m) => { if (m && m.type === 'arret') arret(); });
console.log('reine en ligne');
process.send({ type: 'reine-en-ligne', hote: '127.0.0.1', port: 45678 });
setInterval(() => {}, 1000);
`;

/** Une ouvrière : dit l'URL reçue, s'arrête comme la Reine. */
const OUVRIERE = `
const arret = () => { console.log('ouvrière arrêtée'); process.exit(0); };
process.on('SIGTERM', arret);
process.on('message', (m) => { if (m && m.type === 'arret') arret(); });
console.log('URL=' + process.env.HIVE_URL + ' AGENT=' + (process.env.HIVE_AGENT ?? '-'));
setInterval(() => {}, 1000);
`;

interface Journal {
  lignes: string[];
  morts: { piece: string; suite: SuiteDUneMort }[];
  adresses: string[];
}

function lancer(liste: Piece[]): { ruche: RucheLancee; j: Journal } {
  const j: Journal = { lignes: [], morts: [], adresses: [] };
  const ruche = lancerRuche({
    liste,
    cwd: dossier,
    ligne: ({ etiquette, texte }) => j.lignes.push(`${etiquette}${texte}`),
    adresse: (a) => j.adresses.push(a.ws),
    mort: (p, suite) => j.morts.push({ piece: p.nom, suite }),
  });
  ruches.push(ruche);
  return { ruche, j };
}

/** Attend qu'une ligne contenant `motif` soit passée — borné, et nommé s'il manque. */
async function attendreLigne(j: Journal, motif: string, delaiMs = 15_000): Promise<string> {
  const debut = Date.now();
  for (;;) {
    const l = j.lignes.find((x) => x.includes(motif));
    if (l !== undefined) return l;
    if (Date.now() - debut > delaiMs) {
      throw new Error(`« ${motif} » jamais vu. Lignes :\n${j.lignes.join('\n')}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

const reine = (): Piece => ({
  nom: 'reine',
  bin: process.execPath,
  argv: [script('reine', REINE)],
  role: 'r',
  reine: 'annonce',
});
const ouvriere = (nom: string, env?: Record<string, string>): Piece => ({
  nom,
  bin: process.execPath,
  argv: [script(nom.replace(/\W/g, '-'), OUVRIERE)],
  role: 'o',
  ouvriere: true,
  reine: 'HIVE_URL',
  ...(env ? { env } : {}),
});

describe('le superviseur — démarrage', () => {
  it('les ouvrières ne partent qu’à l’ANNONCE de la Reine, avec l’adresse annoncée', async () => {
    const { j } = lancer([reine(), ouvriere('ouvrière claude', { HIVE_AGENT: 'claude-code' })]);
    const l = await attendreLigne(j, 'URL=');
    // L'adresse vient de l'annonce (port 45678), pas d'un défaut à 7777.
    expect(l).toContain('URL=ws://127.0.0.1:45678/ws');
    // Et l'environnement propre à la pièce passe par-dessus l'hérité.
    expect(l).toContain('AGENT=claude-code');
    expect(j.adresses).toEqual(['ws://127.0.0.1:45678/ws']);
  });

  it('chaque ligne porte l’étiquette alignée de sa pièce', async () => {
    const { j } = lancer([reine(), ouvriere('ouvrière')]);
    await attendreLigne(j, 'URL=');
    expect(j.lignes).toContain('reine    │ reine en ligne');
  });
});

describe('le superviseur — arrêt', () => {
  it('`arreter(0)` arrête TOUTES les pièces, et `fini` rend le code demandé', async () => {
    const { ruche, j } = lancer([reine(), ouvriere('ouvrière')]);
    await attendreLigne(j, 'URL=');
    ruche.arreter(0);
    await expect(ruche.fini).resolves.toBe(0);
    // Toutes sont SORTIES — pas abandonnées derrière un superviseur qui rend la main.
    for (const e of ruche.enfants) expect(e.exitCode !== null || e.signalCode !== null).toBe(true);
    // Et elles ont eu le temps de s'arrêter proprement.
    await attendreLigne(j, 'ouvrière arrêtée');
    await attendreLigne(j, 'reine arrêtée');
    expect(j.morts).toEqual([]);
  });

  it.runIf(POSIX)(
    'une pièce qui ignore l’arrêt est emportée au bout de la grâce — une Reine restée tiendrait sa base',
    async () => {
      const tetue = script(
        'tetue',
        `process.on('SIGTERM', () => {}); process.send({ type: 'reine-en-ligne', hote: '127.0.0.1', port: 1 }); console.log('tetue'); setInterval(() => {}, 1000);`,
      );
      const { ruche, j } = lancer([
        { nom: 'reine', bin: process.execPath, argv: [tetue], role: 'r', reine: 'annonce' },
      ]);
      await attendreLigne(j, 'tetue');
      ruche.arreter(0);
      await expect(ruche.fini).resolves.toBe(0);
      const [e] = ruche.enfants;
      // SIGKILL rend la main à l'arrivée de l'`exit` — on l'attend, borné.
      await new Promise<void>((r) =>
        e!.exitCode !== null || e!.signalCode ? r() : e!.once('exit', () => r()),
      );
      expect(e!.signalCode).toBe('SIGKILL');
    },
  );
});

describe('le superviseur — morts', () => {
  it('une ouvrière qui meurt se DIT avec sa dernière phrase, et la ruche continue', async () => {
    const meurt = script(
      'meurt',
      // Dernière phrase SANS `\n` : c'est celle qu'on perdait (`reliquat`).
      `process.stderr.write('agent non connecté : lancez claude login'); process.exit(5);`,
    );
    const { ruche, j } = lancer([
      reine(),
      {
        nom: 'ouvrière codex',
        bin: process.execPath,
        argv: [meurt],
        role: 'o',
        ouvriere: true,
        reine: 'HIVE_URL',
      },
      ouvriere('ouvrière claude'),
    ]);
    await attendreLigne(j, 'la ruche continue');
    const [m] = j.morts;
    expect(m?.piece).toBe('ouvrière codex');
    expect(m?.suite.arreter).toBe(false);
    expect(m?.suite.message).toContain('code 5');
    expect(m?.suite.message).toContain('« agent non connecté : lancez claude login »');
    // La Reine et l'autre ouvrière vivent toujours.
    expect(ruche.enfants.filter((e) => e.exitCode === null && e.signalCode === null)).toHaveLength(
      2,
    );
  });

  it('la Reine qui meurt EMPORTE la ruche, en code non nul — même si elle sort en 0', async () => {
    const breve = script(
      'breve',
      `process.send({ type: 'reine-en-ligne', hote: '127.0.0.1', port: 45679 }); setTimeout(() => process.exit(0), 300);`,
    );
    const { ruche, j } = lancer([
      { nom: 'reine', bin: process.execPath, argv: [breve], role: 'r', reine: 'annonce' },
      ouvriere('ouvrière'),
    ]);
    await expect(ruche.fini).resolves.toBe(1);
    expect(j.morts.map((m) => m.piece)).toEqual(['reine']);
    expect(j.morts[0]?.suite.arreter).toBe(true);
    // L'ouvrière lancée à l'annonce a été arrêtée avec elle.
    for (const e of ruche.enfants) expect(e.exitCode !== null || e.signalCode !== null).toBe(true);
  });

  it('un binaire introuvable arrête la ruche en 1, sans attendre un `exit` qui ne viendra pas', async () => {
    const { ruche, j } = lancer([
      { nom: 'reine', bin: path.join(dossier, 'absent'), argv: [], role: 'r', reine: 'annonce' },
    ]);
    await expect(ruche.fini).resolves.toBe(1);
    expect(j.lignes.some((l) => l.includes('✘'))).toBe(true);
  });

  it('une liste vide est une ruche déjà finie', async () => {
    const { ruche } = lancer([]);
    await expect(ruche.fini).resolves.toBe(0);
  });
});
