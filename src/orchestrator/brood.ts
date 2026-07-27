// Couveuse (Brood Chamber) — les re-tentatives apprennent de leurs échecs.
//
// Dans la ruche, les nourrices soignent les larves mal en point avant de les
// rendre au couvain. Ici, quand une tâche déjà échouée est ré-assignée,
// l'ouvrière suivante ne repart pas de zéro : on injecte dans son contexte un
// résumé compact des échecs précédents (les dernières lignes d'erreur des
// logs) pour qu'elle ne refasse pas la même erreur. Comme pheromones.ts ou
// thermo.ts, ce module est PUR : aucune I/O, aucun état — une vue dérivée des
// résultats, testable isolément.

/** Longueur maximale d'une ligne d'extrait (au-delà : tronquée, '…' final). */
const LIGNE_MAX = 200;

/** Nombre maximal de lignes retenues par échec. */
const LIGNES_PAR_ECHEC = 6;

/** Séparateur entre lignes d'un même extrait — la leçon tient sur une ligne. */
const JOINT = ' ⏎ ';

/** Lignes qui « sentent » l'erreur : privilégiées dans l'extrait. */
const MOTIF_ERREUR = /error|erreur|échec|failed|exception|traceback|assert/i;

// Séquences d'échappement ANSI (couleurs, curseur…) : bruit de terminal qui
// n'apprend rien à l'ouvrière suivante — retirées avant toute analyse.
// eslint-disable-next-line no-control-regex
const MOTIF_ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;

/**
 * Un échec précédent d'une tâche, prêt à être résumé. La table `results` ne
 * stocke que le nodeId : c'est à L'APPELANT de résoudre le NOM du nœud
 * (store.getNode(...)?.name, repli sur l'id si le nœud a disparu) et de
 * numéroter les tentatives (ordre chronologique, 1 = première) — le module
 * reçoit des enregistrements déjà joints et reste pur, sans accès au store.
 */
export interface EchecPrecedent {
  /** Numéro de tentative (1 = premier essai), dans l'ordre chronologique. */
  attempt: number;
  /** Nom du nœud qui a échoué (ou son id, si le nœud a disparu). */
  nodeName: string;
  /** Logs bruts remontés par le nœud (peuvent contenir de l'ANSI). */
  logs: string;
  /** Horodatage du résultat (ms epoch) — ordonne les leçons. */
  createdAt: number;
}

/**
 * Extrait la leçon d'un log d'échec : ses DERNIÈRES lignes non vides (c'est là
 * que vivent les erreurs), ANSI retiré, chaque ligne bornée à 200 caractères,
 * au plus 6 lignes jointes par ' ⏎ '. Si des lignes ressemblent à des erreurs
 * (error, erreur, échec, failed, exception, traceback, assert), ce sont les 6
 * dernières D'ENTRE ELLES qui sont retenues — le bruit (installation,
 * compilation, progression) est écarté.
 */
export function extraitDesLogs(logs: string): string {
  const lignes = logs
    .replace(MOTIF_ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const erreurs = lignes.filter((l) => MOTIF_ERREUR.test(l));
  return (erreurs.length > 0 ? erreurs : lignes)
    .slice(-LIGNES_PAR_ECHEC)
    .map((l) => (l.length > LIGNE_MAX ? `${l.slice(0, LIGNE_MAX - 1)}…` : l))
    .join(JOINT);
}

/**
 * Assemble le bloc de leçons à injecter dans le hiveContext d'une tâche
 * ré-assignée. Vide si aucun échec. Le bloc TOTAL est borné à maxChars : en
 * cas de dépassement, les tentatives les plus ANCIENNES sont retirées en
 * entier (les récentes sont les plus instructives) — jamais de coupe au
 * milieu d'une ligne « — Tentative » ; si l'unique tentative restante déborde
 * encore, son extrait est tronqué avec une ellipse '…'. L'en-tête annonce le
 * nombre TOTAL d'échecs, même quand le budget ne montre que les derniers.
 */
export function leconsDesEchecs(echecs: EchecPrecedent[], maxChars: number): string {
  if (echecs.length === 0) return '';
  const entete = `⚠️ Couveuse — cette tâche a déjà échoué ${echecs.length} fois. Leçons des tentatives précédentes :`;
  const pied = 'Ne répète pas ces erreurs ; corrige la cause avant tout.';
  // Ordre chronologique d'affichage (robuste à une entrée non triée).
  const lignes = [...echecs]
    .sort((a, b) => a.createdAt - b.createdAt || a.attempt - b.attempt)
    .map(
      (e) =>
        `— Tentative ${e.attempt} (${e.nodeName}) : ${extraitDesLogs(e.logs) || '(aucun log)'}`,
    );
  const assembler = (retenues: string[]): string => [entete, ...retenues, pied].join('\n');

  // Budget : retirer des tentatives ENTIÈRES, les plus anciennes d'abord.
  let retenues = lignes;
  while (retenues.length > 1 && assembler(retenues).length > maxChars) {
    retenues = retenues.slice(1);
  }
  let bloc = assembler(retenues);
  if (bloc.length > maxChars) {
    // Une seule tentative reste et déborde : tronquer SON extrait avec '…'.
    const derniere = retenues[retenues.length - 1] ?? '';
    const garder = derniere.length - (bloc.length - maxChars) - 1; // −1 : place de l'ellipse
    bloc = assembler([`${derniere.slice(0, Math.max(0, garder))}…`]);
  }
  // Garde-fou d'un budget pathologique (< en-tête + pied) : coupe franche.
  return bloc.length > maxChars ? bloc.slice(0, maxChars) : bloc;
}
