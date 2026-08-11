// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU DE L'AGENT GARDE-FOUS (dashboard, lot G5b).
//
// Deux niveaux d'épreuve, et la séparation est délibérée :
//   · les HELPERS PURS (formatScore, formatMoyenne) — testés directement, car
//     c'est là que vit la seule logique qui peut se tromper, notamment le `+∞`
//     d'un échelon jamais essayé (UCB), que `toFixed` rendrait « Infinity » ;
//   · le RENDU — monté avec un `fetchGardeFou` simulé, asserté sur `textContent`.
//     On ne dessine aucun canevas ici (rien à dessiner), donc pas de mur happy-dom.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGardeFou: vi.fn(),
  reglerGardeFou: vi.fn(() => Promise.resolve({})),
}));

import { fetchGardeFou, reglerGardeFou } from '../dashboard/src/api';
import type { EtatGardeFouUi } from '../dashboard/src/api';
import { GardeFous, formatMoyenne, formatScore } from '../dashboard/src/GardeFous';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  void act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

describe('helpers purs — le formatage qui peut se tromper', () => {
  it('formatScore : un score fini est arrondi, le +∞ (jamais essayé) rend « ∞ »', () => {
    expect(formatScore(0.7123)).toBe('0.71');
    expect(formatScore(0)).toBe('0.00');
    // Le cas qui compte : sans garde, `toFixed` afficherait « Infinity ».
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('∞');
  });

  it('formatMoyenne : une part de [0,1] devient un pourcentage entier', () => {
    expect(formatMoyenne(0.714)).toBe('71 %');
    expect(formatMoyenne(1)).toBe('100 %');
    expect(formatMoyenne(0)).toBe('0 %');
  });
});

