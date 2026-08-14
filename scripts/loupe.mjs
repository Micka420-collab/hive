// LA LOUPE — ce qu'on regarde avant de fusionner.
//
// ─── POURQUOI LA BARRIÈRE NE SUFFIT PAS ──────────────────────────────────────
//
// `typecheck`, `lint`, `vitest`, `build` répondent tous à la même question :
// « est-ce que ça marche ? ». Aucun ne répond à celle qui compte au moment de
// fusionner :
//
//     LE CODE QUE JE VIENS D'ÉCRIRE EST-IL DÉFENDU PAR MES PROPRES TESTS ?
//
// Une suite verte le reste quand on ajoute du code que rien ne vérifie. C'est
// le mode d'échec le plus courant et le plus discret : on livre une garde, elle
// est juste, et personne ne s'aperçoit le jour où quelqu'un la retire.
//
// ─── CE QUE FAIT LA LOUPE ────────────────────────────────────────────────────
//
// Elle prend les lignes que la branche AJOUTE au code source, en tire des
// mutations sûres, et vérifie que la suite ROUGIT sur chacune. Une mutation qui
// survit désigne du code neuf que rien ne défend.
//
// C'est la méthode qui a trouvé neuf défauts réels cette nuit, appliquée à
// l'endroit où elle rapporte le plus : sur le diff, avant qu'il n'entre.
//
// ─── CE QU'ELLE NE FAIT PAS, ET IL FAUT LE DIRE ──────────────────────────────
//
// · Elle ne remplace pas la barrière : elle vient APRÈS, et suppose tout vert.
// · Elle échantillonne. Au-delà du plafond (`LOUPE_MAX`, 12 par défaut), elle
//   DIT ce qu'elle a laissé de côté — une troncature silencieuse se lirait
//   comme « tout est couvert ».
// · Un mutant qui survit n'est pas toujours un défaut : il peut être ÉQUIVALENT
//   (aucune entrée ne distingue les deux versions). La loupe ne tranche pas
//   cela — elle désigne, un humain juge.
// · Elle ne mute que des OPÉRATEURS. Une mutation qui casserait la syntaxe
//   ferait échouer toute la suite et passerait pour un mutant tué : la loupe
//   mentirait dans le sens rassurant, le pire des deux.

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, jamais `.pathname` : ce dernier rend `/D:/dépôt/` sous
// Windows, et tout ce qui s'y concatène pointe alors dans le vide. C'est le
// § 6.1 du journal, déjà recommis trois fois — et la loupe, qui existe pour
// débusquer ce genre de chose, le portait elle-même.
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.LOUPE_BASE ?? 'origin/main';

/** Au-delà, on échantillonne — et on le dit. */
export const PLAFOND_PAR_DEFAUT = 12;

/** Le message d'un plafond illisible — un seul auteur, pour que le banc l'épingle. */
export function refusDuPlafond(brut) {
  return (
    `LOUPE_MAX = « ${brut} » n'est pas un nombre de mutations valide.\n` +
    `Attendu : un entier ≥ 1, ou rien du tout pour le défaut (${PLAFOND_PAR_DEFAUT}).\n` +
    `La loupe refuse de démarrer plutôt que de rendre un verdict sur zéro mutation.`
  );
}

/**
 * Combien de mutations la loupe a le droit d'examiner.
 *
 * ─── LE FAUX VERT ÉTAIT DANS LE DÉTECTEUR DE FAUX VERTS ──────────────────────
 *
 * `Number(process.env.LOUPE_MAX ?? 12)` retombait en silence sur `NaN` dès que
 * la variable n'était pas un nombre. La suite du calcul ne s'en apercevait pas :
 *
 *     pas      = Math.max(1, Math.ceil(440 / NaN))   →  NaN
 *     retenues = toutes.filter((_, i) => i % NaN === 0).slice(0, NaN)   →  []
 *
 * Zéro mutation retenue, la boucle ne tourne pas, `survivants` reste vide — et
 * la loupe imprime son plus beau verdict :
 *
 *     ════ LA LOUPE NE VOIT RIEN DE NU ════
 *     Chaque ligne examinée est défendue par au moins un test.
 *
 * La phrase est vraie au sens strict : aucune ligne n'a été examinée, donc
 * toutes celles qui l'ont été sont défendues. Elle se lit « c'est bon, fusionne ».
 * `LOUPE_MAX=douze` suffisait, et `LOUPE_MAX=0` aussi. Sortie 0, dans les deux cas.
 *
 * ─── D'OÙ IL VIENT, ET CE QUE ÇA DIT DE LA MÉTHODE ───────────────────────────
 *
 * Il n'a pas été trouvé par un banc. Il a été trouvé en REJOUANT la loupe de
 * bout en bout dans l'atelier, pour vérifier un tout autre correctif — celui
 * des combinateurs CSS. C'est le quatrième défaut de ce fichier découvert de
 * cette façon, et le quatrième qu'aucun de ses bancs ne pouvait voir : ils
 * éprouvent des fonctions pures, et le défaut vit à chaque fois dans la COLLE
 * entre elles.
 *
 * ─── LE SENS DE L'ERREUR EST CHOISI, PAS SUBI ────────────────────────────────
 *
 * `scripts/vitest-forks.mjs` a déjà tranché exactement cette question, dans les
 * mêmes termes : « une mesure qui ment est pire que pas de mesure ». Le même
 * geste ici, à la même forme, parce que c'est la même faute — un réglage
 * illisible ne se devine pas, il se refuse.
 *
 * Zéro est refusé au même titre : demander à un instrument de ne rien regarder
 * n'est pas un réglage, c'est une contradiction. Qui veut seulement compter les
 * candidates passe `1` et lit l'en-tête.
 *
 * @param {string|undefined} brut la variable d'environnement, telle quelle
 * @throws {Error} si elle est présente mais illisible
 */
export function plafondDesMutations(brut) {
  if (brut === undefined || brut.trim() === '') return PLAFOND_PAR_DEFAUT;
  const texte = brut.trim();
  // `Number('12abc')` rend NaN, mais `parseInt` rendrait 12 : on veut le refus,
  // pas la lecture partielle d'une valeur que personne n'a voulu écrire.
  if (!/^\d+$/.test(texte)) throw new Error(refusDuPlafond(brut));
  const n = Number(texte);
  if (n < 1) throw new Error(refusDuPlafond(brut));
  return n;
}

/**
 * Les échanges d'opérateurs, sûrs par construction.
 *
 * Chacun change le SENS sans toucher à la forme : le fichier reste analysable,
 * donc un échec de la suite est bien un test qui a mordu, pas un parseur qui a
 * renoncé.
 *
 * ─── LA TABLE ÉTAIT ASYMÉTRIQUE, ET DU MAUVAIS CÔTÉ ──────────────────────────
 *
 * `===` ↔ `!==` allait dans les deux sens. Les bornes, non : `>=` → `>` et
 * `<=` → `<` RESSERRENT, et leurs inverses — ceux qui RELÂCHENT — manquaient.
 *
 * Le sens absent était le plus dangereux des deux. Resserrer une borne fait
 * refuser du travail légitime : quelqu'un s'en plaint le jour même. La relâcher
 * fait ACCEPTER ce qui devait être refusé, et personne ne vient le dire.
 *
 * Ce n'était pas théorique : le carnet raconte `aSupprimer`, le geste le plus
 * irréversible du dépôt — `s.arreteA > 0` muté en `>= 0` faisait entrer une
 * ligne incohérente (état « arrêté », aucune date d'arrêt) dans les candidates à
 * l'effacement DÉFINITIF, immédiatement, puisque `now - 0` dépasse toute
 * rétention. Cette mutation-là avait été posée À LA MAIN, faute que la loupe
 * sache la produire.
 *
 * ─── POURQUOI CES ÉCHANGES NE SE MARCHENT PAS DESSUS ─────────────────────────
 *
 * Chaque motif porte ses espaces : ` >= ` ne contient pas ` > ` (le `>` y est
 * suivi d'un `=`), et ` => ` non plus (le `>` y est précédé d'un `=`). Sans
 * cette précaution, une même ligne rendrait deux mutations dont l'une casserait
 * la syntaxe — `a >== b`, ou toutes les fonctions fléchées du fichier — et un
 * fichier qui ne s'analyse plus fait échouer la suite entière : le mutant
 * passerait pour tué, et la loupe mentirait dans le sens rassurant.
 *
 * `??` ne figure PAS dans cette table : il a sa propre règle, plus étroite, juste
 * en dessous.
 */
