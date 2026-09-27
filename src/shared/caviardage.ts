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

import { COUPURE_TEXTE_FINAL } from './protocol.js';

/** Ce qui remplace un secret, partout. Même libellé que le journal de l'ouvrière. */
export const SECRET_CAVIARDE = '[secret]';

/**
 * Marque posée par `adapters/sortie-directe.ts` à la place de la fin d'une
 * ligne trop longue pour un morceau de sortie en direct.
 *
 * Le caviardeur doit la connaître : une ligne coupée peut l'être AU MILIEU
 * d'une clé. Le début de la clé, seul, n'est plus égal à la valeur — la
 * comparaison exacte le laisserait passer. `Caviardeur.texte` masque donc aussi
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
 * OpenAI/Anthropic `sk-`, xAI), et la forme d'un JWT (`eyJ….….…`) — celle des
 * jetons de session que les agents rangent dans leur HOME (`~/.codex/auth.json`
 * d'une connexion ChatGPT) : un `cat` de ce fichier dans un appel d'outil
 * partirait sinon en clair vers chaque écran. Version LARGE, pour le texte :
 * insensible à la casse. Pas dans `JETONS_REELS` : un diff porte des JWT de
 * fixture légitimes.
 */
const JETONS_LITTERAUX =
  /\bgh[pousr]_[A-Za-z0-9_-]+\b|\bgithub_pat_[A-Za-z0-9_]+\b|\bsk-[A-Za-z0-9_-]+\b|\bxai-[A-Za-z0-9_-]+\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/;

/**
 * Les mêmes formats, version STRICTE, pour ce qui sera réutilisé tel quel (les
 * lignes AJOUTÉES d'un diff, le prompt d'une délégation) : sensible à la casse
 * — les préfixes réels sont `sk-`, `ghp_`, `xai-`, jamais `SK-` — et exigeant
 * au moins 20 caractères après le préfixe, comme tout jeton émis. Sans ces
 * deux bornes, la version large lit `sk-SK` (une locale), `xai-sdk` (un
 * paquet), `github.com/xai-org/…` (l'en-tête de `adapters/grok.ts`) ou
 * `'sk-test-key'` (un fixture) comme des secrets, et réécrit du code légitime.
 */
const JETONS_REELS =
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bxai-[A-Za-z0-9_-]{20,}\b/g;

/**
 * Formes d'AFFECTATION : `Bearer …`, `password=…`, `API_KEY: …`, identifiants
 * dans une URL. Justes dans une sortie d'outil, ravageuses dans un diff où
 * `token: string` et `` `https://${user}:${pass}@…` `` sont du code légitime.
 *
 * La valeur s'arrête aux guillemets et à la barre oblique inverse : les logs
 * et le texte final sont RELUS par des machines — le JSON d'une erreur
 * (`shared/texte-d-echec.ts`), le `HIVE_PROPOSITION {…}` d'une éclaireuse
 * (`orchestrator/eclaireuse.ts`). Un remplacement qui avalait le `"` fermant
 * (« par Basic auth"} ») rendait la ligne illisible : la proposition, ou le
 * veto d'un `HIVE_AVIS`, disparaissait sans un mot. La barre oblique, parce
 * que dans du JSON échappé le guillemet d'une chaîne est précédé d'un `\`.
 */
const AFFECTATIONS =
  /\b(?:Bearer|Basic)\s+[^\s,;"'\\]+|\b(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s,;"'\\]+|\b(?:HIVE_TOKEN|[A-Z0-9_]*(?:API_KEY|SECRET|PASSWORD|PRIVATE_KEY))\s*[=:]\s*[^\s,;"'\\]+|https?:\/\/[^\s/@"'\\]+:[^\s/@"'\\]+@[^\s,;"'\\]+/;

/**
 * Les motifs connus de la ruche, tous ensemble — ceux qu'applique aussi le
 * journal de l'ouvrière, côté hub.
 */
export const SECRET_DANS_TEXTE = new RegExp(
  `(?:${JETONS_LITTERAUX.source}|${AFFECTATIONS.source})`,
  'gi',
);

