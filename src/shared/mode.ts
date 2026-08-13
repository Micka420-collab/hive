// Basculer de mode — ce que la ruche s'autorise à faire toute seule.
//
// ─── LE MANQUE QUE CE MODULE COMBLE ──────────────────────────────────────────
//
// L'échelle d'autonomie existe depuis le Plein Essaim (`essaim.ts`, `NIVEAUX`)
// et la route `POST /api/projects/:id/essaim` sait la changer. Mais rien, en
// ligne de commande, ne permettait de la LIRE ni de la POSER : il fallait
// fabriquer un `curl` à la main, ou passer par le tableau de bord.
//
// Un réglage qui gouverne ce qu'une IA fait sans demander doit se changer en
// une commande, se lire en une commande, et dire ce qu'il implique AVANT qu'on
// le pose. C'est exactement l'ergonomie d'un terminal d'agent : on bascule
// entre « propose-moi un plan » et « vas-y » sans quitter le clavier.
//
// ─── PUR ─────────────────────────────────────────────────────────────────────
//
// Aucune I/O, aucun réseau : ce module DIT ce que chaque mode veut dire, ce
// qu'une demande implique, et ce qu'il faut refuser. La moitié qui appelle la
// route vit dans `src/cli.ts`.

/**
 * L'échelle, du plus prudent au plus autonome.
 *
 * Les identifiants sont ceux d'`essaim.ts` — on ne renomme pas un réglage
 * persisté pour le confort d'un affichage. Ce module ajoute les mots, pas un
 * second vocabulaire.
 */
export const MODES = ['off', 'propose', 'gouverne', 'plein'] as const;
export type Mode = (typeof MODES)[number];

export interface Palier {
  readonly mode: Mode;
  /** Le nom court, celui qu'on lit dans une liste. */
  readonly nom: string;
  /** Ce que la ruche fait à ce niveau, en une phrase. */
  readonly fait: string;
  /** Ce qu'elle ne fait toujours PAS — la moitié qu'on oublie d'annoncer. */
  readonly neFaitPas: string;
  /** Vrai quand basculer ici élargit ce que la ruche peut faire sans demander. */
  readonly elargit: boolean;
}

export const PALIERS: readonly Palier[] = [
  {
    mode: 'off',
    nom: 'arrêt',
    fait: 'rien de lui-même — vous lancez chaque chose.',
    neFaitPas: 'aucun cycle, aucune tâche créée, aucune écriture.',
    elargit: false,
  },
  {
    mode: 'propose',
    nom: 'propose',
    fait: 'réfléchit, découpe, et vous PROPOSE un plan.',
    neFaitPas: 'n’exécute rien. Le plan attend votre geste.',
    elargit: true,
  },
  {
    mode: 'gouverne',
    nom: 'gouverne',
    fait: 'travaille seule : elle planifie, code, teste et se corrige.',
    neFaitPas: 'ne fusionne JAMAIS. Toute intégration passe par une revue humaine.',
    elargit: true,
  },
  {
    mode: 'plein',
    nom: 'plein essaim',
    fait: 'va jusqu’à la fusion sur les dépôts explicitement inscrits.',
    neFaitPas:
      'ne contourne pas les protections de branche du propriétaire — elles restent la dernière barrière.',
    elargit: true,
  },
];

export function palierDe(mode: Mode): Palier {
  // `MODES` et `PALIERS` sont tenus alignés par un test : si l'un gagne une
  // entrée sans l'autre, la suite rougit plutôt que de laisser une recherche
  // rendre `undefined` au premier appel venu.
  return PALIERS.find((p) => p.mode === mode) as Palier;
}

export function estMode(v: string): v is Mode {
  return (MODES as readonly string[]).includes(v);
}

/** Le rang d'un mode sur l'échelle. Sert à savoir si un changement ÉLARGIT. */
export function rang(mode: Mode): number {
  return MODES.indexOf(mode);
}

export interface Refus {
  readonly genre: 'refus';
  readonly motif: string;
}

export interface Bascule {
  readonly genre: 'bascule';
  readonly de: Mode;
  readonly vers: Mode;
  /**
   * Vrai quand on MONTE l'échelle : la ruche pourra faire davantage sans
   * demander. C'est le seul sens qui mérite une confirmation — redescendre
   * retire des droits, et retirer des droits ne se confirme pas.
   */
  readonly elargit: boolean;
  /** Posé quand la bascule exige un accord explicite. */
  readonly confirmation?: string;
}

/** Ce qu'exige la bascule vers `plein`, en plus du mode lui-même. */
export const MENTION_PLEIN =
  'Le niveau seul ne suffit pas : la fusion autonome demande AUSSI que le dépôt ' +
  'soit inscrit, à la main, projet par projet. Deux interrupteurs en série, et ' +
  'c’est voulu — personne ne déclenche une fusion en tapant un seul mot.';

/**
 * Décide d'une bascule.
 *
 * ─── POURQUOI SEULE LA MONTÉE SE CONFIRME ────────────────────────────────────
 *
 * Descendre l'échelle RETIRE des droits à la ruche. C'est toujours sûr, et
 * demander « êtes-vous sûr ? » pour reprendre la main est le meilleur moyen
 * d'apprendre aux gens à taper « oui » sans lire — ce qui rend la confirmation
 * inutile le jour où elle compte.
 *
 * Monter, en revanche, autorise des actions qui n'auront pas de témoin. C'est
 * là, et là seulement, qu'on demande.
 */
export function basculer(actuel: Mode, demande: string, accorde = false): Bascule | Refus {
  if (!estMode(demande)) {
    return {
      genre: 'refus',
      motif:
        `« ${demande} » n’est pas un mode. Les quatre sont : ${MODES.join(', ')}. ` +
        '`hive mode` sans argument les affiche avec ce que chacun implique.',
    };
  }
  if (demande === actuel) {
    return {
      genre: 'bascule',
      de: actuel,
      vers: demande,
      elargit: false,
    };
  }

  // ÉQUIVALENCE CONSIGNÉE, PAS UN TEST QUI MANQUE. Le balayage rend `>` → `>=`
  // survivant ici, et c'est juste : la garde d'égalité est DIX LIGNES PLUS HAUT
  // (`demande === actuel` sort en bascule sans élargissement), donc les deux
  // rangs diffèrent forcément quand on arrive ici. `rang` étant
  // `MODES.indexOf` sur quatre littéraux distincts, il est injectif : aucune
  // paire ne peut rendre `rang(demande) === rang(actuel)`.
  //
  // Mesuré, pas déduit : les douze paires de modes distincts donnent le même
  // verdict avec `>` et avec `>=`. Écrire un test pour tuer ce mutant
  // demanderait une entrée qui n'existe pas — ce serait du décor.
  const monte = rang(demande) > rang(actuel);
  if (monte && !accorde) {
    const p = palierDe(demande);
    return {
      genre: 'bascule',
      de: actuel,
      vers: demande,
      elargit: true,
      confirmation:
        `Passer en « ${p.nom} » élargit ce que la ruche fait SANS DEMANDER : ` +
        `${p.fait} Ce qu’elle ne fera toujours pas : ${p.neFaitPas}` +
        (demande === 'plein' ? ` ${MENTION_PLEIN}` : ''),
    };
  }
  return { genre: 'bascule', de: actuel, vers: demande, elargit: monte };
}
