// L'AVATAR D'UN WORKER — un visage abstrait, tiré de son identifiant.
//
// ─── POURQUOI UN AVATAR, ET POURQUOI ABSTRAIT ────────────────────────────────
//
// Deux ouvrières du même agent, sur deux machines, se lisaient à l'écran comme
// deux lignes de texte : le nom de baptême, quand il existe, et sinon un
// libellé technique. Sur une ruche de six postes, on cherche une ouvrière au
// premier coup d'œil, pas en lisant. Un visage stable le permet — à condition
// qu'il ne PRÉTENDE rien : pas de photo, pas de personnage, pas de couleur qui
// dirait « en panne » (le rouge des statuts est exclu). Une alvéole de sept
// cellules, dont le motif et la teinte sont DÉRIVÉS de l'identifiant du nœud.
//
// ─── LES TROIS PROMESSES ─────────────────────────────────────────────────────
//
//   · DÉTERMINISTE : le même identifiant donne le même visage, sur tout écran,
//     à chaque rechargement — c'est ce qui en fait un repère. Aucun aléa,
//     aucune horloge, aucun état ;
//   · JAMAIS VIDE : un motif sans cellule serait un trou, pas un visage ;
//   · LES DEUX THÈMES sans une ligne propre à l'un d'eux : les couleurs sont des
//     JETONS (`--graphe-*`, `--panel-2`, `--border-2`), jugés à 3:1 sur toute
//     surface dans les deux thèmes (`tests/dashboard-contraste.test.ts`).
//
// L'avatar est DÉCORATIF (`aria-hidden`) : le nom écrit à côté porte
// l'identité. Un lecteur d'écran n'a rien à gagner à entendre « hexagone ».

/** Les teintes permises : les séries de graphes, SAUF le rouge (`--graphe-5`), réservé au danger. */
const TEINTES = [1, 2, 3, 4, 6] as const;
export type TeinteAvatar = (typeof TEINTES)[number];

export type EtatCellule = 'plein' | 'accent' | 'vide';

export interface MotifAvatar {
  teinte: TeinteAvatar;
  /**
   * Les sept cellules : haut, haut-droite, bas-droite, bas, bas-gauche,
   * haut-gauche, centre. Symétrique gauche-droite, comme un visage.
   */
  cellules: [
    EtatCellule,
    EtatCellule,
    EtatCellule,
    EtatCellule,
    EtatCellule,
    EtatCellule,
    EtatCellule,
  ];
}

/**
 * Chaque teinte, ÉCRITE en toutes lettres : un `var(--graphe-${n})` fabriqué
 * échapperait au relevé des jetons (`tests/dashboard-feuilles.test.ts`), qui
 * vérifie que tout jeton lu est posé dans les deux thèmes.
 */
const COULEURS: Record<TeinteAvatar, string> = {
  1: 'var(--graphe-1)',
  2: 'var(--graphe-2)',
  3: 'var(--graphe-3)',
  4: 'var(--graphe-4)',
  6: 'var(--graphe-6)',
};

/** FNV-1a 32 bits : court, stable, et bien réparti sur des identifiants proches. */
function empreinte(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Le motif d'un identifiant — la partie PURE, éprouvée par les tests. */
export function motifAvatar(id: string): MotifAvatar {
  const h = empreinte(id);
  const bit = (n: number) => ((h >>> n) & 1) === 1;
  // Deux bits par groupe symétrique : vide, plein, ou accent (plein pâle).
  const etat = (n: number): EtatCellule => (bit(n) ? (bit(n + 1) ? 'accent' : 'plein') : 'vide');
  const cotesHaut = etat(4);
  const cotesBas = etat(6);
  const pleines = [etat(0), etat(2), cotesHaut, cotesHaut, cotesBas, cotesBas, etat(8)].filter(
    (c) => c !== 'vide',
  ).length;
  // JAMAIS VIDE : sous deux cellules pleines, le haut et le centre se
  // remplissent — la forme la plus lisible à 24 px.
  const rempli = pleines < 2;
  const haut = rempli ? 'plein' : etat(0);
  const centre = rempli ? 'plein' : etat(8);
  const cellules: MotifAvatar['cellules'] = [
    haut,
    cotesHaut,
    cotesBas,
    etat(2),
    cotesBas,
    cotesHaut,
    centre,
  ];
  return { teinte: TEINTES[(h >>> 10) % TEINTES.length]!, cellules };
}

/** Un hexagone pointe en haut, de centre (cx, cy) et de rayon r. */
function hexagone(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    points.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return points.join(' ');
}

// Les centres des sept cellules dans un carré de 48 : le centre, puis les six
// voisines d'une alvéole à pointe en haut (écart = √3 · r).
const R_CELLULE = 6.2;
const ECART = Math.sqrt(3) * R_CELLULE + 0.8;
const CENTRES: ReadonlyArray<readonly [number, number]> = [
  ...[0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [24 + ECART * Math.cos(a), 24 + ECART * Math.sin(a)] as const;
  }),
  [24, 24],
];

/**
 * L'avatar lui-même. `taille` en pixels CSS ; le dessin est vectoriel et reste
 * net de 20 à 96 px.
 */
export function AvatarWorker({ id, taille = 40 }: { id: string; taille?: number }) {
  const { teinte, cellules } = motifAvatar(id);
  const couleur = COULEURS[teinte];
  return (
    <svg
      className="ds-avatar"
      data-teinte={teinte}
      viewBox="0 0 48 48"
      width={taille}
      height={taille}
      aria-hidden="true"
      focusable="false"
    >
      <polygon className="ds-avatar-fond" points={hexagone(24, 24, 23)} />
      {cellules.map((c, i) => {
        const [cx, cy] = CENTRES[i]!;
        return (
          <polygon
            key={i}
            data-cellule={c}
            points={hexagone(cx, cy, R_CELLULE)}
            fill={c === 'vide' ? 'none' : couleur}
            fillOpacity={c === 'accent' ? 0.45 : 1}
            stroke={c === 'vide' ? 'var(--border-2)' : couleur}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}
