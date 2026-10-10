// LA LECTURE VÉRIFIÉE DE LA BASE — la seule porte par laquelle l'hôte relit un
// fichier du commit de BASE d'une tâche, après que l'agent a tourné.
//
// ─── LE TROU QUE CE MODULE FERME ─────────────────────────────────────────────
//
// Le registre de la ruche (`git-hote.ts`) emprunte les objets de la tâche par
// `alternates` : des données, lues seulement. Mais git NE VÉRIFIE PAS
// l'empreinte d'un objet libre qu'il lit — mesuré, git 2.53 : un objet valide
// rangé sous le NOM d'un autre (son empreinte) est rendu tel quel par
// `cat-file` comme par `checkout`, sans un mot ; seul `git fsck` signale le
// `hash-path mismatch`. L'agent travaille dans son `.git`, objets compris : il
// peut donc forger l'objet d'un fichier de la base, et une lecture directe
// (`cat-file blob <base>:<fichier>`) rend alors le CONTENU FORGÉ.
//
// Ce que ça permettait, sans une ligne dans le diff :
//   · le plan de validation lit les scripts du `package.json` de base — forgé
//     en `"test":"exit 0"`, la production se juge elle-même et rend du vert ;
//   · la porte G10 compare les lockfiles de base et de tête — forger la base
//     pour qu'elle PORTE DÉJÀ une vulnérabilité l'excuse comme « déjà là ».
//
// ─── POURQUOI RECALCULER L'EMPREINTE, ET PAS `extraireBase` ──────────────────
//
// Deux mécanismes ferment le trou. `extraireBase` (`git-hote.ts`) remplit un
// dépôt NEUF par `fetch`, qui RENOMME chaque objet d'après son contenu et
// vérifie que le commit reçu est complet : un objet forgé n'y arrive jamais
// sous le nom qu'il usurpe. Mais le `fetch` extrait TOUT l'arbre, sur le
// disque, borné à cinq minutes — c'est le prix du rejeu des tests (installation
// comprise), pas d'une lecture de fichier. Et il n'existe que PARESSEUSEMENT,
// quand des tests en échec se comparent (G11b).
//
// Les lecteurs d'ICI — plan de validation, porte de sécurité — tournent sur
// CHAQUE production, avant et sans ce rejeu. Ils lisent quelques fichiers
// nommés. Pour eux, on VÉRIFIE LA CHAÎNE : depuis le `baseSha` de confiance, on
// relit chaque objet du chemin commit → arbre(s) → blob EN BRUT et on recalcule
// son empreinte (`<type> <taille>\0` + contenu, puis SHA). Un pointeur n'est
// suivi que depuis un objet dont l'empreinte est déjà vérifiée : forger un
// maillon demanderait une collision de l'empreinte — la sécurité de git
// elle-même. Pas de réseau, pas d'arbre extrait, une poignée d'objets par fichier.
//
// ─── D'OÙ VIENT LE `baseSha` DE CONFIANCE ────────────────────────────────────
//
// Pas du hub : `AssignTaskMsg` (`shared/protocol.ts`) ne porte AUCUN SHA. C'est
// le NŒUD qui le capture — `commitDeDepart` du clone, lu AVANT que l'agent ne
// tourne (`workspace.ts`), rangé dans `Workspace.baseSha`, en mémoire du nœud,
// hors de portée de l'agent (qui n'écrit que dans l'arbre et le `.git` de sa
// tâche). C'est ce point de départ, et lui seul, contre lequel le diff, les
// validations et la porte jugent la production. On le revérifie quand même : il
// ne coûte qu'une relecture, et c'est le premier maillon de la chaîne.
//
// Un objet qui ne correspond pas à son nom = `BaseFalsifiee`, cause lisible :
// l'appelant REJETTE la production en le disant, jamais une lecture silencieuse
// du contenu forgé, jamais un vert. Un fichier simplement ABSENT de la base
// rend `null` — ce n'est pas une falsification.

import { createHash } from 'node:crypto';
import { EchecGitHote, gitHote, gitHoteOctets } from '../shared/git-protege.js';
import type { DepotEpingle } from '../shared/git-protege.js';

/**
 * Une lecture de la base dont un objet ne correspond pas à son empreinte :
 * l'agent a forgé un objet du dépôt de la tâche. Jamais le contenu forgé — la
 * production est rejetée avec cette cause. `fichier` nomme la lecture.
 */
export class BaseFalsifiee extends Error {
  constructor(
    readonly fichier: string,
    readonly detail: string,
  ) {
    super(`base falsifiée dans l'espace de travail — ${fichier} (${detail})`);
    this.name = 'BaseFalsifiee';
  }
}

/** L'algorithme d'empreinte du dépôt et la taille brute de ses empreintes dans un arbre. */
interface FormatObjets {
  algo: 'sha1' | 'sha256';
  /** 20 pour SHA-1, 32 pour SHA-256 : la taille du hash BRUT dans une entrée d'arbre. */
  octets: number;
  /** La longueur attendue d'une empreinte en hexadécimal. */
  hex: number;
}

