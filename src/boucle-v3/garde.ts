// LA PORTE DES CHANGEMENTS SENSIBLES — ce que la boucle Hive → Hive ne livre
// jamais sans qu'un humain l'ait validé.
//
// ─── POURQUOI UNE PORTE DE PLUS ─────────────────────────────────────────────
//
// Quand Hive travaille sur SON PROPRE dépôt, la production d'une ouvrière peut
// toucher ce qui la tient en laisse : les gardes des routes, le caviardage, le
// bac, les niveaux d'autonomie, les workflows CI, les scripts qui exécutent du
// code. Les portes existantes (Gardiennes, contre-revue, Evaluator, fusion
// humaine) jugent si une production est BONNE ; aucune ne demande si elle
// retire un garde-fou. Une production propre, relue et verte qui affaiblit
// `engagementTache` passe toutes ces portes — et c'est exactement celle qu'une
// ruche qui s'améliore elle-même finirait par écrire.
//
// Ouvrir la pull request n'est pas anodin non plus : la branche est poussée
// DANS le dépôt, et la CI d'une PR de même dépôt tourne avec ses secrets. Un
// workflow modifié s'exécute donc dès l'ouverture, bien avant tout merge.
//
// ─── UNE LISTE NOMMÉE, ET FERMÉE SUR CE QU'ELLE NE LIT PAS ──────────────────
//
// La porte est une LISTE de surfaces, chacune avec sa raison : ce qui n'y est
// pas est `libre`. Ce n'est pas une liste blanche — la ruche doit pouvoir
// améliorer `planner.ts` sans réveiller un humain à chaque production —, donc
// la liste doit couvrir tout ce dont une garde DÉPEND, pas seulement la garde :
// le parseur que la porte et la livraison partagent (`rustine.ts`), les
// verdicts qui arrêtent une livraison (Evaluator, Gardiennes, contre-expertise,
// preuves CI), la table où dorment revues et comptes (`store.ts`), le client
// du nœud qui caviarde tout ce qui en sort. Un banc éprouve chacune de ces
// dépendances ; en ajouter une passe elle-même par cette porte.
//
// Elle est FERMÉE, en revanche, sur tout ce qu'elle ne sait pas lire :
//
//   · Les chemins sont lus par le parseur même de la livraison
//     (`analyserRustine`, `orchestrator/rustine.ts`) : la Reine écrira sur
//     GitHub exactement les fichiers que la porte a vus, pas un de plus. Un
//     diff qu'il refuse (binaire, chemin remontant ou cité par git, trop gros)
//     est `illisible` — la Reine ne le livrerait pas, la porte ne le déclare
//     pas « libre » pour autant.
//   · Les en-têtes (`rename from/to`, `copy from/to`, `diff --git`) sont lus EN
//     PLUS : un renommage pur n'a pas de hunk, la livraison l'ignore, mais il
//     dit quel fichier la production voulait déplacer — la porte le juge.
//   · La comparaison ignore la casse et normalise l'Unicode (NFC) : sur un
//     poste Windows ou macOS, `SRC/Shared/Caviardage.ts` EST le fichier du
//     caviardage. Un refus de trop, jamais une livraison de trop.
//
// ─── CE QU'UN HUMAIN VALIDE, ET OÙ C'EST ÉCRIT ──────────────────────────────
//
// La validation est la revue humaine de la Miellerie (`POST
// /api/tasks/:taskId/review`, `task_reviewed` au journal) — un geste qui
// existe, qui est gardé (`decisionTache` : qui répond du projet), et que la
// boucle ne fait JAMAIS elle-même. Elle ne vaut que posée par un COMPTE
// propriétaire ou administrateur (`parUserId` au fait) : le jeton de ruche,
// avec lequel la boucle travaille, ne valide pas sa propre production. Elle ne vaut que si le journal la montre
// APRÈS la dernière production (`task_done`) : une nouvelle tentative efface
// la revue (`retryFromEvaluator`), et une approbation d'une production
// précédente ne couvre pas la suivante.
//
// Le journal est élagué par les PLUS ANCIENS (`pruneEvents`, par id). Un
// `task_done` absent alors qu'une revue est retenue dit donc que la production
// est plus ancienne que la revue — pas qu'elle manque : exiger les deux ferait
// d'une revue tardive un arrêt que rien ne lève. Une revue élaguée, elle, ne
// prouve rien : l'humain réapprouve (un nouvel événement), la porte ne suppose
// pas.
//
// L'humain valide aussi ce que la relecture croisée n'a pas relu : une
// production sans AUCUNE relecture d'une autre famille (la seconde famille
// hors ligne, une relecture impossible) n'est pas livrée d'office, même libre
// — la boucle refuse de démarrer sans deux familles parce que la relecture en
// dépend, elle ne s'en passe pas en silence au moment de livrer.
//
// Un REFUS humain (revue `rejected`) arrête la livraison de cette production,
// sensible ou non. Rien dans la boucle ne le contourne : elle n'envoie jamais
// `forcer`, n'efface jamais une revue, ne règle jamais l'autonomie.
//
// ─── ET LA PORTE ELLE-MÊME ──────────────────────────────────────────────────
//
// `src/boucle-v3/` et ses bancs sont dans la liste : une production qui
// assouplit la porte, la boucle ou leurs tests attend un humain comme toute
// autre. `orchestrator/rustine.ts` aussi : c'est par lui que la porte LIT un
// diff — l'affaiblir aveuglerait la porte sans la toucher. Et `package.json` :
// c'est lui qui dit quel fichier `npm run boucle:v3` exécute.
//
// MODULE PUR — aucune I/O. Les verdicts sont des chaînes, jamais des booléens.