/**
 * Noms de variables qui portent un identifiant : `ANTHROPIC_API_KEY`,
 * `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, `CURSOR_API_KEY`… Les
 * autres variables transmises à l'agent — `HOME`, `APPDATA`, `*_BASE_URL`,
 * `GROK_HOME` — sont des chemins et des adresses : les caviarder effacerait
 * chaque chemin des logs sans rien protéger.
 *
 * Le DERNIER segment du nom décide, pas une sous-chaîne : `GIT_AUTHOR_EMAIL`
 * (AUTH…), `SSH_AUTH_SOCK`, `GIT_ASKPASS`, `PASSWORD_STORE_DIR` ne sont pas
 * des identifiants. Qu'un membre les ajoute à `HIVE_KEEP_ENV`, et leur valeur
 * — une adresse, un nom d'auteur — devenait `[secret]` jusque dans les lignes
 * AJOUTÉES du diff livré : le correctif changeait de contenu.
 */
const NOM_DE_SECRET =
  /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PAT|CREDENTIALS?|AUTH)(?:_\d+)?$/i;

/** Les valeurs des variables d'identification d'un environnement d'agent. */
export function valeursSecretes(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env).flatMap(([nom, valeur]) =>
    NOM_DE_SECRET.test(nom) && typeof valeur === 'string' ? formesDuSecret(valeur) : [],
  );
}

/**
 * Les formes sous lesquelles une valeur peut réapparaître dans une sortie :
 *   · telle quelle ;
 *   · ÉCHAPPÉE en JSON (`\n`, `\"`) — le stream-json de Claude ou de Cursor
 *     recopie un `tool_result` en chaîne JSON : une clé PEM ou un compte de
 *     service JSON transmis par `HIVE_KEEP_ENV` n'y est jamais égal à la valeur ;
 *   · ligne par ligne, pour une valeur sur plusieurs lignes — les morceaux en
 *     direct se coupent ENTRE les lignes, une clé PEM peut donc chevaucher
 *     deux morceaux (les lignes trop courtes tombent sous `VALEUR_SECRETE_MIN`).
 */
function formesDuSecret(valeur: string): string[] {
  const echappee = JSON.stringify(valeur).slice(1, -1);
  const lignes = valeur.includes('\n') ? valeur.split(/\r?\n/).map((l) => l.trim()) : [];
  return [...new Set([valeur, echappee, ...lignes])];
}

