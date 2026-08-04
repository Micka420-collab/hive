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