/**
 * Le format d'objets du dépôt, lu de sa configuration. `extensions.objectFormat`
 * vaut `sha256` pour un dépôt SHA-256 ; absent (code 1, sans un mot), c'est
 * SHA-1. Un dépôt SHA-256 nomme ses objets sur 64 caractères et range 32
 * octets de hash par entrée d'arbre — recalculer en SHA-1 n'y vérifierait rien.
 *
 * `compatObjectFormat` (un dépôt SHA-256 qui porte AUSSI des noms SHA-1 pour
 * l'interopérabilité) n'est pas géré : la base passe par `commitDeDepart`
 * (`git rev-parse HEAD`), qui rend l'empreinte du format NATIF — jamais un nom
 * de compatibilité. Un `baseSha` du mauvais format échouerait à `estEmpreinte`
 * ou au premier recalcul : fermé, jamais une lecture silencieuse.
 */
async function formatObjets(depot: DepotEpingle): Promise<FormatObjets> {
  let valeur = '';
  try {
    valeur = (await gitHote(['config', '--get', 'extensions.objectFormat'], depot)).trim();
  } catch (e) {
    // Toute AUTRE panne que « clé absente » remonte : lire la base sans savoir
    // son format vérifierait avec le mauvais algorithme.
    if (!(e instanceof EchecGitHote && e.code === 1)) throw e;
  }
  return valeur === 'sha256'
    ? { algo: 'sha256', octets: 32, hex: 64 }
    : { algo: 'sha1', octets: 20, hex: 40 };
}

/** Une empreinte complète du bon format — ce que `git rev-parse` rend. */
function estEmpreinte(oid: string, format: FormatObjets): boolean {
  return oid.length === format.hex && /^[0-9a-f]+$/.test(oid);
}

/**
 * Relit l'objet `oid` du type attendu, EN BRUT, et vérifie que son empreinte
 * recalculée est bien `oid`. `cat-file <type> <oid>` rend le CONTENU (sans
 * l'en-tête `<type> <taille>\0`), sans filtre ni `textconv` — on reconstitue
 * l'en-tête pour l'empreinte. Un `--git-dir` épinglé, jamais le `.git` de la
 * tâche (`git-hote.ts`).
 */
async function objetVerifie(
  depot: DepotEpingle,
  oid: string,
  type: 'commit' | 'tree' | 'blob',
  format: FormatObjets,
  fichier: string,
): Promise<Buffer> {
  let contenu: Buffer;
  try {
    contenu = await gitHoteOctets(['cat-file', type, oid], depot);
  } catch (e) {
    // L'objet manque (forgerie incomplète, dépôt amputé) ou n'est pas du type
    // attendu : la chaîne ne se vérifie pas, la base n'est pas celle qu'on croit.
    throw new BaseFalsifiee(fichier, e instanceof Error ? e.message : String(e));
  }
  const empreinte = createHash(format.algo);
  empreinte.update(`${type} ${contenu.length}\0`);
  empreinte.update(contenu);
  const calcule = empreinte.digest('hex');
  if (calcule !== oid) {
    throw new BaseFalsifiee(
      fichier,
      `objet ${type} ${oid.slice(0, 12)} forgé (empreinte réelle ${calcule.slice(0, 12)})`,
    );
  }
  return contenu;
}

/** Le pointeur `tree <oid>` d'un commit déjà vérifié, lu de son contenu brut. */
function arbreDuCommit(commit: Buffer, format: FormatObjets, fichier: string): string {
  // L'en-tête d'un commit est en ASCII, une clé par ligne, jusqu'à la ligne
  // vide : `tree <oid>` y est toujours la première.
  const tete = commit.subarray(0, Math.min(commit.length, 1024)).toString('utf8');
  const m = /^tree ([0-9a-f]+)\n/.exec(tete);
  if (!m?.[1] || !estEmpreinte(m[1], format)) {
    throw new BaseFalsifiee(fichier, 'commit de base sans arbre lisible');
  }
  return m[1];
}

/** Les modes git d'un fichier ORDINAIRE : seuls ceux-là se lisent comme un fichier. */
const FICHIER_ORDINAIRE = new Set(['100644', '100755']);
/** Le mode d'un sous-arbre (répertoire) : le seul qu'on descend. */
const SOUS_ARBRE = '40000';

/**
 * L'entrée `nom` d'un arbre déjà vérifié — son empreinte ET son mode — ou
 * `null` si l'entrée n'existe pas (fichier absent de la base).
 *
 * Format d'une entrée (gitformat) : `<mode ASCII octal> <nom>\0<hash BRUT>`,
 * concaténées sans séparateur. Le hash fait `format.octets` octets. On lit les
 * entrées une à une ; les octets du hash ne se décodent jamais en texte.
 */
