// La rustine — appliquer un diff unifié, ou refuser proprement.
//
// Pour ouvrir une pull request sur le dépôt de l'utilisateur, il faut le
// CONTENU des fichiers après changement. Une ouvrière, elle, rapporte un diff.
// Ce module fait la conversion, et rien d'autre.
//
// ─── POURQUOI PAS `git apply` ────────────────────────────────────────────────
//
// Parce que l'orchestrateur n'a pas le dépôt. Le clone vit sur la machine du
// membre, avec ses clés ; la Queen, elle, n'a que ce que le nœud lui a envoyé.
// Lancer git supposerait un checkout côté hub — c'est-à-dire exactement
// l'architecture que Hive refuse depuis le début (le code reste chez le
// membre). On reconstruit donc le contenu à partir de la base lue sur GitHub
// et du diff reçu, sans jamais rien cloner.
//
// ─── LE PARTI PRIS : CONTEXTE EXACT, REFUS PLUTÔT QUE DEVINETTE ──────────────
//
// `patch(1)` sait appliquer un hunk décalé, voire approximatif (le « fuzz »).
// C'est une bonne idée pour un humain qui regarde le résultat, et une très
// mauvaise ici : personne ne regarde. Un hunk appliqué au mauvais endroit
// produit un fichier qui compile peut-être, qui passe peut-être la revue, et
// qui ne fait pas ce que le diff disait.
//
// Donc : AUCUN décalage, AUCUN fuzz. Chaque ligne de contexte et chaque ligne
// retirée doit correspondre, caractère pour caractère, à la ligne annoncée. Au
// premier écart, le fichier ENTIER est refusé, avec le numéro de ligne et ce
// qui était attendu — de quoi comprendre en trois secondes.
//
// Le refus le plus fréquent sera « la base a bougé » : l'ouvrière a travaillé
// sur un état du dépôt qui n'est plus celui de la branche cible. C'est un
// refus SAIN. La réponse est de refaire la tâche sur la base à jour, pas de
// deviner où le hunk voulait aller.
//
// ─── ATOMICITÉ ───────────────────────────────────────────────────────────────
//
// Un diff qui touche cinq fichiers est appliqué en entier ou pas du tout. Un
// dépôt à moitié modifié est pire qu'un dépôt intact : il compile rarement, et
// il faut de toute façon comprendre ce qui manque. `appliquerRustine` calcule
// les cinq contenus AVANT de rendre quoi que ce soit.
//
// MODULE PUR — aucune I/O, aucun réseau, aucune horloge. Le contenu de base lui
// est DONNÉ ; c'est `livraison.ts` qui va le chercher.

/** Taille maximale d'un diff accepté. Au-delà, ce n'est plus une revue humaine. */
export const MAX_DIFF = 1_000_000;

/** Taille maximale d'un fichier produit. Borne la mémoire ET la charge utile GitHub. */
export const MAX_FICHIER = 1_000_000;

/** Fichiers au plus dans une rustine. Une PR de 200 fichiers ne se relit pas. */
export const MAX_FICHIERS = 100;

/** Ce que le diff fait d'un fichier. */
export type Operation = 'creation' | 'modification' | 'suppression';

/** Une ligne de hunk : son signe et son texte (sans le signe). */
export interface LigneHunk {
  signe: ' ' | '-' | '+';
  texte: string;
}

export interface Hunk {
  /** Première ligne concernée dans le fichier AVANT, en base 1. */
  debutAvant: number;
  nbAvant: number;
  debutApres: number;
  nbApres: number;
  lignes: LigneHunk[];
}

export interface FichierRustine {
  /** Chemin dans le dépôt, sans le préfixe a/ ou b/. */
  chemin: string;
  operation: Operation;
  hunks: Hunk[];
  /**
   * Le fichier APRÈS ne se termine pas par un saut de ligne.
   *
   * Le marqueur « \ No newline at end of file » porte sur UN SEUL CÔTÉ du
   * diff — celui de la ligne qui le précède. Le confondre avec l'état de la
   * base produit un octet final faux, donc un sha faux, donc une pull request
   * qui montre un changement fantôme. D'où deux drapeaux et pas un.
   */
  apresSansSaut: boolean;
  /** Le fichier AVANT ne se terminait pas par un saut de ligne. */
  avantSansSaut: boolean;
}

export interface Rustine {
  fichiers: FichierRustine[];
}

