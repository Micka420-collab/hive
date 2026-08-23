// LE DÉBALLAGE — ce qu'une archive a le droit de contenir.
//
// ═══ POURQUOI CE MODULE EXISTE, ALORS QUE LE TRANSPORT GARDE DÉJÀ ══════════
//
// `butinage-transport.ts` garantit que le FICHIER REÇU a un nom que le serveur
// n'a pas choisi. Il ne dit rien de ce que ce fichier CONTIENT.
//
// Or une archive porte ses propres chemins, et ils viennent du même inconnu.
// Une entrée nommée `../../.ssh/authorized_keys` sort de la quarantaine à
// l'extraction — la garde du nom protège le contenant, jamais le contenu.
// C'est le *tar slip* / *zip slip*, et il a touché à peu près tous les
// écosystèmes qui déballent des paquets.
//
// ═══ LES SEPT REFUS, ET CE QUE CHACUN COÛTERAIT ════════════════════════════
//
// 1. LA REMONTÉE (`..`). Le cas d'école. Vérifié sur le chemin NORMALISÉ, pas
//    sur la chaîne brute : `a/b/../../../etc` ne contient aucun `../` en tête
//    et sort pourtant de trois niveaux.
//
// 2. LE CHEMIN ABSOLU. `/etc/cron.d/x`, `C:\Windows\…`, `\\serveur\partage`.
//    Un `path.join(quarantaine, entree)` NE PROTÈGE PAS de la troisième forme
//    sous Windows, et la deuxième traverse `join` sous Linux en gardant sa
//    lettre de lecteur — d'où un refus explicite plutôt qu'une confiance dans
//    la bibliothèque de chemins.
//
// 3. LES LIENS, symboliques ou physiques. REFUSÉS EN BLOC, jamais « vérifiés ».
//    Contrôler la cible d'un lien puis extraire est une course : entre les
//    deux, une autre entrée de la même archive peut avoir changé ce que la
//    cible désigne. C'est le contournement classique de ce genre de garde —
//    `a` est un lien vers `/etc`, puis `a/passwd` est un fichier ordinaire, et
//    l'écriture part dans `/etc/passwd` en n'ayant traversé que des chemins
//    qui semblaient sages. Un lien ne se juge pas, il se refuse.
//
// 4. LES FICHIERS SPÉCIAUX (périphérique, fifo, socket). Rien de légitime dans
//    un paquet de code, et un fifo suffit à figer le processus qui l'ouvre.
//
// 5. LES NOMS QUE LE SYSTÈME DE FICHIERS RÉÉCRIT. Octet nul, caractères de
//    contrôle, noms réservés de Windows (`CON`, `NUL`, `COM1`…), point ou
//    espace final que Windows retire en silence. Un nom qui ne veut pas dire
//    la même chose à la vérification et à l'écriture rend toute vérification
//    caduque.
//
// 6. LES COLLISIONS. Deux entrées qui désignent le même chemin une fois
//    normalisées — ou qui ne diffèrent que par la casse, ce qui est LA MÊME
//    entrée sous macOS et Windows. La seconde écrase la première : on vérifie
//    un contenu et on en installe un autre.
//
// 7. LE NOMBRE ET LA TAILLE. Une archive de quelques kilo-octets peut décrire
//    des millions d'entrées ou des téraoctets décompressés. Le plafond du
//    transport porte sur l'archive REÇUE, pas sur ce qu'elle promet de rendre.
//
// ═══ CE QUE CE MODULE NE PROMET PAS ════════════════════════════════════════
//
// Il juge des MÉTADONNÉES d'entrées, telles qu'un lecteur d'archive les rend.
// Il ne garantit pas que l'extracteur qui suit respectera son verdict — c'est
// à l'appelant de n'extraire que ce qui est accepté, entrée par entrée. Et il
// ne dit rien du contenu des fichiers : `nectar-suspect.ts` s'en charge, et ne
// promet pas davantage que « aucune forme connue n'a été vue ».

/** Au-delà, on refuse l'archive entière sans en extraire une seule entrée. */
export const ENTREES_MAX = 20_000;

/** Total décompressé annoncé par l'archive, tous fichiers confondus. */
export const DEBALLE_OCTETS_MAX = 200 * 1024 * 1024;