import { ErreurRustine, analyserRustine, cheminsDe } from '../orchestrator/rustine.js';

export type CategorieSensible =
  | 'securite'
  | 'permissions'
  | 'secrets'
  | 'deploiement'
  | 'facturation'
  | 'auto-execution'
  | 'porte';

interface SurfaceSensible {
  categorie: CategorieSensible;
  /** Éprouvé sur le chemin normalisé (NFC, minuscules). */
  motif: RegExp;
  pourquoi: string;
}

/**
 * Les surfaces sensibles du dépôt Hive. Chaque ligne dit POURQUOI : une
 * surface sans raison écrite finit retirée par quelqu'un qui ne la comprend
 * pas — et la retirer passe elle-même par cette porte.
 */
export const SURFACES_SENSIBLES: readonly SurfaceSensible[] = [
  // ─── Sécurité : qui peut quoi, ce qui sort, ce qui isole ────────────────────
  {
    categorie: 'securite',
    motif: /^src\/orchestrator\/server\.ts$/,
    pourquoi: 'les gardes de chaque route (engagement, écriture de dépôt, décision) vivent ici',
  },
  {
    categorie: 'securite',
    motif: /^src\/orchestrator\/(comptes|auth)\.ts$/,
    pourquoi: 'comptes, rôles, mots de passe et sessions',
  },
  {
    categorie: 'securite',
    motif: /^src\/(?:.+\/)?acces[^/]*$/,
    pourquoi: 'la matrice des accès aux projets',
  },
  {
    categorie: 'securite',
    motif: /^src\/shared\/(caviardage|donnees-non-fiables|proxy-confiance)\.ts$/,
    pourquoi: 'le caviardage des secrets, le cadrage des données d’agent, la confiance au proxy',
  },
  {
    categorie: 'securite',
    motif: /^src\/shared\/git-protege\.ts$|^src\/node-client\/git-hote\.ts$/,
    pourquoi: 'la porte git protégée de l’hôte',
  },
  {
    categorie: 'securite',
    motif:
      /^src\/node-client\/(isolement|bac|validations-bac)\.ts$|^src\/shared\/validations-bac\.ts$/,
    pourquoi: 'le bac à sable des agents et les commandes qu’il lance',
  },
  {
    categorie: 'securite',
    motif: /^src\/adapters\/security\//,
    pourquoi: 'les protections des adaptateurs d’agents',
  },
  {
    categorie: 'securite',
    motif:
      /^tests\/(security-invariants|engagement-projet|suppression-projet|mission-rejouable|missions-rejouables-[^/]+|connecteurs-[^/]+|shadow-bench|banc-ombre-ruche|configuration-inerte[^/]*|join-porte|retention-journal|livraison-locale[^/]*|porte-securite[^/]*)\.test\.tsx?$/,
    pourquoi:
      'les bancs qui verrouillent les gardes (routes, effacement, rejeux, connecteurs, banc d’ombre, configuration inerte, adhésion, rétention, poussée, porte de sécurité) : les affaiblir retire le garde-fou',
  },
  {
    categorie: 'securite',
    motif: /^src\/(shared|node-client)\/porte-securite\.ts$/,
    pourquoi:
      'la porte de sécurité : les secrets et les dépendances vulnérables qu’une production AJOUTE, jugés avant la livraison et caviardés au nœud — l’affaiblir laisserait partir une clé, ou la compterait verte sans outil',
  },
  {
    categorie: 'securite',
    motif: /^src\/node-client\/join\.ts$/,
    pourquoi:
      'ce qu’un nœud accepte en rejoignant une ruche : la racine de travail refusée avant l’annonce, l’invitation lue',
  },
  {
    categorie: 'securite',
    motif: /^src\/node-client\/client\.ts$/,
    pourquoi: 'le client du nœud caviarde ici tout ce qui quitte la machine du membre',
  },
  {
    categorie: 'securite',
    motif: /^src\/shared\/protocol\.ts$/,
    pourquoi: 'la validation des messages WebSocket entre la Reine et les nœuds',
  },
  {
    categorie: 'securite',
    motif: /^src\/orchestrator\/(store|miroir)\.ts$/,
    pourquoi: 'où dorment revues humaines, comptes et jetons ; le clone git que la Reine tient',
  },
  {
    categorie: 'securite',
    motif: /^src\/node-client\/configuration-inerte\.ts$/,
    pourquoi:
      'les hooks et plugins du dépôt que Cursor et Cline exécuteraient, écartés de l’arbre avant l’agent',
  },
  {
    categorie: 'securite',
    motif: /^src\/connectors\/|^src\/orchestrator\/connecteurs\.ts$/,
    pourquoi:
      'le seul endroit où la ruche parle à l’extérieur : secrets des connecteurs, caviardage de ce qui part, approbations Slack qui rejoignent la revue humaine',
  },
  {
    categorie: 'securite',
    motif:
      /^src\/shared\/(decouverte|mdns|mdns-reseau|empreinte-ruche)\.ts$|^src\/node-client\/decouverte-noeud\.ts$|^src\/orchestrator\/decouverte-reseau\.ts$/,
    pourquoi:
      'la découverte du réseau local : ce qui est diffusé, le code d’appariement, le billet scellé, et la porte d’offre ouverte aux voisins',
  },
  {
    categorie: 'securite',
    motif: /^src\/shared\/graphe-experience\.ts$/,
    pourquoi:
      'le cloisonnement des projets dans le graphe d’expérience, et le cadrage de ce qu’il donne aux agents',
  },
  // ─── Permissions : autonomie, fusion, partage ───────────────────────────────
  {
    categorie: 'permissions',
    motif: /^src\/orchestrator\/(essaim|essaim-runner|garde-fou|livraison)\.ts$/,
    pourquoi: 'les niveaux d’autonomie, la livraison et la fusion (toujours humaine)',
  },
  {
    categorie: 'permissions',
    motif:
      /^src\/orchestrator\/(evaluator|gardiennes|ci-evidence|scheduler)\.ts$|^src\/shared\/contre-expertise\.ts$/,
    pourquoi:
      'les verdicts qui arrêtent une livraison, et le retry qui efface la revue humaine d’une production',
  },
  {
    categorie: 'permissions',
    motif:
      /^src\/shared\/lecture-tests\.ts$|^tests\/(lecture-tests|verdicts-par-test-[^/]+)\.test\.ts$|^tests\/fixtures\/sorties-de-tests\//,
    pourquoi:
      'le lecteur des sorties de test, ses bancs et les sorties réelles qu’ils rejouent : un échec qu’il lit rouge à la base n’arrête plus la livraison — l’assouplir ferait passer une régression pour un test déjà rouge',
  },
  {
    categorie: 'permissions',
    motif: /^src\/shared\/(partage|invite|projet-public)\.ts$/,
    pourquoi: 'qui voit ou rejoint la ruche',
  },
  {
    categorie: 'permissions',
    motif: /^src\/orchestrator\/missions\.ts$|^src\/shared\/mission-rejouable\.ts$/,
    pourquoi:
      'la porte des actions irréversibles d’un rejeu (livraison, fusion, poussée, connecteurs) et ce qu’elle tient pour irréversible',
  },
  {
    categorie: 'permissions',
    motif: /^src\/orchestrator\/shadow-bench\.ts$/,
    pourquoi:
      'l’admission du banc d’ombre : actions externes refusées, ombre cantonnée à un bac isolé sans identifiants',
  },
  {
    categorie: 'permissions',
    motif: /^src\/(node-client|shared)\/livraison-locale\.ts$/,
    pourquoi:
      'ce que la livraison locale pousse chez le membre — jamais en force, jamais sans son consentement (`pousseeConsentie`)',
  },
  {
    categorie: 'permissions',
    motif: /^src\/shared\/retention-journal\.ts$/,
    pourquoi:
      'ce que l’élagage du journal garde comme preuve : une revue humaine ou une livraison élaguée ne se relit plus',
  },
  {
    categorie: 'permissions',
    motif: /^src\/shared\/reglages\.ts$/,
    pourquoi:
      'les réglages risqués de l’hôte, lus une fois (Gardiennes, fédération de l’expérience entre projets)',
  },
  // ─── Secrets ────────────────────────────────────────────────────────────────
  {
    categorie: 'secrets',
    motif:
      /(?:^|\/)\.env(?:$|\.)|\.(?:pem|key|p12|pfx)$|(?:^|\/)(?:id_rsa|id_ed25519|credentials)[^/]*$/,
    pourquoi: 'un fichier de secrets',
  },
  {
    categorie: 'secrets',
    motif: /^src\/shared\/env-queen\.ts$|^src\/orchestrator\/requisition(-env)?\.ts$/,
    pourquoi: 'où la Reine range et relit les clés d’API',
  },
  {
    categorie: 'secrets',
    motif: /^src\/node-client\/identite-noeud\.ts$/,
    pourquoi: 'la clé de nœud et l’adresse de sa ruche, rangées chez le membre',
  },
  {
    categorie: 'secrets',
    motif: /^src\/orchestrator\/github\.ts$/,
    pourquoi: 'le jeton GitHub de l’hôte, et ce qu’il est autorisé à écrire',
  },
  // ─── Déploiement ────────────────────────────────────────────────────────────
  {
    categorie: 'deploiement',
    motif: /^\.github\//,
    pourquoi: 'workflows CI (exécutés avec les secrets du dépôt dès l’ouverture de la PR)',
  },
  {
    categorie: 'deploiement',
    motif: /(?:^|\/)dockerfile[^/]*$|^docker-compose[^/]*$|^docker\/|^\.dockerignore$/,
    pourquoi: 'images et composition de déploiement',
  },
  {
    categorie: 'deploiement',
    motif: /^(install|rejoindre)[^/]*\.(sh|ps1)$/,
    pourquoi: 'installateurs que les membres exécutent chez eux',
  },
  {
    categorie: 'deploiement',
    motif: /^src\/(installer[^/]*|service-reel|desinstallation)\.ts$|^src\/shared\/service\.ts$/,
    pourquoi: 'installation et services système de l’hôte',
  },
  {
    categorie: 'deploiement',
    motif: /^src\/node-client\/(tunnel|cloudflare)\.ts$/,
    pourquoi: 'comment la ruche s’expose hors du réseau local',
  },
  // ─── Facturation ────────────────────────────────────────────────────────────
  {
    categorie: 'facturation',
    motif: /^src\/orchestrator\/(abonnement|nuage|serveurs)\.ts$/,
    pourquoi: 'abonnements, pont Stripe, machines provisionnées quand quelqu’un paie',
  },
  // ─── Auto-exécution : ce qui lance du code, ou oriente les agents ───────────
  {
    categorie: 'auto-execution',
    motif: /(?:^|\/)package(-lock)?\.json$|(?:^|\/)\.npmrc$/,
    pourquoi: 'dépendances et scripts npm (dont celui qui lance cette boucle)',
  },
  {
    categorie: 'auto-execution',
    motif: /^scripts\//,
    pourquoi: 'scripts qui exécutent du code sur la machine de l’hôte',
  },
  {
    categorie: 'auto-execution',
    motif: /\.(sh|ps1|bat|cmd)$/,
    pourquoi: 'un script shell, où qu’il soit : quelqu’un finira par le lancer',
  },
  {
    categorie: 'auto-execution',
    motif: /^src\/adapters\//,
    pourquoi: 'comment chaque agent est lancé, et avec quelles permissions',
  },
  {
    categorie: 'auto-execution',
    motif:
      /^src\/node-client\/(workspace|merge-runner|pose-runner)\.ts$|^src\/(shared\/lanceur|lanceur-reel)\.ts$|^src\/orchestrator\/fabrique\.ts$/,
    pourquoi: 'ateliers, fusions, poses d’outils et lanceurs côté machine',
  },
  {
    categorie: 'auto-execution',
    motif:
      /(?:^|\/)(vitest|eslint|vite)\.config\.[^/]*$|(?:^|\/)tsconfig[^/]*\.json$|^\.(husky|githooks)\/|^\.git(attributes|modules)$/,
    pourquoi:
      'configuration exécutée par les outils (tests, lint, build, typage, hooks git) — un `tsconfig` relâché fait passer ce que le typage refusait',
  },
  {
    categorie: 'auto-execution',
    motif: /(?:^|\/)(agents|claude)\.md$|^\.(agents|claude|cursor|codex)\//,
    pourquoi: 'consignes lues par les agents des prochaines missions',
  },
  // ─── La porte elle-même ─────────────────────────────────────────────────────
  {
    categorie: 'porte',
    motif: /^src\/boucle-v3\/|^tests\/boucle-v3[^/]*$/,
    pourquoi: 'cette porte, la boucle qui l’applique, et leurs bancs',
  },
  {
    categorie: 'porte',
    motif: /^src\/orchestrator\/rustine\.ts$/,
    pourquoi:
      'le parseur par lequel la porte lit un diff, et la seule barrière de la livraison contre `..`',
  },
];