const ECHANGES = [
  [' && ', ' || '],
  [' || ', ' && '],
  [' >= ', ' > '],
  [' > ', ' >= '],
  [' <= ', ' < '],
  [' < ', ' <= '],
  [' === ', ' !== '],
  [' !== ', ' === '],
];

/**
 * `?? repli` → `|| repli`, mais SEULEMENT quand le repli est un littéral TRUTHY.
 *
 * ─── POURQUOI PAS TOUS LES `??` : C'EST MESURÉ, PAS SUPPOSÉ ──────────────────
 *
 * `a ?? b` ne prend `b` que si `a` est `null`/`undefined` ; `a || b` le prend
 * AUSSI sur `0`, `''`, `false`. Le premier jet mutait donc tous les `??`.
 *
 * Un balayage à base épinglée a rendu son verdict : 12 désignations neuves, dont
 * DIX ÉQUIVALENTES — parce que le TYPE interdisait le cas. `get(k) ?? {…}` (un
 * objet n'est jamais falsy), `n.modeles ?? []`, `row?.echelon ?? null` (union de
 * littéraux non vides), `essais ?? 0` et `c?.actif ?? false` (la valeur falsy
 * possible EST le repli).
 *
 * La loupe ne voit pas les types : elle aurait re-désigné ces dix à CHAQUE passe,
 * et son verdict serait rouge à perpétuité. Or un instrument qui ne peut plus
 * rendre vert n'est plus une porte, c'est un mur — et un mur ne se lit pas.
 * L'en-tête met en garde contre le faux vert rassurant ; le faux rouge permanent
 * est l'autre façon de n'être plus écouté.
 *
 * ─── CE QUE LA RESTRICTION GARDE ─────────────────────────────────────────────
 *
 * Avec un repli truthy, une valeur « fausse mais présente » à gauche est
 * remplacée par quelque chose de DIFFÉRENT : la mutation mord toujours.
 *
 *     nodeOnShift.get(n.id) ?? true   une ouvrière HORS SERVICE redevient
 *                                     disponible — la garde échoue en S'OUVRANT
 *     opts.uid ?? 1000                `uid` 0 est ROOT : le conteneur changerait
 *                                     d'utilisateur, en silence
 *     code ?? 1                       un code de sortie 0 (succès) devient 1
 *     config.tickMs ?? 2_000          un 0 explicite écrasé par le défaut
 *
 * ─── CE QU'ELLE PERD, ET IL FAUT LE DIRE ─────────────────────────────────────
 *
 * `x ?? null` mord VRAIMENT si `x` peut être la chaîne vide — mais seul le type
 * le dit. On préfère rater ce cas plutôt que noyer chaque passe sous 107
 * désignations qu'on ne saurait pas trancher. Un repli `0.5` est perdu aussi
 * (le motif exige un premier chiffre non nul).
 *
 * Le motif porte ses espaces, comme les autres : ` ??= ` ne contient pas ` ?? `
 * (le second `?` y est suivi d'un `=`). Sans cela la loupe écrirait `a ||= b` —
 * du JavaScript VALIDE, donc silencieux, et le verdict porterait sur autre chose
 * que ce qu'on croit mesurer.
 */
const REPLI_QUI_MORD = /^(?:true\b|[1-9][\d_]*\b)/;

/**
 * Les lignes AJOUTÉES par la branche, fichier par fichier.
 *
 * ─── POURQUOI `scripts/` EN FAIT PARTIE ──────────────────────────────────────
 *
 * La loupe n'a longtemps regardé que `src` et `dashboard/src`. Le jour où
 * `scripts/amorce.mjs` est arrivé — le code qui décide si la ruche démarre du
 * tout, donc le plus exposé du dépôt —, elle a répondu « aucune ligne mutable
 * ajoutée par cette branche » sur un diff qui en ajoutait deux cents.
 *
 * Un outil qui existe pour débusquer le code que rien ne défend ne peut pas
 * avoir d'angle mort sur le chemin que TOUT LE MONDE emprunte en premier.
 *
 * `scripts/loupe.mjs` reste dehors, et c'est le seul : muter le juge pendant
 * qu'il juge rend un verdict dont on ne saurait pas ce qu'il mesure.
 */

/** Le périmètre par défaut : tout le code qui s'exécute, et rien d'autre. */
// ─── POURQUOI `site` Y FIGURE, ET DEPUIS QUAND ───────────────────────────────
//
// Il n'y était pas, pour une raison qui s'est révélée circulaire : `.html` était
// exclu en bloc de la loupe, donc `site/` n'aurait rien rendu, donc l'y mettre
// n'aurait servi à rien. Les deux lots précédents ont retiré l'exclusion et
// borné la mutation aux `<script>` — la vitrine est devenue EXAMINABLE.
//
// Sans cette ligne-ci elle ne serait jamais EXAMINÉE. `npm run loupe` est la
// garde de FUSION : elle tourne sans variable d'environnement, et ce qu'elle ne
// regarde pas par défaut n'est regardé par personne. Le premier balayage
// complet, lancé à la main, avait rendu 43 candidates dont 33 SANS TEST.
//
// Une garde qu'on rend capable et qu'on ne branche pas est une garde qu'on a
// écrite pour soi.
export const PORTEE_PAR_DEFAUT = ['src', 'dashboard/src', 'scripts', 'site'];

/** Le juge ne se mute pas lui-même. Cette exclusion ne se négocie pas. */
export const HORS_PORTEE = ':(exclude)scripts/loupe.mjs';

/**
 * Le périmètre du balayage, en `pathspec` git.
 *
 * ─── POURQUOI CE RÉGLAGE EXISTE ──────────────────────────────────────────────
 *
 * Un balayage ÉLARGI (base épinglée loin en arrière) rend des centaines de
 * candidates, et la loupe les parcourt dans l'ordre des chemins. Le 12 août, un
 * balayage à 597 candidates est mort au bout de quatre heures en étant arrivé à
 * `src/installer-assistant.ts` : tout `src/orchestrator`, `src/shared` et
 * `src/tui` — le cœur — n'avait jamais été atteint. Relancer à l'identique
 * aurait repassé des heures sur le terrain déjà jugé avant de revenir là.
 *
 * `LOUPE_CHEMINS` resserre donc le périmètre à ce qu'on veut vraiment voir. Il
 * se donne par l'ENVIRONNEMENT, comme `LOUPE_BASE`, et pour la même raison : un
 * périmètre est le réglage D'UN balayage, pas une propriété du dépôt. Écrit
 * dans le dépôt, il deviendrait un angle mort permanent — exactement ce que la
 * loupe existe pour empêcher.
 *
 * ─── LES DEUX GARDES, ET CE QU'ELLES COÛTENT SI ELLES SAUTENT ────────────────
 *
 * 1. VIDE ⇒ LE PÉRIMÈTRE COMPLET. Une liste vide passée à `git diff -- …` ne
 *    veut pas dire « rien » : elle veut dire « TOUT ». La loupe muterait alors
 *    les bancs eux-mêmes — muter un test et constater que la suite rougit ne
 *    prouve rigoureusement rien — et les documents. Un réglage absent ou fait
 *    de virgules doit rendre le périmètre par défaut, jamais le vide.
 *
 * 2. LE JUGE RESTE DEHORS, QUOI QU'ON DEMANDE. `LOUPE_CHEMINS=scripts` est une
 *    demande légitime ; elle ne doit pas remettre `scripts/loupe.mjs` sous sa
 *    propre lame. L'exclusion s'ajoute APRÈS, toujours, et pas seulement quand
 *    on s'en remet au périmètre par défaut.
 */
