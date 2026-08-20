// @vitest-environment happy-dom
//
// L'ICÔNE DU RAYON — un dossier n'est pas un fichier « .dossier ».
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante mesurée nue au dernier point de sortie : `e.type === 'dossier'`
// dans `Rayon.tsx`, jamais éprouvée. La fonction `icone` départage un dossier
// AVANT de regarder l'extension du nom. Mutée en `!==`, le départage s'inverse :
//
//   · un DOSSIER tombe dans la logique d'extension — `src` n'a pas d'extension,
//     il reçoit donc l'icône « fichier quelconque » (📄) au lieu de 📁 ;
//   · un FICHIER passe pour un dossier et reçoit 📁 au lieu de son icône de
//     type (un `.ts` perd son 📜).
//
// Le rayon est l'écran « lisible à 3 mètres » : confondre dossier et fichier au
// premier coup d'œil, c'est lui retirer sa seule raison d'être. Icône cosmétique,
// mais un banc qui la garde ne coûte rien puisque la fonction est déjà pure —
// sortie du rendu (§ 2 quaterdecies) exprès pour s'éprouver au retour près.

import { describe, expect, it } from 'vitest';
import { icone, taille } from '../dashboard/src/views/rayon-affichage.js';
import type { Entree } from '../src/shared/rayon.js';

function dossier(nom: string): Entree {
  return { chemin: nom, nom, type: 'dossier', taille: 0 };
}
function fichier(nom: string): Entree {
  return { chemin: nom, nom, type: 'fichier', taille: 42 };
}

describe('l’icône du rayon départage le dossier AVANT l’extension', () => {
  it('UN DOSSIER porte l’icône dossier — ouvert ou fermé, jamais celle d’un fichier', () => {
    // `src` n'a pas d'extension : muté en `!==`, il glisserait dans la logique
    // de fichier et recevrait ·. Fermé et ouvert se distinguent, mais tous deux
    // restent des dossiers.
    expect(icone(dossier('src'), false), 'dossier fermé').toBe('▸');
    expect(icone(dossier('src'), true), 'dossier déplié').toBe('▾');
  });

  it('UN FICHIER porte l’icône de son type — jamais celle d’un dossier', () => {
    // Muté en `!==`, un fichier passerait pour un dossier et recevrait ▸,
    // perdant l'icône que son extension lui vaut.
    expect(icone(fichier('index.ts'), false), 'un .ts est du code').toBe('⟨⟩');
    expect(icone(fichier('README.md'), false), 'un .md est une note').toBe('¶');
    expect(icone(fichier('LICENSE'), false), 'sans extension, un fichier quelconque').toBe('·');
  });
});

// ─── LA TAILLE LISIBLE, ET LA BORNE QUE PERSONNE NE DÉFENDAIT ────────────────
//
// `taille` était une fonction PURE posée dans `Rayon.tsx`, sans `export` — donc
// hors d'atteinte de tout banc qui ne monte pas la vue. Un balayage échantillonné
// de `dashboard/src/views` (base épinglée `f0fc005`) l'a rendue nue.

describe('taille — dire une taille comme un humain l’écrirait', () => {
  const fr = (f: string) => f;
  const en = (_f: string, e: string) => e;

  it('LE CAS QUI TRANCHE : 1024 octets font UN kilo, pas « 1024 o »', () => {
    // `octets < 1024` muté en `<=` fait afficher « 1024 o » — le seul point de
    // tout le barème où l'unité saute d'un cran. Ce n'est pas faux
    // arithmétiquement ; c'est faux au sens de ce que la fonction promet.
    // Personne n'écrit « 1024 o ».
    expect(taille(1024, fr)).toBe('1.0 ko');
    expect(taille(1023, fr), 'juste en dessous, on reste en octets').toBe('1023 o');
  });

  it('les petites tailles restent en octets, sans décimale inutile', () => {
    expect(taille(0, fr)).toBe('0 o');
    expect(taille(1, fr)).toBe('1 o');
    expect(taille(999, fr)).toBe('999 o');
  });

  it('la SECONDE borne est la même histoire, un cran plus haut', () => {
    expect(taille(1024 * 1024 - 1, fr)).toContain('ko');
    expect(taille(1024 * 1024, fr)).toBe('1.0 Mo');
  });

  it('la décimale distingue ce qu’un arrondi entier écraserait', () => {
    // `toFixed(1)` et non `Math.round` : « 1,5 ko » et « 1,4 ko » se
    // distinguent, là où l'arrondi les mettrait tous deux sur « 1 ko ».
    expect(taille(1536, fr)).toBe('1.5 ko');
    expect(taille(1434, fr)).toBe('1.4 ko');
  });

  it('les trois unités existent dans les deux langues', () => {
    expect(taille(10, en)).toBe('10 B');
    expect(taille(2048, en)).toBe('2.0 kB');
    expect(taille(5 * 1024 * 1024, en)).toBe('5.0 MB');
  });
});
