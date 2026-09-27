// Caviardage des secrets AVANT qu'un texte ne quitte la machine qui les porte.
//
// ─── UN SEUL JEU DE MOTIFS, DEUX FRONTIÈRES ─────────────────────────────────
//
// Les motifs de jetons vivaient dans `orchestrator/journal-ouvriere.ts`, côté
// hub : ils protégeaient le journal de l'ouvrière, c'est-à-dire un texte DÉJÀ
// arrivé à la Reine. Le nœud, lui, envoyait ses logs, son diff et le texte final
// de l'agent tels quels — et la sortie en direct de l'agent (quatre morceaux par
// seconde, `adapters/sortie-directe.ts`) aurait fait pareil. Un secret que le
// nœud a laissé partir est déjà dans la base du hub, dans le tableau de bord de
// chaque membre, dans l'historique d'un navigateur : caviarder à l'arrivée,
// c'est arriver trop tard.
//
// Ce module est donc partagé : le hub garde ses motifs (le journal de
// l'ouvrière les importe d'ici, à l'identique), et le nœud y ajoute ce que lui
// seul connaît — les VALEURS des variables d'identification qu'il transmet à
// son agent. Aucun motif ne reconnaît une clé d'API d'un fournisseur inconnu ;
// sa valeur exacte, si.

/** Ce qui remplace un secret, partout. Même libellé que le journal de l'ouvrière. */
export const SECRET_CAVIARDE = '[secret]';

/**
 * Marque posée par `adapters/sortie-directe.ts` à la place de la fin d'une
 * ligne trop longue pour un morceau de sortie en direct.
 *
 * Le caviardeur doit la connaître : une ligne coupée peut l'être AU MILIEU
 * d'une clé. Le début de la clé, seul, n'est plus égal à la valeur — la
 * comparaison exacte le laisserait passer. `caviarderTexte` masque donc aussi
 * un début de secret collé à cette marque.
 */
export const MARQUE_LIGNE_TRONQUEE = ' …[ligne tronquée]';

/**
 * Longueur minimale d'une valeur caviardée à l'identique. En dessous, une
 * « valeur secrète » (`1`, `true`, `abc`) ferait caviarder la moitié des logs
 * sans rien protéger : aucun identifiant réel n'est aussi court.
 */
const VALEUR_SECRETE_MIN = 8;

/**
 * Formats LITTÉRAUX de jetons : un préfixe réservé par l'émetteur (GitHub,
 * OpenAI/Anthropic `sk-`, xAI). Seuls motifs appliqués à un diff, parce que ce
 * sont les seuls qui ne ressemblent pas à du code ordinaire — voir `diff`.
 */
const JETONS_LITTERAUX =
  /\bgh[pousr]_[A-Za-z0-9_-]+\b|\bgithub_pat_[A-Za-z0-9_]+\b|\bsk-[A-Za-z0-9_-]+\b|\bxai-[A-Za-z0-9_-]+\b/;

/**
 * Formes d'AFFECTATION : `Bearer …`, `password=…`, `API_KEY: …`, identifiants
 * dans une URL. Justes dans une sortie d'outil, ravageuses dans un diff où
 * `token: string` et `` `https://${user}:${pass}@…` `` sont du code légitime.
 */
const AFFECTATIONS =
  /\b(?:Bearer|Basic)\s+[^\s,;]+|\b(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s,;]+|\b(?:HIVE_TOKEN|[A-Z0-9_]*(?:API_KEY|SECRET|PASSWORD|PRIVATE_KEY))\s*[=:]\s*[^\s,;]+|https?:\/\/[^\s/@]+:[^\s/@]+@[^\s,;]+/;

/**
 * Les motifs connus de la ruche, tous ensemble : ce que le journal de
 * l'ouvrière applique depuis toujours (l'union est textuellement la même).
 */
export const SECRET_DANS_TEXTE = new RegExp(
  `(?:${JETONS_LITTERAUX.source}|${AFFECTATIONS.source})`,
  'gi',
);

const SECRET_DANS_DIFF = new RegExp(`(?:${JETONS_LITTERAUX.source})`, 'gi');

/**
 * Noms de variables qui portent un identifiant : `ANTHROPIC_API_KEY`,
 * `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `CURSOR_API_KEY`… Les
 * autres variables transmises à l'agent — `HOME`, `APPDATA`, `*_BASE_URL`,
 * `GROK_HOME` — sont des chemins et des adresses : les caviarder effacerait
 * chaque chemin des logs sans rien protéger.
 */
const NOM_DE_SECRET = /KEY|TOKEN|SECRET|PASS|CREDENTIAL|AUTH/i;

/** Les valeurs des variables d'identification d'un environnement d'agent. */
export function valeursSecretes(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env).flatMap(([nom, valeur]) =>
    NOM_DE_SECRET.test(nom) && typeof valeur === 'string' ? [valeur] : [],
  );
}

export interface Caviardeur {
  /** Logs, sortie en direct, texte final : valeurs exactes + tous les motifs. */
  texte(s: string): string;
  /**
   * Un diff : valeurs exactes + formats littéraux seulement. Le diff est
   * APPLIQUÉ ensuite (Honeycomb Merge) : un motif d'affectation y réécrirait du
   * code légitime et casserait le patch. Une clé que l'agent aurait écrite dans
   * un fichier, elle, est bien remplacée — elle n'a rien à faire dans le dépôt.
   */
  diff(s: string): string;
}

/**
 * Un caviardeur pour un jeu de valeurs secrètes (celles de l'environnement de
 * l'agent, plus le jeton du nœud). Les plus longues d'abord : une valeur qui en
 * contient une autre doit disparaître entière, pas laisser ses bords.
 */
export function creerCaviardeur(valeurs: readonly string[]): Caviardeur {
  const secrets = [...new Set(valeurs)]
    .filter((v) => v.length >= VALEUR_SECRETE_MIN)
    .sort((a, b) => b.length - a.length);
  const valeursExactes = (s: string): string => {
    let sortie = s;
    for (const secret of secrets) sortie = sortie.split(secret).join(SECRET_CAVIARDE);
    return secrets.length > 0 && sortie.includes(MARQUE_LIGNE_TRONQUEE)
      ? debutsAvantMarque(sortie, secrets)
      : sortie;
  };
  return {
    texte: (s) => valeursExactes(s).replace(SECRET_DANS_TEXTE, SECRET_CAVIARDE),
    diff: (s) => valeursExactes(s).replace(SECRET_DANS_DIFF, SECRET_CAVIARDE),
  };
}

/** Masque un début de secret (≥ `VALEUR_SECRETE_MIN`) coupé net par la marque. */
function debutsAvantMarque(s: string, secrets: readonly string[]): string {
  return s
    .split(MARQUE_LIGNE_TRONQUEE)
    .map((morceau, i, tous) => {
      if (i === tous.length - 1) return morceau;
      for (const secret of secrets) {
        for (let k = secret.length - 1; k >= VALEUR_SECRETE_MIN; k--) {
          if (morceau.endsWith(secret.slice(0, k))) {
            return morceau.slice(0, morceau.length - k) + SECRET_CAVIARDE;
          }
        }
      }
      return morceau;
    })
    .join(MARQUE_LIGNE_TRONQUEE);
}
