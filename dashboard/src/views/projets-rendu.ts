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

/** La part d'un rapport de livraison de mission dont dépend la phrase (cf. `livraison-locale.ts`). */
export type RapportLivraisonVu =
  | {
      etat: 'commitee';
      branche: string;
      commit: string;
      poussee: 'non_demandee' | 'poussee' | 'refusee' | 'echec';
      motif?: string;
    }
  | { etat: 'non_commitee'; motif: string }
  | { etat: 'inconnue'; motif: string };

/**
 * Ce qu'une livraison de mission est devenue, en une phrase — et sa gravité.
 *
 * ─── TROIS GRAVITÉS, ET LA DEUXIÈME EST CELLE QU'ON RATERAIT ──────────────────
 *
 * `echec` : rien n'est commité. `avertissement` : la branche EXISTE, rangée sur
 * l'ouvrière, mais la poussée demandée n'a pas eu lieu — refusée faute de
 * consentement, ou rejetée par le dépôt. L'afficher en vert parce qu'« il y a
 * une branche » ferait croire que le dépôt du projet l'a reçue ; c'est
 * exactement la question que la personne se pose en cliquant « pousser ».
 *
 * Un rapport ABSENT n'est pas un succès non plus : un merge lancé pour livrer
 * qui revient sans rien en dire est un échec qui se tait, et on le dit.
 */
export function phraseDeLivraison(
  rapport: RapportLivraisonVu | undefined,
  noeud: string,
  t: Traduire,
): { gravite: 'ok' | 'avertissement' | 'echec'; texte: string } {
  if (!rapport) {
    return {
      gravite: 'echec',
      texte: t(
        'Aucun rapport de livraison : rien ne prouve qu’une branche existe.',
        'No delivery report: nothing proves a branch exists.',
      ),
    };
  }
  // La Reine a perdu le fil : ni succès ni échec — on ne tranche pas à sa place.
  if (rapport.etat === 'inconnue') {
    return {
      gravite: 'avertissement',
      texte: `${t('Issue inconnue :', 'Unknown outcome:')} ${rapport.motif}`,
    };
  }
  if (rapport.etat === 'non_commitee') {
    return {
      gravite: 'echec',
      texte: `${t('Rien n’est commité :', 'Nothing committed:')} ${rapport.motif}`,
    };
  }
  const tete = `✔ ${rapport.branche} (${rapport.commit.slice(0, 12)})`;
  switch (rapport.poussee) {
    case 'poussee':
      return {
        gravite: 'ok',
        texte: `${tete} — ${t('poussée vers le dépôt du projet. Rien n’est fusionné.', 'pushed to the project repository. Nothing is merged.')}`,
      };
    case 'non_demandee':
      return {
        gravite: 'ok',
        texte: `${tete} — ${t(`rangée sur l’ouvrière « ${noeud} », prête à être poussée.`, `kept on worker “${noeud}”, ready to be pushed.`)}`,
      };
    case 'refusee':
      return {
        gravite: 'avertissement',
        texte: `${tete} — ${t('non poussée :', 'not pushed:')} ${rapport.motif ?? ''}`,
      };
    case 'echec':
      return {
        gravite: 'avertissement',
        texte: `${tete} — ${t('poussée en échec :', 'push failed:')} ${rapport.motif ?? ''}`,
      };
  }
}
