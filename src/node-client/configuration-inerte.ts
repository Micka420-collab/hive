// La configuration d'agent qu'un dépôt apporte, rendue INERTE pour les CLI qui
// l'exécuteraient sans interrupteur pour les en empêcher.
//
// ─── LE TROU ─────────────────────────────────────────────────────────────────
//
// Une tâche Hive tourne sur le dépôt d'un AUTRE membre, avec la machine, le
// HOME (hors du bac) et l'abonnement de celui qui la prend. Claude Code a des
// drapeaux pour ignorer les réglages du projet (`claude-code.ts`, #508) ; deux
// CLI n'en ont aucun :
//
//   · Cursor (`agent -p --force` — en mode print, `--force` VAUT confiance du
//     dossier) charge les hooks de `.cursor/hooks.json` ET, au format Claude,
//     ceux de `.claude/settings.json` et `.claude/settings.local.json` (dont
//     `enabledPlugins` active aussi des plugins). Lu dans le paquet installé
//     2026.09.02 : `projectConfigPath`, `claudeProjectConfigPath`,
//     `claudeProjectLocalConfigPath` sous la racine du projet, et
//     `load({loadProjectHooks = true})` appelé sans argument à chaque site.
//   · Cline 3.x lance par `bash`, avec tout l'environnement, les fichiers
//     d'événement de `.clinerules/hooks/` et `.cline/hooks/`, et charge comme
//     CODE les `.js`/`.ts` de `.cline/plugins/` (`@cline/shared` 0.0.86,
//     `resolveHooksConfigSearchPaths`, `resolvePluginConfigSearchPaths`).
//     `--hooks-dir` AJOUTE un dossier, il n'en retire aucun.
//
// ─── POURQUOI ÉCARTER DE L'ARBRE, ET PAS MONTER DU VIDE PAR-DESSUS ───────────
//
// Recouvrir ces chemins d'un dossier vide (`--tmpfs`, `--ro-bind`) ne vaut que
// DANS bubblewrap : ni un nœud sans moteur (niveau `processus`), ni macOS, ni
// Windows ne l'offrent — et Cursor n'est dans aucune image. Un déplacement, lui,
// marche partout : juste APRÈS le clone et la pose du registre, AVANT l'agent,
// chaque chemin est renommé dans `<tâche>.inerte`, à côté de la tâche (hors du
// montage du bac, comme `<tâche>.tmp` et le registre `<tâche>.git`) ; il est
// remis en place AVANT le diff (`Workspace.collectDiff`). Le diff se calcule
// donc sur l'arbre tel que l'agent l'a laissé, configuration du dépôt remise :
// rien de tout cela n'apparaît comme une suppression.
//
// Et pour que git ne les ressuscite pas en cours de route : un `git checkout
// -- .`, un `reset --hard` ou un `stash` de l'agent réécrivaient les fichiers
// absents — que Cursor relit à chaque site de hook. Leurs entrées d'index
// reçoivent `--skip-worktree` dans le `.git` DE LA TÂCHE, encore écrit par git
// seul à cet instant : pour l'agent, `git status` est propre et aucune de ces
// commandes ne les recrée (mesuré sur git 2.53, banc
// tests/configuration-inerte.test.ts). Le registre de la ruche, copié AVANT, ne
// porte pas ce bit : le diff voit tout.
//
// ─── CE QUE L'ON ACCEPTE ─────────────────────────────────────────────────────
//
//   · L'agent ne voit pas ces fichiers : une tâche qui DEVRAIT les modifier ne
//     le peut pas. Il peut en créer à ces chemins — c'est alors SON code, qu'il
//     pouvait de toute façon lancer (`--force`, `--auto-approve`) ; sa version
//     reste à la remise en place, et le diff la montre.
//   · Un composant qui est un LIEN est écarté tel quel (le lien, jamais sa
//     cible) ; à la remise en place, un lien ou un fichier que l'agent aurait
//     posé sur le chemin n'est jamais traversé — l'original est alors perdu
//     pour cette tâche, et le diff le montre.
//   · Si l'écartement échoue (fichier verrouillé sous Windows…), la tâche est
//     REFUSÉE avant l'agent, raison à l'appui (`ConfigurationNonNeutralisable`,
//     `client.ts`) : aucun agent ne tourne avec une configuration à moitié
//     écartée. Si la remise en place échoue, le diff échoue — visiblement, au
//     lieu de livrer des suppressions que personne n'a faites.

import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, type Stats } from 'node:fs';
import path from 'node:path';
import { gitHote, type DepotEpingle } from '../shared/git-protege.js';

/** L'écartement a échoué : l'agent ne doit pas tourner (voir l'en-tête). */
export class ConfigurationNonNeutralisable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigurationNonNeutralisable';
  }
}

/** Ce qui a été écarté de l'arbre d'une tâche, et comment le remettre. */
export interface ConfigurationEcartee {
  /** Relatifs à la racine du dépôt, séparés par `/` : la note du journal les cite. */
  readonly chemins: readonly string[];
  /**
   * Remet chaque élément à sa place, sans jamais traverser un lien que l'agent
   * aurait posé. Idempotent : le premier appel vide la réserve.
   */
  remettre(): void;
}

/** Où la configuration écartée attend : à CÔTÉ de la tâche, hors du montage du bac. */
export function reserveDeConfiguration(cwd: string): string {
  return `${cwd}.inerte`;
}

/**
 * La ligne du journal qui DIT ce que le dépôt apportait et qui n'a pas tourné.
 * Sans elle, l'auteur d'un dépôt dont les hooks se taisent ne saurait pas pourquoi.
 */
