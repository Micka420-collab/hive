// Les crochets de réveil — `/workspace/.wake-hooks` après resume.
//
// Un fichier n'est lancé QUE s'il est : sous ce dossier, exécutable, et
// possédé par l'utilisateur `hive` du conteneur. Pas de racine, pas de
// symlink qui en sortirait, pas de script d'un autre uid.

import { spawn } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const DOSSIER_CROCHETS = '/workspace/.wake-hooks';

export interface StatCrochet {
  readonly chemin: string;
  readonly mode: number;
  readonly uid: number;
  readonly estFichier: boolean;
}

export type JugementCrochet =
  { readonly ok: true; readonly chemin: string } | { readonly ok: false; readonly raison: string };

export function jugerCrochet(s: StatCrochet, uidHive: number): JugementCrochet {
  const norm = path.posix.normalize(s.chemin.replaceAll('\\', '/'));
  if (norm !== DOSSIER_CROCHETS && !norm.startsWith(`${DOSSIER_CROCHETS}/`)) {
    return { ok: false, raison: 'hors /workspace/.wake-hooks' };
  }
  if (norm.includes('/..')) return { ok: false, raison: 'chemin fuyant' };
  if (!s.estFichier) return { ok: false, raison: 'pas un fichier' };
  if (s.uid !== uidHive) return { ok: false, raison: 'propriétaire étranger' };
  if ((s.mode & 0o111) === 0) return { ok: false, raison: 'non exécutable' };
  return { ok: true, chemin: norm };
}

export interface RapportReveil {
  readonly ok: boolean;
  readonly lances: number;
  readonly refuses: readonly string[];
}

export async function lancerCrochets(opts: {
  dossier?: string;
  uidHive: number;
  spawnFn?: typeof spawn;
}): Promise<RapportReveil> {
  const dossier = opts.dossier ?? DOSSIER_CROCHETS;
  const refuses: string[] = [];
  let lances = 0;
  let noms: string[];
  try {
    noms = await readdir(dossier);
  } catch {
    return { ok: true, lances: 0, refuses: [] };
  }
  for (const nom of noms.sort()) {
    const brut = path.posix.join(dossier.replaceAll('\\', '/'), nom);
    let cheminValide: string;
    let st;
    try {
      const reel = await realpath(brut);
      st = await stat(reel);
      const juge = jugerCrochet(
        {
          chemin: reel.replaceAll('\\', '/'),
          mode: st.mode,
          uid: st.uid,
          estFichier: st.isFile(),
        },
        opts.uidHive,
      );
      if (!juge.ok) {
        refuses.push(`${nom}: ${juge.raison}`);
        continue;
      }
      cheminValide = juge.chemin;
    } catch (e) {
      refuses.push(`${nom}: ${e instanceof Error ? e.message : 'illisible'}`);
      continue;
    }
    const spawnFn = opts.spawnFn ?? spawn;
    await new Promise<void>((resolve) => {
      // Spawn the canonical path we validated, not the directory entry we
      // enumerated.  Using `brut` would reopen a symlink after `realpath()`:
      // replacing that entry between the check and spawn could execute a file
      // outside `.wake-hooks` despite the path check above.
      const enfant = spawnFn(cheminValide, [], {
        cwd: '/workspace',
        shell: false,
        windowsHide: true,
      });
      enfant.on('close', () => resolve());
      enfant.on('error', () => resolve());
    });
    lances += 1;
  }
  return { ok: refuses.length === 0, lances, refuses };
}