function entreeDArbre(
  arbre: Buffer,
  nom: string,
  format: FormatObjets,
  fichier: string,
): { oid: string; mode: string } | null {
  const cible = Buffer.from(nom, 'utf8');
  let i = 0;
  while (i < arbre.length) {
    const espace = arbre.indexOf(0x20, i);
    const nul = espace > i ? arbre.indexOf(0x00, espace + 1) : -1;
    // Le hash occupe `[nul + 1, nul + format.octets]` : il est tronqué dès que
    // `nul + 1 + format.octets > arbre.length`. `subarray` tronquerait en
    // silence — on refuse plutôt.
    if (espace < 0 || nul < 0 || nul + 1 + format.octets > arbre.length) {
      throw new BaseFalsifiee(fichier, 'arbre de base mal formé');
    }
    const mode = arbre.subarray(i, espace).toString('utf8');
    const entree = arbre.subarray(espace + 1, nul);
    const hash = arbre.subarray(nul + 1, nul + 1 + format.octets);
    if (entree.equals(cible)) return { oid: hash.toString('hex'), mode };
    i = nul + 1 + format.octets;
  }
  return null;
}

/** Ce qu'une entrée finale est, une fois le chemin vérifié. */
type EntreeFinale =
  | { genre: 'fichier'; oid: string }
  | { genre: 'absent' }; // n'existe pas, ou n'est pas un fichier ordinaire

/**
 * Navigue de `baseSha` jusqu'à l'entrée de `fichier`, en VÉRIFIANT chaque objet
 * du chemin commit → arbre(s). Rend l'entrée finale si c'est un fichier
 * ordinaire, sinon `absent` (chemin inexistant, dossier, sous-module `gitlink`
 * ou lien symbolique — aucun n'est un fichier qu'on lit). Lève `BaseFalsifiee`
 * si un objet du chemin ne correspond pas à son empreinte.
 */
async function naviguerVersEntree(
  depot: DepotEpingle,
  baseSha: string,
  fichier: string,
  format: FormatObjets,
): Promise<EntreeFinale> {
  if (!estEmpreinte(baseSha, format)) {
    throw new BaseFalsifiee(fichier, `commit de base ${baseSha.slice(0, 12)} hors format`);
  }
  const commit = await objetVerifie(depot, baseSha, 'commit', format, fichier);
  let arbreOid = arbreDuCommit(commit, format, fichier);
  // Les chemins git sont en `/`, partout : le fichier vient du diff, d'une
  // table du dépôt ou de `ls-files`, jamais d'un chemin d'hôte.
  const segments = fichier.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) return { genre: 'absent' };
  for (let k = 0; k < segments.length; k += 1) {
    const arbre = await objetVerifie(depot, arbreOid, 'tree', format, fichier);
    const entree = entreeDArbre(arbre, segments[k] ?? '', format, fichier);
    if (!entree) return { genre: 'absent' };
    if (k === segments.length - 1) {
      // Un sous-module (`160000`) ou un lien symbolique (`120000`) n'est pas un
      // fichier qu'on lit comme un blob : absent de ce point de vue, jamais une
      // alarme (`cat-file blob` sur un gitlink échouerait, lèverait à tort).
      return FICHIER_ORDINAIRE.has(entree.mode)
        ? { genre: 'fichier', oid: entree.oid }
        : { genre: 'absent' };
    }
    if (entree.mode !== SOUS_ARBRE) return { genre: 'absent' }; // pas un dossier
    arbreOid = entree.oid;
  }
  return { genre: 'absent' };
}

/**
 * Lit `fichier` du commit de BASE `baseSha`, en VÉRIFIANT chaque objet de la
 * chaîne (voir l'en-tête) ; `null` si le fichier n'existe pas à la base (ou
 * n'y est pas un fichier ordinaire). Lève `BaseFalsifiee` si un objet du
 * chemin ne correspond pas à son empreinte.
 */
export async function lireFichierDeBaseVerifie(
  depot: DepotEpingle,
  baseSha: string,
  fichier: string,
): Promise<string | null> {
  const format = await formatObjets(depot);
  const entree = await naviguerVersEntree(depot, baseSha, fichier, format);
  if (entree.genre === 'absent') return null;
  const blob = await objetVerifie(depot, entree.oid, 'blob', format, fichier);
  return blob.toString('utf8');
}

/**
 * L'empreinte VÉRIFIÉE du blob de `fichier` au commit de BASE — `null` s'il est
 * absent ou n'est pas un fichier ordinaire. Lève `BaseFalsifiee` si un ARBRE du
 * chemin est forgé. L'empreinte vient de l'entrée d'arbre vérifiée : comparer
 * deux empreintes (base contre tête) dit si le fichier a changé sans lire son
 * contenu — et une base forgée ne peut pas déguiser ce changement, puisque
 * forger le blob ne change pas le pointeur que l'arbre (vérifié) porte.
 */
export async function oidDeBaseVerifie(
  depot: DepotEpingle,
  baseSha: string,
  fichier: string,
): Promise<string | null> {
  const format = await formatObjets(depot);
  const entree = await naviguerVersEntree(depot, baseSha, fichier, format);
  return entree.genre === 'fichier' ? entree.oid : null;
}