export interface Caviardeur {
  /** Logs, sortie en direct, noms, raisons : valeurs exactes + tous les motifs. */
  texte(s: string): string;
  /**
   * Le texte FINAL de l'agent : valeurs exactes, bords coupés, jetons réels —
   * pas les motifs d'affectation. Ce texte n'est pas qu'affiché : le hub le
   * relit (le `HIVE_PROPOSITION {…}` d'une éclaireuse, le `HIVE_AVIS {…}` d'un
   * conseil, le `HIVE_CRITIQUE {…}` d'un relecteur, la réponse qu'une tâche
   * parente intègre). « par Basic auth »
   * devenu « par [secret] » change ce qu'a dit l'agent, sans rien protéger :
   * une vraie clé transmise y est caviardée par sa valeur exacte.
   */
  reponse(s: string): string;
  /**
   * Du texte qui sera RÉUTILISÉ tel quel (le prompt d'une délégation, qu'un
   * autre agent exécutera) : valeurs exactes + jetons réels (`JETONS_REELS`)
   * seulement. Les motifs d'affectation y réécriraient du code ordinaire.
   */
  code(s: string): string;
  /**
   * Un diff unifié : `code` appliqué aux SEULES lignes ajoutées de ses hunks.
   *
   * Le diff est APPLIQUÉ ensuite, au contexte exact (`orchestrator/rustine.ts`,
   * `git apply` de Honeycomb Merge) : réécrire une ligne de contexte ou une
   * ligne retirée — qui existent déjà dans le dépôt cible — casserait le patch
   * pour rien, et ferait refuser une livraison légitime. Une clé que l'agent a
   * AJOUTÉE à un fichier, elle, est remplacée : elle n'a rien à faire dans le
   * dépôt, ni dans la base du hub.
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
    return sortie;
  };
  const code = (s: string): string => valeursExactes(s).replace(JETONS_REELS, SECRET_CAVIARDE);
  const bords = (s: string): string => finMasquee(bordsCoupes(valeursExactes(s), secrets), secrets);
  return {
    texte: (s) => bords(s).replace(SECRET_DANS_TEXTE, SECRET_CAVIARDE),
    reponse: (s) => bords(s).replace(JETONS_REELS, SECRET_CAVIARDE),
    code,
    diff: (s) => lignesAjoutees(s, code),
  };
}

/**
 * Les bords qu'une coupe a pu laisser d'un secret — ils ne sont plus égaux à
 * la valeur, la comparaison exacte les laisserait passer :
 *   · avant la marque de ligne tronquée de la sortie en direct, un DÉBUT de clé
 *     (≥ `VALEUR_SECRETE_MIN`), ou des identifiants d'URL coupés avant leur
 *     `@` (`https://moi:motdep…`) — le motif d'URL exige le `@` ;
 *   · de part et d'autre de `COUPURE_TEXTE_FINAL` (`borneTexteFinal`, que les
 *     adaptateurs appliquent AVANT que le nœud ne voie la réponse) : un début
 *     de clé avant, une FIN de clé après ;
 *   · une fin de clé en tête du texte : la fenêtre de stdout que garde
 *     `adapters/exec.ts` commence où elle peut.
 */
function bordsCoupes(s: string, secrets: readonly string[]): string {
  const avantMarque = s
    .split(MARQUE_LIGNE_TRONQUEE)
    .map((morceau, i, tous) => (i === tous.length - 1 ? morceau : debutMasque(morceau, secrets)))
    .join(MARQUE_LIGNE_TRONQUEE);
  return avantMarque
    .split(COUPURE_TEXTE_FINAL)
    .map((morceau, i, tous) => {
      const apres = i === 0 ? morceau : finMasquee(morceau, secrets);
      return i === tous.length - 1 ? apres : debutMasque(apres, secrets);
    })
    .join(COUPURE_TEXTE_FINAL);
}

const IDENTIFIANTS_D_URL_COUPES = /(https?:\/\/)[^\s/@]+:[^\s/@]*(\s*)$/;

/** Masque un début de secret, ou des identifiants d'URL, laissés en FIN de `morceau`. */
function debutMasque(morceau: string, secrets: readonly string[]): string {
  const corps = morceau.trimEnd();
  const blancs = morceau.slice(corps.length);
  for (const secret of secrets) {
    for (let k = secret.length - 1; k >= VALEUR_SECRETE_MIN; k--) {
      if (corps.endsWith(secret.slice(0, k))) {
        return corps.slice(0, corps.length - k) + SECRET_CAVIARDE + blancs;
      }
    }
  }
  return morceau.replace(IDENTIFIANTS_D_URL_COUPES, `$1${SECRET_CAVIARDE}$2`);
}

/** Masque une fin de secret laissée en TÊTE de `morceau`. */
function finMasquee(morceau: string, secrets: readonly string[]): string {
  const corps = morceau.trimStart();
  const blancs = morceau.slice(0, morceau.length - corps.length);
  for (const secret of secrets) {
    for (let k = secret.length - 1; k >= VALEUR_SECRETE_MIN; k--) {
      if (corps.startsWith(secret.slice(-k))) {
        return blancs + SECRET_CAVIARDE + corps.slice(k);
      }
    }
  }
  return morceau;
}

const EN_TETE_DE_HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

/**
 * Applique `f` aux lignes AJOUTÉES des hunks d'un diff unifié, et à rien
 * d'autre. Les hunks sont suivis par leurs COMPTES (`@@ -a,n +b,m @@`), pas
 * par le premier caractère : dans un hunk, `--- x` est une ligne retirée
 * (« -- x ») et `+++ y` une ligne ajoutée (« ++ y ») ; hors hunk, ce sont les
 * en-têtes de fichier, qu'il ne faut pas toucher.
 */
function lignesAjoutees(diff: string, f: (ligne: string) => string): string {
  let ancien = 0;
  let nouveau = 0;
  return diff
    .split('\n')
    .map((ligne) => {
      if (ancien <= 0 && nouveau <= 0) {
        const hunk = EN_TETE_DE_HUNK.exec(ligne);
        if (hunk) {
          ancien = hunk[1] === undefined ? 1 : Number(hunk[1]);
          nouveau = hunk[2] === undefined ? 1 : Number(hunk[2]);
        }
        return ligne;
      }
      const tete = ligne[0];
      if (tete === '+') {
        nouveau--;
        return '+' + f(ligne.slice(1));
      }
      if (tete === '-') ancien--;
      else if (tete === ' ' || ligne === '') {
        ancien--;
        nouveau--;
      }
      // `\ No newline at end of file` : ne compte pour aucun côté.
      return ligne;
    })
    .join('\n');
}