export class ErreurRustine extends Error {
  constructor(
    message: string,
    /** Ce qu'un humain peut faire. Jamais « erreur interne ». */
    readonly conseil: string,
    /** Fichier en cause, si connu. */
    readonly chemin = '',
  ) {
    super(message);
    this.name = 'ErreurRustine';
  }
}

/** Retire le préfixe `a/` ou `b/` que git met devant les chemins. */
function nettoyerChemin(brut: string): string {
  // Un chemin peut être cité par git quand il contient des caractères exotiques.
  const sansGuillemets = brut.startsWith('"') && brut.endsWith('"') ? brut.slice(1, -1) : brut;
  // Le tabulateur sépare le chemin des métadonnées (timestamp) dans certains diffs.
  const sansMeta = sansGuillemets.split('\t')[0] ?? '';
  const t = sansMeta.trim();
  if (t === '/dev/null') return '';
  return t.replace(/^[ab]\//, '');
}

/**
 * Un chemin acceptable dans un dépôt.
 *
 * SÉCURITÉ : le chemin vient d'un diff produit par un agent. `../../.ssh/id_rsa`
 * ou `/etc/passwd` doivent être refusés ICI — c'est le seul endroit qui les voit
 * avant qu'ils ne deviennent une écriture sur le dépôt de quelqu'un.
 */
export function cheminValide(chemin: string): boolean {
  if (chemin === '' || chemin.length > 400) return false;
  if (chemin.startsWith('/') || /^[A-Za-z]:/.test(chemin)) return false;
  if (chemin.includes('\\')) return false;
  if (chemin.split('/').some((s) => s === '..' || s === '' || s === '.')) return false;
  // Un caractère de contrôle dans un chemin n'a aucune raison légitime
  // d'exister — et un saut de ligne y permettrait de fabriquer une seconde
  // entrée d'arbre. Écrit en échappements : un caractère de contrôle
  // littéral dans une source est invisible à la relecture.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(chemin)) return false;
  return true;
}

const RE_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Analyse un diff unifié. Lève `ErreurRustine` sur tout ce qui n'est pas
 * applicable en confiance — jamais un « on verra bien ».
 */
export function analyserRustine(diff: string): Rustine {
  if (diff.length > MAX_DIFF) {
    throw new ErreurRustine(
      'diff trop volumineux',
      `Le diff dépasse ${MAX_DIFF} octets. Découpez la tâche : une production de cette taille ne se relit pas.`,
    );
  }
  if (diff.includes('GIT binary patch')) {
    throw new ErreurRustine(
      'diff binaire',
      'Les fichiers binaires ne sont pas livrés par la ruche. Ajoutez-les à la main.',
    );
  }

  const fichiers: FichierRustine[] = [];
  const lignes = diff.split('\n');
  let courant: FichierRustine | null = null;
  let hunk: Hunk | null = null;
  let cheminAvant: string | null = null;
  let enTete = false;

  const cloreHunk = (): void => {
    if (courant && hunk) courant.hunks.push(hunk);
    hunk = null;
  };
  const cloreFichier = (): void => {
    cloreHunk();
    if (courant) fichiers.push(courant);
    courant = null;
    cheminAvant = null;
  };

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i] ?? '';

    if (ligne.startsWith('diff --git ')) {
      cloreFichier();
      enTete = true;
      continue;
    }
    if (enTete && ligne.startsWith('--- ')) {
      cheminAvant = nettoyerChemin(ligne.slice(4));
      continue;
    }
    if (enTete && ligne.startsWith('+++ ')) {
      const cheminApres = nettoyerChemin(ligne.slice(4));
      const chemin = cheminApres || cheminAvant || '';
      if (!cheminValide(chemin)) {
        throw new ErreurRustine(
          'chemin refusé',
          'Un chemin absolu, remontant (« .. ») ou porteur de caractères de contrôle ne peut pas être écrit sur un dépôt.',
          chemin,
        );
      }
      // `cheminAvant` vide ⇒ /dev/null en source ⇒ création. Symétriquement
      // pour la suppression. Un renommage arrive ici comme suppression +
      // création, ce qui est exactement ce qu'on veut écrire sur GitHub.
      const operation: Operation =
        cheminAvant === '' ? 'creation' : cheminApres === '' ? 'suppression' : 'modification';
      courant = { chemin, operation, hunks: [], apresSansSaut: false, avantSansSaut: false };
      enTete = false;
      continue;
    }

    const m = RE_HUNK.exec(ligne);
    if (m) {
      if (!courant) {
        throw new ErreurRustine(
          'hunk orphelin',
          'Un bloc « @@ » apparaît sans en-tête de fichier : le diff est tronqué ou mal formé.',
        );
      }
      cloreHunk();
      hunk = {
        debutAvant: Number(m[1]),
        nbAvant: m[2] === undefined ? 1 : Number(m[2]),
        debutApres: Number(m[3]),
        nbApres: m[4] === undefined ? 1 : Number(m[4]),
        lignes: [],
      };
      enTete = false;
      continue;
    }

    if (!hunk || !courant) continue; // préambule, `index`, `similarity`… : ignoré

    if (ligne.startsWith('\\')) {
      // « \ No newline at end of file » porte sur la ligne PRÉCÉDENTE, et sur
      // le seul côté du diff où cette ligne existe : « + » ⇒ le fichier
      // d'après, « - » ⇒ le fichier d'avant, « » (contexte) ⇒ les deux.
      const precedente = hunk.lignes[hunk.lignes.length - 1];
      if (precedente) {
        if (precedente.signe !== '-') courant.apresSansSaut = true;
        if (precedente.signe !== '+') courant.avantSansSaut = true;
      }
      continue;
    }
    const signe = ligne[0];
    if (signe === ' ' || signe === '-' || signe === '+') {
      hunk.lignes.push({ signe, texte: ligne.slice(1) });
      continue;
    }
    if (ligne === '') {
      // Une ligne de contexte VIDE perd parfois son espace en chemin (courriel,
      // copier-coller). On ne l'accepte QUE dans un hunk déjà ouvert et pas
      // encore rassasié — sinon c'est la ligne vide qui suit le dernier hunk.
      const consommees = hunk.lignes.filter((l) => l.signe !== '+').length;
      if (consommees < hunk.nbAvant) hunk.lignes.push({ signe: ' ', texte: '' });
      continue;
    }
    // Tout autre caractère en tête clôt le hunk : on est retourné dans du
    // préambule (« diff --git » suivant est traité plus haut).
    cloreHunk();
  }
  cloreFichier();

  if (fichiers.length === 0) {
    throw new ErreurRustine(
      'aucun fichier dans le diff',
      'Le diff ne nomme aucun fichier. Une production sans diff applicable ne peut pas être livrée.',
    );
  }
  if (fichiers.length > MAX_FICHIERS) {
    throw new ErreurRustine(
      'trop de fichiers',
      `${fichiers.length} fichiers touchés (maximum ${MAX_FICHIERS}). Découpez la tâche.`,
    );
  }
  return { fichiers };
}