export type SorteEntree = 'fichier' | 'dossier' | 'lien' | 'special';

export interface EntreeArchive {
  /** Le chemin tel que l'archive le porte — jamais nettoyé en amont. */
  readonly chemin: string;
  readonly sorte: SorteEntree;
  /** Taille décompressée annoncée. */
  readonly octets: number;
}

export type MotifRefusEntree =
  | 'remontee'
  | 'chemin_absolu'
  | 'lien'
  | 'fichier_special'
  | 'nom_reecrit'
  | 'collision'
  | 'chemin_vide';

export interface EntreeRefusee {
  readonly chemin: string;
  readonly motif: MotifRefusEntree;
  /** Ce que ça coûte si c'est hostile — pas ce que la règle a reconnu. */
  readonly pourquoi: string;
}

export type MotifRefusArchive = 'trop_d_entrees' | 'trop_gros_deballe';

export type VerdictDeballage =
  | { readonly ok: true; readonly retenues: readonly EntreeArchive[] }
  | {
      readonly ok: false;
      readonly motif: MotifRefusArchive | 'entrees_refusees';
      readonly detail: string;
      readonly refusees: readonly EntreeRefusee[];
    };

/** Noms que Windows réserve, avec ou sans extension. */
const RE_NOM_RESERVE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Octet nul et caractères de contrôle : un nom qui ne survit pas à l'écriture. */
// eslint-disable-next-line no-control-regex
const RE_CARACTERE_INTERDIT = /[\u0000-\u001f\u007f]/;

/**
 * Le chemin, réduit à sa forme canonique — SANS toucher au disque.
 *
 * Séparateurs unifiés, segments vides et `.` retirés, `..` appliqué. On ne
 * passe pas par `path.normalize` : son résultat dépend du système qui exécute,
 * et une garde de sécurité qui juge différemment sous Windows et sous Linux est
 * une garde qu'on ne peut pas raisonner. Ici, le verdict est le même partout.
 *
 * Rend `null` si la normalisation SORT de la racine — c'est-à-dire si un `..`
 * n'a plus de segment à consommer.
 */
export function normaliserChemin(brut: string): string | null {
  const segments = brut.replace(/\\/g, '/').split('/');
  const pile: string[] = [];
  for (const s of segments) {
    if (s === '' || s === '.') continue;
    if (s === '..') {
      // La remontée qui n'a plus rien à remonter est la sortie de la racine.
      // La détecter ICI, et pas en cherchant « .. » dans la chaîne, est ce qui
      // attrape `a/b/../../../etc` — qui ne commence pas par `../`.
      if (pile.length === 0) return null;
      pile.pop();
      continue;
    }
    pile.push(s);
  }
  return pile.join('/');
}

/** Ce chemin désigne-t-il une racine, un lecteur, ou un partage réseau ? */
export function estAbsolu(brut: string): boolean {
  const t = brut.replace(/\\/g, '/');
  // `//serveur/partage` : sous Windows, `path.join` LE GARDE tel quel.
  if (t.startsWith('//')) return true;
  if (t.startsWith('/')) return true;
  // `C:` avec ou sans séparateur — et `C:sansbarre` est un chemin relatif AU
  // RÉPERTOIRE COURANT DU LECTEUR C, ce qui n'est pas la quarantaine.
  return /^[a-z]:/i.test(t);
}

function refus(chemin: string, motif: MotifRefusEntree, pourquoi: string): EntreeRefusee {
  return { chemin, motif, pourquoi };
}

/**
 * Juge les entrées d'une archive AVANT d'en extraire une seule.
 *
 * Tout ou rien : une seule entrée refusée refuse l'archive. Extraire « les
 * bonnes » d'un paquet qui en contient une hostile reviendrait à installer à
 * moitié quelque chose dont on vient d'établir qu'on ne lui fait pas confiance.
 */
