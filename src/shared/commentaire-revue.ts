// Commentaires de revue ANCRÉS — la revue ligne par ligne de la Miellerie (G06).
//
// ─── POURQUOI UN ANCRAGE, ET PAS SEULEMENT UNE RAISON ────────────────────────
//
// Le rejet de la Miellerie portait une raison libre sur TOUTE la production.
// Ce que le relecteur voyait sur une ligne précise, il devait le reformuler
// (« dans le deuxième fichier, vers le milieu, la boucle… ») et l'ouvrière
// corrigeait ensuite à l'aveugle. Un commentaire porte donc une PLAGE de
// lignes d'un fichier du diff : `{fichier, ligneDebut, ligneFin, texte}`.
//
// ─── QUELLE NUMÉROTATION ─────────────────────────────────────────────────────
//
// Celle de la version MODIFIÉE du fichier (le côté `+` du diff) : c'est le
// fichier que la correction reprend. Seules les lignes qui y EXISTENT sont
// ancrables — ajoutées ou de contexte. Une ligne supprimée n'a pas de numéro
// dans la version modifiée : l'écran ne la propose pas, la Reine la refuse.
//
// La Reine et l'écran lisent le diff avec LA MÊME fonction (`numerosNouveaux`) :
// deux lectures finiraient par ne plus désigner la même ligne, et la
// correction recevrait un commentaire ancré à côté de ce que l'humain a vu.
//
// ─── L'ORDRE DE PERTINENCE ───────────────────────────────────────────────────
//
// Sources d'abord, puis tests, puis les ANNEXES — fixtures, instantanés,
// fichiers générés, verrous de dépendances — que l'écran grise : un relecteur
// qui ouvre la production tombait sur `package-lock.json` avant le code. Le
// même ordre range les commentaires dans la critique transmise, pour que la
// queue qui tombe au budget soit celle qui compte le moins.
//
// Module PUR : aucune I/O — importé par la Reine ET par le tableau de bord.

/**
 * Le texte d'un commentaire. Aligné sur la raison d'un verdict
 * (`RAISON_REVUE_MAX`, war-room.ts) : c'est la même donnée d'opérateur, qui
 * finit dans le même contexte d'ouvrière.
 */
export const COMMENTAIRE_TEXTE_MAX = 1_000;
/** Le chemin d'un fichier ancré (un chemin plus long ne figure dans aucun diff raisonnable). */
export const COMMENTAIRE_FICHIER_MAX = 500;
/** Une plage au plus de cette hauteur : au-delà, c'est un commentaire de fichier, pas de lignes. */
export const COMMENTAIRE_PLAGE_MAX = 200;
/**
 * Commentaires EN ATTENTE au plus par production. Ils partent tous dans UNE
 * correction dont le contexte est borné (`BUDGET_CRITIQUE_COMMENTEE`) : au-delà,
 * la queue ne serait lue par personne — mieux vaut le dire à l'humain.
 */
export const COMMENTAIRES_PAR_PRODUCTION_MAX = 30;
/** L'extrait des lignes commentées, joint pour la correction qui ne les verrait plus. */
export const EXTRAIT_LIGNES_MAX = 6;
export const EXTRAIT_MAX = 400;
const EXTRAIT_LIGNE_MAX = 160;

/** Un commentaire tel que la Reine le range et le rend. */
export interface CommentaireRevue {
  id: string;
  taskId: string;
  /** La production commentée : un commentaire ne suit jamais la suivante. */
  resultId: number;
  fichier: string;
  ligneDebut: number;
  ligneFin: number;
  /** Caviardé à l'entrée (secrets de la Reine) — jamais le texte brut. */
  texte: string;
  /** Les lignes commentées, relues du diff à l'ancrage (vide si illisibles). */
  extrait: string;
  /** Le compte qui l'a posé, `null` pour le jeton de ruche. Une trace, pas une autorité. */
  auteur: string | null;
  creeA: number;
  /** L'envoi « demander des changements » qui l'a emporté ; `null` = en attente. */
  soumission: string | null;
  soumisA: number | null;
}

// ─── Lecture du diff ─────────────────────────────────────────────────────────

const ENTETE_FICHIER = /^diff --git a\/(.+?) b\/(.+)$/;
const ENTETE_PLAGE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Les sections d'un diff unifié, une par fichier, avec le chemin du côté modifié. */
export function sectionsDuDiff(diff: string): { fichier: string; lignes: string[] }[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter((c) => c.startsWith('diff --git '))
    .map((chunk) => {
      const lignes = chunk.replace(/\n$/, '').split('\n');
      const tete = lignes[0] ?? '';
      return { fichier: ENTETE_FICHIER.exec(tete)?.[2] ?? tete.slice(11), lignes };
    });
}

