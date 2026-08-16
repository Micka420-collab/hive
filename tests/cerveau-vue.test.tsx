// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CERVEAU, RENDU — le bon mode allumé, et la fiche de la note choisie.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Les DEUX dernières survivantes du balayage loupe du 3 août vivent ici :
//
//   · `className={mode === 'graphe' ? 'on' : ''}` — mutée en `!==`, le bouton
//     « Graphe » s'allumerait quand on regarde la LISTE, et s'éteindrait sur
//     son propre mode : l'interrupteur qui montre l'inverse de l'état ;
//   · `noteChoisie = choisi === null ? null : (parId.get(choisi) ?? null)` —
//     mutée, la fiche de détail ne s'ouvrirait JAMAIS : choisir une note ne
//     montrerait rien, et l'écran fait pour explorer le savoir deviendrait
//     une image qu'on ne peut pas interroger.
//
// Le canevas du mode graphe ne se dessine pas sous happy-dom (`getContext`
// rend null, la simulation se tait) — c'est prévu par la vue : la LISTE est
// « la même information, dans un tableau navigable », et c'est par elle que
// la fiche s'ouvre au clavier comme au clic.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchCerveau: vi.fn(() => Promise.resolve(null)),
}));

import { fetchCerveau } from '../dashboard/src/api';
import Cerveau from '../dashboard/src/views/Cerveau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchCerveau)
    .mockReset()
    .mockResolvedValue({
      noeuds: [
        {
          id: 'note-lecon',
          genre: 'lecon',
          titre: 'La leçon des tubes',
          recurrences: 3,
          degre: 1,
          ageJours: 10,
          serviIlYaJours: 2,
        },
        {
          id: 'note-episode',
          genre: 'episode',
          titre: 'L’épisode du port occupé',
          recurrences: 1,
          degre: 1,
          ageJours: 5,
          serviIlYaJours: null,
        },
      ],
      aretes: [{ de: 'note-lecon', vers: 'note-episode', reciproque: false }],
      liensMorts: [],
      orphelines: [],
      parGenre: { invariant: 0, lecon: 1, decision: 0, carte: 0, episode: 1 },
      servies: 1,
      total: 2,
      dossier: 'cerveau',
    } as never);
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {} as unknown as ViewProps;
  await act(async () => racine?.render(<Cerveau {...props} />));
  await act(async () => {});
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function boutonMode(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('.cerveau-modes button')].find(
    (x) => (x.textContent ?? '').trim() === libelle,
  );
  expect(b, `bouton de mode « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe('le Cerveau — les deux dernières survivantes du balayage', () => {
  it('L’INTERRUPTEUR DE MODE ALLUME LE MODE OÙ L’ON EST — jamais l’autre', async () => {
    const dom = await monter();
    // Au réveil, le graphe est le mode : SON bouton porte l'habit « on ».
    expect(boutonMode(dom, 'Graphe').classList.contains('on'), 'graphe allumé au réveil').toBe(
      true,
    );
    expect(boutonMode(dom, 'Liste').classList.contains('on')).toBe(false);

    cliquer(boutonMode(dom, 'Liste'));
    expect(boutonMode(dom, 'Liste').classList.contains('on'), 'la liste s’allume au clic').toBe(
      true,
    );
    expect(
      boutonMode(dom, 'Graphe').classList.contains('on'),
      'le graphe s’éteint en le quittant',
    ).toBe(false);
  });

  it('CHOISIR UNE NOTE OUVRE SA FICHE — la survivante `choisi === null`', async () => {
    // Mutée en `!==`, `noteChoisie` serait null dans les deux cas : la fiche
    // ne s'ouvrirait jamais, et l'écran fait pour interroger le savoir
    // n'aurait plus de réponse. On passe par la LISTE, le chemin accessible.
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));
    expect(dom.querySelector('.cerveau-fiche'), 'aucune fiche avant le choix').toBeNull();

    const ligne = [...dom.querySelectorAll('.cerveau-liste tbody tr')].find((r) =>
      (r.textContent ?? '').includes('La leçon des tubes'),
    );
    expect(ligne, 'la note doit être dans la liste').toBeTruthy();
    cliquer(ligne as Element);

    const fiche = dom.querySelector('.cerveau-fiche');
    expect(fiche, 'la fiche s’ouvre sur la note choisie').toBeTruthy();
    expect(fiche?.querySelector('h3')?.textContent).toBe('La leçon des tubes');
    expect(fiche?.textContent).toContain('note-lecon');
    // Et la voisine est proposée : le savoir se parcourt de note en note.
    expect(fiche?.textContent).toContain('L’épisode du port occupé');
  });

  it('« RECENTRER » N’EXISTE QU’EN MODE GRAPHE — rien à recentrer dans un tableau', async () => {
    // Survivante du balayage de nuit : `{mode === 'graphe' && (…)}` mutée en
    // `!==` — le bouton « Recentrer » apparaîtrait au-dessus de la LISTE (où
    // il ne peut rien recentrer, et où le clic serait sans effet visible :
    // le pire des retours, celui qui laisse croire à une panne) et
    // disparaîtrait du graphe, le seul endroit où il sert.
    const dom = await monter();
    const recentrer = () => dom.querySelector('.cerveau-recentrer');
    expect(recentrer(), 'au réveil, on est en graphe : le bouton est là').toBeTruthy();

    cliquer(boutonMode(dom, 'Liste'));
    expect(recentrer(), 'dans la liste, il n’y a rien à recentrer').toBeNull();

    cliquer(boutonMode(dom, 'Graphe'));
    expect(recentrer(), 'de retour au graphe, il revient').toBeTruthy();
  });

  it('LES ORPHELINES NE S’ANNONCENT QUE S’IL Y EN A', async () => {
    // `(g?.orphelines.length ?? 0) > 0 &&` mutée en `||` : le court-circuit
    // rend `true` quand il Y EN A (React n'affiche rien — l'alerte disparaît
    // au moment où elle informe), et un cerveau parfaitement relié
    // annoncerait « 0 orphelines » comme s'il y avait un problème. Une alerte
    // qui se déclenche à vide finit par ne plus être lue du tout.
    const dom = await monter();
    expect(dom.textContent, 'aucune orpheline dans le banc : rien ne s’annonce').not.toContain(
      'orphelines',
    );

    act(() => racine?.unmount());
    conteneur?.remove();
    vi.mocked(fetchCerveau).mockResolvedValue({
      noeuds: [
        {
          id: 'note-seule',
          genre: 'episode',
          titre: 'Une note sans lien',
          recurrences: 1,
          degre: 0,
          ageJours: 2,
          serviIlYaJours: null,
        },
      ],
      aretes: [],
      liensMorts: [],
      orphelines: ['note-seule'],
      parGenre: { invariant: 0, lecon: 0, decision: 0, carte: 0, episode: 1 },
      servies: 0,
      total: 1,
      dossier: 'cerveau',
    } as never);
    const avec = await monter();
    expect(avec.textContent, 'une orpheline : l’alerte se dit').toContain('orphelines');
    expect(avec.textContent, 'et elle dit pourquoi ça compte').toContain(
      'du savoir qui ne se raccroche à rien',
    );
  });

  it('UNE NOTE JAMAIS SERVIE LE DIT — et celle qui l’a été donne son âge', async () => {
    // Survivante du balayage du soir : `n.serviIlYaJours === null` mutée en
    // `!==` inverse les deux mondes — la note SERVIE il y a deux jours
    // s'annoncerait « jamais » (on la croirait morte, on la resservirait pour
    // rien), et celle qui dort vraiment afficherait « il y a null j ». La
    // colonne existe précisément pour décider quoi ressortir du rayon.
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));
    const rangee = (titre: string) =>
      [...dom.querySelectorAll('.cerveau-liste tbody tr')].find((r) =>
        (r.textContent ?? '').includes(titre),
      );
    const servie = rangee('La leçon des tubes');
    const dormante = rangee('L’épisode du port occupé');
    expect(servie, 'la note servie est dans la liste').toBeTruthy();
    expect(dormante, 'la note dormante est dans la liste').toBeTruthy();

    expect(servie?.textContent, 'servie il y a deux jours, elle le dit').toContain('il y a 2 j');
    expect(servie?.textContent, 'une note servie n’est pas « jamais »').not.toContain('jamais');
    expect(dormante?.textContent, 'jamais servie, elle le dit').toContain('jamais');
    // L'habit `dort` marque la même chose que le texte : les deux gardes de
    // la ligne sont éprouvées, pas seulement celle qu'on regarde.
    expect(dormante?.querySelector('.dort'), 'la dormante porte son habit').toBeTruthy();
    expect(servie?.querySelector('.dort'), 'la servie ne le porte pas').toBeNull();
  });

  it('LA FICHE LE DIT AUSSI — la même vérité au même moment, aux deux endroits', async () => {
    // ─── LE MÊME PRÉDICAT À CINQ ENDROITS, UN SEUL DÉFENDU ─────────────────
    //
    // `serviIlYaJours === null` est écrit CINQ fois dans cette vue : la boucle
    // du canevas, la bulle, la colonne du tableau, l'habit `dort`, et la fiche.
    // Le cas du dessus n'en éprouve que le tableau — muter celui de la FICHE
    // laissait les 20 cas de ce fichier VERTS : mesuré, verdict affiché.
    //
    // Ce n'est pas un doublon. Le tableau sert à BALAYER, la fiche à DÉCIDER :
    // on y arrive après avoir choisi une note, et c'est là qu'on tranche si on
    // la ressort. Les deux affichages inversés se contrediraient à l'écran —
    // le pire état pour un outil qui existe pour être cru.
    //
    // ─── CE QUI RESTE HORS DE PORTÉE, ET C'EST DIT ─────────────────────────
    //
    // Le cinquième site vit dans la boucle de dessin du canevas
    // (`if (p.n.serviIlYaJours === null)`, teinte des bulles). happy-dom ne
    // fournit pas de contexte 2D : ce banc-là ne peut pas exister ici, et le
    // simuler donnerait une couverture de façade. Consigné plutôt que joué.
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));

    const ligne = (titre: string) =>
      [...dom.querySelectorAll('.cerveau-liste tbody tr')].find((r) =>
        (r.textContent ?? '').includes(titre),
      );

    cliquer(ligne('L’épisode du port occupé') as Element);
    const dormante = dom.querySelector('.cerveau-fiche');
    expect(dormante?.textContent, 'la fiche d’une note jamais servie dit « jamais »').toContain(
      'jamais',
    );

    cliquer(ligne('La leçon des tubes') as Element);
    const servie = dom.querySelector('.cerveau-fiche');
    expect(servie?.textContent, 'la fiche d’une note servie donne son âge').toContain('il y a 2 j');
    expect(servie?.textContent, 'une note servie n’est pas « jamais »').not.toContain('jamais');
  });
});

// ─── LES NUES DU BALAYAGE DU 16 AOÛT, PART ÉPROUVABLE ────────────────────────
//
// Balayage sur `Cerveau.tsx`, base épinglée dans l'atelier (`LOUPE_BASE=6b0231c`,
// le parent du commit créateur : 777 ajoutées / 0 retirée) —
//
//     50 candidates, 10 examinées — 3 défendues, 7 SANS TEST
//     40 laissées de côté : la loupe échantillonne
//
// Les sept ne sont pas de la même espèce, et les confondre ferait promettre ce
// qu'on ne peut pas tenir :
//
//   ÉPROUVABLES ICI, sans géométrie — les deux ci-dessous ;
//   HORS DE PORTÉE — la borne de boucle (l. 207), `ch > 0 && !eteint` (l. 289)
//   et `p && r` (l. 569) vivent sous `getContext` ou
//   `getBoundingClientRect`. `tests/canevas-hors-portee.test.tsx` MESURE que
//   `getContext` rend `null` sous happy-dom ; la limite est donc DITE, pas
//   simulée, et ces trois-là ne sont pas comptées comme fermées.
describe('le Cerveau — les nues éprouvables du balayage', () => {
  it('L’ERREUR DE RELEVÉ S’AFFICHE — sinon l’écran ment par omission', async () => {
    // `{poll.error !== null && <p className="cerveau-erreur">{poll.error}</p>}`.
    //
    // Muté en `||`, le paragraphe se rend TOUJOURS — y compris au repos, avec un
    // texte vide : une bande d'erreur permanente sur un écran qui va bien. Et
    // dans l'autre sens, ce cas est le seul à dire qu'un relevé RATÉ se voit :
    // sans lui, le Cerveau afficherait un graphe périmé sans jamais prévenir.
    vi.mocked(fetchCerveau).mockRejectedValue(new Error('le dossier cerveau est introuvable'));
    const dom = await monter();

    const bande = dom.querySelector('.cerveau-erreur');
    expect(bande, 'aucune bande d’erreur alors que le relevé a échoué').not.toBeNull();
    expect(bande?.textContent, 'la bande ne dit pas ce qui a échoué').toContain(
      'le dossier cerveau est introuvable',
    );
  });

  it('AU REPOS, AUCUNE BANDE D’ERREUR — l’autre sens de la même garde', async () => {
    // Le contraste explicite : sans lui, « la bande existe » se satisferait d'un
    // rendu inconditionnel. C'est ce cas-ci que le mutant `||` fait rougir.
    const dom = await monter();
    expect(
      dom.querySelector('.cerveau-erreur'),
      'une bande d’erreur s’affiche alors que le relevé a réussi',
    ).toBeNull();
  });
});

// ─── L'INVITE DU MODE — LA DERNIÈRE NUE ÉPROUVABLE DU CERVEAU ────────────────
//
// Le balayage de la loupe sur `Cerveau.tsx` (base épinglée dans l'atelier,
// `6b0231c`) rendait SEPT survivantes. Cinq ne sont pas de ce fichier : quatre
// vivent derrière `getContext` (mesuré par `tests/canevas-hors-portee.test.tsx`,
// qui ne se contente pas de l'affirmer), et deux sont fermées ailleurs. Restait
// celle-ci, la seule encore éprouvable :
//
//     <p className="cerveau-invite">
//       {mode === 'graphe' ? 'Molette pour zoomer, glissez…' : 'Cliquez une ligne…'}
//
// DEUX SITES, UN MÊME SYMBOLE (§ 9 unquinquagicenties) : `mode === 'graphe'`
// s'écrit aussi ligne 484, sur le `className` de l'interrupteur — et CELUI-LÀ est
// défendu depuis le 3 août, par le premier cas de ce fichier. Dire « le mode est
// gardé » aurait donc été faux : le banc qui NOMME le symbole ne dit rien de
// l'autre endroit où il vit.
//
// Mesuré avant d'écrire quoi que ce soit, mutant posé seul, suite entière :
//
//     NU · l'invite du mode : === → !==    4289 passés | 8 sautés (4297), 0 échec
//
// Muté, les deux invites S'ÉCHANGENT : le tableau propose la molette et le
// glisser sur un canevas qui n'est pas là, et le graphe demande de cliquer une
// ligne dans un écran qui n'a pas de lignes. C'est le seul texte de l'écran qui
// dise quoi FAIRE ; échangé, il enseigne un geste impossible aux deux endroits.
describe('l’invite du mode dit le geste DE CE MODE', () => {
  /** L'invite, prise dans son paragraphe — jamais dans le texte de l'écran entier. */
  const invite = (dom: HTMLElement): string => {
    const p = dom.querySelector<HTMLElement>('.cerveau-invite');
    if (!p) throw new Error('le paragraphe d’invite est introuvable');
    return p.textContent ?? '';
  };

  it('EN GRAPHE, ELLE PARLE DE LA MOLETTE ET DU GLISSER', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER ──────────────────────────────────
    //
    // Au réveil, le mode est « graphe » : l'invite doit enseigner les gestes du
    // canevas. Ce cas seul ne suffirait pas — son attendu n'est pas le défaut de
    // l'autre branche, mais il faut le suivant pour que la mutation rougisse des
    // DEUX côtés (§ 9 octoquadragicenties).
    const dom = await monter();

    expect(invite(dom), 'le graphe n’enseigne pas ses gestes').toContain('Molette pour zoomer');
    expect(invite(dom), 'le graphe propose le geste de la liste').not.toContain(
      'Cliquez une ligne',
    );
  });

  it('EN LISTE, ELLE PARLE DE LA LIGNE À CLIQUER — l’autre côté de la bascule', async () => {
    const dom = await monter();
    cliquer(boutonMode(dom, 'Liste'));

    expect(invite(dom), 'la liste n’enseigne pas son geste').toContain('Cliquez une ligne');
    expect(invite(dom), 'la liste propose la molette d’un canevas absent').not.toContain(
      'Molette pour zoomer',
    );
  });
});
