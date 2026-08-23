// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES OUTILS IA D'UNE OUVRIÈRE, À L'ÉCRAN.
//
// ─── CE QUE CET ÉCRAN DOIT DIRE, ET CE QU'IL NE DOIT PAS LAISSER CROIRE ──────
//
// Deux faits arrivent de deux endroits différents et n'ont RIEN à voir :
//
//   · ce que la MACHINE porte — constaté par le nœud (binaire, clé) ;
//   · ce que la RUCHE sait faire de cet outil — le niveau du catalogue.
//
// Affichés séparément, chacun ment :
//   « Windsurf ✓ »                  ⇒ on croit qu'il travaille pour la ruche ;
//   « Windsurf : détecté seulement » ⇒ on croit qu'il n'est pas installé.
//
// Ce banc tient la conjonction. Il tient aussi la troisième valeur, celle
// qu'on oublie toujours : un nœud qui n'a RIEN déclaré n'est pas un nœud sans
// outils, et l'écran doit dire « je ne sais pas » plutôt que de dessiner une
// machine nue.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode } from '../src/shared/types';
import type { OutilConstate } from '../src/shared/protocol';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() =>
    Promise.resolve({ nodes: [], totalTasksDone: 0, totalTasksFailed: 0, topNodeId: null }),
  ),
}));

import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;