export function jugerEntrees(
  entrees: readonly EntreeArchive[],
  bornes: { entreesMax?: number; octetsMax?: number } = {},
): VerdictDeballage {
  const entreesMax = bornes.entreesMax ?? ENTREES_MAX;
  const octetsMax = bornes.octetsMax ?? DEBALLE_OCTETS_MAX;

  if (entrees.length > entreesMax) {
    return {
      ok: false,
      motif: 'trop_d_entrees',
      detail: `${entrees.length} entrées annoncées, plafond ${entreesMax}. Quelques kilo-octets d'archive peuvent en décrire des millions.`,
      refusees: [],
    };
  }

  let total = 0;
  const refusees: EntreeRefusee[] = [];
  const retenues: EntreeArchive[] = [];
  // Comparaison en minuscules : sous macOS et Windows, `README` et `readme`
  // sont LA MÊME entrée, et la seconde écraserait la première après contrôle.
  const vues = new Set<string>();

  for (const e of entrees) {
    if (e.sorte === 'lien') {
      refusees.push(
        refus(
          e.chemin,
          'lien',
          'Un lien est refusé, jamais vérifié : contrôler sa cible puis extraire est une ' +
            'course, et une entrée suivante peut changer ce que la cible désigne.',
        ),
      );
      continue;
    }
    if (e.sorte === 'special') {
      refusees.push(
        refus(
          e.chemin,
          'fichier_special',
          'Périphérique, fifo ou socket : rien de légitime dans un paquet de code, et un ' +
            'fifo suffit à figer le processus qui l’ouvre.',
        ),
      );
      continue;
    }
    if (RE_CARACTERE_INTERDIT.test(e.chemin)) {
      refusees.push(
        refus(
          e.chemin,
          'nom_reecrit',
          'Octet nul ou caractère de contrôle : le nom vérifié et le nom écrit ne seraient ' +
            'pas le même, ce qui rend toute vérification caduque.',
        ),
      );
      continue;
    }
    if (estAbsolu(e.chemin)) {
      refusees.push(
        refus(
          e.chemin,
          'chemin_absolu',
          'Racine, lettre de lecteur ou partage réseau : la jonction avec la quarantaine ' +
            'ne protège d’aucune des trois.',
        ),
      );
      continue;
    }

    const normal = normaliserChemin(e.chemin);
    if (normal === null) {
      refusees.push(
        refus(
          e.chemin,
          'remontee',
          'Le chemin sort de la quarantaine une fois normalisé — c’est le tar slip, et il ' +
            'ne se voit pas en cherchant « ../ » en tête.',
        ),
      );
      continue;
    }
    if (normal === '') {
      refusees.push(
        refus(e.chemin, 'chemin_vide', 'Une entrée sans nom ne désigne rien qu’on puisse écrire.'),
      );
      continue;
    }

    const segments = normal.split('/');
    if (segments.some((s) => RE_NOM_RESERVE.test(s) || /[. ]$/.test(s))) {
      refusees.push(
        refus(
          e.chemin,
          'nom_reecrit',
          'Nom réservé de Windows, ou point/espace final que Windows retire en silence : ' +
            'le chemin écrit ne serait pas celui qu’on a jugé.',
        ),
      );
      continue;
    }

    const cle = normal.toLowerCase();
    if (vues.has(cle)) {
      refusees.push(
        refus(
          e.chemin,
          'collision',
          'Deux entrées désignent le même fichier (la casse ne compte pas sous macOS ni ' +
            'Windows) : la seconde écrase la première, donc on vérifie un contenu et on en ' +
            'installe un autre.',
        ),
      );
      continue;
    }
    vues.add(cle);

    if (e.sorte === 'fichier') total += Math.max(0, e.octets);
    retenues.push({ chemin: normal, sorte: e.sorte, octets: e.octets });
  }

  if (refusees.length > 0) {
    return {
      ok: false,
      motif: 'entrees_refusees',
      detail: `${refusees.length} entrée(s) refusée(s) : l’archive entière est écartée. Extraire « les bonnes » reviendrait à installer à moitié un paquet auquel on ne fait pas confiance.`,
      refusees,
    };
  }
  if (total > octetsMax) {
    return {
      ok: false,
      motif: 'trop_gros_deballe',
      detail: `${total} octets une fois déballés, plafond ${octetsMax}. Le plafond du transport porte sur l’archive REÇUE, pas sur ce qu’elle promet de rendre.`,
      refusees: [],
    };
  }
  return { ok: true, retenues };
}
