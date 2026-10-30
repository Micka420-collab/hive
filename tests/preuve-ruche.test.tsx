// @vitest-environment happy-dom
//
// LA CARTE « CE QUE LA RUCHE PROUVE » DIT DES FRACTIONS, PAS DES SCORES.
//
// Ce qu'on prouve : chaque mesure est « n / total » avec sa part en pour-cent,
// la phrase sous le chiffre nomme ce qui est compté, un journal élagué est
// annoncé en tête, une ruche sans production dit d'où la preuve commence, et
// une lecture en échec se montre sans effacer le reste de l'écran.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Preuve } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import { part, PreuveRuche } from '../dashboard/src/PreuveRuche';
import type { Poll } from '../dashboard/src/views/shared';

const PREUVE: Preuve = {
  fenetre: { depuis: 1_000, evenements: 12, elague: false },
  productions: {
    rendues: 8,
    reluesParAutreFamille: 6,
    reluesParMemeFamille: 1,
    contestees: 2,
    reprisesApresRelecture: 1,
    relectureImpossible: 1,
  },
  bac: { validees: 7, toutPasse: 5, unEchec: 2, portes: 3 },
  cout: { declarees: 9, inconnues: 3, totalUsd: 1.2345 },
  familles: ['Claude Code', 'Codex'],
  decisionsHumaines: 2,
  noeuds: { total: 3, enLigne: 2, isoles: 2, conteneur: 1 },
};

const sondage = (data: Preuve | null, error: string | null = null): Poll<Preuve> => ({
  data,
  error,
  refresh: () => {},
  relance: false,
  echecA: error ? 1 : null,
});

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;

afterEach(() => {
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function rendre(p: Poll<Preuve>, lang: 'fr' | 'en' = 'fr'): Promise<HTMLElement> {
  setLang(lang);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<PreuveRuche preuve={p} />));
  return conteneur;
}

describe('part()', () => {
  it('rend « n / total » et la part arrondie ; sans dénominateur, le nombre seul', () => {
    expect(part(6, 8)).toEqual({ texte: '6 / 8', pct: 75 });
    expect(part(1, 3)).toEqual({ texte: '1 / 3', pct: 33 });
    expect(part(0, 0)).toEqual({ texte: '0', pct: null });
  });
});

describe('la carte Preuve', () => {
  it('quatre mesures, en fractions, avec la phrase qui dit ce qui est compté', async () => {
    const dom = await rendre(sondage(PREUVE));
    const relecture = dom.querySelector('[data-testid="preuve-relecture"]')!;
    expect(relecture.querySelector('strong')?.textContent).toBe('6 / 8');
    expect(relecture.querySelector('.preuve-pct')?.textContent).toBe('75 %');
    expect(relecture.textContent).toMatch(/relues par une autre famille/);
    expect(relecture.textContent).toMatch(/2 contestée/);
    expect(relecture.textContent).toMatch(/1 reprise/);
    expect(relecture.textContent).toMatch(/familles : Claude Code, Codex/);

    const bac = dom.querySelector('[data-testid="preuve-bac"]')!;
    expect(bac.querySelector('strong')?.textContent).toBe('7 / 8');
    expect(bac.textContent).toMatch(/5 tout vert/);
    expect(bac.textContent).toMatch(/2 avec un contrôle rouge/);
    expect(bac.textContent).toMatch(/2\/3 nœud\(s\) isolé\(s\), 1 en conteneur/);

    const cout = dom.querySelector('[data-testid="preuve-cout"]')!;
    expect(cout.querySelector('strong')?.textContent).toBe('9 / 12');
    expect(cout.textContent).toMatch(/3 inconnue\(s\), jamais estimée/);
    // Le montant est en dollars, en français : « 1,23 $US ».
    expect(cout.textContent).toMatch(/1,23/);

    const humain = dom.querySelector('[data-testid="preuve-humain"]')!;
    expect(humain.querySelector('strong')?.textContent).toBe('2');
    expect(humain.querySelector('.preuve-pct')).toBeNull();
    expect(humain.textContent).toMatch(/3 porte\(s\) de sécurité/);

    // Pas de « vs un agent seul » : personne ne l'a fait tourner.
    expect(dom.textContent).not.toMatch(/agent seul/i);
    expect(dom.textContent).not.toMatch(/\bvs\b/);
    expect(dom.querySelector('.preuve-elague')).toBeNull();
  });

  it('un journal élagué est dit en tête ; l’anglais suit la langue', async () => {
    const dom = await rendre(
      sondage({ ...PREUVE, fenetre: { ...PREUVE.fenetre, elague: true } }),
      'en',
    );
    expect(dom.querySelector('.preuve-elague')?.textContent).toMatch(/journal was pruned/);
    expect(dom.textContent).toMatch(/reviewed by another agent family/);
    expect(dom.textContent).toMatch(/never estimated/);
  });

  it('sans production : d’où la preuve commence, et aucune mesure', async () => {
    const dom = await rendre(
      sondage({
        ...PREUVE,
        productions: { ...PREUVE.productions, rendues: 0 },
      }),
    );
    expect(dom.querySelector('.preuve-vide')?.textContent).toMatch(/première tâche terminée/);
    expect(dom.querySelector('.preuve-mesures')).toBeNull();
  });

  it('une lecture en échec se montre, la carte reste', async () => {
    const dom = await rendre(sondage(null, 'HTTP 503'));
    expect(dom.querySelector('[data-testid="preuve-ruche"]')).not.toBeNull();
    expect(dom.textContent).toMatch(/Preuve indisponible/);
    expect(dom.textContent).toMatch(/503/);
    expect(dom.querySelector('.preuve-mesures')).toBeNull();
  });
});
