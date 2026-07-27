// Garde de la coquille du dashboard.
//
// Mission Control est du React typé et testé, mais sa MISE EN PAGE tient dans
// une feuille de style que rien ne vérifie : ni `tsc`, ni ESLint, ni Vitest ne
// lisent une cascade CSS. Une règle qui en écrase silencieusement une autre
// passe donc toute la CI en vert et ne se voit qu'à l'écran.
//
// C'est exactement ce qui était arrivé : l'élément racine porte DEUX classes,
// `app` et `mc-app`. La première déclare `flex-direction: column` ; la seconde
// déclarait `display: flex` sans jamais reparler de la direction. Comme c'était
// la seule déclaration de cette propriété, elle l'emportait : la barre de
// navigation, haute de 100 vh, se posait AU-DESSUS du contenu, et il fallait
// faire défiler un écran entier de vide avant d'apercevoir la moindre vue.
//
// Ce fichier ne teste pas un comportement : il verrouille les quelques
// propriétés de la coquille qu'on ne peut pas se permettre de reperdre.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(new URL('../dashboard/src/styles.css', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../dashboard/src/App.tsx', import.meta.url), 'utf8');

/** Corps d'une règle CSS de premier niveau, commentaires retirés. */
function regle(selecteur: string): string {
  const i = CSS.indexOf(`\n${selecteur} {`);
  expect(i, `règle « ${selecteur} » introuvable`).toBeGreaterThanOrEqual(0);
  const debut = i + selecteur.length + 3;
  const fin = CSS.indexOf('\n}', debut);
  return CSS.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('coquille du dashboard', () => {
  it('la racine porte BIEN les deux classes qui se disputent la cascade', () => {
    // Si un jour la coquille ne portait plus « app », le test suivant
    // continuerait de passer en gardant une propriété devenue inutile — et le
    // commentaire qui l'explique deviendrait un mensonge.
    expect(APP).toContain('className="app mc-app"');
  });

  it('LA BARRE EST À CÔTÉ DU CONTENU, PAS AU-DESSUS', () => {
    // `.app` déclare `column`. Sans déclaration concurrente dans `.mc-app`,
    // c'est elle qui s'applique, et toute l'application se replie.
    expect(regle('.app')).toMatch(/flex-direction:\s*column/);
    expect(regle('.mc-app')).toMatch(/flex-direction:\s*row/);
  });

  it('la barre reste étroite et à demeure', () => {
    const barre = regle('.mc-sidebar');
    expect(barre).toMatch(/width:\s*84px/);
    expect(barre).toMatch(/position:\s*sticky/);
  });
});