beforeEach(() => {
  window.localStorage.clear();
  // La langue se RÉSOUT à l'import du module i18n, avant que ce banc n'existe :
  // vider `localStorage` ne la ramène pas au français, et happy-dom annonce un
  // navigateur anglophone. Sans cette ligne, les assertions françaises
  // rougissaient contre un écran parfaitement correct — en anglais.
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function ouvriere(outils?: OutilConstate[]): HiveNode {
  return {
    id: 'n-maya',
    name: 'Maya',
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
    running: 0,
    status: 'online',
    lastSeen: 1,
    ...(outils !== undefined ? { outils } : {}),
  };
}

async function ouvrirLaFiche(noeud: HiveNode): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(<NodesPanel nodes={[noeud]} tasks={[]} onOpenTask={() => {}} />),
  );
  await act(async () => {});
  // La fiche s'ouvre AU CLIC sur la carte — on passe par le geste réel, pas par
  // un montage direct du composant interne : c'est le chemin qu'un humain prend.
  act(() => {
    document
      .querySelector('.node-card')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  // Le corps entier : la modale se monte par PORTAIL, hors de cet arbre-ci.
  return document.body;
}

describe('la fiche d’une ouvrière montre ses outils IA — et leur niveau', () => {
  it('UN OUTIL INSTALLÉ QUE LA RUCHE NE SAIT QUE DÉTECTER N’EST PAS COMPTÉ PILOTABLE', async () => {
    // LA PROMESSE CENTRALE, à l'écran. Windsurf est là, sa clé aussi, et la
    // ligne doit malgré tout dire que la ruche n'en fera rien.
    const dom = await ouvrirLaFiche(
      ouvriere([
        { agent: 'claude-code', binaire: true, cle: 'presente' },
        { agent: 'windsurf', binaire: true, cle: 'presente' },
      ]),
    );

    const windsurf = dom.querySelector('[data-testid="fo-outil-windsurf"]');
    expect(windsurf, 'la ligne Windsurf doit exister').toBeTruthy();
    expect(windsurf?.className).not.toContain('fo-outil-pilotable');
    expect(windsurf?.textContent).toContain('détecté seulement');

    const claude = dom.querySelector('[data-testid="fo-outil-claude-code"]');
    expect(claude?.className).toContain('fo-outil-pilotable');

    // Le compte ne compte QUE ce qui travaille : un sur les deux.
    expect(dom.querySelector('[data-testid="fo-outils-compte"]')?.textContent).toContain('1');
  });

  it('LE CONSTAT DE LA MACHINE ET LE NIVEAU DE LA RUCHE SONT DITS TOUS LES DEUX', async () => {
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'cursor', binaire: false, cle: 'absente' }]),
    );
    const ligne = dom.querySelector('[data-testid="fo-outil-cursor"]');
    // Ce que porte la machine…
    expect(ligne?.textContent).toContain('absent de cette machine');
    // …et jusqu'où va la ruche. Les deux, sur la même ligne.
    expect(ligne?.textContent).toContain('exécute des tâches');
  });

  it('UNE CLÉ NON LISIBLE NE SE DIT PAS « absente »', async () => {
    // Conseiller de poser une clé déjà posée est le pire conseil possible.
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'windsurf', binaire: true, cle: 'inconnue' }]),
    );
    const ligne = dom.querySelector('[data-testid="fo-outil-windsurf"]');
    expect(ligne?.textContent).toContain('non lisible');
    expect(ligne?.textContent).not.toContain('clé absente');
  });

  it('UN NŒUD QUI N’A RIEN DÉCLARÉ DIT « je ne sais pas », PAS « aucun outil »', async () => {
    const dom = await ouvrirLaFiche(ouvriere());
    expect(dom.querySelector('[data-testid="fo-outils"]')).toBeNull();
    const rien = dom.querySelector('[data-testid="fo-outils-inconnus"]');
    expect(rien, 'la fiche doit DIRE qu’elle ne sait pas').toBeTruthy();
    expect(rien?.textContent).toContain('version antérieure');
    // Et surtout : pas de compte, qui se lirait « 0 outil pilotable » sur une
    // machine qui en porte peut-être quatre.
    expect(dom.querySelector('[data-testid="fo-outils-compte"]')).toBeNull();
  });

  it('UNE MACHINE VRAIMENT NUE MONTRE UNE LISTE VIDE ET UN COMPTE À ZÉRO', async () => {
    // L'autre moitié : là, le nœud a bien déclaré — il n'a rien trouvé. C'est
    // une information, et elle se distingue du cas précédent.
    const dom = await ouvrirLaFiche(ouvriere([]));
    expect(dom.querySelector('[data-testid="fo-outils"]')).toBeTruthy();
    expect(dom.querySelectorAll('.fo-outil')).toHaveLength(0);
    expect(dom.querySelector('[data-testid="fo-outils-compte"]')?.textContent).toContain('0');
    expect(dom.querySelector('[data-testid="fo-outils-inconnus"]')).toBeNull();
  });

  it('CE QUI BORNE UN OUTIL EST DIT, PAS CACHÉ', async () => {
    const dom = await ouvrirLaFiche(ouvriere([{ agent: 'shell', binaire: true, cle: 'presente' }]));
    const ligne = dom.querySelector('[data-testid="fo-outil-shell"]');
    expect(ligne?.textContent).toContain('SIMULÉS');
    expect(ligne?.className).not.toContain('fo-outil-pilotable');
  });

  it('EN ANGLAIS, LES DEUX MOITIÉS BASCULENT — pas seulement l’habillage', async () => {
    // Le composant passe la langue à DEUX fonctions distinctes : `direOutil`
    // pour l'état de la machine, `direNiveau` pour le niveau de la ruche. En
    // oublier une laisserait une demi-ligne en français au milieu de l'anglais,
    // et aucun banc francophone ne le verrait.
    setLang('en');
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'windsurf', binaire: false, cle: 'absente' }]),
    );
    const ligne = dom.querySelector('[data-testid="fo-outil-windsurf"]');
    expect(ligne?.textContent).toContain('not on this machine'); // la machine
    expect(ligne?.textContent).toContain('detected only'); // la ruche
    expect(ligne?.textContent).not.toContain('absent de cette machine');
    expect(ligne?.textContent).not.toContain('détecté seulement');
  });

  it('UN OUTIL INCONNU DU CATALOGUE S’AFFICHE SANS NIVEAU INVENTÉ', async () => {
    // Un nœud plus récent que le hub. On le montre — il est là — mais on ne
    // prétend pas savoir ce qu'on en ferait.
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'outil-de-demain', binaire: true, cle: 'presente' }]),
    );
    const ligne = dom.querySelector('[data-testid="fo-outil-outil-de-demain"]');
    expect(ligne?.textContent).toContain('outil-de-demain');
    expect(ligne?.textContent).toContain('ne sait rien de cet outil');
    expect(ligne?.className).not.toContain('fo-outil-pilotable');
  });
});