export interface ToucheSensible {
  chemin: string;
  categorie: CategorieSensible;
  pourquoi: string;
}

/**
 * Le verdict de la porte sur un diff :
 *   · `libre`     — lisible, et aucun chemin ne touche une surface sensible ;
 *   · `sensible`  — lisible, et au moins un chemin en touche une ;
 *   · `illisible` — la livraison le refuserait, ou un en-tête ne se lit pas :
 *                   personne ne peut dire ce qu'il touche.
 */
export type EtatGarde = 'libre' | 'sensible' | 'illisible';

export interface VerdictGarde {
  etat: EtatGarde;
  /** Les chemins lus (parseur de livraison + en-têtes), triés. */
  fichiers: string[];
  touches: ToucheSensible[];
  /** Pourquoi `illisible`. */
  motif?: string;
}

/** Le chemin tel que la porte le compare : NFC, minuscules. */
function normaliser(chemin: string): string {
  return chemin.normalize('NFC').toLowerCase();
}

/** Les surfaces qu'un chemin touche — toutes, pour que le rapport les nomme. */
export function surfacesDe(chemin: string): ToucheSensible[] {
  const nu = normaliser(chemin);
  return SURFACES_SENSIBLES.filter((s) => s.motif.test(nu)).map((s) => ({
    chemin,
    categorie: s.categorie,
    pourquoi: s.pourquoi,
  }));
}

