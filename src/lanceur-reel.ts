// La moitié qui touche le disque, en face de `src/shared/lanceur.ts`.
//
// Même partage que `doctor.ts` / `doctor-releve.ts` : la DÉCISION est pure et
// prend la plateforme en paramètre — c'est ce qui rend la branche Windows
// vérifiable depuis Linux — et la RÉSOLUTION du chemin, qui suppose un disque
// et un `process.execPath`, vit ici.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { decider } from './shared/lanceur.js';

/**
 * Le lanceur demandé ne peut pas être exécuté sur cette plateforme.
 *
 * Une classe distincte, pas une `Error` nue : l'appelant doit pouvoir dire
 * « la ruche refuse » plutôt que « le système a répondu ENOENT ». C'est la
 * différence entre une panne qu'on comprend et une qu'on subit.
 */
export class LanceurIndisponible extends Error {
  constructor(readonly motif: string) {
    super(motif);
    this.name = 'LanceurIndisponible';
  }
}

/**
 * Ce qu'il faut réellement passer à `spawn(bin, args, { shell: false })`.
 *
 * Sur tout système POSIX, c'est l'identité — la fonction ne fait rien et ne
 * coûte rien. Sous Windows, `npm` devient `<node> <…>/npm-cli.js`, ce qui vise
 * un VRAI exécutable au lieu d'un script de commandes.
 *
 * @throws {LanceurIndisponible} si le lanceur ne peut pas tourner ici.
 */
export function resoudreLanceur(
  bin: string,
  args: readonly string[],
  plateforme: string = process.platform,
  execNode: string = process.execPath,
  existe: (p: string) => boolean = existsSync,
): { bin: string; args: string[] } {
  const d = decider(bin, plateforme);

  if (d.genre === 'tel-quel') return { bin, args: [...args] };
  if (d.genre === 'refus') throw new LanceurIndisponible(d.motif);

  const script = path.join(path.dirname(execNode), ...d.script.split('/'));
  // On VÉRIFIE que le script est là plutôt que de le supposer : une
  // installation Node exotique, un binaire relogé, et l'on repartirait pour un
  // `ENOENT` illisible — celui-là même qu'on est en train de supprimer.
  if (!existe(script)) {
    throw new LanceurIndisponible(
      `« ${bin} » est livré avec Node, mais son script est introuvable ici ` +
        `(${script}). Cette installation de Node n’a pas l’agencement attendu ; ` +
        `réinstallez Node, ou faites tourner ce nœud sous Linux ou macOS.`,
    );
  }
  return { bin: execNode, args: [script, ...args] };
}
