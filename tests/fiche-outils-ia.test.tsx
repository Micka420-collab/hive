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

// LES DEUX FONCTIONS RÉSEAU, PAS UNE.
//
// `FicheOuvriere` en appelle deux à l'ouverture : `fetchWaggle` (le nectar) et
// `fetchChambre` (le baptême). Je n'avais bouchonné que la première — la
// seconde partait EN VRAI vers `127.0.0.1:3000`, et ce banc crachait
// 32 `ECONNREFUSED` par lancement, mesurés.
//
// Ce n'est pas qu'une nuisance de journal. Le rejet arrive de façon
// asynchrone, parfois APRÈS la fin du test qui l'a déclenché : sous
// `--sequence.shuffle`, il retombe dans la fenêtre d'un banc voisin, qui rougit
// pour une faute qui n'est pas la sienne. C'est la forme la plus coûteuse de
// dépendance d'ordre, parce qu'elle accuse un innocent.
//
// Le banc voisin (`poste-ecran.test.tsx`) bouchonne les deux depuis toujours.
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() =>
    Promise.resolve({ nodes: [], totalTasksDone: 0, totalTasksFailed: 0, topNodeId: null }),
  ),
  fetchChambre: vi.fn(() =>
    Promise.resolve({
      nodeId: 'n-maya',
      bapteme: null,
      metier: null,
      caste: 'nourrice',
      node: {
        id: 'n-maya',
        status: 'online',
        plateforme: null,
        agentType: 'shell',
        ownerName: 'test',
        running: 0,
        maxConcurrency: 1,
        lastSeen: 1,
        nameTechnique: 'Maya',
      },
      presences: [],
      tasks: [],
    }),
  ),
  // TROISIÈME, et c'est la leçon : le compte est passé de 32 à 16, pas à 0.
  // `useBaptemes` — un hook, pas un appel visible dans le JSX — tire
  // `fetchBaptemes`. Corriger la moitié d'une fuite laisse croire qu'on l'a
  // fermée ; seul le COMPTE mesuré dit la vérité, et il fallait le relire
  // après chaque bouchon.
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { NodesPanel } from '../dashboard/src/NodesPanel';
import { setLang } from '../dashboard/src/i18n';

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
/** Ce qui est parti au presse-papiers, dans l'ordre. */
let copies: string[] = [];
/** Faire échouer la copie, pour éprouver le chemin d'échec. */
let copiePossible = true;
/** Combien de `fetch` sont partis — la promesse « ça ne lance rien » se compte. */
let appelsFetch = 0;

vi.mock('../dashboard/src/copier', () => ({
  copierTexte: vi.fn((texte: string) => {
    if (!copiePossible) return Promise.resolve(false);
    copies.push(texte);
    return Promise.resolve(true);
  }),
}));

beforeEach(() => {
  copies = [];
  copiePossible = true;
  appelsFetch = 0;
  // Compter les `fetch` plutôt que les interdire : le banc affirme une ABSENCE,
  // et une absence ne vaut que si la mise en place pouvait la démentir.
  globalThis.fetch = vi.fn(() => {
    appelsFetch += 1;
    return Promise.reject(new Error('aucun réseau dans ce banc'));
  }) as unknown as typeof fetch;
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

  it('LA COMMANDE S’AFFICHE QUAND LA SUIVRE RÈGLE TOUT — ET SE COPIE', async () => {
    // Claude Code : la clé est là, le binaire manque. Une commande suffit, et
    // c'est le seul cas où la ruche la propose.
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'claude-code', binaire: false, cle: 'presente' }]),
    );
    const commande = dom.querySelector('[data-testid="fo-outil-commande"]');
    expect(commande?.textContent).toBe('npm install -g @anthropic-ai/claude-code');

    const bouton = dom.querySelector('[data-testid="fo-outil-copier"]');
    expect(bouton?.textContent).toContain('copier');
    act(() => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    // Le texte EXACT est parti au presse-papiers — pas une chaîne recomposée.
    expect(copies).toEqual(['npm install -g @anthropic-ai/claude-code']);
    expect(dom.querySelector('[data-testid="fo-outil-copier"]')?.textContent).toContain('copié');
  });

  it('LA RUCHE MONTRE LA COMMANDE, ELLE NE LA LANCE PAS', async () => {
    // La promesse qui rend ce bouton acceptable. Un tableau de bord qui lance
    // `npm install -g` à distance sur le poste d'un membre est une surface
    // d'attaque : il suffirait d'un accès à cet écran pour faire installer un
    // paquet arbitraire sur toutes les machines de l'essaim.
    //
    // Le banc le tient par ce qu'il PEUT tenir : le clic ne parle qu'au
    // presse-papiers, et rien d'autre n'est appelé. `fetch` est compté ici
    // parce que c'est le seul chemin par lequel cet écran pourrait demander
    // quoi que ce soit au hub.
    const avant = appelsFetch;
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'claude-code', binaire: false, cle: 'presente' }]),
    );
    act(() => {
      dom
        .querySelector('[data-testid="fo-outil-copier"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(appelsFetch, 'le clic ne doit RIEN demander au hub').toBe(avant);
  });

  it('UNE COPIE QUI ÉCHOUE LE DIT — au lieu de faire croire au succès', async () => {
    copiePossible = false;
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'claude-code', binaire: false, cle: 'presente' }]),
    );
    act(() => {
      dom
        .querySelector('[data-testid="fo-outil-copier"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(dom.querySelector('[data-testid="fo-outil-copie-ratee"]')).toBeTruthy();
    expect(dom.querySelector('[data-testid="fo-outil-copier"]')?.textContent).toContain('copier');
  });

  it('AUCUNE COMMANDE QUAND LA SUIVRE NE RÉGLERAIT RIEN', async () => {
    // Clé absente aussi : installer le binaire donnerait un agent qui refuse de
    // travailler, et l'humain aurait suivi le conseil pour rien.
    const sansCle = await ouvrirLaFiche(
      ouvriere([{ agent: 'claude-code', binaire: false, cle: 'absente' }]),
    );
    expect(sansCle.querySelector('[data-testid="fo-outil-commande"]')).toBeNull();
  });

  it('AUCUNE COMMANDE POUR UN OUTIL QUE LA RUCHE REFUSE DE DEVINER', async () => {
    // Cline : le paquet existe, mais son nom npm est SANS PORTÉE — le dépôt
    // refuse d'installer globalement un nom nu. Le catalogue porte donc
    // `installation: null`, et l'écran ne propose rien plutôt qu'un nom risqué.
    const dom = await ouvrirLaFiche(
      ouvriere([{ agent: 'cline', binaire: false, cle: 'presente' }]),
    );
    expect(dom.querySelector('[data-testid="fo-outil-cline"]')).toBeTruthy();
    expect(dom.querySelector('[data-testid="fo-outil-commande"]')).toBeNull();
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