describe('le rendu — ce que l’écran raconte', () => {
  const etat = (p: Partial<EtatGardeFouUi> = {}): EtatGardeFouUi => ({
    actif: true,
    bornes: { min: 'leger', max: 'strict' },
    definiPar: 'humain',
    echelonElu: 'leger',
    classement: [
      { echelon: 'leger', essais: 12, moyenne: 1, score: 1.2 },
      { echelon: 'standard', essais: 4, moyenne: 0.5, score: 0.9 },
      { echelon: 'strict', essais: 0, moyenne: 0, score: Number.POSITIVE_INFINITY },
    ],
    echelons: ['leger', 'standard', 'strict'],
    reglages: {
      leger: { gardiennes: 'consultatif', polyethisme: 'consignes' },
      standard: { gardiennes: 'strict', polyethisme: 'consignes' },
      strict: { gardiennes: 'strict', polyethisme: 'strict' },
    },
    ...p,
  });

  it('un projet actif : l’échelon ÉLU est nommé, et le classement montre le vécu', async () => {
    vi.mocked(fetchGardeFou).mockResolvedValue(etat());
    const dom = await monter(<GardeFous projectId="p1" />);
    expect(dom.textContent, 'l’échelon élu est annoncé').toContain('léger');
    expect(dom.textContent, 'la moyenne du leger, en %').toContain('100 %');
    expect(dom.textContent, 'le strict jamais essayé rend ∞, pas « Infinity »').toContain('∞');
    expect(dom.textContent).not.toContain('Infinity');
  });

  it('un projet INACTIF : aucun échelon élu, on le DIT plutôt que d’inventer', async () => {
    vi.mocked(fetchGardeFou).mockResolvedValue(
      etat({ actif: false, echelonElu: null, classement: [], bornes: null }),
    );
    const dom = await monter(<GardeFous projectId="p2" />);
    expect(dom.textContent).toContain('Aucun échelon élu');
    expect(dom.textContent).toContain('Inactif');
  });

  it('un projet ACTIF mais sans élu (élu null) : on le DIT, on n’invente pas « strict »', async () => {
    // Le garde `etat.actif && etat.echelonElu` narrow le type `EchelonUi | null`
    // vers `EchelonUi` avant `nomEchelon`. La loupe l'a muté en `||` : la suite
    // restait verte, donc RIEN ne défendait le comportement au niveau du test —
    // seul le typeur mordait, et la loupe ne le lance pas. Un `actif:true` avec
    // `echelonElu:null` (réponse partielle du serveur, ou état transitoire)
    // rendrait alors `nomEchelon(null)` → « strict », un échelon INVENTÉ pour un
    // projet qui n'en a élu aucun. On affiche l'absence, on ne la remplace pas.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat({ echelonElu: null, classement: [] }));
    const dom = await monter(<GardeFous projectId="p3" />);
    expect(dom.textContent).toContain('Aucun échelon élu');
    expect(dom.textContent, 'aucun échelon inventé quand il n’y en a pas').not.toContain(
      'Échelon élu :',
    );
  });

  it('CLASSEMENT VIDE ⇒ AUCUN TABLEAU — pas un cadre d’en-têtes sans une ligne', async () => {
    // ─── LA GARDE QUE LA LOUPE A TROUVÉE NUE ────────────────────────────────
    //
    // `{etat.classement.length > 0 && (<table …>)}`. Deux bancs ci-dessus
    // passent déjà `classement: []`, mais tous deux n'assertent que du TEXTE —
    // or un tableau vide n'ajoute aucun mot, seulement des en-têtes. Mutée en
    // `>= 0`, la garde laissait donc s'afficher « Échelon | Moyenne | Essais »
    // au-dessus de rien, et pas un test ne rougissait.
    //
    // Ce que ça raconte à l'écran : un projet tout neuf, qui n'a encore rien
    // essayé, semblerait avoir un classement dont les lignes ne sont pas
    // arrivées — un chargement qui ne finit jamais, là où il n'y a
    // simplement rien à montrer.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat({ classement: [] }));
    const dom = await monter(<GardeFous projectId="p5" />);
    expect(
      dom.querySelector('.garde-fou-classement'),
      'un classement vide ne doit poser AUCUN tableau',
    ).toBeNull();
    // Et la contre-épreuve, sur le même écran : avec des lignes, il est là.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat());
    const plein = await monter(<GardeFous projectId="p5bis" />);
    expect(plein.querySelectorAll('.garde-fou-classement tbody tr').length).toBe(3);
  });

  it('les BORNES choisies sont marquées `aria-pressed` — la bonne, pas l’inverse', async () => {
    // Survivantes loupe : `aria-pressed={bornes.min === e}` et `.max === e`,
    // mutées en `!==`, marquaient l’INVERSE — le mauvais échelon montré comme
    // choisi. Un état d’accessibilité qu’aucun test n’assertait. Bornes prises
    // distinctes (min ≠ défaut, max ≠ défaut) pour que la morsure soit nette.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat({ bornes: { min: 'standard', max: 'leger' } }));
    const dom = await monter(<GardeFous projectId="p4" />);
    const champs = dom.querySelectorAll('.garde-fou-bornes fieldset');
    // L’ordre des boutons suit `etat.echelons` : leger, standard, strict.
    const bas = champs[0]!.querySelectorAll('button');
    const haut = champs[1]!.querySelectorAll('button');
    expect(bas[1]!.getAttribute('aria-pressed'), 'borne basse = standard, pressée').toBe('true');
    expect(bas[0]!.getAttribute('aria-pressed'), 'leger n’est pas la borne basse').toBe('false');
    expect(haut[0]!.getAttribute('aria-pressed'), 'borne haute = leger, pressée').toBe('true');
    expect(haut[2]!.getAttribute('aria-pressed'), 'strict n’est pas la borne haute').toBe('false');
  });

  it('la ligne ÉLUE du classement porte `aria-current` — pas une autre', async () => {
    // Survivante loupe : `aria-current={r.echelon === etat.echelonElu ? …}`,
    // mutée en `!==`, marquait TOUTES les lignes sauf l’élue. Jamais assertée.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat({ echelonElu: 'standard' }));
    const dom = await monter(<GardeFous projectId="p5" />);
    const lignes = dom.querySelectorAll('.garde-fou-classement tbody tr');
    // `etat()` : classement [leger, standard, strict].
    expect(lignes[1]!.getAttribute('aria-current'), 'la ligne standard (élue) est courante').toBe(
      'true',
    );
    expect(lignes[0]!.getAttribute('aria-current'), 'leger n’est pas l’élu').toBeNull();
    expect(lignes[2]!.getAttribute('aria-current'), 'strict n’est pas l’élu').toBeNull();
  });

  it('une ERREUR de réglage s’affiche — `erreur && <p>` n’est pas du décor', async () => {
    // Survivante loupe : `{erreur && <p className="garde-fou-erreur">…}`, mutée
    // en `||`, cassait l’affichage (le message brut sans son cadre, ou un cadre
    // vide en permanence). Aucun test ne DÉCLENCHAIT d’erreur, donc rien ne la
    // gardait. Un réglage qui échoue doit MONTRER pourquoi.
    vi.mocked(fetchGardeFou).mockResolvedValue(etat());
    vi.mocked(reglerGardeFou).mockRejectedValueOnce(new Error('plafond refusé par la ruche'));
    const dom = await monter(<GardeFous projectId="p6" />);
    const bouton = dom.querySelector('.garde-fou-bornes fieldset button') as HTMLButtonElement;
    await act(async () => {
      bouton.dispatchEvent(new Event('click', { bubbles: true }));
    });
    await act(async () => {});
    const err = dom.querySelector('.garde-fou-erreur');
    expect(err?.textContent, 'le message d’erreur est montré dans son cadre').toContain(
      'plafond refusé par la ruche',
    );
  });
});