/**
 * Les chemins que nomment les EN-TÊTES du diff, ou le motif qui les rend
 * illisibles. Un `diff --git a/X b/Y` se lit quand ses deux moitiés se
 * séparent sans ambiguïté ; une forme citée (`"a/caf\303\251"`) ne se lit
 * pas ici — la livraison la refuse de toute façon.
 */
function cheminsDesEntetes(diff: string): { chemins: string[] } | { illisible: string } {
  const chemins: string[] = [];
  for (const ligne of diff.split('\n')) {
    const deplacement = /^(?:rename|copy) (?:from|to) (.+)$/.exec(ligne);
    if (deplacement?.[1]) {
      chemins.push(deplacement[1]);
      continue;
    }
    if (!ligne.startsWith('diff --git ')) continue;
    const reste = ligne.slice('diff --git '.length);
    const moities = reste.split(' b/');
    if (reste.startsWith('"') || !reste.startsWith('a/') || moities.length !== 2) {
      return { illisible: `en-tête illisible : ${reste.slice(0, 120)}` };
    }
    chemins.push((moities[0] ?? '').slice(2), moities[1] ?? '');
  }
  return { chemins };
}

/** Juge un diff. Ne lève jamais : ce qu'il ne comprend pas est `illisible`. */
export function jugerDiff(diff: string): VerdictGarde {
  if (diff.trim() === '')
    return { etat: 'illisible', fichiers: [], touches: [], motif: 'diff vide' };
  let livres: string[];
  try {
    livres = cheminsDe(analyserRustine(diff));
  } catch (err) {
    if (!(err instanceof ErreurRustine)) throw err;
    return {
      etat: 'illisible',
      fichiers: [],
      touches: [],
      motif: `livraison refusée : ${err.message}`,
    };
  }
  const entetes = cheminsDesEntetes(diff);
  if ('illisible' in entetes) {
    // Illisible quand même : ce qu'on a pu lire est nommé à l'humain qui validera.
    const touches = livres.flatMap(surfacesDe);
    return { etat: 'illisible', fichiers: livres, touches, motif: entetes.illisible };
  }
  const fichiers = [...new Set([...livres, ...entetes.chemins])].sort();
  const touches = fichiers.flatMap(surfacesDe);
  return { etat: touches.length > 0 ? 'sensible' : 'libre', fichiers, touches };
}

