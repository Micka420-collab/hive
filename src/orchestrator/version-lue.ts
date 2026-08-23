// Lire le commit de la ruche depuis `.git`, sans lancer `git`.
//
// ─── POURQUOI PAS `git rev-parse` ────────────────────────────────────────────
//
// Le hub ne lance `git` nulle part aujourd'hui, et lui donner cette capacité
// pour répondre à « quelle version fais-tu tourner ? » serait cher payé : un
// binaire de plus à trouver sur le PATH, un processus de plus à borner, une
// surface de plus. Les deux fichiers qu'on lit ici sont du TEXTE, et la
// réponse y est écrite.
//
// ─── CE QUI PEUT ÉCHOUER, ET CE QU'ON EN FAIT ───────────────────────────────
//
// Tout. Pas de `.git` (archive, image de conteneur), `HEAD` illisible,
// référence rangée dans `packed-refs` après un `git gc`, droits refusés. Dans
// TOUS ces cas la réponse est la même : `null`, c'est-à-dire « je ne sais
// pas ». Jamais une exception qui ferait tomber la route qui l'appelle, jamais
// un commit deviné.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { VersionRuche } from '../shared/version-ruche.js';

/** Le contenu d'un fichier, ou `null` — jamais d'exception vers l'appelant. */
function lire(chemin: string): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch {
    return null;
  }
}

/** Un sha complet, ou `null`. La forme est VÉRIFIÉE, pas supposée. */
function sha(brut: string | null): string | null {
  if (brut === null) return null;
  const t = brut.trim();
  return /^[0-9a-f]{40}$/i.test(t) ? t : null;
}

/**
 * La référence cherchée dans `packed-refs`.
 *
 * Après un `git gc`, `refs/heads/main` n'est plus un fichier : il est rangé
 * dans ce catalogue, une ligne par référence. Sans ce repli, une ruche
 * parfaitement saine répondrait « je ne sais pas » du jour où git a fait son
 * ménage — et personne n'aurait rien changé.
 */
function depuisPackedRefs(dossierGit: string, ref: string): string | null {
  const contenu = lire(path.join(dossierGit, 'packed-refs'));
  if (contenu === null) return null;
  for (const ligne of contenu.split('\n')) {
    if (ligne.startsWith('#')) continue;
    // Les lignes PELÉES (`^<sha>`, l'objet visé par une étiquette annotée)
    // n'ont pas d'espace : la garde ci-dessous les écarte déjà.
    //
    // J'avais ajouté `|| ligne.startsWith('^')` en plus. La contre-épreuve l'a
    // ôté sans que rien ne rougisse — et pour cause : aucune ligne pelée ne
    // peut atteindre ce test-là. La règle du dépôt sur un survivant est de
    // TRANCHER, pas de le défendre par un banc qui passerait de toute façon.
    const espace = ligne.indexOf(' ');
    if (espace < 0) continue;
    if (ligne.slice(espace + 1).trim() === ref) return sha(ligne.slice(0, espace));
  }
  return null;
}

/**
 * Ce que cette ruche fait tourner.
 *
 * `declaree` vient de l'appelant (le `package.json` chargé au démarrage) : ce
 * module ne lit pas le paquet, pour rester une seule question à la fois.
 */
export function lireVersionRuche(racine: string, declaree: string): VersionRuche {
  const dossierGit = path.join(racine, '.git');
  const head = lire(path.join(dossierGit, 'HEAD'));
  if (head === null) return { commit: null, branche: null, declaree };

  const t = head.trim();
  // Tête DÉTACHÉE : `HEAD` porte directement le sha, il n'y a pas de branche.
  // C'est le cas d'un déploiement épinglé sur un commit — légitime, et il ne
  // faut pas lui inventer un nom de branche.
  const direct = sha(t);
  if (direct !== null) return { commit: direct, branche: null, declaree };

  if (!t.startsWith('ref: ')) return { commit: null, branche: null, declaree };
  const ref = t.slice(5).trim();
  const branche = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null;

  const lache = sha(lire(path.join(dossierGit, ...ref.split('/'))));
  if (lache !== null) return { commit: lache, branche, declaree };

  const range = depuisPackedRefs(dossierGit, ref);
  return { commit: range, branche: range !== null ? branche : null, declaree };
}
