// La machine derrière chaque ouvrière — dite, jamais devinée.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// La ruche fait travailler des machines qu'on ne voit pas : celle d'un ami
// sous Windows, un serveur Linux, le portable macOS de l'hôte. Jusqu'ici le
// tableau de bord montrait l'AGENT (claude-code, codex, shell) mais pas la
// MACHINE — et « quelles ouvrières tournent sous Windows ? » n'avait de
// réponse nulle part, alors que c'est la première question qu'on se pose
// quand une tâche échoue d'un côté et réussit de l'autre (§ 6.2 du journal :
// la moitié des morsures de ce dépôt sont des morsures Windows).
//
// Le nœud DÉCLARE sa plateforme à l'inscription — une donnée, validée comme
// toutes les autres, jamais un `os.platform()` exécuté côté hub sur la foi
// d'un nom de machine.
//
// MODULE PUR : la correspondance `process.platform` → plateforme se juge sans
// démarrer quoi que ce soit, et l'écran comme le protocole lisent LA MÊME
// liste — deux copies divergeraient (§ 2 undecies).

/** Les plateformes que la ruche sait nommer. `autre` est un constat, pas un défaut. */
export const PLATEFORMES = ['windows', 'macos', 'linux', 'autre'] as const;
export type PlateformeNoeud = (typeof PLATEFORMES)[number];

/**
 * La plateforme d'un `process.platform`.
 *
 * `win32` s'appelle ainsi même en 64 bits — c'est l'héritage de Node, pas une
 * information. On traduit vers le mot que l'hôte lit.
 */
export function plateformeDepuis(platform: string): PlateformeNoeud {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'autre';
}

/** Garde de protocole : la valeur vient du réseau, on ne la croit pas sur parole. */
export function estPlateforme(v: unknown): v is PlateformeNoeud {
  return typeof v === 'string' && (PLATEFORMES as readonly string[]).includes(v);
}

/**
 * Le pictogramme de chaque plateforme — UNE seule table, partagée par tout ce
 * qui affiche (l'écran aujourd'hui, la TUI demain), pour que « Windows » ait
 * le même visage partout.
 */
export const PICTO_PLATEFORME: Record<PlateformeNoeud, string> = {
  windows: '🪟',
  macos: '🍎',
  linux: '🐧',
  autre: '❔',
};
