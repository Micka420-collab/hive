// Ce qui manque pour qu'une IA travaille — et si la ruche peut le poser seule.
//
// ─── POURQUOI ─────────────────────────────────────────────────────────────────
//
// L'utilisateur : « mets un bouton pour connecter automatiquement Claude ou
// autre s'ils ne sont pas trouvés par la ruche », puis « le secret pour se
// connecter automatiquement, le secret qu'il y a dans .env ».
//
// Les deux phrases nomment ensemble le vrai défaut. La détection actuelle
// cherche un BINAIRE (`detectBestAgent`) ; l'authentification, elle, cherche
// une CLÉ (`requisitionSiCredentialsManquantes`). Personne ne croisait les
// deux. Résultat : un poste qui porte `ANTHROPIC_API_KEY` dans son `.env` mais
// pas la ligne de commande installée est traité comme un poste SANS agent —
// le nœud meurt (`main.ts`, `process.exit(2)`), la ruche voit « 0 nœud actif »,
// et l'humain n'a aucun moyen de savoir qu'il ne lui manquait qu'un `npm i`.
//
// Or c'est précisément le cas que la ruche peut réparer TOUTE SEULE : la clé
// est là, il ne manque qu'un paquet public. Les autres cas ne se réparent pas
// tout seuls, et ce module le dit plutôt que de le promettre.
//
// ─── LE SECRET NE SORT JAMAIS ────────────────────────────────────────────────
//
// Ce module lit l'environnement pour savoir si une clé EXISTE. Il ne rend
// jamais sa valeur, ne la journalise pas, et rien de ce qu'il produit ne peut
// la contenir : les champs rendus sont des booléens, des noms de variables et
// des commandes SANS argument secret. C'est la même règle que
// `SECRETS_JAMAIS_SONDES` applique à la sonde d'agent.
//
// MODULE PUR — aucune I/O, aucune exécution. Il JUGE ; le nœud agit.

/** Ce qu'il manque, et ce que ça implique. */
import { OUTILS } from './catalogue-outils.js';

export type VerdictConnexion =
  /** Binaire présent ET clé (ou session) présente : rien à faire. */
  | 'pret'
  /** La clé est là, le binaire non — LE seul cas que la ruche pose seule. */
  | 'binaire_manquant'
  /** Le binaire est là, la clé non : il faut un humain (ou la Chambre). */
  | 'cle_manquante'
  /** Ni l'un ni l'autre : installer PUIS authentifier. */
  | 'rien'
  /**
   * La ruche ne sait pas où cet agent range ses identifiants.
   *
   * Ce n'est PAS un synonyme de « absente ». Cline lit sa propre configuration
   * de fournisseur, et Hive n'a aucun moyen documenté de la lire. Dire « clé
   * absente » serait aussi faux que dire « clé présente » — ce quatrième état
   * existe pour ne pas avoir à choisir entre deux mensonges.
   */
  | 'cle_inconnue';

/** Ce que la ruche a pu CONSTATER des identifiants — jamais leur valeur. */
export type EtatCle = 'presente' | 'absente' | 'inconnue';

export interface EtatAgent {
  readonly agent: string;
  readonly binaire: boolean;
  readonly cle: EtatCle;
  readonly verdict: VerdictConnexion;
  /**
   * La commande d'installation, en ARGUMENTS SÉPARÉS — jamais une ligne de
   * shell. `null` quand la ruche n'a rien à installer pour cet agent.
   */
  readonly installation: readonly string[] | null;
  /** Vrai seulement si un geste automatique suffit. */
  readonly poseAutomatique: boolean;
}

/**
 * Le paquet public qui installe la ligne de commande d'un agent.
 *
 * Table FERMÉE, et c'est délibéré : la ruche n'installe que ce qu'elle sait
 * nommer. Un agent inconnu ne se voit pas proposer un `npm i` deviné — ce
 * serait exécuter un nom venu d'ailleurs.
 */
