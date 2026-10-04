// Reprendre une ruche installée par git (`~/hive`) — sans jamais y toucher.
//
// Au premier lancement, l'app regarde si une ruche existe déjà sur ce poste
// (`HIVE_DIR`, puis `~/hive` — les chemins de `install.sh`/`install.ps1`) et
// propose trois choix (ADR 0013 § 4) : l'OUVRIR si sa Reine répond, en
// IMPORTER une copie, ou commencer une ruche neuve. La source n'est jamais
// modifiée : une app plus récente migrerait sa base sous le code plus ancien
// du clone.
//
// Ce module décide QUOI : où chercher, ce qu'on lit d'une source, ce qu'on
// garde de son `.env`, ce qu'on copie de `.hive-work/`. L'app fait le reste.

import path from 'node:path';
import { parseEnv } from 'node:util';

/** Les clés du `.env` qui appartiennent à l'app : jamais importées d'une source. */
export const CLES_DE_L_APP = [
  'HIVE_DB',
  'HIVE_HOST',
  'HIVE_PORT',
  'HIVE_HTTP',
  'HIVE_WORKDIR',
  'HIVE_ENV_FILE',
] as const;

/** Les dossiers où une ruche installée par git peut vivre, sans doublon. */
export function dossiersCandidats(env: NodeJS.ProcessEnv, home: string): string[] {
  const vus = new Set<string>();
  for (const d of [(env.HIVE_DIR ?? '').trim(), path.join(home, 'hive')]) {
    if (d !== '') vus.add(path.resolve(d));
  }
  return [...vus];
}

/** Ce qu'on sait d'une ruche trouvée. */
export interface SourceReprise {
  readonly dossier: string;
  /** La base, résolue comme la Reine la résout (`HIVE_DB` relatif au dossier). */
  readonly db: string;
  readonly port: number;
  /** Le jeton de SA Reine — pour l'ouvrir telle quelle, jamais recopié ailleurs. */
  readonly jeton: string;
}

/**
 * Lit une source candidate : un `.env` lisible avec un jeton, et une base qui
 * existe. `null` sinon — un dossier `~/hive` sans base n'est pas une ruche à
 * reprendre, c'est un clone jamais lancé.
 */
export function lireSource(
  dossier: string,
  lire: (fichier: string) => string | null,
  existe: (fichier: string) => boolean,
): SourceReprise | null {
  const brut = lire(path.join(dossier, '.env'));
  if (brut === null) return null;
  let env: Record<string, string | undefined>;
  try {
    env = parseEnv(brut);
  } catch {
    return null;
  }
  const jeton = (env.HIVE_TOKEN ?? '').trim();
  if (jeton === '') return null;
  const db = path.resolve(dossier, (env.HIVE_DB ?? '').trim() || path.join('data', 'hive.db'));
  if (!existe(db)) return null;
  const brutPort = (env.HIVE_PORT ?? '').trim();
  const port = /^\d+$/.test(brutPort) && Number(brutPort) <= 65_535 ? Number(brutPort) : 7777;
  return { dossier, db, port: port === 0 ? 7777 : port, jeton };
}

/**
 * Le `.env` importé : celui de la source, MOINS les clés de l'app.
 *
 * Le jeton et le secret de session sont GARDÉS : les ouvrières invitées et les
 * comptes suivent la ruche. Les lignes retirées sont remplacées par un
 * commentaire qui le dit — un `.env` qu'on relit doit expliquer ses trous.
 */
export function envImporte(contenu: string): string {
  const retirees = new Set<string>(CLES_DE_L_APP);
  return contenu
    .split('\n')
    .map((l) => {
      const cle = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(l)?.[1];
      return cle !== undefined && retirees.has(cle)
        ? `# ${cle} : fixé par l’application de bureau (import de la ruche)`
        : l;
    })
    .join('\n');
}

/** Un élément à copier d'un dossier de nœud de `.hive-work/`. */
export const A_COPIER_PAR_NOEUD = ['node-id.txt', 'join', 'livraisons'] as const;

/**
 * Les copies à faire depuis `.hive-work/` : l'identité de chaque nœud et ses
 * billets/livraisons — pas ses tâches ni ses chantiers, qui sont du travail en
 * cours d'une autre installation. `noeuds` : les sous-dossiers de la source.
 */
export function copiesHiveWork(
  source: string,
  cible: string,
  noeuds: readonly string[],
): { readonly de: string; readonly vers: string }[] {
  const copies: { de: string; vers: string }[] = [];
  for (const n of noeuds) {
    // Un nom de dossier hostile (`..`) ne sort pas de `.hive-work/`.
    if (n === '' || n === '.' || n === '..' || n.includes('/') || n.includes('\\')) continue;
    for (const e of A_COPIER_PAR_NOEUD) {
      copies.push({
        de: path.join(source, '.hive-work', n, e),
        vers: path.join(cible, '.hive-work', n, e),
      });
    }
  }
  return copies;
}