/**
 * Découpe un contenu en lignes, en retenant s'il finissait par un saut.
 *
 * `'a\nb\n'` → `['a','b']` + saut final ; `'a\nb'` → `['a','b']` sans saut.
 * Cette distinction n'est pas cosmétique : elle décide de l'octet final du
 * blob écrit sur GitHub, donc du sha, donc de la présence d'un diff fantôme.
 */
export function enLignes(contenu: string): { lignes: string[]; sautFinal: boolean } {
  if (contenu === '') return { lignes: [], sautFinal: false };
  const sautFinal = contenu.endsWith('\n');
  const lignes = contenu.split('\n');
  if (sautFinal) lignes.pop();
  return { lignes, sautFinal };
}

/** Recompose un contenu depuis ses lignes. */
export function enTexte(lignes: readonly string[], sautFinal: boolean): string {
  if (lignes.length === 0) return '';
  return lignes.join('\n') + (sautFinal ? '\n' : '');
}

/** Ce qu'il faut écrire pour un fichier. `contenu: null` ⇒ suppression. */
export interface Ecriture {
  chemin: string;
  contenu: string | null;
  operation: Operation;
}

/**
 * Applique les hunks d'un fichier sur son contenu de base.
 *
 * `base` vaut `null` quand le fichier n'existe pas encore sur le dépôt : une
 * création l'exige, une modification le REFUSE (le diff parlait d'un fichier
 * qui n'est pas là, c'est une base divergente, pas un cas à rattraper).
 */