// ─── La validation humaine, lue au journal ────────────────────────────────────

export type ValidationHumaine = 'approuvee' | 'refusee' | 'absente';

/** Ce que la porte lit d'un événement du journal. */
export interface EvenementJournal {
  id: number;
  type: string;
  payload?: unknown;
}

const chargeDe = (e: EvenementJournal): Record<string, unknown> =>
  typeof e.payload === 'object' && e.payload !== null ? (e.payload as Record<string, unknown>) : {};

/**
 * La validation humaine de la production COURANTE de `taskId`.
 *
 * `revueCourante` : `evidence.humanReview` de l'Evaluator (l'état rangé).
 * Les DEUX doivent dire oui — l'état rangé ET le fait au journal, postérieur
 * à la dernière production. Un refus, d'où qu'il vienne, est un refus.
 *
 * Une APPROBATION, elle, ne vaut que d'un COMPTE qui répond du projet : le
 * fait porte `parUserId`, que la Reine n'écrit que pour un propriétaire ou un
 * administrateur jugé sur sa propre autorité (server.ts, `compteQuiRegle`).
 * La boucle crée son projet au jeton de ruche — orphelin, donc ouvert au
 * jeton —, et ce jeton est sur chaque machine de l'essaim : une revue passée
 * au jeton (`parUserId: null`), ou un clic Slack, n'est pas la validation
 * d'un humain qui répond de la ruche.
 */
