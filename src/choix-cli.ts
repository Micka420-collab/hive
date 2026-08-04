/**
 * DEUX RÈGLES DE SAISIE EN LIGNE DE COMMANDE, SORTIES DE `cli.ts`.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `src/cli.ts` se termine par un `try { … } catch` de tête : il S'EXÉCUTE à
 * l'import. Aucun banc ne peut donc l'appeler (§ 2.8 du carnet), et le balayage
 * par mutation a trouvé deux bornes nues chez lui — vérifiées contre la suite
 * ENTIÈRE, pas contre un fichier choisi au hasard (§ 2 septdecies).
 *
 * Ces deux règles ne dépendent ni du réseau, ni du terminal, ni d'`argv` : elles
 * prennent des valeurs et rendent un résultat. Sorties ici, elles s'éprouvent
 * aux bornes, des deux côtés.
 *
 * ─── CE QUE CHACUNE PROTÈGE ──────────────────────────────────────────────────
 *
 *   1. `valeurApres` — la valeur qui suit un drapeau. La borne est `>= 0`, et
 *      c'est tout l'enjeu : `indexOf` rend **0** quand le drapeau est le PREMIER
 *      argument, ce qui est le cas le plus courant de tous
 *      (`hive cloudflare --setup ma-ruche.exemple.fr`). Sur `> 0`, cette
 *      invocation-là — la seule que la documentation montre — perd son
 *      argument en silence : pas d'erreur, pas de message, juste un hôte
 *      `undefined` et une commande qui ne fait pas ce qu'on lui a demandé.
 *      Zéro est une position, pas une absence.
 *
 *   2. `choisirParNumero` — le choix d'un dépôt dans une liste numérotée. Les
 *      deux bornes comptent, et la haute est la plus traître : sur `<`, le
 *      DERNIER dépôt de la liste devient inchoisissable, et le refus se
 *      contredit lui-même — « n'est pas un numéro de la liste (1 à 12) » quand
 *      l'utilisateur vient précisément de taper 12, qu'il a lu à l'écran.
 *      Une erreur qui nie ce qu'elle vient d'afficher ne s'attribue à rien :
 *      on se croit fou avant de croire à un défaut.
 */

/**
 * La valeur qui suit `drapeau` dans `args`, ou `undefined`.
 *
 * Rend aussi `undefined` quand le drapeau est le DERNIER argument : il n'y a
 * alors rien après lui, et rendre une valeur absente vaut mieux que rendre la
 * chaîne vide, qu'un appelant prendrait pour une réponse.
 */
export function valeurApres(args: readonly string[], drapeau: string): string | undefined {
  const i = args.indexOf(drapeau);
  // `>= 0` : zéro est une POSITION. `indexOf` réserve `-1` à l'absence.
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Le drapeau est-il présent, quelle que soit sa position ?
 *
 * Distinct de `valeurApres` à dessein : un drapeau posé SANS valeur est
 * présent. Les confondre ferait traiter `--setup` seul comme absent, donc
 * suivre le chemin « pas de tunnel nommé » au lieu de refuser un nom d'hôte
 * manquant — un silence là où l'utilisateur attend une explication.
 */
export function aLeDrapeau(args: readonly string[], drapeau: string): boolean {
  return args.indexOf(drapeau) >= 0;
}

/**
 * L'index (à partir de 0) désigné par une saisie humaine dans une liste
 * numérotée à partir de 1, ou `null` si la saisie ne désigne rien.
 *
 * Le choix par numéro est délibéré dans ce dépôt : retaper `owner/repo` à la
 * main sur une liste de cent lignes, c'est une faute de frappe garantie — et
 * une faute de frappe ici connecte un projet au MAUVAIS dépôt.
 *
 * Tout ce qui n'est pas un entier dans les bornes rend `null`, y compris les
 * formes qui « ressemblent » à un nombre : `'2.5'`, `'1e3'`, `''`, `'  '`.
 * `Number('')` vaut 0 et `Number('  ')` aussi — deux pièges classiques que la
 * borne basse referme, mais qui méritent d'être éprouvés pour ce qu'ils sont.
 */
export function choisirParNumero(saisie: string, taille: number): number | null {
  const n = Number(saisie.trim());
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > taille) return null;
  return n - 1;
}

/**
 * L'ÉLÉMENT désigné par une saisie humaine, ou `undefined` si aucun.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE, ALORS QUE `choisirParNumero` SUFFISAIT ──
 *
 * Parce que `choisirParNumero` rend un INDEX, et qu'entre l'index et l'élément
 * il restait une ligne dans `cli.ts` — une ligne à l'intérieur d'une fonction
 * qui attend une réponse au clavier (`rl.question`), donc qu'aucun banc ne peut
 * appeler :
 *
 *     const rang = choisirParNumero(reponse, r.depots.length);
 *     const choisi = rang === null ? undefined : r.depots[rang];
 *
 * La loupe a trouvé la seconde ligne SANS DÉFENSE. Muter `=== null` en
 * `!== null` la rend toujours `undefined` — car `liste[null]` vaut `undefined`
 * lui aussi — et le CLI répond alors « ce n'est pas un numéro de la liste » à
 * TOUTES les saisies, y compris les bonnes. La commande devient inutilisable
 * sans qu'une seule assertion ne bronche.
 *
 * Le remède est le même que pour les deux règles au-dessus, et c'est le
 * cinquième de la nuit : sortir la règle du fichier auto-exécutant plutôt que
 * de contorsionner un banc autour d'un terminal simulé.
 *
 * `undefined` plutôt qu'une exception : l'appelant DOIT traiter le cas, et il
 * le traite déjà — c'est lui qui sait comment le dire à l'utilisateur, avec la
 * saisie fautive et les bornes de la liste sous les yeux.
 *
 * ─── UN MUTANT ÉQUIVALENT, CONSTATÉ PAR ÉCRIT ────────────────────────────────
 *
 * Élargir la borne d'un cran — `choisirParNumero(saisie, liste.length + 1)` —
 * SURVIT à ce banc, et ce n'est pas un trou : le mutant est **équivalent**. Sur
 * une liste de trois, la saisie « 4 » rend alors l'index 3, et `liste[3]` vaut
 * `undefined` : exactement la valeur du refus. Aucun appelant ne peut
 * distinguer les deux comportements.
 *
 * Ça vaut d'être écrit, parce que c'est la MÊME coïncidence du langage qui
 * cachait le défaut d'origine : hors bornes, un tableau rend `undefined`, et
 * `undefined` est aussi la façon dont cette fonction dit « rien ». La borne
 * reste donc écrite juste — on ne s'appuie pas sur une coïncidence pour être
 * correct — mais aucun banc ne peut la tenir depuis ici. Ce qui la tient est
 * `choisirParNumero`, éprouvé plus haut sur ses deux bords.
 */
export function choisirDansListe<T>(saisie: string, liste: readonly T[]): T | undefined {
  const rang = choisirParNumero(saisie, liste.length);
  return rang === null ? undefined : liste[rang];
}