/**
 * Comment installer chaque agent — DÉRIVÉ du catalogue, jamais recopié.
 *
 * ─── POURQUOI CETTE LISTE N'EST PLUS ÉCRITE ICI ─────────────────────────────
 *
 * Elle l'était, et elle avait déjà dérivé : le catalogue savait installer Cline
 * (`npm install -g cline`), cette liste-ci l'ignorait. Deux tables qui
 * répondent à la MÊME question — « comment on l'installe » — finissent
 * toujours par ne plus répondre pareil, et c'est celle qu'on ne relit pas qui
 * ment.
 *
 * À ne pas confondre avec `PAQUETS_AGENTS` (agent-windows.ts), qui répond à une
 * question DIFFÉRENTE : où retrouver un agent DÉJÀ installé quand son shim
 * n'est pas lançable sous Windows. Les fusionner serait l'erreur inverse ; le
 * banc qui garde leur nom npm commun reste en place.
 *
 * `installation: null` dans le catalogue veut dire « la ruche refuse de deviner
 * un nom de paquet » — ces agents n'apparaissent donc pas ici, et c'est voulu.
 */
export const PAQUETS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    OUTILS.filter((o) => o.installation !== null).map((o) => [o.id, o.installation!]),
  ),
);

export function juger(opts: { agent: string; binaire: boolean; cle: EtatCle }): EtatAgent {
  const installation = PAQUETS[opts.agent] ?? null;
  // L'inconnu ne se replie sur AUCUN des trois autres : il les précède. Le
  // replier sur « absente » ferait promettre une installation qui ne servirait
  // à rien ; sur « présente », une orchestration qui échouerait à la première
  // tâche.
  const verdict: VerdictConnexion =
    opts.cle === 'inconnue'
      ? 'cle_inconnue'
      : opts.binaire
        ? opts.cle === 'presente'
          ? 'pret'
          : 'cle_manquante'
        : opts.cle === 'presente'
          ? 'binaire_manquant'
          : 'rien';
  return {
    agent: opts.agent,
    binaire: opts.binaire,
    cle: opts.cle,
    verdict,
    installation,
    // Deux conditions, et les DEUX comptent : il faut que le seul manque soit
    // le binaire, ET que la ruche sache quel paquet l'installe.
    poseAutomatique: verdict === 'binaire_manquant' && installation !== null,
  };
}

/** Ce qu'on affiche à l'humain, sans jamais promettre plus qu'on ne peut. */
export function direVerdict(e: EtatAgent, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<VerdictConnexion, string> = {
    cle_inconnue: e.binaire
      ? 'Installée. La ruche ne sait pas lire ses identifiants — lancez-la une fois pour vérifier.'
      : 'Absente de ce poste, et la ruche ne sait pas lire ses identifiants.',
    pret: 'Prête à travailler.',
    binaire_manquant: e.poseAutomatique
      ? 'La clé est là, la ligne de commande non — la ruche peut l’installer.'
      : 'La clé est là, la ligne de commande non — installation à faire à la main.',
    cle_manquante: 'La ligne de commande est là, la clé non — accordez-la depuis la Chambre.',
    rien: 'Ni ligne de commande ni clé sur ce poste.',
  };
  const en: Record<VerdictConnexion, string> = {
    cle_inconnue: e.binaire
      ? 'Installed. The hive cannot read its credentials — run it once to check.'
      : 'Not on this machine, and the hive cannot read its credentials.',
    pret: 'Ready to work.',
    binaire_manquant: e.poseAutomatique
      ? 'The key is here, the CLI is not — the hive can install it.'
      : 'The key is here, the CLI is not — install it by hand.',
    cle_manquante: 'The CLI is here, the key is not — grant one from the Chamber.',
    rien: 'Neither CLI nor key on this machine.',
  };
  return (lang === 'en' ? en : fr)[e.verdict];
}
