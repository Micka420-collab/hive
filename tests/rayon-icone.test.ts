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
import { icone } from '../dashboard/src/views/rayon-affichage.js';
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
    // de fichier et recevrait 📄. Fermé et ouvert se distinguent, mais tous deux
    // restent des dossiers.
    expect(icone(dossier('src'), false), 'dossier fermé').toBe('📁');
    expect(icone(dossier('src'), true), 'dossier déplié').toBe('📂');
  });

  it('UN FICHIER porte l’icône de son type — jamais celle d’un dossier', () => {
    // Muté en `!==`, un fichier passerait pour un dossier et recevrait 📁,
    // perdant l'icône que son extension lui vaut.
    expect(icone(fichier('index.ts'), false), 'un .ts est un parchemin').toBe('📜');
    expect(icone(fichier('README.md'), false), 'un .md est une note').toBe('📝');
    expect(icone(fichier('LICENSE'), false), 'sans extension, un fichier quelconque').toBe('📄');
  });
});
