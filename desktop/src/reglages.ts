// Le `.env` de la ruche de l'app, et l'environnement de ses enfants.
//
// ─── LES MÊMES SECRETS QUE L'INSTALLEUR, PAS UNE TROISIÈME RECETTE ───────────
//
// Le jeton (32) et le secret de session (64), les défauts prudents
// (`HIVE_RUNNER=off`, `HIVE_ISOLEMENT=auto`…) et leurs commentaires viennent de
// `composerReglages` (`src/installer.ts`), passé en argument : c'est la
// recette de `install.sh`, `install.ps1` et `npm run install:hive`. Une app
// qui tirerait ses secrets elle-même serait un quatrième écrivain de `.env`,
// le premier à diverger. Ce module ne décide que ce qui est propre à l'app :
// le port gardé, et ce qu'elle impose à ses enfants (ADR 0013 § 4 à 6).

import path from 'node:path';

/** Un réglage tel que l'installeur le rend. */
export interface Reglage {
  readonly cle: string;
  readonly valeur: string;
  readonly commentaire: string;
}

/** Ce que l'app emprunte à l'installeur de Hive. */
export interface RecetteReglages {
  readonly lireEnv: (contenu: string) => Map<string, string>;
  readonly composerReglages: (existant: Map<string, string>) => Reglage[];
  readonly completerEnv: (contenu: string, reglages: readonly Reglage[]) => string;
}

/** L'adresse locale d'un port — celle où l'app, et elle seule, écoute. */
export function origineLocale(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * Remplace la valeur d'une clé dans un `.env`, ou l'ajoute à la fin — sans
 * toucher au reste : commentaires, ordre et clés de l'humain restent tels
 * quels. Seule la PREMIÈRE ligne active compte, comme pour `loadEnvFile`.
 */
export function poserCle(contenu: string, cle: string, valeur: string): string {
  const lignes = contenu.split('\n');
  const i = lignes.findIndex((l) => l.trimStart().startsWith(`${cle}=`));
  if (i >= 0) {
    lignes[i] = `${cle}=${valeur}`;
    return lignes.join('\n');
  }
  const corps = contenu.replace(/\n*$/, '');
  return `${corps === '' ? '' : `${corps}\n`}${cle}=${valeur}\n`;
}

/**
 * Le `.env` de la ruche : créé au premier lancement, complété ensuite, et
 * toujours au port retenu.
 *
 * `existant` absent : une ruche neuve — jeton et secret tirés par la recette
 * de l'installeur. Présent : RIEN n'y est réécrit que le port et l'adresse que
 * l'app possède (`HIVE_PORT`, `HIVE_HTTP`) ; une clé manquante est ajoutée à la
 * fin avec son explication (`completerEnv`).
 */
export function envDeLaRuche(
  existant: string | null,
  port: number,
  recette: RecetteReglages,
): string {
  const origine = origineLocale(port);
  if (existant === null) {
    const graines = new Map([
      ['HIVE_PORT', String(port)],
      ['HIVE_HTTP', origine],
    ]);
    const reglages = recette.composerReglages(graines);
    const lignes = [
      '# La ruche de l’application de bureau Hive.',
      '# Écrit par l’app au premier lancement ; modifiable à la main. L’app ne',
      '# réécrit que HIVE_PORT et HIVE_HTTP (le port gardé de l’écran).',
      '',
    ];
    for (const r of reglages) lignes.push(`# ${r.commentaire}`, `${r.cle}=${r.valeur}`, '');
    return lignes.join('\n');
  }
  const present = recette.lireEnv(existant);
  const reglages = recette.composerReglages(present);
  const complete = recette.completerEnv(existant, reglages);
  return poserCle(poserCle(complete, 'HIVE_PORT', String(port)), 'HIVE_HTTP', origine);
}

/** Les chemins de la ruche de l'app, sous son dossier de données. */
export interface CheminsRuche {
  readonly ruche: string;
  readonly env: string;
  readonly db: string;
}

export function cheminsRuche(donnees: string): CheminsRuche {
  const ruche = path.join(donnees, 'ruche');
  return { ruche, env: path.join(ruche, '.env'), db: path.join(ruche, 'data', 'hive.db') };
}

/**
 * L'environnement des enfants : celui de l'app, MOINS toute variable `HIVE_*`
 * héritée, PLUS ce que l'app impose.
 *
 * ─── POURQUOI RETIRER LES `HIVE_*` HÉRITÉES ──────────────────────────────────
 *
 * L'environnement l'emporte sur le `.env` (`loadEnvFile` n'écrase jamais une
 * variable présente). Un `HIVE_TOKEN` exporté dans le `.zshrc` d'un développeur
 * — que l'app lit au démarrage (§ 7) — donnerait à la Reine un jeton que
 * l'écran n'a pas : un écran « jeton invalide » sans cause visible. La ruche
 * de l'app se règle par SON `.env`, et par lui seul.
 *
 * ─── CE QUE L'APP IMPOSE ─────────────────────────────────────────────────────
 *
 *   · `ELECTRON_RUN_AS_NODE=1` : le binaire de l'app en mode Node (retiré par
 *     `app/piece.cjs` avant que l'entrée ne lance quoi que ce soit) ;
 *   · `HIVE_HOST=127.0.0.1` : l'app n'expose rien sur le réseau ;
 *   · `HIVE_PORT`, le port retenu ; `HIVE_DB`, ABSOLU — le verrou « une seule
 *     Reine » (ADR 0012) se prend sur le chemin résolu ;
 *   · `HIVE_POSE=bureau` : `/api/version` dit « mise à jour automatique ».
 */
export function envDesEnfants(
  herite: NodeJS.ProcessEnv,
  chemins: CheminsRuche,
  port: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [cle, valeur] of Object.entries(herite)) {
    if (!cle.startsWith('HIVE_') && valeur !== undefined) env[cle] = valeur;
  }
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: '1',
    HIVE_HOST: '127.0.0.1',
    HIVE_PORT: String(port),
    HIVE_DB: chemins.db,
    HIVE_POSE: 'bureau',
  };
}