/**
 * Le numéro, dans la version MODIFIÉE du fichier, de chaque ligne d'une
 * section de diff — `null` pour ce qui n'y existe pas (en-têtes, lignes
 * supprimées, « \ No newline at end of file »).
 *
 * Un `---`/`+++` n'est un en-tête qu'AVANT la première plage : dedans, c'est
 * une ligne supprimée ou ajoutée qui commence par deux tirets ou deux plus.
 * Une ligne VIDE dans une plage est une ligne de contexte vide dont l'espace
 * de tête a été rogné par un éditeur : elle compte.
 */
export function numerosNouveaux(lignes: readonly string[]): (number | null)[] {
  let courant: number | null = null;
  return lignes.map((ligne) => {
    const plage = ENTETE_PLAGE.exec(ligne);
    if (plage) {
      courant = Number(plage[1]);
      return null;
    }
    if (courant === null || ligne.startsWith('-') || ligne.startsWith('\\')) return null;
    return courant++;
  });
}

/**
 * Relit l'ancre d'un commentaire dans le diff de la production : le fichier
 * y figure, ses deux bornes existent dans sa version modifiée, la plage tient
 * dans `COMMENTAIRE_PLAGE_MAX`. Rend l'extrait des lignes visibles de la plage
 * (préfixe `+` ou espace conservé : ajoutée ou contexte), ou le motif du refus.
 */
export function ancrerDansLeDiff(
  diff: string,
  ancre: { fichier: string; ligneDebut: number; ligneFin: number },
): { ok: true; extrait: string } | { ok: false; motif: string } {
  const { fichier, ligneDebut, ligneFin } = ancre;
  if (ligneFin < ligneDebut) return { ok: false, motif: 'plage à l’envers (fin avant début)' };
  if (ligneFin - ligneDebut + 1 > COMMENTAIRE_PLAGE_MAX) {
    return { ok: false, motif: `plage de plus de ${COMMENTAIRE_PLAGE_MAX} lignes` };
  }
  const section = sectionsDuDiff(diff).find((s) => s.fichier === fichier);
  if (!section) return { ok: false, motif: 'fichier absent du diff de cette production' };
  const numeros = numerosNouveaux(section.lignes);
  const visibles: string[] = [];
  let debutVu = false;
  let finVue = false;
  numeros.forEach((n, i) => {
    if (n === null || n < ligneDebut || n > ligneFin) return;
    debutVu ||= n === ligneDebut;
    finVue ||= n === ligneFin;
    visibles.push(section.lignes[i] ?? '');
  });
  if (!debutVu || !finVue) {
    return { ok: false, motif: 'ligne absente de la version modifiée dans ce diff' };
  }
  const extrait = visibles
    .slice(0, EXTRAIT_LIGNES_MAX)
    .map((l) => (l.length > EXTRAIT_LIGNE_MAX ? `${l.slice(0, EXTRAIT_LIGNE_MAX - 1)}…` : l))
    .join(' ⏎ ');
  return {
    ok: true,
    extrait: extrait.length > EXTRAIT_MAX ? `${extrait.slice(0, EXTRAIT_MAX - 1)}…` : extrait,
  };
}

// ─── Pertinence ──────────────────────────────────────────────────────────────

/** Ce qu'est un fichier pour un relecteur. `annexe` : fixture, instantané, généré, verrou. */
export type NatureFichier = 'source' | 'test' | 'annexe';

const VERROUS = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'uv.lock',
  'go.sum',
  'composer.lock',
  'gemfile.lock',
  'podfile.lock',
  'flake.lock',
]);
const ANNEXES = [
  /(^|\/)(dist|build|out|coverage|vendor|node_modules|__generated__|generated)\//,
  /(^|\/)(__)?fixtures?(__)?\//,
  /(^|\/)testdata\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /(\.pb\.go|_pb2\.py|\.g\.dart|\.generated\.[a-z0-9]+)$/,
];
const TESTS = [
  /(^|\/)(tests?|__tests__|specs?|e2e)\//,
  /\.(test|spec)\.[^/]+$/,
  /_test\.(go|py|rs|rb|exs?)$/,
  /(^|\/)test_[^/]+\.py$/,
];

/** La nature d'un chemin. Les annexes d'abord : une fixture sous `tests/` reste une annexe. */
export function natureFichier(chemin: string): NatureFichier {
  const c = chemin.replace(/\\/g, '/').toLowerCase();
  const base = c.slice(c.lastIndexOf('/') + 1);
  if (VERROUS.has(base) || ANNEXES.some((m) => m.test(c))) return 'annexe';
  if (TESTS.some((m) => m.test(c))) return 'test';
  return 'source';
}

const RANG: Record<NatureFichier, number> = { source: 0, test: 1, annexe: 2 };

/** Trie par pertinence (sources, tests, annexes), STABLE : l'ordre du diff tient à rang égal. */
export function ordonnerParPertinence<T>(elements: readonly T[], chemin: (e: T) => string): T[] {
  return elements
    .map((e, i) => ({ e, i, rang: RANG[natureFichier(chemin(e))] }))
    .sort((a, b) => a.rang - b.rang || a.i - b.i)
    .map((x) => x.e);
}
