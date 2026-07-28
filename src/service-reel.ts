// La moitié qui touche le disque et lance des processus, en face de
// `src/shared/service.ts`.
//
// Même partage que `doctor.ts` / `doctor-releve.ts`, `lanceur.ts` /
// `lanceur-reel.ts`, `empreinte.ts` / `desinstallation.ts` : le module pur DIT
// quoi poser et quoi lancer, celui-ci le fait.
//
// ─── LES RÈGLES QUI NE SE NÉGOCIENT PAS ──────────────────────────────────────
//
//   1. `shell: false` sur CHAQUE lancement. Le chemin d'installation vient de
//      l'utilisateur ; le passer par un shell en ferait une injection. C'est la
//      contrainte § 5.1 du projet, et elle vaut ici plus qu'ailleurs, parce que
//      ce qu'on écrit est ce que la machine lancera au démarrage.
//   2. On écrit le fichier AVANT d'inscrire, et on désinscrit AVANT d'effacer.
//      L'ordre inverse laisse une inscription qui pointe vers rien — c'est-à-
//      dire une erreur toutes les cinq secondes dans le journal de quelqu'un.
//   3. `desinstaller` retire ce que `installer` a posé, et RIEN d'autre. Ni le
//      `.env`, ni la base, ni les journaux. ADR 0004.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  type Commande,
  type Contexte,
  type Plan,
  type Refus,
  planifier,
} from './shared/service.js';

/** Ce qu'une commande a donné. */
export interface Issue {
  readonly quoi: string;
  readonly code: number;
  readonly sortie: string;
}

/** Les gestes réels, injectables pour que les tests observent sans rien poser. */
export interface Systeme {
  readonly ecrire: (chemin: string, contenu: string, mode: number) => void;
  readonly effacer: (chemin: string) => void;
  readonly existe: (chemin: string) => boolean;
  readonly lancer: (c: Commande) => Issue;
}

export const SYSTEME: Systeme = {
  ecrire: (chemin, contenu, mode) => {
    mkdirSync(path.dirname(chemin), { recursive: true });
    writeFileSync(chemin, contenu, { mode });
  },
  effacer: (chemin) => {
    rmSync(chemin, { force: true, maxRetries: 5, retryDelay: 100 });
  },
  existe: (chemin) => existsSync(chemin),
  lancer: (c) => {
    // `shell: false` explicite, même si c'est le défaut : cette ligne est le
    // genre qu'on relit dans six mois en se demandant si elle a été pensée.
    const r = spawnSync(c.bin, [...c.args], { shell: false, encoding: 'utf8' });
    if (r.error) return { quoi: c.quoi, code: -1, sortie: r.error.message };
    return {
      quoi: c.quoi,
      code: r.status ?? -1,
      sortie: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(),
    };
  },
};

/** Le contexte de CETTE machine. */
export function contexteReel(
  racine: string,
  niveau: Contexte['niveau'],
  cible: Contexte['cible'] = 'ruche',
): Contexte {
  return {
    plateforme: process.platform,
    niveau,
    cible,
    racine: path.resolve(racine),
    execNode: process.execPath,
    home: os.homedir(),
  };
}

/** Ce qui s'est passé, geste par geste. */
export interface Compte {
  readonly plan: Plan;
  readonly issues: readonly Issue[];
  /** Vrai si tout a abouti. */
  readonly abouti: boolean;
}

/**
 * Pose le fichier, puis inscrit le service.
 *
 * S'ARRÊTE À LA PREMIÈRE COMMANDE EN ÉCHEC. Enchaîner `enable` après un
 * `daemon-reload` qui a échoué donnerait un second message d'erreur qui masque
 * le premier — et c'est le premier qui dit ce qui ne va pas.
 */
export function installer(ctx: Contexte, sys: Systeme = SYSTEME): Compte | Refus {
  const plan = planifier(ctx);
  if (plan.genre === 'refus') return plan;

  sys.ecrire(plan.fichier.chemin, plan.fichier.contenu, plan.fichier.mode);

  const issues: Issue[] = [];
  for (const c of plan.installer) {
    const i = sys.lancer(c);
    issues.push(i);
    if (i.code !== 0) break;
  }
  return { plan, issues, abouti: issues.every((i) => i.code === 0) };
}

/**
 * Désinscrit le service, puis retire le fichier.
 *
 * ─── POURQUOI ON NE S'ARRÊTE PAS AU PREMIER ÉCHEC ICI ────────────────────────
 *
 * À l'inverse de l'installation : un `disable` qui échoue parce que le service
 * n'était plus là ne doit PAS empêcher d'effacer le fichier. Sinon un service à
 * moitié retiré le reste pour toujours, et chaque nouvelle tentative échoue au
 * même endroit.
 *
 * Le fichier part dans tous les cas — c'est ce que l'ADR 0004 exige : « après
 * install puis uninstall, aucun fichier de service ne subsiste ».
 */
export function desinstaller(ctx: Contexte, sys: Systeme = SYSTEME): Compte | Refus {
  const plan = planifier(ctx);
  if (plan.genre === 'refus') return plan;

  const issues = plan.desinstaller.map((c) => sys.lancer(c));
  sys.effacer(plan.fichier.chemin);

  return {
    plan,
    issues,
    // Le seul critère qui compte : le fichier n'est plus là.
    abouti: !sys.existe(plan.fichier.chemin),
  };
}

/** L'état du service, tel que la plateforme le rend. */
export function statut(ctx: Contexte, sys: Systeme = SYSTEME): (Issue & { pose: boolean }) | Refus {
  const plan = planifier(ctx);
  if (plan.genre === 'refus') return plan;
  return { ...sys.lancer(plan.statut), pose: sys.existe(plan.fichier.chemin) };
}

/** Les dernières lignes du journal. */
export function journal(ctx: Contexte, sys: Systeme = SYSTEME): Issue | Refus {
  const plan = planifier(ctx);
  if (plan.genre === 'refus') return plan;
  return sys.lancer(plan.journal);
}
