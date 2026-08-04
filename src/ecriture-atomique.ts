/**
 * ÉCRIRE UN FICHIER SANS JAMAIS EN LAISSER UN À MOITIÉ.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `src/installer-main.ts` finit par `main().catch(…)` : il s'exécute à
 * l'import, donc aucun banc ne peut le charger (§ 2.8 du carnet), et la mesure
 * de couverture l'annonçait à 0 %. Il portait DEUX écrivains du même fichier —
 * le `.env`, celui qui contient `HIVE_TOKEN` et `HIVE_JWT_SECRET` :
 *
 *   · le chemin principal écrivait par temporaire + `rename` ;
 *   · le chemin de l'ASSISTANT écrivait par un `writeFileSync` direct.
 *
 * Le second est plus faible que le premier sur deux points, et c'est le chemin
 * INTERACTIF — donc celui où l'on appuie sur `^C`.
 *
 * ─── CE QUE LA VOIE DIRECTE PERDAIT ──────────────────────────────────────────
 *
 *   1. L'ATOMICITÉ. `rename` sur un même système de fichiers est atomique : le
 *      lecteur voit l'ancien fichier ou le nouveau, jamais un `.env` coupé en
 *      deux. Sans elle, un `^C` au mauvais moment, ou un disque plein, laisse
 *      une configuration TRONQUÉE — un jeton coupé en son milieu, une ruche
 *      qui refuse de démarrer, et aucune trace de la cause.
 *
 *   2. LES DROITS. C'est le point qu'on ne voit pas, et il a été MESURÉ :
 *
 *          writeFileSync('a.env', …, { mode: 0o600 })   // fichier existant
 *          → droits inchangés : 644
 *
 *      `mode` n'est honoré qu'à la CRÉATION. Un `.env` déjà là en 644 — ce que
 *      produit exactement le `cp .env.example .env` que le docteur conseille —
 *      reste en 644 après l'écriture, avec les secrets dedans. La voie
 *      atomique, elle, crée un fichier NEUF en 0600 puis le renomme : le mode
 *      est toujours appliqué, quel que soit l'état antérieur.
 *
 * Écrire un secret n'a donc qu'une seule bonne façon dans ce dépôt, et elle
 * vit ici pour être éprouvée — et pour qu'un troisième écrivain ne puisse pas
 * naître plus faible que les deux autres.
 */

import { renameSync, unlinkSync, writeFileSync } from 'node:fs';

/** Les droits d'un fichier qui contient un secret : lisible par son seul propriétaire. */
export const MODE_SECRET = 0o600;

/**
 * Écrit `contenu` dans `chemin`, en une seule fois et avec les droits demandés.
 *
 * Le temporaire porte le pid : deux processus qui écriraient le même fichier au
 * même instant ne se marcheraient pas dessus au milieu du geste. Et il est
 * retiré même quand ça tourne mal — un `.tmp` orphelin à côté d'un `.env` est
 * une énigme laissée à quelqu'un d'autre.
 *
 * L'erreur d'écriture est RELANCÉE : ici, contrairement à la clé d'un nœud,
 * échouer en silence donnerait une ruche qu'on croit configurée et qui ne l'est
 * pas. L'appelant doit pouvoir le dire.
 */
export function ecrireAtomique(chemin: string, contenu: string, mode = MODE_SECRET): void {
  const temporaire = `${chemin}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaire, contenu, { mode });
    renameSync(temporaire, chemin);
  } catch (err) {
    try {
      unlinkSync(temporaire);
    } catch {
      /* le temporaire n'existait pas : rien à nettoyer */
    }
    throw err;
  }
}
