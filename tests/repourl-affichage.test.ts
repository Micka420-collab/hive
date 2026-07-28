// UN `repoUrl` NE S'AFFICHE JAMAIS BRUT — et cette garde existe parce que
// l'oubli s'est produit TROIS FOIS.
//
// ─── LA MÊME FUITE, TROIS ENDROITS, TROIS DÉCOUVERTES SÉPARÉES ───────────────
//
// La façon dont on donne ses identifiants à `git clone` sans configuration,
// c'est de les écrire dans l'URL :
//
//     https://user:ghp_xxxxxxxxxxxx@github.com/org/depot.git
//
// Rien ne l'interdit — `isValidRepoUrl` accepte tout ce qui commence par
// `https://`, et le champ « dépôt » du formulaire de création l'accepte tel
// quel. Un `repoUrl` est donc un porteur de secret POTENTIEL, toujours.
//
//   1. `GET /api/projects/public` renvoyait la ligne entière : le jeton partait
//      à quiconque savait faire un `curl`. Fermé par `sansIdentifiants`.
//   2. La vue Rayon l'affichait brut. Trouvé en ouvrant la page dans un vrai
//      navigateur — aucun test unitaire ne pouvait le voir.
//   3. La carte projet l'affichait brut, en texte ET en `title`, juste à côté
//      de la vue qui, elle, le lavait. Trouvé en cherchant des trajets non
//      testés, deux lots plus tard.
//
// Le correctif a donc été écrit deux fois avant d'être complet. Ce n'est pas un
// défaut d'attention : c'est qu'aucun test ne portait sur la RÈGLE, seulement
// sur chacun de ses endroits. Ce fichier porte la règle.
//
// ─── CE QUE CE TEST NE PEUT PAS FAIRE ────────────────────────────────────────
//
// Il lit du texte, pas un rendu. Il attrape « `repoUrl` apparaît dans du JSX
// sans passer par la fonction » — ce qui est exactement la forme des trois
// oublis — et il n'attraperait pas une fuite passée par une variable
// intermédiaire. Une garde imparfaite qui rougit sur le geste réel vaut mieux
// qu'une garde parfaite qu'on n'écrit pas.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sansIdentifiants } from '../src/shared/projet-public.js';

const VUES = fileURLToPath(new URL('../dashboard/src/', import.meta.url));

/** Les `.tsx` du tableau de bord, à la main (`globSync` est Node 22+). */
function fichiers(dossier = '', acc: string[] = []): string[] {
  for (const e of readdirSync(VUES + dossier, { withFileTypes: true })) {
    const rel = dossier === '' ? e.name : `${dossier}/${e.name}`;
    if (e.isDirectory()) fichiers(rel, acc);
    else if (rel.endsWith('.tsx')) acc.push(rel);
  }
  return acc;
}

/** Le code sans les commentaires : ils PARLENT de `repoUrl`, ils ne l'affichent pas. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\*).*$/gm, '');
}

describe('la règle, pas ses endroits', () => {
  it('AUCUNE VUE N’AFFICHE UN `repoUrl` SANS LE LAVER', () => {
    for (const rel of fichiers()) {
      const code = sansCommentaires(readFileSync(VUES + rel, 'utf8'));
      // CE QU'ON CHERCHE : une LECTURE, `quelquechose.repoUrl` — c'est la forme
      // exacte des trois oublis (`project.repoUrl`, `projet?.repoUrl`). Un
      // `repoUrl` nu est l'état d'un champ de saisie, c'est-à-dire le texte que
      // la personne vient d'écrire : le laver n'aurait aucun sens. Et
      // `repoUrl:` en tête est une clé d'objet qu'on ENVOIE, pas qu'on affiche.
      const affichages = [...code.matchAll(/[{=]([^{}]*[A-Za-z0-9_]\??\.repoUrl[^{}]*)\}/g)]
        .map((m) => m[1]!)
        .filter((a) => !/\brepoUrl\s*:/.test(a));
      for (const a of affichages) {
        expect(
          a.includes('sansIdentifiants') || a.includes('null'),
          `${rel} affiche un repoUrl sans sansIdentifiants() : « ${a.trim()} ». ` +
            "Un repoUrl peut porter un jeton — c'est la troisième fois que cet oubli arrive, " +
            "relisez l'en-tête de ce fichier.",
        ).toBe(true);
      }
    }
  });

  it('méta-test : on trouve bien des affichages à juger', () => {
    // Sans ça, un renommage du champ rendrait ce fichier vert et vide de sens.
    const total = fichiers().filter((rel) =>
      /[A-Za-z0-9_]\??\.repoUrl/.test(sansCommentaires(readFileSync(VUES + rel, 'utf8'))),
    );
    expect(total.length).toBeGreaterThan(1);
  });
});

describe('ce que `sansIdentifiants` retire vraiment', () => {
  it('LE JETON DISPARAÎT, LE DÉPÔT RESTE LISIBLE', () => {
    // Une fonction qui rendrait `null` sur tout serait « sûre » et rendrait la
    // carte projet inutile : on veut savoir DE QUEL dépôt il s'agit.
    const lave = sansIdentifiants('https://user:ghp_abcdefghijklmnop@github.com/org/depot.git');
    expect(lave).not.toContain('ghp_');
    expect(lave).not.toContain('user:');
    expect(lave).toContain('github.com/org/depot.git');
  });

  it('une URL sans identifiant traverse intacte', () => {
    const url = 'https://github.com/org/depot.git';
    expect(sansIdentifiants(url)).toBe(url);
  });

  it('une URL illisible ne devient pas un affichage trompeur', () => {
    // Rendre la chaîne telle quelle « parce qu'on n'a pas su la parser » serait
    // le pire des deux mondes : le cas non géré est exactement celui qu'un
    // attaquant fabriquerait.
    expect(sansIdentifiants('pas une url du tout')).toBe(null);
  });
});
