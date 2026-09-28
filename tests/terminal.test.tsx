// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE TERMINAL — les gestes d'un terminal, sur la console en direct et le Journal.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · CHERCHER surligne chaque occurrence, dit « k/N », va à la suivante et à la
//   précédente (Entrée, Maj+Entrée, n / N dans la zone), en boucle — et
//   trouve une occurrence HORS de la fenêtre rendue ;
// · les NIVEAUX filtrent, et ne montrent que ceux qui sont présents ;
// · SUIVRE se détache quand on remonte lire, et « ↓ N nouvelles lignes » dit
//   ce qui est arrivé depuis ;
// · COPIER la sélection, ou toutes les lignes affichées ;
// · PLEIN ÉCRAN s'ouvre et se quitte par Échap ;
// · un tampon de 256 Kio ne rend qu'une FENÊTRE de lignes (garde de
//   performance : c'est ce qui figeait l'onglet) ;
// · le Journal range chaque événement à la SÉVÉRITÉ de sa fiche, et les
//   montre tous, du plus ancien au plus récent.
//
// happy-dom ne met rien en page : hauteurs et défilements sont posés à la main
// là où un geste en dépend.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HiveEvent } from '../src/shared/types';
import { Terminal, type LigneTerminal, type NiveauTerminal } from '../dashboard/src/composants';
import { HAUTEUR_LIGNE } from '../dashboard/src/composants/terminal';
import { Journal } from '../dashboard/src/Journal';
import { setLang } from '../dashboard/src/i18n';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let copies: string[] = [];

beforeEach(() => {
  // Un banc de rendu n'ouvre aucune vraie connexion vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  copies = [];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t: string) => (copies.push(t), Promise.resolve()) },
    configurable: true,
  });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const NIVEAUX: NiveauTerminal[] = [
  { cle: 'stdout', libelle: 'stdout', repere: '›' },
  { cle: 'stderr', libelle: 'stderr', repere: '»' },
  { cle: 'erreur', libelle: 'erreur de l’agent', repere: '✘' },
];

const ligne = (texte: string, niveau = 'stdout'): LigneTerminal => ({ texte, niveau });

function rendu(lignes: readonly LigneTerminal[]) {
  return <Terminal titre="Sortie" lignes={lignes} niveaux={NIVEAUX} vide="rien" testId="zone" />;
}

async function monter(el: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(el));
  return conteneur;
}

const zone = (dom: HTMLElement) => dom.querySelector<HTMLElement>('[data-testid="zone"]')!;
const bouton = (dom: HTMLElement, texte: string | RegExp) =>
  [...dom.querySelectorAll('button')].find((b) =>
    typeof texte === 'string' ? b.textContent === texte : texte.test(b.textContent ?? ''),
  )!;
const textes = (dom: HTMLElement) =>
  [...dom.querySelectorAll('.ds-terminal-texte')].map((t) => t.textContent);

