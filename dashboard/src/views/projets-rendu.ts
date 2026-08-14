// CE QUE L'ÉCRAN DES PROJETS DIT — décidé ici, affiché là-bas.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// `Projets.tsx` fait 1 600 lignes et n'exportait aucune de ses décisions
// d'affichage : elles vivaient dans du JSX, donc hors d'atteinte de tout banc
// qui ne monte pas la vue entière. Un balayage échantillonné de
// `dashboard/src/views` (454 candidates, 42 examinées) y a rendu CINQ
// survivants, plus que dans n'importe quelle autre vue.
//
// Trois d'entre eux sont de vraies décisions — un verdict à cinq issues, un
// repli de nom, un suffixe conditionnel. Ils sont ici, purs et éprouvés.
//
// Les deux autres sont l'idiome JSX « rends si présent » (`{x && <span/>}`) :
// les sortir serait de la cérémonie, pas de la couverture. Ils restent dans la
// vue, consignés sur place avec l'entrée qui les distingue.
//
// Types STRUCTURELS, comme dans `src/shared/cli-rendu.ts` : ce module ne
// dépend d'aucun autre, donc rien ne peut le tirer vers le DOM.

/** Traduire, tel que `useT` le rend : `t(fr, en)`. */
export type Traduire = (fr: string, en: string) => string;

/** La part d'un résultat de merge dont dépend le verdict des tests. */
export interface ResultatTeste {
  /**
   * `false` si la préparation a ÉCHOUÉ — et seulement dans ce cas.
   *
   * TROIS états, pas deux, et le typage du protocole le dit :
   * `boolean | null | undefined`. `null` et `undefined` veulent dire « on n'en
   * sait rien » (un merge d'avant ce champ, un lanceur muet) ; les traiter
   * comme un échec accuserait l'environnement sans preuve. La comparaison
   * STRICTE à `false` est donc la garde, pas une coquetterie.
   */
  preparedOk?: boolean | null;
  /** Les tests ont-ils seulement été lancés ? */
  testsRun?: boolean | null;
  /** `true` verts, `false` rouges, `null`/absent si le lanceur n'a rien conclu. */
  testsPassed?: boolean | null;
}

/**
 * Le verdict des tests d'un merge, en une phrase.
 *
 * ─── CINQ ISSUES, ET AUCUNE N'EST DÉCORATIVE ─────────────────────────────────
 *
 * L'ENVIRONNEMENT EN ÉCHEC N'EST PAS UN TEST ROUGE, et c'est la distinction que
 * cette fonction existe pour tenir. Quand la préparation échoue, les tests n'ont
 * pas tourné du tout : dire « tests non lancés » sans dire POURQUOI envoie
 * chercher une régression dans du code qui va très bien.
 *
 * Et « pas de verdict » n'est pas « rouge » non plus : un lanceur qui ne rend
 * ni vrai ni faux n'a rien prouvé. L'afficher comme un échec accuserait le code
 * d'une panne d'outillage.
 *
 * Le mutant qui a rendu ceci nu — `testsPassed === true` muté en `!==` — fait
 * annoncer « ✔ tests verts » sur une suite ROUGE. C'est le pire sens possible
 * pour ce message-là : il est lu pour décider de fusionner.
 */
export function verdictDesTests(result: ResultatTeste, t: Traduire): string {
  if (result.preparedOk === false) {
    return t(
      'environnement non préparé — tests non lancés',
      'environment not prepared — tests not run',
    );
  }
  if (!result.testsRun) return t('tests non lancés', 'tests not run');
  if (result.testsPassed === true) return t('✔ tests verts', '✔ tests green');
  if (result.testsPassed === false) return t('✘ tests rouges', '✘ tests red');
  return t('tests sans verdict', 'tests without a verdict');
}

/** La part d'une livraison qui sert à la nommer. */
export interface LivraisonNommee {
  titre?: string;
  taskId: string;
}

/**
 * Le nom d'une livraison : son titre, ou son identifiant de tâche à défaut.
 *
 * Le repli n'est pas cosmétique. Le mutant `||` → `&&` fait rendre une chaîne
 * VIDE quand le titre manque : la ligne existe, elle est stylée, et elle ne
 * porte aucun nom — on voit une livraison sans savoir laquelle. Un identifiant
 * technique est laid ; une ligne muette est pire, parce qu'elle ne dit même pas
 * qu'il manque quelque chose.
 */
export function nomDeLivraison(l: LivraisonNommee): string {
  return l.titre || l.taskId;
}

/**
 * Le « · 3 en vol » qui suit le résumé d'une session — ou rien.
 *
 * `> 0` et non « truthy » : le mutant `&&` → `||` rend le suffixe QUAND IL N'Y
 * A PLUS RIEN en vol, et l'affiche alors avec un `0`. Une session terminée
 * annoncerait « · 0 en vol », c'est-à-dire une activité là où il n'y en a plus.
 */
export function suffixeEnVol(enVol: number, t: Traduire): string {
  return enVol > 0 ? ` · ${enVol} ${t('en vol', 'in flight')}` : '';
}
