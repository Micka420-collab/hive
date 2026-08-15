// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CANEVAS EST HORS DE PORTÉE DU BANC — et c'est MESURÉ, pas affirmé.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Trois fichiers du dépôt justifient une extraction par la même phrase :
//
//     « `getContext` rend `null` sous happy-dom »
//
//   · `dashboard/src/views/cerveau-physique.ts`   (l. 6)
//   · `dashboard/src/views/cerveau-designation.ts` (l. 449)
//   · `dashboard/src/views/Cerveau.tsx`            (l. 245 et 350)
//
// Cette phrase porte à elle seule le droit de sortir des décisions d'une boucle
// de rendu — c'est-à-dire une bonne part de la forme du Cerveau. Et RIEN ne la
// vérifiait. Elle était vraie le jour où on l'a écrite ; elle a exactement le
// statut d'un badge écrit de tête.
//
// ─── LA DEMANDE À LAQUELLE CE FICHIER RÉPOND ─────────────────────────────────
//
// Le balayage laissait `attrape.current.id` nu — la ligne qui passe à la
// physique le corps que le doigt tient :
//
//     rappelerAuCentre(liste, { L, H, dt, attrapeId: attrape.current.id });
//
// La consigne était : si happy-dom ne peut pas la jouer, la DOCUMENTER
// honnêtement plutôt que de la simuler. Fabriquer un faux contexte 2D pour
// faire tourner la boucle donnerait un banc vert qui ne dessine rien et ne
// mesure rien — du décor, exactement ce qu'on refuse.
//
// Alors on documente. Mais une documentation qui ne peut pas rougir vaut la
// phrase de commentaire qu'elle remplace. Celle-ci rougit : elle MESURE la
// limite, elle MESURE ce qu'elle coûte, et elle garde la consignation contre
// la dérive.
//
// ─── L'INVENTAIRE, PARCE QU'UNE DETTE QU'ON NE CHIFFRE PAS N'EXISTE PAS ──────
//
// Ce qui reste derrière `if (!ctx) return;` dans `Cerveau.tsx`, après toutes
// les extractions faites à ce jour :
//
//   · la lecture de `attrape.current.id` passée à `rappelerAuCentre` ;
//   · la lecture de `survole.current` et `choisi` pour désigner l'actif ;
//   · les appels de dessin eux-mêmes (`clearRect`, `arc`, `fillText`, …).
//
// Ce sont des lectures de références et des ordres au pinceau — de la
// TUYAUTERIE. Chaque DÉCISION qui vivait là est sortie et éprouvée ailleurs ;
// le troisième bloc de ce fichier est ce qui empêche qu'une d'elles y revienne
// en douce, où plus aucun banc ne la verrait.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

// ─── `process.cwd()` ET NON `import.meta.url` ────────────────────────────────
//
// Sous `happy-dom`, `import.meta.url` devient une URL `http:` et `fileURLToPath`
// lève « The URL must be of scheme file ». Le piège est connu du dépôt — il est
// écrit en toutes lettres dans `tests/vitrine-executee.test.ts` — et il m'a
// repris quand même, parce que la note vivait dans le fichier qui l'avait subi
// et nulle part ailleurs (§ 9 sexnonagies).
const lire = (f: string): string => readFileSync(path.resolve(process.cwd(), f), 'utf8');

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
  vi.restoreAllMocks();
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

describe('LA LIMITE ELLE-MÊME, mesurée sur l’environnement de banc', () => {
  it('un `<canvas>` n’a PAS de contexte 2D — et il le dit en rendant `null`', () => {
    // ─── L'ASSERTION QUI PORTE TOUT LE RESTE ───────────────────────────────
    //
    // Le jour où cette ligne rougit, ce n'est pas une panne : c'est une BONNE
    // nouvelle qui demande du travail. happy-dom saurait dessiner, la boucle du
    // Cerveau redeviendrait jouable, et les lignes consignées ci-dessus
    // devraient être reprises et défendues pour de bon.
    const toile = document.createElement('canvas');
    expect(
      toile.getContext('2d'),
      'happy-dom sait désormais dessiner : reprenez les lignes consignées hors de portée',
    ).toBeNull();
  });

  it('elle rend `null` — elle ne LÈVE pas, et la nuance porte la vue entière', () => {
    // `if (!ctx) return;` ne rattrape qu'un `null`. Si `getContext` se mettait à
    // lever, l'effet de rendu du Cerveau mourrait dans React au lieu de rendre
    // la main proprement — et l'écran deviendrait blanc là où il montre
    // aujourd'hui une liste parfaitement utilisable.
    const toile = document.createElement('canvas');
    expect(() => toile.getContext('2d')).not.toThrow();
  });

  it('la cause est le CONTEXTE, pas l’horloge d’animation', () => {
    // ─── POURQUOI CETTE PRÉCISION COMPTE ───────────────────────────────────
    //
    // « Le canevas ne marche pas sous banc » est trop vague pour décider quoi
    // que ce soit. Mesuré finement, l'environnement fournit bel et bien
    // `requestAnimationFrame` : une boucle d'animation SANS dessin serait
    // jouable. C'est le contexte de dessin, et lui seul, qui manque.
    //
    // Cette précision est ce qui rend la consignation honnête plutôt que
    // paresseuse : on ne dit pas « intestable », on dit exactement pourquoi.
    expect(typeof window.requestAnimationFrame, 'l’horloge d’animation existe').toBe('function');
  });
});