export function validationHumaine(
  taskId: string,
  evenements: readonly EvenementJournal[],
  revueCourante: string | undefined,
): ValidationHumaine {
  if (revueCourante === 'rejected') return 'refusee';
  const deLaTache = (type: string) =>
    evenements.filter((e) => e.type === type && chargeDe(e).taskId === taskId).at(-1);
  const production = deLaTache('task_done');
  const revue = deLaTache('task_reviewed');
  // Sans `task_done` retenu, la production précède tout le journal restant —
  // donc la revue (élagage par les plus anciens, cf. l'en-tête).
  if (!revue || (production && revue.id < production.id)) return 'absente';
  const { state: etat, parUserId } = chargeDe(revue);
  if (etat === 'rejected') return 'refusee';
  const parUnCompte = typeof parUserId === 'string' && parUserId !== '';
  return etat === 'approved' && revueCourante === 'approved' && parUnCompte
    ? 'approuvee'
    : 'absente';
}

/** Une relecture d'une AUTRE famille que la productrice a-t-elle été rendue ? */
export type RelectureCroisee = 'rendue' | 'absente';

export function relectureCroisee(
  relectures: readonly { relecteur: string; producteur: string }[],
): RelectureCroisee {
  return relectures.some((r) => r.relecteur !== 'inconnu' && r.relecteur !== r.producteur)
    ? 'rendue'
    : 'absente';
}

/**
 * La décision de la porte :
 *   · `refus_humain`        — un humain a refusé cette production : jamais livrée ;
 *   · `livrer`              — libre et relue par une autre famille, ou validée par un humain ;
 *   · `validation_requise`  — sensible, illisible, ou sans relecture croisée, sans
 *                             validation : la boucle s'arrête.
 */
export type PorteLivraison = 'livrer' | 'validation_requise' | 'refus_humain';

export function porteDeLivraison(
  verdict: VerdictGarde,
  validation: ValidationHumaine,
  relecture: RelectureCroisee,
): PorteLivraison {
  if (validation === 'refusee') return 'refus_humain';
  if (verdict.etat === 'libre' && relecture === 'rendue') return 'livrer';
  return validation === 'approuvee' ? 'livrer' : 'validation_requise';
}
