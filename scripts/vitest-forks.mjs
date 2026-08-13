// COMBIEN DE PROCESSUS LA SUITE A-T-ELLE LE DROIT D'OUVRIR ?
//
// ─── POURQUOI CE RÉGLAGE EXISTE, ET CE QU'IL N'EST PAS ───────────────────────
//
// Il n'est PAS un correctif. Le 13 août, la jambe Windows est tombée sur quatre
// `Hook timed out in 20000ms` dans trois fichiers sans rapport — dont un hook
// SYNCHRONE, du code qui n'attend rien et ne peut donc qu'être privé de CPU.
// Rejouée sur le même arbre, elle est repassée verte. Deux mesures :
//
//     rouge : 833,8 s de CPU de test pour 303,7 s de mur
//     verte : 662,7 s de CPU de test pour 247,4 s de mur
//
// Le même travail, 26 % plus cher sur celle qui est tombée. La machine variait.
// Mais 26 % ne fait pas passer un hook de 200 ms à 20 secondes — facteur CENT.
// La variance explique la fragilité, pas le décrochage (§ 9 terseptuagies).
//
// L'hypothèse restante est la SUR-SOUSCRIPTION : vitest ouvre autant de
// processus que la machine a de cœurs, et chacun lance en plus de vrais `git`,
// de vrais serveurs HTTP, de vraies bases SQLite. Sur quatre cœurs, ça fait
// beaucoup plus de quatre processus affamés.
//
// Elle est PLAUSIBLE, et c'est exactement pourquoi elle ne se code pas telle
// quelle : une cause plausible trouvée juste après un vrai symptôme est la
// forme la plus séduisante de l'erreur. Ce module ne décide donc rien — il
// rend l'hypothèse MESURABLE, en permettant de rejouer le même arbre avec et
// sans plafond et de comparer des temps plutôt que des intuitions.
//
// ─── LE SENS DE L'ERREUR EST CHOISI, PAS SUBI ────────────────────────────────
//
// Une valeur illisible (`--forks abc`, une variable mal orthographiée) pourrait
// retomber en silence sur le défaut. Ce serait le pire comportement possible
// POUR UN INSTRUMENT : on croirait mesurer avec un plafond, on mesurerait sans,
// et on conclurait « le plafond ne change rien » sur une expérience qui ne l'a
// jamais appliqué. Une mesure qui ment est pire que pas de mesure.
//
// Une valeur invalide fait donc ÉCHOUER le démarrage, bruyamment. Un instrument
// cassé refuse ; il ne devine pas.

/** Le message d'un réglage illisible — un seul auteur, pour que le banc l'épingle. */
export function refusDuReglage(brut) {
  return (
    `HIVE_VITEST_FORKS = « ${brut} » n'est pas un nombre de processus valide.\n` +
    `Attendu : un entier ≥ 1, ou rien du tout pour laisser vitest décider.\n` +
    `La suite refuse de démarrer plutôt que de mesurer avec un plafond qu'elle ` +
    `n'a pas appliqué.`
  );
}

/**
 * Le réglage de pool à fusionner dans la configuration, ou `null` pour laisser
 * vitest faire à sa tête.
 *
 * `null` — et pas un objet « équivalent au défaut » — parce que le défaut de
 * vitest dépend de la machine : le figer ici le rendrait FAUX ailleurs, et
 * l'absence de réglage est précisément ce qu'on veut comparer au plafond.
 *
 * @param {string|undefined} brut la variable d'environnement, telle quelle
 * @throws {Error} si elle est présente mais illisible
 */
export function reglageDesForks(brut) {
  if (brut === undefined || brut.trim() === '') return null;
  const texte = brut.trim();
  // `Number('12abc')` rend NaN, mais `parseInt` rendrait 12 : on veut le
  // refus, pas la lecture partielle d'une valeur que personne n'a voulu écrire.
  if (!/^\d+$/.test(texte)) throw new Error(refusDuReglage(brut));
  const n = Number(texte);
  if (n < 1) throw new Error(refusDuReglage(brut));
  // `minForks: 1` : sans lui, vitest garde son plancher par défaut, qui peut
  // être SUPÉRIEUR au plafond qu'on vient de poser — la configuration serait
  // alors contradictoire, et c'est le plancher qui gagnerait.
  return { pool: 'forks', poolOptions: { forks: { maxForks: n, minForks: 1 } } };
}
