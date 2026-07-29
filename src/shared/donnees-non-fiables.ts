// Données non fiables — le contrat UNIQUE d'encapsulation de la ruche.
//
// Dans une ruche, le nectar rapporté par une butineuse passe par les mandibules
// des receveuses avant d'entrer dans une alvéole : rien n'est stocké brut. Même
// discipline ici. Tout texte qui vient d'ailleurs que du code de Hive — logs
// d'une ouvrière, diff, souvenir dérivé de ces logs, nom déclaré par un nœud,
// nom de projet saisi par un tiers — est une DONNÉE, jamais une instruction.
// Interpolé en texte libre dans un prompt, il devient pourtant indiscernable
// des consignes : c'est l'injection de prompt.
//
// Le contrat, une seule fois, ici :
//   1. une consigne de sécurité EN CLAIR annonce ce que contient le bloc ;
//   2. les données vivent dans un bloc délimité `<<<HIVE_DATA … HIVE_DATA>>>` ;
//   3. chaque enregistrement est sérialisé en JSON sur UNE ligne (sauts de
//      ligne, guillemets et échappements ressortent échappés — aucune donnée ne
//      peut simuler une nouvelle ligne de prompt) ;
//   4. le délimiteur est NEUTRALISÉ dans les données (sinon un log contenant
//      « HIVE_DATA>>> » refermerait le bloc et sortirait du cadre) ;
//   5. sous contrainte de budget, on tronque AVANT sérialisation (le JSON reste
//      valide) et un budget insuffisant rend une chaîne VIDE — jamais un bloc
//      ouvert sans sa fermeture, qui laisserait la suite du prompt À
//      L'INTÉRIEUR des données.
//
// UN SEUL couple de marqueurs pour toute la ruche, volontairement : plusieurs
// blocs se suivent dans le même prompt d'ouvrière (Couveuse puis Hive Mind).
// Multiplier les familles de marqueurs multiplierait la liste des séquences à
// neutraliser, et il suffirait qu'un module oublie celle d'un autre pour
// rouvrir la faille. Ici, la règle de neutralisation est unique et couvre tous
// les blocs ; deux blocs successifs restent sans ambiguïté car chacun est
// précédé de SA consigne, refermé avant l'ouverture du suivant, et aucune
// donnée ne peut produire un marqueur.
//
// Module PUR : aucune I/O, aucun état — testable isolément.

/** Ouverture du bloc de données. Défini ICI et nulle part ailleurs. */
export const OUVERTURE_DONNEES = '<<<HIVE_DATA';

/** Fermeture du bloc de données. Défini ICI et nulle part ailleurs. */
export const FERMETURE_DONNEES = 'HIVE_DATA>>>';

/**
 * Toute occurrence du marqueur DANS les données est désamorcée (insensible à
 * la casse : un modèle lit « hive_data>>> » comme « HIVE_DATA>>> »).
 */
const MOTIF_DELIMITEUR = /HIVE_DATA/gi;

/** Le remplacement ne contient plus le motif : une seule passe suffit. */
const REMPLACEMENT = 'HIVE-DATA';

/** Désamorce le marqueur de bloc : les données ne peuvent pas le refermer. */
export function neutraliserDelimiteur(texte: string): string {
  return texte.replace(MOTIF_DELIMITEUR, REMPLACEMENT);
}

/**
 * Tout ce qui commence une nouvelle ligne quelque part.
 *
 * ─── POURQUOI CETTE LISTE EST PLUS LONGUE QUE `\r\n` ─────────────────────────
 *
 * La première version ne connaissait que `\r`, `\n` et la tabulation. Elle
 * laissait donc passer U+2028 (LINE SEPARATOR) et U+2029 (PARAGRAPH SEPARATOR),
 * qui sont des retours à la ligne pour un terminal, pour un navigateur et pour
 * la plupart des rendus — mais pas pour cette expression régulière. Une
 * fonction qui promet « sur une seule ligne » et laisse passer un séparateur de
 * ligne ne tient pas sa promesse, et c'est le genre de trou qu'on utilise
 * précisément parce qu'une garde naïve ne le voit pas.
 *
 * Trouvé par la loupe, en creusant pourquoi un mutant de la contre-expertise
 * refusait de mourir. S'y ajoutent la tabulation verticale, le saut de page et
 * U+0085 (NEL), pour la même raison : ce sont des sauts de ligne ailleurs.
 */
const SEPARATEURS_DE_LIGNE = /[\r\n\t\v\f\u0085\u2028\u2029]+/gu;

/**
 * Prépare un champ libre pour un bloc de données : une seule ligne (tout ce qui
 * sépare des lignes → espace), marqueur neutralisé, longueur bornée.
 * Sert aussi hors bloc (réponses composées), où une ligne est tout aussi
 * souhaitable : un `\n` dans un nom déclaré par un tiers casse la mise en forme.
 */