async function taper(champ: HTMLInputElement, valeur: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function touche(cible: Element, key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    cible.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

describe('CHERCHER — surligner, compter, aller de l’une à l’autre', () => {
  const lignes = [
    ligne('lecture de src/ruche.ts'),
    ligne('Erreur : test rouge', 'stderr'),
    ligne('écriture de src/rayon.ts, puis erreur'),
  ];

  it('surligne CHAQUE occurrence, sans filtrer, et dit où l’on est', async () => {
    const dom = await monter(rendu(lignes));
    await taper(dom.querySelector('input[type="search"]')!, 'ERREUR');
    expect(textes(dom)).toHaveLength(3);
    expect([...dom.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'Erreur',
      'erreur',
    ]);
    expect(dom.querySelector('mark[aria-current]')?.textContent).toBe('Erreur');
    expect(dom.textContent).toContain('1/2');
  });

  it('une lettre qui s’allonge en minuscule ne décale pas le surlignage', async () => {
    // « İ » devient deux unités en minuscule : une position prise dans la
    // copie minuscule marquait « rror » au lieu de « error ».
    const dom = await monter(rendu([ligne('İstanbul error ERROR')]));
    await taper(dom.querySelector('input[type="search"]')!, 'error');
    expect([...dom.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['error', 'ERROR']);
  });

  it('Entrée, Maj+Entrée, les flèches, n / N : en boucle', async () => {
    const dom = await monter(rendu(lignes));
    const champ = dom.querySelector<HTMLInputElement>('input[type="search"]')!;
    await taper(champ, 'erreur');
    const courante = () => dom.querySelector('mark[aria-current]')?.closest('.ds-terminal-ligne');

    await touche(champ, 'Enter');
    expect(dom.textContent).toContain('2/2');
    expect(courante()?.textContent).toContain('rayon.ts');
    await touche(champ, 'Enter');
    expect(dom.textContent, 'la dernière reboucle sur la première').toContain('1/2');
    await touche(champ, 'Enter', true);
    expect(dom.textContent).toContain('2/2');
    await act(async () => bouton(dom, '↑').click());
    expect(dom.textContent).toContain('1/2');
    await touche(zone(dom), 'n');
    expect(dom.textContent).toContain('2/2');
    await touche(zone(dom), 'N');
    expect(dom.textContent).toContain('1/2');
  });

  it('« lignes trouvées seules » filtre ; aucune occurrence se dit', async () => {
    const dom = await monter(rendu(lignes));
    const champ = dom.querySelector<HTMLInputElement>('input[type="search"]')!;
    await taper(champ, 'src/');
    await act(async () => bouton(dom, 'lignes trouvées seules').click());
    expect(textes(dom)).toEqual([
      'lecture de src/ruche.ts',
      'écriture de src/rayon.ts, puis erreur',
    ]);
    await taper(champ, 'introuvable');
    expect(dom.textContent).toContain('aucune');
  });

  it('« / » dans la zone va au champ ; une lettre tapée AILLEURS reste une lettre', async () => {
    const dom = await monter(rendu(lignes));
    const champ = dom.querySelector<HTMLInputElement>('input[type="search"]')!;
    await touche(zone(dom), '/');
    expect(document.activeElement).toBe(champ);
    // « n » sur un bouton de la barre ne fait pas défiler la recherche.
    await taper(champ, 'erreur');
    await touche(bouton(dom, 'replier'), 'n');
    expect(dom.textContent).toContain('1/2');
  });
});

describe('NIVEAUX — ceux qui sont là, et seulement eux', () => {
  it('un filtre par niveau PRÉSENT, avec son compte ; le retirer masque ses lignes', async () => {
    const dom = await monter(
      rendu([ligne('a'), ligne('b', 'stderr'), ligne('c'), ligne('d', 'stderr')]),
    );
    const filtres = [...dom.querySelectorAll<HTMLButtonElement>('[data-niveau]')];
    // `erreur` n'a aucune ligne : pas de filtre pour lui.
    expect(
      filtres.map((f) => [f.dataset.niveau, f.querySelector('.chip-count')?.textContent]),
    ).toEqual([
      ['stdout', '2'],
      ['stderr', '2'],
    ]);
    const stderr = filtres[1]!;
    expect(stderr.getAttribute('aria-pressed')).toBe('true');
    await act(async () => stderr.click());
    expect(stderr.getAttribute('aria-pressed')).toBe('false');
    expect(textes(dom)).toEqual(['a', 'c']);
    await act(async () => stderr.click());
    expect(textes(dom)).toEqual(['a', 'b', 'c', 'd']);
    // Tout masqué : la zone le dit, elle ne se tait pas comme un agent muet.
    await act(async () => filtres.forEach((f) => f.click()));
    expect(textes(dom)).toEqual([]);
    expect(dom.querySelector('[data-testid="zone-filtree"]')?.textContent).toContain(
      'Aucune des 4 ligne(s)',
    );
  });

  it('un seul niveau : aucun filtre à offrir', async () => {
    const dom = await monter(rendu([ligne('a'), ligne('b')]));
    expect(dom.querySelector('[data-niveau]')).toBeNull();
  });

  it('un niveau masqué qui reste SEUL garde sa bascule — jamais d’impasse', async () => {
    // Une nouvelle tentative n'écrit que sur stdout, stdout était masqué :
    // la barre disparaissait, et plus rien ne rendait les lignes.
    const dom = await monter(rendu([ligne('a'), ligne('b', 'stderr')]));
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-niveau="stdout"]')!.click());
    await act(async () => racine?.render(rendu([ligne('a'), ligne('c')])));
    expect(textes(dom)).toEqual([]);
    const stdout = dom.querySelector<HTMLButtonElement>('[data-niveau="stdout"]');
    expect(stdout?.getAttribute('aria-pressed')).toBe('false');
    // Et la zone filtrée offre de tout rendre d'un geste.
    await act(async () => bouton(dom, 'tout afficher').click());
    expect(textes(dom)).toEqual(['a', 'c']);
    expect(dom.querySelector('[data-niveau]')).toBeNull();
  });

  it('les bascules de niveau disent leur état au lecteur d’écran ; la zone est un journal nommé', async () => {
    const dom = await monter(rendu([ligne('a'), ligne('b', 'stderr')]));
    const el = zone(dom);
    expect(el.getAttribute('role')).toBe('log');
    const titre = dom.querySelector(`#${CSS.escape(el.getAttribute('aria-labelledby')!)}`);
    expect(titre?.textContent).toBe('Sortie');
    expect(dom.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Niveaux');
    const reperes = [...el.querySelectorAll('.ds-terminal-repere')].map((r) =>
      r.getAttribute('aria-label'),
    );
    expect(reperes).toEqual(['stdout', 'stderr']);
  });
});

describe('SUIVRE — collé au bas, détaché pour lire, et ce qui est arrivé depuis', () => {
  it('remonter détache ; les lignes suivantes sont comptées ; revenir raccroche', async () => {
    const debut = Array.from({ length: 50 }, (_, i) => ligne(`ligne ${i}`));
    const dom = await monter(rendu(debut));
    const suivre = bouton(dom, 'suivre');
    expect(suivre.getAttribute('aria-pressed')).toBe('true');

    // L'opérateur remonte lire : la zone n'est plus en bas.
    const el = zone(dom);
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 50 * HAUTEUR_LIGNE, configurable: true });
    await act(async () => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    expect(suivre.getAttribute('aria-pressed')).toBe('false');

    const suite = [...debut, ligne('nouvelle 1'), ligne('nouvelle 2')];
    await act(async () => racine?.render(rendu(suite)));
    const annonce = bouton(dom, /nouvelle\(s\) ligne\(s\)/);
    expect(annonce.textContent).toBe('↓ 2 nouvelle(s) ligne(s)');

    await act(async () => annonce.click());
    expect(suivre.getAttribute('aria-pressed')).toBe('true');
    expect(bouton(dom, /nouvelle\(s\) ligne\(s\)/)).toBeUndefined();
  });

  it('le compte ne gonfle pas quand le tampon évince le début, et ignore les lignes masquées', async () => {
    const debut = Array.from({ length: 50 }, (_, i) => ligne(`ligne ${i}`));
    const bruit = ligne('bruit', 'stderr');
    const dom = await monter(rendu([...debut, bruit]));
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-niveau="stderr"]')!.click());
    const el = zone(dom);
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 50 * HAUTEUR_LIGNE, configurable: true });
    await act(async () => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    // Le tampon évince les 40 plus vieilles lignes — dont celle qu'on lisait —
    // et trois arrivent, dont une masquée.
    const suite = [...debut.slice(40), bruit, ligne('n1'), ligne('n2', 'stderr'), ligne('n3')];
    await act(async () => racine?.render(rendu(suite)));
    expect(bouton(dom, /nouvelle\(s\) ligne\(s\)/).textContent).toBe('↓ 2 nouvelle(s) ligne(s)');
    // Des lignes RECRÉÉES (le Journal au changement de langue) : rien n'est
    // prouvé nouveau, le compte ne bouge pas.
    await act(async () => racine?.render(rendu(suite.map((l) => ({ ...l })))));
    expect(bouton(dom, /nouvelle\(s\) ligne\(s\)/).textContent).toBe('↓ 2 nouvelle(s) ligne(s)');
  });

  it('aller à une occurrence détache aussi : sinon la ligne suivante l’arracherait', async () => {
    const dom = await monter(rendu([ligne('cible'), ligne('autre')]));
    await taper(dom.querySelector('input[type="search"]')!, 'cible');
    await touche(dom.querySelector('input[type="search"]')!, 'Enter');
    expect(bouton(dom, 'suivre').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('COPIER — la sélection, ou tout ce qui est affiché', () => {
  it('« tout copier » copie les lignes AFFICHÉES, filtres appliqués', async () => {
    const dom = await monter(rendu([ligne('a'), ligne('b', 'stderr'), ligne('c')]));
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-niveau="stderr"]')!.click());
    await act(async () => bouton(dom, 'tout copier (2)').click());
    expect(copies).toEqual(['a\nc']);
    expect(dom.textContent).toContain('✔ copié');
  });

  it('« copier la sélection » ne s’allume que pour une sélection DANS la zone', async () => {
    const dom = await monter(rendu([ligne('première ligne'), ligne('seconde')]));
    expect(
      bouton(dom, 'copier la sélection'),
      'rien de sélectionné : rien à offrir',
    ).toBeUndefined();

    const texte = dom.querySelector('.ds-terminal-texte')!.firstChild!;
    const plage = document.createRange();
    plage.setStart(texte, 0);
    plage.setEnd(texte, 8);
    await act(async () => {
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(plage);
      document.dispatchEvent(new Event('selectionchange'));
    });
    const copierSel = bouton(dom, 'copier la sélection');
    await act(async () => copierSel.click());
    expect(copies).toEqual(['première']);
  });
});

describe('PLEIN ÉCRAN et REPLIER', () => {
  it('le plein écran s’ouvre, et Échap le quitte', async () => {
    const dom = await monter(rendu([ligne('a')]));
    const section = dom.querySelector('.ds-terminal')!;
    const plein = dom.querySelector<HTMLButtonElement>('button[aria-label^="Plein écran"]')!;
    await act(async () => plein.click());
    expect(plein.getAttribute('aria-pressed')).toBe('true');
    expect(section.classList.contains('plein')).toBe(true);
    // Échap quitte le plein écran SEUL : le tiroir autour (qui écoute Échap
    // sur `window`, ui.tsx) ne l'entend pas.
    const entendues: string[] = [];
    const ecoute = (e: KeyboardEvent) => entendues.push(e.key);
    window.addEventListener('keydown', ecoute);
    await touche(zone(dom), 'Escape');
    window.removeEventListener('keydown', ecoute);
    expect(section.classList.contains('plein')).toBe(false);
    expect(entendues).toEqual([]);
  });

  it('replier se met et se retire', async () => {
    const dom = await monter(rendu([ligne('a')]));
    expect(zone(dom).classList.contains('replie')).toBe(false);
    await act(async () => bouton(dom, 'replier').click());
    expect(zone(dom).classList.contains('replie')).toBe(true);
  });
});

describe('GARDE DE PERFORMANCE — 256 Kio ne rendent qu’une fenêtre', () => {
  it('20 000 lignes : une fenêtre rendue, et la recherche les couvre TOUTES', async () => {
    // ~256 Kio : ce que la console garde d'une tâche (`SORTIE_ECRAN_MAX_OCTETS`).
    const lignes = Array.from({ length: 20_000 }, (_, i) =>
      ligne(`ligne ${String(i).padStart(5, '0')} ${'x'.repeat(4)}`),
    );
    const dom = await monter(rendu(lignes));
    const rendues = () => dom.querySelectorAll('.ds-terminal-ligne').length;
    // Tout rendre, c'était 20 000 nœuds re-créés à chaque morceau.
    expect(rendues()).toBeLessThan(200);
    // L'espace de défilement couvre TOUTES les lignes.
    expect(dom.querySelector<HTMLElement>('.ds-terminal-espace')!.style.height).toBe(
      `${20_000 * HAUTEUR_LIGNE}px`,
    );
    // Suivre le bas : c'est la FIN qui est rendue.
    expect(textes(dom).at(-1)).toContain('ligne 19999');

    // Une occurrence loin de la fenêtre est trouvée, et y est amenée.
    await taper(dom.querySelector('input[type="search"]')!, 'ligne 00042');
    expect(dom.textContent).toContain('1/1');
    await touche(dom.querySelector('input[type="search"]')!, 'Enter');
    expect(dom.querySelector('mark[aria-current]')?.textContent).toBe('ligne 00042');
    expect(rendues()).toBeLessThan(200);
  });
});

describe('le Journal dans le Terminal', () => {
  const ev = (id: number, type: string, payload: Record<string, unknown> = {}): HiveEvent => ({
    id,
    ts: 1_700_000_000_000 + id * 1_000,
    type,
    payload: { taskId: `tache-${id}`, ...payload },
  });

  it('chaque événement au niveau de SA sévérité, et un filtre par sévérité présente', async () => {
    const dom = await monter(
      <Journal
        events={[
          ev(1, 'task_started'),
          ev(2, 'task_failed'),
          ev(3, 'task_retry'),
          ev(4, 'task_done'),
        ]}
      />,
    );
    const niveaux = [...dom.querySelectorAll('.jrow')].map(
      (l) => l.className.match(/niveau-(\S+)/)?.[1],
    );
    expect(niveaux).toEqual(['info', 'erreur', 'avertissement', 'succes']);
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-niveau="info"]')!.click());
    expect(dom.querySelectorAll('.jrow')).toHaveLength(3);
  });

  it('TOUS les événements gardés — plus seulement les 40 derniers —, du plus ancien au plus récent', async () => {
    const evenements = Array.from({ length: 60 }, (_, i) => ev(i + 1, 'task_ready'));
    const dom = await monter(<Journal events={evenements} />);
    expect(bouton(dom, /^tout copier/).textContent).toBe('tout copier (60)');
    await act(async () => bouton(dom, 'tout copier (60)').click());
    const copie = copies[0]!.split('\n');
    expect(copie).toHaveLength(60);
    expect(copie[0]).toContain('tâche prête (tache-1)');
    expect(copie[59]).toContain('tâche prête (tache-60)');
  });
});
