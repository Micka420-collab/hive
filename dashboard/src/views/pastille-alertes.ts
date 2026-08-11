// LA PASTILLE D'ALERTES DE LA NAVIGATION — ce qu'elle dit, et ce qu'elle tait.
//
// ─── LE MANQUE QU'ELLE COMBLE ────────────────────────────────────────────────
//
// Les alertes d'une personne (quota au bord, période échue, données sur le
// point d'être effacées) vivent dans « Mon espace ». Tant qu'on ne l'ouvre pas,
// une alerte CRITIQUE reste invisible — y compris `effacement_imminent`, qui ne
// se rattrape pas après coup.
//
// La pastille les annonce depuis n'importe quel écran, sans rien interrompre.
//
// ─── POURQUOI CE MODULE EST PUR ──────────────────────────────────────────────
//
// La décision « faut-il allumer, et de quelle couleur » tient en trois cas et
// deux pièges (voir plus bas). Laissée dans le JSX, elle serait hors d'atteinte
// du banc — et c'est justement le genre de règle qui se casse en silence.
//
// ─── CE QU'ELLE NE FAIT PAS : RECLASSER ──────────────────────────────────────
//
// Elle ne calcule AUCUNE gravité. Le serveur rend `graviteMax` déjà décidé
// (`src/orchestrator/tableau.ts`), parce que le classement des alertes est une
// décision, et qu'une seconde décision recopiée dans l'écran divergerait de la
// première. C'est l'invariant de `MonEspace.tsx` : « l'écran ne reclasse RIEN ».
// Ce module ne fait que TRANSPORTER ce verdict jusqu'à la pastille.

// Le type vient de SA SOURCE, pas du ré-export de `api.ts` : passer par ce
// dernier tirerait tout le module d'API dans le graphe du typecheck racine,
// qui n'a pas les mêmes règles de résolution que celui du tableau de bord.
import type { Gravite } from '../../../src/orchestrator/tableau.js';

/** Ce qu'il faut pour peindre la pastille — ou `null` si elle reste éteinte. */
export interface Pastille {
  /** Le nombre d'alertes, tel quel. L'affichage plafonne, pas ce compte. */
  total: number;
  /** La plus haute gravité, telle que le SERVEUR l'a décidée. */
  gravite: Gravite;
}

/** Ce que la pastille lit — un sous-ensemble volontairement minuscule. */
export interface SourceAlertes {
  alertes: readonly unknown[];
  graviteMax: Gravite | null;
}

/**
 * Décide si la pastille s'allume, et avec quoi.
 *
 * Les deux pièges qu'elle évite :
 *
 *  1. **`null` n'est pas « info ».** Un tableau sans aucune alerte ne doit
 *     allumer RIEN. Le confondre avec la gravité la plus basse ferait porter
 *     une pastille bleue à une ruche parfaitement saine — et une pastille qui
 *     est toujours là n'attire plus l'œil quand elle compte vraiment.
 *  2. **Un serveur ancien ne dit pas `graviteMax`.** Le contrat porte un
 *     `version`, et un client peut parler à une ruche d'avant ce champ. Sans
 *     gravité, on ne peut pas peindre — on n'invente pas une couleur par
 *     défaut, on n'allume pas. Mieux vaut une pastille manquante qu'une
 *     pastille qui ment sur l'urgence.
 */
export function pastilleDesAlertes(tableau: SourceAlertes | null): Pastille | null {
  if (tableau === null) return null;
  const total = tableau.alertes.length;
  if (total === 0 || tableau.graviteMax === null) return null;
  return { total, gravite: tableau.graviteMax };
}

/** Le compte affiché. Au-delà de 99, on dit « beaucoup » sans mentir. */
export function compteAffiche(total: number): string {
  return total > 99 ? '99+' : String(total);
}

/**
 * Ce qu'un lecteur d'écran doit ENTENDRE.
 *
 * Le badge voisin (les productions à revoir) ne porte qu'un `title`, que les
 * lecteurs d'écran ne restituent pas de façon fiable — on ne recopie pas cette
 * faiblesse. Le nombre nu (« 3 ») ne dirait rien non plus : c'est la phrase
 * entière qui informe, et elle nomme la gravité EN TOUTES LETTRES plutôt que de
 * la laisser à la couleur (§ 9 vicies : un état qui ne tient qu'à un pixel est
 * un état que personne ne peut vérifier — ni un banc, ni un lecteur d'écran).
 */
export function phraseAlertes(p: Pastille, fr: boolean): string {
  // Un `switch` plutôt qu'une table indexée : sous `noUncheckedIndexedAccess`,
  // toute lecture par clé rend `| undefined`, et une gravité « peut-être
  // absente » n'a aucun sens ici — les trois cas sont exhaustifs, et le
  // compilateur le vérifie.
  const nom = ((): [string, string] => {
    switch (p.gravite) {
      case 'critique':
        return ['critique', 'critical'];
      case 'attention':
        return ['à surveiller', 'needs attention'];
      case 'info':
        return ['pour information', 'informational'];
      default: {
        // Le jour où une quatrième gravité naît, CETTE ligne ne compile plus —
        // c'est ainsi qu'on apprend qu'il manque un mot, plutôt qu'en lisant
        // une pastille muette.
        const jamais: never = p.gravite;
        return jamais;
      }
    }
  })();
  const [nomFr, nomEn] = nom;
  if (fr) {
    return p.total === 1 ? `1 alerte, ${nomFr}` : `${p.total} alertes, la plus grave : ${nomFr}`;
  }
  return p.total === 1 ? `1 alert, ${nomEn}` : `${p.total} alerts, most severe: ${nomEn}`;
}
