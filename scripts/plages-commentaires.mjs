// LES PLAGES DE COMMENTAIRES D'UN FICHIER — l'analyse que la loupe ne fait PAS.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// `ligneMutable` (scripts/loupe.mjs) reconnaît `{/*`, `//`, `*` et `/*` EN TÊTE
// DE LIGNE. C'est une décision de conception, pas un oubli : `lignesAjoutees`
// travaille sur les lignes AJOUTÉES d'un diff `-U0`, dont les fragments sont
// discontinus. « Suis-je à l'intérieur d'un bloc ? » ne se déduit pas d'une
// ligne isolée — un fragment peut commencer au milieu d'un commentaire.
//
// Le détecteur est donc de forme LIGNE, et une continuation sans marque lui
// échappe. C'est le § 9 quaternonagies, et il a coûté un rouge sur ma propre
// prose :
//
//     ════ CODE NEUF QUE RIEN NE DÉFEND ════
//     · dashboard/src/views/Balance.tsx — === → !==
//         `global.totalMs === 0` et n'affiche PAS ce tableau dans ce
//
// Le remède retenu était « par le bas » : marquer les continuations d'un `*`.
// Le § 9 septnonagies a montré la limite de ce remède-là — appliqué à
// l'endroit qui avait fait mal, pas partout.
//
// ─── CE QUE CE MODULE APPORTE ────────────────────────────────────────────────
//
// Sur un fichier ENTIER (pas un fragment de diff), la question a une réponse
// exacte : on lit du début et on sait toujours où l'on est. Ce module la donne,
// et le banc qui l'utilise interdit qu'une ligne de prose redevienne mutable.
//
// Il ne remplace PAS `ligneMutable` : la loupe continue de travailler sur des
// fragments, où cette lecture est impossible. Les deux cohabitent — l'une juge
// vite et de travers aux marges, l'autre juge juste mais exige tout le fichier.

/**
 * Les numéros de ligne (base 0) qui tombent À L'INTÉRIEUR d'un commentaire de
 * bloc — celui qu'ouvre `/*` et que ferme l'étoile suivie du slash. (On ne peut
 * pas écrire la fermeture ici : elle fermerait CE bloc.)
 *
 * La première ligne d'un bloc n'y est PAS : elle porte `/*` en tête, donc
 * `ligneMutable` la reconnaît déjà. Ce qui nous intéresse, ce sont les
 * CONTINUATIONS — celles qui n'ont aucune marque et ressemblent à du code.
 *
 * Les chaînes et les gabarits sont suivis, parce qu'un `/*` dans une chaîne
 * n'ouvre rien : sans ça, une seule URL commentée décalerait tout le reste du
 * fichier et le verdict porterait sur n'importe quoi.
 */
export function lignesDeCommentaire(src) {
  const dedans = new Set();
  let i = 0;
  let ligne = 0;
  let bloc = false;
  let chaine = null;
  let gabarit = 0;
  // ─── ÉQUIVALENCE CONSIGNÉE (§ 2.16 ter) ────────────────────────────────────
  //
  // `<` → `<=` ne peut être distingué par AUCUNE entrée. À `i === src.length`,
  // `c` et `d` valent `undefined` : aucune comparaison de la boucle ne peut
  // réussir — ni `c === '\n'` (le seul chemin qui ajoute une ligne), ni la
  // fermeture d'un bloc, ni celle d'une chaîne ou d'un gabarit. Le seul effet
  // du mutant est UN tour de plus qui n'écrit rien, puis la sortie.
  //
  // Mesuré, pas supposé : mutant posé, `7 passed (7)` — il SURVIT au rejeu,
  // ce qui est ce qu'on attend d'une équivalence établie.
  //
  // La borne reste : elle est la condition d'arrêt de la marche.
  // loupe : équivalent — < → <=
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\n') {
      ligne++;
      i++;
      if (bloc) dedans.add(ligne);
      continue;
    }
    if (bloc) {
      if (c === '*' && d === '/') {
        bloc = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (chaine !== null) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === chaine) chaine = null;
      i++;
      continue;
    }
    if (gabarit > 0) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') gabarit--;
      i++;
      continue;
    }
    if (c === '/' && d === '*') {
      bloc = true;
      i += 2;
      continue;
    }
    if (c === '/' && d === '/') {
      // On saute jusqu'au saut de ligne SANS boucle de comparaison : la borne
      // que la loupe mutait n'existe plus. `-1` (pas de saut de ligne) veut
      // dire « jusqu'à la fin », et le `continue` laisse la boucle du dessus
      // conclure.
      const finDeLigne = src.indexOf('\n', i);
      i = finDeLigne === -1 ? src.length : finDeLigne;
      continue;
    }
    if (c === '"' || c === "'") {
      chaine = c;
      i++;
      continue;
    }
    if (c === '`') {
      gabarit++;
      i++;
      continue;
    }
    i++;
  }
  return dedans;
}
