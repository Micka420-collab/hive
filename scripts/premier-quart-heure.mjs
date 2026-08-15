// LE PREMIER QUART D'HEURE — ce qu'un arrivant fait juste après l'installation.
//
// ─── LE TROU QUE CE MODULE COMBLE ────────────────────────────────────────────
//
// Les trois jambes de seuil mènent l'installation jusqu'à `/api/pulse` qui
// répond. C'est beaucoup — et ce n'est pas le parcours. Ce que fait vraiment
// quelqu'un qui vient d'installer Hive, c'est :
//
//     j'installe  →  j'OUVRE LE TABLEAU  →  je CRÉE MON PREMIER PROJET
//
// Les deux derniers pas n'étaient mesurés NULLE PART. Le point de sortie du
// 15 août les classe en 3c : « des morceaux sont éprouvés, le PARCOURS ne l'est
// pas. Tant qu'il ne l'est pas, je ne peux pas dire qu'il marche. »
//
// ─── POURQUOI « /api/pulse RÉPOND » NE SUFFIT PAS ────────────────────────────
//
// L'orchestrateur et l'écran sont deux choses. `/api/pulse` prouve la première.
// Un arrivant, lui, tape l'adresse dans son navigateur et attend le tableau —
// et il y a QUATRE façons d'y arriver, dont trois sont des pannes muettes :
//
//   · `repli`     — la page « l'écran n'est pas construit ». Honnête, mais
//                   l'installation était censée le construire (1,9 s dans
//                   `install.sh`). Si elle échoue en silence, l'arrivant lit un
//                   mode d'emploi au lieu d'utiliser le produit.
//   · `source`    — le GABARIT de développement servi tel quel. Il pointe vers
//                   `/src/main.tsx`, un fichier que seul Vite sait transformer.
//                   En production : écran blanc, aucun message, aucune erreur
//                   visible. C'est le pire des quatre, parce qu'il ressemble à
//                   une page qui charge.
//   · `coquille`  — un `<div id="root">` sans script pour le remplir. Écran
//                   blanc là encore, cette fois parce que la construction a
//                   rendu une page vide.
//   · `construit` — une page qui CHARGE UN PAQUET. Le seul cas où l'arrivant
//                   voit quelque chose.
//
// Les trois premiers rendent tous HTTP 200. Un essai qui se contente du code de
// statut les déclare identiques — et c'est exactement l'erreur qu'on refait
// quand on mesure la porte au lieu de mesurer ce qu'il y a derrière.

/**
 * Ce que sert vraiment la racine de la ruche.
 *
 * @param {string} html le corps de la réponse à `GET /`
 * @returns {'construit'|'repli'|'source'|'coquille'|'inconnu'}
 */
export function verdictEcran(html) {
  const page = String(html ?? '');

  // Le repli se reconnaît à la commande qu'il donne à copier. On ne cherche pas
  // son titre : un titre se retraduit, une commande ne se retraduit pas sans
  // cesser de marcher.
  if (page.includes('build:dashboard')) return 'repli';

  const racine = /id=["']root["']/.test(page);
  const scripts = [...page.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map((m) => m[1]);

  // Un gabarit de développement pointe vers les SOURCES. Servi en production,
  // il ne charge rien : le navigateur demande un `.tsx` que personne ne compile.
  if (scripts.some((s) => /\.(tsx|jsx|ts)(\?|$)/.test(s) || s.startsWith('/src/'))) return 'source';

  if (scripts.length > 0 && racine) return 'construit';
  if (racine) return 'coquille';
  return 'inconnu';
}

/**
 * Ce qu'on dit à l'arrivant — et à celui qui lit le journal de la CI — pour
 * chacun des verdicts. Un essai qui échoue en disant « ce n'est pas ça » oblige
 * à rouvrir le code ; celui-ci nomme la panne ET son remède.
 */
export const RAISON_ECRAN = {
  construit: 'le tableau est construit et se charge',
  repli: 'la ruche sert la page « l’écran n’est pas construit » — la construction a été sautée',
  source: 'la ruche sert le GABARIT de développement (il pointe vers /src) — écran blanc sans Vite',
  coquille: 'la page n’a pas de script : un tableau vide qui ne se remplira jamais',
  inconnu: 'la racine ne ressemble ni au tableau ni à son repli',
};

/**
 * Le `.env` que l'installeur vient d'écrire, lu comme un dictionnaire.
 *
 * ─── POURQUOI ON LE LIT PLUTÔT QUE DE LE SUPPOSER ──────────────────────────
 *
 * Le port et le jeton sont ENGENDRÉS à l'installation. Les supposer ferait
 * porter l'essai sur une ruche qu'on n'a pas installée — et il passerait au
 * vert le jour où l'installeur cesserait de les écrire.
 *
 * Les valeurs ne sont jamais déguillemetées : `install.sh` n'en pose pas, et
 * en retirer qui n'existent pas mutilerait un jeton qui commencerait par une
 * apostrophe.
 */
export function lireEnv(texte) {
  const vu = {};
  for (const ligne of String(texte ?? '').split('\n')) {
    const nu = ligne.trim();
    if (nu === '' || nu.startsWith('#')) continue;
    const coupe = nu.indexOf('=');
    if (coupe <= 0) continue;
    vu[nu.slice(0, coupe)] = nu.slice(coupe + 1);
  }
  return vu;
}

/**
 * Le projet qu'on vient de créer est-il dans l'instantané que LIT LE TABLEAU ?
 *
 * ─── POURQUOI L'INSTANTANÉ, ET PAS L'ÉCHO DE LA CRÉATION ───────────────────
 *
 * `POST /api/projects` rend le projet créé. S'en contenter mesurerait que la
 * route répond, pas que le projet EXISTE : une création qui n'atteindrait pas
 * le magasin rendrait exactement le même corps.
 *
 * Le tableau, lui, lit `GET /api/state`. C'est donc là qu'il faut le retrouver
 * — c'est la seule vérification qui ait le point de vue de l'arrivant.
 */
export function projetDansInstantane(instantane, id) {
  const projets = instantane?.projects;
  if (!Array.isArray(projets)) return false;
  return projets.some((p) => p?.id === id);
}