export function appliquerFichier(fichier: FichierRustine, base: string | null): Ecriture {
  if (fichier.operation === 'suppression') {
    return { chemin: fichier.chemin, contenu: null, operation: 'suppression' };
  }
  if (fichier.operation === 'creation' && base !== null && base !== '') {
    throw new ErreurRustine(
      'le fichier existe déjà',
      'Le diff crée un fichier qui est déjà présent sur la branche cible. La base a bougé : refaites la tâche sur la base à jour.',
      fichier.chemin,
    );
  }
  if (fichier.operation === 'modification' && base === null) {
    throw new ErreurRustine(
      'fichier introuvable',
      'Le diff modifie un fichier absent de la branche cible. La base a bougé : refaites la tâche sur la base à jour.',
      fichier.chemin,
    );
  }

  const { lignes: source, sautFinal } = enLignes(base ?? '');
  const sortie: string[] = [];
  // Curseur dans `source`, en base 0. Les hunks sont appliqués dans l'ordre.
  let curseur = 0;

  for (const hunk of fichier.hunks) {
    // Un hunk d'insertion pure en tête de fichier vide s'annonce « -0,0 ».
    const debut = Math.max(0, hunk.debutAvant - 1);
    if (debut < curseur) {
      throw new ErreurRustine(
        'hunks non ordonnés ou chevauchants',
        'Deux blocs du diff se recouvrent. Le diff n’est pas applicable tel quel.',
        fichier.chemin,
      );
    }
    if (debut > source.length) {
      throw new ErreurRustine(
        `le diff vise la ligne ${hunk.debutAvant}, le fichier en compte ${source.length}`,
        'La base a bougé depuis que l’ouvrière a travaillé. Refaites la tâche sur la base à jour.',
        fichier.chemin,
      );
    }
    // Tout ce qui précède le hunk est recopié tel quel.
    sortie.push(...source.slice(curseur, debut));
    curseur = debut;

    for (const l of hunk.lignes) {
      if (l.signe === '+') {
        sortie.push(l.texte);
        continue;
      }
      const attendue = source[curseur];
      if (attendue === undefined) {
        throw new ErreurRustine(
          `le diff attend une ligne ${curseur + 1} qui n’existe pas`,
          'La base a bougé depuis que l’ouvrière a travaillé. Refaites la tâche sur la base à jour.',
          fichier.chemin,
        );
      }
      if (attendue !== l.texte) {
        throw new ErreurRustine(
          `ligne ${curseur + 1} : le diff attendait « ${apercu(l.texte)} », le dépôt a « ${apercu(attendue)} »`,
          'Aucun décalage n’est toléré : un bloc appliqué au mauvais endroit produit du code que personne n’a écrit. Refaites la tâche sur la base à jour.',
          fichier.chemin,
        );
      }
      curseur += 1;
      if (l.signe === ' ') sortie.push(l.texte);
    }
  }
  sortie.push(...source.slice(curseur));

  // Le saut final du fichier PRODUIT dépend de qui écrit sa dernière ligne.
  // Si le dernier hunk consomme la base jusqu'au bout, c'est le diff qui a le
  // dernier mot (et « \ No newline » côté « + » le dit). S'il reste une queue
  // recopiée depuis la base, c'est la base qui garde son octet final.
  const queueRecopiee = curseur < source.length;
  const sautProduit = queueRecopiee ? sautFinal : !fichier.apresSansSaut;
  const contenu = enTexte(sortie, sautProduit);
  if (contenu.length > MAX_FICHIER) {
    throw new ErreurRustine(
      'fichier produit trop volumineux',
      `Le fichier dépasserait ${MAX_FICHIER} octets après application.`,
      fichier.chemin,
    );
  }
  return { chemin: fichier.chemin, contenu, operation: fichier.operation };
}

/** Extrait lisible d'une ligne, pour un message d'erreur. */
function apercu(texte: string): string {
  const t = texte.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

/**
 * Applique une rustine entière. TOUT ou RIEN : les écritures ne sont rendues
 * que si les N fichiers ont pu être calculés.
 *
 * `bases` associe chaque chemin à son contenu actuel sur la branche cible, ou
 * `null` s'il n'y est pas.
 */
export function appliquerRustine(
  rustine: Rustine,
  bases: ReadonlyMap<string, string | null>,
): Ecriture[] {
  const ecritures: Ecriture[] = [];
  for (const fichier of rustine.fichiers) {
    ecritures.push(appliquerFichier(fichier, bases.get(fichier.chemin) ?? null));
  }
  return ecritures;
}

/** Chemins touchés par une rustine — ce qu'il faut aller lire avant d'appliquer. */
export function cheminsDe(rustine: Rustine): string[] {
  return [...new Set(rustine.fichiers.map((f) => f.chemin))].sort();
}
