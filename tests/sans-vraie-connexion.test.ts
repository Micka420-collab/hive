// AUCUN BANC DE RENDU N'OUVRE DE VRAIE CONNEXION.
//
// ─── POURQUOI CETTE GARDE, ET PAS UN TREIZIÈME COMMENTAIRE ──────────────────
//
// Cinq fichiers du dépôt portaient déjà un commentaire sur ce piège, chacun
// écrit après s'y être fait prendre. Un sixième est arrivé quand même, dans un
// fichier NEUF qui ne les lisait pas — 32 connexions vers 127.0.0.1:3000 par
// lancement. Le relevé complet, mesuré banc par banc, en comptait 342 sur
// douze fichiers.
//
// C'est la même leçon que le § 6.1 quater : un avertissement écrit dans les
// fichiers DÉJÀ corrigés ne protège que ceux-là. Le prochain fichier ne sait
// pas qu'il existe. Seule une garde qui BALAIE l'arbre le protège.
//
// ─── CE QUE CETTE GARDE PEUT, ET CE QU'ELLE NE PEUT PAS ─────────────────────
//
// Elle lit la SOURCE. Elle ne compte pas les connexions — pour ça il faudrait
// lancer chaque banc, et cette garde tournerait alors plus longtemps que la
// suite qu'elle protège.
//
// Elle vérifie donc la condition qui les empêche : un banc qui MONTE un
// composant du tableau de bord doit couper le réseau. C'est une garde de
// forme, et son honnêteté tient à ce qu'elle le dise.
//
// La mesure réelle reste à la main, et elle est simple :
//     npx vitest run <banc> 2>&1 | grep -c ECONNREFUSED   →   0

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TESTS = fileURLToPath(new URL('.', import.meta.url));

/**
 * Les bancs qui MONTENT un composant : ceux qui rendent du React depuis
 * `dashboard/src`. Un banc qui n'importe qu'un module pur n'a pas de réseau à
 * couper, et l'exiger de lui serait du bruit.
 */
function bancsQuiMontent(): { nom: string; source: string }[] {
  return readdirSync(TESTS)
    .filter((f) => f.endsWith('.test.tsx'))
    .map((nom) => ({ nom, source: readFileSync(path.join(TESTS, nom), 'utf8') }))
    .filter((b) => /createRoot|render\(/.test(b.source) && b.source.includes('dashboard/src/'));
}

describe('aucun banc de rendu n’ouvre de vraie connexion', () => {
  const bancs = bancsQuiMontent();

  it('LE BALAYAGE REGARDE VRAIMENT QUELQUE CHOSE', () => {
    // Le § 1.2 : une garde qui boucle sur zéro élément PASSE, en n'ayant rien
    // regardé. C'est le prix d'entrée de l'assertion qui suit.
    expect(bancs.length, 'aucun banc de rendu trouvé — le filtre est cassé').toBeGreaterThan(20);
  });

  it('CHACUN COUPE LE RÉSEAU, OU BOUCHONNE L’API QU’IL APPELLE', () => {
    // Deux façons acceptables, et une seule inacceptable — ne rien faire :
    //
    //   · `couperLeReseau()` — la porte du bas, qui couvre les 115 fonctions
    //     d'`api.ts` et celles qu'on écrira demain ;
    //   · `vi.mock('../dashboard/src/api')` — la porte du haut, quand le banc a
    //     besoin de valeurs de retour précises. Elle ne couvre que ce qu'elle
    //     nomme : c'est ainsi qu'un hook oublié (`useBaptemes` → `fetchBaptemes`)
    //     a fait passer 16 connexions sous le nez d'un bouchon qui paraissait
    //     complet.
    //
    // Les deux ensemble valent mieux ; l'une des deux suffit à ne pas ouvrir de
    // socket par accident.
    const nus = bancs
      .filter(
        (b) =>
          // L'APPEL, pas l'import. La contre-épreuve a ôté `couperLeReseau();`
          // d'un banc en laissant sa ligne d'import : la garde restait verte,
          // et le banc était pourtant nu. Un `includes('couperLeReseau')` se
          // satisfaisait d'un nom mentionné quelque part.
          !/couperLeReseau\(\)/.test(b.source) &&
          !b.source.includes("vi.mock('../dashboard/src/api'") &&
          !/globalThis\.fetch\s*=/.test(b.source),
      )
      .map((b) => b.nom);
    expect(
      nus,
      'banc(s) de rendu sans filet réseau : ajoutez `couperLeReseau()` dans le ' +
        '`beforeEach` (tests/aide/sans-reseau.ts), puis VÉRIFIEZ par ' +
        '`npx vitest run <banc> 2>&1 | grep -c ECONNREFUSED` → 0',
    ).toEqual([]);
  });

  it('LE DÉTECTEUR MORD — éprouvé sur les formes qu’il doit voir passer', () => {
    // Une garde dont on n'a jamais vu le filtre rougir n'est pas une garde.
    const monte = (s: string) => /createRoot|render\(/.test(s) && s.includes('dashboard/src/');
    expect(monte("import { createRoot } from 'react-dom/client';\n'../dashboard/src/App'")).toBe(
      true,
    );
    // Un banc de module pur : pas de rendu, donc rien à exiger de lui.
    expect(monte("import { juger } from '../src/shared/connexion-agent.js';")).toBe(false);
    // Un rendu qui ne touche pas au tableau de bord non plus.
    expect(monte("import { createRoot } from 'react-dom/client';")).toBe(false);
  });
});