export function noteConfigurationEcartee(chemins: readonly string[]): string {
  return (
    `configuration d'agent du dépôt ignorée (hooks, plugins) : ${chemins.join(', ')} — ` +
    "écartée de l'arbre pendant l'exécution, remise avant le diff"
  );
}

/** `lstat`, ou `undefined` si rien n'est là — jamais un lien suivi. */
function lstatOuRien(chemin: string): Stats | undefined {
  try {
    return lstatSync(chemin);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw e;
  }
}

/**
 * L'élément à écarter pour le chemin déclaré `relatif` : lui-même s'il existe,
 * le PREMIER composant qui est un lien (le CLI le suivrait ; on déplace le lien,
 * jamais sa cible), rien si un composant manque ou n'est pas un dossier.
 */
function elementAEcarter(racine: string, relatif: string): string | undefined {
  const parties = relatif.split('/');
  for (let i = 1; i <= parties.length; i++) {
    const st = lstatOuRien(path.join(racine, ...parties.slice(0, i)));
    if (!st) return undefined;
    if (st.isSymbolicLink() || i === parties.length) return parties.slice(0, i).join('/');
    if (!st.isDirectory()) return undefined;
  }
  return undefined;
}

/**
 * Remet `source` à `relatif` sous `racine`. Un dossier parent disparu est
 * recréé ; un parent devenu lien ou fichier n'est PAS traversé (il mènerait
 * hors de la tâche, sur l'hôte). Là où l'agent a écrit, sa version reste ; deux
 * dossiers se fusionnent entrée par entrée.
 */
function remettreElement(source: string, racine: string, relatif: string): void {
  const parties = relatif.split('/');
  let dossier = racine;
  for (const partie of parties.slice(0, -1)) {
    dossier = path.join(dossier, partie);
    const st = lstatOuRien(dossier);
    if (!st) mkdirSync(dossier);
    else if (!st.isDirectory()) return;
  }
  fusionner(source, path.join(dossier, parties[parties.length - 1] ?? ''));
}

function fusionner(source: string, destination: string): void {
  const ici = lstatOuRien(destination);
  if (!ici) {
    renameSync(source, destination);
    return;
  }
  // `lstat` : `isDirectory()` est faux pour un lien — on ne fusionne que deux
  // VRAIS dossiers.
  if (ici.isDirectory() && lstatSync(source).isDirectory()) {
    for (const nom of readdirSync(source)) {
      fusionner(path.join(source, nom), path.join(destination, nom));
    }
  }
}

/**
 * Écarte de l'arbre de `depot` (le dépôt de la tâche, JUSTE après le clone —
 * son `.git` n'a encore été écrit que par git) les chemins `declares` qui
 * existent, et marque leurs fichiers suivis `--skip-worktree`. À appeler APRÈS
 * `poserRegistre` : le registre copie l'index, et doit le copier sans ce bit.
 */
export async function ecarterConfiguration(
  depot: DepotEpingle,
  declares: readonly string[],
): Promise<ConfigurationEcartee> {
  const racine = depot.workTree;
  const trouves = declares
    .map((relatif) => elementAEcarter(racine, relatif))
    .filter((c): c is string => c !== undefined)
    .sort();
  // Un élément sous un autre déjà écarté (`.cline` lien, puis `.cline/hooks`)
  // part avec lui.
  const chemins = trouves.filter(
    (c, i) => trouves.indexOf(c) === i && !trouves.some((autre) => c.startsWith(`${autre}/`)),
  );
  const reserve = reserveDeConfiguration(racine);
  const ecartes: { relatif: string; source: string }[] = [];
  let remis = chemins.length === 0;
  const remettre = (): void => {
    if (remis) return;
    try {
      // À l'envers : un élément se remet avant ceux qui l'ont précédé.
      for (const { relatif, source } of [...ecartes].reverse()) {
        remettreElement(source, racine, relatif);
      }
      rmSync(reserve, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (e) {
      throw new Error(
        `configuration d'agent du dépôt non remise en place (${chemins.join(', ')}) : ` +
          (e instanceof Error ? e.message : String(e)),
        { cause: e },
      );
    }
    remis = true;
  };
  if (chemins.length === 0) return { chemins, remettre };
  // Ce qui était en cours quand ça a cassé : la raison d'un refus tient en
  // 120 caractères (`LIMITS.name`) — le code d'erreur et le chemin, pas l'argv.
  let etape = 'réserve';
  try {
    mkdirSync(reserve);
    for (const [i, relatif] of chemins.entries()) {
      etape = relatif;
      const source = path.join(reserve, String(i));
      renameSync(path.join(racine, ...relatif.split('/')), source);
      ecartes.push({ relatif, source });
    }
    etape = 'index git';
    // Des chemins que Hive nomme lui-même (préfixes des chemins déclarés) :
    // aucune magie de pathspec possible.
    const suivis = (await gitHote(['ls-files', '-z', '--', ...chemins], depot))
      .split('\0')
      .filter((f) => f !== '');
    if (suivis.length > 0) {
      await gitHote(['update-index', '--skip-worktree', '--', ...suivis], depot);
    }
  } catch (e) {
    try {
      remettre();
    } catch {
      // La tâche est refusée et son répertoire effacé à la prochaine tentative.
    }
    const code = (e as NodeJS.ErrnoException).code;
    throw new ConfigurationNonNeutralisable(
      `hooks du dépôt non neutralisables : ${typeof code === 'string' ? code : 'échec'} (${etape})`,
      { cause: e },
    );
  }
  return { chemins, remettre };
}