describe('CE QUE LA LIMITE COÛTE, mesuré au comportement de la vue', () => {
  it('le mode graphe rend bien sa toile — la vue n’est pas absente, elle est muette', async () => {
    const dom = await monter();
    expect(
      dom.querySelector('canvas.cerveau-toile'),
      'la toile du graphe est absente',
    ).toBeTruthy();
  });

  it('et la boucle de simulation ne démarre JAMAIS : aucune image n’est demandée', async () => {
    // ─── LA MESURE, PLUTÔT QUE LA CROYANCE ─────────────────────────────────
    //
    // `requestAnimationFrame` est planifié À LA FIN de l'effet, après
    // `if (!ctx) return;`. Compter les demandes d'image est donc la façon
    // directe de savoir si la boucle a démarré — sans rien deviner du dessin.
    //
    // Zéro image demandée ⇒ pas un seul tour ⇒ `attrape.current.id`, la
    // désignation de l'actif et tous les ordres au pinceau ne sont jamais
    // atteints. C'est LA phrase que ce fichier avait à établir.
    const espion = vi.spyOn(window, 'requestAnimationFrame');
    await monter();
    expect(
      espion.mock.calls.length,
      'la boucle du canevas tourne : les lignes consignées sont désormais atteignables',
    ).toBe(0);
  });
});

describe('LA CONSIGNATION NE DOIT PAS DÉRIVER', () => {
  // ─── LE VRAI RISQUE, UNE FOIS LA LIMITE ADMISE ─────────────────────────────
  //
  // Une zone d'ombre reconnue devient commode. La tentation n'est pas d'y
  // laisser ce qui s'y trouve — c'est d'y RAMENER une décision, « juste
  // celle-là », parce que c'est plus court sur place. Elle y serait invisible :
  // ni banc, ni loupe, ni relecture attentive ne la verraient.
  //
  // Ces gardes tiennent l'inverse : chaque décision sortie de la boucle est
  // encore appelée depuis `Cerveau.tsx`. Ré-inliner l'une d'elles supprime son
  // appel, et le banc le dit.
  const SORTIES = [
    // La physique — « le doigt gagne », la ligne qui a déclenché tout ceci.
    'rappelerAuCentre(',
    // Ce qu'un appui attrape, et ce qu'un glisser fait ensuite.
    'priseAuDoigt(',
    'deplacementDuGlisse(',
    // Un glisser n'est pas un clic.
    'selectionAuRelacher(',
    // Le corps sous le curseur, la chaleur, le rayon, l'extinction.
    'corpsSousLePoint(',
    'chaleur(',
    'rayon(',
    'estEteinte(',
    // Les étiquettes : leur pose, leur police, et le texte de la bulle.
    'etiquettesPosees(',
    'policeEtiquette(',
    'resumeDeNote(',
    // La note jamais servie, et la densité d'écran.
    'noteCreuse(',
    'densiteEcran(',
  ] as const;

  const SOURCE = lire('dashboard/src/views/Cerveau.tsx');

  it.each(SORTIES)('`%s` est toujours appelée depuis la vue, pas ré-inlinée', (appel) => {
    expect(
      SOURCE.includes(appel),
      `la décision de ${appel} n’est plus appelée : si elle est revenue dans la boucle, aucun banc ne la voit`,
    ).toBe(true);
  });

  it('la boucle rend la main quand le contexte manque, au lieu de peindre dans le vide', () => {
    // Sans ce garde-fou, un `ctx` nul ferait lever `setTransform` À CHAQUE
    // rendu du mode graphe. Le banc au-dessus le mesure déjà par le
    // comportement ; on le nomme ici pour que celui qui touche à l'effet sache
    // ce qu'il tient dans la main.
    expect(SOURCE, 'le repli sur contexte absent a disparu').toContain('if (!ctx) return;');
  });
});
