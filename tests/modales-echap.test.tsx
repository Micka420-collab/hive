// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// TOUTE MODALE SE FERME SUR ÉCHAP — six dialogues, et celui qui ne le faisait pas.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// La consigne du § 9 duovicicenties — recenser les écouteurs posés sur `window`
// et regarder qui garde leur porte — a mené à `ui.tsx`, et de là au recensement
// des dialogues du produit :
//
//     AccountPanel      useDialog ✔    Échap ✔
//     InvitePanel       (le sien)      Échap ✔
//     NewProjectModal   useDialog ✔    Échap ✔
//     NodesPanel        —              —        ← la fiche ouvrière
//     OpenAlexPanel     useDialog ✔    Échap ✔
//     TaskDrawer        useDialog ✔    Échap ✔
//
// Cinq sur six. La fiche ouvrière — celle qu'on ouvre en cliquant la carte
// d'une coéquipière, donc le geste le plus fréquent de l'écran Essaim — se
// déclarait `role="dialog" aria-modal="true"` sans rien qui la ferme au clavier.
//
// ─── POURQUOI C'EST PIRE QU'UNE MODALE QUI OUBLIE ÉCHAP ──────────────────────
//
// Cet attribut n'est pas décoratif : `modalOpen()` le cherche, et DEUX gardes
// déjà défendues s'appuient dessus — les raccourcis de la coquille et ceux du
// Time-Lapse se neutralisent quand une modale est ouverte.
//
// La fiche ouvrière prenait donc le clavier À TOUT LE MONDE, sans offrir la
// seule touche qui rend un piège vivable. Ouverte, on ne pouvait plus ni
// naviguer par les chiffres, ni la fermer autrement qu'à la souris.
//
// ─── ET LA GARDE QUI EMPÊCHE LA FAMILLE DE REVENIR ───────────────────────────
//
// Le cas de comportement ferme l'instance. La garde structurelle ferme la
// FAMILLE : tout fichier qui se déclare dialogue modal doit prouver qu'il sait
// se fermer. Elle DÉCOUVRE les dialogues plutôt que de les lister — § 9
// tervicicenties, une énumération écrite à la main vieillit au fichier suivant.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `process.cwd()`, jamais `import.meta.url` : sous happy-dom l'URL du module
// n'est pas de schéma `file:`, et `fileURLToPath` y refuse net. Le banc tourne
// depuis la racine du dépôt — c'est ce que fait déjà `installeurs-jumeaux`.
const SRC = path.join(process.cwd(), 'dashboard', 'src');

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  // La fiche va chercher un classement ; sans bouchon, elle laisserait une
  // promesse pendante et le banc parlerait d'un réseau qu'il ne mesure pas.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('classement injoignable — la fiche vit sans lui'))),
  );
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.unstubAllGlobals();
});

const ouvriere = (nom: string): HiveNode =>
  ({
    id: `n-${nom}`,
    name: nom,
    ownerName: 'Camille',
    agentType: 'claude-code',
    status: 'online',
    maxConcurrency: 2,
    running: 0,
    lastSeen: 1_700_000_000_000,
    plateforme: 'linux',
  }) as unknown as HiveNode;

/** Monte le panneau, puis OUVRE la fiche en cliquant la carte de l'ouvrière. */
async function ouvrirLaFiche(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  // `tasks` ET `onOpenTask` : la fiche ne s'offre que si l'appelant fournit les
  // deux — les rendus qui n'ont que les nœuds gardent le panneau d'avant.
  await act(async () =>
    racine?.render(<NodesPanel nodes={[ouvriere('Maya')]} tasks={[]} onOpenTask={() => {}} />),
  );
  await act(async () => {});

  const carte = [...document.body.querySelectorAll('*')].find(
    (e) => e.className && String(e.className).includes('node-card'),
  );
  if (!carte) throw new Error('la carte de l’ouvrière est introuvable');
  await act(async () => {
    carte.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  return document.body;
}

const ficheOuverte = (): boolean =>
  document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

async function frapperEchap(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {});
}

describe('la fiche ouvrière se ferme au clavier', () => {
  it('LA FICHE S’OUVRE — sinon le cas suivant ne mesure rien', async () => {
    // Le cas positif d'abord (§ 9 unvicicenties) : sans lui, « Échap ferme »
    // serait vert sur une fiche qui ne s'ouvre pas.
    const dom = await ouvrirLaFiche();
    expect(ficheOuverte(), 'la fiche ne s’ouvre pas').toBe(true);
    expect(dom.textContent, 'la fiche n’affiche pas l’ouvrière').toContain('Maya');
  });

  it('ÉCHAP LA FERME — comme ses cinq sœurs', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Le défaut mesuré : la fiche se déclarait `aria-modal="true"`, donc
    // `modalOpen()` la voyait et neutralisait les raccourcis de la coquille ET
    // ceux du Time-Lapse — sans offrir la touche qui la referme.
    //
    // Elle prenait le clavier à tout le monde et n'en rendait rien.
    await ouvrirLaFiche();
    expect(ficheOuverte()).toBe(true);

    await frapperEchap();
    expect(ficheOuverte(), 'Échap ne ferme pas la fiche ouvrière').toBe(false);
  });
});

describe('la famille entière, pas seulement l’instance', () => {
  it('TOUT DIALOGUE MODAL SAIT SE FERMER AU CLAVIER', () => {
    // ─── LA GARDE QUI FERME LA FAMILLE ─────────────────────────────────────
    //
    // Un cas de comportement ferme UNE modale. Celle-ci ferme la règle : se
    // déclarer `role="dialog" aria-modal="true"`, c'est prendre le clavier du
    // produit (via `modalOpen()`), et cela oblige à savoir le rendre.
    //
    // Les dialogues sont DÉCOUVERTS, jamais listés : une énumération écrite à
    // la main vieillirait au fichier suivant, et c'est précisément le défaut
    // qui a laissé la fiche ouvrière passer (§ 9 tervicicenties).
    const sansEchap: string[] = [];
    let dialogues = 0;

    for (const f of readdirSync(SRC)) {
      if (!f.endsWith('.tsx')) continue;
      const src = readFileSync(path.join(SRC, f), 'utf8');
      // On cherche la DÉCLARATION de modalité, pas le mot : `ui.tsx` définit
      // `modalOpen()` en citant le sélecteur, et n'est pas une modale.
      if (!/role="dialog"/.test(src) || !/aria-modal="true"/.test(src)) continue;
      dialogues += 1;
      // Deux façons légitimes de savoir se fermer : le crochet partagé, ou son
      // propre écouteur d'Échap. On n'impose pas la forme, seulement l'effet.
      if (!/useDialog\s*</.test(src) && !/'Escape'/.test(src)) sansEchap.push(f);
    }

    expect(dialogues, 'aucun dialogue trouvé — la garde ne garde rien').toBeGreaterThanOrEqual(5);
    expect(
      sansEchap,
      `ces dialogues prennent le clavier du produit sans savoir le rendre : ${sansEchap.join(', ')}`,
    ).toEqual([]);
  });
});