export function champSurUneLigne(texte: string, max: number): string {
  return neutraliserDelimiteur(texte.replace(SEPARATEURS_DE_LIGNE, ' ')).slice(0, max);
}

/**
 * Encapsule des enregistrements dans le bloc délimité, une ligne JSON chacun.
 * Sans budget : à réserver aux contextes où la taille est déjà bornée en amont
 * (le Concierge borne chaque champ et chaque liste). Les appelants soumis à un
 * budget strict passent par `blocDonnees`.
 *
 * Les champs texte doivent AVOIR ÉTÉ passés par `champSurUneLigne` (ou
 * `neutraliserDelimiteur`) : JSON.stringify échappe les sauts de ligne mais
 * laisse passer le marqueur, qui doit disparaître avant d'entrer ici.
 */
export function encapsulerDonnees(enregistrements: readonly unknown[]): string {
  return [
    OUVERTURE_DONNEES,
    ...enregistrements.map((e) => JSON.stringify(e)),
    FERMETURE_DONNEES,
  ].join('\n');
}

export interface OptionsBlocDonnees<L> {
  /** Consigne de sécurité placée AVANT l'ouverture (annonce la nature des données). */
  entete: string;
  /** Enregistrements déjà nettoyés, dans l'ordre d'affichage souhaité. */
  lignes: readonly L[];
  /** Consigne de travail placée APRÈS la fermeture (facultative). */
  pied?: string;
  /** Budget TOTAL du bloc assemblé, en caractères. Strictement respecté. */
  maxChars: number;
  /**
   * Quelle extrémité sacrifier quand le budget déborde : `'premiere'` (défaut,
   * liste chronologique — le plus ancien est le moins instructif) ou
   * `'derniere'` (liste classée par pertinence — la queue est la moins utile).
   */
  moinsImportante?: 'premiere' | 'derniere';
  /**
   * Raccourcit la DERNIÈRE ligne survivante d'au moins `surplus` caractères, en
   * tronquant son champ volumineux AVANT sérialisation (le JSON reste valide).
   * Absent → une ligne unique qui déborde encore rend une chaîne vide.
   */
  raccourcir?: (ligne: L, surplus: number) => L;
}

/**
 * Assemble un bloc de données non fiables sous budget strict.
 *
 * Forme : `entete`, puis `<<<HIVE_DATA`, une ligne JSON par enregistrement,
 * `HIVE_DATA>>>`, puis `pied`. Le résultat fait AU PLUS `maxChars` caractères.
 *
 * Dégradation, dans l'ordre : retirer des enregistrements ENTIERS du côté le
 * moins important ; puis tronquer le champ volumineux du dernier survivant
 * (via `raccourcir`) ; puis, si l'ossature elle-même ne tient pas, rendre la
 * chaîne VIDE. Jamais de bloc coupé net : sa fermeture manquante avalerait
 * toute la suite du prompt.
 */
export function blocDonnees<L>(options: OptionsBlocDonnees<L>): string {
  const { entete, lignes, pied, maxChars, moinsImportante = 'premiere', raccourcir } = options;
  if (lignes.length === 0) return '';

  const assembler = (retenues: readonly L[]): string =>
    [entete, encapsulerDonnees(retenues), ...(pied ? [pied] : [])].join('\n');

  // Ossature seule (consignes + délimiteurs) hors budget : rien du tout.
  if (assembler([]).length > maxChars) return '';

  let retenues = lignes;
  while (retenues.length > 1 && assembler(retenues).length > maxChars) {
    retenues = moinsImportante === 'premiere' ? retenues.slice(1) : retenues.slice(0, -1);
  }
  const bloc = assembler(retenues);
  if (bloc.length <= maxChars) return bloc;

  // Une seule ligne reste et déborde : tronquer SON champ volumineux. Couper k
  // caractères de source retire au moins k caractères de JSON (l'échappement ne
  // raccourcit jamais) : une passe suffit.
  const seule = retenues[0];
  if (seule === undefined || !raccourcir) return '';
  const tronque = assembler([raccourcir(seule, bloc.length - maxChars)]);
  return tronque.length <= maxChars ? tronque : '';
}

/**
 * Tronque un champ texte pour libérer au moins `surplus` caractères, ellipse
 * comprise. Fabrique de `raccourcir` : les appelants n'ont plus qu'à désigner
 * leur champ volumineux.
 */
export function tronquerChamp(valeur: string, surplus: number): string {
  return `${valeur.slice(0, Math.max(0, valeur.length - surplus - 1))}…`;
}