export function cheminsDuBalayage(brut) {
  const demandes = (brut ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const portee = demandes.length > 0 ? demandes : PORTEE_PAR_DEFAUT;
  return [...portee, HORS_PORTEE];
}

/**
 * Cette ligne mérite-t-elle d'être mutée ?
 *
 * ─── LE MENSONGE QUE CETTE FONCTION EXISTE POUR EMPÊCHER ─────────────────────
 *
 * Une mutation posée dans un COMMENTAIRE ne peut pas être tuée : le texte ne
 * s'exécute pas, la suite reste verte, et la loupe imprime « CODE NEUF QUE RIEN
 * NE DÉFEND » sur une phrase française. Elle ment alors dans le sens ALARMANT —
 * moins grave que le sens rassurant (§ en-tête), mais elle coûte deux minutes
 * de suite par occurrence et salit un verdict qu'on lit pour décider.
 *
 * Le filtre existait déjà, et il ratait la forme la plus courante du tableau de
 * bord. Mesuré le 13 août sur `dashboard/src` : sur dix survivants, TROIS
 * étaient des lignes de commentaire JSX de `Balance.tsx` — dont, ironie exacte,
 * les trois lignes qui CONSIGNENT une équivalence trouvée par la loupe. Elle
 * s'est dénoncée elle-même en relisant sa propre note.
 *
 * ─── POURQUOI `{/*` ET PAS PLUS ──────────────────────────────────────────────
 *
 * Un commentaire JSX s'ouvre par `{` puis `/*`. Aucune ligne dont les premiers
 * caractères non blancs sont `{/*` ne peut porter du code exécutable : ce qui
 * suit est du texte jusqu'à la fermeture du commentaire. La règle est donc SÛRE
 * au sens qui compte ici — elle n'écarte jamais une ligne de code.
 *
 * Ce qu'elle ne fait PAS, et qu'il faut dire plutôt que sous-entendre : les
 * lignes de CONTINUATION d'un commentaire multi-lignes qui ne commencent pas
 * par `*` restent invisibles. Le filtre travaille ligne par ligne, sur des
 * lignes que `git diff -U0` rend par morceaux non contigus : suivre l'état
 * « dans un commentaire » d'un morceau à l'autre serait une devinette, et une
 * devinette qui se trompe ÉCARTE du code réel — le mensonge rassurant, le pire
 * des deux. Deux faux survivants sur dix, jugés à la main en dix secondes,
 * coûtent moins cher qu'une nudité tue.
 *
 * ─── POURQUOI LE NOM DU FICHIER, ET PAS SEULEMENT LE TEXTE ───────────────────
 *
 * La version précédente ne prenait que `texte`, et elle a été corrigée POUR LE
 * JSX parce que c'est du JSX que je regardais ce jour-là. Le balayage suivant,
 * sur `scripts/`, a rendu ceci :
 *
 *     🔴 SANS TEST · scripts/essai-installation.sh · < → <=
 *                # < 60 s ») avait été mesuré sur un dépôt DÉJÀ cloné
 *
 * Un commentaire SHELL. Le périmètre par défaut de la loupe contient `scripts/`
 * depuis toujours, et `scripts/` contient du shell et du PowerShell : le filtre
 * n'a jamais connu qu'une seule famille de langages. Corriger `{/*` sans se
 * demander « et dans les autres langages du périmètre ? », c'était réparer
 * l'instance sous les yeux plutôt que la classe.
 *
 * ET `#` NE PEUT PAS ÊTRE AJOUTÉ À LA LISTE COMMUNE. En TypeScript moderne,
 * `#compteur = 0` est un CHAMP PRIVÉ — du code exécutable, qui porte des
 * comparaisons comme n'importe quel autre. Un `^\s*#` global écarterait du code
 * réel : cette fois-ci le mensonge serait le RASSURANT, celui qui cache. Le
 * marqueur de commentaire est une propriété du LANGAGE, donc la décision a
 * besoin de savoir dans quel fichier elle se prend.
 *
 * Un fichier inconnu retombe sur la famille C/JS — la plus large et la plus
 * prudente : elle n'écarte que ce qui est du commentaire dans presque tous les
 * langages qu'on écrira ici.
 *
 * @param {string} texte  la ligne, sans le `+` du diff
 * @param {string} [fichier]  son chemin, pour connaître le langage
 */
export function ligneMutable(texte, fichier = '') {
  if (texte.trim() === '') return false;
  // `{/*` d'abord : c'est celui qui manquait au tableau de bord.
  if (/^\s*(\{\/\*|\/\/|\*|\/\*)/.test(texte)) return false;
  // `#` ne vaut QUE là où il ouvre un commentaire. Ailleurs il porte du code.
  if (DIESE_COMMENTE.test(fichier) && /^\s*#/.test(texte)) return false;
  return true;
}

/**
 * Les fichiers où `#` ouvre un commentaire : shell, PowerShell, YAML, Docker,
 * et les fichiers sans extension du dossier `scripts` (des scripts shell à
 * shebang). Volontairement une liste FERMÉE : ajouter une extension est un
 * geste conscient, alors qu'une règle « tout ce qui n'est pas du JS » finirait
 * par écarter du code d'un langage auquel personne n'aura pensé.
 */
const DIESE_COMMENTE = /\.(sh|bash|zsh|ps1|psm1|ya?ml|toml|conf)$|(^|\/)Dockerfile[^/]*$/i;

/**
 * Les langages où ces jetons ne sont PAS des opérateurs.
 *
 * ─── LE MUTANT QUI N'AVAIT AUCUNE ISSUE ──────────────────────────────────────
 *
 * Un balayage de `dashboard/src/views` a rendu ceci, et la loupe l'a compté
 * parmi ses survivants comme n'importe quelle garde nue :
 *
 *     🔴 SANS TEST · dashboard/src/views/balance.css · > → >=
 *                  .bal-noeuds > summary {
 *
 * En CSS, `>` n'est pas une comparaison : c'est le COMBINATEUR ENFANT. Muté en
 * `>=`, le sélecteur ne s'analyse plus, et le navigateur jette la règle entière.
 *
 * L'en-tête de ce fichier pose l'invariant que cette mutation viole :
 *
 *   « Chacun change le SENS sans toucher à la FORME : le fichier reste
 *     analysable, donc un échec de la suite est bien un test qui a mordu, pas
 *     un parseur qui a renoncé. »
 *
 * Ici la forme casse. Et comme aucun banc n'analyse le CSS, rien ne rougit :
 * le mutant n'est ni tué ni tuable.
 *
 * ─── POURQUOI CE N'EST PAS « UN SURVIVANT DE PLUS » ──────────────────────────
 *
 * La § 2.16 ter du carnet ne laisse que DEUX issues à un survivant : ou bien une
 * entrée le distingue — on écrit ce test —, ou bien il est équivalent — on le
 * consigne sur place. Celui-ci n'a ni l'une ni l'autre :
 *
 *   · il n'est PAS équivalent — la règle disparaît vraiment, à l'écran ;
 *   · il n'est PAS testable — vitest ne lit pas de feuille de style.
 *
 * C'est une troisième issue, que le contrat de la loupe n'a pas. Un survivant
 * sans issue revient à CHAQUE passe et ne peut jamais s'éteindre : c'est le
 * faux rouge perpétuel dont la règle du `??` dit déjà, dix-huit lignes plus
 * haut, qu'« un instrument qui ne peut plus rendre vert n'est plus une porte,
 * c'est un mur — et un mur ne se lit pas ».
 *
 * ─── UNE LISTE DE REFUS, JAMAIS UNE LISTE D'ADMISSION ────────────────────────
 *
 * La tentation était d'écrire l'inverse : « ne muter QUE `.ts`, `.tsx`, `.mjs`,
 * `.sh` ». C'est la même faute que `DIESE_COMMENTE` évite juste au-dessus, dans
 * l'autre sens. Le jour où quelqu'un ajoute un `.py` ou un `.rb` au périmètre,
 * une liste d'admission le rendrait INVISIBLE à la loupe — sans rien dire, et
 * pour toujours. C'est le mensonge RASSURANT, celui que ce fichier existe
 * entièrement pour empêcher.
 *
 * Une liste de refus se trompe dans l'autre sens : un langage inconnu est muté,
 * et s'il n'a pas ces opérateurs il rend un survivant bruyant. Bruyant se voit
 * en dix secondes et se corrige d'une extension. Muet ne se voit jamais.
 *
 * ─── CE QUE ÇA COÛTE, MESURÉ ─────────────────────────────────────────────────
 *
 * Sur tout le périmètre : 2365 mutations en `.ts`, 967 en `.tsx`, 90 en `.mjs`,
 * 14 en `.sh` — et 3 en `.css`, les trois combinateurs enfant du dépôt. Le gain
 * n'est donc pas le volume : c'est qu'aucun des trois ne peut plus revenir
 * s'asseoir dans une liste de survivants qu'on lit pour décider.
 */
const SANS_OPERATEURS = /\.(css|scss|sass|less|styl|md|markdown|json|jsonc|svg|txt)$/i;

/**
 * ─── LE HTML A ÉTÉ EXCLU EN BLOC, ET C'ÉTAIT TROP LARGE ──────────────────────
 *
 * `.html` figurait dans la liste ci-dessus, pour une bonne raison : ses
 * attributs et ses `<style>` rendraient des survivants ni tuables ni jugeables.
 * Mais une page porte aussi du JAVASCRIPT, et l'exclure en bloc a rendu la
 * VITRINE — 828 lignes de script, le premier écran que voit un arrivant —
 * structurellement invisible à la loupe :
 *
 *     langageMutable('site/index.html')  →  false
 *
 * Pas « aucune candidate » : aucune candidate POSSIBLE, à jamais. Une garde
 * dont la portée exclut trop est aussi aveugle qu'une garde qui n'existe pas,
 * et elle est PIRE, parce qu'elle rassure (§ 9 nonoctogies, retourné).
 *
 * D'où : le HTML redevient mutable, et c'est `lignesDeScript` qui borne — on ne
 * regarde QUE ce que le navigateur exécuterait.
 */
const OUVRE_UN_SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/g;
const TYPE_EXECUTE = /^(text\/javascript|application\/javascript|module)$/;

/**
 * Les lignes qu'un navigateur EXÉCUTERAIT dans cette page, et elles seules.
 *
 * Même règle de sélection que `tests/vitrine-executee.test.ts` : un
 * `type="application/json"` est une donnée, pas du code, et le muter ne
 * prouverait rien. Le `<style>` et les attributs restent dehors — c'est
 * exactement ce que l'exclusion en bloc protégeait, et on le garde.
 *
 * Rend un ensemble de TEXTES et non de numéros de ligne : la loupe travaille au
 * texte de bout en bout (`original.replace(avant, apres)`), et lui donner ici
 * une autre unité créerait deux vérités à tenir ensemble.
 */
export function lignesDeScript(html) {
  const vues = new Set();
  for (const m of html.matchAll(OUVRE_UN_SCRIPT)) {
    const type = /type\s*=\s*["']([^"']+)["']/.exec(m[1])?.[1] ?? 'text/javascript';
    if (!TYPE_EXECUTE.test(type)) continue;
    for (const ligne of m[2].split('\n')) vues.add(ligne);
  }
  return vues;
}

/** Une page : mutable, mais seulement dans ses `<script>`. */
const PAGE = /\.html?$/i;
export const EST_UNE_PAGE = (fichier) => PAGE.test(fichier);

/**
 * Les `<script>` d'une page du dépôt, lus UNE fois.
 *
 * Sans mémoire, chaque ligne ajoutée relirait la vitrine entière — 3 000 lignes
 * par candidate. Une page absente (supprimée par le diff) rend un ensemble vide
 * plutôt que de faire tomber tout le balayage : on ne mute pas ce qui n'est
 * plus là, ce n'est pas une raison de ne rien muter ailleurs.
 */
const MEMOIRE_DES_PAGES = new Map();
function scriptsDeLaPage(fichier) {
  let vues = MEMOIRE_DES_PAGES.get(fichier);
  if (vues === undefined) {
    try {
      vues = lignesDeScript(readFileSync(RACINE + fichier, 'utf8'));
    } catch {
      vues = new Set();
    }
    MEMOIRE_DES_PAGES.set(fichier, vues);
  }
  return vues;
}

/**
 * Ce fichier est-il écrit dans un langage où les échanges ont un sens ?
 *
 * La question se pose UNE fois par fichier, pas par ligne : le langage est une
 * propriété du chemin. Et elle se pose à part de `ligneMutable`, qui répond à
 * une tout autre question — « cette ligne est-elle du commentaire ? ». Les
 * confondre casserait la remontée de `marqueeEquivalente`, qui s'appuie sur
 * `ligneMutable` pour savoir où s'arrêter : un `ligneMutable` devenu faux sur
 * TOUT un fichier ferait remonter la marque à l'infini.
 */
export function langageMutable(fichier) {
  return !SANS_OPERATEURS.test(fichier);
}

function lignesAjoutees() {
  const diff = execFileSync(
    'git',
    ['diff', '-U0', `${BASE}...HEAD`, '--', ...cheminsDuBalayage(process.env.LOUPE_CHEMINS)],
    {
      cwd: RACINE,
      // DIT, alors que c'est déjà le défaut d'`execFileSync` : le garde des
      // invariants exige l'explicite, pour qu'un futur `shell: true` soit un
      // geste visible et non un défaut qui bascule.
      shell: false,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const par = new Map();
  let fichier = null;
  for (const ligne of diff.split('\n')) {
    const m = /^\+\+\+ b\/(.+)$/.exec(ligne);
    if (m) {
      fichier = m[1];
      continue;
    }
    if (!fichier || !ligne.startsWith('+') || ligne.startsWith('+++')) continue;
    // Le LANGAGE d'abord : dans une feuille de style, `>` est un combinateur,
    // pas une comparaison. Le muter casse le sélecteur au lieu d'en changer le
    // sens — un survivant que rien ne peut ni tuer ni juger équivalent.
    if (!langageMutable(fichier)) continue;
    const texte = ligne.slice(1);
    // ─── UNE PAGE : SEULEMENT CE QUE LE NAVIGATEUR EXÉCUTE ──────────────────
    //
    // Le HTML est mutable depuis qu'il portait la vitrine entière hors de vue,
    // mais il ne l'est PAS en bloc : un `>` d'attribut ou de `<style>` rendrait
    // le survivant ni tuable ni jugeable que l'exclusion d'origine évitait. On
    // lit donc la page une fois, et on ne retient que ses `<script>`.
    if (EST_UNE_PAGE(fichier)) {
      if (!scriptsDeLaPage(fichier).has(texte)) continue;
    }
    // Les commentaires ne s'exécutent pas : les muter ne prouverait rien. Le
    // NOM du fichier accompagne le texte — `#` commente en shell, pas en TS.
    if (!ligneMutable(texte, fichier)) continue;
    if (!par.has(fichier)) par.set(fichier, []);
    par.get(fichier).push(texte);
  }
  return par;
}

/**
 * La classe de droite d'un `instanceof`, remplacée par la plus large qui soit.
 *
 * ─── L'ANGLE MORT QUI A DONNÉ CETTE RÈGLE ────────────────────────────────────
 *
 * La loupe ne mutait que des opérateurs BINAIRES DE COMPARAISON. Un lot dont la
 * garde centrale était `if (e instanceof TypeError)` — le tri entre « le serveur
 * a refusé » et « personne n'a répondu » — lui a donc rendu ZÉRO candidat, et
 * elle a imprimé « LA LOUPE NE VOIT RIEN DE NU » sur un diff dont la seule vraie
 * décision n'avait jamais été mutée. Son en-tête met en garde contre le faux
 * vert rassurant ; elle en produisait un. Le dépôt compte 79 `instanceof` en
 * production : l'angle mort n'était pas une curiosité.
 *
 * ─── POURQUOI `Object` PLUTÔT QU'UNE NÉGATION ────────────────────────────────
 *
 * Nier (`!(x instanceof Y)`) demanderait de connaître les BORNES de l'expression
 * — donc un parseur. Sans lui, on poserait des parenthèses au jugé, et une
 * mutation qui casse la syntaxe fait échouer toute la suite : elle passerait
 * pour un mutant tué, et la loupe mentirait dans le sens rassurant, le pire des
 * deux (voir l'en-tête).
 *
 * Remplacer la classe par `Object` reste un échange de JETON — la forme ne bouge
 * pas, `Object` est toujours dans la portée — et il ôte exactement ce que la
 * garde apporte : sa capacité à DISTINGUER. Un banc qui sépare `TypeError` de
 * `SyntaxError` rougit ; un banc qui ne fait que suivre le chemin heureux, non.
 * C'est bien ce qu'on veut mesurer.
 *
 * Ce que cette mutation NE voit pas, et il faut le dire : sur une entrée
 * PRIMITIVE, `'x' instanceof Object` et `'x' instanceof String` valent tous deux
 * `false` — le mutant survit alors sans être faux. La loupe DÉSIGNE, un humain
 * juge : c'est déjà son contrat.
 */
const CLASSE_LA_PLUS_LARGE = 'Object';

/**
 * Une ligne qui décide « SUIS-JE LE FICHIER QU'ON A LANCÉ ? ».
 *
 * ─── LA MUTATION QUI A NOYÉ LA MACHINE ───────────────────────────────────────
 *
 * `scripts/tamis-ordres.mjs` termine sur la garde qui l'empêche de s'exécuter à
 * l'import :
 *
 *     if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(…))
 *
 * La loupe l'a mutée en `||`. Sous vitest, `process.argv[1]` est toujours vrai :
 * la garde tire donc À L'IMPORT. Or le test qui importe `principal` fait alors
 * ce que ce fichier fait — RELANCER LA SUITE ENTIÈRE TROIS FOIS. Chacune des
 * trois réimporte le même module muté, et en relance trois autres.
 *
 * Mesuré : charge moyenne 57, une soixantaine de vitest vivants, des processus
 * de onze minutes. Le butoir de 15 minutes de `suiteRougit` n'y peut rien —
 * `timeout` d'`execFileSync` tue l'enfant DIRECT, jamais sa descendance.
 *
 * ─── POURQUOI C'EST UNE RÈGLE, PAS UN RUSTINE SUR UN FICHIER ─────────────────
 *
 * Trois fichiers du dépôt portent cette garde, sous trois formes. Muter l'une
 * d'elles n'éprouve AUCUN comportement du programme : ça change si le module
 * S'EXÉCUTE À L'IMPORT, ce qui est une propriété du harnais, pas du code sous
 * examen. Le mutant n'est jamais un signal utile — au mieux il tue le worker et
 * passe pour « défendu », au pire il fait s'appeler la suite elle-même.
 *
 * C'est le même raisonnement qui garde `scripts/loupe.mjs` hors du champ, étendu
 * à ce qu'il aurait dû couvrir dès le départ : on ne mute pas ce qui décide
 * QU'ON S'EXÉCUTE.
 *
 * ─── CE QUE CETTE RÈGLE COÛTE, ET IL FAUT LE DIRE ────────────────────────────
 *
 * `MOI` et `LANCE` sont la convention de nommage de ce dépôt pour les deux côtés
 * de la comparaison. Les renommer rendrait cette garde aveugle sans que rien ne
 * le signale. Le couplage est réel : il est écrit ici plutôt que caché.
 */
export function estGardeDePointDEntree(ligne) {
  if (ligne.includes('import.meta.url') || ligne.includes('process.argv[1]')) return true;
  // La forme en deux temps : `const MOI = …` / `const LANCE = …` puis la
  // comparaison, qui ne porte plus aucun des deux marqueurs ci-dessus.
  return /\bMOI\b/.test(ligne) && /\bLANCE\b/.test(ligne);
}

/**
 * Les mutations d'UNE ligne. PURE, donc éprouvable — et elle l'est
 * (`tests/loupe-mutations.test.mjs`), ce qui n'était pas le cas tant qu'elle
 * vivait enfouie dans `candidates()`.
 */
export function mutationsDeLigne(ligne) {
  const out = [];
  // Une garde de point d'entrée ne se mute pas : voir `estGardeDePointDEntree`.
  if (estGardeDePointDEntree(ligne)) return out;
  for (const [de, vers] of ECHANGES) {
    if (!ligne.includes(de)) continue;
    // Une seule occurrence de l'opérateur : sinon on ne saurait pas laquelle on
    // a mutée, et le verdict porterait sur autre chose que ce qu'on croit.
    if (ligne.split(de).length - 1 !== 1) continue;
    out.push({
      avant: ligne,
      apres: ligne.replace(de, vers),
      quoi: `${de.trim()} → ${vers.trim()}`,
    });
  }
  // `??` : le repli sur ABSENCE devient un repli sur FAUSSETÉ — mais seulement
  // là où les deux peuvent différer (voir `REPLI_QUI_MORD`).
  if (ligne.split(' ?? ').length - 1 === 1) {
    const apresRepli = ligne.slice(ligne.indexOf(' ?? ') + 4);
    if (REPLI_QUI_MORD.test(apresRepli)) {
      out.push({
        avant: ligne,
        apres: ligne.replace(' ?? ', ' || '),
        quoi: '?? → ||',
      });
    }
  }
  // `instanceof` : la classe de droite s'élargit, la garde cesse de trier.
  const m = / instanceof ([A-Za-z_$][\w$]*)/.exec(ligne);
  if (m !== null && ligne.split(' instanceof ').length - 1 === 1 && m[1] !== CLASSE_LA_PLUS_LARGE) {
    out.push({
      avant: ligne,
      apres: ligne.replace(` instanceof ${m[1]}`, ` instanceof ${CLASSE_LA_PLUS_LARGE}`),
      quoi: `instanceof ${m[1]} → instanceof ${CLASSE_LA_PLUS_LARGE}`,
    });
  }
  return out;
}

/** Les mutations candidates, une par (fichier, ligne, échange). */
function candidates() {
  const out = [];
  for (const [fichier, lignes] of lignesAjoutees()) {
    const source = readFileSync(RACINE + fichier, 'utf8');
    for (const ligne of lignes) {
      // La ligne doit être PRÉSENTE UNE SEULE FOIS dans le fichier final :
      // sinon on ne saurait pas laquelle on a mutée, et le verdict porterait
      // sur autre chose que ce qu'on croit.
      if (source.split(ligne).length - 1 !== 1) continue;
      for (const m of mutationsDeLigne(ligne)) out.push({ fichier, ...m });
    }
  }
  return out;
}

/**
 * Le verdict tiré de ce que `execFileSync` a jeté. PUR, donc éprouvable.
 *
 * ─── LE FAUX VERT DANS L'OUTIL QUI TRAQUE LES FAUX VERTS ─────────────────────
 *
 * Le `catch` d'origine attrapait TOUT et rendait « la suite a rougi ». Il ne
 * distinguait pas « les tests ont mordu » de « les tests n'ont jamais tourné ».
 *
 * Sous Windows, `npx` est `npx.cmd`, et `spawn` sans interpréteur ne sait pas le
 * lancer (§ 6.2 du journal, déjà mordu trois fois). Chaque mutant y partait donc
 * en ENOENT immédiat — trois millisecondes — était compté « ✔ défendue », et la
 * loupe imprimait « LA LOUPE NE VOIT RIEN DE NU » sans avoir exécuté un seul
 * test. Sur la machine de quelqu'un d'autre, le seul outil du dépôt dont le
 * métier ENTIER est de débusquer les faux verts en était un.
 *
 * Le même piège guette ailleurs : un dépassement de `timeout`, un signal, une
 * mémoire épuisée. Aucun de ces trois n'est un test qui a mordu.
 *
 * Un `status` NUMÉRIQUE est la seule preuve que vitest a tourné et rendu un
 * verdict. Tout le reste est un « je n'ai pas pu regarder », et ça se DIT.
 */
export function verdictDeLErreur(e) {
  if (e === null || e === undefined) return { regarde: true, rouge: false };
  if (typeof e.status === 'number') return { regarde: true, rouge: e.status !== 0 };
  const cause =
    e.code === 'ENOENT'
      ? `binaire introuvable (${String(e.path ?? 'inconnu')})`
      : e.signal !== null && e.signal !== undefined
        ? `tué par le signal ${String(e.signal)}`
        : `${String(e.code ?? 'erreur')} — ${String(e.message ?? '').slice(0, 120)}`;
  return { regarde: false, cause };
}

/**
 * Le chemin RÉEL de vitest, jamais son shim.
 *
 * `scripts/ruche.mjs` et `src/shared/demarrage.ts` prennent déjà ce soin, et
 * pour la raison exacte qui a cassé celui-ci. La loupe mettait en garde en tête
 * de fichier contre `.pathname` — l'autre piège Windows — et passait à côté de
 * celui-là.
 */
const VITEST = path.join('node_modules', 'vitest', 'vitest.mjs');

function suiteRougit() {
  let jete = null;
  try {
    execFileSync(process.execPath, [VITEST, 'run', '--bail', '1'], {
      cwd: RACINE,
      shell: false,
      stdio: 'pipe',
      timeout: 900_000,
    });
  } catch (e) {
    jete = e;
  }
  const v = verdictDeLErreur(jete);
  if (!v.regarde) {
    console.error('');
    console.error(`✘ LA LOUPE N’A PAS PU REGARDER : ${v.cause}`);
    console.error('');
    console.error('  Aucun verdict n’est rendu — un outil qui n’a pas pu regarder');
    console.error('  ne dit PAS « c’est défendu ». Le fichier muté a été restauré.');
    console.error('');
    process.exit(2);
  }
  return v.rouge;
}

// ─── LE CORPS NE S'EXÉCUTE QUE SI ON A LANCÉ CE FICHIER ─────────────────────
//
// Sans cette garde, `import('scripts/loupe.mjs')` — depuis un test, depuis un
// outil — DÉCLENCHE une campagne de mutation complète : le fichier mute des
// sources, lance vitest, restaure. Un test qui voulait éprouver une fonction
// pure de vingt lignes se mettait donc à muter le dépôt, et l'interrompre
// laissait une mutation derrière lui.
//
// Mesuré, et pas qu'une fois : le premier `import` depuis `loupe-verdict.test.mjs`
// a lancé la loupe, je l'ai tuée, et `src/tui/rendu.ts` est resté muté. C'est le
// § 2.8 du journal — un fichier qui s'exécute à l'import est un angle mort — et
// le § 5.2 — une loupe interrompue laisse sa mutation — dans le même geste.
//
// ─── L'EXCLUSIVITÉ, ET POURQUOI ELLE EST CÂBLÉE PLUTÔT QUE PROMISE ───────────
//
// La loupe MUTE l'arbre : elle écrit une ligne fausse, lance la suite, restaure.
// Deux loupes dans le même atelier se marchent donc littéralement dessus —
// l'une restaure pendant que l'autre mesure — et les verdicts des DEUX perdent
// toute valeur. Pas « à moitié faux » : sans valeur, puisqu'on ne sait plus
// quelle version du fichier a été éprouvée.
//
// C'est au carnet (§ 2 unvicies) depuis qu'une première collision a fait jeter
// un balayage entier : refaits seuls, les chiffres différaient (26 contre 30,
// 1 contre 2).
//
// La règle était donc connue, écrite, et chèrement apprise. Elle a quand même
// été enfreinte le soir même — un balayage large lancé en tâche de fond, puis
// une seconde loupe dans le même atelier pour valider une PR, parce qu'entre
// les deux on ne pense plus au processus qu'on ne voit pas.
//
// C'est le motif que ce dépôt passe la nuit à corriger ailleurs : UNE RÈGLE QUE
// RIEN N'APPLIQUE FINIT PAR ÊTRE ENFREINTE, et la discipline de celui qui l'a
// écrite n'y change rien — elle rend seulement la faute plus vexante. On ne se
// promet donc pas de faire attention : on câble la garde.

/**
 * L'âge au-delà duquel un verrou est réputé ABANDONNÉ.
 *
 * Un verrou sans péremption est pire que pas de verrou : une loupe tuée au
 * clavier bloquerait l'atelier jusqu'à ce que quelqu'un devine qu'il faut
 * supprimer un fichier dont il ignore l'existence.
 *
 * Deux heures : très au-delà du balayage le plus long observé (une quinzaine de
 * minutes), très en-deçà d'une session de travail.
 */
export const VERROU_PERIME_MS = 2 * 60 * 60 * 1000;

/**
 * Le verrou est-il libre ?
 *
 * `vivant` est INJECTÉ plutôt que lu : savoir si un pid tourne est un accès
 * système, et le passer en paramètre est ce qui permet d'éprouver les quatre
 * branches sans jamais lancer — ni tuer — un vrai processus.
 *
 * L'ÂGE EST JUGÉ AVANT LE PID, et l'ordre compte : un pid RECYCLÉ par le
 * système désignerait un processus étranger bien vivant, et l'atelier resterait
 * bloqué sur un verrou que plus personne ne tient.
 */
export function jugerVerrou(brut, maintenant, vivant) {
  if (brut === null || brut.trim() === '') return { libre: true };
  let v;
  try {
    v = JSON.parse(brut);
  } catch {
    return { libre: true, motif: 'illisible' };
  }
  if (typeof v !== 'object' || v === null) return { libre: true, motif: 'illisible' };
  const { pid, depuis } = v;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { libre: true, motif: 'illisible' };
  }
  if (typeof depuis !== 'number' || !Number.isFinite(depuis)) {
    return { libre: true, motif: 'illisible' };
  }
  if (maintenant - depuis > VERROU_PERIME_MS) return { libre: true, motif: 'perime', pid };
  return vivant(pid) ? { libre: false, motif: 'tenu', pid } : { libre: true, motif: 'perime', pid };
}

/**
 * Ce qu'on dit à celui qui arrive second.
 *
 * Un refus qui ne dit pas quoi faire transforme une garde en énigme : le
 * réflexe suivant serait de supprimer le fichier au hasard, ce qui rétablit
 * exactement le défaut que le verrou existe pour empêcher.
 */
export function refusExclusivite(pid) {
  return (
    `LOUPE : une autre loupe tourne déjà dans cet atelier (pid ${pid}).\n` +
    '        Deux loupes qui mutent le même arbre ne rendent AUCUN verdict\n' +
    '        valable : l’une restaure pendant que l’autre mesure (§ 2 unvicies).\n' +
    '        Attendez qu’elle finisse, ou arrêtez-la, puis relancez.'
  );
}

/** Le contenu du verrou. Sérialisé ici pour que le format ait UN seul auteur. */
export function contenuVerrou(pid, maintenant) {
  return JSON.stringify({ pid, depuis: maintenant });
}

/** Le pid tourne-t-il ? `kill(pid, 0)` ne tue rien : il teste l'existence. */
function pidVivant(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = il existe mais ne nous appartient pas. Il est donc VIVANT.
    return e?.code === 'EPERM';
  }
}

// `process.argv[1]` est le script que Node a réellement lancé. On compare les
// chemins RÉELS des deux côtés : `fileURLToPath` d'un côté, `realpath` de
// l'autre, parce qu'un lien symbolique ou un `./scripts/loupe.mjs` relatif
// donnerait deux chaînes différentes pour le même fichier.
const MOI = fileURLToPath(import.meta.url);
const LANCE = process.argv[1] === undefined ? '' : path.resolve(process.argv[1]);
/**
 * La marque qui dit « ce mutant a DÉJÀ été jugé équivalent, et voici pourquoi ».
 *
 * Elle se pose dans un commentaire, JUSTE AU-DESSUS de la ligne concernée.
 */
export const MARQUE = /loupe\s*:\s*équivalent/i;

/**
 * ─── LA MARQUE NOMME LA MUTATION, ET CE N'EST PAS UN DÉTAIL ──────────────────
 *
 * Première version : la marque valait pour la LIGNE. Vérifiée de bout en bout
 * sur `tableau.ts`, elle s'est effondrée immédiatement.
 *
 *     for (const a of alertes) if (pire === null || RANG[a] < RANG[pire]) …
 *
 * Cette ligne porte TROIS mutations — `||` → `&&`, `<` → `<=`, `===` → `!==`.
 * La consignation n'en juge qu'UNE équivalente ; les deux autres sont tuées par
 * la suite, ce qui est parfaitement normal et sain. Une marque de ligne les
 * couvrait toutes, et mon propre détecteur de « marque fausse » criait alors au
 * loup sur deux mutants défendus, en faisant sortir la loupe en 1.
 *
 * J'avais donc écrit un contrôle contre les marques abusives, et le contrôle
 * était lui-même abusif. La leçon tient en une phrase : **l'unité de jugement
 * de la loupe est la MUTATION, pas la ligne** — tout ce qui prétend juger doit
 * se dire dans la même unité.
 *
 * La marque porte donc le libellé exact du mutant, celui-là même que la loupe
 * imprime : `loupe : équivalent — < → <=`. Bénéfice de bord, plus important que
 * la mécanique : la consignation doit maintenant DIRE ce qu'elle a jugé, au
 * lieu de laisser un lecteur le deviner.
 */

/**
 * Cette ligne porte-t-elle, au-dessus d'elle, une consignation d'équivalence ?
 *
 * ─── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * Un balayage de `src/orchestrator` a rendu six survivants. Les SIX étaient
 * déjà tranchés et consignés sur place, avec leur raisonnement mesuré — et
 * quatre fichiers différents portaient littéralement la même phrase :
 *
 *     « Un balayage élargi de la loupe le re-signalera « sans test » à chaque
 *       fois. »
 *
 * La connaissance existait, elle était au bon endroit, et l'instrument ne
 * savait pas la lire. Chaque passe redemandait donc six jugements humains
 * strictement identiques aux précédents.
 *
 * ─── CE QUE CETTE MARQUE N'EST PAS, ET LA GARDE QUI L'EN EMPÊCHE ─────────────
 *
 * Ce n'est PAS une liste d'exclusion. Une liste d'exclusion est un endroit où
 * une vraie nudité peut se cacher pour toujours — le mensonge rassurant, celui
 * que la loupe existe entièrement pour empêcher.
 *
 * Deux choses l'en distinguent, et elles ne sont pas cosmétiques :
 *
 * 1. **LA MUTATION EST QUAND MÊME JOUÉE.** Marquer n'économise pas l'exécution
 *    de la suite. Ça n'économise que le JUGEMENT, qui est ce qui se répétait.
 *
 * 2. **UNE MARQUE FAUSSE SE DÉNONCE TOUTE SEULE.** Si un mutant marqué
 *    « équivalent » se fait TUER par la suite, c'est que quelque chose le
 *    distingue — la marque est donc fausse, ou le code a changé sous elle. La
 *    loupe le crie au lieu de s'en réjouir. C'est le sens de l'erreur choisi,
 *    pas subi (§ 9 unseptuagies) : la marque ne peut pas rendre un verdict plus
 *    rassurant qu'il ne devrait, seulement plus alarmant.
 *
 * La marque vit DANS LA SOURCE, collée à la ligne, et pas dans un fichier à
 * part : une liste séparée dérive du code qu'elle décrit, et personne ne la
 * relit en revue. Ici, déplacer la ligne sans sa justification saute aux yeux.
 *
 * ─── LA REMONTÉE S'ARRÊTE AU PREMIER NON-COMMENTAIRE ─────────────────────────
 *
 * Sans cet arrêt, une marque posée trente lignes plus haut couvrirait tout un
 * bloc de code — et le jour où quelqu'un insère une garde neuve au milieu, elle
 * naîtrait marquée sans que personne l'ait jugée. Le bloc de commentaire
 * CONTIGU est la seule portée dont on puisse dire qu'elle a été écrite pour
 * cette ligne-là.
 *
 * @param {string} contenu le fichier entier
 * @param {string} ligne la ligne mutée, telle que le diff l'a rendue
 * ─── LE NOM DU FICHIER VOYAGE JUSQU'ICI, ET IL A FAILLI NE PAS LE FAIRE ──────
 *
 * Première version : la remontée appelait `ligneMutable(texte, '')` — sans nom
 * de fichier. Conséquence mesurée : dans un `.sh`, un commentaire `#` n'était
 * pas reconnu comme tel, la remontée le prenait pour du CODE et s'arrêtait sur
 * la marque même qu'elle cherchait. La marque ne pouvait PAS fonctionner en
 * shell — et `scripts/` est dans le périmètre par défaut depuis le premier jour.
 *
 * La faute est précise : `ligneMutable` venait d'être élargie avec un paramètre
 * PORTEUR DE SENS (§ 9 unseptuagies), et je l'ai appelée depuis un site neuf en
 * lui passant sa valeur neutre. J'ai jeté la connaissance que je venais
 * d'ajouter, dans le même fichier, à cent lignes d'écart.
 *
 * @param {string} quoi le libellé du mutant, ex. `< → <=`
 * @param {string} [fichier] son chemin — `#` ne commente pas dans tous les langages
 */
export function marqueeEquivalente(contenu, ligne, quoi, fichier = '') {
  // Sans libellé, aucune marque ne peut s'appliquer : une consignation qui ne
  // nomme pas son mutant ne juge rien.
  if (typeof quoi !== 'string' || quoi.trim() === '') return false;
  const lignes = contenu.split('\n');
  const i = lignes.indexOf(ligne);
  // Ligne introuvable : on ne suppose RIEN. Ne pas trouver la ligne est déjà
  // anormal, et répondre « marquée » sur une inconnue serait la pire réponse.
  if (i < 0) return false;
  for (let j = i - 1; j >= 0; j--) {
    const texte = lignes[j];
    if (texte.trim() === '') return false;
    if (ligneMutable(texte, fichier)) return false; // du code : la remontée s'arrête
    // Les DEUX conditions : nommer l'instrument, et nommer le mutant jugé.
    if (MARQUE.test(texte) && texte.includes(quoi)) return true;
  }
  return false;
}

if (MOI !== LANCE) {
  // Importée : on n'expose que les fonctions, on ne mute rien.
} else {
  principal();
}

function principal() {
  // LE RÉGLAGE D'ABORD, AVANT MÊME LE VERROU. Un plafond illisible ne doit ni
  // prendre l'atelier ni lancer un balayage : il doit refuser tout de suite.
  // Lu ici et pas au chargement du module, pour qu'`import` d'une fonction pure
  // depuis un banc ne dépende jamais d'une variable d'environnement.
  let plafond;
  try {
    plafond = plafondDesMutations(process.env.LOUPE_MAX);
  } catch (e) {
    console.error('');
    console.error(`✘ ${String(e.message)}`);
    console.error('');
    process.exit(2);
  }

  // LA GARDE, CÂBLÉE. Voir l'en-tête de `jugerVerrou` : la règle existait déjà
  // au carnet et a quand même été enfreinte, faute de quoi que ce soit pour
  // l'appliquer.
  const verrou = path.join(RACINE, '.loupe-verrou');
  let brut = null;
  try {
    brut = readFileSync(verrou, 'utf8');
  } catch {
    // Pas de verrou : personne ne tient l'atelier.
  }
  const v = jugerVerrou(brut, Date.now(), pidVivant);
  if (!v.libre) {
    console.error(refusExclusivite(v.pid));
    process.exit(2);
  }
  writeFileSync(verrou, contenuVerrou(process.pid, Date.now()));
  // Retiré quoi qu'il arrive — y compris sur `process.exit()`, que ce script
  // appelle à chaque issue. `unlinkSync` peut échouer si quelqu'un l'a déjà
  // supprimé : ce n'est pas une raison de faire échouer la loupe.
  process.on('exit', () => {
    try {
      unlinkSync(verrou);
    } catch {
      /* déjà parti */
    }
  });

  const toutes = candidates();
  if (toutes.length === 0) {
    console.log('LOUPE : aucune ligne mutable ajoutée par cette branche.');
    console.log('        (rien à conclure — ce n’est PAS un feu vert.)');
    process.exit(0);
  }

  // Échantillon RÉGULIER plutôt qu'aléatoire : deux passages sur le même diff
  // doivent regarder les mêmes lignes, sinon un verdict n'est pas reproductible.
  const pas = Math.max(1, Math.ceil(toutes.length / plafond));
  const retenues = toutes.filter((_, i) => i % pas === 0).slice(0, plafond);

  console.log(
    `LOUPE : ${toutes.length} mutation(s) possible(s) sur le diff, ${retenues.length} examinée(s).`,
  );
  if (retenues.length < toutes.length) {
    console.log(
      `        ${toutes.length - retenues.length} laissée(s) de côté — la loupe échantillonne, elle ne balaie pas.`,
    );
  }
  console.log('');

  const survivants = [];
  const consignes = [];
  const marquesFausses = [];
  for (const m of retenues) {
    const chemin = RACINE + m.fichier;
    const original = readFileSync(chemin, 'utf8');
    const marquee = marqueeEquivalente(original, m.avant, m.quoi, m.fichier);
    writeFileSync(chemin, original.replace(m.avant, m.apres));
    let mord;
    try {
      mord = suiteRougit();
    } finally {
      writeFileSync(chemin, original);
    }
    // Quatre issues, et une seule est un problème NEUF. La marque ne dispense
    // JAMAIS de jouer la mutation : elle ne dispense que de rejuger.
    let etiquette;
    if (mord && marquee) {
      // Un test distingue une ligne réputée indistinguable. La consignation est
      // fausse, ou le code a bougé sous elle — dans les deux cas il faut aller
      // voir, et c'est le seul cas que la marque peut créer.
      etiquette = '⚠ MARQUE FAUSSE';
      marquesFausses.push(m);
    } else if (mord) {
      etiquette = '  ✔ défendue';
    } else if (marquee) {
      etiquette = '  ✔ équivalent consigné';
      consignes.push(m);
    } else {
      etiquette = '🔴 SANS TEST';
      survivants.push(m);
    }
    console.log(`${etiquette} · ${m.fichier} · ${m.quoi}`);
    console.log(`             ${m.avant.trim().slice(0, 100)}`);
  }

  console.log('');
  // DIT, jamais tu : une équivalence honorée en silence se lirait comme « tout
  // est couvert », et c'est exactement ce que l'en-tête de ce fichier interdit.
  if (consignes.length > 0) {
    console.log(
      `${consignes.length} mutation(s) survivante(s) portaient une équivalence CONSIGNÉE au-dessus d'elles.`,
    );
    console.log(
      '   Elles ont été jouées quand même — la marque épargne le jugement, pas la mesure.',
    );
    console.log('');
  }

  if (marquesFausses.length > 0) {
    console.log('════ UNE MARQUE D’ÉQUIVALENCE EST FAUSSE ════');
    console.log('Un test DISTINGUE une ligne réputée indistinguable : la consignation');
    console.log('ment, ou le code a changé sous elle. Les deux se corrigent sur place.');
    for (const f of marquesFausses) {
      console.log(`· ${f.fichier} — ${f.quoi}`);
      console.log(`    ${f.avant.trim().slice(0, 120)}`);
    }
    console.log('');
    process.exit(1);
  }

  if (survivants.length === 0) {
    console.log('════ LA LOUPE NE VOIT RIEN DE NU ════');
    console.log('Chaque ligne examinée est défendue par au moins un test.');
    process.exit(0);
  }

  console.log('════ CODE NEUF QUE RIEN NE DÉFEND ════');
  for (const s of survivants) {
    console.log(`· ${s.fichier} — ${s.quoi}`);
    console.log(`    ${s.avant.trim().slice(0, 120)}`);
  }
  console.log('');
  console.log('Deux issues, et il faut CHOISIR, pas ignorer :');
  console.log('  · écrire le test qui manque ; ou');
  console.log('  · constater que le mutant est ÉQUIVALENT — et le dire par écrit,');
  console.log('    parce qu’un test qui ne peut pas rougir n’est pas de la couverture.');
  process.exit(1);
}
